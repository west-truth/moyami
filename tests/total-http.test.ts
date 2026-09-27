import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalHttpCollector } from '../client/total-http.js';
import { TOTAL_ENTRY, TOTAL_EXPECTED_SHA256 } from '../server/catalog/total.js';
const bundle = { action: 'pages', entry: TOTAL_ENTRY, codeDigest: TOTAL_EXPECTED_SHA256 };
const request = { url: 'https://example.com/manhwa/work/episode' };
const props = { sourceWorkId: 'work', episodeId: 'episode', imagesToken: 'fixture', adVerificationEnabled: false, imageMetas: [{}, {}] };
const html = (value: unknown) => `<script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify(value)}\n`])})</script>`;
const images = [{ page: 1, src: 'https://example.com/1.png' }, { page: 2, src: 'https://example.com/2.png' }];

test('TOTAL HTTP collector extracts JSON without evaluating source scripts and keeps order', async () => {
  const calls: any[] = [];
  const result = await totalHttpCollector(bundle, request, async (input: any) => {
    calls.push(input);
    return { statusCode: 200, body: calls.length === 1 ? html(props) + '<script>throw new Error("must not run")</script>' : JSON.stringify({ ok: true, images }) };
  });
  assert.deepEqual(JSON.parse(result).pages, images.map(row => row.src));
  assert.equal(calls[1].url, 'https://example.com/api/manhwa-images');
  assert.equal(JSON.parse(calls[1].body).proof, '');
});

test('unsupported source and browser authentication fail explicitly before image API', async () => {
  let calls = 0;
  const http = async () => { calls++; return { statusCode: 200, body: html({ ...props, adVerificationEnabled: true }) }; };
  await assert.rejects(totalHttpCollector({ ...bundle, codeDigest: 'changed' }, request, http), /source_browser_required/);
  assert.equal(calls, 0);
  await assert.rejects(totalHttpCollector(bundle, request, http), /source_browser_auth_required/);
  assert.equal(calls, 1);
});

test('TOTAL incomplete image lists and invalid ordering are not returned as successful chapters', async () => {
  for (const bad of [[images[0]], [images[1], images[0]], [images[0], { ...images[1], src: images[0].src }]]) {
    let count = 0;
    await assert.rejects(totalHttpCollector(bundle, request, async () => ({ statusCode: 200,
      body: ++count === 1 ? html(props) : JSON.stringify({ ok: true, images: bad }) })), /invalid_source_result/);
  }
});

test('audited Toki manga/webtoon collector preserves its own response contract', async () => {
  const {TOKI_VIEWER_SHA256}=await import('../client/total-http.js');
  for (const [id,section] of [['68925355','manhwa'],['1153259314','webtoon']]) {
    const calls:any[]=[];
    const result=await totalHttpCollector({action:'pages',entry:{id},codeDigest:TOKI_VIEWER_SHA256},{url:`https://example.com/${section}/work/episode`},async (input:any)=>{
      calls.push(input);return {statusCode:200,body:calls.length===1?html(props):JSON.stringify({ok:true,images})};
    });
    assert.deepEqual(JSON.parse(result),{images,expected:2});assert.equal(calls[1].url,`https://example.com/api/${section}-images`);
  }
});
