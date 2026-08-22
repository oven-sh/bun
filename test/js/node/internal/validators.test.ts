import { exposedInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// The same functions node's lib/internal/validators.js exports, backed by
// src/jsc/bindings/NodeValidator.cpp. Expected messages are node v26.3.0's.
const { validateArray } = exposedInternals["internal/validators"];

describe("validateArray", () => {
  test("accepts arrays that satisfy minLength", () => {
    expect(() => validateArray([], "foo")).not.toThrow();
    expect(() => validateArray([], "foo", 0)).not.toThrow();
    expect(() => validateArray([1], "foo", 1)).not.toThrow();
  });

  test("array shorter than minLength: argument name", () => {
    expect(() => validateArray([], "foo", 1)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
        message: "The argument 'foo' must have a length of at least 1. Received []",
      }),
    );
  });

  test("array shorter than minLength: dotted name is a property", () => {
    expect(() => validateArray([1], "options.foo", 2)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
        message: "The property 'options.foo' must have a length of at least 2. Received [ 1 ]",
      }),
    );
  });

  test("non-array", () => {
    expect(() => validateArray("x", "foo", 1)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "foo" argument must be an instance of Array. Received type string ('x')`,
      }),
    );
  });
});
