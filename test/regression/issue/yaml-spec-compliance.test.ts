import { test, expect, describe } from "bun:test";
import { YAML } from "bun";

// Tests for YAML spec compliance with special characters
describe("YAML spec compliance for special characters", () => {
  test("exclamation mark (!) alone should error as invalid tag", () => {
    // Currently returns null, but should error per YAML spec
    // ! is a tag indicator and needs a tag name after it
    expect(() => YAML.parse(`value: !`)).toThrow();

    // In lists
    expect(() => YAML.parse(`- !`)).toThrow();

    // Valid tags should work
    expect(YAML.parse(`value: !!str test`)).toEqual({ value: "test" });
  });

  test("question mark (?) alone should error as mapping key without value", () => {
    // Currently returns null, but should error per YAML spec
    // ? is a mapping key indicator
    expect(() => YAML.parse(`value: ?`)).toThrow();

    // In lists
    expect(() => YAML.parse(`- ?`)).toThrow();

    // Valid explicit key should work
    const validKey = `? key\n: value`;
    expect(YAML.parse(validKey)).toEqual({ key: "value" });
  });

  test("pipe (|) alone should parse as empty literal block scalar", () => {
    // Currently throws "Unexpected EOF", but should return empty string
    expect(YAML.parse(`value: |`)).toEqual({ value: "" });
    expect(YAML.parse(`value: |\n`)).toEqual({ value: "" });

    // With content should work (includes trailing newline by default)
    expect(YAML.parse(`value: |\n  test`)).toEqual({ value: "test\n" });
  });

  test("greater than (>) alone should parse as empty folded block scalar", () => {
    // Currently throws "Unexpected EOF", but should return empty string
    expect(YAML.parse(`value: >`)).toEqual({ value: "" });
    expect(YAML.parse(`value: >\n`)).toEqual({ value: "" });

    // With content should work (includes trailing newline by default for folded too)
    expect(YAML.parse(`value: >\n  test`)).toEqual({ value: "test\n" });
  });

  test("block scalars with chomp indicators", () => {
    // These should also work with empty content
    expect(YAML.parse(`value: |-`)).toEqual({ value: "" });
    expect(YAML.parse(`value: |+`)).toEqual({ value: "" });
    expect(YAML.parse(`value: >-`)).toEqual({ value: "" });
    expect(YAML.parse(`value: >+`)).toEqual({ value: "" });
  });
});

// Document which special characters are correctly handled
describe("YAML special characters correctly handled", () => {
  test("reserved and invalid characters correctly error when unquoted", () => {
    // These should all error when unquoted
    const shouldError = [
      `value: @`,  // reserved
      `value: \``, // reserved
      `value: %`,  // directive indicator
    ];

    for (const yaml of shouldError) {
      expect(() => YAML.parse(yaml)).toThrow();
    }

    // But work when quoted
    expect(YAML.parse(`value: "@"`)).toEqual({ value: "@" });
    expect(YAML.parse(`value: "\`"`)).toEqual({ value: "`" });
    expect(YAML.parse(`value: "%"`)).toEqual({ value: "%" });
  });

  test("alias (*) and anchor (&) require names", () => {
    // These correctly error
    expect(() => YAML.parse(`value: *`)).toThrow();
    expect(() => YAML.parse(`value: &`)).toThrow();

    // With names they work
    expect(YAML.parse(`value: &anchor test`)).toEqual({ value: "test" });
    // Note: alias without previous anchor will error differently
  });

  test("tilde (~) correctly parses as null", () => {
    expect(YAML.parse(`value: ~`)).toEqual({ value: null });
    expect(YAML.parse(`- ~`)).toEqual([null]);
  });
});