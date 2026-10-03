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

// Map and Set iterators are shown through the native previewEntries
// (UtilInspect.cpp). It reads what the iterator has left from the storage of
// the collection and never calls next(). So the iterator stays where it is, and
// user code that replaces next() or Symbol.iterator does not run. The expected
// strings are what Node.js prints.
test("util.inspect shows what a Map or Set iterator has left", () => {
  const map = new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);
  const set = new Set([1, 2, 3]);

  const entries = map.entries();
  entries.next();
  expect(util.inspect(entries)).toBe("[Map Entries] { [ 'b', 2 ], [ 'c', 3 ] }");
  expect(util.inspect(entries)).toBe("[Map Entries] { [ 'b', 2 ], [ 'c', 3 ] }");
  expect(entries.next()).toEqual({ value: ["b", 2], done: false });

  const keys = map.keys();
  keys.next();
  keys.next();
  expect(util.inspect(keys)).toBe("[Map Iterator] { 'c' }");

  const values = map.values();
  values.next();
  expect(util.inspect(values)).toBe("[Map Iterator] { 2, 3 }");

  const setValues = set.values();
  setValues.next();
  expect(util.inspect(setValues)).toBe("[Set Iterator] { 2, 3 }");

  const setEntries = set.entries();
  setEntries.next();
  expect(util.inspect(setEntries)).toBe("[Set Entries] { [ 2, 2 ], [ 3, 3 ] }");

  // An iterator that reported done stays empty, also when the collection grows.
  for (const _ of entries);
  for (const _ of setValues);
  map.set("d", 4);
  set.add(4);
  expect(util.inspect(entries)).toBe("[Map Entries] {  }");
  expect(util.inspect(setValues)).toBe("[Set Iterator] {  }");

  expect(util.inspect(new Map().entries())).toBe("[Map Entries] {  }");
  expect(util.inspect(new Set().values())).toBe("[Set Iterator] {  }");

  const fromOtherRealm = vm.runInNewContext("const i = new Map([[1, 2], [3, 4]]).entries(); i.next(); i");
  expect(util.inspect(fromOtherRealm)).toBe("[Map Entries] { [ 3, 4 ] }");
});

test("util.inspect of a Map or Set iterator follows delete(), clear() and growth of the collection", () => {
  const map = new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
    ["d", 4],
  ]);
  let iterator = map.entries();
  iterator.next();
  map.delete("b");
  map.set("e", 5);
  expect(util.inspect(iterator)).toBe("[Map Entries] { [ 'c', 3 ], [ 'd', 4 ], [ 'e', 5 ] }");

  const cleared = new Map([
    ["a", 1],
    ["b", 2],
  ]);
  iterator = cleared.entries();
  iterator.next();
  cleared.clear();
  cleared.set("z", 26);
  expect(util.inspect(iterator)).toBe("[Map Entries] { [ 'z', 26 ] }");

  // This iterator exists before the Map has any storage to point at.
  const late = new Map();
  iterator = late.entries();
  late.set("x", 1);
  expect(util.inspect(iterator)).toBe("[Map Entries] { [ 'x', 1 ] }");

  // Growth and deletes rehash the storage. The iterator still points at the first table.
  const grown = new Map([
    [0, 0],
    [1, 1],
  ]);
  iterator = grown.keys();
  iterator.next();
  for (let i = 2; i < 40; i++) grown.set(i, i);
  for (let i = 2; i < 36; i++) grown.delete(i);
  expect(util.inspect(iterator)).toBe("[Map Iterator] { 1, 36, 37, 38, 39 }");
  expect([...iterator]).toEqual([1, 36, 37, 38, 39]);

  const set = new Set([1, 2, 3, 4, 5, 6]);
  iterator = set.values();
  iterator.next();
  iterator.next();
  set.delete(1);
  set.delete(4);
  set.add(7);
  expect(util.inspect(iterator)).toBe("[Set Iterator] { 3, 5, 6, 7 }");
  expect([...iterator]).toEqual([3, 5, 6, 7]);
});

test("util.inspect of a Map or Set iterator counts the items it leaves out from where the iterator is", () => {
  const map = new Map();
  for (let i = 0; i < 150; i++) map.set(i, i);

  let iterator = map.keys();
  for (let i = 0; i < 20; i++) iterator.next();
  expect(util.inspect(iterator, { maxArrayLength: 2 })).toBe("[Map Iterator] { 20, 21, ... 128 more items }");
  expect(util.inspect(iterator, { breakLength: Infinity })).toEndWith(", 118, 119, ... 30 more items }");

  iterator = map.entries();
  for (let i = 0; i < 148; i++) iterator.next();
  expect(util.inspect(iterator, { maxArrayLength: 1 })).toBe("[Map Entries] { [ 148, 148 ], ... 1 more item }");
  expect(util.inspect(iterator, { maxArrayLength: 0 })).toBe("[Map Entries] { ... 2 more items }");
  expect(util.inspect(iterator, { maxArrayLength: -1 })).toBe("[Map Entries] { ... 2 more items }");
  for (const maxArrayLength of [2, 3, Infinity, null]) {
    expect(util.inspect(iterator, { maxArrayLength })).toBe("[Map Entries] { [ 148, 148 ], [ 149, 149 ] }");
  }

  iterator = new Set(map.keys()).entries();
  for (let i = 0; i < 147; i++) iterator.next();
  expect(util.inspect(iterator, { maxArrayLength: 1 })).toBe("[Set Entries] { [ 147, 147 ], ... 2 more items }");
});

test("util.inspect of a Map or Set iterator does not run a replaced next() or Symbol.iterator", async () => {
  // The replaced functions never report done. On a build that calls them, the
  // guard ends the child process and the output shows how far it got.
  const fixture = /* js */ `
    const util = require("node:util");
    let calls = 0;
    function guard() {
      if (++calls > 5000) {
        console.log("RUNAWAY calls=" + calls);
        process.exit(2);
      }
    }
    function* endless() {
      for (;;) {
        guard();
        yield ["k", "v"];
      }
    }
    const map = new Map([["a", 1], ["b", 2]]);
    const set = new Set([1, 2]);
    const iterators = {
      "map.entries()": map.entries(),
      "map.keys()": map.keys(),
      "map.values()": map.values(),
      "map[Symbol.iterator]()": map[Symbol.iterator](),
      "set.entries()": set.entries(),
      "set.values()": set.values(),
      "set[Symbol.iterator]()": set[Symbol.iterator](),
    };
    Object.getPrototypeOf(map.entries()).next = () => (guard(), { value: ["k", "v"], done: false });
    Object.getPrototypeOf(set.values()).next = () => (guard(), { value: "v", done: false });
    for (const method of ["entries", "keys", "values", Symbol.iterator]) {
      Map.prototype[method] = endless;
      Set.prototype[method] = endless;
    }
    for (const name in iterators) console.log(name, util.inspect(iterators[name]));
    console.log("calls=" + calls);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "map.entries() [Map Entries] { [ 'a', 1 ], [ 'b', 2 ] }",
      "map.keys() [Map Iterator] { 'a', 'b' }",
      "map.values() [Map Iterator] { 1, 2 }",
      "map[Symbol.iterator]() [Map Entries] { [ 'a', 1 ], [ 'b', 2 ] }",
      "set.entries() [Set Entries] { [ 1, 1 ], [ 2, 2 ] }",
      "set.values() [Set Iterator] { 1, 2 }",
      "set[Symbol.iterator]() [Set Iterator] { 1, 2 }",
      "calls=0",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
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
