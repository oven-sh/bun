import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import path from "node:path";

// On POSIX, `cat` falls through to the subprocess path unless
// BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS is set (see `Kind::DISABLED_ON_POSIX`).
// These spawn a child with the flag so the builtin path is taken on every
// platform.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

async function runShell(dir: string, script: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
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

  test("file redirect out still works", async () => {
    using dir = tempDir("shell-cat-out", { "a.txt": "payload\n" });
    const { stderr, exitCode } = await runShell(String(dir), "cat a.txt > out.txt");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await Bun.file(path.join(String(dir), "out.txt")).text()).toBe("payload\n");
  });

  test("sequential cat commands", async () => {
    using dir = tempDir("shell-cat-seq", {
      "a.txt": "A\n",
      "b.txt": "B\n",
      "c.txt": "C\n",
      "d.txt": "D\n",
    });
    const { stdout, stderr, exitCode } = await runShell(String(dir), "cat a.txt; cat b.txt; cat c.txt; cat d.txt");
    expect(stderr).toBe("");
    expect(stdout).toBe("A\nB\nC\nD\n");
    expect(exitCode).toBe(0);
  });

  test("sequential cat redirected to files", async () => {
    using dir = tempDir("shell-cat-seq-out", {
      "a.txt": "A\n",
      "b.txt": "B\n",
      "c.txt": "C\n",
    });
    const { stderr, exitCode } = await runShell(
      String(dir),
      "cat a.txt > o1.txt; cat b.txt > o2.txt; cat c.txt > o3.txt",
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await Bun.file(path.join(String(dir), "o1.txt")).text()).toBe("A\n");
    expect(await Bun.file(path.join(String(dir), "o2.txt")).text()).toBe("B\n");
    expect(await Bun.file(path.join(String(dir), "o3.txt")).text()).toBe("C\n");
  });

  // Opening a directory succeeds on Linux but the first read fails (and the
  // epoll registration returns EPERM), landing in `Cat::on_io_reader_done`
  // with no chunk queued. With fd-backed stdout that previously suspended
  // forever instead of finishing.
  test.if(isPosix)("directory as file argument with fd stdout does not hang", async () => {
    using dir = tempDir("shell-cat-isdir", { "sub/keep": "" });
    const { exitCode } = await runShell(String(dir), "cat sub > out.txt");
    expect(exitCode).not.toBe(0);
  });

  test("many file arguments", async () => {
    const files: Record<string, string> = {};
    let expected = "";
    for (let i = 0; i < 100; i++) {
      files[`f${i}.txt`] = `line${i}\n`;
      expected += `line${i}\n`;
    }
    using dir = tempDir("shell-cat-many", files);
    const args = Object.keys(files).join(" ");
    const { stdout, stderr, exitCode } = await runShell(String(dir), `cat ${args}`);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });
});
