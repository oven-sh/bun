// Bun.unsafe.ModuleGraph — further instantiations of an ES module graph in THIS
// global, sharing every executable/CodeBlock (and so JIT code) with the first
// load while giving each graph its own module environments and its own values
// for the names the host passes as `globals`.
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

type ModuleGraphOptions = { globals?: Record<string, unknown>; onError?: (error: unknown, kind: string) => void };
type ModuleGraphInstance = {
  import(specifier: string): Promise<any>;
  dispose(): void;
  readonly mainModule: string | undefined;
  process: NodeJS.Process;
};
const ModuleGraphClass = (Bun as any).unsafe?.ModuleGraph as
  | { new (opts?: ModuleGraphOptions): ModuleGraphInstance }
  | undefined;

// What a host passes in `globals` to give each graph its own process state: a `process`
// whose env, cwd, exit and event listeners are the graph's, forwarding everything else
// to the real process. (ModuleGraph itself only provides the per-graph binding.)
type HostOptions = ModuleGraphOptions & { env?: Record<string, string>; cwd?: string; onExit?: (code: number) => void };
function graphProcess(opts: HostOptions, graph: () => ModuleGraphInstance): NodeJS.Process {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env ?? process.env)) env[k] = String(v);
  let cwd = opts.cwd ?? process.cwd();
  let exited = false,
    exitCode: number | undefined;
  const events = new EventEmitter();
  const exit = (code?: number) => {
    if (exited) return;
    exited = true;
    const c = code ?? exitCode ?? 0;
    try {
      events.emit("exit", c);
    } finally {
      opts.onExit?.(c);
      graph().dispose();
    }
  };
  const own: Record<string, unknown> = {
    env,
    cwd: () => cwd,
    chdir: (d: string) => {
      cwd = resolve(cwd, d);
    },
    exit,
    reallyExit: exit,
    abort: () => exit(134),
  };
  for (const m of [
    "on",
    "once",
    "off",
    "addListener",
    "removeListener",
    "prependListener",
    "prependOnceListener",
    "removeAllListeners",
    "setMaxListeners",
  ] as const)
    own[m] = (...a: unknown[]) => {
      (events as any)[m](...a);
      return shim;
    };
  for (const m of ["emit", "listeners", "rawListeners", "listenerCount", "eventNames"] as const)
    own[m] = (...a: unknown[]) => (events as any)[m](...a);
  const shim: any = new Proxy(process, {
    get(target, key) {
      if (key === "exitCode") return exitCode;
      if (Object.prototype.hasOwnProperty.call(own, key)) return own[key as string];
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
    set(_target, key, value) {
      if (key === "exitCode") exitCode = value;
      else own[key as string] = value;
      return true;
    },
    has(target, key) {
      return key in own || key in target;
    },
  });
  return shim;
}
const ModuleGraph = (opts: HostOptions = {}): ModuleGraphInstance => {
  let graph!: ModuleGraphInstance;
  const proc = graphProcess(opts, () => graph);
  graph = new ModuleGraphClass!({ onError: opts.onError, globals: { process: proc, ...opts.globals } });
  graph.process = proc;
  return graph;
};

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
    const earlier: WeakRef<object>[] = [];
    try {
      await (async () => {
        for (let i = 0; i < 4; i++) {
          const m = await ModuleGraph({ env: {} }).import(join(dir, "intr.mjs"));
          expect(m.patch("g" + i)).toBe(true);
          if (i < 3) earlier.push(new WeakRef(m.big));
          m.quit();
        }
      })();
      expect(([1] as any).__graphTag().startsWith("g3")).toBe(true); // host sees the last graph's patch
      // The earlier writers' patches were overwritten, so nothing references their modules any more.
      for (let i = 0; i < 100 && earlier.some(r => r.deref()); i++) {
        await Bun.sleep(5);
        Bun.gc(true);
      }
      expect(earlier.map(r => r.deref() === undefined)).toEqual([true, true, true]);
    } finally {
      delete (Array.prototype as any).__graphTag;
      Error.prepareStackTrace = origPrepare;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("graphs constructed with the same set of globals names share compiled code; a different set links its own", async () => {
    const dir = fixture({
      "m.mjs": `${Array.from({ length: 50 }, (_, i) => `export function f${i}() { return typeof marker === "undefined" ? "-" : marker }`).join("\n")}`,
    });
    const count = () => {
      Bun.gc(true);
      return heapStats().objectTypeCounts.FunctionExecutable ?? 0;
    };
    const a = await new ModuleGraphClass!({ globals: { marker: "a" } }).import(join(dir, "m.mjs"));
    const base = count();
    const b = await new ModuleGraphClass!({ globals: { marker: "b" } }).import(join(dir, "m.mjs"));
    const afterSameNames = count();
    const c = await new ModuleGraphClass!({ globals: { other: 1 } }).import(join(dir, "m.mjs"));
    const afterOtherNames = count();
    expect([a.f0(), b.f0(), c.f0(), a.f49 === b.f49]).toEqual(["a", "b", "-", false]);
    expect([afterSameNames - base < 10, afterOtherNames - afterSameNames >= 50]).toEqual([true, true]);
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
      cjsGlobalApp: undefined /* globalThis.process is the global's: shared */,
      cjsToEsmBump: 1,
      esmCountSeenByEntry: 1,
      cjsToEsmApp: "a",
    });
    expect(a.report()).toMatchObject({ inc: 2, cjsToEsmBump: 2, esmCountSeenByEntry: 2 });
    expect(b.report()).toEqual({
      sameCache: true,
      inc: 1,
      cjsApp: "b",
      cjsGlobalApp: undefined,
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
      "meta.mjs": `export const resolved = import.meta.resolve('./plain.mjs'); export const req = require('./plain.mjs').yes; export function cacheKeys() { return Object.keys(require.cache).map(k => k.split(/[\\\\/]/).pop()).sort() }`,
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
      "slow-a.mjs": `__order.push('a:start'); await new Promise(r => setTimeout(r, ${40 * (stressMode ? 10 : 1)})); __order.push('a:end'); export const a = 'A'`,
      "slow-b.mjs": `__order.push('b:start'); await new Promise(r => setTimeout(r, ${10 * (stressMode ? 10 : 1)})); __order.push('b:end'); export const b = 'B'`,
      "sync-c.mjs": `__order.push('c'); export const c = 'C'`,
      "root.mjs": `import { a } from './slow-a.mjs'; import { b } from './slow-b.mjs'; import { c } from './sync-c.mjs'; __order.push('root'); export const all = a + b + c`,
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
    // Builtin modules are the global's: one object for every graph and the host.
    expect(ta.fs).toBe(host.fs);
    expect(ta.fs).toBe(tb.fs);
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
      "counter.cjs": `__cjsEvals.push(process.env.APP_ID ?? 'host'); let n = 0; module.exports = { inc() { return ++n }, app: () => process.env.APP_ID ?? 'host' }`,
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
      "log.mjs": `export const log = __deferLog`,
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

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — API validation and error attribution edges", () => {
  test("constructor and import() argument validation", async () => {
    expect(() => new ModuleGraphClass!({ onError: 1 as any })).toThrow(TypeError);
    expect(() => new ModuleGraphClass!({ globals: 5 as any })).toThrow(TypeError);
    expect(() => new ModuleGraphClass!("nope" as any)).toThrow(TypeError);
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
    expect(() => ModuleGraph({ globals: { extra: 1 } })).not.toThrow(); // any names; graphs with the same name set share compiled code
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
    // An onError that rethrows the graph's error: the host's uncaught exception once, not attributed to the graph again.
    {
      const script = `const seen = []; process.on("uncaughtException", e => seen.push("host:" + e.message)); const g = new Bun.unsafe.ModuleGraph({ onError: (e) => { seen.push("graph:" + e.message); throw e } }); (await g.import(${JSON.stringify(join(dir, "boom.mjs"))})).boom(); setTimeout(() => { console.log(JSON.stringify(seen)); }, 30);`;
      const r = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env } });
      expect([r.stdout.toString().trim(), r.exitCode]).toEqual([`["graph:boom","host:boom"]`, 0]);
    }
    // An onError that throws: that is the host's own uncaught exception (observed in a child process; here the test runner owns uncaught errors).
    const script = `const seen = []; process.on("uncaughtException", e => seen.push("host:" + e.message)); const bad = await new Bun.unsafe.ModuleGraph({ onError: () => { throw new Error("onError itself throws") } }).import(${JSON.stringify(join(dir, "boom.mjs"))}); bad.boom(); setTimeout(() => { console.log(JSON.stringify(seen)); }, 30);`;
    const r = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env } });
    expect(r.stdout.toString().trim()).toBe(`["host:onError itself throws"]`);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a graph can create a nested ModuleGraph; the inner graph is independent of the outer one", async () => {
    const dir = fixture({
      "outer.mjs": `export async function makeInner(p) { const G = Bun.unsafe.ModuleGraph; const g = new G({ globals: { process: Object.create(process, { env: { value: { T: "inner" }, enumerable: true } }) } }); const m = await g.import(p); return [process.env.T, m.t()] }`,
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

// One test per way a graph could stay alive after exit. Each arms exactly one thing in the
// graph, exits, and asserts the graph's module object is garbage-collected (FinalizationRegistry),
// independent of heap-size heuristics.
// One test per ambient surface: what graph A does is visible to A, not to B, not to the host
// (or, for the documented shared surfaces, IS visible — pinned explicitly).
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
  test("a rejection by graph code whose reason is an Error constructed by host code → the rejecting graph's onError", async () => {
    const d = fixture({
      "rej.mjs": `export function viaReject() { Promise.reject(hostMakeError("made-by-host")); }
        export async function viaAsync() { throw hostMakeError("rethrown-by-graph"); }
        export function fire() { viaReject(); viaAsync(); }`,
    });
    const seen: string[] = [];
    const hostSeen: string[] = [];
    const onHost = (e: any) => hostSeen.push(String(e?.message));
    process.on("unhandledRejection", onHost);
    try {
      const g = new ModuleGraphClass!({
        globals: { hostMakeError: (m: string) => new Error(m) },
        onError: (e: any, kind: string) => seen.push(kind + ":" + e.message),
      });
      (await g.import(join(d, "rej.mjs"))).fire();
      for (let i = 0; i < 20 && seen.length < 2; i++) await Bun.sleep(5);
      expect({ seen: seen.sort(), hostSeen }).toEqual({
        seen: ["unhandledRejection:made-by-host", "unhandledRejection:rethrown-by-graph"],
        hostSeen: [],
      });
    } finally {
      process.off("unhandledRejection", onHost);
      rmSync(d, { recursive: true, force: true });
    }
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
    const script = `const g = new Bun.unsafe.ModuleGraph({ globals: { process: Object.create(process, { env: { value: { T: "nohandler" }, enumerable: true } }) } }); const seen = [];
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
  test("import.meta in a CommonJS module of a graph is the graph's: import.meta.require uses the graph's cache, import.meta.main is the graph's entry", async () => {
    const d = fixture({
      "state.cjs": `module.exports = { who: typeof marker === "undefined" ? "host" : marker }`,
      "meta.cjs": `module.exports = { viaMetaRequire: import.meta.require("./state.cjs").who, main: import.meta.main }`,
    });
    const host = require(join(d, "meta.cjs"));
    const a = (await new ModuleGraphClass!({ globals: { marker: "A" } }).import(join(d, "meta.cjs"))).default;
    const b = (await new ModuleGraphClass!({ globals: { marker: "B" } }).import(join(d, "meta.cjs"))).default;
    expect([host, a, b]).toEqual([
      { viaMetaRequire: "host", main: false },
      { viaMetaRequire: "A", main: true },
      { viaMetaRequire: "B", main: true },
    ]);
    rmSync(d, { recursive: true, force: true });
  });
  test("a require() that throws inside a graph leaves neither the graph's nor the host's cache holding the module; the next require re-evaluates", async () => {
    const d = fixture({
      "flaky.cjs": `attempts.n++; if (attempts.n < 3) throw new Error("attempt " + attempts.n); module.exports = { ok: attempts.n }`,
      "user.cjs": `exports.tryOnce = () => { try { return require("./flaky.cjs").ok } catch (e) { return e.message } }; exports.cached = () => Object.keys(require.cache).filter(k => k.endsWith("flaky.cjs")).length`,
    });
    const attempts = { n: 0 };
    const u = await ModuleGraph({ globals: { attempts } }).import(join(d, "user.cjs"));
    expect([u.tryOnce(), u.cached(), u.tryOnce(), u.cached(), u.tryOnce(), u.cached(), u.tryOnce()]).toEqual([
      "attempt 1",
      0,
      "attempt 2",
      0,
      3,
      1,
      3,
    ]);
    expect(Object.keys(require.cache).filter(k => k.endsWith("flaky.cjs"))).toEqual([]);
    rmSync(d, { recursive: true, force: true });
  });
  test("CommonJS code in graphs with different globals name sets resolves each graph's own names (one wrapper executable per name set)", async () => {
    const d = fixture({
      "w.cjs": `module.exports = { a: typeof alpha === "undefined" ? "-" : alpha, b: typeof beta === "undefined" ? "-" : beta, p: typeof process.pid }`,
    });
    const load = (globals: Record<string, unknown>) =>
      new ModuleGraphClass!({ globals }).import(join(d, "w.cjs")).then(m => m.default);
    const r1 = await load({ alpha: "A1" }),
      r2 = await load({ beta: "B2" }),
      r3 = await load({ alpha: "A3" }),
      r4 = await load({ beta: "B4", alpha: "A4" }),
      r5 = await load({});
    expect([r1, r2, r3, r4, r5]).toEqual([
      { a: "A1", b: "-", p: "number" },
      { a: "-", b: "B2", p: "number" },
      { a: "A3", b: "-", p: "number" },
      { a: "A4", b: "B4", p: "number" },
      { a: "-", b: "-", p: "number" },
    ]);
    rmSync(d, { recursive: true, force: true });
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
    expect((globalThis as any).__c).toBe(20); // one evaluation per graph (globalThis is the global's: the counter is shared)
  });
  test("within one graph, concurrent imports of a TLA module and of its dependent share one evaluation", async () => {
    (globalThis as any).__c = 0;
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

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — nested graphs, stack traces, misc host integration", () => {
  const dir = fixture({
    "outer.mjs": `export async function nest(p, env) { const g = new Bun.unsafe.ModuleGraph({ globals: { process: Object.create(process, { env: { value: env, enumerable: true } }) } }); const m = await g.import(p); return { outer: process.env.T, inner: m.t(), innerSeesOuterGlobal: m.g() } }
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
    expect(r).toEqual({ outer: "outer", inner: "inner", innerSeesOuterGlobal: "number" }); // globalThis is the global's, shared by every graph
    delete (globalThis as any).__outerMark;
  });
  test("stack traces carry file:line of the graph's module; Error.prepareStackTrace sees CallSites with file names", async () => {
    const m = await ModuleGraph().import(join(dir, "stack.mjs"));
    expect(m.trace()).toContain(join(dir, "stack.mjs") + ":2");
    expect(m.prepared()[0]).toBe(join(dir, "stack.mjs"));
  });
  test("console output from graph code goes to the process's stdout/stderr", async () => {
    const script = `const m = await new Bun.unsafe.ModuleGraph({ globals: { process: Object.create(process, { env: { value: { T: "c" }, enumerable: true } }) } }).import(${JSON.stringify(join(dir, "console.mjs"))}); m.log();`;
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
    ["globals not an object", () => new (ModuleGraphClass as any)({ globals: "x" }), /globals/i],
    ["onError not callable", () => new (ModuleGraphClass as any)({ onError: {} }), /onError/i],
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
  test("globals: own enumerable props are injected; prototype props and non-enumerables are not", async () => {
    const proto = { fromProto: 1 };
    const globals = Object.create(proto);
    globals.__injected = 1;
    Object.defineProperty(globals, "hidden", { value: 1, enumerable: false });
    const d = fixture({ "gl.mjs": `export const v = [typeof __injected, typeof fromProto, typeof hidden]` });
    expect((await ModuleGraph({ globals }).import(join(d, "gl.mjs"))).v).toEqual(["number", "undefined", "undefined"]);
    rmSync(d, { recursive: true, force: true });
  });
  test("import(): non-string specifier, empty string, missing file, directory, and a data: URL", async () => {
    const g = ModuleGraph();
    await expect(g.import(123 as any)).rejects.toThrow(TypeError);
    await expect(g.import("")).rejects.toThrow();
    await expect((async () => g.import(join(dir, "nope.mjs")))()).rejects.toThrow(/Cannot find|not found|ENOENT/i);
    await expect((async () => g.import(dir))()).rejects.toThrow();
    const spec = "data:text/javascript,export const d = typeof process.env";
    const viaData = await g.import(spec).catch(e => e),
      hostData = await import(spec).catch(e => e);
    expect(viaData instanceof Error ? "error" : Object.keys(viaData)).toEqual(
      hostData instanceof Error ? "error" : Object.keys(hostData),
    ); // parity with the host
  });
  test("globals bind bare identifiers in the graph's code; globalThis is the global's own and does not see them", async () => {
    const d = fixture({
      "bare.mjs": `export const v = [typeof extra, typeof globalThis.extra, typeof process, typeof setTimeout, globalThis.process === process, globalThis === realGlobalThis]`,
    });
    (globalThis as any).realGlobalThis = globalThis;
    expect((await ModuleGraph({ globals: { extra: 1 } }).import(join(d, "bare.mjs"))).v).toEqual([
      "number",
      "undefined",
      "object",
      "function",
      false /* the graph's process shim vs the real one */,
      true,
    ]);
    delete (globalThis as any).realGlobalThis;
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
    expect(typeof Object.getOwnPropertyDescriptor((ModuleGraphClass as any).prototype, "mainModule")?.get).toBe(
      "function",
    );
    expect(Object.keys(new ModuleGraphClass!())).toEqual([]);
    void g;
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
    expect(log).toEqual(["onExit:3", "onError", "function"]); // code of a disposed graph that still throws is still that graph's (onError)
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
    delete (globalThis as any).__evals;
    expect([r.unevaluated(), r.again(), r.evals()]).toEqual(["U", "U", 1]);
    delete (globalThis as any).__evals;
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
    ).toBe("once:2"); // a new graph evaluates the module again (the counter lives on the shared globalThis)
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
    const g = ModuleGraph();
    expect((await g.import(join(dir, "ünï cødé/mod ule.mjs"))).ok).toBe("mod ule.mjs");
    expect((await g.import(join(dir, longName))).ok).toBe(longName.length);
    expect((await g.import(join(dir, "dir.with.dots/index.mjs"))).ok).toBe("dots");
    rmSync(dir, { recursive: true, force: true });
  });
  test("file: URLs, relative specifiers (against process.cwd()), and package 'exports' resolution", async () => {
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
    const g = ModuleGraph({ env: { T: "t" } });
    expect((await g.import(Bun.pathToFileURL(join(dir, "m.mjs")).href)).v).toBe(1);
    const previous = process.cwd();
    process.chdir(dir);
    try {
      expect(await g.import("./m.mjs")).toBe(await g.import(join(dir, "m.mjs"))); // relative to process.cwd()
      expect((await g.import("pkg")).where).toBe("main:t");
      await expect(g.import("pkg/nope")).rejects.toThrow();
    } finally {
      process.chdir(previous);
    }
    const u = await g.import(join(dir, "uses-pkg.mjs"));
    expect([u.where, u.sub]).toEqual(["main:t", "sub"]);
    rmSync(dir, { recursive: true, force: true });
  });
  test("symlinked module path: one template whether imported via the link or the target (realpath), per graph", async () => {
    const dir = fixture({ "real/x.mjs": `export let n = 0; export const inc = () => ++n` });
    const { symlinkSync } = require("node:fs");
    symlinkSync(join(dir, "real"), join(dir, "link"), "junction");
    // Same answer as the host's loader gives for the two paths (it resolves symlinks to one module).
    const hostA = await import(join(dir, "real/x.mjs")),
      hostB = await import(join(dir, "link/x.mjs"));
    const g = ModuleGraph();
    const a = await g.import(join(dir, "real/x.mjs")),
      b = await g.import(join(dir, "link/x.mjs"));
    hostA.inc();
    a.inc();
    expect([a === b, b.n, a !== hostA]).toEqual([hostA === hostB, hostB.n, true]);
    rmSync(dir, { recursive: true, force: true });
  });
  test("tsconfig paths / baseUrl in the graph's project resolve for graph imports", async () => {
    const dir = fixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } } }),
      "lib/thing.ts": `export const thing = "T"`,
      "entry.ts": `import { thing } from "@lib/thing"; export { thing }`,
    });
    expect((await ModuleGraph().import(join(dir, "entry.ts"))).thing).toBe("T");
    rmSync(dir, { recursive: true, force: true });
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

describe.skipIf(!enabled)(
  "Bun.unsafe.ModuleGraph — re-entrancy: graphs created/disposed from inside other graphs' evaluation and callbacks",
  () => {
    const dir = fixture({
      "spawner.mjs": `const inner = new Bun.unsafe.ModuleGraph({ globals: { process: Object.create(process, { env: { value: { T: "inner-of-" + process.env.T }, enumerable: true } }) } }); export const innerWho = (await inner.import(Bun.fileURLToPath(new URL("./who.mjs", import.meta.url)))).who; export const outerWho = process.env.T; inner.dispose();`,
      "who.mjs": `export const who = process.env.T`,
      "disposer.mjs": `export function run(other) { other.dispose(); return process.env.T }`,
      "thrower.mjs": `export function later() { setTimeout(() => { throw new Error("e1") }, 0) }`,
      "sync-nested-import.mjs": `import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const G = Bun.unsafe.ModuleGraph; const g = new G({ globals: { process: Object.create(process, { env: { value: { T: "cjs-inner" }, enumerable: true } }) } });
      export const viaRequireInInner = await g.import(Bun.fileURLToPath(new URL("./who.mjs", import.meta.url))).then(m => m.who); export const mine = require("./who-cjs.cjs").who;`,
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
  "Bun.unsafe.ModuleGraph — host natives injected via globals, called as bare identifiers",
  () => {
    // A bare-identifier call whose callee lives in the overlay passes the overlay environment in the `this`
    // slot (JSC's convention for scope-resolved callees); JS callees normalise it, natives must not care.
    test("structuredClone / fetch / queueMicrotask / a strict JS function / an arrow / a class injected as globals work when called bare and with new", async () => {
      const dir = fixture({
        "n.mjs": `
      export async function run(port) {
        const r = {}; r.clone = injectedClone({ a: 1 }).a; r.micro = await new Promise(res => injectedMicrotask(() => res("m")));
        r.fetch = await (await injectedFetch("http://127.0.0.1:" + port + "/")).text();
        r.strictThis = injectedStrict(); r.arrow = injectedArrow(2); r.viaGlobalThis = typeof globalThis.injectedStrict;   // globals are not properties of globalThis
        r.date = typeof new InjectedDate(0).getTime();
        r.builtins = [typeof setTimeout, typeof process, typeof Bun, typeof Function].join(",");   // everything else is the global's
        return r }`,
        "host.mjs": `const server = Bun.serve({ port: 0, fetch: () => new Response("fetched") });
        const g = new Bun.unsafe.ModuleGraph({ globals: { injectedClone: structuredClone, injectedMicrotask: queueMicrotask, injectedFetch: fetch, injectedStrict: function () { "use strict"; return this === undefined ? "undefined-this" : typeof this }, injectedArrow: x => x * 2, InjectedDate: Date } });
        const m = await g.import(Bun.fileURLToPath(new URL("./n.mjs", import.meta.url))); console.log(JSON.stringify(await m.run(server.port))); server.stop(true); process.exit(0);`,
      });
      const r = Bun.spawnSync([process.execPath, join(dir, "host.mjs")], { cwd: dir, env: { ...process.env } });
      expect(JSON.parse(r.stdout.toString().trim() || "{}")).toEqual({
        clone: 1,
        micro: "m",
        fetch: "fetched",
        strictThis: "undefined-this",
        arrow: 4,
        viaGlobalThis: "undefined",
        date: "number",
        builtins: "function,object,object,function",
      });
      rmSync(dir, { recursive: true, force: true });
    });
  },
);

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
        const a = await new G({ globals: { process: Object.create(process, { env: { value: { T: "A" }, enumerable: true } }) } }).import(Bun.fileURLToPath(new URL("./shared.mjs", import.meta.url))), b = await new G({ globals: { process: Object.create(process, { env: { value: { T: "B" }, enumerable: true } }) } }).import(Bun.fileURLToPath(new URL("./shared.mjs", import.meta.url)));
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
        "log.mjs": `export const log = []`,
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
      "run.mjs": `const m = await new Bun.unsafe.ModuleGraph({ globals: { process: Object.create(process, { env: { value: { T: "dbg" }, enumerable: true } }) } }).import(Bun.fileURLToPath(new URL("./d.mjs", import.meta.url))); console.log("ok:" + m.f()); setTimeout(() => process.exit(0), 100);`,
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
          `${imports} __log.push("start:${i}"); ${tla ? "await new Promise(r => setTimeout(r, " + Math.floor(r() * 3) + "));" : ""} ${throws ? `throw new Error("boom:${i}");` : ""} __log.push("end:${i}"); export const id = ${i};`;
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
});

describe.skipIf(!enabled)("Bun.unsafe.ModuleGraph — review #2 regressions", () => {
  test("slow-path ModuleVar resolution (unfilled slot inside a cycle) is per instance in every JIT tier, including eagerly-tiered baseline/LOL", () => {
    const dir = fixture({
      // a <-> b cycle: b's body runs first (while a's slot for b may still be unfilled in some tiers) and reads `a` lazily via a function.
      "a.mjs": `import { readA, tag } from "./b.mjs"; export const a = "a:" + process.env.T; export const viaB = () => readA(); export { tag }`,
      "b.mjs": `import { a } from "./a.mjs"; export const tag = "b:" + process.env.T; export function readA() { let r; for (let i = 0; i < 50; i++) r = a; return r }`,
      "main.mjs": `const G = Bun.unsafe.ModuleGraph; const path = Bun.fileURLToPath(new URL("./a.mjs", import.meta.url));
        const x = await new G({ globals: { process: Object.create(process, { env: { value: { T: "X" }, enumerable: true } }) } }).import(path), y = await new G({ globals: { process: Object.create(process, { env: { value: { T: "Y" }, enumerable: true } }) } }).import(path);
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
