import { Chat } from '@/components/chat/Chat';
import { ToolCallStrip } from '@/components/chat/ToolCallStrip';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-pulse-accent opacity-60 pulse-dot" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pulse-accent" />
          </span>
          <h1 className="font-mono text-sm tracking-wider text-pulse-accent">
            IP-PULSE · LIVE
          </h1>
        </div>
        <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-pulse-ink md:text-4xl">
          Real-time agentic patent intelligence for software engineers.
        </h2>
        <p className="max-w-3xl text-pulse-muted">
          Traditional IP defense is reactive: slow human attorneys or static search tools
          that go stale the moment you run them. IP-Pulse closes the{' '}
          <span className="text-pulse-ink">Latency Gap</span> and the{' '}
          <span className="text-pulse-ink">Interpretation Gap</span> — Claude orchestrates
          MCP tools over a WunderGraph Cosmo federated graph (5 subgraphs, one router) to
          search USPTO + Google Patents, invalidate with GitHub prior-art, weight with PTAB
          history, summarize 500-page filings via Kimi K2.6 on Akash GPUs, and ground with
          live TinyFish product crawls — streaming a structured Risk Report before your
          coffee cools.
        </p>
      </header>

      <section className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="glow flex min-h-[560px] flex-col rounded-2xl bg-pulse-panel">
          <div className="flex items-center justify-between border-b border-pulse-border px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-pulse-ok" />
              <h3 className="font-mono text-xs uppercase tracking-wider text-pulse-muted">
                Chat · Claude + Kimi K2.6 via Cosmo Router (MCP)
              </h3>
            </div>
            <span className="font-mono text-xs text-pulse-muted">
              web · slack · voice
            </span>
          </div>
          <Chat />
        </div>

        <aside className="glow flex min-h-[560px] flex-col rounded-2xl bg-pulse-panel">
          <div className="border-b border-pulse-border px-5 py-3">
            <h3 className="font-mono text-xs uppercase tracking-wider text-pulse-muted">
              Live MCP tool-call trace
            </h3>
            <p className="mt-1 text-xs text-pulse-muted">
              Every tool Claude invokes, streamed from Redis.
            </p>
          </div>
          <ToolCallStrip />
        </aside>
      </section>

      <footer className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-pulse-muted">
        <span className="font-mono">Stack:</span>
        <span>Next.js 14</span>
        <span>·</span>
        <span>Vercel AI SDK</span>
        <span>·</span>
        <span>Anthropic Claude</span>
        <span>·</span>
        <span>Kimi K2.6 on Akash ML</span>
        <span>·</span>
        <span>WunderGraph Cosmo</span>
        <span>·</span>
        <span>Redis</span>
        <span>·</span>
        <span>Ghost AI DB</span>
        <span>·</span>
        <span>TinyFish</span>
        <span>·</span>
        <span>Chainguard</span>
      </footer>
    </main>
  );
}
