import { expect, test } from "bun:test";

test("Error.prepareStackTrace should not crash when stacktrace parameter is not an array", () => {
  const e = new Error("test message");
  try {
    // Test with undefined as second argument (Node errors with 'TypeError: Cannot read properties of undefined' in this case)
    const result = Error.prepareStackTrace(e);
  } catch (e) {}
  try {
    // Test with null as second argument (Node errors with 'TypeError: Cannot read properties of null' in this case)
    const result = Error.prepareStackTrace(e, null);
  } catch (e) {}
  {
    // Test with number as second argument (Node does the equivalent of Error.prepareStackTrace(e, [""]) in this case)
    const result = Error.prepareStackTrace(e, 123);
    expect(typeof result).toBe("string");
  }
  {
    // Test with string as second argument (Node does the equivalent of Error.prepareStackTrace(e, [""]) in this case)
    const result = Error.prepareStackTrace(e, "not an array");
    expect(typeof result).toBe("string");
  }
  {
    // Test with object as second argument (Node does the equivalent of Error.prepareStackTrace(e, [""]) in this case)
    const result = Error.prepareStackTrace(e, {});
    expect(typeof result).toBe("string");
  }
});

test("Error.prepareStackTrace should work with empty message", () => {
  const e = new Error("");

  const result = Error.prepareStackTrace(e);
  expect(typeof result).toBe("string");
  expect(result).toBe("Error");
});

test("Error.prepareStackTrace should work with no message", () => {
  const e = new Error();

  const result = Error.prepareStackTrace(e);
  expect(typeof result).toBe("string");
  expect(result).toBe("Error");
});
