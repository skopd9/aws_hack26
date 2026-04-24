import 'server-only';

export type WundergraphClient = {
  baseUrl: string;
  fetchOperation: <T>(name: string, input: unknown) => Promise<T>;
};

export function getWundergraphClient(): WundergraphClient {
  const baseUrl = process.env.WUNDERGRAPH_URL ?? 'http://localhost:9991';

  return {
    baseUrl,
    async fetchOperation<T>(name: string, input: unknown): Promise<T> {
      const res = await fetch(`${baseUrl}/operations/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input })
      });
      if (!res.ok) {
        throw new Error(`WG ${name} ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as { data: T };
      return json.data;
    }
  };
}
