// Tests the `ws` client's constructor and opening handshake against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import crypto from "node:crypto";
import type { ClientRequest } from "node:http";
import path from "node:path";
import {
  abnormalClose,
  type ClientOptions,
  closedPort,
  connectClient,
  createInflater,
  createPeer,
  deflate,
  encodeFrame,
  implementations,
  nextEvent,
  OP,
  openClient,
  openEvents,
  type RawSocket,
  recordEvents,
  response101,
  runScript,
  scriptTimeout,
  show,
  showError,
  stripMessage,
  tryCall,
} from "./ws-raw-peer";

const invalidScheme = 'The URL\'s protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"';
const thrown = (name: string, message: string) => `throws ${name} ${JSON.stringify(message)}`;
const withLabels = <Row extends { value: unknown }>(rows: Row[]) =>
  rows.map(row => ({ label: typeof row.value === "object" ? JSON.stringify(row.value) : show(row.value), ...row }));
// Replaces the random key with <key>, but only if it's valid: 16 bytes in base64.
const requestLines = (conn: RawSocket) =>
  conn.headLines.map(line => line.replace(/^(Sec-WebSocket-Key: )[A-Za-z0-9+/]{22}==$/, "$1<key>"));
// Raw server responses: a valid 101 with extra headers, or with some of its standard headers replaced or removed.
const withExtraHeaders = (headers: string[]) => (conn: RawSocket) => response101(conn, headers);
const withReplacedHeaders = (replace: Record<string, string | null>) => (conn: RawSocket) =>
  response101(conn, [], replace);
const forbidden = (length: number) => `HTTP/1.1 403 Forbidden\r\nContent-Length: ${length}\r\n\r\nno`;
const redirect = (location: string) => `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 0\r\n\r\n`;

describe.each(implementations)("ws client opening handshake ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket } = implementation;

  // A bare client, without connectClient()'s peer and event log. Disposing it terminates the socket.
  const connect = (address: string | URL, options?: object) => {
    const ws = new WebSocket(address, options as {});
    return { ws, [Symbol.dispose]: () => void ws.on("error", () => {}).terminate() };
  };
  // Returns what the constructor throws, or "undefined". If it doesn't throw, the socket is terminated right away.
  const construct = (...args: unknown[]) =>
    tryCall(() => void new (WebSocket as any)(...args).on("error", () => {}).terminate());

  describe("constructor", () => {
    test.each(
      withLabels([
        { value: undefined, message: "Invalid URL: undefined" },
        { value: "", message: "Invalid URL: " },
        { value: "foo", message: "Invalid URL: foo" },
        { value: "ws://", message: "Invalid URL: ws://" },
        { value: "//x", message: "Invalid URL: //x" },
        { value: 42, message: "Invalid URL: 42" },
        { value: {}, message: "Invalid URL: [object Object]" },
        { value: "bad-scheme://localhost", message: invalidScheme },
        { value: "ftp://x", message: invalidScheme },
        { value: "ws+unix:", message: "The URL's pathname is empty" },
        // Bun-only scheme.
        { value: "wss+unix:", message: builtin ? "The URL's pathname is empty" : invalidScheme },
        { value: "ws://localhost#foo", message: "The URL contains a fragment identifier" },
      ]),
    )("new WebSocket($label) throws a SyntaxError", ({ value, message }) => {
      expect(construct(value)).toBe(thrown("SyntaxError", message));
    });

    // A null address creates a server-side socket, which reads `options` without checking that it was passed.
    test("new WebSocket(null) throws a TypeError", () => {
      expect(() => new WebSocket(null)).toThrow(TypeError);
    });

    test.each(
      withLabels([
        { value: ["foo", "foo"] },
        { value: ["foo", "bar@"] },
        { value: ["a b"] },
        { value: [""] },
        { value: [1] },
        { value: "" },
        { value: " " },
        { value: "a,b" },
      ]),
    )("protocols $label throws a SyntaxError", async ({ value }) => {
      expect(construct("ws://127.0.0.1:" + (await closedPort()), value)).toBe(
        thrown("SyntaxError", "An invalid or duplicated subprotocol was specified"),
      );
    });

    test.each(
      withLabels([
        { value: 1000, result: thrown("RangeError", "Unsupported protocol version: 1000 (supported versions: 8, 13)") },
        { value: 7, result: thrown("RangeError", "Unsupported protocol version: 7 (supported versions: 8, 13)") },
        { value: "13", result: thrown("RangeError", "Unsupported protocol version: 13 (supported versions: 8, 13)") },
        { value: 8, result: "undefined" },
        { value: 13, result: "undefined" },
      ]),
    )("protocolVersion: $label", async ({ value, result }) => {
      expect(construct("ws://127.0.0.1:" + (await closedPort()), { protocolVersion: value })).toBe(result);
    });

    test("property values while CONNECTING", async () => {
      await using client = await connectClient(
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

    test("rewrites an http: URL to ws:", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url.replace("ws:", "http:"));
      await nextEvent(client.ws, "open");
      expect(client.ws.url).toBe(peer.url + "/");
    });

    test("accepts a URL object", async () => {
      await using peer = await createPeer();
      using client = connect(new URL(peer.url + "/a/b?c=d"));
      await nextEvent(client.ws, "open");
      expect(client.ws.url).toBe(peer.url + "/a/b?c=d");
      expect((await peer.connection()).headLines[0]).toBe("GET /a/b?c=d HTTP/1.1");
    });

    test("can be subclassed", async () => {
      class CustomWebSocket extends WebSocket {
        extra = 1;
        send(data: string) {
          return super.send("x" + data);
        }
      }
      await using peer = await createPeer();
      const ws = new CustomWebSocket(peer.url);
      try {
        await nextEvent(ws, "open");
        ws.send("a");
        expect(await (await peer.connection()).next()).toBe('text "xa"');
        expect(ws).toBeInstanceOf(CustomWebSocket);
        expect(ws).toBeInstanceOf(WebSocket);
        expect(ws.extra).toBe(1);
      } finally {
        ws.on("error", () => {}).terminate();
      }
    });
  });

  describe("upgrade request", () => {
    // Compare sorted. Bun's native client sends the same headers in a different order.
    test.each([
      {
        label: "default headers",
        options: {},
        extensions: ["Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits"],
      },
      { label: "headers with perMessageDeflate: false", options: { perMessageDeflate: false }, extensions: [] },
    ])("$label", async ({ options, extensions }) => {
      await using client = await connectClient(implementation, { path: "/path?x=1", ...options });
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
    ])("request line for ws://host$url", async ({ url, requestLine }) => {
      await using client = await connectClient(implementation, { path: url });
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
    ])("$option sets its header", async ({ options, line }) => {
      await using client = await connectClient(implementation, options);
      expect((await client.peer.connection()).headLines).toContain(line);
    });

    test.each([
      { label: "an array", protocols: ["a", "b"], offer: "a,b" },
      { label: "a string", protocols: "b", offer: "b" },
    ])("offers protocols passed as $label and exposes the one the server selects", async ({ protocols, offer }) => {
      await using client = await openClient(implementation, { protocols }, { headers: ["Sec-WebSocket-Protocol: b"] });
      expect(client.conn.header("sec-websocket-protocol")).toBe(offer);
      expect(client.ws.protocol).toBe("b");
      expect(client.events).toEqual(openEvents);
    });

    test("subprotocol names are case-sensitive", async () => {
      const headers = ["Sec-WebSocket-Protocol: foo"];
      await using client = await openClient(implementation, { protocols: ["Foo", "foo"] }, { headers });
      expect(client.conn.header("sec-websocket-protocol")).toBe("Foo,foo");
      expect(client.ws.protocol).toBe("foo");
    });

    test("protocolVersion: 8 sends version 8, and `origin` as Sec-WebSocket-Origin", async () => {
      await using client = await openClient(implementation, { protocolVersion: 8, origin: "https://example.com:8000" });
      const { conn } = client;
      expect(["sec-websocket-version", "sec-websocket-origin", "origin"].map(name => conn.header(name))).toEqual([
        "8",
        "https://example.com:8000",
        undefined,
      ]);
      expect(client.events).toEqual(openEvents);
    });

    test("URL credentials are sent as Authorization and kept in `url`", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url.replace("ws://", "ws://foo:bar@"));
      const conn = await peer.connection();
      expect(conn.headLines[0]).toBe("GET / HTTP/1.1");
      expect(conn.header("authorization")).toBe("Basic Zm9vOmJhcg==");
      expect(conn.header("host")).toBe(`127.0.0.1:${peer.port}`);
      expect(client.ws.url).toBe(`ws://foo:bar@127.0.0.1:${peer.port}/`);
    });

    test("`headers` keep their case and can override Host", async () => {
      await using client = await connectClient(implementation, {
        headers: { Cookie: "foo=bar", "x-num": 5, Host: "example.test", "User-Agent": "mine" } as {},
      });
      const lines = (await client.peer.connection()).headLines.filter(line =>
        /^(cookie|x-|host|user-agent)/i.test(line),
      );
      expect(lines.sort()).toEqual(["Cookie: foo=bar", "Host: example.test", "User-Agent: mine", "x-num: 5"]);
    });

    test.each<{ name: string; value: string[]; sent: string[] }>([
      { name: "cookie", value: ["a=1", "b=2"], sent: ["cookie: a=1; b=2"] },
      { name: "Cookie", value: ["a=1", "b=2", "c=3"], sent: ["cookie: a=1; b=2; c=3"] },
      { name: "COOKIE", value: ["a=1"], sent: ["cookie: a=1"] },
      { name: "X-Empty", value: [], sent: [] },
    ])("$name: $value is sent as $sent", async ({ name, value, sent }) => {
      await using client = await connectClient(implementation, { headers: { [name]: value } as {} });
      const lines = (await client.peer.connection()).headLines.filter(line =>
        line.toLowerCase().startsWith(name.toLowerCase()),
      );
      expect(lines.map(line => line.replace(/^[^:]+/, name => name.toLowerCase()))).toEqual(sent);
    });

    test("sends every element of an array-valued header", async () => {
      await using client = await connectClient(implementation, { headers: { "X-Multi": ["a", "b"] } as {} });
      const lines = (await client.peer.connection()).headLines.filter(line => /^x-multi/i.test(line));
      // npm ws sends one line per element. The built-in joins them into one line.
      expect(lines).toEqual(builtin ? ["X-Multi: a, b"] : ["X-Multi: a", "X-Multi: b"]);
    });

    test("`headers` can't override the handshake headers", async () => {
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
      expect(client.events).toEqual(openEvents);
    });

    test("ignores http.request()'s method, path, host and port options", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url + "/real", { method: "POST", path: "/fake", host: "0.0.0.0", port: 1 });
      expect((await peer.connection()).headLines[0]).toBe("GET /real HTTP/1.1");
    });
  });

  test.each([
    { response: "Upgrade: WebSocket", respond: withReplacedHeaders({ Upgrade: "WebSocket" }) },
    { response: "Connection: upgrade", respond: withReplacedHeaders({ Connection: "upgrade" }) },
    {
      response: "Connection: keep-alive, Upgrade",
      respond: withReplacedHeaders({ Connection: "keep-alive, Upgrade" }),
    },
    {
      response: "lowercase header names",
      respond: (conn: RawSocket) => response101(conn).replace(/^[\w-]+:/gm, name => name.toLowerCase()),
    },
    {
      response: "a different reason phrase",
      respond: (conn: RawSocket) => response101(conn).replace("Switching Protocols", "Fine"),
    },
    {
      response: "permessage-deflate",
      respond: withExtraHeaders(["Sec-WebSocket-Extensions: permessage-deflate"]),
      extensions: "permessage-deflate",
    },
    {
      response: "permessage-deflate with parameters",
      respond: withExtraHeaders([
        "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_max_window_bits=10",
      ]),
      extensions: "permessage-deflate",
    },
    // npm ws never reads Sec-WebSocket-Version in a response.
    { response: "Sec-WebSocket-Version: 8", respond: withExtraHeaders(["Sec-WebSocket-Version: 8"]) },
    { response: "Sec-WebSocket-Version: 13, 8", respond: withExtraHeaders(["Sec-WebSocket-Version: 13, 8"]) },
    { response: "an empty Sec-WebSocket-Version", respond: withExtraHeaders(["Sec-WebSocket-Version:"]) },
  ])("accepts a 101 with $response", async ({ respond, extensions = "" }) => {
    await using client = await connectClient(implementation, {}, { respond });
    await Promise.race([client.opened, client.closed]);
    expect(client.events).toEqual(openEvents);
    expect(client.ws.extensions).toBe(extensions);
    expect(await (await client.peer.connection()).roundTrip()).toEqual([]);
    expect(client.events).toEqual(openEvents);
  });

  describe("permessage-deflate responses that only a lenient parser accepts", () => {
    // 300 bytes repeat 2300 bytes later. That's inside a 2^15-byte window but outside a 2^10-byte one.
    const repeated = crypto.randomBytes(150).toString("hex");
    const message = repeated + crypto.randomBytes(1000).toString("hex") + repeated;

    type Row = {
      label?: string;
      options?: ClientOptions;
      /** One entry per Sec-WebSocket-Extensions header. */
      response: string[];
      /** What npm ws negotiates. */
      params: { server_max_window_bits?: number; client_max_window_bits?: number };
    };
    const withResponseLabels = (rows: Row[]) =>
      rows.map(row => ({ label: (row.response.length > 1 ? "two headers: " : "") + row.response.join(" | "), ...row }));

    test.each(
      withResponseLabels([
        // Only the first permessage-deflate entry counts.
        { response: ["permessage-deflate, permessage-deflate"], params: {} },
        { response: ["permessage-deflate", "permessage-deflate"], params: {} },
        {
          response: ["permessage-deflate; client_max_window_bits=10, permessage-deflate; client_max_window_bits=12"],
          params: { client_max_window_bits: 10 },
        },
        {
          response: ["permessage-deflate; client_max_window_bits=10", "permessage-deflate"],
          params: { client_max_window_bits: 10 },
        },
        // Window bits are converted with `+value`.
        { response: ["permessage-deflate; client_max_window_bits=015"], params: { client_max_window_bits: 15 } },
        { response: ["permessage-deflate; client_max_window_bits=1e1"], params: { client_max_window_bits: 10 } },
        { response: ["permessage-deflate; client_max_window_bits=0xa"], params: { client_max_window_bits: 10 } },
        { response: ["permessage-deflate; server_max_window_bits=015"], params: { server_max_window_bits: 15 } },
        { response: ["permessage-deflate; server_max_window_bits=1e1"], params: { server_max_window_bits: 10 } },
        { response: ["permessage-deflate; server_max_window_bits=10.0"], params: { server_max_window_bits: 10 } },
        { response: ['permessage-deflate; client_max_window_bits="1\\0"'], params: { client_max_window_bits: 10 } },
        // zlib can't compress with an 8-bit window, so the output of a 9-bit one has to fit.
        {
          response: ["permessage-deflate; server_max_window_bits=8; client_max_window_bits=8"],
          params: { server_max_window_bits: 8, client_max_window_bits: 8 },
        },
        // A string option is offered but not enforced.
        {
          label: 'permessage-deflate; client_max_window_bits=12 with clientMaxWindowBits: "10"',
          options: { perMessageDeflate: { clientMaxWindowBits: "10" as any } },
          response: ["permessage-deflate; client_max_window_bits=12"],
          params: { client_max_window_bits: 12 },
        },
      ]),
    )("$label", async ({ options, response, params }) => {
      const { server_max_window_bits = 15, client_max_window_bits = 15 } = params;
      await using client = await connectClient(implementation, options, {
        headers: response.map(value => `Sec-WebSocket-Extensions: ${value}`),
      });
      await Promise.race([client.opened, client.closed]);
      expect(client.events).toEqual(openEvents);
      const conn = await client.peer.connection();
      expect(client.ws.extensions).toBe("permessage-deflate");
      expect({ ...(client.ws as any)._extensions["permessage-deflate"].params }).toEqual(params);

      const received = nextEvent(client.ws, "message");
      conn.text(deflate(message, { windowBits: Math.max(server_max_window_bits, 9) }), { rsv1: true });
      expect(String((await received)[0])).toBe(message);

      client.ws.send(message);
      const frame = (await conn.nextFrame())!;
      expect(frame.rsv).toBe(4);
      // The small chunkSize forces zlib to resolve back-references from its window instead of its output buffer, so this
      // throws if the client compressed with a larger window than it agreed to.
      const inflate = createInflater({ windowBits: client_max_window_bits, chunkSize: 64 });
      expect(inflate(frame.payload).toString()).toBe(message);
    });
  });

  describe("failed handshake", () => {
    const noExtensionRequested = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";

    // `upgrade: true` means node:http treats the response as an upgrade, so 'upgrade' fires before 'error'.
    test.each([
      {
        response: "404",
        respond: () => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n",
        message: "Unexpected server response: 404",
      },
      {
        response: "200 with a body",
        respond: () => "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi",
        message: "Unexpected server response: 200",
      },
      {
        response: "302 without followRedirects",
        respond: () => "HTTP/1.1 302 Found\r\nLocation: ws://127.0.0.1:1/\r\nContent-Length: 0\r\n\r\n",
        message: "Unexpected server response: 302",
      },
      {
        response: "101 without Upgrade",
        respond: withReplacedHeaders({ Upgrade: null }),
        message: "Unexpected server response: 101",
      },
      {
        response: "101 without Connection",
        respond: withReplacedHeaders({ Connection: null }),
        message: "Unexpected server response: 101",
      },
      {
        response: "Upgrade: foo",
        respond: withReplacedHeaders({ Upgrade: "foo" }),
        upgrade: true,
        message: "Invalid Upgrade header",
      },
      {
        response: "a Sec-WebSocket-Accept for a different key",
        respond: withReplacedHeaders({ "Sec-WebSocket-Accept": "CxYS6+NgJSBG74mdgLvGscRvpns=" }),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Accept header",
      },
      {
        response: "no Sec-WebSocket-Accept",
        respond: withReplacedHeaders({ "Sec-WebSocket-Accept": null }),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Accept header",
      },
      {
        response: "permessage-deflate despite perMessageDeflate: false",
        options: { perMessageDeflate: false },
        respond: withExtraHeaders(["Sec-WebSocket-Extensions: permessage-deflate"]),
        upgrade: true,
        message: noExtensionRequested,
      },
      {
        response: "an extension that wasn't offered",
        respond: withExtraHeaders(["Sec-WebSocket-Extensions: foo"]),
        upgrade: true,
        message: "Server indicated an extension that was not requested",
      },
      {
        response: "a malformed Sec-WebSocket-Extensions header",
        respond: withExtraHeaders(["Sec-WebSocket-Extensions: foo;="]),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Extensions header",
      },
      {
        response: "permessage-deflate; server_max_window_bits=7",
        respond: withExtraHeaders(["Sec-WebSocket-Extensions: permessage-deflate; server_max_window_bits=7"]),
        upgrade: true,
        message: "Invalid Sec-WebSocket-Extensions header",
      },
      {
        response: "a subprotocol when none was offered",
        respond: withExtraHeaders(["Sec-WebSocket-Protocol: foo"]),
        upgrade: true,
        message: "Server sent a subprotocol but none was requested",
      },
      {
        response: "a subprotocol that wasn't offered",
        options: { protocols: ["foo", "bar"] },
        respond: withExtraHeaders(["Sec-WebSocket-Protocol: baz"]),
        upgrade: true,
        message: "Server sent an invalid subprotocol",
      },
      {
        response: "no subprotocol when one was offered",
        options: { protocols: ["foo"] },
        respond: withExtraHeaders([]),
        upgrade: true,
        message: "Server sent no subprotocol",
      },
    ])("$response: $message", async ({ respond, options, upgrade, message }) => {
      await using client = await connectClient(implementation, options, { respond });
      await client.closed;
      expect(client.events).toEqual([
        ...(upgrade ? ["upgrade 101 rs=0"] : []),
        `error Error ${JSON.stringify(message)} rs=2`,
        abnormalClose,
      ]);
      // The client closes the connection without sending a frame.
      const conn = await client.peer.connection();
      expect(await conn.remainingFrames()).toEqual([]);
      expect(conn.socketEvents).toEqual(["end"]);
    });

    test("a response that isn't HTTP", async () => {
      await using client = await connectClient(implementation, {}, { respond: () => "garbage\r\n\r\n" });
      await client.closed;
      expect(client.events.map(stripMessage)).toEqual(["error Error HPE_INVALID_CONSTANT rs=2", abnormalClose]);
      const conn = await client.peer.connection();
      expect(await conn.remainingFrames()).toEqual([]);
      expect(conn.socketEvents).toEqual(["end"]);
    });

    test.each([
      { flag: "FIN", disconnect: (conn: RawSocket) => conn.end(), error: 'Error "socket hang up" ECONNRESET' },
      { flag: "RST", disconnect: (conn: RawSocket) => conn.reset(), error: 'Error "read ECONNRESET" ECONNRESET' },
    ])("$flag instead of a response: $error", async ({ disconnect, error }) => {
      await using client = await connectClient(implementation, {}, { respond: conn => (disconnect(conn), null) });
      await client.closed;
      expect(client.events).toEqual([`error ${error} rs=2`, abnormalClose]);
      expect(await (await client.peer.connection()).remainingFrames()).toEqual([]);
    });

    test("no response within handshakeTimeout", async () => {
      await using client = await connectClient(implementation, { handshakeTimeout: 50 }, { respond: () => null });
      await client.closed;
      expect(client.events).toEqual(['error Error "Opening handshake has timed out" rs=2', abnormalClose]);
    });

    // In node:http it's the socket's inactivity timeout, which stays armed until the response has been read.
    describe("handshakeTimeout after 'unexpected-response'", () => {
      test.concurrent.each([
        { label: "a complete response isn't read", response: forbidden(2), read: false },
        { label: "an empty response isn't read", response: forbidden(0).slice(0, -2), read: false },
        { label: "a truncated response isn't read", response: forbidden(9), read: false },
        { label: "a truncated response is read", response: forbidden(9), read: true },
      ])("still fires when $label", async ({ response, read }) => {
        // On a busy machine the timer can beat the response. Retry with a longer one until the response wins.
        for (let handshakeTimeout = 100; ; handshakeTimeout *= 4) {
          await using client = await connectClient(implementation, { handshakeTimeout }, { respond: () => response });
          client.ws.on("unexpected-response", (req, res) => {
            client.events.push("unexpected-response");
            if (read) res.resume();
          });
          await client.closed;
          if (client.events.length === 2) continue;
          expect(client.events).toEqual([
            "unexpected-response",
            'error Error "Opening handshake has timed out" rs=2',
            abnormalClose,
          ]);
          break;
        }
      });
    });

    test.each([
      { label: "", options: {} },
      ...(builtin ? [{ label: ", through a proxy", options: { proxy: "http://127.0.0.1:9" } }] : []),
    ])("handshakeTimeout still applies when `finishRequest` never calls end()$label", async ({ options }) => {
      await using client = await connectClient(
        implementation,
        { ...options, handshakeTimeout: 50, finishRequest() {} },
        { respond: () => null },
      );
      await client.closed;
      expect(client.events).toEqual(['error Error "Opening handshake has timed out" rs=2', abnormalClose]);
    });

    // The constructor already returned, so throwing here would be uncaught. npm ws throws from the constructor because
    // node:http validates headers there.
    test.skipIf(!builtin)("emits 'error' when connecting fails after `finishRequest` returned", async () => {
      await using client = await connectClient(
        implementation,
        {
          // `proxy` is Bun-only, so the `ws` types don't have it.
          ...{ proxy: "http://127.0.0.1:9" },
          headers: { "X-Bad": "a\r\nb" },
          finishRequest: (request: ClientRequest) => void setImmediate(() => request.end()),
        },
        { respond: () => null },
      );
      await client.closed;
      expect(client.events).toEqual([expect.stringMatching(/^error TypeError .* rs=2$/), abnormalClose]);
    });

    describe("every listener style gets the same error, then 'close' 1006", () => {
      // No Content-Length, so the body ends when the connection closes.
      const respond = (conn: RawSocket) => (conn.write("HTTP/1.1 503 Service Unavailable\r\n\r\n"), conn.end(), null);

      // These sockets only have the listeners under test.
      test("on()", async () => {
        await using peer = await createPeer({ respond });
        using client = connect(peer.url);
        const { ws } = client;
        const seen: string[] = [];
        ws.on("error", (...args) => seen.push(`error ${args.map(show).join(" ")} rs=${ws.readyState}`));
        ws.on("close", (...args) => seen.push(`close ${args.map(show).join(" ")} rs=${ws.readyState}`));
        await nextEvent(ws, "close");
        expect(seen).toEqual(['error Error "Unexpected server response: 503" rs=2', abnormalClose]);
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

  test("a refused connection emits node:net's ECONNREFUSED error", async () => {
    const port = await closedPort();
    using client = connect("ws://127.0.0.1:" + port);
    const events = recordEvents(client.ws);
    const closed = nextEvent(client.ws, "close");
    const [error] = await nextEvent(client.ws, "error");
    expect({ ...error, errno: typeof error.errno }).toEqual({
      errno: "number",
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "127.0.0.1",
      port,
    });
    await closed;
    expect(events).toEqual(['error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED rs=2', abnormalClose]);
  });

  describe("redirects", () => {
    test("followRedirects emits 'redirect', then connects to the new URL", async () => {
      await using target = await createPeer();
      await using client = await connectClient(
        implementation,
        { followRedirects: true },
        { respond: () => redirect(target.url + "/dest") },
      );
      const { ws, events } = client;
      ws.on("redirect", (url, request) => events.push(`redirect ${url} ${show(request)}`));
      await client.opened;
      expect(events).toEqual([`redirect ${target.url}/dest ClientRequest`, ...openEvents]);
      expect(ws.url).toBe(target.url + "/dest");
      expect((await target.connection()).headLines[0]).toBe("GET /dest HTTP/1.1");
      // The client closes the first connection.
      expect(await (await client.peer.connection()).remainingFrames()).toEqual([]);
    });

    test("fails once maxRedirects is exceeded", async () => {
      await using client = await connectClient(
        implementation,
        { followRedirects: true, maxRedirects: 1 },
        { respond: () => redirect("/again") },
      );
      await client.closed;
      expect(client.events).toEqual(['error Error "Maximum redirects exceeded" rs=2', abnormalClose]);
      expect(client.peer.connections.map(conn => conn.headLines[0])).toEqual(["GET / HTTP/1.1", "GET /again HTTP/1.1"]);
    });

    test.each([
      { location: "ws://", message: "Invalid URL: ws://" },
      { location: "bad-scheme://localhost", message: invalidScheme },
    ])("Location: $location emits 'error' instead of throwing", async ({ location, message }) => {
      await using client = await connectClient(
        implementation,
        { followRedirects: true },
        { respond: () => redirect(location) },
      );
      await client.closed;
      expect(client.events).toEqual([`error SyntaxError ${JSON.stringify(message)} rs=2`, abnormalClose]);
    });

    test("follows Location: /dest# because an empty fragment doesn't count as a fragment", async () => {
      await using client = await connectClient(
        implementation,
        { followRedirects: true },
        { respond: conn => (conn.headLines[0] === "GET / HTTP/1.1" ? redirect("/dest#") : response101(conn)) },
      );
      await client.opened;
      expect(client.events).toEqual(openEvents);
      expect(client.ws.url).toBe(client.peer.url + "/dest#");
      expect(client.peer.connections.map(conn => conn.headLines[0])).toEqual(["GET / HTTP/1.1", "GET /dest HTTP/1.1"]);
    });

    // npm ws ignores the empty socket path and connects to localhost:80.
    test.skipIf(!builtin)("Location: ws+unix::/x (no socket path) emits 'error' instead of throwing", async () => {
      await using client = await connectClient(
        implementation,
        { followRedirects: true },
        { respond: () => redirect("ws+unix::/x") },
      );
      await client.closed;
      expect(client.events).toEqual([
        'error SyntaxError "Invalid url for WebSocket ws+unix::/x (missing unix socket path)" rs=2',
        abnormalClose,
      ]);
    });

    const headers = { Authorization: "Basic Zm9vOmJhcg==", Cookie: "foo=bar", Host: "example.test", "X-Other": "1" };
    const allHeaders = { authorization: "Basic Zm9vOmJhcg==", cookie: "foo=bar", host: "example.test", other: "1" };
    const defaultHost = "127.0.0.1:PORT";

    test.each([
      {
        label: "drops Authorization, Cookie and Host when redirected to another host",
        options: { headers },
        expected: { authorization: undefined, cookie: undefined, host: defaultHost, other: "1" },
      },
      {
        label: "drops the `auth` option when redirected to another host",
        options: { auth: "foo:bar" },
        expected: { authorization: undefined, cookie: undefined, host: defaultHost, other: undefined },
      },
      {
        label: "resends every header when redirected to the same host",
        options: { headers },
        sameHost: true,
        expected: allHeaders,
      },
      {
        label: "keeps every header when there's a 'redirect' listener",
        options: { headers },
        listener: true,
        expected: allHeaders,
      },
    ])("$label", async ({ options, sameHost, listener, expected }) => {
      await using target = await createPeer();
      await using client = await connectClient(
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
      }).toEqual(expected);
    });
  });

  describe("interim responses before the 101", () => {
    const CONTINUE = "HTTP/1.1 100 Continue\r\n\r\n";
    // The built-in's limit for a response head: --max-http-header-size (16 KB by default) plus 1 KB.
    const fitting = Math.floor((16384 + 1024) / CONTINUE.length);
    const respond = (count: number) => (conn: RawSocket) =>
      Buffer.alloc(count * CONTINUE.length, CONTINUE) + response101(conn);

    test.each([1, fitting])("skips %i", async count => {
      await using client = await connectClient(implementation, {}, { respond: respond(count) });
      await client.opened;
      expect(client.events).toEqual(openEvents);
    });

    // npm ws skips any number of them. An endless stream of them would block the native client's thread.
    test.skipIf(!builtin)("fails once they exceed the size limit of a response head", async () => {
      await using client = await connectClient(implementation, {}, { respond: respond(fitting + 1) });
      await Promise.race([client.opened, client.closed]);
      expect(client.events).toEqual([
        `error Error "WebSocket connection to 'ws://127.0.0.1:PORT/' failed: Response headers too large" rs=2`,
        abnormalClose,
      ]);
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
        ...openEvents,
        'message Buffer("early") text rs=1',
        "message Buffer(0x0102) binary rs=1",
      ]);
    });

    test("reach a 'message' listener added by the 'open' listener", async () => {
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
      { label: "socket path only", suffix: "", requestLine: "GET / HTTP/1.1" },
    ])("$label", async ({ suffix, requestLine }) => {
      using dir = tempDir("ws", {});
      const socket = path.join(String(dir), "s");
      await using client = await openClient(implementation, { path: suffix }, { path: socket });
      expect(client.ws.url).toBe(`ws+unix:${socket}${suffix}`);
      expect(client.conn.headLines[0]).toBe(requestLine);
      expect(client.conn.header("host")).toBe("localhost");
      expect(client.events).toEqual(openEvents);
    });

    test("a missing socket emits ENOENT", async () => {
      using dir = tempDir("ws", {});
      const socket = path.join(String(dir), "s");
      using client = connect(`ws+unix:${socket}:/x`);
      const events = recordEvents(client.ws);
      const closed = nextEvent(client.ws, "close");
      const [error] = await nextEvent(client.ws, "error");
      expect({ ...error, errno: typeof error.errno }).toEqual({
        errno: "number",
        code: "ENOENT",
        syscall: "connect",
        address: socket,
      });
      await closed;
      expect(events).toEqual([`error Error ${JSON.stringify("connect ENOENT " + socket)} ENOENT rs=2`, abnormalClose]);
    });

    test.skipIf(!builtin)("wss+unix: works the same over TLS", async () => {
      using dir = tempDir("ws", {});
      const socket = path.join(String(dir), "s");
      await using peer = await createPeer({ secure: true, path: socket });
      using client = connect(`wss+unix:${socket}:/x?y=1`, { ca: tls.cert });
      const events = recordEvents(client.ws);
      await nextEvent(client.ws, "open");
      const conn = await peer.connection();
      expect(client.ws.url).toBe(`wss+unix:${socket}:/x?y=1`);
      expect(conn.headLines[0]).toBe("GET /x?y=1 HTTP/1.1");
      expect(conn.header("host")).toBe("localhost");
      client.ws.send("over TLS");
      expect(await conn.next()).toBe('text "over TLS"');
      expect(events).toEqual(openEvents);
    });
  });

  describe("TLS", () => {
    test("rejects a self-signed certificate before sending the request", async () => {
      await using client = await connectClient(implementation, {}, { secure: true });
      await client.closed;
      expect(client.events.map(stripMessage)).toEqual(["error Error DEPTH_ZERO_SELF_SIGNED_CERT rs=2", abnormalClose]);
      // The first request the server receives comes from the second client.
      using secondClient = connect(client.peer.url + "/second", { rejectUnauthorized: false });
      expect((await client.peer.connection()).headLines[0]).toBe("GET /second HTTP/1.1");
    });

    test.each([
      { option: "rejectUnauthorized: false", options: { rejectUnauthorized: false } },
      { option: "ca", options: { ca: tls.cert } },
    ])("$option accepts a self-signed certificate", async ({ options }) => {
      await using client = await openClient(implementation, options, { secure: true });
      expect(client.events).toEqual(openEvents);
      client.ws.send("over TLS");
      expect(await client.conn.next()).toBe('text "over TLS"');
    });

    test("rewrites an https: URL to wss:", async () => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url.replace("wss:", "https:") + "/x", { ca: tls.cert });
      await nextEvent(client.ws, "open");
      expect(client.ws.url).toBe(peer.url + "/x");
    });

    test("ws: to a TLS port fails with a socket hang up", async () => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url.replace("wss:", "ws:"));
      const events = recordEvents(client.ws);
      await nextEvent(client.ws, "close");
      expect(events).toEqual(['error Error "socket hang up" ECONNRESET rs=2', abnormalClose]);
    });
  });
});

// Each test below runs a script in a child process. They are apart from the tests above so that both implementations
// run them as one concurrent group: one script takes 8 seconds, and the other scripts run during that wait. That script
// comes first for both implementations, because an ASAN build runs only 5 tests of a group at a time.
describe.concurrent.each(implementations)("ws client opening handshake in a child process ($name)", ({ specifier }) => {
  describe("failed handshake", () => {
    // The global WebSocket has a built-in handshake timeout, so it serves as the clock. It's created after the `ws`
    // socket, so a timeout on the `ws` socket would have fired first. The clock takes 8 seconds: the timeout of 1 second
    // is padded to 5, and sockets are checked for timeouts every 4 seconds.
    test(
      "without handshakeTimeout the client outlasts the global WebSocket's handshake timeout",
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
          clock.onerror = event => console.log("the global WebSocket failed:", showError(event.error));
          clock.onclose = () => console.log("the global WebSocket gave up, readyState", ws.readyState);
        `;
        const child = runScript({ specifier }, script, { PEER_URL: peer.url, BUN_CONFIG_WS_HANDSHAKE_TIMEOUT: "1" });
        const connections = [await peer.connection(), await peer.connection()];
        const conn = connections.find(connection => connection.headLines[0].startsWith("GET /ws "))!;
        const clock = connections.find(connection => connection !== conn)!;
        await clock.ended;
        conn.write(response101(conn));
        expect(await child).toEqual({
          lines: [
            `the global WebSocket failed: Error "WebSocket connection to 'ws://127.0.0.1:PORT/clock' failed: Timeout"`,
            "the global WebSocket gave up, readyState 0",
            "open",
          ],
          stderr: "",
          exitCode: 0,
        });
      },
      scriptTimeout,
    );
  });
});

// The `handshakeTimeout` of a script that checks for a leaked timer. The response must arrive before it fires, and a
// debug build on a busy machine takes seconds to get one. A leaked timer still fires well within `scriptTimeout`.
const longHandshakeTimeout = scriptTimeout / 3;

describe.concurrent.each(implementations)(
  "ws client opening handshake in a child process ($name)",
  ({ builtin, specifier }) => {
    describe("failed handshake", () => {
      // The throw skips the validation, so the socket never opens. node:http has already dropped the request's timeout:
      // a leaked `handshakeTimeout` timer would fire before the process exits and show up in the output.
      test.each([
        {
          then: "the peer closes the connection",
          onUpgrade: "",
          peerCloses: true,
          lines: ["readyState 0 on exit"],
        },
        {
          then: "terminate() is called",
          onUpgrade: `setImmediate(() => {
            console.log("readyState " + ws.readyState + " before terminate()");
            ws.terminate();
          });`,
          peerCloses: false,
          lines: [
            "readyState 0 before terminate()",
            'error Error "WebSocket was closed before the connection was established"',
            "close 1006",
            "readyState 3 on exit",
          ],
        },
      ])(
        "stays CONNECTING after an 'upgrade' listener throws, until $then",
        async ({ onUpgrade, peerCloses, lines }) => {
          await using peer = await createPeer({ afterUpgrade: encodeFrame(OP.text, "dropped") });
          const script = `
            const ws = new WebSocket(process.env.PEER_URL, { handshakeTimeout: ${longHandshakeTimeout} });
            ws.on("open", () => console.log("open"));
            ws.on("message", data => console.log("message " + data));
            ws.on("error", error => console.log("error " + showError(error)));
            ws.on("close", code => console.log("close " + code));
            ws.on("upgrade", () => {
              ${onUpgrade}
              throw new Error("thrown by the listener");
            });
            process.on("exit", () => console.log("readyState " + ws.readyState + " on exit"));
          `;
          const child = runScript({ specifier }, script, { PEER_URL: peer.url });
          const conn = await peer.connection();
          if (peerCloses) conn.end();
          expect(await conn.remainingFrames()).toEqual([]);
          expect(await child).toEqual({
            lines: ['uncaught Error "thrown by the listener"', ...lines],
            stderr: "",
            exitCode: 0,
          });
          expect(conn.socketEvents).toContain("end");
        },
        scriptTimeout,
      );

      // After a 101, npm ws forwards the socket's own 'error' and 'close' events, so a throw from one doesn't skip the
      // other. That holds on Node. On Bun, node:net doesn't emit 'close' after an 'error' listener throws.
      test.skipIf(!builtin)(
        "emits 'close' after a rejected 101 even if the 'error' listener throws",
        async () => {
          await using peer = await createPeer({ respond: withReplacedHeaders({ "Sec-WebSocket-Accept": "AAAA" }) });
          const script = `
            const ws = new WebSocket(process.env.PEER_URL);
            ws.on("error", error => {
              console.log("error " + showError(error));
              throw new Error("thrown by the listener");
            });
            ws.on("close", code => console.log("close " + code + " readyState " + ws.readyState));
          `;
          expect(await runScript({ specifier }, script, { PEER_URL: peer.url })).toEqual({
            lines: [
              'error Error "Invalid Sec-WebSocket-Accept header"',
              'uncaught Error "thrown by the listener"',
              "close 1006 readyState 3",
            ],
            stderr: "",
            exitCode: 0,
          });
        },
        scriptTimeout,
      );

      // The peer closes the connection, so only a leaked timer could keep the process alive. It would fire before the
      // process exits and show up in the output.
      describe("handshakeTimeout after 'unexpected-response'", () => {
        test.each([
          { label: "the response was read to the end", listener: "response.resume();" },
          { label: "request.abort()", listener: "request.abort();" },
        ])(
          "doesn't fire after $label",
          async ({ listener }) => {
            await using peer = await createPeer({ respond: conn => (conn.socket.end(forbidden(2)), null) });
            const script = `
              const ws = new WebSocket(process.env.PEER_URL, { handshakeTimeout: ${longHandshakeTimeout} });
              ws.on("error", error => console.log("error " + showError(error)));
              ws.on("close", code => console.log("close " + code));
              ws.on("unexpected-response", (request, response) => {
                console.log("unexpected-response");
                ${listener}
              });
              process.on("exit", () => console.log("readyState " + ws.readyState + " on exit"));
            `;
            expect(await runScript({ specifier }, script, { PEER_URL: peer.url })).toEqual({
              lines: ["unexpected-response", "readyState 0 on exit"],
              stderr: "",
              exitCode: 0,
            });
          },
          scriptTimeout,
        );
      });

      // A leaked timer would fire before the process exits and show up in the output. With a proxy the built-in uses
      // its native client even when `finishRequest` is set.
      test.each([
        { label: "", options: "" },
        { label: " with `finishRequest`", options: "finishRequest: request => request.end()," },
        { label: " with `finishRequest` and a proxy", options: 'finishRequest: request => request.end(), proxy: "http://127.0.0.1:9",' }, // prettier-ignore
      ])(
        "clears the `handshakeTimeout` timer when the constructor throws$label",
        async ({ options }) => {
          const script = `
            try {
              new WebSocket("ws://127.0.0.1:9", { ${options} handshakeTimeout: 50, headers: { "X-Bad": "a\\r\\nb" } });
            } catch (error) {
              console.log("threw " + error.name);
            }
          `;
          expect(await runScript({ specifier }, script)).toEqual({
            lines: ["threw TypeError"],
            stderr: "",
            exitCode: 0,
          });
        },
        scriptTimeout,
      );
    });

    describe("redirects", () => {
      // A leaked timer would fire before the process exits and show up in the output.
      test.skipIf(!builtin)(
        "Location: ws+unix::/x (no socket path) clears the `handshakeTimeout` timer",
        async () => {
          await using peer = await createPeer({ respond: () => redirect("ws+unix::/x") });
          const script = `
            const ws = new WebSocket(process.env.PEER_URL, {
              followRedirects: true,
              handshakeTimeout: ${longHandshakeTimeout},
            });
            ws.on("error", error => console.log("error " + error.name));
            ws.on("close", code => console.log("close " + code));
          `;
          expect(await runScript({ specifier }, script, { PEER_URL: peer.url })).toEqual({
            lines: ["error SyntaxError", "close 1006"],
            stderr: "",
            exitCode: 0,
          });
        },
        scriptTimeout,
      );
    });
  },
);
