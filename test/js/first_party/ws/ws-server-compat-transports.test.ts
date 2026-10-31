// Tests which kinds of connection a `ws` WebSocketServer can upgrade, how node:http treats upgraded sockets, and how
// frameworks use server sockets. The client is a raw TCP socket. See ws-raw-peer.ts.
import fastifyWebsocket from "@fastify/websocket";
import { describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { tls as certificate, tempDir } from "harness";
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
  HttpClient,
  implementations,
  KEY,
  nextEvent,
  OP,
  openServer,
  RawClient,
  recordEvents,
  runScript,
  scriptTimeout,
  serve,
  show,
  showError,
  upgradeRequest,
} from "./ws-raw-peer";

const switchingProtocols = "HTTP/1.1 101 Switching Protocols";
const getRequest = "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n";
const engineIoPath = "/socket.io/?EIO=4&transport=websocket";

function echo(wss: WebSocketServer) {
  wss.on("connection", ws => ws.on("message", data => ws.send("echo:" + data)));
  return wss;
}

async function expectEcho(client: RawClient) {
  expect((await client.response).status).toBe(switchingProtocols);
  client.text("hi");
  expect(await client.next()).toBe('text "echo:hi"');
}

// Hides the symbol-keyed properties that `ws` and node:http store on the socket.
const hideSymbols = (socket: Duplex) =>
  new Proxy(socket, {
    get(target, property, receiver) {
      if (typeof property === "symbol") return undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has: (target, property) => typeof property !== "symbol" && Reflect.has(target, property),
  });

describe.each(implementations)("ws server transports ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocketServer } = implementation;
  const emitConnection = (wss: WebSocketServer, req: http.IncomingMessage) => (ws: WebSocket) =>
    wss.emit("connection", ws, req);

  test("https.Server: verifyClient() receives `secure: true`", async () => {
    const server = https.createServer(certificate);
    const secure: boolean[] = [];
    echo(new WebSocketServer({ server, verifyClient: info => secure.push(info.secure) > 0 }));
    await using listening = await serve(server);
    await expectEcho(listening.connect({ secure: true }));
    expect(secure).toEqual([true]);
  });

  test("http.Server on a unix socket: address() returns the path", async () => {
    using dir = tempDir("ws-server-unix", {});
    const socketPath = path.join(String(dir), "ws.sock");
    const server = http.createServer();
    const wss = echo(new WebSocketServer({ server }));
    await using listening = await serve(server, socketPath);
    expect(wss.address() as unknown).toBe(socketPath);
    await expectEcho(listening.connect());
  });

  test("the http.Server's request listener still handles non-upgrade requests", async () => {
    const server = http.createServer((req, res) => res.setHeader("X-App", "1").end("plain"));
    echo(new WebSocketServer({ server, path: "/ws" }));
    await using listening = await serve(server);
    const plain = await listening.connect({ raw: "GET /x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" }).response;
    expect(plain).toMatchObject({ status: "HTTP/1.1 200 OK", body: "plain" });
    expect(plain.headers).toContain("X-App: 1");
    await expectEcho(listening.connect({ path: "/ws" }));
  });

  describe("handleUpgrade() with framework-wrapped arguments", () => {
    test("accepts a socket wrapped in a Proxy that hides symbols", async () => {
      const server = http.createServer();
      const wss = echo(new WebSocketServer({ noServer: true }));
      server.on("upgrade", (req, socket, head) =>
        wss.handleUpgrade(req, hideSymbols(socket), head, emitConnection(wss, req)),
      );
      await using listening = await serve(server);
      await expectEcho(listening.connect());
    });

    describe("with the socket wrapped in a custom Duplex", () => {
      /** Opens a server socket on a Duplex that forwards everything to the request's socket and counts the bytes. */
      async function openOnWrapper() {
        const listening = await serve(http.createServer());
        const wss = new WebSocketServer({ noServer: true });
        const forwarded = { in: 0, out: 0, ended: false };
        let wrapper!: Duplex;
        listening.server.on("upgrade", (req, socket, head) => {
          wrapper = new Duplex({
            read: () => void socket.resume(),
            write: (chunk, encoding, callback) => ((forwarded.out += chunk.length), void socket.write(chunk, callback)),
            final: callback => ((forwarded.ended = true), void socket.end(callback)),
            destroy: (error, callback) => (socket.destroy(), callback(error)),
          });
          socket.on("data", chunk => ((forwarded.in += chunk.length), wrapper.push(chunk) || socket.pause()));
          socket.on("end", () => wrapper.push(null));
          socket.on("close", () => wrapper.destroy());
          wss.handleUpgrade(req, wrapper, head, emitConnection(wss, req));
        });
        const connection = await listening.open(wss);
        return { ...connection, wrapper, forwarded, [Symbol.asyncDispose]: () => listening[Symbol.asyncDispose]() };
      }

      test("every byte, including the 101, goes through the wrapper, and `_socket` is the wrapper", async () => {
        await using server = await openOnWrapper();
        const { ws, req, client, events, wrapper, forwarded } = server;
        expect((ws as any)._socket).toBe(wrapper);
        expect(wrapper).not.toBe(req.socket);
        const requestBytes = client.socket.bytesWritten;
        expect(forwarded).toEqual({ in: 0, out: client.head.length + 4, ended: false });

        client.text("up");
        client.ping("p");
        expect(await client.roundTrip()).toEqual(['pong "p"']);
        ws.send("down");
        ws.send(Buffer.alloc(70_000));
        expect(await client.roundTrip()).toEqual(['text "down"', "binary 70000 bytes"]);
        expect(events).toEqual(['message Buffer("up") text rs=1', 'ping Buffer("p") rs=1']);
        expect(forwarded).toEqual({
          in: client.socket.bytesWritten - requestBytes,
          out: client.socket.bytesRead,
          ended: false,
        });
      });

      test("the closing handshake ends the wrapper", async () => {
        await using server = await openOnWrapper();
        const { ws, client, events, wrapper, forwarded } = server;
        ws.close(1000, "bye");
        expect(await client.next()).toBe('close 1000 "bye"');
        client.close(1000, "bye");
        await server.closed;
        expect(events).toEqual(['close 1000 Buffer("bye") rs=3']);
        expect(await client.next()).toBe("EOF");
        expect({ ended: forwarded.ended, destroyed: wrapper.destroyed }).toEqual({ ended: true, destroyed: true });
      });

      test("terminate() destroys the wrapper", async () => {
        await using server = await openOnWrapper();
        server.ws.terminate();
        expect(server.wrapper.destroyed).toBe(true);
        await server.closed;
        expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
        expect(await server.client.next()).toBe("EOF");
      });
    });

    test("sends the 401 when verifyClient() rejects a socket wrapped in a Proxy that hides symbols", async () => {
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
        request: "a new IncomingMessage",
        wrap: (req, socket) =>
          Object.assign(new http.IncomingMessage(socket as net.Socket), {
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
          }),
      },
    ] as { request: string; wrap(req: http.IncomingMessage, socket: Duplex): http.IncomingMessage }[])(
      "accepts $request as the request",
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

  describe("connections that node:http doesn't handle natively", () => {
    // `upgraded` resolves with the first connection's WebSocket. `events` records its events from the start.
    function firstConnection(wss: WebSocketServer) {
      const events: string[] = [];
      const upgraded = new Promise<WebSocket>(resolve =>
        wss.on("connection", ws => (recordEvents(ws, events), resolve(ws))),
      );
      return { events, upgraded };
    }

    // `socket` is the server end of `client`'s connection and `ws` is the WebSocket on it. `early` is sent in the same
    // packet as the request.
    const kinds = [
      {
        kind: "http2.createSecureServer({ allowHTTP1: true })",
        async open(early?: Buffer) {
          const server = http2.createSecureServer({ ...certificate, allowHTTP1: true });
          const { events, upgraded } = firstConnection(
            new WebSocketServer({ server: server as unknown as http.Server }),
          );
          const accepted = once(server, "secureConnection") as Promise<[Duplex]>;
          const listening = await serve(server);
          const client = listening.connect({ secure: true, alpn: ["http/1.1"], trailingBytes: early });
          const [[socket], ws, { status }] = await Promise.all([accepted, upgraded, client.response]);
          return { ws, events, socket, client, status, [Symbol.asyncDispose]: listening[Symbol.asyncDispose] };
        },
      },
      {
        kind: 'a net.Server that forwards sockets with server.emit("connection", socket)',
        async open(early?: Buffer) {
          const server = http.createServer();
          const { events, upgraded } = firstConnection(new WebSocketServer({ server }));
          const front = net.createServer(socket => void server.emit("connection", socket));
          const accepted = once(front, "connection") as Promise<[Duplex]>;
          const listening = await serve(front);
          const client = listening.connect({ trailingBytes: early });
          const [[socket], ws, { status }] = await Promise.all([accepted, upgraded, client.response]);
          return { ws, events, socket, client, status, [Symbol.asyncDispose]: listening[Symbol.asyncDispose] };
        },
      },
      {
        kind: "a plain Duplex",
        async open(early = Buffer.alloc(0)) {
          const wss = new WebSocketServer({ noServer: true });
          const { events, upgraded } = firstConnection(wss);
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
          const [ws, [status]] = await Promise.all([upgraded, client.nextResponse()]);
          const dispose = async () => void (near.destroy(), socket.destroy());
          return { ws, events, socket, client, status, [Symbol.asyncDispose]: dispose };
        },
      },
    ];

    describe.each(kinds)("$kind", ({ open }) => {
      test("`_socket` is the socket, and messages, pings and pongs work in both directions", async () => {
        await using opened = await open();
        const { ws, events, socket, client, status } = opened;
        expect(status).toBe(switchingProtocols);
        expect(ws.readyState).toBe(ws.OPEN);
        expect((ws as any)._socket).toBe(socket);

        ws.send("down");
        ws.send(Buffer.from([1, 2]));
        ws.ping("from the server");
        expect(await client.nextFrames(3)).toEqual(['text "down"', "binary 0x0102", 'ping "from the server"']);
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

      test("handles one and a half messages sent in the same packet as the request", async () => {
        const split = encodeFrame(OP.text, "in two halves", { mask: true });
        await using opened = await open(
          Buffer.concat([encodeFrame(OP.text, "early", { mask: true }), split.subarray(0, 9)]),
        );
        const { events, client } = opened;
        client.write(split.subarray(9));
        expect(await client.roundTrip()).toEqual([]);
        expect(events).toEqual(['message Buffer("early") text rs=1', 'message Buffer("in two halves") text rs=1']);
      });

      test("close() sends a Close frame, waits for the client's, then sends FIN and emits 'close'", async () => {
        await using opened = await open();
        const { ws, events, socket, client } = opened;
        ws.close(4000, "bye");
        expect(await client.next()).toBe('close 4000 "bye"');
        expect(ws.readyState).toBe(ws.CLOSING);
        client.close(4000, "bye");
        client.end();
        await nextEvent(ws, "close");
        expect(events).toEqual(['close 4000 Buffer("bye") rs=3']);
        expect(await client.next()).toBe("EOF");
        expect(socket.destroyed).toBe(true);
      });

      test("echoes the client's Close frame, then sends FIN and emits 'close'", async () => {
        await using opened = await open();
        const { ws, events, socket, client } = opened;
        client.close(1000, "done");
        client.end();
        await nextEvent(ws, "close");
        expect(events).toEqual(['close 1000 Buffer("done") rs=3']);
        expect(await client.remainingFrames()).toEqual(['close 1000 "done"']);
        expect(socket.destroyed).toBe(true);
      });

      test("terminate() destroys the socket", async () => {
        await using opened = await open();
        const { ws, events, socket, client } = opened;
        ws.terminate();
        expect(socket.destroyed).toBe(true);
        await nextEvent(ws, "close");
        expect(events).toEqual(["close 1006 Buffer() rs=3"]);
        expect(await client.remainingFrames()).toEqual([]);
      });
    });
  });

  describe("several requests on one connection", () => {
    const app = () => http.createServer((req, res) => res.end("ok"));

    test("upgrades after a plain request", async () => {
      const server = app();
      echo(new WebSocketServer({ server }));
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(getRequest);
      expect(await client.nextResponse()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      client.write(upgradeRequest());
      expect(await client.nextResponse()).toEqual([switchingProtocols, ""]);
      client.text("x");
      expect(await client.next()).toBe('text "echo:x"');
    });

    test("upgrades when a plain request and the handshake arrive in one packet", async () => {
      const server = app();
      echo(new WebSocketServer({ server }));
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(getRequest + upgradeRequest());
      expect(await client.nextResponse()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      expect(await client.nextResponse()).toEqual([switchingProtocols, ""]);
      client.text("x");
      expect(await client.next()).toBe('text "echo:x"');
    });

    test("rejects an invalid handshake that arrives in the same packet as a plain request", async () => {
      const server = app();
      new WebSocketServer({ server });
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(getRequest + upgradeRequest({ headers: { "Sec-WebSocket-Key": null } }));
      expect(await client.nextResponse()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      expect(await client.nextResponse()).toEqual([
        "HTTP/1.1 400 Bad Request",
        "Missing or invalid Sec-WebSocket-Key header",
      ]);
      expect(await client.nextResponse()).toBe("EOF");
    });

    // Here the socket's `_httpMessage` is still the plain request's response when 'upgrade' is emitted.
    test.concurrent.each<{ state: string; pending: boolean; lines: string[] }>([
      { state: "has been answered", pending: false, lines: ["HTTP/1.1 200, HTTP/1.1 400"] },
      { state: "is still pending", pending: true, lines: ["answered the plain request", "HTTP/1.1 400"] },
    ])(
      'with server.emit("connection", socket), rejects an invalid handshake sent with a plain request that $state',
      async ({ pending, lines }) => {
        const script = `
          const net = require("node:net");
          let pendingResponse;
          const server = require("node:http").createServer((req, res) => {
            if (${pending}) pendingResponse = res;
            else res.end("ok");
          });
          const wss = new WebSocketServer({ noServer: true });
          server.on("upgrade", (req, socket, head) => {
            wss.handleUpgrade(req, socket, head, () => console.log("upgraded"));
            if (!pendingResponse) return;
            pendingResponse.writeHead(200).end("ok");
            console.log("answered the plain request");
          });
          const front = net.createServer(socket => server.emit("connection", socket)).listen(0, "127.0.0.1", () => {
            const client = net.connect(front.address().port, "127.0.0.1");
            let received = "";
            client.on("data", chunk => (received += chunk));
            client.on("close", () => {
              console.log(received.match(/HTTP\\/1\\.1 \\d+/g).join(", "));
              front.close();
            });
            process.on("uncaughtException", () => process.exit(1));
            client.write(${JSON.stringify(getRequest + upgradeRequest({ headers: { "Sec-WebSocket-Key": null } }))});
          });
        `;
        expect(await runScript({ specifier }, script)).toEqual({ lines, stderr: "", exitCode: 0 });
      },
      scriptTimeout,
    );
  });

  describe("frames that arrive before handleUpgrade() runs", () => {
    type EarlyFramesCase = {
      bytes: Buffer;
      /** Write `bytes` after the 'upgrade' event instead of in the same packet as the request. */
      late?: boolean;
      /** Delay handleUpgrade() until the server has had time to read `bytes`. */
      defer?: boolean;
      /** Written after the 101. */
      tail?: Buffer;
      events: string[];
      sent?: string[];
    };
    const frame = (opcode: number, payload: string | Buffer) => encodeFrame(opcode, payload, { mask: true });
    const split = frame(OP.text, "split-frame");
    const earlyAndLater = ['message Buffer("early") text rs=1', 'message Buffer("later") text rs=1'];

    const testEarlyFrames =
      ({ bytes, late = false, defer = false, tail, events: expected, sent = [] }: EarlyFramesCase) =>
      async () => {
        const server = http.createServer((req, res) => res.end());
        const wss = new WebSocketServer({ noServer: true });
        const upgrade = Promise.withResolvers<Buffer>();
        const proceed = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        const events: string[] = [];
        server.on("upgrade", async (req, socket, head) => {
          upgrade.resolve(head);
          if (defer) await proceed.promise;
          wss.handleUpgrade(req, socket, head, ws => {
            recordEvents(ws, events);
            ws.on("close", () => closed.resolve());
          });
        });
        await using listening = await serve(server);

        const client = listening.connect(late ? {} : { trailingBytes: bytes });
        expect((await upgrade.promise).length > 0).toBe(!late);
        if (late) client.write(bytes);
        if (defer) {
          // Once a later connection gets its response, the server must have received what the first one sent earlier.
          await listening.connect({ raw: getRequest }).response;
          proceed.resolve();
        }
        expect((await client.response).status).toBe(switchingProtocols);

        if (bytes[0] === (0x80 | OP.close)) {
          expect(await client.remainingFrames()).toEqual(sent);
          await closed.promise;
        } else {
          if (tail) client.write(tail);
          client.text("later");
          expect(await client.roundTrip()).toEqual(sent);
        }
        expect(events).toEqual(expected);
      };

    test(
      "a message in the same packet as the request",
      testEarlyFrames({ bytes: frame(OP.text, "early"), events: earlyAndLater }),
    );
    test(
      "half a message in the same packet as the request",
      testEarlyFrames({
        bytes: split.subarray(0, 9),
        tail: split.subarray(9),
        events: ['message Buffer("split-frame") text rs=1', 'message Buffer("later") text rs=1'],
      }),
    );
    test(
      "a ping in the same packet as the request",
      testEarlyFrames({
        bytes: frame(OP.ping, "p"),
        events: ['ping Buffer("p") rs=1', 'message Buffer("later") text rs=1'],
        sent: ['pong "p"'],
      }),
    );
    test(
      "a Close frame in the same packet as the request",
      testEarlyFrames({
        bytes: frame(OP.close, closePayload(1000)),
        events: ["close 1000 Buffer() rs=3"],
        sent: ["close 1000"],
      }),
    );
    test(
      "a message in the same packet as the request, with handleUpgrade() deferred to a later task",
      testEarlyFrames({ bytes: frame(OP.text, "early"), defer: true, events: earlyAndLater }),
    );
    test(
      "a message sent after the request, with handleUpgrade() deferred to a later task",
      testEarlyFrames({ bytes: frame(OP.text, "early"), late: true, defer: true, events: earlyAndLater }),
    );

    // Bun's node:http passes an upgraded connection's bytes to JS in a task, so for a moment they're in neither `head`
    // nor `socket`'s buffer. A Bun.listen() handler is called straight from the event loop's poll. If its socket
    // becomes readable right after the connection does, it runs between that read and the task.
    test("a message that was read from the connection but hasn't reached `socket` yet", async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ noServer: true });
      const upgrade = Promise.withResolvers<[http.IncomingMessage, Duplex, Buffer]>();
      server.on("upgrade", (...args) => upgrade.resolve(args));
      await using listening = await serve(server);
      const client = listening.connect();
      const [req, socket, head] = await upgrade.promise;

      const events: string[] = [];
      const accepted = Promise.withResolvers<void>();
      using trigger = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open: () => accepted.resolve(),
          data: () => wss.handleUpgrade(req, socket, head, ws => void recordEvents(ws, events)),
        },
      });
      const triggerClient = net.connect(trigger.port, "127.0.0.1");
      try {
        await accepted.promise;
        client.text("early");
        triggerClient.write("now");
        expect((await client.response).status).toBe(switchingProtocols);
        client.text("later");
        expect(await client.roundTrip()).toEqual([]);
        expect(events).toEqual(earlyAndLater);
      } finally {
        triggerClient.destroy();
      }
    });

    // The same moment, with the client's FIN. The native transport would never learn about it.
    test("a FIN that was read from the connection but hasn't reached `socket` yet", async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ noServer: true });
      const upgrade = Promise.withResolvers<[http.IncomingMessage, Duplex, Buffer]>();
      server.on("upgrade", (...args) => upgrade.resolve(args));
      await using listening = await serve(server);
      const client = listening.connect();
      const [req, socket, head] = await upgrade.promise;
      const socketClosed = once(socket, "close");

      const events: string[] = [];
      const accepted = Promise.withResolvers<void>();
      using trigger = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open: () => accepted.resolve(),
          data: () => wss.handleUpgrade(req, socket, head, ws => void recordEvents(ws, events)),
        },
      });
      const triggerClient = net.connect(trigger.port, "127.0.0.1");
      try {
        await accepted.promise;
        client.end();
        triggerClient.write("now");
        await Promise.all([socketClosed, client.closed]);
        expect({ events, clients: wss.clients.size }).toEqual({ events: ["close 1006 Buffer() rs=3"], clients: 0 });
      } finally {
        triggerClient.destroy();
      }
    });
  });

  describe("http.Server#close()", () => {
    test("closes idle connections, so a later handshake on one gets no response", async () => {
      const server = http.createServer((req, res) => res.end("ok"));
      new WebSocketServer({ server });
      await using listening = await serve(server);
      const client = listening.connectHttp();
      client.write(getRequest);
      expect(await client.nextResponse()).toEqual(["HTTP/1.1 200 OK", "ok"]);
      server.close();
      client.write(upgradeRequest());
      expect(await client.nextResponse()).toBe("EOF");
    });

    // close() keeps a connection open while it has a request in flight, and that connection can still upgrade.
    async function closeDuringRequest(server: http.Server, listening: Awaited<ReturnType<typeof serve>>) {
      const pendingRequest = once(server, "request") as Promise<[http.IncomingMessage, http.ServerResponse]>;
      const client = listening.connectHttp();
      client.write(getRequest);
      const [, res] = await pendingRequest;
      let isClosed = false;
      const closed = new Promise<void>(resolve => server.close(() => ((isClosed = true), resolve())));
      res.end("drained");
      expect(await client.nextResponse()).toEqual(["HTTP/1.1 200 OK", "drained"]);
      return { client, closed, isClosed: () => isClosed };
    }

    const upgradesAfterClose = (attach: (server: http.Server, wss: WebSocketServer) => void) => async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ noServer: true });
      attach(server, wss);
      await using listening = await serve(server);
      const { client, closed, isClosed } = await closeDuringRequest(server, listening);

      const connection = once(wss, "connection");
      client.write(upgradeRequest());
      expect(await client.nextResponse()).toEqual([switchingProtocols, ""]);
      const [ws] = (await connection) as [WebSocket];
      const events = recordEvents(ws);

      // close()'s callback doesn't fire until the WebSocket closes.
      expect(await client.roundTrip()).toEqual([]);
      expect({ clients: wss.clients.size, isClosed: isClosed() }).toEqual({ clients: 1, isClosed: false });
      client.close(1000);
      await Promise.all([closed, nextEvent(ws, "close")]);
      expect(events).toEqual(["close 1000 Buffer() rs=3"]);
    };

    test(
      "a connection that survived close() can upgrade from the 'upgrade' event",
      upgradesAfterClose((server, wss) =>
        server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, emitConnection(wss, req))),
      ),
    );
    test(
      "a connection that survived close() can upgrade from a later task",
      upgradesAfterClose((server, wss) =>
        server.on("upgrade", (req, socket, head) =>
          setImmediate(() => wss.handleUpgrade(req, socket, head, emitConnection(wss, req))),
        ),
      ),
    );
    // On Bun, npm ws can't send or receive frames through the socket of a 'request' event.
    test.skipIf(!builtin)(
      "a connection that survived close() can upgrade from a 'request' listener",
      upgradesAfterClose((server, wss) =>
        server.on("request", req => {
          if (req.headers.upgrade) wss.handleUpgrade(req, req.socket, Buffer.alloc(0), emitConnection(wss, req));
        }),
      ),
    );

    test("a connection that survived close() can upgrade after the server listens again", async () => {
      const server = http.createServer();
      const wss = echo(new WebSocketServer({ server }));
      await using listening = await serve(server);
      const { client: old } = await closeDuringRequest(server, listening);
      await once(server.listen(0, "127.0.0.1"), "listening");
      const fresh = listening.connectHttp();
      for (const client of [old, fresh]) {
        client.write(upgradeRequest());
        expect(await client.nextResponse()).toEqual([switchingProtocols, ""]);
        client.text("x");
        expect(await client.next()).toBe('text "echo:x"');
      }
      expect(wss.clients.size).toBe(2);
    });

    test("completes once a WebSocket's client has disconnected", async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ server });
      const connection = once(wss, "connection");
      await using listening = await serve(server);
      const client = listening.connect();
      const [ws] = (await connection) as [WebSocket];
      const events = recordEvents(ws);
      client.destroy();
      await nextEvent(ws, "close");
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      await new Promise(resolve => server.close(resolve));
    });
  });

  test("http.Server#getConnections() counts WebSockets", async () => {
    const server = http.createServer();
    new WebSocketServer({ server });
    await using listening = await serve(server);
    await listening.connect().response;
    expect(await new Promise(resolve => server.getConnections((error, count) => resolve(count)))).toBe(1);
  });

  test("http.Server timeouts don't apply to an upgraded socket", async () => {
    // Never respond to plain requests.
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

    // This request started later, so by the time it times out the WebSocket would have timed out too.
    expect((await listening.connect({ raw: getRequest }).response).status).toBe("no response");
    expect(timeouts).toEqual(["the request"]);
    expect(await client.roundTrip()).toEqual([]);
  });

  test("the upgrade request is complete, not aborted, not destroyed, and keeps its headers", async () => {
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

  test("after a closing handshake, the WebSocket's 'close' fires before req.socket's 'close'", async () => {
    await using server = await openServer(implementation);
    const { ws, req, client } = server;
    const order: string[] = [];
    req.socket.on("end", () => order.push("socket 'end'"));
    req.socket.on("close", () => order.push("socket 'close'"));
    req.on("close", () => order.push("req 'close'"));
    ws.on("close", () => order.push("ws 'close'"));
    client.close(1000);
    await nextEvent(req.socket, "close");
    // The built-in reads the connection natively, so req.socket never emits 'end'.
    expect(order).toEqual([...(builtin ? [] : ["socket 'end'"]), "ws 'close'", "socket 'close'"]);
    expect(req.socket.destroyed).toBe(true);
  });

  test("the README's heartbeat example: ping(), 'pong' with `this` as the socket, terminate()", async () => {
    await using server = await openServer(implementation);
    const { wss, ws, client, events } = server;
    const alive = new Map<unknown, boolean>([[ws, true]]);
    ws.on("pong", function (this: WebSocket) {
      alive.set(this, true);
    });
    const heartbeat = () =>
      wss.clients.forEach(ws => {
        if (!alive.get(ws)) return ws.terminate();
        alive.set(ws, false);
        ws.ping();
      });

    heartbeat();
    expect(await client.next()).toBe("ping");
    client.pong();
    await nextEvent(ws, "pong");
    expect([...alive]).toEqual([[ws, true]]);

    heartbeat();
    expect(await client.next()).toBe("ping");
    // No pong this time.
    heartbeat();
    expect(await client.next()).toBe("EOF");
    await server.closed;
    expect(events).toEqual(["pong Buffer() rs=1", "close 1006 Buffer() rs=3"]);
    expect(wss.clients.size).toBe(0);
  });

  test("y-websocket's usage: binaryType 'arraybuffer' and send(Uint8Array, {}, callback)", async () => {
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

  test("graphql-ws's usage: handleProtocols() returning false and close(44xx, reason)", async () => {
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

test("http.Server#close() waits for a half-open raw upgraded socket and closeAllConnections() skips it", async () => {
  const server = http.createServer();
  const upgrade = once(server, "upgrade") as Promise<[http.IncomingMessage, Duplex]>;
  await using listening = await serve(server);
  const client = listening.connect({ headers: { Upgrade: "test" } });
  const [, socket] = await upgrade;
  socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
  await client.response;

  // The server's half stays open because nothing here ends it.
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

// These packages import "ws" themselves, which resolves to the built-in on Bun.
describe("packages built on the ws server (built-in)", () => {
  const { WebSocketServer } = implementations[0].ws;

  test("engine.io doesn't destroy another WebSocketServer's socket on the same http.Server", async () => {
    const server = http.createServer();
    const io = new SocketIO(server, { destroyUpgradeTimeout: 20 });
    const wss = new WebSocketServer({ noServer: true });
    let upgraded!: Duplex;
    server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/hmr") return;
      upgraded = socket;
      wss.handleUpgrade(req, socket, head, ws => ws.send("hmr connected"));
    });
    await using listening = await serve(server);
    try {
      const client = listening.connect({ path: "/hmr", headers: { "Sec-WebSocket-Protocol": "vite-hmr" } });
      expect((await client.response).status).toBe(switchingProtocols);
      expect(await client.next()).toBe('text "hmr connected"');

      // Nothing handles this upgrade, so engine.io destroys it after `destroyUpgradeTimeout`. By then the first
      // socket's timer has already fired.
      expect((await listening.connect({ path: "/unhandled" }).response).status).toBe("no response");
      expect(upgraded.writableEnded).toBe(false);
      expect(await client.roundTrip()).toEqual([]);
    } finally {
      io.close();
    }
  });

  test("engine.io's 'headers' event can add headers to the 101", async () => {
    const server = http.createServer();
    const io = new SocketIO(server);
    io.engine.on("headers", headers => (headers["X-Custom"] = "yes"));
    await using listening = await serve(server);
    try {
      const client = listening.connect({ path: engineIoPath });
      const { status, headers } = await client.response;
      expect(status).toBe(switchingProtocols);
      expect(headers).toContain("X-Custom: yes");
      expect((await client.nextFrame())!.payload.toString()).toStartWith('0{"sid":"');
    } finally {
      io.close();
    }
  });

  test("socket.io's maxHttpBufferSize: an oversized packet gets Close 1009 and 'transport error'", async () => {
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
      expect(await client.remainingFrames()).toEqual(["close 1009"]);
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

  test("@fastify/websocket: a websocket route echoes, and a handshake on an unknown route gets a 404", async () => {
    await using app = await fastifyApp();
    const { fastify } = app;
    await fastify.listen({ port: 0, host: "127.0.0.1" });
    const { port } = fastify.server.address() as net.AddressInfo;
    const client = new RawClient(port, { path: "/ws" });
    const notFound = new RawClient(port, { path: "/nope" });
    try {
      await expectEcho(client);
      expect((await notFound.response).status).toBe("HTTP/1.1 404 Not Found");
    } finally {
      client.destroy();
      notFound.destroy();
    }
  });

  // injectWS() upgrades over a Duplex and builds its client with `new WebSocket(null)` and setSocket().
  test("@fastify/websocket: injectWS()", async () => {
    await using app = await fastifyApp();
    const { fastify } = app;
    await fastify.ready();
    const ws = await fastify.injectWS("/ws");
    try {
      const events = recordEvents(ws);
      expect(ws.readyState).toBe(ws.OPEN);
      ws.send("hi");
      await nextEvent(ws, "message");
      ws.ping("p");
      await nextEvent(ws, "pong");
      ws.terminate();
      await nextEvent(ws, "close");
      expect(events).toEqual([
        'message Buffer("echo:hi") text rs=1',
        'pong Buffer("p") rs=1',
        "close 1006 Buffer() rs=3",
      ]);
    } finally {
      ws.terminate();
    }
  });

  test("@fastify/websocket: injectWS() on an unknown route rejects with the status code", async () => {
    await using app = await fastifyApp();
    const { fastify } = app;
    await fastify.ready();
    expect(await fastify.injectWS("/nope").catch(showError)).toBe('Error "Unexpected server response: 404"');
  });
});
