import 'server-only';
import { PatentHitSchema, type PatentHit, IntegrationError } from './_common';
import { webSearch } from './tinyfish';

export type GooglePatentsQuery = {
  query: string;
  cpcClass?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

function buildQuery(q: GooglePatentsQuery): string {
  const parts: string[] = ['site:patents.google.com', q.query];
  if (q.cpcClass) parts.push(`"${q.cpcClass}"`);
  if (q.dateFrom) parts.push(`after:${q.dateFrom}`);
  if (q.dateTo) parts.push(`before:${q.dateTo}`);
  return parts.join(' ');
}

// patents.google.com URLs look like:
//   https://patents.google.com/patent/US12118765B2
//   https://patents.google.com/patent/US12118765B2/en
//   https://patents.google.com/patent/EP3824689A1/en
const PATENT_URL_RE =
  /^https?:\/\/patents\.google\.com\/patent\/([A-Z]{2}\d[A-Z0-9]*)(?:\/[a-z]{2})?\/?$/i;

function extractPatentNo(url: string): string | null {
  const m = url.match(PATENT_URL_RE);
  return m?.[1] ?? null;
}

export async function searchPatents(q: GooglePatentsQuery): Promise<PatentHit[]> {
  const tool = 'googlePatents.search';
  const limit = q.limit ?? 10;

  const search = await webSearch({
    query: buildQuery(q),
    location: 'US',
    language: 'en'
  });

  const hits: PatentHit[] = [];
  const seen = new Set<string>();
  for (const r of search) {
    const patentNo = extractPatentNo(r.url);
    if (!patentNo || seen.has(patentNo)) continue;
    seen.add(patentNo);

    // Title from Google Patents results is usually
    //   "Some title - Google Patents"
    // or "US12345678B2 — Some title"; strip these suffixes/prefixes.
    const title = r.title
      .replace(/\s*[-—]\s*Google Patents\s*$/i, '')
      .replace(new RegExp(`^${patentNo}\\s*[-—]\\s*`, 'i'), '')
      .trim();

    hits.push(
      PatentHitSchema.parse({
        patentNo,
        title,
        abstract: r.snippet,
        url: `https://patents.google.com/patent/${patentNo}`
      })
    );
    if (hits.length >= limit) break;
  }

  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `Web search returned no patents.google.com results for "${q.query}"${
        q.dateFrom ? ` after ${q.dateFrom}` : ''
      }${q.dateTo ? ` before ${q.dateTo}` : ''}. Try uspto_search or broader keywords.`
    );
  }
  return hits;
}
