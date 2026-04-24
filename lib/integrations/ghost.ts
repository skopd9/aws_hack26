import 'server-only';
import { Pool, type PoolConfig } from 'pg';
import { PatentHitSchema, type PatentHit, withFallback } from './_common';

/**
 * Ghost AI DB — https://ghost.build
 *
 * Ghost is a managed Postgres service designed for agents. Each database is
 * reached via a plain `postgresql://ghost:...@<name>.ghost.build/postgres`
 * connection string. We cache patent rows in a `patents` table and use
 * Postgres full-text search (tsvector + GIN) to surface similar filings for
 * repeat queries — which lets us skip expensive live USPTO / Google Patents
 * round-trips on warm cache hits.
 *
 * Setup: see deploy/ghost/README.md. TL;DR:
 *   curl -fsSL https://install.ghost.build | sh
 *   ghost login
 *   ghost create --name ip-pulse --wait
 *   ghost connect ip-pulse           # copy the URL into GHOST_DATABASE_URL
 *   ghost sql ip-pulse < deploy/ghost/schema.sql
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

  // Ghost-hosted databases use managed TLS with an intermediate CA; this is
  // the standard pattern for node-postgres against any hosted Postgres
  // (Neon, Supabase, RDS, Ghost, etc.).
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('.ghost.build')) {
      config.ssl = { rejectUnauthorized: false };
    }
  } catch {
    // If URL parsing fails, let pg surface a clearer error on first query.
  }

  const pool = new Pool(config);
  pool.on('error', (err) => {
    console.warn(`[ghost] idle client error: ${err.message}`);
  });
  return pool;
}

function getPool(): Pool {
  const url = process.env.GHOST_DATABASE_URL;
  if (!url) throw new Error('GHOST_DATABASE_URL missing');
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

export async function upsertPatentEmbedding(patent: PatentHit) {
  return withFallback<{ ok: boolean; id: string }>(
    'ghost.upsert',
    async () => {
      const pool = getPool();
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
    },
    () => ({ ok: true, id: `mock-${patent.patentNo}` })
  );
}

export async function similarPatents(args: { query: string; limit?: number }) {
  const limit = args.limit ?? 5;

  return withFallback<PatentHit[]>(
    'ghost.similarPatents',
    async () => {
      const pool = getPool();
      const res = await pool.query<PatentRow>(SIMILAR_SQL, [args.query, limit]);
      return res.rows.map((r) =>
        PatentHitSchema.parse({
          patentNo: r.patent_no,
          title: r.title ?? '',
          abstract: r.abstract ?? '',
          assignee: r.assignee ?? '',
          priorityDate: r.priority_date ?? '',
          cpcClasses: r.cpc_classes ?? [],
          url:
            r.url ||
            `https://patents.google.com/patent/${r.patent_no}`
        })
      );
    },
    () => []
  );
}
