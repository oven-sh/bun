import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/25633
// TypeError: null is not an object (evaluating 'context') in internalConnectMultipleTimeout
// when using node:tls connect with timeout and autoSelectFamily under high concurrent load

describe("issue #25633", () => {
  test("TLS connect with timeout and autoSelectFamily should not crash when destroyed early", async () => {
    using dir = tempDir("issue-25633", {
      "test.js": `
        const net = require("node:net");

        // Use localhost addresses that will likely fail/timeout to trigger the race condition
        // The key is that we destroy the socket while the timeout is still pending
        const connCount = 10;
        let completed = 0;
        let crashErrors = [];

        process.on("uncaughtException", (err) => {
          crashErrors.push(err);
        });

        for (let i = 0; i < connCount; i++) {
          const socket = net.connect({
            // Use localhost with a port that's unlikely to be open
            host: "localhost",
            port: 65432,
            timeout: 200,
            autoSelectFamily: true,
            autoSelectFamilyAttemptTimeout: 50,
          });

          socket.on('error', () => {
            completed++;
            checkDone();
          });

          socket.on('connect', () => {
            completed++;
            socket.destroy();
            checkDone();
          });

          socket.on('timeout', () => {
            socket.destroy();
          });

          // Immediately destroy some sockets to trigger race condition
          if (i % 2 === 0) {
            setTimeout(() => socket.destroy(), 5);
          }
        }

        function checkDone() {
          if (completed >= connCount) {
            finish();
          }
        }

        function finish() {
          if (crashErrors.length > 0) {
            console.error("CRASH_ERRORS:", crashErrors.map(e => e.message).join(", "));
            process.exit(1);
          } else {
            console.log("SUCCESS");
            process.exit(0);
          }
        }

        // Safety timeout
        setTimeout(finish, 1500);
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

    // The test passes if it doesn't crash with "null is not an object"
    expect(stderr).not.toContain("null is not an object");
    expect(stdout).toContain("SUCCESS");
    expect(exitCode).toBe(0);
  }, 10000);
});
