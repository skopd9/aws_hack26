import 'server-only';
import type { CoreMessage } from 'ai';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { redis, safeRedisOp, sessionKey, TTL } from '../redis';

// Hard cap on the rehydrated context budget. When the persisted history
// would push the model past this many estimated tokens we summarize the
// older portion into a single system message and discard the originals.
const TOKEN_CAP = 2000;

// After compression, target this many tokens of *recent* messages to keep
// verbatim. Comfortably below TOKEN_CAP so the next turn has headroom
// before another compression cycle is needed.
const RECENT_KEEP_TOKENS = 800;

// Cap on the summary itself — keeps the summary message bounded so the
// pre-recent prefix never balloons over multiple compression cycles.
const SUMMARY_MAX_TOKENS = 400;

// Prefer a fast/cheap model for compression; fall back to the orchestrator
// model if no dedicated summary model is configured.
const SUMMARY_MODEL =
  process.env.ANTHROPIC_SUMMARY_MODEL ??
  process.env.ANTHROPIC_MODEL ??
  'claude-sonnet-4-5-20250929';

const SessionEnvelopeSchema = z.object({
  version: z.literal(1),
  messages: z.array(z.any()),
  updatedAt: z.number()
});

type SessionEnvelope = {
  version: 1;
  messages: CoreMessage[];
  updatedAt: number;
};

// Heuristic: ~4 chars per token. Cheap, deterministic, and good enough for
// budgeting; we don't need exact counts to decide when to compress.
export function estimateTokens(messages: CoreMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += 8; // role + framing overhead per message
    const c = m.content as unknown;
    if (typeof c === 'string') {
      chars += c.length;
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (typeof part === 'string') chars += part.length;
        else chars += JSON.stringify(part).length;
      }
    } else if (c != null) {
      chars += JSON.stringify(c).length;
    }
  }
  return Math.ceil(chars / 4);
}

export async function getSessionHistory(tenant: string): Promise<CoreMessage[]> {
  const raw = await safeRedisOp(() => redis.get(sessionKey(tenant)), null);
  if (!raw) return [];
  try {
    const parsed = SessionEnvelopeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return sanitizeForAnthropic(parsed.data.messages as CoreMessage[]);
  } catch {
    return [];
  }
}

// Anthropic prompt validation rejects sequences where (a) a `tool` message is
// not immediately preceded by an `assistant` message containing matching
// `tool_use` parts, or (b) the post-system head is not a `user` message.
// Older compression cycles could split mid-pair, persisting an orphan tool
// result that silently caused empty streams. Strip the post-system prefix
// down to the first valid `user` turn so historical sessions self-heal.
export function sanitizeForAnthropic(messages: CoreMessage[]): CoreMessage[] {
  if (messages.length === 0) return messages;
  const out: CoreMessage[] = [];
  let i = 0;
  while (i < messages.length && messages[i].role === 'system') {
    out.push(messages[i]);
    i += 1;
  }
  while (i < messages.length && messages[i].role !== 'user') {
    i += 1;
  }
  for (; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'tool') {
      const prev = out[out.length - 1];
      if (!prev || prev.role !== 'assistant' || !hasToolCallParts(prev)) {
        continue;
      }
    }
    out.push(msg);
  }
  return out;
}

export async function clearSession(tenant: string): Promise<void> {
  await safeRedisOp(() => redis.del(sessionKey(tenant)), 0);
}

async function writeSession(tenant: string, messages: CoreMessage[]): Promise<void> {
  const envelope: SessionEnvelope = {
    version: 1,
    messages,
    updatedAt: Date.now()
  };
  await safeRedisOp(
    () =>
      redis.set(
        sessionKey(tenant),
        JSON.stringify(envelope),
        'EX',
        TTL.session
      ),
    null
  );
}

/**
 * Append `newMessages` (this turn's user input + the assistant + tool
 * messages produced by streamText) to the persisted session, then run the
 * 2000-token compression check and write back atomically.
 *
 * Caller invariant: pass in only the *new* messages produced this turn —
 * never re-append already-persisted history. The route handler enforces
 * this by deriving newMessages from `response.messages` (assistant side)
 * and the user-tail diff (input side).
 */
export async function appendSessionTurn(
  tenant: string,
  newMessages: CoreMessage[]
): Promise<{ tokens: number; compressed: boolean }> {
  if (newMessages.length === 0) {
    const existing = await getSessionHistory(tenant);
    return { tokens: estimateTokens(existing), compressed: false };
  }
  const history = await getSessionHistory(tenant);
  const merged = [...history, ...newMessages];
  const result = await compressIfNeeded(merged);
  await writeSession(tenant, result.messages);
  return { tokens: result.tokens, compressed: result.didCompress };
}

async function compressIfNeeded(messages: CoreMessage[]): Promise<{
  messages: CoreMessage[];
  tokens: number;
  didCompress: boolean;
}> {
  const tokens = estimateTokens(messages);
  if (tokens <= TOKEN_CAP) {
    return { messages, tokens, didCompress: false };
  }

  // Walk backward, accumulating the most-recent messages until we'd exceed
  // RECENT_KEEP_TOKENS — everything before that split point gets summarized.
  let recentTokens = 0;
  let splitIdx = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens([messages[i]]);
    if (recentTokens + t > RECENT_KEEP_TOKENS && splitIdx < messages.length) {
      break;
    }
    recentTokens += t;
    splitIdx = i;
  }

  // Floor: always keep at least the last 2 messages verbatim so the model
  // has a clear anchor for the current turn even if a single message is
  // larger than RECENT_KEEP_TOKENS by itself.
  splitIdx = Math.min(splitIdx, Math.max(0, messages.length - 2));

  // Anthropic invariant: every `tool` message must be immediately preceded
  // by an `assistant` message containing the matching `tool_use` block.
  // If the recent-window cut lands on a `tool` message (or right after an
  // assistant that emitted tool_use blocks), the orphaned half will make
  // the next prompt invalid and the API silently returns an empty stream.
  // Walk the split backward until the boundary is on a clean turn break.
  splitIdx = alignSplitToTurnBoundary(messages, splitIdx);

  const older = messages.slice(0, splitIdx);
  const recent = messages.slice(splitIdx);
  if (older.length === 0) {
    return { messages, tokens, didCompress: false };
  }

  const summary = await summarizeOlder(older);
  const summaryMessage: CoreMessage = {
    role: 'system',
    content:
      `## Conversation summary so far (auto-compressed at ${tokens} tok > ${TOKEN_CAP})\n\n` +
      summary
  };
  const next = [summaryMessage, ...recent];
  return {
    messages: next,
    tokens: estimateTokens(next),
    didCompress: true
  };
}

function hasToolCallParts(message: CoreMessage): boolean {
  if (message.role !== 'assistant') return false;
  const c = message.content as unknown;
  if (!Array.isArray(c)) return false;
  return c.some((part: any) => part?.type === 'tool-call');
}

// Walk backward until messages[splitIdx] is the first message of a complete
// turn — i.e. NOT a `tool` message and NOT the assistant message that emitted
// the tool_use blocks for any subsequent `tool` messages. This prevents the
// summarizer from cutting an assistant/tool pair in half and leaving Anthropic
// with an orphaned tool result that fails prompt validation.
function alignSplitToTurnBoundary(
  messages: CoreMessage[],
  splitIdx: number
): number {
  let idx = splitIdx;
  while (idx > 0) {
    const at = messages[idx];
    const prev = messages[idx - 1];
    const startsWithTool = at.role === 'tool';
    const prevIsToolCallAssistant =
      hasToolCallParts(prev) && messages[idx]?.role === 'tool';
    if (startsWithTool || prevIsToolCallAssistant) {
      idx -= 1;
      continue;
    }
    break;
  }
  return idx;
}

function transcribe(messages: CoreMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role.toUpperCase();
      const c = m.content as unknown;
      if (typeof c === 'string') return `${role}: ${c}`;
      if (!Array.isArray(c)) return `${role}: ${JSON.stringify(c).slice(0, 600)}`;
      const rendered = c
        .map((part: any) => {
          if (typeof part === 'string') return part;
          switch (part?.type) {
            case 'text':
              return part.text ?? '';
            case 'tool-call':
              return `[tool-call ${part.toolName}(${JSON.stringify(part.args ?? {}).slice(0, 240)})]`;
            case 'tool-result':
              return `[tool-result ${part.toolName} => ${JSON.stringify(part.result ?? {}).slice(0, 600)}]`;
            case 'image':
              return '[image]';
            default:
              return JSON.stringify(part).slice(0, 240);
          }
        })
        .join(' ');
      return `${role}: ${rendered}`;
    })
    .join('\n\n');
}

async function summarizeOlder(older: CoreMessage[]): Promise<string> {
  const transcript = transcribe(older);
  try {
    const result = await generateText({
      model: anthropic(SUMMARY_MODEL),
      maxTokens: SUMMARY_MAX_TOKENS,
      system:
        'You compress a multi-turn agentic patent-research conversation into a dense factual summary. ' +
        "Preserve: (1) the engineer's described stack and the threat being assessed, " +
        '(2) every tool call made and its most material findings — patent numbers, prior-art repos with dates, litigation/PTAB signals, ' +
        '(3) decisions reached and open questions. ' +
        'Output bullet points only. No preamble, no closing remarks.',
      prompt: `Summarize the following conversation segment in <= ${SUMMARY_MAX_TOKENS} tokens:\n\n${transcript}`
    });
    return result.text.trim();
  } catch (err) {
    // If the summarizer is unreachable we still need *some* compression so
    // we don't loop on the cap forever. Fall back to a deterministic head
    // digest of each message — lossy, but preserves continuity hooks.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[session] summarize fallback engaged:', msg);
    return older
      .map((m, i) => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `- [${i}|${m.role}] ${c.slice(0, 200).replace(/\s+/g, ' ')}`;
      })
      .join('\n');
  }
}
