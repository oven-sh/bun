import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import path from "path";

// Each child deliberately mutates a strong handle owned by the main VM from a
// spawned thread that does not hold the VM's API lock. Debug builds carry
// assertions guarding exactly that (JSC::HandleSet::assertMayMutate for
// JSC::Strong, the Bun__StrongRef__* asserts for StrongRootBlock slots), so
// the child must die with the assertion's message before the mutation lands.
//
// This is the liveness check for those detectors: the previous guard for the
// #30185 cross-thread HandleSet race was a probabilistic crash workload that
// silently stopped detecting when GC scheduling changed (#35356, measured in
// #36952). If a WebKit bump or binding refactor drops the assertions, the
// child survives and this test fails instead of the coverage disappearing
// unnoticed.
//
// These crashes are intentional; keep them out of crash reporting so CI does
// not pin them on unrelated tests.
const noReportEnv = { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };

for (const [kind, message] of [
  ["strong", "Strong handles may only be created, written, or destroyed while holding their VM's API lock"],
  ["strongRef", "Bun::StrongRef handles may only be created, written, or destroyed while holding their VM's API lock"],
] as const) {
  test.if(isDebug)(`unlocked off-thread ${kind} mutation aborts with the guard's message`, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "strong-handle-thread-guard-fixture.js"), kind],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("ASSERTION FAILED");
    expect(stderr).toContain(message);
    expect(stdout).not.toContain("survived");
    expect(exitCode).not.toBe(0);
  });
}
