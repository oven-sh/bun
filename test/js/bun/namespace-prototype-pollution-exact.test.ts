import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

test("exact case: mod.foo() should throw when Object.prototype.foo is added", async () => {
  const dir = tempDirWithFiles("exact-pollution-case", {
    "mod.mjs": `
      export const realProperty = "I am a real export";
    `,
    "test.mjs": `
      import * as mod from './mod.mjs';

      Object.prototype.foo = function () {
        console.log('I can be called from any module');
        return 'POLLUTION_SUCCESS';
      };

      // This is the exact case from the issue - should throw an error
      try {
        const result = mod.foo();
        console.log("VULNERABILITY: Object.prototype pollution succeeded");
        console.log("Result:", result);
        process.exit(1);
      } catch (error) {
        console.log("SECURITY: mod.foo() correctly threw an error");
        console.log("Error type:", error.constructor.name);
      }
      
      // Verify real properties still work
      console.log("Real property accessible:", mod.realProperty);
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
  expect(stdout).toContain("SECURITY: mod.foo() correctly threw an error");
  expect(stdout).toContain("Real property accessible: I am a real export");
  expect(stdout).not.toContain("VULNERABILITY:");
  expect(stdout).not.toContain("POLLUTION_SUCCESS");
});