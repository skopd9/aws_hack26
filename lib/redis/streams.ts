import 'server-only';
import { redis, safeRedisOp } from '../redis';

export const TOOL_CALLS_STREAM = 'tool:calls';
const MAX_LEN = 10_000;

export type ToolCallEvent = {
  tenant: string;
  tool: string;
  args: unknown;
  outcome: 'ok' | 'mock' | 'error';
  durationMs: number;
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
        'error',
        event.error ?? '',
        'ts',
        String(event.ts)
      ),
    null
  );
  return id ?? '';
}

export async function* readToolCallsFrom(
  lastId = '$',
  blockMs = 5000
): AsyncGenerator<{ id: string; event: ToolCallEvent }> {
  let cursor = lastId;
  while (true) {
    const res = await safeRedisOp<[string, [string, string[]][]][] | null>(
      () =>
        redis.xread(
          'BLOCK',
          blockMs,
          'STREAMS',
          TOOL_CALLS_STREAM,
          cursor
        ) as Promise<[string, [string, string[]][]][] | null>,
      null
    );

    if (!res) {
      await new Promise((r) => setTimeout(r, Math.min(blockMs, 2000)));
      continue;
    }

    for (const [, entries] of res) {
      for (const [id, fields] of entries) {
        cursor = id;
        const obj = fieldsToObject(fields);
        yield {
          id,
          event: {
            tenant: obj.tenant ?? '',
            tool: obj.tool ?? '',
            args: safeParse(obj.args),
            outcome: (obj.outcome as ToolCallEvent['outcome']) ?? 'ok',
            durationMs: Number(obj.durationMs ?? 0),
            error: obj.error || undefined,
            ts: Number(obj.ts ?? Date.now())
          }
        };
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
