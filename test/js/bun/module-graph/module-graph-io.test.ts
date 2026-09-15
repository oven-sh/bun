// Bun.ModuleGraph({ isolateIO: true }) — the graph gets a context of its own
// for timers and I/O: what its code opens belongs to it, and dispose() closes all of it.
import { afterAll, describe, expect, test } from "bun:test";
import fs, { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import nodeTls from "node:tls";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { join } from "path";

const fixtureDirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const dir = String(tempDir("module-graph-io-", files));
  fixtureDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
});

/** Resolves once `condition()` is truthy; rejects after ~5s. */
async function until<T>(condition: () => T | Promise<T>): Promise<T> {
  for (let i = 0; i < 500; i++) {
    const value = await condition();
    if (value) return value;
    await Bun.sleep(10);
  }
  throw new Error("condition never became true");
}

/** Resolves after a 1ms host timer fired `turns` times: long enough for a live 1ms timer of a graph to have fired too. */
async function hostTimerTurns(turns = 5): Promise<void> {
  let fired = 0;
  const { promise, resolve } = Promise.withResolvers<void>();
  const interval = setInterval(() => {
    if (++fired >= turns) resolve();
  }, 1);
  try {
    await promise;
  } finally {
    clearInterval(interval);
  }
}

/** Whether something accepts TCP connections on `port`. */
async function accepts(port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/** Whether process `pid` still exists (a child that exited is gone once it has been reaped). */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.concurrent("ModuleGraph isolateIO", () => {
  test("option is validated; run() exists and validates", () => {
    expect(() => new Bun.ModuleGraph({ isolateIO: 1 as any })).toThrow(/isolateIO/);
    using graph = new Bun.ModuleGraph({ isolateIO: true });
    expect(graph.run((a, b) => a + b, 1, 2)).toBe(3);
    expect(() =>
      graph.run(() => {
        throw new RangeError("from fn");
      }),
    ).toThrow(RangeError);
    expect(() => graph.run(1 as any)).toThrow(/fn/);
    // Without a context of its own run() is just a call.
    using plain = new Bun.ModuleGraph();
    expect(plain.run(x => x * 2, 21)).toBe(42);
    // Either kind is a ModuleGraph, to `instanceof` and to a subclass.
    class Tenant extends Bun.ModuleGraph {
      tenant = "t1";
    }
    using tenant = new Tenant({ isolateIO: true });
    const prototypes = [Bun.ModuleGraph.prototype, Bun.ModuleGraph.prototype, Tenant.prototype];
    expect(
      [graph, plain, tenant].map((g, i) => [g instanceof Bun.ModuleGraph, Object.getPrototypeOf(g) === prototypes[i]]),
    ).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect([tenant instanceof Tenant, tenant.tenant, tenant.run(() => "ran")]).toEqual([true, "t1", "ran"]);
  });

  test("dispose() stops the graph's timers, not the host's", async () => {
    const dir = fixture({
      "timers.mjs": `
        export let ticks = 0, late = 0, immediates = 0;
        setInterval(() => { ticks++; }, 1);
        // Armed from a continuation: still the graph's.
        export const armLater = async () => {
          await Bun.sleep(1);
          setInterval(() => { late++; }, 1);
          const again = () => { immediates++; setImmediate(again); };
          setImmediate(again);
        };
        export const counts = () => ({ ticks, late, immediates });
      `,
    });
    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "timers.mjs"));
    await graph.run(() => app.armLater());
    await until(() => app.counts().ticks > 0 && app.counts().late > 0 && app.counts().immediates > 0);

    graph.dispose();
    const stopped = app.counts();
    await hostTimerTurns();
    expect(app.counts()).toEqual(stopped);
  });

  test("without isolateIO the graph's timers are the host's and outlive dispose()", async () => {
    const dir = fixture({
      "timers.mjs": `
        export let ticks = 0;
        export const interval = setInterval(() => { ticks++; }, 1);
        export const tick = () => ticks;
      `,
    });
    const graph = new Bun.ModuleGraph();
    const app = await graph.import(join(dir, "timers.mjs"));
    graph.dispose();
    try {
      const before = app.tick();
      await until(() => app.tick() > before + 2);
    } finally {
      clearInterval(app.interval);
    }
  });

  test("dispose() closes Bun.serve, Bun.listen and UDP sockets the graph opened", async () => {
    const dir = fixture({
      "servers.mjs": `
        const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("graph") });
        const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } });
        const udp = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
        export const ports = { http: server.port, tcp: listener.port, udp: udp.port };
      `,
    });
    using graph = new Bun.ModuleGraph({ isolateIO: true });
    const { ports } = await graph.import(join(dir, "servers.mjs"));
    expect(await fetch(`http://127.0.0.1:${ports.http}/`).then(r => r.text())).toBe("graph");
    expect(await accepts(ports.tcp)).toBe(true);

    graph.dispose();

    expect(await accepts(ports.http)).toBe(false);
    expect(await accepts(ports.tcp)).toBe(false);
    const rebound = await Bun.udpSocket({ hostname: "127.0.0.1", port: ports.udp });
    try {
      expect(rebound.port).toBe(ports.udp);
    } finally {
      rebound.close();
    }
  });

  test("dispose() closes the graph's client sockets and aborts its in-flight fetch; the graph hears nothing of it", async () => {
    const dir = fixture({
      "clients.mjs": `
        import net from "node:net";
        export const heard = [];
        export async function connect(tcpPort, httpPort) {
          const socket = await Bun.connect({ hostname: "127.0.0.1", port: tcpPort, socket: { data() {}, close() { heard.push("Bun.connect close"); } } });
          const ws = new WebSocket("ws://127.0.0.1:" + httpPort + "/ws");
          await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
          ws.onclose = () => heard.push("WebSocket close");
          const nodeSocket = await new Promise((resolve, reject) => { const s = net.connect(tcpPort, "127.0.0.1", () => resolve(s)); s.on("error", reject); });
          nodeSocket.on("close", () => heard.push("net.Socket close"));
          fetch("http://127.0.0.1:" + httpPort + "/hang").then(() => heard.push("fetch resolved"), () => heard.push("fetch rejected"));
        }
      `,
    });
    const tcpClosed = Promise.withResolvers<void>();
    const wsClosed = Promise.withResolvers<void>();
    const requestAborted = Promise.withResolvers<void>();
    const requestSeen = Promise.withResolvers<void>();
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {}, close: () => tcpClosed.resolve() },
    });
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (new URL(req.url).pathname === "/ws")
          return server.upgrade(req) ? undefined : new Response("no", { status: 400 });
        req.signal.addEventListener("abort", () => requestAborted.resolve());
        requestSeen.resolve();
        return new Promise<Response>(() => {});
      },
      websocket: { message() {}, close: () => wsClosed.resolve() },
    });

    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "clients.mjs"));
    await graph.run(() => app.connect(listener.port, server.port));
    await requestSeen.promise;

    graph.dispose();

    // The other ends see all three go.
    await Promise.all([tcpClosed.promise, wsClosed.promise, requestAborted.promise]);
    await hostTimerTurns();
    expect(app.heard).toEqual([]);
  });

  test("after dispose() nothing of the graph is called: not a close handler, not a child's messages, not its exit", async () => {
    const dir = fixture({
      "child.mjs": `
        process.on("SIGTERM", () => {});
        setInterval(() => process.send("tick"), 1);
      `,
      "stubborn.mjs": `
        export let spins = 0, messages = 0, exited = 0;
        export const counts = () => ({ spins, messages, exited });
        export async function start(port, childPath) {
          await Bun.connect({ hostname: "127.0.0.1", port, socket: {
            data() {},
            // (Would keep itself running from here, if it were told.)
            close() { const spin = () => { spins++; setImmediate(spin); }; spin(); },
          } });
          const child = Bun.spawn({
            cmd: [process.execPath, childPath],
            stdio: ["ignore", "ignore", "ignore"],
            ipc() { messages++; },
            onExit() { exited++; },
          });
          await new Promise(resolve => { const poll = () => (messages > 0 ? resolve() : setTimeout(poll, 1)); poll(); });
          return child;
        }
      `,
    });
    using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "stubborn.mjs"));
    // The child ignores the SIGTERM dispose() sends and keeps talking (on Windows it is terminated).
    const child = await graph.run(() => app.start(listener.port, join(dir, "child.mjs")));
    try {
      const atDispose = app.counts();
      graph.dispose();
      child.kill("SIGKILL");
      // Reaped all the same, though nobody is told (`child.exited` stays pending).
      await until(() => !isRunning(child.pid));
      await hostTimerTurns();
      expect(app.counts()).toEqual({ ...atDispose, spins: 0, exited: 0 });
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("dispose() kills the child processes the graph spawned", async () => {
    const dir = fixture({
      "spawn.mjs": `
        export const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdout: "ignore", stderr: "ignore" });
      `,
    });
    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const { child } = await graph.import(join(dir, "spawn.mjs"));
    try {
      expect(isRunning(child.pid)).toBe(true);
      graph.dispose();
      // (Nothing is reported, to the host holding the graph's Subprocess either.)
      await until(() => !isRunning(child.pid));
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("dispose() terminates the workers the graph started and closes its ports", async () => {
    const dir = fixture({
      "spawner.mjs": `
        export const worker = new Worker(import.meta.dir + "/worker.mjs");
        export const port = await new Promise(resolve => (worker.onmessage = e => resolve(e.data)));
        export const channel = new BroadcastChannel("module-graph-io");
        export let heard = 0;
        channel.onmessage = () => { heard++; };
        export const heardCount = () => heard;
      `,
      "worker.mjs": `
        const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("worker") });
        postMessage(server.port);
      `,
    });
    using graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "spawner.mjs"));
    const channel = new BroadcastChannel("module-graph-io");
    try {
      expect(await fetch(`http://127.0.0.1:${app.port}/`).then(r => r.text())).toBe("worker");
      channel.postMessage("before");
      await until(() => app.heardCount() === 1);

      graph.dispose();

      await until(async () => !(await accepts(app.port)));
      channel.postMessage("after");
      await hostTimerTurns();
      expect(app.heardCount()).toBe(1);
    } finally {
      channel.close();
    }
  });

  test("dispose() closes the graph's fs watchers and cancels its AbortSignal.timeout", async () => {
    const dir = fixture({
      "watched.txt": "0",
      "watchers.mjs": `
        import fs from "node:fs";
        export let events = 0, aborted = 0;
        const bump = () => { events++; };
        fs.watch(import.meta.dir + "/watched.txt", bump);
        fs.watchFile(import.meta.dir + "/watched.txt", { interval: 1 }, bump);
        export const armTimeout = () => AbortSignal.timeout(1).addEventListener("abort", () => { aborted++; });
        export const counts = () => ({ events, aborted });
      `,
    });
    using graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "watchers.mjs"));
    let writes = 0;
    await until(() => {
      writeFileSync(join(dir, "watched.txt"), String(++writes));
      return app.counts().events > 0;
    });

    // Armed and disposed in the same turn of the loop: it cannot have fired yet.
    graph.run(() => app.armTimeout());
    graph.dispose();

    const stopped = app.counts();
    // A host timeout armed for the same delay, after the graph's, fires later than it would have.
    const hostSignal = AbortSignal.timeout(1);
    writeFileSync(join(dir, "watched.txt"), String(++writes));
    await new Promise(resolve => hostSignal.addEventListener("abort", resolve));
    await hostTimerTurns();
    expect(app.counts()).toEqual({ ...stopped, aborted: 0 });
  });

  test("listeners of what the graph made run in the graph's context", async () => {
    const dir = fixture({
      "listeners.mjs": `
        export let ticks = 0;
        export function connect(port) {
          const ws = new WebSocket("ws://127.0.0.1:" + port);
          const { promise, resolve } = Promise.withResolvers();
          // Dispatched from the event loop, with no async context of its own.
          ws.onmessage = () => { setInterval(() => { ticks++; }, 1); resolve(); };
          return promise;
        }
        export const tick = () => ticks;
      `,
    });
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
      websocket: { open: ws => void ws.send("hello"), message() {} },
    });
    using graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "listeners.mjs"));
    await graph.run(() => app.connect(server.port));
    await until(() => app.tick() > 0);

    graph.dispose();

    const stopped = app.tick();
    await hostTimerTurns();
    expect(app.tick()).toBe(stopped);
  });

  test("a graph collected without dispose() leaves what it made working until it is stopped", async () => {
    const dir = fixture({
      "ws.mjs": `
        export const connect = port => new WebSocket("ws://127.0.0.1:" + port);
      `,
    });
    let serverClosed = 0;
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
      websocket: { message: (ws, message) => void ws.send(message), close: () => void serverClosed++ },
    });
    // Once `keepAlive` is emptied nothing of the graph is referenced but the socket its code made.
    const connect = async (keepAlive: object[]): Promise<WebSocket> => {
      const graph = new Bun.ModuleGraph({ isolateIO: true });
      keepAlive.push(graph);
      const app = await graph.import(join(dir, "ws.mjs"));
      return graph.run(() => app.connect(server.port));
    };
    const collectedAndClosed = (ws: WebSocket) =>
      until(() => {
        Bun.gc(true);
        return ws.readyState === WebSocket.CLOSED;
      });

    // Collected while the socket is open: it is closed from the event loop, and the server sees it.
    const keepAlive: object[] = [];
    const open = await connect(keepAlive);
    try {
      await new Promise<void>((resolve, reject) => {
        open.onopen = () => resolve();
        open.onerror = open.onclose = () => reject(new Error("closed before it opened"));
      });
      open.onerror = open.onclose = null;
      keepAlive.length = 0;
      await collectedAndClosed(open);
      await until(() => serverClosed === 1);
    } finally {
      open.close();
    }

    // Collected in the same turn the socket started connecting: closed mid-handshake.
    const connecting = await connect([]);
    try {
      await collectedAndClosed(connecting);
    } finally {
      connecting.close();
    }
  });

  test("dispose() drops the background work the graph had under way", async () => {
    const dir = fixture({
      "data.txt": "0123456789",
      "jobs.mjs": `
        import fs from "node:fs";
        import zlib from "node:zlib";
        import { promisify } from "node:util";
        export const work = () => Promise.race([
          fs.promises.readFile(import.meta.dir + "/data.txt", "utf8"),
          promisify(zlib.gzip)("hello"),
          Bun.sleep(1),
        ]);
      `,
    });
    // The same work outside a graph, started afterwards: it has finished once this has.
    const hostWork = () =>
      Promise.all([fs.promises.readFile(join(dir, "data.txt"), "utf8"), promisify(zlib.gzip)("hello"), Bun.sleep(1)]);
    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "jobs.mjs"));
    const work = graph.run(() => app.work());
    graph.dispose();
    await hostWork();
    await hostTimerTurns();
    expect(Bun.peek.status(work)).toBe("pending");
  });

  test("a socket of the graph upgraded to TLS by the host stays the graph's", async () => {
    const dir = fixture({
      "sockets.mjs": `
        import net from "node:net";
        export const connect = port => new Promise((resolve, reject) => {
          const socket = net.connect(port, "127.0.0.1", () => resolve(socket));
          socket.on("error", reject);
        });
        export const accept = () => {
          const accepted = Promise.withResolvers();
          const server = net.createServer(socket => accepted.resolve(socket));
          server.on("error", accepted.reject);
          return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, accepted: accepted.promise })));
        };
      `,
    });
    const secured = (socket: nodeTls.TLSSocket, event: string) =>
      new Promise<void>((resolve, reject) => {
        socket.once(event, () => resolve());
        socket.once("error", reject);
        socket.once("close", () => reject(new Error("closed before " + event)));
      });
    const closed = (socket: net.Socket) => new Promise<void>(resolve => socket.once("close", () => resolve()));

    // A client socket the graph connected, upgraded from the host's context.
    {
      const serverSide = Promise.withResolvers<nodeTls.TLSSocket>();
      const server = nodeTls.createServer({ key: tls.key, cert: tls.cert }, socket => {
        socket.on("error", () => {});
        serverSide.resolve(socket);
      });
      await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
      const graph = new Bun.ModuleGraph({ isolateIO: true });
      try {
        const app = await graph.import(join(dir, "sockets.mjs"));
        const raw = await graph.run(() => app.connect((server.address() as net.AddressInfo).port));
        const secure = nodeTls.connect({ socket: raw, rejectUnauthorized: false });
        await secured(secure, "secureConnect");
        const serverSocketClosed = closed(await serverSide.promise);
        secure.on("error", () => {});

        graph.dispose();

        await serverSocketClosed;
      } finally {
        graph.dispose();
        server.close();
      }
    }

    // A socket the graph's server accepted, upgraded (as the TLS server) from the host's context.
    {
      const graph = new Bun.ModuleGraph({ isolateIO: true });
      try {
        const app = await graph.import(join(dir, "sockets.mjs"));
        const { port, accepted } = await graph.run(() => app.accept());
        const client = nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
        const clientSecured = secured(client, "secureConnect");
        const secure = new nodeTls.TLSSocket(await accepted, { isServer: true, key: tls.key, cert: tls.cert });
        secure.on("error", () => {});
        await clientSecured;
        const clientClosed = closed(client);
        client.on("error", () => {});

        graph.dispose();

        await clientClosed;
      } finally {
        graph.dispose();
      }
    }
  });

  test("a Bun.SQL pool made by the graph redials in the graph's context", async () => {
    const dir = fixture({
      "sql.mjs": `
        export function query(port) {
          const sql = new Bun.SQL({ url: "postgres://user:pass@127.0.0.1:" + port + "/db", max: 1, connectionTimeout: 30 });
          sql\`select 1\`.catch(() => {});
        }
      `,
    });
    // Not a database: drops the first connection before the handshake, which the pool answers
    // with a redial (from the close event), and leaves the second one waiting.
    let connections = 0;
    const redialed = Promise.withResolvers<void>();
    const redialClosed = Promise.withResolvers<void>();
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = ++connections;
        },
        data(socket) {
          if (socket.data === 1) socket.end();
          else redialed.resolve();
        },
        close(socket) {
          if (socket.data === 2) redialClosed.resolve();
        },
      },
    });
    using graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "sql.mjs"));
    graph.run(() => app.query(server.port));
    await redialed.promise;

    graph.dispose();

    await redialClosed.promise;
    expect(connections).toBe(2);
  });

  test("a host function a graph calls works for that graph; through a snapshot taken in the host, for the host", async () => {
    const dir = fixture({ "calls.mjs": `export const call = () => { viaSnapshot("kept"); direct("dropped"); };` });
    const asHost = AsyncLocalStorage.snapshot();
    const log: string[] = [];
    const work = (entry: string) => {
      log.push(entry + " started in the " + (Bun.ModuleGraph.current ? "graph" : "host"));
      setImmediate(() => setTimeout(() => log.push(entry + " finished"), 1));
    };
    const graph = new Bun.ModuleGraph({
      isolateIO: true,
      globals: { viaSnapshot: (entry: string) => asHost(() => work(entry)), direct: work },
    });
    const app = await graph.import(join(dir, "calls.mjs"));
    graph.run(() => app.call());
    graph.dispose();
    await until(() => log.includes("kept finished"));
    await hostTimerTurns();
    expect(log).toEqual(["kept started in the host", "dropped started in the graph", "kept finished"]);
  });

  test("what a disposed graph's code opens is closed at once", async () => {
    const dir = fixture({
      "late.mjs": `
        export let ticks = 0;
        export let dialed = "pending";
        export let bound = "pending";
        // Nothing it starts settles, either way: a loop that retries on failure must not keep a disposed graph running.
        export const open = () => {
          setInterval(() => { ticks++; }, 1);
          Bun.udpSocket({ hostname: "127.0.0.1", port: 0 }).then(() => { bound = "bound"; }, () => { bound = "failed"; });
          Bun.connect({ hostname: "127.0.0.1", port: globalThis.__moduleGraphIoLatePort, socket: { data() {}, close() { dialed = "closed"; } } })
            .then(() => { dialed = "connected"; }, () => { dialed = "refused"; });
          return Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("late") }).port;
        };
        export const tick = () => ticks;
      `,
    });
    let lateClients = 0;
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {}, open: () => void lateClients++ },
    });
    (globalThis as any).__moduleGraphIoLatePort = listener.port;
    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "late.mjs"));
    // run() throws once the graph is disposed; its code is still entered by what it left behind.
    const inGraph = graph.run(() => AsyncLocalStorage.snapshot());
    graph.dispose();
    expect(() => graph.run(() => app.open())).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
    const port = inGraph(() => app.open());
    await until(async () => !(await accepts(port)));
    delete (globalThis as any).__moduleGraphIoLatePort;
    await hostTimerTurns();
    expect({ ticks: app.tick(), dialed: app.dialed, bound: app.bound, lateClients }).toEqual({
      ticks: 0,
      dialed: "pending",
      bound: "pending",
      lateClients: 0,
    });
  });

  test("code of the graph the host calls directly runs in the host's context; run() enters the graph's", async () => {
    const dir = fixture({
      "fn.mjs": `
        export let ticks = 0;
        export const start = () => setInterval(() => { ticks++; }, 1);
        export const tick = () => ticks;
      `,
    });
    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "fn.mjs"));
    const hostOwned = app.start();
    try {
      graph.dispose();
      const before = app.tick();
      await until(() => app.tick() > before + 2);
    } finally {
      clearInterval(hostOwned);
    }
  });

  test("the graph's context survives AsyncLocalStorage run/exit/enterWith inside it, and nests", async () => {
    const dir = fixture({
      "als.mjs": `
        import { AsyncLocalStorage } from "node:async_hooks";
        const inner = new AsyncLocalStorage();
        export let ticks = 0;
        export const start = (outer) => inner.run("inner", () => outer.exit(() => {
          inner.enterWith("entered");
          return new Promise(resolve => setImmediate(() => {
            setInterval(() => { ticks++; }, 1);
            resolve([inner.getStore(), outer.getStore()]);
          }));
        }));
        export const tick = () => ticks;
      `,
    });
    const outer = new AsyncLocalStorage<string>();
    const a = new Bun.ModuleGraph({ isolateIO: true });
    const b = new Bun.ModuleGraph({ isolateIO: true });
    const appA = await a.import(join(dir, "als.mjs"));
    const appB = await b.import(join(dir, "als.mjs"));
    // b's code entered from inside a's context: what it opens is b's.
    const [storesA, storesB] = await outer.run("host", () =>
      a.run(() => Promise.all([appA.start(outer), b.run(() => appB.start(outer))])),
    );
    expect(storesA).toEqual(["entered", undefined]);
    expect(storesB).toEqual(["entered", undefined]);
    expect(outer.getStore()).toBeUndefined();
    await until(() => appA.tick() > 0 && appB.tick() > 0);

    a.dispose();
    const stoppedA = appA.tick();
    const runningB = appB.tick();
    await until(() => appB.tick() > runningB + 2);
    expect(appA.tick()).toBe(stoppedA);

    b.dispose();
    const stoppedB = appB.tick();
    await hostTimerTurns();
    expect(appB.tick()).toBe(stoppedB);
  });

  test("CommonJS modules of the graph run in its context, as its entry and when required", async () => {
    const dir = fixture({
      "entry.cjs": `
        let ticks = 0;
        setInterval(() => { ticks++; }, 1);
        const required = require("./required.cjs");
        module.exports = { counts: () => [ticks, required.ticks()], who: WHO };
      `,
      "required.cjs": `
        let ticks = 0;
        setInterval(() => { ticks++; }, 1);
        exports.ticks = () => ticks;
      `,
    });
    using graph = new Bun.ModuleGraph({ isolateIO: true, globals: { WHO: "graph" } });
    const app = (await graph.import(join(dir, "entry.cjs"))).default;
    expect(app.who).toBe("graph");
    await until(() => app.counts().every((n: number) => n > 0));

    graph.dispose();

    const stopped = app.counts();
    await hostTimerTurns();
    expect(app.counts()).toEqual(stopped);
  });

  test("code after a top-level await is still in the graph's context", async () => {
    const dir = fixture({
      "tla.mjs": `
        export let before = 0, after = 0;
        setInterval(() => { before++; }, 1);
        await Bun.sleep(1);
        setInterval(() => { after++; }, 1);
        await import("./dep.mjs");
        export const counts = () => ({ before, after });
      `,
      "dep.mjs": `
        await 0;
        globalThis.__moduleGraphIoDep = setInterval(() => { globalThis.__moduleGraphIoDepTicks = (globalThis.__moduleGraphIoDepTicks ?? 0) + 1; }, 1);
      `,
    });
    const graph = new Bun.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "tla.mjs"));
    try {
      await until(() => app.counts().after > 0 && (globalThis as any).__moduleGraphIoDepTicks > 0);
      graph.dispose();
      const stopped = { ...app.counts(), dep: (globalThis as any).__moduleGraphIoDepTicks };
      await hostTimerTurns();
      expect({ ...app.counts(), dep: (globalThis as any).__moduleGraphIoDepTicks }).toEqual(stopped);
    } finally {
      clearInterval((globalThis as any).__moduleGraphIoDep);
      delete (globalThis as any).__moduleGraphIoDep;
      delete (globalThis as any).__moduleGraphIoDepTicks;
    }
  });

  test("a worker terminated, and a process that exits, with live graph contexts", async () => {
    const dir = fixture({
      "app.mjs": `
        Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
        setInterval(() => {}, 1000);
        export const pending = fetch("http://127.0.0.1:" + Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise(() => {}) }).port);
        pending.catch(() => {});
      `,
      "worker.mjs": `
        const kept = new Bun.ModuleGraph({ isolateIO: true });
        await kept.import(import.meta.dir + "/app.mjs");
        const disposed = new Bun.ModuleGraph({ isolateIO: true });
        await disposed.import(import.meta.dir + "/app.mjs");
        disposed.dispose();
        postMessage("ready");
      `,
      "main.mjs": `
        const worker = new Worker(import.meta.dir + "/worker.mjs");
        await new Promise(resolve => (worker.onmessage = resolve));
        await worker.terminate();
        const graph = new Bun.ModuleGraph({ isolateIO: true });
        await graph.import(import.meta.dir + "/app.mjs");
        console.log("done");
        process.exit(0);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "main.mjs")],
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
  });
});
