// @ts-nocheck
/**
 * MCP tool: nexla_latestFilings
 * Reads from the Postgres sink populated by the Nexla flow (see
 * deploy/nexla/README.md). The Nexla flow ingests the USPTO daily bulk
 * feed, normalizes it, and writes rows this endpoint returns.
 */
import { latestFilings } from '../../lib/integrations/nexla';
import { z } from 'zod';

export const input = z.object({
  since: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20)
});

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await latestFilings(i);
  return data;
}

export default { input, handler };
