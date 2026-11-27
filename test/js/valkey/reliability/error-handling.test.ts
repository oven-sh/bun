import { randomUUIDv7, RedisClient, S3Client } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { ConnectionType, createClient, ctx, isEnabled, readCommands } from "../test-utils";

/**
 * Test suite for error handling, protocol failures, and edge cases
 * - Command errors (wrong arguments, invalid syntax)
 * - Protocol parsing failures
 * - Null/undefined/invalid input handling
 * - Type errors
 * - Edge cases
 */
describe.skipIf(!isEnabled)("Valkey: Error Handling", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });
  describe("Command Errors", () => {
    test("should handle invalid command arguments", async () => {
      const client = ctx.redis;

      // Wrong number of arguments

      expect(async () => await client.send("SET", ["key"])).toThrowErrorMatchingInlineSnapshot(
        `"ERR wrong number of arguments for 'set' command"`,
      ); // Missing value argument
      expect(async () => await client.send("INVALID_COMMAND", ["a"])).toThrowErrorMatchingInlineSnapshot(
        `"ERR unknown command 'INVALID_COMMAND', with args beginning with: 'a' "`,
      ); // Invalid command
    });

    describe("should handle special character keys and values", async () => {
      // Keys with special characters
      const specialKeys = [
        "key with spaces",
        "key\nwith\nnewlines",
        "key\twith\ttabs",
        "key:with:colons",
        "key-with-unicode-♥-❤-★",
      ];

      // Values with special characters
      const specialValues = [
        "value with spaces",
        "value\nwith\nnewlines",
        "value\twith\ttabs",
        "value:with:colons",
        "value-with-unicode-♥-❤-★",
        // RESP protocol special characters
        "+OK\r\n",
        "-ERR\r\n",
        "$5\r\nhello\r\n",
        "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n",
      ];

      for (const key of specialKeys) {
        for (const value of specialValues) {
          const testKey = `special-key-${randomUUIDv7()}`;
          test(`should handle special characters in key "${key}" and value "${value}"`, async () => {
            const client = ctx.redis;
            // Set and get should work with special characters
            await client.set(testKey, value);
            const result = await client.get(testKey);
            expect(result).toBe(value);
          });
        }
      }
    });
  });

  describe("Null/Undefined/Invalid Input Handling", () => {
    test("should handle undefined/null command arguments", async () => {
      const client = ctx.redis;

      // undefined key
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.get(undefined)).toThrowErrorMatchingInlineSnapshot(
        `"Expected key to be a string or buffer for 'get'."`,
      );

      // null key
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.get(null)).toThrowErrorMatchingInlineSnapshot(
        `"Expected key to be a string or buffer for 'get'."`,
      );

      // undefined value
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.set("valid-key", undefined)).toThrowErrorMatchingInlineSnapshot(
        `"Expected value to be a string or buffer or number for 'set'."`,
      );

      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.set("valid-key", null)).toThrowErrorMatchingInlineSnapshot(
        `"Expected value to be a string or buffer or number for 'set'."`,
      );
    });

    test("should handle invalid sendCommand inputs", async () => {
      const client = ctx.redis;

      // Undefined command
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.send(undefined, [])).toThrowErrorMatchingInlineSnapshot(
        `"ERR unknown command 'undefined'"`,
      );

      // Invalid args type
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.send("GET", "not-an-array")).toThrowErrorMatchingInlineSnapshot(
        `"Arguments must be an array"`,
      );

      // Non-string command
      // @ts-expect-error: Testing runtime behavior with invalid types
      expect(async () => await client.send(123, [])).toThrowErrorMatchingInlineSnapshot(`"ERR unknown command '123'"`);
    });
  });

  describe("Protocol and Parser Edge Cases", () => {
    test("should handle various data types correctly", async () => {
      const client = ctx.redis;

      // Integer/string conversions
      await client.set("int-key", "42");

      // INCR should return as number
      const incrResult = await client.incr("int-key");
      expect(typeof incrResult).toBe("number");
      expect(incrResult).toBe(43);

      // GET should return as string
      const getResult = await client.get("int-key");
      expect(typeof getResult).toBe("string");
      expect(getResult).toBe("43");

      // Boolean handling for EXISTS command
      await client.set("exists-key", "value");
      const existsResult = await client.exists("exists-key");
      expect(typeof existsResult).toBe("boolean");
      expect(existsResult).toBe(true);

      const notExistsResult = await client.exists("not-exists-key");
      expect(typeof notExistsResult).toBe("boolean");
      expect(notExistsResult).toBe(false);

      // Null handling for non-existent keys
      const nullResult = await client.get("not-exists-key");
      expect(nullResult).toBeNull();
    });

    test("should handle complex RESP3 types", async () => {
      const client = ctx.redis;

      // HGETALL returns object in RESP3
      const hashKey = `hash-${randomUUIDv7()}`;
      await client.send("HSET", [hashKey, "field1", "value1", "field2", "value2"]);

      const hashResult = await client.send("HGETALL", [hashKey]);

      // Hash results should be objects in RESP3
      expect(typeof hashResult).toBe("object");
      expect(hashResult).not.toBeNull();

      if (hashResult !== null) {
        expect(hashResult.field1).toBe("value1");
        expect(hashResult.field2).toBe("value2");
      }

      // Error type handling
      expect(async () => await client.send("HGET", [])).toThrowErrorMatchingInlineSnapshot(
        `"ERR wrong number of arguments for 'hget' command"`,
      ); // Missing key and field

      // NULL handling from various commands
      const nullResult = await client.send("HGET", [hashKey, "nonexistent"]);
      expect(nullResult).toBeNull();
    });

    test("should handle RESP protocol boundaries", async () => {
      const client = ctx.redis;

      // Mix of command types to stress protocol parser
      const commands = [
        client.set("key1", "value1"),
        client.get("key1"),
        client.send("PING", []),
        client.incr("counter"),
        client.exists("key1"),
        client.send("HSET", ["hash", "field", "value"]),
        client.send("HGETALL", ["hash"]),
        client.set("key2", "x".repeat(1000)), // Larger value
        client.get("key2"),
      ];

      // Run all commands in parallel to stress protocol handling
      await Promise.all(commands);

      // Verify data integrity

      expect(await client.get("key1")).toBe("value1");
      expect(await client.exists("key1")).toBe(true);
      expect(await client.get("key2")).toBe("x".repeat(1000));
      expect(await client.send("HGET", ["hash", "field"])).toBe("value");
    });
  });

  describe("Resource Management and Edge Cases", () => {
    test("should handle very large number of parallel commands", async () => {
      const client = ctx.redis;

      // Create a large number of parallel commands
      const parallelCount = 1000;
      const commands: Promise<"OK">[] = [];

      for (let i = 0; i < parallelCount; i++) {
        const key = `parallel-key-${i}`;
        commands.push(client.set(key, `value-${i}`));
      }

      // Execute all in parallel
      await Promise.all(commands);

      // Verify some random results
      for (let i = 0; i < 10; i++) {
        const index = Math.floor(Math.random() * parallelCount);
        const key = `parallel-key-${index}`;
        const value = await client.get(key);
        expect(value).toBe(`value-${index}`);
      }
    });

    test("should handle many rapid sequential commands", async () => {
      const client = ctx.redis;

      // Create many sequential commands
      const sequentialCount = 500;

      for (let i = 0; i < sequentialCount; i++) {
        const key = `sequential-key-${i}`;
        await client.set(key, `value-${i}`);

        // Periodically verify to ensure integrity
        if (i % 50 === 0) {
          const value = await client.get(key);
          expect(value).toBe(`value-${i}`);
        }
      }
    });

    test("should handle command after disconnect and reconnect", async () => {
      const client = ctx.redis;

      // Set initial value
      const key = `reconnect-key-${randomUUIDv7()}`;
      await client.set(key, "initial-value");

      // Disconnect explicitly
      client.close();

      // This command should fail
      expect(async () => await client.get(key)).toThrowErrorMatchingInlineSnapshot(`"Connection has failed"`);
    });

    test("should handle binary data", async () => {
      // Binary data in both keys and values
      const client = ctx.redis;

      // Create Uint8Array with binary data
      const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254, 253, 252]);
      const binaryString = String.fromCharCode(...binaryData);

      await client.set("binary-key", binaryString);

      // Get it back
      const result = await client.get("binary-key");

      // Compare binary data
      expect(result).toBe(binaryString);
    });
  });
});

describe("Valkey: Command Arguments", () => {
  type Call = [method: string, ...args: unknown[]];
  const show = (arg: unknown) => (arg instanceof String ? `new String("${arg}")` : Bun.inspect(arg, { compact: true }));
  const title = ([method, ...args]: Call) => `${method}(${args.map(show).join(", ")})`;
  const run = (client: RedisClient, [method, ...args]: Call) => (client as any)[method](...args);

  /** A client of a server that acknowledges SUBSCRIBE, has the replies below and answers anything else with `otherwise`. */
  async function connect(url = (port: number): string | URL => `redis://127.0.0.1:${port}`, otherwise = ":1\r\n") {
    const received: string[][] = [];
    const state = { buffer: Buffer.alloc(0) };
    const replies: Record<string, string> = {
      HELLO: "+OK\r\n",
      SUBSCRIBE: ">3\r\n$9\r\nsubscribe\r\n$2\r\nch\r\n:1\r\n",
      GET: "$1\r\nv\r\n",
      SELECT: "+OK\r\n",
      MULTI: "+OK\r\n",
      EXEC: "*4\r\n$1\r\nv\r\n$1\r\nv\r\n$1\r\nv\r\n%1\r\n$1\r\n\xff\r\n:1\r\n",
    };
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          state.buffer = Buffer.concat([state.buffer, data]);
          for (const command of readCommands(state)) {
            received.push(command);
            socket.write(Buffer.from(replies[command[0]] ?? otherwise, "latin1"));
            if (command[0] === "MULTI") replies.GET = otherwise;
          }
        },
      },
    });
    const client = new RedisClient(url(server.port));
    await client.connect();
    return {
      client,
      received,
      lastReceived: () => received.at(-1),
      [Symbol.dispose]() {
        client.close();
        server.stop(true);
      },
    };
  }

  const sent: { call: Call; sends: string[]; resolves: unknown }[] = [
    { call: ["dbsize", "ignored"], sends: ["DBSIZE"], resolves: 1 },
    { call: ["get", "k"], sends: ["GET", "k"], resolves: "v" },
    { call: ["getBuffer", "k"], sends: ["GET", "k"], resolves: Buffer.from("v") },
    { call: ["incr", "k"], sends: ["INCR", "k"], resolves: 1 },
    { call: ["decr", "k"], sends: ["DECR", "k"], resolves: 1 },
    { call: ["ttl", "k"], sends: ["TTL", "k"], resolves: 1 },
    { call: ["smembers", "k"], sends: ["SMEMBERS", "k"], resolves: 1 },
    { call: ["exists", "k"], sends: ["EXISTS", "k"], resolves: true },
    { call: ["sismember", "k", "m"], sends: ["SISMEMBER", "k", "m"], resolves: true },
    { call: ["hexists", "k", "f"], sends: ["HEXISTS", "k", "f"], resolves: true },
    { call: ["hsetnx", "k", "f", 2], sends: ["HSETNX", "k", "f", "2"], resolves: true },
    { call: ["smove", "a", "b", "m"], sends: ["SMOVE", "a", "b", "m"], resolves: true },
    { call: ["lrange", "k", 0, -1], sends: ["LRANGE", "k", "0", "-1"], resolves: 1 },
    { call: ["mset", "a", "", "b", 2], sends: ["MSET", "a", "", "b", "2"], resolves: 1 },
    { call: ["lpush", "k", "a", undefined, "b"], sends: ["LPUSH", "k", "a", "b"], resolves: 1 },
    { call: ["del", "a", null, "b"], sends: ["DEL", "a", "b"], resolves: 1 },
    { call: ["sadd", "k", "a", null, "b"], sends: ["SADD", "k", "a", "b"], resolves: 1 },
    { call: ["srem", "k", "a", "b"], sends: ["SREM", "k", "a", "b"], resolves: 1 },
    { call: ["srem", "k", undefined, "a", "b"], sends: ["SREM", "k", "a", "b"], resolves: 1 },
    { call: ["spop", "k"], sends: ["SPOP", "k"], resolves: 1 },
    { call: ["srandmember", "k", 2, 3], sends: ["SRANDMEMBER", "k", "2"], resolves: 1 },
    { call: ["hincrby", "k", false, new Number(2)], sends: ["HINCRBY", "k", "false", "2"], resolves: 1 },
    { call: ["hincrbyfloat", "k", "f", 1.5], sends: ["HINCRBYFLOAT", "k", "f", "1.5"], resolves: 1 },
    { call: ["publish", new String("ch"), "m"], sends: ["PUBLISH", "ch", "m"], resolves: 1 },
    { call: ["publish", "ch", Buffer.of(0xff, 0)], sends: ["PUBLISH", "ch", "\xff\0"], resolves: 1 },
    { call: ["publish", "ch", new Blob(["m"])], sends: ["PUBLISH", "ch", "m"], resolves: 1 },
    { call: ["publish", "ch", 1], sends: ["PUBLISH", "ch", "1"], resolves: 1 },
    { call: ["set", "k", "v", "NX", undefined, null], sends: ["SET", "k", "v", "NX"], resolves: 1 },
    { call: ["set", "k", new Blob(["v"])], sends: ["SET", "k", "v"], resolves: 1 },
    { call: ["set", "k", new Blob([])], sends: ["SET", "k", ""], resolves: 1 },
    { call: ["hmget", "k", "a", "b", undefined], sends: ["HMGET", "k", "a", "b"], resolves: 1 },
    { call: ["mget", "a", "b", null, undefined], sends: ["MGET", "a", "b"], resolves: 1 },
    { call: ["zmscore", "k", "a", undefined], sends: ["ZMSCORE", "k", "a"], resolves: 1 },
    { call: ["set", "k", "v", undefined, "0"], sends: ["SET", "k", "v"], resolves: 1 },
    { call: ["set", "k", "v", undefined, ""], sends: ["SET", "k", "v"], resolves: 1 },
    { call: ["set", "k", "v", "EX", 60, null, "old value"], sends: ["SET", "k", "v", "EX", "60"], resolves: 1 },
    { call: ["hincrby", "k", "f", Uint8Array.of(5)], sends: ["HINCRBY", "k", "f", "5"], resolves: 1 },
    { call: ["set", "k", "v", undefined, 0], sends: ["SET", "k", "v"], resolves: 1 },
    { call: ["set", "k", "v", undefined, false], sends: ["SET", "k", "v"], resolves: 1 },
    { call: ["set", "k", "v", undefined, NaN], sends: ["SET", "k", "v"], resolves: 1 },
    { call: ["hscan", "k", 0, undefined, null, "COUNT", 9], sends: ["HSCAN", "k", "0", "COUNT", "9"], resolves: 1 },
    { call: ["zrank", "k", "a", undefined, "WITHSCORE"], sends: ["ZRANK", "k", "a", "WITHSCORE"], resolves: 1 },
    { call: ["zrevrank", "k", "a", undefined, "WITHSCORE"], sends: ["ZREVRANK", "k", "a", "WITHSCORE"], resolves: 1 },
    { call: ["hrandfield", "k", undefined, 2], sends: ["HRANDFIELD", "k", "2"], resolves: 1 },
    { call: ["zrandmember", "k", undefined, 2], sends: ["ZRANDMEMBER", "k", "2"], resolves: 1 },
    { call: ["zrangebylex", "k", "-", undefined, "+"], sends: ["ZRANGEBYLEX", "k", "-", "+"], resolves: 1 },
    { call: ["zrevrangebylex", "k", "+", undefined, "-"], sends: ["ZREVRANGEBYLEX", "k", "+", "-"], resolves: 1 },
    { call: ["lpop", "k", undefined, 2], sends: ["LPOP", "k", "2"], resolves: 1 },
    { call: ["rpop", "k", undefined, 2], sends: ["RPOP", "k", "2"], resolves: 1 },
    { call: ["zpopmin", "k", undefined, 2], sends: ["ZPOPMIN", "k", "2"], resolves: 1 },
    { call: ["zpopmax", "k", undefined, 2], sends: ["ZPOPMAX", "k", "2"], resolves: 1 },
    { call: ["bitcount", "k", 0], sends: ["BITCOUNT", "k"], resolves: 1 },
    { call: ["increx", "k", undefined, "BYINT", 5], sends: ["INCREX", "k", "BYINT", "5"], resolves: 1 },
    { call: ["hset", "k", "f", undefined], sends: ["HSET", "k", "f", "undefined"], resolves: 1 },
    { call: ["hset", "k", { f: null }], sends: ["HSET", "k", "f", "null"], resolves: 1 },
    { call: ["hmset", "k", ["f", null]], sends: ["HMSET", "k", "f", "null"], resolves: 1 },
    { call: ["hset", Buffer.of(0xff), "f", "v"], sends: ["HSET", "\xff", "f", "v"], resolves: 1 },
    { call: ["hset", "k", Buffer.of(0xff), "v"], sends: ["HSET", "k", "\xff", "v"], resolves: 1 },
    { call: ["hset", "k", new Blob(["f"]), "v"], sends: ["HSET", "k", "f", "v"], resolves: 1 },
    { call: ["hset", "k", "f", Uint8Array.of(7, 0xff)], sends: ["HSET", "k", "f", "\x07\xff"], resolves: 1 },
    { call: ["hset", "k", "f", new Uint8Array(0)], sends: ["HSET", "k", "f", ""], resolves: 1 },
    { call: ["hset", "k", "f", new ArrayBuffer(0)], sends: ["HSET", "k", "f", ""], resolves: 1 },
    { call: ["hset", "k", { f: Buffer.of(0xff, 0, 0x41) }], sends: ["HSET", "k", "f", "\xff\0A"], resolves: 1 },
    { call: ["hset", "k", { f: new Blob(["v"]) }], sends: ["HSET", "k", "f", "v"], resolves: 1 },
    {
      call: ["hset", "k", { a: true, b: 1n, c: ["x", "y"], d: new String("s") }],
      sends: ["HSET", "k", "a", "true", "b", "1", "c", "x,y", "d", "s"],
      resolves: 1,
    },
    { call: ["hmset", "k", [Buffer.of(0xfe), Buffer.of(0xff)]], sends: ["HMSET", "k", "\xfe", "\xff"], resolves: 1 },
    { call: ["hincrby", "k", Buffer.of(0xff), 1n], sends: ["HINCRBY", "k", "\xff", "1"], resolves: 1 },
    { call: ["hincrbyfloat", Buffer.of(0xff), "f", 1], sends: ["HINCRBYFLOAT", "\xff", "f", "1"], resolves: 1 },
  ];
  for (const { call, sends, resolves } of sent) {
    test(`${title(call)} sends ${JSON.stringify(sends)}`, async () => {
      using server = await connect();
      expect(await run(server.client, call)).toEqual(resolves);
      expect(server.lastReceived()).toEqual(sends);
    });
  }

  const refused: { call: Call; throws: string }[] = [
    { call: ["getBuffer"], throws: "Expected key to be a string or buffer for 'getBuffer'." },
    { call: ["sismember", "k", {}], throws: "Expected value to be a string or buffer for 'sismember'." },
    { call: ["hexists", "k", null], throws: "Expected field to be a string or buffer for 'hexists'." },
    { call: ["hsetnx", "k", "f"], throws: "Expected value to be a string or buffer for 'hsetnx'." },
    { call: ["smove", "a", {}, {}], throws: "Expected destination to be a string or buffer for 'smove'." },
    { call: ["mset", "a", null], throws: "Expected additional arguments to be a string or buffer for 'mset'." },
    { call: ["lpush", "k", {}], throws: "Expected additional arguments to be a string or buffer for 'lpush'." },
    { call: ["del", null, "b"], throws: 'The "key" argument must be specified' },
    { call: ["lpush", undefined, "a", "b"], throws: 'The "key" argument must be specified' },
    { call: ["lpushx", null, "a", "b"], throws: 'The "key" argument must be specified' },
    { call: ["rpush", undefined, "a", "b"], throws: 'The "key" argument must be specified' },
    { call: ["rpushx", null, "a", "b"], throws: 'The "key" argument must be specified' },
    { call: ["zmscore", undefined, "a", "b"], throws: 'The "key" argument must be specified' },
    { call: ["hincrby", null, "f", 1], throws: "Expected key to be a string or buffer for 'hincrby'." },
    { call: ["hincrby", "k", undefined, 1], throws: "Expected field to be a string or buffer for 'hincrby'." },
    { call: ["hincrbyfloat", "k", "f"], throws: "Expected increment to be a number or string for 'hincrbyfloat'." },
    { call: ["sadd", {}], throws: "SADD requires at least a key and one member" },
    { call: ["srem", "k"], throws: "SREM requires at least a key and one member" },
    { call: ["srem", "k", {}], throws: "Expected member to be a string or buffer for 'srem'." },
    { call: ["spop"], throws: "Expected key to be a string or buffer for 'spop'." },
    { call: ["srandmember", "k", {}], throws: "Expected count to be a number or string for 'srandmember'." },
    { call: ["publish", 1, 2], throws: "Expected channel to be a string for 'publish'." },
    { call: ["publish", "ch", {}], throws: "Expected message to be a string or buffer for 'publish'." },
    { call: ["set", "k", "v", undefined, "NX"], throws: "set() cannot send NX after a null or undefined argument" },
    { call: ["set", "k", "v", undefined, undefined, "xx"], throws: "set() cannot send XX after" },
    { call: ["set", "k", "v", undefined, 0, "GET"], throws: "set() cannot send GET after" },
    { call: ["set", "k", "v", null, "EX", 60], throws: "set() cannot send EX after" },
    { call: ["set", "k", "v", "IFEQ", null, "KEEPTTL"], throws: "set() cannot send KEEPTTL after" },
    { call: ["set", "k", "v", "GET", false], throws: "Expected arguments to be a string or buffer for 'set'." },
    {
      call: ["mget", "a", undefined, "c"],
      throws: "Expected additional arguments to be a string or buffer for 'mget'.",
    },
    {
      call: ["zmscore", "k", null, "c"],
      throws: "Expected additional arguments to be a string or buffer for 'zmscore'.",
    },
    { call: ["hmget", "k", "a", null, "b"], throws: "Expected field to be a string or buffer for 'hmget'." },
    { call: ["hset", undefined, "f", "v"], throws: "Expected key to be a string or buffer for 'hset'." },
    { call: ["hset", "k", null, "v"], throws: "Expected field to be a string or buffer for 'hset'." },
    { call: ["hmset", "k", [null, "v"]], throws: "Expected field to be a string or buffer for 'hmset'." },
    { call: ["hset", "k", Buffer.from("f")], throws: "HSET requires at least key, field, and value arguments" },
  ];
  for (const { call, throws } of refused) {
    test(`${title(call)} throws`, async () => {
      using server = await connect();
      expect(() => run(server.client, call)).toThrow(throws);
    });
  }

  const file = Bun.file(import.meta.path);
  const s3 = new S3Client({ endpoint: "http://127.0.0.1:1", accessKeyId: "k", secretAccessKey: "s" }).file("b/o");
  const unread: { name: string; call: Call; throws: string }[] = [
    { name: "set(k, Bun.file())", call: ["set", "k", file], throws: "File blob" },
    { name: "set(k, new Blob([Bun.file()]))", call: ["set", "k", new Blob([file])], throws: "File blob" },
    { name: "set(k, s3.file())", call: ["set", "k", s3], throws: "S3 blob" },
    { name: "set(k, new Blob([s3.file()]))", call: ["set", "k", new Blob([s3])], throws: "S3 blob" },
    { name: "send(SET, [k, Bun.file()])", call: ["send", "SET", ["k", file]], throws: "File blob" },
    { name: "hset(k, f, s3.file())", call: ["hset", "k", "f", s3], throws: "S3 blob" },
  ];
  for (const { name, call, throws } of unread) {
    test(`${name} throws`, async () => {
      using server = await connect();
      expect(() => run(server.client, call)).toThrow(`${throws} cannot be used here`);
    });
  }

  const detached = Uint8Array.of(1);
  detached.buffer.transfer();
  const resizable = new ArrayBuffer(2, { maxByteLength: 2 });
  const outOfBounds = new Uint8Array(resizable, 1, 1);
  resizable.resize(0);
  const gone: { name: string; call: Call }[] = [
    { name: "hset(k, f, detached)", call: ["hset", "k", "f", detached] },
    { name: "hset(k, detached, v)", call: ["hset", "k", detached, "v"] },
    { name: "hset(k, f, outOfBounds)", call: ["hset", "k", "f", outOfBounds] },
    { name: "hincrby(k, detached, 1)", call: ["hincrby", "k", detached, 1] },
  ];
  for (const { name, call } of gone) {
    test(`${name} throws`, async () => {
      using server = await connect();
      expect(() => run(server.client, call)).toThrow("Underlying ArrayBuffer has been detached");
    });
  }

  const [bytes, v, ff] = [{ buffer: true }, Buffer.from("v"), Buffer.of(0xff)];
  class Upload extends Blob {
    buffer() {}
  }
  const withOption: { call: Call; sends: string[]; resolves: unknown }[] = [
    { call: ["get", "k", bytes], sends: ["GET", "k"], resolves: v },
    { call: ["get", "k", { buffer: false }], sends: ["GET", "k"], resolves: "v" },
    { call: ["get", "k", {}], sends: ["GET", "k"], resolves: "v" },
    { call: ["get", "k", undefined], sends: ["GET", "k"], resolves: "v" },
    { call: ["get", "k", 0, ["k"]], sends: ["GET", "k"], resolves: "v" },
    { call: ["get", "k", Buffer.from("x")], sends: ["GET", "k"], resolves: "v" },
    { call: ["get", "proxy", new Proxy(bytes, {})], sends: ["GET", "proxy"], resolves: v },
    { call: ["get", "k", Object.assign(() => {}, bytes)], sends: ["GET", "k"], resolves: v },
    { call: ["get", "k", Object.create(bytes)], sends: ["GET", "k"], resolves: v },
    { call: ["get", "k", { other: 1 }], sends: ["GET", "k"], resolves: "v" },
    { call: ["get", "k", () => {}], sends: ["GET", "k"], resolves: "v" },
    { call: ["getdel", "k", bytes, true], sends: ["GETDEL", "k"], resolves: v },
    { call: ["getdel", "k", undefined, bytes], sends: ["GETDEL", "k"], resolves: "v" },
    { call: ["send", "X", [], bytes, true], sends: ["X"], resolves: v },
    { call: ["spop", "k", 2, bytes, true], sends: ["SPOP", "k", "2"], resolves: v },
    { call: ["set", "k", "x", "GET", undefined, bytes, null], sends: ["SET", "k", "x", "GET"], resolves: v },
    { call: ["hmget", "k", ["a"], bytes, true], sends: ["HMGET", "k", "a"], resolves: v },
    { call: ["hmget", "k", "a", bytes, undefined], sends: ["HMGET", "k", "a"], resolves: v },
    { call: ["mget", "a", bytes, undefined], sends: ["MGET", "a"], resolves: v },
    { call: ["mget", "a", { buffer: undefined }], sends: ["MGET", "a"], resolves: "v" },
    { call: ["mget", "a", new String("b")], sends: ["MGET", "a", "b"], resolves: "v" },
    { call: ["mget", "a", new DataView(new Uint8Array([98]).buffer)], sends: ["MGET", "a", "b"], resolves: "v" },
    { call: ["getBuffer", "k", { buffer: false }], sends: ["GET", "k"], resolves: v },
    { call: ["dump", "k", { buffer: false }], sends: ["DUMP", "k"], resolves: v },
    { call: ["spop", "k", bytes], sends: ["SPOP", "k"], resolves: v },
    { call: ["spop", "k", undefined, bytes], sends: ["SPOP", "k"], resolves: v },
    { call: ["srandmember", "k", 2, bytes], sends: ["SRANDMEMBER", "k", "2"], resolves: v },
    { call: ["send", "X", ["a"], bytes], sends: ["X", "a"], resolves: v },
    { call: ["set", "k", "x", "GET", bytes], sends: ["SET", "k", "x", "GET"], resolves: v },
    { call: ["set", "k", "x", "GET", undefined, bytes], sends: ["SET", "k", "x", "GET"], resolves: v },
    { call: ["hmget", "k", "a", "b", bytes], sends: ["HMGET", "k", "a", "b"], resolves: v },
    { call: ["hmget", "k", ["a", "b"], bytes], sends: ["HMGET", "k", "a", "b"], resolves: v },
    { call: ["mget", "a", undefined, bytes], sends: ["MGET", "a"], resolves: v },
    { call: ["mget", "a", { buffer: false }], sends: ["MGET", "a"], resolves: "v" },
    { call: ["mget", "a", Buffer.from("b")], sends: ["MGET", "a", "b"], resolves: "v" },
    { call: ["mget", "a", new Upload(["b"])], sends: ["MGET", "a", "b"], resolves: "v" },
    { call: ["lpop", "k", 2, bytes], sends: ["LPOP", "k", "2"], resolves: v },
    { call: ["scan", Buffer.from("7"), bytes], sends: ["SCAN", "7"], resolves: v },
    { call: ["hset", "k", bytes], sends: ["HSET", "k", "buffer", "true"], resolves: "v" },
  ];
  for (const { call, sends, resolves } of withOption) {
    test(`${title(call)} resolves with a ${typeof resolves === "string" ? "string" : "buffer"}`, async () => {
      using server = await connect(undefined, "$1\r\nv\r\n");
      expect(await run(server.client, call)).toEqual(resolves);
      expect(server.lastReceived()).toEqual(sends);
    });
  }

  const notAnOption: { call: Call; throws: string }[] = [
    { call: ["get", bytes], throws: "Expected key to be a string or buffer for 'get'." },
    { call: ["get", "k", { buffer: 1 }], throws: '"options.buffer" property must be of type boolean, got number' },
    { call: ["mget", "k", { buffer: null }], throws: '"options.buffer" property must be of type boolean' },
    { call: ["mget", "k", {}], throws: "Expected additional arguments to be a string or buffer for 'mget'." },
    { call: ["scan", 0, { MATCH: "a*", buffer: true }], throws: 'Unknown option "MATCH" beside "buffer"' },
    { call: ["set", "k", "v", { buffer: false, EX: 1 }], throws: 'Unknown option "EX" beside "buffer"' },
    { call: ["set", "k", "v", { EX: 1 }], throws: "Expected arguments to be a string or buffer for 'set'." },
    { call: ["mget", bytes], throws: 'The "key" argument must be specified' },
    { call: ["mget", bytes, "k"], throws: "Expected additional arguments to be a string or buffer for 'mget'." },
    { call: ["eval", "", 0, { id: 1 }], throws: "Expected additional arguments to be a string or buffer for 'eval'." },
    { call: ["rpush", "k", "a", bytes], throws: "Expected additional arguments to be a string or buffer for 'rpush'." },
    { call: ["flushall", bytes], throws: "Expected additional arguments to be a string or buffer for 'flushall'." },
    { call: ["object", "ENCODING", "k", bytes], throws: "to be a string or buffer for 'object'." },
    { call: ["xgroup", "DESTROY", "k", "g", bytes], throws: "to be a string or buffer for 'xgroup'." },
    { call: ["debug", "OBJECT", "k", bytes], throws: "to be a string or buffer for 'debug'." },
    { call: ["sadd", "k", "a", bytes], throws: "Expected member to be a string or buffer for 'sadd'." },
    { call: ["spop", "k", bytes, 5], throws: "Expected count to be a number or string for 'spop'." },
    { call: ["set", "k", bytes], throws: "Expected value to be a string or buffer or number for 'set'." },
    { call: ["set", "k", "v", undefined, "NX", bytes], throws: "set() cannot send NX after a null or undefined" },
    { call: ["hmget", "k", bytes], throws: "HMGET requires at least a key and one field" },
    { call: ["ping", bytes], throws: "Expected message to be a string or buffer for 'ping'." },
    { call: ["send", "X", ["a", bytes]], throws: "Expected argument to be a string or buffer for 'sendCommand'." },
  ];
  for (const { call, throws } of notAnOption) {
    test(`${title(call)} throws`, async () => {
      using server = await connect();
      expect(() => run(server.client, call)).toThrow(throws);
      await server.client.ping();
      expect(server.received).toEqual([["HELLO", "3"], ["PING"]]);
    });
  }

  test("the methods that take { buffer } are those that declare it", async () => {
    const types = await Bun.file(join(import.meta.dir, "../../../../packages/bun-types/redis.d.ts")).text();
    const declared = [...types.matchAll(/^    (\w+)(?:<[^>]*>)?\([^;]*\bReplyOptions\b/gm)].map(match => match[1]);
    using server = await connect(undefined, "$1\r\nv\r\n");
    const taken = ["send"];
    for (const [method, { value }] of Object.entries(Object.getOwnPropertyDescriptors(RedisClient.prototype))) {
      if (typeof value !== "function" || /^(constructor|close|connect|duplicate|\w*subscribe)$/.test(method)) continue;
      if (method === "getBuffer" || method === "dump") continue;
      for (let count = 0; count < 4 && taken.at(-1) !== method; count++) {
        const reply = await (async () => run(server.client, [method, ...Array(count).fill("1"), bytes]))().catch(
          e => e,
        );
        if (Buffer.isBuffer(reply)) taken.push(method);
      }
    }
    expect(taken.sort()).toEqual([...new Set(declared)].sort());
  });

  test.each([
    ["bytes that are not UTF-8", "$2\r\n\xff\0\r\n", Buffer.of(0xff, 0)],
    ["an empty string", "$0\r\n\r\n", Buffer.alloc(0)],
    ["a verbatim string", "=5\r\ntxt:v\r\n", v],
    ["a null string", "$-1\r\n", null],
    ["a status", "+OK\r\n", "OK"],
    ["a big number", "(9007199254740993\r\n", 9007199254740993n],
    ["a big number that is not one", "(x\r\n", "x"],
    ["an array in an array", "*2\r\n*1\r\n$1\r\nv\r\n:1\r\n", [[v], 1]],
    ["a set", "~2\r\n$1\r\nv\r\n+s\r\n", [v, "s"]],
    ["a map", "%1\r\n$1\r\nf\r\n$1\r\nv\r\n", { __proto__: null, f: v }],
    ["a key that is not ASCII", "%1\r\n$2\r\n\xc3\xa9\r\n$1\r\nv\r\n", { __proto__: null, é: v }],
    ["keys that are not strings", "%2\r\n:1\r\n:2\r\n#t\r\n:4\r\n", { __proto__: null, 1: 2, true: 4 }],
  ])("{ buffer: true } with %s", async (_name, reply, expected) => {
    using server = await connect(undefined, reply);
    // As text, a `Buffer` and a plain `Uint8Array` differ.
    expect(Bun.inspect(await server.client.send("X", [], bytes))).toBe(Bun.inspect(expected));
  });

  test("{ buffer: true } in a transaction holds for the result of its command", async () => {
    using server = await connect(undefined, "+QUEUED\r\n");
    const { client } = server;
    await client.send("MULTI", []);
    const queued = [client.getdel("a"), client.getdel("b", bytes), client.getBuffer("c"), client.hgetall("d", bytes)];
    expect(await Promise.all<unknown>(queued)).toEqual(["QUEUED", "QUEUED", Buffer.from("QUEUED"), "QUEUED"]);
    const [a, b, c, d] = await client.send("EXEC", []);
    expect([a, b, c, d.code, d.reply]).toEqual(["v", v, v, "ERR_ENCODING_INVALID_ENCODED_DATA", [[ff, 1]]]);
  });

  test.each([
    ["bytes", "$1\r\n\xff\r\n", ff],
    ["null", "_\r\n", null],
    ["a status", "+QUEUED\r\n", "QUEUED"],
  ])("dump() gives %s", async (_name, reply, expected) => {
    using server = await connect(undefined, reply);
    expect(Bun.inspect(await server.client.dump("k"))).toBe(Bun.inspect(expected));
    expect(server.lastReceived()).toEqual(["DUMP", "k"]);
  });

  test("{ buffer: true } holds for its own reply only", async () => {
    using server = await connect();
    const { client } = server;
    expect(await Promise.all([client.get("k"), client.get("k", bytes), client.get("k")])).toEqual(["v", v, "v"]);
  });

  test.each([
    [
      "at the top",
      "%2\r\n$1\r\n\xff\r\n:1\r\n$1\r\nv\r\n$1\r\nv\r\n",
      [
        [ff, 1],
        [v, v],
      ],
    ],
    ["in an array", "*1\r\n%1\r\n$1\r\n\xff\r\n:1\r\n", [[[ff, 1]]]],
    ["in a map", "%1\r\n+a\r\n~1\r\n%1\r\n=5\r\ntxt:\xff\r\n:1\r\n", [["a", [[[ff, 1]]]]]],
    ["as a status", "%1\r\n+\xff\r\n+OK\r\n", [[ff, "OK"]]],
    ["as a big number", "%1\r\n(\xff\r\n(1\r\n", [[ff, 1n]]],
    ["as an error", "%1\r\n-\xff\r\n:1\r\n", [[ff, 1]]],
    ["in a set as the key", "%1\r\n~1\r\n$1\r\n\xff\r\n:1\r\n", [[[ff], 1]]],
    ["in an array as the key", "%1\r\n*1\r\n$1\r\n\xff\r\n:1\r\n", [[[ff], 1]]],
  ])("{ buffer: true } rejects a key that is not UTF-8 %s", async (_name, reply, pairs) => {
    using server = await connect(undefined, reply);
    const error = await server.client.send("X", [], bytes).then(expect.unreachable, error => error);
    expect([error.code, error.reply]).toEqual(["ERR_ENCODING_INVALID_ENCODED_DATA", pairs]);
    expect(Object.keys(error)).not.toContain("reply");
    expect(Bun.inspect(await server.client.send("X", []), { depth: 9 })).toContain("�");
  });

  test.each([
    ["an array", "%1\r\n*1\r\n:1\r\n:2\r\n", [[[1], 2]]],
    ["a map", "%1\r\n%1\r\n$1\r\nv\r\n:1\r\n:2\r\n", [[[[v, 1]], 2]]],
  ])("{ buffer: true } rejects %s as a key", async (_name, reply, pairs) => {
    using server = await connect(undefined, reply);
    const error = await server.client.scan(0, bytes).then(expect.unreachable, error => error);
    expect([error.code, error.reply]).toEqual(["ERR_ENCODING_INVALID_ENCODED_DATA", pairs]);
  });

  test.each(["scan", "hscan", "sscan", "zscan", "xautoclaim", "send"])("the cursor of %s()", async method => {
    using server = await connect(undefined, "*3\r\n$1\r\n0\r\n*1\r\n$1\r\nv\r\n*1\r\n$1\r\nv\r\n");
    const call: Call = method === "send" ? ["send", "SCAN", [0], bytes] : [method, "k", 0, bytes];
    expect(await run(server.client, call)).toEqual([method === "send" ? Buffer.from("0") : "0", [v], [v]]);
  });

  test.each<Call>([
    ["get", "k"],
    ["mget", "k"],
    ["spop", "k"],
    ["set", "k", "v"],
    ["hmget", "k", "f"],
  ])("the mode is checked before the option of %s()", async (...call) => {
    using server = await connect();
    await server.client.subscribe("c", () => {});
    expect(() => run(server.client, [...call, { buffer: 1 }])).toThrow("cannot be called while in subscriber mode");
  });

  test.each<Call>([
    ["get", "k"],
    ["mget", "k"],
    ["send", "X", []],
  ])("a getter of the option can close the client in %s()", async (...call) => {
    using server = await connect();
    const options = {
      get buffer() {
        server.client.close();
        Bun.gc(true);
        return true;
      },
    };
    expect(await run(server.client, [...call, options]).catch(error => error.code)).toBe("ERR_REDIS_CONNECTION_CLOSED");
    await server.client.connect();
    expect(server.received).toEqual([
      ["HELLO", "3"],
      ["HELLO", "3"],
    ]);
  });

  test("send() sends a buffer as its bytes and a number as text", async () => {
    using server = await connect();
    await server.client.send("SET", ["k", Buffer.of(0xff, 0), "EX", 60]);
    expect(server.lastReceived()).toEqual(["SET", "k", "\xff\0", "EX", "60"]);
  });

  test("a URL object selects the database of its path", async () => {
    using server = await connect(port => new URL(`redis://127.0.0.1:${port}/5`));
    await server.client.ping();
    expect(server.received).toEqual([["HELLO", "3"], ["SELECT", "5"], ["PING"]]);
  });

  // One character is one byte on the wire.
  test.each([
    ["jos%C3%A9:pw", "jos\xc3\xa9", "pw"],
    [":p%40ss%2541+", "default", "p@ss%41+"],
    ["us%00er:p%00w", "us\0er", "p\0w"],
    ["a@b:%zz%4", "a@b", "%zz%4"],
  ])("redis://%s@host logs in as %j with %j", async (credentials, username, password) => {
    using server = await connect(port => `redis://${credentials}@127.0.0.1:${port}`);
    expect(server.received).toEqual([["HELLO", "3", "AUTH", username, password]]);
  });

  test.each([
    ["jos%E9:pw", "username"],
    ["user:p%E9ss", "password"],
    [":%ff%fe", "password"],
    [":%ED%A0%80", "password"],
    [":%C0%AF", "password"],
  ])("redis://%s@host throws for its %s, as decodeURIComponent() does", (credentials, part) => {
    expect(() => decodeURIComponent(credentials)).toThrow(URIError);
    expect(() => new RedisClient(`redis://${credentials}@localhost`)).toThrow(
      expect.objectContaining({
        name: "URIError",
        code: "ERR_INVALID_URI",
        message: `The ${part} in the Redis URL does not decode to UTF-8. Encode it with encodeURIComponent().`,
      }),
    );
  });

  test("Bun.redis throws for such a REDIS_URL", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { Bun.redis } catch (error) { console.log(error.code) }`],
      env: { ...bunEnv, REDIS_URL: "redis://:ab%cd@localhost" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ERR_INVALID_URI\n", stderr: "", exitCode: 0 });
  });

  test("the error for an unknown scheme names every scheme", () => {
    expect(() => new RedisClient("http://localhost")).toThrow(
      "Expected url protocol to be one of redis, valkey, rediss, valkeys, redis+tls, valkey+tls, redis+unix, valkey+unix, redis+tls+unix, valkey+tls+unix",
    );
  });

  // No arguments: the mode is checked before they are.
  for (const method of new Set(sent.map(row => row.call[0]))) {
    test(`${method}() throws in subscriber mode`, async () => {
      using server = await connect();
      await server.client.subscribe("ch", () => {});
      expect(() => run(server.client, [method])).toThrow(
        `RedisClient.prototype.${method} cannot be called while in subscriber mode.`,
      );
    });
  }

  test("pubsub() is sent in subscriber mode", async () => {
    using server = await connect();
    await server.client.subscribe("ch", () => {});
    expect(await run(server.client, ["pubsub", "NUMPAT"])).toBe(1);
    expect(server.lastReceived()).toEqual(["PUBSUB", "NUMPAT"]);
  });

  test("pubsub() takes { buffer } in subscriber mode", async () => {
    using server = await connect(undefined, "*1\r\n$1\r\n\xff\r\n");
    await server.client.subscribe("ch", () => {});
    expect(await server.client.pubsub("CHANNELS", { buffer: true })).toEqual([ff]);
    expect(server.lastReceived()).toEqual(["PUBSUB", "CHANNELS"]);
  });

  test("arguments convert in order and stop at the first that is refused", async () => {
    using server = await connect();
    const converted: string[] = [];
    const logged = (text: string) =>
      Object.assign(new String(text), {
        toString() {
          converted.push(text);
          return text;
        },
      });
    await run(server.client, ["smove", logged("a"), logged("b"), logged("c")]);
    expect(() => run(server.client, ["smove", logged("d"), {}, logged("e")])).toThrow("Expected destination");
    expect(converted).toEqual(["a", "b", "c", "d"]);
  });
});
