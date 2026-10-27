// `ws` client options that control how it connects: `createConnection`, `lookup`, `agent`, and the options passed
// through to node:net. The server is a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as certificate, isLinux } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";
import {
  abnormalClose,
  closedPort,
  createPeer,
  encodeFrame,
  implementations,
  nextEvent,
  OP,
  openEvents,
  type RawSocket,
  recordEvents,
  response101,
  show,
  stripMessage,
  tryCall,
} from "./ws-raw-peer";

const boomThenClose = ['error Error "boom" rs=2', abnormalClose];

// Can't be resolved, because DNS labels are limited to 63 characters. A client can only reach the server through the
// option under test.
const unresolvableHost = Buffer.alloc(64, "a") + ".invalid";

type Peer = Awaited<ReturnType<typeof createPeer>>;
type Callback = (error: Error | null, stream?: Duplex) => void;
type ConnectOptions = http.ClientRequestArgs;

const connectToPeer = (peer: Peer) => net.connect(peer.port, "127.0.0.1");
const tlsConnectToPeer = (peer: Peer) => tls.connect({ port: peer.port, host: "127.0.0.1", ca: certificate.cert });

/** Wraps `socket` in a plain Duplex that isn't a net.Socket. */
function wrapInDuplex(socket: net.Socket) {
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

/** An agent whose `createConnection()` is overridden. */
const agentWith = (
  createConnection: (options: ConnectOptions, callback: Callback) => Duplex | void,
  Agent = http.Agent,
) => Object.assign(new Agent(), { createConnection });

/** A SOCKS5 server without authentication. It ignores the requested address and always connects to `peer`. */
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
    /** An object rather than a URL, like `socks-proxy-agent`'s `proxy`. */
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

/** The client side of the SOCKS5 handshake. Sends the hostname to the proxy unresolved. */
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

// The three ways agents on npm override how a connection is made.
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
    shape: "createSocket() wrapping an async connect(), like agent-base 7",
    create: proxy =>
      new (class SocksAgent extends http.Agent {
        proxy = proxy;
        currentSocket: net.Socket | undefined;
        createSocket(req: http.ClientRequest, options: ConnectOptions, callback: Callback) {
          socksConnect(this.proxy, options).then(socket => {
            this.currentSocket = socket;
            (http.Agent.prototype as any).createSocket.call(this, req, options, callback);
          }, callback);
        }
        createConnection() {
          return this.currentSocket;
        }
      })(),
  },
  {
    shape: "addRequest() and req.onSocket() on an EventEmitter, like agent-base 6",
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

describe.each(implementations)("ws client connection options ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket } = implementation;

  /** A client with `watch()` attached. Disposing it calls terminate(). */
  function connect(url: string, options: object) {
    const ws = new WebSocket(url, options as {});
    return { ws, events: recordEvents(ws), [Symbol.dispose]: () => ws.terminate() };
  }

  type ConnectCase = {
    name: string;
    secure?: boolean;
    /** Options that connect to `peer`. They pass every stream they create through `track`. */
    options(peer: Peer, track: <Stream extends Duplex>(stream: Stream) => Stream): object;
  };
  const callbackOnConnect = (stream: net.Socket, callback: Callback) =>
    void stream.once("connect", () => callback(null, stream));

  describe.each([
    {
      name: "createConnection() returns a net.Socket",
      options: (peer, track) => ({ createConnection: () => track(connectToPeer(peer)) }),
    },
    {
      name: "createConnection() returns a Duplex that isn't a net.Socket",
      options: (peer, track) => ({ createConnection: () => track(wrapInDuplex(connectToPeer(peer))) }),
    },
    {
      name: "createConnection() calls back asynchronously",
      options: (peer, track) => ({
        createConnection: (options: ConnectOptions, callback: Callback) =>
          callbackOnConnect(track(connectToPeer(peer)), callback),
      }),
    },
    {
      name: "wss: createConnection() returns a tls.TLSSocket",
      secure: true,
      options: (peer, track) => ({ createConnection: () => track(tlsConnectToPeer(peer)) }),
    },
    {
      name: "agent.createConnection() returns a net.Socket",
      options: (peer, track) => ({ agent: agentWith(() => track(connectToPeer(peer))) }),
    },
    {
      name: "agent.createConnection() calls super.createConnection()",
      options: (peer, track) => ({
        agent: new (class extends http.Agent {
          createConnection(options: ConnectOptions, callback: Callback) {
            return track(super.createConnection({ ...options, host: "127.0.0.1" }, callback)!);
          }
        })(),
      }),
    },
    {
      name: "agent.createConnection() returns a Duplex that isn't a net.Socket",
      options: (peer, track) => ({ agent: agentWith(() => track(wrapInDuplex(connectToPeer(peer)))) }),
    },
    {
      name: "agent.createConnection() calls back asynchronously",
      options: (peer, track) => ({
        agent: agentWith((options, callback) => callbackOnConnect(track(connectToPeer(peer)), callback)),
      }),
    },
    {
      name: "wss: createConnection() on an https.Agent returns a tls.TLSSocket",
      secure: true,
      options: (peer, track) => ({ agent: agentWith(() => track(tlsConnectToPeer(peer)), https.Agent) }),
    },
  ] as ConnectCase[])("$name", ({ secure, options }) => {
    /** An OPEN client, the streams created for it, and `conn`, the raw server's end of the connection. */
    async function open() {
      const peer = await createPeer({ secure });
      const streams: Duplex[] = [];
      const track = <Stream extends Duplex>(stream: Stream) => (streams.push(stream), stream);
      const client = connect(`${secure ? "wss" : "ws"}://${unresolvableHost}:${peer.port}/x`, options(peer, track));
      const dispose = () => (client[Symbol.dispose](), peer[Symbol.asyncDispose]());
      await nextEvent(client.ws, "open");
      return { ...client, streams, conn: await peer.connection(), [Symbol.asyncDispose]: dispose };
    }

    test("uses the stream as `_socket`, exchanges messages and closes cleanly", async () => {
      await using client = await open();
      const { ws, events, streams, conn } = client;
      expect(streams).toHaveLength(1);
      expect((ws as any)._socket).toBe(streams[0]);
      expect(conn.headLines[0]).toBe("GET /x HTTP/1.1");
      expect(conn.header("host")).toStartWith(unresolvableHost + ":");

      ws.send("up");
      expect(await conn.next()).toBe('text "up"');
      conn.text("down");
      expect(await conn.roundTrip()).toEqual([]);

      ws.close(1000, "bye");
      expect(await conn.next()).toBe('close 1000 "bye"');
      conn.close(1000, "bye");
      conn.end();
      await nextEvent(ws, "close");
      expect(events).toEqual([...openEvents, 'message Buffer("down") text rs=1', 'close 1000 Buffer("bye") rs=3']);
      expect(await conn.next()).toBe("EOF");
      expect(streams[0].destroyed).toBe(true);
    });

    test("terminate() destroys the stream", async () => {
      await using client = await open();
      const { ws, events, streams, conn } = client;
      ws.terminate();
      expect(streams[0].destroyed).toBe(true);
      await nextEvent(ws, "close");
      expect(events).toEqual([...openEvents, abnormalClose]);
      expect(await conn.remainingFrames()).toEqual([]);
    });
  });

  describe("createConnection", () => {
    type Hook = (options: ConnectOptions, ...rest: unknown[]) => net.Socket;
    test.each([
      { name: "options.createConnection()", options: (createConnection: Hook) => ({ createConnection }) },
      {
        name: "agent.createConnection()",
        options: (createConnection: Hook) => ({ agent: agentWith(createConnection) }),
      },
    ])(
      "$name is called synchronously by the constructor with the URL's host and port and a callback",
      async ({ options }) => {
        await using peer = await createPeer();
        const calls: unknown[] = [];
        const hook: Hook = ({ host, port }, ...rest) => (
          calls.push({ host, port, rest: rest.map(show) }),
          connectToPeer(peer)
        );
        using client = connect(`ws://${unresolvableHost}:1234/x`, options(hook));
        expect(calls).toEqual([{ host: unresolvableHost, port: "1234", rest: ["function"] }]);
        await nextEvent(client.ws, "open");
        expect((await peer.connection()).header("host")).toBe(unresolvableHost + ":1234");
        expect(calls).toHaveLength(1);
      },
    );

    test.each([
      {
        agent: "an agent",
        create: (peer: Peer, calls: string[]) => agentWith(() => (calls.push("agent"), connectToPeer(peer))),
      },
      { agent: "`agent: false`", create: () => false },
    ])("the createConnection option is ignored with $agent", async ({ create }) => {
      await using peer = await createPeer();
      const calls: string[] = [];
      const agent = create(peer, calls);
      using client = connect(peer.url, {
        agent,
        createConnection: () => (calls.push("createConnection"), connectToPeer(peer)),
      });
      await nextEvent(client.ws, "open");
      expect(calls).toEqual(agent ? ["agent"] : []);
    });
  });

  describe("a failed connection emits 'error' with the original error, then 'close' 1006", () => {
    const error = new Error("boom");
    const fail = (options: ConnectOptions, callback: Callback) => void setImmediate(callback, error);

    test.each([
      {
        name: "createConnection() throws",
        options: {
          createConnection() {
            throw error;
          },
        },
      },
      { name: "createConnection() calls back with an error", options: { createConnection: fail } },
      { name: "agent.createConnection() calls back with an error", options: { agent: agentWith(fail) } },
      { name: "lookup() calls back with an error", options: { lookup: (...args: Callback[]) => args[2](error) } },
    ])("$name", async ({ options }) => {
      using client = connect(`ws://${unresolvableHost}:1234/x`, options);
      const [[reported]] = await Promise.all([nextEvent(client.ws, "error"), nextEvent(client.ws, "close")]);
      expect(reported).toBe(error);
      expect(client.events).toEqual(boomThenClose);
    });

    test("createConnection() returns a socket that gets ECONNREFUSED", async () => {
      const port = await closedPort();
      using client = connect(`ws://${unresolvableHost}:1234/x`, {
        createConnection: () => net.connect(port, "127.0.0.1"),
      });
      await nextEvent(client.ws, "close");
      expect(client.events).toEqual([
        'error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED rs=2',
        abnormalClose,
      ]);
    });

    test("the constructor throws when agent.createConnection() throws", () => {
      const agent = agentWith(() => {
        throw error;
      });
      expect(() =>
        new WebSocket(`ws://${unresolvableHost}:1234/x`, { agent }).on("error", () => {}).terminate(),
      ).toThrow(error);
    });
  });

  describe("lookup", () => {
    type LookupOptions = { family?: number; all?: boolean };
    type LookupCallback = (error: null, address: unknown, family?: number) => void;
    const resolveToLoopback =
      (calls: unknown[]) => (hostname: string, options: LookupOptions, callback: LookupCallback) => {
        calls.push({ hostname, family: options.family, all: options.all });
        if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
        else callback(null, "127.0.0.1", 4);
      };

    // node:net decides which `family` and `all` it passes to lookup().
    test.each([
      { label: "default options", options: {}, expected: { family: undefined, all: true } },
      { label: "family: 4", options: { family: 4 }, expected: { family: 4, all: undefined } },
      {
        label: "autoSelectFamily: false",
        options: { autoSelectFamily: false },
        expected: { family: undefined, all: undefined },
      },
    ])(
      "is called synchronously by the constructor, and the client connects to the address it returns ($label)",
      async ({ options, expected }) => {
        await using peer = await createPeer();
        const calls: unknown[] = [];
        using client = connect(`ws://${unresolvableHost}:${peer.port}/x`, {
          ...options,
          lookup: resolveToLoopback(calls),
        });
        expect(calls).toEqual([{ hostname: unresolvableHost, ...expected }]);
        await nextEvent(client.ws, "open");
        const conn = await peer.connection();
        expect(conn.header("host")).toBe(`${unresolvableHost}:${peer.port}`);
        expect((client.ws as any)._socket.remotePort).toBe(peer.port);
        client.ws.send("up");
        expect(await conn.next()).toBe('text "up"');
        expect(calls).toHaveLength(1);
        expect(client.events).toEqual(openEvents);
      },
    );

    test("wss: the certificate is still checked against the URL's hostname", async () => {
      await using peer = await createPeer({ secure: true });
      const url = `wss://${unresolvableHost}:${peer.port}/x`;
      using rejected = connect(url, { ca: certificate.cert, lookup: resolveToLoopback([]) });
      await nextEvent(rejected.ws, "close");
      expect(rejected.events.map(stripMessage)).toEqual([
        "error Error ERR_TLS_CERT_ALTNAME_INVALID rs=2",
        abnormalClose,
      ]);

      using client = connect(url, {
        ca: certificate.cert,
        checkServerIdentity: () => undefined,
        lookup: resolveToLoopback([]),
      });
      await nextEvent(client.ws, "open");
      expect(((await peer.connection()).socket as tls.TLSSocket).servername).toBe(unresolvableHost);
    });
  });

  // node:tls destroys the socket with the value the callback returned.
  test.each([
    ["an Error", Object.assign(new Error("pinned"), { code: "PINNED" })],
    ["a string", "pinned"],
  ])("'error' gets what checkServerIdentity returned: %s", async (_, verdict) => {
    await using peer = await createPeer({ secure: true });
    const errors: unknown[] = [];
    using client = connect(peer.url, { ca: certificate.cert, checkServerIdentity: () => verdict as Error });
    client.ws.on("error", error => errors.push(error));
    await nextEvent(client.ws, "close");
    expect(errors).toEqual([verdict]);
    expect(errors[0]).toBe(verdict);
  });

  test("checkServerIdentity keeps the AsyncLocalStorage store of the `new WebSocket()` call", async () => {
    await using peer = await createPeer({ secure: true });
    const storage = new AsyncLocalStorage<string>();
    const { promise: store, resolve } = Promise.withResolvers<string | undefined>();
    using client = storage.run("the caller's", () =>
      connect(peer.url, { ca: certificate.cert, checkServerIdentity: () => void resolve(storage.getStore()) }),
    );
    expect(await store).toBe("the caller's");
  });

  // The handshake runs from the event loop, whoever turns it. `expect().resolves` is deliberately not awaited: it
  // ticks the event loop until the promise settles, here inside a store. With npm ws, node:tls runs the callback there.
  test.skipIf(!builtin)(
    "checkServerIdentity of a socket made outside every store doesn't run in the store of a caller that ticks the event loop",
    async () => {
      await using peer = await createPeer({ secure: true });
      const storage = new AsyncLocalStorage<string>();
      const { promise: checked, resolve } = Promise.withResolvers<void>();
      let store: string | undefined;
      using client = connect(peer.url, {
        ca: certificate.cert,
        checkServerIdentity: () => {
          store = storage.getStore() ?? "no store";
          resolve();
        },
      });
      storage.run("the waiter's", () => void expect(checked).resolves.toBeUndefined());
      expect(store).toBe("no store");
    },
  );

  test("a checkServerIdentity verdict that rejectUnauthorized: false dropped isn't reported later", async () => {
    await using peer = await createPeer({
      secure: true,
      respond: () => "HTTP/1.1 500 Nope\r\nContent-Length: 0\r\n\r\n",
    });
    using client = connect(peer.url, {
      ca: certificate.cert,
      rejectUnauthorized: false,
      checkServerIdentity: () => new Error("pinned"),
    });
    await nextEvent(client.ws, "close");
    expect(client.events).toEqual(['error Error "Unexpected server response: 500" rs=2', abnormalClose]);
  });

  describe("options passed through to node:net", () => {
    test("family: 6 can't reach a server listening on 127.0.0.1", async () => {
      await using peer = await createPeer();
      using client = connect(`ws://localhost:${peer.port}/first`, { family: 6 });
      await Promise.race([nextEvent(client.ws, "open"), nextEvent(client.ws, "close")]);
      expect(client.events).toEqual([expect.stringMatching(/^error /), abnormalClose]);
      // The server never saw the first client. The first request it reads comes from the second one.
      using second = connect(`ws://localhost:${peer.port}/second`, { family: 4 });
      expect((await peer.connection()).headLines[0]).toBe("GET /second HTTP/1.1");
    });

    // Other platforms don't necessarily let you bind to 127.0.0.2.
    test.skipIf(!isLinux)("localAddress", async () => {
      await using peer = await createPeer();
      using client = connect(peer.url, { localAddress: "127.0.0.2" });
      await nextEvent(client.ws, "open");
      expect((await peer.connection()).socket.remoteAddress).toBe("127.0.0.2");
    });
  });

  describe("an agent that doesn't override how connections are made", () => {
    test.each([
      { agent: "new http.Agent()", create: () => new http.Agent() },
      { agent: "new http.Agent({ keepAlive: true })", create: () => new http.Agent({ keepAlive: true }) },
      { agent: "false", create: () => false },
    ] as { agent: string; create(): http.Agent | false }[])("agent: $agent", async ({ create }) => {
      await using peer = await createPeer();
      const agent = create();
      using client = connect(peer.url + "/x", { agent });
      const { ws, events } = client;
      await nextEvent(ws, "open");
      const conn = await peer.connection();
      expect(conn.headLines[0]).toBe("GET /x HTTP/1.1");
      expect(conn.header("connection")).toBe("Upgrade");
      // The agent no longer tracks the upgraded socket.
      if (agent) expect([agent.sockets, agent.freeSockets, agent.requests].map(Object.keys)).toEqual([[], [], []]);

      ws.send("up");
      expect(await conn.next()).toBe('text "up"');
      conn.text("down");
      conn.close(1000);
      conn.end();
      await nextEvent(ws, "close");
      expect(events).toEqual([...openEvents, 'message Buffer("down") text rs=1', "close 1000 Buffer() rs=3"]);
      expect(await conn.remainingFrames()).toEqual(["close 1000"]);
    });

    const certRejected = ["error Error DEPTH_ZERO_SELF_SIGNED_CERT rs=2", abnormalClose];
    test.each([
      { label: "none", agent: {}, options: {}, events: certRejected },
      { label: "rejectUnauthorized: false", agent: { rejectUnauthorized: false }, options: {}, events: openEvents },
      { label: "ca", agent: { ca: certificate.cert }, options: {}, events: openEvents },
      {
        label: "none, with `ca` in the client options",
        agent: {},
        options: { ca: certificate.cert },
        events: openEvents,
      },
      {
        label: "rejectUnauthorized: false overrides the client option",
        agent: { rejectUnauthorized: false },
        options: { rejectUnauthorized: true },
        events: openEvents,
      },
      {
        label: "rejectUnauthorized: true overrides the client option",
        agent: { rejectUnauthorized: true },
        options: { rejectUnauthorized: false },
        events: certRejected,
      },
    ])("https.Agent TLS options: $label", async ({ agent, options, events }) => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url, { ...options, agent: new https.Agent(agent) });
      await Promise.race([nextEvent(client.ws, "open"), nextEvent(client.ws, "close")]);
      expect(client.events.map(stripMessage)).toEqual(events);
    });
  });

  describe("SOCKS agents, which connect on their own and set `proxy` to an object", () => {
    describe.each(socksAgents)("$shape", ({ create }) => {
      test("connects through the proxy and sends it the unresolved hostname", async () => {
        await using peer = await createPeer();
        await using socks = await createSocksServer(peer);
        using client = connect(`ws://${unresolvableHost}:1234/x`, { agent: create(socks.proxy) });
        const { ws, events } = client;
        await nextEvent(ws, "open");
        const conn = await peer.connection();
        expect(socks.requests).toEqual([`CONNECT ${unresolvableHost}:1234`]);
        expect(socks.localPorts).toEqual([conn.socket.remotePort]);
        expect((ws as any)._socket.remotePort).toBe(socks.proxy.port);
        expect(conn.headLines[0]).toBe("GET /x HTTP/1.1");
        expect(conn.header("host")).toBe(unresolvableHost + ":1234");

        ws.send("up");
        expect(await conn.next()).toBe('text "up"');
        conn.text("down");
        expect(await conn.roundTrip()).toEqual([]);
        ws.close(1000);
        expect(await conn.next()).toBe("close 1000");
        conn.close(1000);
        conn.end();
        await nextEvent(ws, "close");
        expect(events).toEqual([...openEvents, 'message Buffer("down") text rs=1', "close 1000 Buffer() rs=3"]);
        expect(peer.connections).toHaveLength(1);
      });

      test("emits the agent's error when the proxy is down and doesn't fall back to a direct connection", async () => {
        await using peer = await createPeer();
        const agent = create({ host: "127.0.0.1", port: await closedPort(), type: 5 });
        using client = connect(peer.url + "/first", { agent });
        await nextEvent(client.ws, "close");
        expect(client.events).toEqual([
          'error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED rs=2',
          abnormalClose,
        ]);
        // The server never saw the first client. The first request it reads comes from the second one.
        using second = connect(peer.url + "/second", {});
        expect((await peer.connection()).headLines[0]).toBe("GET /second HTTP/1.1");
      });
    });

    test("wss: tunnels TLS through the proxy", async () => {
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
      using client = connect(`wss://${unresolvableHost}/x`, { agent });
      await nextEvent(client.ws, "open");
      const conn = await peer.connection();
      expect(socks.requests).toEqual([`CONNECT ${unresolvableHost}:443`]);
      expect(socks.localPorts).toEqual([conn.socket.remotePort]);
      client.ws.send("up");
      expect(await conn.next()).toBe('text "up"');
    });
  });

  describe("handshake over a createConnection() stream", () => {
    // Ignores the host and connects to the port on 127.0.0.1.
    const connectToLocalPort = (calls: string[]) => (options: ConnectOptions) => {
      calls.push(`${options.host}:${options.port}`);
      return net.connect(Number(options.port), "127.0.0.1");
    };

    test("the request has one header line per array element and the perMessageDeflate parameters", async () => {
      await using peer = await createPeer();
      using client = connect(`ws://${unresolvableHost}:1234/x`, {
        createConnection: () => connectToPeer(peer),
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

    test("frames in the same packet as the 101 are delivered after 'open'", async () => {
      await using peer = await createPeer({
        afterUpgrade: Buffer.concat([encodeFrame(OP.text, "early"), encodeFrame(OP.binary, Buffer.from([1, 2]))]),
      });
      using client = connect(`ws://${unresolvableHost}:1234/x`, { createConnection: () => connectToPeer(peer) });
      expect(await (await peer.connection()).roundTrip()).toEqual([]);
      expect(client.events).toEqual([
        ...openEvents,
        'message Buffer("early") text rs=1',
        "message Buffer(0x0102) binary rs=1",
      ]);
    });

    // Without an agent, nothing sets the socket's timer unless createConnection() passes `timeout` on to node:net.
    test.each([
      {
        name: "a createConnection() that passes `timeout` to node:net",
        options: (peer: Peer, track: (stream: net.Socket) => net.Socket) => ({
          createConnection: ({ timeout }: { timeout: number }) =>
            track(net.connect({ port: peer.port, host: "127.0.0.1", timeout })),
        }),
      },
      {
        name: "agent.createConnection()",
        options: (peer: Peer, track: (stream: net.Socket) => net.Socket) => ({
          agent: agentWith(() => track(connectToPeer(peer))),
        }),
      },
    ])("handshakeTimeout works with $name", async ({ options }) => {
      await using peer = await createPeer({ respond: () => null });
      let stream!: net.Socket;
      using client = connect(`ws://${unresolvableHost}:1234/x`, {
        handshakeTimeout: 50,
        ...options(peer, created => (stream = created)),
      });
      await nextEvent(client.ws, "close");
      expect(client.events).toEqual(['error Error "Opening handshake has timed out" rs=2', abnormalClose]);
      expect(stream.destroyed).toBe(true);
      expect(await (await peer.connection()).remainingFrames()).toEqual([]);
    });

    test("followRedirects: createConnection() is also called for the redirect target", async () => {
      await using target = await createPeer();
      const location = `ws://b.${unresolvableHost}:${target.port}/dest`;
      await using peer = await createPeer({
        respond: () => `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 0\r\n\r\n`,
      });
      const calls: string[] = [];
      using client = connect(`ws://a.${unresolvableHost}:${peer.port}/x`, {
        followRedirects: true,
        createConnection: connectToLocalPort(calls),
      });
      const { ws, events } = client;
      ws.on("redirect", (url, request) => events.push(`redirect ${url} ${show(request)}`));
      await nextEvent(ws, "open");
      expect(events).toEqual([`redirect ${location} ClientRequest`, ...openEvents]);
      expect(calls).toEqual([`a.${unresolvableHost}:${peer.port}`, `b.${unresolvableHost}:${target.port}`]);
      expect(ws.url).toBe(location);
      const conn = await target.connection();
      expect([conn.headLines[0], conn.header("host")]).toEqual([
        "GET /dest HTTP/1.1",
        `b.${unresolvableHost}:${target.port}`,
      ]);
      // The first connection is closed.
      expect(await (await peer.connection()).remainingFrames()).toEqual([]);
    });

    test("'upgrade' receives the response, whose socket is the stream", async () => {
      await using peer = await createPeer({ headers: ["X-Server: raw", "Set-Cookie: a=1", "Set-Cookie: b=2"] });
      let stream!: net.Socket;
      using client = connect(`ws://${unresolvableHost}:1234/x`, {
        createConnection: () => (stream = connectToPeer(peer)),
      });
      const [response, ...rest] = (await nextEvent(client.ws, "upgrade")) as [http.IncomingMessage];
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

    test("an invalid 101 emits 'upgrade', 'error' and 'close' 1006, and destroys the stream", async () => {
      await using peer = await createPeer({
        respond: (conn: RawSocket) => response101(conn, [], { "Sec-WebSocket-Accept": "CxYS6+NgJSBG74mdgLvGscRvpns=" }),
      });
      let stream!: net.Socket;
      using client = connect(`ws://${unresolvableHost}:1234/x`, {
        createConnection: () => (stream = connectToPeer(peer)),
      });
      await nextEvent(client.ws, "close");
      expect(client.events).toEqual([
        "upgrade 101 rs=0",
        'error Error "Invalid Sec-WebSocket-Accept header" rs=2',
        abnormalClose,
      ]);
      expect(stream.destroyed).toBe(true);
      expect(await (await peer.connection()).remainingFrames()).toEqual([]);
    });

    test("'unexpected-response' receives the request and the response, including its body", async () => {
      await using peer = await createPeer({ respond: () => "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno" });
      using client = connect(`ws://${unresolvableHost}:1234/x`, { createConnection: () => connectToPeer(peer) });
      const { ws, events } = client;
      const [request, response, ...rest] = await nextEvent(ws, "unexpected-response");
      expect(rest).toEqual([]);
      expect(request).toBeInstanceOf(http.ClientRequest);
      expect(request).toBe((ws as any)._req);
      expect(response).toBeInstanceOf(http.IncomingMessage);
      expect(response.statusCode).toBe(403);
      expect(Buffer.concat(await response.toArray()).toString()).toBe("no");
      // The listener is responsible for closing the socket.
      expect({ events, readyState: ws.readyState }).toEqual({ events: [], readyState: WebSocket.CONNECTING });
      ws.terminate();
      await nextEvent(ws, "close");
      expect(events).toEqual([
        'error Error "WebSocket was closed before the connection was established" rs=2',
        abnormalClose,
      ]);
    });

    test("without an 'unexpected-response' listener, emits 'error' with the status code, then 'close' 1006", async () => {
      await using peer = await createPeer({ respond: () => "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno" });
      using client = connect(`ws://${unresolvableHost}:1234/x`, { createConnection: () => connectToPeer(peer) });
      await nextEvent(client.ws, "close");
      expect(client.events).toEqual(['error Error "Unexpected server response: 403" rs=2', abnormalClose]);
      expect(await (await peer.connection()).remainingFrames()).toEqual([]);
    });

    test("close() before the server responds", async () => {
      await using peer = await createPeer({ respond: () => null });
      let stream!: net.Socket;
      using client = connect(`ws://${unresolvableHost}:1234/x`, {
        createConnection: () => (stream = connectToPeer(peer)),
      });
      const conn = await peer.connection();
      client.ws.close();
      await nextEvent(client.ws, "close");
      expect(client.events).toEqual([
        'error Error "WebSocket was closed before the connection was established" rs=2',
        abnormalClose,
      ]);
      expect(stream.destroyed).toBe(true);
      expect(await conn.remainingFrames()).toEqual([]);
    });
  });

  describe("signal", () => {
    // On Node the class is AbortError. Bun's node:http creates a plain Error with that name.
    const abortEvents = ['error "The operation was aborted" ABORT_ERR rs=2', abnormalClose];
    const reason = new Error("my reason");

    /** Waits for the client to fail. Returns its events and whether the error's `cause` is `signal.reason`. */
    async function waitForFailure(client: ReturnType<typeof connect>, signal: AbortSignal) {
      const [[error]] = await Promise.all([nextEvent(client.ws, "error"), nextEvent(client.ws, "close")]);
      const events = client.events.map(line => line.replace(/^error \w+ /, "error "));
      return { events, name: error.name, cause: error.cause === signal.reason };
    }
    const expectedFailure = { events: abortEvents, name: "AbortError", cause: true };

    test.each([
      { name: "an already aborted signal", signal: () => AbortSignal.abort() },
      { name: "a signal already aborted with a reason", signal: () => AbortSignal.abort(reason) },
    ])("$name emits 'error' and 'close' 1006 after the constructor returns, and sends no request", async row => {
      await using peer = await createPeer();
      const signal = row.signal();
      using client = connect(peer.url + "/aborted", { signal });
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      expect(await waitForFailure(client, signal)).toEqual(expectedFailure);
      using control = connect(peer.url + "/control", {});
      expect((await peer.connection()).headLines[0]).toBe("GET /control HTTP/1.1");
    });

    test("abort() right after the constructor sends no request", async () => {
      await using peer = await createPeer();
      const controller = new AbortController();
      using client = connect(peer.url + "/aborted", { signal: controller.signal });
      controller.abort();
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      expect(await waitForFailure(client, controller.signal)).toEqual(expectedFailure);
      using control = connect(peer.url + "/control", {});
      expect((await peer.connection()).headLines[0]).toBe("GET /control HTTP/1.1");
    });

    test.each([
      { call: "abort()", args: [] },
      { call: "abort(reason)", args: [reason] },
    ])(
      "$call before the server responds emits 'error' and 'close' 1006 and closes the connection",
      async ({ args }) => {
        await using peer = await createPeer({ respond: () => null });
        const controller = new AbortController();
        using client = connect(peer.url, { signal: controller.signal });
        const conn = await peer.connection();
        controller.abort(...args);
        expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
        expect(await waitForFailure(client, controller.signal)).toEqual(expectedFailure);
        expect(await conn.remainingFrames()).toEqual([]);
      },
    );

    test("AbortSignal.timeout() fires before the server responds", async () => {
      await using peer = await createPeer({ respond: () => null });
      const signal = AbortSignal.timeout(20);
      using client = connect(peer.url, { signal });
      expect(await waitForFailure(client, signal)).toEqual(expectedFailure);
      expect((signal.reason as Error).name).toBe("TimeoutError");
    });

    test("abort() is a no-op once the socket is open", async () => {
      await using peer = await createPeer();
      const controller = new AbortController();
      using client = connect(peer.url, { signal: controller.signal });
      const conn = await peer.connection();
      expect(await conn.roundTrip()).toEqual([]);
      controller.abort();
      expect(await conn.roundTrip()).toEqual([]);
      expect([client.ws.readyState, ...client.events]).toEqual([WebSocket.OPEN, ...openEvents]);
    });

    test("the constructor throws if `signal` isn't an AbortSignal", () => {
      expect(tryCall(() => new WebSocket("ws://127.0.0.1:1", { signal: {} } as {})).replace(/ ".*"/, "")).toBe(
        "throws TypeError ERR_INVALID_ARG_TYPE",
      );
    });
  });

  describe("secureContext", () => {
    const { cert, key } = certificate;
    const certRejected = ["error Error DEPTH_ZERO_SELF_SIGNED_CERT rs=2", abnormalClose];
    const invalidCa = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";

    test.each([
      {
        label: "the context has the `ca`",
        options: () => ({ secureContext: tls.createSecureContext({ ca: cert }) }),
        events: openEvents,
      },
      {
        label: "the context has no `ca`",
        options: () => ({ secureContext: tls.createSecureContext({}) }),
        events: certRejected,
      },
      // secureContext replaces the options it's built from, so a `ca` passed alongside it is ignored.
      {
        label: "the context has the `ca`, and an invalid `ca` option is ignored",
        options: () => ({ secureContext: tls.createSecureContext({ ca: cert }), ca: invalidCa }),
        events: openEvents,
      },
      {
        label: "the context has no `ca`, and a valid `ca` option is ignored",
        options: () => ({ secureContext: tls.createSecureContext({}), ca: cert }),
        events: certRejected,
      },
    ])("$label", async ({ options, events }) => {
      await using peer = await createPeer({ secure: true });
      using client = connect(peer.url, options());
      await Promise.race([nextEvent(client.ws, "open"), nextEvent(client.ws, "close")]);
      expect(client.events.map(stripMessage)).toEqual(events);
    });

    test.each([
      {
        label: "sends the context's `cert`",
        context: { ca: cert, cert, key },
        expected: { authorized: true, name: "server-bun" },
      },
      {
        label: "sends no certificate if the context has none",
        context: { ca: cert },
        expected: { authorized: false, name: undefined },
      },
    ])("$label when the server requests a client certificate", async ({ context, expected }) => {
      await using peer = await createPeer({
        secure: true,
        tls: { requestCert: true, rejectUnauthorized: false, ca: cert },
      });
      using client = connect(peer.url, { secureContext: tls.createSecureContext(context) });
      await nextEvent(client.ws, "open");
      const socket = (await peer.connection()).socket as tls.TLSSocket;
      expect({ authorized: socket.authorized, name: socket.getPeerCertificate().subject?.CN }).toEqual(expected);
    });
  });
});
