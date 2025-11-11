import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("issue #24449 - '.' in subdirectory should resolve to index.ts, not root file with same name", async () => {
  // Create temp directory with test files
  using dir = tempDir("test-issue-24449", {
    "lib.ts": `export const eulerNumber = 2.71828;`,
    "lib/index.ts": `export const piNumber = 3.14159;`,
    "lib/run.ts": `
import { piNumber } from ".";
console.log("piNumber:", piNumber);
`,
  });

  // Spawn Bun process
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lib/run.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should import from lib/index.ts, not lib.ts
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"piNumber: 3.14159"`);
  expect(exitCode).toBe(0);
});

test("issue #24449 - './' in subdirectory should resolve to index.ts, not root file with same name", async () => {
  // Create temp directory with test files
  using dir = tempDir("test-issue-24449-slash", {
    "lib.ts": `export const eulerNumber = 2.71828;`,
    "lib/index.ts": `export const piNumber = 3.14159;`,
    "lib/run.ts": `
import { piNumber } from "./";
console.log("piNumber:", piNumber);
`,
  });

  // Spawn Bun process
  await using proc = Bun.spawn({
    cmd: [bunExe(), "lib/run.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should import from lib/index.ts, not lib.ts
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"piNumber: 3.14159"`);
  expect(exitCode).toBe(0);
});
