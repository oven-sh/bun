import { expect, test } from "bun:test";

test("issue #23501: YAML.stringify should not add extra spaces for multiline values", () => {
  const data = {
    arr: [],
    nested: {
      obj: "str",
    },
  };

  const result = Bun.YAML.stringify(data, null, 2);

  // Issue 1: No space after colon when value is on next line
  // Issue 2: Empty arrays should stay inline as "arr: []"
  expect(result).toBe("arr: []\nnested:\n  obj: str");
});

test("issue #23501: YAML.stringify handles various empty collections correctly", () => {
  const data = {
    emptyArray: [],
    emptyObject: {},
    nonEmptyArray: [1, 2],
    nonEmptyObject: { key: "value" },
    str: "hello",
    num: 42,
  };

  const result = Bun.YAML.stringify(data, null, 2);

  // Empty arrays and objects should be inline with space after colon
  expect(result).toContain("emptyArray: []");
  expect(result).toContain("emptyObject: {}");
  expect(result).toContain("str: hello");
  expect(result).toContain("num: 42");

  // Non-empty arrays and objects should be multiline without space after colon
  expect(result).toContain("nonEmptyArray:\n");
  expect(result).toContain("nonEmptyObject:\n");
});

test("issue #23501: YAML.stringify preserves correct formatting for nested structures", () => {
  const data = {
    users: [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ],
    config: {
      timeout: 5000,
      retries: 3,
    },
  };

  const result = Bun.YAML.stringify(data, null, 2);

  // Arrays and objects with content should have colon without space, then newline
  expect(result).toContain("users:\n");
  expect(result).toContain("config:\n");

  // Primitive values should have ": " (colon with space)
  expect(result).toContain("timeout: 5000");
  expect(result).toContain("retries: 3");
  expect(result).toContain("name: Alice");
  expect(result).toContain("age: 30");
});
