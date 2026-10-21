import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix } from "harness";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe.if(isPosix)("IOWriter epipe", () => {
  TestBuilder.command`yes | head`
    .exitCode(0)
    .stdout("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n")
    .runAsTest("builtin pipe to command");

  test("concurrent", async () => {
    const promises = Array(100)
      .fill(0)
      .map(() => Bun.$`yes | head`.text());

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result).toBe("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n");
    }
  });
});

// `a | b` gives subprocesses a pipe(2), like a POSIX shell does. A socketpair
// is visible to them: "is my stdin a pipe" checks (`test -p /dev/stdin`) say
// no, and on Linux open("/dev/stdin") fails with ENXIO and a writer whose
// reader exits with data unread gets ECONNRESET, which it reports on stderr,
// instead of SIGPIPE.
describe.if(isPosix)("pipeline pipes", () => {
  async function run(shell: ReturnType<typeof $>) {
    const { stdout, stderr, exitCode } = await shell.env(bunEnv).quiet().nothrow();
    return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
  }

  // Reports on stderr, because stdout can be the pipe.
  const printKindOfFd = (fd: number) =>
    `const stat = require("fs").fstatSync(${fd}); console.error(stat.isFIFO() ? "fifo" : stat.isSocket() ? "socket" : "other");`;

  test.concurrent("subprocess | subprocess: stdout and stdin are FIFOs", async () => {
    expect(await run($`${bunExe()} -e ${printKindOfFd(1)} | ${bunExe()} -e ${printKindOfFd(0)}`)).toEqual({
      stdout: "",
      stderr: "fifo\nfifo\n",
      exitCode: 0,
    });
  });

  test.concurrent("builtin | subprocess: stdin is a FIFO", async () => {
    expect(await run($`echo hi | ${bunExe()} -e ${printKindOfFd(0)}`)).toEqual({
      stdout: "",
      stderr: "fifo\n",
      exitCode: 0,
    });
  });

  test.concurrent("a command named by a variable writes to a FIFO too", async () => {
    expect(await run($`cmd=echo; $cmd hi | ${bunExe()} -e ${printKindOfFd(0)}`)).toEqual({
      stdout: "",
      stderr: "fifo\n",
      exitCode: 0,
    });
  });

  // A subshell or an `if` shares its write end between builtins and
  // subprocesses. It keeps the socketpair.
  test.todo("subshell | subprocess: stdin is a FIFO", async () => {
    expect(await run($`(echo hi) | ${bunExe()} -e ${printKindOfFd(0)}`)).toEqual({
      stdout: "",
      stderr: "fifo\n",
      exitCode: 0,
    });
  });

  test.concurrent("a subprocess can open /dev/stdin", async () => {
    const readDevStdin = `process.stdout.write(require("fs").readFileSync("/dev/stdin", "utf8"));`;
    expect(await run($`echo hi | ${bunExe()} -e ${readDevStdin}`)).toEqual({
      stdout: "hi\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // docs/runtime/environment-variables.mdx: `echo "API_KEY=..." | bun --env-file=/dev/stdin src/index.ts`
  test.concurrent("--env-file=/dev/stdin reads the pipe", async () => {
    const printEnv = `console.log(process.env.BUNTEST_PIPE);`;
    expect(await run($`echo BUNTEST_PIPE=1 | ${bunExe()} --env-file=/dev/stdin -e ${printEnv}`)).toEqual({
      stdout: "1\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a subprocess that outlives its reader is killed by SIGPIPE", async () => {
    // `head` exits while `yes` still writes. 141 is 128 + SIGPIPE.
    expect(await run($`sh -c ${'yes; echo "yes exited with $?" >&2'} | head -n 2`)).toEqual({
      stdout: "y\ny\n",
      stderr: "yes exited with 141\n",
      exitCode: 0,
    });
  });

  // Only the end a builtin writes to is O_NONBLOCK. A subprocess that inherits
  // the flag gets EAGAIN where it expects to block.
  test.concurrent.skipIf(!isLinux)("no pipe end of a subprocess is O_NONBLOCK", async () => {
    const printNonblocking = (fd: number) =>
      `const flags = parseInt(/^flags:\\s*(\\d+)/m.exec(require("fs").readFileSync("/proc/self/fdinfo/${fd}", "utf8"))[1], 8); console.error("fd ${fd} nonblocking:", (flags & 0o4000) !== 0);`;
    const exe = bunExe();
    const results = await Promise.all([
      run($`${exe} -e ${printNonblocking(1)} | ${exe} -e ${printNonblocking(0)}`),
      run($`exe=${exe}; $exe -e ${printNonblocking(1)} | ${exe} -e ${printNonblocking(0)}`),
      run($`echo hi | ${exe} -e ${printNonblocking(0)}`),
    ]);
    expect(results.map(({ stderr }) => stderr.split("\n").filter(Boolean).sort())).toEqual([
      ["fd 0 nonblocking: false", "fd 1 nonblocking: false"],
      ["fd 0 nonblocking: false", "fd 1 nonblocking: false"],
      ["fd 0 nonblocking: false"],
    ]);
  });

  test.concurrent("a builtin writes more than the pipe holds to a subprocess", async () => {
    // 588895 bytes is several times the capacity of a pipe, so the builtin has to wait for the reader.
    const countBytes = `let total = 0; for await (const chunk of process.stdin) total += chunk.length; console.log(total);`;
    expect(await run($`seq 1 100000 | ${bunExe()} -e ${countBytes}`)).toEqual({
      stdout: "588895\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
