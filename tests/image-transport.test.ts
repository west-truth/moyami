import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceService } from '../server/service.js';

test('chapter images can go direct, while credentials and outbound proxy retain server transport', async () => {
  const service = new SourceService('');
  const page = (headers = {}, source = service) => (source.finalize('pages', '1', {
    result: [{ url: 'https://1.1.1.1/image.jpg', headers }], changes: {},
  }, () => 'sealed').result as { imageUrl: string; directImageUrl?: string }[])[0];
  assert.equal(page().imageUrl, '/api/image?ticket=sealed', 'old clients keep the relay transport');
  assert.equal(page().directImageUrl, '/api/image?ticket=sealed&direct=1');
  assert.match(page({ Referer: 'https://example.com/', 'User-Agent': 'reader' }).directImageUrl!, /direct=1/);
  const credentials: Record<string, string>[] = [{ Cookie: 'private' }, { Authorization: 'Bearer private' }, { 'X-Key': 'private' }];
  for (const headers of credentials) {
    assert.equal(page(headers).imageUrl, '/api/image?ticket=sealed');
    assert.equal(page(headers).directImageUrl, undefined);
    assert.equal(await service.imageRedirect({ url: 'https://1.1.1.1/image.jpg', headers, sourceId: '1', expiresAt: Date.now()+60000 }, new AbortController().signal), undefined);
  }
  assert.equal(page({}, new SourceService('http://proxy.example:8080')).imageUrl, '/api/image?ticket=sealed');
  assert.equal(page({}, new SourceService('http://proxy.example:8080')).directImageUrl, undefined);
  const cover = service.finalize('detail', '1', { result: { imageUrl: 'https://1.1.1.1/cover.jpg' }, changes: {} }, () => 'sealed');
  assert.equal((cover.result as { imageUrl: string }).imageUrl, '/api/image?ticket=sealed', 'covers remain readable for local thumbnail storage');
});
