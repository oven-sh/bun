// https://github.com/oven-sh/bun/issues/15499
// https-proxy-agent and socks-proxy-agent not working
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("CONNECT method with authority-format path should not throw invalid URL error (issue #15499)", async () => {
  // Test that CONNECT method with path="host:port" format doesn't throw "fetch() URL is invalid"
  // This is a minimal test to verify the core issue is fixed
  using dir = tempDir("issue-15499", {
    "test.js": `
      import https from 'node:https';

      // Create a CONNECT request with authority-format path (host:port)
      // This should not throw "fetch() URL is invalid" error
      const req = https.request({
        host: 'localhost',
        port: 9999,  // dummy port
        method: 'CONNECT',
        path: 'example.com:443',  // Authority format - this was causing the bug
        timeout: 100,
      });

      req.on('connect', (res, socket, head) => {
        console.log('Connected successfully');
        socket.end();
      });

      req.on('error', (err) => {
        // We expect ECONNREFUSED since port 9999 isn't listening
        // But we should NOT get ERR_INVALID_URL or "fetch() URL is invalid"
        console.log('Error code:', err.code);
        console.log('Error message:', err.message);
      });

      req.end();

      // Keep process alive briefly
      setTimeout(() => {}, 200);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The key assertion: should not get "fetch() URL is invalid" error
  // Before the fix, this would throw: ERR_INVALID_URL: fetch() URL is invalid
  // because the URL was constructed as "http://localhost:9999example.com:443" (invalid)
  // After the fix, CONNECT method paths are handled correctly as authority format
  expect(stderr).not.toContain("fetch() URL is invalid");
  expect(stderr).not.toContain("ERR_INVALID_URL");
  expect(stdout).not.toContain("ERR_INVALID_URL");

  expect(exitCode).toBe(0);
});
