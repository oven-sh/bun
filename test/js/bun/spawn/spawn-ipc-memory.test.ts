import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("IPC memory leak", () => {
  test("sustained IPC messaging should reach steady state memory", async () => {
    // This test runs multiple rounds of IPC messaging and checks that
    // memory stabilizes rather than growing continuously.
    // We use heapUsed instead of rss for more accurate JS memory tracking.
    using dir = tempDir("ipc-sustained", {
      "child.js": `
        process.on("message", (msg) => {
          if (msg.type === "ping") {
            process.send({ type: "pong", round: msg.round });
          } else if (msg.type === "done") {
            process.exit(0);
          }
        });
      `,
      "parent.js": `
        const messagesPerRound = 500;
        const rounds = 6;
        let currentRound = 0;
        let messagesInRound = 0;
        const memoryByRound = [];

        const proc = Bun.spawn([process.execPath, "child.js"], {
          cwd: import.meta.dir,
          env: { ...process.env },
          ipc: (message, subprocess) => {
            if (message.type === "pong") {
              messagesInRound++;

              if (messagesInRound >= messagesPerRound) {
                // Round complete, record memory after GC
                Bun.gc(true);
                memoryByRound.push(process.memoryUsage().heapUsed);

                currentRound++;
                messagesInRound = 0;

                if (currentRound >= rounds) {
                  subprocess.send({ type: "done" });

                  // Analyze memory trend - skip first round as warmup
                  const stableRounds = memoryByRound.slice(1);
                  const firstStable = stableRounds[0];
                  const lastStable = stableRounds[stableRounds.length - 1];
                  const growthOverRounds = lastStable - firstStable;
                  const growthPerRound = growthOverRounds / (stableRounds.length - 1);

                  // Calculate average to check for stability
                  const avg = stableRounds.reduce((a, b) => a + b, 0) / stableRounds.length;
                  const maxDev = Math.max(...stableRounds.map(m => Math.abs(m - avg)));

                  console.log(JSON.stringify({
                    memoryByRound,
                    stableRounds,
                    growthPerRound,
                    totalGrowth: growthOverRounds,
                    avgMemory: avg,
                    maxDeviation: maxDev,
                    // Relative deviation should be small for stable memory
                    relativeDeviation: maxDev / avg
                  }));
                  process.exit(0);
                } else {
                  // Start next round
                  for (let i = 0; i < messagesPerRound; i++) {
                    subprocess.send({ type: "ping", round: currentRound });
                  }
                }
              }
            }
          },
          stdio: ["inherit", "inherit", "inherit"],
          serialization: "json",
        });

        // Start first round
        for (let i = 0; i < messagesPerRound; i++) {
          proc.send({ type: "ping", round: currentRound });
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (stderr) {
      console.error("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    if (stdout.trim()) {
      const result = JSON.parse(stdout.trim());
      console.log("Sustained IPC memory:", result);

      // Memory should stabilize after warmup - growth per round should be minimal
      // Allow up to 100KB per round which accounts for normal variation
      // A memory leak would show continuous growth much larger than this
      expect(result.growthPerRound).toBeLessThan(100 * 1024);

      // Relative deviation from average should be small (less than 50%)
      // indicating memory has reached a steady state
      expect(result.relativeDeviation).toBeLessThan(0.5);
    }
  });

  test("large message batches should not accumulate memory in incoming buffer", async () => {
    // This test sends large batches of messages to stress the incoming buffer handling
    using dir = tempDir("ipc-batch", {
      "child.js": `
        // Send messages in batches
        const batchSize = 100;
        const batches = 10;

        for (let b = 0; b < batches; b++) {
          for (let i = 0; i < batchSize; i++) {
            process.send({ batch: b, index: i, padding: "x".repeat(50) });
          }
        }
        process.send({ done: true, totalSent: batchSize * batches });
      `,
      "parent.js": `
        let messageCount = 0;
        const memorySnapshots = [];

        const proc = Bun.spawn([process.execPath, "child.js"], {
          cwd: import.meta.dir,
          env: { ...process.env },
          ipc: (message, subprocess) => {
            messageCount++;

            // Take memory snapshots at intervals
            if (messageCount % 250 === 0) {
              Bun.gc(true);
              memorySnapshots.push(process.memoryUsage().heapUsed);
            }

            if (message.done) {
              subprocess.kill();

              Bun.gc(true);
              memorySnapshots.push(process.memoryUsage().heapUsed);

              // Check if memory grew linearly (indicating leak) or stayed stable
              const firstSnapshot = memorySnapshots[0];
              const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];

              console.log(JSON.stringify({
                messageCount,
                expectedMessages: message.totalSent + 1,
                memorySnapshots,
                firstSnapshot,
                lastSnapshot,
                growth: lastSnapshot - firstSnapshot
              }));
              process.exit(0);
            }
          },
          stdio: ["inherit", "inherit", "inherit"],
          serialization: "json",
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (stderr) {
      console.error("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    if (stdout.trim()) {
      const result = JSON.parse(stdout.trim());
      console.log("Batch IPC memory:", result);

      // All messages should have been received
      expect(result.messageCount).toBe(result.expectedMessages);

      // Memory growth should be bounded - not growing linearly with message count
      // Allow up to 500KB total growth (not per message!)
      expect(result.growth).toBeLessThan(500 * 1024);
    }
  });

  test("IPC with callbacks should not leak callback memory", async () => {
    // Tests that send() callbacks are properly cleaned up
    using dir = tempDir("ipc-callback", {
      "child.js": `
        // Echo back messages
        process.on("message", (msg) => {
          if (msg.type === "done") {
            process.exit(0);
          }
          process.send({ echo: msg.index });
        });
      `,
      "parent.js": `
        const messageCount = 1000;
        let received = 0;
        let callbacksCalled = 0;
        const memorySnapshots = [];

        const proc = Bun.spawn([process.execPath, "child.js"], {
          cwd: import.meta.dir,
          env: { ...process.env },
          ipc: (message, subprocess) => {
            received++;

            if (received % 250 === 0) {
              Bun.gc(true);
              memorySnapshots.push(process.memoryUsage().heapUsed);
            }

            if (received >= messageCount) {
              subprocess.send({ type: "done" });

              Bun.gc(true);
              memorySnapshots.push(process.memoryUsage().heapUsed);

              console.log(JSON.stringify({
                received,
                callbacksCalled,
                memorySnapshots,
                growth: memorySnapshots[memorySnapshots.length - 1] - memorySnapshots[0]
              }));
              process.exit(0);
            }
          },
          stdio: ["inherit", "inherit", "inherit"],
          serialization: "json",
        });

        // Send messages with callbacks
        for (let i = 0; i < messageCount; i++) {
          proc.send({ index: i }, () => {
            callbacksCalled++;
          });
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (stderr) {
      console.error("stderr:", stderr);
    }

    expect(exitCode).toBe(0);

    if (stdout.trim()) {
      const result = JSON.parse(stdout.trim());
      console.log("Callback IPC memory:", result);

      // All messages received
      expect(result.received).toBe(1000);

      // Callbacks should have been called
      expect(result.callbacksCalled).toBe(1000);

      // Memory growth should be bounded
      expect(result.growth).toBeLessThan(500 * 1024);
    }
  });
});
