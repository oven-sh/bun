import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// A synchronous collection runs on the calling thread. JSC's marker visits
// every live cell on that thread's stack, so when the collector's frames are
// gone the memory below the caller still holds the address of every visited
// cell. A later callee whose frame has a slot it never writes exposes one of
// those addresses to the next conservative stack scan, and a dead object
// survives an explicit gc(). VM::run_gc zeroes the region the collector used
// before it returns. This checks that region is zero after Bun.gc(true).
//
// Sizes: the scrub covers 32 KiB below run_gc's frame, which starts about
// 1.5 KiB below the caller in a debug build. The return path from Bun.gc and
// the call into the scanner reach about 5 KiB below the caller in a debug
// ASAN build, so the check starts 8 KiB down. Without the scrub the window is
// full of the collector's frames (a full collection reaches about 20 KiB) and
// of the startup frames that ran before. The scan is the first statement
// after Bun.gc: in a debug build, ordinary JS such as a first access to the
// lazy `console` global or an Array push goes more than 20 KiB deep.
const scanner = `
#include <stdint.h>

// Deepest non-zero word in [sp - 28 KiB, sp - 8 KiB), as a byte distance
// below sp, or 0 when the window is all zero. No calls inside the loop, so
// nothing below the stack pointer changes while it scans.
int64_t deepest_nonzero_below(void) {
  volatile uint64_t anchor = 0;
  uint64_t sp = (uint64_t)&anchor;
  volatile uint64_t *p = (volatile uint64_t *)(sp - 28 * 1024);
  volatile uint64_t *end = (volatile uint64_t *)(sp - 8 * 1024);
  for (; p < end; p++) {
    if (*p != 0) return (int64_t)(sp - (uint64_t)p);
  }
  return (int64_t)(anchor & 0);
}
`;

const entry = `
import { cc } from "bun:ffi";
const { symbols: { deepest_nonzero_below } } = cc({
  source: "./scanner.c",
  symbols: { deepest_nonzero_below: { args: [], returns: "int64_t" } },
});
// Something for the marker to visit on this thread.
const keep = [];
for (let i = 0; i < 4096; i++) keep.push({ i, s: "x" + i });
globalThis.keep = keep;
const log = console.log;
Bun.gc(true);
const deepest = deepest_nonzero_below();
log(String(deepest));
`;

// cc() is not available on Windows.
test.skipIf(isWindows)("Bun.gc(true) zeroes the stack the collector used", async () => {
  using dir = tempDir("collector-stack-scrub", { "scanner.c": scanner, "entry.mjs": entry });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("0\n");
  expect(exitCode).toBe(0);
});
