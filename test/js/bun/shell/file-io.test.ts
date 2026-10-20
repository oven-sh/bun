import { describe, expect, test } from "bun:test";
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
    // every child. So a write that the fd cannot take at once must not wait
    // for the reader on the thread that runs the event loop.
    describe.skipIf(!isPosix)("output that its reader does not drain", () => {
      // The fixture is the only reader of the FIFO and reads it on the thread
      // that runs the shell, so it finishes only if no write waits. Linux: on
      // macOS the byte count from kqueue bounds these writes.
      //
      // These tests are serial: on a timeout the runner kills the child of a
      // serial test only, and a fixture that fails here is stuck in write(2).
      test.skipIf(!isLinux).each(["stdout", "stderr"] as const)("a blocking FIFO on %s", async stream => {
        using dir = tempDir("shell-fifo-" + stream, {
          "fixture.ts": /* ts */ `
            import { $ } from "bun";
            import * as fs from "node:fs";

            const onStderr = process.env.STREAM === "stderr";
            const redirect = { raw: onStderr ? "1>&2" : "" };
            const rfd = fs.openSync(process.env.FIFO!, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
            const wfd = fs.openSync(process.env.FIFO!, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
            const turn = () => new Promise<void>(resolve => setImmediate(resolve));

            const buf = Buffer.alloc(1 << 20);
            const read = (length = buf.length) => {
              try {
                return fs.readSync(rfd, buf, 0, length);
              } catch (e: any) {
                if (e.code !== "EAGAIN") throw e;
                return 0;
              }
            };
            // A pipe is a ring of slots, and a slot holds one page.
            const slot = Number(/KernelPageSize:\\s+(\\d+) kB/.exec(fs.readFileSync("/proc/self/smaps", "utf8"))![1]) * 1024;
            const fill = () => {
              let filled = 0;
              try {
                while (true) filled += fs.writeSync(wfd, Buffer.alloc(slot, "."));
              } catch (e: any) {
                if (e.code !== "EAGAIN") throw e;
              }
              return filled;
            };
            const capacity = fill();
            while (read() > 0);

            // What the command writes to the FIFO. The shell gets its turn at
            // the pipe before anything is read.
            async function output(command: Promise<unknown>) {
              let settled = false;
              command = command.finally(() => (settled = true));
              for (let i = 0; i < 30; i++) await turn();
              const chunks: Buffer[] = [];
              const drain = () => {
                const n = read();
                if (n > 0) chunks.push(Buffer.from(buf.subarray(0, n)));
                return n;
              };
              while (!settled) {
                drain();
                await turn();
              }
              await command;
              while (drain() > 0);
              return Buffer.concat(chunks).toString("latin1");
            }
            // 23 does not divide a page, so a dropped or swapped piece changes the text.
            const letters = (length: number) => Buffer.alloc(length, "abcdefghijklmnopqrstuvw").toString();

            // One free slot is all that POLLOUT proves. A write of one slot
            // fits it. One byte more does not.
            const oneFreeSlot: Record<string, boolean> = {};
            for (const [name, length] of Object.entries({ slot, "slot + 1": slot + 1, "capacity + 1": capacity + 1 })) {
              fill();
              read(slot);
              const text = letters(length - 1);
              const out = await output($\`echo \${text} \${redirect}\`);
              oneFreeSlot[name] = out === Buffer.alloc(capacity - slot, ".").toString() + text + "\\n";
            }

            const lower = letters(capacity + slot + 1);
            const upper = lower.toUpperCase();
            // The first chunk is small: the writer learns what the fd is on a later, larger write.
            const builtin =
              (await output($\`echo start \${redirect}; echo \${lower} \${redirect}\`)) === "start\\n" + lower + "\\n";

            // Two shells wait on the same pipe at once. Each one keeps its own bytes in order.
            const both = await output(Promise.all([$\`echo \${lower} \${redirect}\`, $\`echo \${upper} \${redirect}\`]));
            const fromLower = Buffer.alloc(both.length);
            const fromUpper = Buffer.alloc(both.length);
            let l = 0, u = 0;
            for (let i = 0; i < both.length; i++) {
              const byte = both.charCodeAt(i);
              if (byte >= 0x61) fromLower[l++] = byte;
              else if (byte >= 0x41) fromUpper[u++] = byte;
            }
            const together =
              both.length === 2 * lower.length + 2 &&
              fromLower.toString("latin1", 0, l) === lower &&
              fromUpper.toString("latin1", 0, u) === upper;

            // The shell relays the output of a command that is not a builtin through the same writer.
            // The command is faster than the pipe, so the writer's queue grows and it compacts the queue.
            const relayed = letters(512 * 1024).toUpperCase();
            fs.writeFileSync("relayed.txt", relayed);
            const external =
              (await output(onStderr ? $\`sh -c "cat relayed.txt >&2"\` : $\`cat relayed.txt\`)) === relayed;

            // The open file description is still the caller's blocking one.
            const blocking = () => {
              const flags = /flags:\\s+(\\d+)/.exec(fs.readFileSync("/proc/self/fdinfo/" + (onStderr ? 2 : 1), "utf8"))![1];
              return (parseInt(flags, 8) & fs.constants.O_NONBLOCK) === 0;
            };
            const stillBlocking = blocking();

            // This writer makes the description nonblocking, as process.stdout and process.stderr
            // do. Then no write waits, and the shell gives the whole chunk to write(2) as before:
            // it makes fewer calls than the pipe has slots.
            (onStderr ? Bun.stderr : Bun.stdout).writer();
            const writeCalls = () => Number(/^syscw: (\\d+)$/m.exec(fs.readFileSync("/proc/thread-self/io", "utf8"))![1]);
            const callsBefore = writeCalls();
            const onceNonblocking =
              !blocking() &&
              (await output($\`echo \${lower} \${redirect}\`)) === lower + "\\n" &&
              writeCalls() - callsBefore < capacity / slot;

            const report = JSON.stringify({ oneFreeSlot, builtin, together, external, stillBlocking, onceNonblocking });
            fs.writeSync(onStderr ? 1 : 2, report + "\\n");
          `,
        });
        const fifo = join(String(dir), "out.fifo");
        await using mk = Bun.spawn({ cmd: [Bun.which("mkfifo")!, fifo], env: bunEnv });
        await mk.exited;

        // The read end lets the blocking open of the write end return, and it
        // keeps the FIFO alive if the child aborts.
        const holder = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const writeEnd = fs.openSync(fifo, fs.constants.O_WRONLY);
        try {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "fixture.ts"],
            cwd: String(dir),
            env: { ...bunEnv, FIFO: fifo, STREAM: stream },
            stdout: stream === "stdout" ? writeEnd : "pipe",
            stderr: stream === "stderr" ? writeEnd : "pipe",
          });
          const reportStream = stream === "stdout" ? proc.stderr : proc.stdout;
          const [report, exitCode] = await Promise.all([(reportStream as ReadableStream).text(), proc.exited]);
          expect({ report: lastLineAsJSON(report), exitCode }).toEqual({
            report: {
              oneFreeSlot: { slot: true, "slot + 1": true, "capacity + 1": true },
              builtin: true,
              together: true,
              external: true,
              stillBlocking: true,
              onceNonblocking: true,
            },
            exitCode: 0,
          });
        } finally {
          fs.closeSync(writeEnd);
          fs.closeSync(holder);
        }
      });

      // `bun two.sh` runs the shell with no JS, on the mini event loop. Each
      // stage of the pipeline writes more than a pipe holds to its own FIFO.
      // The stage for stdout must finish while nothing reads stderr.
      test.skipIf(!isLinux)("two blocking FIFOs under a shell script", async () => {
        using dir = tempDir("shell-fifo-script", { "two.sh": "seq 1 30000 1>&2 | seq 1 30000\n" });
        const expected = Array.from({ length: 30000 }, (_, i) => i + 1).join("\n") + "\n";
        const paths = ["out.fifo", "err.fifo"].map(name => join(String(dir), name));
        await using mk = Bun.spawn({ cmd: [Bun.which("mkfifo")!, ...paths], env: bunEnv });
        await mk.exited;

        // The read end lets the blocking open of the write end return.
        const [out, err] = paths.map(path => ({
          read: fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK),
          write: fs.openSync(path, fs.constants.O_WRONLY),
        }));
        try {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "two.sh"],
            cwd: String(dir),
            env: bunEnv,
            stdout: out.write,
            stderr: err.write,
          });
          let exited = false;
          const exitCode = proc.exited.finally(() => (exited = true));

          const buf = Buffer.alloc(1 << 20);
          // Reads what the script writes to the FIFO, until the script has nothing more for it.
          const read = async (fd: number) => {
            const chunks: Buffer[] = [];
            let total = 0;
            while (total < expected.length) {
              let n = 0;
              try {
                n = fs.readSync(fd, buf, 0, buf.length);
              } catch (e: any) {
                if (e.code !== "EAGAIN") throw e;
              }
              if (n > 0) chunks.push(Buffer.from(buf.subarray(0, n)));
              else if (exited) break;
              else await new Promise<void>(resolve => setImmediate(resolve));
              total += n;
            }
            return Buffer.concat(chunks).toString();
          };
          const stdout = await read(out.read);
          const stderr = await read(err.read);
          expect({ stdout: stdout === expected, stderr: stderr === expected, exitCode: await exitCode }).toEqual({
            stdout: true,
            stderr: true,
            exitCode: 0,
          });
        } finally {
          for (const fd of [out.read, out.write, err.read, err.write]) fs.closeSync(fd);
        }
      });

      // Bun.spawn and node's child_process give a child a socketpair for a
      // piped stdout. `lazy` keeps this process from reading it until the
      // child reports on stderr that its event loop still turns. Linux 6.5
      // and later take pwritev2(RWF_NOWAIT) on a socket, so the second run
      // turns that off to reach the write that every kernel has.
      test.each([
        ["a socket", {}],
        ...(isLinux ? [["a socket without RWF_NOWAIT", { BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK: "1" }] as const] : []),
      ])("%s", async (_, env) => {
        const length = 4 * 1024 * 1024;
        const big = Buffer.alloc(length, "abcdefghijklmnopqrstuvw").toString();
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
              import { $ } from "bun";
              import * as fs from "node:fs";

              const big = Buffer.alloc(${length}, "abcdefghijklmnopqrstuvw").toString();
              const socket = fs.fstatSync(1).isSocket();
              // Only Linux shows the flags of the description that this process shares with its parent.
              const flags =
                process.platform === "linux" &&
                /flags:\\s+(\\d+)/.exec(fs.readFileSync("/proc/self/fdinfo/1", "utf8"))![1];
              const blocking = flags ? (parseInt(flags, 8) & fs.constants.O_NONBLOCK) === 0 : null;
              let done = false;
              // The first chunks are small: the writer learns what the fd is on a later, larger write.
              const command = $\`echo first; echo second; echo \${big}; echo last\`.then(
                result => ((done = true), result),
              );
              // The shell has tried its write long before the 100th turn.
              let turns = 0;
              await new Promise<void>(resolve => {
                const turn = () => (++turns === 100 ? resolve() : setImmediate(turn));
                setImmediate(turn);
              });
              console.error(JSON.stringify({ socket, blocking, doneWhileFull: done }));
              process.exitCode = (await command).exitCode;
            `,
          ],
          env: { ...bunEnv, ...env },
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
        expect({ report, intact: stdout === "first\nsecond\n" + big + "\nlast\n", exitCode }).toEqual({
          report: { socket: true, blocking: isLinux ? true : null, doneWhileFull: false },
          intact: true,
          exitCode: 0,
        });
      });

      // A tty has no write that cannot wait. It keeps the plain write, as in
      // Node, and the bytes still arrive once and in order.
      test.concurrent("a tty", async () => {
        const length = 100 * 1024;
        const big = Buffer.alloc(length, "abcdefghijklmnopqrstuvw").toString();
        const decoder = new TextDecoder();
        let output = "";
        const complete = Promise.withResolvers<void>();
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
              import { $ } from "bun";
              const big = Buffer.alloc(${length}, "abcdefghijklmnopqrstuvw").toString();
              process.exitCode = (await $\`echo \${big}\`.nothrow()).exitCode;
            `,
          ],
          env: bunEnv,
          terminal: {
            data(_terminal, chunk) {
              output += decoder.decode(chunk, { stream: true });
              if (output.length >= length + 2) complete.resolve();
            },
            exit() {
              complete.reject(new Error("the terminal closed after " + output.length + " bytes"));
            },
          },
        });
        const [exitCode] = await Promise.all([proc.exited, complete.promise]);
        expect({ intact: output === big + "\r\n", length: output.length, exitCode }).toEqual({
          intact: true,
          length: length + 2,
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
