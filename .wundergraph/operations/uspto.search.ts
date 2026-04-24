// @ts-nocheck
/**
 * MCP tool: uspto_search
 * Authoritative filings search against USPTO PatentsView.
 */
import { searchUspto } from '../../lib/integrations/uspto';
import { z } from 'zod';

export const input = z.object({
  query: z.string(),
  cpcClass: z.string().optional(),
  dateFrom: z.string().optional(),
  limit: z.number().int().min(1).max(25).default(10)
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await searchUspto(i);
  return data;
}

export default { input, handler };
