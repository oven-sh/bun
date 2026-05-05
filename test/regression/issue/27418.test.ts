import { spawn } from "bun";
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { bunEnv, bunExe, pack, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27418
// bun install should not contact the npm registry for bundled dependencies
// since they are already included inside the tarball.
test("bun install does not fetch bundled dependencies from registry", async () => {
  using dir = tempDir("issue-27418", {});

  // Create the package that will be packed as a tarball
  const pkgDir = join(String(dir), "my-pkg");
  const bundledPkgDir = join(pkgDir, "node_modules", "fake-nonexistent-pkg-27418");
  await mkdir(bundledPkgDir, { recursive: true });

  await Promise.all([
    writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "my-pkg",
        version: "1.0.0",
        dependencies: {
          "fake-nonexistent-pkg-27418": "1.0.0",
        },
        bundleDependencies: ["fake-nonexistent-pkg-27418"],
      }),
    ),
    writeFile(
      join(bundledPkgDir, "package.json"),
      JSON.stringify({
        name: "fake-nonexistent-pkg-27418",
        version: "1.0.0",
      }),
    ),
  ]);

  // Pack the tarball (bundled deps get included in node_modules inside the tarball)
  await pack(pkgDir, bunEnv);

  // Create a consumer package that installs the tarball
  const consumerDir = join(String(dir), "consumer");
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "1.0.0",
    }),
  );

  // Install the tarball with the registry pointed at an unreachable address so that
  // any accidental registry fetch fails fast instead of hitting the real npm registry.
  await using proc = spawn({
    cmd: [bunExe(), "install", "--registry", "http://localhost:0", join(pkgDir, "my-pkg-1.0.0.tgz")],
    cwd: consumerDir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not contain any error about failing to resolve the bundled dependency
  expect(stderr).not.toContain("failed to resolve");
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("installed my-pkg");
  expect(exitCode).toBe(0);
});
