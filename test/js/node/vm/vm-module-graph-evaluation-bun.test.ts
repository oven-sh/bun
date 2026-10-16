// What module.evaluate() of node:vm does in Bun where Node v26.3.0 has nothing to compare with, or does
// something that Bun does not copy. vm-module-graph-evaluation.test.ts has everything that Node does the same.
//
// Node leaves the modules that a timeout or a SIGINT stopped in the state V8 gives them: "errored" with the
// error `null` and an evaluate() that never settles, or "evaluated" for a module that never ran to its end.
// Bun gives each of those modules the error of the run that stopped it.
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, expectMaxObjectTypeCount, isASAN, isDebug, isWindows } from "harness";
import { join } from "node:path";
import vm from "node:vm";

type Module = vm.SourceTextModule | vm.SyntheticModule;

function graph(sources: Record<string, string>, host: Record<string, unknown> = {}, contextOptions = {}) {
  const log: unknown[] = [];
  const context = vm.createContext({ log: (entry: unknown) => void log.push(entry), ...host }, contextOptions);
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
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

// The code below that must be stopped never returns, so no result depends on how long the timeout is. The
// deadline can still pass before the walk reaches that code: Evaluate() then stops earlier, with the same error,
// and fewer modules ran. A test needs the run that reached `marker`, so it tries until it has one.
const timeout = 10;
async function untilReached<T extends { g: ReturnType<typeof graph> }>(marker: string, scenario: () => Promise<T>) {
  for (;;) {
    const result = await scenario();
    if (result.g.log.includes(marker)) return result;
  }
}

describe("module.evaluate() with a timeout", () => {
  test("a body that does not return: every module on the way to it gets the timeout error", async () => {
    const { g, error } = await untilReached("b", async () => {
      const g = graph({
        a: `import "b"; import "c"; log("a");`,
        b: `log("b"); for (;;) {}`,
        c: `log("c");`,
      });
      await g.link();
      return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
    });
    expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["b"],
      statuses: { a: "errored", b: "errored", c: "linked" },
    });
    expect(g.modules.a.error).toBe(error);
    expect(g.modules.b.error).toBe(error);

    // The module does not run again. evaluate() rejects with the same error.
    expect(await rejection(g.modules.a.evaluate())).toBe(error);
    expect(await rejection(g.modules.b.evaluate())).toBe(error);
    await g.modules.c.evaluate();
    expect(g.log).toEqual(["b", "c"]);
  });

  test("a body of a cycle that does not return: every member gets the timeout error", async () => {
    const { g, error } = await untilReached("b", async () => {
      const g = graph({
        a: `import "b"; log("a");`,
        b: `import "c"; log("b"); for (;;) {}`,
        c: `import "a"; log("c");`,
      });
      await g.link();
      return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
    });
    expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["c", "b"],
      statuses: { a: "errored", b: "errored", c: "errored" },
    });
    expect([g.modules.a.error, g.modules.b.error, g.modules.c.error]).toEqual([error, error, error]);
  });

  test("an evaluateCallback that does not return: the SyntheticModule and its importers get the timeout error", async () => {
    const { g, error } = await untilReached("s", async () => {
      const g = graph({
        a: `import "b"; import "s"; log("a");`,
        b: `log("b");`,
      });
      g.synthetic("s", [], () => {
        g.log.push("s");
        for (;;) {}
      });
      await g.link();
      return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
    });
    expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["b", "s"],
      statuses: { a: "errored", b: "evaluated", s: "errored" },
    });
    expect(g.modules.s.error).toBe(error);
    expect(g.modules.a.error).toBe(error);
    expect(await rejection(g.modules.s.evaluate())).toBe(error);
    expect(g.log).toEqual(["b", "s"]);
  });

  test("evaluate() of a SyntheticModule whose evaluateCallback does not return", async () => {
    const { g, error } = await untilReached("s", async () => {
      const g = graph({});
      g.synthetic("s", [], () => {
        g.log.push("s");
        for (;;) {}
      });
      return { g, error: await rejection(g.modules.s.evaluate({ timeout })) };
    });
    expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect(g.modules.s.status).toBe("errored");
    expect(g.modules.s.error).toBe(error);
    expect(await rejection(g.modules.s.evaluate())).toBe(error);
    expect(g.log).toEqual(["s"]);
  });

  test("the timeout of an inner evaluate() does not stop the evaluate() around it", async () => {
    const g = graph({
      a: `import "s"; log("a");`,
      spin: `for (;;) {}`,
    });
    await g.link("spin");
    let inner: Promise<unknown> | undefined;
    g.synthetic("s", [], () => {
      inner = g.modules.spin.evaluate({ timeout });
      g.log.push("s after the inner evaluate()");
    });
    await g.link();
    await g.modules.a.evaluate();
    expect((await rejection(inner!)).code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["s after the inner evaluate()", "a"],
      statuses: { a: "evaluated", spin: "errored", s: "evaluated" },
    });
  });

  test("a run with a timeout around evaluate(): the modules get the error of that run", async () => {
    const { g, thrown, returned } = await untilReached("b", async () => {
      const g = graph({
        a: `import "b"; log("a");`,
        b: `log("b"); for (;;) {}`,
      });
      await g.link();
      let returned = false;
      (g.context as any).evaluate = () => {
        g.modules.a.evaluate();
        returned = true;
      };
      let thrown: any;
      try {
        vm.runInContext("evaluate()", g.context, { timeout });
      } catch (error) {
        thrown = error;
      }
      return { g, thrown, returned };
    });
    // The termination is the Script's, so it goes through evaluate() and the Script throws the error.
    expect({ code: thrown.code, returned }).toEqual({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT", returned: false });
    expect({ log: g.log, statuses: g.statuses() }).toEqual({ log: ["b"], statuses: { a: "errored", b: "errored" } });
    const error = g.modules.a.error;
    expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect(g.modules.b.error).toBe(error);
    expect(await rejection(g.modules.a.evaluate())).toBe(error);
  });

  test("a run with a timeout around evaluate(): an evaluateCallback that does not return", async () => {
    const { g, thrown } = await untilReached("s", async () => {
      const g = graph({
        a: `import "s"; log("a");`,
      });
      g.synthetic("s", [], () => {
        g.log.push("s");
        for (;;) {}
      });
      await g.link();
      (g.context as any).evaluate = () => void g.modules.a.evaluate();
      let thrown: any;
      try {
        vm.runInContext("evaluate()", g.context, { timeout });
      } catch (error) {
        thrown = error;
      }
      return { g, thrown };
    });
    expect(thrown.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect(g.statuses()).toEqual({ a: "errored", s: "errored" });
    expect(g.modules.s.error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect(g.modules.a.error).toBe(g.modules.s.error);
  });

  describe("in an afterEvaluate context, where the timeout also bounds the microtask checkpoint", () => {
    const afterEvaluate = { microtaskMode: "afterEvaluate" };

    test("a body that does not return after a top-level await: it and its importers get the timeout error", async () => {
      const { g, error } = await untilReached("b2", async () => {
        const g = graph(
          {
            a: `import "b"; import "c"; log("a");`,
            b: `log("b1"); await 0; log("b2"); for (;;) {}`,
            c: `log("c");`,
          },
          {},
          afterEvaluate,
        );
        await g.link();
        return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
      });
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["b1", "c", "b2"],
        statuses: { a: "errored", b: "errored", c: "evaluated" },
      });
      expect(g.modules.a.error).toBe(error);
      expect(g.modules.b.error).toBe(error);
      expect(await rejection(g.modules.a.evaluate())).toBe(error);
      expect(g.log).toEqual(["b1", "c", "b2"]);
    });

    test("a body that does not return in the job of its dependency: it and its importers get the timeout error", async () => {
      const { g, error } = await untilReached("b", async () => {
        const g = graph(
          {
            a: `import "b"; log("a");`,
            b: `import "t"; log("b"); for (;;) {}`,
            t: `log("t1"); await 0; log("t2");`,
          },
          {},
          afterEvaluate,
        );
        await g.link();
        return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
      });
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["t1", "t2", "b"],
        statuses: { a: "errored", b: "errored", t: "evaluated" },
      });
      expect(g.modules.a.error).toBe(error);
      expect(g.modules.b.error).toBe(error);
    });

    test("a module that waits at its own top-level await is not stopped, and can finish later", async () => {
      let open!: () => void;
      const { g, error } = await untilReached("b2", async () => {
        const gate = new Promise<void>(resolve => (open = resolve));
        const g = graph(
          {
            a: `import "w"; import "b"; log("a");`,
            w: `log("w1"); await gate; log("w2");`,
            b: `log("b1"); await 0; log("b2"); for (;;) {}`,
          },
          { gate },
          afterEvaluate,
        );
        await g.link();
        return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
      });
      // w waits for a promise of the main context, so the checkpoint that was stopped in b had nothing of w to run.
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["w1", "b1", "b2"],
        statuses: { a: "errored", w: "evaluated", b: "errored" },
      });

      open();
      await turn();
      const done = g.modules.w.evaluate();
      expect(g.log).toEqual(["w1", "b1", "b2", "w2"]);
      expect(await done).toBeUndefined();
      expect(g.statuses()).toEqual({ a: "errored", w: "evaluated", b: "errored" });
    });

    test("a run with a timeout around evaluate(): a body that does not return after a top-level await", async () => {
      const { g, thrown } = await untilReached("b2", async () => {
        const g = graph(
          {
            a: `import "b"; log("a");`,
            b: `log("b1"); await 0; log("b2"); for (;;) {}`,
          },
          {},
          afterEvaluate,
        );
        await g.link();
        (g.context as any).evaluate = () => void g.modules.a.evaluate();
        let thrown: any;
        try {
          vm.runInContext("evaluate()", g.context, { timeout });
        } catch (error) {
          thrown = error;
        }
        return { g, thrown };
      });
      expect(thrown.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["b1", "b2"],
        statuses: { a: "errored", b: "errored" },
      });
      const error = g.modules.b.error;
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect(g.modules.a.error).toBe(error);
      expect(await rejection(g.modules.a.evaluate())).toBe(error);
    });

    test("evaluate() of an evaluated module: a job that does not return", async () => {
      const g = graph(
        { a: `log("a"); globalThis.spinLater = () => Promise.resolve().then(() => { for (;;) {} });` },
        {},
        afterEvaluate,
      );
      await g.link();
      await g.modules.a.evaluate();
      (g.context as any).spinLater();
      const error = await rejection(g.modules.a.evaluate({ timeout }));
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      // The job was not a module's. The module keeps its status, and evaluate() works again.
      expect(g.modules.a.status).toBe("evaluated");
      expect(await g.modules.a.evaluate()).toBeUndefined();
    });
  });
});

describe("module.evaluate() with breakOnSigint", () => {
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
  const run = async (program: string) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + program],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  };

  test.concurrent.skipIf(isWindows)("in a module body", async () => {
    const result = await run(`
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
    const result = await run(`
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
    const result = await run(`
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
});

describe("a SyntheticModule whose evaluateCallback threw", () => {
  // Node runs the importer too, and then reports a rejected promise of V8 that no program can reach.
  test("a module that was linked to it before runs, and nothing is reported", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const vm = require("node:vm");
        const s = new vm.SyntheticModule(["x"], function () {
          this.setExport("x", 1);
          throw new Error("from s");
        });
        const a = new vm.SourceTextModule('import { x } from "s"; globalThis.ran = "a " + x;');
        (async () => {
          await a.link(() => s);
          const outcome = await s.evaluate().then(() => "fulfilled", error => "rejected: " + error.message);
          await a.evaluate();
          await new Promise(resolve => setImmediate(resolve));
          console.log(JSON.stringify({ outcome, ran: globalThis.ran, statuses: [s.status, a.status] }));
        })();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
      stdout: JSON.stringify({ outcome: "rejected: from s", ran: "a 1", statuses: ["errored", "evaluated"] }),
      stderr: "",
      exitCode: 0,
    });
  });
});

// A Bun.ModuleGraph context follows code the way an AsyncLocalStorage store does. A module that imports a
// module with a top-level await runs in the job that ends the await, and that job runs in the context that
// evaluate() was called in.
describe("module.evaluate() in the context of a Bun.ModuleGraph", () => {
  // Yields to the event loop until `condition()` holds (the per-test timeout bounds the wait).
  async function until(condition: () => boolean) {
    while (!condition()) await turn();
  }

  test("every module of the graph runs in that context", async () => {
    using moduleGraph = new Bun.ModuleGraph();
    const inContext = () => Bun.ModuleGraph.current === moduleGraph;
    // The modules are made and linked in the host's context. Only evaluate() is called in the graph's.
    const g = graph(
      {
        entry: `import "tla"; import "s"; log(["entry", inContext()]);`,
        tla: `log(["tla before its await", inContext()]); await 0; log(["tla after its await", inContext()]);`,
      },
      { inContext },
    );
    g.synthetic("s", [], () => void g.log.push(["s", inContext()]));
    await g.link();
    await moduleGraph.run(() => g.modules.entry.evaluate());
    expect(g.log).toEqual([
      ["tla before its await", true],
      ["s", true],
      ["tla after its await", true],
      ["entry", true],
    ]);
  });

  test("a module that waits for a top-level await opens what dispose() closes", async () => {
    const moduleGraph = new Bun.ModuleGraph();
    let ticks = 0;
    const g = graph(
      {
        entry: `import "tla"; setInterval(tick, 1);`,
        tla: `await 0;`,
      },
      { setInterval, tick: () => void ticks++ },
    );
    await g.link();
    await moduleGraph.run(() => g.modules.entry.evaluate());
    await until(() => ticks > 0);

    moduleGraph.dispose();

    const stopped = ticks;
    // A 1ms timer of the host fires five times: a live 1ms timer of the graph would have fired too.
    let hostTicks = 0;
    const { promise, resolve } = Promise.withResolvers<void>();
    const hostTimer = setInterval(() => void (++hostTicks >= 5 && resolve()), 1);
    await promise;
    clearInterval(hostTimer);
    expect(ticks).toBe(stopped);
  });

  test("an unhandled rejection in a module that waits for a top-level await goes to onError", async () => {
    const errors: unknown[] = [];
    using moduleGraph = new Bun.ModuleGraph({
      onError: (error: any, kind) => void errors.push([error.message, kind]),
    });
    const g = graph({
      entry: `import "tla"; Promise.reject(new Error("from entry"));`,
      tla: `await 0;`,
    });
    await g.link();
    await moduleGraph.run(() => g.modules.entry.evaluate());
    await until(() => errors.length > 0);
    expect(errors).toEqual([["from entry", "unhandledRejection"]]);
  });
});

// Node v26.3.0 does not parse `import defer`.
describe("module.evaluate() and import defer", () => {
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
    expect(() => (g.modules.a.namespace as any).read()).toThrow(error);
    expect({ status: s.status, error: s.error, runs }).toEqual({ status: "errored", error, runs: 1 });
    expect(await rejection(s.evaluate())).toBe(error);
  });

  test("a deferred SourceTextModule runs, and gets its import.meta, at the first read of its namespace", async () => {
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
      log: ["a", "b", "meta of b"],
      statuses: { a: "evaluated", b: "evaluated" },
    });
  });
});

describe("the promise of module.evaluate()", () => {
  test("in an afterEvaluate context it is a promise of the caller's realm", async () => {
    const g = graph(
      { sync: `log("sync");`, waits: `await 0;`, parked: `await gate;`, throws: `throw new Error("from throws");` },
      { gate: new Promise(() => {}) },
      { microtaskMode: "afterEvaluate" },
    );
    for (const name of Object.keys(g.modules)) await g.link(name);
    const promises = {
      sync: g.modules.sync.evaluate(),
      syncAgain: g.modules.sync.evaluate(),
      waits: g.modules.waits.evaluate(),
      parked: g.modules.parked.evaluate(),
      throws: g.modules.throws.evaluate(),
    };
    promises.throws.catch(() => {});
    for (const [name, promise] of Object.entries(promises))
      expect([name, promise instanceof Promise]).toEqual([name, true]);
    expect(await promises.sync).toBeUndefined();
  });

  test("evaluate() of an evaluated module gives the promise of the first call", async () => {
    const g = graph({ a: `import "b"; log("a");`, b: `log("b1"); await 0; log("b2");` });
    await g.link();
    const first = g.modules.a.evaluate();
    expect(g.modules.a.evaluate()).toBe(first);
    await first;
    expect(g.modules.a.evaluate()).toBe(first);
    // b ran as a dependency. Its first evaluate() makes the promise that the later calls give.
    const ofB = g.modules.b.evaluate();
    expect(ofB).not.toBe(first);
    expect(g.modules.b.evaluate()).toBe(ofB);
    expect(await ofB).toBeUndefined();
    expect(g.log).toEqual(["b1", "b2", "a"]);
  });
});

// The walk of Evaluate() is recursive in JSC and checks the stack: a chain this long either runs or fails
// with a RangeError. Debug and ASAN frames are several times larger, so the length says nothing there.
test.skipIf(isDebug || isASAN)("a chain of 3000 modules evaluates", async () => {
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

  test("a SyntheticModule that a timeout stopped is collected", async () => {
    const baseline = heapStats().objectTypeCounts.NodeVMSyntheticModule || 0;

    // Whether the timeout stopped the evaluateCallback, and not the walk before it.
    async function iteration() {
      const context = vm.createContext({});
      let started = false;
      const s = new vm.SyntheticModule(
        [],
        () => {
          started = true;
          for (;;) {}
        },
        { context },
      );
      const a = new vm.SourceTextModule(`import "s";`, { context });
      await a.link(() => s);
      await a.evaluate({ timeout: 5 }).catch(() => {});
      return started && s.status === "errored";
    }
    let stopped = 0;
    while (stopped < 20) if (await iteration()) stopped++;

    await expectMaxObjectTypeCount(expect, "NodeVMSyntheticModule", baseline + 10);
  });

  // initializeImportMeta and the module it gets live as long as code that can still evaluate import.meta for
  // the first time, no longer.
  const fixture = join(import.meta.dir, "vm-import-callback-lifetime-fixture.js");
  const expected: Record<string, object> = {
    "alive-importMeta": { before: 0, result: true, again: true, calls: 1, referrer: "SourceTextModule" },
    "alive-importMetaAfterAwait": { before: 0, result: true, calls: 1, referrer: "SourceTextModule" },
    "alive-importMetaDeferred": { before: 0, result: true, calls: 1, referrer: "SourceTextModule" },
    "freed-importMeta": { alive: 0, last: 19 },
  };

  test.concurrent.each(Object.keys(expected))("%s", async scenario => {
    expect(await bunRun([fixture, scenario])).toSpawn(JSON.stringify(expected[scenario]));
  });
});
