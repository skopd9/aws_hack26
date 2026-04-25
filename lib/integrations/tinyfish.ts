import 'server-only';
import {
  PriorArtCandidateSchema,
  type PriorArtCandidate,
  IntegrationError,
  failFromResponse,
  requireEnv
} from './_common';

// TinyFish has three production hosts (https://docs.tinyfish.ai/llms.txt):
//   - https://api.fetch.tinyfish.ai     -> render + extract a URL
//   - https://api.search.tinyfish.ai    -> web search
//   - https://agent.tinyfish.ai/v1/...  -> browser automation (SSE)
// Auth header is X-API-Key (NOT Authorization: Bearer).
const FETCH_URL = process.env.TINYFISH_FETCH_URL ?? 'https://api.fetch.tinyfish.ai';
const SEARCH_URL = process.env.TINYFISH_SEARCH_URL ?? 'https://api.search.tinyfish.ai';

export type TinyFishFetchResult = {
  url: string;
  finalUrl: string | null;
  title: string;
  description: string | null;
  text: string;
  format: 'markdown' | 'html' | 'json';
  latencyMs?: number;
};

export type TinyFishCrawlResult = {
  url: string;
  html: string;
  text: string;
  title: string;
};

export type TinyFishSearchHit = {
  position: number;
  title: string;
  url: string;
  snippet: string;
  siteName: string;
};

type FetchApiResponse = {
  results: Array<{
    url: string;
    final_url: string | null;
    title: string | null;
    description: string | null;
    language: string | null;
    format: 'markdown' | 'html' | 'json';
    text: string | null;
    latency_ms?: number;
  }>;
  errors: Array<{ url: string; error: string }>;
};

type SearchApiResponse = {
  query: string;
  results: Array<{
    position: number;
    site_name?: string;
    snippet?: string;
    title?: string;
    url: string;
  }>;
  total_results?: number;
  page?: number;
};

async function fetchOne(
  tool: string,
  url: string,
  format: 'markdown' | 'html' = 'markdown'
): Promise<TinyFishFetchResult> {
  const key = requireEnv(tool, 'TINYFISH_API_KEY');
  const res = await fetch(FETCH_URL + '/', {
    method: 'POST',
    headers: {
      'X-API-Key': key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ urls: [url], format })
  });
  if (!res.ok) await failFromResponse(tool, res, 'TinyFish Fetch');
  const json = (await res.json()) as FetchApiResponse;
  const first = json.results?.[0];
  const err = json.errors?.find((e) => e.url === url);
  if (!first || !first.text) {
    throw new IntegrationError(
      tool,
      'upstream_error',
      `TinyFish fetch returned no content for ${url}. Upstream error: ${err?.error ?? 'unspecified'}`
    );
  }
  return {
    url: first.url,
    finalUrl: first.final_url,
    title: first.title ?? '',
    description: first.description,
    text: first.text,
    format: first.format,
    latencyMs: first.latency_ms
  };
}

export async function fetchPage(
  url: string,
  format: 'markdown' | 'html' = 'markdown'
): Promise<TinyFishFetchResult> {
  return fetchOne('tinyfish.fetch', url, format);
}

// Back-compat: googlePatents.ts no longer uses crawlUrl, but a few callers do.
export async function crawlUrl(
  url: string,
  _waitFor?: string
): Promise<TinyFishCrawlResult> {
  const r = await fetchOne('tinyfish.crawl', url, 'html');
  return { url: r.url, html: r.text, text: r.text, title: r.title };
}

export async function webSearch(args: {
  query: string;
  location?: string;
  language?: string;
  page?: number;
}): Promise<TinyFishSearchHit[]> {
  const tool = 'tinyfish.search';
  const key = requireEnv(tool, 'TINYFISH_API_KEY');

  const params = new URLSearchParams({ query: args.query });
  if (args.location) params.set('location', args.location);
  if (args.language) params.set('language', args.language);
  if (typeof args.page === 'number') params.set('page', String(args.page));

  const res = await fetch(`${SEARCH_URL}/?${params.toString()}`, {
    method: 'GET',
    headers: { 'X-API-Key': key }
  });
  if (!res.ok) await failFromResponse(tool, res, 'TinyFish Search');
  const json = (await res.json()) as SearchApiResponse;
  const hits = (json.results ?? []).map((r) => ({
    position: r.position,
    title: r.title ?? '',
    url: r.url,
    snippet: r.snippet ?? '',
    siteName: r.site_name ?? ''
  }));
  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `TinyFish search returned 0 results for "${args.query}".`
    );
  }
  return hits;
}

export type VerifyProductResult = {
  evidence: Array<{ url: string; snippet: string; confidence: number }>;
  confidence: number;
  summary: string;
};

export async function verifyProductUsage(
  claimSummary: string,
  productDomain: string
): Promise<VerifyProductResult> {
  const tool = 'tinyfish.verifyProduct';
  if (!productDomain) {
    throw new IntegrationError(
      tool,
      'invalid_input',
      `productDomain is empty. Pass an apex domain (e.g. "openai.com").`
    );
  }
  const queryTerms = claimSummary.slice(0, 120);

  // webSearch throws empty_result on zero hits — let that bubble; the agent
  // will see "no matching pages found", which is a meaningful evidence
  // signal in itself (no public product surface for the claim).
  let hits: TinyFishSearchHit[];
  try {
    hits = await webSearch({
      query: `site:${productDomain} ${queryTerms}`,
      location: 'US'
    });
  } catch (err) {
    if (err instanceof IntegrationError && err.cause === 'empty_result') {
      return {
        evidence: [],
        confidence: 0,
        summary: `No public pages on ${productDomain} match "${queryTerms.slice(0, 80)}". Treat product-in-market as unverified.`
      };
    }
    throw err;
  }

  const top = hits.slice(0, 3);

  // Best-effort: pull readable text from the top hit. A failure here is
  // non-fatal — the snippet is still useful evidence.
  let topText = '';
  if (top[0]) {
    try {
      const page = await fetchOne(tool, top[0].url, 'markdown');
      topText = page.text.slice(0, 600);
    } catch {
      /* keep snippet-only evidence */
    }
  }

  const evidence = top.map((h, i) => ({
    url: h.url,
    snippet: i === 0 && topText ? topText : h.snippet,
    confidence: Math.max(0.4, 0.85 - i * 0.15)
  }));

  return {
    evidence,
    confidence: evidence[0]?.confidence ?? 0.4,
    summary: `Found ${top.length} page(s) on ${productDomain} matching: "${queryTerms.slice(0, 80)}".`
  };
}

// ---------------------------------------------------------------------------
// Topical web search surfaces (research papers, news, GitHub).
// ---------------------------------------------------------------------------

const RESEARCH_PAPER_SITES = [
  'arxiv.org',
  'semanticscholar.org',
  'scholar.google.com',
  'openreview.net',
  'aclanthology.org',
  'proceedings.mlr.press',
  'papers.nips.cc',
  'dl.acm.org',
  'ieeexplore.ieee.org'
];

const TECH_NEWS_SITES = [
  'techcrunch.com',
  'theverge.com',
  'arstechnica.com',
  'wired.com',
  'venturebeat.com',
  'theinformation.com',
  'reuters.com',
  'bloomberg.com',
  'ft.com'
];

export type ResearchPaperHit = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  arxivId: string | null;
};

export type NewsHit = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate: string | null;
};

function buildSiteOrQuery(query: string, sites: string[]): string {
  const siteClause = sites.map((s) => `site:${s}`).join(' OR ');
  return `(${siteClause}) ${query}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const ARXIV_RE = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i;

function extractArxivId(url: string): string | null {
  const m = url.match(ARXIV_RE);
  return m?.[1] ?? null;
}

function cleanNewsTitle(raw: string, source: string): string {
  return raw
    .replace(new RegExp(`\\s*[\\-–—|]\\s*${source.replace(/\./g, '\\.')}\\s*$`, 'i'), '')
    .trim();
}

const SNIPPET_DATE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/;

function extractDateFromSnippet(snippet: string): string | null {
  const m = snippet.match(SNIPPET_DATE_RE);
  if (!m) return null;
  const d = new Date(m[0]);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function searchResearchPapers(args: {
  query: string;
  sites?: string[];
  limit?: number;
}): Promise<ResearchPaperHit[]> {
  const tool = 'tinyfish.researchPapers';
  const limit = args.limit ?? 8;
  const sites =
    args.sites && args.sites.length > 0 ? args.sites : RESEARCH_PAPER_SITES;

  const search = await webSearch({
    query: buildSiteOrQuery(args.query, sites),
    location: 'US',
    language: 'en'
  });

  const hits: ResearchPaperHit[] = [];
  const seen = new Set<string>();
  for (const r of search) {
    const host = hostnameOf(r.url);
    if (
      !sites.some(
        (s) => host === s || host.endsWith('.' + s) || host.endsWith(s)
      )
    ) {
      continue;
    }
    if (seen.has(r.url)) continue;
    seen.add(r.url);

    hits.push({
      title: r.title
        .replace(
          /\s*[-—|]\s*(arXiv|Semantic Scholar|Google Scholar|OpenReview).*$/i,
          ''
        )
        .trim(),
      url: r.url,
      snippet: r.snippet,
      source: host || r.siteName,
      arxivId: extractArxivId(r.url)
    });
    if (hits.length >= limit) break;
  }
  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `Web search returned no whitelisted research-paper hits for "${args.query}" across ${sites.length} sites. Try broader keywords or pass a custom sites[] list.`
    );
  }
  return hits;
}

export async function searchNews(args: {
  query: string;
  sites?: string[];
  dateFrom?: string;
  limit?: number;
}): Promise<NewsHit[]> {
  const tool = 'tinyfish.news';
  const limit = args.limit ?? 8;
  const sites = args.sites && args.sites.length > 0 ? args.sites : TECH_NEWS_SITES;

  const queryParts = [buildSiteOrQuery(args.query, sites)];
  if (args.dateFrom) queryParts.push(`after:${args.dateFrom}`);
  const search = await webSearch({
    query: queryParts.join(' '),
    location: 'US',
    language: 'en'
  });

  const hits: NewsHit[] = [];
  const seen = new Set<string>();
  for (const r of search) {
    const host = hostnameOf(r.url);
    if (
      !sites.some(
        (s) => host === s || host.endsWith('.' + s) || host.endsWith(s)
      )
    ) {
      continue;
    }
    if (seen.has(r.url)) continue;
    seen.add(r.url);

    const source = host || r.siteName;
    hits.push({
      title: cleanNewsTitle(r.title, source),
      url: r.url,
      snippet: r.snippet,
      source,
      publishedDate: extractDateFromSnippet(r.snippet)
    });
    if (hits.length >= limit) break;
  }
  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `Web search returned no whitelisted news hits for "${args.query}". Sites checked: ${sites.length}.`
    );
  }
  return hits;
}

// ---------------------------------------------------------------------------
// USPTO via TinyFish: search ppubs.uspto.gov + full-text crawl.
// ---------------------------------------------------------------------------

export type UsptoPubHit = {
  patentNo: string;
  title: string;
  abstract: string;
  claimText: string;
  url: string;
  ppubsUrl: string;
  kind: 'granted' | 'application' | 'unknown';
};

const PPUBS_PATENT_NO_RE = /patentNumber\.eq\.(US[\dA-Z]+)/i;

const BARE_PATENT_NO_RE =
  /\b(US\s*(?:20\d{2}[\s/]?\d{7}|\d{1,3}[,\s]?\d{3}[,\s]?\d{3})(?:\s*[A-Z]\d?)?)\b/i;

function parsePatentNo(url: string, snippet: string): string | null {
  const m1 = url.match(PPUBS_PATENT_NO_RE);
  if (m1) return m1[1].replace(/\s/g, '');
  const m2 = (url + ' ' + snippet).match(BARE_PATENT_NO_RE);
  if (m2) return m2[1].replace(/[\s,]/g, '');
  return null;
}

function classifyKind(no: string): UsptoPubHit['kind'] {
  if (/^US20\d{9}/.test(no)) return 'application';
  if (/^US\d{7,8}/.test(no)) return 'granted';
  return 'unknown';
}

function patftUrl(patentNo: string): string {
  const bare = patentNo.replace(/^US/, '').replace(/[A-Z]\d?$/, '');
  return (
    `https://patft.uspto.gov/netacgi/nph-Parser?Sect1=PTO1&Sect2=HITOFF` +
    `&d=PALL&p=1&u=%2Fnetahtml%2FPTO%2Fsrchnum.htm&r=1&f=G&l=50` +
    `&s1=${encodeURIComponent(bare)}.PN.`
  );
}

function extractClaims(pageText: string): string {
  const lower = pageText.toLowerCase();
  const claimsIdx =
    lower.indexOf('\nclaims\n') !== -1
      ? lower.indexOf('\nclaims\n')
      : lower.indexOf('claims\n');
  if (claimsIdx === -1) return '';
  const descIdx = lower.indexOf('\ndescription\n', claimsIdx + 8);
  const end = descIdx !== -1 ? descIdx : claimsIdx + 4000;
  return pageText.slice(claimsIdx, end).trim().slice(0, 3000);
}

/** True if s looks like a bare patent number with no other words. */
function isSinglePatentNo(s: string): boolean {
  return /^[A-Z]{2}[\dA-Z]+$/i.test(s.trim().replace(/\s+/g, ''));
}

export async function searchUsptoPubs(args: {
  query: string;
  dateFrom?: string;
  limit?: number;
  fetchFullText?: boolean;
}): Promise<UsptoPubHit[]> {
  const tool = 'tinyfish.usptoSearch';
  const limit = args.limit ?? 8;
  const fetchFull = args.fetchFullText ?? true;

  // For a bare patent number the ppubs.uspto.gov site: search returns nothing —
  // the database is not fully indexed. Build the canonical PATFT/ppubs URL directly.
  const normalizedQuery = args.query.trim().replace(/\s+/g, '').toUpperCase();
  if (isSinglePatentNo(args.query)) {
    const kind = classifyKind(normalizedQuery);
    const fetchTarget =
      kind === 'granted'
        ? patftUrl(normalizedQuery)
        : `https://ppubs.uspto.gov/dirsearch-public/print/downloadPdf/${normalizedQuery}`;
    const ppubsUrl = `https://ppubs.uspto.gov/pubwebapp/external.html?q=(patentNumber.eq.${normalizedQuery})&db=USPAT`;

    let claimText = '';
    let abstract = '';
    let title = normalizedQuery;

    if (fetchFull) {
      try {
        const page = await fetchOne(tool, fetchTarget, 'markdown');
        claimText = extractClaims(page.text);
        const absIdx = page.text.toLowerCase().indexOf('abstract');
        if (absIdx !== -1) {
          const afterAbs = page.text.slice(absIdx + 8, absIdx + 1200).trim();
          if (afterAbs.length > 20) abstract = afterAbs.split('\n')[0].trim();
        }
        title =
          (page.title ?? '')
            .replace(/\s*[-—]\s*(USPTO|US Patent|PATFT).*$/i, '')
            .replace(new RegExp(`^${normalizedQuery}\\s*[-—]\\s*`, 'i'), '')
            .trim() || normalizedQuery;
      } catch {
        /* fall through to the web-search path below */
      }
    }

    // Only short-circuit if we actually got something useful.
    if (abstract || claimText) {
      return [{ patentNo: normalizedQuery, title, abstract, claimText, url: fetchTarget, ppubsUrl, kind }];
    }
  }

  const queryParts = [`site:ppubs.uspto.gov ${args.query}`];
  if (args.dateFrom) queryParts.push(`after:${args.dateFrom}`);

  const search = await webSearch({
    query: queryParts.join(' '),
    location: 'US',
    language: 'en'
  });

  const hits: UsptoPubHit[] = [];
  const seen = new Set<string>();

  for (const r of search) {
    if (!r.url.includes('ppubs.uspto.gov')) continue;
    const patentNo = parsePatentNo(r.url, r.snippet);
    if (!patentNo || seen.has(patentNo)) continue;
    seen.add(patentNo);

    const kind = classifyKind(patentNo);
    const ppubsUrl = r.url;

    let claimText = '';
    let abstract = r.snippet;
    const fetchTarget = kind === 'granted' ? patftUrl(patentNo) : ppubsUrl;

    if (fetchFull) {
      try {
        const page = await fetchOne(tool, fetchTarget, 'markdown');
        claimText = extractClaims(page.text);
        const absIdx = page.text.toLowerCase().indexOf('abstract');
        if (absIdx !== -1) {
          const afterAbs = page.text.slice(absIdx + 8, absIdx + 1200).trim();
          if (afterAbs.length > 20) abstract = afterAbs.split('\n')[0].trim();
        }
      } catch {
        /* keep snippet-only on individual page-fetch failure */
      }
    }

    hits.push({
      patentNo,
      title: r.title
        .replace(/\s*[-—]\s*(USPTO|US Patent|ppubs).*$/i, '')
        .replace(new RegExp(`^${patentNo}\\s*[-—]\\s*`, 'i'), '')
        .trim(),
      abstract,
      claimText,
      url: fetchTarget,
      ppubsUrl,
      kind
    });

    if (hits.length >= limit) break;
  }

  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `USPTO ppubs web search returned no results for "${args.query}"${
        args.dateFrom ? ` after ${args.dateFrom}` : ''
      }. Try uspto_search (PatentsView) or googlePatents_search.`
    );
  }
  return hits;
}

// ---------------------------------------------------------------------------
// GitHub via TinyFish web search.
// ---------------------------------------------------------------------------

const GITHUB_REPO_RE = /^https?:\/\/github\.com\/([^\/\s#?]+)\/([^\/\s#?]+)(?:\/?$|\/[^\s]*)/i;

function extractRepoSlug(url: string): string | null {
  const m = url.match(GITHUB_REPO_RE);
  if (!m) return null;
  const owner = m[1];
  const name = m[2];
  if (
    ['features', 'pricing', 'enterprise', 'about', 'topics', 'sponsors'].includes(
      owner.toLowerCase()
    )
  ) {
    return null;
  }
  return `${owner}/${name}`;
}

export async function searchGithubRepos(args: {
  query: string;
  priorityDate?: string;
  limit?: number;
}): Promise<PriorArtCandidate[]> {
  const tool = 'tinyfish.githubRepos';
  const limit = args.limit ?? 8;
  const priorityDate = args.priorityDate ?? '';
  void priorityDate;

  const search = await webSearch({
    query: `site:github.com ${args.query}`,
    location: 'US',
    language: 'en'
  });

  const hits: PriorArtCandidate[] = [];
  const seen = new Set<string>();
  for (const r of search) {
    const slug = extractRepoSlug(r.url);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    hits.push(
      PriorArtCandidateSchema.parse({
        repo: slug,
        url: `https://github.com/${slug}`,
        firstCommitDate: extractDateFromSnippet(r.snippet) ?? '',
        stars: 0,
        evidenceSnippet: r.snippet,
        predatesPriorityDate: false
      })
    );
    if (hits.length >= limit) break;
  }
  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `Web search returned no github.com repositories for "${args.query}". Try github_priorArt for the REST API surface, or rephrase the query.`
    );
  }
  return hits;
}
