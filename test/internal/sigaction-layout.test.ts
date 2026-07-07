// bun.sys.Sigaction must match the host libc's `struct sigaction`. Zig's
// std.posix.Sigaction assumes the glibc/musl layout on Linux, which is wrong
// for bionic (Android LP64 puts sa_flags first and sigset_t is a single
// unsigned long). A layout mismatch means libc reads sa_handler from the
// wrong offset and installs garbage — on Android that was SIG_DFL for any
// handler with an empty mask, or a wild pointer like 0x10000 when SIGCHLD
// was in the mask.
//
// This test installs a known handler for SIGUSR2 via bun.sys.sigaction,
// reads the disposition back via sigaction(sig, NULL, &old), and checks the
// handler pointer and flags round-trip. That property holds iff the Zig
// struct agrees with libc's on this platform.
import { expect, test } from "bun:test";
import { isPosix } from "harness";

test.skipIf(!isPosix)("bun.sys.Sigaction matches the host libc's struct sigaction", () => {
  // Resolve lazily so a build without the binding fails this test rather
  // than erroring at module load (which the junit reporter counts as 0
  // failures).
  const { sigactionLayout } = require("bun:internal-for-testing") as typeof import("bun:internal-for-testing");
  expect(sigactionLayout).toBeFunction();

  const result = sigactionLayout();
  expect(result).toBeDefined();
  // Handler pointer and SA_RESTART must survive the trip through libc.
  expect(result!.readback).toEqual(result!.installed);
  expect(result!.installed.handler).toBeGreaterThan(0);
  expect(result!.sizeof).toBeGreaterThan(0);
});
