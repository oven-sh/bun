import { spawn } from "bun";
import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("Bun.listen() should not fail with EADDRINUSE on hot reload", async () => {
  // Find an available port
  const portFinder = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {},
      data() {},
      close() {},
      error() {},
    },
  });
  const port = portFinder.port;
  portFinder.stop();

  using dir = tempDir("issue-26036", {
    "server.ts": `
const server = Bun.listen({
  hostname: "127.0.0.1",
  port: ${port},
  socket: {
    open(socket) {},
    data(socket, data) {},
    close(socket) {},
    error(socket, err) {},
  },
});
console.log("[LISTENING] port=" + server.port);
`,
  });

  const serverPath = join(String(dir), "server.ts");

  await using runner = spawn({
    cmd: [bunExe(), "--hot", serverPath],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let reloadCount = 0;
  let stdout = "";
  let stderr = "";
  const targetReloads = 3;

  // Read stderr in parallel
  const stderrPromise = (async () => {
    for await (const chunk of runner.stderr) {
      stderr += new TextDecoder().decode(chunk);
      // If we see EADDRINUSE, the test has already failed
      if (stderr.includes("EADDRINUSE")) {
        runner.kill();
      }
    }
  })();

  // Wait for the server to start listening
  outer: for await (const chunk of runner.stdout) {
    stdout += new TextDecoder().decode(chunk);

    // Count successful reloads by counting [LISTENING] messages
    const matches = stdout.match(/\[LISTENING\]/g);
    if (matches) {
      const newCount = matches.length;
      if (newCount > reloadCount) {
        reloadCount = newCount;

        if (reloadCount >= targetReloads) {
          runner.kill();
          break;
        }

        // Trigger a hot reload by modifying the file
        writeFileSync(
          serverPath,
          `
const server = Bun.listen({
  hostname: "127.0.0.1",
  port: ${port},
  socket: {
    open(socket) {},
    data(socket, data) {},
    close(socket) {},
    error(socket, err) {},
  },
});
console.log("[LISTENING] port=" + server.port + " reload=${reloadCount}");
`,
        );
      }
    }
  }

  await stderrPromise;

  // Verify no EADDRINUSE error occurred
  expect(stderr).not.toContain("EADDRINUSE");
  expect(stderr).not.toContain("Failed to listen");

  // Verify we successfully reloaded multiple times
  expect(reloadCount).toBeGreaterThanOrEqual(targetReloads);
});
