import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import * as fs from "node:fs";
import { join } from "node:path";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe("IOWriter file output redirection", () => {
  describe("basic file redirection", () => {
    TestBuilder.command`echo "hello world" > output.txt`
      .exitCode(0)
      .fileEquals("output.txt", "hello world\n")
      .runAsTest("simple echo to file");

    TestBuilder.command`echo -n "" > empty.txt`
      .exitCode(0)
      .fileEquals("empty.txt", "")
      .runAsTest("empty output to file");

    TestBuilder.command`echo "" > zero.txt`
      .exitCode(0)
      .fileEquals("zero.txt", "\n")
      .runAsTest("zero-length write should trigger onIOWriterChunk callback");
  });

  describe("fd-dup redirect followed by a word", () => {
    // `2>&1` has no file operand, so `b` must stay an argument of echo.
    TestBuilder.command`echo a 2>&1 b`
      .ensureTempDir()
      .exitCode(0)
      .stdout("a b\n")
      .stderr("")
      .doesNotExist("b")
      .runAsTest("2>&1 does not consume the next word as a file");

    TestBuilder.command`echo a 1>&2 b`
      .ensureTempDir()
      .exitCode(0)
      .stdout("")
      .stderr("a b\n")
      .doesNotExist("b")
      .runAsTest("1>&2 does not consume the next word as a file");
  });

  describe("drainBufferedData edge cases", () => {
    TestBuilder.command`echo -n ${"x".repeat(1024 * 10)} > large.txt`
      .exitCode(0)
      .fileEquals("large.txt", "x".repeat(1024 * 10))
      .runAsTest("large single write");

    TestBuilder.command`mkdir -p subdir && echo "test" > subdir/file.txt`
      .exitCode(0)
      .fileEquals("subdir/file.txt", "test\n")
      .runAsTest("write to subdirectory");
  });

  describe("file system error conditions", () => {
    TestBuilder.command`echo "should fail" > /dev/null/invalid/path`
      .exitCode(1)
      .stderr_contains("directory: /dev/null/invalid/path")
      .runAsTest("write to invalid path should fail");

    TestBuilder.command`echo "should fail" > /nonexistent/file.txt`
      .exitCode(1)
      .stderr_contains("No such file or directory")
      .runAsTest("write to non-existent directory should fail");
  });

  describe("special file types", () => {
    TestBuilder.command`echo "disappear" > /dev/null`.exitCode(0).stdout("").runAsTest("write to /dev/null");

    // A FIFO opened by path for `>` must take the pollable path; once the pipe
    // buffer fills, write(2) returns EAGAIN and the writer has to poll for
    // writability instead of treating the fd as an EAGAIN-free regular file.
    test.concurrent.skipIf(!isPosix)("redirect to a FIFO whose reader drains slowly applies backpressure", async () => {
      const payloadLen = 200 * 1024;
      using dir = tempDir("shell-fifo-redirect", {
        "fixture.ts": /* ts */ `
          import { $ } from "bun";
          import * as fs from "node:fs";
          const fifo = process.env.FIFO!;
          // Reader (nonblocking so open succeeds with no writer yet).
          const rfd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
          // Writer used to pre-fill the pipe buffer so the shell's first
          // write is guaranteed to hit EAGAIN regardless of drain timing.
          const wfd = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
          const fill = Buffer.alloc(4096, "y");
          try { while (true) fs.writeSync(wfd, fill); } catch {}

          const big = Buffer.alloc(${payloadLen}, "z").toString();
          let shell: Awaited<ReturnType<typeof $>> | undefined;
          const pending = $\`echo \${big} > \${fifo}\`.quiet().nothrow().then(r => (shell = r));

          const buf = Buffer.alloc(65536);
          let zs = 0;
          while (!shell) {
            let n = 0;
            try { n = fs.readSync(rfd, buf); } catch (e: any) { if (e.code !== "EAGAIN") throw e; }
            for (let i = 0; i < n; i++) if (buf[i] === 0x7a) zs++;
            await new Promise<void>(r => setImmediate(r));
          }
          await pending;
          fs.closeSync(wfd);
          // Drain whatever is left now that all writers are closed.
          while (true) {
            let n = 0;
            try { n = fs.readSync(rfd, buf); } catch (e: any) { if (e.code !== "EAGAIN") throw e; n = 0; }
            if (n === 0) break;
            for (let i = 0; i < n; i++) if (buf[i] === 0x7a) zs++;
          }
          fs.closeSync(rfd);
          console.log(JSON.stringify({ exitCode: shell!.exitCode, zs }));
        `,
      });
      const fifo = join(String(dir), "out.fifo");
      await using mk = Bun.spawn({ cmd: [Bun.which("mkfifo")!, fifo], env: bunEnv });
      await mk.exited;

      // Hold a read end in the parent so the FIFO survives a child abort
      // without the tempDir teardown racing an open writer.
      const holder = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      try {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "fixture.ts"],
          cwd: String(dir),
          env: { ...bunEnv, FIFO: fifo },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "");
        } catch {
          parsed = stdout;
        }
        // echo appends "\n" (0x0a, not 'z'), so the 'z' count equals payloadLen.
        expect({ parsed, stderr, exitCode }).toEqual({
          parsed: { exitCode: 0, zs: payloadLen },
          stderr: expect.any(String),
          exitCode: 0,
        });
      } finally {
        fs.closeSync(holder);
      }
    });
  });

  describe("writer queue and bump behavior", () => {
    TestBuilder.command`echo "single" > single_writer.txt`
      .exitCode(0)
      .fileEquals("single_writer.txt", "single\n")
      .runAsTest("single writer completion and cleanup");

    TestBuilder.command`echo "robust test" > robust.txt`
      .exitCode(0)
      .fileEquals("robust.txt", "robust test\n")
      .runAsTest("writer marked as dead during write");

    TestBuilder.command`echo "captured content" > capture.txt`
      .exitCode(0)
      .fileEquals("capture.txt", "captured content\n")
      .stdout("")
      .runAsTest("bytelist capture during file write");
  });

  describe("error handling and unreachable paths", () => {
    TestBuilder.command`echo -n ${"A".repeat(2 * 1024)} > atomic.txt`
      .exitCode(0)
      .fileEquals("atomic.txt", "A".repeat(2 * 1024))
      .runAsTest("attempt to trigger partial write panic");

    TestBuilder.command`echo "synchronous" > sync_write.txt`
      .exitCode(0)
      .fileEquals("sync_write.txt", "synchronous\n")
      .runAsTest("EAGAIN should never occur for files");

    TestBuilder.command`echo "error test" > nonexistent_dir/file.txt`
      .exitCode(1)
      .stderr_contains("No such file or directory")
      .runAsTest("write error propagation");
  });

  describe("file permissions and creation", () => {
    TestBuilder.command`echo "new file" > new_file.txt`
      .exitCode(0)
      .fileEquals("new_file.txt", "new file\n")
      .runAsTest("file creation with default permissions");

    TestBuilder.command`echo "original" > overwrite.txt && echo "short" > overwrite.txt`
      .exitCode(0)
      .fileEquals("overwrite.txt", "short\n")
      .runAsTest("overwrite existing file");

    TestBuilder.command`echo "line1" > append.txt && echo "line2" >> append.txt && echo "line3" >> append.txt`
      .exitCode(0)
      .fileEquals("append.txt", "line1\nline2\nline3\n")
      .runAsTest("append to existing file");
  });

  // describe("concurrent operations", () => {
  //   TestBuilder.command`echo "content 0" > concurrent_0.txt & echo "content 1" > concurrent_1.txt & echo "content 2" > concurrent_2.txt & wait`
  //     .exitCode(0)
  //     .fileEquals("concurrent_0.txt", "content 0\n")
  //     .fileEquals("concurrent_1.txt", "content 1\n")
  //     .fileEquals("concurrent_2.txt", "content 2\n")
  //     .runAsTest("concurrent writes to different files");

  //   TestBuilder.command`echo "iteration 0" > rapid.txt && echo "iteration 1" > rapid.txt && echo "iteration 2" > rapid.txt`
  //     .exitCode(0)
  //     .fileEquals("rapid.txt", "iteration 2\n")
  //     .runAsTest("rapid sequential writes to same file");
  // });

  describe("additional TestBuilder integration", () => {
    TestBuilder.command`echo "builder test" > output.txt`
      .exitCode(0)
      .fileEquals("output.txt", "builder test\n")
      .runAsTest("basic file output");

    TestBuilder.command`printf "no newline" > no_newline.txt`
      .exitCode(0)
      .fileEquals("no_newline.txt", "no newline")
      .runAsTest("output without trailing newline");

    TestBuilder.command`echo "first" > multi.txt && echo "second" >> multi.txt`
      .exitCode(0)
      .fileEquals("multi.txt", "first\nsecond\n")
      .runAsTest("write then append");

    TestBuilder.command`echo "test with spaces in filename" > "file with spaces.txt"`
      .exitCode(0)
      .fileEquals("file with spaces.txt", "test with spaces in filename\n")
      .runAsTest("write to file with spaces in name");

    TestBuilder.command`echo "pipe test" | cat > pipe_output.txt`
      .exitCode(0)
      .fileEquals("pipe_output.txt", "pipe test\n")
      .runAsTest("pipe with file redirection");
  });

  describe("&> redirect (stdout and stderr to same file)", () => {
    // This test verifies the fix for the bug where using &> with a builtin
    // command caused the same file descriptor to be closed twice, resulting
    // in an EBADF error. The issue was that two separate IOWriter instances
    // were created for the same fd when both stdout and stderr were redirected.
    TestBuilder.command`pwd &> pwd_output.txt`.exitCode(0).runAsTest("builtin pwd with &> redirect");

    TestBuilder.command`echo "hello" &> echo_output.txt`
      .exitCode(0)
      .fileEquals("echo_output.txt", "hello\n")
      .runAsTest("builtin echo with &> redirect");

    TestBuilder.command`pwd &>> append_output.txt`.exitCode(0).runAsTest("builtin pwd with &>> append redirect");
  });
});

// On Windows the uv_fs_write completion callback re-enters JS (resolving the
// command's promise), which drops the redirect IOWriter's last reference; the
// rest of that callback must not touch it. https://github.com/oven-sh/bun/issues/33108
test.concurrent("write completion survives dropping the redirect writer's last reference", async () => {
  using dir = tempDir("shell-redirect-writer-keepalive", {
    "redirect-fixture.ts": /* ts */ `
      import { $ } from "bun";
      await $\`echo hello > out.txt\`.quiet();
      process.stdout.write(await Bun.file("out.txt").text());
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "redirect-fixture.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "hello\n",
    stderr: expect.any(String),
    exitCode: 0,
  });
});
