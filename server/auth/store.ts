import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { Evaluate } from '../runtime/redis-jobs.js';
export type User = { id: string; username: string; password: string; role: 'admin' | 'reader' };
export interface AuthStore { call(mode: string, input?: Record<string, unknown>): Promise<any> }
// All registration checks and invitation consumption happen in one primary transaction.
export const authScript = `
local op, data = ARGV[1], cjson.decode(ARGV[2])
local now = tonumber(redis.call('TIME')[1]) * 1000
local function done(value) return cjson.encode(value) end
local function fail(code) return done({error=code}) end
local function get(key) local v=redis.call('GET',key); if v then return cjson.decode(v) end end
if op=='status' then return done({initialized=redis.call('EXISTS',KEYS[1])==1}) end
if op=='user' then return done(get(KEYS[2]) or false) end
if op=='register' then
 local first=redis.call('EXISTS',KEYS[1])==0
 if first then if not data.bootstrap then return fail('signup_key_invalid') end
 else local invite=get(KEYS[3]);if not invite or invite.expires<=now then return fail('signup_key_invalid') end end
 if redis.call('EXISTS',KEYS[2])==1 then return fail('username_unavailable') end
 if tonumber(redis.call('GET',KEYS[1]) or '0')>=512 then return fail('account_limit') end
 data.user.role=first and 'admin' or 'reader'
 redis.call('SET',KEYS[2],cjson.encode(data.user));redis.call('INCR',KEYS[1])
 if not first then redis.call('DEL',KEYS[3]) end
 return done(data.user)
end
if op=='invite' then redis.call('SET',KEYS[3],cjson.encode(data.invite),'PX',math.max(1,data.invite.expires-now));return done({ok=true}) end
if op=='revokeInvite' then redis.call('DEL',KEYS[3]);return done({ok=true}) end
if op=='session' then redis.call('SET',KEYS[4],cjson.encode(data.session),'PX',math.max(1,data.session.expires-now));return done({ok=true}) end
if op=='authenticate' then local s=get(KEYS[4]);if not s or s.expires<=now then return done(false) end;return done(s.user) end
if op=='logout' then redis.call('DEL',KEYS[4]);return done({ok=true}) end
if op=='rate' then local n=redis.call('INCR',KEYS[5]);if n==1 then redis.call('PEXPIRE',KEYS[5],600000) end;if n>data.limit then return fail('auth_rate_limited') end;return done({ok=true}) end
return fail('invalid_request')
`;
export class RedisAuthStore implements AuthStore {
  private prefix: string;
  constructor(private evaluate: Evaluate, namespace = 'moyami') {
    this.prefix = `moyami-auth:{${createHash('sha256').update(namespace).digest('hex').slice(0,24)}}`;
  }
  async call(mode: string, input: Record<string, unknown> = {}) {
    const p=this.prefix;
    const result=JSON.parse(await this.evaluate(authScript,[`${p}:initialized`,`${p}:user:${input.username || '-'}`,`${p}:invite:${input.inviteId || '-'}`,`${p}:session:${input.sessionId || '-'}`,`${p}:rate:${input.rateId || '-'}`],[mode,JSON.stringify(input)]));
    if(result?.error)throw new Error(result.error);
    return result;
  }
}
type State = { users: Record<string, User>; invites: Record<string, any>; sessions: Record<string, any>; rates: Record<string, {count:number;expires:number}> };
export class FileAuthStore implements AuthStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  call(mode: string, input: Record<string, any> = {}): Promise<any> {
    const operation=this.queue.catch(()=>{}).then(async()=>{
      let state: State;
      try {state=JSON.parse(await readFile(this.file,'utf8'));}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={users:{},invites:{},sessions:{},rates:{}};}
      const now=Date.now();
      for(const group of [state.invites,state.sessions,state.rates])for(const [id,value] of Object.entries(group))if(value.expires<=now)delete group[id];
      let result: any={ok:true},write=true;
      if(mode==='status'){result={initialized:Object.keys(state.users).length>0};write=false;}
      else if(mode==='user'){result=Object.hasOwn(state.users,input.username)?state.users[input.username]:false;write=false;}
      else if(mode==='register'){
        const first=!Object.keys(state.users).length;
        if(first?!input.bootstrap:!state.invites[input.inviteId])throw new Error('signup_key_invalid');
        if(Object.hasOwn(state.users,input.username))throw new Error('username_unavailable');
        if(Object.keys(state.users).length>=512)throw new Error('account_limit');
        result={...input.user,role:first?'admin':'reader'};Object.defineProperty(state.users,input.username,{value:result,enumerable:true,configurable:true,writable:true});
        if(!first)delete state.invites[input.inviteId];
      }else if(mode==='invite')state.invites[input.inviteId]=input.invite;
      else if(mode==='revokeInvite')delete state.invites[input.inviteId];
      else if(mode==='session')state.sessions[input.sessionId]=input.session;
      else if(mode==='authenticate'){result=state.sessions[input.sessionId]?.user||false;write=false;}
      else if(mode==='logout')delete state.sessions[input.sessionId];
      else if(mode==='rate'){
        const row=state.rates[input.rateId]??={count:0,expires:now+600000};row.count++;
        if(row.count>input.limit)throw new Error('auth_rate_limited');
      }else throw new Error('invalid_request');
      if(write){await mkdir(dirname(this.file),{recursive:true,mode:0o700});await writeFile(this.file+'.tmp',JSON.stringify(state),{mode:0o600});await rename(this.file+'.tmp',this.file);}
      return result;
    });
    this.queue=operation;return operation;
  }
}
