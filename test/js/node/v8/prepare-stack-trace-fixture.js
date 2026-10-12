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
    return read();
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
    // Each scenario in a fresh realm of this kind; "all" is every scenario.
    const each = names[0] === "all" ? Object.keys(scenarios) : names;
    Promise.all(each.map(async name => [name, await inRealm[realm](name)])).then(results =>
      console.log(JSON.stringify(Object.fromEntries(results))),
    );
  }
}
