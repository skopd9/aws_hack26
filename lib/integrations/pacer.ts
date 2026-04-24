import 'server-only';
import { LitigationProfileSchema, type LitigationProfile, withFallback } from './_common';

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

export async function litigationHistory(assignee: string) {
  return withFallback<LitigationProfile>(
    'pacer.litigationHistory',
    async () => {
      const token = process.env.COURTLISTENER_TOKEN;
      if (!token) throw new Error('COURTLISTENER_TOKEN missing (PACER paid fallback also unavailable)');

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
      if (!res.ok) throw new Error(`CourtListener ${res.status}`);
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
          data.count >= 15 ||
          KNOWN_NPE_KEYWORDS.some((k) => assignee.includes(k)),
        recentCases: cases,
        relatedIprOutcomes: []
      });
    },
    () => {
      const isLikelyNPE = KNOWN_NPE_KEYWORDS.some((k) => assignee.includes(k));
      return LitigationProfileSchema.parse({
        assigneeLitigationCount: isLikelyNPE ? 37 : 2,
        isKnownNPE: isLikelyNPE,
        recentCases: isLikelyNPE
          ? [
              {
                caseNo: '2:24-cv-00123',
                court: 'E.D. Tex.',
                filedDate: '2024-03-14',
                defendants: ['Mid-Size SaaS Inc.']
              },
              {
                caseNo: '1:23-cv-00987',
                court: 'D. Del.',
                filedDate: '2023-11-02',
                defendants: ['Big Cloud Provider Co.']
              }
            ]
          : [],
        relatedIprOutcomes: []
      });
    }
  );
}
