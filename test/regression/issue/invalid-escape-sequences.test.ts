import { expect, test } from "bun:test";
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
// path — panic in debug, silent wrap in release.
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
