import 'server-only';
import {
  LitigationProfileSchema,
  type LitigationProfile,
  failFromResponse,
  requireEnv
} from './_common';

type CourtListenerSearchResp = {
  count: number;
  results: Array<{
    caseName: string;
    court: string;
    dateFiled: string;
    docketNumber: string;
    parties?: string[];
  }>;
};

const KNOWN_NPE_KEYWORDS = [
  'LLC',
  'Holdings',
  'Licensing',
  'Ventures',
  'IP Inc',
  'Patents LLC',
  'Technologies LP',
  'Innovations'
];

export async function litigationHistory(
  assignee: string
): Promise<LitigationProfile> {
  const tool = 'pacer.litigationHistory';
  const token = requireEnv(tool, 'COURTLISTENER_TOKEN');

  const params = new URLSearchParams({
    type: 'r',
    q: `"${assignee}"`,
    nature_of_suit: '830',
    page_size: '10'
  });
  const res = await fetch(
    `https://www.courtlistener.com/api/rest/v3/search/?${params.toString()}`,
    { headers: { Authorization: `Token ${token}` } }
  );
  if (!res.ok) await failFromResponse(tool, res, 'CourtListener');
  const data = (await res.json()) as CourtListenerSearchResp;

  const cases = data.results.map((r) => ({
    caseNo: r.docketNumber,
    court: r.court,
    filedDate: r.dateFiled,
    defendants: r.parties?.slice(1) ?? []
  }));

  return LitigationProfileSchema.parse({
    assigneeLitigationCount: data.count,
    isKnownNPE:
      data.count >= 15 || KNOWN_NPE_KEYWORDS.some((k) => assignee.includes(k)),
    recentCases: cases,
    relatedIprOutcomes: []
  });
}
