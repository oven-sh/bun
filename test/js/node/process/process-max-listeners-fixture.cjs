// Runs one scenario and prints what it returns as JSON. process-on.test.ts holds what node v26.3.0 prints for each.
//   node process-max-listeners-fixture.cjs <scenario> [argument]
const real = process;
const write = real.stdout.write.bind(real.stdout);
const events = () => require("node:events");
const shown = value => {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "bigint") return `${value}n`;
  return typeof value === "number" || value === undefined ? String(value) : value;
};
const thrownBy = fn => {
  try {
    fn();
    return null;
  } catch (error) {
    return [error.name, error.code, error.message];
  }
};

const scenarios = {
  storedValues() {
    const { getMaxListeners } = events();
    return [2 ** 32, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER, Infinity, 1.5, 0.5, -0, 0].map(n => [
      process.setMaxListeners(n) === process,
      shown(process.getMaxListeners()),
      shown(process._maxListeners),
      shown(getMaxListeners(process)),
      Object.is(process.getMaxListeners(), n),
    ]);
  },

  refusedValues() {
    const { EventEmitter } = events();
    process.setMaxListeners(4);
    const refused = [-1, NaN, -Infinity, "3", null, 1n, {}, true].map(n => {
      const thrown = thrownBy(() => process.setMaxListeners(n));
      const thrownByNodeEvents = thrownBy(() => new EventEmitter().setMaxListeners(n));
      return [thrown[1], JSON.stringify(thrown) === JSON.stringify(thrownByNodeEvents)];
    });
    return {
      refused,
      missing: thrownBy(() => process.setMaxListeners()),
      negative: thrownBy(() => process.setMaxListeners(-1)),
      kept: process.getMaxListeners(),
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
    return out;
  },

  chained() {
    const listener = () => {};
    const returned = process.setMaxListeners(20).on("exit", listener);
    return [returned === process, process.listeners("exit").includes(listener), process.getMaxListeners()];
  },

  liveDefault() {
    const nodeEvents = events();
    const limits = () => [shown(process.getMaxListeners()), shown(nodeEvents.getMaxListeners(process))];
    const out = [limits()];
    nodeEvents.defaultMaxListeners = 20;
    out.push(limits());
    nodeEvents.setMaxListeners(12);
    out.push(limits());
    nodeEvents.EventEmitter.defaultMaxListeners = Infinity;
    out.push(limits());
    nodeEvents.defaultMaxListeners = 1.5;
    out.push(limits());
    out.push(thrownBy(() => (nodeEvents.defaultMaxListeners = -1))[1], limits());
    // A limit of its own comes before the default, until it is undefined again.
    process.setMaxListeners(3);
    nodeEvents.defaultMaxListeners = 50;
    out.push(limits());
    process._maxListeners = undefined;
    out.push(limits());
    return out;
  },

  writtenDirectly() {
    const out = [];
    for (const limit of [3, undefined, null, "2", -5, 2n, "text", NaN]) {
      process._maxListeners = limit;
      out.push(shown(process.getMaxListeners()));
    }
    const object = { valueOf: () => 2 };
    process._maxListeners = object;
    out.push(process.getMaxListeners() === object);
    delete process._maxListeners;
    out.push(shown(process.getMaxListeners()), Object.hasOwn(process, "_maxListeners"));
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
    out.push(process.getMaxListeners(), process.setMaxListeners(4) === process, limit, process.getMaxListeners());
    Object.defineProperty(process, "_maxListeners", {
      get() {
        throw new Error("from the getter");
      },
      configurable: true,
    });
    out.push(thrownBy(() => process.getMaxListeners())[2]);
    Object.defineProperty(process, "_maxListeners", { value: 1, writable: false, configurable: true });
    out.push(thrownBy(() => process.setMaxListeners(9))[0], process.getMaxListeners());
    return out;
  },

  worker() {
    const { Worker } = require("node:worker_threads");
    events().defaultMaxListeners = 50;
    const worker = new Worker(
      `const { parentPort } = require("node:worker_threads");
       const events = require("node:events");
       const own = [process.getMaxListeners(), Object.hasOwn(process, "_maxListeners")];
       events.defaultMaxListeners = 7;
       own.push(process.getMaxListeners(), process.setMaxListeners(2) === process, process.getMaxListeners());
       parentPort.postMessage(own);`,
      { eval: true },
    );
    return new Promise(resolve =>
      worker.on("message", inWorker =>
        resolve({ inWorker, outside: [process.getMaxListeners(), process._maxListeners === undefined] }),
      ),
    );
  },

  // node:events hands its default to the process object itself, whatever the global `process` is by then.
  replacedGlobal(how) {
    const nodeEvents = events();
    const replace = {
      "undefined": () => (globalThis.process = undefined),
      "null": () => (globalThis.process = null),
      "a number": () => (globalThis.process = 5),
      "a string": () => (globalThis.process = "p"),
      "an object": () => (globalThis.process = {}),
      "a frozen object": () => (globalThis.process = Object.freeze({})),
      "a Proxy of process": () => (globalThis.process = new Proxy(real, {})),
      "deleted": () => delete globalThis.process,
      "frozen": () => Object.freeze(real),
      "not extensible": () => Object.preventExtensions(real),
    };
    replace[how]();
    const out = [];
    for (const writeDefault of [() => (nodeEvents.defaultMaxListeners = 5), () => nodeEvents.setMaxListeners(6)]) {
      out.push(
        thrownBy(writeDefault),
        nodeEvents.defaultMaxListeners,
        real.getMaxListeners(),
        nodeEvents.getMaxListeners(real),
      );
    }
    globalThis.process = real;
    return out;
  },
};

Promise.resolve(scenarios[real.argv[2]](real.argv[3])).then(out => write(JSON.stringify(out) + "\n"));
