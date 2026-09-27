import { localStorage, indexedDB } from "/account-storage.js";
// Font blobs are kept separately from source state and never sent to a server.
import { loadUserFont, unloadUserFont } from '/moya-ui.js';
let database;
function open() { return database ||= new Promise((resolve,reject)=>{const r=indexedDB.open('moya-source-fonts',1);r.onupgradeneeded=()=>r.result.createObjectStore('fonts',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
async function transaction(mode,action) {const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('fonts',mode),request=action(tx.objectStore('fonts'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);});}
export const fonts = {
  list:()=>transaction('readonly',s=>s.getAll()),
  async add(file) {
    if(!file||file.size>10*1024*1024||! /\.(woff2?|ttf|otf)$/i.test(file.name))throw new Error('10MB 이하의 WOFF·WOFF2·TTF·OTF 파일을 선택하세요.');
    const contentHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const existing=await this.list();if(existing.length>=10&&!existing.some(f=>f.id===contentHash))throw new Error('글꼴은 최대 10개까지 저장할 수 있습니다.');
    const asset={id:contentHash,contentHash,name:file.name,style:'normal',weight:400,blob:file};
    await loadUserFont({getUserFontContent:async()=>file},asset);
    try {await transaction('readwrite',s=>s.put(asset));}catch(error){unloadUserFont(asset.id);throw error;}return asset.id;
  },
  async family(id) {const asset=await transaction('readonly',s=>s.get(id));return asset?loadUserFont({getUserFontContent:async()=>asset.blob},asset):undefined;},
  async remove(id) {await transaction('readwrite',s=>s.delete(id));unloadUserFont(id);},
};
