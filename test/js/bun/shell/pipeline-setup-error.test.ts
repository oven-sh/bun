import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

// Pipeline setup failures (socketpair/dupeForSubshell returning EMFILE etc.)
// must surface as a recoverable exitCode + stderr message under `.nothrow()`,
// not as a rejected promise.

function makeFixture(opts: { quiet: boolean; release: number }) {
  const call = opts.quiet ? ".nothrow().quiet()" : ".nothrow()";
  return /* js */ `
const fs = require("fs");
const fds = [];
try {
  while (true) fds.push(fs.openSync("/dev/null", "r"));
} catch {}
// Leave a few free so the interpreter can get far enough to reach pipeline
// setup, but not enough for all the socketpairs an 8-stage pipeline needs.
for (let i = 0; i < ${opts.release}; i++) if (fds.length) fs.closeSync(fds.pop());

const { $ } = require("bun");
(async () => {
  try {
    const r = await $\`echo a | echo b | echo c | echo d | echo e | echo f | echo g | echo h\`${call};
    console.log("RESOLVED");
    console.log("exitCode=" + r.exitCode);
    console.log("stderr=" + JSON.stringify(r.stderr.toString()));
  } catch (e) {
    console.log("REJECTED: " + (e && e.message ? e.message : e));
  } finally {
    for (const fd of fds) try { fs.closeSync(fd); } catch {}
    process.exit(0);
  }
})();
`;
}

// Bun raises RLIMIT_NOFILE to the hard limit on startup; cap the hard limit
// so fd exhaustion is quick (and the debug build doesn't spend seconds in the
// open loop).
function spawnWithLowFdLimit(script: string) {
  return Bun.spawn({
    cmd: ["/bin/sh", "-c", `ulimit -n 128 && exec "$0" -e "$1"`, bunExe(), script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe.skipIf(!isPosix)("pipeline setup error under .nothrow()", () => {
  test("socketpair failure resolves with exitCode=1 and stderr message (quiet)", async () => {
    await using proc = spawnWithLowFdLimit(makeFixture({ quiet: true, release: 4 }));
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    const lines = stdout.trim().split("\n");
    expect({ lines, stderr }).toEqual({
      lines: [
        "RESOLVED",
        "exitCode=1",
        expect.stringMatching(/^stderr="bun: .+\\n"$/),
      ],
      stderr: expect.anything(),
    });
    expect(exitCode).toBe(0);
  });

  test("socketpair failure resolves with exitCode=1 and writes to stderr (non-quiet)", async () => {
    await using proc = spawnWithLowFdLimit(makeFixture({ quiet: false, release: 6 }));
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("RESOLVED");
    expect(lines[1]).toBe("exitCode=1");
    // non-quiet: message goes to the process's real stderr fd (and is also
    // captured into r.stderr).
    expect(stderr).toMatch(/^bun: .+\n/);
    expect(lines[2]).toMatch(/^stderr="bun: .+\\n"$/);
    expect(exitCode).toBe(0);
  });
});
