import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`
    "1 | const /x41 = 1;
              ^
    error: Unexpected escape sequence
        at <dir>/test.js:1:7

    Bun v<bun-version>"
  `);
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
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`
    "1 | const /" = 1;
              ^
    error: Unexpected escaped double quote '"'
        at <dir>/test.js:1:7

    Bun v<bun-version>"
  `);
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
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`
    "1 | const /' = 1;
              ^
    error: Unexpected escaped single quote "'"
        at <dir>/test.js:1:7

    Bun v<bun-version>"
  `);
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
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`
    "1 | const /\` = 1;
              ^
    error: Unexpected escaped backtick '\`'
        at <dir>/test.js:1:7

    Bun v<bun-version>"
  `);
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
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`
    "1 | const // = 1;
              ^
    error: Unexpected escaped backslash '/'
        at <dir>/test.js:1:7

    Bun v<bun-version>"
  `);
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
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`
    "1 | const /z = 1;
              ^
    error: Unexpected escape sequence
        at <dir>/test.js:1:7

    Bun v<bun-version>"
  `);
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
