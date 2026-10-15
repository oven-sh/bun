// The options of a `ws` client that decide how it connects: `createConnection`, `lookup`, `agent`, and what node:net
// takes. The server is a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as certificate, isLinux } from "harness";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";
import {
  attempt,
  closedPort,
  createPeer,
  encodeFrame,
  event,
  implementations,
  OP,
  type RawSocket,
  response101,
  show,
  watch,
} from "./ws-raw-peer";

const opening = ["upgrade 101 rs=0", "open rs=1"];
const lost = "close 1006 Buffer() rs=3";
const boom = ['error Error "boom" rs=2', lost];
// For errors whose text belongs to OpenSSL: class and code stay.
const withoutMessage = (line: string) => line.replace(/ ".*"/, "");

// No resolver can be asked for this name: a label of a DNS query holds 63 characters at most. A client gets to a
// server only through the option under test.
const nowhere = Buffer.alloc(64, "a") + ".invalid";

type Peer = Awaited<ReturnType<typeof createPeer>>;
type Callback = (error: Error | null, stream?: Duplex) => void;
type ConnectOptions = http.ClientRequestArgs;

const toPeer = (peer: Peer) => net.connect(peer.port, "127.0.0.1");
const toSecurePeer = (peer: Peer) => tls.connect({ port: peer.port, host: "127.0.0.1", ca: certificate.cert });

/** `socket` behind a Duplex that is no net.Socket. */
function behindDuplex(socket: net.Socket) {
  const duplex = new Duplex({
    read: () => void socket.resume(),
    write: (chunk, encoding, callback) => void socket.write(chunk, callback),
    final: callback => void socket.end(callback),
    destroy: (error, callback) => (socket.destroy(), callback(error)),
  });
  socket.on("data", chunk => duplex.push(chunk) || socket.pause());
  socket.on("end", () => duplex.push(null));
  socket.on("error", error => duplex.destroy(error));
  socket.on("close", () => duplex.destroy());
  return duplex;
}

/** An agent with this `createConnection()`. */
const agentWith = (
  createConnection: (options: ConnectOptions, callback: Callback) => Duplex | void,
  Agent = http.Agent,
) => Object.assign(new Agent(), { createConnection });

/** A SOCKS5 server without authentication. Whatever a client asks for, it gets a connection to `peer`. */
async function createSocksServer(peer: Peer) {
  const requests: string[] = [];
  const localPorts: (number | undefined)[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, async client => {
    sockets.add(client.on("error", () => {}));
    await once(client, "data");
    client.write(Buffer.from([5, 0]));
    const [request] = (await once(client, "data")) as [Buffer];
    const host = request[3] === 3 ? request.toString("latin1", 5, 5 + request[4]) : request.subarray(4, 8).join(".");
    requests.push(`CONNECT ${host}:${request.readUInt16BE(request.length - 2)}`);
    const upstream = net.connect({ port: peer.port, host: "127.0.0.1", allowHalfOpen: true });
    sockets.add(upstream.on("error", () => {}));
    await once(upstream, "connect");
    localPorts.push(upstream.localPort);
    client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
    client.pipe(upstream).pipe(client);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    /** As `socks-proxy-agent` has it: an object, not a URL. */
    proxy: { host: "127.0.0.1", port: (server.address() as net.AddressInfo).port, type: 5 },
    requests,
    /** The local port of each connection to `peer`. */
    localPorts,
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
type Proxy = Awaited<ReturnType<typeof createSocksServer>>["proxy"];

/** The client's half of SOCKS5. The name goes to the proxy as it is. */
async function socksConnect(proxy: Proxy, options: ConnectOptions) {
  const host = Buffer.from(options.host!);
  const port = Number(options.port);
  const socket = net.connect(proxy.port, proxy.host);
  socket.write(Buffer.from([5, 1, 0]));
  await once(socket, "data");
  socket.write(Buffer.from([5, 1, 0, 3, host.length, ...host, port >> 8, port & 255]));
  const [reply] = (await once(socket, "data")) as [Buffer];
  if (reply[1] !== 0) throw new Error(`SOCKS5 reply ${reply[1]}`);
  return socket;
}

// The three ways in which the agents on npm take a connection into their own hands.
const socksAgents: { shape: string; create(proxy: Proxy): http.Agent }[] = [
  {
    shape: "createConnection(options, callback)",
    create: proxy =>
      new (class SocksAgent extends http.Agent {
        proxy = proxy;
        createConnection(options: ConnectOptions, callback: Callback) {
          return void socksConnect(this.proxy, options).then(socket => callback(null, socket), callback);
        }
      })(),
  },
  {
    shape: "createSocket() around an asynchronous connect(), as agent-base 7 does",
    create: proxy =>
      new (class SocksAgent extends http.Agent {
        proxy = proxy;
        current: net.Socket | undefined;
        createSocket(req: http.ClientRequest, options: ConnectOptions, callback: Callback) {
          socksConnect(this.proxy, options).then(socket => {
            this.current = socket;
            (http.Agent.prototype as any).createSocket.call(this, req, options, callback);
          }, callback);
        }
        createConnection() {
          return this.current;
        }
      })(),
  },
  {
    shape: "addRequest() and req.onSocket() on an EventEmitter, as agent-base 6 does",
    create: proxy =>
      new (class SocksAgent extends EventEmitter {
        proxy = proxy;
        addRequest(req: http.ClientRequest & { onSocket(socket: net.Socket): void }, options: ConnectOptions) {
          socksConnect(this.proxy, options).then(
            socket => req.onSocket(socket),
            error => req.emit("error", error),
          );
        }
      })() as unknown as http.Agent,
  },
];

describe.each(implementations)("ws client, how it connects ($name)", ({ ws: implementation }) => {
  const { WebSocket } = implementation;

  /** A watched client, terminated at the end of the block. */
  function connect(url: string, options: object) {
    const ws = new WebSocket(url, options as {});
    return { ws, events: watch(ws), [Symbol.dispose]: () => ws.terminate() };
  }

  type Way = {
    way: string;
    secure?: boolean;
    /** Options that lead to `peer`. The stream they make goes through `made`. */
    options(peer: Peer, made: <Stream extends Duplex>(stream: Stream) => Stream): object;
  };
  const later = (stream: net.Socket, callback: Callback) => void stream.once("connect", () => callback(null, stream));

  describe.each([
    {
      way: "createConnection() returns a net.Socket",
      options: (peer, made) => ({ createConnection: () => made(toPeer(peer)) }),
    },
    {
      way: "createConnection() returns a Duplex that is no net.Socket",
      options: (peer, made) => ({ createConnection: () => made(behindDuplex(toPeer(peer))) }),
    },
    {
      way: "createConnection() calls back later",
      options: (peer, made) => ({
        createConnection: (options: ConnectOptions, callback: Callback) => later(made(toPeer(peer)), callback),
      }),
    },
    {
      way: "wss: and createConnection() returns a tls.TLSSocket",
      secure: true,
      options: (peer, made) => ({ createConnection: () => made(toSecurePeer(peer)) }),
    },
    {
      way: "the createConnection() of an agent returns a net.Socket",
      options: (peer, made) => ({ agent: agentWith(() => made(toPeer(peer))) }),
    },
    {
      way: "the createConnection() of an agent goes on to that of http.Agent",
      options: (peer, made) => ({
        agent: new (class extends http.Agent {
          createConnection(options: ConnectOptions, callback: Callback) {
            return made(super.createConnection({ ...options, host: "127.0.0.1" }, callback)!);
          }
        })(),
      }),
    },
    {
      way: "the createConnection() of an agent returns a Duplex that is no net.Socket",
      options: (peer, made) => ({ agent: agentWith(() => made(behindDuplex(toPeer(peer)))) }),
    },
    {
      way: "the createConnection() of an agent calls back later",
      options: (peer, made) => ({ agent: agentWith((options, callback) => later(made(toPeer(peer)), callback)) }),
    },
    {
      way: "wss: and the createConnection() of an https.Agent returns a tls.TLSSocket",
      secure: true,
      options: (peer, made) => ({ agent: agentWith(() => made(toSecurePeer(peer)), https.Agent) }),
    },
  ] as Way[])("$way", ({ secure, options }) => {
    /** An OPEN client, the stream it was given and the raw server's end of the connection. */
    async function open() {
      const peer = await createPeer({ secure });
      const streams: Duplex[] = [];
      const made = <Stream extends Duplex>(stream: Stream) => (streams.push(stream), stream);
      const client = connect(`${secure ? "wss" : "ws"}://${nowhere}:${peer.port}/x`, options(peer, made));
      const dispose = () => (client[Symbol.dispose](), peer[Symbol.asyncDispose]());
      await event(client.ws, "open");
      return { ...client, streams, conn: await peer.connection(), [Symbol.asyncDispose]: dispose };
    }

    test("that stream is `_socket`; messages both ways, then a closing handshake", async () => {
      await using client = await open();
      const { ws, events, streams, conn } = client;
      expect(streams).toHaveLength(1);
      expect((ws as any)._socket).toBe(streams[0]);
      expect(conn.headLines[0]).toBe("GET /x HTTP/1.1");
      expect(conn.header("host")).toStartWith(nowhere + ":");

      ws.send("up");
      expect(await conn.next()).toBe('text "up"');
      conn.text("down");
      expect(await conn.roundTrip()).toEqual([]);

      ws.close(1000, "bye");
      expect(await conn.next()).toBe('close 1000 "bye"');
      conn.close(1000, "bye");
      conn.end();
      await event(ws, "close");
      expect(events).toEqual([...opening, 'message Buffer("down") text rs=1', 'close 1000 Buffer("bye") rs=3']);
      expect(await conn.next()).toBe("EOF");
      expect(streams[0].destroyed).toBe(true);
    });

    test("terminate() destroys it", async () => {
      await using client = await open();
      const { ws, events, streams, conn } = client;
      ws.terminate();
      expect(streams[0].destroyed).toBe(true);
      await event(ws, "close");
      expect(events).toEqual([...opening, lost]);
      expect(await conn.rest()).toEqual([]);
    });
  });

  describe("createConnection", () => {
    type Hook = (options: ConnectOptions, ...rest: unknown[]) => net.Socket;
    test.each([
      { whose: "the option", options: (createConnection: Hook) => ({ createConnection }) },
      { whose: "that of an agent", options: (createConnection: Hook) => ({ agent: agentWith(createConnection) }) },
    ])(
      "$whose runs inside the constructor, with the host and the port of the URL and a callback",
      async ({ options }) => {
        await using peer = await createPeer();
        const calls: unknown[] = [];
        const hook: Hook = ({ host, port }, ...rest) => (
          calls.push({ host, port, rest: rest.map(show) }),
          toPeer(peer)
        );
        using client = connect(`ws://${nowhere}:1234/x`, options(hook));
        expect(calls).toEqual([{ host: nowhere, port: "1234", rest: ["function"] }]);
        await event(client.ws, "open");
        expect((await peer.connection()).header("host")).toBe(nowhere + ":1234");
        expect(calls).toHaveLength(1);
      },
    );

    test.each([
      {
        agent: "an agent",
        create: (peer: Peer, calls: string[]) => agentWith(() => (calls.push("agent"), toPeer(peer))),
      },
      { agent: "`agent: false`", create: () => false },
    ])("$agent makes the connection in its place", async ({ create }) => {
      await using peer = await createPeer();
      const calls: string[] = [];
      const agent = create(peer, calls);
      using client = connect(peer.url, {
        agent,
        createConnection: () => (calls.push("createConnection"), toPeer(peer)),
      });
      await event(client.ws, "open");
      expect(calls).toEqual(agent ? ["agent"] : []);
    });
  });

  describe("no connection: 'error' with that very error, then 'close' 1006", () => {
    const error = new Error("boom");
    const fail = (options: ConnectOptions, callback: Callback) => void setImmediate(callback, error);

    test.each([
      {
        how: "createConnection() throws",
        options: {
          createConnection() {
            throw error;
          },
        },
      },
      { how: "createConnection() calls back with an error", options: { createConnection: fail } },
      { how: "the createConnection() of an agent calls back with an error", options: { agent: agentWith(fail) } },
      { how: "lookup() calls back with an error", options: { lookup: (...args: Callback[]) => args[2](error) } },
    ])("$how", async ({ options }) => {
      using client = connect(`ws://${nowhere}:1234/x`, options);
      const [[reported]] = await Promise.all([event(client.ws, "error"), event(client.ws, "close")]);
      expect(reported).toBe(error);
      expect(client.events).toEqual(boom);
    });

    test("the socket of createConnection() is refused", async () => {
      const port = await closedPort();
      using client = connect(`ws://${nowhere}:1234/x`, { createConnection: () => net.connect(port, "127.0.0.1") });
      await event(client.ws, "close");
      expect(client.events).toEqual(['error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED rs=2', lost]);
    });

    test("the createConnection() of an agent throws: so does the constructor", () => {
      const agent = agentWith(() => {
        throw error;
      });
      expect(() => new WebSocket(`ws://${nowhere}:1234/x`, { agent }).on("error", () => {}).terminate()).toThrow(error);
    });
  });

  describe("lookup", () => {
    type Asked = { family?: number; all?: boolean };
    type Answer = (error: null, address: unknown, family?: number) => void;
    const loopback = (calls: unknown[]) => (hostname: string, options: Asked, callback: Answer) => {
      calls.push({ hostname, family: options.family, all: options.all });
      if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
      else callback(null, "127.0.0.1", 4);
    };

    // What is asked for is up to node:net.
    test.each([
      { label: "by default: every address", options: {}, asked: { family: undefined, all: true } },
      { label: "family: 4", options: { family: 4 }, asked: { family: 4, all: undefined } },
      {
        label: "autoSelectFamily: false",
        options: { autoSelectFamily: false },
        asked: { family: undefined, all: undefined },
      },
    ])("runs inside the constructor, and its answer is dialled; $label", async ({ options, asked }) => {
      await using peer = await createPeer();
      const calls: unknown[] = [];
      using client = connect(`ws://${nowhere}:${peer.port}/x`, { ...options, lookup: loopback(calls) });
      expect(calls).toEqual([{ hostname: nowhere, ...asked }]);
      await event(client.ws, "open");
      const conn = await peer.connection();
      expect(conn.header("host")).toBe(`${nowhere}:${peer.port}`);
      expect((client.ws as any)._socket.remotePort).toBe(peer.port);
      client.ws.send("up");
      expect(await conn.next()).toBe('text "up"');
      expect(calls).toHaveLength(1);
      expect(client.events).toEqual(opening);
    });

    test("wss: the name is still the one the certificate has to be for", async () => {
      await using peer = await createPeer({ secure: true });
      const url = `wss://${nowhere}:${peer.port}/x`;
      using refused = connect(url, { ca: certificate.cert, lookup: loopback([]) });
      await event(refused.ws, "close");
      expect(refused.events.map(withoutMessage)).toEqual(["error Error ERR_TLS_CERT_ALTNAME_INVALID rs=2", lost]);

      using client = connect(url, { ca: certificate.cert, checkServerIdentity: () => undefined, lookup: loopback([]) });
      await event(client.ws, "open");
      expect(((await peer.connection()).socket as tls.TLSSocket).servername).toBe(nowhere);
    });
  });

  describe("what node:net takes", () => {
    test("family: 6 does not reach a server on 127.0.0.1", async () => {
      await using peer = await createPeer();
      using client = connect(`ws://localhost:${peer.port}/first`, { family: 6 });
      await Promise.race([event(client.ws, "open"), event(client.ws, "close")]);
      expect(client.events).toEqual([expect.stringMatching(/^error /), lost]);
      // The first request the server reads is that of a second client.
      using second = connect(`ws://localhost:${peer.port}/second`, { family: 4 });
      expect((await peer.connection()).headLines[0]).toBe("GET /second HTTP/1.1");
    });

    // Elsewhere 127.0.0.2 is no address of the machine.
    test.skipIf(!isLinux)("localAddress", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url, { localAddress: "127.0.0.2" });
      await event(client.ws, "open");
      expect((await peer.connection()).socket.remoteAddress).toBe("127.0.0.2");
    });
  });

  describe("an agent that leaves the connection to Node", () => {
    test.each([
      { agent: "new http.Agent()", create: () => new http.Agent() },
      { agent: "new http.Agent({ keepAlive: true })", create: () => new http.Agent({ keepAlive: true }) },
      { agent: "false", create: () => false },
    ] as { agent: string; create(): http.Agent | false }[])("agent: $agent", async ({ create }) => {
      await using peer = await createPeer();
      const agent = create();
      using client = connect(peer.url + "/x", { agent });
      const { ws, events } = client;
      await event(ws, "open");
      const conn = await peer.connection();
      expect(conn.headLines[0]).toBe("GET /x HTTP/1.1");
      expect(conn.header("connection")).toBe("Upgrade");
      // The connection is no longer one of the agent's.
      if (agent) expect([agent.sockets, agent.freeSockets, agent.requests].map(Object.keys)).toEqual([[], [], []]);

      ws.send("up");
      expect(await conn.next()).toBe('text "up"');
      conn.text("down");
      conn.close(1000);
      conn.end();
      await event(ws, "close");
      expect(events).toEqual([...opening, 'message Buffer("down") text rs=1', "close 1000 Buffer() rs=3"]);
      expect(await conn.rest()).toEqual(["close 1000"]);
    });

    const refused = ["error Error DEPTH_ZERO_SELF_SIGNED_CERT rs=2", lost];
    test.each([
      { label: "none", agent: {}, options: {}, events: refused },
      { label: "rejectUnauthorized: false", agent: { rejectUnauthorized: false }, options: {}, events: opening },
      { label: "ca", agent: { ca: certificate.cert }, options: {}, events: opening },
      { label: "none, next to the option ca", agent: {}, options: { ca: certificate.cert }, events: opening },
      {
        label: "rejectUnauthorized: false, which wins over the option",
        agent: { rejectUnauthorized: false },
        options: { rejectUnauthorized: true },
        events: opening,
      },
      {
        label: "rejectUnauthorized: true, which wins over the option",
        agent: { rejectUnauthorized: true },
        options: { rejectUnauthorized: false },
        events: refused,
      },
    ])("the TLS options of an https.Agent: $label", async ({ agent, options, events }) => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url, { ...options, agent: new https.Agent(agent) });
      await Promise.race([event(client.ws, "open"), event(client.ws, "close")]);
      expect(client.events.map(withoutMessage)).toEqual(events);
    });
  });

  describe("a SOCKS agent: `proxy` is an object, and it connects by itself", () => {
    describe.each(socksAgents)("$shape", ({ create }) => {
      test("the connection goes through the proxy, which gets the name as it is", async () => {
        await using peer = await createPeer();
        await using socks = await createSocksServer(peer);
        using client = connect(`ws://${nowhere}:1234/x`, { agent: create(socks.proxy) });
        const { ws, events } = client;
        await event(ws, "open");
        const conn = await peer.connection();
        expect(socks.requests).toEqual([`CONNECT ${nowhere}:1234`]);
        expect(socks.localPorts).toEqual([conn.socket.remotePort]);
        expect((ws as any)._socket.remotePort).toBe(socks.proxy.port);
        expect(conn.headLines[0]).toBe("GET /x HTTP/1.1");
        expect(conn.header("host")).toBe(nowhere + ":1234");

        ws.send("up");
        expect(await conn.next()).toBe('text "up"');
        conn.text("down");
        expect(await conn.roundTrip()).toEqual([]);
        ws.close(1000);
        expect(await conn.next()).toBe("close 1000");
        conn.close(1000);
        conn.end();
        await event(ws, "close");
        expect(events).toEqual([...opening, 'message Buffer("down") text rs=1', "close 1000 Buffer() rs=3"]);
        expect(peer.connections).toHaveLength(1);
      });

      test("no proxy there: its error, and nothing is dialled in its place", async () => {
        await using peer = await createPeer();
        const agent = create({ host: "127.0.0.1", port: await closedPort(), type: 5 });
        using client = connect(peer.url + "/first", { agent });
        await event(client.ws, "close");
        expect(client.events).toEqual(['error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED rs=2', lost]);
        // The first request the server reads is that of a second client.
        using second = connect(peer.url + "/second", {});
        expect((await peer.connection()).headLines[0]).toBe("GET /second HTTP/1.1");
      });
    });

    test("wss: TLS runs through the proxy", async () => {
      await using peer = await createPeer({ secure: true });
      await using socks = await createSocksServer(peer);
      const agent = Object.assign(
        agentWith((options, callback) => {
          socksConnect(socks.proxy, options).then(
            socket => callback(null, tls.connect({ socket, servername: "localhost", ca: certificate.cert })),
            callback,
          );
        }, https.Agent),
        { proxy: socks.proxy },
      );
      using client = connect(`wss://${nowhere}/x`, { agent });
      await event(client.ws, "open");
      const conn = await peer.connection();
      expect(socks.requests).toEqual([`CONNECT ${nowhere}:443`]);
      expect(socks.localPorts).toEqual([conn.socket.remotePort]);
      client.ws.send("up");
      expect(await conn.next()).toBe('text "up"');
    });
  });

  describe("the handshake over a stream of createConnection()", () => {
    // Every name is this machine.
    const byPort = (calls: string[]) => (options: ConnectOptions) => {
      calls.push(`${options.host}:${options.port}`);
      return net.connect(Number(options.port), "127.0.0.1");
    };

    test("the request: a line per element of an array, the parameters of perMessageDeflate", async () => {
      await using peer = await createPeer();
      using client = connect(`ws://${nowhere}:1234/x`, {
        createConnection: () => toPeer(peer),
        headers: { "X-Multi": ["a", "b"] },
        perMessageDeflate: { serverNoContextTakeover: true, clientMaxWindowBits: 10 },
      });
      const lines = (await peer.connection()).headLines.filter(line =>
        /^(x-multi|sec-websocket-extensions):/i.test(line),
      );
      expect(lines.sort()).toEqual([
        "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_max_window_bits=10",
        "X-Multi: a",
        "X-Multi: b",
      ]);
    });

    test("frames in the packet of the 101 are delivered after 'open'", async () => {
      await using peer = await createPeer({
        afterUpgrade: Buffer.concat([encodeFrame(OP.text, "early"), encodeFrame(OP.binary, Buffer.from([1, 2]))]),
      });
      using client = connect(`ws://${nowhere}:1234/x`, { createConnection: () => toPeer(peer) });
      expect(await (await peer.connection()).roundTrip()).toEqual([]);
      expect(client.events).toEqual([
        ...opening,
        'message Buffer("early") text rs=1',
        "message Buffer(0x0102) binary rs=1",
      ]);
    });

    // Without an agent the timer is that of the socket, and node:net sets it.
    test.each([
      {
        by: "createConnection() that hands `timeout` to node:net",
        options: (peer: Peer, made: (stream: net.Socket) => net.Socket) => ({
          createConnection: ({ timeout }: { timeout: number }) =>
            made(net.connect({ port: peer.port, host: "127.0.0.1", timeout })),
        }),
      },
      {
        by: "the createConnection() of an agent",
        options: (peer: Peer, made: (stream: net.Socket) => net.Socket) => ({
          agent: agentWith(() => made(toPeer(peer))),
        }),
      },
    ])("handshakeTimeout, with $by", async ({ options }) => {
      await using peer = await createPeer({ respond: () => null });
      let stream!: net.Socket;
      using client = connect(`ws://${nowhere}:1234/x`, {
        handshakeTimeout: 50,
        ...options(peer, made => (stream = made)),
      });
      await event(client.ws, "close");
      expect(client.events).toEqual(['error Error "Opening handshake has timed out" rs=2', lost]);
      expect(stream.destroyed).toBe(true);
      expect(await (await peer.connection()).rest()).toEqual([]);
    });

    test("followRedirects: it makes the next connection too", async () => {
      await using target = await createPeer();
      const location = `ws://b.${nowhere}:${target.port}/dest`;
      await using peer = await createPeer({
        respond: () => `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 0\r\n\r\n`,
      });
      const calls: string[] = [];
      using client = connect(`ws://a.${nowhere}:${peer.port}/x`, {
        followRedirects: true,
        createConnection: byPort(calls),
      });
      const { ws, events } = client;
      ws.on("redirect", (url, request) => events.push(`redirect ${url} ${show(request)}`));
      await event(ws, "open");
      expect(events).toEqual([`redirect ${location} ClientRequest`, ...opening]);
      expect(calls).toEqual([`a.${nowhere}:${peer.port}`, `b.${nowhere}:${target.port}`]);
      expect(ws.url).toBe(location);
      const conn = await target.connection();
      expect([conn.headLines[0], conn.header("host")]).toEqual(["GET /dest HTTP/1.1", `b.${nowhere}:${target.port}`]);
      // The first connection is given up.
      expect(await (await peer.connection()).rest()).toEqual([]);
    });

    test("'upgrade' gets the response, on that stream", async () => {
      await using peer = await createPeer({ headers: ["X-Server: raw", "Set-Cookie: a=1", "Set-Cookie: b=2"] });
      let stream!: net.Socket;
      using client = connect(`ws://${nowhere}:1234/x`, { createConnection: () => (stream = toPeer(peer)) });
      const [response, ...rest] = (await event(client.ws, "upgrade")) as [http.IncomingMessage];
      expect(rest).toEqual([]);
      expect(response).toBeInstanceOf(http.IncomingMessage);
      expect({
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        server: response.headers["x-server"],
        cookies: response.headers["set-cookie"],
        socket: response.socket === stream,
      }).toEqual({
        statusCode: 101,
        statusMessage: "Switching Protocols",
        server: "raw",
        cookies: ["a=1", "b=2"],
        socket: true,
      });
    });

    test("an answer that is not acceptable: 'upgrade', 'error', 'close' 1006, and the stream is destroyed", async () => {
      await using peer = await createPeer({
        respond: (conn: RawSocket) => response101(conn, [], { "Sec-WebSocket-Accept": "CxYS6+NgJSBG74mdgLvGscRvpns=" }),
      });
      let stream!: net.Socket;
      using client = connect(`ws://${nowhere}:1234/x`, { createConnection: () => (stream = toPeer(peer)) });
      await event(client.ws, "close");
      expect(client.events).toEqual([
        "upgrade 101 rs=0",
        'error Error "Invalid Sec-WebSocket-Accept header" rs=2',
        lost,
      ]);
      expect(stream.destroyed).toBe(true);
      expect(await (await peer.connection()).rest()).toEqual([]);
    });

    test("'unexpected-response' gets the request and the response with its body", async () => {
      await using peer = await createPeer({ respond: () => "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno" });
      using client = connect(`ws://${nowhere}:1234/x`, { createConnection: () => toPeer(peer) });
      const { ws, events } = client;
      const [request, response, ...rest] = await event(ws, "unexpected-response");
      expect(rest).toEqual([]);
      expect(request).toBeInstanceOf(http.ClientRequest);
      expect(request).toBe((ws as any)._req);
      expect(response).toBeInstanceOf(http.IncomingMessage);
      expect(response.statusCode).toBe(403);
      expect(Buffer.concat(await response.toArray()).toString()).toBe("no");
      // What becomes of the socket is up to the listener.
      expect({ events, readyState: ws.readyState }).toEqual({ events: [], readyState: WebSocket.CONNECTING });
      ws.terminate();
      await event(ws, "close");
      expect(events).toEqual(['error Error "WebSocket was closed before the connection was established" rs=2', lost]);
    });

    test("without that listener: 'error' with the status, 'close' 1006", async () => {
      await using peer = await createPeer({ respond: () => "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno" });
      using client = connect(`ws://${nowhere}:1234/x`, { createConnection: () => toPeer(peer) });
      await event(client.ws, "close");
      expect(client.events).toEqual(['error Error "Unexpected server response: 403" rs=2', lost]);
      expect(await (await peer.connection()).rest()).toEqual([]);
    });

    test("close() before the answer", async () => {
      await using peer = await createPeer({ respond: () => null });
      let stream!: net.Socket;
      using client = connect(`ws://${nowhere}:1234/x`, { createConnection: () => (stream = toPeer(peer)) });
      const conn = await peer.connection();
      client.ws.close();
      await event(client.ws, "close");
      expect(client.events).toEqual([
        'error Error "WebSocket was closed before the connection was established" rs=2',
        lost,
      ]);
      expect(stream.destroyed).toBe(true);
      expect(await conn.rest()).toEqual([]);
    });
  });

  describe("signal", () => {
    // The class is AbortError on Node. Bun's node:http makes an Error with that name.
    const aborted = ['error "The operation was aborted" ABORT_ERR rs=2', lost];
    const reason = new Error("my reason");

    /** The events of a client that fails, and whether `cause` of its error is the reason of the signal. */
    async function failure(client: ReturnType<typeof connect>, signal: AbortSignal) {
      const [[error]] = await Promise.all([event(client.ws, "error"), event(client.ws, "close")]);
      const events = client.events.map(line => line.replace(/^error \w+ /, "error "));
      return { events, name: error.name, cause: error.cause === signal.reason };
    }
    const failed = { events: aborted, name: "AbortError", cause: true };

    test.each([
      { when: "aborted before the constructor", signal: () => AbortSignal.abort() },
      { when: "aborted with a reason before the constructor", signal: () => AbortSignal.abort(reason) },
    ])("$when: the constructor returns, then 'error' and 'close' 1006, and no request goes out", async row => {
      await using peer = await createPeer();
      const signal = row.signal();
      using client = connect(peer.url + "/aborted", { signal });
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      expect(await failure(client, signal)).toEqual(failed);
      using control = connect(peer.url + "/control", {});
      expect((await peer.connection()).headLines[0]).toBe("GET /control HTTP/1.1");
    });

    test("abort() right after the constructor: no request goes out", async () => {
      await using peer = await createPeer();
      const controller = new AbortController();
      using client = connect(peer.url + "/aborted", { signal: controller.signal });
      controller.abort();
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      expect(await failure(client, controller.signal)).toEqual(failed);
      using control = connect(peer.url + "/control", {});
      expect((await peer.connection()).headLines[0]).toBe("GET /control HTTP/1.1");
    });

    test.each([
      { call: "abort()", args: [] },
      { call: "abort(reason)", args: [reason] },
    ])("$call while the server holds its answer: 'error', 'close' 1006, and the connection ends", async ({ args }) => {
      await using peer = await createPeer({ respond: () => null });
      const controller = new AbortController();
      using client = connect(peer.url, { signal: controller.signal });
      const conn = await peer.connection();
      controller.abort(...args);
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      expect(await failure(client, controller.signal)).toEqual(failed);
      expect(await conn.rest()).toEqual([]);
    });

    test("AbortSignal.timeout() while the server holds its answer", async () => {
      await using peer = await createPeer({ respond: () => null });
      const signal = AbortSignal.timeout(20);
      using client = connect(peer.url, { signal });
      expect(await failure(client, signal)).toEqual(failed);
      expect((signal.reason as Error).name).toBe("TimeoutError");
    });

    test("abort() once the socket is open does nothing", async () => {
      await using peer = await createPeer();
      const controller = new AbortController();
      using client = connect(peer.url, { signal: controller.signal });
      const conn = await peer.connection();
      expect(await conn.roundTrip()).toEqual([]);
      controller.abort();
      expect(await conn.roundTrip()).toEqual([]);
      expect([client.ws.readyState, ...client.events]).toEqual([WebSocket.OPEN, ...opening]);
    });

    test("what is no AbortSignal makes the constructor throw", () => {
      expect(attempt(() => new WebSocket("ws://127.0.0.1:1", { signal: {} } as {})).replace(/ ".*"/, "")).toBe(
        "throws TypeError ERR_INVALID_ARG_TYPE",
      );
    });
  });

  describe("secureContext", () => {
    const { cert, key } = certificate;
    const refused = ["error Error DEPTH_ZERO_SELF_SIGNED_CERT rs=2", lost];
    const garbage = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";

    test.each([
      {
        label: "with the `ca`",
        options: () => ({ secureContext: tls.createSecureContext({ ca: cert }) }),
        events: opening,
      },
      { label: "without a `ca`", options: () => ({ secureContext: tls.createSecureContext({}) }), events: refused },
      // It stands for all the options it was made from. The same options next to it do not count.
      {
        label: "with the `ca`, next to a `ca` that is none",
        options: () => ({ secureContext: tls.createSecureContext({ ca: cert }), ca: garbage }),
        events: opening,
      },
      {
        label: "without a `ca`, next to the `ca`",
        options: () => ({ secureContext: tls.createSecureContext({}), ca: cert }),
        events: refused,
      },
    ])("$label", async ({ options, events }) => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url, options());
      await Promise.race([event(client.ws, "open"), event(client.ws, "close")]);
      expect(client.events.map(withoutMessage)).toEqual(events);
    });

    test.each([
      {
        label: "with `cert` and `key`",
        context: { ca: cert, cert, key },
        seen: { authorized: true, name: "server-bun" },
      },
      { label: "without them", context: { ca: cert }, seen: { authorized: false, name: undefined } },
    ])("$label, and a server that asks for a certificate", async ({ context, seen }) => {
      await using peer = await createPeer({
        secure: true,
        tls: { requestCert: true, rejectUnauthorized: false, ca: cert },
      });
      using client = connect(peer.url, { secureContext: tls.createSecureContext(context) });
      await event(client.ws, "open");
      const socket = (await peer.connection()).socket as tls.TLSSocket;
      expect({ authorized: socket.authorized, name: socket.getPeerCertificate().subject?.CN }).toEqual(seen);
    });
  });
});
