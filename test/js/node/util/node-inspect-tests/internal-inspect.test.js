import assert from "assert";
import { Statement } from "bun:sqlite";
import { expect, test } from "bun:test";
import { withoutAggressiveGC } from "harness";
import util from "util";
import { thrownBy } from "../../inherited-errors";

test("no assertion failures", () => {
  // Errors in accessors are not triggered
  const obj = new Proxy(
    { x: 5 },
    {
      get() {
        throw new Error("Error message");
      },
    },
  );
  assert.strictEqual(util.format(obj), "{ x: 5 }");

  assert.strictEqual(util.formatWithOptions({ numericSeparator: true }, "%d", 4000), "4_000");

  const a = {};
  a.b = a;
  assert.strictEqual(util.inspect(a, { compact: false }), "<ref *1> {\n  b: [Circular *1]\n}");
  assert.strictEqual(util.inspect(a, { compact: true }), "<ref *1> { b: [Circular *1] }");

  const cause = new Error("cause");
  const e2 = new Error("wrapper", { cause });
  assert.match(util.inspect(e2), /\[cause\]: Error: cause\n/);
});

test("boxed BigInt/Symbol with no prototype are still formatted as boxed primitives", () => {
  assert.strictEqual(util.inspect(Object.setPrototypeOf(Object(55n), null)), "[BigInt (null prototype): 55n]");
  assert.strictEqual(
    util.inspect(Object.setPrototypeOf(Object(Symbol("x")), null)),
    "[Symbol (null prototype): Symbol(x)]",
  );
});

// Arrays and typed arrays collect their non-index keys through the native
// getOwnNonIndexProperties (UtilInspect.cpp). These pin down what it has to
// report: string and symbol keys in ownKeys order, non-enumerable keys only
// with showHidden, and numeric-looking keys that are not array indices.
test("util.inspect reports the non-index keys of an array", () => {
  const array = [1, 2];
  array[Symbol("sym")] = "s";
  array.str = "v";
  Object.defineProperty(array, "hiddenStr", { value: 1, enumerable: false });
  Object.defineProperty(array, Symbol("hiddenSym"), { value: 2, enumerable: false });
  array["4294967295"] = "not an index";
  array["01"] = "not canonical";

  expect(util.inspect(array)).toBe(
    "[\n" +
      "  1,\n" +
      "  2,\n" +
      "  str: 'v',\n" +
      "  '4294967295': 'not an index',\n" +
      "  '01': 'not canonical',\n" +
      "  Symbol(sym): 's'\n" +
      "]",
  );
  expect(util.inspect(array, { showHidden: true })).toBe(
    "[\n" +
      "  1,\n" +
      "  2,\n" +
      "  [length]: 2,\n" +
      "  str: 'v',\n" +
      "  [hiddenStr]: 1,\n" +
      "  '4294967295': 'not an index',\n" +
      "  '01': 'not canonical',\n" +
      "  Symbol(sym): 's',\n" +
      "  [Symbol(hiddenSym)]: 2\n" +
      "]",
  );

  class Sub extends Array {}
  const sub = Sub.from([1]);
  sub.extra = 1;
  expect(util.inspect(sub)).toBe("Sub(1) [ 1, extra: 1 ]");

  const sparse = [];
  sparse[3] = 1;
  sparse.extra = 1;
  expect(util.inspect(sparse, { showHidden: true })).toBe("[ <3 empty items>, 1, [length]: 4, extra: 1 ]");
});

test("util.inspect reports the non-index keys of a typed array", () => {
  const u8 = new Uint8Array([1, 2]);
  u8[Symbol("sym")] = "s";
  u8.str = "v";
  Object.defineProperty(u8, "hiddenStr", { value: 1, enumerable: false });
  Object.defineProperty(u8, Symbol("hiddenSym"), { value: 2, enumerable: false });

  expect(util.inspect(u8)).toBe("Uint8Array(2) [ 1, 2, str: 'v', Symbol(sym): 's' ]");
  expect(util.inspect(u8, { showHidden: true })).toBe(
    "Uint8Array(2) [\n" +
      "  1,\n" +
      "  2,\n" +
      "  [BYTES_PER_ELEMENT]: 1,\n" +
      "  [length]: 2,\n" +
      "  [byteLength]: 2,\n" +
      "  [byteOffset]: 0,\n" +
      "  [buffer]: ArrayBuffer { [byteLength]: 2 },\n" +
      "  str: 'v',\n" +
      "  [hiddenStr]: 1,\n" +
      "  Symbol(sym): 's',\n" +
      "  [Symbol(hiddenSym)]: 2\n" +
      "]",
  );
});

// From here to `fastestOf`, each expected text is what Node.js v26.12.1 prints.

const getterOf = value => ({
  get a() {
    return value;
  },
});
const getterThatThrows = value => ({
  get a() {
    throw value;
  },
});

test("util.inspect and util.format print -0, an exponent and a negative fraction with numericSeparator", () => {
  const options = { numericSeparator: true };
  expect({
    negativeZero: util.formatWithOptions(options, "%d %i %f %s", -0, -0, -0, -0),
    exponent: util.formatWithOptions(options, "%d %f %s %o", 1.5e-7, 1.5e-7, 1.5e-7, 1.5e-7),
    fraction: util.formatWithOptions(options, "%d %f %s %O", -0.1234, -0.1234, -0.1234, [-0.1234]),
    typedArray: util.inspect(new Float64Array([-0, 1.5e-7, -0.5, 100000.5]), options),
    boxed: util.inspect([new Number(-0), new Number(1e-7), new Number(-0.1234)], options),
    mapEntry: util.inspect(new Map([[-0.1234, 1e-7]]), options),
    getter: util.inspect(getterOf(-0.1234), { getters: true, numericSeparator: true }),
  }).toEqual({
    negativeZero: "-0 0 0 -0",
    exponent: "1.5e-7 1.5e-7 1.5e-7 1.5e-7",
    fraction: "-0.123_4 -0.123_4 -0.123_4 [ -0.123_4 ]",
    typedArray: "Float64Array(4) [ -0, 1.5e-7, -0.5, 100_000.5 ]",
    boxed: "[ [Number: -0], [Number: 1e-7], [Number: -0.123_4] ]",
    mapEntry: "Map(1) { -0.123_4 => 1e-7 }",
    getter: "{ a: [Getter: -0.123_4] }",
  });

  const { numericSeparator } = util.inspect.defaultOptions;
  util.inspect.defaultOptions.numericSeparator = true;
  try {
    expect([util.inspect(-0.25), util.format("%d", 1.5e-7)]).toEqual(["-0.25", "1.5e-7"]);
  } finally {
    util.inspect.defaultOptions.numericSeparator = numericSeparator;
  }
});

const refersToItsObject = function f() {};
refersToItsObject.object = getterOf(refersToItsObject);

test.each([
  ["a class", getterOf(class A {}), { getters: true }, "{ a: [Getter] [class A] }"],
  [
    "a function with a property",
    getterOf(Object.assign(function f() {}, { x: 1 })),
    { getters: true },
    "{ a: [Getter] [Function: f] { x: 1 } }",
  ],
  [
    "a function, with getters: 'set' and a setter",
    Object.defineProperty({}, "a", { get: () => function g() {}, set() {}, enumerable: true }),
    { getters: "set" },
    "{ a: [Getter/Setter] [Function: g] }",
  ],
  [
    "a function, with colors",
    getterOf(function g() {}),
    { getters: true, colors: true },
    "{ a: \x1B[36m[Getter]\x1B[39m \x1B[36m[Function: g]\x1B[39m }",
  ],
  [
    "a function, at an array index",
    Object.defineProperty([1], 1, { get: () => function h() {}, enumerable: true }),
    { getters: true },
    "[ 1, [Getter] [Function: h] ]",
  ],
  [
    "a function, on the prototype with showHidden",
    { __proto__: getterOf(function k() {}) },
    { getters: true, showHidden: true },
    "{\n" +
      "  a: [Getter] <ref *1> [Function: k] {\n" +
      "    [length]: 0,\n" +
      "    [name]: 'k',\n" +
      "    [prototype]: { [constructor]: [Circular *1] }\n" +
      "  }\n" +
      "}",
  ],
  [
    "a function that refers to the object",
    refersToItsObject.object,
    { getters: true },
    "<ref *1> { a: [Getter] [Function: f] { object: [Circular *1] } }",
  ],
])("util.inspect formats a getter that returns %s", (_, object, options, expected) => {
  expect(util.inspect(object, options)).toBe(expected);
});

test("util.inspect prints the value that a getter throws, and keeps the indentation of the text after it", () => {
  const error = Object.assign(new RangeError("r"), { code: "E_X" });
  error.stack = "RangeError: r\n    at z";
  const throwsInInspect = {
    [util.inspect.custom]() {
      throw error;
    },
  };
  const long = Buffer.alloc(40, "x").toString();
  const after = { b: { c: long, d: long, e: { f: long } } };
  const expected =
    "{\n" +
    "  a: [Getter: <Inspection threw (RangeError: r\n" +
    "      at z {\n" +
    "    code: 'E_X'\n" +
    "  })>],\n" +
    "  b: {\n" +
    `    c: '${long}',\n` +
    `    d: '${long}',\n` +
    `    e: { f: '${long}' }\n` +
    "  }\n" +
    "}";

  expect({
    getterThrows: util.inspect(Object.assign(getterThatThrows(error), after), { getters: true }),
    objectThrows: util.inspect(Object.assign(getterOf(throwsInInspect), after), { getters: true }),
    functionThrows: util.inspect(Object.assign(getterOf(Object.assign(() => {}, throwsInInspect)), after), {
      getters: true,
    }),
    pastDepth: util.inspect({ o: getterThatThrows(error) }, { getters: true, depth: 1 }),
  }).toEqual({
    getterThrows: expected,
    objectThrows: expected,
    functionThrows: expected,
    pastDepth: "{ o: { a: [Getter: <Inspection threw ([RangeError])>] } }",
  });

  // Node.js does not lower the indentation again when the throw comes from two levels below the getter:
  // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/inspect.js#L2567-L2595
  expect(util.inspect(Object.assign(getterOf({ x: throwsInInspect }), { b: 1 }), { getters: true })).toBe(
    "{\n" +
      "    a: [Getter: <Inspection threw (RangeError: r\n" +
      "        at z {\n" +
      "      code: 'E_X'\n" +
      "    })>],\n" +
      "    b: 1\n" +
      "  }",
  );
});

test("util.inspect throws the error of a nested inspect.custom as it is", () => {
  const error = new TypeError("boom");
  const value = {
    a: [
      {
        [util.inspect.custom]() {
          throw error;
        },
      },
    ],
  };
  expect(thrownBy(() => util.inspect(value))).toBe(error);
  expect(thrownBy(() => util.format("%o", value))).toBe(error);
});

function detachedDataView() {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  return view;
}
const detachedDataViewText =
  "DataView {\n" +
  "    [byteLength]: 0,\n" +
  "    [byteOffset]: undefined,\n" +
  "    [buffer]: ArrayBuffer { (detached), [byteLength]: 0 }\n" +
  "  }";

test("util.inspect keeps its indentation after a DataView that is out of the bounds of its buffer", () => {
  const shrunk = new ArrayBuffer(8, { maxByteLength: 16 });
  const viewOfShrunk = new DataView(shrunk, 4, 4);
  shrunk.resize(2);
  const multiLine = { [util.inspect.custom]: () => "line1\nline2" };

  expect({
    nested: util.inspect({ n: { dv: detachedDataView() }, after: { x: { y: 1 } } }),
    twice: util.inspect([detachedDataView(), detachedDataView(), { z: { w: 1 } }], { depth: 4 }),
    beforeCustom: util.inspect({ dv: detachedDataView(), c: multiLine }),
    shrunk: util.inspect({ dv: viewOfShrunk, after: { x: { y: 1 } } }),
  }).toEqual({
    nested:
      "{\n" +
      "  n: {\n" +
      "    dv: DataView {\n" +
      "      [byteLength]: 0,\n" +
      "      [byteOffset]: undefined,\n" +
      "      [buffer]: [ArrayBuffer]\n" +
      "    }\n" +
      "  },\n" +
      "  after: { x: { y: 1 } }\n" +
      "}",
    twice: `[\n  ${detachedDataViewText},\n  ${detachedDataViewText},\n  { z: { w: 1 } }\n]`,
    beforeCustom: `{\n  dv: ${detachedDataViewText},\n  c: line1\n  line2\n}`,
    shrunk:
      "{\n" +
      "  dv: DataView {\n" +
      "    [byteLength]: 2,\n" +
      "    [byteOffset]: undefined,\n" +
      "    [buffer]: ArrayBuffer { [Uint8Contents]: <00 00>, [byteLength]: 2 }\n" +
      "  },\n" +
      "  after: { x: { y: 1 } }\n" +
      "}",
  });
});

test.each([
  ["Foo", "a.Foo", "a.Foo {}"],
  ["Foo", "a.b.Foo", "a.b.Foo {}"],
  ["Foo", "a..Foo", "a..Foo {}"],
  ["Foo", ".Foo", "Foo [.Foo] {}"],
  ["Foo", "Foo.", "Foo [Foo.] {}"],
  ["Foo", "a.Bar", "Foo [a.Bar] {}"],
  ["Foo", "a.foo", "Foo [a.foo] {}"],
  ["FooBar", "Foo", "FooBar [Foo] {}"],
  ["Foo", "Foo", "Foo {}"],
  // Node.js compares the name with the text after the last dot of the tag, so a name with a dot is never equal:
  // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/inspect.js#L1032-L1038
  ["a.Foo", "a.Foo", "a.Foo [a.Foo] {}"],
])("util.inspect of an instance of the class %j with the Symbol.toStringTag %j", (name, tag, expected) => {
  const Class = { [name]: class {} }[name];
  Object.defineProperty(Class.prototype, Symbol.toStringTag, { value: tag });
  expect(util.inspect(new Class())).toBe(expected);
});

test("util.inspect prints a namespaced Symbol.toStringTag alone in every prefix", () => {
  const tagged = (value, tag) => Object.defineProperty(value, Symbol.toStringTag, { value: tag });
  class NamespacedError extends TypeError {}
  const error = tagged(new NamespacedError("m"), "ns.NamespacedError");
  error.stack = "TypeError: m\n    at x";

  expect({
    map: util.inspect(tagged(new (class M extends Map {})([[1, 2]]), "ns.M")),
    array: util.inspect(tagged(new (class A extends Array {})(1, 2), "ns.A")),
    typedArray: util.inspect(tagged(new (class U extends Uint8Array {})(2), "ns.U")),
    object: util.inspect(tagged({}, "ns.Object")),
    regexp: util.inspect(tagged(/x/, "ns.RegExp")),
    date: util.inspect(tagged(new Date(0), "ns.Date")),
    promise: util.inspect(tagged(Promise.resolve(1), "ns.Promise")),
    error: util.inspect(error),
    pastDepth: util.inspect({ a: tagged(Object.assign(new (class Foo {})(), { x: 1 }), "ns.Foo") }, { depth: 0 }),
    builtIns: [util.inspect(new Intl.Locale("en")), util.inspect(new WebAssembly.Memory({ initial: 1 }))],
    // These do not take their name from the prefix, and print as before.
    nullPrototype: util.inspect(tagged({ __proto__: null }, "ns.Object")),
    function: util.inspect(tagged(function named() {}, "ns.Function")),
    boxed: util.inspect(tagged(new Number(3), "ns.Number")),
  }).toEqual({
    map: "ns.M(1) { 1 => 2 }",
    array: "ns.A(2) [ 1, 2 ]",
    typedArray: "ns.U(2) [ 0, 0 ]",
    object: "ns.Object {}",
    regexp: "ns.RegExp /x/",
    date: "ns.Date 1970-01-01T00:00:00.000Z",
    promise: "ns.Promise { 1 }",
    error: "ns.NamespacedError [TypeError]: m\n    at x",
    pastDepth: "{ a: [ns.Foo] }",
    builtIns: ["Intl.Locale {}", "WebAssembly.Memory {}"],
    nullPrototype: "[Object: null prototype] [ns.Object] {}",
    function: "[Function: named] [ns.Function]",
    boxed: "[Number: 3] [ns.Number]",
  });
});

test("util.inspect prints the error and suppressed properties of an error that are not enumerable", () => {
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  try {
    const suppressed = () => new SuppressedError(new Error("dispose"), new Error("body"), "msg");
    const hidden = (error, key, descriptor) => Object.defineProperty(error, key, { ...descriptor, enumerable: false });
    const withStacks = suppressed();
    withStacks.stack = "SuppressedError: msg\n    at x";
    withStacks.error.stack = "Error: dispose\n    at d";
    let getterCalls = 0;

    expect({
      afterCause: util.inspect(Object.assign(suppressed(), { cause: new Error("c") })),
      afterErrors: util.inspect(hidden(new AggregateError([new Error("x")], "agg"), "error", { value: 1 })),
      sorted: util.inspect(Object.assign(suppressed(), { zebra: 1, alpha: 2 }), { sorted: true }),
      showHidden: util.inspect(suppressed(), { showHidden: true }).match(/\[(error|suppressed)\]/g),
      enumerable: util.inspect(Object.assign(new Error("plain"), { error: 1, suppressed: "s" })),
      undefinedValue: util.inspect(hidden(new Error("plain"), "error", { value: undefined })),
      getter: util.inspect(hidden(new Error("plain"), "suppressed", { get: () => void getterCalls++ })),
      primitives: util.inspect(new SuppressedError(1, "two", "msg")),
      pastDepth: util.inspect({ a: suppressed() }, { depth: 0 }),
      stacks: util.inspect(withStacks),
      format: util.format("%O", suppressed()),
    }).toEqual({
      afterCause:
        "[SuppressedError: msg] {\n  cause: [Error: c],\n  [error]: [Error: dispose],\n  [suppressed]: [Error: body]\n}",
      afterErrors: "[AggregateError: agg] { [errors]: [ [Error: x] ], [error]: 1 }",
      sorted:
        "[SuppressedError: msg] {\n  [error]: [Error: dispose],\n  [suppressed]: [Error: body],\n  alpha: 2,\n  zebra: 1\n}",
      showHidden: ["[error]", "[suppressed]"],
      enumerable: "[Error: plain] { error: 1, suppressed: 's' }",
      undefinedValue: "[Error: plain] { [error]: undefined }",
      getter: "[Error: plain] { [suppressed]: [Getter] }",
      primitives: "[SuppressedError: msg] { [error]: 1, [suppressed]: 'two' }",
      pastDepth: "{ a: [SuppressedError] }",
      stacks:
        "SuppressedError: msg\n    at x {\n  [error]: Error: dispose\n      at d,\n  [suppressed]: [Error: body]\n}",
      format: "[SuppressedError: msg] {\n  [error]: [Error: dispose],\n  [suppressed]: [Error: body]\n}",
    });
    expect(getterCalls).toBe(0);
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
  }
});

test("util.inspect and node:assert do not throw for a getter or a SuppressedError with an error whose name getter throws", () => {
  const hostile = () => {
    const error = new Error("Oops");
    error.stack = "Error: Oops\n    at x";
    return Object.defineProperty(error, "name", {
      get() {
        throw new Error("name");
      },
    });
  };
  const suppressedError = new SuppressedError(hostile(), 1, "msg");
  suppressedError.stack = "SuppressedError: msg\n    at y";

  expect({
    thrownByGetter: util.inspect(getterThatThrows(hostile()), { getters: true }),
    memberOfSuppressedError: util.inspect(suppressedError),
  }).toEqual({
    thrownByGetter: "{\n  a: [Getter: <Inspection threw (Error: Oops\n      at x)>]\n}",
    memberOfSuppressedError:
      "SuppressedError: msg\n    at y {\n  [error]: Error: Oops\n      at x,\n  [suppressed]: 1\n}",
  });

  // The AssertionError constructor sets the limit to 0 while it builds the message.
  const { stackTraceLimit } = Error;
  try {
    for (const thrown of [null, undefined, hostile()]) {
      const failure = thrownBy(() => assert.deepStrictEqual(getterThatThrows(thrown), {}));
      expect(failure).toBeInstanceOf(assert.AssertionError);
      expect(failure.message).toStartWith("Expected values to be strictly deep-equal:");
    }
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
  }
});

function fastestOf(runs, fn) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

test.each([
  [
    "Array",
    length => Object.assign(new Array(length).fill(7), { extra: true }),
    length => `[ 7, 7, 7, ... ${length - 3} more items, [length]: ${length}, extra: true ]`,
  ],
  [
    "Uint8Array",
    length => Object.assign(new Uint8Array(length), { extra: true }),
    length =>
      `Uint8Array(${length}) [\n` +
      "  0,\n" +
      "  0,\n" +
      "  0,\n" +
      `  ... ${length - 3} more items,\n` +
      "  [BYTES_PER_ELEMENT]: 1,\n" +
      `  [length]: ${length},\n` +
      `  [byteLength]: ${length},\n` +
      "  [byteOffset]: 0,\n" +
      `  [buffer]: ArrayBuffer { [byteLength]: ${length} },\n` +
      "  extra: true\n" +
      "]",
  ],
])("util.inspect of a large %s does not visit every element", (_, create, expected) => {
  const options = { maxArrayLength: 3, showHidden: true };
  const small = create(1_000);
  const large = create(1_000_000);
  expect(util.inspect(small, options)).toBe(expected(1_000));
  expect(util.inspect(large, options)).toBe(expected(1_000_000));

  withoutAggressiveGC(() => {
    const smallMs = fastestOf(5, () => util.inspect(small, options));
    const largeMs = fastestOf(5, () => util.inspect(large, options));
    // With the keys collected through Object.getOwnPropertyDescriptors() this
    // scaled with the length: about 1s for the large one in a release build.
    expect(largeMs).toBeLessThan(smallMs * 20 + 50);
  });
});

// A value is formatted as an error when it inherits from Error.prototype, so its `stack`, `name`,
// `message` and `errors` can be getters that throw. The `name` and `message` of DOMException.prototype
// throw for a receiver that is not a DOMException. The expected text is what node v26.3.0 prints.
const throwingGetter = {
  get() {
    throw new RangeError("getter");
  },
};
test.each([
  [
    "an own stack getter that throws",
    () => Object.defineProperty(new Error("m"), "stack", throwingGetter),
    "[Error: m]",
  ],
  [
    "own stack and name getters that throw",
    () => Object.defineProperties(new Error("m"), { stack: throwingGetter, name: throwingGetter }),
    "[object Error]",
  ],
  [
    "a stack getter that throws and Error.prototype as its prototype",
    () => Object.defineProperty({ __proto__: Error.prototype }, "stack", throwingGetter),
    "[Error]",
  ],
  [
    "stack, name and message getters that throw and Error.prototype as its prototype",
    () =>
      Object.defineProperties(
        { __proto__: Error.prototype },
        { stack: throwingGetter, name: throwingGetter, message: throwingGetter },
      ),
    "[object Object]",
  ],
  ["DOMException.prototype as its prototype", () => ({ __proto__: DOMException.prototype }), "[object DOMException]"],
  ...["name", "message"].map(key => [
    `an enumerable ${key} getter that throws, a stack and Error.prototype as its prototype`,
    () =>
      Object.defineProperty({ __proto__: Error.prototype, stack: "Old: m\n    at x (y:1:1)" }, key, {
        ...throwingGetter,
        enumerable: true,
      }),
    `Old: m\n    at x (y:1:1) {\n  ${key}: [Getter]\n}`,
  ]),
])("util.inspect of an object with %s", (_, create, expected) => {
  expect(util.inspect(create())).toBe(expected);
});

test("util.inspect of an error with an errors getter that throws, and of DOMException.prototype", () => {
  expect(util.inspect(Object.defineProperty(new Error("m"), "errors", throwingGetter))).toStartWith(
    "Error: m\n    at ",
  );
  expect(util.inspect(DOMException.prototype)).toStartWith("[object DOMException] {");
});

test("util.inspect keeps the first line of a stack that was read before the message getter throws", () => {
  class Foo extends Error {}
  const errors = [new Error("m"), new TypeError("m"), new Foo("m")];
  for (const error of errors) {
    void error.stack;
    Object.defineProperty(error, "message", throwingGetter);
  }
  expect(errors.map(error => util.inspect(error).split("\n")[0])).toEqual([
    "Error: m",
    "TypeError: m",
    "Foo [Error]: m",
  ]);
});

// Node v26.3.0 throws for these two causes.
test.each([
  ["that inherits from DOMException.prototype", () => ({ __proto__: DOMException.prototype }), "[object DOMException]"],
  [
    "with stack and name getters that throw",
    () => Object.defineProperties(new Error("c"), { stack: throwingGetter, name: throwingGetter }),
    "[object Error]",
  ],
])("util.inspect does not throw for an error with a cause %s", (_, cause, expected) => {
  const text = util.inspect(new Error("a", { cause: cause() }));
  expect(text).toStartWith("Error: a\n    at ");
  expect(text).toEndWith(` {\n  [cause]: ${expected}\n}`);
});

// Node v26.3.0 prints "[object Error]" for these two: V8 makes the stack when it is first read, and
// that read throws.
const throwingToString = {
  toString() {
    throw new RangeError("toString");
  },
};
test.each([
  ["name", "Error: m"],
  ["message", "Error"],
])("util.inspect prints the stack of an error with a %s whose toString throws", (key, firstLine) => {
  const error = Object.defineProperty(new Error("m"), key, { value: throwingToString });
  const text = util.inspect(error);
  expect(text).toStartWith(`${firstLine}\n    at `);
  expect(text).toBe(error.stack);
});

// Node v26.3.0 prints a stack that is no string as a value, below "Error: m".
test("util.inspect does not throw for an error with an enumerable stack that is a Symbol", () => {
  const error = Object.defineProperty(new Error("m"), "stack", { value: Symbol("s"), enumerable: true });
  expect(util.inspect(error)).toBe("[Symbol(s)] { stack: Symbol(s) }");
});

test("util.inspect puts a name with a replacement pattern in the first line as it is", () => {
  const names = ["A$&B", "$$", "$`", "$'"];
  const firstLines = names.map(name => {
    const error = new Error("m");
    void error.stack;
    error.name = name;
    return util.inspect(error).split("\n")[0];
  });
  expect(firstLines).toEqual(names.map(name => `${name}: m`));
});

//! non-standard property, should this be kept?
test.skip("util.stylizeWithHTML", () => {
  assert.strictEqual(
    util.inspect(
      {
        a: 1,
        b: "<p>\xA0\u{1F4A9}</p>",
        "&lt;": NaN,
        [Symbol("<br>")]: false,
        buf: new Uint8Array([1, 2, 3, 4]),
      },
      {
        compact: false,
        stylize: util.stylizeWithHTML,
      },
    ),
    "{\n" +
      '  a: <span style="color:yellow;">1</span>,\n' +
      '  b: <span style="color:green;">&apos;&lt;p&gt;&nbsp;\u{1F4A9}&lt;&#47;p&gt;&apos;</span>,\n' +
      '  <span style="color:green;">&apos;&amp;lt&#59;&apos;</span>: <span style="color:yellow;">NaN</span>,\n' +
      "  buf: Uint8Array(4) [\n" +
      '    <span style="color:yellow;">1</span>,\n' +
      '    <span style="color:yellow;">2</span>,\n' +
      '    <span style="color:yellow;">3</span>,\n' +
      '    <span style="color:yellow;">4</span>\n' +
      "  ],\n" +
      '  [<span style="color:green;">Symbol&#40;&lt;br&gt;&#41;</span>]: <span style="color:yellow;">false</span>\n' +
      "}",
  );
});

test("util.inspect prints a value of Bun whose Symbol.toStringTag getter throws", () => {
  // The getter reads a private field, which the prototype does not have.
  expect(util.inspect(Statement.prototype)).toBe("{}");
});
