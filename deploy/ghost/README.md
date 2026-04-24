# Ghost AI DB — setup

[Ghost](https://ghost.build) is an agent-native Postgres service hosted on
Timescale Cloud. Each database is a real Postgres instance reachable at
`postgresql://tsdbadmin:****@<id>.<space>.tsdb.cloud.timescale.com:<port>/tsdb`,
with `pgvectorscale` and `pg_textsearch` preinstalled. IP-Pulse uses one to
cache patent rows and answer `ghost_similarPatents` from that cache before
going out to live USPTO / Google Patents.

## 60-second setup

```bash
# 1. Install the Ghost CLI (macOS / Linux / WSL)
curl -fsSL https://install.ghost.build | sh

# 2. Authenticate (opens a browser, uses GitHub OAuth)
ghost login

# 3. Create our database and wait for it to be ready
ghost create --name ip-pulse --wait

# 4. Get a connection string and drop it into .env
ghost connect ip-pulse
# → postgresql://tsdbadmin:****@<id>.<space>.tsdb.cloud.timescale.com:<port>/tsdb
# Put that value in GHOST_DATABASE_URL in your .env, exactly as printed.
# Do NOT append ?sslmode=require — pg v8.13+ silently treats that as
# verify-full and rejects Ghost's managed CA. The integration enables TLS
# explicitly via { rejectUnauthorized: false } in lib/integrations/ghost.ts.

# 5. Apply the schema
ghost sql ip-pulse < deploy/ghost/schema.sql
# or: npm run ghost:migrate
```

From here the two MCP tools `ghost_cachePatent` and `ghost_similarPatents`
work against real storage. You can watch them with:

```bash
ghost psql ip-pulse
# \d patents
# SELECT patent_no, title, updated_at FROM patents ORDER BY updated_at DESC LIMIT 10;
```

## Optional — register the Ghost MCP server in Cursor

So the agent itself can create forks, inspect schema, and run SQL:

```bash
ghost mcp install cursor
```

## Graceful degradation

If `GHOST_DATABASE_URL` is unset or unreachable, both Ghost MCP tools return
a verbose `__toolError` envelope (cause: `missing_credential`); the agent reads the envelope and falls through to the live USPTO / Google Patents tools rather than failing.
The demo still runs — it just stops short-circuiting repeat queries.

## Upgrade path: hybrid search

When you want real semantic similarity (not just BM25/tsvector):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS vectorscale;

ALTER TABLE patents
  ADD COLUMN embedding vector(1536);

CREATE INDEX patents_embedding_idx
  ON patents
  USING diskann (embedding vector_cosine_ops);
```

Then pick an embedding model (OpenAI `text-embedding-3-small`, Voyage,
or a local one) and `UPDATE patents SET embedding = ...` on upsert. The TS
integration in `lib/integrations/ghost.ts` is structured so `similarPatents`
can be swapped to a hybrid SQL query without touching any caller.
