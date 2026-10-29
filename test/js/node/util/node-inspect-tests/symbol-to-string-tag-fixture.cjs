// The rows for the name that util.inspect prints in front of a value with a Symbol.toStringTag.
// internal-inspect.test.js runs them in Bun. Run as the main module, this file prints what the runtime prints for
// each row, so that Node.js runs the same rows.
const util = require("node:util");

const tagged = (value, tag) => Object.defineProperty(value, Symbol.toStringTag, { value: tag });
// An instance of a class with the name `name`. The prototype of the class has the tag.
const instance = (name, tag) => {
  const Class = { [name]: class {} }[name];
  tagged(Class.prototype, tag);
  return new Class();
};
const error = tagged(new (class NamespacedError extends TypeError {})("m"), "ns.NamespacedError");
error.stack = "TypeError: m\n    at x";

// Each row: a label, a function that prints, and the text that Node.js v26.12.1 prints.
// prettier-ignore
const rows = [
  // The tag stands alone when the name of the constructor is the text after the last dot of the tag.
  ["an instance of Foo with the tag a.Foo", () => util.inspect(instance("Foo", "a.Foo")), "a.Foo {}"],
  ["an instance of Foo with the tag a.b.Foo", () => util.inspect(instance("Foo", "a.b.Foo")), "a.b.Foo {}"],
  ["an instance of Foo with the tag a..Foo", () => util.inspect(instance("Foo", "a..Foo")), "a..Foo {}"],
  ["an instance of Foo with the tag .Foo", () => util.inspect(instance("Foo", ".Foo")), "Foo [.Foo] {}"],
  ["an instance of Foo with the tag Foo.", () => util.inspect(instance("Foo", "Foo.")), "Foo [Foo.] {}"],
  ["an instance of Foo with the tag a.Bar", () => util.inspect(instance("Foo", "a.Bar")), "Foo [a.Bar] {}"],
  ["an instance of Foo with the tag a.foo", () => util.inspect(instance("Foo", "a.foo")), "Foo [a.foo] {}"],
  ["an instance of FooBar with the tag Foo", () => util.inspect(instance("FooBar", "Foo")), "FooBar [Foo] {}"],
  ["an instance of Foo with the tag Foo", () => util.inspect(instance("Foo", "Foo")), "Foo {}"],
  // A name that has a dot is never the text after the last dot:
  // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/inspect.js#L1032-L1038
  ["an instance of a class named a.Foo with the tag a.Foo", () => util.inspect(instance("a.Foo", "a.Foo")), "a.Foo [a.Foo] {}"],

  // Each kind of value that takes its name from the same prefix.
  ["a Map", () => util.inspect(tagged(new (class M extends Map {})([[1, 2]]), "ns.M")), "ns.M(1) { 1 => 2 }"],
  ["an Array", () => util.inspect(tagged(new (class A extends Array {})(1, 2), "ns.A")), "ns.A(2) [ 1, 2 ]"],
  ["a typed array", () => util.inspect(tagged(new (class U extends Uint8Array {})(2), "ns.U")), "ns.U(2) [ 0, 0 ]"],
  ["a plain object", () => util.inspect(tagged({}, "ns.Object")), "ns.Object {}"],
  ["a RegExp", () => util.inspect(tagged(/x/, "ns.RegExp")), "ns.RegExp /x/"],
  ["a Date", () => util.inspect(tagged(new Date(0), "ns.Date")), "ns.Date 1970-01-01T00:00:00.000Z"],
  ["a Promise", () => util.inspect(tagged(Promise.resolve(1), "ns.Promise")), "ns.Promise { 1 }"],
  ["an error", () => util.inspect(error), "ns.NamespacedError [TypeError]: m\n    at x"],
  ["an object past the depth", () => util.inspect({ a: Object.assign(instance("Foo", "ns.Foo"), { x: 1 }) }, { depth: 0 }), "{ a: [ns.Foo] }"],
  ["an Intl.Locale", () => util.inspect(new Intl.Locale("en")), "Intl.Locale {}"],
  ["a WebAssembly.Memory", () => util.inspect(new WebAssembly.Memory({ initial: 1 })), "WebAssembly.Memory {}"],

  // These do not take their name from that prefix.
  ["an object with no prototype", () => util.inspect(tagged({ __proto__: null }, "ns.Object")), "[Object: null prototype] [ns.Object] {}"],
  ["a function", () => util.inspect(tagged(function named() {}, "ns.Function")), "[Function: named] [ns.Function]"],
  ["a Number object", () => util.inspect(tagged(new Number(3), "ns.Number")), "[Number: 3] [ns.Number]"],
];

module.exports = rows;

if (require.main === module) console.log(JSON.stringify(rows.map(([label, print]) => [label, print()])));
