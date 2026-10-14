// The constructor and the opening handshake of a `ws` client, against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import path from "node:path";
import {
  attempt,
  closedPort,
  createPeer,
  dial,
  encodeFrame,
  event,
  implementations,
  OP,
  openClient,
  type RawSocket,
  response101,
  runScript,
  scriptTimeout,
  show,
  showError,
  watch,
} from "./ws-raw-peer";

const opening = ["upgrade 101 rs=0", "open rs=1"];
const lost = "close 1006 Buffer() rs=3";
const scheme = 'The URL\'s protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"';
const thrown = (name: string, message: string) => `throws ${name} ${JSON.stringify(message)}`;
const labelled = <Row extends { value: unknown }>(rows: Row[]) =>
  rows.map(row => ({ label: typeof row.value === "object" ? JSON.stringify(row.value) : show(row.value), ...row }));
// For errors whose text belongs to Node's HTTP parser or to OpenSSL: class and code stay.
const withoutMessage = (line: string) => line.replace(/ ".*"/, "");
// The key has to be 16 random bytes in base64.
const requestLines = (conn: RawSocket) =>
  conn.headLines.map(line => line.replace(/^(Sec-WebSocket-Key: )[A-Za-z0-9+/]{22}==$/, "$1<key>"));
// Answers of the raw server: a correct 101 with more headers, or with some of its own changed or dropped.
const accepted = (headers: string[]) => (conn: RawSocket) => response101(conn, headers);
const changed = (replace: Record<string, string | null>) => (conn: RawSocket) => response101(conn, [], replace);

describe.each(implementations)("ws client, opening ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket } = implementation;

  // A socket made by hand, terminated at the end of the block.
  const connect = (address: string | URL, options?: object) => {
    const ws = new WebSocket(address, options as {});
    return { ws, [Symbol.dispose]: () => void ws.on("error", () => {}).terminate() };
  };
  // The result of the constructor alone. A socket that should not exist is dropped at once.
  const construct = (...args: unknown[]) =>
    attempt(() => void new (WebSocket as any)(...args).on("error", () => {}).terminate());

  describe("the constructor", () => {
    test.each(
      labelled([
        { value: undefined, message: "Invalid URL: undefined" },
        { value: "", message: "Invalid URL: " },
        { value: "foo", message: "Invalid URL: foo" },
        { value: "ws://", message: "Invalid URL: ws://" },
        { value: "//x", message: "Invalid URL: //x" },
        { value: 42, message: "Invalid URL: 42" },
        { value: {}, message: "Invalid URL: [object Object]" },
        { value: "bad-scheme://localhost", message: scheme },
        { value: "ftp://x", message: scheme },
        { value: "ws+unix:", message: "The URL's pathname is empty" },
        // A scheme that Bun adds.
        { value: "wss+unix:", message: builtin ? "The URL's pathname is empty" : scheme },
        { value: "ws://localhost#foo", message: "The URL contains a fragment identifier" },
      ]),
    )("new WebSocket($label) throws a SyntaxError", ({ value, message }) => {
      expect(construct(value)).toBe(thrown("SyntaxError", message));
    });

    // null makes a server socket, which needs its options.
    test("new WebSocket(null) throws a TypeError", () => {
      expect(() => new WebSocket(null)).toThrow(TypeError);
    });

    test.each(
      labelled([
        { value: ["foo", "foo"] },
        { value: ["foo", "bar@"] },
        { value: ["a b"] },
        { value: [""] },
        { value: [1] },
        { value: "" },
        { value: " " },
        { value: "a,b" },
      ]),
    )("protocols $label throw a SyntaxError", async ({ value }) => {
      expect(construct("ws://127.0.0.1:" + (await closedPort()), value)).toBe(
        thrown("SyntaxError", "An invalid or duplicated subprotocol was specified"),
      );
    });

    test.each(
      labelled([
        { value: 1000, result: thrown("RangeError", "Unsupported protocol version: 1000 (supported versions: 8, 13)") },
        { value: 7, result: thrown("RangeError", "Unsupported protocol version: 7 (supported versions: 8, 13)") },
        { value: "13", result: thrown("RangeError", "Unsupported protocol version: 13 (supported versions: 8, 13)") },
        { value: 8, result: "undefined" },
        { value: 13, result: "undefined" },
      ]),
    )("protocolVersion: $label", async ({ value, result }) => {
      expect(construct("ws://127.0.0.1:" + (await closedPort()), { protocolVersion: value })).toBe(result);
    });

    test("the attributes of a CONNECTING socket", async () => {
      await using client = await dial(
        implementation,
        { path: "/p?q=1", protocols: ["a", "b"] },
        { respond: () => null },
      );
      const ws = client.ws as any;
      expect({
        readyState: ws.readyState,
        url: ws.url,
        protocol: ws.protocol,
        extensions: ws.extensions,
        bufferedAmount: ws.bufferedAmount,
        isPaused: ws.isPaused,
        binaryType: ws.binaryType,
        onopen: ws.onopen,
        onerror: ws.onerror,
        onclose: ws.onclose,
        onmessage: ws.onmessage,
        _socket: ws._socket,
        _req: show(ws._req),
        _isServer: ws._isServer,
      }).toEqual({
        readyState: WebSocket.CONNECTING,
        url: client.peer.url + "/p?q=1",
        protocol: "",
        extensions: "",
        bufferedAmount: 0,
        isPaused: false,
        binaryType: "nodebuffer",
        onopen: null,
        onerror: null,
        onclose: null,
        onmessage: null,
        _socket: null,
        _req: "ClientRequest",
        _isServer: false,
      });
    });

    test("an http: URL becomes ws:", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url.replace("ws:", "http:"));
      await event(client.ws, "open");
      expect(client.ws.url).toBe(peer.url + "/");
    });

    test("a URL object", async () => {
      await using peer = await createPeer();
      using client = connect(new URL(peer.url + "/a/b?c=d"));
      await event(client.ws, "open");
      expect(client.ws.url).toBe(peer.url + "/a/b?c=d");
      expect((await peer.connection()).headLines[0]).toBe("GET /a/b?c=d HTTP/1.1");
    });

    test("a subclass", async () => {
      class Mine extends WebSocket {
        extra = 1;
        send(data: string) {
          return super.send("x" + data);
        }
      }
      await using peer = await createPeer();
      const ws = new Mine(peer.url);
      try {
        await event(ws, "open");
        ws.send("a");
        expect(await (await peer.connection()).next()).toBe('text "xa"');
        expect(ws).toBeInstanceOf(Mine);
        expect(ws).toBeInstanceOf(WebSocket);
        expect(ws.extra).toBe(1);
      } finally {
        ws.on("error", () => {}).terminate();
      }
    });
  });

  describe("the request", () => {
    // Sorted: Bun's native client writes the same lines in its own order.
    test.each([
      {
        label: "by default",
        options: {},
        extensions: ["Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits"],
      },
      { label: "with perMessageDeflate: false", options: { perMessageDeflate: false }, extensions: [] },
    ])("$label", async ({ options, extensions }) => {
      await using client = await dial(implementation, { path: "/path?x=1", ...options });
      const [requestLine, ...headers] = requestLines(await client.peer.connection());
      expect(requestLine).toBe("GET /path?x=1 HTTP/1.1");
      expect(headers.sort()).toEqual([
        "Connection: Upgrade",
        `Host: 127.0.0.1:${client.peer.port}`,
        ...extensions,
        "Sec-WebSocket-Key: <key>",
        "Sec-WebSocket-Version: 13",
        "Upgrade: websocket",
      ]);
    });

    test.each([
      { url: "", requestLine: "GET / HTTP/1.1" },
      { url: "?x=1", requestLine: "GET /?x=1 HTTP/1.1" },
      { url: "/a%20b/?c=d%26e", requestLine: "GET /a%20b/?c=d%26e HTTP/1.1" },
      { url: "/é ?ü", requestLine: "GET /%C3%A9%20?%C3%BC HTTP/1.1" },
    ])("the path and query of ws://host$url", async ({ url, requestLine }) => {
      await using client = await dial(implementation, { path: url });
      expect((await client.peer.connection()).headLines[0]).toBe(requestLine);
    });

    test.each([
      { option: "origin", options: { origin: "https://example.com:8000" }, line: "Origin: https://example.com:8000" },
      { option: "auth", options: { auth: "foo:bar" }, line: "Authorization: Basic Zm9vOmJhcg==" },
      {
        option: "perMessageDeflate with parameters",
        options: {
          perMessageDeflate: {
            clientNoContextTakeover: true,
            serverNoContextTakeover: true,
            clientMaxWindowBits: 10,
            serverMaxWindowBits: 11,
          },
        },
        line:
          "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover; " +
          "server_max_window_bits=11; client_max_window_bits=10",
      },
    ])("$option", async ({ options, line }) => {
      await using client = await dial(implementation, options);
      expect((await client.peer.connection()).headLines).toContain(line);
    });

    test.each([
      { label: "a list", protocols: ["a", "b"], offer: "a,b" },
      { label: "a string", protocols: "b", offer: "b" },
    ])("protocols as $label, and the one the server picks", async ({ protocols, offer }) => {
      await using client = await openClient(implementation, { protocols }, { headers: ["Sec-WebSocket-Protocol: b"] });
      expect(client.conn.header("sec-websocket-protocol")).toBe(offer);
      expect(client.ws.protocol).toBe("b");
      expect(client.events).toEqual(opening);
    });

    test("protocols that differ only in case are two protocols", async () => {
      const headers = ["Sec-WebSocket-Protocol: foo"];
      await using client = await openClient(implementation, { protocols: ["Foo", "foo"] }, { headers });
      expect(client.conn.header("sec-websocket-protocol")).toBe("Foo,foo");
      expect(client.ws.protocol).toBe("foo");
    });

    test("protocolVersion: 8 is sent, and `origin` goes into Sec-WebSocket-Origin", async () => {
      await using client = await openClient(implementation, { protocolVersion: 8, origin: "https://example.com:8000" });
      const { conn } = client;
      expect(["sec-websocket-version", "sec-websocket-origin", "origin"].map(name => conn.header(name))).toEqual([
        "8",
        "https://example.com:8000",
        undefined,
      ]);
      expect(client.events).toEqual(opening);
    });

    test("credentials in the URL go into Authorization and stay in `url`", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url.replace("ws://", "ws://foo:bar@"));
      const conn = await peer.connection();
      expect(conn.headLines[0]).toBe("GET / HTTP/1.1");
      expect(conn.header("authorization")).toBe("Basic Zm9vOmJhcg==");
      expect(conn.header("host")).toBe(`127.0.0.1:${peer.port}`);
      expect(client.ws.url).toBe(`ws://foo:bar@127.0.0.1:${peer.port}/`);
    });

    test("`headers` are sent with their case, and replace Host", async () => {
      await using client = await dial(implementation, {
        headers: { Cookie: "foo=bar", "x-num": 5, Host: "example.test", "User-Agent": "mine" } as {},
      });
      const lines = (await client.peer.connection()).headLines.filter(line =>
        /^(cookie|x-|host|user-agent)/i.test(line),
      );
      expect(lines.sort()).toEqual(["Cookie: foo=bar", "Host: example.test", "User-Agent: mine", "x-num: 5"]);
    });

    test("a header whose value is an array", async () => {
      await using client = await dial(implementation, { headers: { "X-Multi": ["a", "b"] } as {} });
      const lines = (await client.peer.connection()).headLines.filter(line => /^x-multi/i.test(line));
      // One line per element. The built-in sends the same list as one line.
      expect(lines).toEqual(builtin ? ["X-Multi: a, b"] : ["X-Multi: a", "X-Multi: b"]);
    });

    test("`headers` cannot replace the headers of the handshake", async () => {
      await using client = await openClient(implementation, {
        headers: {
          "Sec-WebSocket-Key": "AAAAAAAAAAAAAAAAAAAAAA==",
          "Sec-WebSocket-Version": "99",
          Upgrade: "foo",
          Connection: "bar",
        },
      });
      const lines = requestLines(client.conn).filter(line =>
        /^(sec-websocket-(key|version)|upgrade|connection):/i.test(line),
      );
      expect(lines.sort()).toEqual([
        "Connection: Upgrade",
        "Sec-WebSocket-Key: <key>",
        "Sec-WebSocket-Version: 13",
        "Upgrade: websocket",
      ]);
      expect(client.conn.header("sec-websocket-key")).not.toBe("AAAAAAAAAAAAAAAAAAAAAA==");
      expect(client.events).toEqual(opening);
    });

    test("the options method, path, host and port of http.request() are ignored", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url + "/real", { method: "POST", path: "/fake", host: "0.0.0.0", port: 1 });
      expect((await peer.connection()).headLines[0]).toBe("GET /real HTTP/1.1");
    });
  });

  test.each([
    { answer: "Upgrade: WebSocket", respond: changed({ Upgrade: "WebSocket" }) },
    { answer: "Connection: upgrade", respond: changed({ Connection: "upgrade" }) },
    { answer: "Connection: keep-alive, Upgrade", respond: changed({ Connection: "keep-alive, Upgrade" }) },
    {
      answer: "header names in lower case",
      respond: (conn: RawSocket) => response101(conn).replace(/^[\w-]+:/gm, name => name.toLowerCase()),
    },
    {
      answer: "another reason phrase",
      respond: (conn: RawSocket) => response101(conn).replace("Switching Protocols", "Fine"),
    },
    {
      answer: "permessage-deflate",
      respond: accepted(["Sec-WebSocket-Extensions: permessage-deflate"]),
      extensions: "permessage-deflate",
    },
    {
      answer: "permessage-deflate with parameters",
      respond: accepted([
        "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_max_window_bits=10",
      ]),
      extensions: "permessage-deflate",
    },
  ])("the server may answer with $answer", async ({ respond, extensions = "" }) => {
    await using client = await openClient(implementation, {}, { respond });
    expect(client.ws.extensions).toBe(extensions);
    expect(await client.conn.roundTrip()).toEqual([]);
    expect(client.events).toEqual(opening);
  });

  describe("the server's answer is not acceptable", () => {
    const noExtension = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";

    // `upgrade`: node:http took the answer for an upgrade, so 'upgrade' comes first.
    test.each([
      {
        answer: "404",
        respond: () => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n",
        message: "Unexpected server response: 404",
      },
      {
        answer: "200 with a body",
        respond: () => "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi",
        message: "Unexpected server response: 200",
      },
      {
        answer: "302 without followRedirects",
        respond: () => "HTTP/1.1 302 Found\r\nLocation: ws://127.0.0.1:1/\r\nContent-Length: 0\r\n\r\n",
        message: "Unexpected server response: 302",
      },
      {
        answer: "101 without Upgrade",
        respond: changed({ Upgrade: null }),
        message: "Unexpected server response: 101",
      },
      {
        answer: "101 without Connection",
        respond: changed({ Connection: null }),
        message: "Unexpected server response: 101",
      },
      {
        answer: "Upgrade: foo",
        respond: changed({ Upgrade: "foo" }),
        upgrade: true,
        message: "Invalid Upgrade header",
      },
      {
        answer: "the Sec-WebSocket-Accept of another key",
        respond: changed({ "Sec-WebSocket-Accept": "CxYS6+NgJSBG74mdgLvGscRvpns=" }),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Accept header",
      },
      {
        answer: "no Sec-WebSocket-Accept",
        respond: changed({ "Sec-WebSocket-Accept": null }),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Accept header",
      },
      {
        answer: "permessage-deflate after perMessageDeflate: false",
        options: { perMessageDeflate: false },
        respond: accepted(["Sec-WebSocket-Extensions: permessage-deflate"]),
        upgrade: true,
        message: noExtension,
      },
      {
        answer: "an extension nobody offered",
        respond: accepted(["Sec-WebSocket-Extensions: foo"]),
        upgrade: true,
        message: "Server indicated an extension that was not requested",
      },
      {
        answer: "a Sec-WebSocket-Extensions header that does not parse",
        respond: accepted(["Sec-WebSocket-Extensions: foo;="]),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Extensions header",
      },
      {
        answer: "permessage-deflate; server_max_window_bits=7",
        respond: accepted(["Sec-WebSocket-Extensions: permessage-deflate; server_max_window_bits=7"]),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Extensions header",
      },
      {
        answer: "a subprotocol when none was offered",
        respond: accepted(["Sec-WebSocket-Protocol: foo"]),
        upgrade: true,
        message: "Server sent a subprotocol but none was requested",
      },
      {
        answer: "a subprotocol that was not offered",
        options: { protocols: ["foo", "bar"] },
        respond: accepted(["Sec-WebSocket-Protocol: baz"]),
        upgrade: true,
        message: "Server sent an invalid subprotocol",
      },
      {
        answer: "no subprotocol when one was offered",
        options: { protocols: ["foo"] },
        respond: accepted([]),
        upgrade: true,
        message: "Server sent no subprotocol",
      },
    ])("$answer: $message", async ({ respond, options, upgrade, message }) => {
      await using client = await dial(implementation, options, { respond });
      await client.closed;
      expect(client.events).toEqual([
        ...(upgrade ? ["upgrade 101 rs=0"] : []),
        `error Error ${JSON.stringify(message)} rs=2`,
        lost,
      ]);
      // The client hangs up without a frame.
      const conn = await client.peer.connection();
      expect(await conn.rest()).toEqual([]);
      expect(conn.tcp).toEqual(["end"]);
    });

    test("not HTTP at all", async () => {
      await using client = await dial(implementation, {}, { respond: () => "garbage\r\n\r\n" });
      await client.closed;
      expect(client.events.map(withoutMessage)).toEqual(["error Error HPE_INVALID_CONSTANT rs=2", lost]);
      const conn = await client.peer.connection();
      expect(await conn.rest()).toEqual([]);
      expect(conn.tcp).toEqual(["end"]);
    });

    test.each([
      { how: "FIN", drop: (conn: RawSocket) => conn.end(), error: 'Error "socket hang up" ECONNRESET' },
      { how: "RST", drop: (conn: RawSocket) => conn.reset(), error: 'Error "read ECONNRESET" ECONNRESET' },
    ])("$how in place of an answer: $error", async ({ drop, error }) => {
      await using client = await dial(implementation, {}, { respond: conn => (drop(conn), null) });
      await client.closed;
      expect(client.events).toEqual([`error ${error} rs=2`, lost]);
      expect(await (await client.peer.connection()).rest()).toEqual([]);
    });

    test("no answer within handshakeTimeout", async () => {
      await using client = await dial(implementation, { handshakeTimeout: 50 }, { respond: () => null });
      await client.closed;
      expect(client.events).toEqual(['error Error "Opening handshake has timed out" rs=2', lost]);
    });

    // The process ends once no timer is left, so one that still runs would be heard. Through a proxy the built-in
    // dials by itself also with `finishRequest`.
    test.each([
      { label: "a constructor", options: "" },
      { label: "a `finishRequest`", options: "finishRequest: request => request.end()," },
      { label: "a `finishRequest`, through a proxy", options: 'finishRequest: request => request.end(), proxy: "http://127.0.0.1:9",' }, // prettier-ignore
    ])("$label that throws leaves no `handshakeTimeout` timer behind", async ({ options }) => {
      const { lines, exitCode } = await runScript(
        { specifier },
        `try {
           new WebSocket("ws://127.0.0.1:9", { ${options} handshakeTimeout: 50, headers: { "X-Bad": "a\\r\\nb" } });
         } catch (error) {
           console.log("threw " + error.name);
         }`,
      );
      expect(lines).toEqual(["threw TypeError"]);
      expect(exitCode).toBe(0);
    });

    // The global WebSocket gives up on a handshake by itself. It is the clock here: made after the `ws` socket, so
    // its time is up later.
    test.concurrent(
      "without handshakeTimeout the client waits, longer than the global WebSocket does",
      async () => {
        await using peer = await createPeer({ respond: () => null });
        const script = `
          const ws = new WebSocket(process.env.PEER_URL + "/ws");
          ws.on("error", error => console.log("error", showError(error)));
          ws.on("open", () => {
            console.log("open");
            ws.terminate();
          });
          const clock = new globalThis.WebSocket(process.env.PEER_URL + "/clock");
          clock.onclose = () => console.log("the global WebSocket gave up, readyState", ws.readyState);
        `;
        const child = runScript({ specifier }, script, { PEER_URL: peer.url, BUN_CONFIG_WS_HANDSHAKE_TIMEOUT: "1" });
        const connections = [await peer.connection(), await peer.connection()];
        const conn = connections.find(connection => connection.headLines[0].startsWith("GET /ws "))!;
        const clock = connections.find(connection => connection !== conn)!;
        await clock.ended;
        conn.write(response101(conn));
        expect((await child).lines).toEqual(["the global WebSocket gave up, readyState 0", "open"]);
      },
      scriptTimeout,
    );

    describe("every kind of listener gets the same error, then 'close' 1006", () => {
      // No Content-Length: the body ends with the connection.
      const respond = (conn: RawSocket) => (conn.write("HTTP/1.1 503 Service Unavailable\r\n\r\n"), conn.end(), null);

      // These sockets have no listener but the ones under test.
      test("on()", async () => {
        await using peer = await createPeer({ respond });
        using client = connect(peer.url);
        const { ws } = client;
        const seen: string[] = [];
        ws.on("error", (...args) => seen.push(`error ${args.map(show).join(" ")} rs=${ws.readyState}`));
        ws.on("close", (...args) => seen.push(`close ${args.map(show).join(" ")} rs=${ws.readyState}`));
        await event(ws, "close");
        expect(seen).toEqual(['error Error "Unexpected server response: 503" rs=2', lost]);
      });

      type Listen = (ws: any, type: "error" | "close", listener: (event: any) => void) => void;
      test.each([
        { kind: "onerror and onclose", listen: ((ws, type, listener) => (ws[`on${type}`] = listener)) as Listen },
        { kind: "addEventListener()", listen: ((ws, type, listener) => ws.addEventListener(type, listener)) as Listen },
      ])("$kind", async ({ listen }) => {
        await using peer = await createPeer({ respond });
        using client = connect(peer.url);
        const { ws } = client;
        const seen: unknown[] = [];
        const closed = Promise.withResolvers<void>();
        listen(ws, "error", event =>
          seen.push({
            class: event.constructor.name,
            type: event.type,
            message: event.message,
            error: showError(event.error),
            target: event.target === ws,
            readyState: ws.readyState,
          }),
        );
        listen(ws, "close", event => {
          seen.push({
            class: event.constructor.name,
            type: event.type,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            target: event.target === ws,
            readyState: ws.readyState,
          });
          closed.resolve();
        });
        await closed.promise;
        expect(seen).toEqual([
          {
            class: "ErrorEvent",
            type: "error",
            message: "Unexpected server response: 503",
            error: 'Error "Unexpected server response: 503"',
            target: true,
            readyState: WebSocket.CLOSING,
          },
          {
            class: "CloseEvent",
            type: "close",
            code: 1006,
            reason: "",
            wasClean: false,
            target: true,
            readyState: WebSocket.CLOSED,
          },
        ]);
      });
    });
  });

  test("a refused connection: the error of node:net", async () => {
    const port = await closedPort();
    using client = connect("ws://127.0.0.1:" + port);
    const events = watch(client.ws);
    const closed = event(client.ws, "close");
    const [error] = await event(client.ws, "error");
    expect({ ...error, errno: typeof error.errno }).toEqual({
      errno: "number",
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "127.0.0.1",
      port,
    });
    await closed;
    expect(events).toEqual(['error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED rs=2', lost]);
  });

  describe("redirects", () => {
    const redirect = (location: string) => `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 0\r\n\r\n`;

    test("followRedirects: 'redirect', then the handshake at the new URL", async () => {
      await using target = await createPeer();
      await using client = await dial(
        implementation,
        { followRedirects: true },
        { respond: () => redirect(target.url + "/dest") },
      );
      const { ws, events } = client;
      ws.on("redirect", (url, request) => events.push(`redirect ${url} ${show(request)}`));
      await client.opened;
      expect(events).toEqual([`redirect ${target.url}/dest ClientRequest`, ...opening]);
      expect(ws.url).toBe(target.url + "/dest");
      expect((await target.connection()).headLines[0]).toBe("GET /dest HTTP/1.1");
      // The first connection is given up.
      expect(await (await client.peer.connection()).rest()).toEqual([]);
    });

    test("maxRedirects", async () => {
      await using client = await dial(
        implementation,
        { followRedirects: true, maxRedirects: 1 },
        { respond: () => redirect("/again") },
      );
      await client.closed;
      expect(client.events).toEqual(['error Error "Maximum redirects exceeded" rs=2', lost]);
      expect(client.peer.connections.map(conn => conn.headLines[0])).toEqual(["GET / HTTP/1.1", "GET /again HTTP/1.1"]);
    });

    test.each([
      { location: "ws://", message: "Invalid URL: ws://" },
      { location: "bad-scheme://localhost", message: scheme },
    ])("Location: $location is an 'error', not an exception", async ({ location, message }) => {
      await using client = await dial(implementation, { followRedirects: true }, { respond: () => redirect(location) });
      await client.closed;
      expect(client.events).toEqual([`error SyntaxError ${JSON.stringify(message)} rs=2`, lost]);
    });

    test("Location: /# is followed, an empty fragment is no fragment", async () => {
      await using client = await dial(
        implementation,
        { followRedirects: true },
        { respond: conn => (conn.headLines[0] === "GET / HTTP/1.1" ? redirect("/dest#") : response101(conn)) },
      );
      await client.opened;
      expect(client.events).toEqual(opening);
      expect(client.ws.url).toBe(client.peer.url + "/dest#");
      expect(client.peer.connections.map(conn => conn.headLines[0])).toEqual(["GET / HTTP/1.1", "GET /dest HTTP/1.1"]);
    });

    // npm ws takes the empty socket path for none and dials localhost:80.
    test.skipIf(!builtin)("Location: ws+unix::/x, without a socket path, is an 'error', not an exception", async () => {
      await using client = await dial(
        implementation,
        { followRedirects: true },
        { respond: () => redirect("ws+unix::/x") },
      );
      await client.closed;
      expect(client.events).toEqual([
        'error SyntaxError "Invalid url for WebSocket ws+unix::/x (missing unix socket path)" rs=2',
        lost,
      ]);
    });

    // The process ends once no timer is left, so one that still runs would be heard.
    test.skipIf(!builtin)("..., and leaves no `handshakeTimeout` timer behind", async () => {
      await using peer = await createPeer({ respond: () => redirect("ws+unix::/x") });
      const { lines, exitCode } = await runScript(
        { specifier },
        `const ws = new WebSocket(${JSON.stringify(peer.url)}, { followRedirects: true, handshakeTimeout: 2000 });
         ws.on("error", error => console.log("error " + error.name));
         ws.on("close", code => console.log("close " + code));`,
      );
      expect(lines).toEqual(["error SyntaxError", "close 1006"]);
      expect(exitCode).toBe(0);
    });

    const headers = { Authorization: "Basic Zm9vOmJhcg==", Cookie: "foo=bar", Host: "example.test", "X-Other": "1" };
    const all = { authorization: "Basic Zm9vOmJhcg==", cookie: "foo=bar", host: "example.test", other: "1" };
    const own = "127.0.0.1:PORT";

    test.each([
      {
        label: "another host does not get Authorization, Cookie and Host",
        options: { headers },
        second: { authorization: undefined, cookie: undefined, host: own, other: "1" },
      },
      {
        label: "another host does not get the `auth` option",
        options: { auth: "foo:bar" },
        second: { authorization: undefined, cookie: undefined, host: own, other: undefined },
      },
      { label: "the same host gets every header again", options: { headers }, sameHost: true, second: all },
      {
        label: "a 'redirect' listener takes over: nothing is dropped",
        options: { headers },
        listener: true,
        second: all,
      },
    ])("$label", async ({ options, sameHost, listener, second }) => {
      await using target = await createPeer();
      await using client = await dial(
        implementation,
        { followRedirects: true, ...options },
        {
          respond: conn =>
            conn.headLines[0] === "GET / HTTP/1.1"
              ? redirect(sameHost ? "/dest" : target.url + "/dest")
              : response101(conn),
        },
      );
      if (listener) client.ws.on("redirect", () => {});
      await client.opened;
      await client.peer.connection();
      const conn = await (sameHost ? client.peer : target).connection();
      expect(conn.headLines[0]).toBe("GET /dest HTTP/1.1");
      expect({
        authorization: conn.header("authorization"),
        cookie: conn.header("cookie"),
        host: conn.header("host")?.replace(/:\d+$/, ":PORT"),
        other: conn.header("x-other"),
      }).toEqual(second);
    });
  });

  describe("frames in the same packet as the 101", () => {
    test("are delivered after 'open'", async () => {
      await using client = await openClient(
        implementation,
        {},
        { afterUpgrade: Buffer.concat([encodeFrame(OP.text, "early"), encodeFrame(OP.binary, Buffer.from([1, 2]))]) },
      );
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([
        ...opening,
        'message Buffer("early") text rs=1',
        "message Buffer(0x0102) binary rs=1",
      ]);
    });

    test("reach a listener that the 'open' listener adds", async () => {
      await using peer = await createPeer({ afterUpgrade: encodeFrame(OP.text, "early") });
      using client = connect(peer.url);
      const { ws } = client;
      const message = new Promise(resolve => ws.on("open", () => ws.on("message", data => resolve(show(data)))));
      expect(await message).toBe('Buffer("early")');
    });
  });

  describe.skipIf(isWindows)("ws+unix:", () => {
    test.each([
      { label: "socket:path", suffix: ":/foo?bar=bar", requestLine: "GET /foo?bar=bar HTTP/1.1" },
      { label: "the socket alone", suffix: "", requestLine: "GET / HTTP/1.1" },
    ])("$label", async ({ suffix, requestLine }) => {
      using dir = tempDir("ws", {});
      const socket = path.join(String(dir), "s");
      await using client = await openClient(implementation, { path: suffix }, { path: socket });
      expect(client.ws.url).toBe(`ws+unix:${socket}${suffix}`);
      expect(client.conn.headLines[0]).toBe(requestLine);
      expect(client.conn.header("host")).toBe("localhost");
      expect(client.events).toEqual(opening);
    });

    test("no such socket", async () => {
      using dir = tempDir("ws", {});
      const socket = path.join(String(dir), "s");
      using client = connect(`ws+unix:${socket}:/x`);
      const events = watch(client.ws);
      const closed = event(client.ws, "close");
      const [error] = await event(client.ws, "error");
      expect({ ...error, errno: typeof error.errno }).toEqual({
        errno: "number",
        code: "ENOENT",
        syscall: "connect",
        address: socket,
      });
      await closed;
      expect(events).toEqual([`error Error ${JSON.stringify("connect ENOENT " + socket)} ENOENT rs=2`, lost]);
    });

    test.skipIf(!builtin)("wss+unix: is the same over TLS", async () => {
      using dir = tempDir("ws", {});
      const socket = path.join(String(dir), "s");
      await using peer = await createPeer({ secure: true, path: socket });
      using client = connect(`wss+unix:${socket}:/x?y=1`, { ca: tls.cert });
      const events = watch(client.ws);
      await event(client.ws, "open");
      const conn = await peer.connection();
      expect(client.ws.url).toBe(`wss+unix:${socket}:/x?y=1`);
      expect(conn.headLines[0]).toBe("GET /x?y=1 HTTP/1.1");
      expect(conn.header("host")).toBe("localhost");
      client.ws.send("over TLS");
      expect(await conn.next()).toBe('text "over TLS"');
      expect(events).toEqual(opening);
    });
  });

  describe("TLS", () => {
    test("a self-signed certificate is refused before the request goes out", async () => {
      await using client = await dial(implementation, {}, { secure: true });
      await client.closed;
      expect(client.events.map(withoutMessage)).toEqual(["error Error DEPTH_ZERO_SELF_SIGNED_CERT rs=2", lost]);
      // The first request the server reads is that of a second client.
      using second = connect(client.peer.url + "/second", { rejectUnauthorized: false });
      expect((await client.peer.connection()).headLines[0]).toBe("GET /second HTTP/1.1");
    });

    test.each([
      { option: "rejectUnauthorized: false", options: { rejectUnauthorized: false } },
      { option: "ca", options: { ca: tls.cert } },
    ])("$option accepts it", async ({ options }) => {
      await using client = await openClient(implementation, options, { secure: true });
      expect(client.events).toEqual(opening);
      client.ws.send("over TLS");
      expect(await client.conn.next()).toBe('text "over TLS"');
    });

    test("an https: URL becomes wss:", async () => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url.replace("wss:", "https:") + "/x", { ca: tls.cert });
      await event(client.ws, "open");
      expect(client.ws.url).toBe(peer.url + "/x");
    });

    test("ws: to a TLS port", async () => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url.replace("wss:", "ws:"));
      const events = watch(client.ws);
      await event(client.ws, "close");
      expect(events).toEqual(['error Error "socket hang up" ECONNRESET rs=2', lost]);
    });
  });
});
