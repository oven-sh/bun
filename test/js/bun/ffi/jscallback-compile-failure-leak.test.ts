import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isWindows } from "harness";

// TinyCC (and all of bun:ffi) is disabled on Windows ARM64
const isFFIUnavailable = isWindows && isArm64;

// compileCallback() allocates an FFICallbackFunctionWrapper (which holds
// JSC::Strong refs to the callback function and the global object) before
// attempting to compile the generated C stub. If compilation fails for any
// reason, the wrapper used to be leaked because it was only stored on the
// Function when step == .compiled — permanently rooting the user's callback.
//
// This test triggers a known failure path (using "buffer" as a callback arg
// generates C that TinyCC rejects) and asserts the callback function becomes
// collectible afterwards.
test.skipIf(isFFIUnavailable)("JSCallback does not leak the callback function when compilation fails", async () => {
  const script = /* js */ `
    const { JSCallback } = require("bun:ffi");

    let collected = 0;
    const registry = new FinalizationRegistry(() => {
      collected++;
    });

    const ITERS = 64;

    function attempt() {
      const fn = function leakCandidate() {};
      registry.register(fn, undefined);
      let result;
      try {
        result = new JSCallback(fn, { args: ["buffer"], returns: "void" });
      } catch {}
      // Either it threw, or it returned with an unusable (undefined) ptr.
      // Regardless of how the failure surfaces, the callback must not be
      // held alive by a leaked Strong handle.
      if (result && typeof result.ptr === "number") {
        // Compilation unexpectedly succeeded; release it so the function can
        // still be collected and this test doesn't report a false positive.
        result.close();
      }
    }

    for (let i = 0; i < ITERS; i++) attempt();

    for (let i = 0; i < 30 && collected < ITERS; i++) {
      Bun.gc(true);
      await Bun.sleep(5);
    }

    console.log(JSON.stringify({ collected, iters: ITERS }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { collected, iters } = JSON.parse(stdout.trim());
  // Before the fix, every single callback leaked (collected === 0). The fix
  // releases the wrapper on failure so the functions become collectible. GC
  // is not fully deterministic across platforms, so only require a majority.
  expect(collected).toBeGreaterThan(iters / 2);
  expect(exitCode).toBe(0);
});
