import * as internalForTesting from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const { highlightJavaScript: highlighter, highlightJavaScriptRedacted: highlighterRedacted } = internalForTesting;

test("highlighter", () => {
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`").length).toBeLessThan(150);
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`123").length).toBeLessThan(150);
});

// https://github.com/oven-sh/bun/issues/31434
// A trailing backslash inside an unterminated `${` interpolation used to run
// the scanner past the end of the input (OOB read / crash).
test.each([
  "`${\\", // backtick, $, {, backslash
  "`${\\\\", // backtick, $, {, backslash, backslash
  "`a${b\\", // some content before the trailing backslash
  "`${\\}", // backslash escaping the closing brace, nothing after
])("highlighter does not read past end of input for %p", input => {
  expect(typeof highlighter(input)).toBe("string");
});

// A `${...}` interpolation ending exactly at the end of the input exits the
// string scan with `i == 0` and `text` fully consumed; the redacting
// highlighter then sliced `text[1..0]` (range start index 1 out of range for
// slice of length 0).
test.each([
  "`${}", // empty interpolation, nothing after
  "`${0}", // interpolation with content, nothing after
  "`a${bc}", // text before the interpolation
  "`${x}${y}", // two interpolations back to back
])("redacting highlighter handles `${}` at end of input for %p", input => {
  expect(typeof highlighterRedacted(input)).toBe("string");
});

// A redacted keyword followed by nothing but whitespace used to drain `text`
// in the whitespace-skip loop and then index `text[0]` on an empty slice
// (index out of bounds: the len is 0 but the index is 0).
test.each([
  "token ", // redacted keyword, trailing space
  "email\n", // redacted keyword, trailing newline
  "_auth\t", // redacted keyword, trailing tab
  "_password  ", // redacted keyword, several trailing spaces
  "x token = ", // value also drained after the separator
])("redacting highlighter handles redacted keyword at end of input for %p", input => {
  expect(typeof highlighterRedacted(input)).toBe("string");
});

test("redacting highlighter still redacts values", () => {
  const out = highlighterRedacted('_authToken = "npm_123456"');
  expect(out).not.toContain("npm_123456");
  expect(out).toContain("*");
});

// End-to-end: an error in bunfig.toml whose source line ends with an
// unterminated template interpolation is printed through the redacting syntax
// highlighter. This used to panic while printing the error message.
test("bunfig error on a line ending in `${}` does not crash", async () => {
  using dir = tempDir("bunfig-highlighter", {
    "bunfig.toml": "logLevel = 3 # `${}\n",
    "index.js": `console.log("hi");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.js"],
    env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("expected string");
  expect(stdout).toContain("hi");
  expect(exitCode).toBe(0);
});
