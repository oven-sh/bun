import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { exists, realpath, rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot, readdirSorted, runBunInstall } from "harness";
import { dirname, join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

// CI exports BUN_INSTALL_CACHE_DIR, which overrides the harness bunfig's per-test `cache`; concurrent cases sharing one cache race on Windows.
const installEnv = (dir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });

async function run(dir: string, ...cmd: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: installEnv(dir),
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const dedupe = (dir: string, ...args: string[]) => run(dir, "dedupe", ...args);

function lock(dir: string) {
  return file(join(dir, "bun.lock")).text();
}

const HEADER = "bun dedupe <version> (<revision>)";

function firstLines(stdout: string, n: number) {
  return normalizeBunSnapshot(stdout).split("\n").slice(0, n);
}

function nodeModulesVersion(packageDir: string, ...segments: string[]) {
  return file(join(packageDir, "node_modules", ...segments, "package.json"))
    .json()
    .then(pkg => pkg.version);
}

// `packages` is every lockfile entry except the root.
function noDuplicates(packages: number) {
  return `🎉 No duplicates — checked ${packages} package${packages === 1 ? "" : "s"}, every one already resolves to a single version`;
}

// The removed labels and the summary; the install that follows prints its own count line but never the `+ pkg@ver` tree.
function expectRemoved(stdout: string, ...labels: string[]) {
  const lines = normalizeBunSnapshot(stdout).split("\n");
  expect(lines.slice(0, labels.length + 2)).toStrictEqual([
    HEADER,
    ...labels.map(label => `- ${label}`),
    `Removed ${labels.length} duplicate version${labels.length === 1 ? "" : "s"}`,
  ]);
  expect(lines.filter(line => line.startsWith("+ "))).toStrictEqual([]);
}

async function expectAlreadyDeduplicated(dir: string, packages?: number) {
  const check = await dedupe(dir, "--check");
  if (packages === undefined) {
    expect(firstLines(check.stdout, 2)).toStrictEqual([HEADER, expect.stringContaining("🎉 No duplicates — checked ")]);
  } else {
    expect(normalizeBunSnapshot(check.stdout)).toBe(`${HEADER}\n${noDuplicates(packages)}`);
  }
  expect(check.stderr).not.toContain("error:");
  expect(check.exitCode).toBe(0);
}

async function expectRefused(dir: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await dedupe(dir, ...args);
  expect(normalizeBunSnapshot(stderr)).toContain(
    "error: the lockfile is out of date with package.json, nothing was deduplicated",
  );
  expect(normalizeBunSnapshot(stderr)).toContain("note: run 'bun install' first");
  expect(stdout).not.toContain("duplicate");
  expect(stdout).not.toContain("Removed");
  expect(exitCode).toBe(1);
}

// bun.lock writes one package entry per line; edits the entry whose line starts with `entryPrefix`.
function editLockEntry(lockfile: string, entryPrefix: string, from: string, to: string) {
  const lines = lockfile.split("\n");
  const i = lines.findIndex(line => line.trimStart().startsWith(entryPrefix));
  expect(i).not.toBe(-1);
  expect(lines[i]).toContain(from);
  lines[i] = lines[i].replace(from, to);
  return lines.join("\n");
}

// Same trick as 'never upgrades past the locked version': widen the range in both files, keeping the locked resolution.
async function widen(packageDir: string, packageJsonPath: string, name: string, range: string) {
  const [pkg, lockfile] = await Promise.all([file(packageJsonPath).json(), lock(packageDir)]);
  const from = `"${name}": "${pkg.dependencies[name]}"`;
  expect(lockfile.split(from)).toHaveLength(2);
  pkg.dependencies[name] = range;
  await Promise.all([
    write(packageJsonPath, JSON.stringify(pkg)),
    write(join(packageDir, "bun.lock"), lockfile.replace(from, `"${name}": "${range}"`)),
  ]);
}

const noDepsPatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

// A still-satisfied range edge is never re-resolved by a later install, so adding an exact pin afterwards leaves a duplicate.
async function installTwice(packageDir: string, packageJson: string, first: object, second: object) {
  await write(packageJson, JSON.stringify(first));
  await runBunInstall(installEnv(packageDir), packageDir);
  await write(packageJson, JSON.stringify(second));
  await runBunInstall(installEnv(packageDir), packageDir);
  return lock(packageDir);
}

// one-range-dep@1.0.0 depends on no-deps@^1.0.0 (locked 1.1.0); root then pins no-deps@1.0.0.
async function setupRangeDuplicate(packageDir: string, packageJson: string) {
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-range-dep": "1.0.0" } },
    { name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } },
  );
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');
  expect(lockfile).toContain('"one-range-dep/no-deps"');
  return lockfile;
}

test.concurrent("collapses a range onto the exact version that satisfies every edge", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  const pkgJsonBefore = await file(packageJson).text();

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).not.toContain('"no-deps@1.1.0"');
  expect(lockfile).not.toContain('"one-range-dep/no-deps"');
  expect(await file(packageJson).text()).toBe(pkgJsonBefore);

  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// pnpm/pnpm#6550: root's range moves up onto the version its dependents already use.
test.concurrent("prefers the highest version when several satisfy every edge", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);

  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^1.0.0" } }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  let lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.0.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  lockfile = await lock(packageDir);
  expect(lockfile).not.toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
    name: "no-deps",
    version: "1.1.0",
  });

  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// pnpm/pnpm#13503: `--check` must not touch node_modules either.
test.concurrent("--check reports and exits 1 without writing", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  const pkgJsonBefore = await file(packageJson).text();
  const nodeModulesBefore = await readdirSorted(join(packageDir, "node_modules"));
  const nestedPkgJson = join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps", "package.json");
  expect(await file(nestedPkgJson).json()).toStrictEqual({ name: "no-deps", version: "1.1.0" });

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.1.0
    1 duplicate version can be removed
      bun dedupe"
  `);
  expect(check.stderr).not.toContain("note:");
  expect(check.stderr).not.toContain("Saved lockfile");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await file(packageJson).text()).toBe(pkgJsonBefore);
  expect(await readdirSorted(join(packageDir, "node_modules"))).toStrictEqual(nodeModulesBefore);
  expect(await file(nestedPkgJson).json()).toStrictEqual({ name: "no-deps", version: "1.1.0" });

  const dryRun = await dedupe(packageDir, "--dry-run");
  expect(normalizeBunSnapshot(dryRun.stdout)).toBe(normalizeBunSnapshot(check.stdout));
  expect(dryRun.stderr).not.toContain("Saved lockfile");
  expect(dryRun.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
});

test.concurrent("already deduplicated", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);

  const first = await dedupe(packageDir);
  expect(first.stderr).not.toContain("error:");
  expect(first.exitCode).toBe(0);
  const lockAfterFirst = await lock(packageDir);
  expect(lockAfterFirst).not.toContain('"no-deps@1.1.0"');

  const second = await dedupe(packageDir);
  expect(firstLines(second.stdout, 2)).toStrictEqual([HEADER, noDuplicates(2)]);
  expect(second.stderr).not.toContain("Saved lockfile");
  expect(second.exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(lockAfterFirst);

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    🎉 No duplicates — checked 2 packages, every one already resolves to a single version"
  `);
  expect(check.exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(lockAfterFirst);
});

test.concurrent("keeps versions that no single version can replace", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-dep": "1.0.0", "one-fixed-dep": "1.0.0" } }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);
  expect(lockBefore).toContain('"no-deps@1.0.0"');
  expect(lockBefore).toContain('"no-deps@1.0.1"');

  await expectAlreadyDeduplicated(packageDir, 4);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 2)).toStrictEqual([HEADER, noDuplicates(4)]);
  expect(stderr).not.toContain("Saved lockfile");
  expect(exitCode).toBe(0);
  const lockAfter = await lock(packageDir);
  expect(lockAfter).toContain('"no-deps@1.0.0"');
  expect(lockAfter).toContain('"no-deps@1.0.1"');
  expect(lockAfter).toBe(lockBefore);
});

test.concurrent("honours catalog ranges", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const root = (catalogRange: string, dependencies?: Record<string, string>) =>
    JSON.stringify({ name: "root", workspaces: ["packages/*"], catalog: { "no-deps": catalogRange }, dependencies });

  await Promise.all([
    write(packageJson, root("1.0.0")),
    write(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } }),
    ),
  ]);
  await runBunInstall(installEnv(packageDir), packageDir);
  let lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');

  await write(packageJson, root("^1.0.0"));
  await runBunInstall(installEnv(packageDir), packageDir);
  lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).not.toContain('"no-deps@1.1.0"');

  await write(packageJson, root("^1.0.0", { "no-deps": "1.1.0" }));
  await runBunInstall(installEnv(packageDir), packageDir);
  lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.0.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  lockfile = await lock(packageDir);
  expect(lockfile).not.toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("override range wins over the edge's own range", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  expect(lockBefore).toContain('\n  "packages": {');
  const withOverride = lockBefore.replace(
    '\n  "packages": {',
    '\n  "overrides": {\n    "no-deps": "1.1.0",\n  },\n  "packages": {',
  );
  await Promise.all([
    write(join(packageDir, "bun.lock"), withOverride),
    write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" },
        overrides: { "no-deps": "1.1.0" },
      }),
    ),
  ]);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.0.0
    1 duplicate version can be removed
      bun dedupe"
  `);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(withOverride);
});

test.concurrent("errors without a lockfile", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));

  const apply = await dedupe(packageDir);
  expect(apply.stderr).toContain("error: missing lockfile, nothing to dedupe");
  expect(apply.exitCode).toBe(1);

  const check = await dedupe(packageDir, "--check");
  expect(check.stderr).toContain("error: missing lockfile, nothing to dedupe");
  expect(check.exitCode).toBe(1);

  expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
});

test.concurrent("rejects positional arguments", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);

  const { stderr, exitCode } = await dedupe(packageDir, "no-deps");
  expect(stderr).toContain("error: bun dedupe does not take arguments");
  expect(exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
});

test.concurrent("--help", async () => {
  const { packageDir } = await registry.createTestDir();

  const { stdout, exitCode } = await dedupe(packageDir, "--help");
  expect(stdout).toContain("bun dedupe");
  expect(stdout).toContain("--check");
  expect(exitCode).toBe(0);
});

test.concurrent("works with the isolated linker", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  const install = async (...args: string[]) => {
    const result = await run(packageDir, "install", ...args, "--linker", "isolated");
    expect(result.stderr).not.toContain("error:");
    expect(result.exitCode).toBe(0);
    return result;
  };
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  await install();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } }),
  );
  await install();
  let lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');
  // Store entry names may carry hash suffixes, so reach one-range-dep's store node_modules through the top-level link.
  const nestedNoDeps = async () => {
    const storeEntry = await realpath(join(packageDir, "node_modules", "one-range-dep"));
    return file(join(dirname(storeEntry), "no-deps", "package.json")).json();
  };
  expect(await nestedNoDeps()).toStrictEqual({ name: "no-deps", version: "1.1.0" });

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--linker", "isolated");
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).not.toContain('"no-deps@1.1.0"');
  await install("--frozen-lockfile");

  expect(await nestedNoDeps()).toStrictEqual({ name: "no-deps", version: "1.0.0" });
});

// Loading re-hoists an optional peer onto a satisfying no-deps placed before it, so every other holder must sort after one-optional-peer-dep (hence the alias name).
test.concurrent("duplicate held only by an optional peer edge is deduplicated", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-optional-peer-dep": "1.0.2", "one-range-dep": "1.0.0" } },
    {
      name: "foo",
      dependencies: {
        "one-optional-peer-dep": "1.0.2",
        "one-range-dep": "1.0.0",
        "z-fixed-dep": "npm:one-fixed-dep@1.0.0",
      },
    },
  );
  expect(lockfile).toContain('"no-deps": ["no-deps@1.1.0"');
  expect(lockfile).toContain('"z-fixed-dep/no-deps": ["no-deps@1.0.0"');
  // Swap placements: root's no-deps becomes 1.0.0 (still satisfying one-range-dep and z-fixed-dep); only the peer edge resolves to 1.1.0.
  const heldByPeer = lockfile
    .replace('"no-deps": ["no-deps@1.1.0"', '"one-optional-peer-dep/no-deps": ["no-deps@1.1.0"')
    .replace('"z-fixed-dep/no-deps": ["no-deps@1.0.0"', '"no-deps": ["no-deps@1.0.0"');
  await write(join(packageDir, "bun.lock"), heldByPeer);

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.1.0
    1 duplicate version can be removed
      bun dedupe"
  `);
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(heldByPeer);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  await expectAlreadyDeduplicated(packageDir, 4);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent.each([
  ["--frozen-lockfile", "the lockfile is frozen"],
  ["--production", "the lockfile is frozen"],
  ["--no-save", "saving the lockfile is disabled"],
])("%s with duplicates errors instead of claiming removal", async (flag, reason) => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, flag);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.1.0
      bun dedupe --check"
  `);
  expect(normalizeBunSnapshot(stderr).split("\n")).toContain(
    `error: 1 duplicate version can be removed, but ${reason}`,
  );
  expect(stderr).not.toContain("note:");
  expect(stderr).not.toContain("Saved lockfile");
  expect(exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
});

test.concurrent("--frozen-lockfile succeeds when already deduplicated", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--frozen-lockfile");
  expect(firstLines(stdout, 2)).toStrictEqual([HEADER, noDuplicates(2)]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(lockBefore);
});

// Modelled on pnpm's workspace-with-lockfile-dupes fixture: root's ">=1.0.0" edge collapses onto the aliased 1.0.0, orphaning one-fixed-dep@2.0.0 -> no-deps@2.0.0.
test.concurrent("cascading removal lists every unreachable duplicate in name order", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-fixed-dep": ">=1.0.0" } },
    { name: "foo", dependencies: { "one-fixed-dep": ">=1.0.0", "ofd": "npm:one-fixed-dep@1.0.0" } },
  );
  for (const label of ['"one-fixed-dep@1.0.0"', '"one-fixed-dep@2.0.0"', '"no-deps@1.0.0"', '"no-deps@2.0.0"']) {
    expect(lockfile).toContain(label);
  }

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@2.0.0
    - one-fixed-dep@2.0.0
    2 duplicate versions can be removed
      bun dedupe"
  `);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@2.0.0", "one-fixed-dep@2.0.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"one-fixed-dep@1.0.0"');
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"one-fixed-dep@2.0.0"');
  expect(after).not.toContain('"no-deps@2.0.0"');
  expect(await nodeModulesVersion(packageDir, "one-fixed-dep")).toBe("1.0.0");
  expect(await nodeModulesVersion(packageDir, "ofd")).toBe("1.0.0");
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("multiple names removed in one run are sorted, scoped names first", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "two-range-deps": "1.0.0" } },
    { name: "foo", dependencies: { "two-range-deps": "1.0.0", "no-deps": "1.0.0", "@types/is-number": "1.0.0" } },
  );
  for (const label of ['"no-deps@1.0.0"', '"no-deps@1.1.0"', '"@types/is-number@1.0.0"', '"@types/is-number@2.0.0"']) {
    expect(lockfile).toContain(label);
  }

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - @types/is-number@2.0.0
    - no-deps@1.1.0
    2 duplicate versions can be removed
      bun dedupe"
  `);
  expect(check.exitCode).toBe(1);

  const { stdout, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "@types/is-number@2.0.0", "no-deps@1.1.0");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).not.toContain('"@types/is-number@2.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("workspace package edge is re-pointed when run from the workspace directory", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const workspaceDir = join(packageDir, "packages", "a");
  await write(
    join(workspaceDir, "package.json"),
    JSON.stringify({ name: "a", dependencies: { "one-range-dep": "1.0.0" } }),
  );
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "root", workspaces: ["packages/*"] },
    { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } },
  );
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  const { stdout, stderr, exitCode } = await dedupe(workspaceDir);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await exists(join(workspaceDir, "bun.lock"))).toBeFalse();
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("corrupt bun.lock fails without rewriting it", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  await runBunInstall(installEnv(packageDir), packageDir);
  const corrupt = "{ not valid";
  await write(join(packageDir, "bun.lock"), corrupt);

  for (const args of [[], ["--check"]]) {
    const { stderr, exitCode } = await dedupe(packageDir, ...args);
    expect(stderr).toContain("failed to parse lockfile");
    expect(stderr).not.toContain("Ignoring lockfile");
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).not.toBe(0);
    expect(await lock(packageDir)).toBe(corrupt);
  }
});

test.concurrent("--check never creates node_modules", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  await rm(join(packageDir, "node_modules"), { recursive: true });

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.1.0
    1 duplicate version can be removed
      bun dedupe"
  `);
  expect(check.exitCode).toBe(1);
  expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  expect(await lock(packageDir)).toBe(lockBefore);

  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
  const apply = await dedupe(packageDir);
  expectRemoved(apply.stdout, "no-deps@1.1.0");
  expect(apply.exitCode).toBe(0);
  const lockDeduped = await lock(packageDir);
  await rm(join(packageDir, "node_modules"), { recursive: true });

  const clean = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(clean.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    🎉 No duplicates — checked 2 packages, every one already resolves to a single version"
  `);
  expect(clean.exitCode).toBe(0);
  expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  expect(await lock(packageDir)).toBe(lockDeduped);
});

test.concurrent("never upgrades past the locked version", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  await runBunInstall(installEnv(packageDir), packageDir);
  const pinned = await lock(packageDir);
  expect(pinned).toContain('"no-deps": "1.0.0"');
  const widened = pinned.replace('"no-deps": "1.0.0"', '"no-deps": "^1.0.0"');
  await Promise.all([
    write(join(packageDir, "bun.lock"), widened),
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "^1.0.0" } })),
  ]);

  await expectAlreadyDeduplicated(packageDir, 1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 2)).toStrictEqual([HEADER, noDuplicates(1)]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.0");
});

test.concurrent.each([
  ["skipped with --ignore-scripts", ["--ignore-scripts"], false],
  ["run by default", [], true],
])("root lifecycle scripts are %s", async (_, flags, runs) => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  // Added after setup so only the dedupe run can create the marker.
  const pkg = await file(packageJson).json();
  await write(packageJson, JSON.stringify({ ...pkg, scripts: { postinstall: "echo ran > postinstall.txt" } }));
  const marker = join(packageDir, "postinstall.txt");

  const { stdout, stderr, exitCode } = await dedupe(packageDir, ...flags);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  expect(await exists(marker)).toBe(runs);
});

// A direct dependency only moves down when that is the only way to drop a version (pnpm would keep both, pnpm/pnpm#4753, #6762).
test.concurrent("root range collapses onto a transitive exact pin", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "a-dep": "^1.0.0", "uses-a-dep-3": "1.0.0" } }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  const pkgJsonBefore = await file(packageJson).text();
  const lockfile = await lock(packageDir);
  expect(lockfile).toContain('"a-dep@1.0.10"');
  expect(lockfile).toContain('"a-dep@1.0.3"');
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.10");

  const { stdout, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "a-dep@1.0.10");
  expect(exitCode).toBe(0);
  expect(await file(packageJson).text()).toBe(pkgJsonBefore);

  const after = await lock(packageDir);
  expect(after).toContain('"a-dep@1.0.3"');
  expect(after).not.toContain('"a-dep@1.0.10"');
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.3");
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("npm: alias edges are deduplicated by the aliased range", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-range-dep": "1.0.0" } },
    { name: "foo", dependencies: { "one-range-dep": "1.0.0", "nd": "npm:no-deps@1.0.0" } },
  );
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  const { stdout, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(exitCode).toBe(0);

  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "nd")).toBe("1.0.0");
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("dist-tag edges keep the version the tag resolved to", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "dep-with-tags": "pre-1", "dwt": "npm:dep-with-tags@1.0.0" } }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);
  expect(lockBefore).toContain('"dep-with-tags@1.0.1"');
  expect(lockBefore).toContain('"dep-with-tags@1.0.0"');

  await expectAlreadyDeduplicated(packageDir, 2);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 2)).toStrictEqual([HEADER, noDuplicates(2)]);
  expect(stderr).not.toContain("Saved lockfile");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await nodeModulesVersion(packageDir, "dep-with-tags")).toBe("1.0.1");
});

test.concurrent("edges pointing at a patched version are never moved", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  const patched = lockBefore.replace(
    '\n  "packages": {',
    '\n  "patchedDependencies": {\n    "no-deps@1.1.0": "patches/no-deps@1.1.0.patch",\n  },\n  "packages": {',
  );
  expect(patched).not.toBe(lockBefore);
  await write(join(packageDir, "bun.lock"), patched);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    🎉 No duplicates — checked 3 packages, every one already resolves to a single version"
  `);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(patched);
});

test.concurrent("--lockfile-only rewrites bun.lock without installing", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  const nested = () => nodeModulesVersion(packageDir, "one-range-dep", "node_modules", "no-deps");
  expect(await nested()).toBe("1.1.0");

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--lockfile-only");
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  expect(await nested()).toBe("1.1.0");

  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("--silent keeps the exit codes", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const check = await dedupe(packageDir, "--check", "--silent");
  expect(check.stdout).toBe("");
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);

  const apply = await dedupe(packageDir, "--silent");
  expect(apply.stdout).toBe("");
  expect(apply.stderr).toBe("");
  expect(apply.exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
});

// The workspace fixture: root pins no-deps@1.0.0, packages/a -> one-range-dep -> no-deps@1.1.0.
async function setupWorkspaceDuplicate(packageDir: string, packageJson: string, workspacePackageJson: object) {
  const workspaceDir = join(packageDir, "packages", "a");
  await write(join(workspaceDir, "package.json"), JSON.stringify(workspacePackageJson));
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "root", workspaces: ["packages/*"] },
    { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } },
  );
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');
  return workspaceDir;
}

type StaleFixture = { packageDir: string; cwds: string[]; afterRefusal?: () => Promise<void> };

// Every edit is still satisfied by the locked versions, so the refusal is about the ranges, not about re-resolution.
test.concurrent.each<[string, () => Promise<StaleFixture>]>([
  [
    "a root dependency range",
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await setupRangeDuplicate(packageDir, packageJson);
      await write(
        packageJson,
        JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^1.0.0" } }),
      );
      const nested = () => nodeModulesVersion(packageDir, "one-range-dep", "node_modules", "no-deps");
      expect(await nested()).toBe("1.1.0");
      return {
        packageDir,
        cwds: [packageDir],
        async afterRefusal() {
          expect(await nested()).toBe("1.1.0");
          // The current range lets root move up onto 1.1.0; the recorded exact range would have removed it instead.
          await runBunInstall(installEnv(packageDir), packageDir);
          const { stdout, stderr, exitCode } = await dedupe(packageDir);
          expectRemoved(stdout, "no-deps@1.0.0");
          expect(stderr).not.toContain("error:");
          expect(exitCode).toBe(0);
          expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.1.0");
        },
      };
    },
  ],
  [
    "an override",
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await setupRangeDuplicate(packageDir, packageJson);
      await write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" },
          overrides: { "no-deps": "1.1.0" },
        }),
      );
      return {
        packageDir,
        cwds: [packageDir],
        async afterRefusal() {
          await runBunInstall(installEnv(packageDir), packageDir);
          const lockfile = await lock(packageDir);
          expect(lockfile).toContain('"overrides"');
          expect(lockfile).not.toContain('"no-deps@1.0.0"');
          await expectAlreadyDeduplicated(packageDir, 2);
        },
      };
    },
  ],
  [
    "a catalog entry",
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      // Same steps as 'honours catalog ranges', then the catalog entry is edited without installing.
      const root = (catalogRange: string, dependencies?: Record<string, string>) =>
        JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          catalog: { "no-deps": catalogRange },
          dependencies,
        });
      await Promise.all([
        write(packageJson, root("1.0.0")),
        write(
          join(packageDir, "packages", "a", "package.json"),
          JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } }),
        ),
      ]);
      await runBunInstall(installEnv(packageDir), packageDir);
      await write(packageJson, root("^1.0.0"));
      await runBunInstall(installEnv(packageDir), packageDir);
      await write(packageJson, root("^1.0.0", { "no-deps": "1.1.0" }));
      await runBunInstall(installEnv(packageDir), packageDir);
      const lockfile = await lock(packageDir);
      expect(lockfile).toContain('"no-deps@1.0.0"');
      expect(lockfile).toContain('"no-deps@1.1.0"');
      await write(packageJson, root(">=1.0.0", { "no-deps": "1.1.0" }));
      return { packageDir, cwds: [packageDir] };
    },
  ],
  [
    "a workspace package's dependencies",
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      const workspaceDir = await setupWorkspaceDuplicate(packageDir, packageJson, {
        name: "a",
        dependencies: { "one-range-dep": "1.0.0" },
      });
      await write(
        join(workspaceDir, "package.json"),
        JSON.stringify({ name: "a", dependencies: { "one-range-dep": "^1.0.0" } }),
      );
      return { packageDir, cwds: [packageDir, workspaceDir] };
    },
  ],
])("refuses to dedupe when %s changed since the last install", async (_, setup) => {
  const { packageDir, cwds, afterRefusal } = await setup();
  const lockBefore = await lock(packageDir);

  for (const cwd of cwds) {
    await expectRefused(cwd, "--check");
    expect(await lock(packageDir)).toBe(lockBefore);
    await expectRefused(cwd);
    expect(await lock(packageDir)).toBe(lockBefore);
  }

  await afterRefusal?.();
});

// The gate is the dependency diff: diffs the differ reports on every install of an in-sync tree must not refuse.
test.concurrent.each([
  [
    "trustedDependencies",
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await setupRangeDuplicate(packageDir, packageJson);
      const pkg = await file(packageJson).json();
      await write(packageJson, JSON.stringify({ ...pkg, trustedDependencies: ["no-deps"] }));
      return packageDir;
    },
  ],
  [
    "a workspace lifecycle script",
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await setupWorkspaceDuplicate(packageDir, packageJson, {
        name: "a",
        dependencies: { "one-range-dep": "1.0.0" },
        scripts: { postinstall: "exit 0" },
      });
      return packageDir;
    },
  ],
  [
    "package.json formatting",
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      await setupRangeDuplicate(packageDir, packageJson);
      await write(
        packageJson,
        JSON.stringify(
          { description: "reformatted", dependencies: { "no-deps": "1.0.0", "one-range-dep": "1.0.0" }, name: "foo" },
          null,
          2,
        ),
      );
      return packageDir;
    },
  ],
])("still dedupes when only %s changed", async (_, setup) => {
  const packageDir = await setup();

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("a direct dependency is not moved when its version survives anyway", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "no-deps": "1.0.1", "dwt": "npm:dep-with-tags@^1.0.0" } },
    {
      name: "foo",
      dependencies: {
        "no-deps": "^1.0.0",
        "one-dep": "1.0.0",
        "one-fixed-dep": "1.0.0",
        "has-bin-entries": "1.0.0",
        "dwt": "npm:dep-with-tags@^1.0.0",
        "dwt0": "npm:dep-with-tags@1.0.0",
      },
    },
  );
  for (const label of ['"no-deps@1.0.0"', '"no-deps@1.0.1"', '"dep-with-tags@1.0.0"', '"dep-with-tags@1.0.1"']) {
    expect(lockfile).toContain(label);
  }
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.1");

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "dep-with-tags@1.0.1");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).toContain('"no-deps@1.0.1"');
  expect(after).not.toContain('"dep-with-tags@1.0.1"');
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.1");
  expect(await nodeModulesVersion(packageDir, "dwt")).toBe("1.0.0");
  await expectAlreadyDeduplicated(packageDir);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// no-deps ends up as: direct ^1.0.0 @1.1.0, `<=1.0.1` @1.0.1, `>=1.0.1` @1.0.1, exact 1.0.0 — {1.0.0, 1.1.0} and {1.0.0, 1.0.1} are equally small covers.
test.concurrent.each(["root", "workspace"])(
  "prefers dropping the version that keeps the direct dependency in place (%s)",
  async variant => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const rootExtras = { "one-fixed-dep": "1.0.0", "one-dep": "1.0.0", "normal-dep-and-dev-dep": "1.0.0" };
    if (variant === "root") {
      await write(packageJson, JSON.stringify({ name: "root", dependencies: { "no-deps": "^1.0.0" } }));
      await runBunInstall(installEnv(packageDir), packageDir);
      await write(packageJson, JSON.stringify({ name: "root", dependencies: { "no-deps": "^1.0.0", ...rootExtras } }));
    } else {
      await Promise.all([
        write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
        write(
          join(packageDir, "packages", "a", "package.json"),
          JSON.stringify({ name: "a", dependencies: { "no-deps": "^1.0.0" } }),
        ),
      ]);
      await runBunInstall(installEnv(packageDir), packageDir);
      await write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: rootExtras }));
    }
    await runBunInstall(installEnv(packageDir), packageDir);
    let lockfile = await lock(packageDir);
    for (const label of ['"no-deps@1.0.0"', '"no-deps@1.0.1"', '"no-deps@1.1.0"']) {
      expect(lockfile).toContain(label);
    }
    lockfile = editLockEntry(lockfile, '"one-dep": ["one-dep@1.0.0"', '"no-deps": "1.0.1"', '"no-deps": "<=1.0.1"');
    lockfile = editLockEntry(
      lockfile,
      '"normal-dep-and-dev-dep": ["normal-dep-and-dev-dep@1.0.0"',
      '"no-deps": "1.0.1"',
      '"no-deps": ">=1.0.1"',
    );
    await write(join(packageDir, "bun.lock"), lockfile);

    const check = await dedupe(packageDir, "--check");
    expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
      "bun dedupe <version> (<revision>)
      - no-deps@1.0.1
      1 duplicate version can be removed
        bun dedupe"
    `);
    expect(check.exitCode).toBe(1);

    const { stdout, stderr, exitCode } = await dedupe(packageDir);
    expectRemoved(stdout, "no-deps@1.0.1");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const after = await lock(packageDir);
    expect(after).toContain('"no-deps@1.1.0"');
    expect(after).toContain('"no-deps@1.0.0"');
    expect(after).not.toContain('"no-deps@1.0.1"');
    if (variant === "root") {
      expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.1.0");
    }
    await expectAlreadyDeduplicated(packageDir);
    await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
  },
);

// pnpm/pnpm#4753 direct-dependency weighting: when the direct edge's own version is dropped, it moves to the highest survivor.
test.concurrent("a direct range whose version is dropped moves up, not down", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { "a-dep": "1.0.5", "uses-a-dep-3": "1.0.0", "uses-a-dep-10": "1.0.0" },
      }),
    ),
    write(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({ name: "b", dependencies: { "a-dep": "1.0.3" } }),
    ),
  ]);
  await runBunInstall(installEnv(packageDir), packageDir);
  await widen(packageDir, packageJson, "a-dep", "^1.0.0");
  const lockfile = await lock(packageDir);
  for (const label of ['"a-dep@1.0.3"', '"a-dep@1.0.5"', '"a-dep@1.0.10"']) {
    expect(lockfile).toContain(label);
  }
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.5");

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - a-dep@1.0.5
    1 duplicate version can be removed
      bun dedupe"
  `);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "a-dep@1.0.5");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"a-dep@1.0.3"');
  expect(after).toContain('"a-dep@1.0.10"');
  expect(after).not.toContain('"a-dep@1.0.5"');
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.10");
  await expectAlreadyDeduplicated(packageDir);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// a-dep@1.0.3 has more edges than root's 1.0.10, but both versions must stay, so removing no-deps@1.1.0 must not drag root down.
test.concurrent("removing one name does not downgrade an unrelated direct dependency", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    join(packageDir, "packages", "b", "package.json"),
    JSON.stringify({ name: "b", dependencies: { "a-dep": "1.0.3" } }),
  );
  const rootDeps = { "a-dep": "^1.0.0", "uses-a-dep-3": "1.0.0", "uses-a-dep-10": "1.0.0", "one-range-dep": "1.0.0" };
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "root", workspaces: ["packages/*"], dependencies: rootDeps },
    { name: "root", workspaces: ["packages/*"], dependencies: { ...rootDeps, "no-deps": "1.0.0" } },
  );
  for (const label of ['"a-dep": ["a-dep@1.0.10"', '"a-dep@1.0.3"', '"no-deps@1.0.0"', '"no-deps@1.1.0"']) {
    expect(lockfile).toContain(label);
  }
  expect(lockfile).not.toContain('"uses-a-dep-10/a-dep"');
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.10");

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"a-dep": ["a-dep@1.0.10"');
  expect(after).toContain('"a-dep@1.0.3"');
  expect(after).not.toContain('"uses-a-dep-10/a-dep"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.10");
  await expectAlreadyDeduplicated(packageDir);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("a workspace member's own range moves up when run from the member directory", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const memberDir = join(packageDir, "packages", "b");
  const memberPackageJson = join(memberDir, "package.json");
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { "a-dep": "1.0.3", "uses-a-dep-3": "1.0.0", "uses-a-dep-10": "1.0.0" },
      }),
    ),
    write(memberPackageJson, JSON.stringify({ name: "b", dependencies: { "a-dep": "1.0.5" } })),
  ]);
  await runBunInstall(installEnv(packageDir), packageDir);
  await widen(packageDir, memberPackageJson, "a-dep", "^1.0.0");
  const lockfile = await lock(packageDir);
  for (const label of ['"a-dep": ["a-dep@1.0.3"', '"b/a-dep": ["a-dep@1.0.5"', '"a-dep@1.0.10"']) {
    expect(lockfile).toContain(label);
  }
  expect(await nodeModulesVersion(memberDir, "a-dep")).toBe("1.0.5");

  const { stdout, stderr, exitCode } = await dedupe(memberDir);
  expectRemoved(stdout, "a-dep@1.0.5");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"a-dep": ["a-dep@1.0.3"');
  expect(after).toContain('"b/a-dep": ["a-dep@1.0.10"');
  expect(after).not.toContain('"a-dep@1.0.5"');
  expect(await nodeModulesVersion(memberDir, "a-dep")).toBe("1.0.10");
  expect(await exists(join(memberDir, "bun.lock"))).toBeFalse();
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// dep-with-tags' `latest` tag is 3.0.0, so a fresh range would resolve there too; pin 3.0.1 first, then widen.
test.concurrent("ranges collapse onto the version a dist-tag resolved to", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "dwt": "npm:dep-with-tags@3.0.1", "dep-with-tags": "latest" } }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  await widen(packageDir, packageJson, "dwt", "npm:dep-with-tags@>=1.0.0");
  const lockfile = await lock(packageDir);
  expect(lockfile).toContain('"dep-with-tags@3.0.0"');
  expect(lockfile).toContain('"dep-with-tags@3.0.1"');

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "dep-with-tags@3.0.1");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await lock(packageDir)).not.toContain('"dep-with-tags@3.0.1"');
  expect(await nodeModulesVersion(packageDir, "dep-with-tags")).toBe("3.0.0");
  expect(await nodeModulesVersion(packageDir, "dwt")).toBe("3.0.0");
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// The patched version pins root's now-ranged direct edge, so the transitive edge collapses down onto it.
test.concurrent("a patched version wins over keeping the direct dependency's higher version", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(join(packageDir, "patches", "no-deps@1.0.0.patch"), noDepsPatch);
  await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-range-dep": "1.0.0" } },
    {
      name: "foo",
      dependencies: { "no-deps": "1.0.0", "one-range-dep": "1.0.0" },
      patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" },
    },
  );
  await widen(packageDir, packageJson, "no-deps", "^1.0.0");
  const lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0": "patches/no-deps@1.0.0.patch"');
  expect(lockfile).toContain('"no-deps@1.1.0"');
  expect(await exists(join(packageDir, "node_modules", "no-deps", "patched.txt"))).toBeTrue();

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0": "patches/no-deps@1.0.0.patch"');
  expect(after).toContain('"no-deps": ["no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.0");
  expect(await exists(join(packageDir, "node_modules", "no-deps", "patched.txt"))).toBeTrue();
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// one-fixed-dep@1.0.0 is the only dependent of the patched no-deps@1.0.0, so root's ">=1.0.0" edge must not move up onto 2.0.0.
test.concurrent("a version that is the only way to reach a patched package is kept and reported", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(join(packageDir, "patches", "no-deps@1.0.0.patch"), noDepsPatch);
  const patched = { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" };
  await installTwice(
    packageDir,
    packageJson,
    {
      name: "foo",
      dependencies: { "one-fixed-dep": "1.0.0", "dwt": "npm:dep-with-tags@3.0.1" },
      patchedDependencies: patched,
    },
    {
      name: "foo",
      dependencies: {
        "one-fixed-dep": ">=1.0.0",
        "ofd2": "npm:one-fixed-dep@2.0.0",
        "dwt": "npm:dep-with-tags@3.0.1",
        "dep-with-tags": "latest",
      },
      patchedDependencies: patched,
    },
  );
  await widen(packageDir, packageJson, "dwt", "npm:dep-with-tags@>=1.0.0");
  const lockfile = await lock(packageDir);
  for (const label of [
    '"one-fixed-dep@1.0.0"',
    '"one-fixed-dep@2.0.0"',
    '"no-deps@1.0.0"',
    '"no-deps@2.0.0"',
    '"dep-with-tags@3.0.0"',
    '"dep-with-tags@3.0.1"',
    '"no-deps@1.0.0": "patches/no-deps@1.0.0.patch"',
  ]) {
    expect(lockfile).toContain(label);
  }

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - dep-with-tags@3.0.1
    1 duplicate version can be removed
      kept one-fixed-dep@1.0.0 (needed to reach patched no-deps@1.0.0)
      bun dedupe"
  `);
  expect(check.stderr).not.toContain("note:");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockfile);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "dep-with-tags@3.0.1");
  expect(firstLines(stdout, 4)[3]).toBe("  kept one-fixed-dep@1.0.0 (needed to reach patched no-deps@1.0.0)");
  expect(stderr).not.toContain("kept");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"one-fixed-dep@1.0.0"');
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).toContain('"no-deps@1.0.0": "patches/no-deps@1.0.0.patch"');
  expect(after).not.toContain('"dep-with-tags@3.0.1"');
  expect(await nodeModulesVersion(packageDir, "one-fixed-dep")).toBe("1.0.0");
  expect(await nodeModulesVersion(packageDir, "dep-with-tags")).toBe("3.0.0");

  const recheck = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(recheck.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    🎉 No duplicates — checked 5 packages, every one already resolves to a single version
      kept one-fixed-dep@1.0.0 (needed to reach patched no-deps@1.0.0)"
  `);
  expect(recheck.stderr).not.toContain("kept");
  expect(recheck.exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(after);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// pnpm/pnpm#9213 (and #6619): one-fixed-dep@1.0.0 dies in this run, so its exact no-deps@1.0.0 edge must not drag the live "^1.0.0" edges down.
test.concurrent("a version removed by the run does not vote for its own dependencies", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^1.0.0" } }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  expect(await lock(packageDir)).toContain('"no-deps@1.1.0"');
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^1.0.0", "one-fixed-dep": "1.0.0" } },
    {
      name: "foo",
      dependencies: {
        "one-range-dep": "1.0.0",
        "no-deps": "^1.0.0",
        "one-fixed-dep": ">=1.0.0",
        "ofd2": "npm:one-fixed-dep@2.0.0",
      },
    },
  );
  for (const label of [
    '"one-fixed-dep@1.0.0"',
    '"one-fixed-dep@2.0.0"',
    '"no-deps@1.0.0"',
    '"no-deps@1.1.0"',
    '"no-deps@2.0.0"',
  ]) {
    expect(lockfile).toContain(label);
  }
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.1.0");

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.0.0
    - one-fixed-dep@1.0.0
    2 duplicate versions can be removed
      bun dedupe"
  `);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps@1.0.0", "one-fixed-dep@1.0.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.1.0"');
  expect(after).toContain('"no-deps@2.0.0"');
  expect(after).toContain('"one-fixed-dep@2.0.0"');
  expect(after).not.toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"one-fixed-dep@1.0.0"');
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.1.0");
  expect(await nodeModulesVersion(packageDir, "one-fixed-dep")).toBe("2.0.0");

  await expectAlreadyDeduplicated(packageDir, 4);
  expect(await lock(packageDir)).toBe(after);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// A bundled edge is satisfied by the tarball's own copy, so it stays put and root's range collapses onto it instead.
test.concurrent("bundled edges are never re-pointed", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "no-deps": "^1.0.0" } },
    { name: "foo", dependencies: { "no-deps": "^1.0.0", "bundled-1": "1.0.0" } },
  );
  expect(lockfile).toContain('"bundled-1/no-deps": ["no-deps@1.0.0"');
  expect(lockfile).toContain('"bundled": true');
  expect(lockfile).toContain('{ "dependencies": { "no-deps": "1.0.0" } }');
  const widened = lockfile.replace(
    '{ "dependencies": { "no-deps": "1.0.0" } }',
    '{ "dependencies": { "no-deps": "^1.0.0" } }',
  );
  await write(join(packageDir, "bun.lock"), widened);

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.1.0
    1 duplicate version can be removed
      bun dedupe"
  `);
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(widened);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--lockfile-only");
  expectRemoved(stdout, "no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const after = await lock(packageDir);
  expect(after).toContain('"bundled-1/no-deps": ["no-deps@1.0.0"');
  expect(after).toContain('"bundled": true');
  expect(after).not.toContain('"no-deps@1.1.0"');
});

// pnpm/pnpm#11238, #10329, #8446: dedupe never re-resolves, so it sends no registry request and ignores minimumReleaseAge.
test.concurrent("does not contact the registry", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  const requests: string[] = [];
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("registry must not be contacted", { status: 500 });
    },
  });
  await write(
    join(packageDir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: join(packageDir, ".bun-cache"),
        registry: `http://localhost:${server.port}/`,
        minimumReleaseAge: 60 * 60 * 24 * 365 * 100,
      },
    }),
  );

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)
    - no-deps@1.1.0
    1 duplicate version can be removed
      bun dedupe"
  `);
  expect(check.stderr).not.toContain("error:");
  expect(check.exitCode).toBe(1);

  const apply = await dedupe(packageDir, "--lockfile-only");
  expectRemoved(apply.stdout, "no-deps@1.1.0");
  expect(apply.stderr).toContain("Saved lockfile");
  expect(apply.stderr).not.toContain("error:");
  expect(apply.exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');

  await expectAlreadyDeduplicated(packageDir, 2);
  expect(requests).toStrictEqual([]);
});
