// Scenarios for Error.prepareStackTrace as a property of the Error constructor. Each one runs in a
// realm of its own, so its first statement is the first code there that writes the property.
// The file also runs under Node.js: `node prepare-stack-trace-fixture.js <realm> <scenario>`.
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
  "an accessor is read two times for one stack"() {
    let reads = 0;
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      get() {
        reads++;
        return function () {
          return this === Error ? "CALLED ON Error" : "CALLED ON ANOTHER OBJECT";
        };
      },
    });
    return [show(new Error("boom").stack), reads];
  },
  "a getter that gives a function, then null"() {
    let reads = 0;
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      get: () => (++reads === 2 ? null : tag("FIRST")),
    });
    try {
      return show(new Error("boom").stack);
    } catch (thrown) {
      return [thrown.name, thrown.message, reads];
    }
  },
  "a getter gives a formatter that throws"() {
    const failure = new RangeError("formatter threw");
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      get: () => () => {
        throw failure;
      },
    });
    let thrown;
    try {
      void new Error("boom").stack;
    } catch (error) {
      thrown = error === failure;
    }
    Object.defineProperty(Error, "prepareStackTrace", { configurable: true, writable: true, value: tag("LATER") });
    return [thrown, read()];
  },
  // https://github.com/oven-sh/bun/issues/23493: elastic-apm-node loads error-callsites, then express loads depd.
  "error-callsites, then depd"() {
    // error-callsites@2.0.4, index.js
    const callsitesSym = Symbol("callsites");
    const fallback = Error.prepareStackTrace;
    let lastPrepareStackTrace = fallback;
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      enumerable: true,
      get: () => csPrepareStackTrace,
      set: fn => {
        lastPrepareStackTrace = fn === csPrepareStackTrace || fn === undefined ? fallback : fn;
      },
    });
    function csPrepareStackTrace(err, callsites) {
      if (Object.prototype.hasOwnProperty.call(err, callsitesSym)) return fallback(err, callsites);
      Object.defineProperty(err, callsitesSym, { configurable: true, value: callsites });
      return lastPrepareStackTrace(err, callsites);
    }
    // depd@2.0.0, getStack()
    function getStack() {
      const limit = Error.stackTraceLimit;
      const obj = {};
      const prep = Error.prepareStackTrace;
      Error.prepareStackTrace = (_, stack) => stack;
      Error.stackTraceLimit = Math.max(10, limit);
      Error.captureStackTrace(obj);
      const stack = obj.stack.slice(1);
      Error.prepareStackTrace = prep;
      Error.stackTraceLimit = limit;
      return stack;
    }
    const fromDepd = show(getStack());
    // depd put the accessor's own function back, so the first formatter, the default, is the one that formats now.
    const plain = {};
    Error.captureStackTrace(plain);
    function Inherits(message) {
      this.message = message;
      Error.captureStackTrace(this, Inherits);
    }
    Object.setPrototypeOf(Inherits.prototype, Error.prototype);
    Inherits.prototype.name = "Inherits";
    const error = new Error("boom");
    return [
      fromDepd,
      plain.stack.split("\n")[0],
      new Inherits("not an Error instance").stack.split("\n")[0],
      show(error.stack),
      show(error[callsitesSym]),
    ];
  },
  "the default formatter with an object that is not an Error"() {
    const thrown = call => {
      try {
        return call();
      } catch (error) {
        return error.constructor.name;
      }
    };
    return [
      original({}, []),
      original({ name: "Named", message: "with a message" }, []),
      thrown(() => original(1, [])),
      thrown(() => original(null, [])),
    ];
  },
  // https://github.com/oven-sh/bun/issues/41151
  "a formatter that calls the default, and a capture whose caller is not on the stack"() {
    Error.prepareStackTrace = (error, callSites) => "WRAPPED " + original(error, callSites) + " " + callSites.length;
    function Custom() {
      // `this.constructor` is Error, so no frame is left.
      Error.captureStackTrace(this, this.constructor);
    }
    Custom.prototype = new Error();
    return new Custom().stack;
  },
  "a stack overflow, read where it is caught"() {
    let calls = 0;
    const formatter = () => (calls++, "FORMATTED");
    // The deepest frame reads the stack of its RangeError with almost no stack left.
    function overflow() {
      let stack;
      (function deep() {
        try {
          deep();
        } catch (error) {
          stack ??= error.stack;
        }
      })();
      return /^RangeError: Maximum call stack size exceeded\.?\n    at /.test(stack) ? "default" : stack;
    }
    Error.prepareStackTrace = formatter;
    const assigned = overflow();
    Object.defineProperty(Error, "prepareStackTrace", { configurable: true, get: () => formatter });
    const ownGetter = overflow();
    delete Error.prepareStackTrace;
    Object.defineProperty(Function.prototype, "prepareStackTrace", { configurable: true, get: () => formatter });
    // With stack to spare, the same inherited getter gives the formatter.
    return [assigned, ownGetter, overflow(), calls, new Error("boom").stack, calls];
  },
  "an inherited getter is read two times"() {
    delete Error.prepareStackTrace;
    const receivers = [];
    Object.defineProperty(Function.prototype, "prepareStackTrace", {
      configurable: true,
      get() {
        receivers.push(this === Error);
        return function () {
          return this === Error ? "CALLED ON Error" : "CALLED ON " + typeof this;
        };
      },
    });
    return [show(new Error("boom").stack), receivers];
  },
  "the formatter is called on Error"() {
    const calledOn = () =>
      function () {
        return this === Error ? "Error" : typeof this;
      };
    Error.prepareStackTrace = calledOn();
    const own = read();
    delete Error.prepareStackTrace;
    Function.prototype.prepareStackTrace = calledOn();
    return [own, read()];
  },
  // Node.js tests the realm's Error and then the main context's Error, which is the same object here.
  "a getter that gives undefined, then a function"() {
    let reads = 0;
    Object.defineProperty(Error, "prepareStackTrace", {
      configurable: true,
      get: () => (++reads === 1 ? undefined : tag("LATE")),
    });
    return [show(new Error("boom").stack), reads];
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

// The same scenario source in another kind of realm. node:vm loads only when a scenario uses it.
const inRealm = {
  ShadowRealm: name => JSON.parse(new ShadowRealm().evaluate(program(name))),
  // Error.captureStackTrace in a node:vm context is JavaScriptCore's own and has no formatter hook.
  "node:vm": name => JSON.parse(require("node:vm").runInNewContext(program(name, false))),
};

const [realm, ...names] = process.argv.slice(2);
if (realm === "main") {
  console.log((0, eval)(program(names[0])));
} else {
  // Each scenario in a fresh realm of this kind.
  console.log(JSON.stringify(Object.fromEntries(names.map(name => [name, inRealm[realm](name)]))));
}
