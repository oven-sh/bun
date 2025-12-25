import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFile } from "fs";

test("readFile with path too long should pass error to callback instead of throwing", async () => {
  // Create a path that exceeds the OS path limit (typically 1024 on macOS)
  const longPath = "a".repeat(10000);

  const result = await new Promise<{ handled: boolean; code: string | null }>((resolve) => {
    readFile(longPath, (err) => {
      if (err) {
        resolve({ handled: true, code: err.code });
      } else {
        resolve({ handled: true, code: null });
      }
    });
  });

  expect(result.handled).toBe(true);
  expect(result.code).toBe("ENAMETOOLONG");
});

test("readFile with path too long should not throw synchronously", async () => {
  using dir = tempDir("issue-25659", {
    "test.ts": `
import { readFile } from "fs";

const filePath = "a".repeat(10000);
readFile(filePath, (err) => {
  if (err) console.log("Handled Error:", err.code);
});
console.log("Completed");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should print "Completed" first (sync) then "Handled Error" (async)
  expect(stdout).toContain("Completed");
  expect(stdout).toContain("Handled Error: ENAMETOOLONG");
  expect(exitCode).toBe(0);
});
