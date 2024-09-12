import { file, listen, Socket, spawn } from "bun";
import { tmpdirSync } from "harness";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { access, mkdir, readlink, rm, writeFile, copyFile } from "fs/promises";
import { bunEnv, bunExe, bunEnv as env, tempDirWithFiles, toBeValidBin, toBeWorkspaceLink, toHaveBins } from "harness";
import { join, sep } from "path";

it("should not print anything to stderr when running bun.lockb", async () => {
  const package_dir = tmpdirSync();

  // copy bar-0.0.2.tgz to package_dir
  await copyFile(join(__dirname, "bar-0.0.2.tgz"), join(package_dir, "bar-0.0.2.tgz"));

  // Create a simple package.json
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-package",
      version: "1.0.0",
      dependencies: {
        "dummy-package": "file:./bar-0.0.2.tgz",
      },
    }),
  );

  // Run 'bun install' to generate the lockfile
  const installResult = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    env,
  });
  await installResult.exited;

  // Ensure the lockfile was created
  await access(join(package_dir, "bun.lockb"));

  // create a .env
  await writeFile(join(package_dir, ".env"), "FOO=bar");

  // Now test 'bun bun.lockb'
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "bun.lockb"],
    cwd: package_dir,
    stdout: "inherit",
    stderr: "inherit",
    env,
  });

  const stderrOutput = await new Response(stderr).text();
  expect(stderrOutput).toBe("");

  expect(await exited).toBe(0);
});
