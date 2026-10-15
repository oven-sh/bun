// Which connections a `ws` WebSocketServer can upgrade, what node:http does around an upgraded socket, and what
// frameworks do with a server socket. The client is a raw TCP socket. See ws-raw-peer.ts.
import fastifyWebsocket from "@fastify/websocket";
import { describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { tls as certificate, isWindows, tempDir } from "harness";
import { once } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { Duplex, duplexPair } from "node:stream";
import { Server as SocketIO } from "socket.io";
import type { WebSocket, WebSocketServer } from "ws";
import {
  closePayload,
  createServer,
  encodeFrame,
  event,
  HttpClient,
  implementations,
  KEY,
  OP,
  openServer,
  RawClient,
  serve,
  show,
  showError,
  upgradeRequest,
  watch,
} from "./ws-raw-peer";

const switching = "HTTP/1.1 101 Switching Protocols";
const get = "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n";
const engineIoPath = "/socket.io/?EIO=4&transport=websocket";

function echo(wss: WebSocketServer) {
  wss.on("connection", ws => ws.on("message", data => ws.send("echo:" + data)));
  return wss;
}

async function expectEcho(client: RawClient) {
  expect((await client.response).status).toBe(switching);
  client.text("hi");
  expect(await client.next()).toBe('text "echo:hi"');
}

// Hides what `ws` and node:http keep on the socket under symbols.
const hideSymbols = (socket: Duplex) =>
  new Proxy(socket, {
    get(target, property, receiver) {
      if (typeof property === "symbol") return undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has: (target, property) => typeof property !== "symbol" && Reflect.has(target, property),
  });

describe.each(implementations)("ws server, transports ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocketServer } = implementation;
  const emitConnection = (wss: WebSocketServer, req: http.IncomingMessage) => (ws: WebSocket) =>
    wss.emit("connection", ws, req);

  test("https.Server: verifyClient() sees `secure: true`", async () => {
    const server = https.createServer(certificate);
    const secure: boolean[] = [];
    echo(new WebSocketServer({ server, verifyClient: info => secure.push(info.secure) > 0 }));
    await using listening = await serve(server);
    await expectEcho(listening.connect({ secure: true }));
    expect(secure).toEqual([true]);
  });

  test.skipIf(isWindows)("http.Server on a unix socket: address() is the path", async () => {
    using dir = tempDir("ws-server-unix", {});
    const socketPath = path.join(String(dir), "ws.sock");
    const server = http.createServer();
    const wss = echo(new WebSocketServer({ server }));
    await using listening = await serve(server, socketPath);
    expect(wss.address() as unknown).toBe(socketPath);
    await expectEcho(listening.connect());
  });

  test("a request listener next to the WebSocketServer still gets the plain requests", async () => {
    const server = http.createServer((req, res) => res.setHeader("X-App", "1").end("plain"));
    echo(new WebSocketServer({ server, path: "/ws" }));
    await using listening = await serve(server);
    const plain = await listening.connect({ raw: "GET /x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" }).response;
    expect(plain).toMatchObject({ status: "HTTP/1.1 200 OK", body: "plain" });
    expect(plain.headers).toContain("X-App: 1");
    await expectEcho(listening.connect({ path: "/ws" }));
  });

  test("50 connections: each gets its own echo, then a broadcast", async () => {
    await using server = await createServer(implementation);
    const { wss } = server;
    echo(wss);
    const clients = Array.from({ length: 50 }, () => server.connect());
    await Promise.all(clients.map(client => client.response));
    clients.forEach((client, i) => client.text("n" + i));
    expect(await Promise.all(clients.map(client => client.next()))).toEqual(clients.map((_, i) => `text "echo:n${i}"`));
    expect(wss.clients.size).toBe(50);

    const callbacks = Promise.all(Array.from(wss.clients, ws => new Promise(resolve => ws.send("all", resolve))));
    expect(await Promise.all(clients.map(client => client.next()))).toEqual(clients.map(() => 'text "all"'));
    expect(await callbacks).toHaveLength(50);
  });

  describe("handleUpgrade() with arguments that a framework wrapped", () => {
    test("the socket in a Proxy that hides symbols", async () => {
      const server = http.createServer();
      const wss = echo(new WebSocketServer({ noServer: true }));
      server.on("upgrade", (req, socket, head) =>
        wss.handleUpgrade(req, hideSymbols(socket), head, emitConnection(wss, req)),
      );
      await using listening = await serve(server);
      await expectEcho(listening.connect());
    });

    describe("the socket behind a Duplex of the framework's own", () => {
      /** An OPEN server socket on a Duplex that passes everything on to the socket of the request, and counts. */
      async function openBehindDuplex() {
        const listening = await serve(http.createServer());
        const wss = new WebSocketServer({ noServer: true });
        const passed = { in: 0, out: 0, ended: false };
        let wrapper!: Duplex;
        listening.server.on("upgrade", (req, socket, head) => {
          wrapper = new Duplex({
            read: () => void socket.resume(),
            write: (chunk, encoding, callback) => ((passed.out += chunk.length), void socket.write(chunk, callback)),
            final: callback => ((passed.ended = true), void socket.end(callback)),
            destroy: (error, callback) => (socket.destroy(), callback(error)),
          });
          socket.on("data", chunk => ((passed.in += chunk.length), wrapper.push(chunk) || socket.pause()));
          socket.on("end", () => wrapper.push(null));
          socket.on("close", () => wrapper.destroy());
          wss.handleUpgrade(req, wrapper, head, emitConnection(wss, req));
        });
        const connection = await listening.open(wss);
        return { ...connection, wrapper, passed, [Symbol.asyncDispose]: () => listening[Symbol.asyncDispose]() };
      }

      test("every byte goes through it, the 101 too, and it is `_socket`", async () => {
        await using server = await openBehindDuplex();
        const { ws, req, client, events, wrapper, passed } = server;
        expect((ws as any)._socket).toBe(wrapper);
        expect(wrapper).not.toBe(req.socket);
        const request = client.socket.bytesWritten;
        expect(passed).toEqual({ in: 0, out: client.head.length + 4, ended: false });

        client.text("up");
        client.ping("p");
        expect(await client.roundTrip()).toEqual(['pong "p"']);
        ws.send("down");
        ws.send(Buffer.alloc(70_000));
        expect(await client.roundTrip()).toEqual(['text "down"', "binary 70000 bytes"]);
        expect(events).toEqual(['message Buffer("up") text rs=1', 'ping Buffer("p") rs=1']);
        expect(passed).toEqual({
          in: client.socket.bytesWritten - request,
          out: client.socket.bytesRead,
          ended: false,
        });
      });

      test("a closing handshake ends it", async () => {
        await using server = await openBehindDuplex();
        const { ws, client, events, wrapper, passed } = server;
        ws.close(1000, "bye");
        expect(await client.next()).toBe('close 1000 "bye"');
        client.close(1000, "bye");
        await server.closed;
        expect(events).toEqual(['close 1000 Buffer("bye") rs=3']);
        expect(await client.next()).toBe("EOF");
        expect({ ended: passed.ended, destroyed: wrapper.destroyed }).toEqual({ ended: true, destroyed: true });
      });

      test("terminate() destroys it", async () => {
        await using server = await openBehindDuplex();
        server.ws.terminate();
        expect(server.wrapper.destroyed).toBe(true);
        await server.closed;
        expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
        expect(await server.client.next()).toBe("EOF");
      });
    });

    test("the socket in a Proxy that hides symbols, refused by verifyClient()", async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ noServer: true, verifyClient: () => false });
      server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, hideSymbols(socket), head, () => {}));
      await using listening = await serve(server);
      const client = listening.connect();
      expect(await client.response).toMatchObject({ status: "HTTP/1.1 401 Unauthorized", body: "Unauthorized" });
      await client.ended;
    });

    test.each([
      { request: "Object.create(req)", wrap: req => Object.create(req) },
      { request: "new Proxy(req, {})", wrap: req => new Proxy(req, {}) },
      { request: "a plain object", wrap: req => ({ method: req.method, url: req.url, headers: { ...req.headers } }) },
      {
        request: "an IncomingMessage of its own",
        wrap: (req, socket) =>
          Object.assign(new http.IncomingMessage(socket as net.Socket), {
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
          }),
      },
    ] as { request: string; wrap(req: http.IncomingMessage, socket: Duplex): http.IncomingMessage }[])(
      "the request is $request",
      async ({ wrap }) => {
        const server = http.createServer();
        const wss = echo(new WebSocketServer({ noServer: true }));
        server.on("upgrade", (req, socket, head) => {
          const wrapped = wrap(req, socket);
          wss.handleUpgrade(wrapped, socket, head, emitConnection(wss, wrapped));
        });
        await using listening = await serve(server);
        await expectEcho(listening.connect());
      },
    );
  });

  describe("a connection that node:http does not serve natively", () => {
    // The WebSocket of the first connection, watched from the start.
    function first(wss: WebSocketServer) {
      const events: string[] = [];
      const upgraded = new Promise<WebSocket>(resolve => wss.on("connection", ws => (watch(ws, events), resolve(ws))));
      return { events, upgraded };
    }

    // `socket` is the server's end of the connection of `client`, `ws` the WebSocket on it. `early` arrives with the
    // request.
    const kinds = [
      {
        kind: "http2.createSecureServer({ allowHTTP1: true })",
        async open(early?: Buffer) {
          const server = http2.createSecureServer({ ...certificate, allowHTTP1: true });
          const { events, upgraded } = first(new WebSocketServer({ server: server as unknown as http.Server }));
          const accepted = once(server, "secureConnection") as Promise<[Duplex]>;
          const listening = await serve(server);
          const client = listening.connect({ secure: true, alpn: ["http/1.1"], afterRequest: early });
          const [[socket], ws, { status }] = await Promise.all([accepted, upgraded, client.response]);
          return { ws, events, socket, client, status, [Symbol.asyncDispose]: listening[Symbol.asyncDispose] };
        },
      },
      {
        kind: 'a net.Server in front that calls server.emit("connection", socket)',
        async open(early?: Buffer) {
          const server = http.createServer();
          const { events, upgraded } = first(new WebSocketServer({ server }));
          const front = net.createServer(socket => void server.emit("connection", socket));
          const accepted = once(front, "connection") as Promise<[Duplex]>;
          const listening = await serve(front);
          const client = listening.connect({ afterRequest: early });
          const [[socket], ws, { status }] = await Promise.all([accepted, upgraded, client.response]);
          return { ws, events, socket, client, status, [Symbol.asyncDispose]: listening[Symbol.asyncDispose] };
        },
      },
      {
        kind: "any Duplex",
        async open(early = Buffer.alloc(0)) {
          const wss = new WebSocketServer({ noServer: true });
          const { events, upgraded } = first(wss);
          const [near, socket] = duplexPair();
          const client = new HttpClient(near);
          const headers = {
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-key": KEY,
            "sec-websocket-version": "13",
          };
          const request = { method: "GET", url: "/", headers } as http.IncomingMessage;
          wss.handleUpgrade(request, socket, early, emitConnection(wss, request));
          const [ws, [status]] = await Promise.all([upgraded, client.answer()]);
          const dispose = async () => void (near.destroy(), socket.destroy());
          return { ws, events, socket, client, status, [Symbol.asyncDispose]: dispose };
        },
      },
    ];

    describe.each(kinds)("$kind", ({ open }) => {
      test("the socket is `_socket`, and messages, Ping and Pong go both ways", async () => {
        await using opened = await open();
        const { ws, events, socket, client, status } = opened;
        expect(status).toBe(switching);
        expect(ws.readyState).toBe(ws.OPEN);
        expect((ws as any)._socket).toBe(socket);

        ws.send("down");
        ws.send(Buffer.from([1, 2]));
        ws.ping("from the server");
        expect(await client.take(3)).toEqual(['text "down"', "binary 0x0102", 'ping "from the server"']);
        client.pong("from the server");
        client.text("up");
        client.binary(Buffer.from([3, 4]));
        client.ping("from the client");
        expect(await client.next()).toBe('pong "from the client"');
        expect(events).toEqual([
          'pong Buffer("from the server") rs=1',
          'message Buffer("up") text rs=1',
          "message Buffer(0x0304) binary rs=1",
          'ping Buffer("from the client") rs=1',
        ]);
      });

      test("a message and a half in the packet of the request", async () => {
        const half = encodeFrame(OP.text, "in two halves", { mask: true });
        await using opened = await open(
          Buffer.concat([encodeFrame(OP.text, "early", { mask: true }), half.subarray(0, 9)]),
        );
        const { events, client } = opened;
        client.write(half.subarray(9));
        expect(await client.roundTrip()).toEqual([]);
        expect(events).toEqual(['message Buffer("early") text rs=1', 'message Buffer("in two halves") text rs=1']);
      });

      test("close(): the Close frame, the client's, then FIN and 'close'", async () => {
        await using opened = await open();
        const { ws, events, socket, client } = opened;
        ws.close(4000, "bye");
        expect(await client.next()).toBe('close 4000 "bye"');
        expect(ws.readyState).toBe(ws.CLOSING);
        client.close(4000, "bye");
        client.end();
        await event(ws, "close");
        expect(events).toEqual(['close 4000 Buffer("bye") rs=3']);
        expect(await client.next()).toBe("EOF");
        expect(socket.destroyed).toBe(true);
      });

      test("a Close frame from the client is echoed, then FIN and 'close'", async () => {
        await using opened = await open();
        const { ws, events, socket, client } = opened;
        client.close(1000, "done");
        client.end();
        await event(ws, "close");
        expect(events).toEqual(['close 1000 Buffer("done") rs=3']);
        expect(await client.rest()).toEqual(['close 1000 "done"']);
        expect(socket.destroyed).toBe(true);
      });

      test("terminate() destroys the socket", async () => {
        await using opened = await open();
        const { ws, events, socket, client } = opened;
        ws.terminate();
        expect(socket.destroyed).toBe(true);
        await event(ws, "close");
        expect(events).toEqual(["close 1006 Buffer() rs=3"]);
        expect(await client.rest()).toEqual([]);
      });
    });
  });

  describe("more than one request on the connection", () => {
    const app = () => http.createServer((req, res) => res.end("ok"));

    test("a request, then the handshake", async () => {
      const server = app();
      echo(new WebSocketServer({ server }));
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(get);
      expect(await client.answer()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      client.write(upgradeRequest());
      expect(await client.answer()).toEqual([switching, ""]);
      client.text("x");
      expect(await client.next()).toBe('text "echo:x"');
    });

    test("a request and the handshake in one packet", async () => {
      const server = app();
      echo(new WebSocketServer({ server }));
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(get + upgradeRequest());
      expect(await client.answer()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      expect(await client.answer()).toEqual([switching, ""]);
      client.text("x");
      expect(await client.next()).toBe('text "echo:x"');
    });

    test("a request and a handshake that is refused in one packet", async () => {
      const server = app();
      new WebSocketServer({ server });
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(get + upgradeRequest({ headers: { "Sec-WebSocket-Key": null } }));
      expect(await client.answer()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      expect(await client.answer()).toEqual([
        "HTTP/1.1 400 Bad Request",
        "Missing or invalid Sec-WebSocket-Key header",
      ]);
      expect(await client.answer()).toBe("EOF");
    });
  });

  describe("frames that arrive before handleUpgrade() runs", () => {
    type Early = {
      bytes: Buffer;
      /** Written after the 'upgrade' event, not in the packet of the request. */
      late?: boolean;
      /** handleUpgrade() runs only when the server has had the time to read `bytes`. */
      defer?: boolean;
      /** Written after the 101. */
      tail?: Buffer;
      events: string[];
      sent?: string[];
    };
    const frame = (opcode: number, payload: string | Buffer) => encodeFrame(opcode, payload, { mask: true });
    const split = frame(OP.text, "split-frame");
    const earlyAndLater = ['message Buffer("early") text rs=1', 'message Buffer("later") text rs=1'];

    const early =
      ({ bytes, late = false, defer = false, tail, events: expected, sent = [] }: Early) =>
      async () => {
        const server = http.createServer((req, res) => res.end());
        const wss = new WebSocketServer({ noServer: true });
        const upgrade = Promise.withResolvers<Buffer>();
        const go = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        const events: string[] = [];
        server.on("upgrade", async (req, socket, head) => {
          upgrade.resolve(head);
          if (defer) await go.promise;
          wss.handleUpgrade(req, socket, head, ws => {
            watch(ws, events);
            ws.on("close", () => closed.resolve());
          });
        });
        await using listening = await serve(server);

        const client = listening.connect(late ? {} : { afterRequest: bytes });
        expect((await upgrade.promise).length > 0).toBe(!late);
        if (late) client.write(bytes);
        if (defer) {
          // Once a later connection has its answer, the server has seen what the first one sent before.
          await listening.connect({ raw: get }).response;
          go.resolve();
        }
        expect((await client.response).status).toBe(switching);

        if (bytes[0] === (0x80 | OP.close)) {
          expect(await client.rest()).toEqual(sent);
          await closed.promise;
        } else {
          if (tail) client.write(tail);
          client.text("later");
          expect(await client.roundTrip()).toEqual(sent);
        }
        expect(events).toEqual(expected);
      };

    test("a message in the packet of the request", early({ bytes: frame(OP.text, "early"), events: earlyAndLater }));
    test(
      "half a message in the packet of the request",
      early({
        bytes: split.subarray(0, 9),
        tail: split.subarray(9),
        events: ['message Buffer("split-frame") text rs=1', 'message Buffer("later") text rs=1'],
      }),
    );
    test(
      "a Ping in the packet of the request",
      early({
        bytes: frame(OP.ping, "p"),
        events: ['ping Buffer("p") rs=1', 'message Buffer("later") text rs=1'],
        sent: ['pong "p"'],
      }),
    );
    test(
      "a Close frame in the packet of the request",
      early({ bytes: frame(OP.close, closePayload(1000)), events: ["close 1000 Buffer() rs=3"], sent: ["close 1000"] }),
    );
    test(
      "a message in the packet of the request, handleUpgrade() in a later task",
      early({ bytes: frame(OP.text, "early"), defer: true, events: earlyAndLater }),
    );
    test(
      "a message after the request, handleUpgrade() in a later task",
      early({ bytes: frame(OP.text, "early"), late: true, defer: true, events: earlyAndLater }),
    );
  });

  describe("http.Server#close()", () => {
    test("drops an idle connection: a handshake on it gets no answer", async () => {
      const server = http.createServer((req, res) => res.end("ok"));
      new WebSocketServer({ server });
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(get);
      expect(await client.answer()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      server.close();
      client.write(upgradeRequest());
      expect(await client.answer()).toBe("EOF");
    });

    // close() leaves a connection with a request in flight open, and it can still upgrade.
    async function closeAroundRequest(server: http.Server, listening: Awaited<ReturnType<typeof serve>>) {
      const held = once(server, "request") as Promise<[http.IncomingMessage, http.ServerResponse]>;
      const client = listening.connectHttp();
      client.write(get);
      const [, res] = await held;
      let isClosed = false;
      const closed = new Promise<void>(resolve => server.close(() => ((isClosed = true), resolve())));
      res.end("drained");
      expect(await client.answer()).toEqual(["HTTP/1.1 200 OK", "drained"]);
      return { client, closed, isClosed: () => isClosed };
    }

    const upgradesAfterClose = (attach: (server: http.Server, wss: WebSocketServer) => void) => async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ noServer: true });
      attach(server, wss);
      await using listening = await serve(server);
      const { client, closed, isClosed } = await closeAroundRequest(server, listening);

      const connection = once(wss, "connection");
      client.write(upgradeRequest());
      expect(await client.answer()).toEqual([switching, ""]);
      const [ws] = (await connection) as [WebSocket];
      const events = watch(ws);

      // The callback of close() waits for the WebSocket.
      expect(await client.roundTrip()).toEqual([]);
      expect({ clients: wss.clients.size, isClosed: isClosed() }).toEqual({ clients: 1, isClosed: false });
      client.close(1000);
      await Promise.all([closed, event(ws, "close")]);
      expect(events).toEqual(["close 1000 Buffer() rs=3"]);
    };

    test(
      "a connection it left open upgrades in the 'upgrade' event",
      upgradesAfterClose((server, wss) =>
        server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, emitConnection(wss, req))),
      ),
    );
    test(
      "a connection it left open upgrades in a later task",
      upgradesAfterClose((server, wss) =>
        server.on("upgrade", (req, socket, head) =>
          setImmediate(() => wss.handleUpgrade(req, socket, head, emitConnection(wss, req))),
        ),
      ),
    );
    // On Bun the socket of a 'request' event does not carry the frames of the real package.
    test.skipIf(!builtin)(
      "a connection it left open upgrades in a 'request' listener",
      upgradesAfterClose((server, wss) =>
        server.on("request", req => {
          if (req.headers.upgrade) wss.handleUpgrade(req, req.socket, Buffer.alloc(0), emitConnection(wss, req));
        }),
      ),
    );

    test("a connection it left open upgrades after the server listens again", async () => {
      const server = http.createServer();
      const wss = echo(new WebSocketServer({ server }));
      await using listening = await serve(server);
      const { client: old } = await closeAroundRequest(server, listening);
      await once(server.listen(0, "127.0.0.1"), "listening");
      const fresh = listening.connectHttp();
      for (const client of [old, fresh]) {
        client.write(upgradeRequest());
        expect(await client.answer()).toEqual([switching, ""]);
        client.text("x");
        expect(await client.next()).toBe('text "echo:x"');
      }
      expect(wss.clients.size).toBe(2);
    });

    test("completes once the client of a WebSocket is gone", async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ server });
      const connection = once(wss, "connection");
      await using listening = await serve(server);
      const client = listening.connect();
      const [ws] = (await connection) as [WebSocket];
      const events = watch(ws);
      client.destroy();
      await event(ws, "close");
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      await new Promise(resolve => server.close(resolve));
    });
  });

  test("http.Server#getConnections() counts a WebSocket", async () => {
    const server = http.createServer();
    new WebSocketServer({ server });
    await using listening = await serve(server);
    await listening.connect().response;
    expect(await new Promise(resolve => server.getConnections((error, count) => resolve(count)))).toBe(1);
  });

  test("the timeouts of http.Server do not reach an upgraded socket", async () => {
    // Plain requests are never answered.
    const server = http.createServer(() => {});
    server.setTimeout(100);
    server.keepAliveTimeout = 25;
    server.headersTimeout = 50;
    server.requestTimeout = 75;
    let upgraded: Duplex | undefined;
    const timeouts: string[] = [];
    server.on("timeout", socket => {
      timeouts.push(socket === upgraded ? "the WebSocket" : "the request");
      socket.destroy();
    });
    const wss = new WebSocketServer({ server });
    const connection = once(wss, "connection");
    await using listening = await serve(server);
    const client = listening.connect();
    const [, req] = (await connection) as [WebSocket, http.IncomingMessage];
    upgraded = req.socket;
    expect(req.socket.timeout).toBe(0);

    // This request came later. When its time is up, so would be the WebSocket's.
    expect((await listening.connect({ raw: get }).response).status).toBe("no response");
    expect(timeouts).toEqual(["the request"]);
    expect(await client.roundTrip()).toEqual([]);
  });

  test("the upgrade request: complete, not aborted, not destroyed, with its headers", async () => {
    await using server = await openServer(
      implementation,
      {},
      { headers: { Cookie: "a=b", "X-Forwarded-For": "1.2.3.4" } },
    );
    const { req } = server;
    expect({
      complete: req.complete,
      aborted: req.aborted,
      destroyed: req.destroyed,
      httpVersion: req.httpVersion,
      cookie: req.headers.cookie,
      forwarded: req.headers["x-forwarded-for"],
      rawHeaders: req.rawHeaders.slice(-4),
    }).toEqual({
      complete: true,
      aborted: false,
      destroyed: false,
      httpVersion: "1.1",
      cookie: "a=b",
      forwarded: "1.2.3.4",
      rawHeaders: ["Cookie", "a=b", "X-Forwarded-For", "1.2.3.4"],
    });
  });

  test("req.socket after a closing handshake: the 'close' of the WebSocket, then its own", async () => {
    await using server = await openServer(implementation);
    const { ws, req, client } = server;
    const order: string[] = [];
    req.socket.on("end", () => order.push("socket 'end'"));
    req.socket.on("close", () => order.push("socket 'close'"));
    req.on("close", () => order.push("req 'close'"));
    ws.on("close", () => order.push("ws 'close'"));
    client.close(1000);
    await event(req.socket, "close");
    // The built-in reads the connection natively: this socket sees no 'end'.
    expect(order).toEqual([...(builtin ? [] : ["socket 'end'"]), "ws 'close'", "socket 'close'"]);
    expect(req.socket.destroyed).toBe(true);
  });

  // engine.io ends every upgraded socket on its http.Server to which, by this measure, nobody has written.
  // The real package writes through the raw socket of node:http, so there the count says nothing about `ws`.
  // Only the 101 is counted. The frames behind it are not.
  test.skipIf(!builtin)("req.socket.bytesWritten is not 0 after the upgrade", async () => {
    await using server = await openServer(implementation);
    const { ws, req, client } = server;
    ws.send("hmr connected");
    expect(await client.next()).toBe('text "hmr connected"');
    expect({ writable: req.socket.writable, written: req.socket.bytesWritten > 0 }).toEqual({
      writable: true,
      written: true,
    });
  });

  test("the heartbeat of the README: ping(), 'pong' with the socket as `this`, terminate()", async () => {
    await using server = await openServer(implementation);
    const { wss, ws, client, events } = server;
    const alive = new Map<unknown, boolean>([[ws, true]]);
    ws.on("pong", function (this: WebSocket) {
      alive.set(this, true);
    });
    const beat = () =>
      wss.clients.forEach(ws => {
        if (!alive.get(ws)) return ws.terminate();
        alive.set(ws, false);
        ws.ping();
      });

    beat();
    expect(await client.next()).toBe("ping");
    client.pong();
    await event(ws, "pong");
    expect([...alive]).toEqual([[ws, true]]);

    beat();
    expect(await client.next()).toBe("ping");
    // No Pong this time.
    beat();
    expect(await client.next()).toBe("EOF");
    await server.closed;
    expect(events).toEqual(["pong Buffer() rs=1", "close 1006 Buffer() rs=3"]);
    expect(wss.clients.size).toBe(0);
  });

  test("as y-websocket does: binaryType 'arraybuffer', send(Uint8Array, {}, callback)", async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, emitConnection(wss, req)));
    const log: string[] = [];
    const sent = Promise.withResolvers<void>();
    wss.on("connection", ws => {
      ws.binaryType = "arraybuffer";
      ws.on("message", message => {
        log.push(`message ${show(message)}`);
        ws.send(new Uint8Array([0, 1, 2]), {}, error => {
          log.push(`callback ${show(error)}`);
          sent.resolve();
        });
      });
    });
    await using listening = await serve(server);
    const client = listening.connect({ path: "/room" });
    await client.response;
    client.binary(Buffer.from([7, 8]));
    expect(await client.next()).toBe("binary 0x000102");
    await sent.promise;
    expect(log).toEqual(["message ArrayBuffer(0x0708)", "callback null"]);
  });

  test("as graphql-ws does: handleProtocols() that returns false, close(44xx, reason)", async () => {
    await using server = await createServer(implementation, {
      handleProtocols: protocols => (protocols.has("graphql-transport-ws") ? "graphql-transport-ws" : false),
    });
    const log: string[] = [];
    const closed = Promise.withResolvers<void>();
    server.wss.on("connection", ws => {
      log.push(`protocol ${show(ws.protocol)}`);
      if (ws.protocol !== "graphql-transport-ws") return ws.close(4406, "Subprotocol not acceptable");
      ws.once("close", (code, reason) => {
        log.push(`closed ${code} ${reason}`);
        closed.resolve();
      });
      ws.on("message", data => {
        log.push(`message ${data}`);
        ws.close(4400, "Invalid message received");
      });
    });

    const accepted = server.connect({ headers: { "Sec-WebSocket-Protocol": "graphql-transport-ws" } });
    expect((await accepted.response).headers.slice(3)).toEqual(["Sec-WebSocket-Protocol: graphql-transport-ws"]);
    accepted.text("junk");
    expect(await accepted.next()).toBe('close 4400 "Invalid message received"');
    accepted.close(4400, "Invalid message received");
    await closed.promise;

    const other = server.connect({ headers: { "Sec-WebSocket-Protocol": "other" } });
    expect((await other.response).headers.slice(3)).toEqual([]);
    expect(await other.next()).toBe('close 4406 "Subprotocol not acceptable"');
    expect(log).toEqual([
      'protocol "graphql-transport-ws"',
      "message junk",
      "closed 4400 Invalid message received",
      'protocol ""',
    ]);
  });
});

test("http.Server#close() waits for a raw upgraded socket whose client is gone, closeAllConnections() skips it", async () => {
  const server = http.createServer();
  const upgrade = once(server, "upgrade") as Promise<[http.IncomingMessage, Duplex]>;
  await using listening = await serve(server);
  const client = listening.connect({ headers: { Upgrade: "test" } });
  const [, socket] = await upgrade;
  socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
  await client.response;

  // The server's half stays open: nothing here ends it.
  client.destroy();
  socket.resume();
  await once(socket, "end");
  server.closeAllConnections();
  let isClosed = false;
  const closed = new Promise<void>(resolve => server.close(() => ((isClosed = true), resolve())));
  expect(await new Promise(resolve => server.getConnections((error, count) => resolve(count)))).toBe(1);
  expect({ destroyed: socket.destroyed, isClosed }).toEqual({ destroyed: false, isClosed: false });
  socket.destroy();
  await closed;
});

// These load "ws" themselves, which on Bun is the built-in.
describe("packages on top of the ws server (built-in)", () => {
  const { WebSocketServer } = implementations[0].ws;

  test("engine.io leaves the WebSocket of another server on its http.Server alone", async () => {
    const server = http.createServer();
    const io = new SocketIO(server, { destroyUpgradeTimeout: 20 });
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      if (req.url === "/hmr") wss.handleUpgrade(req, socket, head, ws => ws.send("hmr connected"));
    });
    await using listening = await serve(server);
    try {
      const client = listening.connect({ path: "/hmr", headers: { "Sec-WebSocket-Protocol": "vite-hmr" } });
      expect((await client.response).status).toBe(switching);
      expect(await client.next()).toBe('text "hmr connected"');

      // Nobody takes this one, so engine.io ends it after `destroyUpgradeTimeout`. The timer of the first ran before.
      expect((await listening.connect({ path: "/nobody" }).response).status).toBe("no response");
      expect(await client.roundTrip()).toEqual([]);
    } finally {
      io.close();
    }
  });

  test("engine.io's 'headers' event adds to the 101", async () => {
    const server = http.createServer();
    const io = new SocketIO(server);
    io.engine.on("headers", headers => (headers["X-Custom"] = "yes"));
    await using listening = await serve(server);
    try {
      const client = listening.connect({ path: engineIoPath });
      const { status, headers } = await client.response;
      expect(status).toBe(switching);
      expect(headers).toContain("X-Custom: yes");
      expect((await client.nextFrame())!.payload.toString()).toStartWith('0{"sid":"');
    } finally {
      io.close();
    }
  });

  test("socket.io's maxHttpBufferSize: a larger packet gets Close 1009 and 'transport error'", async () => {
    const server = http.createServer();
    const io = new SocketIO(server, { maxHttpBufferSize: 1000 });
    const received: number[] = [];
    const disconnected = new Promise(resolve =>
      io.on("connection", socket => {
        socket.on("big", data => received.push(data.length));
        socket.on("disconnect", resolve);
      }),
    );
    await using listening = await serve(server);
    try {
      const client = listening.connect({ path: engineIoPath });
      await client.response;
      expect((await client.nextFrame())!.payload.toString()).toStartWith('0{"sid":"');
      client.text("40");
      expect((await client.nextFrame())!.payload.toString()).toStartWith('40{"sid":"');
      client.text(`42["big","${Buffer.alloc(5000, "x")}"]`);
      expect(await client.rest()).toEqual(["close 1009"]);
      expect(await disconnected).toBe("transport error");
      expect(received).toEqual([]);
    } finally {
      io.close();
    }
  });

  async function fastifyApp() {
    const fastify = Fastify();
    await fastify.register(fastifyWebsocket);
    fastify.get("/ws", { websocket: true }, socket => {
      socket.on("message", message => socket.send("echo:" + message));
    });
    return { fastify, [Symbol.asyncDispose]: () => fastify.close() };
  }

  test("@fastify/websocket: a websocket route, and 404 for a handshake on no route", async () => {
    await using app = await fastifyApp();
    const { fastify } = app;
    await fastify.listen({ port: 0, host: "127.0.0.1" });
    const { port } = fastify.server.address() as net.AddressInfo;
    const client = new RawClient(port, { path: "/ws" });
    const lost = new RawClient(port, { path: "/nope" });
    try {
      await expectEcho(client);
      expect((await lost.response).status).toBe("HTTP/1.1 404 Not Found");
    } finally {
      client.destroy();
      lost.destroy();
    }
  });

  // It upgrades over a Duplex and makes its client with `new WebSocket(null)` and setSocket().
  test("@fastify/websocket: injectWS()", async () => {
    await using app = await fastifyApp();
    const { fastify } = app;
    await fastify.ready();
    const ws = await fastify.injectWS("/ws");
    try {
      const events = watch(ws);
      expect(ws.readyState).toBe(ws.OPEN);
      ws.send("hi");
      await event(ws, "message");
      ws.ping("p");
      await event(ws, "pong");
      ws.terminate();
      await event(ws, "close");
      expect(events).toEqual([
        'message Buffer("echo:hi") text rs=1',
        'pong Buffer("p") rs=1',
        "close 1006 Buffer() rs=3",
      ]);
    } finally {
      ws.terminate();
    }
  });

  test("@fastify/websocket: injectWS() of no route rejects with the status", async () => {
    await using app = await fastifyApp();
    const { fastify } = app;
    await fastify.ready();
    expect(await fastify.injectWS("/nope").catch(showError)).toBe('Error "Unexpected server response: 404"');
  });
});
