import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";

function install(cwd: string, args: string[]) {
  const exec = Bun.spawnSync({
    cmd: [bunExe(), ...args],
    cwd,
    stdout: "ignore",
    stdin: "ignore",
    stderr: "ignore",
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
    stdout: "ignore",
    stdin: "ignore",
    stderr: "ignore",
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
  const lockb_hash = new Bun.CryptoHasher("sha256").update(readFileSync(join(cwd, "bun.lockb"))).digest();
  install(cwd, ["install", "--frozen-lockfile"]);
  install(cwd, ["install", "--force"]);
  const lockb_hash2 = new Bun.CryptoHasher("sha256").update(readFileSync(join(cwd, "bun.lockb"))).digest();
  expect(lockb_hash).toEqual(lockb_hash2);
}

test("overrides affect your own packages", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "bun-pm-test"));
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
  const tmp = mkdtempSync(join(tmpdir(), "bun-pm-test"));
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
  const tmp = mkdtempSync(join(tmpdir(), "bun-pm-test"));
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
  const tmp = mkdtempSync(join(tmpdir(), "bun-pm-test"));
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

  // BUG: the npm specifier is hoisted https://github.com/oven-sh/bun/issues/6433
  // const bytes = JSON.parse(readFileSync(join(tmp, "node_modules/bytes/package.json"), "utf-8"));
  const bytes = JSON.parse(
    readFileSync(join(tmp, "node_modules/body-parser/node_modules/bytes/package.json"), "utf-8"),
  );

  expect(bytes.name).toBe("lodash");
  expect(bytes.version).toBe("4.0.0");

  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("changing overrides makes the lockfile changed, prevent frozen install", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "bun-pm-test"));
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
  const tmp = mkdtempSync(join(tmpdir(), "bun-pm-test"));
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
