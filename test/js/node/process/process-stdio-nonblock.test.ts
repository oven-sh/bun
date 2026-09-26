import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// O_NONBLOCK is per open file *description* (shared with the parent shell and
// pipeline siblings); leaving it set after exit makes later blocking writers
// in the pipeline hit EAGAIN. Uses /proc/self/fdinfo (Linux-only ground truth).
describe.concurrent.skipIf(!isLinux)("stdio does not leak O_NONBLOCK onto the inherited pipe after exit", () => {
  const O_NONBLOCK = 0o4000; // Linux value

  function parseProbe(probe: string, raw: { stdout: string; stderr: string; exitCode: number }) {
    const before = probe.match(/^before flags:\s*(\S+)$/m)?.[1];
    const bunExit = probe.match(/^bunexit (\S+)$/m)?.[1];
    const after = probe.match(/^after flags:\s*(\S+)$/m)?.[1];
    if (before === undefined || bunExit === undefined || after === undefined) {
      expect(raw).toEqual("probe output did not match expected shape");
    }
    return { before: parseInt(before!, 8), after: parseInt(after!, 8), bunExit: Number(bunExit) };
  }

  async function flagsAround(targetFd: 1 | 2, trigger: string) {
    // The shell's fd {targetFd} is a pipe (Bun.spawn "pipe"). Dup it to fd 5 so
    // we can read the shared open file description's flags from /proc before
    // and after bun runs. Probe lines go to the *other* stdio stream.
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
    const raw = { stdout, stderr, exitCode };
    return { ...parseProbe(targetFd === 1 ? stderr : stdout, raw), shellExit: exitCode };
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

  test("SIGTERM death with all stdio non-TTY", async () => {
    // Fully headless: stdin=file, stdout=pipe, stderr=/dev/null (no TTY on any
    // fd). bun touches stdout, writes a ready marker, then blocks; the shell
    // waits for the marker (so O_NONBLOCK is definitely set) then sends SIGTERM.
    const script = `
      exec 5>&1
      printf 'before %s\\n' "$(grep '^flags:' /proc/self/fdinfo/5)" >&2
      READY=$(mktemp -u); export READY
      mkfifo "$READY"
      "$1" --no-install -e 'void process.stdout.isTTY; require("fs").writeFileSync(process.env.READY, "1"); setInterval(() => {}, 1e9)' \
        </dev/null 2>/dev/null &
      pid=$!
      cat "$READY" >/dev/null
      rm -f "$READY"
      kill -TERM $pid
      wait $pid
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
    const { before, after, bunExit } = parseProbe(stderr, { stdout, stderr, exitCode });
    expect({
      after: after.toString(8),
      afterHasNonblock: (after & O_NONBLOCK) !== 0,
      bunExit,
    }).toEqual({
      after: before.toString(8),
      afterHasNonblock: false,
      bunExit: 143, // 128 + SIGTERM
    });
  });

  test.skipIf(!Bun.which("python3"))(
    "preserves O_NONBLOCK on the pipe if it was already set when bun started",
    async () => {
      // python3 flips the bit before bun runs (sh has no fcntl); bun must not
      // clear a flag it didn't set.
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
      const { before, after, bunExit } = parseProbe(stderr, { stdout, stderr, exitCode });
      expect({
        beforeHasNonblock: (before & O_NONBLOCK) !== 0,
        after: after.toString(8),
        bunExit,
      }).toEqual({
        beforeHasNonblock: true,
        after: before.toString(8),
        bunExit: 0,
      });
    },
  );
});
