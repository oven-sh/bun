import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import * as fs from "node:fs";
import { join } from "node:path";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

function lastLineAsJSON(output: string): unknown {
  try {
    return JSON.parse(output.trim().split("\n").pop() ?? "");
  } catch {
    return output;
  }
}

function buildSpliceShim() {
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  if (!cc) return null;
  const dir = tempDir("shell-splice-shim", {
    "shim.c": /* c */ `
      #define _GNU_SOURCE
      #include <dlfcn.h>
      #include <errno.h>
      #include <fcntl.h>
      #include <stdlib.h>

      ssize_t splice(int in, loff_t *off_in, int out, loff_t *off_out, size_t len, unsigned int flags) {
        static ssize_t (*real)(int, loff_t *, int, loff_t *, size_t, unsigned int);
        static long calls;
        const char *allowed = getenv("SPLICES_ALLOWED");
        if (allowed && calls++ >= atol(allowed)) {
          errno = ENOSYS;
          return -1;
        }
        if (!real) real = (ssize_t (*)(int, loff_t *, int, loff_t *, size_t, unsigned int))dlsym(RTLD_NEXT, "splice");
        return real(in, off_in, out, off_out, len, flags);
      }
    `,
  });
  const path = join(String(dir), "shim.so");
  const { exitCode, stderr } = Bun.spawnSync({
    cmd: [cc, "-shared", "-fPIC", "-o", path, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (exitCode !== 0) throw new Error("shim compile failed: " + stderr.toString());
  return { dir, path };
}

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

    // The shell writes to dups of fd 1 and fd 2. It cannot make them
    // nonblocking: the open file description is shared with fd 1, fd 2 and
    // every child. So it needs a write that does not wait for the reader.
    // Linux only: that write is splice(2) or send(2) there. macOS bounds the
    // write with the byte count that kqueue reports.
    describe.skipIf(!isLinux)("stdout that its reader does not drain", () => {
      // More than a pipe holds.
      const payloadLen = 100 * 1024;

      // Refuses splice(2) the way a seccomp policy can, once SPLICES_ALLOWED
      // calls went through. Built before the tests run, so a host without a
      // C compiler reports a skip.
      const shim = isLinux ? buildSpliceShim() : null;
      afterAll(() => shim?.dir[Symbol.dispose]());

      // The fixture is the only reader of its own stdout and reads on the
      // thread that runs the shell. It finishes only if no write waits.
      async function fifoStdout(env: Record<string, string>) {
        using dir = tempDir("shell-fifo-stdout", {
          "fixture.ts": /* ts */ `
            import { $ } from "bun";
            import * as fs from "node:fs";

            const rfd = fs.openSync(process.env.FIFO!, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
            const buf = Buffer.alloc(65536);
            async function stdoutOf(command: Promise<unknown>) {
              const chunks: Buffer[] = [];
              const drain = () => {
                let n = 0;
                try { n = fs.readSync(rfd, buf); } catch (e: any) { if (e.code !== "EAGAIN") throw e; }
                if (n > 0) chunks.push(Buffer.from(buf.subarray(0, n)));
                return n;
              };
              let settled = false;
              command = command.finally(() => (settled = true));
              while (!settled) {
                drain();
                await new Promise<void>(r => setImmediate(r));
              }
              await command;
              while (drain() > 0);
              return Buffer.concat(chunks);
            }
            const openFds = () => fs.readdirSync("/proc/self/fd").length;

            // 23 does not divide a pipe page, so a dropped or swapped piece changes the text.
            const lower = Buffer.alloc(${payloadLen}, "abcdefghijklmnopqrstuvw").toString();
            const upper = lower.toUpperCase();
            fs.writeFileSync("upper.txt", upper);

            const builtin = await stdoutOf($\`echo \${lower}\`);

            // Two shells wait on the same pipe at once. Each one keeps its own bytes in order.
            async function together() {
              const out = await stdoutOf(Promise.all([$\`echo \${lower}\`, $\`echo \${upper}\`]));
              const fromLower = Buffer.alloc(out.length);
              const fromUpper = Buffer.alloc(out.length);
              let l = 0, u = 0;
              for (let i = 0; i < out.length; i++) {
                if (out[i] >= 0x61) fromLower[l++] = out[i];
                else if (out[i] >= 0x41) fromUpper[u++] = out[i];
              }
              return (
                out.length === ${2 * payloadLen + 2} &&
                fromLower.toString("latin1", 0, l) === lower &&
                fromUpper.toString("latin1", 0, u) === upper
              );
            }
            const first = await together();
            const fdsAfterFirst = openFds();
            const second = await together();
            const fdsAfterSecond = openFds();

            // The output of a command that is not a builtin goes through the same writer.
            const external = await stdoutOf($\`cat upper.txt\`);

            fs.closeSync(rfd);
            console.error(JSON.stringify({
              builtin: builtin.toString() === lower + "\\n",
              together: first && second,
              fdsLeaked: fdsAfterSecond - fdsAfterFirst,
              external: external.toString() === upper,
              shim: fs.readFileSync("/proc/self/maps", "utf8").includes("shim.so"),
            }));
          `,
        });
        const fifo = join(String(dir), "out.fifo");
        await using mk = Bun.spawn({ cmd: [Bun.which("mkfifo")!, fifo], env: bunEnv });
        await mk.exited;

        // The read end lets the blocking open of the write end return, and it
        // keeps the FIFO alive if the child aborts.
        const holder = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const stdout = fs.openSync(fifo, fs.constants.O_WRONLY);
        try {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "fixture.ts"],
            cwd: String(dir),
            env: { ...bunEnv, ...env, FIFO: fifo },
            stdout,
            stderr: "pipe",
          });
          const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
          return { result: lastLineAsJSON(stderr), exitCode };
        } finally {
          fs.closeSync(stdout);
          fs.closeSync(holder);
        }
      }
      const intact = { builtin: true, together: true, fdsLeaked: 0, external: true };

      // These three are serial: on a timeout the runner kills the child of a
      // serial test only, and a fixture that fails here is stuck in a syscall.
      test("a blocking FIFO", async () => {
        expect(await fifoStdout({})).toEqual({ result: { ...intact, shim: false }, exitCode: 0 });
      });

      // Without splice(2) the writer sends what one pipe slot holds per
      // POLLOUT. The first writer is refused after a part of its bytes moved,
      // every later writer on its first call.
      test.skipIf(!shim)("a blocking FIFO where splice(2) is refused", async () => {
        const env = { LD_PRELOAD: shim!.path, SPLICES_ALLOWED: "1" };
        expect(await fifoStdout(env)).toEqual({ result: { ...intact, shim: true }, exitCode: 0 });
      });

      // Bun.spawn and node's child_process give a child a socketpair for a
      // piped stdout. `lazy` keeps this process from reading it until the
      // child reports on stderr that its event loop still turns.
      test("a socket", async () => {
        const socketLen = 4 * 1024 * 1024;
        const big = Buffer.alloc(socketLen, "abcdefghijklmnopqrstuvw").toString();
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
              import { $ } from "bun";
              import * as fs from "node:fs";

              const big = Buffer.alloc(${socketLen}, "abcdefghijklmnopqrstuvw").toString();
              let done = false;
              const command = $\`echo \${big}\`.then(result => ((done = true), result));
              // The shell has tried its write long before the 100th turn.
              let turns = 0;
              await new Promise<void>(resolve => {
                const turn = () => (++turns === 100 ? resolve() : setImmediate(turn));
                setImmediate(turn);
              });
              console.error(JSON.stringify({ socket: fs.fstatSync(1).isSocket(), doneWhileFull: done }));
              process.exitCode = (await command).exitCode;
            `,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
          lazy: true,
        });

        const decoder = new TextDecoder();
        const stderr = proc.stderr.getReader();
        let errors = "";
        const readStderr = async (until: () => boolean) => {
          while (!until()) {
            const { value, done } = await stderr.read();
            if (done) break;
            errors += decoder.decode(value, { stream: true });
          }
        };
        await readStderr(() => errors.includes("\n"));
        const report = lastLineAsJSON(errors);

        const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), readStderr(() => false), proc.exited]);
        expect({ report, intact: stdout === big + "\n", exitCode }).toEqual({
          report: { socket: true, doneWhileFull: false },
          intact: true,
          exitCode: 0,
        });
      });

      // A tty has no write that cannot wait. It keeps the plain write, as in
      // Node, and the bytes still arrive once and in order.
      test.concurrent("a tty", async () => {
        const big = Buffer.alloc(payloadLen, "abcdefghijklmnopqrstuvw").toString();
        const decoder = new TextDecoder();
        let output = "";
        const complete = Promise.withResolvers<void>();
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
              import { $ } from "bun";
              const big = Buffer.alloc(${payloadLen}, "abcdefghijklmnopqrstuvw").toString();
              process.exitCode = (await $\`echo \${big}\`.nothrow()).exitCode;
            `,
          ],
          env: bunEnv,
          terminal: {
            data(_terminal, chunk) {
              output += decoder.decode(chunk, { stream: true });
              if (output.length >= payloadLen + 2) complete.resolve();
            },
            exit() {
              complete.reject(new Error("the terminal closed after " + output.length + " bytes"));
            },
          },
        });
        const [exitCode] = await Promise.all([proc.exited, complete.promise]);
        expect({ intact: output === big + "\r\n", length: output.length, exitCode }).toEqual({
          intact: true,
          length: payloadLen + 2,
          exitCode: 0,
        });
      });
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
