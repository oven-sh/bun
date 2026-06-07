import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import net from "node:net";

describe("Valkey incremental reply scanning", () => {
  // Sizes chosen so the reply line stays under the protocol's 512 KiB line
  // limit while still being large enough that re-scanning the accumulated
  // partial line on every socket read would dominate the runtime.
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
