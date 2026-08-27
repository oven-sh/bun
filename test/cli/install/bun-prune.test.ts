import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, runBunInstall, tempDir, VerdaccioRegistry } from "harness";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
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

// Copies an installed project into the empty directory `dest` so that the copy stands on its own. A relative link is
// kept. An absolute link into `source` (bun writes those for the cache's index, and for workspace and store links on
// Windows) is pointed at the copy; `fs.cpSync` would leave both kinds pointing into `source`. A directory link is
// recreated as a junction on Windows, which needs no privilege, like the fallback `bun install` itself uses.
function copyTree(source: string, dest: string) {
  const root = realpathSync.native(source);
  const copy = (from: string, to: string) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const entryFrom = join(from, entry.name);
      const entryTo = join(to, entry.name);
      if (entry.isSymbolicLink()) {
        let target = readlinkSync(entryFrom);
        const isDir = statSync(entryFrom, { throwIfNoEntry: false })?.isDirectory() ?? false;
        if (isAbsolute(target)) {
          const inside = relative(root, target);
          if (!inside.startsWith("..") && !isAbsolute(inside)) target = join(dest, inside);
        }
        symlinkSync(target, entryTo, isDir ? "junction" : "file");
      } else if (entry.isDirectory()) {
        mkdirSync(entryTo);
        copy(entryFrom, entryTo);
      } else {
        copyFileSync(entryFrom, entryTo);
      }
    }
  };
  copy(source, dest);
}

// A starting tree that several cases share. It is installed once, on first use, and every case gets its own copy,
// cache included, so a case starts the way its own install would have left it. The copied bunfig names the
// original's cache folder, so the copy gets one that names its own.
function shared(build: () => Promise<string>) {
  let source: Promise<string> | undefined;
  return async () => {
    const from = await (source ??= build());
    const dir = String(tempDir("verdaccio-test-", {}));
    copyTree(from, dir);
    const { install } = Bun.TOML.parse(readFileSync(join(dir, "bunfig.toml"), "utf8")) as {
      install: Record<string, unknown>;
    };
    writeFileSync(
      join(dir, "bunfig.toml"),
      Bun.TOML.stringify({ install: { ...install, cache: join(dir, ".bun-cache") } })!,
    );
    return dir;
  };
}

const perLinker = (build: (linker: Linker) => Promise<string>) =>
  Object.fromEntries(linkers.map(linker => [linker, shared(() => build(linker))])) as Record<
    Linker,
    () => Promise<string>
  >;

const trees = {
  noDeps: shared(() => setup({ name: "foo", dependencies: { "no-deps": "1.0.0" } })),
  oneDepNoDeps2: shared(() => setup({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0" } })),
  noDepsScopedBin: shared(() =>
    setup({ name: "foo", dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" } }),
  ),
  devBins: shared(() =>
    setup({
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "@scoped/has-bin-entry": "1.0.0" },
      devDependencies: { "one-fixed-dep-bins": "1.0.0", "what-bin": "1.0.0" },
    }),
  ),
  prodAndDev: shared(() =>
    setup({ name: "foo", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-fixed-dep": "1.0.0" } }),
  ),
  devRootProdNested: shared(() =>
    setup({ name: "foo", dependencies: { "one-fixed-dep": "1.0.0" }, devDependencies: { "no-deps": "2.0.0" } }),
  ),
  native: shared(() =>
    setup({ name: "foo", dependencies: { "no-deps": "1.0.0", "test-postinstall-skip-native": "1.0.0" } }),
  ),
  isolatedNoDeps: shared(() => setupWithLinker("isolated", { name: "foo", dependencies: { "no-deps": "1.0.0" } })),
  isolatedDevOneDep: shared(() =>
    setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "no-deps": "1.0.0" },
      devDependencies: { "one-dep": "1.0.0" },
    }),
  ),
  isolatedNative: shared(() =>
    setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "test-postinstall-skip-native": "1.0.0" },
    }),
  ),
  optional: perLinker(linker =>
    setupWithLinker(linker, {
      name: "foo",
      dependencies: { "no-deps": "1.0.0" },
      optionalDependencies: { "a-dep": "1.0.1" },
      devDependencies: { "one-fixed-dep": "1.0.0" },
    }),
  ),
  peerDepsFixed: perLinker(linker =>
    setupWithLinker(linker, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0" } }),
  ),
  hoistedRootAndA: shared(() =>
    setupWorkspaces("hoisted", {
      root: { dependencies: { "no-deps": "2.0.0" } },
      packages: { a: { dependencies: { "no-deps": "1.0.0" } } },
    }),
  ),
};

// Every entry of a node_modules folder, as paths relative to it: a package folder (scope folders flattened), a file,
// a bin as `.bin/<name>` (one row on Windows too, where it is a shim pair), a store entry, and a link with its
// target relative to the link. Recurses into each package's own node_modules and into the store, so one list covers
// the whole tree a prune touches. A scope, `.bin` or store folder that is left empty is listed by its own name.
function layout(dir: string, folder = "node_modules") {
  const rows: string[] = [];
  const pkg = (entry: Dirent, parent: string, prefix: string) => {
    const path = join(parent, entry.name);
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) {
      let target = readlinkSync(path);
      if (isAbsolute(target)) target = relative(dirname(path), target);
      rows.push(`${rel} -> ${target.replaceAll("\\", "/")}`);
    } else if (entry.isDirectory()) {
      rows.push(rel);
      walk(join(path, "node_modules"), `${rel}/node_modules/`);
    } else {
      rows.push(rel);
    }
  };
  const orEmpty = (rel: string, list: () => void) => {
    const before = rows.length;
    list();
    if (rows.length === before) rows.push(rel);
  };
  const walk = (nm: string, prefix: string) => {
    if (!lstatSync(nm, { throwIfNoEntry: false })?.isDirectory()) return;
    for (const entry of readdirSync(nm, { withFileTypes: true })) {
      const path = join(nm, entry.name);
      const rel = prefix + entry.name;
      if (!entry.isDirectory()) {
        pkg(entry, nm, prefix);
      } else if (entry.name.startsWith("@")) {
        orEmpty(rel, () => {
          for (const scoped of readdirSync(path, { withFileTypes: true })) pkg(scoped, path, `${rel}/`);
        });
      } else if (entry.name === ".bin") {
        orEmpty(rel, () => {
          for (const bin of new Set(readdirSync(path).map(name => name.replace(/\.(exe|bunx)$/, "")))) {
            rows.push(`${rel}/${bin}`);
          }
        });
      } else if (entry.name === ".bun") {
        orEmpty(rel, () => {
          for (const stored of readdirSync(path, { withFileTypes: true })) {
            if (stored.name === "node_modules") {
              orEmpty(`${rel}/node_modules`, () => walk(join(path, stored.name), `${rel}/node_modules/`));
            } else {
              pkg(stored, path, `${rel}/`);
            }
          }
        });
      } else {
        pkg(entry, nm, prefix);
      }
    }
  };
  walk(join(dir, folder), "");
  return rows.toSorted();
}

// What is at `path`: "link" whatever it points at, "dir", "file", or undefined when there is nothing. `existsSync`
// follows a link, so it cannot tell a removed link from a dangling one.
function kind(path: string) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  return stat === undefined ? undefined : stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : "file";
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
  const dir = await trees.noDepsScopedBin();
  const nm = join(dir, "node_modules");
  const installed = layout(dir);
  expect(installed).toMatchInlineSnapshot(`
    [
      ".bin/has-bin-entry",
      "@scoped/has-bin-entry",
      "no-deps",
    ]
  `);
  plant(dir, "node_modules/junk");
  plant(dir, "node_modules/@scoped/junk");
  plant(dir, "node_modules/@other/thing");
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
  expect(first.stderr).toBe("");
  expect(first.exitCode).toBe(0);

  // The emptied @other scope folder goes with its package; files and dot folders are not packages and stay.
  expect(layout(dir)).toEqual([...installed, ".cache", "README.txt"].toSorted());
  expect(existsSync(join(nm, ".cache", "x"))).toBeTrue();
  expect(await lock(dir)).toBe(lockBefore);

  const second = await prune(dir);
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expect(second.stdout).toMatch(/\(nothing to prune\) \[\d+(\.\d+)?m?s\]\n?$/);
  expect(second.stderr).toBe("");
  expect(second.exitCode).toBe(0);
});

test.concurrent("prunes nested node_modules folders the tree installs into", async () => {
  const dir = await trees.oneDepNoDeps2();
  const nested = join(dir, "node_modules", "one-dep", "node_modules", "no-deps");
  expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.1" });
  const installed = layout(dir);
  expect(installed).toMatchInlineSnapshot(`
    [
      "no-deps",
      "one-dep",
      "one-dep/node_modules/no-deps",
    ]
  `);
  plant(dir, "node_modules/one-dep/node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/one-dep/node_modules)
    1 package removed (checked 4 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(installed);
});

test.concurrent.each([["--production"], ["--prod"], ["--omit=dev"]])(
  "%s removes packages only reachable through devDependencies",
  async (...flags: string[]) => {
    const dir = await trees.devBins();
    // no-deps-bins' tarball lacks its bin file, and bun install skips bin links whose target is missing.
    expect(layout(dir)).toMatchInlineSnapshot(`
      [
        ".bin/has-bin-entry",
        ".bin/what-bin",
        "@scoped/has-bin-entry",
        "no-deps",
        "no-deps-bins",
        "one-fixed-dep-bins",
        "what-bin",
      ]
    `);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await prune(dir, ...flags);
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps-bins@1.0.0
      - one-fixed-dep-bins@1.0.0
      - what-bin@1.0.0
      3 packages removed (checked 5 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    // pnpm#2326: bins of removed packages are cleaned up, on Windows too (shim files instead of links).
    expect(layout(dir)).toEqual([".bin/has-bin-entry", "@scoped/has-bin-entry", "no-deps"]);

    await expectProductionInstallIsNoop(dir);
    expect(await lock(dir)).toBe(lockBefore);
  },
);

test.concurrent("--production keeps a package that prod and dev both need", async () => {
  const [dir, plainDir] = await Promise.all([trees.prodAndDev(), trees.prodAndDev()]);
  expect(layout(dir)).toEqual(["no-deps", "one-fixed-dep"]);

  const [production, plain] = await Promise.all([prune(dir, "--production"), prune(plainDir)]);
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - one-fixed-dep@1.0.0
    1 package removed (checked 2 installed packages)"
  `);
  expect(production.stderr).toBe("");
  expect(production.exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps"]);

  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 2 installed packages across 1 folder (nothing to prune)"
  `);
  expect(plain.stderr).toBe("");
  expect(plain.exitCode).toBe(0);
  expect(layout(plainDir)).toEqual(["no-deps", "one-fixed-dep"]);
});

test.concurrent("--dry-run prints without deleting; --silent deletes without printing", async () => {
  const dir = await trees.noDeps();
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
  expect(withFlags.stderr).toBe("");
  expect(withFlags.exitCode).toBe(0);
  expect(existsSync(junk)).toBeTrue();

  const silentDryRun = await prune(dir, "--dry-run", "--silent");
  expect(silentDryRun.stdout).toBe("");
  expect(silentDryRun.stderr).toBe("");
  expect(silentDryRun.exitCode).toBe(0);
  expect(layout(dir)).toEqual(["junk", "no-deps"]);

  const silent = await prune(dir, "--silent");
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps"]);

  const clean = await prune(dir, "--dry-run");
  expect(lines(clean.stdout)).toStrictEqual([BANNER, "", NOTHING(1, 1)]);
  expect(clean.stderr).toBe("");
  expect(clean.exitCode).toBe(0);
});

test.concurrent("nothing to prune when node_modules is missing or clean", async () => {
  const [missingDir, cleanDir] = await Promise.all([trees.noDeps(), trees.noDeps()]);
  const nm = join(missingDir, "node_modules");
  rmSync(nm, { recursive: true });
  expect(existsSync(join(missingDir, "bun.lock"))).toBeTrue();

  const [missing, clean] = await Promise.all([prune(missingDir), prune(cleanDir, "--production")]);
  expect(out(missing.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! No node_modules folder (nothing to prune)"
  `);
  expect(missing.stderr).toBe("");
  expect(missing.exitCode).toBe(0);
  expect(existsSync(nm)).toBeFalse();

  expect(out(clean.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 1 installed package across 1 folder (nothing to prune)"
  `);
  expect(clean.stderr).toBe("");
  expect(clean.exitCode).toBe(0);
  expect(layout(cleanDir)).toEqual(["no-deps"]);
});

test.concurrent("never follows symlinks out of node_modules", async () => {
  const dir = await trees.noDeps();
  const nm = join(dir, "node_modules");
  const outside = join(dir, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep");
  const link = join(nm, "linked-junk");
  symlinkSync(outside, link, "junction");
  expect(layout(dir)).toEqual(["linked-junk -> ../outside", "no-deps"]);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - linked-junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps"]);
  expect(readdirSync(outside)).toEqual(["keep.txt"]);
});

test.concurrent("refuses to run without a lockfile", async () => {
  const [{ packageDir: noLockDir, packageJson }, installedDir] = await Promise.all([
    registry.createTestDir(),
    trees.noDeps(),
  ]);
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  plant(noLockDir, "node_modules/junk");

  const [noLock, silentNoLock, help, ...positionals] = await Promise.all([
    prune(noLockDir),
    prune(noLockDir, "--silent"),
    prune(noLockDir, "--help"),
    prune(installedDir, "foo"),
    prune(installedDir, "foo", "--silent"),
  ]);
  expect(normalizeBunSnapshot(noLock.stderr)).toMatchInlineSnapshot(`
    "error: missing lockfile, nothing to prune
    note: run 'bun install' first"
  `);
  expect(out(noLock.stdout)).toBe(BANNER);
  expect(noLock.exitCode).toBe(1);

  expect(silentNoLock.stdout).toBe("");
  expect(silentNoLock.stderr).toBe("");
  expect(silentNoLock.exitCode).toBe(1);

  expect(help.stdout).toContain("bun prune");
  expect(help.stdout).toContain("--production");
  expect(help.stdout).toContain("--linker");
  expect(help.stdout).toContain("--filter");
  expect(help.stderr).toBe("");
  expect(help.exitCode).toBe(0);
  expect(layout(noLockDir)).toEqual(["junk"]);

  // Usage errors are the one class --silent does not suppress.
  for (const positional of positionals) {
    expect(normalizeBunSnapshot(positional.stderr)).toMatchInlineSnapshot(`
      "error: bun prune does not take arguments, it always prunes the whole node_modules
      note: run 'bun prune --help' for more information"
    `);
    expect(positional.stdout).toBe("");
    expect(positional.exitCode).toBe(1);
  }
  expect(layout(installedDir)).toEqual(["no-deps"]);
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
  expect(layout(dir)).toEqual(["a -> ../packages/a", "a-dep", "no-deps"]);
  expect(layout(dir, "packages/a/node_modules")).toEqual(["no-deps"]);
  plant(dir, "packages/a/node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(join(dir, "packages", "a"), "--production");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    - junk (node_modules/a/node_modules)
    2 packages removed (checked 5 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  expect(layout(dir)).toEqual(["a -> ../packages/a", "no-deps"]);
  expect(layout(dir, "packages/a/node_modules")).toEqual(["no-deps"]);
});

test.concurrent("keeps dependencies bundled inside a package", async () => {
  const dir = await setup({ name: "foo", dependencies: { "bundled-transitive": "1.0.0" } });
  const installed = layout(dir);
  expect(installed).toMatchInlineSnapshot(`
    [
      "bundled-transitive",
      "bundled-transitive/node_modules/no-deps",
      "no-deps",
      "one-dep",
    ]
  `);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 3 installed packages across 1 folder (nothing to prune)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(installed);
});

// pnpm#881: --production also removes dev-only entries from the store.
test.concurrent("isolated linker: removes unused store entries and their links", async () => {
  const dir = await trees.isolatedDevOneDep();
  const store = join(dir, "node_modules", ".bun");
  expect(layout(dir)).toMatchInlineSnapshot(`
    [
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      ".bun/no-deps@1.0.1",
      ".bun/no-deps@1.0.1/node_modules/no-deps",
      ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
      ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
      ".bun/one-dep@1.0.0",
      ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
      ".bun/one-dep@1.0.0/node_modules/one-dep",
      "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
      "one-dep -> .bun/one-dep@1.0.0/node_modules/one-dep",
    ]
  `);

  plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");
  plant(dir, "node_modules/.bun/no-deps@1.0.0+0123456789abcdef/node_modules/no-deps");
  plant(dir, "node_modules/junk-real");
  const zzz = plant(dir, "node_modules/.bun/zzz@1.0.0/node_modules/zzz");
  symlinkSync(zzz, join(store, "node_modules", "zzz"), "junction");
  expect(layout(dir)).toMatchInlineSnapshot(`
    [
      ".bun/junk@1.0.0",
      ".bun/junk@1.0.0/node_modules/junk",
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0+0123456789abcdef",
      ".bun/no-deps@1.0.0+0123456789abcdef/node_modules/no-deps",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      ".bun/no-deps@1.0.1",
      ".bun/no-deps@1.0.1/node_modules/no-deps",
      ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
      ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
      ".bun/node_modules/zzz -> ../zzz@1.0.0/node_modules/zzz",
      ".bun/one-dep@1.0.0",
      ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
      ".bun/one-dep@1.0.0/node_modules/one-dep",
      ".bun/zzz@1.0.0",
      ".bun/zzz@1.0.0/node_modules/zzz",
      "junk-real",
      "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
      "one-dep -> .bun/one-dep@1.0.0/node_modules/one-dep",
    ]
  `);
  const lockBefore = await lock(dir);

  const { stdout, stderr, exitCode } = await prune(dir, "--production");
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
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  expect(layout(dir)).toMatchInlineSnapshot(`
    [
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
      "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
    ]
  `);
  expect(await lock(dir)).toBe(lockBefore);

  await expectProductionInstallIsNoop(dir);
});

test.concurrent("isolated linker: --verbose does not print the store build timings", async () => {
  const dir = await trees.isolatedDevOneDep();

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

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "isolated");
  expect(out(stdout).split("\n")).toStrictEqual([
    "bun prune <version> (<revision>)",
    "",
    "- no-deps@1.0.0",
    `- ${before}`,
    "2 packages removed (checked 6 installed packages)",
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", after]);
  expect(await install(dir, "--linker", "isolated")).toContain("no changes");
});

test.concurrent("isolated linker + global store: unlinks the store link, never deletes the shared entry", async () => {
  const dir = await setup(
    { name: "foo", devDependencies: { "one-dep": "1.0.0" } },
    { linker: "isolated", globalStore: true },
  );
  const storeEntry = join(dir, "node_modules", ".bun", "one-dep@1.0.0");
  expect(kind(storeEntry)).toBe("link");
  const linksDir = join(installEnv(dir).BUN_INSTALL_CACHE_DIR, "links");
  const globalEntry = readdirSync(linksDir).find(name => name.startsWith("one-dep@1.0.0-"));
  expect(globalEntry).toBeDefined();
  const globalPkgJson = join(linksDir, globalEntry!, "node_modules", "one-dep", "package.json");
  expect(existsSync(globalPkgJson)).toBeTrue();

  const { stdout, stderr, exitCode } = await prune(dir, "--production");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 3 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  expect(kind(storeEntry)).toBeUndefined();
  expect(kind(join(linksDir, globalEntry!))).toBe("dir");
  expect(await file(globalPkgJson).json()).toMatchObject({ name: "one-dep", version: "1.0.0" });
});

test.concurrent("isolated linker: bins of removed packages are removed, live ones kept", async () => {
  const dir = await setupWithLinker("isolated", {
    name: "foo",
    dependencies: { "@scoped/has-bin-entry": "1.0.0" },
    devDependencies: { "what-bin": "1.0.0" },
  });
  expect(layout(dir)).toMatchInlineSnapshot(`
    [
      ".bin/has-bin-entry",
      ".bin/what-bin",
      ".bun/@scoped+has-bin-entry@1.0.0",
      ".bun/@scoped+has-bin-entry@1.0.0/node_modules/.bin/has-bin-entry",
      ".bun/@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
      ".bun/node_modules/@scoped/has-bin-entry -> ../../@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
      ".bun/node_modules/what-bin -> ../what-bin@1.0.0/node_modules/what-bin",
      ".bun/what-bin@1.0.0",
      ".bun/what-bin@1.0.0/node_modules/.bin/what-bin",
      ".bun/what-bin@1.0.0/node_modules/what-bin",
      "@scoped/has-bin-entry -> ../.bun/@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
      "what-bin -> .bun/what-bin@1.0.0/node_modules/what-bin",
    ]
  `);

  const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - what-bin@1.0.0
    1 package removed (checked 4 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  expect(layout(dir)).toMatchInlineSnapshot(`
    [
      ".bin/has-bin-entry",
      ".bun/@scoped+has-bin-entry@1.0.0",
      ".bun/@scoped+has-bin-entry@1.0.0/node_modules/.bin/has-bin-entry",
      ".bun/@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
      ".bun/node_modules/@scoped/has-bin-entry -> ../../@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
      "@scoped/has-bin-entry -> ../.bun/@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
    ]
  `);
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
  plant(dir, "node_modules/junk");
  plant(dir, "node_modules/.bun/node_modules/whatever");
  const cache = plant(dir, "node_modules/.cache/whatever@1.0.0");
  writeFileSync(join(nm, ".yarn-integrity"), "");
  expect(layout(dir)).toEqual([".bun/node_modules/whatever", ".cache", ".yarn-integrity", "junk"]);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 1 installed package)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual([".bun/node_modules/whatever", ".cache", ".yarn-integrity"]);
  expect(existsSync(join(cache, "package.json"))).toBeTrue();
});

// A hoisted prune over a tree whose store still holds entries would report the store as checked without looking at it.
test.concurrent(
  "hoisted: refuses up front when node_modules/.bun holds store entries, even with nothing to remove",
  async () => {
    const dir = await trees.isolatedNoDeps();
    const installed = layout(dir);
    expect(installed).toMatchInlineSnapshot(`
      [
        ".bun/no-deps@1.0.0",
        ".bun/no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
        "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
      ]
    `);

    const [silent, ...refused] = await Promise.all([
      prune(dir, "--linker", "hoisted", "--silent"),
      prune(dir, "--linker", "hoisted"),
      prune(dir, "--linker", "hoisted", "--dry-run"),
      prune(dir, "--linker", "hoisted", "--production"),
    ]);
    for (const { stdout, stderr, exitCode } of refused) {
      expect(out(stdout)).toBe(BANNER);
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
      note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
    `);
      expect(exitCode).toBe(1);
    }
    expect(silent.stdout).toBe("");
    expect(silent.stderr).toBe("");
    expect(silent.exitCode).toBe(1);
    expect(layout(dir)).toEqual(installed);

    const same = await prune(dir, "--linker", "isolated");
    expect(lines(same.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 2)]);
    expect(same.stderr).toBe("");
    expect(same.exitCode).toBe(0);
    expect(layout(dir)).toEqual(installed);
  },
);

test.concurrent(
  "hoisted: a nested tree owned by a package that was replaced with a symlink is not walked",
  async () => {
    const dir = await trees.oneDepNoDeps2();
    const nm = join(dir, "node_modules");
    expect(existsSync(join(nm, "one-dep", "node_modules", "no-deps"))).toBeTrue();
    rmSync(join(nm, "one-dep"), { recursive: true });
    const outside = linkOutside(dir, "node_modules/one-dep", {
      "package.json": JSON.stringify({ name: "one-dep", version: "1.0.0" }),
    });
    plant(outside, "node_modules/no-deps");
    plant(outside, "node_modules/keep-me");
    const before = layout(dir);
    expect(before).toEqual(["no-deps", "one-dep -> ../outside/one-dep"]);

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    Done! Checked 2 installed packages across 1 folder (nothing to prune)"
  `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(before);
    expect(layout(outside)).toEqual(["keep-me", "no-deps"]);
  },
);

test.concurrent("hoisted: a symlinked scope dir is unlinked, not followed", async () => {
  const dir = await trees.noDeps();
  const outside = linkOutside(dir, "node_modules/@fake");
  plant(outside, "thing");
  plant(dir, "node_modules/@real/junk");
  expect(layout(dir)).toEqual(["@fake -> ../outside/@fake", "@real/junk", "no-deps"]);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @fake
    - @real/junk
    2 packages removed (checked 3 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps"]);
  expect(readdirSync(outside)).toEqual(["thing"]);
});

test.concurrent(
  "hoisted: a workspace's nested folder is pruned where bun.lock says the workspace is, not through node_modules/<name>",
  async () => {
    const dir = await trees.hoistedRootAndA();
    const link = join(dir, "node_modules", "a");
    expect(layout(dir)).toEqual(["a -> ../packages/a", "no-deps"]);
    expect(layout(dir, "packages/a/node_modules")).toEqual(["no-deps"]);
    plant(dir, "packages/a/node_modules/junk");

    // `bun link a` run from another checkout leaves node_modules/a pointing at that checkout, which has a node_modules of its own.
    rmSync(link);
    const other = linkOutside(dir, "node_modules/a", {
      "package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    });
    plant(other, "node_modules/victim");
    plant(other, "node_modules/no-deps");

    const dryRun = await prune(dir, "--dry-run", "--linker", "hoisted");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/a/node_modules)
      1 package can be removed (checked 4 installed packages)
        bun prune --linker hoisted"
    `);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(0);
    expect(layout(dir, "packages/a/node_modules")).toEqual(["junk", "no-deps"]);

    // bun.lock records workspace folders relative to the root; prune chdirs there first, so running it from inside a workspace resolves them the same way.
    const { stdout, stderr, exitCode } = await prune({ dir, cwd: join(dir, "packages", "a") }, "--linker", "hoisted");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/a/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["a -> ../outside/a", "no-deps"]);
    expect(layout(dir, "packages/a/node_modules")).toEqual(["no-deps"]);
    expect(layout(other)).toEqual(["no-deps", "victim"]);
  },
);

test.concurrent.skipIf(isWindows)("a symlinked .bin directory is never cleaned through", async () => {
  const dir = await trees.noDeps();
  expect(layout(dir)).toEqual(["no-deps"]);
  const outsideBins = linkOutside(dir, "node_modules/.bin");
  const dangling = join(outsideBins, "dangling");
  symlinkSync("./does-not-exist", dangling);
  plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual([".bin -> ../outside/.bin", "no-deps"]);
  expect(kind(dangling)).toBe("link");
});

test.concurrent("isolated: extraneous symlinks are removed even when the store is clean", async () => {
  const dir = await trees.isolatedNoDeps();
  const installed = layout(dir);
  const outside = linkOutside(dir, "node_modules/ext", { "keep.txt": "keep" });
  const scopedOutside = linkOutside(dir, "node_modules/@ext/thing", { "keep.txt": "keep" });
  expect(layout(dir)).toEqual([...installed, "@ext/thing -> ../../outside/thing", "ext -> ../outside/ext"].toSorted());

  const first = await prune(dir, "--linker", "isolated");
  expect(out(first.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @ext/thing
    - ext
    2 packages removed (checked 4 installed packages)"
  `);
  expect(first.stderr).toBe("");
  expect(first.exitCode).toBe(0);
  expect(layout(dir)).toEqual(installed);
  expect(readdirSync(outside)).toEqual(["keep.txt"]);
  expect(readdirSync(scopedOutside)).toEqual(["keep.txt"]);

  const second = await prune(dir, "--linker", "isolated");
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 2)]);
  expect(second.stderr).toBe("");
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
    const installed = layout(dir);
    expect(installed).toMatchInlineSnapshot(`
      [
        ".bin/has-bin-entry",
        "@scoped/has-bin-entry",
        "no-deps",
        "one-dep",
        "one-dep/node_modules/no-deps",
      ]
    `);
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "2.0.0" } }));
    await install(dir, "--lockfile-only");
    expect(layout(dir)).toEqual(installed);

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    - one-dep@1.0.0
    2 packages removed (checked 3 installed packages)"
  `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    // The emptied scope folder goes with its package; the emptied .bin folder is a dot entry and stays.
    expect(layout(dir)).toEqual([".bin", "no-deps"]);
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
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
  expect(layout(dir)).toEqual([".bin/has-bin-entry", "@scoped/has-bin-entry", "no-deps"]);

  const { stdout, stderr, exitCode } = await prune(dir, "--production");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    1 package removed (checked 2 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual([".bin", "no-deps"]);
});

test.concurrent(
  "isolated: lockfile shrinks -> store entries, alias links and the emptied scope dir go away",
  async () => {
    const dir = await setupWithLinker("isolated", {
      name: "foo",
      dependencies: { "one-dep": "1.0.0", "no-deps": "2.0.0", "@scoped/has-bin-entry": "1.0.0" },
    });
    const nm = join(dir, "node_modules");
    const installed = layout(dir);
    expect(installed).toMatchInlineSnapshot(`
      [
        ".bin/has-bin-entry",
        ".bun/@scoped+has-bin-entry@1.0.0",
        ".bun/@scoped+has-bin-entry@1.0.0/node_modules/.bin/has-bin-entry",
        ".bun/@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
        ".bun/no-deps@1.0.1",
        ".bun/no-deps@1.0.1/node_modules/no-deps",
        ".bun/no-deps@2.0.0",
        ".bun/no-deps@2.0.0/node_modules/no-deps",
        ".bun/node_modules/@scoped/has-bin-entry -> ../../@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
        ".bun/node_modules/no-deps -> ../no-deps@2.0.0/node_modules/no-deps",
        ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
        ".bun/one-dep@1.0.0",
        ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
        ".bun/one-dep@1.0.0/node_modules/one-dep",
        "@scoped/has-bin-entry -> ../.bun/@scoped+has-bin-entry@1.0.0/node_modules/@scoped/has-bin-entry",
        "no-deps -> .bun/no-deps@2.0.0/node_modules/no-deps",
        "one-dep -> .bun/one-dep@1.0.0/node_modules/one-dep",
      ]
    `);
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "2.0.0" } }));
    await install(dir, "--lockfile-only", "--linker", "isolated");
    expect(layout(dir)).toEqual(installed);

    const { stdout, stderr, exitCode } = await prune(dir, "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scoped/has-bin-entry@1.0.0
    - no-deps@1.0.1
    - one-dep@1.0.0
    3 packages removed (checked 7 installed packages)"
  `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toMatchInlineSnapshot(`
      [
        ".bin",
        ".bun/no-deps@2.0.0",
        ".bun/no-deps@2.0.0/node_modules/no-deps",
        ".bun/node_modules/no-deps -> ../no-deps@2.0.0/node_modules/no-deps",
        "no-deps -> .bun/no-deps@2.0.0/node_modules/no-deps",
      ]
    `);
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });
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
  expect(layout(dir)).toEqual(["a -> ../packages/a", "no-deps"]);
  expect(layout(dir, "packages/a/node_modules")).toEqual(["no-deps"]);
  expect(await file(join(dir, "packages", "a", "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
  });

  const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "hoisted");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.0 (packages/a/node_modules)
    1 package removed (checked 3 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["a -> ../packages/a", "no-deps"]);
  expect(layout(dir, "packages/a/node_modules")).toEqual([]);
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
const appLinksToolTree = shared(() => setupWorkspaces("isolated", appLinksTool));

test.concurrent(
  "isolated + workspaces: --production removes a workspace's registry devDependency and its dev-only workspace link, keeps prod links",
  async () => {
    const dir = await appLinksToolTree();
    const app = join(dir, "packages", "app");
    expect(layout(dir)).toMatchInlineSnapshot(`
      [
        ".bun/a-dep@1.0.1",
        ".bun/a-dep@1.0.1/node_modules/a-dep",
        ".bun/no-deps@1.0.0",
        ".bun/no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/a-dep -> ../a-dep@1.0.1/node_modules/a-dep",
        ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
      ]
    `);
    expect(layout(app)).toMatchInlineSnapshot(`
      [
        "a-dep -> ../../../node_modules/.bun/a-dep@1.0.1/node_modules/a-dep",
        "lib -> ../../lib",
        "no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps",
        "tool -> ../../tool",
      ]
    `);

    const plain = await prune(dir, "--linker", "isolated");
    expect(lines(plain.stdout)).toStrictEqual([BANNER, "", NOTHING(6, 3)]);
    expect(plain.stderr).toBe("");
    expect(plain.exitCode).toBe(0);

    const dryRun = await prune(dir, "--production", "--dry-run", "--linker", "isolated");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - tool@1.0.0 (packages/app/node_modules)
      2 packages can be removed (checked 6 installed packages)
        bun prune --production --linker isolated"
    `);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(0);
    expect(kind(join(app, "node_modules", "tool"))).toBe("link");

    const { stdout, stderr, exitCode } = await prune({ dir, cwd: app }, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - tool@1.0.0 (packages/app/node_modules)
      2 packages removed (checked 6 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const pruned = layout(dir);
    const prunedApp = layout(app);
    expect(pruned).toMatchInlineSnapshot(`
      [
        ".bun/no-deps@1.0.0",
        ".bun/no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
      ]
    `);
    expect(prunedApp).toMatchInlineSnapshot(`
      [
        "lib -> ../../lib",
        "no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps",
      ]
    `);
    expect(existsSync(join(dir, "packages", "tool", "package.json"))).toBeTrue();

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(again.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 3)]);
    expect(again.stderr).toBe("");
    expect(again.exitCode).toBe(0);
    await expectProductionInstallIsNoop(dir);
    expect(layout(dir)).toEqual(pruned);
    expect(layout(app)).toEqual(prunedApp);
  },
);

test.concurrent("isolated: a real directory named like a workspace is never deleted", async () => {
  const dir = await appLinksToolTree();
  const app = join(dir, "packages", "app");
  rmSync(join(app, "node_modules", "tool"));
  const planted = plant(dir, "packages/app/node_modules/tool");

  const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package removed (checked 6 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(app)).toMatchInlineSnapshot(`
    [
      "lib -> ../../lib",
      "no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps",
      "tool",
    ]
  `);
  expect(existsSync(join(planted, "package.json"))).toBeTrue();
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
    const mixedApp = join(mixedDir, "packages", "app");
    const devOnlyApp = join(devOnlyDir, "packages", "app");
    const noDepsLink = "no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps";
    expect(layout(mixedApp)).toEqual(["@scope/lib -> ../../../lib", "@scope/tool -> ../../../tool", noDepsLink]);
    expect(layout(devOnlyApp)).toEqual(["@scope/tool -> ../../../tool", noDepsLink]);

    const [mixed, devOnly] = await Promise.all([
      prune(mixedDir, "--production", "--linker", "isolated"),
      prune(devOnlyDir, "--production", "--linker", "isolated"),
    ]);
    expect(out(mixed.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(mixed.stderr).toBe("");
    expect(mixed.exitCode).toBe(0);
    expect(layout(mixedApp)).toEqual(["@scope/lib -> ../../../lib", noDepsLink]);
    expect(existsSync(join(mixedDir, "packages", "tool", "package.json"))).toBeTrue();

    expect(out(devOnly.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(devOnly.stderr).toBe("");
    expect(devOnly.exitCode).toBe(0);
    expect(layout(devOnlyApp)).toEqual([noDepsLink]);
    expect(existsSync(join(devOnlyDir, "packages", "tool", "package.json"))).toBeTrue();

    await Promise.all([expectProductionInstallIsNoop(mixedDir), expectProductionInstallIsNoop(devOnlyDir)]);
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
    const app = join(dir, "packages", "app");
    const b = join(dir, "packages", "b");
    expect(layout(app)).toEqual(["tool -> ../../tool"]);
    const bInstalled = layout(b);
    expect(bInstalled).toMatchInlineSnapshot(`
      [
        "no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps",
        "tool -> ../../tool",
      ]
    `);

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - tool@1.0.0 (packages/app/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(app)).toEqual([]);
    expect(layout(b)).toEqual(bInstalled);
    await expectProductionInstallIsNoop(dir);
    expect(layout(app)).toEqual([]);
    expect(layout(b)).toEqual(bInstalled);
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
    const app = join(dir, "packages", "app");
    const tool = join(dir, "packages", "tool");
    const installed = { root: layout(dir), app: layout(app), tool: layout(tool) };
    expect(installed).toEqual(
      linker === "hoisted"
        ? { root: ["app -> ../packages/app", "no-deps", "tool -> ../packages/tool"], app: [], tool: [] }
        : {
            root: [
              ".bun/no-deps@1.0.0",
              ".bun/no-deps@1.0.0/node_modules/no-deps",
              ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
              "tool -> ../packages/tool",
            ],
            app: ["tool -> ../../tool"],
            tool: ["no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps"],
          },
    );

    const first = await prune(dir, "--production", "--linker", linker);
    expect(lines(first.stdout)).toStrictEqual(
      linker === "hoisted"
        ? [BANNER, "", NOTHING(3, 1)]
        : [BANNER, "", "- tool@1.0.0 (packages/app/node_modules)", REMOVED(1, 4)],
    );
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    // The hoisted linker links every workspace into the root folder, so the app's dev edge has no link of its own to remove.
    const pruned = { ...installed, app: linker === "hoisted" ? installed.app : [] };
    expect({ root: layout(dir), app: layout(app), tool: layout(tool) }).toEqual(pruned);
    expect(existsSync(join(tool, "package.json"))).toBeTrue();

    const second = await prune(dir, "--production", "--linker", linker);
    expect(lines(second.stdout)).toStrictEqual([BANNER, "", linker === "hoisted" ? NOTHING(3, 1) : NOTHING(3, 4)]);
    expect(second.stderr).toBe("");
    expect(second.exitCode).toBe(0);
    await expectProductionInstallIsNoop(dir);
    expect({ root: layout(dir), app: layout(app), tool: layout(tool) }).toEqual(pruned);
  },
);

test.concurrent.each(linkers)("%s: refuses when package.json changed since bun.lock was written", async linker => {
  const dir = await setupWithLinker(linker, { name: "foo", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" } });
  plant(dir, "node_modules/junk");
  const before = layout(dir);
  await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  const lockBefore = await lock(dir);

  const [plain, dryRun, silent] = await Promise.all([
    prune(dir, "--linker", linker),
    prune(dir, "--dry-run", "--linker", linker),
    prune(dir, "--silent", "--linker", linker),
  ]);
  expectRefused(plain);
  expectRefused(dryRun);
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(layout(dir)).toEqual(before);
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
  expect(layout(dir)).toEqual(
    linker === "hoisted"
      ? ["no-deps"]
      : [
          ".bun/no-deps@1.0.0",
          ".bun/no-deps@1.0.0/node_modules/no-deps",
          ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
          "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
        ],
  );
});

test.concurrent.each([
  ["a dependency is added", { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } }],
  ["a range changes but still matches the installed version", { dependencies: { "no-deps": "^1.0.0" } }],
  ["an override is added", { dependencies: { "no-deps": "1.0.0" }, overrides: { "no-deps": "1.0.0" } }],
] as const)("refuses when %s", async (_, edited) => {
  const dir = await trees.noDeps();
  plant(dir, "node_modules/junk");
  const lockBefore = await lock(dir);
  await write(join(dir, "package.json"), JSON.stringify({ name: "foo", ...edited }));

  expectRefused(await prune(dir));
  expect(layout(dir)).toEqual(["junk", "no-deps"]);
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
  await writeWorkspaces(dir, join(dir, "package.json"), catalogRoot("1.0.1"));

  expectRefused(await prune(dir, "--linker", "hoisted"));
  expect(layout(dir)).toEqual(["a -> ../packages/a", "junk", "no-deps"]);
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
  const before = { root: layout(dir), a: layout(dir, "packages/a/node_modules") };
  expect(before).toEqual({
    root: ["a -> ../packages/a", "a-dep", "b -> ../packages/b", "no-deps"],
    a: ["junk", "no-deps"],
  });
  await write(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "b", version: "1.0.0" }));

  const refused = await Promise.all([
    prune(dir, "--linker", "hoisted"),
    prune({ dir, cwd: join(dir, "packages", "a") }, "--linker", "hoisted"),
    prune(dir, "--filter", "a", "--linker", "hoisted"),
  ]);
  for (const result of refused) expectRefused(result);
  expect({ root: layout(dir), a: layout(dir, "packages/a/node_modules") }).toEqual(before);
});

test.concurrent.each(linkers)("%s: a workspace lifecycle script is not out of sync", async linker => {
  const dir = await setupWorkspaces(linker, {
    packages: { a: { dependencies: { "no-deps": "1.0.0" }, scripts: { postinstall: "echo ok" } } },
  });
  const installed = layout(dir);
  plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", linker);
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(installed);
});

test.concurrent("trustedDependencies stripped from bun.lock is not out of sync", async () => {
  const dir = await setup({ name: "foo", dependencies: { "no-deps": "1.0.0" }, trustedDependencies: ["no-deps"] });
  const before = await lock(dir);
  expect(before).toContain('"trustedDependencies"');
  const stripped = before.replace(/\n  "trustedDependencies": \[\n(?:    [^\n]*\n)*  \],/, "");
  expect(stripped).not.toContain('"trustedDependencies"');
  await write(join(dir, "bun.lock"), stripped);
  plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps"]);
});

const prunedCheckout = (app: Record<string, unknown>) => ({
  packages: {
    app: { dependencies: { "no-deps": "1.0.0", ...app } },
    other: { dependencies: { "left-pad": "1.0.0" } },
  },
});
const prunedCheckoutTree = perLinker(linker => setupWorkspaces(linker, prunedCheckout({})));

// The hoisted root folder, and the isolated store and app folder, of a prunedCheckout tree once `other` is gone from disk.
const prunedCheckoutHoisted = ["app -> ../packages/app", "left-pad", "no-deps", "other -> ../packages/other"];
const prunedCheckoutIsolated = [
  ".bun/left-pad@1.0.0",
  ".bun/left-pad@1.0.0/node_modules/left-pad",
  ".bun/no-deps@1.0.0",
  ".bun/no-deps@1.0.0/node_modules/no-deps",
  ".bun/node_modules/left-pad -> ../left-pad@1.0.0/node_modules/left-pad",
  ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
];
const prunedCheckoutApp = ["no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps"];

test.concurrent("prunes a checkout whose bun.lock lists a workspace that is no longer on disk", async () => {
  const dir = await prunedCheckoutTree.hoisted();
  rmSync(join(dir, "packages", "other"), { recursive: true });
  plant(dir, "node_modules/junk");
  expect(layout(dir)).toEqual([...prunedCheckoutHoisted, "junk"].toSorted());

  const { lines: merged, exitCode } = await pruneMerged(dir, "--linker", "hoisted");
  expect(merged).toStrictEqual([BANNER, "", PRUNED_NOTE, "- junk", "- left-pad@1.0.0", "- other", REMOVED(3, 5)]);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["app -> ../packages/app", "no-deps"]);

  await install(dir, "--frozen-lockfile", "--linker", "hoisted");
  expect(layout(dir)).toEqual(["app -> ../packages/app", "no-deps"]);

  const second = await prune(dir, "--linker", "hoisted");
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expect(normalizeBunSnapshot(second.stderr)).toBe(PRUNED_NOTE);
  expect(second.exitCode).toBe(0);
});

test.concurrent("isolated: a workspace missing from disk no longer keeps its store entries", async () => {
  const dir = await prunedCheckoutTree.isolated();
  const app = join(dir, "packages", "app");
  rmSync(join(dir, "packages", "other"), { recursive: true });
  plant(dir, "node_modules/junk");
  expect(layout(dir)).toEqual([...prunedCheckoutIsolated, "junk"]);
  expect(layout(app)).toEqual(prunedCheckoutApp);

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "isolated");
  expect(normalizeBunSnapshot(stderr)).toBe(PRUNED_NOTE);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    - left-pad@1.0.0
    2 packages removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  const pruned = [
    ".bun/no-deps@1.0.0",
    ".bun/no-deps@1.0.0/node_modules/no-deps",
    ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
  ];
  expect(layout(dir)).toEqual(pruned);
  expect(layout(app)).toEqual(prunedCheckoutApp);

  await install(dir, "--frozen-lockfile", "--linker", "isolated");
  expect(layout(dir)).toEqual(pruned);
  expect(layout(app)).toEqual(prunedCheckoutApp);

  const second = await prune(dir, "--linker", "isolated");
  expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 3)]);
  expect(normalizeBunSnapshot(second.stderr)).toBe(PRUNED_NOTE);
  expect(second.exitCode).toBe(0);
});

test.concurrent("hoisted: --filter on a pruned checkout does not protect the missing workspace", async () => {
  const dir = await prunedCheckoutTree.hoisted();
  rmSync(join(dir, "packages", "other"), { recursive: true });
  expect(layout(dir)).toEqual(prunedCheckoutHoisted);

  const { stdout, stderr, exitCode } = await prune(dir, "--filter", "app", "--linker", "hoisted");
  expect(normalizeBunSnapshot(stderr)).toBe(PRUNED_NOTE);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - left-pad@1.0.0
    - other
    2 packages removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["app -> ../packages/app", "no-deps"]);
});

test.concurrent("a survivor depending on a missing workspace makes prune fail like install does", async () => {
  const dir = await setupWorkspaces("hoisted", prunedCheckout({ other: "workspace:*" }));
  rmSync(join(dir, "packages", "other"), { recursive: true });
  plant(dir, "node_modules/junk");
  const before = layout(dir);
  expect(before).toEqual([...prunedCheckoutHoisted, "junk"].toSorted());

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "error: workspace "app" depends on workspace "other" (packages/other), which is listed in bun.lock but not on disk
    note: a pruned checkout must keep every workspace that its remaining workspaces depend on"
  `);
  expect(out(stdout)).toBe(BANNER);
  expect(exitCode).toBe(1);
  expect(layout(dir)).toEqual(before);
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
    expect(layout(dir)).toEqual([
      "app -> ../packages/app",
      "shared -> ../packages/shared",
      "shared-alias -> ../packages/shared",
    ]);

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - shared-alias@1.0.0
      1 package removed (checked 3 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["app -> ../packages/app", "shared -> ../packages/shared"]);
    await expectProductionInstallIsNoop(dir);

    const second = await prune(dir, "--production", "--linker", "hoisted");
    expect(lines(second.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
    expect(second.stderr).toBe("");
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
    plant(dir, "packages/a/node_modules/junk");
    plant(dir, "packages/b/node_modules/junk");
    const folders = () => ({
      root: layout(dir),
      a: layout(dir, "packages/a/node_modules"),
      b: layout(dir, "packages/b/node_modules"),
    });
    // one-fixed-dep needs no-deps 1.0.0 while the root holds 2.0.0, so its copy is nested.
    const oneFixedDep = ["one-fixed-dep", "one-fixed-dep/node_modules/no-deps"];
    expect(folders()).toEqual({
      root: ["a -> ../packages/a", "a-dep", "b -> ../packages/b", "left-pad", "no-deps", ...oneFixedDep],
      a: ["junk", "no-deps"],
      b: ["junk", "no-deps"],
    });

    const onlyA = await prune(dir, "--production", "--filter", "a", "--linker", "hoisted");
    expect(out(onlyA.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk (node_modules/a/node_modules)
      2 packages removed (checked 8 installed packages)"
    `);
    expect(onlyA.stderr).toBe("");
    expect(onlyA.exitCode).toBe(0);
    expect(folders()).toEqual({
      root: ["a -> ../packages/a", "b -> ../packages/b", "left-pad", "no-deps", ...oneFixedDep],
      a: ["no-deps"],
      b: ["junk", "no-deps"],
    });
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "2.0.0" });

    const onlyRoot = await prune(dir, "--production", "--filter", "root", "--linker", "hoisted");
    expect(out(onlyRoot.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - left-pad@1.0.0
      1 package removed (checked 5 installed packages)"
    `);
    expect(onlyRoot.stderr).toBe("");
    expect(onlyRoot.exitCode).toBe(0);
    expect(folders()).toEqual({
      root: ["a -> ../packages/a", "b -> ../packages/b", "no-deps", ...oneFixedDep],
      a: ["no-deps"],
      b: ["junk", "no-deps"],
    });

    const everything = await prune(dir, "--production", "--linker", "hoisted");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - junk (node_modules/b/node_modules)
      - one-fixed-dep@1.0.0
      2 packages removed (checked 7 installed packages)"
    `);
    expect(everything.stderr).toBe("");
    expect(everything.exitCode).toBe(0);
    const pruned = {
      root: ["a -> ../packages/a", "b -> ../packages/b", "no-deps"],
      a: ["no-deps"],
      b: ["no-deps"],
    };
    expect(folders()).toEqual(pruned);
    await expectProductionInstallIsNoop(dir);
    expect(folders()).toEqual(pruned);
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
    const folders = () => ({
      store: storeEntries(dir),
      a: layout(dir, "packages/a/node_modules"),
      b: layout(dir, "packages/b/node_modules"),
    });
    const link = (name: string, entry: string) => `${name} -> ../../../node_modules/.bun/${entry}/node_modules/${name}`;
    expect(folders()).toEqual({
      store: ["a-dep@1.0.1", "left-pad@1.0.0", "no-deps@1.0.0", "one-fixed-dep@1.0.0"],
      a: [link("a-dep", "a-dep@1.0.1"), link("no-deps", "no-deps@1.0.0"), link("one-fixed-dep", "one-fixed-dep@1.0.0")],
      b: [link("a-dep", "a-dep@1.0.1"), link("left-pad", "left-pad@1.0.0")],
    });

    const onlyA = await prune(dir, "--production", "--filter", "a", "--linker", "isolated");
    expect(out(onlyA.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/a/node_modules)
      - one-fixed-dep@1.0.0
      2 packages removed (checked 7 installed packages)"
    `);
    expect(onlyA.stderr).toBe("");
    expect(onlyA.exitCode).toBe(0);
    expect(folders()).toEqual({
      store: ["a-dep@1.0.1", "left-pad@1.0.0", "no-deps@1.0.0"],
      a: [link("no-deps", "no-deps@1.0.0")],
      b: [link("a-dep", "a-dep@1.0.1"), link("left-pad", "left-pad@1.0.0")],
    });

    const everything = await prune(dir, "--production", "--linker", "isolated");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - left-pad@1.0.0
      2 packages removed (checked 6 installed packages)"
    `);
    expect(everything.stderr).toBe("");
    expect(everything.exitCode).toBe(0);
    const pruned = { store: ["no-deps@1.0.0"], a: [link("no-deps", "no-deps@1.0.0")], b: [] };
    expect(folders()).toEqual(pruned);
    await expectProductionInstallIsNoop(dir);
    expect(folders()).toEqual(pruned);
  },
);

test.concurrent(
  "isolated: --production --filter unlinks one workspace's dev deps at a time, the store entry waits for an unfiltered run",
  async () => {
    const pkg = { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } };
    const dir = await setupWorkspaces("isolated", { packages: { selected: pkg, unselected: pkg } });
    const folders = () => ({
      store: storeEntries(dir),
      selected: layout(dir, "packages/selected/node_modules"),
      unselected: layout(dir, "packages/unselected/node_modules"),
    });
    const aDep = "a-dep -> ../../../node_modules/.bun/a-dep@1.0.1/node_modules/a-dep";
    const noDeps = "no-deps -> ../../../node_modules/.bun/no-deps@1.0.0/node_modules/no-deps";
    expect(folders()).toEqual({
      store: ["a-dep@1.0.1", "no-deps@1.0.0"],
      selected: [aDep, noDeps],
      unselected: [aDep, noDeps],
    });

    const first = await prune(dir, "--production", "--filter", "selected", "--linker", "isolated");
    expect(out(first.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/selected/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    expect(folders()).toEqual({
      store: ["a-dep@1.0.1", "no-deps@1.0.0"],
      selected: [noDeps],
      unselected: [aDep, noDeps],
    });

    const second = await prune(dir, "--production", "--filter", "unselected", "--linker", "isolated");
    expect(out(second.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1 (packages/unselected/node_modules)
      1 package removed (checked 4 installed packages)"
    `);
    expect(second.stderr).toBe("");
    expect(second.exitCode).toBe(0);
    expect(folders()).toEqual({ store: ["a-dep@1.0.1", "no-deps@1.0.0"], selected: [noDeps], unselected: [noDeps] });

    const everything = await prune(dir, "--production", "--linker", "isolated");
    expect(out(everything.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      1 package removed (checked 4 installed packages)"
    `);
    expect(everything.stderr).toBe("");
    expect(everything.exitCode).toBe(0);
    const pruned = { store: ["no-deps@1.0.0"], selected: [noDeps], unselected: [noDeps] };
    expect(folders()).toEqual(pruned);
    await expectProductionInstallIsNoop(dir);
    expect(folders()).toEqual(pruned);
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
    expect(byPath.stderr).toBe("");
    expect(byPath.exitCode).toBe(0);
    expect(existsSync(appJunk)).toBeFalse();
    expect(existsSync(libJunk)).toBeTrue();
    expect(existsSync(rootJunk)).toBe(linker === "isolated");
    if (storeJunk) {
      expect(existsSync(storeJunk)).toBeFalse();
    }

    const byGlob = await prune({ dir, cwd: join(dir, "packages", "app") }, "--filter", "li*", "--linker", linker);
    expect(lines(byGlob.stdout)).toStrictEqual(removed([shown("lib", "lib-junk")], linker === "hoisted" ? 5 : 4));
    expect(byGlob.stderr).toBe("");
    expect(byGlob.exitCode).toBe(0);
    expect(existsSync(libJunk)).toBeFalse();

    if (linker === "isolated") {
      const root = await prune(dir, "--filter", "./", "--linker", linker);
      expect(lines(root.stdout)).toStrictEqual(removed(["- root-junk"], 4));
      expect(root.stderr).toBe("");
      expect(root.exitCode).toBe(0);
    }
    expect(existsSync(rootJunk)).toBeFalse();
    for (const ws of ["app", "lib"]) {
      expect(existsSync(join(dir, "packages", ws, "node_modules", "no-deps", "package.json"))).toBeTrue();
    }
  },
);

test.concurrent("hoisted: --filter with no match is an error; path filters resolve against the cwd", async () => {
  const dir = await trees.hoistedRootAndA();
  plant(dir, "packages/a/node_modules/junk");
  const before = { root: layout(dir), a: layout(dir, "packages/a/node_modules") };
  expect(before).toEqual({ root: ["a -> ../packages/a", "no-deps"], a: ["junk", "no-deps"] });
  const listing = (...flags: string[]) => [
    BANNER,
    "",
    "- junk (node_modules/a/node_modules)",
    CAN_BE_REMOVED(1, 4),
    APPLY_HINT(...flags, "--linker", "hoisted"),
  ];

  const [noMatch, noneMatch, silentNoMatch] = await Promise.all([
    prune(dir, "--filter", "nope", "--linker", "hoisted"),
    prune(dir, "--filter", "nope", "--filter", "nada", "--linker", "hoisted"),
    prune(dir, "--filter", "nope", "--silent", "--linker", "hoisted"),
  ]);
  expect(normalizeBunSnapshot(noMatch.stderr)).toBe('error: No workspace packages matched the filter "nope"');
  expect(out(noMatch.stdout)).toBe(BANNER);
  expect(noMatch.exitCode).toBe(1);

  expect(normalizeBunSnapshot(noneMatch.stderr)).toBe(
    'error: No workspace packages matched the filters "nope", "nada"',
  );
  expect(out(noneMatch.stdout)).toBe(BANNER);
  expect(noneMatch.exitCode).toBe(1);

  expect(silentNoMatch.stdout).toBe("");
  expect(silentNoMatch.stderr).toBe("");
  expect(silentNoMatch.exitCode).toBe(1);
  expect({ root: layout(dir), a: layout(dir, "packages/a/node_modules") }).toEqual(before);

  const [someMatch, fromRoot, fromInside] = await Promise.all([
    // A typo next to a real name is not fatal, but it is reported before the verdict.
    pruneMerged(dir, "--filter", "a", "--filter", "nope", "--dry-run", "--linker", "hoisted"),
    prune(dir, "--filter", "./packages/a", "--dry-run", "--linker", "hoisted"),
    prune({ dir, cwd: join(dir, "packages", "a") }, "--filter", ".", "--dry-run", "--linker", "hoisted"),
  ]);
  expect(someMatch.lines).toStrictEqual([
    BANNER,
    "",
    'warn: No workspace packages matched the filter "nope"',
    "- junk (node_modules/a/node_modules)",
    CAN_BE_REMOVED(1, 4),
    APPLY_HINT("--filter", "a", "--filter", "nope", "--linker", "hoisted"),
  ]);
  expect(someMatch.exitCode).toBe(0);

  expect(fromRoot.stderr).toBe("");
  expect(lines(fromRoot.stdout)).toStrictEqual(listing("--filter", "./packages/a"));
  expect(fromRoot.exitCode).toBe(0);

  expect(fromInside.stderr).toBe("");
  expect(lines(fromInside.stdout)).toStrictEqual(listing("--filter", "."));
  expect(fromInside.exitCode).toBe(0);
  expect({ root: layout(dir), a: layout(dir, "packages/a/node_modules") }).toEqual(before);

  const { stdout, stderr, exitCode } = await prune(dir, "--filter", "a", "--linker", "hoisted");
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/a/node_modules)
    1 package removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect({ root: layout(dir), a: layout(dir, "packages/a/node_modules") }).toEqual({ ...before, a: ["no-deps"] });
});

test.concurrent.each(linkers)(
  "%s: --filter warns about the unmatched pattern and still applies the rest",
  async linker => {
    const dir = await setupWorkspaces(linker, {
      packages: { app: { dependencies: { "no-deps": "1.0.0" } }, lib: {} },
    });
    const installed = layout(dir, "packages/app/node_modules");
    plant(dir, "packages/app/node_modules/junk");

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
    expect(layout(dir, "packages/app/node_modules")).toEqual(installed);

    const silent = await prune(dir, "--filter", "app", "--filter", "nope", "--silent", "--linker", linker);
    expect(silent.stdout).toBe("");
    expect(silent.stderr).toBe("");
    expect(silent.exitCode).toBe(0);
  },
);

test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: optionalDependencies survive --production and go away with --omit=optional",
  async linker => {
    const [prodDir, omitDir] = await Promise.all([trees.optional[linker](), trees.optional[linker]()]);
    const hoisted = linker === "hoisted";
    // Under the isolated linker a package is its store entry, the hidden-hoist link to it, and the root link.
    const aDep = [
      ".bun/a-dep@1.0.1",
      ".bun/a-dep@1.0.1/node_modules/a-dep",
      ".bun/node_modules/a-dep -> ../a-dep@1.0.1/node_modules/a-dep",
      "a-dep -> .bun/a-dep@1.0.1/node_modules/a-dep",
    ];
    const noDeps = [
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
      "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
    ];
    const oneFixedDep = [
      ".bun/node_modules/one-fixed-dep -> ../one-fixed-dep@1.0.0/node_modules/one-fixed-dep",
      ".bun/one-fixed-dep@1.0.0",
      ".bun/one-fixed-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.0/node_modules/no-deps",
      ".bun/one-fixed-dep@1.0.0/node_modules/one-fixed-dep",
      "one-fixed-dep -> .bun/one-fixed-dep@1.0.0/node_modules/one-fixed-dep",
    ];
    const installed = layout(prodDir);
    expect(installed).toEqual(
      hoisted ? ["a-dep", "no-deps", "one-fixed-dep"] : [...aDep, ...noDeps, ...oneFixedDep].toSorted(),
    );
    expect(layout(omitDir)).toEqual(installed);
    const removed = (row: string) => [BANNER, "", row, REMOVED(1, hoisted ? 3 : 6)];

    const [production, omit] = await Promise.all([
      prune(prodDir, "--production", "--linker", linker),
      prune(omitDir, "--omit=optional", "--linker", linker),
    ]);
    expect(lines(production.stdout)).toStrictEqual(removed("- one-fixed-dep@1.0.0"));
    expect(production.stderr).toBe("");
    expect(production.exitCode).toBe(0);
    expect(layout(prodDir)).toEqual(hoisted ? ["a-dep", "no-deps"] : [...aDep, ...noDeps].toSorted());

    expect(lines(omit.stdout)).toStrictEqual(removed("- a-dep@1.0.1"));
    expect(omit.stderr).toBe("");
    expect(omit.exitCode).toBe(0);
    expect(layout(omitDir)).toEqual(hoisted ? ["no-deps", "one-fixed-dep"] : [...noDeps, ...oneFixedDep].toSorted());
  },
);

test.concurrent.each([["--os=aix"], ["--cpu=s390x"]])(
  "%s removes packages that are disabled for that platform, plain prune keeps them",
  async (flag: string) => {
    const dir = await trees.native();
    expect(layout(dir)).toEqual(["no-deps", "test-postinstall-skip-native"]);

    const host = await prune(dir);
    expect(lines(host.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
    expect(host.stderr).toBe("");
    expect(host.exitCode).toBe(0);
    expect(layout(dir)).toEqual(["no-deps", "test-postinstall-skip-native"]);

    const other = await prune(dir, flag);
    expect(out(other.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - test-postinstall-skip-native@1.0.0
      1 package removed (checked 2 installed packages)"
    `);
    expect(other.stderr).toBe("");
    expect(other.exitCode).toBe(0);
    expect(layout(dir)).toEqual(["no-deps"]);
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
    const installed = layout(dir);
    plant(dir, "node_modules/junk");

    const { stdout, stderr, exitCode } = await prune(dir, "--linker", linker);
    expect(out(stdout)).toBe(`bun prune <version> (<revision>)\n\n- junk\n${REMOVED(1, linker === "hoisted" ? 4 : 6)}`);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(installed);
    expect(await file(join(nm, "my-alias", "package.json")).json()).toMatchObject({
      name: "no-deps",
      version: "1.0.0",
    });
    if (linker === "isolated") {
      expect(storeEntries(dir)).toEqual(["no-deps@1.0.0", "no-deps@1.0.1", "one-dep@1.0.0"]);
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
  const installed = layout(dir);
  expect(installed).toMatchInlineSnapshot(`
    [
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      ".bun/no-deps@1.0.1",
      ".bun/no-deps@1.0.1/node_modules/no-deps",
      ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
      ".bun/one-dep@1.0.0",
      ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
      ".bun/one-dep@1.0.0/node_modules/one-dep",
      "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
      "one-dep -> .bun/one-dep@1.0.0/node_modules/one-dep",
    ]
  `);

  const clean = await prune(dir, "--linker", "isolated");
  expect(lines(clean.stdout)).toStrictEqual([BANNER, "", NOTHING(5, 2)]);
  expect(clean.stderr).toBe("");
  expect(clean.exitCode).toBe(0);
  expect(layout(dir)).toEqual(installed);

  const production = await prune(dir, "--production", "--linker", "isolated");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 5 installed packages)"
  `);
  expect(production.stderr).toBe("");
  expect(production.exitCode).toBe(0);
  expect(layout(dir)).toMatchInlineSnapshot(`
    [
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      ".bun/node_modules",
      "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
    ]
  `);
  expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "1.0.0" });
});

test.concurrent.skipIf(isWindows || process.getuid?.() === 0)(
  "a failed deletion is reported, the rest is removed, exit code 1",
  async () => {
    const dir = await trees.noDeps();
    const nm = join(dir, "node_modules");
    plant(dir, "node_modules/junk-a");
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
      // The read-only junk-b keeps its inner folder (the rmdir is what fails); the file inside it went first.
      expect(layout(dir)).toEqual(["junk-b", "no-deps"]);
      expect(kind(inner)).toBe("dir");

      // --silent still reports what could not be removed; the exit code alone would hide which entry it was.
      const silent = await prune(dir, "--silent");
      expect(silent.stdout).toBe("");
      expect(normalizeBunSnapshot(silent.stderr)).toMatch(failure);
      expect(silent.exitCode).toBe(1);
      expect(layout(dir)).toEqual(["junk-b", "no-deps"]);
      expect(kind(inner)).toBe("dir");
    } finally {
      chmodSync(junkB, 0o755);
    }

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk-b
    1 package removed (checked 2 installed packages)"
  `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["no-deps"]);
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
  expect(await file(ran).text()).toBe("PRE\nPOST\nPREPARE\n");
  rmSync(ran);
  plant(dir, "node_modules/junk");

  const plain = await prune(dir);
  expect(out(plain.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 3 installed packages)"
  `);
  expect(plain.stderr).toBe("");
  expect(plain.exitCode).toBe(0);
  expect(layout(dir)).toEqual(["a-dep", "no-deps"]);
  expect(existsSync(ran)).toBeFalse();

  const production = await prune(dir, "--production");
  expect(out(production.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package removed (checked 2 installed packages)"
  `);
  expect(production.stderr).toBe("");
  expect(production.exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps"]);
  expect(existsSync(ran)).toBeFalse();
});

test.concurrent.each(["hoisted", "isolated"] as Linker[])(
  "%s: --omit=peer removes what bun install --omit=peer would not install",
  async linker => {
    const [dir, plainDir] = await Promise.all([trees.peerDepsFixed[linker](), trees.peerDepsFixed[linker]()]);
    const installed = layout(dir);
    // The store key of a package with a peer carries a hash of the peer resolution.
    const entry = linker === "isolated" ? storeEntries(dir).find(name => name.startsWith("peer-deps-fixed@"))! : "";
    const consumer = [
      `.bun/${entry}`,
      `.bun/${entry}/node_modules/no-deps -> ../../no-deps@1.1.0/node_modules/no-deps`,
      `.bun/${entry}/node_modules/peer-deps-fixed`,
      `.bun/node_modules/peer-deps-fixed -> ../${entry}/node_modules/peer-deps-fixed`,
      `peer-deps-fixed -> .bun/${entry}/node_modules/peer-deps-fixed`,
    ];
    if (linker === "isolated") expect(entry).toMatch(/^peer-deps-fixed@1\.0\.0\+[0-9a-f]{16}$/);
    expect(installed).toEqual(
      linker === "hoisted"
        ? ["no-deps", "peer-deps-fixed"]
        : [
            ".bun/no-deps@1.1.0",
            ".bun/no-deps@1.1.0/node_modules/no-deps",
            ".bun/node_modules/no-deps -> ../no-deps@1.1.0/node_modules/no-deps",
            ...consumer,
          ].toSorted(),
    );
    expect(layout(plainDir)).toEqual(installed);

    const [omit, plain] = await Promise.all([
      prune(dir, "--omit=peer", "--linker", linker),
      prune(plainDir, "--linker", linker),
    ]);
    expect(lines(omit.stdout)).toStrictEqual([BANNER, "", "- no-deps@1.1.0", REMOVED(1, linker === "hoisted" ? 2 : 3)]);
    expect(omit.stderr).toBe("");
    expect(omit.exitCode).toBe(0);
    expect(layout(dir)).toEqual(linker === "hoisted" ? ["peer-deps-fixed"] : consumer.toSorted());
    if (linker === "hoisted") {
      expect(await install(dir, "--omit=peer")).toContain("no changes");
    }

    expect(lines(plain.stdout)).toStrictEqual([BANNER, "", linker === "hoisted" ? NOTHING(2, 1) : NOTHING(3, 2)]);
    expect(plain.stderr).toBe("");
    expect(plain.exitCode).toBe(0);
    expect(layout(plainDir)).toEqual(installed);
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

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout).split("\n")).toStrictEqual([
      "bun prune <version> (<revision>)",
      "",
      "- no-deps@1.0.0",
      "1 package removed (checked 4 installed packages)",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0", entry]);
    expect(kind(join(nm, "no-deps"))).toBeUndefined();
    expect(existsSync(peerLink)).toBeTrue();
    expect(await file(join(nm, consumer, "package.json")).json()).toMatchObject({ name: consumer, version: "1.0.0" });

    await expectProductionInstallIsNoop(dir);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.0", entry]);
    expect(kind(join(nm, "no-deps"))).toBeUndefined();

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(again.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(again.stderr).toBe("");
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
    expect(kind(join(nm, "no-deps"))).toBeUndefined();
    const productionTree = storeTree();

    const noop = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(noop.stdout)).toStrictEqual([BANNER, "", NOTHING(5, 2)]);
    expect(noop.stderr).toBe("");
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
    expect(kind(join(nm, "no-deps"))).toBe("link");
    expect(kind(join(nm, "a-dep"))).toBe("link");

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout).split("\n")).toStrictEqual([
      "bun prune <version> (<revision>)",
      "",
      "- a-dep@1.0.1",
      "- no-deps@2.0.0",
      "2 packages removed (checked 10 installed packages)",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "one-dep@1.0.0", productionEntry, fullEntry].toSorted());
    expect(kind(join(nm, "no-deps"))).toBeUndefined();
    expect(kind(join(nm, "a-dep"))).toBeUndefined();
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

  const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout).split("\n")).toStrictEqual([
    "bun prune <version> (<revision>)",
    "",
    "- a-dep@1.0.1",
    "- no-deps@1.0.0",
    `- ${before}`,
    "3 packages removed (checked 8 installed packages)",
  ]);
  expect(stderr).toBe("");
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
  expect(layout(dir)).toEqual(["local", "local/node_modules/inner"]);
  plant(dir, "node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["local", "local/node_modules/inner"]);
});

// pnpm#13676
test.concurrent(
  "hoisted: a nested copy is kept while the root copy is still the old version and removed once bun install replaced it",
  async () => {
    const dir = await trees.oneDepNoDeps2();
    const nm = join(dir, "node_modules");
    const nested = join(nm, "one-dep", "node_modules", "no-deps");
    const rootPkgJson = join(nm, "no-deps", "package.json");
    expect(await file(join(nested, "package.json")).json()).toMatchObject({ version: "1.0.1" });

    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "1.0.1" } }),
    );
    await install(dir, "--lockfile-only");
    expect(layout(dir)).toEqual(["no-deps", "one-dep", "one-dep/node_modules/no-deps"]);
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
    expect(layout(dir)).toEqual(["no-deps", "one-dep", "one-dep/node_modules/no-deps"]);
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });

    await install(dir);
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "1.0.1" });
    expect(layout(dir)).toEqual(["no-deps", "one-dep", "one-dep/node_modules/no-deps"]);

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps@1.0.1 (node_modules/one-dep/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["no-deps", "one-dep"]);
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "1.0.1" });
  },
);

test.concurrent(
  "hoisted: --production keeps the nested copy a production package resolves to while the root holds the dev version",
  async () => {
    const [dir, silentDir] = await Promise.all([trees.devRootProdNested(), trees.devRootProdNested()]);
    const rootPkgJson = join(dir, "node_modules", "no-deps", "package.json");
    const nestedPkgJson = join(dir, "node_modules", "one-fixed-dep", "node_modules", "no-deps", "package.json");
    const installed = ["no-deps", "one-fixed-dep", "one-fixed-dep/node_modules/no-deps"];
    expect(layout(dir)).toEqual(installed);
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });
    expect(await file(nestedPkgJson).json()).toMatchObject({ version: "1.0.0" });

    // The root copy is the one a full install hoists there, not a stale tree:
    // no "is not the version bun.lock expects" warning, no install hint.
    const [{ stdout, stderr, exitCode }, silent] = await Promise.all([
      prune(dir, "--production"),
      prune(silentDir, "--production", "--silent"),
    ]);
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      Done! Checked 3 installed packages across 2 folders (nothing to prune)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(installed);
    expect(await file(nestedPkgJson).json()).toMatchObject({ version: "1.0.0" });
    expect(await file(rootPkgJson).json()).toMatchObject({ version: "2.0.0" });

    expect(silent.stdout).toBe("");
    expect(silent.stderr).toBe("");
    expect(silent.exitCode).toBe(0);
    expect(layout(silentDir)).toEqual(installed);

    // A root copy whose version the lockfile does not know anywhere is a
    // genuinely stale tree and still warns under --production.
    const rootPkg = await file(rootPkgJson).json();
    await write(rootPkgJson, JSON.stringify({ ...rootPkg, version: "9.9.9" }));
    const stale = await prune(dir, "--production", "--dry-run");
    expect(out(stale.stderr)).toBe(
      `${WARN("node_modules/no-deps", "node_modules/one-fixed-dep/node_modules/no-deps")}\n${NOTE}`,
    );
    expect(lines(stale.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(stale.exitCode).toBe(0);
    await write(rootPkgJson, JSON.stringify(rootPkg));

    await runBunInstall(installEnv(dir), dir, { production: true });
    expect(layout(dir)).toEqual(installed);
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
    plant(dir, "node_modules/one-dep/node_modules/a-dep");
    plant(dir, "node_modules/one-dep/node_modules/junk");

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
    expect(layout(dir)).toEqual([
      "a-dep",
      "no-deps",
      "one-dep",
      "one-dep/node_modules/a-dep",
      "one-dep/node_modules/no-deps",
    ]);
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
    expect(layout(dir)).toEqual(["a -> ../packages/a", "no-deps"]);
    expect(layout(dir, "packages/a/node_modules")).toEqual(["no-deps"]);
    expect(await file(workspacePkgJson).json()).toMatchObject({ version: "1.0.0" });
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
    const installed = layout(dir);
    expect(installed).toMatchInlineSnapshot(`
      [
        ".bin/what-bin",
        ".bun/node_modules/uses-what-bin -> ../uses-what-bin@1.0.0/node_modules/uses-what-bin",
        ".bun/node_modules/what-bin -> ../what-bin@1.0.0/node_modules/what-bin",
        ".bun/uses-what-bin@1.0.0",
        ".bun/uses-what-bin@1.0.0/node_modules/.bin/what-bin",
        ".bun/uses-what-bin@1.0.0/node_modules/uses-what-bin",
        ".bun/uses-what-bin@1.0.0/node_modules/what-bin -> ../../what-bin@1.0.0/node_modules/what-bin",
        ".bun/what-bin@1.0.0",
        ".bun/what-bin@1.0.0/node_modules/.bin/what-bin",
        ".bun/what-bin@1.0.0/node_modules/what-bin",
        "uses-what-bin -> .bun/uses-what-bin@1.0.0/node_modules/uses-what-bin",
        "what-bin -> .bun/what-bin@1.0.0/node_modules/what-bin",
      ]
    `);

    const dryRun = await prune(dir, "--production", "--dry-run", "--linker", "isolated");
    expect(out(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - what-bin@1.0.0
      1 package can be removed (checked 4 installed packages)
        bun prune --production --linker isolated"
    `);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(0);
    expect(layout(dir)).toEqual(installed);

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - what-bin@1.0.0
      1 package removed (checked 4 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const pruned = layout(dir);
    expect(pruned).toMatchInlineSnapshot(`
      [
        ".bin",
        ".bun/node_modules/uses-what-bin -> ../uses-what-bin@1.0.0/node_modules/uses-what-bin",
        ".bun/node_modules/what-bin -> ../what-bin@1.0.0/node_modules/what-bin",
        ".bun/uses-what-bin@1.0.0",
        ".bun/uses-what-bin@1.0.0/node_modules/.bin/what-bin",
        ".bun/uses-what-bin@1.0.0/node_modules/uses-what-bin",
        ".bun/uses-what-bin@1.0.0/node_modules/what-bin -> ../../what-bin@1.0.0/node_modules/what-bin",
        ".bun/what-bin@1.0.0",
        ".bun/what-bin@1.0.0/node_modules/.bin/what-bin",
        ".bun/what-bin@1.0.0/node_modules/what-bin",
        "uses-what-bin -> .bun/uses-what-bin@1.0.0/node_modules/uses-what-bin",
      ]
    `);

    const again = await prune(dir, "--production", "--linker", "isolated");
    expect(lines(again.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(again.stderr).toBe("");
    expect(again.exitCode).toBe(0);
    await expectProductionInstallIsNoop(dir);
    expect(layout(dir)).toEqual(pruned);
  },
);

// pnpm#13676
test.concurrent("hoisted: nested node_modules of packages without a tree node are pruned", async () => {
  const dir = await trees.noDepsScopedBin();
  const nm = join(dir, "node_modules");
  plant(dir, "node_modules/no-deps/node_modules/junk");
  plant(dir, "node_modules/@scoped/has-bin-entry/node_modules/@other/thing");
  writeFileSync(join(nm, "no-deps", "node_modules", "keep.txt"), "");
  expect(layout(dir)).toEqual([
    ".bin/has-bin-entry",
    "@scoped/has-bin-entry",
    "@scoped/has-bin-entry/node_modules/@other/thing",
    "no-deps",
    "no-deps/node_modules/junk",
    "no-deps/node_modules/keep.txt",
  ]);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @other/thing (node_modules/@scoped/has-bin-entry/node_modules)
    - junk (node_modules/no-deps/node_modules)
    2 packages removed (checked 4 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual([
    ".bin/has-bin-entry",
    "@scoped/has-bin-entry",
    "no-deps",
    "no-deps/node_modules/keep.txt",
  ]);
  expect(existsSync(join(nm, "@scoped", "has-bin-entry", "node_modules", "@other"))).toBeFalse();
});

// pnpm#8307
test.concurrent("refuses to prune a hoisted install with the isolated linker", async () => {
  const dir = await setupWithLinker("hoisted", { name: "foo", dependencies: { "one-dep": "1.0.0" } });
  expect(layout(dir)).toEqual(["no-deps", "one-dep"]);

  const refused = await Promise.all([
    prune(dir, "--linker", "isolated"),
    prune(dir, "--linker", "isolated", "--dry-run"),
  ]);
  for (const { stdout, stderr, exitCode } of refused) {
    expect(out(stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: node_modules was installed with the hoisted linker, but bun prune would use the isolated linker
      note: run 'bun prune --linker hoisted' to prune it as-is, or 'bun install' to reinstall with the isolated linker"
    `);
    expect(exitCode).toBe(1);
  }
  expect(layout(dir)).toEqual(["no-deps", "one-dep"]);

  const same = await prune(dir, "--linker", "hoisted");
  expect(lines(same.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expect(same.stderr).toBe("");
  expect(same.exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps", "one-dep"]);
});

// pnpm#8307
test.concurrent("refuses to prune an isolated install with the hoisted linker", async () => {
  const dir = await setupWithLinker("isolated", { name: "foo", devDependencies: { "one-dep": "1.0.0" } });
  const installed = layout(dir);
  expect(installed).toMatchInlineSnapshot(`
    [
      ".bun/no-deps@1.0.1",
      ".bun/no-deps@1.0.1/node_modules/no-deps",
      ".bun/node_modules/no-deps -> ../no-deps@1.0.1/node_modules/no-deps",
      ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
      ".bun/one-dep@1.0.0",
      ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
      ".bun/one-dep@1.0.0/node_modules/one-dep",
      "one-dep -> .bun/one-dep@1.0.0/node_modules/one-dep",
    ]
  `);

  const mismatch = await prune(dir, "--production", "--linker", "hoisted");
  expect(out(mismatch.stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
  expect(normalizeBunSnapshot(mismatch.stderr)).toMatchInlineSnapshot(`
    "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
    note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
  `);
  expect(mismatch.exitCode).toBe(1);
  expect(layout(dir)).toEqual(installed);

  const same = await prune(dir, "--production", "--linker", "isolated");
  expect(out(same.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1
    - one-dep@1.0.0
    2 packages removed (checked 3 installed packages)"
  `);
  expect(same.stderr).toBe("");
  expect(same.exitCode).toBe(0);
  expect(layout(dir)).toEqual([".bun/node_modules"]);
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
    const installed = layout(dir);
    const hoistLink = (version: string) => `.bun/node_modules/no-deps -> ../no-deps@${version}/node_modules/no-deps`;
    // Both versions are direct dependencies under the real name, so which one the hidden-hoist `no-deps` link points at
    // depends on the install's order. Prune only removes entries: a link at the dev 2.0.0 goes with it and leaves the
    // hidden hoist folder empty, one at the alias's 1.0.0 stays, and the production install that follows is what
    // points a new link at 1.0.0.
    const hoisted = linker === "hoisted";
    const kept = [
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      "aliased -> .bun/no-deps@1.0.0/node_modules/no-deps",
    ];
    expect(installed).toEqual(
      hoisted
        ? ["aliased", "no-deps"]
        : [
            ...kept,
            ".bun/no-deps@2.0.0",
            ".bun/no-deps@2.0.0/node_modules/no-deps",
            installed.includes(hoistLink("2.0.0")) ? hoistLink("2.0.0") : hoistLink("1.0.0"),
            "no-deps -> .bun/no-deps@2.0.0/node_modules/no-deps",
          ].toSorted(),
    );
    const pruned = hoisted
      ? ["aliased"]
      : [...kept, installed.includes(hoistLink("2.0.0")) ? ".bun/node_modules" : hoistLink("1.0.0")].toSorted();

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", linker);
    expect(lines(stdout)).toStrictEqual([BANNER, "", "- no-deps@2.0.0", REMOVED(1, hoisted ? 2 : 4)]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(pruned);
    expect(await file(join(nm, "aliased", "package.json")).json()).toMatchObject({ version: "1.0.0" });
    await expectProductionInstallIsNoop(dir);
    expect(layout(dir)).toEqual(hoisted ? pruned : [...kept, hoistLink("1.0.0")].toSorted());
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
    expect(kind(staleLink)).toBe("link");
    expect(existsSync(staleLink)).toBeFalse();
    const before = layout(dir, linkFolder);

    const { stdout, stderr, exitCode } = await prune(dir, "--linker", linker);
    // A dangling link has no package.json to read a version from; only a non-root folder is named.
    const row = linker === "hoisted" ? "- a" : `- a (${linkFolder})`;
    expect(lines(stdout)).toStrictEqual([BANNER, "", row, REMOVED(1, 3)]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir, linkFolder)).toEqual(before.filter(entry => !entry.startsWith("a ")));
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
    expect(storeEntries(dir)).toStrictEqual(["a-dep@1.0.1", "no-deps@1.0.1", "one-dep@1.0.0"]);
    const a = join(dir, "packages", "a");
    const oneDep = "one-dep -> ../../../node_modules/.bun/one-dep@1.0.0/node_modules/one-dep";
    expect(layout(a)).toEqual(["a-dep -> ../../../node_modules/.bun/a-dep@1.0.1/node_modules/a-dep", oneDep]);
    plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");

    const { stdout, stderr, exitCode } = await prune(dir, "--production");
    expect(stderr).toBe("");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk@1.0.0
      2 packages removed (checked 6 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(storeEntries(dir)).toStrictEqual(["no-deps@1.0.1", "one-dep@1.0.0"]);
    expect(layout(a)).toEqual([oneDep]);
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
    expect(layout(dir)).toEqual(["a -> ../packages/a", "a-dep", "no-deps", "one-dep"]);
    plant(dir, "node_modules/junk");
    plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");

    // The refusal names the linker that was picked.
    const withStore = await prune(dir, "--production");
    expect(normalizeBunSnapshot(withStore.stderr)).toMatchInlineSnapshot(`
      "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
      note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
    `);
    expect(out(withStore.stdout)).toBe(BANNER);
    expect(withStore.exitCode).toBe(1);
    expect(layout(dir)).toEqual([
      ".bun/junk@1.0.0",
      ".bun/junk@1.0.0/node_modules/junk",
      "a -> ../packages/a",
      "a-dep",
      "junk",
      "no-deps",
      "one-dep",
    ]);
    rmSync(join(nm, ".bun"), { recursive: true });

    const { stdout, stderr, exitCode } = await prune(dir, "--production");
    expect(stderr).toBe("");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - a-dep@1.0.1
      - junk
      2 packages removed (checked 5 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["a -> ../packages/a", "no-deps", "one-dep"]);
  },
);

test.concurrent("without --linker, a project without workspaces is pruned with the hoisted linker", async () => {
  const dir = await setup({ name: "foo", dependencies: { "one-dep": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } });
  expect(await lock(dir)).toContain('"configVersion": 1,');
  const nm = join(dir, "node_modules");
  expect(layout(dir)).toEqual(["a-dep", "no-deps", "one-dep"]);
  plant(dir, "node_modules/junk");
  plant(dir, "node_modules/.bun/junk@1.0.0/node_modules/junk");

  const withStore = await prune(dir, "--production");
  expect(normalizeBunSnapshot(withStore.stderr)).toMatchInlineSnapshot(`
    "error: node_modules was installed with the isolated linker, but bun prune would use the hoisted linker
    note: run 'bun prune --linker isolated' to prune it as-is, or 'bun install' to reinstall with the hoisted linker"
  `);
  expect(out(withStore.stdout)).toBe(BANNER);
  expect(withStore.exitCode).toBe(1);
  expect(layout(dir)).toEqual([
    ".bun/junk@1.0.0",
    ".bun/junk@1.0.0/node_modules/junk",
    "a-dep",
    "junk",
    "no-deps",
    "one-dep",
  ]);
  rmSync(join(nm, ".bun"), { recursive: true });

  const { stdout, stderr, exitCode } = await prune(dir, "--production");
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    - junk
    2 packages removed (checked 4 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps", "one-dep"]);
});

test.concurrent.each([["--os=aix"], ["--cpu=s390x"]])(
  "isolated: %s removes the store entry and link of a package disabled for that platform, plain prune keeps them",
  async (flag: string) => {
    const dir = await trees.isolatedNative();
    const installed = layout(dir);
    expect(installed).toMatchInlineSnapshot(`
      [
        ".bun/no-deps@1.0.0",
        ".bun/no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/test-postinstall-skip-native -> ../test-postinstall-skip-native@1.0.0/node_modules/test-postinstall-skip-native",
        ".bun/test-postinstall-skip-native@1.0.0",
        ".bun/test-postinstall-skip-native@1.0.0/node_modules/test-postinstall-skip-native",
        "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
        "test-postinstall-skip-native -> .bun/test-postinstall-skip-native@1.0.0/node_modules/test-postinstall-skip-native",
      ]
    `);

    const host = await prune(dir, "--linker", "isolated");
    expect(lines(host.stdout)).toStrictEqual([BANNER, "", NOTHING(4, 2)]);
    expect(host.stderr).toBe("");
    expect(host.exitCode).toBe(0);
    expect(layout(dir)).toEqual(installed);

    const other = await prune(dir, flag, "--linker", "isolated");
    expect(out(other.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - test-postinstall-skip-native@1.0.0
      1 package removed (checked 4 installed packages)"
    `);
    expect(other.stderr).toBe("");
    expect(other.exitCode).toBe(0);
    expect(layout(dir)).toEqual([
      ".bun/no-deps@1.0.0",
      ".bun/no-deps@1.0.0/node_modules/no-deps",
      ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
      "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
    ]);
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

  const tree = layout(dir);
  expect(tree).toMatchInlineSnapshot(`
    [
      ".bun/bundled-transitive@1.0.0",
      ".bun/bundled-transitive@1.0.0/node_modules/bundled-transitive",
      ".bun/bundled-transitive@1.0.0/node_modules/bundled-transitive/node_modules/no-deps",
      ".bun/bundled-transitive@1.0.0/node_modules/one-dep -> ../../one-dep@1.0.0/node_modules/one-dep",
      ".bun/no-deps@1.0.1",
      ".bun/no-deps@1.0.1/node_modules/no-deps",
      ".bun/node_modules/bundled-transitive -> ../bundled-transitive@1.0.0/node_modules/bundled-transitive",
      ".bun/node_modules/no-deps -> ../no-deps@1.0.1/node_modules/no-deps",
      ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
      ".bun/one-dep@1.0.0",
      ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
      ".bun/one-dep@1.0.0/node_modules/one-dep",
      "bundled-transitive -> .bun/bundled-transitive@1.0.0/node_modules/bundled-transitive",
    ]
  `);

  for (const flags of [[], ["--production"]]) {
    const { stdout, stderr, exitCode } = await prune(dir, ...flags, "--linker", "isolated");
    expect(lines(stdout)).toStrictEqual([BANNER, "", NOTHING(4, 2)]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(tree);
    expect(existsSync(bundled)).toBeTrue();
  }
  await expectProductionInstallIsNoop(dir);
  expect(layout(dir)).toEqual(tree);
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
  const installed = layout(dir);
  expect(installed).toMatchInlineSnapshot(`
    [
      "bundled-transitive",
      "bundled-transitive/node_modules/no-deps",
      "no-deps",
      "one-dep",
      "one-dep/node_modules/no-deps",
    ]
  `);
  plant(dir, "node_modules/bundled-transitive/node_modules/junk");
  plant(dir, "node_modules/one-dep/node_modules/junk");

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk (node_modules/one-dep/node_modules)
    1 package removed (checked 5 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual([...installed, "bundled-transitive/node_modules/junk"].toSorted());
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
    plant(dir, "node_modules/no-deps/node_modules/git-pkg");
    writeFileSync(rootTag, "0000000000000000000000000000000000000000");
    expect(layout(dir)).toEqual(["git-pkg", "no-deps", "no-deps/node_modules/git-pkg"]);

    const stale = await prune(dir, "--linker", "hoisted");
    expect(lines(stale.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(out(stale.stderr)).toBe(
      `${WARN("node_modules/git-pkg", "node_modules/no-deps/node_modules/git-pkg")}\n${NOTE}`,
    );
    expect(stale.exitCode).toBe(0);
    expect(layout(dir)).toEqual(["git-pkg", "no-deps", "no-deps/node_modules/git-pkg"]);

    writeFileSync(rootTag, tag);
    const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
    expect(stderr).toBe("");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - git-pkg (node_modules/no-deps/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["git-pkg", "no-deps"]);
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
    plant(dir, "node_modules/no-deps/node_modules/left-pad");
    plant(dir, "node_modules/no-deps/node_modules/junk");

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
    expect(layout(dir)).toEqual(["no-deps", "no-deps/node_modules/left-pad"]);

    renameSync(join(dir, "left-pad.moved"), join(nm, "left-pad"));
    renameSync(rootPkgJson, join(nm, "left-pad", "package.json.bak"));
    const mismatch = await prune(dir, "--linker", "hoisted");
    expect(lines(mismatch.stdout)).toStrictEqual([BANNER, "", NOTHING(3, 2)]);
    expect(out(mismatch.stderr)).toBe(`${WARN("node_modules/left-pad", kept)}\n${NOTE}`);
    expect(mismatch.exitCode).toBe(0);
    expect(layout(dir)).toEqual(["left-pad", "no-deps", "no-deps/node_modules/left-pad"]);

    renameSync(join(nm, "left-pad", "package.json.bak"), rootPkgJson);
    const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
    expect(stderr).toBe("");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - left-pad (node_modules/no-deps/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["left-pad", "no-deps"]);
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
  expect(layout(dir)).toEqual(["linked -> ../linked", "no-deps"]);
  plant(dir, "node_modules/no-deps/node_modules/linked");

  const { stdout, stderr, exitCode } = await prune(dir, "--linker", "hoisted");
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - linked (node_modules/no-deps/node_modules)
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["linked -> ../linked", "no-deps"]);
  expect(await file(join(dir, "linked", "package.json")).json()).toStrictEqual({ name: "linked", version: "1.0.0" });
});

test.concurrent("hoisted: a nested copy left behind by an override to a tarball is removed", async () => {
  const dir = await trees.oneDepNoDeps2();
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
  expect(layout(dir)).toEqual(["no-deps", "one-dep", "one-dep/node_modules/no-deps"]);

  const { stdout, stderr, exitCode } = await prune(dir);
  expect(stderr).toBe("");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.0.1 (node_modules/one-dep/node_modules)
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps", "one-dep"]);
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
    plant(dir, "node_modules/no-deps/node_modules/no-deps-build-metadata");

    const { stdout, stderr, exitCode } = await prune(dir);
    expect(stderr).toBe("");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps-build-metadata (node_modules/no-deps/node_modules)
      1 package removed (checked 3 installed packages)"
    `);
    expect(exitCode).toBe(0);
    expect(layout(dir)).toEqual(["no-deps", "no-deps-build-metadata"]);
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
    const installed = layout(dir);
    expect(installed).toMatchInlineSnapshot(`
      [
        ".bun/a-dep@1.0.1",
        ".bun/a-dep@1.0.1/node_modules/a-dep",
        ".bun/no-deps@1.0.1",
        ".bun/no-deps@1.0.1/node_modules/no-deps",
        ".bun/node_modules/a-dep -> ../a-dep@1.0.1/node_modules/a-dep",
        ".bun/node_modules/no-deps -> ../no-deps@1.0.1/node_modules/no-deps",
        ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
        ".bun/one-dep@1.0.0",
        ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
        ".bun/one-dep@1.0.0/node_modules/one-dep",
        "a-dep -> .bun/a-dep@1.0.1/node_modules/a-dep",
        "no-deps -> .bun/no-deps@1.0.1/node_modules/no-deps",
        "one-dep -> .bun/one-dep@1.0.0/node_modules/one-dep",
      ]
    `);
    expect(await file(join(nm, "no-deps", "package.json")).json()).toMatchObject({ version: "1.0.1" });

    const plain = await prune(dir, "--linker", "isolated");
    expect(lines(plain.stdout)).toStrictEqual([BANNER, "", NOTHING(6, 2)]);
    expect(plain.stderr).toBe("");
    expect(plain.exitCode).toBe(0);
    expect(layout(dir)).toEqual(installed);

    const production = await prune(dir, "--production", "--linker", "isolated");
    expect(out(production.stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - no-deps@1.0.1
      - one-dep@1.0.0
      2 packages removed (checked 6 installed packages)"
    `);
    expect(production.stderr).toBe("");
    expect(production.exitCode).toBe(0);
    expect(layout(dir)).toMatchInlineSnapshot(`
      [
        ".bun/a-dep@1.0.1",
        ".bun/a-dep@1.0.1/node_modules/a-dep",
        ".bun/node_modules/a-dep -> ../a-dep@1.0.1/node_modules/a-dep",
        "a-dep -> .bun/a-dep@1.0.1/node_modules/a-dep",
      ]
    `);
    await expectProductionInstallIsNoop(dir);
  },
);

test.concurrent(
  "isolated: an unwanted entry's peer-hash variant and scoped hidden-hoist links follow it out",
  async () => {
    const dir = await trees.isolatedDevOneDep();
    const store = join(dir, "node_modules", ".bun");
    const hiddenHoist = join(store, "node_modules");
    plant(dir, "node_modules/.bun/one-dep@1.0.0+0123456789abcdef/node_modules/one-dep");
    const scopedEntry = plant(dir, "node_modules/.bun/@scope+zzz@1.0.0/node_modules/@scope/zzz");
    mkdirSync(join(hiddenHoist, "@scope"), { recursive: true });
    symlinkSync(scopedEntry, join(hiddenHoist, "@scope", "zzz"), "junction");
    symlinkSync(
      join(store, "no-deps@1.0.0", "node_modules", "no-deps"),
      join(hiddenHoist, "@scope", "no-deps"),
      "junction",
    );
    expect(layout(dir)).toMatchInlineSnapshot(`
      [
        ".bun/@scope+zzz@1.0.0",
        ".bun/@scope+zzz@1.0.0/node_modules/@scope/zzz",
        ".bun/no-deps@1.0.0",
        ".bun/no-deps@1.0.0/node_modules/no-deps",
        ".bun/no-deps@1.0.1",
        ".bun/no-deps@1.0.1/node_modules/no-deps",
        ".bun/node_modules/@scope/no-deps -> ../../no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/@scope/zzz -> ../../@scope+zzz@1.0.0/node_modules/@scope/zzz",
        ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/one-dep -> ../one-dep@1.0.0/node_modules/one-dep",
        ".bun/one-dep@1.0.0",
        ".bun/one-dep@1.0.0+0123456789abcdef",
        ".bun/one-dep@1.0.0+0123456789abcdef/node_modules/one-dep",
        ".bun/one-dep@1.0.0/node_modules/no-deps -> ../../no-deps@1.0.1/node_modules/no-deps",
        ".bun/one-dep@1.0.0/node_modules/one-dep",
        "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
        "one-dep -> .bun/one-dep@1.0.0/node_modules/one-dep",
      ]
    `);

    const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
    expect(out(stdout)).toMatchInlineSnapshot(`
      "bun prune <version> (<revision>)

      - @scope/zzz@1.0.0
      - no-deps@1.0.1
      - one-dep@1.0.0
      - one-dep@1.0.0+0123456789abcdef
      4 packages removed (checked 7 installed packages)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(layout(dir)).toMatchInlineSnapshot(`
      [
        ".bun/no-deps@1.0.0",
        ".bun/no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/@scope/no-deps -> ../../no-deps@1.0.0/node_modules/no-deps",
        ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
        "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
      ]
    `);
  },
);

test.concurrent("isolated: an emptied scope dir of dangling hidden-hoist links is removed", async () => {
  const dir = await trees.isolatedDevOneDep();
  const store = join(dir, "node_modules", ".bun");
  const scopeDir = join(store, "node_modules", "@scope");
  const scopedEntry = plant(dir, "node_modules/.bun/@scope+zzz@1.0.0/node_modules/@scope/zzz");
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(scopedEntry, join(scopeDir, "zzz"), "junction");

  const { stdout, stderr, exitCode } = await prune(dir, "--production", "--linker", "isolated");
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - @scope/zzz@1.0.0
    - no-deps@1.0.1
    - one-dep@1.0.0
    3 packages removed (checked 6 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual([
    ".bun/no-deps@1.0.0",
    ".bun/no-deps@1.0.0/node_modules/no-deps",
    ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
    "no-deps -> .bun/no-deps@1.0.0/node_modules/no-deps",
  ]);
  expect(kind(scopeDir)).toBeUndefined();
  expect(kind(join(store, "node_modules"))).toBe("dir");
});

test.concurrent("isolated: --filter on a pruned checkout does not protect the missing workspace", async () => {
  const dir = await prunedCheckoutTree.isolated();
  rmSync(join(dir, "packages", "other"), { recursive: true });
  expect(layout(dir)).toEqual(prunedCheckoutIsolated);

  const { stdout, stderr, exitCode } = await prune(dir, "--filter", "app", "--linker", "isolated");
  expect(normalizeBunSnapshot(stderr)).toBe(PRUNED_NOTE);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - left-pad@1.0.0
    1 package removed (checked 3 installed packages)"
  `);
  expect(exitCode).toBe(0);
  const pruned = [
    ".bun/no-deps@1.0.0",
    ".bun/no-deps@1.0.0/node_modules/no-deps",
    ".bun/node_modules/no-deps -> ../no-deps@1.0.0/node_modules/no-deps",
  ];
  expect(layout(dir)).toEqual(pruned);
  expect(layout(join(dir, "packages", "app"))).toEqual(prunedCheckoutApp);
  await install(dir, "--frozen-lockfile", "--linker", "isolated");
  expect(layout(dir)).toEqual(pruned);
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
  const dir = await trees.noDeps();
  plant(dir, "node_modules/junk");
  await write(join(dir, "bun.lock"), "{ this is not a lockfile");

  const [{ stdout, stderr, exitCode }, silent] = await Promise.all([prune(dir), prune(dir, "--silent")]);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "1 | { this is not a lockfile
          ^
    error: Expected string but found "this"
        at bun.lock:1:3
    error: failed to load lockfile: ParserError"
  `);
  expect(out(stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
  expect(exitCode).toBe(1);

  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(layout(dir)).toEqual(["junk", "no-deps"]);
});

test.concurrent("missing package.json is an error; --cwd prunes another directory", async () => {
  const dir = await trees.noDeps();
  using empty = tempDir("prune-empty", {});
  plant(dir, "node_modules/junk");

  const [missing, silent] = await Promise.all([prune(String(empty)), prune(String(empty), "--silent")]);
  expect(normalizeBunSnapshot(missing.stderr)).toBe("error: missing package.json, nothing to prune");
  expect(missing.stdout).toBe("");
  expect(missing.exitCode).toBe(1);

  // Like the missing-lockfile refusal, this is a state of the project rather than a usage error, so --silent applies.
  expect(silent.stdout).toBe("");
  expect(silent.stderr).toBe("");
  expect(silent.exitCode).toBe(1);
  expect(readdirSync(String(empty))).toEqual([]);

  const { stdout, stderr, exitCode } = await prune({ dir, cwd: String(empty) }, "--cwd", dir);
  expect(out(stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - junk
    1 package removed (checked 2 installed packages)"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(layout(dir)).toEqual(["no-deps"]);
  expect(readdirSync(String(empty))).toEqual([]);
});

test.concurrent("a node_modules that is a file is an error", async () => {
  const dir = await trees.noDeps();
  const nm = join(dir, "node_modules");
  rmSync(nm, { recursive: true });
  writeFileSync(nm, "not a directory");

  const [{ stdout, stderr, exitCode }, silent] = await Promise.all([prune(dir), prune(dir, "--silent")]);
  expect(normalizeBunSnapshot(stderr)).toMatch(/^E[A-Z]+: .+: failed to open node_modules \(open\)$/);
  expect(out(stdout)).toMatchInlineSnapshot(`"bun prune <version> (<revision>)"`);
  expect(exitCode).toBe(1);

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
      1 package removed (checked 2 installed packages)"
    `);
    expect(pruned.stderr).toBe("");
    expect(pruned.exitCode).toBe(0);
    expect(layout(dir)).toEqual(["no-deps"]);

    const script = await bun(dir, "run", "prune");
    expect(script.stdout).toBe("SCRIPT_RAN\n");
    expect(normalizeBunSnapshot(script.stderr)).toBe("$ echo SCRIPT_RAN");
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

  const [noOptional, omit] = await Promise.all([
    prune(dir, "--no-optional", "--dry-run"),
    prune(dir, "--omit=optional", "--dry-run"),
  ]);
  expect(noOptional.stderr).toBe("");
  expect(lines(noOptional.stdout)).toStrictEqual([BANNER, "", NOTHING(2, 1)]);
  expect(noOptional.exitCode).toBe(0);

  expect(out(omit.stdout)).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - a-dep@1.0.1
    1 package can be removed (checked 2 installed packages)
      bun prune --omit=optional"
  `);
  expect(omit.stderr).toBe("");
  expect(omit.exitCode).toBe(0);
  expect(layout(dir)).toEqual(["a-dep", "no-deps"]);
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
