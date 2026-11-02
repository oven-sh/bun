// require() reads Module._resolveFilename and Module.prototype.require only after a program has changed them: a
// watchpoint of the engine is on each property. Each case of this file prints the state of the two watchpoints after
// some steps: "armed" (require() does not read the property), "fired" (it reads it at each call) or "not watched".
//
//   bun module-hooks-watchpoint-fixture.cjs <folder> <case>
//
// <folder> holds a.js and b.js (`exports.v = 42;`).
const { loaderHookWatchpoints, isModuleResolveFilenameSlowPathEnabled } = require("bun:internal-for-testing");
const path = require("node:path");

const [folder, name] = process.argv.slice(2);
const file = letter => path.join(folder, letter + ".js");
// "<Module._resolveFilename>, <Module.prototype.require>". "none": nothing has made the holder of the hook yet.
const state = () => {
  const { _resolveFilename = "none", require = "none" } = loaderHookWatchpoints();
  return `${_resolveFilename}, ${require}`;
};

let calls = 0;
const counted = original =>
  function () {
    calls++;
    return original.apply(this, arguments);
  };
const callsFor = letter => {
  const before = calls;
  require(file(letter));
  return calls - before;
};
const data = value => ({ value, writable: true, configurable: true, enumerable: true });

// Takes each hook in turn through a store, and then puts the original back.
const fires = (store, restore) => () => {
  const Module = require("node:module");
  const hooks = [
    [Module, "_resolveFilename"],
    [Module.prototype, "require"],
  ];
  const seen = { before: state() };
  for (const [holder, key] of hooks) {
    const original = holder[key];
    store(holder, key, counted(original));
    seen[key] = { state: state(), calls: callsFor("a") };
    restore(holder, key, original);
    seen[key].callsWithTheOriginalBack = callsFor("b");
  }
  // A watchpoint fires once: require() reads the property from then on, also with the original back.
  seen.after = state();
  seen.slowPath = isModuleResolveFilenameSlowPathEnabled();
  return seen;
};

const cases = {
  "a program that stores no hook": () => {
    const seen = { "before node:module": state() };
    const Module = require("node:module");
    seen["node:module is loaded"] = state();
    void Module._resolveFilename;
    Module.createRequire(__filename)(file("a"));
    seen["a hook is read and createRequire() loads a file"] = state();
    ({ ...Module });
    Object.keys(Module);
    void Module.prototype.require;
    Object.entries(Module.prototype);
    seen["Module and Module.prototype are read, spread and listed"] = state();
    class Heir extends Module {}
    Heir._resolveFilename = () => {};
    Object.create(Module.prototype).require = () => {};
    new Module("made here");
    Module.added = 1;
    delete Module.added;
    Module.prototype.added = 1;
    seen["an heir is written, a module is made and another key is added"] = state();
    // Another object with the keys of Module.prototype is no hook.
    const twin = { require() {}, _compile() {} };
    twin.require = () => {};
    Object.defineProperty(twin, "require", { get() {} });
    delete twin._compile;
    seen["another object with the same keys changes"] = state();
    seen.slowPath = isModuleResolveFilenameSlowPathEnabled();
    return seen;
  },
  "an assignment": fires(
    (holder, key, patch) => void (holder[key] = patch),
    (holder, key, original) => void (holder[key] = original),
  ),
  "Object.defineProperty with a value": fires(
    (holder, key, patch) => void Object.defineProperty(holder, key, data(patch)),
    (holder, key, original) => void Object.defineProperty(holder, key, data(original)),
  ),
  "Object.defineProperty with a getter": fires(
    (holder, key, patch) => void Object.defineProperty(holder, key, { get: () => patch, configurable: true }),
    (holder, key, original) => void Object.defineProperty(holder, key, data(original)),
  ),
  "delete and an assignment": fires(
    (holder, key, patch) => {
      delete holder[key];
      holder[key] = patch;
    },
    (holder, key, original) => void (holder[key] = original),
  ),
  // The engine stops watching an object whose keys come and go many times. require() then reads the property.
  "another key of Module is added and deleted many times": () => {
    const Module = require("node:module");
    const churn = times => {
      for (let i = 0; i < times; i++) {
        Module.other = i;
        delete Module.other;
      }
    };
    churn(10);
    const afterTen = state();
    churn(500);
    return { afterTen, afterManyMore: state(), exported: require(file("a")).v };
  },
  // A Worker has a realm of its own, with watchpoints of its own.
  "a Worker fires its own watchpoint": async () => {
    const { Worker } = require("node:worker_threads");
    const Module = require("node:module");
    void Module.prototype;
    const inWorker = await new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { argv: [folder, "in the Worker"] });
      worker.on("message", resolve);
      worker.on("error", reject);
    });
    return { inWorker, outside: state(), calls: callsFor("a") };
  },
  "in the Worker": () => {
    const Module = require("node:module");
    const original = Module._resolveFilename;
    Object.defineProperty(Module, "_resolveFilename", data(counted(original)));
    require("node:worker_threads").parentPort.postMessage({ state: state(), calls: callsFor("b") });
  },
};

Promise.resolve(cases[name]()).then(result => {
  if (result !== undefined) console.log(JSON.stringify(result));
});
