// @ts-nocheck
/**
 * MCP tool: akashml_rerankPriorArt
 * Kimi K2.6 on Akash ML semantically reranks GitHub prior-art candidates
 * against a claim summary. Returns per-candidate score + one-sentence
 * invalidation reasoning.
 */
import { rerankPriorArt } from '../../lib/integrations/akashml';
import { z } from 'zod';

export const input = z.object({
  claimSummary: z.string(),
  candidates: z.array(
    z.object({
      repo: z.string(),
      evidenceSnippet: z.string(),
      firstCommitDate: z.string()
    })
  )
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await rerankPriorArt(i);
  return data;
}

export default { input, handler };
