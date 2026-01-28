import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Tests that tsconfig.json paths completely override extended paths instead of merging
// See: https://github.com/oven-sh/bun/issues/25622
test("tsconfig paths should override parent paths, not merge", async () => {
  using dir = tempDir("issue-25622", {
    "tsconfig.base.json": JSON.stringify({
      compilerOptions: {
        paths: {
          "@helpers/*": ["./src/helpers/*"],
        },
      },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: {
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
    "src/helpers/x.ts": `export const message = "from helpers";`,
    "src/index.ts": `
// This import should FAIL because @helpers/* is from base config
// and child's paths should completely override, not merge
try {
  const x = await import("@helpers/x");
  console.log("FAIL: import succeeded");
} catch (e) {
  console.log("PASS: import failed as expected");
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
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

  // The import should fail because @helpers/* from base is overridden
  expect(stdout).toContain("PASS: import failed as expected");
});

test("tsconfig paths should inherit from parent when child has no paths", async () => {
  using dir = tempDir("issue-25622-inherit", {
    "tsconfig.base.json": JSON.stringify({
      compilerOptions: {
        paths: {
          "@helpers/*": ["./src/helpers/*"],
        },
      },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: {
        // No paths defined - should inherit from base
      },
    }),
    "src/helpers/x.ts": `console.log("from helpers");`,
    "src/index.ts": `import "@helpers/x";`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
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

  // The import should succeed because paths are inherited from base
  expect(stdout).toContain("from helpers");
  expect(exitCode).toBe(0);
});
