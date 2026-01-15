import { file } from "bun";
import { expect, test } from "bun:test";
import { readlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/26140
// Bug: @types/* packages in .bun/node_modules/ are resolved based on
// alphabetical workspace package name ordering, causing type resolution
// issues in monorepos with mixed dependency versions.
//
// Expected: The highest version should be hoisted regardless of workspace
// package name ordering.

test("hoists highest version regardless of alphabetical workspace order", async () => {
  // Setup: Two workspaces with different versions of is-number
  // - aaa-pkg (alphabetically first) depends on is-number@5.0.0
  // - bbb-pkg (alphabetically second) depends on is-number@7.0.0
  //
  // Before fix: is-number@5.0.0 would be hoisted because aaa-pkg comes first
  // After fix: is-number@7.0.0 should be hoisted because it's the higher version
  using dir = tempDir("issue-26140", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      workspaces: ["packages/*"],
    }),
    "bunfig.toml": `
[install]
linker = "isolated"
`,
    "packages/aaa-pkg/package.json": JSON.stringify({
      name: "@test/aaa-pkg",
      version: "1.0.0",
      dependencies: {
        "is-number": "5.0.0",
      },
    }),
    "packages/bbb-pkg/package.json": JSON.stringify({
      name: "@test/bbb-pkg",
      version: "1.0.0",
      dependencies: {
        "is-number": "7.0.0",
      },
    }),
  });

  const packageDir = String(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic:");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // The hoisted symlink should point to the higher version (7.0.0)
  const hoistedLink = readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "is-number"));
  expect(hoistedLink).toContain("is-number@7.0.0");

  // Verify both versions are installed in their respective locations
  const pkg1 = await file(
    join(packageDir, "node_modules", ".bun", "is-number@5.0.0", "node_modules", "is-number", "package.json"),
  ).json();
  expect(pkg1.version).toBe("5.0.0");

  const pkg2 = await file(
    join(packageDir, "node_modules", ".bun", "is-number@7.0.0", "node_modules", "is-number", "package.json"),
  ).json();
  expect(pkg2.version).toBe("7.0.0");
});

test("hoists highest version when alphabetically later workspace has higher version", async () => {
  // Setup: Two workspaces with different versions of is-number
  // - aaa-pkg (alphabetically first) depends on is-number@7.0.0
  // - zzz-pkg (alphabetically last) depends on is-number@5.0.0
  //
  // This test ensures version 7.0.0 is still hoisted even though it's in
  // the alphabetically first workspace (confirms we don't regress when the
  // order already works)
  using dir = tempDir("issue-26140-alt", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      workspaces: ["packages/*"],
    }),
    "bunfig.toml": `
[install]
linker = "isolated"
`,
    "packages/aaa-pkg/package.json": JSON.stringify({
      name: "@test/aaa-pkg",
      version: "1.0.0",
      dependencies: {
        "is-number": "7.0.0",
      },
    }),
    "packages/zzz-pkg/package.json": JSON.stringify({
      name: "@test/zzz-pkg",
      version: "1.0.0",
      dependencies: {
        "is-number": "5.0.0",
      },
    }),
  });

  const packageDir = String(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic:");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // The hoisted symlink should still point to the higher version (7.0.0)
  const hoistedLink = readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "is-number"));
  expect(hoistedLink).toContain("is-number@7.0.0");
});
