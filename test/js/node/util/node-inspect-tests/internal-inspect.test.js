import assert from "assert";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast, withoutAggressiveGC } from "harness";
import { join } from "node:path";
import vm from "node:vm";
import util from "util";

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

// util.inspect names a value by the first prototype above it that Node.js lists as well known, and does not read
// `constructor` for that (createWellKnownPrototypes in UtilInspect.cpp). Every string below is what Node.js v26.12.1
// prints, but for one order: JavaScriptCore lists the own key `BYTES_PER_ELEMENT` before `constructor`, V8 after it.
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const accessorsOfTypedArrayPrototype =
  "  [buffer]: [Getter],\n" +
  "  [byteLength]: [Getter],\n" +
  "  [byteOffset]: [Getter],\n" +
  "  [length]: [Getter],\n" +
  "  [Symbol(Symbol.toStringTag)]: [Getter]\n";

test("util.inspect does not list the accessors of %TypedArray%.prototype under a value directly below it", () => {
  // Uint8Array.prototype has methods of its own, so its lines are counted: `%o` reaches it through the class.
  expect(util.format("%o", { T: Uint8Array }).split("\n")).toHaveLength(18);
  expect(util.format("%o", { T: Float64Array })).toBe(
    "{\n" +
      "  T: <ref *1> [Function: Float64Array] {\n" +
      "    [length]: 3,\n" +
      "    [name]: 'Float64Array',\n" +
      "    [prototype]: TypedArray { [BYTES_PER_ELEMENT]: 8, [constructor]: [Circular *1] },\n" +
      "    [BYTES_PER_ELEMENT]: 8,\n" +
      "    [Symbol(Symbol.species)]: [Getter]\n" +
      "  }\n" +
      "}",
  );

  for (const { name, prototype, BYTES_PER_ELEMENT } of [
    Int8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float16Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
  ]) {
    expect(util.inspect(prototype, { showHidden: true })).toBe(
      "<ref *1> TypedArray {\n" +
        `  [BYTES_PER_ELEMENT]: ${BYTES_PER_ELEMENT},\n` +
        `  [constructor]: [Function: ${name}] {\n` +
        "    [length]: 3,\n" +
        `    [name]: '${name}',\n` +
        "    [prototype]: [Circular *1],\n" +
        `    [BYTES_PER_ELEMENT]: ${BYTES_PER_ELEMENT},\n` +
        "    [Symbol(Symbol.species)]: [Getter]\n" +
        "  }\n" +
        "}",
    );
  }

  expect(util.inspect(Object.create(TypedArrayPrototype), { showHidden: true, getters: true })).toBe("TypedArray {}");
  expect(util.inspect(Object.setPrototypeOf(new Uint8Array(2), TypedArrayPrototype), { showHidden: true })).toBe(
    "TypedArray(2) [Uint8Array] [\n" +
      "  0,\n" +
      "  0,\n" +
      "  [BYTES_PER_ELEMENT]: undefined,\n" +
      "  [length]: 2,\n" +
      "  [byteLength]: 2,\n" +
      "  [byteOffset]: 0,\n" +
      "  [buffer]: ArrayBuffer { [byteLength]: 2 }\n" +
      "]",
  );
});

test("util.inspect lists the accessors of %TypedArray%.prototype two steps below it and for another realm", () => {
  expect(util.inspect(Object.create(Object.create(TypedArrayPrototype)), { showHidden: true })).toBe(
    `TypedArray {\n${accessorsOfTypedArrayPrototype}}`,
  );
  const ofAnotherRealm = vm.runInNewContext("Object.create(Object.getPrototypeOf(Uint8Array.prototype))");
  expect(util.inspect(ofAnotherRealm, { showHidden: true })).toBe(`TypedArray {\n${accessorsOfTypedArrayPrototype}}`);
});

// Node.js walks up from the value a second time (FunctionPrototypeSymbolHasInstance) before it takes a name from the
// table. A Proxy in the chain counts the walks, and can answer each of them differently.
test.each([
  ["Array.prototype", [Array.prototype], "Array {}", 3],
  ["Array.prototype, then Object.prototype", [Array.prototype, Object.prototype], "{}", 4],
  ["null, then Array.prototype", [null, Array.prototype], "Object <Array> {}", 4],
  ["null, then Date.prototype", [null, Date.prototype], "Object <Date> {}", 4],
])(
  "util.inspect asks a Proxy that answers %s for its prototype as often as Node.js does",
  (_, answers, text, asked) => {
    let calls = 0;
    const proxy = new Proxy({}, { getPrototypeOf: () => answers[Math.min(calls++, answers.length - 1)] });
    expect({ text: util.inspect(Object.create(proxy)), asked: calls }).toEqual({ text, asked });
  },
);

// The second walk can find another chain with no Proxy in it: the program runs between the two. Each value is two
// steps below Array.prototype and loses its prototype there, so Node.js does not name it `Array`.
test("util.inspect walks up again after the Symbol.hasInstance of a `constructor` changed the chain", () => {
  const middle = Object.create(Array.prototype);
  const value = Object.create(middle);
  middle.constructor = function Named() {};
  Object.defineProperty(middle.constructor, Symbol.hasInstance, {
    value() {
      Object.setPrototypeOf(value, null);
      return false;
    },
  });
  expect(util.inspect(value)).toBe("Object <Array> {}");
});

test("util.inspect walks up again after the Proxy sandbox of a node:vm global changed the chain", () => {
  let value;
  const sandbox = new Proxy(
    {},
    {
      getOwnPropertyDescriptor(target, key) {
        if (value !== undefined && key === "constructor") Object.setPrototypeOf(value, null);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  // The global object of the context is no Proxy. It asks the sandbox for each own property.
  const middle = vm.runInContext("globalThis", vm.createContext(sandbox));
  Object.setPrototypeOf(middle, Array.prototype);
  value = Object.create(middle);
  expect({ text: util.inspect(value), isProxy: util.types.isProxy(middle) }).toEqual({
    text: "Object <Array> {}",
    isProxy: false,
  });
});

const valuesOfBuiltInClasses = {
  Array: "[ 1 ]",
  ArrayBuffer: "ArrayBuffer { [Uint8Contents]: <00>, [byteLength]: 1 }",
  Function: "[Function: f]",
  Map: "Map(1) { 1 => 2 }",
  Set: "Set(1) { 1 }",
  Object: "{ a: 1 }",
  TypedArray: "TypedArray {}",
  RegExp: "/a/g",
  Date: "1970-01-01T00:00:00.000Z",
  DataView:
    "DataView { [byteLength]: 1, [byteOffset]: 0, [buffer]: ArrayBuffer { [Uint8Contents]: <00>, [byteLength]: 1 } }",
  Error: "[Error: e]",
  AggregateError: "[AggregateError: a] { [errors]: [] }",
  RangeError: "[RangeError: r]",
  TypeError: "[TypeError: t]",
  Boolean: "[Boolean: true]",
  Number: "[Number: 1]",
  String: "[String: 's']",
  Promise: "Promise { 1 }",
  WeakMap: "WeakMap { <items unknown> }",
  WeakSet: "WeakSet { <items unknown> }",
};

const fixture = join(import.meta.dir, "well-known-prototypes-fixture.cjs");

async function printedBy(exe, fixtureCase) {
  await using proc = Bun.spawn({ cmd: [exe, fixture, fixtureCase], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const printed = JSON.parse(stdout);
  expect(exitCode).toBe(0);
  return printed;
}

// Each case of the fixture changes built-ins that util.inspect reads: a process for each.
test.concurrent.each([
  [
    "every `constructor` is an accessor, as after lockdown() of ses, and answers another class",
    "accessor-constructors",
    valuesOfBuiltInClasses,
  ],
  [
    "each constructor has a Symbol.hasInstance of its own that throws",
    "own-has-instance",
    {
      calls: 0,
      ...valuesOfBuiltInClasses,
      "a Promise": "Promise { 1 }",
      "an object below Error.prototype": "[Error: m]",
      "an Error with a cause that is no Error": "Error: e at f (file:///f.js:1:1) { [cause]: { code: 1 } }",
      "an object with an inspect function": "options of this realm",
    },
  ],
  [
    "the program replaces the globals Date, WeakMap, DataView and Error before the first call",
    "globals-replaced",
    {
      "a Date made before": valuesOfBuiltInClasses.Date,
      "new MockDate(0)": "MockDate 1970-01-01T00:00:00.000Z",
      "a WeakMap made before": valuesOfBuiltInClasses.WeakMap,
      "an instance of a class named WeakMap": "WeakMap {}",
      "a DataView made before": valuesOfBuiltInClasses.DataView,
      "an object made before below Error.prototype": "[Error: m]",
    },
  ],
  [
    "Uint8Array no longer inherits from %TypedArray%",
    "typed-array-constructor-reparented",
    {
      "function f() {}": "[Function: f]",
      "Object.create(%TypedArray%.prototype)": "TypedArray {}",
      "new Float64Array(1)": "Float64Array(1) [ 0 ]",
    },
  ],
  [
    "a Worker has prototypes of its own",
    "worker",
    { "in the first thread": "TypedArray {}", "in a Worker": "TypedArray {}" },
  ],
  [
    "a getter of Object.prototype.value changes the chain between the two walks",
    "getter-of-object-prototype-value",
    { "two steps below Array.prototype": "Object <Array> {}" },
  ],
])("util.inspect names the values of built-in classes where %s", async (_, fixtureCase, expected) => {
  expect(await printedBy(bunExe(), fixtureCase)).toEqual(expected);
});

// The rows of the table are copies of Node's. A row that only one of the two has gives another name here.
const node = nodeExeAtLeast(process.versions.node);
test.skipIf(!node)("util.inspect names an object below each prototype of the language as Node.js does", async () => {
  const [ofBun, ofNode] = await Promise.all([bunExe(), node].map(exe => printedBy(exe, "every-class-of-the-language")));
  const classesOfBoth = Object.keys(ofNode).filter(name => name in ofBun);
  expect(classesOfBoth).toContain("TypedArray");
  expect(classesOfBoth.map(name => [name, ofBun[name]])).toEqual(classesOfBoth.map(name => [name, ofNode[name]]));
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
