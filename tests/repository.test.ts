import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMangayomiIndex } from '../server/catalog/repository.js';

const valid = {
  id: '9007199254740993', name: 'Example', lang: 'ko', version: '1.0.0',
  baseUrl: 'https://example.com', sourceCodeUrl: './source.js', sourceCodeLanguage: 1,
  itemType: 0, isManga: true
};

test('keeps string IDs and skips unsupported rows without discarding the repository', () => {
  const result = parseMangayomiIndex([
    valid,
    { ...valid, id: '2', sourceCodeLanguage: 0 },
    { ...valid, id: '3', itemType: 1 }
  ], 'https://repo.example/index.min.json');
  assert.equal(result.sources[0].id, '9007199254740993');
  assert.equal(result.sources[0].sourceCodeUrl, 'https://repo.example/source.js');
  assert.equal(result.sources.length, 1);
  assert.equal(result.skipped, 2);
});

test('rejects a repository with no supported JS reader sources', () => {
  assert.throws(() => parseMangayomiIndex([{ ...valid, sourceCodeLanguage: 0 }], 'https://repo.example/index.json'), /compatibility_repository_mismatch/);
});

test('preserves source variants sharing a script and rejects oversized parameters', () => {
  const {sources,skipped} = parseMangayomiIndex([
    {...valid,id:'1',additionalParams:'{"gallery":"comic_new6","minor":false}'},
    {...valid,id:'2',additionalParams:'{"gallery":"lovecome","minor":true}'},
    {...valid,id:'3',additionalParams:'x'.repeat(16385)},
  ],'https://repo.example/index.json');
  assert.equal(skipped,1);
  assert.equal(JSON.parse(sources[0].additionalParams!).gallery,'comic_new6');
  assert.equal(JSON.parse(sources[1].additionalParams!).gallery,'lovecome');
});
