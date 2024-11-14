//#FILE: test-whatwg-url-canparse.js
//#SHA1: 23d2ea01c951bea491747284dca1abaa17596ff1
//-----------------
"use strict";

const { URL } = require("url");

// Note: We're not using internal bindings as per your instructions
// Instead, we'll mock the canParse function

// Mock the canParse function
const canParse = jest.fn((url, base) => {
  try {
    new URL(url, base);
    return true;
  } catch {
    return false;
  }
});

describe("URL.canParse", () => {
  test("should not throw when called without a base string", () => {
    expect(() => URL.canParse("https://example.org")).not.toThrow();
    expect(URL.canParse("https://example.org")).toBe(true);
    expect(canParse("https://example.org")).toBe(true);
  });

  test("should correctly parse URL with base", () => {
    // This for-loop is used to test V8 Fast API optimizations
    for (let i = 0; i < 100000; i++) {
      // This example is used because only parsing the first parameter
      // results in an invalid URL. They have to be used together to
      // produce truthy value.
      expect(URL.canParse("/", "http://n")).toBe(true);
    }
  });
});

//<#END_FILE: test-whatwg-url-canparse.js
