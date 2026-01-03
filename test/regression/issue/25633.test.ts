import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// This tests that the socket timeout callback handles destroyed/cleaned up sockets gracefully
// See: https://github.com/oven-sh/bun/issues/25633
test("internalConnectMultipleTimeout should not crash when context is null", async () => {
  using dir = tempDir("issue-25633", {
    "test.ts": `
import * as tls from "node:tls";

// Create multiple rapid connections with very short timeouts
// This can cause the timeout callback to fire after the socket is already cleaned up
const promises: Promise<void>[] = [];

for (let i = 0; i < 10; i++) {
  promises.push(new Promise<void>((resolve) => {
    const socket = tls.connect({
      host: "localhost",
      port: 65535, // Likely unreachable port
      timeout: 1, // Very short timeout to trigger timeout callback race
    });

    socket.on("error", () => {
      // Expected - port is not listening
    });

    socket.on("timeout", () => {
      socket.destroy();
    });

    // Clean up after a reasonable time
    setTimeout(() => {
      socket.destroy();
      resolve();
    }, 100);
  }));
}

await Promise.all(promises);
console.log("All connections handled without crash");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should complete without crashing due to null context
  expect(stdout).toContain("All connections handled without crash");
  expect(exitCode).toBe(0);
});
