import { describe, expect, test } from "bun:test";
import { parseArgs } from "node:util";

describe("parseArgs allowNegative with inline value", () => {
  test("negated boolean option with inline value throws ERR_PARSE_ARGS_INVALID_OPTION_VALUE", () => {
    const options = { foo: { type: "boolean" } } as const;
    expect(() => parseArgs({ args: ["--no-foo=bar"], options, allowNegative: true })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        message: "Option '--foo' does not take an argument",
      }),
    );
  });

  test("negated boolean option with short alias includes the short in the message", () => {
    const options = { foo: { type: "boolean", short: "f" } } as const;
    expect(() => parseArgs({ args: ["--no-foo=bar"], options, allowNegative: true })).toThrow(
      expect.objectContaining({
        code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        message: "Option '-f, --foo' does not take an argument",
      }),
    );
  });

  test("negated string option with inline value stays ERR_PARSE_ARGS_UNKNOWN_OPTION", () => {
    const options = { foo: { type: "string" } } as const;
    expect(() => parseArgs({ args: ["--no-foo=bar"], options, allowNegative: true })).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" }),
    );
  });

  test("without allowNegative, negated boolean with inline value stays ERR_PARSE_ARGS_UNKNOWN_OPTION", () => {
    const options = { foo: { type: "boolean" } } as const;
    expect(() => parseArgs({ args: ["--no-foo=bar"], options })).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" }),
    );
  });

  test("strict:false emits token with unstripped name and stores value under no-foo", () => {
    const options = { foo: { type: "boolean" } } as const;
    const result = parseArgs({ args: ["--no-foo=bar"], options, allowNegative: true, strict: false, tokens: true });
    expect(result.values).toEqual({ __proto__: null, "no-foo": "bar" } as any);
    expect(result.tokens).toEqual([
      { kind: "option", name: "no-foo", rawName: "--no-foo", index: 0, value: "bar", inlineValue: true },
    ]);
  });
});
