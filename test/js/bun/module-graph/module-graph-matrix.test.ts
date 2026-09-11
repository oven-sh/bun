// Bun.unsafe.ModuleGraph — permutation suite.
//
// Systematic coverage rather than scenario tests: every (site × target × ordering) combination of
// dynamic import() across several instances of the same graph, shared-code correctness across
// instances once functions are JIT-compiled, static graph shapes instantiated repeatedly, and
// lifecycle/error orderings. Each test records everything it observes into one value and compares it
// against the fully spelled-out expectation.
//
import { numberOfDFGCompiles } from "bun:jsc";
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

type ModuleGraphOptions = NonNullable<ConstructorParameters<typeof Bun.unsafe.ModuleGraph>[0]>;
type Graph = InstanceType<typeof Bun.unsafe.ModuleGraph>;
const ModuleGraphClass: typeof Bun.unsafe.ModuleGraph | undefined = Bun.unsafe?.ModuleGraph;
const enabled = typeof ModuleGraphClass === "function";

/** A temporary directory with `files` (harness tempDir), as a plain path. */
function fixture(files: Record<string, string>): string {
  return String(tempDir("module-graph-matrix-", files));
}

/** A graph whose modules see `process.env.WHO === who` (a host-made `process` passed in `globals`,
 *  as a host gives each graph its own process state) and can append to the host-side `log`. */
function graph(who: string, log: string[], extra: ModuleGraphOptions = {}): Graph {
  const proc = Object.create(process, {
    env: { value: { ...process.env, WHO: who }, enumerable: true, writable: true },
  });
  return new ModuleGraphClass!({ ...extra, globals: { process: proc, __log: log, ...extra.globals } });
}

const errorName = (e: unknown) => (e instanceof Error ? e.constructor.name : typeof e);

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 1. Dynamic import(): site × target × ordering across instances
// ───────────────────────────────────────────────────────────────────────────────────────────────
//
// Every target module reports which instance evaluated it (`who`), appends one line to the shared host
// log when it evaluates inside a graph (so evaluations per instance are counted exactly; the host has no
// `__log`), carries mutable state (`n`/`inc`) and can also be imported statically by the importer so
// namespace identity within an instance can be checked. Importers expose `dyn()` = "do the import() now".

const TARGET_BODY = (name: string) =>
  `(typeof __log !== "undefined" ? __log : undefined)?.push(${JSON.stringify(name)} + "@" + process.env.WHO);
   export const who = process.env.WHO; export let n = 0; export const inc = () => ++n;`;

type Target = {
  file: string;
  source: string;
  tag: string | null;
  who: (w: string | undefined) => unknown;
  mutable: boolean;
  missing?: boolean;
  shared?: boolean;
};
const targets: Record<string, Target> = {
  esmFresh: { file: "t-fresh.mjs", source: TARGET_BODY("fresh"), tag: "fresh", who: w => w, mutable: true },
  esmTla: {
    file: "t-tla.mjs",
    source: `await new Promise(r => setTimeout(r, 1)); ${TARGET_BODY("tla")}`,
    tag: "tla",
    who: w => w,
    mutable: true,
  },
  // itself dynamically imports another module during its own evaluation
  esmChain: {
    file: "t-chain.mjs",
    source: `export const inner = await import("./t-inner.mjs"); ${TARGET_BODY("chain")}`,
    tag: "chain",
    who: w => w,
    mutable: true,
  },
  // CommonJS modules are the global's: one module object for everyone (each graph's namespace for it wraps
  // the same exports), evaluated with the global's `process`
  cjs: {
    file: "t.cjs",
    source: `let n = 0; module.exports = { who: process.env.WHO, get n() { return n }, inc: () => ++n };`,
    tag: null,
    who: () => process.env.WHO,
    mutable: true,
    shared: true,
  },
  json: { file: "t.json", source: `{ "who": "json", "n": 0 }`, tag: null, who: () => "json", mutable: false },
  ts: {
    file: "t.ts",
    source: `${TARGET_BODY("ts")} export type T = number; const typed: T = 1; export { typed };`,
    tag: "ts",
    who: w => w,
    mutable: true,
  },
  // node builtins are the global's: one instance for everyone
  builtin: { file: "node:path", source: "", tag: null, who: () => undefined, mutable: false },
  missing: {
    file: "does-not-exist.mjs",
    source: "",
    tag: null,
    who: () => "unreachable",
    mutable: false,
    missing: true,
  },
};

// How the importer performs `import(T)`; `expr(T)` evaluates to a promise for the namespace.
type Site = { expr: (t: string) => string; eager?: boolean; hostScope?: boolean };
const sites: Record<string, Site> = {
  fnLazy: { expr: t => `import(${t})` },
  nestedClosures: { expr: t => `(() => (async () => (await (async () => import(${t}))()))())()` },
  classMethod: { expr: t => `new (class { m() { return import(${t}) } })().m()` },
  classStatic: { expr: t => `(class { static load() { return import(${t}) } }).load()` },
  directEval: { expr: t => `eval("import(" + JSON.stringify(${t}) + ")")` },
  timerCallback: { expr: t => `new Promise((res, rej) => setTimeout(() => import(${t}).then(res, rej), 0))` },
  microtask: { expr: t => `Promise.resolve().then(() => import(${t}))` },
  asyncGenerator: { expr: t => `(async function* () { yield await import(${t}) })().next().then(r => r.value)` },
  // require() and CommonJS code are the global's: import() inside a CommonJS helper loads through the global loader
  fromCjs: { expr: t => `require("./dyn-helper.cjs").load(${t})`, hostScope: true },
  // import() issued during the importer's own evaluation (top-level await)
  topLevelAwait: { expr: t => `import(${t})`, eager: true },
  // indirect eval and Function() code are global code: the host's scope, so they load through the host, not the graph
  indirectEval: { expr: t => `(0, eval)("import(" + JSON.stringify(${t}) + ")")`, hostScope: true },
  newFunction: { expr: t => `new Function("p", "return import(p)")(${t})`, hostScope: true },
};

// sequential:               create g0, run its import(), create g1, run it, ...
// firstRunsThenOthersExist: g0 runs its import() before g1/g2 exist, and again after they ran theirs
// createAllThen{Forward,Reverse}: every instance exists before any import() runs
// onlySomeRun:              g1 never performs its import(); g0/g2 do
// concurrent:               instances created and their import()s run concurrently
// host{First,Last}:         the host imports the target itself before / after the graphs
// disposeMiddleBefore:      g1 is disposed before its import() runs
const orderings = [
  "sequential",
  "firstRunsThenOthersExist",
  "createAllThenForward",
  "createAllThenReverse",
  "onlySomeRun",
  "concurrent",
  "hostFirst",
  "hostLast",
  "disposeMiddleBefore",
] as const;
type Ordering = (typeof orderings)[number];

describe.skipIf(!enabled)("ModuleGraph matrix: dynamic import() site × target × ordering", () => {
  const dir = fixture({
    "t-inner.mjs": TARGET_BODY("inner"),
    "dyn-helper.cjs": `module.exports.load = (p) => import(p);`,
    ...Object.fromEntries(
      Object.values(targets)
        .filter(t => t.source)
        .map(t => [t.file, t.source]),
    ),
  });
  const specOf = (t: Target) => JSON.stringify(t.file.startsWith("node:") ? t.file : join(dir, t.file));
  const importerName = (site: string, target: string) => `imp-${site}-${target}.mjs`;
  for (const [siteName, site] of Object.entries(sites)) {
    for (const [targetName, target] of Object.entries(targets)) {
      const spec = specOf(target);
      const staticImport =
        !target.missing && !site.eager
          ? `import * as statNs from ${spec}; export const stat = statNs;`
          : `export const stat = null;`;
      const body = site.eager
        ? `let e; try { e = await ${site.expr(spec)}; } catch (err) { e = { __rejected: err.constructor.name }; } export const dyn = () => Promise.resolve(e);`
        : `export const dyn = () => ${site.expr(spec)};`;
      writeFileSync(
        join(dir, importerName(siteName, targetName)),
        `${staticImport}\n${body}\nexport const who = process.env.WHO;`,
      );
    }
  }
  const K = 3;
  // the object carrying `who`/`n`/`inc`: the namespace, or `default` for CommonJS
  const api = (ns: any) =>
    ns && ns.default && typeof ns.default === "object" && "inc" in ns.default ? ns.default : ns;

  for (const [siteName, site] of Object.entries(sites)) {
    for (const [targetName, target] of Object.entries(targets)) {
      for (const ordering of orderings) {
        if (site.eager && !(["sequential", "concurrent", "hostFirst", "hostLast"] as Ordering[]).includes(ordering))
          continue;
        test(`${siteName} × ${targetName} × ${ordering}`, async () => {
          const log: string[] = [];
          const importer = join(dir, importerName(siteName, targetName));
          const whos = Array.from({ length: K }, (_, i) => `g${i}`);
          // host-scope sites run as host code, so disposing the graph does not affect them
          const disposed = (i: number) => ordering === "disposeMiddleBefore" && i === 1 && !site.hostScope;
          const graphs: Graph[] = [];
          const mods: any[] = [];
          const namespaces: any[] = new Array(K).fill(null);
          const results: unknown[] = new Array(K).fill("unset");
          const settle = async (i: number) => {
            try {
              const ns = await mods[i].dyn();
              if (ns && ns.__rejected) results[i] = { rejected: ns.__rejected };
              else {
                namespaces[i] = ns;
                results[i] = { who: api(ns).who, sameAsStatic: mods[i].stat === null ? "n/a" : ns === mods[i].stat };
              }
            } catch (e) {
              results[i] = { rejected: errorName(e) };
            }
          };
          const hostImport = () =>
            import(target.file.startsWith("node:") ? target.file : join(dir, target.file)).then(
              () => "host-ok",
              () => "host-rejected",
            );

          if (ordering === "hostFirst") await hostImport();
          if (ordering === "sequential" || ordering === "hostFirst" || ordering === "hostLast") {
            for (let i = 0; i < K; i++) {
              graphs[i] = graph(whos[i], log);
              mods[i] = await graphs[i].import(importer);
              await settle(i);
            }
          } else if (ordering === "concurrent") {
            await Promise.all(
              whos.map(async (w, i) => {
                graphs[i] = graph(w, log);
                mods[i] = await graphs[i].import(importer);
              }),
            );
            await Promise.all(whos.map((_, i) => settle(i)));
          } else if (ordering === "firstRunsThenOthersExist") {
            graphs[0] = graph(whos[0], log);
            mods[0] = await graphs[0].import(importer);
            await settle(0);
            const firstNs = namespaces[0];
            for (let i = 1; i < K; i++) {
              graphs[i] = graph(whos[i], log);
              mods[i] = await graphs[i].import(importer);
              await settle(i);
            }
            await settle(0);
            if (namespaces[0] !== firstNs) results[0] = { changedAfterOthers: true };
          } else {
            for (let i = 0; i < K; i++) {
              graphs[i] = graph(whos[i], log);
              mods[i] = await graphs[i].import(importer);
            }
            if (ordering === "disposeMiddleBefore") graphs[1].dispose();
            for (const i of ordering === "createAllThenReverse"
              ? [2, 1, 0]
              : ordering === "onlySomeRun"
                ? [0, 2]
                : [0, 1, 2])
              await settle(i);
          }
          if (ordering === "hostLast") await hostImport();

          // a second dyn() in each instance: same namespace as the first, no new evaluation
          const skipped = (i: number) => ordering === "onlySomeRun" && i === 1;
          const repeat = await Promise.all(
            mods.map((m: any, i: number) =>
              skipped(i)
                ? "skipped"
                : m.dyn().then(
                    (ns: any) => (ns && ns.__rejected ? `rejected:${ns.__rejected}` : ns === namespaces[i]),
                    (e: unknown) => `rejected:${errorName(e)}`,
                  ),
            ),
          );

          // cross-instance identity and state isolation of the dynamically imported module
          const live = namespaces.filter(Boolean);
          let isolation: unknown = "n/a";
          if (target.mutable && live.length >= 2) {
            const before = live.map(ns => api(ns).n);
            api(live[0]).inc();
            api(live[0]).inc();
            isolation = live.map((ns, i) => api(ns).n - before[i]);
          }

          const actual = {
            results,
            repeat,
            distinctNamespaces: new Set(live).size,
            isolation,
            evaluations: target.tag ? log.filter(l => l.startsWith(target.tag + "@")).sort() : "n/a",
            innerEvaluations: targetName === "esmChain" ? log.filter(l => l.startsWith("inner@")).sort() : "n/a",
          };

          const liveWhos = whos.filter((_, i) => !disposed(i) && !skipped(i));
          const rejection = target.missing ? "ResolveMessage" : null;
          const expected = {
            results: whos.map((w, i) => {
              if (skipped(i)) return "unset";
              if (disposed(i)) return { rejected: "TypeError" };
              if (rejection) return { rejected: rejection };
              const who = site.hostScope ? target.who(process.env.WHO) : target.who(w);
              const sameAsStatic = site.eager ? "n/a" : !site.hostScope;
              return { who, sameAsStatic };
            }),
            repeat: whos.map((_, i) =>
              skipped(i) ? "skipped" : disposed(i) ? "rejected:TypeError" : rejection ? `rejected:${rejection}` : true,
            ),
            distinctNamespaces: rejection ? 0 : site.hostScope ? 1 : liveWhos.length,
            isolation:
              !target.mutable || rejection
                ? "n/a"
                : site.hostScope || target.shared
                  ? liveWhos.map(() => 2)
                  : liveWhos.map((_, i) => (i === 0 ? 2 : 0)),
            // every graph instance evaluates the target exactly once: at the importer's static import (all
            // non-eager sites import it statically as well), or at its dynamic import for eager sites
            evaluations: target.tag ? whos.map(w => `${target.tag}@${w}`).sort() : "n/a",
            innerEvaluations: targetName === "esmChain" ? whos.map(w => `inner@${w}`).sort() : "n/a",
          };
          expect(actual).toEqual(expected);
          for (const g of graphs) g.dispose();
        });
      }
    }
  }
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 2. Dynamic import into a module that is part of a cycle with the importer, and self-import,
//    before/after the cycle has been evaluated in each instance
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)("ModuleGraph matrix: dynamic import() of cycle members and self", () => {
  const dir = fixture({
    "a.mjs": `import { bTag } from "./b.mjs"; __log.push("a@" + process.env.WHO); export const aTag = "a:" + process.env.WHO; export const readB = () => bTag; export const dynB = () => import("./b.mjs"); export const dynSelf = () => import("./a.mjs"); export let n = 0; export const inc = () => ++n;`,
    "b.mjs": `import { aTag, inc } from "./a.mjs"; __log.push("b@" + process.env.WHO); export const bTag = "b:" + process.env.WHO; export const readA = () => aTag; export const dynA = () => import("./a.mjs"); export const bump = () => inc();`,
    "entry-a.mjs": `export * from "./a.mjs"; import * as a from "./a.mjs"; export const ns = a;`,
    "entry-b.mjs": `export * from "./b.mjs"; import * as b from "./b.mjs"; export const ns = b;`,
  });
  for (const entry of ["entry-a.mjs", "entry-b.mjs"] as const) {
    for (const ordering of ["sequential", "concurrent", "reverse"] as const) {
      test(`${entry} × ${ordering}`, async () => {
        const log: string[] = [];
        const whos = ["c0", "c1", "c2"];
        const graphs = whos.map(w => graph(w, log));
        let mods: any[];
        if (ordering === "concurrent") mods = await Promise.all(graphs.map(g => g.import(join(dir, entry))));
        else {
          mods = [];
          for (const i of ordering === "reverse" ? [2, 1, 0] : [0, 1, 2])
            mods[i] = await graphs[i].import(join(dir, entry));
        }
        const observed = await Promise.all(
          mods.map(async (m, i) => {
            const a = entry === "entry-a.mjs" ? m.ns : await m.ns.dynA();
            const b = entry === "entry-a.mjs" ? await m.ns.dynB() : m.ns;
            const self = await a.dynSelf();
            const bViaA = await a.dynB();
            b.bump();
            b.bump();
            return {
              aTag: a.aTag,
              bTag: b.bTag,
              readB: a.readB(),
              readA: b.readA(),
              selfSame: self === a,
              bSame: bViaA === b,
              n: a.n,
            };
          }),
        );
        expect({ observed, log: log.slice().sort() }).toEqual({
          observed: whos.map(w => ({
            aTag: "a:" + w,
            bTag: "b:" + w,
            readB: "b:" + w,
            readA: "a:" + w,
            selfSame: true,
            bSame: true,
            n: 2,
          })),
          log: whos.flatMap(w => ["a@" + w, "b@" + w]).sort(),
        });
        for (const g of graphs) g.dispose();
      });
    }
  }
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 3. Code shared between instances stays correct once JIT-compiled: imported bindings, module state,
//    closures, classes, namespace property access, at scope depths 0–3, in every instance order
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)("ModuleGraph matrix: hot code across instances", () => {
  const dir = fixture({
    "k.mjs": `export let v = process.env.WHO + ":0"; export const K = "K:" + process.env.WHO; export function set(x) { v = process.env.WHO + ":" + x } export const obj = { who: process.env.WHO };`,
    "hot.mjs": `import { v, K, set, obj } from "./k.mjs"; import * as ns from "./k.mjs";
      let local = 0;
      export function d0(n) { let r; for (let i = 0; i < n; i++) r = v + "|" + K; return r; }
      export function d1(n) { return (() => { let r; for (let i = 0; i < n; i++) r = v + "|" + K; return r; })(); }
      export function d2(n) { return (() => (() => { let r; for (let i = 0; i < n; i++) r = v + "|" + K; return r; })())(); }
      export function d3(n) { return (() => (() => (() => { let r; for (let i = 0; i < n; i++) r = v + "|" + K; return r; })())())(); }
      export function viaNamespace(n) { let r; for (let i = 0; i < n; i++) r = ns.v + "|" + ns.K; return r; }
      export function bumpLocal(n) { for (let i = 0; i < n; i++) local++; return local; }
      export function setThenRead(x, n) { set(x); return d0(n); }
      export class C { static who = obj.who; #p = obj.who; get p() { return this.#p } }
      export const makeClosure = () => { let c = 0; return () => ++c + ":" + obj.who; };
      export const identity = { C, obj };`,
  });
  const N = 20_000; // enough for baseline+DFG on release builds; correctness does not depend on tiering
  for (const order of ["hotFirstThenOthers", "allCreatedThenHot", "interleaved", "othersFirstThenHot"] as const) {
    for (const count of [2, 3, 4]) {
      test(`${order} × ${count} instances`, async () => {
        const log: string[] = [];
        const whos = Array.from({ length: count }, (_, i) => `h${i}`);
        const graphs: Graph[] = [];
        const mods: any[] = [];
        const make = async (i: number) => {
          graphs[i] = graph(whos[i], log);
          mods[i] = await graphs[i].import(join(dir, "hot.mjs"));
        };
        const heat = (i: number) => {
          mods[i].d0(N);
          mods[i].d1(N);
          mods[i].d2(N);
          mods[i].d3(N);
          mods[i].viaNamespace(N);
          mods[i].bumpLocal(N);
        };
        if (order === "hotFirstThenOthers") {
          await make(0);
          heat(0);
          for (let i = 1; i < count; i++) await make(i);
        } else if (order === "allCreatedThenHot") {
          for (let i = 0; i < count; i++) await make(i);
          heat(0);
        } else if (order === "interleaved") {
          for (let i = 0; i < count; i++) {
            await make(i);
            heat(i);
          }
        } else {
          for (let i = count - 1; i >= 0; i--) await make(i);
          heat(count - 1);
        }

        const observed = whos.map((w, i) => {
          const m = mods[i];
          const before = { d0: m.d0(N), d1: m.d1(N), d2: m.d2(N), d3: m.d3(N), ns: m.viaNamespace(N) };
          const after = m.setThenRead(7, N);
          const closure = m.makeClosure();
          closure();
          const second = closure();
          return {
            before,
            after,
            afterNs: m.viaNamespace(3),
            local: m.bumpLocal(1),
            classStatic: m.C.who,
            classPrivate: new m.C().p,
            closure: second,
          };
        });
        // reading again after every instance ran set(7): each still sees its own binding
        const reread = whos.map((_, i) => mods[i].d2(5));
        const crossIdentity = {
          classesDistinct: new Set(mods.map(m => m.identity.C)).size,
          instanceofAcross: mods.length > 1 ? new mods[0].C() instanceof mods[1].C : "n/a",
          objDistinct: new Set(mods.map(m => m.identity.obj)).size,
        };
        expect({ observed, reread, crossIdentity }).toEqual({
          observed: whos.map((w, i) => ({
            before: {
              d0: `${w}:0|K:${w}`,
              d1: `${w}:0|K:${w}`,
              d2: `${w}:0|K:${w}`,
              d3: `${w}:0|K:${w}`,
              ns: `${w}:0|K:${w}`,
            },
            after: `${w}:7|K:${w}`,
            afterNs: `${w}:7|K:${w}`,
            local:
              (order === "interleaved" ||
              (order === "hotFirstThenOthers" && i === 0) ||
              (order === "allCreatedThenHot" && i === 0) ||
              (order === "othersFirstThenHot" && i === count - 1)
                ? N
                : 0) + 1,
            classStatic: w,
            classPrivate: w,
            closure: `2:${w}`,
          })),
          reread: whos.map(w => `${w}:7|K:${w}`),
          crossIdentity: { classesDistinct: count, instanceofAcross: false, objDistinct: count },
        });
        for (const g of graphs) g.dispose();
      });
    }
  }
  // Once a second instance exists, the optimized code the instances share is instance-generic: creating
  // and running further instances must not recompile it (no per-instance OSR-exit/jettison cycle) and each
  // instance still reads its own bindings.
  for (const order of ["heatFirstInstanceThenAdd", "heatEachInstance"] as const) {
    test(`shared optimized code is stable across instances × ${order}`, async () => {
      const log: string[] = [];
      const whos = Array.from({ length: 8 }, (_, i) => `j${i}`);
      const graphs: Graph[] = [];
      const mods: any[] = [];
      const HOT = 200_000;
      for (let i = 0; i < 2; i++) {
        graphs[i] = graph(whos[i], log);
        mods[i] = await graphs[i].import(join(dir, "hot.mjs"));
        mods[i].d0(HOT);
        mods[i].d2(HOT);
        mods[i].viaNamespace(HOT);
      }
      mods[0].d0(HOT);
      mods[0].d2(HOT);
      mods[0].viaNamespace(HOT);
      const compilesAfterTwo = {
        d0: numberOfDFGCompiles(mods[0].d0),
        d2: numberOfDFGCompiles(mods[0].d2),
        viaNamespace: numberOfDFGCompiles(mods[0].viaNamespace),
      };
      const reads: unknown[] = [];
      for (let i = 2; i < whos.length; i++) {
        graphs[i] = graph(whos[i], log);
        mods[i] = await graphs[i].import(join(dir, "hot.mjs"));
        const n = order === "heatEachInstance" ? HOT : 1000;
        reads.push([mods[i].d0(n), mods[i].d2(n), mods[i].viaNamespace(n), mods[i].setThenRead(i, 10)]);
      }
      const compilesAfterEight = {
        d0: numberOfDFGCompiles(mods[0].d0),
        d2: numberOfDFGCompiles(mods[0].d2),
        viaNamespace: numberOfDFGCompiles(mods[0].viaNamespace),
      };
      expect({ reads, compilesAfterEight, firstTwo: [mods[0].d0(3), mods[1].d0(3)] }).toEqual({
        reads: whos.slice(2).map((w, k) => [`${w}:0|K:${w}`, `${w}:0|K:${w}`, `${w}:0|K:${w}`, `${w}:${k + 2}|K:${w}`]),
        compilesAfterEight: compilesAfterTwo,
        firstTwo: [`${whos[0]}:0|K:${whos[0]}`, `${whos[1]}:0|K:${whos[1]}`],
      });
      for (const g of graphs) g.dispose();
    });
  }

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 4. Static graph shapes instantiated repeatedly (sequential and concurrent): isolation, identity,
//    exactly one evaluation per module per instance, link errors confined to the instance
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)("ModuleGraph matrix: graph shapes × instantiation order", () => {
  const leaf = (name: string) =>
    `__log.push(${JSON.stringify(name)} + "@" + process.env.WHO); export const ${name} = ${JSON.stringify(name)} + ":" + process.env.WHO; export let n_${name} = 0; export const inc_${name} = () => ++n_${name};`;
  const dir = fixture({
    // chain: root -> m1 -> m2 -> m3
    "chain/m3.mjs": leaf("m3"),
    "chain/m2.mjs": `import { m3 } from "./m3.mjs"; ${leaf("m2")} export const below = m3;`,
    "chain/m1.mjs": `import { m2, below } from "./m2.mjs"; ${leaf("m1")} export const chain = [m2, below];`,
    "chain/root.mjs": `import { m1, chain } from "./m1.mjs"; __log.push("root@" + process.env.WHO); export const out = [m1, ...chain];`,
    // diamond: root -> l, r -> shared
    "diamond/shared.mjs": leaf("shared"),
    "diamond/l.mjs": `import { shared, inc_shared } from "./shared.mjs"; ${leaf("l")} export const viaL = () => inc_shared();`,
    "diamond/r.mjs": `import { shared, n_shared } from "./shared.mjs"; ${leaf("r")} export const seenByR = () => n_shared;`,
    "diamond/root.mjs": `import { viaL } from "./l.mjs"; import { seenByR } from "./r.mjs"; __log.push("root@" + process.env.WHO); export const out = () => { viaL(); viaL(); return seenByR(); };`,
    // cycle with hoisted function used across the cycle during evaluation
    "cycle/a.mjs": `import { fromB } from "./b.mjs"; __log.push("a@" + process.env.WHO); export function fromA() { return "A:" + process.env.WHO } export const gotB = fromB();`,
    "cycle/b.mjs": `import { fromA } from "./a.mjs"; __log.push("b@" + process.env.WHO); export function fromB() { return "B:" + process.env.WHO } export const gotA = fromA();`,
    "cycle/root.mjs": `import { gotB } from "./a.mjs"; import { gotA } from "./b.mjs"; __log.push("root@" + process.env.WHO); export const out = [gotA, gotB];`,
    // star re-exports, renamed re-exports, re-exported namespace, default + named
    "star/x.mjs": `${leaf("x")} export default "dx:" + process.env.WHO;`,
    "star/y.mjs": `${leaf("y")}`,
    "star/hub.mjs": `export * from "./x.mjs"; export * from "./y.mjs"; export { x as renamed } from "./x.mjs"; export * as yns from "./y.mjs"; export { default } from "./x.mjs"; __log.push("hub@" + process.env.WHO);`,
    "star/root.mjs": `import d, { x, y, renamed, yns } from "./hub.mjs"; import * as hub from "./hub.mjs"; __log.push("root@" + process.env.WHO); export const out = [d, x, y, renamed, yns.y, hub.yns === yns, Object.keys(hub).sort().join(",")];`,
    // ambiguous star export: link error, per instance, does not poison a sibling import
    "amb/p.mjs": `export const dup = 1; export const onlyP = "p";`,
    "amb/q.mjs": `export const dup = 2; export const onlyQ = "q";`,
    "amb/hub.mjs": `export * from "./p.mjs"; export * from "./q.mjs";`,
    "amb/bad.mjs": `import { dup } from "./hub.mjs"; export const v = dup;`,
    "amb/good.mjs": `import { onlyP, onlyQ } from "./hub.mjs"; __log.push("good@" + process.env.WHO); export const out = [onlyP, onlyQ];`,
    // mixed leaves: json, cjs, ts under one root
    "mixed/data.json": `{ "k": "json" }`,
    "mixed/c.cjs": `module.exports = { c: "cjs:" + process.env.WHO };`,
    "mixed/t.ts": `__log.push("ts@" + process.env.WHO); export const t: string = "ts:" + process.env.WHO;`,
    "mixed/root.mjs": `import data from "./data.json"; import c from "./c.cjs"; import { t } from "./t.ts"; __log.push("root@" + process.env.WHO); export const out = [data.k, c.c, t];`,
  });
  type Shape = {
    entry: string;
    out: (w: string, m: any) => unknown | Promise<unknown>;
    expectOut: (w: string) => unknown;
    evaluations: string[];
  };
  const shapes: Record<string, Shape> = {
    chain: {
      entry: "chain/root.mjs",
      out: (_w, m) => m.out,
      expectOut: w => [`m1:${w}`, `m2:${w}`, `m3:${w}`],
      evaluations: ["m3", "m2", "m1", "root"],
    },
    diamond: {
      entry: "diamond/root.mjs",
      out: (_w, m) => m.out(),
      expectOut: () => 2,
      evaluations: ["shared", "l", "r", "root"],
    },
    cycle: {
      entry: "cycle/root.mjs",
      out: (_w, m) => m.out,
      expectOut: w => [`A:${w}`, `B:${w}`],
      evaluations: ["b", "a", "root"],
    },
    star: {
      entry: "star/root.mjs",
      out: (_w, m) => m.out,
      expectOut: w => [
        `dx:${w}`,
        `x:${w}`,
        `y:${w}`,
        `x:${w}`,
        `y:${w}`,
        true,
        "default,inc_x,inc_y,n_x,n_y,renamed,x,y,yns",
      ],
      evaluations: ["x", "y", "hub", "root"],
    },
    mixed: {
      entry: "mixed/root.mjs",
      out: (_w, m) => m.out,
      expectOut: w => ["json", `cjs:${process.env.WHO}`, `ts:${w}`], // the CommonJS leaf is the global's
      evaluations: ["ts", "root"],
    },
  };
  for (const [shapeName, shape] of Object.entries(shapes)) {
    for (const ordering of ["sequential", "concurrent", "reverse", "sameInstanceTwice"] as const) {
      test(`${shapeName} × ${ordering}`, async () => {
        const log: string[] = [];
        const whos = ["s0", "s1", "s2"];
        const graphs = whos.map(w => graph(w, log));
        const entry = join(dir, shape.entry);
        let mods: any[] = [];
        if (ordering === "concurrent") mods = await Promise.all(graphs.map(g => g.import(entry)));
        else if (ordering === "sameInstanceTwice") {
          for (let i = 0; i < 3; i++) {
            mods[i] = await graphs[i].import(entry);
            const again = await graphs[i].import(entry);
            mods[i] = { first: mods[i], same: again === mods[i] };
          }
        } else for (const i of ordering === "reverse" ? [2, 1, 0] : [0, 1, 2]) mods[i] = await graphs[i].import(entry);
        const outs = await Promise.all(
          whos.map((w, i) => shape.out(w, ordering === "sameInstanceTwice" ? mods[i].first : mods[i])),
        );
        const perInstanceLog = whos.map(w => log.filter(l => l.endsWith("@" + w)).map(l => l.split("@")[0]));
        expect({
          outs,
          perInstanceLog,
          namespacesDistinct: new Set(mods.map(m => (ordering === "sameInstanceTwice" ? m.first : m))).size,
          sameWithinInstance: ordering === "sameInstanceTwice" ? mods.map(m => m.same) : "n/a",
        }).toEqual({
          outs: whos.map(w => shape.expectOut(w)),
          perInstanceLog: whos.map(() => shape.evaluations),
          namespacesDistinct: 3,
          sameWithinInstance: ordering === "sameInstanceTwice" ? [true, true, true] : "n/a",
        });
        for (const g of graphs) g.dispose();
      });
    }
  }
  for (const ordering of ["badFirst", "goodFirst", "concurrent"] as const) {
    test(`ambiguous star export is a per-instance link error and does not poison siblings × ${ordering}`, async () => {
      const log: string[] = [];
      const whos = ["e0", "e1"];
      const graphs = whos.map(w => graph(w, log));
      const observed = await Promise.all(
        graphs.map(async g => {
          const bad = () =>
            g.import(join(dir, "amb/bad.mjs")).then(
              () => "linked",
              (e: unknown) => errorName(e),
            );
          const good = () =>
            g.import(join(dir, "amb/good.mjs")).then(
              (m: any) => m.out,
              (e: unknown) => errorName(e),
            );
          if (ordering === "badFirst") return { bad: await bad(), good: await good(), badAgain: await bad() };
          if (ordering === "goodFirst") return { good: await good(), bad: await bad(), badAgain: await bad() };
          const [b, gd] = await Promise.all([bad(), good()]);
          return { bad: b, good: gd, badAgain: await bad() };
        }),
      );
      expect({ observed, log: log.sort() }).toEqual({
        observed: whos.map(() => ({ bad: "SyntaxError", good: ["p", "q"], badAgain: "SyntaxError" })),
        log: whos.map(w => "good@" + w).sort(),
      });
      for (const g of graphs) g.dispose();
    });
  }
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 5. Lifecycle × timing: dispose and errors at every stage, other instances unaffected, fresh
//    instances afterwards work
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)("ModuleGraph matrix: lifecycle and error timing", () => {
  const dir = fixture({
    "slow.mjs": `__log.push("slow-start@" + process.env.WHO); await new Promise(r => setTimeout(r, 20)); __log.push("slow-end@" + process.env.WHO); export const who = process.env.WHO; export const later = () => import("./late.mjs").then(m => m.who);`,
    "late.mjs": `__log.push("late@" + process.env.WHO); export const who = process.env.WHO;`,
    "throws.mjs": `__log.push("throws@" + process.env.WHO); if (process.env.WHO !== "ok") throw new RangeError("boom:" + process.env.WHO); export const who = process.env.WHO;`,
    "rejects.mjs": `__log.push("rejects@" + process.env.WHO); await new Promise((_, rej) => setTimeout(() => rej(new EvalError("nope:" + process.env.WHO)), 1)); export const who = process.env.WHO;`,
    "dep-of-throws.mjs": `import { who } from "./throws.mjs"; export const w = who;`,
  });

  for (const when of [
    "beforeImportSettles",
    "duringDependencyTla",
    "afterImport",
    "afterDynamicImportStarted",
  ] as const) {
    test(`dispose ${when}: that instance's work rejects, siblings complete, a fresh instance works`, async () => {
      const log: string[] = [];
      const a = graph("a", log),
        b = graph("b", log);
      const bMod = b.import(join(dir, "slow.mjs"));
      let aOutcome: unknown;
      if (when === "beforeImportSettles") {
        const p = a.import(join(dir, "slow.mjs"));
        a.dispose();
        aOutcome = await p.then(() => "resolved", errorName);
      } else if (when === "duringDependencyTla") {
        const p = a.import(join(dir, "slow.mjs"));
        while (!log.includes("slow-start@a")) await new Promise<void>(r => setImmediate(r)); // a is now parked in its TLA
        a.dispose();
        aOutcome = await p.then(() => "resolved", errorName);
      } else if (when === "afterImport") {
        const m = await a.import(join(dir, "slow.mjs"));
        a.dispose();
        aOutcome = await m.later().then((w: string) => "late:" + w, errorName);
      } else {
        const m = await a.import(join(dir, "slow.mjs"));
        const p = m.later();
        a.dispose();
        aOutcome = await p.then((w: string) => "late:" + w, errorName);
      }
      const bResult = await bMod.then(async (m: any) => ({ who: m.who, late: await m.later() }), errorName);
      const c = graph("c", log);
      const cResult = await c
        .import(join(dir, "slow.mjs"))
        .then(async (m: any) => ({ who: m.who, late: await m.later() }), errorName);
      expect({
        aOutcome,
        bResult,
        cResult,
        bLog: log.filter(l => l.endsWith("@b")),
        cLog: log.filter(l => l.endsWith("@c")),
      }).toEqual({
        aOutcome: "TypeError",
        bResult: { who: "b", late: "b" },
        cResult: { who: "c", late: "c" },
        bLog: ["slow-start@b", "slow-end@b", "late@b"],
        cLog: ["slow-start@c", "slow-end@c", "late@c"],
      });
      b.dispose();
      c.dispose();
    });
  }

  for (const kind of ["syncThrow", "tlaReject", "throwInDependency"] as const) {
    for (const ordering of ["failingFirst", "failingLast", "concurrent"] as const) {
      test(`${kind} × ${ordering}: rejection is per instance with the instance's own error; other instances and retries in new instances are unaffected`, async () => {
        const log: string[] = [];
        const file = kind === "syncThrow" ? "throws.mjs" : kind === "tlaReject" ? "rejects.mjs" : "dep-of-throws.mjs";
        const outcome = (g: Graph) =>
          g.import(join(dir, file)).then(
            (m: any) => ({ ok: m.who ?? m.w }),
            (e: any) => ({ err: errorName(e), message: String(e.message) }),
          );
        const bad1 = graph("bad1", log),
          bad2 = graph("bad2", log),
          ok = graph("ok", log);
        let results: unknown[];
        if (ordering === "failingFirst") results = [await outcome(bad1), await outcome(bad2), await outcome(ok)];
        else if (ordering === "failingLast") {
          const r3 = await outcome(ok);
          results = [await outcome(bad1), await outcome(bad2), r3];
        } else results = await Promise.all([outcome(bad1), outcome(bad2), outcome(ok)]);
        // the same failing instance asked again reports the same (cached) failure; a new instance re-evaluates
        const again = await outcome(bad1);
        const fresh = await outcome(graph("bad3", log));
        const tag = kind === "tlaReject" ? "rejects" : "throws";
        expect({ results, again, fresh, evaluations: log.filter(l => l.startsWith(tag + "@")).sort() }).toEqual({
          results: [
            kind === "tlaReject"
              ? { err: "EvalError", message: "nope:bad1" }
              : { err: "RangeError", message: "boom:bad1" },
            kind === "tlaReject"
              ? { err: "EvalError", message: "nope:bad2" }
              : { err: "RangeError", message: "boom:bad2" },
            kind === "tlaReject" ? { err: "EvalError", message: "nope:ok" } : { ok: "ok" },
          ],
          again:
            kind === "tlaReject"
              ? { err: "EvalError", message: "nope:bad1" }
              : { err: "RangeError", message: "boom:bad1" },
          fresh:
            kind === "tlaReject"
              ? { err: "EvalError", message: "nope:bad3" }
              : { err: "RangeError", message: "boom:bad3" },
          evaluations: [`${tag}@bad1`, `${tag}@bad2`, `${tag}@bad3`, `${tag}@ok`].sort(),
        });
        for (const g of [bad1, bad2, ok]) g.dispose();
      });
    }
  }
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 5b. The same module across instances when its surroundings change between instantiations: a
//     dependency edited on disk (same importer text, differently shaped exporter) and all compiled
//     code deleted (Bun.shrink). Instances created afterwards must see the files as they are and work;
//     earlier instances keep what they loaded.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)("ModuleGraph matrix: dependency edits and code deletion between instances", () => {
  const importer = `import { x, shape } from "./dep.mjs"; import * as ns from "./dep.mjs";
    export function read(n) { let r; for (let i = 0; i < n; i++) r = x + ":" + shape; return r; }
    export function viaNamespace(n) { let r; for (let i = 0; i < n; i++) r = ns.x + ":" + ns.shape; return r; }
    export const keys = () => Object.keys(ns).join(",");
    export const lazy = () => import("./dep.mjs").then(m => m.x + ":" + m.shape);`;
  const versions = {
    v1: `export let x = "x1"; export const shape = 1;`,
    // a binding inserted before x moves x within the module's environment
    v2: `export let w = "w"; export let x = "x2"; export const shape = 2;`,
    // bindings removed/reordered
    v3: `export const shape = 3; export let x = "x3";`,
  } as const;
  const HOT = 100_000;

  for (const sequence of [
    ["v1", "v2", "v2"],
    ["v1", "v2", "v3", "v1"],
    ["v1", "v1", "v2", "v2", "v1"],
  ] as const) {
    for (const heat of ["heatBeforeEdit", "noHeat"] as const) {
      test(`dependency ${sequence.join("→")} × ${heat}`, async () => {
        using tmp = tempDir("module-graph-matrix-", { "importer.mjs": importer, "dep.mjs": versions.v1 });
        const dir = String(tmp);
        const log: string[] = [];
        const graphs: Graph[] = [];
        const mods: any[] = [];
        const observed: unknown[] = [];
        for (let i = 0; i < sequence.length; i++) {
          writeFileSync(join(dir, "dep.mjs"), versions[sequence[i]]);
          graphs[i] = graph(`d${i}`, log);
          mods[i] = await graphs[i].import(join(dir, "importer.mjs"));
          const n = heat === "heatBeforeEdit" ? HOT : 3;
          observed.push({
            read: mods[i].read(n),
            viaNamespace: mods[i].viaNamespace(n),
            keys: mods[i].keys(),
            lazy: await mods[i].lazy(),
          });
        }
        // earlier instances are unaffected by later edits
        const again = mods.map(m => ({ read: m.read(5), viaNamespace: m.viaNamespace(5), keys: m.keys() }));
        const expectedFor = (v: keyof typeof versions) => {
          const n = v.slice(1);
          return { read: `x${n}:${n}`, viaNamespace: `x${n}:${n}`, keys: v === "v2" ? "shape,w,x" : "shape,x" };
        };
        expect({ observed, again }).toEqual({
          observed: sequence.map(v => ({ ...expectedFor(v), lazy: `x${v.slice(1)}:${v.slice(1)}` })),
          again: sequence.map(v => expectedFor(v)),
        });
        for (const g of graphs) g.dispose();
      });
    }
  }

  for (const when of ["afterFirstInstance", "afterSecondInstance", "twice"] as const) {
    test(`all compiled code deleted ${when}; later instances link afresh and work`, async () => {
      using tmp = tempDir("module-graph-matrix-", { "importer.mjs": importer, "dep.mjs": versions.v1 });
      const dir = String(tmp);
      const log: string[] = [];
      const graphs: Graph[] = [];
      const mods: any[] = [];
      const shrinkAndIdle = async () => {
        Bun.shrink();
        await new Promise<void>(r => setTimeout(r, 0));
        await new Promise<void>(r => setImmediate(r));
      };
      const observed: unknown[] = [];
      for (let i = 0; i < 4; i++) {
        graphs[i] = graph(`s${i}`, log);
        mods[i] = await graphs[i].import(join(dir, "importer.mjs"));
        observed.push(mods[i].read(HOT));
        if (
          (when === "afterFirstInstance" && i === 0) ||
          (when === "afterSecondInstance" && i === 1) ||
          (when === "twice" && (i === 0 || i === 2))
        )
          await shrinkAndIdle();
      }
      const again = mods.map(m => [m.read(HOT), m.viaNamespace(3)]);
      expect({ observed, again }).toEqual({
        observed: ["x1:1", "x1:1", "x1:1", "x1:1"],
        again: Array(4).fill(["x1:1", "x1:1"]),
      });
      for (const g of graphs) g.dispose();
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// 6. Many instances at once: N graphs importing the same entry concurrently, each with dynamic
//    imports resolved at different times, all isolated; then all disposed and collectable
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)("ModuleGraph matrix: many concurrent instances", () => {
  const dir = fixture({
    "entry.mjs": `import { tag } from "./dep.mjs"; export const who = process.env.WHO; export const staticTag = tag; export const dyn = (delay) => new Promise(r => setTimeout(r, delay)).then(() => import("./lazy.mjs")).then(m => m.tag); export const big = new Uint8Array(64 * 1024);`,
    "dep.mjs": `export const tag = "dep:" + process.env.WHO;`,
    "lazy.mjs": `__log.push("lazy@" + process.env.WHO); export const tag = "lazy:" + process.env.WHO;`,
  });
  for (const n of [8, 24]) {
    test(`${n} instances, staggered dynamic imports`, async () => {
      const log: string[] = [];
      const whos = Array.from({ length: n }, (_, i) => `m${i}`);
      const graphs = whos.map(w => graph(w, log));
      const mods = await Promise.all(graphs.map(g => g.import(join(dir, "entry.mjs"))));
      const dyn = await Promise.all(mods.map((m, i) => m.dyn((n - i) % 5)));
      const second = await Promise.all(mods.map(m => m.dyn(0)));
      expect({
        whos: mods.map(m => m.who),
        staticTags: mods.map(m => m.staticTag),
        dyn,
        second,
        lazyEvaluations: log.filter(l => l.startsWith("lazy@")).sort(),
        distinct: new Set(mods).size,
      }).toEqual({
        whos,
        staticTags: whos.map(w => "dep:" + w),
        dyn: whos.map(w => "lazy:" + w),
        second: whos.map(w => "lazy:" + w),
        lazyEvaluations: whos.map(w => "lazy@" + w).sort(),
        distinct: n,
      });
      for (const g of graphs) g.dispose();
    });
  }
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
