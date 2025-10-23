// Regression test for GitHub Issue #21257
// https://github.com/oven-sh/bun/issues/21257
// `Response.json()` should throw with top level value of `function` `symbol` `undefined` (node compatibility)

import { expect, test } from "bun:test";

test("Response.json() throws TypeError for non-JSON serializable top-level values", () => {
  // These should throw "Value is not JSON serializable"
  expect(() => Response.json(Symbol("test"))).toThrow("Value is not JSON serializable");
  expect(() => Response.json(function testFunc() {})).toThrow("Value is not JSON serializable");
  expect(() => Response.json(undefined)).toThrow("Value is not JSON serializable");
});

test("Response.json() works correctly with valid values", () => {
  // These should not throw
  expect(() => Response.json(null)).not.toThrow();
  expect(() => Response.json({})).not.toThrow();
  expect(() => Response.json("string")).not.toThrow();
  expect(() => Response.json(123)).not.toThrow();
  expect(() => Response.json(true)).not.toThrow();
  expect(() => Response.json([1, 2, 3])).not.toThrow();

  // Objects containing non-serializable values should not throw at top-level
  expect(() => Response.json({ symbol: Symbol("test") })).not.toThrow();
  expect(() => Response.json({ func: function () {} })).not.toThrow();
  expect(() => Response.json({ undef: undefined })).not.toThrow();
});

test("Response.json() BigInt error matches Node.js", () => {
  // BigInt should throw with Node.js compatible error message
  expect(() => Response.json(123n)).toThrow("Do not know how to serialize a BigInt");
});
