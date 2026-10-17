// What module.evaluate() of node:vm does in Bun where Node v26.3.0 does something that Bun does not copy, or has
// nothing to compare with (`import defer`). vm-module-graph-evaluation.test.ts has what Node does the same.
//
// A timeout or a SIGINT stops module code where it is. Node leaves such a module in the state V8 gives it:
// "errored" with the error `null` and an evaluate() that never settles, or "evaluating" or "evaluated" for good.
// In Bun the run that was cut short gives its error to every module that it stopped.
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

// The code below that must be stopped never returns, so no result depends on how long the timeout is. The
// deadline can still pass before the code that the test is about starts. A test needs the run that reached
// `marker`, so it tries until it has one.
const timeout = 10;
async function untilReached<T extends { g: ReturnType<typeof graph> }>(marker: string, scenario: () => Promise<T>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await scenario();
    if (result.g.log.includes(marker)) return result;
  }
  throw new Error(`no run reached ${JSON.stringify(marker)}`);
}

async function runProgram(program: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("a timeout stops module code", () => {
  test("a body: every module on the way to it gets the timeout error", async () => {
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

  test("a body of a cycle: every member gets the timeout error", async () => {
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

  test("an evaluateCallback: the SyntheticModule and the modules on the way to it get the timeout error", async () => {
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

  test("a Script with a timeout around evaluate(): the modules get the error that the Script throws", async () => {
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
      return { g, thrown: thrownBy(() => vm.runInContext("evaluate()", g.context, { timeout })), returned };
    });
    // The termination is the Script's, so it goes through evaluate().
    expect({ code: thrown.code, returned }).toEqual({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT", returned: false });
    expect({ log: g.log, statuses: g.statuses() }).toEqual({ log: ["b"], statuses: { a: "errored", b: "errored" } });
    expect(g.modules.a.error).toBe(thrown);
    expect(g.modules.b.error).toBe(thrown);
    expect(await rejection(g.modules.a.evaluate())).toBe(thrown);
  });

  test("a Script with a timeout around evaluate(): an evaluateCallback", async () => {
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
      return { g, thrown: thrownBy(() => vm.runInContext("evaluate()", g.context, { timeout })) };
    });
    expect(thrown.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect(g.statuses()).toEqual({ a: "errored", s: "errored" });
    expect(g.modules.s.error).toBe(thrown);
    expect(g.modules.a.error).toBe(thrown);
  });

  // `import defer` runs a module at the first read of its namespace, which can be in a Script.
  test("a deferred module that a Script with a timeout reads first gets the error that the Script throws", async () => {
    const { g, thrown } = await untilReached("b", async () => {
      const g = graph({
        a: `import defer * as b from "b"; globalThis.read = () => b.x; log("a");`,
        b: `export let x = "before the loop"; log("b"); for (;;) {}`,
        c: `import "b"; log("c");`,
      });
      await g.link();
      await g.link("c");
      // With a timeout: a runtime that does not defer b runs its loop here.
      await g.modules.a.evaluate({ timeout: 1000 });
      return { g, thrown: thrownBy(() => vm.runInContext("read()", g.context, { timeout })) };
    });
    expect(thrown.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["a", "b"],
      statuses: { a: "evaluated", b: "errored", c: "linked" },
    });
    expect(g.modules.b.error).toBe(thrown);

    // The next read does not run b again, and a module that imports b does not run.
    expect(thrownBy(() => vm.runInContext("read()", g.context))).toBe(thrown);
    expect(await rejection(g.modules.c.evaluate())).toBe(thrown);
    expect(g.log).toEqual(["a", "b"]);
  });

  test("evaluate() with a timeout from a body that a job resumed: that body is not stopped", async () => {
    let inner: Promise<unknown> | undefined;
    const g = graph(
      {
        x: `log("x1"); await 0; log("x2"); nested(); log("x3"); await 0; log("x4");`,
        y: `import "x"; import "spin"; log("y");`,
        spin: `for (;;) {}`,
      },
      { nested: () => void (inner = g.modules.y.evaluate({ timeout })) },
      afterEvaluate,
    );
    await g.link("x");
    await g.link("y");
    expect(await g.modules.x.evaluate()).toBeUndefined();
    const error = await rejection(inner!);
    expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["x1", "x2", "x3", "x4"],
      statuses: { x: "evaluated", y: "errored", spin: "errored" },
    });
    expect([g.modules.y.error, g.modules.spin.error]).toEqual([error, error]);
  });

  describe("in an afterEvaluate context, where the timeout also bounds the microtask checkpoint", () => {
    test("a body after its top-level await: it and the modules that wait for it get the timeout error", async () => {
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

    test("a body in the job that ends the await of its dependency, and the modules that were to run after it", async () => {
      const { g, error } = await untilReached("b", async () => {
        const g = graph(
          {
            a: `import "b"; import "c"; log("a");`,
            b: `import "t"; log("b"); for (;;) {}`,
            c: `import "t"; log("c1"); await 0; log("c2");`,
            t: `log("t1"); await 0; log("t2");`,
          },
          {},
          afterEvaluate,
        );
        await g.link();
        return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
      });
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      // c was next in the job that ran b. Its body never started, and no job is left that starts it.
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["t1", "t2", "b"],
        statuses: { a: "errored", b: "errored", c: "errored", t: "evaluated" },
      });
      expect([g.modules.a.error, g.modules.b.error, g.modules.c.error]).toEqual([error, error, error]);
      expect(await rejection(g.modules.c.evaluate())).toBe(error);
    });

    test("a module that waits at its top-level await, or for a module that does, is not stopped and can finish later", async () => {
      let open!: () => void;
      const { g, error } = await untilReached("b2", async () => {
        const gate = new Promise<void>(resolve => (open = resolve));
        const g = graph(
          {
            a: `import "c"; import "b"; log("a");`,
            c: `import "w"; log("c");`,
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
        statuses: { a: "errored", c: "evaluated", w: "evaluated", b: "errored" },
      });

      open();
      await turn();
      const done = g.modules.c.evaluate();
      expect(g.log).toEqual(["w1", "b1", "b2", "w2", "c"]);
      expect(await done).toBeUndefined();
      expect(g.statuses()).toEqual({ a: "errored", c: "evaluated", w: "evaluated", b: "errored" });
    });

    test("a module of another graph that the checkpoint ran: it gets the error, and its evaluate() rejects", async () => {
      let open!: () => void;
      const { g, error, first } = await untilReached("p2", async () => {
        const gate = new Promise<void>(resolve => (open = resolve));
        const g = graph(
          {
            ip: `import "p"; log("ip");`,
            p: `log("p1"); await gate; log("p2"); for (;;) {}`,
            q: `log("q");`,
          },
          { gate },
          afterEvaluate,
        );
        await g.link("ip");
        await g.link("q");
        const first = rejection(g.modules.ip.evaluate());
        open();
        await turn();
        // The checkpoint of this call resumes p.
        return { g, first, error: await rejection(g.modules.q.evaluate({ timeout })) };
      });
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["p1", "q", "p2"],
        statuses: { ip: "errored", p: "errored", q: "evaluated" },
      });
      expect([g.modules.ip.error, g.modules.p.error]).toEqual([error, error]);
      // No other checkpoint of the context is needed for the promise of the first call.
      expect(await first).toBe(error);
    });

    test("a Script with a timeout whose checkpoint resumes a body: the module gets the error that the Script throws", async () => {
      let open!: () => void;
      const { g, thrown, first } = await untilReached("p2", async () => {
        const gate = new Promise<void>(resolve => (open = resolve));
        const g = graph(
          {
            ip: `import "p"; log("ip");`,
            p: `log("p1"); await gate; log("p2"); for (;;) {}`,
          },
          { gate },
          afterEvaluate,
        );
        await g.link();
        const first = rejection(g.modules.ip.evaluate());
        open();
        await turn();
        return { g, first, thrown: thrownBy(() => vm.runInContext("0", g.context, { timeout })) };
      });
      expect(thrown.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["p1", "p2"],
        statuses: { ip: "errored", p: "errored" },
      });
      expect([g.modules.ip.error, g.modules.p.error]).toEqual([thrown, thrown]);
      expect(await first).toBe(thrown);
    });

    test("a Script with a timeout around evaluate(): a body after its top-level await", async () => {
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
        return { g, thrown: thrownBy(() => vm.runInContext("evaluate()", g.context, { timeout })) };
      });
      expect(thrown.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["b1", "b2"],
        statuses: { a: "errored", b: "errored" },
      });
      expect([g.modules.a.error, g.modules.b.error]).toEqual([thrown, thrown]);
      expect(await rejection(g.modules.a.evaluate())).toBe(thrown);
    });

    test("a job that is not of a module: the modules keep their status", async () => {
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
      expect(g.modules.a.status).toBe("evaluated");
      expect(await g.modules.a.evaluate()).toBeUndefined();
    });

    test("a walk that the timeout stops does no checkpoint: the jobs wait for the next one", async () => {
      const { g, error } = await untilReached("b", async () => {
        const g = graph(
          {
            a: `import "b"; log("a");`,
            b: `Promise.resolve().then(() => log("job of b")); log("b"); for (;;) {}`,
          },
          {},
          afterEvaluate,
        );
        await g.link();
        return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
      });
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect(g.log).toEqual(["b"]);
      // evaluate() of an errored module runs nothing, and does the checkpoint of its context.
      expect(await rejection(g.modules.a.evaluate())).toBe(error);
      expect(g.log).toEqual(["b", "job of b"]);
    });

    // JSC, like V8, drops the jobs that are queued behind the job that a termination stops. Nothing tells a
    // module whose resuming job was dropped from one that still waits, so Bun leaves it as Node does: outside
    // node:test, Node v26.3.0 gives the same result.
    test("a module that waits at a top-level await when its resuming job is dropped waits for good", async () => {
      const { g, error } = await untilReached("job of s", async () => {
        const g = graph(
          {
            r: `import "s"; import "x"; log("r");`,
            s: `log("s"); Promise.resolve().then(() => { log("job of s"); for (;;) {} });`,
            x: `log("x1"); await 0; log("x2");`,
          },
          {},
          afterEvaluate,
        );
        await g.link();
        return { g, error: await rejection(g.modules.r.evaluate({ timeout })) };
      });
      expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      expect({ log: g.log, statuses: g.statuses() }).toEqual({
        log: ["s", "x1", "job of s"],
        statuses: { r: "evaluated", s: "evaluated", x: "evaluated" },
      });

      let settled = false;
      g.modules.x.evaluate().then(
        () => (settled = true),
        () => (settled = true),
      );
      await turn();
      await g.modules.s.evaluate();
      await turn();
      expect({ settled, log: g.log }).toEqual({ settled: false, log: ["s", "x1", "job of s"] });
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
});

describe("a SyntheticModule whose evaluateCallback threw", () => {
  // Node runs the importer too, and then reports a rejected promise of V8 that no program can reach.
  test("a module that was linked to it before runs, and nothing is reported", async () => {
    const result = await runProgram(`
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
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ outcome: "rejected: from s", ran: "a 1", statuses: ["errored", "evaluated"] }),
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
// cycle while it waits.
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

  test("a timeout stops a later member of the cycle", async () => {
    const { g, error } = await untilReached("x", async () => {
      const g = graph({ a: `import "t"; import "x"; log("a");`, t, x: `log("x"); for (;;) {}` });
      await g.link();
      return { g, error: await rejection(g.modules.a.evaluate({ timeout })) };
    });
    await turn();
    expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect({ log: g.log, statuses: g.statuses() }).toEqual({
      log: ["t1", "x"],
      statuses: { a: "errored", t: "errored", x: "errored" },
    });
    expect([g.modules.a.error, g.modules.t.error, g.modules.x.error]).toEqual([error, error, error]);
  });
});

// A job that finishes a module while the walk of an Evaluate() has an importer of that module on its stack puts
// the importer in a state that module evaluation has no rule for. Node does the checkpoint inside the nested
// evaluate(), and r then never runs: its evaluate() does not settle. Bun does the checkpoint when the walk ends.
describe("evaluate() in an afterEvaluate context from code that the walk of another evaluate() runs", () => {
  test("from an evaluateCallback: the checkpoint waits for the end of the walk", async () => {
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
      log: ["t1", "s start", "other", "s end", "t2", "r"],
      statuses: { r: "evaluated", t: "evaluated", other: "evaluated", s: "evaluated" },
    });
  });

  test("from a module body, and from the initializeImportMeta of a module", async () => {
    let inner: Promise<unknown>[] = [];
    const g = graph(
      {
        r: `import "t"; import "m"; import "n"; log("r");`,
        t: `log("t1"); await 0; log("t2");`,
        m: `log("m start"); nested("m"); log("m end");`,
        other: `log("other");`,
      },
      { nested: (from: string) => void (g.log.push("nested from " + from), inner.push(g.modules.other.evaluate())) },
      afterEvaluate,
    );
    g.modules.n = new vm.SourceTextModule(`import.meta; log("n");`, {
      identifier: "n",
      context: g.context,
      initializeImportMeta: () => void (g.context as any).nested("the initializeImportMeta of n"),
    });
    await g.link();
    await g.link("other");
    expect(await g.modules.r.evaluate()).toBeUndefined();
    expect(await Promise.all(inner)).toEqual([undefined, undefined]);
    expect(g.log).toEqual([
      "t1",
      "m start",
      "nested from m",
      "other",
      "m end",
      "nested from the initializeImportMeta of n",
      "n",
      "t2",
      "r",
    ]);
  });
});

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
    expect(() => (g.modules.a.namespace as any).read()).toThrow(error);
    expect({ status: s.status, error: s.error, runs }).toEqual({ status: "errored", error, runs: 1 });
    expect(await rejection(s.evaluate())).toBe(error);
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

  test("the modules that a timeout stopped are collected", async () => {
    const baseline = {
      source: heapStats().objectTypeCounts.NodeVMSourceTextModule || 0,
      synthetic: heapStats().objectTypeCounts.NodeVMSyntheticModule || 0,
    };

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

    await expectMaxObjectTypeCount(expect, "NodeVMSourceTextModule", baseline.source + 10);
    await expectMaxObjectTypeCount(expect, "NodeVMSyntheticModule", baseline.synthetic + 10);
  });

  // initializeImportMeta and the module that it gets live until the body of the module starts, no longer.
  const fixture = join(import.meta.dir, "vm-import-callback-lifetime-fixture.js");
  const expected: Record<string, object> = {
    "alive-importMetaDeferred": { before: 0, result: true, calls: 1, referrer: "SourceTextModule" },
    "freed-importMeta": { alive: 0, last: 19 },
  };

  test.concurrent.each(Object.keys(expected))("%s", async scenario => {
    expect(await bunRun([fixture, scenario])).toSpawn(JSON.stringify(expected[scenario]));
  });

  // collectContinuously is very slow under Windows + ASAN in CI (see sourcetextmodule-link-gc.test.ts).
  test.skipIf(isWindows)("alive-importMetaDeferred while collecting continuously", async () => {
    const result = await bunRun([fixture, "alive-importMetaDeferred"], { BUN_JSC_collectContinuously: "1" });
    expect(result).toSpawn(JSON.stringify(expected["alive-importMetaDeferred"]));
  });
});
