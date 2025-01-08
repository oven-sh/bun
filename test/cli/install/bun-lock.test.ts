import { spawn, write, file } from "bun";
import { expect, it } from "bun:test";
import { access, copyFile, open, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, tmpdirSync } from "harness";
import { join } from "path";

it("should write plaintext lockfiles", async () => {
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
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: package_dir,
    env,
  });
  await installResult.exited;

  // Ensure the lockfile was created
  await access(join(package_dir, "bun.lock"));

  // Assert that the lockfile has the correct permissions
  const file = await open(join(package_dir, "bun.lock"), "r");
  const stat = await file.stat();

  // in unix, 0o644 == 33188
  let mode = 33188;
  // ..but windows is different
  if (isWindows) {
    mode = 33206;
  }
  expect(stat.mode).toBe(mode);

  expect(await file.readFile({ encoding: "utf8" })).toMatchSnapshot();
});

// won't work on windows, " is not a valid character in a filename
it.skipIf(isWindows)("should escape names", async () => {
  const packageDir = tmpdirSync();
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "quote-in-dependency-name",
        workspaces: ["packages/*"],
      }),
    ),
    write(join(packageDir, "packages", '"', "package.json"), JSON.stringify({ name: '"' })),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          '"': "*",
        },
      }),
    ),
  ]);

  const { exited } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: packageDir,
    stdout: "ignore",
    stderr: "ignore",
    env,
  });

  expect(await exited).toBe(0);

  expect(await file(join(packageDir, "bun.lock")).text()).toMatchSnapshot();
});
