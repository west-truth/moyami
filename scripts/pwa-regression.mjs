import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
let version=1;
const root=resolve('public');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/api/auth/status'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({configured:true,initialized:true,user:{id:'pwa-fixture',username:'fixture',role:'admin'}}));return;}
  if(path==='/api/sync'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({userId:'pwa-fixture',revision:0,rows:{}}));return;}
  if(path.startsWith('/api/')){res.writeHead(401,{'content-type':'application/json'}).end('{"error":"access_denied"}');return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+'/')){res.writeHead(404).end();return;}
  try {
    let bytes=await readFile(file);
    if(path==='/sw.js')bytes=Buffer.from(bytes.toString().replace(/moya-shell-[a-f0-9]+/,`moya-shell-test-${version}`));
    const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.wasm':'application/wasm','.webmanifest':'application/manifest+json'};
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-cache'}).end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.MOYA_SOURCE_BROWSER_EXECUTABLE,headless:true});
const context=await browser.newContext();
const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
const results=[];
try {
  let page=await context.newPage();await page.goto(base);
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  const manifest=await (await page.request.get(base+'/manifest.webmanifest')).json();
  assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');
  const cdp=await context.newCDPSession(page);const appManifest=await cdp.send('Page.getAppManifest');assert.deepEqual(appManifest.errors,[]);
  const iconSizes=await page.evaluate(async icons=>Promise.all(icons.map(async icon=>{const image=await createImageBitmap(await(await fetch(icon.src)).blob());return `${image.width}x${image.height}`;})),manifest.icons);
  assert.deepEqual(iconSizes,['192x192','512x512']);results.push('manifest and original Moya icons validated');
  const cached=await page.evaluate(async()=>{const cache=await caches.open('moya-shell-test-1');return (await cache.keys()).map(request=>new URL(request.url).pathname);});
  assert.ok(cached.includes('/runtime/quickjs.wasm'));assert.ok(cached.includes('/app.js'));assert.ok(cached.every(path=>!path.startsWith('/api/')&&!path.startsWith('/install/')));
  results.push('complete public shell cached; APIs and downloads excluded');
  await context.setOffline(true);await page.reload();await page.locator('#authRetry').waitFor();
  assert.equal(await page.title(),'moyami');assert.equal(await page.locator('#appHeader').isVisible(),false);results.push('offline launch loads the application shell');
  await context.setOffline(false);
  const keeper=await context.newPage();await keeper.goto(base);await keeper.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  version=2;await page.evaluate(async()=>await(await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  assert.equal(await page.evaluate(async()=> (await caches.keys()).includes('moya-shell-test-1')),true);
  await page.reload();
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.waiting),null,{timeout:5000}).catch(async error=>{console.log('worker state',await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {keys:await caches.keys(),active:r?.active?.state,installing:r?.installing?.state,waiting:r?.waiting?.state,controller:navigator.serviceWorker.controller?.state};}));throw error;});
  results.push('update waits for existing tabs; active cache preserved');
  await page.close();await keeper.close();page=await context.newPage();await page.goto(base);
  await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('moya-shell-test-2')&&!keys.includes('moya-shell-test-1');});
  results.push('closing and reopening activates the new shell and removes the old cache');
  await page.locator('#sidebar [data-settings=appearance]').click();
  await page.evaluate(()=>{const event=new Event('beforeinstallprompt');event.prompt=async()=>{window.installPromptUsed=true;};event.userChoice=Promise.resolve({outcome:'accepted'});dispatchEvent(event);});
  await page.locator('#installApp').click();assert.equal(await page.evaluate(()=>window.installPromptUsed),true);
  assert.equal(await page.locator('#installApp').isVisible(),false);results.push('install button uses the browser prompt');
  assert.deepEqual(errors,[]);
} finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
await mkdir('.state',{recursive:true});await writeFile('.state/pwa-regression-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
