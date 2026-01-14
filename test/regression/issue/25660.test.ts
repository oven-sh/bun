/**
 * Regression test for issue #25660
 * YAML.parse() incorrectly splits on `---` inside values
 *
 * @see https://github.com/oven-sh/bun/issues/25660
 */
import { describe, expect, test } from "bun:test";

describe("YAML.parse document separator handling", () => {
  test("should not split on --- inside scalar values", () => {
    const text = `
name: some-text---
description: Lorem ipsum dolor sit amet, consectetur adipiscing elit.
`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toEqual({
      name: "some-text---",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    });
  });

  test("should not split on --- in middle of value", () => {
    const text = `key: hello---world`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toEqual({ key: "hello---world" });
  });

  test("should not split on ... inside scalar values", () => {
    const text = `key: hello...world`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toEqual({ key: "hello...world" });
  });

  test("should not treat document markers as values after ':'", () => {
    const text = `
key1: ---
key2: ...
`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toEqual({ key1: "---", key2: "..." });
  });

  test("should not treat --- at line start in multiline plain scalar as a document separator", () => {
    const text = `
message: first line
  --- still part of the value
  last line
`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toEqual({
      message: "first line --- still part of the value last line",
    });
  });

  test("should correctly handle actual document separator at line start", () => {
    const text = `
doc1: value1
---
doc2: value2
`;
    const parsed = Bun.YAML.parse(text);
    // When there's an actual document separator, it returns an array
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ doc1: "value1" });
    expect(parsed[1]).toEqual({ doc2: "value2" });
  });

  test("should handle value ending with multiple dashes", () => {
    const text = `
title: My-Title---
subtitle: Another---Value---
`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toEqual({
      title: "My-Title---",
      subtitle: "Another---Value---",
    });
  });

  test("should handle value ending with dots", () => {
    const text = `message: Hello...`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toEqual({ message: "Hello..." });
  });

  test("should recognize ... as document end marker for top-level plain scalar", () => {
    // This is the case Dylan pointed out: a top-level plain scalar followed by
    // document end marker should correctly recognize ... as document end
    const text = `hello
...`;
    const parsed = Bun.YAML.parse(text);
    expect(parsed).toBe("hello");
  });

  test("should recognize --- as document separator for top-level plain scalar", () => {
    const text = `first
---
second`;
    const parsed = Bun.YAML.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toBe("first");
    expect(parsed[1]).toBe("second");
  });
});
