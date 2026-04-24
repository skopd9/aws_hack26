'use client';

import type { RiskReport } from '@/lib/agent/prompts';

const VERDICT_STYLES: Record<
  RiskReport['verdict'],
  { bg: string; label: string; dot: string }
> = {
  clear: {
    bg: 'bg-pulse-ok/10 border-pulse-ok/40',
    dot: 'bg-pulse-ok',
    label: 'CLEAR'
  },
  watch: {
    bg: 'bg-pulse-warn/10 border-pulse-warn/40',
    dot: 'bg-pulse-warn',
    label: 'WATCH'
  },
  high_risk: {
    bg: 'bg-pulse-danger/10 border-pulse-danger/40',
    dot: 'bg-pulse-danger',
    label: 'HIGH RISK'
  },
  critical: {
    bg: 'bg-pulse-danger/20 border-pulse-danger/80',
    dot: 'bg-pulse-danger',
    label: 'CRITICAL'
  }
};

export function RiskReportCard({ report }: { report: RiskReport }) {
  const verdict = VERDICT_STYLES[report.verdict];

  return (
    <div className="overflow-hidden rounded-xl border border-pulse-border bg-pulse-panel">
      <div className={`flex items-center justify-between border-b px-4 py-3 ${verdict.bg}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${verdict.dot}`} />
          <span className="font-mono text-xs font-bold tracking-wider">
            {verdict.label}
          </span>
        </div>
        <span className="font-mono text-xs text-pulse-muted">
          confidence {Math.round(report.confidence * 100)}%
        </span>
      </div>

      <div className="space-y-4 p-4">
        <Section title="Roadmap impact">
          <p className="text-sm leading-relaxed">{report.roadmapImpact}</p>
        </Section>

        {report.matchedPatents.length > 0 && (
          <Section title={`Matched patents (${report.matchedPatents.length})`}>
            <div className="space-y-2">
              {report.matchedPatents.map((p) => (
                <details
                  key={p.patentNo}
                  className="rounded-lg border border-pulse-border bg-pulse-bg/40 p-3"
                >
                  <summary className="cursor-pointer list-none text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://patents.google.com/patent/${p.patentNo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-pulse-accent hover:underline"
                        >
                          {p.patentNo}
                        </a>
                        <span className="font-medium text-pulse-ink">{p.title}</span>
                      </div>
                      <span className="font-mono text-[10px] text-pulse-muted">
                        {p.priorityDate}
                      </span>
                    </div>
                  </summary>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="text-pulse-muted">
                      <span className="font-mono uppercase">Assignee · </span>
                      {p.assignee}
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-pulse-muted">
                        Claim summary (Kimi K2.6)
                      </div>
                      <p className="mt-1 leading-relaxed">{p.claimSummary}</p>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-pulse-muted">
                        Overlap with your stack
                      </div>
                      <p className="mt-1 leading-relaxed">{p.overlapWithUserStack}</p>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </Section>
        )}

        {report.priorArtFindings.length > 0 && (
          <Section title={`Prior art (${report.priorArtFindings.length})`}>
            <div className="space-y-1.5">
              {report.priorArtFindings.map((p) => (
                <div
                  key={p.repo}
                  className="flex items-center justify-between rounded-lg border border-pulse-border bg-pulse-bg/40 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <a
                      href={p.snippetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-pulse-accent hover:underline"
                    >
                      {p.repo}
                    </a>
                    <span className="text-pulse-muted">{p.firstCommitDate}</span>
                  </div>
                  {p.predatesPriorityDate && (
                    <span className="rounded-full bg-pulse-ok/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-pulse-ok">
                      predates priority
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Litigation profile">
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill>
              {report.litigationProfile.assigneeLitigationCount} prior cases
            </Pill>
            {report.litigationProfile.isKnownNPE ? (
              <Pill tone="danger">known NPE — caution</Pill>
            ) : (
              <Pill tone="ok">not flagged as NPE</Pill>
            )}
            {report.litigationProfile.relatedIprOutcomes.slice(0, 3).map((i) => (
              <Pill key={i.petition}>
                {i.petition}: {i.result}
              </Pill>
            ))}
          </div>
        </Section>

        {report.recommendedActions.length > 0 && (
          <Section title="Recommended actions">
            <ul className="space-y-1.5 text-sm">
              {report.recommendedActions.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-pulse-accent">→</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-pulse-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

function Pill({
  children,
  tone = 'neutral'
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'ok' | 'danger';
}) {
  const styles = {
    neutral: 'bg-pulse-bg/60 text-pulse-ink border-pulse-border',
    ok: 'bg-pulse-ok/10 text-pulse-ok border-pulse-ok/40',
    danger: 'bg-pulse-danger/10 text-pulse-danger border-pulse-danger/40'
  }[tone];
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${styles}`}
    >
      {children}
    </span>
  );
}
