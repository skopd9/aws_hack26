import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { recordToolCall } from '../redis/streams';
import { searchUspto, getClaimText, getCitations, getPtabHistory } from '../integrations/uspto';
import { searchPatents as searchGooglePatents } from '../integrations/googlePatents';
import { findPriorArt } from '../integrations/github';
import { litigationHistory } from '../integrations/pacer';
import { verifyProductUsage } from '../integrations/tinyfish';
import { latestFilings } from '../integrations/nexla';
import { upsertPatentEmbedding, similarPatents } from '../integrations/ghost';
import { summarizeClaim, rerankPriorArt } from '../integrations/akashml';

type WithOutcome<T> = {
  data: T;
  outcome: 'ok' | 'mock' | 'error';
  error?: string;
};

function instrument<Args, Out>(
  toolName: string,
  tenant: () => string,
  run: (args: Args) => Promise<WithOutcome<Out>>
) {
  return async (args: Args): Promise<Out> => {
    const start = Date.now();
    let outcome: 'ok' | 'mock' | 'error' = 'ok';
    let error: string | undefined;
    try {
      const res = await run(args);
      outcome = res.outcome;
      error = res.error;
      return res.data;
    } catch (err) {
      outcome = 'error';
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      void recordToolCall({
        tenant: tenant(),
        tool: toolName,
        args,
        outcome,
        durationMs: Date.now() - start,
        error,
        ts: Date.now()
      }).catch(() => {});
    }
  };
}

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
      execute: instrument('uspto.search', t, (args) => searchUspto(args))
    }),

    uspto_claim: tool({
      description:
        'Fetch the full claim text for a specific US patent by patent number. Use after uspto_search or googlePatents_search identifies a candidate of interest.',
      parameters: z.object({
        patentNo: z.string().describe('e.g. US12118765B2')
      }),
      execute: instrument('uspto.claim', t, (args) => getClaimText(args.patentNo))
    }),

    uspto_citations: tool({
      description:
        'Forward and backward citation graph for a US patent. Helps assess centrality and find related filings to sweep for.',
      parameters: z.object({ patentNo: z.string() }),
      execute: instrument('uspto.citations', t, (args) => getCitations(args.patentNo))
    }),

    ptab_history: tool({
      description:
        'PTAB (Patent Trial and Appeal Board) history for a patent: IPR petitions filed, claims cancelled. Strong signal for whether the patent has already survived challenge.',
      parameters: z.object({ patentNo: z.string() }),
      execute: instrument('ptab.history', t, (args) => getPtabHistory(args.patentNo))
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
      execute: instrument('googlePatents.search', t, (args) => searchGooglePatents(args))
    }),

    github_priorArt: tool({
      description:
        'Search GitHub for open-source repositories that may serve as prior art predating a patent priority date. Use after you have a claim summary.',
      parameters: z.object({
        claimSummary: z.string(),
        priorityDate: z.string(),
        limit: z.number().int().min(1).max(15).default(8)
      }),
      execute: instrument('github.priorArt', t, (args) => findPriorArt(args))
    }),

    pacer_litigationHistory: tool({
      description:
        'Litigation history for a patent assignee: count of patent cases filed, whether they pattern-match as a non-practicing entity (NPE / patent troll), recent cases. Backed by CourtListener (free) with PACER upgrade path.',
      parameters: z.object({ assignee: z.string() }),
      execute: instrument('pacer.litigationHistory', t, (args) =>
        litigationHistory(args.assignee)
      )
    }),

    tinyfish_verifyProduct: tool({
      description:
        'Use TinyFish to crawl a public product/site and check whether it describes doing the thing a patent claim covers. Grounds the risk assessment in real-world product behavior.',
      parameters: z.object({
        claimSummary: z.string(),
        productDomain: z.string().describe('e.g. vercel.com')
      }),
      execute: instrument('tinyfish.verifyProduct', t, (args) =>
        verifyProductUsage(args.claimSummary, args.productDomain)
      )
    }),

    nexla_latestFilings: tool({
      description:
        'Fetch the latest USPTO filings as ingested and normalized by the Nexla daily-bulk-feed pipeline. Use for "what was filed this week" style questions.',
      parameters: z.object({
        since: z.string().optional().describe('ISO date'),
        limit: z.number().int().min(1).max(50).default(20)
      }),
      execute: instrument('nexla.latestFilings', t, (args) => latestFilings(args))
    }),

    ghost_similarPatents: tool({
      description:
        'Vector-search the Ghost AI DB cache for semantically similar patents seen by IP-Pulse before. Hit this BEFORE hitting live sources to save latency on repeat queries.',
      parameters: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(15).default(5)
      }),
      execute: instrument('ghost.similarPatents', t, (args) => similarPatents(args))
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
      execute: instrument('ghost.upsert', t, (args) => upsertPatentEmbedding(args))
    }),

    akashml_summarizeClaim: tool({
      description:
        'Use Kimi K2.6 running on Akash ML decentralized GPUs to collapse dense claim language into an engineer-readable summary, grounded in the user\'s stack. This is the fastest way to close the Interpretation Gap on a patent.',
      parameters: z.object({
        patentNo: z.string(),
        claimText: z.string(),
        userStack: z.string()
      }),
      execute: instrument('akashml.summarizeClaim', t, (args) => summarizeClaim(args))
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
      execute: instrument('akashml.rerankPriorArt', t, (args) => rerankPriorArt(args))
    })
  };
}

export type McpTools = ReturnType<typeof getMcpTools>;
export type McpToolName = keyof McpTools;
