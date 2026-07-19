import { describe, expect, test } from "bun:test";
import { parseArgs } from "node:util";

// Node reads each top-level boolean flag as `objectGetOwn(config, k) ?? default`
// before validateBoolean, so an explicit null is the same as an absent key.
describe("parseArgs: null top-level boolean config flags fall back to defaults", () => {
  test.each([null, undefined])("%p acts like the key being absent for all four flags", absent => {
    const base = { values: { __proto__: null }, positionals: [] };
    expect(parseArgs({ args: [], options: {}, strict: absent } as any)).toEqual(base);
    expect(parseArgs({ args: [], options: {}, tokens: absent } as any)).toEqual(base);
    expect(parseArgs({ args: [], options: {}, allowPositionals: absent } as any)).toEqual(base);
    expect(parseArgs({ args: [], options: {}, allowNegative: absent } as any)).toEqual(base);
  });

  test("strict: null uses default true (unknown option still rejected)", () => {
    expect(() => parseArgs({ args: ["--nope"], options: {}, strict: null } as any)).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" }),
    );
  });

  test("tokens: null uses default false (no tokens array in result)", () => {
    const result = parseArgs({ args: [], options: {}, tokens: null } as any);
    expect(Object.hasOwn(result, "tokens")).toBe(false);
  });

  test("allowNegative: null uses default false (--no-foo not recognized)", () => {
    const options = { foo: { type: "boolean" } } as const;
    expect(() => parseArgs({ args: ["--no-foo"], options, allowNegative: null } as any)).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" }),
    );
  });

  test("allowPositionals: null uses default !strict", () => {
    expect(() => parseArgs({ args: ["pos"], options: {}, strict: null, allowPositionals: null } as any)).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL" }),
    );
    expect(parseArgs({ args: ["pos"], options: {}, strict: false, allowPositionals: null } as any)).toEqual({
      values: { __proto__: null },
      positionals: ["pos"],
    });
  });

  test.each(["strict", "tokens", "allowPositionals", "allowNegative"])(
    "non-null non-boolean %s still throws ERR_INVALID_ARG_TYPE",
    key => {
      expect(() => parseArgs({ args: [], options: {}, [key]: "yes" } as any)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    },
  );
});
