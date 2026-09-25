import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { join } from "path";

// Debug/ASAN builds print "WARNING: ASAN interferes with JSC signal handlers..."
// to stderr when JSC initializes, which is unrelated to the .sh dispatch path
// under test here but still shows up occasionally across platforms. Strip it
// before asserting stderr is clean.
function stripAsanWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter(l => !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
}

describe.concurrent("run-shell", () => {
  test("running a shell script works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "something.sh"), "echo wah");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "something.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    console.log(stderr);
    expect(stdout).toEqual("wah\n");
  });

  test("invalid syntax reports the error correctly", async () => {
    const dir = tmpdirSync("bun-shell-test-error");
    mkdirSync(dir, { recursive: true });
    const shellScript = `-h)
  echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`;
    await Bun.write(join(dir, "scripts", "script.sh"), shellScript);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "scripts", "script.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stderr = await proc.stderr.text();
    expect(stderr).toBe("error: Failed to run script.sh due to error Unexpected ')'\n");
  });

  // https://github.com/oven-sh/bun/issues/29669
  test("CRLF line endings are normalized (no command-not-found, no \\r in args)", async () => {
    using dir = tempDir("bun-shell-crlf", {
      "crlf.sh": 'export VITE_PARAM=value\r\necho "[$VITE_PARAM]"\r\necho done\r\n',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "crlf.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stripAsanWarning(stderr)).toBe("");
    expect(stdout).toBe("[value]\ndone\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29669
  // Mixed endings: LF on one line, CRLF on the next. Each `\r\n` must be
  // handled independently so `bun run build\r\n` still resolves `build`.
  // The inner `bun` is the absolute bunExe() so a `bun` on PATH can't be
  // picked up instead of the binary under test.
  test("mixed LF/CRLF line endings resolve package scripts", async () => {
    using dir = tempDir("bun-shell-mixed-eol", {
      "package.json": JSON.stringify({ scripts: { build: "echo built-ok" } }),
      "repro.sh": `export VITE_PARAM=value\n"${bunExe()}" run build\r\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "repro.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `bun run` echoes the resolved script to stderr; a stray `\r` would show
    // up here as `Script not found "build\r"` instead.
    expect(stripAsanWarning(stderr)).toBe("$ echo built-ok\n");
    expect(stdout).toBe("built-ok\n");
    expect(exitCode).toBe(0);
  });

  // Tab-indented CRLF script (the common Windows-editor shape). An unquoted
  // tab must break words like a space does, so `\techo` is not one command.
  test("tab-indented CRLF script runs", async () => {
    using dir = tempDir("bun-shell-tab-crlf", {
      "t.sh": "if true; then\r\n\techo hi\r\nfi\r\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "t.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stripAsanWarning(stderr)).toBe("");
    expect(stdout).toBe("hi\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29669
  test("CRLF with backslash line continuation", async () => {
    using dir = tempDir("bun-shell-crlf-cont", {
      "cont.sh": "echo first \\\r\n  second \\\r\n  third\r\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "cont.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stripAsanWarning(stderr)).toBe("");
    expect(stdout).toBe("first second third\n");
    expect(exitCode).toBe(0);
  });

  // A `\<newline>` with no surrounding whitespace joins the halves into ONE
  // word (POSIX 2.2.1), for both LF and CRLF. bash: `--flag=\<LF>value` is a
  // single argument. Uses the `echo` builtin: Windows has no `printf`.
  test.each([
    ["LF", "echo --flag=\\\nvalue\n"],
    ["CRLF", "echo --flag=\\\r\nvalue\r\n"],
  ])("backslash-newline inside a word joins it (%s)", async (_eol, script) => {
    using dir = tempDir("bun-shell-cont-join", { "j.sh": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "j.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stripAsanWarning(stderr)).toBe("");
    expect(stdout).toBe("--flag=value\n");
    expect(exitCode).toBe(0);
  });

  // A trailing `# comment` ends the line: the next line is a new command,
  // not more arguments. bash: `echo start # c\necho second` prints two lines.
  test.each([
    ["LF", "echo start # begin\necho second\n"],
    ["CRLF", "echo start # begin\r\necho second\r\n"],
  ])("trailing comment does not swallow the line break (%s)", async (_eol, script) => {
    using dir = tempDir("bun-shell-comment-eol", { "c.sh": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "c.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stripAsanWarning(stderr)).toBe("");
    expect(stdout).toBe("start\nsecond\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29669
  test("CRLF with backslash line continuation inside double quotes", async () => {
    using dir = tempDir("bun-shell-crlf-dq", {
      "dq.sh": 'MSG="hello \\\r\nworld"\r\necho "$MSG"\r\n',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "dq.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stripAsanWarning(stderr)).toBe("");
    expect(stdout).toBe("hello world\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29669
  // Guard: making `\r` escapable must not drop the backslash for a bare
  // `\<CR>` in double quotes; POSIX/bash keep it as literal `\` + CR.
  test("bare CR inside double quotes keeps literal backslash", async () => {
    using dir = tempDir("bun-shell-bare-cr", {
      "bare.sh": 'echo "a\\\rb"\n',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "bare.sh")],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stripAsanWarning(stderr)).toBe("");
    expect(stdout).toBe("a\\\rb\n");
    expect(exitCode).toBe(0);
  });
});

test.skipIf(isWindows)(
  "package script shell interpreter is resolved from the original PATH, not node_modules/.bin",
  async () => {
    // A dependency can place arbitrary executables named "bash"/"sh"/"zsh" into
    // node_modules/.bin via its "bin" field. The interpreter that runs
    // package.json scripts must never be picked up from there.
    const fakeShell = "#!/bin/sh\necho FAKE_SHELL_USED\n";
    using dir = tempDir("run-shell-interpreter", {
      "package.json": JSON.stringify({
        name: "shell-interpreter-fixture",
        version: "1.0.0",
        scripts: {
          "say-hi": "echo real-shell-ran",
        },
      }),
      "node_modules/.bin/bash": fakeShell,
      "node_modules/.bin/sh": fakeShell,
      "node_modules/.bin/zsh": fakeShell,
    });
    for (const name of ["bash", "sh", "zsh"]) {
      chmodSync(join(String(dir), "node_modules", ".bin", name), 0o755);
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "say-hi"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The script must run under a real system shell, not the executables a
    // dependency dropped into node_modules/.bin.
    expect(stdout).not.toContain("FAKE_SHELL_USED");
    expect(stderr).not.toContain("FAKE_SHELL_USED");
    expect(stdout).toContain("real-shell-ran");
    expect(exitCode).toBe(0);
  },
);
