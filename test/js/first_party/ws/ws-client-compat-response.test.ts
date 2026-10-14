// What a `ws` client reads out of the server's answer beyond its head: the body of a response that is not a 101, and
// what the answer to a `perMessageDeflate` offer with parameters means for the frames it sends. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as harnessTls, isWindows } from "harness";
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import zlib from "node:zlib";
import { createPeer, dial, event, implementations, openClient, type RawSocket } from "./ws-raw-peer";

const closedBeforeOpen = [
  'error Error "WebSocket was closed before the connection was established" rs=2',
  "close 1006 Buffer() rs=3",
];

async function readAll(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk);
  return Buffer.concat(chunks).toString("latin1");
}

/**
 * Writes each piece after the event loop has polled its sockets, so that the client reads them one by one. The
 * outcome does not depend on it: pieces that arrive together only test less.
 */
async function writeInPieces(conn: RawSocket, pieces: readonly string[]) {
  conn.socket.setNoDelay(true);
  for (const piece of pieces) {
    conn.write(piece);
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

describe.each(implementations)("ws client, the server's answer ($name)", ({ ws: implementation, builtin }) => {
  describe("the body of a response that is not a 101, after 'unexpected-response'", () => {
    /** The response of 'unexpected-response' to `head`, and the server's end of the connection. */
    async function unexpected(head: string, secure = false) {
      const respond = (conn: RawSocket) => (conn.socket.write(head, "latin1"), null);
      const client = await dial(implementation, { ca: harnessTls.cert }, { respond, secure });
      const [, response] = (await event(client.ws, "unexpected-response")) as [unknown, IncomingMessage];
      return { client, response, conn: await client.peer.connection() };
    }

    const chunked = "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n";

    describe.each([
      { transport: "ws:", secure: false },
      { transport: "wss:", secure: true },
    ])("$transport", ({ secure }) => {
      test.each([
        { how: "whole", pieces: ["2\r\nno\r\n4\r\n way\r\n0\r\n\r\n"] },
        { how: "chunk by chunk", pieces: ["2\r\nno\r\n", "4\r\n way\r\n", "0\r\n\r\n"] },
        {
          how: "cut inside a size, the data and a line end",
          pieces: ["2", "\r\nn", "o\r", "\n4\r\n wa", "y\r\n0\r", "\n\r\n"],
        },
        { how: "byte by byte", pieces: [..."2\r\nno\r\n4\r\n way\r\n0\r\n\r\n"] },
        { how: "with a chunk extension and a trailer", pieces: ["6;a=b\r\nno way\r\n0\r\n", "X-Trailer: 1\r\n\r\n"] },
      ])("in chunks, $how: ends with the last chunk", async ({ pieces }) => {
        const { client, response, conn } = await unexpected(chunked, secure);
        await using _ = client;
        const [body] = await Promise.all([readAll(response), writeInPieces(conn, pieces)]);
        expect(body).toBe("no way");
        // What becomes of the socket is up to the listener.
        expect(client.events).toEqual([]);
      });

      test("with a Content-Length: ends with its last byte", async () => {
        const { client, response, conn } = await unexpected(
          "HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\n",
          secure,
        );
        await using _ = client;
        const [body] = await Promise.all([readAll(response), writeInPieces(conn, ["no", " w", "ay"])]);
        expect(body).toBe("no way");
        expect(client.events).toEqual([]);
      });

      test("with neither: ends with the connection", async () => {
        const { client, response, conn } = await unexpected("HTTP/1.1 503 Service Unavailable\r\n\r\n", secure);
        await using _ = client;
        const written = writeInPieces(conn, ["part 1, ", "part 2"]).then(() => conn.end());
        const [body] = await Promise.all([readAll(response), written]);
        expect(body).toBe("part 1, part 2");
        expect(client.events).toEqual([]);
      });

      test("while nobody reads it, it waits in the server", async () => {
        const { client, response, conn } = await unexpected("HTTP/1.1 503 Service Unavailable\r\n\r\n", secure);
        await using _ = client;
        const piece = Buffer.alloc(65536, "abcdefgh");
        // More than the kernel keeps for one connection. Winsock keeps all of it on loopback.
        const limit = 1024 * piece.length;
        let sent = 0;
        let stop = false;
        const written = (async () => {
          while (!stop && sent < limit) {
            await new Promise<void>(resolve => conn.socket.write(piece, () => resolve()));
            sent += piece.length;
          }
          conn.end();
        })();
        // The server is stuck once it got nowhere while the event loop polled its sockets this often. To stop
        // sooner only tests less.
        for (let last = -1, idle = 0; idle < 50 && sent < limit; idle++) {
          await new Promise<void>(resolve => setImmediate(resolve));
          if (sent !== last) idle = 0;
          last = sent;
        }
        if (!isWindows) expect(sent).toBeLessThan(limit);
        // The high water mark and what one read of the socket brought.
        expect(response.readableLength).toBeLessThan(2 * 1024 * 1024);

        stop = true;
        const [body] = await Promise.all([readAll(response), written]);
        expect(body.length).toBe(sent);
        expect(body === Buffer.alloc(sent, "abcdefgh").toString()).toBe(true);
        expect(client.events).toEqual([]);
      });
    });

    test("a 204 has none, whatever its headers say", async () => {
      const { client, response } = await unexpected("HTTP/1.1 204 No Content\r\nContent-Length: 6\r\n\r\n");
      await using _ = client;
      expect(await readAll(response)).toBe("");
    });

    // node:http takes a 101 for an upgrade only with a value in Upgrade and the "upgrade" option in Connection. See
    // ws-upgrade-events.test.ts for what such a response is. These are the heads that are easy to take for an upgrade.
    test.each([
      { what: "Upgrade has no value", headers: ["Upgrade:", "Connection: Upgrade"] },
      { what: "two Upgrade lines have no value", headers: ["Upgrade:", "Upgrade:", "Connection: Upgrade"] },
      {
        what: "Connection has another option that ends in it",
        headers: ["Upgrade: websocket", "Connection: xupgrade"],
      },
      { what: "a space is in the option", headers: ["Upgrade: websocket", "Connection: close upgrade"] },
      { what: "a no-break space follows the option", headers: ["Upgrade: websocket", "Connection: upgrade\xa0"] },
      { what: "a no-break space precedes the option", headers: ["Upgrade: websocket", "Connection: a,\xa0upgrade"] },
    ])("a 101 is a response without a body when $what", async ({ headers }) => {
      const head = ["HTTP/1.1 101 Switching Protocols", ...headers, "Content-Length: 2", "", "no"].join("\r\n");
      const { client, response } = await unexpected(head);
      await using _ = client;
      expect(await readAll(response)).toBe("");
      expect(response.complete).toBe(true);
      expect(client.events).toEqual([]);
    });

    // Node keeps the connection for the agent's next request, without a hold on the process. The built-in has no
    // agent and ends it.
    test("the connection after a body that the server did not end it for", async () => {
      const { client, response, conn } = await unexpected("HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno");
      await using _ = client;
      expect(await readAll(response)).toBe("no");
      if (builtin) await conn.ended;
      else await writeInPieces(conn, [""]);
      expect(conn.tcp).toEqual(builtin ? ["end"] : []);
    });

    test("1 MB in chunks", async () => {
      const { client, response, conn } = await unexpected(chunked);
      await using _ = client;
      const chunk = Buffer.alloc(65536, "abcdefgh").toString();
      for (let i = 0; i < 16; i++) conn.write(`10000\r\n${chunk}\r\n`);
      conn.write("0\r\n\r\n");
      const body = await readAll(response);
      expect(body.length).toBe(16 * chunk.length);
      expect(body === Buffer.alloc(16 * 65536, "abcdefgh").toString()).toBe(true);
    });

    test("terminate() while it is still coming closes the connection", async () => {
      const { client, response, conn } = await unexpected(chunked);
      await using _ = client;
      // On Node the response fails with ECONNRESET then.
      response.on("error", () => {});
      conn.write("2\r\nno\r\n");
      expect(String((await event(response, "data"))[0])).toBe("no");
      client.ws.terminate();
      await Promise.all([conn.ended, client.closed]);
      expect(client.events).toEqual(closedBeforeOpen);
    });
  });

  describe("perMessageDeflate with parameters", () => {
    // 300 bytes come back 2300 bytes later: within a window of 2^15 bytes, far outside one of 2^9.
    const repeated = crypto.randomBytes(150).toString("hex");
    const message = repeated + crypto.randomBytes(1000).toString("hex") + repeated;

    /** The small chunkSize makes zlib look up a distance in its window and not in its output. */
    const inflate = (payload: Buffer, windowBits: number) =>
      zlib
        .inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 0xff, 0xff])]), {
          windowBits,
          chunkSize: 64,
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        })
        .toString();

    test.each([
      { answer: "permessage-deflate; client_max_window_bits=9", says: "repeats" },
      { answer: "permessage-deflate", says: "leaves out" },
    ])("the client keeps to clientMaxWindowBits when the answer $says it", async ({ answer }) => {
      await using client = await openClient(
        implementation,
        { perMessageDeflate: { clientMaxWindowBits: 9 } },
        { headers: [`Sec-WebSocket-Extensions: ${answer}`] },
      );
      expect(client.conn.header("sec-websocket-extensions")).toBe("permessage-deflate; client_max_window_bits=9");
      client.ws.send(message);
      const frame = (await client.conn.nextFrame())!;
      expect(frame.rsv).toBe(4);
      expect(inflate(frame.payload, 9)).toBe(message);
    });

    test("that message does need the smaller window", async () => {
      await using client = await openClient(
        implementation,
        {},
        { headers: ["Sec-WebSocket-Extensions: permessage-deflate"] },
      );
      client.ws.send(message);
      const frame = (await client.conn.nextFrame())!;
      expect(inflate(frame.payload, 15)).toBe(message);
      expect(() => inflate(frame.payload, 9)).toThrow("invalid distance too far back");
    });

    test("perMessageDeflate: false sends no offer", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      expect(client.conn.header("sec-websocket-extensions")).toBeUndefined();
    });

    test("a value that cannot go into a header throws", async () => {
      await using peer = await createPeer();
      const perMessageDeflate = { serverMaxWindowBits: "10\r\nX-Injected: 1" as any };
      expect(() => {
        // Should it not throw, its 'error' must not be the next test's.
        new implementation.WebSocket(peer.url, { perMessageDeflate }).on("error", () => {}).terminate();
      }).toThrow(expect.objectContaining({ code: "ERR_INVALID_CHAR" }));
      expect(peer.connections).toEqual([]);
    });
  });
});
