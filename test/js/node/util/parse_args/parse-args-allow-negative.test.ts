import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { parseArgs } from "node:util";

// Expected values come from Node v26.3.0. Node looks up the full option name
// first and strips "no-" only at store time, when the option has no value.
describe("parseArgs allowNegative", () => {
  const B = { type: "boolean" } as const;
  const S = { type: "string" } as const;
  const values = (v: Record<string, unknown>) => ({ __proto__: null, ...v });
  const throws = (config: Parameters<typeof parseArgs>[0], code: string, message: string) => {
    let error;
    try {
      parseArgs(config);
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ code, message });
  };

  describe("option declared as 'no-*'", () => {
    test("boolean is accepted and stored under the stripped name", () => {
      expect(
        parseArgs({ args: ["--no-color"], options: { "no-color": B }, allowNegative: true, tokens: true }),
      ).toEqual({
        values: values({ color: false }),
        positionals: [],
        tokens: [
          {
            kind: "option",
            name: "color",
            rawName: "--no-color",
            index: 0,
            value: undefined,
            inlineValue: undefined,
          },
        ],
      });
    });

    test("both 'no-color' and 'color' declared", () => {
      expect(parseArgs({ args: ["--no-color"], options: { "no-color": B, color: B }, allowNegative: true })).toEqual({
        values: values({ color: false }),
        positionals: [],
      });
    });

    test("default on 'no-color' applies to the 'no-color' key", () => {
      expect(
        parseArgs({ args: ["--no-color"], options: { "no-color": { ...B, default: true } }, allowNegative: true }),
      ).toEqual({ values: values({ color: false, "no-color": true }), positionals: [] });
    });

    test("multiple on 'no-color' does not apply to the stripped key", () => {
      expect(
        parseArgs({
          args: ["--no-color", "--no-color"],
          options: { "no-color": { ...B, multiple: true } },
          allowNegative: true,
        }),
      ).toEqual({ values: values({ color: false }), positionals: [] });
    });

    test("multiple on the stripped key applies", () => {
      expect(
        parseArgs({ args: ["--no-a"], options: { a: { ...B, multiple: true }, "no-a": B }, allowNegative: true }),
      ).toEqual({ values: values({ a: [false] }), positionals: [] });
    });

    test("boolean does not consume the next arg", () => {
      expect(
        parseArgs({
          args: ["--no-foo", "val"],
          options: { "no-foo": B },
          allowNegative: true,
          allowPositionals: true,
        }),
      ).toEqual({ values: values({ foo: false }), positionals: ["val"] });
    });

    test("'no-no-foo' strips one level", () => {
      expect(parseArgs({ args: ["--no-no-foo"], options: { "no-no-foo": B }, allowNegative: true })).toEqual({
        values: values({ "no-foo": false }),
        positionals: [],
      });
    });

    test("bare 'no-' resolves to the empty key", () => {
      expect(parseArgs({ args: ["--no-"], options: { "no-": B }, allowNegative: true })).toEqual({
        values: values({ "": false }),
        positionals: [],
      });
    });

    test("short alias stores false under the stripped name", () => {
      expect(
        parseArgs({ args: ["-n"], options: { "no-color": { ...B, short: "n" } }, allowNegative: true, tokens: true }),
      ).toEqual({
        values: values({ color: false }),
        positionals: [],
        tokens: [{ kind: "option", name: "color", rawName: "-n", index: 0, value: undefined, inlineValue: undefined }],
      });
      expect(
        parseArgs({
          args: ["-nv"],
          options: { "no-color": { ...B, short: "n" }, v: { ...B, short: "v" } },
          allowNegative: true,
        }),
      ).toEqual({ values: values({ color: false, v: true }), positionals: [] });
    });

    test("string consumes the next arg and keeps the full name", () => {
      expect(
        parseArgs({
          args: ["--no-color", "val"],
          options: { "no-color": S },
          allowNegative: true,
          allowPositionals: true,
        }),
      ).toEqual({ values: values({ "no-color": "val" }), positionals: [] });
      expect(
        parseArgs({
          args: ["--no-color", "val"],
          options: { "no-color": S, color: { ...B, multiple: true } },
          allowNegative: true,
          allowPositionals: true,
        }),
      ).toEqual({ values: values({ "no-color": "val" }), positionals: [] });
    });

    test("string with a missing value throws INVALID_OPTION_VALUE", () => {
      throws(
        { args: ["--no-color"], options: { "no-color": { ...S, short: "n" } }, allowNegative: true },
        "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        "Option '-n, --no-color <value>' argument missing",
      );
    });

    test("string with a missing value in non-strict mode stores false under the stripped name", () => {
      expect(
        parseArgs({
          args: ["--no-color"],
          options: { "no-color": S },
          allowNegative: true,
          strict: false,
          tokens: true,
        }),
      ).toEqual({
        values: values({ color: false }),
        positionals: [],
        tokens: [
          {
            kind: "option",
            name: "color",
            rawName: "--no-color",
            index: 0,
            value: undefined,
            inlineValue: undefined,
          },
        ],
      });
    });
  });

  describe("option not declared as 'no-*'", () => {
    test("negates a declared boolean", () => {
      expect(parseArgs({ args: ["--no-color"], options: { color: B }, allowNegative: true, tokens: true })).toEqual({
        values: values({ color: false }),
        positionals: [],
        tokens: [
          {
            kind: "option",
            name: "color",
            rawName: "--no-color",
            index: 0,
            value: undefined,
            inlineValue: undefined,
          },
        ],
      });
    });

    test("does not negate a declared string", () => {
      throws(
        { args: ["--no-color"], options: { color: S }, allowNegative: true },
        "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        "Unknown option '--no-color'",
      );
    });

    test("without allowNegative it is unknown", () => {
      throws(
        { args: ["--no-color"], options: { color: B } },
        "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        "Unknown option '--no-color'",
      );
    });

    test("negated boolean with an inline value throws INVALID_OPTION_VALUE", () => {
      throws(
        { args: ["--no-foo=bar"], options: { foo: B }, allowNegative: true },
        "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        "Option '--foo' does not take an argument",
      );
      throws(
        { args: ["--no-foo=bar"], options: { foo: { ...B, short: "f" } }, allowNegative: true },
        "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
        "Option '-f, --foo' does not take an argument",
      );
    });

    test("negated string with an inline value is unknown", () => {
      throws(
        { args: ["--no-foo=bar"], options: { foo: S }, allowNegative: true },
        "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        "Unknown option '--no-foo'",
      );
      throws(
        { args: ["--no-foo=bar"], options: { foo: B } },
        "ERR_PARSE_ARGS_UNKNOWN_OPTION",
        "Unknown option '--no-foo'",
      );
    });

    test("inline value in non-strict mode keeps the full name", () => {
      expect(
        parseArgs({ args: ["--no-foo=bar"], options: { foo: B }, allowNegative: true, strict: false, tokens: true }),
      ).toEqual({
        values: values({ "no-foo": "bar" }),
        positionals: [],
        tokens: [{ kind: "option", name: "no-foo", rawName: "--no-foo", index: 0, value: "bar", inlineValue: true }],
      });
    });

    test("'--no-__proto__' stores an own '__proto__' property", () => {
      const result = parseArgs({ args: ["--no-__proto__"], allowNegative: true, strict: false, tokens: true });
      expect(Object.getOwnPropertyDescriptor(result.values, "__proto__")).toMatchObject({ value: false });
      expect(result.tokens).toEqual([
        {
          kind: "option",
          name: "__proto__",
          rawName: "--no-__proto__",
          index: 0,
          value: undefined,
          inlineValue: undefined,
        },
      ]);
      expect(parseArgs({ args: ["--__proto__"], allowNegative: true, strict: false })).toEqual({
        values: values({}),
        positionals: [],
      });
    });
  });

  test("bare '--no-' stores an empty key", async () => {
    // The stripped name is a zero-length string. It must become the "" property key, not a crash.
    const script = `
      const { parseArgs } = require("node:util");
      const result = parseArgs({ args: ["--no-"], allowNegative: true, strict: false, tokens: true });
      console.log(JSON.stringify(result));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      values: { "": false },
      positionals: [],
      tokens: [{ kind: "option", name: "", rawName: "--no-", index: 0 }],
    });
    expect(exitCode).toBe(0);
  });
});
