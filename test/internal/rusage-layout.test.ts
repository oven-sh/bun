// bun.sys.rusage must match the host libc's `struct rusage`. Zig's
// std.posix.rusage on Linux is the musl struct, which carries a
// `__reserved: [16]long` tail (272B total on LP64). bionic's `struct
// rusage` is the bare kernel struct (144B on LP64) — no reserved tail.
// `wait4()`/`getrusage()` are output-only so the oversized std type
// doesn't corrupt anything today, but it leaves 128B of uninitialized
// stack in the tail, which would break any future `@memcmp` / "still
// zero?" / serialization of the struct. bun.sys.rusage drops the tail on
// Android and is a transparent alias of std.posix.rusage elsewhere.
//
// This test fills a bun.sys.rusage via libc getrusage(RUSAGE_SELF) and
// checks the fields came back populated (proving the type is usable with
// the host libc) and that bun.spawn.Rusage — what actually gets handed to
// wait4() — is the same size.
import { expect, test } from "bun:test";
import { isPosix } from "harness";

test.skipIf(!isPosix)("bun.sys.rusage matches the host libc's struct rusage", () => {
  // Resolve lazily so a build without the binding fails this test rather
  // than erroring at module load (which the junit reporter counts as 0
  // failures).
  const { rusageLayout } = require("bun:internal-for-testing") as typeof import("bun:internal-for-testing");
  expect(rusageLayout).toBeFunction();

  const r = rusageLayout();
  expect(r).toBeDefined();

  // bun.spawn.Rusage (the type passed to wait4) must be bun.sys.rusage,
  // not std.posix.rusage directly.
  expect(r!.sizeofSpawnRusage).toBe(r!.sizeof);

  if (r!.isAndroid) {
    // bionic: kernel struct, 144B on LP64, no reserved tail.
    expect(r!.sizeof).toBe(144);
    expect(r!.hasReservedTail).toBe(false);
    // The std type we're working around is 272B.
    expect(r!.sizeofStdPosixRusage).toBeGreaterThan(r!.sizeof);
  } else {
    // Transparent alias on glibc/musl/Darwin.
    expect(r!.sizeof).toBe(r!.sizeofStdPosixRusage);
  }

  // getrusage(RUSAGE_SELF) through our type produced sane values: we've
  // consumed some CPU and have a non-zero resident set.
  expect(r!.maxrss).toBeGreaterThan(0);
  expect(r!.utime_usec + r!.stime_usec).toBeGreaterThan(0);
});
