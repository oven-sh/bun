import { describe, expect, test } from "bun:test";
import { parseArgs } from "node:util";

describe("parseArgs: dash inside short-option group acts as option terminator", () => {
  test("tokens: -a- emits option then option-terminator", () => {
    const { tokens, values, positionals } = parseArgs({
      args: ["-a-"],
      strict: false,
      tokens: true,
      allowPositionals: true,
    });
    expect(tokens).toStrictEqual([
      { kind: "option", name: "a", rawName: "-a", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 0 },
    ]);
    expect(values).toEqual({ __proto__: null, a: true });
    expect(positionals).toEqual([]);
  });

  test("-a-b treats -b as positional, not an option", () => {
    const result = parseArgs({ args: ["-a-b"], strict: false, allowPositionals: true });
    expect(result).toEqual({ values: { __proto__: null, a: true }, positionals: ["-b"] });
  });

  test("strict mode with -a- does not throw when a is declared", () => {
    const result = parseArgs({
      args: ["-a-"],
      options: { a: { type: "boolean", short: "a" } },
      allowPositionals: true,
    });
    expect(result).toEqual({ values: { __proto__: null, a: true }, positionals: [] });
  });

  test("strict mode with -a-b delivers -b as positional", () => {
    const { values, positionals, tokens } = parseArgs({
      args: ["-a-b"],
      options: { a: { type: "boolean", short: "a" } },
      allowPositionals: true,
      tokens: true,
    });
    expect(values).toEqual({ __proto__: null, a: true });
    expect(positionals).toEqual(["-b"]);
    expect(tokens).toStrictEqual([
      { kind: "option", name: "a", rawName: "-a", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 0 },
      { kind: "positional", index: 1, value: "-b" },
    ]);
  });

  test("tokens: -a-bc emits each trailing group char as a separate positional", () => {
    const { tokens } = parseArgs({ args: ["-a-bc"], strict: false, tokens: true, allowPositionals: true });
    expect(tokens).toStrictEqual([
      { kind: "option", name: "a", rawName: "-a", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 0 },
      { kind: "positional", index: 1, value: "-b" },
      { kind: "positional", index: 2, value: "-c" },
    ]);
  });

  test("tokens: -a- followed by more args makes them all positional", () => {
    const { tokens } = parseArgs({
      args: ["-a-", "foo", "-x"],
      strict: false,
      tokens: true,
      allowPositionals: true,
    });
    expect(tokens).toStrictEqual([
      { kind: "option", name: "a", rawName: "-a", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 0 },
      { kind: "positional", index: 1, value: "foo" },
      { kind: "positional", index: 2, value: "-x" },
    ]);
  });

  test("tokens: indices after in-group terminator match Node when surrounded by other args", () => {
    const { tokens } = parseArgs({
      args: ["x", "-a-b", "y"],
      strict: false,
      tokens: true,
      allowPositionals: true,
    });
    expect(tokens).toStrictEqual([
      { kind: "positional", index: 0, value: "x" },
      { kind: "option", name: "a", rawName: "-a", index: 1, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 1 },
      { kind: "positional", index: 2, value: "-b" },
      { kind: "positional", index: 3, value: "y" },
    ]);
  });

  test("tokens: string-typed short after in-group terminator becomes positional with its inline value", () => {
    const { tokens } = parseArgs({
      args: ["-a-fVAL"],
      strict: false,
      tokens: true,
      allowPositionals: true,
      options: { f: { type: "string", short: "f" }, a: { type: "boolean", short: "a" } },
    });
    expect(tokens).toStrictEqual([
      { kind: "option", name: "a", rawName: "-a", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 0 },
      { kind: "positional", index: 1, value: "-fVAL" },
    ]);
  });

  test("tokens: two dashes inside group: second becomes positional '--'", () => {
    const { tokens } = parseArgs({
      args: ["-a--b"],
      strict: false,
      tokens: true,
      allowPositionals: true,
    });
    expect(tokens).toStrictEqual([
      { kind: "option", name: "a", rawName: "-a", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 0 },
      { kind: "positional", index: 1, value: "--" },
      { kind: "positional", index: 2, value: "-b" },
    ]);
  });

  test("tokens: terminator in second group", () => {
    const { tokens } = parseArgs({
      args: ["-ab", "-c-d"],
      strict: false,
      tokens: true,
      allowPositionals: true,
    });
    expect(tokens).toStrictEqual([
      { kind: "option", name: "a", rawName: "-a", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option", name: "b", rawName: "-b", index: 0, value: undefined, inlineValue: undefined },
      { kind: "option", name: "c", rawName: "-c", index: 1, value: undefined, inlineValue: undefined },
      { kind: "option-terminator", index: 1 },
      { kind: "positional", index: 2, value: "-d" },
    ]);
  });

  test("allowPositionals: false with -a-b throws for positional, not unknown option", () => {
    expect(() => parseArgs({ args: ["-a-b"], strict: false, allowPositionals: false })).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL" }),
    );
  });
});
