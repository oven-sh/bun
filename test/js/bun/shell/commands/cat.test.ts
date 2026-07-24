import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import path from "node:path";

// On POSIX, `cat` falls through to the subprocess path unless
// BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS is set (see `Kind::DISABLED_ON_POSIX`).
// These spawn a child with the flag so the shell IOReader path is exercised on
// every platform.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

async function runShell(
  dir: string,
  script: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import {$} from "bun"; const r = await $\`${script}\`.cwd(${JSON.stringify(
        dir,
      )}).quiet().nothrow(); process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exitCode = r.exitCode;`,
    ],
    env: builtinEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("cat (builtin)", () => {
  test("reads a regular file given as an argument", async () => {
    using dir = tempDir("shell-cat-arg", { "a.txt": "hello from a\n" });
    const { stdout, stderr, exitCode } = await runShell(String(dir), "cat a.txt");
    expect(stderr).toBe("");
    expect(stdout).toBe("hello from a\n");
    expect(exitCode).toBe(0);
  });

  test("reads a regular file via stdin redirect", async () => {
    using dir = tempDir("shell-cat-stdin", { "a.txt": "hello from stdin\n" });
    const { stdout, stderr, exitCode } = await runShell(String(dir), "cat < a.txt");
    expect(stderr).toBe("");
    expect(stdout).toBe("hello from stdin\n");
    expect(exitCode).toBe(0);
  });

  test("concatenates multiple file arguments", async () => {
    using dir = tempDir("shell-cat-multi", {
      "a.txt": "first\n",
      "b.txt": "second\n",
    });
    const { stdout, stderr, exitCode } = await runShell(String(dir), "cat a.txt b.txt");
    expect(stderr).toBe("");
    expect(stdout).toBe("first\nsecond\n");
    expect(exitCode).toBe(0);
  });

  test("reads a multi-chunk regular file", async () => {
    const big = Buffer.alloc(300_000, "abcdefghij").toString();
    using dir = tempDir("shell-cat-big", { "big.txt": big });
    const { stdout, stderr, exitCode } = await runShell(String(dir), "cat big.txt");
    expect(stderr).toBe("");
    expect(stdout.length).toBe(big.length);
    expect(stdout).toBe(big);
    expect(exitCode).toBe(0);
  });

  test("still works through a pipe (pollable stdin)", async () => {
    using dir = tempDir("shell-cat-pipe", {});
    const { stdout, stderr, exitCode } = await runShell(String(dir), "echo piped | cat");
    expect(stderr).toBe("");
    expect(stdout).toBe("piped\n");
    expect(exitCode).toBe(0);
  });

  test.if(isPosix)("stdin redirect from /dev/null", async () => {
    using dir = tempDir("shell-cat-devnull", {});
    const { stdout, stderr, exitCode } = await runShell(String(dir), "cat < /dev/null");
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test("file redirect out still works", async () => {
    using dir = tempDir("shell-cat-out", { "a.txt": "payload\n" });
    const { stderr, exitCode } = await runShell(String(dir), "cat a.txt > out.txt");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await Bun.file(path.join(String(dir), "out.txt")).text()).toBe("payload\n");
  });
});
