import 'server-only';
import { failFromResponse } from './_common';

// USPTO Open Data Portal — Patent File Wrapper API
// Swagger: https://data.uspto.gov/swagger/index.html
const ODP_BASE = process.env.USPTO_ODP_BASE ?? 'https://api.uspto.gov/api/v1/patent';

function odp_key(): string | undefined {
  return process.env.USPTO_ODP_API_KEY ?? process.env.USPTO_API_KEY;
}

function odp_headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const k = odp_key();
  if (k) h['X-Api-Key'] = k;
  return h;
}

export type FileWrapperBiblio = {
  applicationNo: string;
  inventionTitle: string;
  filingDate: string;
  publicationDate: string | null;
  patentNumber: string | null;
  grantDate: string | null;
  statusDescription: string;
  assignee: string;
  applicantCountry: string;
  cpcClasses: string[];
  url: string;
};

export type FileWrapperTransaction = {
  date: string;
  code: string;
  description: string;
};

export type FileWrapperDocument = {
  documentCode: string;
  documentDescription: string;
  mailDate: string | null;
  downloadUrl: string | null;
};

export type FileWrapperDetail = FileWrapperBiblio & {
  transactions: FileWrapperTransaction[];
  documents: FileWrapperDocument[];
  parentApplications: string[];
  childApplications: string[];
};

type OdpSearchResponse = {
  results?: OdpBiblioResult[];
  hits?: { hits?: Array<{ _source?: OdpBiblioResult }> };
  total?: number;
};

type OdpBiblioResult = {
  applicationNumberText?: string;
  inventionTitle?: string;
  filingDate?: string;
  publicationDate?: string;
  patentNumber?: string;
  grantDate?: string;
  applicationStatusDescriptionText?: string;
  assigneeEntityName?: string;
  applicantCountryName?: string;
  cpcClassificationText?: string | string[];
};

type OdpAppDataResponse = {
  applicationData?: OdpBiblioResult;
  transactions?: Array<{
    recordedDate?: string;
    transactionCode?: string;
    transactionDescription?: string;
  }>;
  documentBag?: Array<{
    documentCode?: string;
    documentCodeDescriptionText?: string;
    mailDate?: string;
    downloadOptionBag?: Array<{ downloadUrl?: string }>;
  }>;
  parentContinuityBag?: Array<{ parentApplicationNumber?: string }>;
  childContinuityBag?: Array<{ childApplicationNumber?: string }>;
};

function normaliseBiblio(r: OdpBiblioResult): FileWrapperBiblio {
  const appNo = r.applicationNumberText ?? '';
  const cpc = Array.isArray(r.cpcClassificationText)
    ? r.cpcClassificationText
    : r.cpcClassificationText
      ? [r.cpcClassificationText]
      : [];
  return {
    applicationNo: appNo,
    inventionTitle: r.inventionTitle ?? '',
    filingDate: r.filingDate ?? '',
    publicationDate: r.publicationDate ?? null,
    patentNumber: r.patentNumber ?? null,
    grantDate: r.grantDate ?? null,
    statusDescription: r.applicationStatusDescriptionText ?? '',
    assignee: r.assigneeEntityName ?? '',
    applicantCountry: r.applicantCountryName ?? 'US',
    cpcClasses: cpc,
    url: appNo
      ? `https://data.uspto.gov/patent-file-wrapper/applications/${appNo}`
      : ''
  };
}

export async function searchFileWrapper(args: {
  query: string;
  dateFrom?: string;
  dateTo?: string;
  status?: 'Patented' | 'Pending' | 'Abandoned' | 'Published';
  limit?: number;
}): Promise<FileWrapperBiblio[]> {
  const tool = 'uspto.fileWrapper.search';
  const limit = args.limit ?? 10;

  const body: Record<string, unknown> = {
    q: args.query,
    pagination: { offset: 0, limit },
    sort: [{ field: 'filingDate', order: 'Desc' }]
  };

  const filters: Array<{ name: string; value: string[] }> = [];
  if (args.status) {
    filters.push({
      name: 'applicationStatusDescriptionText',
      value: [args.status]
    });
  }
  if (filters.length) body.filters = filters;

  const rangeFilters: Array<{
    field: string;
    valueFrom?: string;
    valueTo?: string;
  }> = [];
  if (args.dateFrom || args.dateTo) {
    const rf: { field: string; valueFrom?: string; valueTo?: string } = {
      field: 'filingDate'
    };
    if (args.dateFrom) rf.valueFrom = args.dateFrom;
    if (args.dateTo) rf.valueTo = args.dateTo;
    rangeFilters.push(rf);
  }
  if (rangeFilters.length) body.rangeFilters = rangeFilters;

  const res = await fetch(`${ODP_BASE}/applications/search`, {
    method: 'POST',
    headers: odp_headers(),
    body: JSON.stringify(body)
  });
  if (!res.ok) await failFromResponse(tool, res, 'USPTO ODP search');

  const json = (await res.json()) as OdpSearchResponse;
  const raw: OdpBiblioResult[] =
    json.results ??
    ((json.hits?.hits ?? []).map((h) => h._source).filter(Boolean) as OdpBiblioResult[]);

  return raw.map(normaliseBiblio);
}

export async function getFileWrapperDetail(
  applicationNo: string
): Promise<FileWrapperDetail> {
  const tool = 'uspto.fileWrapper.detail';
  const res = await fetch(`${ODP_BASE}/applications/${applicationNo}`, {
    method: 'GET',
    headers: odp_headers()
  });
  if (!res.ok) await failFromResponse(tool, res, 'USPTO ODP app data');

  const json = (await res.json()) as OdpAppDataResponse;
  const bib = normaliseBiblio(json.applicationData ?? {});

  const transactions: FileWrapperTransaction[] = (json.transactions ?? []).map(
    (t) => ({
      date: t.recordedDate ?? '',
      code: t.transactionCode ?? '',
      description: t.transactionDescription ?? ''
    })
  );

  const documents: FileWrapperDocument[] = (json.documentBag ?? []).map((d) => ({
    documentCode: d.documentCode ?? '',
    documentDescription: d.documentCodeDescriptionText ?? '',
    mailDate: d.mailDate ?? null,
    downloadUrl: d.downloadOptionBag?.[0]?.downloadUrl ?? null
  }));

  const parentApplications = (json.parentContinuityBag ?? [])
    .map((p) => p.parentApplicationNumber ?? '')
    .filter(Boolean);

  const childApplications = (json.childContinuityBag ?? [])
    .map((c) => c.childApplicationNumber ?? '')
    .filter(Boolean);

  return {
    ...bib,
    applicationNo: bib.applicationNo || applicationNo,
    transactions,
    documents,
    parentApplications,
    childApplications
  };
}
