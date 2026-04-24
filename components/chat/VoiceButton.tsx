'use client';

import { useEffect, useRef, useState } from 'react';
import type Vapi from '@vapi-ai/web';

type CallState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

type Transcript = { role: 'user' | 'assistant'; text: string };

// Inline assistant config — per Vapi Web SDK quickstart
// (https://docs.vapi.ai/quickstart/web -> "Passing Assistant Configuration Inline").
// No persistent assistant needs to exist on the dashboard; this is an
// ephemeral assistant scoped to the current call.
const ASSISTANT_CONFIG = {
  name: 'IP-Pulse Voice',
  firstMessage:
    "I'm IP-Pulse. Tell me about a patent threat you're worried about, or describe your stack and I'll scan the latest filings.",
  transcriber: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en-US'
  },
  voice: {
    provider: 'playht',
    voiceId: 'jennifer'
  },
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are IP-Pulse, a real-time patent-intelligence agent for software engineers.
You speak briefly and conversationally because this is a voice call.
When the user describes their stack, capture it and acknowledge.
When they ask about a specific patent or threat, give a one-paragraph
answer covering: (1) what you would search, (2) which signals matter
(prior art, NPE history, IPR survival), and (3) one concrete next step.
Keep replies under 30 seconds of speech. Avoid legalese.`
      }
    ]
  }
};

export function VoiceButton() {
  const [state, setState] = useState<CallState>('idle');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<Vapi | null>(null);

  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const disabled = !publicKey;

  useEffect(() => {
    return () => {
      vapiRef.current?.stop();
    };
  }, []);

  async function start() {
    if (!publicKey) return;
    setState('connecting');
    setError(null);
    setTranscripts([]);

    try {
      const VapiCtor = (await import('@vapi-ai/web')).default;
      const vapi = new VapiCtor(publicKey);
      vapiRef.current = vapi;

      vapi.on('call-start', () => setState('listening'));
      vapi.on('call-end', () => setState('idle'));
      vapi.on('speech-start', () => setState('speaking'));
      vapi.on('speech-end', () => setState('listening'));
      vapi.on('error', (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[vapi]', e);
        setError(msg);
        setState('error');
      });
      vapi.on('message', (m: { type: string; role?: string; transcript?: string; transcriptType?: string }) => {
        if (m.type === 'transcript' && m.transcript && m.transcriptType === 'final') {
          setTranscripts((prev) => [
            ...prev,
            {
              role: m.role === 'user' ? 'user' : 'assistant',
              text: m.transcript ?? ''
            }
          ]);
        }
      });

      // The Vapi SDK's `CreateAssistantDTO` is a deeply-discriminated union
      // (one variant per provider), and structural inference widens our
      // string literals (`'deepgram'`, `'openai'`, `'system'`, …) to plain
      // `string`. Runtime is correct — assert past the discriminator here.
      await vapi.start(ASSISTANT_CONFIG as Parameters<typeof vapi.start>[0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[vapi] start failed', e);
      setError(msg);
      setState('error');
    }
  }

  function stop() {
    vapiRef.current?.stop();
    setState('idle');
  }

  const isLive = state === 'listening' || state === 'speaking';

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={isLive ? stop : start}
        disabled={disabled || state === 'connecting'}
        title={
          disabled
            ? 'Set NEXT_PUBLIC_VAPI_PUBLIC_KEY in .env to enable voice'
            : isLive
              ? 'End voice call'
              : 'Talk to IP-Pulse'
        }
        className="flex items-center gap-2 rounded-lg border border-pulse-border bg-pulse-bg/40 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-pulse-ink transition hover:border-pulse-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            state === 'listening'
              ? 'bg-pulse-ok animate-pulse'
              : state === 'speaking'
                ? 'bg-pulse-accent animate-pulse'
                : state === 'connecting'
                  ? 'bg-pulse-warn animate-pulse'
                  : state === 'error'
                    ? 'bg-pulse-danger'
                    : 'bg-pulse-muted'
          }`}
        />
        {state === 'idle' && 'Voice'}
        {state === 'connecting' && 'Connecting…'}
        {state === 'listening' && 'Listening'}
        {state === 'speaking' && 'Speaking'}
        {state === 'error' && 'Voice error'}
      </button>

      {error && (
        <span className="font-mono text-[10px] text-pulse-danger">{error}</span>
      )}

      {transcripts.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-pulse-border bg-pulse-bg/30 p-2 text-xs">
          {transcripts.map((t, i) => (
            <div
              key={i}
              className={`mb-1 ${
                t.role === 'user' ? 'text-pulse-ink' : 'text-pulse-accent'
              }`}
            >
              <span className="font-mono text-[10px] uppercase opacity-60">
                {t.role}:
              </span>{' '}
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
