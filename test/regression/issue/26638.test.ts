import { describe, expect, test } from "bun:test";
import { tls } from "harness";
import https from "https";
import { Readable } from "stream";

// Test for GitHub issue #26638
// The async generator body in _http_client.ts can lose chunks when multiple
// write() calls happen between generator iterations. This happens when the
// generator is in its `await` state and a batch of writes arrives: only the
// first write resolves the pending Promise (clearing resolveNextChunk), while
// remaining writes push to kBodyChunks with no notification. Those chunks
// are never yielded.
//
// On localhost, this manifests on the SECOND request (connection reused, no
// TLS handshake delay, generator starts immediately and races with the pipe).
// In production over real networks, it manifests on the FIRST request (TLS
// handshake timing creates the same interleaving window).
describe("issue #26638", () => {
  test("piped stream chunks are not lost on reused HTTPS connection", async () => {
    using server = Bun.serve({
      port: 0,
      tls,
      async fetch(req) {
        const body = await req.arrayBuffer();
        return Response.json({ bytesReceived: body.byteLength });
      },
    });

    const CHUNK_SIZE = 1024;
    const TOTAL_CHUNKS = 200;
    const BATCH_SIZE = 50;
    const EXPECTED_BYTES = CHUNK_SIZE * TOTAL_CHUNKS;

    async function pipeChunksToRequest(): Promise<{ bytesReceived: number }> {
      return new Promise((resolve, reject) => {
        const req = https.request(
          `https://localhost:${server.port}/`,
          { method: "POST", rejectUnauthorized: false },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                reject(new Error(`Failed to parse response: ${data}`));
              }
            });
          },
        );

        req.on("error", reject);

        // Pipe from a Readable that delivers chunks in batches across
        // event loop ticks. Each batch writes multiple chunks synchronously,
        // but the batches are separated by setImmediate to allow the async
        // generator to process between them. When a batch arrives while the
        // generator is in its `await`, only the first chunk triggers
        // resolveNextChunk -- the rest are silently buffered and lost
        // without the fix.
        let pushed = 0;
        const readable = new Readable({
          read() {
            if (pushed >= TOTAL_CHUNKS) return;
            setImmediate(() => {
              const batch = Math.min(BATCH_SIZE, TOTAL_CHUNKS - pushed);
              for (let i = 0; i < batch; i++) {
                this.push(Buffer.alloc(CHUNK_SIZE, 0x41));
                pushed++;
              }
              if (pushed >= TOTAL_CHUNKS) {
                this.push(null);
              }
            });
          },
        });

        readable.pipe(req);
      });
    }

    // First request: establishes TLS connection (handshake delays generator
    // start, all chunks queue before generator runs → passes even without fix)
    const first = await pipeChunksToRequest();
    expect(first.bytesReceived).toBe(EXPECTED_BYTES);

    // Second request: reuses the keep-alive connection (no TLS handshake,
    // generator starts immediately → races with piped data → triggers the
    // chunk-loss bug without the fix)
    const second = await pipeChunksToRequest();
    expect(second.bytesReceived).toBe(EXPECTED_BYTES);
  });
});
