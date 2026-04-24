// @ts-nocheck
/**
 * MCP tool: ghost_similarPatents
 * Vector-search the Ghost AI DB for semantically similar patents seen before.
 * Hit BEFORE live sources to save latency on repeat queries.
 */
import { similarPatents } from '../../lib/integrations/ghost';
import { z } from 'zod';

export const input = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(15).default(5)
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await similarPatents(i);
  return data;
}

export default { input, handler };
