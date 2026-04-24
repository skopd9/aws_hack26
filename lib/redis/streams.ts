import 'server-only';
import { redis, redisBlocking, safeRedisOp } from '../redis';

export const TOOL_CALLS_STREAM = 'tool:calls';
const MAX_LEN = 10_000;

export type ToolCallEvent = {
  tenant: string;
  tool: string;
  args: unknown;
  // 'ok'    — a single attempt succeeded
  // 'retry' — at least one attempt failed but a later attempt succeeded
  // 'error' — all retry attempts failed; verbose error in `error`
  outcome: 'ok' | 'retry' | 'error';
  durationMs: number;
  attempts?: number;
  error?: string;
  ts: number;
};

export async function recordToolCall(event: ToolCallEvent): Promise<string> {
  const id = await safeRedisOp(
    () =>
      redis.xadd(
        TOOL_CALLS_STREAM,
        'MAXLEN',
        '~',
        String(MAX_LEN),
        '*',
        'tenant',
        event.tenant,
        'tool',
        event.tool,
        'args',
        JSON.stringify(event.args).slice(0, 1024),
        'outcome',
        event.outcome,
        'durationMs',
        String(event.durationMs),
        'attempts',
        String(event.attempts ?? 1),
        'error',
        event.error ?? '',
        'ts',
        String(event.ts)
      ),
    null
  );
  return id ?? '';
}

function entryToEvent(fields: string[]): ToolCallEvent {
  const obj = fieldsToObject(fields);
  return {
    tenant: obj.tenant ?? '',
    tool: obj.tool ?? '',
    args: safeParse(obj.args),
    outcome: (obj.outcome as ToolCallEvent['outcome']) ?? 'ok',
    durationMs: Number(obj.durationMs ?? 0),
    attempts: obj.attempts ? Number(obj.attempts) : undefined,
    error: obj.error || undefined,
    ts: Number(obj.ts ?? Date.now())
  };
}

export async function readRecentToolCalls(
  count = 20
): Promise<{ id: string; event: ToolCallEvent }[]> {
  const res = await safeRedisOp<[string, string[]][] | null>(
    () =>
      redis.xrevrange(TOOL_CALLS_STREAM, '+', '-', 'COUNT', count) as Promise<
        [string, string[]][] | null
      >,
    null
  );
  if (!res) return [];
  return res
    .map(([id, fields]) => ({ id, event: entryToEvent(fields) }))
    .reverse();
}

export async function* readToolCallsFrom(
  lastId = '$',
  blockMs = 5000
): AsyncGenerator<{ id: string; event: ToolCallEvent }> {
  let cursor = lastId;
  while (true) {
    let res: [string, [string, string[]][]][] | null = null;
    try {
      // Use the blocking-mode client so XREAD BLOCK isn't killed by
      // maxRetriesPerRequest on the default client.
      res = (await redisBlocking.xread(
        'BLOCK',
        blockMs,
        'STREAMS',
        TOOL_CALLS_STREAM,
        cursor
      )) as [string, [string, string[]][]][] | null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[streams] xread failed:', msg);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    if (!res) continue; // BLOCK timed out with no new entries — just re-poll.

    for (const [, entries] of res) {
      for (const [id, fields] of entries) {
        cursor = id;
        yield { id, event: entryToEvent(fields) };
      }
    }
  }
}

function fieldsToObject(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    out[fields[i]] = fields[i + 1];
  }
  return out;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
