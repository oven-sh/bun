// bun.sys.termios must match the host libc's `struct termios`. Zig's
// std.posix.termios assumes the glibc/musl layout on Linux (cc[32] plus
// trailing c_ispeed/c_ospeed, ~60B), which is wrong for bionic (Android
// uses the raw kernel struct: cc[19], no speed fields, 36B). The first
// 36B are layout-compatible so tcgetattr/tcsetattr "mostly work", but
// writes to .ispeed/.ospeed land past bionic's struct and reinitialising
// c_cflag zeroes CBAUD → baud becomes B0.
//
// This test opens a PTY master via posix_openpt, writes a sentinel into
// c_cc[VLNEXT] and toggles ECHO via bun.sys.tcsetattr, then reads both
// back via bun.sys.tcgetattr. That round-trip holds iff the Zig struct
// agrees with libc's on this platform.
import { expect, test } from "bun:test";
import { termiosLayout } from "bun:internal-for-testing";
import { isPosix } from "harness";

test.skipIf(!isPosix)("bun.sys.termios matches the host libc's struct termios", () => {
  expect(termiosLayout).toBeFunction();

  const result = termiosLayout();
  expect(result).toBeDefined();
  // c_cc[VLNEXT] and lflag.ECHO must survive the trip through libc.
  expect(result!.readback).toEqual(result!.installed);
  expect(result!.installed.cc_lnext).toBe(0x5a);
  expect(result!.sizeof).toBeGreaterThan(0);
});
