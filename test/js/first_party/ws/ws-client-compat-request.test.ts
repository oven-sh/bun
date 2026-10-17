// Tests the `http.ClientRequest` that a `ws` client passes to `finishRequest` and to 'unexpected-response' listeners,
// and how calling end(), destroy() or abort() on it affects the socket. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import type { ClientRequest } from "node:http";
import path from "node:path";
import {
  abnormalClose,
  closedBeforeOpen,
  closedPort,
  connectClient,
  createPeer,
  implementations,
  nextEvent,
  openEvents,
  response101,
  runScript,
  scriptTimeout,
  tryCall,
  type ClientOptions,
  type PeerOptions,
} from "./ws-raw-peer";

const hangUp = ['error Error "socket hang up" ECONNRESET rs=2', "close 1006 Buffer() rs=3"];
const boom = ['error Error "boom" rs=2', "close 1006 Buffer() rs=3"];
const forbidden = "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno";

type Peer = Awaited<ReturnType<typeof createPeer>>;
type RequestAction = (req: ClientRequest) => unknown;

const flags = (req: ClientRequest) => ({ destroyed: req.destroyed, aborted: req.aborted });

/** Records a request's 'abort' and 'close' events. `closed` resolves on 'close'. */
function watchRequest(req: ClientRequest) {
  const events: string[] = [];
  req.on("abort", () => events.push("abort"));
  const closed = new Promise<void>(resolve => req.on("close", () => (events.push("close"), resolve())));
  return { events, closed };
}

describe.each(implementations)("ws client handshake request ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket } = implementation;

  /**
   * Returns the request line of every request `peer` has received. Connects a control client first and waits for its
   * request, so anything an earlier client was going to send has arrived too.
   */
  async function requestLines(peer: Peer) {
    const control = new WebSocket(peer.url + "/control");
    control.on("error", () => {});
    try {
      while ((await peer.connection()).headLines[0] !== "GET /control HTTP/1.1");
    } finally {
      control.terminate();
    }
    return peer.connections.map(connection => connection.headLines[0]);
  }
  const onlyControl = ["GET /control HTTP/1.1"];

  /** `connectClient()` with a `finishRequest` that saves the request without ending it. */
  async function connectWithPendingRequest(options: ClientOptions = {}, peerOptions?: PeerOptions) {
    let req!: ClientRequest;
    const client = await connectClient(
      implementation,
      { ...options, finishRequest: request => void (req = request) },
      peerOptions,
    );
    return { ...client, req, [Symbol.asyncDispose]: client[Symbol.asyncDispose] };
  }

  describe("finishRequest", () => {
    test("receives the request and the WebSocket, and can set a header", async () => {
      const calls: unknown[][] = [];
      await using client = await connectClient(implementation, {
        finishRequest(...args) {
          calls.push(args);
          args[0].setHeader("Cookie", "foo=bar");
          args[0].end();
        },
      });
      const conn = await client.peer.connection();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toHaveLength(2);
      expect((calls[0][0] as ClientRequest).constructor.name).toBe("ClientRequest");
      expect(calls[0][1]).toBe(client.ws);
      expect(conn.header("cookie")).toBe("foo=bar");
      await client.opened;
      expect(client.events).toEqual(openEvents);
    });

    const deferrals: { when: string; defer(fn: () => void): unknown }[] = [
      { when: "in a microtask", defer: fn => queueMicrotask(fn) },
      { when: "in a later task", defer: fn => setImmediate(fn) },
      { when: "after an await", defer: async fn => (await null, fn()) },
    ];
    const authorizeLater =
      (defer: (fn: () => void) => unknown): ClientOptions["finishRequest"] =>
      req =>
        void defer(() => {
          req.setHeader("Authorization", "token");
          req.end();
        });
    // Responds with a 401 if the request was sent before `finishRequest` set Authorization.
    const requiresAuthorization: PeerOptions = {
      respond: conn =>
        conn.header("authorization") ? response101(conn) : "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n",
    };

    test.each(deferrals)("req.end() $when sends one request with every header set so far", async ({ defer }) => {
      await using client = await connectClient(
        implementation,
        { headers: { a: "1" }, finishRequest: authorizeLater(defer) },
        requiresAuthorization,
      );
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      await client.opened;
      expect(client.events).toEqual(openEvents);
      expect(client.peer.connections.map(conn => [conn.header("a"), conn.header("authorization")])).toEqual([
        ["1", "token"],
      ]);
    });

    test("a deferred req.end() works over TLS", async () => {
      await using client = await connectClient(
        implementation,
        { ca: tls.cert, finishRequest: authorizeLater(setImmediate) },
        { ...requiresAuthorization, secure: true },
      );
      await client.opened;
      expect(client.events).toEqual(openEvents);
      expect(client.peer.connections).toHaveLength(1);
    });

    test.skipIf(isWindows)("a deferred req.end() works over a unix socket", async () => {
      using dir = tempDir("ws-finish-request", {});
      await using client = await connectClient(
        implementation,
        { finishRequest: authorizeLater(setImmediate) },
        { ...requiresAuthorization, path: path.join(String(dir), "ws.sock") },
      );
      await client.opened;
      expect(client.events).toEqual(openEvents);
      expect(client.peer.connections).toHaveLength(1);
    });

    test("every listener style added before req.end() gets the connection's events", async () => {
      await using client = await connectWithPendingRequest(
        { protocols: ["a", "b"] },
        { headers: ["Sec-WebSocket-Protocol: a"] },
      );
      const { ws, req } = client;
      const seen: string[] = [];
      ws.on("upgrade", response => seen.push("on upgrade " + response.statusCode));
      ws.on("open", () => seen.push("on open"));
      ws.once("open", () => seen.push("once open"));
      ws.addEventListener("open", () => seen.push("addEventListener open"));
      ws.onopen = () => seen.push("onopen");
      ws.onmessage = ({ data }) => seen.push("onmessage " + data);
      ws.on("message", data => seen.push("on message " + data));
      expect({ readyState: ws.readyState, protocol: ws.protocol }).toEqual({ readyState: 0, protocol: "" });

      req.end();
      const conn = await client.peer.connection();
      conn.text("hi");
      await nextEvent(ws, "message");
      expect({ readyState: ws.readyState, protocol: ws.protocol }).toEqual({ readyState: 1, protocol: "a" });
      expect(seen).toEqual([
        "on upgrade 101",
        "on open",
        "once open",
        "addEventListener open",
        "onopen",
        "onmessage hi",
        "on message hi",
      ]);
    });

    test("without req.end(), sends nothing and stays CONNECTING", async () => {
      await using client = await connectWithPendingRequest({ headers: { authorization: "secret" } });
      const { ws, events, peer } = client;
      expect(await requestLines(peer)).toEqual(onlyControl);
      expect(events).toEqual([]);
      expect(ws.readyState).toBe(WebSocket.CONNECTING);

      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await client.closed;
      expect(events).toEqual(closedBeforeOpen);
    });

    test("handshakeTimeout still fires when req.end() is never called", async () => {
      await using client = await connectWithPendingRequest({ handshakeTimeout: 20 });
      await client.closed;
      expect(client.events).toEqual(['error Error "Opening handshake has timed out" rs=2', "close 1006 Buffer() rs=3"]);
      expect(flags(client.req)).toEqual({ destroyed: true, aborted: true });
      expect(client.peer.connections).toEqual([]);
    });

    test.each([
      { call: "close()", act: ws => ws.close() },
      { call: "terminate()", act: ws => ws.terminate() },
    ] as { call: string; act(ws: InstanceType<typeof WebSocket>): void }[])(
      "$call before req.end() fails the socket, and a later req.end() sends nothing",
      async ({ act }) => {
        await using client = await connectWithPendingRequest();
        const { ws, req, events, peer } = client;
        act(ws);
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        expect(flags(req)).toEqual({ destroyed: true, aborted: true });
        await client.closed;
        expect(tryCall(() => req.end() === req)).toBe("true");
        expect(await requestLines(peer)).toEqual(onlyControl);
        expect(events).toEqual(closedBeforeOpen);
      },
    );

    test("mutating the constructor's arguments afterwards doesn't change the request", async () => {
      const protocols = ["a"];
      const headers: Record<string, string> = { "X-One": "1" };
      await using client = await connectWithPendingRequest(
        { protocols, headers },
        { headers: ["Sec-WebSocket-Protocol: a"] },
      );
      protocols.push("a", "b");
      headers["X-One"] = "2";
      headers["X-Two"] = "2";
      client.req.end();
      const conn = await client.peer.connection();
      expect(["sec-websocket-protocol", "x-one", "x-two"].map(name => conn.header(name))).toEqual([
        "a",
        "1",
        undefined,
      ]);
      await client.opened;
      expect(client.ws.protocol).toBe("a");
    });

    test("a second req.end() is a no-op", async () => {
      await using client = await connectWithPendingRequest();
      const { req, peer } = client;
      expect([req.end() === req, req.end() === req]).toEqual([true, true]);
      await client.opened;
      expect(req.end()).toBe(req);
      expect(await requestLines(peer)).toEqual(["GET / HTTP/1.1", ...onlyControl]);
      expect(client.events).toEqual(openEvents);
    });

    test("the request emits 'socket', and req.end() can be called from its listener", async () => {
      let socket: any;
      await using client = await connectClient(implementation, {
        finishRequest(req) {
          req.on("socket", value => {
            socket = value;
            req.end();
          });
        },
      });
      await client.opened;
      expect(typeof socket.on).toBe("function");
      expect(client.events).toEqual(openEvents);
      expect(client.peer.connections).toHaveLength(1);
    });

    test("an exception from finishRequest propagates out of the constructor, and nothing is sent", async () => {
      await using peer = await createPeer();
      const error = new Error("from finishRequest");
      let created: InstanceType<typeof WebSocket> | undefined;
      try {
        expect(() => {
          new WebSocket(peer.url, {
            finishRequest(_, ws) {
              created = ws;
              throw error;
            },
          });
        }).toThrow(error);
        expect(await requestLines(peer)).toEqual(onlyControl);
      } finally {
        created?.on("error", () => {}).terminate();
      }
    });

    test.each([
      { what: "an invalid URL", address: "not a url", thrown: 'SyntaxError "Invalid URL: not a url"' },
      { what: "a URL with a fragment", suffix: "/#a", thrown: 'SyntaxError "The URL contains a fragment identifier"' },
      {
        what: "a duplicated subprotocol",
        protocols: ["a", "a"],
        thrown: 'SyntaxError "An invalid or duplicated subprotocol was specified"',
      },
      {
        what: "an invalid header name",
        headers: { "bad name": "1" },
        thrown: 'TypeError "Header name must be a valid HTTP token [\\"bad name\\"]" ERR_INVALID_HTTP_TOKEN',
      },
    ] as { what: string; address?: string; suffix?: string; protocols?: string[]; headers?: {}; thrown: string }[])(
      "the constructor throws for $what before calling finishRequest",
      async ({ address, suffix = "", protocols = [], headers, thrown }) => {
        address ??= `ws://127.0.0.1:${await closedPort()}${suffix}`;
        let calls = 0;
        const result = tryCall(() =>
          new WebSocket(address, protocols, { headers, finishRequest: () => void calls++ }).on("error", () => {}),
        );
        expect(result).toBe("throws " + thrown);
        expect(calls).toBe(0);
      },
    );

    test("a client referenced only by its pending req.end() survives GC and connects", async () => {
      await using peer = await createPeer();
      const total = 5;
      let ended = 0;
      let opened = 0;
      const { promise, resolve } = Promise.withResolvers<void>();
      for (let i = 0; i < total; i++) {
        new WebSocket(peer.url, {
          finishRequest(req) {
            setImmediate(() => {
              req.end();
              if (++ended === total) Bun.gc(true);
            });
          },
        })
          .on("error", () => {})
          .on("open", function () {
            this.terminate();
            if (++opened === total) resolve();
          });
      }
      Bun.gc(true);
      await promise;
      expect(peer.connections).toHaveLength(total);
    });
  });

  describe("request headers", () => {
    test("the handshake headers are readable and match what is sent", async () => {
      await using client = await connectWithPendingRequest({
        path: "/p?q=1",
        protocols: ["a"],
        origin: "http://example.com",
        headers: { "X-One": "1" },
      });
      const { req, peer } = client;
      expect({ method: req.method, path: req.path, host: req.host, protocol: req.protocol }).toEqual({
        method: "GET",
        path: "/p?q=1",
        host: "127.0.0.1",
        protocol: "http:",
      });
      const key = req.getHeader("sec-websocket-key");
      expect(key).toMatch(/^[+/0-9A-Za-z]{22}==$/);
      expect<object>({ ...req.getHeaders() }).toEqual({
        "x-one": "1",
        "sec-websocket-version": 13,
        "sec-websocket-key": key,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-extensions": "permessage-deflate; client_max_window_bits",
        "sec-websocket-protocol": "a",
        origin: "http://example.com",
        host: `127.0.0.1:${peer.port}`,
      });
      expect([req.getHeader("UPGRADE"), req.getHeader("nope"), req.hasHeader("X-ONE"), req.hasHeader("nope")]).toEqual([
        "websocket",
        undefined,
        true,
        false,
      ]);
      expect(req.getHeaderNames().toSorted()).toEqual(Object.keys(req.getHeaders()).toSorted());
      expect(req.getRawHeaderNames()).toContain("Sec-WebSocket-Key");

      req.end();
      const conn = await peer.connection();
      expect(conn.headLines[0]).toBe("GET /p?q=1 HTTP/1.1");
      expect(conn.header("sec-websocket-key")).toBe(key as string);
    });

    // Header names are case-insensitive, so only one line is sent. It uses the case of the last setHeader().
    test.each([
      { call: 'setHeader("X-Mode", "1")', act: req => req.setHeader("X-Mode", "1"), lines: ["X-Mode: 1"] },
      { call: 'setHeader("x-mode", "1")', act: req => req.setHeader("x-mode", "1"), lines: ["x-mode: 1"] },
      { call: 'setHeader("x-mode", 1)', act: req => req.setHeader("x-mode", 1), lines: ["x-mode: 1"] },
      { call: 'removeHeader("x-MODE")', act: req => req.removeHeader("x-MODE"), lines: [] },
    ] as { call: string; act: RequestAction; lines: string[] }[])(
      "$call overrides X-Mode from options.headers",
      async ({ act, lines }) => {
        await using client = await connectWithPendingRequest({ headers: { "X-Mode": "0" } });
        act(client.req);
        client.req.end();
        const conn = await client.peer.connection();
        expect(conn.headLines.filter(line => /^x-mode:/i.test(line))).toEqual(lines);
      },
    );

    test("setHeader() returns the request and throws for input that node:http rejects", async () => {
      await using client = await connectWithPendingRequest();
      const { req } = client;
      expect(req.setHeader("X-Good", "1")).toBe(req);
      expect([
        tryCall(() => req.setHeader("bad name", "1")),
        tryCall(() => req.setHeader("x-bad", "a\r\nx-injected: 1")),
        tryCall(() => req.setHeader("x-bad", undefined as any)),
        tryCall(() =>
          req.setHeader("x-bad", {
            toString() {
              throw new Error("from toString");
            },
          } as any),
        ),
      ]).toEqual([
        'throws TypeError "Header name must be a valid HTTP token [\\"bad name\\"]" ERR_INVALID_HTTP_TOKEN',
        'throws TypeError "Invalid character in header content [\\"x-bad\\"]" ERR_INVALID_CHAR',
        'throws TypeError "Invalid value \\"undefined\\" for header \\"x-bad\\"" ERR_HTTP_INVALID_HEADER_VALUE',
        'throws Error "from toString"',
      ]);
      req.end();
      const conn = await client.peer.connection();
      expect(conn.headLines.filter(line => /^(x-|bad)/i.test(line))).toEqual(["X-Good: 1"]);
      await client.opened;
    });

    test("headers can't be changed after req.end()", async () => {
      await using client = await connectWithPendingRequest({ headers: { "X-One": "1" } });
      const { req } = client;
      const state = () => ({ finished: req.finished, writableEnded: req.writableEnded, headersSent: req.headersSent });
      expect(state()).toEqual({ finished: false, writableEnded: false, headersSent: false });
      req.end();
      expect(state()).toEqual({ finished: true, writableEnded: true, headersSent: true });
      expect([tryCall(() => req.setHeader("X-Late", "1")), tryCall(() => req.removeHeader("X-One"))]).toEqual([
        'throws Error "Cannot set headers after they are sent to the client" ERR_HTTP_HEADERS_SENT',
        'throws Error "Cannot remove headers after they are sent to the client" ERR_HTTP_HEADERS_SENT',
      ]);
      expect(req.getHeader("x-one")).toBe("1");
      const conn = await client.peer.connection();
      expect([conn.header("x-one"), conn.header("x-late")]).toEqual(["1", undefined]);
    });
  });

  describe("destroy() and abort() inside finishRequest", () => {
    const error = new Error("boom");

    test.each([
      { call: "req.destroy()", act: req => req.destroy(), aborted: false, requestEvents: ["close"], events: hangUp },
      {
        call: "req.destroy(error)",
        act: req => req.destroy(error),
        aborted: false,
        requestEvents: ["close"],
        events: boom,
      },
      {
        call: "req.destroy() and req.end()",
        act: req => (req.destroy(), req.end()),
        aborted: false,
        requestEvents: ["close"],
        events: hangUp,
      },
      // An aborted request emits no 'error', so the socket is never notified.
      {
        call: "req.abort()",
        act: req => void req.abort(),
        aborted: true,
        requestEvents: ["abort", "close"],
        events: [],
      },
    ] as { call: string; act: RequestAction; aborted: boolean; requestEvents: string[]; events: string[] }[])(
      "$call sends nothing",
      async ({ act, aborted, requestEvents, events }) => {
        let watched!: ReturnType<typeof watchRequest>;
        let result: unknown;
        let req!: ClientRequest;
        await using client = await connectClient(implementation, {
          finishRequest(request) {
            req = request;
            watched = watchRequest(req);
            result = act(req);
          },
        });
        expect(result).toBe(aborted ? undefined : req);
        expect(flags(req)).toEqual({ destroyed: true, aborted });
        await watched.closed;
        if (events.length) await client.closed;
        expect(await requestLines(client.peer)).toEqual(onlyControl);
        expect(watched.events).toEqual(requestEvents);
        expect(client.events).toEqual(events);
        expect(client.ws.readyState).toBe(events.length ? WebSocket.CLOSED : WebSocket.CONNECTING);
      },
    );

    test("'error' receives the same error object that was passed to req.destroy(error)", async () => {
      await using client = await connectClient(implementation, { finishRequest: req => void req.destroy(error) });
      expect((await nextEvent(client.ws, "error"))[0]).toBe(error);
    });
  });

  describe("destroy() and abort() before the server responds", () => {
    test.each([
      { call: "req.destroy()", act: req => req.destroy(), requestEvents: ["close"], events: hangUp },
      {
        call: "req.destroy(error)",
        act: req => req.destroy(new Error("boom")),
        requestEvents: ["close"],
        events: boom,
      },
      { call: "req.abort()", act: req => req.abort(), requestEvents: ["abort", "close"], events: hangUp },
    ] as { call: string; act: RequestAction; requestEvents: string[]; events: string[] }[])(
      "$call closes the connection and fails the socket",
      async ({ act, requestEvents, events }) => {
        await using client = await connectWithPendingRequest({}, { respond: () => null });
        const { ws, req } = client;
        req.end();
        const conn = await client.peer.connection();
        const watched = watchRequest(req);
        act(req);
        expect(ws.readyState).toBe(WebSocket.CONNECTING);
        await Promise.all([watched.closed, client.closed]);
        expect(await conn.remainingFrames()).toEqual([]);
        expect(watched.events).toEqual(requestEvents);
        expect(client.events).toEqual(events);
      },
    );

    test.each([
      { call: "terminate()", act: ws => ws.terminate() },
      { call: "close()", act: ws => ws.close() },
    ] as { call: string; act(ws: InstanceType<typeof WebSocket>): void }[])(
      "ws._req.destroy() immediately followed by $call reports $call's error",
      async ({ act }) => {
        await using client = await connectClient(implementation, {}, { respond: () => null });
        const { ws } = client;
        await client.peer.connection();
        (ws as any)._req.destroy();
        expect(tryCall(() => act(ws))).toBe("undefined");
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        await client.closed;
        expect(client.events).toEqual(closedBeforeOpen);
      },
    );
  });

  // The 101 has arrived, so node:http has already handed the socket to the WebSocket.
  describe("destroy() and abort() after the 101", () => {
    type Socket = InstanceType<typeof WebSocket>;
    const found = "HTTP/1.1 302 Found\r\nLocation: /dest\r\nContent-Length: 0\r\n\r\n";

    // Destroying the request destroys the socket, but npm ws has no listeners on it yet. It goes on to emit 'open', and
    // learns about the socket from its 'close' event. The built-in's native client fails the handshake instead.
    const destroyed = (error: string[]) => (builtin ? ["upgrade 101 rs=0", ...error] : [...openEvents, abnormalClose]);
    const aborted = ["upgrade 101 rs=0", ...closedBeforeOpen];

    test.each([
      { call: "req.destroy()", act: req => req.destroy(), events: destroyed(hangUp) },
      { call: "req.destroy(error)", act: req => req.destroy(new Error("boom")), events: destroyed(boom) },
      { call: "req.abort()", act: req => req.abort(), events: destroyed(hangUp) },
      { call: "req.destroy() and ws.terminate()", act: (req, ws) => (req.destroy(), ws.terminate()), events: aborted },
      { call: "req.destroy() and ws.close()", act: (req, ws) => (req.destroy(), ws.close()), events: aborted },
      { call: "ws.terminate() and req.destroy()", act: (req, ws) => (ws.terminate(), req.destroy()), events: aborted },
    ] as { call: string; act(req: ClientRequest, ws: Socket): void; events: string[] }[])(
      "$call in an 'upgrade' listener emits 'close' 1006 once",
      async ({ act, events }) => {
        await using client = await connectClient(implementation);
        const { ws } = client;
        const req: ClientRequest = (ws as any)._req;
        const watched = watchRequest(req);
        ws.on("upgrade", () => act(req, ws));
        await Promise.all([watched.closed, client.closed]);
        // Once the peer has seen the connection end, nothing is left that could emit another event.
        expect(await (await client.peer.connection()).remainingFrames()).toEqual([]);
        expect([() => ws.terminate(), () => ws.close()].map(tryCall)).toEqual(["undefined", "undefined"]);
        expect(client.events).toEqual(events);
      },
    );

    // Only the connection keeps the child alive, so it exits once the connection has closed.
    test.concurrent.each(["destroy", "abort"])(
      "req.%s() in an 'upgrade' listener that then throws still closes the connection",
      async method => {
        await using peer = await createPeer({ allowHalfOpen: false });
        const script = `
          const ws = new WebSocket(process.env.PEER_URL);
          const req = ws._req;
          for (const name of ["open", "error", "close"]) ws.on(name, () => console.log(name));
          ws.on("upgrade", () => {
            req.${method}();
            throw new Error("thrown by the listener");
          });
        `;
        const child = runScript({ specifier }, script, { PEER_URL: peer.url });
        const conn = await peer.connection();
        expect(await conn.remainingFrames()).toEqual([]);
        // The throw leaves npm ws CONNECTING.
        expect(await child).toEqual({
          lines: ['uncaught Error "thrown by the listener"', ...(builtin ? ["error", "close"] : [])],
          stderr: "",
          exitCode: 0,
        });
      },
      scriptTimeout,
    );

    test.each([
      { call: "req.destroy()", act: req => req.destroy() },
      { call: "req.abort()", act: req => req.abort() },
      { call: "ws.terminate() and req.destroy()", act: (req, ws) => (ws.terminate(), req.destroy()) },
    ] as { call: string; act(req: ClientRequest, ws: Socket): void }[])(
      "$call in an 'open' listener emits 'close' 1006",
      async ({ act }) => {
        await using client = await connectClient(
          implementation,
          { followRedirects: true },
          { respond: conn => (conn.headLines[0] === "GET / HTTP/1.1" ? found : response101(conn)) },
        );
        const { ws } = client;
        const [, req] = (await nextEvent(ws, "redirect")) as [string, ClientRequest];
        let calls: string[] = [];
        ws.on("open", () => {
          act(req, ws);
          calls = [() => ws.send("x"), () => ws.terminate(), () => ws.close()].map(tryCall);
        });
        await client.opened;
        expect(calls).toEqual(["undefined", "undefined", "undefined"]);
        await client.closed;
        expect(client.events).toEqual([...openEvents, abnormalClose]);
        expect(await client.peer.connections[1].remainingFrames()).toEqual([]);
      },
    );

    // node:http marks the request as destroyed once its 'upgrade' listeners return, and npm ws emits 'open' from one.
    test.each([
      { call: "req.destroy()", act: req => req.destroy() },
      { call: "req.abort()", act: req => req.abort() },
    ] as { call: string; act: RequestAction }[])(
      "$call after the 'open' listeners return is a no-op",
      async ({ act }) => {
        await using client = await connectClient(implementation, { perMessageDeflate: false });
        const { ws } = client;
        const req: ClientRequest = (ws as any)._req;
        const watched = watchRequest(req);
        const conn = await client.peer.connection();
        await client.opened;
        expect(req.destroyed).toBe(true);
        expect(watched.events).toEqual(["close"]);

        act(req);
        ws.send("still");
        expect(await conn.next()).toBe('text "still"');
        conn.text("open");
        await nextEvent(ws, "message");
        expect(client.events).toEqual([...openEvents, 'message Buffer("open") text rs=1']);
      },
    );
  });

  describe("the 'unexpected-response' request", () => {
    /** A client that has already emitted 'unexpected-response', plus that event's request. */
    async function rejectedClient(options: ClientOptions = {}) {
      const client = await connectClient(implementation, options, { respond: () => forbidden });
      try {
        const [req] = (await nextEvent(client.ws, "unexpected-response")) as [ClientRequest];
        return { ...client, req, [Symbol.asyncDispose]: client[Symbol.asyncDispose] };
      } catch (error) {
        await client[Symbol.asyncDispose]();
        throw error;
      }
    }

    test("is the request that was sent", async () => {
      await using client = await rejectedClient({ path: "/p?q=1", headers: { "X-One": "1" } });
      const { req } = client;
      const conn = await client.peer.connection();
      expect({
        class: req.constructor.name,
        method: req.method,
        path: req.path,
        host: req.host,
        upgrade: req.getHeader("upgrade"),
        one: req.getHeader("x-one"),
        key: req.getHeader("sec-websocket-key"),
        missing: req.getHeader("x-anything"),
        ...flags(req),
      }).toEqual({
        class: "ClientRequest",
        method: "GET",
        path: "/p?q=1",
        host: "127.0.0.1",
        upgrade: "websocket",
        one: "1",
        key: conn.header("sec-websocket-key"),
        missing: undefined,
        destroyed: false,
        aborted: false,
      });
    });

    test("is the same request that finishRequest received", async () => {
      let fromFinishRequest: ClientRequest | undefined;
      await using client = await rejectedClient({ finishRequest: req => void (fromFinishRequest = req).end() });
      expect(client.req).toBe(fromFinishRequest!);
    });

    // The listener owns the response now, so the socket ignores the request unless it emits 'error'.
    test.each([
      { call: "req.destroy()", act: req => req.destroy(), aborted: false, requestEvents: ["close"] },
      {
        call: "req.destroy() twice",
        act: req => (req.destroy(), req.destroy()),
        aborted: false,
        requestEvents: ["close"],
      },
      { call: "req.abort()", act: req => void req.abort(), aborted: true, requestEvents: ["abort", "close"] },
    ] as { call: string; act: RequestAction; aborted: boolean; requestEvents: string[] }[])(
      "$call leaves the socket CONNECTING and emits nothing",
      async ({ act, aborted, requestEvents }) => {
        await using client = await rejectedClient();
        const { ws, req } = client;
        const watched = watchRequest(req);
        expect(act(req)).toBe(aborted ? undefined : req);
        expect(flags(req)).toEqual({ destroyed: true, aborted });
        await watched.closed;
        expect(watched.events).toEqual(requestEvents);
        expect(client.events).toEqual([]);
        expect(ws.readyState).toBe(WebSocket.CONNECTING);
      },
    );

    test("req.destroy(error) emits 'error' with that error, then 'close' 1006", async () => {
      await using client = await rejectedClient();
      const { ws, req } = client;
      const error = new Error("boom");
      const watched = watchRequest(req);
      const errorEvent = nextEvent(ws, "error");
      expect(req.destroy(error)).toBe(req);
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      expect((await errorEvent)[0]).toBe(error);
      await Promise.all([client.closed, watched.closed]);
      expect(client.events).toEqual(boom);
      expect(watched.events).toEqual(["close"]);
    });
  });
});
