import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #24709 - void import() should generate valid JavaScript", async () => {
  using dir = tempDir("issue-24709", {
    "bug.ts": `
export function main() {
  void import("./bug.ts");
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "bug.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The output should not contain invalid syntax like .then(() => )
  expect(stdout).not.toContain(".then(() => )");

  // The output should contain valid syntax like .then(() => void 0)
  expect(stdout).toContain(".then(() => void 0)");

  // Verify the generated code is syntactically valid by parsing it
  // We can't use new Function() because it has 'export' statements
  // but we can check that it doesn't have the specific syntax error
  expect(stdout).toMatch(/\.then\(\(\) => [^)]+\)/);

  expect(exitCode).toBe(0);
});
