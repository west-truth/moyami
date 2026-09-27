import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceService } from '../server/service.js';

test('source cache negotiation still verifies server digest and update approval', async () => {
  const service = new SourceService();
  const digest = 'a'.repeat(64);
  (service as any).loadSource = async () => ({ source: 'verified', digest });
  service.catalogs.resolve = async () => ({ entry: { id: '1' }, repositoryUrl: 'https://repo.example/index.json' }) as any;
  const input = { action:'list', sourceId:'1', clientId:'1234567890abcdef' };
  const signal = new AbortController().signal;
  assert.equal((await service.prepare(input,signal)).source,'verified');
  assert.equal((await service.prepare({...input,cachedCodeDigest:digest},signal)).source,undefined);
  assert.equal((await service.prepare({...input,cachedCodeDigest:'b'.repeat(64)},signal)).source,'verified');
  await assert.rejects(service.prepare({...input,cachedCodeDigest:digest,codeDigest:'b'.repeat(64)},signal),/source_digest_changed/);
  await assert.rejects(service.prepare({...input,cachedCodeDigest:'invalid'},signal),/invalid_source_invocation/);
});
