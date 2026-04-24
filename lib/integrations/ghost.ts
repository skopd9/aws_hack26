import 'server-only';
import { Pool, type PoolConfig } from 'pg';
import {
  PatentHitSchema,
  type PatentHit,
  IntegrationError,
  requireEnv
} from './_common';

/**
 * Ghost AI DB — https://ghost.build
 *
 * Ghost is a managed Postgres service designed for agents, hosted on
 * Timescale Cloud. Each database is reached via a connection string of the
 * form `postgresql://tsdbadmin:...@<id>.<space>.tsdb.cloud.timescale.com:<port>/tsdb`
 * (TLS required, managed CA chain). We cache patent rows in a `patents`
 * table and use Postgres full-text search (tsvector + GIN) to surface
 * similar filings for repeat queries — which lets us skip expensive live
 * USPTO / Google Patents round-trips on warm cache hits.
 *
 * Setup: see deploy/ghost/README.md.
 */

declare global {
  // Reuse the pool across Next.js HMR reloads in dev.
  // eslint-disable-next-line no-var
  var __ippulse_ghost_pool: Pool | undefined;
}

function createPool(url: string): Pool {
  const config: PoolConfig = {
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  };

  // Ghost runs on Timescale Cloud, so connection strings target
  // *.tsdb.cloud.timescale.com with managed TLS. Enable SSL for any
  // non-loopback host — same pattern node-postgres needs against Neon,
  // Supabase, RDS, Ghost, etc. — and trust the managed CA chain.
  try {
    const host = new URL(url).hostname;
    const isLoopback =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local');
    if (!isLoopback) {
      config.ssl = { rejectUnauthorized: false };
    }
  } catch {
    /* let pg surface the URL parse error on first query */
  }

  const pool = new Pool(config);
  pool.on('error', (err) => {
    console.warn(`[ghost] idle client error: ${err.message}`);
  });
  return pool;
}

function getPool(tool: string): Pool {
  const url = requireEnv(tool, 'GHOST_DATABASE_URL');
  if (!global.__ippulse_ghost_pool) {
    global.__ippulse_ghost_pool = createPool(url);
  }
  return global.__ippulse_ghost_pool;
}

const UPSERT_SQL = `
  INSERT INTO patents (
    patent_no, title, abstract, assignee, priority_date, cpc_classes, url
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (patent_no) DO UPDATE SET
    title         = EXCLUDED.title,
    abstract      = EXCLUDED.abstract,
    assignee      = EXCLUDED.assignee,
    priority_date = EXCLUDED.priority_date,
    cpc_classes   = EXCLUDED.cpc_classes,
    url           = EXCLUDED.url,
    updated_at    = now()
  RETURNING patent_no;
`;

const SIMILAR_SQL = `
  SELECT
    patent_no,
    title,
    abstract,
    assignee,
    priority_date,
    cpc_classes,
    url,
    ts_rank(search_tsv, websearch_to_tsquery('english', $1)) AS rank
  FROM patents
  WHERE search_tsv @@ websearch_to_tsquery('english', $1)
  ORDER BY rank DESC
  LIMIT $2;
`;

type PatentRow = {
  patent_no: string;
  title: string;
  abstract: string;
  assignee: string;
  priority_date: string | null;
  cpc_classes: string[] | null;
  url: string;
};

export async function upsertPatentEmbedding(
  patent: PatentHit
): Promise<{ ok: boolean; id: string }> {
  const tool = 'ghost.upsert';
  const pool = getPool(tool);

  try {
    const res = await pool.query<{ patent_no: string }>(UPSERT_SQL, [
      patent.patentNo,
      patent.title,
      patent.abstract,
      patent.assignee,
      patent.priorityDate,
      patent.cpcClasses,
      patent.url
    ]);
    return { ok: true, id: res.rows[0]?.patent_no ?? patent.patentNo };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new IntegrationError(
      tool,
      'upstream_error',
      `Ghost upsert for ${patent.patentNo} failed: ${message}. Verify schema (deploy/ghost/schema.sql) and that GHOST_DATABASE_URL is reachable.`
    );
  }
}

export async function similarPatents(args: {
  query: string;
  limit?: number;
}): Promise<PatentHit[]> {
  const tool = 'ghost.similarPatents';
  const limit = args.limit ?? 5;
  const pool = getPool(tool);

  try {
    const res = await pool.query<PatentRow>(SIMILAR_SQL, [args.query, limit]);
    // Empty cache is a valid result, NOT an error — the agent should fall
    // through to the live search tools (uspto_search, googlePatents_search).
    return res.rows.map((r) =>
      PatentHitSchema.parse({
        patentNo: r.patent_no,
        title: r.title ?? '',
        abstract: r.abstract ?? '',
        assignee: r.assignee ?? '',
        priorityDate: r.priority_date ?? '',
        cpcClasses: r.cpc_classes ?? [],
        url: r.url || `https://patents.google.com/patent/${r.patent_no}`
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new IntegrationError(
      tool,
      'upstream_error',
      `Ghost similarity search failed: ${message}. The cache is unavailable; fall through to uspto_search / googlePatents_search.`
    );
  }
}
