import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/26976
test("node:http request.write() preserves explicit Content-Length header", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("node:http");

const BODY = Buffer.alloc(1024 * 64, 0x42);

const server = http.createServer((req, res) => {
  const contentLength = req.headers["content-length"];
  const transferEncoding = req.headers["transfer-encoding"];
  let received = 0;
  req.on("data", (chunk) => { received += chunk.length; });
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      contentLengthHeader: contentLength ?? null,
      transferEncoding: transferEncoding ?? null,
      bytesReceived: received,
    }));
  });
});

server.listen(0, () => {
  const port = server.address().port;
  const req = http.request(
    "http://127.0.0.1:" + port + "/upload",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": BODY.length,
      },
    },
    (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const result = JSON.parse(Buffer.concat(chunks).toString());
        console.log(JSON.stringify(result));
        server.close();
      });
    },
  );

  // Stream the body in multiple chunks via req.write()
  const CHUNK_SIZE = 1024 * 16;
  let offset = 0;
  function writeNext() {
    if (offset >= BODY.length) {
      req.end();
      return;
    }
    const chunk = BODY.subarray(offset, offset + CHUNK_SIZE);
    offset += chunk.length;
    if (!req.write(chunk)) {
      req.once("drain", writeNext);
    } else {
      // Use setImmediate to avoid stack overflow and ensure multiple write() calls
      setImmediate(writeNext);
    }
  }
  writeNext();
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const result = JSON.parse(stdout.trim());

  // The server should receive the explicit Content-Length header
  expect(result.contentLengthHeader).toBe(String(1024 * 64));
  // Transfer-Encoding should NOT be chunked when Content-Length is explicitly set
  expect(result.transferEncoding).toBeNull();
  // All bytes should be received
  expect(result.bytesReceived).toBe(1024 * 64);
});
