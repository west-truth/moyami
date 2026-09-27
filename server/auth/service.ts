import { createHash, createHmac, randomBytes, randomUUID, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AuthStore, User } from './store.js';
const scrypt=promisify(rawScrypt);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const safeUser=(user:User)=>({id:user.id,username:user.username,role:user.role});
export class AuthService {
  constructor(private store:AuthStore,private bootstrapKey:string,private rateSecret:string){}
  async status(){return this.store.call('status');}
  async rate(address:string,kind:string,limit=15){await this.store.call('rate',{rateId:createHmac('sha256',this.rateSecret).update(kind+':'+address).digest('hex'),limit});}
  private credentials(input:any){
    if(!input||typeof input.username!=='string'||!/^[a-zA-Z0-9_-]{3,32}$/.test(input.username)||typeof input.password!=='string'||input.password.length<10||input.password.length>128)throw new Error('invalid_credentials_format');
    return {username:input.username.toLowerCase(),password:input.password};
  }
  async register(input:unknown){
    const {username,password}=this.credentials(input),key=(input as any).key;
    if(typeof key!=='string'||key.length<32||key.length>256)throw new Error('signup_key_invalid');
    const salt=randomBytes(16).toString('hex'),hash=await scrypt(password,salt,64) as Buffer;
    const user:User={id:randomUUID(),username,password:`${salt}:${hash.toString('hex')}`,role:'reader'};
    return safeUser(await this.store.call('register',{username,user,inviteId:digest(key),bootstrap:timingSafeEqual(Buffer.from(digest(key)),Buffer.from(digest(this.bootstrapKey)))}));
  }
  async login(input:unknown){
    const {username,password}=this.credentials(input),user=await this.store.call('user',{username}) as User|false;
    const [salt,expected]=user?user.password.split(':'):['moyami-missing-user','00'.repeat(64)];
    const actual=await scrypt(password,salt,64) as Buffer;
    if(!user||!timingSafeEqual(actual,Buffer.from(expected,'hex')))throw new Error('login_failed');
    return safeUser(user);
  }
  async createSession(user:ReturnType<typeof safeUser>){
    const token=randomBytes(32).toString('base64url');
    await this.store.call('session',{sessionId:digest(token),session:{user,expires:Date.now()+7*86400_000}});return token;
  }
  async authenticate(token:string){if(!/^[\w-]{43}$/.test(token))return false;return this.store.call('authenticate',{sessionId:digest(token)}) as Promise<ReturnType<typeof safeUser>|false>;}
  async logout(token:string){if(/^[\w-]{43}$/.test(token))await this.store.call('logout',{sessionId:digest(token)});}
  async invite(){const key=randomBytes(32).toString('base64url'),id=digest(key),expires=Date.now()+86400_000;await this.store.call('invite',{inviteId:id,invite:{expires}});return {key,id,expires};}
  async revokeInvite(id:unknown){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new Error('invalid_request');await this.store.call('revokeInvite',{inviteId:id});}
}
