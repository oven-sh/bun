import { afterEach, beforeEach, describe } from "bun:test";
import { isASAN, isDebug, isWindows } from "harness";
import { BundlerTestInput, BundlerTestRunOptions, itBundled as itBundledBase } from "./expectBundled";

// Bun.unsafe.ModuleGraph inside `bun build --compile --bytecode --format=esm` executables: each graph's loader gets
// its own records of the embedded modules. The entry of every case imports ITSELF (`import.meta.url`) or another
// embedded entry point (`import.meta.resolve("./other.ts")`) through graphs and branches on the `tenant` graph global:
// the host's instance drives and prints, the graphs' instances report through a `report` graph global. As in
// bundler_compile_prelinked.test.ts, each executable runs with the pre-resolved module graph in use, with it
// cross-checked against the specification's ResolveExport, and with it disabled; all three must print the same thing,
// nothing on stderr, and exit 0.
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
  files: Record<string, string>;
  /** Written next to the bundle after it is built; never embedded. The executable runs with the bundle root as cwd. */
  runtimeFiles?: Record<string, string>;
  stdout: PerVariant<string>;
  /**
   * Every file listed here is also an entry point, which embeds it under a path of its own that a run-time import()
   * or graph.import() can name. With splitting it is a chunk that shares the state of the modules it has in common
   * with the main entry; without splitting it is a bundle of its own with its own copy of them.
   */
  entries: string[];
}

// Registers `compile/module-graph/<id>` (one bundle per entry point) and `compile/module-graph/<id>+splitting`
// (entries and dynamic imports become separate chunks that import each other's bindings).
function graphCase(id: string, c: GraphCase) {
  for (const splitting of [false, true]) {
    itBundled(`compile/module-graph/${id}${splitting ? "+splitting" : ""}`, {
      compile: true,
      bytecode: true,
      format: "esm",
      splitting,
      files: c.files,
      runtimeFiles: c.runtimeFiles,
      entryPointsRaw: c.entries.map(e => "./" + e.replace(/^\//, "")),
      outfile: "dist/out",
      run: eachMode(() => ({
        stdout: variant(c.stdout, splitting),
        stderr: "",
        file: "dist/out",
        setCwd: c.runtimeFiles !== undefined,
      })),
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

  // Three graphs and the host each have their own state, and an import() made by a graph's entry stays in that graph:
  // it is the namespace graph.import() and import.meta.require() of the same embedded entry point give for that graph.
  graphCase("StateAndImportAffinity", {
    files: {
      "/entry.ts": /* js */ `
        import { bump, counter } from "./state";
        declare const tenant: string | undefined;
        declare const report: (line: string) => void;
        const runtime = (specifier: string) => specifier;
        export const lazy = typeof tenant === "undefined" ? undefined : import(runtime("./lazy.ts"));
        export const required = () => import.meta.require(runtime("./lazy.ts"));
        if (typeof tenant === "undefined") {
          bump();
          const names = ["a", "b", "c"];
          const lines: string[] = [];
          const graphs = names.map(name => new (Bun.unsafe as any).ModuleGraph({ globals: { tenant: name, report: (line: string) => lines.push(line) } }));
          const selves: any[] = [];
          for (const graph of graphs) selves.push(await graph.import(import.meta.url));
          const lazies: any[] = [];
          for (const [i, graph] of graphs.entries()) {
            const own = await selves[i].lazy;
            lazies.push(own);
            const viaGraph = await graph.import(import.meta.resolve("./lazy.ts"));
            lines.push(names[i] + " lazy " + own.describe() + " " + (own === viaGraph) + " " + (own.describe === selves[i].required().describe));
          }
          const hostLazy = await import(runtime("./lazy.ts"));
          lines.push("host " + counter() + " " + hostLazy.describe() + " distinct " + new Set([hostLazy, ...lazies]).size + " " + new Set(selves).size);
          console.log(lines.join("\\n"));
        } else {
          for (let i = 0; i < tenant.charCodeAt(0) - 96; i++) bump();
          report(tenant + " " + counter());
        }
      `,
      "/state.ts": /* js */ `
        let n = 0;
        export function bump() { n++; }
        export function counter() { return n; }
      `,
      "/lazy.ts": /* js */ `
        import { bump, counter } from "./state";
        declare const tenant: string | undefined;
        bump();
        export function describe() { return (typeof tenant === "undefined" ? "host" : tenant) + ":" + counter(); }
      `,
    },
    entries: ["/entry.ts", "/lazy.ts"],
    // Without splitting lazy.ts is a bundle with its own copy of state.ts, so its counter only sees its own bump().
    stdout: splitting =>
      splitting
        ? "a 1\nb 2\nc 3\na lazy a:2 true true\nb lazy b:3 true true\nc lazy c:4 true true\nhost 2 host:2 distinct 4 3"
        : "a 1\nb 2\nc 3\na lazy a:1 true true\nb lazy b:1 true true\nc lazy c:1 true true\nhost 1 host:1 distinct 4 3",
  });

  // Graph globals are variables of every embedded module of that graph (the entry, a bundled dependency, another
  // entry point loaded at run time): assignment writes the graph's variable, a module's own top-level declaration
  // shadows it, and neither the host's instance, the options object, globalThis nor `new Function` code sees it.
  graphCase("Globals", {
    files: {
      "/entry.ts": /* js */ `
        import { readTenant, writeTenant, viaFunctionConstructor } from "./dep";
        import { shadowed } from "./shadow";
        declare let tenant: string | undefined;
        declare const report: (line: string) => void;
        const runtime = (specifier: string) => specifier;
        if (typeof tenant === "undefined") {
          const lines: string[] = [];
          for (const name of ["a", "b"]) {
            const globals = { tenant: name, report: (line: string) => lines.push(line) };
            await new (Bun.unsafe as any).ModuleGraph({ globals }).import(import.meta.url);
            lines.push(name + " options object " + globals.tenant);
          }
          lines.push("host " + readTenant() + " " + typeof (globalThis as any).tenant + " " + shadowed());
          console.log(lines.join("\\n"));
        } else {
          const lazy = await import(runtime("./lazy.ts"));
          const before = [tenant, readTenant(), lazy.readTenant()].join();
          writeTenant(tenant + "!");
          const afterDep = [tenant, readTenant(), lazy.readTenant()].join();
          lazy.writeTenant(tenant + "?");
          const afterLazy = [tenant, readTenant(), lazy.readTenant()].join();
          report([before, afterDep, afterLazy, shadowed(), viaFunctionConstructor()].join(" "));
        }
      `,
      "/dep.ts": /* js */ `
        declare let tenant: string | undefined;
        export function readTenant() { return typeof tenant === "undefined" ? "none" : tenant; }
        export function writeTenant(value: string) { tenant = value; }
        export function viaFunctionConstructor() { return new Function("return typeof tenant")(); }
      `,
      "/shadow.ts": /* js */ `
        const tenant = ["shadow"][0];
        export function shadowed() { return tenant; }
      `,
      "/lazy.ts": /* js */ `
        declare let tenant: string | undefined;
        export function readTenant() { return tenant; }
        export function writeTenant(value: string) { tenant = value; }
      `,
    },
    entries: ["/entry.ts", "/lazy.ts"],
    stdout:
      "a,a,a a!,a!,a! a!?,a!?,a!? shadow undefined\na options object a\n" +
      "b,b,b b!,b!,b! b!?,b!?,b!? shadow undefined\nb options object b\n" +
      "host none undefined shadow",
  });

  // An import cycle (entry -> a -> b -> a) whose live bindings are per graph: b calls a hoisted function of a while a
  // is unevaluated, and reads a's `counter` after each instance bumped its own.
  graphCase("CycleAcrossChunks", {
    files: {
      "/entry.ts": /* js */ `
        import { fromA, counter, bump } from "./a";
        import { fromB, readCounterFromB, bumpViaB } from "./b";
        declare const tenant: string | undefined;
        declare const report: (line: string) => void;
        const runtime = (specifier: string) => specifier;
        const bumps = typeof tenant === "undefined" ? 1 : tenant.length + 1;
        for (let i = 0; i < bumps; i++) bump();
        bumpViaB();
        const again = await import(runtime("./a.ts"));
        const line = [fromA, fromB, counter, readCounterFromB(), again.counter, again.bump === bump].join(" | ");
        if (typeof tenant === "undefined") {
          const lines: string[] = [];
          for (const name of ["x", "yy"]) {
            await new (Bun.unsafe as any).ModuleGraph({ globals: { tenant: name, report: (line: string) => lines.push(line) } }).import(import.meta.url);
          }
          console.log([...lines, line, counter].join("\\n"));
        } else {
          report(line);
        }
      `,
      "/a.ts": /* js */ `
        import { describeB } from "./b";
        declare const tenant: string | undefined;
        export let counter = 0;
        export function bump() { counter++; }
        export function nameA() { return "A" + (typeof tenant === "undefined" ? "" : tenant); }
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
    // Of the cycle only the module the main entry imports first is listed; see bundler_compile_prelinked.test.ts.
    entries: ["/entry.ts", "/a.ts"],
    // Without splitting the a.ts entry point is a bundle with its own copy of the cycle.
    stdout: splitting =>
      splitting
        ? "a sees B(Ax) | b sees Ax | 3 | 3 | 3 | true\na sees B(Ayy) | b sees Ayy | 4 | 4 | 4 | true\na sees B(A) | b sees A | 2 | 2 | 2 | true\n2"
        : "a sees B(Ax) | b sees Ax | 3 | 3 | 0 | false\na sees B(Ayy) | b sees Ayy | 4 | 4 | 0 | false\na sees B(A) | b sees A | 2 | 2 | 0 | false\n2",
  });

  // Two graphs evaluate the same embedded module with top-level await at the same time; the host releases the second
  // graph's await first, and the first graph's instance is still suspended when the second graph's import has settled.
  graphCase("TopLevelAwaitConcurrent", {
    files: {
      "/entry.ts": /* js */ `
        import { value, log } from "./slow";
        import { fast } from "./fast";
        declare const tenant: string | undefined;
        declare const report: (line: string) => void;
        if (typeof tenant === "undefined") {
          const lines: string[] = [];
          const start = (name: string) => {
            const gate = Promise.withResolvers<string>(), started = Promise.withResolvers<void>();
            const graph = new (Bun.unsafe as any).ModuleGraph({
              globals: { tenant: name, gate: gate.promise, started: started.resolve, report: (line: string) => lines.push(line) },
            });
            return { gate, started: started.promise, imported: graph.import(import.meta.url) };
          };
          const a = start("a"), b = start("b");
          await Promise.all([a.started, b.started]);
          lines.push("both suspended");
          b.gate.resolve("released first");
          lines.push("b imported " + (await b.imported).value);
          a.gate.resolve("released second");
          lines.push("a imported " + (await a.imported).value);
          console.log([...lines, "host " + value + " " + fast + " " + log.join(">")].join("\\n"));
        } else {
          report(tenant + " entry " + value + " " + fast + " " + log.join(">"));
        }
        export { value };
      `,
      "/slow.ts": /* js */ `
        declare const gate: Promise<string> | undefined;
        declare const started: () => void;
        export const log: string[] = [];
        log.push("slow-start");
        if (typeof gate !== "undefined") started();
        export const value = typeof gate === "undefined" ? "host" : await gate;
        log.push("slow-end");
      `,
      "/fast.ts": /* js */ `
        import { log, value } from "./slow";
        log.push("fast");
        export const fast = "fast(" + value + ")";
      `,
    },
    entries: ["/entry.ts", "/slow.ts", "/fast.ts"],
    stdout:
      "both suspended\n" +
      "b entry released first fast(released first) slow-start>slow-end>fast\n" +
      "b imported released first\n" +
      "a entry released second fast(released second) slow-start>slow-end>fast\n" +
      "a imported released second\n" +
      "host host fast(host) slow-start>slow-end>fast",
  });

  // Uncaught exceptions and unhandled rejections raised by embedded graph code (the entry, a bundled dependency, a
  // function of the graph the host hands to setImmediate) reach that graph's onError: nothing on stderr, exit code 0.
  graphCase("OnError", {
    files: {
      "/entry.ts": /* js */ `
        import { rejectInDependency, throwLater } from "./raises";
        declare const tenant: string | undefined;
        if (typeof tenant === "undefined") {
          const names = ["a", "b"];
          const seen: Record<string, string[]> = { a: [], b: [] };
          const all = names.map(name => {
            const done = Promise.withResolvers<void>();
            const graph = new (Bun.unsafe as any).ModuleGraph({
              globals: { tenant: name },
              onError(error: Error) {
                if (seen[name].push(error.message) === 4) done.resolve();
              },
            });
            graph.import(import.meta.url).then((self: any) => setImmediate(self.throwLater));
            return done.promise;
          });
          await Promise.all(all);
          for (const name of names) console.log(name + ": " + seen[name].sort().join(", "));
        } else {
          queueMicrotask(() => { throw new Error("exception in " + tenant); });
          Promise.reject(new Error("rejection in " + tenant));
          rejectInDependency();
        }
        export { throwLater };
      `,
      "/raises.ts": /* js */ `
        declare const tenant: string;
        export function rejectInDependency() { Promise.reject(new Error("dependency rejection in " + tenant)); }
        export function throwLater() { throw new Error("late exception in " + tenant); }
      `,
    },
    entries: ["/entry.ts", "/raises.ts"],
    stdout:
      "a: dependency rejection in a, exception in a, late exception in a, rejection in a\n" +
      "b: dependency rejection in b, exception in b, late exception in b, rejection in b",
  });

  // After dispose(), graph.import(), import() run by the graph's code (of an embedded entry point and of a builtin)
  // and import.meta.require() of an embedded ES module fail with ERR_INVALID_STATE; what was already imported keeps
  // working, mainModule keeps its value, and a new graph is unaffected.
  graphCase("DisposeThenImport", {
    files: {
      "/entry.ts": /* js */ `
        declare const tenant: string | undefined;
        const runtime = (specifier: string) => specifier;
        export const load = () => import(runtime("./lazy.ts"));
        export const loadBuiltin = () => import(runtime("node:os"));
        export const requireLazy = async () => import.meta.require(runtime("./lazy.ts"));
        if (typeof tenant === "undefined") {
          const graph = new (Bun.unsafe as any).ModuleGraph({ globals: { tenant: "a" } });
          const self = await graph.import(import.meta.url);
          const lazy = await self.load();
          const before = [typeof (await self.loadBuiltin()).cpus, (await self.requireLazy()).describe === lazy.describe].join();
          graph.dispose();
          graph.dispose();
          const attempts = [
            () => graph.import(import.meta.url),
            () => graph.import(import.meta.resolve("./lazy.ts")),
            () => graph.import("node:os"),
            self.load,
            self.loadBuiltin,
            self.requireLazy,
          ];
          const codes: string[] = [];
          for (const attempt of attempts) codes.push(await attempt().then(() => "resolved", (error: any) => error.code));
          console.log(before);
          console.log(codes.join("\\n"));
          console.log(lazy.describe(), lazy.describe(), graph.mainModule === import.meta.path, graph[Symbol.dispose] === graph.dispose);

          using fresh = new (Bun.unsafe as any).ModuleGraph({ globals: { tenant: "b" } });
          const freshSelf = await fresh.import(import.meta.url);
          console.log((await freshSelf.load()).describe(), (await load()).describe());
        }
      `,
      "/lazy.ts": /* js */ `
        declare const tenant: string | undefined;
        let calls = 0;
        export function describe() { return (typeof tenant === "undefined" ? "host" : tenant) + ":" + ++calls; }
      `,
    },
    entries: ["/entry.ts", "/lazy.ts"],
    stdout:
      "function,true\n" +
      "ERR_INVALID_STATE\nERR_INVALID_STATE\nERR_INVALID_STATE\nERR_INVALID_STATE\nERR_INVALID_STATE\nERR_INVALID_STATE\n" +
      "a:1 a:2 true true\n" +
      "b:1 host:1",
  });

  // An embedded .cjs file is not a CommonJS module at run time: the bundler compiled it into the ES module chunk that
  // imports it (as a `__commonJS` closure), so it is part of that chunk's state and every graph's record of the chunk
  // has its own `module.exports`. A CommonJS file loaded from disk is the shared instance (NotEmbeddedFile).
  graphCase("EmbeddedCommonJS", {
    files: {
      "/entry.ts": /* js */ `
        import shared from "./shared.cjs";
        declare const tenant: string | undefined;
        if (typeof tenant === "undefined") {
          for (const name of ["a", "b"]) {
            const self = await new (Bun.unsafe as any).ModuleGraph({ globals: { tenant: name } }).import(import.meta.url);
            console.log(name, self.shared === shared);
          }
        }
        export { shared };
      `,
      "/shared.cjs": /* js */ `
        module.exports = { token: {} };
      `,
    },
    entries: ["/entry.ts"],
    stdout: "a false\nb false",
  });

  // Builtin modules imported by embedded graph modules (statically, with import(), with require() and with
  // graph.import()) expose the host's functions.
  graphCase("Builtins", {
    files: {
      "/entry.ts": /* js */ `
        import * as path from "node:path";
        import { join } from "node:path";
        import { heapStats } from "bun:jsc";
        import { viaDependency } from "./dep";
        declare const tenant: string | undefined;
        declare const host: { join: typeof join; heapStats: typeof heapStats };
        declare const report: (line: string) => void;
        const runtime = (specifier: string) => specifier;
        if (typeof tenant === "undefined") {
          const lines: string[] = [];
          for (const name of ["a", "b"]) {
            const graph = new (Bun.unsafe as any).ModuleGraph({ globals: { tenant: name, host: { join, heapStats }, report: (line: string) => lines.push(line) } });
            await graph.import(import.meta.url);
            const [viaGraphPath, viaGraphJsc] = [await graph.import("node:path"), await graph.import("bun:jsc")];
            lines.push(name + " graph.import " + (viaGraphPath.join === join) + " " + (viaGraphJsc.heapStats === heapStats));
          }
          console.log(lines.join("\\n"));
        } else {
          const [dynamicPath, dynamicJsc] = [await import(runtime("node:path")), await import(runtime("bun:jsc"))];
          report([
            tenant,
            join === host.join,
            path.join === host.join,
            dynamicPath.join === host.join,
            require(runtime("node:path")).join === host.join,
            viaDependency().join === host.join,
            heapStats === host.heapStats,
            dynamicJsc.heapStats === host.heapStats,
            viaDependency().heapStats === host.heapStats,
            join("embedded", tenant),
            typeof heapStats().heapSize,
          ].join(" "));
        }
      `,
      "/dep.ts": /* js */ `
        import { join } from "node:path";
        import { heapStats } from "bun:jsc";
        export const viaDependency = () => ({ join, heapStats });
      `,
    },
    entries: ["/entry.ts", "/dep.ts"],
    stdout: ["a", "b"]
      .map(
        name =>
          `${name} true true true true true true true true ${isWindows ? "embedded\\" + name : "embedded/" + name} number\n` +
          `${name} graph.import true true`,
      )
      .join("\n"),
  });

  // Files that are NOT embedded, written next to the executable: a graph created inside the executable imports an ES
  // module from disk with per-graph state and graph globals, and the CommonJS module on disk that the embedded entry
  // and the ES module on disk both load is the one shared CommonJS instance.
  graphCase("NotEmbeddedFile", {
    files: {
      "/entry.ts": /* js */ `
        import { resolve } from "node:path";
        declare const tenant: string | undefined;
        const runtime = (specifier: string) => specifier;
        export const shared = require(runtime(resolve("external/shared-on-disk.cjs")));
        if (typeof tenant === "undefined") {
          const plugin = resolve("external/plugin-on-disk.mjs");
          const lines: string[] = [];
          for (const name of ["a", "b"]) {
            const graph = new (Bun.unsafe as any).ModuleGraph({ globals: { tenant: name } });
            const self = await graph.import(import.meta.url);
            const onDisk = await graph.import(plugin);
            lines.push([onDisk.describe(), onDisk.describe(), onDisk.shared === shared, self.shared === shared, onDisk === (await graph.import(plugin))].join(" "));
          }
          const hostOnDisk = await import(runtime(plugin));
          lines.push([hostOnDisk.describe(), hostOnDisk.shared === shared, Object.keys(require.cache).filter(key => key.endsWith("shared-on-disk.cjs")).length].join(" "));
          console.log(lines.join("\\n"));
        }
      `,
    },
    runtimeFiles: {
      "/external/plugin-on-disk.mjs": /* js */ `
        import { next } from "./helper-on-disk.mjs";
        import shared from "./shared-on-disk.cjs";
        export function describe() { return (typeof tenant === "undefined" ? "host" : tenant) + ":" + next() + ":" + import.meta.main; }
        export { shared };
      `,
      "/external/helper-on-disk.mjs": /* js */ `
        let calls = 0;
        export function next() { return ++calls; }
      `,
      "/external/shared-on-disk.cjs": /* js */ `
        module.exports = { token: {} };
      `,
    },
    entries: ["/entry.ts"],
    stdout: "a:1:false a:2:false true true true\nb:1:false b:2:false true true true\nhost:1:false true 1",
  });

  // 50 graphs import the entry; every instance has its own state.
  graphCase("ManyGraphs", {
    files: {
      "/entry.ts": /* js */ `
        import { bump, counter } from "./state";
        declare const index: number | undefined;
        if (typeof index === "undefined") {
          const graphs: any[] = [], selves: any[] = [];
          for (let i = 1; i <= 50; i++) {
            const graph = new (Bun.unsafe as any).ModuleGraph({ globals: { index: i } });
            graphs.push(graph);
            selves.push(await graph.import(import.meta.url));
          }
          for (const self of selves) self.bump();
          const counters = selves.map(self => self.counter());
          console.log(new Set(selves).size, counters.every((count, i) => count === i + 2), counters.reduce((a, b) => a + b, 0), counter());
          for (const graph of graphs) graph.dispose();
          for (const self of selves) self.bump();
          console.log(selves.map(self => self.counter()).reduce((a, b) => a + b, 0), graphs.every(graph => graph.mainModule === import.meta.path));
        } else {
          for (let i = 0; i < index; i++) bump();
        }
        export { bump, counter };
      `,
      "/state.ts": /* js */ `
        let n = 0;
        export function bump() { n++; }
        export function counter() { return n; }
      `,
    },
    entries: ["/entry.ts", "/state.ts"],
    stdout: "50 true 1325 0\n1375 true",
  });

  // A graph created by a graph's instance of the entry, three levels deep: every level has its own state.
  graphCase("NestedGraphs", {
    files: {
      "/entry.ts": /* js */ `
        import { bump, counter } from "./state";
        declare const depth: number | undefined;
        declare const report: (line: string) => void;
        const level = typeof depth === "undefined" ? 0 : depth;
        const lines: string[] = [];
        const push = level === 0 ? (line: string) => lines.push(line) : report;
        for (let i = 0; i <= level; i++) bump();
        let inner = "none";
        if (level < 3) {
          const graph = new (Bun.unsafe as any).ModuleGraph({ globals: { depth: level + 1, report: push } });
          const self = await graph.import(import.meta.url);
          inner = self.counter() + " " + (self.counter !== counter) + " " + (graph.mainModule === import.meta.path);
        }
        push("depth " + level + " counter " + counter() + " inner " + inner);
        if (level === 0) console.log(lines.join("\\n"));
        export { counter };
      `,
      "/state.ts": /* js */ `
        let n = 0;
        export function bump() { n++; }
        export function counter() { return n; }
      `,
    },
    entries: ["/entry.ts", "/state.ts"],
    stdout:
      "depth 3 counter 4 inner none\n" +
      "depth 2 counter 3 inner 4 true true\n" +
      "depth 1 counter 2 inner 3 true true\n" +
      "depth 0 counter 1 inner 2 true true",
  });

  // Functions of the embedded entry (loaded from its bytecode) get hot in one graph's instance before the next
  // instance exists: each instance keeps reading its own module-level `let`, imported binding and graph global.
  graphCase("HotFunctions", {
    files: {
      "/entry.ts": /* js */ `
        import { count, increment } from "./state";
        declare let tenant: number | undefined;
        let calls = 0;
        export function hot(step: number) {
          calls += step;
          return calls + count * 1000 + (typeof tenant === "undefined" ? 0 : tenant) * 1000000;
        }
        export function setTenant(value: number) { tenant = value; }
        export { increment };
        if (typeof tenant === "undefined") {
          const create = (tenant: number) => new (Bun.unsafe as any).ModuleGraph({ globals: { tenant } }).import(import.meta.url);
          const warmUp = (fn: typeof hot) => {
            let last = 0;
            for (let i = 0; i < 100_000; i++) last = fn(1);
            return last;
          };
          const a = await create(1);
          a.increment();
          const lines = ["a " + warmUp(a.hot)];
          const b = await create(2);
          b.increment();
          b.increment();
          lines.push("b " + b.hot(1), "host " + hot(1));
          b.setTenant(3);
          lines.push("b " + warmUp(b.hot), "a " + a.hot(1), "host " + warmUp(hot));
          console.log(lines.join("\\n"));
        }
      `,
      "/state.ts": /* js */ `
        export let count = 0;
        export function increment() { count++; }
      `,
    },
    entries: ["/entry.ts", "/state.ts"],
    stdout: "a 1101000\nb 2002001\nhost 1\nb 3102001\na 1101001\nhost 100001",
  });

  // graph.mainModule is the embedded path of the first import (undefined before it, unchanged by later imports).
  // `bun build --compile` makes import.meta.main a bundle-time constant, true in entry points and false elsewhere, so
  // a graph's instances see the host's values.
  graphCase("MainModule", {
    files: {
      "/entry.ts": /* js */ `
        import { dependencyIsMain } from "./dep";
        declare const tenant: string | undefined;
        declare const report: (line: string) => void;
        if (typeof tenant === "undefined") {
          const lines: string[] = [];
          const globals = { tenant: "a", report: (line: string) => lines.push(line) };
          const graph = new (Bun.unsafe as any).ModuleGraph({ globals });
          lines.push("before " + graph.mainModule);
          await graph.import(import.meta.url);
          lines.push("first import " + (graph.mainModule === import.meta.path) + " " + (graph.mainModule === Bun.main));
          const other = await graph.import(import.meta.resolve("./other.ts"));
          lines.push("second import " + (graph.mainModule === import.meta.path) + " " + (other.path !== import.meta.path));

          const otherFirst = new (Bun.unsafe as any).ModuleGraph({ globals: { ...globals, tenant: "b" } });
          const otherPath = (await otherFirst.import(import.meta.resolve("./other.ts"))).path;
          await otherFirst.import(import.meta.url);
          lines.push("other first " + (otherFirst.mainModule === otherPath) + " " + (otherPath === other.path));
          lines.push("host " + import.meta.main + " " + dependencyIsMain() + " " + (Bun.main === import.meta.path));
          console.log(lines.join("\\n"));
        } else if (tenant === "a") {
          report("a " + import.meta.main + " " + dependencyIsMain());
        }
      `,
      "/dep.ts": /* js */ `
        export function dependencyIsMain() { return import.meta.main; }
      `,
      "/other.ts": /* js */ `
        export const path = import.meta.path;
      `,
    },
    entries: ["/entry.ts", "/other.ts"],
    stdout:
      "before undefined\n" +
      "a true false\n" +
      "first import true true\n" +
      "second import true true\n" +
      "other first true true\n" +
      "host true false true",
  });
});
