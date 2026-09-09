import { describe, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { BundlerTestInput, BundlerTestRunOptions, itBundled as itBundledBase } from "./expectBundled";

// `bun build --compile --bytecode --format=esm` embeds a pre-resolved module graph that JSC's loader consumes instead
// of resolving every import by name at startup. These cases pin ES module linking semantics (cycles, live bindings,
// star exports, namespaces, TLA, CJS interop) for compiled executables: each executable runs with the graph in use,
// with the graph cross-checked against the specification's ResolveExport, and with the graph disabled, and all three
// must print the same thing. Without --splitting the bundle is one module record, so only the entry's own record
// (its exports, TLA and import.meta flags, dynamic-import roots) comes from the graph; the +splitting variants make
// every listed entry and every import() target a chunk of its own whose bindings are wired across records.
// GeneratedGraph+splitting also checks the loader log to prove the graph, not by-name resolution, linked the chunks.
const itBundled = (id: string, opts: BundlerTestInput) => itBundledBase(id, { backend: "cli", ...opts });

const hasPrelinkOptions =
  Bun.spawnSync({
    cmd: [bunExe(), "-p", "'probe'"],
    env: { ...bunEnv, BUN_JSC_usePrelinkedModuleInfo: "1" },
    stdout: "pipe",
    stderr: "ignore",
  })
    .stdout.toString()
    .trim() === "probe";

type LoaderMode = "graph" | "graph+validate" | "by-name";
// A bun without the options (an older release run against this file) gets the "graph" expectations only, which the
// loader-log check in GeneratedGraph+splitting then fails.
const loaderModes: { mode: LoaderMode; env: Record<string, string> }[] = hasPrelinkOptions
  ? [
      { mode: "graph", env: {} },
      { mode: "graph+validate", env: { BUN_JSC_validatePrelinkedModuleInfo: "1" } },
      { mode: "by-name", env: { BUN_JSC_usePrelinkedModuleInfo: "0" } },
    ]
  : [{ mode: "graph", env: {} }];

function eachMode(run: (mode: LoaderMode) => BundlerTestRunOptions): BundlerTestRunOptions[] {
  return loaderModes.map(({ mode, env }) => {
    const options = run(mode);
    return { ...options, env: { ...options.env, ...env } };
  });
}

type PerVariant<T> = T | ((splitting: boolean) => T);
const variant = <T>(v: PerVariant<T>, splitting: boolean): T => (typeof v === "function" ? (v as any)(splitting) : v);

interface GraphCase {
  files: PerVariant<Record<string, string>>;
  stdout: PerVariant<string>;
  /**
   * With splitting, every file listed here is also an entry point, so it gets a chunk (module record) of its own that
   * re-exports its bindings from the shared chunk. Of an import cycle only the module the main entry imports first is
   * listed (or loaded with import()): the shared chunk evaluates its modules in the order of the first root that
   * reaches them, as esbuild does, so a second root inside the cycle would run the cycle in a different order.
   */
  entries?: string[];
  /** Extra run options for the +splitting variant, per loader mode. */
  splitRun?: (mode: LoaderMode) => Partial<BundlerTestRunOptions>;
}

// Registers `compile/prelinked/<id>` (one chunk) and `compile/prelinked/<id>+splitting` (entries and dynamic imports
// become separate chunks that import each other's bindings).
function graphCase(id: string, c: GraphCase) {
  for (const splitting of [false, true]) {
    const entries = splitting && c.entries ? c.entries : undefined;
    itBundled(`compile/prelinked/${id}${splitting ? "+splitting" : ""}`, {
      compile: true,
      bytecode: true,
      format: "esm",
      splitting,
      files: variant(c.files, splitting),
      ...(entries ? { entryPointsRaw: entries.map(e => "./" + e.replace(/^\//, "")), outfile: "dist/out" } : {}),
      run: eachMode(mode => ({
        stdout: variant(c.stdout, splitting),
        ...(entries ? { file: "dist/out" } : {}),
        ...(splitting ? c.splitRun?.(mode) : {}),
      })),
    });
  }
}

describe("bundler", () => {
  // (1) cycles: b evaluates before a (entry -> a -> b), calls a hoisted function of a while a is unevaluated, and
  // later reads a's live `counter` binding.
  graphCase("CycleTwoModules", {
    files: {
      "/entry.ts": /* js */ `
        import { fromA, counter, bump } from "./a";
        import { fromB, readCounterFromB, bumpViaB } from "./b";
        console.log(fromA, "|", fromB, "|", counter, readCounterFromB());
        bump();
        bumpViaB();
        console.log(counter, readCounterFromB());
      `,
      "/a.ts": /* js */ `
        import { describeB } from "./b";
        export let counter = 0;
        export function bump() { counter++; }
        export function nameA() { return "A"; }
        export const fromA = "a sees " + describeB();
      `,
      "/b.ts": /* js */ `
        import { nameA, counter, bump } from "./a";
        export function describeB() { return "B(" + nameA() + ")"; }
        export const fromB = "b sees " + nameA();
        export function readCounterFromB() { return counter; }
        export function bumpViaB() { bump(); }
      `,
    },
    entries: ["/entry.ts", "/a.ts", "/b.ts"],
    stdout: "a sees B(A) | b sees A | 0 0\n2 2",
  });

  graphCase("CycleThreeModules", {
    files: {
      "/entry.ts": /* js */ `
        import { a, order } from "./a";
        import { b } from "./b";
        import { c, setC } from "./c";
        console.log(order.join(">"), a, b, c);
        setC("C2");
        console.log(c, b);
        const na = await import("./a");
        console.log(na.a, na.order === order, na.lazyA());
      `,
      "/a.ts": /* js */ `
        import { b, order } from "./b";
        order.push("a");
        export const a = "a+" + b;
        export { order };
        export function lazyA() { return "A"; }
      `,
      "/b.ts": /* js */ `
        import { c, order } from "./c";
        order.push("b");
        export let b = "b+" + c;
        export { order };
      `,
      "/c.ts": /* js */ `
        import { lazyA } from "./a";
        export const order: string[] = ((globalThis as any).order ??= []);
        order.push("c");
        export let c = "c(" + lazyA() + ")";
        export function setC(v: string) { c = v; }
        export function readA() { return lazyA(); }
      `,
    },
    entries: ["/entry.ts", "/a.ts"],
    stdout: "c>b>a a+b+c(A) b+c(A) c(A)\nC2 b+c(A)\na+b+c(A) true A",
  });

  // (2) star exports. `x` is exported by both a and b, so it is ambiguous through star.js: the namespace omits it
  // and a static named import of it does not link.
  // In the splitting variant star.js is also loaded by path at run time, so JSC builds that namespace itself.
  graphCase("StarExportConflict", {
    files: splitting => ({
      "/entry.ts": /* js */ `
        import * as ns from "./star.js";
        import { onlyA, onlyB, own } from "./star.js";
        const k = String.fromCharCode(120);
        console.log(JSON.stringify(Object.keys(ns)), k in ns, (ns as any)[k], onlyA, onlyB, own);
        ${
          splitting
            ? `const s = (x: string) => x;
        const dyn = await import(s("./star.js"));
        console.log(JSON.stringify(Object.keys(dyn)), k in dyn, dyn[k], dyn.onlyA, dyn[Symbol.toStringTag]);`
            : `console.log("-");`
        }
      `,
      "/a.js": /* js */ `export const x = "ax"; export const onlyA = "A";`,
      "/b.js": /* js */ `export const x = "bx"; export const onlyB = "B";`,
      "/star.js": /* js */ `export * from "./a.js"; export * from "./b.js"; export const own = "own";`,
    }),
    entries: ["/entry.ts", "/star.js"],
    stdout: splitting =>
      `["onlyA","onlyB","own"] false undefined A B own\n` +
      (splitting ? `["onlyA","onlyB","own"] false undefined A Module` : `-`),
  });

  itBundled("compile/prelinked/StarExportConflictNamedImport", {
    compile: true,
    bytecode: true,
    format: "esm",
    files: {
      "/entry.ts": /* js */ `
        import { x } from "./star.js";
        console.log(x);
      `,
      "/a.js": /* js */ `export const x = "ax";`,
      "/b.js": /* js */ `export const x = "bx";`,
      "/star.js": /* js */ `export * from "./a.js"; export * from "./b.js";`,
    },
    bundleErrors: { "/entry.ts": [`Ambiguous import "x" has multiple matching exports`] },
  });

  // `export *` from two modules without conflicts, `export * as ns`, `export { a as b } from`, and a re-export chain
  // three modules deep. With splitting each file is an entry chunk whose exports are indirect (imported from the shared
  // chunk and re-exported under the original names), and the runtime import() resolves through them.
  graphCase("ReExports", {
    files: splitting => ({
      "/entry.ts": /* js */ `
        import * as star from "./star";
        import { one, two, both, nsOne, renamed, v3, setDeep } from "./star";
        console.log(JSON.stringify(Object.keys(star)));
        console.log(one, two, both(), nsOne.one, JSON.stringify(Object.keys(nsOne)), renamed, v3);
        setDeep("D2");
        console.log(v3, star.v3, nsOne === star.nsOne);
        ${
          splitting
            ? `const s = (x: string) => x;
        const [dStar, dTop] = await Promise.all([import(s("./star.ts")), import(s("./chain-top.ts"))]);
        console.log(JSON.stringify(Object.keys(dStar)), dStar.v3, dTop.v3, dStar.nsOne.one, dStar.renamed, dStar.nsOne === nsOne);`
            : `console.log("-");`
        }
      `,
      "/one.ts": /* js */ `export const one = 1; export const uno = "uno";`,
      "/two.ts": /* js */ `import { one } from "./one"; export const two = one + 1; export function both() { return one + two; }`,
      "/star.ts": /* js */ `
        export * from "./one";
        export * from "./two";
        export * as nsOne from "./one";
        export { uno as renamed } from "./one";
        export { v3, setDeep } from "./chain-top";
      `,
      "/chain-top.ts": /* js */ `export { v2 as v3, setDeep } from "./chain-mid";`,
      "/chain-mid.ts": /* js */ `export * from "./chain-low";`,
      "/chain-low.ts": /* js */ `export { deep as v2, setDeep } from "./chain-bottom";`,
      "/chain-bottom.ts": /* js */ `export let deep = "D1"; export function setDeep(v: string) { deep = v; }`,
    }),
    entries: ["/entry.ts", "/star.ts", "/one.ts", "/two.ts", "/chain-top.ts", "/chain-mid.ts"],
    stdout: splitting =>
      `["both","nsOne","one","renamed","setDeep","two","uno","v3"]\n` +
      `1 2 3 1 ["one","uno"] uno D1\n` +
      `D2 D2 true\n` +
      (splitting ? `["both","nsOne","one","renamed","setDeep","two","uno","v3"] D2 D2 1 uno true` : `-`),
  });

  // (3) namespace object: key order, a binding that does not exist, and the namespace of a chunk loaded by path.
  graphCase("NamespaceImport", {
    files: splitting => ({
      "/entry.ts": /* js */ `
        import * as ns from "./lib";
        const missing = ["nope"][0];
        console.log(JSON.stringify(Object.keys(ns)), JSON.stringify(Object.getOwnPropertyNames(ns)));
        console.log(missing in ns, (ns as any)[missing], typeof ns.default, ns.zeta, ns.alpha(), typeof ns.Mid, new ns.Mid() instanceof ns.Mid);
        ${
          splitting
            ? `const s = (x: string) => x;
        const dyn = await import(s("./lib.ts"));
        console.log(JSON.stringify(Reflect.ownKeys(dyn).map(String)), missing in dyn, dyn[missing], dyn.default, dyn.Mid === ns.Mid);`
            : `console.log("-");`
        }
      `,
      "/lib.ts": /* js */ `
        export const zeta = "z";
        export function alpha() { return "a"; }
        export class Mid {}
        export default "dflt";
        export const équipe = "é";
      `,
    }),
    entries: ["/entry.ts", "/lib.ts"],
    stdout: splitting =>
      `["Mid","alpha","default","zeta","équipe"] ["Mid","alpha","default","zeta","équipe"]\n` +
      `false undefined string z a function true\n` +
      (splitting
        ? `["Mid","alpha","default","zeta","équipe","Symbol(Symbol.toStringTag)"] false undefined dflt true`
        : `-`),
  });

  // (4) default + named mixes; the entry's hoisted `export default function` is called by a cyclic importer before
  // the entry has evaluated.
  graphCase("DefaultAndNamed", {
    files: {
      "/entry.ts": /* js */ `
        import greet, { named, aliased, also as viaAlso, default as viaDefault } from "./lib";
        import * as lib from "./lib";
        import { early } from "./helper";
        export default function hello() { return "hello"; }
        export const late = ["late"][0];
        console.log(greet("x"), named, aliased, viaAlso === greet, viaDefault === greet, lib.default === greet);
        console.log(early);
        const again = await import("./lib");
        console.log(again.default === greet, hello(), late, Object.keys(lib).join());
      `,
      "/lib.ts": /* js */ `
        export default function greet(who: string) { return "hi " + who; }
        export const named = "named";
        export { named as aliased, greet as also };
      `,
      "/helper.ts": /* js */ `
        import hello, { late } from "./entry";
        function tdz() { try { return String(late); } catch (e) { return (e as Error).constructor.name; } }
        export const early = hello() + " from helper, late=" + tdz();
      `,
    },
    entries: ["/entry.ts", "/lib.ts"],
    stdout:
      "hi x named named true true true\n" +
      "hello from helper, late=undefined\n" +
      "true hello late aliased,also,default,named",
  });

  // (5) dynamic import() of a module that is its own chunk and of one that is already statically imported.
  graphCase("DynamicImport", {
    files: {
      "/entry.ts": /* js */ `
        import { shared, tick, ticks } from "./shared";
        console.log("entry", shared, ticks);
        const lazy = await import("./lazy");
        console.log(lazy.value, ticks, lazy.readTicks());
        const again = await import("./shared");
        tick();
        console.log(again.shared === shared, again.ticks, ticks, again === (await import("./shared")), lazy === (await import("./lazy")));
        const [l2, s2] = await Promise.all([import("./lazy2"), import("./shared")]);
        console.log(l2.value, s2.ticks);
      `,
      "/shared.ts": /* js */ `
        export const shared = "S";
        export let ticks = 0;
        export function tick() { ticks++; }
        console.log("shared evaluated");
      `,
      "/lazy.ts": /* js */ `
        import { shared, tick, ticks } from "./shared";
        tick();
        export const value = "lazy:" + shared;
        export function readTicks() { return ticks; }
        console.log("lazy evaluated");
      `,
      "/lazy2.ts": /* js */ `
        import { value as v1 } from "./lazy";
        import { tick } from "./shared";
        tick();
        export const value = "lazy2(" + v1 + ")";
      `,
    },
    entries: ["/entry.ts", "/shared.ts"],
    stdout: "shared evaluated\nentry S 0\nlazy evaluated\nlazy:S 1 1\ntrue 2 2 true true\nlazy2(lazy:S) 3",
  });

  // (6) top-level await in a dependency and in the entry; the sibling after the async dependency waits for it.
  graphCase("TopLevelAwait", {
    files: {
      "/entry.ts": /* js */ `
        import { slow, log } from "./slow";
        import { fast } from "./fast";
        log.push("entry-start");
        const doubled = await new Promise<number>(r => setTimeout(() => r(slow * 2), 1));
        log.push("entry-end");
        console.log(slow, fast, doubled, log.join(">"));
      `,
      "/slow.ts": /* js */ `
        export const log: string[] = ((globalThis as any).log ??= []);
        log.push("slow-start");
        export const slow: number = await new Promise<number>(r => setTimeout(() => r(21), 2));
        log.push("slow-end");
      `,
      "/fast.ts": /* js */ `
        import { log, slow } from "./slow";
        log.push("fast");
        export const fast = "fast" + slow;
      `,
    },
    entries: ["/entry.ts", "/slow.ts", "/fast.ts"],
    stdout: "21 fast21 42 slow-start>slow-end>fast>entry-start>entry-end",
  });

  // (7) CommonJS required/imported from ESM and ESM required from CommonJS inside one executable.
  graphCase("CjsEsmInterop", {
    files: {
      "/entry.ts": /* js */ `
        import cjs, { kind } from "./math.cjs";
        import * as nsCjs from "./math.cjs";
        import { esmValue } from "./esm-dep";
        const required = require("./math.cjs");
        const requiredEsm = require("./esm-dep");
        console.log(cjs.add(2, 3), kind, cjs.fromEsm, cjs.esmDefault, required === cjs, nsCjs.default === cjs, typeof nsCjs.add);
        console.log(esmValue, requiredEsm.esmValue, requiredEsm.default, Object.keys(requiredEsm).sort().join());
        const dyn = await import("./math.cjs");
        console.log(dyn.default === cjs, dyn.kind);
      `,
      "/math.cjs": /* js */ `
        const esm = require("./esm-dep");
        module.exports = { add(a, b) { return a + b; }, kind: "cjs", fromEsm: esm.esmValue, esmDefault: esm.default };
      `,
      "/esm-dep.ts": /* js */ `
        export const esmValue = "esm";
        export default "esm-default";
      `,
    },
    entries: ["/entry.ts", "/esm-dep.ts"],
    stdout: "5 cjs esm esm-default true true function\nesm esm esm-default default,esmValue\ntrue cjs",
  });

  // (8) import.meta inside the entry and inside a bundled dependency.
  graphCase("ImportMeta", {
    files: {
      "/entry.ts": /* js */ `
        import { depMeta } from "./dep";
        const show = (m: { url: string; path: string }) =>
          [m.url.startsWith("file://"), /[$~]bunfs|~BUN/i.test(m.path), m.url.endsWith(m.path.replaceAll("\\\\", "/").split("/").pop()!)].join();
        console.log(show(import.meta), import.meta.main);
        console.log(show(depMeta), depMeta.url === import.meta.url ? "same-chunk" : "other-chunk");
      `,
      "/dep.ts": /* js */ `
        export const depMeta = { url: import.meta.url, path: import.meta.path };
      `,
    },
    entries: ["/entry.ts", "/dep.ts"],
    // Without splitting dep.ts is inlined into the entry chunk; with it, its code lands in the chunk both entry
    // points share.
    stdout: splitting => "true,true,true true\ntrue,true,true " + (splitting ? "other-chunk" : "same-chunk"),
  });

  // (9) a generated 60-module graph (each module imports three later ones, every fourth star-exports the module four
  // on so those chain, every sixth re-exports one binding with `export { as }`) checked against a checksum computed
  // here. With splitting this is 121 chunks and 63 module records at run time.
  {
    const N = 60;
    const deps = (i: number) => [i + 1, i + 5, i + 17].filter(j => j < N);
    const starOf = (i: number) => (i % 4 === 0 && i + 4 < N ? i + 4 : undefined);
    const value: number[] = [];
    for (let i = N - 1; i >= 0; i--) {
      const [a = 0, b = 0, c = 0] = deps(i).map(j => value[j]);
      value[i] = (i + 1 + a * 3 + b * 5 + c * 7) % 1000003;
    }
    const exportsOf = (i: number): Set<string> => {
      const names = new Set([`v${i}`]);
      const d = deps(i);
      if (starOf(i) !== undefined) for (const n of exportsOf(starOf(i)!)) names.add(n);
      if (i % 6 === 0 && d[1] !== undefined) names.add(`r${i}`);
      return names;
    };
    const files: Record<string, string> = {};
    for (let i = 0; i < N; i++) {
      const d = deps(i);
      const names = ["a", "b", "c"];
      let src = d.map((j, k) => `import { v${j} as ${names[k]} } from "./m${j}";`).join("\n") + "\n";
      for (let k = d.length; k < 3; k++) src += `const ${names[k]} = 0;\n`;
      if (starOf(i) !== undefined) src += `export * from "./m${starOf(i)}";\n`;
      if (i % 6 === 0 && d[1] !== undefined) src += `export { v${d[1]} as r${i} } from "./m${d[1]}";\n`;
      src += `export const v${i} = (${i + 1} + a * 3 + b * 5 + c * 7) % 1000003;\n`;
      files[`/m${i}.ts`] = src;
    }
    files["/entry.ts"] = /* js */ `
      import * as m0 from "./m0";
      import * as m12 from "./m12";
      import { v30 } from "./m30";
      const m24 = await import("./m24");
      let sum = 0;
      for (const ns of [m0, m12, m24]) for (const k of Object.keys(ns).sort()) sum = (sum * 31 + ns[k] + k.length) % 1000003;
      console.log(m0.v0, v30, Object.keys(m0).length, Object.keys(m12).length, Object.keys(m24).length, sum);
    `;
    let sum = 0;
    for (const i of [0, 12, 24])
      for (const k of [...exportsOf(i)].sort()) {
        const idx = Number(k.slice(1));
        const v = k[0] === "v" ? value[idx] : value[deps(idx)[1]];
        sum = (sum * 31 + v + k.length) % 1000003;
      }
    graphCase("GeneratedGraph", {
      files: { "/entry.ts": files["/entry.ts"], ...files },
      entries: ["/entry.ts", ...Array.from({ length: N }, (_, i) => `/m${i}.ts`)],
      stdout: [value[0], value[30], exportsOf(0).size, exportsOf(12).size, exportsOf(24).size, sum].join(" "),
      // JSC logs one line per host-hook call. All 63 records (entry chunk, 60 module chunks, the shared chunk and
      // runtime chunk) evaluate either way; with the graph in use only the roots (bun:main, the entry, the import()
      // of m24) go through the host's resolve, without it every cross-chunk import does.
      splitRun: mode => ({
        env: { BUN_JSC_dumpModuleLoadingState: "1" },
        validate({ stderr }) {
          const count = (kind: string) => stderr.split("\n").filter(l => l.startsWith(`Loader [${kind}] `)).length;
          expect(count("evaluate")).toBe(63);
          if (mode === "by-name") expect(count("resolve")).toBeGreaterThan(63);
          else expect(count("resolve")).toBeLessThanOrEqual(6);
        },
      }),
    });
  }

  // (10) class/const bindings read across a cycle before their module has evaluated.
  graphCase("TDZAcrossCycle", {
    files: {
      "/entry.ts": /* js */ `
        import { early, late } from "./a";
        console.log(early.join(), late().join());
      `,
      "/a.ts": /* js */ `
        import { early, probe } from "./b";
        export class Klass { static tag = "K"; }
        export const konst = 42;
        export let lett = "L";
        export function late() { return probe(); }
        export { early };
      `,
      "/b.ts": /* js */ `
        import { Klass, konst, lett } from "./a";
        const attempt = (f: () => unknown) => { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } };
        export function probe() { return [attempt(() => Klass.tag), attempt(() => konst), attempt(() => lett)]; }
        export const early = probe();
      `,
    },
    entries: ["/entry.ts", "/a.ts"],
    // The class keeps its temporal dead zone; bundled top-level const/let are emitted as var.
    stdout: "ReferenceError,undefined,undefined K,42,L",
  });
  // Deleting a graph module's registry entry must not break (or free) what its importers already link against: a
  // function linked after the delete still resolves its imports to the original record, and a fresh import() of the
  // same key makes a new record.
  graphCase("RegistryDelete", {
    files: {
      "/entry.ts": /* js */ `
        import { self, counter, bump } from "./b";
        console.log(counter());
        const wasCached = self in import.meta.require.cache;
        delete import.meta.require.cache[self];
        Bun.gc(true);
        function linkedAfterDelete() { bump(); return counter(); }
        console.log(wasCached, linkedAfterDelete());
        Bun.gc(true);
        if (self !== Bun.main) {
          // With splitting, b's code lives in a chunk of its own: importing that key again makes a fresh record.
          const again = await import(self);
          console.log(Object.values(again).includes(counter) ? "same" : "fresh", counter());
        } else {
          console.log("single", counter());
        }
      `,
      "/b.ts": /* js */ `
        let n = 0;
        export const self = import.meta.path;
        export function bump() { n++; }
        export function counter() { return n; }
      `,
    },
    entries: ["/entry.ts", "/b.ts"],
    // Without splitting everything is the entry module itself, which require.cache does not list.
    stdout: splitting => (splitting ? "0\ntrue 1\nfresh 1" : "0\nfalse 1\nsingle 1"),
  });
});
