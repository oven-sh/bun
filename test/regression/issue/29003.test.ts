import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/29003
//
// In /v (UnicodeSets) mode, `-` is a ClassSetSyntaxCharacter and is only
// legal between two ClassSetCharacters as part of a ClassSetRange. A
// trailing or dangling `-` (e.g. `/[a-]/v`, `/[\d-]/v`) must be rejected
// as a SyntaxError.

test("issue #29003 - /[a-]/v throws SyntaxError", () => {
  expect(() => new RegExp("[a-]", "v")).toThrow(SyntaxError);
  // Regex literal form too — the parser path is the same but the expression
  // gets routed through a different call site in the transpiler.
  expect(() => eval("/[a-]/v")).toThrow(SyntaxError);
});

test("issue #29003 - other dangling hyphen forms in /v mode also throw", () => {
  // Reported siblings that already errored — kept here to lock them in.
  expect(() => new RegExp("[-a]", "v")).toThrow(SyntaxError);
  expect(() => new RegExp("[-]", "v")).toThrow(SyntaxError);

  // Newly-rejected forms that share the same root cause: a pending `-`
  // with no right-hand ClassSetCharacter when the class/operator/nested
  // class boundary is reached.
  expect(() => new RegExp("[\\d-]", "v")).toThrow(SyntaxError);
  expect(() => new RegExp("[\\w-]", "v")).toThrow(SyntaxError);
  expect(() => new RegExp("[a-z\\d-]", "v")).toThrow(SyntaxError);
});

test("issue #29003 - valid /v patterns still parse", () => {
  // Sanity: the fix must not regress patterns that were legal before.
  expect(new RegExp("[a-z]", "v").test("m")).toBe(true);
  expect(new RegExp("[a\\-]", "v").test("-")).toBe(true);
  expect(new RegExp("[\\-a]", "v").test("-")).toBe(true);
  expect(new RegExp("[a--b]", "v").test("a")).toBe(true);
  expect(new RegExp("[a&&b]", "v").test("a")).toBe(false);
  expect(new RegExp("[\\w--\\d]", "v").test("a")).toBe(true);
});
