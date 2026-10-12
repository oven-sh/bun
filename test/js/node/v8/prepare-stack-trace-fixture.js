// Scenarios for Error.prepareStackTrace as a property of the Error constructor. Each one runs in a
// realm of its own, so its first statement is the first code there that touches the property.
// The file also runs under Node.js: `node prepare-stack-trace-fixture.js <realm> <scenario>`.
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

// Source text, so that a ShadowRealm or a node:vm context can evaluate the same helpers.
const helpers = `
  const original = Error.prepareStackTrace;
  const tag = name => () => name;
  function show(stack) {
    if (typeof stack === "string") return stack.startsWith("Error: boom\\n    at ") ? "default" : stack;
    if (Array.isArray(stack)) return typeof stack[0]?.getFileName === "function" ? "callsites" : "array";
    return typeof stack;
  }
  // The two consumers of the hook, a lazy .stack read and Error.captureStackTrace, must agree.
  function read() {
    const stack = show(new Error("boom").stack);
    if (!withCapture) return stack;
    const target = new Error("boom");
    Error.captureStackTrace(target);
    const captured = show(target.stack);
    return stack === captured ? stack : { stack, captured };
  }
`;

const scenarios = {
  assign() {
    Error.prepareStackTrace = tag("ONE");
    return read();
  },
  "delete after assign"() {
    Error.prepareStackTrace = tag("ONE");
    const installed = read();
    delete Error.prepareStackTrace;
    const deleted = [typeof Error.prepareStackTrace, read()];
    Error.prepareStackTrace = tag("TWO");
    return [installed, deleted, read()];
  },
  "delete first"() {
    delete Error.prepareStackTrace;
    const deleted = read();
    Error.prepareStackTrace = tag("ONE");
    return [deleted, read()];
  },
  accessor() {
    let current = tag("GETTER");
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: fn => {
        current = fn;
      },
    });
    const viaGetter = read();
    Error.prepareStackTrace = tag("SETTER");
    const viaSetter = read();
    Error.prepareStackTrace = (error, callSites) => callSites;
    return [viaGetter, viaSetter, read()];
  },
  __defineGetter__() {
    Error.__defineGetter__("prepareStackTrace", () => tag("GETTER"));
    return read();
  },
  "define value"() {
    Object.defineProperty(Error, "prepareStackTrace", { value: tag("DEFINED"), writable: true, configurable: true });
    return read();
  },
  "define value, not writable"() {
    Object.defineProperty(Error, "prepareStackTrace", { value: tag("DEFINED"), writable: false });
    Error.prepareStackTrace = tag("IGNORED");
    return read();
  },
  "define enumerable only"() {
    Object.defineProperty(Error, "prepareStackTrace", { enumerable: true });
    const kept = [Error.prepareStackTrace === original, Object.keys(Error).includes("prepareStackTrace"), read()];
    Error.prepareStackTrace = tag("ONE");
    return [kept, read()];
  },
  "Reflect.defineProperty"() {
    Reflect.defineProperty(Error, "prepareStackTrace", { value: tag("DEFINED"), writable: true, configurable: true });
    return read();
  },
  "Object.defineProperties"() {
    Object.defineProperties(Error, {
      prepareStackTrace: { value: tag("DEFINED"), writable: true, configurable: true },
    });
    return read();
  },
  "Object.assign"() {
    Object.assign(Error, { prepareStackTrace: tag("ASSIGNED") });
    return read();
  },
  "Reflect.set"() {
    Reflect.set(Error, "prepareStackTrace", tag("SET"));
    return read();
  },
  "Object.seal, then assign"() {
    Object.seal(Error);
    const sealed = read();
    Error.prepareStackTrace = tag("ONE");
    return [sealed, read()];
  },
  "Object.freeze, then assign"() {
    Object.freeze(Error);
    const frozen = read();
    Error.prepareStackTrace = tag("IGNORED");
    return [frozen, read()];
  },
  "not callable"() {
    return [undefined, null, 42, "text", {}].map(value => {
      Error.prepareStackTrace = value;
      return read();
    });
  },
  "assign, then restore the first value"() {
    Error.prepareStackTrace = tag("ONE");
    const installed = read();
    Error.prepareStackTrace = original;
    return [installed, Error.prepareStackTrace === original, read()];
  },
  "assign the first value back"() {
    Error.prepareStackTrace = original;
    return read();
  },
  "inherited from Function.prototype"() {
    delete Error.prepareStackTrace;
    Function.prototype.prepareStackTrace = tag("INHERITED");
    const inherited = read();
    Function.prototype.prepareStackTrace = tag("REPLACED");
    return [inherited, read()];
  },
  "inherited from a new prototype"() {
    delete Error.prepareStackTrace;
    Object.setPrototypeOf(Error, { prepareStackTrace: tag("INHERITED") });
    return read();
  },
  "a formatter that deletes itself"() {
    Error.prepareStackTrace = () => {
      delete Error.prepareStackTrace;
      return "ONCE";
    };
    return [show(new Error("boom").stack), read()];
  },
  "a formatter that installs another"() {
    Error.prepareStackTrace = () => {
      Error.prepareStackTrace = tag("SECOND");
      return "FIRST";
    };
    return [show(new Error("boom").stack), read()];
  },
  "a getter that reads another stack"() {
    let inner;
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      get() {
        inner = show(new Error("boom").stack);
        return tag("GETTER");
      },
    });
    return [show(new Error("boom").stack), inner];
  },
  "a getter that throws"() {
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      get() {
        throw new RangeError("getter threw");
      },
    });
    try {
      void new Error("boom").stack;
      return "no throw";
    } catch (thrown) {
      return thrown.message;
    }
  },
  "seventy delete and assign cycles"() {
    // By now the Structure of the Error constructor is a dictionary, which changes in place.
    for (let i = 0; i < 70; i++) {
      delete Error.prepareStackTrace;
      Error.prepareStackTrace = tag("CYCLE " + i);
    }
    const results = [read()];
    delete Error.prepareStackTrace;
    results.push(read());
    Error.prepareStackTrace = tag("ASSIGNED");
    results.push(read());
    Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get: () => tag("GETTER") });
    results.push(read());
    Object.defineProperty(Error, "prepareStackTrace", { configurable: true, writable: true, value: tag("DEFINED") });
    results.push(read());
    Error.prepareStackTrace = original;
    results.push(read());
    return results;
  },
  "collections between writes that move the property"() {
    const collect = typeof Bun === "object" ? () => Bun.gc(true) : () => {};
    const results = [];
    for (let i = 0; i < 18; i++) {
      switch (i % 6) {
        case 0:
          delete Error.prepareStackTrace;
          break;
        case 1:
          // Takes the offset that the delete made free.
          Error.decoy = tag("DECOY");
          break;
        case 2:
          Error.prepareStackTrace = tag("ASSIGNED " + i);
          break;
        case 3:
          Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get: () => tag("GETTER " + i) });
          break;
        case 4:
          delete Error.decoy;
          delete Error.prepareStackTrace;
          Error.prepareStackTrace = tag("ASSIGNED " + i);
          break;
        case 5:
          // The Structures the constructor had before are garbage after this.
          Object.setPrototypeOf(Error, { round: i });
          collect();
          break;
      }
      results.push(read());
    }
    return results.join(", ");
  },
  // Random walks found a build whose remembered Structure the collector could free: this seed
  // made that build call the wrong formatter within 20 steps.
  "a seeded walk of writes, prototype changes and collections"() {
    let seed = 12;
    const random = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8) % n;
    const collect = typeof Bun === "object" ? () => Bun.gc(true) : () => {};
    let k = 0;
    const writes = [
      () => (Error.prepareStackTrace = tag("A" + k++)),
      () => delete Error.prepareStackTrace,
      () =>
        Object.defineProperty(Error, "prepareStackTrace", {
          configurable: true,
          get: (
            f => () =>
              f
          )(tag("G" + k++)),
          set() {},
        }),
      () =>
        Object.defineProperty(Error, "prepareStackTrace", {
          configurable: true,
          writable: true,
          value: tag("D" + k++),
        }),
      () => (Error.prepareStackTrace = original),
      () => (Error["unrelated" + random(90)] = k),
      () => delete Error["unrelated" + random(90)],
      () => collect(),
      () => (Function.prototype.prepareStackTrace = tag("F" + k++)),
      () => delete Function.prototype.prepareStackTrace,
      () => {
        for (let i = 0; i < 70; i++) {
          delete Error.prepareStackTrace;
          Error.prepareStackTrace = tag("C" + k);
        }
        k++;
      },
      () => Object.setPrototypeOf(Error, random(2) ? Function.prototype : { prepareStackTrace: tag("P" + k++) }),
    ];
    // The formatter after each step, with a count where it stays the same.
    const runs = [];
    for (let i = 0; i < 60; i++) {
      writes[random(writes.length)]();
      const result = show(new Error("boom").stack);
      if (runs.at(-1)?.[0] === result) runs.at(-1)[1]++;
      else runs.push([result, 1]);
    }
    return runs.map(([result, steps]) => (steps > 1 ? result + " x" + steps : result)).join(", ");
  },
  "other properties first"() {
    Error.unrelated = 1;
    Error.stackTraceLimit = 5;
    delete Error.unrelated;
    const untouched = read();
    Error.prepareStackTrace = tag("ONE");
    return [untouched, read()];
  },
};

function program(name, withCapture = true) {
  const scenario = scenarios[name].toString().replace(/^[^(]*/, "function ");
  return `const withCapture = ${withCapture};${helpers}\nJSON.stringify((${scenario})())`;
}

// The same scenario source in another kind of realm.
const inRealm = {
  Worker: name =>
    new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { workerData: name });
      worker.once("message", resolve);
      worker.once("error", reject);
    }),
  ShadowRealm: name => JSON.parse(new ShadowRealm().evaluate(program(name))),
  // Error.captureStackTrace in a node:vm context is JavaScriptCore's own and has no formatter hook.
  "node:vm": name => JSON.parse(vm.runInNewContext(program(name, false))),
};

if (!isMainThread) {
  parentPort.postMessage(JSON.parse((0, eval)(program(workerData))));
} else {
  const [realm, ...names] = process.argv.slice(2);
  if (realm === "main") {
    console.log((0, eval)(program(names[0])));
  } else {
    // Each scenario in a fresh realm of this kind.
    Promise.all(names.map(async name => [name, await inRealm[realm](name)])).then(results =>
      console.log(JSON.stringify(Object.fromEntries(results))),
    );
  }
}
