import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("namespace imports should not inherit from Object.prototype", async () => {
  await using dir = tempDir("namespace-pollution", {
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

      // The namespace is non-extensible with a null prototype, so __esModule
      // is absent and an assignment throws (same as Node).
      console.log("__esModule absent:", !("__esModule" in mod));
      try {
        mod.__esModule = true;
        console.log("FAIL: __esModule assignment did not throw");
      } catch {
        console.log("__esModule assignment throws: true");
      }

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
  expect(stdout).toContain("__esModule absent: true");
  expect(stdout).toContain("__esModule assignment throws: true");
  expect(stdout).toContain("Original export: original");
});
