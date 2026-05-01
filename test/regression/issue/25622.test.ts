// https://github.com/oven-sh/bun/issues/25622
// Bun incorrectly merged tsconfig paths across extends instead of replacing.
// TypeScript semantics: child's paths completely override parent's paths.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("child tsconfig paths replace parent paths (not merge)", async () => {
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
    "src/helpers/x.ts": `export const msg = "should not resolve";`,
    "src/index.ts": `
      // @helpers/* is from parent config — should NOT resolve since child's
      // paths replace parent's entirely (TypeScript semantics).
      const x = await import("@helpers/x" as string);
      console.log(x.msg);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "src/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Before the fix, Bun merged paths and this would print "should not resolve"
  // with exit 0. Now it should fail to resolve @helpers/x.
  expect(stderr).toContain("Cannot find module '@helpers/x'");
  expect(stdout).not.toContain("should not resolve");
  expect(exitCode).not.toBe(0);
});

test("child tsconfig paths still work after replacing parent paths", async () => {
  using dir = tempDir("issue-25622-positive", {
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
    "src/helpers/x.ts": `export const msg = "via child path";`,
    "src/index.ts": `
      // @/* is from child config — SHOULD resolve
      import { msg } from "@/helpers/x";
      console.log(msg);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "src/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("via child path");
  expect(exitCode).toBe(0);
});
