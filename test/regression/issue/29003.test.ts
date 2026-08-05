import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/29003

// Regression guards for dangling-hyphen forms that already error in /v.
// Keeping these live catches any future regression in the existing rejects.
test("issue #29003 - already-rejected /v dangling hyphens stay rejected", () => {
  expect(() => new RegExp("[-a]", "v")).toThrow(SyntaxError);
  expect(() => new RegExp("[-]", "v")).toThrow(SyntaxError);
});

// Sanity: valid /v patterns must still parse.
test("issue #29003 - valid /v patterns still parse", () => {
  expect(new RegExp("[a-z]", "v").test("m")).toBe(true);
  expect(new RegExp("[a\\-]", "v").test("-")).toBe(true);
  expect(new RegExp("[\\-a]", "v").test("-")).toBe(true);
  expect(new RegExp("[a--b]", "v").test("a")).toBe(true);
  expect(new RegExp("[a&&b]", "v").test("a")).toBe(false);
  expect(new RegExp("[\\w--\\d]", "v").test("a")).toBe(true);
});

// Pending: these all need the JSC parser fix in oven-sh/WebKit#180. The
// bun-side change is a WEBKIT_VERSION bump in cmake/tools/SetupWebKit.cmake
// after that WebKit PR lands and an autobuild tarball is published. Flip
// to `test(...)` in the same commit as the bump.
test.todo("issue #29003 - /[a-]/v throws SyntaxError", () => {
  expect(() => new RegExp("[a-]", "v")).toThrow(SyntaxError);
  expect(() => eval("/[a-]/v")).toThrow(SyntaxError);
});

test.todo("issue #29003 - other dangling hyphen forms in /v mode also throw", () => {
  expect(() => new RegExp("[\\d-]", "v")).toThrow(SyntaxError);
  expect(() => new RegExp("[\\w-]", "v")).toThrow(SyntaxError);
  expect(() => new RegExp("[a-z\\d-]", "v")).toThrow(SyntaxError);
});
