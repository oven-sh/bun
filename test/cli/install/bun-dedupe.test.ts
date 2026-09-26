import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, exists, mkdir, realpath, rm } from "fs/promises";
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

const lines = (stdout: string) => normalizeBunSnapshot(stdout).split("\n");

function nodeModulesVersion(packageDir: string, ...segments: string[]) {
  return file(join(packageDir, "node_modules", ...segments, "package.json"))
    .json()
    .then(pkg => pkg.version);
}

// Every summary counts the lockfile's package entries (root included); `packages` keys are node_modules paths, so one entry can sit under several keys.
function lockPackageCount(lockfile: string) {
  const { packages = {} } = Bun.JSONC.parse(lockfile) as { packages?: Record<string, [string, ...unknown[]]> };
  return 1 + new Set(Object.values(packages).map(([resolution]) => resolution)).size;
}

const packagesWord = (n: number) => `${n} package${n === 1 ? "" : "s"}`;
const versionsWord = (n: number) => `${n} duplicate version${n === 1 ? "" : "s"}`;

const noDuplicates = (checked: number) =>
  `🎉 No duplicates — checked ${packagesWord(checked)} in bun.lock, every one already resolves to a single version`;
const wouldRemove = (removed: number, checked: number) =>
  `${versionsWord(removed)} can be removed (checked ${packagesWord(checked)} in bun.lock)`;
const HINT = "  bun dedupe";

const row = (label: string) => `~ ${label}`;

// normalizeBunSnapshot strips durations, so the summary line is checked for one on the raw output.
function expectTimed(stdout: string, summary: RegExp) {
  const line = stdout.split("\n").find(line => summary.test(line));
  expect(line).toMatch(/ \[\d+\.\d\d(ms|s)\]\r?$/);
  expect(stdout.match(/ \[\d+\.\d\d(ms|s)\]\r?$/gm)).toHaveLength(1);
}

const WOULD_REMOVE = /^\d+ duplicate versions? can be removed /;
const REMOVED = /^\d+ duplicate versions? removed/;
const NO_DUPLICATES = /^🎉 /;

function removedSummary(removed: number, checked?: number) {
  return new RegExp(
    `^${versionsWord(removed)} removed(, [1-9]\\d* packages? installed)? \\(checked ${
      checked === undefined ? "[1-9]\\d* packages?" : packagesWord(checked)
    } in bun\\.lock\\)$`,
  );
}

type Removed = { kept?: string[]; checked?: number };

// The rows, kept lines, a blank line and the summary end stdout; whatever the install printed sits between the header and the first row.
function expectRemoved(stdout: string, rows: string | string[], { kept = [], checked }: Removed = {}) {
  rows = [rows].flat();
  const out = lines(stdout);
  expect(out[0]).toBe(HEADER);
  const blockStart = out.length - rows.length - kept.length - 2;
  expect(out.slice(blockStart, -1)).toStrictEqual([...rows.map(row), ...kept, ""]);
  expect(out.at(-1)).toMatch(removedSummary(rows.length, checked));
  expectTimed(stdout, REMOVED);
  expect(
    out
      .slice(1, blockStart)
      .filter(
        line =>
          line.startsWith("~ ") ||
          line.startsWith("+ ") ||
          line.includes("duplicate") ||
          line.includes("kept ") ||
          line.includes("Checked ") ||
          line.includes("installed") ||
          line.includes("no changes"),
      ),
  ).toStrictEqual([]);
}

type Result = Awaited<ReturnType<typeof run>>;

function expectWouldRemove({ stdout, stderr }: Result, rows: string | string[], checked: number, kept: string[] = []) {
  rows = [rows].flat();
  expect(lines(stdout)).toStrictEqual([HEADER, ...rows.map(row), ...kept, "", wouldRemove(rows.length, checked), HINT]);
  expectTimed(stdout, WOULD_REMOVE);
  expect(stderr).not.toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
}

// One line, one duration, nothing saved: the same on `--check` and on a plain `bun dedupe`.
function expectNoDuplicates({ stdout, stderr, exitCode }: Result, checked?: number, kept: string[] = []) {
  expect(lines(stdout)).toStrictEqual([
    HEADER,
    ...kept,
    ...(kept.length ? [""] : []),
    checked === undefined
      ? expect.stringMatching(/^🎉 No duplicates — checked [1-9]\d* packages? in bun\.lock, /)
      : noDuplicates(checked),
  ]);
  expectTimed(stdout, NO_DUPLICATES);
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("Saved lockfile");
  expect(exitCode).toBe(0);
}

async function expectAlreadyDeduplicated(dir: string, checked?: number, kept: string[] = []) {
  expectNoDuplicates(await dedupe(dir, "--check"), checked, kept);
  expectNoDuplicates(await dedupe(dir), checked, kept);
}

async function expectRefused(dir: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await dedupe(dir, ...args);
  expect(lines(stderr)).toStrictEqual([
    "error: bun.lock does not match package.json, nothing to dedupe",
    "note: run 'bun install' first",
  ]);
  expect(lines(stdout)).toStrictEqual([HEADER]);
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
  const nested = join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps");
  expect(await nodeModulesVersion(packageDir, "one-range-dep", "node_modules", "no-deps")).toBe("1.1.0");

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(lines(stdout)).toStrictEqual([
    HEADER,
    "~ no-deps 1.1.0 -> 1.0.0",
    "",
    "1 duplicate version removed (checked 4 packages in bun.lock)",
  ]);
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked: 4 });
  expect(lines(stderr)).toStrictEqual(["Saved lockfile"]);
  expect(exitCode).toBe(0);
  expect(await exists(nested)).toBeFalse();
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.0");

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
  expectRemoved(stdout, "no-deps 1.0.0 -> 1.1.0", { checked: 4 });
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

  expect(lockPackageCount(lockBefore)).toBe(4);

  const check = await dedupe(packageDir, "--check");
  expect(lines(check.stdout)).toMatchInlineSnapshot(`
    [
      "bun dedupe <version> (<revision>)",
      "~ no-deps 1.1.0 -> 1.0.0",
      "",
      "1 duplicate version can be removed (checked 4 packages in bun.lock)",
      "  bun dedupe",
    ]
  `);
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await file(packageJson).text()).toBe(pkgJsonBefore);
  expect(await readdirSorted(join(packageDir, "node_modules"))).toStrictEqual(nodeModulesBefore);
  expect(await file(nestedPkgJson).json()).toStrictEqual({ name: "no-deps", version: "1.1.0" });
});

// `--dry-run` shows the plan and succeeds like `bun prune --dry-run`; only `--check` is the CI gate.
test.concurrent("--dry-run prints what --check prints and exits 0", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const dryRun = await dedupe(packageDir, "--dry-run");
  expectWouldRemove(dryRun, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(dryRun.stderr).toBe("");
  expect(dryRun.exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(lockBefore);

  const check = await dedupe(packageDir, "--check");
  expect(normalizeBunSnapshot(check.stdout)).toBe(normalizeBunSnapshot(dryRun.stdout));
  expect(check.exitCode).toBe(1);

  const both = await dedupe(packageDir, "--dry-run", "--check");
  expect(normalizeBunSnapshot(both.stdout)).toBe(normalizeBunSnapshot(dryRun.stdout));
  expect(both.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await nodeModulesVersion(packageDir, "one-range-dep", "node_modules", "no-deps")).toBe("1.1.0");
});

// A `wanted <range> by <dependents>` line under a row; ranges are padded to the row's widest range.
const wanted = (range: string, by: string, width = range.length) => `    wanted ${range.padEnd(width)} by ${by}`;

test.concurrent("--why lists one level of dependents grouped by requested range", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all(
    ["a", "b", "c", "d"].map(name =>
      write(
        join(packageDir, "packages", name, "package.json"),
        JSON.stringify({ name, dependencies: { "no-deps": "^1.0.0" } }),
      ),
    ),
  );
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "root", workspaces: ["packages/*"] },
    { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } },
  );
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  // The larger group first, dependents in name order, capped at three with a count of the rest.
  const checked = lockPackageCount(lockfile);
  const rows = [
    "~ no-deps 1.1.0 -> 1.0.0",
    wanted("^1.0.0", "a, b, c +1 more"),
    wanted("1.0.0", "root", "^1.0.0".length),
  ];
  const check = await dedupe(packageDir, "--check", "--why");
  expect(lines(check.stdout)).toStrictEqual([HEADER, ...rows, "", wouldRemove(1, checked), HINT]);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockfile);

  // Without --why the rows stay terse.
  const plain = await dedupe(packageDir, "--check");
  expectWouldRemove(plain, "no-deps 1.1.0 -> 1.0.0", checked);
  expect(plain.stdout).not.toContain("wanted");

  // Applying with --why prints the same block before the summary.
  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--why");
  const out = lines(stdout);
  expect(out.slice(-5, -1)).toStrictEqual([...rows, ""]);
  expect(out.at(-1)).toMatch(removedSummary(1, checked));
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// The dropped no-deps@2.0.0 has no surviving dependent: --why shows the removed one-fixed-dep@2.0.0, versioned because the name is ambiguous.
test.concurrent("--why explains a dropped version through its removed dependent", async () => {
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

  const checked = lockPackageCount(lockfile);
  const check = await dedupe(packageDir, "--check", "--why");
  expect(lines(check.stdout)).toStrictEqual([
    HEADER,
    "~ no-deps 2.0.0 -> (removed)",
    wanted("2.0.0", "one-fixed-dep@2.0.0"),
    "~ one-fixed-dep 2.0.0 -> 1.0.0 (downgrade)",
    wanted(">=1.0.0", "foo", "npm:one-fixed-dep@1.0.0".length),
    wanted("npm:one-fixed-dep@1.0.0", "foo"),
    "",
    wouldRemove(2, checked),
    HINT,
  ]);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockfile);
});

// Two aliases produce two identical edges from one package; --why lists the dependent once.
test.concurrent("--why lists a dependent once when two aliases share the same range", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-range-dep": "1.0.0" } },
    {
      name: "foo",
      dependencies: { "one-range-dep": "1.0.0", "nd1": "npm:no-deps@1.0.0", "nd2": "npm:no-deps@1.0.0" },
    },
  );
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');

  const checked = lockPackageCount(lockfile);
  const check = await dedupe(packageDir, "--check", "--why");
  expect(lines(check.stdout)).toStrictEqual([
    HEADER,
    "~ no-deps 1.1.0 -> 1.0.0",
    wanted("^1.0.0", "one-range-dep", "npm:no-deps@1.0.0".length),
    wanted("npm:no-deps@1.0.0", "foo"),
    "",
    wouldRemove(1, checked),
    HINT,
  ]);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockfile);
});

test.concurrent("--no-summary keeps the rows and the hint but drops the count line", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const check = await dedupe(packageDir, "--check", "--no-summary");
  expect(lines(check.stdout).filter(Boolean)).toStrictEqual(["~ no-deps 1.1.0 -> 1.0.0", HINT]);
  expect(check.stdout).not.toMatch(/\[\d+\.\d\d(ms|s)\]/);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);

  const dryRun = await dedupe(packageDir, "--dry-run", "--no-summary");
  expect(dryRun.stdout).toBe(check.stdout);
  expect(dryRun.exitCode).toBe(0);
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

  expect(lockPackageCount(lockAfterFirst)).toBe(3);

  const second = await dedupe(packageDir);
  expect(lines(second.stdout)).toMatchInlineSnapshot(`
    [
      "bun dedupe <version> (<revision>)",
      "🎉 No duplicates — checked 3 packages in bun.lock, every one already resolves to a single version",
    ]
  `);
  expect(second.stderr).toBe("");
  expectNoDuplicates(second, 3);
  expect(await lock(packageDir)).toBe(lockAfterFirst);

  for (const flag of ["--check", "--dry-run", "--frozen-lockfile", "--production", "--no-save"]) {
    const rerun = await dedupe(packageDir, flag);
    expect(normalizeBunSnapshot(rerun.stdout)).toBe(normalizeBunSnapshot(second.stdout));
    expect(rerun.stderr).toBe("");
    expect(rerun.exitCode).toBe(0);
    expect(await lock(packageDir)).toBe(lockAfterFirst);
  }
});

test.concurrent.each(["hoisted", "isolated"] as const)("a no-op prints one summary line (%s linker)", async linker => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);
  expect(lockPackageCount(lockBefore)).toBe(3);

  for (const args of [[], ["--check"], ["--lockfile-only"]]) {
    const result = await dedupe(packageDir, ...args, "--linker", linker);
    expectNoDuplicates(result, 3);
    expect(result.stderr).toBe("");
    expect(await lock(packageDir)).toBe(lockBefore);
  }
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

  await expectAlreadyDeduplicated(packageDir, 5);
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
  expectRemoved(stdout, "no-deps 1.0.0 -> 1.1.0", { checked: 4 });
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

  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, "no-deps 1.0.0 -> 1.1.0", 4);
  expect(check.exitCode).toBe(1);
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

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--help");
  expect(stdout).toContain("Usage: bun dedupe [flags]");
  const out = lines(stdout);
  const flagsStart = out.indexOf("Flags:") + 1;
  expect(flagsStart).toBeGreaterThan(0);
  const flagLines = out.slice(flagsStart, out.indexOf("", flagsStart));
  expect(flagLines.map(line => line.match(/--[\w-]+/)![0])).toStrictEqual([
    "--check",
    "--dry-run",
    "--why",
    "--lockfile-only",
    "--frozen-lockfile",
    "--linker",
    "--silent",
    "--cwd",
    "--help",
  ]);
  expect(flagLines.find(line => line.includes("--dry-run"))).toContain("without changing anything");
  expect(flagLines.find(line => line.includes("--help"))).toStartWith("  -h, --help");
  expect(stderr).toBe("");
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

  const check = await dedupe(packageDir, "--check", "--linker", "isolated");
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--linker", "isolated");
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked: 4 });
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

  const checked = lockPackageCount(heldByPeer);
  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", checked);
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(heldByPeer);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(lockPackageCount(after)).toBe(checked - 1);
  await expectAlreadyDeduplicated(packageDir, checked - 1);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

const REFUSALS: [string, string][] = [
  ["--frozen-lockfile", "--frozen-lockfile was passed"],
  ["--production", "--production implies --frozen-lockfile"],
  ["--no-save", "--no-save was passed"],
];

function refusalStderr(removed: number, reason: string) {
  return [
    `error: ${versionsWord(removed)} can be removed, but ${reason}`,
    `note: run 'bun dedupe' to remove ${removed === 1 ? "it" : "them"}, or 'bun dedupe --check' in CI`,
  ];
}

// The plan is reported exactly like --check; the error and its remedy stay together on stderr so `2>/dev/null` leaves no orphan hint.
function expectRefusedToWrite(
  { stdout, stderr, exitCode }: Result,
  rows: string | string[],
  checked: number,
  reason: string,
  kept: string[] = [],
) {
  rows = [rows].flat();
  expect(lines(stdout)).toStrictEqual([HEADER, ...rows.map(row), ...kept, "", wouldRemove(rows.length, checked)]);
  expectTimed(stdout, WOULD_REMOVE);
  expect(lines(stderr)).toStrictEqual(refusalStderr(rows.length, reason));
  expect(exitCode).toBe(1);
}

test.concurrent.each(REFUSALS)("%s with duplicates errors instead of claiming removal", async (flag, reason) => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const result = await dedupe(packageDir, flag);
  expectRefusedToWrite(result, "no-deps 1.1.0 -> 1.0.0", 4, reason);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await nodeModulesVersion(packageDir, "one-range-dep", "node_modules", "no-deps")).toBe("1.1.0");
});

test.concurrent("--lockfile-only still refuses under --frozen-lockfile", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const lockfileOnly = await dedupe(packageDir, "--frozen-lockfile", "--lockfile-only");
  expectRefusedToWrite(lockfileOnly, "no-deps 1.1.0 -> 1.0.0", 4, "--frozen-lockfile was passed");
  expect(await lock(packageDir)).toBe(lockBefore);
});

test.concurrent.each(REFUSALS)("%s succeeds when already deduplicated", async flag => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);

  const result = await dedupe(packageDir, flag);
  expectNoDuplicates(result, 3);
  expect(result.stderr).toBe("");
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

  const rows = ["no-deps 2.0.0 -> (removed)", "one-fixed-dep 2.0.0 -> 1.0.0 (downgrade)"];
  const checked = lockPackageCount(lockfile);
  expect(checked).toBe(5);
  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, rows, checked);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, rows, { checked });
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

  const rows = ["@types/is-number 2.0.0 -> 1.0.0 (downgrade)", "no-deps 1.1.0 -> 1.0.0"];
  const checked = lockPackageCount(lockfile);
  expect(checked).toBe(6);
  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, rows, checked);
  expect(check.exitCode).toBe(1);

  const frozen = await dedupe(packageDir, "--frozen-lockfile");
  expectRefusedToWrite(frozen, rows, checked, "--frozen-lockfile was passed");
  expect(await lock(packageDir)).toBe(lockfile);

  const { stdout, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, rows, { checked });
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
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await exists(join(workspaceDir, "bun.lock"))).toBeFalse();
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// https://github.com/oven-sh/bun/issues/40393: each spec resolves to the sibling workspace;
// reloading bun.lock and reparsing package.json must yield the same edge, or bun dedupe refuses.
test.concurrent.each([
  {
    spec: "* on a versionless workspace",
    app1: { dependencies: { package1: "*" } },
    pkg1: {},
  },
  {
    spec: "* on a prerelease workspace",
    app1: { dependencies: { package1: "*" } },
    pkg1: { version: "1.0.0-alpha" },
  },
  {
    spec: "npm:@* on a versionless workspace",
    app1: { dependencies: { aliased: "npm:package1@*" } },
    pkg1: {},
  },
  {
    spec: "catalog: on a workspace",
    app1: { dependencies: { package1: "catalog:" } },
    pkg1: { version: "1.0.0" },
  },
  {
    spec: "workspace: alias of a workspace",
    app1: { dependencies: { aliased: "workspace:package1@*" } },
    pkg1: {},
  },
  {
    spec: "workspace:* in dev and ^1 in peer",
    app1: { devDependencies: { package1: "workspace:*" }, peerDependencies: { package1: "^1.0.0" } },
    pkg1: { version: "1.0.0" },
  },
])("$spec is in sync", async ({ app1, pkg1 }) => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({ name: "root", workspaces: { packages: ["app1", "package1"], catalog: { package1: "^1.0.0" } } }),
    ),
    write(join(packageDir, "app1", "package.json"), JSON.stringify({ name: "app1", ...app1 })),
    write(join(packageDir, "package1", "package.json"), JSON.stringify({ name: "package1", ...pkg1 })),
  ]);
  await runBunInstall(installEnv(packageDir), packageDir);
  await expectAlreadyDeduplicated(packageDir, 3);
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

  for (const flag of ["--check", "--dry-run"]) {
    const check = await dedupe(packageDir, flag);
    expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", 4);
    expect(check.exitCode).toBe(flag === "--check" ? 1 : 0);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    expect(await lock(packageDir)).toBe(lockBefore);
  }

  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
  const apply = await dedupe(packageDir);
  expectRemoved(apply.stdout, "no-deps 1.1.0 -> 1.0.0", { checked: 4 });
  expect(apply.exitCode).toBe(0);
  const lockDeduped = await lock(packageDir);
  await rm(join(packageDir, "node_modules"), { recursive: true });

  // A no-op exits before the install step, so a plain `bun dedupe` creates nothing either.
  await expectAlreadyDeduplicated(packageDir, 3);
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

  await expectAlreadyDeduplicated(packageDir, 2);
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
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
  expect(await exists(marker)).toBe(runs);
});

test.concurrent("the report is printed as one block after root lifecycle script output", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  const pkg = await file(packageJson).json();
  await write(packageJson, JSON.stringify({ ...pkg, scripts: { postinstall: "echo postinstall ran" } }));

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  const out = lines(stdout);
  const scriptOutput = out.indexOf("postinstall ran");
  const firstRow = out.findIndex(line => line.startsWith("~ "));
  expect(scriptOutput).toBeGreaterThan(0);
  expect(firstRow).toBeGreaterThan(scriptOutput);
  expect(out.slice(firstRow)).toStrictEqual([
    "~ no-deps 1.1.0 -> 1.0.0",
    "",
    "1 duplicate version removed (checked 4 packages in bun.lock)",
  ]);
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked: 4 });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
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
  expectRemoved(stdout, "a-dep 1.0.10 -> 1.0.3");
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
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
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

  await expectAlreadyDeduplicated(packageDir, 3);
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

  await expectAlreadyDeduplicated(packageDir, 4);
  expect(await lock(packageDir)).toBe(patched);
});

test.concurrent("--lockfile-only rewrites bun.lock without installing", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await setupRangeDuplicate(packageDir, packageJson);
  const nested = () => nodeModulesVersion(packageDir, "one-range-dep", "node_modules", "no-deps");
  expect(await nested()).toBe("1.1.0");

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--lockfile-only");
  expect(lines(stdout)).toStrictEqual([
    HEADER,
    "~ no-deps 1.1.0 -> 1.0.0",
    "",
    "1 duplicate version removed (checked 4 packages in bun.lock)",
  ]);
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked: 4 });
  expect(lines(stderr)).toStrictEqual(["Saved lockfile"]);
  expect(exitCode).toBe(0);
  const lockDeduped = await lock(packageDir);
  expect(lockDeduped).not.toContain('"no-deps@1.1.0"');
  expect(await nested()).toBe("1.1.0");

  // Nothing left to remove: one line, and the unchanged lockfile is not saved again.
  const again = await dedupe(packageDir, "--lockfile-only");
  expectNoDuplicates(again, 3);
  expect(again.stderr).toBe("");
  expect(await lock(packageDir)).toBe(lockDeduped);

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

  const dryRun = await dedupe(packageDir, "--dry-run", "--silent");
  expect(dryRun.stdout).toBe("");
  expect(dryRun.stderr).toBe("");
  expect(dryRun.exitCode).toBe(0);
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

test.concurrent(
  "hoisted: a workspace's collapsed nested copy is removed, foreign directories in the same folder are not",
  async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const workspaceDir = join(packageDir, "packages", "a");
    await write(
      join(workspaceDir, "package.json"),
      JSON.stringify({ name: "a", dependencies: { "no-deps": "^1.0.0" } }),
    );
    const lockfile = await installTwice(
      packageDir,
      packageJson,
      { name: "root", workspaces: ["packages/*"] },
      { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } },
    );
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.1.0"');
    const versions = () =>
      Promise.all([nodeModulesVersion(packageDir, "no-deps"), nodeModulesVersion(workspaceDir, "no-deps")]);
    expect(await versions()).toStrictEqual(["1.0.0", "1.1.0"]);

    // Stand-ins for a manual `bun link` inside the workspace and an extraneous root package: bun.lock never placed them.
    const handLinked = join(workspaceDir, "node_modules", "hand-linked", "package.json");
    const extraneous = join(packageDir, "node_modules", "extraneous", "package.json");
    await Promise.all([
      mkdir(dirname(handLinked), { recursive: true }),
      mkdir(dirname(extraneous), { recursive: true }),
    ]);
    await Promise.all([write(handLinked, '{"name":"hand-linked"}'), write(extraneous, '{"name":"extraneous"}')]);

    const { stdout, stderr, exitCode } = await dedupe(packageDir);
    expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');
    expect(await exists(join(workspaceDir, "node_modules", "no-deps"))).toBeFalse();
    expect(await Promise.all([exists(handLinked), exists(extraneous)])).toStrictEqual([true, true]);
    expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.0");
    await expectAlreadyDeduplicated(packageDir);
    await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
  },
);

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
          expectRemoved(stdout, "no-deps 1.0.0 -> 1.1.0");
          expect(stderr).not.toContain("error:");
          expect(exitCode).toBe(0);
          expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.1.0");
          expect(
            await exists(join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps")),
          ).toBeFalse();
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
          await expectAlreadyDeduplicated(packageDir, 3);
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
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
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
  expectRemoved(stdout, "dep-with-tags 1.0.1 -> 1.0.0");
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

// no-deps ends up as: direct ^1.0.0 @1.1.0, `<=1.0.1` @1.0.1, `>=1.0.1` @1.0.1, exact 1.0.0 — {1.0.0, 1.1.0} and {1.0.0, 1.0.1} are equally small covers; 1.0.1's two edges land on different survivors.
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

    const checked = lockPackageCount(lockfile);
    const check = await dedupe(packageDir, "--check");
    expectWouldRemove(check, "no-deps 1.0.1 -> 1.0.0, 1.1.0", checked);
    expect(check.exitCode).toBe(1);

    const { stdout, stderr, exitCode } = await dedupe(packageDir);
    expectRemoved(stdout, "no-deps 1.0.1 -> 1.0.0, 1.1.0", { checked });
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
  const nestedVersions = () =>
    Promise.all([
      nodeModulesVersion(packageDir, "a-dep"),
      nodeModulesVersion(packageDir, "uses-a-dep-3", "node_modules", "a-dep"),
      nodeModulesVersion(join(packageDir, "packages", "b"), "a-dep"),
    ]);
  expect(await nestedVersions()).toStrictEqual(["1.0.5", "1.0.3", "1.0.3"]);
  expect(await nodeModulesVersion(packageDir, "uses-a-dep-10", "node_modules", "a-dep")).toBe("1.0.10");

  const checked = lockPackageCount(lockfile);
  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, "a-dep 1.0.5 -> 1.0.10", checked);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "a-dep 1.0.5 -> 1.0.10", { checked });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"a-dep@1.0.3"');
  expect(after).toContain('"a-dep@1.0.10"');
  expect(after).not.toContain('"a-dep@1.0.5"');
  expect(after).not.toContain('"uses-a-dep-10/a-dep"');
  // uses-a-dep-10 now loads the hoisted 1.0.10, so its nested copy goes; the rows that survived keep their folders.
  expect(await exists(join(packageDir, "node_modules", "uses-a-dep-10", "node_modules", "a-dep"))).toBeFalse();
  expect(await nestedVersions()).toStrictEqual(["1.0.10", "1.0.3", "1.0.3"]);
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
  const versions = () =>
    Promise.all([
      nodeModulesVersion(packageDir, "a-dep"),
      nodeModulesVersion(packageDir, "uses-a-dep-3", "node_modules", "a-dep"),
      nodeModulesVersion(join(packageDir, "packages", "b"), "a-dep"),
      nodeModulesVersion(packageDir, "no-deps"),
    ]);
  expect(await versions()).toStrictEqual(["1.0.10", "1.0.3", "1.0.3", "1.0.0"]);
  const nestedNoDeps = join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps");
  expect(await nodeModulesVersion(packageDir, "one-range-dep", "node_modules", "no-deps")).toBe("1.1.0");

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"a-dep": ["a-dep@1.0.10"');
  expect(after).toContain('"a-dep@1.0.3"');
  expect(after).not.toContain('"uses-a-dep-10/a-dep"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await exists(nestedNoDeps)).toBeFalse();
  expect(await versions()).toStrictEqual(["1.0.10", "1.0.3", "1.0.3", "1.0.0"]);
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
  expectRemoved(stdout, "a-dep 1.0.5 -> 1.0.10");
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
  expectRemoved(stdout, "dep-with-tags 3.0.1 -> 3.0.0");
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
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
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

  expect(lockPackageCount(lockfile)).toBe(7);
  const kept = ["  kept one-fixed-dep@1.0.0 (needed to reach patched no-deps@1.0.0)"];

  // Rows first (the kept row belongs with them), then the one summary line, then the hint.
  const check = await dedupe(packageDir, "--check");
  expect(lines(check.stdout)).toMatchInlineSnapshot(`
    [
      "bun dedupe <version> (<revision>)",
      "~ dep-with-tags 3.0.1 -> 3.0.0",
      "  kept one-fixed-dep@1.0.0 (needed to reach patched no-deps@1.0.0)",
      "",
      "1 duplicate version can be removed (checked 7 packages in bun.lock)",
      "  bun dedupe",
    ]
  `);
  expectWouldRemove(check, "dep-with-tags 3.0.1 -> 3.0.0", 7, kept);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockfile);

  const frozen = await dedupe(packageDir, "--frozen-lockfile");
  expectRefusedToWrite(frozen, "dep-with-tags 3.0.1 -> 3.0.0", 7, "--frozen-lockfile was passed", kept);
  expect(await lock(packageDir)).toBe(lockfile);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "dep-with-tags 3.0.1 -> 3.0.0", { kept, checked: 7 });
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

  expect(lockPackageCount(after)).toBe(6);
  const recheck = await dedupe(packageDir, "--check");
  expect(lines(recheck.stdout)).toMatchInlineSnapshot(`
    [
      "bun dedupe <version> (<revision>)",
      "  kept one-fixed-dep@1.0.0 (needed to reach patched no-deps@1.0.0)",
      "",
      "🎉 No duplicates — checked 6 packages in bun.lock, every one already resolves to a single version",
    ]
  `);
  expectNoDuplicates(recheck, 6, kept);
  expectNoDuplicates(await dedupe(packageDir), 6, kept);
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

  const rows = ["no-deps 1.0.0 -> (removed)", "one-fixed-dep 1.0.0 -> 2.0.0"];
  const checked = lockPackageCount(lockfile);
  expect(checked).toBe(7);
  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, rows, checked);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, rows, { checked });
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

  await expectAlreadyDeduplicated(packageDir, 5);
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

  const checked = lockPackageCount(widened);
  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", checked);
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(widened);

  const { stdout, stderr, exitCode } = await dedupe(packageDir, "--lockfile-only");
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked });
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
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(check.exitCode).toBe(1);

  const apply = await dedupe(packageDir, "--lockfile-only");
  expectRemoved(apply.stdout, "no-deps 1.1.0 -> 1.0.0", { checked: 4 });
  expect(apply.stderr).toContain("Saved lockfile");
  expect(apply.stderr).not.toContain("error:");
  expect(apply.exitCode).toBe(0);
  expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');

  await expectAlreadyDeduplicated(packageDir, 3);
  expect(requests).toStrictEqual([]);
});

// The tarball and the folder both unpack to a package named no-deps, so they share the npm versions' package_index entry.
test.concurrent.each<[string, (packageDir: string) => Promise<string>, string]>([
  [
    "a local tarball",
    async packageDir => {
      await copyFile(
        join(registry.packagesPath, "no-deps", "no-deps-2.0.0.tgz"),
        join(packageDir, "no-deps-2.0.0.tgz"),
      );
      return "file:./no-deps-2.0.0.tgz";
    },
    "no-deps-2.0.0.tgz",
  ],
  [
    "a folder",
    async packageDir => {
      await write(join(packageDir, "vendored", "package.json"), JSON.stringify({ name: "no-deps", version: "2.0.0" }));
      return "file:./vendored";
    },
    "vendored",
  ],
])("a non-registry resolution of the same name is left alone (%s)", async (_, prepare, resolutionSuffix) => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const spec = await prepare(packageDir);
  const lockfile = await installTwice(
    packageDir,
    packageJson,
    { name: "foo", dependencies: { "one-range-dep": "1.0.0", "nd-local": spec } },
    { name: "foo", dependencies: { "one-range-dep": "1.0.0", "nd-local": spec, "no-deps": "1.0.0" } },
  );
  expect(lockfile).toContain('"no-deps@1.0.0"');
  expect(lockfile).toContain('"no-deps@1.1.0"');
  const localEntry = lockfile.split("\n").find(line => line.trimStart().startsWith('"nd-local": ["no-deps@'));
  expect(localEntry).toContain(resolutionSuffix);
  expect(await nodeModulesVersion(packageDir, "nd-local")).toBe("2.0.0");

  // The non-registry copy is checked (it is a lockfile package) but never a candidate.
  const checked = lockPackageCount(lockfile);
  expect(checked).toBe(5);
  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", checked);
  expect(check.exitCode).toBe(1);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(after.split("\n")).toContain(localEntry);
  expect(await nodeModulesVersion(packageDir, "nd-local")).toBe("2.0.0");
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.0");
  await expectAlreadyDeduplicated(packageDir, 4);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// The installer skips overrides for `npm:` aliases, so the alias keeps 1.0.0 while the override holds one-range-dep's edge on 1.1.0.
test.concurrent("an npm: alias edge is not subject to the override for the aliased name", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { "one-range-dep": "1.0.0", "nd": "npm:no-deps@1.0.0" },
      overrides: { "no-deps": "1.1.0" },
    }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);
  expect(lockBefore).toContain('"no-deps@1.0.0"');
  expect(lockBefore).toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "nd")).toBe("1.0.0");
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.1.0");

  await expectAlreadyDeduplicated(packageDir, 4);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await nodeModulesVersion(packageDir, "nd")).toBe("1.0.0");
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.1.0");
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

// `bun install` deletes an empty lockfile instead of writing one, so this shape only comes from a hand-written bun.lock.
const emptyRootLockfile = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "foo",
    },
  },
  "packages": {}
}
`;

test.concurrent("a lockfile whose root has no dependencies is reported as deduplicated", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "foo" })),
    write(join(packageDir, "bun.lock"), emptyRootLockfile),
  ]);
  const lockBefore = emptyRootLockfile;

  // The root itself is the one package checked, like every other summary in the install family counts it.
  const check = await dedupe(packageDir, "--check");
  expect(lines(check.stdout)).toMatchInlineSnapshot(`
    [
      "bun dedupe <version> (<revision>)",
      "🎉 No duplicates — checked 1 package in bun.lock, every one already resolves to a single version",
    ]
  `);
  expectNoDuplicates(check, 1);
  expect(await lock(packageDir)).toBe(lockBefore);

  const apply = await dedupe(packageDir);
  expectNoDuplicates(apply, 1);
  expect(apply.stderr).toBe("");
  expect(await exists(join(packageDir, "bun.lock"))).toBeTrue();
  expect(await lock(packageDir)).toBe(lockBefore);
});

test.concurrent("refuses when every dependency was removed from package.json since the last install", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  await write(packageJson, JSON.stringify({ name: "foo" }));

  await expectRefused(packageDir, "--check");
  await expectRefused(packageDir);
  expect(await lock(packageDir)).toBe(lockBefore);
});

// The docs' out-of-date rule applies in this direction too; resolving the new dependency would be `bun install`'s job.
test.concurrent("refuses when dependencies were added to a package.json whose lockfile has none", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } })),
    write(join(packageDir, "bun.lock"), emptyRootLockfile),
  ]);
  const lockBefore = emptyRootLockfile;

  await expectRefused(packageDir, "--check");
  expect(await lock(packageDir)).toBe(lockBefore);
  await expectRefused(packageDir);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeFalse();
});

const npmLockWithDuplicate = JSON.stringify({
  name: "foo",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "foo", dependencies: { "no-deps": "1.0.0", "one-range-dep": "1.0.0" } },
    "node_modules/no-deps": { version: "1.0.0" },
    "node_modules/one-range-dep": { version: "1.0.0", dependencies: { "no-deps": "^1.0.0" } },
    "node_modules/one-range-dep/node_modules/no-deps": { version: "1.1.0" },
  },
});

// Like every other install command, a foreign lockfile is migrated in memory before the missing-lockfile check.
test.concurrent("migrates package-lock.json when there is no bun.lock", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0", "one-range-dep": "1.0.0" } })),
    write(join(packageDir, "package-lock.json"), npmLockWithDuplicate),
  ]);

  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(check.stderr).toContain("migrated lockfile from package-lock.json");
  expect(check.exitCode).toBe(1);
  expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();

  // Nothing was installed before this run, so the summary also carries the install count.
  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0", { checked: 4 });
  expect(lines(stdout).at(-1)).toBe(
    "1 duplicate version removed, 2 packages installed (checked 4 packages in bun.lock)",
  );
  expect(stderr).toContain("migrated lockfile from package-lock.json");
  expect(stderr).toContain("Saved lockfile");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const after = await lock(packageDir);
  expect(after).toContain('"no-deps@1.0.0"');
  expect(after).not.toContain('"no-deps@1.1.0"');
  expect(await nodeModulesVersion(packageDir, "no-deps")).toBe("1.0.0");
  expect(await exists(join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps"))).toBeFalse();
  await expectAlreadyDeduplicated(packageDir, 3);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("corrupt package-lock.json fails without writing bun.lock", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } })),
    write(join(packageDir, "package-lock.json"), "{ not valid"),
  ]);

  for (const args of [[], ["--check"]]) {
    const { stdout, stderr, exitCode } = await dedupe(packageDir, ...args);
    expect(stderr).toContain("error: failed to migrate lockfile: ");
    expect(stderr).not.toContain("Saved lockfile");
    expect(stdout).not.toContain("duplicate");
    expect(exitCode).not.toBe(0);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  }
});

test.concurrent("a bun.lock that cannot be read fails without touching it", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } })),
    mkdir(join(packageDir, "bun.lock")),
  ]);

  for (const args of [[], ["--check"]]) {
    const { stdout, stderr, exitCode } = await dedupe(packageDir, ...args);
    expect(stderr).toMatch(/error: failed to (open|read) lockfile: /);
    expect(stderr).not.toContain("missing lockfile");
    expect(stdout).not.toContain("duplicate");
    expect(exitCode).not.toBe(0);
    expect(await readdirSorted(join(packageDir, "bun.lock"))).toStrictEqual([]);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  }
});

test.concurrent("--silent prints nothing on the error and no-op paths either", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const frozen = await dedupe(packageDir, "--frozen-lockfile", "--silent");
  expect(frozen.stdout).toBe("");
  expect(frozen.stderr).toBe("");
  expect(frozen.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);

  const apply = await dedupe(packageDir, "--silent");
  expect(apply.stdout).toBe("");
  expect(apply.stderr).toBe("");
  expect(apply.exitCode).toBe(0);
  const lockDeduped = await lock(packageDir);
  expect(lockDeduped).not.toContain('"no-deps@1.1.0"');

  for (const args of [["--check"], []]) {
    const clean = await dedupe(packageDir, ...args, "--silent");
    expect(clean.stdout).toBe("");
    expect(clean.stderr).toBe("");
    expect(clean.exitCode).toBe(0);
    expect(await lock(packageDir)).toBe(lockDeduped);
  }
});

test.concurrent("--silent prints nothing when refusing either", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "^1.0.0" } }),
  );
  for (const args of [["--check"], []]) {
    const stale = await dedupe(packageDir, ...args, "--silent");
    expect(stale.stdout).toBe("");
    expect(stale.stderr).toBe("");
    expect(stale.exitCode).toBe(1);
    expect(await lock(packageDir)).toBe(lockBefore);
  }

  await rm(join(packageDir, "bun.lock"));
  for (const args of [["--check"], []]) {
    const missing = await dedupe(packageDir, ...args, "--silent");
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toBe("");
    expect(missing.exitCode).toBe(1);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
  }
});

test.concurrent(
  "bun dedupe wins over a package.json script named dedupe; bun run dedupe still runs the script",
  async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await setupRangeDuplicate(packageDir, packageJson);
    const pkg = await file(packageJson).json();
    await write(packageJson, JSON.stringify({ ...pkg, scripts: { dedupe: "echo SCRIPT_RAN" } }));

    const { stdout, stderr, exitCode } = await dedupe(packageDir);
    expectRemoved(stdout, "no-deps 1.1.0 -> 1.0.0");
    expect(stdout).not.toContain("SCRIPT_RAN");
    expect(stderr).not.toContain("SCRIPT_RAN");
    expect(exitCode).toBe(0);
    expect(await lock(packageDir)).not.toContain('"no-deps@1.1.0"');

    const script = await run(packageDir, "run", "dedupe");
    expect(script.stdout).toContain("SCRIPT_RAN");
    expect(script.exitCode).toBe(0);
  },
);

test.concurrent("errors without a package.json", async () => {
  const { packageDir } = await registry.createTestDir();

  for (const args of [[], ["--check"]]) {
    const { stdout, stderr, exitCode } = await dedupe(packageDir, ...args);
    expect(stderr).toContain("error: missing package.json, nothing to dedupe");
    expect(stdout).not.toContain("duplicate");
    expect(exitCode).toBe(1);
  }
  expect(await readdirSorted(packageDir)).toStrictEqual(["bunfig.toml"]);
});

test.concurrent("exits 1 and keeps bun.lock when the install after deduplicating fails", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockfile = await setupRangeDuplicate(packageDir, packageJson);
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("tarballs are unavailable", { status: 500 }),
  });
  // Tarball URLs are recorded per package, so the lockfile is what points the install at the failing server.
  expect(lockfile).toContain(registry.registryUrl());
  await Promise.all([
    rm(join(packageDir, "node_modules"), { recursive: true }),
    rm(join(packageDir, ".bun-cache"), { recursive: true }),
    write(
      join(packageDir, "bun.lock"),
      lockfile.replaceAll(registry.registryUrl(), `http://localhost:${server.port}/`),
    ),
  ]);

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expect(normalizeBunSnapshot(stdout).split("\n")[0]).toBe(HEADER);
  // The report is only printed once the install finishes, so a failed run never claims a removal.
  expect(stdout).not.toContain("Removed");
  expect(stderr).toContain("error:");
  expect(exitCode).toBe(1);
  // A failed install persists nothing: bun.lock still holds both versions and can be deduplicated again.
  expect(await lock(packageDir)).toContain('"no-deps@1.1.0"');
  expect(await exists(join(packageDir, "node_modules", "no-deps", "package.json"))).toBeFalse();
});

// Two dropped versions each guard patched packages: deep-child@1.0.0 leads to two of them, one-fixed-dep@1.0.0 to one; dep-with-tags@3.0.1 is the removable duplicate.
test.concurrent("several kept versions are listed in name order with their patched packages joined", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const patchedDependencies = {
    "no-deps@1.0.0": "patches/no-deps@1.0.0.patch",
    "optional-peer-hoist-leaf@2.0.0": "patches/optional-peer-hoist-leaf@2.0.0.patch",
    "optional-peer-hoist-target@1.0.0": "patches/optional-peer-hoist-target@1.0.0.patch",
  };
  await Promise.all(Object.values(patchedDependencies).map(path => write(join(packageDir, path), noDepsPatch)));
  await installTwice(
    packageDir,
    packageJson,
    {
      name: "foo",
      dependencies: {
        "one-fixed-dep": "1.0.0",
        "optional-peer-hoist-deep-child": "1.0.0",
        "dwt": "npm:dep-with-tags@3.0.1",
      },
      patchedDependencies,
    },
    {
      name: "foo",
      dependencies: {
        "one-fixed-dep": ">=1.0.0",
        "ofd2": "npm:one-fixed-dep@2.0.0",
        "optional-peer-hoist-deep-child": ">=1.0.0",
        "dc2": "npm:optional-peer-hoist-deep-child@2.0.0",
        "dwt": "npm:dep-with-tags@3.0.1",
        "dep-with-tags": "latest",
      },
      patchedDependencies,
    },
  );
  await widen(packageDir, packageJson, "dwt", "npm:dep-with-tags@>=1.0.0");
  const lockfile = await lock(packageDir);
  for (const label of [
    '"one-fixed-dep@1.0.0"',
    '"one-fixed-dep@2.0.0"',
    '"optional-peer-hoist-deep-child@1.0.0"',
    '"optional-peer-hoist-deep-child@2.0.0"',
    '"optional-peer-hoist-target@1.0.0"',
    '"optional-peer-hoist-target@3.0.0"',
    '"optional-peer-hoist-leaf@2.0.0"',
    '"dep-with-tags@3.0.0"',
    '"dep-with-tags@3.0.1"',
  ]) {
    expect(lockfile).toContain(label);
  }
  const keptLines = [
    "  kept one-fixed-dep@1.0.0 (needed to reach patched no-deps@1.0.0)",
    "  kept optional-peer-hoist-deep-child@1.0.0 (needed to reach patched optional-peer-hoist-leaf@2.0.0, optional-peer-hoist-target@1.0.0)",
  ];

  const checked = lockPackageCount(lockfile);

  const check = await dedupe(packageDir, "--check");
  expectWouldRemove(check, "dep-with-tags 3.0.1 -> 3.0.0", checked, keptLines);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockfile);

  for (const [flag, reason] of REFUSALS) {
    const refused = await dedupe(packageDir, flag);
    expectRefusedToWrite(refused, "dep-with-tags 3.0.1 -> 3.0.0", checked, reason, keptLines);
    expect(await lock(packageDir)).toBe(lockfile);
  }

  const { stdout, stderr, exitCode } = await dedupe(packageDir);
  expectRemoved(stdout, "dep-with-tags 3.0.1 -> 3.0.0", { kept: keptLines, checked });
  expect(stderr).not.toContain("kept");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const after = await lock(packageDir);
  for (const label of [
    '"one-fixed-dep@1.0.0"',
    '"optional-peer-hoist-deep-child@1.0.0"',
    '"optional-peer-hoist-target@1.0.0"',
    '"optional-peer-hoist-leaf@2.0.0"',
    '"no-deps@1.0.0"',
  ]) {
    expect(after).toContain(label);
  }
  expect(after).not.toContain('"dep-with-tags@3.0.1"');
  expect(await nodeModulesVersion(packageDir, "dwt")).toBe("3.0.0");

  expect(lockPackageCount(after)).toBe(checked - 1);
  await expectAlreadyDeduplicated(packageDir, checked - 1, keptLines);
  expect(await lock(packageDir)).toBe(after);
  await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });
});

test.concurrent("--check combined with --frozen-lockfile still only reports", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const lockBefore = await setupRangeDuplicate(packageDir, packageJson);

  const check = await dedupe(packageDir, "--check", "--frozen-lockfile");
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(check.stderr).toBe("");
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
});

// peer-deps@1.0.0 is stored twice (once per no-deps it is peered with); dedupe only counts versions.
test.concurrent("isolated: --check ignores peer variants of one version", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { "provides-peer-deps-1-0-0": "1.0.0", "provides-peer-deps-2-0-0": "1.0.0" },
    }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);
  const lockBefore = await lock(packageDir);
  const store = await readdirSorted(join(packageDir, "node_modules", ".bun"));
  expect(store.filter(entry => entry.startsWith("peer-deps@1.0.0"))).toHaveLength(2);

  expect(lockPackageCount(lockBefore)).toBe(6);
  for (const args of [["--check"], []]) {
    const result = await dedupe(packageDir, ...args, "--linker", "isolated");
    expectNoDuplicates(result, 6);
    expect(result.stderr).toBe("");
    expect(await lock(packageDir)).toBe(lockBefore);
    expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toStrictEqual(store);
  }
});

test.concurrent("isolated: --check reports duplicates without touching the store", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  const install = () => run(packageDir, "install", "--linker", "isolated");
  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  expect((await install()).exitCode).toBe(0);
  await write(
    packageJson,
    JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } }),
  );
  expect((await install()).exitCode).toBe(0);
  const lockBefore = await lock(packageDir);
  const store = await readdirSorted(join(packageDir, "node_modules", ".bun"));
  expect(store).toContain("no-deps@1.0.0");
  expect(store).toContain("no-deps@1.1.0");

  const check = await dedupe(packageDir, "--check", "--linker", "isolated");
  expectWouldRemove(check, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(check.exitCode).toBe(1);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toStrictEqual(store);

  const dryRun = await dedupe(packageDir, "--dry-run", "--linker", "isolated");
  expectWouldRemove(dryRun, "no-deps 1.1.0 -> 1.0.0", 4);
  expect(dryRun.exitCode).toBe(0);
  expect(await lock(packageDir)).toBe(lockBefore);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toStrictEqual(store);

  for (const [flag, reason] of REFUSALS) {
    const refused = await dedupe(packageDir, flag, "--linker", "isolated");
    expectRefusedToWrite(refused, "no-deps 1.1.0 -> 1.0.0", 4, reason);
    expect(await lock(packageDir)).toBe(lockBefore);
  }
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toStrictEqual(store);
});
