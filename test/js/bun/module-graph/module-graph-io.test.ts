// Bun.ModuleGraph — a graph has a context of its own
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

describe.concurrent("ModuleGraph: what a graph opens is the graph's", () => {
  test("run() calls fn in the graph's context and validates it; a subclass is a ModuleGraph", () => {
    using graph = new Bun.ModuleGraph();
    expect(graph.run((a, b) => a + b, 1, 2)).toBe(3);
    expect(() =>
      graph.run(() => {
        throw new RangeError("from fn");
      }),
    ).toThrow(RangeError);
    expect(() => graph.run(1 as any)).toThrow(/fn/);
    class Tenant extends Bun.ModuleGraph {
      tenant = "t1";
    }
    using tenant = new Tenant();
    expect([
      tenant instanceof Bun.ModuleGraph,
      tenant instanceof Tenant,
      tenant.tenant,
      tenant.run(() => "ran"),
    ]).toEqual([true, true, "t1", "ran"]);
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
    const graph = new Bun.ModuleGraph();
    const app = await graph.import(join(dir, "timers.mjs"));
    await graph.run(() => app.armLater());
    await until(() => app.counts().ticks > 0 && app.counts().late > 0 && app.counts().immediates > 0);

    graph.dispose();
    const stopped = app.counts();
    await hostTimerTurns();
    expect(app.counts()).toEqual(stopped);
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
    using graph = new Bun.ModuleGraph();
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

    const graph = new Bun.ModuleGraph();
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
            // (Would keep itself running from here, if it were called.)
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
    const graph = new Bun.ModuleGraph();
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
    const graph = new Bun.ModuleGraph();
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
    using graph = new Bun.ModuleGraph();
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
    using graph = new Bun.ModuleGraph();
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
    using graph = new Bun.ModuleGraph();
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
      const graph = new Bun.ModuleGraph();
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
    const graph = new Bun.ModuleGraph();
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
      const graph = new Bun.ModuleGraph();
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
      const graph = new Bun.ModuleGraph();
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
    using graph = new Bun.ModuleGraph();
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
    const graph = new Bun.ModuleGraph();
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
    const graph = new Bun.ModuleGraph();
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
    const a = new Bun.ModuleGraph();
    const b = new Bun.ModuleGraph();
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
    using graph = new Bun.ModuleGraph({ globals: { WHO: "graph" } });
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
    const graph = new Bun.ModuleGraph();
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
        const kept = new Bun.ModuleGraph();
        await kept.import(import.meta.dir + "/app.mjs");
        const disposed = new Bun.ModuleGraph();
        await disposed.import(import.meta.dir + "/app.mjs");
        disposed.dispose();
        postMessage("ready");
      `,
      "main.mjs": `
        const worker = new Worker(import.meta.dir + "/worker.mjs");
        await new Promise(resolve => (worker.onmessage = resolve));
        await worker.terminate();
        const graph = new Bun.ModuleGraph();
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

  test("a server of the host's that answers with a Response whose body is still arriving, while a graph exists", async () => {
    // The server renders what its handler returned after the handler is off the stack: that
    // continues the script that made the server, whichever graphs exist.
    // A chunk per pull; the next one when released.
    let chunks = 0;
    let release = () => {};
    using upstream = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(new TextEncoder().encode("chunk"));
              if (++chunks === 3) controller.close();
              else await new Promise<void>(resolve => (release = resolve));
            },
          }),
        ),
    });
    using graph = new Bun.ModuleGraph();
    const arriving = await fetch(upstream.url);
    using front = Bun.serve({ port: 0, fetch: () => arriving });
    const served = fetch(front.url).then(response => response.text());
    await until(() => (release(), chunks === 3));
    expect(await served).toBe("chunkchunkchunk");
  });
});

// An uncaught error is the graph's in whose context it happened. Native code that calls the
// graph's handler has left that context by the time it reports what the handler threw, so the
// exception itself says where it was thrown; and an error no script threw (a socket's) is
// reported from inside the context of the script that opened the socket.
describe.concurrent("ModuleGraph: an error in what a graph opened is the graph's", () => {
  async function run(dir: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "main.mjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // The host's side of each case: something for the graph's listener to hear from.
  const hostHelpers = `
    import dgram from "node:dgram";
    import { AsyncResource } from "node:async_hooks";
    const hostResource = new AsyncResource("host");
    export const host = {
      inHostScope: fn => hostResource.runInAsyncScope(fn),
      async connectAndWrite(port) {
        await Bun.connect({ hostname: "127.0.0.1", port, socket: { open(s) { s.write("hello"); }, data() {}, error() {}, close() {} } });
      },
      echoServer: () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(s) { s.write("welcome"); }, data(s, d) { s.write(d); }, error() {} } }).port,
      httpServer: () => Bun.serve({ port: 0, fetch: () => new Response("ok") }).port,
      wsEchoServer: () => Bun.serve({
        port: 0,
        fetch(req, server) { if (server.upgrade(req)) return; return new Response("no"); },
        websocket: { message(ws, m) { ws.send(m); } },
      }).port,
      wsConnectAndSend(port) {
        const ws = new WebSocket("ws://127.0.0.1:" + port + "/");
        ws.onopen = () => ws.send("hi");
        ws.onerror = () => {};
      },
      fetch(port) { fetch("http://127.0.0.1:" + port + "/").then(r => r.text(), () => {}); },
      fetchAndClose(port) { fetch("http://127.0.0.1:" + port + "/", { headers: { connection: "close" } }).then(r => r.text(), () => {}); },
      post(port) { fetch("http://127.0.0.1:" + port + "/", { method: "POST", body: "hello" }).then(r => r.text(), () => {}); },
      udpSend(port) { const s = dgram.createSocket("udp4"); s.send("hi", port, "127.0.0.1", () => s.close()); },
      async http2Get(port) {
        const http2 = await import("node:http2");
        const c = http2.connect("http://127.0.0.1:" + port);
        c.on("error", () => {});
        const r = c.request({ ":path": "/" });
        r.on("error", () => {});
        r.end();
      },
      // Speaks enough RESP3 for a RedisClient to connect; dropRedisConnections() hangs up on them.
      redisConnections: [],
      redisServer() {
        return Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open: socket => void host.redisConnections.push(socket),
            data(socket, data) {
              if (/HELLO/i.test(String(data))) socket.write("%2\\r\\n$6\\r\\nserver\\r\\n$5\\r\\nredis\\r\\n$5\\r\\nproto\\r\\n:3\\r\\n");
            },
            error() {},
          },
        }).port;
      },
      dropRedisConnections() {
        for (const socket of host.redisConnections.splice(0)) socket.end();
      },
      async closedUdpPort() {
        const s = dgram.createSocket("udp4");
        await new Promise(r => s.bind(0, "127.0.0.1", r));
        const port = s.address().port;
        await new Promise(r => s.close(r));
        return port;
      },
    };
  `;

  test("what a listener of the graph's throws, for every kind of thing it can listen to", async () => {
    const dir = fixture({
      "host.mjs": hostHelpers,
      "tenant.mjs": `
        import { EventEmitter } from "node:events";
        import { AsyncLocalStorage } from "node:async_hooks";
        import net from "node:net";
        import http from "node:http";
        import http2 from "node:http2";
        import dgram from "node:dgram";
        import fs from "node:fs";
        import path from "node:path";
        import zlib from "node:zlib";
        import crypto from "node:crypto";
        import readline from "node:readline";
        import { Readable } from "node:stream";
        import { Worker, MessageChannel } from "node:worker_threads";

        // Each case arranges for boom(name) to be called by the thing it names, with nobody to catch it.
        export const cases = {
          "setTimeout": boom => setTimeout(boom, 1),
          "setImmediate": boom => setImmediate(boom),
          "process.nextTick": boom => process.nextTick(boom),
          "queueMicrotask": boom => queueMicrotask(boom),
          "queueMicrotask, after AsyncLocalStorage.enterWith()": boom => queueMicrotask(() => { new AsyncLocalStorage().enterWith({}); boom(); }),
          "AsyncLocalStorage.run() in a timer": boom => setTimeout(() => new AsyncLocalStorage().run({}, boom), 1),
          "an EventEmitter listener": boom => { const e = new EventEmitter(); e.on("x", boom); setTimeout(() => e.emit("x"), 1); },
          "an EventTarget listener": boom => { const t = new EventTarget(); t.addEventListener("x", boom); setTimeout(() => t.dispatchEvent(new Event("x")), 1); },
          "an AbortSignal listener": boom => AbortSignal.timeout(1).addEventListener("abort", boom),
          "Bun.listen: data": (boom, host) => host.connectAndWrite(Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: boom } }).port),
          "Bun.listen: open": (boom, host) => host.connectAndWrite(Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open: boom, data() {} } }).port),
          "Bun.listen: the error handler itself": (boom, host) =>
            host.connectAndWrite(Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() { throw new Error("first"); }, error: boom } }).port),
          "Bun.connect: data": (boom, host) => { Bun.connect({ hostname: "127.0.0.1", port: host.echoServer(), socket: { open(s) { s.write("hi"); }, data: boom } }); },
          "Bun.connect: open": (boom, host) => { Bun.connect({ hostname: "127.0.0.1", port: host.echoServer(), socket: { open: boom, data() {} } }).catch(() => {}); },
          "Bun.serve: websocket message": (boom, host) =>
            host.wsConnectAndSend(Bun.serve({ port: 0, fetch(req, server) { if (server.upgrade(req)) return; return new Response("no"); }, websocket: { message: boom } }).port),
          "Bun.serve: websocket open": (boom, host) =>
            host.wsConnectAndSend(Bun.serve({ port: 0, fetch(req, server) { if (server.upgrade(req)) return; return new Response("no"); }, websocket: { open: boom, message() {} } }).port),
          "Bun.udpSocket: data": async (boom, host) => host.udpSend((await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { data: boom } })).port),
          "node:net server: 'connection'": (boom, host) => { const s = net.createServer(boom); s.listen(0, "127.0.0.1", () => host.connectAndWrite(s.address().port)); },
          "node:net server socket: 'data'": (boom, host) => { const s = net.createServer(c => c.on("data", boom)); s.listen(0, "127.0.0.1", () => host.connectAndWrite(s.address().port)); },
          "node:net client: 'data'": (boom, host) => { const c = net.connect(host.echoServer(), "127.0.0.1", () => c.write("hi")); c.on("data", boom); },
          "node:http server: 'request'": (boom, host) => { const s = http.createServer(boom); s.listen(0, "127.0.0.1", () => host.fetch(s.address().port)); },
          "node:http server: an async 'request' listener": (boom, host) => { const s = http.createServer(async () => { await 1; boom(); }); s.listen(0, "127.0.0.1", () => host.fetch(s.address().port)); },
          "node:http server: the request's 'data'": (boom, host) => { const s = http.createServer(req => req.on("data", boom)); s.listen(0, "127.0.0.1", () => host.post(s.address().port)); },
          "node:http server: the request's socket's 'close'": (boom, host) => {
            const s = http.createServer((req, res) => { req.socket.on("close", boom); res.end("ok"); });
            s.listen(0, "127.0.0.1", () => host.fetchAndClose(s.address().port));
          },
          "node:http server: the response's 'close'": (boom, host) => {
            const s = http.createServer((req, res) => { res.on("close", boom); res.end("ok"); });
            s.listen(0, "127.0.0.1", () => host.fetchAndClose(s.address().port));
          },
          "node:http client: the response callback": (boom, host) => { http.get({ port: host.httpServer(), host: "127.0.0.1", agent: new http.Agent() }, boom); },
          "node:http2 server: 'stream'": (boom, host) => { const s = http2.createServer(); s.on("stream", boom); s.listen(0, "127.0.0.1", () => host.http2Get(s.address().port)); },
          "node:dgram: 'message'": (boom, host) => { const s = dgram.createSocket("udp4"); s.on("message", boom); s.bind(0, "127.0.0.1", () => host.udpSend(s.address().port)); },
          "RedisClient: onconnect": (boom, host) => {
            const client = new Bun.RedisClient("redis://127.0.0.1:" + host.redisServer(), { autoReconnect: false });
            client.onconnect = boom;
            client.connect().catch(() => {});
          },
          "RedisClient: onclose": (boom, host) => {
            const client = new Bun.RedisClient("redis://127.0.0.1:" + host.redisServer(), { autoReconnect: false });
            client.onclose = boom;
            client.connect().then(host.dropRedisConnections, () => {});
          },
          "WebSocket client: onmessage": (boom, host) => { const ws = new WebSocket("ws://127.0.0.1:" + host.wsEchoServer() + "/"); ws.onopen = () => ws.send("hi"); ws.onmessage = boom; },
          "fetch().then()": (boom, host) => { fetch("http://127.0.0.1:" + host.httpServer() + "/").then(boom); },
          "fs.readFile callback": boom => fs.readFile(import.meta.filename, boom),
          "fs.watch listener": boom => {
            const dir = path.join(import.meta.dirname, "watched");
            fs.mkdirSync(dir);
            const w = fs.watch(dir, () => { w.close(); boom(); });
            fs.writeFileSync(path.join(dir, "f"), "x");
          },
          "a read stream's 'data'": boom => { fs.createReadStream(import.meta.filename).on("data", boom); },
          "a zlib stream's 'data'": boom => { const z = zlib.createGzip(); z.on("data", boom); z.end("hello"); },
          "zlib.gzip callback": boom => zlib.gzip("x", boom),
          "crypto.randomBytes callback": boom => crypto.randomBytes(8, boom),
          "crypto.pbkdf2 callback": boom => crypto.pbkdf2("a", "b", 1, 8, "sha1", boom),
          "readline 'line'": boom => { readline.createInterface({ input: Readable.from(["a\\n"]) }).on("line", boom); },
          "Bun.spawn onExit": boom => { Bun.spawn({ cmd: [process.execPath, "-e", "1"], onExit: boom }); },
          "a Worker's 'message'": boom => { new Worker("require('node:worker_threads').parentPort.postMessage(1)", { eval: true }).on("message", boom); },
          "a MessagePort's 'message'": boom => { const { port1, port2 } = new MessageChannel(); port1.on("message", boom); port2.postMessage(1); },
          "a BroadcastChannel's onmessage": boom => { const a = new BroadcastChannel("module-graph-errors"); const b = new BroadcastChannel("module-graph-errors"); a.onmessage = boom; b.postMessage(1); },
          "a ReadableStream's pull()": boom => { new ReadableStream({ pull: boom }).getReader().read(); },
          // The context the throw happens in is not the graph's: a closure of the graph's run inside
          // something the host made.
          "a closure of the graph's that a host AsyncResource runs": (boom, host) => setTimeout(() => host.inHostScope(boom), 1),
        };
        export const throws = message => { throw new Error(message); };
      `,
      "main.mjs": `
        import { host } from "./host.mjs";
        let told;
        const tell = who => error => { if (error?.message === told?.expecting) told.resolve(who); };
        process.on("uncaughtException", tell("host"));
        process.on("unhandledRejection", tell("host"));
        const graph = new Bun.ModuleGraph({ onError: tell("graph") });
        const { cases, throws } = await graph.import(import.meta.dir + "/tenant.mjs");
        const out = {};
        const expect = async (name, start) => {
          told = { expecting: name, ...Promise.withResolvers() };
          const nobody = setTimeout(told.resolve, 10_000, "nobody was told within 10 seconds");
          await start(() => throws(name));
          out[name] = await told.promise;
          clearTimeout(nobody);
        };
        for (const [name, start] of Object.entries(cases)) await expect(name, boom => graph.run(() => start(boom, host)));
        // What run() calls throws synchronously and the host that called run() does not catch it.
        await expect("run() from a timer of the host's", boom => { setTimeout(() => graph.run(boom), 1); });
        await expect("run() from a microtask of the host's", boom => { queueMicrotask(() => graph.run(boom)); });
        await expect("run() from a tick of the host's", boom => { process.nextTick(() => graph.run(boom)); });
        // A function of the graph's that the host calls directly, or listens with, runs in the host's context.
        await expect("a function of the graph's the host calls from its timer", boom => { setTimeout(boom, 1); });
        await expect("a function of the graph's listening on a host EventEmitter", async boom => {
          const { EventEmitter } = await import("node:events");
          const e = new EventEmitter();
          e.on("x", boom);
          setTimeout(() => e.emit("x"), 1);
        });
        console.log(JSON.stringify(out, null, 1));
        process.exit(0);
      `,
    });
    const { stdout, exitCode } = await run(dir);
    const out = JSON.parse(stdout);
    const hosts = [
      "a closure of the graph's that a host AsyncResource runs",
      "a function of the graph's the host calls from its timer",
      "a function of the graph's listening on a host EventEmitter",
    ];
    expect(Object.keys(out).length).toBeGreaterThan(40);
    expect(out).toEqual(
      Object.fromEntries(Object.keys(out).map(name => [name, hosts.includes(name) ? "host" : "graph"])),
    );
    expect(hosts.every(name => name in out)).toBe(true);
    expect(exitCode).toBe(0);
    // One process walks every case in turn (a Worker, a child process, an HTTP/2 session among them).
  }, 60_000);

  // Nothing throws here: the kernel refuses the datagram and the socket has no error handler.
  test.skipIf(process.platform === "win32")("an error of the graph's socket that no script threw", async () => {
    const dir = fixture({
      "host.mjs": hostHelpers,
      "tenant.mjs": `
        const socket = await Bun.udpSocket({ connect: { hostname: "127.0.0.1", port: closedPort }, socket: { data() {} } });
        const send = () => { try { socket.send("x"); } catch {} };
        send();
        const again = setInterval(send, 5);
        export const stop = () => clearInterval(again);
      `,
      "main.mjs": `
        import { host } from "./host.mjs";
        const { promise, resolve } = Promise.withResolvers();
        process.on("uncaughtException", error => resolve("host: " + error.code));
        const graph = new Bun.ModuleGraph({ globals: { closedPort: await host.closedUdpPort() }, onError: error => resolve("graph: " + error.code) });
        const { stop } = await graph.import(import.meta.dir + "/tenant.mjs");
        console.log(await promise);
        stop();
        process.exit(0);
      `,
    });
    expect(await run(dir)).toEqual({ stdout: "graph: ECONNREFUSED\n", stderr: "", exitCode: 0 });
  });

  test("handlers a graph set on a RedisClient of the host's are not called once the graph is disposed", async () => {
    const dir = fixture({
      "host.mjs": hostHelpers,
      "tenant.mjs": `
        export const listen = (client, heard) => {
          client.onconnect = () => heard.push("onconnect");
          client.onclose = () => heard.push("onclose");
        };
      `,
      "main.mjs": `
        import { host } from "./host.mjs";
        const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/tenant.mjs");
        // The client is the host's; the graph only sets its handlers.
        const client = new Bun.RedisClient("redis://127.0.0.1:" + host.redisServer(), { autoReconnect: false });
        const heard = [];
        graph.run(() => app.listen(client, heard));
        await client.connect();
        host.dropRedisConnections();
        await until(() => heard.includes("onclose"));
        const whileAlive = heard.splice(0);
        graph.dispose();
        // The client still works for the host; the disposed graph's handlers hear nothing of it.
        await client.connect();
        host.dropRedisConnections();
        await until(() => !client.connected);
        for (let turn = 0; turn < 10; turn++) await new Promise(resolve => setImmediate(resolve));
        console.log(JSON.stringify({ whileAlive, afterDispose: heard }));
        process.exit(0);
      `,
    });
    expect(await run(dir)).toEqual({
      stdout: JSON.stringify({ whileAlive: ["onconnect", "onclose"], afterDispose: [] }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("two graphs on either end of one connection each get what their own handler throws", async () => {
    const dir = fixture({
      "server.mjs": `
        ready(Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(s) { s.write("from the server"); }, data() { throw new Error("the server's data handler"); } } }).port);
      `,
      "client.mjs": `
        Bun.connect({ hostname: "127.0.0.1", port, socket: { open(s) { s.write("from the client"); }, data() { throw new Error("the client's data handler"); } } });
      `,
      "main.mjs": `
        const told = [];
        const done = Promise.withResolvers();
        const tell = who => error => { told.push(who + ": " + error.message); if (told.length === 2) done.resolve(); };
        process.on("uncaughtException", tell("host"));
        const listening = Promise.withResolvers();
        const server = new Bun.ModuleGraph({ globals: { ready: listening.resolve }, onError: tell("server graph") });
        await server.import(import.meta.dir + "/server.mjs");
        const client = new Bun.ModuleGraph({ globals: { port: await listening.promise }, onError: tell("client graph") });
        await client.import(import.meta.dir + "/client.mjs");
        await done.promise;
        console.log(told.sort().join("\\n"));
        process.exit(0);
      `,
    });
    expect(await run(dir)).toEqual({
      stdout: "client graph: the client's data handler\nserver graph: the server's data handler\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// An Agent opens its sockets as whoever made it, but the request that waits for one stays its
// requester's, however the socket comes to be: connected directly, or through a CONNECT proxy
// (where the Agent hears that the socket is ready from the proxy connection's own callbacks).
describe.concurrent("ModuleGraph: a request through an Agent of the host's is still the graph's", () => {
  test.each(["direct", "through a CONNECT proxy"])(
    "%s: the response callback, and an error nobody listens for",
    async how => {
      const dir = fixture({
        "key.pem": tls.key,
        "cert.pem": tls.cert,
        "tenant.mjs": `
        import https from "node:https";
        // No agent: the host's https.globalAgent.
        export const get = (port, told) => { https.get({ host: "localhost", port, path: "/", rejectUnauthorized: false }, response => { response.resume(); told(Bun.ModuleGraph.current); }); };
        export const getFromNobody = port => { https.get({ host: "localhost", port, path: "/", rejectUnauthorized: false }); };
      `,
        "main.mjs": `
        import https from "node:https";
        import net from "node:net";
        import fs from "node:fs";
        const origin = https.createServer({ key: fs.readFileSync(import.meta.dir + "/key.pem"), cert: fs.readFileSync(import.meta.dir + "/cert.pem") }, (request, response) => response.end("ok"));
        await new Promise(resolve => origin.listen(0, "127.0.0.1", resolve));
        const out = {};
        const graph = new Bun.ModuleGraph({ onError: error => told.resolve("the graph's onError: " + error.code) });
        process.on("uncaughtException", error => told.resolve("the host's uncaughtException: " + error.code));
        let told;
        const app = await graph.import(import.meta.dir + "/tenant.mjs");

        told = Promise.withResolvers();
        graph.run(() => app.get(origin.address().port, current => told.resolve(current === graph ? "the graph's context" : "not the graph's context")));
        out.response = await told.promise;

        // Nobody answers on this port (or, with a proxy, the proxy refuses the CONNECT), and the request has no 'error' listener.
        const closed = net.createServer();
        await new Promise(resolve => closed.listen(0, "127.0.0.1", resolve));
        const closedPort = closed.address().port;
        await new Promise(resolve => closed.close(resolve));
        told = Promise.withResolvers();
        graph.run(() => app.getFromNobody(closedPort));
        out.error = await told.promise;

        console.log(JSON.stringify(out));
        process.exit(0);
      `,
        "proxy.mjs": `
        import net from "node:net";
        // Answers CONNECT host:port by connecting there; 502 when it cannot.
        const proxy = net.createServer(client => {
          client.once("data", head => {
            const [, host, port] = /^CONNECT ([^:]+):(\\d+) /.exec(head.toString("latin1")) ?? [];
            const upstream = net.connect(Number(port), host === "localhost" ? "127.0.0.1" : host);
            upstream.once("connect", () => { client.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n"); upstream.pipe(client); client.pipe(upstream); });
            upstream.once("error", () => client.end("HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n"));
            client.on("error", () => upstream.destroy());
          });
        });
        proxy.listen(0, "127.0.0.1", () => console.log(proxy.address().port));
      `,
      });
      let env: Record<string, string | undefined> = { ...bunEnv, NO_PROXY: undefined, no_proxy: undefined };
      await using proxy =
        how === "direct"
          ? null
          : Bun.spawn({ cmd: [bunExe(), join(dir, "proxy.mjs")], env: bunEnv, stdout: "pipe", stderr: "inherit" });
      if (proxy) {
        const reader = proxy.stdout.getReader();
        const port = new TextDecoder().decode((await reader.read()).value).trim();
        reader.releaseLock();
        env = { ...env, NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://127.0.0.1:" + port, https_proxy: undefined };
      }
      await using proc = Bun.spawn({ cmd: [bunExe(), join(dir, "main.mjs")], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
        stdout: {
          response: "the graph's context",
          error: "the graph's onError: " + (how === "direct" ? "ECONNREFUSED" : "ERR_PROXY_TUNNEL"),
        },
        stderr: "",
        exitCode: 0,
      });
    },
  );
});
