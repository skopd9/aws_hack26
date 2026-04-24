import 'server-only';
import { PatentHitSchema, type PatentHit, withFallback } from './_common';

export async function latestFilings(args: { since?: string; limit?: number }) {
  const limit = args.limit ?? 20;

  return withFallback<PatentHit[]>(
    'nexla.latestFilings',
    async () => {
      const sinkUrl = process.env.NEXLA_SINK_URL;
      if (!sinkUrl) throw new Error('NEXLA_SINK_URL missing');

      const params = new URLSearchParams();
      if (args.since) params.set('since', args.since);
      params.set('limit', String(limit));

      const res = await fetch(`${sinkUrl}?${params.toString()}`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`Nexla sink ${res.status}`);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      return rows.map((r) =>
        PatentHitSchema.parse({
          patentNo: String(r.patent_no ?? r.patentNo ?? ''),
          title: String(r.title ?? ''),
          abstract: String(r.abstract ?? ''),
          assignee: String(r.assignee ?? ''),
          priorityDate: String(r.priority_date ?? r.priorityDate ?? ''),
          cpcClasses: Array.isArray(r.cpc_classes) ? (r.cpc_classes as string[]) : [],
          url: String(r.url ?? '')
        })
      );
    },
    () => [
      PatentHitSchema.parse({
        patentNo: 'US20260034567A1',
        title: 'Autonomous agent with MCP-compatible tool chain for legal research',
        abstract:
          '[mock Nexla delta] An autonomous agent chains MCP-compatible tools including a patent search, a prior-art repository search, and a litigation-history lookup to produce a structured risk assessment.',
        assignee: 'Bright Path IP Holdings LLC',
        priorityDate: '2026-04-11',
        cpcClasses: ['G06N20/00', 'G06F40/30'],
        url: 'https://patents.google.com/patent/US20260034567A1'
      })
    ]
  );
}
