import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Issue #18011: --filter indefinitely waits for dependent package when using long-running scripts.
// When package "frontend" depends on "ui-kit" (via workspace dependency), running
// `bun --filter '*' dev` should not block "frontend" from starting until "ui-kit" exits.
// The --parallel flag should skip dependency ordering so all scripts start concurrently.
test("--parallel --filter starts all scripts concurrently regardless of dependencies", () => {
  using dir = tempDir("issue-18011", {
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
    }),
    packages: {
      "ui-kit": {
        "dev.js": `console.log("ui-kit-started"); await new Promise(r => setTimeout(r, 1000));`,
        "package.json": JSON.stringify({
          name: "ui-kit",
          scripts: {
            dev: `${bunExe()} run dev.js`,
          },
        }),
      },
      frontend: {
        "dev.js": `console.log("frontend-started"); await new Promise(r => setTimeout(r, 1000));`,
        "package.json": JSON.stringify({
          name: "frontend",
          dependencies: {
            "ui-kit": "workspace:^",
          },
          scripts: {
            dev: `${bunExe()} run dev.js`,
          },
        }),
      },
      unrelated: {
        "dev.js": `console.log("unrelated-started"); await new Promise(r => setTimeout(r, 1000));`,
        "package.json": JSON.stringify({
          name: "unrelated",
          scripts: {
            dev: `${bunExe()} run dev.js`,
          },
        }),
      },
    },
  });

  // --parallel --filter should: (1) respect the filter pattern, (2) skip dependency ordering.
  // We filter to only ui-kit and frontend, excluding "unrelated".
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), "run", "--parallel", "--filter", "ui-kit", "--filter", "frontend", "dev"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const out = stdout.toString();

  // Both filtered scripts should have started concurrently
  expect(out).toContain("ui-kit-started");
  expect(out).toContain("frontend-started");
  // The unrelated package should NOT have run (filter is respected)
  expect(out).not.toContain("unrelated-started");
  // Verify we go through FilterRun (uses "name script:" format) not MultiRun (uses "name:script |" format)
  expect(out).toMatch(/ui-kit dev:/);
  expect(out).toMatch(/frontend dev:/);
  expect(exitCode).toBe(0);
});
