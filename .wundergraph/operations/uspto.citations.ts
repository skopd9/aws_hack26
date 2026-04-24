// @ts-nocheck
/**
 * MCP tool: uspto_citations
 * Forward and backward citation graph for a patent.
 */
import { getCitations } from '../../lib/integrations/uspto';
import { z } from 'zod';

export const input = z.object({ patentNo: z.string() });

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await getCitations(i.patentNo);
  return data;
}

export default { input, handler };
