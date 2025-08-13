import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("ANSI escape sequences are escaped in diff output", async () => {
  const testProcess = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/ansi-escape.fixture.ts"],
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "0", // Disable colors so we can see the escaped sequences
    },
  });
  
  await testProcess.exited;
  const stderr = await testProcess.stderr.text();
  
  // The test should show escaped \x1b sequences instead of raw escape characters
  expect(stderr).toContain("\\x1b");
  // Verify that raw escape characters are not present
  expect(stderr).not.toContain("\x1b");
  expect(testProcess.exitCode).toBe(1); // Test should fail
});