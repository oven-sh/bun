import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("Invalid escape sequence \\x in identifier shows helpful error message", async () => {
  using dir = tempDir("escape-test", {
    "test.js": `const \\x41 = 1;`,
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(exitCode).toBe(1);
  const err = stderr.toString();
  expect(err).toContain("const \\x41 = 1;");
  expect(err).toContain("error: Unexpected escape sequence");
  expect(err).toContain(":1:7");
});

test("Invalid escaped double quote in identifier shows helpful error message", async () => {
  using dir = tempDir("escape-test", {
    "test.js": `const \\" = 1;`,
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(exitCode).toBe(1);
  const err = stderr.toString();
  expect(err).toContain('const \\" = 1;');
  expect(err).toContain("error: Unexpected escaped double quote");
  expect(err).toContain(":1:7");
});

test("Invalid escaped single quote in identifier shows helpful error message", async () => {
  using dir = tempDir("escape-test", {
    "test.js": `const \\' = 1;`,
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(exitCode).toBe(1);
  const err = stderr.toString();
  expect(err).toContain("const \\' = 1;");
  expect(err).toContain("error: Unexpected escaped single quote");
  expect(err).toContain(":1:7");
});

test("Invalid escaped backtick in identifier shows helpful error message", async () => {
  using dir = tempDir("escape-test", {
    "test.js": `const \\\` = 1;`,
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(exitCode).toBe(1);
  const err = stderr.toString();
  expect(err).toContain("const \\\` = 1;");
  expect(err).toContain("error: Unexpected escaped backtick");
  expect(err).toContain(":1:7");
});

test("Invalid escaped backslash in identifier shows helpful error message", async () => {
  using dir = tempDir("escape-test", {
    "test.js": `const \\\\ = 1;`,
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(exitCode).toBe(1);
  const err = stderr.toString();
  expect(err).toContain("const \\\\ = 1;");
  expect(err).toContain("error: Unexpected escaped backslash");
  expect(err).toContain(":1:7");
});

test("Invalid escaped z in identifier shows helpful error message", async () => {
  using dir = tempDir("escape-test", {
    "test.js": `const \\z = 1;`,
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(exitCode).toBe(1);
  const err = stderr.toString();
  expect(err).toContain("const \\z = 1;");
  expect(err).toContain("error: Unexpected escape sequence");
  expect(err).toContain(":1:7");
});

// https://github.com/oven-sh/bun/issues/30893
// Invalid escape sequence where the first char after `\x`, `\u`, or `\u{` is a
// multi-byte codepoint underflowed `start + iter.i - width` in the lexer's error
// path — panic in debug, silent wrap in release. The wrapped value is stored in
// `self.end`, but `syntax_error()` reports at `self.start`, so release output is
// identical pre/post-fix and nothing here can distinguish them under
// USE_SYSTEM_BUN=1. These tests exist to guard `bun bd` (ASAN/debug) CI.
test("invalid \\x followed by multi-byte codepoint does not panic (#30893)", async () => {
  // Input bytes: 0x27 0x5C 0x78 0xF0 0xB9 0x91 0x9C 0x27 0xFF
  //              '    \    x    <── U+3945C ──>  '    (trailing junk)
  using dir = tempDir("escape-overflow", {
    "test.js": Buffer.from([0x27, 0x5c, 0x78, 0xf0, 0xb9, 0x91, 0x9c, 0x27, 0xff]),
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  const err = stderr.toString();
  // Must be a clean SyntaxError, not a panic.
  expect(err).toContain("Syntax Error");
  expect(exitCode).toBe(1);
});

test("invalid \\x with second hex digit being multi-byte codepoint does not panic (#30893)", async () => {
  // '\x2' followed by a 4-byte codepoint: exercises the second-hex-digit branch.
  using dir = tempDir("escape-overflow-2", {
    "test.js": Buffer.from([0x27, 0x5c, 0x78, 0x32, 0xf0, 0xb9, 0x91, 0x9c, 0x27]),
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(stderr.toString()).toContain("Syntax Error");
  expect(exitCode).toBe(1);
});

test("invalid \\u followed by multi-byte codepoint does not panic (#30893)", async () => {
  // '\u' followed by a 4-byte codepoint: exercises the fixed-length \u branch.
  using dir = tempDir("escape-overflow-u", {
    "test.js": Buffer.from([0x27, 0x5c, 0x75, 0xf0, 0xb9, 0x91, 0x9c, 0x27]),
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(stderr.toString()).toContain("Syntax Error");
  expect(exitCode).toBe(1);
});

test("invalid \\u{ followed by multi-byte codepoint does not panic (#30893)", async () => {
  // '\u{' followed by a 4-byte codepoint then '}': exercises the variable-length branch.
  using dir = tempDir("escape-overflow-u-brace", {
    "test.js": Buffer.from([0x27, 0x5c, 0x75, 0x7b, 0xf0, 0xb9, 0x91, 0x9c, 0x7d, 0x27]),
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "test.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
    cwd: String(dir),
  });

  expect(stderr.toString()).toContain("Syntax Error");
  expect(exitCode).toBe(1);
});

test("Valid unicode escapes in identifiers should work", async () => {
  // Test valid \u escape with 4 hex digits
  {
    using dir = tempDir("escape-test", {
      "valid1.js": `const \\u0041 = 1; console.log(A);`,
    });

    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "valid1.js")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
      cwd: String(dir),
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toBe("1\n");
  }

  // Test valid \u{} escape with variable length
  {
    using dir = tempDir("escape-test", {
      "valid2.js": `const \\u{41} = 2; console.log(A);`,
    });

    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "valid2.js")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
      cwd: String(dir),
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toBe("2\n");
  }
});

// https://github.com/oven-sh/bun/issues/31134
// Out-of-range `\u{...}` inside a template/string literal reported a caret
// location two columns left of the backslash (one column when the escape
// immediately followed the opening quote, because the computation clamped).
// `hex_start` over-subtracted by the width of `{`, and the string-path caller
// passed the opening-quote offset where the decoder expects the content-start
// offset. Pin the caret to the `\` byte in each quote style.
describe("out-of-range \\u{...} caret points at the backslash (#31134)", () => {
  const cases = [
    { name: "backtick with prefix", source: "`aaaaa\\u{110000}`", expectCol: 7 },
    { name: "backtick without prefix", source: "`\\u{110000}`", expectCol: 2 },
    { name: "double-quote with prefix", source: 'var a = "aaaaa\\u{110000}";', expectCol: 15 },
    { name: "double-quote without prefix", source: 'var a = "\\u{110000}";', expectCol: 10 },
    { name: "single-quote with prefix", source: "var a = 'aaaaa\\u{110000}';", expectCol: 15 },
    { name: "identifier with prefix", source: "var ab\\u{110000} = 1;", expectCol: 7 },
  ];

  test.each(cases)("$name → column $expectCol", ({ source, expectCol }) => {
    using dir = tempDir("caret-pos", { "test.js": source });
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "test.js")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
      cwd: String(dir),
    });

    // Check stderr first so a location/caret mismatch surfaces directly
    // instead of getting hidden behind a bare exitCode assertion.
    const err = stderr.toString();
    expect(err).toContain("Unicode escape sequence is out of range");
    // Reported error location: `:1:<col>` — 1-indexed byte column of the `\`.
    expect(err).toContain(`:1:${expectCol}`);
    // The caret line (second printed line) should place `^` directly under
    // the backslash in the source line above it.
    const lines = err.split("\n");
    const sourceLineIdx = lines.findIndex(l => l.includes(source));
    expect(sourceLineIdx).toBeGreaterThanOrEqual(0);
    const sourceLine = lines[sourceLineIdx];
    const caretLine = lines[sourceLineIdx + 1];
    // `1 | ` (or similar) prefix is identical on both lines, so column
    // alignment carries through. The backslash in `sourceLine` must sit
    // above the `^` in `caretLine`.
    const backslashIdx = sourceLine.indexOf("\\u{110000}");
    expect(backslashIdx).toBeGreaterThanOrEqual(0);
    expect(caretLine[backslashIdx]).toBe("^");
    expect(exitCode).toBe(1);
  });
});
