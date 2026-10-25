// A regular expression search stops after a fixed number of steps, and then nobody knows whether the text matches.
// "No match" would accept the text under `not`, and under a pattern whose properties are forbidden. Every method throws a RangeError.
import { describe, expect, test } from "bun:test";

const Validator = (Bun as any).Validator as new (schema: unknown) => any;
const it = test.todoIf(typeof Validator !== "function");

const methods: Record<string, (validator: any, value: unknown) => unknown> = {
  check: (validator, value) => validator.check(value),
  issues: (validator, value) => validator.issues(value),
  validate: (validator, value) => validator.validate(value),
  parse: (validator, value) => validator.parse(JSON.stringify(value)),
  "~standard": (validator, value) => validator["~standard"].validate(value),
};

// Both texts match. The first alternative fails in 2^n ways before the second one is tried.
const pattern = "^(?:(a+)+!$|a+!x$)";
const short = "a".repeat(10) + "!x";
const long = "a".repeat(40) + "!x";
const other = "b";

// Each schema forbids a text that matches.
describe.each<[string, unknown, (text: string) => unknown]>([
  ["not", { not: { pattern } }, text => text],
  ["patternProperties", { type: "object", patternProperties: { [pattern]: false } }, text => ({ [text]: 1 })],
  ["propertyNames", { type: "object", propertyNames: { not: { pattern } } }, text => ({ [text]: 1 })],
  ["if", { if: { pattern }, then: false }, text => text],
  ["oneOf", { oneOf: [{ pattern }, { type: "string" }] }, text => text],
  ["contains", { type: "array", contains: { pattern }, minContains: 0, maxContains: 0 }, text => [text]],
])("a pattern under %s", (_, schema, holding) => {
  it("answers for a short text", () => {
    const validator = new Validator(schema);
    expect(validator.check(holding(short))).toBe(false);
    expect(validator.issues(holding(short))).toHaveLength(1);
    expect(validator.check(holding(other))).toBe(true);
    expect(validator.issues(holding(other))).toEqual([]);
  });

  it.each(Object.keys(methods))(
    "%s() throws a RangeError for a long text",
    name => {
      const validator = new Validator(schema);
      expect(() => methods[name](validator, holding(long))).toThrow(RangeError);
      // The validator still answers afterwards.
      expect(validator.check(holding(short))).toBe(false);
      expect(validator.check(holding(other))).toBe(true);
    },
    60_000,
  );
});

it("a long text has no answer the second time either", () => {
  const validator = new Validator({ not: { pattern } });
  expect(() => validator.check(long)).toThrow(RangeError);
  expect(() => validator.check(long)).toThrow(RangeError);
}, 60_000);

describe("an array of texts that each take too many steps", () => {
  const schema = { type: "array", items: { type: "string", pattern: "^(a+)+$" } };
  const texts = Array.from({ length: 16 }, (_, index) => "a".repeat(40) + "!" + index);

  it.each(Object.keys(methods))(
    "%s() stops at the first one",
    name => {
      expect(() => methods[name](new Validator(schema), texts)).toThrow(RangeError);
    },
    60_000,
  );
});
