import { expect, test } from "bun:test";
import http from "node:http";
import { text } from "node:stream/consumers";

// Regression test for #27557: node:http response streams hanging under
// concurrent requests with delayed chunks. The fix adds backpressure
// handling to consumeStream() — when push() returns false, it pauses
// reading until _read() signals the consumer is ready.
//
// This test exercises the backpressure path by sending responses that
// exceed the 16KB highWaterMark with delays between chunks.
test("concurrent chunked HTTP responses with delays do not hang", async () => {
  const WORKERS = 10;
  const ITERATIONS = 10;
  const TOTAL = WORKERS * ITERATIONS;
  const CHUNK_SIZE = 4096;
  const NUM_CHUNKS = 16; // 64KB total, exceeds 16KB highWaterMark
  const CHUNK_DATA = "x".repeat(CHUNK_SIZE);
  const EXPECTED_LENGTH = CHUNK_SIZE * NUM_CHUNKS;

  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Transfer-Encoding": "chunked",
    });

    // Send chunks with delays to force async delivery and backpressure.
    let i = 0;
    function sendChunk() {
      if (i < NUM_CHUNKS) {
        res.write(CHUNK_DATA);
        i++;
        if (i < NUM_CHUNKS) {
          setTimeout(sendChunk, 1);
        } else {
          sendChunk();
        }
      } else {
        res.end();
      }
    }
    sendChunk();
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    let completed = 0;

    async function worker() {
      for (let i = 0; i < ITERATIONS; i++) {
        const body = await new Promise<string>((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/`, res => {
            text(res).then(resolve, reject);
          });
          req.on("error", reject);
        });
        expect(body.length).toBe(EXPECTED_LENGTH);
        completed++;
      }
    }

    const workers = Array.from({ length: WORKERS }, () => worker());
    await Promise.all(workers);
    expect(completed).toBe(TOTAL);
  } finally {
    server.close();
  }
}, 60_000);
