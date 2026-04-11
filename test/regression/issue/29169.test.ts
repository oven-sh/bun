// https://github.com/oven-sh/bun/issues/29169
//
// process.ppid was a lazy PropertyCallback in BunProcess.cpp, so
// the value was captured once on first access and cached on the
// process object. If the original parent died and the child was
// reparented to init (or a subreaper), process.ppid stayed
// frozen at the dead pid — breaking the common orphan-detection
// pattern `if (process.ppid === 1) exit()`.
//
// The fix swaps the lazy PropertyCallback for a CustomAccessor
// getter that calls getppid()/uv_os_getppid() on every read, so
// it reflects the current kernel state. This test pins the
// underlying contract: process.ppid must be exposed as an
// accessor, not a cached data property, because only an
// accessor gets re-evaluated on each read.
//
// Structural (descriptor-based) check rather than a reparenting
// experiment: reparenting tests have to spawn a parent shell,
// kill it, and race the kernel — that shape was flaky on some
// CI lanes even when the underlying fix was correct. The
// descriptor check is synchronous and deterministic and tests
// exactly the property the fix establishes: `process.ppid` is
// a live accessor.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

test("process.ppid is a live accessor (#29169)", () => {
  // JSC's CustomAccessor appears in Object.getOwnPropertyDescriptor
  // with `get`/`set` functions. A lazy PropertyCallback, which
  // caches on first read, appears as `{value}`. Only an
  // accessor descriptor is re-evaluated on every access.
  const before = Object.getOwnPropertyDescriptor(process, "ppid");
  expect(before).toBeDefined();
  expect(typeof before!.get).toBe("function");

  // Read the value to make sure the accessor doesn't
  // self-demote (e.g. by caching on first access via a
  // PropertyCallback-style storage).
  const firstRead = process.ppid;
  expect(firstRead).toBeGreaterThan(0);

  const after = Object.getOwnPropertyDescriptor(process, "ppid");
  expect(after).toBeDefined();
  expect(typeof after!.get).toBe("function");

  // A second read should still go through the same accessor.
  // (If the getter had side-effected and installed a data
  // property as a side effect, the descriptor would change.)
  const secondRead = process.ppid;
  expect(secondRead).toBe(firstRead);
});

// Sanity check on Linux: the value matches what /proc says and
// what a fresh syscall reports. This pins the actual syscall
// path, not just the JS surface. Kept off other platforms to
// keep the test portable.
test.skipIf(!isLinux)("process.ppid matches /proc/self/stat (#29169)", async () => {
  // Single-file child script — inline via `-e` per
  // test/CLAUDE.md. Field 4 of /proc/self/stat is the real
  // ppid; field 2 (comm) may contain spaces and parens so
  // split on the last ')'.
  const childScript = `
    const fs = require("fs");
    const stat = fs.readFileSync("/proc/self/stat", "utf8");
    const kernelPpid = parseInt(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1], 10);
    process.stdout.write(process.ppid + " " + kernelPpid + "\\n");
  `;

  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", childScript],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  const text = (await child.stdout.text()).trim();
  const [jsPpid, kernelPpid] = text.split(" ").map(Number);

  // The live getter and the kernel must agree, and both must
  // be this test runner's pid (we're the direct parent).
  expect(jsPpid).toBe(process.pid);
  expect(kernelPpid).toBe(process.pid);
  expect(await child.exited).toBe(0);
});
