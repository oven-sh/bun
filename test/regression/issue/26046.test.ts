import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for GitHub issue #26046
// `bun pm ls` fails with `error: Error loading lockfile: InvalidPackageInfo`
// when a package has required (non-optional) peer dependencies that are not installed.

test("lockfile with optionalPeers loads successfully for bun pm ls", async () => {
  // This test verifies that when a lockfile properly includes unresolved peer deps
  // in optionalPeers (which our fix ensures during lockfile writing), the lockfile
  // can be loaded without errors by commands like `bun pm ls`.

  // Create a lockfile that simulates the FIXED behavior:
  // - Package has a peer dependency that is NOT resolved (not installed)
  // - The peer dependency IS in optionalPeers (because our fix adds it there)
  const lockfile = {
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: {
      "": {
        name: "test-issue-26046",
        devDependencies: {
          "test-pkg": "1.0.0",
        },
      },
    },
    packages: {
      "test-pkg": [
        "test-pkg@1.0.0",
        "",
        {
          peerDependencies: {
            "unresolved-peer": "*",
          },
          // Key: the unresolved peer IS in optionalPeers
          // Our fix ensures this happens during lockfile writing
          optionalPeers: ["unresolved-peer"],
        },
        "sha512-test==",
      ],
    },
  };

  using dir = tempDir("issue-26046", {
    "package.json": JSON.stringify({
      name: "test-issue-26046",
      devDependencies: {
        "test-pkg": "1.0.0",
      },
    }),
    "bun.lock": JSON.stringify(lockfile, null, 2),
    // Create a fake node_modules structure so bun pm ls doesn't try to install
    "node_modules/test-pkg/package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      peerDependencies: {
        "unresolved-peer": "*",
      },
    }),
  });

  // Run bun pm ls - with the fix, this should work because the unresolved
  // peer dep is properly marked as optional in the lockfile
  await using lsProc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [lsStdout, lsStderr, lsExitCode] = await Promise.all([
    lsProc.stdout.text(),
    lsProc.stderr.text(),
    lsProc.exited,
  ]);

  // Should not have InvalidPackageInfo error
  expect(lsStderr).not.toContain("InvalidPackageInfo");
  expect(lsStdout).toContain("test-pkg");
  expect(lsExitCode).toBe(0);
});

test("lockfile WITHOUT optionalPeers fails for unresolved required peer deps", async () => {
  // This test documents the bug that existed before the fix:
  // When a lockfile has a peer dep that's NOT in optionalPeers and NOT installed,
  // loading the lockfile fails with InvalidPackageInfo.
  //
  // NOTE: This test shows the BROKEN behavior that users experienced.
  // The fix prevents new lockfiles from being written in this broken state.

  // Create a lockfile that simulates the BROKEN (pre-fix) behavior:
  // - Package has a required peer dependency that is NOT resolved
  // - The peer dependency is NOT in optionalPeers (the bug)
  const lockfile = {
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: {
      "": {
        name: "test-issue-26046",
        devDependencies: {
          "test-pkg": "1.0.0",
        },
      },
    },
    packages: {
      "test-pkg": [
        "test-pkg@1.0.0",
        "",
        {
          peerDependencies: {
            "unresolved-peer": "*",
          },
          // Bug: the unresolved peer is NOT in optionalPeers
          // This causes InvalidPackageInfo when loading
        },
        "sha512-test==",
      ],
    },
  };

  using dir = tempDir("issue-26046-broken", {
    "package.json": JSON.stringify({
      name: "test-issue-26046",
      devDependencies: {
        "test-pkg": "1.0.0",
      },
    }),
    "bun.lock": JSON.stringify(lockfile, null, 2),
    "node_modules/test-pkg/package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      peerDependencies: {
        "unresolved-peer": "*",
      },
    }),
  });

  // Run bun pm ls - this should fail with InvalidPackageInfo
  await using lsProc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [_, lsStderr, lsExitCode] = await Promise.all([lsProc.stdout.text(), lsProc.stderr.text(), lsProc.exited]);

  // This shows the broken behavior: lockfile loading fails
  expect(lsStderr).toContain("InvalidPackageInfo");
  expect(lsExitCode).toBe(1);
});
