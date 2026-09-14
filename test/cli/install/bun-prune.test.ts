import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, runBunInstall, tempDir, VerdaccioRegistry } from "harness";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

// CI exports BUN_INSTALL_CACHE_DIR, which overrides the harness bunfig's per-test `cache`; concurrent cases sharing one cache race on Windows.
const installEnv = (dir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });

const WARN = (expected: string, kept: string) =>
  `warn: ${expected} is not the version bun.lock expects; keeping ${kept}`;
const MISSING_WARN = (expected: string, kept: string) => `warn: ${expected} is missing; keeping ${kept}`;
const NOTE = "note: run 'bun install' first";
const OUT_OF_SYNC = "error: bun.lock does not match package.json, nothing to prune";
const OUT_OF_SYNC_NOTE = "note: run 'bun install' first";
const PRUNED_NOTE = 'note: skipped 1 workspace listed in bun.lock but not on disk: "other"';
const BANNER = "bun prune <version> (<revision>)";
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const NOTHING = (packages: number, folders: number) =>
  `Done! Checked ${plural(packages, "installed package")} across ${plural(folders, "folder")} (nothing to prune)`;
const REMOVED = (n: number, checked: number) =>
  `${plural(n, "package")} removed (checked ${plural(checked, "installed package")})`;
const CAN_BE_REMOVED = (n: number, checked: number) =>
  `${plural(n, "package")} can be removed (checked ${plural(checked, "installed package")})`;
// The copy-pasteable line `--dry-run` prints last: the invocation with `--dry-run` taken out.
const APPLY_HINT = (...flags: string[]) => ["  bun prune", ...flags].join(" ");
const DURATION = /\) \[\d+(\.\d+)?m?s\]$/m;
const linkers: Linker[] = ["hoisted", "isolated"];

async function prune(where: string | { dir: string; cwd: string }, ...args: string[]) {
  const { dir, cwd } = typeof where === "string" ? { dir: where, cwd: where } : where;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "prune", ...args],
    env: installEnv(dir),
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// stdout and stderr share one file so the test sees the order a terminal would.
async function pruneMerged(dir: string, ...args: string[]) {
  const log = join(dir, "prune-merged.log");
  const fd = openSync(log, "w");
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "prune", ...args],
      env: installEnv(dir),
      cwd: dir,
      stdout: fd,
      stderr: fd,
    });
    const exitCode = await proc.exited;
    return { lines: out(readFileSync(log, "utf8")).split("\n"), exitCode };
  } finally {
    closeSync(fd);
  }
}

function out(stdout: string) {
  return normalizeBunSnapshot(stdout).replaceAll("\\", "/");
}

function lines(stdout: string) {
  return out(stdout).split("\n");
}

function plant(dir: string, rel: string) {
  const abs = join(dir, rel);
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, "package.json"), JSON.stringify({ name: basename(rel) }));
  return abs;
}

function lock(dir: string) {
  return file(join(dir, "bun.lock")).text();
}

function isSymlink(path: string) {
  return lstatSync(path).isSymbolicLink();
}

// On Windows a bin is a `<name>.exe` + `<name>.bunx` shim pair instead of a symlink.
function binFiles(nm: string, name: string) {
  const bin = join(nm, ".bin", name);
  return isWindows ? [`${bin}.exe`, `${bin}.bunx`] : [bin];
}

function expectBinInstalled(nm: string, name: string) {
  for (const path of binFiles(nm, name)) {
    expect(existsSync(path)).toBeTrue();
  }
}

function expectBinRemoved(nm: string, name: string) {
  for (const path of binFiles(nm, name)) {
    expect(() => lstatSync(path)).toThrow();
  }
}

type BunfigOpts = NonNullable<Parameters<VerdaccioRegistry["createTestDir"]>[0]>["bunfigOpts"];

async function setup(pkgJson: Record<string, unknown>, bunfigOpts?: BunfigOpts) {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts });
  await write(packageJson, JSON.stringify(pkgJson));
  await runBunInstall(installEnv(packageDir), packageDir);
  return packageDir;
}

async function install(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    env: installEnv(dir),
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return stdout;
}

type Linker = "hoisted" | "isolated";

async function setupWithLinker(linker: Linker, pkgJson: Record<string, unknown>, bunfigOpts?: BunfigOpts) {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker, ...bunfigOpts } });
  await write(packageJson, JSON.stringify(pkgJson));
  await install(packageDir, "--linker", linker);
  return packageDir;
}

type Workspaces = { root?: Record<string, unknown>; packages: Record<string, Record<string, unknown>> };

function writeWorkspaces(dir: string, packageJson: string, { root, packages }: Workspaces) {
  return Promise.all([
    write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"], ...root })),
    ...Object.entries(packages).map(([folder, pkg]) =>
      write(join(dir, "packages", folder, "package.json"), JSON.stringify({ name: folder, version: "1.0.0", ...pkg })),
    ),
  ]);
}

async function setupWorkspaces(linker: Linker, workspaces: Workspaces) {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
  await writeWorkspaces(packageDir, packageJson, workspaces);
  await install(packageDir, "--linker", linker);
  return packageDir;
}

function expectRefused({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof prune>>) {
  expect(normalizeBunSnapshot(stderr)).toBe(`${OUT_OF_SYNC}\n${OUT_OF_SYNC_NOTE}`);
  expect(out(stdout)).toBe(BANNER);
  expect(exitCode).toBe(1);
}

async function expectProductionInstallIsNoop(dir: string) {
  const { out: installOut } = await runBunInstall(installEnv(dir), dir, { production: true });
  expect(installOut).toContain("no changes");
}

function linkOutside(dir: string, rel: string, contents: Record<string, string> = {}) {
  const outside = join(dir, "outside", basename(rel));
  mkdirSync(outside, { recursive: true });
  for (const [name, text] of Object.entries(contents)) {
    writeFileSync(join(outside, name), text);
  }
  const link = join(dir, rel);
  mkdirSync(join(link, ".."), { recursive: true });
  symlinkSync(outside, link, "junction");
  expect(isSymlink(link)).toBeTrue();
  return outside;
}

async function bun(where: string | { dir: string; cwd: string }, ...args: string[]) {
  const { dir, cwd } = typeof where === "string" ? { dir: where, cwd: where } : where;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: installEnv(dir),
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Every global-dir variable is set so an inherited one can never point a test at the developer's real global folder.
const globalEnv = (dir: string, bunInstallDir: string) => ({
  ...installEnv(dir),
  BUN_INSTALL: bunInstallDir,
  BUN_INSTALL_GLOBAL_DIR: join(bunInstallDir, "install", "global"),
  BUN_INSTALL_BIN: join(bunInstallDir, "bin"),
});

async function run(env: NodeJS.Dict<string>, cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function gitDependency(dir: string, name: string) {
  const repo = join(dir, "repos", name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  for (const args of [
    ["init", "-q"],
    ["add", "package.json"],
    ["commit", "-q", "-m", "init", "--no-gpg-sign"],
  ]) {
    await using proc = Bun.spawn({ cmd: ["git", ...args], cwd: repo, env: gitEnv, stdout: "ignore", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("fatal:");
    expect(exitCode).toBe(0);
  }
  return `git+${pathToFileURL(repo)}`;
}

function copyTarball(dir: string, name: string, version: string) {
  const file = `${name}-${version}.tgz`;
  copyFileSync(join(registry.packagesPath, name, file), join(dir, file));
  return `file:./${file}`;
}

const storeEntries = (dir: string) =>
  readdirSync(join(dir, "node_modules", ".bun"))
    .filter(name => name !== "node_modules")
    .toSorted();

test.concurrent("removes extraneous packages, keeps everything the lockfile installs", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" },
  });
  const nm = join(dir, "node_modules");
  const planted = [
    plant(dir, "node_modules/junk"),
    plant(dir, "node_modules/@scoped/junk"),
    plant(dir, "node_modules/@other/thing"),
  ];
  writeFileSync(join(nm, "README.txt"), "");
  plant(dir, "node_modules/.cache/x");
  const lockBefore = await lock(dir);

  const first = await prune(dir);
  expect(out(first.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @other/thing
    - @scoped/junk
    - junk
    3 packages removed (checked 5 installed packages)"
  `);
  expect(first.stdout).toMatch(/\(checked 5 installed packages\) \[\d+(\.\d+)?m?s\]\n?$/);
  expect(first.exitCode).toBe(0);

  for (const path of planted) {
    expect(existsSync(path)).toBeFalse();
  }
  expect(existsSync(join(nm, "@other"))).toBeFalse();
  expect(existsSync(join(nm, "no-deps"))).toBeTrue();
  expect(existsSync(join(nm, "@scoped", "has-bin-entry"))).toBeTrue();
  expect(existsSync(join(nm, "README.txt"))).toBeTrue();
  expect(existsSync(join(nm, ".cache", "x"))).toBeTrue();
  expectBinInstalled(nm, "has-bin-entry");
  expect(await lock(dir)).toBe(lockBefore);

  const second = await prune(dir);
  expect(out(second.stdout)).toEndWith(NOTHING(2, 1));
  expect(second.stdout).toMatch(/\(nothing to prune\) \[\d+(\.\d+)?m?s\]\n?$/);
  expect(second.exitCode).toBe(0);
});

test.concurrent("prunes nested node_modules folders the tree installs into", async () => {
  const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } });
  const nested = join(dir, "node_modules", "one-dep", "node_modules", "no-deps");
  expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.1" });
  const junk = plant(dir, "node_modules/one-dep/node_modules/junk");

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/one-dep/node_modules)
    1 package removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(join(nested, "package.json"))).toBeTrue();
});

test.concurrent.each([["--production"], ["--prod"], ["--omit=dev"]])(
  "%s removes packages only reachable through devDependencies",
  async (...flags: string[]) => {
    const dir = await setup({
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" },
      devDependencies: { "one-fixed-dep-bins": "1.0.0", "what-bin": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    expect(existsSync(join(nm, "no-deps-bins"))).toBeTrue();
    expectBinInstalled(nm, "what-bin");
    expectBinInstalled(nm, "has-bin-entry");
    const lockBefore = await lock(dir);

    const { stdout, exitCode } = await prune(dir, ...flags);
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps-bins@1.0.0
      - one-fixed-dep-bins@1.0.0
      - what-bin@1.0.0
      3 packages removed (checked 5 installed packages)"
    `);
    expect(exitCode).toBe(0);

    expect(existsSync(join(nm, "no-deps"))).toBeTrue();
    expect(existsSync(join(nm, "@scoped", "has-bin-entry"))).toBeTrue();
    expect(existsSync(join(nm, "no-deps-bins"))).toBeFalse();
    expect(existsSync(join(nm, "one-fixed-dep-bins"))).toBeFalse();
    expect(existsSync(join(nm, "what-bin"))).toBeFalse();
    // pnpm#2326: bins of removed packages are cleaned up, on Windows too (shim files instead of links).
    expectBinRemoved(nm, "what-bin");
    expectBinInstalled(nm, "has-bin-entry");

    await expectProductionInstallIsNoop(dir);
    expect(await lock(dir)).toBe(lockBefore);
  },
);

test.concurrent("--production keeps a package that prod and dev both need", async () => {
  const pkg = {
    name: "foo",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "one-fixed-dep": "1.0.0" },
  };
  const [dir, plainDir] = await Promise.all([setup(pkg), setup(pkg)]);

  const production = await prune(dir, "--production");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - one-fixed-dep@1.0.0
    1 package removed (checked 2 installed packages)"
  `);
  expect(production.exitCode).toBe(0);
  expect(existsSync(join(dir, "node_modules", "no-deps"))).toBeTrue();
  expect(existsSync(join(dir, "node_modules", "one-fixed-dep"))).toBeFalse();

  const plain = await prune(plainDir);
  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 2 installed packages across 1 folder (nothing to prune)"
  `);
  expect(plain.exitCode).toBe(0);
  expect(existsSync(join(plainDir, "node_modules", "one-fixed-dep"))).toBeTrue();
});

test.concurrent("--dry-run prints without deleting; --silent deletes without printing", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const junk = plant(dir, "node_modules/junk");

  const dryRun = await prune(dir, "--dry-run");
  expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package can be removed (checked 2 installed packages)
      bun prune"
  `);
  expect(dryRun.stdout).toMatch(DURATION);
  expect(dryRun.stderr).toBe("");
  expect(dryRun.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const withFlags = await prune(dir, "--dry-run", "--linker", "hoisted", "--dry-run");
  expect(lines(withFlags.stdout)).toStrictEqual([
    BANNER,
    "",
    "- junk",
    CAN_BE_REMOVED(1, 2),
    APPLY_HINT("--linker", "hoisted"),
  ]);
  expect(withFlags.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const silentDryRun = await prune(dir, "--dry-run", "--silent");
  expect(silentDryRun.stdout).toBe("");
  expect(silentDryRun.stderr).toBe("");
  expect(silentDryRun.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();

  const clean = await prune(dir, "--dry-run");
  expect(lines(clean.stdout)).toStrictEqual([BANNER, "", NOTHING(1, 1)]);
  expect(clean.exitCode).toBe(0);
});

test.concurrent("nothing to prune when node_modules is missing or clean", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  await install(packageDir, "--lockfile-only");
  const nm = join(packageDir, "node_modules");
  rmSync(nm, { recursive: true, force: true });
  expect(existsSync(join(packageDir, "bun.lock"))).toBeTrue();

  const missing = await prune(packageDir);
  expect(out(missing.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! No node_modules folder (nothing to prune)"
  `);
  expect(missing.exitCode).toBe(0);
  expect(existsSync(nm)).toBeFalse();

  const cleanDir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const clean = await prune(cleanDir, "--production");
  expect(out(clean.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 1 installed package across 1 folder (nothing to prune)"
  `);
  expect(clean.exitCode).toBe(0);
  expect(existsSync(join(cleanDir, "node_modules", "no-deps"))).toBeTrue();
});

test.concurrent("never follows symlinks out of node_modules", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const nm = join(dir, "node_modules");
  const outside = join(dir, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep");
  const link = join(nm, "linked-junk");
  symlinkSync(outside, link, "junction");
  expect(isSymlink(link)).toBeTrue();

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - linked-junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(() => lstatSync(link)).toThrow();
  expect(existsSync(join(outside, "keep.txt"))).toBeTrue();
  expect(existsSync(join(nm, "no-deps"))).toBeTrue();
});

test.concurrent("refuses to run without a lockfile", async () => {
  const [{ packageDir: noLockDir, packageJson }, installedDir] = await Promise.all([
    registry.createTestDir(),
    setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } }),
  ]);
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  const junk = plant(noLockDir, "node_modules/junk");

  const noLock = await prune(noLockDir);
  expect(normalizeBunSnapshot(noLock.stderr)).toMatchInlineSnapshot(`
    "error: missing lockfile, nothing to prune
    note: run 'bun install' first"
  `);
  expect(out(noLock.stdout)).toBe(BANNER);
  expect(noLock.exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();

  const silentNoLock = await prune(noLockDir, "--silent");
  expect(silentNoLock.stdout).toBe("");
  expect(silentNoLock.stderr).toBe("");
  expect(silentNoLock.exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();

  // Usage errors are the one class --silent does not suppress.
  for (const args of [["foo"], ["foo", "--silent"]]) {
    const positional = await prune(installedDir, ...args);
    expect(normalizeBunSnapshot(positional.stderr)).toMatchInlineSnapshot(`
      "error: bun prune does not take arguments, it always prunes the whole node_modules
      note: run 'bun prune --help' for more information"
    `);
    expect(positional.stdout).toBe("");
    expect(positional.exitCode).toBe(1);
  }
  expect(existsSync(join(installedDir, "node_modules", "no-deps"))).toBeTrue();

  const help = await prune(noLockDir, "--help");
  expect(help.stdout).toContain("bun prune");
  expect(help.stdout).toContain("--production");
  expect(help.stdout).toContain("--linker");
  expect(help.stdout).toContain("--filter");
  expect(help.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();
});

// pnpm#9796: hoisted keeps the root's workspace links under --production because they are root->workspace prod edges; the isolated per-importer dev link case is below.
test.concurrent("workspaces: prunes workspace folders, keeps workspace links, runs from the root", async () => {
  const { packageDir: dir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "2.0.0" } }),
    ),
    write(
      join(dir, "packages", "a", "package.json"),
      JSON.stringify({
        name: "a",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1" },
      }),
    ),
  ]);
  await runBunInstall(installEnv(dir), dir);
  const nm = join(dir, "node_modules");
  const workspaceNoDeps = join(dir, "packages", "a", "node_modules", "no-deps");
  expect(isSymlink(join(nm, "a"))).toBeTrue();
  expect(existsSync(workspaceNoDeps)).toBeTrue();
  expect(existsSync(join(nm, "a-dep"))).toBeTrue();
  const junk = plant(dir, "packages/a/node_modules/junk");

  const { stdout, exitCode } = await prune(join(dir, "packages", "a"), "--production");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    - junk (node_modules/a/node_modules)
    2 packages removed (checked 5 installed packages)"
  `);
  expect(exitCode).toBe(0);

  expect(isSymlink(join(nm, "a"))).toBeTrue();
  expect(existsSync(workspaceNoDeps)).toBeTrue();
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(join(nm, "a-dep"))).toBeFalse();
});

// https://github.com/oven-sh/bun/issues/40393: each spec resolves to the sibling workspace;
// reloading bun.lock and reparsing package.json must yield the same edge, or bun prune refuses.
// An alias installs a third link, node_modules/aliased.
test.concurrent.each([
  {
    spec: "* on a versionless workspace",
    app1: { dependencies: { package1: "*" } },
    pkg1: {},
    checked: 2,
  },
  {
    spec: "* on a prerelease workspace",
    app1: { dependencies: { package1: "*" } },
    pkg1: { version: "1.0.0-alpha" },
    checked: 2,
  },
  {
    spec: "npm:@* on a versionless workspace",
    app1: { dependencies: { aliased: "npm:package1@*" } },
    pkg1: {},
    checked: 3,
  },
  {
    spec: "catalog: on a workspace",
    app1: { dependencies: { package1: "catalog:" } },
    pkg1: { version: "1.0.0" },
    checked: 2,
  },
  {
    spec: "workspace: alias of a workspace",
    app1: { dependencies: { aliased: "workspace:package1@*" } },
    pkg1: {},
    checked: 3,
  },
  {
    spec: "workspace:* in dev and ^1 in peer",
    app1: { devDependencies: { package1: "workspace:*" }, peerDependencies: { package1: "^1.0.0" } },
    pkg1: { version: "1.0.0" },
    checked: 2,
  },
])("workspaces: $spec is in sync", async ({ app1, pkg1, checked }) => {
  const { packageDir: dir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({ name: "root", workspaces: { packages: ["app1", "package1"], catalog: { package1: "^1.0.0" } } }),
    ),
    write(join(dir, "app1", "package.json"), JSON.stringify({ name: "app1", ...app1 })),
    write(join(dir, "package1", "package.json"), JSON.stringify({ name: "package1", ...pkg1 })),
  ]);
  await runBunInstall(installEnv(dir), dir);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toBe(`${BANNER}\n\n${NOTHING(checked, 1)}`);
  expect(exitCode).toBe(0);
});

// The link is to a path: relocating the workspace changes the edge until bun install rewrites bun.lock.
test.concurrent("workspaces: * on a relocated versionless workspace is out of sync", async () => {
  const { packageDir: dir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "root", workspaces: ["app1", "package1"] })),
    write(join(dir, "app1", "package.json"), JSON.stringify({ name: "app1", dependencies: { package1: "*" } })),
    write(join(dir, "package1", "package.json"), JSON.stringify({ name: "package1" })),
  ]);
  await runBunInstall(installEnv(dir), dir);

  renameSync(join(dir, "package1"), join(dir, "moved"));
  await write(packageJson, JSON.stringify({ name: "root", workspaces: ["app1", "moved"] }));
  expectRefused(await prune(dir));

  await runBunInstall(installEnv(dir), dir);
  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toBe(`${BANNER}\n\n${NOTHING(2, 1)}`);
  expect(exitCode).toBe(0);
});

test.concurrent("keeps dependencies bundled inside a package", async () => {
  const dir = await setup({ name: "foo", dependencies: { "bundled-transitive": "1.0.0" } });
  const bundled = join(dir, "node_modules", "bundled-transitive", "node_modules", "no-deps", "package.json");
  expect(existsSync(bundled)).toBeTrue();

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 3 installed packages across 1 folder (nothing to prune)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(bundled)).toBeTrue();
});

// pnpm#881: --production also removes dev-only entries from the store.
test.concurrent("isolated linker: removes unused store entries and their links", async () => {
  const dir = await setup(
    { name: "foo", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } },
    { linker: "isolated" },
  );
  const nm = join(dir, "node_modules");
  const store = join(nm, ".bun");
  expect(existsSync(join(store, "one-dep@1.0.0"))).toBeTrue();
  expect(existsSync(join(store, "no-deps@1.0.1"))).toBeTrue();
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  expect(isSymlink(join(nm, "one-dep"))).toBeTrue();

  plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
  const peerVariant = plant(dir, "node_modules/.bun/no-deps@1.0.0+0123456789abcdef/node_modules/no-deps");
  const junkReal = plant(dir, "node_modules/junk-real");
  const hiddenHoist = join(store, "node_modules");
  mkdirSync(hiddenHoist, { recursive: true });
  const zzz = plant(dir, "node_modules/.bun/zzz@1.0.0/node_modules/zzz");
  symlinkSync(zzz, join(hiddenHoist, "zzz"), "junction");
  expect(isSymlink(join(hiddenHoist, "zzz"))).toBeTrue();
  const lockBefore = await lock(dir);

  const { stdout, exitCode } = await prune(dir, "--production");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk@1.0.0
    - junk-real
    - no-deps@1.0.0+0123456789abcdef
    - no-deps@1.0.1
    - one-dep@1.0.0
    - zzz@1.0.0
    6 packages removed (checked 9 installed packages)"
  `);
  expect(exitCode).toBe(0);

  expect(existsSync(join(store, "junk@1.0.0"))).toBeFalse();
  expect(existsSync(join(store, "zzz@1.0.0"))).toBeFalse();
  expect(existsSync(join(store, "no-deps@1.0.1"))).toBeFalse();
  expect(existsSync(join(store, "one-dep@1.0.0"))).toBeFalse();
  expect(existsSync(junkReal)).toBeFalse();
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  expect(existsSync(peerVariant)).toBeFalse();
  expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(existsSync(hiddenHoist)).toBeTrue();
  expect(() => lstatSync(join(hiddenHoist, "zzz"))).toThrow();
  expect(await lock(dir)).toBe(lockBefore);

  await expectProductionInstallIsNoop(dir);
});

test.concurrent("isolated linker: --verbose does not print the store build timings", async () => {
  const dir = await setup(
    { name: "foo", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } },
    { linker: "isolated" },
  );

  // `--production` makes prune build the store twice (once with every
  // dependency type, once with the production set); `bun install --verbose`
  // prints a timing line per store build, prune must print none.
  const { stdout, stderr, exitCode } = await prune(dir, "--production", "--verbose");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 5 installed packages)"
  `);
  expect(stderr).not.toContain("Resolved peers");
  expect(stderr).not.toContain("Created store");
  expect(exitCode).toBe(0);
});

test.concurrent("isolated linker: prune removes the peer-hash variants a peer bump left behind", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" },
  });
  const store = join(dir, "node_modules", ".bun");
  const peerEntries = () => storeEntries(dir).filter(entry => entry.startsWith("peer-deps-fixed@"));
  const [before] = peerEntries();
  expect(before).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);

  await write(
    join(dir, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.1" } }),
  );
  await install(dir, "--linker", "isolated");
  const variants = peerEntries();
  expect(variants).toHaveLength(2);
  expect(variants).toContain(before);
  const after = variants.find(entry => entry !== before)!;
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  expect(existsSync(join(store, "no-deps@1.0.1"))).toBeTrue();

  const { stdout, exitCode } = await prune(dir, "--linker", "isolated");
  expect(out(stdout).split("\n")).toStrictEqual([
    "bun prune <version> (<revision>)",
    "",
    "- no-deps@1.0.0",
    `- ${before}`,
    "2 packages removed (checked 6 installed packages)",
  ]);
  expect(exitCode).toBe(0);
  expect(peerEntries()).toStrictEqual([after]);
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeFalse();
  expect(existsSync(join(store, "no-deps@1.0.1"))).toBeTrue();
  expect(await install(dir, "--linker", "isolated")).toContain("no changes");
});

test.concurrent("isolated linker + global store: unlinks the store link, never deletes the shared entry", async () => {
  const dir = await setup(
    { name: "foo", devDependencies: { "one-dep": "1.0.0" } },
    { linker: "isolated", globalStore: true },
  );
  const storeEntry = join(dir, "node_modules", ".bun", "one-dep@1.0.0");
  expect(isSymlink(storeEntry)).toBeTrue();
  const linksDir = join(installEnv(dir).BUN_INSTALL_CACHE_DIR, "links");
  const globalEntry = readdirSync(linksDir).find(name => name.startsWith("one-dep@1.0.0-"));
  expect(globalEntry).toBeDefined();
  const globalPkgJson = join(linksDir, globalEntry!, "node_modules", "one-dep", "package.json");
  expect(existsSync(globalPkgJson)).toBeTrue();

  const { stdout, exitCode } = await prune(dir, "--production");
  expect(out(stdout)).toContain("- one-dep@1.0.0");
  expect(out(stdout)).toEndWith("2 packages removed (checked 3 installed packages)");
  expect(exitCode).toBe(0);

  expect(() => lstatSync(storeEntry)).toThrow();
  expect(lstatSync(join(linksDir, globalEntry!)).isDirectory()).toBeTrue();
  expect(await file(globalPkgJson).json()).toMatchObject({ name: "one-dep", version: "1.0.0" });
});

test.concurrent("isolated linker: bins of removed packages are removed, live ones kept", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { "@scoped/has-bin-entry": "1.0.0" },
    devDependencies: { "what-bin": "1.0.0" },
  });
  const nm = join(dir, "node_modules");
  expectBinInstalled(nm, "what-bin");
  expectBinInstalled(nm, "has-bin-entry");

  const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout)).toEndWith("- what-bin@1.0.0\n1 package removed (checked 4 installed packages)");
  expect(exitCode).toBe(0);

  expectBinRemoved(nm, "what-bin");
  expectBinInstalled(nm, "has-bin-entry");
});

test.concurrent("hoisted: dot entries and files are never touched even when the lockfile is empty", async () => {
  const { packageDir: dir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "empty" })),
    write(
      join(dir, "bun.lock"),
      `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "empty",
    },
  },
  "packages": {}
}
`,
    ),
  ]);
  const nm = join(dir, "node_modules");
  mkdirSync(nm);
  const junk = plant(dir, "node_modules/junk");
  const emptyStore = plant(dir, "node_modules/.bun/node_modules/whatever");
  const cache = plant(dir, "node_modules/.cache/whatever@1.0.0");
  const integrity = join(nm, ".yarn-integrity");
  writeFileSync(integrity, "");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 1 installed package)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(emptyStore)).toBeTrue();
  expect(existsSync(cache)).toBeTrue();
  expect(existsSync(integrity)).toBeTrue();
});

// The links into node_modules/.bun say how the tree was installed; a contradicting --linker does not make
// the hoisted planner report the store as checked without looking at it.
test.concurrent("--linker hoisted on an isolated install prunes it as isolated", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const nm = join(dir, "node_modules");
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0"]);

  for (const flags of [
    ["--linker", "hoisted"],
    ["--linker", "hoisted", "--dry-run"],
    ["--linker", "hoisted", "--production"],
  ]) {
    const { stdout, stderr, exitCode } = await prune(dir, ...flags);
    expect(stderr).toBe("");
    expect(lines(stdout)).toStrictEqual([BANNER, "", NOTHING(2, 2)]);
    expect(exitCode).toBe(0);
  }
  const silent = await prune(dir, "--linker", "hoisted", "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(0);
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0"]);
  expect(isSymlink(join(nm, "no-deps"))).toBeTrue();
});

test.concurrent(
  "hoisted: a nested tree owned by a package that was replaced with a symlink is not walked",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } });
    const nm = join(dir, "node_modules");
    expect(existsSync(join(nm, "one-dep", "node_modules", "no-deps"))).toBeTrue();
    rmSync(join(nm, "one-dep"), { recursive: true });
    const outside = linkOutside(dir, "node_modules/one-dep", {
      "package.json": JSON.stringify({ name: "one-dep", version: "1.0.0" }),
    });
    plant(outside, "node_modules/no-deps");
    const keepMe = plant(outside, "node_modules/keep-me");

    const { stdout, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 2 installed packages across 1 folder (nothing to prune)"
  `);
    expect(exitCode).toBe(0);
    expect(existsSync(keepMe)).toBeTrue();
    expect(isSymlink(join(nm, "one-dep"))).toBeTrue();
  },
);

test.concurrent("hoisted: a symlinked scope dir is unlinked, not followed", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const nm = join(dir, "node_modules");
  const outside = linkOutside(dir, "node_modules/@fake");
  const inner = plant(outside, "thing");
  plant(dir, "node_modules/@real/junk");

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @fake
    - @real/junk
    2 packages removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(() => lstatSync(join(nm, "@fake"))).toThrow();
  expect(existsSync(inner)).toBeTrue();
  expect(existsSync(join(nm, "@real"))).toBeFalse();
});

test.concurrent(
  "hoisted: a workspace's nested folder is pruned where bun.lock says the workspace is, not through node_modules/<name>",
  async () => {
    const dir = await setupWorkspaces("hoisted", {
      root: { dependencies: { "no-deps": "2.0.0" } },
      packages: { a: { dependencies: { "no-deps": "1.0.0" } } },
    });
    const link = join(dir, "node_modules", "a");
    const workspaceNoDeps = join(dir, "packages", "a", "node_modules", "no-deps", "package.json");
    expect(isSymlink(link)).toBeTrue();
    expect(existsSync(workspaceNoDeps)).toBeTrue();
    const junk = plant(dir, "packages/a/node_modules/junk");

    // `bun link a` run from another checkout leaves node_modules/a pointing at that checkout, which has a node_modules of its own.
    rmSync(link);
    const other = linkOutside(dir, "node_modules/a", {
      "package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    });
    const victim = plant(other, "node_modules/victim");
    const otherNoDeps = plant(other, "node_modules/no-deps");

    const dryRun = await prune(dir, "--dry-run", "--linker", "hoisted");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/a/node_modules)
      1 package can be removed (checked 4 installed packages)
        bun prune --linker hoisted"
    `);
    expect(dryRun.exitCode).toBe(0);

    // bun.lock records workspace folders relative to the root; prune chdirs there first, so running it from inside a workspace resolves them the same way.
    const { stdout, exitCode } = await prune({ dir, cwd: join(dir, "packages", "a") }, "--linker", "hoisted");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/a/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();
    expect(existsSync(workspaceNoDeps)).toBeTrue();
    expect(existsSync(join(victim, "package.json"))).toBeTrue();
    expect(existsSync(join(otherNoDeps, "package.json"))).toBeTrue();
    expect(isSymlink(link)).toBeTrue();
  },
);

test.concurrent.skipIf(isWindows)("a symlinked .bin directory is never cleaned through", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const nm = join(dir, "node_modules");
  expect(existsSync(join(nm, ".bin"))).toBeFalse();
  const outsideBins = linkOutside(dir, "node_modules/.bin");
  const dangling = join(outsideBins, "dangling");
  symlinkSync("./does-not-exist", dangling);
  const junk = plant(dir, "node_modules/junk");

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(isSymlink(dangling)).toBeTrue();
  expect(isSymlink(join(nm, ".bin"))).toBeTrue();
});

test.concurrent("isolated: extraneous symlinks are removed even when the store is clean", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const nm = join(dir, "node_modules");
  const outside = linkOutside(dir, "node_modules/ext", { "keep.txt": "keep" });
  const scopedOutside = linkOutside(dir, "node_modules/@ext/thing", { "keep.txt": "keep" });

  const first = await prune(dir, "--linker", "isolated");
  expect(out(first.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @ext/thing
    - ext
    2 packages removed (checked 4 installed packages)"
  `);
  expect(first.exitCode).toBe(0);
  expect(() => lstatSync(join(nm, "ext"))).toThrow();
  expect(existsSync(join(nm, "@ext"))).toBeFalse();
  expect(existsSync(join(outside, "keep.txt"))).toBeTrue();
  expect(existsSync(join(scopedOutside, "keep.txt"))).toBeTrue();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();

  const second = await prune(dir, "--linker", "isolated");
  expect(out(second.stdout)).toEndWith(NOTHING(2, 2));
  expect(second.exitCode).toBe(0);
});

test.concurrent(
  "hoisted: lockfile shrinks -> removed packages, their nested deps, scope dir and bin links go away",
  async () => {
    const dir = await setup({
      name: "foo",
      dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "@scoped/has-bin-entry": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    expect(existsSync(join(nm, "one-dep", "node_modules", "no-deps"))).toBeTrue();
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "2.0.0" } }));
    await install(dir, "--lockfile-only");
    expect(existsSync(join(nm, "one-dep"))).toBeTrue();
    expect(existsSync(join(nm, "@scoped", "has-bin-entry"))).toBeTrue();

    const { stdout, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    - one-dep@1.0.0
    2 packages removed (checked 3 installed packages)"
  `);
    expect(exitCode).toBe(0);
    expect(existsSync(join(nm, "one-dep"))).toBeFalse();
    expect(existsSync(join(nm, "@scoped"))).toBeFalse();
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
    expectBinRemoved(nm, "has-bin-entry");
    const { out: installOut } = await runBunInstall(installEnv(dir), dir, { savesLockfile: false });
    expect(installOut).toContain("no changes");
  },
);

test.concurrent("hoisted: removing only a scoped package also removes its bin link", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "@scoped/has-bin-entry": "1.0.0" },
  });
  const nm = join(dir, "node_modules");
  expectBinInstalled(nm, "has-bin-entry");

  const { stdout, exitCode } = await prune(dir, "--production");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    1 package removed (checked 2 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(join(nm, "@scoped"))).toBeFalse();
  expectBinRemoved(nm, "has-bin-entry");
});

test.concurrent(
  "isolated: lockfile shrinks -> store entries, alias links and the emptied scope dir go away",
  async () => {
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "@scoped/has-bin-entry": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    const store = join(nm, ".bun");
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "2.0.0" } }));
    await install(dir, "--lockfile-only", "--linker", "isolated");
    expect(isSymlink(join(nm, "one-dep"))).toBeTrue();
    expect(isSymlink(join(nm, "@scoped", "has-bin-entry"))).toBeTrue();

    const { stdout, exitCode } = await prune(dir, "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    - no-deps@1.0.1
    - one-dep@1.0.0
    3 packages removed (checked 7 installed packages)"
  `);
    expect(exitCode).toBe(0);
    expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
    expect(existsSync(join(nm, "@scoped"))).toBeFalse();
    expect(existsSync(join(store, "no-deps@2.0.0"))).toBeTrue();
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
    expectBinRemoved(nm, "has-bin-entry");
  },
);

test.concurrent("hoisted: --production empties a workspace folder that only held nested devDependencies", async () => {
  const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "2.0.0" } }),
    ),
    write(
      join(dir, "packages", "a", "package.json"),
      JSON.stringify({ name: "a", version: "1.0.0", devDependencies: { "no-deps": "1.0.0" } }),
    ),
  ]);
  await install(dir, "--linker", "hoisted");
  const nm = join(dir, "node_modules");
  const nested = join(dir, "packages", "a", "node_modules", "no-deps");
  expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.0" });

  const { stdout, exitCode } = await prune(dir, "--production", "--linker", "hoisted");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.0 (packages/a/node_modules)
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(nested)).toBeFalse();
  expect(isSymlink(join(nm, "a"))).toBeTrue();
  expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
  await expectProductionInstallIsNoop(dir);
});

const appLinksTool = {
  packages: {
    app: {
      dependencies: { lib: "workspace:*", "no-deps": "1.0.0" },
      devDependencies: { tool: "workspace:*", "a-dep": "1.0.1" },
    },
    lib: {},
    tool: {},
  },
};

test.concurrent(
  "isolated + workspaces: --production removes a workspace's registry devDependency and its dev-only workspace link, keeps prod links",
  async () => {
    const dir = await setupWorkspaces("isolated", appLinksTool);
    const app = join(dir, "packages", "app");
    const appNm = join(app, "node_modules");
    expect(existsSync(join(dir, "node_modules", ".bun"))).toBeTrue();
    expect(isSymlink(join(appNm, "a-dep"))).toBeTrue();
    expect(isSymlink(join(appNm, "tool"))).toBeTrue();

    const plain = await prune(dir, "--linker", "isolated");
    expect(out(plain.stdout)).toEndWith(NOTHING(6, 3));
    expect(plain.exitCode).toBe(0);

    const dryRun = await prune(dir, "--production", "--dry-run", "--linker", "isolated");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - tool@1.0.0 (packages/app/node_modules)
      2 packages can be removed (checked 6 installed packages)
        bun prune --production --linker isolated"
    `);
    expect(dryRun.exitCode).toBe(0);
    expect(isSymlink(join(appNm, "tool"))).toBeTrue();

    const { stdout, exitCode } = await prune({ dir, cwd: app }, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - tool@1.0.0 (packages/app/node_modules)
      2 packages removed (checked 6 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(() => lstatSync(join(appNm, "a-dep"))).toThrow();
    expect(() => lstatSync(join(appNm, "tool"))).toThrow();
    expect(existsSync(join(appNm, "no-deps", "package.json"))).toBeTrue();
    expect(existsSync(join(appNm, "lib", "package.json"))).toBeTrue();
    expect(existsSync(join(dir, "packages", "tool", "package.json"))).toBeTrue();

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(out(again.stdout)).toEndWith(NOTHING(3, 3));
    expect(again.exitCode).toBe(0);
    await expectProductionInstallIsNoop(dir);
    expect(() => lstatSync(join(appNm, "tool"))).toThrow();
  },
);

test.concurrent("isolated: a real directory named like a workspace is never deleted", async () => {
  const dir = await setupWorkspaces("isolated", appLinksTool);
  const appNm = join(dir, "packages", "app", "node_modules");
  rmSync(join(appNm, "tool"));
  const planted = plant(dir, "packages/app/node_modules/tool");

  const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package removed (checked 6 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(join(planted, "package.json"))).toBeTrue();
  expect(existsSync(join(appNm, "lib", "package.json"))).toBeTrue();
});

test.concurrent(
  "isolated: a scoped dev-only workspace link goes away with its emptied scope dir, the prod scoped link stays",
  async () => {
    const scoped = (app: Record<string, unknown>) => ({
      packages: {
        app: { dependencies: { "no-deps": "1.0.0" }, ...app },
        lib: { name: "@scope/lib" },
        tool: { name: "@scope/tool" },
      },
    });
    const [mixedDir, devOnlyDir] = await Promise.all([
      setupWorkspaces(
        "isolated",
        scoped({
          dependencies: { "@scope/lib": "workspace:*", "no-deps": "1.0.0" },
          devDependencies: { "@scope/tool": "workspace:*" },
        }),
      ),
      setupWorkspaces("isolated", scoped({ devDependencies: { "@scope/tool": "workspace:*" } })),
    ]);
    const mixedScope = join(mixedDir, "packages", "app", "node_modules", "@scope");
    const devOnlyScope = join(devOnlyDir, "packages", "app", "node_modules", "@scope");
    expect(isSymlink(join(mixedScope, "tool"))).toBeTrue();
    expect(isSymlink(join(devOnlyScope, "tool"))).toBeTrue();

    const mixed = await prune(mixedDir, "--production", "--linker", "isolated");
    expect(out(mixed.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(mixed.exitCode).toBe(0);
    expect(() => lstatSync(join(mixedScope, "tool"))).toThrow();
    expect(existsSync(join(mixedScope, "lib", "package.json"))).toBeTrue();
    expect(existsSync(join(mixedDir, "packages", "tool", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(mixedDir);

    const devOnly = await prune(devOnlyDir, "--production", "--linker", "isolated");
    expect(out(devOnly.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(devOnly.exitCode).toBe(0);
    expect(existsSync(devOnlyScope)).toBeFalse();
    expect(existsSync(join(devOnlyDir, "packages", "app", "node_modules", "no-deps", "package.json"))).toBeTrue();
    expect(existsSync(join(devOnlyDir, "packages", "tool", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(devOnlyDir);
  },
);

test.concurrent(
  "isolated: a workspace that is dev-only for one workspace and a prod dependency of another loses only the dev link",
  async () => {
    const dir = await setupWorkspaces("isolated", {
      packages: {
        app: { devDependencies: { tool: "workspace:*" } },
        b: { dependencies: { tool: "workspace:*", "no-deps": "1.0.0" } },
        tool: {},
      },
    });
    const appTool = join(dir, "packages", "app", "node_modules", "tool");
    const bTool = join(dir, "packages", "b", "node_modules", "tool");
    expect(isSymlink(appTool)).toBeTrue();
    expect(isSymlink(bTool)).toBeTrue();

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(() => lstatSync(appTool)).toThrow();
    expect(await file(join(bTool, "package.json")).json()).toMatchObject({ name: "tool" });
    await expectProductionInstallIsNoop(dir);
    expect(() => lstatSync(appTool)).toThrow();
    expect(isSymlink(bTool)).toBeTrue();
  },
);

test.concurrent.each(linkers)(
  "%s: a workspace's own dependencies survive --production even when the root lists the workspace under devDependencies",
  async linker => {
    const dir = await setupWorkspaces(linker, {
      root: { devDependencies: { tool: "workspace:*" } },
      packages: {
        app: { devDependencies: { tool: "workspace:*" } },
        tool: { dependencies: { "no-deps": "1.0.0" } },
      },
    });
    const appTool = join(dir, "packages", "app", "node_modules", "tool");
    const rootTool = join(dir, "node_modules", "tool");
    expect(isSymlink(rootTool)).toBeTrue();
    const toolNoDeps =
      linker === "hoisted"
        ? join(dir, "node_modules", "no-deps", "package.json")
        : join(dir, "packages", "tool", "node_modules", "no-deps", "package.json");
    expect(existsSync(toolNoDeps)).toBeTrue();

    const first = await prune(dir, "--production", "--linker", linker);
    if (linker === "hoisted") {
      expect(out(first.stdout)).toEndWith(NOTHING(3, 1));
      expect(isSymlink(rootTool)).toBeTrue();
    } else {
      expect(out(first.stdout)).toEndWith(`- tool@1.0.0 (packages/app/node_modules)\n${REMOVED(1, 4)}`);
      expect(() => lstatSync(appTool)).toThrow();
    }
    expect(first.exitCode).toBe(0);
    expect(existsSync(toolNoDeps)).toBeTrue();
    expect(existsSync(join(dir, "packages", "tool", "package.json"))).toBeTrue();

    const second = await prune(dir, "--production", "--linker", linker);
    expect(out(second.stdout)).toEndWith(linker === "hoisted" ? NOTHING(3, 1) : NOTHING(3, 4));
    expect(second.exitCode).toBe(0);
    await expectProductionInstallIsNoop(dir);
    expect(existsSync(toolNoDeps)).toBeTrue();
  },
);

test.concurrent.each(linkers)("%s: refuses when package.json changed since bun.lock was written", async linker => {
  const dir = await setupWithLinker(linker, { name: "foo", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" } });
  const junk = plant(dir, "node_modules/junk");
  const aDep = join(dir, "node_modules", "a-dep");
  await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  const lockBefore = await lock(dir);

  expectRefused(await prune(dir, "--linker", linker));
  expectRefused(await prune(dir, "--dry-run", "--linker", linker));
  expect(existsSync(junk)).toBeTrue();
  expect(existsSync(join(aDep, "package.json"))).toBeTrue();

  const silent = await prune(dir, "--silent", "--linker", linker);
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();
  expect(await lock(dir)).toBe(lockBefore);

  await install(dir, "--lockfile-only", "--linker", linker);
  const { stdout, stderr, exitCode } = await prune(dir, "--linker", linker);
  // The rows read the same under both linkers; only the store changes what was checked.
  expect(lines(stdout)).toStrictEqual([
    BANNER,
    "",
    "- a-dep@1.0.1",
    "- junk",
    REMOVED(2, linker === "hoisted" ? 3 : 5),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(() => lstatSync(aDep)).toThrow();
});

test.concurrent.each([
  ["a dependency is added", { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } }],
  ["a range changes but still matches the installed version", { dependencies: { "no-deps": "^1.0.0" } }],
  ["an override is added", { dependencies: { "no-deps": "1.0.0" }, overrides: { "no-deps": "1.0.0" } }],
] as const)("refuses when %s", async (_, edited) => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const junk = plant(dir, "node_modules/junk");
  const lockBefore = await lock(dir);
  await write(join(dir, "package.json"), JSON.stringify({ name: "foo", ...edited }));

  expectRefused(await prune(dir));
  expect(existsSync(junk)).toBeTrue();
  expect(await lock(dir)).toBe(lockBefore);
});

test.concurrent("refuses when a catalog entry changed", async () => {
  const catalogRoot = (version: string) => ({
    root: { workspaces: { packages: ["packages/*"], catalog: { "no-deps": version } } },
    packages: { a: { dependencies: { "no-deps": "catalog:" } } },
  });
  const dir = await setupWorkspaces("hoisted", catalogRoot("1.0.0"));
  const junk = plant(dir, "node_modules/junk");
  const lockBefore = await lock(dir);
  await writeWorkspaces(dir, join(dir, "package.json"), catalogRoot("1.0.1"));

  expectRefused(await prune(dir, "--linker", "hoisted"));
  expect(existsSync(junk)).toBeTrue();
  expect(await lock(dir)).toBe(lockBefore);
});

test.concurrent("refuses when a workspace's package.json changed, from any cwd and under --filter", async () => {
  const dir = await setupWorkspaces("hoisted", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: {
      a: { dependencies: { "no-deps": "1.0.0" } },
      b: { dependencies: { "a-dep": "1.0.1" } },
    },
  });
  const junk = plant(dir, "packages/a/node_modules/junk");
  const aDep = join(dir, "node_modules", "a-dep");
  expect(existsSync(aDep)).toBeTrue();
  await write(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "b", version: "1.0.0" }));

  expectRefused(await prune(dir, "--linker", "hoisted"));
  expectRefused(await prune({ dir, cwd: join(dir, "packages", "a") }, "--linker", "hoisted"));
  expectRefused(await prune(dir, "--filter", "a", "--linker", "hoisted"));
  expect(existsSync(junk)).toBeTrue();
  expect(existsSync(aDep)).toBeTrue();
});

test.concurrent.each(linkers)("%s: a workspace lifecycle script is not out of sync", async linker => {
  const dir = await setupWorkspaces(linker, {
    packages: { a: { dependencies: { "no-deps": "1.0.0" }, scripts: { postinstall: "echo ok" } } },
  });
  const junk = plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", linker);
  expect(stderr).not.toContain(OUT_OF_SYNC);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
});

test.concurrent("trustedDependencies stripped from bun.lock is not out of sync", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" }, trustedDependencies: ["no-deps"] });
  const before = await lock(dir);
  expect(before).toContain('"trustedDependencies"');
  const stripped = before.replace(/\n  "trustedDependencies": \[\n(?:    [^\n]*\n)*  \],/, "");
  expect(stripped).not.toContain('"trustedDependencies"');
  await write(join(dir, "bun.lock"), stripped);
  const junk = plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).not.toContain(OUT_OF_SYNC);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
});

const prunedCheckout = (app: Record<string, unknown>) => ({
  packages: {
    app: { dependencies: { "no-deps": "1.0.0", ...app } },
    other: { dependencies: { "left-pad": "1.0.0" } },
  },
});

test.concurrent("prunes a checkout whose bun.lock lists a workspace that is no longer on disk", async () => {
  const dir = await setupWorkspaces("hoisted", prunedCheckout({}));
  const nm = join(dir, "node_modules");
  rmSync(join(dir, "packages", "other"), { recursive: true });
  expect(isSymlink(join(nm, "other"))).toBeTrue();
  expect(existsSync(join(nm, "left-pad", "package.json"))).toBeTrue();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  const junk = plant(dir, "node_modules/junk");

  const { lines: merged, exitCode } = await pruneMerged(dir, "--linker", "hoisted");
  expect(merged).toStrictEqual([BANNER, "", PRUNED_NOTE, "- junk", "- left-pad@1.0.0", "- other", REMOVED(3, 5)]);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(join(nm, "left-pad"))).toBeFalse();
  expect(() => lstatSync(join(nm, "other"))).toThrow();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(isSymlink(join(nm, "app"))).toBeTrue();

  await install(dir, "--frozen-lockfile", "--linker", "hoisted");
  expect(existsSync(join(nm, "left-pad"))).toBeFalse();
  expect(() => lstatSync(join(nm, "other"))).toThrow();

  const second = await prune(dir, "--linker", "hoisted");
  expect(out(second.stdout)).toEndWith(NOTHING(2, 1));
  expect(second.exitCode).toBe(0);
});

test.concurrent("isolated: a workspace missing from disk no longer keeps its store entries", async () => {
  const dir = await setupWorkspaces("isolated", prunedCheckout({}));
  const store = join(dir, "node_modules", ".bun");
  const appNoDeps = join(dir, "packages", "app", "node_modules", "no-deps", "package.json");
  rmSync(join(dir, "packages", "other"), { recursive: true });
  expect(existsSync(join(store, "left-pad@1.0.0"))).toBeTrue();
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  const junk = plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "isolated");
  expect(stderr).toContain(PRUNED_NOTE);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    - left-pad@1.0.0
    2 packages removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(join(store, "left-pad@1.0.0"))).toBeFalse();
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  expect(existsSync(appNoDeps)).toBeTrue();

  await install(dir, "--frozen-lockfile", "--linker", "isolated");
  expect(existsSync(join(store, "left-pad@1.0.0"))).toBeFalse();
  expect(existsSync(appNoDeps)).toBeTrue();

  const second = await prune(dir, "--linker", "isolated");
  expect(out(second.stdout)).toEndWith(NOTHING(2, 3));
  expect(second.exitCode).toBe(0);
});

test.concurrent("hoisted: --filter on a pruned checkout does not protect the missing workspace", async () => {
  const dir = await setupWorkspaces("hoisted", prunedCheckout({}));
  const nm = join(dir, "node_modules");
  rmSync(join(dir, "packages", "other"), { recursive: true });

  const { stdout, stderr, exitCode } = await prune(dir, "--filter", "app", "--linker", "hoisted");
  expect(stderr).toContain(PRUNED_NOTE);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - left-pad@1.0.0
    - other
    2 packages removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(join(nm, "left-pad"))).toBeFalse();
  expect(() => lstatSync(join(nm, "other"))).toThrow();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(isSymlink(join(nm, "app"))).toBeTrue();
});

test.concurrent("a survivor depending on a missing workspace makes prune fail like install does", async () => {
  const dir = await setupWorkspaces("hoisted", prunedCheckout({ other: "workspace:*" }));
  rmSync(join(dir, "packages", "other"), { recursive: true });
  const junk = plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
  expect(stderr).toContain(
    'workspace "app" depends on workspace "other" (packages/other), which is listed in bun.lock but not on disk',
  );
  expect(out(stdout)).not.toMatch(/^- /m);
  expect(exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();
});

test.concurrent(
  "pin: hoisted --production keeps the workspace links a production install creates and removes a dev-only alias link",
  async () => {
    const dir = await setupWorkspaces("hoisted", {
      packages: {
        app: { devDependencies: { shared: "workspace:*", "shared-alias": "workspace:shared@*" } },
        shared: {},
      },
    });
    const nm = join(dir, "node_modules");
    expect(isSymlink(join(nm, "app"))).toBeTrue();
    expect(isSymlink(join(nm, "shared"))).toBeTrue();
    expect(isSymlink(join(nm, "shared-alias"))).toBeTrue();

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - shared-alias@1.0.0
      1 package removed (checked 3 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(isSymlink(join(nm, "app"))).toBeTrue();
    expect(isSymlink(join(nm, "shared"))).toBeTrue();
    expect(() => lstatSync(join(nm, "shared-alias"))).toThrow();
    await expectProductionInstallIsNoop(dir);

    const second = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(second.stdout)).toEndWith(NOTHING(2, 1));
    expect(second.exitCode).toBe(0);
  },
);

test.concurrent(
  "hoisted: --filter prunes only the selected workspaces, the root folder keeps what other workspaces use",
  async () => {
    const dir = await setupWorkspaces("hoisted", {
      root: { dependencies: { "no-deps": "2.0.0" }, devDependencies: { "left-pad": "1.0.0" } },
      packages: {
        a: { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } },
        b: { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-fixed-dep": "1.0.0" } },
      },
    });
    const nm = join(dir, "node_modules");
    const aJunk = plant(dir, "packages/a/node_modules/junk");
    const bJunk = plant(dir, "packages/b/node_modules/junk");
    const stillInstalled = () => {
      expect(isSymlink(join(nm, "a"))).toBeTrue();
      expect(isSymlink(join(nm, "b"))).toBeTrue();
      expect(existsSync(join(dir, "packages", "a", "node_modules", "no-deps", "package.json"))).toBeTrue();
      expect(existsSync(join(dir, "packages", "b", "node_modules", "no-deps", "package.json"))).toBeTrue();
    };

    const onlyA = await prune(dir, "--production", "--filter", "a", "--linker", "hoisted");
    expect(out(onlyA.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk (node_modules/a/node_modules)
      2 packages removed (checked 8 installed packages)"
    `);
    expect(onlyA.exitCode).toBe(0);
    expect(existsSync(aJunk)).toBeFalse();
    expect(existsSync(bJunk)).toBeTrue();
    expect(existsSync(join(nm, "left-pad"))).toBeTrue();
    expect(existsSync(join(nm, "one-fixed-dep"))).toBeTrue();
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
    stillInstalled();

    const onlyRoot = await prune(dir, "--production", "--filter", "root", "--linker", "hoisted");
    expect(out(onlyRoot.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - left-pad@1.0.0
      1 package removed (checked 5 installed packages)"
    `);
    expect(onlyRoot.exitCode).toBe(0);
    expect(existsSync(bJunk)).toBeTrue();
    expect(existsSync(join(nm, "one-fixed-dep"))).toBeTrue();

    const everything = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/b/node_modules)
      - one-fixed-dep@1.0.0
      2 packages removed (checked 7 installed packages)"
    `);
    expect(everything.exitCode).toBe(0);
    expect(existsSync(bJunk)).toBeFalse();
    stillInstalled();
    await expectProductionInstallIsNoop(dir);
  },
);

test.concurrent(
  "isolated: --filter keeps store entries other workspaces link to and drops the selected workspace's exclusive ones",
  async () => {
    const dir = await setupWorkspaces("isolated", {
      packages: {
        a: { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1", "one-fixed-dep": "1.0.0" } },
        b: { devDependencies: { "a-dep": "1.0.1", "left-pad": "1.0.0" } },
      },
    });
    const store = join(dir, "node_modules", ".bun");
    const aNm = join(dir, "packages", "a", "node_modules");
    const bNm = join(dir, "packages", "b", "node_modules");

    const onlyA = await prune(dir, "--production", "--filter", "a", "--linker", "isolated");
    expect(out(onlyA.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/a/node_modules)
      - one-fixed-dep@1.0.0
      2 packages removed (checked 7 installed packages)"
    `);
    expect(onlyA.exitCode).toBe(0);
    expect(existsSync(join(store, "a-dep@1.0.1"))).toBeTrue();
    expect(existsSync(join(store, "left-pad@1.0.0"))).toBeTrue();
    expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
    expect(existsSync(join(bNm, "a-dep", "package.json"))).toBeTrue();
    expect(existsSync(join(bNm, "left-pad", "package.json"))).toBeTrue();
    expect(() => lstatSync(join(aNm, "a-dep"))).toThrow();
    expect(() => lstatSync(join(aNm, "one-fixed-dep"))).toThrow();
    expect(existsSync(join(aNm, "no-deps", "package.json"))).toBeTrue();

    const everything = await prune(dir, "--production", "--linker", "isolated");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - left-pad@1.0.0
      2 packages removed (checked 6 installed packages)"
    `);
    expect(everything.exitCode).toBe(0);
    expect(() => lstatSync(join(bNm, "a-dep"))).toThrow();
    expect(() => lstatSync(join(bNm, "left-pad"))).toThrow();
    expect(existsSync(join(aNm, "no-deps", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(dir);
  },
);

test.concurrent(
  "isolated: --production --filter unlinks one workspace's dev deps at a time, the store entry waits for an unfiltered run",
  async () => {
    const pkg = { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } };
    const dir = await setupWorkspaces("isolated", { packages: { selected: pkg, unselected: pkg } });
    const storeEntry = join(dir, "node_modules", ".bun", "a-dep@1.0.1");
    const selectedADep = join(dir, "packages", "selected", "node_modules", "a-dep");
    const unselectedADep = join(dir, "packages", "unselected", "node_modules", "a-dep");

    const first = await prune(dir, "--production", "--filter", "selected", "--linker", "isolated");
    expect(out(first.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/selected/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(first.exitCode).toBe(0);
    expect(() => lstatSync(selectedADep)).toThrow();
    expect(existsSync(join(unselectedADep, "package.json"))).toBeTrue();
    expect(existsSync(storeEntry)).toBeTrue();

    const second = await prune(dir, "--production", "--filter", "unselected", "--linker", "isolated");
    expect(out(second.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/unselected/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(second.exitCode).toBe(0);
    expect(() => lstatSync(unselectedADep)).toThrow();
    expect(existsSync(storeEntry)).toBeTrue();

    const everything = await prune(dir, "--production", "--linker", "isolated");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      1 package removed (checked 4 installed packages)"
    `);
    expect(everything.exitCode).toBe(0);
    expect(existsSync(storeEntry)).toBeFalse();
    for (const ws of ["selected", "unselected"]) {
      expect(existsSync(join(dir, "packages", ws, "node_modules", "no-deps", "package.json"))).toBeTrue();
    }
    await expectProductionInstallIsNoop(dir);
  },
);

test.concurrent.each(linkers)(
  "%s: --filter limits extraneous entries to the selected workspaces' own folders; name, path and glob selectors",
  async linker => {
    const dir = await setupWorkspaces(linker, {
      root: { dependencies: { "no-deps": "2.0.0" } },
      packages: {
        app: { dependencies: { "no-deps": "1.0.0" } },
        lib: { dependencies: { "no-deps": "1.0.0" } },
      },
    });
    const rootJunk = plant(dir, "node_modules/root-junk");
    const appJunk = plant(dir, "packages/app/node_modules/app-junk");
    const libJunk = plant(dir, "packages/lib/node_modules/lib-junk");
    const storeJunk = linker === "isolated" ? plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk") : null;
    const shown = (ws: string, name: string) =>
      linker === "hoisted" ? `- ${name} (node_modules/${ws}/node_modules)` : `- ${name} (packages/${ws}/node_modules)`;
    // Rows are listed by package name, wherever the entry lives.
    const removed = (rows: string[], checked: number) => [BANNER, "", ...rows, REMOVED(rows.length, checked)];
    // The shared area is swept whole-repo under --filter: the isolated store, and under hoisted the root folder itself.
    const appRows = [shown("app", "app-junk"), linker === "hoisted" ? "- root-junk" : "- junk@1.0.0"];
    // hoisted: root folder (no-deps, app, lib, root-junk) + app folder; isolated: store (2 no-deps, junk) + app folder.
    const sharedAndApp = linker === "hoisted" ? 6 : 5;

    const dryRun = await prune(dir, "--filter", "app", "--dry-run", "--linker", linker);
    expect(lines(dryRun.stdout)).toStrictEqual([
      BANNER,
      "",
      ...appRows,
      CAN_BE_REMOVED(2, sharedAndApp),
      APPLY_HINT("--filter", "app", "--linker", linker),
    ]);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(0);
    expect(existsSync(appJunk)).toBeTrue();
    expect(existsSync(rootJunk)).toBeTrue();

    const byPath = await prune(dir, "--filter", "./packages/app", "--linker", linker);
    expect(lines(byPath.stdout)).toStrictEqual(removed(appRows, sharedAndApp));
    expect(byPath.exitCode).toBe(0);
    expect(existsSync(appJunk)).toBeFalse();
    expect(existsSync(libJunk)).toBeTrue();
    expect(existsSync(rootJunk)).toBe(linker === "isolated");
    if (storeJunk) {
      expect(existsSync(storeJunk)).toBeFalse();
    }

    const byGlob = await prune({ dir, cwd: join(dir, "packages", "app") }, "--filter", "li*", "--linker", linker);
    expect(lines(byGlob.stdout)).toStrictEqual(removed([shown("lib", "lib-junk")], linker === "hoisted" ? 5 : 4));
    expect(byGlob.exitCode).toBe(0);
    expect(existsSync(libJunk)).toBeFalse();

    if (linker === "isolated") {
      const root = await prune(dir, "--filter", "./", "--linker", linker);
      expect(lines(root.stdout)).toStrictEqual(removed(["- root-junk"], 4));
      expect(root.exitCode).toBe(0);
    }
    expect(existsSync(rootJunk)).toBeFalse();
    for (const ws of ["app", "lib"]) {
      expect(existsSync(join(dir, "packages", ws, "node_modules", "no-deps", "package.json"))).toBeTrue();
    }
  },
);

test.concurrent("hoisted: --filter with no match is an error; path filters resolve against the cwd", async () => {
  const dir = await setupWorkspaces("hoisted", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { dependencies: { "no-deps": "1.0.0" } } },
  });
  const junk = plant(dir, "packages/a/node_modules/junk");
  const listing = (...flags: string[]) => [
    BANNER,
    "",
    "- junk (node_modules/a/node_modules)",
    CAN_BE_REMOVED(1, 4),
    APPLY_HINT(...flags, "--linker", "hoisted"),
  ];

  const noMatch = await prune(dir, "--filter", "nope", "--linker", "hoisted");
  expect(normalizeBunSnapshot(noMatch.stderr)).toBe('error: No workspace packages matched the filter "nope"');
  expect(out(noMatch.stdout)).toBe(BANNER);
  expect(noMatch.exitCode).toBe(1);

  const noneMatch = await prune(dir, "--filter", "nope", "--filter", "nada", "--linker", "hoisted");
  expect(normalizeBunSnapshot(noneMatch.stderr)).toBe(
    'error: No workspace packages matched the filters "nope", "nada"',
  );
  expect(out(noneMatch.stdout)).toBe(BANNER);
  expect(noneMatch.exitCode).toBe(1);

  const silentNoMatch = await prune(dir, "--filter", "nope", "--silent", "--linker", "hoisted");
  expect(silentNoMatch.stdout).toBe("");
  expect(silentNoMatch.stderr).toBe("");
  expect(silentNoMatch.exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();

  // A typo next to a real name is not fatal, but it is reported before the verdict.
  const someMatch = await pruneMerged(dir, "--filter", "a", "--filter", "nope", "--dry-run", "--linker", "hoisted");
  expect(someMatch.lines).toStrictEqual([
    BANNER,
    "",
    'warn: No workspace packages matched the filter "nope"',
    "- junk (node_modules/a/node_modules)",
    CAN_BE_REMOVED(1, 4),
    APPLY_HINT("--filter", "a", "--filter", "nope", "--linker", "hoisted"),
  ]);
  expect(someMatch.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const fromRoot = await prune(dir, "--filter", "./packages/a", "--dry-run", "--linker", "hoisted");
  expect(fromRoot.stderr).toBe("");
  expect(lines(fromRoot.stdout)).toStrictEqual(listing("--filter", "./packages/a"));
  expect(fromRoot.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const fromInside = await prune(
    { dir, cwd: join(dir, "packages", "a") },
    "--filter",
    ".",
    "--dry-run",
    "--linker",
    "hoisted",
  );
  expect(fromInside.stderr).toBe("");
  expect(lines(fromInside.stdout)).toStrictEqual(listing("--filter", "."));
  expect(fromInside.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const { stdout, stderr, exitCode } = await prune(dir, "--filter", "a", "--linker", "hoisted");
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/a/node_modules)
    1 package removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
});

test.concurrent.each(linkers)(
  "%s: --filter warns about the unmatched pattern and still applies the rest",
  async linker => {
    const dir = await setupWorkspaces(linker, {
      packages: { app: { dependencies: { "no-deps": "1.0.0" } }, lib: {} },
    });
    const junk = plant(dir, "packages/app/node_modules/junk");

    const { stdout, stderr, exitCode } = await prune(dir, "--filter", "app", "--filter", "nope", "--linker", linker);
    expect(normalizeBunSnapshot(stderr)).toBe('warn: No workspace packages matched the filter "nope"');
    // bun.lock installs nothing there, so the folder is shown by its own path, not through the node_modules/app link.
    expect(lines(stdout)).toStrictEqual([
      BANNER,
      "",
      "- junk (packages/app/node_modules)",
      REMOVED(1, linker === "hoisted" ? 4 : 3),
    ]);
    expect(exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();

    const silent = await prune(dir, "--filter", "app", "--filter", "nope", "--silent", "--linker", linker);
    expect(silent.stdout).toBe("");
    expect(silent.stderr).toBe("");
    expect(silent.exitCode).toBe(0);
  },
);

test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: optionalDependencies survive --production and go away with --omit=optional",
  async linker => {
    const pkg = {
      name: "foo",
      dependencies: { "no-deps": "1.0.0" },
      optionalDependencies: { "a-dep": "1.0.1" },
      devDependencies: { "one-fixed-dep": "1.0.0" },
    };
    const [prodDir, omitDir] = await Promise.all([setupWithLinker(linker, pkg), setupWithLinker(linker, pkg)]);
    const removed = (row: string) => [BANNER, "", row, REMOVED(1, linker === "hoisted" ? 3 : 6)];

    const production = await prune(prodDir, "--production", "--linker", linker);
    expect(lines(production.stdout)).toStrictEqual(removed("- one-fixed-dep@1.0.0"));
    expect(production.exitCode).toBe(0);
    expect(existsSync(join(prodDir, "node_modules", "a-dep", "package.json"))).toBeTrue();
    expect(existsSync(join(prodDir, "node_modules", "no-deps", "package.json"))).toBeTrue();

    const omit = await prune(omitDir, "--omit=optional", "--linker", linker);
    expect(lines(omit.stdout)).toStrictEqual(removed("- a-dep@1.0.1"));
    expect(omit.exitCode).toBe(0);
    expect(() => lstatSync(join(omitDir, "node_modules", "a-dep"))).toThrow();
    expect(existsSync(join(omitDir, "node_modules", "no-deps", "package.json"))).toBeTrue();
    expect(existsSync(join(omitDir, "node_modules", "one-fixed-dep", "package.json"))).toBeTrue();
  },
);

test.concurrent.each([["--os=aix"], ["--cpu=s390x"]])(
  "%s removes packages that are disabled for that platform, plain prune keeps them",
  async (flag: string) => {
    const dir = await setup({
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "test-postinstall-skip-native": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    const native = join(nm, "test-postinstall-skip-native");
    expect(existsSync(native)).toBeTrue();

    const host = await prune(dir);
    expect(out(host.stdout)).toEndWith(NOTHING(2, 1));
    expect(host.exitCode).toBe(0);
    expect(existsSync(native)).toBeTrue();

    const other = await prune(dir, flag);
    expect(out(other.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - test-postinstall-skip-native@1.0.0
      1 package removed (checked 2 installed packages)"
    `);
    expect(other.exitCode).toBe(0);
    expect(existsSync(native)).toBeFalse();
    expect(existsSync(join(nm, "no-deps"))).toBeTrue();
    expect(await install(dir, flag)).toContain("no changes");
  },
);

test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: an npm: alias is kept under its alias name",
  async linker => {
    const dir = await setupWithLinker(linker, {
      name: "foo",
      dependencies: { "my-alias": "npm:no-deps@1.0.0", "one-dep": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    expect(await file(join(nm, "my-alias", "package.json")).json()).toMatchObject({
      name: "no-deps",
      version: "1.0.0",
    });
    const junk = plant(dir, "node_modules/junk");

    const { stdout, exitCode } = await prune(dir, "--linker", linker);
    expect(out(stdout)).toBe(`bun prune <version> (<revision>)\n\n- junk\n${REMOVED(1, linker === "hoisted" ? 4 : 6)}`);
    expect(exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();
    expect(await file(join(nm, "my-alias", "package.json")).json()).toMatchObject({
      name: "no-deps",
      version: "1.0.0",
    });
    if (linker === "isolated") {
      expect(existsSync(join(nm, ".bun", "no-deps@1.0.0"))).toBeTrue();
      expect(existsSync(join(nm, ".bun", "no-deps@1.0.1"))).toBeTrue();
    }
  },
);

test.concurrent("isolated + publicHoistPattern: hoisted links follow their store entries", async () => {
  const dir = await setupWithLinker(
    "isolated",
    { name: "foo", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } },
    { publicHoistPattern: ["no-deps"], hoistPattern: ["one-dep"] },
  );
  const nm = join(dir, "node_modules");
  const store = join(nm, ".bun");
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(isSymlink(join(store, "node_modules", "one-dep"))).toBeTrue();

  const clean = await prune(dir, "--linker", "isolated");
  expect(out(clean.stdout)).toEndWith(NOTHING(5, 2));
  expect(clean.exitCode).toBe(0);

  const production = await prune(dir, "--production", "--linker", "isolated");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 5 installed packages)"
  `);
  expect(production.exitCode).toBe(0);
  expect(() => lstatSync(join(store, "node_modules", "one-dep"))).toThrow();
  expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
  expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "1.0.0" });
});

test.concurrent.skipIf(isWindows || process.getuid?.() === 0)(
  "a failed deletion is reported, the rest is removed, exit code 1",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const nm = join(dir, "node_modules");
    const junkA = plant(dir, "node_modules/junk-a");
    const inner = plant(dir, "node_modules/junk-b/inner");
    const junkB = join(nm, "junk-b");
    chmodSync(junkB, 0o555);
    const failure = /^error: failed to remove node_modules\/junk-b: E[A-Z]+ \(.+\)$/;
    try {
      // The failure is explained before the verdict, and the verdict counts it.
      const { lines: merged, exitCode } = await pruneMerged(dir);
      expect(merged).toStrictEqual([
        BANNER,
        "",
        "- junk-a",
        expect.stringMatching(failure),
        "1 package removed, 1 failed (checked 3 installed packages)",
      ]);
      expect(exitCode).toBe(1);
      expect(existsSync(junkA)).toBeFalse();
      expect(existsSync(inner)).toBeTrue();

      // --silent still reports what could not be removed; the exit code alone would hide which entry it was.
      const silent = await prune(dir, "--silent");
      expect(silent.stdout).toBe("");
      expect(normalizeBunSnapshot(silent.stderr)).toMatch(failure);
      expect(silent.exitCode).toBe(1);
      expect(existsSync(inner)).toBeTrue();
    } finally {
      chmodSync(junkB, 0o755);
    }

    const { stdout, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk-b
    1 package removed (checked 2 installed packages)"
  `);
    expect(exitCode).toBe(0);
    expect(existsSync(junkB)).toBeFalse();
  },
);

// pnpm#4770 / #5092 / #10275: `prepare` must not run after --production removed the tools it needs.
test.concurrent("never runs the project's lifecycle scripts", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "a-dep": "1.0.1" },
    scripts: {
      preinstall: "echo PRE >> ran.txt",
      postinstall: "echo POST >> ran.txt",
      prepare: "echo PREPARE >> ran.txt",
    },
  });
  const ran = join(dir, "ran.txt");
  expect(existsSync(ran)).toBeTrue();
  rmSync(ran);
  const junk = plant(dir, "node_modules/junk");

  const plain = await prune(dir);
  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 3 installed packages)"
  `);
  expect(plain.exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(ran)).toBeFalse();

  const production = await prune(dir, "--production");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package removed (checked 2 installed packages)"
  `);
  expect(production.exitCode).toBe(0);
  expect(existsSync(ran)).toBeFalse();
});

test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: --omit=peer removes what bun install --omit=peer would not install",
  async linker => {
    const pkg = { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0" } };
    const [dir, plainDir] = await Promise.all([setupWithLinker(linker, pkg), setupWithLinker(linker, pkg)]);
    const nm = join(dir, "node_modules");
    const installedNoDeps = () =>
      linker === "hoisted"
        ? existsSync(join(nm, "no-deps"))
        : readdirSync(join(nm, ".bun")).some(name => name.startsWith("no-deps@"));
    expect(existsSync(join(nm, "peer-deps-fixed", "package.json"))).toBeTrue();
    expect(installedNoDeps()).toBeTrue();

    const omit = await prune(dir, "--omit=peer", "--linker", linker);
    expect(lines(omit.stdout)).toStrictEqual([BANNER, "", "- no-deps@1.1.0", REMOVED(1, linker === "hoisted" ? 2 : 3)]);
    expect(omit.exitCode).toBe(0);
    expect(installedNoDeps()).toBeFalse();
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    expect(existsSync(join(nm, "peer-deps-fixed", "package.json"))).toBeTrue();
    if (linker === "hoisted") {
      expect(await install(dir, "--omit=peer")).toContain("no changes");
    }

    const plain = await prune(plainDir, "--linker", linker);
    expect(out(plain.stdout)).toEndWith(linker === "hoisted" ? NOTHING(2, 1) : NOTHING(3, 2));
    expect(plain.exitCode).toBe(0);
  },
);

// The peer edge survives --production, so `bun install --production` still installs the peer into the store; only the root's dev link goes.
test.concurrent.each(["peer-deps-fixed", "optional-peer-deps"])(
  "isolated: --production keeps %s's peer-hash entry and the peer a devDependency pulled in, removes the dev link",
  async consumer => {
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { [consumer]: "1.0.0" },
      devDependencies: { "no-deps": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    const store = join(nm, ".bun");
    const [entry, ...rest] = storeEntries(dir).filter(name => name.startsWith(`${consumer}@`));
    expect(rest).toStrictEqual([]);
    expect(entry).toMatch(new RegExp(`^${consumer}@1\\.0\\.0\\+[0-9a-f]{16}$`));
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0", entry]);
    expect(isSymlink(join(nm, "no-deps"))).toBeTrue();
    const peerLink = join(store, entry, "node_modules", "no-deps", "package.json");
    expect(existsSync(peerLink)).toBeTrue();

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout).split("\n")).toStrictEqual([
      "bun prune <version> (<revision>)",
      "",
      "- no-deps@1.0.0",
      "1 package removed (checked 4 installed packages)",
    ]);
    expect(exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0", entry]);
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    expect(existsSync(peerLink)).toBeTrue();
    expect(await file(join(nm, consumer, "package.json")).json()).toMatchObject({ name: consumer, version: "1.0.0" });

    await expectProductionInstallIsNoop(dir);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0", entry]);
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(out(again.stdout)).toEndWith(NOTHING(3, 2));
    expect(again.exitCode).toBe(0);
  },
);

// A --production install hashes peers against the narrowed peer set, so its entries differ from a full install's; both are what some install creates.
test.concurrent(
  "isolated: --production keeps the entries `bun install --production` itself created, then only drops dev-only ones after a full install",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: { "peer-deps-fixed": "1.0.0", "one-dep": "1.0.0" },
        devDependencies: { "no-deps": "2.0.0", "a-dep": "1.0.1" },
      }),
    );
    await install(dir, "--lockfile-only", "--linker", "isolated");
    await install(dir, "--production", "--linker", "isolated");
    const nm = join(dir, "node_modules");
    const store = join(nm, ".bun");
    const storeTree = () => readdirSync(store, { recursive: true }).map(String).toSorted();
    const consumerEntries = () => storeEntries(dir).filter(entry => entry.startsWith("peer-deps-fixed@"));
    const [productionEntry, ...rest] = consumerEntries();
    expect(rest).toStrictEqual([]);
    expect(productionEntry).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "one-dep@1.0.0", productionEntry]);
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    const productionTree = storeTree();

    const noop = await prune(dir, "--production", "--linker", "isolated");
    expect(out(noop.stdout)).toEndWith(NOTHING(5, 2));
    expect(noop.exitCode).toBe(0);
    expect(storeTree()).toStrictEqual(productionTree);
    await expectProductionInstallIsNoop(dir);
    expect(storeTree()).toStrictEqual(productionTree);

    await install(dir, "--linker", "isolated");
    const [fullEntry, ...others] = consumerEntries().filter(entry => entry !== productionEntry);
    expect(others).toStrictEqual([]);
    expect(fullEntry).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
    expect(storeEntries(dir)).toStrictEqual(
      ["a-dep@1.0.1", "no-deps@1.0.1", "no-deps@2.0.0", "one-dep@1.0.0", productionEntry, fullEntry].toSorted(),
    );
    expect(isSymlink(join(nm, "no-deps"))).toBeTrue();
    expect(isSymlink(join(nm, "a-dep"))).toBeTrue();

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout).split("\n")).toStrictEqual([
      "bun prune <version> (<revision>)",
      "",
      "- a-dep@1.0.1",
      "- no-deps@2.0.0",
      "2 packages removed (checked 10 installed packages)",
    ]);
    expect(exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "one-dep@1.0.0", productionEntry, fullEntry].toSorted());
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    expect(() => lstatSync(join(nm, "a-dep"))).toThrow();
    expect(await file(join(nm, "peer-deps-fixed", "package.json")).json()).toMatchObject({ version: "1.0.0" });
    await expectProductionInstallIsNoop(dir);
  },
);

test.concurrent("isolated: --production removes the stale peer-hash variant and keeps the current one", async () => {
  const deps = (noDeps: string) => ({
    name: "foo",
    dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": noDeps },
    devDependencies: { "a-dep": "1.0.1" },
  });
  const dir = await setupWithLinker("isolated", deps("1.0.0"));
  const store = join(dir, "node_modules", ".bun");
  const peerEntries = () => storeEntries(dir).filter(entry => entry.startsWith("peer-deps-fixed@"));
  const [before] = peerEntries();
  expect(before).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);

  await write(join(dir, "package.json"), JSON.stringify(deps("1.0.1")));
  await install(dir, "--linker", "isolated");
  const variants = peerEntries();
  expect(variants).toHaveLength(2);
  const after = variants.find(entry => entry !== before)!;
  expect(storeEntries(dir)).toStrictEqual(["a-dep@1.0.1", "no-deps@1.0.0", "no-deps@1.0.1", ...variants].toSorted());

  const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout).split("\n")).toStrictEqual([
    "bun prune <version> (<revision>)",
    "",
    "- a-dep@1.0.1",
    "- no-deps@1.0.0",
    `- ${before}`,
    "3 packages removed (checked 8 installed packages)",
  ]);
  expect(exitCode).toBe(0);
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", after]);
  expect(await file(join(store, "no-deps@1.0.1", "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });
  await expectProductionInstallIsNoop(dir);
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", after]);
});

test.concurrent("keeps dependencies bundled inside a file: dependency", async () => {
  const { packageDir: dir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { local: "file:./local" } })),
    write(
      join(dir, "local", "package.json"),
      JSON.stringify({ name: "local", version: "1.0.0", bundleDependencies: ["inner"] }),
    ),
    write(
      join(dir, "local", "node_modules", "inner", "package.json"),
      JSON.stringify({ name: "inner", version: "1.0.0" }),
    ),
  ]);
  await runBunInstall(installEnv(dir), dir);
  const inner = join(dir, "node_modules", "local", "node_modules", "inner", "package.json");
  expect(existsSync(inner)).toBeTrue();
  const junk = plant(dir, "node_modules/junk");

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(inner)).toBeTrue();
});

// pnpm#13676
test.concurrent(
  "hoisted: a nested copy is kept while the root copy is still the old version and removed once bun install replaced it",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } });
    const nm = join(dir, "node_modules");
    const nested = join(nm, "one-dep", "node_modules", "no-deps");
    const rootPkgJson = join(nm, "no-deps", "package.json");
    expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.1" });

    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "1.0.1" } }),
    );
    await install(dir, "--lockfile-only");
    expect(existsSync(nested)).toBeTrue();
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });

    // The reason the copy was kept comes before the verdict, as it would on a terminal.
    const stale = await pruneMerged(dir);
    expect(stale.lines).toStrictEqual([
      BANNER,
      "",
      WARN("node_modules/no-deps", "node_modules/one-dep/node_modules/no-deps"),
      NOTE,
      NOTHING(3, 2),
    ]);
    expect(stale.exitCode).toBe(0);
    expect(existsSync(join(nested, "package.json"))).toBeTrue();
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });

    await install(dir);
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "1.0.1" });
    expect(existsSync(nested)).toBeTrue();

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps@1.0.1 (node_modules/one-dep/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(existsSync(nested)).toBeFalse();
    expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();
    expect(existsSync(rootPkgJson)).toBeTrue();
  },
);

test.concurrent(
  "hoisted: --production keeps the nested copy a production package resolves to while the root holds the dev version",
  async () => {
    const pkg = { name: "foo", dependencies: { "one-fixed-dep": "1.0.0" }, devDependencies: { "no-deps": "2.0.0" } };
    const [dir, silentDir] = await Promise.all([setup(pkg), setup(pkg)]);
    const rootPkgJson = join(dir, "node_modules", "no-deps", "package.json");
    const nestedPkgJson = join(dir, "node_modules", "one-fixed-dep", "node_modules", "no-deps", "package.json");
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });
    expect(await file(nestedPkgJson).json()).toMatchObject({ version: "1.0.0" });

    // The root copy is the one a full install hoists there, not a stale tree:
    // no "is not the version bun.lock expects" warning, no install hint.
    const { stdout, stderr, exitCode } = await prune(dir, "--production");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      Done! Checked 3 installed packages across 2 folders (nothing to prune)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await file(nestedPkgJson).json()).toMatchObject({ version: "1.0.0" });
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });

    // A root copy whose version the lockfile does not know anywhere is a
    // genuinely stale tree and still warns under --production.
    const rootPkg = await file(rootPkgJson).json();
    await write(rootPkgJson, JSON.stringify({ ...rootPkg, version: "9.9.9" }));
    const stale = await prune(dir, "--production", "--dry-run");
    expect(out(stale.stderr)).toBe(
      `${WARN("node_modules/no-deps", "node_modules/one-fixed-dep/node_modules/no-deps")}\n${NOTE}`,
    );
    expect(stale.exitCode).toBe(0);
    await write(rootPkgJson, JSON.stringify(rootPkg));

    await runBunInstall(installEnv(dir), dir, { production: true });

    const silent = await prune(silentDir, "--production", "--silent");
    expect(silent.stdout).toBe("");
    expect(silent.stderr).toBe("");
    expect(silent.exitCode).toBe(0);
    expect(
      existsSync(join(silentDir, "node_modules", "one-fixed-dep", "node_modules", "no-deps", "package.json")),
    ).toBeTrue();
  },
);

test.concurrent(
  "hoisted: inside a tree folder, junk is removed but a copy shadowed by a mismatched root package is kept",
  async () => {
    const dir = await setup({
      name: "foo",
      dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "a-dep": "1.0.2" },
    });
    const nm = join(dir, "node_modules");
    const nestedNoDeps = join(nm, "one-dep", "node_modules", "no-deps");
    expect(await file(join(nestedNoDeps, "package.json")).json()).toMatchObject({ version: "1.0.1" });
    expect(await file(join(nm, "a-dep", "package.json")).json()).toMatchObject({ version: "1.0.2" });

    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "a-dep": "1.0.1" } }),
    );
    await install(dir, "--lockfile-only");
    const shadowed = plant(dir, "node_modules/one-dep/node_modules/a-dep");
    const junk = plant(dir, "node_modules/one-dep/node_modules/junk");

    const { lines: merged, exitCode } = await pruneMerged(dir);
    expect(merged).toStrictEqual([
      BANNER,
      "",
      WARN("node_modules/a-dep", "node_modules/one-dep/node_modules/a-dep"),
      NOTE,
      "- junk (node_modules/one-dep/node_modules)",
      REMOVED(1, 6),
    ]);
    expect(exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();
    expect(existsSync(shadowed)).toBeTrue();
    expect(await file(join(nestedNoDeps, "package.json")).json()).toMatchObject({ version: "1.0.1" });
    expect(await file(join(nm, "a-dep", "package.json")).json()).toMatchObject({ version: "1.0.2" });
  },
);

test.concurrent(
  "hoisted + workspaces: --production keeps a workspace's copy while the root still holds the dev version",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({ name: "root", workspaces: ["packages/*"], devDependencies: { "no-deps": "2.0.0" } }),
      ),
      write(
        join(dir, "packages", "a", "package.json"),
        JSON.stringify({ name: "a", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      ),
    ]);
    await install(dir, "--linker", "hoisted");
    const nm = join(dir, "node_modules");
    const rootPkgJson = join(nm, "no-deps", "package.json");
    const workspacePkgJson = join(dir, "packages", "a", "node_modules", "no-deps", "package.json");
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });
    expect(await file(workspacePkgJson).json()).toMatchObject({ version: "1.0.0" });

    // The root copy is the dev version a full install hoists there; not a
    // stale tree, so no warning under --production.
    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      Done! Checked 3 installed packages across 2 folders (nothing to prune)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await file(workspacePkgJson).json()).toMatchObject({ version: "1.0.0" });
    expect(isSymlink(join(nm, "a"))).toBeTrue();
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });
  },
);

test.concurrent(
  "isolated: --production removes a dev-only link and its bin even though production still needs the store entry",
  async () => {
    // no-deps-bins' tarball lacks its bin file, and bun install skips bin links whose target is missing; what-bin ships one.
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "uses-what-bin": "1.0.0" },
      devDependencies: { "what-bin": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    const store = join(nm, ".bun");
    expect(isSymlink(join(nm, "what-bin"))).toBeTrue();
    expect(existsSync(join(store, "what-bin@1.0.0"))).toBeTrue();
    expectBinInstalled(nm, "what-bin");

    const dryRun = await prune(dir, "--production", "--dry-run", "--linker", "isolated");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - what-bin@1.0.0
      1 package can be removed (checked 4 installed packages)
        bun prune --production --linker isolated"
    `);
    expect(dryRun.exitCode).toBe(0);
    expect(isSymlink(join(nm, "what-bin"))).toBeTrue();
    expectBinInstalled(nm, "what-bin");

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - what-bin@1.0.0
      1 package removed (checked 4 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(() => lstatSync(join(nm, "what-bin"))).toThrow();
    expect(existsSync(join(store, "what-bin@1.0.0"))).toBeTrue();
    expect(existsSync(join(store, "uses-what-bin@1.0.0", "node_modules", "what-bin", "package.json"))).toBeTrue();
    expect(existsSync(join(nm, "uses-what-bin", "package.json"))).toBeTrue();
    expectBinRemoved(nm, "what-bin");

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(out(again.stdout)).toEndWith(NOTHING(3, 2));
    expect(again.exitCode).toBe(0);
    await expectProductionInstallIsNoop(dir);
  },
);

// pnpm#13676
test.concurrent("hoisted: nested node_modules of packages without a tree node are pruned", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" },
  });
  const nm = join(dir, "node_modules");
  const junk = plant(dir, "node_modules/no-deps/node_modules/junk");
  const scopedJunk = plant(dir, "node_modules/@scoped/has-bin-entry/node_modules/@other/thing");
  writeFileSync(join(nm, "no-deps", "node_modules", "keep.txt"), "");

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @other/thing (node_modules/@scoped/has-bin-entry/node_modules)
    - junk (node_modules/no-deps/node_modules)
    2 packages removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(scopedJunk)).toBeFalse();
  expect(existsSync(join(nm, "@scoped", "has-bin-entry", "node_modules", "@other"))).toBeFalse();
  expect(existsSync(join(nm, "no-deps", "node_modules", "keep.txt"))).toBeTrue();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(existsSync(join(nm, "@scoped", "has-bin-entry", "package.json"))).toBeTrue();
});

// pnpm#8307: the isolated planner keeps only direct dependencies in node_modules, which would wipe a hoisted tree.
test.concurrent("--linker isolated on a hoisted install prunes it as hoisted", async () => {
  const dir = await setupWithLinker("hoisted", { name: "foo", dependencies: { "one-dep": "1.0.0" } });
  const nm = join(dir, "node_modules");
  const hoisted = join(nm, "no-deps", "package.json");
  expect(existsSync(hoisted)).toBeTrue();
  expect(existsSync(join(nm, ".bun"))).toBeFalse();

  for (const flags of [
    ["--linker", "isolated"],
    ["--linker", "isolated", "--dry-run"],
  ]) {
    const { stdout, stderr, exitCode } = await prune(dir, ...flags);
    expect(stderr).toBe("");
    expect(lines(stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
    expect(exitCode).toBe(0);
    expect(existsSync(hoisted)).toBeTrue();
  }
});

// pnpm#8307
test.concurrent("--production --linker hoisted on an isolated install prunes the store too", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", devDependencies: { "one-dep": "1.0.0" } });
  const nm = join(dir, "node_modules");
  expect(isSymlink(join(nm, "one-dep"))).toBeTrue();

  const dryRun = await prune(dir, "--production", "--linker", "hoisted", "--dry-run");
  expect(dryRun.stderr).toBe("");
  expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages can be removed (checked 3 installed packages)
      bun prune --production --linker hoisted"
  `);
  expect(dryRun.exitCode).toBe(0);
  expect(isSymlink(join(nm, "one-dep"))).toBeTrue();
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();

  const { stdout, exitCode } = await prune(dir, "--production", "--linker", "hoisted");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
  expect(storeEntries(dir)).toStrictEqual([]);
});

// A hoisted install after an isolated one reuses the links into the store that still match bun.lock.
// The hoisted planner trusts them the way the installer does; --linker isolated prunes the same
// mixed tree as an isolated install.
test.concurrent("mixed: a hoisted install over an isolated one is pruned as the configured linker", async () => {
  const dir = await setupWorkspaces("isolated", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } } },
  });
  const nm = join(dir, "node_modules");
  const aNm = join(dir, "packages", "a", "node_modules");
  await install(dir, "--linker", "hoisted");
  expect(isSymlink(join(nm, "no-deps"))).toBeTrue();
  expect(isSymlink(join(nm, "one-dep"))).toBeFalse();
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();
  expect(isSymlink(join(aNm, "no-deps"))).toBeTrue();
  expect(isSymlink(join(aNm, "one-dep"))).toBeTrue();
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "no-deps@2.0.0", "one-dep@1.0.0"]);

  // bunfig.toml says isolated, so that is the tiebreak without --linker.
  const dryRun = await prune(dir, "--dry-run");
  expect(dryRun.stderr).toBe("");
  expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - one-dep@1.0.0
    1 package can be removed (checked 8 installed packages)
      bun prune"
  `);
  expect(dryRun.exitCode).toBe(0);

  const hoisted = await prune(dir, "--linker", "hoisted");
  expect(hoisted.stderr).toBe("");
  expect(out(hoisted.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@2.0.0 (packages/a/node_modules)
    - one-dep@1.0.0 (packages/a/node_modules)
    2 packages removed (checked 6 installed packages)"
  `);
  expect(hoisted.exitCode).toBe(0);
  expect(() => lstatSync(join(aNm, "no-deps"))).toThrow();
  expect(() => lstatSync(join(aNm, "one-dep"))).toThrow();
  expect(isSymlink(join(nm, "no-deps"))).toBeTrue();
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "no-deps@2.0.0", "one-dep@1.0.0"]);

  const isolated = await prune(dir, "--linker", "isolated");
  expect(isolated.stderr).toBe("");
  expect(out(isolated.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - one-dep@1.0.0
    1 package removed (checked 6 installed packages)"
  `);
  expect(isolated.exitCode).toBe(0);
  expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
  expect(isSymlink(join(nm, "no-deps"))).toBeTrue();
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "no-deps@2.0.0", "one-dep@1.0.0"]);
});

// `rm -rf node_modules` leaves the workspace folders' links into the store behind. After a hoisted
// install, neither linker may refuse the tree: the root is hoisted and the links are junk.
test.concurrent("mixed: dangling links into a deleted store do not make the tree isolated", async () => {
  const dir = await setupWorkspaces("isolated", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } } },
  });
  const nm = join(dir, "node_modules");
  const aNm = join(dir, "packages", "a", "node_modules");
  rmSync(nm, { recursive: true });
  await install(dir, "--linker", "hoisted");
  expect(existsSync(join(nm, ".bun"))).toBeFalse();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();
  expect(isSymlink(join(aNm, "no-deps"))).toBeTrue();
  expect(existsSync(join(aNm, "no-deps"))).toBeFalse();

  const dryRun = await prune(dir, "--linker", "isolated", "--dry-run");
  expect(dryRun.stderr).toBe("");
  expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps (packages/a/node_modules)
    - one-dep (packages/a/node_modules)
    2 packages can be removed (checked 6 installed packages)
      bun prune --linker isolated"
  `);
  expect(dryRun.exitCode).toBe(0);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps (packages/a/node_modules)
    - one-dep (packages/a/node_modules)
    2 packages removed (checked 6 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(() => lstatSync(join(aNm, "no-deps"))).toThrow();
  expect(() => lstatSync(join(aNm, "one-dep"))).toThrow();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();

  for (const flags of [[], ["--linker", "isolated"], ["--linker", "hoisted"]]) {
    const again = await prune(dir, ...flags);
    expect(again.stderr).toBe("");
    expect(lines(again.stdout)).toStrictEqual([BANNER, "", NOTHING(4, 3)]);
    expect(again.exitCode).toBe(0);
  }
});

// `rm -rf node_modules/*` keeps the hidden store. The hoisted packages above it decide the layout, so
// the isolated planner never removes what they depend on.
test.concurrent("mixed: a stale store under a hoisted install does not make the tree isolated", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", dependencies: { "one-dep": "1.0.0" } });
  const nm = join(dir, "node_modules");
  for (const name of readdirSync(nm)) {
    if (!name.startsWith(".")) rmSync(join(nm, name), { recursive: true });
  }
  await install(dir, "--linker", "hoisted");
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();
  expect(isSymlink(join(nm, "one-dep"))).toBeFalse();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "one-dep@1.0.0"]);

  for (const flags of [[], ["--linker", "isolated"], ["--linker", "hoisted"]]) {
    const { stdout, stderr, exitCode } = await prune(dir, ...flags);
    expect(stderr).toBe("");
    expect(lines(stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
    expect(exitCode).toBe(0);
  }
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "one-dep@1.0.0"]);
});

// The hoisted linker installs an `npm:` alias under the alias, a name only the dependency rows know.
test.concurrent("mixed: real directories of npm: aliases are hoisted evidence", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { x: "npm:no-deps@1.0.0", y: "npm:no-deps@2.0.0" },
  });
  const nm = join(dir, "node_modules");
  for (const name of readdirSync(nm)) {
    if (!name.startsWith(".")) rmSync(join(nm, name), { recursive: true });
  }
  await install(dir, "--linker", "hoisted");
  expect(isSymlink(join(nm, "x"))).toBeFalse();
  expect(existsSync(join(nm, "x", "package.json"))).toBeTrue();
  expect(existsSync(join(nm, "y", "package.json"))).toBeTrue();
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0", "no-deps@2.0.0"]);

  // The hoisted planner checks the two directories; the isolated planner would check the store too.
  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "isolated");
  expect(stderr).toBe("");
  expect(lines(stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expect(exitCode).toBe(0);
});

// pnpm#5960
test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: --production keeps an npm: alias whose real name is also a dev-only dependency",
  async linker => {
    const dir = await setupWithLinker(linker, {
      name: "foo",
      dependencies: { aliased: "npm:no-deps@1.0.0" },
      devDependencies: { "no-deps": "2.0.0" },
    });
    const nm = join(dir, "node_modules");
    expect(await file(join(nm, "aliased", "package.json")).json()).toMatchObject({ version: "1.0.0" });
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", linker);
    expect(lines(stdout)).toStrictEqual([BANNER, "", "- no-deps@2.0.0", REMOVED(1, linker === "hoisted" ? 2 : 4)]);
    expect(exitCode).toBe(0);
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    expect(await file(join(nm, "aliased", "package.json")).json()).toMatchObject({ version: "1.0.0" });
    if (linker === "isolated") {
      expect(existsSync(join(nm, ".bun", "no-deps@1.0.0"))).toBeTrue();
    }
    await expectProductionInstallIsNoop(dir);
  },
);

// pnpm#10081
test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: the dangling link of a renamed workspace is removed, the renamed workspace is not",
  async linker => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
    const appJson = (lib: string) =>
      JSON.stringify({ name: "app", version: "1.0.0", dependencies: { [lib]: "workspace:*" } });
    const libJson = (name: string) => JSON.stringify({ name, version: "1.0.0", dependencies: { "no-deps": "1.0.0" } });
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
      write(join(dir, "packages", "app", "package.json"), appJson("a")),
      write(join(dir, "packages", "a", "package.json"), libJson("a")),
    ]);
    await install(dir, "--linker", linker);
    // The hoisted linker links every workspace into the root folder; the isolated linker links it where it is depended on.
    const linkFolder = linker === "hoisted" ? "node_modules" : "packages/app/node_modules";
    const staleLink = join(dir, linkFolder, "a");
    expect(isSymlink(staleLink)).toBeTrue();

    renameSync(join(dir, "packages", "a"), join(dir, "packages", "b"));
    await Promise.all([
      write(join(dir, "packages", "b", "package.json"), libJson("b")),
      write(join(dir, "packages", "app", "package.json"), appJson("b")),
    ]);
    await install(dir, "--lockfile-only", "--linker", linker);
    expect(isSymlink(staleLink)).toBeTrue();
    expect(existsSync(staleLink)).toBeFalse();

    const { stdout, exitCode } = await prune(dir, "--linker", linker);
    // A dangling link has no package.json to read a version from; only a non-root folder is named.
    const row = linker === "hoisted" ? "- a" : `- a (${linkFolder})`;
    expect(lines(stdout)).toStrictEqual([BANNER, "", row, REMOVED(1, 3)]);
    expect(exitCode).toBe(0);
    expect(() => lstatSync(staleLink)).toThrow();
    expect(existsSync(join(dir, "packages", "b", "package.json"))).toBeTrue();
    const noDeps =
      linker === "hoisted"
        ? join(dir, "node_modules", "no-deps")
        : join(dir, "packages", "b", "node_modules", "no-deps");
    expect(existsSync(join(noDeps, "package.json"))).toBeTrue();
  },
);

test.concurrent(
  "isolated: store entries of file:, tarball and git dependencies are kept under their non-npm keys",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    const gitPkg = await gitDependency(dir, "git-pkg");
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "no-deps": "1.0.0",
            "local": "file:./local",
            "left-pad": copyTarball(dir, "left-pad", "1.0.0"),
            "git-pkg": gitPkg,
          },
        }),
      ),
      write(join(dir, "local", "package.json"), JSON.stringify({ name: "local", version: "1.0.0" })),
    ]);
    await install(dir, "--linker", "isolated");
    const nm = join(dir, "node_modules");
    const installed = storeEntries(dir);
    expect(installed).toStrictEqual([
      expect.stringMatching(/^git-pkg@git\+/),
      expect.stringMatching(/^left-pad@/),
      "local@file+local",
      "no-deps@1.0.0",
    ]);
    expect(installed[1]).not.toBe("left-pad@1.0.0");
    for (const name of ["no-deps", "local", "left-pad", "git-pkg"]) {
      expect(isSymlink(join(nm, name))).toBeTrue();
    }
    plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
    plant(dir, "node_modules/.bun/local@file+elsewhere/node_modules/local");
    plant(dir, "node_modules/.bun/git-pkg@1.0.0/node_modules/git-pkg");

    const { stdout, stderr, exitCode } = await prune(dir, "--linker", "isolated");
    expect(stderr).not.toContain("warn:");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - git-pkg@1.0.0
      - junk@1.0.0
      - local@file+elsewhere
      3 packages removed (checked 11 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(installed);
    for (const name of ["no-deps", "local", "left-pad", "git-pkg"]) {
      expect(existsSync(join(nm, name, "package.json"))).toBeTrue();
    }

    const production = await prune(dir, "--production", "--linker", "isolated");
    expect(out(production.stdout)).toEndWith(NOTHING(8, 2));
    expect(production.exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(installed);
  },
);

test.concurrent(
  "workspaces: without --linker, a bun.lock with configVersion 1 is pruned with the isolated linker",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({});
    await writeWorkspaces(dir, packageJson, {
      packages: { a: { dependencies: { "one-dep": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } } },
    });
    await install(dir);
    expect(await lock(dir)).toContain('"configVersion": 1,');
    const store = join(dir, "node_modules", ".bun");
    expect(storeEntries(dir)).toStrictEqual(["a-dep@1.0.1", "no-deps@1.0.1", "one-dep@1.0.0"]);
    const junk = plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");

    const { stdout, stderr, exitCode } = await prune(dir, "--production");
    expect(stderr).not.toContain("linker");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk@1.0.0
      2 packages removed (checked 6 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();
    expect(existsSync(join(store, "a-dep@1.0.1"))).toBeFalse();
    expect(existsSync(join(store, "one-dep@1.0.0"))).toBeTrue();
    expect(() => lstatSync(join(dir, "packages", "a", "node_modules", "a-dep"))).toThrow();
    expect(existsSync(join(dir, "packages", "a", "node_modules", "one-dep", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(dir);
  },
);

test.concurrent(
  "workspaces: without --linker, a bun.lock without configVersion is pruned with the hoisted linker",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({});
    await writeWorkspaces(dir, packageJson, {
      packages: { a: { dependencies: { "one-dep": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } } },
    });
    await install(dir, "--linker", "hoisted");
    const before = await lock(dir);
    expect(before).toContain('"configVersion": 1,');
    await write(join(dir, "bun.lock"), before.replace('  "configVersion": 1,\n', ""));
    const nm = join(dir, "node_modules");
    expect(existsSync(join(nm, ".bun"))).toBeFalse();
    expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
    const junk = plant(dir, "node_modules/junk");
    // A stale store does not turn the hoisted packages above it into an isolated install.
    const storeJunk = plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");

    const { stdout, stderr, exitCode } = await prune(dir, "--production");
    expect(stderr).toBe("");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk
      2 packages removed (checked 5 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();
    expect(existsSync(storeJunk)).toBeTrue();
    expect(existsSync(join(nm, "a-dep"))).toBeFalse();
    expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
    expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();
  },
);

test.concurrent("without --linker, a project without workspaces is pruned with the hoisted linker", async () => {
  const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } });
  expect(await lock(dir)).toContain('"configVersion": 1,');
  const nm = join(dir, "node_modules");
  expect(existsSync(join(nm, ".bun"))).toBeFalse();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  const junk = plant(dir, "node_modules/junk");
  const storeJunk = plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir, "--production");
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    - junk
    2 packages removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(storeJunk)).toBeTrue();
  expect(existsSync(join(nm, "a-dep"))).toBeFalse();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
});

test.concurrent.each([["--os=aix"], ["--cpu=s390x"]])(
  "isolated: %s removes the store entry and link of a package disabled for that platform, plain prune keeps them",
  async (flag: string) => {
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "test-postinstall-skip-native": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    const store = join(nm, ".bun");
    expect(isSymlink(join(nm, "test-postinstall-skip-native"))).toBeTrue();
    expect(existsSync(join(store, "test-postinstall-skip-native@1.0.0"))).toBeTrue();

    const host = await prune(dir, "--linker", "isolated");
    expect(out(host.stdout)).toEndWith(NOTHING(4, 2));
    expect(host.exitCode).toBe(0);
    expect(existsSync(join(store, "test-postinstall-skip-native@1.0.0"))).toBeTrue();

    const other = await prune(dir, flag, "--linker", "isolated");
    expect(out(other.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - test-postinstall-skip-native@1.0.0
      1 package removed (checked 4 installed packages)"
    `);
    expect(other.exitCode).toBe(0);
    expect(existsSync(join(store, "test-postinstall-skip-native@1.0.0"))).toBeFalse();
    expect(() => lstatSync(join(nm, "test-postinstall-skip-native"))).toThrow();
    expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
    expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
    expect(await install(dir, flag, "--linker", "isolated")).toContain("no changes");
  },
);

test.concurrent("isolated: keeps dependencies bundled inside a package, with and without --production", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", dependencies: { "bundled-transitive": "1.0.0" } });
  const installed = storeEntries(dir);
  expect(installed).toStrictEqual(["bundled-transitive@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"]);
  const bundled = join(
    dir,
    "node_modules",
    ".bun",
    "bundled-transitive@1.0.0",
    "node_modules",
    "bundled-transitive",
    "node_modules",
    "no-deps",
    "package.json",
  );
  expect(existsSync(bundled)).toBeTrue();

  for (const flags of [[], ["--production"]]) {
    const { stdout, exitCode } = await prune(dir, ...flags, "--linker", "isolated");
    expect(out(stdout)).toEndWith(NOTHING(4, 2));
    expect(exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(installed);
    expect(existsSync(bundled)).toBeTrue();
  }
  await expectProductionInstallIsNoop(dir);
});

test.concurrent("hoisted: the nested tree of a package with bundled dependencies is not walked", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "2.0.0", "bundled-transitive": "1.0.0" } });
  const nm = join(dir, "node_modules");
  const bundledNm = join(nm, "bundled-transitive", "node_modules");
  expect(await file(join(bundledNm, "no-deps", "package.json")).json()).toMatchObject({ version: "1.0.0" });
  expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
  expect(await file(join(nm, "one-dep", "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });
  const junk = plant(dir, "node_modules/bundled-transitive/node_modules/junk");
  const oneDepJunk = plant(dir, "node_modules/one-dep/node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).not.toContain("warn:");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/one-dep/node_modules)
    1 package removed (checked 5 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();
  expect(existsSync(oneDepJunk)).toBeFalse();
  expect(existsSync(join(bundledNm, "no-deps", "package.json"))).toBeTrue();
});

test.concurrent(
  "hoisted: a nested copy of a git dependency is removed only once the root copy's .bun-tag matches bun.lock",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    const gitPkg = await gitDependency(dir, "git-pkg");
    await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0", "git-pkg": gitPkg } }));
    await install(dir, "--linker", "hoisted");
    const nm = join(dir, "node_modules");
    const rootTag = join(nm, "git-pkg", ".bun-tag");
    const tag = await file(rootTag).text();
    expect(tag).toMatch(/^[0-9a-f]{40}$/);
    expect(await lock(dir)).toContain(tag);
    const nested = plant(dir, "node_modules/no-deps/node_modules/git-pkg");
    writeFileSync(rootTag, "0000000000000000000000000000000000000000");

    const stale = await prune(dir, "--linker", "hoisted");
    expect(out(stale.stdout)).toEndWith(NOTHING(3, 2));
    expect(out(stale.stderr)).toBe(
      `${WARN("node_modules/git-pkg", "node_modules/no-deps/node_modules/git-pkg")}\n${NOTE}`,
    );
    expect(stale.exitCode).toBe(0);
    expect(existsSync(nested)).toBeTrue();

    writeFileSync(rootTag, tag);
    const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
    expect(stderr).not.toContain("warn:");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - git-pkg (node_modules/no-deps/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(existsSync(nested)).toBeFalse();
    expect(existsSync(join(nm, "git-pkg", "package.json"))).toBeTrue();
  },
);

test.concurrent(
  "hoisted: a nested copy of a local tarball dependency is removed once the root copy is installed",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    await write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: { "no-deps": "1.0.0", "left-pad": copyTarball(dir, "left-pad", "1.0.0") },
      }),
    );
    await install(dir, "--linker", "hoisted");
    const nm = join(dir, "node_modules");
    const rootPkgJson = join(nm, "left-pad", "package.json");
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "1.0.0" });
    const nested = plant(dir, "node_modules/no-deps/node_modules/left-pad");
    const junk = plant(dir, "node_modules/no-deps/node_modules/junk");

    const kept = "node_modules/no-deps/node_modules/left-pad";

    renameSync(join(nm, "left-pad"), join(dir, "left-pad.moved"));
    const missing = await prune(dir, "--linker", "hoisted");
    expect(lines(missing.stdout)).toStrictEqual([
      BANNER,
      "",
      "- junk (node_modules/no-deps/node_modules)",
      REMOVED(1, 3),
    ]);
    expect(out(missing.stderr)).toBe(`${MISSING_WARN("node_modules/left-pad", kept)}\n${NOTE}`);
    expect(missing.exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();
    expect(existsSync(nested)).toBeTrue();

    renameSync(join(dir, "left-pad.moved"), join(nm, "left-pad"));
    renameSync(rootPkgJson, join(nm, "left-pad", "package.json.bak"));
    const mismatch = await prune(dir, "--linker", "hoisted");
    expect(lines(mismatch.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(out(mismatch.stderr)).toBe(`${WARN("node_modules/left-pad", kept)}\n${NOTE}`);
    expect(mismatch.exitCode).toBe(0);
    expect(existsSync(nested)).toBeTrue();

    renameSync(join(nm, "left-pad", "package.json.bak"), rootPkgJson);
    const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
    expect(stderr).toBe("");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - left-pad (node_modules/no-deps/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(existsSync(nested)).toBeFalse();
    expect(existsSync(rootPkgJson)).toBeTrue();
  },
);

test.concurrent("hoisted: a nested copy of a link: dependency is removed when the root entry is the link", async () => {
  const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await Promise.all([
    write(join(dir, "linked", "package.json"), JSON.stringify({ name: "linked", version: "1.0.0" })),
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0", linked: "link:linked" } })),
  ]);
  const env = globalEnv(dir, join(dir, ".global"));
  const link = await run(env, join(dir, "linked"), "link");
  expect(link.stderr).not.toContain("error:");
  expect(link.stdout).toContain('Success! Registered "linked"');
  expect(link.exitCode).toBe(0);
  const installed = await run(env, dir, "install", "--linker", "hoisted");
  expect(installed.stderr).not.toContain("error:");
  expect(installed.exitCode).toBe(0);
  const nm = join(dir, "node_modules");
  expect(isSymlink(join(nm, "linked"))).toBeTrue();
  const nested = plant(dir, "node_modules/no-deps/node_modules/linked");

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
  expect(stderr).not.toContain("warn:");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - linked (node_modules/no-deps/node_modules)
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(nested)).toBeFalse();
  expect(isSymlink(join(nm, "linked"))).toBeTrue();
  expect(await file(join(dir, "linked", "package.json")).json()).toStrictEqual({ name: "linked", version: "1.0.0" });
});

test.concurrent("hoisted: a nested copy left behind by an override to a tarball is removed", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "2.0.0", "one-dep": "1.0.0" } });
  const nm = join(dir, "node_modules");
  const nested = join(nm, "one-dep", "node_modules", "no-deps");
  expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.1" });
  expect(await lock(dir)).toContain('"one-dep/no-deps"');

  await write(
    join(dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: { "no-deps": "2.0.0", "one-dep": "1.0.0" },
      overrides: { "no-deps": copyTarball(dir, "no-deps", "2.0.0") },
    }),
  );
  await install(dir);
  expect(await lock(dir)).not.toContain('"one-dep/no-deps"');
  expect(await lock(dir)).toContain("no-deps-2.0.0.tgz");
  expect(existsSync(join(nested, "package.json"))).toBeTrue();

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).not.toContain("warn:");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1 (node_modules/one-dep/node_modules)
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(nested)).toBeFalse();
  expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ name: "no-deps" });
});

// https://github.com/oven-sh/bun/issues/13563
test.concurrent(
  "hoisted: build metadata in the installed package.json version does not block removing a nested copy",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0", "no-deps-build-metadata": "1.0.0" } });
    const nm = join(dir, "node_modules");
    expect(await file(join(nm, "no-deps-build-metadata", "package.json")).json()).toMatchObject({
      version: "1.0.0+123",
    });
    expect(await lock(dir)).toContain('"no-deps-build-metadata@1.0.0"');
    const nested = plant(dir, "node_modules/no-deps/node_modules/no-deps-build-metadata");

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(stderr).not.toContain("warn:");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps-build-metadata (node_modules/no-deps/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(existsSync(nested)).toBeFalse();
    expect(existsSync(join(nm, "no-deps-build-metadata", "package.json"))).toBeTrue();
  },
);

test.concurrent(
  "isolated + publicHoistPattern: the public link of a transitive dev-only package goes away with its store entry",
  async () => {
    const dir = await setupWithLinker(
      "isolated",
      { name: "foo", dependencies: { "a-dep": "1.0.1" }, devDependencies: { "one-dep": "1.0.0" } },
      { publicHoistPattern: ["no-deps"] },
    );
    const nm = join(dir, "node_modules");
    const store = join(nm, ".bun");
    expect(isSymlink(join(nm, "no-deps"))).toBeTrue();
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "1.0.1" });

    const plain = await prune(dir, "--linker", "isolated");
    expect(out(plain.stdout)).toEndWith(NOTHING(6, 2));
    expect(plain.exitCode).toBe(0);
    expect(isSymlink(join(nm, "no-deps"))).toBeTrue();

    const production = await prune(dir, "--production", "--linker", "isolated");
    expect(out(production.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps@1.0.1
      - one-dep@1.0.0
      2 packages removed (checked 6 installed packages)"
    `);
    expect(production.exitCode).toBe(0);
    expect(existsSync(join(store, "no-deps@1.0.1"))).toBeFalse();
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
    expect(existsSync(join(nm, "a-dep", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(dir);
  },
);

test.concurrent(
  "isolated: an unwanted entry's peer-hash variant and scoped hidden-hoist links follow it out",
  async () => {
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "no-deps": "1.0.0" },
      devDependencies: { "one-dep": "1.0.0" },
    });
    const store = join(dir, "node_modules", ".bun");
    const hiddenHoist = join(store, "node_modules");
    const variant = plant(dir, "node_modules/.bun/one-dep@1.0.0+0123456789abcdef/node_modules/one-dep");
    const scopedEntry = plant(dir, "node_modules/.bun/@scope+zzz@1.0.0/node_modules/@scope/zzz");
    const scopedLink = join(hiddenHoist, "@scope", "zzz");
    mkdirSync(join(hiddenHoist, "@scope"), { recursive: true });
    symlinkSync(scopedEntry, scopedLink, "junction");
    const liveLink = join(hiddenHoist, "@scope", "no-deps");
    symlinkSync(join(store, "no-deps@1.0.0", "node_modules", "no-deps"), liveLink, "junction");
    expect(isSymlink(scopedLink)).toBeTrue();
    expect(existsSync(join(liveLink, "package.json"))).toBeTrue();

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/zzz@1.0.0
      - no-deps@1.0.1
      - one-dep@1.0.0
      - one-dep@1.0.0+0123456789abcdef
      4 packages removed (checked 7 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(existsSync(variant)).toBeFalse();
    expect(existsSync(join(store, "one-dep@1.0.0+0123456789abcdef"))).toBeFalse();
    expect(existsSync(join(store, "@scope+zzz@1.0.0"))).toBeFalse();
    expect(() => lstatSync(scopedLink)).toThrow();
    expect(existsSync(join(liveLink, "package.json"))).toBeTrue();
    expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  },
);

test.concurrent("isolated: an emptied scope dir of dangling hidden-hoist links is removed", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "one-dep": "1.0.0" },
  });
  const store = join(dir, "node_modules", ".bun");
  const scopeDir = join(store, "node_modules", "@scope");
  const scopedEntry = plant(dir, "node_modules/.bun/@scope+zzz@1.0.0/node_modules/@scope/zzz");
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(scopedEntry, join(scopeDir, "zzz"), "junction");

  const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scope/zzz@1.0.0
    - no-deps@1.0.1
    - one-dep@1.0.0
    3 packages removed (checked 6 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(scopeDir)).toBeFalse();
  expect(existsSync(join(store, "node_modules"))).toBeTrue();
});

test.concurrent("isolated: --filter on a pruned checkout does not protect the missing workspace", async () => {
  const dir = await setupWorkspaces("isolated", prunedCheckout({}));
  const store = join(dir, "node_modules", ".bun");
  rmSync(join(dir, "packages", "other"), { recursive: true });
  expect(existsSync(join(store, "left-pad@1.0.0"))).toBeTrue();

  const { stdout, stderr, exitCode } = await prune(dir, "--filter", "app", "--linker", "isolated");
  expect(stderr).toContain(PRUNED_NOTE);
  expect(stderr).not.toContain(OUT_OF_SYNC);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - left-pad@1.0.0
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(join(store, "left-pad@1.0.0"))).toBeFalse();
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  expect(existsSync(join(dir, "packages", "app", "node_modules", "no-deps", "package.json"))).toBeTrue();
  await install(dir, "--frozen-lockfile", "--linker", "isolated");
  expect(existsSync(join(store, "left-pad@1.0.0"))).toBeFalse();
});

test.concurrent.each(linkers)(
  "%s: a catalog entry only a missing workspace used may be missing from bun.lock",
  async linker => {
    const dir = await setupWorkspaces(linker, {
      root: { workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1", "left-pad": "1.0.0" } } },
      packages: {
        app: { dependencies: { "a-dep": "catalog:" } },
        other: { dependencies: { "left-pad": "catalog:" } },
      },
    });
    const full = await lock(dir);
    const trimmed = full.replace(/^ {4}"left-pad": "1\.0\.0",\n/m, "");
    expect(trimmed).not.toBe(full);
    expect(trimmed).toContain('"a-dep": "1.0.1",');
    await write(join(dir, "bun.lock"), trimmed);
    rmSync(join(dir, "packages", "other"), { recursive: true });
    const leftPad =
      linker === "hoisted"
        ? join(dir, "node_modules", "left-pad")
        : join(dir, "node_modules", ".bun", "left-pad@1.0.0");
    expect(existsSync(leftPad)).toBeTrue();

    const { stdout, stderr, exitCode } = await prune(dir, "--linker", linker);
    expect(normalizeBunSnapshot(stderr)).toBe(
      `${PRUNED_NOTE}\nnote: skipped 1 catalog entry not in bun.lock (unused by the workspaces on disk): "left-pad"`,
    );
    expect(lines(stdout)).toStrictEqual(
      linker === "hoisted"
        ? [BANNER, "", "- left-pad@1.0.0", "- other", REMOVED(2, 4)]
        : [BANNER, "", "- left-pad@1.0.0", REMOVED(1, 3)],
    );
    expect(exitCode).toBe(0);
    expect(existsSync(leftPad)).toBeFalse();
    expect(await lock(dir)).toBe(trimmed);
    await install(dir, "--frozen-lockfile", "--linker", linker);
    expect(await lock(dir)).toBe(trimmed);
  },
);

test.concurrent("a lockfile that fails to parse is an error and nothing is deleted", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const junk = plant(dir, "node_modules/junk");
  await write(join(dir, "bun.lock"), "{ this is not a lockfile");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toContain("error: failed to load lockfile: ");
  expect(out(stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
  expect(exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();
});

test.concurrent("missing package.json is an error; --cwd prunes another directory", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  using empty = tempDir("prune-empty", {});
  const junk = plant(dir, "node_modules/junk");

  const missing = await prune(String(empty));
  expect(normalizeBunSnapshot(missing.stderr)).toBe("error: missing package.json, nothing to prune");
  expect(missing.stdout).toBe("");
  expect(missing.exitCode).toBe(1);

  // Like the missing-lockfile refusal, this is a state of the project rather than a usage error, so --silent applies.
  const silent = await prune(String(empty), "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);

  const { stdout, exitCode } = await prune({ dir, cwd: String(empty) }, "--cwd", dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("a node_modules that is a file is an error", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const nm = join(dir, "node_modules");
  rmSync(nm, { recursive: true });
  writeFileSync(nm, "not a directory");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toContain("failed to open node_modules");
  expect(out(stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
  expect(exitCode).toBe(1);

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(await file(nm).text()).toBe("not a directory");
});

test.concurrent(
  "a package.json script named prune does not shadow bun prune; bun run prune still runs it",
  async () => {
    const dir = await setup({
      name: "foo",
      dependencies: { "no-deps": "1.0.0" },
      scripts: { prune: "echo SCRIPT_RAN" },
    });
    const junk = plant(dir, "node_modules/junk");

    const pruned = await bun(dir, "prune");
    expect(pruned.stdout).not.toContain("SCRIPT_RAN");
    expect(out(pruned.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk
      1 package removed (checked 2 installed packages)"
    `);
    expect(pruned.exitCode).toBe(0);
    expect(existsSync(junk)).toBeFalse();

    const script = await bun(dir, "run", "prune");
    expect(script.stdout).toContain("SCRIPT_RAN");
    expect(script.stdout).not.toContain("Checked");
    expect(script.exitCode).toBe(0);
  },
);

// The docs point at --omit=optional; like every other flag bun prune does not know, --no-optional is ignored rather than rejected.
test.concurrent("--no-optional is not --omit=optional", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0" },
    optionalDependencies: { "a-dep": "1.0.1" },
  });

  const noOptional = await prune(dir, "--no-optional", "--dry-run");
  expect(noOptional.stderr).toBe("");
  expect(out(noOptional.stdout)).toEndWith(NOTHING(2, 1));
  expect(noOptional.exitCode).toBe(0);

  const omit = await prune(dir, "--omit=optional", "--dry-run");
  expect(out(omit.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package can be removed (checked 2 installed packages)
      bun prune --omit=optional"
  `);
  expect(omit.exitCode).toBe(0);
  expect(existsSync(join(dir, "node_modules", "a-dep", "package.json"))).toBeTrue();
});

test.concurrent("--help lists every flag; -F is --filter, -p is --production", async () => {
  const dir = await setupWorkspaces("hoisted", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { dependencies: { "no-deps": "1.0.0" } }, b: { dependencies: { "no-deps": "1.0.0" } } },
  });
  const aJunk = plant(dir, "packages/a/node_modules/junk");
  const bJunk = plant(dir, "packages/b/node_modules/junk");

  const help = await prune(dir, "--help");
  expect(help.stderr).toBe("");
  expect(out(help.stdout)).toMatchInlineSnapshot(`
    "Usage: bun prune [flags]

      Remove packages from node_modules that are not in bun.lock. With --production, also remove packages that are only needed by devDependencies.

    Flags:
      -p, --production      Also remove packages that are only needed by devDependencies (alias: --prod)
          --omit=<val>      Also remove packages that are only needed by the given dependency types
          --dry-run         Print what would be removed without deleting anything
          --os=<val>        Prune for a different operating system than the current one
          --cpu=<val>       Prune for a different CPU architecture than the current one
          --linker=<val>    Linker to assume when node_modules mixes isolated and hoisted installs (one of "isolated" or "hoisted")
      -F, --filter=<val>    Only prune the node_modules folders of the matching workspaces
          --silent          Don't log anything
          --cwd=<val>       Set a specific cwd
      -h, --help            Print this help menu

    Examples:
      Remove packages that are not in bun.lock from node_modules
      bun prune

      Also remove devDependencies, e.g. after the build step in a Dockerfile
      bun prune --production

      Show what would be removed without deleting anything
      bun prune --dry-run

      Only prune what the app workspace no longer needs
      bun prune --production --filter app

    Full documentation is available at https://bun.com/docs/pm/cli/prune."
  `);
  expect(help.exitCode).toBe(0);

  const longFlag = await prune(dir, "--filter", "a", "--dry-run", "--linker", "hoisted");
  const shortFlag = await prune(dir, "-F", "a", "--dry-run", "--linker", "hoisted");
  // The hint echoes the flags as typed, so only the last line differs between the two spellings.
  expect(lines(longFlag.stdout)).toStrictEqual([
    BANNER,
    "",
    "- junk (node_modules/a/node_modules)",
    CAN_BE_REMOVED(1, 5),
    APPLY_HINT("--filter", "a", "--linker", "hoisted"),
  ]);
  expect(lines(shortFlag.stdout)).toStrictEqual([
    ...lines(longFlag.stdout).slice(0, -1),
    APPLY_HINT("-F", "a", "--linker", "hoisted"),
  ]);
  expect(shortFlag.exitCode).toBe(0);

  const { stdout, exitCode } = await prune(dir, "-F", "b", "-p", "--linker", "hoisted");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/b/node_modules)
    1 package removed (checked 5 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(aJunk)).toBeTrue();
  expect(existsSync(bJunk)).toBeFalse();
});

test.concurrent(
  "--global is rejected before the global folder is touched; bun link registrations survive",
  async () => {
    using dir = tempDir("prune-global", {
      "lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
      "gpkg/package.json": JSON.stringify({ name: "gpkg", version: "1.0.0" }),
    });
    const root = String(dir);
    const bunInstall = join(root, ".global");
    const globalDir = join(bunInstall, "install", "global");
    const globalNm = join(globalDir, "node_modules");
    const env = globalEnv(root, bunInstall);

    const link = await run(env, join(root, "lib"), "link");
    expect(link.stderr).not.toContain("error:");
    expect(link.stdout).toContain('Success! Registered "lib"');
    expect(link.exitCode).toBe(0);

    const add = await run(env, root, "add", "-g", join(root, "gpkg"));
    expect(add.stderr).not.toContain("error:");
    expect(add.exitCode).toBe(0);
    expect(existsSync(join(globalDir, "bun.lock"))).toBeTrue();
    expect(readdirSync(globalNm).sort()).toStrictEqual(["gpkg", "lib"]);
    expect(existsSync(join(globalNm, "lib", "package.json"))).toBeTrue();

    for (const args of [
      ["prune", "-g"],
      ["prune", "--dry-run", "--global"],
      ["prune", "-g", "--silent"],
    ]) {
      const { stdout, stderr, exitCode } = await run(env, root, ...args);
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: --global cannot be used with bun prune
      note: the global folder is also the 'bun link' registry, and bun.lock does not list linked packages"
    `);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    }
    expect(readdirSync(globalNm).sort()).toStrictEqual(["gpkg", "lib"]);
    expect(existsSync(join(globalNm, "lib", "package.json"))).toBeTrue();

    const fresh = join(root, ".fresh");
    const { stderr, exitCode } = await run(globalEnv(root, fresh), root, "prune", "-g");
    expect(stderr).toContain("error: --global cannot be used with bun prune");
    expect(exitCode).toBe(1);
    expect(existsSync(fresh)).toBeFalse();
  },
);
