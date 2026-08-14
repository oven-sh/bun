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

async function run(dir: string, ...cmd: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
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

function firstLines(stdout: string, n: number) {
  return normalizeBunSnapshot(stdout).split("\n").slice(0, n);
}

function nodeModulesVersion(packageDir: string, ...segments: string[]) {
  return file(join(packageDir, "node_modules", ...segments, "package.json"))
    .json()
    .then(pkg => pkg.version);
}

// A still-satisfied range edge is never re-resolved by a later install, so adding an exact pin afterwards leaves a duplicate.
async function installTwice(packageDir: string, packageJson: string, first: object, second: object) {
  await write(packageJson, JSON.stringify(first));
  await runBunInstall(bunEnv, packageDir);
  await write(packageJson, JSON.stringify(second));
  await runBunInstall(bunEnv, packageDir);
  return lock(packageDir);
}

// one-range-dep@1.0.0 depends on no-deps@^1.0.0 (locked 1.1.0); root then pins no-deps@1.0.0.
async function setupRangeDuplicate(packageDir: string, packageJson: string, extra: Record<string, unknown> = {}) {
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", ...extra, dependencies: { "one-range-dep": "1.0.0" } },
    { name: "foo", ...extra, dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } },
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
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(stderr).toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).not.toContain('"no-deps@1.1.0"');
  expect(lockfile).not.toContain('"one-range-dep/no-deps"');
  expect(await file(packageJson).text()).toBe(pkgJsonBefore);

  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
});

// pnpm/pnpm#6550: root's range moves up onto the version its dependents already use.
test.concurrent("prefers the highest version when several satisfy every edge", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);

  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^1.0.0" } }),
  );
  await runBunInstall(bunEnv, packageDir);
  let lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.0.0",
  ]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  lockfile = await lock(packageDir);
  expect(lockfile).not.toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.1.0",
  });

  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
});

// pnpm/pnpm#13503: `--check` must not touch node_modules either.
test.concurrent("--check reports and exits 1 without writing", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  const pkgJsonBefore = await file(packageJson).text();
  const nodeModulesBefore = await readdirSorted(join(packageDir, "node_modules"));
  const nestedPkgJson = join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps", "package.json");
  expect(await file(nestedPkgJson).json()).toEqual({ name: "no-deps", version: "1.1.0" });

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)

    1 duplicate version can be removed: no-deps@1.1.0"
  `);
  expect(check.stderr).toContain("note: run 'bun dedupe' to remove them");
  expect(check.stderr).not.toContain("Saved lockfile");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await file(packageJson).text()).toBe(pkgJsonBefore);
  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(nodeModulesBefore);
  expect(await file(nestedPkgJson).json()).toEqual({ name: "no-deps", version: "1.1.0" });

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
  expect(second.stdout).toContain("Already deduplicated.");
  expect(second.stderr).not.toContain("Saved lockfile");
  expect(second.exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(lockAfterFirst);

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)

    Already deduplicated."
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
  await runBunInstall(bunEnv, packageDir);
  const lockBefore = await lock(packageDir);
  expect(lockBefore).toContain('"no-deps@1.0.0"');
  expect(lockBefore).toContain('"no-deps@1.0.1"');

  const check = await dedupe(packageDir, "--check");
  expect(check.stdout).toContain("Already deduplicated.");
  expect(check.exitCode).toBe(0);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(stdout).toContain("Already deduplicated.");
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
  await runBunInstall(bunEnv, packageDir);
  let lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');

  await write(packageJson, root("^1.0.0"));
  await runBunInstall(bunEnv, packageDir);
  lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).not.toContain('"no-deps@1.1.0"');

  await write(packageJson, root("^1.0.0", { "no-deps": "1.1.0" }));
  await runBunInstall(bunEnv, packageDir);
  lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.0.0",
  ]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  lockfile = await lock(packageDir);
  expect(lockfile).not.toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
});

test.concurrent("override range wins over the edge's own range", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  expect(lockBefore).toContain('\n  "packages": {');
  const withOverride = lockBefore.replace(
    '\n  "packages": {',
    '\n  "overrides": {\n    "no-deps": "1.1.0",\n  },\n  "packages": {',
  );
  await write(join(packageDir, "bun.lock"), withOverride);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)

    1 duplicate version can be removed: no-deps@1.0.0"
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
  await runBunInstall(bunEnv, packageDir);
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
  // `--linker` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
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
  expect(await nestedNoDeps()).toEqual({ name: "no-deps", version: "1.1.0" });

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--linker", "isolated");
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(stderr).toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  lockfile = await lock(packageDir);
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).not.toContain('"no-deps@1.1.0"');
  await install("--frozen-lockfile");

  expect(await nestedNoDeps()).toEqual({ name: "no-deps", version: "1.0.0" });
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

    1 duplicate version can be removed: no-deps@1.1.0"
  `);
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(heldByPeer);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect((await dedupe(packageDir, "--check")).exitCode).toBe(0);
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
});

test.concurrent.each([
  ["--frozen-lockfile", "the lockfile is frozen"],
  ["--production", "the lockfile is frozen"],
  ["--no-save", "saving the lockfile is disabled"],
])("%s with duplicates errors instead of claiming removal", async (flag, reason) => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, flag);
  expect(stdout).not.toContain("Removed");
  expect(stderr).toContain(`error: 1 duplicate version can be removed, but ${reason}: no-deps@1.1.0`);
  expect(stderr).toContain("note: run 'bun dedupe --check' to only report duplicates");
  expect(stderr).not.toContain("Saved lockfile");
  expect(exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
});

test.concurrent("--frozen-lockfile succeeds when already deduplicated", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  await runBunInstall(bunEnv, packageDir);
  const lockBefore = await lock(packageDir);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--frozen-lockfile");
  expect(stdout).toContain("Already deduplicated.");
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

    2 duplicate versions can be removed: no-deps@2.0.0, one-fixed-dep@2.0.0"
  `);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 2 duplicate versions: no-deps@2.0.0, one-fixed-dep@2.0.0",
  ]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"one-fixed-dep@1.0.0"');
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"one-fixed-dep@2.0.0"');
  expect(after).not.toContain('"no-deps@2.0.0"');
  expect(await nodeModulesVersion(packageDir, "one-fixed-dep")).toBe("1.0.0");
  expect(await nodeModulesVersion(packageDir, "ofd")).toBe("1.0.0");
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
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

    2 duplicate versions can be removed: @types/is-number@2.0.0, no-deps@1.1.0"
  `);
  expect(check.exitCode).toBe(1);

  const { stdout, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 2 duplicate versions: @types/is-number@2.0.0, no-deps@1.1.0",
  ]);
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).not.toContain('"@types/is-number@2.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
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
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await exists(join(workspaceDir, "bun.lock"))).toBeFalse();
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
});

test.concurrent("corrupt bun.lock fails without rewriting it", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  await runBunInstall(bunEnv, packageDir);
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
  expect(check.stdout).toContain("1 duplicate version can be removed: no-deps@1.1.0");
  expect(check.exitCode).toBe(1);
  expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  expect(await lock(packageDir)).toBe(lockBefore);

  await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
  await dedupe(packageDir);
  const lockDeduped = await lock(packageDir);
  await rm(join(packageDir, "node_modules"), { recursive: true });

  const clean = await dedupe(packageDir, "--check");
  expect(clean.stdout).toContain("Already deduplicated.");
  expect(clean.exitCode).toBe(0);
  expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  expect(await lock(packageDir)).toBe(lockDeduped);
});

test.concurrent("never upgrades past the locked version", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }));
  await runBunInstall(bunEnv, packageDir);
  const pinned = await lock(packageDir);
  expect(pinned).toContain('"no-deps": "1.0.0"');
  const widened = pinned.replace('"no-deps": "1.0.0"', '"no-deps": "^1.0.0"');
  await Promise.all([
    write(join(packageDir, "bun.lock"), widened),
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "^1.0.0" } })),
  ]);

  const check = await dedupe(packageDir, "--check");
  expect(check.stdout).toContain("Already deduplicated.");
  expect(check.exitCode).toBe(0);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(stdout).toContain("Already deduplicated.");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.0");
});

test.concurrent.each([
  ["--ignore-scripts", false],
  [undefined, true],
])("root lifecycle scripts with %s", async (flag, runs) => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson, { scripts: { postinstall: "echo ran > postinstall.txt" } });
  const marker = join(packageDir, "postinstall.txt");
  await rm(marker, { force: true });

  const { stdout, stderr, exitCode } = await dedupe(packageDir, ...(flag ? [flag] : []));
  expect(stdout).toContain("Removed 1 duplicate version: no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  expect(await exists(marker)).toBe(runs);
});

// "Fewest versions" policy (pnpm/pnpm#4753, #6762): a direct dependency may be moved to an older version that still satisfies its range.
test.concurrent("root range collapses onto a transitive exact pin", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "a-dep": "^1.0.0", "uses-a-dep-3": "1.0.0" } }),
  );
  await runBunInstall(bunEnv, packageDir);
  const pkgJsonBefore = await file(packageJson).text();
  const lockfile = await lock(packageDir);
  expect(lockfile).toContain('"a-dep@1.0.10"');
  expect(lockfile).toContain('"a-dep@1.0.3"');
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.10");

  const { stdout, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: a-dep@1.0.10",
  ]);
  expect(exitCode).toBe(0);
  expect(await file(packageJson).text()).toBe(pkgJsonBefore);

  const after = await lock(packageDir);
  expect(after).toContain('"a-dep@1.0.3"');
  expect(after).not.toContain('"a-dep@1.0.10"');
  expect(await nodeModulesVersion(packageDir, "a-dep")).toBe("1.0.3");
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
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
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(exitCode).toBe(0);

  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "nd")).toBe("1.0.0");
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
});

test.concurrent("dist-tag edges keep the version the tag resolved to", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "dep-with-tags": "pre-1", "dwt": "npm:dep-with-tags@1.0.0" } }),
  );
  await runBunInstall(bunEnv, packageDir);
  const lockBefore = await lock(packageDir);
  expect(lockBefore).toContain('"dep-with-tags@1.0.1"');
  expect(lockBefore).toContain('"dep-with-tags@1.0.0"');

  const check = await dedupe(packageDir, "--check");
  expect(check.stdout).toContain("Already deduplicated.");
  expect(check.exitCode).toBe(0);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(stdout).toContain("Already deduplicated.");
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

    Already deduplicated."
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
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(stderr).toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  expect(await nested()).toBe("1.1.0");

  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
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

// dedupe runs against the ranges recorded in bun.lock; a stale package.json is applied by the install that follows.
test.concurrent("stale package.json is resolved after the dedupe", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^2.0.0" } }),
  );

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(stdout).toContain("Removed 1 duplicate version: no-deps@1.1.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@2.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("2.0.0");
  expect((await dedupe(packageDir, "--check")).exitCode).toBe(0);
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
});

// pnpm/pnpm#9213 (and #6619): one-fixed-dep@1.0.0 dies in this run, so its exact no-deps@1.0.0 edge must not drag the live "^1.0.0" edges down.
test.concurrent("a version removed by the run does not vote for its own dependencies", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^1.0.0" } }),
  );
  await runBunInstall(bunEnv, packageDir);
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

    2 duplicate versions can be removed: no-deps@1.0.0, one-fixed-dep@1.0.0"
  `);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 2 duplicate versions: no-deps@1.0.0, one-fixed-dep@1.0.0",
  ]);
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

  const recheck = await dedupe(packageDir, "--check");
  expect(recheck.stdout).toContain("Already deduplicated.");
  expect(recheck.exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(after);
  await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
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

    1 duplicate version can be removed: no-deps@1.1.0"
  `);
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(widened);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--lockfile-only");
  expect(firstLines(stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const after = await lock(packageDir);
  expect(after).toContain('"bundled-1/no-deps": ["no-deps@1.0.0"');
  expect(after).toContain('"bundled": true');
  expect(after).not.toContain('"no-deps@1.1.0"');
});

// pnpm/pnpm#11238, #10329, #8446: dedupe never re-resolves, so it works with the registry down and ignores minimumReleaseAge.
test.concurrent("does not contact the registry", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  const closed = Bun.listen({ hostname: "localhost", port: 0, socket: { data() {} } });
  const port = closed.port;
  closed.stop(true);
  await write(
    join(packageDir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: join(packageDir, ".bun-cache"),
        registry: `http://localhost:${port}/`,
        minimumReleaseAge: 60 * 60 * 24 * 365 * 100,
      },
    }),
  );

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toMatchInlineSnapshot(`
    "bun dedupe <version> (<revision>)

    1 duplicate version can be removed: no-deps@1.1.0"
  `);
  expect(check.stderr).not.toContain("error:");
  expect(check.exitCode).toBe(1);

  const apply = await dedupe(packageDir, "--lockfile-only");
  expect(firstLines(apply.stdout, 3)).toEqual([
    "bun dedupe <version> (<revision>)",
    "",
    "Removed 1 duplicate version: no-deps@1.1.0",
  ]);
  expect(apply.stderr).toContain("Saved lockfile");
  expect(apply.stderr).not.toContain("error:");
  expect(apply.exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');

  const recheck = await dedupe(packageDir, "--check");
  expect(recheck.stdout).toContain("Already deduplicated.");
  expect(recheck.stderr).not.toContain("error:");
  expect(recheck.exitCode).toBe(0);
});
