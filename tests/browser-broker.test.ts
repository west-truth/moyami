import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBroker } from '../server/runtime/browser-broker.js';
import type { SourceService } from '../server/service.js';
const signal = () => new AbortController().signal;
const service = {
  prepare: async (input: any) => ({ action: input.action, entry: { id: '1' }, codeDigest: 'a'.repeat(64) }),
  finalize: (_action: string, _id: string, value: unknown) => value,
} as unknown as SourceService;
const response = () => ({ bytes: Buffer.from('body'), contentType: 'text/plain; charset=utf-8', statusCode: 200, headers: {}, url: 'https://example.com/' });

test('broker rejects missing capabilities, metadata network, replayed finish and cancelled jobs', async () => {
  let calls = 0;
  const broker = new BrowserBroker(service, undefined, async () => { calls++; return response(); });
  try {
    await assert.rejects(broker.http('unknown', { url: 'https://example.com' }, signal()), /runtime_expired/);
    const metadata = await broker.prepare({ action: 'metadata' }, signal());
    await assert.rejects(broker.http(metadata.token, { url: 'https://example.com' }, signal()), /permission_denied/);
    assert.equal(calls, 0);
    broker.finish(metadata.token, { result: [], changes: {} }, () => 'ticket');
    assert.throws(() => broker.finish(metadata.token, {}, () => 'ticket'), /runtime_expired/);
    const job = await broker.prepare({ action: 'list' }, signal());
    broker.cancel(job.token);
    await assert.rejects(broker.http(job.token, { url: 'https://example.com' }, signal()), /runtime_expired/);
  } finally { broker.close(); }
});

test('broker preserves SSRF restrictions on the real transport', async () => {
  const broker = new BrowserBroker(service);
  try {
    const job = await broker.prepare({ action: 'list' }, signal());
    for (const url of ['https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/'])
      await assert.rejects(broker.http(job.token, { url }, signal()), /source_address_denied/);
  } finally { broker.close(); }
});

test('aggregate byte/request budgets cannot be reset by issuing additional HTTP calls', async () => {
  let large = false;
  const broker = new BrowserBroker(service, undefined, async () => ({ ...response(), bytes: large ? Buffer.alloc(2 * 1024 * 1024) : Buffer.from('x') }));
  try {
    const a = await broker.prepare({ action: 'list' }, signal());
    for (let i = 0; i < 240; i++) await broker.http(a.token, { url: 'https://example.com' }, signal());
    await assert.rejects(broker.http(a.token, { url: 'https://example.com' }, signal()), /permission_denied/);
    large = true;
    const b = await broker.prepare({ action: 'pages' }, signal());
    for (let i = 0; i < 16; i++) await broker.http(b.token, { url: 'https://example.com' }, signal());
    await assert.rejects(broker.http(b.token, { url: 'https://example.com' }, signal()), /source_body_limit/);
    await assert.rejects(broker.http(b.token, { url: 'https://example.com' }, signal()), /runtime_expired/);
  } finally { broker.close(); }
});

test('cancelling a job aborts pending upstream requests and limits concurrency', async () => {
  const broker = new BrowserBroker(service, undefined, async (_request, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  try {
    const job = await broker.prepare({ action: 'pages' }, signal());
    const requests = Array.from({ length: 4 }, () => broker.http(job.token, { url: 'https://example.com' }, signal()));
    await assert.rejects(broker.http(job.token, { url: 'https://example.com' }, signal()), /permission_denied/);
    broker.cancel(job.token);
    const outcomes = await Promise.allSettled(requests);
    assert.ok(outcomes.every(result => result.status === 'rejected' && result.reason.message === 'cancelled'));
  } finally { broker.close(); }
});
