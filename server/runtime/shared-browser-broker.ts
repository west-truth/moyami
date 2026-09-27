import { randomBytes } from 'node:crypto';
import type { SourceService } from '../service.js';
import type { ImageTicket } from '../tickets.js';
import { compatibilityHttp, type CompatibilityHttpInput } from '../network/http.js';
import { actionTimeout, httpReply } from './browser-broker.js';
import { RedisJobs } from './redis-jobs.js';

/** Same browser contract as BrowserBroker, with atomic cross-instance budgets. */
export class SharedBrowserBroker {
  private watches = new Map<string, { abort: AbortController; users: number; timer?: ReturnType<typeof setTimeout> }>();
  constructor(private service: SourceService, private jobs: RedisJobs, private outboundProxy?: string,
    private transport = compatibilityHttp, private pollMs = 1000) {}

  async prepare(input: unknown, signal: AbortSignal) {
    const token = randomBytes(24).toString('base64url');
    try {
      await this.jobs.call('reserve', token);
      const bundle = await this.service.prepare(input, AbortSignal.any([signal, AbortSignal.timeout(55_000)]));
      signal.throwIfAborted();
      const timeoutMs = actionTimeout(bundle.action);
      await this.jobs.call('activate', token, { action: bundle.action, sourceId: bundle.entry.id, codeDigest: bundle.codeDigest, timeoutMs });
      signal.throwIfAborted();
      return { ...bundle, token, timeoutMs };
    } catch (error) {
      await this.cancel(token).catch(() => {}); // TTL also covers an ambiguous store write or killed function.
      throw error;
    }
  }

  private watch(token: string) {
    let watch = this.watches.get(token);
    if (!watch) {
      watch = { abort: new AbortController(), users: 0 };
      this.watches.set(token, watch);
      const current = watch;
      const poll = async () => {
        try { await this.jobs.call('status', token); }
        catch (error) { current.abort.abort(error); }
        if (this.watches.get(token) === current && !current.abort.signal.aborted)
          current.timer = setTimeout(poll, this.pollMs);
      };
      current.timer = setTimeout(poll, this.pollMs);
    }
    watch.users++;
    const current = watch;
    return { signal: current.abort.signal, release: () => {
      if (--current.users === 0) { clearTimeout(current.timer); this.watches.delete(token); }
    } };
  }

  async http(token: unknown, request: CompatibilityHttpInput, signal: AbortSignal) {
    signal.throwIfAborted();
    const requestId = randomBytes(12).toString('hex');
    await this.jobs.call('acquire', token, { requestId });
    const watch = this.watch(token as string);
    let settled = false;
    try {
      const combined = AbortSignal.any([signal, watch.signal]);
      combined.throwIfAborted();
      const response = await this.transport(request, combined, [], 2 * 1024 * 1024, this.outboundProxy);
      combined.throwIfAborted();
      const value = httpReply(request, response);
      // No retry: a timed-out write may have committed. Fail closed instead.
      settled = true;
      await this.jobs.call('settle', token, { requestId, bytes: response.bytes.length });
      combined.throwIfAborted();
      return value;
    } finally {
      watch.release();
      if (!settled) await this.jobs.call('settle', token, { requestId, bytes: 0 }).catch(() => {});
    }
  }

  async finish(token: unknown, value: unknown, seal: (value: ImageTicket) => string) {
    const job = await this.jobs.call('finish', token);
    return { ...this.service.finalize(job.action, job.sourceId, value, seal), codeDigest: job.codeDigest };
  }
  async cancel(token: unknown) {
    this.watches.get(token as string)?.abort.abort(new Error('cancelled'));
    if (typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token)) await this.jobs.call('cancel', token);
  }
  close() {
    for (const watch of this.watches.values()) { clearTimeout(watch.timer); watch.abort.abort(new Error('cancelled')); }
    this.watches.clear();
  }
}
