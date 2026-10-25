// check(), issues(), validate(), parse() and ["~standard"].validate() of one validator give the same verdict.
import { describe, expect, test } from "bun:test";

const Validator = (Bun as any).Validator as new (schema: unknown) => any;
const it = test.todoIf(typeof Validator !== "function");

/** Whether the call returns. What it throws has to be a TypeError with a list of issues. */
function returns(call: () => unknown): boolean {
  try {
    call();
    return true;
  } catch (error: any) {
    expect(error).toBeInstanceOf(TypeError);
    expect(error.issues.length).toBeGreaterThan(0);
    return false;
  }
}

function verdictsByValue(validator: any, value: unknown) {
  return {
    check: validator.check(value),
    issues: validator.issues(value).length === 0,
    validate: returns(() => validator.validate(value)),
    "~standard": validator["~standard"].validate(value).issues === undefined,
  };
}
const verdicts = (validator: any, text: string) => ({
  ...verdictsByValue(validator, JSON.parse(text)),
  parse: returns(() => validator.parse(text)),
});
const all = (isValid: boolean) => ({ check: isValid, issues: isValid, validate: isValid, "~standard": isValid });

// JSON.parse() turns 1e999 into Infinity, which no schema but {} and true accepts. These keywords turn the answer of a schema below them round.
describe.each<[string, unknown, { valid: string[]; invalid: string[] }]>([
  [
    "not",
    { type: "object", not: { required: ["level"], properties: { level: { type: "number" } } } },
    { valid: ["{}", '{"level":"high"}'], invalid: ['{"level":7}', '{"level":1e999}', '{"level":-1e999}'] },
  ],
  [
    "if",
    {
      type: "object",
      if: { required: ["amount"], properties: { amount: { type: "number" } } },
      then: { properties: { amount: { maximum: 100 } } },
    },
    { valid: ["{}", '{"amount":100}', '{"amount":"all"}'], invalid: ['{"amount":101}', '{"amount":1e999}'] },
  ],
  [
    "contains with maxContains: 0",
    { type: "array", contains: { type: "number" }, minContains: 0, maxContains: 0 },
    { valid: ["[]", '["a"]'], invalid: ["[1]", "[1e999]"] },
  ],
  [
    "oneOf over arrays",
    { oneOf: [{ items: { type: "number" } }, {}] },
    { valid: ['["a"]'], invalid: ["[1]", "[1e999]"] },
  ],
  [
    "oneOf over types",
    { oneOf: [{ type: "number" }, { type: ["number", "string"] }] },
    { valid: ['"a"'], invalid: ["1", "1e999", "null"] },
  ],
  [
    "anyOf with not",
    { anyOf: [{ type: "string" }, { not: { type: "integer" } }] },
    { valid: ['"a"', "1.5", "null"], invalid: ["1", "1e999"] },
  ],
  [
    "dependentSchemas with not",
    { type: "object", dependentSchemas: { guest: { not: { required: ["role"] } } } },
    { valid: ["{}", '{"guest":1}', '{"role":1}'], invalid: ['{"guest":1,"role":1}', '{"guest":1,"role":1e999}'] },
  ],
  [
    "not with uniqueItems",
    { type: "array", not: { uniqueItems: true } },
    { valid: ["[1,1]"], invalid: ["[]", "[1,2]", "[1e999,2e999]"] },
  ],
])("%s", (_, schema, { valid, invalid }) => {
  it.each(valid)("accepts %s", text => {
    expect(verdicts(new Validator(schema), text)).toEqual({ ...all(true), parse: true });
  });
  it.each(invalid)("rejects %s", text => {
    expect(verdicts(new Validator(schema), text)).toEqual({ ...all(false), parse: false });
  });
});

describe("a Proxy around an object that doesn't match", () => {
  const withNumber = { type: "object", properties: { kind: { const: "number" }, value: { type: "number" } } };
  const withString = { type: "object", properties: { kind: { const: "string" }, value: { type: "string" } } };
  const required = ["kind", "value"];

  it.each(["oneOf", "anyOf"])("is rejected under %s", keyword => {
    const validator = new Validator({
      [keyword]: [
        { ...withNumber, required },
        { ...withString, required },
      ],
    });
    expect(verdictsByValue(validator, { kind: "number", value: "one" })).toEqual(all(false));
    expect(verdictsByValue(validator, new Proxy({ kind: "number", value: "one" }, {}))).toEqual(all(false));
  });
});

describe("a revoked Proxy", () => {
  function revokedProxy(target: object) {
    const { proxy, revoke } = Proxy.revocable(target, {});
    revoke();
    return proxy;
  }

  it.each<[string, unknown]>([
    ["{}", {}],
    ["true", true],
  ])("is accepted by %s, which doesn't look at it", (_, schema) => {
    const validator = new Validator(schema);
    const proxy = revokedProxy({});
    expect(verdictsByValue(validator, proxy)).toEqual(all(true));
    expect(validator.validate(proxy)).toBe(proxy);
  });

  it("is accepted in a property whose schema is {}", () => {
    const validator = new Validator({ type: "object", properties: { x: {} }, required: ["x"] });
    const proxy = revokedProxy([]);
    expect(verdictsByValue(validator, { x: proxy })).toEqual(all(true));
    expect(validator.validate({ x: proxy }).x).toBe(proxy);
  });

  it.each<[string, unknown, object]>([
    ["an object", { type: "object" }, {}],
    ["an array", { type: "array" }, []],
    ["an object with properties", { type: "object", properties: { a: { type: "number" } } }, { a: 1 }],
  ])("doesn't match a schema for %s, and check() returns false", (_, schema, target) => {
    const validator = new Validator(schema);
    expect(validator.check(revokedProxy(target))).toBe(false);
    expect(() => validator.validate(revokedProxy(target))).toThrow(TypeError);
  });
});
