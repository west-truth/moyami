import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { imageSizeLimiter } from '../server/network/image-stream.js';

test('streams an 8 MiB image in chunks without joining the body', async () => {
  const chunk = Buffer.alloc(64 * 1024, 1);
  let bytes = 0;
  let largest = 0;
  const sink = new Writable({ write(value, _encoding, done) { bytes += value.length; largest = Math.max(largest, value.length); done(); } });
  await pipeline(Readable.from(Array.from({ length: 128 }, () => chunk)), imageSizeLimiter(), sink);
  assert.equal(bytes, 8 * 1024 * 1024);
  assert.equal(largest, chunk.length);
});

test('stops a streamed image above the configured limit', async () => {
  await assert.rejects(
    pipeline(Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), imageSizeLimiter(10), new Writable({ write(_v, _e, done) { done(); } })),
    /source_body_limit/
  );
});
