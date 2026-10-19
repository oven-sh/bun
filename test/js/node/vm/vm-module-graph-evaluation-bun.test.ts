// What module.evaluate() of node:vm does in Bun where Node v26.3.0 does something that Bun does not copy, or has
// nothing to compare with (`import defer`, bun:jsc). vm-module-graph-evaluation.test.ts has what Node does the same.
import { drainMicrotasks, heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, expectMaxObjectTypeCount, isASAN, isDebug, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

type Module = vm.SourceTextModule | vm.SyntheticModule;

// `contextOptions` null: modules without a context, whose code sees the globals of this file.
function graph(
  sources: Record<string, string>,
  host: Record<string, unknown> = {},
  contextOptions: object | null = {},
) {
  const log: unknown[] = [];
  host = { log: (entry: unknown) => void log.push(entry), ...host };
  const context = contextOptions === null ? undefined : vm.createContext(host, contextOptions);
  if (!context) Object.assign(globalThis, host);
  const modules: Record<string, Module> = {};
  for (const [identifier, source] of Object.entries(sources))
    modules[identifier] = new vm.SourceTextModule(source, { identifier, context });
  const linker = (specifier: string) => modules[specifier];
  return {
    log,
    context,
    modules,
    linker,
    link: (root = Object.keys(sources)[0]) => (modules[root] as vm.SourceTextModule).link(linker),
    statuses: () => Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status])),
    synthetic(identifier: string, exportNames: string[], evaluateCallback: (module: vm.SyntheticModule) => void) {
      const module: vm.SyntheticModule = new vm.SyntheticModule(exportNames, () => evaluateCallback(module), {
        identifier,
        context,
      });
      return (modules[identifier] = module);
    },
  };
}

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("the promise did not reject");
    },
    (error: any) => error,
  );
const thrownBy = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as any;
  }
  throw new Error("the function did not throw");
};
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const afterEvaluate = { microtaskMode: "afterEvaluate" };
const kinds = {
  "the main context": null,
  "a context": {},
  "an afterEvaluate context": afterEvaluate,
} as const;
type Kind = keyof typeof kinds;
const everyKind = Object.keys(kinds) as Kind[];

async function runWith(env: Record<string, string>, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
const run = (...args: string[]) => runWith({}, ...args);
const runProgram = (program: string) => run("-e", program);

// The vm pools of Vitest make a vm.SourceTextModule for each file of a dependency and evaluate the entry. With one
// Evaluate() for each dependency, index.js ran before helper.js: "Cannot access 'helper' before initialization."
// Not on a debug build, which needs 30 to 40 s for one run of Vitest.
describe.skipIf(isDebug)("Vitest", () => {
  const testNodeModules = join(import.meta.dir, "..", "..", "..", "node_modules");

  // On Windows, Vitest's vm pools do not find the packages that Vitest imports ("Cannot find package
  // '@vitest/spy' imported from file:///C:/..."): import.meta.resolve(specifier, parent) fails there (#40931).
  test.todoIf(isWindows).each(["vmForks", "vmThreads"])(
    "the %s pool runs a test that imports a package with an import cycle",
    async pool => {
      using dir = tempDir("vm-module-graph-vitest", {
        "package.json": JSON.stringify({ name: "vitest-fixture", private: true, type: "module" }),
        "vitest.config.js": `export default { test: { watch: false, cache: false } };`,
        "cycle.test.js": `
          import { expect, test } from "vitest";
          import { x } from "cyclic";
          test("the package is evaluated", () => {
            expect(x).toBe(2);
          });
        `,
        "node_modules/cyclic/package.json": JSON.stringify({
          name: "cyclic",
          version: "1.0.0",
          type: "module",
          exports: "./index.js",
        }),
        "node_modules/cyclic/index.js": `import { helper } from "./helper.js"; export const base = 1; export const x = helper();`,
        "node_modules/cyclic/helper.js": `import { base } from "./index.js"; export const helper = () => base + 1;`,
      });
      symlinkSync(join(testNodeModules, "vitest"), join(String(dir), "node_modules", "vitest"), "junction");
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "node_modules", "vitest", "vitest.mjs"), "--run", `--pool=${pool}`],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ exitCode, stderr: exitCode === 0 ? "" : stderr, stdout }).toMatchObject({
        exitCode: 0,
        stderr: "",
        stdout: expect.stringMatching(/Test Files\s+1 passed/),
      });
    },
    90_000,
  );
});

// A timeout or a SIGINT stops module code where it is. Node v26.3.0 leaves such a module as V8 does. A module on
// the stack of the walk is "errored" with the error `null`, and a module that a job resumed after a top-level
// await stays "evaluated". Its evaluate() never settles. When a job started the body, the process aborts on a
// CHECK of V8. In Bun the run that was cut short gives its error to every module that it stopped.
//
// vm-module-graph-cut-short-fixture.js has the scenarios. They run in a child: the code that a timeout must stop
// has no end of its own. One child at a time: a scenario tries again when its deadline passed before the code
// that it is about, and children that share a processor make that the rule.
describe("a timeout stops module code", () => {
  const fixture = join(import.meta.dir, "vm-module-graph-cut-short-fixture.js");
  const code = "ERR_SCRIPT_EXECUTION_TIMEOUT";
  const everyModuleOf = (...names: string[]) => Object.fromEntries(names.map(name => [name, "errored"]));

  async function scenarios(expected: Record<string, unknown>, env: Record<string, string> = {}) {
    const result = await runWith(env, fixture, ...Object.keys(expected));
    const lines = result.stdout.split("\n").map(line => (line.startsWith("{") ? JSON.parse(line) : line));
    expect({ ...result, stdout: Object.assign({}, ...lines) }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  }

  test("in the walk of Evaluate(): every module on the way to it gets the error of the run", async () => {
    await scenarios({
      "body": {
        code,
        stopped: { log: ["b"], statuses: { a: "errored", b: "errored", c: "linked" }, sameError: true },
        again: true,
        log: ["b", "c"],
      },
      "cycle": { code, log: ["c", "b"], statuses: everyModuleOf("a", "b", "c"), sameError: true },
      "cycle with a module that waits at a top-level await": {
        code,
        log: ["t1", "x"],
        statuses: everyModuleOf("a", "t", "x"),
        sameError: true,
      },
      "evaluateCallback": {
        code,
        log: ["b", "s"],
        statuses: { a: "errored", b: "evaluated", s: "errored" },
        sameError: true,
      },
      "evaluateCallback of the module that evaluate() is called on": {
        code,
        log: ["s"],
        statuses: { s: "errored" },
        sameError: true,
      },
      "Script around evaluate(): body": {
        code,
        returned: false,
        log: ["b"],
        statuses: everyModuleOf("a", "b"),
        sameError: true,
      },
      "Script around evaluate(): evaluateCallback": {
        code,
        log: ["s"],
        statuses: everyModuleOf("a", "s"),
        sameError: true,
      },
      "deferred module that a Script reads first": {
        code,
        stopped: { log: ["a", "b"], statuses: { a: "evaluated", b: "errored", c: "linked" }, sameError: true },
        again: true,
        log: ["a", "b"],
      },
      "evaluate() with a timeout from a body that a job resumed": {
        code,
        log: ["x1", "x2", "spin", "x3", "x4"],
        statuses: { x: "evaluated", y: "errored", spin: "errored" },
        sameError: true,
      },
      "run with a timeout from a body: the jobs that it queues run inside it": {
        nested: code,
        log: ["m1", "job", "m2"],
        statuses: { m: "evaluated" },
      },
    });
  });

  // The code returns, and JSC raises the termination in its walk, after the body or the evaluateCallback.
  test("in a native call at the end of the code", async () => {
    const body = { code, log: ["c"], statuses: everyModuleOf("a", "b", "c"), sameError: true, again: true };
    await scenarios({
      "body that ends in a native call": Object.fromEntries(everyKind.map(kind => [kind, body])),
      "evaluateCallback that ends in a native call": {
        code,
        log: ["s"],
        statuses: everyModuleOf("a", "s"),
        sameError: true,
      },
      "Script around evaluate(): evaluateCallback that ends in a native call": {
        code,
        log: ["s"],
        statuses: everyModuleOf("a", "s"),
        sameError: true,
      },
      "deferred module that ends in a native call, read by a Script": {
        code,
        log: ["a", "b"],
        statuses: { a: "evaluated", b: "errored" },
        sameError: true,
      },
      "a later run that is cut short changes no error of an earlier one": {
        messages: ["Script execution timed out after 10ms", "Script execution timed out after 20ms"],
        sameError: true,
        statuses: everyModuleOf("a", "b"),
      },
      "a module that threw the value of a termination keeps it": { value: "string", kept: true, codes: [code, code] },
      "two runs that are cut short, one inside the other": {
        messages: ["Script execution timed out after 20ms", "Script execution timed out after 10ms"],
        statuses: { root: "errored", x: "evaluated" },
      },
    });
  });

  test("anywhere in the walk of a wide graph", async () => {
    await scenarios(
      { "wide graph: the deadline lands anywhere in the walk": ["ok"] },
      { VM_MODULE_GRAPH_LEAVES: isDebug || isASAN ? "100" : "5000" },
    );
  });

  // How JSC delivers a termination to running code depends on these. Polling is the only mode on Windows.
  test.each(["BUN_JSC_usePollingTraps", "BUN_JSC_useJIT"])("with %s set to its other value", async option => {
    const everyModule = { code, log: ["c"], statuses: everyModuleOf("a", "b", "c"), sameError: true, again: true };
    await scenarios(
      {
        "cycle": { code, log: ["c", "b"], statuses: everyModuleOf("a", "b", "c"), sameError: true },
        "body that ends in a native call": Object.fromEntries(everyKind.map(kind => [kind, everyModule])),
        "job: body after its top-level await": {
          code,
          log: ["b1", "c", "b2"],
          statuses: { a: "errored", b: "errored", c: "evaluated" },
          sameError: true,
        },
      },
      { [option]: option === "BUN_JSC_useJIT" ? "0" : "1" },
    );
  });

  // In an afterEvaluate context the timeout also bounds the microtask checkpoint of the run, and a job of that
  // checkpoint can resume a module body.
  test("in a job of the checkpoint of an afterEvaluate context", async () => {
    await scenarios({
      "job: body after its top-level await": {
        code,
        log: ["b1", "c", "b2"],
        statuses: { a: "errored", b: "errored", c: "evaluated" },
        sameError: true,
      },
      "job: body in the job that ends the await of its dependency": {
        code,
        log: ["t1", "t2", "b"],
        statuses: { a: "errored", b: "errored", c: "errored", t: "evaluated" },
        sameError: true,
      },
      "job: a module that waits, or waits for a module that waits, is not stopped": {
        code,
        stopped: { log: ["w1", "b1", "b2"], statuses: { a: "errored", c: "evaluated", w: "evaluated", b: "errored" } },
        later: "undefined",
        log: ["w1", "b1", "b2", "w2", "c"],
        statuses: { a: "errored", c: "evaluated", w: "evaluated", b: "errored" },
      },
      "job: module of another graph that the checkpoint resumed": {
        code,
        log: ["p1", "q", "p2"],
        statuses: { ip: "errored", p: "errored", q: "evaluated" },
        sameError: true,
      },
      "job: checkpoint of a Script": { code, log: ["p1", "p2"], statuses: everyModuleOf("ip", "p"), sameError: true },
      "job: Script around evaluate()": { code, log: ["b1", "b2"], statuses: everyModuleOf("a", "b"), sameError: true },
      "job that is not of a module": { code, statuses: { a: "evaluated" }, later: "undefined" },
      "job: body that ended before the job that was stopped": {
        code,
        log: ["x1", "x2", "job of x"],
        statuses: { r: "errored", x: "evaluated" },
        sameError: true,
        x: "undefined",
      },
      "job: body that threw before the job that was stopped": {
        code,
        log: ["x1", "job of x"],
        statuses: everyModuleOf("r", "x"),
        messages: ["from x", "from x"],
        sameError: true,
      },
      "job: two roots that wait for the module that was stopped": {
        "p1 created first": ["p1", "p2"],
        "p2 created first": ["p1", "p2"],
      },
      "job: two roots that were to run in the job that was stopped": {
        "p1 created first": ["p1", "p2"],
        "p2 created first": ["p1", "p2"],
      },
      "walk that the timeout stops does no checkpoint": { code, stopped: ["b"], again: true, log: ["b", "job of b"] },
    });
  });

  test("in a job, behind the end of a body: only the modules that the job was to run are stopped", async () => {
    await scenarios({
      "job: module that waits for a second module is not stopped": {
        code,
        stopped: { p: "evaluated", x: "evaluated", y: "evaluated" },
        first: "undefined",
        log: ["x1", "y1", "x2", "job", "y2", "p"],
      },
      "job: module on the stack of a walk that the stopped job was to run": {
        code,
        log: ["x1", "h1", "x2", "job", "h2"],
        statuses: { root: "errored", q: "errored", x: "evaluated", h: "evaluated" },
        sameError: true,
      },
      "job: modules that finished inside a walk are not stopped by a later run": {
        code,
        log: ["t1", "m1", "c1", "t2", "m2", "p", "c2", "root", "job"],
        statuses: { root: "evaluated", p: "evaluated", m: "evaluated", t: "evaluated", c: "evaluated" },
      },
    });
  });

  // JSC drops the jobs behind the job that it stops. The module that the call was on has the error of the run
  // (#38660). A module that still waits is "evaluated", and when the job that was to resume it was one of the
  // dropped jobs, its evaluate() never settles, as in Node. The same holds for a module that a job of the main
  // queue ran inside the run: node:vm starts no checkpoint of that queue, so it does not see one that is stopped.
  test("a module that still waits when the run is cut short", async () => {
    const ofTheMainQueue = {
      code,
      log: ["p1", "x", "p2"],
      statuses: { root: "errored", x: "errored", p: "evaluated" },
      errors: { root: code, x: code },
      first: "pending",
    };
    await scenarios({
      "job: module that waits at a top-level await when its resuming job is dropped": {
        code,
        log: ["s", "x1", "job of s"],
        statuses: { r: "errored", s: "evaluated", x: "evaluated" },
        settled: false,
      },
      "job of the main queue": { "the main context": ofTheMainQueue, "a context": ofTheMainQueue },
    });
  });
});

describe("a SIGINT stops module code", () => {
  // The child sends itself the signal from the code that must be interrupted, and then does not return.
  const prelude = `
    const vm = require("node:vm");
    const log = [];
    const interrupt = where => {
      log.push(where);
      process.kill(process.pid, "SIGINT");
      for (;;) {}
    };
    const rejection = promise => promise.then(() => { throw new Error("the promise did not reject"); }, error => error);
  `;

  test.concurrent.skipIf(isWindows)("in a module body", async () => {
    const result = await runProgram(`${prelude}
      const context = vm.createContext({ interrupt });
      const a = new vm.SourceTextModule('import "b";', { context });
      const b = new vm.SourceTextModule('interrupt("b");', { context });
      (async () => {
        await a.link(() => b);
        const error = await rejection(a.evaluate({ breakOnSigint: true }));
        console.log(JSON.stringify({
          log: [...log],
          code: error.code,
          statuses: [a.status, b.status],
          sameError: a.error === error && b.error === error,
          again: (await rejection(a.evaluate())) === error,
        }));
      })();
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        log: ["b"],
        code: "ERR_SCRIPT_EXECUTION_INTERRUPTED",
        statuses: ["errored", "errored"],
        sameError: true,
        again: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.skipIf(isWindows)("in an evaluateCallback", async () => {
    const result = await runProgram(`${prelude}
      const context = vm.createContext({});
      const a = new vm.SourceTextModule('import "s";', { context });
      const s = new vm.SyntheticModule([], () => interrupt("s"), { context });
      (async () => {
        await a.link(() => s);
        const error = await rejection(a.evaluate({ breakOnSigint: true }));
        console.log(JSON.stringify({
          log: [...log],
          code: error.code,
          statuses: [a.status, s.status],
          sameError: a.error === error && s.error === error,
        }));
      })();
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        log: ["s"],
        code: "ERR_SCRIPT_EXECUTION_INTERRUPTED",
        statuses: ["errored", "errored"],
        sameError: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.skipIf(isWindows)("in a job of an afterEvaluate context", async () => {
    const result = await runProgram(`${prelude}
      const context = vm.createContext({ interrupt }, { microtaskMode: "afterEvaluate" });
      const a = new vm.SourceTextModule('import "b";', { context });
      const b = new vm.SourceTextModule('await 0; interrupt("b after its await");', { context });
      (async () => {
        await a.link(() => b);
        const error = await rejection(a.evaluate({ breakOnSigint: true }));
        console.log(JSON.stringify({
          log: [...log],
          code: error.code,
          statuses: [a.status, b.status],
          sameError: a.error === error && b.error === error,
        }));
      })();
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        log: ["b after its await"],
        code: "ERR_SCRIPT_EXECUTION_INTERRUPTED",
        statuses: ["errored", "errored"],
        sameError: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  // The body returns, and JSC raises the termination in its walk.
  test.concurrent.skipIf(isWindows)("in a native call at the end of a module body", async () => {
    const result = await runProgram(`${prelude}
      // A signal that arrives after the native call returned, when no run listens any more.
      let late = 0;
      process.on("SIGINT", () => late++);
      (async () => {
        for (let sleep = 100; sleep <= 3200; sleep *= 2) {
          log.length = 0;
          const context = vm.createContext({
            interruptInNativeCall: () => {
              log.push("b");
              process.kill(process.pid, "SIGINT");
              Bun.sleepSync(sleep);
            },
          });
          const a = new vm.SourceTextModule('import "b";', { context });
          const b = new vm.SourceTextModule("interruptInNativeCall();", { context });
          await a.link(() => b);
          const seen = late;
          const error = await a.evaluate({ breakOnSigint: true }).then(() => undefined, error => error);
          if (!error) {
            while (late === seen) await new Promise(resolve => setImmediate(resolve));
            continue;
          }
          console.log(JSON.stringify({
            log: [...log],
            code: error.code,
            statuses: [a.status, b.status],
            sameError: a.error === error && b.error === error,
            again: (await rejection(a.evaluate())) === error,
          }));
          return;
        }
      })();
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        log: ["b"],
        code: "ERR_SCRIPT_EXECUTION_INTERRUPTED",
        statuses: ["errored", "errored"],
        sameError: true,
        again: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.skipIf(isWindows)("in a module body of a Worker, sent by the main thread", async () => {
    const worker = `
      const { parentPort } = require("node:worker_threads");
      const vm = require("node:vm");
      const context = vm.createContext({ ready: () => parentPort.postMessage("ready") });
      const a = new vm.SourceTextModule('import "b";', { context });
      const b = new vm.SourceTextModule("ready(); for (;;) {}", { context });
      (async () => {
        await a.link(() => b);
        const error = await a.evaluate({ breakOnSigint: true }).then(() => undefined, error => error);
        parentPort.postMessage({
          code: error && error.code,
          statuses: [a.status, b.status],
          sameError: a.error === error && b.error === error,
        });
      })();
    `;
    const result = await runProgram(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(${JSON.stringify(worker)}, { eval: true });
      worker.on("message", message => {
        if (message === "ready") process.kill(process.pid, "SIGINT");
        else console.log(JSON.stringify(message));
      });
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        code: "ERR_SCRIPT_EXECUTION_INTERRUPTED",
        statuses: ["errored", "errored"],
        sameError: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });
});

// The run gives its error to the modules before it throws. That step runs no code of the program: a
// process.nextTick callback and a job of the main queue run after the run threw, as in Node.
test("a run that is cut short runs no tick and no job of the main queue before it throws", async () => {
  const result = await runProgram(`
    const vm = require("node:vm");
    const turn = () => new Promise(resolve => setImmediate(resolve));
    async function attempt() {
      let open;
      const gate = new Promise(resolve => (open = resolve));
      const seen = {};
      const context = vm.createContext({ gate, reached: () => (seen.reached = true) }, { microtaskMode: "afterEvaluate" });
      const p = new vm.SourceTextModule("await gate; reached(); for (;;) {}", { context });
      await p.link(() => {});
      p.evaluate().catch(error => (seen.first = error.code));
      open();
      await turn();
      let inside = true;
      // In the first attempt, this is the first process.nextTick() of the process. It starts a run with a
      // timeout of its own.
      process.nextTick(() => {
        seen.tickInsideTheRun = inside;
        try {
          vm.runInNewContext("for (;;) {}", {}, { timeout: 10 });
        } catch (error) {
          seen.runInTheTick = error.code;
        }
      });
      Promise.resolve().then(() => (seen.jobInsideTheRun = inside));
      try {
        vm.runInContext("0", context, { timeout: 50 });
      } catch (error) {
        seen.run = error.code;
      }
      inside = false;
      seen.status = p.status;
      await turn();
      return seen;
    }
    (async () => {
      // The deadline can pass before the checkpoint resumes p. The test is about a run that reached the loop of p.
      for (let i = 0; i < 100; i++) {
        const { reached, run, status, tickInsideTheRun, runInTheTick, jobInsideTheRun, first } = await attempt();
        if (!reached) continue;
        console.log(JSON.stringify({ run, status, tickInsideTheRun, runInTheTick, jobInsideTheRun, first }));
        return;
      }
    })();
  `);
  expect(result).toEqual({
    stdout: JSON.stringify({
      run: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      status: "errored",
      tickInsideTheRun: false,
      runInTheTick: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      jobInsideTheRun: false,
      first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
    }),
    stderr: "",
    exitCode: 0,
  });
});

// Node v26.3.0 runs a module that imports such a SyntheticModule later, with the exports that the callback set,
// and then reports a rejected promise of V8 that no program can reach. In Bun the SyntheticModule has its error
// for every module that imports it, as ECMA-262 says for a module that failed.
describe("a SyntheticModule whose evaluateCallback threw", () => {
  test("a module that imports it and is evaluated later does not run: it rejects with that error", async () => {
    const result = await runProgram(`
      const vm = require("node:vm");
      const s = new vm.SyntheticModule(["x"], function () {
        this.setExport("x", 1);
        throw new Error("from s");
      });
      const a = new vm.SourceTextModule('import { x } from "s"; globalThis.ran = "a " + x;');
      (async () => {
        await a.link(() => s);
        const outcomes = [];
        for (const module of [s, a, a])
          outcomes.push(await module.evaluate().then(() => "fulfilled", error => "rejected: " + error.message));
        await new Promise(resolve => setImmediate(resolve));
        console.log(JSON.stringify({
          outcomes,
          ran: globalThis.ran,
          statuses: [s.status, a.status],
          sameError: s.error === a.error,
        }));
      })();
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        outcomes: ["rejected: from s", "rejected: from s", "rejected: from s"],
        statuses: ["errored", "errored"],
        sameError: true,
      }),
      stderr: "",
      exitCode: 0,
    });
  });
});

// Node v26.3.0 aborts here on a CHECK of V8.
describe("evaluate() of a member of a cycle that ran as a dependency, after its cycle failed", () => {
  const kinds = {
    "the main context": "undefined",
    "a context": "vm.createContext({})",
    "an afterEvaluate context": 'vm.createContext({}, { microtaskMode: "afterEvaluate" })',
  };
  test.concurrent.each(Object.keys(kinds) as (keyof typeof kinds)[])(
    "in %s it rejects with the error of the cycle, and nothing is reported",
    async kind => {
      const result = await runProgram(`
        const vm = require("node:vm");
        const context = ${kinds[kind]};
        const modules = {};
        const define = (identifier, source) =>
          (modules[identifier] = new vm.SourceTextModule(source, { identifier, context }));
        define("r", 'import "a";');
        define("a", 'import "b"; await 0; throw new Error("from a");');
        define("b", 'import "a";');
        (async () => {
          await modules.r.link(specifier => modules[specifier]);
          const outcomes = [];
          await modules.r.evaluate().catch(error => outcomes.push("r: " + error.message));
          await modules.b.evaluate().catch(error => outcomes.push("b: " + error.message));
          await modules.b.evaluate().catch(error => outcomes.push("b again: " + error.message));
          await new Promise(resolve => setImmediate(resolve));
          console.log(JSON.stringify({ outcomes, statuses: Object.values(modules).map(module => module.status) }));
        })();
      `);
      expect(result).toEqual({
        stdout: JSON.stringify({
          outcomes: ["r: from a", "b: from a", "b again: from a"],
          statuses: ["errored", "errored", "evaluated"],
        }),
        stderr: "",
        exitCode: 0,
      });
    },
  );
});

// Node lets the body go on after the await, so it logs "t2" and "t finally" in each of these tests. JSC gives up
// the code of a module that gets an error (CyclicModuleRecord::setEvaluationError), and t gets the error of its
// cycle while it waits. The fixture of the timeouts has the case where a timeout stops the later member.
describe("a module that waits at a top-level await when its cycle fails does not run the rest of its body", () => {
  const t = `import "a"; log("t1"); try { await 0; log("t2"); } finally { log("t finally"); }`;

  test("a later member of the cycle throws", async () => {
    const g = graph({ a: `import "t"; import "x"; log("a");`, t, x: `log("x"); throw new Error("from x");` });
    await g.link();
    expect((await rejection(g.modules.a.evaluate())).message).toBe("from x");
    await turn();
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["t1", "x"],
      statuses: { a: "errored", t: "errored", x: "errored" },
    });
  });

  test("an evaluateCallback that the cycle imports throws", async () => {
    const g = graph({ a: `import "t"; import "s"; log("a");`, t });
    g.synthetic("s", [], () => {
      g.log.push("s");
      throw new Error("from s");
    });
    await g.link();
    expect((await rejection(g.modules.a.evaluate())).message).toBe("from s");
    await turn();
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["t1", "s"],
      statuses: { a: "errored", t: "errored", s: "errored" },
    });
  });
});

// ECMA-262 has no job that runs while a graph is evaluated. Module code can run one: a run of an afterEvaluate
// context does its checkpoint at once, as in Node, and Bun has functions that drain the main queue. Such a job can
// finish a module while the walk of Evaluate() still has a module that imports it on its stack. In Node v26.3.0
// that importer then never runs, and its evaluate() does not settle. In Bun it runs where the walk reaches it.
describe("a job that finishes a module while its graph is evaluated", () => {
  const drainOf = (kind: Kind, context: () => vm.Context | undefined) =>
    kind === "an afterEvaluate context" ? () => void vm.runInContext("0", context()!) : () => void drainMicrotasks();

  describe.each(everyKind)("in %s", kind => {
    test("from a module body", async () => {
      const g = graph(
        {
          r: `import "t"; import "x"; log("r");`,
          t: `log("t1"); await 0; log("t2");`,
          x: `log("x1"); drain(); log("x2");`,
        },
        { drain: drainOf(kind, () => g.context) },
        kinds[kind],
      );
      await g.link();
      expect(await g.modules.r.evaluate()).toBeUndefined();
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["t1", "x1", "t2", "x2", "r"],
        statuses: { r: "evaluated", t: "evaluated", x: "evaluated" },
      });
    });

    test("from an evaluateCallback", async () => {
      const g = graph({ r: `import "t"; import "x"; log("r");`, t: `log("t1"); await 0; log("t2");` }, {}, kinds[kind]);
      const drain = drainOf(kind, () => g.context);
      g.synthetic("x", [], () => {
        g.log.push("x1");
        drain();
        g.log.push("x2");
      });
      await g.link();
      expect(await g.modules.r.evaluate()).toBeUndefined();
      expect(g.log).toEqual(["t1", "x1", "t2", "x2", "r"]);
    });

    test("from an initializeImportMeta", async () => {
      const g = graph({ r: `import "t"; import "x"; log("r");`, t: `log("t1"); await 0; log("t2");` }, {}, kinds[kind]);
      const drain = drainOf(kind, () => g.context);
      g.modules.x = new vm.SourceTextModule(`import.meta; log("x");`, {
        identifier: "x",
        context: g.context,
        initializeImportMeta() {
          g.log.push("x1");
          drain();
          g.log.push("x2");
        },
      });
      await g.link();
      expect(await g.modules.r.evaluate()).toBeUndefined();
      expect(g.log).toEqual(["t1", "x1", "t2", "x2", "x", "r"]);
    });

    test("a job that rejects the module: the module that imports it does not run", async () => {
      const g = graph(
        {
          r: `import "t"; import "x"; log("r");`,
          t: `log("t1"); await 0; log("t2"); throw new Error("from t");`,
          x: `log("x1"); drain(); log("x2");`,
        },
        { drain: drainOf(kind, () => g.context) },
        kinds[kind],
      );
      await g.link();
      const error = await rejection(g.modules.r.evaluate());
      expect({ message: error.message, log: g.log, statuses: g.statuses() }).toEqual({
        message: "from t",
        log: ["t1", "x1", "t2", "x2"],
        statuses: { r: "errored", t: "errored", x: "evaluated" },
      });
      expect(g.modules.r.error).toBe(error);
    });
  });

  test("evaluate() of another module of the context from an evaluateCallback", async () => {
    const g = graph(
      { r: `import "t"; import "s"; log("r");`, t: `log("t1"); await 0; log("t2");`, other: `log("other");` },
      {},
      afterEvaluate,
    );
    let inner: Promise<unknown> | undefined;
    g.synthetic("s", [], () => {
      g.log.push("s start");
      inner = g.modules.other.evaluate();
      g.log.push("s end");
    });
    await g.link();
    await g.link("other");
    expect(await g.modules.r.evaluate()).toBeUndefined();
    expect(await inner).toBeUndefined();
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["t1", "s start", "other", "t2", "s end", "r"],
      statuses: { r: "evaluated", t: "evaluated", other: "evaluated", s: "evaluated" },
    });
  });

  // The importer is on the stack of the walk in a cycle that is not closed, or a later module of the walk imports
  // the module that the job finished or failed.
  test.each(everyKind)("in %s, with cycles that are not closed when the job runs", async kind => {
    const t = `log("t1"); await 0; log("t2");`;
    const c = `log("c1"); drain(); log("c2");`;
    const graphs: Record<string, Record<string, string>> = {
      "the job runs an importer that waits on the stack": {
        root: `import "p"; import "c"; import "y"; log("root");`,
        p: `import "root"; import "t"; log("p");`,
        y: `import "p"; log("y");`,
        t,
        c,
      },
      "a member of the cycle ends its own body in the job": {
        root: `import "m"; import "c"; import "y"; log("root");`,
        m: `import "root"; log("m1"); await 0; log("m2");`,
        y: `import "m"; log("y");`,
        c,
      },
      "two modules that the root waits for fail in the job: the first error is the error of the root": {
        root: `import "t"; import "u"; import "c"; log("root");`,
        t: `log("t1"); await 0; log("t2"); throw new Error("from t");`,
        u: `log("u1"); await 0; await 0; log("u2"); throw new Error("from u");`,
        c,
      },
      "a body of the walk throws after the job failed a module: the walk fails with what the body threw": {
        root: `import "t"; import "c"; log("root");`,
        t: `log("t1"); await 0; log("t2"); throw new Error("from t");`,
        c: `log("c1"); drain(); log("c2"); throw new Error("from c");`,
      },
    };
    const results: Record<string, unknown> = {};
    for (const [name, sources] of Object.entries(graphs)) {
      const g = graph(sources, { drain: drainOf(kind, () => g.context) }, kinds[kind]);
      await g.link();
      const outcome = await g.modules.root.evaluate().then(
        () => "fulfilled",
        error => "rejected: " + error.message,
      );
      results[name] = [outcome, g.log.join(" "), Object.values(g.statuses()).join(" ")];
    }
    expect(results).toEqual({
      "the job runs an importer that waits on the stack": [
        "fulfilled",
        "t1 c1 t2 p c2 y root",
        "evaluated evaluated evaluated evaluated evaluated",
      ],
      "a member of the cycle ends its own body in the job": [
        "fulfilled",
        "m1 c1 m2 c2 y root",
        "evaluated evaluated evaluated evaluated",
      ],
      "two modules that the root waits for fail in the job: the first error is the error of the root": [
        "rejected: from t",
        "t1 u1 c1 t2 u2 c2",
        "errored errored errored evaluated",
      ],
      "a body of the walk throws after the job failed a module: the walk fails with what the body threw": [
        "rejected: from c",
        "t1 c1 t2 c2",
        "errored errored errored",
      ],
    });
  });

  // The job of t runs the body of s, which has no top-level await. A job inside that body finishes x, the other
  // module that r waits for. r runs when the body of s has ended, and not at all when that body throws. A context
  // with its own queue starts no checkpoint inside a job, so it has no such case.
  describe.each(["the main context", "a context"] as const)(
    "in %s, inside a body that the job of a module runs",
    kind => {
      const sources = (s: string) => ({
        r: `import "x"; import "s"; log("r");`,
        x: `import "t"; log("x1"); await 0; log("x2");`,
        s,
        t: `log("t1"); await 0; log("t2");`,
      });

      test("the module that waits for both runs after that body", async () => {
        const g = graph(sources(`import "t"; log("s1"); drain(); log("s2");`), { drain: drainMicrotasks }, kinds[kind]);
        await g.link();
        expect(await g.modules.r.evaluate()).toBeUndefined();
        expect(g.log).toEqual(["t1", "t2", "x1", "s1", "x2", "s2", "r"]);
      });

      test("the module that waits for both does not run when that body throws", async () => {
        const g = graph(
          sources(`import "t"; log("s1"); drain(); log("s2"); throw new Error("from s");`),
          { drain: drainMicrotasks },
          kinds[kind],
        );
        await g.link();
        const error = await rejection(g.modules.r.evaluate());
        expect({ message: error.message, log: g.log, statuses: g.statuses() }).toEqual({
          message: "from s",
          log: ["t1", "t2", "x1", "s1", "x2", "s2"],
          statuses: { r: "errored", x: "evaluated", s: "errored", t: "evaluated" },
        });
      });
    },
  );

  // The rule is JavaScriptCore's, and the ES modules of a program need it too.
  describe("in the ES modules of a program", () => {
    const main = `
      let outcome = "pending";
      process.on("exit", () => console.log(outcome));
      import("./r.mjs").then(
        () => (outcome = "fulfilled"),
        error => (outcome = "rejected: " + error.message),
      );
    `;
    const t = `console.log("t1"); await 0; console.log("t2");`;
    const x = `import { drainMicrotasks } from "bun:jsc"; console.log("x1"); drainMicrotasks(); console.log("x2");`;

    test("the module that imports it runs", async () => {
      using dir = tempDir("vm-module-graph-job", {
        "main.mjs": main,
        "r.mjs": `import "./t.mjs"; import "./x.mjs"; console.log("r");`,
        "t.mjs": t,
        "x.mjs": x,
      });
      expect(await run(join(String(dir), "main.mjs"))).toEqual({
        stdout: "t1\nx1\nt2\nx2\nr\nfulfilled",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a job that rejects the module, in a cycle that is not closed: the import rejects with that error", async () => {
      using dir = tempDir("vm-module-graph-job", {
        "main.mjs": main,
        "r.mjs": `import "./a.mjs"; console.log("r");`,
        "a.mjs": `import "./t.mjs"; import "./x.mjs"; import "./r.mjs"; console.log("a");`,
        "t.mjs": `console.log("t1"); await 0; console.log("t2"); throw new Error("from t");`,
        "x.mjs": x,
      });
      expect(await run(join(String(dir), "main.mjs"))).toEqual({
        stdout: "t1\nx1\nt2\nx2\nrejected: from t",
        stderr: "",
        exitCode: 0,
      });
    });

    test("inside a body that the job of a module runs: the module that waits for both does not run early", async () => {
      using dir = tempDir("vm-module-graph-job", {
        "main.mjs": main,
        "r.mjs": `import "./w.mjs"; import "./s.mjs"; console.log("r");`,
        "w.mjs": `import "./t.mjs"; console.log("w1"); await 0; console.log("w2");`,
        "s.mjs": `import "./t.mjs"; import { drainMicrotasks } from "bun:jsc"; console.log("s1"); drainMicrotasks(); console.log("s2"); throw new Error("from s");`,
        "t.mjs": t,
      });
      expect(await run(join(String(dir), "main.mjs"))).toEqual({
        stdout: "t1\nt2\nw1\ns1\nw2\ns2\nrejected: from s",
        stderr: "",
        exitCode: 0,
      });
    });

    // r.mjs is in the middle of its walk when the job rejects it. n.mjs imports it, so n.mjs fails with the error
    // of r.mjs and does not run.
    test("require() of a module that imports a module that the job rejected throws that error", async () => {
      using dir = tempDir("vm-module-graph-job", {
        "main.mjs": main,
        "r.mjs": `import "./t.mjs"; import "./x.mjs"; console.log("r");`,
        "t.mjs": `console.log("t1"); await 0; console.log("t2"); throw new Error("from t");`,
        "x.mjs": `
          import { drainMicrotasks } from "bun:jsc";
          import { createRequire } from "node:module";
          console.log("x1");
          drainMicrotasks();
          try {
            createRequire(import.meta.url)("./n.mjs");
            console.log("required");
          } catch (error) {
            console.log("require threw: " + error.message);
          }
          console.log("x2");
        `,
        "n.mjs": `import "./r.mjs"; console.log("n");`,
      });
      expect(await run(join(String(dir), "main.mjs"))).toEqual({
        stdout: "t1\nx1\nt2\nrequire threw: from t\nx2\nrejected: from t",
        stderr: "",
        exitCode: 0,
      });
    });

    // require() of an ES module runs the continuation of a top-level await that the required module ends. Node
    // runs it when require() has returned, so this test does not look at the order of the log.
    test("require() of an ES module that ends the top-level await of another module", async () => {
      using dir = tempDir("vm-module-graph-job", {
        "main.mjs": main,
        "gate.mjs": `globalThis.gate = new Promise(resolve => (globalThis.open = resolve));`,
        "r.mjs": `import "./gate.mjs"; import "./t.mjs"; import "./x.mjs"; console.log("r");`,
        "t.mjs": `console.log("t1"); await globalThis.gate; console.log("t2");`,
        "x.mjs": `
          import { createRequire } from "node:module";
          console.log("x1");
          createRequire(import.meta.url)("./opens-the-gate.mjs");
          console.log("x2");
        `,
        "opens-the-gate.mjs": `globalThis.open();`,
      });
      const { stdout, stderr, exitCode } = await run(join(String(dir), "main.mjs"));
      expect({ lines: stdout.split("\n").sort(), stderr, exitCode }).toEqual({
        lines: ["fulfilled", "r", "t1", "t2", "x1", "x2"],
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

// Node v26.3.0 aborts here on a CHECK of V8 (Module::Evaluate of a SyntheticModule that is "evaluating").
describe("an evaluateCallback evaluates a module that imports its SyntheticModule", () => {
  test.each(everyKind)(
    "in %s the callback runs once, and the importer runs with the exports set so far",
    async kind => {
      const g = graph({ a: `import { v } from "s"; log("a sees " + v);` }, {}, kinds[kind]);
      let runs = 0;
      let inner: Promise<unknown> | undefined;
      let statusesInside: string[] = [];
      const s = g.synthetic("s", ["v"], module => {
        runs++;
        module.setExport("v", 1);
        const n = new vm.SourceTextModule(`import { v } from "s"; log("n sees " + v);`, {
          identifier: "n",
          context: g.context,
        });
        n.linkRequests([module]);
        n.instantiate();
        inner = n.evaluate();
        statusesInside = [module.status, n.status];
        module.setExport("v", 2);
      });
      await g.link();
      expect(await g.modules.a.evaluate()).toBeUndefined();
      expect(await inner).toBeUndefined();
      expect({ runs, log: g.log, statusesInside, statuses: [g.modules.a.status, s.status] }).toEqual({
        runs: 1,
        log: ["n sees 1", "a sees 2"],
        statusesInside: ["evaluating", "evaluated"],
        statuses: ["evaluated", "evaluated"],
      });
    },
  );
});

// `bun --print` and the REPL have a global object of their own kind.
test("modules without a context in the program of bun --print", async () => {
  const result = await run(
    "--print",
    `
    const vm = require("node:vm");
    const entries = [];
    globalThis.log = entry => void entries.push(entry);
    const s = new vm.SyntheticModule(["x"], function () {
      log("s");
      this.setExport("x", 1);
    });
    const a = new vm.SourceTextModule('import { x } from "s"; log("a " + x + " " + import.meta.from);', {
      initializeImportMeta(meta) {
        log("initializeImportMeta");
        meta.from = "meta";
      },
    });
    a.link(() => s).then(() => a.evaluate()).then(() => entries.join(", "));
  `,
  );
  expect(result).toEqual({ stdout: "s, initializeImportMeta, a 1 meta", stderr: "", exitCode: 0 });
});

// In Node v26.3.0 the root waits for the module, whose evaluation is not done while its body waits at the await.
// JSC takes a module that is on the stack of an outer walk as a dependency that is done (depInOuterSCC in
// AbstractModuleRecord.cpp, which require() of an ES module needs), so the root runs at once.
test.each(everyKind)(
  "in %s, a body with a top-level await evaluates a root that imports its module: the root runs at once",
  async kind => {
    let inner: Promise<unknown> | undefined;
    const g = graph(
      {
        r1: `import "x"; log("r1");`,
        x: `log("x1"); reenter(); await 0; log("x2"); export const v = 1;`,
        r2: `import { v } from "x"; let seen; try { seen = v; } catch (error) { seen = error.name; } log("r2 " + seen);`,
      },
      { reenter: () => void (inner = g.modules.r2.evaluate()) },
      kinds[kind],
    );
    await g.link("r1");
    await g.link("r2");
    expect(await g.modules.r1.evaluate()).toBeUndefined();
    expect(await inner).toBeUndefined();
    expect(g.log).toEqual(["x1", "r2 ReferenceError", "x2", "r1"]);
  },
);

// Node v26.3.0 does not parse `import defer`.
describe("import defer", () => {
  test("a deferred SyntheticModule runs its evaluateCallback at the first read of its namespace", async () => {
    const g = graph({
      a: `import defer * as s from "s"; log("a"); export const read = () => s.x;`,
    });
    const s = g.synthetic("s", ["x"], module => {
      g.log.push("s");
      module.setExport("x", 7);
    });
    await g.link();
    await g.modules.a.evaluate();
    expect({ log: g.log, status: s.status }).toEqual({ log: ["a"], status: "linked" });
    expect((g.modules.a.namespace as any).read()).toBe(7);
    expect((g.modules.a.namespace as any).read()).toBe(7);
    expect({ log: g.log, status: s.status }).toEqual({ log: ["a", "s"], status: "evaluated" });
  });

  test("a deferred SyntheticModule whose evaluateCallback throws: the read throws that error", async () => {
    const g = graph({
      a: `import defer * as s from "s"; export const read = () => s.x;`,
    });
    const error = new Error("from s");
    let runs = 0;
    const s = g.synthetic("s", ["x"], () => {
      runs++;
      throw error;
    });
    await g.link();
    await g.modules.a.evaluate();
    expect(thrownBy(() => (g.modules.a.namespace as any).read())).toBe(error);
    // The next read does not run the callback again.
    expect(thrownBy(() => (g.modules.a.namespace as any).read())).toBe(error);
    expect({ status: s.status, error: s.error, runs }).toEqual({ status: "errored", error, runs: 1 });
    expect(await rejection(s.evaluate())).toBe(error);
  });

  // The module is "evaluating" then, and the proposal has a TypeError for a read of such a namespace.
  test("a deferred SyntheticModule whose evaluateCallback reads the namespace that started it", async () => {
    const g = graph({ d: `import defer * as ns from "s"; log("d"); export const read = () => ns.v;` });
    let runs = 0;
    let inside: unknown;
    const s = g.synthetic("s", ["v"], module => {
      runs++;
      module.setExport("v", 1);
      inside = thrownBy(() => (g.modules.d.namespace as any).read());
      module.setExport("v", 2);
    });
    await g.link();
    await g.modules.d.evaluate();
    expect({ log: g.log, status: s.status }).toEqual({ log: ["d"], status: "linked" });
    expect((g.modules.d.namespace as any).read()).toBe(2);
    expect({ runs, inside: String(inside), status: s.status }).toEqual({
      runs: 1,
      inside: "TypeError: Unable to synchronously evaluate deferred module",
      status: "evaluated",
    });
  });

  test("a deferred SourceTextModule runs, after its initializeImportMeta, at the first read of its namespace", async () => {
    const g = graph({
      a: `import defer * as b from "b"; log("a"); export const read = () => b.id;`,
    });
    g.modules.b = new vm.SourceTextModule(`log("b"); export const id = import.meta.id;`, {
      identifier: "b",
      context: g.context,
      initializeImportMeta(meta: any) {
        g.log.push("meta of b");
        meta.id = "b's";
      },
    });
    await g.link();
    await g.modules.a.evaluate();
    expect({ log: g.log, statuses: g.statuses() }).toEqual({ log: ["a"], statuses: { a: "evaluated", b: "linked" } });
    expect((g.modules.a.namespace as any).read()).toBe("b's");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["a", "meta of b", "b"],
      statuses: { a: "evaluated", b: "evaluated" },
    });
  });
});

// Node calls initializeImportMeta when the code of the module evaluates import.meta for the first time: after
// "b start" here, and never for c.
test("initializeImportMeta is called before the body of its module, once", async () => {
  const g = graph({ a: `import "b"; import "c"; log("a");` });
  const calls: unknown[] = [];
  const withMeta = (identifier: string, source: string) =>
    (g.modules[identifier] = new vm.SourceTextModule(source, {
      identifier,
      context: g.context,
      initializeImportMeta(meta, module) {
        g.log.push("meta of " + identifier);
        calls.push([identifier, module === g.modules[identifier], g.statuses()]);
      },
    }));
  withMeta("b", `log("b start"); import.meta; import.meta;`);
  withMeta("c", `log("c"); export const unused = () => import.meta;`);
  await g.link();
  await g.modules.a.evaluate();
  expect(g.log).toEqual(["meta of b", "b start", "meta of c", "c", "a"]);
  expect(calls).toEqual([
    ["b", true, { a: "evaluating", b: "evaluating", c: "linked" }],
    ["c", true, { a: "evaluating", b: "evaluated", c: "evaluating" }],
  ]);
});

// The walk of Evaluate() is recursive in JSC and checks the stack: a chain either runs, or fails with a
// RangeError before a body runs. Debug and ASAN frames are several times larger, so the length of the chain that
// runs says nothing there.
describe("a long chain of modules", () => {
  const chain = (length: number, slice: number) => `
    const vm = require("node:vm");
    const context = vm.createContext({ count: 0 });
    const modules = [];
    for (let i = 0; i < ${length}; i++) {
      const source = i + 1 < ${length} ? 'import "' + (i + 1) + '"; count++;' : "count++;";
      modules.push(new vm.SourceTextModule(source, { identifier: String(i), context }));
    }
    const linker = specifier => modules[Number(specifier)];
    // Link() is recursive too. Each call finds the modules behind its first ${slice} linked.
    const link = async () => {
      for (let i = ${length} - ${slice}; i >= 0; i -= ${slice}) await modules[i].link(linker);
    };
    const report = async first => {
      const second = await modules[0].evaluate().then(() => "fulfilled", error => error);
      console.log(JSON.stringify({
        first: [first.name, first.message],
        sameError: first === second && modules[0].error === first,
        count: context.count,
        statuses: [modules[0].status, modules[${length} - 1].status],
      }));
    };
  `;
  const tooLong = {
    stdout: JSON.stringify({
      first: ["RangeError", "Maximum call stack size exceeded"],
      sameError: true,
      count: 0,
      statuses: ["errored", "linked"],
    }),
    stderr: "",
    exitCode: 0,
  };

  test.skipIf(isDebug || isASAN)("3000 modules evaluate", async () => {
    const context = vm.createContext({ count: 0 });
    const length = 3000;
    const modules: vm.SourceTextModule[] = [];
    for (let i = 0; i < length; i++) {
      const source = i + 1 < length ? `import "${i + 1}"; count++;` : `count++;`;
      modules.push(new vm.SourceTextModule(source, { identifier: String(i), context }));
    }
    await modules[0].link(specifier => modules[Number(specifier)]);
    await modules[0].evaluate();
    expect({ count: context.count, first: modules[0].status, last: modules[length - 1].status }).toEqual({
      count: length,
      first: "evaluated",
      last: "evaluated",
    });
  });

  test.skipIf(isDebug || isASAN)("40000 modules fail with a RangeError, and the process goes on", async () => {
    const result = await runProgram(`${chain(40000, 1000)}
      (async () => {
        await link();
        await report(await modules[0].evaluate().then(() => "fulfilled", error => error));
      })();
    `);
    expect(result).toEqual(tooLong);
  });

  test("a chain that is longer than the stack that is left fails with a RangeError", async () => {
    const result = await runProgram(`${chain(isDebug ? 200 : 2000, 100)}
      // Calls evaluate() of the module from the deepest frame that has the stack to start the walk of Evaluate().
      function evaluateAtTheEndOfTheStack(module) {
        let promise;
        try {
          promise = evaluateAtTheEndOfTheStack(module);
        } catch {}
        if (module.status !== "linked") return promise;
        // Without the stack for the call itself, evaluate() rejects and the module stays "linked".
        promise = module.evaluate();
        promise.catch(() => {});
        return promise;
      }
      (async () => {
        await link();
        await report(await evaluateAtTheEndOfTheStack(modules[0]).then(() => "fulfilled", error => error));
      })();
    `);
    expect(result).toEqual(tooLong);
  });
});

describe("node:vm module lifetime", () => {
  test("the modules of a graph that was evaluated are collected", async () => {
    const baseline = {
      source: heapStats().objectTypeCounts.NodeVMSourceTextModule || 0,
      synthetic: heapStats().objectTypeCounts.NodeVMSyntheticModule || 0,
    };

    async function iteration(i: number) {
      const s = new vm.SyntheticModule(["x"], function (this: vm.SyntheticModule) {
        this.setExport("x", i);
      });
      const unused = new vm.SyntheticModule(["x"], function () {});
      const b = new vm.SourceTextModule(`import { x } from "s"; await 0; export const y = x + 1;`);
      const a = new vm.SourceTextModule(
        `import { y } from "b"; import defer * as unused from "unused"; export const z = y + import.meta.i;`,
        {
          initializeImportMeta: (meta: any) => void (meta.i = i),
        },
      );
      await a.link(specifier => ({ s, b, unused })[specifier]!);
      await a.evaluate();
      if ((a.namespace as any).z !== 2 * i + 1) throw new Error("wrong result");
    }
    for (let i = 0; i < 200; i++) await iteration(i);

    await expectMaxObjectTypeCount(expect, "NodeVMSourceTextModule", baseline.source + 20);
    await expectMaxObjectTypeCount(expect, "NodeVMSyntheticModule", baseline.synthetic + 20);
  });

  // vm-import-callback-lifetime-fixture.js. A callback, and the module that it gets, live until the callback
  // ran: the record of a SyntheticModule keeps its evaluateCallback, and the code of a SourceTextModule keeps its
  // initializeImportMeta. A module keeps the modules that it was linked to.
  const fixture = join(import.meta.dir, "vm-import-callback-lifetime-fixture.js");
  const expected: Record<string, object> = {
    "alive-importMetaDeferred": { before: 0, result: true, calls: 1, referrer: "SourceTextModule" },
    "alive-evaluateCallbackDeferred": { before: 0, result: true, calls: 1 },
    "alive-evaluateCallbackSameSpecifier": { got: ["one", "two"], ran: ["one", "two"] },
    "alive-linkedDependency-importMeta": { result: true, calls: 1, referrer: "SourceTextModule" },
    "alive-linkedDependency-import": { result: "hooked", referrer: "SourceTextModule" },
    "freed-importMeta": { alive: 0, last: 19 },
    "freed-evaluateCallback": { alive: 0, last: 19 },
    "freed-modulesStoppedByTimeout": { alive: 0 },
  };

  test.concurrent.each(Object.keys(expected))("%s", async scenario => {
    expect(await bunRun([fixture, scenario])).toSpawn(JSON.stringify(expected[scenario]));
  });

  // collectContinuously is very slow under Windows + ASAN in CI (see sourcetextmodule-link-gc.test.ts). On a debug
  // build the child needs 3 to 5 s, so the default timeout is too short.
  test.skipIf(isWindows).each(["alive-importMetaDeferred", "alive-evaluateCallbackDeferred"])(
    "%s while collecting continuously",
    async scenario => {
      const result = await bunRun([fixture, scenario], { BUN_JSC_collectContinuously: "1" });
      expect(result).toSpawn(JSON.stringify(expected[scenario]));
    },
    30_000,
  );
});
