import { RedisClient } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import net from "net";
import { ConnectionType, createClient, ctx, isEnabled, readRespCommands, testKey } from "../test-utils";

/**
 * Test suite for RESP protocol handling, focusing on edge cases
 * - RESP3 data types handling
 * - Protocol parsing edge cases
 * - Bulk string/array handling
 * - Special value encoding/decoding
 */
describe.skipIf(!isEnabled)("Valkey: Protocol Handling", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  describe("RESP3 Data Type Handling", () => {
    test("should handle RESP3 Map type (HGETALL)", async () => {
      // Create a hash with multiple fields
      const hashKey = testKey("map-test");
      await ctx.redis.send("HSET", [
        hashKey,
        "field1",
        "value1",
        "field2",
        "value2",
        "number",
        "42",
        "empty",
        "",
        "special",
        "hello\r\nworld",
      ]);

      // Get as RESP3 Map via HGETALL
      const mapResult = await ctx.redis.send("HGETALL", [hashKey]);

      expect(mapResult).toMatchInlineSnapshot(`
        {
          "empty": "",
          "field1": "value1",
          "field2": "value2",
          "number": "42",
          "special": 
        "hello
        world"
        ,
        }
      `);
    });

    test("should handle RESP3 Set type", async () => {
      // Create a set with multiple members
      const setKey = testKey("set-test");
      await ctx.redis.send("SADD", [setKey, "member1", "member2", "42", "", "special \r\n character"]);

      // Get as RESP3 Set via SMEMBERS
      const setResult = await ctx.redis.send("SMEMBERS", [setKey]);

      expect(JSON.stringify(setResult)).toMatchInlineSnapshot(
        `"["member1","member2","42","","special \\r\\n character"]"`,
      );
    });

    test("should handle RESP3 Boolean type", async () => {
      const key = testKey("bool-test");
      await ctx.redis.set(key, "value");

      // EXISTS returns Boolean in RESP3
      const existsResult = await ctx.redis.exists(key);
      expect(typeof existsResult).toBe("boolean");
      expect(existsResult).toBe(true);

      // Non-existent key
      const notExistsResult = await ctx.redis.exists(testKey("nonexistent"));
      expect(typeof notExistsResult).toBe("boolean");
      expect(notExistsResult).toBe(false);
    });

    test("should handle RESP3 Number types", async () => {
      const counterKey = testKey("counter");
      // Various numeric commands to test number handling

      // INCR returns integer
      const incrResult = await ctx.redis.incr(counterKey);
      expect(typeof incrResult).toBe("number");
      expect(incrResult).toBe(1);

      // Use INCRBYFLOAT to test double/float handling
      const doubleResult = await ctx.redis.send("INCRBYFLOAT", [counterKey, "1.5"]);
      // Some Redis versions return this as string, either is fine
      expect(doubleResult === "2.5" || doubleResult === 2.5).toBe(true);

      // Use HINCRBYFLOAT to test another float command
      const hashKey = testKey("hash-float");
      const hashDoubleResult = await ctx.redis.send("HINCRBYFLOAT", [hashKey, "field", "10.5"]);
      // Should be string or number
      expect(hashDoubleResult === "10.5" || hashDoubleResult === 10.5).toBe(true);
    });

    test("should handle RESP3 Null type", async () => {
      // GET non-existent key
      const nullResult = await ctx.redis.get(testKey("nonexistent"));
      expect(nullResult).toBeNull();

      // HGET non-existent field
      const hashKey = testKey("hash");
      await ctx.redis.send("HSET", [hashKey, "existing", "value"]);

      const nullFieldResult = await ctx.redis.send("HGET", [hashKey, "nonexistent"]);
      expect(nullFieldResult).toBeNull();

      // BLPOP with timeout
      const listKey = testKey("empty-list");
      const timeoutResult = await ctx.redis.send("BLPOP", [listKey, "0.1"]);
      expect(timeoutResult).toBeNull();
    });

    test("should handle RESP3 Error type", async () => {
      expect(async () => await ctx.redis.send("GET", [])).toThrowErrorMatchingInlineSnapshot(
        `"ERR wrong number of arguments for 'get' command"`,
      );

      expect(async () => await ctx.redis.send("SYNTAX-ERROR", [])).toThrowErrorMatchingInlineSnapshot(
        `"ERR unknown command 'SYNTAX-ERROR'"`,
      );
    });
  });

  describe("Protocol Parsing Edge Cases", () => {
    test("should handle nested array structures", async () => {
      // XRANGE returns array of arrays
      const streamKey = testKey("stream");

      // Add entries to stream
      await ctx.redis.send("XADD", [streamKey, "*", "field1", "value1", "field2", "value2"]);
      await ctx.redis.send("XADD", [streamKey, "*", "field1", "value3", "field2", "value4"]);

      // Get range
      const rangeResult = await ctx.redis.send("XRANGE", [streamKey, "-", "+"]);

      // Should get array of arrays
      expect(Array.isArray(rangeResult)).toBe(true);
      expect(rangeResult.length).toBe(2);

      // First entry should have ID and fields
      const firstEntry = rangeResult[0];
      expect(Array.isArray(firstEntry)).toBe(true);
      expect(firstEntry.length).toBe(2);

      // ID should be string
      expect(typeof firstEntry[0]).toBe("string");

      // Fields should be array of field-value pairs in RESP2 or object in RESP3
      const fields = firstEntry[1];
      if (Array.isArray(fields)) {
        // RESP2 style
        expect(fields.length % 2).toBe(0); // Even number for field-value pairs
      } else if (typeof fields === "object" && fields !== null) {
        // RESP3 style (map)
        expect(fields.field1).toBeTruthy();
        expect(fields.field2).toBeTruthy();
      }
    });

    test("should handle empty strings in bulk strings", async () => {
      // Set empty string value
      const key = testKey("empty-string");
      await ctx.redis.set(key, "");

      // Get it back
      const result = await ctx.redis.get(key);
      expect(result).toBe("");

      // HSET with empty field and/or value
      const hashKey = testKey("hash-empty");
      await ctx.redis.send("HSET", [hashKey, "empty-field", ""]);
      await ctx.redis.send("HSET", [hashKey, "", "empty-field-name"]);

      // Get them back
      const emptyValue = await ctx.redis.send("HGET", [hashKey, "empty-field"]);
      expect(emptyValue).toBe("");

      const emptyField = await ctx.redis.send("HGET", [hashKey, ""]);
      expect(emptyField).toBe("empty-field-name");
    });

    test("should handle large arrays", async () => {
      // Create a large set
      const setKey = testKey("large-set");
      const itemCount = 10000;

      // Add many members (in chunks to avoid huge command)
      for (let i = 0; i < itemCount; i += 100) {
        const members = [];
        for (let j = 0; j < 100 && i + j < itemCount; j++) {
          members.push(`member-${i + j}`);
        }
        await ctx.redis.send("SADD", [setKey, ...members]);
      }

      // Get all members
      const membersResult = await ctx.redis.send("SMEMBERS", [setKey]);

      // Should get all members back
      expect(Array.isArray(membersResult)).toBe(true);
      expect(membersResult.length).toBe(itemCount);

      // Check a few random members
      for (let i = 0; i < 10; i++) {
        const index = Math.floor(Math.random() * itemCount);
        expect(membersResult).toContain(`member-${index}`);
      }
    });

    test("should handle very large bulk strings", async () => {
      // Create various sized strings
      const sizes = [
        1024, // 1KB
        10 * 1024, // 10KB
        100 * 1024, // 100KB
        1024 * 1024, // 1MB
      ];

      for (const size of sizes) {
        const key = testKey(`large-string-${size}`);
        const value = Buffer.alloc(size, "x").toString();

        // Set the large value
        await ctx.redis.set(key, value);

        // Get it back
        const result = await ctx.redis.get(key);

        // Should be same length
        expect(result?.length).toBe(size);
        expect(result).toBe(value);
      }
    });

    test("should handle binary data", async () => {
      // Create binary data with full byte range
      const binaryData = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }

      // Convert to string for Redis storage
      const binaryString = String.fromCharCode(...binaryData);

      // Store binary data
      const key = testKey("binary-data");
      await ctx.redis.set(key, binaryString);

      // Get it back
      const result = await ctx.redis.get(key);

      // Should have same length
      expect(result?.length).toBe(binaryString.length);

      // Verify each byte
      if (result) {
        for (let i = 0; i < Math.min(256, result.length); i++) {
          expect(result.charCodeAt(i)).toBe(i);
        }
      }
    });
  });

  describe("Special Value Handling", () => {
    test("should handle RESP protocol delimiter characters", async () => {
      try {
        // Set values containing RESP delimiters
        const testCases = [
          { key: testKey("cr"), value: "contains\rcarriage\rreturn" },
          { key: testKey("lf"), value: "contains\nline\nfeed" },
          { key: testKey("crlf"), value: "contains\r\ncrlf\r\ndelimiters" },
          { key: testKey("mixed"), value: "mixed\r\n\r\n\r\ndelimiters" },
        ];

        for (const { key, value } of testCases) {
          await ctx.redis.set(key, value);

          const result = await ctx.redis.get(key);
          expect(result).toBe(value);
        }
      } catch (error) {
        console.warn("RESP delimiter test failed:", error.message);
        throw error;
      }
    });

    test("should handle special RESP types in data", async () => {
      const client = ctx.redis;

      try {
        // Values that might confuse RESP parser if not properly handled
        const testCases = [
          { key: testKey("plus"), value: "+OK\r\n" }, // Simple string prefix
          { key: testKey("minus"), value: "-ERR\r\n" }, // Error prefix
          { key: testKey("colon"), value: ":123\r\n" }, // Integer prefix
          { key: testKey("dollar"), value: "$5\r\nhello\r\n" }, // Bulk string format
          { key: testKey("asterisk"), value: "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n" }, // Array format
        ];

        for (const { key, value } of testCases) {
          await client.set(key, value);

          const result = await client.get(key);
          expect(result).toBe(value);
        }
      } catch (error) {
        console.warn("RESP types in data test failed:", error.message);
        throw error;
      }
    });
  });

  describe.todo("RESP3 Push Type Handling", () => {});

  describe("Extreme Protocol Conditions", () => {
    test("should handle rapidly switching between command types", async () => {
      const client = ctx.redis;

      try {
        // Rapidly alternate between different command types
        // to stress protocol parser context switching
        const iterations = 100;
        const prefix = testKey("rapid");

        for (let i = 0; i < iterations; i++) {
          // String operations
          await client.set(`${prefix}-str-${i}`, `value-${i}`);
          await client.get(`${prefix}-str-${i}`);

          // Integer operations
          await client.incr(`${prefix}-int-${i}`);

          // Array result operations
          await client.send("KEYS", [`${prefix}-str-${i}`]);

          // Hash operations (map responses)
          await client.send("HSET", [`${prefix}-hash-${i}`, "field", "value"]);
          await client.send("HGETALL", [`${prefix}-hash-${i}`]);

          // Set operations
          await client.send("SADD", [`${prefix}-set-${i}`, "member1", "member2"]);
          await client.send("SMEMBERS", [`${prefix}-set-${i}`]);
        }

        // If we got here without protocol parse errors, test passes
      } catch (error) {
        console.warn("Rapid command switching test failed:", error.message);

        throw error;
      }
    });

    test("should handle simultaneous command streams", async () => {
      // Create multiple clients for parallel operations
      const clientCount = 5;
      const clients = Array.from({ length: clientCount }, () => createClient());

      try {
        // Run many operations in parallel across clients
        const operationsPerClient = 20;
        const prefix = testKey("parallel");

        const allPromises = clients.flatMap((client, clientIndex) => {
          const promises = [];

          for (let i = 0; i < operationsPerClient; i++) {
            const key = `${prefix}-c${clientIndex}-${i}`;

            // Mix of operation types
            promises.push(client.set(key, `value-${i}`));
            promises.push(client.get(key));
            promises.push(client.incr(`${key}-counter`));
            promises.push(client.send("HSET", [`${key}-hash`, "field", "value"]));
          }

          return promises;
        });

        // Run all operations simultaneously
        await Promise.all(allPromises);

        // If we got here without errors, test passes
      } catch (error) {
        console.warn("Parallel client test failed:", error.message);

        throw error;
      } finally {
        // Clean up clients
        await Promise.all(clients.map(client => client.close()));
      }
    });
  });
});

/**
 * A RESP3 attribute (`|N`) is out-of-band metadata that may prefix *any* reply
 * or push, so the outer frame type of a decorated reply says nothing about how
 * the client should route it. These tests script the wire directly because no
 * real server emits attributes on demand.
 */
describe("Valkey: RESP3 attributes", () => {
  const CRLF = "\r\n";
  const bulk = (value: string) => `$${Buffer.byteLength(value)}${CRLF}${value}${CRLF}`;
  const pushFrame = (...frames: string[]) => `>${frames.length}${CRLF}${frames.join("")}`;
  const HELLO_REPLY = `%3${CRLF}${bulk("server")}${bulk("redis")}${bulk("proto")}:3${CRLF}${bulk("version")}${bulk("7.4.0")}`;
  // One-entry attribute map, the shape Redis/Valkey use for key-popularity hints.
  const ATTRIBUTE = `|1${CRLF}${bulk("key-popularity")}:42${CRLF}`;

  /**
   * Run `body` against a client wired to a scripted RESP3 server. `reply` gets
   * the upper-cased command name and its arguments and returns the raw bytes to
   * answer with; returning `undefined` falls back to the HELLO handshake reply
   * for HELLO and `+OK` for everything else.
   */
  async function withScriptedServer<T>(
    reply: (name: string, args: string[]) => string | undefined,
    body: (client: RedisClient) => Promise<T>,
  ): Promise<T> {
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      const state = { buffer: Buffer.alloc(0) };
      socket.on("data", chunk => {
        state.buffer = Buffer.concat([state.buffer, chunk]);
        for (const args of readRespCommands(state)) {
          const name = (args[0] ?? "").toUpperCase();
          socket.write(reply(name, args.slice(1)) ?? (name === "HELLO" ? HELLO_REPLY : `+OK${CRLF}`));
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      return await body(client);
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  }

  test("an attribute-decorated out-of-band push is not consumed as a command reply", async () => {
    const values = ["A", "B", "C"];
    const results = await withScriptedServer(
      name => {
        if (name !== "GET") return undefined;
        // The push arrives before the first GET's reply, decorated by an attribute.
        const push = values.length === 3 ? ATTRIBUTE + pushFrame(bulk("message"), bulk("chan"), bulk("hi")) : "";
        return push + bulk(values.shift()!);
      },
      async client => {
        await client.connect();
        return [await client.get("a"), await client.get("b"), await client.get("c")];
      },
    );

    // Without unwrapping the attribute the push is handed to `get("a")` and every
    // later reply on the connection is shifted by one, forever.
    expect(results).toEqual(["A", "B", "C"]);
  });

  test("an attribute-decorated subscribe confirmation enters subscriber mode", async () => {
    const received = Promise.withResolvers<[string, string]>();
    const subscribeResult = await withScriptedServer(
      (name, args) => {
        if (name !== "SUBSCRIBE") return undefined;
        return (
          ATTRIBUTE +
          pushFrame(bulk("subscribe"), bulk(args[0]), `:1${CRLF}`) +
          pushFrame(bulk("message"), bulk(args[0]), bulk("hi"))
        );
      },
      async client => {
        await client.connect();
        const count = await client.subscribe("chan", (message, channel) => {
          received.resolve([message, channel]);
        });
        // Without unwrapping, `subscribe()` resolves with the raw push object and
        // the client never enters subscriber mode, so the listener never fires.
        expect(count).toBe(1);
        expect(await received.promise).toEqual(["hi", "chan"]);
        return count;
      },
    );

    expect(subscribeResult).toBe(1);
  });

  test("an attribute-decorated HELLO reply completes the handshake", async () => {
    const value = await withScriptedServer(
      name => {
        if (name === "HELLO") return ATTRIBUTE + HELLO_REPLY;
        if (name === "GET") return bulk("value");
        return undefined;
      },
      async client => {
        await client.connect();
        return client.get("key");
      },
    );

    expect(value).toBe("value");
  });

  test("an attribute-decorated error reply rejects the command", async () => {
    await withScriptedServer(
      name => (name === "GET" ? `${ATTRIBUTE}-ERR decorated failure${CRLF}` : undefined),
      async client => {
        await client.connect();
        // Without unwrapping, the error is *resolved* as an Error object.
        await expect(client.get("key")).rejects.toThrow("ERR decorated failure");
      },
    );
  });

  test("an attribute-decorated integer reply still coerces to boolean for EXISTS", async () => {
    const exists = await withScriptedServer(
      name => (name === "EXISTS" ? `${ATTRIBUTE}:1${CRLF}` : undefined),
      async client => {
        await client.connect();
        return client.exists("key");
      },
    );

    expect(exists).toBe(true);
  });

  test("attributes are transparent metadata around the value they decorate", async () => {
    const [value, array] = await withScriptedServer(
      name => {
        if (name === "GET") return ATTRIBUTE + bulk("value");
        // Attributes can also decorate an element nested inside an aggregate.
        if (name === "LRANGE") return `*2${CRLF}${ATTRIBUTE}${bulk("a")}${bulk("b")}`;
        return undefined;
      },
      async client => {
        await client.connect();
        return [await client.get("key"), await client.send("LRANGE", ["list", "0", "-1"])];
      },
    );

    expect(value).toBe("value");
    expect(array).toEqual(["a", "b"]);
  });
});
