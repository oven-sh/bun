import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BundlerTestInput, BundlerTestRunOptions, itBundled as itBundledBase } from "./expectBundled";

// `bun build --compile --bytecode --format=esm` embeds a pre-resolved module graph that JSC's loader consumes instead
// of resolving every import by name at startup. These cases pin ES module linking semantics (cycles, live bindings,
// star exports, namespaces, TLA, CJS interop) for compiled executables: each executable runs with the graph in use,
// with the graph cross-checked against the specification's ResolveExport, and with the graph disabled, and all three
// must print the same thing and nothing on stderr. Without --splitting the bundle is one module record, so only the
// entry's own record (its exports, TLA and import.meta flags, dynamic-import roots) comes from the graph; the
// +splitting variants make every listed entry and every import() target a chunk of its own whose bindings are wired
// across records. GeneratedGraph+splitting also checks the loader log to prove the graph, not by-name resolution,
// linked the chunks.
const itBundled = (id: string, opts: BundlerTestInput) => itBundledBase(id, { backend: "cli", ...opts });

type LoaderMode = "graph" | "graph+validate" | "by-name";
const loaderModes: { mode: LoaderMode; env: Record<string, string> }[] = [
  { mode: "graph", env: {} },
  { mode: "graph+validate", env: { BUN_JSC_validatePrelinkedModuleInfo: "1" } },
  { mode: "by-name", env: { BUN_JSC_usePrelinkedModuleInfo: "0" } },
];

// Windows looks up a new executable's reputation inside its first CreateProcess (seconds under Smart App Control), and
// Bun.spawn makes that call on the JS thread, where it stalls every other case in flight. Started through cmd.exe, the
// wait is cmd.exe's. expectBundled puts bunArgs in front of the executable's path.
const launcher = isWindows ? ["cmd.exe", "/d", "/c"] : [];

function eachMode(run: (mode: LoaderMode) => BundlerTestRunOptions): BundlerTestRunOptions[] {
  return loaderModes.map(({ mode, env }) => {
    const options = run(mode);
    return { ...options, bunArgs: launcher, env: { ...options.env, ...env } };
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

// Registers `compile/prelinked/<id>` (one chunk), `compile/prelinked/<id>+splitting` (entries and dynamic imports
// become separate chunks that import each other's bindings) and `compile/prelinked/<id>+splitting+banner`, the
// +splitting build with `--banner "export {};"`. The bundler's printer never prints a banner, and what the printer
// prints is what a chunk's module record is made from; for a banner with an import or export declaration the record
// of every chunk is JSC's own reading of the chunk's final text instead, made while building. The program has to
// load, link and run the same from those records.
function graphCase(id: string, c: GraphCase) {
  for (const [suffix, splitting, banner] of [
    ["", false, false],
    ["+splitting", true, false],
    ["+splitting+banner", true, true],
  ] as const) {
    const files = variant(c.files, splitting);
    const entries = (splitting && c.entries ? c.entries : banner ? [Object.keys(files)[0]] : undefined)?.map(
      e => "./" + e.replace(/^\//, ""),
    );
    itBundled(`compile/prelinked/${id}${suffix}`, {
      compile: true,
      bytecode: true,
      format: "esm",
      splitting,
      files,
      // The banner goes on the command line as it is, after the entry points: itBundled's `banner` option would put
      // the text in quotes, which makes it a string.
      ...(entries
        ? { entryPointsRaw: banner ? [...entries, "--banner", "export {};"] : entries, outfile: "dist/out" }
        : {}),
      run: eachMode(mode => ({
        stdout: variant(c.stdout, splitting),
        stderr: "",
        ...(entries ? { file: "dist/out" } : {}),
        ...(splitting ? c.splitRun?.(mode) : {}),
      })),
    });
  }
}

// graphCase(), and the same program as `compile/prelinked/<id>+source[+splitting]`: an executable without --bytecode
// embeds no module graph, so its records are made from each chunk's source when it is loaded.
function bindingCase(id: string, c: GraphCase) {
  graphCase(id, c);
  for (const splitting of [false, true]) {
    const entries = splitting && c.entries ? c.entries : undefined;
    itBundled(`compile/prelinked/${id}+source${splitting ? "+splitting" : ""}`, {
      compile: true,
      format: "esm",
      splitting,
      files: variant(c.files, splitting),
      ...(entries ? { entryPointsRaw: entries.map(e => "./" + e.replace(/^\//, "")), outfile: "dist/out" } : {}),
      run: {
        stdout: variant(c.stdout, splitting),
        stderr: "",
        bunArgs: launcher,
        ...(entries ? { file: "dist/out" } : {}),
      },
    });
  }
}

describe.concurrent("bundler", () => {
  // Every case links an executable: `bun build --compile` copies the bun binary and writes it again with the bundle
  // patched in. The 20 links describe.concurrent would start at once ran CI out of memory in bundler_compile.test.ts,
  // so a case takes a slot first, in beforeEach, where its own timeout is not running yet. An ASAN or debug binary is
  // about a gigabyte and its link is bound by disk writeback, so those run one at a time.
  let freeSlots = isASAN || isDebug ? 1 : 3;
  const waiting: (() => void)[] = [];
  beforeEach(async () => {
    if (freeSlots > 0) freeSlots--;
    else await new Promise<void>(resolve => waiting.push(resolve));
  }, Infinity);
  afterEach(() => {
    const next = waiting.shift();
    if (next) next();
    else freeSlots++;
  });

  // (1) cycles: b evaluates before a (entry -> a -> b), calls a hoisted function of a while a is unevaluated, and
  // later reads a's live `counter` binding.
  bindingCase("CycleTwoModules", {
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

  bindingCase("CycleThreeModules", {
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
  bindingCase("StarExportConflict", {
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
  bindingCase("ReExports", {
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
  bindingCase("NamespaceImport", {
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
  bindingCase("DefaultAndNamed", {
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
  bindingCase("DynamicImport", {
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
  bindingCase("TopLevelAwait", {
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
  bindingCase("CjsEsmInterop", {
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
      // JSC logs one line per host-hook call, and nothing else may be on stderr. All 63 records (entry chunk, 60 module
      // chunks, the shared chunk and runtime chunk) evaluate either way, and only the roots (bun:main, the entry, the
      // import() of m24) are fetched. With the graph in use only those roots go through the host's resolve (bun:main
      // and m24 twice each), without it every cross-chunk import statement does too.
      splitRun: mode => ({
        env: { BUN_JSC_dumpModuleLoadingState: "1" },
        stderr: undefined, // the log, checked line by line below
        validate({ stderr }) {
          const hookCalls: Record<string, number> = {};
          for (const line of stderr.trim().split("\n")) {
            const hook = /^Loader \[(\w+)\] /.exec(line)?.[1] ?? `not a loader line: ${line}`;
            hookCalls[hook] = (hookCalls[hook] ?? 0) + 1;
          }
          expect(hookCalls).toEqual({ resolve: mode === "by-name" ? 252 : 5, fetch: 3, evaluate: 63, import: 1 });
        },
      }),
    });
  }

  // (10) class/const bindings read across a cycle before their module has evaluated.
  bindingCase("TDZAcrossCycle", {
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
        const slashes = (p: string) => p.replaceAll("\\\\", "/");
        const key = Object.keys(import.meta.require.cache).find(k => slashes(k) === slashes(self));
        if (key !== undefined) delete import.meta.require.cache[key];
        Bun.gc(true);
        function linkedAfterDelete() { bump(); return counter(); }
        console.log(key !== undefined, linkedAfterDelete());
        Bun.gc(true);
        if (key !== undefined) {
          // With splitting, b's code lives in a chunk of its own: importing that key again makes a fresh record.
          const again = await import(key);
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
  // RegistryDelete for a module that reads imports: deleting its registry entry and importing the key again gives the
  // loader a second record of the same module next to the first, whose functions are hot by then. Both keep running,
  // each against the bindings it links to: imports the graph resolves to another chunk, a named import of a builtin
  // module and a namespace import of one. `exporterToo` also deletes the chunk those imports come from, so the second
  // record links to a second record of that chunk (with its own state) while the first stays linked to the first.
  for (const exporterToo of [false, true]) {
    bindingCase(exporterToo ? "RegistryDeleteImporterAndExporter" : "RegistryDeleteImporter", {
      files: {
        "/entry.ts": /* js */ `
          import { api } from "./b";
          import { stateSelf } from "./state";
          const slashes = (p: string) => p.replaceAll("\\\\", "/");
          const drop = (path: string) => {
            const key = Object.keys(import.meta.require.cache).find(k => slashes(k) === slashes(path));
            if (key !== undefined) delete import.meta.require.cache[key];
            return key;
          };
          console.log(api.loop(20000), api.read());
          const key = drop(api.self);
          console.log(key !== undefined, ${exporterToo} && drop(stateSelf) !== undefined);
          Bun.gc(true);
          if (key !== undefined) {
            const again = await import(key);
            const api2 = Object.values(again).find((v: any) => v && typeof v === "object" && "counter" in v) as typeof api;
            console.log(api2 === api ? "same" : "fresh", api.read(), api2.read());
            api2.bump();
            api2.bump();
            api.bump();
            console.log(api.read(), api2.read(), api.loop(20000), api2.loop(20000));
            const third = await import(key);
            console.log(third === again);
          }
        `,
        "/b.ts": /* js */ `
          import { n, inc } from "./state";
          import { sep } from "node:path";
          import * as os from "node:os";
          function bump() { inc(); }
          function counter() { return n; }
          function read() { return [n, sep === "/" || sep === "\\\\", typeof os.EOL].join(); }
          function loop(k: number) { let r = 0; for (let i = 0; i < k; i++) r = counter(); return r; }
          export const api = { self: import.meta.path, bump, counter, read, loop };
        `,
        "/state.ts": /* js */ `
          export let n = 0;
          export function inc() { n++; }
          export const stateSelf = import.meta.path;
        `,
      },
      entries: ["/entry.ts", "/b.ts", "/state.ts"],
      // Without splitting everything is the entry module itself, which require.cache does not list.
      stdout: splitting =>
        !splitting
          ? "0 0,true,string\nfalse false"
          : exporterToo
            ? "0 0,true,string\ntrue true\nfresh 0,true,string 0,true,string\n1,true,string 2,true,string 1 2\ntrue"
            : "0 0,true,string\ntrue false\nfresh 0,true,string 0,true,string\n3,true,string 3,true,string 3 3\ntrue",
    });
  }

  // The cases below are about how a record reads another record's bindings: every module listed in `entries` is a chunk
  // (module record) of its own under +splitting, so each import in it crosses a record boundary. Namespace imports of
  // builtin modules stay namespace imports in the output (imports of bundled modules are lowered to named bindings), so
  // mixing them with named imports gives a record import lists with namespace entries before, between and after the
  // named ones.
  bindingCase("ImportBindingsNamespaceOrders", {
    files: {
      "/entry.ts": /* js */ `
        import { readFirst } from "./first";
        import { readMiddle } from "./middle";
        import { readLast, bump } from "./last";
        import { readOnlyNamespaces } from "./only-namespaces";
        const all = () => [readFirst(), readMiddle(), readLast(), readOnlyNamespaces()].join(" | ");
        console.log(all());
        bump();
        bump();
        console.log(all());
      `,
      "/state.ts": /* js */ `
        export let counter = 0;
        export function bump() { counter++; }
        export const label = "label";
        export const zeta = "zeta", alpha = "alpha", Mid = "Mid", _under = "_under", $dollar = "$dollar";
      `,
      "/first.ts": /* js */ `
        import * as path from "node:path";
        import * as os from "node:os";
        import { counter, label, zeta } from "./state";
        export function readFirst() { return [counter, label, zeta, typeof path.join, typeof os.EOL].join(); }
      `,
      "/middle.ts": /* js */ `
        import { alpha } from "./state";
        import * as util from "node:util";
        import { counter } from "./state";
        import * as path from "node:path";
        import { Mid, _under } from "./state";
        export function readMiddle() { return [alpha, counter, Mid, _under, typeof util.inspect, path.posix.join("a", "b")].join(); }
      `,
      "/last.ts": /* js */ `
        import { counter, bump, $dollar, zeta, alpha } from "./state";
        import * as os from "node:os";
        import * as util from "node:util";
        import * as path from "node:path";
        export function readLast() { return [counter, $dollar, zeta, alpha, typeof os.EOL, typeof util.format, path.posix.sep].join(); }
        export { bump };
      `,
      "/only-namespaces.ts": /* js */ `
        import * as path from "node:path";
        import * as util from "node:util";
        export function readOnlyNamespaces() { return [path.posix.basename("/a/b.txt"), util.format("%s", "f")].join(); }
      `,
    },
    entries: ["/entry.ts", "/state.ts", "/first.ts", "/middle.ts", "/last.ts", "/only-namespaces.ts"],
    stdout:
      "0,label,zeta,function,string | alpha,0,Mid,_under,function,a/b | 0,$dollar,zeta,alpha,string,function,/ | b.txt,f\n" +
      "2,label,zeta,function,string | alpha,2,Mid,_under,function,a/b | 2,$dollar,zeta,alpha,string,function,/ | b.txt,f",
  });

  // Named, default and namespace imports of builtin modules (whose records are not source text modules) next to
  // imports of other chunks.
  bindingCase("ImportBindingsBuiltinExporters", {
    files: {
      "/entry.ts": /* js */ `
        import { describe, bump } from "./user";
        console.log(describe());
        bump();
        console.log(describe());
      `,
      "/state.ts": /* js */ `
        export let counter = 10;
        export function bump() { counter++; }
      `,
      "/user.ts": /* js */ `
        import fs, { existsSync } from "node:fs";
        import * as path from "node:path";
        import { counter, bump } from "./state";
        import { join, sep, posix } from "node:path";
        import { EventEmitter } from "node:events";
        import assert, { strictEqual } from "node:assert";
        export function describe() {
          strictEqual(fs.existsSync, existsSync);
          assert(path.join === join);
          return [counter, typeof existsSync, posix.join("a", "b"), sep === path.sep, new EventEmitter().listenerCount("x")].join();
        }
        export { bump };
      `,
    },
    entries: ["/entry.ts", "/state.ts", "/user.ts"],
    stdout: "10,function,a/b,true,0\n11,function,a/b,true,0",
  });

  // One record importing many bindings from several records, with live updates of all of them.
  {
    const exporters = 6;
    const perExporter = 16;
    // (the first file is the entry point)
    const files: Record<string, string> = {
      "/entry.ts": /* js */ `
        import { sum, ends, bumpAll } from "./importer";
        console.log(sum(), ends());
        bumpAll();
        console.log(sum(), ends());
        for (let i = 0; i < 1000; i++) bumpAll();
        console.log(sum(), ends());
      `,
    };
    const names: string[] = [];
    for (let m = 0; m < exporters; m++) {
      const own = Array.from({ length: perExporter }, (_, i) => `v${m}_${i}`);
      names.push(...own);
      files[`/exporter${m}.ts`] =
        own.map((name, i) => `export let ${name} = ${m * 100 + i};`).join("\n") +
        `\nexport function bump${m}() { ${own.map(name => `${name}++;`).join(" ")} }`;
    }
    files["/importer.ts"] =
      Array.from(
        { length: exporters },
        (_, m) => `import { ${names.filter(n => n.startsWith(`v${m}_`)).join(", ")}, bump${m} } from "./exporter${m}";`,
      ).join("\n") +
      `\nexport function sum() { return [${names.join(", ")}].reduce((a, b) => a + b, 0); }` +
      `\nexport function ends() { return [${names[0]}, ${names[names.length - 1]}].join(); }` +
      `\nexport function bumpAll() { ${Array.from({ length: exporters }, (_, m) => `bump${m}();`).join(" ")} }`;
    let base = 0;
    for (let m = 0; m < exporters; m++) for (let i = 0; i < perExporter; i++) base += m * 100 + i;
    const count = exporters * perExporter;
    bindingCase("ImportBindingsMany", {
      files,
      entries: ["/entry.ts", "/importer.ts", ...Array.from({ length: exporters }, (_, m) => `/exporter${m}.ts`)],
      stdout: `${base} 0,515\n${base + count} 1,516\n${base + count * 1001} 1001,1516`,
    });
  }

  // Imports that are never read, first read long after their module was evaluated, or first read on a path that is only
  // taken once the function reading them has run many times.
  bindingCase("ImportBindingsFirstUse", {
    files: {
      "/entry.ts": /* js */ `
        import { sometimes, loop, neverCalled, evaluated } from "./user";
        import { bump, setLabel } from "./state";
        console.log(evaluated, loop(20000, false));
        bump();
        setLabel("late");
        console.log(sometimes(true), loop(20000, true));
        console.log(sometimes(false), typeof neverCalled);
        for (let i = 0; i < 3; i++) bump();
        console.log(sometimes(true), neverCalled().join());
      `,
      "/state.ts": /* js */ `
        export let counter = 0;
        export let label = "early";
        export const constant = 42;
        export const unread = "unread";
        export function bump() { counter++; }
        export function setLabel(value: string) { label = value; }
      `,
      "/user.ts": /* js */ `
        import { counter, label, constant, unread } from "./state";
        import * as path from "node:path";
        export const evaluated = true;
        export function sometimes(flag: boolean) {
          if (flag) return [constant, label, counter, path.posix.sep].join();
          return 0;
        }
        export function loop(n: number, flag: boolean) {
          let result: unknown;
          for (let i = 0; i < n; i++) result = sometimes(flag);
          return result;
        }
        export function neverCalled() { return [unread, counter]; }
      `,
    },
    entries: ["/entry.ts", "/state.ts", "/user.ts"],
    stdout: "true 0\n42,late,1,/ 42,late,1,/\n0 function\n42,late,4,/ unread,4",
  });

  // One exported variable reaching a record under several names and through re-exporting records.
  bindingCase("ImportBindingsAliasesAndReExports", {
    files: {
      "/entry.ts": /* js */ `
        import { read, bump } from "./user";
        console.log(read());
        bump();
        console.log(read());
      `,
      "/state.ts": /* js */ `
        export let counter = 0;
        export function bump() { counter++; }
        export const fixed = "fixed";
      `,
      "/renamed.ts": /* js */ `
        export { counter as total, bump as increase } from "./state";
      `,
      "/starred.ts": /* js */ `
        export * from "./state";
        export const own = "own";
      `,
      "/chained.ts": /* js */ `
        export * from "./starred";
        export { total as grandTotal } from "./renamed";
      `,
      "/user.ts": /* js */ `
        import { counter as one, counter as two, bump } from "./state";
        import { total, increase } from "./renamed";
        import { counter as viaStar, own } from "./starred";
        import { grandTotal, fixed, counter as viaChain } from "./chained";
        export function read() { return [one, two, total, viaStar, grandTotal, viaChain, own, fixed, increase === bump].join(); }
        export { bump };
      `,
    },
    entries: ["/entry.ts", "/state.ts", "/renamed.ts", "/starred.ts", "/chained.ts", "/user.ts"],
    stdout: "0,0,0,0,0,0,own,fixed,true\n1,1,1,1,1,1,own,fixed,true",
  });

  // A record loaded by import() after the records it imports from have long been evaluated, and loaded a second time.
  bindingCase("ImportBindingsDynamicImporter", {
    files: {
      "/entry.ts": /* js */ `
        import { counter, bump } from "./state";
        bump();
        const late = await import("./late");
        console.log(counter, late.read());
        bump();
        const again = await import("./late");
        console.log(again === late, counter, again.read());
      `,
      "/state.ts": /* js */ `
        export let counter = 0;
        export function bump() { counter++; }
      `,
      "/late.ts": /* js */ `
        import { counter, bump } from "./state";
        import * as path from "node:path";
        export const seenAtLoad = counter;
        export function read() { return [seenAtLoad, counter, path.posix.sep, typeof bump].join(); }
      `,
    },
    entries: ["/entry.ts", "/state.ts"],
    stdout: "1 1,1,/,function\ntrue 2 1,2,/,function",
  });

  // --banner and --footer are text in every chunk that the bundler's printer never prints, and the module record of
  // a chunk is made from what the printer prints. What that text says of the module still has to be in the record:
  // without it the executable reads an import.meta slot nothing filled (a segfault), finishes before its awaits
  // settle, or runs with the banner's imports unbound. import.meta and a top-level await are two flags, which are
  // added to the printer's record. An import or an export is an entry, and a piece that is no JavaScript on its own
  // can be half of anything: for those the record of every chunk is JSC's own reading of the chunk's final text,
  // made while building.
  // Every executable runs in the three loader modes, and once more to show that no chunk was left for JSC to read
  // at startup. ("api": itBundled's "cli" backend wraps the text in quotes.)
  const bannerFooterCases: {
    name: string;
    banner?: string;
    footer?: string;
    splitting?: boolean;
    minify?: boolean;
    files: Record<string, string>;
    stdout: string;
    /** With the graph in use: how often the loader may call the host's fetch and resolve hooks, and evaluates. */
    loaderHookCalls?: { fetch: number; resolve: number; evaluate: number };
  }[] = [
    {
      // Flags. Also read under typeof, and from a closure after the module body has run.
      name: "ImportMeta",
      banner: `const metaLater = () => typeof import.meta.dir; console.log("banner", typeof import.meta.url, typeof import.meta);`,
      footer: `console.log("footer", typeof import.meta.url, metaLater());`,
      files: { "/entry.ts": `console.log("entry");` },
      stdout: "banner string object\nentry\nfooter string string",
    },
    {
      // Flags.
      name: "TopLevelAwait",
      banner: `console.log("banner", await Promise.resolve("awaited"));`,
      footer: `for await (const value of [Promise.resolve("awaited")]) console.log("footer", value);`,
      files: { "/entry.ts": `console.log("entry");` },
      stdout: "banner awaited\nentry\nfooter awaited",
    },
    {
      // Entries: a default, a named and a namespace import, and the banner esbuild users write for ESM output. The
      // entry reads what the banner declared.
      name: "Imports",
      banner: `import os from "node:os"; import { join } from "node:path"; import * as util from "node:util"; import { createRequire } from "node:module"; const bannerRequire = createRequire(import.meta.url); console.log("banner", typeof os.platform, typeof join, typeof util.inspect);`,
      files: {
        "/entry.ts": `
          declare const bannerRequire: NodeJS.Require;
          console.log("entry", typeof bannerRequire("node:fs").readFileSync);
        `,
      },
      stdout: "banner function function function\nentry function",
    },
    {
      // An import is the only thing the text says.
      name: "ImportOnly",
      banner: `import { platform as bannerPlatform } from "node:os";`,
      files: {
        "/entry.ts": `
          declare const bannerPlatform: () => string;
          console.log("entry", typeof bannerPlatform);
        `,
      },
      stdout: "entry function",
    },
    {
      // An export in the footer is the only thing the text says: the banner is a plain statement.
      name: "FooterExportOnly",
      splitting: true,
      banner: `console.log("banner");`,
      footer: `export const fromFooter = "footer";`,
      files: {
        "/entry.ts": `console.log("entry", (await import("./lazy")).fromFooter);`,
        "/lazy.ts": `export const value = 1;`,
      },
      stdout: "banner\nbanner\nentry footer",
    },
    {
      // The text is in the chunk both others import from and in the import() targets, one of them a JSON chunk
      // that gets a record but no bytecode. Each exports what the footer declares, and the entry reads that through
      // the targets' namespaces. The records are embedded all the same: loading costs what it costs without the
      // banner and footer (fetch 4, resolve 7), not what it costs when JSC makes each record from the chunk's source
      // as it loads (fetch 6, resolve 13).
      name: "EveryChunk",
      splitting: true,
      banner: `import { sep as bannerSep } from "node:path"; const bannerMeta = typeof import.meta.url;`,
      footer: `export const fromFooter = [bannerMeta, typeof bannerSep, await Promise.resolve("awaited")].join(" ");`,
      files: {
        "/entry.ts": `
          import { shared } from "./shared";
          const lazy = await import("./lazy");
          const data = await import("./data.json");
          console.log(shared, lazy.value, lazy.fromFooter, data.default.key, data.fromFooter);
        `,
        "/shared.ts": `export const shared = "shared";`,
        "/lazy.ts": `
          import { shared } from "./shared";
          export const value = "lazy+" + shared;
        `,
        "/data.json": `{ "key": "value" }`,
      },
      stdout: "shared lazy+shared string string awaited value string string awaited",
      loaderHookCalls: { fetch: 4, resolve: 7, evaluate: 5 },
    },
    {
      // The names of a record JSC made have to be the atoms the bytecode reads them by: Latin-1, UTF-16, empty.
      name: "NonAsciiNames",
      splitting: true,
      banner: `export {};`,
      files: {
        "/entry.ts": `
          import { a, café, слово, "" as empty } from "./names";
          const { lazy } = await import("./lazy");
          console.log(a, café, слово, empty, lazy());
        `,
        "/names.ts": `
          export const a = 1, café = 2, слово = 3;
          const empty = 4;
          export { empty as "" };
        `,
        "/lazy.ts": `
          import { café, слово } from "./names";
          export function lazy() { return café + слово; }
        `,
      },
      stdout: "1 2 3 4 5",
    },
    ...[false, true].map(minify => ({
      // A star export, a namespace export and an indirect one, read through the chunk's namespace.
      name: "ReExports" + (minify ? "+minify" : ""),
      splitting: true,
      minify,
      banner: `export {};`,
      files: {
        "/entry.ts": `
          const mod = await import("./reexports.ts");
          console.log(typeof mod.fs.readFileSync, typeof mod.join, typeof mod.rfs);
        `,
        "/reexports.ts": `
          export * from "node:path";
          export * as fs from "node:fs";
          export { readFileSync as rfs } from "node:fs";
        `,
      },
      stdout: "function function function",
    })),
    {
      // A default export of something that has no name.
      name: "AnonymousDefaultExport",
      splitting: true,
      footer: `export default "footer default";`,
      files: {
        "/entry.ts": `console.log("entry", (await import("./lazy")).default);`,
        "/lazy.ts": `export const value = 1;`,
      },
      stdout: "entry footer default",
    },
    {
      // The footer exports what the banner declares: neither piece says so alone, and the printer prints neither.
      name: "ExportAcrossPieces",
      splitting: true,
      banner: `var fromBanner = "banner value";`,
      footer: `export { fromBanner };`,
      files: {
        "/entry.ts": `console.log("entry", (await import("./lazy")).fromBanner);`,
        "/lazy.ts": `export const value = 1;`,
      },
      stdout: "entry banner value",
    },
    {
      // Neither piece is JavaScript on its own. What the pair says is only in the chunk's final text.
      name: "StatementAroundChunk",
      banner: `try {`,
      footer: `} finally { console.log("footer", typeof import.meta.url, await Promise.resolve("awaited")); }`,
      files: { "/entry.ts": `console.log("entry");` },
      stdout: "entry\nfooter string awaited",
    },
    {
      // The pair takes text away: the exports the printer printed are not in the module JSC compiles.
      name: "CommentAroundChunk",
      banner: `/*`,
      footer: `*/ console.log("footer only");`,
      files: {
        "/entry.ts": `
          export const answer = 42;
          export default function hello() {}
          console.log("entry");
        `,
      },
      stdout: "footer only",
    },
    {
      // The printer's record lets a TypeScript module re-export a name its import does not have, which may be a
      // type (a build without --bytecode throws a SyntaxError here). A record JSC made for the banner's sake allows
      // what the build allows without the banner.
      name: "TypeScriptReExport",
      banner: `import { sep as bannerSep } from "node:path"; console.log("banner", typeof bannerSep);`,
      files: {
        "/entry.ts": `
          import { NotExported, join } from "node:path";
          export { NotExported, join };
          console.log("entry", typeof join);
        `,
      },
      stdout: "banner string\nentry function",
    },
  ];

  // The chunks JSC read the source of to make their record: it prints the key of each such module.
  const recordsMadeFromSource = (stderr: string) =>
    [...stderr.matchAll(/^Analyzing ModuleRecord key\('([^']*)'\)/gm)]
      .map(m => m[1])
      .filter(key => /[$~]bunfs|~BUN/i.test(key));

  for (const c of bannerFooterCases) {
    const { loaderHookCalls } = c;
    itBundled(`compile/prelinked/BannerFooter/${c.name}`, {
      backend: "api",
      compile: true,
      bytecode: true,
      format: "esm",
      splitting: c.splitting,
      ...(c.minify && { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true }),
      banner: c.banner,
      footer: c.footer,
      files: c.files,
      run: [
        ...eachMode(() => ({ stdout: c.stdout, stderr: "" })),
        {
          stdout: c.stdout,
          bunArgs: launcher,
          env: { BUN_JSC_dumpModuleRecord: "1" },
          validate({ stderr }) {
            expect(recordsMadeFromSource(stderr)).toEqual([]);
          },
        },
        ...(loaderHookCalls
          ? [
              {
                stdout: c.stdout,
                bunArgs: launcher,
                // JSC logs one line per call of a host hook, and nothing else may be on stderr.
                env: { BUN_JSC_dumpModuleLoadingState: "1" },
                validate({ stderr }: { stderr: string }) {
                  const calls: Record<string, number> = {};
                  for (const line of stderr.trim().split("\n")) {
                    const hook = /^Loader \[(\w+)\] /.exec(line)?.[1] ?? `not a loader line: ${line}`;
                    calls[hook] = (calls[hook] ?? 0) + 1;
                  }
                  expect(Object.keys(calls).sort()).toEqual(["evaluate", "fetch", "import", "resolve"]);
                  expect(calls.evaluate).toBe(loaderHookCalls.evaluate);
                  expect(calls.fetch).toBeLessThanOrEqual(loaderHookCalls.fetch);
                  expect(calls.resolve).toBeLessThanOrEqual(loaderHookCalls.resolve);
                },
              },
            ]
          : []),
      ],
    });
  }

  // The cases below need the command line, the build's environment, or a path only known once the files exist.
  // A debug build's link alone takes about as long as the default timeout; itBundled sets the same for its tests.
  const spawnTimeout = isCI ? undefined : isDebug ? Infinity : 30_000;
  const exe = (dir: string, name = "app") => join(dir, isWindows ? name + ".exe" : name);

  async function build(dir: string, args: string[], env: Record<string, string> = {}, bytecode = true) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", ...(bytecode ? ["--bytecode"] : []), "--format=esm", ...args],
      env: { ...bunEnv, ...env },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  async function run(dir: string, file: string, env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [...launcher, file],
      env: { ...bunEnv, ...env },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const runEachMode = async (dir: string, file: string) =>
    Object.fromEntries(
      await Promise.all(loaderModes.map(async ({ mode, env }) => [mode, await run(dir, file, env)] as const)),
    );
  const inEachMode = <T>(result: T) => Object.fromEntries(loaderModes.map(({ mode }) => [mode, result]));

  // The report this came from, through the command line: the executable crashed before "app ok" with the banner
  // and after it with the footer.
  test(
    "compile/prelinked/BannerFooter/CLI",
    async () => {
      using dir = tempDir("compile-prelinked-banner-cli", { "app.mjs": `console.log("app ok");` });
      const built = await build(String(dir), [
        "--banner",
        `console.log(typeof import.meta.url);`,
        "--footer",
        `console.log(typeof import.meta.dir);`,
        "./app.mjs",
        "--outfile",
        exe(String(dir)),
      ]);
      expect(built).toEqual({ stderr: expect.not.stringContaining("error"), exitCode: 0 });
      expect(await runEachMode(String(dir), exe(String(dir)))).toEqual(
        inEachMode({ stdout: "string\napp ok\nstring\n", stderr: "", exitCode: 0 }),
      );
    },
    spawnTimeout,
  );

  // Requests with a type and a deferred one, for files that are not in the executable.
  test(
    "compile/prelinked/BannerFooter/TypedAndDeferredImports",
    async () => {
      using dir = tempDir("compile-prelinked-banner-typed", {
        "app.mjs": `console.log("app ok");`,
        "extra.json": `{ "key": "from json" }`,
        "extra.txt": `from text`,
      });
      const url = (file: string) => JSON.stringify(pathToFileURL(join(String(dir), file)).href);
      const built = await build(String(dir), [
        "--banner",
        `import bannerJson from ${url("extra.json")} with { type: "json" }; import bannerText from ${url("extra.txt")} with { type: "text" }; import defer * as bannerOs from "node:os"; console.log("banner", bannerJson.key, bannerText, typeof bannerOs.platform);`,
        "./app.mjs",
        "--outfile",
        exe(String(dir)),
      ]);
      expect(built).toEqual({ stderr: expect.not.stringContaining("error"), exitCode: 0 });
      expect(await runEachMode(String(dir), exe(String(dir)))).toEqual(
        inEachMode({ stdout: "banner from json from text function\napp ok\n", stderr: "", exitCode: 0 }),
      );
      const startup = await run(String(dir), exe(String(dir)), { BUN_JSC_dumpModuleRecord: "1" });
      expect(recordsMadeFromSource(startup.stderr)).toEqual([]);
    },
    spawnTimeout,
  );

  // Which of the three a build does, seen from outside: JSC prints each record it makes from source.
  test(
    "compile/prelinked/BannerFooter/RecordsJSCMakesWhileBuilding",
    async () => {
      using dir = tempDir("compile-prelinked-banner-gate", {
        "entry.ts": `
          import index from "./index.html";
          const lazy = await import("./lazy.ts");
          console.log(typeof index, lazy.value);
        `,
        "lazy.ts": `export const value = "lazy";`,
        "index.html": `<!doctype html><html><body><script type="module" src="./client.ts"></script></body></html>`,
        "client.ts": `document.body.textContent = "client";`,
      });
      const recordsMade = async (name: string, args: string[]) => {
        const built = await build(
          String(dir),
          [...args, "--splitting", "./entry.ts", "--outfile", exe(String(dir), name)],
          { BUN_JSC_dumpModuleRecord: "1" },
        );
        expect(built.exitCode).toBe(0);
        const ran = await run(String(dir), exe(String(dir), name));
        expect(ran).toEqual({ stdout: "object lazy\n", stderr: "", exitCode: 0 });
        return recordsMadeFromSource(built.stderr).length;
      };
      expect({
        // Text that says nothing of the module, whatever it spells: the printer's records, as without it.
        none: await recordsMade("none", [
          "--banner",
          `/* import.meta */ "use client"; var text = "await import export";`,
          "--footer",
          `// export default import.meta`,
        ]),
        // Flags only: the printer's records again.
        flags: await recordsMade("flags", ["--banner", `import.meta.url; await 0;`]),
        // An entry: the entry's chunk and the import() target's, and not the chunk the page is served.
        entries: await recordsMade("entries", ["--footer", `export {};`]),
      }).toEqual({ none: 0, flags: 0, entries: 2 });
    },
    spawnTimeout,
  );

  // With such a banner a chunk can be text JSC does not take, here one that imports what the banner imports. It
  // has no record to give and the build says it made no bytecode for it; the executable then reads that chunk's
  // source when it is asked for, as a build without --bytecode does for every chunk, and fails there the same way.
  test(
    "compile/prelinked/BannerFooter/ChunkThatDoesNotParse",
    async () => {
      using dir = tempDir("compile-prelinked-banner-no-record", {
        "entry.mjs": `
          console.log("entry start");
          const settle = async f => { try { return (await f()).value; } catch (e) { return String(e).split("\\n")[0]; } };
          console.log("via:", await settle(() => import("./via.mjs")));
          console.log("plain:", await settle(() => import("./plain.mjs")));
          console.log("via again:", await settle(() => import("./via.mjs")));
        `,
        "via.mjs": `
          import { createRequire } from "node:module";
          import { common } from "./common.mjs";
          export const value = "via+" + typeof createRequire(import.meta.url) + "+" + common;
        `,
        "plain.mjs": `
          import { common } from "./common.mjs";
          export const value = "plain+" + common;
        `,
        "common.mjs": `export const common = "common";`,
      });
      const args = (name: string) => [
        "--splitting",
        "--banner",
        `import { createRequire } from "node:module"; const bannerRequire = createRequire(import.meta.url);`,
        "./entry.mjs",
        "--outfile",
        exe(String(dir), name),
      ];
      const built = await build(String(dir), args("app"));
      expect({
        bytecodeFailures: built.stderr.split("\n").filter(line => line.includes("Failed to generate bytecode for"))
          .length,
        exitCode: built.exitCode,
      }).toEqual({ bytecodeFailures: 1, exitCode: 0 });

      expect((await build(String(dir), args("source"), {}, false)).exitCode).toBe(0);
      const expected = await run(String(dir), exe(String(dir), "source"));
      const [, viaFails] = expected.stdout.split("\n");
      expect(expected).toEqual({
        stdout: [
          "entry start",
          viaFails,
          "plain: plain+common",
          "via again: " + viaFails.slice("via: ".length),
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      });
      expect(viaFails).toStartWith("via: SyntaxError");
      expect(await runEachMode(String(dir), exe(String(dir)))).toEqual(inEachMode(expected));
    },
    spawnTimeout,
  );

  // One payload for every chunk, laid out by what a run read: the records of such a link come from the same place.
  test(
    "compile/prelinked/BannerFooter/BytecodeOrder",
    async () => {
      using dir = tempDir("compile-prelinked-banner-order", {
        "entry.mjs": `
          import { shared } from "./shared.mjs";
          const lazy = await import("./lazy.mjs");
          console.log(shared, lazy.value, typeof bannerPlatform);
        `,
        "shared.mjs": `export const shared = "shared";`,
        "lazy.mjs": `
          import { shared } from "./shared.mjs";
          export const value = "lazy+" + shared;
        `,
      });
      const args = ["--splitting", "--banner", `import { platform as bannerPlatform } from "node:os";`, "./entry.mjs"];
      const expected = { stdout: "shared lazy+shared function\n", stderr: "", exitCode: 0 };

      expect(await build(String(dir), [...args, "--outfile", exe(String(dir), "plain")])).toEqual({
        stderr: expect.not.stringContaining("error"),
        exitCode: 0,
      });
      const order = join(String(dir), "app.order");
      expect(await run(String(dir), exe(String(dir), "plain"), { BUN_BYTECODE_ORDER_OUT: order })).toEqual(expected);

      expect(
        await build(String(dir), [...args, "--bytecode-order=app.order", "--outfile", exe(String(dir), "ordered")]),
      ).toEqual({
        stderr: expect.not.stringContaining("error"),
        exitCode: 0,
      });
      expect(await runEachMode(String(dir), exe(String(dir), "ordered"))).toEqual(inEachMode(expected));
    },
    spawnTimeout,
  );
});
