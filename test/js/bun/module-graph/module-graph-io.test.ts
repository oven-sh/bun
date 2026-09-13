// Bun.unsafe.ModuleGraph({ isolateIO: true }) — the graph gets a context of its own
// for timers and I/O: what its code opens belongs to it, and dispose() closes all of it.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
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

describe.concurrent("ModuleGraph isolateIO", () => {
  test("option is validated; run() exists and validates", () => {
    expect(() => new Bun.unsafe.ModuleGraph({ isolateIO: 1 as any })).toThrow(/isolateIO/);
    using graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
    expect(graph.run((a, b) => a + b, 1, 2)).toBe(3);
    expect(() =>
      graph.run(() => {
        throw new RangeError("from fn");
      }),
    ).toThrow(RangeError);
    expect(() => graph.run(1 as any)).toThrow(/fn/);
    // Without a context of its own run() is just a call.
    using plain = new Bun.unsafe.ModuleGraph();
    expect(plain.run(x => x * 2, 21)).toBe(42);
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
    const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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
    const graph = new Bun.unsafe.ModuleGraph();
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
    using graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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

  test("dispose() closes the graph's client sockets and aborts its in-flight fetch", async () => {
    const dir = fixture({
      "clients.mjs": `
        export async function connect(tcpPort, httpPort) {
          const socket = await Bun.connect({ hostname: "127.0.0.1", port: tcpPort, socket: { data() {} } });
          const ws = new WebSocket("ws://127.0.0.1:" + httpPort + "/ws");
          await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
          const response = fetch("http://127.0.0.1:" + httpPort + "/hang").then(() => "resolved", e => "rejected");
          return { response };
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

    const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "clients.mjs"));
    const { response } = await graph.run(() => app.connect(listener.port, server.port));
    await requestSeen.promise;

    graph.dispose();

    await Promise.all([tcpClosed.promise, wsClosed.promise, requestAborted.promise]);
    expect(await response).toBe("rejected");
  });

  test("dispose() kills the child processes the graph spawned", async () => {
    const dir = fixture({
      "spawn.mjs": `
        export const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdout: "ignore", stderr: "ignore" });
      `,
    });
    const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
    const { child } = await graph.import(join(dir, "spawn.mjs"));
    try {
      expect(child.killed).toBe(false);
      graph.dispose();
      await child.exited;
      expect(child.signalCode).toBe("SIGTERM");
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
    using graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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
        AbortSignal.timeout(20).addEventListener("abort", () => { aborted++; });
        export const counts = () => ({ events, aborted });
      `,
    });
    using graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "watchers.mjs"));
    let writes = 0;
    await until(() => {
      writeFileSync(join(dir, "watched.txt"), String(++writes));
      return app.counts().events > 0;
    });

    graph.dispose();

    const stopped = app.counts();
    expect(stopped.aborted).toBe(0);
    // A host timeout armed for the same delay, after the graph's, fires later than it would have.
    const hostSignal = AbortSignal.timeout(20);
    writeFileSync(join(dir, "watched.txt"), String(++writes));
    await new Promise(resolve => hostSignal.addEventListener("abort", resolve));
    await hostTimerTurns();
    expect(app.counts()).toEqual(stopped);
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
    using graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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
    const closed = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
      websocket: { message: (ws, message) => void ws.send(message), close: () => closed.resolve() },
    });
    const ws: WebSocket = await (async () => {
      const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
      const app = await graph.import(join(dir, "ws.mjs"));
      return graph.run(() => app.connect(server.port));
    })();
    try {
      // Collected mid-handshake or right after it: either way the socket is closed from
      // the event loop, not from under the collector.
      await until(() => {
        Bun.gc(true);
        return ws.readyState === WebSocket.CLOSED;
      });
      await closed.promise;
    } finally {
      ws.close();
    }
  });

  test("what a disposed graph's code opens is closed at once", async () => {
    const dir = fixture({
      "late.mjs": `
        export let ticks = 0;
        export const open = async () => {
          setInterval(() => { ticks++; }, 1);
          const udp = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
          // Refused, or connected and then closed.
          const client = await Bun.connect({ hostname: "127.0.0.1", port: globalThis.__moduleGraphIoLatePort, socket: { data() {} } }).catch(() => null);
          return {
            connected: client !== null, port: Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("late") }).port, udp: udp.port };
        };
        export const tick = () => ticks;
      `,
    });
    const lateClientClosed = Promise.withResolvers<void>();
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {}, close: () => lateClientClosed.resolve() },
    });
    (globalThis as any).__moduleGraphIoLatePort = listener.port;
    const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
    const app = await graph.import(join(dir, "late.mjs"));
    graph.dispose();
    const { port, udp, connected } = await graph.run(() => app.open());
    await until(async () => !(await accepts(port)));
    const rebound = await until(() => Bun.udpSocket({ hostname: "127.0.0.1", port: udp }).catch(() => undefined));
    rebound.close();
    if (connected) await lateClientClosed.promise;
    delete (globalThis as any).__moduleGraphIoLatePort;
    await hostTimerTurns();
    expect(app.tick()).toBe(0);
  });

  test("code of the graph the host calls directly runs in the host's context; run() enters the graph's", async () => {
    const dir = fixture({
      "fn.mjs": `
        export let ticks = 0;
        export const start = () => setInterval(() => { ticks++; }, 1);
        export const tick = () => ticks;
      `,
    });
    const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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
    const a = new Bun.unsafe.ModuleGraph({ isolateIO: true });
    const b = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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
    const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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
        const kept = new Bun.unsafe.ModuleGraph({ isolateIO: true });
        await kept.import(import.meta.dir + "/app.mjs");
        const disposed = new Bun.unsafe.ModuleGraph({ isolateIO: true });
        await disposed.import(import.meta.dir + "/app.mjs");
        disposed.dispose();
        postMessage("ready");
      `,
      "main.mjs": `
        const worker = new Worker(import.meta.dir + "/worker.mjs");
        await new Promise(resolve => (worker.onmessage = resolve));
        await worker.terminate();
        const graph = new Bun.unsafe.ModuleGraph({ isolateIO: true });
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
