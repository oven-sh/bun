import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestBuilder } from "../test_builder";

const TestBuilder = createTestBuilder(import.meta.path);
const { builtinDisabled } = shellInternals;

const self = readFileSync(import.meta.path, "utf8");

$.env(bunEnv);
$.nothrow();

// The `cat` builtin is disabled on posix by default (falls back to /bin/cat).
// On Windows the builtin is always used; elsewhere it requires
// BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1. The TestBuilder-based checks below
// run in-process so they only exercise the Zig code on Windows.
describe.if(!builtinDisabled("cat"))("cat builtin (in-process)", () => {
  TestBuilder.command`cat ${import.meta.path}`
    .quiet()
    .stdout(out => expect(out).toEqual(self))
    .exitCode(0)
    .runAsTest("single file");

  TestBuilder.command`cat ${import.meta.path} ${import.meta.path}`
    .quiet()
    .stdout(out => expect(out).toEqual(self + self))
    .exitCode(0)
    .runAsTest("multiple files");

  TestBuilder.command`cat ./definitely-does-not-exist-anywhere`
    .quiet()
    .stderr(s => expect(s).toContain("cat:"))
    .exitCode(1)
    .runAsTest("nonexistent file");

  TestBuilder.command`echo hello | cat`.quiet().stdout("hello\n").exitCode(0).runAsTest("stdin");
});

// These exercise Cat.deinit with state == .exec_filepath_args. Cat owns a refcounted
// *IOReader for each file argument (created via IOReader.init in next()); the inner
// exec_filepath_args.deinit() releases it before bltn().done() cascades back into
// Cat.deinit. Cat.deinit must be safe to run at that point (reader already released,
// pointer nulled) without double-freeing, and must release the reader if a teardown
// path ever reaches it while still live.
//
// Run in a subprocess with BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1 so the Zig builtin
// is used on posix instead of /bin/cat; the subprocess counts its own fds. On posix
// the builtin's IOReader currently errors on regular files (epoll rejects them with
// EPERM), so the read fails — but the IOReader is still created with the file fd and
// must be released via exec_filepath_args.deinit() / Cat.deinit without leaking.
describe("cat builtin does not leak the file IOReader or its fd", () => {
  const env = {
    ...bunEnv,
    BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1",
  };

  async function run(fixture: Record<string, string>, script: string) {
    using dir = tempDir("cat-builtin-leak", {
      ...fixture,
      "check.ts": script,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "check.ts")],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const fdCounter = /* ts */ `
    import { readdirSync } from "node:fs";
    function fdCount(): number {
      if (process.platform === "win32") return 0;
      return readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
    }
  `;

  test("single file arg", { timeout: 30_000 }, async () => {
    // On Linux the builtin's read of a regular file currently fails (epoll rejects
    // regular files with EPERM) so cat exits 1; on macOS/Windows it succeeds. Either
    // way the IOReader holding the file fd must be released.
    const { stdout, stderr, exitCode } = await run(
      { "a.txt": "A".repeat(64 * 1024) },
      /* ts */ `
        ${fdCounter}
        import { $ } from "bun";
        $.nothrow();

        await $\`cat a.txt\`.quiet(); // prime
        Bun.gc(true);
        const baseline = fdCount();

        for (let i = 0; i < 100; i++) {
          await $\`cat a.txt\`.quiet();
        }
        Bun.gc(true);
        for (let i = 0; i < 10 && fdCount() > baseline + 5; i++) {
          await Bun.sleep(0);
          Bun.gc(true);
        }

        const after = fdCount();
        if (process.platform !== "win32" && after - baseline > 5) {
          console.error("fd leak:", after - baseline);
          process.exit(1);
        }
        console.log("ok", baseline, after);
      `,
    );
    expect(stderr).toBe("");
    expect(stdout).toContain("ok");
    expect(exitCode).toBe(0);
  });

  test("multiple file args including a nonexistent one", { timeout: 30_000 }, async () => {
    const { stdout, stderr, exitCode } = await run(
      { "a.txt": "A".repeat(32 * 1024) },
      /* ts */ `
        ${fdCounter}
        import { $ } from "bun";
        $.nothrow();

        await $\`cat a.txt a.txt\`.quiet(); // prime
        Bun.gc(true);
        const baseline = fdCount();

        for (let i = 0; i < 100; i++) {
          const { exitCode } = await $\`cat a.txt ./does-not-exist a.txt\`.quiet();
          if (exitCode !== 1) {
            console.error("expected exit 1, got", exitCode);
            process.exit(1);
          }
        }
        Bun.gc(true);
        for (let i = 0; i < 10 && fdCount() > baseline + 5; i++) {
          await Bun.sleep(0);
          Bun.gc(true);
        }

        const after = fdCount();
        if (process.platform !== "win32" && after - baseline > 5) {
          console.error("fd leak:", after - baseline);
          process.exit(1);
        }
        console.log("ok", baseline, after);
      `,
    );
    expect(stderr).toBe("");
    expect(stdout).toContain("ok");
    expect(exitCode).toBe(0);
  });

  // Exercises the chunk-write → onIOWriterChunk → exec.deinit() → done() → Cat.deinit
  // path on Windows where the builtin can actually read a regular file.
  test.skipIf(!isWindows)("reads file and writes to pipe (Windows)", { timeout: 30_000 }, async () => {
    const { stderr, exitCode } = await run(
      { "a.txt": "A".repeat(64 * 1024) },
      /* ts */ `
        import { $ } from "bun";
        $.nothrow();
        for (let i = 0; i < 50; i++) {
          const { exitCode, stdout } = await $\`cat a.txt | cat\`.quiet();
          if (exitCode !== 0) {
            console.error("unexpected exit code", exitCode);
            process.exit(1);
          }
          if (stdout.length !== 64 * 1024) {
            console.error("unexpected stdout length", stdout.length);
            process.exit(1);
          }
        }
        console.log("ok");
      `,
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
