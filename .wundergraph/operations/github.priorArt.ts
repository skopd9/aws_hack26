// @ts-nocheck
/**
 * MCP tool: github_priorArt
 * Search open-source repos for prior art predating a patent priority date.
 * The predatesPriorityDate flag on each candidate is the killer signal.
 */
import { findPriorArt } from '../../lib/integrations/github';
import { z } from 'zod';

export const input = z.object({
  claimSummary: z.string(),
  priorityDate: z.string(),
  limit: z.number().int().min(1).max(15).default(8)
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await findPriorArt(i);
  return data;
}

export default { input, handler };
