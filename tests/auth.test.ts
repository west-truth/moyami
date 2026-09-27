import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Evaluate } from '../server/runtime/redis-jobs.js';
import { FileAuthStore, RedisAuthStore, type AuthStore } from '../server/auth/store.js';
import { AuthService } from '../server/auth/service.js';
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

async function exercise(store:()=>AuthStore) {
 const key='bootstrap-'.repeat(5),auth=()=>new AuthService(store(),key,'rate-secret');
 const a=auth(),b=auth(),password='a-long-password';
 const first=await Promise.allSettled([a.register({username:'owner1',password,key}),b.register({username:'owner2',password,key})]);
 assert.equal(first.filter(row=>row.status==='fulfilled').length,1,'only one first administrator');
 const owner=(first.find(row=>row.status==='fulfilled') as PromiseFulfilledResult<any>).value;
 assert.equal(owner.role,'admin');assert.equal('password' in owner,false);
 assert.equal((await auth().status()).initialized,true);
 const invite=await a.invite();
 const joins=await Promise.allSettled([a.register({username:'member1',password,key:invite.key}),b.register({username:'member2',password,key:invite.key})]);
 assert.equal(joins.filter(row=>row.status==='fulfilled').length,1,'invitation consumed atomically');
 const member=(joins.find(row=>row.status==='fulfilled') as PromiseFulfilledResult<any>).value;
 assert.equal(member.role,'reader');
 assert.equal((await b.login({username:owner.username.toUpperCase(),password})).id,owner.id);
 await assert.rejects(a.login({username:owner.username,password:'another-long-password'}),/login_failed/);
 const token=await a.createSession(owner);assert.equal((await b.authenticate(token) as any).id,owner.id);
 await b.logout(token);assert.equal(await a.authenticate(token),false);
 const revoked=await a.invite();await b.revokeInvite(revoked.id);
 await assert.rejects(a.register({username:'third',password,key:revoked.key}),/signup_key_invalid/);
 await a.rate('peer','test',1);await assert.rejects(b.rate('peer','test',1),/auth_rate_limited/);
 const raw=store();await raw.call('session',{sessionId:'expired',session:{user:owner,expires:Date.now()-1000}});
 assert.equal(await raw.call('authenticate',{sessionId:'expired'}),false);
}
test('file accounts persist without plaintext passwords, invitation keys or sessions',async()=>{
 const directory=await mkdtemp(`${tmpdir()}/moyami-store-`),file=`${directory}/auth.json`,store=new FileAuthStore(file);
 try {await exercise(()=>store);const auth=new AuthService(new FileAuthStore(file),'bootstrap-'.repeat(5),'rate-secret');assert.equal((await auth.status()).initialized,true);
 const bytes=await readFile(file,'utf8');assert.equal(bytes.includes('a-long-password'),false);assert.equal(bytes.includes('bootstrap-'),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('Redis accounts: concurrent registration/invitation, multi-instance sessions and expiry',{skip:!port},async()=>{
 const namespace=randomUUID();await exercise(()=>new RedisAuthStore(evaluate,namespace));
});
