import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isArm64, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";
import { BundlerTestInput, itBundled as itBundledBase } from "./expectBundled";

// `compile.aot` / `--compile-aot`: the executable carries machine code for its functions, compiled when it is built.
// The compiler only targets arm64 so far.
const supported = isArm64 && !isWindows;

// An executable that did not use its image would still run, from its bytecode, and every test here would pass. So each
// test checks that the image was used.
const usesImage = (stdout: string): BundlerTestInput["run"] => ({
  env: { BUN_AOT_VERBOSE: "1" },
  validate({ stdout: actual, stderr }) {
    expect(actual).toBe(stdout);
    expect(stderr).toContain("[aot] image: ");
    expect(stderr).not.toContain("[aot] not using");
  },
});

// Plain `describe`, as in bundler_compile.test.ts: each build rewrites a whole executable.
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

    // Code that the build cannot see is interpreted.
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

    // A variable is live into a handler if the code after it can throw into another handler that reads the variable.
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

    // Knowing the callee says nothing about \`this\`.
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

    // Native code that throws on behalf of its caller finds the caller's realm by walking the stack.
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

    // Functions that are only referenced from a large array literal are still reachable.
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

    // The compiler assumes that built-in objects are immutable.
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
          // Also in a separate realm, and in code that the build did not see.
          console.log(new Function("'use strict'; try { Math.max = 1; return 'ok'; } catch (e) { return e.name; }")());
          console.log(require("node:vm").runInNewContext("Object.isFrozen(Object.prototype)"));
          // Objects that the program defines stay mutable.
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

    // Its code is not part of the build, so it is interpreted. The built-in functions it calls are the compiled ones.
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

    // CommonJS modules, bundled into the ES module output of the build.
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

  // The same executable can run without its image, from the bytecode that it also carries.
  itBundledBase("compile/aot/CanBeTurnedOffWhenItRuns", {
    backend: "cli",
    target: "bun",
    compile: { aot: true },
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    run: {
      env: { BUN_AOT: "0", BUN_AOT_VERBOSE: "1" },
      validate({ stdout, stderr }) {
        expect(stdout).toBe("Hello, world!\n");
        expect(stderr).toContain("[aot] not using the image: useAOT is off");
      },
    },
  });

  test("compile/aot/BuildDoesNotDisturbTheCaller", async () => {
    using dir = tempDir("compile-aot-caller", {
      "app.ts": `console.log("from the executable");`,
      "build.ts": `
        // Each of these is compiled differently for an executable that is built with \`aot\`.
        function work() {
          const literal = { a: 1, get b() { return 2; }, c: [1, 2, 3] };
          class K { x = 1; y = this.x + 1; }
          let s = 0;
          for (let i = 0; i < 100000; i++) s += literal.a + literal.b + literal.c.length + new K().y;
          return s;
        }
        // The build compiles $$t(value, mask) to a type check. In the caller it must stay an ordinary call to a
        // function with that name. The text differs each time, so that it is compiled each time.
        const callsItsOwnFunction = (n: number) =>
          new Function("function $$t(v, m) { return 'called' + m; } return $$t(1, 1); // " + n)() === "called1";
        const before = work();
        const own = callsItsOwnFunction(1);
        // The built-in objects of the build's realms are immutable. Those of a realm that the caller creates are not.
        const newRealmIsMutable = () => !require("node:vm").runInNewContext("Object.isFrozen(Object.prototype)");
        const mutable = newRealmIsMutable();
        const result = await Bun.build({ entrypoints: ["./app.ts"], compile: { aot: true, outfile: "./app" } });
        // Code that is first compiled after the build.
        const after = new Function("return (" + work.toString() + ")()")();
        Math.max = Math.max;
        console.log(result.success, before === work(), before === after, own, callsItsOwnFunction(2), mutable, newRealmIsMutable());
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build.ts"],
      // The build has sound types on.
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

// The compiler and the static heap builder have process-wide state, so concurrent builds are serialized on the
// bundler's single thread.
test.skipIf(!supported)("compile.aot: several builds at once, from several threads", async () => {
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

// The compiler emits code for the machine that it runs on. The error is reported before a runtime for the target is
// downloaded.
const otherTarget = process.platform === "linux" ? "bun-darwin-x64" : "bun-linux-x64";
const whyNot = supported
  ? "ahead-of-time compilation cannot target another platform or version of Bun"
  : "ahead-of-time compilation only supports arm64 macOS and Linux so far";

test("--compile-aot does not cross-compile, and says where it is not supported", async () => {
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

test("compile.aot does not cross-compile, and says where it is not supported", async () => {
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

// Compiled code is for one instance of a program, which is the host's, whoever loads a module first. Without bytecode
// there is nothing else to run, so this tells: a graph is refused, and the host is not.
test.skipIf(!supported)(
  "a Bun.ModuleGraph that loads a module first does not take the host's compiled code",
  async () => {
    using dir = tempDir("compile-aot-module-graph", {
      "entry.ts": `
      const url = new URL("./app.js", import.meta.url).href;
      const inGraph = await new Bun.ModuleGraph().import(url).then(() => "loaded", e => e.name + ": " + e.message.split(",")[0]);
      console.log(inGraph);
      console.log((await import(url)).count());
    `,
      "app.ts": `let n = 0; export function count() { return ++n; }`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", "--splitting", "entry.ts", "app.ts", "--outfile", "out"],
      env: { ...bunEnv, BUN_COMPILE_OMIT_SOURCE_TEXT: "1", BUN_COMPILE_OMIT_BYTECODE: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    await using proc = Bun.spawn({ cmd: [join(String(dir), "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "SyntaxError: This code was compiled ahead of time\n1\n",
      stderr: "",
      exitCode: 0,
    });
  },
);

// Compiled code calls some builtins without their function objects ever having been made, and the source provider of a
// builtin used to be made with its function object. Printing the error looked at the source of every frame.
test.skipIf(!supported).each(["forEach", "map"])(
  "an uncaught error from the callback of %s is reported in an executable without bytecode",
  async method => {
    using dir = tempDir("compile-aot-uncaught", {
      "entry.ts": `[1].${method}(function callback() { throw new Error("thrown in the callback"); });`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", "out"],
      env: { ...bunEnv, BUN_COMPILE_OMIT_SOURCE_TEXT: "1", BUN_COMPILE_OMIT_BYTECODE: "1" },
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

// The data of an executable is mapped where it was built for. Its code used to be too, which left executable memory at an
// address that anyone could know.
test.skipIf(!supported).each([
  ["with bytecode", {}],
  ["without bytecode", { BUN_COMPILE_OMIT_SOURCE_TEXT: "1", BUN_COMPILE_OMIT_BYTECODE: "1" }],
])("the code of an executable %s is not at a fixed address", async (_, env) => {
  using dir = tempDir("compile-aot-address", {
    "entry.ts": `function add(a: number, b: number) { return a + b; } console.log(new (function Made(this: any) { this.sum = add(1, 2); } as any)().sum);`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--compile-aot", "entry.ts", "--outfile", "out"],
    env: { ...bunEnv, ...env },
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
  const address = Number(stderr.match(/of code at (0x[0-9a-f]+)/)?.[1]);
  // bmalloc::StaticRegion: eight arenas of 4 GB.
  const start = isMacOS ? 0x200000000000 : 0x2000000000;
  expect({
    stdout,
    usesStaticHeap: stderr.includes("[aot] static heap: "),
    isInRegion: !(address < start || address >= start + 8 * 2 ** 32),
    exitCode,
  }).toEqual({
    stdout: "3\n",
    usesStaticHeap: true,
    isInRegion: false,
    exitCode: 0,
  });
});

// The compiler must not depend on the JIT of the process that runs the build. It used to link regular expressions in
// JIT memory. Without a JIT the executable silently had no code for them, and matched them with the interpreter, ten
// times slower.
// BUN_AOT=1 requests an ahead-of-time build from a script that cannot pass the option. It does not imply the other two
// options.
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

// Ahead-of-time compiled programs run without a JIT, so a pattern that has no code in the image is matched by the interpreter, which is
// about ten times slower. The output is the same either way, so this counts the patterns that have code.
test.skipIf(!supported)("regular expressions with the u and v flags are compiled", async () => {
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

// The build has not seen a pattern that is put together at run time, so there is no code for it in the image. Although the program
// runs without the JIT, such a pattern is compiled once it has done enough work in the interpreter to pay for that. The output is
// the same either way, so this asks the engine what it did with each pattern.
test.skipIf(!supported)("a regular expression that is built at run time is compiled when it is hot", async () => {
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

// The loader knows nothing about the machine code that the executable carries, so the crash handler asks the engine where a
// frame in it is, and reports an offset in an object called "aot". The map that a build can write resolves that to a function.
test.skipIf(!supported)("a crash report locates the frames of compiled code", async () => {
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

  // In the trace string, a frame that is not in Bun itself is: 1, the length of the object's name, the name, the offset. The
  // numbers are base64 VLQs.
  function decodeVLQ(text: string) {
    let value = 0;
    for (let i = 0; ; i++) {
      const digit = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(text[i]);
      value += (digit & 31) * 2 ** (5 * i);
      if (!(digit & 32)) return value % 2 ? -(value - 1) / 2 : value / 2;
    }
  }
  const offsets = stderr.split("CGaot").slice(1).map(decodeVLQ);
  // One line for each function: F, its index, the offset of its code, the size of its code, ...
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

// The interpreter and the JIT tell the engine which frame is running whenever they call a C or C++ function. Compiled code leaves
// that to the function, and one like sin() does not do it. The profiler used to charge the time in those to the last host function
// that the program had called, which had returned long ago.
test.skipIf(!supported)("--cpu-prof charges time in native functions to the function that is running", async () => {
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
      // (Twice, so that it is not inlined.)
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

// An executable without its machine code would still run, from its bytecode, so a build that cannot produce it has to fail.
// An image holds at most 8 copies of the stubs, which is enough for 768 MB of code.
test.skipIf(!supported)("a program with too much code for an image is an error", async () => {
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

// The compiler analyzes the whole program, so it needs the bytecode of every function.
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

// A build script that sets BUN_AOT=1 for its executable may also bundle other things.
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

  // The same variable does apply to a build that can be compiled ahead of time.
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
