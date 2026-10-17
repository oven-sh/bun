// https://github.com/oven-sh/bun/issues/30613
//
// On CPUs below Bun's x64 baseline (e.g. QEMU's default TCG vCPU, which only
// advertises SSE3), simdutf's runtime dispatcher finds no usable kernel:
// the build is compiled with -march=nehalem, which defines __SSE4_2__ and
// therefore compiles out simdutf's scalar fallback. It then dispatches to an
// `unsupported_implementation` stub whose methods all return 0/false/{OTHER,0}.
//
// Before the fix, Bun trusted those return values: validate_utf8 rejects
// every file (bunfig.toml fails to load with "Invalid UTF-8 byte sequence"),
// and first_non_ascii reports a non-ASCII byte at offset 0 for any input
// longer than its 32-byte scalar fast path, so the scan loops built on it
// never advance and `bun app.js` hangs forever. The original report on
// v1.3.9 hit a slice-length underflow on the same stub and segfaulted after
// ~16 seconds instead.
//
// We simulate that CPU by forcing simdutf onto a nonexistent implementation
// name; simdutf's set_best() treats an unknown name exactly like an
// unsupported CPU and installs the same stub.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64 } from "harness";

// On arm64 simdutf compiles exactly one kernel (NEON, which is mandatory on
// aarch64), so SIMDUTF_SINGLE_IMPLEMENTATION == 1 and runtime dispatch is
// bypassed entirely: SIMDUTF_FORCE_IMPLEMENTATION is ignored and there is no
// way to reach the unsupported stub from the outside. The startup probe still
// runs there; it just can never fail on real arm64 hardware.
test.concurrent.skipIf(isArm64)(
  "fails fast with a clear error when simdutf has no supported implementation",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log('unreachable')"],
      env: {
        ...bunEnv,
        // Any name not in simdutf's compiled-in list selects the unsupported
        // stub, identical to running on a pre-SSE4.2 host.
        SIMDUTF_FORCE_IMPLEMENTATION: "none-for-issue-30613",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The unfixed build either hangs in a first_non_ascii scan loop or fails
    // with a bogus "Invalid UTF-8" error depending on what it reads first; the
    // fixed build prints a diagnostic and exits cleanly before touching input.
    expect(stderr).toContain("Bun requires");
    expect(stderr).toContain("SIMDUTF_FORCE_IMPLEMENTATION");
    expect(stdout).toBe("");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(134);
  },
);

test.concurrent("runs normally when a supported simdutf implementation is available", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('ok')"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
