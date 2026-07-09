import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// O_NONBLOCK is a property of the open file *description*, which fd inheritance
// shares with the parent shell and every sibling in a pipeline. Bun sets it on
// stdout/stderr when they're pipes (to drive its event loop); if it's not
// cleared at exit, later blocking writers in the same pipeline hit EAGAIN and
// truncate at the pipe buffer. Node restores the original flags in ResetStdio().
//
// Uses /proc/self/fdinfo to read the kernel's view of the flags (Linux-only);
// the fix itself is POSIX-generic.
describe.concurrent.skipIf(!isLinux)("stdio does not leak O_NONBLOCK onto the inherited pipe after exit", () => {
  const O_NONBLOCK = 0o4000; // Linux value

  async function flagsAround(targetFd: 1 | 2, trigger: string) {
    // The shell's fd {targetFd} is a pipe (Bun.spawn "pipe"). Dup it to fd 5 so
    // we can read the shared open file description's flags from /proc before
    // and after bun runs. Probe lines go to the *other* stdio stream so they
    // don't interleave with anything bun writes to the target.
    const probeFd = targetFd === 1 ? 2 : 1;
    const script = `
      exec 5>&${targetFd}
      printf 'before %s\\n' "$(grep '^flags:' /proc/self/fdinfo/5)" >&${probeFd}
      "$1" --no-install -e "$2" </dev/null
      printf 'bunexit %s\\n' "$?" >&${probeFd}
      printf 'after %s\\n' "$(grep '^flags:' /proc/self/fdinfo/5)" >&${probeFd}
    `;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", script, "sh", bunExe(), trigger],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const probe = targetFd === 1 ? stderr : stdout;
    const m = probe.match(/^before flags:\s*(\S+)\nbunexit (\d+)\nafter flags:\s*(\S+)\n$/);
    if (!m) {
      // Surface the raw output so failures are debuggable.
      expect({ stdout, stderr, exitCode }).toEqual("probe output did not match expected shape");
    }
    const [, before, bunExit, after] = m!;
    return {
      before: parseInt(before, 8),
      after: parseInt(after, 8),
      bunExit: Number(bunExit),
      shellExit: exitCode,
    };
  }

  const cases: Array<[string, 1 | 2, string]> = [
    ["process.stdout access", 1, `void process.stdout.isTTY; process.exit(0)`],
    ["process.stdout.write", 1, `process.stdout.write("x")`],
    ["process.stderr.write", 2, `process.stderr.write("x")`],
    ["Bun.file(1).writer()", 1, `const w = Bun.file(1).writer(); w.write("x"); await w.end()`],
    ["Bun.stdout.writer()", 1, `const w = Bun.stdout.writer(); w.write("x"); await w.end()`],
  ];

  test.each(cases)("%s", async (_name, targetFd, trigger) => {
    const { before, after, bunExit, shellExit } = await flagsAround(targetFd, trigger);
    expect({
      before: before.toString(8),
      after: after.toString(8),
      afterHasNonblock: (after & O_NONBLOCK) !== 0,
      bunExit,
      shellExit,
    }).toEqual({
      before: before.toString(8),
      after: before.toString(8),
      afterHasNonblock: false,
      bunExit: 0,
      shellExit: 0,
    });
  });

  test.skipIf(!Bun.which("python3"))(
    "preserves O_NONBLOCK on the pipe if it was already set when bun started",
    async () => {
      // Set O_NONBLOCK on the pipe *before* bun runs; bun must not clear a flag
      // it didn't set. python3 flips the bit (sh has no fcntl).
      const script = `
      exec 5>&1
      python3 -c 'import fcntl,os; fcntl.fcntl(5, fcntl.F_SETFL, fcntl.fcntl(5, fcntl.F_GETFL) | os.O_NONBLOCK)'
      printf 'before %s\\n' "$(grep '^flags:' /proc/self/fdinfo/5)" >&2
      "$1" --no-install -e 'void process.stdout.isTTY' </dev/null
      printf 'bunexit %s\\n' "$?" >&2
      printf 'after %s\\n' "$(grep '^flags:' /proc/self/fdinfo/5)" >&2
    `;
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", script, "sh", bunExe()],
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const m = stderr.match(/^before flags:\s*(\S+)\nbunexit (\d+)\nafter flags:\s*(\S+)\n$/);
      if (!m) expect({ stdout, stderr, exitCode }).toEqual("probe output did not match expected shape");
      const before = parseInt(m![1], 8);
      const after = parseInt(m![3], 8);
      expect({
        beforeHasNonblock: (before & O_NONBLOCK) !== 0,
        after: after.toString(8),
        bunExit: Number(m![2]),
      }).toEqual({
        beforeHasNonblock: true,
        after: before.toString(8),
        bunExit: 0,
      });
    },
  );
});
