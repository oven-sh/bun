// A node:vm run stops the evaluation of a plain ES module, then the program uses that module again.
// vm-plain-module-cut-short.test.ts runs this file in a child process.
//
//   bun vm-plain-module-cut-short-fixture.cjs <timeout|sigint> <scenario>...
//
// The working directory must be empty. The output has one JSON line for each scenario. Node prints the same lines,
// except where the test says that it does not.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

// Each body logs its name. The body to stop then waits, off the CPU, for `wait` milliseconds: longer than the run
// has. The run wakes that wait and stops the body in it, so no loop has to be stopped while it spins. A wait that
// ends by itself logs that, and the attempt is then made again.
const cutShort = (globalThis.cutShort = { log: [], wait: 0, sigint: false, deferred: undefined });
cutShort.sendSigint = () => process.kill(process.pid, "SIGINT");
const waitIn = (name, cutShort = "globalThis.cutShort") => `
    if (${cutShort}.sigint) ${cutShort}.sendSigint();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${cutShort}.wait);
    ${cutShort}.log.push("${name}: the wait ended");`;
// In the body of an ES module: require() of a module that is evaluating. Node throws there, and Bun returns.
const requireWhileEvaluating = file => `
    import { createRequire } from "node:module";
    try {
      createRequire(import.meta.url)("./${file}");
    } catch {}`;

const modules = {
  "wait.mjs": `
    globalThis.cutShort.log.push("wait");
    export const before = 1;
    ${waitIn("wait")}
    export const after = 2;
  `,
  "importer.mjs": `
    import "./wait.mjs";
    globalThis.cutShort.log.push("importer");
  `,
  "root.mjs": `
    import "./leaf.mjs";
    import "./wait.mjs";
    import "./never.mjs";
    globalThis.cutShort.log.push("root");
  `,
  "leaf.mjs": `globalThis.cutShort.log.push("leaf");`,
  "never.mjs": `globalThis.cutShort.log.push("never");`,
  "deferred.mjs": `
    import defer * as wait from "./wait.mjs";
    globalThis.cutShort.deferred = wait;
  `,
  "self.mjs": `
    globalThis.cutShort.log.push("self");
    ${requireWhileEvaluating("self.mjs")}
    ${waitIn("self")}
  `,
  "self-importer.mjs": `
    import "./self.mjs";
    globalThis.cutShort.log.push("self-importer");
  `,
  "cycle-a.mjs": `
    globalThis.cutShort.log.push("cycle-a");
    ${requireWhileEvaluating("cycle-b.mjs")}
  `,
  "cycle-b.mjs": `
    import "./cycle-a.mjs";
    globalThis.cutShort.log.push("cycle-b");
    ${waitIn("cycle-b")}
  `,
  // import() of join-root.mjs, from a module that it requires and from its own body, while it is evaluating.
  "join-root.mjs": `
    globalThis.cutShort.log.push("join-root");
    ${requireWhileEvaluating("join-dependency.mjs")}
    globalThis.cutShort.joined.push(globalThis.cutShort.settled(import("./join-root.mjs")));
    ${waitIn("join-root")}
  `,
  "join-dependency.mjs": `
    globalThis.cutShort.log.push("join-dependency");
    globalThis.cutShort.joined.push(globalThis.cutShort.settled(import("./join-root.mjs")));
  `,
};

const describe = value =>
  value === null ? "null" : typeof value === "object" ? String(value.code ?? value.name) : `${typeof value} ${value}`;
const thrownBy = fn => {
  try {
    fn();
    return "returned";
  } catch (error) {
    return "threw " + describe(error);
  }
};
const settled = promise =>
  promise.then(
    () => "fulfilled",
    error => "rejected with " + describe(error),
  );
const imported = file => settled(import(pathToFileURL(file).href));
// The modules of the "joins" scenario say how their import() ended. The handlers are there before the run stops.
cutShort.settled = settled;
// For a promise that nothing settles: ten turns of the event loop, and not a wait for an amount of time.
const settledSoon = async described => {
  let result = "pending";
  described.then(value => (result = value));
  for (let turn = 0; turn < 10 && result === "pending"; turn++) await new Promise(resolve => setImmediate(resolve));
  return result;
};
// `error` of a vm.Module throws when the module has no error.
const errorOf = module => (module.status === "errored" ? describe(module.error) : "none");

// Each entry point that takes `timeout` and `breakOnSigint`. The code that it runs calls load().
const entryPoints = {
  "vm.runInContext": (load, options) => vm.runInContext("load()", vm.createContext({ load }), options),
  "vm.runInNewContext": (load, options) => vm.runInNewContext("load()", { load }, options),
  "vm.runInThisContext": (load, options) => {
    globalThis.load = load;
    return vm.runInThisContext("load()", options);
  },
  "script.runInContext": (load, options) => new vm.Script("load()").runInContext(vm.createContext({ load }), options),
  "script.runInNewContext": (load, options) => new vm.Script("load()").runInNewContext({ load }, options),
  "script.runInThisContext": (load, options) => {
    globalThis.load = load;
    return new vm.Script("load()").runInThisContext(options);
  },
};
const stopped = (load, options) => thrownBy(() => entryPoints["vm.runInContext"](load, options));

// A scenario has `run`, which says how the run that `options` limits ended, and `after`, which uses the modules
// again. `log` is the log after a run that stopped the body in its wait. `dir` has a new copy of every module.
const scenarios = {
  "createRequire()": {
    log: "wait",
    run: (dir, options) => {
      const { createRequire } = require("node:module");
      return stopped(() => createRequire(path.join(dir, "main.cjs"))("./wait.mjs"), options);
    },
    after: async dir => ({ import: await imported(path.join(dir, "wait.mjs")) }),
  },
  "module.require()": {
    log: "wait",
    run: (dir, options) => stopped(() => module.require(path.join(dir, "wait.mjs")), options),
    after: async dir => ({ import: await imported(path.join(dir, "wait.mjs")) }),
  },
  // A handler in require.extensions that calls the handler it replaced. Its catch must not run: no script can
  // catch what stops a run.
  "require.extensions": {
    log: "wait",
    run: (dir, options) => {
      const extension = require.extensions[".mjs"] ? ".mjs" : ".js";
      const original = require.extensions[extension];
      const nothing = {};
      let caught = nothing;
      require.extensions[extension] = function (module, filename) {
        try {
          return original(module, filename);
        } catch (error) {
          // Only an assignment: the request to stop is still there, and it ends a catch block at its first call.
          caught = error;
        }
      };
      try {
        const run = stopped(() => require(path.join(dir, "wait.mjs")), options);
        return `${run}, the handler caught ${caught === nothing ? "nothing" : describe(caught)}`;
      } finally {
        require.extensions[extension] = original;
      }
    },
    after: async dir => ({ import: await imported(path.join(dir, "wait.mjs")) }),
  },
  // root.mjs imports leaf.mjs, wait.mjs and never.mjs, in that order.
  "graph": {
    log: "leaf,wait",
    run: (dir, options) => stopped(() => require(path.join(dir, "root.mjs")), options),
    after: async dir => ({
      root: await imported(path.join(dir, "root.mjs")),
      wait: await imported(path.join(dir, "wait.mjs")),
      leaf: await imported(path.join(dir, "leaf.mjs")),
      never: await imported(path.join(dir, "never.mjs")),
    }),
  },
  // importer.mjs imports wait.mjs. It is evaluated for the first time after the run.
  "a later importer": {
    log: "wait",
    run: (dir, options) => stopped(() => require(path.join(dir, "wait.mjs")), options),
    after: async dir => ({
      require: thrownBy(() => require(path.join(dir, "importer.mjs"))),
      requireAgain: thrownBy(() => require(path.join(dir, "importer.mjs"))),
      import: await imported(path.join(dir, "importer.mjs")),
    }),
  },
  // The limit is on the inner of two runs. The outer run goes on.
  "inner run": {
    log: "wait",
    run: (dir, options) => {
      const inner = () => stopped(() => require(path.join(dir, "wait.mjs")), options);
      return "the inner run " + vm.runInContext("inner()", vm.createContext({ inner }), { timeout: 60_000 });
    },
    after: async dir => ({ import: await imported(path.join(dir, "wait.mjs")) }),
  },
  // The limit is on the outer of two runs. It stops the inner run too.
  "outer run": {
    log: "wait",
    run: (dir, options) => {
      const load = () => require(path.join(dir, "wait.mjs"));
      const inner = () => vm.runInContext("load()", vm.createContext({ load }), { timeout: 60_000 });
      return stopped(inner, options);
    },
    after: async dir => ({ import: await imported(path.join(dir, "wait.mjs")) }),
  },
  // The body of a vm.SourceTextModule requires the plain module.
  "SourceTextModule": {
    log: "wait",
    run: async (dir, options) => {
      const context = vm.createContext({ load: () => require(path.join(dir, "wait.mjs")) });
      const module = new vm.SourceTextModule("load()", { context });
      await module.link(() => {
        throw new Error("unreachable");
      });
      const evaluated = await settled(module.evaluate(options));
      return `evaluate() ${evaluated}, status ${module.status}, error ${errorOf(module)}`;
    },
    after: async dir => ({ import: await imported(path.join(dir, "wait.mjs")) }),
  },
  // Only vm.SourceTextModules: the run stops the child, and the parent that imports it is evaluated after the run.
  "SourceTextModule importer": {
    log: "child",
    run: async (dir, options) => {
      const context = vm.createContext({ cutShort });
      const child = new vm.SourceTextModule(
        `cutShort.log.push("child");
         export const before = 1;
         ${waitIn("child", "cutShort")}`,
        { context, identifier: "child" },
      );
      const parent = new vm.SourceTextModule(`import { before } from "child";`, { context, identifier: "parent" });
      await parent.link(() => child);
      cutShort.parent = parent;
      return `child.evaluate() ${await settled(child.evaluate(options))}, error ${errorOf(child)}`;
    },
    after: async () => {
      const evaluated = await settled(cutShort.parent.evaluate());
      return { parent: `evaluate() ${evaluated}, status ${cutShort.parent.status}, error ${errorOf(cutShort.parent)}` };
    },
  },
  // An import() of the module starts before the run and gets to its evaluation after the run.
  "import() in flight": {
    log: "wait",
    run: (dir, options) => {
      cutShort.inFlight = imported(path.join(dir, "wait.mjs"));
      return stopped(() => require(path.join(dir, "wait.mjs")), options);
    },
    after: async dir => ({ inFlight: await cutShort.inFlight, import: await imported(path.join(dir, "wait.mjs")) }),
  },
  // deferred.mjs has `import defer * as wait`. The run makes the first read of that namespace.
  "import defer": {
    log: "wait",
    prepare: dir => require(path.join(dir, "deferred.mjs")),
    run: (dir, options) => stopped(() => cutShort.deferred.before, options),
    after: async dir => ({
      read: thrownBy(() => cutShort.deferred.before),
      readNotReached: thrownBy(() => cutShort.deferred.after),
      import: await imported(path.join(dir, "wait.mjs")),
    }),
  },
  // The body of self.mjs calls require() of self.mjs, so its module is entered again while it is evaluating.
  "a module that requires itself": {
    log: "self",
    run: (dir, options) => stopped(() => require(path.join(dir, "self.mjs")), options),
    after: async dir => ({ import: await imported(path.join(dir, "self.mjs")) }),
  },
  // The same, and the module is not the one that the run asked for: self-importer.mjs imports it.
  "an imported module that requires itself": {
    log: "self",
    run: (dir, options) => stopped(() => require(path.join(dir, "self-importer.mjs")), options),
    after: async dir => ({
      importer: await imported(path.join(dir, "self-importer.mjs")),
      self: await imported(path.join(dir, "self.mjs")),
    }),
  },
  // The body of cycle-a.mjs calls require() of cycle-b.mjs, which imports cycle-a.mjs. The run stops cycle-b.mjs.
  "a require() cycle": {
    log: "cycle-a,cycle-b",
    run: (dir, options) => stopped(() => require(path.join(dir, "cycle-a.mjs")), options),
    after: async dir => ({
      a: await imported(path.join(dir, "cycle-a.mjs")),
      b: await imported(path.join(dir, "cycle-b.mjs")),
    }),
  },
  // Two import() calls find join-root.mjs while it is evaluating. They end as a later import() does.
  "import() that joins the evaluation": {
    log: "join-root,join-dependency",
    run: (dir, options) => {
      cutShort.joined = [];
      return stopped(() => require(path.join(dir, "join-root.mjs")), options);
    },
    after: async dir => ({
      fromDependency: await settledSoon(cutShort.joined[0]),
      fromItsBody: await settledSoon(cutShort.joined[1]),
      import: await imported(path.join(dir, "join-root.mjs")),
    }),
  },
};
for (const [name, entryPoint] of Object.entries(entryPoints)) {
  scenarios[name] = {
    log: "wait",
    run: (dir, options) => thrownBy(() => entryPoint(() => require(path.join(dir, "wait.mjs")), options)),
    after: async dir => ({
      import: await imported(path.join(dir, "wait.mjs")),
      importAgain: await imported(path.join(dir, "wait.mjs")),
    }),
  };
}

async function runScenario(name, how) {
  const scenario = scenarios[name];
  // A timeout can pass before the body starts to wait, or so late that the wait has ended. The log shows both.
  // The next attempt has a longer timeout and new files, so new modules. With "sigint" the body sends the signal
  // and then waits, so the first attempt is enough. A wait that ends in two attempts is not a slow machine: the
  // run does not stop a body that waits.
  let waitsThatEnded = 0;
  for (let attempt = 0, timeout = 100; attempt < 7 && waitsThatEnded < 2; attempt++, timeout *= 2) {
    const dir = path.resolve(`${name.replace(/\W+/g, "-")}-${attempt}`);
    fs.mkdirSync(dir);
    for (const [file, source] of Object.entries(modules)) fs.writeFileSync(path.join(dir, file), source);
    cutShort.log.length = 0;
    cutShort.wait = timeout + 1000;
    cutShort.sigint = how === "sigint";
    cutShort.inFlight = undefined;
    scenario.prepare?.(dir);
    const run = await scenario.run(dir, how === "sigint" ? { breakOnSigint: true } : { timeout });
    // A body that starts after the run does not wait, and does not send a signal.
    cutShort.wait = 0;
    cutShort.sigint = false;
    if (cutShort.log.join() === scenario.log) {
      return { scenario: name, run, ...(await scenario.after(dir)), log: cutShort.log.join() };
    }
    if (cutShort.log.some(entry => entry.endsWith(": the wait ended"))) waitsThatEnded++;
    // What this attempt left to do ends here.
    await new Promise(resolve => setImmediate(resolve));
    await cutShort.inFlight;
  }
  return { scenario: name, run: "no run stopped the module body in its wait", log: cutShort.log.join() };
}

(async () => {
  const [how, ...names] = process.argv.slice(2);
  // A process that ends before the last scenario does not end with 0.
  process.exitCode = 1;
  for (const name of names) console.log(JSON.stringify(await runScenario(name, how)));
  process.exitCode = 0;
})();
