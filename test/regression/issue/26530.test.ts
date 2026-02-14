import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26530
// Bun should not panic when given a config file path with no extension
test("config file with no extension should not crash", async () => {
  using dir = tempDir("issue-26530", {
    "index.js": `console.log("ok")`,
    // Create a config file with no extension
    "myconfig": `{ "install": { "registry": "https://registry.npmjs.org" } }`,
  });

  // Using a config file with no extension should not cause a panic
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--config=myconfig", "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify the script ran successfully and produced expected output
  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
