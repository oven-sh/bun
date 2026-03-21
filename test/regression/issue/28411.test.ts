import { test, expect } from "bun:test";
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
  await proc1.exited;

  // Verify initial lockfile has original-name
  const lockfile1 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile1).toContain('"name": "original-name"');

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
  await proc2.exited;

  // Verify lockfile now has another-name and not original-name
  const lockfile2 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile2).toContain('"name": "another-name"');
  expect(lockfile2).not.toContain("original-name");
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
  await proc1.exited;

  const lockfile1 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile1).not.toContain('"name"');

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
  await proc2.exited;

  const lockfile2 = await Bun.file(`${dir}/bun.lock`).text();
  expect(lockfile2).toContain('"name": "new-name"');
});
