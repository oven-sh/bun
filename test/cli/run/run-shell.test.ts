import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
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

  // Bare CR (not followed by LF) preceded by a backslash inside double
  // quotes. POSIX/bash treat `\<CR>` as literal `\` + CR because CR isn't
  // in the small set of chars a backslash escapes inside double quotes.
  // Making `\r` escapable (to reach the line-continuation handler) must
  // not silently drop the backslash when the CR is standalone.
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
    expect(stderr).toBe("");
    expect(stdout).toBe("a\\\rb\n");
    expect(exitCode).toBe(0);
  });
});
