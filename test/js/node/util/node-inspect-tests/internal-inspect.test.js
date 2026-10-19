import assert from "assert";
import { Statement } from "bun:sqlite";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, withoutAggressiveGC } from "harness";
import { Console } from "node:console";
import { Writable } from "node:stream";
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

// Node.js takes the name of a value whose prototype chain has no usable constructor from V8's GetConstructorName.
// That lookup reads data properties only: no getter and no Proxy trap runs. UtilInspect.cpp has a port of its walk
// of the chain and of V8's word for a type. V8 first asks for the constructor that made the value, which
// JavaScriptCore does not record: the type of a built-in value and the kind of a function stand in for it.
// Every expected string is the output of Node.js v26.3.0, but for the first strings of `differsFromNode`.
const getterRuns = [];
// An accessor that records each run. It throws, or returns `result` when one is given.
const accessor = (key, result) => ({
  get() {
    getterRuns.push(key);
    if (result === undefined) throw new Error(`the ${key} getter ran`);
    return result;
  },
  configurable: true,
});
const data = value => ({ value, writable: true, configurable: true });
const bare = () => ({ __proto__: null });
const define = Object.defineProperty;
const child = Object.create;
const reproto = Object.setPrototypeOf;
const tag = Symbol.toStringTag;
const tagged = () => define(bare(), tag, data("Tag"));
const parsed = json => Object.assign(bare(), JSON.parse(json));
const pastDepth = value => util.inspect({ a: value }, { depth: 0 });
const firstLine = text => text.slice(0, text.indexOf("\n"));
const asPrototype = value => (reproto({}, value), value);
// A function of another realm, so that no function of this realm becomes a prototype.
const native = name => vm.runInNewContext(name);
function Foo() {}
class Baz {}
class NameGetter {
  static get name() {
    getterRuns.push("name");
    return "FromGetter";
  }
}
const renamed = define(function Renamed() {}, "name", { value: "NewName" });
const noName = new Function("return function () {}")();
const namedByProperty = { expression: function () {} };

// prettier-ignore
const constructorNames = [
  // A `constructor` accessor does not run.
  ["own constructor getter that throws", () => util.inspect(define(bare(), "constructor", { ...accessor("constructor"), enumerable: true })), "[Object: null prototype] { constructor: [Getter] }"],
  ["own constructor getter that returns a function", () => util.inspect(define(bare(), "constructor", { ...accessor("constructor", Foo), enumerable: true })), "[Object: null prototype] { constructor: [Getter] }"],
  ["constructor getter that throws, on the prototype", () => util.inspect(child(define(bare(), "constructor", accessor("constructor")))), "Object <[Object: null prototype] {}> {}"],
  ["constructor getter that returns a function, on the prototype", () => util.inspect(child(define(bare(), "constructor", accessor("constructor", Foo)))), "Object <[Object: null prototype] {}> {}"],
  ["constructor getter that throws, two prototypes up", () => util.inspect(child(child(define(bare(), "constructor", accessor("constructor"))))), "Object <Object <[Object: null prototype] {}>> {}"],
  ["own constructor getter that throws, past the depth", () => pastDepth(define(bare(), "constructor", { ...accessor("constructor"), enumerable: true })), "{ a: [Object: null prototype] }"],
  ["constructor getter that throws, on the prototype, past the depth", () => pastDepth(child(define(bare(), "constructor", accessor("constructor")))), "{ a: Object <Complex prototype> {} }"],

  // Parsed data under the key `constructor` is not a name.
  ["parsed data whose constructor.name is an object", () => util.inspect(parsed('{"constructor":{"name":{"toString":1}}}')), "[Object: null prototype] { constructor: { name: { toString: 1 } } }"],
  ["parsed data whose constructor.name is a string", () => util.inspect(parsed('{"constructor":{"name":"Evil\\nname"}}')), "[Object: null prototype] { constructor: { name: 'Evil\\nname' } }"],
  ["child of parsed data whose constructor.name is a string", () => util.inspect(child(parsed('{"constructor":{"name":"Evil\\nname"}}'))), "Object <[Object: null prototype]> {}"],

  // A `constructor` data property counts when it is a function with a name, and not on the value itself.
  ["own constructor", () => util.inspect(define(bare(), "constructor", data(Foo))), "[Object: null prototype] {}"],
  ["constructor on the prototype", () => util.inspect(child(define(bare(), "constructor", data(Foo)))), "Foo <[Object: null prototype] {}> {}"],
  ["class on the prototype", () => util.inspect(child(define(bare(), "constructor", data(Baz)))), "Baz <[Object: null prototype] {}> {}"],
  ["built-in constructor on the prototype", () => util.inspect(child(define(bare(), "constructor", data(Map)))), "Map <[Object: null prototype] {}> {}"],
  ["constructor that is not a function", () => util.inspect(child(define(bare(), "constructor", data({ name: "Fake" })))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a bound function", () => util.inspect(child(define(bare(), "constructor", data(Foo.bind(null))))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a Proxy of a function", () => util.inspect(child(define(bare(), "constructor", data(new Proxy(Foo, {}))))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a function of a ShadowRealm", () => util.inspect(child(define(bare(), "constructor", data(new ShadowRealm().evaluate("(function Remote() {})"))))), "Object <[Object: null prototype] {}> {}"],
  ["constructor with no name", () => util.inspect(child(define(bare(), "constructor", data(noName)))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that the Function constructor made", () => util.inspect(child(define(bare(), "constructor", data(new Function(""))))), "Object <[Object: null prototype] {}> {}"],
  ["constructor named Object", () => util.inspect(child(define(bare(), "constructor", data(function Object() {})))), "Object <[Object: null prototype] {}> {}"],
  ["constructor with no name, below a constructor with a name", () => util.inspect(child(define(child(define(bare(), "constructor", data(Foo))), "constructor", data(noName)))), "Foo <Foo <[Object: null prototype] {}>> {}"],
  ["constructor named by the property it was written in", () => util.inspect(child(define(bare(), "constructor", data(namedByProperty.expression)))), "expression <[Object: null prototype] {}> {}"],
  ["constructor whose name was redefined", () => util.inspect(child(define(bare(), "constructor", data(renamed)))), "Renamed <[Object: null prototype] {}> {}"],
  // Node's JS reads the `name` property three times before the lookup. The lookup does not read it.
  ["constructor whose name is a getter", () => util.inspect(child(define(bare(), "constructor", data(NameGetter)))), "NameGetter <[Object: null prototype] {}> {}", ["name", "name", "name"]],

  // A Symbol.toStringTag data property that is a string counts, on the value too. A tag accessor runs only
  // where formatRaw reads the tag: once for each value it prints.
  ["own tag getter", () => util.inspect(define(bare(), tag, { ...accessor("tag", "FromGetter"), enumerable: true })), "[Object: null prototype] { Symbol(Symbol.toStringTag): [Getter] }", ["tag"]],
  ["own tag getter that throws", () => util.inspect(define(bare(), tag, { ...accessor("tag"), enumerable: true })), "[Object: null prototype] { Symbol(Symbol.toStringTag): [Getter] }", ["tag"]],
  ["own tag getter that is not enumerable", () => util.inspect(define(bare(), tag, accessor("tag", "FromGetter"))), "[Object: null prototype] [FromGetter] {}", ["tag"]],
  ["tag getter on the prototype", () => util.inspect(child(define(bare(), tag, accessor("tag", "FromGetter")))), "Object <[Object: null prototype] [FromGetter] {}> [FromGetter] {}", ["tag", "tag"]],
  ["tag getter that throws, on the prototype", () => util.inspect(child(define(bare(), tag, accessor("tag")))), "Object <[Object: null prototype] {}> {}", ["tag", "tag"]],
  ["own tag", () => util.inspect(tagged()), "[Object: null prototype] [Tag] {}"],
  ["own tag that is not a string", () => util.inspect(define(bare(), tag, data(42))), "[Object: null prototype] {}"],
  ["tag on the prototype", () => util.inspect(child(tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["empty tag on the prototype", () => util.inspect(child(define(bare(), tag, data("")))), " <[Object: null prototype] {}> {}"],
  ["tag and constructor on the prototype", () => util.inspect(child(define(tagged(), "constructor", data(Foo)))), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["own tag, constructor on the prototype", () => util.inspect(define(child(define(bare(), "constructor", data(Foo))), tag, data("Own"))), "Own <[Object: null prototype] {}> [Own] {}"],
  ["constructor on the prototype, tag above it", () => util.inspect(child(define(child(define(bare(), tag, data("Top"))), "constructor", data(Foo)))), "Foo <Top <[Object: null prototype] [Top] {}>> [Top] {}"],
  ["tag on the prototype, constructor above it", () => util.inspect(child(define(child(define(bare(), "constructor", data(Foo))), tag, data("Mid")))), "Mid <Mid <[Object: null prototype] {}>> [Mid] {}"],

  // The type of a built-in value names it before its chain does, unless the value is a prototype.
  ["Map with a constructor on the prototype", () => util.inspect(reproto(new Map(), define(bare(), "constructor", data(Foo)))), "Map <[Object: null prototype] {}> {}"],
  ["Map with a tag on the prototype", () => util.inspect(reproto(new Map(), tagged())), "Map <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["Map that is a prototype, with a tag on the prototype", () => util.inspect(asPrototype(reproto(new Map(), tagged()))), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["generator object with a tag on the prototype", () => util.inspect(reproto((function* () {})(), tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["Buffer", () => util.inspect(reproto(Buffer.alloc(2), bare())), "Uint8Array <[Object: null prototype] {}> { '0': 0, '1': 0 }"],
  ["RangeError", () => firstLine(util.inspect(reproto(new RangeError("m"), bare()))), "RangeError <[Object: null prototype] {}>: m"],
  ["WeakMap with no prototype, past the depth", () => pastDepth(reproto(new WeakMap(), null)), "{ a: [WeakMap: null prototype] }"],
  ["Promise with no prototype, past the depth", () => pastDepth(reproto(Promise.resolve(1), null)), "{ a: [Promise: null prototype] }"],
  ["SharedArrayBuffer with no prototype, past the depth", () => pastDepth(reproto(new SharedArrayBuffer(1), null)), "{ a: [SharedArrayBuffer: null prototype] }"],
  ["DataView with no prototype, past the depth", () => pastDepth(reproto(new DataView(new ArrayBuffer(1)), null)), "{ a: [DataView: null prototype] }"],
  ["Set iterator with no prototype, past the depth", () => pastDepth(reproto(new Set().values(), null)), "{ a: [SetIterator: null prototype] }"],

  // The kind of a function names it, unless the function is a prototype. A class and a bound function get
  // their name from the chain.
  ["function", () => util.inspect(reproto(function f() {}, bare())), "[Function: f] Function <[Object: null prototype] {}>"],
  ["async function", () => util.inspect(reproto(async function f() {}, bare())), "[AsyncFunction: f] AsyncFunction <[Object: null prototype] {}>"],
  ["generator function", () => util.inspect(reproto(function* f() {}, bare())), "[GeneratorFunction: f] GeneratorFunction <[Object: null prototype] {}>"],
  ["async generator function", () => util.inspect(reproto(async function* f() {}, bare())), "[AsyncGeneratorFunction: f] AsyncGeneratorFunction <[Object: null prototype] {}>"],
  ["class", () => util.inspect(reproto(class K {}, bare())), "[class K [Function <[Object: null prototype] {}>]]"],
  ["bound function", () => util.inspect(reproto(function f() {}.bind(null), bare())), "[Function: bound f] Function <[Object: null prototype] {}>"],
  ["function with a tag on the prototype", () => util.inspect(reproto(function f() {}, tagged())), "[Function: f] Function <[Object: null prototype] [Tag] {}> [Tag]"],
  ["class with a tag on the prototype", () => util.inspect(reproto(class K {}, tagged())), "[class K [Tag <[Object: null prototype] [Tag] {}>] [Tag]]"],
  ["bound function with a tag on the prototype", () => util.inspect(reproto(function f() {}.bind(null), tagged())), "[Function: bound f] Tag <[Object: null prototype] [Tag] {}> [Tag]"],
  ["native function with a tag on the prototype", () => util.inspect(reproto(native("parseInt"), tagged())), "[Function: parseInt] Function <[Object: null prototype] [Tag] {}> [Tag]"],
  ["native function with a constructor on the prototype", () => util.inspect(reproto(native("parseInt"), define(bare(), "constructor", data(Foo)))), "[Function: parseInt] Function <[Object: null prototype] {}>"],
  ["native constructor with a tag on the prototype", () => util.inspect(reproto(native("Map"), tagged())), "[Function: Map] Function <[Object: null prototype] [Tag] {}> [Tag]"],
  ["native function that is a prototype, with a tag on the prototype", () => util.inspect(asPrototype(reproto(native("parseInt"), tagged()))), "[Function: parseInt] Tag <[Object: null prototype] [Tag] {}> [Tag]"],
  ["object whose prototype is an async function", () => util.inspect(child(reproto(async function f() {}, bare()))), "Object <Function <[Object: null prototype] {}>> {}"],
  ["async function that is a prototype", () => util.inspect(asPrototype(reproto(async function f() {}, bare()))), "[AsyncFunction: f] Function <[Object: null prototype] {}>"],
  ["async function with no prototype, past the depth", () => pastDepth(Object.assign(reproto(async function f() {}, null), { x: 1 })), "{ a: [AsyncFunction: null prototype] }"],
  ["generator function with no prototype, past the depth", () => pastDepth(Object.assign(reproto(function* f() {}, null), { x: 1 })), "{ a: [GeneratorFunction: null prototype] }"],

  // The lookup stops at a Proxy.
  ["object whose prototype is a Proxy of an object with a constructor", () => util.inspect(child(new Proxy(child(define(bare(), "constructor", data(Foo))), {}))), "Object <Object <[Object: null prototype] {}>> {}"],
];

test.each(constructorNames)("util.inspect names a value from data properties: %s", (_, print, expected, runs = []) => {
  getterRuns.length = 0;
  expect({ printed: print(), getterRuns }).toEqual({ printed: expected, getterRuns: runs });
});

// The word for each built-in type: for a value on a chain with no constructor, and for the same value once it
// is a prototype. V8 has two lists for these, so some words differ.
const argumentsOf = fn => fn(1);
// prettier-ignore
const builtinNames = [
  ["arguments", () => argumentsOf(function () { return arguments; }), "Arguments", "Arguments"],
  ["arguments of a function that closes over a parameter", () => argumentsOf(function (a) { (() => a)(); return arguments; }), "Arguments", "Arguments"],
  ["arguments of a strict function", () => argumentsOf(function () { "use strict"; return arguments; }), "Arguments", "Arguments"],
  ["Array", () => [1], "Array", "Array"],
  ["ArrayBuffer", () => new ArrayBuffer(1), "ArrayBuffer", "ArrayBuffer"],
  ["SharedArrayBuffer", () => new SharedArrayBuffer(1), "SharedArrayBuffer", "SharedArrayBuffer"],
  ["DataView", () => new DataView(new ArrayBuffer(1)), "DataView", "Object"],
  ["Date", () => new Date(0), "Date", "Date"],
  ["RegExp", () => /x/, "RegExp", "RegExp"],
  ["Error", () => new Error("m"), "Error", "Error"],
  ["TypeError", () => new TypeError("m"), "TypeError", "Error"],
  ["AggregateError", () => new AggregateError([], "m"), "AggregateError", "Error"],
  ["Map", () => new Map(), "Map", "Map"],
  ["Set", () => new Set(), "Set", "Set"],
  ["WeakMap", () => new WeakMap(), "WeakMap", "WeakMap"],
  ["WeakSet", () => new WeakSet(), "WeakSet", "WeakSet"],
  ["WeakRef", () => new WeakRef({}), "WeakRef", "Object"],
  ["FinalizationRegistry", () => new FinalizationRegistry(() => {}), "FinalizationRegistry", "Object"],
  ["Promise", () => Promise.resolve(1), "Promise", "Object"],
  ["Boolean", () => new Boolean(true), "Boolean", "Boolean"],
  ["Number", () => new Number(1), "Number", "Number"],
  ["String", () => new String("s"), "String", "String"],
  ["Symbol", () => Object(Symbol("s")), "Symbol", "Symbol"],
  ["BigInt", () => Object(1n), "BigInt", "BigInt"],
  ["generator object", () => (function* () {})(), "Generator", "Generator"],
  ["async generator object", () => (async function* () {})(), "Generator", "Generator"],
  ["Array iterator", () => [][Symbol.iterator](), "Array Iterator", "Array Iterator"],
  ["Map iterator", () => new Map().entries(), "MapIterator", "Map Iterator"],
  ["Set iterator", () => new Set().values(), "SetIterator", "Set Iterator"],
  ...[Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array].map(
    TypedArray => [TypedArray.name, () => new TypedArray(1), TypedArray.name, TypedArray.name],
  ),
];

test.each(builtinNames)("util.inspect names a built-in value by its type: %s", (_, make, name, nameOfPrototype) => {
  const nameOf = value => /([\w ]+) <\[Object: null prototype\] \{\}>/.exec(util.inspect(value))?.[1];
  expect({
    value: nameOf(reproto(make(), bare())),
    prototype: nameOf(asPrototype(reproto(make(), bare()))),
  }).toEqual({ value: name, prototype: nameOfPrototype });
});

// What the port cannot know. V8 keeps the constructor that made a value, and marks a value as a prototype as
// soon as it is the `prototype` property of a function. The last string of each row is the output of Node.js.
// prettier-ignore
const differsFromNode = [
  ["an instance of a class, with no prototype", () => util.inspect(reproto(new (class Foo {})(), null)), "[Object: null prototype] {}", "[Foo: null prototype] {}"],
  ["the object of a generator function that has a name", () => util.inspect(reproto((function* gen() {})(), bare())), "Generator <[Object: null prototype] {}> {}", "gen <[Object: null prototype] {}> {}"],
  ["an instance of a subclass of Map, with a tag on the prototype", () => util.inspect(reproto(new (class M extends Map {})(), tagged())), "Map <[Object: null prototype] [Tag] {}> [Tag] {}", "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["a Buffer with a tag on the prototype", () => util.inspect(reproto(Buffer.alloc(1), tagged())), "Uint8Array <[Object: null prototype] [Tag] {}> [Tag] { '0': 0 }", "Tag <[Object: null prototype] [Tag] {}> [Tag] { '0': 0 }"],
  ["an instance of a subclass of Promise", () => util.inspect(reproto(new (class P extends Promise {})(() => {}), bare())), "Promise <[Object: null prototype] {}> { <pending> }", "Object <[Object: null prototype] {}> { <pending> }"],
  ["an instance of a subclass of RangeError", () => firstLine(util.inspect(reproto(new (class E extends RangeError {})("m"), bare()))), "RangeError <[Object: null prototype] {}>: m", "Error <[Object: null prototype] {}>: m"],
  ["a Map that is the prototype property of a function, with a tag on the prototype", () => util.inspect(Object.assign(function F() {}, { prototype: reproto(new Map(), tagged()) }).prototype), "Map <[Object: null prototype] [Tag] {}> [Tag] {}", "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
];

test.each(differsFromNode)("util.inspect does not name %s as Node.js does", (_, print, printed) => {
  expect(print()).toBe(printed);
});

test("util.inspect prints a value of Bun whose Symbol.toStringTag getter throws", () => {
  // The getter reads a private field, which the prototype does not have.
  expect(util.inspect(Statement.prototype)).toBe("{}");
});

test("util.inspect calls no Proxy trap to name a value", () => {
  const traps = [];
  const handler = new Proxy(
    {},
    {
      get(_, trap) {
        return (target, key, ...rest) => {
          traps.push(typeof key === "symbol" ? `${trap} ${key.description}` : `${trap} ${key}`);
          return Reflect[trap](target, key, ...rest);
        };
      },
    },
  );
  // Both the Proxy and the child of the Proxy get a name from the lookup.
  const printed = util.inspect(child(new Proxy(child(bare()), handler)));
  expect({
    printed,
    // formatRaw reads the tag of the printed value once, through the Proxy.
    gets: traps.filter(trap => trap === "get constructor" || trap === "get Symbol.toStringTag"),
  }).toEqual({
    printed: "Object <Object <[Object: null prototype] {}>> {}",
    gets: ["get Symbol.toStringTag"],
  });
});

// `Console` of node:console prints with util.inspect. The global console has its own printer.
test("every way into util.inspect prints a value whose constructor getter throws", () => {
  let runs = 0;
  const make = () =>
    child({
      __proto__: null,
      get constructor() {
        runs++;
        throw new Error("the constructor getter ran");
      },
    });
  const printed = "Object <[Object: null prototype]> {}";
  const written = [];
  const sink = new Writable({
    write(chunk, encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  const logger = new Console(sink);
  logger.log(make());
  logger.dir(make());
  let assertionError;
  try {
    assert.strictEqual(make(), 1);
  } catch (error) {
    assertionError = error;
  }

  expect({
    inspect: util.inspect(make()),
    format: util.format(make()),
    formatS: util.format("%s", make()),
    formatO: util.format("%O", make()),
    formatWithOptions: util.formatWithOptions({ colors: false }, "%o", make()),
    inArray: util.inspect([make()]),
    customInspectArgument: util.inspect({ [util.inspect.custom]: (depth, options, inspect) => inspect(make()) }),
    console: written,
    assertionError: [assertionError?.code, assertionError?.message.includes(printed)],
    runs,
  }).toEqual({
    inspect: printed,
    format: printed,
    formatS: printed,
    formatO: printed,
    formatWithOptions: printed,
    inArray: `[ ${printed} ]`,
    customInspectArgument: printed,
    console: [`${printed}\n`, `${printed}\n`],
    assertionError: ["ERR_ASSERTION", true],
    runs: 0,
  });
});

test("a replaced Object.prototype.toString or RegExp.prototype[Symbol.match] does not change a name", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let calls = 0;
        Object.prototype.toString = function () {
          calls++;
          return "[object Replaced]";
        };
        const match = RegExp.prototype[Symbol.match];
        RegExp.prototype[Symbol.match] = function (string) {
          calls++;
          return match.call(this, string);
        };
        // Loaded after the replacements.
        const { inspect } = require("node:util");
        const printed = [inspect(Object.create(Object.create(null))), inspect({ a: Object.create(null) }, { depth: 0 })];
        console.log(JSON.stringify({ printed, calls }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
    out: {
      printed: ["Object <[Object: null prototype] {}> {}", "{ a: [Object: null prototype] {} }"],
      calls: 0,
    },
    stderr: "",
    exitCode: 0,
  });
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
