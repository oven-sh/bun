import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { once } from "node:events";
import { WebSocket } from "ws";
import { openOrFailure } from "./proxy-test-utils";
import { createPeer, encodeFrame, OP, type RawSocket, response101 } from "./raw-peer";

const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "0");

const NativeWebSocket = globalThis.WebSocket;
type NativeWebSocket = globalThis.WebSocket;

/** Sends a latin1 string (one byte per character) in a single write. */
function write(connection: RawSocket, bytes: string) {
  connection.write(Buffer.from(bytes, "latin1"));
}

/**
 * Raw server. Calls `respond` with each connection once its upgrade request has arrived.
 * `GET /barrier` is answered automatically, see `clientHasRead`.
 */
function listen(respond: (connection: RawSocket) => unknown) {
  return createPeer({
    respond(connection) {
      if (connection.head.startsWith("GET /barrier ")) return response101(connection);
      respond(connection);
      return null;
    },
  });
}

/**
 * Resolves once `connection`'s client has read everything written so far, so the next write arrives in
 * a separate read. It runs a second handshake on the same event loop. The earlier bytes were
 * already readable when it started, and it takes several loop iterations to finish. Its result is
 * ignored because a client that already failed ends the test and stops the server.
 */
async function clientHasRead(connection: RawSocket) {
  await openOrFailure(new NativeWebSocket(`ws://127.0.0.1:${connection.socket.localPort}/barrier`));
}

/** Sends `bytes` so the client gets them in two reads, split at `firstRead`. Defaults to a single read. */
async function writeSplit(connection: RawSocket, bytes: string, firstRead = bytes.length) {
  write(connection, bytes.slice(0, firstRead));
  if (firstRead >= bytes.length) return;
  await clientHasRead(connection);
  write(connection, bytes.slice(firstRead));
}

/** Sends `bytes` so the client gets them in reads of at most `size` bytes. */
async function writeInChunks(connection: RawSocket, bytes: string, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size) {
    if (offset) await clientHasRead(connection);
    write(connection, bytes.slice(offset, offset + size));
  }
}

/** Records every `handshake` event, the native event behind the ws package's 'upgrade' and 'unexpected-response'. */
function recordHandshakes(ws: NativeWebSocket) {
  const seen: { statusCode: number; rawHeaders: string[] }[] = [];
  ws.addEventListener(
    "handshake" as any,
    ((event: MessageEvent) => {
      seen.push({ statusCode: event.data.statusCode, rawHeaders: event.data.rawHeaders });
    }) as any,
  );
  return seen;
}

function firstMessage(ws: NativeWebSocket): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  ws.addEventListener("message", event => resolve(event.data));
  ws.addEventListener("error", event => reject(new Error((event as ErrorEvent).message)));
  ws.addEventListener("close", event => reject(new Error(`closed: ${event.code} ${event.reason}`)));
  return promise.finally(() => ws.terminate());
}

function textFrame(text: string): string {
  return encodeFrame(OP.text, text).toString("latin1");
}

describe("WebSocket", () => {
  test("short read on payload length", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let init = false;

    try {
      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (init) {
              // The client only ever sends a Close frame. Echo it and end the connection.
              socket.end(Uint8Array.from([0x88, 0]));
              return;
            }

            init = true;

            const frame = data.toString("utf-8");
            if (!frame.startsWith("GET")) {
              throw new Error("Invalid handshake");
            }

            const magic = /Sec-WebSocket-Key: (.*)\r\n/.exec(frame);
            if (!magic) {
              throw new Error("Missing Sec-WebSocket-Key");
            }

            const hasher = new Bun.CryptoHasher("sha1");
            hasher.update(magic[1]);
            hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
            const accept = hasher.digest("base64");

            // Respond with a websocket handshake.
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n` +
                "\r\n",
            );
            socket.flush();

            // Partially write a websocket text frame with an incomplete big-endian u16 length.
            socket.write(Uint8Array.from([129, 126, 0]));
            socket.flush();

            // Write the remainder of the websocket text frame.
            setTimeout(() => {
              socket.write(
                Uint8Array.from([
                  253, 123, 34, 106, 115, 111, 110, 114, 112, 99, 34, 58, 34, 50, 46, 48, 34, 44, 34, 109, 101, 116,
                  104, 111, 100, 34, 58, 34, 116, 114, 97, 110, 115, 97, 99, 116, 105, 111, 110, 78, 111, 116, 105, 102,
                  105, 99, 97, 116, 105, 111, 110, 34, 44, 34, 112, 97, 114, 97, 109, 115, 34, 58, 123, 34, 114, 101,
                  115, 117, 108, 116, 34, 58, 123, 34, 99, 111, 110, 116, 101, 120, 116, 34, 58, 123, 34, 115, 108, 111,
                  116, 34, 58, 50, 52, 57, 54, 48, 50, 49, 55, 57, 125, 44, 34, 118, 97, 108, 117, 101, 34, 58, 123, 34,
                  115, 105, 103, 110, 97, 116, 117, 114, 101, 34, 58, 34, 50, 80, 50, 120, 102, 51, 109, 85, 49, 118,
                  114, 110, 89, 99, 100, 49, 76, 105, 99, 104, 56, 69, 76, 104, 104, 88, 120, 55, 50, 111, 67, 105, 110,
                  77, 97, 81, 88, 101, 113, 106, 118, 68, 55, 111, 52, 101, 75, 77, 53, 70, 66, 51, 78, 76, 97, 104, 86,
                  55, 68, 87, 101, 81, 106, 105, 102, 98, 107, 53, 56, 75, 121, 104, 66, 119, 98, 119, 88, 49, 104, 103,
                  119, 103, 112, 112, 102, 118, 77, 71, 34, 44, 34, 115, 108, 111, 116, 34, 58, 50, 52, 57, 54, 48, 50,
                  49, 55, 57, 125, 125, 44, 34, 115, 117, 98, 115, 99, 114, 105, 112, 116, 105, 111, 110, 34, 58, 52,
                  48, 50, 56, 125, 125,
                ]),
              );
              socket.flush();
            }, 0);
          },
        },
        hostname,
        port,
      });

      const { promise, resolve, reject } = Promise.withResolvers<string>();

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      client.addEventListener("error", err => reject(new Error(err.message)));
      client.addEventListener("close", event => reject(new Error(`closed: ${event.code} ${event.reason}`)));
      client.addEventListener("message", event => resolve(event.data.toString("utf-8")));

      expect(await promise).toEqual(
        `{"jsonrpc":"2.0","method":"transactionNotification","params":{"result":{"context":{"slot":249602179},"value":{"signature":"2P2xf3mU1vrnYcd1Lich8ELhhXx72oCinMaQXeqjvD7o4eKM5FB3NLahV7DWeQjifbk58KyhBwbwX1hgwgppfvMG","slot":249602179}},"subscription":4028}}`,
      );

      const closed = once(client, "close");
      client.close();
      await closed;
    } finally {
      client?.terminate();
      server?.stop(true);
    }
  });
});

// --max-http-header-size (16 KB by default) counts header names, values and the status text, like Node.
// The client limits the raw bytes of the response head instead, with 1 KB extra for delimiters.
const MAX_HEAD = 16384 + 1024;
const TOO_LARGE = "Response headers too large";

describe("response header size limit", () => {
  function paddedHead(connection: RawSocket, size: number): string {
    const padding = size - response101(connection, ["X-Pad: "]).length;
    return response101(connection, ["X-Pad: " + Buffer.alloc(padding, "a").toString()]);
  }

  // Only the total size of the head matters, not where the reads are split.
  test.each([
    [MAX_HEAD, MAX_HEAD, "open"],
    [MAX_HEAD + 1, MAX_HEAD + 1, TOO_LARGE],
    [100_000, 100_000, TOO_LARGE],
    // Node accepts this one too.
    [16400, 16390, "open"],
    [MAX_HEAD, MAX_HEAD - 1, "open"],
    [MAX_HEAD + 1, MAX_HEAD, TOO_LARGE],
    [21000, 16000, TOO_LARGE],
    [21000, 20000, TOO_LARGE],
  ])("%i-byte 101 response with %i bytes in the first read: %s", async (size, firstRead, outcome) => {
    await using server = await listen(connection => {
      const head = paddedHead(connection, size);
      expect(head.length).toBe(size);
      return writeSplit(connection, head, firstRead);
    });
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe(outcome);
  });

  test("fails an unterminated response once it exceeds the limit", async () => {
    await using server = await listen(connection => {
      write(connection, "HTTP/1.1 101 Switching Protocols\r\nX-Pad: " + Buffer.alloc(20000, "a").toString());
    });
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe(TOO_LARGE);
  });

  test.each([
    ["in the same read as the whole response head", undefined],
    ["in the same read as the end of the response head", "HTTP/1.1 101 ".length],
  ])("frame bytes don't count toward the limit when they arrive %s", async (_, firstRead) => {
    const payload = 20000;
    await using server = await listen(connection => {
      // An unmasked binary frame with a 64-bit length.
      const frame = "\x82\x7f\0\0\0\0\0\0" + String.fromCharCode(payload >> 8, payload & 0xff);
      return writeSplit(
        connection,
        response101(connection) + frame + Buffer.alloc(payload).toString("latin1"),
        firstRead,
      );
    });
    const ws = new NativeWebSocket(server.url);
    ws.binaryType = "arraybuffer";
    expect(((await firstMessage(ws)) as ArrayBuffer).byteLength).toBe(payload);
  });
});

describe("response header count", () => {
  // At about 8 bytes per header, 2100 of them fit under the size limit. Node doesn't limit the count either.
  const filler = (i: number) => `x: ${i.toString(36)}`;
  const fillers = (count: number) => Array.from({ length: count }, (_, i) => filler(i));
  const rawHeaders = (head: string) =>
    head
      .split("\r\n")
      .slice(1, -2)
      .flatMap(line => line.split(": "));

  test.each([126, 1000, 2100])("opens on a 101 with %i extra headers and reports all of them", async count => {
    let head = "";
    await using server = await listen(connection => {
      head = response101(connection, fillers(count));
      write(connection, head + textFrame("hi"));
    });
    const ws = new NativeWebSocket(server.url);
    const seen = recordHandshakes(ws);
    expect({ message: await firstMessage(ws), seen }).toEqual({
      message: "hi",
      seen: [{ statusCode: 101, rawHeaders: rawHeaders(head) }],
    });
  });

  test("opens when the reads are split in the middle of header 201", async () => {
    let head = "";
    await using server = await listen(connection => {
      head = response101(connection, fillers(300));
      return writeSplit(connection, head, head.indexOf(filler(200) + "\r\n") + 4);
    });
    const ws = new NativeWebSocket(server.url);
    const seen = recordHandshakes(ws);
    expect({ outcome: await openOrFailure(ws), seen }).toEqual({
      outcome: "open",
      seen: [{ statusCode: 101, rawHeaders: rawHeaders(head) }],
    });
  });

  test("a 503 with 200 headers fails with the status code error", async () => {
    await using server = await listen(connection => {
      write(
        connection,
        ["HTTP/1.1 503 Service Unavailable", ...fillers(200), "Content-Length: 0", "\r\n"].join("\r\n"),
      );
    });
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe("Expected 101 status code: 503");
  });
});

describe("first bytes of the response", () => {
  // The server keeps the connection open, so only these bytes can fail the handshake.
  test.each(["f", "foo\r\n", "foo\r\n\r\n", "HTTQ", "HTTP/2", "\r\nHTTP", "HTTP/1.1 100 Continue\r\n\r\nfoo"])(
    "fails immediately on %j, which can't start a valid response",
    async bytes => {
      const read = Promise.withResolvers<string>();
      await using server = await listen(async connection => {
        write(connection, bytes);
        await clientHasRead(connection);
        read.resolve("still waiting");
      });
      const ws = new NativeWebSocket(server.url);
      expect(await Promise.race([openOrFailure(ws), read.promise])).toBe("Invalid response");
    },
  );

  test.each([1, 4, 7, 8])("opens when the first read only has %i bytes of the 101", async firstRead => {
    await using server = await listen(connection => writeSplit(connection, response101(connection), firstRead));
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe("open");
  });
});

describe("interim responses", () => {
  const CONTINUE = "HTTP/1.1 100 Continue\r\n\r\n";
  const EARLY_HINTS = "HTTP/1.1 103 Early Hints\r\nLink: </style.css>; rel=preload\r\n\r\n";

  describe.each([
    ["100 Continue", CONTINUE],
    ["103 Early Hints", EARLY_HINTS],
    ["both", CONTINUE + EARLY_HINTS],
  ])("%s", (_, interim) => {
    test.each([
      ["in one read", undefined],
      ["split inside the interim response", 12],
      ["split after the interim response", interim.length],
    ])("followed by a 101, %s", async (_, firstRead) => {
      await using server = await listen(connection => {
        return writeSplit(connection, interim + response101(connection) + textFrame("hi"), firstRead);
      });
      const ws = new NativeWebSocket(server.url);
      const seen = recordHandshakes(ws);
      expect({ message: await firstMessage(ws), statusCodes: seen.map(({ statusCode }) => statusCode) }).toEqual({
        message: "hi",
        statusCodes: [101],
      });
    });
  });

  // Otherwise a server could keep the client parsing them forever.
  describe("count toward the response header size limit", () => {
    const fitting = Math.floor(MAX_HEAD / CONTINUE.length);

    describe.each([
      [fitting, "open"],
      [fitting + 1, TOO_LARGE],
    ])("%i times 100 Continue, then a 101: %s", (count, outcome) => {
      test.each([
        ["in one read", Infinity],
        ["in reads of 2000 bytes", 2000],
      ])("%s", async (_, size) => {
        await using server = await listen(connection => {
          const interim = Buffer.alloc(count * CONTINUE.length, CONTINUE).toString();
          return writeInChunks(connection, interim + response101(connection), size);
        });
        expect(await openOrFailure(new NativeWebSocket(server.url))).toBe(outcome);
      });
    });
  });

  test("100 Continue followed by a 404 fails with the 404", async () => {
    await using server = await listen(connection =>
      write(connection, CONTINUE + "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"),
    );
    const ws = new NativeWebSocket(server.url);
    const seen = recordHandshakes(ws);
    expect({ outcome: await openOrFailure(ws), statusCodes: seen.map(({ statusCode }) => statusCode) }).toEqual({
      outcome: "Expected 101 status code: 404",
      statusCodes: [404],
    });
  });
});

describe("Sec-WebSocket-Extensions in the 101", () => {
  const UNSUPPORTED = "Unsupported websocket extension";

  async function negotiate(lines: string[], options?: Bun.WebSocketOptions) {
    await using server = await createPeer({ headers: lines });
    const ws = new NativeWebSocket(server.url, options);
    const { promise, resolve } = Promise.withResolvers<string>();
    ws.addEventListener("open", () => resolve(`open with "${ws.extensions}"`));
    return await Promise.race([promise, openOrFailure(ws)]);
  }

  test.each([
    "permessage-deflate",
    "permessage-deflate; server_no_context_takeover",
    "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
    "permessage-deflate; server_max_window_bits=8; client_max_window_bits=9",
    "permessage-deflate; client_max_window_bits=14",
  ])("accepts %j", async value => {
    expect(await negotiate([`Sec-WebSocket-Extensions: ${value}`])).toBe(`open with "${value}"`);
  });

  test.each([
    ['permessage-deflate; server_max_window_bits="10"', "permessage-deflate; server_max_window_bits=10"],
    [
      "permessage-deflate;client_max_window_bits=15 ;\tserver_no_context_takeover",
      "permessage-deflate; server_no_context_takeover",
    ],
  ])("accepts %j", async (value, extensions) => {
    expect(await negotiate([`Sec-WebSocket-Extensions: ${value}`])).toBe(`open with "${extensions}"`);
  });

  // RFC 6455 section 9.1 and RFC 7692 section 7.1: the client must fail the connection.
  test.each([
    "foo",
    "x-webkit-deflate-frame",
    "permessage-deflate, foo",
    "foo, permessage-deflate",
    "permessage-deflate, permessage-deflate",
    "PerMessage-Deflate",
    "",
    "permessage-deflate;",
    "permessage-deflate;;",
    "permessage-deflate; bogus",
    "permessage-deflate; bogus=1",
    "permessage-deflate; server_max_window_bits",
    "permessage-deflate; client_max_window_bits",
    "permessage-deflate; server_max_window_bits=",
    "permessage-deflate; server_max_window_bits=7",
    "permessage-deflate; server_max_window_bits=16",
    "permessage-deflate; server_max_window_bits=99",
    "permessage-deflate; client_max_window_bits=7",
    "permessage-deflate; client_max_window_bits=010",
    "permessage-deflate; client_max_window_bits=1_0",
    "permessage-deflate; client_max_window_bits=+9",
    "permessage-deflate; client_max_window_bits=9a",
    // The ASCII characters right after "9".
    "permessage-deflate; server_max_window_bits=:",
    "permessage-deflate; server_max_window_bits==",
    "permessage-deflate; client_max_window_bits=?",
    "permessage-deflate; client_no_context_takeover=1",
    "permessage-deflate; server_no_context_takeover; server_no_context_takeover",
    "permessage-deflate; client_max_window_bits=10; client_max_window_bits=10",
  ])("rejects %j", async value => {
    expect(await negotiate([`Sec-WebSocket-Extensions: ${value}`])).toBe(UNSUPPORTED);
  });

  test("rejects a duplicate header", async () => {
    const line = "Sec-WebSocket-Extensions: permessage-deflate";
    expect(await negotiate([line, line])).toBe(UNSUPPORTED);
  });

  test("rejects permessage-deflate when the client didn't offer it", async () => {
    const line = "Sec-WebSocket-Extensions: permessage-deflate";
    expect(await negotiate([line], { perMessageDeflate: false })).toBe(UNSUPPORTED);
  });
});

describe("aborting while CONNECTING", () => {
  test.each(["close", "terminate"] as const)("%s() closes the connection with a FIN, not a reset", async method => {
    // The server reads the request and never responds.
    await using peer = await createPeer({ allowHalfOpen: false, respond: () => null });
    const ws = new NativeWebSocket(peer.url);
    ws.addEventListener("error", () => {});
    const connection = await peer.connection();
    ws[method]();
    await connection.closed;
    expect(connection.socketEvents).toEqual(["end", "close"]);
  });
});

describe("data received while a handshake listener spins the event loop", () => {
  // Call from a listener. Sends `bytes` from the peer, then blocks until `until` settles.
  // `Bun.build()` ticks the event loop until a plugin's `setup()` settles.
  function sendAndWaitSynchronously(peer: RawSocket, bytes: string, until: Promise<void>) {
    write(peer, bytes);
    Bun.build({ entrypoints: ["./none.js"], plugins: [{ name: "spin", setup: () => until }] }).catch(() => {});
  }

  test("a frame received during a 101's handshake listener is delivered after 'open'", async () => {
    let peer!: RawSocket;
    await using server = await listen(connection => {
      peer = connection;
      write(connection, response101(connection));
    });
    const order: string[] = [];
    const frameDelivered = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    const ws = new NativeWebSocket(server.url);
    const fail = (why: string) => {
      frameDelivered.reject(new Error(why));
      done.reject(new Error(why));
    };
    ws.addEventListener("error", event => fail((event as ErrorEvent).message));
    ws.addEventListener("close", event => fail(`closed: ${event.code} ${event.reason}`));
    ws.addEventListener(
      "handshake" as any,
      () => {
        order.push("handshake");
        try {
          sendAndWaitSynchronously(peer, textFrame("after the 101"), frameDelivered.promise);
          order.push("handshake returns");
          write(peer, textFrame("last"));
        } catch (error) {
          done.reject(error);
        }
      },
      { once: true },
    );
    ws.addEventListener("open", () => order.push("open"));
    ws.addEventListener("message", event => {
      order.push(`message ${event.data}`);
      if (event.data === "after the 101") frameDelivered.resolve();
      if (event.data === "last") done.resolve();
    });
    try {
      await done.promise;
      expect(order).toEqual(["handshake", "open", "message after the 101", "handshake returns", "message last"]);
    } finally {
      ws.terminate();
    }
  });

  test("a non-101 response still fails with its status code when more body arrives during the listener", async () => {
    let peer!: RawSocket;
    await using server = await listen(connection => {
      peer = connection;
      write(connection, "HTTP/1.1 503 Service Unavailable\r\n\r\n");
    });
    const order: string[] = [];
    const failed = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    const ws = new NativeWebSocket(server.url);
    ws.addEventListener(
      "handshake" as any,
      () => {
        order.push("handshake");
        try {
          sendAndWaitSynchronously(peer, "more of the body", failed.promise);
          order.push("handshake returns");
          done.resolve();
        } catch (error) {
          done.reject(error);
        }
      },
      { once: true },
    );
    ws.addEventListener("error", event => {
      order.push((event as ErrorEvent).message.replace(/^.* failed: /, ""));
      failed.resolve();
    });
    try {
      await done.promise;
      expect(order).toEqual(["handshake", "Expected 101 status code: 503", "handshake returns"]);
    } finally {
      ws.terminate();
    }
  });
});

describe("WebSocket buffered handshake data", () => {
  test("terminating the client from its open handler while handshake bytes are buffered shuts down cleanly", async () => {
    // A raw TCP "websocket server" that appends a complete text frame to the 101
    // response in the same packet, so the client buffers those bytes for a
    // deferred initial-data callback. Scenario 1 tears the client down from the
    // open handler before that callback runs; scenario 2 checks the buffered
    // bytes still arrive as a message when the client stays open.
    const script = String.raw`
      function makeAccept(key) {
        const hasher = new Bun.CryptoHasher("sha1");
        hasher.update(key);
        hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
        return hasher.digest("base64");
      }

      function startServer(afterHandshake) {
        return Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            data(socket, data) {
              const request = data.toString("utf-8");
              const match = /Sec-WebSocket-Key: (.*)\r\n/.exec(request);
              if (!match) return;
              const head =
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + makeAccept(match[1]) + "\r\n" +
                "\r\n";
              const headBytes = new TextEncoder().encode(head);
              // Complete 2-byte text frame ("hi") appended to the handshake
              // response in the same write.
              const frame = Uint8Array.from([0x81, 0x02, 0x68, 0x69]);
              const packet = new Uint8Array(headBytes.length + frame.length);
              packet.set(headBytes, 0);
              packet.set(frame, headBytes.length);
              socket.write(packet);
              socket.flush();
              afterHandshake(socket);
            },
          },
        });
      }

      async function scenarioTeardownFromOpen() {
        const settled = Promise.withResolvers();
        // Server ends the connection right after the handshake packet.
        const server = startServer(socket => socket.end());
        const ws = new WebSocket("ws://127.0.0.1:" + server.port);
        ws.addEventListener("open", () => {
          console.log("scenario-1 open");
          // Tear the client down synchronously while the buffered handshake
          // bytes are still waiting on their deferred callback.
          ws.terminate();
        });
        ws.addEventListener("close", () => settled.resolve());
        ws.addEventListener("error", () => settled.resolve());
        await settled.promise;
        console.log("scenario-1 settled");
        server.stop(true);
      }

      async function scenarioMessageStillDelivered() {
        const received = Promise.withResolvers();
        const server = startServer(() => {});
        const ws = new WebSocket("ws://127.0.0.1:" + server.port);
        ws.addEventListener("message", event => received.resolve(event.data));
        ws.addEventListener("error", () => received.resolve("error"));
        console.log("scenario-2 message " + (await received.promise));
        ws.close();
        server.stop(true);
      }

      scenarioTeardownFromOpen()
        .then(scenarioMessageStillDelivered)
        .then(() => {
          Bun.gc(true);
          console.log("done");
        })
        .catch(err => {
          console.log("error " + err);
          process.exit(1);
        });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout).split("\n")).toEqual([
      "scenario-1 open",
      "scenario-1 settled",
      "scenario-2 message hi",
      "done",
    ]);
    expect(exitCode).toBe(0);
  });
});
