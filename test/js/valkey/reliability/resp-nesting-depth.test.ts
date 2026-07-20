import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
        expect(error.message).toContain("NestingDepthExceeded");
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
        const psubscribed = client.psubscribe("news.*");
        const pinged = client.send("PING", []);

        // psubscribe ack now routes through the subscribe-ack path and resolves
        // with the handler-map count, matching subscribe()'s shape.
        expect(await psubscribed).toEqual(0);
        expect(await pinged).toBe("PONG");
      } finally {
        client.close();
      }
    } finally {
      server.close();
    }
  });

  for (const [label, cmd, ack] of [
    [
      "psubscribe()",
      (c: Bun.RedisClient) => c.psubscribe("news.*"),
      ">3\r\n$10\r\npsubscribe\r\n$6\r\nnews.*\r\n:1\r\n",
    ],
    [
      "send('SSUBSCRIBE', ...)",
      (c: Bun.RedisClient) => c.send("SSUBSCRIBE", ["shard-ch"]),
      ">3\r\n$10\r\nssubscribe\r\n$8\r\nshard-ch\r\n:1\r\n",
    ],
  ] as const) {
    test(`${label} does not enter subscriber mode (get/set still allowed)`, async () => {
      const getReply = Buffer.from("$5\r\nvalue\r\n");
      const { server, port } = await createMockRedisServer([Buffer.from(ack), getReply]);
      try {
        const client = new Bun.RedisClient(`redis://127.0.0.1:${port}`, {
          autoReconnect: false,
          connectionTimeout: 2000,
        });
        try {
          expect(await cmd(client)).toEqual(0);
          // Only `.subscribe(channel, handler)` populates the handler map and
          // flips subscriber mode; pattern/shard acks must not block regular commands.
          expect(await client.get("k")).toBe("value");
        } finally {
          client.close();
        }
      } finally {
        server.close();
      }
    });
  }
});
