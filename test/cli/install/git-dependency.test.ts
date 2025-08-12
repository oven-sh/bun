import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("install github dependency", async () => {
  const dir = tempDirWithFiles("test-github-install", {
    "package.json": JSON.stringify({
      name: "test-github-install",
      dependencies: {
        // Using github: shorthand which downloads as tarball
        "awesome-bun": "github:oven-sh/awesome-bun",
      },
    }),
  });

  const result = spawnSync({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).not.toContain("error");

  // Check that the package was installed
  const packagePath = join(dir, "node_modules", "awesome-bun");
  expect(existsSync(packagePath)).toBe(true);

  // Should have README.md
  const readmePath = join(packagePath, "README.md");
  expect(existsSync(readmePath)).toBe(true);
});

test("install git+https URL dependency", async () => {
  const dir = tempDirWithFiles("test-git-url", {
    "package.json": JSON.stringify({
      name: "test-git-url",
      dependencies: {
        // Using git+ prefix which triggers git clone - use a smaller repo
        "awesome-bun": "git+https://github.com/oven-sh/awesome-bun.git#main",
      },
    }),
  });

  const result = spawnSync({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).not.toContain("error");

  // Check that the package was installed
  const packagePath = join(dir, "node_modules", "awesome-bun");
  expect(existsSync(packagePath)).toBe(true);
});

test("install git URL without commit hash", async () => {
  const dir = tempDirWithFiles("test-git-no-hash", {
    "package.json": JSON.stringify({
      name: "test-git-no-hash",
      dependencies: {
        // Using HEAD of default branch
        "awesome-bun-2": "git+https://github.com/oven-sh/awesome-bun.git",
      },
    }),
  });

  const result = spawnSync({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).not.toContain("error");

  // Check that the package was installed
  const packagePath = join(dir, "node_modules", "awesome-bun-2");
  expect(existsSync(packagePath)).toBe(true);
});
