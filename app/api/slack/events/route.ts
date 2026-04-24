import { NextRequest } from 'next/server';
import { verifySlackSignature, postMessage, buildRiskReportBlocks } from '@/lib/slack';
import { runOnce } from '@/lib/agent/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 120;

type SlackEventPayload =
  | { type: 'url_verification'; challenge: string }
  | {
      type: 'event_callback';
      team_id?: string;
      event: {
        type: string;
        text?: string;
        user?: string;
        channel?: string;
        ts?: string;
        channel_type?: string;
        bot_id?: string;
      };
    };

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifySlackSignature(req.headers, rawBody)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const json = safeParseJson(rawBody) as SlackEventPayload | null;
  if (!json) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (json.type === 'url_verification') {
    return Response.json({ challenge: json.challenge });
  }

  if (json.type === 'event_callback') {
    const ev = json.event;
    if (ev.bot_id) return Response.json({ ok: true });

    const relevant =
      ev.type === 'app_mention' ||
      (ev.type === 'message' && ev.channel_type === 'im');

    if (!relevant) return Response.json({ ok: true });

    const tenant = `slack:${json.team_id ?? 'team'}:${ev.user ?? 'user'}`;
    const text = (ev.text ?? '').replace(/<@[^>]+>/g, '').trim();
    const channel = ev.channel;

    void handleSlackQuery({ tenant, text, channel }).catch((err) =>
      console.error('[slack] handler error:', err)
    );

    return Response.json({ ok: true });
  }

  return Response.json({ ok: true });
}

async function handleSlackQuery(args: {
  tenant: string;
  text: string;
  channel?: string;
}) {
  if (!args.text || !args.channel) return;

  const { text, report } = await runOnce({
    tenant: args.tenant,
    messages: [{ role: 'user', content: args.text }]
  });

  const blocks = report
    ? buildRiskReportBlocks(report)
    : [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: text.slice(0, 2800) }
        }
      ];

  await postMessage(args.channel, blocks);
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
