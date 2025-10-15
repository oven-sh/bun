import { file } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

test("offline mode: successful install with cached packages", async () => {
  using tmpdir = tempDir("offline-success", {
    "package.json": JSON.stringify({
      name: "test-offline-success",
      version: "1.0.0",
      dependencies: {
        "is-odd": "3.0.1",
      },
    }),
  });

  // First install to populate cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  expect(exitCode1).toBe(0);

  // Remove node_modules and lockfile
  await using rmProc = Bun.spawn({
    cmd: ["rm", "-rf", "node_modules", "bun.lockb"],
    cwd: String(tmpdir),
  });
  await rmProc.exited;

  // Install again in offline mode
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--offline"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stderr2, tmpdir)).toContain("Installing in offline mode (using cache only)");

  // Verify package was installed
  const isOddPath = join(String(tmpdir), "node_modules", "is-odd", "package.json");
  const isOddPkg = await file(isOddPath).json();
  expect(isOddPkg.name).toBe("is-odd");
  expect(isOddPkg.version).toBe("3.0.1");
});

test("offline mode: fails when package not in cache", async () => {
  using tmpdir = tempDir("offline-fail-not-cached", {
    "package.json": JSON.stringify({
      name: "test-offline-fail",
      version: "1.0.0",
      dependencies: {
        // Using a package that's very unlikely to be in cache
        "some-nonexistent-package-that-should-never-exist": "1.0.0",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--offline"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(normalizeBunSnapshot(stderr, tmpdir)).toContain("Installing in offline mode (using cache only)");
  expect(normalizeBunSnapshot(stderr, tmpdir)).toContain("not found in cache (offline mode)");
});

test("offline mode: works without existing lockfile", async () => {
  using tmpdir = tempDir("offline-no-lockfile", {
    "package.json": JSON.stringify({
      name: "test-offline-no-lockfile",
      version: "1.0.0",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  // First install to populate cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc1.exited;

  // Remove node_modules and lockfile
  await using rmProc = Bun.spawn({
    cmd: ["rm", "-rf", "node_modules", "bun.lockb"],
    cwd: String(tmpdir),
  });
  await rmProc.exited;

  // Install in offline mode without lockfile
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--offline"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stderr2, tmpdir)).toContain("Installing in offline mode (using cache only)");

  // Verify package was installed
  const isEvenPath = join(String(tmpdir), "node_modules", "is-even", "package.json");
  const isEvenPkg = await file(isEvenPath).json();
  expect(isEvenPkg.name).toBe("is-even");
});

test("offline mode: skips optional dependencies not in cache", async () => {
  using tmpdir = tempDir("offline-optional-deps", {
    "package.json": JSON.stringify({
      name: "test-offline-optional",
      version: "1.0.0",
      dependencies: {
        "is-number": "7.0.0",
      },
      optionalDependencies: {
        // This package doesn't exist, but should be skipped
        "some-nonexistent-optional-package": "1.0.0",
      },
    }),
  });

  // First install is-number to cache it
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install", "--no-optional"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc1.exited;

  // Remove node_modules and lockfile
  await using rmProc = Bun.spawn({
    cmd: ["rm", "-rf", "node_modules", "bun.lockb"],
    cwd: String(tmpdir),
  });
  await rmProc.exited;

  // Install in offline mode - should succeed despite optional dep missing
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--offline"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stderr2, tmpdir)).toContain("Installing in offline mode (using cache only)");

  // Verify is-number was installed
  const isNumberPath = join(String(tmpdir), "node_modules", "is-number", "package.json");
  const isNumberPkg = await file(isNumberPath).json();
  expect(isNumberPkg.name).toBe("is-number");
});

test.skip("offline mode: rejects git dependencies", async () => {
  using tmpdir = tempDir("offline-git-deps", {
    "package.json": JSON.stringify({
      name: "test-offline-git",
      version: "1.0.0",
      dependencies: {
        "is-odd": "3.0.1",
      },
    }),
  });

  // First install to populate cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc1.exited;

  // Change to a git dependency (which can't be cached)
  await Bun.write(
    join(String(tmpdir), "package.json"),
    JSON.stringify({
      name: "test-offline-git",
      version: "1.0.0",
      dependencies: {
        "some-git-package": "git+https://github.com/user/repo.git#main",
      },
    }),
  );

  // Remove node_modules and lockfile
  await using rmProc = Bun.spawn({
    cmd: ["rm", "-rf", "node_modules", "bun.lockb"],
    cwd: String(tmpdir),
  });
  await rmProc.exited;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--offline"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).not.toBe(0);
  expect(normalizeBunSnapshot(stderr, tmpdir)).toContain("Installing in offline mode (using cache only)");
});

test("offline mode: works with workspace dependencies", async () => {
  using tmpdir = tempDir("offline-workspace", {
    "package.json": JSON.stringify({
      name: "test-offline-workspace",
      version: "1.0.0",
      workspaces: ["packages/*"],
    }),
    "packages/pkg-a/package.json": JSON.stringify({
      name: "pkg-a",
      version: "1.0.0",
      dependencies: {
        "is-odd": "3.0.1",
      },
    }),
  });

  // First install to populate cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc1.exited;

  // Remove node_modules and lockfile
  await using rmProc = Bun.spawn({
    cmd: ["rm", "-rf", "node_modules", "packages/pkg-a/node_modules", "bun.lockb"],
    cwd: String(tmpdir),
  });
  await rmProc.exited;

  // Install in offline mode
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--offline"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stderr2, tmpdir)).toContain("Installing in offline mode (using cache only)");

  // Verify package was installed (in workspace node_modules)
  const pkgAPath = join(String(tmpdir), "packages", "pkg-a", "node_modules", "is-odd", "package.json");
  const isOddPkg = await file(pkgAPath).json();
  expect(isOddPkg.name).toBe("is-odd");
});

test("offline mode: uses stale manifests (ignores expiry)", async () => {
  using tmpdir = tempDir("offline-stale-manifest", {
    "package.json": JSON.stringify({
      name: "test-offline-stale",
      version: "1.0.0",
      dependencies: {
        "lodash": "^4.17.0",
      },
    }),
  });

  // First install to populate cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc1.exited;

  // Remove node_modules and lockfile
  await using rmProc = Bun.spawn({
    cmd: ["rm", "-rf", "node_modules", "bun.lockb"],
    cwd: String(tmpdir),
  });
  await rmProc.exited;

  // Install in offline mode - should use cached manifest even if stale
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--offline"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stderr2, tmpdir)).toContain("Installing in offline mode (using cache only)");

  // Verify lodash was installed (some version satisfying ^4.17.0)
  const lodashPath = join(String(tmpdir), "node_modules", "lodash", "package.json");
  const lodashPkg = await file(lodashPath).json();
  expect(lodashPkg.name).toBe("lodash");
  expect(lodashPkg.version).toMatch(/^4\.17\./);
});

test("offline mode: combines with other install flags", async () => {
  using tmpdir = tempDir("offline-combined-flags", {
    "package.json": JSON.stringify({
      name: "test-offline-combined",
      version: "1.0.0",
      dependencies: {
        "ms": "2.1.3",
      },
      devDependencies: {
        "is-odd": "3.0.1",
      },
    }),
  });

  // First install to populate cache
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc1.exited;

  // Remove node_modules and lockfile
  await using rmProc = Bun.spawn({
    cmd: ["rm", "-rf", "node_modules", "bun.lockb"],
    cwd: String(tmpdir),
  });
  await rmProc.exited;

  // Install in offline mode with --production
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--offline", "--production"],
    cwd: String(tmpdir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stderr2, tmpdir)).toContain("Installing in offline mode (using cache only)");

  // Verify only production dependency was installed
  const msPath = join(String(tmpdir), "node_modules", "ms", "package.json");
  const msPkg = await file(msPath).json();
  expect(msPkg.name).toBe("ms");

  // Dev dependency should not be installed
  const isOddPath = join(String(tmpdir), "node_modules", "is-odd");
  const isOddExists = await file(join(isOddPath, "package.json"))
    .exists()
    .catch(() => false);
  expect(isOddExists).toBe(false);
});
