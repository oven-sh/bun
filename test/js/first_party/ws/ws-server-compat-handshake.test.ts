// Tests the opening handshake of a `ws` WebSocketServer, using a raw TCP client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { Duplex } from "node:stream";
import type { ServerOptions } from "ws";
import {
  createInflater,
  createServer,
  deflate,
  deflateWithContext,
  implementations,
  listen,
  nextEvent,
  OP,
  openServer,
  RawClient,
  type RequestOptions,
  serve,
  show,
  showError,
  tryCall,
} from "./ws-raw-peer";

const switchingProtocols = [
  "HTTP/1.1 101 Switching Protocols",
  "Upgrade: websocket",
  "Connection: Upgrade",
  "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
];
// What `responseLines()` returns for an abortHandshake() response.
const errorResponse = (status: string, body: string, headers: string[] = []) => [
  `HTTP/1.1 ${status}`,
  "Connection: close",
  "Content-Type: text/html",
  `Content-Length: ${body.length}`,
  ...headers,
  "",
  body,
];
const badExtensions = errorResponse("400 Bad Request", "Invalid or unacceptable Sec-WebSocket-Extensions header");
const badVersion = errorResponse("400 Bad Request", "Missing or invalid Sec-WebSocket-Version header", [
  "Sec-WebSocket-Version: 13, 8",
]);
const extensions = (value: string) => ({ headers: { "Sec-WebSocket-Extensions": value } });
const protocols = (value: string) => ({ headers: { "Sec-WebSocket-Protocol": value } });

type RejectedRequest = {
  label: string;
  options?: ServerOptions;
  request?: RequestOptions;
  response: string[];
  /** Rejected without emitting 'wsClientError'. */
  silent?: boolean;
};

const rejectedRequests: RejectedRequest[] = [
  {
    label: "POST",
    request: { method: "POST" },
    response: errorResponse("405 Method Not Allowed", "Invalid HTTP method"),
  },
  {
    label: "Upgrade: foo",
    request: { headers: { Upgrade: "foo" } },
    response: errorResponse("400 Bad Request", "Invalid Upgrade header"),
  },
  {
    label: "missing Sec-WebSocket-Key",
    request: { headers: { "Sec-WebSocket-Key": null } },
    response: errorResponse("400 Bad Request", "Missing or invalid Sec-WebSocket-Key header"),
  },
  {
    label: "an 8-byte Sec-WebSocket-Key",
    request: { headers: { "Sec-WebSocket-Key": "P5l8BJcZwRc=" } },
    response: errorResponse("400 Bad Request", "Missing or invalid Sec-WebSocket-Key header"),
  },
  {
    label: "missing Sec-WebSocket-Version",
    request: { headers: { "Sec-WebSocket-Version": null } },
    response: badVersion,
  },
  { label: "Sec-WebSocket-Version: 12", request: { headers: { "Sec-WebSocket-Version": "12" } }, response: badVersion },
  {
    label: "Sec-WebSocket-Protocol: foo;bar",
    request: protocols("foo;bar"),
    response: errorResponse("400 Bad Request", "Invalid Sec-WebSocket-Protocol header"),
  },
  {
    label: "Sec-WebSocket-Protocol: foo, foo",
    request: protocols("foo, foo"),
    response: errorResponse("400 Bad Request", "Invalid Sec-WebSocket-Protocol header"),
  },
  {
    label: "a path that doesn't match options.path",
    options: { path: "/ws" },
    request: { path: "/other" },
    response: errorResponse("400 Bad Request", "Bad Request"),
    silent: true,
  },
  {
    label: "server_max_window_bits=foo",
    options: { perMessageDeflate: true },
    request: extensions("permessage-deflate; server_max_window_bits=foo"),
    response: badExtensions,
  },
  {
    label: "an unknown permessage-deflate parameter",
    options: { perMessageDeflate: true },
    request: extensions("permessage-deflate; foo"),
    response: badExtensions,
  },
  {
    label: "a duplicate permessage-deflate parameter",
    options: { perMessageDeflate: true },
    request: extensions("permessage-deflate; server_no_context_takeover; server_no_context_takeover"),
    response: badExtensions,
  },
  {
    label: "a malformed Sec-WebSocket-Extensions header",
    options: { perMessageDeflate: true },
    request: extensions("permessage-deflate;"),
    response: badExtensions,
  },
  {
    label: "server_no_context_takeover when serverNoContextTakeover is false",
    options: { perMessageDeflate: { serverNoContextTakeover: false } },
    request: extensions("permessage-deflate; server_no_context_takeover"),
    response: badExtensions,
  },
  {
    label: "missing client_max_window_bits when clientMaxWindowBits is a number",
    options: { perMessageDeflate: { clientMaxWindowBits: 10 } },
    request: extensions("permessage-deflate"),
    response: badExtensions,
  },
  {
    label: "verifyClient(info) returns false",
    options: { verifyClient: () => false },
    response: errorResponse("401 Unauthorized", "Unauthorized"),
    silent: true,
  },
  {
    label: "verifyClient calls callback(false)",
    options: { verifyClient: (_info, callback) => process.nextTick(callback, false) },
    response: errorResponse("401 Unauthorized", "Unauthorized"),
    silent: true,
  },
  {
    label: "verifyClient calls callback(false, 404)",
    options: { verifyClient: (_info, callback) => process.nextTick(callback, false, 404) },
    response: errorResponse("404 Not Found", "Not Found"),
    silent: true,
  },
  {
    label: "verifyClient calls callback(false, 503, message, headers)",
    options: {
      verifyClient: (_info, callback) => process.nextTick(callback, false, 503, "Bad day", { "Retry-After": 120 }),
    },
    response: errorResponse("503 Service Unavailable", "Bad day", ["Retry-After: 120"]),
    silent: true,
  },
];

describe.each(implementations)("ws server opening handshake ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket, WebSocketServer } = implementation;

  test("the 101 response has four lines and no Date header, and only frames follow it", async () => {
    await using server = await openServer(implementation);
    expect(server.client.head).toBe(switchingProtocols.join("\r\n"));
    expect(await server.client.roundTrip()).toEqual([]);
  });

  test.each<{ label: string; options?: ServerOptions; request: RequestOptions }>([
    { label: "Sec-WebSocket-Version: 8", request: { headers: { "Sec-WebSocket-Version": "8" } } },
    { label: "Upgrade: WebSocket", request: { headers: { Upgrade: "WebSocket" } } },
    { label: "options.path with a query string", options: { path: "/ws" }, request: { path: "/ws?token=1" } },
  ])("accepts $label", async ({ options, request }) => {
    await using server = await openServer(implementation, options, request);
    expect(await server.client.responseLines()).toEqual(switchingProtocols);
    expect(server.req.url).toBe(request.path ?? "/");
  });

  test("'headers' listeners get the 101's header lines, and the lines they add are sent", async () => {
    await using server = await createServer(implementation);
    const seen: unknown[] = [];
    server.wss.on("headers", (headers, req) => {
      seen.push([...headers], req.url);
      headers.push("X-Foo: bar", "Set-Cookie: io=abc; Path=/; HttpOnly", "Set-Cookie: b=2");
    });
    const client = server.connect({ path: "/x?y=1", ...protocols("a, b") });
    expect(await client.responseLines()).toEqual([
      ...switchingProtocols,
      "Sec-WebSocket-Protocol: a",
      "X-Foo: bar",
      "Set-Cookie: io=abc; Path=/; HttpOnly",
      "Set-Cookie: b=2",
    ]);
    expect(seen).toEqual([[...switchingProtocols, "Sec-WebSocket-Protocol: a"], "/x?y=1"]);
  });

  // Same as `socket.write(string)`, regardless of what the other lines contain.
  test.each([
    { label: "alone", lines: ["X-Name: café"] },
    { label: "alongside a character above U+00FF", lines: ["X-Name: café", "X-Price: 5 €"] },
  ])("sends a non-ASCII 101 header line as UTF-8 ($label)", async ({ lines }) => {
    await using server = await createServer(implementation);
    server.wss.on("headers", headers => void headers.push(...lines));
    const sent = (await server.connect().responseLines()).slice(switchingProtocols.length);
    expect(sent).toEqual(lines.map(line => Buffer.from(line).toString("latin1")));
  });

  test("verifyClient, handleProtocols, 'headers' and 'connection' run in that order", async () => {
    const order: string[] = [];
    await using server = await createServer(implementation, {
      verifyClient: () => order.push("verifyClient") > 0,
      handleProtocols: () => (order.push("handleProtocols"), "a"),
    });
    server.wss.on("headers", () => order.push("headers"));
    server.wss.on("connection", (...args) => order.push(`connection ${args.map(show).join(" ")}`));
    await server.connect(protocols("a")).response;
    expect(order).toEqual(["verifyClient", "handleProtocols", "headers", "connection WebSocket IncomingMessage"]);
  });

  describe("subprotocols", () => {
    test.each<{ label: string; offer: string | null; returns?: string | false; calls: string[]; protocol: string }>([
      {
        label: "picks the first offered protocol without handleProtocols",
        offer: "foo, bar",
        calls: [],
        protocol: "foo",
      },
      {
        label: "handleProtocols gets a Set and the request, and its return value is used",
        offer: "foo, bar",
        returns: "bar",
        calls: ['Set("foo", "bar") /chat'],
        protocol: "bar",
      },
      {
        label: "selects no protocol when handleProtocols returns false",
        offer: "foo, bar",
        returns: false,
        calls: ['Set("foo", "bar") /chat'],
        protocol: "",
      },
      {
        label: "doesn't call handleProtocols when the client offers none",
        offer: null,
        returns: "x",
        calls: [],
        protocol: "",
      },
    ])("$label", async ({ offer, returns, calls, protocol }) => {
      const seen: string[] = [];
      const handleProtocols = (set: Set<string>, req: http.IncomingMessage) => (
        seen.push(`${show(set)} ${req.url}`),
        returns!
      );
      await using server = await openServer(implementation, returns === undefined ? {} : { handleProtocols }, {
        path: "/chat",
        headers: { "Sec-WebSocket-Protocol": offer },
      });
      expect(await server.client.responseLines()).toEqual(
        protocol ? [...switchingProtocols, `Sec-WebSocket-Protocol: ${protocol}`] : switchingProtocols,
      );
      expect(server.ws.protocol).toBe(protocol);
      expect(seen).toEqual(calls);
    });
  });

  describe("permessage-deflate", () => {
    const typicalOffer = "permessage-deflate; client_max_window_bits";
    const allParameters =
      "permessage-deflate; server_no_context_takeover; client_no_context_takeover; " +
      "server_max_window_bits=10; client_max_window_bits=11";

    test.each<{ label: string; option?: ServerOptions["perMessageDeflate"]; offer: string; reply: string | null }>([
      { label: "is off by default", offer: typicalOffer, reply: null },
      { label: "false: doesn't even parse the header", option: false, offer: "permessage-deflate;", reply: null },
      { label: "true: accepts the offer", option: true, offer: typicalOffer, reply: "permessage-deflate" },
      { label: "true: accepts every offered parameter", option: true, offer: allParameters, reply: allParameters },
      {
        label: "adds the server's configured parameters",
        option: { serverNoContextTakeover: true, clientNoContextTakeover: true, serverMaxWindowBits: 10 },
        offer: typicalOffer,
        reply: "permessage-deflate; server_no_context_takeover; client_no_context_takeover; server_max_window_bits=10",
      },
      {
        label: "replies to client_max_window_bits with clientMaxWindowBits",
        option: { clientMaxWindowBits: 10 },
        offer: typicalOffer,
        reply: "permessage-deflate; client_max_window_bits=10",
      },
      {
        label: "uses the first acceptable offer",
        option: { serverMaxWindowBits: false as any },
        offer: "permessage-deflate; server_max_window_bits=10, permessage-deflate; client_no_context_takeover",
        reply: "permessage-deflate; client_no_context_takeover",
      },
      { label: "ignores an unknown extension", option: true, offer: "foo; bar", reply: null },
      {
        label: "ignores an unknown extension offered alongside it",
        option: true,
        offer: "foo; bar, " + typicalOffer,
        reply: "permessage-deflate",
      },
    ])("$label", async ({ option, offer, reply }) => {
      await using server = await openServer(implementation, { perMessageDeflate: option }, extensions(offer));
      expect(await server.client.responseLines()).toEqual(
        reply === null ? switchingProtocols : [...switchingProtocols, `Sec-WebSocket-Extensions: ${reply}`],
      );
      expect(server.ws.extensions).toBe(reply === null ? "" : "permessage-deflate");
    });

    // zlib can't raw-deflate with an 8-bit window, so Node's zlib silently uses 9 bits. An 8-bit inflater can still
    // read that, because zlib's match distances stay under 256.
    test.each(["", "; server_no_context_takeover; client_no_context_takeover"])(
      "accepts 8-bit windows and compresses in both directions%s",
      async noContextTakeover => {
        const offer = `permessage-deflate; server_max_window_bits=8; client_max_window_bits=8${noContextTakeover}`;
        await using server = await openServer(
          implementation,
          { perMessageDeflate: { threshold: 0 } },
          extensions(offer),
        );
        const { ws, client } = server;
        expect(client.header("sec-websocket-extensions")).toBe(offer);
        ws.on("message", (data, isBinary) => ws.send(data, { binary: isBinary }));

        // The copies are 200 and 400 bytes apart. A compressor with a window over 9 bits back-references the second
        // pair, and the 8-bit inflater then fails with "invalid distance too far back".
        const near = randomBytes(200);
        const far = randomBytes(400);
        const messages = [Buffer.concat([near, near]), near, Buffer.concat([far, far]), far];
        const payloads = noContextTakeover
          ? messages.map(message => deflate(message, { windowBits: 8 }))
          : await deflateWithContext(messages, 8);

        // Small output chunks force zlib to resolve back-references through its window.
        const inflaterOptions = { windowBits: 8, chunkSize: 64 };
        let inflate = createInflater(inflaterOptions);
        for (const [i, message] of messages.entries()) {
          client.binary(payloads[i], { rsv1: true });
          const frame = (await client.nextFrame())!;
          expect([frame.opcode, frame.rsv]).toEqual([OP.binary, 4]);
          if (noContextTakeover) inflate = createInflater(inflaterOptions);
          expect(inflate(frame.payload).equals(message)).toBe(true);
        }
      },
    );
  });

  describe("rejected requests", () => {
    test.each(rejectedRequests)("$label", async ({ options, request, response }) => {
      await using server = await createServer(implementation, options);
      let connections = 0;
      server.wss.on("connection", () => connections++);
      const client = server.connect(request);
      expect(await client.responseLines()).toEqual(response);
      // The server closes the connection.
      await client.ended;
      expect(connections).toBe(0);
      expect(server.wss.clients.size).toBe(0);
    });

    test("a non-upgrade request gets 426", async () => {
      await using server = await createServer(implementation);
      const client = server.connect({ raw: "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" });
      expect(await client.responseLines()).toEqual([
        "HTTP/1.1 426 Upgrade Required",
        "Content-Length: 16",
        "Content-Type: text/plain",
        "Connection: close",
        "",
        "Upgrade Required",
      ]);
    });
  });

  // With a listener attached, ws sends nothing and the listener has to write the response.
  describe("'wsClientError'", () => {
    const teapot = ["HTTP/1.1 418 teapot", "Connection: close", "Content-Length: 0"];

    async function connectWithErrorListener({ options, request }: RejectedRequest) {
      await using server = await createServer(implementation, options);
      const seen: unknown[] = [];
      server.wss.on("wsClientError", (error, socket, req) => {
        seen.push(showError(error), socket === req.socket, req.method);
        socket.end([...teapot, "", ""].join("\r\n"));
      });
      return { response: await server.connect(request).responseLines(), seen };
    }

    test.each(rejectedRequests.filter(row => !row.silent))(
      "$label: emitted, and the listener writes the response",
      async row => {
        expect(await connectWithErrorListener(row)).toEqual({
          response: [...teapot, "", ""],
          seen: [`Error ${JSON.stringify(row.response.at(-1))}`, true, row.request?.method ?? "GET"],
        });
      },
    );

    test.each(rejectedRequests.filter(row => row.silent))(
      "$label: not emitted, sends the default response",
      async row => {
        expect(await connectWithErrorListener(row)).toEqual({ response: row.response, seen: [] });
      },
    );
  });

  describe("verifyClient", () => {
    test.each<{ label: string; headers: Record<string, string>; origin: string | undefined }>([
      { label: "Origin", headers: { Origin: "https://example.com" }, origin: "https://example.com" },
      { label: "no Origin", headers: {}, origin: undefined },
      {
        label: "version 8: Sec-WebSocket-Origin",
        headers: {
          "Sec-WebSocket-Version": "8",
          Origin: "https://a.example",
          "Sec-WebSocket-Origin": "https://b.example",
        },
        origin: "https://b.example",
      },
    ])("info is { origin, secure, req } ($label)", async ({ headers, origin }) => {
      const seen: unknown[] = [];
      await using server = await openServer(
        implementation,
        { verifyClient: info => seen.push(Object.keys(info), info.origin, info.secure, info.req.url) > 0 },
        { path: "/v", headers },
      );
      expect(await server.client.responseLines()).toEqual(switchingProtocols);
      expect(seen).toEqual([["origin", "secure", "req"], origin, false, "/v"]);
    });

    test("the handshake waits for the callback when verifyClient takes two parameters", async () => {
      const verifyCall = Promise.withResolvers<(result: boolean) => void>();
      await using server = await createServer(implementation, {
        verifyClient: (_info, callback) => verifyCall.resolve(callback),
      });
      const states: number[] = [];
      server.wss.on("connection", ws => {
        states.push(ws.readyState);
        ws.send("hi");
      });
      const client = server.connect();
      const accept = await verifyCall.promise;
      expect(states).toEqual([]);
      accept(true);
      expect(states).toEqual([WebSocket.OPEN]);
      expect(await client.responseLines()).toEqual(switchingProtocols);
      expect(await client.next()).toBe('text "hi"');
    });

    // After a FIN the socket stays half-open until the late callback destroys it. An RST destroys it immediately.
    test.each([
      { how: "FIN", disconnect: (client: RawClient) => client.end(), eventName: "end" },
      { how: "RST", disconnect: (client: RawClient) => client.reset(), eventName: "close" },
    ])("no 'connection' if the client disconnects ($how) before it's accepted", async ({ disconnect, eventName }) => {
      type VerifyCall = { socket: Duplex; accept(result: boolean): void };
      let verifyCall = Promise.withResolvers<VerifyCall>();
      await using server = await createServer(implementation, {
        verifyClient: (info, accept) => verifyCall.resolve({ socket: info.req.socket, accept }),
      });
      const urls: unknown[] = [];
      server.wss.on("connection", (_ws, req) => urls.push(req.url));

      const client = server.connect({ path: "/gone" });
      const { socket, accept } = await verifyCall.promise;
      const disconnected = nextEvent(socket, eventName);
      disconnect(client);
      await disconnected;
      expect(tryCall(() => accept(true))).toBe("undefined");
      expect(socket.destroyed).toBe(true);
      expect(server.wss.clients.size).toBe(0);

      verifyCall = Promise.withResolvers();
      const second = server.connect({ path: "/here" });
      (await verifyCall.promise).accept(true);
      expect(await second.responseLines()).toEqual(switchingProtocols);
      expect(urls).toEqual(["/here"]);
    });
  });

  describe("handleUpgrade()", () => {
    test.each([
      { when: "after a microtask", wait: () => Promise.resolve() },
      { when: "on a later event loop tick", wait: () => new Promise(setImmediate) },
    ])("works when called $when", async ({ wait }) => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ noServer: true });
      const states: number[] = [];
      web.server.on("upgrade", async (req, socket, head) => {
        await wait();
        wss.handleUpgrade(req, socket, head, ws => {
          states.push(ws.readyState);
          ws.send("late");
        });
      });
      const client = web.connect();
      expect(await client.responseLines()).toEqual(switchingProtocols);
      expect(await client.next()).toBe('text "late"');
      expect(states).toEqual([WebSocket.OPEN]);
    });

    test("throws when called twice with the same socket, and the connection stays open", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ noServer: true });
      const calls: string[] = [];
      web.server.on("upgrade", (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, () => calls.push("first callback"));
        calls.push(tryCall(() => wss.handleUpgrade(req, socket, head, () => calls.push("second callback"))));
      });
      const client = web.connect();
      expect(await client.responseLines()).toEqual(switchingProtocols);
      expect(calls).toEqual([
        "first callback",
        'throws Error "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"',
      ]);
      expect(await client.roundTrip()).toEqual([]);
    });

    test("responds with 503 after close()", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ noServer: true });
      let called = false;
      web.server.on("upgrade", (req, socket, head) => {
        wss.close();
        wss.handleUpgrade(req, socket, head, () => (called = true));
      });
      expect(await web.connect().responseLines()).toEqual(
        errorResponse("503 Service Unavailable", "Service Unavailable"),
      );
      expect(called).toBe(false);
    });

    test("one 'upgrade' listener can route to two noServer servers", async () => {
      await using web = await serve(http.createServer());
      const a = new WebSocketServer({ noServer: true });
      const b = new WebSocketServer({ noServer: true });
      a.on("connection", ws => ws.send("from a"));
      b.on("connection", ws => ws.send("from b"));
      web.server.on("upgrade", (req, socket, head) => {
        const wss = req.url === "/a" ? a : req.url === "/b" ? b : null;
        if (!wss) return socket.destroy();
        wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
      });
      for (const name of ["a", "b"]) {
        const client = web.connect({ path: "/" + name });
        expect(await client.responseLines()).toEqual(switchingProtocols);
        expect(await client.next()).toBe(`text "from ${name}"`);
      }
      const client = web.connect({ path: "/c" });
      expect((await client.response).status).toBe("no response");
      expect(await client.next()).toBe("EOF");
      expect([a.clients.size, b.clients.size]).toEqual([1, 1]);
    });

    test("an 'upgrade' listener can write its own 401 for some requests", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ noServer: true });
      web.server.on("upgrade", (req, socket, head) => {
        if (req.url === "/public") return wss.handleUpgrade(req, socket, head, () => {});
        socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        socket.destroy();
      });
      expect(await web.connect({ path: "/private" }).responseLines()).toEqual([
        "HTTP/1.1 401 Unauthorized",
        "Content-Length: 0",
        "Connection: close",
        "",
        "",
      ]);
      expect(await web.connect({ path: "/public" }).responseLines()).toEqual(switchingProtocols);
    });

    // @fastify/websocket and express-ws do this.
    test("a ServerResponse on the upgrade socket can respond, and doesn't break handleUpgrade()", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ noServer: true });
      web.server.on("upgrade", (req, socket, head) => {
        const res = new http.ServerResponse(req);
        res.assignSocket(socket as any);
        if (req.url === "/deny") {
          res.writeHead(403, { "Content-Length": 2, Connection: "close" });
          return res.end("no");
        }
        wss.handleUpgrade(req, socket, head, ws => ws.on("message", data => ws.send("echo:" + data)));
      });
      const client = web.connect();
      expect(await client.responseLines()).toEqual(switchingProtocols);
      client.text("hi");
      expect(await client.next()).toBe('text "echo:hi"');
      expect(await web.connect({ path: "/deny" }).responseLines()).toEqual([
        "HTTP/1.1 403 Forbidden",
        "Content-Length: 2",
        "Connection: close",
        "",
        "no",
      ]);
    });

    // Without an 'upgrade' listener the request is emitted as 'request'. Bun's node:http doesn't give that listener a
    // raw socket, so npm ws sends its 101 and then loses the connection.
    test.skipIf(!builtin)("works from a 'request' listener", async () => {
      const wss = new WebSocketServer({ noServer: true });
      const seen: unknown[] = [];
      await using web = await serve(
        http.createServer(req => {
          seen.push(req.url, req.headers.upgrade);
          wss.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => {
            seen.push(ws.readyState);
            ws.on("message", data => ws.send("echo:" + data));
          });
        }),
      );
      const client = web.connect();
      expect(await client.responseLines()).toEqual(switchingProtocols);
      expect(seen).toEqual(["/", "websocket", WebSocket.OPEN]);
      client.text("hi");
      expect(await client.next()).toBe('text "echo:hi"');
    });

    test.skipIf(!builtin)("rejects an invalid handshake from a 'request' listener through its response", async () => {
      const wss = new WebSocketServer({ noServer: true });
      const { promise: headersSent, resolve } = Promise.withResolvers<boolean>();
      await using web = await serve(
        http.createServer((req, res) => {
          wss.handleUpgrade(req, req.socket, Buffer.alloc(0), () => {});
          resolve(res.headersSent);
        }),
      );
      const client = web.connect({ headers: { "Sec-WebSocket-Version": "12" } });
      expect(await headersSent).toBe(true);
      expect(await client.responseLines()).toEqual(badVersion);
    });
  });

  // Each server handles every upgrade on the http.Server, so the first one rejects requests meant for the second.
  test("two servers with different paths on one http.Server: only the first one's path works", async () => {
    await using web = await serve(http.createServer());
    const a = new WebSocketServer({ server: web.server, path: "/a" });
    const b = new WebSocketServer({ server: web.server, path: "/b" });
    a.on("connection", ws => ws.send("from a"));
    b.on("connection", ws => ws.send("from b"));
    const client = web.connect({ path: "/a" });
    expect(await client.responseLines()).toEqual(switchingProtocols);
    expect(await client.next()).toBe('text "from a"');
    const other = web.connect({ path: "/b" });
    expect(await other.responseLines()).toEqual(errorResponse("400 Bad Request", "Bad Request"));
    await other.ended;
    expect(b.clients.size).toBe(0);
  });

  describe("constructor", () => {
    test.each([
      { label: "", args: () => [] },
      { label: "{}", args: () => [{}] },
      { label: "{ port, noServer }", args: () => [{ port: 0, noServer: true }] },
      { label: "{ server, noServer }", args: () => [{ server: http.createServer(), noServer: true }] },
      { label: "{ port, server }", args: () => [{ port: 0, server: http.createServer() }] },
    ])("new WebSocketServer($label) throws", ({ args }) => {
      expect(tryCall(() => new WebSocketServer(...(args() as [])))).toBe(
        String.raw`throws TypeError "One and only one of the \"port\", \"server\", or \"noServer\" options must be specified"`,
      );
    });

    test("fills in default options", () => {
      const wss = new WebSocketServer({ noServer: true });
      expect(wss.options).toMatchObject({
        WebSocket,
        allowSynchronousEvents: true,
        autoPong: true,
        backlog: null,
        clientTracking: true,
        handleProtocols: null,
        host: null,
        maxPayload: 100 * 1024 * 1024,
        noServer: true,
        path: null,
        perMessageDeflate: false,
        port: null,
        server: null,
        skipUTF8Validation: false,
        verifyClient: null,
      });
      expect(wss.path).toBeUndefined();
      expect(
        Object.keys(wss)
          .filter(key => !["_events", "_eventsCount", "_maxListeners"].includes(key))
          .sort(),
      ).toEqual(["_shouldEmitClose", "_state", "clients", "options"]);
    });

    test("emits 'error' EADDRINUSE when the port is in use", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ port: web.port, host: "127.0.0.1" });
      const [error] = await nextEvent(wss, "error");
      expect(error.code).toBe("EADDRINUSE");
    });

    test("the callback runs on 'listening', with the http.Server as `this`", async () => {
      let self: unknown;
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, function (this: unknown) {
        self = this;
      });
      await once(wss, "listening");
      await new Promise(resolve => wss.close(resolve));
      expect(self).toBeInstanceOf(http.Server);
    });
  });

  describe("address()", () => {
    test("port mode: returns the address while listening, null after close()", async () => {
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      await once(wss, "listening");
      const address = wss.address();
      await new Promise(resolve => wss.close(resolve));
      expect(address).toEqual({ address: "127.0.0.1", family: "IPv4", port: expect.any(Number) });
      expect(wss.address()).toBeNull();
    });

    test("server mode: returns the http.Server's address, null after close()", async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ server });
      expect(wss.address()).toBeNull();
      const port = await listen(server);
      try {
        expect(wss.address()).toEqual({ address: "127.0.0.1", family: "IPv4", port });
        await new Promise(resolve => wss.close(resolve));
        expect(wss.address()).toBeNull();
        expect(server.listening).toBe(true);
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    });

    test("noServer mode: throws", () => {
      expect(tryCall(() => new WebSocketServer({ noServer: true }).address())).toBe(
        String.raw`throws Error "The server is operating in \"noServer\" mode"`,
      );
    });
  });
});
