import { NextRequest } from 'next/server';
import {
  convertToCoreMessages,
  type CoreMessage,
  type Message as UiMessage
} from 'ai';
import { runStream } from '@/lib/agent/orchestrator';
import { tryConsume } from '@/lib/redis/rateLimit';
import { getSessionHistory } from '@/lib/context/session';

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
  const incomingUi = (Array.isArray(body.messages) ? body.messages : []) as UiMessage[];

  // The browser (`useChat`) re-sends the entire visible history on every
  // turn. Redis is authoritative for prior turns (it survives reloads,
  // second tabs, and compression), so we hydrate from Redis and only
  // adopt the *new user input* from the request — everything after the
  // last assistant message in the client's view.
  const persisted = await getSessionHistory(tenant);
  const incomingCore = convertToCoreMessages(incomingUi);
  const newUserMessages = takeNewUserTail(incomingCore);
  const messagesForModel: CoreMessage[] = [...persisted, ...newUserMessages];

  const result = await runStream({
    tenant,
    messages: messagesForModel,
    newUserMessages
  });

  // Surface backend errors (e.g. malformed conversation history rejected
  // by Anthropic) inside the data stream instead of silently closing the
  // body. Without this, useChat sees a 200 with no text and renders
  // nothing, making real bugs invisible.
  const response = result.toDataStreamResponse({
    getErrorMessage: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[chat] stream error:', message);
      return `[chat] ${message}`;
    }
  });

  if (newTenant) {
    response.headers.append(
      'set-cookie',
      `${COOKIE_NAME}=${tenant}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`
    );
  }

  return response;
}

// Everything after the last assistant message in the client view is "new"
// user input for this turn — typically just the latest user prompt, but
// could include multi-message edits. The orchestrator persists these into
// the canonical Redis session alongside the resolved assistant response.
function takeNewUserTail(messages: CoreMessage[]): CoreMessage[] {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  return messages.slice(lastAssistantIdx + 1);
}
