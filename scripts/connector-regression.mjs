// Real unpacked Chromium extension, isolated local HTTPS source; no live source/network dependency.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
const state = '.state/connector-test'; await mkdir(state, { recursive: true });
execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${state}/key.pem`,'-out',`${state}/cert.pem`,'-subj','/CN=example.com','-days','1'], { stdio:'ignore' });
const requests = [], results = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const origin = httpsServer({ key: await readFile(`${state}/key.pem`), cert: await readFile(`${state}/cert.pem`) }, (req,res) => {
  requests.push({ url:req.url, method:req.method, headers:req.headers });
  if (req.url === '/binary-image') res.writeHead(200, { 'content-type':'application/octet-stream' }).end(png);
  else if (req.url === '/fake-image') res.writeHead(200, { 'content-type':'image/png' }).end('<html>Access denied</html>');
  else if (req.url.startsWith('/image')) res.writeHead(200, { 'content-type':'image/png' }).end(png);
  else if (req.url === '/redirect') res.writeHead(302, {location:'https://ungranted.example.com/'}).end();
  else if (req.url === '/slow') { const timer = setTimeout(() => res.end('late'),10000);res.on('close',()=>clearTimeout(timer)); }
  else if (req.url === '/large') res.writeHead(200, { 'content-type':'text/plain','content-length':3*1024*1024 }).end('oversize');
  else if (req.url === '/') res.writeHead(200, { 'content-type':'text/html','set-cookie':'fixture=authenticated; Secure; SameSite=Lax; Path=/'}).end('<h1>Authenticated fixture</h1>');
  else {let body='';req.on('data',c=>body+=c);req.on('end',()=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({method:req.method,headers:req.headers,body})));}
});
await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
const sourcePort=origin.address().port;
let serverRelayCalls = 0;
const source = `class DefaultExtension extends MProvider {
 getSourcePreferences(){return [];}
 getHeaders(){return {Referer:'https://example.com/work'};}
 async getPopular(){await new Client().get('https://example.com/echo');return {list:[{name:'Fixture',link:'https://example.com/work',imageUrl:'https://example.com/image'}],hasNextPage:false};}
 getLatestUpdates(){return this.getPopular();} search(){return this.getPopular();}
 getDetail(){return {name:'Fixture',imageUrl:'https://example.com/image',chapters:[{name:'Chapter',url:'https://example.com/chapter'}]};}
 getPageList(){return Array.from({length:7},(_,i)=>'https://example.com/image?page='+i);}
}`;
const digest = createHash('sha256').update(source).digest('hex');
const web = createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/') res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><body><div id="images"></div><script type="module">import {connectorCall} from "/connector.js";window.call=connectorCall;</script></body>');
    else if(path === '/api/auth/status') res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({configured:true,initialized:true,user:{id:'fixture',username:'fixture',role:'admin'}}));
    else if(path === '/api/catalog') res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({repositoryUrl:'https://example.com/catalog',sources:[{id:'fixture',name:'Fixture',itemType:0,lang:'ko'}],skipped:0}));
    else if(path.startsWith('/api/runtime/')) {
      let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);let value={ok:true};
      if(path.endsWith('/prepare'))value={...input,token:input.action,source,codeDigest:digest,entry:{id:'fixture',itemType:0},timeoutMs:30000};
      if(path.endsWith('/finish')){value={...input.value,codeDigest:digest};if(input.token==='pages')value.result=value.result.map(()=>({imageUrl:'/api/image?forbidden=1'}));}
      if(path.endsWith('/http'))serverRelayCalls++;
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));
    }
    else if(path === '/api/image'){serverRelayCalls++;res.writeHead(500).end();}
    else if(path === '/reader' || /^\/(entry|account-storage|account-sync|pwa|local-cache|download-settings|cover-cache|metadata-cache|library-home|transitions|source-manager|(?:reader-fonts|novel-reader)|comic-reader|ui|app|source-runtime|connector|connector-images|host-config)\.js$/.test(path) || ['/styles.css','/moya.css', '/moya-ui.css', '/moya-ui.js','/branding/moya-wordmark.png'].includes(path) || ['/runtime/source-worker.js','/runtime/quickjs.wasm'].includes(path)) {
      const file=path==='/reader'?'/index.html':path;
      res.writeHead(200,{'content-type':file.endsWith('.png')?'image/png':file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.css')?'text/css':'text/html'}).end(file === '/entry.js' ? (await readFile('public'+file,'utf8')).replace('selectAccount(account.id);','').replace('await startSync();','') : await readFile('public'+file));
    }
    else res.writeHead(404).end();
  }catch{res.writeHead(500).end();}
});
await new Promise(resolve=>web.listen(4179,'0.0.0.0',resolve));
execFileSync(process.execPath,['scripts/build-extension.mjs'],{env:{...process.env,CONNECTOR_SKIP_ZIP:'1',CONNECTOR_DEV:'1',CONNECTOR_READER_ORIGINS:'http://127.0.0.1:4179'},stdio:'pipe'});
await cp('.state/extension/chromium',`${state}/extension`,{recursive:true});
const manifest=JSON.parse(await readFile(`${state}/extension/manifest.json`));
// Test fixture host permission is installed only in this disposable test copy.
manifest.host_permissions.push('https://example.com/*');await writeFile(`${state}/extension/manifest.json`,JSON.stringify(manifest));
const ext = new URL(`../${state}/extension`,import.meta.url).pathname;
const context=await chromium.launchPersistentContext('',{executablePath:process.env.MOYA_SOURCE_BROWSER_EXECUTABLE,headless:true,ignoreHTTPSErrors:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--no-proxy-server',`--host-resolver-rules=MAP example.com 127.0.0.1:${sourcePort}, MAP ungranted.example.com 127.0.0.1:${sourcePort}`,'--ignore-certificate-errors']});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=async(name,run)=>{try{await run();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}};
try {
 await page.goto('http://127.0.0.1:4179');await page.waitForFunction(()=>typeof window.call==='function');
 const call=(type,args={})=>page.evaluate(async({type,args})=>{try{return await window.call(type,args,undefined,5000);}catch(e){return {error:e.message};}},{type,args});
 await check('extension connects to approved top-level reader',async()=>assert.equal((await call('hello')).version,1));
 const background=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const popupUrl=new URL('popup.html',background.url()).href;
 await check('popup starts with no suggested sites',async()=>{
  const popup=await context.newPage();
  try {
   await popup.goto(popupUrl);
   await popup.getByText('아직 연결을 요청한 사이트가 없습니다.',{exact:false}).waitFor();
   assert.equal(await popup.locator('#sites section').count(),0);
  } finally {await popup.close();}
 });
 const {token}=await call('begin',{action:'pages'});
 await check('POST body and scoped Origin/Referer',async()=>{
  const r=await call('http',{token,request:{url:'https://example.com/echo',method:'POST',headers:{Origin:'https://example.com',Referer:'https://example.com/chapter','Content-Type':'application/json','Cache-Control':'no-cache'},body:'{"value":1}'}});
  assert.equal(r.statusCode,200,JSON.stringify(r));const data=JSON.parse(Buffer.from(r.bytes,'base64'));
  assert.equal(data.body,'{"value":1}');assert.equal(data.headers['cache-control'],'no-cache');assert.equal(data.headers.origin,'https://example.com');assert.equal(data.headers.referer,'https://example.com/chapter');
 });
 await check('mobile User-Agent, byte ranges and HEAD are preserved without exposing cookies',async()=>{
  assert.equal((await call('hello')).appVersion,'0.1.1');
  const result=await call('http',{token,request:{url:'https://example.com/echo',headers:{'User-Agent':'Moya Mobile Fixture','Range':'bytes=0-31'}}});
  assert.equal(result.statusCode,200,JSON.stringify(result));
  const body=JSON.parse(Buffer.from(result.bytes,'base64'));assert.equal(body.headers['user-agent'],'Moya Mobile Fixture');assert.equal(body.headers.range,'bytes=0-31');
  const head=await call('http',{token,request:{url:'https://example.com/image',method:'HEAD'}});
  assert.equal(head.statusCode,200,JSON.stringify(head));assert.equal(head.size,0);
  assert.equal(requests.at(-1).method,'HEAD');
  assert.equal((await call('http',{token,request:{url:'https://example.com/image',headers:{Range:'bytes=0-1,2-3'}}})).error,'invalid_source_invocation');
 });
 await check('site permission is required',async()=>assert.equal((await call('http',{token,request:{url:'https://ungranted.example.com/echo'}})).error,'connector_permission_required'));
 await check('popup shows only sites requested by the reader',async()=>{
  const popup=await context.newPage();
  try {
   await popup.goto(popupUrl);
   await popup.locator('#sites section').waitFor();
   assert.deepEqual(await popup.locator('#sites section > div').allTextContents(),['https://ungranted.example.com']);
   assert.equal(await popup.getByRole('button',{name:'사이트 허용',exact:true}).count(),1);
  } finally {await popup.close();}
 });
 await check('local addresses and injected cookies rejected',async()=>{
  assert.equal((await call('http',{token,request:{url:'https://127.0.0.1/'}})).error,'source_url_denied');
  assert.equal((await call('http',{token,request:{url:'https://example.com/echo',headers:{Cookie:'secret=1'}}})).error,'connector_header_unsupported');
 });
 await check('redirect does not reach unapproved target',async()=>{const before=requests.length;assert.ok((await call('http',{token,request:{url:'https://example.com/redirect'}})).error);assert.equal(requests.length,before+1);});
 await check('response byte limit',async()=>assert.equal((await call('http',{token,request:{url:'https://example.com/large'}})).error,'source_body_limit'));
 await check('image fetched through extension and decoded',async()=>{
  await page.evaluate(async()=>{const {assignImage}=await import('/connector-images.js');const image=document.createElement('img');document.querySelector('#images').append(image);assignImage(image,'moya-image:'+encodeURIComponent(JSON.stringify({url:'https://example.com/image'})));});
  await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===1);assert.equal(await page.locator('img').evaluate(img=>img.src.startsWith('blob:')),true);
 });
 await check('binary CDN image is identified from bytes and mislabeled HTML is rejected',async()=>{
  const image=await call('image',{request:{url:'https://example.com/binary-image'}});
  assert.equal(image.contentType,'image/png');assert.equal(image.bytes,png.toString('base64'));
  assert.equal((await call('image',{request:{url:'https://example.com/fake-image'}})).error,'image_decode_failed');
 });
 await check('AbortSignal cancels pending request',async()=>{
  const r=await page.evaluate(async token=>{const abort=new AbortController();const p=window.call('http',{token,request:{url:'https://example.com/slow'}},abort.signal);setTimeout(()=>abort.abort(),100);try{await p;return 'unexpected';}catch(e){return e.name;}},token);assert.equal(r,'AbortError');
 });
 await check('ended job cannot issue more requests',async()=>{await call('end',{token});assert.equal((await call('http',{token,request:{url:'https://example.com/echo'}})).error,'runtime_expired');});
 await check('temporary header rules removed',async()=>assert.equal(await background.evaluate(()=>chrome.declarativeNetRequest.getSessionRules().then(r=>r.length)),0));
 await check('authenticated source tab uses browser cookies',async()=>{
  const source=await context.newPage();await source.goto('https://example.com/');
  await background.evaluate(async()=>{const [tab]=await chrome.tabs.query({url:'https://example.com/*'});await chrome.storage.local.set({authTabs:{'https://example.com':tab.id}});});
  const {token}=await call('begin',{action:'detail'});const r=await call('http',{token,request:{url:'https://example.com/echo',headers:{Referer:'https://example.com/chapter'}}});
  assert.equal(r.statusCode,200,JSON.stringify(r));const body=JSON.parse(Buffer.from(r.bytes,'base64'));assert.match(body.headers.cookie,/fixture=authenticated/);assert.equal(body.headers.referer,'https://example.com/chapter');assert.equal(r.headers['set-cookie'],undefined);await call('end',{token});
 });
 await check('untrusted reader origin has no bridge',async()=>{
  const other=await context.newPage();await other.goto('https://example.com/');
  const connected=await other.evaluate(()=>new Promise(resolve=>{addEventListener('message',e=>{if(e.data?.channel==='moya-connector-response-v1')resolve(true);});window.postMessage({channel:'moya-connector-request-v1',id:'evil',type:'hello'},location.origin);setTimeout(()=>resolve(false),300);}));assert.equal(connected,false);
 });
 await check('real reader Worker → connector → cover and chapter images, no server relay',async()=>{
  await page.evaluate(()=>{localStorage.setItem('moya-network-mode','browser');localStorage.setItem('moyami-download-settings',JSON.stringify({prefetch:false}));localStorage.setItem('moya-source-repositories',JSON.stringify(['https://example.com/catalog']));});
  await page.goto('http://127.0.0.1:4179/reader');
  await page.locator('.card').first().waitFor({timeout:10000});
  await page.waitForFunction(()=>document.querySelector('.card img')?.naturalWidth===1);
  assert.equal(requests.filter(row=>row.url==='/image').at(-1).headers.referer,'https://example.com/work');
  await page.locator('.card').first().click();await page.locator('#chapters .chapter').first().click();
  await page.waitForFunction(()=>[1,2,3,4,5].every(n=>document.querySelector(`.page[data-page="${n}"] img`)?.naturalWidth===1));
  assert.equal(requests.some(row=>row.url==='/image?page=5'),false);
  const firstRequests=requests.filter(row=>row.url==='/image?page=0').length;
  await page.locator('#readerPage').fill('2');await page.locator('#readerPage').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('.page[data-page="6"] img')?.naturalWidth===1);
  await page.locator('#readerPage').fill('1');await page.locator('#readerPage').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('.page[data-page="1"] img')?.naturalWidth===1);
  assert.equal(requests.filter(row=>row.url==='/image?page=0').length,firstRequests);
  for (let index=1;index<=7;index++) {
    await page.locator('#readerPage').fill(String(index));
    await page.locator('#readerPage').dispatchEvent('change');
    await page.waitForFunction(n=>document.querySelector(`.page[data-page="${n}"] img`)?.naturalWidth===1,index);
  }
  assert.match(await page.locator('#readerLoadProgress').getAttribute('aria-label'),/이미지 7 \/ 7 \(100%\)/);
  assert.equal(serverRelayCalls,0);
  const image=await page.locator('#pages .page.active img').getAttribute('src');assert.ok(image.startsWith('blob:'));
  await page.locator('#back').click();
 });
 await check('speculative connector images are bounded and reused by visible images',async()=>{
  await page.evaluate(async()=>{
    const {prefetchImages,assignImage,flushImageQueue}=await import('/connector-images.js');
    const urls=Array.from({length:17},(_,i)=>i+1).map(n=>'moya-image:'+encodeURIComponent(JSON.stringify({url:'https://example.com/image?warm='+n,headers:{Referer:'https://example.com/work'}})));
    await prefetchImages(urls,new AbortController().signal);
    await new Promise((resolve,reject)=>{
      const image=new Image(); image.id='warm-visible'; image.onload=resolve; image.onerror=()=>reject(new Error('prefetched image failed'));
      document.body.append(image);assignImage(image,urls[0],{priority:3});flushImageQueue();
    });
  });
  assert.equal(requests.filter(row=>row.url==='/image?warm=1').length,1);
  assert.equal(requests.filter(row=>row.url==='/image?warm=2').length,1);
  assert.equal(requests.filter(row=>row.url==='/image?warm=16').length,1);
  assert.equal(requests.filter(row=>row.url==='/image?warm=17').length,0);
  assert.equal(await page.locator('#warm-visible').evaluate(image=>image.naturalWidth),1);
  await page.locator('#warm-visible').evaluate(image=>image.remove());
 });
 await check('no uncaught UI exceptions' ,async()=>assert.deepEqual(errors,[]));
}finally{await context.close();await new Promise(r=>web.close(r));await new Promise(r=>origin.close(r));}
await writeFile('.state/connector-regression-results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
