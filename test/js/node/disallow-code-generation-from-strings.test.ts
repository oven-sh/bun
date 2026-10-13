// --disallow-code-generation-from-strings: as Node.js's flag, eval and the Function constructors
// throw. With "=strict" (Bun's own), nothing in the process turns a string into script.
import * as internals from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isGlibc, isLinux, isWindows, nodeExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const refused = "EvalError: Code generation from strings disallowed for this context";
const flag = "--disallow-code-generation-from-strings";
const strict = flag + "=strict";
// A build of Bun configured with codeGenerationFromStrings off (scripts/build/config.ts) has
// =strict as a constant: with no flag, new vm.Script() throws.
const builtStrict =
  Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `try { new (require("node:vm").Script)("1"); console.log(false); } catch { console.log(true); }`,
    ],
    env: bunEnv,
  })
    .stdout.toString()
    .trim() === "true";

const files = {
  "worker.mjs": `
    import { parentPort } from "node:worker_threads";
    let evaluated;
    try { evaluated = eval("1 + 1"); } catch (e) { evaluated = e.constructor.name; }
    parentPort.postMessage({ evaluated, execArgv: process.execArgv });
  `,
  "empty.mjs": `export {};`,
  "made.foo": `module.exports = "unused";`,
  "graph.mjs": `
    const attempt = fn => { try { return fn(); } catch (e) { return e.constructor.name; } };
    export const viaEval = () => attempt(() => eval("tag"));
    export const viaFunction = () => attempt(() => new Function("return 1 + 1")());
  `,
  // Each route is one way a string becomes script (or, in the last group, something that must keep
  // working). The value is what it returned, or the error it threw.
  "routes.mjs": `
    import vm from "node:vm";
    import inspector from "node:inspector";
    import { startRemoteDebugger } from "bun:jsc";
    import Module, { createRequire } from "node:module";
    import { Worker as NodeWorker } from "node:worker_threads";
    import { fileURLToPath } from "node:url";
    const require = createRequire(import.meta.url);
    const here = name => new URL(name, import.meta.url);
    const attempt = async fn => { try { return await fn(); } catch (e) { return e.constructor.name + ": " + e.message; } };
    const message = make => new Promise((resolve, reject) => {
      const worker = make();
      if (worker.on) { worker.on("message", m => { worker.terminate(); resolve(m); }); worker.on("error", reject); }
      else { worker.onmessage = e => { worker.terminate(); resolve(e.data); }; worker.onerror = e => reject(e.error ?? new Error(e.message)); }
    });
    const blobOf = source => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

    const evalAndFunction = {
      directEval: () => eval("1 + 1"),
      indirectEval: () => (0, eval)("1 + 1"),
      newFunction: () => new Function("return 1 + 1")(),
      callFunction: () => Function("return 1 + 1")(),
      functionViaConstructor: () => (() => {}).constructor("return 1 + 1")(),
      asyncFunctionViaConstructor: () => typeof (async () => {}).constructor("return 1"),
      generatorViaConstructor: () => typeof (function* () {}).constructor("yield 1"),
      asyncGeneratorViaConstructor: () => typeof (async function* () {}).constructor("yield 1"),
      functionPrototypeConstructor: () => Function.prototype.constructor("return 1 + 1")(),
      globalThisFunction: () => new globalThis.Function("return 1 + 1")(),
      reflectConstruct: () => Reflect.construct(Function, ["return 1 + 1"])(),
      shadowRealm: () => new ShadowRealm().evaluate("1 + 1"),
      shadowRealmInnerEval: () => new ShadowRealm().evaluate("eval('1 + 1')"),
    };
    const everythingElse = {
      vmScript: () => typeof new vm.Script("1 + 1"),
      vmRunInThisContext: () => vm.runInThisContext("1 + 1"),
      vmRunInNewContext: () => vm.runInNewContext("1 + 1"),
      vmRunInContext: () => vm.runInContext("1 + 1", vm.createContext({})),
      vmCompileFunction: () => vm.compileFunction("return 1 + 1")(),
      vmSourceTextModule: () => typeof new vm.SourceTextModule("export default 1 + 1"),
      // A context is where Node.js leaves eval on under its flag, whatever the context asks for.
      vmContextEval: () => vm.runInNewContext("eval('1 + 1')"),
      vmContextEvalStringsTrue: () => vm.runInContext("eval('1 + 1')", vm.createContext({}, { codeGeneration: { strings: true } })),
      moduleCompile: () => { const m = new Module("/made.cjs"); m._compile("module.exports = 1 + 1", "/made.cjs"); return m.exports; },
      requireExtensionsCompile: () => {
        require.extensions[".foo"] = (module, filename) => module._compile("module.exports = 1 + 1", filename);
        try { return require("./made.foo"); } finally { delete require.extensions[".foo"]; }
      },
      moduleWrapperOverride: () => {
        const before = Module.wrapper[0];
        try { Module.wrapper[0] = before + "/* changed */"; return "set"; } finally { try { Module.wrapper[0] = before; } catch {} }
      },
      // A refused write is not left in the array, so a later write of what is already there is not refused.
      moduleWrapperAfterARefusedWrite: () => {
        const wrapper = Module.wrapper;
        const before = wrapper[0];
        try { wrapper[0] = before + "/* changed */"; } catch (refusal) {
          if (wrapper[0] !== before) return "left in the array";
          try { wrapper[1] = wrapper[1]; } catch { return "a later write of the same value was refused"; }
          throw refusal;
        }
        wrapper[0] = before;
        return "set";
      },
      importData: async () => (await import("data:text/javascript,export default 1 + 1")).default,
      importBlob: async () => (await import(blobOf("export default 1 + 1"))).default,
      requireData: () => require("data:text/javascript,module.exports = 1 + 1"),
      workerFromBlob: () => message(() => new Worker(blobOf("postMessage(2)"))),
      workerFromData: () => message(() => new Worker("data:text/javascript,postMessage(2)")),
      workerEvalOption: () => message(() => new NodeWorker("require('node:worker_threads').parentPort.postMessage(2)", { eval: true })),
      pluginOnLoadSource: async () => {
        Bun.plugin({ name: "source", setup(build) {
          build.onResolve({ filter: /\\.made$/ }, args => ({ path: args.path, namespace: "made" }));
          build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ contents: "export default 1 + 1", loader: "js" }));
        } });
        return (await import("./x.made")).default;
      },
      pluginModuleSource: async () => {
        Bun.plugin({ name: "module-source", setup(build) { build.module("made:source", () => ({ contents: "export default 1 + 1", loader: "ts" })); } });
        return (await import("made:source")).default;
      },
      inspectorOpen: () => { inspector.open(0, "127.0.0.1"); inspector.close(); return 2; },
      // The refusal does not depend on what script can replace.
      inspectorOpenWhenInstanceofLies: () => {
        Object.defineProperty(EvalError, Symbol.hasInstance, { value: () => false, configurable: true });
        try { inspector.open(0, "127.0.0.1"); inspector.close(); return 2; } finally { delete EvalError[Symbol.hasInstance]; }
      },
      // A host that is not a string is refused before anything is bound, so nothing listens when this is allowed.
      jscStartRemoteDebugger: () => { try { startRemoteDebugger(1); } catch (e) { if (e.name === "EvalError") throw e; } return 2; },
    };
    const notScriptFromAString = {
      evalOfNonString: () => eval(2),
      vmCreateContext: () => typeof vm.createContext({}, { codeGeneration: { strings: true } }),
      vmSyntheticModule: () => typeof new vm.SyntheticModule(["x"], function () { this.setExport("x", 1); }),
      moduleWrapperSameValue: () => { Module.wrapper[0] = Module.wrapper[0]; return "set"; },
      pluginModuleData: async () => {
        Bun.plugin({ name: "module-data", setup(build) { build.module("made:data", () => ({ contents: "a = 2", loader: "toml" })); } });
        return typeof (await import("made:data"));
      },
      pluginModuleExports: async () => {
        Bun.plugin({ name: "module-exports", setup(build) { build.module("made:exports", () => ({ exports: { default: 2 }, loader: "object" })); } });
        return (await import("made:exports")).default;
      },
      jsonParse: () => JSON.parse("2"),
      regexp: () => /(\\d)/.exec("a2")[1],
      webAssembly: () => typeof WebAssembly === "undefined" ? "not in this build" : WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
      importComputedSpecifier: async () => Object.keys(await import("./emp" + "ty.mjs")).length,
      requireBuiltin: () => typeof require("node:fs").readFileSync,
    };
    const workers = {
      worker: () => message(() => new NodeWorker(here("./worker.mjs"))),
      workerEmptyExecArgv: () => message(() => new NodeWorker(here("./worker.mjs"), { execArgv: [] })),
      workerOwnExecArgv: () => message(() => new NodeWorker(here("./worker.mjs"), { execArgv: ["--no-addons"] })),
      webWorker: () => message(() => new Worker(here("./worker.mjs").href)),
      webWorkerEmptyExecArgv: () => message(() => new Worker(here("./worker.mjs").href, { execArgv: [] })),
      workerProcessExecArgv: () => message(() => new NodeWorker(here("./worker.mjs"), { execArgv: process.execArgv })),
    };
    // A graph shares the global object and its intrinsics with the host, so it shares the switch:
    // inside graph.run(), called by the host directly, and after dispose().
    const graph = async () => {
      const graph = new Bun.ModuleGraph({ globals: { tag: 2 } });
      const app = await graph.import(fileURLToPath(here("./graph.mjs")));
      const inRun = [graph.run(app.viaEval), graph.run(app.viaFunction)];
      const calledByTheHost = [app.viaEval(), app.viaFunction()];
      graph.dispose();
      return { inRun, calledByTheHost, afterDispose: [app.viaEval(), app.viaFunction()] };
    };

    const run = async routes => Object.fromEntries(await Promise.all(Object.entries(routes).map(async ([name, fn]) => [name, await attempt(fn)])));
    const result = {
      execArgv: process.execArgv,
      evalAndFunction: await run(evalAndFunction),
      everythingElse: await run(everythingElse),
      notScriptFromAString: await run(notScriptFromAString),
      workers: await run(workers),
      graph: await attempt(graph),
    };
    console.log(JSON.stringify(result));
    process.exit(0);
  `,
};

async function run(args: string[], env: Record<string, string> = {}) {
  using dir = tempDir("disallow-code-generation", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "routes.mjs"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const all = (names: string[], value: unknown) => Object.fromEntries(names.map(name => [name, value]));
const evalAndFunction = {
  directEval: 2,
  indirectEval: 2,
  newFunction: 2,
  callFunction: 2,
  functionViaConstructor: 2,
  asyncFunctionViaConstructor: "function",
  generatorViaConstructor: "function",
  asyncGeneratorViaConstructor: "function",
  functionPrototypeConstructor: 2,
  globalThisFunction: 2,
  reflectConstruct: 2,
  shadowRealm: 2,
  shadowRealmInnerEval: 2,
};
const everythingElse = {
  vmScript: "object",
  vmRunInThisContext: 2,
  vmRunInNewContext: 2,
  vmRunInContext: 2,
  vmCompileFunction: 2,
  vmSourceTextModule: "object",
  vmContextEval: 2,
  vmContextEvalStringsTrue: 2,
  moduleCompile: 2,
  requireExtensionsCompile: 2,
  moduleWrapperOverride: "set",
  moduleWrapperAfterARefusedWrite: "set",
  importData: 2,
  importBlob: 2,
  requireData: 2,
  workerFromBlob: 2,
  workerFromData: 2,
  workerEvalOption: 2,
  pluginOnLoadSource: 2,
  pluginModuleSource: 2,
  inspectorOpen: 2,
  inspectorOpenWhenInstanceofLies: 2,
  jscStartRemoteDebugger: 2,
};
const notScriptFromAString = {
  evalOfNonString: 2,
  vmCreateContext: "object",
  vmSyntheticModule: "object",
  moduleWrapperSameValue: "set",
  pluginModuleData: "object",
  pluginModuleExports: 2,
  jsonParse: 2,
  regexp: "2",
  // A build of Bun configured with webAssembly off has no WebAssembly global.
  webAssembly: typeof WebAssembly === "undefined" ? "not in this build" : true,
  importComputedSpecifier: 0,
  requireBuiltin: "function",
};
// What a Worker evaluates, and the process.execArgv it sees.
const workers = (evaluated: unknown, inherited: string[], own: (given: string[]) => string[]) => ({
  worker: { evaluated, execArgv: inherited },
  workerEmptyExecArgv: { evaluated, execArgv: own([]) },
  workerOwnExecArgv: { evaluated, execArgv: own(["--no-addons"]) },
  webWorker: { evaluated, execArgv: inherited },
  webWorkerEmptyExecArgv: { evaluated, execArgv: own([]) },
  // A Worker cannot be given the flag, so a process that was given it cannot hand on its own list.
  workerProcessExecArgv:
    inherited.length > 0
      ? `Error: Initiated Worker with invalid execArgv flags: ${inherited[0]}`
      : { evaluated, execArgv: own([]) },
});
const graph = (viaEval: unknown, viaFunction: unknown) => ({
  inRun: [viaEval, viaFunction],
  calledByTheHost: [viaEval, viaFunction],
  afterDispose: [viaEval, viaFunction],
});

describe.concurrent.skipIf(builtStrict)("--disallow-code-generation-from-strings", () => {
  test("without the flag, every route makes script", async () => {
    const { stdout, exitCode } = await run([]);
    expect(JSON.parse(stdout)).toEqual({
      execArgv: [],
      evalAndFunction,
      everythingElse,
      notScriptFromAString,
      workers: workers(2, [], given => given),
      graph: graph(2, 2),
    });
    expect(exitCode).toBe(0);
  });

  test("the flag is Node.js's: eval and the Function constructors throw, in Workers too, and nothing else changes", async () => {
    const { stdout, exitCode } = await run([flag]);
    expect(JSON.parse(stdout)).toEqual({
      execArgv: [flag],
      evalAndFunction: all(Object.keys(evalAndFunction), refused),
      everythingElse,
      notScriptFromAString,
      // As in Node.js, a Worker given an execArgv reports that one.
      workers: workers("EvalError", [flag], given => given),
      graph: graph("EvalError", "EvalError"),
    });
    expect(exitCode).toBe(0);
  });

  test("=strict refuses every way a string becomes script, and a Worker cannot lower it", async () => {
    const { stdout, exitCode } = await run([strict]);
    expect(JSON.parse(stdout)).toEqual({
      execArgv: [strict],
      evalAndFunction: all(Object.keys(evalAndFunction), refused),
      everythingElse: all(Object.keys(everythingElse), refused),
      notScriptFromAString,
      workers: workers("EvalError", [strict], given => [...given, strict]),
      graph: graph("EvalError", "EvalError"),
    });
    expect(exitCode).toBe(0);
  });

  // Given more than once, the last counts, as for any option. BUN_OPTIONS comes before the command line.
  // (What a compiled executable was built with is a floor: test/bundler/compile-argv.test.ts.)
  for (const [name, args, env, vmScript] of [
    ["the flag, then =strict", [flag, strict], {}, refused],
    ["=strict, then the flag", [strict, flag], {}, "object"],
    ["=strict in BUN_OPTIONS, the flag on the command line", [flag], { BUN_OPTIONS: strict }, "object"],
    ["the flag in BUN_OPTIONS, =strict on the command line", [strict], { BUN_OPTIONS: flag }, refused],
  ] as const) {
    test(name, async () => {
      const { stdout, exitCode } = await run([...args], env);
      const { everythingElse, evalAndFunction } = JSON.parse(stdout);
      expect({ vmScript: everythingElse.vmScript, directEval: evalAndFunction.directEval }).toEqual({
        vmScript,
        directEval: refused,
      });
      expect(exitCode).toBe(0);
    });
  }

  test("after the script's name it is the script's argument", async () => {
    using dir = tempDir("disallow-code-generation-argument", {
      "script.js": `console.log(JSON.stringify([eval("1 + 1"), process.argv.slice(2), process.execArgv]));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "script.js", strict],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual([2, [strict], []]);
    expect(exitCode).toBe(0);
  });

  test("a value other than strict is a startup error", async () => {
    const { stdout, stderr, exitCode } = await run([flag + "=strcit"]);
    expect({ stdout, stderr: stderr.trim() }).toEqual({
      stdout: "",
      stderr: `error: Invalid value for --disallow-code-generation-from-strings: "strcit". Must be "strict", or no value`,
    });
    expect(exitCode).toBe(1);
  });

  // The flag is the process's. As in Node.js, a Worker cannot be given it, whether or not the process
  // has it, so `execArgv: process.execArgv` throws in a process that does.
  const workerGivenTheFlag = {
    "worker.mjs": `import { parentPort } from "node:worker_threads"; parentPort.postMessage("started");`,
    "main.mjs": `
      import { Worker } from "node:worker_threads";
      const start = execArgv => new Promise(resolve => {
        try {
          const worker = new Worker(new URL("./worker.mjs", import.meta.url), { execArgv });
          worker.on("message", resolve);
          worker.on("error", error => resolve("error event: " + error.message));
        } catch (e) {
          resolve({ name: e.name, code: e.code, message: e.message, isError: e instanceof Error, isTypeError: e instanceof TypeError });
        }
      });
      const seen = { "process.execArgv": await start(process.execArgv) };
      for (const given of JSON.parse(process.argv[2])) seen[given] = await start([given]);
      console.log(JSON.stringify(seen));
      process.exit(0);
    `,
  };
  const invalidExecArgv = (given: string) => ({
    name: "Error",
    code: "ERR_WORKER_INVALID_EXEC_ARGV",
    message: "Initiated Worker with invalid execArgv flags: " + given,
    isError: true,
    isTypeError: false,
  });
  async function startWorkersGiven(exe: string, args: readonly string[], given: string[]) {
    using dir = tempDir("disallow-code-generation-worker", workerGivenTheFlag);
    await using proc = Bun.spawn({
      cmd: [exe, ...args, "main.mjs", JSON.stringify(given)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { seen: JSON.parse(stdout), exitCode };
  }

  test.each([
    ["no flag", [], "started"],
    ["the flag", [flag], invalidExecArgv(flag)],
    ["=strict", [strict], invalidExecArgv(strict)],
  ] as const)("a Worker's execArgv with the flag, in a process with %s", async (_, args, ownExecArgv) => {
    expect(await startWorkersGiven(bunExe(), args, [flag, strict])).toEqual({
      seen: { "process.execArgv": ownExecArgv, [flag]: invalidExecArgv(flag), [strict]: invalidExecArgv(strict) },
      exitCode: 0,
    });
  });

  test.skipIf(!nodeExe())("a Worker's execArgv with the flag is refused as Node.js refuses it", async () => {
    for (const args of [[], [flag]]) {
      expect(await startWorkersGiven(bunExe(), args, [flag])).toEqual(
        await startWorkersGiven(nodeExe()!, args, [flag]),
      );
    }
  });

  // The inspector evaluates what its client sends. Asking for both is an error: the process never
  // runs with one of the two silently dropped.
  for (const [name, args, env] of [
    ["--inspect", ["--inspect=127.0.0.1:0"], {}],
    ["--inspect-wait", ["--inspect-wait=127.0.0.1:0"], {}],
    ["--inspect-brk", ["--inspect-brk=127.0.0.1:0"], {}],
    ["BUN_INSPECT", [], { BUN_INSPECT: "ws://127.0.0.1:0/x" }],
  ] as const) {
    test(`=strict with ${name} is a startup error`, async () => {
      const { stdout, stderr, exitCode } = await run([strict, ...args], env);
      expect({ stdout, stderr: stderr.trim() }).toEqual({
        stdout: "",
        stderr: `error: ${name} cannot be used with --disallow-code-generation-from-strings=strict: the inspector evaluates code from strings`,
      });
      expect(exitCode).toBe(1);
    });
  }

  // Editors set BUN_INSPECT_CONNECT_TO for everything started from their terminals, so it is not
  // somebody asking to debug this process: it is refused with a warning, and the program runs.
  test("=strict ignores BUN_INSPECT_CONNECT_TO, with a warning, and connects to nothing", async () => {
    let connections = 0;
    let opened = Promise.withResolvers<void>();
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          connections++;
          opened.resolve();
        },
        data() {},
      },
    });
    const env = { BUN_INSPECT_CONNECT_TO: `tcp://127.0.0.1:${listener.port}` };

    // Without =strict a process does connect, so a connection would be seen here.
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), flag, "-e", "setInterval(() => {}, 1000)"],
        env: { ...bunEnv, ...env },
        stdout: "ignore",
        stderr: "ignore",
      });
      await Promise.race([
        opened.promise,
        proc.exited.then(code => Promise.reject(new Error(`exited with ${code} before it connected`))),
      ]);
      expect(connections).toBe(1);
    }

    const { stdout, stderr, exitCode } = await run([strict], env);
    expect(stderr.trim()).toBe(
      "warn: BUN_INSPECT_CONNECT_TO is ignored with --disallow-code-generation-from-strings=strict: the inspector evaluates code from strings",
    );
    expect(JSON.parse(stdout).evalAndFunction.directEval).toBe(refused);
    expect(exitCode).toBe(0);

    // Connections are accepted in the order they were made: one that process had made comes before this one.
    opened = Promise.withResolvers<void>();
    const own = await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { data() {} } });
    await opened.promise;
    own.end();
    expect(connections).toBe(2);
  });

  // $vm, the engine's debugging global, evaluates strings and makes global objects where eval is on.
  test("BUN_JSC_useDollarVM=1 does not define the engine's debugging global", async () => {
    const typeOfDollarVM = async (...args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args, "-p", "typeof $vm"],
        env: { ...bunEnv, BUN_JSC_useDollarVM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return stdout.trim();
    };
    // Only an engine built with assertions has it, which a debug build's always is: there, it is
    // the flag that leaves it out.
    if (isDebug) expect(await typeOfDollarVM()).toBe("object");
    expect([await typeOfDollarVM(flag), await typeOfDollarVM(strict)]).toEqual(["undefined", "undefined"]);
  });

  // Every file of `bun test` runs at the level, in the one process, in a global object of its own
  // (--isolate), and in the processes --parallel starts, which are passed the flag.
  describe.each([
    ["no flag", [], ["allowed", "allowed"]],
    ["the flag", [flag], ["EvalError", "allowed"]],
    ["=strict", [strict], ["EvalError", "EvalError"]],
  ] as const)("bun test with %s", (_, args, expected) => {
    test.each([[[]], [["--isolate"]], [["--parallel=2", "--parallel-delay=0"]]])("%j", async mode => {
      const file = `
        import { expect, test } from "bun:test";
        import vm from "node:vm";
        const attempt = fn => { try { fn(); return "allowed"; } catch (e) { return e.name; } };
        test("level", () => {
          expect([attempt(() => eval("1")), attempt(() => new vm.Script("1"))]).toEqual(${JSON.stringify(expected)});
        });
      `;
      using dir = tempDir("disallow-code-generation-bun-test", { "a.test.js": file, "b.test.js": file });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...args, ...mode],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(" 2 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    });
  });
});

describe.concurrent.skipIf(!builtStrict)("a build with =strict as a constant", () => {
  // process.execArgv is what was given, so with no flag a Worker can be handed it.
  test.each([
    ["no flag", []],
    ["the flag, which does not lower it", [flag]],
    ["=strict", [strict]],
  ] as const)("refuses every way a string becomes script, with %s", async (_, args) => {
    const { stdout, exitCode } = await run([...args]);
    expect(JSON.parse(stdout)).toEqual({
      execArgv: args,
      evalAndFunction: all(Object.keys(evalAndFunction), refused),
      everythingElse: all(Object.keys(everythingElse), refused),
      notScriptFromAString,
      workers: workers("EvalError", [...args], given => given),
      graph: graph("EvalError", "EvalError"),
    });
    expect(exitCode).toBe(0);
  });

  test("--inspect is a startup error with no flag", async () => {
    const { stdout, stderr, exitCode } = await run(["--inspect=127.0.0.1:0"]);
    expect({ stdout, stderr: stderr.trim() }).toEqual({
      stdout: "",
      stderr: `error: --inspect cannot be used with ${strict}: the inspector evaluates code from strings`,
    });
    expect(exitCode).toBe(1);
  });
});

// In a `bun build --compile` executable =strict is an allow-list: the engine runs Bun's builtins and the JavaScript that
// is embedded in the executable, and refuses everything else where code is linked, whichever way it came in.
describe.concurrent("=strict in a compiled executable", () => {
  const notEmbedded = (url?: string) => "EvalError: Refused to run untrusted code" + (url ? ": " + url : "");
  // Compiled under ASSERT_ENABLED only.
  const hasTestBinding = internals.evaluateAsProgram !== undefined;
  const exe = isWindows ? "app.exe" : "app";

  // No top-level await: --format=cjs and --bytecode do not take it.
  const run = `
      const unhandled = [];
      process.on("unhandledRejection", reason => unhandled.push(String(reason)));
      (async () => {
        const results = {};
        for (const [name, route] of Object.entries(routes)) {
          try { results[name] = await route(); } catch (e) { results[name] = e.constructor.name + ": " + e.message; }
        }
        console.log(JSON.stringify({ results, unhandled, ran: globalThis.ran }));
        process.exit(0);
      })();
  `;
  const program = {
    // Every text that must not run says so if it does.
    "refused.ts": `
      import fs from "node:fs";
      import Module from "node:module";
      import asset from "./asset.txt" with { type: "file" };
      const dir = process.argv[2];
      const ran = name => '(globalThis.ran ??= []).push("' + name + '");';
      const written = (name, text = ran(name)) => { fs.writeFileSync(dir + "/" + name, text); return dir + "/" + name; };
      const workerError = path => new Promise(resolve => {
        const worker = new Worker(path);
        worker.onmessage = e => resolve("ran: " + e.data);
        worker.onerror = e => resolve(e.message.trim());
      });

      const routes = {
        pluginJSON: () => {
          Bun.plugin({ name: "json", setup(build) {
            build.onLoad({ filter: /\\.plugin-json$/ }, () => ({ contents: ran("pluginJSON"), loader: "json" }));
          } });
          return import(written("x.plugin-json", ""));
        },
        macroName: () => new Bun.Transpiler({ loader: "ts" }).transformSync(
          'import { "a\\']; (globalThis.ran ??= []).push(/macroName/.source); //" as macro } from "bun" with { type: "macro" }; export default macro();'),
        importWritten: () => import(written("imported.mjs")),
        requireWritten: () => require(written("required.cjs")),
        workerWritten: () => workerError(written("worker.mjs", 'postMessage("worker.mjs")')),
        bytecodeFile: () => require(dir + "/bytecode/with-bytecode.js"),
        sameTextWithoutBytecode: () => require(written("same-text.js", fs.readFileSync(dir + "/bytecode/with-bytecode.js", "utf8"))),
        compileCache: () => { Module.enableCompileCache(dir + "/compile-cache"); return require(dir + "/compile-cached.cjs"); },
        transpilerCache: () => import(dir + "/transpiler-cached.ts"),
        dataModule: () => import(["data:text/javascript", ran("dataModule")].join(",")),
        blobModule: () => import(URL.createObjectURL(new Blob([ran("blobModule")], { type: "text/javascript" }))),
        embeddedAsset: () => import(asset),
        devServer: () => Bun.serve({ port: 0, app: { root: dir, framework: {
          fileSystemRouterTypes: [{ root: "pages", style: "nextjs-pages", serverEntryPoint: dir + "/framework-server.ts", clientEntryPoint: dir + "/framework-client.ts" }],
          reactFastRefresh: false,
        } } }),
      };
      if (process.env.HAS_GLIBC) {
        routes.memfd = async () => {
          const { dlopen } = await import("bun:ffi");
          const { memfd_create } = dlopen("libc.so.6", { memfd_create: { args: ["cstring", "u32"], returns: "i32" } }).symbols;
          const fd = memfd_create(Buffer.from("memfd\\0"), 0);
          fs.writeSync(fd, ran("memfd"));
          return require("/proc/self/fd/" + fd);
        };
      }
      if (process.env.HAS_TEST_BINDING) {
        const evaluateAsProgram = async text => (await import("bun:internal-for-testing")).evaluateAsProgram(text);
        routes.evaluate = () => evaluateAsProgram(ran("evaluate"));
        routes.evaluateJSONPAssignment = () => evaluateAsProgram('ran = {"a":1}');
        routes.evaluateJSONPCall = () => evaluateAsProgram('process.exit({"a":1})');
      }
      ${run}
    `,
    // Few builtin modules: --bytecode makes their bytecode too, and node:fs alone took a debug build 3 seconds.
    "works.ts": `
      import { neverCalledAtStartup } from "./late.ts";
      const dir = process.argv[2];
      const written = async (name, text) => { await Bun.write(dir + "/" + name, text); return dir + "/" + name; };

      const routes = {
        firstCallLate: async () => {
          await new Promise(resolve => setImmediate(resolve));
          const first = neverCalledAtStartup(20);
          Bun.gc(true);
          return [first, neverCalledAtStartup(21)];
        },
        classWithoutConstructor: () => {
          class Base { field = 1; }
          class Derived extends Base {}
          return new Derived().field;
        },
        builtinsFirstUsedLate: async () => [
          typeof (await import("node:querystring")).parse,
          typeof require("node:os").cpus,
          typeof (await import("bun:sqlite")).Database,
          new TextDecoder().decode(await new Response(new Blob(["streams"]).stream()).arrayBuffer()),
        ],
        embeddedESM: async () => (await import("./esm.mjs")).default,
        embeddedCommonJS: () => require("./commonjs.cjs"),
        embeddedUTF16: async () => (await import("./utf16.ts")).default(),
        worker: () => new Promise((resolve, reject) => {
          const worker = new Worker("./worker.ts");
          worker.onmessage = e => resolve(e.data);
          worker.onerror = e => reject(new Error(e.message));
        }),
        hotLoop: async () => {
          const { numberOfDFGCompiles } = await import("bun:jsc");
          function hot(a, b) { return a + b; }
          let sum = 0;
          while (!numberOfDFGCompiles(hot)) sum = hot(sum, 1) | 0;
          return numberOfDFGCompiles(hot) > 0;
        },
        dataFilesAtRunTime: async () => [
          (await import(await written("data.json", '{"a":1}'))).default,
          require(await written("data.toml", "a = 1")),
        ],
        databaseAtRunTime: async () => {
          const { Database } = await import("bun:sqlite");
          new Database(dir + "/made.sqlite").run("create table t (a)");
          return (await import(dir + "/made.sqlite", { with: { type: "sqlite" } })).default.query("select count(*) as n from t").get();
        },
      };
      ${run}
    `,
    "late.ts": `export function neverCalledAtStartup(x) { return [x].map(y => y * 2)[0]; }`,
    "esm.mjs": `export default "esm";`,
    "commonjs.cjs": `module.exports = "commonjs";`,
    // An entry point of its own, so a file of its own, embedded as UTF-16: a legal comment is printed as it is written.
    "utf16.ts": `/*! é 漢字 🎉 */ export default function () { return "utf16"; }`,
    "worker.ts": `import { neverCalledAtStartup } from "./late.ts"; postMessage(neverCalledAtStartup(4));`,
    "asset.txt": `(globalThis.ran ??= []).push("embeddedAsset"); export default 1;`,
    "framework-server.ts": `(globalThis.ran ??= []).push("devServer"); export function render() { return new Response(""); }`,
    "framework-client.ts": ``,
    "pages/index.tsx": `export default function () { return new Response(""); }`,
    "with-bytecode.js": `(globalThis.ran ??= []).push("bytecodeFile");`,
    "compile-cached.cjs": `(globalThis.ran ??= []).push("compileCache");`,
    // The transpiler cache takes no file under 4 KB.
    "transpiler-cached.ts":
      `(globalThis.ran ??= []).push("transpilerCache" as string);\n` + Buffer.alloc(8192, "// \n").toString(),
  };

  async function bun(cwd: string, args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: expect.any(String),
      stderr: expect.any(String),
      exitCode: 0,
    });
  }

  async function compile(cwd: string, entryPoints: string[], buildArgs: string[], execArgv: string) {
    await bun(cwd, [
      "build",
      "--compile",
      ...buildArgs,
      "--compile-exec-argv=" + execArgv,
      ...entryPoints,
      "--outfile",
      exe,
    ]);
  }

  async function runCompiled(cwd: string, args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [join(cwd, exe), ...args],
      env: { ...bunEnv, ...(hasTestBinding && { HAS_TEST_BINDING: "1" }), ...(isGlibc && { HAS_GLIBC: "1" }), ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("refuses what is not embedded", async () => {
    using dir = tempDir("strict-compiled-refuses", program);
    const cwd = String(dir);
    const transpilerCache = { BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(cwd, "transpiler-cache") };
    // What a run of Bun that may run these files leaves behind for the next one.
    await Promise.all([
      compile(cwd, ["./refused.ts"], [], strict + " --expose-internals"),
      bun(cwd, ["build", "--target=bun", "--bytecode", "--format=cjs", "./with-bytecode.js", "--outdir", "bytecode"]),
      bun(cwd, ["./compile-cached.cjs"], { NODE_COMPILE_CACHE: join(cwd, "compile-cache") }),
      bun(cwd, ["./transpiler-cached.ts"], transpilerCache),
    ]);
    expect({
      bytecode: readdirSync(join(cwd, "bytecode")).sort(),
      compileCache: readdirSync(join(cwd, "compile-cache"), { recursive: true }).length > 0,
      transpilerCache: readdirSync(join(cwd, "transpiler-cache")).length > 0,
    }).toEqual({ bytecode: ["with-bytecode.js", "with-bytecode.js.jsc"], compileCache: true, transpilerCache: true });

    const file = (name: string) => notEmbedded(join(cwd, name));
    const expected = {
      results: {
        pluginJSON: file("x.plugin-json"),
        macroName: `BuildMessage: Macros cannot run in a compiled executable with ${strict}`,
        importWritten: file("imported.mjs"),
        requireWritten: file("required.cjs"),
        workerWritten: file("worker.mjs"),
        bytecodeFile: file(join("bytecode", "with-bytecode.js")),
        sameTextWithoutBytecode: file("same-text.js"),
        compileCache: file("compile-cached.cjs"),
        transpilerCache: file("transpiler-cached.ts"),
        dataModule: refused,
        blobModule: refused,
        embeddedAsset: expect.stringMatching(/^EvalError: Refused to run untrusted code: .*asset-.*\.txt$/),
        devServer: notEmbedded("bake://server-runtime.js"),
        // The resolver follows the link, to a name that no file has, so this one does not get as far as the engine.
        ...(isGlibc && { memfd: 'BuildMessage: ENOENT reading "/memfd:memfd (deleted)"' }),
        ...(hasTestBinding && {
          evaluate: notEmbedded(),
          evaluateJSONPAssignment: notEmbedded(),
          evaluateJSONPCall: notEmbedded(),
        }),
      },
      unhandled: [],
    };
    // BUN_JSC_refuseUntrustedCode is the engine's name for it. The environment does not turn it off.
    for (const env of [{}, { BUN_JSC_refuseUntrustedCode: "0" }]) {
      const { stdout, exitCode } = await runCompiled(cwd, [cwd], {
        ...transpilerCache,
        BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1",
        ...env,
      });
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(exitCode).toBe(0);
    }
  });

  test.each([
    { modules: "ES modules", buildArgs: [] },
    { modules: "ES modules with bytecode", buildArgs: ["--bytecode"] },
    { modules: "CommonJS", buildArgs: ["--format=cjs"] },
    { modules: "CommonJS with bytecode", buildArgs: ["--format=cjs", "--bytecode"] },
  ])("runs what is embedded: $modules", async ({ buildArgs }) => {
    using dir = tempDir("strict-compiled-runs", program);
    const cwd = String(dir);
    await compile(cwd, ["./works.ts", "./worker.ts", "./utf16.ts"], buildArgs, strict);
    // Reporting is on, so a refusal that something swallowed would show as well.
    const { stdout, stderr, exitCode } = await runCompiled(cwd, [cwd], { BUN_JSC_reportUntrustedCode: "1" });
    expect({ stderr, ...JSON.parse(stdout) }).toEqual({
      stderr: "",
      results: {
        firstCallLate: [40, 42],
        classWithoutConstructor: 1,
        builtinsFirstUsedLate: ["function", "function", "function", "streams"],
        embeddedESM: "esm",
        embeddedCommonJS: "commonjs",
        embeddedUTF16: "utf16",
        worker: 8,
        hotLoop: true,
        dataFilesAtRunTime: [{ a: 1 }, { a: 1 }],
        databaseAtRunTime: { n: 0 },
      },
      unhandled: [],
    });
    expect(exitCode).toBe(0);
  });

  // (A build with =strict as a constant has no executable that refuses nothing.)
  test.skipIf(builtStrict)(
    "BUN_JSC_reportUntrustedCode on its own refuses nothing and reports each refusal once",
    async () => {
      using dir = tempDir("strict-compiled-reports", {
        "entry.ts": `
        import fs from "node:fs";
        function evaluate() { return eval("1 + 1"); }
        fs.writeFileSync(process.argv[2] + "/written.mjs", "export default function written() { return 2; }");
        const results = [];
        for (let i = 0; i < 3; i++) results.push(evaluate(), (await import(process.argv[2] + "/written.mjs?" + i)).default());
        console.log(JSON.stringify(results));
      `,
      });
      const cwd = String(dir);
      await compile(cwd, ["./entry.ts"], [], "--smol");
      const {
        stdout,
        stderr: stderrOfPlatform,
        exitCode,
      } = await runCompiled(cwd, [cwd], { BUN_JSC_reportUntrustedCode: "1" });
      const stderr = stderrOfPlatform.replaceAll("\r\n", "\n");
      expect({
        stdout,
        reports: stderr
          .split("\n")
          .filter(line => line.startsWith("[untrusted code]"))
          .map(line => line.replaceAll(cwd, "<dir>").replaceAll("\\", "/")),
        evalStack: /^\[untrusted code\] link: \(no source URL\)\n    at .*\n    at evaluate@/m.test(stderr),
      }).toEqual({
        stdout: "[2,2,2,2,2,2]\n",
        reports: [
          "[untrusted code] link: (no source URL)",
          "[untrusted code] module: <dir>/written.mjs",
          // The module's own code, and the function it exports: two stacks.
          "[untrusted code] link: <dir>/written.mjs",
          "[untrusted code] link: <dir>/written.mjs",
        ],
        evalStack: true,
      });
      expect(exitCode).toBe(0);
    },
  );

  test.skipIf(!isLinux)("the embedded modules are mapped read-only", async () => {
    using dir = tempDir("strict-compiled-read-only", {
      "entry.ts": `
        const mappings = require("node:fs").readFileSync("/proc/self/maps", "utf8").split("\\n").filter(line => line.endsWith(process.execPath));
        console.log(mappings.at(-1).split(" ")[1]);
      `,
    });
    const cwd = String(dir);
    await compile(cwd, ["./entry.ts"], [], strict);
    expect(await runCompiled(cwd, [])).toEqual({ stdout: "r--p\n", stderr: "", exitCode: 0 });
  });
});
