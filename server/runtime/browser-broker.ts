import { randomBytes } from 'node:crypto';
import type { SourceService } from '../service.js';
import type { ImageTicket } from '../tickets.js';
import { compatibilityHttp, type CompatibilityHttpInput } from '../network/http.js';
import { compatibilityHttpPolicy } from '../network/http-options.js';

export const actionTimeout = (action: string) => action === 'chapters' ? 600_000 : ['pages', 'html'].includes(action) ? 150_000 : 30_000;
type Job = { action: string; sourceId: string; codeDigest: string; expires: number; requests: number; bytes: number; pending: number; abort: AbortController; timer: ReturnType<typeof setTimeout> };
/** Short lived capabilities bound one browser invocation's aggregate network budget. No source JS executes here. */
export class BrowserBroker {
  private jobs = new Map<string, Job>();
  private preparing = 0;
  constructor(private service: SourceService, private outboundProxy?: string, private transport = compatibilityHttp) {}

  async prepare(input: unknown, signal: AbortSignal) {
    if (this.jobs.size + this.preparing >= 16) throw new Error('runtime_busy');
    this.preparing++;
    try {
      const bundle = await this.service.prepare(input, signal);
      signal.throwIfAborted();
      const token = randomBytes(24).toString('base64url');
      const timeoutMs = actionTimeout(bundle.action);
      const job: Job = { action: bundle.action, sourceId: bundle.entry.id, codeDigest: bundle.codeDigest,
        expires: Date.now() + timeoutMs + 10_000, requests: 0, bytes: 0, pending: 0, abort: new AbortController(),
        timer: setTimeout(() => this.cancel(token), timeoutMs + 10_000).unref() };
      this.jobs.set(token, job);
      return { ...bundle, token, timeoutMs };
    } finally { this.preparing--; }
  }
  private get(token: unknown) {
    const job = typeof token === 'string' ? this.jobs.get(token) : undefined;
    if (!job || job.expires < Date.now() || job.abort.signal.aborted) throw new Error('runtime_expired');
    return job;
  }
  async http(token: unknown, request: CompatibilityHttpInput, signal: AbortSignal) {
    const job = this.get(token);
    if (['metadata', 'preferences'].includes(job.action) || job.pending >= 4 || ++job.requests > 240)
      throw new Error('permission_denied');
    const policy = compatibilityHttpPolicy(request?.options);
    job.pending++;
    try {
      const response = await this.transport(request, AbortSignal.any([signal, job.abort.signal]), [], 2 * 1024 * 1024, this.outboundProxy);
      job.bytes += response.bytes.length;
      if (job.bytes > 32 * 1024 * 1024) {
        this.cancel(token);
        throw new Error('source_body_limit');
      }
      // Encoding/HTML parsing happens on the user's device. Upstream Set-Cookie is only
      // returned as data; it is never installed as an application-domain cookie.
      return httpReply(request, response);
    } finally { job.pending--; }
  }
  finish(token: unknown, value: unknown, seal: (value: ImageTicket) => string) {
    const job = this.get(token);
    if (job.pending) throw new Error('invalid_source_result');
    this.cancel(token);
    return { ...this.service.finalize(job.action, job.sourceId, value, seal), codeDigest: job.codeDigest };
  }
  cancel(token: unknown) {
    if (typeof token !== 'string') return;
    const job = this.jobs.get(token);
    if (!job) return;
    this.jobs.delete(token);
    clearTimeout(job.timer);
    job.abort.abort();
  }
  close() { for (const token of this.jobs.keys()) this.cancel(token); }
}

export function httpReply(request: CompatibilityHttpInput, response: Awaited<ReturnType<typeof compatibilityHttp>>) {
  const policy = compatibilityHttpPolicy(request?.options);
  return { statusCode: response.statusCode, headers: response.headers, contentType: response.contentType,
    bytes: response.bytes.toString('base64'), isRedirect: [301, 302, 303, 307, 308].includes(response.statusCode),
    request: { url: request.url, method: request.method ?? 'GET', headers: request.headers ?? {},
      contentLength: Buffer.byteLength(request.body ?? ''), followRedirects: policy.followRedirects, maxRedirects: policy.maxRedirects } };
}
