import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness + readiness in one. Returns 200 only when we can complete a
// round-trip to Redis (PING -> PONG) within the timeout. The Docker
// HEALTHCHECK in Dockerfile.web hits this endpoint, so a Redis outage
// flips the container to `unhealthy` automatically.
export async function GET() {
  const start = Date.now();
  const url = redactedRedisUrl();

  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redis ping timeout (1s)')), 1000)
      )
    ]);
    return NextResponse.json({
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      redis: { reachable: true, response: pong, url },
      latencyMs: Date.now() - start,
      ts: new Date().toISOString()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        status: 'degraded',
        uptimeSec: Math.round(process.uptime()),
        redis: { reachable: false, error: message, url },
        latencyMs: Date.now() - start,
        ts: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}

// Strip any inline credentials before exposing on a debug surface.
function redactedRedisUrl(): string {
  const raw = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return raw.replace(/\/\/[^@/]*@/, '//***@');
}
