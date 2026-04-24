import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runOnce } from '@/lib/agent/orchestrator';
import { tryConsume } from '@/lib/redis/rateLimit';

export const runtime = 'nodejs';
export const maxDuration = 120;

const QuerySchema = z.object({
  tenant: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant', 'tool']),
        content: z.string()
      })
    )
    .min(1)
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = QuerySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_payload', issues: parsed.error.issues }, { status: 400 });
  }

  const rl = await tryConsume(parsed.data.tenant).catch(() => ({
    allowed: true,
    remaining: 30
  }));
  if (!rl.allowed) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { text, report } = await runOnce({
    tenant: parsed.data.tenant,
    messages: parsed.data.messages as Parameters<typeof runOnce>[0]['messages']
  });

  return Response.json({ text, report });
}
