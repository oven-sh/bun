// minify_syntax (on for target "bun") folds `a${x}` + `b${y}` into one template
// literal. The fold used to copy every part collected so far into a new arena
// slice at each step, and a template that was visited again got a new copy of
// its parts each time. That is 64 bytes per part, per step: 44 KB of
// "`a${x}b` + `a${x}b` + ..." took over 500 MB.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";
import { shapes } from "./transpiler-template-chain-oom-fixture";

// Before the fix every shape took 131 to 139 MB in a release build. Now the
// largest one takes 16 MB in a debug+ASAN build and 5 MB in a release build.
const boundMB = isASAN || isDebug ? 40 : 20;

test.concurrent.each(Object.keys(shapes))("template literal `+` fold takes linear memory: %s", async name => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "transpiler-template-chain-oom-fixture.ts"), name],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr }).toEqual({
    stdout: expect.stringMatching(/^\{"delta_mb":/),
    stderr: "",
  });
  expect(JSON.parse(stdout).delta_mb).toBeLessThan(boundMB);
  expect(exitCode).toBe(0);
});
