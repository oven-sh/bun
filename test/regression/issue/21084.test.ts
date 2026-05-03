import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bundler inlines process.env.NODE_ENV with optional chaining", async () => {
  using dir = tempDir("issue-21084", {
    "input.js": `
console.log(
  process.env.NODE_ENV,
  process.env?.NODE_ENV,
  process?.env?.NODE_ENV,
  process?.env.NODE_ENV,
  globalThis.process.env.NODE_ENV,
  globalThis.process?.env?.NODE_ENV,
);
if (process.env.NODE_ENV !== "production") {
  console.log("SHOULD_BE_REMOVED");
}
if (process.env?.NODE_ENV !== "production") {
  console.log("SHOULD_ALSO_BE_REMOVED");
}
if (process?.env?.NODE_ENV !== "production") {
  console.log("SHOULD_ALSO_BE_REMOVED_2");
}
if (globalThis.process.env.NODE_ENV !== "production") {
  console.log("GLOBALTHIS_SHOULD_BE_REMOVED");
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--production", "input.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // All optional chaining variants should be inlined to "production"
  expect(stdout).not.toContain("process.env");
  expect(stdout).not.toContain("globalThis");
  expect(stdout).not.toContain("SHOULD_BE_REMOVED");
  expect(stdout).not.toContain("SHOULD_ALSO_BE_REMOVED");
  expect(stdout).not.toContain("SHOULD_ALSO_BE_REMOVED_2");
  expect(stdout).not.toContain("GLOBALTHIS_SHOULD_BE_REMOVED");
  expect(exitCode).toBe(0);
});
