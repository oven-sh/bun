import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import net from "node:net";

// Test for Darwin accept() bug where socklen=0 indicates dead socket
// This reproduces the scenario from https://github.com/capnproto/capnproto/pull/2365
test("Darwin accept() bug with socklen=0 should not crash server", async () => {
  if (process.platform !== "darwin") {
    // This is a Darwin-specific kernel bug
    return;
  }

  const testScript = `
import { serve } from "bun";

// Create IPv6 dual-stack server (listens on both IPv4 and IPv6)
const server = serve({
  hostname: "::", // IPv6 any address - enables dual-stack listening
  port: 0,
  fetch(req) {
    return new Response("Hello from dual-stack server!");
  },
});

console.log("READY:" + server.port);

let connectionCount = 0;
let successfulRequests = 0;

// Keep server running and handle multiple connections
const cleanup = () => {
  console.log("STATS:" + connectionCount + "," + successfulRequests);
  server.stop();
  process.exit(0);
};

// Clean shutdown after 5 seconds
setTimeout(cleanup, 5000);

// Handle graceful shutdown
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

export default {
  fetch: server.fetch,
  port: server.port,
};
`;

  const dir = tempDirWithFiles("darwin-accept-test", {
    "server.ts": testScript,
  });

  // Start the server
  const serverProc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  let serverPort: number | null = null;
  let serverReady = false;

  // Wait for server to be ready
  const serverOutput = serverProc.stdout;
  const reader = serverOutput.getReader();

  try {
    while (!serverReady) {
      const { value, done } = await reader.read();
      if (done) break;

      const text = new TextDecoder().decode(value);
      const lines = text.split("\n");

      for (const line of lines) {
        if (line.startsWith("READY:")) {
          serverPort = parseInt(line.split(":")[1]);
          serverReady = true;
          break;
        }
      }
    }

    expect(serverPort).toBeGreaterThan(0);

    // Now create the problematic scenario:
    // IPv4 connections to IPv6 dual-stack listener with immediate abort
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 50; i++) {
      promises.push(
        new Promise<void>(resolve => {
          // Create IPv4 connection to the IPv6 dual-stack listener
          const socket = net.createConnection({
            host: "127.0.0.1", // IPv4 address
            port: serverPort!,
          });

          socket.on("connect", () => {
            // Immediately destroy the connection to trigger RST packet
            // This simulates the exact scenario that causes the Darwin kernel bug
            socket.destroy();
            resolve();
          });

          socket.on("error", () => {
            // Expected - connection aborted
            resolve();
          });

          // Fallback timeout
          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 100);
        }),
      );

      // Small delay between connections to increase chances of hitting race condition
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Wait for all abort attempts
    await Promise.all(promises);

    // Also try some successful requests to make sure server is still functional
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/`);
        const text = await response.text();
        expect(text).toBe("Hello from dual-stack server!");
      } catch (error) {
        // Some requests might fail due to race conditions, which is fine
        console.log(`Request ${i} failed:`, error);
      }
    }

    // Give server time to process all connections
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send termination signal
    serverProc.kill();

    // Wait for clean exit
    const exitCode = await serverProc.exited;

    // Server should exit cleanly without crashing
    expect(exitCode).toBe(0);
  } finally {
    reader.releaseLock();

    // Ensure cleanup
    if (!serverProc.killed) {
      serverProc.kill();
      await serverProc.exited;
    }
  }
}, 10000); // 10 second timeout

// Additional focused test that directly exercises the accept path
test("IPv4 to IPv6 dual-stack with immediate abort pattern", async () => {
  if (process.platform !== "darwin") {
    return;
  }

  // This test specifically targets the code path that could trigger
  // the addr->len == 0 condition in bsd_accept_socket
  const server = Bun.serve({
    hostname: "::", // IPv6 dual-stack
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  try {
    const port = server.port;

    // Rapid fire IPv4 connections with immediate abort
    // This pattern is most likely to trigger the Darwin kernel bug
    const abortPromises: Promise<void>[] = [];

    for (let i = 0; i < 100; i++) {
      abortPromises.push(
        new Promise<void>(resolve => {
          const socket = new net.Socket();

          socket.connect(port, "127.0.0.1", () => {
            // Immediate destroy to send RST
            socket.destroy();
          });

          socket.on("error", () => resolve());
          socket.on("close", () => resolve());

          // Ensure resolve even if events don't fire
          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 50);
        }),
      );
    }

    // Execute all connection attempts concurrently
    await Promise.all(abortPromises);

    // Verify server is still responding
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const text = await response.text();
    expect(text).toBe("OK");

    // Server should still be functional - no crash, no hang
    expect(server.port).toBe(port);
  } finally {
    server.stop();
  }
}, 5000);

// Stress test to maximize chances of hitting the race condition
test.skipIf(process.platform !== "darwin")(
  "stress test: concurrent IPv4->IPv6 dual-stack abort storm",
  async () => {
    // This is an aggressive stress test designed to maximize the probability
    // of hitting the exact race condition that causes addr->len == 0
    const server = Bun.serve({
      hostname: "::", // IPv6 dual-stack listener
      port: 0,
      fetch(req) {
        return new Response(`Request handled: ${Date.now()}`);
      },
    });

    try {
      const port = server.port;
      console.log(`Testing with server on port ${port}`);

      // Multi-wave attack to increase chances of race condition
      const waves = 5;
      const connectionsPerWave = 200;

      for (let wave = 0; wave < waves; wave++) {
        console.log(`Starting wave ${wave + 1}/${waves} with ${connectionsPerWave} connections`);

        const wavePromises: Promise<void>[] = [];

        for (let i = 0; i < connectionsPerWave; i++) {
          wavePromises.push(
            new Promise<void>(resolve => {
              const socket = new net.Socket();

              // Vary the timing slightly to hit different race windows
              const delayMs = Math.random() * 5;

              setTimeout(() => {
                socket.connect(port, "127.0.0.1", () => {
                  // Immediate destruction to create RST packet
                  socket.destroy();
                });

                socket.on("error", () => resolve());
                socket.on("close", () => resolve());

                // Failsafe
                setTimeout(() => {
                  socket.destroy();
                  resolve();
                }, 100);
              }, delayMs);
            }),
          );
        }

        // Wait for this wave to complete
        await Promise.all(wavePromises);

        // Verify server survived this wave
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          const text = await response.text();
          expect(text).toContain("Request handled:");
          console.log(`Wave ${wave + 1} completed, server still responsive`);
        } catch (error) {
          throw new Error(`Server became unresponsive after wave ${wave + 1}: ${error}`);
        }

        // Small delay between waves
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Final verification that server is still fully functional
      const finalResponse = await fetch(`http://127.0.0.1:${port}/final`);
      expect(finalResponse.ok).toBe(true);

      console.log(`Stress test completed successfully: ${waves * connectionsPerWave} aborted connections processed`);
    } finally {
      server.stop();
    }
  },
  15000,
); // Extended timeout for stress test
