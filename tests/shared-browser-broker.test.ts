import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { SharedBrowserBroker } from '../server/runtime/shared-browser-broker.js';
import { RedisJobs, type Evaluate } from '../server/runtime/redis-jobs.js';
import type { SourceService } from '../server/service.js';

const port = Number(process.env.REDIS_TEST_PORT);
// Tests execute the production Lua against a disposable real Redis, not a Map mock.
const evaluate: Evaluate = (script, keys, args) => new Promise((resolve, reject) => {
  const parts = ['EVAL', script, String(keys.length), ...keys, ...args];
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(5000, () => socket.destroy(new Error('redis_test_timeout')));
  let buffer = Buffer.alloc(0);
  socket.on('error', reject);
  socket.on('connect', () => socket.write(Buffer.concat([
    Buffer.from(`*${parts.length}\r\n`), ...parts.flatMap(part => [Buffer.from(`$${Buffer.byteLength(part)}\r\n`), Buffer.from(part), Buffer.from('\r\n')])
  ])));
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    const at = buffer.indexOf('\r\n');
    if (at < 0) return;
    if (buffer[0] !== 36) { socket.destroy(); reject(new Error(buffer.toString())); return; }
    const length = Number(buffer.subarray(1, at).toString());
    if (buffer.length >= at + 2 + length + 2) {
      socket.end(); resolve(buffer.subarray(at + 2, at + 2 + length).toString());
    }
  });
});
const signal = () => new AbortController().signal;
const service = {
  prepare: async (input: any) => ({ action: input.action, entry: { id: '1' }, codeDigest: 'a'.repeat(64) }),
  finalize: (_action: string, _id: string, value: any) => value,
} as unknown as SourceService;
const response = (bytes = 1) => ({ bytes: Buffer.alloc(bytes), contentType: 'text/plain', statusCode: 200, headers: {}, url: 'https://example.com/' });
const request = { url: 'https://example.com/' };
function pair(transport: any = async () => response(), evalFn = evaluate) {
  const namespace = randomBytes(12).toString('hex');
  const store = () => new RedisJobs(evalFn, namespace);
  return { jobs: store(), a: new SharedBrowserBroker(service, store(), undefined, transport, 10),
    b: new SharedBrowserBroker(service, store(), undefined, transport, 10) };
}

test('shared broker: independent instances enforce 240 calls and atomic byte budget', { skip: !port }, async () => {
  let bytes = 1;
  const { a, b } = pair(async () => response(bytes));
  try {
    const job = await a.prepare({ action: 'list' }, signal());
    for (let i = 0; i < 240; i++) await (i % 2 ? a : b).http(job.token, request, signal());
    await assert.rejects(b.http(job.token, request, signal()), /permission_denied/);
    await a.cancel(job.token);
    bytes = 2 * 1024 * 1024;
    const large = await a.prepare({ action: 'pages' }, signal());
    for (let i = 0; i < 16; i++) await (i % 2 ? a : b).http(large.token, request, signal());
    await assert.rejects(b.http(large.token, request, signal()), /source_body_limit/);
    await assert.rejects(a.finish(large.token, {}, () => ''), /runtime_expired/);
  } finally { a.close(); b.close(); }
});

test('shared broker: concurrent finish is single-use; metadata, cancelled and expired jobs deny network', { skip: !port }, async () => {
  const { a, b, jobs } = pair();
  try {
    const meta = await a.prepare({ action: 'metadata' }, signal());
    await assert.rejects(b.http(meta.token, request, signal()), /permission_denied/);
    const finished = await Promise.allSettled([a.finish(meta.token, { result: [], changes: {} }, () => ''), b.finish(meta.token, {}, () => '')]);
    assert.equal(finished.filter(row => row.status === 'fulfilled').length, 1);
    const cancelled = await a.prepare({ action: 'pages' }, signal());
    await b.cancel(cancelled.token);
    await assert.rejects(a.http(cancelled.token, request, signal()), /runtime_expired/);
    const token = randomBytes(24).toString('base64url');
    await jobs.call('reserve', token);
    await jobs.call('activate', token, { action: 'pages', sourceId: '1', codeDigest: 'a'.repeat(64), timeoutMs: -9990 });
    await new Promise(resolve => setTimeout(resolve, 30));
    await assert.rejects(b.http(token, request, signal()), /runtime_expired/);
  } finally { a.close(); b.close(); }
});

test('shared broker: four concurrent requests globally; remote cancel aborts already running transports', { skip: !port }, async () => {
  let started = 0;
  const { a, b } = pair(async (_input: unknown, abort: AbortSignal) => new Promise((_resolve, reject) => {
    started++;
    abort.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  try {
    const job = await a.prepare({ action: 'pages' }, signal());
    const outcomes = Promise.allSettled([a, b, a, b].map(broker => broker.http(job.token, request, signal())));
    while (started < 4) await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(b.http(job.token, request, signal()), /permission_denied/);
    await assert.rejects(a.finish(job.token, {}, () => ''), /invalid_source_result/);
    await a.cancel(job.token);
    const rows = await outcomes;
    assert.ok(rows.every(row => row.status === 'rejected' && row.reason.message === 'cancelled'));
  } finally { a.close(); b.close(); }
});

test('shared broker: concurrent preparations enforce global 16; cancellation frees a slot', { skip: !port }, async () => {
  const { a, b } = pair();
  const tokens: string[] = [];
  try {
    const rows = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).prepare({ action: 'list' }, signal())));
    for (const row of rows) if (row.status === 'fulfilled') tokens.push(row.value.token);
    assert.equal(tokens.length, 16);
    assert.ok(rows.filter(row => row.status === 'rejected').every(row => row.reason.message === 'runtime_busy'));
    await b.cancel(tokens.pop());
    const next = await b.prepare({ action: 'list' }, signal());
    tokens.push(next.token);
  } finally { await Promise.all(tokens.map(token => a.cancel(token))); a.close(); b.close(); }
});

test('shared broker: slow and failed preparations reserve and release global slots', { skip: !port }, async () => {
  const namespace = randomBytes(12).toString('hex');
  let started = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = { ...service, prepare: async () => { started++; await gate; throw new Error('source_failed'); } } as unknown as SourceService;
  const a = new SharedBrowserBroker(slow, new RedisJobs(evaluate, namespace));
  const b = new SharedBrowserBroker(service, new RedisJobs(evaluate, namespace));
  const outcomes = Promise.allSettled(Array.from({ length: 16 }, () => a.prepare({ action: 'list' }, signal())));
  try {
    while (started < 16) await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(b.prepare({ action: 'list' }, signal()), /runtime_busy/);
    release();
    assert.ok((await outcomes).every(row => row.status === 'rejected' && row.reason.message === 'source_failed'));
    const next = await b.prepare({ action: 'list' }, signal());
    await b.cancel(next.token);
  } finally { release(); await outcomes; a.close(); b.close(); }
});

test('shared broker: store outage fails closed and aborts pending upstream; SSRF remains denied', { skip: !port }, async () => {
  let down = false, started = false;
  const evalFn: Evaluate = (...args) => down ? Promise.reject(new Error('offline')) : evaluate(...args);
  const { a, b } = pair(async (_input: unknown, abort: AbortSignal) => new Promise((_resolve, reject) => {
    started = true; abort.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }), evalFn);
  let token = '';
  try {
    token = (await a.prepare({ action: 'pages' }, signal())).token;
    const outcome = assert.rejects(a.http(token, request, signal()), /cancelled/);
    while (!started) await new Promise(resolve => setTimeout(resolve, 5));
    down = true;
    await outcome;
    await assert.rejects(b.finish(token, {}, () => ''), /runtime_store_unavailable/);
  } finally { down = false; await a.cancel(token); a.close(); b.close(); }
  const namespace = randomBytes(12).toString('hex');
  const real = new SharedBrowserBroker(service, new RedisJobs(evaluate, namespace));
  const job = await real.prepare({ action: 'list' }, signal());
  try { await assert.rejects(real.http(job.token, { url: 'https://127.0.0.1/' }, signal()), /source_address_denied/); }
  finally { await real.cancel(job.token); real.close(); }
});
