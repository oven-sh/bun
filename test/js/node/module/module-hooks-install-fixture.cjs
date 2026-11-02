// A tool patches Module._resolveFilename or Module.prototype.require so that it sees every require(). Each case of this
// file installs a patch in one way, or does one other thing to a hook, and prints what require() does afterwards.
// Node.js prints the same line as Bun for every case.
//
//   <runtime> module-hooks-install-fixture.cjs <folder> <case> [<hook>]
//
// <folder> holds a.js to f.js (`exports.v = 42;`), g.js (`exports.v = require(__dirname + "/a.js").v;`),
// nested/h.js (`exports.v = require("./i.js").v;`), nested/i.js (`exports.v = 42;`) and data.json5x (`{"v":42}`).
// A request is an absolute path wherever a case counts calls, so Node.js asks Module._resolveFilename once for each require().
const Module = require("node:module");
const path = require("node:path");

const [folder, name, hook] = process.argv.slice(2);
const hooks = {
  "Module._resolveFilename": [Module, "_resolveFilename"],
  "Module.prototype.require": [Module.prototype, "require"],
};
const [holder, key] = hooks[hook] ?? [];
const original = holder?.[key];
const file = letter => path.join(folder, letter + ".js");

let calls = 0;
const patch = function () {
  calls++;
  return original.apply(this, arguments);
};
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};
const data = value => ({ value, writable: true, configurable: true, enumerable: true });
// How often the patch is called for one more require().
const callsFor = letter => {
  const before = calls;
  require(file(letter));
  return calls - before;
};

// Nine ways to put the patch on the holder. The last two take it off again.
const ways = {
  "o[k] = patch": (o, k) => void (o[k] = patch),
  "Object.defineProperty(o, k, { value: patch, ... })": (o, k) => void Object.defineProperty(o, k, data(patch)),
  "Object.defineProperty(o, k, { get: () => patch, ... })": (o, k) =>
    void Object.defineProperty(o, k, { get: () => patch, configurable: true, enumerable: true }),
  "Reflect.set(o, k, patch)": (o, k) => void Reflect.set(o, k, patch),
  "Object.assign(o, { [k]: patch })": (o, k) => void Object.assign(o, { [k]: patch }),
  "delete o[k]; o[k] = patch": (o, k) => {
    delete o[k];
    o[k] = patch;
  },
  "o[k] = other; Object.defineProperty(o, k, { value: patch, ... })": (o, k) => {
    o[k] = function () {
      return original.apply(this, arguments);
    };
    Object.defineProperty(o, k, data(patch));
  },
  "o[k] = patch; o[k] = original": (o, k) => {
    o[k] = patch;
    o[k] = original;
  },
  "o[k] = patch; Object.defineProperty(o, k, { value: original, ... })": (o, k) => {
    o[k] = patch;
    Object.defineProperty(o, k, data(original));
  },
};

// One process takes the hook through every kind of property, and loads a file after each step.
const inTurn = () => {
  Object.defineProperty(holder, key, data(patch));
  const asValue = callsFor("a");
  Object.defineProperty(holder, key, { get: () => patch, configurable: true, enumerable: true });
  const fromGetter = callsFor("b");
  delete holder[key];
  const deleted = attempt(() => require(file("c")).v);
  holder[key] = original;
  const originalBack = callsFor("d");
  holder[key] = patch;
  return { asValue, fromGetter, deleted, originalBack, patchAgain: callsFor("e") };
};

const cases = {
  // Which calls of a program ask the patch.
  "each kind of require() asks a patch installed with Object.defineProperty": () => {
    Object.defineProperty(holder, key, data(patch));
    const asked = {};
    for (const [label, load] of [
      ["require", () => require(file("a"))],
      ["module.require", () => module.require(file("b"))],
      ["require.resolve", () => require.resolve(file("c"))],
      ["createRequire()", () => Module.createRequire(__filename)(file("d"))],
      ["createRequire().resolve", () => Module.createRequire(__filename).resolve(file("e"))],
      ["process.mainModule.require", () => process.mainModule.require(file("f"))],
      ["a require() in a required file", () => require(file("g"))],
    ]) {
      const before = calls;
      load();
      asked[label] = calls - before;
    }
    return asked;
  },
  "the property is deleted": () => {
    delete holder[key];
    return {
      require: attempt(() => require(file("a")).v),
      resolve: attempt(() => path.basename(require.resolve(file("b")))),
    };
  },
  "the property is defined as 42": () => {
    Object.defineProperty(holder, key, data(42));
    return {
      require: attempt(() => require(file("a")).v),
      resolve: attempt(() => path.basename(require.resolve(file("b")))),
    };
  },
  // A getter runs on the object that the hook is read from: Module, or the module that calls require().
  "a getter sees the object that the hook is read from": () => {
    let receiver;
    Object.defineProperty(holder, key, {
      get() {
        receiver = this;
        return patch;
      },
      configurable: true,
      enumerable: true,
    });
    require(file("a"));
    const seen = new Map([
      [module, "the module that calls require()"],
      [Module, "Module"],
      [Module.prototype, "Module.prototype"],
    ]);
    return { receiver: seen.get(receiver) ?? typeof receiver, calls };
  },
  "the getter throws": () => {
    Object.defineProperty(holder, key, {
      get() {
        throw new RangeError("from the getter");
      },
      configurable: true,
    });
    return { require: attempt(() => require(file("a")).v) };
  },
  // After a delete, Node.js finds the function that the prototype chain of the holder has under the name.
  "the property is deleted and the prototype of the holder has the name": () => {
    delete holder[key];
    const prototype = Object.getPrototypeOf(holder);
    prototype[key] = patch;
    const exported = attempt(() => require(file("a")).v);
    delete prototype[key];
    return { calls, exported };
  },
  // Writes that leave the property of the holder as it was. Node.js calls no patch after any of them.
  "writes that do not reach the property of the holder": () => {
    const heir = holder === Module ? class extends Module {} : Object.create(holder);
    heir[key] = patch;
    const inherited = {
      calls: callsFor("a"),
      heirOwnsIt: Object.hasOwn(heir, key),
      holderHasOriginal: holder[key] === original,
    };

    const receiver = {};
    Reflect.set(holder, key, patch, receiver);
    const otherReceiver = {
      calls: callsFor("b"),
      receiverOwnsIt: Object.hasOwn(receiver, key),
      holderHasOriginal: holder[key] === original,
    };

    Object.freeze(holder);
    holder[key] = patch;
    const frozen = { calls: callsFor("c"), holderHasOriginal: holder[key] === original };
    return { inherited, otherReceiver, frozen };
  },
  "an accessor without a setter is assigned to": () => {
    Object.defineProperty(holder, key, { get: () => original, configurable: true, enumerable: true });
    holder[key] = patch;
    return { calls: callsFor("a"), holderHasOriginal: holder[key] === original };
  },
  "the own keys of the holder are listed before the patch is assigned": () => {
    Object.entries(holder);
    ({ ...holder });
    holder[key] = patch;
    return { calls: callsFor("a") };
  },
  // The holder gets hundreds of keys and loses one, which changes how the engine stores its properties.
  "the holder gets and loses other keys before the patch is assigned": () => {
    for (let i = 0; i < 300; i++) holder["key" + i] = i;
    delete holder.key7;
    const before = callsFor("a");
    holder[key] = patch;
    return { before, calls: callsFor("b") };
  },
  "one statement assigns the patch, the original and the patch again": () => {
    const set = value => void (holder[key] = value);
    return [
      [patch, "a"],
      [original, "b"],
      [patch, "c"],
    ].map(([value, letter]) => (set(value), callsFor(letter)));
  },
  "the hook is the patch as a value, the patch from a getter, deleted, the original and the patch in turn": inTurn,
  "the same in turn after the own keys of the holder are listed": () => {
    Object.entries(holder);
    ({ ...holder });
    return inTurn();
  },
  // `{ type }` as a second argument of require() is Bun's: Node.js ignores it, and data.json5x is no JavaScript.
  "a patch that hands on its arguments hands on the second one": () => {
    holder[key] = patch;
    const loaded = process.versions.bun
      ? require(path.join(folder, "data.json5x"), { type: "json" })
      : require(file("a"));
    return { calls, exported: loaded.v };
  },

  // The patch is called on the module that asks, or gets it as the second argument, so the file of another folder
  // finds its neighbour.
  "a relative request in a file of another folder": () => {
    const askedBy = [];
    const patch = function () {
      askedBy.push(path.basename((key === "require" ? this : arguments[1]).filename));
      return original.apply(this, arguments);
    };
    Object.defineProperty(holder, key, data(patch));
    return { exported: attempt(() => require(path.join(folder, "nested", "h.js")).v), askedBy };
  },
  "this hook is assigned and the other hook is defined": () => {
    const counts = {};
    for (const [label, [o, k]] of Object.entries(hooks)) {
      const inner = o[k];
      const counted = function () {
        counts[label] = (counts[label] ?? 0) + 1;
        return inner.apply(this, arguments);
      };
      if (o === holder) o[k] = counted;
      else Object.defineProperty(o, k, data(counted));
    }
    require(file("a"));
    return counts;
  },
  "mock.method() of node:test takes the hook and restore() gives it back": () => {
    const mocked = require("node:test").mock.method(holder, key);
    const exported = require(file("a")).v;
    const calls = mocked.mock.calls.length;
    mocked.mock.restore();
    require(file("b"));
    return {
      exported,
      calls,
      callsAfterRestore: mocked.mock.calls.length - calls,
      originalIsBack: holder[key] === original,
    };
  },
  // A Worker has a realm of its own, with hooks of its own.
  "a patch that a Worker defines is called in the Worker alone": async () => {
    const { Worker } = require("node:worker_threads");
    const inWorker = await new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { argv: [folder, "in the Worker", hook] });
      worker.on("message", resolve);
      worker.on("error", reject);
    });
    return { inWorker, outside: callsFor("a") };
  },
  "in the Worker": () => {
    Object.defineProperty(holder, key, data(patch));
    require("node:worker_threads").parentPort.postMessage(callsFor("b"));
  },
  // The test passes `--require <file>` for this one. That file defines a patch that counts in `callsOfPreloadPatch`.
  "a --require preload has defined a patch": () => {
    const before = globalThis.callsOfPreloadPatch;
    require(file("a"));
    return { calls: globalThis.callsOfPreloadPatch - before };
  },

  // The next three take no hook.
  // Module.prototype.require gets what module.require() is called with, however the patch was installed.
  "a patch of Module.prototype.require gets every argument of module.require()": () => {
    const seen = {};
    for (const [label, install] of [
      ["assigned", patch => void (Module.prototype.require = patch)],
      ["defined", patch => void Object.defineProperty(Module.prototype, "require", data(patch))],
    ]) {
      const counts = [];
      install(function () {
        counts.push(arguments.length);
      });
      for (const args of [[], ["a"], ["a", {}], ["a", {}, 3], ["a", {}, 3, 4]]) module.require(...args);
      seen[label] = counts;
    }
    return seen;
  },
  "the descriptors": () =>
    Object.values(hooks).map(([o, k]) => {
      const { value, ...attributes } = Object.getOwnPropertyDescriptor(o, k);
      return { value: typeof value, ...attributes };
    }),
  // Module.prototype exists from here on, and nothing patches anything.
  "Module.prototype is read and nothing is patched": () => {
    void (module instanceof Module);
    const loaded = process.versions.bun
      ? require(path.join(folder, "data.json5x"), { type: "json" })
      : require(file("b"));
    return { oneArgument: require(file("a")).v, noArgument: attempt(() => require()), twoArguments: loaded.v };
  },
};

let result;
if (name in ways) {
  const installed = attempt(() => ways[name](holder, key));
  result = {
    calls: 0,
    readsBackPatch: holder[key] === patch,
    exported: attempt(() => require(file("a")).v),
    installed,
  };
  result.calls = calls;
} else {
  result = cases[name]();
}
Promise.resolve(result).then(result => {
  if (result !== undefined) console.log(JSON.stringify(result));
});
