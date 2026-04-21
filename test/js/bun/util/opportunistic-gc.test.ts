import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

function stripAsanWarning(s: string) {
  return s
    .split("\n")
    .filter(l => !l.startsWith("WARNING: ASAN interferes"))
    .join("\n")
    .trim();
}

// Smoke test: enabling JSC's opportunistic GC via BUN_GC_OPPORTUNISTIC_DEADLINE_MS
// should not crash or hang across allocation bursts and event-loop idle periods
// (which is when performOpportunisticallyScheduledTasks runs).
test("BUN_GC_OPPORTUNISTIC_DEADLINE_MS does not crash under burst+idle workload", async () => {
  const script = `
    let sink = 0;
    for (let i = 0; i < 3; i++) {
      let arr = [];
      for (let j = 0; j < 20_000; j++) arr.push({ j, s: "abc".repeat(8) + j });
      sink += arr.length;
      arr = null;
      await new Promise(r => setTimeout(r, 100));
    }
    console.log("ok " + sink);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_GC_OPPORTUNISTIC_DEADLINE_MS: "5" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout)).toBe("ok 60000");
  expect(stripAsanWarning(stderr)).toBe("");
  expect(exitCode).toBe(0);
}, 30_000);
