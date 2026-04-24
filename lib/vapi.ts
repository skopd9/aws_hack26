import 'server-only';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { RiskReport } from './agent/prompts';

const VapiMessageSchema = z.object({
  type: z.enum([
    'function-call',
    'tool-calls',
    'status-update',
    'end-of-call-report',
    'hang',
    'speech-update',
    'transcript',
    'user-interrupted'
  ]),
  call: z
    .object({
      id: z.string().optional(),
      assistantId: z.string().optional(),
      customer: z.object({ number: z.string().optional() }).partial().optional()
    })
    .partial()
    .optional(),
  functionCall: z
    .object({
      name: z.string(),
      parameters: z.record(z.unknown()).optional()
    })
    .partial()
    .optional(),
  toolCallList: z
    .array(
      z.object({
        id: z.string(),
        function: z.object({
          name: z.string(),
          arguments: z.union([z.string(), z.record(z.unknown())])
        })
      })
    )
    .optional(),
  transcript: z.string().optional(),
  artifact: z.record(z.unknown()).optional()
});

export const VapiWebhookSchema = z.object({
  message: VapiMessageSchema
});

export type VapiWebhookPayload = z.infer<typeof VapiWebhookSchema>;

export function verifyVapiSignature(req: Request, rawBody: string): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) return process.env.MOCK_FALLBACK === 'true';

  const signatureHeader =
    req.headers.get('x-vapi-signature') ?? req.headers.get('x-vapi-secret') ?? '';
  if (!signatureHeader) return false;

  if (signatureHeader === secret) return true;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

export function toVoiceFriendly(report: RiskReport): string {
  const verdictLine: Record<RiskReport['verdict'], string> = {
    clear: 'Good news. No meaningful patent threats to your stack.',
    watch: 'Some filings worth watching, but no immediate risk.',
    high_risk: 'Heads up — this is a high risk situation.',
    critical: 'Critical alert. Pause the affected roadmap items.'
  };

  const parts: string[] = [verdictLine[report.verdict]];

  if (report.matchedPatents.length) {
    const top = report.matchedPatents[0];
    parts.push(
      `Top match is ${top.patentNo}, titled ${top.title}, assigned to ${top.assignee}.`
    );
    parts.push(`${top.overlapWithUserStack}`);
  }

  const invalidating = report.priorArtFindings.filter(
    (p) => p.predatesPriorityDate
  );
  if (invalidating.length) {
    parts.push(
      `Prior art exists that predates the priority date — check ${invalidating[0].repo}.`
    );
  }

  if (report.litigationProfile.isKnownNPE) {
    parts.push(
      `The holder is a known non-practicing entity with ${report.litigationProfile.assigneeLitigationCount} prior cases. Treat with caution.`
    );
  }

  if (report.recommendedActions.length) {
    parts.push(`Recommended next step: ${report.recommendedActions[0]}`);
  }

  return parts.join(' ');
}
