// Runs one scenario and prints { out, warnings } as JSON. process-on.test.ts holds what node v26.3.0 prints for each.
//   node process-max-listeners-fixture.cjs <scenario>
const events = () => require("node:events");
const add = (type, count, method = "on") => {
  for (let i = 0; i < count; i++) process[method](type, () => {});
};
const shown = value =>
  Object.is(value, -0) ? "-0" : typeof value === "number" || value === undefined ? String(value) : value;
const thrownBy = fn => {
  try {
    fn();
    return null;
  } catch (error) {
    return [error.name, error.code, error.message];
  }
};

const scenarios = {
  overDefault() {
    const named = Symbol("named");
    const bare = Symbol();
    for (const type of ["SIGINT", "exit", "message", "custom", named, bare, 1]) add(type, 12);
  },

  shapeOfWarning() {
    let warning;
    process.on("warning", w => (warning = w));
    add("custom", 11);
    return new Promise(resolve =>
      setImmediate(() =>
        resolve({
          isError: warning instanceof Error,
          name: warning.name,
          keys: Object.keys(warning),
          emitter: warning.emitter === process,
          type: warning.type,
          count: warning.count,
        }),
      ),
    );
  },

  storedValues() {
    const { getMaxListeners } = events();
    return [2 ** 32, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER, Infinity, 1.5, 0.5, -0, 0].map(n => [
      process.setMaxListeners(n) === process,
      shown(process.getMaxListeners()),
      shown(process._maxListeners),
      shown(getMaxListeners(process)),
    ]);
  },

  refusedValues() {
    const { EventEmitter } = events();
    const refused = [-1, NaN, -Infinity, "3", null, 1n, {}, true].map(n => {
      const thrown = thrownBy(() => process.setMaxListeners(n));
      const thrownByNodeEvents = thrownBy(() => new EventEmitter().setMaxListeners(n));
      return [thrown[1], JSON.stringify(thrown) === JSON.stringify(thrownByNodeEvents)];
    });
    return {
      refused,
      missing: thrownBy(() => process.setMaxListeners()),
      negative: thrownBy(() => process.setMaxListeners(-1)),
    };
  },

  ownProperty() {
    const { getMaxListeners, setMaxListeners } = events();
    const descriptor = Object.getOwnPropertyDescriptor(process, "_maxListeners");
    const out = {
      descriptor: { ...descriptor, value: shown(descriptor.value) },
      enumerated: Object.keys(process).includes("_maxListeners"),
    };
    process.setMaxListeners(5);
    out.afterSet = [process.getMaxListeners(), getMaxListeners(process), process._maxListeners];
    setMaxListeners(7, process);
    out.afterStaticSet = [process.getMaxListeners(), getMaxListeners(process), process._maxListeners];
    out.chained = process.setMaxListeners(10).getMaxListeners();
    return out;
  },

  liveDefault() {
    const nodeEvents = events();
    const out = [shown(process.getMaxListeners())];
    nodeEvents.defaultMaxListeners = 20;
    out.push(shown(process.getMaxListeners()), shown(nodeEvents.getMaxListeners(process)));
    add("under20", 15);
    nodeEvents.setMaxListeners(12);
    out.push(shown(process.getMaxListeners()));
    add("over12", 13);
    nodeEvents.defaultMaxListeners = Infinity;
    out.push(shown(process.getMaxListeners()));
    add("underInfinity", 50);
    nodeEvents.defaultMaxListeners = 0;
    add("unlimited", 50);
    nodeEvents.defaultMaxListeners = 1.5;
    add("over1.5", 2);
    process.setMaxListeners(3);
    out.push(shown(process.getMaxListeners()), shown(nodeEvents.getMaxListeners(process)));
    add("over3", 4);
    return out;
  },

  withoutNodeEvents() {
    // Nothing here evaluates node:events: the default is still 10.
    add("x", 11);
    return process.getMaxListeners();
  },

  writtenDirectly() {
    const out = [];
    const limitOf = () => shown(process.getMaxListeners());
    process._maxListeners = 3;
    add("over3", 4);
    out.push(limitOf());
    process._maxListeners = undefined;
    add("overDefault", 11);
    out.push(limitOf());
    delete process._maxListeners;
    add("overDefaultAgain", 11);
    out.push(limitOf(), Object.hasOwn(process, "_maxListeners"));
    process._maxListeners = null;
    add("null", 30);
    out.push(limitOf());
    process._maxListeners = "2";
    add("overString", 3);
    out.push(limitOf());
    process._maxListeners = -5;
    add("negative", 30);
    process._maxListeners = 2n;
    add("overBigInt", 3);
    process._maxListeners = { valueOf: () => 2, toString: () => "two" };
    add("overObject", 3);
    process._maxListeners = "text";
    add("text", 30);
    return out;
  },

  accessor() {
    const out = [];
    let limit = 2;
    Object.defineProperty(process, "_maxListeners", {
      get: () => limit,
      set: value => (limit = value + 1),
      configurable: true,
    });
    add("over2", 3);
    out.push(process.setMaxListeners(4) === process, limit, process.getMaxListeners());
    Object.defineProperty(process, "_maxListeners", {
      get() {
        throw new Error("from the getter");
      },
      configurable: true,
    });
    process.on("kept", () => {});
    out.push(thrownBy(() => process.on("kept", () => {}))[2], process.listenerCount("kept"));
    out.push(thrownBy(() => process.getMaxListeners())[2]);
    Object.defineProperty(process, "_maxListeners", { value: 1, writable: false, configurable: true });
    out.push(thrownBy(() => process.setMaxListeners(9))[0]);
    return out;
  },

  fractions() {
    process.setMaxListeners(0.5);
    add("over0.5", 2);
    process.setMaxListeners(1.5);
    add("over1.5", 2);
    process.setMaxListeners(2.5);
    add("under2.5", 2);
    add("over2.5", 3);
    process.setMaxListeners(0);
    add("zero", 100);
    process.setMaxListeners(Infinity);
    add("infinity", 100);
  },

  oncePerList() {
    const listeners = [];
    const addKept = count => {
      for (let i = 0; i < count; i++) {
        listeners.push(() => {});
        process.on("x", listeners.at(-1));
      }
    };
    addKept(11); // 11: the first warning
    addKept(3); // 14: the list has warned
    while (listeners.length > 2) process.removeListener("x", listeners.pop());
    addKept(9); // 11 again, and the list never went down to one listener
    while (listeners.length > 1) process.removeListener("x", listeners.pop());
    addKept(10); // 11 after one listener: the second warning
    process.removeAllListeners("x");
    add("x", 11); // the third
    process.setMaxListeners(2);
    add("y", 3, "once"); // the fourth
    process.emit("y");
    add("y", 3, "once"); // the fifth
    return [process.listenerCount("x"), process.listenerCount("y")];
  },

  raisedAndLowered() {
    process.setMaxListeners(1);
    add("a", 2); // warns
    process.setMaxListeners(2);
    add("a", 1); // 3 > 2, and the list has warned
    process.setMaxListeners(5);
    add("b", 3);
    process.setMaxListeners(1);
    add("b", 1); // 4 > 1: warns
  },

  newListenerChangesLimit() {
    process.on("newListener", type => {
      if (type === "raised") process.setMaxListeners(100);
      if (type === "lowered") process.setMaxListeners(1);
    });
    process.setMaxListeners(1);
    add("raised", 2);
    add("lowered", 2);
    return process.getMaxListeners();
  },

  replacedEmitWarning() {
    const emitWarning = process.emitWarning;
    const handed = [];
    process.emitWarning = (...args) => handed.push([args.length, args[0].name, args[0].count]);
    add("x", 11);
    process.emitWarning = () => {
      throw new Error("from emitWarning");
    };
    const thrown = thrownBy(() => add("y", 11));
    process.emitWarning = emitWarning;
    add("y", 2); // the list has warned
    return { handed, thrown: thrown[2], kept: process.listenerCount("y") };
  },

  everyAddMethod() {
    const nodeEvents = events();
    process.setMaxListeners(1);
    for (const method of ["on", "addListener", "once", "prependListener", "prependOnceListener"])
      add(method, 2, method);
    const same = () => {};
    process.on("sameFunction", same);
    process.on("sameFunction", same);
    nodeEvents.once(process, "events.once");
    nodeEvents.once(process, "events.once");
    nodeEvents.EventEmitter.prototype.on.call(process, "node:events", () => {});
    nodeEvents.EventEmitter.prototype.on.call(process, "node:events", () => {});
  },

  worker() {
    const { Worker } = require("node:worker_threads");
    events().defaultMaxListeners = 50;
    const worker = new Worker(
      `const { parentPort } = require("node:worker_threads");
       const warnings = [];
       process.on("warning", warning => warnings.push(warning.message.slice(44, warning.message.indexOf(". Use "))));
       const before = [process.getMaxListeners(), Object.hasOwn(process, "_maxListeners")];
       process.setMaxListeners(2);
       for (let i = 0; i < 3; i++) process.on("inWorker", () => {});
       setImmediate(() => parentPort.postMessage({ before, warnings }));`,
      { eval: true },
    );
    return new Promise(resolve =>
      worker.on("message", inWorker => resolve({ inWorker, outside: process.getMaxListeners() })),
    );
  },
};

const warnings = [];
// "Possible EventEmitter memory leak detected. " is 44 characters.
process.on("warning", warning => warnings.push(warning.message.slice(44, warning.message.indexOf(". Use "))));
Promise.resolve(scenarios[process.argv[2]]()).then(out => {
  setImmediate(() => console.log(JSON.stringify({ out, warnings })));
});
