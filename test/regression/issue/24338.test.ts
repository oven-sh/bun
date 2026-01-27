import assert from "node:assert";
import { test } from "node:test";

// https://github.com/oven-sh/bun/issues/24338
// assert.partialDeepStrictEqual should support Map subset checking

test("partialDeepStrictEqual with Map subset - basic case", () => {
  // The expected Map is a subset of actual Map
  assert.partialDeepStrictEqual(
    new Map([
      ["key1", "value1"],
      ["key2", "value2"],
    ]),
    new Map([["key2", "value2"]]),
  );
});

test("partialDeepStrictEqual with Map - exact match", () => {
  assert.partialDeepStrictEqual(new Map([["key1", "value1"]]), new Map([["key1", "value1"]]));
});

test("partialDeepStrictEqual with Map - empty expected", () => {
  assert.partialDeepStrictEqual(new Map([["key1", "value1"]]), new Map());
});

test("partialDeepStrictEqual with Map - multiple matching entries", () => {
  assert.partialDeepStrictEqual(
    new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]),
    new Map([
      ["a", 1],
      ["c", 3],
    ]),
  );
});

test("partialDeepStrictEqual with Map - nested objects as values", () => {
  assert.partialDeepStrictEqual(
    new Map([
      ["config", { debug: true, verbose: false }],
      ["data", { items: [1, 2, 3] }],
    ]),
    new Map([["config", { debug: true }]]),
  );
});

test("partialDeepStrictEqual with Map - should fail when expected has more keys", () => {
  assert.throws(
    () =>
      assert.partialDeepStrictEqual(
        new Map([["key1", "value1"]]),
        new Map([
          ["key1", "value1"],
          ["key2", "value2"],
        ]),
      ),
    assert.AssertionError,
  );
});

test("partialDeepStrictEqual with Map - should fail when key missing in actual", () => {
  assert.throws(
    () => assert.partialDeepStrictEqual(new Map([["key1", "value1"]]), new Map([["key2", "value2"]])),
    assert.AssertionError,
  );
});

test("partialDeepStrictEqual with Map - should fail when value differs", () => {
  assert.throws(
    () => assert.partialDeepStrictEqual(new Map([["key1", "value1"]]), new Map([["key1", "different"]])),
    assert.AssertionError,
  );
});

test("partialDeepStrictEqual with Map - nested Map values", () => {
  assert.partialDeepStrictEqual(
    new Map([
      [
        "outer",
        new Map([
          ["inner1", 1],
          ["inner2", 2],
        ]),
      ],
    ]),
    new Map([["outer", new Map([["inner1", 1]])]]),
  );
});

test("partialDeepStrictEqual with Map - non-string keys", () => {
  const objKey = { id: 1 };
  assert.partialDeepStrictEqual(
    new Map([
      [1, "one"],
      [objKey, "object"],
      [true, "boolean"],
    ]),
    new Map([[1, "one"]]),
  );
});

test("partialDeepStrictEqual with Map - circular reference", () => {
  const actualMap = new Map<string, unknown>();
  actualMap.set("self", actualMap);
  actualMap.set("other", "value");

  const expectedMap = new Map<string, unknown>();
  expectedMap.set("self", expectedMap);

  // Should not hang due to circular reference
  assert.partialDeepStrictEqual(actualMap, expectedMap);
});
