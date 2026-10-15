import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/32793
// Date.now() is tagged DateNowIntrinsic, so a hot call site is inlined by the
// DFG/FTL as a DateNow node. operationDateNow, its slow path, used to return
// the wall clock and ignore JSGlobalObject::overridenDateNow, so a
// setSystemTime() override silently wore off as soon as the call site tiered
// up. The loop runs far past the tier-up point (the released build diverges
// after ~10-20k iterations).
test("setSystemTime() keeps overriding Date.now() after the call site is JIT compiled", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { setSystemTime } = require("bun:test");
       const frozen = new Date("2024-01-09T00:00:00.000Z").getTime();
       setSystemTime(frozen);
       const readNow = () => Date.now();
       let divergedAt = -1;
       for (let i = 0; i < 500_000; i++) {
         if (readNow() !== frozen) { divergedAt = i; break; }
       }
       console.log(divergedAt);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect({ divergedAt: stdout.trim(), exitCode }).toEqual({ divergedAt: "-1", exitCode: 0 });
});
