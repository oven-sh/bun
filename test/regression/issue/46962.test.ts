import { file, spawn } from "bun";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/46962
// `bun add -g .` before bun 1.4.4 wrote `"": "."` into the global package.json and into bun.lock
// (as the package `"": ["@root:", {}]`). A later bun must still read both files.
const posix = (path: string) => path.replaceAll("\\", "/");

function lockfileWithEmptyRow(otherPath: string, otherFolder: string) {
  return `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "dependencies": {
        "": ".",
        "other": "${otherPath}",
      },
    },
  },
  "packages": {
    "": ["@root:", {}],

    "other": ["other@file:${otherFolder}", { "bin": { "other": "./cli.js" } }],
  }
}
`;
}

const packages = {
  "other/package.json": JSON.stringify({ name: "other", version: "1.0.0", bin: { other: "./cli.js" } }),
  "other/cli.js": "#!/usr/bin/env node\n",
  "pkg/package.json": JSON.stringify({ name: "mypkg", version: "1.0.0" }),
  "pkg/index.js": "",
};

function globalEnv(home: string) {
  return {
    ...bunEnv,
    HOME: home,
    BUN_INSTALL: join(home, ".bun"),
    BUN_INSTALL_GLOBAL_DIR: join(home, ".bun", "install", "global"),
    BUN_INSTALL_BIN: join(home, ".bun", "bin"),
    BUN_INSTALL_CACHE_DIR: join(home, ".bun", "install", "cache"),
  };
}

async function run(cwd: string, env: Record<string, string | undefined>, ...args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), ...args], cwd, stdout: "pipe", stderr: "pipe", env });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("global commands skip the empty dependency name that bun 1.4.3 wrote", async () => {
  using dir = tempDir("global-empty-dep-name", packages);
  const home = String(dir);
  const otherPath = posix(join(home, "other"));
  const globalDir = join(home, ".bun", "install", "global");
  await Bun.write(
    join(globalDir, "package.json"),
    JSON.stringify({ dependencies: { "": ".", other: otherPath } }, null, 2),
  );
  await Bun.write(join(globalDir, "bun.lock"), lockfileWithEmptyRow(otherPath, "../../../other"));
  const env = globalEnv(home);

  {
    const { stdout, stderr, exitCode } = await run(home, env, "pm", "ls", "-g");
    expect(stderr).not.toContain("Lockfile is malformed");
    const lines = stdout.split("\n");
    expect(lines[0]).toEndWith(" node_modules (1 installed)");
    expect(lines.slice(1)).toEqual(["└── other@../../../other", ""]);
    expect(exitCode).toBe(0);
  }
  {
    const { stdout, stderr, exitCode } = await run(home, env, "add", "-g", "./pkg");
    expect(stderr).not.toContain("empty dependency name");
    expect(stderr).not.toContain("Lockfile is malformed");
    expect(stderr).toContain('skipping unnamed dependency ("." in "dependencies")');
    expect(stdout).toContain("\ninstalled mypkg@../../../pkg\n");
    expect(exitCode).toBe(0);
  }
  // The write drops the row from both files.
  expect((await file(join(globalDir, "package.json")).json()).dependencies).toEqual({
    mypkg: posix(join(home, "pkg")),
    other: otherPath,
  });
  expect(await file(join(globalDir, "bun.lock")).text()).not.toContain('"": ["@root:"');

  {
    const { stdout, stderr, exitCode } = await run(home, env, "remove", "-g", "other");
    expect(stderr).not.toContain("skipping unnamed dependency");
    expect(stderr).not.toContain("Lockfile is malformed");
    expect(stdout).toContain("\n- other\n1 package removed");
    expect(exitCode).toBe(0);
  }
  expect((await file(join(globalDir, "package.json")).json()).dependencies).toEqual({
    mypkg: posix(join(home, "pkg")),
  });
});

test.concurrent("bun remove -g of a name that is not declared keeps the linked folder", async () => {
  using dir = tempDir("global-empty-dep-name-remove", {
    ...packages,
    "linked/package.json": JSON.stringify({ name: "linked", version: "1.0.0" }),
  });
  const home = String(dir);
  const otherPath = posix(join(home, "other"));
  const globalDir = join(home, ".bun", "install", "global");
  await Bun.write(
    join(globalDir, "package.json"),
    JSON.stringify({ dependencies: { "": ".", other: otherPath } }, null, 2),
  );
  await Bun.write(join(globalDir, "bun.lock"), lockfileWithEmptyRow(otherPath, "../../../other"));
  // A `bun link` registration: a symlink in the global node_modules that no dependency declares.
  mkdirSync(join(globalDir, "node_modules"), { recursive: true });
  symlinkSync(join(home, "linked"), join(globalDir, "node_modules", "linked"), "junction");

  const { stderr, exitCode } = await run(home, globalEnv(home), "remove", "-g", "linked");
  expect(stderr).not.toContain("Lockfile is malformed");
  expect(exitCode).toBe(0);
  expect(existsSync(join(globalDir, "node_modules", "linked", "package.json"))).toBe(true);
  expect((await file(join(globalDir, "package.json")).json()).dependencies).toEqual({ other: otherPath });
});

test.concurrent("bun install reads a bun.lock with the empty dependency name that bun 1.4.3 wrote", async () => {
  using dir = tempDir("project-empty-dep-name", packages);
  const home = String(dir);
  const otherPath = posix(join(home, "other"));
  // The user already removed `"": "."` from package.json by hand. The lockfile still has the row.
  await Bun.write(join(home, "package.json"), JSON.stringify({ dependencies: { other: otherPath } }));
  await Bun.write(join(home, "bun.lock"), lockfileWithEmptyRow(otherPath, "other"));

  {
    // The lockfile row is skipped, so the lockfile has the dependencies that package.json has.
    const { stderr, exitCode } = await run(home, bunEnv, "install", "--frozen-lockfile");
    expect(stderr).not.toContain("Lockfile is malformed");
    expect(stderr).not.toContain("lockfile had changes");
    expect(stderr).toContain('skipping unnamed dependency ("." in "dependencies")');
    expect(exitCode).toBe(0);
  }
  {
    const { stderr, exitCode } = await run(home, bunEnv, "install");
    expect(stderr).not.toContain("Lockfile is malformed");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  }
  expect(await file(join(home, "bun.lock")).text()).not.toContain('"": ["@root:"');
});
