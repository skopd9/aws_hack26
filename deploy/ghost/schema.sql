-- Ghost AI DB schema for IP-Pulse.
-- Run against a Ghost-provisioned database:
--   ghost sql ip-pulse < deploy/ghost/schema.sql
--
-- Cached patent corpus. We use built-in tsvector full-text search rather than
-- pgvector so this works without an embedding model in the loop. Every Ghost
-- database also ships with pgvectorscale + pg_textsearch preinstalled, so
-- upgrading to hybrid BM25 + semantic search later is a schema-only change.

CREATE TABLE IF NOT EXISTS patents (
  patent_no      text PRIMARY KEY,
  title          text NOT NULL,
  abstract       text NOT NULL DEFAULT '',
  assignee       text NOT NULL DEFAULT '',
  priority_date  text NOT NULL DEFAULT '',
  cpc_classes    text[] NOT NULL DEFAULT '{}',
  url            text NOT NULL DEFAULT '',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  search_tsv     tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')),    'A') ||
    setweight(to_tsvector('english', coalesce(abstract, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(assignee, '')), 'C')
  ) STORED
);

CREATE INDEX IF NOT EXISTS patents_search_tsv_idx
  ON patents USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS patents_assignee_idx
  ON patents (assignee);

CREATE INDEX IF NOT EXISTS patents_priority_date_idx
  ON patents (priority_date);
