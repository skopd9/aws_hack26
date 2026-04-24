// @ts-nocheck
/**
 * MCP tool: akashml_summarizeClaim
 * Kimi K2.6 running on Akash ML decentralized GPUs collapses dense claim
 * language into engineer-readable summary + roadmap implication. This is
 * the fastest path to closing the Interpretation Gap.
 */
import { summarizeClaim } from '../../lib/integrations/akashml';
import { z } from 'zod';

export const input = z.object({
  patentNo: z.string(),
  claimText: z.string(),
  userStack: z.string()
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await summarizeClaim(i);
  return data;
}

export default { input, handler };
