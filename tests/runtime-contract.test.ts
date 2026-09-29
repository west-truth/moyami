import assert from "node:assert/strict";
import test from "node:test";
import type { MangayomiEntry } from "../server/contracts.js";
import { invokeMangayomi } from "../server/runtime/mangayomi.js";
import { novelHtmlText } from "../server/runtime/novel-content.js";

const baseEntry: MangayomiEntry = {
  id: "123456789",
  name: "Fixture",
  lang: "en",
  version: "1.0.0",
  baseUrl: "https://example.com",
  itemType: 0,
  sourceCodeUrl: "https://example.com/source.js",
  format: "mangayomi-js",
  isNsfw: false,
  hasCloudflare: false,
};

test("filter mode calls Mangayomi search with the changed filter state", async () => {
  const source = `
    class DefaultExtension extends MProvider {
      getFilterList(){ return [{type_name:'TextFilter',name:'tag',state:''}]; }
      async search(query,page,filters){ return {list:[{name:filters[0].state}],hasNextPage:false}; }
      async getPopular(){ throw new Error('wrong_method'); }
    }
  `;
  const output = await invokeMangayomi({
    entry: baseEntry,
    source,
    action: "list",
    params: {
      mode: "filter",
      page: 1,
      filters: [{ position: 0, value: "completed" }],
    },
    preferences: {},
    signal: new AbortController().signal,
  });
  assert.equal(
    (output.result as { list: Array<{ name: string }> }).list[0].name,
    "completed",
  );
});

test("novel fixture runs through the JS contract and safe text conversion", async () => {
  const source = `
    class DefaultExtension extends MProvider {
      async getHtmlContent(){ return '<p>First paragraph</p><script>bad()</script><p>Second paragraph</p>'; }
    }
  `;
  const output = await invokeMangayomi({
    entry: { ...baseEntry, itemType: 2 },
    source,
    action: "html",
    params: { title: "Chapter", chapterUrl: "https://example.com/chapter" },
    preferences: {},
    signal: new AbortController().signal,
  });
  assert.equal(
    novelHtmlText(output.result),
    "First paragraph\n\nSecond paragraph",
  );
});

test('filter summaries reflect preferences saved by the just-executed filter action', async () => {
  const source = `class DefaultExtension extends MProvider {
    getFilterList(){return [{type_name:'HeaderFilter',name:'Popular: '+(new SharedPreferences().getString('rule')||'old')}];}
    search(){new SharedPreferences().setString('rule','new');return {list:[]};}
  }`;
  const output = await invokeMangayomi({ entry:baseEntry,source,action:'list',params:{mode:'filter'},preferences:{},signal:new AbortController().signal });
  assert.match(JSON.stringify(output.result),/Popular: new/);
});

test('cover headers use work context including relative links, without rewriting CDN URLs', async () => {
  const source = `class DefaultExtension extends MProvider {
    getPopular(){return {list:[{name:'Cover',link:'/work',imageUrl:'https://cdn.example/cover.jpg?signature=keep'}]};}
    getHeaders(url){return {Referer:url.startsWith('https:')?url:'https://example.com/'};}
  }`;
  const output = await invokeMangayomi({entry:baseEntry,source,action:'list',params:{},preferences:{},signal:new AbortController().signal});
  const cover=(output.result as any).list[0];
  assert.equal(cover.imageUrl,'https://cdn.example/cover.jpg?signature=keep');
  assert.deepEqual(cover.imageHeaders,{Referer:'https://example.com/work'});
});

test('source parameters and Document.body/head support gallery-style sources', async () => {
  const output = await invokeMangayomi({entry:{...baseEntry,additionalParams:'{"gallery":"lovecome"}'},
    source:`class DefaultExtension extends MProvider {
      getPopular(){const doc=new Document('<html><head><title>Title</title></head><body><a href="/board/1">Work</a></body></html>');
        return {list:[{name:doc.body.selectFirst('a').text,link:doc.body.selectFirst('a').attr('href'),gallery:JSON.parse(this.source.additionalParams).gallery,title:doc.head.selectFirst('title').text}],hasNextPage:false};}
    }`,action:'list',signal:new AbortController().signal});
  assert.deepEqual((output.result as {list:unknown[]}).list,[{name:'Work',link:'/board/1',gallery:'lovecome',title:'Title'}]);
});

test('binary source indexes preserve byte values while text stays Unicode', async () => {
  const {decodeHttpBody}=await import('../server/runtime/http-body.js');
  const bytes=Uint8Array.from([0,0x80,0x9f,0xff,0xc3,0xa9]);
  assert.deepEqual([...decodeHttpBody(bytes,'application/octet-stream')].map(c=>c.charCodeAt(0)),[...bytes]);
  assert.equal(decodeHttpBody(new TextEncoder().encode('한글'),'application/json'),'한글');
  assert.equal(decodeHttpBody(Uint8Array.from([0xc3,0xa9]),'text/plain;charset=utf-8'),'é');
  assert.throws(()=>decodeHttpBody(bytes,'text/plain;charset=not-a-charset'),/source_encoding_unsupported/);
});
