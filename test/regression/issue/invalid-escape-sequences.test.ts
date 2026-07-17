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
// Invalid escape-sequence diagnostics in `decode_escape_sequences` reported
// caret locations at text-relative offsets instead of absolute source
// positions, landing the caret several columns left of the backslash (or on
// an unrelated earlier line/character). Two kinds of bugs fed into this:
//   1. `hex_start` in the `\u{...}` branch over-subtracted by the width of
//      `{`, and the string-path caller passed the opening-quote offset
//      where the decoder expects the content-start offset.
//   2. The legacy-octal `\0`..`\7` + `8`/`9` branch built `Range.loc.start`
//      from `octal_start` alone, ignoring the absolute `start` argument that
//      every sibling error path adds.
// Pin the caret under the `\` for every affected escape and quote style.
describe("invalid-escape caret points at the backslash (#31134)", () => {
  const cases = [
    // `\u{...}` out-of-range:
    {
      name: "\\u{} backtick with prefix",
      source: "`aaaaa\\u{110000}`",
      msg: "Unicode escape sequence is out of range",
      pattern: "\\u{110000}",
      expectCol: 7,
    },
    {
      name: "\\u{} backtick without prefix",
      source: "`\\u{110000}`",
      msg: "Unicode escape sequence is out of range",
      pattern: "\\u{110000}",
      expectCol: 2,
    },
    {
      name: "\\u{} double-quote with prefix",
      source: 'var a = "aaaaa\\u{110000}";',
      msg: "Unicode escape sequence is out of range",
      pattern: "\\u{110000}",
      expectCol: 15,
    },
    {
      name: "\\u{} double-quote without prefix",
      source: 'var a = "\\u{110000}";',
      msg: "Unicode escape sequence is out of range",
      pattern: "\\u{110000}",
      expectCol: 10,
    },
    {
      name: "\\u{} single-quote with prefix",
      source: "var a = 'aaaaa\\u{110000}';",
      msg: "Unicode escape sequence is out of range",
      pattern: "\\u{110000}",
      expectCol: 15,
    },
    {
      name: "\\u{} identifier with prefix",
      source: "var ab\\u{110000} = 1;",
      msg: "Unicode escape sequence is out of range",
      pattern: "\\u{110000}",
      expectCol: 7,
    },
    // Legacy-octal `\08`/`\09`:
    {
      name: "\\08 double-quote with prefix",
      source: 'var a = "aaaaa\\08";',
      msg: "Invalid legacy octal literal",
      pattern: "\\08",
      expectCol: 15,
    },
    {
      name: "\\08 double-quote without prefix",
      source: 'var a = "\\08";',
      msg: "Invalid legacy octal literal",
      pattern: "\\08",
      expectCol: 10,
    },
    {
      name: "\\09 single-quote with prefix",
      source: "var a = 'aaaaa\\09';",
      msg: "Invalid legacy octal literal",
      pattern: "\\09",
      expectCol: 15,
    },
  ];

  test.each(cases)("$name → column $expectCol", ({ source, msg, pattern, expectCol }) => {
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
    expect(err).toContain(msg);
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
    const backslashIdx = sourceLine.indexOf(pattern);
    expect(backslashIdx).toBeGreaterThanOrEqual(0);
    expect(caretLine[backslashIdx]).toBe("^");
    expect(exitCode).toBe(1);
  });
});

// https://github.com/oven-sh/bun/issues/30825
// Two bugs in the variable-length `\u{...}` loop of `decode_escape_sequences`:
//   1. `value = value * 16 | d` overflowed `i64` once the escape carried enough
//      hex digits, trapping in debug builds. `is_out_of_range` is sticky and the
//      value only grows, so saturating the multiply keeps the range error intact.
//   2. Running out of literal before the closing `}` broke out of the loop and
//      used the half-parsed value: `"\u{41"` decoded to `"A"` and `"\u{"` to NUL.
//      esbuild and JSC both reject these.
describe("pathological `\\u{...}` escapes (#30825)", () => {
  const run = (source: string) => {
    using dir = tempDir("u-brace", { "test.js": source });
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "test.js")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
      cwd: String(dir),
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
  };

  // Any run of ~16+ significant hex digits pushes the accumulator past `i64::MAX`.
  const overflowing = Buffer.alloc(64, "f").toString();

  const outOfRange = [
    { name: "identifier (issue repro)", source: "\\u{3333333316aaaaaaa}a" },
    { name: "double-quoted string", source: 'var a = "\\u{3333333316aaaaaaa}";' },
    { name: "single-quoted string", source: "var a = '\\u{3333333316aaaaaaa}';" },
    { name: "template literal", source: "var a = `\\u{3333333316aaaaaaa}`;" },
    { name: "64 hex digits", source: `var a = "\\u{${overflowing}}";` },
    { name: "leading zeros then overflow", source: `var a = "\\u{0000${overflowing}}";` },
    { name: "one past U+10FFFF", source: 'var a = "\\u{110000}";' },
    // A template head's text ends at `${`, not at a quote.
    { name: "template head before a substitution", source: "var x = 1; var a = `\\u{110000}${x}`;" },
  ];

  test.each(outOfRange)("$name → out-of-range error", ({ source }) => {
    const { stderr, exitCode } = run(source);
    expect(stderr).toContain("error: Unicode escape sequence is out of range");
    expect(exitCode).toBe(1);
  });

  // The literal ends before `}`. esbuild and JSC both reject; the out-of-range
  // case is a syntax error too, because the missing brace is found first.
  const unterminated = [
    { name: "double-quoted, digits", source: 'var a = "\\u{41";' },
    { name: "double-quoted, no digits", source: 'var a = "\\u{";' },
    { name: "single-quoted, digits", source: "var a = '\\u{41';" },
    { name: "template literal, digits", source: "var a = `\\u{41`;" },
    { name: "digits are out of range", source: 'var a = "\\u{110000";' },
    { name: "digits overflow the accumulator", source: `var a = "\\u{${overflowing}";` },
    // The head's text ends at `${`, so the brace is missing there too. Before the
    // fix this cooked to "A" + x + "}".
    { name: "template head before a substitution", source: "var x = 1; var a = `\\u{41${x}}`;" },
  ];

  test.each(unterminated)("$name → syntax error", ({ source }) => {
    const { stderr, exitCode } = run(source);
    expect(stderr).toContain("error: Syntax Error");
    // The missing brace is reported, not the value it would have produced.
    expect(stderr).not.toContain("out of range");
    expect(exitCode).toBe(1);
  });

  test("in-range escapes still decode, however many leading zeros", () => {
    const { stdout, exitCode } = run(
      [
        `console.log("\\u{41}");`,
        // Long enough to overflow if the leading zeros were counted as digits.
        `console.log("\\u{${Buffer.alloc(64, "0").toString()}41}");`,
        `console.log("\\u{10FFFF}".codePointAt(0).toString(16));`,
        `console.log("\\u{1F600}".length);`,
        "console.log(`\\u{42}`);",
        "const \\u{43} = 3; console.log(C);",
      ].join("\n"),
    );
    expect(stdout).toBe("A\nA\n10ffff\n2\nB\n3\n");
    expect(exitCode).toBe(0);
  });

  // Tagged templates keep their raw text and never reach the escape decoder, so
  // neither new error path may leak into them: the cooked value stays undefined.
  test("tagged templates still expose raw text for invalid escapes", () => {
    const { stdout, exitCode } = run(
      [
        "const x = 1;",
        "function tag(s) { return `${s[0]} ${s.raw[0]}`; }",
        "console.log(tag`\\u{110000}`);",
        "console.log(tag`\\u{41`);",
        "console.log(tag`\\u{3333333316aaaaaaa}`);",
        "console.log(tag`\\u{41${x}}`);",
      ].join("\n"),
    );
    expect(stdout).toBe(
      "undefined \\u{110000}\nundefined \\u{41\nundefined \\u{3333333316aaaaaaa}\nundefined \\u{41\n",
    );
    expect(exitCode).toBe(0);
  });
});
