import 'server-only';
import { PatentHitSchema, type PatentHit, withFallback } from './_common';
import { crawlUrl } from './tinyfish';

export type GooglePatentsQuery = {
  query: string;
  cpcClass?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

function buildUrl(q: GooglePatentsQuery): string {
  const params = new URLSearchParams();
  params.set('q', q.query);
  if (q.cpcClass) params.append('cpc', q.cpcClass);
  if (q.dateFrom) params.set('after', `priority:${q.dateFrom}`);
  if (q.dateTo) params.set('before', `priority:${q.dateTo}`);
  return `https://patents.google.com/?${params.toString()}`;
}

function extractHits(html: string, limit: number): PatentHit[] {
  const hits: PatentHit[] = [];
  const re =
    /data-result[^>]+data-patent-number="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<span[^>]*>([^<]*)<\/span>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < limit) {
    const [, patentNo, titleRaw, assigneeRaw] = match;
    hits.push(
      PatentHitSchema.parse({
        patentNo: patentNo.trim(),
        title: titleRaw.replace(/<[^>]+>/g, '').trim(),
        assignee: assigneeRaw.trim(),
        url: `https://patents.google.com/patent/${patentNo.trim()}`
      })
    );
  }
  return hits;
}

export async function searchPatents(q: GooglePatentsQuery) {
  const limit = q.limit ?? 10;

  return withFallback<PatentHit[]>(
    'googlePatents.search',
    async () => {
      const url = buildUrl(q);
      const crawl = await crawlUrl(url, 'search-result');
      const hits = extractHits(crawl.data.html, limit);
      if (hits.length === 0 && crawl.outcome !== 'ok') {
        throw new Error('crawl returned no hits and was not a live success');
      }
      return hits;
    },
    () => mockHits(q, limit)
  );
}

function mockHits(q: GooglePatentsQuery, limit: number): PatentHit[] {
  const seeds = [
    {
      patentNo: 'US20250123456A1',
      title: 'Retrieval-augmented generation with vector-indexed claim chunks',
      assignee: 'Acme AI Research Corp.',
      priorityDate: '2024-07-02',
      cpcClasses: ['G06F16/3347', 'G06N3/0455'],
      abstract:
        'Systems and methods for retrieval-augmented generation wherein claim-level chunks are indexed in a vector store and surfaced by similarity to a user query.'
    },
    {
      patentNo: 'US12118765B2',
      title: 'LLM agent with dynamic tool selection via a gateway',
      assignee: 'Northwind Patents LLC',
      priorityDate: '2023-11-18',
      cpcClasses: ['G06N20/00', 'G06F9/54'],
      abstract:
        'A large language model agent selects tools exposed via a central gateway conforming to a model context protocol.'
    },
    {
      patentNo: 'US20241089234A1',
      title: 'Serverless vector similarity search with tenant isolation',
      assignee: 'Helios Vector Inc.',
      priorityDate: '2024-02-09',
      cpcClasses: ['G06F16/90348'],
      abstract:
        'A serverless system performs vector similarity search while enforcing per-tenant isolation in a shared index.'
    }
  ];
  return seeds.slice(0, limit).map((s) =>
    PatentHitSchema.parse({
      ...s,
      url: `https://patents.google.com/patent/${s.patentNo}`
    })
  );
}
