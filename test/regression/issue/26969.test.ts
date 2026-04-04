import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26969
// bun install should not fail when patchedDependencies references a patch file
// that doesn't exist, as long as the patched package is not in the dependency graph.
test("bun install succeeds when patchedDependencies patch file is missing but package is not in dependency graph", async () => {
  using dir = tempDir("issue-26969", {
    "package.json": JSON.stringify({
      name: "repro-26969",
      private: true,
      patchedDependencies: {
        "next-auth@5.0.0": "patches/next-auth@5.0.0.patch",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not error about missing patch file
  expect(stderr).not.toContain("Couldn't find patch file");
  expect(exitCode).toBe(0);
});
