import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Error.prepareStackTrace called without second parameter should not crash", async () => {
  // This test is for issue #21815
  // The command `Error.prepareStackTrace(e)` was causing a segmentation fault 
  // due to missing validation of the second parameter (callSites array)
  // 
  // Node.js throws: "Cannot read properties of undefined (reading 'length')"
  // Bun now throws: "Second argument must be an array of call sites" (clearer message)
  
  const code = `
const e = new Error();
try {
  Error.prepareStackTrace(e);
} catch (err) {
  console.log("Caught error:", err.message);
  process.exit(0);
}
console.log("No error thrown - this is unexpected");
process.exit(1);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // The command should execute successfully without crashing
  expect(exitCode).toBe(0);
  expect(stdout).toContain("Caught error:");
  expect(stdout).toContain("Second argument must be an array of call sites");
  expect(stderr).toBe("");
});

test("Error.prepareStackTrace with custom function should work like Node.js", async () => {
  // Custom prepareStackTrace functions should work normally, even with missing parameters
  const code = `
Error.prepareStackTrace = (err, stack) => "Custom: " + err.message;
const e = new Error("test");
console.log("Result:", Error.prepareStackTrace(e)); // Missing second param should be OK
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Result: Custom: test");
  expect(stderr).toBe("");
});