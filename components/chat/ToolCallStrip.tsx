'use client';

import { useEffect, useRef, useState } from 'react';

type ToolEvent = {
  id: string;
  tenant: string;
  tool: string;
  outcome: 'ok' | 'mock' | 'error';
  durationMs: number;
  error?: string;
  ts: number;
};

const MAX_EVENTS = 80;

export function ToolCallStrip() {
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource('/api/telemetry/stream');
    source.addEventListener('tool-call', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as ToolEvent;
        setEvents((prev) => [...prev, ev].slice(-MAX_EVENTS));
      } catch {
        /* ignore malformed event */
      }
    });
    source.onerror = () => {
      /* browser will auto-retry */
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [events]);

  return (
    <div
      ref={scrollRef}
      className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-3 py-3"
    >
      {events.length === 0 && (
        <div className="mt-6 text-center font-mono text-xs text-pulse-muted">
          <div className="shimmer mx-auto h-2 w-24 rounded" />
          <div className="mt-3">waiting for tool calls…</div>
        </div>
      )}
      {events.map((ev) => (
        <ToolRow key={ev.id} ev={ev} />
      ))}
    </div>
  );
}

function ToolRow({ ev }: { ev: ToolEvent }) {
  const outcomeStyle =
    ev.outcome === 'ok'
      ? 'text-pulse-ok'
      : ev.outcome === 'mock'
        ? 'text-pulse-warn'
        : 'text-pulse-danger';

  return (
    <div className="flex items-center gap-2 rounded-md border border-pulse-border bg-pulse-bg/40 px-2.5 py-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${outcomeDot(ev.outcome)}`} />
      <span className="flex-1 truncate font-mono text-pulse-ink">{ev.tool}</span>
      <span className={`font-mono uppercase tracking-wider ${outcomeStyle}`}>
        {ev.outcome}
      </span>
      <span className="font-mono text-pulse-muted">{ev.durationMs}ms</span>
    </div>
  );
}

function outcomeDot(o: ToolEvent['outcome']) {
  return o === 'ok'
    ? 'bg-pulse-ok'
    : o === 'mock'
      ? 'bg-pulse-warn'
      : 'bg-pulse-danger';
}
