import assert from 'node:assert/strict';
import test from 'node:test';
import { runExtension } from '../server/runtime/host.mjs';

test('wall deadline interrupts an infinite extension', async () => {
  await assert.rejects(runExtension({
    source: 'globalThis.moyaExtension = async () => { while (true) {} };',
    method: 'invoke', input: {}, profile: 'mangayomi-v1',
    timeoutMs: 200, memoryBytes: 16 * 1024 * 1024,
    signal: new AbortController().signal,
  }), { code: 'execution_timeout' });
});

test('CPU limit interrupts an infinite extension before its longer wall deadline', async () => {
  const started = performance.now();
  await assert.rejects(runExtension({
    source: 'globalThis.moyaExtension = async () => { while (true) {} };',
    method: 'invoke', input: {}, profile: 'mangayomi-v1',
    timeoutMs: 15000, memoryBytes: 16 * 1024 * 1024,
    signal: new AbortController().signal,
  }), { code: 'execution_timeout' });
  assert.ok(performance.now() - started < 14000, 'CPU guard must fire before the 15-second wall guard');
});
