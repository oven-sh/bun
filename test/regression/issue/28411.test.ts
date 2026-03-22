import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun install updates bun.lock when root package name changes", async () => {
  using dir = tempDir("issue-28411", {
    "package.json": JSON.stringify({
      name: "original-name",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  // Initial install
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode1 = await proc1.exited;

  // Verify initial lockfile has original-name
  const lockfile1 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile1).toContain('"name": "original-name"');
  expect(exitCode1).toBe(0);

  // Rename the package
  const pkg = JSON.parse(await Bun.file(`${dir}/package.json`).text());
  pkg.name = "another-name";
  await Bun.write(`${dir}/package.json`, JSON.stringify(pkg));

  // Re-install
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode2 = await proc2.exited;

  // Verify lockfile now has another-name and not original-name
  const lockfile2 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile2).toContain('"name": "another-name"');
  expect(lockfile2).not.toContain("original-name");
  expect(exitCode2).toBe(0);
});

test("bun install updates bun.lock when root package name is added", async () => {
  using dir = tempDir("issue-28411-add", {
    "package.json": JSON.stringify({
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  // Initial install (no name)
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode1 = await proc1.exited;

  const lockfile1 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile1).not.toContain('"name"');
  expect(exitCode1).toBe(0);

  // Add a name
  const pkg = JSON.parse(await Bun.file(`${dir}/package.json`).text());
  pkg.name = "new-name";
  await Bun.write(`${dir}/package.json`, JSON.stringify(pkg));

  // Re-install
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode2 = await proc2.exited;

  const lockfile2 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile2).toContain('"name": "new-name"');
  expect(exitCode2).toBe(0);
});

test("bun add updates bun.lock when root package name was changed", async () => {
  using dir = tempDir("issue-28411-add-cmd", {
    "package.json": JSON.stringify({
      name: "original-name",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  // Initial install
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode1 = await proc1.exited;

  const lockfile1 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile1).toContain('"name": "original-name"');
  expect(exitCode1).toBe(0);

  // Rename the package and add a new dependency via bun add
  const pkg = JSON.parse(await Bun.file(`${dir}/package.json`).text());
  pkg.name = "renamed-pkg";
  await Bun.write(`${dir}/package.json`, JSON.stringify(pkg));

  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "add", "is-odd@0.1.2"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode2 = await proc2.exited;

  const lockfile2 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile2).toContain('"name": "renamed-pkg"');
  expect(lockfile2).not.toContain("original-name");
  expect(exitCode2).toBe(0);
});

test("bun install updates bun.lock when workspace sub-package name changes", async () => {
  using dir = tempDir("issue-28411-ws", {
    "package.json": JSON.stringify({
      name: "my-monorepo",
      workspaces: ["packages/*"],
    }),
    "packages/my-pkg/package.json": JSON.stringify({
      name: "original-name",
      version: "1.0.0",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  // Initial install
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode1 = await proc1.exited;

  const lockfile1 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile1).toContain('"name": "original-name"');
  expect(exitCode1).toBe(0);

  // Rename workspace sub-package
  await Bun.write(
    `${dir}/packages/my-pkg/package.json`,
    JSON.stringify({
      name: "another-name",
      version: "1.0.0",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  );

  // Re-install
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode2 = await proc2.exited;

  const lockfile2 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile2).toContain('"name": "another-name"');
  expect(lockfile2).not.toContain('"name": "original-name"');
  expect(exitCode2).toBe(0);
});

test("bun install --frozen-lockfile errors when root package name changed", async () => {
  using dir = tempDir("issue-28411-frozen", {
    "package.json": JSON.stringify({
      name: "original-name",
      dependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  // Initial install
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode1 = await proc1.exited;

  const lockfileBefore = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfileBefore).toContain('"name": "original-name"');
  expect(exitCode1).toBe(0);

  // Rename the package
  const pkg = JSON.parse(await Bun.file(`${dir}/package.json`).text());
  pkg.name = "another-name";
  await Bun.write(`${dir}/package.json`, JSON.stringify(pkg));

  // Frozen lockfile should reject the name change
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await proc2.stderr.text();
  expect(stderr).toContain("lockfile had changes");

  // Verify the lockfile was NOT modified on disk
  const lockfileAfter = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfileAfter).toBe(lockfileBefore);
  expect(await proc2.exited).not.toBe(0);
});
