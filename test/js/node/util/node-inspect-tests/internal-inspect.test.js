import assert from "assert";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, withoutAggressiveGC } from "harness";
import util from "util";
import vm from "vm";

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

// The kind in a function's label. Every expected string is the output of Node.js v26.3.0.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;
const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;
const reproto = (fn, proto) => Object.setPrototypeOf(fn, proto);
const bare = () => ({ __proto__: null });
const define = Object.defineProperty;
const indirectEval = eval;
const arrows = { arrow: () => {}, asyncArrow: async () => {} };

// prettier-ignore
const functionLabels = [
  // Methods. The source text of a method does not start with `function` or `async function`.
  ["generator method", () => ({ *gen() {} }).gen, "[GeneratorFunction: gen]"],
  ["async generator method", () => ({ async *agen() {} }).agen, "[AsyncGeneratorFunction: agen]"],
  ["async method", () => ({ async am() {} }).am, "[AsyncFunction: am]"],
  ["method named asyncStorage", () => ({ asyncStorage() {} }).asyncStorage, "[Function: asyncStorage]"],
  ["method named asyncify", () => ({ asyncify() {} }).asyncify, "[Function: asyncify]"],
  ["method named async", () => ({ async() {} }).async, "[Function: async]"],
  ["computed generator method", () => ({ *["computed"]() {} }).computed, "[GeneratorFunction: computed]"],
  ["symbol-keyed generator method", () => ({ *[Symbol.iterator]() {} })[Symbol.iterator], "[GeneratorFunction: [Symbol.iterator]]"],
  ["class generator method", () => class { *gen() {} }.prototype.gen, "[GeneratorFunction: gen]"],
  ["class async generator method", () => class { async *agen() {} }.prototype.agen, "[AsyncGeneratorFunction: agen]"],
  ["static generator method", () => class { static *sgen() {} }.sgen, "[GeneratorFunction: sgen]"],
  ["static async generator method", () => class { static async *sagen() {} }.sagen, "[AsyncGeneratorFunction: sagen]"],
  ["class method named asyncHooks", () => class { asyncHooks() {} }.prototype.asyncHooks, "[Function: asyncHooks]"],
  ["static method named async", () => class { static async() {} }.async, "[Function: async]"],
  ["private generator method", () => class { *#gen() {} static get() { return new this().#gen; } }.get(), "[GeneratorFunction: #gen]"],
  ["private method named #asyncPrivate", () => class { #asyncPrivate() {} static get() { return new this().#asyncPrivate; } }.get(), "[Function: #asyncPrivate]"],
  ["getter named asyncValue", () => Object.getOwnPropertyDescriptor({ get asyncValue() { return 1; } }, "asyncValue").get, "[Function: get asyncValue]"],

  // Declarations, expressions and arrows.
  ["function", () => function f() {}, "[Function: f]"],
  ["generator function", () => function* g() {}, "[GeneratorFunction: g]"],
  ["async function", () => async function h() {}, "[AsyncFunction: h]"],
  ["async generator function", () => async function* k() {}, "[AsyncGeneratorFunction: k]"],
  ["arrow", () => arrows.arrow, "[Function: arrow]"],
  ["async arrow", () => arrows.asyncArrow, "[AsyncFunction: asyncArrow]"],
  ["class", () => class K {}, "[class K]"],

  // Source text that the runtime does not print again.
  ["eval: arrow with a parameter named async", () => indirectEval("(async => async)"), "[Function (anonymous)]"],
  ["eval: generator with a comment before the star", () => indirectEval("(function/**/*g() {})"), "[GeneratorFunction: g]"],
  ["eval: generator with a line break before the star", () => indirectEval("(function\n* g() {})"), "[GeneratorFunction: g]"],
  ["eval: async function with a comment after async", () => indirectEval("(async/**/function h() {})"), "[AsyncFunction: h]"],
  ["eval: async generator with a comment before the star", () => indirectEval("(async function/**/*k() {})"), "[AsyncGeneratorFunction: k]"],
  ["new Function", () => new Function("return 1"), "[Function: anonymous]"],
  ["new AsyncFunction", () => new AsyncFunction("return 1"), "[AsyncFunction: anonymous]"],
  ["new GeneratorFunction", () => new GeneratorFunction("yield 1"), "[GeneratorFunction: anonymous]"],
  ["new AsyncGeneratorFunction", () => new AsyncGeneratorFunction("yield 1"), "[AsyncGeneratorFunction: anonymous]"],
  ["vm: generator method", () => vm.runInNewContext("({ *gen() {} }).gen"), "[GeneratorFunction: gen]"],
  ["vm: method named asyncStorage", () => vm.runInNewContext("({ asyncStorage() {} }).asyncStorage"), "[Function: asyncStorage]"],
  ["vm: async function", () => vm.runInNewContext("(async function h() {})"), "[AsyncFunction: h]"],

  // The kind does not follow the prototype.
  ["generator function with AsyncFunction.prototype", () => reproto(function* g() {}, AsyncFunction.prototype), "[GeneratorFunction: g] AsyncFunction"],
  ["async function with Function.prototype", () => reproto(async function h() {}, Function.prototype), "[AsyncFunction: h] Function"],
  ["function with AsyncFunction.prototype", () => reproto(function f() {}, AsyncFunction.prototype), "[Function: f] AsyncFunction"],
  ["function with GeneratorFunction.prototype", () => reproto(function f() {}, GeneratorFunction.prototype), "[Function: f] GeneratorFunction"],
  ["async generator function with Function.prototype", () => reproto(async function* k() {}, Function.prototype), "[AsyncGeneratorFunction: k] Function"],
  ["async arrow with Function.prototype", () => reproto(async () => {}, Function.prototype), "[AsyncFunction (anonymous)] Function"],
  ["method named asyncStorage with AsyncFunction.prototype", () => reproto({ asyncStorage() {} }.asyncStorage, AsyncFunction.prototype), "[Function: asyncStorage] AsyncFunction"],
  ["async function with a null prototype", () => reproto(async function h() {}, null), "[AsyncFunction (null prototype): h]"],
  ["generator method with a null prototype", () => reproto({ *gen() {} }.gen, null), "[GeneratorFunction (null prototype): gen]"],
  ["method named asyncStorage with a null prototype", () => reproto({ asyncStorage() {} }.asyncStorage, null), "[Function (null prototype): asyncStorage]"],
  ["async function with Object.create(AsyncFunction.prototype)", () => reproto(async function h() {}, Object.create(AsyncFunction.prototype)), "[AsyncFunction: h]"],
  ["subclass of AsyncFunction", () => new (class Sub extends AsyncFunction {})("return 1"), "[AsyncFunction: anonymous] Sub [AsyncFunction]"],
  ["subclass of GeneratorFunction", () => new (class Sub extends GeneratorFunction {})("yield 1"), "[GeneratorFunction: anonymous] Sub [GeneratorFunction]"],

  // No object in the prototype chain has a constructor.
  ["function with a bare prototype", () => reproto(function f() {}, bare()), "[Function: f] Function <[Object: null prototype] {}>"],
  ["arrow with a bare prototype", () => reproto(() => {}, bare()), "[Function (anonymous)] Function <[Object: null prototype] {}>"],
  ["async function with a bare prototype", () => reproto(async function h() {}, bare()), "[AsyncFunction: h] AsyncFunction <[Object: null prototype] {}>"],
  ["async method with a bare prototype", () => reproto({ async am() {} }.am, bare()), "[AsyncFunction: am] AsyncFunction <[Object: null prototype] {}>"],
  ["generator method with a bare prototype", () => reproto({ *gen() {} }.gen, bare()), "[GeneratorFunction: gen] GeneratorFunction <[Object: null prototype] {}>"],
  ["async generator function with a bare prototype", () => reproto(async function* k() {}, bare()), "[AsyncGeneratorFunction: k] AsyncGeneratorFunction <[Object: null prototype] {}>"],
  ["method named asyncStorage with a bare prototype", () => reproto({ asyncStorage() {} }.asyncStorage, bare()), "[Function: asyncStorage] Function <[Object: null prototype] {}>"],
  ["class with a bare prototype", () => reproto(class K {}, bare()), "[class K [Function <[Object: null prototype] {}>]]"],
  ["bound function with a bare prototype", () => reproto(function f() {}.bind(null), bare()), "[Function: bound f] Function <[Object: null prototype] {}>"],
  ["function with a two-level bare prototype", () => reproto(function f() {}, Object.create(bare())), "[Function: f] Function <Object <[Object: null prototype] {}>>"],
  ["function with a tagged bare prototype", () => reproto(function f() {}, { __proto__: null, [Symbol.toStringTag]: "Tagged" }), "[Function: f] Function <[Tagged: null prototype]> [Tagged]"],

  // Bound, host and builtin functions have no kind of their own.
  ["bound async function", () => async function h() {}.bind(null), "[Function: bound h] AsyncFunction"],
  ["bound generator function", () => function* g() {}.bind(null), "[Function: bound g] GeneratorFunction"],
  ["bound async generator method", () => ({ async *agen() {} }).agen.bind(null), "[Function: bound agen] AsyncGeneratorFunction"],
  ["host function", () => Math.max, "[Function: max]"],
  ["builtin function", () => Array.prototype.map, "[Function: map]"],
  ["builtin constructor", () => Promise, "[Function: Promise]"],
];

test.each(functionLabels)("util.inspect labels a function by its kind: %s", (_, create, label) => {
  const fn = create();
  expect({
    inspect: util.inspect(fn),
    inArray: util.inspect([fn], { breakLength: Infinity }),
    inObject: util.inspect({ k: fn }, { breakLength: Infinity }),
    formatO: util.format("%O", fn),
    format: util.format(fn),
  }).toEqual({
    inspect: label,
    inArray: `[ ${label} ]`,
    inObject: `{ k: ${label} }`,
    formatO: label,
    format: label,
  });
});

// A function in a prototype chain that has no constructor, with the output of Node.js v26.3.0 again. Node.js
// prints the kind only for the inspected function. A function that is the prototype of another value gets a name
// from the own data properties of its chain, and no getter runs for it.
// prettier-ignore
const constructorlessChains = [
  ["an object whose prototype is an async function", () => util.inspect(Object.create(reproto(async function h() {}, bare()))), "Object <Function <[Object: null prototype] {}>> {}"],
  ["an object whose prototype is a generator function", () => util.inspect(Object.create(reproto(function* g() {}, bare()))), "Object <Function <[Object: null prototype] {}>> {}"],
  ["an object two levels above an async function", () => util.inspect(Object.create(Object.create(reproto(async function h() {}, bare())))), "Object <Object <Function <[Object: null prototype] {}>>> {}"],
  ["a function whose prototype is an async function", () => util.inspect(reproto(function f() {}, reproto(async function h() {}, bare()))), "[Function: f] Function <Function <[Object: null prototype] {}>>"],
  ["an object whose prototype is an async function on a tagged prototype", () => util.inspect(Object.create(reproto(async function h() {}, { __proto__: null, [Symbol.toStringTag]: "Tagged" }))), "Tagged <Tagged <[Tagged: null prototype]>> [Tagged] {}"],
  ["a function whose prototype is a function with a constructor getter", () => util.inspect(reproto(function f() {}, define(reproto(async function h() {}, bare()), "constructor", { get() { throw new Error("the getter ran"); } }))), "[Function: f] Function <Function <[Object: null prototype] {}>>"],
  ["a function whose prototype is a function with a constructor that is not a function", () => util.inspect(reproto(function f() {}, define(reproto(async function h() {}, bare()), "constructor", { value: { name: "Fake" } }))), "[Function: f] Function <Function <[Object: null prototype] {}>>"],
  ["a function whose prototype is a function with a Symbol.toStringTag getter", () => util.inspect(reproto(function f() {}, define(reproto(async function h() {}, bare()), Symbol.toStringTag, { get() { return "Got"; } }))), "[Function: f] Function <Function <[Object: null prototype] {}>> [Got]"],
  ["a function whose prototype is a function with a Symbol.toStringTag value", () => util.inspect(reproto(function f() {}, define(reproto(async function h() {}, bare()), Symbol.toStringTag, { value: "Own" }))), "[Function: f] Function <Own <[Object: null prototype] {}>> [Own]"],
  ["a named constructor on a function below the prototype", () => util.inspect(reproto(function f() {}, reproto(async function h1() {}, define(reproto(function h2() {}, bare()), "constructor", { value: function Foo() {} })))), "[Function: f] Function <Foo <Function <[Object: null prototype] {}>>>"],
  ["a constructor named Object on a function below the prototype", () => util.inspect(reproto(function f() {}, reproto(async function h1() {}, define(reproto(function h2() {}, bare()), "constructor", { value: function Object() {} })))), "[Function: f] Function <Function <Function <[Object: null prototype] {}>>>"],
  ["a function past the depth limit of util.format", () => util.format("%s", { a: reproto(function f() {}, bare()) }), "{ a: [Function: f] Function <Complex prototype> }"],
  ["an async function past the depth limit of util.format", () => util.format("%s", { a: reproto(async function h() {}, bare()) }), "{ a: [AsyncFunction: h] AsyncFunction <Complex prototype> }"],
  ["a function with a null prototype and a property, past the depth limit", () => util.inspect({ a: { b: { c: Object.assign(reproto(function f() {}, null), { x: 1 }) } } }), "{ a: { b: { c: [Function: null prototype] } } }"],
  ["an async function with a bare prototype and a property, past the depth limit", () => util.inspect({ a: { b: { c: Object.assign(reproto(async function h() {}, bare()), { x: 1 }) } } }), "{ a: { b: { c: [AsyncFunction <Complex prototype>] } } }"],
];

test.each(constructorlessChains)(
  "util.inspect names a function in a chain with no constructor: %s",
  (_, print, expected) => {
    expect(print()).toBe(expected);
  },
);

test("a replaced util.types.isAsyncFunction, toString or Symbol.match does not change the kind in a label", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const types = require("node:util/types");
        let typesCalls = 0;
        types.isAsyncFunction = types.isGeneratorFunction = () => (typesCalls++, true);
        Function.prototype.toString = () => "async function* lie() {}";
        RegExp.prototype[Symbol.match] = () => ["lie"];
        // Loaded after the replacements.
        const { inspect } = require("node:util");
        const labels = [
          function plain() {},
          function* generator() {},
          async function asyncFunction() {},
          { method() {} }.method,
        ].map(fn => inspect(fn));
        console.log(JSON.stringify({ labels, typesCalls }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
    out: {
      labels: [
        "[Function: plain]",
        "[GeneratorFunction: generator]",
        "[AsyncFunction: asyncFunction]",
        "[Function: method]",
      ],
      typesCalls: 0,
    },
    stderr: "",
    exitCode: 0,
  });
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
