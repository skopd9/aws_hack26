import 'server-only';
import { withFallback } from './_common';

type ChatCompletionResp = {
  choices: Array<{ message: { content: string } }>;
};

async function kimiChat(messages: Array<{ role: string; content: string }>, maxTokens = 600) {
  const key = process.env.AKASHML_API_KEY;
  const base = process.env.AKASHML_BASE_URL ?? 'https://api.akashml.com/v1';
  const model = process.env.AKASHML_MODEL ?? 'kimi-k2.6';
  if (!key) throw new Error('AKASHML_API_KEY missing');

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
  if (!res.ok) throw new Error(`Akash ML ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as ChatCompletionResp;
  return data.choices[0]?.message?.content ?? '';
}

export async function summarizeClaim(args: {
  patentNo: string;
  claimText: string;
  userStack: string;
}) {
  return withFallback<{ summary: string; roadmapImplication: string }>(
    'akashml.summarizeClaim',
    async () => {
      const raw = await kimiChat(
        [
          {
            role: 'system',
            content:
              'You are a patent-claim interpreter for software engineers. Given a claim text and the engineer\'s stack description, produce: (1) a one-paragraph plain-English summary of what the claim covers, then (2) a one-sentence assessment of whether it overlaps with the described stack. Be direct.'
          },
          {
            role: 'user',
            content: `PATENT: ${args.patentNo}\n\nCLAIM:\n${args.claimText}\n\nENGINEER'S STACK:\n${args.userStack}\n\nReturn exactly:\nSUMMARY: <paragraph>\nOVERLAP: <one sentence>`
          }
        ],
        500
      );
      const summary = raw.match(/SUMMARY:\s*([\s\S]*?)\n+OVERLAP:/)?.[1]?.trim() ?? raw;
      const overlap = raw.match(/OVERLAP:\s*([\s\S]*)$/)?.[1]?.trim() ?? '';
      return { summary, roadmapImplication: overlap };
    },
    () => ({
      summary: `[mock Kimi] The ${args.patentNo} claim describes an agentic system that routes LLM tool calls through a central gateway and returns structured risk outputs. Dense legalese, but core idea is: orchestrator + tool gateway + structured output.`,
      roadmapImplication: `[mock] Overlaps with any system that uses an MCP-style tool gateway fronting an LLM — likely relevant.`
    })
  );
}

export async function rerankPriorArt(args: {
  claimSummary: string;
  candidates: Array<{ repo: string; evidenceSnippet: string; firstCommitDate: string }>;
}) {
  return withFallback<Array<{ repo: string; score: number; reason: string }>>(
    'akashml.rerankPriorArt',
    async () => {
      const raw = await kimiChat(
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
      if (jsonStart < 0 || jsonEnd < 0) throw new Error('no JSON in rerank output');
      return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    },
    () =>
      args.candidates.map((c, i) => ({
        repo: c.repo,
        score: Math.max(0, 0.9 - i * 0.15),
        reason: `[mock rerank] Contains primitives overlapping with the claim summary.`
      }))
  );
}
