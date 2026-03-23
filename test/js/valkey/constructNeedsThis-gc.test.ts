import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: constructNeedsThis pattern must root the JSCell
// during the Zig constructor call so GC cannot collect it.
test("new RedisClient with invalid URL does not crash during GC", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const RC = Bun.RedisClient;
      // Create several clients with bogus URLs (result intentionally discarded
      // so the object is immediately GC-eligible).
      for (let i = 0; i < 20; i++) {
        try { new RC("/not-a-valid-url"); } catch {}
      }
      Bun.gc(true);
      Bun.gc(true);
      console.log("ok");
      `,
    ],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
