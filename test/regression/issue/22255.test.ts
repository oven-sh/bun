import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/22255
// bun remove <pkg> without node_modules incorrectly installs packages with specific bunfig.toml settings
test("issue 22255: bun remove should not install packages when node_modules doesn't exist", async () => {
  const dir = tempDirWithFiles("22255-bun-remove-bug", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        "left-pad": "1.3.0",
        "is-even": "1.0.0",
        "is-odd": "1.0.0"
      }
    }),
    "bunfig.toml": `[install]
cache.disable = true
linker = "hoisted"
`
  });

  // Verify no node_modules exists initially
  const nodeModulesPath = join(dir, "node_modules");
  expect(await Bun.file(nodeModulesPath).exists()).toBe(false);

  // Run bun remove - this should only modify package.json, not install packages
  await using removeProc = Bun.spawn({
    cmd: [bunExe(), "remove", "is-even"],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: undefined }, // Use real npm registry to reproduce bug
  });

  const exitCode = await removeProc.exited;
  expect(exitCode).toBe(0);

  // Verify package was removed from package.json
  const packageJson = await Bun.file(join(dir, "package.json")).json();
  expect(packageJson.dependencies).toEqual({
    "left-pad": "1.3.0",
    "is-odd": "1.0.0"
  });
  expect(packageJson.dependencies["is-even"]).toBeUndefined();

  // BUG: bun remove should NOT create node_modules when it didn't exist before
  // This assertion documents the expected behavior and will pass once the bug is fixed
  const nodeModulesExists = await Bun.file(nodeModulesPath).exists();
  
  if (nodeModulesExists) {
    // If bug is present, at least verify the removed package isn't installed
    const removedPackageExists = await Bun.file(join(nodeModulesPath, "is-even")).exists();
    expect(removedPackageExists).toBe(false);
  }

  // Main assertion - this is the correct behavior we want
  expect(nodeModulesExists).toBe(false);
});