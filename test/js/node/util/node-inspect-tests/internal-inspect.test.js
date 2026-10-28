import assert from "assert";
import { Statement } from "bun:sqlite";
import { expect, test } from "bun:test";
import { withoutAggressiveGC } from "harness";
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
