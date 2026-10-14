// The opening handshake of a `ws` WebSocketServer, seen by a raw TCP client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { Duplex } from "node:stream";
import type { ServerOptions } from "ws";
import {
  attempt,
  createServer,
  event,
  implementations,
  listen,
  openServer,
  RawClient,
  type RequestOptions,
  serve,
  show,
  showError,
} from "./ws-raw-peer";

const switching = [
  "HTTP/1.1 101 Switching Protocols",
  "Upgrade: websocket",
  "Connection: Upgrade",
  "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
];
// What `responseLines()` gives for the answer of abortHandshake().
const refusal = (status: string, body: string, headers: string[] = []) => [
  `HTTP/1.1 ${status}`,
  "Connection: close",
  "Content-Type: text/html",
  `Content-Length: ${body.length}`,
  ...headers,
  "",
  body,
];
const badExtensions = refusal("400 Bad Request", "Invalid or unacceptable Sec-WebSocket-Extensions header");
const badVersion = refusal("400 Bad Request", "Missing or invalid Sec-WebSocket-Version header", [
  "Sec-WebSocket-Version: 13, 8",
]);
const extensions = (value: string) => ({ headers: { "Sec-WebSocket-Extensions": value } });
const protocols = (value: string) => ({ headers: { "Sec-WebSocket-Protocol": value } });

type Refusal = {
  label: string;
  options?: ServerOptions;
  request?: RequestOptions;
  response: string[];
  /** It does not go through 'wsClientError'. */
  silent?: boolean;
};

const refusals: Refusal[] = [
  {
    label: "POST",
    request: { method: "POST" },
    response: refusal("405 Method Not Allowed", "Invalid HTTP method"),
  },
  {
    label: "Upgrade: foo",
    request: { headers: { Upgrade: "foo" } },
    response: refusal("400 Bad Request", "Invalid Upgrade header"),
  },
  {
    label: "no Sec-WebSocket-Key",
    request: { headers: { "Sec-WebSocket-Key": null } },
    response: refusal("400 Bad Request", "Missing or invalid Sec-WebSocket-Key header"),
  },
  {
    label: "a Sec-WebSocket-Key of 8 bytes",
    request: { headers: { "Sec-WebSocket-Key": "P5l8BJcZwRc=" } },
    response: refusal("400 Bad Request", "Missing or invalid Sec-WebSocket-Key header"),
  },
  { label: "no Sec-WebSocket-Version", request: { headers: { "Sec-WebSocket-Version": null } }, response: badVersion },
  { label: "Sec-WebSocket-Version: 12", request: { headers: { "Sec-WebSocket-Version": "12" } }, response: badVersion },
  {
    label: "Sec-WebSocket-Protocol: foo;bar",
    request: protocols("foo;bar"),
    response: refusal("400 Bad Request", "Invalid Sec-WebSocket-Protocol header"),
  },
  {
    label: "Sec-WebSocket-Protocol: foo, foo",
    request: protocols("foo, foo"),
    response: refusal("400 Bad Request", "Invalid Sec-WebSocket-Protocol header"),
  },
  {
    label: "a path other than options.path",
    options: { path: "/ws" },
    request: { path: "/other" },
    response: refusal("400 Bad Request", "Bad Request"),
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
    label: "a permessage-deflate parameter given twice",
    options: { perMessageDeflate: true },
    request: extensions("permessage-deflate; server_no_context_takeover; server_no_context_takeover"),
    response: badExtensions,
  },
  {
    label: "a Sec-WebSocket-Extensions header that does not parse",
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
    label: "no client_max_window_bits when clientMaxWindowBits is a number",
    options: { perMessageDeflate: { clientMaxWindowBits: 10 } },
    request: extensions("permessage-deflate"),
    response: badExtensions,
  },
  {
    label: "verifyClient(info) returns false",
    options: { verifyClient: () => false },
    response: refusal("401 Unauthorized", "Unauthorized"),
    silent: true,
  },
  {
    label: "verifyClient calls back (false)",
    options: { verifyClient: (_info, callback) => process.nextTick(callback, false) },
    response: refusal("401 Unauthorized", "Unauthorized"),
    silent: true,
  },
  {
    label: "verifyClient calls back (false, 404)",
    options: { verifyClient: (_info, callback) => process.nextTick(callback, false, 404) },
    response: refusal("404 Not Found", "Not Found"),
    silent: true,
  },
  {
    label: "verifyClient calls back (false, 503, message, headers)",
    options: {
      verifyClient: (_info, callback) => process.nextTick(callback, false, 503, "Bad day", { "Retry-After": 120 }),
    },
    response: refusal("503 Service Unavailable", "Bad day", ["Retry-After: 120"]),
    silent: true,
  },
];

describe.each(implementations)("ws server, opening handshake ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket, WebSocketServer } = implementation;

  test("the 101 has four lines and no Date, and only frames follow it", async () => {
    await using server = await openServer(implementation);
    expect(server.client.head).toBe(switching.join("\r\n"));
    expect(await server.client.roundTrip()).toEqual([]);
  });

  test.each<{ label: string; options?: ServerOptions; request: RequestOptions }>([
    { label: "Sec-WebSocket-Version: 8", request: { headers: { "Sec-WebSocket-Version": "8" } } },
    { label: "Upgrade: WebSocket", request: { headers: { Upgrade: "WebSocket" } } },
    { label: "options.path with a query string", options: { path: "/ws" }, request: { path: "/ws?token=1" } },
  ])("$label is accepted", async ({ options, request }) => {
    await using server = await openServer(implementation, options, request);
    expect(await server.client.responseLines()).toEqual(switching);
    expect(server.req.url).toBe(request.path ?? "/");
  });

  test("'headers' listeners get the lines of the 101, and what they add is sent", async () => {
    await using server = await createServer(implementation);
    const seen: unknown[] = [];
    server.wss.on("headers", (headers, req) => {
      seen.push([...headers], req.url);
      headers.push("X-Foo: bar", "Set-Cookie: io=abc; Path=/; HttpOnly", "Set-Cookie: b=2");
    });
    const client = server.connect({ path: "/x?y=1", ...protocols("a, b") });
    expect(await client.responseLines()).toEqual([
      ...switching,
      "Sec-WebSocket-Protocol: a",
      "X-Foo: bar",
      "Set-Cookie: io=abc; Path=/; HttpOnly",
      "Set-Cookie: b=2",
    ]);
    expect(seen).toEqual([[...switching, "Sec-WebSocket-Protocol: a"], "/x?y=1"]);
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
      { label: "without handleProtocols: the first one offered", offer: "foo, bar", calls: [], protocol: "foo" },
      {
        label: "handleProtocols gets a Set and the request, and chooses",
        offer: "foo, bar",
        returns: "bar",
        calls: ['Set("foo", "bar") /chat'],
        protocol: "bar",
      },
      {
        label: "handleProtocols returns false: none",
        offer: "foo, bar",
        returns: false,
        calls: ['Set("foo", "bar") /chat'],
        protocol: "",
      },
      { label: "nothing offered: handleProtocols is not called", offer: null, returns: "x", calls: [], protocol: "" },
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
        protocol ? [...switching, `Sec-WebSocket-Protocol: ${protocol}`] : switching,
      );
      expect(server.ws.protocol).toBe(protocol);
      expect(seen).toEqual(calls);
    });
  });

  describe("permessage-deflate", () => {
    const usual = "permessage-deflate; client_max_window_bits";
    const everything =
      "permessage-deflate; server_no_context_takeover; client_no_context_takeover; " +
      "server_max_window_bits=10; client_max_window_bits=11";

    test.each<{ label: string; option?: ServerOptions["perMessageDeflate"]; offer: string; answer: string | null }>([
      { label: "is off by default", offer: usual, answer: null },
      { label: "off: the header is not even parsed", option: false, offer: "permessage-deflate;", answer: null },
      { label: "true", option: true, offer: usual, answer: "permessage-deflate" },
      { label: "true, every parameter offered: all are taken", option: true, offer: everything, answer: everything },
      {
        label: "the server's own parameters",
        option: { serverNoContextTakeover: true, clientNoContextTakeover: true, serverMaxWindowBits: 10 },
        offer: usual,
        answer: "permessage-deflate; server_no_context_takeover; client_no_context_takeover; server_max_window_bits=10",
      },
      {
        label: "clientMaxWindowBits answers client_max_window_bits",
        option: { clientMaxWindowBits: 10 },
        offer: usual,
        answer: "permessage-deflate; client_max_window_bits=10",
      },
      {
        label: "the first acceptable offer wins",
        option: { serverMaxWindowBits: false as any },
        offer: "permessage-deflate; server_max_window_bits=10, permessage-deflate; client_no_context_takeover",
        answer: "permessage-deflate; client_no_context_takeover",
      },
      { label: "another extension is ignored", option: true, offer: "foo; bar", answer: null },
      {
        label: "another extension next to it is ignored",
        option: true,
        offer: "foo; bar, " + usual,
        answer: "permessage-deflate",
      },
    ])("$label", async ({ option, offer, answer }) => {
      await using server = await openServer(implementation, { perMessageDeflate: option }, extensions(offer));
      expect(await server.client.responseLines()).toEqual(
        answer === null ? switching : [...switching, `Sec-WebSocket-Extensions: ${answer}`],
      );
      expect(server.ws.extensions).toBe(answer === null ? "" : "permessage-deflate");
    });
  });

  describe("refusals", () => {
    test.each(refusals)("$label", async ({ options, request, response }) => {
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

    test("a request that is not an upgrade gets 426", async () => {
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

  // With a listener the answer is the listener's business.
  describe("'wsClientError'", () => {
    const teapot = ["HTTP/1.1 418 teapot", "Connection: close", "Content-Length: 0"];

    async function refuse({ options, request }: Refusal) {
      await using server = await createServer(implementation, options);
      const seen: unknown[] = [];
      server.wss.on("wsClientError", (error, socket, req) => {
        seen.push(showError(error), socket === req.socket, req.method);
        socket.end([...teapot, "", ""].join("\r\n"));
      });
      return { response: await server.connect(request).responseLines(), seen };
    }

    test.each(refusals.filter(row => !row.silent))("$label", async row => {
      expect(await refuse(row)).toEqual({
        response: [...teapot, "", ""],
        seen: [`Error ${JSON.stringify(row.response.at(-1))}`, true, row.request?.method ?? "GET"],
      });
    });

    test.each(refusals.filter(row => row.silent))("$label: not reported, refused as usual", async row => {
      expect(await refuse(row)).toEqual({ response: row.response, seen: [] });
    });
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
      expect(await server.client.responseLines()).toEqual(switching);
      expect(seen).toEqual([["origin", "secure", "req"], origin, false, "/v"]);
    });

    test("with two parameters the handshake waits for the callback", async () => {
      const asked = Promise.withResolvers<(result: boolean) => void>();
      await using server = await createServer(implementation, {
        verifyClient: (_info, callback) => asked.resolve(callback),
      });
      const states: number[] = [];
      server.wss.on("connection", ws => {
        states.push(ws.readyState);
        ws.send("hi");
      });
      const client = server.connect();
      const accept = await asked.promise;
      expect(states).toEqual([]);
      accept(true);
      expect(states).toEqual([WebSocket.OPEN]);
      expect(await client.responseLines()).toEqual(switching);
      expect(await client.next()).toBe('text "hi"');
    });

    // After a FIN the socket is half open until the late callback destroys it. A RST destroys it at once.
    test.each([
      { how: "FIN", leave: (client: RawClient) => client.end(), sign: "end" },
      { how: "RST", leave: (client: RawClient) => client.reset(), sign: "close" },
    ])("the client is gone ($how) when the callback accepts it: no connection", async ({ leave, sign }) => {
      type Question = { socket: Duplex; accept(result: boolean): void };
      let asked = Promise.withResolvers<Question>();
      await using server = await createServer(implementation, {
        verifyClient: (info, accept) => asked.resolve({ socket: info.req.socket, accept }),
      });
      const urls: unknown[] = [];
      server.wss.on("connection", (_ws, req) => urls.push(req.url));

      const client = server.connect({ path: "/gone" });
      const { socket, accept } = await asked.promise;
      const gone = event(socket, sign);
      leave(client);
      await gone;
      expect(attempt(() => accept(true))).toBe("undefined");
      expect(socket.destroyed).toBe(true);
      expect(server.wss.clients.size).toBe(0);

      asked = Promise.withResolvers();
      const second = server.connect({ path: "/here" });
      (await asked.promise).accept(true);
      expect(await second.responseLines()).toEqual(switching);
      expect(urls).toEqual(["/here"]);
    });
  });

  describe("handleUpgrade()", () => {
    test.each([
      { when: "after a microtask", wait: () => Promise.resolve() },
      { when: "in a later turn of the event loop", wait: () => new Promise(setImmediate) },
    ])("$when", async ({ wait }) => {
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
      expect(await client.responseLines()).toEqual(switching);
      expect(await client.next()).toBe('text "late"');
      expect(states).toEqual([WebSocket.OPEN]);
    });

    test("twice with one socket throws, and the connection stays", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ noServer: true });
      const calls: string[] = [];
      web.server.on("upgrade", (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, () => calls.push("first callback"));
        calls.push(attempt(() => wss.handleUpgrade(req, socket, head, () => calls.push("second callback"))));
      });
      const client = web.connect();
      expect(await client.responseLines()).toEqual(switching);
      expect(calls).toEqual([
        "first callback",
        'throws Error "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"',
      ]);
      expect(await client.roundTrip()).toEqual([]);
    });

    test("after close(): 503", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ noServer: true });
      let called = false;
      web.server.on("upgrade", (req, socket, head) => {
        wss.close();
        wss.handleUpgrade(req, socket, head, () => (called = true));
      });
      expect(await web.connect().responseLines()).toEqual(refusal("503 Service Unavailable", "Service Unavailable"));
      expect(called).toBe(false);
    });

    test("two noServer servers behind one 'upgrade' listener", async () => {
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
        expect(await client.responseLines()).toEqual(switching);
        expect(await client.next()).toBe(`text "from ${name}"`);
      }
      const client = web.connect({ path: "/c" });
      expect((await client.response).status).toBe("no response");
      expect(await client.next()).toBe("EOF");
      expect([a.clients.size, b.clients.size]).toEqual([1, 1]);
    });

    test("an 'upgrade' listener that writes its own 401 for some requests", async () => {
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
      expect(await web.connect({ path: "/public" }).responseLines()).toEqual(switching);
    });

    // What @fastify/websocket and express-ws do.
    test("a ServerResponse made for the upgrade request answers, or steps aside", async () => {
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
      expect(await client.responseLines()).toEqual(switching);
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

    // Without an 'upgrade' listener the request goes to 'request'. Bun's node:http does not hand that listener a raw
    // socket, so the npm package gets its 101 out and then loses the connection.
    test.skipIf(!builtin)("from a 'request' listener", async () => {
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
      expect(await client.responseLines()).toEqual(switching);
      expect(seen).toEqual(["/", "websocket", WebSocket.OPEN]);
      client.text("hi");
      expect(await client.next()).toBe('text "echo:hi"');
    });
  });

  // Each server answers every upgrade of the http.Server, so the first one refuses what is meant for the second.
  test("two servers with different paths on one http.Server: only the first one's path works", async () => {
    await using web = await serve(http.createServer());
    const a = new WebSocketServer({ server: web.server, path: "/a" });
    const b = new WebSocketServer({ server: web.server, path: "/b" });
    a.on("connection", ws => ws.send("from a"));
    b.on("connection", ws => ws.send("from b"));
    const client = web.connect({ path: "/a" });
    expect(await client.responseLines()).toEqual(switching);
    expect(await client.next()).toBe('text "from a"');
    const other = web.connect({ path: "/b" });
    expect(await other.responseLines()).toEqual(refusal("400 Bad Request", "Bad Request"));
    await other.ended;
    expect(b.clients.size).toBe(0);
  });

  describe("the constructor", () => {
    test.each([
      { label: "", args: () => [] },
      { label: "{}", args: () => [{}] },
      { label: "{ port, noServer }", args: () => [{ port: 0, noServer: true }] },
      { label: "{ server, noServer }", args: () => [{ server: http.createServer(), noServer: true }] },
      { label: "{ port, server }", args: () => [{ port: 0, server: http.createServer() }] },
    ])("new WebSocketServer($label) throws", ({ args }) => {
      expect(attempt(() => new WebSocketServer(...(args() as [])))).toBe(
        String.raw`throws TypeError "One and only one of the \"port\", \"server\", or \"noServer\" options must be specified"`,
      );
    });

    test("fills in the options", () => {
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

    test("a port that is taken: 'error' EADDRINUSE", async () => {
      await using web = await serve(http.createServer());
      const wss = new WebSocketServer({ port: web.port, host: "127.0.0.1" });
      const [error] = await event(wss, "error");
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
    test("port mode: the address while listening, null after close()", async () => {
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      await once(wss, "listening");
      const address = wss.address();
      await new Promise(resolve => wss.close(resolve));
      expect(address).toEqual({ address: "127.0.0.1", family: "IPv4", port: expect.any(Number) });
      expect(wss.address()).toBeNull();
    });

    test("server mode: what the http.Server says, null after close()", async () => {
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
      expect(attempt(() => new WebSocketServer({ noServer: true }).address())).toBe(
        String.raw`throws Error "The server is operating in \"noServer\" mode"`,
      );
    });
  });
});
