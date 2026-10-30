// Each case changes built-ins that util.inspect reads, so each needs a process of its own:
//   <runtime> well-known-prototypes-fixture.cjs <case>
// It prints one line of JSON. internal-inspect.test.js expects what Node.js prints for the same case.
const TypedArray = Object.getPrototypeOf(Uint8Array);
Error.stackTraceLimit = 0;

// One value below each prototype of `wellKnownPrototypes` in Node's lib/internal/util/inspect.js.
const values = new Map([
  [Array, [1]],
  [ArrayBuffer, new ArrayBuffer(1)],
  [Function, function f() {}],
  [Map, new Map([[1, 2]])],
  [Set, new Set([1])],
  [Object, { a: 1 }],
  [TypedArray, Object.create(TypedArray.prototype)],
  [RegExp, /a/g],
  [Date, new Date(0)],
  [DataView, new DataView(new ArrayBuffer(1))],
  [Error, new Error("e")],
  [AggregateError, new AggregateError([], "a")],
  [RangeError, new RangeError("r")],
  [TypeError, new TypeError("t")],
  [Boolean, new Boolean(true)],
  [Number, new Number(1)],
  [String, new String("s")],
  [Promise, Promise.resolve(1)],
  [WeakMap, new WeakMap()],
  [WeakSet, new WeakSet()],
]);
const nameOf = constructor => (constructor === TypedArray ? "TypedArray" : constructor.name);
const onOneLine = text => text.replace(/\s*\n\s*/g, " ");
const belowErrorPrototype = () => Object.create(Error.prototype, { message: { value: "m" } });

// Node.js asks of each whether Error.prototype or Object.prototype is above it, with
// FunctionPrototypeSymbolHasInstance: the answers are no, yes, no (for the cause) and yes.
function valuesTestedAgainstErrorOrObject(inspect) {
  const withCause = new Error("e", { cause: { code: 1 } });
  withCause.stack = "Error: e\n    at f (file:///f.js:1:1)";
  return {
    "a Promise": Promise.resolve(1),
    "an object below Error.prototype": belowErrorPrototype(),
    "an Error with a cause that is no Error": withCause,
    "an object with an inspect function": {
      [inspect.custom]: (depth, options) =>
        Object.getPrototypeOf(options) === Object.prototype ? "options of this realm" : "options for another realm",
    },
  };
}

// `lockdown()` of the package `ses` makes `constructor` an accessor, so that a frozen prototype does not stop an
// assignment of `constructor` to an object below it. Its getter answers the class. This one answers another class:
// a name that came from the getter would show.
class NotTheConstructor {}
function replaceConstructorByAccessor(prototype) {
  Object.defineProperty(prototype, "constructor", { get: () => NotTheConstructor, set() {}, configurable: true });
}

const printed = {};
let printsWhenWorkerAnswers = false;
switch (process.argv[2]) {
  case "accessor-constructors": {
    for (const { prototype } of values.keys()) replaceConstructorByAccessor(prototype);
    const { inspect } = require("node:util");
    for (const [constructor, value] of values) printed[nameOf(constructor)] = onOneLine(inspect(value));
    break;
  }

  case "own-has-instance": {
    const { inspect } = require("node:util");
    printed.calls = 0;
    const throwWhenAsked = constructor =>
      Object.defineProperty(constructor, Symbol.hasInstance, {
        value() {
          printed.calls++;
          throw new Error(`${nameOf(constructor)}[Symbol.hasInstance] was called`);
        },
        configurable: true,
      });
    for (const [constructor, value] of values) {
      throwWhenAsked(constructor);
      printed[nameOf(constructor)] = onOneLine(inspect(value));
      delete constructor[Symbol.hasInstance];
    }
    const tested = valuesTestedAgainstErrorOrObject(inspect);
    throwWhenAsked(Error);
    throwWhenAsked(Object);
    for (const label in tested) printed[label] = onOneLine(inspect(tested[label]));
    break;
  }

  // node:util is loaded, then the program replaces globals, then the first object is named.
  case "globals-replaced": {
    const { inspect } = require("node:util");
    const { Date: RealDate, WeakMap: RealWeakMap, DataView: RealDataView } = globalThis;
    for (const { prototype } of [RealDate, RealWeakMap, RealDataView]) replaceConstructorByAccessor(prototype);
    const madeBelowErrorPrototype = belowErrorPrototype();
    globalThis.Date = class MockDate extends RealDate {};
    globalThis.WeakMap = class WeakMap {};
    delete globalThis.DataView;
    globalThis.Error = class Error {};
    printed["a Date made before"] = inspect(values.get(RealDate));
    printed["new MockDate(0)"] = inspect(new Date(0));
    printed["a WeakMap made before"] = inspect(values.get(RealWeakMap));
    printed["an instance of a class named WeakMap"] = inspect(new WeakMap());
    printed["a DataView made before"] = onOneLine(inspect(values.get(RealDataView)));
    printed["an object made before below Error.prototype"] = inspect(madeBelowErrorPrototype);
    break;
  }

  case "typed-array-constructor-reparented": {
    Object.setPrototypeOf(Uint8Array, Function.prototype);
    const { inspect } = require("node:util");
    printed["function f() {}"] = inspect(values.get(Function));
    printed["Object.create(%TypedArray%.prototype)"] = inspect(values.get(TypedArray), { showHidden: true });
    printed["new Float64Array(1)"] = inspect(new Float64Array(1));
    break;
  }

  // The prototypes of a Worker's realm are not those that the first thread has named.
  case "worker": {
    const { inspect } = require("node:util");
    const { Worker } = require("node:worker_threads");
    printed["in the first thread"] = inspect(values.get(TypedArray), { showHidden: true });
    const worker = new Worker(
      `const belowTypedArrayPrototype = Object.create(Object.getPrototypeOf(Uint8Array.prototype));
      const text = require("node:util").inspect(belowTypedArrayPrototype, { showHidden: true });
      require("node:worker_threads").parentPort.postMessage(text);`,
      { eval: true },
    );
    worker.once("message", text => {
      printed["in a Worker"] = text;
      console.log(JSON.stringify(printed));
    });
    printsWhenWorkerAnswers = true;
    break;
  }

  // `constructor` is an accessor, as after lockdown() of ses: its descriptor has no `value` of its own, and the read
  // of `value` runs this getter between the two walks up from the inspected object.
  case "getter-of-object-prototype-value": {
    const { inspect } = require("node:util");
    const middle = Object.create(Array.prototype, { constructor: { get: () => Array, configurable: true } });
    const inspected = Object.create(middle);
    Object.defineProperty(Object.prototype, "value", {
      get() {
        Object.setPrototypeOf(inspected, null);
      },
      configurable: true,
    });
    const text = inspect(inspected);
    delete Object.prototype.value;
    printed["two steps below Array.prototype"] = text;
    break;
  }

  // A new context has the classes of the language and no others. The test runs this case under Node.js too.
  case "every-class-of-the-language": {
    const { inspect } = require("node:util");
    const names = require("node:vm").runInNewContext("Object.getOwnPropertyNames(globalThis)");
    const constructors = names.map(name => globalThis[name]).filter(value => typeof value === "function");
    const prototypes = new Map([["TypedArray", TypedArray.prototype]]);
    for (const constructor of constructors) {
      if (Object(constructor.prototype) === constructor.prototype)
        prototypes.set(constructor.name, constructor.prototype);
    }
    for (const prototype of prototypes.values()) {
      if ("value" in Object.getOwnPropertyDescriptor(prototype, "constructor")) replaceConstructorByAccessor(prototype);
    }
    for (const [name, prototype] of prototypes) printed[name] = onOneLine(inspect(Object.create(prototype)));
    break;
  }

  default:
    throw new Error(`unknown case ${process.argv[2]}`);
}
if (!printsWhenWorkerAnswers) console.log(JSON.stringify(printed));
