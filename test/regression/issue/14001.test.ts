// DOMJIT exception return protocol: an exception thrown from a DOMJIT fast-path
// wrapper must be visible in the operation's return value so the DFG/FTL
// post-CallDOM exception check branches correctly and the surrounding try/catch
// catches it. https://github.com/oven-sh/bun/issues/14001
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("TextDecoder.decode exception is caught under DFG/FTL tier-up (#14001)", async () => {
  const src = `
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const invalid = new Uint8Array([0xff]);
    const N = 20000;
    let caught = 0;
    for (let i = 0; i < N; i++) {
      try {
        decoder.decode(invalid);
      } catch {
        caught++;
      }
    }
    if (caught !== N) {
      console.log("ESCAPED: " + (N - caught) + " exceptions were not caught");
      process.exit(1);
    }
    console.log("OK");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: {
      ...bunEnv,
      BUN_JSC_useConcurrentJIT: "0",
      BUN_JSC_thresholdForJITSoon: "10",
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
      BUN_JSC_thresholdForOptimizeSoon: "10",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "10",
      BUN_JSC_thresholdForFTLOptimizeSoon: "100",
      BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "100",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 30_000);
