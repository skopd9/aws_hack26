import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, streamText, type CoreMessage } from 'ai';
import { getMcpTools } from '../cosmo/tools';
import { SYSTEM_PROMPT, RiskReportSchema, type RiskReport } from './prompts';
import { getStackProfile, renderStackProfile } from '../context/stackProfile';
import { appendSessionTurn } from '../context/session';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
const MAX_STEPS = 12;

function buildSystem(stackRendered: string): string {
  return `${SYSTEM_PROMPT}

## Current engineer's stack profile

${stackRendered}`;
}

// Public-facing onFinish: callers don't need streamText's heavily-generic
// ToolSet-parameterized event shape. They can narrow inside their handler
// if they want; we only consume `event.response.messages` ourselves.
export type OrchestratorFinishEvent = {
  response?: { messages?: CoreMessage[] };
  [key: string]: unknown;
};

export type OrchestratorInput = {
  tenant: string;
  messages: CoreMessage[];
  // Messages produced this turn on the *user side* (not yet persisted).
  // The orchestrator concatenates these with `response.messages` from the
  // model and persists the resulting turn to the Redis session.
  newUserMessages?: CoreMessage[];
  // Optional escape hatch — callers (e.g. Slack/Vapi) can disable
  // automatic session persistence if they manage their own context.
  persistSession?: boolean;
  // Hook through to streamText's onFinish so additional callers can layer
  // their own logic without losing the session-write side effect.
  onFinish?: (event: OrchestratorFinishEvent) => Promise<void> | void;
};

export async function runStream(input: OrchestratorInput) {
  const profile = await getStackProfile(input.tenant);
  const system = buildSystem(renderStackProfile(profile));
  const tools = getMcpTools(input.tenant);
  const persist = input.persistSession ?? true;
  const newUserMessages = input.newUserMessages ?? [];

  return streamText({
    model: anthropic(MODEL),
    system,
    messages: input.messages,
    tools,
    maxSteps: MAX_STEPS,
    async onFinish(event) {
      if (persist) {
        const assistantSide = (event.response?.messages ?? []) as CoreMessage[];
        await appendSessionTurn(input.tenant, [
          ...newUserMessages,
          ...assistantSide
        ]).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('[orchestrator] session persist failed:', msg);
        });
      }
      if (input.onFinish) {
        await input.onFinish(event as OrchestratorFinishEvent);
      }
    }
  });
}

export async function runOnce(input: OrchestratorInput): Promise<{
  text: string;
  report: RiskReport | null;
}> {
  const profile = await getStackProfile(input.tenant);
  const system = buildSystem(renderStackProfile(profile));
  const tools = getMcpTools(input.tenant);

  const result = await generateText({
    model: anthropic(MODEL),
    system,
    messages: input.messages,
    tools,
    maxSteps: MAX_STEPS
  });

  if ((input.persistSession ?? true)) {
    const assistantSide = (result.response?.messages ?? []) as CoreMessage[];
    await appendSessionTurn(input.tenant, [
      ...(input.newUserMessages ?? []),
      ...assistantSide
    ]).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[orchestrator] session persist failed:', msg);
    });
  }

  return {
    text: result.text,
    report: extractRiskReport(result.text)
  };
}

export function extractRiskReport(text: string): RiskReport | null {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim();
  if (!candidate) return null;
  try {
    const parsed = RiskReportSchema.safeParse(JSON.parse(candidate));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
