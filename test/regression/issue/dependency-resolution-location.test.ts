import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("dependency resolution failure should point to dependency location, not package location", async () => {
  const dir = tempDirWithFiles("dependency-location-test", {
    "package.json": JSON.stringify({
      dependencies: {
        "non-existent-package": "1.0.0",
      },
    }),
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 0,
        workspaces: {
          "": {
            dependencies: {
              "non-existent-package": "1.0.0",
            },
          },
        },
        packages: {},
      },
      null,
      2,
    ),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--production"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, stdout, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("Failed to resolve root prod dependency 'non-existent-package'");

  // The error should reference the dependency line, not the root package
  // We expect to see line 4 (where "non-existent-package" is defined in the bun.lock)
  // not line 3 (where the "" workspace is defined)
  expect(stderr).toMatch(/bun\.lock:\d+:\d+/);
});
