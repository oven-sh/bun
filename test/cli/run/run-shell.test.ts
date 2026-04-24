import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { join } from "path";

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
    // Each line ends in CRLF. Before the fix, `export\r` wasn't a known
    // builtin so bun emitted "command not found: export", and `echo $X\r`
    // passed a trailing \r through to stdout.
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
    expect(stderr).toBe("");
    expect(stdout).toBe("[value]\ndone\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29669 — backslash line-continuation
  // in a CRLF-encoded script (`cmd arg1 \<CR><LF>arg2`). Without the escaped-CR
  // handler, the `\<CR>` was swallowed but `\r` got glued onto the previous
  // word and the `<LF>` emitted a real Newline — so `arg2` ran as a separate
  // command instead of continuing the line.
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
    expect(stderr).toBe("");
    expect(stdout).toBe("first second third\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29669 — backslash line-continuation
  // inside a double-quoted string. CRLF and LF must behave the same: the
  // `\<newline>` pair is consumed. Before adding `\r` to the Double-state
  // escape list, CRLF left a literal backslash + CR + LF embedded in the
  // string value while LF produced a single joined string.
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
    expect(stderr).toBe("");
    expect(stdout).toBe("hello world\n");
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
