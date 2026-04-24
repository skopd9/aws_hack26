'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef } from 'react';
import { Message } from './Message';
import { VoiceButton } from './VoiceButton';

const EXAMPLES = [
  "I'm building a RAG pipeline with pgvector and Cohere embeddings. Any patent threats filed in 2025 I should worry about?",
  'Check if patent US12118765B2 could impact a company building an MCP-based agent framework.',
  'My stack is Next.js + OpenAI tool-calling + Supabase pgvector. What was filed this week that targets us?'
];

export function Chat() {
  const { messages, input, handleInputChange, handleSubmit, status, setInput } =
    useChat({ api: '/api/chat' });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [messages, status]);

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <div className="flex flex-1 flex-col">
      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-5 py-6"
      >
        {messages.length === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-pulse-muted">
              Ask about a patent threat. IP-Pulse will search live USPTO + Google
              Patents, read claims, invalidate against OSS prior art, weight by
              litigation history, and return a structured Risk Report.
            </p>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setInput(ex)}
                  className="rounded-lg border border-pulse-border bg-pulse-bg/40 px-3 py-2 text-left text-sm text-pulse-ink transition hover:border-pulse-accent/60 hover:bg-pulse-bg"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-pulse-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-pulse-accent" />
            Claude is orchestrating MCP tools…
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-pulse-border bg-pulse-panel/80 px-5 py-4"
      >
        <div className="flex items-end gap-3 rounded-xl border border-pulse-border bg-pulse-bg/60 px-3 py-2 focus-within:border-pulse-accent/60">
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Describe a threat or ask about a patent…"
            rows={2}
            className="flex-1 resize-none bg-transparent text-sm text-pulse-ink placeholder:text-pulse-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="rounded-lg bg-pulse-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-pulse-bg transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isStreaming ? 'Running' : 'Send'}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-pulse-muted">
            enter to send · shift+enter for newline · tool calls stream to the right pane
          </p>
          <VoiceButton />
        </div>
      </form>
    </div>
  );
}
