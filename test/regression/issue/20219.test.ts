import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("GitHub Package Registry authentication issue #20219", () => {
  test("bunfig.toml and .npmrc should handle scoped package authentication identically", async () => {
    const testDir = tempDirWithFiles("issue-20219", {
      "package.json": JSON.stringify({
        name: "test-gpr-auth",
        version: "1.0.0",
        dependencies: {
          "@testorg/fake-private-package": "^1.0.0",
        },
      }),
    });

    // Test with bunfig.toml
    const bunfigDir = tempDirWithFiles("issue-20219-bunfig", {
      "package.json": JSON.stringify({
        name: "test-gpr-auth-bunfig",
        version: "1.0.0",
        dependencies: {
          "@testorg/fake-private-package": "^1.0.0",
        },
      }),
      "bunfig.toml": `
[install.scopes]
"@testorg" = { token = "$NODE_AUTH_TOKEN", url = "https://npm.pkg.github.com" }
      `.trim(),
    });

    // Test with .npmrc
    const npmrcDir = tempDirWithFiles("issue-20219-npmrc", {
      "package.json": JSON.stringify({
        name: "test-gpr-auth-npmrc",
        version: "1.0.0",
        dependencies: {
          "@testorg/fake-private-package": "^1.0.0",
        },
      }),
      ".npmrc": `
@testorg:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}
      `.trim(),
    });

    const testEnv = {
      ...bunEnv,
      NODE_AUTH_TOKEN: "fake_test_token_for_testing_12345",
    };

    // Run bun install with bunfig.toml
    const bunfigResult = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: bunfigDir,
      env: testEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    // Run bun install with .npmrc
    const npmrcResult = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: npmrcDir,
      env: testEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const bunfigStderr = bunfigResult.stderr.toString();
    const npmrcStderr = npmrcResult.stderr.toString();

    // Both should exhibit the same behavior - either both succeed or both fail with the same error type
    // For non-existent packages, both should get 404 errors, not 401 (which would indicate auth failure)

    // Check that both methods attempt to authenticate (no 401 errors)
    expect(bunfigStderr).not.toContain("401");
    expect(npmrcStderr).not.toContain("401");

    // Both should get the same error (404 for non-existent package)
    if (bunfigStderr.includes("404") || npmrcStderr.includes("404")) {
      // If one gets 404, both should get 404 (consistent behavior)
      expect(bunfigStderr).toContain("404");
      expect(npmrcStderr).toContain("404");
    }

    // Both should have the same exit code
    expect(bunfigResult.exitCode).toBe(npmrcResult.exitCode);

    // Both should make requests to the same URL format
    if (bunfigStderr.includes("npm.pkg.github.com")) {
      expect(npmrcStderr).toContain("npm.pkg.github.com");
      // Both should use the same URL encoding
      if (bunfigStderr.includes("%2f")) {
        expect(npmrcStderr).toContain("%2f");
      }
    }
  });

  test("environment variable expansion works in bunfig.toml scopes", async () => {
    const testDir = tempDirWithFiles("env-expansion-test", {
      "package.json": JSON.stringify({
        name: "env-test",
        version: "1.0.0",
        dependencies: {
          "@testscope/test-pkg": "^1.0.0",
        },
      }),
      "bunfig.toml": `
[install.scopes]
"@testscope" = { token = "$TEST_TOKEN_VAR", url = "https://npm.pkg.github.com" }
      `.trim(),
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "install"],
      cwd: testDir,
      env: {
        ...bunEnv,
        TEST_TOKEN_VAR: "expanded_token_value_123",
      },
      stderr: "pipe",
    });

    const stderr = result.stderr.toString();

    // Should not get authentication errors if the token expansion worked
    // (404 is expected for fake package, 401 would indicate token expansion failed)
    expect(stderr).not.toContain("401");
  });
});
