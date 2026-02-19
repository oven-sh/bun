import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/25622
// TypeScript's behavior: child tsconfig `paths` should completely override parent's `paths`,
// not merge with them.
test("child tsconfig paths should override parent paths, not merge", async () => {
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
    "src/helpers/x.ts": `export const x = "from helpers";`,
    "src/index.ts": `import "@helpers/x";`,
  });

  // This should fail because child's paths should override parent's paths
  // (the @helpers/* mapping from the parent should not be present)
  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should fail with a resolution error since @helpers/* should not be mapped
  expect(stderr).toContain("@helpers/x");
  expect(exitCode).not.toBe(0);
});

test("child tsconfig inherits parent paths when child has no paths", async () => {
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
        // No paths defined - should inherit from parent
      },
    }),
    "src/helpers/x.ts": `console.log("inherited path works");`,
    "src/index.ts": `import "@helpers/x";`,
  });

  // This should succeed because child inherits parent's paths
  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("inherited path works");
  expect(exitCode).toBe(0);
});
