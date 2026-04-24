'use client';

import type { Message as AiMessage } from 'ai';
import { RiskReportCard } from './RiskReportCard';
import { RiskReportSchema, type RiskReport } from '@/lib/agent/prompts';

type Props = { message: AiMessage };

export function Message({ message }: Props) {
  const isUser = message.role === 'user';
  const report = !isUser ? extractReport(message.content) : null;
  const textWithoutFence = !isUser
    ? stripJsonFence(message.content)
    : message.content;

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={
          isUser
            ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-pulse-accent/10 px-4 py-2.5 text-sm text-pulse-ink'
            : 'max-w-[92%] space-y-3 rounded-2xl rounded-bl-sm bg-pulse-bg/60 px-4 py-3 text-sm text-pulse-ink'
        }
      >
        {!isUser && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-pulse-muted">
            ip-pulse
          </div>
        )}
        {textWithoutFence && (
          <div className="whitespace-pre-wrap break-words leading-relaxed">
            {textWithoutFence}
          </div>
        )}
        {report && <RiskReportCard report={report} />}
      </div>
    </div>
  );
}

function extractReport(text: string): RiskReport | null {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const parsed = RiskReportSchema.safeParse(JSON.parse(match[1].trim()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function stripJsonFence(text: string): string {
  return text.replace(/```json\s*[\s\S]*?```/i, '').trim();
}
