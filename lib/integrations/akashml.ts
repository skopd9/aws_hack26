import 'server-only';
import { IntegrationError, failFromResponse, requireEnv } from './_common';

type ChatCompletionResp = {
  choices: Array<{ message: { content: string } }>;
};

async function kimiChat(
  tool: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 600
): Promise<string> {
  const key = requireEnv(tool, 'AKASHML_API_KEY');
  const base = process.env.AKASHML_BASE_URL ?? 'https://api.akashml.com/v1';
  const model = process.env.AKASHML_MODEL ?? 'kimi-k2.6';

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2
    })
  });
  if (!res.ok) await failFromResponse(tool, res, `Akash ML (${model})`);
  const data = (await res.json()) as ChatCompletionResp;
  const content = data.choices[0]?.message?.content ?? '';
  if (!content) {
    throw new IntegrationError(
      tool,
      'parse_error',
      `Akash ML returned an empty completion (model=${model}). Likely a transient capacity issue on the decentralized GPU pool; retrying or using a different tool may help.`
    );
  }
  return content;
}

export async function summarizeClaim(args: {
  patentNo: string;
  claimText: string;
  userStack: string;
}): Promise<{ summary: string; roadmapImplication: string }> {
  const tool = 'akashml.summarizeClaim';
  if (!args.claimText || args.claimText.trim().length < 20) {
    throw new IntegrationError(
      tool,
      'invalid_input',
      `claimText is empty or too short (${args.claimText?.length ?? 0} chars). Run uspto_claim or tinyfish_searchUsptoPubs(fetchFullText=true) first to fetch real claim text for ${args.patentNo}.`
    );
  }

  const raw = await kimiChat(
    tool,
    [
      {
        role: 'system',
        content:
          "You are a patent-claim interpreter for software engineers. Given a claim text and the engineer's stack description, produce: (1) a one-paragraph plain-English summary of what the claim covers, then (2) a one-sentence assessment of whether it overlaps with the described stack. Be direct."
      },
      {
        role: 'user',
        content: `PATENT: ${args.patentNo}\n\nCLAIM:\n${args.claimText}\n\nENGINEER'S STACK:\n${args.userStack}\n\nReturn exactly:\nSUMMARY: <paragraph>\nOVERLAP: <one sentence>`
      }
    ],
    500
  );
  const summary = raw.match(/SUMMARY:\s*([\s\S]*?)\n+OVERLAP:/)?.[1]?.trim();
  const overlap = raw.match(/OVERLAP:\s*([\s\S]*)$/)?.[1]?.trim();
  if (!summary || !overlap) {
    throw new IntegrationError(
      tool,
      'parse_error',
      `Kimi returned text that did not match the SUMMARY:/OVERLAP: contract. First 200 chars: "${raw.slice(0, 200)}". Retry — model output drift.`
    );
  }
  return { summary, roadmapImplication: overlap };
}

export async function rerankPriorArt(args: {
  claimSummary: string;
  candidates: Array<{
    repo: string;
    evidenceSnippet: string;
    firstCommitDate: string;
  }>;
}): Promise<Array<{ repo: string; score: number; reason: string }>> {
  const tool = 'akashml.rerankPriorArt';
  if (args.candidates.length === 0) {
    throw new IntegrationError(
      tool,
      'invalid_input',
      `candidates list is empty — nothing to rerank. Run github_priorArt, tinyfish_githubRepos, or tinyfish_researchPapers first.`
    );
  }

  const raw = await kimiChat(
    tool,
    [
      {
        role: 'system',
        content:
          'You rerank prior-art candidates. Given a claim summary and a list of GitHub repos, score each 0..1 for how strongly it could serve as invalidating prior art, and give a one-sentence reason. Output strict JSON: [{"repo":"...","score":0..1,"reason":"..."}].'
      },
      {
        role: 'user',
        content: `CLAIM SUMMARY:\n${args.claimSummary}\n\nCANDIDATES:\n${args.candidates
          .map(
            (c, i) =>
              `${i + 1}. ${c.repo} (first commit ${c.firstCommitDate}): ${c.evidenceSnippet}`
          )
          .join('\n')}`
      }
    ],
    700
  );
  const jsonStart = raw.indexOf('[');
  const jsonEnd = raw.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd < 0) {
    throw new IntegrationError(
      tool,
      'parse_error',
      `Kimi rerank output contained no JSON array. First 200 chars: "${raw.slice(0, 200)}".`
    );
  }
  try {
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Array<{
      repo: string;
      score: number;
      reason: string;
    }>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new IntegrationError(
      tool,
      'parse_error',
      `Failed to parse Kimi rerank JSON: ${message}. Slice was: "${raw.slice(jsonStart, jsonEnd + 1).slice(0, 200)}".`
    );
  }
}
