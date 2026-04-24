import { NextRequest } from 'next/server';
import { VapiWebhookSchema, verifyVapiSignature, toVoiceFriendly } from '@/lib/vapi';
import { runOnce } from '@/lib/agent/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyVapiSignature(req, rawBody)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const json = safeParseJson(rawBody);
  const parsed = VapiWebhookSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const msg = parsed.data.message;
  const tenant = msg.call?.id ?? msg.call?.customer?.number ?? 'vapi-anonymous';

  if (msg.type === 'status-update' || msg.type === 'end-of-call-report' || msg.type === 'hang') {
    return Response.json({ ok: true });
  }

  const userUtterance =
    msg.transcript ??
    (msg.functionCall
      ? `User asked to run ${msg.functionCall.name} with ${JSON.stringify(
          msg.functionCall.parameters ?? {}
        )}`
      : 'User is asking about patent threats to their stack.');

  const { text, report } = await runOnce({
    tenant,
    messages: [{ role: 'user', content: userUtterance }]
  });

  const voiceReply = report ? toVoiceFriendly(report) : text;

  return Response.json({
    result: voiceReply,
    report
  });
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
