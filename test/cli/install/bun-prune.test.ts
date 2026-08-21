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
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const registry = new VerdaccioRegistry();

// Every registry package some test here installs. beforeAll installs them once into `sharedCache`; from then on every
// `bun install` in this file is served from that cache and never talks to the registry, which under ASAN runs on the
// build under test and is by far the slowest part of this file. The last test checks that the cache is still exactly
// this set: a package fetched during the run is one that concurrent tests could race each other to write.
const registryPackages = [
  "@scoped/has-bin-entry@1.0.0",
  "a-dep@1.0.1",
  "a-dep@1.0.2",
  "bundled-transitive@1.0.0",
  "left-pad@1.0.0",
  "no-deps@1.0.0",
  "no-deps@1.0.1",
  "no-deps@1.1.0",
  "no-deps@2.0.0",
  "no-deps-bins@1.0.0",
  "no-deps-build-metadata@1.0.0",
  "one-dep@1.0.0",
  "one-fixed-dep@1.0.0",
  "one-fixed-dep-bins@1.0.0",
  "optional-peer-deps@1.0.0",
  "peer-deps-fixed@1.0.0",
  "test-postinstall-skip-native@1.0.0",
  "uses-what-bin@1.0.0",
  "what-bin@1.0.0",
];
let sharedCache: string;
let sharedCacheEntries: string[];
// Projects whose installs write to the cache (git and tarball dependencies, the global store) get a cache of their own.
const ownCache = new Set<string>();

beforeAll(async () => {
  await registry.start();
  sharedCache = String(tempDir("bun-prune-cache", {}));
  const dependencies = Object.fromEntries(registryPackages.map((pkg, i) => [`dep${i}`, `npm:${pkg}`]));
  await install(await project({}, { "package.json": JSON.stringify({ name: "warm-up", dependencies }) }));
  sharedCacheEntries = readdirSync(sharedCache).toSorted();
});

afterAll(() => {
  registry.stop();
});

// CI exports BUN_INSTALL_CACHE_DIR, which would override the bunfig; this file decides the cache per project instead.
const installEnv = (dir: string) => ({
  ...bunEnv,
  BUN_INSTALL_CACHE_DIR: ownCache.has(dir) ? join(dir, ".bun-cache") : sharedCache,
});

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
  `Done! Checked ${plural(packages, "package")} across ${plural(folders, "folder")} (nothing to prune)`;
const REMOVED = (n: number, checked: number) => `${plural(n, "package")} removed (checked ${checked})`;
const CAN_BE_REMOVED = (n: number, checked: number) => `${plural(n, "package")} can be removed (checked ${checked})`;
// The copy-pasteable line `--dry-run` prints last: the invocation with `--dry-run` taken out.
const APPLY_HINT = (...flags: string[]) => ["  bun prune", ...flags].join(" ");
const DURATION = /\) \[\d+(\.\d+)?m?s\]$/m;
type Linker = "hoisted" | "isolated";
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

type Listing = Record<string, string[]>;

// Everything prune can touch, by folder: the root node_modules, each workspace's, the nested ones, the isolated store
// and its hidden hoist folder. Scope dirs and .bin are flattened into their folder's entries, so a scope dir or .bin
// left behind empty lists as a bare entry, and an emptied folder lists as []. Links are marked, dangling ones as such.
// On Windows a bin is a `<name>.exe` + `<name>.bunx` shim pair instead of a link; bins list by name everywhere.
function tree(dir: string): Listing {
  const listing: Listing = {};
  const folders = ["node_modules"];
  if (existsSync(join(dir, "packages"))) {
    folders.push(...readdirSync(join(dir, "packages")).map(workspace => `packages/${workspace}/node_modules`));
  }
  for (const folder of folders) {
    if (lstatSync(join(dir, folder), { throwIfNoEntry: false })?.isDirectory()) {
      listFolder(dir, folder, listing);
    }
  }
  for (const entries of Object.values(listing)) {
    entries.sort();
  }
  return listing;
}

function listFolder(dir: string, folder: string, listing: Listing, scope = "") {
  const entries = (listing[folder] ??= []);
  for (const entry of readdirSync(join(dir, folder, scope), { withFileTypes: true })) {
    const name = scope + entry.name;
    const path = join(dir, folder, name);
    if (entry.isSymbolicLink()) {
      entries.push(`${name} ${existsSync(path) ? "(link)" : "(dangling link)"}`);
    } else if (!entry.isDirectory()) {
      entries.push(name);
    } else if (scope === "" && name === ".bin") {
      const bins = new Set(readdirSync(path).map(bin => (isWindows ? bin.replace(/\.(exe|bunx)$/, "") : bin)));
      entries.push(...(bins.size === 0 ? [".bin"] : [...bins].map(bin => `.bin/${bin}`)));
    } else if (scope === "" && name === ".bun") {
      const store = (listing[`${folder}/.bun`] = []);
      for (const child of readdirSync(path, { withFileTypes: true })) {
        if (child.name === "node_modules") {
          listFolder(dir, `${folder}/.bun/node_modules`, listing);
        } else {
          store.push(child.isSymbolicLink() ? `${child.name} (link)` : child.name);
        }
      }
    } else if (scope === "" && name.startsWith("@")) {
      const before = entries.length;
      listFolder(dir, folder, listing, `${name}/`);
      if (entries.length === before) {
        entries.push(name);
      }
    } else {
      entries.push(name);
      if (existsSync(join(path, "node_modules"))) {
        listFolder(dir, `${folder}/${name}/node_modules`, listing);
      }
    }
  }
}

function expectOk({ stderr, exitCode }: { stderr: string; exitCode: number }) {
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}

type BunfigOpts = NonNullable<Parameters<VerdaccioRegistry["writeBunfig"]>[1]>;
type Files = Record<string, string>;

async function project(bunfigOpts: BunfigOpts, files: Files, { own = false } = {}) {
  const dir = String(tempDir("bun-prune", files));
  await registry.writeBunfig(dir, bunfigOpts);
  if (own) {
    ownCache.add(dir);
  }
  return dir;
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

const templates = new Map<string, Promise<string>>();

// Each distinct starting tree is installed once; every test that starts from it gets its own copy. A copy is a few
// syscalls where an install is another bun process, and about a third of the setups in this file repeat a tree that
// some other test starts from as well.
async function installed(bunfig: BunfigOpts, files: Files) {
  const key = JSON.stringify([bunfig, files]);
  let template = templates.get(key);
  if (!template) {
    template = project(bunfig, files).then(async dir => {
      await install(dir);
      return dir;
    });
    templates.set(key, template);
  }
  const dir = String(tempDir("bun-prune", {}));
  copyTree(await template, dir);
  return dir;
}

// bun links with relative targets, which a verbatim copy keeps pointing inside the copy. When Windows denies symlinks
// bun falls back to junctions, whose targets are absolute (read back with a `\\?\` prefix): those are re-pointed from
// the template into the copy.
function copyTree(template: string, copy: string) {
  const copyDir = (from: string, to: string) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.isSymbolicLink()) {
        const link = readlinkSync(source);
        if (isAbsolute(link)) {
          symlinkSync(join(copy, relative(template, link.replace(/^\\\\\?\\/, ""))), target, "junction");
        } else {
          symlinkSync(link, target, statSync(source, { throwIfNoEntry: false })?.isDirectory() ? "dir" : "file");
        }
      } else if (entry.isDirectory()) {
        mkdirSync(target);
        copyDir(source, target);
      } else {
        copyFileSync(source, target);
      }
    }
  };
  copyDir(template, copy);
}

function setup(pkgJson: Record<string, unknown>, bunfig: BunfigOpts = {}) {
  return installed(bunfig, { "package.json": JSON.stringify(pkgJson) });
}

function setupWithLinker(linker: Linker, pkgJson: Record<string, unknown>, bunfig: BunfigOpts = {}) {
  return installed({ linker, ...bunfig }, { "package.json": JSON.stringify(pkgJson) });
}

type Workspaces = { root?: Record<string, unknown>; packages: Record<string, Record<string, unknown>> };

function workspaceFiles({ root, packages }: Workspaces): Files {
  return {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], ...root }),
    ...Object.fromEntries(
      Object.entries(packages).map(([folder, pkg]) => [
        `packages/${folder}/package.json`,
        JSON.stringify({ name: folder, version: "1.0.0", ...pkg }),
      ]),
    ),
  };
}

function writeWorkspaces(dir: string, workspaces: Workspaces) {
  return Promise.all(Object.entries(workspaceFiles(workspaces)).map(([path, text]) => write(join(dir, path), text)));
}

function setupWorkspaces(linker: Linker, workspaces: Workspaces) {
  return installed({ linker }, workspaceFiles(workspaces));
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
  expect(lstatSync(link).isSymbolicLink()).toBeTrue();
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

const storeEntries = (dir: string) => tree(dir)["node_modules/.bun"];

// Where the isolated store's hidden hoist link for `name` points; only the store entry named in it is of interest.
const hiddenHoistTarget = (dir: string, name: string) =>
  readlinkSync(join(dir, "node_modules", ".bun", "node_modules", name));

test.concurrent("removes extraneous packages, keeps everything the lockfile installs", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" },
  });
  plant(dir, "node_modules/junk");
  plant(dir, "node_modules/@scoped/junk");
  plant(dir, "node_modules/@other/thing");
  writeFileSync(join(dir, "node_modules", "README.txt"), "");
  plant(dir, "node_modules/.cache/x");
  const lockBefore = await lock(dir);
  expect(tree(dir)).toEqual({
    "node_modules": [
      ".bin/has-bin-entry",
      ".cache",
      "@other/thing",
      "@scoped/has-bin-entry",
      "@scoped/junk",
      "README.txt",
      "junk",
      "no-deps",
    ],
  });

  const first = await prune(dir);
  expect(out(first.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @other/thing
    - @scoped/junk
    - junk
    3 packages removed (checked 5)"
  `);
  expect(first.stdout).toMatch(/\(checked 5\) \[\d+(\.\d+)?m?s\]\n?$/);
  expectOk(first);
  // The emptied @other scope dir goes with its package; files and dot entries are not packages.
  const pruned = { "node_modules": [".bin/has-bin-entry", ".cache", "@scoped/has-bin-entry", "README.txt", "no-deps"] };
  expect(tree(dir)).toEqual(pruned);
  expect(await lock(dir)).toBe(lockBefore);

  const second = await prune(dir);
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expect(second.stdout).toMatch(/\(nothing to prune\) \[\d+(\.\d+)?m?s\]\n?$/);
  expectOk(second);
  expect(tree(dir)).toEqual(pruned);
});

test.concurrent("prunes nested node_modules folders the tree installs into", async () => {
  const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } });
  const nested = join(dir, "node_modules", "one-dep", "node_modules", "no-deps");
  expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.1" });
  plant(dir, "node_modules/one-dep/node_modules/junk");
  expect(tree(dir)).toEqual({
    "node_modules": ["no-deps", "one-dep"],
    "node_modules/one-dep/node_modules": ["junk", "no-deps"],
  });

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/one-dep/node_modules)
    1 package removed (checked 4)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": ["no-deps", "one-dep"],
    "node_modules/one-dep/node_modules": ["no-deps"],
  });
});

test.concurrent.each([["--production"], ["--prod"], ["--omit=dev"]])(
  "%s removes packages only reachable through devDependencies",
  async (...flags: string[]) => {
    const dir = await setup({
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" },
      devDependencies: { "one-fixed-dep-bins": "1.0.0", "what-bin": "1.0.0" },
    });
    // no-deps-bins' tarball lacks its bin file and bun install skips bin links whose target is missing.
    expect(tree(dir)).toEqual({
      "node_modules": [
        ".bin/has-bin-entry",
        ".bin/what-bin",
        "@scoped/has-bin-entry",
        "no-deps",
        "no-deps-bins",
        "one-fixed-dep-bins",
        "what-bin",
      ],
    });
    const lockBefore = await lock(dir);

    const result = await prune(dir, ...flags);
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps-bins@1.0.0
      - one-fixed-dep-bins@1.0.0
      - what-bin@1.0.0
      3 packages removed (checked 5)"
    `);
    expectOk(result);
    // pnpm#2326: bins of removed packages are cleaned up, on Windows too (shim files instead of links).
    const pruned = { "node_modules": [".bin/has-bin-entry", "@scoped/has-bin-entry", "no-deps"] };
    expect(tree(dir)).toEqual(pruned);

    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(pruned);
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
  // one-fixed-dep needs no-deps@1.0.0 too, so the root copy serves both and nothing is nested.
  const installed = { "node_modules": ["no-deps", "one-fixed-dep"] };
  expect(tree(dir)).toEqual(installed);

  const production = await prune(dir, "--production");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - one-fixed-dep@1.0.0
    1 package removed (checked 2)"
  `);
  expectOk(production);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });

  const plain = await prune(plainDir);
  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 2 packages across 1 folder (nothing to prune)"
  `);
  expectOk(plain);
  expect(tree(plainDir)).toEqual(installed);
});

test.concurrent("--dry-run prints without deleting; --silent deletes without printing", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  plant(dir, "node_modules/junk");
  const planted = { "node_modules": ["junk", "no-deps"] };

  const dryRun = await prune(dir, "--dry-run");
  expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package can be removed (checked 2)
      bun prune"
  `);
  expect(dryRun.stdout).toMatch(DURATION);
  expectOk(dryRun);
  expect(tree(dir)).toEqual(planted);

  const withFlags = await prune(dir, "--dry-run", "--linker", "hoisted", "--dry-run");
  expect(lines(withFlags.stdout)).toStrictEqual([
    BANNER,
    "",
    "- junk",
    CAN_BE_REMOVED(1, 2),
    APPLY_HINT("--linker", "hoisted"),
  ]);
  expectOk(withFlags);
  expect(tree(dir)).toEqual(planted);

  const silentDryRun = await prune(dir, "--dry-run", "--silent");
  expect(silentDryRun.stdout).toBe("");
  expectOk(silentDryRun);
  expect(tree(dir)).toEqual(planted);

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expectOk(silent);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });

  const clean = await prune(dir, "--dry-run");
  expect(lines(clean.stdout)).toStrictEqual([BANNER, "", NOTHING(1, 1)]);
  expectOk(clean);
});

test.concurrent("nothing to prune when node_modules is missing or clean", async () => {
  const pkgJson = { name: "foo", dependencies: { "no-deps": "1.0.0" } };
  const [lockOnlyDir, cleanDir] = await Promise.all([
    project({ linker: "hoisted" }, { "package.json": JSON.stringify(pkgJson) }),
    setup(pkgJson),
  ]);
  await install(lockOnlyDir, "--lockfile-only");
  expect(existsSync(join(lockOnlyDir, "bun.lock"))).toBeTrue();
  expect(tree(lockOnlyDir)).toEqual({});

  const missing = await prune(lockOnlyDir);
  expect(out(missing.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! No node_modules folder (nothing to prune)"
  `);
  expectOk(missing);
  expect(tree(lockOnlyDir)).toEqual({});

  const clean = await prune(cleanDir, "--production");
  expect(out(clean.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 1 package across 1 folder (nothing to prune)"
  `);
  expectOk(clean);
  expect(tree(cleanDir)).toEqual({ "node_modules": ["no-deps"] });
});

test.concurrent("never follows symlinks out of node_modules", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const outside = join(dir, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep");
  symlinkSync(outside, join(dir, "node_modules", "linked-junk"), "junction");
  expect(tree(dir)).toEqual({ "node_modules": ["linked-junk (link)", "no-deps"] });

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - linked-junk
    1 package removed (checked 2)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
  expect(existsSync(join(outside, "keep.txt"))).toBeTrue();
});

test.concurrent("refuses to run without a lockfile", async () => {
  const pkgJson = { name: "foo", dependencies: { "no-deps": "1.0.0" } };
  const [noLockDir, installedDir] = await Promise.all([
    project({ linker: "hoisted" }, { "package.json": JSON.stringify(pkgJson) }),
    setup(pkgJson),
  ]);
  plant(noLockDir, "node_modules/junk");
  const planted = { "node_modules": ["junk"] };

  const noLock = await prune(noLockDir);
  expect(normalizeBunSnapshot(noLock.stderr)).toMatchInlineSnapshot(`
    "error: missing lockfile, nothing to prune
    note: run 'bun install' first"
  `);
  expect(out(noLock.stdout)).toBe(BANNER);
  expect(noLock.exitCode).toBe(1);
  expect(tree(noLockDir)).toEqual(planted);

  const silentNoLock = await prune(noLockDir, "--silent");
  expect(silentNoLock.stdout).toBe("");
  expect(silentNoLock.stderr).toBe("");
  expect(silentNoLock.exitCode).toBe(1);
  expect(tree(noLockDir)).toEqual(planted);

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
  expect(tree(installedDir)).toEqual({ "node_modules": ["no-deps"] });

  const help = await prune(noLockDir, "--help");
  expect(out(help.stdout)).toStartWith("Usage: bun prune [flags]");
  expectOk(help);
  expect(tree(noLockDir)).toEqual(planted);
});

// pnpm#9796: hoisted keeps the root's workspace links under --production because they are root->workspace prod edges; the isolated per-importer dev link case is below.
test.concurrent("workspaces: prunes workspace folders, keeps workspace links, runs from the root", async () => {
  const dir = await setupWorkspaces("hoisted", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } } },
  });
  plant(dir, "packages/a/node_modules/junk");
  expect(tree(dir)).toEqual({
    "node_modules": ["a (link)", "a-dep", "no-deps"],
    "packages/a/node_modules": ["junk", "no-deps"],
  });

  const result = await prune({ dir, cwd: join(dir, "packages", "a") }, "--production");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    - junk (node_modules/a/node_modules)
    2 packages removed (checked 5)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": ["a (link)", "no-deps"],
    "packages/a/node_modules": ["no-deps"],
  });
});

test.concurrent("keeps dependencies bundled inside a package", async () => {
  const dir = await setup({ name: "foo", dependencies: { "bundled-transitive": "1.0.0" } });
  const installed = {
    "node_modules": ["bundled-transitive", "no-deps", "one-dep"],
    "node_modules/bundled-transitive/node_modules": ["no-deps"],
  };
  expect(tree(dir)).toEqual(installed);

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 3 packages across 1 folder (nothing to prune)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual(installed);
});

// pnpm#881: --production also removes dev-only entries from the store.
test.concurrent("isolated linker: removes unused store entries and their links", async () => {
  const dir = await setup(
    { name: "foo", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } },
    { linker: "isolated" },
  );
  plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
  plant(dir, "node_modules/.bun/no-deps@1.0.0+0123456789abcdef/node_modules/no-deps");
  plant(dir, "node_modules/junk-real");
  const zzz = plant(dir, "node_modules/.bun/zzz@1.0.0/node_modules/zzz");
  symlinkSync(zzz, join(dir, "node_modules", ".bun", "node_modules", "zzz"), "junction");
  expect(tree(dir)).toEqual({
    "node_modules": ["junk-real", "no-deps (link)", "one-dep (link)"],
    "node_modules/.bun": [
      "junk@1.0.0",
      "no-deps@1.0.0",
      "no-deps@1.0.0+0123456789abcdef",
      "no-deps@1.0.1",
      "one-dep@1.0.0",
      "zzz@1.0.0",
    ],
    "node_modules/.bun/node_modules": ["no-deps (link)", "one-dep (link)", "zzz (link)"],
  });
  const lockBefore = await lock(dir);

  const result = await prune(dir, "--production");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk@1.0.0
    - junk-real
    - no-deps@1.0.0+0123456789abcdef
    - no-deps@1.0.1
    - one-dep@1.0.0
    - zzz@1.0.0
    6 packages removed (checked 9)"
  `);
  expectOk(result);
  // The hidden hoist links of removed entries go too; the store's hidden node_modules itself stays.
  const pruned = {
    "node_modules": ["no-deps (link)"],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
  };
  expect(tree(dir)).toEqual(pruned);
  expect(await lock(dir)).toBe(lockBefore);

  await expectProductionInstallIsNoop(dir);
  expect(tree(dir)).toEqual(pruned);
});

test.concurrent("isolated linker: --verbose does not print the store build timings", async () => {
  const dir = await setup(
    { name: "foo", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } },
    { linker: "isolated" },
  );

  // `--production` makes prune build the store twice (once with every
  // dependency type, once with the production set); `bun install --verbose`
  // prints a timing line per store build, prune must print none.
  const result = await prune(dir, "--production", "--verbose");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 5)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": ["no-deps (link)"],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
  });
});

test.concurrent("isolated linker: prune removes the peer-hash variants a peer bump left behind", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" },
  });
  const peerEntries = () => storeEntries(dir).filter(entry => entry.startsWith("peer-deps-fixed@"));
  const [before] = peerEntries();
  expect(before).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
  const linked = ["no-deps (link)", "peer-deps-fixed (link)"];
  expect(tree(dir)).toEqual({
    "node_modules": linked,
    "node_modules/.bun": ["no-deps@1.0.0", before],
    "node_modules/.bun/node_modules": linked,
  });

  await write(
    join(dir, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.1" } }),
  );
  await install(dir, "--linker", "isolated");
  const variants = peerEntries();
  expect(variants).toHaveLength(2);
  expect(variants).toContain(before);
  const after = variants.find(entry => entry !== before)!;
  // bun install relinks but leaves the entries the old peer set produced in the store.
  expect(tree(dir)).toEqual({
    "node_modules": linked,
    "node_modules/.bun": ["no-deps@1.0.0", "no-deps@1.0.1", ...variants],
    "node_modules/.bun/node_modules": linked,
  });

  const result = await prune(dir, "--linker", "isolated");
  expect(lines(result.stdout)).toStrictEqual([BANNER, "", "- no-deps@1.0.0", `- ${before}`, REMOVED(2, 6)]);
  expectOk(result);
  const pruned = {
    "node_modules": linked,
    "node_modules/.bun": ["no-deps@1.0.1", after],
    "node_modules/.bun/node_modules": linked,
  };
  expect(tree(dir)).toEqual(pruned);
  expect(await install(dir, "--linker", "isolated")).toContain("no changes");
  expect(tree(dir)).toEqual(pruned);
});

test.concurrent("isolated linker + global store: unlinks the store link, never deletes the shared entry", async () => {
  const dir = await project(
    { linker: "isolated", globalStore: true },
    { "package.json": JSON.stringify({ name: "foo", devDependencies: { "one-dep": "1.0.0" } }) },
    { own: true },
  );
  await install(dir);
  // With the global store, each store entry is a link into the cache's shared entry for that package.
  expect(tree(dir)).toEqual({
    "node_modules": ["one-dep (link)"],
    "node_modules/.bun": ["no-deps@1.0.1 (link)", "one-dep@1.0.0 (link)"],
    "node_modules/.bun/node_modules": ["no-deps (link)", "one-dep (link)"],
  });
  const linksDir = join(installEnv(dir).BUN_INSTALL_CACHE_DIR, "links");
  const globalEntries = readdirSync(linksDir).toSorted();
  expect(globalEntries).toEqual([
    expect.stringMatching(/^no-deps@1\.0\.1-/),
    expect.stringMatching(/^one-dep@1\.0\.0-/),
  ]);
  const globalPkgJson = join(linksDir, globalEntries[1], "node_modules", "one-dep", "package.json");
  expect(await file(globalPkgJson).json()).toMatchObject({ name: "one-dep", version: "1.0.0" });

  const result = await prune(dir, "--production");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 3)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": [],
    "node_modules/.bun": [],
    "node_modules/.bun/node_modules": [],
  });
  expect(readdirSync(linksDir).toSorted()).toEqual(globalEntries);
  expect(await file(globalPkgJson).json()).toMatchObject({ name: "one-dep", version: "1.0.0" });
});

test.concurrent("isolated linker: bins of removed packages are removed, live ones kept", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { "@scoped/has-bin-entry": "1.0.0" },
    devDependencies: { "what-bin": "1.0.0" },
  });
  expect(tree(dir)).toEqual({
    "node_modules": [".bin/has-bin-entry", ".bin/what-bin", "@scoped/has-bin-entry (link)", "what-bin (link)"],
    "node_modules/.bun": ["@scoped+has-bin-entry@1.0.0", "what-bin@1.0.0"],
    "node_modules/.bun/node_modules": ["@scoped/has-bin-entry (link)", "what-bin (link)"],
  });

  const result = await prune(dir, "--production", "--linker", "isolated");
  expect(lines(result.stdout)).toStrictEqual([BANNER, "", "- what-bin@1.0.0", REMOVED(1, 4)]);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": [".bin/has-bin-entry", "@scoped/has-bin-entry (link)"],
    "node_modules/.bun": ["@scoped+has-bin-entry@1.0.0"],
    "node_modules/.bun/node_modules": ["@scoped/has-bin-entry (link)"],
  });
});

test.concurrent("hoisted: dot entries and files are never touched even when the lockfile is empty", async () => {
  const dir = await project(
    { linker: "hoisted" },
    {
      "package.json": JSON.stringify({ name: "empty" }),
      "bun.lock": `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "empty",
    },
  },
  "packages": {}
}
`,
      "node_modules/.yarn-integrity": "",
    },
  );
  plant(dir, "node_modules/junk");
  plant(dir, "node_modules/.bun/node_modules/whatever");
  plant(dir, "node_modules/.cache/whatever@1.0.0");

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 1)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": [".cache", ".yarn-integrity"],
    "node_modules/.bun": [],
    "node_modules/.bun/node_modules": ["whatever"],
  });
});

// A hoisted prune over a tree whose store still holds entries would report the store as checked without looking at it.
test.concurrent(
  "hoisted: refuses up front when node_modules/.bun holds store entries, even with nothing to remove",
  async () => {
    const dir = await setupWithLinker("isolated", { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const installed = {
      "node_modules": ["no-deps (link)"],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
    };
    expect(tree(dir)).toEqual(installed);

    for (const flags of [
      ["--linker", "hoisted"],
      ["--linker", "hoisted", "--dry-run"],
      ["--linker", "hoisted", "--production"],
    ]) {
      const { stdout, stderr, exitCode } = await prune(dir, ...flags);
      expect(out(stdout)).toBe(BANNER);
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
      note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
    `);
      expect(exitCode).toBe(1);
    }
    const silent = await prune(dir, "--linker", "hoisted", "--silent");
    expect(silent.stdout).toBe("");
    expect(silent.stderr).toBe("");
    expect(silent.exitCode).toBe(1);
    expect(tree(dir)).toEqual(installed);

    const same = await prune(dir, "--linker", "isolated");
    expect(lines(same.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 2)]);
    expectOk(same);
    expect(tree(dir)).toEqual(installed);
  },
);

test.concurrent(
  "hoisted: a nested tree owned by a package that was replaced with a symlink is not walked",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } });
    expect(tree(dir)).toEqual({
      "node_modules": ["no-deps", "one-dep"],
      "node_modules/one-dep/node_modules": ["no-deps"],
    });
    rmSync(join(dir, "node_modules", "one-dep"), { recursive: true });
    const outside = linkOutside(dir, "node_modules/one-dep", {
      "package.json": JSON.stringify({ name: "one-dep", version: "1.0.0" }),
    });
    plant(outside, "node_modules/no-deps");
    plant(outside, "node_modules/keep-me");
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps", "one-dep (link)"] });

    const result = await prune(dir);
    expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 2 packages across 1 folder (nothing to prune)"
  `);
    expectOk(result);
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps", "one-dep (link)"] });
    expect(readdirSync(join(outside, "node_modules")).toSorted()).toEqual(["keep-me", "no-deps"]);
  },
);

test.concurrent("hoisted: a symlinked scope dir is unlinked, not followed", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const outside = linkOutside(dir, "node_modules/@fake");
  plant(outside, "thing");
  plant(dir, "node_modules/@real/junk");
  expect(tree(dir)).toEqual({ "node_modules": ["@fake (link)", "@real/junk", "no-deps"] });

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @fake
    - @real/junk
    2 packages removed (checked 3)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
  expect(readdirSync(outside)).toEqual(["thing"]);
});

test.concurrent(
  "hoisted: a workspace's nested folder is pruned where bun.lock says the workspace is, not through node_modules/<name>",
  async () => {
    const dir = await setupWorkspaces("hoisted", {
      root: { dependencies: { "no-deps": "2.0.0" } },
      packages: { a: { dependencies: { "no-deps": "1.0.0" } } },
    });
    plant(dir, "packages/a/node_modules/junk");
    expect(tree(dir)).toEqual({
      "node_modules": ["a (link)", "no-deps"],
      "packages/a/node_modules": ["junk", "no-deps"],
    });

    // `bun link a` run from another checkout leaves node_modules/a pointing at that checkout, which has a node_modules of its own.
    rmSync(join(dir, "node_modules", "a"));
    const other = linkOutside(dir, "node_modules/a", {
      "package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    });
    plant(other, "node_modules/victim");
    plant(other, "node_modules/no-deps");

    const dryRun = await prune(dir, "--dry-run", "--linker", "hoisted");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/a/node_modules)
      1 package can be removed (checked 4)
        bun prune --linker hoisted"
    `);
    expectOk(dryRun);

    // bun.lock records workspace folders relative to the root; prune chdirs there first, so running it from inside a workspace resolves them the same way.
    const result = await prune({ dir, cwd: join(dir, "packages", "a") }, "--linker", "hoisted");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/a/node_modules)
      1 package removed (checked 4)"
    `);
    expectOk(result);
    expect(tree(dir)).toEqual({
      "node_modules": ["a (link)", "no-deps"],
      "packages/a/node_modules": ["no-deps"],
    });
    expect(readdirSync(join(other, "node_modules")).toSorted()).toEqual(["no-deps", "victim"]);
  },
);

test.concurrent.skipIf(isWindows)("a symlinked .bin directory is never cleaned through", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const outsideBins = linkOutside(dir, "node_modules/.bin");
  symlinkSync("./does-not-exist", join(outsideBins, "dangling"));
  plant(dir, "node_modules/junk");
  expect(tree(dir)).toEqual({ "node_modules": [".bin (link)", "junk", "no-deps"] });

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": [".bin (link)", "no-deps"] });
  expect(readdirSync(outsideBins)).toEqual(["dangling"]);
});

test.concurrent("isolated: extraneous symlinks are removed even when the store is clean", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const outside = linkOutside(dir, "node_modules/ext", { "keep.txt": "keep" });
  const scopedOutside = linkOutside(dir, "node_modules/@ext/thing", { "keep.txt": "keep" });
  expect(tree(dir)).toEqual({
    "node_modules": ["@ext/thing (link)", "ext (link)", "no-deps (link)"],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
  });

  const first = await prune(dir, "--linker", "isolated");
  expect(out(first.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @ext/thing
    - ext
    2 packages removed (checked 4)"
  `);
  expectOk(first);
  const pruned = {
    "node_modules": ["no-deps (link)"],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
  };
  expect(tree(dir)).toEqual(pruned);
  expect(readdirSync(outside)).toEqual(["keep.txt"]);
  expect(readdirSync(scopedOutside)).toEqual(["keep.txt"]);

  const second = await prune(dir, "--linker", "isolated");
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 2)]);
  expectOk(second);
  expect(tree(dir)).toEqual(pruned);
});

test.concurrent(
  "hoisted: lockfile shrinks -> removed packages, their nested deps, scope dir and bin links go away",
  async () => {
    const dir = await setup({
      name: "foo",
      dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "@scoped/has-bin-entry": "1.0.0" },
    });
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "2.0.0" } }));
    await install(dir, "--lockfile-only");
    expect(tree(dir)).toEqual({
      "node_modules": [".bin/has-bin-entry", "@scoped/has-bin-entry", "no-deps", "one-dep"],
      "node_modules/one-dep/node_modules": ["no-deps"],
    });

    const result = await prune(dir);
    expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    - one-dep@1.0.0
    2 packages removed (checked 3)"
  `);
    expectOk(result);
    // The bin link goes with its package; the .bin folder itself is left behind, empty.
    expect(tree(dir)).toEqual({ "node_modules": [".bin", "no-deps"] });
    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
    const { out: installOut } = await runBunInstall(installEnv(dir), dir, { savesLockfile: false });
    expect(installOut).toContain("no changes");
    expect(tree(dir)).toEqual({ "node_modules": [".bin", "no-deps"] });
  },
);

test.concurrent("hoisted: removing only a scoped package also removes its bin link", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "@scoped/has-bin-entry": "1.0.0" },
  });
  expect(tree(dir)).toEqual({ "node_modules": [".bin/has-bin-entry", "@scoped/has-bin-entry", "no-deps"] });

  const result = await prune(dir, "--production");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    1 package removed (checked 2)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": [".bin", "no-deps"] });
});

test.concurrent(
  "isolated: lockfile shrinks -> store entries, alias links and the emptied scope dir go away",
  async () => {
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "@scoped/has-bin-entry": "1.0.0" },
    });
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "2.0.0" } }));
    await install(dir, "--lockfile-only", "--linker", "isolated");
    expect(tree(dir)).toEqual({
      "node_modules": [".bin/has-bin-entry", "@scoped/has-bin-entry (link)", "no-deps (link)", "one-dep (link)"],
      "node_modules/.bun": ["@scoped+has-bin-entry@1.0.0", "no-deps@1.0.1", "no-deps@2.0.0", "one-dep@1.0.0"],
      "node_modules/.bun/node_modules": ["@scoped/has-bin-entry (link)", "no-deps (link)", "one-dep (link)"],
    });

    const result = await prune(dir, "--linker", "isolated");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    - no-deps@1.0.1
    - one-dep@1.0.0
    3 packages removed (checked 7)"
  `);
    expectOk(result);
    expect(tree(dir)).toEqual({
      "node_modules": [".bin", "no-deps (link)"],
      "node_modules/.bun": ["no-deps@2.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
    });
    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
  },
);

test.concurrent("hoisted: --production empties a workspace folder that only held nested devDependencies", async () => {
  const dir = await setupWorkspaces("hoisted", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { devDependencies: { "no-deps": "1.0.0" } } },
  });
  expect(tree(dir)).toEqual({
    "node_modules": ["a (link)", "no-deps"],
    "packages/a/node_modules": ["no-deps"],
  });

  const result = await prune(dir, "--production", "--linker", "hoisted");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.0 (packages/a/node_modules)
    1 package removed (checked 3)"
  `);
  expectOk(result);
  const pruned = { "node_modules": ["a (link)", "no-deps"], "packages/a/node_modules": [] };
  expect(tree(dir)).toEqual(pruned);
  expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
  await expectProductionInstallIsNoop(dir);
  expect(tree(dir)).toEqual(pruned);
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
// The isolated linker links each workspace's dependencies into that workspace; the root folder only gets the root's own.
const appLinksToolInstalled = {
  "node_modules": [],
  "node_modules/.bun": ["a-dep@1.0.1", "no-deps@1.0.0"],
  "node_modules/.bun/node_modules": ["a-dep (link)", "no-deps (link)"],
  "packages/app/node_modules": ["a-dep (link)", "lib (link)", "no-deps (link)", "tool (link)"],
};

test.concurrent(
  "isolated + workspaces: --production removes a workspace's registry devDependency and its dev-only workspace link, keeps prod links",
  async () => {
    const dir = await setupWorkspaces("isolated", appLinksTool);
    expect(tree(dir)).toEqual(appLinksToolInstalled);

    const plain = await prune(dir, "--linker", "isolated");
    expect(lines(plain.stdout)).toStrictEqual([BANNER, "", NOTHING(6, 3)]);
    expectOk(plain);
    expect(tree(dir)).toEqual(appLinksToolInstalled);

    const dryRun = await prune(dir, "--production", "--dry-run", "--linker", "isolated");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - tool@1.0.0 (packages/app/node_modules)
      2 packages can be removed (checked 6)
        bun prune --production --linker isolated"
    `);
    expectOk(dryRun);
    expect(tree(dir)).toEqual(appLinksToolInstalled);

    const result = await prune({ dir, cwd: join(dir, "packages", "app") }, "--production", "--linker", "isolated");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - tool@1.0.0 (packages/app/node_modules)
      2 packages removed (checked 6)"
    `);
    expectOk(result);
    const production = {
      "node_modules": [],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
      "packages/app/node_modules": ["lib (link)", "no-deps (link)"],
    };
    expect(tree(dir)).toEqual(production);
    expect(existsSync(join(dir, "packages", "tool", "package.json"))).toBeTrue();

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(again.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 3)]);
    expectOk(again);
    expect(tree(dir)).toEqual(production);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);
  },
);

test.concurrent("isolated: a real directory named like a workspace is never deleted", async () => {
  const dir = await setupWorkspaces("isolated", appLinksTool);
  rmSync(join(dir, "packages", "app", "node_modules", "tool"));
  plant(dir, "packages/app/node_modules/tool");
  expect(tree(dir)).toEqual({
    ...appLinksToolInstalled,
    "packages/app/node_modules": ["a-dep (link)", "lib (link)", "no-deps (link)", "tool"],
  });

  const result = await prune(dir, "--production", "--linker", "isolated");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package removed (checked 6)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": [],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
    "packages/app/node_modules": ["lib (link)", "no-deps (link)", "tool"],
  });
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
    const shared = {
      "node_modules": [],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
    };
    expect(tree(mixedDir)).toEqual({
      ...shared,
      "packages/app/node_modules": ["@scope/lib (link)", "@scope/tool (link)", "no-deps (link)"],
    });
    expect(tree(devOnlyDir)).toEqual({
      ...shared,
      "packages/app/node_modules": ["@scope/tool (link)", "no-deps (link)"],
    });

    const mixed = await prune(mixedDir, "--production", "--linker", "isolated");
    expect(out(mixed.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 4)"
    `);
    expectOk(mixed);
    const mixedPruned = { ...shared, "packages/app/node_modules": ["@scope/lib (link)", "no-deps (link)"] };
    expect(tree(mixedDir)).toEqual(mixedPruned);
    expect(existsSync(join(mixedDir, "packages", "tool", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(mixedDir);
    expect(tree(mixedDir)).toEqual(mixedPruned);

    const devOnly = await prune(devOnlyDir, "--production", "--linker", "isolated");
    expect(out(devOnly.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 3)"
    `);
    expectOk(devOnly);
    // An emptied @scope dir would list as a bare "@scope" entry.
    const devOnlyPruned = { ...shared, "packages/app/node_modules": ["no-deps (link)"] };
    expect(tree(devOnlyDir)).toEqual(devOnlyPruned);
    expect(existsSync(join(devOnlyDir, "packages", "tool", "package.json"))).toBeTrue();
    await expectProductionInstallIsNoop(devOnlyDir);
    expect(tree(devOnlyDir)).toEqual(devOnlyPruned);
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
    const shared = {
      "node_modules": [],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
      "packages/b/node_modules": ["no-deps (link)", "tool (link)"],
    };
    expect(tree(dir)).toEqual({ ...shared, "packages/app/node_modules": ["tool (link)"] });

    const result = await prune(dir, "--production", "--linker", "isolated");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 4)"
    `);
    expectOk(result);
    const pruned = { ...shared, "packages/app/node_modules": [] };
    expect(tree(dir)).toEqual(pruned);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(pruned);
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
    // hoisted: the root's tool link doubles as app's, and tool's no-deps is hoisted. isolated: every importer links its own.
    const isolated = {
      "node_modules": ["tool (link)"],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
      "packages/tool/node_modules": ["no-deps (link)"],
    };
    const installed =
      linker === "hoisted"
        ? { "node_modules": ["app (link)", "no-deps", "tool (link)"] }
        : { ...isolated, "packages/app/node_modules": ["tool (link)"] };
    expect(tree(dir)).toEqual(installed);

    const first = await prune(dir, "--production", "--linker", linker);
    expect(lines(first.stdout)).toStrictEqual(
      linker === "hoisted"
        ? [BANNER, "", NOTHING(3, 1)]
        : [BANNER, "", "- tool@1.0.0 (packages/app/node_modules)", REMOVED(1, 4)],
    );
    expectOk(first);
    const pruned = linker === "hoisted" ? installed : { ...isolated, "packages/app/node_modules": [] };
    expect(tree(dir)).toEqual(pruned);
    expect(existsSync(join(dir, "packages", "tool", "package.json"))).toBeTrue();

    const second = await prune(dir, "--production", "--linker", linker);
    expect(lines(second.stdout)).toStrictEqual([BANNER, "", linker === "hoisted" ? NOTHING(3, 1) : NOTHING(3, 4)]);
    expectOk(second);
    expect(tree(dir)).toEqual(pruned);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(pruned);
  },
);

test.concurrent.each(linkers)("%s: refuses when package.json changed since bun.lock was written", async linker => {
  const dir = await setupWithLinker(linker, { name: "foo", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" } });
  plant(dir, "node_modules/junk");
  await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  const lockBefore = await lock(dir);
  const planted =
    linker === "hoisted"
      ? { "node_modules": ["a-dep", "junk", "no-deps"] }
      : {
          "node_modules": ["a-dep (link)", "junk", "no-deps (link)"],
          "node_modules/.bun": ["a-dep@1.0.1", "no-deps@1.0.0"],
          "node_modules/.bun/node_modules": ["a-dep (link)", "no-deps (link)"],
        };

  expectRefused(await prune(dir, "--linker", linker));
  expectRefused(await prune(dir, "--dry-run", "--linker", linker));
  expect(tree(dir)).toEqual(planted);

  const silent = await prune(dir, "--silent", "--linker", linker);
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(tree(dir)).toEqual(planted);
  expect(await lock(dir)).toBe(lockBefore);

  await install(dir, "--lockfile-only", "--linker", linker);
  expect(tree(dir)).toEqual(planted);
  const result = await prune(dir, "--linker", linker);
  // The rows read the same under both linkers; only the store changes what was checked.
  expect(lines(result.stdout)).toStrictEqual([
    BANNER,
    "",
    "- a-dep@1.0.1",
    "- junk",
    REMOVED(2, linker === "hoisted" ? 3 : 5),
  ]);
  expectOk(result);
  expect(tree(dir)).toEqual(
    linker === "hoisted"
      ? { "node_modules": ["no-deps"] }
      : {
          "node_modules": ["no-deps (link)"],
          "node_modules/.bun": ["no-deps@1.0.0"],
          "node_modules/.bun/node_modules": ["no-deps (link)"],
        },
  );
});

test.concurrent.each([
  ["a dependency is added", { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } }],
  ["a range changes but still matches the installed version", { dependencies: { "no-deps": "^1.0.0" } }],
  ["an override is added", { dependencies: { "no-deps": "1.0.0" }, overrides: { "no-deps": "1.0.0" } }],
] as const)("refuses when %s", async (_, edited) => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  plant(dir, "node_modules/junk");
  const lockBefore = await lock(dir);
  await write(join(dir, "package.json"), JSON.stringify({ name: "foo", ...edited }));

  expectRefused(await prune(dir));
  expect(tree(dir)).toEqual({ "node_modules": ["junk", "no-deps"] });
  expect(await lock(dir)).toBe(lockBefore);
});

test.concurrent("refuses when a catalog entry changed", async () => {
  const catalogRoot = (version: string) => ({
    root: { workspaces: { packages: ["packages/*"], catalog: { "no-deps": version } } },
    packages: { a: { dependencies: { "no-deps": "catalog:" } } },
  });
  const dir = await setupWorkspaces("hoisted", catalogRoot("1.0.0"));
  plant(dir, "node_modules/junk");
  const lockBefore = await lock(dir);
  await writeWorkspaces(dir, catalogRoot("1.0.1"));

  expectRefused(await prune(dir, "--linker", "hoisted"));
  expect(tree(dir)).toEqual({ "node_modules": ["a (link)", "junk", "no-deps"] });
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
  plant(dir, "packages/a/node_modules/junk");
  const planted = {
    "node_modules": ["a (link)", "a-dep", "b (link)", "no-deps"],
    "packages/a/node_modules": ["junk", "no-deps"],
  };
  expect(tree(dir)).toEqual(planted);
  await write(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "b", version: "1.0.0" }));

  expectRefused(await prune(dir, "--linker", "hoisted"));
  expectRefused(await prune({ dir, cwd: join(dir, "packages", "a") }, "--linker", "hoisted"));
  expectRefused(await prune(dir, "--filter", "a", "--linker", "hoisted"));
  expect(tree(dir)).toEqual(planted);
});

test.concurrent.each(linkers)("%s: a workspace lifecycle script is not out of sync", async linker => {
  const dir = await setupWorkspaces(linker, {
    packages: { a: { dependencies: { "no-deps": "1.0.0" }, scripts: { postinstall: "echo ok" } } },
  });
  plant(dir, "node_modules/junk");
  const installed =
    linker === "hoisted"
      ? { "node_modules": ["a (link)", "no-deps"] }
      : {
          "node_modules": [],
          "node_modules/.bun": ["no-deps@1.0.0"],
          "node_modules/.bun/node_modules": ["no-deps (link)"],
          "packages/a/node_modules": ["no-deps (link)"],
        };

  const result = await prune(dir, "--linker", linker);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 3)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual(installed);
});

test.concurrent("trustedDependencies stripped from bun.lock is not out of sync", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" }, trustedDependencies: ["no-deps"] });
  const before = await lock(dir);
  expect(before).toContain('"trustedDependencies"');
  const stripped = before.replace(/\n  "trustedDependencies": \[\n(?:    [^\n]*\n)*  \],/, "");
  expect(stripped).not.toContain('"trustedDependencies"');
  await write(join(dir, "bun.lock"), stripped);
  plant(dir, "node_modules/junk");

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
});

const prunedCheckout = (app: Record<string, unknown>) => ({
  packages: {
    app: { dependencies: { "no-deps": "1.0.0", ...app } },
    other: { dependencies: { "left-pad": "1.0.0" } },
  },
});

test.concurrent("prunes a checkout whose bun.lock lists a workspace that is no longer on disk", async () => {
  const dir = await setupWorkspaces("hoisted", prunedCheckout({}));
  rmSync(join(dir, "packages", "other"), { recursive: true });
  plant(dir, "node_modules/junk");
  expect(tree(dir)).toEqual({
    "node_modules": ["app (link)", "junk", "left-pad", "no-deps", "other (dangling link)"],
  });

  const { lines: merged, exitCode } = await pruneMerged(dir, "--linker", "hoisted");
  expect(merged).toStrictEqual([BANNER, "", PRUNED_NOTE, "- junk", "- left-pad@1.0.0", "- other", REMOVED(3, 5)]);
  expect(exitCode).toBe(0);
  const pruned = { "node_modules": ["app (link)", "no-deps"] };
  expect(tree(dir)).toEqual(pruned);

  await install(dir, "--frozen-lockfile", "--linker", "hoisted");
  expect(tree(dir)).toEqual(pruned);

  const second = await prune(dir, "--linker", "hoisted");
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expect(normalizeBunSnapshot(second.stderr)).toBe(PRUNED_NOTE);
  expect(second.exitCode).toBe(0);
  expect(tree(dir)).toEqual(pruned);
});

test.concurrent("isolated: a workspace missing from disk no longer keeps its store entries", async () => {
  const dir = await setupWorkspaces("isolated", prunedCheckout({}));
  rmSync(join(dir, "packages", "other"), { recursive: true });
  plant(dir, "node_modules/junk");
  expect(tree(dir)).toEqual({
    "node_modules": ["junk"],
    "node_modules/.bun": ["left-pad@1.0.0", "no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["left-pad (link)", "no-deps (link)"],
    "packages/app/node_modules": ["no-deps (link)"],
  });

  const result = await prune(dir, "--linker", "isolated");
  expect(normalizeBunSnapshot(result.stderr)).toBe(PRUNED_NOTE);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    - left-pad@1.0.0
    2 packages removed (checked 4)"
  `);
  expect(result.exitCode).toBe(0);
  const pruned = {
    "node_modules": [],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
    "packages/app/node_modules": ["no-deps (link)"],
  };
  expect(tree(dir)).toEqual(pruned);

  await install(dir, "--frozen-lockfile", "--linker", "isolated");
  expect(tree(dir)).toEqual(pruned);

  const second = await prune(dir, "--linker", "isolated");
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 3)]);
  expect(normalizeBunSnapshot(second.stderr)).toBe(PRUNED_NOTE);
  expect(second.exitCode).toBe(0);
  expect(tree(dir)).toEqual(pruned);
});

test.concurrent("hoisted: --filter on a pruned checkout does not protect the missing workspace", async () => {
  const dir = await setupWorkspaces("hoisted", prunedCheckout({}));
  rmSync(join(dir, "packages", "other"), { recursive: true });
  expect(tree(dir)).toEqual({ "node_modules": ["app (link)", "left-pad", "no-deps", "other (dangling link)"] });

  const result = await prune(dir, "--filter", "app", "--linker", "hoisted");
  expect(normalizeBunSnapshot(result.stderr)).toBe(PRUNED_NOTE);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - left-pad@1.0.0
    - other
    2 packages removed (checked 4)"
  `);
  expect(result.exitCode).toBe(0);
  expect(tree(dir)).toEqual({ "node_modules": ["app (link)", "no-deps"] });
});

test.concurrent("a survivor depending on a missing workspace makes prune fail like install does", async () => {
  const dir = await setupWorkspaces("hoisted", prunedCheckout({ other: "workspace:*" }));
  rmSync(join(dir, "packages", "other"), { recursive: true });
  plant(dir, "node_modules/junk");
  const planted = { "node_modules": ["app (link)", "junk", "left-pad", "no-deps", "other (dangling link)"] };
  expect(tree(dir)).toEqual(planted);

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "error: workspace "app" depends on workspace "other" (packages/other), which is listed in bun.lock but not on disk
    note: a pruned checkout must keep every workspace that its remaining workspaces depend on"
  `);
  expect(out(stdout)).toBe(BANNER);
  expect(exitCode).toBe(1);
  expect(tree(dir)).toEqual(planted);
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
    expect(tree(dir)).toEqual({ "node_modules": ["app (link)", "shared (link)", "shared-alias (link)"] });

    const result = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - shared-alias@1.0.0
      1 package removed (checked 3)"
    `);
    expectOk(result);
    const pruned = { "node_modules": ["app (link)", "shared (link)"] };
    expect(tree(dir)).toEqual(pruned);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(pruned);

    const second = await prune(dir, "--production", "--linker", "hoisted");
    expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
    expectOk(second);
    expect(tree(dir)).toEqual(pruned);
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
    plant(dir, "packages/a/node_modules/junk");
    plant(dir, "packages/b/node_modules/junk");
    // one-fixed-dep wants no-deps@1.0.0 while the root holds 2.0.0, so it carries a nested copy.
    const nested = { "node_modules/one-fixed-dep/node_modules": ["no-deps"] };
    expect(tree(dir)).toEqual({
      "node_modules": ["a (link)", "a-dep", "b (link)", "left-pad", "no-deps", "one-fixed-dep"],
      ...nested,
      "packages/a/node_modules": ["junk", "no-deps"],
      "packages/b/node_modules": ["junk", "no-deps"],
    });

    const onlyA = await prune(dir, "--production", "--filter", "a", "--linker", "hoisted");
    expect(out(onlyA.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk (node_modules/a/node_modules)
      2 packages removed (checked 8)"
    `);
    expectOk(onlyA);
    expect(tree(dir)).toEqual({
      "node_modules": ["a (link)", "b (link)", "left-pad", "no-deps", "one-fixed-dep"],
      ...nested,
      "packages/a/node_modules": ["no-deps"],
      "packages/b/node_modules": ["junk", "no-deps"],
    });
    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });

    const onlyRoot = await prune(dir, "--production", "--filter", "root", "--linker", "hoisted");
    expect(out(onlyRoot.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - left-pad@1.0.0
      1 package removed (checked 5)"
    `);
    expectOk(onlyRoot);
    expect(tree(dir)).toEqual({
      "node_modules": ["a (link)", "b (link)", "no-deps", "one-fixed-dep"],
      ...nested,
      "packages/a/node_modules": ["no-deps"],
      "packages/b/node_modules": ["junk", "no-deps"],
    });

    const everything = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/b/node_modules)
      - one-fixed-dep@1.0.0
      2 packages removed (checked 7)"
    `);
    expectOk(everything);
    const production = {
      "node_modules": ["a (link)", "b (link)", "no-deps"],
      "packages/a/node_modules": ["no-deps"],
      "packages/b/node_modules": ["no-deps"],
    };
    expect(tree(dir)).toEqual(production);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);
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
    expect(tree(dir)).toEqual({
      "node_modules": [],
      "node_modules/.bun": ["a-dep@1.0.1", "left-pad@1.0.0", "no-deps@1.0.0", "one-fixed-dep@1.0.0"],
      "node_modules/.bun/node_modules": ["a-dep (link)", "left-pad (link)", "no-deps (link)", "one-fixed-dep (link)"],
      "packages/a/node_modules": ["a-dep (link)", "no-deps (link)", "one-fixed-dep (link)"],
      "packages/b/node_modules": ["a-dep (link)", "left-pad (link)"],
    });

    const onlyA = await prune(dir, "--production", "--filter", "a", "--linker", "isolated");
    expect(out(onlyA.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/a/node_modules)
      - one-fixed-dep@1.0.0
      2 packages removed (checked 7)"
    `);
    expectOk(onlyA);
    // a-dep's store entry stays because b, which was not selected, still links to it.
    expect(tree(dir)).toEqual({
      "node_modules": [],
      "node_modules/.bun": ["a-dep@1.0.1", "left-pad@1.0.0", "no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["a-dep (link)", "left-pad (link)", "no-deps (link)"],
      "packages/a/node_modules": ["no-deps (link)"],
      "packages/b/node_modules": ["a-dep (link)", "left-pad (link)"],
    });

    const everything = await prune(dir, "--production", "--linker", "isolated");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - left-pad@1.0.0
      2 packages removed (checked 6)"
    `);
    expectOk(everything);
    const production = {
      "node_modules": [],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
      "packages/a/node_modules": ["no-deps (link)"],
      "packages/b/node_modules": [],
    };
    expect(tree(dir)).toEqual(production);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);
  },
);

test.concurrent(
  "isolated: --production --filter unlinks one workspace's dev deps at a time, the store entry waits for an unfiltered run",
  async () => {
    const pkg = { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } };
    const dir = await setupWorkspaces("isolated", { packages: { selected: pkg, unselected: pkg } });
    const bothLinked = ["a-dep (link)", "no-deps (link)"];
    const fullStore = {
      "node_modules": [],
      "node_modules/.bun": ["a-dep@1.0.1", "no-deps@1.0.0"],
      "node_modules/.bun/node_modules": bothLinked,
    };
    expect(tree(dir)).toEqual({
      ...fullStore,
      "packages/selected/node_modules": bothLinked,
      "packages/unselected/node_modules": bothLinked,
    });

    const first = await prune(dir, "--production", "--filter", "selected", "--linker", "isolated");
    expect(out(first.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/selected/node_modules)
      1 package removed (checked 4)"
    `);
    expectOk(first);
    expect(tree(dir)).toEqual({
      ...fullStore,
      "packages/selected/node_modules": ["no-deps (link)"],
      "packages/unselected/node_modules": bothLinked,
    });

    const second = await prune(dir, "--production", "--filter", "unselected", "--linker", "isolated");
    expect(out(second.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/unselected/node_modules)
      1 package removed (checked 4)"
    `);
    expectOk(second);
    // Nothing links to a-dep any more, but a workspace outside the filter counts as wanting all of its bun.lock
    // dependencies, dev ones included, so each filtered run keeps the store entry for the other workspace.
    expect(tree(dir)).toEqual({
      ...fullStore,
      "packages/selected/node_modules": ["no-deps (link)"],
      "packages/unselected/node_modules": ["no-deps (link)"],
    });

    const everything = await prune(dir, "--production", "--linker", "isolated");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      1 package removed (checked 4)"
    `);
    expectOk(everything);
    const production = {
      "node_modules": [],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
      "packages/selected/node_modules": ["no-deps (link)"],
      "packages/unselected/node_modules": ["no-deps (link)"],
    };
    expect(tree(dir)).toEqual(production);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);
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
    plant(dir, "node_modules/root-junk");
    plant(dir, "packages/app/node_modules/app-junk");
    plant(dir, "packages/lib/node_modules/lib-junk");
    if (linker === "isolated") {
      plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
    }
    // The root holds no-deps@2.0.0, so each workspace gets no-deps@1.0.0 in its own folder under both linkers.
    const noDeps = linker === "hoisted" ? "no-deps" : "no-deps (link)";
    const expected = (junk: { root?: true; store?: true; app?: true; lib?: true }) => ({
      "node_modules": [
        ...(linker === "hoisted" ? ["app (link)", "lib (link)"] : []),
        noDeps,
        ...(junk.root ? ["root-junk"] : []),
      ],
      ...(linker === "isolated"
        ? {
            "node_modules/.bun": [...(junk.store ? ["junk@1.0.0"] : []), "no-deps@1.0.0", "no-deps@2.0.0"],
            "node_modules/.bun/node_modules": ["no-deps (link)"],
          }
        : {}),
      "packages/app/node_modules": junk.app ? ["app-junk", noDeps] : [noDeps],
      "packages/lib/node_modules": junk.lib ? ["lib-junk", noDeps] : [noDeps],
    });
    expect(tree(dir)).toEqual(expected({ root: true, store: true, app: true, lib: true }));
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
    expectOk(dryRun);
    expect(tree(dir)).toEqual(expected({ root: true, store: true, app: true, lib: true }));

    const byPath = await prune(dir, "--filter", "./packages/app", "--linker", linker);
    expect(lines(byPath.stdout)).toStrictEqual(removed(appRows, sharedAndApp));
    expectOk(byPath);
    expect(tree(dir)).toEqual(linker === "hoisted" ? expected({ lib: true }) : expected({ root: true, lib: true }));

    const byGlob = await prune({ dir, cwd: join(dir, "packages", "app") }, "--filter", "li*", "--linker", linker);
    expect(lines(byGlob.stdout)).toStrictEqual(removed([shown("lib", "lib-junk")], linker === "hoisted" ? 5 : 4));
    expectOk(byGlob);
    expect(tree(dir)).toEqual(linker === "hoisted" ? expected({}) : expected({ root: true }));

    if (linker === "isolated") {
      const root = await prune(dir, "--filter", "./", "--linker", linker);
      expect(lines(root.stdout)).toStrictEqual(removed(["- root-junk"], 4));
      expectOk(root);
      expect(tree(dir)).toEqual(expected({}));
    }
  },
);

test.concurrent("hoisted: --filter with no match is an error; path filters resolve against the cwd", async () => {
  const dir = await setupWorkspaces("hoisted", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { dependencies: { "no-deps": "1.0.0" } } },
  });
  plant(dir, "packages/a/node_modules/junk");
  const planted = {
    "node_modules": ["a (link)", "no-deps"],
    "packages/a/node_modules": ["junk", "no-deps"],
  };
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
  expect(tree(dir)).toEqual(planted);

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
  expect(tree(dir)).toEqual(planted);

  const fromRoot = await prune(dir, "--filter", "./packages/a", "--dry-run", "--linker", "hoisted");
  expect(lines(fromRoot.stdout)).toStrictEqual(listing("--filter", "./packages/a"));
  expectOk(fromRoot);
  expect(tree(dir)).toEqual(planted);

  const fromInside = await prune(
    { dir, cwd: join(dir, "packages", "a") },
    "--filter",
    ".",
    "--dry-run",
    "--linker",
    "hoisted",
  );
  expect(lines(fromInside.stdout)).toStrictEqual(listing("--filter", "."));
  expectOk(fromInside);
  expect(tree(dir)).toEqual(planted);

  const result = await prune(dir, "--filter", "a", "--linker", "hoisted");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/a/node_modules)
    1 package removed (checked 4)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ ...planted, "packages/a/node_modules": ["no-deps"] });
});

test.concurrent.each(linkers)(
  "%s: --filter warns about the unmatched pattern and still applies the rest",
  async linker => {
    const dir = await setupWorkspaces(linker, {
      packages: { app: { dependencies: { "no-deps": "1.0.0" } }, lib: {} },
    });
    plant(dir, "packages/app/node_modules/junk");
    const pruned =
      linker === "hoisted"
        ? { "node_modules": ["app (link)", "lib (link)", "no-deps"], "packages/app/node_modules": [] }
        : {
            "node_modules": [],
            "node_modules/.bun": ["no-deps@1.0.0"],
            "node_modules/.bun/node_modules": ["no-deps (link)"],
            "packages/app/node_modules": ["no-deps (link)"],
          };

    const { stdout, stderr, exitCode } = await prune(dir, "--filter", "app", "--filter", "nope", "--linker", linker);
    expect(normalizeBunSnapshot(stderr)).toBe('warn: No workspace packages matched the filter "nope"');
    // Under hoisted, bun.lock installs nothing into app's folder, so it is shown by its own path rather than through
    // the node_modules/app link.
    expect(lines(stdout)).toStrictEqual([
      BANNER,
      "",
      "- junk (packages/app/node_modules)",
      REMOVED(1, linker === "hoisted" ? 4 : 3),
    ]);
    expect(exitCode).toBe(0);
    expect(tree(dir)).toEqual(pruned);

    const silent = await prune(dir, "--filter", "app", "--filter", "nope", "--silent", "--linker", linker);
    expect(silent.stdout).toBe("");
    expectOk(silent);
    expect(tree(dir)).toEqual(pruned);
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
    // one-fixed-dep wants the no-deps@1.0.0 the root has, so the tree is flat under both linkers.
    const versions = { "a-dep": "1.0.1", "no-deps": "1.0.0", "one-fixed-dep": "1.0.0" };
    const installedWith = (...names: (keyof typeof versions)[]) =>
      linker === "hoisted"
        ? { "node_modules": names }
        : {
            "node_modules": names.map(name => `${name} (link)`),
            "node_modules/.bun": names.map(name => `${name}@${versions[name]}`),
            "node_modules/.bun/node_modules": names.map(name => `${name} (link)`),
          };
    expect(tree(prodDir)).toEqual(installedWith("a-dep", "no-deps", "one-fixed-dep"));
    expect(tree(omitDir)).toEqual(installedWith("a-dep", "no-deps", "one-fixed-dep"));

    const production = await prune(prodDir, "--production", "--linker", linker);
    expect(lines(production.stdout)).toStrictEqual(removed("- one-fixed-dep@1.0.0"));
    expectOk(production);
    expect(tree(prodDir)).toEqual(installedWith("a-dep", "no-deps"));

    const omit = await prune(omitDir, "--omit=optional", "--linker", linker);
    expect(lines(omit.stdout)).toStrictEqual(removed("- a-dep@1.0.1"));
    expectOk(omit);
    expect(tree(omitDir)).toEqual(installedWith("no-deps", "one-fixed-dep"));
  },
);

test.concurrent.each([["--os=aix"], ["--cpu=s390x"]])(
  "%s removes packages that are disabled for that platform, plain prune keeps them",
  async (flag: string) => {
    const dir = await setup({
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "test-postinstall-skip-native": "1.0.0" },
    });
    const installed = { "node_modules": ["no-deps", "test-postinstall-skip-native"] };
    expect(tree(dir)).toEqual(installed);

    const host = await prune(dir);
    expect(lines(host.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
    expectOk(host);
    expect(tree(dir)).toEqual(installed);

    const other = await prune(dir, flag);
    expect(out(other.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - test-postinstall-skip-native@1.0.0
      1 package removed (checked 2)"
    `);
    expectOk(other);
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
    expect(await install(dir, flag)).toContain("no changes");
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
  },
);

test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: an npm: alias is kept under its alias name",
  async linker => {
    const dir = await setupWithLinker(linker, {
      name: "foo",
      dependencies: { "my-alias": "npm:no-deps@1.0.0", "one-dep": "1.0.0" },
    });
    const aliasPkgJson = file(join(dir, "node_modules", "my-alias", "package.json"));
    expect(await aliasPkgJson.json()).toMatchObject({ name: "no-deps", version: "1.0.0" });
    plant(dir, "node_modules/junk");
    // one-dep pulls in no-deps@1.0.1 under its real name; the alias resolves to no-deps@1.0.0 next to it.
    const isolated = {
      "node_modules/.bun": ["no-deps@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)", "one-dep (link)"],
    };
    expect(tree(dir)).toEqual(
      linker === "hoisted"
        ? { "node_modules": ["junk", "my-alias", "no-deps", "one-dep"] }
        : { ...isolated, "node_modules": ["junk", "my-alias (link)", "one-dep (link)"] },
    );

    const result = await prune(dir, "--linker", linker);
    expect(lines(result.stdout)).toStrictEqual([BANNER, "", "- junk", REMOVED(1, linker === "hoisted" ? 4 : 6)]);
    expectOk(result);
    expect(tree(dir)).toEqual(
      linker === "hoisted"
        ? { "node_modules": ["my-alias", "no-deps", "one-dep"] }
        : { ...isolated, "node_modules": ["my-alias (link)", "one-dep (link)"] },
    );
    expect(await aliasPkgJson.json()).toMatchObject({ name: "no-deps", version: "1.0.0" });
  },
);

test.concurrent("isolated + publicHoistPattern: hoisted links follow their store entries", async () => {
  const dir = await setupWithLinker(
    "isolated",
    { name: "foo", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } },
    { publicHoistPattern: ["no-deps"], hoistPattern: ["one-dep"] },
  );
  // hoistPattern narrows the hidden hoist folder to one-dep; the root's own no-deps link doubles as the public hoist.
  const installed = {
    "node_modules": ["no-deps (link)", "one-dep (link)"],
    "node_modules/.bun": ["no-deps@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"],
    "node_modules/.bun/node_modules": ["one-dep (link)"],
  };
  expect(tree(dir)).toEqual(installed);
  const rootNoDeps = file(join(dir, "node_modules", "no-deps", "package.json"));
  expect(await rootNoDeps.json()).toMatchObject({ version: "1.0.0" });

  const clean = await prune(dir, "--linker", "isolated");
  expect(lines(clean.stdout)).toStrictEqual([BANNER, "", NOTHING(5, 2)]);
  expectOk(clean);
  expect(tree(dir)).toEqual(installed);

  const production = await prune(dir, "--production", "--linker", "isolated");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 5)"
  `);
  expectOk(production);
  expect(tree(dir)).toEqual({
    "node_modules": ["no-deps (link)"],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": [],
  });
  expect(await rootNoDeps.json()).toMatchObject({ version: "1.0.0" });
});

test.concurrent.skipIf(isWindows || process.getuid?.() === 0)(
  "a failed deletion is reported, the rest is removed, exit code 1",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
    plant(dir, "node_modules/junk-a");
    const inner = plant(dir, "node_modules/junk-b/inner");
    const junkB = join(dir, "node_modules", "junk-b");
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
        "1 package removed, 1 failed (checked 3)",
      ]);
      expect(exitCode).toBe(1);
      expect(tree(dir)).toEqual({ "node_modules": ["junk-b", "no-deps"] });
      expect(existsSync(inner)).toBeTrue();

      // --silent still reports what could not be removed; the exit code alone would hide which entry it was.
      const silent = await prune(dir, "--silent");
      expect(silent.stdout).toBe("");
      expect(normalizeBunSnapshot(silent.stderr)).toMatch(failure);
      expect(silent.exitCode).toBe(1);
      expect(tree(dir)).toEqual({ "node_modules": ["junk-b", "no-deps"] });
      expect(existsSync(inner)).toBeTrue();
    } finally {
      chmodSync(junkB, 0o755);
    }

    const result = await prune(dir);
    expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk-b
    1 package removed (checked 2)"
  `);
    expectOk(result);
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
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
  plant(dir, "node_modules/junk");

  const plain = await prune(dir);
  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 3)"
  `);
  expectOk(plain);
  expect(tree(dir)).toEqual({ "node_modules": ["a-dep", "no-deps"] });
  expect(existsSync(ran)).toBeFalse();

  const production = await prune(dir, "--production");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package removed (checked 2)"
  `);
  expectOk(production);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
  expect(existsSync(ran)).toBeFalse();
});

test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: --omit=peer removes what bun install --omit=peer would not install",
  async linker => {
    const pkg = { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0" } };
    const [dir, plainDir] = await Promise.all([setupWithLinker(linker, pkg), setupWithLinker(linker, pkg)]);
    // The peer is auto-installed as the newest no-deps 1.x. Under isolated its consumer's entry carries a peer hash.
    const expected = (project: string, withPeer: boolean) => {
      if (linker === "hoisted") {
        return { "node_modules": withPeer ? ["no-deps", "peer-deps-fixed"] : ["peer-deps-fixed"] };
      }
      const consumer = storeEntries(project).find(entry => entry.startsWith("peer-deps-fixed@"))!;
      expect(consumer).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
      return {
        "node_modules": ["peer-deps-fixed (link)"],
        "node_modules/.bun": withPeer ? ["no-deps@1.1.0", consumer] : [consumer],
        "node_modules/.bun/node_modules": withPeer
          ? ["no-deps (link)", "peer-deps-fixed (link)"]
          : ["peer-deps-fixed (link)"],
      };
    };
    expect(tree(dir)).toEqual(expected(dir, true));
    expect(tree(plainDir)).toEqual(expected(plainDir, true));

    const omit = await prune(dir, "--omit=peer", "--linker", linker);
    expect(lines(omit.stdout)).toStrictEqual([BANNER, "", "- no-deps@1.1.0", REMOVED(1, linker === "hoisted" ? 2 : 3)]);
    expectOk(omit);
    expect(tree(dir)).toEqual(expected(dir, false));
    if (linker === "hoisted") {
      expect(await install(dir, "--omit=peer")).toContain("no changes");
      expect(tree(dir)).toEqual(expected(dir, false));
    }

    const plain = await prune(plainDir, "--linker", linker);
    expect(lines(plain.stdout)).toStrictEqual([BANNER, "", linker === "hoisted" ? NOTHING(2, 1) : NOTHING(3, 2)]);
    expectOk(plain);
    expect(tree(plainDir)).toEqual(expected(plainDir, true));
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
    const [entry, ...rest] = storeEntries(dir).filter(name => name.startsWith(`${consumer}@`));
    expect(rest).toStrictEqual([]);
    expect(entry).toMatch(new RegExp(`^${consumer}@1\\.0\\.0\\+[0-9a-f]{16}$`));
    const store = {
      "node_modules/.bun": ["no-deps@1.0.0", entry],
      "node_modules/.bun/node_modules": ["no-deps (link)", `${consumer} (link)`],
    };
    expect(tree(dir)).toEqual({ ...store, "node_modules": ["no-deps (link)", `${consumer} (link)`] });
    const peerLink = join(dir, "node_modules", ".bun", entry, "node_modules", "no-deps", "package.json");
    expect(existsSync(peerLink)).toBeTrue();

    const result = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(result.stdout)).toStrictEqual([BANNER, "", "- no-deps@1.0.0", REMOVED(1, 4)]);
    expectOk(result);
    const production = { ...store, "node_modules": [`${consumer} (link)`] };
    expect(tree(dir)).toEqual(production);
    expect(existsSync(peerLink)).toBeTrue();
    expect(await file(join(dir, "node_modules", consumer, "package.json")).json()).toMatchObject({
      name: consumer,
      version: "1.0.0",
    });

    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(again.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expectOk(again);
    expect(tree(dir)).toEqual(production);
  },
);

// A --production install hashes peers against the narrowed peer set, so its entries differ from a full install's; both are what some install creates.
test.concurrent(
  "isolated: --production keeps the entries `bun install --production` itself created, then only drops dev-only ones after a full install",
  async () => {
    const dir = await project(
      { linker: "isolated" },
      {
        "package.json": JSON.stringify({
          name: "foo",
          dependencies: { "peer-deps-fixed": "1.0.0", "one-dep": "1.0.0" },
          devDependencies: { "no-deps": "2.0.0", "a-dep": "1.0.1" },
        }),
      },
    );
    await install(dir, "--lockfile-only", "--linker", "isolated");
    await install(dir, "--production", "--linker", "isolated");
    const store = join(dir, "node_modules", ".bun");
    // Every file and link inside the store, to show the entries are left exactly as bun install made them.
    const storeTree = () => readdirSync(store, { recursive: true }).map(String).toSorted();
    const consumerEntries = () => storeEntries(dir).filter(entry => entry.startsWith("peer-deps-fixed@"));
    const [productionEntry, ...rest] = consumerEntries();
    expect(rest).toStrictEqual([]);
    expect(productionEntry).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
    // Without the dev no-deps@2.0.0, the peer resolves to the no-deps@1.0.1 one-dep brings in.
    const production = {
      "node_modules": ["one-dep (link)", "peer-deps-fixed (link)"],
      "node_modules/.bun": ["no-deps@1.0.1", "one-dep@1.0.0", productionEntry],
      "node_modules/.bun/node_modules": ["no-deps (link)", "one-dep (link)", "peer-deps-fixed (link)"],
    };
    expect(tree(dir)).toEqual(production);
    const productionStore = storeTree();

    const noop = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(noop.stdout)).toStrictEqual([BANNER, "", NOTHING(5, 2)]);
    expectOk(noop);
    expect(tree(dir)).toEqual(production);
    expect(storeTree()).toStrictEqual(productionStore);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);
    expect(storeTree()).toStrictEqual(productionStore);

    await install(dir, "--linker", "isolated");
    const [fullEntry, ...others] = consumerEntries().filter(entry => entry !== productionEntry);
    expect(others).toStrictEqual([]);
    expect(fullEntry).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
    const hoisted = ["a-dep (link)", "no-deps (link)", "one-dep (link)", "peer-deps-fixed (link)"];
    expect(tree(dir)).toEqual({
      "node_modules": hoisted,
      "node_modules/.bun": [
        "a-dep@1.0.1",
        "no-deps@1.0.1",
        "no-deps@2.0.0",
        "one-dep@1.0.0",
        ...[productionEntry, fullEntry].toSorted(),
      ],
      "node_modules/.bun/node_modules": hoisted,
    });
    // The full install does not always move the hidden hoist's no-deps link from the 1.0.1 the production install
    // put there to the new 2.0.0. prune removes the link along with 2.0.0 and otherwise leaves it; it never dangles.
    const hoistHeldByDev = hiddenHoistTarget(dir, "no-deps").includes("no-deps@2.0.0");

    const result = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(result.stdout)).toStrictEqual([BANNER, "", "- a-dep@1.0.1", "- no-deps@2.0.0", REMOVED(2, 10)]);
    expectOk(result);
    const afterFullInstall = {
      "node_modules": ["one-dep (link)", "peer-deps-fixed (link)"],
      "node_modules/.bun": ["no-deps@1.0.1", "one-dep@1.0.0", ...[productionEntry, fullEntry].toSorted()],
      "node_modules/.bun/node_modules": [
        ...(hoistHeldByDev ? [] : ["no-deps (link)"]),
        "one-dep (link)",
        "peer-deps-fixed (link)",
      ],
    };
    expect(tree(dir)).toEqual(afterFullInstall);
    expect(await file(join(dir, "node_modules", "peer-deps-fixed", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
    // The no-op install still refreshes the hidden hoist links, so both cases end up with a link to 1.0.1.
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual({
      ...afterFullInstall,
      "node_modules/.bun/node_modules": ["no-deps (link)", "one-dep (link)", "peer-deps-fixed (link)"],
    });
  },
);

test.concurrent("isolated: --production removes the stale peer-hash variant and keeps the current one", async () => {
  const deps = (noDeps: string) => ({
    name: "foo",
    dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": noDeps },
    devDependencies: { "a-dep": "1.0.1" },
  });
  const dir = await setupWithLinker("isolated", deps("1.0.0"));
  const peerEntries = () => storeEntries(dir).filter(entry => entry.startsWith("peer-deps-fixed@"));
  const [before] = peerEntries();
  expect(before).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
  const linked = ["a-dep (link)", "no-deps (link)", "peer-deps-fixed (link)"];
  expect(tree(dir)).toEqual({
    "node_modules": linked,
    "node_modules/.bun": ["a-dep@1.0.1", "no-deps@1.0.0", before],
    "node_modules/.bun/node_modules": linked,
  });

  await write(join(dir, "package.json"), JSON.stringify(deps("1.0.1")));
  await install(dir, "--linker", "isolated");
  const variants = peerEntries();
  expect(variants).toHaveLength(2);
  const after = variants.find(entry => entry !== before)!;
  expect(tree(dir)).toEqual({
    "node_modules": linked,
    "node_modules/.bun": ["a-dep@1.0.1", "no-deps@1.0.0", "no-deps@1.0.1", ...variants],
    "node_modules/.bun/node_modules": linked,
  });

  const result = await prune(dir, "--production", "--linker", "isolated");
  expect(lines(result.stdout)).toStrictEqual([
    BANNER,
    "",
    "- a-dep@1.0.1",
    "- no-deps@1.0.0",
    `- ${before}`,
    REMOVED(3, 8),
  ]);
  expectOk(result);
  const production = {
    "node_modules": ["no-deps (link)", "peer-deps-fixed (link)"],
    "node_modules/.bun": ["no-deps@1.0.1", after],
    "node_modules/.bun/node_modules": ["no-deps (link)", "peer-deps-fixed (link)"],
  };
  expect(tree(dir)).toEqual(production);
  expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "1.0.1" });
  await expectProductionInstallIsNoop(dir);
  expect(tree(dir)).toEqual(production);
});

test.concurrent("keeps dependencies bundled inside a file: dependency", async () => {
  const dir = await installed(
    { linker: "hoisted" },
    {
      "package.json": JSON.stringify({ name: "foo", dependencies: { local: "file:./local" } }),
      "local/package.json": JSON.stringify({ name: "local", version: "1.0.0", bundleDependencies: ["inner"] }),
      "local/node_modules/inner/package.json": JSON.stringify({ name: "inner", version: "1.0.0" }),
    },
  );
  plant(dir, "node_modules/junk");
  expect(tree(dir)).toEqual({
    "node_modules": ["junk", "local"],
    "node_modules/local/node_modules": ["inner"],
  });

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": ["local"],
    "node_modules/local/node_modules": ["inner"],
  });
});

// pnpm#13676
test.concurrent(
  "hoisted: a nested copy is kept while the root copy is still the old version and removed once bun install replaced it",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } });
    const rootPkgJson = file(join(dir, "node_modules", "no-deps", "package.json"));
    const nestedPkgJson = file(join(dir, "node_modules", "one-dep", "node_modules", "no-deps", "package.json"));
    expect(await nestedPkgJson.json()).toMatchObject({ version: "1.0.1" });
    const withNestedCopy = {
      "node_modules": ["no-deps", "one-dep"],
      "node_modules/one-dep/node_modules": ["no-deps"],
    };
    expect(tree(dir)).toEqual(withNestedCopy);

    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "1.0.1" } }),
    );
    await install(dir, "--lockfile-only");
    expect(tree(dir)).toEqual(withNestedCopy);
    expect(await rootPkgJson.json()).toMatchObject({ version: "2.0.0" });

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
    expect(tree(dir)).toEqual(withNestedCopy);
    expect(await rootPkgJson.json()).toMatchObject({ version: "2.0.0" });

    // bun install replaces the root copy but does not clean up the nested one it made redundant.
    await install(dir);
    expect(tree(dir)).toEqual(withNestedCopy);
    expect(await rootPkgJson.json()).toMatchObject({ version: "1.0.1" });

    const result = await prune(dir);
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps@1.0.1 (node_modules/one-dep/node_modules)
      1 package removed (checked 3)"
    `);
    expectOk(result);
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps", "one-dep"], "node_modules/one-dep/node_modules": [] });
    expect(await rootPkgJson.json()).toMatchObject({ version: "1.0.1" });
  },
);

test.concurrent(
  "hoisted: --production keeps the nested copy a production package resolves to while the root holds the dev version",
  async () => {
    const pkg = { name: "foo", dependencies: { "one-fixed-dep": "1.0.0" }, devDependencies: { "no-deps": "2.0.0" } };
    const [dir, silentDir] = await Promise.all([setup(pkg), setup(pkg)]);
    const rootPkgJson = file(join(dir, "node_modules", "no-deps", "package.json"));
    const nestedPkgJson = file(join(dir, "node_modules", "one-fixed-dep", "node_modules", "no-deps", "package.json"));
    expect(await rootPkgJson.json()).toMatchObject({ version: "2.0.0" });
    expect(await nestedPkgJson.json()).toMatchObject({ version: "1.0.0" });
    const installed = {
      "node_modules": ["no-deps", "one-fixed-dep"],
      "node_modules/one-fixed-dep/node_modules": ["no-deps"],
    };
    expect(tree(dir)).toEqual(installed);
    expect(tree(silentDir)).toEqual(installed);

    const result = await prune(dir, "--production");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      Done! Checked 3 packages across 2 folders (nothing to prune)"
    `);
    expect(out(result.stderr)).toBe(
      `${WARN("node_modules/no-deps", "node_modules/one-fixed-dep/node_modules/no-deps")}\n${NOTE}`,
    );
    expect(result.exitCode).toBe(0);
    expect(tree(dir)).toEqual(installed);
    expect(await nestedPkgJson.json()).toMatchObject({ version: "1.0.0" });
    expect(await rootPkgJson.json()).toMatchObject({ version: "2.0.0" });
    // The install the note asks for puts 1.0.0 at the root and leaves the nested copy behind: only then is it extraneous.
    await runBunInstall(installEnv(dir), dir, { production: true });
    expect(tree(dir)).toEqual(installed);
    expect(await rootPkgJson.json()).toMatchObject({ version: "1.0.0" });
    expect(await nestedPkgJson.json()).toMatchObject({ version: "1.0.0" });

    const silent = await prune(silentDir, "--production", "--silent");
    expect(silent.stdout).toBe("");
    expectOk(silent);
    expect(tree(silentDir)).toEqual(installed);
  },
);

test.concurrent(
  "hoisted: inside a tree folder, junk is removed but a copy shadowed by a mismatched root package is kept",
  async () => {
    const dir = await setup({
      name: "foo",
      dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "a-dep": "1.0.2" },
    });
    const nestedNoDeps = file(join(dir, "node_modules", "one-dep", "node_modules", "no-deps", "package.json"));
    const rootADep = file(join(dir, "node_modules", "a-dep", "package.json"));
    expect(await nestedNoDeps.json()).toMatchObject({ version: "1.0.1" });
    expect(await rootADep.json()).toMatchObject({ version: "1.0.2" });

    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "a-dep": "1.0.1" } }),
    );
    await install(dir, "--lockfile-only");
    plant(dir, "node_modules/one-dep/node_modules/a-dep");
    plant(dir, "node_modules/one-dep/node_modules/junk");
    expect(tree(dir)).toEqual({
      "node_modules": ["a-dep", "no-deps", "one-dep"],
      "node_modules/one-dep/node_modules": ["a-dep", "junk", "no-deps"],
    });

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
    expect(tree(dir)).toEqual({
      "node_modules": ["a-dep", "no-deps", "one-dep"],
      "node_modules/one-dep/node_modules": ["a-dep", "no-deps"],
    });
    expect(await nestedNoDeps.json()).toMatchObject({ version: "1.0.1" });
    expect(await rootADep.json()).toMatchObject({ version: "1.0.2" });
  },
);

test.concurrent(
  "hoisted + workspaces: --production keeps a workspace's copy while the root still holds the dev version",
  async () => {
    const dir = await setupWorkspaces("hoisted", {
      root: { devDependencies: { "no-deps": "2.0.0" } },
      packages: { a: { dependencies: { "no-deps": "1.0.0" } } },
    });
    const rootPkgJson = file(join(dir, "node_modules", "no-deps", "package.json"));
    const workspacePkgJson = file(join(dir, "packages", "a", "node_modules", "no-deps", "package.json"));
    expect(await rootPkgJson.json()).toMatchObject({ version: "2.0.0" });
    expect(await workspacePkgJson.json()).toMatchObject({ version: "1.0.0" });
    const installed = { "node_modules": ["a (link)", "no-deps"], "packages/a/node_modules": ["no-deps"] };
    expect(tree(dir)).toEqual(installed);

    const result = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      Done! Checked 3 packages across 2 folders (nothing to prune)"
    `);
    expect(out(result.stderr)).toBe(`${WARN("node_modules/no-deps", "packages/a/node_modules/no-deps")}\n${NOTE}`);
    expect(result.exitCode).toBe(0);
    expect(tree(dir)).toEqual(installed);
    expect(await workspacePkgJson.json()).toMatchObject({ version: "1.0.0" });
    expect(await rootPkgJson.json()).toMatchObject({ version: "2.0.0" });
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
    const store = {
      "node_modules/.bun": ["uses-what-bin@1.0.0", "what-bin@1.0.0"],
      "node_modules/.bun/node_modules": ["uses-what-bin (link)", "what-bin (link)"],
    };
    const installed = { ...store, "node_modules": [".bin/what-bin", "uses-what-bin (link)", "what-bin (link)"] };
    expect(tree(dir)).toEqual(installed);

    const dryRun = await prune(dir, "--production", "--dry-run", "--linker", "isolated");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - what-bin@1.0.0
      1 package can be removed (checked 4)
        bun prune --production --linker isolated"
    `);
    expectOk(dryRun);
    expect(tree(dir)).toEqual(installed);

    const result = await prune(dir, "--production", "--linker", "isolated");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - what-bin@1.0.0
      1 package removed (checked 4)"
    `);
    expectOk(result);
    // The root link and its bin go; the store keeps what-bin for uses-what-bin, so its hidden hoist link stays too.
    const production = { ...store, "node_modules": [".bin", "uses-what-bin (link)"] };
    expect(tree(dir)).toEqual(production);
    const usesWhatBin = join(dir, "node_modules", ".bun", "uses-what-bin@1.0.0", "node_modules");
    expect(existsSync(join(usesWhatBin, "what-bin", "package.json"))).toBeTrue();

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(again.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expectOk(again);
    expect(tree(dir)).toEqual(production);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);
  },
);

// pnpm#13676
test.concurrent("hoisted: nested node_modules of packages without a tree node are pruned", async () => {
  const dir = await setup({
    name: "foo",
    dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" },
  });
  plant(dir, "node_modules/no-deps/node_modules/junk");
  plant(dir, "node_modules/@scoped/has-bin-entry/node_modules/@other/thing");
  writeFileSync(join(dir, "node_modules", "no-deps", "node_modules", "keep.txt"), "");
  expect(tree(dir)).toEqual({
    "node_modules": [".bin/has-bin-entry", "@scoped/has-bin-entry", "no-deps"],
    "node_modules/@scoped/has-bin-entry/node_modules": ["@other/thing"],
    "node_modules/no-deps/node_modules": ["junk", "keep.txt"],
  });

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @other/thing (node_modules/@scoped/has-bin-entry/node_modules)
    - junk (node_modules/no-deps/node_modules)
    2 packages removed (checked 4)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": [".bin/has-bin-entry", "@scoped/has-bin-entry", "no-deps"],
    "node_modules/@scoped/has-bin-entry/node_modules": [],
    "node_modules/no-deps/node_modules": ["keep.txt"],
  });
});

// pnpm#8307
test.concurrent("refuses to prune a hoisted install with the isolated linker", async () => {
  const dir = await setupWithLinker("hoisted", { name: "foo", dependencies: { "one-dep": "1.0.0" } });
  const installed = { "node_modules": ["no-deps", "one-dep"] };
  expect(tree(dir)).toEqual(installed);

  for (const flags of [
    ["--linker", "isolated"],
    ["--linker", "isolated", "--dry-run"],
  ]) {
    const { stdout, stderr, exitCode } = await prune(dir, ...flags);
    expect(out(stdout)).toBe(BANNER);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: node_modules was installed with the hoisted linker, but bun prune would use the isolated linker
      note: run 'bun prune --linker hoisted' to prune it as-is, or 'bun install' to reinstall with the isolated linker"
    `);
    expect(exitCode).toBe(1);
    expect(tree(dir)).toEqual(installed);
  }

  const same = await prune(dir, "--linker", "hoisted");
  expect(lines(same.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expectOk(same);
  expect(tree(dir)).toEqual(installed);
});

// pnpm#8307
test.concurrent("refuses to prune an isolated install with the hoisted linker", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", devDependencies: { "one-dep": "1.0.0" } });
  const installed = {
    "node_modules": ["one-dep (link)"],
    "node_modules/.bun": ["no-deps@1.0.1", "one-dep@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)", "one-dep (link)"],
  };
  expect(tree(dir)).toEqual(installed);

  const mismatch = await prune(dir, "--production", "--linker", "hoisted");
  expect(out(mismatch.stdout)).toBe(BANNER);
  expect(normalizeBunSnapshot(mismatch.stderr)).toMatchInlineSnapshot(`
    "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
    note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
  `);
  expect(mismatch.exitCode).toBe(1);
  expect(tree(dir)).toEqual(installed);

  const same = await prune(dir, "--production", "--linker", "isolated");
  expect(out(same.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 3)"
  `);
  expectOk(same);
  expect(tree(dir)).toEqual({
    "node_modules": [],
    "node_modules/.bun": [],
    "node_modules/.bun/node_modules": [],
  });
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
    const aliasPkgJson = file(join(dir, "node_modules", "aliased", "package.json"));
    expect(await aliasPkgJson.json()).toMatchObject({ version: "1.0.0" });
    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
    expect(tree(dir)).toEqual(
      linker === "hoisted"
        ? { "node_modules": ["aliased", "no-deps"] }
        : {
            "node_modules": ["aliased (link)", "no-deps (link)"],
            "node_modules/.bun": ["no-deps@1.0.0", "no-deps@2.0.0"],
            "node_modules/.bun/node_modules": ["no-deps (link)"],
          },
    );

    // Both versions are direct dependencies, and which one bun install gives the hidden hoist link to varies from
    // install to install. prune removes the link along with 2.0.0 and otherwise leaves it; it never dangles.
    const hoistHeldByDev = linker === "isolated" && hiddenHoistTarget(dir, "no-deps").includes("no-deps@2.0.0");

    const result = await prune(dir, "--production", "--linker", linker);
    expect(lines(result.stdout)).toStrictEqual([
      BANNER,
      "",
      "- no-deps@2.0.0",
      REMOVED(1, linker === "hoisted" ? 2 : 4),
    ]);
    expectOk(result);
    const production = {
      "node_modules": ["aliased (link)"],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
    };
    expect(tree(dir)).toEqual(
      linker === "hoisted"
        ? { "node_modules": ["aliased"] }
        : { ...production, "node_modules/.bun/node_modules": hoistHeldByDev ? [] : ["no-deps (link)"] },
    );
    expect(await aliasPkgJson.json()).toMatchObject({ version: "1.0.0" });
    // The no-op install still refreshes the hidden hoist links, so both cases end up with a link to 1.0.0.
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(linker === "hoisted" ? { "node_modules": ["aliased"] } : production);
  },
);

// pnpm#10081
test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: the dangling link of a renamed workspace is removed, the renamed workspace is not",
  async linker => {
    const appJson = (lib: string) =>
      JSON.stringify({ name: "app", version: "1.0.0", dependencies: { [lib]: "workspace:*" } });
    const libJson = (name: string) => JSON.stringify({ name, version: "1.0.0", dependencies: { "no-deps": "1.0.0" } });
    const dir = await setupWorkspaces(linker, {
      packages: { app: { dependencies: { a: "workspace:*" } }, a: { dependencies: { "no-deps": "1.0.0" } } },
    });
    // The hoisted linker links every workspace into the root folder; the isolated linker links it where it is depended on.
    const isolatedStore = {
      "node_modules": [],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
    };
    expect(tree(dir)).toEqual(
      linker === "hoisted"
        ? { "node_modules": ["a (link)", "app (link)", "no-deps"] }
        : {
            ...isolatedStore,
            "packages/a/node_modules": ["no-deps (link)"],
            "packages/app/node_modules": ["a (link)"],
          },
    );

    renameSync(join(dir, "packages", "a"), join(dir, "packages", "b"));
    await Promise.all([
      write(join(dir, "packages", "b", "package.json"), libJson("b")),
      write(join(dir, "packages", "app", "package.json"), appJson("b")),
    ]);
    await install(dir, "--lockfile-only", "--linker", linker);
    // b's own links are relative, so they survive the rename; only the links to the old name dangle.
    const renamed =
      linker === "hoisted"
        ? { "node_modules": ["app (link)", "no-deps"] }
        : { ...isolatedStore, "packages/b/node_modules": ["no-deps (link)"] };
    expect(tree(dir)).toEqual(
      linker === "hoisted"
        ? { "node_modules": ["a (dangling link)", "app (link)", "no-deps"] }
        : { ...renamed, "packages/app/node_modules": ["a (dangling link)"] },
    );

    const result = await prune(dir, "--linker", linker);
    // A dangling link has no package.json to read a version from; only a non-root folder is named.
    const row = linker === "hoisted" ? "- a" : "- a (packages/app/node_modules)";
    expect(lines(result.stdout)).toStrictEqual([BANNER, "", row, REMOVED(1, 3)]);
    expectOk(result);
    expect(tree(dir)).toEqual(linker === "hoisted" ? renamed : { ...renamed, "packages/app/node_modules": [] });
    expect(await file(join(dir, "packages", "b", "package.json")).json()).toMatchObject({ name: "b" });
  },
);

test.concurrent(
  "isolated: store entries of file:, tarball and git dependencies are kept under their non-npm keys",
  async () => {
    const dir = await project(
      { linker: "isolated" },
      { "local/package.json": JSON.stringify({ name: "local", version: "1.0.0" }) },
      { own: true },
    );
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "1.0.0",
          "local": "file:./local",
          "left-pad": copyTarball(dir, "left-pad", "1.0.0"),
          "git-pkg": await gitDependency(dir, "git-pkg"),
        },
      }),
    );
    await install(dir);
    const store = storeEntries(dir);
    expect(store).toStrictEqual([
      expect.stringMatching(/^git-pkg@git\+/),
      expect.stringMatching(/^left-pad@/),
      "local@file+local",
      "no-deps@1.0.0",
    ]);
    expect(store[1]).not.toBe("left-pad@1.0.0");
    // bun install gives the file: folder dependency no hidden hoist link.
    const installed = {
      "node_modules": ["git-pkg (link)", "left-pad (link)", "local (link)", "no-deps (link)"],
      "node_modules/.bun": store,
      "node_modules/.bun/node_modules": ["git-pkg (link)", "left-pad (link)", "no-deps (link)"],
    };
    expect(tree(dir)).toEqual(installed);
    plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
    plant(dir, "node_modules/.bun/local@file+elsewhere/node_modules/local");
    plant(dir, "node_modules/.bun/git-pkg@1.0.0/node_modules/git-pkg");
    expect(tree(dir)).toEqual({
      ...installed,
      "node_modules/.bun": [...store, "git-pkg@1.0.0", "junk@1.0.0", "local@file+elsewhere"].toSorted(),
    });

    const result = await prune(dir, "--linker", "isolated");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - git-pkg@1.0.0
      - junk@1.0.0
      - local@file+elsewhere
      3 packages removed (checked 11)"
    `);
    expectOk(result);
    expect(tree(dir)).toEqual(installed);

    const production = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(production.stdout)).toStrictEqual([BANNER, "", NOTHING(8, 2)]);
    expectOk(production);
    expect(tree(dir)).toEqual(installed);
  },
);

const workspaceWithDevDep: Workspaces = {
  packages: { a: { dependencies: { "one-dep": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } } },
};

test.concurrent(
  "workspaces: without --linker, a bun.lock with configVersion 1 is pruned with the isolated linker",
  async () => {
    const dir = await installed({}, workspaceFiles(workspaceWithDevDep));
    expect(await lock(dir)).toContain('"configVersion": 1,');
    plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
    expect(tree(dir)).toEqual({
      "node_modules": [],
      "node_modules/.bun": ["a-dep@1.0.1", "junk@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"],
      "node_modules/.bun/node_modules": ["a-dep (link)", "no-deps (link)", "one-dep (link)"],
      "packages/a/node_modules": ["a-dep (link)", "one-dep (link)"],
    });

    const result = await prune(dir, "--production");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk@1.0.0
      2 packages removed (checked 6)"
    `);
    expectOk(result);
    const production = {
      "node_modules": [],
      "node_modules/.bun": ["no-deps@1.0.1", "one-dep@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)", "one-dep (link)"],
      "packages/a/node_modules": ["one-dep (link)"],
    };
    expect(tree(dir)).toEqual(production);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(production);
  },
);

test.concurrent(
  "workspaces: without --linker, a bun.lock without configVersion is pruned with the hoisted linker",
  async () => {
    const dir = await project({}, workspaceFiles(workspaceWithDevDep));
    await install(dir, "--linker", "hoisted");
    const before = await lock(dir);
    expect(before).toContain('"configVersion": 1,');
    await write(join(dir, "bun.lock"), before.replace('  "configVersion": 1,\n', ""));
    plant(dir, "node_modules/junk");
    plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
    const planted = {
      "node_modules": ["a (link)", "a-dep", "junk", "no-deps", "one-dep"],
      "node_modules/.bun": ["junk@1.0.0"],
    };
    expect(tree(dir)).toEqual(planted);

    // The refusal names the linker that was picked.
    const withStore = await prune(dir, "--production");
    expect(out(withStore.stdout)).toBe(BANNER);
    expect(normalizeBunSnapshot(withStore.stderr)).toMatchInlineSnapshot(`
      "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
      note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
    `);
    expect(withStore.exitCode).toBe(1);
    expect(tree(dir)).toEqual(planted);
    rmSync(join(dir, "node_modules", ".bun"), { recursive: true });

    const result = await prune(dir, "--production");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk
      2 packages removed (checked 5)"
    `);
    expectOk(result);
    expect(tree(dir)).toEqual({ "node_modules": ["a (link)", "no-deps", "one-dep"] });
  },
);

test.concurrent("without --linker, a project without workspaces is pruned with the hoisted linker", async () => {
  const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } });
  expect(await lock(dir)).toContain('"configVersion": 1,');
  plant(dir, "node_modules/junk");
  plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
  const planted = {
    "node_modules": ["a-dep", "junk", "no-deps", "one-dep"],
    "node_modules/.bun": ["junk@1.0.0"],
  };
  expect(tree(dir)).toEqual(planted);

  const withStore = await prune(dir, "--production");
  expect(out(withStore.stdout)).toBe(BANNER);
  expect(normalizeBunSnapshot(withStore.stderr)).toMatchInlineSnapshot(`
    "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
    note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
  `);
  expect(withStore.exitCode).toBe(1);
  expect(tree(dir)).toEqual(planted);
  rmSync(join(dir, "node_modules", ".bun"), { recursive: true });

  const result = await prune(dir, "--production");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    - junk
    2 packages removed (checked 4)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps", "one-dep"] });
});

test.concurrent.each([["--os=aix"], ["--cpu=s390x"]])(
  "isolated: %s removes the store entry and link of a package disabled for that platform, plain prune keeps them",
  async (flag: string) => {
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "test-postinstall-skip-native": "1.0.0" },
    });
    const linked = ["no-deps (link)", "test-postinstall-skip-native (link)"];
    const installed = {
      "node_modules": linked,
      "node_modules/.bun": ["no-deps@1.0.0", "test-postinstall-skip-native@1.0.0"],
      "node_modules/.bun/node_modules": linked,
    };
    expect(tree(dir)).toEqual(installed);

    const host = await prune(dir, "--linker", "isolated");
    expect(lines(host.stdout)).toStrictEqual([BANNER, "", NOTHING(4, 2)]);
    expectOk(host);
    expect(tree(dir)).toEqual(installed);

    const other = await prune(dir, flag, "--linker", "isolated");
    expect(out(other.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - test-postinstall-skip-native@1.0.0
      1 package removed (checked 4)"
    `);
    expectOk(other);
    const pruned = {
      "node_modules": ["no-deps (link)"],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["no-deps (link)"],
    };
    expect(tree(dir)).toEqual(pruned);
    expect(await install(dir, flag, "--linker", "isolated")).toContain("no changes");
    expect(tree(dir)).toEqual(pruned);
  },
);

test.concurrent("isolated: keeps dependencies bundled inside a package, with and without --production", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", dependencies: { "bundled-transitive": "1.0.0" } });
  const installed = {
    "node_modules": ["bundled-transitive (link)"],
    "node_modules/.bun": ["bundled-transitive@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"],
    "node_modules/.bun/node_modules": ["bundled-transitive (link)", "no-deps (link)", "one-dep (link)"],
  };
  expect(tree(dir)).toEqual(installed);
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
    const result = await prune(dir, ...flags, "--linker", "isolated");
    expect(lines(result.stdout)).toStrictEqual([BANNER, "", NOTHING(4, 2)]);
    expectOk(result);
    expect(tree(dir)).toEqual(installed);
    expect(existsSync(bundled)).toBeTrue();
  }
  await expectProductionInstallIsNoop(dir);
  expect(tree(dir)).toEqual(installed);
});

test.concurrent("hoisted: the nested tree of a package with bundled dependencies is not walked", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "2.0.0", "bundled-transitive": "1.0.0" } });
  const nm = join(dir, "node_modules");
  expect(await file(join(nm, "bundled-transitive", "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
  });
  expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
  expect(await file(join(nm, "one-dep", "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });
  plant(dir, "node_modules/bundled-transitive/node_modules/junk");
  plant(dir, "node_modules/one-dep/node_modules/junk");
  expect(tree(dir)).toEqual({
    "node_modules": ["bundled-transitive", "no-deps", "one-dep"],
    "node_modules/bundled-transitive/node_modules": ["junk", "no-deps"],
    "node_modules/one-dep/node_modules": ["junk", "no-deps"],
  });

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/one-dep/node_modules)
    1 package removed (checked 5)"
  `);
  expectOk(result);
  // The bundled folder is the package's own contents, so even junk planted inside it is left alone.
  expect(tree(dir)).toEqual({
    "node_modules": ["bundled-transitive", "no-deps", "one-dep"],
    "node_modules/bundled-transitive/node_modules": ["junk", "no-deps"],
    "node_modules/one-dep/node_modules": ["no-deps"],
  });
});

test.concurrent(
  "hoisted: a nested copy of a git dependency is removed only once the root copy's .bun-tag matches bun.lock",
  async () => {
    const dir = await project({ linker: "hoisted" }, {}, { own: true });
    const gitPkg = await gitDependency(dir, "git-pkg");
    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0", "git-pkg": gitPkg } }),
    );
    await install(dir);
    const rootTag = join(dir, "node_modules", "git-pkg", ".bun-tag");
    const tag = await file(rootTag).text();
    expect(tag).toMatch(/^[0-9a-f]{40}$/);
    expect(await lock(dir)).toContain(tag);
    plant(dir, "node_modules/no-deps/node_modules/git-pkg");
    const withNestedCopy = {
      "node_modules": ["git-pkg", "no-deps"],
      "node_modules/no-deps/node_modules": ["git-pkg"],
    };
    expect(tree(dir)).toEqual(withNestedCopy);
    writeFileSync(rootTag, "0000000000000000000000000000000000000000");

    const stale = await prune(dir, "--linker", "hoisted");
    expect(lines(stale.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(out(stale.stderr)).toBe(
      `${WARN("node_modules/git-pkg", "node_modules/no-deps/node_modules/git-pkg")}\n${NOTE}`,
    );
    expect(stale.exitCode).toBe(0);
    expect(tree(dir)).toEqual(withNestedCopy);

    writeFileSync(rootTag, tag);
    const result = await prune(dir, "--linker", "hoisted");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - git-pkg (node_modules/no-deps/node_modules)
      1 package removed (checked 3)"
    `);
    expectOk(result);
    expect(tree(dir)).toEqual({ "node_modules": ["git-pkg", "no-deps"], "node_modules/no-deps/node_modules": [] });
  },
);

test.concurrent(
  "hoisted: a nested copy of a local tarball dependency is removed once the root copy is installed",
  async () => {
    const dir = await project({ linker: "hoisted" }, {}, { own: true });
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: { "no-deps": "1.0.0", "left-pad": copyTarball(dir, "left-pad", "1.0.0") },
      }),
    );
    await install(dir);
    const rootLeftPad = join(dir, "node_modules", "left-pad");
    expect(await file(join(rootLeftPad, "package.json")).json()).toMatchObject({ version: "1.0.0" });
    plant(dir, "node_modules/no-deps/node_modules/left-pad");
    plant(dir, "node_modules/no-deps/node_modules/junk");
    expect(tree(dir)).toEqual({
      "node_modules": ["left-pad", "no-deps"],
      "node_modules/no-deps/node_modules": ["junk", "left-pad"],
    });

    const kept = "node_modules/no-deps/node_modules/left-pad";

    renameSync(rootLeftPad, join(dir, "left-pad.moved"));
    const missing = await prune(dir, "--linker", "hoisted");
    expect(lines(missing.stdout)).toStrictEqual([
      BANNER,
      "",
      "- junk (node_modules/no-deps/node_modules)",
      REMOVED(1, 3),
    ]);
    expect(out(missing.stderr)).toBe(`${MISSING_WARN("node_modules/left-pad", kept)}\n${NOTE}`);
    expect(missing.exitCode).toBe(0);
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps"], "node_modules/no-deps/node_modules": ["left-pad"] });

    renameSync(join(dir, "left-pad.moved"), rootLeftPad);
    renameSync(join(rootLeftPad, "package.json"), join(rootLeftPad, "package.json.bak"));
    const mismatch = await prune(dir, "--linker", "hoisted");
    expect(lines(mismatch.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(out(mismatch.stderr)).toBe(`${WARN("node_modules/left-pad", kept)}\n${NOTE}`);
    expect(mismatch.exitCode).toBe(0);
    expect(tree(dir)).toEqual({
      "node_modules": ["left-pad", "no-deps"],
      "node_modules/no-deps/node_modules": ["left-pad"],
    });

    renameSync(join(rootLeftPad, "package.json.bak"), join(rootLeftPad, "package.json"));
    const result = await prune(dir, "--linker", "hoisted");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - left-pad (node_modules/no-deps/node_modules)
      1 package removed (checked 3)"
    `);
    expectOk(result);
    expect(tree(dir)).toEqual({ "node_modules": ["left-pad", "no-deps"], "node_modules/no-deps/node_modules": [] });
    expect(await file(join(rootLeftPad, "package.json")).json()).toMatchObject({ version: "1.0.0" });
  },
);

test.concurrent("hoisted: a nested copy of a link: dependency is removed when the root entry is the link", async () => {
  const dir = await project(
    { linker: "hoisted" },
    {
      "linked/package.json": JSON.stringify({ name: "linked", version: "1.0.0" }),
      "package.json": JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0", linked: "link:linked" } }),
    },
  );
  const env = globalEnv(dir, join(dir, ".global"));
  const link = await run(env, join(dir, "linked"), "link");
  expect(link.stderr).not.toContain("error:");
  expect(link.stdout).toContain('Success! Registered "linked"');
  expect(link.exitCode).toBe(0);
  const installed = await run(env, dir, "install");
  expect(installed.stderr).not.toContain("error:");
  expect(installed.exitCode).toBe(0);
  plant(dir, "node_modules/no-deps/node_modules/linked");
  expect(tree(dir)).toEqual({
    "node_modules": ["linked (link)", "no-deps"],
    "node_modules/no-deps/node_modules": ["linked"],
  });

  const result = await prune(dir, "--linker", "hoisted");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - linked (node_modules/no-deps/node_modules)
    1 package removed (checked 3)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({
    "node_modules": ["linked (link)", "no-deps"],
    "node_modules/no-deps/node_modules": [],
  });
  expect(await file(join(dir, "linked", "package.json")).json()).toStrictEqual({ name: "linked", version: "1.0.0" });
});

test.concurrent("hoisted: a nested copy left behind by an override to a tarball is removed", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "2.0.0", "one-dep": "1.0.0" } });
  const nestedPkgJson = file(join(dir, "node_modules", "one-dep", "node_modules", "no-deps", "package.json"));
  expect(await nestedPkgJson.json()).toMatchObject({ version: "1.0.1" });
  expect(await lock(dir)).toContain('"one-dep/no-deps"');
  const withNestedCopy = {
    "node_modules": ["no-deps", "one-dep"],
    "node_modules/one-dep/node_modules": ["no-deps"],
  };
  expect(tree(dir)).toEqual(withNestedCopy);

  await write(
    join(dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: { "no-deps": "2.0.0", "one-dep": "1.0.0" },
      overrides: { "no-deps": copyTarball(dir, "no-deps", "2.0.0") },
    }),
  );
  // Installing the tarball writes it to the cache, so this project leaves the shared one from here on.
  ownCache.add(dir);
  await install(dir);
  expect(await lock(dir)).not.toContain('"one-dep/no-deps"');
  expect(await lock(dir)).toContain("no-deps-2.0.0.tgz");
  expect(tree(dir)).toEqual(withNestedCopy);

  const result = await prune(dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1 (node_modules/one-dep/node_modules)
    1 package removed (checked 3)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps", "one-dep"], "node_modules/one-dep/node_modules": [] });
  expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
});

// https://github.com/oven-sh/bun/issues/13563
test.concurrent(
  "hoisted: build metadata in the installed package.json version does not block removing a nested copy",
  async () => {
    const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0", "no-deps-build-metadata": "1.0.0" } });
    expect(await file(join(dir, "node_modules", "no-deps-build-metadata", "package.json")).json()).toMatchObject({
      version: "1.0.0+123",
    });
    expect(await lock(dir)).toContain('"no-deps-build-metadata@1.0.0"');
    plant(dir, "node_modules/no-deps/node_modules/no-deps-build-metadata");
    expect(tree(dir)).toEqual({
      "node_modules": ["no-deps", "no-deps-build-metadata"],
      "node_modules/no-deps/node_modules": ["no-deps-build-metadata"],
    });

    const result = await prune(dir);
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps-build-metadata (node_modules/no-deps/node_modules)
      1 package removed (checked 3)"
    `);
    expectOk(result);
    expect(tree(dir)).toEqual({
      "node_modules": ["no-deps", "no-deps-build-metadata"],
      "node_modules/no-deps/node_modules": [],
    });
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
    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({ version: "1.0.1" });
    // no-deps is only one-dep's dependency; publicHoistPattern gives it a root link next to the direct dependencies.
    const linked = ["a-dep (link)", "no-deps (link)", "one-dep (link)"];
    const installed = {
      "node_modules": linked,
      "node_modules/.bun": ["a-dep@1.0.1", "no-deps@1.0.1", "one-dep@1.0.0"],
      "node_modules/.bun/node_modules": linked,
    };
    expect(tree(dir)).toEqual(installed);

    const plain = await prune(dir, "--linker", "isolated");
    expect(lines(plain.stdout)).toStrictEqual([BANNER, "", NOTHING(6, 2)]);
    expectOk(plain);
    expect(tree(dir)).toEqual(installed);

    const production = await prune(dir, "--production", "--linker", "isolated");
    expect(out(production.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps@1.0.1
      - one-dep@1.0.0
      2 packages removed (checked 6)"
    `);
    expectOk(production);
    const pruned = {
      "node_modules": ["a-dep (link)"],
      "node_modules/.bun": ["a-dep@1.0.1"],
      "node_modules/.bun/node_modules": ["a-dep (link)"],
    };
    expect(tree(dir)).toEqual(pruned);
    await expectProductionInstallIsNoop(dir);
    expect(tree(dir)).toEqual(pruned);
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
    const scopeDir = join(store, "node_modules", "@scope");
    plant(dir, "node_modules/.bun/one-dep@1.0.0+0123456789abcdef/node_modules/one-dep");
    const scopedEntry = plant(dir, "node_modules/.bun/@scope+zzz@1.0.0/node_modules/@scope/zzz");
    mkdirSync(scopeDir);
    symlinkSync(scopedEntry, join(scopeDir, "zzz"), "junction");
    symlinkSync(join(store, "no-deps@1.0.0", "node_modules", "no-deps"), join(scopeDir, "no-deps"), "junction");
    expect(tree(dir)).toEqual({
      "node_modules": ["no-deps (link)", "one-dep (link)"],
      "node_modules/.bun": [
        "@scope+zzz@1.0.0",
        "no-deps@1.0.0",
        "no-deps@1.0.1",
        "one-dep@1.0.0",
        "one-dep@1.0.0+0123456789abcdef",
      ],
      "node_modules/.bun/node_modules": [
        "@scope/no-deps (link)",
        "@scope/zzz (link)",
        "no-deps (link)",
        "one-dep (link)",
      ],
    });

    const result = await prune(dir, "--production", "--linker", "isolated");
    expect(out(result.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/zzz@1.0.0
      - no-deps@1.0.1
      - one-dep@1.0.0
      - one-dep@1.0.0+0123456789abcdef
      4 packages removed (checked 7)"
    `);
    expectOk(result);
    // The scoped link into a kept entry stays, so its scope dir does too.
    expect(tree(dir)).toEqual({
      "node_modules": ["no-deps (link)"],
      "node_modules/.bun": ["no-deps@1.0.0"],
      "node_modules/.bun/node_modules": ["@scope/no-deps (link)", "no-deps (link)"],
    });
  },
);

test.concurrent("isolated: an emptied scope dir of dangling hidden-hoist links is removed", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "one-dep": "1.0.0" },
  });
  const scopeDir = join(dir, "node_modules", ".bun", "node_modules", "@scope");
  const scopedEntry = plant(dir, "node_modules/.bun/@scope+zzz@1.0.0/node_modules/@scope/zzz");
  mkdirSync(scopeDir);
  symlinkSync(scopedEntry, join(scopeDir, "zzz"), "junction");
  expect(tree(dir)).toEqual({
    "node_modules": ["no-deps (link)", "one-dep (link)"],
    "node_modules/.bun": ["@scope+zzz@1.0.0", "no-deps@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"],
    "node_modules/.bun/node_modules": ["@scope/zzz (link)", "no-deps (link)", "one-dep (link)"],
  });

  const result = await prune(dir, "--production", "--linker", "isolated");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scope/zzz@1.0.0
    - no-deps@1.0.1
    - one-dep@1.0.0
    3 packages removed (checked 6)"
  `);
  expectOk(result);
  // A @scope dir left behind would list as a bare "@scope" entry of the hidden hoist folder.
  expect(tree(dir)).toEqual({
    "node_modules": ["no-deps (link)"],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
  });
});

test.concurrent("isolated: --filter on a pruned checkout does not protect the missing workspace", async () => {
  const dir = await setupWorkspaces("isolated", prunedCheckout({}));
  rmSync(join(dir, "packages", "other"), { recursive: true });
  expect(tree(dir)).toEqual({
    "node_modules": [],
    "node_modules/.bun": ["left-pad@1.0.0", "no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["left-pad (link)", "no-deps (link)"],
    "packages/app/node_modules": ["no-deps (link)"],
  });

  const result = await prune(dir, "--filter", "app", "--linker", "isolated");
  expect(normalizeBunSnapshot(result.stderr)).toBe(PRUNED_NOTE);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - left-pad@1.0.0
    1 package removed (checked 3)"
  `);
  expect(result.exitCode).toBe(0);
  const pruned = {
    "node_modules": [],
    "node_modules/.bun": ["no-deps@1.0.0"],
    "node_modules/.bun/node_modules": ["no-deps (link)"],
    "packages/app/node_modules": ["no-deps (link)"],
  };
  expect(tree(dir)).toEqual(pruned);
  await install(dir, "--frozen-lockfile", "--linker", "isolated");
  expect(tree(dir)).toEqual(pruned);
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
    const isolatedApp = { "node_modules": [], "packages/app/node_modules": ["a-dep (link)"] };
    expect(tree(dir)).toEqual(
      linker === "hoisted"
        ? { "node_modules": ["a-dep", "app (link)", "left-pad", "other (dangling link)"] }
        : {
            ...isolatedApp,
            "node_modules/.bun": ["a-dep@1.0.1", "left-pad@1.0.0"],
            "node_modules/.bun/node_modules": ["a-dep (link)", "left-pad (link)"],
          },
    );

    const result = await prune(dir, "--linker", linker);
    expect(normalizeBunSnapshot(result.stderr)).toBe(
      `${PRUNED_NOTE}\nnote: skipped 1 catalog entry not in bun.lock (unused by the workspaces on disk): "left-pad"`,
    );
    expect(lines(result.stdout)).toStrictEqual(
      linker === "hoisted"
        ? [BANNER, "", "- left-pad@1.0.0", "- other", REMOVED(2, 4)]
        : [BANNER, "", "- left-pad@1.0.0", REMOVED(1, 3)],
    );
    expect(result.exitCode).toBe(0);
    const pruned =
      linker === "hoisted"
        ? { "node_modules": ["a-dep", "app (link)"] }
        : {
            ...isolatedApp,
            "node_modules/.bun": ["a-dep@1.0.1"],
            "node_modules/.bun/node_modules": ["a-dep (link)"],
          };
    expect(tree(dir)).toEqual(pruned);
    expect(await lock(dir)).toBe(trimmed);
    await install(dir, "--frozen-lockfile", "--linker", linker);
    expect(await lock(dir)).toBe(trimmed);
    expect(tree(dir)).toEqual(pruned);
  },
);

test.concurrent("a lockfile that fails to parse is an error and nothing is deleted", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  plant(dir, "node_modules/junk");
  await write(join(dir, "bun.lock"), "{ this is not a lockfile");
  const planted = { "node_modules": ["junk", "no-deps"] };

  const { stdout, stderr, exitCode } = await prune(dir);
  // The parser's own diagnostic comes first; prune adds the verdict.
  expect(normalizeBunSnapshot(stderr)).toEndWith("\nerror: failed to load lockfile: ParserError");
  expect(out(stdout)).toBe(BANNER);
  expect(exitCode).toBe(1);
  expect(tree(dir)).toEqual(planted);

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(tree(dir)).toEqual(planted);
});

test.concurrent("missing package.json is an error; --cwd prunes another directory", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  using empty = tempDir("prune-empty", {});
  plant(dir, "node_modules/junk");

  const missing = await prune(String(empty));
  expect(normalizeBunSnapshot(missing.stderr)).toBe("error: missing package.json, nothing to prune");
  expect(missing.stdout).toBe("");
  expect(missing.exitCode).toBe(1);

  // Like the missing-lockfile refusal, this is a state of the project rather than a usage error, so --silent applies.
  const silent = await prune(String(empty), "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(tree(dir)).toEqual({ "node_modules": ["junk", "no-deps"] });

  const result = await prune({ dir, cwd: String(empty) }, "--cwd", dir);
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });
  expect(tree(String(empty))).toEqual({});
});

test.concurrent("a node_modules that is a file is an error", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } });
  const nm = join(dir, "node_modules");
  rmSync(nm, { recursive: true });
  writeFileSync(nm, "not a directory");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(normalizeBunSnapshot(stderr)).toMatch(/^E[A-Z]+: .*failed to open node_modules/);
  expect(out(stdout)).toBe(BANNER);
  expect(exitCode).toBe(1);
  expect(await file(nm).text()).toBe("not a directory");

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
    plant(dir, "node_modules/junk");

    const pruned = await bun(dir, "prune");
    expect(out(pruned.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk
      1 package removed (checked 2)"
    `);
    expectOk(pruned);
    expect(tree(dir)).toEqual({ "node_modules": ["no-deps"] });

    const script = await bun(dir, "run", "prune");
    expect(normalizeBunSnapshot(script.stdout)).toMatchInlineSnapshot(`"SCRIPT_RAN"`);
    expect(normalizeBunSnapshot(script.stderr)).toMatchInlineSnapshot(`"$ echo SCRIPT_RAN"`);
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
  const installed = { "node_modules": ["a-dep", "no-deps"] };

  const noOptional = await prune(dir, "--no-optional", "--dry-run");
  expect(lines(noOptional.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expectOk(noOptional);
  expect(tree(dir)).toEqual(installed);

  const omit = await prune(dir, "--omit=optional", "--dry-run");
  expect(out(omit.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package can be removed (checked 2)
      bun prune --omit=optional"
  `);
  expectOk(omit);
  expect(tree(dir)).toEqual(installed);
});

test.concurrent("--help lists every flag; -F is --filter, -p is --production", async () => {
  const dir = await setupWorkspaces("hoisted", {
    root: { dependencies: { "no-deps": "2.0.0" } },
    packages: { a: { dependencies: { "no-deps": "1.0.0" } }, b: { dependencies: { "no-deps": "1.0.0" } } },
  });
  plant(dir, "packages/a/node_modules/junk");
  plant(dir, "packages/b/node_modules/junk");
  const planted = {
    "node_modules": ["a (link)", "b (link)", "no-deps"],
    "packages/a/node_modules": ["junk", "no-deps"],
    "packages/b/node_modules": ["junk", "no-deps"],
  };

  const help = await prune(dir, "--help");
  expect(out(help.stdout)).toMatchInlineSnapshot(`
    "Usage: bun prune [flags]

      Remove packages from node_modules that are not in bun.lock. With --production, also remove packages that are only needed by devDependencies.

    Flags:
      -p, --production      Also remove packages that are only needed by devDependencies (alias: --prod)
          --omit=<val>      Also remove packages that are only needed by the given dependency types
          --dry-run         Print what would be removed without deleting anything
          --os=<val>        Prune for a different operating system than the current one
          --cpu=<val>       Prune for a different CPU architecture than the current one
          --linker=<val>    Prune a node_modules installed with the given linker (one of "isolated" or "hoisted")
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
  expectOk(help);
  expect(tree(dir)).toEqual(planted);

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
  expectOk(longFlag);
  expect(lines(shortFlag.stdout)).toStrictEqual([
    ...lines(longFlag.stdout).slice(0, -1),
    APPLY_HINT("-F", "a", "--linker", "hoisted"),
  ]);
  expectOk(shortFlag);
  expect(tree(dir)).toEqual(planted);

  const result = await prune(dir, "-F", "b", "-p", "--linker", "hoisted");
  expect(out(result.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/b/node_modules)
    1 package removed (checked 5)"
  `);
  expectOk(result);
  expect(tree(dir)).toEqual({ ...planted, "packages/b/node_modules": ["no-deps"] });
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
    const env = globalEnv(root, bunInstall);

    const link = await run(env, join(root, "lib"), "link");
    expect(link.stderr).not.toContain("error:");
    expect(link.stdout).toContain('Success! Registered "lib"');
    expect(link.exitCode).toBe(0);

    const add = await run(env, root, "add", "-g", join(root, "gpkg"));
    expect(add.stderr).not.toContain("error:");
    expect(add.exitCode).toBe(0);
    expect(existsSync(join(globalDir, "bun.lock"))).toBeTrue();
    // The link registration is the one entry a bun.lock-driven prune of this folder would remove.
    const globalFolder = { "node_modules": ["gpkg", "lib (link)"] };
    expect(tree(globalDir)).toEqual(globalFolder);

    const rejected = [
      "error: --global cannot be used with bun prune",
      "note: the global folder is also the 'bun link' registry, and bun.lock does not list linked packages",
    ].join("\n");
    for (const args of [
      ["prune", "-g"],
      ["prune", "--dry-run", "--global"],
      ["prune", "-g", "--silent"],
    ]) {
      const { stdout, stderr, exitCode } = await run(env, root, ...args);
      expect(normalizeBunSnapshot(stderr)).toBe(rejected);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    }
    expect(tree(globalDir)).toEqual(globalFolder);

    const fresh = join(root, ".fresh");
    const { stdout, stderr, exitCode } = await run(globalEnv(root, fresh), root, "prune", "-g");
    expect(normalizeBunSnapshot(stderr)).toBe(rejected);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    expect(existsSync(fresh)).toBeFalse();
  },
);

// Not concurrent, so it runs once every test above has finished. A new entry here was fetched by some test instead of
// in beforeAll: add it to `registryPackages`, or give the project its own cache if it is not a registry package.
test("no test wrote to the shared cache", () => {
  expect(readdirSync(sharedCache).toSorted()).toEqual(sharedCacheEntries);
});
