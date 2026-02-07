import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26785
// Bun's regex printer was incorrectly handling backslash-escaped non-ASCII
// characters in regex literals. When a non-ASCII character is preceded by a
// backslash, the printer converts the character to `\uXXXX` format but was
// adding another backslash, resulting in `\\uXXXX` which breaks regex semantics.

test("regex with backslash-escaped non-ASCII character matches correctly", async () => {
  using dir = tempDir("issue-26785", {
    "test.js": `
const R = /[\\⁄]/;  // backslash + U+2044 (fraction slash)
const testString = '³⁄₅₂ cup of stuff';
const match = testString.match(R);

// Should match the fraction slash character, not the letter 'u'
console.log(JSON.stringify({
  source: R.source,
  match: match ? match[0] : null,
  index: match ? match.index : null
}));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  // The source should have \u2044 (one backslash), not \\u2044 (two backslashes)
  expect(result.source).toBe("[\\u2044]");
  // Should match the fraction slash character at index 1, not 'u' from 'cup'
  expect(result.match).toBe("⁄");
  expect(result.index).toBe(1);
  expect(exitCode).toBe(0);
});

test("complex regex with backslash-escaped non-ASCII matches fractions", async () => {
  using dir = tempDir("issue-26785-complex", {
    "test.js": `
// Original regex from the issue
const R = /[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒]|([⁰¹²³⁴⁵⁶⁷⁸⁹]+|[₀₁₂₃₄₅₆₇₈₉]+|[0-9]+)([\\/\\⁄])([⁰¹²³⁴⁵⁶⁷⁸⁹]+|[₀₁₂₃₄₅₆₇₈₉]+|[0-9]+)/;
const m = '³⁄₅₂ cup of stuff'.match(R);
console.log(JSON.stringify(m));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  // Should match the fraction "³⁄₅₂"
  expect(result).not.toBeNull();
  expect(result[0]).toBe("³⁄₅₂");
  expect(result[1]).toBe("³");
  expect(result[2]).toBe("⁄");
  expect(result[3]).toBe("₅₂");
  expect(exitCode).toBe(0);
});

test("regex with non-ASCII character without preceding backslash works", async () => {
  using dir = tempDir("issue-26785-no-backslash", {
    "test.js": `
// Non-ASCII character without a preceding backslash should still work
const R = /[⁄]/;
const testString = '³⁄₅₂ cup of stuff';
const match = testString.match(R);
console.log(JSON.stringify({
  match: match ? match[0] : null,
  index: match ? match.index : null
}));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  // Should still match the fraction slash character
  expect(result.match).toBe("⁄");
  expect(result.index).toBe(1);
  expect(exitCode).toBe(0);
});
