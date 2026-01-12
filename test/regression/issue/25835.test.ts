import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/25835
// Bug: When using overrides in a monorepo workspace to redirect dependencies to
// vendored file: tarballs, Bun resolves the file: path relative to the requesting
// workspace package rather than the workspace root where the override is defined.

test("override with file: tarball in workspace resolves relative to workspace root", async () => {
  // Create directory structure with initial files
  using dir = tempDir("issue-25835", {
    "package.json": JSON.stringify({
      name: "monorepo-root",
      workspaces: ["apps/*"],
      overrides: {
        "@pkg/utils": "file:vendored/pkg-utils-1.0.0.tgz",
      },
    }),
    "apps/editor/package.json": JSON.stringify({
      name: "@app/editor",
      dependencies: {
        "@pkg/utils": "1.0.0",
      },
    }),
    // Placeholder for vendored directory
    "vendored/.gitkeep": "",
    // Temp package for tarball creation
    "_tmp_pkg/package/package.json": JSON.stringify({
      name: "@pkg/utils",
      version: "1.0.0",
      main: "index.js",
    }),
    "_tmp_pkg/package/index.js": "module.exports = { id: 1 };",
  });

  const tmpPkgDir = join(String(dir), "_tmp_pkg");

  // Create tarball using tar
  await using tarProc = Bun.spawn({
    cmd: ["tar", "-czf", join(String(dir), "vendored", "pkg-utils-1.0.0.tgz"), "-C", tmpPkgDir, "package"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const tarExitCode = await tarProc.exited;
  expect(tarExitCode).toBe(0);

  // Run bun install
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not have ENOENT error trying to find tarball in apps/editor/vendored/
  expect(stderr).not.toContain("ENOENT");
  expect(stderr).not.toContain("failed to resolve");
  expect(exitCode).toBe(0);

  // Verify the package was installed (it may be in the workspace's node_modules)
  const pkgUtilsPath = join(String(dir), "apps", "editor", "node_modules", "@pkg", "utils", "package.json");
  const pkgUtils = await Bun.file(pkgUtilsPath).json();
  expect(pkgUtils.name).toBe("@pkg/utils");
  expect(pkgUtils.version).toBe("1.0.0");
});
