import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression for a Fuzzilli-discovered crash where Bun__Jest__testModuleObject
// could leave a pending JSC exception on the VM after a deep stack overflow
// during lazy module initialization. In debug/ASAN builds this tripped a
// releaseAssertNoException on the next host-function entry (SIGABRT). In
// release builds the exception is silently consumed, so this test only
// observably regresses under ASAN — which is what `bun bd test` uses.
test("Bun.jest() after stack overflow does not crash", async () => {
    await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `
            function cause_overflow() { cause_overflow(); }
            try { cause_overflow(); } catch (e) {}
            try {
                const j = Bun.jest();
                j.expect(j).toBeValidDate();
            } catch(e) {}
        `],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
});
