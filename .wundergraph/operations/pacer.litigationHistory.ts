// @ts-nocheck
/**
 * MCP tool: pacer_litigationHistory
 * Litigation history for a patent assignee. Uses CourtListener by default
 * (free, API-keyed, covers most federal patent dockets via RECAP) with a
 * PACER upgrade path for deeper coverage.
 */
import { litigationHistory } from '../../lib/integrations/pacer';
import { z } from 'zod';

export const input = z.object({ assignee: z.string() });

export async function handler({ input: i }: { input: z.infer<typeof input> }) {
  const { data } = await litigationHistory(i.assignee);
  return data;
}

export default { input, handler };
