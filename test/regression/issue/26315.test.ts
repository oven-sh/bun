import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26315
// process.env.hasOwnProperty() throws on Windows because the Windows proxy
// doesn't handle inherited Object.prototype methods

test("process.env.hasOwnProperty works", () => {
  // hasOwnProperty should be a function
  expect(typeof process.env.hasOwnProperty).toBe("function");

  // Use a temporary env var to test hasOwnProperty
  const testKey = "__TEST_HAS_OWN_PROPERTY_26315__";
  const originalValue = process.env[testKey];

  try {
    process.env[testKey] = "test_value";
    // Should return true for existing env vars
    expect(process.env.hasOwnProperty(testKey)).toBe(true);

    delete process.env[testKey];
    // Should return false for non-existent env vars
    expect(process.env.hasOwnProperty(testKey)).toBe(false);
  } finally {
    if (originalValue !== undefined) {
      process.env[testKey] = originalValue;
    } else {
      delete process.env[testKey];
    }
  }
});

test("process.env.propertyIsEnumerable works", () => {
  expect(typeof process.env.propertyIsEnumerable).toBe("function");

  // Use a temporary env var to test propertyIsEnumerable
  const testKey = "__TEST_PROP_IS_ENUM_26315__";
  const originalValue = process.env[testKey];

  try {
    process.env[testKey] = "test_value";
    // Should be enumerable for existing env vars
    expect(process.env.propertyIsEnumerable(testKey)).toBe(true);

    delete process.env[testKey];
    // Non-existent vars should not be enumerable
    expect(process.env.propertyIsEnumerable(testKey)).toBe(false);
  } finally {
    if (originalValue !== undefined) {
      process.env[testKey] = originalValue;
    } else {
      delete process.env[testKey];
    }
  }
});

test("process.env.toString works", () => {
  expect(typeof process.env.toString).toBe("function");
  expect(process.env.toString()).toBe("[object Object]");
});

test("process.env.valueOf works", () => {
  expect(typeof process.env.valueOf).toBe("function");
  // valueOf should return the proxy itself
  expect(process.env.valueOf()).toBe(process.env);
});

test("process.env.isPrototypeOf works", () => {
  expect(typeof process.env.isPrototypeOf).toBe("function");
  expect(process.env.isPrototypeOf({})).toBe(false);
});

test("env var named after Object.prototype method is accessible", () => {
  // If someone sets an env var named "HASOWNPROPERTY", that should be accessible
  // via the uppercase name, while the lowercase still returns the method (like Node.js)
  const originalValue = process.env.HASOWNPROPERTY;

  try {
    process.env.HASOWNPROPERTY = "custom_value";
    // The method is still accessible via lowercase (matching Node.js behavior)
    expect(typeof process.env.hasOwnProperty).toBe("function");
    // The env var is accessible via uppercase
    expect(process.env.HASOWNPROPERTY).toBe("custom_value");
  } finally {
    if (originalValue !== undefined) {
      process.env.HASOWNPROPERTY = originalValue;
    } else {
      delete process.env.HASOWNPROPERTY;
    }
  }
});
