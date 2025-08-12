import { expect, test } from "bun:test";
import net from "node:net";

// Test for Darwin accept() bug where socklen=0 indicates dead socket
// This reproduces the scenario from https://github.com/capnproto/capnproto/pull/2365
test.skipIf(process.platform !== "darwin")("Darwin accept() with socklen=0 should not crash server", async () => {
  // This test specifically targets the code path that could trigger
  // the addr->len == 0 condition in bsd_accept_socket on macOS
  const server = Bun.serve({
    hostname: "::", // IPv6 dual-stack (accepts both IPv4 and IPv6)
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  try {
    const port = server.port;

    // Create the problematic scenario: IPv4 connections to IPv6 dual-stack
    // listener with immediate abort (RST packet). This is the exact condition
    // that triggers the Darwin kernel bug where accept() returns socklen=0.
    const abortConnections = async (count: number) => {
      const promises: Promise<void>[] = [];

      for (let i = 0; i < count; i++) {
        promises.push(
          new Promise<void>(resolve => {
            const socket = new net.Socket();

            const cleanup = () => {
              socket.destroy();
              resolve();
            };

            socket.connect(port, "127.0.0.1", () => {
              // Immediate destroy to send RST packet
              socket.destroy();
            });

            socket.on("error", cleanup);
            socket.on("close", cleanup);
          }),
        );
      }

      await Promise.all(promises);
    };

    // Fire off aborted connections that could trigger the bug
    await abortConnections(50);

    // Verify server is still responding (didn't crash or hang)
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("OK");

    // Try a few more aborts to stress test the fix
    await abortConnections(25);

    // Final verification
    const finalResponse = await fetch(`http://127.0.0.1:${port}/test`);
    expect(finalResponse.ok).toBe(true);
    expect(await finalResponse.text()).toBe("OK");
  } finally {
    server.stop();
  }
});

// Focused unit test for the specific race condition
test.skipIf(process.platform !== "darwin")("rapid IPv4->IPv6 dual-stack connection aborts", async () => {
  const server = Bun.serve({
    hostname: "::",
    port: 0,
    fetch() {
      return new Response("Server alive");
    },
  });

  try {
    const port = server.port;

    // Concurrent connection attempts to maximize chances of race condition
    const connectAndAbort = () => {
      return new Promise<void>(resolve => {
        const socket = new net.Socket();
        socket.connect(port, "127.0.0.1", () => socket.destroy());
        socket.on("error", resolve);
        socket.on("close", resolve);
      });
    };

    // Execute many concurrent connection aborts
    const connections = Array(100)
      .fill(null)
      .map(() => connectAndAbort());
    await Promise.all(connections);

    // Server should still be functional
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(await response.text()).toBe("Server alive");
  } finally {
    server.stop();
  }
});
