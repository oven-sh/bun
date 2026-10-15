import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { BundlerTestInput, itBundled as itBundledBase } from "./expectBundled";


const usesImage = (stdout: string) =>
  ({
    env: { BUN_AOT_VERBOSE: "1" },
    validate({ stdout: actual, stderr }) {
      expect(actual).toBe(stdout);
      expect(stderr).toContain("[aot] image: ");
      expect(stderr).not.toContain("[aot] not using");
    },
  }) satisfies BundlerTestInput["run"];

describe("bundler", () => {
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
          (globalThis as any).compiled = compiled;
          console.log((0, eval)("compiled(1) + 1"), new Function("a", "return compiled(a) * 3")(4));
        `,
      },
      run: usesImage("3 15\n"),
    });

    itBundled("CodeMadeAtRunTimeWithOperationCounters", {
      files: {
        "/entry.ts": /* js */ `
          function compiled(a: number) { return a + 1; }
          (globalThis as any).compiled = compiled;
          const made = new Function("a", "function inner(b) { return compiled(b) * 2; } return inner(a) + inner(a + 1);");
          console.log(made(1), (0, eval)("(function () { function later(x) { return compiled(x); } return later(5); })()"), [3, 1, 2].sort().join());
        `,
      },
      run: { ...usesImage("10 6 1,2,3\n"), env: { BUN_AOT_VERBOSE: "1", BUN_JSC_useAOTOperationCounters: "1" } },
    });

    itBundled("NextTickQueueIsCompiled", {
      files: {
        "/entry.ts": /* js */ `
          const order: string[] = [];
          process.nextTick((a: string, b: string) => order.push(a + b), "first", "!");
          process.nextTick(() => order.push("second"));
          await new Promise<void>(done => process.nextTick(() => process.nextTick(done)));
          const error = await new Promise<Error>(done => process.nextTick(() => done(new Error("here"))));
          console.log(order.join(" "), /processTicksAndRejections \\(internal:process\\/next_tick_queue/.test(error.stack!));
          console.error(error);
        `,
      },
      run: {
        env: { BUN_AOT_VERBOSE: "1" },
        validate({ stdout, stderr }) {
          expect(stdout).toBe("first! second true\n");
          expect(stderr).toContain("[aot] image: ");
          expect(stderr).not.toContain("[aot] not using");
          expect(stderr).toContain("error: here");
          expect(stderr).not.toContain("processTicksAndRejections");
        },
      },
    });

    itBundled("VariableLiveAcrossTwoHandlers", {
      files: {
        "/entry.ts": /* js */ `
          function make() { return { tag: "kept" }; }
          let calls = 0;
          function between() { calls++; }
          function adjacent() { const x = make(); try { throw 1; } catch (a) { } try { throw 2; } catch (b) { } return x.tag; }
          function separated() { const x = make(); try { throw 1; } catch (a) { } between(); try { throw 2; } catch (b) { } return x.tag; }
          function stackIdiom() { const x = make(); let stack; try { throw new Error("here"); } catch (e) { stack = (e as Error).stack; } between(); try { JSON.parse("{"); } catch (b) { return x.tag + typeof stack; } return "no"; }
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

    itBundled("AsyncFramesOfErrorsFromNativeCode", {
      files: {
        "/entry.ts": /* js */ `
          async function inner(path: string) {
            return await Bun.file(path).text();
          }
          async function middle(path: string) {
            return (await inner(path)).length;
          }
          async function outer(path: string) {
            return (await middle(path)) + 1;
          }
          try {
            await outer("/nonexistent/file/for/this/test");
          } catch (error) {
            const frames = String((error as Error).stack).split(String.fromCharCode(10)).filter(line => line.includes("at async "));
            const lines = frames.map(line => Number(line.split(":").at(-2)));
            console.log(frames.map(line => line.trim().split(" ")[2]).join(" "), lines[0] < lines[1] && lines[1] < lines[2]);
          }
        `,
      },
      run: usesImage("inner middle outer true\n"),
    });

    itBundled("StackWalksGiveNoFunctionObjects", {
      files: {
        "/entry.ts": /* js */ `
          import { run } from "./sloppy.cjs";
          console.log(run());
          const guest = new Function(\`
            const previous = Error.prepareStackTrace;
            Error.prepareStackTrace = (error, sites) => sites;
            const sites = new Error("x").stack;
            Error.prepareStackTrace = previous;
            return sites.slice(0, 2).map(site => typeof site.getFunction()).join(" ");
          \`);
          function callsGuest() { const result = guest(); return result; }
          console.log(callsGuest());
        `,
        "/sloppy.cjs": /* js */ `
          function capture() {
            const previous = Error.prepareStackTrace;
            Error.prepareStackTrace = (error, sites) => sites;
            const sites = new Error("x").stack;
            Error.prepareStackTrace = previous;
            return sites.slice(0, 3).map(site => [site.getFunctionName(), typeof site.getFunction(), site.getFunction() === hidden, typeof site.getThis(), site.getLineNumber() > 0, site.getColumnNumber() > 0].join(":")).join(" ");
          }
          function hidden() { const result = capture(); return result; }
          exports.run = function run() {
            const mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
            const result = hidden();
            return mode + " " + result;
          };
        `,
      },
      run: usesImage(
        "sloppy capture:undefined:false:undefined:true:true hidden:undefined:false:undefined:true:true run:undefined:false:undefined:true:true\nfunction undefined\n",
      ),
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
          console.log(new A().m(), (List.from([1, 2, 3]) as List).sum(), (globalThis as any).fetch());
        `,
      },
      run: usesImage(
        "TypeError TypeError TypeError TypeError TypeError true true false function\nTypeError\nfalse\n2 6 replaced\n",
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

    itBundled("ImportReadInLoopOfClosureThatHoldsItsCaptures", {
      splitting: true,
      files: {
        "/entry.ts": /* js */ `
          import { table } from "./shared";
          function first(a: number) {
            const x = a + 1;
            return function second(b: number) {
              const y = b + x;
              return function third(c: number) {
                const z = c + y;
                return function sum(list: number[]) {
                  let s = 0;
                  for (let i = 0; i < list.length; i++)
                    s += table[i] + list[i] + z;
                  return s;
                };
              };
            };
          }
          console.log(first(1)(2)(3)([1, 2, 3, 4]));
          const lazy = await import("./lazy");
          console.log(lazy.size());
        `,
        "/lazy.ts": /* js */ `
          import { table } from "./shared";
          export function size() { return table.length; }
        `,
        "/shared.ts": /* js */ `
          export const table = [1, 2, 3, 4];
        `,
      },
      run: usesImage("48\n4\n"),
    });

    itBundled("CompiledModulesCannotBeMocked", {
      splitting: true,
      files: {
        "/entry.ts": /* js */ `
          const [a, b] = await Promise.all([import("./a"), import("./b")]);
          const root = Bun.main.slice(0, Bun.main.lastIndexOf("/") + 1);
          const pathIn = (stack: string) => stack.slice(stack.indexOf(root), stack.indexOf(".js", stack.indexOf(root)) + 3);
          const { mock, jest } = await new Function("return import('bun:test')")();
          const replacement = () => ({ table: { kept: "mocked", other: "mocked" }, readTable: () => "mocked", fromA: () => "mocked" });
          for (const [label, path] of [["internal", pathIn(a.stackOfShared())], ["target", pathIn(a.stackInA())], ["main", Bun.main]]) {
            for (const [name, replace] of [["mock.module", mock.module], ["jest.mock", jest.mock]]) {
              let said: string;
              try { await replace(path, replacement); said = "replaced"; } catch (e: any) { said = e.constructor.name; }
              console.log(label, name, said, a.fromA(), b.fromB());
            }
          }
          await mock.module("not-in-the-executable", () => ({ answer: 42 }));
          console.log((await new Function("return import('not-in-the-executable')")()).answer, (await import("./lazy")).fromLazy(), (await import("./lazy2")).fromLazy2());
        `,
        "/a.ts": /* js */ `
          import { readTable, stackInShared, table, ready } from "./shared";
          export function fromA() { return readTable() + ":" + table.kept + ":" + ready; }
          export const stackOfShared = stackInShared;
          export function stackInA() { return new Error("here").stack!; }
        `,
        "/b.ts": /* js */ `
          import { readTable, table } from "./shared";
          export function fromB() { return readTable() + ":" + table.other; }
        `,
        "/shared.ts": /* js */ `
          export const ready = await Promise.resolve("ready");
          export const table = { kept: 1, other: 2 };
          export function readTable() { return table.kept + table.other; }
          export function stackInShared() { return new Error("here").stack!; }
        `,
        "/lazy.ts": /* js */ `
          import { readTable } from "./shared";
          import { readLate } from "./late";
          export function fromLazy() { return "lazy" + readTable() + readLate(); }
        `,
        "/lazy2.ts": /* js */ `
          import { readLate, late } from "./late";
          export function fromLazy2() { return "lazy" + readLate() + late.v; }
        `,
        "/late.ts": /* js */ `
          export const late = { v: 1 };
          export function readLate() { return late.v; }
        `,
      },
      run: usesImage(
        [
          ...["internal", "target", "main"].flatMap(label => ["mock.module", "jest.mock"].map(name => label + " " + name + " TypeError 3:1:ready 3:2")),
          "42 lazy31 lazy11",
          "",
        ].join("\n"),
      ),
    });

    itBundled("ExportsOfCompiledModulesCannotBeSpiedOn", {
      splitting: true,
      files: {
        "/entry.ts": /* js */ `
          const lazy = await import("./lazy"), user = await import("./user");
          const { spyOn } = await new Function("return import('bun:test')")();
          for (const name of ["helper", "table", "box"]) {
            let said: string;
            try { spyOn(lazy, name); said = "replaced"; } catch (e: any) { said = e.constructor.name; }
            console.log(name, said, user.fromUser());
          }
          const own = { method() { return 1; } };
          spyOn(own, "method").mockImplementation(() => 2);
          console.log(own.method());
        `,
        "/lazy.ts": /* js */ `
          export const table = { kept: 1, other: 2 };
          export class Box { v = 1; w = 2.5; get() { return this.v + this.w; } }
          export const box = new Box();
          export function helper(n: number) { return n * 2; }
          export function read() { return table.kept + ":" + table.other + ":" + box.get() + ":" + helper(2); }
        `,
        "/user.ts": /* js */ `
          import { read, table, box, helper } from "./lazy";
          export function fromUser() { return read() + " | " + table.kept + ":" + box.get() + ":" + helper(3); }
        `,
      },
      run: usesImage(["helper", "table", "box"].map(name => name + " TypeError 1:2:3.5:4 | 1:3.5:6\n").join("") + "2\n"),
    });

    itBundled("CompiledModulesCannotBeEvicted", {
      splitting: true,
      files: {
        "/entry.ts": /* js */ `
          const load = () => import("./lazy");
          const first = await load();
          console.log(first.bump(), first.bump());
          const root = Bun.main.slice(0, Bun.main.lastIndexOf("/") + 1);
          const listed = Object.keys(require.cache).filter(name => name.startsWith(root) && name !== Bun.main);
          for (const name of listed) delete require.cache[name];
          console.log(listed.length, (await load()) === first, first.bump());
          require.cache["/not/in/the/executable.js"] = { exports: 1 } as any;
          console.log(delete require.cache["/not/in/the/executable.js"], "/not/in/the/executable.js" in require.cache);
        `,
        "/lazy.ts": /* js */ `
          let count = 0;
          export function bump() { return ++count; }
        `,
      },
      run: usesImage("1 2\n0 true 3\ntrue false\n"),
    });
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
      env: bunEnv,
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

test("compile.aot: concurrent builds from several threads", async () => {
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
const whyNot = "ahead-of-time compilation makes machine code for the platform it runs on and cannot target another";

test("--aot rejects cross-compilation and unsupported targets", async () => {
  using dir = tempDir("compile-aot-cross", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", `--target=${otherTarget}`, "entry.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(`--aot: ${whyNot}`);
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

test("--aot requires --format=esm", async () => {
  using dir = tempDir("compile-aot-format", { "entry.cjs": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "--format=cjs", "entry.cjs", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--aot requires --format=esm");
  expect(exitCode).not.toBe(0);
  expect(() =>
    Bun.build({
      entrypoints: [join(String(dir), "entry.cjs")],
      format: "cjs",
      compile: { aot: true, outfile: join(String(dir), "out") },
    }),
  ).toThrow("compile.aot requires format: 'esm'");
});

describe("Bun.ModuleGraph with --aot", () => {
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
      cmd: [bunExe(), "build", "--compile", "--aot", "--splitting", "entry.ts", "app.ts", "--outfile", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    const results: { where: string; stdout: string; stderr: string; exitCode: number }[] = [];
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

test.each(["forEach", "map"])(
  "an uncaught error from the callback of %s is reported",
  async method => {
    using dir = tempDir("compile-aot-uncaught", {
      "entry.ts": `[1].${method}(function callback() { throw new Error("thrown in the callback"); });`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
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
        expect.stringMatching(/^ +at callback \(.*entry\.ts:\d+:\d+\)$/),
        expect.stringMatching(new RegExp(`^ +at ${method} `)),
      ],
      exitCode: 1,
    });
  },
);

test("image and program data are used", async () => {
  using dir = tempDir("compile-aot-address", {
    "entry.ts": `function add(a: number, b: number) { return a + b; } console.log(new (function Made(this: any) { this.sum = add(1, 2); } as any)().sum);`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
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

test.each([
  ["without a JIT", { BUN_JSC_useJIT: "0" }, ["--aot"]],
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
  const [expected, actual] = await Promise.all([imageOf("a", {}, ["--aot"]), imageOf("b", env, flags)]);
  expect(expected).toStartWith("[aot] image: ");
  expect(actual).toBe(expected);
});

test("builds are reproducible", async () => {
  using dir = tempDir("compile-aot-reproducible", {
    "entry.ts": `
      const classes = [
        (() => class { a; b; c; constructor(x: number) { this.a = x; this.b = x + 1; this.c = x + 2; } sum() { return this.a + this.b + this.c; } })(),
        (() => class { d; e; f; constructor(x: number) { this.d = x; this.e = x + 1; this.f = x + 2; } sum() { return this.d + this.e + this.f; } })(),
        (() => class { g; h; i; constructor(x: number) { this.g = x; this.h = x + 1; this.i = x + 2; } sum() { return this.g + this.h + this.i; } })(),
        (() => class { j; k; l; constructor(x: number) { this.j = x; this.k = x + 1; this.l = x + 2; } sum() { return this.j + this.k + this.l; } })(),
      ];
      console.log(classes.map((C, i) => new C(i).sum()).join());
    `,
  });
  const hashes = await Promise.all(
    Array.from({ length: 6 }, async (_, i) => {
      const outfile = join(String(dir), String(i), "out");
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      expect([await build.stderr.text(), await build.exited]).toEqual(["", 0]);
      return Bun.SHA256.hash(await Bun.file(outfile).bytes(), "hex");
    }),
  );
  expect(new Set(hashes).size).toBe(1);
  await using proc = Bun.spawn({ cmd: [join(String(dir), "0", "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect([await proc.stdout.text(), await proc.exited]).toEqual(["3,6,9,12\n", 0]);
});

test("compiles RegExps with the u and v flags", async () => {
  using dir = tempDir("compile-aot-regexps", {
    "none.ts": `console.log("none");`,
    "some.ts": `console.log([/a+b/.test("aab"), /\\p{L}+x/u.test("\\xe9x"), /^.$/u.test("\\u{1f600}"), /[\\p{L}--[a-c]]y/v.test("dy")].join());`,
  });
  async function numberOfRegExps(entry: string, expectedStdout: string) {
    const outfile = join(String(dir), entry.replace(".ts", ""));
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", entry, "--outfile", outfile],
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

test("hot run-time RegExps are compiled", async () => {
  using dir = tempDir("compile-aot-regexp-at-run-time", {
    "entry.ts": `
      const build = (word: string) => new RegExp(["(\\\\w+)@", "(\\\\w+)\\\\.", word].join(""));
      const words = process.env.WORDS!.split(",");
      const usedOnce = build(words[0]!), usedOften = build(words[1]!), usedOnLongText = build(words[2]!);
      let found = usedOnce.exec("to foo@bar.cold")!.slice(1).join();
      for (let i = 0; i < 1000; i++) found = usedOften.exec("to foo@bar.hot")!.slice(1).join() + i;
      console.log(found, usedOnLongText.exec(Buffer.alloc(20000, "x ").toString() + "foo@bar.long")!.slice(1).join());
      console.log(new Function("a", "return a + 1")(1));
    `,
  });
  const outfile = join(String(dir), "entry");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", outfile],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual(["", 0]);
  await using run = Bun.spawn({
    cmd: [outfile],
    env: { ...bunEnv, BUN_JSC_dumpCompiledRegExpPatterns: "1", WORDS: "c[o]ld,h[o]t,l[o]ng" },
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

test("crash reports symbolicate compiled frames", async () => {
  using dir = tempDir("compile-aot-crash", {
    "entry.ts": `
      const { crash_handler } = require("bun:internal-for-testing") as { crash_handler: { segfault(): void } };
      function crash(really: boolean) {
        if (really) crash_handler.segfault();
      }
      crash(process.argv.length > 0);
    `,
  });
  const outfile = join(String(dir), "entry");
  const map = join(String(dir), "map");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", outfile],
    env: { ...bunEnv, BUN_JSC_aotMapFilePath: map },
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

test("--cpu-prof attributes native time to the calling function", async () => {
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
      const chosen = [busy, Math.max][process.argv.length > 99 ? 1 : 0]!;
      console.log(chosen(6000, 1) + chosen(6000, 2) !== 0);
    `,
  });
  const outfile = join(String(dir), "entry");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", outfile],
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

test("image size limit is a build error", async () => {
  using dir = tempDir("compile-aot-too-large", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
    env: { ...bunEnv, BUN_JSC_numberOfAOTStubCopiesForTesting: "60" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: --aot: the program has too much machine code");
  expect(stderr).not.toContain("AOT: ");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test.each(["index", "frame", "callSites", "slots"])("a function record over its limit (%s) is a build error", async limit => {
  using dir = tempDir("compile-aot-record-limit", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
    env: { ...bunEnv, BUN_JSC_aotImageLimitToExceedForTesting: limit },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: --aot: the program is too large");
  expect(stderr).not.toContain("AOT: ");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("code that cannot be compiled is a build error at its file, line and column", async () => {
  using dir = tempDir("compile-aot-declined", {
    "entry.ts": `console.log(1);

function countDown(n: number): number { return n ? countDown(n - 1) + 1 : 0; }
console.log(countDown(3));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
    env: { ...bunEnv, BUN_JSC_aotImageLimitToExceedForTesting: "functionFrameSize" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const why = "cannot be compiled ahead of time: it holds so many values at once";
  expect(stderr).toMatch(new RegExp("error: --aot: `countDown` " + why + "[^\\n]*\\n\\s+at [^\\n]*entry\\.ts:3:1\\b"));
  expect(stderr).toMatch(new RegExp("error: --aot: the top-level code " + why + "[^\\n]*\\n\\s+at [^\\n]*entry\\.ts:1:1\\b"));
  expect(stderr).not.toContain("AOT: ");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("an entry function that is not compiled is a build error", async () => {
  using dir = tempDir("compile-aot-declined-entry", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
    env: { ...bunEnv, BUN_JSC_aotImageLimitToExceedForTesting: "frameSize" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: --aot: internal error: the entry function of a module was not compiled: it holds so many values at once");
  expect(stderr).not.toMatch(/^\s+at .*:0$/m);
  expect(stderr).not.toContain("AOT: ");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("--aot with --bytecode-depth is an error", async () => {
  using dir = tempDir("compile-aot-depth", {
    "entry.ts": `function a() { return function b() { return function c() { return 1; }; }; } console.log(a()()());`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "--bytecode-depth=1", "entry.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("error: --aot does not support --bytecode-depth\n");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("--aot requires --compile", async () => {
  using dir = tempDir("compile-aot-requires-compile", { "entry.ts": `console.log(1);` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--aot", "entry.ts", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("--aot requires --compile");
  expect(exitCode).not.toBe(0);
});

describe("--aot across threads", () => {
  async function run(files: Record<string, string>, entryPoints: string[], env: Record<string, string> = {}) {
    using dir = tempDir("compile-aot-threads", files);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "--splitting", ...entryPoints, "--outfile", "out"],
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
            declare var self: Worker;
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
            } else self.onmessage = event => spin(event.data);
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

describe("--aot at run time", () => {
  async function run(source: string, env: Record<string, string> = {}) {
    using dir = tempDir("compile-aot-run-time", { "entry.ts": source });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
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

  test("implicit constructors need no bytecode", async () => {
    const { stdout, stderr, exitCode } = await run(
      /* ts */ `
        class ImplicitBase { kind() { return "base"; } }
        class ImplicitDerived extends ImplicitBase { kind() { return "derived of " + super.kind(); } }
        class ImplicitTwice extends ImplicitDerived {}
        class WithFields { a = 1; #b = 2; sum() { return this.a + this.#b; } }
        class DerivedWithFields extends WithFields { c = 3; total() { return this.sum() + this.c; } }
        class Takes { constructor(public x: number, public y = 5) {} }
        class Forwards extends Takes {}
        class ImplicitError extends Error {}
        class ImplicitArray extends Array<number> {}
        class ImplicitMap extends Map<string, number> {}
        const made = (() => class extends Takes {})();
        const out: unknown[] = [];
        for (let i = 0; i < 3; i++) {
          out.length = 0;
          out.push(new ImplicitBase().kind(), new ImplicitDerived().kind(), new ImplicitTwice().kind());
          out.push(new WithFields().sum(), new DerivedWithFields().total());
          out.push(new Forwards(1).x, new Forwards(1).y, new Forwards(1, 2).y, new made(7).x);
          const error = new ImplicitError("message");
          out.push(error.message, error instanceof ImplicitError, error instanceof Error, error.name);
          out.push(new ImplicitArray(3).length, ImplicitArray.of(1, 2).length, new ImplicitMap([["k", 1]]).get("k"));
          out.push(ImplicitBase.name, ImplicitDerived.length, made.name);
          out.push(Reflect.construct(ImplicitDerived, [], ImplicitTwice) instanceof ImplicitTwice);
          for (const C of [ImplicitBase, ImplicitDerived, Forwards]) {
            try {
              (C as unknown as () => void)();
              out.push("called");
            } catch (e) {
              out.push((e as Error).constructor.name);
            }
          }
        }
        console.log(out.join());
      `,
      { BUN_JSC_dumpGeneratedBytecodes: "1" },
    );
    expect(stdout.split("\n").filter(line => !line.includes("#") && line.includes(","))).toEqual([
      "base,derived of base,derived of base,3,6,1,5,2,7,message,true,true,Error,3,2,1,ImplicitBase,0,,true,TypeError,TypeError,TypeError",
    ]);
    expect((stdout + stderr).match(/^\S*(Implicit|WithFields|Forwards)\S*#\w+:\[/gm)).toBeNull();
    expect(exitCode).toBe(0);
  });

  test.each([
    ["equal literals share a string", (i: number) => "a literal that is repeated", 100],
    ["different literals do not", (i: number) => "a literal that is not repeated " + i, 3000],
  ] as const)("%s", async (_, literal, atLeast) => {
    const rows = Array.from({ length: 3000 }, (_, i) => `  { kind: ${JSON.stringify(literal(i))}, list: [${JSON.stringify(literal(i))}, "x${i % 7}y"] },`);
    const { stdout, stderr, exitCode } = await run(`
      import { heapStats } from "bun:jsc";
      const rows = [
      ${rows.join("\n")}
      ];
      Bun.gc(true);
      const strings = heapStats().objectTypeCounts.string;
      console.log(JSON.stringify([rows.length, rows[0].kind, rows[2999].kind, rows[2999].list.join(), new Set(rows.map(row => row.kind)).size]));
      console.log(strings);
    `);
    const [first, second] = stdout.trim().split("\n");
    expect([JSON.parse(first), stderr, exitCode]).toEqual([
      [3000, literal(0), literal(2999), literal(2999) + ",x3y", atLeast === 100 ? 1 : 3000],
      "",
      0,
    ]);
    if (atLeast === 100) expect(Number(second)).toBeLessThan(3000);
    else expect(Number(second)).toBeGreaterThanOrEqual(3000);
  });
});

test("--aot with --bytecode-order is an error", async () => {
  using dir = tempDir("compile-aot-order", { "entry.ts": `console.log(1);`, "app.order": "" });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "--bytecode-order=app.order", "entry.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "error: --aot does not support --bytecode-order\n", exitCode: 1 });
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});
