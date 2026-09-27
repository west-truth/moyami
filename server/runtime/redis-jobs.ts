import { createHash } from 'node:crypto';

// All transitions use the primary through EVAL, including status reads. Each key
// shares a Redis cluster hash tag. No extension code or user state is stored here.
export const jobScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local mode, id = ARGV[1], ARGV[2]
local input = cjson.decode(ARGV[3])
local function fail(code) return cjson.encode({error=code}) end
local function remove()
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], id)
end
local function save(job)
  redis.call('SET', KEYS[1], cjson.encode(job), 'PX', math.max(1, job.expires-now))
end
if mode == 'reserve' then
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
  if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('ZCARD', KEYS[2]) >= 16 then return fail('runtime_busy') end
  local job = {phase='preparing', expires=now+60000, requests=0, bytes=0, pending={}}
  save(job)
  redis.call('ZADD', KEYS[2], job.expires, id)
  redis.call('PEXPIRE', KEYS[2], 620000)
  return cjson.encode({ok=true})
end
if mode == 'cancel' then remove(); return cjson.encode({ok=true}) end
local raw = redis.call('GET', KEYS[1])
if not raw then redis.call('ZREM', KEYS[2], id); return fail('runtime_expired') end
local job = cjson.decode(raw)
if job.expires <= now then remove(); return fail('runtime_expired') end
if mode == 'activate' then
  if job.phase ~= 'preparing' then return fail('runtime_expired') end
  job.phase, job.action, job.sourceId, job.codeDigest = 'active', input.action, input.sourceId, input.codeDigest
  job.expires = now + input.timeoutMs + 10000
  redis.call('ZADD', KEYS[2], job.expires, id)
  redis.call('PEXPIRE', KEYS[2], 620000)
  save(job)
  return cjson.encode({ok=true})
end
if job.phase ~= 'active' then return fail('runtime_expired') end
local pending = 0
for _ in pairs(job.pending) do pending = pending+1 end
if mode == 'acquire' then
  if job.action == 'metadata' or job.action == 'preferences' or pending >= 4 or job.requests >= 240 then return fail('permission_denied') end
  if job.pending[input.requestId] then return fail('permission_denied') end
  job.requests = job.requests+1
  job.pending[input.requestId] = true
  save(job)
elseif mode == 'settle' then
  if not job.pending[input.requestId] then return fail('runtime_expired') end
  job.pending[input.requestId] = nil
  job.bytes = job.bytes+input.bytes
  if job.bytes > 33554432 then remove(); return fail('source_body_limit') end
  save(job)
elseif mode == 'finish' then
  if pending > 0 then return fail('invalid_source_result') end
  remove()
  return cjson.encode({action=job.action, sourceId=job.sourceId, codeDigest=job.codeDigest})
elseif mode ~= 'status' then return fail('invalid_request') end
return cjson.encode({ok=true})
`;

export type Evaluate = (script: string, keys: string[], args: string[]) => Promise<string>;
export type JobContext = { action: string; sourceId: string; codeDigest: string };

export function redisRestEvaluator(url: string, token: string): Evaluate {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token)
    throw new Error('redis_configuration_invalid');
  return async (script, keys, args) => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(['EVAL', script, keys.length, ...keys, ...args]),
        signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw new Error('unavailable');
      const value = await response.json() as { result?: unknown; error?: unknown };
      if (value.error || typeof value.result !== 'string') throw new Error('unavailable');
      return value.result;
    } catch { throw new Error('runtime_store_unavailable'); }
  };
}

export class RedisJobs {
  private prefix: string;
  constructor(private evaluate: Evaluate, namespace: string) {
    this.prefix = `moya-lite:{${createHash('sha256').update(namespace).digest('hex').slice(0, 24)}}`;
  }
  async call(mode: string, token: unknown, input: Record<string, unknown> = {}): Promise<JobContext & { ok?: boolean }> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error('runtime_expired');
    const id = createHash('sha256').update(token).digest('hex');
    let reply: any;
    try {
      reply = JSON.parse(await this.evaluate(jobScript, [`${this.prefix}:job:${id}`, `${this.prefix}:active`], [mode, id, JSON.stringify(input)]));
    } catch { throw new Error('runtime_store_unavailable'); }
    if (!reply || typeof reply !== 'object') throw new Error('runtime_store_unavailable');
    if (reply.error) throw new Error(['runtime_busy', 'runtime_expired', 'permission_denied', 'invalid_source_result', 'source_body_limit'].includes(reply.error)
      ? reply.error : 'runtime_store_unavailable');
    return reply;
  }
}
