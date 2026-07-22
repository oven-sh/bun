import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux } from "harness";
import { join } from "node:path";

// JSON.parse copies every string value longer than 16 chars into a fresh
// StringImpl. That copy used the crash-or-succeed StringImplMalloc::malloc
// path, so a near-OOM process died with SIGILL inside fastCompactMalloc
// instead of throwing. The fix routes through StringImpl::tryCreateUninitialized
// and surfaces a RangeError, same as "x".repeat(tooLarge).
//
// RLIMIT_AS is the only portable way to make tryMalloc actually fail, and it
// cannot be combined with AddressSanitizer's 16 TB shadow reservation, so this
// test runs on non-ASAN Linux only.
test.skipIf(!isLinux || isASAN)(
  "JSON.parse throws RangeError instead of crashing when a string value cannot be allocated",
  async () => {
    const fixture = join(import.meta.dir, "json-parse-oom-fixture.js");
    const limitKiB = 5 * 1024 * 1024;
    // A single size/limit can miss the window on a given machine's address-space
    // layout. Sweep a few sizes; every run that reaches INPUT-OK must either
    // succeed or throw RangeError, never crash.
    const sizes = [200, 300, 400, 500].map(mb => mb * 1024 * 1024);
    let sawCaught = false;
    let sawInputOK = false;

    for (const size of sizes) {
      await using proc = Bun.spawn({
        cmd: [
          "/bin/sh",
          "-c",
          `ulimit -v ${limitKiB} && ulimit -c 0 && exec "$0" "$1" "$2"`,
          bunExe(),
          fixture,
          String(size),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const reachedParse = stdout.includes("INPUT-OK");
      if (!reachedParse) continue;
      sawInputOK = true;

      // Once the input is built, JSON.parse must not kill the process.
      expect({ size, stdout: stdout.trim(), stderr: stderr.trim(), exitCode, signal: proc.signalCode }).toMatchObject({
        size,
        signal: null,
      });
      expect([0, 1]).toContain(exitCode);

      if (stdout.includes("CAUGHT:")) {
        expect(stdout).toContain("CAUGHT:RangeError:Out of memory");
        sawCaught = true;
      } else {
        expect(stdout).toContain("PARSED");
      }
    }

    // The sweep has to actually reach JSON.parse at least once; otherwise the
    // address-space cap was too tight and nothing was exercised.
    expect(sawInputOK).toBe(true);
    // And at least one of those runs must have taken the out-of-memory branch,
    // otherwise the sweep never exercised the path this test is for.
    expect(sawCaught).toBe(true);
  },
  30_000,
);
