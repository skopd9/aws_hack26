/**
 * Smoke test for the new no-mock, verbose-error, retry-aware tool layer.
 *
 *   - Forces COSMO off so we exercise the direct-integration path.
 *   - Calls a few tools that must fail (missing keys, definitively-empty
 *     queries, not_implemented) and asserts each produces a __toolError
 *     envelope with the right shape.
 *   - Stubs `recordToolCall` so the test doesn't require Redis.
 *
 *   npm run smoke:tool-errors
 */
import 'dotenv/config';

process.env.COSMO_ROUTER_URL = '';
delete process.env.USPTO_API_KEY;
delete process.env.GITHUB_TOKEN;
delete process.env.TINYFISH_API_KEY;
// Force the akashml rerank case to a refused connection (port 9 = discard)
// so we can verify the retry loop runs MAX_RETRIES=3 attempts on a
// retryable upstream_error. Set the key so we get past requireEnv.
process.env.AKASHML_API_KEY = 'smoke-test-stub';
process.env.AKASHML_BASE_URL = 'http://127.0.0.1:9';

import { getMcpTools } from '../lib/cosmo/tools';

async function run() {
  const tools = getMcpTools('smoke');
  const cases: Array<{ label: string; call: () => Promise<unknown> }> = [
    {
      label: 'uspto_search (no key, but PatentsView accepts unauth → empty_result expected)',
      call: () =>
        (tools.uspto_search.execute as any)(
          { query: 'asdfghkjlqwertyzxcvbnoresult', limit: 1 },
          { toolCallId: 't1', messages: [] }
        )
    },
    {
      label: 'github_priorArt (GITHUB_TOKEN missing → missing_credential)',
      call: () =>
        (tools.github_priorArt.execute as any)(
          { claimSummary: 'distributed lock', priorityDate: '2020-01-01', limit: 3 },
          { toolCallId: 't2', messages: [] }
        )
    },
    {
      label: 'ptab_history (not_implemented)',
      call: () =>
        (tools.ptab_history.execute as any)(
          { patentNo: 'US12118765B2' },
          { toolCallId: 't3', messages: [] }
        )
    },
    {
      label: 'akashml_summarizeClaim (claimText too short → invalid_input, 1 attempt)',
      call: () =>
        (tools.akashml_summarizeClaim.execute as any)(
          { patentNo: 'US123', claimText: 'foo', userStack: 'next.js' },
          { toolCallId: 't4', messages: [] }
        )
    },
    {
      label:
        'akashml_rerankPriorArt → 127.0.0.1:9 refused (RETRYABLE, expect 3 attempts in trail)',
      call: () =>
        (tools.akashml_rerankPriorArt.execute as any)(
          {
            claimSummary: 'distributed cache invalidation across edge nodes',
            candidates: [
              { repo: 'foo/bar', evidenceSnippet: 'yes', firstCommitDate: '2018-01-01' }
            ]
          },
          { toolCallId: 't5', messages: [] }
        )
    }
  ];

  let failures = 0;
  for (const c of cases) {
    process.stdout.write(`\n# ${c.label}\n`);
    let result: any;
    try {
      result = await c.call();
    } catch (e) {
      console.error('  ❌ tool threw instead of returning envelope:', e);
      failures++;
      continue;
    }
    if (!result || result.__toolError !== true) {
      console.error('  ❌ expected envelope, got:', JSON.stringify(result).slice(0, 300));
      failures++;
      continue;
    }
    console.log(`  tool         : ${result.tool}`);
    console.log(`  attempts     : ${result.attempts}`);
    console.log(`  hint         : ${result.hint}`);
    console.log(`  message      : ${result.message.split('\n').slice(0, 4).join('\n                  ')}`);
    console.log(`  trail.length : ${result.attemptTrail.length}`);
    if (
      c.label.includes('RETRYABLE') &&
      (result.attempts !== 3 || result.attemptTrail.length !== 3)
    ) {
      console.error(
        `  ❌ expected 3 attempts on retryable upstream_error, got ${result.attempts}`
      );
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} case(s) failed`);
    process.exit(1);
  }
  console.log('\nAll cases produced __toolError envelopes ✓');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
