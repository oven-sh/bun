import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

uafTest("node-http-uaf-fixture.ts");
uafTest("node-http-uaf-fixture-2.ts");

function uafTest(fixture, iterations = 2) {
  test(`should not crash on abort (${fixture})`, async () => {
    for (let i = 0; i < iterations; i++) {
      const { exited } = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, fixture)],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      const exitCode = await exited;
      expect(exitCode).not.toBeNull();
      expect(exitCode).toBe(0);
    }
  });
}
