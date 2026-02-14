import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for #27033: `bun install` had exponential slowdown with workspace
// configurations containing many packages with overlapping transitive dependencies.
// The root cause was O(n) linear scans in hoistDependency() for each dependency being
// hoisted, resulting in O(n^2) behavior when many deps are hoisted to the root tree.
test("workspace install with many overlapping workspace dependencies does not hang", async () => {
  // Create a workspace with many workspace packages that cross-reference each other.
  // This exercises the hoisting code path that was O(n^2) before the fix.
  // With 30 workspace packages each depending on all others, this creates ~900
  // dependency edges that all need to be hoisted.
  const numPackages = 30;
  const files: Record<string, string> = {};

  for (let i = 0; i < numPackages; i++) {
    const deps: Record<string, string> = {};
    // Each package depends on all other packages
    for (let j = 0; j < numPackages; j++) {
      if (i !== j) {
        deps[`pkg-${j}`] = "workspace:*";
      }
    }
    files[`packages/pkg-${i}/package.json`] = JSON.stringify({
      name: `pkg-${i}`,
      version: "1.0.0",
      dependencies: deps,
    });
  }

  using dir = tempDir("issue-27033", {
    "package.json": JSON.stringify({
      name: "workspace-root",
      private: true,
      workspaces: ["packages/*"],
    }),
    ...files,
  });

  // Before the fix, this would hang or take >60s with many overlapping deps.
  // After the fix, it should complete in a few seconds.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic:");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("31 packages");
  expect(exitCode).toBe(0);
}, 30_000);
