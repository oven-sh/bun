import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, tempDir } from "harness";
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

// A command is a builtin or a spawned process, and each sets up its redirect
// in its own code. `echo` and `basename` are builtins on every platform:
// `basename` with no operand prints its usage to stderr and exits 1. Each
// spawned twin writes the same bytes. It is `sh` where there is one, because
// a debug build of bun takes a second to start.
describe.concurrent("redirect to a Bun.file(fd)", () => {
  const usage = "usage: basename string\n";
  const commands = {
    builtin: { out: ["echo", "out"], err: ["basename"] },
    spawned: isWindows
      ? {
          out: [bunExe(), "-e", `process.stdout.write("out\\n")`],
          err: [bunExe(), "-e", `process.stderr.write(${JSON.stringify(usage)}); process.exit(1)`],
        }
      : {
          out: ["sh", "-c", "echo out"],
          err: ["sh", "-c", `echo '${usage.trimEnd()}' >&2; exit 1`],
        },
  };
  type Route = keyof typeof commands;
  const routes = Object.keys(commands) as Route[];
  const immutable = "Cannot redirect stdout/stderr to an immutable blob. Expected a file";

  // Runs a fixture in a fresh bun process and returns the JSON that it prints last.
  async function runFixture(dir: string, env: Record<string, string | undefined> = bunEnv, stdin?: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: dir,
      env,
      stdin: stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (stdin !== undefined) {
      proc.stdin!.write(stdin);
      proc.stdin!.end();
    }
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let printed: unknown = stdout;
    try {
      printed = JSON.parse(stdout.trim().split("\n").pop() ?? "");
    } catch {}
    return { printed, stderr, exitCode };
  }

  const descriptor = (fd: number) => Bun.file(fd);
  const inResponse = (fd: number) => new Response(Bun.file(fd));
  // The shell opens a path with the flags of the operator. An open descriptor
  // keeps its own flags, so each test opens it the way the operator would.
  const redirects = [
    [">", "w", "out", { exitCode: 0, file: "out\n" }],
    [">>", "a", "out", { exitCode: 0, file: "old content\nout\n" }],
    ["2>", "w", "err", { exitCode: 1, file: usage }],
    ["&>", "w", "out", { exitCode: 0, file: "out\n" }],
    ["&>", "w", "err", { exitCode: 1, file: usage }],
  ] as const;
  const cells = routes.flatMap(route =>
    (
      [
        ["Bun.file(fd)", descriptor],
        ["new Response(Bun.file(fd))", inResponse],
      ] as const
    ).flatMap(([name, wrap]) =>
      redirects.map(([operator, flags, stream, expected]) => ({
        route,
        name,
        wrap,
        operator,
        flags,
        stream,
        expected,
      })),
    ),
  );

  test.each(cells)(
    "$route command: $operator $name takes std$stream",
    async ({ route, wrap, operator, flags, stream, expected }) => {
      using dir = tempDir("shell-fd-redirect", { "out.txt": "old content\n" });
      const path = join(String(dir), "out.txt");
      const fd = fs.openSync(path, flags);
      try {
        const target = wrap(fd);
        const { exitCode, stdout, stderr } = await $`${commands[route][stream]} ${{ raw: operator }} ${target}`
          .env(bunEnv)
          .quiet()
          .nothrow();
        expect({
          exitCode,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          file: fs.readFileSync(path, "utf8"),
          bodyUsed: target instanceof Response ? target.bodyUsed : null,
        }).toEqual({ ...expected, stdout: "", stderr: "", bodyUsed: target instanceof Response ? true : null });
      } finally {
        fs.closeSync(fd);
      }
    },
  );

  test.each(routes)("%s command: a descriptor keeps its offset and stays open", async route => {
    using dir = tempDir("shell-fd-redirect", { "out.txt": "0123456789\n" });
    const path = join(String(dir), "out.txt");
    const fd = fs.openSync(path, "r+");
    try {
      // `>` does not truncate an open descriptor, and `>>` does not seek it.
      await $`${commands[route].out} > ${Bun.file(fd)}`.env(bunEnv).quiet();
      await $`${commands[route].out} >> ${new Response(Bun.file(fd))}`.env(bunEnv).quiet();
      expect(fs.readFileSync(path, "utf8")).toBe("out\nout\n89\n");
      // The shell did not close the descriptor.
      expect(fs.fstatSync(fd).size).toBe(11);
    } finally {
      fs.closeSync(fd);
    }
  });

  test.each(routes)("%s command: Bun.stdout and Bun.stderr are the streams of the process", async route => {
    using dir = tempDir("shell-fd-redirect", {
      "fixture.ts": /* ts */ `
        import { $ } from "bun";
        const commands = ${JSON.stringify(commands[route])};
        await $\`\${commands.out} > \${Bun.stdout}\`.quiet();
        await $\`\${commands.err} 2> \${Bun.stderr}\`.quiet().nothrow();
      `,
    });
    expect(await runFixture(String(dir))).toEqual({
      printed: "out\n",
      stderr: expect.stringContaining(usage),
      exitCode: 0,
    });
  });

  // The descriptor is the blocking write end of a full FIFO, and the reader is
  // on the same thread. The builtin must wait for room without a blocking write.
  test.skipIf(!isPosix)("builtin command: a write to a full pipe waits for the reader", async () => {
    using dir = tempDir("shell-fd-redirect", {
      "fixture.ts": /* ts */ `
        import { $ } from "bun";
        import * as fs from "node:fs";
        const rfd = fs.openSync("fifo", fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        // A second, nonblocking write end fills the pipe.
        const fill = fs.openSync("fifo", fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        const wfd = fs.openSync("fifo", fs.constants.O_WRONLY);
        try { while (true) fs.writeSync(fill, Buffer.alloc(4096, "y")); } catch {}

        let tail = "";
        const buf = Buffer.alloc(65536);
        const drain = () => {
          let n = 0;
          try { n = fs.readSync(rfd, buf); } catch (e: any) { if (e.code !== "EAGAIN") throw e; }
          if (n > 0) tail = (tail + buf.toString("latin1", 0, n)).slice(-4);
          return n;
        };
        let result: { exitCode: number } | undefined;
        const pending = $\`echo out > \${Bun.file(wfd)}\`.quiet().nothrow().then(r => (result = r));
        while (!result) {
          drain();
          await new Promise<void>(r => setImmediate(r));
        }
        await pending;
        while (drain() > 0) {}
        console.log(JSON.stringify({ exitCode: result.exitCode, tail }));
      `,
    });
    await using mkfifo = Bun.spawn({ cmd: [Bun.which("mkfifo")!, join(String(dir), "fifo")], env: bunEnv });
    expect(await mkfifo.exited).toBe(0);
    expect(await runFixture(String(dir))).toEqual({
      printed: { exitCode: 0, tail: "out\n" },
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  // The write is larger than the pipe, and the reader is on the same thread.
  async function writeMoreThanThePipeHolds(openFlags: string) {
    using dir = tempDir("shell-fd-redirect", {
      "fixture.ts": /* ts */ `
        import { $ } from "bun";
        import * as fs from "node:fs";
        const rfd = fs.openSync("fifo", fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const wfd = fs.openSync("fifo", ${openFlags});
        const big = Buffer.alloc(200_000, "z").toString();

        let bytes = 0;
        let last = "";
        const buf = Buffer.alloc(65536);
        const drain = () => {
          let n = 0;
          try { n = fs.readSync(rfd, buf); } catch (e: any) { if (e.code !== "EAGAIN") throw e; }
          if (n > 0) last = String.fromCharCode(buf[n - 1]);
          bytes += n;
          return n;
        };
        let result: { exitCode: number } | undefined;
        const pending = $\`echo \${big} > \${Bun.file(wfd)}\`.quiet().nothrow().then(r => (result = r));
        while (!result) {
          drain();
          await new Promise<void>(r => setImmediate(r));
        }
        await pending;
        while (drain() > 0) {}
        console.log(JSON.stringify({ exitCode: result.exitCode, bytes, last }));
      `,
    });
    await using mkfifo = Bun.spawn({ cmd: [Bun.which("mkfifo")!, join(String(dir), "fifo")], env: bunEnv });
    expect(await mkfifo.exited).toBe(0);
    expect(await runFixture(String(dir))).toEqual({
      printed: { exitCode: 0, bytes: 200_001, last: "\n" },
      stderr: expect.any(String),
      exitCode: 0,
    });
  }

  test.skipIf(!isPosix)("builtin command: a write larger than the pipe arrives on a nonblocking descriptor", () =>
    writeMoreThanThePipeHolds("fs.constants.O_WRONLY | fs.constants.O_NONBLOCK"),
  );

  // Linux: the shell does not make the descriptor nonblocking, so this write waits
  // in write(2) and the reader never runs. The one-slot write of #46307 ends the wait.
  test.todo("builtin command: a write larger than the pipe arrives on a blocking descriptor", () =>
    writeMoreThanThePipeHolds("fs.constants.O_WRONLY"),
  );

  test.skipIf(!isPosix)("builtin command: no descriptor leaks, and each descriptor keeps its flags", async () => {
    using dir = tempDir("shell-fd-redirect", {
      "out.txt": "",
      "fixture.ts": /* ts */ `
        import { $ } from "bun";
        import * as fs from "node:fs";
        const fd = fs.openSync("out.txt", "r+");
        const rfd = fs.openSync("fifo", fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const blocking = fs.openSync("fifo", fs.constants.O_WRONLY);
        const nonblocking = fs.openSync("fifo", fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        // Linux shows the file status flags of a descriptor.
        const flags = () =>
          ${isLinux}
            ? [fd, blocking, nonblocking].map(
                fd => fs.readFileSync("/proc/self/fdinfo/" + fd, "utf8").match(/^flags:\\s*(\\d+)/m)![1],
              )
            : [];
        const opened = flags();
        const pipe = Buffer.alloc(16);
        const run = async (count: number) => {
          for (let i = 0; i < count; i++) {
            await $\`echo x > \${Bun.file(fd)}\`.quiet();
            await $\`echo x >> \${new Response(Bun.file(fd))}\`.quiet();
            await $\`basename 2> \${Bun.file(fd)}\`.quiet().nothrow();
            await $\`echo x &> \${Bun.file(fd)}\`.quiet();
            await $\`echo x < \${Bun.file(fd)}\`.quiet();
            await $\`echo x > \${Bun.file(blocking)}\`.quiet();
            await $\`echo x > \${Bun.file(nonblocking)}\`.quiet();
            if (fs.readSync(rfd, pipe) !== 4) throw new Error("the pipe did not get both lines");
            await $\`echo x > \${Bun.file(0x3fffffff)}\`.quiet().nothrow();
            await $\`echo x > \${new Response(new Blob(["x"]))}\`.quiet().then(() => {}, () => {});
          }
        };
        // The first runs open what the process opens one time.
        await run(2);
        const before = fs.readdirSync("/dev/fd").length;
        await run(20);
        console.log(JSON.stringify({
          leaked: fs.readdirSync("/dev/fd").length - before,
          flagsChanged: flags().join() !== opened.join(),
          size: fs.fstatSync(fd).size,
        }));
      `,
    });
    await using mkfifo = Bun.spawn({ cmd: [Bun.which("mkfifo")!, join(String(dir), "fifo")], env: bunEnv });
    expect(await mkfifo.exited).toBe(0);
    expect(await runFixture(String(dir))).toEqual({
      // Each run writes "x\n" three times and the usage line one time to the file.
      printed: { leaked: 0, flagsChanged: false, size: 22 * (3 * 2 + usage.length) },
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  // POSIX only: on Windows the failure comes from another call, and its text was not measured.
  const notOpen = routes.flatMap(route =>
    (
      [
        [">", "Bun.file(fd)", descriptor],
        [">", "new Response(Bun.file(fd))", inResponse],
        ["<", "Bun.file(fd)", descriptor],
      ] as const
    ).map(([operator, name, wrap]) => ({ route, operator, name, wrap })),
  );
  test.skipIf(!isPosix).each(notOpen)(
    "$route command: $operator $name fails when the descriptor is not open",
    async ({ route, operator, wrap }) => {
      const fd = 0x3fffffff;
      const target = wrap(fd);
      const { exitCode, stdout, stderr } = await $`${commands[route].out} ${{ raw: operator }} ${target}`
        .env(bunEnv)
        .quiet()
        .nothrow();
      expect({
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        bodyUsed: target instanceof Response ? target.bodyUsed : null,
      }).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: `bun: Bad file descriptor: ${fd}`,
        bodyUsed: target instanceof Response ? false : null,
      });
    },
  );

  // `cat` is the one builtin that reads its stdin. It is a builtin on Windows,
  // and on POSIX only with this flag.
  const builtinCat = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };
  const catFixture = (target: string) => ({
    "fixture.ts": /* ts */ `
      import { $ } from "bun";
      import * as fs from "node:fs";
      const fd = process.env.READ_FILE ? fs.openSync("in.txt", "r") : 0;
      const result = await $\`cat < \${${target}}\`.quiet().nothrow();
      console.log(JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout.toString() }));
    `,
    "in.txt": "from the file\n",
  });
  const stdinTargets = [["Bun.file(fd)"], ["new Response(Bun.file(fd))"]] as const;

  test.each(stdinTargets)("builtin cat < ${%s} reads a pipe", async target => {
    using dir = tempDir("shell-fd-redirect", catFixture(target));
    expect(await runFixture(String(dir), builtinCat, "from the pipe\n")).toEqual({
      printed: { exitCode: 0, stdout: "from the pipe\n" },
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  // The builtin `cat` cannot read a regular file on POSIX: it exits 1 for `cat < file` too (#35337).
  test.todoIf(isPosix).each(stdinTargets)("builtin cat < ${%s} reads a regular file", async target => {
    using dir = tempDir("shell-fd-redirect", catFixture(target));
    expect(await runFixture(String(dir), { ...builtinCat, READ_FILE: "1" })).toEqual({
      printed: { exitCode: 0, stdout: "from the file\n" },
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

  // `cat` is a builtin on Windows and a spawned command on POSIX.
  test.each([
    ["Bun.file(fd)", descriptor],
    ["new Response(Bun.file(fd))", inResponse],
  ] as const)("cat < ${%s} reads the file", async (_name, wrap) => {
    using dir = tempDir("shell-fd-redirect", { "in.txt": "from the file\n" });
    const fd = fs.openSync(join(String(dir), "in.txt"), "r");
    try {
      const { exitCode, stdout } = await $`cat < ${wrap(fd)}`.env(bunEnv).quiet().nothrow();
      expect({ exitCode, stdout: stdout.toString() }).toEqual({ exitCode: 0, stdout: "from the file\n" });
    } finally {
      fs.closeSync(fd);
    }
  });

  // A builtin cannot write to bytes in memory. The refusal reads nothing.
  const inMemory = [
    ...[">", ">>", "2>", "&>"].map(operator => [operator, "new Response(blob)", false] as const),
    [">", "a Response whose .body was read", true] as const,
  ];
  test.each(inMemory)("builtin command: %s ${%s} is refused and stays unread", async (operator, _name, readBody) => {
    const response = new Response(new Blob(["in memory"]));
    const stream = readBody ? response.body! : undefined;
    let error: unknown;
    try {
      await $`echo out ${{ raw: operator }} ${response}`.quiet().nothrow();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect({
      message: (error as Error).message,
      bodyUsed: response.bodyUsed,
      locked: stream ? stream.locked : false,
      body: await response.text(),
    }).toEqual({
      message: immutable,
      bodyUsed: false,
      locked: false,
      body: "in memory",
    });
  });

  // A spawned command refuses too, but with a TypeError that has another text, and after it took the body.
  test.todo("spawned command: > ${new Response(blob)} is refused the way a builtin refuses it", async () => {
    const response = new Response(new Blob(["in memory"]));
    await expect($`${commands.spawned.out} > ${response}`.env(bunEnv).quiet()).rejects.toThrow(immutable);
    expect(response.bodyUsed).toBe(false);
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
