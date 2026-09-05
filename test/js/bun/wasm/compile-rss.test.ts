import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

// Unfixed, the 8 idle wasm compiler threads keep 17 to 25 MB of freed compile temporaries until
// they exit after 10 s. Fixed, they release it about 100 ms after the last compile and RSS returns
// to where it started.
const idleTargetMiB = 10;

// Debug and ASAN builds link a JavaScriptCore that does not allocate through mimalloc, so the
// per-thread retention this test checks for does not exist there.
test.skipIf(isDebug || isASAN)(
  "WebAssembly.compile does not retain memory in idle compiler threads (#41438)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "compile-rss-fixture.mjs"), String(idleTargetMiB)],
      env: {
        ...bunEnv,
        // The retained amount scales with the compiler thread count. Pin it so the test does not
        // depend on the core count of the machine.
        BUN_JSC_numberOfWasmCompilerThreads: "8",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    // The compiles have to grow RSS well past the target first, or the check below means nothing.
    expect(result.peakDeltaMiB).toBeGreaterThan(idleTargetMiB * 2);
    expect(result.idleDeltaMiB).toBeLessThan(idleTargetMiB);
    expect(exitCode).toBe(0);
  },
);
