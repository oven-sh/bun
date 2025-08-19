import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

test("namespace import should not inherit from Object.prototype", async () => {
  const dir = tempDirWithFiles("namespace-pollution", {
    "mod.mjs": `
      export const foo = "original";
    `,
    "test.mjs": `
      import * as mod from './mod.mjs';
      
      Object.prototype.foo = function () {
        console.log('I can be called from any module');
      };
      
      // This should throw because namespace imports should not inherit from Object.prototype
      try {
        mod.foo();
        console.log("FAILED: namespace object was polluted by Object.prototype");
      } catch (error) {
        console.log("SUCCESS: namespace object properly isolated from Object.prototype");
      }
      
      // Check the prototype chain
      console.log("Prototype of namespace:", Object.getPrototypeOf(mod));
      console.log("Has foo property:", 'foo' in mod);
      console.log("mod.foo type:", typeof mod.foo);
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
  
  // The namespace object should be isolated from Object.prototype
  // It may have a minimal prototype with just __esModule, but not Object.prototype
  expect(stdout).not.toContain("Prototype of namespace: {}"); // Not Object.prototype
  expect(stdout).toContain("mod.foo type: string");
  expect(stdout).toContain("SUCCESS: namespace object properly isolated from Object.prototype");
  
  // Ensure we're not getting the polluted function from Object.prototype
  expect(stdout).not.toContain("FAILED: namespace object was polluted by Object.prototype");
});