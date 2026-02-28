import { expect, test } from "bun:test";
import http from "node:http";
import { text } from "node:stream/consumers";

test("concurrent chunked HTTP responses with delays do not hang", async () => {
  const WORKERS = 20;
  const ITERATIONS = 50;
  const TOTAL = WORKERS * ITERATIONS;
  const CHUNKS = 4;
  const CHUNK_DATA = "x".repeat(8192);
  const EXPECTED_BODY = CHUNK_DATA.repeat(CHUNKS);

  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Transfer-Encoding": "chunked",
    });

    let i = 0;
    function sendChunk() {
      if (i < CHUNKS) {
        res.write(CHUNK_DATA);
        i++;
        if (i < CHUNKS && Math.random() < 0.3) {
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
        expect(body.length).toBe(EXPECTED_BODY.length);
        completed++;
      }
    }

    const workers = Array.from({ length: WORKERS }, () => worker());
    await Promise.all(workers);
    expect(completed).toBe(TOTAL);
  } finally {
    server.close();
  }
}, 30_000);
