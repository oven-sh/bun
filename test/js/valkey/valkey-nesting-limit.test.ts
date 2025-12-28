import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

describe("Valkey RESP parser hardening", () => {
  test("rejects deeply nested RESP3 structures from malicious server", async () => {
    // Create a mock server that sends a deeply nested RESP3 array
    // This simulates a malicious server attempting to cause stack overflow
    const nestingDepth = 1000; // Well above any reasonable limit

    // Build the malicious payload: *1\r\n repeated nestingDepth times, then +OK\r\n
    let payload = "";
    for (let i = 0; i < nestingDepth; i++) {
      payload += "*1\r\n";
    }
    payload += "+OK\r\n";

    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          // Send the malicious payload immediately upon connection
          socket.write(payload);
        },
        data() {},
        close() {},
        error() {},
      },
    });

    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, {
      connectionTimeout: 2000,
      idleTimeout: 2000,
    });

    try {
      // The client should reject the deeply nested response with an error,
      // not crash with stack overflow
      await client.send("PING", []);
      expect.unreachable("Expected an error for deeply nested response");
    } catch (error: any) {
      // We expect an error to be thrown, indicating the parser rejected the payload
      // The exact error may vary, but it should NOT be a stack overflow crash
      expect(error).toBeDefined();
      expect(error.message).toBeDefined();
    } finally {
      client.close();
    }
  });

  test("accepts moderately nested RESP3 structures", async () => {
    // Create a mock server that sends a moderately nested response (depth 10)
    // This should succeed without issues

    // Build a response for HELLO command followed by the nested response
    const helloResponse =
      "%7\r\n" +
      "+server\r\n+redis\r\n" +
      "+version\r\n+7.0.0\r\n" +
      "+proto\r\n:3\r\n" +
      "+id\r\n:1\r\n" +
      "+mode\r\n+standalone\r\n" +
      "+role\r\n+master\r\n" +
      "+modules\r\n*0\r\n";

    const nestedPayload =
      "*1\r\n" + // depth 0
      "*1\r\n" + // depth 1
      "*1\r\n" + // depth 2
      "*1\r\n" + // depth 3
      "*1\r\n" + // depth 4
      "*1\r\n" + // depth 5
      "*1\r\n" + // depth 6
      "*1\r\n" + // depth 7
      "*1\r\n" + // depth 8
      "*1\r\n" + // depth 9
      "+OK\r\n"; // innermost value

    let messageCount = 0;

    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {},
        data(socket, _data) {
          messageCount++;
          if (messageCount === 1) {
            // First message is HELLO, respond with server info
            socket.write(helloResponse);
          } else {
            // Subsequent messages get the nested response
            socket.write(nestedPayload);
          }
        },
        close() {},
        error() {},
      },
    });

    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, {
      connectionTimeout: 2000,
      idleTimeout: 2000,
    });

    try {
      const result = await client.send("PING", []);
      // The result should be the nested structure parsed correctly
      expect(result).toBeDefined();
    } finally {
      client.close();
    }
  });
});
