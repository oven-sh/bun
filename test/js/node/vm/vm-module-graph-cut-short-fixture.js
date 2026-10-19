// Scenarios for vm-module-graph-evaluation-bun.test.ts: module code that a timeout stops. Prints one JSON line
// for each scenario that it is asked for.
//
//   bun vm-module-graph-cut-short-fixture.js <scenario>...
//
// Most of the code that must be stopped is a loop without an end, which only the timeout of a vm run stops. That
// is why the scenarios run in a child process: a timeout that does not work hangs the child, not the tests.
const vm = require("node:vm");
const { drainMicrotasks } = require("bun:jsc");

function graph(sources, host = {}, contextOptions = {}) {
  const log = [];
  host = { log: entry => void log.push(entry), ...host };
  // `null`: modules without a context. Their code sees the globals of this file.
  const context = contextOptions === null ? undefined : vm.createContext(host, contextOptions);
  if (!context) Object.assign(globalThis, host);
  const modules = {};
  for (const [identifier, source] of Object.entries(sources))
    modules[identifier] = new vm.SourceTextModule(source, { identifier, context });
  const linker = specifier => modules[specifier];
  return {
    log,
    context,
    modules,
    linker,
    link: (root = Object.keys(sources)[0]) => modules[root].link(linker),
    statuses: () => Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status])),
    synthetic(identifier, exportNames, evaluateCallback) {
      const module = new vm.SyntheticModule(exportNames, () => evaluateCallback(module), { identifier, context });
      return (modules[identifier] = module);
    },
  };
}

const rejection = promise =>
  promise.then(
    () => {
      throw new Error("the promise did not reject");
    },
    error => error,
  );
const thrownBy = fn => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("the function did not throw");
};
// What cut a run short, or undefined for a run that ended in its own time.
const stoppedBy = promise =>
  promise.then(
    () => undefined,
    error => error,
  );
const stoppedBySync = fn => {
  try {
    fn();
  } catch (error) {
    return error;
  }
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const afterEvaluate = { microtaskMode: "afterEvaluate" };
const timeout = 10;
// A native call that outlasts the timeout. It does not look at the termination request, and when it is the last
// thing that module code does, that code returns. JSC then raises the termination in its walk, not in the code.
// untilReached() makes the call longer when a deadline passed only after it.
let blockFor = 5 * timeout;
const block = () => Bun.sleepSync(blockFor);

// What a program can read of the error of each module: the code of an Error, or what it is instead.
const errors = g =>
  Object.fromEntries(
    Object.entries(g.modules)
      .filter(([, module]) => module.status === "errored")
      .map(([name, { error }]) => [name, error !== null && typeof error === "object" ? error.code : String(error)]),
  );

// No result depends on how long the timeout is, but the deadline can pass before the code that a scenario is
// about, or after it. A scenario needs the run that was cut short right after `marker` was logged, so it tries
// until it has one: `scenario` gives its graph, what cut the run short (`error` or `thrown`), and the log at that
// moment when code logs more afterwards (`logThen`). In every run, also in those that are dropped, no module is
// left "evaluating" or with an error that is not the error of a run.
async function untilReached(marker, scenario) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await scenario();
    for (const [name, module] of Object.entries(result.g.modules)) {
      if (module.status === "evaluating") throw new Error(`${name} is "evaluating" after the run`);
      if (module.status === "errored" && (module.error === null || typeof module.error !== "object"))
        throw new Error(`the error of ${name} is ${typeof module.error}: ${String(module.error)}`);
    }
    const log = result.logThen ?? result.g.log;
    if ((result.error ?? result.thrown) && log.at(-1) === marker) return result;
    // The code went on after the marker, so the deadline was late for the native call.
    if (log.includes(marker)) blockFor = Math.min(2 * blockFor, 1600);
  }
  throw new Error(`no run was cut short at ${JSON.stringify(marker)}`);
}

const scenarios = {
  // The walk of Evaluate(): every module on the way to the code that was stopped gets the error.
  async "body"() {
    const { g, error } = await untilReached("b", async () => {
      const g = graph({ a: `import "b"; import "c"; log("a");`, b: `log("b"); for (;;) {}`, c: `log("c");` });
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const { a, b, c } = g.modules;
    const stopped = { log: [...g.log], statuses: g.statuses(), sameError: a.error === error && b.error === error };
    // A module does not run again: evaluate() rejects with the same error.
    const again = (await rejection(a.evaluate())) === error && (await rejection(b.evaluate())) === error;
    await c.evaluate();
    return { code: error.code, stopped, again, log: g.log };
  },

  async "cycle"() {
    const { g, error } = await untilReached("b", async () => {
      const g = graph({
        a: `import "b"; log("a");`,
        b: `import "c"; log("b"); for (;;) {}`,
        c: `import "a"; log("c");`,
      });
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const sameError = Object.values(g.modules).every(module => module.error === error);
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  // Node lets the body of t go on after its await, and logs "t2" and "t finally". JSC gives up the code of a
  // module that gets an error, and t gets the error of its cycle while it waits.
  async "cycle with a module that waits at a top-level await"() {
    const { g, error } = await untilReached("x", async () => {
      const g = graph({
        a: `import "t"; import "x"; log("a");`,
        t: `import "a"; log("t1"); try { await 0; log("t2"); } finally { log("t finally"); }`,
        x: `log("x"); for (;;) {}`,
      });
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    await turn();
    const sameError = Object.values(g.modules).every(module => module.error === error);
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "evaluateCallback"() {
    const { g, error } = await untilReached("s", async () => {
      const g = graph({ a: `import "b"; import "s"; log("a");`, b: `log("b");` });
      g.synthetic("s", [], () => {
        g.log.push("s");
        for (;;) {}
      });
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const { a, s } = g.modules;
    const sameError = a.error === error && s.error === error && (await rejection(s.evaluate())) === error;
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "evaluateCallback of the module that evaluate() is called on"() {
    const { g, error } = await untilReached("s", async () => {
      const g = graph({});
      g.synthetic("s", [], () => {
        g.log.push("s");
        for (;;) {}
      });
      return { g, error: await stoppedBy(g.modules.s.evaluate({ timeout })) };
    });
    const { s } = g.modules;
    const sameError = s.error === error && (await rejection(s.evaluate())) === error;
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  // The termination belongs to the Script, so it goes through evaluate(), and the modules get the error that
  // the Script throws.
  async "Script around evaluate(): body"() {
    const { g, thrown, returned } = await untilReached("b", async () => {
      const g = graph({ a: `import "b"; log("a");`, b: `log("b"); for (;;) {}` });
      await g.link();
      let returned = false;
      g.context.evaluate = () => {
        g.modules.a.evaluate();
        returned = true;
      };
      return { g, thrown: stoppedBySync(() => vm.runInContext("evaluate()", g.context, { timeout })), returned };
    });
    const { a, b } = g.modules;
    const sameError = a.error === thrown && b.error === thrown && (await rejection(a.evaluate())) === thrown;
    return { code: thrown.code, returned, log: g.log, statuses: g.statuses(), sameError };
  },

  async "Script around evaluate(): evaluateCallback"() {
    const { g, thrown } = await untilReached("s", async () => {
      const g = graph({ a: `import "s"; log("a");` });
      g.synthetic("s", [], () => {
        g.log.push("s");
        for (;;) {}
      });
      await g.link();
      g.context.evaluate = () => void g.modules.a.evaluate();
      return { g, thrown: stoppedBySync(() => vm.runInContext("evaluate()", g.context, { timeout })) };
    });
    const sameError = g.modules.a.error === thrown && g.modules.s.error === thrown;
    return { code: thrown.code, log: g.log, statuses: g.statuses(), sameError };
  },

  // `import defer` runs a module at the first read of its namespace, which can be in a Script.
  async "deferred module that a Script reads first"() {
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
      return { g, thrown: stoppedBySync(() => vm.runInContext("read()", g.context, { timeout })) };
    });
    const stopped = { log: [...g.log], statuses: g.statuses(), sameError: g.modules.b.error === thrown };
    // The next read does not run b again, and a module that imports b does not run.
    const again =
      thrownBy(() => vm.runInContext("read()", g.context)) === thrown &&
      (await rejection(g.modules.c.evaluate())) === thrown;
    return { code: thrown.code, stopped, again, log: g.log };
  },

  async "evaluate() with a timeout from a body that a job resumed"() {
    const { g, error } = await untilReached("spin", async () => {
      let inner, logThen;
      const g = graph(
        {
          x: `log("x1"); await 0; log("x2"); nested(); log("x3"); await 0; log("x4");`,
          y: `import "x"; import "spin"; log("y");`,
          spin: `log("spin"); for (;;) {}`,
        },
        {
          nested: () => {
            inner = g.modules.y.evaluate({ timeout });
            logThen = [...g.log];
          },
        },
        afterEvaluate,
      );
      await g.link("x");
      await g.link("y");
      await g.modules.x.evaluate();
      return { g, error: await stoppedBy(inner), logThen };
    });
    const sameError = g.modules.y.error === error && g.modules.spin.error === error;
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  // As in Node: the checkpoint of a run that module code starts is done at once, inside the timeout of that run.
  async "run with a timeout from a body: the jobs that it queues run inside it"() {
    const { g, thrown } = await untilReached("job", async () => {
      let thrown, logThen;
      const g = graph(
        { m: `log("m1"); host(); log("m2");` },
        {
          host: () => {
            const job = `Promise.resolve().then(() => { log("job"); for (;;) {} })`;
            thrown = stoppedBySync(() => vm.runInContext(job, g.context, { timeout }));
            logThen = [...g.log];
          },
        },
        afterEvaluate,
      );
      await g.link();
      // With a timeout: when the deadline of the run passed before its checkpoint, this call runs the job.
      await stoppedBy(g.modules.m.evaluate({ timeout: 1000 }));
      return { g, thrown, logThen };
    });
    return { nested: thrown.code, log: g.log, statuses: g.statuses() };
  },

  // A root that imports many small modules, and deadlines of 1 to 4 ms: most of them pass while the walk is between
  // two bodies, in the code of JSC. Wherever the deadline lands, the root has the error of the run, and the
  // modules that did not run are left "linked".
  async "wide graph: the deadline lands anywhere in the walk"() {
    const leaves = Number(process.env.VM_MODULE_GRAPH_LEAVES);
    const seen = new Set();
    const context = vm.createContext({ count: 0 });
    for (let attempt = 0; attempt < 6; attempt++) {
      context.count = 0;
      const modules = [];
      let source = "";
      for (let i = 0; i < leaves; i++) {
        modules.push(new vm.SourceTextModule("count++;", { identifier: String(i), context }));
        source += `import "${i}";\n`;
      }
      const root = new vm.SourceTextModule(source, { identifier: "root", context });
      await root.link(specifier => modules[Number(specifier)]);
      const error = await root.evaluate({ timeout: 1 + (attempt % 4) }).then(
        () => undefined,
        error => error,
      );
      const statuses = new Set(modules.map(module => module.status));
      const done = root.status === "evaluated" && context.count === leaves && [...statuses].join() === "evaluated";
      if (!error) {
        seen.add(done ? "ok" : `no error: ${root.status}, ${[...statuses]}`);
        continue;
      }
      if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        seen.add(`not the error of the run: ${String(error)}`);
        continue;
      }
      if (root.status === "evaluated") {
        // The deadline passed after the last body. The call rejects, and the graph is done, as in Node.
        seen.add(done && (await root.evaluate()) === undefined ? "ok" : `not done: ${[...statuses]}, ${context.count}`);
        continue;
      }
      const stopped = modules.filter(module => module.status === "errored");
      const consistent =
        root.status === "errored" &&
        root.error === error &&
        // The body that the deadline stopped, if it stopped one.
        stopped.length <= 1 &&
        stopped.every(module => module.error === error) &&
        [...statuses].every(status => status === "evaluated" || status === "linked" || status === "errored") &&
        (await rejection(root.evaluate())) === error;
      seen.add(consistent ? "ok" : `not consistent: ${root.status}, ${[...statuses]}`);
    }
    return [...seen];
  },

  // The deadline passes in a native call at the end of the code, and JSC raises the termination in its walk.
  async "body that ends in a native call"() {
    const results = {};
    for (const [kind, contextOptions] of [
      ["the main context", null],
      ["a context", {}],
      ["an afterEvaluate context", afterEvaluate],
    ]) {
      const { g, error } = await untilReached("c", async () => {
        const g = graph(
          { a: `import "b"; log("a");`, b: `import "c"; log("b");`, c: `log("c"); block();` },
          { block },
          contextOptions,
        );
        await g.link();
        return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
      });
      const sameError = Object.values(g.modules).every(module => module.error === error);
      const again = (await rejection(g.modules.a.evaluate())) === error;
      results[kind] = { code: error.code, log: g.log, statuses: g.statuses(), sameError, again };
    }
    return results;
  },

  async "evaluateCallback that ends in a native call"() {
    const { g, error } = await untilReached("s", async () => {
      const g = graph({ a: `import "s"; log("a");` });
      g.synthetic("s", [], () => {
        g.log.push("s");
        block();
      });
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const sameError = g.modules.a.error === error && g.modules.s.error === error;
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "Script around evaluate(): evaluateCallback that ends in a native call"() {
    const { g, thrown } = await untilReached("s", async () => {
      const g = graph({ a: `import "s"; log("a");` });
      g.synthetic("s", [], () => {
        g.log.push("s");
        block();
      });
      await g.link();
      g.context.evaluate = () => void g.modules.a.evaluate();
      return { g, thrown: stoppedBySync(() => vm.runInContext("evaluate()", g.context, { timeout })) };
    });
    const sameError = g.modules.a.error === thrown && g.modules.s.error === thrown;
    return { code: thrown.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "deferred module that ends in a native call, read by a Script"() {
    const { g, thrown } = await untilReached("b", async () => {
      const g = graph(
        {
          a: `import defer * as b from "b"; globalThis.read = () => b.x; log("a");`,
          b: `export let x = 1; log("b"); block();`,
        },
        { block },
      );
      await g.link();
      await g.modules.a.evaluate({ timeout: 1000 });
      return { g, thrown: stoppedBySync(() => vm.runInContext("read()", g.context, { timeout })) };
    });
    const sameError = g.modules.b.error === thrown && thrownBy(() => vm.runInContext("read()", g.context)) === thrown;
    return { code: thrown.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "a later run that is cut short changes no error of an earlier one"() {
    const { g, error } = await untilReached("b", async () => {
      const g = graph({ a: `import "b"; log("a");`, b: `log("b"); block();` }, { block });
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const later = thrownBy(() => vm.runInContext("for (;;) {}", vm.createContext({}), { timeout: 2 * timeout }));
    const { a, b } = g.modules;
    return {
      messages: [error.message, later.message],
      sameError: a.error === error && b.error === error && later !== error,
      statuses: g.statuses(),
    };
  },

  // A plain ES module that a run stops keeps the value that JSC gives a termination, and a later import() of it
  // rejects with that value. A node:vm module that throws that value keeps it too when a later run is cut short.
  async "a module that threw the value of a termination keeps it"() {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "vm-module-graph-"));
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const file = path.join(dir, `spin-${attempt}.mjs`);
        fs.writeFileSync(file, "globalThis.spinStarted = true; for (;;) {}");
        globalThis.spinStarted = false;
        const context = vm.createContext({ load: () => require(file) });
        const stopped = stoppedBySync(() => vm.runInContext("load()", context, { timeout }));
        // The deadline passed before the module started: an import() of it now would not end.
        if (!stopped || !globalThis.spinStarted) continue;
        const value = await import(file).then(
          () => "fulfilled",
          error => error,
        );
        const m = new vm.SourceTextModule("throw value;", { context: vm.createContext({ value }) });
        await m.link(() => {});
        const thrown = await rejection(m.evaluate());
        const later = thrownBy(() => vm.runInContext("for (;;) {}", vm.createContext({}), { timeout }));
        return {
          value: typeof value,
          kept: thrown === value && m.error === value,
          codes: [stopped.code, later.code],
        };
      }
      throw new Error("no run reached the module");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  // In an afterEvaluate context the timeout also bounds the microtask checkpoint of evaluate(), and a job of
  // that checkpoint can resume a module body.
  async "job: body after its top-level await"() {
    const { g, error } = await untilReached("b2", async () => {
      const g = graph(
        { a: `import "b"; import "c"; log("a");`, b: `log("b1"); await 0; log("b2"); for (;;) {}`, c: `log("c");` },
        {},
        afterEvaluate,
      );
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const { a, b } = g.modules;
    const sameError = a.error === error && b.error === error && (await rejection(a.evaluate())) === error;
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  // c was next in the job that ran b. Its body never started, and no job is left that starts it.
  async "job: body in the job that ends the await of its dependency"() {
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
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const { a, b, c } = g.modules;
    const sameError = [a, b, c].every(module => module.error === error) && (await rejection(c.evaluate())) === error;
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  // w waits for a promise of the main context, so the checkpoint that was stopped in b had nothing of w to run.
  async "job: a module that waits, or waits for a module that waits, is not stopped"() {
    let open;
    const { g, error } = await untilReached("b2", async () => {
      const gate = new Promise(resolve => (open = resolve));
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
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const stopped = { log: [...g.log], statuses: g.statuses() };
    open();
    await turn();
    const later = await g.modules.c.evaluate();
    return { code: error.code, stopped, later: String(later), log: g.log, statuses: g.statuses() };
  },

  // No other checkpoint of the context is needed for the promise of the first call.
  async "job: module of another graph that the checkpoint resumed"() {
    let open;
    const { g, error, first } = await untilReached("p2", async () => {
      const gate = new Promise(resolve => (open = resolve));
      const g = graph(
        { ip: `import "p"; log("ip");`, p: `log("p1"); await gate; log("p2"); for (;;) {}`, q: `log("q");` },
        { gate },
        afterEvaluate,
      );
      await g.link("ip");
      await g.link("q");
      const first = rejection(g.modules.ip.evaluate());
      open();
      await turn();
      return { g, first, error: await stoppedBy(g.modules.q.evaluate({ timeout })) };
    });
    const { ip, p } = g.modules;
    const sameError = ip.error === error && p.error === error && (await first) === error;
    return { code: error.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "job: checkpoint of a Script"() {
    let open;
    const { g, thrown, first } = await untilReached("p2", async () => {
      const gate = new Promise(resolve => (open = resolve));
      const g = graph(
        { ip: `import "p"; log("ip");`, p: `log("p1"); await gate; log("p2"); for (;;) {}` },
        { gate },
        afterEvaluate,
      );
      await g.link();
      const first = rejection(g.modules.ip.evaluate());
      open();
      await turn();
      return { g, first, thrown: stoppedBySync(() => vm.runInContext("0", g.context, { timeout })) };
    });
    const { ip, p } = g.modules;
    const sameError = ip.error === thrown && p.error === thrown && (await first) === thrown;
    return { code: thrown.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "job: Script around evaluate()"() {
    const { g, thrown } = await untilReached("b2", async () => {
      const g = graph(
        { a: `import "b"; log("a");`, b: `log("b1"); await 0; log("b2"); for (;;) {}` },
        {},
        afterEvaluate,
      );
      await g.link();
      g.context.evaluate = () => void g.modules.a.evaluate();
      return { g, thrown: stoppedBySync(() => vm.runInContext("evaluate()", g.context, { timeout })) };
    });
    const { a, b } = g.modules;
    const sameError = a.error === thrown && b.error === thrown && (await rejection(a.evaluate())) === thrown;
    return { code: thrown.code, log: g.log, statuses: g.statuses(), sameError };
  },

  async "job that is not of a module"() {
    const { g, error } = await untilReached("job", async () => {
      const g = graph(
        { a: `log("a"); globalThis.spinLater = () => Promise.resolve().then(() => { log("job"); for (;;) {} });` },
        {},
        afterEvaluate,
      );
      await g.link();
      await g.modules.a.evaluate();
      g.context.spinLater();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    return { code: error.code, statuses: g.statuses(), later: String(await g.modules.a.evaluate()) };
  },

  // The body of x ran to its end, and JSC dropped the job that was to say so. The module is evaluated. The module
  // that waits for it was to run in that job, so it has the error of the run.
  async "job: body that ended before the job that was stopped"() {
    const { g, error } = await untilReached("job of x", async () => {
      const g = graph(
        {
          r: `import "x"; log("r");`,
          x: `log("x1"); await 0; Promise.resolve().then(() => { log("job of x"); for (;;) {} }); log("x2");`,
        },
        {},
        afterEvaluate,
      );
      await g.link();
      return { g, error: await stoppedBy(g.modules.r.evaluate({ timeout })) };
    });
    const { r, x } = g.modules;
    return {
      code: error.code,
      log: g.log,
      statuses: g.statuses(),
      sameError: r.error === error,
      x: String(await x.evaluate()),
    };
  },

  // The body of x threw, and JSC dropped the job that was to say so. The module has its own error.
  async "job: body that threw before the job that was stopped"() {
    const { g, error } = await untilReached("job of x", async () => {
      const g = graph(
        {
          r: `import "x"; log("r");`,
          x: `log("x1"); await 0; Promise.resolve().then(() => { log("job of x"); for (;;) {} }); throw new Error("from x");`,
        },
        {},
        afterEvaluate,
      );
      await g.link();
      return { g, error: await stoppedBy(g.modules.r.evaluate({ timeout })) };
    });
    const { r, x } = g.modules;
    return {
      code: error.code,
      log: g.log,
      statuses: g.statuses(),
      messages: [x.error.message, r.error.message],
      sameError: r.error === x.error,
    };
  },

  // The body of x ended, and JSC dropped the job that was to say so. p waits for y too, so that job had nothing
  // of p to run, and p runs when y is done.
  async "job: module that waits for a second module is not stopped"() {
    let openY;
    const { g, thrown, first } = await untilReached("job", async () => {
      let openX;
      const gateX = new Promise(resolve => (openX = resolve));
      const gateY = new Promise(resolve => (openY = resolve));
      const g = graph(
        {
          p: `import "x"; import "y"; log("p");`,
          x: `log("x1"); await gateX; log("x2");`,
          y: `log("y1"); await gateY; log("y2");`,
        },
        { gateX, gateY },
        afterEvaluate,
      );
      await g.link();
      const first = g.modules.p.evaluate();
      openX();
      await turn();
      const job = `Promise.resolve().then(() => { log("job"); for (;;) {} })`;
      return { g, first, thrown: stoppedBySync(() => vm.runInContext(job, g.context, { timeout })) };
    });
    const stopped = g.statuses();
    openY();
    await turn();
    await g.modules.y.evaluate();
    return { code: thrown.code, stopped, first: String(await first), log: g.log };
  },

  // q waits for x on the stack of the walk of root, in a cycle that is not closed: the job that x ends in runs q.
  // h starts a run that is stopped behind the end of x, so q has the error of that run, and the walk fails with it.
  async "job: module on the stack of a walk that the stopped job was to run"() {
    const { g, nested, error } = await untilReached("job", async () => {
      let nested, logThen;
      const g = graph(
        {
          root: `import "q"; import "h"; log("root");`,
          q: `import "root"; import "x"; log("q");`,
          x: `log("x1"); await gate; log("x2");`,
          h: `log("h1"); host(); log("h2");`,
        },
        {
          host: () => {
            const job = `open(); Promise.resolve().then(() => { log("job"); for (;;) {} })`;
            nested = stoppedBySync(() => vm.runInContext(job, g.context, { timeout }));
            logThen = [...g.log];
          },
        },
        afterEvaluate,
      );
      // A promise of the context: its reaction is a job of the context's queue at once.
      vm.runInContext("globalThis.gate = new Promise(resolve => { globalThis.open = resolve; });", g.context);
      await g.link();
      // With a timeout: when the deadline of the run of h passed before its checkpoint, this call runs the job.
      const error = await stoppedBy(g.modules.root.evaluate({ timeout: 1000 }));
      return { g, nested, error, logThen };
    });
    const { root, q } = g.modules;
    const sameError = error === nested && root.error === nested && q.error === nested;
    return { code: nested.code, log: g.log, statuses: g.statuses(), sameError };
  },

  // p ran in a job while it waited on the stack of the walk of root, and m ended its body there. The walk made
  // them "evaluated" when it closed the cycle, so a later run that is cut short in a job finds nothing to stop.
  async "job: modules that finished inside a walk are not stopped by a later run"() {
    const { g, thrown } = await untilReached("job", async () => {
      const g = graph(
        {
          root: `import "p"; import "m"; import "c"; log("root");`,
          p: `import "root"; import "t"; log("p");`,
          m: `import "root"; log("m1"); await 0; log("m2");`,
          t: `log("t1"); await 0; log("t2");`,
          c: `log("c1"); drain(); log("c2");`,
        },
        { drain: () => void vm.runInContext("0", g.context) },
        afterEvaluate,
      );
      await g.link();
      await g.modules.root.evaluate();
      const job = `Promise.resolve().then(() => { log("job"); for (;;) {} })`;
      return { g, thrown: stoppedBySync(() => vm.runInContext(job, g.context, { timeout })) };
    });
    return { code: thrown.code, log: g.log, statuses: g.statuses() };
  },

  // Two runs, one inside the other, and both deadlines pass in one native call. Each run throws its own error,
  // and the module has the error of the run that evaluated it.
  async "two runs that are cut short, one inside the other"() {
    const { g, thrown } = await untilReached("x2", async () => {
      const g = graph(
        { root: `import "x"; log("root");`, x: `log("x1"); await 0; log("x2"); block();` },
        { block },
        afterEvaluate,
      );
      await g.link();
      const outer = vm.createContext({ nested: () => void g.modules.root.evaluate({ timeout }).catch(() => {}) });
      const thrown = stoppedBySync(() => vm.runInContext("nested(); for (;;) {}", outer, { timeout: 2 * timeout }));
      return { g, thrown };
    });
    return { messages: [thrown.message, g.modules.root.error.message], statuses: g.statuses() };
  },

  // The promises reject in the order in which the modules were to run, whatever the order of their creation.
  async "job: two roots that wait for the module that was stopped"() {
    const orders = {};
    for (const createdFirst of ["p1", "p2"]) {
      const { order } = await untilReached("d2", async () => {
        const sources = { p1: `import "d"; log("p1");`, p2: `import "d"; log("p2");` };
        let open;
        const gate = new Promise(resolve => (open = resolve));
        const g = graph({ d: `log("d1"); await gate; log("d2"); for (;;) {}` }, { gate }, afterEvaluate);
        for (const name of createdFirst === "p1" ? ["p1", "p2"] : ["p2", "p1"])
          g.modules[name] = new vm.SourceTextModule(sources[name], { identifier: name, context: g.context });
        await g.modules.p1.link(g.linker);
        await g.modules.p2.link(g.linker);
        const order = [];
        g.modules.p1.evaluate().then(
          () => order.push("p1 fulfilled"),
          () => order.push("p1"),
        );
        g.modules.p2.evaluate().then(
          () => order.push("p2 fulfilled"),
          () => order.push("p2"),
        );
        open();
        await turn();
        const error = await stoppedBy(g.modules.d.evaluate({ timeout }));
        await turn();
        return { g, order, error };
      });
      orders[createdFirst + " created first"] = order;
    }
    return orders;
  },

  // Both roots were to run in the job that the run stopped in p1. The run gives them its error in the order in
  // which they were to run, whatever the order of their creation.
  async "job: two roots that were to run in the job that was stopped"() {
    const orders = {};
    for (const createdFirst of ["p1", "p2"]) {
      const { order } = await untilReached("p1", async () => {
        const sources = { p1: `import "t"; log("p1"); for (;;) {}`, p2: `import "t"; log("p2");` };
        let open;
        const gate = new Promise(resolve => (open = resolve));
        const g = graph({ t: `log("t1"); await gate; log("t2");` }, { gate }, afterEvaluate);
        for (const name of createdFirst === "p1" ? ["p1", "p2"] : ["p2", "p1"])
          g.modules[name] = new vm.SourceTextModule(sources[name], { identifier: name, context: g.context });
        await g.modules.p1.link(g.linker);
        await g.modules.p2.link(g.linker);
        const order = [];
        g.modules.p1.evaluate().then(
          () => order.push("p1 fulfilled"),
          () => order.push("p1"),
        );
        g.modules.p2.evaluate().then(
          () => order.push("p2 fulfilled"),
          () => order.push("p2"),
        );
        open();
        await turn();
        const error = await stoppedBy(g.modules.t.evaluate({ timeout }));
        await turn();
        return { g, order, error };
      });
      orders[createdFirst + " created first"] = order;
    }
    return orders;
  },

  async "walk that the timeout stops does no checkpoint"() {
    const { g, error } = await untilReached("b", async () => {
      const g = graph(
        { a: `import "b"; log("a");`, b: `Promise.resolve().then(() => log("job of b")); log("b"); for (;;) {}` },
        {},
        afterEvaluate,
      );
      await g.link();
      return { g, error: await stoppedBy(g.modules.a.evaluate({ timeout })) };
    });
    const stopped = [...g.log];
    // evaluate() of an errored module runs nothing, and does the checkpoint of its context.
    const again = (await rejection(g.modules.a.evaluate())) === error;
    return { code: error.code, stopped, again, log: g.log };
  },

  // JSC, like V8, drops the jobs that are queued behind the job that a termination stops, and does not say
  // which. The module that the call was on did not finish, so it has the error of the run (in Node it stays
  // "evaluated", and its evaluate() never settles). A module that it imports and whose resuming job was dropped
  // looks like one that still waits. Bun leaves that one as Node does.
  async "job: module that waits at a top-level await when its resuming job is dropped"() {
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
      return { g, error: await stoppedBy(g.modules.r.evaluate({ timeout })) };
    });
    let settled = false;
    g.modules.x.evaluate().then(
      () => (settled = true),
      () => (settled = true),
    );
    await turn();
    await g.modules.s.evaluate();
    await turn();
    return { code: error.code, log: g.log, statuses: g.statuses(), settled };
  },

  // The jobs of the main queue do not run in a checkpoint that node:vm starts. A body that one of them resumes
  // inside a run, because module code drains the main queue there, is left as Node leaves it.
  async "job of the main queue"() {
    const results = {};
    for (const [kind, contextOptions] of [
      ["the main context", null],
      ["a context", {}],
    ]) {
      const { g, error, seen } = await untilReached("p2", async () => {
        // The p of a run that was dropped ends here, outside a run.
        await turn();
        let open;
        let inside = false;
        const seen = { first: "pending" };
        const gate = new Promise(resolve => (open = resolve));
        const g = graph(
          {
            root: `import "x"; log("root");`,
            x: `log("x"); drainMicrotasks();`,
            // Inside the run the loop has no end. When the deadline passed before x, the event loop resumes p.
            p: `log("p1"); await gate; log("p2"); while (insideTheRun()) {}`,
          },
          { gate, drainMicrotasks, insideTheRun: () => inside },
          contextOptions,
        );
        await g.link("p");
        await g.link("root");
        g.modules.p.evaluate().then(
          () => (seen.first = "fulfilled"),
          () => (seen.first = "rejected"),
        );
        open();
        // No turn of the event loop here: it would resume p outside the run.
        inside = true;
        const run = g.modules.root.evaluate({ timeout });
        inside = false;
        return { g, seen, error: await stoppedBy(run) };
      });
      await turn();
      results[kind] = { code: error.code, log: g.log, statuses: g.statuses(), errors: errors(g), first: seen.first };
    }
    return results;
  },
};

(async () => {
  for (const name of process.argv.slice(2)) console.log(JSON.stringify({ [name]: await scenarios[name]() }));
})();
