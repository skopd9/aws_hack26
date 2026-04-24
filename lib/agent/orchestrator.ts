import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, streamText, type CoreMessage } from 'ai';
import { getMcpTools } from '../wundergraph/mcp';
import { SYSTEM_PROMPT, RiskReportSchema, type RiskReport } from './prompts';
import { getStackProfile, renderStackProfile } from '../context/stackProfile';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
const MAX_STEPS = 12;

function buildSystem(stackRendered: string): string {
  return `${SYSTEM_PROMPT}

## Current engineer's stack profile

${stackRendered}`;
}

export type OrchestratorInput = {
  tenant: string;
  messages: CoreMessage[];
};

export async function runStream(input: OrchestratorInput) {
  const profile = await getStackProfile(input.tenant);
  const system = buildSystem(renderStackProfile(profile));
  const tools = getMcpTools(input.tenant);

  return streamText({
    model: anthropic(MODEL),
    system,
    messages: input.messages,
    tools,
    maxSteps: MAX_STEPS
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
