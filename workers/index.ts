import { redis } from '../lib/redis';

const INTERVAL_MS = 60_000;
const WORKER_ID = process.env.HOSTNAME ?? 'worker-local';

async function heartbeat() {
  const key = `worker:heartbeat:${WORKER_ID}`;
  await redis.set(key, String(Date.now()), 'EX', 300);
  console.log(`[worker ${WORKER_ID}] heartbeat @ ${new Date().toISOString()}`);
}

async function main() {
  console.log(`[worker ${WORKER_ID}] starting (on-demand only scaffold; cron jobs are future work)`);

  while (true) {
    try {
      await heartbeat();
    } catch (err) {
      console.error(`[worker ${WORKER_ID}] heartbeat failed:`, err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
