import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The CSS parser caps nesting at 512 blocks, but a nesting level costs several
// times more stack in debug and sanitizer builds than in release builds, and
// CSS is parsed on threads with fixed 4 MB stacks. Input nested a couple of
// hundred levels deep overflowed the stack (a bare SIGSEGV, no error) long
// before the cap was reached. The parser now also checks the remaining stack
// before entering a block and reports the nesting error instead. The fixture
// probes every single depth around the point where that check starts firing,
// because the check has to leave room for everything parsed below the last
// block it lets through (a whole declaration), not just for reaching the next
// check.
test("nesting deeper than the stack allows is rejected instead of overflowing, at every depth", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "nesting-depth-stack-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A stack overflow kills the fixture before it prints anything; comparing
  // stderr and the exit status as well shows what happened to it.
  expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
    stdout: expect.stringMatching(/^\{/),
    exitCode: 0,
  });
  const { firstRejectedDepth, rejectedDepths, lastDepthTried } = JSON.parse(stdout);
  if (firstRejectedDepth === null) {
    // Every level fit on the stack (release-sized frames); nothing to probe.
    expect(rejectedDepths).toEqual([]);
    return;
  }
  // Once the stack runs out at some depth it stays run out: every depth from
  // the first rejected one through the end of the probe is rejected.
  const edge = rejectedDepths[0];
  expect(edge).toBeLessThanOrEqual(firstRejectedDepth);
  expect(rejectedDepths).toEqual(Array.from({ length: lastDepthTried - edge + 1 }, (_, i) => edge + i));
});
