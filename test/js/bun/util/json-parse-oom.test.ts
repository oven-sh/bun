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
    // The filler loop in the fixture exhausts address space down to N/4, so any
    // size should hit the OOM path, but mimalloc's arena layout varies. Sweep a
    // couple of sizes and every parsePrimitiveValue caller (top-level literal,
    // array element, object property value); every run that reaches INPUT-OK
    // must either succeed or throw RangeError, never crash.
    const cases: Array<[shape: string, mb: number]> = [
      ["root", 200],
      ["root", 400],
      ["array", 300],
      ["object", 300],
    ];
    let sawCaught = false;
    let sawInputOK = false;

    for (const [shape, mb] of cases) {
      const size = mb * 1024 * 1024;
      await using proc = Bun.spawn({
        cmd: [
          "/bin/sh",
          "-c",
          `ulimit -v ${limitKiB} && ulimit -c 0 && exec "$0" "$1" "$2" "$3"`,
          bunExe(),
          fixture,
          String(size),
          shape,
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
      expect({ shape, size, stdout: stdout.trim(), stderr: stderr.trim(), exitCode, signal: proc.signalCode }).toMatchObject({
        shape,
        size,
        signal: null,
      });

      if (stdout.includes("CAUGHT:")) {
        expect(stdout).toContain("CAUGHT:RangeError:Out of memory");
        expect(exitCode).toBe(0);
        sawCaught = true;
      } else {
        expect(stdout).toContain("PARSED");
        expect(exitCode).toBe(1);
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
