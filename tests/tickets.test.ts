import assert from 'node:assert/strict';
import test from 'node:test';
import { createTicketCodec } from '../server/tickets.js';

test('image ticket round trips without exposing the source URL', () => {
  const codec = createTicketCodec('test-secret');
  const value = { url: 'https://example.com/private/image.webp', headers: { Referer: 'https://example.com/' }, expiresAt: Date.now() + 1000, sourceId: '780920260914001' };
  const token = codec.seal(value);
  assert.equal(token.includes('example.com'), false);
  assert.deepEqual(codec.open(token), value);
});

test('image ticket rejects tampering and expiry', () => {
  const codec = createTicketCodec('test-secret');
  const valid = codec.seal({ url: 'https://example.com/image.webp', headers: {}, expiresAt: Date.now() + 1000, sourceId: '780920260914001' });
  assert.throws(() => codec.open((valid.startsWith('a') ? 'b' : 'a') + valid.slice(1)), /image_expired/);
  const expired = codec.seal({ url: 'https://example.com/image.webp', headers: {}, expiresAt: Date.now() - 1, sourceId: '780920260914001' });
  assert.throws(() => codec.open(expired), /image_expired/);
});
