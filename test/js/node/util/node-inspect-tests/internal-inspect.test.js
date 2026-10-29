import assert from "assert";
import { Statement } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, nodeExeAtLeast, withoutAggressiveGC } from "harness";
import { join } from "path";
import util from "util";
import inputs from "./internal-inspect-fixture.cjs";

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

// Each expected string is what Node.js v26.12.1 prints for the input of that name in internal-inspect-fixture.cjs.
// The last test gives Node.js the same inputs, where one that is new enough is installed.
describe("util.inspect prints what Node.js v26.12.1 prints", () => {
  const underline = text => `\x1B[4m${text}\x1B[24m`;
  const expected = {
    numericSeparator: {
      array: "[ -0 ]",
      typedArray: "Float64Array(3) [ -0, 0, -0.5 ]",
      boxed: "[Number: -0]",
      format: "-0 0 0 -0 -0",
    },
    ownErrorKeys: {
      suppressedError: "[SuppressedError: m] { [error]: 1, [suppressed]: 2 }",
      undefinedMembers: "[SuppressedError: m] { [error]: undefined, [suppressed]: undefined }",
      withFrames: "SuppressedError: m\n    at f (/a.js:1:1) {\n  [error]: 1,\n  [suppressed]: 2\n}",
      inObject: "{ a: [SuppressedError: m] { [error]: 1, [suppressed]: 2 } }",
      circular: "<ref *1> [SuppressedError: m] {\n  [error]: 1,\n  [suppressed]: [Circular *1]\n}",
      fromUsing: "[SuppressedError] { [error]: [Error: dispose], [suppressed]: [Error: body] }",
      hiddenError: "[Error: e] { [error]: 5 }",
      hiddenSuppressed: "[Error: e] { [suppressed]: 6 }",
      anyErrorClass: "[RangeError: r] { [error]: [TypeError: t] }",
      enumerable: "[Error: e] { suppressed: 6, error: 5, [cause]: 1 }",
      format: "[SuppressedError: m] { [error]: 1, [suppressed]: 2 }",
      pastDepth: "{ a: { b: { c: [SuppressedError] } } }",
      formatPastDepth: "{ err: [SuppressedError] }",
      inheritedCause: "[WithCauseMethod [Error]: m]",
      inheritedErrors: "[WithErrorsGetter: m]",
    },
    hostileMembers: {
      toStringTagThrows: "[Error: e] { [error]: {} }",
      constructorThrows: "[Error: e] { [error]: {} }",
      stackThrows: "[Error: e] { [error]: [Error: x] }",
      nameThrows: "[Error: e] { [error]: [object Error] }",
      messageThrows: "[Error: e] { [error]: [object Error] }",
      causeThrows: "[Error: e] { [error]: [CauseThrows [Error]: x] }",
      errorsThrows: "[Error: e] { [error]: [Error: x] }",
      revokedProxy: "[Error: e] { [error]: <Revoked Proxy> }",
      detachedDataView:
        "[Error: e] {\n" +
        "  [error]: DataView {\n" +
        "    [byteLength]: 0,\n" +
        "    [byteOffset]: undefined,\n" +
        "    [buffer]: ArrayBuffer { (detached), [byteLength]: 0 }\n" +
        "  }\n" +
        "}",
      itself: "<ref *1> [Error: e] { [error]: [Circular *1] }",
      suppressedToStringTagThrows: "[Error: e] { [suppressed]: {} }",
      ofSuppressedError: "[SuppressedError: m] { [error]: {}, [suppressed]: 2 }",
      customThrows: "throws RangeError: boom",
      customGetterThrows: "throws RangeError: boom",
      nestedCustomThrows: "throws RangeError: boom",
    },
    proxyMember: {
      throwingTraps: "[Error: e] { [error]: Proxy({}) }",
    },
    throwingGetters: {
      hiddenGettersTrue: "[Error: e] { [error]: [Getter: <Inspection threw (null)>] }",
      hiddenGettersGet: "[Error: e] { [suppressed]: [Getter: <Inspection threw (undefined)>] }",
      hiddenGettersOff: "[Error: e] { [error]: [Getter] }",
      plainObject: "{ b: 1, a: [Getter: <Inspection threw (null)>] }",
      assertMessage: "Expected values to be strictly equal:",
    },
    getterReturnsFunction: {
      fn: "{ a: [Getter] [Function: foo] }",
      class: "{ a: [Getter] [class K] }",
      arrow: "{ a: [Getter] [Function (anonymous)] }",
      withProperty: "{ a: [Getter] [Function: foo] { x: 1 } }",
      colors: "{ a: \x1B[36m[Getter]\x1B[39m \x1B[36m[Function: foo]\x1B[39m }",
      assertMessage:
        "Expected values to be strictly deep-equal:\n" +
        "+ actual - expected\n" +
        "\n" +
        "+ {\n" +
        "+   a: [Getter] [Function: foo]\n" +
        "+ }\n" +
        "- {}\n",
    },
    getterValueThrows: {
      entriesAfterIt: "{\n  a: [Getter: <Inspection threw ()>],\n  b: 1\n}",
    },
    toStringTag: {
      namespaced: "ns.Foo {}",
      twoDots: "a.b.Foo {}",
      otherLastPart: "Foo [Foo.b.Bar] {}",
      leadingDot: "Foo [.Foo] {}",
      trailingDot: "Foo [Foo.] {}",
      sameAsName: "Foo {}",
      otherTag: "Bar [baz] {}",
      tagIsPrefixOfName: "FooBar [Foo] {}",
      nameHasTheDot: "ns.Foo [ns.Foo] {}",
      map: "ns.MyMap(1) { 1 => 2 }",
      set: "ns.MySet(1) { 1 }",
      array: "ns.MyArray(2) [ <2 empty items> ]",
      typedArray: "ns.MyBytes(2) [ 0, 0 ]",
      error: "[ns.MyError: m]",
      nullPrototype: "[Object: null prototype] [ns.Foo] {}",
      intl: "[ Intl.NumberFormat {}, Intl.Locale {}, Intl.Segmenter {} ]",
      webAssembly: "WebAssembly.Memory {}",
    },
    breakLengthInfinity: {
      object: "{ a: l1\n   l2,\n  b: 1 }",
      array: "[ l1\n  l2,\n  1 ]",
      set: "Set(2) {\n  l1\n  l2,\n  1 }",
      map: "Map(1) {\n  l1\n  l2 => 1 }",
      lastEntry: "{ a: 1,\n  b: l1\n   l2 }",
      nested: "{ x: { a: l1\n      l2,\n     b: 1 },\n  y: 2 }",
      errorEntry: "{ e: Error: x\n       at y,\n  b: 1 }",
      colors: "{ a: l1\n   l2,\n  b: \x1B[33m1\x1B[39m }",
      format: "[ l1\n  l2,\n  1,\n  [length]: 2 ]",
      oneLine: "{ a: 1, b: [ 1, 2 ], c: 'x' }",
      escapedLineBreak: "{ a: 'l1\\nl2', b: 1 }",
      maxValue: "{ a: l1\n   l2, b: 1 }",
      eighty: "{ a: l1\n   l2, b: 1 }",
      compactThree: "{\n  a: l1\n  l2,\n  b: 1\n}",
    },
    nodeModules: {
      plain: `f (/a/node_modules/${underline("pkg")}/index.js:1:1)`,
      scoped: `f (/a/node_modules/${underline("@s/pkg")}/index.js:1:1)`,
      nested: `f (/a/node_modules/${underline("p1")}/node_modules/${underline("p2")}/i.js:1:1)`,
      twoPaths: `f (/a/node_modules/${underline("p")}/b.js) (/c/node_modules/${underline("q")}/d.js)`,
      backslash: `f (C:\\a\\node_modules\\${underline("pkg")}\\index.js:1:1)`,
      backslashScoped: `f (C:\\a\\node_modules\\${underline("@s\\pkg")}\\index.js:1:1)`,
      mixedSeparators: `f (C:\\a\\node_modules\\${underline("pkg/index.js:1:1)")}`,
      endOfLine: `f (/a/node_modules/${underline("pkg)")}`,
      scopedEndOfLine: `f (/a/node_modules/${underline("@s/pkg)")}`,
      scopeOnly: `f (/a/node_modules/${underline("@s)")}`,
      noName: `f (/a/node_modules/${underline(")")}`,
      longerBefore: "f (/a/my_node_modules/pkg/index.js:1:1)",
      longerAfter: "f (/a/node_modules_x/pkg/index.js:1:1)",
      longerThenReal: `f (/a/xnode_modules/p/node_modules/${underline("q")}/i.js:1:1)`,
      atLineStart: "node_modules/pkg/index.js:1:1",
    },
    dataView: {
      detached:
        "[\n" +
        "  DataView {\n" +
        "    [byteLength]: 0,\n" +
        "    [byteOffset]: undefined,\n" +
        "    [buffer]: ArrayBuffer { (detached), [byteLength]: 0 }\n" +
        "  },\n" +
        "  { a: { b: 1 } }\n" +
        "]",
      outOfBounds:
        "[\n" +
        "  DataView {\n" +
        "    [byteLength]: 2,\n" +
        "    [byteOffset]: undefined,\n" +
        "    [buffer]: ArrayBuffer { [Uint8Contents]: <00 00>, [byteLength]: 2 }\n" +
        "  },\n" +
        "  { a: 1 }\n" +
        "]",
    },
  };

  test.each([
    ["numericSeparator keeps the sign of -0 wherever a number is printed", "numericSeparator"],
    ["an own error, suppressed, cause or errors of an Error is printed, and an inherited one is not", "ownErrorKeys"],
    ["an own error or suppressed that is hard to print does not make inspect throw", "hostileMembers"],
    ["a getter that throws null or undefined is reported and does not make inspect throw", "throwingGetters"],
    ["a getter that returns a function is printed as a value", "getterReturnsFunction"],
    ["a getter value that throws while it is printed does not indent the entries after it", "getterValueThrows"],
    ["a Symbol.toStringTag that ends in the constructor name after a dot is printed alone", "toStringTag"],
    [
      "breakLength: Infinity with compact: true ends the line after an entry that has a line break",
      "breakLengthInfinity",
    ],
    ["the module name after node_modules is underlined in a colored stack", "nodeModules"],
    ["a DataView whose buffer was detached or shrunk does not indent the entries after it", "dataView"],
  ])("%s", (_, group) => {
    expect(inputs[group]()).toEqual(expected[group]);
  });

  // Bun prints a Proxy as its target. Node.js prints `Proxy(target)`: https://github.com/oven-sh/bun/pull/38652
  test.failing("an own error that is a Proxy whose traps throw is printed as Node.js prints it", () => {
    expect(inputs.proxyMember()).toEqual(expected.proxyMember);
  });

  test("an inspect.custom method that console.log and Bun.inspect call gets this inspect", () => {
    const delegating = {
      [util.inspect.custom]: (depth, options, inspect) => inspect(new Intl.NumberFormat("en"), options),
    };
    expect(Bun.inspect(delegating)).toBe("Intl.NumberFormat {}");
  });

  const node = nodeExeAtLeast("26.12.1");
  test.skipIf(!node)("Node.js prints the same for every input", async () => {
    await using proc = Bun.spawn({
      cmd: [node, join(import.meta.dir, "internal-inspect-fixture.cjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
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

test("util.inspect prints a value of Bun whose Symbol.toStringTag getter throws", () => {
  // The getter reads a private field, which the prototype does not have.
  expect(util.inspect(Statement.prototype)).toBe("{}");
});
