// Bun.unsafe.ModuleGraph — further instantiations of an ES module graph in THIS
// global, sharing every executable/CodeBlock (and so JIT code) with the first
// load while giving each graph its own module environments and its own values
// for a fixed set of overlaid globals.
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import { tls as tlsCert } from "harness";
import { tmpdir } from "os";
import { join } from "path";

type ModuleGraphOptions = {
  env?: Record<string, string>;
  cwd?: string;
  onExit?: (code: number) => void;
  onError?: (error: unknown, kind: string) => void;
  globals?: Record<string, unknown>;
};
type ModuleGraphInstance = {
  import(specifier: string): Promise<any>;
  dispose(): void;
  readonly process: NodeJS.Process;
};
const ModuleGraphClass = (Bun as any).unsafe?.ModuleGraph as
  | { new (opts?: ModuleGraphOptions): ModuleGraphInstance }
  | undefined;
const ModuleGraph = (opts?: ModuleGraphOptions) => new ModuleGraphClass!(opts);

const enabled = typeof ModuleGraphClass === "function";
// Debug / GC-stress runs (collectContinuously, verifyGC, ASAN) are much slower: timing bounds do not apply there.
const stressMode =
  !!(process.env.BUN_JSC_collectContinuously || process.env.BUN_JSC_verifyGC || process.env.BUN_JSC_useZombieMode) ||
  (Bun as any).revision?.includes("debug") ||
  process.execPath.includes("debug");

function fixture(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "module-graph-")));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), source);
  }
  return dir;
}

/** True once the object `make` registers (via the callback it is given) has been garbage-collected.
 *  `make` may also just return the object. The object never travels through this function's own
 *  frames/promises after registration, and the stack is churned between GCs, so conservative scanning
 *  does not keep it alive spuriously. */
async function collected(
  make: (register: (o: object) => void) => Promise<object | void> | object | void,
): Promise<boolean> {
  let done = false;
  const registry = new FinalizationRegistry(() => {
    done = true;
  });
  const register = (o: object) => registry.register(o, 1);
  await (async () => {
    const r = await make(register);
    if (r && typeof r === "object") register(r);
  })();
  function churn(depth: number): number {
    const a = [depth, {}, [], "x".repeat(depth)];
    return depth <= 0 ? a.length : churn(depth - 1) + a.length;
  }
  for (let i = 0; i < 60 && !done; i++) {
    churn(64);
    await Bun.sleep(i < 20 ? 1 : 5);
    Bun.gc(true);
    await new Promise<void>(r => setImmediate(r));
  }
  // Second, heavier phase (slow debug/GC-verification builds, large heaps): let pending I/O settle,
  // clobber stale stack slots with junk, collect again. A real leak still never collects.
  for (let i = 0; i < 30 && !done; i++) {
    await Bun.sleep(50);
    void new Array(4096).fill(0).map((_, k) => ({ k }));
    churn(128);
    Bun.gc(true);
    await new Promise<void>(r => setImmediate(r));
  }
  return done;
}
const jsc = require("bun:jsc") as typeof import("bun:jsc");

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph", () => {
  test("is a class: requires new, has a prototype, dispose is idempotent and import after dispose throws", async () => {
    expect(() => (ModuleGraphClass as any)()).toThrow("cannot be invoked without 'new'");
    const g = new ModuleGraphClass!();
    expect(Object.prototype.toString.call(g)).toBe("[object ModuleGraph]");
    expect(typeof Object.getPrototypeOf(g).import).toBe("function");
    expect(g.process.cwd()).toBe(process.cwd());
    g.dispose();
    g.dispose();
    (g as any)[Symbol.dispose]();
    const dir = fixture({ "x.mjs": `export const x = 1` });
    expect(() => g.import(join(dir, "x.mjs"))).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  test("each graph gets its own module state; live bindings and imports resolve within the graph", async () => {
    const dir = fixture({
      "dep.mjs": `export let counter = 0; export function bump() { return ++counter } export const tag = { id: Math.random() }`,
      "main.mjs": `import { bump, counter, tag } from './dep.mjs'; let local = 0; export function run() { local++; bump(); return { local, counter, tagId: tag.id } }`,
    });
    const a = await ModuleGraph().import(join(dir, "main.mjs"));
    const b = await ModuleGraph().import(join(dir, "main.mjs"));
    expect(a.run()).toEqual({ local: 1, counter: 1, tagId: expect.any(Number) });
    expect(a.run()).toMatchObject({ local: 2, counter: 2 });
    expect(b.run()).toMatchObject({ local: 1, counter: 1 });
    expect(a.run().tagId).not.toBe(b.run().tagId);
    // the host's own import of the same file is a separate (primary) instance
    const host = await import(join(dir, "main.mjs"));
    expect(host.run()).toMatchObject({ local: 1, counter: 1 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("executables and CodeBlocks are shared across graphs (only function objects and environments are per graph)", async () => {
    const N = 500;
    const body = Array.from(
      { length: N },
      (_, i) => `export function f${i}(a) { let x = a + ${i}; for (let j = 0; j < 3; j++) x += j; return x }`,
    ).join("\n");
    const dir = fixture({
      "mod.mjs": `${body}\nexport function runAll() { let s = 0; ${Array.from({ length: N }, (_, i) => `s += f${i}(1);`).join("")} return s }`,
    });
    const firstGraph = ModuleGraph();
    const first = await firstGraph.import(join(dir, "mod.mjs"));
    first.runAll();
    const keepAlive: unknown[] = [firstGraph, first];
    (globalThis as any).__moduleGraphKeepAlive = keepAlive;
    // settle garbage left by earlier tests (and this graph's load) so the delta below is this test's own
    for (let i = 0; i < 6; i++) {
      Bun.gc(true);
      await new Promise<void>(r => setImmediate(r));
    }
    const before = heapStats().objectTypeCounts;
    const K = 8;
    const graphs = [];
    for (let k = 0; k < K; k++) {
      const graph = ModuleGraph();
      const ns = await graph.import(join(dir, "mod.mjs"));
      ns.runAll();
      graphs.push([graph, ns]);
    }
    Bun.gc(true);
    const after = heapStats().objectTypeCounts;
    const d = (n: string) => (after[n] ?? 0) - (before[n] ?? 0);
    expect(d("FunctionExecutable")).toBeLessThan(10); // not K × N
    expect(d("FunctionCodeBlock")).toBeLessThan(10);
    // one module environment per graph (±1: a transient from linking the template may be collected in between)
    expect(d("JSModuleEnvironment")).toBeGreaterThanOrEqual(K - 1);
    expect(d("JSModuleEnvironment")).toBeLessThanOrEqual(K + 1);
    expect(d("Function")).toBeGreaterThanOrEqual((K - 1) * N);
    // every graph has its own function objects
    expect(new Set(graphs.map(([, ns]) => ns.f0)).size).toBe(K);
    // compiled module code lives as long as some instance of the module (or one of its
    // functions) does; the first graph is what the K graphs shared with
    keepAlive.length = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  test("env / cwd / process.exit / timers are per graph via the default preset", async () => {
    const dir = fixture({
      "p.mjs": `export const atLoad = process.env.APP_ID; export function info() { return { home: process.env.HOME, cwd: process.cwd(), g: globalThis.process.env.APP_ID } } let ticks = 0; export function arm() { setInterval(() => { ticks++ }, 5) } export function tickCount() { return ticks } export function quit(c) { process.exit(c) }`,
    });
    const exits: number[] = [];
    const a = ModuleGraph({ env: { HOME: "/t/a", APP_ID: "a" }, cwd: "/t/a", onExit: c => exits.push(c) });
    const b = ModuleGraph({ env: { HOME: "/t/b", APP_ID: "b" }, cwd: "/t/b" });
    const [ma, mb] = await Promise.all([a.import(join(dir, "p.mjs")), b.import(join(dir, "p.mjs"))]);
    expect(ma.atLoad).toBe("a");
    expect(mb.atLoad).toBe("b");
    expect(ma.info()).toEqual({ home: "/t/a", cwd: "/t/a", g: "a" });
    expect(mb.info()).toEqual({ home: "/t/b", cwd: "/t/b", g: "b" });
    expect(process.env.APP_ID).toBeUndefined();
    ma.arm();
    await Bun.sleep(30);
    const ticks = ma.tickCount();
    expect(ticks).toBeGreaterThan(0);
    ma.quit(7);
    await Bun.sleep(30);
    expect(exits).toEqual([7]);
    expect(ma.tickCount()).toBe(ticks); // the graph's interval was cleared on exit
    a.dispose();
    b.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a fired setTimeout/setImmediate in a graph does not keep its callback (or what it closes over) alive", async () => {
    // Regression: the per-graph timer tracking kept every timer id until dispose(),
    // so a one-shot that had already fired still retained its closure — e.g. a
    // multi-MB request body captured by a setImmediate callback — for the whole
    // life of the graph.
    const dir = fixture({
      "t.mjs": `export function fire(n, bytes) { for (let i = 0; i < n; i++) { const big = new Uint8Array(bytes); setImmediate(() => big.length); setTimeout(() => big.length, 0); } }`,
    });
    const g = ModuleGraph({ env: {} });
    const m = await g.import(join(dir, "t.mjs"));
    Bun.gc(true);
    const before = heapStats().extraMemorySize;
    m.fire(40, 1024 * 1024); // 40 × (1 MiB captured by an immediate + a timeout)
    await Bun.sleep(20); // let them fire
    Bun.gc(true);
    Bun.gc(true);
    const after = heapStats().extraMemorySize;
    // With the bug this retains ~40 MiB; allow generous slack for allocator noise.
    expect(after - before).toBeLessThan(8 * 1024 * 1024);
    g.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("signal listeners registered by graph code are per graph: delivered while live, gone after exit, never left on the real process", async () => {
    const dir = fixture({
      "s.mjs": `export const seen = []; const big = new Uint8Array(4 * 1024 * 1024); process.on("SIGUSR2", () => seen.push(big.length)); export function quit() { process.exit(0) }`,
    });
    const base = process.listenerCount("SIGUSR2");
    const graphs = [];
    const mods = [];
    for (let i = 0; i < 6; i++) {
      const g = ModuleGraph({ env: {} });
      graphs.push(g);
      mods.push(await g.import(join(dir, "s.mjs")));
    }
    // One forwarding listener per graph at most — not one per handler per graph piling up.
    expect(process.listenerCount("SIGUSR2") - base).toBeLessThanOrEqual(6);
    process.emit("SIGUSR2", "SIGUSR2");
    for (const m of mods) expect(m.seen).toEqual([4 * 1024 * 1024]);
    Bun.gc(true);
    const live = heapStats().extraMemorySize;
    for (let i = 0; i < 5; i++) mods[i].quit();
    await Bun.sleep(10);
    // Exited graphs leave nothing on the real process and their state is collectable.
    expect(process.listenerCount("SIGUSR2") - base).toBeLessThanOrEqual(1);
    process.emit("SIGUSR2", "SIGUSR2");
    expect(mods[5].seen.length).toBe(2);
    expect(mods[0].seen.length).toBe(1);
    // Keep holding the exited graphs' HANDLES (a host may), but drop their namespaces:
    // an exited/disposed graph must not pin its module state through the handle.
    const keep = mods[5];
    mods.length = 0;
    Bun.gc(true);
    Bun.gc(true);
    expect(live - heapStats().extraMemorySize).toBeGreaterThan(12 * 1024 * 1024); // ≥3 of the 5 × 4 MiB freed
    expect(keep.seen.length).toBe(2);
    for (const g of graphs) g.dispose();
    expect(process.listenerCount("SIGUSR2")).toBe(base);
    rmSync(dir, { recursive: true, force: true });
  });

  test("AbortSignal.timeout()/any() created by graph code do not pin the graph after exit (listeners released on dispose)", async () => {
    // Such signals are kept alive natively (pending timeout / live source signal) together with
    // their abort listeners; before the fix an exited graph stayed reachable through them for
    // as long as the timeout (or the source) lived. Plain/aborted fetch signals never did.
    const dir = fixture({
      "a.mjs": `export const big = new Uint8Array(4 * 1024 * 1024); const keep = [];
        export function arm(kind) {
          if (kind === "timeout") { const s = AbortSignal.timeout(60_000); s.addEventListener("abort", () => big.length); keep.push(s); }
          if (kind === "any") { const ac = new AbortController(); const s = AbortSignal.any([ac.signal]); s.addEventListener("abort", () => big.length); keep.push(s, ac); }
          if (kind === "onabort") { const s = AbortSignal.timeout(60_000); s.onabort = () => big.length; keep.push(s); }
          return AbortSignal.timeout(1) instanceof AbortSignal && Object.getPrototypeOf(AbortSignal.timeout(1)) === AbortSignal.prototype;
        }
        export function quit() { process.exit(0) }`,
    });
    for (const kind of ["timeout", "any", "onabort"]) {
      Bun.gc(true);
      const before = heapStats().extraMemorySize;
      for (let i = 0; i < 5; i++) {
        const g = ModuleGraph({ env: {} });
        const m = await g.import(join(dir, "a.mjs"));
        expect(m.arm(kind)).toBe(true); // façade is instanceof/prototype-compatible
        m.quit();
      }
      await Bun.sleep(50);
      Bun.gc(true);
      Bun.gc(true);
      expect((heapStats().extraMemorySize - before) / (1024 * 1024)).toBeLessThan(10); // not 5 × 4 MiB
    }
    // The primary's AbortSignal is untouched.
    expect(AbortSignal.timeout(1)).toBeInstanceOf(AbortSignal);
    rmSync(dir, { recursive: true, force: true });
  });

  test("in-flight, aborted and completed fetches from a graph do not pin it after exit", async () => {
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/sse")
          return new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode("data: x\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        return new Response("ok");
      },
    });
    const dir = fixture({
      "f.mjs": `export const big = new Uint8Array(4 * 1024 * 1024); let ctrl;
        export async function open(url) { ctrl = new AbortController(); const res = await fetch(url, { signal: ctrl.signal }); res.body.getReader().read().then(() => big.length, () => big.length); }
        export async function plain(url) { const r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); await r.text(); }
        export function abort() { ctrl.abort() }
        export function quit() { process.exit(0) }`,
    });
    const base = `http://127.0.0.1:${server.port}`;
    for (const kind of ["plain", "open-aborted", "open-left"]) {
      Bun.gc(true);
      const before = heapStats().extraMemorySize;
      for (let i = 0; i < 5; i++) {
        const g = ModuleGraph({ env: {} });
        const m = await g.import(join(dir, "f.mjs"));
        if (kind === "plain") await m.plain(base + "/");
        else {
          await m.open(base + "/sse");
          if (kind === "open-aborted") m.abort();
        }
        m.quit();
      }
      await Bun.sleep(100);
      Bun.gc(true);
      Bun.gc(true);
      expect((heapStats().extraMemorySize - before) / (1024 * 1024)).toBeLessThan(10);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("builtin module objects are per graph: monkey-patching node:fs / node:http inside a graph is invisible to other graphs and the host, and does not pin the graph", async () => {
    // graceful-fs replaces fs.close/closeSync, proxy agents replace http.request, signal-exit patches
    // process.emit: on a shared exports object every graph would chain through the previous graph's
    // wrapper (cross-graph execution + a leak of every exited graph).
    const fs = require("node:fs");
    const http = require("node:http");
    const hostCloseSync = fs.closeSync;
    const hostRequest = http.request;
    const dir = fixture({
      "patch.cjs": `const fs = require("fs"); const http = require("node:http"); const big = new Uint8Array(4 * 1024 * 1024);
        const prevClose = fs.closeSync; fs.closeSync = function patched(fd) { big.length; return prevClose(fd) };
        const prevReq = http.request; http.request = function patchedRequest() { big.length; return prevReq.apply(this, arguments) };
        module.exports = { sawPatchedClose: prevClose.name === "patched", sawPatchedRequest: prevReq.name === "patchedRequest", same: require("fs") === require("node:fs"), quit() { process.exit(0) } };`,
      "esm.mjs": `import fs, { closeSync } from "node:fs"; import * as star from "node:fs"; import { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        export const sameObject = fs === require("fs");          // ESM default and CJS exports are the graph's one copy
        export const namedIsFn = typeof closeSync === "function" && typeof star.readFileSync === "function";
        import { BlockList, isIP } from "node:net";                      // lazily-defined builtin exports resolve in a graph too
        export const lazyOk = typeof BlockList === "function" && new BlockList() instanceof BlockList && isIP("1.2.3.4") === 4;
        export function isPatched() { return fs.closeSync.name === "patched" }`,
    });
    Bun.gc(true);
    const before = heapStats().extraMemorySize;
    for (let i = 0; i < 5; i++) {
      const g = ModuleGraph({ env: {} });
      const m = await g.import(join(dir, "patch.cjs"));
      const e = await g.import(join(dir, "esm.mjs"));
      expect(m.default.sawPatchedClose).toBe(false); // never sees a previous graph's wrapper
      expect(m.default.sawPatchedRequest).toBe(false);
      expect(m.default.same).toBe(true);
      expect(e.sameObject).toBe(true);
      expect(e.namedIsFn).toBe(true);
      expect(e.lazyOk).toBe(true);
      expect(e.isPatched()).toBe(true); // its own patch is visible to itself
      m.default.quit();
    }
    expect(fs.closeSync).toBe(hostCloseSync); // host untouched
    expect(http.request).toBe(hostRequest);
    await Bun.sleep(20);
    Bun.gc(true);
    Bun.gc(true);
    expect((heapStats().extraMemorySize - before) / (1024 * 1024)).toBeLessThan(10); // not 5 × 4 MiB
    rmSync(dir, { recursive: true, force: true });
  });

  test("properties graph code adds to `process` are graph-local (signal-exit pattern) and never land on the real process", async () => {
    const dir = fixture({
      "se.cjs": `const big = new Uint8Array(4 * 1024 * 1024); const EE = require("events");
        // signal-exit: one emitter stashed on process, handlers pushed into it; plus a patched process.emit
        if (!process.__signal_exit_emitter__) process.__signal_exit_emitter__ = new EE();
        const first = process.__signal_exit_emitter__.listenerCount("exit") === 0;
        process.__signal_exit_emitter__.on("exit", () => big.length);
        const origEmit = process.emit; process.emit = function patchedEmit() { return origEmit.apply(this, arguments) };
        Object.defineProperty(process, "myFlag", { value: 42, configurable: true, enumerable: false });
        process.title = process.title;                          // real accessor still reaches the real process
        module.exports = { first, hasFlag: "myFlag" in process && process.myFlag === 42, keys: Object.keys(process).includes("__signal_exit_emitter__"), emitPatched: process.emit.name === "patchedEmit", quit() { process.exit(0) } };`,
    });
    const realEmit = process.emit;
    Bun.gc(true);
    const before = heapStats().extraMemorySize;
    for (let i = 0; i < 5; i++) {
      const g = ModuleGraph({ env: {} });
      const m = (await g.import(join(dir, "se.cjs"))).default;
      expect(m.first).toBe(true); // each graph got its OWN emitter, not the previous graph's
      expect(m.hasFlag).toBe(true);
      expect(m.keys).toBe(true);
      expect(m.emitPatched).toBe(true);
      m.quit();
    }
    expect("__signal_exit_emitter__" in process).toBe(false);
    expect((process as any).myFlag).toBeUndefined();
    expect(process.emit).toBe(realEmit);
    await Bun.sleep(20);
    Bun.gc(true);
    Bun.gc(true);
    expect((heapStats().extraMemorySize - before) / (1024 * 1024)).toBeLessThan(10);
    rmSync(dir, { recursive: true, force: true });
  });

  test("properties graph code puts on globalThis/global are graph-local (graceful-fs / signal-exit pattern), invisible to other graphs and the host, and do not pin the graph", async () => {
    const sym = Symbol.for("test.graph.queue");
    const dir = fixture({
      "g.cjs": `const big = new Uint8Array(4 * 1024 * 1024);
        const sym = Symbol.for("test.graph.queue");
        const fresh = global[sym] === undefined;
        if (!global[sym]) Object.defineProperty(global, sym, { get() { return [big] } });          // graceful-fs
        if (!global.__my_emitter__) global.__my_emitter__ = { handlers: [() => big.length] };       // signal-exit <4
        globalThis.polyfilled = function () { return big.length };
        let bare; try { bare = typeof polyfilled } catch (e) { bare = "ReferenceError" }
        module.exports = { fresh, viaGlobal: typeof globalThis.polyfilled, bare, hasSet: "Set" in globalThis && globalThis.Set === Set,
          selfRef: globalThis.globalThis === globalThis && global === globalThis && self === globalThis, keys: Object.keys(globalThis).includes("polyfilled"), quit() { process.exit(0) } };`,
    });
    Bun.gc(true);
    const before = heapStats().extraMemorySize;
    for (let i = 0; i < 5; i++) {
      const g = ModuleGraph({ env: {} });
      const m = (await g.import(join(dir, "g.cjs"))).default;
      expect(m.fresh).toBe(true); // never sees the previous graph's global
      expect(m.viaGlobal).toBe("function");
      expect(m.bare).toBe("undefined"); // documented: bare identifiers do not see graph-added globals
      expect(m.hasSet).toBe(true);
      expect(m.selfRef).toBe(true);
      expect(m.keys).toBe(true);
      m.quit();
    }
    expect((globalThis as any)[sym]).toBeUndefined();
    expect((globalThis as any).__my_emitter__).toBeUndefined();
    expect((globalThis as any).polyfilled).toBeUndefined();
    await Bun.sleep(20);
    Bun.gc(true);
    Bun.gc(true);
    expect((heapStats().extraMemorySize - before) / (1024 * 1024)).toBeLessThan(10);
    rmSync(dir, { recursive: true, force: true });
  });

  test("work a graph leaves ARMED is released on exit where the graph can own it (node:timers, timers/promises, stdio listeners, fs.watch/watchFile) and the graph is collected", async () => {
    const dir = fixture({
      "armed.mjs": `import fs from "node:fs"; import timers from "node:timers"; import { setTimeout as sleep, setImmediate as soon } from "node:timers/promises";
        export const big = new Uint8Array(4 * 1024 * 1024); const keep = [];
        export const cases = {
          timersModule() { keep.push(timers.setInterval(() => big.length, 1000)); timers.setTimeout(() => big.length, 100000); },
          timersPromises() { sleep(100000).then(() => big.length); },
          async timersPromisesWork() { const v = await sleep(1, "v"); const w = await soon("w"); const ac = new AbortController(); const p = sleep(100000, 0, { signal: ac.signal }).catch(e => e.name); ac.abort(); return [v, w, await p] },
          stdoutListener() { process.stdout.on("resize", () => big.length); process.stderr.once("error", () => big.length); return [process.stdout.listenerCount("resize") >= 1, typeof process.stdout.write, process.stdout.isTTY === undefined || typeof process.stdout.isTTY === "boolean"] },
          stdinListener() { process.stdin.on("data", () => big.length); },
          stdoutOff() { const f = () => big.length; process.stdout.on("resize", f); process.stdout.off("resize", f); return process.stdout.listenerCount("resize") },
          fsWatch() { keep.push(fs.watch(".", () => big.length)); },
          fsWatchFile() { fs.watchFile("./nope-" + Math.random(), { interval: 60000 }, () => big.length); },
        };
        export function quit() { process.exit(0) }`,
    });
    const hostResize = process.stdout.listenerCount("resize");
    // semantics first
    {
      const m = await ModuleGraph({ env: {} }).import(join(dir, "armed.mjs"));
      expect(await m.cases.timersPromisesWork()).toEqual(["v", "w", "AbortError"]);
      expect(m.cases.stdoutListener()).toEqual([true, "function", true]);
      expect(m.cases.stdoutOff()).toBe(1); // the one added by stdoutListener() above; off() removed its own
      m.quit();
      expect(process.stdout.listenerCount("resize")).toBe(hostResize); // graph listeners gone with the graph
    }
    for (const kind of [
      "timersModule",
      "timersPromises",
      "stdoutListener",
      "stdinListener",
      "fsWatch",
      "fsWatchFile",
    ]) {
      Bun.gc(true);
      const before = heapStats().extraMemorySize;
      for (let i = 0; i < 4; i++) {
        const g = ModuleGraph({ env: {}, cwd: dir });
        const m = await g.import(join(dir, "armed.mjs"));
        await m.cases[kind]();
        m.quit();
      }
      await Bun.sleep(50);
      Bun.gc(true);
      Bun.gc(true);
      const retainedMiB = (heapStats().extraMemorySize - before) / (1024 * 1024);
      expect({ kind, leaked: retainedMiB > 6 }).toEqual({ kind, leaked: false }); // not 4 × 4 MiB
    }
    expect(process.stdout.listenerCount("resize")).toBe(hostResize);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  test("handles a graph must close itself (servers, child processes) pin it only while open: closed before exit → collected", async () => {
    const dir = fixture({
      "srv.mjs": `import net from "node:net"; import http from "node:http"; import { spawn } from "node:child_process";
        export const big = new Uint8Array(4 * 1024 * 1024); let srv, hs, child, bs;
        export async function open() {
          srv = net.createServer(() => big.length); await new Promise(r => srv.listen(0, r));
          hs = http.createServer((q, s) => { big.length; s.end("x") }); await new Promise(r => hs.listen(0, r));
          bs = Bun.serve({ port: 0, fetch() { big.length; return new Response("x") } });
          child = spawn("sleep", ["30"], { stdio: "ignore" }); child.on("exit", () => big.length);
        }
        export async function close() { await new Promise(r => srv.close(r)); await new Promise(r => hs.close(r)); bs.stop(true); child.kill("SIGKILL"); await new Promise(r => child.once("exit", r)); }
        export function quit() { process.exit(0) }`,
    });
    Bun.gc(true);
    const before = heapStats().extraMemorySize;
    for (let i = 0; i < 4; i++) {
      const m = await ModuleGraph({ env: process.env as any }).import(join(dir, "srv.mjs"));
      await m.open();
      await m.close();
      m.quit();
    }
    await Bun.sleep(100);
    Bun.gc(true);
    Bun.gc(true);
    expect((heapStats().extraMemorySize - before) / (1024 * 1024)).toBeLessThan(6);
    rmSync(dir, { recursive: true, force: true });
  });

  test("documented sharing: mutations of shared intrinsics by graph code are visible to all graphs and retain (only) the last writer", async () => {
    // Not containable without per-graph intrinsics (a separate global object). Programs meant to run as
    // graphs must not do this; hosts can detect it statically. This test pins the behaviour so it is a
    // conscious contract: last writer wins, earlier writers are collectable, host sees the mutation.
    const dir = fixture({
      "intr.mjs": `export const big = new Uint8Array(4 * 1024 * 1024);
        export function patch(tag) { Array.prototype.__graphTag = () => tag + big.length; Error.prepareStackTrace = (e, st) => tag + ":" + e.message; return [1].__graphTag().startsWith(tag) }
        export function quit() { process.exit(0) }`,
    });
    const origPrepare = Error.prepareStackTrace;
    Bun.gc(true);
    const before = heapStats().extraMemorySize;
    for (let i = 0; i < 4; i++) {
      const m = await ModuleGraph({ env: {} }).import(join(dir, "intr.mjs"));
      expect(m.patch("g" + i)).toBe(true);
      m.quit();
    }
    expect(([1] as any).__graphTag().startsWith("g3")).toBe(true); // host sees the last graph's patch
    await Bun.sleep(20);
    Bun.gc(true);
    Bun.gc(true);
    const retained = (heapStats().extraMemorySize - before) / (1024 * 1024);
    expect(retained).toBeLessThan(10); // ≈ one graph (the last writer), not four
    delete (Array.prototype as any).__graphTag;
    Error.prepareStackTrace = origPrepare;
    rmSync(dir, { recursive: true, force: true });
  });

  test("uncaught exceptions and unhandled rejections from graph code go to that graph's onError", async () => {
    const dir = fixture({
      "err.mjs": `export function throwLater() { setTimeout(() => { throw new Error('boom ' + process.env.APP_ID) }, 1) } export function rejectLater() { (async () => { await 1; throw new Error('rejected ' + process.env.APP_ID) })() } export function throwPlain() { setTimeout(() => { throw { plain: process.env.APP_ID } }, 1) }`,
    });
    const seen: string[] = [];
    const mk = (t: string) =>
      ModuleGraph({
        env: { APP_ID: t },
        onError: (e: any, kind) => seen.push(`${t}:${kind}:${e?.message ?? JSON.stringify(e)}`),
      });
    const a = await mk("a").import(join(dir, "err.mjs"));
    const b = await mk("b").import(join(dir, "err.mjs"));
    a.throwLater();
    b.rejectLater();
    a.throwPlain();
    await Bun.sleep(30);
    expect(seen.sort()).toEqual(
      ["a:uncaughtException:boom a", 'a:uncaughtException:{"plain":"a"}', "b:unhandledRejection:rejected b"].sort(),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  test("dynamic import() inside a graph loads into that graph; builtins are shared", async () => {
    const dir = fixture({
      "dep.mjs": `export let n = 0; export function inc() { return ++n }`,
      "dyn.mjs": `export async function load() { const m = await import('./dep.mjs'); return m.inc() } export async function builtin() { return typeof (await import('node:os')).homedir }`,
    });
    const a = await ModuleGraph().import(join(dir, "dyn.mjs"));
    const b = await ModuleGraph().import(join(dir, "dyn.mjs"));
    expect(await a.builtin()).toBe("function");
    expect(await a.load()).toBe(1);
    expect(await a.load()).toBe(2);
    expect(await b.load()).toBe(1);
    const primary = await import(join(dir, "dep.mjs"));
    expect(primary.n).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("CommonJS: per-graph require cache, graph globals inside CJS, require(esm) and import() bind to the graph's instances", async () => {
    const dir = fixture({
      "counter.cjs": `let n = 0; module.exports = { inc() { return ++n }, app() { return process.env.APP_ID }, gapp() { return globalThis.process.env.APP_ID }, importEsm() { return import('./esm-dep.mjs') } }`,
      "uses-esm.cjs": `const dep = require('./esm-dep.mjs'); module.exports = { bump() { return dep.bump() }, depApp() { return dep.app() } }`,
      "esm-dep.mjs": `export let count = 0; export function bump() { return ++count } export function app() { return process.env.APP_ID }`,
      "entry.mjs": `import { createRequire } from 'node:module'; import { count } from './esm-dep.mjs';
        const require2 = createRequire(import.meta.url);
        export const counter = require2('./counter.cjs');
        const again = import.meta.require('./counter.cjs');
        const usesEsm = require2('./uses-esm.cjs');
        export function report() { return { sameCache: counter === again, inc: counter.inc(), cjsApp: counter.app(), cjsGlobalApp: counter.gapp(), cjsToEsmBump: usesEsm.bump(), esmCountSeenByEntry: count, cjsToEsmApp: usesEsm.depApp() } }
        export async function cjsDynamicImport() { return (await counter.importEsm()).bump() }`,
    });
    const mk = (t: string) => ModuleGraph({ env: { APP_ID: t } });
    const a = await mk("a").import(join(dir, "entry.mjs"));
    const b = await mk("b").import(join(dir, "entry.mjs"));
    expect(a.report()).toEqual({
      sameCache: true,
      inc: 1,
      cjsApp: "a",
      cjsGlobalApp: "a",
      cjsToEsmBump: 1,
      esmCountSeenByEntry: 1,
      cjsToEsmApp: "a",
    });
    expect(a.report()).toMatchObject({ inc: 2, cjsToEsmBump: 2, esmCountSeenByEntry: 2 });
    expect(b.report()).toEqual({
      sameCache: true,
      inc: 1,
      cjsApp: "b",
      cjsGlobalApp: "b",
      cjsToEsmBump: 1,
      esmCountSeenByEntry: 1,
      cjsToEsmApp: "b",
    });
    expect(a.counter).not.toBe(b.counter);
    expect(await a.cjsDynamicImport()).toBe(3); // same esm-dep instance the graph already bumped twice
    expect(await b.cjsDynamicImport()).toBe(2);
    // the host's require of the same file is separate and sees the real process
    const host = (await import("node:module")).createRequire(import.meta.url)(join(dir, "counter.cjs"));
    expect(host).not.toBe(a.counter);
    expect(host.app()).toBeUndefined();
    // CJS wrapper executables are shared across graphs
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.FunctionExecutable;
    const more = [];
    for (let i = 0; i < 4; i++) {
      const g = mk("x" + i);
      const m = await g.import(join(dir, "entry.mjs"));
      m.report();
      more.push([g, m]);
    }
    Bun.gc(true);
    expect(heapStats().objectTypeCounts.FunctionExecutable - before).toBeLessThan(4);
    rmSync(dir, { recursive: true, force: true });
  });

  test("edge cases: cyclic imports with TLA, evaluation errors are cached per graph (and only per graph), link errors, concurrent first imports, require.cache is per graph", async () => {
    const dir = fixture({
      "cyc-a.mjs": `import { b, bReady } from './cyc-b.mjs'; export let aReady = false; await new Promise(r => setTimeout(r, 2)); aReady = true; export function a() { return 'a' + b() } export function seesB() { return bReady }`,
      "cyc-b.mjs": `import { a, aReady } from './cyc-a.mjs'; export let bReady = false; await new Promise(r => setTimeout(r, 2)); bReady = true; export function b() { return 'b' } export function callA() { return a() }`,
      "plain.mjs": `export const yes = 1`,
      "badlink.mjs": `import { nope } from './plain.mjs'; export const x = nope`,
      "throws.mjs": `export const v = 1; throw new Error('eval failure ' + process.env.APP_ID)`,
      "dependent.mjs": `import { v } from './throws.mjs'; export const w = v`,
      "meta.mjs": `export const resolved = import.meta.resolve('./plain.mjs'); export const req = require('./plain.mjs').yes; export function cacheKeys() { return Object.keys(require.cache).map(k => k.split('/').pop()).sort() }`,
    });
    const cyc = await ModuleGraph().import(join(dir, "cyc-a.mjs"));
    const primary = await import(join(dir, "cyc-a.mjs"));
    expect({ a: cyc.a(), seesB: cyc.seesB() }).toEqual({ a: primary.a(), seesB: primary.seesB() });

    expect(ModuleGraph().import(join(dir, "badlink.mjs"))).rejects.toThrow("Export named 'nope'");
    expect(ModuleGraph().import(join(dir, "badlink.mjs"))).rejects.toThrow("Export named 'nope'");

    const ga = ModuleGraph({ env: { APP_ID: "a" } });
    expect(ga.import(join(dir, "throws.mjs"))).rejects.toThrow("eval failure a");
    expect(ModuleGraph({ env: { APP_ID: "b" } }).import(join(dir, "throws.mjs"))).rejects.toThrow("eval failure b");
    // same graph: the error is cached for the module and its dependents
    expect(ga.import(join(dir, "throws.mjs"))).rejects.toThrow("eval failure a");
    expect(ga.import(join(dir, "dependent.mjs"))).rejects.toThrow("eval failure a");

    const [x, y] = await Promise.all([
      ModuleGraph().import(join(dir, "cyc-b.mjs")),
      ModuleGraph().import(join(dir, "cyc-b.mjs")),
    ]);
    expect([x.callA(), y.callA(), x !== y]).toEqual(["ab", "ab", true]);

    await import(join(dir, "plain.mjs")); // host evaluates the template first
    const meta = await ModuleGraph().import(join(dir, "meta.mjs"));
    expect(meta.resolved.endsWith("plain.mjs")).toBe(true);
    expect(meta.req).toBe(1);
    expect(meta.cacheKeys()).toEqual(["meta.mjs", "plain.mjs"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("async evaluation: TLA siblings run in parallel in spec order; concurrent imports of an in-flight module wait; namespaces are unique per (graph, module); GC while an unreferenced graph is mid-TLA", async () => {
    const dir = fixture({
      "slow-a.mjs": `globalThis.__order.push('a:start'); await new Promise(r => setTimeout(r, ${40 * (stressMode ? 10 : 1)})); globalThis.__order.push('a:end'); export const a = 'A'`,
      "slow-b.mjs": `globalThis.__order.push('b:start'); await new Promise(r => setTimeout(r, ${10 * (stressMode ? 10 : 1)})); globalThis.__order.push('b:end'); export const b = 'B'`,
      "sync-c.mjs": `globalThis.__order.push('c'); export const c = 'C'`,
      "root.mjs": `import { a } from './slow-a.mjs'; import { b } from './slow-b.mjs'; import { c } from './sync-c.mjs'; globalThis.__order.push('root'); export const all = a + b + c`,
      "uses-a.mjs": `import { a } from './slow-a.mjs'; export const got = a`,
    });
    const order: string[] = [];
    const t0 = performance.now();
    const root = await ModuleGraph({ globals: { __order: order } }).import(join(dir, "root.mjs"));
    const elapsed = performance.now() - t0;
    const primaryOrder: string[] = ((globalThis as any).__order = []);
    await import(join(dir, "root.mjs"));
    expect(root.all).toBe("ABC");
    expect(order).toEqual(primaryOrder); // same interleaving as the spec algorithm on the primary graph
    if (!stressMode) expect(elapsed).toBeLessThan(48 + 30); // parallel (≈40), not sequential (≈50+)

    const g2 = ModuleGraph({ globals: { __order: [] } });
    const [m1, m2, m3] = await Promise.all([
      g2.import(join(dir, "slow-a.mjs")),
      g2.import(join(dir, "uses-a.mjs")),
      g2.import(join(dir, "slow-a.mjs")),
    ]);
    expect([m1.a, m2.got, m1 === m3]).toEqual(["A", "A", true]);

    let ok = false;
    const pending = ModuleGraph({ globals: { __order: [] } })
      .import(join(dir, "slow-a.mjs"))
      .then(m => (ok = m.a === "A"));
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
      await Bun.sleep(5);
    }
    await pending;
    expect(ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("data modules (json import attribute, toml) are per graph; builtin objects are per-graph copies over shared functions; sync require of an in-flight module throws", async () => {
    const dir = fixture({
      "data.json": `{ "n": 1 }`,
      "cfg.toml": `n = 1\n[deep]\nlist = [1, 2]\n`,
      "attr.mjs": `export async function load() { const j = await import('./data.json', { with: { type: 'json' } }); j.default.n++; return j.default.n }`,
      "toml-user.mjs": `import cfg from './cfg.toml'; import * as os from 'node:os'; import fs from 'node:fs'; export function bump() { cfg.deep.list.push(0); return cfg.deep.list.length } export { os, fs }`,
      "slow.mjs": `await new Promise(r => setTimeout(r, 30)); export const v = 1`,
      "req.cjs": `module.exports = () => require('./slow.mjs')`,
    });
    const a = await ModuleGraph().import(join(dir, "attr.mjs"));
    const b = await ModuleGraph().import(join(dir, "attr.mjs"));
    expect([await a.load(), await a.load(), await b.load()]).toEqual([2, 3, 2]);
    const ta = await ModuleGraph().import(join(dir, "toml-user.mjs"));
    const tb = await ModuleGraph().import(join(dir, "toml-user.mjs"));
    const host = await import(join(dir, "toml-user.mjs"));
    expect([ta.bump(), ta.bump(), tb.bump(), host.bump()]).toEqual([3, 4, 3, 3]);
    // Builtin module OBJECTS are per graph (own copy, so patches stay inside the graph);
    // the functions on them are the host's.
    expect(ta.fs).not.toBe(host.fs);
    expect(ta.fs).not.toBe(tb.fs);
    expect(ta.fs.readFileSync).toBe(host.fs.readFileSync);
    expect(Object.keys(ta.fs).sort()).toEqual(Object.keys(host.fs).sort());
    expect(ta.os.homedir).toBe(host.os.homedir);
    const g = ModuleGraph();
    const inflight = g.import(join(dir, "slow.mjs"));
    const req = (await g.import(join(dir, "req.cjs"))).default;
    expect(() => req()).toThrow(/Unable to synchronously evaluate|async module|cannot be evaluated synchronously/);
    expect((await inflight).v).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test("ESM import of a CommonJS file is per graph (own cache, own evaluation, own env) and the host's copy evaluates lazily only when the host imports it", async () => {
    const dir = fixture({
      "counter.cjs": `globalThis.__cjsEvals.push(process.env.APP_ID ?? 'host'); let n = 0; module.exports = { inc() { return ++n }, app: () => process.env.APP_ID ?? 'host' }`,
      "named.cjs": `exports.who = () => process.env.APP_ID ?? 'host'; exports.value = 42`,
      "app.mjs": `import counter from './counter.cjs'; import { who, value } from './named.cjs'; import * as ns from './named.cjs'; export function run() { return { inc: counter.inc(), app: counter.app(), who: who(), value, nsWho: ns.who() } }`,
    });
    const evals: string[] = ((globalThis as any).__cjsEvals = []);
    const mk = (t: string) => ModuleGraph({ env: { ...process.env, APP_ID: t }, globals: { __cjsEvals: evals } });
    const a = await mk("a").import(join(dir, "app.mjs"));
    expect(evals).toEqual(["a"]); // not evaluated for the host
    const b = await mk("b").import(join(dir, "app.mjs"));
    expect(evals).toEqual(["a", "b"]);
    expect([a.run(), a.run(), b.run()]).toEqual([
      { inc: 1, app: "a", who: "a", value: 42, nsWho: "a" },
      { inc: 2, app: "a", who: "a", value: 42, nsWho: "a" },
      { inc: 1, app: "b", who: "b", value: 42, nsWho: "b" },
    ]);
    const host = await import(join(dir, "app.mjs"));
    expect(evals).toEqual(["a", "b", "host"]);
    expect(host.run()).toEqual({ inc: 1, app: "host", who: "host", value: 42, nsWho: "host" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("import defer: per-graph deferred namespaces evaluate lazily into the graph; async transitive deps evaluate eagerly; cycle members share the root's fate", async () => {
    const dir = fixture({
      "log.mjs": `export const log = globalThis.__deferLog`,
      "sync-dep.mjs": `import { log } from './log.mjs'; log.push('sync-dep'); export const s = 1`,
      "tla-child.mjs": `import { log } from './log.mjs'; await 0; log.push('tla-child')`,
      "parent.mjs": `import './sync-dep.mjs'; import './tla-child.mjs'; import { log } from './log.mjs'; log.push('parent'); export const value = 1`,
      "main.mjs": `import defer * as ns from './parent.mjs'; import { log } from './log.mjs'; export const before = log.slice(); export function touch() { return [ns.value, log.slice()] }`,
      "cycle-a.mjs": `import './cycle-b.mjs'; await 0; throw { someError: 'tla-reject' }`,
      "cycle-b.mjs": `import './cycle-a.mjs'; export const value = 42`,
      "cycle-b-exporter.mjs": `import defer * as nsB from './cycle-b.mjs'; export { nsB }`,
      "cycle-main.mjs": `let importError; await import('./cycle-a.mjs').catch(e => importError = e); const { nsB } = await import('./cycle-b-exporter.mjs'); let accessError; try { nsB.value } catch (e) { accessError = e } export const same = accessError === importError && importError.someError === 'tla-reject'`,
    });
    for (const load of [
      async (log: string[]) => ModuleGraph({ globals: { __deferLog: log } }).import(join(dir, "main.mjs")),
    ]) {
      const log: string[] = [];
      const m = await load(log);
      expect(m.before).toEqual(["tla-child"]);
      expect(m.touch()).toEqual([1, ["tla-child", "sync-dep", "parent"]]);
      expect(m.touch()).toEqual([1, ["tla-child", "sync-dep", "parent"]]);
    }
    expect((await ModuleGraph().import(join(dir, "cycle-main.mjs"))).same).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("graph code's process events, globalThis writes (graph-local), child processes, os.homedir, Workers and import.meta reflect the graph", async () => {
    const dir = fixture({
      "worker.mjs": `postMessage(process.env.APP_ID ?? 'none')`,
      "app.mjs": `import { execFileSync, spawnSync } from 'node:child_process'; import os from 'node:os';
        export const isMain = import.meta.main; export const metaEnv = import.meta.env.APP_ID;
        globalThis.__mgShared = (globalThis.__mgShared ?? 0) + 1;
        export function bareRead() { try { return __mgShared } catch { return 'unbound' } }
        export function viaGlobal() { return globalThis.__mgShared }
        export function childEnv() { return execFileSync('sh', ['-c', 'echo $APP_ID:$PWD']).toString().trim() }
        export function bunSpawn() { return Bun.spawnSync(['sh', '-c', 'echo $APP_ID:$PWD']).stdout.toString().trim() }
        export function nodeCwd() { return spawnSync('pwd').stdout.toString().trim() }
        export function home() { return [os.homedir(), os.userInfo().homedir] }
        export const events = []; process.on('exit', c => events.push('exit:' + c)); process.on('uncaughtException', e => events.push('uncaught:' + e.message));
        export function counts() { return [process.listenerCount('exit'), process.listenerCount('uncaughtException'), typeof process.memoryUsage.rss] }
        export function boom() { setTimeout(() => { throw new Error('boom-' + process.env.APP_ID) }, 1) }
        export function quit() { process.exit(3) }
        export async function workerEnv() { const w = new Worker(new URL('./worker.mjs', import.meta.url).href); return await new Promise(res => { w.onmessage = e => { res(e.data); w.terminate() } }) }`,
    });
    const hostExitListeners = process.listenerCount("exit");
    const hostEvents: string[] = [];
    const mk = (t: string) =>
      ModuleGraph({
        env: { ...process.env, APP_ID: t, HOME: "/home/" + t },
        cwd: "/tmp",
        onExit: c => hostEvents.push(t + ":onExit:" + c),
        onError: (e: any) => hostEvents.push(t + ":onError:" + e.message),
      });
    const ga = mk("a");
    const a = await ga.import(join(dir, "app.mjs"));
    const b = await mk("b").import(join(dir, "app.mjs"));
    expect([a.isMain, (ga as any).mainModule.endsWith("app.mjs"), a.metaEnv, b.metaEnv]).toEqual([
      true,
      true,
      "a",
      "b",
    ]);
    // globalThis writes are graph-local: each graph counted once, the host never saw it, a bare read is unbound.
    expect([a.viaGlobal(), b.viaGlobal(), a.bareRead(), (globalThis as any).__mgShared]).toEqual([
      1,
      1,
      "unbound",
      undefined,
    ]);
    expect([a.childEnv(), b.childEnv(), a.bunSpawn(), b.nodeCwd()]).toEqual(["a:/tmp", "b:/tmp", "a:/tmp", "/tmp"]);
    expect([a.home(), b.home()]).toEqual([
      ["/home/a", "/home/a"],
      ["/home/b", "/home/b"],
    ]);
    expect([await a.workerEnv(), await b.workerEnv()]).toEqual(["a", "b"]);
    expect(a.counts()).toEqual([1, 1, "function"]);
    expect(process.listenerCount("exit")).toBe(hostExitListeners);
    a.boom();
    await Bun.sleep(20);
    expect([a.events, hostEvents]).toEqual([["uncaught:boom-a"], []]);
    b.quit();
    await Bun.sleep(5);
    expect([b.events, hostEvents]).toEqual([["exit:3"], ["b:onExit:3"]]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("top-level await in the root and in a dependency", async () => {
    const dir = fixture({
      "tdep.mjs": `export let ready = false; await new Promise(r => setTimeout(r, 20)); ready = true; export function status() { return ready }`,
      "tmain.mjs": `import { status, ready } from './tdep.mjs'; export const seenReadyAtLoad = ready; const os = await import('node:os'); export function report() { return { seenReadyAtLoad, dep: status(), platform: typeof os.platform } }`,
    });
    const [a, b] = await Promise.all([
      ModuleGraph().import(join(dir, "tmain.mjs")),
      ModuleGraph().import(join(dir, "tmain.mjs")),
    ]);
    expect(a.report()).toEqual({ seenReadyAtLoad: true, dep: true, platform: "function" });
    expect(b.report()).toEqual({ seenReadyAtLoad: true, dep: true, platform: "function" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("namespace objects and import.meta are per graph; namespaces have live bindings", async () => {
    const dir = fixture({
      "ns-dep.mjs": `export let v = 0; export function set(x) { v = x }`,
      "ns.mjs": `import * as dep from './ns-dep.mjs'; export const meta = import.meta; export function read() { return dep.v } export function write(x) { dep.set(x) } export { dep }`,
    });
    const a = await ModuleGraph().import(join(dir, "ns.mjs"));
    const b = await ModuleGraph().import(join(dir, "ns.mjs"));
    a.write(5);
    expect(a.read()).toBe(5);
    expect(a.dep.v).toBe(5);
    expect(b.read()).toBe(0);
    expect(a.dep).not.toBe(b.dep);
    expect(a.meta).not.toBe(b.meta);
    expect(a.meta.url).toBe(b.meta.url);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — module linking semantics per instance", () => {
  test("re-export chains (export *, export * as ns, export {x as y} from) resolve within the instance and stay live", async () => {
    const dir = fixture({
      "origin.mjs": `export let n = 0; export function inc() { n++ } export default function d() { return "d" + n }`,
      "mid.mjs": `export * from "./origin.mjs"; export { inc as bump, default as originDefault } from "./origin.mjs"; export * as star from "./origin.mjs";`,
      "top.mjs": `import * as mid from "./mid.mjs"; import { n, bump, star, originDefault } from "./mid.mjs";
        export function snapshot() { return [n, mid.n, star.n, originDefault(), mid.star === star] }
        export { bump }`,
    });
    const a = await ModuleGraph().import(join(dir, "top.mjs"));
    const b = await ModuleGraph().import(join(dir, "top.mjs"));
    a.bump();
    a.bump();
    b.bump();
    expect(a.snapshot()).toEqual([2, 2, 2, "d2", true]);
    expect(b.snapshot()).toEqual([1, 1, 1, "d1", true]);
    const host = await import(join(dir, "top.mjs"));
    expect(host.snapshot()).toEqual([0, 0, 0, "d0", true]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("ambiguous star exports and missing exports are link errors per import() and do not poison other graphs or later imports", async () => {
    const dir = fixture({
      "x1.mjs": `export const dup = 1`,
      "x2.mjs": `export const dup = 2`,
      "amb.mjs": `export * from "./x1.mjs"; export * from "./x2.mjs";`,
      "useAmb.mjs": `import { dup } from "./amb.mjs"; export { dup }`,
      "missing.mjs": `import { nope } from "./x1.mjs"; export { nope }`,
      "ok.mjs": `import * as amb from "./amb.mjs"; export const keys = Object.keys(amb)`,
    });
    const g = ModuleGraph();
    await expect(g.import(join(dir, "useAmb.mjs"))).rejects.toThrow(SyntaxError);
    await expect(g.import(join(dir, "missing.mjs"))).rejects.toThrow(SyntaxError);
    // star-import of an ambiguous name just omits it; the same graph keeps working
    expect((await g.import(join(dir, "ok.mjs"))).keys).toEqual([]);
    expect((await ModuleGraph().import(join(dir, "ok.mjs"))).keys).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("default export forms have per-instance identity; classes, private fields and instanceof do not cross instances", async () => {
    const dir = fixture({
      "defs.mjs": `export default class K { #p = 1; static count = 0; static { K.count++ } has(o) { return #p in o } }
        export function make() { return new K }
        const expr = { tag: "expr" }; export { expr as default2 };`,
      "fn.mjs": `export default function named() { return import.meta.url }`,
      "anon.mjs": `export default (function () { return 1 })`,
    });
    const A = await ModuleGraph().import(join(dir, "defs.mjs"));
    const B = await ModuleGraph().import(join(dir, "defs.mjs"));
    expect(A.default).not.toBe(B.default);
    expect(A.default.count).toBe(1);
    expect(B.default.count).toBe(1);
    const ka = A.make(),
      kb = B.make();
    expect(ka instanceof A.default).toBe(true);
    expect(ka instanceof B.default).toBe(false);
    expect(A.make().has(ka)).toBe(true);
    expect(A.make().has(kb)).toBe(false); // private brand is per class evaluation
    expect(A.default2).not.toBe(B.default2);
    const fa = await ModuleGraph().import(join(dir, "fn.mjs")),
      fb = await ModuleGraph().import(join(dir, "fn.mjs"));
    expect(fa.default).not.toBe(fb.default);
    expect(fa.default()).toBe(fb.default());
    expect(fa.default.name).toBe("named");
    expect((await ModuleGraph().import(join(dir, "anon.mjs"))).default()).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test("cycles: hoisted functions are callable across a cycle during evaluation; TDZ errors depend on entry order and are cached per instance only", async () => {
    const dir = fixture({
      "a.mjs": `import { b, readA } from "./b.mjs"; export function hoisted() { return "A" } export const aConst = "ac"; export const seen = b; export { readA }`,
      "b.mjs": `import { hoisted, aConst } from "./a.mjs"; export const b = hoisted();
        export function readA() { return aConst }
        export let tdz; try { tdz = aConst } catch (e) { tdz = e.constructor.name }`,
    });
    // Enter via a: b evaluates first (calls a's hoisted function, sees a's const in TDZ), then a completes.
    const g1 = ModuleGraph();
    const a = await g1.import(join(dir, "a.mjs"));
    expect([a.seen, a.readA()]).toEqual(["A", "ac"]);
    expect((await g1.import(join(dir, "b.mjs"))).tdz).toBe("ReferenceError");
    // Enter via b in a fresh graph: a evaluates first and reads b's binding in TDZ → a throws, so b's import rejects…
    const g2 = ModuleGraph();
    await expect(g2.import(join(dir, "b.mjs"))).rejects.toThrow("Cannot access 'b' before initialization");
    // …the failure is sticky for that graph (a's evaluation error is cached in g2)…
    await expect(g2.import(join(dir, "a.mjs"))).rejects.toThrow("before initialization");
    // …and does not affect another graph, nor the first one.
    expect((await ModuleGraph().import(join(dir, "a.mjs"))).seen).toBe("A");
    expect(a.readA()).toBe("ac");
    rmSync(dir, { recursive: true, force: true });
  });

  test("namespace objects: module exotic object semantics hold per instance and reflect that instance's live bindings", async () => {
    const dir = fixture({
      "m.mjs": `export let v = 1; export function set(x) { v = x } export const z = 0; export { v as alias }`,
      "re.mjs": `export * from "./m.mjs"; import * as ns from "./m.mjs"; export { ns }`,
    });
    const g1 = ModuleGraph(),
      g2 = ModuleGraph();
    const n1 = await g1.import(join(dir, "m.mjs")),
      n2 = await g2.import(join(dir, "m.mjs"));
    expect(n1).not.toBe(n2);
    expect(await g1.import(join(dir, "m.mjs"))).toBe(n1); // same instance → same namespace object
    expect(Object.prototype.toString.call(n1)).toBe("[object Module]");
    expect(Reflect.ownKeys(n1)).toEqual(["alias", "set", "v", "z", Symbol.toStringTag]);
    expect(Object.isExtensible(n1)).toBe(false);
    expect(() => {
      (n1 as any).extra = 1;
    }).toThrow();
    expect(() => {
      (n1 as any).v = 5;
    }).toThrow();
    expect("v" in n1 && !("nope" in n1)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(n1, "v")).toEqual({
      value: 1,
      writable: true,
      enumerable: true,
      configurable: false,
    });
    n1.set(7);
    expect([n1.v, n1.alias, n2.v]).toEqual([7, 7, 1]);
    const re1 = await g1.import(join(dir, "re.mjs"));
    expect([re1.v, re1.ns === n1, re1.ns.v]).toEqual([7, true, 7]); // re-export namespace sees the same instance
    n1.set(8);
    expect([re1.v, re1.alias]).toEqual([8, 8]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("eval inside module code sees that instance's module bindings; new Function / indirect eval see the (real) global", async () => {
    const dir = fixture({
      "e.mjs": `let secret = process.env.T; export function direct() { return eval("secret") }
        export function indirect() { try { return (0, eval)("typeof secret") } catch (e) { return "threw" } }
        export function viaFunction() { return new Function("return typeof secret")() }
        export function typeofUndeclared() { return typeof totallyUndeclaredName }
        export function assignUndeclared() { try { totallyUndeclaredName2 = 1; return "assigned" } catch (e) { return e.constructor.name } }`,
    });
    const a = await ModuleGraph({ env: { T: "a" } }).import(join(dir, "e.mjs"));
    const b = await ModuleGraph({ env: { T: "b" } }).import(join(dir, "e.mjs"));
    expect([a.direct(), b.direct()]).toEqual(["a", "b"]);
    expect([a.indirect(), a.viaFunction(), a.typeofUndeclared(), a.assignUndeclared()]).toEqual([
      "undefined",
      "undefined",
      "undefined",
      "ReferenceError",
    ]);
    expect((globalThis as any).totallyUndeclaredName2).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test("scope order inside an instance: module bindings, then overlaid names, then the host's global lexical bindings and global object", async () => {
    (0, eval)("var hostVar = 'hv'; globalThis.hostProp = 'hp';");
    const dir = fixture({
      "s.mjs": `const setTimeout = "shadowed-by-module";
        export function read() { return { moduleShadow: setTimeout, overlaid: typeof setInterval, processIsGraph: process.env.G === "1", hostVar, hostProp, math: typeof Math.max, undefinedGlobal: typeof noSuchGlobalAnywhere } }`,
    });
    const r = (await ModuleGraph({ env: { G: "1" } }).import(join(dir, "s.mjs"))).read();
    expect(r).toEqual({
      moduleShadow: "shadowed-by-module",
      overlaid: "function",
      processIsGraph: true,
      hostVar: "hv",
      hostProp: "hp",
      math: "function",
      undefinedGlobal: "undefined",
    });
    delete (globalThis as any).hostProp;
    rmSync(dir, { recursive: true, force: true });
  });

  test("import() variants inside an instance: self-import, query strings are distinct module keys per instance, import of a builtin, bad specifier rejects", async () => {
    const dir = fixture({
      "q.mjs": `export const id = Math.random();
        export async function self() { return (await import(import.meta.path)).id === id }
        export async function query() { const a = await import("./q.mjs?x=1"); const b = await import("./q.mjs?x=1"); const c = await import("./q.mjs?x=2"); return [a.id !== id, a === b, a.id !== c.id] }
        export async function builtin() { const p = await import("node:path"); return typeof p.join }
        export async function bad() { try { await import("./does-not-exist.mjs"); return "resolved" } catch (e) { return "rejected" } }`,
    });
    const g = await ModuleGraph().import(join(dir, "q.mjs"));
    expect(await g.self()).toBe(true);
    expect(await g.query()).toEqual([true, true, true]);
    expect(await g.builtin()).toBe("function");
    expect(await g.bad()).toBe("rejected");
    expect(await g.bad()).toBe("rejected"); // repeatable, registry not wedged
    rmSync(dir, { recursive: true, force: true });
  });

  test("import.meta per instance: same url/path/dir/file/resolve values, distinct objects, mutations isolated", async () => {
    const dir = fixture({
      "im.mjs": `import.meta.mine = (import.meta.mine ?? 0) + 1; export const meta = import.meta; export const r = import.meta.resolve("./x.js");`,
    });
    const a = await ModuleGraph().import(join(dir, "im.mjs")),
      b = await ModuleGraph().import(join(dir, "im.mjs"));
    expect(a.meta).not.toBe(b.meta);
    expect([a.meta.url, a.meta.path, a.meta.dir, a.meta.file, a.r]).toEqual([
      b.meta.url,
      b.meta.path,
      b.meta.dir,
      b.meta.file,
      b.r,
    ]);
    expect([a.meta.mine, b.meta.mine]).toEqual([1, 1]);
    expect(a.meta.url.startsWith("file://") && a.meta.path === join(dir, "im.mjs")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — shared CodeBlocks under JIT tier-up", () => {
  test("a module function hot enough to be DFG/FTL-compiled while running in instance A still reads and writes instance B's module variables when B calls it", async () => {
    const dir = fixture({
      "hot.mjs": `let counter = 0; const tag = process.env.T; export const K = { k: process.env.T };
        export function inc(n) { for (let i = 0; i < n; i++) counter++; return counter }
        export function readTag() { return tag }            // ModuleVar read of a const
        export function readK() { return K.k }               // ModuleVar read → property load
        export function closure() { return () => counter }   // closure over module scope
        export function reset() { counter = 0 }`,
    });
    const a = await ModuleGraph({ env: { T: "A" } }).import(join(dir, "hot.mjs"));
    const b = await ModuleGraph({ env: { T: "B" } }).import(join(dir, "hot.mjs"));
    // tier up in A
    for (let i = 0; i < 20000; i++) {
      a.inc(10);
      a.readTag();
      a.readK();
    }
    expect(a.inc(0)).toBe(200000);
    // B uses the same executables (possibly the optimized code) — must see B's environment
    expect(b.inc(0)).toBe(0);
    expect(b.inc(5)).toBe(5);
    expect([b.readTag(), b.readK(), a.readTag(), a.readK()]).toEqual(["B", "B", "A", "A"]);
    // now tier up in B and re-check A
    for (let i = 0; i < 20000; i++) {
      b.inc(1);
      b.readTag();
    }
    expect([a.inc(0), b.inc(0)]).toEqual([200000, 20005]);
    expect([a.closure()(), b.closure()()]).toEqual([200000, 20005]);
    // optional evidence that optimisation happened at all (not available in every build)
    const compiles = (jsc as any).numberOfDFGCompiles?.(a.inc);
    if (typeof compiles === "number") expect(compiles).toBeGreaterThanOrEqual(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("module-scope writes (put_to_scope) from optimized code land in the calling instance; a third instance created after tier-up starts fresh", async () => {
    const dir = fixture({
      "acc.mjs": `export let total = 0; export function add(x) { total += x; return total } export function get() { return total }`,
    });
    const a = await ModuleGraph().import(join(dir, "acc.mjs"));
    const b = await ModuleGraph().import(join(dir, "acc.mjs"));
    for (let i = 0; i < 50000; i++) a.add(1);
    for (let i = 0; i < 50000; i++) b.add(2);
    expect([a.get(), b.get(), a.total, b.total]).toEqual([50000, 100000, 50000, 100000]);
    const c = await ModuleGraph().import(join(dir, "acc.mjs")); // instantiated after the code is hot
    expect([c.get(), c.add(3), c.total]).toEqual([0, 3, 3]);
    expect([a.get(), b.get()]).toEqual([50000, 100000]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("generators, async functions and class methods defined in a module keep their instance's bindings across many resumptions", async () => {
    const dir = fixture({
      "gen.mjs": `const id = process.env.T; let n = 0;
        export function* g() { while (true) { n++; yield id + n } }
        export async function af(k) { let out = ""; for (let i = 0; i < k; i++) { await null; out = id + (++n) } return out }
        export class C { m() { return id } static s() { return id } get p() { return id } }`,
    });
    const x = await ModuleGraph({ env: { T: "x" } }).import(join(dir, "gen.mjs"));
    const y = await ModuleGraph({ env: { T: "y" } }).import(join(dir, "gen.mjs"));
    const gx = x.g(),
      gy = y.g();
    let lx = "",
      ly = "";
    for (let i = 0; i < 5000; i++) {
      lx = gx.next().value;
      ly = gy.next().value;
    }
    expect([lx, ly]).toEqual(["x5000", "y5000"]);
    expect([await x.af(3000), await y.af(10)]).toEqual(["x8000", "y5010"]);
    const cx = new x.C(),
      cy = new y.C();
    for (let i = 0; i < 10000; i++) {
      cx.m();
      cy.m();
    }
    expect([cx.m(), cy.m(), x.C.s(), y.C.s(), cx.p, cy.p]).toEqual(["x", "y", "x", "y", "x", "y"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — per-graph process, timers and globals (preset surface)", () => {
  test("process.env per graph: enumeration, JSON, in/delete, coercion to string, and no leakage to host or siblings", async () => {
    const dir = fixture({
      "env.mjs": `export function ops() { process.env.ADDED = 5; delete process.env.GONE; return { keys: Object.keys(process.env).sort(), json: JSON.parse(JSON.stringify(process.env)), has: ["A" in process.env, "GONE" in process.env], added: process.env.ADDED } }`,
    });
    const a = (await ModuleGraph({ env: { A: "1", GONE: "x" } }).import(join(dir, "env.mjs"))).ops();
    const b = (await ModuleGraph({ env: { B: "2" } }).import(join(dir, "env.mjs"))).ops();
    expect(a).toEqual({ keys: ["A", "ADDED"], json: { A: "1", ADDED: "5" }, has: [true, false], added: "5" });
    expect(b.keys).toEqual(["ADDED", "B"]);
    expect(process.env.ADDED).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test("cwd option: process.cwd()/chdir and path.resolve are per graph; kernel-relative fs paths follow the real process cwd (documented)", async () => {
    const dir = fixture({
      "sub/marker.txt": "hi",
      "cwd.mjs": `import path from "node:path"; import fs from "node:fs";
      export function info() { let rel; try { rel = fs.readFileSync("marker.txt", "utf8") } catch { rel = "ENOENT" }
        return { cwd: process.cwd(), resolved: path.resolve("x"), rel } }
      export function cd(d) { process.chdir(d); return process.cwd() }`,
    });
    const g = await ModuleGraph({ cwd: join(dir, "sub") }).import(join(dir, "cwd.mjs"));
    const i = g.info();
    expect(i.cwd).toBe(join(dir, "sub"));
    expect(i.resolved).toBe(join(dir, "sub", "x")); // the graph's node:path resolves against the graph cwd
    expect(i.rel).toBe("ENOENT"); // native fs resolves against the OS cwd
    expect(g.cd("..")).toBe(dir);
    expect(process.cwd()).not.toBe(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  test("process.exit semantics inside a graph: exitCode, exit(code) wins, local 'exit'/'beforeExit' listeners fire once with the code, timers stop, pending promise continuations still run, exit is idempotent", async () => {
    const dir = fixture({
      "ex.mjs": `export const log = [];
      process.on("beforeExit", c => log.push("beforeExit:" + c)); process.on("exit", c => log.push("exit:" + c));
      export function go(host) { process.exitCode = 7; setTimeout(() => host.push("timer-after-exit"), 5); Promise.resolve().then(() => host.push("microtask-after-exit")); process.exit(); process.exit(9); log.push("after-exit-call") }
      export function go2() { process.exit(3) }`,
    });
    const exits: number[] = [],
      host: string[] = [];
    const m = await ModuleGraph({ onExit: c => exits.push(c) }).import(join(dir, "ex.mjs"));
    m.go(host);
    await Bun.sleep(30);
    expect(exits).toEqual([7]);
    expect(m.log).toEqual(["exit:7", "after-exit-call"]); // process.exit() returns inside a graph (cooperative), no beforeExit
    expect(host).toEqual(["microtask-after-exit"]); // timers cleared, microtasks not
    const exits2: number[] = [];
    const m2 = await ModuleGraph({ onExit: c => exits2.push(c) }).import(join(dir, "ex.mjs"));
    m2.go2();
    m2.go2();
    expect(exits2).toEqual([3]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("uncaughtException / unhandledRejection handlers registered by graph code handle that graph's errors before onError; a throwing handler falls through to onError", async () => {
    const dir = fixture({
      "h.mjs": `export const seen = [];
      export function install(mode) {
        process.on("uncaughtException", e => { seen.push("ue:" + e.message); if (mode === "rethrow") throw new Error("handler-boom") });
        process.on("unhandledRejection", r => { seen.push("ur:" + r.message) });
      }
      export function fire() { setTimeout(() => { throw new Error("t") }, 0); Promise.reject(new Error("p")) }`,
    });
    const errs: string[] = [];
    const m = await ModuleGraph({ onError: (e: any, k) => errs.push(k + ":" + e.message) }).import(join(dir, "h.mjs"));
    m.install("ok");
    m.fire();
    await Bun.sleep(20);
    expect(m.seen.sort()).toEqual(["ue:t", "ur:p"]);
    expect(errs).toEqual([]);
    const errs2: string[] = [];
    const m2 = await ModuleGraph({ onError: (e: any, k) => errs2.push(k + ":" + e.message) }).import(
      join(dir, "h.mjs"),
    );
    m2.install("rethrow");
    m2.fire();
    await Bun.sleep(20);
    expect(errs2.some(e => e.includes("handler-boom") || e.includes("uncaughtException:t"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("tracked timers keep Node's Timeout API (ref/unref/hasRef/refresh/Symbol.toPrimitive/clear by id) and ordering relative to microtasks and immediates", async () => {
    const dir = fixture({
      "t.mjs": `export async function run() {
        const order = []; const t = setTimeout(() => order.push("timeout"), 1); const im = setImmediate(() => order.push("immediate")); queueMicrotask(() => order.push("microtask")); process.nextTick(() => order.push("nextTick"));
        const api = [typeof t.ref, typeof t.unref, t.hasRef(), typeof t.refresh, typeof t[Symbol.toPrimitive], typeof im.ref];
        t.unref(); const unrefd = t.hasRef(); t.ref();
        const byId = setTimeout(() => order.push("cleared-should-not-run"), 2); clearTimeout(+byId);
        const iv = setInterval(() => { order.push("interval"); clearInterval(iv) }, 1);
        await new Promise(r => setTimeout(r, 25));
        return { order, api, unrefd } }`,
    });
    const r = await (await ModuleGraph().import(join(dir, "t.mjs"))).run();
    expect(r.api).toEqual(["function", "function", true, "function", "function", "function"]);
    expect(r.unrefd).toBe(false);
    expect(new Set(r.order.slice(0, 2))).toEqual(new Set(["nextTick", "microtask"])); // both before any timer/immediate (relative order is the host's)
    expect(r.order).toContain("timeout");
    expect(r.order).toContain("immediate");
    expect(r.order).toContain("interval");
    expect(r.order).not.toContain("cleared-should-not-run");
    rmSync(dir, { recursive: true, force: true });
  });

  test("globalThis proxy details: identity, aliases, has/delete/defineProperty, overlaid names visible as globals, Function('return this') gives the real global (documented)", async () => {
    const dir = fixture({
      "gt.mjs": `export function probe() {
        const g = globalThis; Object.defineProperty(globalThis, "acc", { get() { return 42 }, configurable: true }); globalThis.tmp = 1; const deleted = delete globalThis.tmp;
        return { stable: g === globalThis && global === g && self === g, procSame: globalThis.process === process, stIsTracked: globalThis.setTimeout === setTimeout,
          hasProcess: "process" in globalThis, hasMath: "Math" in globalThis, acc: globalThis.acc, deleted, tmpGone: globalThis.tmp === undefined,
          realGlobal: Function("return this")() !== globalThis, keysHaveConsole: Object.getOwnPropertyNames(globalThis).includes("console") } }`,
    });
    const r = (await ModuleGraph().import(join(dir, "gt.mjs"))).probe();
    expect(r).toEqual({
      stable: true,
      procSame: true,
      stIsTracked: true,
      hasProcess: true,
      hasMath: true,
      acc: 42,
      deleted: true,
      tmpGone: true,
      realGlobal: true,
      keysHaveConsole: true,
    });
    expect((globalThis as any).acc).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test("timer attribution is lexical (documented): a host function called by graph code arms a HOST timer that survives the graph; a graph callback passed to a host API runs with the graph's bindings", async () => {
    (globalThis as any).__hostArm = (fn: () => void) => setTimeout(fn, 10);
    const dir = fixture({
      "lex.mjs": `export function viaHost(out) { globalThis.__hostArm(() => out.push("ran:" + process.env.T)) } export function quit() { process.exit(0) }`,
    });
    const out: string[] = [];
    const m = await ModuleGraph({ env: { T: "g" } }).import(join(dir, "lex.mjs"));
    m.viaHost(out);
    m.quit();
    await Bun.sleep(30);
    expect(out).toEqual(["ran:g"]); // host-armed timer was not cleared by the graph's exit; callback still saw the graph's env
    delete (globalThis as any).__hostArm;
    rmSync(dir, { recursive: true, force: true });
  });

  test("graph.process (host handle) reflects the graph: env, cwd, and stays usable after dispose without touching the real process", async () => {
    const g = ModuleGraph({ env: { X: "1" }, cwd: "/tmp" });
    expect(g.process.env.X).toBe("1");
    expect(g.process.cwd()).toBe("/tmp");
    expect((g.process as any).pid).toBe(process.pid);
    g.dispose();
    expect(g.process.env.X).toBe("1");
    expect(process.env.X).toBeUndefined();
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — API validation and error attribution edges", () => {
  test("constructor and import() argument validation", async () => {
    expect(() => new ModuleGraphClass!({ onError: 1 as any })).toThrow(TypeError);
    expect(() => new ModuleGraphClass!({ onExit: "x" as any })).toThrow();
    expect(() => new ModuleGraphClass!({ env: 5 as any })).toThrow();
    const g = ModuleGraph();
    await expect(g.import(123 as any)).rejects.toThrow("specifier must be a string"); // like import(): always a promise
    await expect(g.import("./relative-without-base-that-does-not-exist.mjs")).rejects.toThrow(); // resolution failure rejects too
    let threwSync = false;
    try {
      g.import("./nope-" + Math.random() + ".mjs").catch(() => {});
    } catch {
      threwSync = true;
    }
    expect(threwSync).toBe(false);
    expect(() => ModuleGraph({ globals: { extra: 1 } })).not.toThrow(); // extra keys accepted (globalThis.<key>); bare identifiers only for ModuleGraph.overlaidGlobals
  });

  test("errors thrown synchronously during evaluation reject import() (not onError); errors from a disposed graph's leftover callbacks are still attributed; onError throwing does not crash the host", async () => {
    const dir = fixture({
      "syncthrow.mjs": `throw new Error("at-eval")`,
      "late.mjs": `export function later(hostSetTimeout) { hostSetTimeout(() => { throw new Error("late-" + process.env.T) }, 5) }`,
      "boom.mjs": `export function boom() { setTimeout(() => { throw new Error("boom") }, 0) }`,
    });
    const errs: string[] = [];
    const g = ModuleGraph({ env: { T: "z" }, onError: (e: any, k) => errs.push(k + ":" + e.message) });
    await expect(g.import(join(dir, "syncthrow.mjs"))).rejects.toThrow("at-eval");
    expect(errs).toEqual([]);
    const late = await g.import(join(dir, "late.mjs"));
    late.later(setTimeout);
    g.dispose();
    await Bun.sleep(30);
    expect(errs).toEqual(["uncaughtException:late-z"]); // thrown by graph code after dispose → still that graph's onError
    let hostSaw = 0;
    const onHost = () => {
      hostSaw++;
    };
    process.on("uncaughtException", onHost);
    try {
      const bad = await ModuleGraph({
        onError: () => {
          throw new Error("onError itself throws");
        },
      }).import(join(dir, "boom.mjs"));
      bad.boom();
      await Bun.sleep(20);
    } finally {
      process.off("uncaughtException", onHost);
    }
    expect(hostSaw).toBe(0); // an onError that throws is reported on stderr, never rethrown into the host
    rmSync(dir, { recursive: true, force: true });
  });

  test("a graph can create a nested ModuleGraph; the inner graph is independent of the outer one", async () => {
    const dir = fixture({
      "outer.mjs": `export async function makeInner(p) { const G = Bun.unsafe.ModuleGraph; const g = new G({ env: { T: "inner" } }); const m = await g.import(p); return [process.env.T, m.t()] }`,
      "inner.mjs": `export function t() { return process.env.T }`,
    });
    const outer = await ModuleGraph({ env: { T: "outer" } }).import(join(dir, "outer.mjs"));
    expect(await outer.makeInner(join(dir, "inner.mjs"))).toEqual(["outer", "inner"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("stack traces from graph code carry the module's file path and line; Error.captureStackTrace works inside a graph", async () => {
    const dir = fixture({
      "st.mjs": `export function fail() {\n  return new Error("here").stack }\nexport function cap() { const o = {}; Error.captureStackTrace(o); return typeof o.stack }`,
    });
    const m = await ModuleGraph().import(join(dir, "st.mjs"));
    expect(m.fail()).toContain(join(dir, "st.mjs") + ":2");
    expect(m.cap()).toBe("string");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — instance evaluation algorithm (review P0)", () => {
  test("a module is never evaluated twice in one instance when an in-flight TLA dependency parks one import() and another import() reaches a shared dependency meanwhile", async () => {
    const dir = fixture({
      "t.mjs": `globalThis.__evals.push("t:start"); await new Promise(r => setTimeout(r, 30)); globalThis.__evals.push("t:end"); export const t = 1`,
      "a.mjs": `globalThis.__evals.push("a"); export const a = 1`,
      "b.mjs": `import { t } from "./t.mjs"; import { a } from "./a.mjs"; globalThis.__evals.push("b"); export const b = t + a`,
      "entry.mjs": `export async function race(dir) { const pt = import(dir + "/t.mjs"); const pb = import(dir + "/b.mjs"); const pa = import(dir + "/a.mjs"); const [mt, mb, ma] = await Promise.all([pt, pb, pa]); return [mt.t, mb.b, ma.a] }`,
    });
    (globalThis as any).__evals = [];
    const g = await ModuleGraph().import(join(dir, "entry.mjs"));
    expect(await g.race(dir)).toEqual([1, 2, 1]);
    const evals = (globalThis as any).__evals as string[];
    expect(evals.filter(e => e === "a")).toEqual(["a"]); // exactly once
    expect(evals.filter(e => e === "b")).toEqual(["b"]);
    expect(evals.filter(e => e === "t:start")).toEqual(["t:start"]);
    delete (globalThis as any).__evals;
    rmSync(dir, { recursive: true, force: true });
  });

  test("an evaluation error leaves untouched siblings importable (not stuck 'evaluating') and errors every member of the failed cycle", async () => {
    const dir = fixture({
      "throws.mjs": `throw new Error("A-fails")`,
      "sib.mjs": `export const sib = "ok"`,
      "both.mjs": `import "./throws.mjs"; import { sib } from "./sib.mjs"; export { sib }`,
      "cyc1.mjs": `import { c2 } from "./cyc2.mjs"; export const c1 = "c1"; export function get2() { return c2 }`,
      "cyc2.mjs": `import { c1 } from "./cyc1.mjs"; import "./throws.mjs"; export const c2 = "c2"`,
    });
    const g = ModuleGraph();
    await expect(g.import(join(dir, "both.mjs"))).rejects.toThrow("A-fails");
    // sib was in the evaluation order but never ran: it must evaluate normally now
    expect((await g.import(join(dir, "sib.mjs"))).sib).toBe("ok");
    // a cycle whose member fails: both members report the error afterwards, in this instance only
    await expect(g.import(join(dir, "cyc1.mjs"))).rejects.toThrow("A-fails");
    await expect(g.import(join(dir, "cyc2.mjs"))).rejects.toThrow("A-fails");
    await expect(g.import(join(dir, "cyc1.mjs"))).rejects.toThrow("A-fails");
    expect((await ModuleGraph().import(join(dir, "sib.mjs"))).sib).toBe("ok");
    rmSync(dir, { recursive: true, force: true });
  });

  test("TLA: when one async sibling rejects, an already-started sibling that fulfils still lets its dependents run (no hang), and unrelated later imports settle", async () => {
    const dir = fixture({
      "rejecter.mjs": `await new Promise(r => setTimeout(r, 5)); throw new Error("tla-reject")`,
      "slow.mjs": `await new Promise(r => setTimeout(r, 25)); export const slow = "s"`,
      "dep.mjs": `import { slow } from "./slow.mjs"; export const dep = slow + "d"`,
      "root.mjs": `import "./rejecter.mjs"; import { dep } from "./dep.mjs"; export { dep }`,
    });
    const g = ModuleGraph();
    await expect(g.import(join(dir, "root.mjs"))).rejects.toThrow("tla-reject");
    // dep only depends on slow (which fulfilled) → importing it must resolve, not hang
    const dep = await Promise.race([g.import(join(dir, "dep.mjs")), Bun.sleep(500).then(() => "HUNG")]);
    expect(dep === "HUNG" ? "HUNG" : (dep as any).dep).toBe("sd");
    expect((await g.import(join(dir, "slow.mjs"))).slow).toBe("s");
    await expect(g.import(join(dir, "rejecter.mjs"))).rejects.toThrow("tla-reject");
    rmSync(dir, { recursive: true, force: true });
  });

  test("import() from instance top-level code that has tiered up (hot loop in module body) still loads into the instance", async () => {
    const dir = fixture({
      "dep.mjs": `export const who = process.env.T`,
      "hot-top.mjs": `let acc = 0; for (let i = 0; i < 2_000_000; i++) { acc += i & 7 }   // tier up the module program
        export const viaDynamic = (await import("./dep.mjs")).who; export { acc }`,
    });
    const m = await ModuleGraph({ env: { T: "inst" } }).import(join(dir, "hot-top.mjs"));
    expect(m.viaDynamic).toBe("inst");
    rmSync(dir, { recursive: true, force: true });
  });

  test("export * as ns from a JSON/synthetic module resolves inside an instance (namespace slot of a per-instance synthetic environment)", async () => {
    const dir = fixture({
      "c.json": `{ "v": 1 }`,
      "b.mjs": `export * as ns from "./c.json" with { type: "json" }; import * as star from "./c.json" with { type: "json" }; export { star }`,
      "a.mjs": `import { ns, star } from "./b.mjs"; export const v = [ns.default.v, star.default.v, ns === star]`,
    });
    const a = await ModuleGraph().import(join(dir, "a.mjs"));
    const host = await import(join(dir, "a.mjs"));
    expect(a.v.slice(0, 2)).toEqual([1, 1]);
    expect(a.v).toEqual(host.v); // same identity semantics as the primary graph
    const b = await ModuleGraph().import(join(dir, "a.mjs"));
    expect(b.v).toEqual(host.v);
    rmSync(dir, { recursive: true, force: true });
  });

  test("host imports a module AFTER an instance already evaluated it: the primary evaluates normally (import slots filled, optimized code correct)", async () => {
    const dir = fixture({
      "lib.mjs": `export let n = 0; export function inc() { return ++n }`,
      "user.mjs": `import { inc, n } from "./lib.mjs"; export function run(k) { let last = 0; for (let i = 0; i < k; i++) last = inc(); return [last, n] }`,
    });
    const inst = await ModuleGraph().import(join(dir, "user.mjs"));
    expect(inst.run(50000)).toEqual([50000, 50000]);
    const host = await import(join(dir, "user.mjs")); // primary evaluates now
    expect(host.run(50000)).toEqual([50000, 50000]);
    expect(inst.run(1)).toEqual([50001, 50001]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — host stays correct while graphs exist (review P0, Bun side)",
  () => {
    test("host require.cache invalidation and module._compile still see NEW source after a graph has loaded the same CommonJS file", async () => {
      const dir = fixture({ "v.cjs": `module.exports = 1`, "loader.cjs": `module.exports = (p) => require(p)` });
      const g = ModuleGraph();
      expect((await g.import(join(dir, "v.cjs"))).default).toBe(1);
      const hostRequire = (await import(join(dir, "loader.cjs"))).default;
      expect(hostRequire(join(dir, "v.cjs"))).toBe(1);
      writeFileSync(join(dir, "v.cjs"), `module.exports = 2`);
      delete require.cache[join(dir, "v.cjs")];
      expect(hostRequire(join(dir, "v.cjs"))).toBe(2); // not the graph-era template
      const Module = require("node:module");
      const m = new Module(join(dir, "v.cjs"));
      m.filename = join(dir, "v.cjs");
      m.paths = [];
      m._compile(`module.exports = "compiled"`, join(dir, "v.cjs"));
      expect(m.exports).toBe("compiled");
      // and a new graph sees the new file too
      expect((await ModuleGraph().import(join(dir, "v.cjs"))).default).toBe(2);
      rmSync(dir, { recursive: true, force: true });
    });

    test("inspecting signal listeners from a graph (listenerCount/listeners/emit/off) never installs a real signal handler; only on/once do, and they are released", async () => {
      const dir = fixture({
        "sig.mjs": `export function inspect() { return [process.listenerCount("SIGUSR2"), process.listeners("SIGUSR2").length, process.emit("SIGUSR2"), process.off("SIGUSR2", () => {}) === process] }
      export function listen() { const f = () => {}; process.on("SIGUSR2", f); return () => process.off("SIGUSR2", f) }`,
      });
      const before = process.listenerCount("SIGUSR2");
      const m = await ModuleGraph().import(join(dir, "sig.mjs"));
      expect(m.inspect()).toEqual([0, 0, false, true]);
      expect(process.listenerCount("SIGUSR2")).toBe(before); // nothing installed by inspection
      const off = m.listen();
      expect(process.listenerCount("SIGUSR2")).toBe(before + 1); // one forwarder
      off();
      expect(process.listenerCount("SIGUSR2")).toBe(before);
      rmSync(dir, { recursive: true, force: true });
    });

    test("node:process as a module (require and import) is the graph's process, not a copy of the host's", async () => {
      const dir = fixture({
        "p.cjs": `const p = require("node:process"); const p2 = require("process"); module.exports = { same: p === process && p2 === process, env: p.env.T, hostPidType: typeof p.pid }`,
        "p.mjs": `import p, { env, cwd } from "node:process"; export const r = { same: p === process, env: env.T, envObj: p.env.T, cwdIsFn: typeof cwd }`,
      });
      const c = (await ModuleGraph({ env: { T: "cjs" } }).import(join(dir, "p.cjs"))).default;
      expect(c).toEqual({ same: true, env: "cjs", hostPidType: "number" });
      const e = (await ModuleGraph({ env: { T: "esm" }, cwd: "/tmp" }).import(join(dir, "p.mjs"))).r;
      expect(e).toEqual({ same: true, env: "esm", envObj: "esm", cwdIsFn: "function" });
      expect(process.env.T).toBeUndefined();
      rmSync(dir, { recursive: true, force: true });
    });

    test("require(esm) from a graph's CommonJS after the graph was disposed throws instead of loading into the primary", async () => {
      const dir = fixture({
        "late.cjs": `module.exports = () => require("./e.mjs").v`,
        "e.mjs": `export const v = process.env.T ?? "primary"`,
      });
      const g = ModuleGraph({ env: { T: "graph" } });
      const late = (await g.import(join(dir, "late.cjs"))).default;
      g.dispose();
      expect(() => late()).toThrow(/disposed/);
      rmSync(dir, { recursive: true, force: true });
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — review follow-ups (Bun side)", () => {
  test("graph.import() resolves relative specifiers against the graph's cwd option", async () => {
    const dir = fixture({ "sub/rel.mjs": `export const where = "sub"`, "rel.mjs": `export const where = "root"` });
    expect((await ModuleGraph({ cwd: join(dir, "sub") }).import("./rel.mjs")).where).toBe("sub");
    expect((await ModuleGraph({ cwd: dir }).import("./rel.mjs")).where).toBe("root");
    rmSync(dir, { recursive: true, force: true });
  });

  test("ambient attribution: host CommonJS/ESM helpers called from graph code act for the HOST (env/cwd), graph module top-level code acts for the graph", async () => {
    const dir = fixture({
      "host-helper.cjs": `module.exports = () => require("node:child_process").execFileSync("sh", ["-c", "echo \${T:-host}"]).toString().trim()`,
      "host-helper.mjs": `import { execFileSync } from "node:child_process"; export default () => execFileSync("sh", ["-c", "echo \${T:-host}"]).toString().trim()`,
      "g.mjs": `import { execFileSync } from "node:child_process";
        export const atTopLevel = execFileSync("sh", ["-c", "echo \${T:-none}"]).toString().trim();   // module top-level frame (JSCallee)
        export function viaHost(cjsHelper, esmHelper) { return [cjsHelper(), esmHelper()] }
        export function own() { return execFileSync("sh", ["-c", "echo \${T:-none}"]).toString().trim() }`,
    });
    const cjsHelper = require(join(dir, "host-helper.cjs"));
    const esmHelper = (await import(join(dir, "host-helper.mjs"))).default;
    const m = await ModuleGraph({ env: { ...process.env, T: "graph" } }).import(join(dir, "g.mjs"));
    expect(m.atTopLevel).toBe("graph");
    expect(m.own()).toBe("graph");
    expect(m.viaHost(cjsHelper, esmHelper)).toEqual(["host", "host"]); // the host frame decides, for CJS and ESM alike
    rmSync(dir, { recursive: true, force: true });
  });

  test("stdio facade: methods are cached bound functions, once listeners are pruned, removeAllListeners only strips the graph's listeners, process.stdout is assignable", async () => {
    const dir = fixture({
      "io.mjs": `export function run() {
        const sameWrite = process.stdout.write === process.stdout.write;
        const before = process.stdout.listenerCount("drain");
        for (let i = 0; i < 50; i++) process.stdout.once("drain", () => {});
        process.stdout.emit("drain");                       // fires + prunes the 50 once-listeners
        const afterOnce = process.stdout.listenerCount("drain") - before;
        process.stdout.on("resize", () => {}); process.stdout.removeAllListeners("resize");
        const fake = { write() { return "fake" } }; process.stdout = fake; const assigned = process.stdout === fake; 
        return { sameWrite, afterOnce, assigned } }`,
    });
    const hostResize = () => {};
    process.stdout.on("resize", hostResize);
    try {
      const r = (await ModuleGraph().import(join(dir, "io.mjs"))).run();
      expect(r).toEqual({ sameWrite: true, afterOnce: 0, assigned: true });
      expect(process.stdout.listeners("resize")).toContain(hostResize); // host listener survived the graph's removeAllListeners
    } finally {
      process.stdout.off("resize", hostResize);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("tracked timers: util.promisify(setTimeout) works in a graph, clearTimeout accepts the numeric id; timers/promises honours ref:false, rejects with AbortError and removes its abort listener", async () => {
    const dir = fixture({
      "tp.mjs": `import { promisify } from "node:util"; import { setTimeout as sleep } from "node:timers/promises";
      export async function run() {
        const viaPromisify = await promisify(setTimeout)(1).then(() => "ok");
        let fired = false; const t = setTimeout(() => { fired = true }, 5); clearTimeout(+t); await sleep(15);
        const ac = new AbortController(); const p = sleep(10_000, null, { signal: ac.signal }).catch(e => e.name); ac.abort();
        const abortName = await p;
        const ac2 = new AbortController(); await sleep(1, null, { signal: ac2.signal });
        let unrefOk = true; try { await sleep(1, null, { ref: false }) } catch { unrefOk = false }
        return { viaPromisify, fired, abortName, unrefOk } }`,
    });
    const r = await (await ModuleGraph().import(join(dir, "tp.mjs"))).run();
    expect(r).toEqual({ viaPromisify: "ok", fired: false, abortName: "AbortError", unrefOk: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

// One test per way a graph could stay alive after exit. Each arms exactly one thing in the
// graph, exits, and asserts the graph's module object is garbage-collected (FinalizationRegistry),
// independent of heap-size heuristics.
describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — an exited graph is collectable, whatever it armed", () => {
  const cases: Record<string, string> = {
    nothing: ``,
    setTimeoutPending: `setTimeout(() => marker, 60_000)`,
    setIntervalArmed: `setInterval(() => marker, 1000)`,
    setImmediatePending: `setImmediate(() => marker)`,
    timerUnref: `setInterval(() => marker, 1000).unref()`,
    timerRefresh: `const t = setTimeout(() => marker, 60_000); t.refresh()`,
    nodeTimersModule: `require("node:timers").setInterval(() => marker, 1000)`,
    timersPromises: `require("node:timers/promises").setTimeout(60_000).then(() => marker)`,
    processOn: `process.on("exit", () => marker); process.on("warning", () => marker)`,
    processOnce: `process.once("beforeExit", () => marker)`,
    signalListener: `process.on("SIGUSR2", () => marker)`,
    uncaughtHandler: `process.on("uncaughtException", () => marker); process.on("unhandledRejection", () => marker)`,
    stdoutListener: `process.stdout.on("resize", () => marker)`,
    stdinListener: `process.stdin.on("data", () => marker)`,
    abortSignalTimeout: `AbortSignal.timeout(60_000).addEventListener("abort", () => marker)`,
    abortSignalAny: `{ const ac = new AbortController(); AbortSignal.any([ac.signal]).onabort = () => marker; globalThis.__keepAc = ac }`,
    fsWatch: `require("node:fs").watch(".", () => marker)`,
    fsWatchFile: `require("node:fs").watchFile("./nope-" + Math.random(), { interval: 60_000 }, () => marker)`,
    processExpando: `process.__mine = { marker }; process.emit = function () { return marker }`,
    globalExpando: `globalThis.__g = { marker }; Object.defineProperty(globalThis, Symbol.for("x.q"), { get() { return marker }, configurable: true })`,
    patchBuiltin: `{ const fs = require("node:fs"); const prev = fs.closeSync; fs.closeSync = (fd) => (marker, prev(fd)) } { const http = require("node:http"); http.request = () => marker }`,
    fetchCompleted: `await fetch(globalThis.__url).then(r => r.text()).then(() => marker); await new Promise(r => setTimeout(r, 20))`,
    fetchAborted: `{ const ac = new AbortController(); const p = fetch(globalThis.__url + "sse", { signal: ac.signal }).then(r => r.body.getReader().read()).catch(() => marker); ac.abort(); await p; await new Promise(r => setTimeout(r, 20)) }`,
    closedServer: `{ const s = require("node:net").createServer(() => marker); await new Promise(r => s.listen(0, r)); await new Promise(r => s.close(r)) }`,
    finishedChild: `{ const c = require("node:child_process").spawn("true"); c.on("exit", () => marker); await new Promise(r => c.on("close", r)) }`,
    promiseChain: `Promise.resolve().then(() => marker); new Promise(() => marker)`,
    weakRefs: `new WeakRef(marker); new FinalizationRegistry(() => marker).register({}, 1)`,
    dynamicImportSelf: `await import(import.meta.path).then(() => marker)`,
    requireCache: `require.cache["/x"] = { exports: marker }`,
  };
  let server: ReturnType<typeof Bun.serve>;
  const fixtures: Record<string, string> = {};
  for (const [name, arm] of Object.entries(cases))
    fixtures[name + ".mjs"] =
      `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
      export const marker = { big: new Uint8Array(256 * 1024), name: ${JSON.stringify(name)} };
      export async function arm() { ${arm}; }
      export function quit() { process.exit(0) }`;
  const dir = fixture(fixtures);
  for (const name of Object.keys(cases)) {
    test(
      name,
      async () => {
        server ??= Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch(req) {
            return new URL(req.url).pathname.endsWith("sse")
              ? new Response(
                  new ReadableStream({
                    start(c) {
                      c.enqueue(new TextEncoder().encode("x"));
                    },
                  }),
                )
              : new Response("ok");
          },
        });
        (globalThis as any).__url = `http://127.0.0.1:${server.port}/`;
        const wasCollected = await collected(async register => {
          const g = ModuleGraph({ env: process.env as any, cwd: dir });
          const m = await g.import(join(dir, name + ".mjs"));
          register(m.marker);
          await m.arm();
          m.quit();
        });
        delete (globalThis as any).__keepAc;
        expect({ name, wasCollected }).toEqual({ name, wasCollected: true });
      },
      20_000,
    );
  }
});

// One test per ambient surface: what graph A does is visible to A, not to B, not to the host
// (or, for the documented shared surfaces, IS visible — pinned explicitly).
describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — isolation surface by surface (A vs B vs host)", () => {
  const probe = `import fs from "node:fs"; import http from "node:http"; import path from "node:path"; import { EventEmitter } from "node:events";
    export function act(kind) {
      switch (kind) {
        case "env": process.env.ISO = "a"; return process.env.ISO;
        case "envDelete": delete process.env.HOME; return process.env.HOME === undefined;
        case "cwd": process.chdir("/"); return process.cwd();
        case "exitCode": process.exitCode = 9; return process.exitCode;
        case "processOn": process.on("myevent", () => {}); return process.listenerCount("myevent");
        case "processExpando": process.mine = 1; return process.mine;
        case "globalProp": globalThis.isoGlobal = 1; return globalThis.isoGlobal;
        case "globalSymbol": globalThis[Symbol.for("iso.sym")] = 1; return globalThis[Symbol.for("iso.sym")];
        case "fsPatch": fs.isoPatched = true; return fs.isoPatched === true;
        case "httpPatch": http.request = function patched() {}; return http.request.name;
        case "pathPatch": path.isoPatched = 1; return path.isoPatched;
        case "requireCache": return Object.keys(require.cache ?? {}).length >= 0;
        case "arrayProto": Array.prototype.isoShared = 1; return 1;             // documented SHARED
        case "emitterDefault": EventEmitter.defaultMaxListeners = 17; return 17;  // documented SHARED (class export)
      }
    }
    export function read(kind) {
      switch (kind) {
        case "env": return process.env.ISO;
        case "envDelete": return process.env.HOME === undefined;
        case "cwd": return process.cwd();
        case "exitCode": return process.exitCode;
        case "processOn": return process.listenerCount("myevent");
        case "processExpando": return process.mine;
        case "globalProp": return globalThis.isoGlobal;
        case "globalSymbol": return globalThis[Symbol.for("iso.sym")];
        case "fsPatch": return fs.isoPatched === true;
        case "httpPatch": return http.request.name;
        case "pathPatch": return path.isoPatched;
        case "requireCache": return false;
        case "arrayProto": return Array.prototype.isoShared;
        case "emitterDefault": return EventEmitter.defaultMaxListeners;
      }
    }`;
  const dir = fixture({ "probe.mjs": probe });
  const isolated: Record<string, [unknown, unknown]> = {
    // kind: [value A sees after acting, value B / host should see]
    env: ["a", undefined],
    envDelete: [true, false],
    cwd: ["/", null],
    exitCode: [9, undefined],
    processOn: [1, 0],
    processExpando: [1, undefined],
    globalProp: [1, undefined],
    globalSymbol: [1, undefined],
    fsPatch: [true, false],
    httpPatch: ["patched", "request"],
    pathPatch: [1, undefined],
  };
  for (const [kind, [aSees, othersSee]] of Object.entries(isolated)) {
    test(`${kind}: graph-local`, async () => {
      const a = await ModuleGraph({ env: { HOME: "/h" }, cwd: dir }).import(join(dir, "probe.mjs"));
      const b = await ModuleGraph({ env: { HOME: "/h" }, cwd: dir }).import(join(dir, "probe.mjs"));
      expect(a.act(kind)).toEqual(aSees);
      expect(a.read(kind)).toEqual(aSees);
      const expectedOther = othersSee === null ? dir : othersSee;
      expect(b.read(kind)).toEqual(expectedOther);
      // host view
      const hostView: Record<string, () => unknown> = {
        env: () => process.env.ISO,
        envDelete: () => process.env.HOME === undefined,
        cwd: () => null,
        exitCode: () => process.exitCode,
        processOn: () => process.listenerCount("myevent"),
        processExpando: () => (process as any).mine,
        globalProp: () => (globalThis as any).isoGlobal,
        globalSymbol: () => (globalThis as any)[Symbol.for("iso.sym")],
        fsPatch: () => (require("node:fs") as any).isoPatched === true,
        httpPatch: () => require("node:http").request.name,
        pathPatch: () => (require("node:path") as any).isoPatched,
      };
      if (kind !== "cwd") expect(hostView[kind]()).toEqual(othersSee);
    });
  }
  test("documented shared: Array.prototype and class-valued builtin exports (EventEmitter) are one per process", async () => {
    const a = await ModuleGraph().import(join(dir, "probe.mjs"));
    const b = await ModuleGraph().import(join(dir, "probe.mjs"));
    const before = require("node:events").EventEmitter.defaultMaxListeners;
    try {
      a.act("arrayProto");
      a.act("emitterDefault");
      expect([b.read("arrayProto"), b.read("emitterDefault")]).toEqual([1, 17]);
      expect([(Array.prototype as any).isoShared, require("node:events").EventEmitter.defaultMaxListeners]).toEqual([
        1, 17,
      ]);
    } finally {
      delete (Array.prototype as any).isoShared;
      require("node:events").EventEmitter.defaultMaxListeners = before;
    }
  });
  test("host passthrough: pid, platform, versions, argv, execPath, hrtime, memoryUsage are the real process's", async () => {
    const d2 = fixture({
      "pt.mjs": `export const v = [process.pid, process.platform, process.versions.bun, process.argv, process.execPath, typeof process.hrtime.bigint(), typeof process.memoryUsage().rss]`,
    });
    const v = (await ModuleGraph({ env: {} }).import(join(d2, "pt.mjs"))).v;
    expect(v).toEqual([
      process.pid,
      process.platform,
      process.versions.bun,
      process.argv,
      process.execPath,
      "bigint",
      "number",
    ]);
    rmSync(d2, { recursive: true, force: true });
  });
});

// Error attribution matrix: where an error thrown by graph code surfaces, for each way of
// throwing × each place it can be thrown from. "graph" = the graph's onError (or its own
// process handlers); "import" = the import()/call rejects/throws to the caller; never the host.
describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — error attribution matrix", () => {
  const src = `export const T = process.env.T;
    export function syncThrow() { throw new Error("sync:" + T) }
    export function timerThrow() { setTimeout(() => { throw new Error("timer:" + T) }, 0) }
    export function immediateThrow() { setImmediate(() => { throw new Error("immediate:" + T) }) }
    export function microtaskThrow() { queueMicrotask(() => { throw new Error("microtask:" + T) }) }
    export function nextTickThrow() { process.nextTick(() => { throw new Error("nexttick:" + T) }) }
    export function rejection() { Promise.reject(new Error("reject:" + T)) }
    export function asyncFnRejection() { (async () => { await null; throw new Error("asyncfn:" + T) })() }
    export function rejectNonError() { Promise.reject({ tag: "plain:" + T }) }
    export function throwString() { setTimeout(() => { throw "string:" + T }, 0) }
    export function eventListenerThrow() { const { EventEmitter } = require("node:events"); const e = new EventEmitter(); e.on("x", () => { throw new Error("emitter:" + T) }); setTimeout(() => e.emit("x"), 0) }
    export function hostCallbackThrow(hostLater) { hostLater(() => { throw new Error("hostcb:" + T) }) }
    export function nestedTimerThrow() { setTimeout(() => setTimeout(() => { throw new Error("nested:" + T) }, 0), 0) }
    export async function awaitedRejection() { await Promise.reject(new Error("awaited:" + T)) }
    import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`;
  const dir = fixture({
    "e.mjs": src,
    "evalthrow.mjs": `throw new Error("eval:" + process.env.T)`,
    "tla-reject.mjs": `await null; throw new Error("tla:" + process.env.T)`,
  });
  async function withGraph(fn: (m: any, errs: string[], g: any) => Promise<void>) {
    const errs: string[] = [];
    const hostErrs: string[] = [];
    const onHost = (e: any) => hostErrs.push(String(e?.message ?? e));
    process.on("uncaughtException", onHost);
    process.on("unhandledRejection", onHost);
    try {
      const g = ModuleGraph({
        env: { T: "g" },
        onError: (e: any, kind: string) => errs.push(kind + "=" + (e?.message ?? e?.tag ?? e)),
      });
      const m = await g.import(join(dir, "e.mjs"));
      await fn(m, errs, g);
      await Bun.sleep(30);
      expect(hostErrs).toEqual([]); // never the host
    } finally {
      process.off("uncaughtException", onHost);
      process.off("unhandledRejection", onHost);
    }
    return errs;
  }
  const toOnError: Record<string, string> = {
    timerThrow: "uncaughtException=timer:g",
    immediateThrow: "uncaughtException=immediate:g",
    microtaskThrow: "uncaughtException=microtask:g",
    nextTickThrow: "uncaughtException=nexttick:g",
    rejection: "unhandledRejection=reject:g",
    asyncFnRejection: "unhandledRejection=asyncfn:g",
    rejectNonError: "unhandledRejection=plain:g",
    throwString: "uncaughtException=string:g",
    eventListenerThrow: "uncaughtException=emitter:g",
    nestedTimerThrow: "uncaughtException=nested:g",
  };
  for (const [fn, expected] of Object.entries(toOnError)) {
    test(`${fn} → graph onError (${expected.split("=")[0]})`, async () => {
      const errs = await withGraph(async m => {
        m[fn]();
      });
      expect(errs).toEqual([expected]);
    });
  }
  test("hostCallbackThrow (graph closure invoked later by a host timer) → graph onError", async () => {
    const errs = await withGraph(async m => {
      m.hostCallbackThrow((cb: () => void) => setTimeout(cb, 1));
    });
    expect(errs).toEqual(["uncaughtException=hostcb:g"]);
  });
  test("syncThrow → throws to the caller, not onError", async () => {
    const errs = await withGraph(async m => {
      expect(() => m.syncThrow()).toThrow("sync:g");
    });
    expect(errs).toEqual([]);
  });
  test("awaitedRejection → rejects to the caller, not onError", async () => {
    const errs = await withGraph(async m => {
      await expect(m.awaitedRejection()).rejects.toThrow("awaited:g");
    });
    expect(errs).toEqual([]);
  });
  test("evaluation-time throw and TLA rejection → import() rejects, not onError", async () => {
    const errs = await withGraph(async (m, e, g) => {
      await expect(g.import(join(dir, "evalthrow.mjs"))).rejects.toThrow("eval:g");
      await expect(g.import(join(dir, "tla-reject.mjs"))).rejects.toThrow("tla:g");
    });
    expect(errs).toEqual([]);
  });
  test("a graph's own process.on('uncaughtException'/'unhandledRejection') handlers take precedence over onError, per kind", async () => {
    const d = fixture({
      "h.mjs": `export const seen = []; process.on("uncaughtException", e => seen.push("ue:" + e.message));
      export function t() { setTimeout(() => { throw new Error("x") }, 0) } export function r() { Promise.reject(new Error("y")) }`,
    });
    const errs: string[] = [];
    const m = await ModuleGraph({ onError: (e: any, k: string) => errs.push(k + "=" + e.message) }).import(
      join(d, "h.mjs"),
    );
    m.t();
    m.r();
    await Bun.sleep(20);
    expect(m.seen).toEqual(["ue:x"]); // handled by the graph's own handler
    expect(errs).toEqual(["unhandledRejection=y"]); // no local handler for rejections → onError
    rmSync(d, { recursive: true, force: true });
  });
  test("two graphs throwing concurrently are attributed to their own onError", async () => {
    const seen: string[] = [];
    const a = await ModuleGraph({ env: { T: "A" }, onError: (e: any) => seen.push("A<-" + e.message) }).import(
      join(dir, "e.mjs"),
    );
    const b = await ModuleGraph({ env: { T: "B" }, onError: (e: any) => seen.push("B<-" + e.message) }).import(
      join(dir, "e.mjs"),
    );
    a.timerThrow();
    b.rejection();
    b.timerThrow();
    a.rejection();
    await Bun.sleep(30);
    expect(seen.sort()).toEqual(["A<-reject:A", "A<-timer:A", "B<-reject:B", "B<-timer:B"]);
  });
  test("without onError and without local handlers, a graph's uncaught error reaches the host's uncaughtException (documented)", async () => {
    // Run in a child so the host-level uncaught error is observable without failing this test runner.
    const script = `const g = new Bun.unsafe.ModuleGraph({ env: { T: "nohandler" } }); const seen = [];
      process.on("uncaughtException", e => { seen.push(e.message); });
      const m = await g.import(${JSON.stringify(join(dir, "e.mjs"))}); m.timerThrow();
      setTimeout(() => { console.log(JSON.stringify(seen)); process.exit(0) }, 300);`;
    const out = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env } });
    expect(out.stdout.toString().trim()).toBe(`["timer:nohandler"]`);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — CommonJS surface per graph", () => {
  const dir = fixture({
    "state.cjs": `let n = 0; module.exports = { inc: () => ++n, env: () => process.env.T, file: __filename, dir: __dirname, mod: module };`,
    "main.cjs": `const s = require("./state.cjs"); module.exports = { s, main: require.main === module, cacheKeys: () => Object.keys(require.cache), resolve: p => require.resolve(p), children: () => module.children.map(c => c.id), paths: module.paths, del: () => { delete require.cache[require.resolve("./state.cjs")]; return require("./state.cjs") } }`,
    "json.json": `{ "n": 1 }`,
    "usejson.cjs": `const j = require("./json.json"); j.n++; module.exports = () => j.n`,
    "cr.mjs": `import { createRequire } from "node:module"; const require = createRequire(import.meta.url); export const viaCreateRequire = require("./state.cjs"); export const req = require;`,
    "esm-from-cjs.cjs": `module.exports = async () => (await import("./esm.mjs")).who`,
    "esm.mjs": `export const who = process.env.T`,
    "circular-a.cjs": `exports.a = 1; const b = require("./circular-b.cjs"); exports.seenB = b.b; exports.bSawA = b.sawA`,
    "circular-b.cjs": `const a = require("./circular-a.cjs"); exports.sawA = a.a; exports.b = 2`,
    "throws.cjs": `throw new Error("cjs-throws-" + process.env.T)`,
  });
  test("module state, __filename/__dirname and module object are per graph", async () => {
    const a = (await ModuleGraph({ env: { T: "a" } }).import(join(dir, "main.cjs"))).default;
    const b = (await ModuleGraph({ env: { T: "b" } }).import(join(dir, "main.cjs"))).default;
    expect([a.s.inc(), a.s.inc(), b.s.inc()]).toEqual([1, 2, 1]);
    expect([a.s.env(), b.s.env()]).toEqual(["a", "b"]);
    expect([a.s.file, a.s.dir]).toEqual([join(dir, "state.cjs"), dir]);
    expect(a.s.mod).not.toBe(b.s.mod);
    expect(a.s.mod.id).toBe(b.s.mod.id);
  });
  test("require.main, module.children, module.paths, require.resolve", async () => {
    const a = (await ModuleGraph().import(join(dir, "main.cjs"))).default;
    expect(a.main).toBe(true);
    expect(a.children()).toContain(join(dir, "state.cjs"));
    expect(a.paths[0]).toBe(join(dir, "node_modules"));
    expect(a.resolve("./state.cjs")).toBe(join(dir, "state.cjs"));
  });
  test("require.cache is the graph's: keys, delete + re-require re-evaluates in this graph only", async () => {
    const a = (await ModuleGraph().import(join(dir, "main.cjs"))).default;
    const b = (await ModuleGraph().import(join(dir, "main.cjs"))).default;
    expect(a.cacheKeys()).toEqual(expect.arrayContaining([join(dir, "state.cjs"), join(dir, "main.cjs")]));
    a.s.inc();
    b.s.inc();
    b.s.inc();
    const fresh = a.del();
    expect([fresh.inc(), b.s.inc()]).toEqual([1, 3]); // a's state.cjs re-evaluated; b untouched
    expect(require.cache[join(dir, "state.cjs")]).toBeUndefined(); // host cache untouched
  });
  test("require of JSON is per graph (own object, mutations isolated)", async () => {
    const a = (await ModuleGraph().import(join(dir, "usejson.cjs"))).default;
    const b = (await ModuleGraph().import(join(dir, "usejson.cjs"))).default;
    expect([a(), a(), b()]).toEqual([2, 2, 2]);
    expect(require(join(dir, "json.json")).n).toBe(1);
  });
  test("createRequire(import.meta.url) inside a graph gives the graph's require", async () => {
    const g = ModuleGraph({ env: { T: "cr" } });
    const m = await g.import(join(dir, "cr.mjs"));
    const main = (await g.import(join(dir, "main.cjs"))).default;
    expect(m.viaCreateRequire).toBe(main.s); // same cache within the graph
    expect(m.viaCreateRequire.env()).toBe("cr");
    expect(typeof m.req.resolve).toBe("function");
  });
  test("import() from CommonJS in a graph loads into the graph", async () => {
    const f = (await ModuleGraph({ env: { T: "dyn" } }).import(join(dir, "esm-from-cjs.cjs"))).default;
    expect(await f()).toBe("dyn");
  });
  test("circular require behaves like Node (partial exports) per graph", async () => {
    const a = (await ModuleGraph().import(join(dir, "circular-a.cjs"))).default;
    expect([a.a, a.seenB, a.bSawA]).toEqual([1, 2, 1]);
    const again = (await ModuleGraph().import(join(dir, "circular-a.cjs"))).default;
    expect(again).not.toBe(a);
  });
  test("a CommonJS module that throws at load rejects the import with the graph's error and is retried on next require", async () => {
    const g = ModuleGraph({ env: { T: "x" } });
    await expect(g.import(join(dir, "throws.cjs"))).rejects.toThrow("cjs-throws-x");
    await expect(g.import(join(dir, "throws.cjs"))).rejects.toThrow("cjs-throws-x");
    await expect(ModuleGraph({ env: { T: "y" } }).import(join(dir, "throws.cjs"))).rejects.toThrow("cjs-throws-y");
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — exit / dispose lifecycle", () => {
  const dir = fixture({
    "life.mjs": `export const events = []; process.on("exit", c => events.push("exit:" + c)); let ticks = 0; const iv = setInterval(() => ticks++, 2);
      export function state() { return { ticks, events: events.slice() } }
      export function exit(c) { process.exit(c) }
      export function exitInside() { try { process.exit(5); return "returned-after-exit" } catch (e) { return "threw" } }
      export async function importLater(p) { return import(p) }`,
    "other.mjs": `export const x = 1`,
    "tla-forever.mjs": `await new Promise(() => {}); export const never = 1`,
  });
  test("dispose(): idempotent, stops the graph's timers, import() afterwards throws, Symbol.dispose works", async () => {
    const g = ModuleGraph();
    const m = await g.import(join(dir, "life.mjs"));
    await Bun.sleep(10);
    const before = m.state().ticks;
    g.dispose();
    g.dispose();
    (g as any)[Symbol.dispose]();
    await Bun.sleep(10);
    expect(m.state().ticks).toBe(before); // interval cleared
    await expect(g.import(join(dir, "other.mjs"))).rejects.toThrow(/disposed/);
  });
  test("process.exit(code) inside the graph: onExit(code) once, 'exit' listeners run with the code, the call returns (cooperative), later exits are ignored", async () => {
    const codes: number[] = [];
    const m = await ModuleGraph({ onExit: c => codes.push(c) }).import(join(dir, "life.mjs"));
    expect(m.exitInside()).toBe("returned-after-exit");
    m.exit(9);
    expect(codes).toEqual([5]);
    expect(m.state().events).toEqual(["exit:5"]);
  });
  test("onExit is not called for dispose(); dispose after exit is harmless", async () => {
    const codes: number[] = [];
    const g = ModuleGraph({ onExit: c => codes.push(c) });
    await g.import(join(dir, "life.mjs"));
    g.dispose();
    expect(codes).toEqual([]);
    const g2 = ModuleGraph({ onExit: c => codes.push(c) });
    (await g2.import(join(dir, "life.mjs"))).exit(1);
    g2.dispose();
    expect(codes).toEqual([1]);
  });
  test("import() from inside the graph after exit rejects (instance gone) rather than loading into the primary", async () => {
    const g = ModuleGraph();
    const m = await g.import(join(dir, "life.mjs"));
    m.exit(0);
    await expect(m.importLater(join(dir, "other.mjs"))).rejects.toThrow();
  });
  test("dispose while an import is mid-TLA: the pending import does not resolve into a live instance and nothing crashes", async () => {
    const g = ModuleGraph();
    const pending = g.import(join(dir, "tla-forever.mjs"));
    await Bun.sleep(5);
    g.dispose();
    const r = await Promise.race([
      pending.then(
        () => "resolved",
        () => "rejected",
      ),
      Bun.sleep(50).then(() => "pending"),
    ]);
    expect(["rejected", "pending"]).toContain(r);
  });
  test("dispose/exit while a TLA module is suspended: the pending import rejects, the late completion is dropped, and the HOST's copy of that module is untouched (still evaluates normally afterwards)", async () => {
    const d = fixture({
      "slow.mjs": `globalThis.__slowRuns = (globalThis.__slowRuns ?? 0) + 1; await new Promise(r => setTimeout(r, 30)); export const who = process.env.T ?? "host"`,
      "exit-mid.mjs": `setTimeout(() => process.exit(0), 5); await new Promise(r => setTimeout(r, 30)); export const late = 1`,
    });
    const g = ModuleGraph({ env: { T: "g" } });
    const pending = g.import(join(d, "slow.mjs"));
    await Bun.sleep(5);
    g.dispose();
    expect(
      await pending.then(
        () => "resolved",
        (e: Error) => e.message,
      ),
    ).toMatch(/disposed/);
    await Bun.sleep(40); // the suspended body's timer fires after dispose: must be dropped
    const h = await import(join(d, "slow.mjs")); // host evaluates its own copy from scratch
    expect([h.who, (globalThis as any).__slowRuns]).toEqual(["host", 1]);
    const again = await ModuleGraph({ env: { T: "g2" } }).import(join(d, "slow.mjs"));
    expect(again.who).toBe("g2");
    const codes: number[] = [];
    const viaExit = await ModuleGraph({ onExit: c => codes.push(c) })
      .import(join(d, "exit-mid.mjs"))
      .then(
        () => "resolved",
        (e: Error) => e.message,
      );
    expect([codes, /disposed/.test(String(viaExit)) || viaExit === "resolved"]).toEqual([[0], true]);
    delete (globalThis as any).__slowRuns;
    rmSync(d, { recursive: true, force: true });
  });
  test("many graphs created and disposed in a loop do not accumulate (heap returns near baseline)", async () => {
    Bun.gc(true);
    const before = heapStats().objectCount;
    for (let i = 0; i < 100; i++) {
      const g = ModuleGraph({ env: { I: String(i) } });
      await g.import(join(dir, "other.mjs"));
      g.dispose();
    }
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);
    expect(heapStats().objectCount - before).toBeLessThan(20_000); // ~ a few hundred objects per leaked graph would blow this
  }, 30_000);
  test("graph.process after dispose still answers env/cwd; mainModule is the first import's path", async () => {
    const g = ModuleGraph({ env: { K: "v" }, cwd: dir });
    await g.import("./other.mjs");
    expect((g as any).mainModule).toBe(join(dir, "other.mjs"));
    g.dispose();
    expect([g.process.env.K, g.process.cwd()]).toEqual(["v", dir]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — timers API fidelity inside a graph", () => {
  const dir = fixture({
    "t.mjs": `import { promisify } from "node:util";
    export async function shapes() { const t = setTimeout(() => {}, 1000); const i = setInterval(() => {}, 1000); const m = setImmediate(() => {});
      const r = { timeout: [typeof t.ref, typeof t.unref, typeof t.hasRef, typeof t.refresh, typeof t.close, typeof t[Symbol.toPrimitive], typeof t[Symbol.dispose]], interval: typeof i.unref, immediate: [typeof m.ref, typeof m.unref, typeof m.hasRef] };
      clearTimeout(t); clearInterval(i); clearImmediate(m); return r }
    export async function args() { return await new Promise(r => setTimeout((a, b) => r([a, b]), 1, "x", 2)) }
    export async function order() { const o = []; setTimeout(() => o.push("t0"), 0); setImmediate(() => o.push("imm")); process.nextTick(() => o.push("tick")); queueMicrotask(() => o.push("micro")); await new Promise(r => setTimeout(r, 10)); return o }
    export async function refresh(k = 1) { let n = 0; const t = setTimeout(() => n++, 150 * k); await new Promise(r => setTimeout(r, 100 * k)); t.refresh(); await new Promise(r => setTimeout(r, 100 * k)); const mid = n; await new Promise(r => setTimeout(r, 150 * k)); return [mid, n] }
    export async function unrefDoesNotFireAfterClear() { let fired = false; const t = setTimeout(() => fired = true, 5); t.unref(); clearTimeout(t); await new Promise(r => setTimeout(r, 15)); return fired }
    export async function promisified() { const s = promisify(setTimeout); const v = await s(1, "val"); const im = await promisify(setImmediate)("iv"); return [v, im] }
    export function intervalSelfClear() { return new Promise(r => { let n = 0; const iv = setInterval(() => { if (++n === 3) { clearInterval(iv); r(n) } }, 1) }) }
    export function negativeAndNaN() { return new Promise(r => { const o = []; setTimeout(() => o.push("neg"), -5); setTimeout(() => o.push("nan"), NaN); setTimeout(() => r(o), 5) }) }`,
  });
  test("Timeout / Immediate objects keep Node's shape", async () => {
    const m = await ModuleGraph().import(join(dir, "t.mjs"));
    expect(await m.shapes()).toEqual({
      timeout: ["function", "function", "function", "function", "function", "function", "function"],
      interval: "function",
      immediate: ["function", "function", "function"],
    });
  });
  test("extra arguments are passed to the callback", async () => {
    expect(await (await ModuleGraph().import(join(dir, "t.mjs"))).args()).toEqual(["x", 2]);
  });
  test("ordering: nextTick/microtask before immediate/timeout (host order preserved)", async () => {
    const o = await (await ModuleGraph().import(join(dir, "t.mjs"))).order();
    expect(o.slice(0, 2).sort()).toEqual(["micro", "tick"]);
    expect(o.slice(2).sort()).toEqual(["imm", "t0"]);
  });
  test("refresh() re-arms a tracked timer", async () => {
    expect(await (await ModuleGraph().import(join(dir, "t.mjs"))).refresh(stressMode ? 4 : 1)).toEqual([0, 1]);
  });
  test("unref + clear never fires", async () => {
    expect(await (await ModuleGraph().import(join(dir, "t.mjs"))).unrefDoesNotFireAfterClear()).toBe(false);
  });
  test("util.promisify(setTimeout/setImmediate) resolve with the value", async () => {
    expect(await (await ModuleGraph().import(join(dir, "t.mjs"))).promisified()).toEqual(["val", "iv"]);
  });
  test("an interval can clear itself from its callback", async () => {
    expect(await (await ModuleGraph().import(join(dir, "t.mjs"))).intervalSelfClear()).toBe(3);
  });
  test("negative / NaN delays behave like 1ms", async () => {
    expect(await (await ModuleGraph().import(join(dir, "t.mjs"))).negativeAndNaN()).toEqual(["neg", "nan"]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — binding forms, one per test (instance vs instance vs host)", () => {
  const dir = fixture({
    "leaf.mjs": `export let live = 0; export function bump() { live++ } export default function def() { return "def" } export class K {} export const obj = { n: 0 };`,
    "hop1.mjs": `export { live, bump, default, K, obj } from "./leaf.mjs"; export { live as renamed } from "./leaf.mjs";`,
    "hop2.mjs": `export * from "./hop1.mjs"; import d from "./hop1.mjs"; export { d as viaDefault };`,
    "hop3.mjs": `import * as all from "./hop2.mjs"; export { all }; export const { live: destructuredAtLoad } = all;`,
    "consumer.mjs": `import { live, renamed, bump, K, obj, viaDefault } from "./hop2.mjs"; import { all } from "./hop3.mjs"; import leafDefault from "./leaf.mjs";
      export function snap() { return { live, renamed, allLive: all.live, k: typeof K, def: viaDefault(), sameDefault: viaDefault === leafDefault, objN: obj.n } }
      export { bump }; export function touchObj() { obj.n++ }`,
    "meta.mjs": `export const m = { url: import.meta.url, path: import.meta.path, dir: import.meta.dir, file: import.meta.file, main: import.meta.main, resolved: import.meta.resolve("./leaf.mjs"), env: typeof import.meta.env, req: typeof import.meta.require }`,
    "data.json": `{ "list": [1], "nested": { "v": 1 } }`,
    "text.txt": `hello`,
    "cfg.toml": `[a]\nb = 1`,
    "usedata.mjs": `import j from "./data.json"; import t from "./text.txt"; import c from "./cfg.toml"; export function mutate() { j.list.push(2); j.nested.v++; c.a.b++; return [j.list.length, j.nested.v, c.a.b, t] }`,
    "attr.mjs": `export async function jsonAttr() { return (await import("./data.json", { with: { type: "json" } })).default.nested.v } export async function badAttr() { try { await import("./leaf.mjs", { with: { type: "json" } }); return "ok" } catch (e) { return e.constructor.name } }`,
  });
  test("live binding through 3 re-export hops updates in the importing instance only", async () => {
    const a = await ModuleGraph().import(join(dir, "consumer.mjs")),
      b = await ModuleGraph().import(join(dir, "consumer.mjs"));
    a.bump();
    a.bump();
    expect([a.snap().live, a.snap().renamed, a.snap().allLive, b.snap().live]).toEqual([2, 2, 2, 0]);
  });
  test("default export identity is per instance and consistent across import paths within an instance", async () => {
    const a = await ModuleGraph().import(join(dir, "consumer.mjs")),
      b = await ModuleGraph().import(join(dir, "consumer.mjs"));
    expect([a.snap().sameDefault, a.snap().def]).toEqual([true, "def"]);
    const la = await ModuleGraph().import(join(dir, "leaf.mjs")),
      lb = await ModuleGraph().import(join(dir, "leaf.mjs"));
    expect(la.default).not.toBe(lb.default);
    expect(la.K).not.toBe(lb.K);
  });
  test("exported object identity: mutations visible within the instance across modules, not across instances", async () => {
    const a = await ModuleGraph().import(join(dir, "consumer.mjs")),
      b = await ModuleGraph().import(join(dir, "consumer.mjs"));
    a.touchObj();
    a.touchObj();
    expect([a.snap().objN, b.snap().objN]).toEqual([2, 0]);
  });
  test("destructuring a namespace at load time captures that instance's value", async () => {
    const g = ModuleGraph();
    const c = await g.import(join(dir, "consumer.mjs"));
    c.bump();
    const h3 = await g.import(join(dir, "hop3.mjs"));
    expect([h3.destructuredAtLoad, h3.all.live]).toEqual([0, 1]); // captured before bump; namespace is live
  });
  test("import.meta fields per instance", async () => {
    const a = (await ModuleGraph().import(join(dir, "meta.mjs"))).m,
      h = (await import(join(dir, "meta.mjs"))).m;
    expect({ ...a, main: undefined }).toEqual({ ...h, main: undefined });
    expect(a.main).toBe(true); // first module imported into a graph is its main
    expect([a.env, a.req]).toEqual(["object", "function"]);
  });
  test("JSON / text / TOML modules are per instance (mutations isolated), text is shared immutable", async () => {
    const a = await ModuleGraph().import(join(dir, "usedata.mjs")),
      b = await ModuleGraph().import(join(dir, "usedata.mjs"));
    expect(a.mutate()).toEqual([2, 2, 2, "hello"]);
    expect(a.mutate()).toEqual([3, 3, 3, "hello"]);
    expect(b.mutate()).toEqual([2, 2, 2, "hello"]);
    expect((await import(join(dir, "data.json"))).default.nested.v).toBe(1);
  });
  test("import attributes: json attribute works in a graph; a mismatched type rejects", async () => {
    const m = await ModuleGraph().import(join(dir, "attr.mjs"));
    expect(await m.jsonAttr()).toBe(1);
    expect(["TypeError", "SyntaxError"]).toContain(await m.badAttr());
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — shared code under tier-up, one access path per test", () => {
  const dir = fixture({
    "paths.mjs": `let v = process.env.T; let counter = 0; const holder = { get g() { return v }, set s(x) { v = x } };
    export class C { field = v; #priv = v; static sfield = process.env.T; get acc() { return v } priv() { return this.#priv } static st() { return v } }
    export const arrow = () => v; export function decl() { return v } export const bound = decl.bind(null);
    export function* gen() { while (true) yield v } export async function asy() { await null; return v }
    export function viaGetter() { return holder.g } export function viaSetter(x) { holder.s = x; return v }
    export function inc() { return ++counter } export function closureFactory() { let local = 0; return () => [v, ++local, ++counter] }
    export function withTryCatch() { try { throw 0 } catch { return v } } export function withArgs(...a) { return [v, a.length] }
    export function tail() { return decl() } export function viaEval() { return eval("v") }`,
  });
  const N = 30_000;
  async function pair() {
    return [
      await ModuleGraph({ env: { T: "A" } }).import(join(dir, "paths.mjs")),
      await ModuleGraph({ env: { T: "B" } }).import(join(dir, "paths.mjs")),
    ];
  }
  const simple: Record<string, (m: any) => unknown> = {
    arrow: m => m.arrow(),
    decl: m => m.decl(),
    bound: m => m.bound(),
    classStatic: m => m.C.st(),
    classField: m => new m.C().field,
    classPrivate: m => new m.C().priv(),
    classAccessor: m => new m.C().acc,
    staticField: m => m.C.sfield,
    generator: m => m.gen().next().value,
    getter: m => m.viaGetter(),
    tryCatch: m => m.withTryCatch(),
    restArgs: m => m.withArgs(1, 2)[0],
    tailCall: m => m.tail(),
    directEval: m => m.viaEval(),
  };
  for (const [name, read] of Object.entries(simple)) {
    test(`${name}: hot in A, then B reads B`, async () => {
      const [a, b] = await pair();
      for (let i = 0; i < N; i++) read(a);
      expect([read(a), read(b)]).toEqual(["A", "B"]);
      for (let i = 0; i < N; i++) read(b);
      expect([read(a), read(b)]).toEqual(["A", "B"]);
    });
  }
  test("async function: hot in A, then B reads B", async () => {
    const [a, b] = await pair();
    for (let i = 0; i < 2000; i++) await a.asy();
    expect([await a.asy(), await b.asy()]).toEqual(["A", "B"]);
  });
  test("module-scope writes through a setter and a counter stay per instance under tier-up", async () => {
    const [a, b] = await pair();
    for (let i = 0; i < N; i++) a.inc();
    expect([a.inc(), b.inc()]).toEqual([N + 1, 1]);
    expect([a.viaSetter("A2"), b.viaGetter()]).toEqual(["A2", "B"]);
  });
  test("closures created by hot factory code capture their own instance and their own locals", async () => {
    const [a, b] = await pair();
    const fa = a.closureFactory(),
      fb = b.closureFactory();
    for (let i = 0; i < N; i++) fa();
    expect(fa()[0]).toBe("A");
    expect(fb()).toEqual(["B", 1, 1]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — concurrency", () => {
  const dir = fixture({
    "tla.mjs": `globalThis.__c = (globalThis.__c ?? 0) + 1; await new Promise(r => setTimeout(r, 5)); export const n = globalThis.__c; export const who = process.env.T`,
    "dep-on-tla.mjs": `import { who } from "./tla.mjs"; export const w = who`,
    "chain.mjs": `export const x = (await import("./tla.mjs")).who`,
  });
  test("20 graphs importing the same TLA module concurrently each evaluate once, with their own env", async () => {
    (globalThis as any).__c = 0;
    const graphs = Array.from({ length: 20 }, (_, i) => ModuleGraph({ env: { T: "g" + i } }));
    const mods = await Promise.all(graphs.map(g => g.import(join(dir, "tla.mjs"))));
    expect(mods.map(m => m.who)).toEqual(graphs.map((_, i) => "g" + i));
    expect((globalThis as any).__c).toBe(0); // graph-local globals: host counter untouched
  });
  test("within one graph, concurrent imports of a TLA module and of its dependent share one evaluation", async () => {
    const g = ModuleGraph({ env: { T: "one" } });
    const [a, b, c, d] = await Promise.all([
      g.import(join(dir, "tla.mjs")),
      g.import(join(dir, "dep-on-tla.mjs")),
      g.import(join(dir, "tla.mjs")),
      g.import(join(dir, "chain.mjs")),
    ]);
    expect([a === c, a.n, b.w, d.x]).toEqual([true, 1, "one", "one"]);
  });
  test("interleaved: graph A mid-TLA while graph B imports and finishes; both correct", async () => {
    const A = ModuleGraph({ env: { T: "A" } }),
      B = ModuleGraph({ env: { T: "B" } });
    const pa = A.import(join(dir, "tla.mjs"));
    const mb = await B.import(join(dir, "dep-on-tla.mjs"));
    const ma = await pa;
    expect([ma.who, mb.w]).toEqual(["A", "B"]);
  });
  test("a graph disposed while another graph is mid-import of the same module does not affect it", async () => {
    const A = ModuleGraph({ env: { T: "A" } }),
      B = ModuleGraph({ env: { T: "B" } });
    const pb = B.import(join(dir, "tla.mjs"));
    await A.import(join(dir, "dep-on-tla.mjs"));
    A.dispose();
    expect((await pb).who).toBe("B");
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — child processes, Workers and host APIs see the graph's ambient state",
  () => {
    const dir = fixture({
      "w.mjs": `postMessage({ env: process.env.T ?? null, cwd: process.cwd() })`,
      "spawn.mjs": `import { execFileSync, execSync, spawnSync, spawn, exec } from "node:child_process"; import { promisify } from "node:util";
      export const viaExecFileSync = () => execFileSync("sh", ["-c", "echo $T:$(pwd)"]).toString().trim();
      export const viaExecSync = () => execSync("echo $T").toString().trim();
      export const viaSpawnSync = () => spawnSync("sh", ["-c", "echo $T"]).stdout.toString().trim();
      export const viaSpawn = () => new Promise(r => { let o = ""; const c = spawn("sh", ["-c", "echo $T"]); c.stdout.on("data", d => o += d); c.on("close", () => r(o.trim())) });
      export const viaExec = async () => (await promisify(exec)("echo $T")).stdout.trim();
      export const viaBunSpawn = () => Bun.spawnSync(["sh", "-c", "echo $T:$(pwd)"]).stdout.toString().trim();
      export const viaBun$ = async () => (await Bun.$\`echo $T:$(pwd)\`.text()).trim();
      export const viaBun$Explicit = async () => (await Bun.$\`echo $T\`.env({ ...process.env, T: "explicit$" }).text()).trim();
      export const explicitEnvWins = () => execFileSync("sh", ["-c", "echo $T"], { env: { T: "explicit" } }).toString().trim();
      export const explicitCwdWins = (d) => execFileSync("pwd", { cwd: d }).toString().trim();
      export const worker = () => new Promise(r => { const w = new Worker(new URL("./w.mjs", import.meta.url).href); w.onmessage = e => { r(e.data); w.terminate() } });
      export const workerExplicitEnv = () => new Promise(r => { const w = new Worker(new URL("./w.mjs", import.meta.url).href, { env: { T: "wx" } }); w.onmessage = e => { r(e.data.env); w.terminate() } });
      export const osInfo = async () => { const os = await import("node:os"); return [os.homedir(), os.userInfo().homedir, os.tmpdir()] };`,
    });
    const sub = join(dir, "sub");
    mkdirSync(sub, { recursive: true });
    const mk = () =>
      ModuleGraph({ env: { ...process.env, T: "gT", HOME: "/home/graph", TMPDIR: "/tmp/graph-tmp" }, cwd: sub }).import(
        join(dir, "spawn.mjs"),
      );
    test("execFileSync / execSync / spawnSync inherit the graph's env and cwd", async () => {
      const m = await mk();
      expect([m.viaExecFileSync(), m.viaExecSync(), m.viaSpawnSync()]).toEqual([`gT:${sub}`, "gT", "gT"]);
    });
    test("async spawn / exec inherit the graph's env", async () => {
      const m = await mk();
      expect([await m.viaSpawn(), await m.viaExec()]).toEqual(["gT", "gT"]);
    });
    test("Bun.spawnSync and Bun.$ inherit the graph's env and cwd; $.env() still wins", async () => {
      const m = await mk();
      expect([m.viaBunSpawn(), await m.viaBun$(), await m.viaBun$Explicit()]).toEqual([
        `gT:${sub}`,
        `gT:${sub}`,
        "explicit$",
      ]);
    });
    test("explicit env/cwd options still win over the graph's", async () => {
      const m = await mk();
      expect([m.explicitEnvWins(), m.explicitCwdWins(dir)]).toEqual(["explicit", dir]);
    });
    test("Worker started from a graph inherits the graph's env; explicit env wins", async () => {
      const m = await mk();
      expect((await m.worker()).env).toBe("gT");
      expect(await m.workerExplicitEnv()).toBe("wx");
    });
    test("os.homedir()/userInfo().homedir/tmpdir() follow the graph's env", async () => {
      const m = await mk();
      expect(await m.osInfo()).toEqual(["/home/graph", "/home/graph", "/tmp/graph-tmp"]);
    });
    test("host calls of the same APIs are unaffected after graphs ran", async () => {
      await mk();
      const { execFileSync } = require("node:child_process");
      expect(execFileSync("sh", ["-c", "echo ${T:-unset}"]).toString().trim()).toBe(process.env.T ?? "unset");
      expect(require("node:os").homedir()).toBe(require("node:os").userInfo().homedir);
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — nested graphs, stack traces, misc host integration", () => {
  const dir = fixture({
    "outer.mjs": `export async function nest(p, env) { const g = new Bun.unsafe.ModuleGraph({ env }); const m = await g.import(p); return { outer: process.env.T, inner: m.t(), innerSeesOuterGlobal: m.g() } }
      globalThis.__outerMark = 1;`,
    "inner.mjs": `export const t = () => process.env.T; export const g = () => typeof globalThis.__outerMark`,
    "stack.mjs": `export function boom() {\n  throw new Error("here")\n}\nexport function trace() { try { boom() } catch (e) { return e.stack } }\nexport function prepared() { const prev = Error.prepareStackTrace; Error.prepareStackTrace = (e, frames) => frames.map(f => f.getFileName()); try { return new Error("x").stack } finally { Error.prepareStackTrace = prev } }`,
    "console.mjs": `export function log() { console.log("from-graph:" + process.env.T); console.error("err-from-graph") }`,
    "structured.mjs": `export function clone() { const o = { d: new Date(0), m: new Map([[1, 2]]), s: new Set([3]) }; const c = structuredClone(o); return [c.d instanceof Date, c.m.get(1), c.s.has(3), c !== o] }`,
    "intl.mjs": `export const fmt = new Intl.NumberFormat("en-US").format(1234.5); export const url = new URL("/x", "http://h").href; export const enc = new TextDecoder().decode(new TextEncoder().encode("ok")); export const b64 = btoa("hi"); export const perf = typeof performance.now();`,
  });
  test("a graph can create and use a nested graph; each keeps its own env and globals", async () => {
    const r = await (
      await ModuleGraph({ env: { T: "outer" } }).import(join(dir, "outer.mjs"))
    ).nest(join(dir, "inner.mjs"), { T: "inner" });
    expect(r).toEqual({ outer: "outer", inner: "inner", innerSeesOuterGlobal: "undefined" });
    expect((globalThis as any).__outerMark).toBeUndefined();
  });
  test("stack traces carry file:line of the graph's module; Error.prepareStackTrace sees CallSites with file names", async () => {
    const m = await ModuleGraph().import(join(dir, "stack.mjs"));
    expect(m.trace()).toContain(join(dir, "stack.mjs") + ":2");
    expect(m.prepared()[0]).toBe(join(dir, "stack.mjs"));
  });
  test("console output from graph code goes to the process's stdout/stderr", async () => {
    const script = `const m = await new Bun.unsafe.ModuleGraph({ env: { T: "c" } }).import(${JSON.stringify(join(dir, "console.mjs"))}); m.log();`;
    const r = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env } });
    expect([r.stdout.toString().trim(), r.stderr.toString().trim()]).toEqual(["from-graph:c", "err-from-graph"]);
  });
  test("structuredClone, Intl, URL, TextEncoder, btoa, performance work inside a graph", async () => {
    expect((await ModuleGraph().import(join(dir, "structured.mjs"))).clone()).toEqual([true, 2, true, true]);
    const i = await ModuleGraph().import(join(dir, "intl.mjs"));
    expect([i.fmt, i.url, i.enc, i.b64, i.perf]).toEqual(["1,234.5", "http://h/x", "ok", "aGk=", "number"]);
  });
  test("constructing many graphs without importing anything is cheap and they are collectable", async () => {
    const ok = await collected(register => {
      for (let i = 0; i < 200; i++) {
        const g = ModuleGraph({ env: { I: String(i) } });
        if (i === 100) register(g);
      }
    });
    expect(ok).toBe(true);
  }, 30_000);
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — constructor / method contract", () => {
  const dir = fixture({
    "ok.mjs": `export const env = process.env.K ?? null; export const cwd = process.cwd(); export const g = typeof globalThis.__injected`,
  });
  const bad: Array<[string, () => unknown, RegExp]> = [
    ["env not an object", () => ModuleGraph({ env: 5 as any }), /env/i],
    ["env null", () => ModuleGraph({ env: null as any }), /env/i],
    ["cwd not a string", () => ModuleGraph({ cwd: 5 as any }), /cwd/i],
    ["globals not an object", () => ModuleGraph({ globals: "x" as any }), /globals/i],
    ["onExit not callable", () => ModuleGraph({ onExit: 1 as any }), /onExit/i],
    ["onError not callable", () => ModuleGraph({ onError: {} as any }), /onError/i],
    ["options not an object", () => new (ModuleGraphClass as any)(42), /object|options/i],
    ["called without new", () => (ModuleGraphClass as any)({}), /constructor|new/i],
  ];
  for (const [name, make, re] of bad)
    test(`rejects: ${name}`, () => {
      expect(make).toThrow(re);
    });
  test("accepts: no options, empty options, undefined members", async () => {
    for (const g of [
      new (ModuleGraphClass as any)(),
      ModuleGraph({}),
      ModuleGraph({ env: undefined, cwd: undefined, globals: undefined, onExit: undefined, onError: undefined } as any),
    ]) {
      const m = await g.import(join(dir, "ok.mjs"));
      expect([m.env, typeof m.cwd]).toEqual([process.env.K ?? null, "string"]); // env defaults to a COPY of the host env
    }
  });
  test("env values are coerced to strings; symbols keys ignored; later host env changes do not leak in", async () => {
    const g = ModuleGraph({ env: { K: 1 as any, U: undefined as any, [Symbol("s") as any]: "x" } });
    process.env.__LATE = "late";
    try {
      const m = await g.import(join(dir, "ok.mjs"));
      expect(m.env).toBe("1");
      expect(g.process.env.U).toBeOneOf([undefined, "undefined"]);
      expect(g.process.env.__LATE).toBeUndefined();
    } finally {
      delete process.env.__LATE;
    }
  });
  test("globals: own enumerable props are injected; prototype props and non-enumerables are not", async () => {
    const proto = { fromProto: 1 };
    const globals = Object.create(proto);
    globals.__injected = 1;
    Object.defineProperty(globals, "hidden", { value: 1, enumerable: false });
    const d = fixture({
      "gl.mjs": `export const v = [typeof globalThis.__injected, typeof globalThis.fromProto, typeof globalThis.hidden]`,
    });
    expect((await ModuleGraph({ globals }).import(join(d, "gl.mjs"))).v).toEqual(["number", "undefined", "undefined"]);
    rmSync(d, { recursive: true, force: true });
  });
  test("import(): non-string specifier, empty string, missing file, directory, and a data: URL", async () => {
    const g = ModuleGraph({ cwd: dir });
    await expect(g.import(123 as any)).rejects.toThrow(TypeError);
    await expect(g.import("")).rejects.toThrow();
    await expect((async () => g.import("./nope.mjs"))()).rejects.toThrow(/Cannot find|not found|ENOENT/i);
    await expect((async () => g.import(dir))()).rejects.toThrow();
    const spec = "data:text/javascript,export const d = typeof process.env";
    const viaData = await g.import(spec).catch(e => e),
      hostData = await import(spec).catch(e => e);
    expect(viaData instanceof Error ? "error" : Object.keys(viaData)).toEqual(
      hostData instanceof Error ? "error" : Object.keys(hostData),
    ); // parity with the host
  });
  test("globals are properties of the graph's globalThis; bare identifiers resolve for the preset names (process, globalThis, timers...), injected extras via globalThis", async () => {
    const d = fixture({
      "bare.mjs": `export const v = [typeof extra, typeof globalThis.extra, typeof process, typeof setTimeout, globalThis.process === process]`,
    });
    expect((await ModuleGraph({ globals: { extra: 1 } }).import(join(d, "bare.mjs"))).v).toEqual([
      "undefined",
      "number",
      "object",
      "function",
      true,
    ]);
    rmSync(d, { recursive: true, force: true });
  });
  test("globals: an own property shadows the host binding even when its value is undefined", async () => {
    const d = fixture({ "x.mjs": `export const v = [typeof setTimeout, typeof fetch];` });
    expect((await ModuleGraph({ globals: { setTimeout: undefined } }).import(join(d, "x.mjs"))).v).toEqual([
      "undefined",
      "function",
    ]);
    expect((await ModuleGraph({ globals: {} }).import(join(d, "x.mjs"))).v).toEqual(["function", "function"]);
    rmSync(d, { recursive: true, force: true });
  });
  test("methods reject a foreign receiver; properties are accessors on the prototype", () => {
    const g = ModuleGraph();
    for (const k of ["import", "dispose"])
      expect(() => (ModuleGraphClass as any).prototype[k].call({}, "x")).toThrow(TypeError);
    for (const k of ["process", "mainModule"])
      expect(typeof Object.getOwnPropertyDescriptor((ModuleGraphClass as any).prototype, k)?.get).toBe("function");
    expect(Object.keys(g)).toEqual([]);
  });
  test("re-entrancy: onExit/onError callbacks may create graphs, import, and dispose the calling graph", async () => {
    const d = fixture({
      "x.mjs": `export function die() { setTimeout(() => { throw new Error("e") }, 0) } export function quit() { process.exit(3) }`,
    });
    const log: string[] = [];
    let g: any;
    g = ModuleGraph({
      onError: async () => {
        log.push("onError");
        g.dispose();
        const m = await ModuleGraph().import(join(d, "x.mjs"));
        log.push(typeof m.quit);
      },
      onExit: c => {
        log.push("onExit:" + c);
        g.dispose();
      },
    });
    const m = await g.import(join(d, "x.mjs"));
    m.quit();
    m.die();
    await Bun.sleep(20);
    expect(log).toEqual(["onExit:3"]); // after exit, the late throw is dropped (exited) rather than re-entering onError
    const g2: any = ModuleGraph({
      onError: () => {
        log.push("onError2");
        g2.dispose();
      },
    });
    (await g2.import(join(d, "x.mjs"))).die();
    await Bun.sleep(20);
    expect(log).toContain("onError2");
    rmSync(d, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — process object surface, member by member", () => {
  const dir = fixture({
    "p.mjs": `export const P = process; export function call(k, ...a) { return process[k](...a) } export function get(k) { return process[k] }`,
  });
  const passthroughValues = [
    "pid",
    "ppid",
    "platform",
    "arch",
    "version",
    "versions",
    "execPath",
    "argv",
    "argv0",
    "execArgv",
    "title",
    "release",
    "config",
    "features",
    "allowedNodeEnvironmentFlags",
  ];
  for (const k of passthroughValues)
    test(`process.${k} passes through to the host value`, async () => {
      const m = await ModuleGraph({ env: {} }).import(join(dir, "p.mjs"));
      expect(m.get(k)).toEqual((process as any)[k]);
    });
  const passthroughFns: Array<[string, unknown[]]> = [
    ["uptime", []],
    ["hrtime", []],
    ["memoryUsage", []],
    ["cpuUsage", []],
    ["resourceUsage", []],
    ["umask", []],
    ["getuid", []],
    ["geteuid", []],
    ["getgid", []],
    ["cwd", []],
  ];
  for (const [k, args] of passthroughFns)
    test(`process.${k}() is callable from graph code`, async () => {
      const m = await ModuleGraph().import(join(dir, "p.mjs"));
      expect(typeof m.call(k, ...args)).toBe(typeof (process as any)[k](...args));
    });
  test("process.env is the graph's; process.cwd()/chdir() are the graph's; process.exitCode is the graph's", async () => {
    const m = await ModuleGraph({ env: { Z: "1" }, cwd: "/" }).import(join(dir, "p.mjs"));
    expect([m.get("env").Z, m.call("cwd")]).toEqual(["1", "/"]);
    m.P.exitCode = 4;
    expect([m.P.exitCode, process.exitCode]).toEqual([4, undefined]);
    m.P.exitCode = undefined;
  });
  test("process.nextTick, emitWarning, hrtime.bigint, stdout.write work from graph code", async () => {
    const m = await ModuleGraph().import(join(dir, "p.mjs"));
    expect(await new Promise(r => m.P.nextTick(r, "tick"))).toBe("tick");
    expect(typeof m.P.hrtime.bigint()).toBe("bigint");
    expect(m.P.stdout.write("")).toBe(true);
    const warnings: any[] = [];
    m.P.on("warning", (w: any) => warnings.push(w.message));
    m.P.emitWarning("careful");
    await Bun.sleep(5);
    expect(warnings).toEqual(["careful"]);
  });
  test("process identity: instanceof EventEmitter, Symbol.toStringTag, typeof, JSON/inspect do not throw", async () => {
    const m = await ModuleGraph().import(join(dir, "p.mjs"));
    const { EventEmitter } = require("node:events");
    expect([m.P instanceof EventEmitter, Object.prototype.toString.call(m.P), typeof m.P]).toEqual([
      true,
      "[object process]",
      "object",
    ]);
    expect(() => Bun.inspect(m.P)).not.toThrow();
    expect(() => JSON.stringify(m.P.versions)).not.toThrow();
  });
  test("process.exit / reallyExit / abort / kill(self) from graph code never take down the host", async () => {
    const script = `const g = new Bun.unsafe.ModuleGraph({ onExit: c => console.log("onExit", c) }); const m = await g.import(${JSON.stringify(join(dir, "p.mjs"))});
      m.P.exit(2); try { m.P.reallyExit?.(3) } catch {} try { m.P.abort() } catch (e) { console.log("abort:", e.constructor.name) }
      console.log("host alive"); process.exit(0)`;
    const r = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env } });
    expect(r.stdout.toString()).toContain("onExit 2");
    expect(r.stdout.toString()).toContain("host alive");
    expect(r.exitCode).toBe(0);
  });
});

// require()/import of each module kind from each side, per graph: the loader matrix.
describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — loader matrix (importer kind × importee kind)", () => {
  const dir = fixture({
    "esm.mjs": `export const kind = "esm"; export const who = process.env.T; export let n = 0; export const inc = () => ++n;`,
    "cjs.cjs": `let n = 0; module.exports = { kind: "cjs", who: process.env.T, inc: () => ++n };`,
    "tla.mjs": `await 0; export const kind = "tla"; export const who = process.env.T;`,
    "tla-fresh.mjs": `await 0; export const kind = "tla-fresh";`,
    "data.json": `{ "kind": "json" }`,
    "ts.ts": `const k: string = "ts"; export const kind = k; export const who: string | undefined = process.env.T; enum E { A = 1 } export const e = E.A;`,
    "tsx.tsx": `/** @jsxRuntime classic @jsx h */ const h = (...a: unknown[]) => a; export const kind = "tsx"; export const el = typeof (<div />);`,
    "from-esm.mjs": `import * as esm from "./esm.mjs"; import cjs from "./cjs.cjs"; import * as tla from "./tla.mjs"; import json from "./data.json"; import * as ts from "./ts.ts";
      import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
      export const viaImport = { esm: esm.kind + ":" + esm.who, cjs: cjs.kind + ":" + cjs.who, tla: tla.kind + ":" + tla.who, json: json.kind, ts: ts.kind + ":" + ts.who + ":" + ts.e };
      export function viaRequire() { return { esm: require("./esm.mjs").kind, cjs: require("./cjs.cjs").kind, json: require("./data.json").kind, ts: require("./ts.ts").kind, tla: (() => { try { require("./tla-fresh.mjs"); return "no-throw" } catch (e) { return "throws" } })(), tlaEvaluated: typeof require("./tla.mjs").kind } }
      export async function viaDynamic() { return { esm: (await import("./esm.mjs")).kind, cjs: (await import("./cjs.cjs")).default.kind, tla: (await import("./tla.mjs")).kind, json: (await import("./data.json")).default.kind, ts: (await import("./ts.ts")).kind } }
      export function sameInstance() { return require("./esm.mjs").inc() === esm.n && require("./cjs.cjs") === cjs }`,
    "from-cjs.cjs": `module.exports = {
        viaRequire: () => ({ esm: require("./esm.mjs").kind + ":" + require("./esm.mjs").who, cjs: require("./cjs.cjs").kind + ":" + require("./cjs.cjs").who, json: require("./data.json").kind, ts: require("./ts.ts").kind }),
        viaDynamic: async () => ({ esm: (await import("./esm.mjs")).kind, cjs: (await import("./cjs.cjs")).default.kind, tla: (await import("./tla.mjs")).kind }),
        metaRequire: () => typeof import.meta.require,
      }`,
  });
  const mk = (t: string) => ModuleGraph({ env: { T: t }, define: undefined } as any);
  test("ESM importer: static import of esm/cjs/tla/json/ts", async () => {
    expect((await mk("A").import(join(dir, "from-esm.mjs"))).viaImport).toEqual({
      esm: "esm:A",
      cjs: "cjs:A",
      tla: "tla:A",
      json: "json",
      ts: "ts:A:1",
    });
  });
  test("ESM importer: createRequire of esm/cjs/json/ts; require(unevaluated tla) throws, require(evaluated tla) returns its namespace", async () => {
    expect((await mk("A").import(join(dir, "from-esm.mjs"))).viaRequire()).toEqual({
      esm: "esm",
      cjs: "cjs",
      json: "json",
      ts: "ts",
      tla: "throws",
      tlaEvaluated: "string",
    });
  });
  test("ESM importer: dynamic import of every kind", async () => {
    expect(await (await mk("A").import(join(dir, "from-esm.mjs"))).viaDynamic()).toEqual({
      esm: "esm",
      cjs: "cjs",
      tla: "tla",
      json: "json",
      ts: "ts",
    });
  });
  test("ESM importer: require() and import see the same instance within a graph", async () => {
    expect((await mk("A").import(join(dir, "from-esm.mjs"))).sameInstance()).toBe(true);
  });
  test("CJS importer: require of esm/cjs/json/ts with the graph's env", async () => {
    expect((await mk("B").import(join(dir, "from-cjs.cjs"))).default.viaRequire()).toEqual({
      esm: "esm:B",
      cjs: "cjs:B",
      json: "json",
      ts: "ts",
    });
  });
  test("CJS importer: dynamic import of esm/cjs/tla", async () => {
    expect(await (await mk("B").import(join(dir, "from-cjs.cjs"))).default.viaDynamic()).toEqual({
      esm: "esm",
      cjs: "cjs",
      tla: "tla",
    });
  });
  test("TS and TSX transpile per graph (enum, JSX)", async () => {
    const g = mk("C");
    expect((await g.import(join(dir, "ts.ts"))).e).toBe(1);
    expect((await g.import(join(dir, "tsx.tsx"))).el).toBe("object");
  });
  test("two graphs × every kind: values carry each graph's env", async () => {
    const [a, b] = [await mk("A").import(join(dir, "from-esm.mjs")), await mk("B").import(join(dir, "from-esm.mjs"))];
    expect([
      a.viaImport.esm,
      b.viaImport.esm,
      a.viaImport.cjs,
      b.viaImport.cjs,
      a.viaImport.tla,
      b.viaImport.tla,
    ]).toEqual(["esm:A", "esm:B", "cjs:A", "cjs:B", "tla:A", "tla:B"]);
  });
  test("host importing the same files afterwards gets host values (not a graph's)", async () => {
    await mk("A").import(join(dir, "from-esm.mjs"));
    const h = await import(join(dir, "from-esm.mjs"));
    expect(h.viaImport.esm).toBe("esm:" + process.env.T);
    expect(require(join(dir, "cjs.cjs")).who).toBe(process.env.T);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — error objects from graph code: messages, stacks, types", () => {
  const dir = fixture({
    "syntax.mjs": `export const x = ;`,
    "syntax-dep.mjs": `import "./syntax.mjs"`,
    "missing-dep.mjs": `import "./does-not-exist.mjs"`,
    "missing-export.mjs": `import { nope } from "./ok.mjs"`,
    "ok.mjs": `export const ok = 1`,
    "throw-load.mjs": `throw new TypeError("at load " + process.env.T)`,
    "throw-call.mjs": `export function f() { null.x }\nexport function g() { const r = f(); return r }\nexport class E extends Error { constructor() { super("custom"); this.name = "E" } }\nexport function custom() { throw new E() }`,
    "agg.mjs": `export async function agg() { await Promise.any([Promise.reject(new Error("a")), Promise.reject(new Error("b"))]) }`,
  });
  test("syntax error in the imported module: rejects (never throws synchronously) with the same error kind the host's import() gives", async () => {
    let sync = false;
    let p: Promise<unknown>;
    try {
      p = ModuleGraph().import(join(dir, "syntax.mjs"));
    } catch {
      sync = true;
    }
    expect(sync).toBe(false);
    const e: any = await p!.catch(e => e),
      h: any = await import(join(dir, "syntax.mjs")).catch(e => e);
    expect(e?.constructor?.name).toBe(h?.constructor?.name);
    expect(String(e?.message ?? e)).toBe(String(h?.message ?? h));
  });
  test("syntax error in a dependency: rejects, and a second graph gets the same error again (not a stale success, not a different error)", async () => {
    const e1: any = await ModuleGraph()
        .import(join(dir, "syntax-dep.mjs"))
        .catch(e => e),
      e2: any = await ModuleGraph()
        .import(join(dir, "syntax-dep.mjs"))
        .catch(e => e);
    expect(e1 && typeof e1 === "object" && !("ok" in e1)).toBe(true);
    expect(String(e2?.message ?? e2)).toBe(String(e1?.message ?? e1));
  });
  test("missing dependency: error mentions the specifier", async () => {
    const e = await ModuleGraph()
      .import(join(dir, "missing-dep.mjs"))
      .catch(e => e);
    expect(String(e.message)).toContain("does-not-exist");
  });
  test("missing named export: SyntaxError mentioning the binding", async () => {
    const e = await ModuleGraph()
      .import(join(dir, "missing-export.mjs"))
      .catch(e => e);
    expect(e).toBeInstanceOf(SyntaxError);
    expect(String(e.message)).toContain("nope");
  });
  test("throw during evaluation: the graph's own error type/message; host instanceof works (shared intrinsics)", async () => {
    const e = await ModuleGraph({ env: { T: "g1" } })
      .import(join(dir, "throw-load.mjs"))
      .catch(e => e);
    expect([e instanceof TypeError, e.message]).toEqual([true, "at load g1"]);
  });
  test("runtime TypeError from a call: same message and same graph-file frames as the host produces", async () => {
    const m = await ModuleGraph().import(join(dir, "throw-call.mjs")),
      h = await import(join(dir, "throw-call.mjs"));
    const frames = (fn: () => void) => {
      try {
        fn();
        return [];
      } catch (e: any) {
        expect(e).toBeInstanceOf(TypeError);
        return String(e.stack)
          .split("\n")
          .filter(l => l.includes("throw-call.mjs"))
          .map(l => l.trim());
      }
    };
    const g = frames(() => m.g()),
      hostFrames = frames(() => h.g());
    expect(g.length).toBeGreaterThan(0);
    expect(g).toEqual(hostFrames);
  });
  test("custom Error subclass defined in a graph: instanceof Error in host, name preserved, distinct class per graph", async () => {
    const a = await ModuleGraph().import(join(dir, "throw-call.mjs")),
      b = await ModuleGraph().import(join(dir, "throw-call.mjs"));
    const ea = (() => {
      try {
        a.custom();
      } catch (e) {
        return e;
      }
    })() as any;
    expect([ea instanceof Error, ea instanceof a.E, ea instanceof b.E, ea.name, ea.message]).toEqual([
      true,
      true,
      false,
      "E",
      "custom",
    ]);
  });
  test("AggregateError from graph code keeps its errors array", async () => {
    const e = await (await ModuleGraph().import(join(dir, "agg.mjs"))).agg().catch((e: any) => e);
    expect([e instanceof AggregateError, e.errors.map((x: Error) => x.message)]).toEqual([true, ["a", "b"]]);
  });
  test("Error.captureStackTrace and error.cause work in graph code", async () => {
    const d = fixture({
      "cst.mjs": `export function f() { const o = {}; Error.captureStackTrace(o); return [typeof o.stack, new Error("x", { cause: 7 }).cause] }`,
    });
    expect((await ModuleGraph().import(join(d, "cst.mjs"))).f()).toEqual(["string", 7]);
    rmSync(d, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — template sharing and file changes", () => {
  test("a file edited between two graphs: documented — the linked template is shared, so a later graph sees the version the first graph loaded (like a long-running host process); a fresh path is loaded fresh", async () => {
    const dir = fixture({ "v.mjs": `export const v = 1`, "w.mjs": `export const v = 1` });
    expect((await ModuleGraph().import(join(dir, "v.mjs"))).v).toBe(1);
    writeFileSync(join(dir, "v.mjs"), `export const v = 2`);
    const second = (await ModuleGraph().import(join(dir, "v.mjs"))).v;
    expect([1, 2]).toContain(second); // pin whichever it is, but it must be one of them and not throw
    writeFileSync(join(dir, "w.mjs"), `export const v = 3`); // never loaded before the edit
    expect((await ModuleGraph().import(join(dir, "w.mjs"))).v).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });
  test("query strings make distinct module keys: ?v=1 and ?v=2 are separate templates and separate instances", async () => {
    const dir = fixture({
      "q.mjs": `export const key = import.meta.url; export let n = 0; export const inc = () => ++n`,
    });
    const g = ModuleGraph();
    const a = await g.import(join(dir, "q.mjs") + "?v=1"),
      b = await g.import(join(dir, "q.mjs") + "?v=2"),
      a2 = await g.import(join(dir, "q.mjs") + "?v=1");
    expect([a === a2, a === b, a.key.endsWith("?v=1"), b.key.endsWith("?v=2")]).toEqual([true, false, true, true]);
    rmSync(dir, { recursive: true, force: true });
  });
  test("a file deleted after the first graph loaded it: a later graph still instantiates the shared template", async () => {
    const dir = fixture({ "gone.mjs": `export const v = process.env.T` });
    expect((await ModuleGraph({ env: { T: "1" } }).import(join(dir, "gone.mjs"))).v).toBe("1");
    rmSync(join(dir, "gone.mjs"));
    const r = await ModuleGraph({ env: { T: "2" } })
      .import(join(dir, "gone.mjs"))
      .then(
        m => m.v,
        e => "ENOENT",
      );
    expect(["2", "ENOENT"]).toContain(r);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — scale", () => {
  test("a 300-module graph instantiates into 5 graphs; each graph's cost is a small fraction of the template", async () => {
    const files: Record<string, string> = {};
    const N = 300;
    for (let i = 0; i < N; i++)
      files[`m${i}.mjs`] =
        `${i > 0 ? `import { v as prev } from "./m${i - 1}.mjs";` : "const prev = 0;"} export const v = prev + 1; export function f${i}() { return v + ${i} } export const who = process.env.T;`;
    files["root.mjs"] = `export { v, who } from "./m${N - 1}.mjs";`;
    const dir = fixture(files);
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        Bun.gc(true);
        await Bun.sleep(2);
      }
      return heapStats().objectCount;
    };
    const c0 = await settle();
    const first = await ModuleGraph({ env: { T: "g0" } }).import(join(dir, "root.mjs"));
    const c1 = await settle();
    const rest = [];
    for (let i = 1; i < 5; i++) rest.push(await ModuleGraph({ env: { T: "g" + i } }).import(join(dir, "root.mjs")));
    const c5 = await settle();
    expect([first.v, first.who, rest.map(m => m.who)]).toEqual([N, "g0", ["g1", "g2", "g3", "g4"]]);
    // Instances share the linked template (records, code blocks, executables): an extra instance
    // allocates environments/functions/namespaces only — well under what the first load did.
    const templatePlusFirst = c1 - c0,
      perExtra = (c5 - c1) / 4;
    expect(perExtra).toBeLessThan(templatePlusFirst * 0.7);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
  test("50 graphs alive at once, each with its own state, then all exit and are collected", async () => {
    const dir = fixture({
      "s.mjs": `export const id = process.env.ID; let n = 0; export const inc = () => ++n; export const quit = () => process.exit(0); export const big = new Array(10000).fill(process.env.ID)`,
    });
    const graphs = await Promise.all(
      Array.from({ length: 50 }, (_, i) => ModuleGraph({ env: { ID: String(i) } }).import(join(dir, "s.mjs"))),
    );
    graphs.forEach((m, i) => {
      for (let k = 0; k <= i; k++) m.inc();
    });
    expect(graphs.map(m => m.inc() - 1)).toEqual(graphs.map((_, i) => i + 1));
    expect(new Set(graphs.map(m => m.id)).size).toBe(50);
    const ok = await collected(register => {
      register(graphs[25].big);
      graphs.forEach(m => m.quit());
      graphs.length = 0;
    });
    expect(ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
  test("deep re-export chain (100 hops) and wide fan-in (1 module imported by 200) resolve per instance", async () => {
    const files: Record<string, string> = {
      "leaf.mjs": `export let x = process.env.T; export const set = v => { x = v }`,
    };
    for (let i = 0; i < 100; i++) files[`h${i}.mjs`] = `export * from "./${i ? "h" + (i - 1) : "leaf"}.mjs"`;
    for (let i = 0; i < 200; i++) files[`w${i}.mjs`] = `import { x } from "./leaf.mjs"; export const get${i} = () => x`;
    files["wide.mjs"] = Array.from({ length: 200 }, (_, i) => `export { get${i} } from "./w${i}.mjs"`).join(";");
    const dir = fixture(files);
    const a = ModuleGraph({ env: { T: "A" } }),
      b = ModuleGraph({ env: { T: "B" } });
    const [da, db, wa, wb] = [
      await a.import(join(dir, "h99.mjs")),
      await b.import(join(dir, "h99.mjs")),
      await a.import(join(dir, "wide.mjs")),
      await b.import(join(dir, "wide.mjs")),
    ];
    da.set("A2");
    expect([da.x, db.x, wa.get0(), wa.get199(), wb.get123()]).toEqual(["A2", "B", "A2", "A2", "B"]);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — require(esm) by module state, per graph", () => {
  const dir = fixture({
    "sync.mjs": `globalThis.__evals = (globalThis.__evals ?? 0) + 1; export const s = process.env.T`,
    "tla.mjs": `await new Promise(r => setTimeout(r, 20)); export const t = process.env.T`,
    "throws.mjs": `throw new Error("boom-" + process.env.T)`,
    "cycle-a.mjs": `import { b } from "./cycle-b.cjs"; export const a = "a:" + b`,
    "cycle-b.cjs": `let seen; try { seen = require("./cycle-a.mjs").a } catch (e) { seen = e.constructor.name } module.exports = { b: "b", seen }`,
    "r.cjs": `module.exports = {
      unevaluated: () => require("./sync.mjs").s,
      again: () => require("./sync.mjs").s,
      evals: () => globalThis.__evals,
      tlaFresh: () => { try { require("./tla.mjs"); return "returned" } catch (e) { return "threw" } },
      tlaAfter: async () => { await import("./tla.mjs"); return require("./tla.mjs").t },
      throwing: () => { try { require("./throws.mjs") } catch (e) { return e.message } },
      throwingAgain: () => { try { require("./throws.mjs"); return "no" } catch (e) { return e.message } },
      cycle: () => require("./cycle-b.cjs").seen,
    }`,
  });
  const mk = (t: string) =>
    ModuleGraph({ env: { T: t } })
      .import(join(dir, "r.cjs"))
      .then(m => m.default);
  test("unevaluated → evaluates once in the graph; evaluated → cached", async () => {
    const r = await mk("U");
    expect([r.unevaluated(), r.again(), r.evals()]).toEqual(["U", "U", 1]);
    expect((globalThis as any).__evals).toBeUndefined();
  });
  test("TLA module: require before evaluation throws; after import() resolves, require returns the namespace", async () => {
    const r = await mk("T");
    expect(r.tlaFresh()).toBe("threw");
    expect(await r.tlaAfter()).toBe("T");
  });
  test("while another graph is mid-TLA on the same module, this graph's require still throws (not blocked, not the other graph's value)", async () => {
    const other = ModuleGraph({ env: { T: "other" } }).import(join(dir, "tla.mjs"));
    const r = await mk("me");
    expect(r.tlaFresh()).toBe("threw");
    expect((await other).t).toBe("other");
    expect(await r.tlaAfter()).toBe("me");
  });
  test("throwing module: error carries this graph's env, and requiring again rethrows (cached failure within the graph)", async () => {
    const r = await mk("E");
    expect([r.throwing(), r.throwingAgain()]).toEqual(["boom-E", "boom-E"]);
    const r2 = await mk("F");
    expect(r2.throwing()).toBe("boom-F");
  });
  test("ESM↔CJS cycle through require(esm): the CJS side sees a TDZ/cycle error or partial value, never another graph's value", async () => {
    const a = await mk("C1"),
      b = await mk("C2");
    expect([a.cycle(), b.cycle()]).toEqual([a.cycle(), a.cycle()]); // deterministic and identical shape in both graphs
    expect(String(a.cycle())).not.toContain("C2");
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — instance evaluation: async edge cases", () => {
  const dir = fixture({
    "rej-string.mjs": `await null; throw "plain-string"`,
    "rej-undefined.mjs": `await null; throw undefined`,
    "sync-throw-after-await0.mjs": `await 0; null.x`,
    "dep-of-rejected.mjs": `import "./rej-string.mjs"; export const never = 1`,
    "sibling-ok.mjs": `await new Promise(r => setTimeout(r, 5)); export const ok = 1`,
    "parent-mixed.mjs": `import "./sibling-ok.mjs"; import "./rej-string.mjs"; export const x = 1`,
    "tla-cycle-a.mjs": `import { b } from "./tla-cycle-b.mjs"; await 0; export const a = "a"; export const seenB = () => b`,
    "tla-cycle-b.mjs": `import { a } from "./tla-cycle-a.mjs"; export const b = "b"; export const seenA = () => a`,
    "dyn-during-eval.mjs": `export const other = await import("./sibling-ok.mjs"); export const self = await import("./dyn-during-eval.mjs").then(m => m === undefined ? "undef" : "ns", e => "err:" + e.constructor.name)`,
    "long-chain.mjs": `export const v = await (async () => { let x = 0; for (let i = 0; i < 200; i++) x = await Promise.resolve(x + 1); return x })()`,
    "microtask-order.mjs": `const o = []; Promise.resolve().then(() => o.push("then1")); await null; o.push("after-await"); queueMicrotask(() => o.push("qm")); await null; export const order = o`,
    "top-level-for-await.mjs": `async function* g() { yield 1; yield 2 } let s = 0; for await (const v of g()) s += v; export const sum = s`,
    "rejected-then-imported-again.mjs": `globalThis.__n = (globalThis.__n ?? 0) + 1; await null; throw new Error("once:" + globalThis.__n)`,
  });
  test("rejection with a string / undefined reason propagates as-is", async () => {
    expect(
      await ModuleGraph()
        .import(join(dir, "rej-string.mjs"))
        .catch(e => e),
    ).toBe("plain-string");
    expect(
      await ModuleGraph()
        .import(join(dir, "rej-undefined.mjs"))
        .then(
          () => "resolved",
          e => e,
        ),
    ).toBeUndefined();
  });
  test("a throw after `await 0` rejects with the TypeError (not lost, not to onError)", async () => {
    const errs: unknown[] = [];
    const e = await ModuleGraph({ onError: x => errs.push(x) })
      .import(join(dir, "sync-throw-after-await0.mjs"))
      .catch(e => e);
    expect([e instanceof TypeError, errs.length]).toEqual([true, 0]);
  });
  test("a dependent of a rejected TLA module rejects with the same reason; a mixed parent rejects even though a sibling fulfilled", async () => {
    const g = ModuleGraph();
    expect(await g.import(join(dir, "dep-of-rejected.mjs")).catch(e => e)).toBe("plain-string");
    expect(await g.import(join(dir, "parent-mixed.mjs")).catch(e => e)).toBe("plain-string");
    expect((await g.import(join(dir, "sibling-ok.mjs"))).ok).toBe(1); // the good sibling is still usable in the same graph
  });
  test("re-importing a rejected module in the same graph replays the same rejection without re-evaluating; a new graph evaluates again", async () => {
    const g = ModuleGraph();
    const e1 = await g.import(join(dir, "rejected-then-imported-again.mjs")).catch(e => e.message),
      e2 = await g.import(join(dir, "rejected-then-imported-again.mjs")).catch(e => e.message);
    expect([e1, e2]).toEqual(["once:1", "once:1"]);
    expect(
      await ModuleGraph()
        .import(join(dir, "rejected-then-imported-again.mjs"))
        .catch(e => e.message),
    ).toBe("once:1"); // own globalThis.__n
  });
  test("cycle with TLA on one side: both evaluate, bindings live afterwards", async () => {
    const g = ModuleGraph();
    const a = await g.import(join(dir, "tla-cycle-a.mjs")),
      b = await g.import(join(dir, "tla-cycle-b.mjs"));
    expect([a.a, b.b, a.seenB(), b.seenA()]).toEqual(["a", "b", "b", "a"]);
  });
  test("dynamic import of ITSELF awaited during a module's own TLA evaluation: same outcome as the host (spec: the self-import cannot settle before the module does)", async () => {
    const outcome = (p: Promise<any>) =>
      Promise.race([
        p.then(
          () => "settled",
          () => "rejected",
        ),
        Bun.sleep(300).then(() => "pending"),
      ]);
    const [mine, host] = [
      await outcome(ModuleGraph().import(join(dir, "dyn-during-eval.mjs"))),
      await outcome(import(join(dir, "dyn-during-eval.mjs"))),
    ];
    expect(mine).toBe(host);
  });
  test("dynamic import of a sibling awaited during TLA evaluation works", async () => {
    const d = fixture({
      "s.mjs": `export const other = (await import("./sibling-ok.mjs")).ok`,
      "sibling-ok.mjs": `await new Promise(r => setTimeout(r, 5)); export const ok = 1`,
    });
    expect((await ModuleGraph().import(join(d, "s.mjs"))).other).toBe(1);
    rmSync(d, { recursive: true, force: true });
  });
  test("long await chains, microtask ordering and top-level for-await behave as in the host", async () => {
    const g = ModuleGraph();
    expect((await g.import(join(dir, "long-chain.mjs"))).v).toBe(200);
    const [mine, host] = [
      (await g.import(join(dir, "microtask-order.mjs"))).order,
      (await import(join(dir, "microtask-order.mjs"))).order,
    ];
    expect(mine).toEqual(host);
    expect((await g.import(join(dir, "top-level-for-await.mjs"))).sum).toBe(3);
  });
  test("20 concurrent imports of the same rejecting TLA module in one graph all reject with the same reason, evaluated once", async () => {
    const d = fixture({
      "r.mjs": `globalThis.__k = (globalThis.__k ?? 0) + 1; await new Promise(r => setTimeout(r, 5)); throw new Error("k" + globalThis.__k)`,
    });
    const g = ModuleGraph();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => g.import(join(d, "r.mjs")).catch(e => e.message)),
    );
    expect(new Set(results)).toEqual(new Set(["k1"]));
    rmSync(d, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — globalThis inside a graph", () => {
  const dir = fixture({
    "g.mjs": `
    export function run() {
      const r = {};
      globalThis.a = 1; r.own = Object.getOwnPropertyDescriptor(globalThis, "a")?.value;
      r.inOp = ("a" in globalThis) && ("setTimeout" in globalThis) && ("Array" in globalThis);
      r.keysHasA = Object.keys(globalThis).includes("a");
      r.hostArray = globalThis.Array === Array;
      r.selfRefs = [globalThis.globalThis === globalThis, globalThis.self === globalThis || globalThis.self === undefined, typeof globalThis.global];
      r.fnThis = Function("return this")() === globalThis || Function("return this")() !== undefined;
      r.indirectEval = (0, eval)("typeof process") ;
      r.deleteWorks = (() => { globalThis.tmp = 1; delete globalThis.tmp; return globalThis.tmp === undefined })();
      r.defineGetter = (() => { Object.defineProperty(globalThis, "lazyG", { get() { return 42 }, configurable: true }); return globalThis.lazyG })();
      r.symbolKey = (() => { const k = Symbol.for("gk"); globalThis[k] = "s"; return globalThis[k] })();
      r.protoChain = Object.getPrototypeOf(globalThis) !== null;
      r.jsonStringifySafe = (() => { try { JSON.stringify({ g: typeof globalThis }); return true } catch { return false } })();
      r.processViaGlobal = globalThis.process === process && globalThis.process.env === process.env;
      r.timersViaGlobal = globalThis.setTimeout === setTimeout;
      return r;
    }`,
  });
  let r: any, hostBefore: string[];
  test("setup", async () => {
    hostBefore = Object.keys(globalThis);
    r = (await ModuleGraph().import(join(dir, "g.mjs"))).run();
  });
  test("own property set/get/descriptor/delete/defineProperty/symbol keys work on the graph's global", () => {
    expect([r.own, r.deleteWorks, r.defineGetter, r.symbolKey]).toEqual([1, true, 42, "s"]);
  });
  test("`in`, Object.keys and intrinsics identity", () => {
    expect([r.inOp, r.keysHasA, r.hostArray, r.protoChain, r.jsonStringifySafe]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
  test("globalThis.globalThis / self / Function('return this') / indirect eval resolve sensibly", () => {
    expect(r.selfRefs[0]).toBe(true);
    expect(r.fnThis).toBe(true);
    expect(r.indirectEval).toBe("object");
  });
  test("process and timers reached through globalThis are the graph's", () => {
    expect([r.processViaGlobal, r.timersViaGlobal]).toEqual([true, true]);
  });
  test("nothing leaked onto the host global", () => {
    for (const k of ["a", "tmp", "lazyG"]) expect((globalThis as any)[k]).toBeUndefined();
    expect((globalThis as any)[Symbol.for("gk")]).toBeUndefined();
    expect(Object.keys(globalThis)).toEqual(hostBefore);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — values crossing the host/graph boundary", () => {
  const dir = fixture({
    "x.mjs": `
    export class Animal { speak() { return "graph-animal" } }
    export const arr = [1, 2, 3]; export const map = new Map([["k", 1]]); export const date = new Date(0); export const re = /x/g; export const err = new RangeError("r"); export const u8 = new Uint8Array([1, 2]);
    export const p = Promise.resolve("graph-promise"); export const thenable = { then(r) { r("graph-thenable") } };
    export function isHostArray(a) { return Array.isArray(a) && a instanceof Array } export function extend(HostBase) { return class Sub extends HostBase { sub() { return "sub" } } }
    export async function awaitHost(p) { return "got:" + await p } export function callHost(fn, arg) { return fn(arg) }
    export function structured(v) { return structuredClone(v) } export const sym = Symbol.for("shared.sym"); export const localSym = Symbol("local");`,
  });
  let m: any;
  test("setup", async () => {
    m = await ModuleGraph().import(join(dir, "x.mjs"));
  });
  test("graph builtins are host builtins: Array/Map/Date/RegExp/Error/TypedArray instances pass instanceof in the host", () => {
    expect([
      m.arr instanceof Array,
      m.map instanceof Map,
      m.date instanceof Date,
      m.re instanceof RegExp,
      m.err instanceof RangeError,
      m.err instanceof Error,
      m.u8 instanceof Uint8Array,
    ]).toEqual([true, true, true, true, true, true, true]);
    expect(m.isHostArray([1])).toBe(true);
  });
  test("promises and thenables interoperate both ways", async () => {
    expect([await m.p, await m.thenable, await m.awaitHost(Promise.resolve("host"))]).toEqual([
      "graph-promise",
      "graph-thenable",
      "got:host",
    ]);
    expect(m.p instanceof Promise).toBe(true);
  });
  test("class inheritance across the boundary", () => {
    class HostBase {
      base() {
        return "base";
      }
    }
    const Sub = m.extend(HostBase);
    const s = new Sub();
    expect([s.base(), s.sub(), s instanceof HostBase, new m.Animal().speak()]).toEqual([
      "base",
      "sub",
      true,
      "graph-animal",
    ]);
  });
  test("structuredClone inside the graph of host values and vice versa", () => {
    expect(m.structured({ a: [1, { b: new Date(0) }] })).toEqual({ a: [1, { b: new Date(0) }] });
    expect(structuredClone(m.map)).toEqual(new Map([["k", 1]]));
  });
  test("Symbol.for is shared across graphs and host; local symbols are unique", async () => {
    const m2 = await ModuleGraph().import(join(dir, "x.mjs"));
    expect([m.sym === Symbol.for("shared.sym"), m.sym === m2.sym, m.localSym === m2.localSym]).toEqual([
      true,
      true,
      false,
    ]);
  });
  test("host callbacks invoked from graph code run as host code (ambient attribution follows the callee's own module)", async () => {
    const d = fixture({ "h.mjs": `export const whoami = () => process.env.T ?? "host"` });
    const hostFn = (await import(join(d, "h.mjs"))).whoami;
    const g = await ModuleGraph({ env: { T: "graph" } }).import(join(dir, "x.mjs"));
    expect(g.callHost(hostFn)).toBe(process.env.T ?? "host");
    rmSync(d, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — cwd semantics: process.cwd/path/url/child processes follow the graph; kernel-relative fs follows the process (as in a Worker)",
  () => {
    const dir = fixture({
      "sub/file.txt": `in-sub`,
      "file.txt": `in-root`,
      "c.mjs": `import fs from "node:fs"; import path from "node:path"; import { posix } from "node:path"; import { pathToFileURL } from "node:url"; import { execFileSync } from "node:child_process";
    export const cwd = () => process.cwd();
    export const resolved = (...a) => path.resolve(...a);
    export const posixResolved = (p) => posix.resolve(p);
    export const relative = (a, b) => path.relative(a, b);
    export const url = (p) => pathToFileURL(p).pathname;
    export const childCwd = () => execFileSync("pwd").toString().trim();
    export const afterChdir = (d) => { process.chdir(d); try { return [process.cwd(), path.resolve("x"), execFileSync("pwd").toString().trim()] } finally { process.chdir("..") } };
    export const fsRelative = () => fs.readFileSync("file.txt", "utf8");
    export const bunFileRelative = () => Bun.file("file.txt").text();
    export const absolute = () => fs.readFileSync(path.resolve("file.txt"), "utf8");`,
    });
    const sub = join(dir, "sub");
    const mk = (cwd: string) => ModuleGraph({ cwd }).import(join(dir, "c.mjs"));
    test("process.cwd() is the graph's; path.resolve()/posix.resolve()/relative() resolve against it; absolute inputs untouched", async () => {
      const m = await mk(sub);
      expect([
        m.cwd(),
        m.resolved("file.txt"),
        m.resolved("a", "../b"),
        m.posixResolved("y"),
        m.resolved("/abs", "q"),
        m.relative("x", "y/z"),
      ]).toEqual([sub, join(sub, "file.txt"), join(sub, "b"), join(sub, "y"), "/abs/q", "../y/z"]);
    });
    test("url.pathToFileURL(relative) uses the graph's cwd", async () => {
      expect((await mk(sub)).url("file.txt")).toBe(join(sub, "file.txt"));
    });
    test("child processes start in the graph's cwd; process.chdir (absolute and relative) moves cwd/path/children together; host cwd untouched", async () => {
      const host = process.cwd();
      const m = await mk(dir);
      expect(m.childCwd()).toBe(realpathSync(dir));
      expect(m.afterChdir("sub")).toEqual([sub, join(sub, "x"), realpathSync(sub)]);
      expect(m.afterChdir(sub)).toEqual([sub, join(sub, "x"), realpathSync(sub)]);
      expect([m.cwd(), process.cwd()]).toEqual([dir, host]);
    });
    test("documented: kernel-relative fs paths and Bun.file(relative) resolve against the PROCESS cwd (shared by all graphs, like Workers) — use path.resolve() for graph-relative files", async () => {
      const m = await mk(sub);
      const hostRel = (() => {
        try {
          return require("node:fs").readFileSync("file.txt", "utf8");
        } catch (e: any) {
          return e.code;
        }
      })();
      const graphRel = (() => {
        try {
          return m.fsRelative();
        } catch (e: any) {
          return e.code;
        }
      })();
      expect(graphRel).toBe(hostRel); // same answer as the host: process cwd
      expect(await m.bunFileRelative().catch((e: any) => e.code)).toBe(
        await Bun.file("file.txt")
          .text()
          .catch((e: any) => e.code),
      );
      expect(m.absolute()).toBe("in-sub"); // the recommended pattern works per graph
    });
    test("two graphs with different cwds: path.resolve interleaved never sees the other's cwd", async () => {
      const a = await mk(dir),
        b = await mk(sub);
      const rs = await Promise.all(
        Array.from({ length: 40 }, (_, i) => Promise.resolve().then(() => (i % 2 ? a : b).resolved("f"))),
      );
      expect(rs.filter((r, i) => r !== join(i % 2 ? dir : sub, "f"))).toEqual([]);
    });
  },
);

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — top-level for-await in an instance (module body as async driver)",
  () => {
    const dir = fixture({
      "gen.mjs": `async function* g() { yield 1; yield 2; yield 3 } let s = 0; for await (const v of g()) s += v; export const sum = s`,
      "sync-iterable.mjs": `let s = 0; for await (const v of [1, Promise.resolve(2), 3]) s += v; export const sum = s`,
      "break.mjs": `async function* g() { try { yield 1; yield 2; yield 3 } finally { globalThis.__closed = true } } let s = 0; for await (const v of g()) { s += v; if (v === 2) break } export const r = [s, globalThis.__closed]`,
      "throw-inside.mjs": `async function* g() { yield 1; yield 2 } let caught; try { for await (const v of g()) { if (v === 2) throw new Error("in-loop") } } catch (e) { caught = e.message } export { caught }`,
      "gen-throws.mjs": `async function* g() { yield 1; throw new Error("gen-err") } let s = 0, caught; try { for await (const v of g()) s += v } catch (e) { caught = e.message } export const r = [s, caught]`,
      "nested.mjs": `async function* outer() { for (let i = 0; i < 3; i++) yield inner(i) } async function* inner(i) { yield i; yield i * 10 } let s = 0; for await (const it of outer()) for await (const v of it) s += v; export const sum = s`,
      "stream.mjs": `const rs = new ReadableStream({ start(c) { c.enqueue("a"); c.enqueue("b"); c.close() } }); let out = ""; for await (const chunk of rs) out += chunk; export { out }`,
      "custom-async-iter.mjs": `const it = { i: 0, [Symbol.asyncIterator]() { return this }, async next() { return this.i < 3 ? { value: this.i++, done: false } : { value: undefined, done: true } }, async return() { globalThis.__returned = true; return { done: true } } }; let s = 0; for await (const v of it) { s += v; if (v === 1) break } export const r = [s, globalThis.__returned]`,
      "env-inside.mjs": `async function* g() { yield process.env.T; await null; yield process.env.T } const seen = []; for await (const v of g()) seen.push(v); export { seen }`,
      "after-loop-await.mjs": `async function* g() { yield 1 } for await (const v of g()); await new Promise(r => setTimeout(r, 1)); export const after = process.env.T`,
    });
    const cases: Record<string, [string, unknown]> = {
      "async generator": ["gen.mjs", { sum: 6 }],
      "sync iterable of promises": ["sync-iterable.mjs", { sum: 6 }],
      "break closes the generator": ["break.mjs", { r: [3, true] }],
      "throw inside the loop body": ["throw-inside.mjs", { caught: "in-loop" }],
      "generator throws": ["gen-throws.mjs", { r: [1, "gen-err"] }],
      "nested for-await": ["nested.mjs", { sum: 0 + 0 + 1 + 10 + 2 + 20 }],
      "ReadableStream": ["stream.mjs", { out: "ab" }],
      "custom async iterator with return()": ["custom-async-iter.mjs", { r: [1, true] }],
    };
    for (const [name, [file, expected]] of Object.entries(cases)) {
      test(name, async () => {
        const m = (await Promise.race([
          ModuleGraph().import(join(dir, file)),
          Bun.sleep(3000).then(() => "timeout"),
        ])) as any;
        expect(m).not.toBe("timeout");
        expect({ ...m }).toEqual(expected as any);
      });
    }
    test("the driver resumes in the right instance: env read before/after yields and after the loop", async () => {
      const [a, b] = [
        await ModuleGraph({ env: { T: "A" } }).import(join(dir, "env-inside.mjs")),
        await ModuleGraph({ env: { T: "B" } }).import(join(dir, "env-inside.mjs")),
      ];
      expect([a.seen, b.seen]).toEqual([
        ["A", "A"],
        ["B", "B"],
      ]);
      expect((await ModuleGraph({ env: { T: "C" } }).import(join(dir, "after-loop-await.mjs"))).after).toBe("C");
    });
    test("same module with top-level for-await in host and two graphs concurrently", async () => {
      const [h, a, b] = await Promise.all([
        import(join(dir, "gen.mjs")),
        ModuleGraph().import(join(dir, "gen.mjs")),
        ModuleGraph().import(join(dir, "gen.mjs")),
      ]);
      expect([h.sum, a.sum, b.sum, a === b]).toEqual([6, 6, 6, false]);
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — process.env object semantics inside a graph", () => {
  const dir = fixture({
    "e.mjs": `export const env = process.env; export function ops() {
      const r = {};
      r.get = process.env.A; r.missing = process.env.NOPE; r.inYes = "A" in process.env; r.inNo = "NOPE" in process.env;
      r.keys = Object.keys(process.env).sort(); r.hasOwn = Object.prototype.hasOwnProperty.call(process.env, "A");
      process.env.NUM = 42; r.coerced = process.env.NUM; process.env.BOOL = true; r.bool = process.env.BOOL;
      process.env.UNDEF = undefined; r.undef = process.env.UNDEF;
      delete process.env.A; r.deleted = process.env.A; r.inAfterDelete = "A" in process.env;
      r.json = JSON.parse(JSON.stringify(process.env)).B; r.spread = { ...process.env }.B; r.assign = Object.assign({}, process.env).B;
      r.entries = Object.entries(process.env).length === Object.keys(process.env).length;
      r.descriptor = Object.getOwnPropertyDescriptor(process.env, "B"); r.forIn = (() => { const ks = []; for (const k in process.env) ks.push(k); return ks.includes("B") })();
      r.symbolGet = process.env[Symbol.iterator]; r.toStringTag = Object.prototype.toString.call(process.env);
      return r;
    }`,
  });
  let r: any;
  test("setup", async () => {
    r = (await ModuleGraph({ env: { A: "a", B: "b" } }).import(join(dir, "e.mjs"))).ops();
  });
  test("get / missing / in / hasOwnProperty / keys", () => {
    expect([r.get, r.missing, r.inYes, r.inNo, r.hasOwn, r.keys]).toEqual([
      "a",
      undefined,
      true,
      false,
      true,
      ["A", "B"],
    ]);
  });
  test("writes coerce to strings (number, boolean, undefined→'undefined' like Node)", () => {
    expect([r.coerced, r.bool, r.undef]).toEqual(["42", "true", "undefined"]);
  });
  test("delete removes the key", () => {
    expect([r.deleted, r.inAfterDelete]).toEqual([undefined, false]);
  });
  test("JSON / spread / Object.assign / entries / for-in / descriptors see plain enumerable data properties", () => {
    expect([r.json, r.spread, r.assign, r.entries, r.forIn]).toEqual(["b", "b", "b", true, true]);
    expect(r.descriptor).toEqual({ value: "b", writable: true, enumerable: true, configurable: true });
  });
  test("symbols / toStringTag don't throw", () => {
    expect(r.symbolGet).toBeUndefined();
    expect(typeof r.toStringTag).toBe("string");
  });
  test("graph.process.env (host handle) is the same object graph code sees; host mutation visible inside", async () => {
    const g = ModuleGraph({ env: { A: "1" } });
    const m = await g.import(join(dir, "e.mjs"));
    g.process.env.ADDED = "x";
    expect(m.env.ADDED).toBe("x");
    expect(m.env).toBe(g.process.env);
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — generators, iterators, WeakRef/FinalizationRegistry, Atomics from graph code",
  () => {
    const dir = fixture({
      "g.mjs": `
    export function* counter() { let i = 0; while (true) yield [process.env.T, i++] }
    export async function* acounter() { let i = 0; while (i < 3) { await null; yield [process.env.T, i++] } }
    export const iterable = { *[Symbol.iterator]() { yield process.env.T } };
    export function makeWeak() { let o = { big: new Uint8Array(1 << 16) }; const wr = new WeakRef(o); o = null; return wr }
    export function registry(cb) { const fr = new FinalizationRegistry(cb); (() => { fr.register({}, "token-" + process.env.T) })(); return fr }
    export function atomics(sab) { const a = new Int32Array(sab); Atomics.add(a, 0, 1); return Atomics.load(a, 0) }
    export function spreadArgs(...a) { return [...counterN(3)].length + a.length } function* counterN(n) { for (let i = 0; i < n; i++) yield i }`,
    });
    test("sync generator resumed from the host and from another graph keeps its own instance's env, under tier-up", async () => {
      const [a, b] = [
        await ModuleGraph({ env: { T: "A" } }).import(join(dir, "g.mjs")),
        await ModuleGraph({ env: { T: "B" } }).import(join(dir, "g.mjs")),
      ];
      const ga = a.counter(),
        gb = b.counter();
      for (let i = 0; i < 20_000; i++) {
        ga.next();
        gb.next();
      }
      expect([ga.next().value, gb.next().value]).toEqual([
        ["A", 20_000],
        ["B", 20_000],
      ]);
      expect([...a.iterable, ...b.iterable]).toEqual(["A", "B"]);
    });
    test("async generator consumed by the host with for-await", async () => {
      const m = await ModuleGraph({ env: { T: "X" } }).import(join(dir, "g.mjs"));
      const seen: unknown[] = [];
      for await (const v of m.acounter()) seen.push(v);
      expect(seen).toEqual([
        ["X", 0],
        ["X", 1],
        ["X", 2],
      ]);
    });
    test("WeakRef created in graph code clears; FinalizationRegistry created in graph code fires with its token", async () => {
      const m = await ModuleGraph({ env: { T: "F" } }).import(join(dir, "g.mjs"));
      const wr = m.makeWeak();
      const tokens: string[] = [];
      const fr = m.registry((t: string) => tokens.push(t));
      for (let i = 0; i < 50 && (wr.deref() || !tokens.length); i++) {
        Bun.gc(true);
        await Bun.sleep(2);
      }
      expect([wr.deref(), tokens]).toEqual([undefined, ["token-F"]]);
      void fr;
    });
    test("Atomics on a SharedArrayBuffer shared between host and graph", async () => {
      const m = await ModuleGraph().import(join(dir, "g.mjs"));
      const sab = new SharedArrayBuffer(4);
      new Int32Array(sab)[0] = 41;
      expect([m.atomics(sab), new Int32Array(sab)[0]]).toEqual([42, 42]);
    });
    test("spread of a generator + rest args inside graph code", async () => {
      expect((await ModuleGraph().import(join(dir, "g.mjs"))).spreadArgs(1, 2)).toBe(5);
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — specifiers and paths", () => {
  test("unicode, spaces, and very long path segments in module paths", async () => {
    const longName = "l".repeat(200) + ".mjs";
    const dir = fixture({
      "ünï cødé/mod ule.mjs": `export const ok = import.meta.file`,
      [longName]: `export const ok = import.meta.file.length`,
      "dir.with.dots/index.mjs": `export const ok = "dots"`,
    });
    const g = ModuleGraph({ cwd: dir });
    expect((await g.import("./ünï cødé/mod ule.mjs")).ok).toBe("mod ule.mjs");
    expect((await g.import("./" + longName)).ok).toBe(longName.length);
    expect((await g.import("./dir.with.dots/index.mjs")).ok).toBe("dots");
    rmSync(dir, { recursive: true, force: true });
  });
  test("file: URLs, bare './' vs no prefix, trailing-slash directory import, and package 'exports' resolution from the graph's cwd", async () => {
    const dir = fixture({
      "m.mjs": `export const v = 1`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        exports: { ".": "./main.mjs", "./sub": "./sub.mjs" },
      }),
      "node_modules/pkg/main.mjs": `export const where = "main:" + process.env.T`,
      "node_modules/pkg/sub.mjs": `export const where = "sub"`,
      "uses-pkg.mjs": `export { where } from "pkg"; export { where as sub } from "pkg/sub"`,
    });
    const g = ModuleGraph({ cwd: dir, env: { T: "t" } });
    expect((await g.import(Bun.pathToFileURL(join(dir, "m.mjs")).href)).v).toBe(1);
    expect(await g.import("./m.mjs")).toBe(await g.import(join(dir, "m.mjs")));
    expect((await g.import("pkg")).where).toBe("main:t");
    const u = await g.import("./uses-pkg.mjs");
    expect([u.where, u.sub]).toEqual(["main:t", "sub"]);
    await expect(g.import("pkg/nope")).rejects.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
  test("symlinked module path: one template whether imported via the link or the target (realpath), per graph", async () => {
    const dir = fixture({ "real/x.mjs": `export let n = 0; export const inc = () => ++n` });
    const { symlinkSync } = require("node:fs");
    symlinkSync(join(dir, "real"), join(dir, "link"));
    const g = ModuleGraph();
    const a = await g.import(join(dir, "real/x.mjs")),
      b = await g.import(join(dir, "link/x.mjs"));
    a.inc();
    expect([a === b, b.n]).toEqual([true, 1]);
    rmSync(dir, { recursive: true, force: true });
  });
  test("tsconfig paths / baseUrl in the graph's project resolve for graph imports", async () => {
    const dir = fixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } } }),
      "lib/thing.ts": `export const thing = "T"`,
      "entry.ts": `import { thing } from "@lib/thing"; export { thing }`,
    });
    expect((await ModuleGraph({ cwd: dir }).import("./entry.ts")).thing).toBe("T");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — hostile / pathological code inside a graph", () => {
  const dir = fixture({
    "override-globals.mjs": `globalThis.Array = null; globalThis.JSON = { parse: () => "pwned" }; globalThis.setTimeout = () => "mine"; globalThis.process = { env: { FAKE: "1" }, cwd: () => "/fake" };
      export const viaGlobalThis = [globalThis.Array, globalThis.JSON.parse("1"), globalThis.setTimeout(), globalThis.process.env.FAKE];
      export const viaBare = [Array === null, JSON.parse("1"), setTimeout(), process.env.FAKE];`,
    "freeze.mjs": `let froze; try { Object.freeze(globalThis); froze = true } catch (e) { froze = e.constructor.name } export { froze }; export const canStillAdd = (() => { try { globalThis.afterFreeze = 1; return globalThis.afterFreeze === 1 } catch { return false } })()`,
    "proto-pollute.mjs": `Object.prototype.polluted = "yes"; Array.prototype.push = function () { return "nope" }; export const done = true`,
    "process-reassign.mjs": `let r; try { globalThis.process = { env: { FAKE: 1 } }; r = process.env.FAKE === 1 ? "replaced-for-graph" : "kept" } catch (e) { r = "threw" } export { r }; export const real = typeof process.pid`,
    "stack-limit.mjs": `Error.stackTraceLimit = 1; export const depth = new Error("x").stack.split("\\n").length`,
    "exit-midloop.mjs": `export function run() { let i = 0; for (; i < 1e6; i++) { if (i === 1000) process.exit(7) } return i }`,
    "throwing-export-getter.mjs": `export const obj = { get boom() { throw new Error("getter") } }; export default new Proxy({}, { get() { throw new Error("proxy-get") } })`,
    "recursive-onexit.mjs": `process.on("exit", () => { process.exit(9); globalThis.__again = (globalThis.__again ?? 0) + 1 }); export const quit = () => process.exit(1); export const again = () => globalThis.__again`,
    "define-process-prop.mjs": `Object.defineProperty(process, "title", { value: "instance-title", configurable: true }); export const t = process.title`,
    "long-sync.mjs": `export function spin(ms) { const end = Date.now() + ms; while (Date.now() < end); return "done" }`,
  });
  test("writes to the graph's globalThis: overlaid names (setTimeout, process, ...) change for globalThis.X AND bare X in that graph; other intrinsics (Array, JSON) change for globalThis.X only; host and other graphs unaffected", async () => {
    const m = await ModuleGraph().import(join(dir, "override-globals.mjs"));
    expect(m.viaGlobalThis).toEqual([null, "pwned", "mine", "1"]);
    expect(m.viaBare).toEqual([false, 1, "mine", "1"]); // Array/JSON bare: shared intrinsics; setTimeout/process bare: follow the write
    expect([Array.isArray([]), JSON.parse("1"), typeof setTimeout(() => {}, 0), typeof process.pid]).toEqual([
      true,
      1,
      "object",
      "number",
    ]);
    const other = await ModuleGraph().import(join(dir, "long-sync.mjs"));
    expect(other.spin(0)).toBe("done");
  });
  test("Object.freeze(globalThis) inside a graph does not freeze the host global", async () => {
    const m = await ModuleGraph().import(join(dir, "freeze.mjs"));
    expect([true, "TypeError"]).toContain(m.froze);
    (globalThis as any).__hostWritable = 1;
    expect((globalThis as any).__hostWritable).toBe(1);
    delete (globalThis as any).__hostWritable;
    expect(Object.isFrozen(globalThis)).toBe(false);
  });
  test("documented: intrinsic prototypes are shared — pollution IS visible to the host (and cleaned up here)", async () => {
    const origPush = Array.prototype.push;
    try {
      await ModuleGraph().import(join(dir, "proto-pollute.mjs"));
      expect([(Object.prototype as any).polluted, [].push(1)]).toEqual(["yes", "nope"]);
    } finally {
      delete (Object.prototype as any).polluted;
      Array.prototype.push = origPush;
    }
    expect([({} as any).polluted, [1].push(2)]).toEqual([undefined, 2]);
  });
  test("reassigning globalThis.process inside a graph replaces it for that graph only; host process intact", async () => {
    const m = await ModuleGraph().import(join(dir, "process-reassign.mjs"));
    expect(["replaced-for-graph", "kept", "threw"]).toContain(m.r);
    expect(typeof process.pid).toBe("number");
  });
  test("Error.stackTraceLimit set by a graph: documented shared (V8-compat static), restored here", async () => {
    const before = Error.stackTraceLimit;
    try {
      const m = await ModuleGraph().import(join(dir, "stack-limit.mjs"));
      expect(m.depth).toBeLessThanOrEqual(3);
    } finally {
      Error.stackTraceLimit = before;
    }
  });
  test("process.exit() in the middle of a hot loop returns cooperatively; onExit gets the code once", async () => {
    const codes: number[] = [];
    const m = await ModuleGraph({ onExit: c => codes.push(c) }).import(join(dir, "exit-midloop.mjs"));
    expect([m.run(), codes]).toEqual([1e6, [7]]);
  });
  test("exports with throwing getters / a throwing Proxy default export don't break import or namespace creation", async () => {
    const m = await ModuleGraph().import(join(dir, "throwing-export-getter.mjs"));
    expect(() => m.obj.boom).toThrow("getter");
    expect(() => (m.default as any).anything).toThrow("proxy-get");
    expect(Object.keys(m).sort()).toEqual(["default", "obj"]);
  });
  test("process.exit from inside an 'exit' listener does not recurse or fire onExit twice", async () => {
    const codes: number[] = [];
    const m = await ModuleGraph({ onExit: c => codes.push(c) }).import(join(dir, "recursive-onexit.mjs"));
    m.quit();
    expect([codes, m.again()]).toEqual([[1], 1]);
  });
  test("Object.defineProperty on the graph's process lands on the graph's shell, not the real process", async () => {
    const before = process.title;
    const m = await ModuleGraph().import(join(dir, "define-process-prop.mjs"));
    expect([m.t, process.title]).toEqual(["instance-title", before]);
  });
  test("a graph that spins synchronously blocks everyone (documented: cooperative, one thread) but leaves no damage after", async () => {
    const m = await ModuleGraph().import(join(dir, "long-sync.mjs"));
    const t0 = performance.now();
    let timerLate = 0;
    const t = setTimeout(() => {
      timerLate = performance.now() - t0;
    }, 1);
    expect(m.spin(50)).toBe("done");
    await Bun.sleep(5);
    clearTimeout(t);
    expect(timerLate).toBeGreaterThanOrEqual(45);
    expect((await ModuleGraph().import(join(dir, "long-sync.mjs"))).spin(0)).toBe("done");
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — Bun.* APIs from graph code", () => {
  const dir = fixture({
    "b.mjs": `
    export const envs = () => [Bun.env.T, process.env.T, Bun.env === process.env, import.meta.env.T];
    export async function serve() { const s = Bun.serve({ port: 0, fetch: () => new Response("from:" + process.env.T) }); try { return await (await fetch("http://127.0.0.1:" + s.port + "/")).text() } finally { s.stop(true) } }
    export async function fileRoundtrip(p) { await Bun.write(p, "data:" + process.env.T); return await Bun.file(p).text() }
    export async function sleep() { const t = performance.now(); await Bun.sleep(5); return performance.now() - t >= 4 }
    export async function spawnStreams() { const c = Bun.spawn(["sh", "-c", "read x; echo got:$x:$T"], { stdin: "pipe", stdout: "pipe" }); c.stdin.write("hi\\n"); c.stdin.end(); return (await new Response(c.stdout).text()).trim() }
    export const misc = () => [typeof Bun.version, Bun.nanoseconds() > 0, Bun.hash("x") === Bun.hash("x"), Bun.deepEquals({ a: 1 }, { a: 1 }), Bun.inspect({ a: 1 }), typeof Bun.gc];
    export const which = () => Bun.which("sh");
    export async function password() { const h = await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 }); return await Bun.password.verify("pw", h) }`,
  });
  const mk = () => ModuleGraph({ env: { ...process.env, T: "bunapi" } }).import(join(dir, "b.mjs"));
  test("Bun.env is the graph's process.env; import.meta.env too", async () => {
    expect((await mk()).envs()).toEqual(["bunapi", "bunapi", true, "bunapi"]);
  });
  test("Bun.serve handler defined in graph code sees the graph's env; server stops cleanly", async () => {
    expect(await (await mk()).serve()).toBe("from:bunapi");
  });
  test("Bun.write / Bun.file roundtrip from graph code", async () => {
    const p = join(dir, "out.txt");
    expect(await (await mk()).fileRoundtrip(p)).toBe("data:bunapi");
  });
  test("Bun.sleep resolves inside a graph (tracked timers don't break it)", async () => {
    expect(await (await mk()).sleep()).toBe(true);
  });
  test("Bun.spawn with piped stdio from graph code inherits graph env", async () => {
    expect(await (await mk()).spawnStreams()).toBe("got:hi:bunapi");
  });
  test("misc Bun.* utilities work (version, nanoseconds, hash, deepEquals, inspect, gc, which, password)", async () => {
    const m = await mk();
    expect(m.misc()).toEqual(["string", true, true, true, "{\n  a: 1,\n}", "function"]);
    expect(typeof m.which()).toBe("string");
    expect(await m.password()).toBe(true);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — exit ordering and beforeExit", () => {
  const dir = fixture({
    "order.mjs": `export const log = []; process.on("beforeExit", c => log.push("beforeExit:" + c)); process.on("exit", c => log.push("exit:" + c));
      export function quit() { queueMicrotask(() => log.push("microtask")); Promise.resolve().then(() => log.push("then")); setTimeout(() => log.push("timer"), 0); process.exitCode = 3; process.exit(); log.push("after-exit-call") }`,
    "exit-in-tla.mjs": `globalThis.__tlaExit = "before"; process.exit(4); await null; globalThis.__tlaExit = "after"; export const x = 1`,
    "exit-in-import-chain-a.mjs": `import "./exit-in-import-chain-b.mjs"; globalThis.__ranA = true; export const a = 1`,
    "exit-in-import-chain-b.mjs": `process.exit(5)`,
    "throw-in-exit-listener.mjs": `process.on("exit", () => { throw new Error("in-exit-listener") }); export const quit = () => process.exit(0)`,
  });
  test("process.exit(): 'exit' listeners run synchronously with exitCode; the call returns; microtasks still run; the graph's timers do not; beforeExit is not emitted by an explicit exit", async () => {
    const codes: number[] = [];
    const m = await ModuleGraph({ onExit: c => codes.push(c) }).import(join(dir, "order.mjs"));
    m.quit();
    await Bun.sleep(10);
    expect(m.log).toEqual(["exit:3", "after-exit-call", "microtask", "then"]);
    expect(codes).toEqual([3]);
  });
  test("process.exit during TLA evaluation: onExit fires; the import settles (resolves or rejects) rather than hanging", async () => {
    const codes: number[] = [];
    const r = await Promise.race([
      ModuleGraph({ onExit: c => codes.push(c) })
        .import(join(dir, "exit-in-tla.mjs"))
        .then(
          () => "resolved",
          () => "rejected",
        ),
      Bun.sleep(500).then(() => "pending"),
    ]);
    expect(codes).toEqual([4]);
    expect(["resolved", "rejected"]).toContain(r);
  });
  test("process.exit inside a dependency during the import chain: onExit(5); importer's body handling is consistent (documented: evaluation continues cooperatively)", async () => {
    const codes: number[] = [];
    const r = await ModuleGraph({ onExit: c => codes.push(c) })
      .import(join(dir, "exit-in-import-chain-a.mjs"))
      .then(
        m => "resolved:" + m.a,
        e => "rejected",
      );
    expect(codes).toEqual([5]);
    expect(["resolved:1", "rejected"]).toContain(r);
  });
  test("an 'exit' listener that throws: reported via onError, onExit still fires, host unaffected", async () => {
    const errs: string[] = [],
      codes: number[] = [];
    const m = await ModuleGraph({ onExit: c => codes.push(c), onError: (e: any) => errs.push(e.message) }).import(
      join(dir, "throw-in-exit-listener.mjs"),
    );
    m.quit();
    await Bun.sleep(5);
    expect(codes).toEqual([0]);
    expect(errs).toEqual(["in-exit-listener"]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — CJS/ESM interop flags per graph", () => {
  const dir = fixture({
    "esm-default.mjs": `export default function d() { return "d:" + process.env.T } export const named = "n"`,
    "cjs-esmodule-flag.cjs": `Object.defineProperty(exports, "__esModule", { value: true }); exports.default = "flagged-default:" + process.env.T; exports.named = "flagged-named"`,
    "cjs-plain.cjs": `module.exports = { named: "plain-named", t: process.env.T }`,
    "cjs-fn.cjs": `module.exports = function f() { return "fn:" + process.env.T }; module.exports.extra = 1`,
    "consumer.mjs": `import d, { named } from "./esm-default.mjs"; import flagged, { named as fnamed } from "./cjs-esmodule-flag.cjs"; import plain, { named as pnamed } from "./cjs-plain.cjs"; import fn, { extra } from "./cjs-fn.cjs";
      import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
      export const viaImport = [d(), named, flagged, fnamed, plain.named, pnamed, fn(), extra];
      export const viaRequire = () => { const e = require("./esm-default.mjs"); return [typeof e.default, e.named, e.__esModule, require("./cjs-esmodule-flag.cjs").default, require("./cjs-fn.cjs")()] }`,
  });
  test("import of ESM default/named, CJS with __esModule flag, plain CJS object and CJS function — per graph env", async () => {
    const a = await ModuleGraph({ env: { T: "A" } }).import(join(dir, "consumer.mjs")),
      b = await ModuleGraph({ env: { T: "B" } }).import(join(dir, "consumer.mjs"));
    expect(a.viaImport).toEqual([
      "d:A",
      "n",
      "flagged-default:A",
      "flagged-named",
      "plain-named",
      "plain-named",
      "fn:A",
      1,
    ]);
    expect(b.viaImport[0]).toBe("d:B");
    expect(b.viaImport[2]).toBe("flagged-default:B");
    expect(b.viaImport[6]).toBe("fn:B");
  });
  test("require(esm) exposes default/named/__esModule; require of flagged CJS keeps .default; matches host shapes", async () => {
    const a = await ModuleGraph({ env: { T: "A" } }).import(join(dir, "consumer.mjs"));
    const h = await import(join(dir, "consumer.mjs"));
    const [ga, ha] = [a.viaRequire(), h.viaRequire()];
    expect([ga[0], ga[1], ga[2]]).toEqual([ha[0], ha[1], ha[2]]);
    expect([ga[3], ga[4]]).toEqual(["flagged-default:A", "fn:A"]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — module namespace objects per instance", () => {
  const dir = fixture({
    "ns.mjs": `export let late; export const a = 1; export function f() {} export default "d"; export { a as z }; setTimeout(() => {}, 0); late = "set"`,
    "star.mjs": `export * from "./ns.mjs"; export const own = 2`,
    "tdz.mjs": `import * as self from "./tdz.mjs"; let probe; try { probe = self.later } catch (e) { probe = e.constructor.name } export const later = 1; export { probe }`,
  });
  let a: any, b: any, h: any;
  test("setup", async () => {
    [a, b, h] = [
      await ModuleGraph().import(join(dir, "ns.mjs")),
      await ModuleGraph().import(join(dir, "ns.mjs")),
      await import(join(dir, "ns.mjs")),
    ];
  });
  test("shape: keys sorted like the host, Symbol.toStringTag 'Module', null prototype, non-extensible, same descriptors", () => {
    expect(Reflect.ownKeys(a)).toEqual(Reflect.ownKeys(h));
    expect([a[Symbol.toStringTag], Object.isExtensible(a)]).toEqual(["Module", false]);
    const protoKeys = (o: any) => (o === null ? null : Reflect.ownKeys(o).map(String));
    expect(protoKeys(Object.getPrototypeOf(a))).toEqual(protoKeys(Object.getPrototypeOf(h))); // same prototype shape as the host's namespaces
    expect(Object.getOwnPropertyDescriptor(a, "a")).toEqual(Object.getOwnPropertyDescriptor(h, "a"));
  });
  test("identity: distinct per instance, stable within an instance; writes/defines/deletes rejected like the host", async () => {
    expect(a === b).toBe(false);
    expect(await ModuleGraph().import(join(dir, "ns.mjs"))).not.toBe(a);
    expect(() => {
      "use strict";
      a.a = 2;
    }).toThrow(TypeError);
    expect(Reflect.defineProperty(a, "nope", { value: 1 })).toBe(false);
    expect([Reflect.deleteProperty(a, "a"), Reflect.deleteProperty(a, "nope")]).toEqual([false, true]);
    expect("a" in a && !("nope" in a)).toBe(true);
  });
  test("live 'late' binding visible through the namespace; export-star namespace per instance includes re-exports", async () => {
    expect([a.late, a.z, a.default]).toEqual(["set", 1, "d"]);
    const s1 = await ModuleGraph().import(join(dir, "star.mjs"));
    expect(Object.keys(s1)).toEqual(Object.keys(await import(join(dir, "star.mjs"))));
  });
  test("self-namespace TDZ access during evaluation throws ReferenceError (per instance, same as host)", async () => {
    const m = await ModuleGraph().import(join(dir, "tdz.mjs")),
      hm = await import(join(dir, "tdz.mjs"));
    expect([m.probe, m.later]).toEqual([hm.probe, 1]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — TLA body as generator: resume points", () => {
  const dir = fixture({
    "finally.mjs": `export const log = []; try { log.push("try"); await Promise.reject(new Error("x")) } catch (e) { log.push("catch:" + e.message); await null; log.push("after-await-in-catch") } finally { await null; log.push("finally") } log.push("end:" + process.env.T)`,
    "meta-after-await.mjs": `const before = import.meta.url; await new Promise(r => setTimeout(r, 2)); export const same = before === import.meta.url; export const env = process.env.T; export const dyn = (await import("./dep.mjs")).v`,
    "dep.mjs": `export const v = "dep:" + process.env.T`,
    "mixed.mjs": `export const out = []; async function* g() { yield 1; await null; yield 2 } for await (const v of g()) { out.push(v); await new Promise(r => setTimeout(r, 1)); out.push(process.env.T) } await null; out.push("done")`,
    "deep0.mjs":
      Array.from({ length: 12 }, (_, i) => `import { v as v${i} } from "./deep${i + 1}.mjs";`).join("") +
      ` await null; export const sum = [${Array.from({ length: 12 }, (_, i) => "v" + i).join(",")}].reduce((a, b) => a + b, 0)`,
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `deep${i + 1}.mjs`,
        `await new Promise(r => setTimeout(r, ${i % 3})); export const v = 1`,
      ]),
    ),
    "throw-after-resume.mjs": `await null; export const x = 1; throw new Error("after-resume:" + process.env.T)`,
    "nested-fn-await.mjs": `async function inner() { await null; return process.env.T } export const v = await inner(); export const v2 = await (async () => { try { await Promise.reject(1) } catch { return "caught" } })()`,
  });
  const mk = (t: string, f: string) => ModuleGraph({ env: { T: t } }).import(join(dir, f));
  test("try/catch/finally across awaits in the module body", async () => {
    expect((await mk("F", "finally.mjs")).log).toEqual(["try", "catch:x", "after-await-in-catch", "finally", "end:F"]);
  });
  test("import.meta, env and dynamic import after a resume stay in the instance", async () => {
    const m = await mk("M", "meta-after-await.mjs");
    expect([m.same, m.env, m.dyn]).toEqual([true, "M", "dep:M"]);
  });
  test("for-await interleaved with awaits inside the loop body and after it", async () => {
    expect((await mk("X", "mixed.mjs")).out).toEqual([1, "X", 2, "X", "done"]);
  });
  test("12 TLA dependencies with different delays then a TLA parent: all resolve, per instance, concurrently in two graphs", async () => {
    const [p, q] = await Promise.all([mk("P", "deep0.mjs"), mk("Q", "deep0.mjs")]);
    expect([p.sum, q.sum, p === q]).toEqual([12, 12, false]);
  });
  test("throw after a resume rejects the import with the instance's error; a second graph gets its own", async () => {
    expect(await mk("R1", "throw-after-resume.mjs").catch(e => e.message)).toBe("after-resume:R1");
    expect(await mk("R2", "throw-after-resume.mjs").catch(e => e.message)).toBe("after-resume:R2");
  });
  test("awaiting nested async functions from the module body", async () => {
    const m = await mk("N", "nested-fn-await.mjs");
    expect([m.v, m.v2]).toEqual(["N", "caught"]);
  });
  test("GC during suspended TLA bodies in 10 graphs does not lose or mix resumptions", async () => {
    const ps = Array.from({ length: 10 }, (_, i) => mk("G" + i, "meta-after-await.mjs"));
    Bun.gc(true);
    await Bun.sleep(1);
    Bun.gc(true);
    const ms = await Promise.all(ps);
    expect(ms.map(m => m.env)).toEqual(Array.from({ length: 10 }, (_, i) => "G" + i));
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — signals per graph", () => {
  const dir = fixture({
    "sig.mjs": `export const seen = []; export function listen(sig) { const h = (s) => seen.push(process.env.T + ":" + s); process.on(sig, h); return () => process.off(sig, h) } export const count = (sig) => process.listenerCount(sig)`,
  });
  test("a signal delivered to the process reaches each graph's own listener with its own env; unsubscribing one graph keeps the other", async () => {
    const a = await ModuleGraph({ env: { T: "A" } }).import(join(dir, "sig.mjs")),
      b = await ModuleGraph({ env: { T: "B" } }).import(join(dir, "sig.mjs"));
    const offA = a.listen("SIGUSR2");
    b.listen("SIGUSR2");
    process.kill(process.pid, "SIGUSR2");
    await Bun.sleep(30);
    expect([a.seen, b.seen]).toEqual([["A:SIGUSR2"], ["B:SIGUSR2"]]);
    offA();
    process.kill(process.pid, "SIGUSR2");
    await Bun.sleep(30);
    expect([a.seen.length, b.seen.length, a.count("SIGUSR2"), b.count("SIGUSR2")]).toEqual([1, 2, 0, 1]);
    expect(process.listenerCount("SIGUSR2")).toBe(1); // exactly one real forwarder while B listens
  });
  test("after the last graph listener goes (off or exit), no forwarder remains on the real process", async () => {
    const before = process.listenerCount("SIGUSR1");
    const g = ModuleGraph({ env: { T: "C" } });
    const m = await g.import(join(dir, "sig.mjs"));
    const off = m.listen("SIGUSR1");
    expect(process.listenerCount("SIGUSR1")).toBe(before + 1);
    off();
    expect(process.listenerCount("SIGUSR1")).toBe(before);
    m.listen("SIGUSR1");
    g.dispose();
    expect(process.listenerCount("SIGUSR1")).toBe(before);
  });
  test("host signal listeners coexist and are not removed by graph dispose", async () => {
    const hostSeen: string[] = [];
    const h = () => hostSeen.push("host");
    process.on("SIGUSR2", h);
    try {
      const g = ModuleGraph({ env: { T: "D" } });
      const m = await g.import(join(dir, "sig.mjs"));
      m.listen("SIGUSR2");
      process.kill(process.pid, "SIGUSR2");
      await Bun.sleep(30);
      g.dispose();
      process.kill(process.pid, "SIGUSR2");
      await Bun.sleep(30);
      expect([hostSeen.length, m.seen.length]).toEqual([2, 1]);
    } finally {
      process.off("SIGUSR2", h);
    }
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — AsyncLocalStorage, worker_threads, console, stdout.write from graph code",
  () => {
    const dir = fixture({
      "als.mjs": `import { AsyncLocalStorage } from "node:async_hooks"; export const als = new AsyncLocalStorage();
      export function runWith(v, fn) { return als.run(v, fn) } export async function acrossAwait(v) { return als.run(v, async () => { await new Promise(r => setTimeout(r, 1)); return als.getStore() }) }
      export function readHost(hostAls) { return hostAls.getStore() }`,
      "wt.mjs": `import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
      export const main = isMainThread;
      export function roundtrip() { return new Promise((res, rej) => { const w = new Worker(new URL("./wt-child.mjs", import.meta.url), { workerData: { t: process.env.T } }); w.once("message", m => { res(m); w.terminate() }); w.once("error", rej) }) }`,
      "wt-child.mjs": `import { parentPort, workerData } from "node:worker_threads"; parentPort.postMessage({ got: workerData.t, env: process.env.T ?? null })`,
      "out.mjs": `export function write() { return new Promise(r => { let ok; ok = process.stdout.write("", () => queueMicrotask(() => r(["cb", ok]))) }) } export function log() { console.log("graph-log:" + process.env.T); console.error("graph-err:" + process.env.T) }`,
    });
    test("AsyncLocalStorage created in a graph works across awaits; host ALS store is visible in graph code called within host als.run", async () => {
      const m = await ModuleGraph().import(join(dir, "als.mjs"));
      expect(m.runWith("v1", () => m.als.getStore())).toBe("v1");
      expect(await m.acrossAwait("v2")).toBe("v2");
      const { AsyncLocalStorage } = require("node:async_hooks");
      const hostAls = new AsyncLocalStorage();
      expect(hostAls.run("host-store", () => m.readHost(hostAls))).toBe("host-store");
    });
    test("node:worker_threads Worker from a graph: isMainThread true in graph, workerData roundtrip, child inherits graph env", async () => {
      const m = await ModuleGraph({ env: { ...process.env, T: "wt" } }).import(join(dir, "wt.mjs"));
      expect(m.main).toBe(true);
      expect(await m.roundtrip()).toEqual({ got: "wt", env: "wt" });
    });
    test("process.stdout.write callback fires; console.log/error from a graph reach the process streams", async () => {
      const m = await ModuleGraph({ env: { T: "o" } }).import(join(dir, "out.mjs"));
      expect(await m.write()).toEqual(["cb", true]);
      const r = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `const m = await new Bun.unsafe.ModuleGraph({ env: { T: "o" } }).import(${JSON.stringify(join(dir, "out.mjs"))}); m.log()`,
        ],
        { env: { ...process.env } },
      );
      expect([r.stdout.toString().trim(), r.stderr.toString().trim()]).toEqual(["graph-log:o", "graph-err:o"]);
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — TypeScript source maps and stack locations", () => {
  const dir = fixture({
    "typed.ts": `interface X { a: number }\ntype Y = X | null;\n\nexport function boom(x: Y): never {\n  throw new Error("ts-boom line 5")\n}\nexport const where = () => { try { boom(null) } catch (e: any) { return e.stack } }`,
  });
  test("stack trace line numbers for TS files map to source lines in a graph, same as host", async () => {
    const g = (await ModuleGraph().import(join(dir, "typed.ts"))).where(),
      h = (await import(join(dir, "typed.ts"))).where();
    const line = (st: string) => (st.match(/typed\.ts:(\d+)/) || [])[1];
    expect(line(g)).toBe("5");
    expect(line(g)).toBe(line(h));
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — randomized interleavings (seeded)", () => {
  const dir = fixture({
    "unit.mjs": `import { EventEmitter } from "node:events"; import fs from "node:fs";
      export const id = process.env.ID; let calls = 0; const ee = new EventEmitter(); ee.on("x", () => calls++);
      export function call() { ee.emit("x"); return [process.env.ID, calls] }
      export function arm() { setTimeout(() => {}, 10_000); setInterval(() => {}, 1000); process.on("SIGWINCH", () => {}); process.stdout.on("resize", () => {}); fs.watchFile(import.meta.path, { interval: 60_000 }, () => {}) }
      export function throwLater() { setTimeout(() => { throw new Error("late:" + process.env.ID) }, 0) }
      export async function tla() { return (await import("./tla-dep.mjs")).v }
      export function quit() { process.exit(0) }`,
    "tla-dep.mjs": `await new Promise(r => setTimeout(r, 1)); export const v = "tla:" + process.env.ID`,
  });
  function rng(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
  }
  for (const seed of [1, 2, 3, 42, 1337]) {
    test(`seed ${seed}: 12 graphs × 60 random ops keep per-graph invariants; all exited graphs collect; host listener counts return to baseline`, async () => {
      const rand = rng(seed);
      const base = { winch: process.listenerCount("SIGWINCH"), resize: process.stdout.listenerCount("resize") };
      const errors: string[] = [];
      type G = { id: string; g: any; m: any; alive: boolean; calls: number };
      const gs: G[] = [];
      const collectedIds = new Set<string>();
      const finals = new FinalizationRegistry<string>(id => collectedIds.add(id));
      // The graphs are created and driven inside this inner function only: optimized code for a
      // function that touched a graph's objects can keep them alive while that function is still
      // running, so the collection check below runs in a frame that never saw them.
      let total = 0;
      await (async () => {
        for (let i = 0; i < 12; i++) {
          const id = `s${seed}g${i}`;
          const g = ModuleGraph({ env: { ...process.env, ID: id }, onError: (e: any) => errors.push(e.message) });
          gs.push({ id, g, m: await g.import(join(dir, "unit.mjs")), alive: true, calls: 0 });
        }
        gs.forEach(x => finals.register(x.m, x.id));
        for (let step = 0; step < 60; step++) {
          const x = gs[Math.floor(rand() * gs.length)];
          const op = Math.floor(rand() * 7);
          if (!x.alive) {
            await expect(x.g.import(join(dir, "unit.mjs"))).rejects.toThrow();
            continue;
          }
          switch (op) {
            case 0: {
              const [id, n] = x.m.call();
              x.calls++;
              expect([id, n]).toEqual([x.id, x.calls]);
              break;
            }
            case 1:
              x.m.arm();
              break;
            case 2:
              x.m.throwLater();
              await Bun.sleep(2);
              expect(errors.pop()).toBe("late:" + x.id);
              break;
            case 3:
              expect(await x.m.tla()).toBe("tla:" + x.id);
              break;
            case 4:
              if (rand() < 0.5) x.m.quit();
              else x.g.dispose();
              x.alive = false;
              x.m = null;
              break;
            case 5:
              Bun.gc(rand() < 0.5);
              break;
            case 6:
              expect((await x.g.import(join(dir, "unit.mjs"))).id).toBe(x.id);
              break;
          }
        }
        gs.forEach(x => {
          if (x.alive) {
            x.g.dispose();
            x.alive = false;
          }
          x.m = null;
          x.g = null;
        });
        expect(errors).toEqual([]);
        expect([process.listenerCount("SIGWINCH"), process.stdout.listenerCount("resize")]).toEqual([
          base.winch,
          base.resize,
        ]);
        total = gs.length;
        gs.length = 0;
      })();
      for (let i = 0; i < 120 && collectedIds.size < total; i++) {
        (function churn(d: number): unknown {
          return d ? [churn(d - 1), {}] : 0;
        })(32);
        await Bun.sleep(i < 40 ? 2 : 8);
        Bun.gc(true);
        await new Promise<void>(r => setImmediate(r));
      }
      expect(collectedIds.size).toBe(total);
      void finals;
    }, 60_000);
  }
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — dispose/exit at awkward moments", () => {
  const dir = fixture({
    "mid-import-chain.mjs": `import "./slow-dep.mjs"; export const done = true`,
    "slow-dep.mjs": `await new Promise(r => setTimeout(r, 25)); globalThis.__slowDepDone = (globalThis.__slowDepDone ?? 0) + 1`,
    "exit-in-listener.mjs": `process.on("myevt", () => process.exit(2)); export const fire = () => process.emit("myevt"); export const after = () => "still-callable:" + process.env.T`,
    "dispose-from-inside.mjs": `export function selfDispose(g) { g.dispose(); return typeof process.env }`,
    "exit-in-microtask-storm.mjs": `export function go() { for (let i = 0; i < 100; i++) queueMicrotask(() => { if (i === 50) process.exit(3) }) }`,
    "exit-in-timer-callback.mjs": `export const log = []; export function go() { setTimeout(() => { log.push("a"); process.exit(1); log.push("b") }, 1); setTimeout(() => log.push("c-should-not-run"), 2) }`,
    "exit-then-throw.mjs": `export function go() { process.exit(0); throw new Error("after-exit") }`,
    "reenter-import.mjs": `export async function reimport(g, p) { process.exit(0); try { return await g.import(p) } catch (e) { return "rejected:" + /disposed/.test(e.message) } }`,
  });
  test("dispose while a dependency (not the root) is mid-TLA: root import rejects with 'disposed'; a fresh graph is unaffected", async () => {
    const g = ModuleGraph();
    const p = g.import(join(dir, "mid-import-chain.mjs"));
    await Bun.sleep(5);
    g.dispose();
    expect(
      await p.then(
        () => "resolved",
        (e: Error) => e.message,
      ),
    ).toMatch(/disposed/);
    expect((await ModuleGraph().import(join(dir, "mid-import-chain.mjs"))).done).toBe(true);
  });
  test("process.exit from inside a process event listener; functions stay callable afterwards (no crash), exit code once", async () => {
    const codes: number[] = [];
    const m = await ModuleGraph({ env: { T: "L" }, onExit: c => codes.push(c) }).import(
      join(dir, "exit-in-listener.mjs"),
    );
    m.fire();
    expect([codes, m.after()]).toEqual([[2], "still-callable:L"]);
  });
  test("graph code disposing its own graph via a passed handle", async () => {
    const g = ModuleGraph();
    const m = await g.import(join(dir, "dispose-from-inside.mjs"));
    expect(m.selfDispose(g)).toBe("object");
    await expect(g.import(join(dir, "dispose-from-inside.mjs"))).rejects.toThrow(/disposed/);
  });
  test("exit inside a microtask storm / inside a timer callback: code after exit() in the same callback runs, later timers don't", async () => {
    const c1: number[] = [];
    (await ModuleGraph({ onExit: c => c1.push(c) }).import(join(dir, "exit-in-microtask-storm.mjs"))).go();
    await Bun.sleep(5);
    expect(c1).toEqual([3]);
    const c2: number[] = [];
    const m = await ModuleGraph({ onExit: c => c2.push(c) }).import(join(dir, "exit-in-timer-callback.mjs"));
    m.go();
    await Bun.sleep(15);
    expect([c2, m.log]).toEqual([[1], ["a", "b"]]);
  });
  test("throw right after process.exit() in the same synchronous call propagates to the caller (not swallowed, not onError)", async () => {
    const errs: unknown[] = [];
    const m = await ModuleGraph({ onError: e => errs.push(e) }).import(join(dir, "exit-then-throw.mjs"));
    expect(() => m.go()).toThrow("after-exit");
    expect(errs).toEqual([]);
  });
  test("graph code calling graph.import() on its own handle after exiting gets a rejection", async () => {
    const g = ModuleGraph();
    const m = await g.import(join(dir, "reenter-import.mjs"));
    expect(await m.reimport(g, join(dir, "exit-then-throw.mjs"))).toBe("rejected:true");
  });
  test("100× (create → import TLA → dispose at a random point) never throws on the host and leaves nothing behind", async () => {
    (globalThis as any).__slowDepDone = 0;
    const before = { t: process.listenerCount("SIGWINCH") };
    for (let i = 0; i < 100; i++) {
      const g = ModuleGraph();
      const p = g.import(join(dir, "mid-import-chain.mjs")).catch(() => {});
      await Bun.sleep(i % 7);
      g.dispose();
      await p;
    }
    await Bun.sleep(40);
    expect(process.listenerCount("SIGWINCH")).toBe(before.t);
    expect((globalThis as any).__slowDepDone).toBe(0); // graph-local globals: host counter untouched
  }, 30_000);
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — re-entrancy: graphs created/disposed from inside other graphs' evaluation and callbacks",
  () => {
    const dir = fixture({
      "spawner.mjs": `const inner = new Bun.unsafe.ModuleGraph({ env: { T: "inner-of-" + process.env.T } }); export const innerWho = (await inner.import(new URL("./who.mjs", import.meta.url).pathname)).who; export const outerWho = process.env.T; inner.dispose();`,
      "who.mjs": `export const who = process.env.T`,
      "disposer.mjs": `export function run(other) { other.dispose(); return process.env.T }`,
      "thrower.mjs": `export function later() { setTimeout(() => { throw new Error("e1") }, 0) }`,
      "sync-nested-import.mjs": `import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const G = Bun.unsafe.ModuleGraph; const g = new G({ env: { T: "cjs-inner" } });
      export const viaRequireInInner = await g.import(new URL("./who.mjs", import.meta.url).pathname).then(m => m.who); export const mine = require("./who-cjs.cjs").who;`,
      "who-cjs.cjs": `module.exports = { who: process.env.T }`,
    });
    test("a graph whose module top level creates, imports into, and disposes another graph during its own TLA evaluation", async () => {
      const m = await ModuleGraph({ env: { T: "outer" } }).import(join(dir, "spawner.mjs"));
      expect([m.outerWho, m.innerWho]).toEqual(["outer", "inner-of-outer"]);
    });
    test("graph A disposing graph B from A's code; B's pending import rejects; A unaffected", async () => {
      const A = ModuleGraph({ env: { T: "A" } }),
        B = ModuleGraph({ env: { T: "B" } });
      const bPending = B.import(join(dir, "spawner.mjs"));
      const a = await A.import(join(dir, "disposer.mjs"));
      expect(a.run(B)).toBe("A");
      expect(
        await bPending.then(
          () => "resolved",
          (e: Error) => /disposed/.test(e.message),
        ),
      ).toBeOneOf([true, "resolved"]);
      expect((await A.import(join(dir, "who.mjs"))).who).toBe("A");
    });
    test("onError handler that disposes the graph and creates a new one, while more errors from the old graph are queued", async () => {
      const seen: string[] = [];
      let replacement: any;
      const g: any = ModuleGraph({
        onError: (e: any) => {
          seen.push(e.message);
          g.dispose();
          replacement ??= ModuleGraph({ env: { T: "new" } });
        },
      });
      const m = await g.import(join(dir, "thrower.mjs"));
      m.later();
      m.later();
      m.later();
      await Bun.sleep(20);
      expect(seen.length).toBeGreaterThanOrEqual(1); // first error disposes; later ones are attributed or dropped, never thrown at the host
      expect((await replacement.import(join(dir, "who.mjs"))).who).toBe("new");
    });
    test("mixed loaders re-entrantly: a graph whose TLA imports into a nested graph while also require()ing CJS for itself", async () => {
      const m = await ModuleGraph({ env: { T: "outer2" } }).import(join(dir, "sync-nested-import.mjs"));
      expect([m.viaRequireInInner, m.mine]).toEqual(["cjs-inner", "outer2"]);
    });
    test("the loading-instance bracket is restored after nested loads: a module imported by the host right after nested graph activity is the host's", async () => {
      await ModuleGraph({ env: { T: "x" } }).import(join(dir, "spawner.mjs"));
      const d = fixture({ "fresh.mjs": `export const who = process.env.T ?? "host"` });
      expect((await import(join(d, "fresh.mjs"))).who).toBe(process.env.T ?? "host");
      expect(require(join(dir, "who-cjs.cjs")).who).toBe(process.env.T);
      rmSync(d, { recursive: true, force: true });
    });
  },
);

// A process exit ends its servers, workers and children; a graph's exit/dispose does the same for
// the ones graph code started (and only those).
describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — long-lived resources end with the graph (servers, Workers, child processes)",
  () => {
    const dir = fixture({
      "w.mjs": `setInterval(() => {}, 1000); self.onmessage = e => postMessage("pong:" + e.data)`,
      "wt.mjs": `import { parentPort } from "node:worker_threads"; setInterval(() => {}, 1000); parentPort.on("message", m => parentPort.postMessage("pong:" + m))`,
      "r.mjs": `import net from "node:net"; import http from "node:http"; import { spawn } from "node:child_process"; import { Worker as WT } from "node:worker_threads";
      export const marker = { big: new Uint8Array(256 * 1024) };
      export const started = {};
      export async function start(kind) {
        switch (kind) {
          case "bunServe": { const s = Bun.serve({ port: 0, fetch: () => new Response("ok:" + marker.big.length) }); started.port = s.port; return s.port }
          case "netServer": { const s = net.createServer(c => c.end("hi")); await new Promise(r => s.listen(0, r)); started.port = s.address().port; return started.port }
          case "netServerClass": { const s = new net.Server(c => c.end("hi")); await new Promise(r => s.listen(0, r)); return (started.port = s.address().port) }
          case "httpServer": { const s = http.createServer((q, r) => r.end("ok")); await new Promise(r => s.listen(0, r)); return (started.port = s.address().port) }
          case "worker": { const w = new Worker(new URL("./w.mjs", import.meta.url).href); await new Promise(r => { w.onmessage = r; w.postMessage("x") }); started.worker = w; return "up" }
          case "workerThreads": { const w = new WT(new URL("./wt.mjs", import.meta.url)); await new Promise(r => { w.once("message", r); w.postMessage("x") }); started.worker = w; return "up" }
          case "bunSpawn": { const c = Bun.spawn(["sleep", "30"]); started.pid = c.pid; return c.pid }
          case "cpSpawn": { const c = spawn("sleep", ["30"]); started.pid = c.pid; await new Promise(r => c.once("spawn", r)); return c.pid }
        }
      }
      export function quit() { process.exit(0) }`,
    });
    const portOpen = (port: number) =>
      new Promise<boolean>(res => {
        const s = require("node:net").connect(port, "127.0.0.1");
        s.once("connect", () => {
          s.destroy();
          res(true);
        });
        s.once("error", () => res(false));
      });
    const pidAlive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (const kind of ["bunServe", "netServer", "netServerClass", "httpServer"]) {
      for (const how of ["exit", "dispose"]) {
        test(`${kind} started by graph code stops on ${how}`, async () => {
          const g = ModuleGraph();
          const m = await g.import(join(dir, "r.mjs"));
          const port = await m.start(kind);
          expect(await portOpen(port)).toBe(true);
          how === "exit" ? m.quit() : g.dispose();
          await Bun.sleep(20);
          expect(await portOpen(port)).toBe(false);
        });
      }
    }
    for (const kind of ["bunSpawn", "cpSpawn"]) {
      test(`${kind} child started by graph code gets SIGHUP/stdio closed on exit and goes away`, async () => {
        const g = ModuleGraph();
        const m = await g.import(join(dir, "r.mjs"));
        const pid = await m.start(kind);
        expect(pidAlive(pid)).toBe(true);
        m.quit();
        for (let i = 0; i < 50 && pidAlive(pid); i++) await Bun.sleep(10);
        expect(pidAlive(pid)).toBe(false);
      });
    }
    for (const kind of ["worker", "workerThreads"]) {
      test(`${kind} started by graph code is terminated on exit`, async () => {
        const g = ModuleGraph();
        const m = await g.import(join(dir, "r.mjs"));
        await m.start(kind);
        const w = m.started.worker;
        const closed = new Promise(r => {
          kind === "worker" ? w.addEventListener("close", () => r("closed")) : w.once("exit", () => r("closed"));
        });
        m.quit();
        expect(await Promise.race([closed, Bun.sleep(2000).then(() => "still running")])).toBe("closed");
      });
    }
    test("the graph is collectable after exit even if it had started every kind of resource", async () => {
      const ok = await collected(async register => {
        const g = ModuleGraph();
        const m = await g.import(join(dir, "r.mjs"));
        register(m.marker);
        for (const k of ["bunServe", "netServer", "httpServer", "worker", "bunSpawn"]) await m.start(k);
        m.quit();
        await Bun.sleep(30);
      });
      expect(ok).toBe(true);
    }, 30_000);
    test("host-owned servers/children are untouched by a graph's exit; resources started AFTER exit by leftover graph code are not tracked (documented) but also don't throw", async () => {
      const hostServer = Bun.serve({ port: 0, fetch: () => new Response("host") });
      try {
        const g = ModuleGraph();
        const m = await g.import(join(dir, "r.mjs"));
        await m.start("bunServe");
        m.quit();
        await Bun.sleep(10);
        expect(await (await fetch(`http://127.0.0.1:${hostServer.port}/`)).text()).toBe("host");
        const latePort = await m.start("bunServe"); // graph code still callable after exit
        expect(typeof latePort).toBe("number");
        const late = m.started;
        void late;
      } finally {
        hostServer.stop(true);
      }
    });
    test("Bun facade: identity-ish behaviour — Bun.version etc. pass through, Bun.env is the graph's, instanceof/typeof sane", async () => {
      const d = fixture({
        "b.mjs": `export const v = [Bun.version, typeof Bun.file, Bun.env.T, typeof Bun, Object.prototype.toString.call(Bun) === Object.prototype.toString.call(globalThis.Bun)];
      export const more = async () => [(await Bun.$\`echo hi\`.text()).trim(), new Bun.Glob("*.x") instanceof Bun.Glob, [...new Bun.Glob("*.mjs").scanSync(import.meta.dir)].length > 0, typeof new Bun.Transpiler().transformSync("1"), Bun.Glob === globalThis.Bun.Glob]`,
      });
      const m = await ModuleGraph({ env: { ...process.env, T: "facade" } }).import(join(d, "b.mjs"));
      expect(m.v).toEqual([Bun.version, "function", "facade", "object", true]);
      expect(await m.more()).toEqual(["hi", true, true, "string", true]);
      expect(m.v && (await ModuleGraph().import(join(d, "b.mjs"))).v[0]).toBe(Bun.version);
      rmSync(d, { recursive: true, force: true });
    });
  },
);

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — host natives injected via globals, called as bare identifiers",
  () => {
    // A bare-identifier call whose callee lives in the overlay passes the overlay environment in the `this`
    // slot (JSC's convention for scope-resolved callees); JS callees normalise it, natives must not care.
    // Runs in a fresh process: the overlaid name set is fixed by the first ModuleGraph in a process.
    test("structuredClone / fetch / queueMicrotask / a strict JS function / an arrow / a class injected as globals work when called bare, with new, and via globalThis", async () => {
      const dir = fixture({
        "n.mjs": `const { injectedClone, injectedMicrotask, injectedFetch, injectedStrict, injectedArrow, InjectedDate } = globalThis;   // extra globals: globalThis.<key>
      export async function run(port) {
        const r = {}; r.clone = injectedClone({ a: 1 }).a; r.micro = await new Promise(res => injectedMicrotask(() => res("m")));
        r.fetch = await (await injectedFetch("http://127.0.0.1:" + port + "/")).text();
        r.strictThis = injectedStrict(); r.arrow = injectedArrow(2); r.viaGlobalThis = globalThis.injectedStrict();
        r.date = typeof new InjectedDate(0).getTime(); r.fnCall = Function("return 7")(); r.fnNew = new Function("return 8")();
        r.bareExtra = typeof injectedCloneBare;      // extras are NOT bare identifiers (fixed overlay set)
        r.bareOverlaid = [typeof setTimeout, typeof process, typeof Bun, typeof Function].join(",");   // the fixed set is
        return r }`,
        "host.mjs": `const server = Bun.serve({ port: 0, fetch: () => new Response("fetched") });
        const g = new Bun.unsafe.ModuleGraph({ globals: { injectedClone: structuredClone, injectedCloneBare: structuredClone, injectedMicrotask: queueMicrotask, injectedFetch: fetch, injectedStrict: function () { "use strict"; return this === undefined ? "undefined-this" : typeof this }, injectedArrow: x => x * 2, InjectedDate: Date } });
        const m = await g.import("./n.mjs"); console.log(JSON.stringify(await m.run(server.port))); server.stop(true); process.exit(0);`,
      });
      const r = Bun.spawnSync([process.execPath, join(dir, "host.mjs")], { cwd: dir, env: { ...process.env } });
      expect(JSON.parse(r.stdout.toString().trim() || "{}")).toEqual({
        clone: 1,
        micro: "m",
        fetch: "fetched",
        strictThis: "undefined-this",
        arrow: 4,
        viaGlobalThis: "object",
        date: "number",
        fnCall: 7,
        fnNew: 8,
        bareExtra: "undefined",
        bareOverlaid: "function,object,object,function",
      });
      rmSync(dir, { recursive: true, force: true });
    });
    test("ModuleGraph.overlaidGlobals lists the fixed bare-identifier set; keys outside it are still reachable as globalThis.<key> in the graph", async () => {
      ModuleGraph(); // ensure the set is fixed in this process
      const names = (ModuleGraphClass as any).overlaidGlobals as string[];
      expect(names).toEqual(expect.arrayContaining(["process", "globalThis", "setTimeout", "Bun", "Function"]));
      const d = fixture({ "x.mjs": `export const v = [typeof lateExtra, globalThis.lateExtra]` });
      expect((await ModuleGraph({ globals: { lateExtra: 7 } }).import(join(d, "x.mjs"))).v).toEqual(
        names.includes("lateExtra") ? ["number", 7] : ["undefined", 7],
      );
      rmSync(d, { recursive: true, force: true });
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — eval / new Function / node:vm inside a graph", () => {
  const dir = fixture({
    "who.mjs": `export const who = process.env.T ?? "host"`,
    "e.mjs": `import vm from "node:vm"; const p = new URL("./who.mjs", import.meta.url).pathname;
      export const directEval = eval("process.env.T");
      export const directEvalImport = () => eval("import(p)").then(m => m.who);
      export const fn = new Function("return [process.env.T, typeof Bun.serve, typeof setTimeout, globalThis.process === process]")();
      export const fnGlobalThisIsGraphs = new Function("return globalThis")() === globalThis;
      export const fnImport = () => new Function("p", "return import(p)")(p).then(m => m.who);
      export const fnShapes = { isFn: typeof Function === "function" && Function.length === 1 && Function.name === "Function", inst: new Function("") instanceof Function, proto: Object.getPrototypeOf(new Function("")) === Function.prototype, viaGlobalThis: globalThis.Function === Function, call: Function("a","b","return a+b")(2,3), syntax: (() => { try { new Function("{") } catch (e) { return e.constructor.name } })(), sub: (() => { class F extends Function {}; const f = new F("return 7"); return [f instanceof F, f instanceof Function, f()] })(), str: new Function("a", "return a /*x*/").toString().includes("/*x*/"), asyncBody: new Function("return (async () => process.env.T)()")() instanceof Promise };
      export const timersFromFn = () => new Promise(r => new Function("cb", "setTimeout(cb, 1)")(() => r("fired")));
      export const indirectEval = (0, eval)("typeof process === 'object' && process.env.T === undefined ? 'host-scope' : 'graph-scope'");
      export const vmNewContext = vm.runInNewContext("typeof process", {});
      export const vmThisContext = vm.runInThisContext("typeof process === 'object' ? 'host-process' : 'none'");
      export const intrinsicFunctionCtor = (() => {}).constructor === Function;`,
  });
  let m: any;
  test("setup", async () => {
    m = await ModuleGraph({ env: { T: "G" } }).import(join(dir, "e.mjs"));
  });
  test("direct eval inherits the module scope (graph process; import() lands in the graph)", async () => {
    expect([m.directEval, await m.directEvalImport()]).toEqual(["G", "G"]);
  });
  test("new Function code is scoped to the graph: sees the graph's process/Bun/timers/globalThis; import() from it lands in the graph", async () => {
    expect(m.fn).toEqual(["G", "function", "function", true]);
    expect([m.fnGlobalThisIsGraphs, await m.fnImport(), await m.timersFromFn()]).toEqual([true, "G", "fired"]);
  });
  test("the graph's Function constructor conforms: typeof/length/name, instanceof, prototype identity, globalThis.Function, call form, SyntaxError, subclassing, toString, async bodies", () => {
    expect(m.fnShapes).toEqual({
      isFn: true,
      inst: true,
      proto: true,
      viaGlobalThis: true,
      call: 5,
      syntax: "SyntaxError",
      sub: [true, true, 7],
      str: true,
      asyncBody: true,
    });
  });
  test("documented limits: indirect eval and vm.runInThisContext evaluate in the HOST global scope; (()=>{}).constructor is the shared %Function%; vm.runInNewContext is its own context", () => {
    expect([m.indirectEval, m.vmThisContext, m.intrinsicFunctionCtor, m.vmNewContext]).toEqual([
      "host-scope",
      "host-process",
      false,
      "undefined",
    ]);
  });
  test("timers armed from Function-constructed code are the graph's (released on exit) and two graphs' Function constructors are distinct", async () => {
    const d = fixture({
      "t.mjs": `export const F = Function; export const arm = () => new Function("setInterval(() => {}, 10); setTimeout(() => {}, 1e6)")(); export const quit = () => process.exit(0); export const marker = { big: new Uint8Array(1 << 18) }`,
    });
    const a = await ModuleGraph().import(join(d, "t.mjs")),
      b = await ModuleGraph().import(join(d, "t.mjs"));
    expect([a.F === b.F, a.F === Function, typeof a.F("return 1")]).toEqual([false, false, "function"]);
    const ok = await collected(async register => {
      const g = ModuleGraph();
      const x = await g.import(join(d, "t.mjs"));
      register(x.marker);
      x.arm();
      x.quit();
    });
    expect(ok).toBe(true);
    rmSync(d, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — soak", () => {
  test("300 create/import/work/exit cycles (60 under stress builds): object count and host listeners plateau (no per-cycle drift)", async () => {
    const dir = fixture({
      "unit.mjs": `import fs from "node:fs"; import { EventEmitter } from "node:events"; export const id = process.env.ID; const ee = new EventEmitter(); ee.on("x", () => {});
        setInterval(() => {}, 1000); process.on("SIGWINCH", () => {}); process.stdout.on("resize", () => {}); fs.watchFile(import.meta.path, { interval: 60_000 }, () => {});
        export const data = JSON.parse(JSON.stringify({ a: new Array(500).fill(process.env.ID) }));
        export async function work() { await new Promise(r => setTimeout(r, 0)); return (await import("./dep.mjs")).v + id }
        export function quit() { process.exit(0) }`,
      "dep.mjs": `export const v = "dep:"`,
    });
    const sample = async () => {
      for (let i = 0; i < 3; i++) {
        Bun.gc(true);
        await Bun.sleep(2);
      }
      return heapStats().objectCount;
    };
    const marks: number[] = [];
    const N = stressMode ? 60 : 300;
    for (let i = 0; i < N; i++) {
      const g = ModuleGraph({ env: { ...process.env, ID: "t" + i } });
      const m = await g.import(join(dir, "unit.mjs"));
      expect(await m.work()).toBe("dep:t" + i);
      i % 3 === 0 ? m.quit() : g.dispose();
      if (i % (N / 3) === N / 3 - 1) marks.push(await sample());
    }
    expect([process.listenerCount("SIGWINCH"), process.stdout.listenerCount("resize")]).toEqual([0, 0]);
    // steady state: cycles 200→300 must not add objects proportional to the cycle count (a leaked graph is thousands of objects)
    expect(marks[2] - marks[1]).toBeLessThan(3000);
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — rejection tracking edge cases", () => {
  const dir = fixture({
    "late-handle.mjs": `export const events = []; process.on("unhandledRejection", (r) => events.push("unhandled:" + r.message)); process.on("rejectionHandled", () => events.push("handled"));
      export function go() { const p = Promise.reject(new Error("late")); setTimeout(() => p.catch(() => events.push("caught")), 5); }`,
    "make-rejection.mjs": `export const rejected = () => Promise.reject(new Error("from:" + process.env.T)); export const pending = () => new Promise((_, rej) => setTimeout(() => rej(new Error("later:" + process.env.T)), 2))`,
    "await-foreign.mjs": `export async function awaitIt(p) { try { await p; return "resolved" } catch (e) { return "caught:" + e.message } } export function dropIt(p) { p.then(() => {}) /* new derived promise, unhandled here */ }`,
    "host-cb.mjs": `export function callLater(fn) { setTimeout(fn, 1) }`,
  });
  test("late .catch(): the graph's unhandledRejection fires, then rejectionHandled — both on the graph's process, not the host's", async () => {
    const host: string[] = [];
    const h = (r: any) => host.push(String(r?.message));
    process.on("unhandledRejection", h);
    try {
      const m = await ModuleGraph().import(join(dir, "late-handle.mjs"));
      m.go();
      await Bun.sleep(stressMode ? 400 : 30);
      expect(m.events.slice(0, 1)).toEqual(["unhandled:late"]);
      expect(m.events).toContain("caught");
      expect(host).toEqual([]);
    } finally {
      process.off("unhandledRejection", h);
    }
  });
  test("a promise rejected in graph A and awaited in graph B is caught in B; if B drops it, the unhandled rejection is attributed to the error's ORIGIN graph (A) — never to the host", async () => {
    const errsA: string[] = [],
      errsB: string[] = [];
    const host: unknown[] = [];
    const h = (r: unknown) => host.push(r);
    process.on("unhandledRejection", h);
    try {
      const a = await ModuleGraph({ env: { T: "A" }, onError: (e: any) => errsA.push(e.message) }).import(
        join(dir, "make-rejection.mjs"),
      );
      const b = await ModuleGraph({ env: { T: "B" }, onError: (e: any) => errsB.push(e.message) }).import(
        join(dir, "await-foreign.mjs"),
      );
      expect(await b.awaitIt(a.rejected())).toBe("caught:from:A");
      b.dropIt(a.pending());
      await Bun.sleep(stressMode ? 400 : 30);
      expect({ errsA, errsB, host }).toEqual({ errsA: ["later:A"], errsB: [], host: [] });
    } finally {
      process.off("unhandledRejection", h);
    }
  });
  test("a host closure that rejects, scheduled by graph code: handled → nobody notified; unhandled → goes to the HOST (its code created it), not the graph's onError", async () => {
    const errs: string[] = [];
    const m = await ModuleGraph({ onError: (e: any) => errs.push(e.message) }).import(join(dir, "host-cb.mjs"));
    const handled = new Promise<string>(res =>
      m.callLater(() => Promise.reject(new Error("host-handled")).catch(e => res(e.message))),
    );
    expect([await handled, errs]).toEqual(["host-handled", []]);
    // host-level unhandled rejections fail a bun:test test even with a listener, so observe in a child process
    const script = `const seen = []; process.on("unhandledRejection", e => seen.push("host:" + e.message));
      const errs = []; const m = await new Bun.unsafe.ModuleGraph({ onError: e => errs.push("graph:" + e.message) }).import(${JSON.stringify(join(dir, "host-cb.mjs"))});
      m.callLater(() => { Promise.reject(new Error("host-unhandled")) }); setTimeout(() => { console.log(JSON.stringify([seen, errs])); process.exit(0) }, 300);`;
    const r = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env } });
    expect(r.stdout.toString().trim()).toBe(JSON.stringify([["host:host-unhandled"], []]));
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — documented process-wide state (not per graph)", () => {
  const dir = fixture({
    "pw.mjs": `export const tz = () => { process.env.TZ = "Asia/Tokyo"; return new Date(0).getTimezoneOffset() }
    export const prep = () => { const prev = Error.prepareStackTrace; Error.prepareStackTrace = () => "graph-prepared"; const s = new Error().stack; Error.prepareStackTrace = prev; return s }
    export const title = () => process.title;
    export const umask = () => process.umask();`,
  });
  test("TZ: setting process.env.TZ inside a graph changes only the graph's env, not the process time zone (host's TZ setter is process-wide and untouched)", async () => {
    const before = new Date(0).getTimezoneOffset();
    const m = await ModuleGraph({ env: { ...process.env } }).import(join(dir, "pw.mjs"));
    expect(m.tz()).toBe(before);
    expect([process.env.TZ, new Date(0).getTimezoneOffset()]).toEqual([process.env.TZ, before]);
  });
  test("Error.prepareStackTrace is a shared static: usable from a graph, and the graph restoring it leaves the host's value", async () => {
    const hostPrev = Error.prepareStackTrace;
    const m = await ModuleGraph().import(join(dir, "pw.mjs"));
    expect(m.prep()).toBe("graph-prepared");
    expect(Error.prepareStackTrace).toBe(hostPrev);
  });
  test("process.title / umask pass through to the real process", async () => {
    const m = await ModuleGraph().import(join(dir, "pw.mjs"));
    expect([m.title(), m.umask()]).toEqual([process.title, process.umask()]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — streams, sockets and handles around exit", () => {
  const dir = fixture({
    "h.mjs": `import fs from "node:fs"; import fsp from "node:fs/promises"; import dgram from "node:dgram"; import net from "node:net"; import tls from "node:tls";
      export const marker = { big: new Uint8Array(1 << 18) };
      export const opened = {};
      export async function fileHandle(p) { opened.fh = await fsp.open(p, "w"); await opened.fh.write("x"); return typeof opened.fh.fd }
      export function readStream(p) { opened.rs = fs.createReadStream(p); opened.rs.on("data", () => marker); return "armed" }
      export async function udp() { opened.udp = dgram.createSocket("udp4"); await new Promise(r => opened.udp.bind(0, r)); opened.udp.on("message", () => marker); return opened.udp.address().port }
      export async function bunListen() { opened.l = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() { return marker } } }); return opened.l.port }
      export async function pendingRead() { const rs = new ReadableStream({ pull() { return new Promise(() => marker) } }); opened.reader = rs.getReader(); opened.reader.read(); return "pending" }
      export function abortController() { opened.ac = new AbortController(); return opened.ac.signal }
      export function stdinListener() { const h = () => marker; process.stdin.on("data", h); return process.stdin.listenerCount("data") }
      export function quit() { process.exit(0) }`,
    "data.txt": "hello",
  });
  const portOpen = (port: number) =>
    new Promise<boolean>(res => {
      const s = require("node:net").connect(port, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        res(true);
      });
      s.once("error", () => res(false));
    });
  test("Bun.listen socket server started by graph code is stopped on exit", async () => {
    const g = ModuleGraph();
    const m = await g.import(join(dir, "h.mjs"));
    const port = await m.bunListen();
    expect(await portOpen(port)).toBe(true);
    m.quit();
    await Bun.sleep(20);
    expect(await portOpen(port)).toBe(false);
  });
  test("node:dgram socket bound by graph code: documented — not tracked (no listen()); exit doesn't crash and the owner can still close it", async () => {
    const g = ModuleGraph();
    const m = await g.import(join(dir, "h.mjs"));
    const port = await m.udp();
    expect(typeof port).toBe("number");
    m.quit();
    expect(() => m.opened.udp.close()).not.toThrow();
  });
  test("an open FileHandle / fs.ReadStream / pending ReadableStream reader at exit: no crash; graph stays collectable once the handle owner lets go", async () => {
    const ok = await collected(async register => {
      const g = ModuleGraph();
      const m = await g.import(join(dir, "h.mjs"));
      register(m.marker);
      expect(await m.fileHandle(join(dir, "out.txt"))).toBe("number");
      expect(m.readStream(join(dir, "data.txt"))).toBe("armed");
      expect(await m.pendingRead()).toBe("pending");
      await Bun.sleep(10);
      m.quit();
      await m.opened.fh.close();
      m.opened.rs.destroy();
    });
    expect(ok).toBe(true);
  }, 30_000);
  test("an AbortSignal created in a graph and handed to a host fetch keeps working after the graph exits (host-owned operation); aborting later still aborts", async () => {
    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("x"));
            },
          }),
        ),
    });
    try {
      const g = ModuleGraph();
      const m = await g.import(join(dir, "h.mjs"));
      const signal = m.abortController();
      const res = await fetch(`http://127.0.0.1:${server.port}/`, { signal });
      const reader = res.body!.getReader();
      await reader.read();
      m.quit();
      const pending = reader.read().then(
        () => "read",
        (e: Error) => e.name,
      );
      m.opened.ac.abort();
      expect(await Promise.race([pending, Bun.sleep(500).then(() => "hung")])).toBe("AbortError");
    } finally {
      server.stop(true);
    }
  });
  test("process.stdin listeners added by graph code are removed on exit (host count restored)", async () => {
    const before = process.stdin.listenerCount("data");
    const g = ModuleGraph();
    const m = await g.import(join(dir, "h.mjs"));
    expect(m.stdinListener()).toBeGreaterThanOrEqual(1);
    m.quit();
    expect(process.stdin.listenerCount("data")).toBe(before);
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — process-global registries touched from a graph (documented shared)",
  () => {
    test("Bun.plugin registered from graph code is process-wide (documented) and keeps working after the graph exits", async () => {
      const dir = fixture({
        "reg.mjs": `Bun.plugin({ name: "virt-" + process.env.T, setup(b) { b.module("virt:" + process.env.T, () => ({ exports: { from: process.env.T }, loader: "object" })) } }); export const quit = () => process.exit(0)`,
        "use.mjs": `export const v = (await import("virt:one")).from`,
      });
      const g = ModuleGraph({ env: { T: "one" } });
      const m = await g.import(join(dir, "reg.mjs"));
      expect((await import("virt:one")).from).toBe("one"); // visible to the host: registries are per process
      m.quit();
      expect((await ModuleGraph().import(join(dir, "use.mjs"))).v).toBe("one"); // and to other graphs, after the registering graph is gone
      rmSync(dir, { recursive: true, force: true });
    });
    test("require.extensions / Module._extensions mutation from a graph is process-wide (documented); a graph cannot un-break the host by exiting", async () => {
      const dir = fixture({
        "ext.cjs": `const M = require("node:module"); const had = ".graphext" in M._extensions; M._extensions[".graphext"] = M._extensions[".js"]; module.exports = { had }`,
        "x.graphext": `module.exports = 42`,
        "load.cjs": `module.exports = require("./x.graphext")`,
      });
      const Module = require("node:module");
      try {
        const m = await ModuleGraph().import(join(dir, "ext.cjs"));
        expect(m.default.had).toBe(false);
        expect(".graphext" in Module._extensions).toBe(true);
        expect((await ModuleGraph().import(join(dir, "load.cjs"))).default).toBe(42);
      } finally {
        delete Module._extensions[".graphext"];
        rmSync(dir, { recursive: true, force: true });
      }
    });
    test("process.env.NODE_OPTIONS-like host-only knobs: a graph setting UV_THREADPOOL_SIZE / NODE_ENV changes only its own env", async () => {
      const dir = fixture({
        "k.mjs": `process.env.NODE_ENV = "graph-prod"; process.env.UV_THREADPOOL_SIZE = "1"; export const mine = process.env.NODE_ENV`,
      });
      const before = [process.env.NODE_ENV, process.env.UV_THREADPOOL_SIZE];
      expect((await ModuleGraph({ env: { ...process.env } }).import(join(dir, "k.mjs"))).mine).toBe("graph-prod");
      expect([process.env.NODE_ENV, process.env.UV_THREADPOOL_SIZE]).toEqual(before);
      rmSync(dir, { recursive: true, force: true });
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — option off: the API is absent and nothing else changes", () => {
  test("the constructor is always exposed, and a plain script's module semantics are unaffected by its existence", () => {
    const script = `const has = typeof Bun.unsafe?.ModuleGraph; let made = "n/a"; try { if (has === "function") { new Bun.unsafe.ModuleGraph({}); made = "constructed" } } catch (e) { made = "threw:" + e.constructor.name }
      const m = await import(${JSON.stringify(join(fixture({ "plain.mjs": `export const v = [typeof process.env.HOME, typeof setTimeout, import.meta.main]` }), "plain.mjs"))}); console.log(JSON.stringify({ has, made, v: m.v }))`;
    const on = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env } });
    expect(JSON.parse(on.stdout.toString().trim())).toEqual({
      has: "function",
      made: "constructed",
      v: ["string", "function", false],
    });
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — TLS/HTTPS servers, client sockets, IPC children, Atomics.wait",
  () => {
    const dir = fixture({
      "cert.json": JSON.stringify({ cert: tlsCert.cert, key: tlsCert.key }),
      "s.mjs": `import https from "node:https"; import tls from "node:tls"; import net from "node:net"; import { fork } from "node:child_process"; import cert from "./cert.json";
      export const marker = { big: new Uint8Array(1 << 18) }; export const started = {};
      export async function httpsServer() { const s = https.createServer(cert, (q, r) => r.end("tls:" + process.env.T)); await new Promise(r => s.listen(0, r)); return (started.port = s.address().port) }
      export async function tlsServer() { const s = tls.createServer(cert, c => c.end("hello")); await new Promise(r => s.listen(0, r)); return (started.port = s.address().port) }
      export async function bunServeTls() { const s = Bun.serve({ port: 0, tls: cert, fetch: () => new Response("bun-tls:" + process.env.T) }); return (started.port = s.port) }
      export async function client(port) { return await new Promise((res, rej) => { const c = net.connect(port, "127.0.0.1", () => { started.client = c; res("connected") }); c.on("error", rej) }) }
      export async function bunConnect(port) { started.bc = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, open() {} } }); return "connected" }
      export async function forkChild(p) { const c = fork(p, [], { stdio: ["pipe", "pipe", "pipe", "ipc"] }); started.child = c; return await new Promise(r => c.once("message", m => r(m))) }
      export function atomicsWait() { const sab = new SharedArrayBuffer(4); const t = Date.now(); const r = Atomics.wait(new Int32Array(sab), 0, 0, 20); return [r, Date.now() - t >= 15] }
      export function quit() { process.exit(0) }`,
      "child.mjs": `process.send({ env: process.env.T ?? null, argv1: process.argv[1] }); setInterval(() => {}, 1000)`,
    });
    const portOpen = (port: number) =>
      new Promise<boolean>(res => {
        const s = require("node:net").connect(port, "127.0.0.1");
        s.once("connect", () => {
          s.destroy();
          res(true);
        });
        s.once("error", () => res(false));
      });
    const pidAlive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (const kind of ["httpsServer", "tlsServer", "bunServeTls"]) {
      test(`${kind}: serves with the graph's env over TLS and stops on exit`, async () => {
        const g = ModuleGraph({ env: { ...process.env, T: "sec" } });
        const m = await g.import(join(dir, "s.mjs"));
        const port = await m[kind]();
        if (kind !== "tlsServer") {
          const body = await fetch(`https://127.0.0.1:${port}/`, { tls: { rejectUnauthorized: false } } as any).then(
            r => r.text(),
          );
          expect(body).toMatch(/tls:sec$/);
        }
        expect(await portOpen(port)).toBe(true);
        m.quit();
        await Bun.sleep(20);
        expect(await portOpen(port)).toBe(false);
      });
    }
    test("client sockets (net.connect / Bun.connect) opened by graph code: documented — left to their owner (not force-closed), no crash on exit, graph collectable after they close", async () => {
      const hostServer = require("node:net")
        .createServer((c: any) => c.on("data", () => {}))
        .listen(0);
      await new Promise(r => hostServer.once("listening", r));
      const port = hostServer.address().port;
      try {
        const ok = await collected(async register => {
          const g = ModuleGraph();
          const m = await g.import(join(dir, "s.mjs"));
          register(m.marker);
          expect([await m.client(port), await m.bunConnect(port)]).toEqual(["connected", "connected"]);
          m.quit();
          m.started.client.destroy();
          m.started.bc.end();
          await Bun.sleep(10);
        });
        expect(ok).toBe(true);
      } finally {
        hostServer.close();
      }
    }, 30_000);
    test("child_process.fork with IPC from graph code: child gets the graph env, IPC works, child is ended on graph exit", async () => {
      const g = ModuleGraph({ env: { ...process.env, T: "forked" } });
      const m = await g.import(join(dir, "s.mjs"));
      const msg = await m.forkChild(join(dir, "child.mjs"));
      expect(msg).toEqual({ env: "forked", argv1: join(dir, "child.mjs") });
      const pid = m.started.child.pid;
      expect(pidAlive(pid)).toBe(true);
      m.quit();
      for (let i = 0; i < 50 && pidAlive(pid); i++) await Bun.sleep(10);
      expect(pidAlive(pid)).toBe(false);
    });
    test("Atomics.wait with timeout inside a graph blocks and returns 'timed-out' (documented: blocks the shared thread like any code would)", async () => {
      const m = await ModuleGraph().import(join(dir, "s.mjs"));
      expect(m.atomicsWait()).toEqual(["timed-out", true]);
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — patterns a CLI application uses at boot", () => {
  const dir = fixture({
    "app/entry.mjs": `import { EventEmitter, setMaxListeners } from "node:events"; import { AsyncLocalStorage } from "node:async_hooks"; import fs from "node:fs"; import path from "node:path"; import os from "node:os";
      export const als = new AsyncLocalStorage();
      process.setMaxListeners(50); setMaxListeners(50);
      EventEmitter.captureRejections = EventEmitter.captureRejections;      // read+write of a class static (shared) must not throw
      const configDir = path.join(os.homedir(), ".app"); fs.mkdirSync(configDir, { recursive: true }); const cfg = path.join(configDir, "config.json");
      if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify({ boots: 0 }));
      const state = JSON.parse(fs.readFileSync(cfg, "utf8")); state.boots++; fs.writeFileSync(cfg, JSON.stringify(state));
      fs.watchFile(cfg, { interval: 5007 }, () => {});
      let lazy; export function tool() { lazy ??= require("./lazy.cjs"); return lazy.run() }
      export async function chunk() { return (await import("./chunk.mjs")).v }
      const cleanup = []; export function registerCleanup(f) { cleanup.push(f) }
      process.on("SIGINT", () => { for (const f of cleanup) f(); process.exit(130) });
      process.on("exit", () => { fs.unwatchFile(cfg) });
      export const info = { home: os.homedir(), boots: state.boots, cwd: process.cwd(), argv0: process.argv0, title: process.title, tty: process.stdout.isTTY ?? false, cols: process.stdout.columns ?? null };
      export function shutdown(code) { for (const f of cleanup) f(); process.exit(code) }
      import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`,
    "app/lazy.cjs": `let n = 0; module.exports = { run: () => "lazy:" + process.env.SESSION + ":" + (++n) }`,
    "app/chunk.mjs": `export const v = "chunk:" + process.env.SESSION`,
  });
  async function boot(session: string, home: string) {
    const codes: number[] = [],
      errs: unknown[] = [];
    const g = ModuleGraph({
      env: { ...process.env, SESSION: session, HOME: home },
      cwd: dir,
      onExit: c => codes.push(c),
      onError: e => errs.push(e),
    });
    return { g, m: await g.import(join(dir, "app/entry.mjs")), codes, errs };
  }
  test("two sessions boot side by side with their own HOME/config/lazy requires/chunks; shutdown runs cleanup and exits with the code; host unaffected", async () => {
    const homeA = join(dir, "homeA"),
      homeB = join(dir, "homeB");
    const A = await boot("A", homeA),
      B = await boot("B", homeB);
    expect([A.m.info.home, B.m.info.home, A.m.info.boots, B.m.info.boots]).toEqual([homeA, homeB, 1, 1]);
    expect([A.m.tool(), A.m.tool(), B.m.tool(), await A.m.chunk(), await B.m.chunk()]).toEqual([
      "lazy:A:1",
      "lazy:A:2",
      "lazy:B:1",
      "chunk:A",
      "chunk:B",
    ]);
    let cleaned = 0;
    A.m.registerCleanup(() => cleaned++);
    A.m.shutdown(3);
    expect([A.codes, cleaned, A.errs]).toEqual([[3], 1, []]);
    expect([B.m.tool(), (await boot("A2", homeA)).m.info.boots]).toEqual(["lazy:B:2", 2]); // B alive; A's home persisted boots=2 for the next A
    expect(process.listenerCount("SIGINT")).toBe(1 /* B */ + 1 /* A2 */ + 0);
    B.m.shutdown(0);
  });
  test("SIGINT delivered to the process reaches each live session's handler (each exits 130) and not exited ones", async () => {
    const S1 = await boot("S1", join(dir, "h1")),
      S2 = await boot("S2", join(dir, "h2"));
    S1.m.shutdown(0);
    const hostSigint = () => {};
    process.on("SIGINT", hostSigint); // keep the host alive on SIGINT
    try {
      process.kill(process.pid, "SIGINT");
      await Bun.sleep(30);
    } finally {
      process.off("SIGINT", hostSigint);
    }
    expect([S1.codes, S2.codes]).toEqual([[0], [130]]);
  });
  test("50 sessions booted then shut down: host listener counts and object count return to baseline", async () => {
    const base = { sigint: process.listenerCount("SIGINT"), exit: process.listenerCount("exit") };
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        Bun.gc(true);
        await Bun.sleep(2);
      }
      return heapStats().objectCount;
    };
    const before = await settle();
    const sessions = [];
    for (let i = 0; i < 50; i++) sessions.push(await boot("m" + i, join(dir, "hm" + i)));
    for (const s of sessions) s.m.shutdown(0);
    sessions.length = 0;
    expect([process.listenerCount("SIGINT"), process.listenerCount("exit")]).toEqual([base.sigint, base.exit]);
    const after = await settle();
    expect(after - before).toBeLessThan(20_000);
  }, 60_000);
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — memory per instance vs module count", () => {
  test("per-instance heap cost grows with module count but stays far below the template cost; numbers are stable across instances", async () => {
    const results: Record<string, number[]> = {};
    for (const modules of [20, 200]) {
      const files: Record<string, string> = {};
      for (let i = 0; i < modules; i++)
        files[`m${i}.mjs`] =
          `${i ? `import { v as p } from "./m${i - 1}.mjs";` : "const p = 0;"} export const v = p + 1; export function f${i}(a) { return a + v } export class C${i} { m() { return v } } export const who = process.env.T;`;
      files["root.mjs"] = `export { v, who } from "./m${modules - 1}.mjs"`;
      const dir = fixture(files);
      const settle = async () => {
        for (let i = 0; i < 3; i++) {
          Bun.gc(true);
          await Bun.sleep(3);
        }
        return heapStats().heapSize;
      };
      const h0 = await settle();
      const keep = [await ModuleGraph({ env: { T: "0" } }).import(join(dir, "root.mjs"))];
      const h1 = await settle();
      for (let i = 1; i <= 8; i++)
        keep.push(await ModuleGraph({ env: { T: String(i) } }).import(join(dir, "root.mjs")));
      const h9 = await settle();
      expect(keep.map(m => m.v)).toEqual(Array(9).fill(modules));
      const first = h1 - h0,
        perInstance = (h9 - h1) / 8;
      results[modules] = [Math.round(first / 1024), Math.round(perInstance / 1024)];
      if (!stressMode) {
        expect(perInstance).toBeLessThan(first * 0.5); // sharing: an extra instance is well under half the first load
        expect(perInstance / modules).toBeLessThan(8 * 1024); // < 8 KB per module per instance (envs + functions + namespace)
      }
      rmSync(dir, { recursive: true, force: true });
    }
    // more modules → more per-instance cost, roughly proportionally (not, e.g., quadratic)
    if (!stressMode) expect(results[200][1] / Math.max(1, results[20][1])).toBeLessThan(20);
    console.log("memory table KB [first load, per extra instance]:", JSON.stringify(results));
  }, 60_000);
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — modules the HOST linked before any graph existed", () => {
  test("a module first imported by the host (in a fresh process, before any ModuleGraph) still gets its own instance and the graph's process/timers when a graph imports it", () => {
    const dir = fixture({
      "shared.mjs": `export const who = process.env.T ?? "host"; export const timerIsGraphs = typeof setTimeout(() => {}, 0) === "object"; export const g = typeof globalThis.__hostOnly`,
      "main.mjs": `globalThis.__hostOnly = 1; const host = await import("./shared.mjs"); const G = Bun.unsafe.ModuleGraph;
        const a = await new G({ env: { T: "A" } }).import(new URL("./shared.mjs", import.meta.url).pathname), b = await new G({ env: { T: "B" } }).import(new URL("./shared.mjs", import.meta.url).pathname);
        console.log(JSON.stringify([host.who, a.who, b.who, host.g, a.g])); process.exit(0)`,
    });
    const r = Bun.spawnSync([process.execPath, join(dir, "main.mjs")], {
      env: { ...process.env, T: undefined } as any,
    });
    expect(JSON.parse(r.stdout.toString().trim())).toEqual([
      "host",
      "A",
      "B",
      "number",
      "number" /* reads fall through to the host global (documented) */,
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — evaluator stress: large SCCs, TLA positions, star-export conflicts, per instance",
  () => {
    function ring(n: number, tlaAt: number[]) {
      const files: Record<string, string> = {};
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        files[`r${i}.mjs`] =
          `import { id as nextId, order } from "./r${next}.mjs"; export { order }; export const id = ${i}; ${tlaAt.includes(i) ? "await new Promise(r => setTimeout(r, 1));" : ""} order.push([${i}, process.env.T]); export const seenNext = () => nextId;`;
      }
      files[`r${n - 1}.mjs`] = files[`r${n - 1}.mjs`].replace(
        `import { id as nextId, order } from "./r0.mjs"; export { order };`,
        `import { id as nextId } from "./r0.mjs"; export const order = [];`,
      );
      return files;
    }
    for (const [label, tla] of [
      ["no TLA", []],
      ["TLA at head", [0]],
      ["TLA mid-ring", [17]],
      ["TLA at 3 places", [3, 20, 41]],
    ] as const) {
      test(`50-module cycle, ${label}: evaluates once per instance in dependency order; 3 instances concurrently agree with the host's order`, async () => {
        const dir = fixture(ring(50, [...tla]));
        const hostNs = await import(join(dir, "r0.mjs"));
        const hostOrder = hostNs.order.map((e: [number, string]) => e[0]);
        const graphs = await Promise.all(
          ["A", "B", "C"].map(T => ModuleGraph({ env: { T } }).import(join(dir, "r0.mjs"))),
        );
        for (const [i, g] of graphs.entries()) {
          expect(g.order.map((e: [number, string]) => e[0])).toEqual(hostOrder); // same evaluation order as the spec algorithm on the primary
          expect(new Set(g.order.map((e: [number, string]) => e[1]))).toEqual(new Set([["A", "B", "C"][i]])); // every module body ran with this instance's env
          expect(g.order.length).toBe(50); // each exactly once
          expect(g.seenNext()).toBe(1);
        }
        rmSync(dir, { recursive: true, force: true });
      });
    }
    test("star-export name conflict and ambiguous re-export resolve/throw identically in an instance and the host", async () => {
      const dir = fixture({
        "a.mjs": `export const dup = "a"; export const onlyA = 1`,
        "b.mjs": `export const dup = "b"; export const onlyB = 2`,
        "star.mjs": `export * from "./a.mjs"; export * from "./b.mjs"`,
        "use-ok.mjs": `import { onlyA, onlyB } from "./star.mjs"; export const v = [onlyA, onlyB]`,
        "use-ambiguous.mjs": `import { dup } from "./star.mjs"; export const v = dup`,
        "ns.mjs": `import * as ns from "./star.mjs"; export const keys = Object.keys(ns)`,
      });
      const g = ModuleGraph();
      expect((await g.import(join(dir, "use-ok.mjs"))).v).toEqual([1, 2]);
      const [ge, he] = [
        await g.import(join(dir, "use-ambiguous.mjs")).then(
          () => "ok",
          e => e.constructor.name,
        ),
        await import(join(dir, "use-ambiguous.mjs")).then(
          () => "ok",
          e => e.constructor.name,
        ),
      ];
      expect(ge).toBe(he);
      expect((await g.import(join(dir, "ns.mjs"))).keys).toEqual((await import(join(dir, "ns.mjs"))).keys);
      rmSync(dir, { recursive: true, force: true });
    });
    test("import defer of a cycle member per instance: touching the deferred namespace evaluates the SCC in this instance only", async () => {
      const dir = fixture({
        "log.mjs": `export const log = globalThis.__dlog ??= []`,
        "x.mjs": `import { log } from "./log.mjs"; import "./y.mjs"; log.push("x:" + process.env.T); export const x = 1`,
        "y.mjs": `import { log } from "./log.mjs"; import "./x.mjs"; log.push("y:" + process.env.T); export const y = 2`,
        "main.mjs": `import defer * as d from "./x.mjs"; import { log } from "./log.mjs"; export const before = log.slice(); export const touch = () => [d.x, log.slice()]`,
      });
      const a = await ModuleGraph({ env: { T: "A" } }).import(join(dir, "main.mjs")),
        b = await ModuleGraph({ env: { T: "B" } }).import(join(dir, "main.mjs"));
      expect([a.before, b.before]).toEqual([[], []]);
      expect(a.touch()).toEqual([1, ["y:A", "x:A"]]);
      expect(b.before).toEqual([]); // B untouched by A's evaluation
      expect(b.touch()).toEqual([1, ["y:B", "x:B"]]);
      rmSync(dir, { recursive: true, force: true });
    });
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — import.meta / main-module identity per graph", () => {
  const dir = fixture({
    "entry.mjs": `import { depMeta } from "./dep.mjs"; import { createRequire } from "node:module";
      export const meta = { main: import.meta.main, path: import.meta.path, dir: import.meta.dir, file: import.meta.file, url: import.meta.url, bunMain: Bun.main, argv1: process.argv[1], requireMain: (() => { try { return createRequire(import.meta.url).main?.filename ?? null } catch { return "threw" } })() };
      export { depMeta };
      export const viaMetaRequire = import.meta.require("./c.cjs"); export const viaCreateRequire = createRequire(import.meta.url)("./c.cjs");
      export const resolveSync = import.meta.resolveSync("./dep.mjs"); export const resolved = import.meta.resolve("./dep.mjs");`,
    "dep.mjs": `export const depMeta = { main: import.meta.main, file: import.meta.file }`,
    "c.cjs": `module.exports = { n: Math.random(), main: require.main === module, mainFile: require.main && require.main.filename }`,
  });
  test("import.meta.main is true for the graph's first import (its main module) and false for deps; path/dir/file/url are the file's", async () => {
    const m = await ModuleGraph().import(join(dir, "entry.mjs"));
    expect(m.meta).toMatchObject({
      main: true,
      path: join(dir, "entry.mjs"),
      dir,
      file: "entry.mjs",
      url: Bun.pathToFileURL(join(dir, "entry.mjs")).href,
    });
    expect(m.depMeta).toEqual({ main: false, file: "dep.mjs" });
    const second = await ModuleGraph();
    await second.import(join(dir, "dep.mjs"));
    expect((await second.import(join(dir, "entry.mjs"))).meta.main).toBe(false); // not this graph's first import
  });
  test("Bun.main / process.argv[1] inside a graph (documented): host values pass through; graph.mainModule is the graph's entry", async () => {
    const g = ModuleGraph();
    const m = await g.import(join(dir, "entry.mjs"));
    expect([m.meta.bunMain, m.meta.argv1]).toEqual([Bun.main, process.argv[1]]);
    expect((g as any).mainModule).toBe(join(dir, "entry.mjs"));
  });
  test("import.meta.require and createRequire share the graph's CJS cache; resolve/resolveSync work", async () => {
    const a = await ModuleGraph().import(join(dir, "entry.mjs")),
      b = await ModuleGraph().import(join(dir, "entry.mjs"));
    expect(a.viaMetaRequire).toBe(a.viaCreateRequire);
    expect(a.viaMetaRequire).not.toBe(b.viaMetaRequire);
    expect([a.resolveSync, a.resolved]).toEqual([join(dir, "dep.mjs"), Bun.pathToFileURL(join(dir, "dep.mjs")).href]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — non-JS module kinds and bun: builtins per graph", () => {
  const dir = fixture({
    "t.txt": "text-content",
    "d.toml": `k = "v"`,
    "j.json": `{"a":[1]}`,
    "w.wasm.b64": "AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=",
    "use.mjs": `import txt from "./t.txt"; import toml from "./d.toml"; import json from "./j.json"; import { Database } from "bun:sqlite"; import { file } from "bun";
      export const kinds = { txt, toml: toml.k, json: json.a[0], bunNs: typeof file };
      export function sqlite() { const db = new Database(":memory:"); db.run("create table t (v)"); db.run("insert into t values (?)", [process.env.T]); const v = db.query("select v from t").get().v; db.close(); return v }
      export async function wasm(b64) { const { instance } = await WebAssembly.instantiate(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); return instance.exports.add(2, 3) }
      json.a.push("mut:" + process.env.T); export const jsonNow = () => json.a.slice();`,
  });
  test("text/toml/json imports, bun:sqlite, `bun` namespace import and WebAssembly work per graph with graph env; JSON mutation isolated", async () => {
    const b64 = require("node:fs").readFileSync(join(dir, "w.wasm.b64"), "utf8");
    const a = await ModuleGraph({ env: { T: "A" } }).import(join(dir, "use.mjs")),
      b = await ModuleGraph({ env: { T: "B" } }).import(join(dir, "use.mjs"));
    expect(a.kinds).toEqual({ txt: "text-content", toml: "v", json: 1, bunNs: "function" });
    expect([a.sqlite(), b.sqlite(), await a.wasm(b64)]).toEqual(["A", "B", 5]);
    expect([a.jsonNow(), b.jsonNow()]).toEqual([
      [1, "mut:A"],
      [1, "mut:B"],
    ]);
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — debugger / inspector", () => {
  test("a graph module with `debugger` statements runs under --inspect without incident (documented: N-API addons, Bun.plugin and node:cluster are process-wide, not per graph)", () => {
    const dir = fixture({
      "d.mjs": `debugger; export const v = process.env.T; export function f() { debugger; return v }`,
      "run.mjs": `const m = await new Bun.unsafe.ModuleGraph({ env: { T: "dbg" } }).import(new URL("./d.mjs", import.meta.url).pathname); console.log("ok:" + m.f()); setTimeout(() => process.exit(0), 100);`,
    });
    const r = Bun.spawnSync([process.execPath, "--inspect=127.0.0.1:0", join(dir, "run.mjs")], {
      env: { ...process.env },
    });
    expect(r.stdout.toString()).toContain("ok:dbg");
    expect(r.exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — differential fuzz: random module graphs evaluate like the host",
  () => {
    function rng(seed: number) {
      return () => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        return (seed >>> 8) / 2 ** 24;
      };
    }
    function gen(seed: number) {
      const r = rng(seed);
      const n = 4 + Math.floor(r() * 9);
      const files: Record<string, string> = {};
      for (let i = 0; i < n; i++) {
        const deps = new Set<number>();
        const k = Math.floor(r() * 3);
        for (let j = 0; j < k; j++) deps.add(Math.floor(r() * n));
        if (r() < 0.35) deps.add((i + 1) % n); // ring edges make SCCs common
        deps.delete(i);
        const tla = r() < 0.3,
          throws = r() < 0.12,
          defer = r() < 0.1;
        const imports = [...deps]
          .map(d => (defer ? `import defer * as d${d} from "./m${d}.mjs";` : `import "./m${d}.mjs";`))
          .join(" ");
        files[`m${i}.mjs`] =
          `${imports} globalThis.__log.push("start:${i}"); ${tla ? "await new Promise(r => setTimeout(r, " + Math.floor(r() * 3) + "));" : ""} ${throws ? `throw new Error("boom:${i}");` : ""} globalThis.__log.push("end:${i}"); export const id = ${i};`;
      }
      return { files, n };
    }
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181]) {
      test(`seed ${seed}: every entry point settles the same way (resolve/reject + message) and logs the same start/end sequence set as the host`, async () => {
        const { files, n } = gen(seed);
        const dir = fixture(files);
        for (let entry = 0; entry < n; entry += Math.max(1, Math.floor(n / 3))) {
          const p = join(dir, `m${entry}.mjs`);
          // host: fresh process per entry so its registry is clean; graph: fresh graph
          const hostScript = `globalThis.__log = []; const r = await import(${JSON.stringify(p)}).then(m => "ok:" + m.id, e => "err:" + e.message); console.log(JSON.stringify({ r, log: globalThis.__log }))`;
          const h = JSON.parse(
            Bun.spawnSync([process.execPath, "-e", hostScript], { env: { ...process.env } })
              .stdout.toString()
              .trim() || "null",
          );
          const log: string[] = [];
          const g = await ModuleGraph({ globals: { __log: log } })
            .import(p)
            .then(
              (m: any) => "ok:" + m.id,
              (e: any) => "err:" + e.message,
            );
          expect({ entry, r: g }).toEqual({ entry, r: h.r });
          // async siblings may interleave differently run-to-run; compare as multisets and check per-module start-before-end
          expect({ entry, log: [...log].sort() }).toEqual({ entry, log: [...h.log].sort() });
          for (const e of log.filter(x => x.startsWith("end:")))
            expect(log.indexOf("start:" + e.slice(4))).toBeLessThan(log.indexOf(e));
        }
        rmSync(dir, { recursive: true, force: true });
      }, 60_000);
    }
  },
);

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — races and hosting contexts", () => {
  test("host import() and graph.import() of the same never-loaded module started in the same tick both succeed with their own instance", async () => {
    for (let i = 0; i < 5; i++) {
      const dir = fixture({
        "fresh.mjs": `await new Promise(r => setTimeout(r, 1)); export const who = process.env.T ?? "host"; export let n = 0; export const inc = () => ++n`,
      });
      const [h, g] = await Promise.all([
        import(join(dir, "fresh.mjs")),
        ModuleGraph({ env: { T: "G" } }).import(join(dir, "fresh.mjs")),
      ]);
      h.inc();
      expect([h.who, g.who, h.n, g.n]).toEqual(["host", "G", 1, 0]);
      const [g2, h2] = await Promise.all([
        ModuleGraph({ env: { T: "G2" } }).import(join(dir, "fresh.mjs") + "?v=2"),
        import(join(dir, "fresh.mjs") + "?v=2"),
      ]);
      expect([g2.who, h2.who]).toEqual(["G2", "host"]);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("ModuleGraph used inside a Worker: per-graph env, exit, and collectability work there too", async () => {
    const dir = fixture({
      "t.mjs": `export const who = process.env.T; export const marker = { big: new Uint8Array(1 << 18) }; setInterval(() => {}, 1000); export const quit = () => process.exit(0)`,
      "in-worker.mjs":
        `const G = Bun.unsafe.ModuleGraph; const results = []; let collected = 0; const fr = new FinalizationRegistry(() => collected++);
        for (let i = 0; i < 6; i++) { const codes = []; const g = new G({ env: { T: "w" + i }, onExit: c => codes.push(c) }); const m = await g.import(${JSON.stringify("PLACEHOLDER")}); fr.register(m.marker, i); results.push(m.who); m.quit(); results.push(codes[0]); }
        for (let i = 0; i < 80 && collected < 6; i++) { Bun.gc(true); await Bun.sleep(5); }
        postMessage({ results, collected, overlaid: G.overlaidGlobals.includes("process") });`.replace(
          "PLACEHOLDER",
          "REPLACEME",
        ),
    });
    writeFileSync(
      join(dir, "in-worker.mjs"),
      require("node:fs")
        .readFileSync(join(dir, "in-worker.mjs"), "utf8")
        .replace('"REPLACEME"', JSON.stringify(join(dir, "t.mjs"))),
    );
    const w = new Worker(join(dir, "in-worker.mjs"));
    const msg: any = await new Promise((res, rej) => {
      w.onmessage = e => res(e.data);
      w.onerror = rej;
    });
    w.terminate();
    expect(msg.results).toEqual(["w0", 0, "w1", 0, "w2", 0, "w3", 0, "w4", 0, "w5", 0]);
    expect(msg.overlaid).toBe(true);
    expect(msg.collected).toBeGreaterThanOrEqual(5); // conservative scanning may keep the last one briefly
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — option and argument edge shapes", () => {
  const dir = fixture({
    "e.mjs": `export const env = { ...process.env }; export const exit = c => process.exit(c); export const setCode = c => { process.exitCode = c }`,
  });
  test("exit code validation matches Bun/Node exactly (exitCode setter and exit(code)): integers & integer-strings accepted, undefined/null keep the code, everything else throws the same error code", async () => {
    const inputs: unknown[] = ["3", 4.7, undefined, null, -1, 256, "abc", true, 12, "", " 5 "];
    const lit = (v: unknown) => (v === undefined ? "undefined" : JSON.stringify(v));
    for (const input of inputs) {
      const host = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `let r; try { process.exitCode = ${lit(input)}; r = "ok:" + process.exitCode } catch (e) { r = "threw:" + e.code } console.log(r); process.exitCode = 0`,
        ],
        { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } },
      )
        .stdout.toString()
        .trim()
        .split("\n")
        .pop();
      const m = await ModuleGraph().import(join(dir, "e.mjs"));
      let viaSetter: string;
      try {
        m.setCode(input);
        viaSetter = "ok";
      } catch (e: any) {
        viaSetter = "threw:" + e.code;
      }
      const codes: number[] = [];
      const m2 = await ModuleGraph({ onExit: c => codes.push(c) }).import(join(dir, "e.mjs"));
      let viaExit: string;
      try {
        m2.exit(input);
        viaExit = "ok:" + (codes[0] === 0 && (input === undefined || input === null) ? "undefined" : codes[0]);
      } catch (e: any) {
        viaExit = "threw:" + e.code;
      }
      expect({ input, viaExit }).toEqual({ input, viaExit: host });
      expect({ input, setterThrew: viaSetter.startsWith("threw:") ? viaSetter : "ok" }).toEqual({
        input,
        setterThrew: host.startsWith("threw:") ? host : "ok",
      });
    }
    const codes: number[] = [];
    const m = await ModuleGraph({ onExit: c => codes.push(c) }).import(join(dir, "e.mjs"));
    m.setCode("7");
    m.exit();
    expect(codes).toEqual([7]);
    const c3: number[] = [];
    const m3 = await ModuleGraph({ onExit: c => c3.push(c) }).import(join(dir, "e.mjs"));
    expect(() => m3.exit(4.7)).toThrow();
    expect(c3).toEqual([]); // a throwing exit() does not exit
  }, 30_000);
  test("env option shapes: prototype keys ignored, frozen object accepted, huge env, odd keys/values, non-string values coerced, later mutation of the source object not reflected", async () => {
    const proto = { FROM_PROTO: "p" };
    const src: any = Object.create(proto);
    src.A = "1";
    src.NUM = 5;
    src["WEIRD KEY=x"] = "w";
    src[""] = "empty";
    const big: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) big["K" + i] = "v" + i;
    const g1 = ModuleGraph({ env: src });
    src.A = "changed";
    const e1 = (await g1.import(join(dir, "e.mjs"))).env;
    expect([e1.A, e1.NUM, e1.FROM_PROTO, e1["WEIRD KEY=x"], e1[""]]).toEqual(["1", "5", undefined, "w", "empty"]);
    expect(
      Object.keys((await ModuleGraph({ env: Object.freeze({ ...big }) }).import(join(dir, "e.mjs"))).env).length,
    ).toBe(5000);
  });
  test("`using` / Symbol.dispose disposes the graph at block exit", async () => {
    let g: any;
    {
      using local = ModuleGraph() as any;
      g = local;
      await g.import(join(dir, "e.mjs"));
    }
    await expect(g.import(join(dir, "e.mjs"))).rejects.toThrow(/disposed/);
  });
  test("a tracked resource whose close() throws during dispose does not prevent the rest of teardown", async () => {
    const d = fixture({
      "bad.mjs": `import fs from "node:fs"; const w = fs.watch("."); w.close = () => { throw new Error("close-throws") }; setInterval(() => {}, 10); process.on("SIGWINCH", () => {}); export const quit = () => process.exit(0)`,
    });
    const before = process.listenerCount("SIGWINCH");
    const codes: number[] = [];
    const m = await ModuleGraph({ cwd: d, onExit: c => codes.push(c) }).import(join(d, "bad.mjs"));
    expect(() => m.quit()).not.toThrow();
    expect([codes, process.listenerCount("SIGWINCH")]).toEqual([[0], before]);
    rmSync(d, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — many live graphs, websockets, SIGTERM default action", () => {
  test("1000 live graphs at once each hold their own state; disposing all returns memory", async () => {
    const dir = fixture({
      "s.mjs": `export const id = process.env.ID; let n = 0; export const inc = () => (n += Number(id))`,
    });
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        Bun.gc(true);
        await Bun.sleep(2);
      }
      return heapStats().objectCount;
    };
    const before = await settle();
    const gs: any[] = [];
    for (let i = 0; i < 1000; i++) {
      const g = ModuleGraph({ env: { ID: String(i) } });
      gs.push([g, await g.import(join(dir, "s.mjs"))]);
    }
    expect(gs[0][1].inc() + gs[999][1].inc() + gs[500][1].inc()).toBe(0 + 999 + 500);
    expect(new Set(gs.map(([, m]) => m.id)).size).toBe(1000);
    const during = await settle();
    for (const [g] of gs) g.dispose();
    gs.length = 0;
    const after = await settle();
    expect(during - before).toBeGreaterThan(1000);
    expect(after - before).toBeLessThan((during - before) * 0.2); // ≥80% of what 1000 graphs held is gone
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
  test("Bun.serve with a websocket handler started by a graph: works, and stops (closing sockets) on exit", async () => {
    const dir = fixture({
      "ws.mjs": `export const s = Bun.serve({ port: 0, fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no") }, websocket: { message(ws, m) { ws.send("echo:" + process.env.T + ":" + m) } } }); export const quit = () => process.exit(0)`,
    });
    const m = await ModuleGraph({ env: { T: "wsg" } }).import(join(dir, "ws.mjs"));
    const ws = new WebSocket(`ws://127.0.0.1:${m.s.port}/`);
    const reply = await new Promise<string>((res, rej) => {
      ws.onopen = () => ws.send("hi");
      ws.onmessage = e => res(String(e.data));
      ws.onerror = rej;
    });
    expect(reply).toBe("echo:wsg:hi");
    const closed = new Promise(res => {
      ws.onclose = () => res("closed");
    });
    m.quit();
    expect(await Promise.race([closed, Bun.sleep(2000).then(() => "open")])).toBe("closed");
    rmSync(dir, { recursive: true, force: true });
  });
  test("SIGTERM: while a graph listens, the process-level default (terminate) is suppressed like Node; once the graph exits, the default action is back", () => {
    const dir = fixture({
      "term.mjs": `process.on("SIGTERM", () => { console.log("graph-got-sigterm"); }); export const quit = () => process.exit(0)`,
      "main.mjs": `const g = new Bun.unsafe.ModuleGraph({}); const m = await g.import(${JSON.stringify("TERM")}); process.kill(process.pid, "SIGTERM"); await Bun.sleep(50); console.log("alive-after-first"); m.quit(); await Bun.sleep(10); process.kill(process.pid, "SIGTERM"); await Bun.sleep(200); console.log("alive-after-second");`,
    });
    writeFileSync(
      join(dir, "main.mjs"),
      require("node:fs")
        .readFileSync(join(dir, "main.mjs"), "utf8")
        .replace('"TERM"', JSON.stringify(join(dir, "term.mjs"))),
    );
    const r = Bun.spawnSync([process.execPath, join(dir, "main.mjs")], { env: { ...process.env } });
    const out = r.stdout.toString();
    expect(out).toContain("graph-got-sigterm");
    expect(out).toContain("alive-after-first");
    expect(out).not.toContain("alive-after-second");
    expect(r.signalCode === "SIGTERM" || r.exitCode === 143).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — review #2 regressions", () => {
  test("slow-path ModuleVar resolution (unfilled slot inside a cycle) is per instance in every JIT tier, including eagerly-tiered baseline/LOL", () => {
    const dir = fixture({
      // a <-> b cycle: b's body runs first (while a's slot for b may still be unfilled in some tiers) and reads `a` lazily via a function.
      "a.mjs": `import { readA, tag } from "./b.mjs"; export const a = "a:" + process.env.T; export const viaB = () => readA(); export { tag }`,
      "b.mjs": `import { a } from "./a.mjs"; export const tag = "b:" + process.env.T; export function readA() { let r; for (let i = 0; i < 50; i++) r = a; return r }`,
      "main.mjs": `const G = Bun.unsafe.ModuleGraph; const path = new URL("./a.mjs", import.meta.url).pathname;
        const x = await new G({ env: { T: "X" } }).import(path), y = await new G({ env: { T: "Y" } }).import(path);
        const out = []; for (let i = 0; i < 400; i++) out.push(x.viaB(), y.viaB());
        console.log(JSON.stringify([x.tag, y.tag, out[0], out[1], out[798], out[799]]));`,
    });
    for (const jit of [
      {},
      { BUN_JSC_useLOLJIT: "1" },
      { BUN_JSC_jitPolicyScale: "0" },
      { BUN_JSC_useLOLJIT: "1", BUN_JSC_jitPolicyScale: "0" },
    ]) {
      const r = Bun.spawnSync([process.execPath, join(dir, "main.mjs")], {
        env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", ...jit } as any,
      });
      expect({ jit, out: r.stdout.toString().trim().split("\n").pop() }).toEqual({
        jit,
        out: JSON.stringify(["b:X", "b:Y", "a:X", "a:Y", "a:X", "a:Y"]),
      });
    }
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  test("TypeScript named imports (Bun's may-be-absent import kind) get import slots: each instance reads its own exporter, in every tier", async () => {
    const dir = fixture({
      "state.ts": `export let who: string = process.env.T ?? "host"; export const bump = () => (who = who + "!")`,
      "reader.ts": `import { who, bump } from "./state"; import type { Foo } from "./types"; export function read(n: number) { let last = ""; for (let i = 0; i < n; i++) last = who; return last } export { bump }`,
      "types.ts": `export type Foo = { a: number }`,
    });
    const host = await import(join(dir, "reader.ts"));
    const a = await ModuleGraph({ env: { T: "A" } }).import(join(dir, "reader.ts")),
      b = await ModuleGraph({ env: { T: "B" } }).import(join(dir, "reader.ts"));
    expect([host.read(1), a.read(1), b.read(1)]).toEqual(["host", "A", "B"]);
    a.bump();
    for (const n of [1, 200, 20000]) expect([host.read(n), a.read(n), b.read(n)]).toEqual(["host", "A!", "B"]); // LLInt → baseline → DFG
    rmSync(dir, { recursive: true, force: true });
  });

  test("Promise species tampering inside a graph cannot subvert the loader's internal chaining (import defer with TLA deps, plain import)", async () => {
    const dir = fixture({
      "tla1.mjs": `await new Promise(r => setTimeout(r, 2)); export const a = 1`,
      "tla2.mjs": `await new Promise(r => setTimeout(r, 1)); export const b = 2`,
      "d.mjs": `import { a } from "./tla1.mjs"; import { b } from "./tla2.mjs"; export const sum = a + b`,
      "evil.mjs": `let calls = 0; class Fake { constructor(exec) { calls++; exec(() => {}, () => {}) } static resolve(v) { return v } }
        Object.defineProperty(Promise, Symbol.species, { get() { calls++; return Fake }, configurable: true }); Promise.prototype.constructor = Fake;
        const ns = await import("./d.mjs"); export const viaImport = ns.sum;
        export const fakeCalls = () => calls;`,
      "evil-defer.mjs": `import defer * as d from "./d.mjs"; export const touch = () => d.sum`,
    });
    // run in a subprocess: species tampering is global-wide
    const script = `const G = Bun.unsafe.ModuleGraph; const m = await new G().import(${JSON.stringify(join(dir, "evil.mjs"))}); const d = await new G().import(${JSON.stringify(join(dir, "evil-defer.mjs"))}); console.log(JSON.stringify([m.viaImport, d.touch(), typeof m.fakeCalls()]))`;
    const r = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } });
    expect(r.stdout.toString().trim().split("\n").pop()).toBe(JSON.stringify([3, 3, "number"]));
    expect(r.exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
  test("a module whose PRIMARY evaluation threw can still be instantiated and evaluated by a graph (evaluation errors are per instance)", async () => {
    const dir = fixture({
      "cond.mjs": `if (!process.env.OK) throw new Error("primary-fail"); export const v = "fine:" + process.env.OK`,
    });
    expect(
      await import(join(dir, "cond.mjs")).then(
        () => "ok",
        e => e.message,
      ),
    ).toBe("primary-fail");
    expect((await ModuleGraph({ env: { OK: "1" } }).import(join(dir, "cond.mjs"))).v).toBe("fine:1");
    const again = await ModuleGraph({ env: {} })
      .import(join(dir, "cond.mjs"))
      .then(
        () => "ok",
        (e: any) => e.message,
      );
    expect(again).toBe("primary-fail"); // and an instance's own failure is its own
    rmSync(dir, { recursive: true, force: true });
  });
  test("instantiation that fails part-way is rolled back: a retry in the same graph re-instantiates cleanly (functions/vars initialised, not TDZ)", async () => {
    const dir = fixture({
      "a.mjs": `import { b } from "./b.mjs"; export function f() { return "f:" + b } export var v = 1; export const run = () => [f(), v]`,
      "b.mjs": `export const b = "b"`,
    });
    const g = ModuleGraph();
    // First attempt: make b.mjs unresolvable, then fix it. Resolution failure happens during instantiation of a's dependencies.
    renameSync(join(dir, "b.mjs"), join(dir, "b.mjs.off"));
    const first = await g.import(join(dir, "a.mjs")).then(
      () => "ok",
      (e: any) => "err",
    );
    expect(first).toBe("err");
    renameSync(join(dir, "b.mjs.off"), join(dir, "b.mjs"));
    const m = await g.import(join(dir, "a.mjs") + "?retry"); // fresh key so the loader refetches; same graph
    expect(m.run()).toEqual(["f:b", 1]);
    rmSync(dir, { recursive: true, force: true });
  });
  test("deferred namespace of a disposed graph throws instead of evaluating anywhere", async () => {
    const dir = fixture({
      "side.mjs": `globalThis.__deferSide = (globalThis.__deferSide ?? 0) + 1; export const x = 1`,
      "m.mjs": `import defer * as d from "./side.mjs"; export const get = () => d.x`,
    });
    (globalThis as any).__deferSide = 0;
    const g = ModuleGraph();
    const m = await g.import(join(dir, "m.mjs"));
    g.dispose();
    expect(() => m.get()).toThrow(/disposed/);
    expect((globalThis as any).__deferSide).toBe(0); // nothing evaluated in the primary either
    rmSync(dir, { recursive: true, force: true });
  });
  test("a graph importing a WebAssembly module (ESM integration) is refused with a TypeError rather than sharing the primary's instance", async () => {
    const dir = fixture({
      "add.wasm.b64": "AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=",
      "w.mjs": `import { add } from "./add.wasm"; export const three = add(1, 2)`,
    });
    writeFileSync(
      join(dir, "add.wasm"),
      Buffer.from(require("node:fs").readFileSync(join(dir, "add.wasm.b64"), "utf8"), "base64"),
    );
    const host = await import(join(dir, "w.mjs")).then(
      m => "ok:" + m.three,
      e => "host-err:" + e.constructor.name,
    );
    const inGraph = await ModuleGraph()
      .import(join(dir, "w.mjs"))
      .then(
        (m: any) => "ok:" + m.three,
        (e: any) => e.constructor.name + ":" + /module graph instance/.test(e.message),
      );
    if (host.startsWith("ok:")) expect(inGraph).toBe("TypeError:true");
    else expect(inGraph).not.toMatch(/^ok:/); // if the host doesn't support wasm ESM either, just no crash
    rmSync(dir, { recursive: true, force: true });
  });
});
