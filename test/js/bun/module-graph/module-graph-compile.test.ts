// Bun.unsafe.ModuleGraph inside single-file executables (`bun build --compile`), with and without
// `--bytecode`, `--minify` and code splitting. The compiled program instantiates modules that are embedded
// in the executable several times through ModuleGraph, exercises dynamic import() of embedded chunks in
// every ordering, hot shared code across instances, TLA / JSON / CommonJS / throwing modules, churn, and
// a Worker that does the same, and prints one JSON document that the test compares in full.
//
import { describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const enabled = typeof (Bun as any).unsafe?.ModuleGraph === "function";

// ── sources embedded into the executable ──────────────────────────────────────────────────────────
const sources: Record<string, string> = {
  "dep.ts": `
    (typeof __log !== "undefined" ? __log : undefined)?.push("dep@" + (process.env.TAG ?? "host"));
    export let count = 0;
    export function bump(): number { return ++count; }
    function local(n: number) { return n + 1; }
    export function viaLocal(n: number) { return local(n) + count; }
    export const tag: string = process.env.TAG ?? "host";
    export const K = "K:" + (process.env.TAG ?? "host");
    export default class Thing { static made = 0; #tag = tag; get owner() { return this.#tag } constructor() { Thing.made++; } }
  `,
  "data.json": `{ "kind": "json", "n": 1 }`,
  "c.cjs": `(typeof __log !== "undefined" ? __log : undefined)?.push("cjs@" + (process.env.TAG ?? "host")); let n = 0; module.exports = { who: process.env.TAG ?? "host", inc: () => ++n, get n() { return n; } };`,
  "tla.ts": `(typeof __log !== "undefined" ? __log : undefined)?.push("tla@" + (process.env.TAG ?? "host")); await new Promise(r => setTimeout(r, 2)); export const tlaWho = process.env.TAG ?? "host";`,
  "lazy.ts": `(typeof __log !== "undefined" ? __log : undefined)?.push("lazy@" + (process.env.TAG ?? "host")); export const who = process.env.TAG ?? "host"; export let n = 0; export const inc = () => ++n;`,
  "throws.ts": `(typeof __log !== "undefined" ? __log : undefined)?.push("throws@" + (process.env.TAG ?? "host")); if (process.env.TAG?.startsWith("bad")) throw new RangeError("boom:" + process.env.TAG); export const ok = process.env.TAG ?? "host";`,
  "instance.ts": `
    import Thing, { bump, count, viaLocal, tag, K } from "./dep.ts";
    import * as depNs from "./dep.ts";
    import data from "./data.json";
    import { tlaWho } from "./tla.ts";
    const cjs = require("./c.cjs");
    (typeof __log !== "undefined" ? __log : undefined)?.push("instance@" + (process.env.TAG ?? "host"));
    const short = (u: string) => u.replace(/^.*[\\\\/]/, "<embedded>/");
    export async function runInstance(n: number) {
      for (let i = 0; i < n; i++) bump();
      new Thing();
      const lazyDep = await import("./dep.ts");
      cjs.inc();
      return { tag, count, nsCount: depNs.count, lazyDepCount: lazyDep.count, via: viaLocal(1), made: Thing.made, owner: new Thing().owner, env: process.env.TAG ?? null, meta: short(import.meta.url), json: data.kind, cjs: [cjs.who, cjs.n], tla: tlaWho };
    }
    // dynamic import of a chunk that is only reachable through import()
    export const lazy = () => import("./lazy.ts");
    export const lazyViaEval = () => eval('import("./lazy.ts")');
    export const lazyViaFunction = () => new Function('return import("./lazy.ts")')();
    // hot readers of imported bindings at scope depths 0..2, plus a namespace read and local state
    let local = 0;
    export function d0(n: number) { let r; for (let i = 0; i < n; i++) r = tag + "|" + K; return r; }
    export function d1(n: number) { return (() => { let r; for (let i = 0; i < n; i++) r = tag + "|" + K; return r; })(); }
    export function d2(n: number) { return (() => (() => { let r; for (let i = 0; i < n; i++) r = tag + "|" + K; return r; })())(); }
    export function nsRead(n: number) { let r; for (let i = 0; i < n; i++) r = depNs.tag + "|" + depNs.K; return r; }
    export function bumpLocal(n: number) { for (let i = 0; i < n; i++) local++; return local; }
    export const throwing = () => import("./throws.ts").then(m => ({ ok: m.ok }), e => ({ err: e.constructor.name, message: e.message }));
    export const missing = () => import("./not-embedded-" + (process.env.TAG ?? "host") + ".ts").then(() => "resolved", e => e.constructor.name);
  `,
  "worker.ts": `
    declare var self: Worker;
    const MG = (Bun as any).unsafe.ModuleGraph;
    const url = new URL("./instance.js", import.meta.url).href;
    const log: string[] = [];
    const out: unknown[] = [];
    for (let k = 0; k < 3; k++) {
      const g = new MG({ globals: { process: Object.create(process, { env: { value: { ...process.env, TAG: "w" + k }, enumerable: true } }), __log: log } });
      const ns = await g.import(url);
      out.push(await ns.runInstance(k + 1));
      out.push((await ns.lazy()).who);
      g.dispose();
    }
    postMessage({ out, log });
  `,
  "entry.ts": `
    const MG = (Bun as any).unsafe?.ModuleGraph;
    const url = new URL("./instance.js", import.meta.url).href;
    const scenario = process.argv[2];
    const log: string[] = [];
    // each graph gets a process of its own through globals (its env carries the graph's TAG)
    const mk = (tag: string) => new MG({ globals: { process: Object.create(process, { env: { value: { ...process.env, TAG: tag }, enumerable: true } }), __log: log } });
    const errName = (e: any) => e?.constructor?.name ?? typeof e;
    let result: any;
    if (scenario === "instances") {
      const host = await import(url);
      const host1 = await host.runInstance(1);
      const graphs = [0, 1, 2].map(k => mk("t" + k));
      const nss: any[] = [];
      const results: unknown[] = [];
      for (let k = 0; k < 3; k++) { nss.push(await graphs[k].import(url)); results.push(await nss[k].runInstance(10 + k)); }
      const again = await Promise.all(nss.map(ns => ns.runInstance(1)));
      const host2 = await host.runInstance(1);
      result = { host1, results, again, host2, distinctNamespaces: new Set([host, ...nss]).size, sameOnReimport: (await graphs[0].import(url)) === nss[0], log };
      for (const g of graphs) g.dispose();
    } else if (scenario?.startsWith("lazy:")) {
      const ordering = scenario.slice(5);
      const tags = ["l0", "l1", "l2"];
      const graphs: any[] = []; const nss: any[] = []; const got: unknown[] = ["unset", "unset", "unset"]; const lazies: any[] = [null, null, null];
      let how = "lazy";
      const settle = async (i: number) => { try { const m = await nss[i][how](); lazies[i] = m; got[i] = { who: m.who }; } catch (e) { got[i] = { rejected: errName(e) }; } };
      let hostWho: unknown = "not-run";
      const hostImport = async () => { hostWho = (await (await import(url)).lazy()).who; };
      if (ordering === "hostFirst") await hostImport();
      if (ordering === "seq" || ordering === "hostFirst" || ordering === "hostLast" || ordering === "viaEval" || ordering === "viaFunction") {
        how = ordering === "viaEval" ? "lazyViaEval" : ordering === "viaFunction" ? "lazyViaFunction" : "lazy";
        for (let i = 0; i < 3; i++) { graphs[i] = mk(tags[i]); nss[i] = await graphs[i].import(url); await settle(i); }
      } else if (ordering === "concurrent") {
        await Promise.all(tags.map(async (t, i) => { graphs[i] = mk(t); nss[i] = await graphs[i].import(url); }));
        await Promise.all(tags.map((_, i) => settle(i)));
      } else {
        for (let i = 0; i < 3; i++) { graphs[i] = mk(tags[i]); nss[i] = await graphs[i].import(url); }
        if (ordering === "disposeMiddle") graphs[1].dispose();
        for (const i of ordering === "reverse" ? [2, 1, 0] : ordering === "onlySome" ? [0, 2] : [0, 1, 2]) await settle(i);
      }
      if (ordering === "hostLast") await hostImport();
      const repeat = await Promise.all(nss.map((ns, i) => ordering === "onlySome" && i === 1 ? "skipped" : ns[how]().then((m: any) => m === lazies[i], (e: any) => "rejected:" + errName(e))));
      const live = lazies.filter(Boolean);
      if (live.length) { live[0].inc(); live[0].inc(); }
      result = { got, repeat, distinct: new Set(live).size, isolation: live.map(m => m.n), hostWho, log: log.filter(l => l.startsWith("lazy@")).sort() };
      for (const g of graphs) g.dispose();
    } else if (scenario?.startsWith("hot:")) {
      const order = scenario.slice(4);
      const N = 30000;
      const tags = ["h0", "h1", "h2"];
      const graphs: any[] = []; const nss: any[] = [];
      const make = async (i: number) => { graphs[i] = mk(tags[i]); nss[i] = await graphs[i].import(url); };
      const heat = (i: number) => { nss[i].d0(N); nss[i].d1(N); nss[i].d2(N); nss[i].nsRead(N); nss[i].bumpLocal(N); };
      if (order === "hotFirst") { await make(0); heat(0); await make(1); await make(2); }
      else if (order === "allThenHot") { await make(0); await make(1); await make(2); heat(0); }
      else if (order === "interleaved") { for (let i = 0; i < 3; i++) { await make(i); heat(i); } }
      else { await make(2); await make(1); await make(0); heat(2); }
      result = { reads: nss.map(ns => [ns.d0(9), ns.d1(9), ns.d2(9), ns.nsRead(9)]), locals: nss.map(ns => ns.bumpLocal(1)) };
      for (const g of graphs) g.dispose();
    } else if (scenario === "kinds") {
      const a = mk("ka"), b = mk("kb"), bad = mk("bad1");
      const [na, nb, nbad] = [await a.import(url), await b.import(url), await bad.import(url)];
      result = {
        runs: [await na.runInstance(2), await nb.runInstance(3)],
        throwing: [await na.throwing(), await nbad.throwing(), await nbad.throwing(), await nb.throwing()],
        missing: [await na.missing(), await nb.missing()],
        afterErrors: (await nbad.runInstance(1)).tag,
        log: log.filter(l => !l.startsWith("dep@") && !l.startsWith("instance@") && !l.startsWith("cjs@") && !l.startsWith("tla@")),
      };
      for (const g of [a, b, bad]) g.dispose();
    } else if (scenario === "churn") {
      const tags: string[] = [];
      for (let k = 0; k < 20; k++) { const g = mk("c" + k); const ns = await g.import(url); tags.push((await ns.runInstance(k)).tag + ":" + (await ns.runInstance(0)).count + ":" + (await ns.lazy()).who); g.dispose(); }
      const host = await (await import(url)).runInstance(0);
      result = { tags, hostCount: host.count, hostTag: host.tag, evaluations: log.filter(l => l.startsWith("instance@")).length };
    } else if (scenario === "worker") {
      const w = new Worker(new URL("./worker.js", import.meta.url).href);
      result = await new Promise((res, rej) => { w.onmessage = e => res(e.data); w.onerror = e => rej(e); });
      w.terminate();
    } else if (scenario === "external") {
      // a graph loads a module from disk next to the executable, which imports embedded code by URL
      const { join, dirname } = require("node:path");
      const ext = join(dirname(process.execPath), "external.mjs");
      const out: unknown[] = [];
      for (const tag of ["x0", "x1"]) { const g = mk(tag); const m = await g.import(ext); out.push(await m.describe(url)); g.dispose(); }
      const hostView = await (await import(ext)).describe(url);
      result = { out, hostView, log: log.filter(l => l.startsWith("external@") || l.startsWith("instance@")) };
    } else {
      result = { error: "unknown scenario " + scenario };
    }
    console.log(JSON.stringify(result));
  `,
};

const instanceRun = (tag: string | null, n: number, made: number, cjsN: number) => ({
  tag: tag ?? "host",
  count: n,
  nsCount: n,
  lazyDepCount: n,
  via: 2 + n,
  made,
  owner: tag ?? "host",
  env: tag,
  meta: "<embedded>/instance.js",
  json: "json",
  cjs: [tag ?? "host", cjsN],
  tla: tag ?? "host",
});

type Combo = { name: string; args: string[] };
const combos: Combo[] = [
  { name: "esm+splitting", args: ["--format=esm", "--splitting"] },
  { name: "esm+splitting+bytecode", args: ["--format=esm", "--splitting", "--bytecode"] },
  { name: "esm+splitting+minify", args: ["--format=esm", "--splitting", "--minify"] },
  { name: "esm+splitting+bytecode+minify", args: ["--format=esm", "--splitting", "--bytecode", "--minify"] },
  { name: "esm+splitting+bytecode+sourcemap", args: ["--format=esm", "--splitting", "--bytecode", "--sourcemap"] },
];

for (const combo of combos) {
  describe.skipIf(!enabled)(`ModuleGraph in a compiled executable (${combo.name})`, () => {
    let dir: ReturnType<typeof tempDir>;
    let exe: string;
    const run = async (scenario: string) => {
      await using proc = Bun.spawn({
        cmd: [exe, scenario],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
      } catch {
        parsed = { unparsable: stdout, stderr };
      }
      return { parsed, exitCode, stderr: stderr.trim() };
    };

    test("build", async () => {
      dir = tempDir("module-graph-compile-" + combo.name.replace(/\W/g, "_"), {
        ...sources,
        // not embedded: loaded from disk by the compiled program
        "external.mjs": `(typeof __log !== "undefined" ? __log : undefined)?.push("external@" + (process.env.TAG ?? "host")); export const who = process.env.TAG ?? "host"; export async function describe(instanceUrl) { const t = await import(instanceUrl); const r = await t.runInstance(1); return { who, instanceTag: r.tag, instanceMeta: r.meta }; }`,
      });
      exe = join(String(dir), process.platform === "win32" ? "app.exe" : "app");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          ...combo.args,
          "./entry.ts",
          "./instance.ts",
          "./worker.ts",
          "--outfile",
          exe,
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        exitCode,
        built: await Bun.file(exe).exists(),
        stderrHasError: /error:/i.test(stderr) ? stderr : "",
      }).toEqual({ exitCode: 0, built: true, stderrHasError: "" });
    }, 60_000);

    test("several instances of an embedded module: isolation, identity, host unaffected", async () => {
      expect(await run("instances")).toEqual({
        parsed: {
          host1: instanceRun(null, 1, 1, 1),
          results: [instanceRun("t0", 10, 1, 1), instanceRun("t1", 11, 1, 1), instanceRun("t2", 12, 1, 1)],
          again: [instanceRun("t0", 11, 3, 2), instanceRun("t1", 12, 3, 2), instanceRun("t2", 13, 3, 2)],
          host2: instanceRun(null, 2, 3, 2),
          distinctNamespaces: 4,
          sameOnReimport: true,
          log: ["t0", "t1", "t2"].flatMap(t => [`dep@${t}`, `tla@${t}`, `cjs@${t}`, `instance@${t}`]),
        },
        exitCode: 0,
        stderr: "",
      });
    });

    for (const ordering of [
      "seq",
      "concurrent",
      "reverse",
      "onlySome",
      "hostFirst",
      "hostLast",
      "disposeMiddle",
      "viaEval",
      "viaFunction",
    ] as const) {
      test(`dynamic import() of a lazily loaded embedded chunk × ${ordering}`, async () => {
        const tags = ["l0", "l1", "l2"];
        const skipped = (i: number) => ordering === "onlySome" && i === 1;
        const disposed = (i: number) => ordering === "disposeMiddle" && i === 1;
        const live = tags.filter((_, i) => !skipped(i) && !disposed(i));
        // Function() code is global code: its import() goes through the global loader, not the graph.
        const viaHost = ordering === "viaFunction";
        expect(await run("lazy:" + ordering)).toEqual({
          parsed: {
            got: tags.map((t, i) =>
              skipped(i) ? "unset" : disposed(i) ? { rejected: "TypeError" } : { who: viaHost ? "host" : t },
            ),
            repeat: tags.map((_, i) => (skipped(i) ? "skipped" : disposed(i) ? "rejected:TypeError" : true)),
            distinct: viaHost ? 1 : live.length,
            isolation: viaHost ? live.map(() => 2) : live.map((_, i) => (i === 0 ? 2 : 0)),
            hostWho: ordering === "hostFirst" || ordering === "hostLast" ? "host" : "not-run",
            log: viaHost ? [] /* the host load logs nowhere: __log is a graph binding */ : live.map(t => `lazy@${t}`),
          },
          exitCode: 0,
          stderr: "",
        });
      });
    }

    for (const order of ["hotFirst", "allThenHot", "interleaved", "reverseThenHotLast"] as const) {
      test(`hot readers of imported bindings across instances × ${order}`, async () => {
        const tags = ["h0", "h1", "h2"];
        const heated = order === "interleaved" ? [0, 1, 2] : order === "reverseThenHotLast" ? [2] : [0];
        expect(await run("hot:" + order)).toEqual({
          parsed: {
            reads: tags.map(t => [`${t}|K:${t}`, `${t}|K:${t}`, `${t}|K:${t}`, `${t}|K:${t}`]),
            locals: tags.map((_, i) => (heated.includes(i) ? 30000 : 0) + 1),
          },
          exitCode: 0,
          stderr: "",
        });
      });
    }

    test("TLA, JSON, CommonJS, throwing and missing modules per instance", async () => {
      expect(await run("kinds")).toEqual({
        parsed: {
          runs: [instanceRun("ka", 2, 1, 1), instanceRun("kb", 3, 1, 1)],
          throwing: [
            { ok: "ka" },
            { err: "RangeError", message: "boom:bad1" },
            { err: "RangeError", message: "boom:bad1" },
            { ok: "kb" },
          ],
          missing: ["ResolveMessage", "ResolveMessage"],
          afterErrors: "bad1",
          log: ["throws@ka", "throws@bad1", "throws@kb"],
        },
        exitCode: 0,
        stderr: "",
      });
    });

    test("churn: 20 instances created, used and disposed in sequence; host state independent", async () => {
      expect(await run("churn")).toEqual({
        parsed: {
          tags: Array.from({ length: 20 }, (_, k) => `c${k}:${k}:c${k}`),
          hostCount: 0,
          hostTag: "host",
          evaluations: 20,
        },
        exitCode: 0,
        stderr: "",
      });
    });

    test("a Worker inside the executable instantiates embedded modules through ModuleGraph", async () => {
      expect(await run("worker")).toEqual({
        parsed: {
          out: [instanceRun("w0", 1, 1, 1), "w0", instanceRun("w1", 2, 1, 1), "w1", instanceRun("w2", 3, 1, 1), "w2"],
          log: ["w0", "w1", "w2"].flatMap(t => [`dep@${t}`, `tla@${t}`, `cjs@${t}`, `instance@${t}`, `lazy@${t}`]),
        },
        exitCode: 0,
        stderr: "",
      });
    });

    test("a module on disk next to the executable loads into graphs and imports embedded code by URL", async () => {
      expect(await run("external")).toEqual({
        parsed: {
          out: [
            { who: "x0", instanceTag: "x0", instanceMeta: "<embedded>/instance.js" },
            { who: "x1", instanceTag: "x1", instanceMeta: "<embedded>/instance.js" },
          ],
          hostView: { who: "host", instanceTag: "host", instanceMeta: "<embedded>/instance.js" },
          log: ["external@x0", "instance@x0", "external@x1", "instance@x1"],
        },
        exitCode: 0,
        stderr: "",
      });
    });

    test("cleanup", () => {
      try {
        rmSync(String(dir), { recursive: true, force: true });
      } catch {}
    });
  });
}
