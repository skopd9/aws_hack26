import 'server-only';
import {
  PatentHitSchema,
  type PatentHit,
  IntegrationError,
  failFromResponse
} from './_common';

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

async function callPatentsView(
  tool: string,
  body: object
): Promise<PatentsViewResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.USPTO_API_KEY;
  if (key) headers['X-Api-Key'] = key;

  const res = await fetch(PV_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) await failFromResponse(tool, res, 'PatentsView');
  // PatentsView occasionally returns a 200 HTML maintenance / deprecation
  // page instead of JSON. Surface that as a parse_error so the model sees a
  // clear "swap to a different patent source" hint instead of a raw
  // SyntaxError dumped from `res.json()`.
  const raw = await res.text();
  try {
    return JSON.parse(raw) as PatentsViewResponse;
  } catch (e) {
    throw new IntegrationError(
      tool,
      'parse_error',
      `PatentsView returned ${res.status} but the body was not JSON. The v1 endpoint may be deprecated or rate-limited; try googlePatents_search or tinyfish_searchUsptoPubs.`,
      { status: res.status, bodyHead: raw.slice(0, 240) }
    );
  }
}

export async function searchUspto(args: {
  query: string;
  cpcClass?: string;
  dateFrom?: string;
  limit?: number;
}): Promise<PatentHit[]> {
  const tool = 'uspto.search';
  const limit = args.limit ?? 10;

  const q: Record<string, unknown> = {
    _text_any: { patent_abstract: args.query }
  };
  if (args.dateFrom) {
    (q as Record<string, unknown>)._gte = { patent_date: args.dateFrom };
  }

  const data = await callPatentsView(tool, {
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

  const hits = (data.patents ?? []).map((p) =>
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

  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `PatentsView returned no patents matching "${args.query}"${
        args.dateFrom ? ` after ${args.dateFrom}` : ''
      }. Try broader keywords or a different tool (googlePatents_search, tinyfish_searchUsptoPubs).`
    );
  }
  return hits;
}

export async function getClaimText(
  patentNo: string
): Promise<{ patentNo: string; claims: string[] }> {
  const tool = 'uspto.claim';
  const data = await callPatentsView(tool, {
    q: { patent_number: patentNo },
    f: ['patent_number', 'cited_patent_number', 'patent_abstract']
  });
  const first = data.patents?.[0];
  if (!first) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `PatentsView has no record for ${patentNo}. Verify the patent number or try tinyfish_searchUsptoPubs which falls back to ppubs.uspto.gov.`
    );
  }
  return {
    patentNo,
    claims: [first.patent_abstract ?? `No abstract for ${patentNo}`]
  };
}

export async function getCitations(patentNo: string): Promise<{
  patentNo: string;
  backwardCitations: string[];
  forwardCitations: string[];
}> {
  const tool = 'uspto.citations';
  const data = await callPatentsView(tool, {
    q: { patent_number: patentNo },
    f: ['patent_number', 'cited_patent_number', 'citedby_patent_number']
  });
  const first = data.patents?.[0] as Record<string, unknown> | undefined;
  if (!first) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `PatentsView has no citation graph for ${patentNo}.`
    );
  }
  const backward =
    (first['cited_patent_number'] as Array<{ cited_patent_number: string }>)?.map(
      (c) => c.cited_patent_number
    ) ?? [];
  const forward =
    (first['citedby_patent_number'] as Array<{ citedby_patent_number: string }>)?.map(
      (c) => c.citedby_patent_number
    ) ?? [];
  return { patentNo, backwardCitations: backward, forwardCitations: forward };
}

export async function getPtabHistory(patentNo: string): Promise<{
  patentNo: string;
  iprPetitions: Array<{ petition: string; result: string }>;
  claimsCancelled: string[];
}> {
  throw new IntegrationError(
    'ptab.history',
    'not_implemented',
    `PTAB live integration is not wired up yet (patentNo=${patentNo}). Treat IPR history as unknown in your risk assessment, or skip this step.`
  );
}
