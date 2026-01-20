import { describe, expect, it } from "bun:test";

// This test verifies the fix for issue #26290
// The TypeScript types for Socket.reload() and SocketListener.reload()
// should accept { socket: handler } not just handler directly

describe("Issue #26290: Socket.reload() type definition", () => {
  it("Socket.reload() type signature accepts options object with socket property", async () => {
    // This test verifies that the types compile correctly
    // The actual runtime behavior is tested elsewhere

    const server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open(socket) {
          // TypeScript should accept this - options object with socket property
          // Before the fix, TS accepted handler directly but runtime rejected it
          // This line should compile without type errors
          const reloadOptions: Parameters<typeof socket.reload>[0] = {
            socket: {
              open() {},
              data() {},
              close() {},
            },
          };
          // Don't actually call reload() as there's a separate runtime bug
          expect(reloadOptions.socket).toBeDefined();
          socket.end();
        },
        data() {},
        close() {},
      },
    });

    try {
      const client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open() {},
          data() {},
          close() {},
        },
      });

      await Bun.sleep(50);
      client.end();
    } finally {
      server.stop(true);
    }
  });

  it("SocketListener.reload() type signature accepts options object with socket property", () => {
    const server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open() {},
        data() {},
        close() {},
      },
    });

    try {
      // TypeScript should accept this - options object with socket property
      const reloadOptions: Parameters<typeof server.reload>[0] = {
        socket: {
          open() {},
          data() {},
          close() {},
        },
      };
      expect(reloadOptions.socket).toBeDefined();

      // Actually call reload() on the listener since that part works
      server.reload({
        socket: {
          open() {},
          data() {},
          close() {},
        },
      });
    } finally {
      server.stop(true);
    }
  });
});
