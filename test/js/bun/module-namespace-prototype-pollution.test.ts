import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

test("namespace import should not inherit from Object.prototype", async () => {
  const dir = tempDirWithFiles("namespace-prototype-pollution", {
    "mod.mjs": `
      export const value = "original";
    `,
    "test.mjs": `
      import * as mod from './mod.mjs';

      // Pollute Object.prototype with a function
      Object.prototype.maliciousFunction = function () {
        console.log('Prototype pollution attack succeeded');
        return 'SECURITY_BREACH';
      };

      // This should throw an error because mod should not inherit from Object.prototype
      try {
        const result = mod.maliciousFunction();
        console.log("FAILED: " + result);
        process.exit(1);
      } catch (error) {
        console.log("SUCCESS: namespace object is protected from prototype pollution");
      }

      // Verify the exported value is still accessible
      console.log("Original export:", mod.value);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS: namespace object is protected from prototype pollution");
  expect(stdout).toContain("Original export: original");
  expect(stdout).not.toContain("FAILED:");
  expect(stdout).not.toContain("SECURITY_BREACH");
});
