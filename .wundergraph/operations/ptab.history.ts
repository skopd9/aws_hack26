// @ts-nocheck
/**
 * MCP tool: ptab_history
 * IPR petitions and claim-cancellation outcomes for a patent (open USPTO data).
 */
import { getPtabHistory } from '../../lib/integrations/uspto';
import { z } from 'zod';

export const input = z.object({ patentNo: z.string() });

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await getPtabHistory(i.patentNo);
  return data;
}

export default { input, handler };
