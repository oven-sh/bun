// bun.sys.termios must match the host libc's `struct termios`. Zig's
// std.posix.termios assumes the glibc/musl layout on Linux (cc[32] plus
// trailing c_ispeed/c_ospeed, ~60B), which is wrong for bionic (Android
// uses the raw kernel struct: cc[19], no speed fields, 36B). The first
// 36B are layout-compatible so tcgetattr/tcsetattr "mostly work", but
// writes to .ispeed/.ospeed land past bionic's struct and reinitialising
// c_cflag zeroes CBAUD → baud becomes B0.
//
// This test opens a PTY slave via posix_openpt/grantpt/unlockpt/ptsname
// (the master fd isn't a terminal on BSD/macOS), writes a sentinel into
// c_cc[VLNEXT] and toggles ECHO via bun.sys.tcsetattr, then reads both
// back via bun.sys.tcgetattr. That round-trip holds iff the Zig struct
// agrees with libc's on this platform.
import { expect, test } from "bun:test";
import { isPosix } from "harness";

test.skipIf(!isPosix)("bun.sys.termios matches the host libc's struct termios", () => {
  // Resolve lazily: a static `import { termiosLayout }` throws
  // `SyntaxError: Export named 'termiosLayout' not found` at module
  // load on a binary without the binding. bun:test's console output
  // counts that as "1 fail", but the JUnit reporter emits zero
  // testcases — so a fail-before gate that parses JUnit sees 0
  // failures and concludes the test doesn't exercise the fix.
  // Requiring inside the test body turns the missing export into an
  // ordinary assertion failure that JUnit records. This mirrors
  // sigaction-layout.test.ts.
  const { termiosLayout } = require("bun:internal-for-testing") as typeof import("bun:internal-for-testing");
  expect(termiosLayout).toBeFunction();

  const result = termiosLayout();
  expect(result).toBeDefined();
  // c_cc[VLNEXT] and lflag.ECHO must survive the trip through libc.
  expect(result!.readback).toEqual(result!.installed);
  expect(result!.installed.cc_lnext).toBe(0x5a);
  expect(result!.sizeof).toBeGreaterThan(0);
});
