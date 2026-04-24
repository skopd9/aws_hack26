import 'server-only';
import {
  PriorArtCandidateSchema,
  type PriorArtCandidate,
  withFallback
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
}) {
  const limit = args.limit ?? 8;

  return withFallback<PriorArtCandidate[]>(
    'github.priorArt',
    async () => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error('GITHUB_TOKEN missing');

      const keywords = topKeywords(args.claimSummary, 5).join(' ');
      const priorityCutoff = isoDateOrNow(args.priorityDate);
      const params = new URLSearchParams({
        q: `${keywords} created:<${priorityCutoff}`,
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
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as GhSearchResponse;

      return data.items.map((r) =>
        PriorArtCandidateSchema.parse({
          repo: r.full_name,
          url: r.html_url,
          firstCommitDate: r.created_at.slice(0, 10),
          stars: r.stargazers_count,
          evidenceSnippet: r.description ?? '',
          predatesPriorityDate:
            r.created_at.slice(0, 10) < isoDateOrNow(args.priorityDate)
        })
      );
    },
    () => [
      PriorArtCandidateSchema.parse({
        repo: 'langchain-ai/langchain',
        url: 'https://github.com/langchain-ai/langchain',
        firstCommitDate: '2022-10-17',
        stars: 92000,
        evidenceSnippet:
          'Tool-calling agent framework with retrieval chains predating many 2024+ claim filings.',
        predatesPriorityDate: args.priorityDate > '2022-10-17'
      }),
      PriorArtCandidateSchema.parse({
        repo: 'hwchase17/chat-langchain',
        url: 'https://github.com/hwchase17/chat-langchain',
        firstCommitDate: '2023-02-04',
        stars: 5300,
        evidenceSnippet:
          'Retrieval-augmented chat reference implementation with vector-indexed chunks.',
        predatesPriorityDate: args.priorityDate > '2023-02-04'
      })
    ]
  );
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
