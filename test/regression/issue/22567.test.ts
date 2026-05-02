import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test that piping HTTP responses through zlib.createGunzip() does not crash.
// Issue #22567: use-after-free when GC collects input/output buffers during
// async WorkPool decompression.
test("pipe HTTP response through createGunzip without crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("node:http");
const zlib = require("node:zlib");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/octet-stream" });
  const gzip = zlib.createGzip();
  gzip.pipe(res);
  for (let i = 0; i < 50; i++) {
    gzip.write("Line " + i + ": " + "x".repeat(80) + "\\n");
  }
  gzip.end();
});

server.listen(0, () => {
  const port = server.address().port;
  let completed = 0;
  const total = 3;

  for (let i = 0; i < total; i++) {
    http.get("http://localhost:" + port + "/", (response) => {
      const gunzip = zlib.createGunzip();
      const stream = response.pipe(gunzip);
      let data = "";
      stream.on("data", (chunk) => { data += chunk.toString(); });
      stream.on("end", () => {
        Bun.gc(true);
        completed++;
        if (completed >= total) {
          console.log("OK");
          server.close(() => process.exit(0));
        }
      });
      stream.on("error", (err) => {
        console.error("error:", err.message);
        process.exit(1);
      });
    }).on("error", (err) => {
      console.error("request error:", err.message);
      process.exit(1);
    });
  }
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.log("stderr:", stderr);
  }
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 15_000);
