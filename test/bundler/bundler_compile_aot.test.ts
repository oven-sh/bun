import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isArm64, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";
import { BundlerTestInput, itBundled as itBundledBase } from "./expectBundled";

const supported = isArm64 && !isWindows;

const usesImage = (stdout: string): BundlerTestInput["run"] => ({
  env: { BUN_AOT_VERBOSE: "1" },
  validate({ stdout: actual, stderr }) {
    expect(actual).toBe(stdout);
    expect(stderr).toContain("[aot] image: ");
    expect(stderr).not.toContain("[aot] not using");
  },
});

describe.skipIf(!supported)("bundler", () => {
  for (const backend of ["cli", "api"] as const) {
    const itBundled = (id: string, opts: BundlerTestInput) =>
      itBundledBase(`compile/aot/${backend}/${id}`, { backend, target: "bun", compile: { aot: true }, ...opts });

    itBundled("HelloWorld", {
      files: {
        "/entry.ts": /* js */ `
          console.log("Hello, world!");
        `,
      },
      run: usesImage("Hello, world!\n"),
    });

    itBundled("LanguageFeatures", {
      files: {
        "/entry.ts": /* js */ `
          import { double } from "./other";
          class Point { constructor(public x: number, public y: number) {} add(o: Point) { return new Point(this.x + o.x, this.y + o.y); } }
          function sum(n: number) { let p = new Point(0, 0); for (let i = 0; i < n; i++) p = p.add(new Point(i, 1)); return p; }
          async function later(v: number) { await null; return double(v); }
          function* gen() { yield 1; yield 2; }
          const counter = (() => { let n = 0; return () => ++n; })();
          counter();
          console.log(JSON.stringify(sum(1000)), await later(21), [...gen()].join(), counter());
          console.log([3, 1, 2].sort().map(x => x * 2).join(), "abc".toUpperCase(), new Map([[1, "a"]]).get(1));
        `,
        "/other.ts": /* js */ `
          export function double(v: number) { return v * 2; }
        `,
      },
      run: usesImage('{"x":499500,"y":1000} 42 1,2 2\n2,4,6 ABC a\n'),
    });

    itBundled("EvalAndNewFunction", {
      files: {
        "/entry.ts": /* js */ `
          function compiled(a: number) { return a + 1; }
          globalThis.compiled = compiled;
          console.log((0, eval)("compiled(1) + 1"), new Function("a", "return compiled(a) * 3")(4));
        `,
      },
      run: usesImage("3 15\n"),
    });

    itBundled("VariableLiveAcrossTwoHandlers", {
      files: {
        "/entry.ts": /* js */ `
          function make() { return { tag: "kept" }; }
          let calls = 0;
          function between() { calls++; }
          function adjacent() { const x = make(); try { throw 1; } catch (a) { } try { throw 2; } catch (b) { } return x.tag; }
          function separated() { const x = make(); try { throw 1; } catch (a) { } between(); try { throw 2; } catch (b) { } return x.tag; }
          function stackIdiom() { const x = make(); let stack; try { throw new Error("here"); } catch (e) { stack = e.stack; } between(); try { JSON.parse("{"); } catch (b) { return x.tag + typeof stack; } return "no"; }
          console.log(adjacent(), separated(), stackIdiom());
        `,
      },
      run: usesImage("kept kept keptstring\n"),
    });

    itBundled("BuiltinCalledOnWrongReceiver", {
      files: {
        "/entry.ts": /* js */ `
          const attempt = (f: () => unknown) => { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } };
          console.log([
            attempt(() => Array.prototype.shift.call("abc")),
            attempt(() => Array.prototype.join.call({ length: 2, 0: "a", 1: "b" }, "-")),
            attempt(() => String.prototype.trim.call(123)),
            attempt(() => Map.prototype.get.call({}, 1)),
            attempt(() => Date.prototype.getTime.call({})),
            attempt(() => Array.prototype.shift.call([5, 6])),
          ].join(" "));
        `,
      },
      run: usesImage("TypeError a-b 123 TypeError TypeError 5\n"),
    });

    itBundled("ErrorsThrownByNativeCode", {
      files: {
        "/entry.ts": /* js */ `
          const attempt = (f: () => unknown) => { try { f(); return "none"; } catch (e) { return (e as Error).constructor.name; } };
          const revoked = () => { const { proxy, revoke } = Proxy.revocable(function () {}, {}); revoke(); return proxy as any; };
          function tooFewArguments(a?: any, b?: any, c?: any, d?: any, e?: any, f?: any, g?: any, h?: any): number { return 1 + recurse(); }
          function recurse(): number { return 1 + tooFewArguments(1); }
          const withGetter = { get next(): unknown { return withGetter.next; } };
          console.log(attempt(() => revoked()()), attempt(() => new (revoked())()), attempt(recurse), attempt(() => withGetter.next));
        `,
      },
      run: usesImage("TypeError TypeError RangeError RangeError\n"),
    });

    itBundled("LargeArrayLiteral", {
      files: {
        "/entry.ts":
          Array.from({ length: 100 }, (_, i) => `function f${i}(a: number) { return a + ${i}; }`).join("\n") +
          `\nconst table = [${Array.from({ length: 100 }, (_, i) => `f${i}`).join(", ")}];\n` +
          `function objects(a: number) { return [${Array.from({ length: 100 }, (_, i) => `{ id: ${i}, v: a + ${i} }`).join(", ")}]; }\n` +
          `console.log(table.reduce((s, f) => s + f(1), 0), objects(2).reduce((s, o) => s + o.id * o.v, 0));\n`,
      },
      run: usesImage("5050 338250\n"),
    });

    itBundled("ProperTailCalls", {
      files: {
        "/entry.ts": /* js */ `
          function loop(n: number, acc: number): number { if (!n) return acc; return loop(n - 1, acc + 1); }
          function viaParameter(f: any, n: number, acc: number): number { if (!n) return acc; return f(f, n - 1, acc + 1); }
          const picked = [viaParameter, Math.abs][process.argv.length > 50 ? 1 : 0];
          console.log(loop(300000, 0), picked(picked, 300000, 0));
        `,
      },
      run: usesImage("300000 300000\n"),
    });

    itBundled("BuiltinsAreImmutable", {
      files: {
        "/entry.ts": /* js */ `
          const attempt = (f: () => unknown) => { try { f(); return "ok"; } catch (e) { return (e as Error).name; } };
          const push = Array.prototype.push, random = Math.random;
          console.log(
            attempt(() => { Array.prototype.push = function () { return 0; }; }),
            attempt(() => { Math.random = () => 0.5; }),
            attempt(() => { JSON.parse = () => 1; }),
            attempt(() => Object.defineProperty(Object.prototype, "added", { value: 1 })),
            attempt(() => { delete (Array.prototype as any).map; }),
            Array.prototype.push === push, Math.random === random, "added" in {}, typeof [].map,
          );
          console.log(new Function("'use strict'; try { Math.max = 1; return 'ok'; } catch (e) { return e.name; }")());
          console.log(require("node:vm").runInNewContext("Object.isFrozen(Object.prototype)"));
          class A { m() { return 1; } }
          A.prototype.m = () => 2;
          class List extends Array<number> { sum() { return this.reduce((a, b) => a + b, 0); } }
          (globalThis as any).fetch = () => "replaced";
          console.log(new A().m(), List.from([1, 2, 3]).sum(), (globalThis as any).fetch());
        `,
      },
      run: usesImage(
        "TypeError TypeError TypeError TypeError TypeError true true false function\nTypeError\ntrue\n2 6 replaced\n",
      ),
    });

    itBundled("Worker", {
      files: {
        "/entry.ts": /* js */ `
          import { Worker, isMainThread, parentPort } from "node:worker_threads";
          function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
          if (isMainThread) {
            const worker = new Worker(new URL(import.meta.url));
            worker.on("message", m => console.log("main", fib(15), "worker", m));
          } else
            parentPort!.postMessage(fib(16));
        `,
      },
      run: usesImage("main 610 worker 987\n"),
    });

    itBundled("WorkerFromBlobURL", {
      files: {
        "/entry.ts": /* js */ `
          const source = \`
            function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
            self.onmessage = e => postMessage([fib(e.data), [3, 1, 2].sort().join()].join(" "));
          \`;
          const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" })));
          worker.onmessage = e => { console.log(e.data); worker.terminate(); };
          worker.postMessage(15);
        `,
      },
      run: usesImage("610 1,2,3\n"),
    });

    itBundled("CommonJS", {
      files: {
        "/entry.ts": /* js */ `
          import { fib } from "./fib.cjs";
          const again = require("./fib.cjs");
          const late = await import("./fib.cjs");
          console.log(fib(20), again.fib === fib, late.default.fib === fib, typeof require);
        `,
        "/fib.cjs": /* js */ `
          exports.fib = function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); };
        `,
      },
      run: usesImage("6765 true true function\n"),
    });

    itBundled("CommonJSEntryPoint", {
      files: {
        "/entry.cjs": /* js */ `
          const { fib } = require("./fib.cjs");
          console.log(fib(20), typeof require, typeof module, typeof exports);
        `,
        "/fib.cjs": /* js */ `
          exports.fib = function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); };
        `,
      },
      run: usesImage("6765 function object object\n"),
    });

    for (const splitting of [false, true]) {
      itBundled(splitting ? "DynamicImportWithSplitting" : "DynamicImport", {
        splitting,
        files: {
          "/entry.ts": /* js */ `
            import { fib } from "./fib";
            console.log(fib(20));
            const { twice } = await import("./lazy");
            console.log(twice(21));
          `,
          "/lazy.ts": /* js */ `
            import { fib } from "./fib";
            export const twice = (n: number) => n * 2 + fib(0);
          `,
          "/fib.ts": /* js */ `
            export function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
          `,
        },
        run: usesImage("6765\n42\n"),
      });
    }
  }

  test("compile/aot/BuildDoesNotDisturbTheCaller", async () => {
    using dir = tempDir("compile-aot-caller", {
      "app.ts": `console.log("from the executable");`,
      "build.ts": `
        function work() {
          const literal = { a: 1, get b() { return 2; }, c: [1, 2, 3] };
          class K { x = 1; y = this.x + 1; }
          let s = 0;
          for (let i = 0; i < 100000; i++) s += literal.a + literal.b + literal.c.length + new K().y;
          return s;
        }
        const callsItsOwnFunction = (n: number) =>
          new Function("function $$t(v, m) { return 'called' + m; } return $$t(1, 1); // " + n)() === "called1";
        const before = work();
        const own = callsItsOwnFunction(1);
        const newRealmIsMutable = () => !require("node:vm").runInNewContext("Object.isFrozen(Object.prototype)");
        const mutable = newRealmIsMutable();
        const result = await Bun.build({ entrypoints: ["./app.ts"], compile: { aot: true, outfile: "./app" } });
        const after = new Function("return (" + work.toString() + ")()")();
        Math.max = Math.max;
        console.log(result.success, before === work(), before === after, own, callsItsOwnFunction(2), mutable, newRealmIsMutable());
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build.ts"],
      env: { ...bunEnv, BUN_SOUND_TYPES: "infer" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(stdout).toBe("true true true true true true true\n");
    expect(exitCode).toBe(0);

    await using app = Bun.spawn({
      cmd: [join(String(dir), "app")],
      env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [appStdout, appStderr, appExitCode] = await Promise.all([app.stdout.text(), app.stderr.text(), app.exited]);
    expect(appStdout).toBe("from the executable\n");
    expect(appStderr).toContain("[aot] image: ");
    expect(appExitCode).toBe(0);
  });
});

test.skipIf(!supported)("compile.aot: concurrent builds from several threads", async () => {
  const apps = [1, 2, 3, 4];
  using dir = tempDir("compile-aot-at-once", {
    ...Object.fromEntries(
      apps.map(n => [
        `app${n}.ts`,
        `function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); } console.log(${n}, fib(1${n}));`,
      ]),
    ),
    "worker.ts": `
      self.onmessage = async ({ data: n }) => {
        const result = await Bun.build({ entrypoints: [\`./app\${n}.ts\`], compile: { aot: true, outfile: \`./worker\${n}\` } });
        postMessage(result.success);
      };
    `,
    "build.ts": `
      const apps = ${JSON.stringify(apps)};
      const here = apps.map(n => Bun.build({ entrypoints: [\`./app\${n}.ts\`], compile: { aot: true, outfile: \`./main\${n}\` } }).then(r => r.success));
      const inWorkers = apps.map(n => {
        const { promise, resolve } = Promise.withResolvers<boolean>();
        const worker = new Worker("./worker.ts");
        worker.onmessage = e => { resolve(e.data); worker.terminate(); };
        worker.postMessage(n);
        return promise;
      });
      console.log(JSON.stringify(await Promise.all([...here, ...inWorkers])));
    `,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(stdout).toBe(JSON.stringify(Array(8).fill(true)) + "\n");
  expect(exitCode).toBe(0);

  const outputs = await Promise.all(
    ["main", "worker"].flatMap(kind =>
      apps.map(async n => {
        await using app = Bun.spawn({
          cmd: [join(String(dir), kind + n)],
          env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([app.stdout.text(), app.stderr.text()]);
        return { stdout: stdout.trim(), usesImage: stderr.includes("[aot] image: ") };
      }),
    ),
  );
  expect(outputs).toEqual(
    ["1 89", "2 144", "3 233", "4 377", "1 89", "2 144", "3 233", "4 377"].map(stdout => ({ stdout, usesImage: true })),
  );
});

const otherTarget = process.platform === "linux" ? "bun-darwin-x64" : "bun-linux-x64";
const whyNot = supported
  ? "ahead-of-time compilation cannot target another platform or version of Bun"
  : "ahead-of-time compilation only supports arm64 macOS and Linux so far";

test("--compile-aot rejects cross-compilation and unsupported targets", async () => {
  using dir = tempDir("compile-aot-cross", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", `--target=${otherTarget}`, "entry.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(`--compile-aot: ${whyNot}`);
  expect(exitCode).not.toBe(0);
});

test("compile.aot rejects cross-compilation and unsupported targets", async () => {
  using dir = tempDir("compile-aot-cross-api", { "entry.ts": `console.log(1);` });
  expect(() =>
    Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      compile: { target: otherTarget, aot: true, outfile: join(String(dir), "out") },
    }),
  ).toThrow(`compile.aot: ${whyNot}`);
});

test.skipIf(!supported)("--compile-aot requires --format=esm", async () => {
  using dir = tempDir("compile-aot-format", { "entry.cjs": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "--format=cjs", "entry.cjs", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--compile-aot requires --format=esm");
  expect(exitCode).not.toBe(0);
  expect(() =>
    Bun.build({
      entrypoints: [join(String(dir), "entry.cjs")],
      format: "cjs",
      compile: { aot: true, outfile: join(String(dir), "out") },
    }),
  ).toThrow("compile.aot requires format: 'esm'");
});

describe.skipIf(!supported)("Bun.ModuleGraph with --compile-aot", () => {
  async function run(entry: string) {
    using dir = tempDir("compile-aot-module-graph", {
      "entry.ts": `
        const url = new URL("./app.js", import.meta.url).href;
        async function main() { ${entry} }
        if (Bun.isMainThread && process.argv[2] === "worker") {
          const worker = new Worker(import.meta.url);
          worker.onmessage = e => { console.log(e.data); worker.terminate(); };
        } else {
          const result = JSON.stringify(await main());
          if (Bun.isMainThread) console.log(result);
          else postMessage(result);
        }
      `,
      "app.ts": `
        let n = 0;
        export function count() { return ++n; }
        export const viaClosure = () => () => count();
        export function call(f: () => number) { return f() * 100 + count(); }
        export function* each() { while (true) yield count(); }
        export async function later() { await 1; return count(); }
        export class Counter { get next() { return count(); } }
        export class Empty {}
        export class Derived extends Empty { field = count(); }
        export function tagInLoop() { let all = ""; for (let i = 0; i < 3; i++) all += tag; return all; }
        export const tagsViaBuiltin = () => [1, 2].map(() => tag).join("");
        export function disposeAndGoOn(graph: { dispose(): void }) {
          graph.dispose();
          Bun.gc(true);
          Bun.gc(true);
          return [count(), [1, 2, 3].map(x => x + n).join()];
        }
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", "--splitting", "entry.ts", "app.ts", "--outfile", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    const results = [];
    for (const where of ["main", "worker"]) {
      await using proc = Bun.spawn({
        cmd: [join(String(dir), "out"), where],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      results.push({ where, stdout: stdout.trim(), stderr, exitCode });
    }
    return results;
  }
  const everywhere = (value: unknown) =>
    ["main", "worker"].map(where => ({ where, stdout: JSON.stringify(value), stderr: "", exitCode: 0 }));

  test.concurrent("separate module state per graph", async () => {
    expect(
      await run(`
        const a = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const b = await new Bun.ModuleGraph().import(url);
        return [a.count(), a.count(), a.count(), host.count(), b.count(), b.count(), a.count === b.count, a.count === host.count];
      `),
    ).toEqual(everywhere([1, 2, 3, 1, 1, 2, false, false]));
  });

  test.concurrent(
    "functions of one graph called from another, and from the host, use their own variables",
    async () => {
      expect(
        await run(`
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        a.count();
        return [
          a.call(b.count), b.call(a.count), host.call(a.viaClosure()), a.call(host.count), a.call(() => 7),
          a.each().next().value, await b.later(), new a.Counter().next, [0].map(b.count)[0], Reflect.apply(a.count, null, []),
        ];
      `),
      ).toEqual(everywhere([102, 302, 401, 205, 706, 7, 3, 8, 4, 9]));
    },
  );

  test.concurrent("closure outlives its graph", async () => {
    expect(
      await run(`
        let graph = new Bun.ModuleGraph();
        const { count, viaClosure } = await graph.import(url);
        const closure = viaClosure();
        count();
        graph.dispose();
        graph = null;
        for (let i = 0; i < 3; i++) { Bun.gc(true); await new Bun.ModuleGraph().import(url); }
        return [count(), closure()];
      `),
    ).toEqual(everywhere([2, 3]));
  });

  test.concurrent("dispose() from the graph's own code", async () => {
    expect(
      await run(`
        const graph = new Bun.ModuleGraph();
        return (await graph.import(url)).disposeAndGoOn(graph);
      `),
    ).toEqual(everywhere([1, "2,3,4"]));
  });

  test.concurrent("default class constructors", async () => {
    expect(
      await run(`
        const host = await import(url);
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        return [
          ...[host, a, b].map(ns => [new ns.Empty() instanceof ns.Empty, new ns.Derived().field, new ns.Derived().field]),
          [a.Empty === b.Empty, new a.Derived() instanceof host.Empty, new a.Counter().next, new host.Counter().next],
        ];
      `),
    ).toEqual(
      everywhere([
        [true, 1, 2],
        [true, 1, 2],
        [true, 1, 2],
        [false, false, 4, 3],
      ]),
    );
  });

  test.concurrent("globals option", async () => {
    expect(
      await run(`
        const [x, y] = await Promise.all(["x", "y"].map(tag => new Bun.ModuleGraph({ globals: { tag } }).import(url)));
        return [x.tagInLoop(), y.tagInLoop(), x.tagInLoop(), x.tagsViaBuiltin(), y.tagsViaBuiltin(), typeof tag];
      `),
    ).toEqual(everywhere(["xxx", "yyy", "xxx", "xx", "yy", "undefined"]));
  });

  test.concurrent("600 graphs at once", async () => {
    expect(
      await run(`
        const all = [];
        for (let i = 0; i < 600; i++) all.push(await new Bun.ModuleGraph().import(url));
        all.forEach((each, i) => { for (let j = 0; j <= i % 3; j++) each.count(); });
        return all.reduce((sum, each) => sum + each.count(), 0);
      `),
    ).toEqual(everywhere(1800));
  });

  test.concurrent("dispose() frees modules while the host keeps the graph", async () => {
    expect(
      await run(`
        const registry = new FinalizationRegistry(() => collected++);
        let collected = 0;
        const graphs = [];
        for (let i = 0; i < 40; i++) {
          const graph = new Bun.ModuleGraph();
          registry.register((await graph.import(url)).count, 0);
          graph.dispose();
          graphs.push(graph);
        }
        for (let i = 0; i < 5 && collected < 30; i++) { Bun.gc(true); await new Promise(done => setTimeout(done, 1)); }
        return [collected >= 30, graphs.length];
      `),
    ).toEqual(everywhere([true, 40]));
  });

  test.concurrent("a closure survives dispose() while the host keeps the graph", async () => {
    expect(
      await run(`
        const graphs = [], closures = [];
        for (let i = 0; i < 20; i++) {
          const graph = new Bun.ModuleGraph();
          const ns = await graph.import(url);
          const f = ns.viaClosure();
          f.extra = i;
          delete f.extra;
          closures.push(f);
          graph.dispose();
          graphs.push(graph);
        }
        for (let i = 0; i < 3; i++) { Bun.gc(true); await new Promise(done => setTimeout(done, 1)); }
        return closures.map(f => f() + f()).join();
      `),
    ).toEqual(everywhere(Array(20).fill(3).join()));
  });

  test.concurrent("dropped graphs are collected", async () => {
    expect(
      await run(`
        const registry = new FinalizationRegistry(() => collected++);
        let collected = 0;
        for (let i = 0; i < 40; i++) {
          const graph = new Bun.ModuleGraph();
          registry.register((await graph.import(url)).count, 0);
          graph.dispose();
        }
        for (let i = 0; i < 5 && collected < 30; i++) { Bun.gc(true); await new Promise(done => setTimeout(done, 1)); }
        return collected >= 30;
      `),
    ).toEqual(everywhere(true));
  });
});

test.skipIf(!supported).each(["forEach", "map"])(
  "an uncaught error from the callback of %s is reported",
  async method => {
    using dir = tempDir("compile-aot-uncaught", {
      "entry.ts": `[1].${method}(function callback() { throw new Error("thrown in the callback"); });`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    await using proc = Bun.spawn({ cmd: [join(String(dir), "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, firstLines: stderr.split("\n").slice(0, 3), exitCode }).toEqual({
      stdout: "",
      firstLines: [
        "error: thrown in the callback",
        expect.stringMatching(/^ +at callback \(.*out:\d+:\d+\)$/),
        expect.stringMatching(new RegExp(`^ +at ${method} `)),
      ],
      exitCode: 1,
    });
  },
);

test.skipIf(!supported)("image and program data are used", async () => {
  using dir = tempDir("compile-aot-address", {
    "entry.ts": `function add(a: number, b: number) { return a + b; } console.log(new (function Made(this: any) { this.sum = add(1, 2); } as any)().sum);`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
  await using proc = Bun.spawn({
    cmd: [join(String(dir), "out")],
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout,
    usesProgramData: /\[aot\] program data: \d+ bytes/.test(stderr),
    usesImage: /\[aot\] image: \d+ bytes, \d+ of code at 0x[0-9a-f]+/.test(stderr),
    exitCode,
  }).toEqual({
    stdout: "3\n",
    usesProgramData: true,
    usesImage: true,
    exitCode: 0,
  });
});

test.skipIf(!supported).each([
  ["without a JIT", { BUN_JSC_useJIT: "0" }, ["--compile-aot"]],
  ["with BUN_AOT=1", { BUN_AOT: "1" }, ["--bytecode", "--format=esm"]],
])("a build %s produces the same code", async (_, env, flags) => {
  using dir = tempDir("compile-aot-builder", {
    "entry.ts": `console.log(/(\\d+)-(\\w+)/.exec("abc 123-foo")!.slice(1).join());`,
  });
  async function imageOf(outfile: string, env: Record<string, string>, flags: string[]) {
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", ...flags, "entry.ts", "--outfile", outfile],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual(["", 0]);
    await using proc = Bun.spawn({
      cmd: [join(String(dir), outfile)],
      env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "123,foo\n", exitCode: 0 });
    return stderr.match(/^\[aot\] image: \d+ bytes, \d+ of code/m)?.[0];
  }
  const [expected, actual] = await Promise.all([imageOf("a", {}, ["--compile-aot"]), imageOf("b", env, flags)]);
  expect(expected).toStartWith("[aot] image: ");
  expect(actual).toBe(expected);
});

test.skipIf(!supported)("compiles RegExps with the u and v flags", async () => {
  using dir = tempDir("compile-aot-regexps", {
    "none.ts": `console.log("none");`,
    "some.ts": `console.log([/a+b/.test("aab"), /\\p{L}+x/u.test("\\xe9x"), /^.$/u.test("\\u{1f600}"), /[\\p{L}--[a-c]]y/v.test("dy")].join());`,
  });
  async function numberOfRegExps(entry: string, expectedStdout: string) {
    const outfile = join(String(dir), entry.replace(".ts", ""));
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", entry, "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderrOfBuild, exitCodeOfBuild] = await Promise.all([
      build.stdout.text(),
      build.stderr.text(),
      build.exited,
    ]);
    expect(stderrOfBuild).not.toContain("error");
    expect(exitCodeOfBuild).toBe(0);
    await using run = Bun.spawn({
      cmd: [outfile],
      env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stdout).toBe(expectedStdout);
    expect(exitCode).toBe(0);
    return Number(stderr.match(/^\[aot\] image: .* (\d+) regular expressions$/m)?.[1]);
  }
  const none = await numberOfRegExps("none.ts", "none\n");
  expect(none).toBeGreaterThanOrEqual(0);
  expect(await numberOfRegExps("some.ts", "true,true,true,true\n")).toBe(none + 4);
});

test.skipIf(!supported)("hot run-time RegExps are compiled", async () => {
  using dir = tempDir("compile-aot-regexp-at-run-time", {
    "entry.ts": `
      const build = (word: string) => new RegExp(["(\\\\w+)@", "(\\\\w+)\\\\.", word].join(""));
      const usedOnce = build("c[o]ld"), usedOften = build("h[o]t"), usedOnLongText = build("l[o]ng");
      let found = usedOnce.exec("to foo@bar.cold")!.slice(1).join();
      for (let i = 0; i < 1000; i++) found = usedOften.exec("to foo@bar.hot")!.slice(1).join() + i;
      console.log(found, usedOnLongText.exec(Buffer.alloc(20000, "x ").toString() + "foo@bar.long")!.slice(1).join());
      console.log(new Function("a", "return a + 1")(1));
    `,
  });
  const outfile = join(String(dir), "entry");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", outfile],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual(["", 0]);
  await using run = Bun.spawn({
    cmd: [outfile],
    env: { ...bunEnv, BUN_JSC_dumpCompiledRegExpPatterns: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(stdout).toBe("foo,bar999 foo,bar\n2\n");
  const whatHappenedTo = (word: string) =>
    stderr
      .split("\n")
      .filter(line => line.endsWith(`${word}/"`))
      .map(line => line.slice(0, line.indexOf(" this regular expression")));
  expect({
    usedOnce: whatHappenedTo("c[o]ld"),
    usedOften: whatHappenedTo("h[o]t"),
    usedOnLongText: whatHappenedTo("l[o]ng"),
  }).toEqual({
    usedOnce: ["Interpreting"],
    usedOften: ["Interpreting", "Compiled"],
    usedOnLongText: ["Compiled"],
  });
  expect(exitCode).toBe(0);
});

test.skipIf(!supported)("crash reports symbolicate compiled frames", async () => {
  using dir = tempDir("compile-aot-crash", {
    "entry.ts": `
      import { crash_handler } from "bun:internal-for-testing";
      function crash(really: boolean) {
        if (really) crash_handler.segfault();
      }
      crash(process.argv.length > 0);
    `,
  });
  const outfile = join(String(dir), "entry");
  const map = join(String(dir), "map");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", outfile],
    env: { ...bunEnv, BUN_AOT_OPTIONS: `aotMapFilePath=${map}` },
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual(["", 0]);
  await using run = Bun.spawn({
    cmd: [outfile],
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);

  function decodeVLQ(text: string) {
    let value = 0;
    for (let i = 0; ; i++) {
      const digit = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(text[i]);
      value += (digit & 31) * 2 ** (5 * i);
      if (!(digit & 32)) return value % 2 ? -(value - 1) / 2 : value / 2;
    }
  }
  const offsets = stderr.split("CGaot").slice(1).map(decodeVLQ);
  const functions = (await Bun.file(map).text())
    .split("\n")
    .filter(line => line.startsWith("F\t"))
    .map(line => line.split("\t").slice(2, 4).map(Number));
  expect(functions).not.toBeEmpty();
  expect(
    offsets.filter(offset => functions.some(([start, size]) => offset >= start && offset < start + size)),
  ).not.toBeEmpty();
  expect(exitCode).not.toBe(0);
});

test.skipIf(!supported)("--cpu-prof attributes native time to the calling function", async () => {
  using dir = tempDir("compile-aot-cpu-prof", {
    "entry.ts": `
      function busy(rounds: number, seed: number) {
        let total = seed;
        for (let round = 0; round < rounds; round++) {
          total += JSON.stringify({ round }).length;
          for (let i = 1; i < 3000; i++) total += Math.sin(i + total) * Math.pow(i, 0.37) + Math.log(i) + Math.atan2(i, total);
        }
        return total;
      }
      console.log(busy(600, 1) + busy(600, 2) !== 0);
    `,
  });
  const outfile = join(String(dir), "entry");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", outfile],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual(["", 0]);
  await using run = Bun.spawn({
    cmd: [outfile],
    env: { ...bunEnv, BUN_OPTIONS: `--cpu-prof --cpu-prof-dir=${dir} --cpu-prof-name=entry.cpuprofile` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "true\n", stderr: "" });
  expect(exitCode).toBe(0);

  const hits: Record<string, number> = {};
  for (const node of (await Bun.file(join(String(dir), "entry.cpuprofile")).json()).nodes)
    hits[node.callFrame.functionName] = (hits[node.callFrame.functionName] ?? 0) + node.hitCount;
  expect(hits.busy).toBeGreaterThan(20);
  expect(hits.busy).toBeGreaterThan(3 * (hits.stringify ?? 0));
});

test.skipIf(!supported)("image size limit is a build error", async () => {
  using dir = tempDir("compile-aot-too-large", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", "out"],
    env: { ...bunEnv, BUN_AOT_OPTIONS: "numberOfAOTStubCopiesForTesting=12" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("the program has too much machine code for an image");
  expect(stderr).toContain("error: Failed to compile the program ahead of time");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test.skipIf(!supported)("--compile-aot with --bytecode-depth is an error", async () => {
  using dir = tempDir("compile-aot-depth", {
    "entry.ts": `function a() { return function b() { return function c() { return 1; }; }; } console.log(a()()());`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "--bytecode-depth=1", "entry.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: Failed to compile the program ahead of time");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test.skipIf(!supported).each([
  ["that is not an executable", ["--target=bun", "--outfile", "out.js"]],
  ["without bytecode", ["--compile", "--outfile", "out"]],
])("BUN_AOT=1 does not affect a build %s", async (_, flags) => {
  using dir = tempDir("compile-aot-env-other", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", ...flags],
    env: { ...bunEnv, BUN_AOT: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);

  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--compile", "--bytecode", "--format=esm", "--outfile", "compiled"],
    env: { ...bunEnv, BUN_AOT: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await build.exited).toBe(0);
  await using run = Bun.spawn({
    cmd: [join(String(dir), "compiled")],
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdoutOfRun, stderrOfRun, exitCodeOfRun] = await Promise.all([
    run.stdout.text(),
    run.stderr.text(),
    run.exited,
  ]);
  expect(stdoutOfRun).toBe("1\n");
  expect(stderrOfRun).toContain("[aot] image: ");
  expect(exitCodeOfRun).toBe(0);
});

test.skipIf(!supported)("BUN_AOT=0 disables AoT at build time", async () => {
  using dir = tempDir("compile-aot-env-off", { "entry.ts": `console.log(function named() {}.toString());` });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--compile", "--compile-aot", "--outfile", "out"],
    env: { ...bunEnv, BUN_AOT: "0" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
  await using proc = Bun.spawn({
    cmd: [join(String(dir), "out")],
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, hasImage: stderr.includes("[aot] image: "), exitCode }).toEqual({
    stdout: "function named() {}\n",
    hasImage: false,
    exitCode: 0,
  });
});

test("--compile-aot requires --compile", async () => {
  using dir = tempDir("compile-aot-requires-compile", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile-aot", "entry.ts", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--compile-aot requires --compile");
  expect(exitCode).not.toBe(0);
});

describe.skipIf(!supported)("--compile-aot across threads", () => {
  async function run(files: Record<string, string>, entryPoints: string[], env: Record<string, string> = {}) {
    using dir = tempDir("compile-aot-threads", files);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", "--splitting", ...entryPoints, "--outfile", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    await using proc = Bun.spawn({
      cmd: [join(String(dir), "out")],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const churn = `
    let n = 0;
    const kept: unknown[] = [];
    class Node { next?: Node; constructor(public value: number) {} }
    class Empty {}
    export function churn(rounds: number) {
      let head: Node | undefined;
      for (let i = 0; i < rounds; i++) {
        const node = new Node(i);
        node.next = i % 50 ? head : undefined;
        head = node;
        if (/(\\d)5$/.test(String(i))) kept.push({ i, text: "t" + i, empty: new Empty(), f: () => n + i });
        if (kept.length > 200) kept.length = 0;
        n += [i, i + 1].map(x => x & 3).reduce((a, b) => a + b, 0);
      }
      return n;
    }
    export function spin(turns: Int32Array) { for (;;) turns[0]++; }
  `;

  test.concurrent("terminate a busy Worker", async () => {
    expect(
      await run(
        {
          "entry.ts": `
            import { spin } from "./app.ts";
            if (Bun.isMainThread) {
              const turns = new Int32Array(new SharedArrayBuffer(4));
              const worker = new Worker(import.meta.url);
              worker.postMessage(turns);
              while (Atomics.load(turns, 0) < 100000) await new Promise(done => setImmediate(done));
              const closed = new Promise(done => worker.addEventListener("close", done));
              worker.terminate();
              await closed;
              const afterwards = Atomics.load(turns, 0);
              await new Promise(done => setImmediate(done));
              console.log("terminated", afterwards === Atomics.load(turns, 0));
            } else onmessage = event => spin(event.data);
          `,
          "app.ts": churn,
        },
        ["entry.ts"],
      ),
    ).toEqual({ stdout: "terminated true\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("120 sequential Workers with graphs", async () => {
    expect(
      await run(
        {
          "entry.ts": `
            const url = new URL("./app.js", import.meta.url).href;
            if (Bun.isMainThread) {
              const results = new Set();
              for (let i = 0; i < 120; i++) {
                const worker = new Worker(import.meta.url);
                results.add(await new Promise(done => (worker.onmessage = e => done(e.data))));
                const closed = new Promise(done => worker.addEventListener("close", done));
                worker.terminate();
                await closed;
              }
              console.log(JSON.stringify([...results]));
            } else {
              const graphs = await Promise.all([1, 2, 3].map(() => new Bun.ModuleGraph().import(url)));
              postMessage(graphs.map(ns => ns.churn(2000)).join());
            }
          `,
          "app.ts": churn,
        },
        ["entry.ts", "app.ts"],
      ),
    ).toEqual({ stdout: `["6000,6000,6000"]\n`, stderr: "", exitCode: 0 });
  });

  test.concurrent("graphs under GC stress", async () => {
    expect(
      await run(
        {
          "entry.ts": `
            const url = new URL("./app.js", import.meta.url).href;
            if (Bun.isMainThread) {
              const workers = [1, 2, 3].map(() => new Worker(import.meta.url));
              const results = await Promise.all(workers.map(worker => new Promise(done => (worker.onmessage = e => done(e.data)))));
              workers.forEach(worker => worker.terminate());
              console.log(JSON.stringify([...new Set(results)]));
            } else {
              let out = [];
              for (let round = 0; round < 6; round++) {
                const graphs = await Promise.all([1, 2, 3, 4].map(() => new Bun.ModuleGraph().import(url)));
                out = graphs.map(ns => ns.churn(30000));
              }
              postMessage(out.join());
            }
          `,
          "app.ts": churn,
        },
        ["entry.ts", "app.ts"],
        { BUN_JSC_slowPathAllocsBetweenGCs: "20" },
      ),
    ).toEqual({ stdout: `["90000,90000,90000,90000"]\n`, stderr: "", exitCode: 0 });
  });

  const inEightWorkers = (work: string) => ({
    "entry.ts": `
      import { work } from "./work.ts";
      if (Bun.isMainThread) {
        const workers = Array.from({ length: 8 }, () => new Worker(import.meta.url));
        const results = await Promise.all(workers.map(worker => new Promise(done => (worker.onmessage = e => done(e.data)))));
        workers.forEach(worker => worker.terminate());
        console.log(JSON.stringify([...new Set(results)]), work() === results[0]);
      } else postMessage(work());
    `,
    "work.ts": work,
  });

  test.concurrent("RegExp literals in 8 Workers", async () => {
    expect(
      await run(
        inEightWorkers(`
          const sticky = /a+/y;
          export function work() {
            let out = "";
            for (let i = 0; i < 20000; i++) {
              const text = "x" + i + "-aab-" + (i % 7) + "Z";
              out = [
                /(\\d+)-(a+)b/.exec(text)![2], text.replace(/[0-9]/g, "#").length, /z$/i.test(text), text.split(/-/).length,
                text.match(/(?<n>\\d)Z/)!.groups!.n, text.search(/aab/), (sticky.lastIndex = 0, sticky.test("aaa"), sticky.lastIndex),
                [...text.matchAll(/a/g)].length, /^(?:red|green|blue)$/.test(["red", "pink"][i & 1]),
              ].join();
            }
            return out;
          }
        `),
        ["entry.ts"],
      ),
    ).toEqual({ stdout: `["aa,13,true,3,0,7,3,2,false"] true\n`, stderr: "", exitCode: 0 });
  });

  test.concurrent("functions, classes and literals in 8 Workers", async () => {
    expect(
      await run(
        inEightWorkers(`
          const tag = (strings: TemplateStringsArray, ...values: unknown[]) => strings.raw.join("|") + values.length;
          class Base { static made = 0; #secret = 1; get secret() { return this.#secret; } constructor() { Base.made++; } }
          class Derived extends Base { field = [1, 2, 3]; method(x = 2) { return this.field.map(v => v * x).join("") + super.secret; } }
          function* each(n: number) { for (let i = 0; i < n; i++) yield { i, big: 12345678901234567890n, text: \`t\${i}\` }; }
          const site = () => tag\`a\${1}b\`;
          export function work() {
            let out = "";
            for (let i = 0; i < 3000; i++) {
              const last = [...each(3)].at(-1)!;
              out = [new Derived().method(), last.text, last.big % 97n, site(), site() === site(), { a: 1, b: [i & 1], c: { d: null } }.b[0]].join();
            }
            return out + "," + Base.made;
          }
        `),
        ["entry.ts"],
      ),
    ).toEqual({ stdout: `["2461,t2,3,a|b1,true,1,3000"] true\n`, stderr: "", exitCode: 0 });
  });
});

describe.skipIf(!supported)("--compile-aot optimizations", () => {
  const program = /* ts */ `
    const out: unknown[] = [];
    const kept: unknown[] = [];
    function keep<T>(x: T): T { kept.push(x); return x; }

    function small(x: number) { return x + 1; }
    function inlinesSmall(x: number) { return small(x); }
    function recursive(n: number): number { return n < 2 ? n : recursive(n - 1) + recursive(n - 2); }
    function callsRecursive(n: number) { return recursive(n); }
    let reassigned = (x: number) => x + 1;
    function callsReassigned(x: number) { return reassigned(x); }
    function oneOfTwoA(x: number) { return x + 1; }
    function oneOfTwoB(x: number) { return x + 2; }
    function callsEither(f: (x: number) => number, x: number) { return f(x); }
    function large(a: number, b: number) {
      let s = 0;
      for (let i = 0; i < a; i++) { s += i * b; if (s > 1000) s -= 1000; if (s % 7 == 3) s += b; else s -= a; }
      for (let i = 0; i < b; i++) { s ^= i + a; if (s < 0) s = -s; if (s % 5 == 1) s += a; else s -= b; }
      return s;
    }
    function callsLargeOnce(x: number) { return large(x, 3); }
    function callsLargeTwice(x: number) { return large(x, 4) + 1; }
    out.push(inlinesSmall(1), callsRecursive(10), callsReassigned(1), callsEither(oneOfTwoA, 1), callsEither(oneOfTwoB, 1));
    out.push(callsLargeOnce(5), callsLargeTwice(5));
    reassigned = x => x + 2;
    out.push(callsReassigned(1));

    function makeAdderCalled(k: number) { return (x: number) => x + k; }
    function callsClosure(i: number) { return makeAdderCalled(i)(1); }
    function makeAdderKept(k: number) { return (x: number) => x + k; }
    function keepsClosure(i: number) { return keep(makeAdderKept(i))(1); }
    out.push(callsClosure(1), keepsClosure(1));

    function sumOfPair(p: { x: number; y: number }) { return p.x + p.y; }
    function passesLiteral(i: number) { return sumOfPair({ x: i, y: i + 1 }); }
    function keepsPair(p: { x: number; y: number }) { return keep(p).x + p.y; }
    function passesLiteralThatEscapes(i: number) { return keepsPair({ x: i, y: i + 1 }); }
    out.push(passesLiteral(1), passesLiteralThatEscapes(1));

    function withDefaultOmitted({ a, b = 2 }: { a: number; b?: number }) { return a * b; }
    function omitsB(i: number) { return withDefaultOmitted({ a: i }); }
    function withDefaultPassed({ a, b = 2 }: { a: number; b?: number }) { return a * b; }
    function passesB(i: number) { return withDefaultPassed({ a: i, b: 3 }); }
    function withInherited({ a, toString }: { a: number; toString?: unknown }) { return typeof toString + a; }
    function omitsInherited(i: number) { return withInherited({ a: i }); }
    out.push(omitsB(4), passesB(4), omitsInherited(1));

    function returnsPairRead(n: number) { let s = 0; for (let j = 0; j < n; j++) s += keep(j); return { x: s, y: n }; }
    function readsReturnedA(i: number) { const { x, y } = returnsPairRead(i); return x + y; }
    function readsReturnedB(i: number) { const r = returnsPairRead(i); return r.x - r.y; }
    function returnsPairKept(n: number) { let s = 0; for (let j = 0; j < n; j++) s += keep(j); return { x: s, y: n }; }
    function readsReturnedC(i: number) { const { x, y } = returnsPairKept(i); return x + y; }
    function keepsReturned(i: number) { return keep(returnsPairKept(i)).x; }
    out.push(readsReturnedA(3), readsReturnedB(3), readsReturnedC(3), keepsReturned(3));

    class Planned { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
    class Conditional { x = 0; y?: number; constructor(x: number) { if (x > 1) this.y = x; this.x = x; } }
    class EitherA { v: number; constructor(v: number) { this.v = v; } }
    class EitherB { v: number; constructor(v: number) { this.v = v + 1; } }
    function constructsPlanned(i: number) { return new Planned(i, 1).sum(); }
    function constructsConditional(i: number) { return new Conditional(i).x; }
    function constructsEither(C: new (v: number) => { v: number }, i: number) { return new C(i).v; }
    out.push(constructsPlanned(1), constructsConditional(2), constructsEither(EitherA, 1), constructsEither(EitherB, 1));

    function floors(x: number) { return Math.floor(x); }
    function floorsShadowed(x: number) { const Math = { floor: (y: number) => y + 0.5 }; return Math.floor(x); }
    function isArray(x: unknown) { return Array.isArray(x); }
    out.push(floors(1.5), floorsShadowed(1), isArray([]));

    function sumsNumbers(a: number[]) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
    function sumsFields(a: { v: number }[]) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i].v; return s; }
    function callsInLoop(a: number[]) { let s = 0; for (let i = 0; i < a.length; i++) s += keep(a[i]); return s; }
    function hasNoLoop(a: number[]) { return a[0] + a[1]; }
    out.push(sumsNumbers([1, 2, 3]), sumsFields([{ v: 1 }, { v: 2 }]), callsInLoop([1, 2, 3]), hasNoLoop([1, 2]));

    class Twin { v: number; constructor(v: number) { this.v = v; } twin() { return new Twin(this.v + 1); } }
    class Parent { v: number; constructor(v: number) { this.v = v; } }
    class Child extends Parent { constructor(v: number) { super(v + 1); } }
    class Implicit { again() { return new Implicit(); } one() { return 1; } }
    function constructsInLoop(n: number) { let s = 0; for (let i = 0; i < n; i++) s += new Twin(i).v; return s; }
    function constructsChildInLoop(n: number) { let s = 0; for (let i = 0; i < n; i++) s += new Child(i).v; return s; }
    function constructsEitherInLoop(C: new (v: number) => { v: number }, n: number) { let s = 0; for (let i = 0; i < n; i++) s += new C(i).v; return s; }
    function constructsImplicitInLoop(n: number) { let s = 0; const first = new Implicit(); for (let i = 0; i < n; i++) s += first.again().one(); return s; }
    out.push(new Twin(1).twin().v, constructsInLoop(4), constructsChildInLoop(4), constructsEitherInLoop(EitherA, 4), constructsEitherInLoop(EitherB, 4), constructsImplicitInLoop(20000));

    console.log(out.join());
  `;
  const expectedOutput = "2,55,2,2,3,4,6,3,2,2,3,3,8,12,function1,6,0,6,3,2,2,1,2,1,1.5,true,6,3,6,3,2,6,10,6,10,20000\n";
  const loopOptions = "useAOTLoopSplitting=1,useAOTInlineFastPathsInLoops=1";

  const builds = new Map<string, Promise<Map<string, string[]>>>();
  function remarksWith(options: string) {
    let build = builds.get(options);
    if (!build) builds.set(options, (build = buildAndRun(options)));
    return build;
  }
  async function buildAndRun(options: string) {
    using dir = tempDir("compile-aot-optimizations", { "entry.ts": program });
    const path = join(String(dir), "remarks.txt");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", "out"],
      env: { ...bunEnv, BUN_AOT_OPTIONS: [`aotRemarksPath=${path}`, options].filter(Boolean).join(",") },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    await using proc = Bun.spawn({ cmd: [join(String(dir), "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(expectedOutput);
    expect(exitCode).toBe(0);
    const remarks = new Map<string, string[]>();
    for (const line of (await Bun.file(path).text()).split("\n")) {
      const [name, remark] = line.split("\t");
      if (remark) remarks.set(name, [...(remarks.get(name) ?? []), remark]);
    }
    return remarks;
  }

  const cases: [remark: string, appliesTo: string[], doesNotApplyTo: string[], options?: string][] = [
    ["inlined-call:small", ["inlinesSmall"], []],
    ["inlined-call", [], ["recursive", "callsRecursive", "callsReassigned", "callsEither", "callsLargeOnce", "callsLargeTwice"]],
    ["direct-call:recursive", ["recursive", "callsRecursive"], []],
    ["direct-call:large", ["callsLargeOnce", "callsLargeTwice"], []],
    ["direct-call", [], ["inlinesSmall", "callsReassigned", "callsEither"]],
    ["inlined-closure", ["callsClosure"], ["keepsClosure"]],
    ["scalar-replaced-object", ["passesLiteral", "omitsB", "passesB"], ["passesLiteralThatEscapes", "omitsInherited"]],
    ["absent-property-is-undefined:b", ["omitsB"], ["passesB"]],
    ["absent-property-is-undefined", [], ["omitsInherited"]],
    ["reads-returned-object-from-registers:returnsPairRead", ["readsReturnedA", "readsReturnedB"], []],
    ["reads-returned-object-from-registers", [], ["readsReturnedC", "keepsReturned"]],
    ["planned-construction", ["Planned", "EitherA", "EitherB"], ["Conditional"]],
    ["direct-construct:Planned", ["constructsPlanned"], []],
    ["direct-construct:Conditional", ["constructsConditional"], []],
    ["direct-construct", [], ["constructsEither", "constructsEitherInLoop"]],
    ["direct-construct:Twin", ["twin"], []],
    ["direct-construct:Child", ["constructsChildInLoop"], []],
    ["inlined-construct:Twin", ["constructsInLoop"], []],
    ["inlined-construct", [], ["constructsChildInLoop", "constructsEitherInLoop", "constructsImplicitInLoop", "again"]],
    ["direct-construct", [], ["again"]],
    ["lowered-builtin:Math.floor", ["floors"], ["floorsShadowed"]],
    ["lowered-builtin:Array.isArray", ["isArray"], []],
    ["profitable-loop", ["sumsNumbers", "sumsFields"], ["callsInLoop", "hasNoLoop"], loopOptions],
    ["split-loop", ["sumsFields"], ["callsInLoop", "hasNoLoop"], loopOptions],
    ["profitable-loop", [], ["sumsNumbers", "sumsFields"]],
    ["split-loop", [], ["sumsFields"]],
  ];
  const matches = (remark: string, pattern: string) => remark === pattern || remark.startsWith(pattern + ":");

  test.each(cases)("%s applies to %j and not to %j", async (pattern, appliesTo, doesNotApplyTo, options = "") => {
    const remarks = await remarksWith(options);
    const have = (name: string) => {
      expect(remarks.get(name), name).toContain("compiled");
      return remarks.get(name)!.some(remark => matches(remark, pattern));
    };
    expect(Object.fromEntries(appliesTo.map(name => [name, have(name)]))).toEqual(
      Object.fromEntries(appliesTo.map(name => [name, true])),
    );
    expect(Object.fromEntries(doesNotApplyTo.map(name => [name, have(name)]))).toEqual(
      Object.fromEntries(doesNotApplyTo.map(name => [name, false])),
    );
  });
});

describe.skipIf(!supported)("--compile-aot with a type table", () => {
  const root = join(import.meta.dir, "compile-aot-typed");
  const typed = [
    "useTypeTags=1",
    "useAOTTypedFields=1",
    `aotTypeTablePath=${join(root, "types.bin")}`,
    `aotOverriddenMethodsPath=${join(root, "overridden.txt")}`,
  ].join(",");

  async function buildAndRun(options: string, env: Record<string, string>) {
    using dir = tempDir("compile-aot-typed", {});
    const path = join(String(dir), "remarks.txt");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", "src/main.ts", "--outfile", join(String(dir), "out")],
      env: {
        ...bunEnv,
        ...env,
        BUN_SOUND_TYPES_TAGS: join(root, "tags.bin"),
        BUN_SOUND_TYPES_ORACLE_ROOT: root,
        BUN_AOT_OVERRIDDEN_METHODS: join(root, "overridden.txt"),
        BUN_AOT_OPTIONS: [typed, `aotRemarksPath=${path}`, options].filter(Boolean).join(","),
      },
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    await using proc = Bun.spawn({
      cmd: [join(String(dir), "out")],
      env: { ...bunEnv, ...env, BUN_AOT_VERBOSE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("[aot] image: ");
    expect(stderr).not.toContain("[aot] not using");
    const remarks = new Map<string, string[]>();
    for (const line of (await Bun.file(path).text()).split("\n")) {
      const [name, remark] = line.split("\t");
      if (remark) remarks.set(name, [...(remarks.get(name) ?? []), remark]);
    }
    return { stdout, exitCode, remarks };
  }

  const cases: [remark: string, appliesTo: string[], doesNotApplyTo: string[]][] = [
    ["typed-field-read:a", ["readsSound"], []],
    ["typed-field-read:b", ["readsSound"], []],
    ["typed-field-read:x", ["add", "length2"], []],
    ["typed-field-read", [], ["readsTyped", "readsUntyped", "makesLoose"]],
    ["typed-field-write:a", ["writesSound"], []],
    ["typed-field-write", [], ["writesTyped", "writesUntyped"]],
    ["typed-planned-construction", ["Vector"], ["Loose"]],
    ["planned-construction", ["Loose"], ["Vector"]],
    ["inlined-call:twice", ["scalesInLoop"], []],
    ["inlined-construct:Scaled", ["scalesInLoop"], []],
    ["inlined-call", [], ["scalesLeakedInLoop"]],
    ["direct-call", [], ["scalesLeakedInLoop"]],
    ["direct-construct:Leaked", ["twiceLeaked"], []],
  ];

  for (const [label, options, env] of [
    ["as it is", "", {}],
    ["validated", "validateAOTInferredTypes=1,validateGraphAtEachPhase=1", {}],
    ["with loop optimizations", "useAOTLoopSplitting=1,useAOTInlineFastPathsInLoops=1", {}],
    ["without data stubs", "", { BUN_JSC_useAOTDataStubs: "0" }],
  ] as const) {
    test(label, async () => {
      await using reference = Bun.spawn({
        cmd: [bunExe(), "src/main.ts"],
        env: bunEnv,
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [expected, { stdout, exitCode, remarks }] = await Promise.all([
        reference.stdout.text(),
        buildAndRun(options, env),
      ]);
      expect(expected).not.toBe("");
      expect(stdout).toBe(expected);
      expect(exitCode).toBe(0);
      const have = (name: string, pattern: string) => {
        expect(remarks.get(name), name).toContain("compiled");
        return remarks.get(name)!.some(remark => remark === pattern || remark.startsWith(pattern + ":"));
      };
      for (const [pattern, appliesTo, doesNotApplyTo] of cases) {
        expect({ pattern, applies: appliesTo.filter(name => have(name, pattern)) }).toEqual({ pattern, applies: appliesTo });
        expect({ pattern, applies: doesNotApplyTo.filter(name => have(name, pattern)) }).toEqual({ pattern, applies: [] });
      }
    });
  }
});
