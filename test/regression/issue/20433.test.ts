import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/20433
// req.rawHeaders on node:http server should preserve canonical header name casing
test("node:http IncomingMessage rawHeaders should have canonical-cased header names", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require("node:http");

      const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(req.rawHeaders));
      });

      server.listen(0, () => {
        const port = server.address().port;
        fetch("http://localhost:" + port + "/", {
          headers: {
            "Accept-Encoding": "gzip, deflate",
            "Accept": "*/*",
            "Connection": "keep-alive",
            "Authorization": "xxx",
            "Origin": "something",
            "Content-Type": "text/plain",
          },
        })
          .then((r) => r.json())
          .then((rawHeaders) => {
            // rawHeaders is [name, value, name, value, ...]
            const headerNames = rawHeaders.filter((_, i) => i % 2 === 0);
            console.log(JSON.stringify(headerNames));
            server.close();
          });
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const headerNames: string[] = JSON.parse(stdout.trim());

  // Known headers should be in canonical Title-Case form
  const expectedCanonical: Record<string, string> = {
    accept: "Accept",
    "accept-encoding": "Accept-Encoding",
    connection: "Connection",
    authorization: "Authorization",
    origin: "Origin",
    "content-type": "Content-Type",
    host: "Host",
    "user-agent": "User-Agent",
  };

  for (const name of headerNames) {
    const lower = name.toLowerCase();
    if (expectedCanonical[lower]) {
      expect(name).toBe(expectedCanonical[lower]);
    }
  }

  // Verify that multi-word headers are present and properly cased
  expect(headerNames).toContain("Accept-Encoding");
  expect(headerNames).toContain("Authorization");
  expect(headerNames).toContain("Content-Type");
  expect(headerNames).toContain("Connection");
  expect(headerNames).toContain("Origin");

  expect(exitCode).toBe(0);
});
