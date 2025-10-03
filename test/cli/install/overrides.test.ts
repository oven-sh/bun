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
    cmd: [bunExe(), ...args],
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

// NPM-style nested overrides tests
test("nested overrides - npm format parent-specific", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
      },
      overrides: {
        express: {
          bytes: "1.0.0",
        },
      },
    }),
  );
  install(tmp, ["install"]);

  // Express depends on bytes, so it should get the parent-specific override (1.0.0)
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("nested overrides - npm format with global and parent-specific", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
      },
      overrides: {
        bytes: "2.0.0", // global
        express: {
          bytes: "1.0.0", // override for express's bytes dependency
        },
      },
    }),
  );
  install(tmp, ["install"]);

  // Express depends on bytes, should get the parent-specific override (1.0.0)
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

// Yarn-style nested resolutions tests
test("nested resolutions - yarn format parent/child", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
      },
      resolutions: {
        bytes: "2.0.0", // global fallback
        "express/bytes": "1.0.0", // nested override
      },
    }),
  );
  install(tmp, ["install"]);

  // Express depends on bytes, should get parent-specific override
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("nested resolutions - yarn format with wildcard prefix", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
      },
      resolutions: {
        "**/bytes": "2.0.0", // global with wildcard
        "express/bytes": "1.0.0", // nested override
      },
    }),
  );
  install(tmp, ["install"]);

  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("nested resolutions - yarn format with scoped packages", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {},
      resolutions: {
        lodash: "4.17.0", // global
        "@babel/core/lodash": "4.17.21", // nested for scoped package
      },
    }),
  );
  install(tmp, ["install", "@babel/core@7.20.0"]);

  // @babel/core depends on lodash, should get the nested version
  expect(versionOf(tmp, "node_modules/lodash/package.json")).toBe("4.17.21");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("nested overrides with multiple parents", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
        "body-parser": "1.20.1",
      },
      overrides: {
        express: {
          bytes: "1.0.0",
        },
        "body-parser": {
          bytes: "2.0.0",
        },
      },
    }),
  );
  install(tmp, ["install"]);

  // Both express and body-parser depend on bytes with different overrides
  // The actual version will depend on which parent is resolved first
  const bytesVersion = versionOf(tmp, "node_modules/bytes/package.json");
  expect(["1.0.0", "2.0.0"]).toContain(bytesVersion);

  ensureLockfileDoesntChangeOnBunI(tmp);
});
