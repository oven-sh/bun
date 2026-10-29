// The rows for the name that util.inspect gives a value whose prototype chain has no usable constructor.
// internal-inspect.test.js runs them in Bun, and a program of test/aot runs them in a compiled executable. The
// rows that need a ShadowRealm are in constructor-name-shadow-realm-fixture.cjs, which `--aot` does not compile.
// Run as the main module, that file prints what the runtime prints for each row, so that Node.js runs the same
// rows.
//
// Node.js takes the name from V8's GetConstructorName. That lookup reads data properties only: no getter and no
// Proxy trap runs. UtilInspect.cpp has a port of its walk of the chain and of V8's word for a type. V8 first asks
// for the constructor that made the value, which JavaScriptCore does not record, so nothing stands in for it.
// Every expected string is the output of the Node.js version that Bun reports, but for the first strings of
// `differsFromNode`.
const util = require("node:util");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

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
// instanceof answers false for each instance, so the lookup of util.inspect passes the constructor of the class by.
class Denies {
  static [Symbol.hasInstance]() {
    return false;
  }
}
reproto(Denies.prototype, null);
class NameGetter {
  static get name() {
    getterRuns.push("name");
    return "FromGetter";
  }
}
const renamed = define(function Renamed() {}, "name", { value: "NewName" });
const key = Symbol("key");
// A computed key names a function when the program runs. V8 and JavaScriptCore make such a function with no name.
class Keyed {
  [key]() {}
  get [key.description]() {
    return 1;
  }
  get written() {
    return 1;
  }
}
const getterOf = (holder, name) => Object.getOwnPropertyDescriptor(holder, name).get;
const literal = { [key]() {} };
const noName = new Function("return function () {}")();
// The transpiler folds `{ key: fn }.key` written in one expression, and the function then has no name.
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
  ["listeners of an EventEmitter for an event named constructor", () => util.inspect(new EventEmitter().on("constructor", function f() {})._events), "[Object: null prototype] { constructor: [Function: f] }"],

  // A `constructor` data property counts when it is a function with a name, and not on the value itself.
  ["own constructor", () => util.inspect(define(bare(), "constructor", data(Foo))), "[Object: null prototype] {}"],
  ["constructor on the prototype", () => util.inspect(child(define(bare(), "constructor", data(Foo)))), "Foo <[Object: null prototype] {}> {}"],
  ["class on the prototype", () => util.inspect(child(define(bare(), "constructor", data(Baz)))), "Baz <[Object: null prototype] {}> {}"],
  ["instance of a class whose Symbol.hasInstance answers false", () => util.inspect(new Denies()), "Denies <[Object: null prototype] {}> {}"],
  ["built-in constructor on the prototype", () => util.inspect(child(define(bare(), "constructor", data(Map)))), "Map <[Object: null prototype] {}> {}"],
  ["constructor that is not a function", () => util.inspect(child(define(bare(), "constructor", data({ name: "Fake" })))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a bound function", () => util.inspect(child(define(bare(), "constructor", data(Foo.bind(null))))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a Proxy of a function", () => util.inspect(child(define(bare(), "constructor", data(new Proxy(Foo, {}))))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a built-in function written in JS", () => util.inspect(child(define(bare(), "constructor", data(Array.prototype.map)))), "map <[Object: null prototype] {}> {}"],
  ["constructor that is a native function", () => util.inspect(child(define(bare(), "constructor", data(native("parseInt"))))), "parseInt <[Object: null prototype] {}> {}"],
  ["constructor with no name", () => util.inspect(child(define(bare(), "constructor", data(noName)))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a method under a computed key", () => util.inspect(child(define(bare(), "constructor", data(Keyed.prototype[key])))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a getter under a computed key", () => util.inspect(child(define(bare(), "constructor", data(getterOf(Keyed.prototype, "key"))))), "Object <[Object: null prototype] {}> {}"],
  ["constructor that is a getter under a computed key, below a constructor with a name", () => util.inspect(child(define(child(define(bare(), "constructor", data(Foo))), "constructor", data(getterOf(Keyed.prototype, "key"))))), "Foo <Foo <[Object: null prototype] {}>> {}"],
  ["constructor that is a getter under a written key", () => util.inspect(child(define(bare(), "constructor", data(getterOf(Keyed.prototype, "written"))))), "get written <[Object: null prototype] {}> {}"],
  ["constructor named anonymous", () => util.inspect(child(define(bare(), "constructor", data(function anonymous() {})))), "anonymous <[Object: null prototype] {}> {}"],
  ["constructor named Object", () => util.inspect(child(define(bare(), "constructor", data(function Object() {})))), "Object <[Object: null prototype] {}> {}"],
  ["constructor named Object, below a constructor with a name", () => util.inspect(child(define(child(define(bare(), "constructor", data(Foo))), "constructor", data(function Object() {})))), "Foo <Foo <[Object: null prototype] {}>> {}"],
  ["constructor with no name, below a constructor with a name", () => util.inspect(child(define(child(define(bare(), "constructor", data(Foo))), "constructor", data(noName)))), "Foo <Foo <[Object: null prototype] {}>> {}"],
  ["constructor named by the property it was written in", () => util.inspect(child(define(bare(), "constructor", data(namedByProperty.expression)))), "expression <[Object: null prototype] {}> {}"],
  ["constructor whose name was redefined", () => util.inspect(child(define(bare(), "constructor", data(renamed)))), "Renamed <[Object: null prototype] {}> {}"],
  // Node's JS reads the `name` property three times before the lookup. The lookup does not read it.
  ["constructor whose name is a getter", () => util.inspect(child(define(bare(), "constructor", data(NameGetter)))), "NameGetter <[Object: null prototype] {}> {}", ["name", "name", "name"]],

  // A Symbol.toStringTag data property that is a string counts, on the value too. A tag accessor runs only
  // where formatRaw reads the tag: once for each value it prints.
  ["own tag getter", () => util.inspect(define(bare(), tag, { ...accessor("tag", "FromGetter"), enumerable: true })), "[Object: null prototype] { Symbol(Symbol.toStringTag): [Getter] }", ["tag"]],
  ["own tag getter that is not enumerable", () => util.inspect(define(bare(), tag, accessor("tag", "FromGetter"))), "[Object: null prototype] [FromGetter] {}", ["tag"]],
  ["tag getter on the prototype", () => util.inspect(child(define(bare(), tag, accessor("tag", "FromGetter")))), "Object <[Object: null prototype] [FromGetter] {}> [FromGetter] {}", ["tag", "tag"]],
  ["own tag", () => util.inspect(tagged()), "[Object: null prototype] [Tag] {}"],
  ["own tag that is not a string", () => util.inspect(define(bare(), tag, data(42))), "[Object: null prototype] {}"],
  ["tag on the prototype", () => util.inspect(child(tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["empty tag on the prototype", () => util.inspect(child(define(bare(), tag, data("")))), " <[Object: null prototype] {}> {}"],
  ["tag and constructor on the prototype", () => util.inspect(child(define(tagged(), "constructor", data(Foo)))), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["own tag, constructor on the prototype", () => util.inspect(define(child(define(bare(), "constructor", data(Foo))), tag, data("Own"))), "Own <[Object: null prototype] {}> [Own] {}"],
  ["constructor on the prototype, tag above it", () => util.inspect(child(define(child(define(bare(), tag, data("Top"))), "constructor", data(Foo)))), "Foo <Top <[Object: null prototype] [Top] {}>> [Top] {}"],
  ["tag on the prototype, constructor above it", () => util.inspect(child(define(child(define(bare(), "constructor", data(Foo))), tag, data("Mid")))), "Mid <Mid <[Object: null prototype] {}>> [Mid] {}"],

  // The chain names a built-in value first. The word for its type names it when the chain has no name.
  ["instance of a subclass of Map, with a tag on the prototype", () => util.inspect(reproto(new (class M extends Map {})(), tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["Buffer with a tag on the prototype", () => util.inspect(reproto(Buffer.alloc(1), tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] { '0': 0 }"],
  ["Map that is a prototype, with a tag on the prototype", () => util.inspect(asPrototype(reproto(new Map(), tagged()))), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["Map that is the prototype property of a function, with a tag on the prototype", () => util.inspect(Object.assign(function F() {}, { prototype: reproto(new Map(), tagged()) }).prototype), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["generator object with a tag on the prototype", () => util.inspect(reproto((function* () {})(), tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["Array with a constructor named Object on the prototype", () => util.inspect(reproto([1], define(bare(), "constructor", data(function Object() {})))), "Array <[Object: null prototype] {}> { '0': 1 }"],
  ["Buffer", () => util.inspect(reproto(Buffer.alloc(2), bare())), "Uint8Array <[Object: null prototype] {}> { '0': 0, '1': 0 }"],
  ["Buffer on a resizable buffer", () => util.inspect(reproto(Buffer.from(new ArrayBuffer(2, { maxByteLength: 4 })), bare())), "Object <[Object: null prototype] {}> { '0': 0, '1': 0 }"],
  ["instance of a subclass of RangeError", () => firstLine(util.inspect(reproto(new (class E extends RangeError {})("m"), bare()))), "Error <[Object: null prototype] {}>: m"],
  ["instance of a subclass of Promise", () => util.inspect(reproto(new (class P extends Promise {})(() => {}), bare())), "Object <[Object: null prototype] {}> { <pending> }"],
  ["Promise that is the prototype property of a function", () => util.inspect(Object.assign(function F() {}, { prototype: reproto(Promise.resolve(1), bare()) }).prototype), "Object <[Object: null prototype] {}> { 1 }"],
  ["WeakMap with no prototype, past the depth", () => pastDepth(reproto(new WeakMap(), null)), "{ a: [WeakMap: null prototype] }"],
  ["SharedArrayBuffer with no prototype, past the depth", () => pastDepth(reproto(new SharedArrayBuffer(1), null)), "{ a: [SharedArrayBuffer: null prototype] }"],

  // The chain names a function as it names any value, and the word for its type is Function.
  ["function", () => util.inspect(reproto(function f() {}, bare())), "[Function: f] Function <[Object: null prototype] {}>"],
  ["class", () => util.inspect(reproto(class K {}, bare())), "[class K [Function <[Object: null prototype] {}>]]"],
  ["bound function", () => util.inspect(reproto(function f() {}.bind(null), bare())), "[Function: bound f] Function <[Object: null prototype] {}>"],
  ["class with a tag on the prototype", () => util.inspect(reproto(class K {}, tagged())), "[class K [Tag <[Object: null prototype] [Tag] {}>] [Tag]]"],
  ["bound function with a tag on the prototype", () => util.inspect(reproto(function f() {}.bind(null), tagged())), "[Function: bound f] Tag <[Object: null prototype] [Tag] {}> [Tag]"],
  ["native function that is a prototype, with a tag on the prototype", () => util.inspect(asPrototype(reproto(native("parseInt"), tagged()))), "[Function: parseInt] Tag <[Object: null prototype] [Tag] {}> [Tag]"],
  ["object whose prototype is an async function", () => util.inspect(child(reproto(async function f() {}, bare()))), "Object <Function <[Object: null prototype] {}>> {}"],
  ["async function that is a prototype", () => util.inspect(asPrototype(reproto(async function f() {}, bare()))), "[AsyncFunction: f] Function <[Object: null prototype] {}>"],

  // The lookup ends at an object that answers getPrototypeOf itself: a Proxy. The global of a node:vm context has
  // the prototype that a script set.
  ["object whose prototype is a Proxy of an object with a constructor", () => util.inspect(child(new Proxy(child(define(bare(), "constructor", data(Foo))), {}))), "Object <Object <[Object: null prototype] {}>> {}"],
  ["child of the global of a node:vm context, after that global lost a prototype that has a tag", () => util.inspect(child(vm.runInNewContext('Object.defineProperty(Object.getPrototypeOf(globalThis), Symbol.toStringTag, { value: "Stale" }); Object.setPrototypeOf(globalThis, null); globalThis'))), "Object <[Object: null prototype] {}> {}"],
];

// The word for each built-in type, on a chain with no name. It is the word of V8's class_name(), which Node.js
// prints for a value that is or was a prototype. A fourth string is the word that Node.js prints for a value
// that never was a prototype: the name of the constructor that made it.
// prettier-ignore
const builtinNames = [
  // A function body is sloppy code in a strict module too: the three kinds of arguments object.
  ["arguments", () => new Function("return arguments")(1), "Arguments"],
  ["arguments of a function that closes over a parameter", () => new Function("a", "(() => a)(); return arguments")(1), "Arguments"],
  ["arguments of a strict function", () => new Function('"use strict"; return arguments')(1), "Arguments"],
  ["Array", () => [1], "Array"],
  ["Array.prototype", () => native("Array.prototype"), "Array"],
  ["ArrayBuffer", () => new ArrayBuffer(1), "ArrayBuffer"],
  ["SharedArrayBuffer", () => new SharedArrayBuffer(1), "SharedArrayBuffer"],
  ["DataView", () => new DataView(new ArrayBuffer(1)), "Object", "DataView"],
  ["Date", () => new Date(0), "Date"],
  ["RegExp", () => /x/, "RegExp"],
  ["Error", () => new Error("m"), "Error"],
  ["TypeError", () => new TypeError("m"), "Error", "TypeError"],
  ["AggregateError", () => new AggregateError([], "m"), "Error", "AggregateError"],
  ["Map", () => new Map(), "Map"],
  ["Set", () => new Set(), "Set"],
  ["WeakMap", () => new WeakMap(), "WeakMap"],
  ["WeakSet", () => new WeakSet(), "WeakSet"],
  ["WeakRef", () => new WeakRef({}), "Object", "WeakRef"],
  ["FinalizationRegistry", () => new FinalizationRegistry(() => {}), "Object", "FinalizationRegistry"],
  ["Promise", () => Promise.resolve(1), "Object", "Promise"],
  ["Boolean", () => new Boolean(true), "Boolean"],
  ["Number", () => new Number(1), "Number"],
  ["String", () => new String("s"), "String"],
  ["String.prototype", () => native("String.prototype"), "String"],
  ["Symbol", () => Object(Symbol("s")), "Symbol"],
  ["BigInt", () => Object(1n), "BigInt"],
  ["generator object", () => (function* () {})(), "Generator"],
  ["async generator object", () => (async function* () {})(), "Generator"],
  ["Array iterator", () => [][Symbol.iterator](), "Array Iterator"],
  ["Map iterator", () => new Map().entries(), "Map Iterator", "MapIterator"],
  ["Set iterator", () => new Set().values(), "Set Iterator", "SetIterator"],
  ...[Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array].map(
    TypedArray => [TypedArray.name, () => new TypedArray(1), TypedArray.name],
  ),
  // V8 has no word for a view of a resizable buffer, or for a view that tracks the length of a growable shared buffer.
  ["Uint8Array on a resizable buffer", () => new Uint8Array(new ArrayBuffer(1, { maxByteLength: 2 })), "Object", "Uint8Array"],
  ["Uint8Array on a resizable buffer that was detached", () => { const buffer = new ArrayBuffer(1, { maxByteLength: 2 }); const view = new Uint8Array(buffer); buffer.transfer(); return view; }, "Object", "Uint8Array"],
  ["Uint8Array that tracks the length of a growable shared buffer", () => new Uint8Array(new SharedArrayBuffer(1, { maxByteLength: 2 })), "Object", "Uint8Array"],
  ["Uint8Array of fixed length on a growable shared buffer", () => new Uint8Array(new SharedArrayBuffer(1, { maxByteLength: 2 }), 0, 1), "Uint8Array"],
];

// What the port cannot know. V8 keeps the constructor that made a value and names the value by it first, with the
// `name` property of that constructor when it is a string. For a function that is not and was not a prototype,
// that constructor is the one of its kind. V8 also infers a name for a function from the source, and gives no
// name to a function that the Function constructor made. The last string of each row is the output of Node.js.
// prettier-ignore
const differsFromNode = [
  ["an instance of a class, with no prototype", () => util.inspect(reproto(new (class Foo {})(), null)), "[Object: null prototype] {}", "[Foo: null prototype] {}"],
  ["the object of a generator function that has a name", () => util.inspect(reproto((function* gen() {})(), bare())), "Generator <[Object: null prototype] {}> {}", "gen <[Object: null prototype] {}> {}"],
  ["an instance of a class whose own constructor is the class, with no prototype", () => { class Foo {} return util.inspect(reproto(Object.assign(new Foo(), { constructor: Foo }), null)); }, "[Object: null prototype] { constructor: [class Foo] }", "[Foo: null prototype] { constructor: [class Foo] }"],
  ["a Map with a tag on the prototype", () => util.inspect(reproto(new Map(), tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}", "Map <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["a Map with a constructor on the prototype", () => util.inspect(reproto(new Map(), define(bare(), "constructor", data(Foo)))), "Foo <[Object: null prototype] {}> {}", "Map <[Object: null prototype] {}> {}"],
  ["a RangeError on a chain with no name", () => firstLine(util.inspect(reproto(new RangeError("m"), bare()))), "Error <[Object: null prototype] {}>: m", "RangeError <[Object: null prototype] {}>: m"],
  ["a Promise with no prototype, past the depth", () => pastDepth(reproto(Promise.resolve(1), null)), "{ a: [Object: null prototype] }", "{ a: [Promise: null prototype] }"],
  ["an instance of a class, with a tag on the prototype", () => util.inspect(reproto(new (class Foo {})(), tagged())), "Tag <[Object: null prototype] [Tag] {}> [Tag] {}", "Foo <[Object: null prototype] [Tag] {}> [Tag] {}"],
  ["an instance of a class whose name was redefined, on a copy of its prototype", () => { class Model {} define(Model, "name", { value: "Restored" }); return util.inspect(reproto(new Model(), child(null, Object.getOwnPropertyDescriptors(Model.prototype)))); }, "Model <[Object: null prototype] {}> {}", "Restored <[Object: null prototype] {}> {}"],
  ["a constructor that is a function with no name, assigned to a member", () => { const ns = {}; ns.Widget = function () {}; return util.inspect(child(define(bare(), "constructor", data(ns.Widget)))); }, "Object <[Object: null prototype] {}> {}", "ns.Widget <[Object: null prototype] {}> {}"],
  ["an async function", () => util.inspect(reproto(async function f() {}, bare())), "[AsyncFunction: f] Function <[Object: null prototype] {}>", "[AsyncFunction: f] AsyncFunction <[Object: null prototype] {}>"],
  ["a generator function", () => util.inspect(reproto(function* f() {}, bare())), "[GeneratorFunction: f] Function <[Object: null prototype] {}>", "[GeneratorFunction: f] GeneratorFunction <[Object: null prototype] {}>"],
  ["an async generator function", () => util.inspect(reproto(async function* f() {}, bare())), "[AsyncGeneratorFunction: f] Function <[Object: null prototype] {}>", "[AsyncGeneratorFunction: f] AsyncGeneratorFunction <[Object: null prototype] {}>"],
  ["a function with a tag on the prototype", () => util.inspect(reproto(function f() {}, tagged())), "[Function: f] Tag <[Object: null prototype] [Tag] {}> [Tag]", "[Function: f] Function <[Object: null prototype] [Tag] {}> [Tag]"],
  ["a native function with a tag on the prototype", () => util.inspect(reproto(native("parseInt"), tagged())), "[Function: parseInt] Tag <[Object: null prototype] [Tag] {}> [Tag]", "[Function: parseInt] Function <[Object: null prototype] [Tag] {}> [Tag]"],
  ["a native function with a constructor on the prototype", () => util.inspect(reproto(native("parseInt"), define(bare(), "constructor", data(Foo)))), "[Function: parseInt] Foo <[Object: null prototype] {}>", "[Function: parseInt] Function <[Object: null prototype] {}>"],
  ["a native constructor with a tag on the prototype", () => util.inspect(reproto(native("Map"), tagged())), "[Function: Map] Tag <[Object: null prototype] [Tag] {}> [Tag]", "[Function: Map] Function <[Object: null prototype] [Tag] {}> [Tag]"],
  ["an async function with no prototype, past the depth", () => pastDepth(Object.assign(reproto(async function f() {}, null), { x: 1 })), "{ a: [Function: null prototype] }", "{ a: [AsyncFunction: null prototype] }"],
  ["a generator function with no prototype, past the depth", () => pastDepth(Object.assign(reproto(function* f() {}, null), { x: 1 })), "{ a: [Function: null prototype] }", "{ a: [GeneratorFunction: null prototype] }"],
  ["a constructor that the Function constructor made", () => util.inspect(child(define(bare(), "constructor", data(new Function(""))))), "anonymous <[Object: null prototype] {}> {}", "Object <[Object: null prototype] {}> {}"],
  ["a constructor that is a method of an object literal under a computed key", () => util.inspect(child(define(bare(), "constructor", data(literal[key])))), "Object <[Object: null prototype] {}> {}", "literal <[Object: null prototype] {}> {}"],
  ["a child of the global of a node:vm context that has no prototype and a variable named constructor", () => util.inspect(child(vm.runInNewContext("Object.setPrototypeOf(globalThis, null); var constructor = function Foo() {}; globalThis"))), "Object <[Object: null prototype]> {}", "Foo <[Foo: null prototype]> {}"],
];

const nameOf = value => /([\w ]+) <\[Object: null prototype\] \{\}>/.exec(util.inspect(value))?.[1];
// The name of a built-in value on a chain with no name: for the value, and for that value once it is a prototype.
const builtinName = make => ({
  value: nameOf(reproto(make(), bare())),
  prototype: nameOf(asPrototype(reproto(make(), bare()))),
});

// What the runtime prints for each row, with `names` in the place of `constructorNames`.
const printed = names => ({
  constructorNames: names.map(([label, print]) => {
    getterRuns.length = 0;
    return { label, printed: print(), getterRuns: [...getterRuns] };
  }),
  builtinNames: builtinNames.map(([label, make]) => ({ label, ...builtinName(make) })),
  differsFromNode: differsFromNode.map(([label, print]) => ({ label, printed: print() })),
});

module.exports = {
  constructorNames,
  builtinNames,
  differsFromNode,
  getterRuns,
  builtinName,
  printed,
  helpers: { bare, child, data, define, reproto, tagged },
};
