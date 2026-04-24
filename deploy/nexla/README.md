# Nexla flow — USPTO daily-bulk-feed ingestion

## Intent

Nexla ingests the USPTO daily XML bulk feed, normalizes it, and lands rows into a sink (Postgres or S3) that IP-Pulse reads through `.wundergraph/operations/nexla.latestFilings.ts`.

This is the "wake up and see everything filed yesterday" data path. The on-demand web / Slack / Vapi queries use live USPTO + Google Patents APIs; Nexla is for batch + historical.

## Flow to configure in the Nexla UI

**Source**
- Type: HTTP → XML
- URL template (weekly):
  `https://bulkdata.uspto.gov/data/patent/application/redbook/fulltext/{YYYY}/ipa{YYMMDD}.zip`
- Schedule: daily 08:00 UTC (USPTO typically publishes overnight)

**Transform**
- Unzip → XPath extract from each `<us-patent-application>`:
  - `patentNo` ← `publication-reference/document-id/doc-number`
  - `title` ← `invention-title`
  - `abstract` ← `abstract/p`
  - `assignee` ← `us-applicants/us-applicant/addressbook/orgname`
  - `priorityDate` ← `priority-claims/priority-claim[@sequence="1"]/date`
  - `cpcClasses` ← `classifications-cpc/main-cpc/classification-cpc/ipc-class-symbol` (array)
- Drop any record missing `patentNo` or `title`.

**Sink**
- Type: Postgres (recommended) or S3 JSON
- Postgres schema:
  ```sql
  create table uspto_filings (
    patent_no    text primary key,
    title        text not null,
    abstract     text,
    assignee     text,
    priority_date date,
    cpc_classes  text[],
    ingested_at  timestamptz default now()
  );
  ```
- Expose a read-only HTTPS endpoint or use a direct DB URL. Put that URL in `NEXLA_SINK_URL`.

## Wire-up check

With `NEXLA_SINK_URL` set, calling `/operations/nexla.latestFilings` (or invoking the `nexla_latestFilings` MCP tool) should return real rows. Without it, `MOCK_FALLBACK=true` returns a typed mock — the demo still works.
