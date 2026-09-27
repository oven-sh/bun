import { connect, listen, SocketHandler, TCPSocketListener } from "bun";
import { getEventLoopStats } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as cert } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

type Resolve = (value?: unknown) => void;
type Reject = (reason?: any) => void;
const decoder = new TextDecoder();

it("remoteAddress works", async () => {
  var resolve: Resolve, reject: Reject;
  var remaining = 2;
  var prom = new Promise<void>((resolve1, reject1) => {
    resolve = () => {
      if (--remaining === 0) resolve1();
    };
    reject = reject1;
  });
  using server = Bun.listen({
    socket: {
      open(ws) {
        try {
          expect(ws.remoteAddress).toBe("127.0.0.1");
          resolve();
        } catch (e) {
          reject(e);

          return;
        }
      },
      close() {},
      data() {},
    },
    port: 0,
    hostname: "127.0.0.1",
  });

  await Bun.connect({
    socket: {
      open(ws) {
        try {
          // windows returns the ipv6 address
          expect(ws.remoteAddress).toMatch(/127.0.0.1/);
          resolve();
        } catch (e) {
          reject(e);
          return;
        } finally {
          ws.end();
        }
      },
      data() {},
      close() {},
    },
    hostname: server.hostname,
    port: server.port,
  });
  await prom;
});

it("should not allow invalid tls option", () => {
  [1, "string", Symbol("symbol")].forEach(value => {
    expect(() => {
      // @ts-ignore
      using server = Bun.listen({
        socket: {
          open(ws) {},
          close() {},
          data() {},
        },
        port: 0,
        hostname: "localhost",
        tls: value,
      });
    }).toThrow("TLSOptions must be an object");
  });
});

it("should allow using false, null or undefined tls option", () => {
  [false, null, undefined].forEach(value => {
    expect(() => {
      // @ts-ignore
      using server = Bun.listen({
        socket: {
          open(ws) {},
          close() {},
          data() {},
        },
        port: 0,
        hostname: "localhost",
        tls: value,
      });
    }).not.toThrow("TLSOptions must be an object");
  });
});

it("echo server 1 on 1", async () => {
  // wrap it in a separate closure so the GC knows to clean it up
  // the sockets & listener don't escape the closure
  await (async function () {
    let resolve: Resolve, reject: Reject, serverResolve: Resolve, serverReject: Reject;
    const prom = new Promise((resolve1, reject1) => {
      resolve = resolve1;
      reject = reject1;
    });
    const serverProm = new Promise((resolve1, reject1) => {
      serverResolve = resolve1;
      serverReject = reject1;
    });

    let serverData: any, clientData: any;
    const handlers = {
      open(socket) {
        socket.data.counter = 1;
        if (!socket.data?.isServer) {
          clientData = socket.data;
          clientData.sendQueue = ["client: Hello World! " + 0];
          if (!socket.write("client: Hello World! " + 0)) {
            socket.data = { pending: "server: Hello World! " + 0 };
          }
        } else {
          serverData = socket.data;
          serverData.sendQueue = ["server: Hello World! " + 0];
        }

        if (clientData) clientData.other = serverData;
        if (serverData) serverData.other = clientData;
        if (clientData) clientData.other = serverData;
        if (serverData) serverData.other = clientData;
      },
      data(socket, buffer) {
        const msg = `${socket.data.isServer ? "server:" : "client:"} Hello World! ${socket.data.counter++}`;
        socket.data.sendQueue.push(msg);

        expect(decoder.decode(buffer)).toBe(socket.data.other.sendQueue.pop());

        if (socket.data.counter > 10) {
          if (!socket.data.finished) {
            socket.data.finished = true;
            if (socket.data.isServer) {
              setTimeout(() => {
                serverResolve();
                socket.end();
              }, 1);
            } else {
              setTimeout(() => {
                resolve();
                socket.end();
              }, 1);
            }
          }
        }

        if (!socket.write(msg)) {
          socket.data.pending = msg;
          return;
        }
      },
      error(socket, error) {
        reject(error);
      },
      drain(socket) {
        reject(new Error("Unexpected backpressure"));
      },
    } as SocketHandler<any>;

    using server: TCPSocketListener<any> | undefined = listen({
      socket: handlers,
      hostname: "127.0.0.1",
      port: 0,

      data: {
        isServer: true,
        counter: 0,
      },
    });
    const clientProm = connect({
      socket: handlers,
      hostname: "127.0.0.1",
      port: server.port,
      data: {
        counter: 0,
      },
    });
    await Promise.all([prom, clientProm, serverProm]);
  })();
});

describe("tcp socket binaryType", () => {
  const binaryType = ["arraybuffer", "uint8array", "buffer"] as const;
  for (const type of binaryType) {
    it(type, async () => {
      // wrap it in a separate closure so the GC knows to clean it up
      // the sockets & listener don't escape the closure
      await (async function () {
        let resolve: Resolve, reject: Reject, serverResolve: Resolve, serverReject: Reject;
        const prom = new Promise((resolve1, reject1) => {
          resolve = resolve1;
          reject = reject1;
        });
        const serverProm = new Promise((resolve1, reject1) => {
          serverResolve = resolve1;
          serverReject = reject1;
        });

        let serverData: any, clientData: any;
        const handlers = {
          open(socket) {
            socket.data.counter = 1;
            if (!socket.data?.isServer) {
              clientData = socket.data;
              clientData.sendQueue = ["client: Hello World! " + 0];
              if (!socket.write("client: Hello World! " + 0)) {
                socket.data = { pending: "server: Hello World! " + 0 };
              }
            } else {
              serverData = socket.data;
              serverData.sendQueue = ["server: Hello World! " + 0];
            }

            if (clientData) clientData.other = serverData;
            if (serverData) serverData.other = clientData;
            if (clientData) clientData.other = serverData;
            if (serverData) serverData.other = clientData;
          },
          data(socket, buffer) {
            expect(
              buffer instanceof
                (type === "arraybuffer"
                  ? ArrayBuffer
                  : type === "uint8array"
                    ? Uint8Array
                    : type === "buffer"
                      ? Buffer
                      : Error),
            ).toBe(true);
            const msg = `${socket.data.isServer ? "server:" : "client:"} Hello World! ${socket.data.counter++}`;
            socket.data.sendQueue.push(msg);

            expect(decoder.decode(buffer)).toBe(socket.data.other.sendQueue.pop());

            if (socket.data.counter > 10) {
              if (!socket.data.finished) {
                socket.data.finished = true;
                if (socket.data.isServer) {
                  setTimeout(() => {
                    serverResolve();
                    socket.end();
                  }, 1);
                } else {
                  setTimeout(() => {
                    resolve();
                    socket.end();
                  }, 1);
                }
              }
            }

            if (!socket.write(msg)) {
              socket.data.pending = msg;
              return;
            }
          },
          error(socket, error) {
            reject(error);
          },
          drain(socket) {
            reject(new Error("Unexpected backpressure"));
          },

          binaryType: type,
        } as SocketHandler<any>;

        using server: TCPSocketListener<any> | undefined = listen({
          socket: handlers,
          hostname: "127.0.0.1",
          port: 0,
          data: {
            isServer: true,
            counter: 0,
          },
        });

        const clientProm = connect({
          socket: handlers,
          hostname: "127.0.0.1",
          port: server.port,
          data: {
            counter: 0,
          },
        });

        await Promise.all([prom, clientProm, serverProm]);
      })();
    });
  }
});

it("should not leak memory", async () => {
  // The fixture counts live Listener and TCPSocket objects after the sockets
  // close. The count is heap-wide, and under `bun test --parallel` this
  // process also holds the previous file's global (its own TCPSocket
  // prototype, and any sockets it left behind), so the fixture runs alone.
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "tcp-server-leak-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

it("a TLS socket that waits in the low-priority queue times out", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "tls-parked-timeout-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ opened: 20, timedOut: 20 }),
    stderr: "",
    exitCode: 0,
  });
}, // The fixture blocks for the 4 s between two timeout sweeps.
30_000);

describe("a listener accepts one connection per event loop iteration", () => {
  const count = 12;
  const request = "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
  // The first byte of a TLS handshake record. The server waits for the rest of the record.
  const handshakeStart = "\x16";

  type Arrived = (label?: string) => void;
  type Listener = { target: object; first?: string; stop: () => unknown };

  let clients: Worker;
  let pending: PromiseWithResolvers<unknown>;
  // The next message of the Worker. Call it before the loop runs again.
  const reply = () => (pending = Promise.withResolvers()).promise;
  beforeAll(async () => {
    clients = new Worker(join(import.meta.dir, "accept-per-turn-clients-fixture.ts"));
    clients.onmessage = event => pending.resolve(event.data);
    clients.onerror = event => pending.reject(event);
    expect(await reply()).toBe("ready");
  });
  afterAll(() => clients.terminate());

  // No JS runs when an HTTP listener with TLS accepts, and its handshakes have a budget per
  // iteration of their own. What an accept changes for JS to see is the number of polls of the
  // loop, read once per iteration. The clients never finish their handshake.
  function watchPolls(arrived: Arrived) {
    let last = getEventLoopStats().numPolls;
    let seen = 0;
    (function sample() {
      for (const { numPolls } = getEventLoopStats(); last < numPolls; last++, seen++) arrived();
      if (seen < count) setImmediate(sample);
    })();
  }

  async function nodeServer(server: net.Server, unix: string | undefined, first?: string): Promise<Listener> {
    if (unix) server.listen(unix);
    else server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      target: unix ? { unix } : { hostname: "127.0.0.1", port: (server.address() as net.AddressInfo).port },
      first,
      stop() {
        server.close();
        (server as http.Server).closeAllConnections?.();
      },
    };
  }

  function netServer(arrived: Arrived, unix?: string, options: net.ServerOpts = {}) {
    const sockets: net.Socket[] = [];
    const server = net.createServer(options, socket => {
      socket.on("error", () => {});
      sockets.push(socket);
      arrived(socket.isPaused() ? "paused" : "c");
    });
    server.on("drop", () => arrived("d"));
    server.on("close", () => sockets.forEach(socket => socket.destroy()));
    return { server, listening: nodeServer(server, unix) };
  }

  const address = (server: { port?: number }, unix?: string) =>
    unix ? { unix } : { hostname: "127.0.0.1", port: server.port };

  function serve(arrived: Arrived, unix?: string, secure = false): Listener {
    const server = Bun.serve({
      ...(unix ? { unix } : { port: 0, hostname: "127.0.0.1" }),
      tls: secure ? cert : undefined,
      fetch() {
        arrived();
        return new Response("hello");
      },
    });
    return { target: address(server, unix), first: secure ? handshakeStart : request, stop: () => server.stop(true) };
  }

  function bunListen(arrived: Arrived, unix?: string, secure = false): Listener {
    const server = Bun.listen({
      ...(unix ? { unix } : { port: 0, hostname: "127.0.0.1" }),
      tls: secure ? cert : undefined,
      socket: {
        // With TLS this is still the accept: `handshake` is what waits for the peer.
        open: () => arrived(),
        handshake() {},
        data() {},
        error() {},
      },
    });
    return { target: address(server, unix), stop: () => server.stop(true) };
  }

  const kinds: Record<string, (arrived: Arrived, unix: string) => Listener | Promise<Listener>> = {
    "Bun.serve": arrived => serve(arrived),
    "Bun.serve unix": (arrived, unix) => serve(arrived, unix),
    "Bun.serve tls": arrived => serve(arrived, undefined, true),
    "Bun.listen": arrived => bunListen(arrived),
    "Bun.listen unix": (arrived, unix) => bunListen(arrived, unix),
    "Bun.listen tls": arrived => bunListen(arrived, undefined, true),
    "node:http": arrived =>
      nodeServer(
        http.createServer((req, res) => (arrived(), res.end("hello"))),
        undefined,
        request,
      ),
    "node:http unix": (arrived, unix) =>
      nodeServer(
        http.createServer((req, res) => (arrived(), res.end("hello"))),
        unix,
        request,
      ),
    "node:https": arrived =>
      nodeServer(
        https.createServer(cert, (req, res) => (arrived(), res.end("hello"))).on("tlsClientError", () => {}),
        undefined,
        handshakeStart,
      ),
    "node:net": arrived => netServer(arrived).listening,
    "node:net unix": (arrived, unix) => netServer(arrived, unix).listening,
    "node:net pauseOnConnect": arrived => netServer(arrived, undefined, { pauseOnConnect: true }).listening,
    // The first client holds the one connection the server allows: 'drop' for each of the rest.
    "node:net maxConnections": arrived => {
      const { server, listening } = netServer(arrived);
      server.maxConnections = 1;
      return listening;
    },
    // 'connection' is the accept of a tls.Server too. 'secureConnection' is the handshake.
    "node:tls": arrived =>
      nodeServer(
        tls
          .createServer(cert)
          .on("tlsClientError", () => {})
          .on("connection", socket => (socket.on("error", () => {}), arrived())),
        undefined,
        handshakeStart,
      ),
  };

  // Starts a listener and puts `count` connections into its queue. Nothing accepts them before
  // this returns: the thread of the listener is blocked while the Worker connects them.
  async function queued(start: (typeof kinds)[string], arrived: Arrived) {
    const dir = tempDir("accept-per-turn", {});
    const listener = await start(arrived, join(String(dir), "listener.sock"));
    const signal = new Int32Array(new SharedArrayBuffer(4));
    clients.postMessage({ target: listener.target, count, first: listener.first ?? "", signal: signal.buffer });
    Atomics.wait(signal, 0, 0, 30_000);
    return {
      connected: Atomics.load(signal, 0) === 1,
      async [Symbol.asyncDispose]() {
        listener.stop();
        clients.postMessage("close");
        await reply();
        dir[Symbol.dispose]();
      },
    };
  }

  it.each(Object.keys(kinds).filter(kind => !(isWindows && kind.endsWith("unix"))))("%s", async kind => {
    const order: string[] = [];
    const { promise: done, resolve } = Promise.withResolvers<void>();
    let accepted = 0;
    const arrived: Arrived = (label = "c") => {
      const id = ++accepted;
      order.push(label + id);
      setImmediate(() => {
        order.push("i" + id);
        if (id === count) resolve();
      });
    };
    // The handlers of these two run after a handshake, which the clients do not finish.
    const acceptRunsNoJS = kind === "Bun.serve tls" || kind === "node:https";

    await using listener = await queued(kinds[kind], acceptRunsNoJS ? () => {} : arrived);
    expect(listener.connected).toBe(true);
    if (acceptRunsNoJS) watchPolls(arrived);
    await done;

    // Each connection, then the immediate its handler scheduled, then the next connection.
    const label = (id: number) => {
      if (kind === "node:net pauseOnConnect") return "paused" + id;
      return (kind === "node:net maxConnections" && id > 1 ? "d" : "c") + id;
    };
    expect(order).toEqual(Array.from({ length: count }, (_, i) => [label(i + 1), "i" + (i + 1)]).flat());
  });

  it("close() in the first 'connection' leaves the clients behind it in the queue", async () => {
    const order: string[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const server = net.createServer(socket => {
      socket.on("error", () => {});
      order.push("connection");
      socket.destroy();
      server.close(() => {
        order.push("close");
        resolve();
      });
    });

    await using listener = await queued(
      () => nodeServer(server, undefined),
      () => {},
    );
    expect(listener.connected).toBe(true);
    await closed;
    expect(order).toEqual(["connection", "close"]);
  });
});
