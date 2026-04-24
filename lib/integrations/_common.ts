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

// ---------------------------------------------------------------------------
// IntegrationError — verbose, structured failure envelope.
//
// Replaces the old `withFallback` mock-data pattern. Every integration in
// `lib/integrations/*` now throws one of these on failure. The message is
// deliberately rich because:
//   1. It surfaces through the Cosmo Router via GraphQL `errors[].message`
//      (subgraphs run with `maskedErrors: false`).
//   2. It becomes the tool result that Claude sees when an MCP tool fails
//      (see `lib/cosmo/tools.ts`). The richer the error, the better the
//      model can adapt its next tool call (e.g. "503 from PatentsView →
//      try googlePatents_search instead").
//
// `cause` is a coarse classifier the retry layer uses to decide whether
// retrying makes sense. Permanent causes (`missing_credential`,
// `not_implemented`, `invalid_input`) skip retries.
// ---------------------------------------------------------------------------

export type IntegrationCause =
  | 'missing_credential'
  | 'invalid_input'
  | 'upstream_error'
  | 'rate_limit'
  | 'timeout'
  | 'parse_error'
  | 'not_implemented'
  | 'empty_result'
  | 'unknown';

export class IntegrationError extends Error {
  readonly tool: string;
  readonly cause: IntegrationCause;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    tool: string,
    cause: IntegrationCause,
    message: string,
    details?: Record<string, unknown>
  ) {
    const detailStr = details ? ` (${truncate(safeJson(details), 280)})` : '';
    super(`[${tool}] ${cause}: ${message}${detailStr}`);
    this.name = 'IntegrationError';
    this.tool = tool;
    this.cause = cause;
    this.details = details;
  }

  static from(tool: string, err: unknown): IntegrationError {
    if (err instanceof IntegrationError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (/econnreset|etimedout|econnrefused|fetch failed|socket hang up|aborted/i.test(message)) {
      return new IntegrationError(tool, 'upstream_error', message);
    }
    return new IntegrationError(tool, 'unknown', message);
  }
}

const PERMANENT_CAUSES: ReadonlySet<IntegrationCause> = new Set([
  'missing_credential',
  'invalid_input',
  'not_implemented',
  'parse_error'
]);

export function isRetryable(err: unknown): boolean {
  if (err instanceof IntegrationError) return !PERMANENT_CAUSES.has(err.cause);
  // For non-IntegrationError, treat anything network-shaped as retryable.
  const message = err instanceof Error ? err.message : String(err);
  return /econnreset|etimedout|econnrefused|fetch failed|socket hang up|aborted|5\d\d|429/i.test(
    message
  );
}

/**
 * Translate a fetch Response into the right IntegrationError. Use after a
 * non-OK upstream call so the cause matches what the retry layer expects.
 */
export async function failFromResponse(
  tool: string,
  res: Response,
  service: string
): Promise<never> {
  const body = await res.text().catch(() => '');
  const truncated = truncate(body, 500);
  let cause: IntegrationCause = 'upstream_error';
  if (res.status === 429) cause = 'rate_limit';
  else if (res.status >= 400 && res.status < 500 && res.status !== 408) {
    cause = 'invalid_input';
  } else if (res.status === 408) cause = 'timeout';
  throw new IntegrationError(tool, cause, `${service} returned ${res.status}`, {
    status: res.status,
    body: truncated
  });
}

/**
 * Require an env var to be set; throw a descriptive IntegrationError if not.
 */
export function requireEnv(tool: string, name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new IntegrationError(
      tool,
      'missing_credential',
      `environment variable ${name} is not set; cannot reach upstream`
    );
  }
  return v;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…<+${s.length - n} chars>`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
