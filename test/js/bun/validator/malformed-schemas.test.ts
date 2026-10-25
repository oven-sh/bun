// `new Bun.Validator(schema)` takes any value. What isn't a JSON Schema that it supports throws a TypeError that names the place, quickly.
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";

const Validator = (Bun as any).Validator as new (schema?: unknown, options?: unknown) => any;
const it = test.todoIf(typeof Validator !== "function");
const limit = isDebug || isASAN ? 10_000 : 1_000;

/** Creates the validator and returns what it threw. Fails when it throws nothing or takes too long. */
function errorOf(schema: unknown, ...options: unknown[]): Error {
  const start = performance.now();
  let error: unknown;
  try {
    new Validator(schema, ...options);
  } catch (thrown) {
    error = thrown;
  }
  expect(performance.now() - start).toBeLessThan(limit);
  expect(error).toBeInstanceOf(TypeError);
  return error as Error;
}

/** `levels` objects, each inside the one before it. `wrap` puts a schema inside a new one. */
function nest(levels: number, wrap: (inner: unknown) => unknown) {
  let schema: unknown = {};
  for (let i = 0; i < levels; i++) schema = wrap(schema);
  return schema;
}

describe("a schema is an object or a boolean", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 1],
    ["NaN", NaN],
    ["a string", "string"],
    ["an empty string", ""],
    ["a bigint", 1n],
    ["a symbol", Symbol("schema")],
    ["a function", () => ({})],
    ["a class", class {}],
    ["an array", []],
    ["an array of schemas", [{ type: "string" }]],
    ["a Date", new Date(0)],
    ["a Map", new Map([["type", "string"]])],
    ["a RegExp", /a/],
    ["an Error", new Error("a")],
    ["an instance of a class", new (class { type = "string"; })()], // prettier-ignore
    ["an object that inherits from another", Object.create({ type: "string" })],
  ])("rejects %s", (_, schema) => {
    expect(errorOf(schema).message).toBe("Expected schema to be an object or a boolean");
  });

  it("rejects a call without arguments", () => {
    expect(() => new Validator()).toThrow(new TypeError("Expected schema to be an object or a boolean"));
  });

  it("rejects a call without new", () => {
    expect(() => (Validator as any)({})).toThrow(TypeError);
  });

  it("takes true, false and {}", () => {
    expect(new Validator(true).check(1)).toBe(true);
    expect(new Validator({}).check(1)).toBe(true);
    expect(new Validator(false).check(1)).toBe(false);
  });

  it("takes a frozen object and an object without a prototype", () => {
    expect(new Validator(Object.freeze({ type: "string" })).check(1)).toBe(false);
    expect(new Validator(Object.assign(Object.create(null), { type: "string" })).check(1)).toBe(false);
  });
});

// [the schema, the place that the message names]
const wrongTypes: [unknown, string][] = [
  [{ type: 1 }, "type"],
  [{ type: null }, "type"],
  [{ type: "strin" }, "type"],
  [{ type: "String" }, "type"],
  [{ type: "undefined" }, "type"],
  [{ type: {} }, "type"],
  [{ type: ["string", 1] }, "type[1]"],
  [{ type: ["string", "nope"] }, "type[1]"],
  [{ enum: 1 }, "enum"],
  [{ enum: {} }, "enum"],
  [{ enum: "a" }, "enum"],
  [{ const: 1n }, "const"],
  [{ const: Symbol("a") }, "const"],
  [{ const: () => 1 }, "const"],
  [{ const: NaN }, "const"],
  [{ const: [Infinity] }, "const[0]"],
  [{ enum: [1, undefined] }, "enum[1]"],
  [{ enum: [{ a: 1n }] }, "enum[0].a"],
  [{ minimum: "1" }, "minimum"],
  [{ minimum: NaN }, "minimum"],
  [{ maximum: null }, "maximum"],
  [{ maximum: Infinity }, "maximum"],
  [{ exclusiveMinimum: [] }, "exclusiveMinimum"],
  [{ exclusiveMaximum: {} }, "exclusiveMaximum"],
  [{ multipleOf: "2" }, "multipleOf"],
  [{ multipleOf: 0 }, "multipleOf"],
  [{ multipleOf: -1 }, "multipleOf"],
  [{ minLength: "1" }, "minLength"],
  [{ minLength: -1 }, "minLength"],
  [{ minLength: 1.5 }, "minLength"],
  [{ maxLength: null }, "maxLength"],
  [{ maxLength: -1 }, "maxLength"],
  [{ pattern: 1 }, "pattern"],
  [{ pattern: /a/ }, "pattern"],
  [{ pattern: null }, "pattern"],
  [{ pattern: "(" }, "pattern"],
  [{ pattern: "[" }, "pattern"],
  [{ pattern: "\\" }, "pattern"],
  [{ format: 1 }, "format"],
  [{ format: ["email"] }, "format"],
  [{ items: 1 }, "items"],
  [{ items: "string" }, "items"],
  [{ items: null }, "items"],
  [{ prefixItems: {} }, "prefixItems"],
  [{ prefixItems: 1 }, "prefixItems"],
  [{ prefixItems: [1] }, "prefixItems[0]"],
  [{ minItems: "1" }, "minItems"],
  [{ minItems: -1 }, "minItems"],
  [{ maxItems: 0.5 }, "maxItems"],
  [{ uniqueItems: 1 }, "uniqueItems"],
  [{ uniqueItems: "true" }, "uniqueItems"],
  [{ contains: 1 }, "contains"],
  [{ contains: {}, minContains: -1 }, "minContains"],
  [{ contains: {}, maxContains: "1" }, "maxContains"],
  [{ properties: 1 }, "properties"],
  [{ properties: [] }, "properties"],
  [{ properties: null }, "properties"],
  [{ properties: { a: 1 } }, "properties.a"],
  [{ properties: { a: "string" } }, "properties.a"],
  [{ properties: { a: null } }, "properties.a"],
  [{ properties: { a: [] } }, "properties.a"],
  [{ properties: { "a b": 1 } }, 'properties["a b"]'],
  [{ properties: { a: { pattern: 1 } } }, "properties.a.pattern"],
  [{ properties: { a: { properties: { b: { type: 1 } } } } }, "properties.a.properties.b.type"],
  [{ required: "a" }, "required"],
  [{ required: {} }, "required"],
  [{ required: true }, "required"],
  [{ required: ["a", 1] }, "required[1]"],
  [{ required: [null] }, "required[0]"],
  [{ additionalProperties: 1 }, "additionalProperties"],
  [{ additionalProperties: "false" }, "additionalProperties"],
  [{ additionalProperties: null }, "additionalProperties"],
  [{ patternProperties: 1 }, "patternProperties"],
  [{ patternProperties: [] }, "patternProperties"],
  [{ patternProperties: { a: 1 } }, "patternProperties.a"],
  [{ patternProperties: { "(": {} } }, "every key of patternProperties"],
  [{ propertyNames: 1 }, "propertyNames"],
  [{ minProperties: -1 }, "minProperties"],
  [{ maxProperties: "1" }, "maxProperties"],
  [{ dependentRequired: 1 }, "dependentRequired"],
  [{ dependentRequired: { a: "b" } }, "dependentRequired.a"],
  [{ dependentRequired: { a: [1] } }, "dependentRequired.a[0]"],
  [{ dependentSchemas: [] }, "dependentSchemas"],
  [{ dependentSchemas: { a: 1 } }, "dependentSchemas.a"],
  [{ anyOf: {} }, "anyOf"],
  [{ anyOf: 1 }, "anyOf"],
  [{ anyOf: [] }, "anyOf"],
  [{ anyOf: [1] }, "anyOf[0]"],
  [{ anyOf: [{}, null] }, "anyOf[1]"],
  [{ anyOf: [{}, { type: 1 }] }, "anyOf[1].type"],
  [{ oneOf: {} }, "oneOf"],
  [{ oneOf: [] }, "oneOf"],
  [{ allOf: "a" }, "allOf"],
  [{ allOf: [] }, "allOf"],
  [{ not: 1 }, "not"],
  [{ not: null }, "not"],
  [{ if: 1 }, "if"],
  [{ if: {}, then: 1 }, "then"],
  [{ if: {}, else: "a" }, "else"],
  [{ $ref: "#/$defs/a", $defs: { a: 1 } }, "$defs.a"],
  [{ $ref: "#/$defs/a", $defs: { a: { type: 1 } } }, "$defs.a.type"],
  [{ $ref: 1 }, "$ref"],
  [{ $ref: {} }, "$ref"],
  [{ title: 1 }, "title"],
  [{ "x-bun": 1 }, '["x-bun"]'],
  [{ "x-bun": [] }, '["x-bun"]'],
  [{ "x-bun": null }, '["x-bun"]'],
  [{ "x-bun": { type: 1 } }, '["x-bun"].type'],
  [{ "x-bun": { type: "string" } }, '["x-bun"].type'],
  [{ "x-bun": { pattern: 1 } }, '["x-bun"].pattern'],
  [{ "x-bun": { pattern: "(" } }, '["x-bun"].pattern'],
  [{ "x-bun": { message: 1 } }, '["x-bun"].message'],
  [{ "x-bun": { default: {} } }, '["x-bun"].default'],
  [{ "x-bun": { default: [] } }, '["x-bun"].default'],
  [{ "x-bun": { source: 1 } }, '["x-bun"].source'],
  [{ "x-bun": { source: "javascript" } }, '["x-bun"].source'],
  [{ "x-bun": { template: 1 } }, '["x-bun"].template'],
  [{ "x-bun": { template: { texts: 1, placeholders: [] } } }, '["x-bun"].template.texts'],
  [{ "x-bun": { template: { texts: [1, "b"], placeholders: ["number"] } } }, '["x-bun"].template.texts[0]'],
  [{ "x-bun": { template: { texts: ["a", "b"], placeholders: 1 } } }, '["x-bun"].template.placeholders'],
  [{ "x-bun": { template: { texts: ["a", "b"], placeholders: ["object"] } } }, '["x-bun"].template.placeholders[0]'],
];

// The same for definitions that nothing refers to.
const unusedDefinitions: [unknown, string][] = [
  [{ $defs: 1 }, "$defs"],
  [{ $defs: [] }, "$defs"],
  [{ $defs: { a: 1 } }, "$defs.a"],
  [{ $defs: { a: { type: 1 } } }, "$defs.a.type"],
];
const named = (rows: [unknown, string][]) =>
  rows.map(([schema, place]) => [Bun.inspect(schema).replace(/\s+/g, " "), schema, place] as const);

describe("a keyword with a value of the wrong type", () => {
  it.each(named(wrongTypes))("%s", (_, schema, place) => {
    expect(errorOf(schema).message).toStartWith(`Expected ${place} to be `);
  });

  test.todo.each(named(unusedDefinitions))("%s", (_, schema, place) => {
    expect(errorOf(schema).message).toStartWith(`Expected ${place} to be `);
  });

  it("says which type it expects", () => {
    expect(errorOf({ pattern: 1 }).message).toBe("Expected pattern to be a string");
    expect(errorOf({ properties: { a: { pattern: 1 } } }).message).toBe("Expected properties.a.pattern to be a string");
  });

  it("rejects a template with as many texts as placeholders", () => {
    const template = { texts: ["a"], placeholders: ["number"] };
    expect(errorOf({ type: "string", "x-bun": { template } }).message).toStartWith('Expected ["x-bun"].template');
  });
});

describe("a keyword that Bun.Validator doesn't have", () => {
  it.each([
    [{ foo: 1 }, "foo"],
    [{ "": 1 }, '[""]'],
    [{ Type: "string" }, "Type"],
    [{ requried: ["a"] }, "requried"],
    [{ additionalproperties: false }, "additionalproperties"],
    [{ "additional-properties": false }, '["additional-properties"]'],
    [{ min: 1 }, "min"],
    [{ optional: true }, "optional"],
    [{ 0: {} }, '["0"]'],
    [{ constructor: {} }, "constructor"],
    [{ toString: {} }, "toString"],
    [JSON.parse('{"__proto__":{}}'), "__proto__"],
    [{ properties: { a: { foo: 1 } } }, "properties.a.foo"],
    [{ items: { foo: 1 } }, "items.foo"],
    [{ anyOf: [{}, { foo: 1 }] }, "anyOf[1].foo"],
    [{ $ref: "#/$defs/a", $defs: { a: { foo: 1 } } }, "$defs.a.foo"],
    [{ properties: { "a b": { foo: 1 } } }, 'properties["a b"].foo'],
    [{ "x-bun": { foo: 1 } }, '["x-bun"].foo'],
    [{ "x-bun": { template: { texts: [""], placeholders: [], foo: 1 } } }, '["x-bun"].template.foo'],
    [{ "X-other": {} }, '["X-other"]'],
  ])("%j", (schema, place) => {
    expect(errorOf(schema).message).toBe(`Unknown keyword: ${place}`);
  });

  test.todo("a keyword in a definition that nothing refers to", () => {
    expect(errorOf({ $defs: { a: { foo: 1 } } }).message).toBe("Unknown keyword: $defs.a.foo");
  });

  it.each([
    [{ unevaluatedProperties: false }, "unevaluatedProperties"],
    [{ unevaluatedItems: false }, "unevaluatedItems"],
    [{ $dynamicRef: "#a", $defs: { a: { $dynamicAnchor: "a" } } }, "$dynamicRef"],
  ])("%j", (schema, keyword) => {
    expect(errorOf(schema).message).toBe(`Unsupported keyword: ${keyword}`);
  });

  it("takes keywords that only describe the schema, and other keywords that start with x-", () => {
    const schema = {
      type: "string",
      description: "a",
      $comment: "b",
      examples: ["c"],
      deprecated: true,
      "x-other": {},
    };
    expect(new Validator(schema).check("a")).toBe(true);
    expect(new Validator(schema).check(1)).toBe(false);
  });

  it("ignores keys that are symbols and keys that aren't enumerable", () => {
    const schema = Object.defineProperty({ type: "string", [Symbol("foo")]: 1 }, "foo", {
      value: 1,
      enumerable: false,
    });
    expect(new Validator(schema).check("a")).toBe(true);
    expect(new Validator(schema).check(1)).toBe(false);
  });
});

describe("options", () => {
  it.each([1, "a", true, 1n, Symbol("a")])("rejects %p", options => {
    expect(errorOf({}, options).message).toStartWith("Expected options to be ");
  });

  it("rejects an option that it doesn't have", () => {
    expect(errorOf({}, { foo: 1 }).message).toBe("Unknown option: foo");
  });

  it("takes undefined and {}", () => {
    expect(new Validator({}, undefined).check(1)).toBe(true);
    expect(new Validator({}, {}).check(1)).toBe(true);
  });
});

describe("references", () => {
  it.each([
    { $ref: "#/$defs/a" },
    { $ref: "#/$defs/a", $defs: {} },
    { $ref: "#/$defs/a/b", $defs: { a: {} } },
    { $ref: "#/properties/a" },
    { $ref: "#a" },
    { $ref: "other.json" },
    { $ref: "https://example.com/schema.json" },
    { $ref: "#/$defs/%" },
    { $ref: "#/type", type: "string" },
    { $ref: "#/required/0", required: ["a"] },
    { properties: { a: { $ref: "#/$defs/a" } } },
  ])("rejects %j, which leads to no schema", schema => {
    errorOf(schema);
  });

  // Nothing is ever decided by following these, so either the constructor throws or every value gets an answer.
  it.each([
    { $ref: "#" },
    { $ref: "#/$defs/a", $defs: { a: { $ref: "#/$defs/a" } } },
    { $ref: "#/$defs/a", $defs: { a: { $ref: "#/$defs/b" }, b: { $ref: "#/$defs/a" } } },
    { allOf: [{ $ref: "#" }] },
    { anyOf: [{ $ref: "#" }, { $ref: "#" }] },
    { not: { $ref: "#" } },
    { if: { $ref: "#" }, then: { $ref: "#" }, else: { $ref: "#" } },
  ])("%j ends", schema => {
    const start = performance.now();
    let validator;
    try {
      validator = new Validator(schema);
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
    }
    if (validator) {
      for (const value of [1, "a", null, {}, []]) {
        try {
          expect(validator.check(value)).toBeBoolean();
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }
    }
    expect(performance.now() - start).toBeLessThan(limit);
  });
});

describe("a schema that holds itself", () => {
  const cycles: Record<string, () => unknown> = {
    not: () => {
      const schema: any = {};
      return (schema.not = schema);
    },
    items: () => {
      const schema: any = { type: "array" };
      return (schema.items = schema);
    },
    properties: () => {
      const schema: any = { type: "object", properties: {} };
      return (schema.properties.next = schema);
    },
    anyOf: () => {
      const schema: any = { anyOf: [{ type: "null" }] };
      schema.anyOf.push(schema);
      return schema;
    },
    $defs: () => {
      const schema: any = { $defs: {} };
      return (schema.$defs.a = schema);
    },
    "two schemas that hold each other": () => {
      const first: any = {};
      const second: any = { not: first };
      first.not = second;
      return first;
    },
    "an array in enum": () => {
      const list: unknown[] = [];
      list.push(list);
      return { enum: list };
    },
    "an object in const": () => {
      const value: any = {};
      value.self = value;
      return { const: value };
    },
    "a cycle far below the root": () => {
      let schema: any = {};
      schema.not = schema;
      for (let i = 0; i < 50; i++) schema = { items: schema };
      return schema;
    },
  };
  it.each(Object.keys(cycles))("%s", name => {
    expect(errorOf(cycles[name]()).message).toBe('Expected schema to have no cycles (use "$ref" for recursion)');
  });

  it("takes one object at two places", () => {
    const name = { type: "string" };
    const validator = new Validator({ type: "object", properties: { first: name, last: name }, required: ["first"] });
    expect(validator.check({ first: "a", last: "b" })).toBe(true);
    expect(validator.check({ first: "a", last: 1 })).toBe(false);
  });
});

describe("a schema that is nested deeply", () => {
  const wraps: Record<string, (inner: unknown) => unknown> = {
    not: not => ({ not }),
    items: items => ({ items }),
    properties: a => ({ properties: { a } }),
    additionalProperties: additionalProperties => ({ additionalProperties }),
    anyOf: inner => ({ anyOf: [inner] }),
    allOf: inner => ({ allOf: [inner] }),
    $defs: a => ({ $defs: { a } }),
    "if and then": then => ({ if: {}, then }),
  };
  it.each(Object.keys(wraps))("%s, 1,000,000 levels", name => {
    expect(errorOf(nest(1_000_000, wraps[name])).message).toBe("Schema is nested too deeply");
  });

  it.each([
    ["arrays in const", (inner: unknown) => [inner]],
    ["objects in const", (a: unknown) => ({ a })],
  ])("%s, 1,000,000 levels", (_, wrap) => {
    expect(errorOf({ const: nest(1_000_000, wrap) }).message).toBe("Schema is nested too deeply");
  });

  it("takes 100 levels", () => {
    const validator = new Validator(nest(100, items => ({ type: "array", items })));
    expect(validator.check(nest(100, inner => [inner]))).toBe(true);
    expect(validator.check(nest(50, inner => [inner]))).toBe(false);
  });
});

describe("a schema that is very large", () => {
  const tooMany = "Too many values in schema (limit 1048576)";
  const tooLarge = "JSON Schema is too large or too deeply nested";

  it("rejects 1,100,000 values in enum", () => {
    expect(errorOf({ enum: new Array(1_100_000).fill(0) }).message).toBe(tooMany);
  });

  it("rejects 1,100,000 names in required", () => {
    expect(errorOf({ required: new Array(1_100_000).fill("a") }).message).toBe(tooMany);
  });

  it("rejects 400,000 properties", () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 400_000; i++) properties["p" + i] = {};
    expect(errorOf({ properties }).message).toBe(tooLarge);
  });

  it("rejects 400,000 schemas in anyOf", () => {
    expect(errorOf({ anyOf: Array.from({ length: 400_000 }, () => ({})) }).message).toBe(tooLarge);
  });

  it("rejects 40 objects that each hold the next one twice", () => {
    expect(errorOf(nest(40, inner => ({ allOf: [inner, inner] }))).message).toBe(tooMany);
    expect(errorOf(nest(40, inner => ({ properties: { a: inner, b: inner } }))).message).toBe(tooMany);
    expect(errorOf({ const: nest(40, inner => [inner, inner]) }).message).toBe(tooMany);
  });

  it("rejects an array with a length of 4,294,967,295 and no elements", () => {
    errorOf({ enum: new Array(4_294_967_295) });
    errorOf({ required: new Array(4_294_967_295) });
    errorOf({ anyOf: new Array(4_294_967_295) });
  });

  it("rejects counts that no array or string reaches", () => {
    for (const keyword of ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]) {
      for (const count of [2 ** 53, 1e308, Number.MAX_VALUE]) {
        const start = performance.now();
        try {
          const validator = new Validator({ [keyword]: count });
          expect(validator.check(keyword.endsWith("Length") ? "a" : keyword.endsWith("Items") ? [1] : { a: 1 })).toBe(
            keyword.startsWith("max"),
          );
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          expect((error as Error).message).toStartWith(`Expected ${keyword} to be `);
        }
        expect(performance.now() - start).toBeLessThan(limit);
      }
    }
  });

  it("takes a string of 10,000,000 characters in const", () => {
    const text = Buffer.alloc(10_000_000, "a").toString();
    const start = performance.now();
    const validator = new Validator({ const: text });
    expect(performance.now() - start).toBeLessThan(limit);
    expect(validator.check(text)).toBe(true);
    expect(validator.check(text.slice(1))).toBe(false);
  });

  it("rejects a pattern of 10,000,000 characters or compiles it quickly", () => {
    const start = performance.now();
    try {
      new Validator({ pattern: Buffer.alloc(10_000_000, "(").toString() });
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
    }
    expect(performance.now() - start).toBeLessThan(limit * 4);
  });
});

describe("a schema with getters", () => {
  it("reads each property once", () => {
    const reads: string[] = [];
    const schema = {
      get type() {
        reads.push("type");
        return reads.length === 1 ? "string" : "number";
      },
      get minLength() {
        reads.push("minLength");
        return 2;
      },
    };
    const validator = new Validator(schema);
    expect(reads).toEqual(["type", "minLength"]);
    expect([validator.check("ab"), validator.check("a"), validator.check(12)]).toEqual([true, false, false]);
    expect(reads).toEqual(["type", "minLength"]);
  });

  it("rejects what a getter returns like any other value", () => {
    expect(errorOf({ get pattern() { return 1; } }).message).toBe("Expected pattern to be a string"); // prettier-ignore
    expect(errorOf({ properties: { get a() { return 1; } } }).message).toStartWith("Expected properties.a to be "); // prettier-ignore
  });

  it("passes on what a getter throws", () => {
    const error = new RangeError("from the getter");
    expect(() => new Validator({ get type() { throw error; } })).toThrow(error); // prettier-ignore
  });

  it("rejects a getter that returns a new schema with the same getter", () => {
    const endless = () => ({
      get not() {
        return endless();
      },
    });
    expect(errorOf(endless()).message).toBe("Schema is nested too deeply");
  });

  it("rejects a getter that returns the schema it belongs to", () => {
    const schema = {
      get not() {
        return schema;
      },
    };
    expect(errorOf(schema).message).toBe('Expected schema to have no cycles (use "$ref" for recursion)');
  });

  it("doesn't see what a getter changes afterwards", () => {
    const schema: any = {
      get type() {
        schema.minLength = 5;
        delete schema.maxLength;
        return "string";
      },
      maxLength: 1,
    };
    const validator = new Validator(schema);
    expect(validator.check(1)).toBe(false);
    Object.defineProperty(schema, "type", { value: "number" });
    expect(validator.check(1)).toBe(false);
  });
});

describe("a proxy is no schema", () => {
  let calls = 0;
  const traps = Object.fromEntries(
    Object.getOwnPropertyNames(Reflect).map(trap => [
      trap,
      (...args: unknown[]) => (calls++, (Reflect as any)[trap](...args)),
    ]),
  );
  const proxy = <T extends object>(target: T) => new Proxy(target, traps);

  it.each<[string, () => unknown, string]>([
    [`proxy({ type: "string" })`, () => proxy({ type: "string" }), "schema"],
    [`proxy([])`, () => proxy([]), "schema"],
    [`{ not: proxy({}) }`, () => ({ not: proxy({}) }), "not"],
    [`{ items: proxy({}) }`, () => ({ items: proxy({}) }), "items"],
    [`{ properties: proxy({}) }`, () => ({ properties: proxy({}) }), "properties"],
    [`{ properties: { a: proxy({}) } }`, () => ({ properties: { a: proxy({}) } }), "properties.a"],
    [`{ anyOf: proxy([{}]) }`, () => ({ anyOf: proxy([{}]) }), "anyOf"],
    [`{ anyOf: [proxy({})] }`, () => ({ anyOf: [proxy({})] }), "anyOf[0]"],
    [`{ required: proxy(["a"]) }`, () => ({ required: proxy(["a"]) }), "required"],
    [`{ enum: proxy([1]) }`, () => ({ enum: proxy([1]) }), "enum"],
    [`{ enum: [proxy({})] }`, () => ({ enum: [proxy({})] }), "enum[0]"],
    [`{ const: proxy({}) }`, () => ({ const: proxy({}) }), "const"],
    [`{ const: { a: [proxy([])] } }`, () => ({ const: { a: [proxy([])] } }), "const.a[0]"],
    [`{ "x-bun": proxy({}) }`, () => ({ "x-bun": proxy({}) }), '["x-bun"]'],
  ])("%s", (_, schema, place) => {
    calls = 0;
    expect(errorOf(schema()).message).toStartWith(`Expected ${place} to be `);
    expect(calls).toBe(0);
  });

  it("rejects a reference into $defs that is a proxy", () => {
    calls = 0;
    errorOf({ $ref: "#/$defs/a", $defs: proxy({ a: {} }) });
    expect(calls).toBe(0);
  });

  it("rejects a revoked proxy", () => {
    for (const target of [{}, []]) {
      const { proxy, revoke } = Proxy.revocable(target, {});
      revoke();
      expect(errorOf(proxy).message).toBe("Expected schema to be an object or a boolean");
      expect(errorOf({ not: proxy }).message).toBe("Expected not to be an object or a boolean");
      expect(errorOf({ enum: proxy }).message).toStartWith("Expected enum to be ");
    }
  });
});
