import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("namespace imports should not inherit from Object.prototype", async () => {
  const dir = tempDirWithFiles("namespace-pollution", {
    "mod.mjs": `export const value = "original";`,
    "test.mjs": `
      import * as mod from './mod.mjs';

      Object.prototype.maliciousFunction = function() {
        return 'POLLUTION_SUCCESS';
      };

      // This should throw - namespace shouldn't inherit from Object.prototype
      try {
        mod.maliciousFunction();
        console.log("FAIL: prototype pollution succeeded");
      } catch {
        console.log("PASS: prototype pollution prevented");
      }

      // Verify __esModule still works
      console.log("__esModule settable:", (mod.__esModule = true, mod.__esModule === true));

      // Original exports should work
      console.log("Original export:", mod.value);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("PASS: prototype pollution prevented");
  expect(stdout).toContain("__esModule settable: true");
  expect(stdout).toContain("Original export: original");
});
