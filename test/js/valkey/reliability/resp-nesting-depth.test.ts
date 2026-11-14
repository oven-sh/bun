import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import net from "net";

/**
 * Count the number of complete RESP commands in a buffer.
 * Each command starts with '*' (array) followed by the element count.
 * We count top-level '*' markers that begin a new command frame.
 */
function countRespCommands(data: Buffer): number {
  const str = data.toString();
  let count = 0;
  let pos = 0;
  while (pos < str.length) {
    if (str[pos] === "*") {
      count++;
      // Skip past this command: find the array length line
      const crlfIdx = str.indexOf("\r\n", pos);
      if (crlfIdx === -1) break;
      const arrayLen = parseInt(str.substring(pos + 1, crlfIdx), 10);
      if (isNaN(arrayLen) || arrayLen < 0) break;
      // Skip past arrayLen bulk-string elements (each is $<len>\r\n<data>\r\n)
      let elemPos = crlfIdx + 2;
      for (let i = 0; i < arrayLen; i++) {
        if (elemPos >= str.length || str[elemPos] !== "$") break;
        const lenEnd = str.indexOf("\r\n", elemPos);
        if (lenEnd === -1) break;
        const bulkLen = parseInt(str.substring(elemPos + 1, lenEnd), 10);
        if (isNaN(bulkLen) || bulkLen < 0) break;
        elemPos = lenEnd + 2 + bulkLen + 2; // skip $<len>\r\n<data>\r\n
      }
      pos = elemPos;
    } else {
      pos++;
    }
  }
  return count;
}

/**
 * Creates a minimal mock Redis server that parses incoming RESP command
 * frames. The first command (HELLO handshake) gets +OK; each subsequent
 * command receives the next crafted payload (the last one is repeated when
 * there are more commands than payloads). Handles the case where multiple
 * commands arrive in a single TCP chunk.
 */
function createMockRedisServer(payload: Buffer | Buffer[]): Promise<{ server: net.Server; port: number }> {
  const payloads = Array.isArray(payload) ? payload : [payload];
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => {
      let commandsSeen = 0;

      socket.on("data", (data: Buffer) => {
        const numCmds = countRespCommands(data);
        for (let i = 0; i < numCmds; i++) {
          if (commandsSeen === 0) {
            // Respond to HELLO handshake with a simple OK
            socket.write("+OK\r\n");
          } else {
            // Each subsequent command gets the next crafted payload
            socket.write(payloads[Math.min(commandsSeen - 1, payloads.length - 1)]);
          }
          commandsSeen++;
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
        expect(error.code).toBe("ERR_REDIS_INVALID_RESPONSE");
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

        // Count top-level RESP command frames in a buffer
        function countRespCommands(data) {
          const str = data.toString();
          let count = 0, pos = 0;
          while (pos < str.length) {
            if (str[pos] === "*") {
              count++;
              const crlfIdx = str.indexOf("\\r\\n", pos);
              if (crlfIdx === -1) break;
              const arrayLen = parseInt(str.substring(pos + 1, crlfIdx), 10);
              if (isNaN(arrayLen) || arrayLen < 0) break;
              let elemPos = crlfIdx + 2;
              for (let i = 0; i < arrayLen; i++) {
                if (elemPos >= str.length || str[elemPos] !== "$") break;
                const lenEnd = str.indexOf("\\r\\n", elemPos);
                if (lenEnd === -1) break;
                const bulkLen = parseInt(str.substring(elemPos + 1, lenEnd), 10);
                if (isNaN(bulkLen) || bulkLen < 0) break;
                elemPos = lenEnd + 2 + bulkLen + 2;
              }
              pos = elemPos;
            } else { pos++; }
          }
          return count;
        }

        const server = net.createServer(socket => {
          let cmdsSeen = 0;
          socket.on("data", (data) => {
            const n = countRespCommands(data);
            for (let i = 0; i < n; i++) {
              if (cmdsSeen === 0) {
                socket.write("+OK\\r\\n");
              } else {
                socket.write(payload);
              }
              cmdsSeen++;
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

describe("Valkey: RESP line-terminated replies (>512KB)", () => {
  // The Zig parser scanned for CRLF over the whole buffer. A later hardening
  // pass capped the scan window at 512KB, which rejects valid RESP simple
  // strings and error replies that a real server emits (Lua
  // redis.status_reply(...) / redis.error_reply(...) with a long payload).
  // https://redis.io/docs/latest/develop/reference/protocol-spec/ places no
  // length limit on `+` / `-` lines.

  async function roundtrip(payload: Buffer): Promise<any> {
    const { server, port } = await createMockRedisServer([payload, Buffer.from("+PONG\r\n")]);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
      });
      try {
        const reply = await client.send("PING", []);
        // The client must still be usable for the next command: a parse
        // failure here used to latch `failed` and reject forever.
        const pong = await client.send("PING", []);
        return { reply, pong };
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  }

  test("accepts a simple string (`+`) reply longer than 512KB", async () => {
    const body = Buffer.alloc(600_000, "x").toString();
    const { reply, pong } = await roundtrip(Buffer.from(`+${body}\r\n`));
    expect(typeof reply).toBe("string");
    expect(reply.length).toBe(600_000);
    expect(pong).toBe("PONG");
  });

  test("accepts a simple string at exactly 512KB + 1 bytes", async () => {
    // 524288 worked, 524289 was rejected by an off-by-one in the scan window.
    const body = Buffer.alloc(512 * 1024 + 1, "y").toString();
    const { reply, pong } = await roundtrip(Buffer.from(`+${body}\r\n`));
    expect(reply.length).toBe(512 * 1024 + 1);
    expect(pong).toBe("PONG");
  });

  test("surfaces an error (`-`) reply longer than 512KB with its original text", async () => {
    const body = "ERR user_script:1: " + Buffer.alloc(600_000, "e").toString();
    const { server, port } = await createMockRedisServer([Buffer.from(`-${body}\r\n`), Buffer.from("+PONG\r\n")]);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
      });
      try {
        const rejection = await client.send("EVAL", ["script", "0"]).then(
          () => null,
          (e: any) => e,
        );
        expect(rejection?.message).toBe(body);
        // Client must survive and serve the next command.
        expect(await client.send("PING", [])).toBe("PONG");
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  });
});

describe("Valkey: RESP push frame routing", () => {
  test("resolves a pending command with its own reply when an out-of-band push frame precedes it", async () => {
    const payload = Buffer.from(
      ">4\r\n$8\r\npmessage\r\n$7\r\npattern\r\n$7\r\nchannel\r\n$7\r\npayload\r\n" + "+PONG\r\n",
    );

    const { server, port } = await createMockRedisServer(payload);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 2000,
      });

      try {
        const result = await client.send("PING", []);
        expect(result).toBe("PONG");
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  });

  test("a psubscribe ack push consumes its own promise pair without desyncing pipelined replies", async () => {
    const psubscribeAck = Buffer.from(">3\r\n$10\r\npsubscribe\r\n$6\r\nnews.*\r\n:1\r\n");
    const pong = Buffer.from("+PONG\r\n");

    const { server, port } = await createMockRedisServer([psubscribeAck, pong]);
    try {
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 2000,
      });

      try {
        const psubscribed = (client as any).psubscribe("news.*");
        const pinged = client.send("PING", []);

        expect(await psubscribed).toEqual({ type: "psubscribe", data: ["news.*", 1] });
        expect(await pinged).toBe("PONG");
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  });

  describe("an unsubscribe ack that arrives outside subscriber mode", () => {
    const bulk = (s: string) => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
    const ack = (kind: string, subject: string, remaining: number) =>
      Buffer.from(`>3\r\n${bulk(kind)}${bulk(subject)}:${remaining}\r\n`);
    const ok = Buffer.from("+OK\r\n");

    async function withMockClient(payloads: Buffer[], body: (client: Bun.RedisClient) => Promise<void>) {
      const { server, port } = await createMockRedisServer(payloads);
      const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 2000,
      });
      try {
        await body(client);
      } finally {
        client.close();
        server.close();
      }
    }

    test("resolves the second of two in-flight UNSUBSCRIBEs", async () => {
      // unsubscribe() drops the channel's handlers immediately, so the first ack already exits subscriber mode.
      const payloads = [
        ack("subscribe", "a", 1),
        ack("subscribe", "b", 2),
        ack("unsubscribe", "a", 1),
        ack("unsubscribe", "b", 0),
        ok,
      ];
      await withMockClient(payloads, async client => {
        await client.subscribe("a", () => {});
        await client.subscribe("b", () => {});
        expect(await Promise.all([client.unsubscribe("a"), client.unsubscribe("b")])).toEqual([undefined, undefined]);
        expect(await client.set("key", "value")).toBe("OK");
      });
    });

    test("resolves punsubscribe() on a client that never subscribed", async () => {
      await withMockClient([ack("punsubscribe", "news.*", 0), ok], async client => {
        expect(await client.punsubscribe("news.*")).toEqual({ type: "punsubscribe", data: ["news.*", 0] });
        expect(await client.set("key", "value")).toBe("OK");
      });
    });
  });
});

// A reply whose handler fails is one reply's failure. The client reports it, or rejects the
// request that it answers, and goes on to the replies behind it.
describe("Valkey: a reply that cannot become a JS value", () => {
  const MiB = 1024 * 1024;
  const bulk = (text: string | Buffer) =>
    Buffer.concat([Buffer.from(`$${Buffer.byteLength(text)}\r\n`), Buffer.from(text), Buffer.from("\r\n")]);
  const push = (...parts: Buffer[]) => Buffer.concat([Buffer.from(`>${parts.length}\r\n`), ...parts]);
  const message = (payload: Buffer, channel = bulk("ch")) => push(bulk("message"), channel, payload);
  const confirmation = (kind: string, name: Buffer, count: number) =>
    push(bulk(kind), name, Buffer.from(`:${count}\r\n`));
  // A map whose one key is an empty map. The client makes a null-prototype object of a map and
  // uses each converted key as a property key. A null-prototype object has no primitive value.
  const unconvertible = Buffer.from("%1\r\n%0\r\n:1\r\n");
  const conversionError = "TypeError: No default value";

  // Answers the handshake, waits for `commands` more commands, answers them with ONE write
  // and ends the connection. One write puts the replies in the same read of the client.
  function serveInOneWrite(commands: number, replies: Buffer): Promise<{ server: net.Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => {
        let seen = -1;
        socket.on("data", (data: Buffer) => {
          for (let left = countRespCommands(data); left > 0; left--) {
            if (seen === -1) socket.write("+OK\r\n");
            if (++seen === commands) socket.end(replies);
          }
        });
        socket.on("error", () => {});
      });
      server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
      server.on("error", reject);
    });
  }

  // A subscriber in a child: a message has no promise to reject, so its failure goes to the
  // process. One line per event. With `redial`, the first report closes the client and
  // connects it again.
  async function subscriberEvents(pushes: Buffer[], { redial = false, env = bunEnv } = {}) {
    const subscribed = confirmation("subscribe", bulk("ch"), 1);
    const { server, port } = await serveInOneWrite(1, Buffer.concat([subscribed, ...pushes]));
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const client = new Bun.RedisClient("redis://127.0.0.1:${port}", { autoReconnect: false });
          let redial = ${redial};
          process.on("uncaughtException", e => {
            console.log("uncaughtException " + e.name + ": " + e.message + (e.code ? " [" + e.code + "]" : ""));
            if (!redial) return;
            redial = false;
            client.close();
            client.connect().then(() => {
              console.log("reconnected");
              client.close();
            });
          });
          client.onclose = () => console.log("closed");
          await client.connect();
          await client.subscribe("ch", message =>
            console.log(
              typeof message !== "string"
                ? "message that is a " + typeof message
                : message.length > 64
                  ? "message of length " + message.length
                  : "message " + message,
            ),
          );
          `,
        ],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const events = stdout.trim().split("\n");
      return exitCode === 0 ? { events, exitCode } : { events, exitCode, stderr };
    } finally {
      server.close();
    }
  }

  const followers = [message(bulk("next")), message(bulk("last"))];
  const reported = `uncaughtException ${conversionError}`;

  const undeliverable: [name: string, pushes: Buffer[], before: string[]][] = [
    ["a message", [message(unconvertible)], []],
    ["a channel name", [message(bulk("payload"), unconvertible)], []],
    // The first message does not fit in one read, so what follows it is parsed from the read buffer.
    [
      "a message behind one that is larger than a read",
      [message(bulk(Buffer.alloc(MiB, "x"))), message(unconvertible)],
      [`message of length ${MiB}`],
    ],
  ];
  test.concurrent.each(undeliverable)("%s: reported, and the messages behind it arrive", async (_, pushes, before) => {
    expect(await subscriberEvents([...pushes, ...followers])).toEqual({
      events: [...before, reported, "message next", "message last", "closed"],
      exitCode: 0,
    });
  });

  test.concurrent("a handler that closes the client and connects it again: the old read stops there", async () => {
    expect(await subscriberEvents([message(unconvertible), ...followers], { redial: true })).toEqual({
      events: [reported, "closed", "reconnected", "closed"],
      exitCode: 0,
    });
  });

  test.concurrent.each(["psubscribe", "punsubscribe"] as const)(
    "a %s confirmation: its request rejects, and the reply behind it keeps its own",
    async kind => {
      const { server, port } = await serveInOneWrite(
        2,
        Buffer.concat([confirmation(kind, unconvertible, 0), Buffer.from("+PONG\r\n")]),
      );
      try {
        const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
        try {
          const closed = new Promise<string>(resolve => (client.onclose = () => resolve("closed")));
          const outcome = (request: Promise<unknown>) => request.catch((e: Error) => `${e.name}: ${e.message}`);
          const requests = [outcome((client as any)[kind]("news.*")), outcome(client.send("PING", []))];
          // A request that never settles lets the close win the race.
          expect(await Promise.race([Promise.all(requests), closed])).toEqual([conversionError, "PONG"]);
        } finally {
          client.close();
        }
      } finally {
        server.close();
      }
    },
  );

  // `BUN_JSC_maxSingleAllocationSize` makes every WTF `try*` allocation above the cap return
  // null, the way a refused allocation does. It exists in debug WTF only, and it does not
  // reach the client's read buffer. Each message is over the 4 MiB cap as a JS string:
  // 5 MiB of 8-bit characters, and 3 MiB that one non-Latin-1 character makes 16-bit.
  describe.skipIf(!isDebug)("because its string cannot be allocated", () => {
    test.concurrent.each([
      ["an ASCII", Buffer.alloc(5 * MiB, "a")],
      ["a non-ASCII", Buffer.concat([Buffer.alloc(3 * MiB, "a"), Buffer.from("\u4e2d")])],
    ])("%s message: reported, and the messages behind it arrive", async (_, text) => {
      const env = { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(4 * MiB) };
      expect(await subscriberEvents([message(bulk(text)), ...followers], { env })).toEqual({
        events: ["uncaughtException RangeError: Out of memory", "message next", "message last", "closed"],
        exitCode: 0,
      });
    });
  });
});
