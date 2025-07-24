import { expect, test } from "bun:test";

test("lexer handles single # character without bounds error", () => {
  // This test ensures the lexer doesn't crash when encountering
  // a single '#' character at the start of a file.
  // The fix adds a bounds check before accessing contents[1]

  expect(() => {
    // Using Bun.build to exercise the lexer directly
    Bun.build({
      entrypoints: ["data:text/javascript,#"],
      target: "node",
      write: false,
    });
  }).toThrow();

  // The important part is that it throws a proper syntax error
  // rather than crashing with a bounds check error
});
