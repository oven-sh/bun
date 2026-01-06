import { write } from "bun";
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

function install(cwd: string, args: string[]) {
  const exec = Bun.spawnSync({
    cmd: [bunExe(), ...args, "--linker=hoisted"],
    cwd,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: bunEnv,
  });
  if (exec.exitCode !== 0) {
    throw new Error(`bun install exited with code ${exec.exitCode}`);
  }
  return exec;
}

function installExpectFail(cwd: string, args: string[]) {
  const exec = Bun.spawnSync({
    cmd: [bunExe(), ...args],
    cwd,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: bunEnv,
  });
  if (exec.exitCode === 0) {
    throw new Error(`bun install exited with code ${exec.exitCode}, (expected failure)`);
  }
  return exec;
}

function versionOf(cwd: string, path: string) {
  const data = readFileSync(join(cwd, path));
  const json = JSON.parse(data.toString());
  return json.version;
}

function ensureLockfileDoesntChangeOnBunI(cwd: string) {
  install(cwd, ["install"]);
  const lockb1 = readFileSync(join(cwd, "bun.lock"));
  install(cwd, ["install", "--frozen-lockfile"]);
  install(cwd, ["install", "--force"]);
  const lockb2 = readFileSync(join(cwd, "bun.lock"));

  expect(lockb1.toString("hex")).toEqual(lockb2.toString("hex"));
}

test("overrides affect your own packages", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        lodash: "4.0.0",
      },
    }),
  );
  install(tmp, ["install", "lodash"]);
  expect(versionOf(tmp, "node_modules/lodash/package.json")).toBe("4.0.0");
  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("overrides affects all dependencies", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("overrides being set later affects all dependencies", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).not.toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);

  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(tmp, "package.json")).toString()),
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("overrides to npm specifier", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "npm:lodash@4.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);

  const bytes = JSON.parse(readFileSync(join(tmp, "node_modules/bytes/package.json"), "utf-8"));

  expect(bytes.name).toBe("lodash");
  expect(bytes.version).toBe("4.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("changing overrides makes the lockfile changed, prevent frozen install", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);

  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(tmp, "package.json")).toString()),
      overrides: {
        bytes: "1.0.1",
      },
    }),
  );

  installExpectFail(tmp, ["install", "--frozen-lockfile"]);
});

test("overrides reset when removed", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      overrides: {
        bytes: "1.0.0",
      },
    }),
  );
  install(tmp, ["install", "express@4.18.2"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(tmp, "package.json")).toString()),
      overrides: undefined,
    }),
  );
  install(tmp, ["install"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).not.toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("overrides do not apply to workspaces", async () => {
  const tmp = tmpdirSync();
  await Promise.all([
    write(
      join(tmp, "package.json"),
      JSON.stringify({ name: "monorepo-root", workspaces: ["packages/*"], overrides: { "pkg1": "file:pkg2" } }),
    ),
    write(
      join(tmp, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.1.1",
      }),
    ),
    write(
      join(tmp, "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        version: "2.2.2",
      }),
    ),
  ]);

  let { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: tmp,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  });

  expect(await exited).toBe(0);
  expect(await stderr.text()).toContain("Saved lockfile");

  // --frozen-lockfile works
  ({ exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: tmp,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  }));

  expect(await exited).toBe(0);
  expect(await stderr.text()).not.toContain("Frozen lockfile");

  // lockfile is not changed

  ({ exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: tmp,
    env: bunEnv,
    stderr: "pipe",
    stdout: "inherit",
  }));

  expect(await exited).toBe(0);
  expect(await stderr.text()).not.toContain("Saved lockfile");
});

test("bun add updates overrides when adding new version of overridden package", async () => {
  // Regression test for https://github.com/oven-sh/bun/issues/25843
  // When running `bun add pkg@newversion`, if there's an override for that package,
  // the override should also be updated to prevent conflicts.
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        lodash: "4.0.0",
      },
      overrides: {
        lodash: "4.0.0",
      },
    }),
  );

  // First install to set up the lockfile with the old version
  install(tmp, ["install"]);
  expect(versionOf(tmp, "node_modules/lodash/package.json")).toBe("4.0.0");

  // Now use bun add to update to a new version
  install(tmp, ["add", "lodash@4.17.21"]);

  // Verify the new version is installed
  expect(versionOf(tmp, "node_modules/lodash/package.json")).toBe("4.17.21");

  // Verify the package.json was updated correctly (both dependencies and overrides)
  const packageJson = JSON.parse(readFileSync(join(tmp, "package.json")).toString());
  expect(packageJson.dependencies.lodash).toBe("4.17.21");
  expect(packageJson.overrides.lodash).toBe("4.17.21");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("bun add updates resolutions when adding new version of package with resolution", async () => {
  // Similar to overrides test but for yarn-style resolutions
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        lodash: "4.0.0",
      },
      resolutions: {
        lodash: "4.0.0",
      },
    }),
  );

  // First install to set up the lockfile with the old version
  install(tmp, ["install"]);
  expect(versionOf(tmp, "node_modules/lodash/package.json")).toBe("4.0.0");

  // Now use bun add to update to a new version
  install(tmp, ["add", "lodash@4.17.21"]);

  // Verify the new version is installed
  expect(versionOf(tmp, "node_modules/lodash/package.json")).toBe("4.17.21");

  // Verify the package.json was updated correctly (both dependencies and resolutions)
  const packageJson = JSON.parse(readFileSync(join(tmp, "package.json")).toString());
  expect(packageJson.dependencies.lodash).toBe("4.17.21");
  expect(packageJson.resolutions.lodash).toBe("4.17.21");

  ensureLockfileDoesntChangeOnBunI(tmp);
});
