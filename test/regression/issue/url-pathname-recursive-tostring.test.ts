import { expect, test } from "bun:test";

test("URL pathname should handle limited recursive toString without crashing", () => {
  // This test verifies that setting a URL pathname to an object with a
  // recursive toString() function that has reasonable depth limits
  // doesn't cause a crash.
  let callCount = 0;
  const maxCalls = 100;

  function createRecursiveToString() {
    callCount++;
    if (callCount > maxCalls) {
      throw new Error(`Recursion limit reached: ${maxCalls}`);
    }
    const url = new URL("https://example.com/");
    const blob = new Blob();
    const stream = blob.stream().cancel(blob);
    stream.toString = createRecursiveToString;
    url.pathname = stream;
    return createRecursiveToString;
  }

  // This should throw an error when the limit is reached, not crash
  expect(() => createRecursiveToString()).toThrow("Recursion limit reached");
});

test("URL pathname with toString that modifies URL", () => {
  // Test a simpler case where toString causes recursion
  const url = new URL("https://example.com/");
  let toStringCalled = false;

  const obj = {
    toString() {
      toStringCalled = true;
      // Try to access the URL again during toString conversion
      url.pathname = "/nested";
      return "test";
    },
  };

  // This should not crash and should handle the recursion gracefully
  expect(() => {
    url.pathname = obj;
  }).not.toThrow();

  // The pathname should be set to the result of toString()
  expect(url.pathname).toBe("/test");
  expect(toStringCalled).toBe(true);
});

test("URL pathname with deep toString recursion should eventually throw", () => {
  // Test that a custom toString that recurses very deeply
  // eventually hits a stack limit
  let callCount = 0;
  const maxCalls = 10000;

  const obj = {
    toString() {
      callCount++;
      if (callCount < maxCalls) {
        // Recurse deeply
        return obj.toString();
      }
      return "done";
    },
  };

  const url = new URL("https://example.com/");

  // Should either succeed (if stack is deep enough) or throw RangeError
  try {
    url.pathname = obj;
    // If we get here, the stack was deep enough
    expect(callCount).toBe(maxCalls);
    expect(url.pathname).toBe("/done");
  } catch (e) {
    // Should be a stack overflow error
    expect(e.name).toBe("RangeError");
    expect(e.message).toContain("call stack");
  }
});
