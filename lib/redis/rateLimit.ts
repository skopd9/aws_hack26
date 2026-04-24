import 'server-only';
import { redis, safeRedisOp } from '../redis';

const TOKEN_BUCKET_LUA = `
local key       = KEYS[1]
local capacity  = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local cost      = tonumber(ARGV[3])
local now       = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local last   = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last = now
end

local delta = math.max(0, now - last)
tokens = math.min(capacity, tokens + delta * refillPerSec)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, math.ceil(capacity / refillPerSec) + 60)

return { allowed, math.floor(tokens) }
`;

export type RateLimitOptions = {
  capacity?: number;
  refillPerSec?: number;
  cost?: number;
};

export async function tryConsume(
  tenant: string,
  opts: RateLimitOptions = {}
): Promise<{ allowed: boolean; remaining: number }> {
  const capacity = opts.capacity ?? 30;
  const refillPerSec = opts.refillPerSec ?? 0.5;
  const cost = opts.cost ?? 1;
  const now = Math.floor(Date.now() / 1000);

  const res = await safeRedisOp<[number, number]>(
    () =>
      redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        `tenant:${tenant}:rl`,
        String(capacity),
        String(refillPerSec),
        String(cost),
        String(now)
      ) as Promise<[number, number]>,
    [1, capacity]
  );

  return { allowed: res[0] === 1, remaining: res[1] };
}
