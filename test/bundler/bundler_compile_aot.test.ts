import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDirWithBunTypes as tempDir } from "harness";
import { devNull } from "os";
import { join } from "path";
import { run as runCommand } from "../aot/harness/run";
import { BundlerTestInput, itBundled as itBundledBase } from "./expectBundled";

const usesImage = (stdout: string) =>
  ({
    env: { BUN_AOT_VERBOSE: "1" },
    validate({ stdout: actual, stderr }) {
      expect(actual).toBe(stdout);
      expect(stderr).toContain("[aot] image: ");
      expect(stderr).toContain("[aot] module: ");
    },
  }) satisfies BundlerTestInput["run"];

// A build whose program reads or writes properties of its own objects ends with the share of them that is one load.
const withoutTypedSummary = (stderr: string) =>
  stderr.replace(/^(?:[\d.]+% of property accesses are one load: .*|Untyped code works, but runs slower\. .*)\n/gm, "");

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
      run: { ...usesImage("10 6 1,2,3\n"), env: { BUN_AOT_VERBOSE: "1", BUN_JSC_aotCountsPath: devNull } },
    });

    itBundled("NextTickRunsInOrder", {
      files: {
        "/entry.ts": /* js */ `
          const order: string[] = [];
          process.nextTick((a: string, b: string) => order.push(a + b), "first", "!");
          process.nextTick(() => order.push("second"));
          await new Promise<void>(done => process.nextTick(() => process.nextTick(done)));
          const error = await new Promise<Error>(done => process.nextTick(() => done(new Error("here"))));
          console.log(order.join(" "));
          console.error(error);
        `,
      },
      run: {
        env: { BUN_AOT_VERBOSE: "1" },
        validate({ stdout, stderr }) {
          expect(stdout).toBe("first! second\n");
          expect(stderr).toContain("[aot] image: ");
          expect(stderr).toContain("[aot] module: ");
          expect(stderr).toContain("error: here");
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
        "sloppy capture:undefined:false:undefined:true:true hidden:undefined:false:undefined:true:true run:undefined:false:undefined:true:true\nundefined undefined\n",
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
        // The names are computed: a written one is warned of at the build.
        "/entry.ts": /* js */ `
          import vm from "node:vm";
          const attempt = (f: () => unknown) => { try { f(); return "ok"; } catch (e) { return (e as Error).name; } };
          const push = Array.prototype.push, max = Math.max;
          const name = (...parts: string[]) => parts.join("");
          console.log(
            attempt(() => { (Array.prototype as any)[name("pu", "sh")] = function () { return 0; }; }),
            attempt(() => { (Math as any)[name("m", "ax")] = () => 0.5; }),
            attempt(() => { (Reflect as any)[name("g", "et")] = () => 1; }),
            attempt(() => Object.defineProperty(Object.prototype, name("ad", "ded"), { value: 1 })),
            attempt(() => { delete (Array.prototype as any)[name("m", "ap")]; }),
            Array.prototype.push === push, Math.max === max, "added" in {}, typeof [].map,
          );
          console.log(new Function("'use strict'; try { Math[['m', 'ax'].join('')] = 1; return 'ok'; } catch (e) { return e.name; }")());
          console.log(vm.runInNewContext("Object.isFrozen(Object.prototype)"));
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

    itBundled("WorkerTerminatedInALoop", {
      files: {
        "/entry.ts": /* js */ `
          import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
          class Rec { constructor(public n: number) {} }
          function framed(seed: number, list: Rec[]): number { let t = seed; while (true) { t = (t * 31 + list.length) | 0; if (t === 123456789) list.push(new Rec(t)); } }
          function frameless(a: number, b: number): number { let t = a; while (t !== 0.5) { t = (t * 31 + b) | 0; } return t; }
          function inTry(seed: number): number { let t = seed; try { do { t = (t * 31 + 7) | 0; } while (t !== 0.5); } catch { console.log("caught"); } return t; }
          function overArray(list: Rec[]): number { let t = 0; for (;;) { for (const r of list) t = (t + r.n) | 0; } }
          function nested(n: number): number { let t = 0; for (;;) { for (let i = 0; i < n; i++) { let j = i; while (j > 0) { t = (t + j) | 0; j >>= 1; } } } }
          if (isMainThread) {
            for (const shape of ["framed", "frameless", "inTry", "overArray", "nested"]) {
              const worker = new Worker(new URL(import.meta.url), { workerData: shape });
              await new Promise<void>(resolve => worker.on("message", () => resolve()));
              await new Promise<void>(resolve => setTimeout(resolve, 50));
              console.log(shape, await worker.terminate());
            }
          } else {
            parentPort!.postMessage("spinning");
            const list = [new Rec(1), new Rec(2), new Rec(3)];
            switch (workerData as string) {
              case "framed": framed(1, list); break;
              case "frameless": frameless(1, 7); break;
              case "inTry": inTry(1); break;
              case "overArray": overArray(list); break;
              case "nested": nested(1000); break;
            }
          }
        `,
      },
      run: usesImage("framed 1\nframeless 1\ninTry 1\noverArray 1\nnested 1\n"),
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
          const root = Bun.main.slice(0, Math.max(Bun.main.lastIndexOf("/"), Bun.main.lastIndexOf("\\\\")) + 1);
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
          ...["internal", "target", "main"].flatMap(label =>
            ["mock.module", "jest.mock"].map(name => label + " " + name + " TypeError 3:1:ready 3:2"),
          ),
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
      run: usesImage(
        ["helper", "table", "box"].map(name => name + " TypeError 1:2:3.5:4 | 1:3.5:6\n").join("") + "2\n",
      ),
    });

    itBundled("CompiledModulesCannotBeEvicted", {
      splitting: true,
      files: {
        "/entry.ts": /* js */ `
          const load = () => import("./lazy");
          const first = await load();
          console.log(first.bump(), first.bump());
          const root = Bun.main.slice(0, Math.max(Bun.main.lastIndexOf("/"), Bun.main.lastIndexOf("\\\\")) + 1);
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
    const { stdout, exitCode } = await runCommand([bunExe(), "build.ts"], String(dir));
    expect(stdout).toBe("true true true true true true true\n");
    expect(exitCode).toBe(0);

    const {
      stdout: appStdout,
      stderr: appStderr,
      exitCode: appExitCode,
    } = await runCommand([join(String(dir), "app")], undefined, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
    expect(appStdout).toBe("from the executable\n");
    expect(appStderr).toContain("[aot] image: ");
    expect(appExitCode).toBe(0);
  });
});

test("compile.aot: compiles the contents a plugin returns instead of the file on disk", async () => {
  using dir = tempDir("compile-aot-plugin-text", {
    "app.ts": `
      import { answer, type Shape } from "./other";
      const shape: Shape = { kind: "plugin", size: 2 };
      console.log(answer(), shape.kind, shape.size);
    `,
    "other.ts": `
      export type Shape = { kind: string };
      export function answer() { return "from the disk"; }
    `,
    "build.ts": `
      const result = await Bun.build({
        entrypoints: ["./app.ts"],
        compile: { aot: true, outfile: "./app" },
        plugins: [
          {
            name: "rewrites other.ts",
            setup(build) {
              build.onLoad({ filter: /other\\.ts$/ }, async () => {
                await Bun.sleep(300);
                return {
                  loader: "ts",
                  contents: 'export type Shape = { kind: string; size: number }; export function answer() { return "from the plugin"; }',
                };
              });
            },
          },
        ],
      });
      console.log(result.success);
    `,
  });
  const { stdout, exitCode } = await runCommand([bunExe(), "build.ts"], String(dir));
  expect(stdout).toBe("true\n");
  expect(exitCode).toBe(0);

  const {
    stdout: appStdout,
    stderr: appStderr,
    exitCode: appExitCode,
  } = await runCommand([join(String(dir), "app")], undefined, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
  expect(appStdout).toBe("from the plugin plugin 2\n");
  expect(appStderr).toContain("[aot] image: ");
  expect(appExitCode).toBe(0);
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
  const { stdout, exitCode } = await runCommand([bunExe(), "build.ts"], String(dir));
  expect(stdout).toBe(JSON.stringify(Array(8).fill(true)) + "\n");
  expect(exitCode).toBe(0);

  const outputs = await Promise.all(
    ["main", "worker"].flatMap(kind =>
      apps.map(async n => {
        const { stdout, stderr } = await runCommand([join(String(dir), kind + n)], undefined, {
          ...bunEnv,
          BUN_AOT_VERBOSE: "1",
        });
        return { stdout: stdout.trim(), usesImage: stderr.includes("[aot] image: ") };
      }),
    ),
  );
  expect(outputs).toEqual(
    ["1 89", "2 144", "3 233", "4 377", "1 89", "2 144", "3 233", "4 377"].map(stdout => ({ stdout, usesImage: true })),
  );
});

const otherTarget = process.platform === "linux" ? "bun-darwin-x64" : "bun-linux-x64";
const whyNot = "can't cross-compile. It only builds for the platform it runs on";

test("--aot rejects cross-compilation and unsupported targets", async () => {
  using dir = tempDir("compile-aot-cross", { "entry.ts": `console.log(1);` });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", `--target=${otherTarget}`, "entry.ts", "--outfile", "out"],
    String(dir),
  );
  expect(stderr).toContain(`--aot ${whyNot}`);
  expect(exitCode).not.toBe(0);
});

test("compile.aot rejects cross-compilation and unsupported targets", async () => {
  using dir = tempDir("compile-aot-cross-api", { "entry.ts": `console.log(1);` });
  expect(() =>
    Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      compile: { target: otherTarget, aot: true, outfile: join(String(dir), "out") },
    }),
  ).toThrow(`compile.aot ${whyNot}`);
});

test("--format has no effect with --aot", async () => {
  using dir = tempDir("compile-aot-format", { "entry.cjs": `console.log(1);` });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "--format=cjs", "entry.cjs", "--outfile", "out"],
    String(dir),
  );
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await runCommand([join(String(dir), "out")], String(dir))).toMatchObject({ stdout: "1\n", exitCode: 0 });
  const built = await Bun.build({
    entrypoints: [join(String(dir), "entry.cjs")],
    format: "cjs",
    compile: { aot: true, outfile: join(String(dir), "out-of-build") },
  });
  expect(built.success).toBe(true);
  expect(await runCommand([join(String(dir), "out-of-build")], String(dir))).toMatchObject({
    stdout: "1\n",
    exitCode: 0,
  });
});

test("Bun.ModuleGraph refuses a module that is compiled into the executable", async () => {
  using dir = tempDir("compile-aot-module-graph-refused", {
    "entry.ts": `
      const url = new URL("./app.js", import.meta.url).href;
      console.log((await import(url)).name);
      const error = await new Bun.ModuleGraph().import(url).then(() => undefined, (error: any) => error);
      console.log(error?.code, String(error?.message).split(" (bun compile")[0]);
    `,
    "app.ts": `export const name: string = "app";`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "app.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
  const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")]);
  expect({ stdout: stdout.split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      "app",
      expect.stringMatching(
        /^ERR_MODULE_NOT_FOUND Cannot load '.*app\.ts': it's compiled into this executable, and a compiled module can't be loaded a second time \(for example into a Bun\.ModuleGraph\)\.$/,
      ),
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});

// TODO: compile modules so that each graph gets its own instance. Until then graph.import() of a compiled module rejects.
describe.todo("Bun.ModuleGraph with --aot", () => {
  async function run(entry: string, more = "") {
    using dir = tempDir("compile-aot-module-graph", {
      "entry.ts": `
        declare const tag: string | undefined;
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
        declare const tag: string;
        let n = 0;
        export function count() { return ++n; }
        export const viaClosure = () => () => count();
        export function call(f: () => number) { return f() * 100 + count(); }
        export function* each() { while (true) yield count(); }
        export async function later() { await 1; return count(); }
        export function* take(limit: number) { try { for (let i = 0; i < limit; i++) yield count(); return "end"; } finally { count(); } }
        export function* through(inner: Iterable<number>) { yield count(); yield* inner; yield count(); }
        export async function* eachLater() { while (true) yield count(); }
        export function sumOf(values: Iterable<number>) { let sum = 0; for (const value of values) sum += value; return sum * 1000 + count(); }
        export const current = () => n;
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
        export class Box {
          method() { return n; }
          get accessor() { return n; }
          set accessor(value: number) { n = value; }
        }
        export function makeBox(): Box { return new Box(); }
        export function callMethod(box: Box) { return box.method(); }
        export function readAccessor(box: Box) { return box.accessor; }
        export function writeAccessor(box: Box, value: number) { box.accessor = value; }
        export interface Point { x: number; y: number }
        export function makePoint(x: number, y: number): Point { return { x, y }; }
        export function movePoint(point: Point) { point.x += n; return point.x * 10 + point.y; }
        ${more}
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
      const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out"), where]);
      results.push({ where, stdout: stdout.trim(), stderr, exitCode });
    }
    return results;
  }
  const everywhere = (value: unknown) =>
    ["main", "worker"].map(where => ({ where, stdout: JSON.stringify(value), stderr: "", exitCode: 0 }));
  const membersOfOneGraph = `
        export class Crate { value = 1; method() { return n; } }
        export class SmallCrate extends Crate { small = 2; }
        export function makeCrate(): Crate { return new Crate(); }
        export function makeSmallCrate(): Crate { return new SmallCrate(); }
        export function isCrate(value: unknown) { return value instanceof Crate; }
        export function isSmallCrate(value: Crate | SmallCrate | null) { return value instanceof SmallCrate; }
        export function countCrates(values: unknown[]) { let found = 0; for (let i = 0; i < values.length; i++) if (values[i] instanceof Crate) found++; return found; }
        export function kindOf(value: Crate | Point | string) { return typeof value === "string" ? "string" : value instanceof Crate ? "crate" : "point"; }
        export class Tally { static total = 0; static add() { return ++Tally.total; } }
        export const table = { one: 1 };
        const strings = (parts: TemplateStringsArray) => parts;
        export function template() { return strings\`x\`; }
        export class Failure extends Error { code = 5; }
        export function fail(): never { count(); throw new Failure("failed"); }
        export function isFailure(value: unknown) { return value instanceof Failure; }
        export function catchAndCount(f: () => void) { try { f(); } catch { return count(); } return -1; }
        export function finallyCount(f: () => void) { try { try { f(); } finally { count(); } } catch { count(); } return n; }
        export class Even { static [Symbol.hasInstance](value: number) { return (value + count()) % 2 === 0; } }
        export class Steps { left = 2; [Symbol.iterator]() { return this; } next() { return this.left-- > 0 ? { value: count(), done: false } : { value: undefined, done: true }; } }
        export function replacer() { return String(count()); }
        export function getTrap() { return count(); }
        export function thenable(resolve: (value: number) => void) { resolve(count()); }
        export const handlers = [() => count(), function () { return count(); }];
        export function addExtra(point: any) { point.extra = n; return point.extra + point.x; }
        export function copy(value: object) { return JSON.stringify({ ...value, n }); }
        export async function laterTwice(f: () => Promise<number>) { const first = await f(); return first * 100 + count(); }
        export function argumentsCount() { return arguments.length + count(); }
        export const bound = count.bind(null);
        export function callWith(f: (this: unknown) => number) { return f.call(null) * 100 + count(); }
        export function viaDefault(value = count()) { return value; }
        export const accessor = { get now() { return count(); }, set now(value: number) { n = value; } };
        export class Sealed {
          #secret = 7;
          #text = "mine";
          #method() { return 8; }
          get #accessor() { return 9; }
          set #accessor(value: number) { this.#secret = value; }
          static #shared = 10;
          static read(value: Sealed) { return value.#secret; }
          static readAny(value: any) { return value.#secret; }
          static readText(value: Sealed) { return value.#text; }
          static write(value: Sealed) { value.#secret = 1; return value.#secret; }
          static writeAny(value: any) { value.#secret = 2; return value.#secret; }
          static add(value: Sealed) { value.#secret += 1; return value.#secret; }
          static has(value: Sealed) { return #secret in value; }
          static hasAny(value: object) { return #secret in value; }
          static hasMethod(value: Sealed) { return #method in value; }
          static call(value: Sealed) { return value.#method(); }
          static callAny(value: any) { return value.#method(); }
          static method(value: Sealed) { return typeof value.#method; }
          static get(value: Sealed) { return value.#accessor; }
          static set(value: Sealed) { value.#accessor = 3; return value.#secret; }
          static shared(value: typeof Sealed) { return value.#shared; }
          static sum(values: Sealed[]) { let sum = 0; for (let i = 0; i < values.length; i++) { try { sum += values[i]!.#secret; } catch { sum -= 1; } } return sum; }
          static sumAny(values: any[]) { let sum = 0; for (let i = 0; i < values.length; i++) { try { sum += values[i].#secret; } catch { sum -= 1; } } return sum; }
          static countOwn(values: Sealed[]) { let own = 0; for (let i = 0; i < values.length; i++) if (#secret in values[i]!) own++; return own; }
          own() { return this.#secret; }
          sameAs(other: Sealed) { return this.#secret === other.#secret; }
          static brand(value: Sealed) { try { value.#secret; return true; } catch { return false; } }
          static brandByStore(value: Sealed) { try { value.#text = "mine"; return true; } catch { return false; } }
        }
        export class SealedHeir extends Sealed { #deeper = 11; static deeper(value: SealedHeir) { return value.#deeper; } }
        export function makeSealed() { return new Sealed(); }
        export function makeSealedHeir() { return new SealedHeir(); }
        const key = Symbol("key");
        const action = Symbol("action");
        const shared = Symbol.for("shared");
        export class Keyed { [key]?: number = 3; [shared] = 6; [action]() { return 4; } }
        export function makeKeyed() { return new Keyed(); }
        export function makeMarked() { return { [key]: 5, plain: 1 }; }
        export function keyOf() { return key; }
        export function readKey(value: any) { return value[key]; }
        export function readKeyed(value: Keyed) { return value[key]; }
        export function readShared(value: Keyed) { return value[shared]; }
        export function writeKey(value: any) { value[key] = 12; return Object.getOwnPropertySymbols(value).length; }
        export function hasKey(value: object) { return key in value; }
        export function hasKeyed(value: Keyed) { return key in value; }
        export function act(value: any) { return value[action]?.(); }
        export function sumKeys(values: any[]) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i][key] ?? -1; return sum; }
      `;

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

  test.concurrent(
    "generators of one graph stepped from another, and from the host, use their own variables",
    async () => {
      expect(
        await run(`
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const state = () => [a.current(), b.current(), host.current()].join("/");
        const out: unknown[] = [];
        const ofA = a.each();
        out.push(ofA.next().value, ofA.next().value, state());
        let sum = 0;
        for (const value of b.take(3)) sum += value;
        out.push(sum, state());
        out.push([...a.take(2)].join(), state());
        const [first, second] = b.take(5);
        out.push(first, second, state());
        out.push(Array.from(host.take(2)).join(), state());
        out.push([...a.through(b.take(2))].join(), state());
        out.push(a.sumOf(b.take(2)), host.sumOf(a.take(1)), state());
        const stopped = a.take(9);
        out.push(stopped.next().value, JSON.stringify(stopped.return(5)), JSON.stringify(stopped.next()), state());
        const thrown = b.take(9);
        thrown.next();
        try { thrown.throw(new Error("out")); } catch (error) { out.push((error as Error).message); }
        out.push(state());
        const later = a.eachLater();
        out.push((await later.next()).value, (await later.next()).value, state());
        let seen = 0;
        for await (const value of b.eachLater()) { seen += value; if (value > 20 || ++sum > 8) break; }
        out.push(seen, state());
        const own = host.each();
        out.push(own.next().value, ofA.next().value, own.next().value, state());
        out.push(new Map([[1, 2]]).entries().next().value!.join(), JSON.stringify(ofA.next()), Object.getPrototypeOf(ofA.next()) === Object.prototype);
        return out;
      `),
      ).toEqual(
        everywhere([
          1,
          2,
          "2/0/0",
          6,
          "2/4/0",
          "3,4",
          "5/4/0",
          5,
          6,
          "5/7/0",
          "1,2",
          "5/7/3",
          "6,8,9,7",
          "7/10/3",
          23008,
          9004,
          "10/13/4",
          11,
          '{"value":5,"done":true}',
          '{"done":true}',
          "12/13/4",
          "out",
          "12/15/4",
          13,
          14,
          "14/15/4",
          51,
          "14/18/4",
          5,
          15,
          6,
          "15/18/6",
          "1,2",
          '{"value":16,"done":false}',
          true,
        ]),
      );
    },
  );

  const stateOfOneGraph = `
        import * as fs from "node:fs";
        import { EventEmitter } from "node:events";
        export const fileSystem = fs;
        export const Emitter = EventEmitter;
        export const pattern = /a/g;
        export function advance(text: string) { pattern.test(text); return pattern.lastIndex; }
        export function freshPattern() { return /b/y; }
        export const list = [1, 2, 3];
        export const pair = [1, "one"] as const;
        export const registry = new Map<string, number>();
        export const seen = new WeakSet<object>();
        export function mark(value: object) { const had = seen.has(value); seen.add(value); return had; }
        export enum Color { Red, Green }
        export const enum Shade { Dark = 5 }
        export function shade() { return Shade.Dark; }
        export function Plain(this: any) { this.made = count(); }
        Plain.prototype.tell = function () { return n; };
        export const frozen = Object.freeze({ deep: { value: 1 } });
        export const big = 12345678901234567890n;
        export const text = "shared text";
        export const meta = import.meta;
        export class Lazy { handler = () => count(); static make() { return new Lazy(); } }
        export class WithStatics { static items: number[] = []; static #hidden = 0; static bump() { return ++WithStatics.#hidden; } static { WithStatics.items.push(count()); } }
        export const namespaceLike = { nested: { count } };
        export function* numbers() { yield 1; }
        export async function soon() { return 1; }
        export const arrow = () => n;
        export function defaults({ step = count() }: { step?: number } = {}) { return step; }
        export const date = new Date(0);
        export const buffer = new Uint8Array(2);
        export const error = new Error("made at load");
        export const promise = Promise.resolve(count());
        export let reassigned = 1;
        export function reassign() { reassigned++; return reassigned; }
        export const getters = { get self() { return getters; } };
        export class Node { next: Node | null = null; static root = new Node(); }
        export function once() { return (once as any).cache ??= { made: count() }; }
        export const tagged = ((parts: TemplateStringsArray, ...values: number[]) => parts.raw.join("|") + values.join())\`a\${1}b\`;
        export const symbolDescription = Symbol("described").description;
        export const wellKnown = Symbol.iterator;
      `;

  test.concurrent("what belongs to one graph is not another's", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const state = () => [a.current(), b.current(), host.current()].join("/");
        const out: unknown[] = [];
        const attempt = (f: () => unknown) => { try { return f(); } catch (error) { return (error as Error).constructor.name; } };
        out.push("instanceof", a.isCrate(a.makeCrate()), b.isCrate(a.makeCrate()), host.isCrate(b.makeSmallCrate()), b.isCrate(b.makeSmallCrate()), a.makeCrate() instanceof b.Crate, a.makeCrate() instanceof a.Crate);
        out.push(a.isSmallCrate(a.makeSmallCrate()), a.isSmallCrate(b.makeSmallCrate()), a.countCrates([a.makeCrate(), b.makeCrate(), host.makeCrate(), a.makeSmallCrate(), {}, 1]), a.kindOf(b.makeCrate()), a.kindOf(a.makeCrate()));
        let hot = 0;
        const mixed = [a.makeCrate(), b.makeCrate(), a.makeSmallCrate(), b.makeSmallCrate()];
        for (let i = 0; i < 2000; i++) hot += a.countCrates(mixed);
        out.push(hot);
        out.push("static", a.Tally.add(), a.Tally.add(), b.Tally.add(), host.Tally.total, a.table === b.table, a.template() === a.template());
        out.push("throw", attempt(a.fail), state(), b.catchAndCount(a.fail), state(), host.finallyCount(b.fail), state());
        try { a.fail(); } catch (error) { out.push(a.isFailure(error), b.isFailure(error), error instanceof Error); }
        out.push("classes", new a.Derived().field, (Reflect.construct(b.Derived, []) as any).field, state());
        class Mine extends a.Derived { own = b.count(); }
        const mine: any = new Mine();
        out.push(mine.field, mine.own, mine instanceof a.Empty, mine instanceof b.Empty, state());
        out.push("hasInstance", (1 as any) instanceof a.Even, (1 as any) instanceof a.Even, (1 as any) instanceof b.Even, state());
        out.push("iterate", [...new a.Steps()].join(), Array.from(new b.Steps()).join(), state());
        out.push("callbacks", "xx".replace(/x/g, b.replacer), (new Proxy({}, { get: a.getTrap }) as any).anything, JSON.stringify({ toJSON: b.count }), String({ toString: a.replacer }), +{ valueOf: b.count }, Array.from({ length: 2 }, a.count).join(), state());
        out.push(a.handlers[0](), a.handlers[1](), b.bound(), a.callWith(b.count), b.argumentsCount(1, 2), a.viaDefault(), a.viaDefault(0), state());
        out.push(a.accessor.now, (b.accessor.now = 50), b.accessor.now, (Object.defineProperty({}, "x", { get: a.count }) as any).x, state());
        out.push("jobs", await { then: a.thenable }, await Promise.resolve().then(b.count), (await Promise.all([a.later(), b.later(), host.later()])).join(), await a.laterTwice(b.later), state());
        out.push(await new Promise(resolve => queueMicrotask(() => resolve(a.count()))), await new Promise(resolve => setTimeout(() => resolve(b.count()), 1)), await new Promise(resolve => setTimeout(resolve, 1)).then(a.count), state());
        out.push("objects", b.addExtra(a.makePoint(1, 2)), a.addExtra(a.makePoint(1, 2)), host.addExtra({ x: 1 }), b.copy(a.makeCrate()), a.copy(b.makePoint(3, 4)), a.copy(a.makeSmallCrate()), state());
        return out;
      `,
        membersOfOneGraph,
      ),
    ).toEqual(
      everywhere([
        "instanceof",
        true,
        false,
        false,
        true,
        false,
        true,
        true,
        false,
        2,
        "point",
        "crate",
        4000,
        "static",
        1,
        2,
        1,
        0,
        false,
        true,
        "throw",
        "Failure",
        "1/0/0",
        1,
        "2/1/0",
        2,
        "2/2/2",
        true,
        false,
        true,
        "classes",
        4,
        3,
        "4/3/2",
        5,
        4,
        true,
        false,
        "5/4/2",
        "hasInstance",
        false,
        true,
        true,
        "7/5/2",
        "iterate",
        "8,9",
        "6,7",
        "9/7/2",
        "callbacks",
        "89",
        10,
        "10",
        "11",
        11,
        "12,13",
        "13/11/2",
        14,
        15,
        12,
        1316,
        16,
        17,
        0,
        "17/14/2",
        18,
        50,
        51,
        19,
        "19/51/2",
        "jobs",
        20,
        52,
        "21,53,3",
        5422,
        "22/54/3",
        23,
        55,
        24,
        "24/55/3",
        "objects",
        56,
        25,
        4,
        '{"value":1,"n":55}',
        '{"x":3,"y":4,"n":24}',
        '{"value":1,"small":2,"n":24}',
        "24/55/3",
      ]),
    );
  });

  test.concurrent("private names and symbols of one graph are not another's", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const out: unknown[] = [];
        const attempt = (f: () => unknown) => { try { return f(); } catch (error) { return (error as Error).constructor.name; } };
        for (const [reader, maker] of [[a, a], [a, b], [b, a], [host, a], [a, host]]) {
          const S = reader.Sealed;
          const fresh = () => maker.makeSealed();
          out.push([S.read, S.readAny, S.readText, S.write, S.writeAny, S.add, S.has, S.hasAny, S.hasMethod, S.call, S.callAny, S.method, S.get, S.set].map(f => attempt(() => f(fresh()))).join());
          out.push([attempt(() => S.shared(maker.Sealed)), attempt(() => S.prototype.own.call(fresh())), attempt(() => reader.makeSealed().sameAs(fresh())), attempt(() => S.read(maker.makeSealedHeir())), attempt(() => reader.SealedHeir.deeper(maker.makeSealedHeir())), attempt(() => reader.SealedHeir.deeper(fresh()))].join());
        }
        const sealed = [a.makeSealed(), b.makeSealed(), a.makeSealedHeir(), host.makeSealed(), a.makeSealed()];
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += a.Sealed.sum(sealed) * 10000 + a.Sealed.sumAny(sealed) * 100 + a.Sealed.countOwn(sealed);
        out.push(sum, b.Sealed.sum(sealed), host.Sealed.countOwn(sealed));
        out.push("symbols", a.keyOf() === a.keyOf(), a.keyOf() === b.keyOf());
        for (const [reader, maker] of [[a, a], [a, b], [host, b]]) {
          out.push([reader.readKey(maker.makeKeyed()), reader.readKeyed(maker.makeKeyed()), reader.readShared(maker.makeKeyed()), reader.readKey(maker.makeMarked()), reader.hasKey(maker.makeKeyed()), reader.hasKeyed(maker.makeKeyed()), reader.hasKey(maker.makeMarked()), reader.act(maker.makeKeyed()), reader.writeKey(maker.makeKeyed()), reader.writeKey(maker.makeMarked()), reader.writeKey({})].map(String).join());
        }
        const written = b.makeKeyed();
        a.writeKey(written);
        out.push(a.readKey(written), b.readKey(written), written[a.keyOf()], written[b.keyOf()]);
        const keyed = [a.makeKeyed(), b.makeKeyed(), a.makeMarked(), b.makeMarked(), {}];
        let keys = 0;
        for (let i = 0; i < 1000; i++) keys += a.sumKeys(keyed);
        out.push(keys, b.sumKeys(keyed), host.sumKeys(keyed));
        out.push("brand", a.Sealed.brand(a.makeSealed()), a.Sealed.brand(b.makeSealed()), host.Sealed.brand(a.makeSealed()), a.Sealed.brandByStore(a.makeSealed()), a.Sealed.brandByStore(b.makeSealed()));
        return out;
      `,
        membersOfOneGraph,
      ),
    ).toEqual(
      everywhere([
        "7,7,mine,1,2,8,true,true,true,8,8,function,9,3",
        "10,7,true,7,11,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        191903000,
        3,
        1,
        "symbols",
        true,
        false,
        "3,3,6,5,true,true,true,4,2,1,1",
        "undefined,undefined,6,undefined,false,false,false,undefined,3,2,1",
        "undefined,undefined,6,undefined,false,false,false,undefined,3,2,1",
        12,
        3,
        12,
        3,
        5000,
        5,
        -5,
        "brand",
        true,
        false,
        false,
        true,
        false,
      ]),
    );
  });

  test.concurrent("the state of a module is its graph's own, and what graphs share", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const out: unknown[] = [];
        const same = (name: string) => [a[name] === b[name], a[name] === host[name], a[name] === a[name]].map(Number).join("");
        for (const name of ["fileSystem", "Emitter", "pattern", "list", "pair", "registry", "seen", "Color", "Plain", "frozen", "big", "text", "meta", "Lazy", "WithStatics", "namespaceLike", "numbers", "soon", "arrow", "date", "buffer", "error", "promise", "getters", "Node", "wellKnown", "tagged", "symbolDescription"]) out.push(name + " " + same(name));
        out.push("state", a.advance("aaa"), a.advance("aaa"), b.advance("aaa"), host.pattern.lastIndex, a.freshPattern() === a.freshPattern());
        a.list.push(4); a.registry.set("x", 1); a.buffer[0] = 9; a.date.setTime(5); (a.Color as any).Blue = 2; a.error.message = "changed";
        out.push(a.list.length, b.list.length, a.registry.size, b.registry.size, b.buffer[0], b.date.getTime(), "Blue" in b.Color, b.error.message, a.shade());
        const shared = {};
        out.push(a.mark(shared), a.mark(shared), b.mark(shared), host.mark(shared));
        out.push("functions", new a.Plain().made, new a.Plain().tell(), new b.Plain().tell(), new a.Plain() instanceof b.Plain, new a.Plain() instanceof a.Plain, a.Plain.prototype === b.Plain.prototype, a.numbers.prototype === b.numbers.prototype, Object.getPrototypeOf(a.numbers) === Object.getPrototypeOf(b.numbers));
        out.push(a.Lazy.make().handler(), b.Lazy.make().handler(), a.Lazy.make().handler === a.Lazy.make().handler, a.namespaceLike.nested.count(), a.defaults(), a.defaults({ step: 0 }), b.defaults());
        out.push("statics", a.WithStatics.items.join(), b.WithStatics.items.join(), a.WithStatics.bump(), a.WithStatics.bump(), b.WithStatics.bump(), a.Node.root === b.Node.root, a.Node.root instanceof a.Node, a.Node.root instanceof b.Node);
        out.push("bindings", a.reassign(), a.reassigned, b.reassigned, host.reassign(), host.reassigned, a.getters.self === a.getters, a.getters.self === b.getters);
        out.push(a.once() === a.once(), a.once() === b.once(), a.once().made, b.once().made, await a.promise, await b.promise, await host.promise);
        out.push("meta", a.meta.url === b.meta.url, a.meta.url === url, a.meta.main, b.meta.main, [a.current(), b.current(), host.current()].join("/"));
        return out;
      `,
        stateOfOneGraph,
      ),
    ).toEqual(
      everywhere([
        "fileSystem 001",
        "Emitter 111",
        "pattern 001",
        "list 001",
        "pair 001",
        "registry 001",
        "seen 001",
        "Color 001",
        "Plain 001",
        "frozen 001",
        "big 111",
        "text 111",
        "meta 001",
        "Lazy 001",
        "WithStatics 001",
        "namespaceLike 001",
        "numbers 001",
        "soon 001",
        "arrow 001",
        "date 001",
        "buffer 001",
        "error 001",
        "promise 001",
        "getters 001",
        "Node 001",
        "wellKnown 111",
        "tagged 111",
        "symbolDescription 111",
        "state",
        1,
        2,
        1,
        0,
        false,
        4,
        3,
        1,
        0,
        0,
        0,
        false,
        "made at load",
        5,
        false,
        true,
        false,
        false,
        "functions",
        3,
        4,
        3,
        false,
        true,
        false,
        false,
        true,
        7,
        4,
        false,
        8,
        9,
        0,
        5,
        "statics",
        "1",
        "1",
        1,
        2,
        1,
        false,
        true,
        false,
        "bindings",
        2,
        2,
        1,
        2,
        2,
        true,
        false,
        true,
        false,
        10,
        6,
        2,
        2,
        2,
        "meta",
        true,
        true,
        true,
        true,
        "10/6/2",
      ]),
    );
  });

  test.concurrent("import.meta of a second entry point that the host imports", async () => {
    expect(
      await run(
        `
        const host = await import(url);
        return [host.meta.url === url, host.meta.main, host.meta.file];
      `,
        stateOfOneGraph,
      ),
    ).toEqual(everywhere([true, false, "app.js"]));
  });

  test.concurrent("typed code of one graph works on another graph's objects", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const state = () => [a.current(), b.current(), host.current()].join("/");
        const out: unknown[] = [];
        for (const [user, maker] of [[a, a], [a, b], [b, a], [host, b], [a, host]]) {
          const lazy = maker.Lazy.make(), heir = maker.makeLazyHeir(), runner = maker.makeRunner();
          out.push([user.callHandler(lazy), user.callPlain(lazy), user.callBump(lazy), user.readNow(lazy), user.callBump(heir), user.callDetached(lazy), user.makeAnother(lazy)].join(), state());
          out.push([user.methodOf(lazy) === maker.Lazy.prototype.bump, user.methodOf(lazy) === user.Lazy.prototype.bump, user.handlerOf(lazy) === lazy.handler, user.classOf(lazy) === maker.Lazy, user.methodOf(heir) === maker.LazyHeir.prototype.bump].join());
          out.push([user.callRun(runner), user.callStep(runner), user.readSize(runner), user.runOf(runner) === runner.run, user.runOf(runner)()].join(), state());
          out.push([user.drain(new maker.Walk()), user.drainAny(new maker.Walk()), user.describe(lazy), user.describe(runner), user.toText(lazy), user.keysOf(lazy), user.cloneOf(lazy)].join(), state());
          const pair = new maker.Pair(maker.Lazy.make(), user.Lazy.make());
          out.push([user.bothOf(pair), user.innerOf(pair), user.describe(pair)].join(), state());
        }
        out.push(a.callAll([a.count, b.count, host.count, b.addCount.bind(null, 0)]), a.callEach([a.Lazy.make(), b.Lazy.make(), host.Lazy.make()]), a.handleEach([a.Lazy.make(), b.Lazy.make(), host.Lazy.make()]), state());
        let hot = 0;
        const mixed = [a.Lazy.make(), b.Lazy.make(), a.makeLazyHeir(), b.makeLazyHeir()];
        for (let i = 0; i < 500; i++) hot = (hot + a.callEach(mixed) + a.handleEach(mixed)) % 1000003;
        out.push(hot, state());
        out.push(await a.awaitIt(b.later()), await a.awaitCall(b.later), a.sortBy([1, 3, 2], b.descending), a.mapWith([1, 2], b.addCount), state());
        return out;
      `,
        `
        export class Lazy { handler = () => count(); plain = function () { return count(); }; bump() { return count(); } get now() { return count(); } static make() { return new Lazy(); } }
        export class LazyHeir extends Lazy { override bump() { return super.bump() * 10; } }
        export function makeLazyHeir(): Lazy { return new LazyHeir(); }
        export function callHandler(value: Lazy) { return value.handler(); }
        export function callPlain(value: Lazy) { return value.plain(); }
        export function callBump(value: Lazy) { return value.bump(); }
        export function readNow(value: Lazy) { return value.now; }
        export function methodOf(value: Lazy) { return value.bump; }
        export function handlerOf(value: Lazy) { return value.handler; }
        export function callDetached(value: Lazy) { const bump = value.bump; return bump.call(value); }
        export function classOf(value: Lazy) { return value.constructor; }
        export function makeAnother(value: Lazy) { return new (value.constructor as typeof Lazy)().bump(); }
        export interface Runner { run(): number; step: () => number; readonly size: number }
        export function makeRunner(): Runner { return { run() { return count(); }, step: () => count(), get size() { return count(); } }; }
        export function callRun(value: Runner) { return value.run(); }
        export function callStep(value: Runner) { return value.step(); }
        export function readSize(value: Runner) { return value.size; }
        export function runOf(value: Runner) { return value.run; }
        export function callAll(values: (() => number)[]) { let sum = 0; for (const f of values) sum = sum * 100 + f(); return sum; }
        export function callEach(values: Lazy[]) { let sum = 0; for (let i = 0; i < values.length; i++) sum = sum * 100 + values[i]!.bump(); return sum; }
        export function handleEach(values: Lazy[]) { let sum = 0; for (let i = 0; i < values.length; i++) sum = sum * 100 + values[i]!.handler(); return sum; }
        export class Walk { left = 2; [Symbol.iterator]() { return this; } next(): IteratorResult<number> { return this.left-- > 0 ? { value: count(), done: false } : { value: undefined, done: true }; } }
        export function drain(values: Walk) { let sum = 0; for (const value of values) sum = sum * 100 + value; return sum; }
        export function drainAny(values: Iterable<number>) { let sum = 0; for (const value of values) sum = sum * 100 + value; return sum; }
        export async function awaitIt(value: Promise<number>) { return (await value) * 100 + count(); }
        export async function awaitCall(f: () => Promise<number>) { return (await f()) * 100 + count(); }
        export function sortBy(values: number[], compare: (x: number, y: number) => number) { return values.sort(compare).join(); }
        export const descending = (x: number, y: number) => y - x + 0 * n;
        export function mapWith(values: number[], f: (x: number) => number) { return values.map(f).join(); }
        export const addCount = (x: number) => x + count();
        export class Pair { constructor(public first: Lazy, public second: Lazy) {} both() { return this.first.bump() * 100 + this.second.bump(); } }
        export function bothOf(value: Pair) { return value.both(); }
        export function innerOf(value: Pair) { return value.second.handler(); }
        export function describe(value: Lazy | Runner | Pair) { return value instanceof Lazy ? "lazy" : value instanceof Pair ? "pair" : "runner"; }
        export function toText(value: Lazy) { return String(value) + JSON.stringify(value); }
        export function keysOf(value: Lazy) { return Object.keys(value).join(); }
        export function cloneOf(value: Lazy) { return { ...value }.handler(); }
      `,
      ),
    ).toEqual(
      everywhere([
        "1,2,3,4,50,6,7",
        "7/0/0",
        "true,true,true,true,true",
        "8,9,10,true,11",
        "11/0/0",
        "1213,1415,lazy,runner,[object Object]{},handler,plain,16",
        "16/0/0",
        "1718,19,pair",
        "19/0/0",
        "1,2,3,4,50,6,7",
        "19/7/0",
        "true,false,true,true,true",
        "8,9,10,true,11",
        "19/11/0",
        "1213,1415,runner,runner,[object Object]{},handler,plain,16",
        "19/16/0",
        "1720,21,runner",
        "21/17/0",
        "22,23,24,25,260,27,28",
        "28/17/0",
        "true,false,true,true,true",
        "29,30,31,true,32",
        "32/17/0",
        "3334,3536,runner,runner,[object Object]{},handler,plain,37",
        "37/17/0",
        "3818,19,runner",
        "38/19/0",
        "20,21,22,23,240,25,26",
        "38/26/0",
        "true,false,true,true,true",
        "27,28,29,true,30",
        "38/30/0",
        "3132,3334,runner,runner,[object Object]{},handler,plain,35",
        "38/35/0",
        "3601,2,runner",
        "38/36/2",
        "3,4,5,6,70,8,9",
        "38/36/9",
        "true,false,true,true,true",
        "10,11,12,true,13",
        "38/36/13",
        "1415,1617,runner,runner,[object Object]{},handler,plain,18",
        "38/36/18",
        "1939,40,runner",
        "40/36/19",
        41372038,
        423921,
        434022,
        "43/40/22",
        309072,
        "2043/2040/22",
        206144,
        206245,
        "3,2,1",
        "2044,2046",
        "2045/2044/22",
      ]),
    );
  });

  test.concurrent("closure outlives its graph", async () => {
    expect(
      await run(`
        let graph: Bun.ModuleGraph | null = new Bun.ModuleGraph();
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

  const readersOfGlobals = `
        import * as bunNamespace from "bun";
        import bunDefault, { version as bunVersion } from "bun";
        import realProcess from "node:process";
        import { setTimeout as realSetTimeout } from "node:timers";
        import { setTimeout as sleep } from "node:timers/promises";
        declare const self: typeof globalThis;
        const whenLoaded = process.env.TENANT;
        export const ownNames = () => [process.env.TENANT, whenLoaded, process.title === realProcess.title, setTimeout(() => {}, 0), clearImmediate(undefined), AbortSignal.abort(), fetch("http://localhost/"), Bun.version, console.log("not printed"), typeof postMessage, typeof Bun.file].join();
        export function ownNamesInLoop() { let all = ""; for (let i = 0; i < 3; i++) all += process.env.TENANT + String(setTimeout(() => {}, 0)); return all; }
        export class Reader { read() { return process.env.TENANT; } static async later() { await 1; return Bun.version; } }
        export function* eachOwn() { yield process.env.TENANT; yield typeof postMessage; }
        export const realOnes = () => [globalThis.setTimeout === setTimeout, globalThis.setTimeout === realSetTimeout, globalThis.process === process, globalThis.process === realProcess, "postMessage" in globalThis, typeof globalThis.postMessage, globalThis.Bun === Bun].join();
        export const importedFromBun = () => [bunNamespace === globalThis.Bun, bunDefault === globalThis.Bun, bunVersion === globalThis.Bun.version, bunNamespace === Bun].join();
        export const builtinModulesKeepTheirs = async () => [await sleep(1, "slept"), typeof realProcess.hrtime, realSetTimeout === setTimeout].join();
        export const callHere = (f: () => unknown) => f();
        export const throughTheObject = () => [(globalThis as any).own, (global as any).own, (self as any).own, "own" in globalThis, globalThis.Math.floor(1.5), new globalThis.Map().size, globalThis.parseInt("7"), globalThis === global, typeof globalThis, ((globalThis as any).stored = 1), "stored" in globalThis].join();
        export function throughTheObjectInLoop() { let sum = 0; for (let i = 0; i < 3; i++) sum += globalThis.Math.floor(1.5); return sum; }
        export const evaluated = () => [eval("tag"), eval("typeof postMessage"), eval("process.env.TENANT"), eval("spare = spare + 1"), eval("spare"), (0, eval)("typeof tag"), new Function("return typeof tag")()].join();
      `;

  test.concurrent("a host gives each graph its own process, timers, fetch, Bun and console", async () => {
    expect(
      await run(
        `
        const make = (tag: string) => ({
          tag,
          spare: tag.length,
          process: Object.create(process, { env: { value: { TENANT: tag }, enumerable: true } }),
          setTimeout: () => "timer of " + tag,
          clearImmediate: () => "cleared by " + tag,
          AbortSignal: class { static abort() { return "aborted by " + tag; } },
          fetch: () => "fetched by " + tag,
          Bun: Object.create(Bun, { version: { value: "version of " + tag } }),
          console: Object.create(console, { log: { value: () => "logged by " + tag } }),
          postMessage: undefined,
        });
        const [x, y] = await Promise.all(["x", "y"].map(tag => new Bun.ModuleGraph({ globals: make(tag) }).import(url)));
        const host = await import(url);
        return [
          x.ownNames(), y.ownNames(), x.ownNamesInLoop(), new y.Reader().read(), await x.Reader.later(), [...y.eachOwn()].join(),
          x.realOnes(), host.realOnes(), x.importedFromBun(), host.importedFromBun(), await x.builtinModulesKeepTheirs(), await host.builtinModulesKeepTheirs(),
          y.callHere(x.ownNames) === x.ownNames(), host.callHere(y.ownNames) === y.ownNames(), x.callHere(host.realOnes) === host.realOnes(), [0].map(x.ownNames)[0] === x.ownNames(),
          x.evaluated(), y.evaluated(), x.ownNames() === y.ownNames(),
        ];
      `,
        readersOfGlobals,
      ),
    ).toEqual(
      everywhere([
        "x,x,true,timer of x,cleared by x,aborted by x,fetched by x,version of x,logged by x,undefined,function",
        "y,y,true,timer of y,cleared by y,aborted by y,fetched by y,version of y,logged by y,undefined,function",
        "xtimer of xxtimer of xxtimer of x",
        "y",
        "version of x",
        "y,undefined",
        "false,true,false,true,true,function,false",
        "true,true,true,true,true,function,true",
        "true,true,true,false",
        "true,true,true,true",
        "slept,function,false",
        "slept,function,true",
        true,
        true,
        true,
        true,
        "x,undefined,x,2,2,undefined,undefined",
        "y,undefined,y,2,2,undefined,undefined",
        false,
      ]),
    );
  });

  test.concurrent("a host gives a graph its own globalThis, global and self", async () => {
    expect(
      await run(
        `
        const asked: string[] = [];
        const view = new Proxy(globalThis, {
          get: (target, key) => (asked.push(String(key)), key === "own" ? "the view's" : Reflect.get(target, key)),
          has: (target, key) => key === "own" || Reflect.has(target, key),
          set: (target, key) => (asked.push("set " + String(key)), true),
        });
        const a = await new Bun.ModuleGraph({ globals: { globalThis: view, global: view, self: view } }).import(url);
        const plain = await new Bun.ModuleGraph({ globals: { globalThis: { own: "the object's", Math: { floor: () => 41 }, Map: class extends Map { override get size() { return 41; } }, parseInt: () => 41, Bun: { version: "the object's" } } } }).import(url);
        const host = await import(url);
        return [a.throughTheObject(), a.throughTheObjectInLoop(), asked.filter(key => key !== "Bun").join(), plain.throughTheObject(), plain.throughTheObjectInLoop(), plain.importedFromBun(), host.throughTheObject(), host.throughTheObjectInLoop()];
      `,
        readersOfGlobals,
      ),
    ).toEqual(
      everywhere([
        "the view's,the view's,the view's,true,1,0,7,true,object,1,false",
        3,
        "own,own,own,Math,Map,parseInt,set stored,Math,Math,Math",
        "the object's,,,true,41,41,41,false,object,1,true",
        123,
        "true,true,true,false",
        ",,,false,1,0,7,true,object,1,true",
        3,
      ]),
    );
  });

  test.concurrent("globals cannot replace a built-in of the language", async () => {
    expect(
      await run(`
        const language = new Set("Infinity NaN undefined AggregateError Array ArrayBuffer AsyncDisposableStack Atomics BigInt BigInt64Array BigUint64Array Boolean DataView Date DisposableStack Error EvalError FinalizationRegistry Float16Array Float32Array Float64Array Function Int16Array Int32Array Int8Array Intl Iterator JSON Map Math Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set ShadowRealm SharedArrayBuffer String SuppressedError Symbol SyntaxError Temporal TypeError URIError Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakRef WeakSet WebAssembly decodeURI decodeURIComponent encodeURI encodeURIComponent escape eval isFinite isNaN parseFloat parseInt unescape".split(" "));
        const wrong: string[] = [];
        let said = "";
        for (const name of [...Object.getOwnPropertyNames(globalThis), "fresh", "toString"]) {
          try {
            await new Bun.ModuleGraph({ globals: { [name]: 1 } }).import(url);
            if (language.has(name)) wrong.push(name + " is accepted");
          } catch (error) {
            if (!language.has(name)) wrong.push(name + " is refused");
            if (name === "Math") said = (error as Error).name + ": " + (error as Error).message.split(" (bun compile")[0];
          }
        }
        return [wrong, said];
      `),
    ).toEqual(
      everywhere([
        [],
        'TypeError: The `globals` of a Bun.ModuleGraph cannot replace the global "Math" for a module that was compiled ahead of time',
      ]),
    );
  });

  test.concurrent("globals replace a built-in of the language whose name is written there", async () => {
    expect(
      await run(
        `
        const seeded = Object.create(Math, { random: { value: () => 0.5 }, floor: { value: () => 41 } });
        class Clock extends Date { override getTime() { return 41; } static override now() { return 42; } }
        const a = await new Bun.ModuleGraph({ globals: { Math: seeded, Date: Clock, parseInt: () => 43 } }).import(url);
        const b = await new Bun.ModuleGraph({ globals: { Math: undefined } }).import(url);
        const globals = { isNaN: () => "own isNaN" };
        const c = await new Bun.ModuleGraph({ globals }).import(url);
        const none = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const tried = (f: () => unknown) => { try { return f(); } catch (error) { return (error as Error).name; } };
        const notSeen = await new Bun.ModuleGraph({ globals: { ["JS" + "ON"]: {} } }).import(url).then(() => "accepted", error => error.name);
        return [
          a.builtins(), tried(b.builtins), none.builtins(), host.builtins(), a.builtinsInLoop(), host.builtinsInLoop(),
          [new a.Stamp().at, a.Stamp.floor(1.5), new host.Stamp().at, host.Stamp.floor(1.5), a.held(), host.held()].join(),
          host.call(() => a.Stamp.floor(1.5)), [1.5].map(a.Stamp.floor)[0], await a.notByName(), await host.notByName(), c.viaVariable(), host.viaVariable(), notSeen,
        ];
      `,
        `
        export const builtins = () => [Math.random() === 0.5, Math.floor(1.5), Math.ceil(1.5), Math.PI > 3, Date.now() === 42, new Date(5).getTime(), new Date(5) instanceof Date, parseInt("7"), typeof Math, typeof JSON, globalThis.Math.floor(1.5), [1.5].map(Math.floor)[0]].join();
        export function builtinsInLoop() { let sum = 0; for (let i = 0; i < 4; i++) sum += Math.floor(i / 2) + parseInt("1"); return sum; }
        export class Stamp { at = Date.now() === 42; static floor(value: number) { return Math.floor(value); } }
        export const held = () => { const { floor } = Math; return floor(1.5); };
        export const notByName = async () => [[3, 1, 2].sort().join(""), JSON.stringify({ a: [1] }), (await Promise.resolve(5)) + 1, "" + 1.5, new Date(5).getTime() === new (Object.getPrototypeOf(Date.prototype).constructor === Object ? Date : Object.getPrototypeOf(Date))(5).getTime()].join();
        export const viaVariable = () => [isNaN(1), Boolean(0)].join();
      `,
      ),
    ).toEqual(
      everywhere([
        "true,41,2,true,true,41,true,43,object,object,1,41",
        "TypeError",
        "false,1,2,true,false,5,true,7,object,object,1,1",
        "false,1,2,true,false,5,true,7,object,object,1,1",
        336,
        6,
        "true,41,false,1,41,1",
        4101,
        41,
        '123,{"a":[1]},6,1.5,false',
        '123,{"a":[1]},6,1.5,true',
        "own isNaN,false",
        "false,false",
        "TypeError",
      ]),
    );
  });

  test.concurrent("methods and accessors of another graph's object use that graph's variables", async () => {
    expect(
      await run(`
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        const host = await import(url);
        a.count(); b.count(); b.count(); host.count(); host.count(); host.count();
        const box = a.makeBox();
        const read = [b.callMethod(box), host.callMethod(box), a.callMethod(host.makeBox()), b.readAccessor(box), host.readAccessor(b.makeBox())];
        b.writeAccessor(box, 50);
        host.writeAccessor(b.makeBox(), 70);
        return [...read, a.count(), b.count(), host.count(), b.callMethod(b.makeBox())];
      `),
    ).toEqual(everywhere([1, 1, 3, 1, 2, 51, 71, 4, 71]));
  });

  test.concurrent("records cross graphs as the objects they are", async () => {
    expect(
      await run(`
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        a.count(); b.count(); b.count();
        const point = a.makePoint(1, 2);
        return [b.movePoint(point), a.movePoint(point), point.x];
      `),
    ).toEqual(everywhere([32, 42, 4]));
  });

  const hops = `
        export type Hop = (hops: Hop[], at: number) => unknown;
        let label = "";
        const letters: string[] = [];
        export function setLabel(name: string) { label = name; letters.push(...name); }
        const said = (error: unknown) => label + letters.length + new Uint8Array(letters.length).length + " caught " + (error instanceof Error ? error.message : error);
        export const tail: Hop = (hops, at) => hops[at]!(hops, at + 1);
        export const plain: Hop = (hops, at) => { const result = hops[at]!(hops, at + 1); n++; return result; };
        export const guarded: Hop = (hops, at) => { try { return hops[at]!(hops, at + 1); } finally { n += letters.length; } };
        export const rethrows: Hop = (hops, at) => { try { return hops[at]!(hops, at + 1); } catch (error) { n += letters.length; throw error; } };
        export const applies: Hop = (hops, at) => Reflect.apply(hops[at]!, undefined, [hops, at + 1]);
        export const spreads: Hop = (hops, at) => hops[at]!(...([hops, at + 1] as [Hop[], number]));
        export const catches: Hop = (hops, at) => { try { return hops[at]!(hops, at + 1); } catch (error) { return said(error); } };
        export const throws: Hop = () => { throw new Error(label); };
        export const descends: Hop = (hops, at) => 1 + (hops[at]!(hops, at + 1) as number);
        export const restarts: Hop = hops => hops[0]!(hops, 1);
        export async function runsLater(hops: Hop[]) { await 1; return hops[0]!(hops, 1); }
        export async function catchesLater(hops: Hop[]) { const bytes = new Uint8Array(letters.length); try { await 1; return hops[0]!(hops, 1); } catch (error) { return said(error) + bytes.length; } }
        export function* yields(hops: Hop[]) { try { yield label; yield hops[0]!(hops, 1); } finally { n += letters.length; } }
        export const steps = (iterator: Iterator<unknown>) => iterator.next();
        export const throwsInto = (iterator: Iterator<unknown>) => iterator.throw!(new Error(label));
      `;
  const threeGraphs = `
        const graphs: Record<string, any> = { host: await import(url), a: await new Bun.ModuleGraph().import(url), b: await new Bun.ModuleGraph().import(url) };
        for (const name in graphs) graphs[name].setLabel(name);
        const { host, a, b } = graphs;
        const catchesHere = (hops: any[], at: number) => { try { return hops[at](hops, at + 1); } catch (error: any) { return "entry" + url.slice(-7) + " caught " + error.message; } };
      `;

  test.concurrent(
    "an exception that leaves several graphs at once is caught with the catcher's own variables",
    async () => {
      expect(
        await run(
          `${threeGraphs}
        const all = Object.values(graphs).flatMap(graph => ["tail", "plain", "guarded", "rethrows", "applies", "spreads"].map(kind => graph[kind]));
        const catchers: [string, any][] = [["entry/app.js", catchesHere], ["host44", host.catches], ["a11", a.catches], ["b11", b.catches]];
        const wrong: unknown[] = [];
        let chains = 0;
        for (const [catcherSays, catcher] of catchers)
          for (const first of all)
            for (const second of all)
              for (const third of [undefined, ...all])
                for (const thrower in graphs) {
                  const result = catcher([first, second, ...(third ? [third] : []), graphs[thrower].throws], 0);
                  chains++;
                  if (result !== catcherSays + " caught " + thrower) wrong.push(result);
                }
        return [wrong.slice(0, 3), chains, catchesHere([b.tail, a.tail, b.tail, host.tail, a.tail, b.throws], 0)];
      `,
          hops,
        ),
      ).toEqual(everywhere([[], 73872, "entry/app.js caught b"]));
    },
  );

  test.concurrent(
    "an exception that leaves several graphs at once reaches an async function with its own variables",
    async () => {
      expect(
        await run(
          `${threeGraphs}
        async function catchesLaterHere(hops: any[]) {
          const bytes = new Uint8Array(4);
          try { await 1; return hops[0](hops, 1); } catch (error: any) { bytes[1] = url.length ? 1 : 2; return "entry" + bytes.join("") + " caught " + error.message; }
        }
        async function runsLaterHere(hops: any[]) { await 1; return hops[0](hops, 1); }
        const rejected = (error: any) => "rejected with " + error.message + url.slice(-7);
        return [
          await catchesLaterHere([b.tail, a.throws]), await catchesLaterHere([a.tail, b.tail, host.throws]),
          await runsLaterHere([b.tail, a.throws]).catch(rejected), await a.runsLater([b.tail, host.tail, a.throws]).catch(rejected), await b.runsLater([host.tail, a.throws]).catch(a.catches.bind(null, [a.throws], 0)),
          await a.catchesLater([b.tail, host.throws]), await host.catchesLater([a.tail, b.throws]), await b.catchesLater([host.tail, a.tail, b.throws]),
        ];
      `,
          hops,
        ),
      ).toEqual(
        everywhere([
          "entry0100 caught a",
          "entry0100 caught host",
          "rejected with a/app.js",
          "rejected with a/app.js",
          "a11 caught a",
          "a11 caught host1",
          "host44 caught b4",
          "b11 caught b1",
        ]),
      );
    },
  );

  test.concurrent("what a built-in function throws, and a stack overflow, leave several graphs at once", async () => {
    expect(
      await run(
        `${threeGraphs}
        const named = (hops: any[]) => { try { return hops[0](hops, 1); } catch (error: any) { return error.name + url.slice(-7); } };
        return [
          named([b.tail, a.tail, Object.defineProperty]), named([a.tail, b.tail, host.tail, JSON.parse]),
          named([a.descends, b.tail, a.restarts]), named([b.tail, a.descends, b.tail, host.restarts]),
          a.catches([b.tail, host.tail, Object.defineProperty], 0).slice(0, 10), b.count(),
        ];
      `,
        hops,
      ),
    ).toEqual(
      everywhere(["TypeError/app.js", "SyntaxError/app.js", "RangeError/app.js", "RangeError/app.js", "a11 caught", 1]),
    );
  });

  test.concurrent("an exception leaves a generator that another graph steps in tail position", async () => {
    expect(
      await run(
        `${threeGraphs}
        const out: unknown[] = [];
        for (const [owner, stepper, thrower] of [[a, b, a], [a, b, host], [host, a, b], [b, host, a]]) {
          const running = owner.yields([stepper.tail, thrower.throws]);
          out.push(stepper.steps(running).value, catchesHere([() => stepper.steps(running)], 0), stepper.catches([() => owner.steps(running).done], 0));
          const waiting = owner.yields([]);
          stepper.steps(waiting);
          out.push(catchesHere([() => stepper.throwsInto(waiting)], 0), thrower.catches([stepper.tail, () => stepper.throwsInto(waiting)], 0));
        }
        return [out.join(), a.current(), b.current(), host.current()];
      `,
        hops,
      ),
    ).toEqual(
      everywhere([
        [
          ["a", "entry/app.js caught a", true, "entry/app.js caught b", "a11 caught b"],
          ["a", "entry/app.js caught host", true, "entry/app.js caught b", "host44 caught b"],
          ["host", "entry/app.js caught b", true, "entry/app.js caught a", "b11 caught a"],
          ["b", "entry/app.js caught a", true, "entry/app.js caught host", "a11 caught host"],
        ].join(),
        4,
        2,
        8,
      ]),
    );
  });

  test.concurrent("maps and sets with string keys grow in a graph's code and survive a collection", async () => {
    expect(
      await run(
        `
        const host = await import(url);
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        const out: unknown[] = [];
        for (const graph of [a, host, b, a]) {
          const filled = graph.fill(20, 40);
          Bun.gc(true);
          out.push(graph.total(filled), host.total(filled), b.total(filled));
        }
        const late = await new Bun.ModuleGraph().import(url);
        const filled = late.fill(20, 40);
        Bun.gc(true);
        out.push(late.total(filled), a.total(filled), late.total(a.fill(3, 100)));
        return out;
      `,
        `
        export function fill(count: number, keys: number) {
          const maps: Map<string, number>[] = [];
          const sets: Set<string>[] = [];
          for (let i = 0; i < count; i++) {
            const map = new Map<string, number>();
            const set = new Set<string>();
            for (let k = 0; k < keys; k++) { map.set("key" + k, k + i); set.add("member" + k); }
            maps.push(map);
            sets.push(set);
          }
          return { maps, sets };
        }
        export function total({ maps, sets }: ReturnType<typeof fill>) {
          let sum = 0;
          for (const map of maps) for (const [key, value] of map) sum += value + key.length;
          for (const set of sets) for (const member of set) sum += member.length;
          for (const map of maps) { sum += map.get("key3")! + map.size + [...map.keys()].length; map.forEach(value => { sum += value; }); }
          return sum;
        }
      `,
      ),
    ).toEqual(everywhere([...Array(14).fill(58250), 34752]));
  });

  test.concurrent(
    "a closure over the object it is stored in belongs to the graph that stored it, whoever reads it first",
    async () => {
      expect(
        await run(
          `
        const graphs: Record<string, any> = { host: await import(url), a: await new Bun.ModuleGraph().import(url), b: await new Bun.ModuleGraph().import(url) };
        for (const name in graphs) graphs[name].setOwner(name);
        const wrong: string[] = [];
        let rows = 0;
        for (const maker in graphs)
          for (const reader in graphs)
            for (const kind in graphs[maker].makers)
              for (const how in graphs[reader].readers) {
                const object = graphs[maker].makers[kind](how);
                const read = graphs[reader].readers[how](object);
                const said = [typeof read === "function" ? read() : read, object.who(), graphs[maker].readers.call(object), graphs[reader].readers.take(object)()].join();
                rows++;
                if (said !== Array(4).fill(maker + ":" + how).join()) wrong.push([maker, reader, kind, how, said].join(" "));
              }
        Bun.gc(true);
        return [wrong.slice(0, 3), rows];
      `,
          `
        let owner = "";
        export function setOwner(name: string) { owner = name; }
        class Assigned {
          who: () => string;
          constructor(public tag: string) { this.who = () => owner + ":" + this.tag; }
        }
        class Field {
          who = () => owner + ":" + this.tag;
          constructor(public tag: string) {}
        }
        function Old(this: any, tag: string) { this.tag = tag; this.who = () => owner + ":" + this.tag; }
        export const makers: Record<string, (tag: string) => any> = {
          literal(tag) { const self: { tag: string; who?: () => string } = { tag }; self.who = () => owner + ":" + self.tag; return self; },
          untyped(tag) { const self: any = {}; self.tag = tag; self.who = () => owner + ":" + self.tag; return self; },
          assigned: tag => new Assigned(tag),
          field: tag => new Field(tag),
          old: tag => new (Old as any)(tag),
        };
        export const readers: Record<string, (object: any) => any> = {
          call: object => object.who(),
          take: object => object.who,
          typed: (object: Assigned) => object.who(),
          stringify: object => (JSON.stringify(object), object.who()),
          spread: object => ({ ...object }).who(),
          entries: object => (Object.entries(object).find(([key]) => key === "who")![1] as () => string)(),
          assign: object => Object.assign({}, object).who(),
          reflect: object => Reflect.get(object, "who")(),
          descriptor: object => Object.getOwnPropertyDescriptor(object, "who")!.value(),
          destructure: ({ who }) => who(),
          computed: object => object["w" + "ho".slice(0)](),
        };
      `,
        ),
      ).toEqual(everywhere([[], 495]));
    },
  );

  test.concurrent("getters of the host's classes are read in the host and in graphs, in either order", async () => {
    expect(
      await run(
        `
        const host = await import(url);
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        const out: string[] = [];
        for (const order of [[host, a, b], [b, host, a]])
          for (const graph of order) for (let i = 0; i < 3; i++) out.push(graph.readAll());
        Bun.gc(true);
        const late = await new Bun.ModuleGraph().import(url);
        out.push(late.readAll(), host.readAll(), a.readAll());
        return [...new Set(out)];
      `,
        `
        const read = (object: any, name: string) => object[name];
        const status = (response: any) => response.status;
        const method = (request: any) => request.method;
        const href = (url: any) => url.href;
        const size = (blob: any) => blob.size;
        const nameOf = (error: any) => error.name;
        const aborted = (controller: any) => controller.signal.aborted;
        export function readAll() {
          let thrown = "";
          try { structuredClone(() => 1); } catch (error) { thrown = (error as Error).name; }
          return [
            status(new Response("x", { status: 201 })), method(new Request("http://x/", { method: "PUT" })), href(new URL("http://x/y")), size(new Blob(["abc"])),
            nameOf(new DOMException("m", "AbortError")), aborted(new AbortController()), thrown, read(new Response("x"), "ok"), read(new URL("http://x/y?z"), "search"),
          ].join();
        }
      `,
      ),
    ).toEqual(everywhere(["201,PUT,http://x/y,3,AbortError,false,DataCloneError,true,?z"]));
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

test.each(["forEach", "map"])("an uncaught error from the callback of %s is reported", async method => {
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
  const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")]);
  expect({ stdout, firstLines: stderr.split("\n").slice(0, 3), exitCode }).toEqual({
    stdout: "",
    firstLines: [
      "error: thrown in the callback",
      expect.stringMatching(/^ +at callback \(.*entry\.ts:\d+:\d+\)$/),
      expect.stringMatching(new RegExp(`^ +at ${method} `)),
    ],
    exitCode: 1,
  });
});

test("the image is used", async () => {
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
  const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")], undefined, {
    ...bunEnv,
    BUN_AOT_VERBOSE: "1",
  });
  expect({
    stdout,
    usesImage: /\[aot\] image: \d+ bytes, \d+ of code at 0x[0-9a-f]+/.test(stderr),
    exitCode,
  }).toEqual({
    stdout: "3\n",
    usesImage: true,
    exitCode: 0,
  });
});

test.each([["without a JIT", { BUN_JSC_useJIT: "0" }, ["--aot"]]])(
  "a build %s produces the same code",
  async (_, env, flags) => {
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
      expect([withoutTypedSummary(await build.stderr.text()), await build.exited]).toEqual(["", 0]);
      const { stdout, stderr, exitCode } = await runCommand([join(String(dir), outfile)], undefined, {
        ...bunEnv,
        BUN_AOT_VERBOSE: "1",
      });
      expect({ stdout, exitCode }).toEqual({ stdout: "123,foo\n", exitCode: 0 });
      return stderr.match(/^\[aot\] image: \d+ bytes, \d+ of code/m)?.[0];
    }
    const [expected, actual] = await Promise.all([imageOf("a", {}, ["--aot"]), imageOf("b", env, flags)]);
    expect(expected).toStartWith("[aot] image: ");
    expect(actual).toBe(expected);
  },
);

test("file imports evaluate to the paths of the embedded files", async () => {
  using dir = tempDir("compile-aot-file-imports", {
    "first.bin": "first",
    "nested/second.bin": "second",
    "types.d.ts": `declare module "*.bin" { const path: string; export default path; }`,
    "helper.ts": `
      import second from "./nested/second.bin" with { type: "file" };
      export const secondPath = second;
      export const secondLength = second.length;
    `,
    "entry.ts": `
      /// <reference path="./types.d.ts" />
      import first from "./first.bin" with { type: "file" };
      import { readFileSync } from "node:fs";
      import { secondLength, secondPath } from "./helper";
      console.log(first.endsWith(".bin"), first.includes("first"), first.length === [...first].length);
      console.log(secondPath.endsWith(".bin"), secondPath.includes("second"), secondLength === [...secondPath].length);
      console.log(readFileSync(first, "utf8"), readFileSync(secondPath, "utf8"));
    `,
  });
  const { stderr: buildStderr, exitCode: buildExitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", "out"],
    String(dir),
  );
  expect({ buildStderr: withoutTypedSummary(buildStderr), buildExitCode }).toEqual({
    buildStderr: "",
    buildExitCode: 0,
  });
  const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "true true true\ntrue true true\nfirst second\n",
    stderr: "",
    exitCode: 0,
  });
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
      const outfile = join(String(dir), String(i), "out.exe");
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      expect([withoutTypedSummary(await build.stderr.text()), await build.exited]).toEqual(["", 0]);
      return Bun.SHA256.hash(await Bun.file(outfile).bytes(), "hex");
    }),
  );
  expect(new Set(hashes).size).toBe(1);
  await using proc = Bun.spawn({
    cmd: [join(String(dir), "0", "out.exe")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect([await proc.stdout.text(), await proc.exited]).toEqual(["3,6,9,12\n", 0]);
});

test("compiles RegExps with the u and v flags", async () => {
  using dir = tempDir("compile-aot-regexps", {
    "one.ts": `console.log(/o+ne/.test("one"));`,
    "some.ts": `console.log([/a+b/.test("aab"), /\\p{L}+x/u.test("\\xe9x"), /^.$/u.test("\\u{1f600}"), /[\\p{L}--[a-c]]y/v.test("dy")].join());`,
  });
  async function numberOfRegExps(entry: string, expectedStdout: string) {
    const outfile = join(String(dir), entry.replace(".ts", ""));
    const { stderr: stderrOfBuild, exitCode: exitCodeOfBuild } = await runCommand(
      [bunExe(), "build", "--compile", "--aot", "--explain=statistics", entry, "--outfile", outfile],
      String(dir),
    );
    expect(stderrOfBuild).not.toContain("error");
    expect(exitCodeOfBuild).toBe(0);
    const { stdout, exitCode } = await runCommand([outfile]);
    expect(stdout).toBe(expectedStdout);
    expect(exitCode).toBe(0);
    return Number(stderrOfBuild.match(/^RegExpsCompiled (\d+)$/m)?.[1]);
  }
  const one = await numberOfRegExps("one.ts", "true\n");
  expect(one).toBeGreaterThanOrEqual(1);
  expect(await numberOfRegExps("some.ts", "true,true,true,true\n")).toBe(one + 3);
});

test("run-time RegExps are never compiled, however hot: they run on a flat program", async () => {
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
  // The build says of the one place that makes them that its pattern is not known.
  expect([withoutTypedSummary(await build.stderr.text()), await build.exited]).toEqual([
    expect.stringContaining("warn: TS100058: "),
    0,
  ]);
  const { stdout, stderr, exitCode } = await runCommand([outfile], undefined, {
    ...bunEnv,
    BUN_JSC_dumpCompiledRegExpPatterns: "1",
    WORDS: "c[o]ld,h[o]t,l[o]ng",
  });
  expect(stdout).toBe("foo,bar999 foo,bar\n2\n");
  const lines = stderr.split(/\r?\n/);
  const whatHappenedTo = (word: string) =>
    lines.flatMap((line, i) =>
      line.endsWith(`${word}/"`) ? [line.slice(0, line.indexOf(" this regular expression")), lines[i + 1]] : [],
    );
  expect({
    usedOnce: whatHappenedTo("c[o]ld"),
    usedOften: whatHappenedTo("h[o]t"),
    usedOnLongText: whatHappenedTo("l[o]ng"),
  }).toEqual({
    usedOnce: ["Can't JIT", "Runs on a flat program"],
    usedOften: ["Can't JIT", "Runs on a flat program"],
    usedOnLongText: ["Can't JIT", "Runs on a flat program"],
  });
  expect(exitCode).toBe(0);
});

test.skipIf(isASAN)("crash reports symbolicate compiled frames", async () => {
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
  expect([withoutTypedSummary(await build.stderr.text()), await build.exited]).toEqual(["", 0]);
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
      console.log(chosen(20000, 1) + chosen(20000, 2) !== 0);
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
  expect([withoutTypedSummary(await build.stderr.text()), await build.exited]).toEqual(["", 0]);
  const { stdout, stderr, exitCode } = await runCommand([outfile], undefined, {
    ...bunEnv,
    BUN_OPTIONS: `--cpu-prof --cpu-prof-dir=${dir} --cpu-prof-name=entry.cpuprofile`,
  });
  expect({ stdout, stderr }).toEqual({ stdout: "true\n", stderr: "" });
  expect(exitCode).toBe(0);

  const hits: Record<string, number> = {};
  for (const node of (await Bun.file(join(String(dir), "entry.cpuprofile")).json()).nodes)
    hits[node.callFrame.functionName] = (hits[node.callFrame.functionName] ?? 0) + node.hitCount;
  expect(hits.busy).toBeGreaterThan(20);
  expect(hits.busy).toBeGreaterThan(3 * (hits.stringify ?? 0));
});

test("--bytecode-depth has no effect with --aot", async () => {
  using dir = tempDir("compile-aot-depth", {
    "entry.ts": `function a() { return function b() { return function c() { return 1; }; }; } console.log(a()()());`,
  });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "--bytecode-depth=1", "entry.ts", "--outfile", "out"],
    String(dir),
  );
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await runCommand([join(String(dir), "out")], String(dir))).toMatchObject({ stdout: "1\n", exitCode: 0 });
});

test("--aot requires --compile", async () => {
  using dir = tempDir("compile-aot-requires-compile", { "entry.ts": `console.log(1);` });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--aot", "entry.ts", "--outdir", "out"],
    String(dir),
  );
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
    const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")], undefined, { ...bunEnv, ...env });
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

  // A Worker that fails says so to whoever listens, and ends. A main thread that only waits for its message waits for ever, at a full core.
  const answerOf = `
    function answerOf(worker: Worker) {
      return new Promise((done, fail) => {
        worker.onmessage = e => done(e.data);
        worker.onerror = e => fail(new Error(e.message));
        worker.addEventListener("close", () => fail(new Error("the Worker has ended without an answer")));
      });
    }
  `;

  // Bun.ModuleGraph does not find the files of an executable that was built with --aot.
  test.todo("120 sequential Workers with graphs", async () => {
    expect(
      await run(
        {
          "entry.ts": `
            ${answerOf}
            const url = new URL("./app.js", import.meta.url).href;
            if (Bun.isMainThread) {
              const results = new Set();
              for (let i = 0; i < 120; i++) {
                const worker = new Worker(import.meta.url);
                results.add(await answerOf(worker));
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

  // As above.
  test.todo("graphs under GC stress", async () => {
    expect(
      await run(
        {
          "entry.ts": `
            ${answerOf}
            const url = new URL("./app.js", import.meta.url).href;
            if (Bun.isMainThread) {
              const workers = [1, 2, 3].map(() => new Worker(import.meta.url));
              const results = await Promise.all(workers.map(answerOf));
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
    const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")], undefined, { ...bunEnv, ...env });
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
    const rows = Array.from(
      { length: 3000 },
      (_, i) => `  { kind: ${JSON.stringify(literal(i))}, list: [${JSON.stringify(literal(i))}, "x${i % 7}y"] },`,
    );
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

test("--bytecode-order has no effect with --aot", async () => {
  using dir = tempDir("compile-aot-order", { "entry.ts": `console.log(1);`, "app.order": "" });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "--bytecode-order=app.order", "entry.ts", "--outfile", "out"],
    String(dir),
  );
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await runCommand([join(String(dir), "out")], String(dir))).toMatchObject({ stdout: "1\n", exitCode: 0 });
});
