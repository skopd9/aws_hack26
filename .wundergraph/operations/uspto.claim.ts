// @ts-nocheck
/**
 * MCP tool: uspto_claim
 * Fetch full claim text for a patent number.
 */
import { getClaimText } from '../../lib/integrations/uspto';
import { z } from 'zod';

export const input = z.object({ patentNo: z.string() });

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await getClaimText(i.patentNo);
  return data;
}

export default { input, handler };
