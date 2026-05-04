import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The lazy property callbacks for Bun.sql / Bun.SQL load the "bun:sql" internal
// module on first access. If that load throws (e.g. stack overflow), the callback
// previously returned an empty JSValue which JSC's reifyStaticProperty passed
// straight into putDirect, crashing on a null JSCell dereference.
test.each(["sql", "SQL"] as const)("accessing Bun.%s near stack overflow does not crash", async key => {
  const src = `
    function F() {
      try { new F(); } catch {}
      Bun.${key};
    }
    try { new F(); } catch {}
    Bun.gc(true);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  expect(proc.signalCode).toBeNull();
  expect([0, 1]).toContain(exitCode);
});
