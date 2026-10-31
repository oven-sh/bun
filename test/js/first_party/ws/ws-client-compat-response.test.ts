// Tests how a `ws` client reads the body of a non-101 response, and how the server's response to a `perMessageDeflate`
// offer with parameters affects the frames the client sends. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as harnessTls } from "harness";
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import zlib from "node:zlib";
import {
  closedBeforeOpen,
  connectClient,
  createPeer,
  implementations,
  nextEvent,
  openClient,
  type RawSocket,
  runScript,
  scriptTimeout,
} from "./ws-raw-peer";

async function readAll(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk);
  return Buffer.concat(chunks).toString("latin1");
}

/**
 * Writes each piece after the event loop has polled its sockets, so the client reads them one at a time. The tests
 * still pass if pieces arrive together. They just cover less.
 */
async function writeInPieces(conn: RawSocket, pieces: readonly string[]) {
  conn.socket.setNoDelay(true);
  for (const piece of pieces) {
    conn.write(piece);
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

describe.each(implementations)("ws client handshake response ($name)", row => {
  const { ws: implementation, builtin, specifier } = row;

  describe("body of a non-101 response from 'unexpected-response'", () => {
    /** Responds with `head`. Returns the response from 'unexpected-response' and the server's end of the connection. */
    async function unexpectedResponse(head: string, secure = false) {
      const respond = (conn: RawSocket) => (conn.socket.write(head, "latin1"), null);
      const client = await connectClient(implementation, { ca: harnessTls.cert }, { respond, secure });
      const [, response] = (await nextEvent(client.ws, "unexpected-response")) as [unknown, IncomingMessage];
      return { client, response, conn: await client.peer.connection() };
    }

    const chunkedHead = "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n";

    describe.each([
      { transport: "ws:", secure: false },
      { transport: "wss:", secure: true },
    ])("$transport", ({ secure }) => {
      test.each([
        { how: "in one write", pieces: ["2\r\nno\r\n4\r\n way\r\n0\r\n\r\n"] },
        { how: "one chunk per write", pieces: ["2\r\nno\r\n", "4\r\n way\r\n", "0\r\n\r\n"] },
        {
          how: "split inside a size, the data and a CRLF",
          pieces: ["2", "\r\nn", "o\r", "\n4\r\n wa", "y\r\n0\r", "\n\r\n"],
        },
        { how: "one byte per write", pieces: [..."2\r\nno\r\n4\r\n way\r\n0\r\n\r\n"] },
        { how: "with a chunk extension and a trailer", pieces: ["6;a=b\r\nno way\r\n0\r\n", "X-Trailer: 1\r\n\r\n"] },
      ])("chunked, $how: ends at the last chunk", async ({ pieces }) => {
        const { client, response, conn } = await unexpectedResponse(chunkedHead, secure);
        await using _ = client;
        const [body] = await Promise.all([readAll(response), writeInPieces(conn, pieces)]);
        expect(body).toBe("no way");
        // The listener decides what happens to the socket, so it emits nothing on its own.
        expect(client.events).toEqual([]);
      });

      test("with Content-Length: ends at the last byte", async () => {
        const { client, response, conn } = await unexpectedResponse(
          "HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\n",
          secure,
        );
        await using _ = client;
        const [body] = await Promise.all([readAll(response), writeInPieces(conn, ["no", " w", "ay"])]);
        expect(body).toBe("no way");
        expect(client.events).toEqual([]);
      });

      test("with neither: ends when the connection closes", async () => {
        const { client, response, conn } = await unexpectedResponse("HTTP/1.1 503 Service Unavailable\r\n\r\n", secure);
        await using _ = client;
        const written = writeInPieces(conn, ["part 1, ", "part 2"]).then(() => conn.end());
        const [body] = await Promise.all([readAll(response), written]);
        expect(body).toBe("part 1, part 2");
        expect(client.events).toEqual([]);
      });

      test("applies backpressure to the server while the body isn't being read", async () => {
        const { client, response, conn } = await unexpectedResponse("HTTP/1.1 503 Service Unavailable\r\n\r\n", secure);
        await using _ = client;
        const piece = Buffer.alloc(65536, "abcdefgh");
        // More than the kernel buffers for one connection. Winsock buffers all of it on loopback.
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
        // Treat the server as blocked once it makes no progress for 50 event loop iterations. Stopping too early only
        // weakens the test.
        for (let lastSent = -1, idle = 0; idle < 50 && sent < limit; idle++) {
          await new Promise<void>(resolve => setImmediate(resolve));
          if (sent !== lastSent) idle = 0;
          lastSent = sent;
        }
        expect(sent).toBeLessThan(limit);
        // At most the high water mark plus one socket read.
        expect(response.readableLength).toBeLessThan(2 * 1024 * 1024);

        stop = true;
        const [body] = await Promise.all([readAll(response), written]);
        expect(body.length).toBe(sent);
        expect(body === Buffer.alloc(sent, "abcdefgh").toString()).toBe(true);
        expect(client.events).toEqual([]);
      });
    });

    test("a 204 has no body, regardless of its headers", async () => {
      const { client, response } = await unexpectedResponse("HTTP/1.1 204 No Content\r\nContent-Length: 6\r\n\r\n");
      await using _ = client;
      expect(await readAll(response)).toBe("");
    });

    // node:http only treats a 101 as an upgrade if Upgrade has a value and Connection has the "upgrade" token. See
    // ws-upgrade-events.test.ts for how any other 101 is handled. These heads are easy to mistake for an upgrade.
    test.each([
      { what: "Upgrade is empty", headers: ["Upgrade:", "Connection: Upgrade"] },
      { what: "both Upgrade lines are empty", headers: ["Upgrade:", "Upgrade:", "Connection: Upgrade"] },
      {
        what: 'Connection has a different token that ends in "upgrade"',
        headers: ["Upgrade: websocket", "Connection: xupgrade"],
      },
      { what: "the Connection token contains a space", headers: ["Upgrade: websocket", "Connection: close upgrade"] },
      { what: "a no-break space follows the token", headers: ["Upgrade: websocket", "Connection: upgrade\xa0"] },
      { what: "a no-break space precedes the token", headers: ["Upgrade: websocket", "Connection: a,\xa0upgrade"] },
    ])("treats a 101 as a response without a body when $what", async ({ headers }) => {
      const head = ["HTTP/1.1 101 Switching Protocols", ...headers, "Content-Length: 2", "", "no"].join("\r\n");
      const { client, response } = await unexpectedResponse(head);
      await using _ = client;
      expect(await readAll(response)).toBe("");
      expect(response.complete).toBe(true);
      expect(client.events).toEqual([]);
    });

    // Node keeps the connection open, unref'd, for the agent's next request. The built-in has no agent, so it closes
    // the connection.
    test("the connection after the body of a keep-alive response", async () => {
      const { client, response, conn } = await unexpectedResponse(
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno",
      );
      await using _ = client;
      expect(await readAll(response)).toBe("no");
      if (builtin) await conn.ended;
      else await writeInPieces(conn, [""]);
      expect(conn.socketEvents).toEqual(builtin ? ["end"] : []);
    });

    test("a 1 MiB chunked body", async () => {
      const { client, response, conn } = await unexpectedResponse(chunkedHead);
      await using _ = client;
      const chunk = Buffer.alloc(65536, "abcdefgh").toString();
      for (let i = 0; i < 16; i++) conn.write(`10000\r\n${chunk}\r\n`);
      conn.write("0\r\n\r\n");
      const body = await readAll(response);
      expect(body.length).toBe(16 * chunk.length);
      expect(body === Buffer.alloc(16 * 65536, "abcdefgh").toString()).toBe(true);
    });

    describe("a paused reader", () => {
      const piece = Buffer.alloc(65536, "abcdefgh");
      /** Responds with `head`, then writes `pieces` pieces of the body as fast as the client reads them. */
      const pump = (head: string, pieces: number) => (conn: RawSocket) => {
        const writeMore = () => {
          while (pieces-- > 0 && conn.socket.write(piece));
        };
        conn.socket.on("drain", writeMore);
        conn.socket.write(head);
        writeMore();
        return null;
      };
      /** Script setup: defines `response`, logs its events, and waits until its buffer reaches the high water mark. */
      const pausedReaderSetup = `
        const ws = new WebSocket(process.env.PEER_URL);
        ws.on("error", error => console.log("ws error", showError(error)));
        const [, response] = await new Promise(resolve => ws.on("unexpected-response", (...args) => resolve(args)));
        for (const name of ["aborted", "end", "error"]) response.on(name, () => console.log(name));
        while (response.readableLength < response.readableHighWaterMark) await new Promise(setImmediate);
      `;

      test.concurrent(
        "doesn't keep the process alive",
        async () => {
          await using peer = await createPeer({ respond: pump("HTTP/1.1 503 Service Unavailable\r\n\r\n", Infinity) });
          const script = `(async () => {
            ${pausedReaderSetup}
            process.on("exit", () => console.log("exit, complete", response.complete));
          })();`;
          // If the client left the stall timer from the next test running, it would abort the body after 1 s.
          const env = { PEER_URL: peer.url, BUN_CONFIG_WS_HANDSHAKE_TIMEOUT: "1" };
          expect(await runScript({ specifier }, script, env)).toEqual({
            lines: ["exit, complete false"],
            stderr: "",
            exitCode: 0,
          });
        },
        scriptTimeout,
      );

      // Only the built-in times out a server that stalls mid-body. The global WebSocket serves as the clock: it's
      // created later and has the same timeout.
      test.concurrent.skipIf(!builtin)(
        "isn't mistaken for a stalled server",
        async () => {
          const head = `HTTP/1.1 503 Service Unavailable\r\nContent-Length: ${64 * piece.length}\r\n\r\n`;
          await using peer = await createPeer({
            respond: conn => (conn.headLines[0].startsWith("GET /clock ") ? null : pump(head, 64)(conn)),
          });
          const script = `(async () => {
            ${pausedReaderSetup}
            await new Promise(resolve => (new globalThis.WebSocket(process.env.PEER_URL + "/clock").onclose = resolve));
            console.log("the global WebSocket gave up");
            let length = 0;
            for await (const chunk of response) length += chunk.length;
            console.log("read", length, "complete", response.complete);
          })();`;
          const env = { PEER_URL: peer.url, BUN_CONFIG_WS_HANDSHAKE_TIMEOUT: "1" };
          expect((await runScript({ specifier }, script, env)).lines).toEqual([
            "the global WebSocket gave up",
            "end",
            `read ${64 * piece.length} complete true`,
          ]);
        },
        scriptTimeout,
      );
    });

    test.concurrent.skipIf(!builtin).each([
      { kind: "no length", headers: "" },
      { kind: "Content-Length", headers: "Content-Length: 6\r\n" },
      { kind: "chunked", headers: "Transfer-Encoding: chunked\r\n", partialBody: "2\r\nno\r\n" },
    ])(
      "a server that stalls mid-body ($kind) aborts the response instead of ending it",
      async ({ headers, partialBody = "no" }) => {
        await using peer = await createPeer({
          respond: () => `HTTP/1.1 503 Service Unavailable\r\n${headers}\r\n${partialBody}`,
        });
        const script = `
          const ws = new WebSocket(process.env.PEER_URL);
          ws.on("error", error => console.log("ws error", showError(error)));
          ws.on("unexpected-response", (request, response) => {
            response.on("data", chunk => console.log("data", show(chunk)));
            response.on("aborted", () => console.log("aborted"));
            response.on("end", () => console.log("end"));
            response.on("error", error => console.log("error", showError(error)));
            response.on("close", () => console.log("close, complete", response.complete));
          });
        `;
        const env = { PEER_URL: peer.url, BUN_CONFIG_WS_HANDSHAKE_TIMEOUT: "1" };
        expect((await runScript({ specifier }, script, env)).lines).toEqual([
          'data Buffer("no")',
          "aborted",
          'error Error "aborted" ECONNRESET',
          "close, complete false",
        ]);
      },
      scriptTimeout,
    );

    test("terminate() mid-body closes the connection", async () => {
      const { client, response, conn } = await unexpectedResponse(chunkedHead);
      await using _ = client;
      // On Node this makes the response emit an ECONNRESET 'error'.
      response.on("error", () => {});
      conn.write("2\r\nno\r\n");
      expect(String((await nextEvent(response, "data"))[0])).toBe("no");
      client.ws.terminate();
      await Promise.all([conn.ended, client.closed]);
      expect(client.events).toEqual(closedBeforeOpen);
    });
  });

  describe("perMessageDeflate with parameters", () => {
    // 300 bytes repeat 2300 bytes later. That's inside a 2^15-byte window but far outside a 2^9-byte one.
    const repeated = crypto.randomBytes(150).toString("hex");
    const message = repeated + crypto.randomBytes(1000).toString("hex") + repeated;

    /** The small chunkSize forces zlib to resolve back-references from its window instead of its output buffer. */
    const inflate = (payload: Buffer, windowBits: number) =>
      zlib
        .inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 0xff, 0xff])]), {
          windowBits,
          chunkSize: 64,
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        })
        .toString();

    test.each([
      { response: "permessage-deflate; client_max_window_bits=9", verb: "echoes" },
      { response: "permessage-deflate", verb: "omits" },
    ])("honors clientMaxWindowBits when the response $verb it", async ({ response }) => {
      await using client = await openClient(
        implementation,
        { perMessageDeflate: { clientMaxWindowBits: 9 } },
        { headers: [`Sec-WebSocket-Extensions: ${response}`] },
      );
      expect(client.conn.header("sec-websocket-extensions")).toBe("permessage-deflate; client_max_window_bits=9");
      client.ws.send(message);
      const frame = (await client.conn.nextFrame())!;
      expect(frame.rsv).toBe(4);
      expect(inflate(frame.payload, 9)).toBe(message);
    });

    test("sanity check: without clientMaxWindowBits that message needs a larger window", async () => {
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

    test("throws for a parameter value that isn't valid in a header", async () => {
      await using peer = await createPeer();
      const perMessageDeflate = { serverMaxWindowBits: "10\r\nX-Injected: 1" as any };
      expect(() => {
        // If it doesn't throw, swallow its 'error' so it can't fail the next test.
        new implementation.WebSocket(peer.url, { perMessageDeflate }).on("error", () => {}).terminate();
      }).toThrow(expect.objectContaining({ code: "ERR_INVALID_CHAR" }));
      expect(peer.connections).toEqual([]);
    });
  });
});
