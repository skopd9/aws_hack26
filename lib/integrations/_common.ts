import 'server-only';
import { z } from 'zod';

export const PatentHitSchema = z.object({
  patentNo: z.string(),
  title: z.string(),
  abstract: z.string().default(''),
  assignee: z.string().default(''),
  priorityDate: z.string().default(''),
  cpcClasses: z.array(z.string()).default([]),
  url: z.string().default('')
});
export type PatentHit = z.infer<typeof PatentHitSchema>;

export const PriorArtCandidateSchema = z.object({
  repo: z.string(),
  url: z.string(),
  firstCommitDate: z.string(),
  stars: z.number().default(0),
  evidenceSnippet: z.string().default(''),
  predatesPriorityDate: z.boolean().default(false)
});
export type PriorArtCandidate = z.infer<typeof PriorArtCandidateSchema>;

export const LitigationProfileSchema = z.object({
  assigneeLitigationCount: z.number().default(0),
  isKnownNPE: z.boolean().default(false),
  recentCases: z
    .array(
      z.object({
        caseNo: z.string(),
        court: z.string(),
        filedDate: z.string(),
        defendants: z.array(z.string()).default([])
      })
    )
    .default([]),
  relatedIprOutcomes: z
    .array(z.object({ petition: z.string(), result: z.string() }))
    .default([])
});
export type LitigationProfile = z.infer<typeof LitigationProfileSchema>;

export function shouldMockFallback(): boolean {
  return process.env.MOCK_FALLBACK === 'true';
}

export async function withFallback<T>(
  label: string,
  live: () => Promise<T>,
  mock: () => T
): Promise<{ data: T; outcome: 'ok' | 'mock' | 'error'; error?: string }> {
  try {
    const data = await live();
    return { data, outcome: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (shouldMockFallback()) {
      console.warn(`[${label}] live call failed; using mock fallback:`, message);
      return { data: mock(), outcome: 'mock', error: message };
    }
    return { data: mock(), outcome: 'error', error: message };
  }
}
