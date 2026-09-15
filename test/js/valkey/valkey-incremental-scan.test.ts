import { RedisClient, type Socket, type TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import net from "node:net";

const CRLF = "\r\n";
const bulk = (s: string) => `$${Buffer.byteLength(s)}${CRLF}${s}${CRLF}`;
// Minimal RESP3 HELLO map so the client enters the Connected state.
const HELLO =
  `%3${CRLF}` + bulk("server") + bulk("redis") + bulk("proto") + `:3${CRLF}` + bulk("version") + bulk("7.4.0");

type PerSocket = { buf: Buffer; replied: boolean; unsent: Buffer | null };

/** Writes `reply`; whatever the socket does not take at once goes out on `drain`. */
function writeReply(s: Socket<PerSocket>, reply: string) {
  const bytes = Buffer.from(reply, "latin1");
  s.data.unsent = s.data.unsent ? Buffer.concat([s.data.unsent, bytes]) : bytes;
  flushUnsent(s);
}

function flushUnsent(s: Socket<PerSocket>) {
  const st = s.data;
  if (!st.unsent) return;
  const written = Math.max(0, s.write(st.unsent));
  st.unsent = written < st.unsent.length ? st.unsent.subarray(written) : null;
}

/**
 * Mock server: parses the client's RESP command frames
 * (`*N\r\n($len\r\n...\r\n){N}`) and hands each complete one to `onCommand`.
 */
function createCommandServer(
  onCommand: (fields: string[], s: Socket<PerSocket>) => void,
): TCPSocketListener<PerSocket> {
  return Bun.listen<PerSocket>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        s.data = { buf: Buffer.alloc(0), replied: false, unsent: null };
      },
      drain: flushUnsent,
      error() {},
      close() {},
      data(s, raw) {
        const st = s.data;
        st.buf = Buffer.concat([st.buf, raw]);
        for (;;) {
          const b = st.buf;
          if (!b.length || b[0] !== 0x2a) break;
          const headerEnd = b.indexOf(CRLF);
          if (headerEnd < 0) break;
          const argc = parseInt(b.subarray(1, headerEnd).toString("latin1"), 10);
          let pos = headerEnd + 2;
          const fields: string[] = [];
          let complete = true;
          for (let i = 0; i < argc; i++) {
            const lenEnd = b.indexOf(CRLF, pos);
            if (lenEnd < 0 || b[pos] !== 0x24) {
              complete = false;
              break;
            }
            const len = parseInt(b.subarray(pos + 1, lenEnd).toString("latin1"), 10);
            const next = lenEnd + 2 + len + 2;
            if (next > b.length) {
              complete = false;
              break;
            }
            fields.push(b.subarray(lenEnd + 2, lenEnd + 2 + len).toString("latin1"));
            pos = next;
          }
          if (!complete) break;
          st.buf = b.subarray(pos);
          onCommand(fields, s);
        }
      },
    },
  });
}

/**
 * Mock server: answers HELLO, then answers the first GET with `reply`. When
 * `splitAt` is inside the reply it is split there across two event-loop turns
 * so the client's empty-read-buffer stack path sees a partial frame; "bytes"
 * sends one byte per turn so the reply scanner resumes at every offset.
 * Subsequent commands get `+OK`.
 */
function createReplyServer(
  reply: string,
  splitAt: number | "bytes" = reply.length,
  hello: string = HELLO,
): TCPSocketListener<PerSocket> {
  return createCommandServer((fields, s) => {
    const cmd = fields[0]?.toUpperCase();
    if (cmd === "HELLO") {
      s.write(hello);
    } else if (cmd === "GET" && !s.data.replied) {
      s.data.replied = true;
      if (splitAt === "bytes") {
        const bytes = Buffer.from(reply, "latin1");
        const writeByte = (i: number) => {
          if (i >= bytes.length) return;
          s.write(bytes.subarray(i, i + 1));
          s.flush();
          setImmediate(() => setImmediate(() => writeByte(i + 1)));
        };
        writeByte(0);
      } else {
        writeReply(s, reply.slice(0, splitAt));
        s.flush();
        if (splitAt < reply.length) {
          // Yield twice so the first write reaches the client's `on_data`
          // before the second is sent.
          setImmediate(() => setImmediate(() => writeReply(s, reply.slice(splitAt))));
        }
      }
    } else {
      writeReply(s, `+OK${CRLF}`);
    }
  });
}

async function withClient<T>(server: TCPSocketListener<PerSocket>, body: (client: RedisClient) => Promise<T>) {
  const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
  client.onconnect = client.onclose = () => {};
  try {
    await client.connect();
    return await body(client);
  } finally {
    client.close();
    server.stop(true);
  }
}

type Decoded = { value: unknown } | { rejects: { code: string; message?: string }; connectionFails?: boolean };

// One entry per RESP frame shape the decoder changed. Each is sent whole and
// one byte per socket read, so both the tree parser and the reply scanner see
// every torn prefix.
const FRAMES: [name: string, frame: string, expected: Decoded][] = [
  ["RESP2 null array (*-1)", `*-1${CRLF}`, { value: null }],
  ["RESP2 null array nested in an array", `*2${CRLF}*-1${CRLF}$3${CRLF}abc${CRLF}`, { value: [null, "abc"] }],
  ["RESP2 null bulk string ($-1)", `$-1${CRLF}`, { value: null }],
  ["RESP3 null (_)", `_${CRLF}`, { value: null }],
  [
    "RESP3 null with trailing bytes (_junk)",
    `_junk${CRLF}`,
    { rejects: { code: "ERR_REDIS_INVALID_RESPONSE" }, connectionFails: true },
  ],
  ["big number above 2^53", `(9007199254740993${CRLF}`, { value: 9007199254740993n }],
  ["negative big number", `(-42${CRLF}`, { value: -42n }],
  ["big number with an explicit plus sign", `(+42${CRLF}`, { value: 42n }],
  ["big number above 2^64", `(340282366920938463463374607431768211456${CRLF}`, { value: 2n ** 128n }],
  ["big number with a non-integer payload", `(12abc${CRLF}`, { value: "12abc" }],
  ["big number with a sign and no digits", `(+${CRLF}`, { value: "+" }],
  [
    "simple error (-ERR)",
    `-ERR unknown command${CRLF}`,
    { rejects: { code: "ERR_REDIS_SERVER_ERROR", message: "ERR unknown command" } },
  ],
  [
    "blob error (!)",
    `!21${CRLF}SYNTAX invalid syntax${CRLF}`,
    { rejects: { code: "ERR_REDIS_SERVER_ERROR", message: "SYNTAX invalid syntax" } },
  ],
];

describe.concurrent.each([
  ["whole", (reply: string) => createReplyServer(reply)],
  ["one byte per read", (reply: string) => createReplyServer(reply, "bytes")],
])("Valkey reply decoding, frame sent %s", (_mode, serve) => {
  test.each(FRAMES)("%s", async (_name, frame, expected) => {
    await withClient(serve(frame), async client => {
      const outcome = await client.get("k").then(
        value => ({ value }),
        error => ({ error }),
      );
      if ("value" in expected) {
        expect(outcome).toEqual({ value: expected.value });
        expect(typeof (outcome as { value: unknown }).value).toBe(typeof expected.value);
      } else {
        expect(outcome).toHaveProperty("error");
        const { error } = outcome as { error: Error & { code: string } };
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe(expected.rejects.code);
        if (expected.rejects.message !== undefined) expect(error.message).toBe(expected.rejects.message);
      }
      if (!("connectionFails" in expected && expected.connectionFails)) {
        expect(await client.send("PING", [])).toBe("OK");
      }
    });
  });
});

describe.concurrent("Valkey reply decoding", () => {
  test("big number resolves a Buffer of the digits for getBuffer", async () => {
    const server = createReplyServer(`(9007199254740993${CRLF}`);
    await withClient(server, async client => {
      const value = await client.getBuffer("k");
      expect(value).toBeInstanceOf(Buffer);
      expect(value!.toString()).toBe("9007199254740993");
    });
  });

  test("big number with more digits than a BigInt can hold resolves as a string", async () => {
    // JavaScriptCore caps a BigInt at 2^20 bits, about 313,600 decimal digits.
    // The RESP line limit is far above that.
    const digits = Buffer.alloc(400_000, "7").toString();
    const server = createReplyServer(`(${digits}${CRLF}`);
    await withClient(server, async client => {
      const value = await client.get("k");
      expect(typeof value).toBe("string");
      expect(value).toBe(digits);
      expect(await client.send("PING", [])).toBe("OK");
    });
  });

  test.each([
    ["-", `-NOAUTH nope!${CRLF}`],
    ["!", `!12${CRLF}NOAUTH nope!${CRLF}`],
  ])("error reply (%s) to HELLO rejects queued commands with the server text", async (_kind, hello) => {
    const server = createReplyServer(`+OK${CRLF}`, undefined, hello);
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
    client.onconnect = client.onclose = () => {};
    try {
      // Queued before the handshake finishes, so the rejection carries the
      // HELLO error. connect() itself rejects with a generic "Connection closed".
      const queued = client.get("k").then(
        () => null,
        e => e,
      );
      await client.connect().catch(() => {});
      const err = await queued;
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_REDIS_AUTHENTICATION_FAILED");
      expect(err.message).toBe("NOAUTH nope!");
    } finally {
      client.close();
      server.stop(true);
    }
  });

  test.each([
    ["-", `-WRONGTYPE wrong kind${CRLF}`],
    ["!", `!20${CRLF}WRONGTYPE wrong kind${CRLF}`],
  ])("error reply (%s) nested in an array resolves as an ERR_REDIS_SERVER_ERROR element", async (_kind, element) => {
    const server = createReplyServer(`*2${CRLF}+OK${CRLF}${element}`);
    await withClient(server, async client => {
      const result = (await client.get("k")) as unknown as [string, Error & { code: string }];
      expect(result[0]).toBe("OK");
      expect(result[1]).toBeInstanceOf(Error);
      expect({ code: result[1].code, message: result[1].message }).toEqual({
        code: "ERR_REDIS_SERVER_ERROR",
        message: "WRONGTYPE wrong kind",
      });
      expect(await client.send("PING", [])).toBe("OK");
    });
  });

  test("error reply in subscriber mode fails the connection with ERR_REDIS_SERVER_ERROR", async () => {
    const server = createCommandServer((fields, s) => {
      switch (fields[0]?.toUpperCase()) {
        case "HELLO":
          s.write(HELLO);
          break;
        case "SUBSCRIBE":
          s.write(`>3${CRLF}` + bulk("subscribe") + bulk(fields[1]) + `:1${CRLF}`);
          break;
        default:
          s.write(`-NOPERM no permissions${CRLF}`);
      }
    });
    await withClient(server, async client => {
      await client.subscribe("ch", () => {});
      // A subscriber fails the whole connection on an error reply. The PING
      // that drew the reply is left unsettled (#32858 changes that), so the
      // code is read from the second PING, which is still in flight when the
      // connection fails.
      client.send("PING", []).catch(() => {});
      const err = await client.send("PING", []).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect({ code: err.code, message: err.message }).toEqual({
        code: "ERR_REDIS_SERVER_ERROR",
        message: "NOPERM no permissions",
      });
    });
  });
});

describe.concurrent("Valkey reply torn across socket reads", () => {
  // `$15`/`=15` frames: 5-byte header, 15-byte body at [5,20), trailing CRLF at [20,22).
  // `!21` frame: 5-byte header, 21-byte body at [5,26), trailing CRLF at [26,28).
  // Offsets cover: body start, mid-body, last body byte, and mid-CRLF.
  const SHORT_SPLITS = [5, 10, 19, 21] as const;
  const LONG_SPLITS = [5, 10, 25, 27] as const;

  test.each(SHORT_SPLITS)("BulkString ($) torn at byte %i decodes (baseline)", async splitAt => {
    const server = createReplyServer(`$15${CRLF}xxx:Some string${CRLF}`, splitAt);
    await withClient(server, async client => {
      expect(await client.get("k")).toBe("xxx:Some string");
      expect(await client.send("PING", [])).toBe("OK");
    });
  });

  test.each(SHORT_SPLITS)(
    "VerbatimString (=) torn at byte %i decodes instead of failing the connection",
    async splitAt => {
      const server = createReplyServer(`=15${CRLF}txt:Some string${CRLF}`, splitAt);
      await withClient(server, async client => {
        expect(await client.get("k")).toBe("Some string");
        expect(await client.send("PING", [])).toBe("OK");
      });
    },
  );

  test.each(LONG_SPLITS)("BlobError (!) torn at byte %i decodes instead of failing the connection", async splitAt => {
    const server = createReplyServer(`!21${CRLF}SYNTAX invalid syntax${CRLF}`, splitAt);
    await withClient(server, async client => {
      // A parsed BlobError rejects only this command with the server's
      // message. Before the fix this rejected with "Failed to read data
      // (stack path)" and killed the connection.
      const err = await client.get("k").then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_REDIS_SERVER_ERROR");
      expect(err.message).toBe("SYNTAX invalid syntax");
      expect(await client.send("PING", [])).toBe("OK");
    });
  });
});

describe("Valkey incremental reply scanning", () => {
  // Sizes chosen large enough that re-scanning the accumulated partial line on
  // every socket read would dominate the runtime.
  const HEAD_BYTES = 410_000;
  const CHUNK_BYTES = 2;
  const CHUNK_COUNT = 25_000;
  const TOTAL_BYTES = HEAD_BYTES + CHUNK_BYTES * CHUNK_COUNT; // 460,000

  /** Count complete client->server RESP command frames in `buffer` starting at `offset`. */
  function parseCommandFrames(buffer: string, offset: number): { count: number; offset: number } {
    let count = 0;
    while (offset < buffer.length) {
      if (buffer[offset] !== "*") break;
      const headerEnd = buffer.indexOf("\r\n", offset);
      if (headerEnd === -1) break;
      const argc = parseInt(buffer.slice(offset + 1, headerEnd), 10);
      if (!Number.isInteger(argc) || argc < 0) break;
      let pos = headerEnd + 2;
      let complete = true;
      for (let i = 0; i < argc; i++) {
        if (buffer[pos] !== "$") {
          complete = false;
          break;
        }
        const lenEnd = buffer.indexOf("\r\n", pos);
        if (lenEnd === -1) {
          complete = false;
          break;
        }
        const len = parseInt(buffer.slice(pos + 1, lenEnd), 10);
        if (!Number.isInteger(len) || len < 0) {
          complete = false;
          break;
        }
        const next = lenEnd + 2 + len + 2;
        if (next > buffer.length) {
          complete = false;
          break;
        }
        pos = next;
      }
      if (!complete) break;
      count++;
      offset = pos;
    }
    return { count, offset };
  }

  /** Minimal mock server: +OK for the HELLO handshake, then one callback per later command. */
  function createMockValkeyServer(
    onCommand: (commandIndex: number, socket: net.Socket) => void,
  ): Promise<{ server: net.Server; port: number; sockets: net.Socket[] }> {
    return new Promise((resolve, reject) => {
      const sockets: net.Socket[] = [];
      const server = net.createServer(socket => {
        sockets.push(socket);
        socket.setNoDelay(true);
        socket.on("error", () => {});
        let received = "";
        let parsedOffset = 0;
        let commandIndex = 0;
        socket.on("data", data => {
          received += data.toString("latin1");
          const parsed = parseCommandFrames(received, parsedOffset);
          parsedOffset = parsed.offset;
          for (let i = 0; i < parsed.count; i++) {
            onCommand(commandIndex++, socket);
          }
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as net.AddressInfo;
        resolve({ server, port: address.port, sockets });
      });
      server.on("error", reject);
    });
  }

  /** Write `framing`, then the payload split into one large head followed by many tiny chunks. */
  async function dripReply(socket: net.Socket, framing: string) {
    socket.write(framing);
    socket.write(Buffer.alloc(HEAD_BYTES, "A").toString());
    const chunk = Buffer.alloc(CHUNK_BYTES, "A").toString();
    for (let i = 0; i < CHUNK_COUNT; i++) {
      socket.write(chunk);
      // Yield to the event loop after every tiny write so the client receives
      // the reply across many separate socket reads instead of one large read.
      await new Promise<void>(resolve => setImmediate(() => resolve()));
    }
    socket.write("\r\n");
  }

  test("long CRLF-terminated reply arriving in many small reads completes about as fast as a length-prefixed reply", async () => {
    const { server, port, sockets } = await createMockValkeyServer((commandIndex, socket) => {
      if (commandIndex === 0) {
        // HELLO handshake.
        socket.write("+OK\r\n");
        return;
      }
      // Command 1: bulk string ($<len>) — resuming the scan only needs a length
      // check, so this measures the per-read baseline cost of the drip.
      // Command 2: simple string (+...) — the terminating CRLF has to be searched
      // for, so this only stays comparable if already-scanned bytes are skipped.
      const framing = commandIndex === 1 ? `$${TOTAL_BYTES}\r\n` : "+";
      dripReply(socket, framing).catch(() => {});
    });

    const client = new RedisClient(`redis://127.0.0.1:${port}`, {
      autoReconnect: false,
      connectionTimeout: 5_000,
    });

    try {
      const bulkStart = performance.now();
      const bulkReply = await client.send("GET", ["length-prefixed"]);
      const bulkMs = performance.now() - bulkStart;

      const statusStart = performance.now();
      const statusReply = await client.send("GET", ["status-line"]);
      const statusMs = performance.now() - statusStart;

      // Both replies must arrive intact.
      expect(typeof bulkReply).toBe("string");
      expect((bulkReply as string).length).toBe(TOTAL_BYTES);
      expect(typeof statusReply).toBe("string");
      expect((statusReply as string).length).toBe(TOTAL_BYTES);
      expect(statusReply).toBe(bulkReply);

      // Both replies were delivered with the identical chunk count, chunk size
      // and pacing, so their timings should be of the same order. If every
      // socket read re-scans the whole accumulated partial line, the
      // CRLF-terminated reply takes many times longer than the baseline.
      expect(statusMs).toBeLessThan(bulkMs * 2 + 1_500);
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  }, 90_000);
});
