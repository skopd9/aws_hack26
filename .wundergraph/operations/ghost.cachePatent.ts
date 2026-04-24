// @ts-nocheck
/**
 * MCP tool: ghost_cachePatent
 * Upsert a patent embedding into Ghost AI DB so future ghost_similarPatents
 * queries can surface it.
 */
import { upsertPatentEmbedding } from '../../lib/integrations/ghost';
import { z } from 'zod';

export const input = z.object({
  patentNo: z.string(),
  title: z.string(),
  abstract: z.string().default(''),
  assignee: z.string().default(''),
  priorityDate: z.string().default(''),
  cpcClasses: z.array(z.string()).default([]),
  url: z.string().default('')
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await upsertPatentEmbedding(i);
  return data;
}

export default { input, handler };
