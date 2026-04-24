import 'server-only';
import { PatentHitSchema, type PatentHit, withFallback } from './_common';

type PatentsViewResponse = {
  patents?: Array<{
    patent_number: string;
    patent_title: string;
    patent_abstract?: string;
    patent_date?: string;
    assignees?: Array<{ assignee_organization?: string }>;
    cpcs?: Array<{ cpc_subgroup_id?: string }>;
  }>;
};

const PV_BASE = 'https://api.patentsview.org/patents/query';

async function callPatentsView(body: object): Promise<PatentsViewResponse> {
  const key = process.env.USPTO_API_KEY;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['X-Api-Key'] = key;

  const res = await fetch(PV_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PatentsView ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function searchUspto(args: {
  query: string;
  cpcClass?: string;
  dateFrom?: string;
  limit?: number;
}) {
  const limit = args.limit ?? 10;

  return withFallback<PatentHit[]>(
    'uspto.search',
    async () => {
      const q: Record<string, unknown> = {
        _text_any: { patent_abstract: args.query }
      };
      if (args.dateFrom) {
        (q as Record<string, unknown>)._gte = { patent_date: args.dateFrom };
      }
      const data = await callPatentsView({
        q,
        f: [
          'patent_number',
          'patent_title',
          'patent_abstract',
          'patent_date',
          'assignee_organization',
          'cpc_subgroup_id'
        ],
        o: { per_page: limit }
      });
      return (data.patents ?? []).map((p) =>
        PatentHitSchema.parse({
          patentNo: p.patent_number,
          title: p.patent_title ?? '',
          abstract: p.patent_abstract ?? '',
          priorityDate: p.patent_date ?? '',
          assignee: p.assignees?.[0]?.assignee_organization ?? '',
          cpcClasses: (p.cpcs ?? [])
            .map((c) => c.cpc_subgroup_id ?? '')
            .filter(Boolean),
          url: `https://patents.google.com/patent/${p.patent_number}`
        })
      );
    },
    () => [
      PatentHitSchema.parse({
        patentNo: 'US12000001B1',
        title: 'Method for agentic tool orchestration in LLM systems',
        abstract: '[mock] Agentic orchestration of tools over a gateway protocol.',
        priorityDate: '2024-04-15',
        assignee: 'Mockington Labs',
        cpcClasses: ['G06N20/00'],
        url: 'https://patents.google.com/patent/US12000001B1'
      })
    ]
  );
}

export async function getClaimText(patentNo: string) {
  return withFallback<{ patentNo: string; claims: string[] }>(
    'uspto.claim',
    async () => {
      const data = await callPatentsView({
        q: { patent_number: patentNo },
        f: ['patent_number', 'cited_patent_number', 'patent_abstract']
      });
      const first = data.patents?.[0];
      if (!first) throw new Error('no claim data');
      return {
        patentNo,
        claims: [first.patent_abstract ?? `No abstract for ${patentNo}`]
      };
    },
    () => ({
      patentNo,
      claims: [
        `[mock claim 1] A method comprising: receiving a user query; routing said query to an agent orchestrator; invoking one or more tools via a model context protocol gateway; and returning a structured risk report based on aggregated tool outputs.`,
        `[mock claim 2] The method of claim 1, wherein said tools include a patent database and a prior-art repository search.`
      ]
    })
  );
}

export async function getCitations(patentNo: string) {
  return withFallback<{
    patentNo: string;
    backwardCitations: string[];
    forwardCitations: string[];
  }>(
    'uspto.citations',
    async () => {
      const data = await callPatentsView({
        q: { patent_number: patentNo },
        f: ['patent_number', 'cited_patent_number', 'citedby_patent_number']
      });
      const first = data.patents?.[0] as Record<string, unknown> | undefined;
      const backward =
        (first?.['cited_patent_number'] as Array<{ cited_patent_number: string }>)?.map(
          (c) => c.cited_patent_number
        ) ?? [];
      const forward =
        (first?.['citedby_patent_number'] as Array<{
          citedby_patent_number: string;
        }>)?.map((c) => c.citedby_patent_number) ?? [];
      return { patentNo, backwardCitations: backward, forwardCitations: forward };
    },
    () => ({
      patentNo,
      backwardCitations: ['US9876543B2', 'US10123456B2'],
      forwardCitations: ['US11987654B2']
    })
  );
}

export async function getPtabHistory(patentNo: string) {
  return withFallback<{
    patentNo: string;
    iprPetitions: Array<{ petition: string; result: string }>;
    claimsCancelled: string[];
  }>(
    'ptab.history',
    async () => {
      throw new Error('PTAB live integration not yet implemented');
    },
    () => ({
      patentNo,
      iprPetitions: [],
      claimsCancelled: []
    })
  );
}
