import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Evaluate } from '../server/runtime/redis-jobs.js';
import { FileAuthStore, RedisAuthStore, type AuthStore } from '../server/auth/store.js';
import { validateSync, MAX_SYNC_BYTES } from '../server/sync/document.js';
const port=Number(process.env.REDIS_TEST_PORT);
const evaluate: Evaluate = (script, keys, args) => new Promise((resolve, reject) => {
  const parts = ['EVAL', script, String(keys.length), ...keys, ...args];
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(5000, () => socket.destroy(new Error('redis_test_timeout')));
  let buffer = Buffer.alloc(0);
  socket.on('error', reject);
  socket.on('connect', () => socket.write(Buffer.concat([
    Buffer.from(`*${parts.length}\r\n`), ...parts.flatMap(part => [Buffer.from(`$${Buffer.byteLength(part)}\r\n`), Buffer.from(part), Buffer.from('\r\n')])
  ])));
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    const at = buffer.indexOf('\r\n');
    if (at < 0) return;
    if (buffer[0] !== 36) { socket.destroy(); reject(new Error(buffer.toString())); return; }
    const length = Number(buffer.subarray(1, at).toString());
    if (buffer.length >= at + 2 + length + 2) {
      socket.end(); resolve(buffer.subarray(at + 2, at + 2 + length).toString());
    }
  });
});


const key=JSON.stringify(['recent','https://example.com/index.json','1','https://example.com/work']);
async function exercise(a:AuthStore,b:AuthStore){
 const write=(store:AuthStore,changes:any[],userId='alice',since=0)=>store.call('syncWrite',{userId,...validateSync({since,changes})});
 const create={key,base:0,value:{title:'작품',updatedAt:1}};
 const simultaneous=await Promise.all([write(a,[create]),write(b,[{...create,value:{title:'다른 기기',updatedAt:2}}])]);
 assert.equal(Math.max(...simultaneous.map(row=>row.revision)),1,'only one competing mutation accepted');
 const snapshot=await b.call('syncRead',{userId:'alice',since:0,changes:[]});assert.equal(snapshot.revision,1);
 assert.deepEqual((await a.call('syncRead',{userId:'bob',since:0,changes:[]})).rows,{});
 assert.deepEqual((await a.call('syncRead',{userId:'alice',since:1,changes:[]})).rows,{});
 await write(a,[{key,base:1,value:null}]);
 const stale=await write(b,[create]);assert.equal(stale.rows[key].value,null,'offline stale record cannot resurrect a deletion');assert.equal(stale.revision,2);
 const other=JSON.stringify(['repo','https://other.example/index.json']);await write(a,[{key:other,base:0,value:{}}]);
 const delta=await b.call('syncRead',{userId:'alice',since:2,changes:[]});assert.deepEqual(Object.keys(delta.rows),[other]);
 const missing=await write(a,[{key:JSON.stringify(['repo','https://missing.example/index.json']),base:99,value:{}}]);
 assert.equal(Object.values(missing.rows).some((row:any)=>row.version===0&&row.value===null),true);
 // Re-reading the same work/chapter must overwrite its latest position, not append a change log.
 const progressKey=JSON.stringify(['progress','https://example.com/index.json','1','https://example.com/chapter/1']);
 let versions={recent:0,progress:0},firstSize=0;
 for(let page=1;page<=200;page++){
   const value=await write(page%2?a:b,[{key,base:versions.recent,value:{title:'작품',chapterUrl:'https://example.com/chapter/1',updatedAt:1000}},{key:progressKey,base:versions.progress,value:{page,totalPages:200,updatedAt:1000}}],'overwrite');
   versions={recent:value.rows[key].version,progress:value.rows[progressKey].version};
   assert.equal(Object.keys(value.rows).length,2);
   if(page===1)firstSize=Buffer.byteLength(JSON.stringify(value));
 }
 const latest=await b.call('syncRead',{userId:'overwrite',since:0,changes:[]});
 assert.equal(Object.keys(latest.rows).length,2,'200 saves keep two records, with no historical copies');
 assert.equal(latest.rows[progressKey].value.page,200);
 assert.ok(Buffer.byteLength(JSON.stringify(latest))<=firstSize+32,'only numeric digit lengths may grow');
 // The larger account accepts >1MiB, while an over-quota batch is atomic.
 const batch=(start:number)=>Array.from({length:100},(_,i)=>({key:JSON.stringify(['progress','https://example.com/index.json','1','https://example.com/big/'+(start+i)]),base:0,value:{readerAnchor:{bookId:'a'.repeat(8000),sectionId:'b'.repeat(7000)}}}));
 for(let i=0;i<2;i++)await write(a,batch(i*100),'large');
 const large=await b.call('syncRead',{userId:'large',since:0,changes:[]});
 assert.ok(Buffer.byteLength(JSON.stringify(large))>2.8*1024*1024);
 assert.ok(Buffer.byteLength(JSON.stringify(large))<MAX_SYNC_BYTES);
 await assert.rejects(write(a,batch(200),'large'),/sync_limit/);
 assert.deepEqual(await b.call('syncRead',{userId:'large',since:0,changes:[]}),large);
 assert.equal((await a.call('syncRead',{userId:'alice',since:0,changes:[]})).revision,3);
}
test('sync accepts only small reading metadata, never covers, secrets or reader settings',()=>{
 for(const value of [{imageUrl:'https://example.com/image'},{cover:'base64'},{password:'secret'},{fontSize:24},{readerAnchor:{unexpected:'text'}}])assert.throws(()=>validateSync({since:0,changes:[{key,base:0,value}]}),/invalid_sync/);
 assert.throws(()=>validateSync({since:0,changes:[{key:JSON.stringify(['repo','javascript:alert(1)']),base:0,value:{}}]}),/invalid_sync/);
});
test('local sync: isolation, CAS conflicts, deletion, delta reads, atomic quota',async()=>{
 const dir=await mkdtemp(`${tmpdir()}/moyami-sync-`);const store=new FileAuthStore(`${dir}/auth.json`);
 try{await exercise(store,store);assert.equal((await new FileAuthStore(`${dir}/auth.json`).call('syncRead',{userId:'alice',since:0,changes:[]})).revision,3);}finally{await rm(dir,{recursive:true,force:true});}
});
test('Redis sync: independent instances merge atomically and enforce the same bounds',{skip:!port},async()=>{
 const namespace=randomUUID();await exercise(new RedisAuthStore(evaluate,namespace),new RedisAuthStore(evaluate,namespace));
});
