import { spawn, write, file } from "bun";
import { expect, it, beforeAll, beforeEach, afterAll } from "bun:test";
import { access, copyFile, open, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, tmpdirSync, VerdaccioRegistry } from "harness";
import { join } from "path";

var verdaccio: VerdaccioRegistry;
var packageDir: string;
var packageJson: string;

beforeAll(async () => {
  verdaccio = new VerdaccioRegistry();
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

beforeEach(async () => {
  ({ packageDir, packageJson } = await verdaccio.createTestDir());
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
});

it("should update dependency version literal when no updates are necessary", async () => {
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        workspaces: ["packages/*"],
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          "a-dep": "1.0.1",
        },
      }),
    ),
  ]);

  let { exited } = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: packageDir,
    env,
  });

  expect(await exited).toBe(0);

  const firstLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
    /localhost:\d+/g,
    "localhost:1234",
  );
  expect(firstLockfile).toMatchSnapshot();

  // "no-deps" is updated, but the version still satisfies the resolved
  // package in the lockfile. no install should happen, but the dependency
  // string in the lockfile should be updated.
  await write(
    packageJson,
    JSON.stringify({
      workspaces: ["packages/*"],
      dependencies: {
        "no-deps": "^1.0.0",
      },
    }),
  );

  ({ exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
  }));

  expect(await exited).toBe(0);

  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });

  const secondLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
    /localhost:\d+/g,
    "localhost:1234",
  );
  expect(firstLockfile).not.toBe(secondLockfile);
  expect(secondLockfile).toMatchSnapshot();

  // now the same with "a-dep" in the workspace
  await write(
    join(packageDir, "packages", "pkg1", "package.json"),
    JSON.stringify({
      name: "pkg1",
      dependencies: {
        "a-dep": "^1.0.1",
      },
    }),
  );

  ({ exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env,
  }));

  expect(await exited).toBe(0);

  expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toEqual({
    name: "a-dep",
    version: "1.0.1",
  });

  const thirdLockfile = (await file(join(packageDir, "bun.lock")).text()).replaceAll(
    /localhost:\d+/g,
    "localhost:1234",
  );
  expect(thirdLockfile).not.toBe(secondLockfile);
  expect(thirdLockfile).not.toBe(firstLockfile);
  expect(thirdLockfile).toMatchSnapshot();
});

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
