import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Test for https://github.com/oven-sh/bun/issues/26039
// When parsing a bun.lock file with an empty registry URL for a scoped package,
// bun should use the scope-specific registry from bunfig.toml, not the default npm registry.
test("frozen lockfile should use scope-specific registry for scoped packages", async () => {
  const dir = tempDirWithFiles("scoped-registry-test", {
    "package.json": JSON.stringify({
      name: "test-scoped-registry",
      version: "1.0.0",
      dependencies: {
        "@example/test-package": "^1.0.0",
      },
    }),
    "bunfig.toml": `
[install.scopes]
example = { url = "https://npm.pkg.github.com" }
`,
    // bun.lock with empty string for registry URL - this should trigger the scope lookup
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: {
          "": {
            dependencies: {
              "@example/test-package": "^1.0.0",
            },
          },
        },
        packages: {
          "@example/test-package": ["@example/test-package@1.0.0", "", {}, "sha512-AAAA"],
        },
      },
      null,
      2,
    ),
  });

  // Run bun install --frozen-lockfile. It will fail because the package doesn't exist,
  // but the error message should show the correct registry URL (npm.pkg.github.com, not registry.npmjs.org)
  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: dir,
    env: bunEnv,
  });

  const stderrText = stderr.toString();

  // Before the fix, this would try to fetch from https://registry.npmjs.org/@example/test-package/-/test-package-1.0.0.tgz
  // After the fix, it should try to fetch from https://npm.pkg.github.com/@example/test-package/-/test-package-1.0.0.tgz
  expect(stderrText).toContain("npm.pkg.github.com");
  expect(stderrText).not.toContain("registry.npmjs.org");
  // The install should fail because the package doesn't exist on the registry
  expect(exitCode).not.toBe(0);
});

// Test that non-scoped packages still use the default registry when registry URL is empty
test("frozen lockfile should use default registry for non-scoped packages", async () => {
  const dir = tempDirWithFiles("non-scoped-registry-test", {
    "package.json": JSON.stringify({
      name: "test-non-scoped-registry",
      version: "1.0.0",
      dependencies: {
        "fake-nonexistent-package": "^1.0.0",
      },
    }),
    "bunfig.toml": `
[install.scopes]
example = { url = "https://npm.pkg.github.com" }
`,
    // bun.lock with empty string for registry URL for non-scoped package
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: {
          "": {
            dependencies: {
              "fake-nonexistent-package": "^1.0.0",
            },
          },
        },
        packages: {
          "fake-nonexistent-package": ["fake-nonexistent-package@1.0.0", "", {}, "sha512-BBBB"],
        },
      },
      null,
      2,
    ),
  });

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: dir,
    env: bunEnv,
  });

  const stderrText = stderr.toString();

  // Non-scoped packages should still use the default registry
  expect(stderrText).toContain("registry.npmjs.org");
  expect(stderrText).not.toContain("npm.pkg.github.com");
  // The install should fail because the package doesn't exist on the registry
  expect(exitCode).not.toBe(0);
});
