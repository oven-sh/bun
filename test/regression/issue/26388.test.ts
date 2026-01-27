import { afterEach, describe, expect, test } from "bun:test";

// Issue #26388: process.env should coerce values to strings like Node.js does
// When assigning undefined, null, numbers, or objects to process.env properties,
// Node.js converts them to strings, but Bun was storing the actual JavaScript values.

// List of test environment variable keys used in this test file
const TEST_ENV_KEYS = [
  "TEST_UNDEFINED",
  "TEST_JSON_UNDEFINED",
  "TEST_NULL",
  "TEST_NUMBER",
  "TEST_TRUE",
  "TEST_FALSE",
  "TEST_OBJECT",
  "TEST_ARRAY",
  "TEST_STRING",
  "TEST_EMPTY",
  "TEST_CUSTOM_TOSTRING",
  "TEST_SYMBOL",
  "TEST_OVERWRITE",
];

describe("process.env string coercion", () => {
  // Clean up any test environment variables after each test to prevent leakage
  afterEach(() => {
    for (const key of TEST_ENV_KEYS) {
      delete process.env[key];
    }
  });
  test("undefined is coerced to 'undefined' string", () => {
    process.env.TEST_UNDEFINED = undefined as unknown as string;
    expect(process.env.TEST_UNDEFINED).toBe("undefined");
    expect(typeof process.env.TEST_UNDEFINED).toBe("string");
    delete process.env.TEST_UNDEFINED;
  });

  test("JSON.stringify(undefined) is coerced to 'undefined' string", () => {
    // JSON.stringify(undefined) returns undefined (not the string "undefined")
    // This is the exact case that breaks Vite 8 + rolldown
    process.env.TEST_JSON_UNDEFINED = JSON.stringify(undefined) as unknown as string;
    expect(process.env.TEST_JSON_UNDEFINED).toBe("undefined");
    expect(typeof process.env.TEST_JSON_UNDEFINED).toBe("string");
    delete process.env.TEST_JSON_UNDEFINED;
  });

  test("null is coerced to 'null' string", () => {
    process.env.TEST_NULL = null as unknown as string;
    expect(process.env.TEST_NULL).toBe("null");
    expect(typeof process.env.TEST_NULL).toBe("string");
    delete process.env.TEST_NULL;
  });

  test("number is coerced to string", () => {
    process.env.TEST_NUMBER = 123 as unknown as string;
    expect(process.env.TEST_NUMBER).toBe("123");
    expect(typeof process.env.TEST_NUMBER).toBe("string");
    delete process.env.TEST_NUMBER;
  });

  test("boolean true is coerced to 'true' string", () => {
    process.env.TEST_TRUE = true as unknown as string;
    expect(process.env.TEST_TRUE).toBe("true");
    expect(typeof process.env.TEST_TRUE).toBe("string");
    delete process.env.TEST_TRUE;
  });

  test("boolean false is coerced to 'false' string", () => {
    process.env.TEST_FALSE = false as unknown as string;
    expect(process.env.TEST_FALSE).toBe("false");
    expect(typeof process.env.TEST_FALSE).toBe("string");
    delete process.env.TEST_FALSE;
  });

  test("object is coerced to '[object Object]' string", () => {
    process.env.TEST_OBJECT = { foo: "bar" } as unknown as string;
    expect(process.env.TEST_OBJECT).toBe("[object Object]");
    expect(typeof process.env.TEST_OBJECT).toBe("string");
    delete process.env.TEST_OBJECT;
  });

  test("array is coerced to comma-separated string", () => {
    process.env.TEST_ARRAY = [1, 2, 3] as unknown as string;
    expect(process.env.TEST_ARRAY).toBe("1,2,3");
    expect(typeof process.env.TEST_ARRAY).toBe("string");
    delete process.env.TEST_ARRAY;
  });

  test("string stays as string", () => {
    process.env.TEST_STRING = "hello";
    expect(process.env.TEST_STRING).toBe("hello");
    expect(typeof process.env.TEST_STRING).toBe("string");
    delete process.env.TEST_STRING;
  });

  test("empty string stays as empty string", () => {
    process.env.TEST_EMPTY = "";
    expect(process.env.TEST_EMPTY).toBe("");
    expect(typeof process.env.TEST_EMPTY).toBe("string");
    delete process.env.TEST_EMPTY;
  });

  test("object with custom toString() uses it", () => {
    const obj = {
      toString() {
        return "custom-string";
      },
    };
    process.env.TEST_CUSTOM_TOSTRING = obj as unknown as string;
    expect(process.env.TEST_CUSTOM_TOSTRING).toBe("custom-string");
    expect(typeof process.env.TEST_CUSTOM_TOSTRING).toBe("string");
    delete process.env.TEST_CUSTOM_TOSTRING;
  });

  test("Symbol throws TypeError", () => {
    // Node.js throws: "Cannot convert a Symbol value to a string"
    expect(() => {
      process.env.TEST_SYMBOL = Symbol("test") as unknown as string;
    }).toThrow();
  });

  test("overwriting existing env var coerces to string", () => {
    process.env.TEST_OVERWRITE = "initial";
    expect(process.env.TEST_OVERWRITE).toBe("initial");

    process.env.TEST_OVERWRITE = 456 as unknown as string;
    expect(process.env.TEST_OVERWRITE).toBe("456");
    expect(typeof process.env.TEST_OVERWRITE).toBe("string");
    delete process.env.TEST_OVERWRITE;
  });
});
