import { localStorage, indexedDB, observeStorage, accountId } from '/account-storage.js';
const metaKey='moyami-sync-meta', pendingPrefix='moyami-sync-pending:';
let enabled=false, applying=false, timer, running, channel, retry=15000, lastPull=0;
const parse=(value,fallback)=>{try{return JSON.parse(value)??fallback;}catch{return fallback;}};
const keyOf=(kind,...identity)=>JSON.stringify([kind,...identity]);
const pick=(value,names)=>Object.fromEntries(names.filter(name=>value?.[name]!==undefined).map(name=>[name,value[name]]));
const metadata=()=>parse(localStorage.getItem(metaKey),{revision:0,versions:{}});
const pending=()=>Object.keys(localStorage).filter(key=>key.startsWith(pendingPrefix)).map(key=>({storageKey:key,...parse(localStorage.getItem(key),{})})).filter(row=>row.key);
const status=text=>{const node=document.getElementById('syncStatus');if(node)node.textContent=text;};
function later(){if(!timer)timer=setTimeout(()=>{timer=null;void flushSync();},retry);}
export function queueSync(key,value){
  if(!enabled||applying)return;
  const storageKey=pendingPrefix+key,previous=parse(localStorage.getItem(storageKey),null);
  localStorage.setItem(storageKey,JSON.stringify({key,value,base:previous?.base??metadata().versions[key]??0,id:crypto.randomUUID()}));
  status('변경사항을 이 기기에 보관했습니다. 곧 동기화합니다.');later();
}
export function queueProgress(sourceKey,chapterUrl,value){queueSync(keyOf('progress',...sourceKey.split('\n'),chapterUrl),pick(value,['page','totalPages','ratio','readerAnchor','updatedAt']));}
function storageRows(key,value){
  const rows=new Map(),data=parse(value,null);
  if(key==='moya-source-repositories'&&Array.isArray(data))for(const url of data)rows.set(keyOf('repo',url),{});
  else if(key==='moya-source-pins'&&Array.isArray(data))for(const row of data)rows.set(keyOf('pin',row.repositoryUrl,row.sourceId),pick(row,['sourceName','itemType']));
  else if(key.startsWith('moya-source-recent:')&&Array.isArray(data))for(const row of data)rows.set(keyOf('recent',...key.slice(19).split('\n'),row.url),pick(row,['title','author','sourceName','chapterUrl','chapterTitle','updatedAt']));
  else if(key.startsWith('moya-chapter-marks:')&&data)for(const [url,row] of Object.entries(data))if(typeof row.read==='boolean')rows.set(keyOf('mark',...key.slice(19).split('\n'),url),pick(row,['read','updatedAt']));
  return rows;
}
function changed(key,before,after){
  if(!enabled||applying)return;
  const old=storageRows(key,before),next=storageRows(key,after);
  for(const [id,value] of next)if(JSON.stringify(old.get(id))!==JSON.stringify(value))queueSync(id,value);
  for(const id of old.keys())if(!next.has(id))queueSync(id,null);
}
function writeLocal(key,value){applying=true;try{localStorage.setItem(key,JSON.stringify(value));}finally{applying=false;}}
function database(){return new Promise((resolve,reject)=>{const req=indexedDB.open('moya-source-lite',2);req.onupgradeneeded=()=>{for(const name of ['state','progress'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function progressRows(){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('progress'),store=tx.objectStore('progress'),keys=store.getAllKeys(),values=store.getAll();tx.oncomplete=()=>resolve(keys.result.map((key,i)=>[key,values.result[i]]));tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function apply(key,value,expectedId){
  const [kind,repo,id,url,chapter]=JSON.parse(key);
  if(kind==='progress'){
    const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('progress','readwrite'),store=tx.objectStore('progress'),progressKey=`${repo}\n${id}\n${url}`,latest=parse(localStorage.getItem(pendingPrefix+key),null);if(!latest||latest.id===expectedId){if(value)store.put(value,progressKey);else store.delete(progressKey);}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}return;
  }
  if(kind==='repo'){
    const key='moya-source-repositories',rows=parse(localStorage.getItem(key),[]).filter(row=>row!==repo);if(value)rows.push(repo);writeLocal(key,rows);return;
  }
  if(kind==='pin'){
    const key='moya-source-pins',rows=parse(localStorage.getItem(key),[]).filter(row=>row.repositoryUrl!==repo||row.sourceId!==id);if(value)rows.push({repositoryUrl:repo,sourceId:id,...value});writeLocal(key,rows.slice(0,30));return;
  }
  if(kind==='recent'){
    const key=`moya-source-recent:${repo}\n${id}`,rows=parse(localStorage.getItem(key),[]),previous=rows.find(row=>row.url===url),next=rows.filter(row=>row.url!==url);
    // Preserve a cover already fetched on this device; cover URLs and image bytes never travel to the server.
    if(value)next.push({...value,url,...(previous?.imageUrl?{imageUrl:previous.imageUrl}:{})});
    writeLocal(key,next.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,20));return;
  }
  if(kind==='mark'){
    const key=`moya-chapter-marks:${repo}\n${id}\n${url}`,rows=parse(localStorage.getItem(key),{});
    if(value)rows[chapter]={...rows[chapter],...value};else if(rows[chapter]){delete rows[chapter].read;delete rows[chapter].updatedAt;}
    writeLocal(key,rows);
  }
}
async function requestPage(since,changes){
  const response=await fetch('/api/sync'+(changes.length?'':`?since=${since}`),{cache:'no-store',signal:AbortSignal.timeout(8000),...(changes.length?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({since,changes})}:{})});
  if(response.status===401){dispatchEvent(new Event('moyami-session-expired'));throw new Error('access_denied');}
  const result=await response.json();if(!response.ok)throw new Error(result.error);
  if(result.userId!==accountId()){dispatchEvent(new Event('moyami-session-expired'));throw new Error('access_denied');}
  return result;
}
// Assemble a complete delta before advancing local metadata or acknowledging writes.
// A failed page leaves the durable outbox and cursor intact for a safe retry.
async function request(since,changes){
  const rows={};
  for(let page=0;page<64;page++){
    const result=await requestPage(since,page===0?changes:[]);
    Object.assign(rows,result.rows);
    if(!result.more)return {...result,rows};
    if(!Number.isSafeInteger(result.revision)||result.revision<=since)throw new Error('invalid_sync_cursor');
    since=result.revision;
  }
  throw new Error('sync_busy');
}
async function merge(result,sent){
  const meta=metadata(), sentByKey=new Map(sent.map(row=>[row.key,row]));
  for(const [key,row] of Object.entries(result.rows)){
    const storageKey=pendingPrefix+key,current=parse(localStorage.getItem(storageKey),null),outgoing=sentByKey.get(key);
    if(current && current.id!==outgoing?.id){
      // A new local edit arrived while the request was running; retain it against the new revision.
      localStorage.setItem(storageKey,JSON.stringify({...current,base:row.version}));
    }else{
      await apply(key,row.value,current?.id);
      const latest=parse(localStorage.getItem(storageKey),null);
      if(latest && latest.id!==current?.id)localStorage.setItem(storageKey,JSON.stringify({...latest,base:row.version}));
      else if(current)localStorage.removeItem(storageKey);
    }
    meta.versions[key]=row.version;
  }
  // An accepted no-op still returns a new row revision; conflicts return the current row as well.
  meta.revision=result.revision;localStorage.setItem(metaKey,JSON.stringify(meta));
  if(Object.keys(result.rows).length){dispatchEvent(new Event('moyami-synced'));channel?.postMessage('updated');}
}
async function importLocal(remote){
  if(localStorage.getItem('moyami-sync-imported'))return;
  const rows=new Map();for(const key of Object.keys(localStorage))for(const row of storageRows(key,localStorage.getItem(key)))rows.set(...row);
  for(const [key,value] of await progressRows()){const parts=String(key).split('\n');if(parts.length===3)rows.set(keyOf('progress',...parts),pick(value,['page','totalPages','ratio','readerAnchor','updatedAt']));}
  for(const [key,value] of rows)if(!remote.rows[key] && !localStorage.getItem(pendingPrefix+key))queueSync(key,value);
  localStorage.setItem('moyami-sync-imported','1');
}
export async function flushSync(){
  if(!enabled)return true;if(running)return running;
  clearTimeout(timer);timer=null;
  const task=async()=>{
    try{
      let rows=pending();
      if(!localStorage.getItem('moyami-sync-imported')){
        const remote=await request(0,[]);await importLocal(remote);await merge(remote,[]);rows=pending();
      }else if(!rows.length){await merge(await request(metadata().revision,[]),[]);}
      for(let batch=0;rows.length&&batch<100;batch++){
        const sent=[];let bytes=0;
        for(const row of rows){const size=new TextEncoder().encode(JSON.stringify(row)).length;if(sent.length && (bytes+size>40000 || sent.length>=20))break;sent.push(row);bytes+=size;}
        const changes=sent.map(({key,base,value})=>({key,base,value}));
        await merge(await request(metadata().revision,changes),sent);rows=pending();
      }
      retry=15000;lastPull=Date.now();status(rows.length?'남은 변경사항을 준비 중입니다.':`동기화 완료 · ${new Date().toLocaleTimeString()}`);if(rows.length)later();return true;
    }catch(error){status(error.message==='sync_limit'?'동기화 저장 공간이 가득 찼습니다. 새 기록은 이 기기에 보관됩니다.':'동기화하지 못했습니다. 변경사항은 이 기기에 보관되며 연결되면 다시 시도합니다.');retry=Math.min(retry*2,300000);if(error.message!=='sync_limit')later();return false;}
  };
  running=(navigator.locks?navigator.locks.request(`moyami-sync:${accountId()}`,task):task()).finally(()=>{running=null;});return running;
}
export async function startSync(){
  enabled=true;observeStorage(changed);
  if(typeof BroadcastChannel==='function'){channel=new BroadcastChannel('moyami-sync:'+accountId());channel.onmessage=()=>dispatchEvent(new Event('moyami-synced'));}
  document.getElementById('syncNow')?.addEventListener('click',()=>void flushSync());
  addEventListener('online',()=>void flushSync());
  addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastPull>30000)void flushSync();});
  // Timed saves leave a durable outbox on close. No unbounded unload request or constant polling.
  await Promise.race([flushSync(),new Promise(resolve=>setTimeout(resolve,3000))]);
}
