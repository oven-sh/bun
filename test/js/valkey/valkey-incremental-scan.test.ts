import { RedisClient, type TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import net from "node:net";

describe.concurrent("Valkey reply torn across socket reads", () => {
  const CRLF = "\r\n";
  const bulk = (s: string) => `$${Buffer.byteLength(s)}${CRLF}${s}${CRLF}`;
  // Minimal RESP3 HELLO map so the client enters the Connected state.
  const HELLO =
    `%3${CRLF}` + bulk("server") + bulk("redis") + bulk("proto") + `:3${CRLF}` + bulk("version") + bulk("7.4.0");

  type PerSocket = { buf: Buffer; replied: boolean };

  /**
   * Mock server: answers HELLO, then answers the first GET with `reply` split at
   * `splitAt` across two event-loop turns so the client's empty-read-buffer
   * stack path sees a partial blob body. Subsequent commands get `+OK`.
   */
  function createTornReplyServer(reply: string, splitAt: number): TCPSocketListener<PerSocket> {
    return Bun.listen<PerSocket>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          s.data = { buf: Buffer.alloc(0), replied: false };
        },
        error() {},
        close() {},
        data(s, raw) {
          const st = s.data;
          st.buf = Buffer.concat([st.buf, raw]);
          // Parse complete client RESP command frames (`*N\r\n($len\r\n...\r\n){N}`).
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
            const cmd = fields[0]?.toUpperCase();
            if (cmd === "HELLO") {
              s.write(HELLO);
            } else if (cmd === "GET" && !st.replied) {
              st.replied = true;
              s.write(reply.slice(0, splitAt));
              s.flush();
              // Yield twice so the first write reaches the client's `on_data`
              // before the second is sent.
              setImmediate(() => setImmediate(() => s.write(reply.slice(splitAt))));
            } else {
              s.write(`+OK${CRLF}`);
            }
          }
        },
      },
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

  // `$15`/`=15` frames: 5-byte header, 15-byte body at [5,20), trailing CRLF at [20,22).
  // `!21` frame: 5-byte header, 21-byte body at [5,26), trailing CRLF at [26,28).
  // Offsets cover: body start, mid-body, last body byte, and mid-CRLF.
  const SHORT_SPLITS = [5, 10, 19, 21] as const;
  const LONG_SPLITS = [5, 10, 25, 27] as const;

  test.each(SHORT_SPLITS)("BulkString ($) torn at byte %i decodes (baseline)", async splitAt => {
    const server = createTornReplyServer(`$15${CRLF}xxx:Some string${CRLF}`, splitAt);
    await withClient(server, async client => {
      expect(await client.get("k")).toBe("xxx:Some string");
      expect(await client.send("PING", [])).toBe("OK");
    });
  });

  test.each(SHORT_SPLITS)(
    "VerbatimString (=) torn at byte %i decodes instead of failing the connection",
    async splitAt => {
      const server = createTornReplyServer(`=15${CRLF}txt:Some string${CRLF}`, splitAt);
      await withClient(server, async client => {
        expect(await client.get("k")).toBe("Some string");
        expect(await client.send("PING", [])).toBe("OK");
      });
    },
  );

  test.each(LONG_SPLITS)("BlobError (!) torn at byte %i decodes instead of failing the connection", async splitAt => {
    const server = createTornReplyServer(`!21${CRLF}SYNTAX invalid syntax${CRLF}`, splitAt);
    await withClient(server, async client => {
      // A parsed BlobError rejects the command promise with the server's
      // message but leaves the connection open for subsequent commands.
      await expect(client.get("k")).rejects.toThrow("SYNTAX invalid syntax");
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
