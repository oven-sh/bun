// A node:vm run stops the evaluation of a plain ES module, then the program uses that module again.
// vm-plain-module-cut-short.test.ts runs this file in a child process: only the run ends the loop of spin.mjs
// in time.
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

// Each body logs its name. spin.mjs then waits for `done`, which is set after the run, so a run that stopped
// something else leaves no loop for a later import(). The loop also ends after 10 s: a run that stops nothing
// then gives a line that the test does not expect, and this process does not stay.
const cutShort = (globalThis.cutShort = { log: [], done: false, sigint: false, deferred: undefined });
const spin = "for (const end = Date.now() + 10_000; !cutShort.done && Date.now() < end; );";

const modules = {
  "spin.mjs": `
    globalThis.cutShort.log.push("spin");
    export const before = 1;
    if (globalThis.cutShort.sigint) process.kill(process.pid, "SIGINT");
    ${spin}
    export const after = 2;
  `,
  "importer.mjs": `
    import "./spin.mjs";
    globalThis.cutShort.log.push("importer");
  `,
  "root.mjs": `
    import "./leaf.mjs";
    import "./spin.mjs";
    import "./never.mjs";
    globalThis.cutShort.log.push("root");
  `,
  "leaf.mjs": `globalThis.cutShort.log.push("leaf");`,
  "never.mjs": `globalThis.cutShort.log.push("never");`,
  "deferred.mjs": `
    import defer * as spin from "./spin.mjs";
    globalThis.cutShort.deferred = spin;
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
// again. `log` is the log after a run that stopped the body of spin.mjs. `dir` has a new copy of every module.
const scenarios = {
  "createRequire()": {
    log: "spin",
    run: (dir, options) => {
      const { createRequire } = require("node:module");
      return stopped(() => createRequire(path.join(dir, "main.cjs"))("./spin.mjs"), options);
    },
    after: async dir => ({ import: await imported(path.join(dir, "spin.mjs")) }),
  },
  "module.require()": {
    log: "spin",
    run: (dir, options) => stopped(() => module.require(path.join(dir, "spin.mjs")), options),
    after: async dir => ({ import: await imported(path.join(dir, "spin.mjs")) }),
  },
  // A handler in require.extensions that calls the handler it replaced. Its catch must not run: no script can
  // catch what stops a run.
  "require.extensions": {
    log: "spin",
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
        const run = stopped(() => require(path.join(dir, "spin.mjs")), options);
        return `${run}, the handler caught ${caught === nothing ? "nothing" : describe(caught)}`;
      } finally {
        require.extensions[extension] = original;
      }
    },
    after: async dir => ({ import: await imported(path.join(dir, "spin.mjs")) }),
  },
  // root.mjs imports leaf.mjs, spin.mjs and never.mjs, in that order.
  "graph": {
    log: "leaf,spin",
    run: (dir, options) => stopped(() => require(path.join(dir, "root.mjs")), options),
    after: async dir => ({
      root: await imported(path.join(dir, "root.mjs")),
      spin: await imported(path.join(dir, "spin.mjs")),
      leaf: await imported(path.join(dir, "leaf.mjs")),
      never: await imported(path.join(dir, "never.mjs")),
    }),
  },
  // importer.mjs imports spin.mjs. It is evaluated for the first time after the run.
  "a later importer": {
    log: "spin",
    run: (dir, options) => stopped(() => require(path.join(dir, "spin.mjs")), options),
    after: async dir => ({
      require: thrownBy(() => require(path.join(dir, "importer.mjs"))),
      requireAgain: thrownBy(() => require(path.join(dir, "importer.mjs"))),
      import: await imported(path.join(dir, "importer.mjs")),
    }),
  },
  // The limit is on the inner of two runs. The outer run goes on.
  "inner run": {
    log: "spin",
    run: (dir, options) => {
      const inner = () => stopped(() => require(path.join(dir, "spin.mjs")), options);
      return "the inner run " + vm.runInContext("inner()", vm.createContext({ inner }), { timeout: 60_000 });
    },
    after: async dir => ({ import: await imported(path.join(dir, "spin.mjs")) }),
  },
  // The limit is on the outer of two runs. It stops the inner run too.
  "outer run": {
    log: "spin",
    run: (dir, options) => {
      const load = () => require(path.join(dir, "spin.mjs"));
      const inner = () => vm.runInContext("load()", vm.createContext({ load }), { timeout: 60_000 });
      return stopped(inner, options);
    },
    after: async dir => ({ import: await imported(path.join(dir, "spin.mjs")) }),
  },
  // The body of a vm.SourceTextModule requires the plain module.
  "SourceTextModule": {
    log: "spin",
    run: async (dir, options) => {
      const context = vm.createContext({ load: () => require(path.join(dir, "spin.mjs")) });
      const module = new vm.SourceTextModule("load()", { context });
      await module.link(() => {
        throw new Error("unreachable");
      });
      const evaluated = await settled(module.evaluate(options));
      return `evaluate() ${evaluated}, status ${module.status}, error ${errorOf(module)}`;
    },
    after: async dir => ({ import: await imported(path.join(dir, "spin.mjs")) }),
  },
  // Only vm.SourceTextModules: the run stops the child, and the parent that imports it is evaluated after the run.
  "SourceTextModule importer": {
    log: "child",
    run: async (dir, options) => {
      const context = vm.createContext({ cutShort, sendSigint: () => process.kill(process.pid, "SIGINT") });
      const child = new vm.SourceTextModule(
        `cutShort.log.push("child");
         export const before = 1;
         if (cutShort.sigint) sendSigint();
         ${spin}`,
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
    log: "spin",
    run: (dir, options) => {
      cutShort.inFlight = imported(path.join(dir, "spin.mjs"));
      return stopped(() => require(path.join(dir, "spin.mjs")), options);
    },
    after: async dir => ({ inFlight: await cutShort.inFlight, import: await imported(path.join(dir, "spin.mjs")) }),
  },
  // deferred.mjs has `import defer * as spin`. The run makes the first read of that namespace.
  "import defer": {
    log: "spin",
    prepare: dir => require(path.join(dir, "deferred.mjs")),
    run: (dir, options) => stopped(() => cutShort.deferred.before, options),
    after: async dir => ({
      read: thrownBy(() => cutShort.deferred.before),
      readNotReached: thrownBy(() => cutShort.deferred.after),
      import: await imported(path.join(dir, "spin.mjs")),
    }),
  },
};
for (const [name, entryPoint] of Object.entries(entryPoints)) {
  scenarios[name] = {
    log: "spin",
    run: (dir, options) => thrownBy(() => entryPoint(() => require(path.join(dir, "spin.mjs")), options)),
    after: async dir => ({
      import: await imported(path.join(dir, "spin.mjs")),
      importAgain: await imported(path.join(dir, "spin.mjs")),
    }),
  };
}

async function runScenario(name, how) {
  const scenario = scenarios[name];
  // A timeout can pass before the body of spin.mjs starts. The log shows that. The next attempt has a longer
  // timeout and new files, so new modules. With "sigint" the body sends the signal, so the first attempt is enough.
  for (let attempt = 0, timeout = 100; attempt < 7; attempt++, timeout *= 2) {
    const dir = path.resolve(`${name.replace(/\W+/g, "-")}-${attempt}`);
    fs.mkdirSync(dir);
    for (const [file, source] of Object.entries(modules)) fs.writeFileSync(path.join(dir, file), source);
    cutShort.log.length = 0;
    cutShort.done = false;
    cutShort.sigint = how === "sigint";
    cutShort.inFlight = undefined;
    scenario.prepare?.(dir);
    const run = await scenario.run(dir, how === "sigint" ? { breakOnSigint: true } : { timeout });
    cutShort.done = true;
    cutShort.sigint = false;
    if (cutShort.log.join() === scenario.log) {
      return { scenario: name, run, ...(await scenario.after(dir)), log: cutShort.log.join() };
    }
    // What this attempt left to do ends here, while `done` is set.
    await new Promise(resolve => setImmediate(resolve));
    await cutShort.inFlight;
  }
  return { scenario: name, run: "no run stopped the body of spin.mjs" };
}

(async () => {
  const [how, ...names] = process.argv.slice(2);
  // A process that ends before the last scenario does not end with 0.
  process.exitCode = 1;
  for (const name of names) console.log(JSON.stringify(await runScenario(name, how)));
  process.exitCode = 0;
})();
