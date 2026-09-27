import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataCache } from '../../public/metadata-cache.js';

test('metadata expires without extending freshness on hits, and returns isolated values', () => {
  let now = 0;
  const cache = createMetadataCache({ now: () => now });
  const work = { chapters: ['one'] };
  cache.set('work', work, 100);
  work.chapters.push('two');
  cache.get('work').chapters.push('three');
  now = 99;
  assert.deepEqual(cache.get('work'), { chapters: ['one'] });
  now = 100;
  assert.equal(cache.get('work'), undefined);
  cache.set('expired', work, 99);
  assert.equal(cache.get('expired'), undefined);
});

test('metadata evicts least recently used entries and respects UTF-8 byte and count limits', () => {
  const cache = createMetadataCache({ now: () => 0, maxEntries: 2, maxBytes: 24 });
  cache.set('a', '가', 100); cache.set('b', '나', 100);
  cache.get('a'); cache.set('c', '다', 100);
  assert.equal(cache.get('b'), undefined);
  cache.set('huge', '가'.repeat(20), 100);
  assert.equal(cache.get('huge'), undefined);
  assert.equal(cache.get('a'), '가');
  cache.set('d', '가'.repeat(6), 100);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('c'), undefined);
  assert.equal(cache.get('d'), '가'.repeat(6));
  cache.delete('d'); assert.equal(cache.get('d'), undefined);
  cache.set('a', 'new', 100); cache.clear(); assert.equal(cache.get('a'), undefined);
});

test('long metadata retention keeps server image tickets within their validity', async () => {
  const { metadataCacheLifetime: ttl } = await import('../../public/metadata-cache.js');
  assert.equal(ttl('detail', {}, true, {}), 6 * 60 * 60_000);
  assert.equal(ttl('list', {mode:'popular'}, true, {}), 30 * 60_000);
  assert.equal(ttl('list', {mode:'latest'}, true, {}), 5 * 60_000);
  assert.equal(ttl('detail', {}, false, {}), 10 * 60_000);
  assert.equal(ttl('list', {mode:'latest'}, false, {}), 5 * 60_000);
  assert.equal(ttl('detail', {}, true, {covers:[{imageUrl:'/api/image?ticket=opaque'}]}), 10 * 60_000);
  assert.equal(ttl('pages', {}, true, []), 0);
  assert.equal(ttl('html', {}, true, {}), 0);
});
