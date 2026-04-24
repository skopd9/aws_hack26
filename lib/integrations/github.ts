import 'server-only';
import {
  PriorArtCandidateSchema,
  type PriorArtCandidate,
  IntegrationError,
  failFromResponse,
  requireEnv
} from './_common';

type GhSearchResponse = {
  total_count: number;
  items: Array<{
    name: string;
    full_name: string;
    html_url: string;
    stargazers_count: number;
    created_at: string;
    pushed_at: string;
    description: string | null;
  }>;
};

export async function findPriorArt(args: {
  claimSummary: string;
  priorityDate: string;
  limit?: number;
}): Promise<PriorArtCandidate[]> {
  const tool = 'github.priorArt';
  const limit = args.limit ?? 8;
  const token = requireEnv(tool, 'GITHUB_TOKEN');

  const keywords = topKeywords(args.claimSummary, 5);
  if (keywords.length === 0) {
    throw new IntegrationError(
      tool,
      'invalid_input',
      `claimSummary "${args.claimSummary.slice(0, 80)}" yielded zero keywords after stop-word filtering. Pass a richer summary (run akashml_summarizeClaim first).`
    );
  }
  const priorityCutoff = isoDateOrNow(args.priorityDate);
  const params = new URLSearchParams({
    q: `${keywords.join(' ')} created:<${priorityCutoff}`,
    sort: 'stars',
    order: 'desc',
    per_page: String(limit)
  });

  const res = await fetch(
    `https://api.github.com/search/repositories?${params.toString()}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );
  if (!res.ok) await failFromResponse(tool, res, 'GitHub Search API');
  const data = (await res.json()) as GhSearchResponse;

  const hits = data.items.map((r) =>
    PriorArtCandidateSchema.parse({
      repo: r.full_name,
      url: r.html_url,
      firstCommitDate: r.created_at.slice(0, 10),
      stars: r.stargazers_count,
      evidenceSnippet: r.description ?? '',
      predatesPriorityDate: r.created_at.slice(0, 10) < priorityCutoff
    })
  );

  if (hits.length === 0) {
    throw new IntegrationError(
      tool,
      'empty_result',
      `GitHub Search API returned 0 repos for keywords [${keywords.join(', ')}] created:<${priorityCutoff}. Try tinyfish_githubRepos for a broader web sweep, or relax the priority cutoff.`
    );
  }
  return hits;
}

function isoDateOrNow(input: string): string {
  const d = input && !isNaN(Date.parse(input)) ? new Date(input) : new Date();
  return d.toISOString().slice(0, 10);
}

function topKeywords(text: string, n: number): string[] {
  const stop = new Set([
    'the',
    'a',
    'an',
    'of',
    'for',
    'and',
    'or',
    'to',
    'in',
    'on',
    'with',
    'by',
    'is',
    'are',
    'said',
    'wherein',
    'method',
    'comprising',
    'plurality'
  ]);
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || stop.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}
