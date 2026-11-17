import { RedisClient, type Socket } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { ConnectionType, createClient, ctx, isEnabled, readCommands, testKey } from "../test-utils";

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
        const members: string[] = [];
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
      } catch (error: any) {
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
      } catch (error: any) {
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
      } catch (error: any) {
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
          const promises: Promise<unknown>[] = [];

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
      } catch (error: any) {
        console.warn("Parallel client test failed:", error.message);

        throw error;
      } finally {
        // Clean up clients
        await Promise.all(clients.map(client => client.close()));
      }
    });
  });
});

describe.skipIf(!isEnabled)("Valkey: Pub/Sub on a real server", () => {
  test("listeners are called again after CLIENT KILL, and each request gets its own acknowledgement", async () => {
    const [a, b, c] = ["a", "b", "c"].map(testKey);
    const [client, publisher] = [createClient(ConnectionType.TCP), createClient(ConnectionType.TCP)];
    try {
      const got: string[] = [];
      const id = await client.send("CLIENT", ["ID"]);
      await client.subscribe([a, b], message => void got.push(message));
      const reconnected = new Promise(resolve => (client.onconnect = resolve as () => void));
      await publisher.send("CLIENT", ["KILL", "ID", String(id)]);
      await reconnected;
      await client.ping();
      expect([await publisher.publish(a, "to a"), await publisher.publish(b, "to b")]).toEqual([1, 1]);
      await client.ping();
      expect(got).toEqual(["to a", "to b"]);

      // The first draws two acknowledgements, the others one each.
      const results = [client.unsubscribe(), client.unsubscribe(), client.subscribe(c, () => {}), client.ping()];
      expect(await Promise.all(results)).toEqual([undefined, undefined, 1, "PONG"]);
    } finally {
      client.close();
      publisher.close();
    }
  });
});

describe("Valkey: Pub/Sub", () => {
  type Peer = { buffer: Buffer; id: number; resp2: boolean; channels: Set<string>; patterns: Set<string> };
  const bulk = (text: string) => `$${text.length}\r\n${text}\r\n`;

  /**
   * Keeps subscriptions as Redis does. `override` answers in its place: a string is written, null drops the
   * connection. Strings are latin1, as `readCommands` gives them.
   */
  function pubSubServer(override: (command: string, connection: number) => string | null | void = () => {}) {
    const peers = new Set<Socket<Peer>>();
    const commands: string[][] = [];
    const frame = (peer: Peer, kind: string, name: string | undefined, last: string) =>
      `${peer.resp2 ? "*" : ">"}3\r\n${bulk(kind)}${name === undefined ? "_\r\n" : bulk(name)}${last}`;
    function reply(peer: Peer, [command, ...args]: string[]) {
      const held = command.startsWith("P") ? peer.patterns : peer.channels;
      const ack = (name?: string) =>
        frame(peer, command.toLowerCase(), name, `:${peer.channels.size + peer.patterns.size}\r\n`);
      switch (command) {
        case "SUBSCRIBE":
        case "PSUBSCRIBE":
          return args.map(name => (held.add(name), ack(name))).join("");
        case "UNSUBSCRIBE":
        case "PUNSUBSCRIBE":
          return (args.length ? args : [...held]).map(name => (held.delete(name), ack(name))).join("") || ack();
        case "HELLO":
          peer.resp2 = args[0] === "2";
          return "+OK\r\n";
        case "RESET":
          peer.resp2 = true;
          return "+RESET\r\n";
        case "PING":
          return "+PONG\r\n";
        default:
          return "+OK\r\n";
      }
    }
    const server = Bun.listen<Peer>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          const id = commands.push([]);
          socket.data = { buffer: Buffer.alloc(0), id, resp2: false, channels: new Set(), patterns: new Set() };
          peers.add(socket);
        },
        close: socket => void peers.delete(socket),
        error() {},
        data(socket, chunk) {
          socket.data.buffer = Buffer.concat([socket.data.buffer, chunk]);
          for (const command of readCommands(socket.data)) {
            commands[socket.data.id - 1].push(command.join(" "));
            const answer = override(command.join(" "), socket.data.id);
            if (answer === null) return void socket.end();
            socket.write(Buffer.from(answer ?? reply(socket.data, command), "latin1"));
          }
        },
      },
    });
    return {
      url: `redis://127.0.0.1:${server.port}`,
      /** By connection. */
      commands,
      publish(channel: string, message: string) {
        for (const peer of peers) {
          if (peer.data.channels.has(channel)) {
            peer.write(Buffer.from(frame(peer.data, "message", channel, bulk(message)), "latin1"));
          }
        }
      },
      drop: () => peers.forEach(peer => peer.end()),
      [Symbol.dispose]: () => server.stop(true),
    };
  }

  function subscriber(url: string, options?: Bun.RedisOptions) {
    const client = new RedisClient(url, options);
    const got: string[] = [];
    return {
      // The types declare only some of the calls below.
      client: client as any,
      listener: (name: string) => (message: string, channel: string) => void got.push(`${name} ${channel} ${message}`),
      /** Everything that the server wrote so far has been delivered. */
      delivered: () => client.ping().then(() => got),
      [Symbol.dispose]: () => client.close(),
    };
  }

  const outcome = (call: () => unknown) =>
    Promise.try(call).then(
      value => value,
      error => `${error.code}: ${error.message}`,
    );
  const NOPERM = "-NOPERM No permissions to access a channel\r\n";
  const REFUSED = "ERR_REDIS_SERVER_ERROR: NOPERM No permissions to access a channel";

  test("subscribe() after unsubscribe() from two channels resolves on its own acknowledgement and delivers", async () => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    await sub.client.subscribe(["a", "b"], sub.listener("old"));
    await sub.client.ping();
    await sub.client.unsubscribe();
    const count = await sub.client.subscribe("c", sub.listener("new"));
    await sub.client.ping();
    server.publish("c", "m");
    expect({ count, got: await sub.delivered() }).toEqual({ count: 1, got: ["new c m"] });
  });

  test("psubscribe() behind subscribe([a, b]) resolves on its own acknowledgement", async () => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    expect(await Promise.all([sub.client.subscribe(["a", "b"], () => {}), sub.client.psubscribe("p*")])).toEqual([
      2,
      { type: "psubscribe", data: ["p*", 3] },
    ]);
  });

  test("a subscriber whose subscribe() is refused fails, and connect() restores the other listeners", async () => {
    using server = pubSubServer(command => (command === "SUBSCRIBE a b" ? NOPERM : undefined));
    using sub = subscriber(server.url);
    const same = sub.listener("same");
    await sub.client.subscribe("a", same);
    const results = await Promise.all([
      outcome(() => sub.client.subscribe(["a", "b"], same)),
      outcome(() => sub.client.subscribe("a", sub.listener("later"))),
    ]);
    expect({ results, connected: sub.client.connected }).toEqual({ results: [REFUSED, REFUSED], connected: false });
    await sub.client.connect();
    await sub.client.ping();
    server.publish("a", "m");
    expect({ got: await sub.delivered(), commands: server.commands[1] }).toEqual({
      got: ["same a m"],
      commands: ["HELLO 3", "SUBSCRIBE a", "PING", "PING"],
    });
  });

  test.each<[string, string | null, string]>([
    ["refused", NOPERM, REFUSED],
    ["dropped", null, "ERR_REDIS_CONNECTION_CLOSED: Connection closed"],
  ])("a listener whose subscribe() was %s is called once after the next subscribe()", async (_, answer, rejection) => {
    let requests = 0;
    using server = pubSubServer(command => (command === "SUBSCRIBE a" && ++requests === 1 ? answer : undefined));
    using sub = subscriber(server.url);
    const listener = sub.listener("l");
    expect(await outcome(() => sub.client.subscribe("a", listener))).toBe(rejection);
    await sub.client.subscribe("a", listener);
    server.publish("a", "m");
    expect(await sub.delivered()).toEqual(["l a m"]);
  });

  test.concurrent.each([
    { call: `subscribe("forbidden", () => {})`, stdout: "NOPERM No permissions to access a channel\n" },
    { call: `subscribe(["a", null], () => {})`, stdout: "Expected channel to be a string for 'subscribe'.\n" },
  ])("the process exits after $call fails", async ({ call, stdout }) => {
    using server = pubSubServer(command => (command === "SUBSCRIBE forbidden" ? NOPERM : undefined));
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const client = new Bun.RedisClient("${server.url}");
         try { await client.${call}; } catch (error) { console.log(error.message); }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(output).toEqual([stdout, "", 0]);
  });

  test("unsubscribe([channel, null]) throws before a listener is removed", async () => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    await sub.client.subscribe("a", sub.listener("l"));
    expect(() => sub.client.unsubscribe(["a", null])).toThrow("Expected channel to be a string");
    server.publish("a", "m");
    expect(await sub.delivered()).toEqual(["l a m"]);
  });

  test("a getter in the channels that closes the client leaves no listener", async () => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    await sub.client.connect();
    const channels = Object.defineProperty(["a", "b"], 1, { get: () => (sub.client.close(), "b") });
    expect(await outcome(() => sub.client.subscribe(channels, () => {}))).toStartWith("ERR_REDIS_CONNECTION_CLOSED");
    await sub.client.connect();
    expect(await sub.client.subscribe("c", () => {})).toBe(1);
  });

  test("unsubscribe() cancels a subscribe() that is not acknowledged yet", async () => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    const subscribed = sub.client.subscribe("a", () => {});
    expect(await outcome(() => sub.client.unsubscribe("a"))).toBeUndefined();
    expect([await subscribed, await sub.client.get("k")]).toEqual([0, "OK"]);
  });

  test("get() works once a pattern subscription is lost with the connection", async () => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    await sub.client.psubscribe("p*");
    const reconnected = new Promise(resolve => (sub.client.onconnect = resolve));
    server.drop();
    await reconnected;
    expect(await outcome(() => sub.client.get("k"))).toBe("OK");
    expect(await outcome(() => sub.client.unsubscribe())).toBeUndefined();
  });

  test.each<[string, unknown, string, string]>([
    ["5", 5, "5", "5"],
    ['Buffer.from("b")', Buffer.from("b"), "b", "b"],
    ['"\\ud800"', "\ud800", "\xef\xbf\xbd", "�"],
  ])("subscribe([%s]) delivers", async (_, channel, bytes, text) => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    await sub.client.subscribe([channel], sub.listener("l"));
    server.publish(bytes, "m");
    expect(await sub.delivered()).toEqual([`l ${text} m`]);
  });

  test("a channel that is not UTF-8 throws in subscribe(), and leaves the listeners alone in unsubscribe()", async () => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    await sub.client.subscribe("�", sub.listener("l"));
    const channels = [Buffer.from([0xff])];
    expect(() => sub.client.subscribe(channels, () => {})).toThrow("Expected channel to be a UTF-8 string");
    await sub.client.unsubscribe(channels);
    server.publish("\xef\xbf\xbd", "m");
    expect({ got: await sub.delivered(), commands: server.commands[0] }).toEqual({
      got: ["l � m"],
      commands: ["HELLO 3", "SUBSCRIBE \xef\xbf\xbd", "UNSUBSCRIBE \xff", "PING"],
    });
  });

  test.each<[string, string[]]>([
    ["HELLO", ["2"]],
    ["RESET", []],
  ])("after %s %j, subscribe() fails the connection", async (command, args) => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    await sub.client.send(command, args);
    expect({
      result: await outcome(() => sub.client.subscribe("a", () => {})),
      connected: sub.client.connected,
    }).toEqual({
      result: "ERR_REDIS_INVALID_RESPONSE: Subscriptions need RESP3, but this connection uses RESP2",
      connected: false,
    });
  });

  test.each<[string, (client: any, first: Function) => unknown, string[]]>([
    ["unsubscribe(a, first, undefined)", (client, first) => client.unsubscribe("a", first, undefined), ["second a m"]],
    ["unsubscribe(a, first, true)", (client, first) => client.unsubscribe("a", first, true), ["second a m"]],
    ["unsubscribe(a, first, () => {})", (client, first) => client.unsubscribe("a", first, () => {}), ["second a m"]],
    ["unsubscribe(a, undefined)", client => client.unsubscribe("a", undefined), []],
    ["[a].map(unsubscribe)", client => Promise.all(["a"].map(client.unsubscribe, client)), []],
  ])("%s", async (_, call, expected) => {
    using server = pubSubServer();
    using sub = subscriber(server.url);
    const first = sub.listener("first");
    await sub.client.subscribe("a", first);
    await sub.client.subscribe("a", sub.listener("second"));
    await call(sub.client, first);
    server.publish("a", "m");
    expect(await sub.delivered()).toEqual(expected);
  });

  describe("on a new connection", () => {
    type Server = ReturnType<typeof pubSubServer>;
    const event = (client: any, name: "onconnect" | "onclose") => new Promise<any>(resolve => (client[name] = resolve));
    const drop = (client: any, server: Server) => {
      const reconnected = event(client, "onconnect");
      server.drop();
      return reconnected;
    };

    test.each<[string, string, Bun.RedisOptions, (client: any, server: Server) => Promise<unknown>]>([
      ["a drop", "", {}, drop],
      ["a drop on database 1", "/1", {}, drop],
      ["a raw UNSUBSCRIBE and a drop", "", {}, (c, s) => c.send("UNSUBSCRIBE", ["a"]).then(() => drop(c, s))],
      ["RESET and a drop", "", {}, (c, s) => c.send("RESET", []).then(() => drop(c, s))],
      ["close() and connect()", "", {}, client => (client.close(), client.connect())],
      [
        "a drop without autoReconnect, and connect()",
        "",
        { autoReconnect: false },
        async (client, server) => {
          const closed = event(client, "onclose");
          server.drop();
          await closed;
          await client.connect();
        },
      ],
    ])("listeners are called again after %s", async (_, path, options, reconnect) => {
      using server = pubSubServer();
      using sub = subscriber(server.url + path, options);
      await sub.client.subscribe(["a", "b", "gone"], sub.listener("l"));
      await sub.client.unsubscribe("gone");
      await reconnect(sub.client, server);
      await sub.client.ping();
      for (const channel of ["a", "b", "gone"]) server.publish(channel, "m");
      expect(await sub.delivered()).toEqual(["l a m", "l b m"]);
    });

    test("connect() does not wait for the acknowledgements, and the next command is answered after them", async () => {
      using server = pubSubServer((command, connection) => {
        if (connection === 1) return;
        if (command === "SUBSCRIBE a") return "";
        if (command === "PING") return `>3\r\n${bulk("subscribe")}${bulk("a")}:1\r\n+PONG\r\n`;
      });
      using sub = subscriber(server.url, { enableOfflineQueue: false });
      await sub.client.connect();
      await sub.client.subscribe("a", () => {});
      sub.client.close();
      await sub.client.connect();
      expect({ connected: sub.client.connected, ping: await sub.client.ping(), commands: server.commands[1] }).toEqual({
        connected: true,
        ping: "PONG",
        commands: ["HELLO 3", "SUBSCRIBE a", "PING"],
      });
    });

    test.each([
      ["NOPERM", NOPERM],
      ["BUSY", "-BUSY Redis is busy running a script\r\n"],
      ["OOM", "-OOM command not allowed when used memory > 'maxmemory'.\r\n"],
    ])("%s costs only its channel, until the next connection", async (_, refusal) => {
      using server = pubSubServer((command, connection) =>
        command === "SUBSCRIBE a" && connection === 2 ? refusal : undefined,
      );
      using sub = subscriber(server.url);
      await sub.client.subscribe(["a", "b"], sub.listener("l"));
      for (const message of ["second", "third"]) {
        await drop(sub.client, server);
        await sub.client.ping();
        for (const channel of ["a", "b"]) server.publish(channel, message);
        await sub.delivered();
      }
      expect(await sub.delivered()).toEqual(["l b second", "l a third", "l b third"]);
    });

    test("onconnect may still send the AUTH that the channels need", async () => {
      const authenticated = new Set([1]);
      using server = pubSubServer((command, connection) => {
        if (command === "AUTH user password") authenticated.add(connection);
        if (command === "SUBSCRIBE a" && !authenticated.has(connection)) return NOPERM;
      });
      using sub = subscriber(server.url, { maxRetries: 1 });
      const listener = sub.listener("l");
      await sub.client.subscribe("a", listener);
      const { promise, resolve, reject } = Promise.withResolvers();
      sub.client.onclose = reject;
      sub.client.onconnect = async () => {
        await sub.client.send("AUTH", ["user", "password"]);
        await sub.client.unsubscribe();
        resolve(sub.client.subscribe("a", listener));
      };
      server.drop();
      await promise;
      server.publish("a", "m");
      expect(await sub.delivered()).toEqual(["l a m"]);
    });

    test("onconnect may still send a raw SUBSCRIBE", async () => {
      using server = pubSubServer();
      using sub = subscriber(server.url);
      await sub.client.subscribe("a", sub.listener("l"));
      const { promise, resolve } = Promise.withResolvers();
      sub.client.onconnect = () => resolve(sub.client.send("SUBSCRIBE", ["a"]));
      server.drop();
      expect(await promise).toBe(1);
      server.publish("a", "m");
      expect(await sub.delivered()).toEqual(["l a m"]);
    });

    test("onconnect may still unsubscribe and subscribe again", async () => {
      using server = pubSubServer();
      using sub = subscriber(server.url);
      const listener = sub.listener("l");
      await sub.client.subscribe("a", listener);
      const { promise, resolve } = Promise.withResolvers();
      sub.client.onconnect = () => resolve(sub.client.unsubscribe().then(() => sub.client.subscribe("a", listener)));
      server.drop();
      await promise;
      server.publish("a", "m");
      expect(await sub.delivered()).toEqual(["l a m"]);
    });
  });
});
