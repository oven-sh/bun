import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// End-to-end regression: spawning a child that opens an HTTP server,
// accepts a keep-alive connection, and calls
//   server.close();
//   server.closeAllConnections();
//   server.unref();
// must exit immediately — not wait for the keep-alive idle timeout to
// reclaim the in-flight socket. This is the @azure/msal-node hang.
// Issue: https://github.com/oven-sh/bun/issues/30501
//
// This is in a standalone file because it spawns a bun subprocess and so
// cannot run under Node.js the way `node-http.test.ts` requires.
test("process exits after close() + closeAllConnections() + unref() teardown", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const http = require("node:http");
        const net = require("node:net");
        const server = http.createServer((req, _res) => {
          // Never reply — keep the socket in-flight (not idle) so that
          // only closeAllConnections() (abrupt) can reclaim it.
          server.close();
          server.closeAllConnections();
          server.unref();
          process.stdout.write("TEARDOWN_DONE\\n");
        });
        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          const sock = net.connect(port, "127.0.0.1", () => {
            sock.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: keep-alive\\r\\n\\r\\n");
          });
          sock.on("data", () => {});
          sock.on("error", () => {});
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  // If the teardown path is broken, the subprocess never exits and
  // `proc.exited` never resolves — the bun:test runner's default 5s
  // timeout catches that.
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  // Surface any uncaught exception / ASAN trace before the exit-code
  // assertion so failures point at the real cause.
  expect(stderr).toBe("");
  expect(stdout).toContain("TEARDOWN_DONE");
  expect(exitCode).toBe(0);
});
