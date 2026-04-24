// @ts-nocheck
/**
 * MCP tool: googlePatents_search
 * Broad full-text discovery on patents.google.com via TinyFish browser crawl.
 * This is the sponsor-facing "two live TinyFish tools" story — TinyFish is
 * the web-research backbone, not just a verification step.
 */
import { searchPatents } from '../../lib/integrations/googlePatents';
import { z } from 'zod';

export const input = z.object({
  query: z.string(),
  cpcClass: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(25).default(10)
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await searchPatents(i);
  return data;
}

export default { input, handler };
