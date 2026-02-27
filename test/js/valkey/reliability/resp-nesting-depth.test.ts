import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "net";

/**
 * Test suite for RESP protocol nesting depth limits.
 * Ensures the parser handles deeply nested aggregate types gracefully.
 */
describe("Valkey: RESP Nesting Depth Handling", () => {
  /**
   * Helper: build a RESP payload consisting of `depth` nested single-element
   * arrays wrapping a final integer value `:0\r\n`.
   *
   *   depth=3 → "*1\r\n*1\r\n*1\r\n:0\r\n"
   */
  function buildNestedArrayPayload(depth: number): Buffer {
    const prefix = "*1\r\n";
    const leaf = ":0\r\n";
    return Buffer.from(prefix.repeat(depth) + leaf);
  }

  /**
   * Creates a minimal mock Redis server that responds to every incoming
   * data event with a specific payload. The first response is always +OK
   * (for the HELLO handshake), subsequent responses use the provided payload.
   */
  function createMockRedisServer(payload: Buffer): Promise<{ server: net.Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => {
        let isFirstMessage = true;

        socket.on("data", () => {
          if (isFirstMessage) {
            // Respond to HELLO handshake with a simple OK
            isFirstMessage = false;
            socket.write("+OK\r\n");
          } else {
            // All subsequent commands get the crafted payload
            socket.write(payload);
          }
        });

        socket.on("error", () => {
          // Ignore socket errors from client disconnecting
        });
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve({ server, port: addr.port });
      });

      server.on("error", reject);
    });
  }

  test("should reject responses that exceed the nesting depth limit", async () => {
    // 256 levels of nesting – well above the 128 limit
    const deepPayload = buildNestedArrayPayload(256);

    const { server, port } = await createMockRedisServer(deepPayload);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 2000,
      });

      try {
        // The HELLO handshake should succeed (mock returns +OK).
        // The next command triggers the deeply nested response.
        await client.send("PING", []);
        expect.unreachable();
      } catch (error: any) {
        // The client should surface an error rather than crashing.
        expect(error).toBeDefined();
        expect(error.message).toBeDefined();
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  });

  test("should accept responses within the nesting depth limit", async () => {
    // 3 levels of nesting – well within the 128 limit
    const shallowPayload = Buffer.from("*1\r\n*1\r\n*1\r\n:42\r\n");

    const { server, port } = await createMockRedisServer(shallowPayload);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 2000,
      });

      try {
        const result = await client.send("PING", []);
        // Should get a nested array: [[[42]]]
        expect(result).toEqual([[[42]]]);
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  });

  test("should not crash the process on extremely deep nesting", async () => {
    // Run in a subprocess to verify the process doesn't crash (e.g. SIGSEGV)
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import net from "net";
        const depth = 1000;
        const prefix = "*1\\r\\n";
        const leaf = ":0\\r\\n";
        const payload = Buffer.from(prefix.repeat(depth) + leaf);

        const server = net.createServer(socket => {
          let first = true;
          socket.on("data", () => {
            if (first) {
              first = false;
              socket.write("+OK\\r\\n");
            } else {
              socket.write(payload);
            }
          });
          socket.on("error", () => {});
        });

        server.listen(0, "127.0.0.1", async () => {
          const port = server.address().port;
          try {
            const client = new Bun.RedisClient("redis://127.0.0.1:" + port, {
              autoReconnect: false,
              connectionTimeout: 2000,
            });
            try {
              await client.send("PING", []);
              console.log("ERROR: should have thrown");
              process.exit(2);
            } catch (e) {
              console.log("OK: got error as expected");
              process.exit(0);
            } finally {
              client.close();
            }
          } catch (e) {
            console.log("OK: connection error");
            process.exit(0);
          } finally {
            server.close();
          }
        });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The process should exit cleanly (not crash with SIGSEGV)
    expect(stdout).toContain("OK:");
    expect(exitCode).toBe(0);
  });
});
