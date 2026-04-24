import 'server-only';
import { withFallback } from './_common';

export type TinyFishCrawlResult = {
  url: string;
  html: string;
  text: string;
  title: string;
  screenshot?: string;
};

export type VerifyProductResult = {
  evidence: Array<{ url: string; snippet: string; confidence: number }>;
  confidence: number;
  summary: string;
};

async function crawl(url: string, waitFor?: string): Promise<TinyFishCrawlResult> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) throw new Error('TINYFISH_API_KEY missing');

  const base = process.env.TINYFISH_BASE_URL ?? 'https://api.tinyfish.io';
  const res = await fetch(`${base}/crawl`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, waitFor, render: 'browser' })
  });

  if (!res.ok) {
    throw new Error(`TinyFish ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function crawlUrl(url: string, waitFor?: string) {
  return withFallback(
    'tinyfish.crawl',
    () => crawl(url, waitFor),
    () => ({
      url,
      html: '<html><body>[mock TinyFish result]</body></html>',
      text: 'Mock crawl text. TinyFish key missing or call failed.',
      title: 'Mock page'
    })
  );
}

export async function verifyProductUsage(
  claimSummary: string,
  productDomain: string
) {
  return withFallback<VerifyProductResult>(
    'tinyfish.verifyProduct',
    async () => {
      const query = encodeURIComponent(claimSummary.slice(0, 120));
      const url = `https://${productDomain}/search?q=${query}`;
      const crawlRes = await crawl(url, 'body');
      return {
        evidence: [
          {
            url: crawlRes.url,
            snippet: crawlRes.text.slice(0, 400),
            confidence: 0.6
          }
        ],
        confidence: 0.6,
        summary: `Scanned ${productDomain} for overlap with: "${claimSummary.slice(0, 80)}".`
      };
    },
    () => ({
      evidence: [
        {
          url: `https://${productDomain}/docs`,
          snippet: `[mock] Public docs describe functionality overlapping with the claim.`,
          confidence: 0.55
        }
      ],
      confidence: 0.55,
      summary: `[mock] Found plausible product-in-market evidence on ${productDomain}.`
    })
  );
}
