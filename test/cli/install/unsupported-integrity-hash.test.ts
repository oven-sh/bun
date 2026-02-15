import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("lockfile with unsupported integrity hash algorithm should fail", async () => {
  using dir = tempDir("unsupported-integrity", {
    "package.json": JSON.stringify({
      name: "test-unsupported-integrity",
      dependencies: {
        "is-number": "7.0.0",
      },
    }),
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: {
          "": {
            name: "test-unsupported-integrity",
            dependencies: {
              "is-number": "7.0.0",
            },
          },
        },
        packages: {
          "is-number": ["is-number@7.0.0", "", {}, "md5-AAAAAAAAAA=="],
        },
      },
      null,
      2,
    ),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Unsupported integrity hash algorithm");
  expect(exitCode).toBe(1);
});

test("lockfile with valid integrity hash algorithm should succeed", async () => {
  // First, create a real lockfile by installing
  using dir = tempDir("valid-integrity", {
    "package.json": JSON.stringify({
      name: "test-valid-integrity",
      dependencies: {
        "is-number": "7.0.0",
      },
    }),
  });

  // Run install to generate a valid lockfile
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Now run with --frozen-lockfile to verify it works
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Unsupported integrity hash algorithm");
  expect(exitCode).toBe(0);
});

test("lockfile with garbage integrity string should fail", async () => {
  using dir = tempDir("garbage-integrity", {
    "package.json": JSON.stringify({
      name: "test-garbage-integrity",
      dependencies: {
        "is-number": "7.0.0",
      },
    }),
    "bun.lock": JSON.stringify(
      {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: {
          "": {
            name: "test-garbage-integrity",
            dependencies: {
              "is-number": "7.0.0",
            },
          },
        },
        packages: {
          "is-number": ["is-number@7.0.0", "", {}, "not-a-real-hash"],
        },
      },
      null,
      2,
    ),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Unsupported integrity hash algorithm");
  expect(exitCode).toBe(1);
});
