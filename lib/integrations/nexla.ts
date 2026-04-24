import 'server-only';
import {
  PatentHitSchema,
  type PatentHit,
  failFromResponse,
  requireEnv
} from './_common';

export async function latestFilings(args: {
  since?: string;
  limit?: number;
}): Promise<PatentHit[]> {
  const tool = 'nexla.latestFilings';
  const limit = args.limit ?? 20;
  const sinkUrl = requireEnv(tool, 'NEXLA_SINK_URL');

  const params = new URLSearchParams();
  if (args.since) params.set('since', args.since);
  params.set('limit', String(limit));

  const res = await fetch(`${sinkUrl}?${params.toString()}`, {
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) await failFromResponse(tool, res, 'Nexla sink');
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
}
