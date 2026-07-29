import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.takeHeapSnapshot can be called repeatedly after a failed require", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        for (let i = 0; i < 5; i++) {
          try { require("./does-not-exist-" + i); } catch {}
          console.takeHeapSnapshot();
          Bun.gc(true);
        }
        console.error("OK");
      `,
    ],
    env: {
      ...bunEnv,
      BUN_JSC_validateExceptionChecks: "1",
    },
    stdout: "ignore",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Unchecked JS exception");
  expect(stderr).toContain("OK");
  expect(exitCode).toBe(0);
});
