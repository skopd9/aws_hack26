// @ts-nocheck
/**
 * MCP tool: tinyfish_verifyProduct
 * Crawl a public product domain for evidence that it describes doing the
 * thing a patent claim covers. Grounds the risk assessment in real-world
 * product behavior.
 */
import { verifyProductUsage } from '../../lib/integrations/tinyfish';
import { z } from 'zod';

export const input = z.object({
  claimSummary: z.string(),
  productDomain: z.string()
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await verifyProductUsage(i.claimSummary, i.productDomain);
  return data;
}

export default { input, handler };
