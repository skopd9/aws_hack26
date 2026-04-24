import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { recordToolCall } from '../redis/streams';
import { cosmoGql, isCosmoEnabled } from './client';
import { IntegrationError, isRetryable } from '../integrations/_common';

// Direct integration calls. When `COSMO_ROUTER_URL` is unset we hit these
// in-process; otherwise the same logic runs through the Cosmo Router →
// subgraph → integration chain. There is no automatic fallback between the
// two — config is the single source of truth, so a router outage never
// silently degrades to in-process. (Use `COSMO_ROUTER_URL=""` to opt out.)
import {
  searchUspto,
  getClaimText,
  getCitations,
  getPtabHistory
} from '../integrations/uspto';
import { searchPatents as searchGooglePatents } from '../integrations/googlePatents';
import { findPriorArt } from '../integrations/github';
import { litigationHistory } from '../integrations/pacer';
import {
  verifyProductUsage,
  searchResearchPapers,
  searchNews,
  searchGithubRepos,
  searchUsptoPubs
} from '../integrations/tinyfish';
import {
  searchFileWrapper,
  getFileWrapperDetail
} from '../integrations/usptoOdp';
import { latestFilings } from '../integrations/nexla';
import {
  upsertPatentEmbedding,
  similarPatents
} from '../integrations/ghost';
import {
  summarizeClaim,
  rerankPriorArt
} from '../integrations/akashml';

// ---------------------------------------------------------------------------
// Retry policy
//
// User contract:
//   1. NO mock fallbacks. A failing tool returns a verbose, explainable error
//      that enriches the model's next step instead of pretending success.
//   2. Auto-retry on transient failures, max_retries=3.
//   3. Each retry's prior-error message is preserved in the eventual error
//      message so the LLM, on its own next step, sees what went wrong before.
//
// Permanent causes (`missing_credential`, `invalid_input`, `not_implemented`,
// `parse_error`) skip retries — re-running won't change the answer.
// `empty_result` is also non-retryable: the upstream gave a definitive
// "nothing matches", not a transient hiccup.
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

const NON_RETRYABLE_CAUSE_MARKERS = [
  'missing_credential',
  'invalid_input',
  'not_implemented',
  'parse_error',
  'empty_result'
];

function shouldRetry(err: unknown): boolean {
  if (err instanceof IntegrationError) return isRetryable(err);
  // GraphQL-over-Cosmo errors come through as plain `Error` objects whose
  // message embeds the original IntegrationError string, e.g.
  //   "[uspto.search] missing_credential: USPTO_API_KEY not set..."
  // Detect those markers and treat them as permanent.
  const message = err instanceof Error ? err.message : String(err);
  if (NON_RETRYABLE_CAUSE_MARKERS.some((m) => message.includes(m))) {
    return false;
  }
  return isRetryable(err);
}

type AttemptLog = {
  attempt: number;
  durationMs: number;
  error: string;
};

/**
 * Envelope the LLM sees when a tool fails. We never throw from `execute` —
 * AI SDK v4 aborts the stream on a thrown ToolExecutionError and the model
 * never gets to read the error. By returning the failure as a structured
 * value the SDK serializes it as the tool result, the model sees it on its
 * next step, and can adjust (refine args, switch to a different tool, or
 * surface the failure in the final RiskReport).
 *
 * Discriminator key `__toolError` lets the model distinguish a failure
 * envelope from real tool data.
 */
type ToolErrorEnvelope = {
  __toolError: true;
  tool: string;
  message: string;
  attempts: number;
  attemptTrail: AttemptLog[];
  hint: string;
};

function buildErrorEnvelope(
  toolName: string,
  attempts: AttemptLog[]
): ToolErrorEnvelope {
  const last = attempts[attempts.length - 1]?.error ?? 'unknown';
  const trail = attempts
    .map(
      (a) =>
        `  attempt ${a.attempt}/${attempts.length} (${a.durationMs}ms): ${a.error}`
    )
    .join('\n');
  const message =
    attempts.length === 1
      ? `[${toolName}] failed on first attempt (no retry — permanent error): ${last}`
      : `[${toolName}] failed after ${attempts.length} attempts.\n${trail}`;

  // A short, model-actionable hint based on the cause embedded in the last
  // error string. Helps the LLM pick a productive next step instead of
  // re-calling the same tool with the same args.
  let hint =
    'Treat this tool result as missing. Either call a different tool that can answer the same question, refine arguments, or note the gap in the final report.';
  if (last.includes('missing_credential')) {
    hint =
      'The required credential is not configured in this environment. Do NOT retry this tool — switch to one that does not need the missing key.';
  } else if (last.includes('invalid_input')) {
    hint =
      'The arguments are malformed or incomplete. Re-derive arguments from upstream tool output, then call this tool again with a corrected value.';
  } else if (last.includes('empty_result')) {
    hint =
      'The upstream definitively returned no matches. Broaden the query, drop a filter (e.g. date range), or try a complementary tool.';
  } else if (last.includes('rate_limit')) {
    hint =
      'Upstream is rate-limiting. Skip this tool for the current step and try again later, or use a different surface.';
  } else if (last.includes('not_implemented')) {
    hint =
      'This integration is not wired up in the current build. Treat the underlying signal as unknown in your final assessment.';
  } else if (last.includes('parse_error')) {
    hint =
      'The upstream produced output we could not parse. Retrying may help (model drift). If it fails again, skip this tool.';
  }

  return {
    __toolError: true,
    tool: toolName,
    message,
    attempts: attempts.length,
    attemptTrail: attempts,
    hint
  };
}

async function withRetry<T>(
  toolName: string,
  fn: () => Promise<T>
): Promise<{ ok: true; data: T; attempts: AttemptLog[] } | { ok: false; attempts: AttemptLog[] }> {
  const attempts: AttemptLog[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const startedAt = Date.now();
    try {
      const data = await fn();
      return { ok: true, data, attempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({
        attempt,
        durationMs: Date.now() - startedAt,
        error: message
      });

      const retryable = shouldRetry(err);
      const isLast = attempt === MAX_RETRIES;
      if (!retryable || isLast) {
        return { ok: false, attempts };
      }

      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      console.warn(
        `[tool:${toolName}] attempt ${attempt}/${MAX_RETRIES} failed: ${message}. retrying in ${backoff}ms…`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  return { ok: false, attempts };
}

function instrument<Args, Out>(
  toolName: string,
  tenant: () => string,
  run: (args: Args) => Promise<Out>
) {
  return async (args: Args): Promise<Out | ToolErrorEnvelope> => {
    const start = Date.now();
    const result = await withRetry(toolName, () => run(args));

    if (result.ok) {
      const recovered = result.attempts.length > 0;
      void recordToolCall({
        tenant: tenant(),
        tool: toolName,
        args,
        outcome: recovered ? 'retry' : 'ok',
        durationMs: Date.now() - start,
        attempts: result.attempts.length + 1,
        error: recovered
          ? `recovered after ${result.attempts.length} prior failure(s); last: ${result.attempts[result.attempts.length - 1].error}`
          : undefined,
        ts: Date.now()
      }).catch(() => {});
      return result.data;
    }

    const envelope = buildErrorEnvelope(toolName, result.attempts);
    void recordToolCall({
      tenant: tenant(),
      tool: toolName,
      args,
      outcome: 'error',
      durationMs: Date.now() - start,
      attempts: result.attempts.length,
      error: envelope.message,
      ts: Date.now()
    }).catch(() => {});
    // Return (do NOT throw) so AI SDK serializes the envelope as the
    // tool result. On the model's next step the envelope is visible in
    // the conversation as the `tool_result` content — that's the
    // mechanism for "append the error failure message to the prompt in
    // retry so llm execution knows the previous error to be good next
    // time".
    return envelope;
  };
}

// ---------------------------------------------------------------------------
// Per-tool runners. Each one chooses the Cosmo Router or the direct
// integration based on `isCosmoEnabled()` — but does NOT fall back from one
// to the other on failure.
// ---------------------------------------------------------------------------

function runner<Args, Out>(opts: {
  query: string;
  pick: (data: any) => Out;
  variables: (args: Args) => Record<string, unknown>;
  direct: (args: Args) => Promise<Out>;
}): (args: Args) => Promise<Out> {
  return async (args: Args) => {
    if (isCosmoEnabled()) {
      const data = await cosmoGql<any>(opts.query, opts.variables(args));
      return opts.pick(data);
    }
    return opts.direct(args);
  };
}

// ---------------------------------------------------------------------------
// GraphQL operation strings — one per tool, kept aligned with subgraphs/*.
// ---------------------------------------------------------------------------

const PATENT_FIELDS = `patentNo title abstract assignee priorityDate cpcClasses url`;

const Q_USPTO_SEARCH = /* GraphQL */ `
  query UsptoSearch($query: String!, $cpcClass: String, $dateFrom: String, $limit: Int) {
    usptoSearch(query: $query, cpcClass: $cpcClass, dateFrom: $dateFrom, limit: $limit) {
      ${PATENT_FIELDS}
    }
  }
`;
const Q_USPTO_CLAIM = /* GraphQL */ `
  query UsptoClaim($patentNo: ID!) {
    usptoClaim(patentNo: $patentNo) { patentNo claims }
  }
`;
const Q_USPTO_CITATIONS = /* GraphQL */ `
  query UsptoCitations($patentNo: ID!) {
    usptoCitations(patentNo: $patentNo) { patentNo backwardCitations forwardCitations }
  }
`;
const Q_PTAB_HISTORY = /* GraphQL */ `
  query PtabHistory($patentNo: ID!) {
    ptabHistory(patentNo: $patentNo) {
      patentNo
      iprPetitions { petition result }
      claimsCancelled
    }
  }
`;
const Q_GOOGLE_PATENTS = /* GraphQL */ `
  query GooglePatents($query: String!, $cpcClass: String, $dateFrom: String, $dateTo: String, $limit: Int) {
    googlePatentsSearch(query: $query, cpcClass: $cpcClass, dateFrom: $dateFrom, dateTo: $dateTo, limit: $limit) {
      ${PATENT_FIELDS}
    }
  }
`;
const Q_GITHUB_PRIOR_ART = /* GraphQL */ `
  query GithubPriorArt($claimSummary: String!, $priorityDate: String!, $limit: Int) {
    githubPriorArt(claimSummary: $claimSummary, priorityDate: $priorityDate, limit: $limit) {
      repo url firstCommitDate stars evidenceSnippet predatesPriorityDate
    }
  }
`;
const Q_PACER = /* GraphQL */ `
  query Pacer($assignee: String!) {
    pacerLitigationHistory(assignee: $assignee) {
      assigneeLitigationCount
      isKnownNPE
      recentCases { caseNo court filedDate defendants }
      relatedIprOutcomes { petition result }
    }
  }
`;
const Q_VERIFY_PRODUCT = /* GraphQL */ `
  query VerifyProduct($claimSummary: String!, $productDomain: String!) {
    verifyProductUsage(claimSummary: $claimSummary, productDomain: $productDomain) {
      evidence { url snippet confidence }
      confidence
      summary
    }
  }
`;
const Q_RESEARCH_PAPERS = /* GraphQL */ `
  query ResearchPapers($query: String!, $sites: [String!], $limit: Int) {
    researchPapers(query: $query, sites: $sites, limit: $limit) {
      title url snippet source arxivId
    }
  }
`;
const Q_NEWS = /* GraphQL */ `
  query News($query: String!, $sites: [String!], $dateFrom: String, $limit: Int) {
    tinyfishNews(query: $query, sites: $sites, dateFrom: $dateFrom, limit: $limit) {
      title url snippet source publishedDate
    }
  }
`;
const Q_TF_GITHUB = /* GraphQL */ `
  query TinyFishGithub($query: String!, $priorityDate: String, $limit: Int) {
    tinyfishGithubRepos(query: $query, priorityDate: $priorityDate, limit: $limit) {
      repo url firstCommitDate stars evidenceSnippet predatesPriorityDate
    }
  }
`;
const Q_NEXLA = /* GraphQL */ `
  query Nexla($since: String, $limit: Int) {
    nexlaLatestFilings(since: $since, limit: $limit) { ${PATENT_FIELDS} }
  }
`;
const Q_GHOST_SIMILAR = /* GraphQL */ `
  query GhostSimilar($query: String!, $limit: Int) {
    ghostSimilarPatents(query: $query, limit: $limit) { ${PATENT_FIELDS} }
  }
`;
const M_GHOST_CACHE = /* GraphQL */ `
  mutation GhostCache($patent: PatentInput!) {
    ghostCachePatent(patent: $patent) { ok id }
  }
`;
const Q_AKASH_SUMMARIZE = /* GraphQL */ `
  query Summarize($patentNo: ID!, $claimText: String!, $userStack: String!) {
    summarizeClaim(patentNo: $patentNo, claimText: $claimText, userStack: $userStack) {
      summary roadmapImplication
    }
  }
`;
const Q_AKASH_RERANK = /* GraphQL */ `
  query Rerank($claimSummary: String!, $candidates: [PriorArtCandidateInput!]!) {
    rerankPriorArt(claimSummary: $claimSummary, candidates: $candidates) {
      repo score reason
    }
  }
`;
const Q_TF_USPTO_PUBS = /* GraphQL */ `
  query TinyFishUsptoPubs(
    $query: String!
    $dateFrom: String
    $limit: Int
    $fetchFullText: Boolean
  ) {
    tinyfishSearchUsptoPubs(
      query: $query
      dateFrom: $dateFrom
      limit: $limit
      fetchFullText: $fetchFullText
    ) {
      patentNo title abstract claimText url ppubsUrl kind
    }
  }
`;
const Q_USPTO_FW_SEARCH = /* GraphQL */ `
  query UsptoFileWrapperSearch(
    $query: String!
    $dateFrom: String
    $dateTo: String
    $status: String
    $limit: Int
  ) {
    usptoFileWrapperSearch(
      query: $query
      dateFrom: $dateFrom
      dateTo: $dateTo
      status: $status
      limit: $limit
    ) {
      applicationNo
      inventionTitle
      filingDate
      publicationDate
      patentNumber
      grantDate
      statusDescription
      assignee
      applicantCountry
      cpcClasses
      url
    }
  }
`;
const Q_USPTO_FW_DETAIL = /* GraphQL */ `
  query UsptoFileWrapperDetail($applicationNo: ID!) {
    usptoFileWrapperDetail(applicationNo: $applicationNo) {
      applicationNo
      inventionTitle
      filingDate
      publicationDate
      patentNumber
      grantDate
      statusDescription
      assignee
      applicantCountry
      cpcClasses
      url
      transactions { date code description }
      documents { documentCode documentDescription mailDate downloadUrl }
      parentApplications
      childApplications
    }
  }
`;

// ---------------------------------------------------------------------------
// Tool definitions exposed to Claude. Names + parameters preserved from the
// previous SDK skeleton so the orchestrator and system prompt don't change.
// ---------------------------------------------------------------------------

export function getMcpTools(tenant: string) {
  const t = () => tenant;

  return {
    uspto_search: tool({
      description:
        'Authoritative USPTO patent search by keyword, CPC class, and date range. Returns recent US filings that match. Use this for discovery at the start of any threat assessment.',
      parameters: z.object({
        query: z.string().describe('keywords or claim-language snippet'),
        cpcClass: z.string().optional(),
        dateFrom: z.string().optional().describe('ISO date, e.g. 2024-01-01'),
        limit: z.number().int().min(1).max(25).default(10)
      }),
      execute: instrument(
        'uspto.search',
        t,
        runner({
          query: Q_USPTO_SEARCH,
          variables: (a) => a,
          pick: (d) => d.usptoSearch,
          direct: searchUspto
        })
      )
    }),

    uspto_claim: tool({
      description:
        'Fetch the full claim text for a specific US patent by patent number. Use after uspto_search or googlePatents_search identifies a candidate of interest.',
      parameters: z.object({
        patentNo: z.string().describe('e.g. US12118765B2')
      }),
      execute: instrument(
        'uspto.claim',
        t,
        runner({
          query: Q_USPTO_CLAIM,
          variables: (a) => a,
          pick: (d) => d.usptoClaim,
          direct: (a) => getClaimText(a.patentNo)
        })
      )
    }),

    uspto_citations: tool({
      description:
        'Forward and backward citation graph for a US patent. Helps assess centrality and find related filings to sweep for.',
      parameters: z.object({ patentNo: z.string() }),
      execute: instrument(
        'uspto.citations',
        t,
        runner({
          query: Q_USPTO_CITATIONS,
          variables: (a) => a,
          pick: (d) => d.usptoCitations,
          direct: (a) => getCitations(a.patentNo)
        })
      )
    }),

    ptab_history: tool({
      description:
        'PTAB (Patent Trial and Appeal Board) history for a patent: IPR petitions filed, claims cancelled. Strong signal for whether the patent has already survived challenge.',
      parameters: z.object({ patentNo: z.string() }),
      execute: instrument(
        'ptab.history',
        t,
        runner({
          query: Q_PTAB_HISTORY,
          variables: (a) => a,
          pick: (d) => d.ptabHistory,
          direct: (a) => getPtabHistory(a.patentNo)
        })
      )
    }),

    googlePatents_search: tool({
      description:
        'Broader full-text patent search against patents.google.com via TinyFish web crawl. Use in addition to uspto_search for international filings and richer text matching.',
      parameters: z.object({
        query: z.string(),
        cpcClass: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(25).default(10)
      }),
      execute: instrument(
        'googlePatents.search',
        t,
        runner({
          query: Q_GOOGLE_PATENTS,
          variables: (a) => a,
          pick: (d) => d.googlePatentsSearch,
          direct: searchGooglePatents
        })
      )
    }),

    github_priorArt: tool({
      description:
        'Search GitHub for open-source repositories that may serve as prior art predating a patent priority date. Use after you have a claim summary.',
      parameters: z.object({
        claimSummary: z.string(),
        priorityDate: z.string(),
        limit: z.number().int().min(1).max(15).default(8)
      }),
      execute: instrument(
        'github.priorArt',
        t,
        runner({
          query: Q_GITHUB_PRIOR_ART,
          variables: (a) => a,
          pick: (d) => d.githubPriorArt,
          direct: findPriorArt
        })
      )
    }),

    pacer_litigationHistory: tool({
      description:
        'Litigation history for a patent assignee: count of patent cases filed, whether they pattern-match as a non-practicing entity (NPE / patent troll), recent cases. Backed by CourtListener (free) with PACER upgrade path.',
      parameters: z.object({ assignee: z.string() }),
      execute: instrument(
        'pacer.litigationHistory',
        t,
        runner({
          query: Q_PACER,
          variables: (a) => a,
          pick: (d) => d.pacerLitigationHistory,
          direct: (a) => litigationHistory(a.assignee)
        })
      )
    }),

    tinyfish_verifyProduct: tool({
      description:
        'Use TinyFish to crawl a public product/site and check whether it describes doing the thing a patent claim covers. Grounds the risk assessment in real-world product behavior.',
      parameters: z.object({
        claimSummary: z.string(),
        productDomain: z.string().describe('e.g. vercel.com')
      }),
      execute: instrument(
        'tinyfish.verifyProduct',
        t,
        runner({
          query: Q_VERIFY_PRODUCT,
          variables: (a) => a,
          pick: (d) => d.verifyProductUsage,
          direct: (a) => verifyProductUsage(a.claimSummary, a.productDomain)
        })
      )
    }),

    tinyfish_researchPapers: tool({
      description:
        'Search academic / scholarly sources (arXiv, Semantic Scholar, Google Scholar, OpenReview, ACL Anthology, MLR, NeurIPS, ACM, IEEE) via TinyFish for prior-art papers. An arXiv preprint or peer-reviewed paper predating the priority date is among the strongest invalidation signals.',
      parameters: z.object({
        query: z.string().describe('keywords or claim-language snippet'),
        sites: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(15).default(8)
      }),
      execute: instrument(
        'tinyfish.researchPapers',
        t,
        runner({
          query: Q_RESEARCH_PAPERS,
          variables: (a) => a,
          pick: (d) => d.researchPapers,
          direct: searchResearchPapers
        })
      )
    }),

    tinyfish_news: tool({
      description:
        'Search tech / business news (TechCrunch, The Verge, Ars Technica, Wired, VentureBeat, The Information, Reuters, Bloomberg, FT) via TinyFish. Use to surface public disclosures, product announcements, and litigation coverage that bear on patent risk.',
      parameters: z.object({
        query: z.string(),
        sites: z.array(z.string()).optional(),
        dateFrom: z.string().optional().describe('ISO date, e.g. 2024-01-01'),
        limit: z.number().int().min(1).max(15).default(8)
      }),
      execute: instrument(
        'tinyfish.news',
        t,
        runner({
          query: Q_NEWS,
          variables: (a) => a,
          pick: (d) => d.tinyfishNews,
          direct: searchNews
        })
      )
    }),

    tinyfish_githubRepos: tool({
      description:
        'Broad GitHub-via-web-search prior-art sweep. Complements github_priorArt (REST API + GITHUB_TOKEN, stars-ranked) by surfacing long-tail repos, READMEs matching claim language, and *.github.io posts that the API search misses. Returns PriorArtCandidate-shaped results.',
      parameters: z.object({
        query: z.string(),
        priorityDate: z.string().optional(),
        limit: z.number().int().min(1).max(15).default(8)
      }),
      execute: instrument(
        'tinyfish.githubRepos',
        t,
        runner({
          query: Q_TF_GITHUB,
          variables: (a) => a,
          pick: (d) => d.tinyfishGithubRepos,
          direct: searchGithubRepos
        })
      )
    }),

    nexla_latestFilings: tool({
      description:
        'Fetch the latest USPTO filings as ingested and normalized by the Nexla daily-bulk-feed pipeline. Use for "what was filed this week" style questions.',
      parameters: z.object({
        since: z.string().optional().describe('ISO date'),
        limit: z.number().int().min(1).max(50).default(20)
      }),
      execute: instrument(
        'nexla.latestFilings',
        t,
        runner({
          query: Q_NEXLA,
          variables: (a) => a,
          pick: (d) => d.nexlaLatestFilings,
          direct: latestFilings
        })
      )
    }),

    ghost_similarPatents: tool({
      description:
        'Vector-search the Ghost AI DB cache for semantically similar patents seen by IP-Pulse before. Hit this BEFORE hitting live sources to save latency on repeat queries.',
      parameters: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(15).default(5)
      }),
      execute: instrument(
        'ghost.similarPatents',
        t,
        runner({
          query: Q_GHOST_SIMILAR,
          variables: (a) => a,
          pick: (d) => d.ghostSimilarPatents,
          direct: similarPatents
        })
      )
    }),

    ghost_cachePatent: tool({
      description:
        'Persist a patent embedding to the Ghost AI DB so future ghost_similarPatents queries return it. Call after reading a claim.',
      parameters: z.object({
        patentNo: z.string(),
        title: z.string(),
        abstract: z.string().default(''),
        assignee: z.string().default(''),
        priorityDate: z.string().default(''),
        cpcClasses: z.array(z.string()).default([]),
        url: z.string().default('')
      }),
      execute: instrument(
        'ghost.upsert',
        t,
        runner({
          query: M_GHOST_CACHE,
          variables: (a) => ({ patent: a }),
          pick: (d) => d.ghostCachePatent,
          direct: upsertPatentEmbedding
        })
      )
    }),

    akashml_summarizeClaim: tool({
      description:
        "Use Kimi K2.6 running on Akash ML decentralized GPUs to collapse dense claim language into an engineer-readable summary, grounded in the user's stack. This is the fastest way to close the Interpretation Gap on a patent.",
      parameters: z.object({
        patentNo: z.string(),
        claimText: z.string(),
        userStack: z.string()
      }),
      execute: instrument(
        'akashml.summarizeClaim',
        t,
        runner({
          query: Q_AKASH_SUMMARIZE,
          variables: (a) => a,
          pick: (d) => d.summarizeClaim,
          direct: summarizeClaim
        })
      )
    }),

    tinyfish_searchUsptoPubs: tool({
      description:
        'Search ppubs.uspto.gov via TinyFish web search and (when fetchFullText=true) crawl each result page for FULL CLAIM TEXT. Covers both pending applications and granted patents — fills the gap PatentsView leaves. Use after uspto_search/googlePatents_search if you need real claim language for akashml_summarizeClaim instead of just an abstract. Returns UsptoPubHit (kind: granted | application | unknown).',
      parameters: z.object({
        query: z.string().describe('keywords or claim-language snippet'),
        dateFrom: z.string().optional().describe('ISO date, e.g. 2024-01-01'),
        limit: z.number().int().min(1).max(20).default(8),
        fetchFullText: z
          .boolean()
          .default(true)
          .describe('When true, fetches each patent page for the claims block')
      }),
      execute: instrument(
        'tinyfish.usptoSearch',
        t,
        runner({
          query: Q_TF_USPTO_PUBS,
          variables: (a) => a,
          pick: (d) => d.tinyfishSearchUsptoPubs,
          direct: searchUsptoPubs
        })
      )
    }),

    uspto_fileWrapperSearch: tool({
      description:
        "USPTO Open Data Portal (ODP) Patent File Wrapper SEARCH. Hits the official api.uspto.gov/api/v1/patent/applications/search REST endpoint — covers pending applications too (post-2001), with filing-date and status filters. Use to find filings the model knows of by assignee/title/keyword and to surface their application number for a follow-up uspto_fileWrapperDetail call. Status values: Patented, Pending, Abandoned, Published.",
      parameters: z.object({
        query: z
          .string()
          .describe(
            'OpenSearch-style query, e.g. "inventionTitle:vector AND cpcClassificationText:G06N"'
          ),
        dateFrom: z.string().optional().describe('Filing date lower bound (ISO 8601)'),
        dateTo: z.string().optional().describe('Filing date upper bound (ISO 8601)'),
        status: z
          .enum(['Patented', 'Pending', 'Abandoned', 'Published'])
          .optional(),
        limit: z.number().int().min(1).max(25).default(10)
      }),
      execute: instrument(
        'uspto.fileWrapper.search',
        t,
        runner({
          query: Q_USPTO_FW_SEARCH,
          variables: (a) => a,
          pick: (d) => d.usptoFileWrapperSearch,
          direct: searchFileWrapper
        })
      )
    }),

    uspto_fileWrapperDetail: tool({
      description:
        'Full prosecution history for a known US application number — transactions (office actions, IDS, allowances), downloadable documents, and continuity (parent/child applications). Use to weight litigation/validity risk: a patent that has survived multiple non-final rejections then issued is harder to invalidate. Application number format: digits only (e.g. "18123456"), no slashes or dashes.',
      parameters: z.object({
        applicationNo: z.string().describe('US application number, digits only')
      }),
      execute: instrument(
        'uspto.fileWrapper.detail',
        t,
        runner({
          query: Q_USPTO_FW_DETAIL,
          variables: (a) => a,
          pick: (d) => d.usptoFileWrapperDetail,
          direct: (a) => getFileWrapperDetail(a.applicationNo)
        })
      )
    }),

    akashml_rerankPriorArt: tool({
      description:
        'Use Kimi K2.6 on Akash ML to semantically rerank GitHub prior-art candidates against a claim summary. Returns scores and one-sentence invalidation reasoning per candidate.',
      parameters: z.object({
        claimSummary: z.string(),
        candidates: z.array(
          z.object({
            repo: z.string(),
            evidenceSnippet: z.string(),
            firstCommitDate: z.string()
          })
        )
      }),
      execute: instrument(
        'akashml.rerankPriorArt',
        t,
        runner({
          query: Q_AKASH_RERANK,
          variables: (a) => a,
          pick: (d) => d.rerankPriorArt,
          direct: rerankPriorArt
        })
      )
    })
  };
}

export type McpTools = ReturnType<typeof getMcpTools>;
export type McpToolName = keyof McpTools;
