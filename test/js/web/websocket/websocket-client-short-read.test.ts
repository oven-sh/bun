import { type Socket, TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir, tls as tlsCert } from "harness";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import { basename, join } from "node:path";
import { WebSocket } from "ws";

const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "0");

const NativeWebSocket = globalThis.WebSocket;
type NativeWebSocket = globalThis.WebSocket;
type RawSocket = Socket<{ request: string }>;

function makeAccept(key: string): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(key);
  hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  return hasher.digest("base64");
}

function write(socket: RawSocket, bytes: string | Uint8Array) {
  socket.write(typeof bytes === "string" ? Buffer.from(bytes, "latin1") : bytes);
  socket.flush();
}

/** The head of a 101 that answers `request`: the three fields it needs, then the `extra` lines. */
function head101(request: string, extra: string[] = []): string {
  const key = /^Sec-WebSocket-Key:\s*(\S+)/im.exec(request)![1];
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${makeAccept(key)}`,
    ...extra,
    "\r\n",
  ].join("\r\n");
}

/**
 * A raw TCP server that calls `respond` with each complete upgrade request, read as latin1.
 * It answers `GET /barrier` by itself, see `clientHasRead`.
 */
function listen(respond: (socket: RawSocket, request: string) => unknown) {
  const server = Bun.listen<{ request: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { request: "" };
      },
      data(socket, chunk) {
        socket.data.request += chunk.toString("latin1");
        if (!socket.data.request.endsWith("\r\n\r\n")) return;
        const request = socket.data.request;
        socket.data.request = "";
        if (request.startsWith("GET /barrier ")) write(socket, head101(request));
        else respond(socket, request);
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}/`,
    [Symbol.dispose]: () => server.stop(true),
  };
}

/** "open", or what the `error` event says after "failed: ". */
function openOrFailure(ws: NativeWebSocket): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  ws.addEventListener("open", () => resolve("open"));
  ws.addEventListener("error", event =>
    resolve((event as ErrorEvent).message.replace(/^WebSocket connection to '[^']*' failed: /, "")),
  );
  ws.addEventListener("close", event => resolve(`close ${event.code} ${event.reason}`));
  return promise.finally(() => ws.terminate());
}

/**
 * Once this resolves, the client of `socket` has read what was written to it so far, so the next
 * write arrives in another read: those bytes were readable before this handshake began, and the
 * handshake takes several turns of the same event loop. A client that has failed by then ends the
 * test and the server with it, so the outcome of this handshake is not looked at.
 */
async function clientHasRead(socket: RawSocket) {
  await openOrFailure(new NativeWebSocket(`ws://127.0.0.1:${socket.localPort}/barrier`));
}

/** The client gets `bytes` in two reads, the first one of `firstRead` bytes. In one read without it. */
async function writeInReads(socket: RawSocket, bytes: string, firstRead = bytes.length) {
  write(socket, bytes.slice(0, firstRead));
  if (firstRead >= bytes.length) return;
  await clientHasRead(socket);
  write(socket, bytes.slice(firstRead));
}

/** Every `handshake` event, the native event under 'upgrade' and 'unexpected-response' of the ws package. */
function handshakes(ws: NativeWebSocket) {
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
  return "\x81" + String.fromCharCode(text.length) + text;
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
              // The only frame the client sends is its Close.
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

describe("the size limit of a response head", () => {
  // --max-http-header-size (16 KB by default) counts names, values and the status text, as in Node.
  // The client bounds the raw bytes of the head, with 1 KB on top for the framing.
  const MAX_HEAD = 16384 + 1024;
  const TOO_LARGE = "Response headers too large";

  function paddedHead(request: string, size: number): string {
    const padding = size - head101(request, ["X-Pad: "]).length;
    return head101(request, ["X-Pad: " + Buffer.alloc(padding, "a").toString()]);
  }

  // The outcome depends on the size of the head and not on where a read ends.
  test.each([
    [MAX_HEAD, MAX_HEAD, "open"],
    [MAX_HEAD + 1, MAX_HEAD + 1, TOO_LARGE],
    [100_000, 100_000, TOO_LARGE],
    // Node opens this one too.
    [16400, 16390, "open"],
    [MAX_HEAD, MAX_HEAD - 1, "open"],
    [MAX_HEAD + 1, MAX_HEAD, TOO_LARGE],
    [21000, 16000, TOO_LARGE],
    [21000, 20000, TOO_LARGE],
  ])("a 101 head of %i bytes, %i of them in the first read: %s", async (size, firstRead, outcome) => {
    using server = listen((socket, request) => {
      const head = paddedHead(request, size);
      expect(head.length).toBe(size);
      return writeInReads(socket, head, firstRead);
    });
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe(outcome);
  });

  test("a head that never ends fails once it is over the limit", async () => {
    using server = listen(socket => {
      write(socket, "HTTP/1.1 101 Switching Protocols\r\nX-Pad: " + Buffer.alloc(20000, "a").toString());
    });
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe(TOO_LARGE);
  });

  test.each([
    ["in the same read as the whole head", undefined],
    ["in the same read as the end of the head", "HTTP/1.1 101 ".length],
  ])("a frame larger than the limit does not count, %s", async (_, firstRead) => {
    const payload = 20000;
    using server = listen((socket, request) => {
      // An unmasked binary frame with a 64-bit length.
      const frame = "\x82\x7f\0\0\0\0\0\0" + String.fromCharCode(payload >> 8, payload & 0xff);
      return writeInReads(socket, head101(request) + frame + Buffer.alloc(payload).toString("latin1"), firstRead);
    });
    const ws = new NativeWebSocket(server.url);
    ws.binaryType = "arraybuffer";
    expect(((await firstMessage(ws)) as ArrayBuffer).byteLength).toBe(payload);
  });
});

describe("the number of fields in a response head", () => {
  // 8 bytes a field keep 2100 of them under the size limit. Node has no limit on the count either.
  const filler = (i: number) => `x: ${i.toString(36)}`;
  const fillers = (count: number) => Array.from({ length: count }, (_, i) => filler(i));
  const rawHeaders = (head: string) =>
    head
      .split("\r\n")
      .slice(1, -2)
      .flatMap(line => line.split(": "));

  test.each([126, 1000, 2100])("a 101 with %i more fields opens and delivers each of them", async count => {
    let head = "";
    using server = listen((socket, request) => {
      head = head101(request, fillers(count));
      write(socket, head + textFrame("hi"));
    });
    const ws = new NativeWebSocket(server.url);
    const seen = handshakes(ws);
    expect({ message: await firstMessage(ws), seen }).toEqual({
      message: "hi",
      seen: [{ statusCode: 101, rawHeaders: rawHeaders(head) }],
    });
  });

  test("a head cut inside field 201", async () => {
    let head = "";
    using server = listen((socket, request) => {
      head = head101(request, fillers(300));
      return writeInReads(socket, head, head.indexOf(filler(200) + "\r\n") + 4);
    });
    const ws = new NativeWebSocket(server.url);
    const seen = handshakes(ws);
    expect({ outcome: await openOrFailure(ws), seen }).toEqual({
      outcome: "open",
      seen: [{ statusCode: 101, rawHeaders: rawHeaders(head) }],
    });
  });

  test("a 503 with 200 fields fails for its status", async () => {
    using server = listen(socket => {
      write(socket, ["HTTP/1.1 503 Service Unavailable", ...fillers(200), "Content-Length: 0", "\r\n"].join("\r\n"));
    });
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe("Expected 101 status code: 503");
  });
});

describe("the first bytes of the answer", () => {
  // The server keeps the connection open, so nothing but these bytes can fail the handshake.
  test.each(["f", "foo\r\n", "foo\r\n\r\n", "HTTQ", "HTTP/2", "\r\nHTTP", "HTTP/1.1 100 Continue\r\n\r\nfoo"])(
    "%j cannot become a response: fails at once",
    async bytes => {
      const read = Promise.withResolvers<string>();
      using server = listen(async socket => {
        write(socket, bytes);
        await clientHasRead(socket);
        read.resolve("still waiting");
      });
      const ws = new NativeWebSocket(server.url);
      expect(await Promise.race([openOrFailure(ws), read.promise])).toBe("Invalid response");
    },
  );

  test.each([1, 4, 7, 8])("a 101 whose first %i bytes come alone opens", async firstRead => {
    using server = listen((socket, request) => writeInReads(socket, head101(request), firstRead));
    expect(await openOrFailure(new NativeWebSocket(server.url))).toBe("open");
  });
});

describe("interim responses before the final one", () => {
  const CONTINUE = "HTTP/1.1 100 Continue\r\n\r\n";
  const EARLY_HINTS = "HTTP/1.1 103 Early Hints\r\nLink: </style.css>; rel=preload\r\n\r\n";

  describe.each([
    ["100 Continue", CONTINUE],
    ["103 Early Hints", EARLY_HINTS],
    ["both", CONTINUE + EARLY_HINTS],
  ])("%s", (_, interim) => {
    test.each([
      ["in one read", undefined],
      ["cut inside the interim response", 12],
      ["cut after the interim response", interim.length],
    ])("then a 101, %s", async (_, firstRead) => {
      using server = listen((socket, request) => {
        return writeInReads(socket, interim + head101(request) + textFrame("hi"), firstRead);
      });
      const ws = new NativeWebSocket(server.url);
      const seen = handshakes(ws);
      expect({ message: await firstMessage(ws), statusCodes: seen.map(({ statusCode }) => statusCode) }).toEqual({
        message: "hi",
        statusCodes: [101],
      });
    });
  });

  test("then a 404", async () => {
    using server = listen(socket => write(socket, CONTINUE + "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"));
    const ws = new NativeWebSocket(server.url);
    const seen = handshakes(ws);
    expect({ outcome: await openOrFailure(ws), statusCodes: seen.map(({ statusCode }) => statusCode) }).toEqual({
      outcome: "Expected 101 status code: 404",
      statusCodes: [404],
    });
  });
});

describe("Sec-WebSocket-Extensions in the 101", () => {
  const UNSUPPORTED = "Unsupported websocket extension";

  function negotiate(lines: string[], options?: Bun.WebSocketOptions) {
    const server = listen((socket, request) => write(socket, head101(request, lines)));
    const ws = new NativeWebSocket(server.url, options);
    const { promise, resolve } = Promise.withResolvers<string>();
    ws.addEventListener("open", () => resolve(`open with "${ws.extensions}"`));
    return Promise.race([promise, openOrFailure(ws)]).finally(() => server[Symbol.dispose]());
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
    // The characters after "9" in ASCII.
    "permessage-deflate; server_max_window_bits=:",
    "permessage-deflate; server_max_window_bits==",
    "permessage-deflate; client_max_window_bits=?",
    "permessage-deflate; client_no_context_takeover=1",
    "permessage-deflate; server_no_context_takeover; server_no_context_takeover",
    "permessage-deflate; client_max_window_bits=10; client_max_window_bits=10",
  ])("refuses %j", async value => {
    expect(await negotiate([`Sec-WebSocket-Extensions: ${value}`])).toBe(UNSUPPORTED);
  });

  test("refuses a second header line", async () => {
    const line = "Sec-WebSocket-Extensions: permessage-deflate";
    expect(await negotiate([line, line])).toBe(UNSUPPORTED);
  });

  test("refuses permessage-deflate when it was not offered", async () => {
    const line = "Sec-WebSocket-Extensions: permessage-deflate";
    expect(await negotiate([line], { perMessageDeflate: false })).toBe(UNSUPPORTED);
  });
});

describe("the upgrade request", () => {
  test("header values go out one byte per code unit, like fetch()", async () => {
    // path.basename returns a 16-bit string here, though every code unit is below 0x100.
    const headers = { "X-Latin1": "vàlüé-ñ", "X-Utf16": basename("/tmp/café.txt"), "Host": "hôte" };
    let request = "";
    using server = listen((socket, received) => {
      request = received;
      write(socket, head101(received));
    });
    expect(await openOrFailure(new NativeWebSocket(server.url, { headers }))).toBe("open");
    const sent = Object.fromEntries(
      request
        .split("\r\n")
        .map(line => line.split(": "))
        .filter(([name]) => name in headers),
    );
    expect(sent).toEqual(headers);
  });
});

describe("a connection that fails says why", () => {
  function failure(ws: NativeWebSocket) {
    const { promise, resolve, reject } = Promise.withResolvers<{ code: unknown; message: string }>();
    ws.addEventListener("open", () => reject(new Error("opened")));
    ws.addEventListener("error", event => {
      const { error, message } = event as ErrorEvent;
      resolve({ code: error.code, message: message.replace(/^WebSocket connection to '[^']*' failed: /, "") });
    });
    return promise.finally(() => ws.terminate());
  }

  test("nobody listens on the port", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const { port } = server;
    server.stop(true);
    expect(await failure(new NativeWebSocket(`ws://127.0.0.1:${port}/`))).toEqual({
      code: "ECONNREFUSED",
      message: "Failed to connect",
    });
  });

  test("the host name does not resolve", async () => {
    // A DNS label of more than 63 bytes is refused by getaddrinfo without a query.
    const host = Buffer.alloc(64, "a").toString() + ".com";
    expect(await failure(new NativeWebSocket(`ws://${host}/`))).toEqual({
      code: "ENOTFOUND",
      message: "Failed to connect",
    });
  });

  test.each([
    ["a FIN", (socket: net.Socket) => void socket.end(), "Connection ended"],
    ["a reset", (socket: net.Socket) => void socket.resetAndDestroy(), "Connection ended: read ECONNRESET"],
  ])("%s in place of an answer", async (_, drop, message) => {
    const server = net.createServer(socket => socket.on("error", () => {}).once("data", () => drop(socket)));
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const ws = new NativeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      expect(await failure(ws)).toEqual({ code: "ECONNRESET", message });
    } finally {
      server.close();
    }
  });

  // connect(2) fails inside the constructor here. Winsock leaves no errno.
  test.skipIf(isWindows)("the unix socket does not exist", async () => {
    using dir = tempDir("ws-missing-unix-socket", {});
    const ws = new NativeWebSocket(`ws+unix://${join(String(dir), "missing.sock")}`);
    expect(ws.readyState).toBe(NativeWebSocket.CONNECTING);
    expect(await failure(ws)).toEqual({ code: "ENOENT", message: "Failed to connect" });
  });

  describe("TLS", () => {
    const serve = () =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        tls: tlsCert,
        fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("no", { status: 400 })),
        websocket: { message() {} },
      });

    test("the certificate is not trusted", async () => {
      await using server = serve();
      expect(await failure(new NativeWebSocket(`wss://127.0.0.1:${server.port}/`))).toEqual({
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        message: "TLS handshake failed: self signed certificate",
      });
    });

    test("the certificate is for another name", async () => {
      await using server = serve();
      const tls = { ca: tlsCert.cert, serverName: "evil.test" };
      expect(await failure(new NativeWebSocket(`wss://127.0.0.1:${server.port}/`, { tls }))).toEqual({
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
        message: "TLS handshake failed: Hostname/IP does not match certificate's altnames",
      });
    });
  });
});

describe("giving up while CONNECTING", () => {
  test.each(["close", "terminate"] as const)("%s() ends the connection with a FIN, not a reset", async method => {
    const requested = Promise.withResolvers<void>();
    const gone = Promise.withResolvers<{ fin: boolean; error?: string }>();
    const server = net.createServer(socket => {
      const seen: { fin: boolean; error?: string } = { fin: false };
      socket.on("data", () => requested.resolve());
      socket.on("end", () => void (seen.fin = true));
      socket.on("error", (error: NodeJS.ErrnoException) => void (seen.error = error.code));
      socket.on("close", () => gone.resolve(seen));
    });
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const ws = new NativeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      ws.addEventListener("error", () => {});
      await requested.promise;
      ws[method]();
      expect(await gone.promise).toEqual({ fin: true });
    } finally {
      server.close();
    }
  });
});

describe("reads while a handshake listener spins the event loop", () => {
  // For a listener: the peer sends `bytes`, then this waits synchronously for `until`.
  // `expect().resolves` is not awaited on purpose. It ticks the event loop until the promise settles.
  function sendAndWaitSynchronously(peer: RawSocket, bytes: string, until: Promise<void>) {
    write(peer, bytes);
    expect(until).resolves.toBeUndefined();
  }

  test("a frame that arrives during the listener of a 101 is delivered after 'open'", async () => {
    let peer!: RawSocket;
    using server = listen((socket, request) => {
      peer = socket;
      write(socket, head101(request));
    });
    const order: string[] = [];
    const laterFrameRead = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    const ws = new NativeWebSocket(server.url);
    const fail = (why: string) => {
      laterFrameRead.reject(new Error(why));
      done.reject(new Error(why));
    };
    ws.addEventListener("error", event => fail((event as ErrorEvent).message));
    ws.addEventListener("close", event => fail(`closed: ${event.code} ${event.reason}`));
    ws.addEventListener(
      "handshake" as any,
      () => {
        order.push("handshake");
        try {
          sendAndWaitSynchronously(peer, textFrame("after the 101"), laterFrameRead.promise);
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
      if (event.data === "after the 101") laterFrameRead.resolve();
      if (event.data === "last") done.resolve();
    });
    try {
      await done.promise;
      expect(order).toEqual(["handshake", "open", "message after the 101", "handshake returns", "message last"]);
    } finally {
      ws.terminate();
    }
  });

  test("a response that is not a 101 fails for its status when the listener lets in more of the body", async () => {
    let peer!: RawSocket;
    using server = listen(socket => {
      peer = socket;
      write(socket, "HTTP/1.1 503 Service Unavailable\r\n\r\n");
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
