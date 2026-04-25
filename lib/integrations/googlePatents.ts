import 'server-only';
import { PatentHitSchema, type PatentHit, IntegrationError } from './_common';
import { webSearch, fetchPage } from './tinyfish';

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

// A bare patent number: US12118765B2, EP3824689A1, WO2023123456A1, …
// No spaces, starts with 2+ capital letters followed by digits and an optional kind code.
const BARE_PATENT_NO_RE = /^([A-Z]{2}\d[\dA-Z]*)$/i;

function normPatentNo(s: string): string | null {
  const t = s.trim().replace(/\s+/g, '').toUpperCase();
  return BARE_PATENT_NO_RE.test(t) ? t : null;
}

/** Direct-fetch a single patent page and return a PatentHit (no search needed). */
async function fetchPatentDirect(tool: string, patentNo: string): Promise<PatentHit | null> {
  const url = `https://patents.google.com/patent/${patentNo}`;
  try {
    const page = await fetchPage(url, 'markdown');
    const text = page.text;

    // Abstract: look for "Abstract" section header.
    const absIdx = text.toLowerCase().indexOf('abstract');
    const abstract =
      absIdx !== -1
        ? text.slice(absIdx + 8, absIdx + 1200).trim().split(/\n{2,}/)[0].trim()
        : page.description ?? page.title ?? '';

    // Title: first non-empty line that isn't just the patent number.
    const title =
      (page.title ?? '')
        .replace(/\s*[-—]\s*Google Patents\s*$/i, '')
        .replace(new RegExp(`^${patentNo}\\s*[-—]\\s*`, 'i'), '')
        .trim() || patentNo;

    return PatentHitSchema.parse({ patentNo, title, abstract: abstract.slice(0, 800), url });
  } catch {
    return null;
  }
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

  // When the query is a bare patent number (e.g. "US12118765B2"), a site: web
  // search rarely surfaces it — the patent databases are not reliably crawled.
  // Directly fetching the canonical Google Patents URL is faster and more reliable.
  const singleNo = normPatentNo(q.query);
  if (singleNo) {
    const hit = await fetchPatentDirect(tool, singleNo);
    if (hit) return [hit];
    // If the direct fetch also fails, fall through to the web-search path so
    // the caller gets a proper empty_result error rather than a silent null.
  }

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
