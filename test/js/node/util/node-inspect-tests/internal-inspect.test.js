import assert from "assert";
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

function withFrames(error, names) {
  const frames = names.split(" ").map(name => `    at ${name} (file.js:1:1)`);
  error.stack = [`${error.name}: ${error.message}`, ...frames].join("\n");
  return error;
}

const fourSharedFrames = `Error: outer
    at a (file.js:1:1)
    at b (file.js:1:1)
    ... 2 lines matching cause stack trace ...
    at e (file.js:1:1) {
  [cause]: Error: cause
      at x (file.js:1:1)
      at b (file.js:1:1)
      at c (file.js:1:1)
      at d (file.js:1:1)
      at e (file.js:1:1)
}`;

// The outer error keeps the first and the last frame that it shares with its cause.
// Each expected text is the output of Node.js v26.3.0 for the same error.
test.each([
  ["shares four frames with its cause", "a b c d e", withFrames(new Error("cause"), "x b c d e"), fourSharedFrames],
  [
    "shares three frames with its cause",
    "a b c d",
    withFrames(new Error("cause"), "x b c d"),
    `Error: outer
    at a (file.js:1:1)
    at b (file.js:1:1)
    at c (file.js:1:1)
    at d (file.js:1:1) {
  [cause]: Error: cause
      at x (file.js:1:1)
      at b (file.js:1:1)
      at c (file.js:1:1)
      at d (file.js:1:1)
}`,
  ],
  [
    "shares frames with its cause between frames of its own",
    "a1 a2 b c d e f a3",
    withFrames(new Error("cause"), "x b c d e f y"),
    `Error: outer
    at a1 (file.js:1:1)
    at a2 (file.js:1:1)
    at b (file.js:1:1)
    ... 3 lines matching cause stack trace ...
    at f (file.js:1:1)
    at a3 (file.js:1:1) {
  [cause]: Error: cause
      at x (file.js:1:1)
      at b (file.js:1:1)
      at c (file.js:1:1)
      at d (file.js:1:1)
      at e (file.js:1:1)
      at f (file.js:1:1)
      at y (file.js:1:1)
}`,
  ],
  [
    "starts with a frame that is one of the last three of its cause",
    "a b c d e",
    withFrames(new Error("cause"), "b c d e a"),
    `Error: outer
    at a (file.js:1:1)
    at b (file.js:1:1)
    ... 2 lines matching cause stack trace ...
    at e (file.js:1:1) {
  [cause]: Error: cause
      at b (file.js:1:1)
      at c (file.js:1:1)
      at d (file.js:1:1)
      at e (file.js:1:1)
      at a (file.js:1:1)
}`,
  ],
  [
    "starts with a frame that its cause has twice",
    "b c d e f",
    withFrames(new Error("cause"), "b x b c d e f"),
    `Error: outer
    at b (file.js:1:1)
    at c (file.js:1:1)
    ... 2 lines matching cause stack trace ...
    at f (file.js:1:1) {
  [cause]: Error: cause
      at b (file.js:1:1)
      at x (file.js:1:1)
      at b (file.js:1:1)
      at c (file.js:1:1)
      at d (file.js:1:1)
      at e (file.js:1:1)
      at f (file.js:1:1)
}`,
  ],
  [
    "shares four frames with a TypeError",
    "a b c d e",
    withFrames(new TypeError("cause"), "x b c d e"),
    fourSharedFrames.replace("[cause]: Error", "[cause]: TypeError"),
  ],
  [
    "shares four frames with an object below Error.prototype",
    "a b c d e",
    withFrames(Object.create(Error.prototype, { message: { value: "cause" }, stack: { writable: true } }), "x b c d e"),
    fourSharedFrames,
  ],
  [
    "shares four frames with an object that is not an error",
    "a b c d e",
    { stack: withFrames(new Error("cause"), "x b c d e").stack },
    `Error: outer
    at a (file.js:1:1)
    at b (file.js:1:1)
    at c (file.js:1:1)
    at d (file.js:1:1)
    at e (file.js:1:1) {
  [cause]: {
    stack: 'Error: cause\\n' +
      '    at x (file.js:1:1)\\n' +
      '    at b (file.js:1:1)\\n' +
      '    at c (file.js:1:1)\\n' +
      '    at d (file.js:1:1)\\n' +
      '    at e (file.js:1:1)'
  }
}`,
  ],
])("util.inspect of an error that %s", (_, frames, cause, expected) => {
  expect(util.inspect(withFrames(new Error("outer", { cause }), frames))).toBe(expected);
});

test("util.inspect collapses the shared frames of each error in a chain of causes, in grey with colors", () => {
  const inner = withFrames(new Error("inner"), "i b c d e f");
  const middle = withFrames(new Error("middle", { cause: inner }), "m b c d e f");
  const outer = withFrames(new Error("outer", { cause: middle }), "o b c d e f");
  expect(util.inspect({ error: outer }, { colors: true })).toBe(`{
  error: Error: outer
      at o (file.js:1:1)
      at b (file.js:1:1)
  \x1B[90m    ... 3 lines matching cause stack trace ...\x1B[39m
      at f (file.js:1:1) {
    [cause]: Error: middle
        at m (file.js:1:1)
        at b (file.js:1:1)
    \x1B[90m    ... 3 lines matching cause stack trace ...\x1B[39m
        at f (file.js:1:1) {
      [cause]: Error: inner
          at i (file.js:1:1)
          at b (file.js:1:1)
          at c (file.js:1:1)
          at d (file.js:1:1)
          at e (file.js:1:1)
          at f (file.js:1:1)
    }
  }
}`);
});

test("util.format and Console.prototype.log collapse the frames that an error shares with its cause", () => {
  const error = withFrames(new Error("outer", { cause: withFrames(new Error("cause"), "x b c d e") }), "a b c d e");
  expect(util.format("%O", error)).toBe(fourSharedFrames);

  let written = "";
  const stdout = {
    write(chunk) {
      written += chunk;
    },
  };
  // With ignoreErrors: false, the only method of stdout that Console calls is write.
  new console.Console({ stdout, colorMode: false, ignoreErrors: false }).log(error);
  expect(written).toBe(fourSharedFrames + "\n");
});

test("util.inspect collapses the frames without a call of a replaced Array.prototype.splice", () => {
  const error = withFrames(new Error("outer", { cause: withFrames(new Error("cause"), "x b c d e") }), "a b c d e");
  // The formatter captures Array.prototype.splice when it loads. The first call loads it.
  expect(util.inspect(error)).toBe(fourSharedFrames);

  const splice = Array.prototype.splice;
  let text;
  Array.prototype.splice = () => {
    throw new Error("the replaced splice was called");
  };
  try {
    text = util.inspect(error);
  } finally {
    Array.prototype.splice = splice;
  }
  expect(text).toBe(fourSharedFrames);
});

test("util.inspect collapses the frames that a thrown error shares with its cause", () => {
  function inner() {
    throw new Error("cause");
  }
  function middle() {
    try {
      inner();
    } catch (cause) {
      throw new Error("outer", { cause });
    }
  }
  function a1() {
    middle();
  }
  function a2() {
    a1();
  }
  function a3() {
    a2();
  }
  function a4() {
    a3();
  }
  let error;
  try {
    a4();
  } catch (thrown) {
    error = thrown;
  }

  const lines = util.inspect(error).split("\n");
  expect(lines.slice(0, 4)).toEqual([
    "Error: outer",
    expect.stringMatching(/^ {4}at middle \(/),
    expect.stringMatching(/^ {4}at a1 \(/),
    expect.stringMatching(/^ {4}\.\.\. \d+ lines matching cause stack trace \.\.\.$/),
  ]);
  // a2 and a3 are between the first and the last shared frame, so only the cause prints them.
  expect(lines.filter(line => /^ +at a[23] \(/.test(line))).toEqual([
    expect.stringMatching(/^ {6}at a2 \(/),
    expect.stringMatching(/^ {6}at a3 \(/),
  ]);
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
