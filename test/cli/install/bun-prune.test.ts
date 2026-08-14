import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, isWindows, normalizeBunSnapshot, runBunInstall } from "harness";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

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
  `warn: ${expected} is not the version bun.lock installs there; keeping ${kept}`;
const NOTE =
  "note: run 'bun install' with the same flags to install the versions bun.lock expects, then run 'bun prune' again";
const OUT_OF_SYNC = "bun.lock does not match package.json";
const OUT_OF_SYNC_NOTE = "note: run 'bun install' first, then run 'bun prune' again";
const PRUNED_NOTE = "note: skipped 1 workspace listed in bun.lock but not on disk";
const NOTHING = (packages: number, folders: number) =>
  `Done! Checked ${packages} package${packages === 1 ? "" : "s"} across ${folders} folder${folders === 1 ? "" : "s"} (nothing to prune)`;
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

function out(stdout: string) {
  return normalizeBunSnapshot(stdout).replaceAll("\\", "/");
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
  expect(stderr).toContain(OUT_OF_SYNC);
  expect(stderr).toContain(OUT_OF_SYNC_NOTE);
  expect(out(stdout)).not.toMatch(/^- /m);
  expect(stdout).not.toContain("Removed");
  expect(stdout).not.toContain("Would remove");
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
    - node_modules/@other/thing
    - node_modules/@scoped/junk
    - node_modules/junk
    Removed 3 packages (checked 5)"
  `);
  expect(first.stdout).toMatch(/\(checked 5\) \[\d+(\.\d+)?m?s\]\n?$/);
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
    - node_modules/one-dep/node_modules/junk
    Removed 1 package (checked 4)"
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
      - node_modules/no-deps-bins
      - node_modules/one-fixed-dep-bins
      - node_modules/what-bin
      Removed 3 packages (checked 5)"
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
    - node_modules/one-fixed-dep
    Removed 1 package (checked 2)"
  `);
  expect(production.exitCode).toBe(0);
  expect(existsSync(join(dir, "node_modules", "no-deps"))).toBeTrue();
  expect(existsSync(join(dir, "node_modules", "one-fixed-dep"))).toBeFalse();

  const plain = await prune(plainDir);
  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    Done! Checked 2 packages across 1 folder (nothing to prune)"
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
    - node_modules/junk
    Would remove 1 package (checked 2)"
  `);
  expect(dryRun.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();

  const clean = await prune(dir, "--dry-run");
  expect(out(clean.stdout)).toEndWith(NOTHING(1, 1));
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
    Done! Checked 1 package across 1 folder (nothing to prune)"
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
    - node_modules/linked-junk
    Removed 1 package (checked 2)"
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
  expect(noLock.stderr).toContain("missing lockfile, nothing to prune");
  expect(noLock.exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();

  const positional = await prune(installedDir, "foo");
  expect(positional.stderr).toContain("bun prune does not take arguments");
  expect(positional.exitCode).toBe(1);
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
    - node_modules/a-dep
    - node_modules/a/node_modules/junk
    Removed 2 packages (checked 5)"
  `);
  expect(exitCode).toBe(0);

  expect(isSymlink(join(nm, "a"))).toBeTrue();
  expect(existsSync(workspaceNoDeps)).toBeTrue();
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(join(nm, "a-dep"))).toBeFalse();
});

test.concurrent("keeps dependencies bundled inside a package", async () => {
  const dir = await setup({ name: "foo", dependencies: { "bundled-transitive": "1.0.0" } });
  const bundled = join(dir, "node_modules", "bundled-transitive", "node_modules", "no-deps", "package.json");
  expect(existsSync(bundled)).toBeTrue();

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    Done! Checked 3 packages across 1 folder (nothing to prune)"
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
    - node_modules/.bun/junk@1.0.0
    - node_modules/.bun/no-deps@1.0.1
    - node_modules/.bun/one-dep@1.0.0
    - node_modules/.bun/zzz@1.0.0
    - node_modules/junk-real
    Removed 5 packages (checked 9)"
  `);
  expect(exitCode).toBe(0);

  expect(existsSync(join(store, "junk@1.0.0"))).toBeFalse();
  expect(existsSync(join(store, "zzz@1.0.0"))).toBeFalse();
  expect(existsSync(join(store, "no-deps@1.0.1"))).toBeFalse();
  expect(existsSync(join(store, "one-dep@1.0.0"))).toBeFalse();
  expect(existsSync(junkReal)).toBeFalse();
  expect(existsSync(join(store, "no-deps@1.0.0"))).toBeTrue();
  expect(existsSync(peerVariant)).toBeTrue();
  expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(existsSync(hiddenHoist)).toBeTrue();
  expect(() => lstatSync(join(hiddenHoist, "zzz"))).toThrow();
  expect(await lock(dir)).toBe(lockBefore);

  await expectProductionInstallIsNoop(dir);
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
  expect(out(stdout)).toContain("- node_modules/.bun/one-dep@1.0.0");
  expect(out(stdout)).toEndWith("Removed 2 packages (checked 3)");
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
  expect(out(stdout)).toEndWith("- node_modules/.bun/what-bin@1.0.0\nRemoved 1 package (checked 4)");
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
  const leftoverStore = plant(dir, "node_modules/.bun/whatever@1.0.0");
  const integrity = join(nm, ".yarn-integrity");
  writeFileSync(integrity, "");

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/junk
    Removed 1 package (checked 1)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(leftoverStore)).toBeTrue();
  expect(existsSync(integrity)).toBeTrue();
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
    Done! Checked 2 packages across 1 folder (nothing to prune)"
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
    - node_modules/@fake
    - node_modules/@real/junk
    Removed 2 packages (checked 3)"
  `);
  expect(exitCode).toBe(0);
  expect(() => lstatSync(join(nm, "@fake"))).toThrow();
  expect(existsSync(inner)).toBeTrue();
  expect(existsSync(join(nm, "@real"))).toBeFalse();
});

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
    - node_modules/junk
    Removed 1 package (checked 2)"
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
    - node_modules/@ext/thing
    - node_modules/ext
    Removed 2 packages (checked 4)"
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
    - node_modules/@scoped/has-bin-entry
    - node_modules/one-dep
    Removed 2 packages (checked 3)"
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
    - node_modules/@scoped/has-bin-entry
    Removed 1 package (checked 2)"
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
    - node_modules/.bun/@scoped+has-bin-entry@1.0.0
    - node_modules/.bun/no-deps@1.0.1
    - node_modules/.bun/one-dep@1.0.0
    Removed 3 packages (checked 7)"
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
    - packages/a/node_modules/no-deps
    Removed 1 package (checked 3)"
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
      - node_modules/.bun/a-dep@1.0.1
      - packages/app/node_modules/tool
      Would remove 2 packages (checked 6)"
    `);
    expect(dryRun.exitCode).toBe(0);
    expect(isSymlink(join(appNm, "tool"))).toBeTrue();

    const { stdout, exitCode } = await prune({ dir, cwd: app }, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/.bun/a-dep@1.0.1
      - packages/app/node_modules/tool
      Removed 2 packages (checked 6)"
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
    - node_modules/.bun/a-dep@1.0.1
    Removed 1 package (checked 6)"
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
      - packages/app/node_modules/@scope/tool
      Removed 1 package (checked 4)"
    `);
    expect(mixed.exitCode).toBe(0);
    expect(() => lstatSync(join(mixedScope, "tool"))).toThrow();
    expect(existsSync(join(mixedScope, "lib", "package.json"))).toBeTrue();
    expect(existsSync(join(mixedDir, "packages", "tool", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(mixedDir);

    const devOnly = await prune(devOnlyDir, "--production", "--linker", "isolated");
    expect(out(devOnly.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - packages/app/node_modules/@scope/tool
      Removed 1 package (checked 3)"
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
      - packages/app/node_modules/tool
      Removed 1 package (checked 4)"
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
      expect(out(first.stdout)).toEndWith("- packages/app/node_modules/tool\nRemoved 1 package (checked 4)");
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
  expect(out(stdout)).toBe(
    linker === "hoisted"
      ? "bun prune <version> (<revision>)\n- node_modules/a-dep\n- node_modules/junk\nRemoved 2 packages (checked 3)"
      : "bun prune <version> (<revision>)\n- node_modules/.bun/a-dep@1.0.1\n- node_modules/junk\nRemoved 2 packages (checked 5)",
  );
  expect(stderr).not.toContain(OUT_OF_SYNC);
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
    - node_modules/junk
    Removed 1 package (checked 3)"
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
    - node_modules/junk
    Removed 1 package (checked 2)"
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

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
  expect(stderr).toContain(PRUNED_NOTE);
  expect(stderr).not.toContain(OUT_OF_SYNC);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/junk
    - node_modules/left-pad
    - node_modules/other
    Removed 3 packages (checked 5)"
  `);
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
    - node_modules/.bun/left-pad@1.0.0
    - node_modules/junk
    Removed 2 packages (checked 4)"
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
    - node_modules/left-pad
    - node_modules/other
    Removed 2 packages (checked 4)"
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
      - node_modules/shared-alias
      Removed 1 package (checked 3)"
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
      - node_modules/a-dep
      - node_modules/a/node_modules/junk
      Removed 2 packages (checked 8)"
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
      - node_modules/left-pad
      Removed 1 package (checked 5)"
    `);
    expect(onlyRoot.exitCode).toBe(0);
    expect(existsSync(bJunk)).toBeTrue();
    expect(existsSync(join(nm, "one-fixed-dep"))).toBeTrue();

    const everything = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/b/node_modules/junk
      - node_modules/one-fixed-dep
      Removed 2 packages (checked 7)"
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
      - node_modules/.bun/one-fixed-dep@1.0.0
      - packages/a/node_modules/a-dep
      Removed 2 packages (checked 7)"
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
      - node_modules/.bun/a-dep@1.0.1
      - node_modules/.bun/left-pad@1.0.0
      Removed 2 packages (checked 6)"
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
      - packages/selected/node_modules/a-dep
      Removed 1 package (checked 4)"
    `);
    expect(first.exitCode).toBe(0);
    expect(() => lstatSync(selectedADep)).toThrow();
    expect(existsSync(join(unselectedADep, "package.json"))).toBeTrue();
    expect(existsSync(storeEntry)).toBeTrue();

    const second = await prune(dir, "--production", "--filter", "unselected", "--linker", "isolated");
    expect(out(second.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - packages/unselected/node_modules/a-dep
      Removed 1 package (checked 4)"
    `);
    expect(second.exitCode).toBe(0);
    expect(() => lstatSync(unselectedADep)).toThrow();
    expect(existsSync(storeEntry)).toBeTrue();

    const everything = await prune(dir, "--production", "--linker", "isolated");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/.bun/a-dep@1.0.1
      Removed 1 package (checked 4)"
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
      linker === "hoisted" ? `- node_modules/${ws}/node_modules/${name}` : `- packages/${ws}/node_modules/${name}`;
    // Removals print in byte order of their displayed path.
    const listing = (removed: string[], verb: string, checked: number) =>
      [
        "bun prune <version> (<revision>)",
        ...removed.toSorted(),
        `${verb} ${removed.length} package${removed.length === 1 ? "" : "s"} (checked ${checked})`,
      ].join("\n");
    // The shared area is swept whole-repo under --filter: the isolated store, and under hoisted the root folder itself.
    const sharedJunk = linker === "hoisted" ? ["- node_modules/root-junk"] : ["- node_modules/.bun/junk@1.0.0"];
    // hoisted: root folder (no-deps, app, lib, root-junk) + app folder; isolated: store (2 no-deps, junk) + app folder.
    const sharedAndApp = linker === "hoisted" ? 6 : 5;

    const dryRun = await prune(dir, "--filter", "app", "--dry-run", "--linker", linker);
    expect(out(dryRun.stdout)).toBe(listing([...sharedJunk, shown("app", "app-junk")], "Would remove", sharedAndApp));
    expect(dryRun.exitCode).toBe(0);
    expect(existsSync(appJunk)).toBeTrue();
    expect(existsSync(rootJunk)).toBeTrue();

    const byPath = await prune(dir, "--filter", "./packages/app", "--linker", linker);
    expect(out(byPath.stdout)).toBe(listing([...sharedJunk, shown("app", "app-junk")], "Removed", sharedAndApp));
    expect(byPath.exitCode).toBe(0);
    expect(existsSync(appJunk)).toBeFalse();
    expect(existsSync(libJunk)).toBeTrue();
    expect(existsSync(rootJunk)).toBe(linker === "isolated");
    if (storeJunk) {
      expect(existsSync(storeJunk)).toBeFalse();
    }

    const byGlob = await prune({ dir, cwd: join(dir, "packages", "app") }, "--filter", "li*", "--linker", linker);
    expect(out(byGlob.stdout)).toBe(listing([shown("lib", "lib-junk")], "Removed", linker === "hoisted" ? 5 : 4));
    expect(byGlob.exitCode).toBe(0);
    expect(existsSync(libJunk)).toBeFalse();

    if (linker === "isolated") {
      const root = await prune(dir, "--filter", "./", "--linker", linker);
      expect(out(root.stdout)).toBe(listing(["- node_modules/root-junk"], "Removed", 4));
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
  const listing = `bun prune <version> (<revision>)\n- node_modules/a/node_modules/junk\nWould remove 1 package (checked 4)`;

  const noMatch = await prune(dir, "--filter", "nope", "--linker", "hoisted");
  expect(noMatch.stderr).toContain("No packages matched the filter");
  expect(out(noMatch.stdout)).not.toMatch(/^- /m);
  expect(noMatch.exitCode).toBe(1);
  expect(existsSync(junk)).toBeTrue();

  const fromRoot = await prune(dir, "--filter", "./packages/a", "--dry-run", "--linker", "hoisted");
  expect(out(fromRoot.stdout)).toBe(listing);
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
  expect(out(fromInside.stdout)).toBe(listing);
  expect(fromInside.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const { stdout, exitCode } = await prune(dir, "--filter", "a", "--linker", "hoisted");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/a/node_modules/junk
    Removed 1 package (checked 4)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
});

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
    const removed = (name: string) =>
      linker === "hoisted"
        ? `- node_modules/${name}\nRemoved 1 package (checked 3)`
        : `- node_modules/.bun/${name}\nRemoved 1 package (checked 6)`;

    const production = await prune(prodDir, "--production", "--linker", linker);
    expect(out(production.stdout)).toBe(
      `bun prune <version> (<revision>)\n${removed(linker === "hoisted" ? "one-fixed-dep" : "one-fixed-dep@1.0.0")}`,
    );
    expect(production.exitCode).toBe(0);
    expect(existsSync(join(prodDir, "node_modules", "a-dep", "package.json"))).toBeTrue();
    expect(existsSync(join(prodDir, "node_modules", "no-deps", "package.json"))).toBeTrue();

    const omit = await prune(omitDir, "--omit=optional", "--linker", linker);
    expect(out(omit.stdout)).toBe(
      `bun prune <version> (<revision>)\n${removed(linker === "hoisted" ? "a-dep" : "a-dep@1.0.1")}`,
    );
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
      - node_modules/test-postinstall-skip-native
      Removed 1 package (checked 2)"
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
    expect(out(stdout)).toBe(
      `bun prune <version> (<revision>)\n- node_modules/junk\nRemoved 1 package (checked ${linker === "hoisted" ? 4 : 6})`,
    );
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
    - node_modules/.bun/no-deps@1.0.1
    - node_modules/.bun/one-dep@1.0.0
    Removed 2 packages (checked 5)"
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
    try {
      const { stdout, stderr, exitCode } = await prune(dir);
      expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/junk-a
      Removed 1 package (checked 3)"
    `);
      expect(stderr).toContain("failed to remove");
      expect(stderr).toContain("junk-b");
      expect(exitCode).toBe(1);
      expect(existsSync(junkA)).toBeFalse();
      expect(existsSync(inner)).toBeTrue();
    } finally {
      chmodSync(junkB, 0o755);
    }

    const { stdout, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/junk-b
    Removed 1 package (checked 2)"
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
    - node_modules/junk
    Removed 1 package (checked 3)"
  `);
  expect(plain.exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(ran)).toBeFalse();

  const production = await prune(dir, "--production");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/a-dep
    Removed 1 package (checked 2)"
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
    expect(out(omit.stdout)).toContain(
      linker === "hoisted" ? "- node_modules/no-deps" : "- node_modules/.bun/no-deps@",
    );
    expect(out(omit.stdout)).toEndWith(`Removed 1 package (checked ${linker === "hoisted" ? 2 : 3})`);
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
    - node_modules/junk
    Removed 1 package (checked 2)"
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

    const stale = await prune(dir);
    expect(out(stale.stdout)).toEndWith(NOTHING(3, 2));
    expect(out(stale.stderr)).toContain(WARN("node_modules/no-deps", "node_modules/one-dep/node_modules/no-deps"));
    expect(out(stale.stderr)).toContain(NOTE);
    expect(stale.exitCode).toBe(0);
    expect(existsSync(join(nested, "package.json"))).toBeTrue();
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });

    await install(dir);
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "1.0.1" });
    expect(existsSync(nested)).toBeTrue();

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/one-dep/node_modules/no-deps
      Removed 1 package (checked 3)"
    `);
    expect(stderr).not.toContain("warn:");
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

    const { stdout, stderr, exitCode } = await prune(dir, "--production");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      Done! Checked 3 packages across 2 folders (nothing to prune)"
    `);
    expect(out(stderr)).toContain(WARN("node_modules/no-deps", "node_modules/one-fixed-dep/node_modules/no-deps"));
    expect(out(stderr)).toContain(NOTE);
    expect(exitCode).toBe(0);
    expect(await file(nestedPkgJson).json()).toMatchObject({ version: "1.0.0" });
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });
    await runBunInstall(installEnv(dir), dir, { production: true });

    const silent = await prune(silentDir, "--production", "--silent");
    expect(silent.stdout).toBe("");
    expect(silent.stderr).not.toContain("warn:");
    expect(silent.stderr).not.toContain("note:");
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

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/one-dep/node_modules/junk
      Removed 1 package (checked 6)"
    `);
    expect(out(stderr)).toContain(WARN("node_modules/a-dep", "node_modules/one-dep/node_modules/a-dep"));
    expect(out(stderr)).toContain(NOTE);
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

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      Done! Checked 3 packages across 2 folders (nothing to prune)"
    `);
    expect(out(stderr)).toContain(WARN("node_modules/no-deps", "packages/a/node_modules/no-deps"));
    expect(out(stderr)).toContain(NOTE);
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
      - node_modules/what-bin
      Would remove 1 package (checked 4)"
    `);
    expect(dryRun.exitCode).toBe(0);
    expect(isSymlink(join(nm, "what-bin"))).toBeTrue();
    expectBinInstalled(nm, "what-bin");

    const { stdout, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/what-bin
      Removed 1 package (checked 4)"
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
    - node_modules/@scoped/has-bin-entry/node_modules/@other/thing
    - node_modules/no-deps/node_modules/junk
    Removed 2 packages (checked 4)"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(scopedJunk)).toBeFalse();
  expect(existsSync(join(nm, "@scoped", "has-bin-entry", "node_modules", "@other"))).toBeFalse();
  expect(existsSync(join(nm, "no-deps", "node_modules", "keep.txt"))).toBeTrue();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
  expect(existsSync(join(nm, "@scoped", "has-bin-entry", "package.json"))).toBeTrue();
});

// pnpm#8307
test.concurrent("refuses to prune a hoisted install with the isolated linker", async () => {
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
    expect(out(stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
    expect(stderr).toContain("node_modules was installed with the hoisted linker");
    expect(stderr).toContain("bun prune --linker hoisted");
    expect(exitCode).toBe(1);
    expect(existsSync(hoisted)).toBeTrue();
  }

  const same = await prune(dir, "--linker", "hoisted");
  expect(out(same.stdout)).toEndWith(NOTHING(2, 1));
  expect(same.exitCode).toBe(0);
});

// pnpm#8307
test.concurrent("refuses to prune an isolated install with the hoisted linker", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", devDependencies: { "one-dep": "1.0.0" } });
  const nm = join(dir, "node_modules");
  expect(isSymlink(join(nm, "one-dep"))).toBeTrue();

  const mismatch = await prune(dir, "--production", "--linker", "hoisted");
  expect(out(mismatch.stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
  expect(mismatch.stderr).toContain("node_modules was installed with the isolated linker");
  expect(mismatch.stderr).toContain("bun prune --linker isolated");
  expect(mismatch.exitCode).toBe(1);
  expect(isSymlink(join(nm, "one-dep"))).toBeTrue();
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();

  const same = await prune(dir, "--production", "--linker", "isolated");
  expect(out(same.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/.bun/no-deps@1.0.1
    - node_modules/.bun/one-dep@1.0.0
    Removed 2 packages (checked 3)"
  `);
  expect(same.exitCode).toBe(0);
  expect(() => lstatSync(join(nm, "one-dep"))).toThrow();
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
    expect(out(stdout)).toBe(
      linker === "hoisted"
        ? "bun prune <version> (<revision>)\n- node_modules/no-deps\nRemoved 1 package (checked 2)"
        : "bun prune <version> (<revision>)\n- node_modules/.bun/no-deps@2.0.0\nRemoved 1 package (checked 4)",
    );
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
    expect(out(stdout)).toBe(`bun prune <version> (<revision>)\n- ${linkFolder}/a\nRemoved 1 package (checked 3)`);
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
