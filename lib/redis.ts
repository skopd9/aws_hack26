import 'server-only';
import Redis from 'ioredis';

declare global {
  var __ippulse_redis: Redis | undefined;
  var __ippulse_redis_blocking: Redis | undefined;
}

function createClient(opts: { blocking?: boolean } = {}): Redis {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    // Blocking commands (XREAD BLOCK) must NOT be killed by maxRetriesPerRequest,
    // otherwise ioredis aborts the long-poll before any entry can arrive.
    maxRetriesPerRequest: opts.blocking ? null : 2,
    enableOfflineQueue: !!opts.blocking,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 500, 5000)
  });

  let loggedError = false;
  client.on('error', (err) => {
    if (!loggedError) {
      console.warn(
        `[redis${opts.blocking ? ':blocking' : ''}] connection error (further errors suppressed): ${err.message}`
      );
      loggedError = true;
    }
  });

  return client;
}

export const redis: Redis = global.__ippulse_redis ?? createClient();
export const redisBlocking: Redis =
  global.__ippulse_redis_blocking ?? createClient({ blocking: true });

if (process.env.NODE_ENV !== 'production') {
  global.__ippulse_redis = redis;
  global.__ippulse_redis_blocking = redisBlocking;
}

export async function safeRedisOp<T>(
  op: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isConnErr =
      msg.includes('ECONNREFUSED') ||
      msg.includes('max retries') ||
      msg.includes('Stream isn') || // "Stream isn't writeable" — offline queue disabled
      msg.includes('enableOfflineQueue');
    if (!isConnErr) {
      console.warn('[redis] op failed:', msg);
    }
    return fallback;
  }
}

export const TTL = {
  session: 60 * 60 * 24,
  stackProfile: 60 * 60 * 24 * 7,
  toolResultCache: 60 * 60
} as const;

export function sessionKey(tenant: string) {
  return `tenant:${tenant}:session`;
}
export function stackProfileKey(tenant: string) {
  return `tenant:${tenant}:stack_profile`;
}
export function historyKey(tenant: string) {
  return `tenant:${tenant}:history`;
}
export function toolCacheKey(tool: string, argHash: string) {
  return `cache:${tool}:${argHash}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function cacheSet<T>(key: string, value: T, ttlSec: number) {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
}
