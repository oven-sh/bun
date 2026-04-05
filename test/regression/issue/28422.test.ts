import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const PKG_COUNT = 10;
const APP_COUNT = 3;

// Regression test for https://github.com/oven-sh/bun/issues/28422
// Isolated install was O(N²) due to resumeUnblockedTasks iterating all store
// entries on every task completion. With many workspace packages and deps,
// this caused extreme slowdowns (50x+ slower than hoisted).
test("isolated install with workspace monorepo completes without hanging", async () => {
  const files: Record<string, string> = {
    "bunfig.toml": `[install]\nlinker = "isolated"\n`,
    "package.json": JSON.stringify({
      name: "monorepo-root",
      workspaces: ["packages/*", "apps/*"],
    }),
  };

  // Generate PKG_COUNT packages with chained dependencies: pkg-i depends on pkg-(i-1),
  // and for i>=2 also on pkg-0, creating cross-workspace connectivity.
  for (let i = 0; i < PKG_COUNT; i++) {
    const deps: Record<string, string> = {};
    if (i > 0) {
      deps[`pkg-${i - 1}`] = "workspace:*";
    }
    if (i > 1) {
      deps["pkg-0"] = "workspace:*";
    }
    files[`packages/pkg-${i}/package.json`] = JSON.stringify({
      name: `pkg-${i}`,
      version: "1.0.0",
      ...(Object.keys(deps).length > 0 ? { dependencies: deps } : {}),
    });
  }

  // Generate APP_COUNT apps, each depending on a spread of packages
  for (let a = 0; a < APP_COUNT; a++) {
    const deps: Record<string, string> = {};
    // Each app depends on every 5th package plus its neighbors, creating high connectivity
    for (let i = 0; i < PKG_COUNT; i += 5) {
      deps[`pkg-${i}`] = "workspace:*";
    }
    // Plus a couple unique ones per app (offset by 1 to avoid collisions with every-5th set)
    deps[`pkg-${(a * 3 + 1) % PKG_COUNT}`] = "workspace:*";
    deps[`pkg-${(a * 7 + 2) % PKG_COUNT}`] = "workspace:*";

    files[`apps/app-${a}/package.json`] = JSON.stringify({
      name: `app-${a}`,
      version: "1.0.0",
      dependencies: deps,
    });
  }

  using dir = tempDir("isolated-perf", files);
  const packageDir = String(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");

  // Verify workspace symlinks were created for a sample of packages
  for (let a = 0; a < APP_COUNT; a++) {
    expect(existsSync(join(packageDir, "apps", `app-${a}`, "node_modules", "pkg-0"))).toBeTrue();
  }

  // Verify chained workspace dependencies resolve
  for (let i = 1; i < PKG_COUNT; i++) {
    expect(existsSync(join(packageDir, "packages", `pkg-${i}`, "node_modules", `pkg-${i - 1}`))).toBeTrue();
  }

  expect(exitCode).toBe(0);
});
