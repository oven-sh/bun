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

async function prune(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "prune", ...args],
    env: bunEnv,
    cwd: dir,
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
  await runBunInstall(bunEnv, packageDir);
  return packageDir;
}

async function install(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    env: bunEnv,
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

// `--linker` is passed on the command line as well: an `install-strategy` in ~/.npmrc overrides the bunfig linker.
async function setupWithLinker(linker: Linker, pkgJson: Record<string, unknown>, bunfigOpts?: BunfigOpts) {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker, ...bunfigOpts } });
  await write(packageJson, JSON.stringify(pkgJson));
  await install(packageDir, "--linker", linker);
  return packageDir;
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
    Removed 3 packages"
  `);
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
  expect(out(second.stdout)).toEndWith("Nothing to prune.");
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
    Removed 1 package"
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
      Removed 3 packages"
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

    const { out: installOut } = await runBunInstall(bunEnv, dir, { production: true });
    expect(installOut).toContain("no changes");
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
    Removed 1 package"
  `);
  expect(production.exitCode).toBe(0);
  expect(existsSync(join(dir, "node_modules", "no-deps"))).toBeTrue();
  expect(existsSync(join(dir, "node_modules", "one-fixed-dep"))).toBeFalse();

  const plain = await prune(plainDir);
  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    Nothing to prune."
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
    Would remove 1 package"
  `);
  expect(dryRun.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();

  const clean = await prune(dir, "--dry-run");
  expect(out(clean.stdout)).toEndWith("Nothing to prune.");
  expect(clean.exitCode).toBe(0);
});

test.concurrent("nothing to prune when node_modules is missing or clean", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }
  const nm = join(packageDir, "node_modules");
  rmSync(nm, { recursive: true, force: true });
  expect(existsSync(join(packageDir, "bun.lock"))).toBeTrue();

  const missing = await prune(packageDir);
  expect(out(missing.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    Nothing to prune."
  `);
  expect(missing.exitCode).toBe(0);
  expect(existsSync(nm)).toBeFalse();

  const cleanDir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const clean = await prune(cleanDir, "--production");
  expect(out(clean.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    Nothing to prune."
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
    Removed 1 package"
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
  expect(help.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();
});

// pnpm#9796: --production never removes workspace links.
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
  await runBunInstall(bunEnv, dir);
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
    Removed 2 packages"
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
    Nothing to prune."
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
  symlinkSync("../zzz@1.0.0/node_modules/zzz", join(hiddenHoist, "zzz"));
  expect(isSymlink(join(hiddenHoist, "zzz"))).toBeTrue();
  const lockBefore = await lock(dir);

  const { stdout, exitCode } = await prune(dir, "--production");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/.bun/junk@1.0.0
    - node_modules/.bun/no-deps@1.0.1
    - node_modules/.bun/one-dep@1.0.0
    - node_modules/junk-real
    Removed 4 packages"
  `);
  expect(exitCode).toBe(0);

  expect(existsSync(join(store, "junk@1.0.0"))).toBeFalse();
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

  await runBunInstall(bunEnv, dir, { production: true });
});

test.concurrent("isolated linker + global store: unlinks the store link, never deletes the shared entry", async () => {
  const dir = await setup(
    { name: "foo", devDependencies: { "one-dep": "1.0.0" } },
    { linker: "isolated", globalStore: true },
  );
  const storeEntry = join(dir, "node_modules", ".bun", "one-dep@1.0.0");
  expect(isSymlink(storeEntry)).toBeTrue();
  const linksDir = join(dir, ".bun-cache", "links");
  const globalEntry = readdirSync(linksDir).find(name => name.startsWith("one-dep@1.0.0-"));
  expect(globalEntry).toBeDefined();
  const globalPkgJson = join(linksDir, globalEntry!, "node_modules", "one-dep", "package.json");
  expect(existsSync(globalPkgJson)).toBeTrue();

  const { stdout, exitCode } = await prune(dir, "--production");
  expect(out(stdout)).toContain("- node_modules/.bun/one-dep@1.0.0");
  expect(out(stdout)).toContain("Removed 2 packages");
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
  expect(out(stdout)).toContain("- node_modules/.bun/what-bin@1.0.0");
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
    Removed 1 package"
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
    Nothing to prune."
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
    Removed 2 packages"
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
    Removed 1 package"
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
    Removed 2 packages"
  `);
  expect(first.exitCode).toBe(0);
  expect(() => lstatSync(join(nm, "ext"))).toThrow();
  expect(existsSync(join(nm, "@ext"))).toBeFalse();
  expect(existsSync(join(outside, "keep.txt"))).toBeTrue();
  expect(existsSync(join(scopedOutside, "keep.txt"))).toBeTrue();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();

  const second = await prune(dir, "--linker", "isolated");
  expect(out(second.stdout)).toEndWith("Nothing to prune.");
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
    Removed 2 packages"
  `);
    expect(exitCode).toBe(0);
    expect(existsSync(join(nm, "one-dep"))).toBeFalse();
    expect(existsSync(join(nm, "@scoped"))).toBeFalse();
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
    expectBinRemoved(nm, "has-bin-entry");
    const { out: installOut } = await runBunInstall(bunEnv, dir, { savesLockfile: false });
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
    Removed 1 package"
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
    Removed 3 packages"
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
    Removed 1 package"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(nested)).toBeFalse();
  expect(isSymlink(join(nm, "a"))).toBeTrue();
  expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
  await runBunInstall(bunEnv, dir, { production: true });
});

test.concurrent(
  "isolated + workspaces: --production prunes a workspace's registry devDependency, keeps workspace links",
  async () => {
    const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await Promise.all([
      write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
      write(
        join(dir, "packages", "app", "package.json"),
        JSON.stringify({
          name: "app",
          version: "1.0.0",
          dependencies: { lib: "workspace:*", "no-deps": "1.0.0" },
          devDependencies: { tool: "workspace:*", "a-dep": "1.0.1" },
        }),
      ),
      write(join(dir, "packages", "lib", "package.json"), JSON.stringify({ name: "lib", version: "1.0.0" })),
      write(join(dir, "packages", "tool", "package.json"), JSON.stringify({ name: "tool", version: "1.0.0" })),
    ]);
    await install(dir, "--linker", "isolated");
    const appNm = join(dir, "packages", "app", "node_modules");
    expect(existsSync(join(dir, "node_modules", ".bun"))).toBeTrue();
    expect(isSymlink(join(appNm, "a-dep"))).toBeTrue();
    expect(isSymlink(join(appNm, "tool"))).toBeTrue();

    const { stdout, exitCode } = await prune(join(dir, "packages", "app"), "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/.bun/a-dep@1.0.1
    Removed 1 package"
  `);
    expect(exitCode).toBe(0);
    expect(() => lstatSync(join(appNm, "a-dep"))).toThrow();
    expect(existsSync(join(appNm, "no-deps", "package.json"))).toBeTrue();
    expect(existsSync(join(appNm, "lib", "package.json"))).toBeTrue();
    // Diverges from pnpm on purpose: an alias that names a workspace is never removed.
    expect(existsSync(join(appNm, "tool", "package.json"))).toBeTrue();
    expect(existsSync(join(dir, "packages", "tool", "package.json"))).toBeTrue();
    await runBunInstall(bunEnv, dir, { production: true });
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
    const removed = (name: string) => (linker === "hoisted" ? `- node_modules/${name}` : `- node_modules/.bun/${name}`);

    const production = await prune(prodDir, "--production", "--linker", linker);
    expect(out(production.stdout)).toBe(
      `bun prune <version> (<revision>)\n${removed(linker === "hoisted" ? "one-fixed-dep" : "one-fixed-dep@1.0.0")}\nRemoved 1 package`,
    );
    expect(production.exitCode).toBe(0);
    expect(existsSync(join(prodDir, "node_modules", "a-dep", "package.json"))).toBeTrue();
    expect(existsSync(join(prodDir, "node_modules", "no-deps", "package.json"))).toBeTrue();

    const omit = await prune(omitDir, "--omit=optional", "--linker", linker);
    expect(out(omit.stdout)).toBe(
      `bun prune <version> (<revision>)\n${removed(linker === "hoisted" ? "a-dep" : "a-dep@1.0.1")}\nRemoved 1 package`,
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
    expect(out(host.stdout)).toEndWith("Nothing to prune.");
    expect(host.exitCode).toBe(0);
    expect(existsSync(native)).toBeTrue();

    const other = await prune(dir, flag);
    expect(out(other.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)
      - node_modules/test-postinstall-skip-native
      Removed 1 package"
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
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/junk
    Removed 1 package"
  `);
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
  expect(out(clean.stdout)).toEndWith("Nothing to prune.");
  expect(clean.exitCode).toBe(0);

  const production = await prune(dir, "--production", "--linker", "isolated");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/.bun/no-deps@1.0.1
    - node_modules/.bun/one-dep@1.0.0
    Removed 2 packages"
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
      Removed 1 package"
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
    Removed 1 package"
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
    Removed 1 package"
  `);
  expect(plain.exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(ran)).toBeFalse();

  const production = await prune(dir, "--production");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/a-dep
    Removed 1 package"
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
    expect(out(omit.stdout)).toEndWith("Removed 1 package");
    expect(omit.exitCode).toBe(0);
    expect(installedNoDeps()).toBeFalse();
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    expect(existsSync(join(nm, "peer-deps-fixed", "package.json"))).toBeTrue();
    if (linker === "hoisted") {
      expect(await install(dir, "--omit=peer")).toContain("no changes");
    }

    const plain = await prune(plainDir, "--linker", linker);
    expect(out(plain.stdout)).toEndWith("Nothing to prune.");
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
  await runBunInstall(bunEnv, dir);
  const inner = join(dir, "node_modules", "local", "node_modules", "inner", "package.json");
  expect(existsSync(inner)).toBeTrue();
  const junk = plant(dir, "node_modules/junk");

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/junk
    Removed 1 package"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(junk)).toBeFalse();
  expect(existsSync(inner)).toBeTrue();
});

// pnpm#13676
test.concurrent("hoisted: a nested copy left behind after its dependency started hoisting is removed", async () => {
  const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } });
  const nm = join(dir, "node_modules");
  const nested = join(nm, "one-dep", "node_modules", "no-deps");
  expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.1" });

  await write(
    join(dir, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "1.0.1" } }),
  );
  await install(dir, "--lockfile-only");
  expect(existsSync(nested)).toBeTrue();

  const { stdout, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)
    - node_modules/one-dep/node_modules/no-deps
    Removed 1 package"
  `);
  expect(exitCode).toBe(0);
  expect(existsSync(nested)).toBeFalse();
  expect(existsSync(join(nm, "one-dep", "package.json"))).toBeTrue();
  expect(existsSync(join(nm, "no-deps", "package.json"))).toBeTrue();
});

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
    Removed 2 packages"
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
  expect(out(same.stdout)).toEndWith("Nothing to prune.");
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
    Removed 2 packages"
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
      `bun prune <version> (<revision>)\n- ${linker === "hoisted" ? "node_modules/no-deps" : "node_modules/.bun/no-deps@2.0.0"}\nRemoved 1 package`,
    );
    expect(exitCode).toBe(0);
    expect(() => lstatSync(join(nm, "no-deps"))).toThrow();
    expect(await file(join(nm, "aliased", "package.json")).json()).toMatchObject({ version: "1.0.0" });
    if (linker === "isolated") {
      expect(existsSync(join(nm, ".bun", "no-deps@1.0.0"))).toBeTrue();
    }
    await runBunInstall(bunEnv, dir, { production: true });
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
    expect(out(stdout)).toBe(`bun prune <version> (<revision>)\n- ${linkFolder}/a\nRemoved 1 package`);
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
