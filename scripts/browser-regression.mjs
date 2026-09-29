// Offline browser regressions: serve the real UI with deterministic API responses.
import assert from 'node:assert/strict';
import { createHash, createCipheriv } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const repositoryUrl = 'https://repository.example/index.json';
const sourceId = '100000000000001';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const requests = [];
let generation = 0, fixturePageCount = 1, fixtureItemType = 0;
const defaultNovelText = Array.from({length:80}, (_,index) => `문단 ${index + 1}. 모야 소설 리더의 글자와 여백을 확인합니다. 검색어 바다와 읽기 위치를 확인합니다.`).join('\n\n');
let novelText=defaultNovelText;
const fixtureSource = `class DefaultExtension extends MProvider {
  constructor(){super();const p=new SharedPreferences();p.setInt('counter',(p.getInt('counter')||0)+1);}
  getSourcePreferences(){return [];}
  getFilterList(){return [{type_name:'TextFilter',name:'Tag',state:''}];}
  getPopular(){return {list:[{name:'Fixture',link:'https://example.com/work',imageUrl:'/broken" onerror="window.__injected=1'},{name:'다른 작품',link:'https://example.com/another'}],hasNextPage:false};}
  getLatestUpdates(){return this.getPopular();}
  search(){return this.getPopular();}
  getDetail(){return {name:'Fixture',author:'테스트 작가',artist:'테스트 그림',genre:['판타지','모험'],status:'ongoing',description:'작품 설명과 회차 목록',chapters:Array.from({length:25},(_,i)=>({name:'Chapter '+(25-i),url:'https://example.com/chapter/'+(25-i)}))};}
  getPageList(){return ['https://example.com/image'];}
  getHtmlContent(){return '<p>Novel fixture</p>';}
}`;
const fixtureDigest = createHash('sha256').update(fixtureSource).digest('hex');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/auth/status') {
      res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({configured:true,initialized:true,user:{id:'fixture',username:'fixture',role:'admin'}}));
    } else if (url.pathname === '/api/catalog') {
      res.setHeader('content-type', 'application/json');
      let body=''; for await (const chunk of req) body += chunk; const input=JSON.parse(body);
      res.end(JSON.stringify({ repositoryUrl: input.repositoryUrl, sources: [{ id: sourceId, name: '테스트 만화', lang: 'ko', itemType: fixtureItemType },{id:'second-source',name:'다른 소스',lang:'en',itemType:fixtureItemType}], skipped: 0 }));
    } else if (url.pathname.startsWith('/api/runtime/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      let output = { ok: true };
      if (url.pathname.endsWith('/prepare')) {
        requests.push(input);
        output = { ...input, token: input.action, source: input.cachedCodeDigest === fixtureDigest ? undefined : fixtureSource, codeDigest: fixtureDigest,
          entry: { id: input.sourceId, itemType: fixtureItemType }, timeoutMs: 30000 };
      } else if (url.pathname.endsWith('/finish')) {
        output = { ...input.value, codeDigest: fixtureDigest };
        if (input.token === 'pages') output.result = Array.from({length:fixturePageCount}, () => ({ imageUrl: `/fixture/image?generation=${++generation}` }));
        if (input.token === 'html') output.result = {text:novelText};
        if (input.token === 'preferences') output.result = [{key:'fixtureOption',kind:'text',title:'테스트 옵션',value:''}];
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(output));
    } else if (url.pathname === '/fixture/image') {
      if (url.searchParams.get('generation') === '1') res.writeHead(410).end();
      else res.writeHead(200, { 'content-type': 'image/png' }).end(png);
    } else if (['/', '/entry.js', '/account-storage.js', '/account-sync.js', '/pwa.js', '/local-cache.js', '/download-settings.js', '/cover-cache.js', '/metadata-cache.js', '/library-home.js', '/transitions.js', '/source-manager.js', '/reader-fonts.js', '/novel-reader.js', '/comic-reader.js', '/ui.js', '/moya.css', '/moya-ui.css', '/moya-ui.js', '/branding/moya-wordmark.png', '/app.js', '/connector.js', '/connector-images.js', '/host-config.js', '/styles.css', '/source-runtime.js', '/runtime/source-worker.js', '/runtime/quickjs.wasm'].includes(url.pathname)) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      let content = await readFile(new URL(`../public/${file}`, import.meta.url), (/\.(wasm|png)$/).test(file) ? undefined : 'utf8');
      // Make IDB commit overlap deterministic; no production behavior is replaced.
      if (file === 'entry.js') content = content.replace('selectAccount(account.id);', '').replace('await startSync();','');
      if (file === 'app.js') content = content.replace(/async function stateSet\(([^)]*)\) \{/, '$&\n await new Promise(resolve => setTimeout(resolve, 150));');
      res.writeHead(200, { 'content-type': file.endsWith('.png') ? 'image/png' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }).end(content);
    } else res.writeHead(404).end();
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.MOYA_SOURCE_BROWSER_EXECUTABLE, headless: true });
const results = [];
async function check(name, test) {
  if (process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name)) return;
  const context = await browser.newContext({serviceWorkers:'block'});
  context.setDefaultTimeout(12000);
  await context.addInitScript(({repositoryUrl,sourceId}) => {if(window !== top || !/^https?:$/.test(location.protocol)) return; if (!localStorage.getItem('moya-source-repositories')) localStorage.setItem('moya-source-repositories',JSON.stringify([repositoryUrl]));}, {repositoryUrl,sourceId});
  const uiErrors=[];context.on('page',page=>page.on('pageerror',error=>uiErrors.push(error.message)));
  try { await test(context);assert.deepEqual(uiErrors,[],'UI must not throw'); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); }
  finally { console.log(name + ': ' + results.at(-1).passed + (results.at(-1).error ? '\n' + results.at(-1).error : '')); await context.close(); fixturePageCount = 1; fixtureItemType = 0; novelText=defaultNovelText; }
}
async function runGuest(page, source, action = 'headers', timeoutMs = 3000, httpStatus, entry = {id:'1',itemType:0}, httpReply) {
  return page.evaluate(async ({ source, action, timeoutMs, httpStatus, entry, httpReply }) => {
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(x=>x.toString(16).padStart(2,'0')).join('');
    return new Promise((resolve, reject) => {
      const worker = new Worker('/runtime/source-worker.js', {type:'module'});
      const timer = setTimeout(() => {worker.terminate();reject(new Error('worker did not stop'));}, timeoutMs + 5000);
      worker.onerror = error => {clearTimeout(timer);worker.terminate();reject(new Error(error.message));};
      worker.onmessage = ({data}) => {
        if (data.type === 'http' && httpStatus === undefined) {
          clearTimeout(timer);worker.terminate();reject(new Error('unexpected HTTP request'));
          return;
        }
        if (data.type === 'http' && httpStatus !== undefined) {
          worker.postMessage({ type: 'http-result', id: data.id, value: { statusCode: httpStatus,
            contentType: 'text/html', headers: {}, bytes: btoa('<html>Access denied</html>'), ...httpReply } });
          return;
        }
        if (!['result','failure'].includes(data.type)) return;
        clearTimeout(timer);worker.terminate();resolve(data);
      };
      worker.postMessage({type:'invoke',bundle:{source,codeDigest:digest,entry,action,params:{},preferences:{},timeoutMs}});
    });
  }, {source, action, timeoutMs, httpStatus, entry, httpReply});
}
async function ready(context) {
  const page = await context.newPage();
  page.on('pageerror',error=>console.error('UI ERROR:',error.message));
  await page.goto(base);
  await page.locator('#recent:not([hidden])').waitFor();
  await page.locator('[data-nav=browse]:visible').first().click();
  await page.locator('#works .card').first().waitFor();
  return page;
}
try {
  await mkdir('.state/ux-review', {recursive:true});
  await check('start screen defaults to recent and remembers any catalog source; account layout has shared padding', async context => {
    const page=await context.newPage();await page.goto(base);
    await page.locator('#recent:not([hidden])').waitFor();
    await page.locator('#appHeader [data-settings=appearance]').click();
    assert.equal(await page.locator('#startScreen').inputValue(),'recent');
    const target=JSON.stringify([repositoryUrl,'second-source']);
    await page.waitForFunction(value=>[...document.querySelector('#startScreen').options].some(option=>option.value===value),target);
    await page.locator('#startScreen').selectOption(target);
    await page.reload();await page.locator('#works .card').first().waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moya-source-selection')).sourceId),'second-source');
    await page.locator('#appHeader [data-settings=appearance]').click();
    assert.equal(await page.locator('#startScreen').inputValue(),target);
    for(const width of [320,390,1280]) {
      await page.setViewportSize({width,height:900});
      await page.locator('.settings-tabs [data-settings=appearance]').click();
      const expected=await page.locator('#appearanceSettings h3').first().boundingBox();
      await page.locator('.settings-tabs [data-settings=account]').click();
      const actual=await page.locator('#accountSettings h3').first().boundingBox();
      assert.ok(Math.abs(actual.x-expected.x)<1,'account shares settings content inset');
      assert.ok(await page.locator('#settingsDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'settings fit viewport');
    }
    await page.screenshot({path:'/tmp/moyami-account-desktop.png'});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/moyami-account-mobile.png'});
    await page.locator('.settings-tabs [data-settings=appearance]').click();
    await page.locator('#startScreen').selectOption('recent');
    await page.reload();await page.locator('#recent:not([hidden])').waitFor();
    // A removed source must not silently activate some other source.
    await page.evaluate(repositoryUrl=>localStorage.setItem('moyami-start-screen',JSON.stringify({repositoryUrl,sourceId:'removed-source'})),repositoryUrl);
    await page.reload();await page.locator('#recent:not([hidden])').waitFor();
    await page.evaluate(()=>localStorage.setItem('moya-source-repositories','[]'));
    await page.reload();await page.locator('#recent:not([hidden])').waitFor();
  });
  await check('startup skips options and repeated list/detail reuse metadata until explicit refresh', async context => {
    const start = requests.length;
    const page = await ready(context);
    assert.deepEqual(requests.slice(start).map(row => row.action), ['list']);
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').first().waitFor();
    const afterDetail = requests.length;
    const updatedAt = await page.locator('#detailUpdatedAt').textContent();
    assert.match(updatedAt, /확인/);
    await page.locator('#back').click();
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').first().waitFor();
    assert.equal(requests.length, afterDetail);
    assert.equal(await page.locator('#detailUpdatedAt').textContent(), updatedAt);
    await page.route('**/api/runtime/finish', async route => {
      const response = await route.fetch(), value = await response.json();
      if (route.request().postDataJSON().token === 'detail')
        value.result.chapters.unshift({name:'New chapter',url:'https://example.com/chapter/26'});
      await route.fulfill({response,json:value});
    });
    await page.getByRole('button',{name:'작품 정보와 회차 새로고침',exact:true}).click();
    await page.getByLabel('회차 정렬').selectOption('desc');
    await page.getByText('New chapter',{exact:true}).waitFor();
    assert.equal(requests.length, afterDetail + 1);
    assert.equal(requests.at(-1).action, 'detail');
    await page.locator('#back').click();
    await page.locator('#latest').click();
    await page.locator('#listTitle').filter({hasText:'최신'}).waitFor();
    const afterLatest = requests.length;
    await page.locator('#popular').click();
    await page.locator('#listTitle').filter({hasText:'인기'}).waitFor();
    assert.equal(requests.length, afterLatest);
    const refreshed = page.waitForResponse('**/api/runtime/finish');
    await page.getByRole('button',{name:'탐색 목록 새로고침',exact:true}).click();
    await refreshed;
    assert.equal(requests.length, afterLatest + 1);
  });
  await check('reload restores catalog and metadata without a network request; verified source survives reload', async context => {
    const page = await ready(context);
    await page.locator('#workspaceContent[aria-busy=false]').waitFor();
    const start=requests.length;
    await page.route('**/api/catalog',route=>route.abort());
    await page.reload(); await page.locator('#recent:not([hidden])').waitFor(); await page.locator('[data-nav=browse]:visible').first().click(); await page.locator('#works .card').first().waitFor();
    assert.equal(requests.length,start);
    await page.locator('#refreshList').click();
    await page.locator('#workspaceContent[aria-busy=false]').waitFor();
    assert.equal(requests.length,start+1);
    assert.equal(requests.at(-1).cachedCodeDigest,fixtureDigest);
    // Corrupt cached code must be discarded before negotiation, never executed.
    await page.evaluate(async () => {
      const {localCache}=await import('/local-cache.js'), store=localCache('source-v1');
      for(const row of await store.all()) await store.set(row.key,{...row.value,source:'tampered'},row.expiresAt);
    });
    await page.locator('#refreshList').click(); await page.locator('#workspaceContent[aria-busy=false]').waitFor();
    assert.equal(requests.at(-1).cachedCodeDigest,undefined);
    assert.equal(await page.locator('#error').isVisible(),false);
  });
  await check('recent home renders without waiting for catalog; delayed catalog cannot reset navigation', async context => {
    generation=2;
    const page=await ready(context);
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#reader').waitFor();
    await page.evaluate(async()=>{const {localCache}=await import('/local-cache.js');await localCache('catalog-v2').clear();});
    let release; const gate=new Promise(resolve=>release=resolve);
    await page.route('**/api/catalog',async route=>{await gate;await route.continue().catch(()=>{});});
    try {
      await page.reload(); await page.locator('#recentFeatured').waitFor({timeout:2000});
      await page.locator('#sidebar [data-nav=browse]').first().click(); await page.locator('#browse').waitFor();
      release(); await page.waitForTimeout(300);
      assert.equal(await page.locator('#browse').isVisible(),true);
    } finally { release(); }
  });
  await check('unavailable cache storage falls back to live source without blocking reading', async context => {
    await context.addInitScript(() => {
      const open=IDBFactory.prototype.open;
      IDBFactory.prototype.open=function(name,...args){if(name==='moya-source-cache')throw new DOMException('Unavailable','SecurityError');return open.call(this,name,...args);};
    });
    const page=await ready(context);
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().waitFor();
    assert.equal(await page.locator('#error').isVisible(),false);
  });
  await check('mobile sidebar navigation completes after closing its history layer', async context => {
    const page=await ready(context); await page.setViewportSize({width:390,height:844});
    for(let i=0;i<2;i++) {
      await page.locator('#menuButton').click(); await page.locator('#mobileNavigation [data-nav=recent]').click();
      await page.locator('#recent').waitFor(); await page.waitForTimeout(150);
      assert.equal(await page.locator('#recent').isVisible(),true);
      await page.locator('#menuButton').click(); await page.locator('#mobileNavigation [data-nav=browse]').first().click();
      await page.locator('#browse').waitFor(); await page.waitForTimeout(150);
      assert.equal(await page.locator('#browse').isVisible(),true);
    }
    await page.goBack(); await page.locator('#recent').waitFor();
    assert.equal(await page.locator('#navigationDialog').isVisible(),false);
    await page.goForward(); await page.locator('#browse').waitFor();
  });
  await check('source error offers quick switching and does not report failed switches as success', async context => {
    const page=await ready(context);
    await page.route('**/api/runtime/prepare',route=>route.request().postDataJSON().sourceId===sourceId
      ? route.fulfill({status:502,json:{error:'source_connection_failed'}}):route.continue());
    await page.locator('#refreshList').click(); await page.locator('#error').waitFor();
    await page.locator('#errorQuickJump').click();
    await page.locator('#quickJumpRoot').getByText('다른 소스',{exact:true}).click();
    await page.locator('#browse').waitFor();
    assert.equal(await page.locator('#browseSourceName').textContent(),'다른 소스');
    await page.locator('#quickJump').click();
    await page.locator('#quickJumpRoot').getByText('테스트 만화',{exact:true}).click();
    await page.locator('#error').waitFor(); assert.equal(await page.locator('#errorQuickJump').isVisible(),true);
  });
  await check('filter drafts do not change popular parameters and applying filters invalidates saved tab rules', async context => {
    const page=await ready(context);
    await page.locator('#filterPanel summary').click(); await page.locator('#filters input').fill('saved-rule');
    await page.locator('#refreshList').click(); await page.locator('#workspaceContent[aria-busy=false]').waitFor();
    assert.deepEqual(requests.at(-1).params.filters,[]);
    await page.locator('#filters input').fill('saved-rule');
    await page.locator('#applyFilters').click(); await page.locator('#listTitle').filter({hasText:'필터 결과'}).waitFor();
    assert.deepEqual(requests.at(-1).params.filters,[{position:0,value:'saved-rule'}]);
    const after=requests.length;
    await page.locator('#popular').click(); await page.locator('#listTitle').filter({hasText:'인기'}).waitFor();
    assert.equal(requests.length,after+1);
    assert.deepEqual(requests.at(-1).params.filters,[]);
  });
  await check('extension image attributes cannot inject event handlers', async context => {
    const page = await ready(context);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
  });
  await check('default filters explicitly request filter mode', async context => {
    const page = await ready(context);
    await page.locator('#filterPanel summary').click();
    await page.locator('#applyFilters').click();
    await page.locator('#listTitle').filter({ hasText: '필터 결과' }).waitFor();
    assert.equal(requests.at(-1).params.mode, 'filter');
  });
  await check('retry uses the renewed image URL and decodes it', async context => {
    generation = 0;
    const page = await ready(context);
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').first().click();
    await page.locator('.errorPage button').click();
    await page.waitForFunction(() => {
      const image = document.querySelector('.page img');
      return image?.complete && image.naturalWidth > 0;
    }, null, { timeout: 3000 });
    assert.match(await page.locator('.page img').getAttribute('src'), /generation=2$/);
  });
  await check('two tabs retain both state changes through IDB commit', async context => {
    const a = await ready(context);
    const b = await ready(context);
    const start = requests.length;
    await Promise.all([a.locator('#latest').click(), b.locator('#latest').click()]);
    await Promise.all([a.locator('#listTitle').filter({ hasText: '최신' }).waitFor(), b.locator('#listTitle').filter({ hasText: '최신' }).waitFor()]);
    const calls = requests.slice(start).filter(row => row.params?.mode === 'latest');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].preferences.counter, calls[0].preferences.counter + 1);
  });
  await check('guest cannot access Worker/browser/Node capabilities; AES compatibility', async context => {
    const page = await ready(context);
    const result = await runGuest(page, `class DefaultExtension extends MProvider {
      getHeaders(){return {globals:[typeof globalThis.fetch,typeof postMessage,typeof localStorage,typeof process,typeof WebSocket],cipher:cryptoHandler('hello','1234567890123456','1234567890123456',true)};}
    }`);
    assert.equal(result.type, 'result');
    assert.deepEqual(result.value.result.globals, Array(5).fill('undefined'));
    const cipher = createCipheriv('aes-128-cbc', Buffer.from('1234567890123456'), Buffer.from('1234567890123456'));
    assert.equal(result.value.result.cipher, Buffer.concat([cipher.update('hello'), cipher.final()]).toString('base64'));
  });
  await check('infinite guest loop is interrupted without freezing UI', async context => {
    const page = await ready(context);
    const result = await runGuest(page, 'class DefaultExtension extends MProvider {getHeaders(){while(true){}}}', 'headers', 200);
    assert.deepEqual(result, {type:'failure',code:'execution_timeout'});
    assert.equal(await page.evaluate(() => 2 + 2), 4);
  });
  await check('generic HTTP sources extract chapter pages from HTML and JSON', async context => {
    const page = await ready(context);
    const expected = ['https://example.com/page-2.jpg', 'https://example.com/page-1.jpg'];
    for (const format of ['html', 'json']) {
      const body = format === 'html'
        ? '<html><body><img src="https://example.com/logo.jpg"><main>' + expected.map(url => `<img src="${url}">`).join('') + '</main></body></html>'
        : JSON.stringify({pages:expected});
      const source = `class DefaultExtension extends MProvider {
        async getPageList(){
          const response = await new Client().get('https://example.com/chapter');
          return ${format === 'html' ? "new Document(response.body).select('main img').map(image => image.attr('src'))" : 'JSON.parse(response.body).pages'};
        }
      }`;
      const result = await runGuest(page, source, 'pages', 3000, 200, {id:'fixture-http-source',itemType:0}, {
        contentType: format === 'html' ? 'text/html' : 'application/json', bytes:Buffer.from(body).toString('base64')
      });
      assert.equal(result.type, 'result');
      assert.deepEqual(result.value.result, expected.map(url => ({url,headers:{}})));
    }
  });
  await check('WebView calls fail explicitly without making HTTP requests', async context => {
    const page = await ready(context);
    for (const invocation of [
      "evaluateJavascriptViaWebview('https://example.com/chapter', {}, ['document.querySelectorAll(\"img\")'], 1000)",
      "sendMessage('evaluateJavascriptViaWebview', JSON.stringify(['https://example.com/chapter', {}, ['document.title'], 1000]))"
    ]) {
      const result = await runGuest(page, `class DefaultExtension extends MProvider {
        async getPageList(){return await ${invocation};}
      }`, 'pages');
      assert.deepEqual(result, {type:'failure',code:'source_browser_required'});
    }
  });
  await check('upstream HTTP denial retains its cause when guest JSON parsing fails', async context => {
    const page = await ready(context);
    const source = `class DefaultExtension extends MProvider {
      async getDetail(){ const response = await new Client().get('https://example.com/'); return JSON.parse(response.body); }
    }`;
    const result = await runGuest(page, source, 'detail', 3000, 403);
    assert.deepEqual(result, { type: 'failure', code: 'source_access_denied' });
    const normal = await runGuest(page, source, 'detail', 3000, 200);
    assert.deepEqual(normal, { type: 'failure', code: 'execution_failed' });
  });
  await check('cancellation terminates Worker and revokes relay without committing result', async context => {
    const page = await ready(context);
    const result = await page.evaluate(async () => {
      const { runBrowserSource } = await import('/source-runtime.js');
      const source = 'class DefaultExtension extends MProvider {getHeaders(){while(true){}}}';
      const codeDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const calls = [];
      const api = async path => {
        calls.push(path);
        return { source, codeDigest, action:'headers', entry:{id:'1'}, params:{}, preferences:{}, token:'fixture', timeoutMs:30000 };
      };
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 150);
      let error;
      try { await runBrowserSource({}, api, abort.signal); } catch (e) { error = e.name; }
      return {error,calls};
    });
    assert.equal(result.error, 'AbortError');
    assert.deepEqual(result.calls, ['/api/runtime/prepare', '/api/runtime/cancel']);
  });
  await check('Moya view preference and browser back restore source search and reading entry', async context => {
    generation = 2;
    const page = await ready(context);
    await page.getByLabel('탐색 보기 방식').selectOption('list');
    await page.locator('#query').fill('Fixture');
    await page.locator('#searchForm button').click();
    await page.locator('#listTitle').filter({ hasText: '검색 결과' }).waitFor();
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').first().click();
    await page.locator('#reader').waitFor();
    await page.locator('#back').click();
    await page.locator('#continueReading').filter({ hasText: '이어 읽기' }).waitFor();
    await page.goBack();
    await page.locator('#browse').waitFor();
    assert.equal(await page.locator('#query').inputValue(), 'Fixture');
    assert.equal(await page.locator('#works').getAttribute('data-view'), 'list');
    await page.goForward();
    await page.locator('#detail').waitFor();
    await page.locator('#continueReading').click();
    await page.locator('#reader').waitFor();
    await page.reload();
    await page.locator('#recentFeatured').waitFor();
    await page.locator('#sidebar .library-sidebar-list [data-nav=browse]').first().click();
    await page.locator('#works .card').first().waitFor();
    assert.equal(await page.getByLabel('탐색 보기 방식').inputValue(), 'list');
    await page.locator('#works .card').first().click();
    await page.locator('#continueReading').filter({ hasText: '이어 읽기' }).waitFor();
  });
  await check('original chapter panel searches, sorts and paginates without download controls', async context => {
    const page = await ready(context);
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').first().waitFor();
    assert.equal(await page.locator('#chapters .chapter').count(), 10);
    assert.match(await page.locator('#chapters .chapter').first().textContent(), /Chapter 1\b/);
    await page.getByLabel('회차 정렬').selectOption('desc');
    assert.match(await page.locator('#chapters .chapter').first().textContent(), /Chapter 25\b/);
    await page.getByLabel('회차 검색').fill('Chapter 24');
    await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length === 1);
    assert.match(await page.locator('#chapters .chapter').textContent(), /Chapter 24\b/);
    assert.equal(await page.getByText('이 페이지 선택', {exact: true}).count(), 0);
  });
  await check('desktop and mobile Moya shell keep settings reachable without horizontal overflow', async context => {
    const page = await ready(context);
    await mkdir('.state/ui', {recursive:true});
    await page.setViewportSize({width:1440,height:960});
    await page.screenshot({path:'.state/ui/desktop-browse.png',fullPage:true});
    await page.locator('#appHeader [data-settings=appearance]:visible, #readerSettingsButton:visible').click();
    await page.locator('#appTheme').selectOption('dark');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settingsDialog').isVisible(), false);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'.state/ui/mobile-browse.png',fullPage:true});
    await page.locator('#menuButton').click();
    await page.locator('#navigationDialog [data-settings=appearance]').click();
    assert.equal(await page.locator('#settingsDialog').isVisible(), true);
    await page.screenshot({path:'.state/ui/mobile-settings.png'});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'menuButton');
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok(await page.locator('.chapter-title').first().evaluate(node=>node.getBoundingClientRect().width) > 150);
    await page.screenshot({path:'.state/ui/mobile-detail.png',fullPage:true});
  });
  await check('source quick jump pins a tab and preserves it after reload', async context => {
    const page = await ready(context);
    await page.locator('#quickJump').click();
    await page.waitForTimeout(50);
    assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'INPUT');
    await page.getByLabel('이동할 소스 검색').fill('테스트 만화');
    await page.getByLabel('테스트 만화 탭에 고정').click();
    await page.getByLabel('빠른 이동 닫기').click();
    await page.reload();
    await page.locator('#recent:not([hidden])').waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('moya-source-pins')).length), 1);
    await page.locator('[data-nav=browse]:visible').first().click();
    await page.locator('#works .card').first().waitFor();
    await page.locator('#quickJump').click();
    assert.equal(await page.getByLabel('테스트 만화 고정 해제').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByLabel('이동할 소스 검색').count(), 0);
  });
  await check('original source options preserve saves and reject stale edits across tabs', async context => {
    const a = await ready(context), b = await ready(context);
    for (const page of [a, b]) {
      await page.locator('#appHeader [data-settings=sources]').click();
      await page.locator('#sourceCards .is-selected').getByRole('button',{name:'옵션',exact:true}).click();
      await page.getByLabel('테스트 옵션', {exact:true}).waitFor();
    }
    await a.getByLabel('테스트 옵션', {exact:true}).fill('first');
    await a.getByRole('button', {name:'설정 저장', exact:true}).click();
    await a.getByText('저장했습니다.', {exact:true}).waitFor();
    await b.getByLabel('테스트 옵션', {exact:true}).fill('second');
    await b.getByRole('button', {name:'설정 저장', exact:true}).click();
    await b.getByText('저장하지 못했습니다.', {exact:false}).waitFor();
    await b.keyboard.press('Escape');
    await b.locator('#appHeader [data-settings=sources]').click();
    await b.locator('#sourceCards .is-selected').getByRole('button',{name:'옵션',exact:true}).click();
    await b.waitForFunction(() => document.querySelector('#sourcePreferences input')?.value === 'first');
    await b.keyboard.press('Escape');
    const refreshed = b.waitForResponse('**/api/runtime/finish');
    await b.locator('#popular').click();
    await refreshed;
    assert.equal(requests.at(-1).preferences.fixtureOption, 'first');
  });
  await check('Moya comic spread, direction, seek, bookmarks and automatic reading retain position', async context => {
    generation = 2; fixturePageCount = 7;
    const page = await ready(context);
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#reader').waitFor();
    await page.waitForFunction(() => document.querySelector('.page.active img')?.naturalWidth > 0);
    await page.locator('#readerSettingsButton').click();
    await page.locator('#comicMode').selectOption('spread'); await page.locator('#comicCover').selectOption('pair');
    await page.locator('#comicDirection').selectOption('rtl'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.page.active').count(), 2);
    assert.equal(await page.locator('.page[data-page="2"]').evaluate(node => node.style.order), '0');
    await page.locator('#readerPage').fill('5'); await page.locator('#readerPage').dispatchEvent('change');
    await page.locator('#readerPage').press('ArrowLeft');
    assert.equal(await page.locator('#readerPage').inputValue(), '5');
    await page.locator('#pageBookmark').click();
    await page.locator('#readerPage').fill('1'); await page.locator('#readerPage').dispatchEvent('change');
    await page.locator('#readerSettingsButton').click(); await page.locator('#comicBookmarks').selectOption('5'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#readerPage').inputValue(), '5');
    await page.locator('#readerSettingsButton').click(); await page.locator('#comicMode').selectOption('single'); await page.keyboard.press('Escape');
    await page.locator('#readerPage').fill('1'); await page.locator('#readerPage').dispatchEvent('change');
    await page.locator('#readerAuto').click();
    await page.getByLabel('넘김 간격 직접 입력').fill('3'); await page.getByLabel('넘김 간격 직접 입력').press('Enter');
    await page.getByRole('button', {name:'시작', exact:true}).click();
    await page.waitForFunction(() => Number(document.getElementById('readerPage').value) > 1, null, {timeout:7000});
    await page.getByLabel('자동 읽기 일시정지').click();
    await page.screenshot({path:'.state/ui/comic-reader.png'});
    await page.locator('#back').click(); await page.locator('#continueReading').click();
    await page.waitForFunction(() => Number(document.getElementById('readerPage').value) > 1);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#readerSettingsButton').click();
    assert.equal(await page.locator('#comicMode').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.screenshot({path:'.state/ui/mobile-comic-reader.png'});
  });
  await check('novel uses original layout settings, search, percentage seek and resume', async context => {
    fixtureItemType = 2;
    const page = await ready(context);
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#novelText [data-paragraph-id]').first().waitFor();
    await page.locator('#readerSettingsButton').click();
    await page.getByLabel('크기 직접 입력', {exact:true}).fill('24'); await page.getByLabel('크기 직접 입력', {exact:true}).press('Enter');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#novelText').evaluate(node => getComputedStyle(node).fontSize), '24px');
    await page.locator('#readerSearchToggle').click();
    await page.locator('#novelSearch').fill('바다'); await page.locator('#novelSearchForm button').click();
    assert.match(await page.locator('#novelSearchStatus').textContent(), /1 \/ 80/);
    await page.locator('#novelSeek').evaluate(node => { node.value = '600'; node.dispatchEvent(new Event('input', {bubbles:true})); });
    await page.waitForFunction(() => Math.abs(Number(document.getElementById('novelSeek').value)-600)<20);
    await page.locator('#back').click(); await page.locator('#continueReading').click();
    await page.waitForFunction(() => Math.abs(Number(document.getElementById('novelSeek').value)-600)<20);
    assert.equal(await page.locator('#novelText').evaluate(node => getComputedStyle(node).fontSize), '24px');
    assert.equal(await page.locator('#novelSearchToolbar').isVisible(),false);
    await page.screenshot({path:'.state/ui/novel-reader.png'});
    const firstVisibleParagraph = () => page.evaluate(() => [...document.querySelectorAll('#novelText [data-paragraph-id]')].find(node => node.getBoundingClientRect().bottom > document.querySelector('#novelText .reader-scroll').getBoundingClientRect().top + parseFloat(getComputedStyle(document.querySelector('#novelText .reader-scroll')).paddingTop))?.dataset.paragraphId);
    await page.locator('#novelText .reader-scroll[aria-busy=false]').waitFor();
    const readingParagraph = await firstVisibleParagraph();
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(id => [...document.querySelectorAll('#novelText [data-paragraph-id]')].find(node => node.getBoundingClientRect().bottom > document.querySelector('#novelText .reader-scroll').getBoundingClientRect().top + parseFloat(getComputedStyle(document.querySelector('#novelText .reader-scroll')).paddingTop))?.dataset.paragraphId === id, readingParagraph);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#readerSettingsButton').click();
    assert.equal(await page.locator('#novelFont').isVisible(), true);
    // Native Escape restores focus before the queued close handler restores it again.
    // Arm the listener first and wait for that handler before sending a reader shortcut.
    await page.evaluate(() => {
      window.__settingsClosed = false;
      document.getElementById('settingsDialog').addEventListener('close', () => { window.__settingsClosed = true; }, {once:true});
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__settingsClosed);
    await page.evaluate(()=>document.activeElement?.blur()); await page.keyboard.press('i');
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('immersive')), true);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('#novelText .reader-scroll[aria-busy=false]').waitFor();
    await page.mouse.click(195, 400);
    await page.waitForFunction(()=>!document.body.classList.contains('immersive'));
    await page.screenshot({path:'.state/ui/mobile-novel-reader.png'});
  });
  await check('novel position stays with its original source when switching before the save debounce', async context => {
    fixtureItemType = 2;
    const page = await ready(context);
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#novelText [data-paragraph-id]').first().waitFor();
    await page.locator('#appHeader [data-settings=appearance]:visible, #readerSettingsButton:visible').click();
    await page.locator('#settingsDialog [data-settings=sources]').click();
    // Same task: seek and switch before the 250ms save can fire.
    await page.evaluate(() => {
      const seek = document.getElementById('novelSeek'); seek.value='600';seek.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('#sourceCards .source-card')].find(node=>node.textContent.includes('다른 소스')).querySelector('button').click();
    });
    await page.waitForFunction(()=>document.getElementById('sourceName').textContent==='다른 소스'&&!document.getElementById('browse').hidden);
    // Navigation can finish before the queued IDB position write commits.
    await page.waitForFunction(() => new Promise(resolve => {
      const request=indexedDB.open('moya-source-lite',2);
      request.onsuccess=()=>{const db=request.result,read=db.transaction('progress').objectStore('progress').getAll();read.onsuccess=()=>{db.close();resolve(read.result.some(value=>Math.abs(value.ratio-.6)<.02));};};
    }));
    const progress = await page.evaluate(async () => new Promise(resolve => {
      const request=indexedDB.open('moya-source-lite',2);
      request.onsuccess=()=>{const tx=request.result.transaction('progress'),store=tx.objectStore('progress'),keys=store.getAllKeys(),values=store.getAll();
        tx.oncomplete=()=>resolve(keys.result.map((key,i)=>({key,ratio:values.result[i].ratio})));};
    }));
    assert.equal(progress.length,1);
    assert.equal(progress[0].key.split('\n')[1],sourceId);
    assert.ok(Math.abs(progress[0].ratio-.6)<.02);
  });
  await check('novel original pagination turns on blank margins, handles long paragraphs and disables accidental selection', async context => {
    fixtureItemType=2;
    const page=await ready(context);await page.setViewportSize({width:390,height:844});
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.locator('#novelText .reader-paragraph').first().waitFor();
    await page.locator('#readerSettingsButton').click();
    await page.getByRole('button',{name:'페이지',exact:true}).click();await page.keyboard.press('Escape');
    await page.locator('.reader-paginated-root.is-active .reader-paragraph').first().waitFor();
    const content=()=>page.locator('.reader-paginated-root.is-active .reader-paginated-page.is-current').first().textContent();
    const before=await content();await page.mouse.click(385,250);
    await page.waitForFunction(before=>document.querySelector('.reader-paginated-root.is-active .reader-paginated-page.is-current')?.textContent!==before,before);
    await page.waitForFunction(()=>{const paragraph=document.querySelector('.reader-paginated-root.is-active .reader-paragraph');return paragraph && getComputedStyle(paragraph).userSelect==='none';});
    await page.mouse.move(60,250);await page.mouse.down();await page.mouse.move(200,260,{steps:10});await page.mouse.up();
    assert.equal(await page.evaluate(()=>getSelection().toString()),'');
    await page.screenshot({path:'.state/ui/novel-pagination-mobile.png'});
    await page.locator('#readerSettingsButton').click();
    await page.getByRole('button',{name:'두 쪽',exact:true}).click();await page.keyboard.press('Escape');
    await page.setViewportSize({width:1280,height:900});
    await page.locator('.reader-paginated-root.is-active.is-spread').waitFor();
    await page.screenshot({path:'.state/ui/novel-pagination-spread.png'});
  });
  await check('novel long paragraph pagination, notes, custom fonts and reload keep text anchors', async context => {
    fixtureItemType=2;novelText=Array.from({length:600},(_,i)=>`긴 문장의 ${i+1}번째 위치입니다.`).join(' ');
    const page=await ready(context);await page.setViewportSize({width:390,height:844});
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.locator('#novelText .reader-paragraph').first().waitFor();
    const settings=async()=>page.locator('#readerSettingsButton').click();
    await settings();await page.getByRole('button',{name:'페이지',exact:true}).click();await page.keyboard.press('Escape');
    const active='.reader-paginated-root.is-active .reader-paginated-page.is-current';
    await page.locator(active+' .reader-paragraph').first().waitFor();
    const first=await page.locator(active).first().textContent();
    for(let i=0;i<3;i++){const before=await page.locator(active).first().textContent();await page.mouse.click(385,200);await page.waitForFunction(({active,before})=>document.querySelector(active)?.textContent!==before,{active,before});}
    const beforeFont=await page.locator(active).first().textContent();assert.notEqual(beforeFont,first);
    await settings();await page.locator('#novelBookmark').click();await page.locator('#novelPerWork').check();
    await page.locator('#novelFontUpload').setInputFiles('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
    await page.waitForFunction(()=>document.getElementById('novelFontStatus').textContent.includes('저장했습니다'));
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#novelText').evaluate(n=>n.style.getPropertyValue('--reading-font-family').includes('NovelDesk User')));
    await settings();await page.locator('#novelSelect').click();
    await page.evaluate(()=>{const node=document.querySelector('.reader-paginated-root.is-active [data-reader-text]');const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));});
    await page.getByLabel('노랑 하이라이트',{exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.reader-paginated-root.is-active .reader-inline-highlight'));
    await page.locator('#novelSelectionDone').click();
    await settings();await page.locator('#novelNotes').click();
    assert.equal(await page.locator('#novelNotesList li').count(),2);
    await page.goBack();await page.waitForFunction(()=>!document.getElementById('novelNotesDialog').open);
    assert.equal(await page.locator('#settingsDialog').isVisible(),true);
    await page.goBack();await page.waitForFunction(()=>!document.getElementById('settingsDialog').open);
    assert.equal(await page.locator('#reader').isVisible(),true);
    await page.locator('#back').click();await page.locator('#continueReading').click();
    await page.locator(active+' .reader-paragraph').first().waitFor();
    assert.notEqual(await page.locator(active).first().textContent(),first);
    await page.reload();await page.locator('#recent').waitFor();await page.locator('[data-nav=browse]:visible').first().click();await page.locator('#works .card').first().waitFor();
    await page.locator('#works .card').first().click();await page.locator('#continueReading').click();
    await page.locator(active+' .reader-paragraph').first().waitFor();
    assert.notEqual(await page.locator(active).first().textContent(),first);
    assert.ok(await page.locator('#novelText').evaluate(n=>n.style.getPropertyValue('--reading-font-family').includes('NovelDesk User')));
  });
  await check('novel automatic flow, search offsets, automatic pages and chapter boundaries work', async context=>{
    fixtureItemType=2;const page=await ready(context);await page.setViewportSize({width:390,height:844});
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.locator('#novelText .reader-paragraph').first().waitFor();
    await page.mouse.click(385,250);await page.locator('.reader-paginated-root.is-active .reader-paragraph').first().waitFor();
    await page.mouse.move(195,300);await page.mouse.wheel(0,200);
    await page.locator('.reader-scroll.is-active:not(.reader-paginated-root)').waitFor();
    await page.locator('#readerSettingsButton').click();await page.getByRole('button',{name:'페이지',exact:true}).click();await page.keyboard.press('Escape');
    await page.locator('.reader-paginated-root.is-active .reader-paragraph').first().waitFor();
    await page.locator('#readerSearchToggle').click();await page.locator('#novelSearch').fill('문단 60.');await page.locator('#novelSearchForm button').click();
    await page.waitForFunction(()=>document.querySelector('.reader-paginated-root.is-active .reader-paginated-page.is-current')?.textContent.includes('문단 60.'));
    await page.locator('#readerSearchToggle').click();
    await page.locator('#readerAuto').click();await page.getByLabel('넘김 간격 직접 입력').fill('3');await page.getByLabel('넘김 간격 직접 입력').press('Enter');
    const before=await page.locator('.reader-paginated-root.is-active .reader-paginated-page.is-current').first().textContent();
    await page.getByRole('button',{name:'시작',exact:true}).click();
    await page.waitForFunction(before=>document.querySelector('.reader-paginated-root.is-active .reader-paginated-page.is-current')?.textContent!==before,before,{timeout:7000});
    await page.getByLabel('자동 읽기 일시정지').click();
    const title=await page.locator('#readerChapterTitle').textContent();
    await page.locator('#novelSeek').evaluate(n=>{n.value='1000';n.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>document.getElementById('readerProgress').textContent.includes('100%'));
    await page.keyboard.press('PageDown');await page.waitForFunction(title=>document.getElementById('readerChapterTitle').textContent!==title,title);
    await page.locator('.reader-paginated-root.is-active .reader-paragraph').first().waitFor();
  });
  await check('comic rotation, manual crop, thumbnails and browser back preserve reader', async context=>{
    generation=2;fixturePageCount=7;const page=await ready(context);
    await page.route('**/fixture/image?*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="white"/><rect x="60" y="90" width="480" height="720" fill="#479"/></svg>'}));
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.waitForFunction(()=>document.querySelector('.page.active img')?.naturalWidth===600);
    await page.locator('#readerSettingsButton').click();
    await page.locator('#comicRotation').selectOption('90');await page.locator('#comicCrop').selectOption('manual');
    await page.getByLabel('위 여백 직접 입력',{exact:true}).fill('10');await page.getByLabel('위 여백 직접 입력',{exact:true}).press('Enter');
    assert.match(await page.locator('.page.active img').getAttribute('style'),/rotate\(90deg\)/);
    assert.match(await page.locator('.page.active img').getAttribute('style'),/inset\(10%/);
    await page.locator('#comicThumbnails').click();await page.locator('#comicThumbnailGrid img').first().waitFor();
    await page.locator('.comic-thumbnail').nth(3).click();
    await page.waitForFunction(()=>document.getElementById('readerPage').value==='4');
    assert.equal(await page.locator('#reader').isVisible(),true);
    await page.locator('#readerSettingsButton').click();await page.goBack();
    await page.waitForFunction(()=>!document.getElementById('settingsDialog').open);
    assert.equal(await page.locator('#readerPage').inputValue(),'4');
  });
  await check('comic wide standalone spread fills the viewport', async context => {
    generation = 2; fixturePageCount=7;
    const page=await ready(context);
    await page.route('**/fixture/image?*', route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="600"><rect width="1400" height="600" fill="#479"/></svg>'}));
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.waitForFunction(()=>document.querySelector('#pages img')?.naturalWidth===1400);
    await page.locator('#readerSettingsButton').click();
    await page.locator('#comicMode').selectOption('spread');await page.keyboard.press('Escape');
    const geometry = await page.evaluate(()=>{const root=document.getElementById('pages'),row=root.querySelector('.page.active'),img=row.querySelector('img');return {root:root.clientWidth,row:row.clientWidth,image:img.getBoundingClientRect().width};});
    assert.ok(Math.abs(geometry.root-geometry.row)<2);
    assert.ok(geometry.image>geometry.root*.9);
    await page.screenshot({path:'.state/ux-review/comic-wide-spread-fixed.png'});
  });
  await check('compact reader chrome and seamless image boundaries fit mobile at fractional scales', async context => {
    fixturePageCount=4;
    const page=await ready(context);
    await page.route('**/fixture/image?*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="733" height="1001"><rect width="733" height="1001" fill="white"/></svg>'}));
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#readerSettingsButton').click(); await page.locator('#comicMode').selectOption('continuous-seamless'); await page.keyboard.press('Escape');
    const cdp=await context.newCDPSession(page);
    for(const [width,dpr] of [[390,1],[393,2.625],[320,2]]) {
      await page.setViewportSize({width,height:844});
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:dpr,mobile:true});
      await page.waitForFunction(()=>[...document.querySelectorAll('#pages .page img')].slice(0,2).every(img=>img.naturalWidth>0));
      await page.evaluate(()=>{const img=document.querySelector('#pages .page img');scrollTo(0,img.getBoundingClientRect().bottom+scrollY-400);});
      await page.waitForTimeout(100);
      const geometry=await page.evaluate(()=>{
        const images=[...document.querySelectorAll('#pages .page img')].slice(0,2).map(img=>{const r=img.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
        return {images,height:document.querySelector('.reader-bottombar').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.equal(geometry.overflow,false);assert.ok(geometry.height<=52,JSON.stringify(geometry));
      assert.ok(geometry.images[0].bottom-geometry.images[1].top>=.9,JSON.stringify(geometry));
      const screenshot=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');
      await writeFile(`.state/ux-review/seamless-${width}.png`,screenshot);
      const pixels=await page.evaluate(async ({png,y,dpr,width})=>{
        const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}));
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
        return [...ctx.getImageData(Math.round(width*dpr/2),Math.round(y*dpr)-3,1,7).data];
      },{png:screenshot.toString('base64'),y:geometry.images[1].top,dpr,width});
      assert.ok(pixels.every((value,index)=>index%4===3||value>245),`No dark raster seam between white pages: ${JSON.stringify({geometry,pixels,width,dpr})}`);
    }
    assert.equal(await page.locator('#readerImmersive').count(),0);
    assert.equal(await page.locator('.reader-bottombar button').count(),2);
    await page.locator('#pageBookmark').click();assert.equal(await page.locator('#pageBookmark').getAttribute('aria-pressed'),'true');
    await page.locator('#readerAuto').click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
    await page.locator('#readerSettingsButton').click(); await page.locator('#comicMode').selectOption('continuous');await page.keyboard.press('Escape');
    assert.equal(await page.locator('#pages .page').nth(1).evaluate(node=>getComputedStyle(node).marginTop),'0px');
  });
  await check('mobile paged reader centers images through immersive, browser-height and orientation changes', async context => {
    generation=2; fixturePageCount=7;
    const page=await ready(context); await page.setViewportSize({width:390,height:844});
    await page.route('**/fixture/image?*', route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100"><rect width="800" height="1100" fill="#579"/></svg>'}));
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.waitForFunction(()=>document.querySelector('#pages .page.active img')?.naturalWidth===800);
    const centered=async()=>{
      await page.waitForFunction(()=>{
        const stage=document.getElementById('pages').getBoundingClientRect(), image=document.querySelector('#pages .page.active img').getBoundingClientRect();
        return Math.abs(stage.x+stage.width/2-image.x-image.width/2)<2&&Math.abs(stage.y+stage.height/2-image.y-image.height/2)<2&&image.bottom<=stage.bottom+1;
      });
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    };
    await centered();await page.evaluate(()=>document.activeElement?.blur()); await page.keyboard.press('i');await centered();
    await page.screenshot({path:'.state/ux-review/mobile-centered-immersive.png'});
    for(const size of [{width:390,height:660},{width:844,height:390},{width:390,height:844}]) {await page.setViewportSize(size);await centered();}
    // Blank space above a short fitted page is also a reading input surface.
    await page.mouse.click(195,10);
    assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('immersive')),false);
    await centered();
  });
  await check('recent covers survive missing detail covers, source changes and reload with expired remote images', async context => {
    generation=2;
    await context.route('**/fixture/cover',route=>route.fulfill({contentType:'image/png',body:png}));
    await context.route('**/api/runtime/finish',async route=>{
      const response=await route.fetch(),value=await response.json();
      if(route.request().postDataJSON().token==='list') {
        const source=await route.request().frame().evaluate(()=>JSON.parse(localStorage.getItem('moya-source-selection')).sourceId);
        value.result.list[0].name=`List ${source}`; value.result.list[0].imageUrl='/fixture/cover';
      }
      await route.fulfill({response,json:value});
    });
    const page=await ready(context);
    await page.locator('#works .card').first().click();
    await page.waitForFunction(()=>document.querySelector('#workInfo img')?.naturalWidth===1);
    await page.waitForFunction(async()=>Boolean(await (await import('/cover-cache.js')).readCover('https://repository.example/index.json\n100000000000001\nhttps://example.com/work')));
    await page.locator('#chapters .chapter').first().click();await page.locator('#pages img').first().waitFor();
    await page.locator('#appHeader [data-settings=appearance]:visible, #readerSettingsButton:visible').click();await page.locator('#settingsDialog [data-settings=sources]').click();
    await page.locator('#sourceCards .source-card').filter({hasText:'다른 소스'}).getByRole('button',{name:'탐색하기'}).click();
    await page.locator('#works .card').first().filter({hasText:'List second-source'}).waitFor();
    await page.locator('#sidebar [data-nav=recent]').click();
    await page.waitForFunction(()=>document.querySelector('#recentFeatured img')?.naturalWidth===1);
    await page.locator('#recentFeatured .primary-btn').click();await page.locator('#reader').waitFor();
    await page.locator('#appHeader [data-settings=appearance]:visible, #readerSettingsButton:visible').click();await page.keyboard.press('Escape');
    // Return to recent, then browse: the previous B list must not appear under source A.
    await page.evaluate(()=>document.querySelector('#sidebar [data-nav="recent"]').click());
    await page.locator('#sidebar [data-nav=browse]').first().click();
    await page.locator('#works .card').first().filter({hasText:`List ${sourceId}`}).waitFor();
    assert.equal(await page.locator('#sourceName').textContent(),'테스트 만화');
    await page.route('**/fixture/cover',route=>route.fulfill({status:410,body:'expired'}));
    await page.reload();await page.locator('#recent').waitFor();
    await page.waitForFunction(()=>document.querySelector('#recentFeatured img')?.naturalWidth===1);
    assert.match(await page.locator('#recentFeatured img').getAttribute('src'),/^blob:/);
  });
  await check('reader mode and zoom persist across books and reload', async context => {
    generation = 2; fixturePageCount = 7;
    const page = await ready(context);
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#readerSettingsButton').first().click();
    await page.locator('#comicMode').selectOption('continuous-seamless');
    await page.locator('#comicDirection').selectOption('rtl');
    await page.locator('#readerZoomIn').click();
    await page.keyboard.press('Escape'); await page.reload();
    await page.locator('#recentFeatured').waitFor();
    await page.locator('#sidebar .library-sidebar-list [data-nav=browse]').first().click();
    await page.locator('#works .card').nth(1).click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#reader').waitFor();
    assert.equal(await page.locator('#pages').getAttribute('data-comic-mode'),'continuous-seamless');
    await page.locator('#readerSettingsButton').first().click();
    assert.equal(await page.locator('#comicDirection').inputValue(),'rtl');
    assert.equal(await page.locator('#readerZoom').textContent(),'110%');
  });
  await check('detail shows supplied metadata and read-through state survives reload and unread reset', async context => {
    const page = await ready(context);
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').first().waitFor();
    assert.match(await page.locator('#workMetadata').textContent(),/테스트 작가.*테스트 그림.*연재 중.*판타지 · 모험/s);
    await page.getByLabel('Chapter 3 더보기', {exact:true}).click();
    await page.getByRole('menuitem',{name:'여기까지 읽음',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.chapter-row.is-read').length === 3);
    assert.equal(await page.locator('#continueReading').textContent(),'4화부터 읽기');
    await page.reload(); await page.locator('#recent:not([hidden])').waitFor(); await page.locator('[data-nav=browse]:visible').first().click(); await page.locator('#works .card').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.chapter-row.is-read').length === 3);
    await page.getByLabel('Chapter 2 더보기', {exact:true}).click();
    await page.getByRole('menuitem',{name:'안 읽음으로 변경',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.chapter-row.is-read').length === 2);
    await page.setViewportSize({width:390,height:844});
    await page.getByLabel('Chapter 3 더보기',{exact:true}).click();
    await page.screenshot({path:'.state/ux-review/detail-actions-mobile.png'});
  });
  await check('recent reading is a separate library home with resume and sources are managed explicitly', async context => {
    generation = 2;
    const page = await ready(context);
    await page.locator('#works .card').first().click(); await page.locator('#chapters .chapter').first().click();
    await page.locator('#reader').waitFor();
    await page.locator('#back').click();
    await page.locator('#sidebar .library-sidebar-list [data-nav=recent]').click();
    await page.locator('#recentFeatured').waitFor();
    assert.equal(await page.locator('#browse').isVisible(),false);
    assert.equal(await page.locator('#recentWorks .history-card').count(),1);
    await page.locator('#recentFeatured .primary-btn').click(); await page.locator('#reader').waitFor();
    await page.locator('#back').click();
    await page.locator('#appHeader [data-settings=appearance]:visible, #readerSettingsButton:visible').click();
    await page.locator('.settings-tabs [data-settings=sources]').click();
    await page.locator('#manageRepositories').click();
    await page.locator('#addRepository summary').click();
    await page.locator('#repositoryUrl').fill('https://extensions.example.test/index.json');
    await page.locator('#repositoryForm button').click();
    await page.waitForFunction(() => document.querySelector('#repositorySelect').value.includes('extensions.example.test'));
    assert.match(await page.locator('#sourceName').textContent(),/테스트 만화/);
    await page.locator('#sourceSearch').fill('다른');
    assert.equal(await page.locator('#sourceCards .source-card').count(),1);
    await page.locator('#sourceCards').getByRole('button',{name:'탐색하기',exact:true}).click();
    await page.locator('#browse').waitFor();
    assert.equal(await page.locator('#settingsDialog').isVisible(),false);
    assert.equal(await page.locator('#browseSourceName').textContent(),'다른 소스');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#mobileTabs [data-nav=recent]').click();
    await page.screenshot({path:'.state/ux-review/recent-mobile.png'});
    await page.locator('#recentFeatured .primary-btn').click(); await page.locator('#reader').waitFor();
    assert.equal(await page.locator('#sourceName').textContent(),'테스트 만화');
  });
  await check('long browse list restores its scroll position after detail and a settings layer', async context=>{
    const page=await ready(context);
    await page.route('**/api/runtime/finish',async route=>{const response=await route.fetch();const value=await response.json();if(route.request().postDataJSON().token==='list')value.result={list:Array.from({length:100},(_,i)=>({name:`작품 ${i+1}`,link:`https://example.com/work/${i+1}`,imageUrl:'/fixture/image?bulk='+i})),hasNextPage:false};await route.fulfill({response,json:value});});
    await page.locator('#refreshList').click();await page.waitForFunction(()=>document.querySelectorAll('#works .card').length===100);
    await page.locator('#works .card').nth(70).scrollIntoViewIfNeeded();const position=await page.evaluate(()=>scrollY);
    await page.locator('#works .card').nth(70).click();await page.locator('#detail').waitFor();await page.locator('#back').click();
    await page.waitForFunction(y=>Math.abs(scrollY-y)<5,position);
    await page.locator('#appHeader [data-settings=appearance]:visible, #readerSettingsButton:visible').click();await page.goBack();await page.waitForFunction(()=>!document.getElementById('settingsDialog').open);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-position)<5);
  });
  await check('loading is visible and mobile screens fit at narrow and landscape sizes', async context => {
    const page = await ready(context);
    await page.route('**/api/runtime/finish', async route => { await new Promise(resolve=>setTimeout(resolve,400)); await route.continue(); });
    await page.locator('#latest').click();
    await page.locator('#loadingStatus').waitFor();
    assert.match(await page.locator('#loadingMessage').textContent(),/불러오는 중/);
    await page.locator('#loadingStatus').waitFor({state:'hidden'});
    for (const size of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(size);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      await page.locator('#mobileTabs [data-settings=sources]').isVisible().then(async visible => {
        if (visible) await page.locator('#mobileTabs [data-settings=sources]').click();
        else await page.locator('#appHeader [data-settings=sources]').click();
      });
      assert.equal(await page.locator('#settingsDialog').evaluate(node=>node.scrollWidth <= node.clientWidth),true);
      await page.screenshot({path:`.state/ux-review/sources-${size.width}.png`});
      await page.keyboard.press('Escape');
    }
  });
  await check('browse appends deduplicated pages, keeps cards and scroll, retries inline and resets on search', async context => {
    const page = await context.newPage(); let batch=0, rejectNext=false;
    await page.route('**/api/runtime/finish', async route => {
      const response = await route.fetch(); const data=await response.json();
      if (route.request().postDataJSON().token === 'list') {
        if (rejectNext) { rejectNext=false; return route.fulfill({status:503,json:{error:'source_failed'}}); }
        const offset=batch++*29;
        data.result={...data.result,list:Array.from({length:30},(_,i)=>({name:`작품 ${offset+i}`,link:`https://example.com/work/${offset+i}`})),hasNextPage:batch<3};
      }
      await route.fulfill({response,json:data});
    });
    await page.goto(base); await page.locator('#recent:not([hidden])').waitFor(); await page.locator('[data-nav=browse]:visible').first().click(); await page.locator('#works .card').first().waitFor();
    await page.locator('#loadMore').scrollIntoViewIfNeeded();
    await page.evaluate(()=>{window.firstCard=document.querySelector('#works .card'); window.listScroll=scrollY;});
    await page.locator('#loadMore').click();
    await page.waitForFunction(()=>document.querySelectorAll('#works .card').length===59);
    assert.equal(await page.evaluate(()=>window.firstCard===document.querySelector('#works .card')),true);
    assert.ok(await page.evaluate(()=>Math.abs(scrollY-window.listScroll)<10));
    rejectNext=true; await page.locator('#loadMore').click();
    await page.locator('#loadMoreStatus').filter({hasText:'다시'}).waitFor();
    assert.equal(await page.locator('#works .card').count(),59);
    await page.locator('#loadMore').click(); await page.waitForFunction(()=>document.querySelectorAll('#works .card').length===88);
    assert.equal(await page.locator('#loadMore').isVisible(),false);
    await page.locator('#works .card').last().click();await page.locator('#detail').waitFor();await page.goBack();
    await page.waitForFunction(()=>document.querySelectorAll('#works .card').length===88);
    await page.locator('#query').fill('새 검색');await page.locator('#searchForm button').click();
    await page.locator('#listTitle').filter({hasText:'검색 결과'}).waitFor();assert.equal(await page.locator('#works .card').count(),30);
  });
  await check('novel cached resume tolerates resizing while the saved position opens', async context => {
    fixtureItemType=2;const page=await ready(context);
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.locator('#novelText .reader-scroll[aria-busy=false]').waitFor();
    await page.locator('#novelSeek').evaluate(node=>{node.value='600';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>Math.abs(Number(document.querySelector('#novelSeek').value)-600)<20);
    await page.locator('#back').click();await page.locator('#continueReading').click();
    await page.locator('#novelText .reader-scroll').waitFor();
    for(const width of [500,390,420]) {await page.setViewportSize({width,height:844});await page.evaluate(()=>new Promise(requestAnimationFrame));}
    await page.locator('#novelText .reader-scroll[aria-busy=false]').waitFor();
    assert.equal(await page.locator('.reader-opening[role=alert]').count(),0);
    assert.ok(Math.abs(Number(await page.locator('#novelSeek').inputValue())-600)<30);
  });
  await check('recent removal is source scoped and preserves saved reading progress', async context => {
    generation=2;const page=await ready(context);
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();await page.locator('#reader').waitFor();
    await page.evaluate(()=>{
      const key=Object.keys(localStorage).find(key=>key.startsWith('moya-source-recent:'));
      localStorage.setItem(key.replace('100000000000001','second-source'),localStorage.getItem(key));
      localStorage.setItem('moya-comic-settings','{"mode":"single"}');
    });
    await page.reload();await page.locator('#recentWorks .history-card').first().waitFor();
    assert.equal(await page.locator('#recentWorks .history-card').count(),2);
    await page.locator('#recentWorks .history-remove').first().click();
    assert.equal(await page.locator('#recentWorks .history-card').count(),1);
    assert.equal(await page.locator('#reader').isVisible(),false);
    assert.ok(await page.evaluate(()=>localStorage.getItem('moya-comic-settings')));
    const progress=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('moya-source-lite',2);r.onsuccess=()=>{const q=r.result.transaction('progress').objectStore('progress').getAll();q.onsuccess=()=>resolve(q.result);};}));
    assert.ok(progress.length>0);
    await page.locator('#recentFeatured .history-remove').click();assert.equal(await page.locator('#recentWorks .history-card').count(),0);
    await page.reload();await page.locator('#recent:not([hidden])').waitFor();
  });
  await check('download settings persist, stop speculation, enforce cache limits and preserve reading data', async context => {
    const page = await ready(context);
    await page.locator('#works .card').first().click();
    await page.locator('#chapters .chapter').nth(1).click();
    await page.locator('#reader').waitFor();
    await page.locator('#readerSettingsButton').click();
    await page.locator('.settings-tabs [data-settings="downloads"]').click();
    await page.locator('#downloadPrefetch').uncheck();
    assert.equal(await page.locator('#downloadPages').isDisabled(),true);
    const before = requests.length;
    await page.waitForTimeout(1800);
    assert.equal(requests.length,before,'disabled speculation sends no chapter requests');
    await page.locator('#downloadPrefetch').check();
    await page.locator('#downloadPages').selectOption('16');
    await page.locator('#downloadPrefetch').uncheck();
    await page.evaluate(async () => {
      const {localCache} = await import('/local-cache.js');
      const cache=localCache('download-test'), value='x'.repeat(9*1024*1024);
      await cache.set('a',value,Date.now()+60000);await cache.set('b',value,Date.now()+60000);
    });
    await page.locator('#downloadCacheSize').selectOption('16');
    await page.waitForFunction(()=>document.getElementById('downloadStatus').textContent.includes('저장했습니다'));
    const count=await page.evaluate(async()=>(await(await import('/local-cache.js')).localCache('download-test').all()).length);
    assert.equal(count,1,'reducing capacity evicts older cache entries immediately');
    const saved=await page.evaluate(async()=>{
      const {localStorage:s,indexedDB}=await import('/account-storage.js');
      const recent=Object.keys(s).filter(key=>key.startsWith('moya-source-recent:')).map(key=>[key,s.getItem(key)]);
      const db=await new Promise(resolve=>{const r=indexedDB.open('moya-source-lite',2);r.onsuccess=()=>resolve(r.result);});
      const progress=await new Promise(resolve=>{const r=db.transaction('progress').objectStore('progress').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
      return {recent,progress};
    });
    await page.locator('#downloadClear').click();
    await page.waitForFunction(()=>document.getElementById('downloadStatus').textContent.includes('캐시를 비웠습니다'));
    assert.equal(await page.evaluate(async()=>(await(await import('/local-cache.js')).localCache('download-test').all()).length),0);
    const after=await page.evaluate(async()=>{
      const {localStorage:s,indexedDB}=await import('/account-storage.js');
      const recent=Object.keys(s).filter(key=>key.startsWith('moya-source-recent:')).map(key=>[key,s.getItem(key)]);
      const db=await new Promise(resolve=>{const r=indexedDB.open('moya-source-lite',2);r.onsuccess=()=>resolve(r.result);});
      const progress=await new Promise(resolve=>{const r=db.transaction('progress').objectStore('progress').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
      return {recent,progress};
    });
    assert.deepEqual(after,saved);
    await page.reload();await page.locator('#recent').waitFor();
    await page.locator('.library-action[data-settings="appearance"]').click();
    await page.locator('.settings-tabs [data-settings="downloads"]').click();
    assert.equal(await page.locator('#downloadPrefetch').isChecked(),false);
    assert.equal(await page.locator('#downloadPages').inputValue(),'16');
    assert.equal(await page.locator('#downloadCacheSize').inputValue(),'16');
    await page.locator('#downloadCacheSize').selectOption('128');
    assert.equal(await page.evaluate(async()=>(await import('/download-settings.js')).downloadSettings().cacheMiB),128);
    await page.reload();await page.locator('#recent').waitFor();
    assert.equal(await page.evaluate(async()=>(await import('/download-settings.js')).downloadSettings().cacheMiB),128);
    await page.locator('.library-action[data-settings="appearance"]').click();
    await page.locator('.settings-tabs [data-settings="downloads"]').click();
    assert.equal(await page.locator('#downloadCacheSize').inputValue(),'128');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'.state/download-settings-mobile.png'});
  });
  await check('recent warms browse and resume without navigation; next chapter reuses prepared content', async context => {
    await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>true}));
    generation=2;const page=await ready(context);
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').nth(1).click();await page.locator('#reader').waitFor();
    await page.evaluate(async()=>(await import('/account-storage.js')).localStorage.removeItem('moya-source-selection'));
    await page.reload();await page.locator('#recent').waitFor();
    const warmedChapter=async()=>{
      const response=await page.waitForResponse(r=>r.url().endsWith('/api/runtime/finish')&&r.request().postDataJSON().token==='pages');
      const {result}=await response.json();
      // Image prefetch starts after the chapter result is cached. Wait for that
      // observable completion instead of assuming the worker finishes in 800 ms.
      await page.waitForFunction(url=>performance.getEntriesByName(new URL(url,location.href).href).some(entry=>entry.responseEnd>0),result[0].imageUrl);
      return requests.filter(row=>row.action==='pages').at(-1).params.chapterUrl;
    };
    const resumedChapter=await warmedChapter();
    assert.equal(await page.locator('#recent').isVisible(),true);
    assert.equal(await page.locator('#loadingStatus').isVisible(),false);
    const before=requests.length;
    const nextPrepared=warmedChapter();
    await page.locator('#recentFeatured .primary-btn').click();await page.locator('#reader').waitFor();
    assert.equal(requests.slice(before).filter(row=>row.action==='detail'||row.action==='pages'&&row.params.chapterUrl===resumedChapter).length,0,'resume reuses both detail and chapter');
    const nextChapter=await nextPrepared;
    const afterWarm=requests.length;const chapterTitle=await page.locator('#readerChapterTitle').textContent();await page.locator('#nextChapter').click();await page.waitForFunction(title=>document.querySelector('#readerChapterTitle').textContent!==title,chapterTitle);await page.locator('#reader').waitFor();
    assert.equal(requests.slice(afterWarm).filter(row=>row.action==='pages'&&row.params.chapterUrl===nextChapter).length,0,'next chapter reuses prepared result');
  });
  await check('foreground navigation cancels slow speculation without stale screens or errors', async context => {
    await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>true}));
    generation=2;const page=await ready(context);
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').nth(1).click();await page.locator('#reader').waitFor();
    await page.reload();await page.locator('#recent').waitFor();
    let started;const start=new Promise(resolve=>started=resolve);
    await page.route('**/api/runtime/prepare',async route=>{
      if(route.request().postDataJSON().action==='pages'){started();await new Promise(resolve=>setTimeout(resolve,1500));}
      await route.continue().catch(()=>{});
    });
    await Promise.race([start,new Promise((_,reject)=>setTimeout(()=>reject(new Error('prefetch did not start')),10000))]);
    await page.locator('#sidebar [data-nav=browse]').first().click();await page.locator('#works .card').first().waitFor();
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('#browse').isVisible(),true);assert.equal(await page.locator('#error').isVisible(),false);
    assert.equal(await page.locator('#loadingStatus').isVisible(),false);
  });
  await check('quick jump switches repositories without activating a source until selected', async context => {
    const page=await ready(context), other='https://other.example/index.json';
    await page.evaluate(url=>localStorage.setItem('moya-source-repositories',JSON.stringify([...JSON.parse(localStorage.getItem('moya-source-repositories')),url])),other);
    await page.route('**/api/catalog',async route=>{
      const response=await route.fetch(),data=await response.json();
      if(route.request().postDataJSON().repositoryUrl===other) data.sources=data.sources.map(row=>({...row,name:'다른 저장소 '+row.name}));
      await route.fulfill({response,json:data});
    });
    await page.locator('#quickJump').click();await page.getByLabel('빠른 이동 저장소').selectOption(other);
    await page.locator('.discovery-quick-jump-row').filter({hasText:'다른 저장소 테스트 만화'}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moya-source-selection')).repositoryUrl),repositoryUrl);
    const activated=page.waitForRequest(r=>r.url().endsWith('/api/runtime/prepare')&&r.postDataJSON().repositoryUrl===other);
    await page.locator('.discovery-quick-jump-row').filter({hasText:'다른 저장소 테스트 만화'}).locator('button').first().click();
    await activated; await page.locator('#workspaceContent[aria-busy=false]').waitFor();
    await page.locator('#browse .card').first().waitFor();
    await page.waitForFunction(url=>JSON.parse(localStorage.getItem('moya-source-selection')).repositoryUrl===url,other);
    assert.equal(requests.at(-1).repositoryUrl,other);
    await page.locator('#quickJump').click();await page.getByLabel('빠른 이동 저장소').selectOption(repositoryUrl);
    await page.locator('.discovery-quick-jump-row').filter({hasText:'테스트 만화'}).first().waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moya-source-selection')).repositoryUrl),other);
  });
  async function openScrollComic(context, {mode='continuous-seamless',count=3,width=1440,height=900,imageHeight=900,failFirst=false}={}) {
    fixturePageCount=count;generation=2;
    const page=await ready(context);await page.setViewportSize({width,height});
    await page.evaluate(mode=>localStorage.setItem('moya-comic-settings',JSON.stringify({mode:'vertical',seamlessVertical:mode==='continuous-seamless'})),mode);
    await page.route('**/fixture/image?*',route=>failFirst&&new URL(route.request().url()).searchParams.get('generation')==='3'
      ? route.fulfill({status:404,body:'missing'})
      : route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${imageHeight}"><rect width="600" height="${imageHeight}" fill="#468"/></svg>`}));
    await page.locator('#works .card').first().click();await page.locator('#continueReading').click();
    await page.locator('#pages[data-comic-mode="'+mode+'"]').waitFor();
    return page;
  }
  async function scrollComicToEnd(page) {
    const chapter=Number((await page.locator('#readerChapterTitle').textContent()).replace('Chapter ',''));
    await page.locator('#pages [data-scroll-chapter-boundary] strong').filter({hasText:new RegExp('^Chapter '+(chapter+1)+'$')}).waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.evaluate(()=>{document.activeElement?.blur();dispatchEvent(new Event('wheel'));scrollTo(0,document.scrollingElement.scrollHeight);});
    await page.waitForFunction(()=>[...document.querySelectorAll('#pages .page')].at(-1)?.dataset.loaded==='true');
    await page.evaluate(()=>scrollTo(0,document.scrollingElement.scrollHeight));
    await page.locator('#pages [data-scroll-chapter-boundary-armed=true]').waitFor();
  }
  for(const mode of ['continuous','continuous-seamless']) await check(`scroll comic keyboard traverses tall pages and chapter edges: ${mode}`,async context=>{
    const page=await openScrollComic(context,{mode,count:1,imageHeight:3000});
    await page.waitForFunction(()=>document.querySelector('#pages .page')?.dataset.loaded==='true');
    await page.evaluate(()=>{document.activeElement?.blur();dispatchEvent(new Event('wheel'));scrollTo(0,0);});
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>scrollY>100);
    assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 1','a tall final image must be read before advancing');
    for(const [i,key] of ['ArrowRight','ArrowDown','PageDown','Space'].entries()) {
      await scrollComicToEnd(page);
      await page.evaluate(key=>dispatchEvent(new KeyboardEvent('keydown',{key:key==='Space'?' ':key,repeat:true,bubbles:true,cancelable:true})),key);
      assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter '+(i+1),'held key cannot skip chapters');
      await page.keyboard.press(key);
      await page.waitForFunction(n=>document.getElementById('readerChapterTitle').textContent==='Chapter '+n,i+2);
    }
    await page.locator('#pages [data-scroll-chapter-boundary] strong').filter({hasText:'Chapter 6'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#pages .page')?.dataset.loaded==='true');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.evaluate(()=>{document.activeElement?.blur();dispatchEvent(new Event('wheel'));scrollTo(0,0);});
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(()=>document.getElementById('readerChapterTitle').textContent==='Chapter 4');
    await page.locator('#pages [data-scroll-chapter-boundary] strong').filter({hasText:'Chapter 5'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#pages .page')?.dataset.loaded==='true'&&scrollY>0&&document.scrollingElement.scrollHeight-innerHeight-scrollY<=2);
  });
  for(const mobile of [false,true]) await check(`scroll comic chapter gesture works in reader margins: ${mobile?'touch':'wheel'}`,async context=>{
    const page=await openScrollComic(context,{width:mobile?390:1440,height:900,count:mobile?1:3,imageHeight:mobile?300:900});
    await scrollComicToEnd(page);
    const point=mobile?{x:195,y:830}:{x:10,y:450};
    assert.equal(await page.evaluate(p=>document.getElementById('pages').contains(document.elementFromPoint(p.x,p.y)),point),false,'gesture starts outside image container');
    if(mobile) {
      const cdp=await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-100}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,120);}
    await page.waitForFunction(()=>document.getElementById('readerChapterTitle').textContent==='Chapter 2');
  });
  await check('scroll comic reaching the end during a touch requires lifting and a new swipe',async context=>{
    const page=await openScrollComic(context,{width:390,height:900});
    await scrollComicToEnd(page);
    await page.evaluate(()=>scrollBy(0,-180));
    await page.locator('#pages [data-scroll-chapter-boundary-armed=false]').waitFor();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:650}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:350}]});
    await page.waitForFunction(()=>document.scrollingElement.scrollHeight-innerHeight-scrollY<=2);
    await page.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:150}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 1','the gesture that reaches the end must not advance');
    await page.locator('#pages [data-scroll-chapter-boundary-armed=true]').waitFor();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:650}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:500}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>document.getElementById('readerChapterTitle').textContent==='Chapter 2');
  });
  await check('scroll comic can advance after skipped or failed earlier images',async context=>{
    const page=await openScrollComic(context,{count:30,failFirst:true});
    await page.locator('#pages .errorPage').waitFor();
    await scrollComicToEnd(page);
    assert.ok(await page.locator('#pages .page:not([data-loaded=true])').count()>0);
    await page.mouse.move(700,450);await page.mouse.wheel(0,120);
    await page.waitForFunction(()=>document.getElementById('readerChapterTitle').textContent==='Chapter 2');
  });
  for (const mode of ['continuous','continuous-seamless','novel-scroll']) await check(`scroll chapter boundary: ${mode} requires a fresh wheel or touch gesture`, async context => {
    const novel=mode==='novel-scroll';fixtureItemType=novel?2:0;fixturePageCount=3;generation=2;
    const page=await ready(context);await page.setViewportSize({width:390,height:844});
    await page.evaluate(({mode,novel})=>localStorage.setItem(novel?'moya-novel-settings':'moya-comic-settings',JSON.stringify(novel?{modeLock:'scroll'}:{mode:'vertical',seamlessVertical:mode==='continuous-seamless'})),{mode,novel});
    await page.route('**/fixture/image?*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#468"/></svg>'}));
    await page.locator('#works .card').first().click();await page.locator('#continueReading').click();
    const title=async n=>{await page.waitForFunction(n=>document.getElementById('readerChapterTitle').textContent==='Chapter '+n,n,{timeout:12000});if(n<25)await page.locator(selector+' strong').filter({hasText:'Chapter '+(n+1)}).waitFor();else await page.locator(selector).waitFor({state:'detached'});};
    const waitReader=async()=>{if(novel)await page.locator('#novelText .reader-scroll[aria-busy=false]').waitFor();else await page.waitForFunction(count=>document.querySelectorAll('#pages .page').length===count&&[...document.querySelectorAll('#pages .page')].every(row=>row.dataset.loaded==='true'),fixturePageCount);};
    const selector=novel?'#novelText .is-active [data-scroll-chapter-boundary]':'#pages [data-scroll-chapter-boundary]';
    const bottom=async()=>{await waitReader();await page.evaluate(novel=>{document.activeElement?.blur();dispatchEvent(new Event('wheel'));if(novel){const root=document.querySelector('#novelText .reader-scroll');root.scrollTop=root.scrollHeight;}else scrollTo(0,document.scrollingElement.scrollHeight);},novel);};
    const armed=()=>page.locator(selector+'[data-scroll-chapter-boundary-armed=true]').waitFor();
    const point=async()=>{const r=await page.locator(selector).boundingBox();return {x:r.x+r.width/2,y:Math.max(120,Math.min(600,r.y+20))};};
    await title(1);await bottom();await armed();assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 1','reaching the end must not advance');
    // Continuous momentum postpones readiness; only a later gesture crosses the boundary.
    await page.evaluate(novel=>{const root=novel?document.querySelector('#novelText .reader-scroll'):document.getElementById('pages');root.dispatchEvent(new WheelEvent('wheel',{deltaY:-80,bubbles:true,cancelable:true}));for(let i=0;i<4;i++)root.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));},novel);
    assert.equal(await page.locator(selector).getAttribute('data-scroll-chapter-boundary-armed'),'false');
    await armed();assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 1');
    let p=await point();await page.mouse.move(p.x,p.y);await page.mouse.wheel(0,120);await title(2);await waitReader();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok(Number(await page.locator(novel?'#novelSeek':'#readerPage').inputValue())<=(novel?20:1),'next chapter starts at the beginning');
    await bottom();await armed();
    const cdp=await context.newCDPSession(page);
    const pull=async(distance,cancel=false)=>{p=await point();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y-distance}]});await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});};
    await pull(100,true);await page.waitForTimeout(150);assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 2','cancelled touch does not navigate');
    await bottom();await armed();await pull(20);await page.waitForTimeout(150);assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 2','small touch does not navigate');
    await armed();await pull(100);await title(3);await waitReader();
    // Leaving during Moya's 100ms pull animation must cancel the queued navigation.
    await bottom();await armed();
    await page.evaluate(novel=>{const root=novel?document.querySelector('#novelText .reader-scroll'):document.getElementById('pages');root.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));document.getElementById('back').click();},novel);
    await page.locator('#detail').waitFor();await page.waitForTimeout(200);
    assert.equal(await page.locator('#reader').isVisible(),false);
    assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 3');
    await page.getByLabel('회차 정렬',{exact:true}).selectOption('desc');await page.locator('#chapters .chapter').first().click();await title(25);await waitReader();
    assert.equal(await page.locator(selector).count(),0,'last chapter has no next-chapter gesture');
  });
  await check('comic page edges cross chapters by keys, touch and swipe; exit returns to detail', async context => {
    fixturePageCount=3;generation=2;
    const page=await ready(context);await page.setViewportSize({width:390,height:844});
    const cdp=await context.newCDPSession(page);
    const touch=async(x,delta=0)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:420}]});if(delta){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+delta/2,y:420}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+delta,y:420}]});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
    const title=async n=>{await page.waitForFunction(n=>document.querySelector('#readerChapterTitle').textContent==='Chapter '+n,n);await page.waitForFunction(()=>document.querySelector('#pages .page.active img')?.naturalWidth>0);};
    const seek=async n=>{await page.locator('#readerSeek').evaluate((el,n)=>{el.value=String(n);el.dispatchEvent(new Event('input',{bubbles:true}));},n);await page.evaluate(()=>document.activeElement?.blur());};
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().waitFor();
    assert.equal(await page.locator('.chapter-index').count(),0);
    await page.locator('#continueReading').click();await title(1);await page.evaluate(()=>document.activeElement?.blur());
    await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#readerChapterTitle').textContent(),'Chapter 1');
    await seek(3);await page.keyboard.press('ArrowRight');await title(2);assert.equal(await page.locator('#readerPage').inputValue(),'1');
    await page.keyboard.press('ArrowLeft');await title(1);assert.equal(await page.locator('#readerPage').inputValue(),'3');
    await touch(380);await title(2);assert.equal(await page.locator('#readerPage').inputValue(),'1');
    await seek(3);await touch(320,-180);await title(3);await page.locator('#previousChapter').click();await title(2);await page.keyboard.press('ArrowRight');await title(3);await touch(10);await title(2);assert.equal(await page.locator('#readerPage').inputValue(),'3');
    await page.locator('#readerSettingsButton').click();await page.locator('#comicMode').selectOption('spread');await page.locator('#comicCover').selectOption('pair');await page.locator('#comicDirection').selectOption('rtl');await page.keyboard.press('Escape');await page.locator('#settingsDialog').waitFor({state:'hidden'});await page.evaluate(()=>document.activeElement?.blur());
    await page.keyboard.press('ArrowLeft');await title(3);await page.keyboard.press('ArrowRight');await title(2);assert.equal(await page.locator('#readerPage').inputValue(),'3');
    await page.locator('#back').click();await page.locator('#detail').waitFor();await page.locator('#back').click();await page.locator('#browse').waitFor();
    await page.locator('#mobileTabs [data-nav=recent]').click();await page.locator('#recentFeatured .primary-btn').click();await page.locator('#reader').waitFor();await page.locator('#back').click();await page.locator('#detail').waitFor();
  });
  await check('novel paginated edges use arrows and touch, fresh next chapter and previous chapter end', async context => {
    fixtureItemType=2;novelText='첫 문단. 짧은 본문입니다.\n\n마지막 문단. 끝입니다.';
    await context.addInitScript(()=>{if(location.origin!=='null')localStorage.setItem('moya-novel-settings',JSON.stringify({modeLock:'paginated'}));});
    const page=await ready(context);await page.setViewportSize({width:390,height:844});
    const cdp=await context.newCDPSession(page);
    const touch=async x=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:420}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
    const chapter=async n=>{await page.waitForFunction(n=>document.querySelector('#readerChapterTitle').textContent==='Chapter '+n,n);await page.locator('.reader-paginated-root.is-active .reader-paragraph').first().waitFor();};
    await page.locator('#works .card').first().click();await page.locator('#continueReading').click();await chapter(1);
    assert.equal(await page.locator('#novelText .chapter-kicker:visible').count(),0);
    await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('ArrowRight');await chapter(2);
    await touch(10);await chapter(1);await touch(380);await chapter(2);
    await page.keyboard.press('ArrowLeft');await chapter(1);
    await page.keyboard.press('ArrowRight');await chapter(2);await page.keyboard.press('ArrowRight');await chapter(3);
    await page.locator('#back').click();await page.locator('#detail').waitFor();await page.locator('#back').click();await page.locator('#browse').waitFor();
  });
  await check('comic chrome overlays stable geometry and chapter changes keep spread and hidden chrome', async context => {
    generation=2;fixturePageCount=8;const page=await ready(context);await page.setViewportSize({width:844,height:650});
    await page.route('**/fixture/image?*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#468"/></svg>'}));
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.locator('#readerSettingsButton').click();await page.locator('#comicMode').selectOption('spread');await page.locator('#comicCover').selectOption('pair');await page.keyboard.press('Escape');
    await page.waitForFunction(()=>[...document.querySelectorAll('#pages .page.active img')].length===2&&[...document.querySelectorAll('#pages .page.active img')].every(img=>img.naturalWidth));
    const rect=()=>page.locator('#pages .page.active img').first().evaluate(node=>node.getBoundingClientRect().toJSON());
    const before=await rect();await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('i');
    assert.deepEqual(await rect(),before);
    await page.evaluate(()=>{window.spreadFrames=[];window.watchSpread=true;const observe=()=>{if(!window.watchSpread)return;const root=document.querySelector('#pages');if(root.children.length&&getComputedStyle(root).visibility!=='hidden')window.spreadFrames.push({mode:root.dataset.comicMode,count:root.querySelectorAll('.page.active').length,hidden:document.body.classList.contains('immersive')});requestAnimationFrame(observe);};requestAnimationFrame(observe);document.querySelector('#nextChapter').click();});
    await page.waitForFunction(()=>document.querySelector('#readerChapterTitle').textContent==='Chapter 2');
    await page.waitForFunction(()=>document.querySelectorAll('#pages .page.active').length===2&&[...document.querySelectorAll('#pages .page.active img')].every(img=>img.naturalWidth));
    const frames=await page.evaluate(()=>{window.watchSpread=false;return window.spreadFrames;});
    assert.ok(frames.length);assert.ok(frames.every(frame=>frame.mode==='spread'&&frame.count===2&&frame.hidden),JSON.stringify(frames));
    await page.keyboard.press('i');assert.deepEqual(await rect(),before);
    await page.locator('#readerSettingsButton').click();await page.locator('#comicMode').selectOption('continuous');await page.keyboard.press('Escape');await page.locator('#settingsDialog').waitFor({state:'hidden'});
    await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('i');await page.mouse.move(400,300);await page.mouse.wheel(0,300);await page.waitForTimeout(150);
    assert.equal(await page.locator('body').evaluate(node=>node.classList.contains('immersive')),true);
  });
  await check('novel scrolling keeps chrome hidden and toggling chrome does not reflow paragraphs', async context => {
    fixtureItemType=2;const page=await ready(context);await page.setViewportSize({width:390,height:844});
    await page.locator('#works .card').first().click();await page.locator('#chapters .chapter').first().click();
    await page.locator('#novelText .reader-scroll[aria-busy=false]').waitFor();
    const geometry=()=>page.locator('#novelText [data-paragraph-id]').first().evaluate(node=>node.getBoundingClientRect().toJSON());
    const before=await geometry();await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('i');
    assert.deepEqual(await geometry(),before);
    await page.mouse.move(195,420);await page.mouse.wheel(0,450);await page.waitForTimeout(250);
    assert.equal(await page.locator('body').evaluate(node=>node.classList.contains('immersive')),true);
    const scrolled=await geometry();await page.keyboard.press('i');assert.deepEqual(await geometry(),scrolled);
  });
  await check('browser adapter preserves variant metadata, Document body and binary HTTP responses', async context => {
    const page=await ready(context);
    const output=await runGuest(page,`class DefaultExtension extends MProvider { async getHeaders(){const response=await new Client().get('https://example.com/index');const doc=new Document('<html><head><title>A</title></head><body><p>본문</p></body></html>');return {variant:JSON.parse(this.source.additionalParams).section,text:doc.body.selectFirst('p').text,bytes:[...response.body].map(c=>c.charCodeAt(0))};}}`,'headers',3000,200,{id:'1',itemType:0,additionalParams:'{"section":"webtoon"}'},{contentType:'application/octet-stream',bytes:Buffer.from([0,128,159,255]).toString('base64')});
    assert.equal(output.type,'result');assert.deepEqual(output.value.result,{variant:'webtoon',text:'본문',bytes:[0,128,159,255]});
  });
  console.log(JSON.stringify(results, null, 2));
  if (results.some(row => !row.passed)) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
