import {
  readRecentToolCalls,
  readToolCallsFrom
} from '@/lib/redis/streams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      let lastId = '$';
      try {
        const backfill = await readRecentToolCalls(20);
        for (const { id, event } of backfill) {
          lastId = id;
          const payload = JSON.stringify({ id, ...event });
          controller.enqueue(
            encoder.encode(`event: tool-call\ndata: ${payload}\n\n`)
          );
        }
      } catch (err) {
        console.warn('[telemetry] backfill failed:', err);
      }

      try {
        for await (const { id, event } of readToolCallsFrom(lastId, 5000)) {
          const payload = JSON.stringify({ id, ...event });
          controller.enqueue(
            encoder.encode(`event: tool-call\ndata: ${payload}\n\n`)
          );
        }
      } catch (err) {
        console.warn('[telemetry] stream error:', err);
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
