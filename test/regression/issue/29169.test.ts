// https://github.com/oven-sh/bun/issues/29169
//
// process.ppid was a lazy PropertyCallback in BunProcess.cpp, so
// the value was captured once on first access and cached on the
// process object. If the original parent died and the child was
// reparented to init (or a subreaper), process.ppid stayed
// frozen at the dead pid — breaking the common orphan-detection
// pattern `if (process.ppid === 1) exit()`.
//
// The fix calls getppid()/uv_os_getppid() on every read. To JS the
// property is a plain data property, as in Node, so a descriptor
// cannot tell a live value from a cached one. The first test below
// reparents a process and watches the value change.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { readFileSync } from "node:fs";

test("process.ppid is a data property to JS (#29169)", () => {
  expect(Object.getOwnPropertyDescriptor(process, "ppid")).toEqual({
    value: process.ppid,
    writable: true,
    enumerable: true,
    configurable: true,
  });
});

// Windows keeps the pid of a dead parent, so there is nothing to observe there.
test.skipIf(isWindows)("process.ppid follows a reparent (#29169)", async () => {
  // The first process spawns the second one, waits until that one has read process.ppid, and exits.
  // The OS then gives the second process a new parent, and it polls process.ppid until the value
  // changes. Its stdout is the pipe of this test, so the read below ends when it exits.
  const second = `
    const before = process.ppid;
    process.send("read");
    const deadline = performance.now() + 30_000;
    (function poll() {
      const now = process.ppid;
      if (now !== before || performance.now() > deadline) {
        console.log(JSON.stringify({ beforeWasTheFirstProcess: before === Number(process.env.FIRST_PID), changed: now !== before }));
        process.exit(0);
      }
      setImmediate(poll);
    })();
  `;
  const first = `
    Bun.spawn({
      cmd: [process.execPath, "-e", process.env.SECOND_SOURCE],
      env: { ...process.env, FIRST_PID: String(process.pid) },
      stdio: ["ignore", "inherit", "inherit"],
      ipc() {
        process.exit(0);
      },
    });
  `;
  // With this flag (the CI runner sets it on some lanes) a process kills its descendants when it
  // exits, and exits when its parent does.
  const { BUN_FEATURE_FLAG_NO_ORPHANS: _, ...env } = bunEnv;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", first],
    env: { ...env, SECOND_SOURCE: second },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ beforeWasTheFirstProcess: true, changed: true });
  expect(exitCode).toBe(0);
});

// Sanity check on Linux: the getter's return value agrees with
// what the kernel reports in /proc/self/stat. Runs synchronously
// in the test-runner process itself — no subprocess spawn — so
// there's no CI-lane-specific process-lifecycle variance.
test.skipIf(!isLinux)("process.ppid matches /proc/self/stat (#29169)", () => {
  // Field 4 of /proc/self/stat is the real ppid. Field 2
  // (comm) can contain spaces and parens, so split on the
  // LAST ')' rather than whitespace.
  const stat = readFileSync("/proc/self/stat", "utf8");
  const kernelPpid = parseInt(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1], 10);

  // JS and kernel must agree on the same tick.
  expect(process.ppid).toBe(kernelPpid);
  expect(process.ppid).toBeGreaterThan(0);
});
