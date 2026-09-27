import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { randomBytes,createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createApplication } from '../server/app.ts';
const dir=await mkdtemp(`${tmpdir()}/moyami-sync-browser-`);
process.env.BOOTSTRAP_KEY=randomBytes(32).toString('hex');process.env.AUTH_FILE=`${dir}/auth.json`;
for(const key of ['BROKER_STORE','COOKIE_SECURE','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN'])delete process.env[key];
const app=createApplication(),server=createServer(app.handle);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,repo='https://example.com/index.json',sourceKey=repo+'\n1',work='https://example.com/work',chapter='https://example.com/chapter';
const browser=await chromium.launch({executablePath:process.env.MOYA_SOURCE_BROWSER_EXECUTABLE,headless:true});
const contexts=[],errors=[];
const source=`class DefaultExtension extends MProvider { getPopular(){return {list:[],hasNextPage:false};} getFilterList(){return [];} getSourcePreferences(){return [];} getDetail(){return {name:'Synced Work',imageUrl:'${base}/fixture-cover',chapters:[{name:'Chapter',url:'${chapter}'}]};} getPageList(){return Array(4).fill('${base}/fixture-cover');}}`;
const digest=createHash('sha256').update(source).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function device(){const ctx=await browser.newContext({serviceWorkers:'block'});contexts.push(ctx);ctx.setDefaultTimeout(12000);ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await ctx.route('**/api/catalog',r=>r.fulfill({json:{repositoryUrl:repo,sources:[{id:'1',name:'Fixture',itemType:0,lang:'ko'}]}}));
 await ctx.route('**/api/runtime/**',async r=>{const input=r.request().postDataJSON();let value={ok:true};if(r.request().url().endsWith('/prepare'))value={...input,token:input.action,source,codeDigest:digest,entry:{id:'1',itemType:0},timeoutMs:30000};if(r.request().url().endsWith('/finish'))value={...input.value,codeDigest:digest};await r.fulfill({json:value});});
 await ctx.route('**/fixture-cover',r=>r.fulfill({body:png,contentType:'image/png'}));return ctx;}
const a=await device(),b=await device();
const creds={username:'owner',password:'owner-password-123'};
async function open(ctx){const page=await ctx.newPage();await page.goto(base);await page.locator('body[data-auth=ready]').waitFor();return page;}
const flush=p=>p.evaluate(async()=>await(await import('/account-sync.js')).flushSync());
const stored=(p,key)=>p.evaluate(async key=>(await import('/account-storage.js')).localStorage.getItem(key),key);
try{
 assert.equal((await a.request.post(base+'/api/auth/register',{data:{...creds,key:process.env.BOOTSTRAP_KEY}})).status(),200);
 const pa=await open(a);
 await pa.evaluate(async({repo,sourceKey,work,chapter})=>{const {localStorage:s}=await import('/account-storage.js');s.setItem('moya-source-repositories',JSON.stringify([repo]));s.setItem('moya-source-pins',JSON.stringify([{repositoryUrl:repo,sourceId:'1',sourceName:'Fixture',itemType:0}]));s.setItem('moya-source-recent:'+sourceKey,JSON.stringify([{url:work,title:'Synced Work',chapterUrl:chapter,chapterTitle:'Chapter',sourceName:'Fixture',imageUrl:'data:image/png;base64,PRIVATE_COVER',updatedAt:100}]));s.setItem('moya-chapter-marks:'+sourceKey+'\n'+work,JSON.stringify({[chapter]:{read:false,updatedAt:100}}));s.setItem('moya-app-theme','sepia');s.setItem('reader-profile-private','LOCAL_ONLY');(await import('/account-sync.js')).queueProgress(sourceKey,chapter,{page:3,totalPages:4,updatedAt:100});(await import('/account-sync.js')).queueProgress(sourceKey,chapter+'/novel',{ratio:.5,readerAnchor:{bookId:'novel',contentRevisionId:'revision',sectionId:chapter+'/novel',blockIndex:12,blockId:'p12',offset:7},updatedAt:100});},{repo,sourceKey,work,chapter});
 assert.equal(await flush(pa),true);
 const snapshot=await(await a.request.get(base+'/api/sync')).json();const bytes=JSON.stringify(snapshot);assert.equal(bytes.includes('PRIVATE_COVER'),false);assert.equal(bytes.includes('LOCAL_ONLY'),false);assert.equal(bytes.includes('sepia'),false);
 assert.equal((await b.request.post(base+'/api/auth/login',{data:creds})).status(),200);const pb=await open(b);
 assert.equal(JSON.parse(await stored(pb,'moya-source-repositories'))[0],repo);assert.equal(await stored(pb,'moya-app-theme'),null);assert.equal(await stored(pb,'reader-profile-private'),null);
 const novel=await pb.evaluate(async key=>{const {indexedDB}=await import('/account-storage.js');return await new Promise((resolve,reject)=>{const req=indexedDB.open('moya-source-lite',2);req.onsuccess=()=>{const db=req.result,read=db.transaction('progress').objectStore('progress').get(key);read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=()=>reject(read.error);};});},sourceKey+'\n'+chapter+'/novel');assert.equal(novel.readerAnchor.blockIndex,12);assert.equal(novel.readerAnchor.offset,7);
 const recentKey='moya-source-recent:'+sourceKey;assert.equal(JSON.parse(await stored(pb,recentKey))[0].imageUrl,undefined);
 await pb.locator('#recentFeatured .primary-btn').click();await pb.locator('#reader:not([hidden])').waitFor();await pb.waitForFunction(()=>document.getElementById('readerPage').value==='3');
 assert.equal(JSON.parse(await stored(pb,recentKey))[0].imageUrl,base+'/fixture-cover','resume refetches cover from source on the new device');
 await pb.locator('#back').click();await pb.locator('#detail:not([hidden])').waitFor();await flush(pb);await flush(pa);
 // Concurrent different works merge, while deletion wins against a stale offline edit of the same work.
 await b.setOffline(true);await pb.evaluate(async({recentKey,work,chapter})=>{const {localStorage:s}=await import('/account-storage.js');s.setItem(recentKey,JSON.stringify([{url:work,title:'Offline stale',chapterUrl:chapter,updatedAt:200}]));},{recentKey,work,chapter});
 await pa.evaluate(async key=>(await import('/account-storage.js')).localStorage.setItem(key,'[]'),recentKey);assert.equal(await flush(pa),true);
 await b.setOffline(false);assert.equal(await flush(pb),true);assert.deepEqual(JSON.parse(await stored(pb,recentKey)),[]);
 await pa.evaluate(async({recentKey,work})=>(await import('/account-storage.js')).localStorage.setItem(recentKey,JSON.stringify([{url:work+'/a',title:'A',updatedAt:300}])),{recentKey,work});
 await pb.evaluate(async({recentKey,work})=>(await import('/account-storage.js')).localStorage.setItem(recentKey,JSON.stringify([{url:work+'/b',title:'B',updatedAt:301}])),{recentKey,work});
 await flush(pa);await flush(pb);await flush(pa);assert.equal(JSON.parse(await stored(pa,recentKey)).length,2);
 await a.setOffline(true);await pa.evaluate(async()=>{const {localStorage:s}=await import('/account-storage.js');s.setItem('moya-source-repositories',JSON.stringify(['https://offline.example/index.json']));});assert.equal(await flush(pa),false);
 await a.setOffline(false);await pa.reload();await pa.locator('body[data-auth=ready]').waitFor();await flush(pa);await flush(pb);assert.deepEqual(JSON.parse(await stored(pb,'moya-source-repositories')),['https://offline.example/index.json']);
 assert.deepEqual(errors,[]);console.log('PASS: two devices sync records, positions, repositories and pins; omit images/settings; restore covers on resume; preserve offline changes; merge independent edits and propagate deletions');
}finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
