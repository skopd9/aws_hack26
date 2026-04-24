import { NextRequest } from 'next/server';
import { runStream } from '@/lib/agent/orchestrator';
import { tryConsume } from '@/lib/redis/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const COOKIE_NAME = 'ip-pulse-tenant';

export async function POST(req: NextRequest) {
  let tenant = req.cookies.get(COOKIE_NAME)?.value;
  const newTenant = !tenant;
  if (!tenant) {
    tenant = crypto.randomUUID();
  }

  const rl = await tryConsume(tenant).catch(() => ({ allowed: true, remaining: 30 }));
  if (!rl.allowed) {
    return Response.json(
      { error: 'rate_limited', remaining: rl.remaining },
      { status: 429 }
    );
  }

  const body = (await req.json()) as { messages?: unknown };
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const result = await runStream({
    tenant,
    messages: messages as Parameters<typeof runStream>[0]['messages']
  });

  const response = result.toDataStreamResponse();

  if (newTenant) {
    response.headers.append(
      'set-cookie',
      `${COOKIE_NAME}=${tenant}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`
    );
  }

  return response;
}
