import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Registry: no-deps 1.0.0/1.0.1/1.1.0/2.0.0, a-dep 1.0.1..1.0.10, @types/no-deps 1.0.0/2.0.0, one-range-dep@1.0.0 -> no-deps ^1.0.0, one-fixed-dep@1.0.0 -> no-deps 1.0.0, dep-with-tags latest=3.0.0, pre-2=2.0.1, 3.0.1 published above latest.

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Json = Record<string, any>;
type Linker = "hoisted" | "isolated";
type Layout = { text?: boolean; linker?: Linker };

const pkgJson = (dependencies: Json, extra: Json = {}) => ({ name: "foo", dependencies, ...extra });
const stringify = (json: Json) => JSON.stringify(json, null, 2) + "\n";

const linkerArgs = (layout: Layout) => ["--linker", layout.linker ?? "hoisted"];

async function runIn(dir: string, rel: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: join(dir, rel),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const run = (dir: string, ...args: string[]) => runIn(dir, "", ...args);

async function install(dir: string, ...args: string[]) {
  const { stderr, exitCode } = await run(dir, "install", ...args);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return stderr;
}

const frozen = (dir: string, layout: Layout = {}) => install(dir, "--frozen-lockfile", ...linkerArgs(layout));

const bunfigOpts = (layout: Layout) => ({ saveTextLockfile: layout.text ?? true, linker: layout.linker ?? "hoisted" });

// Most tests start from one of a few dozen installed trees, and each install is another `bun` process under ASAN. A tree
// is installed once, by the first test that asks for it, and is never written to again: every test gets its own copy of
// it from createTestDir (cache included, with a bunfig.toml naming the copy's own cache), exactly as if it had run the
// installs itself.
const templates = new Map<string, Promise<string>>();

async function copyOf(key: unknown[], layout: Layout, build: () => Promise<string>) {
  const id = JSON.stringify([...key, bunfigOpts(layout)]);
  let template = templates.get(id);
  if (!template) templates.set(id, (template = build()));
  const { packageDir } = await registry.createTestDir({ bunfigOpts: bunfigOpts(layout), files: await template });
  return packageDir;
}

// A copy of `files` installed with `layout`.
function setup(files: Record<string, Json | string>, layout: Layout = {}) {
  return copyOf(["setup", files], layout, async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: bunfigOpts(layout),
      files: Object.fromEntries(
        Object.entries(files).map(([path, json]) => [path, typeof json === "string" ? json : stringify(json)]),
      ),
    });
    await install(packageDir, ...linkerArgs(layout));
    return packageDir;
  });
}

async function reinstall(dir: string, packageJson: Json, layout: Layout = {}, rel = "") {
  await write(join(dir, rel, "package.json"), stringify(packageJson));
  expect(await install(dir, ...linkerArgs(layout))).toContain("Saved lockfile");
}

const packageJsonOf = (dir: string, rel = ""): Promise<Json> => file(join(dir, rel, "package.json")).json();
const packageJsonText = (dir: string, rel = "") => file(join(dir, rel, "package.json")).text();
const lockText = (dir: string) => file(join(dir, "bun.lock")).text();
const lock = async (dir: string): Promise<Json> => Bun.JSONC.parse(await lockText(dir)) as Json;

// Every moved package, transitive, named or bare, is one `^ name old -> new` row (piped form) in the summary block, whether it was installed, planned (--dry-run) or only saved (--lockfile-only); a row carries ` (vX available)` when a newer version is out of range.
const movedRows = (stdout: string) =>
  (stdout.match(/^\^ .+$/gm) ?? []).map(row => row.replace(/ \(v\S+ available\)$/, ""));
const movedRow = (name: string, from: string, to: string, available?: string) =>
  `^ ${name} ${from} -> ${to}${available ? ` (v${available} available)` : ""}`;

const NO_DEPS_ROW = movedRow("no-deps", "1.0.0", "1.1.0");
const NO_DEPS_ROW_HINTED = movedRow("no-deps", "1.0.0", "1.1.0", "2.0.0");
const A_DEP_ROW = movedRow("a-dep", "1.0.1", "1.0.10");

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const installed = (n: number) => `${plural(n, "package")} installed [duration]`;
const wouldUpdate = (n: number) => `${plural(n, "package")} would be updated [duration]`;
const noChanges = (installs: number, packages: number) =>
  `Checked ${plural(installs, "install")} across ${plural(packages, "package")} (no changes) [duration]`;
const nothingToUpdate = (packages: number) => `Checked ${plural(packages, "package")}, nothing to update [duration]`;
const noneSelected = (dependencies: number, by: string) =>
  `Checked ${dependencies} ${dependencies === 1 ? "dependency" : "dependencies"}, none ${by} (no changes) [duration]`;
const keptPatched = (name: string, version: string, available: string) =>
  `kept ${name}@${version} (patched, v${available} available)`;

// The header's version and the `[12.00ms]` durations are the only unstable parts of update's stdout.
const normalize = (stdout: string) =>
  stdout.replace(/^bun update v.*$/m, "bun update <version>").replace(/\[[\d.]+m?s\]/g, "[duration]");
const summary = (...lines: string[]) => ["bun update <version>", "", ...lines, ""].join("\n");

function expectSummary(stdout: string, ...lines: string[]) {
  expect(normalize(stdout)).toBe(summary(...lines));
}

// Several rows in one real run: the rows are asserted as a list and the count line by itself.
function expectRowsAnd(stdout: string, rows: string[], countLine: string) {
  expect(movedRows(stdout)).toStrictEqual(rows);
  expectCountLine(stdout, countLine);
}

// A real run prints the transitive rows in package id order, which is the order the packages were resolved in, so two
// packages that were both new to bun.lock are asserted as a set. (--dry-run sorts its plan.)
function expectRowSetAnd(stdout: string, rows: string[], countLine: string) {
  expect(movedRows(stdout).sort()).toStrictEqual([...rows].sort());
  expectCountLine(stdout, countLine);
}

function expectCountLine(stdout: string, countLine: string) {
  expect(normalize(stdout)).toEndWith(`\n\n${countLine}\n`);
  expect(stdout).not.toMatch(/^installed /m);
}

function expectMoved(stdout: string, name: string, from: string, to: string) {
  expect(movedRows(stdout)).toContain(movedRow(name, from, to));
  expect(stdout).not.toMatch(/^installed /m);
}

function expectNoMoves(stdout: string) {
  expect(movedRows(stdout)).toStrictEqual([]);
  expect(stdout).not.toMatch(/^installed /m);
}

// A no-op prints what it checked and how long it took, and nothing else.
function expectNoChangesLine(stdout: string) {
  expectNoMoves(stdout);
  expect(normalize(stdout)).toMatch(/^Checked \d+ installs? across \d+ packages? \(no changes\) \[duration\]$/m);
  expect(stdout).not.toContain(" done");
}

function expectDryRun(stdout: string, ...rows: string[]) {
  expectSummary(stdout, ...rows, "", wouldUpdate(rows.length));
}

// A command that fails before it has anything to report prints nothing but its header: no rows, no table, no count line.
const expectHeaderOnly = (stdout: string, command: string) =>
  expect(stdout).toMatch(new RegExp(`^bun ${command} v[^\\n]*\\n$`));

const NOT_IN_LOCKFILE = (name: string, lockfile = "bun.lock") =>
  `error: "${name}" is not in ${lockfile}\n    bun add ${name}\n`;
// `scope` is "the selected workspaces" once -r/--filter picked the scope, "this workspace" when the cwd did; one --filter hint per other workspace that reaches the name.
const notADependencyOf = (scope: string, name: string, ...workspaces: string[]) =>
  [
    `error: "${name}" is not a dependency of ${scope}`,
    `    bun update -r ${name}`,
    ...workspaces.map(workspace => `    bun update --filter ${workspace} ${name}`),
    "",
  ].join("\n");
const NOT_A_DEPENDENCY_HERE = (name: string, ...workspaces: string[]) =>
  notADependencyOf("this workspace", name, ...workspaces);
const NOT_A_DEPENDENCY_OF_SELECTION = (name: string, ...workspaces: string[]) =>
  notADependencyOf("the selected workspaces", name, ...workspaces);
const notCheckedWarning = (server: Bun.Server, name: string, version: string, status: number) =>
  `warn: ${name}@${version} was not checked for updates: GET ${server.url.origin}/${name} - ${status}\n`;

// The manifest-cache progress bar must never leak its `Resolving... ` fragment into a piped stderr.
function expectCleanStderr(stderr: string) {
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("Resolving...");
  expect(stderr).not.toContain("warn:");
}

// Every version of `name` resolved anywhere in bun.lock, rows installed under an alias included.
async function lockedVersions(dir: string, name: string) {
  const { packages } = await lock(dir);
  const versions = Object.values(packages as Record<string, [string]>)
    .map(([resolution]) => resolution)
    .filter(resolution => resolution.startsWith(`${name}@`))
    .map(resolution => resolution.slice(name.length + 1));
  return [...new Set(versions)].sort();
}

// The version of `name` each dependent's edge resolves to in bun.lock: its nested row when it lost the hoisting race, else the hoisted one.
async function resolvedEdges(dir: string, name: string, ...dependents: string[]) {
  const { packages } = await lock(dir);
  const versionOf = (key: string) => (packages[key] as [string] | undefined)?.[0].slice(name.length + 1);
  return Object.fromEntries(
    dependents.map(dependent => [dependent, versionOf(`${dependent}/${name}`) ?? versionOf(name)]),
  );
}

async function installedVersion(dir: string, ...segments: string[]) {
  return (await file(join(dir, "node_modules", ...segments, "package.json")).json()).version;
}

const noDepsPath = (linker: Linker = "hoisted") =>
  linker === "isolated" ? [".bun", "one-range-dep@1.0.0", "node_modules", "no-deps"] : ["no-deps"];

// Dropping the root's exact no-deps@1.0.0 leaves one-range-dep's `^1.0.0` edge on 1.0.0, which `bun install` never moves.
async function stale(layout: Layout = {}) {
  const packageJson = pkgJson({ "one-range-dep": "1.0.0" });
  const noDeps = noDepsPath(layout.linker);
  const dir = await copyOf(["stale"], layout, async () => {
    const dir = await setup({ "package.json": pkgJson({ "one-range-dep": "1.0.0", "no-deps": "1.0.0" }) }, layout);
    await reinstall(dir, packageJson, layout);
    if (layout.text ?? true) {
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    }
    expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
    return dir;
  });
  return { dir, packageJson, noDeps };
}

async function expectTransitiveBump(
  { dir, packageJson, noDeps }: Awaited<ReturnType<typeof stale>>,
  layout: Layout,
  ...args: string[]
) {
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args, ...linkerArgs(layout));
  expectCleanStderr(stderr);
  expect(stderr).toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  if (layout.text ?? true) {
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "one-range-dep")).toStrictEqual(["1.0.0"]);
  }
  await frozen(dir, layout);
  expect(exitCode).toBe(0);
  return stdout;
}

type Groups = Record<string, "dependencies" | "devDependencies" | "optionalDependencies">;

function grouped(versions: Json, groups: Groups) {
  const json: Json = { name: "foo" };
  for (const [name, version] of Object.entries(versions)) (json[groups[name] ?? "dependencies"] ??= {})[name] = version;
  return json;
}

// Exact pins widened to ranges after the install: both entries stay locked below the newest version their range allows.
async function staleSiblings(groups: Groups = {}) {
  const packageJson = grouped({ "no-deps": "^1.0.0", "a-dep": "^1.0.1" }, groups);
  const dir = await copyOf(["staleSiblings", groups], {}, async () => {
    const dir = await setup({ "package.json": grouped({ "no-deps": "1.0.0", "a-dep": "1.0.1" }, groups) });
    await reinstall(dir, packageJson);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
    return dir;
  });
  return { dir, packageJson, groups };
}

// The named path prints the same rows as a bare update: the entry that moved gets a `^` row, the one that did not prints nothing and is not counted.
async function expectOnlyADepMoved({ dir, groups }: Awaited<ReturnType<typeof staleSiblings>>, ...args: string[]) {
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectSummary(stdout, A_DEP_ROW, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(grouped({ "no-deps": "^1.0.0", "a-dep": "^1.0.10" }, groups));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
}

async function expectRejected(dir: string, message: string, ...args: string[]) {
  const packageJsonBefore = await packageJsonText(dir);
  const lockBefore = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectHeaderOnly(stdout, "update");
  expect(stderr).toContain(message);
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
  expect(await lockText(dir)).toBe(lockBefore);
  expect(exitCode).toBe(1);
}

async function expectNothingToUpdate(dir: string, line: string, ...args: string[]) {
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectSummary(stdout, line);
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
}

const ROOT = { name: "root", workspaces: ["packages/*"] };
const member = (name: string, dependencies: Json = {}) => ({ name, version: "1.0.0", dependencies });

test.concurrent.each<[string, Layout]>([
  ["text lockfile", { text: true }],
  ["binary lockfile", { text: false }],
])("`bun update` moves a transitive dependency within its dependent's range (%s)", async (_, layout) => {
  const fixture = await stale(layout);
  const stdout = await expectTransitiveBump(fixture, layout);
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
});

// The isolated linker re-links one-range-dep's store entry onto the moved no-deps, and a re-linked entry counts as installed like a fresh one.
test.concurrent(
  "`bun update` moves a transitive dependency within its dependent's range (isolated linker)",
  async () => {
    const layout: Layout = { text: true, linker: "isolated" };
    const fixture = await stale(layout);
    const stdout = await expectTransitiveBump(fixture, layout);
    expectSummary(stdout, NO_DEPS_ROW_HINTED, "", "+ one-range-dep@1.0.0", "", installed(2));
  },
);

test.concurrent("`bun update --latest` still moves transitive dependencies only within their ranges", async () => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, "--latest");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
});

// The move is reported the same way whether the name was given or found, and naming it again is the same no-op as a bare rerun.
test.concurrent.each([
  ["no-deps", ["no-deps"]],
  ["--latest no-deps", ["--latest", "no-deps"]],
])("`bun update %s` reaches a package that is only a transitive dependency", async (_, args) => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, ...args);
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));

  const again = await run(fixture.dir, "update", ...args);
  expectSummary(again.stdout, noChanges(2, 3));
  expectCleanStderr(again.stderr);
  expect(again.stderr).not.toContain("Saved lockfile");
  expect(again.exitCode).toBe(0);
});

// one-range-dep is named too but has nothing newer: no row, and it is not counted.
test.concurrent.each([
  ["a pattern", ["no-*"]],
  ["a bare `*`", ["*"]],
  ["a negated name", ["!one-range-dep"]],
  ["a pattern alongside a direct name", ["no-d*", "one-range-dep"]],
])("`bun update` with %s reaches a package that is only a transitive dependency", async (_, args) => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, ...args);
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
});

test.concurrent(
  "`bun update <name>` naming a package with nothing newer is the same no-op as a bare rerun",
  async () => {
    const { dir, packageJson } = await stale();
    const before = await lock(dir);
    const { stdout, stderr, exitCode } = await run(dir, "update", "one-range-dep");
    expectSummary(stdout, noChanges(2, 3));
    expectCleanStderr(stderr);
    expect(stderr).not.toContain("Saved lockfile");
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect(await lock(dir)).toStrictEqual(before);
    expect(exitCode).toBe(0);
  },
);

// Both errors name the lockfile that was actually loaded; the remedy is a bare command line, not a note.
test.concurrent.each<[string, Layout]>([
  ["bun.lock", { text: true }],
  ["bun.lockb", { text: false }],
])("`bun update <name>` and a pattern that match nothing in %s name that file", async (lockfile, layout) => {
  const { dir, packageJson } = await stale(layout);
  const before = await file(join(dir, lockfile)).bytes();
  const named = await run(dir, "update", "does-not-exist", ...linkerArgs(layout));
  expect(named.stderr).toContain(NOT_IN_LOCKFILE("does-not-exist", lockfile));
  expect(named.stderr).not.toContain("note:");
  expect(named.stderr).not.toContain("nothing to update");
  expectHeaderOnly(named.stdout, "update");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await file(join(dir, lockfile)).bytes()).toStrictEqual(before);
  expect(named.exitCode).toBe(1);

  const pattern = await run(dir, "update", "zzz-*", ...linkerArgs(layout));
  expectHeaderOnly(pattern.stdout, "update");
  expect(pattern.stderr).toContain(`error: no packages in ${lockfile} match "zzz-*"\n`);
  expect(pattern.stderr).not.toContain("note:");
  expect(await file(join(dir, lockfile)).bytes()).toStrictEqual(before);
  expect(pattern.exitCode).toBe(1);
});

async function withoutLockfile(dependencies: Json) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
    files: { "package.json": stringify(pkgJson(dependencies)) },
  });
  return packageDir;
}

test.concurrent("without a lockfile, `bun update <declared>` resolves and saves", async () => {
  const dir = await withoutLockfile({ "no-deps": "^1.0.0" });
  const { stdout, stderr, exitCode } = await run(dir, "update", "no-deps");
  expectSummary(stdout, "+ no-deps@1.1.0 (v2.0.0 available)", "", installed(1));
  expectCleanStderr(stderr);
  expect(stderr).toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "^1.1.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("without a lockfile, `bun update <undeclared>` is rejected and writes no lockfile", async () => {
  const dir = await withoutLockfile({ "no-deps": "^1.0.0" });
  const { stdout, stderr, exitCode } = await run(dir, "update", "a-dep");
  expectHeaderOnly(stdout, "update");
  expect(stderr).toContain(NOT_IN_LOCKFILE("a-dep"));
  expect(stderr).not.toContain("note:");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "^1.0.0" }));
  expect(await file(join(dir, "bun.lock")).exists()).toBeFalse();
  expect(exitCode).toBe(1);
});

test.concurrent("`bun update --lockfile-only` moves the transitive dependency in bun.lock only", async () => {
  const { dir, packageJson, noDeps } = await stale();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--lockfile-only");
  expect(movedRows(stdout)).toStrictEqual([NO_DEPS_ROW]);
  expect(stdout).not.toContain("would be updated");
  expect(stdout).toContain("Saved bun.lock (");
  expectCleanStderr(stderr);
  expect(stderr).toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
  await frozen(dir);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --frozen-lockfile` refuses to move the transitive dependency", async () => {
  const { dir, noDeps } = await stale();
  const packageJsonBefore = await packageJsonText(dir);
  const lockBefore = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--frozen-lockfile");
  expectHeaderOnly(stdout, "update");
  expect(stderr).toContain("error: lockfile had changes, but lockfile is frozen");
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
  expect(await lockText(dir)).toBe(lockBefore);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
  expect(exitCode).toBe(1);
});

// peer-deps-fixed's peer edge is skipped by the plan and only follows the root's moved no-deps; a-dep is inserted ahead of no-deps between the install and the update, so the root's rows no longer line up with the ones bun.lock recorded.
test.concurrent("a moved direct dependency is still followed after its row index shifted", async () => {
  const dir = await setup({ "package.json": pkgJson({ "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  await write(
    join(dir, "package.json"),
    stringify(pkgJson({ "a-dep": "1.0.1", "no-deps": "^1.0.0", "peer-deps-fixed": "1.0.0" })),
  );
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", "+ a-dep@1.0.1 (v1.0.10 available)", "", installed(2));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(
    pkgJson({ "a-dep": "1.0.1", "no-deps": "^1.1.0", "peer-deps-fixed": "1.0.0" }),
  );
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  expect((await lock(dir)).packages["peer-deps-fixed/no-deps"]).toBeUndefined();
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  expect(await installedVersion(dir, "a-dep")).toBe("1.0.1");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

// The plan is the same block a real run prints, with a "would be updated" count line in place of "installed"; nothing is installed and no lockfile dump follows.
test.concurrent.each([
  ["bare", []],
  ["--latest", ["--latest"]],
  ["no-deps", ["no-deps"]],
  ["a pattern", ["no-*"]],
])("`bun update --dry-run` (%s) prints the plan as summary rows and writes nothing", async (_, args) => {
  const { dir, packageJson, noDeps } = await stale();
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run", ...args);
  expectDryRun(stdout, NO_DEPS_ROW_HINTED);
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
  expect(exitCode).toBe(0);
});

// Packages counted: the root, one-range-dep and no-deps.
test.concurrent.each([
  ["bare", []],
  ["one-range-dep", ["one-range-dep"]],
  ["--prod", ["--prod"]],
])("`bun update --dry-run` (%s) says so when nothing would move", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "one-range-dep": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run", ...args);
  expectSummary(stdout, nothingToUpdate(3));
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "`bun update --dry-run` lists and counts direct dependencies together with the transitive plan",
  async () => {
    const dir = await setup({
      "package.json": pkgJson({ "a-dep": "1.0.1", "one-range-dep": "1.0.0", "no-deps": "1.0.0" }),
    });
    const packageJson = pkgJson({ "a-dep": "^1.0.1", "one-range-dep": "1.0.0" });
    await reinstall(dir, packageJson);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    const before = await lockText(dir);
    const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run");
    expectDryRun(stdout, A_DEP_ROW, NO_DEPS_ROW_HINTED);
    expectCleanStderr(stderr);
    expect(stderr).not.toContain("Saved lockfile");
    expect(await lockText(dir)).toBe(before);
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.1");
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("a direct dependency's declared range is left alone when only its dependency moves", async () => {
  const { dir, packageJson } = await stale();
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(packageJson.dependencies);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("a transitive dependency pinned exactly by its dependent stays put", async () => {
  const dir = await setup({ "package.json": pkgJson({ "one-fixed-dep": "1.0.0" }) });
  const before = await lock(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, noChanges(2, 3));
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lock(dir)).toStrictEqual(before);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

// The root's no-deps@1.0.0 dedupes both dependents onto 1.0.0 before it is dropped; the update forks only the `^1.0.0` edge.
test.concurrent("dependents with different ranges are resolved independently", async () => {
  const dependents = { "one-fixed-dep": "1.0.0", "one-range-dep": "1.0.0" };
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "1.0.0", ...dependents }) });
  const packageJson = pkgJson(dependents);
  await reinstall(dir, packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "1.1.0"]);
  const { packages } = await lock(dir);
  expect([packages["no-deps"][0], packages["one-range-dep/no-deps"][0]]).toStrictEqual([
    "no-deps@1.0.0",
    "no-deps@1.1.0",
  ]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

// The root's exact 1.0.0 takes the root slot and pushes one-range-dep's 1.1.0 into a nested folder; widening the root keeps 1.0.0 locked, so the update collapses both rows onto 1.1.0.
test.concurrent("hoisted: a bare update removes the nested copy whose row it collapsed", async () => {
  const dir = await setup({ "package.json": pkgJson({ "one-range-dep": "1.0.0" }) });
  await reinstall(dir, pkgJson({ "one-range-dep": "1.0.0", "no-deps": "1.0.0" }));
  await reinstall(dir, pkgJson({ "one-range-dep": "1.0.0", "no-deps": "^1.0.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "1.1.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
  expect(await installedVersion(dir, "one-range-dep", "node_modules", "no-deps")).toBe("1.1.0");
  const nested = join(dir, "node_modules", "one-range-dep", "node_modules", "no-deps");
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(movedRows(stdout)).toStrictEqual([NO_DEPS_ROW]);
  expect(stdout).not.toContain("+ no-deps@");
  expectCleanStderr(stderr);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(Object.keys((await lock(dir)).packages).sort()).toStrictEqual(["no-deps", "one-range-dep"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  expect(await exists(nested)).toBeFalse();
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("an override holds a transitive dependency back", async () => {
  const { dir } = await stale();
  const packageJson = pkgJson({ "one-range-dep": "1.0.0" }, { overrides: { "no-deps": "1.0.0" } });
  await reinstall(dir, packageJson);
  const before = await lock(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, noChanges(2, 3));
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lock(dir)).toStrictEqual(before);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

const NO_DEPS_PATCH = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

const PATCHED = { patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" } };

// `pinned` is installed with no-deps@1.0.0 patched, then re-installed as `widened`, which keeps the patched 1.0.0 locked.
async function stalePatched(pinned: Json, widened: Json) {
  const packageJson = pkgJson(widened, PATCHED);
  const dir = await copyOf(["stalePatched", pinned, widened], {}, async () => {
    const dir = await setup({ "package.json": pkgJson(pinned, PATCHED), "patches/no-deps@1.0.0.patch": NO_DEPS_PATCH });
    await reinstall(dir, packageJson);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await file(join(dir, "node_modules", "no-deps", "patched.txt")).exists()).toBeTrue();
    return dir;
  });
  return { dir, packageJson, patched: file(join(dir, "node_modules", "no-deps", "patched.txt")) };
}

// The `stale()` recipe with the transitive no-deps@1.0.0 patched.
const stalePatchedTransitive = () =>
  stalePatched({ "one-range-dep": "1.0.0", "no-deps": "1.0.0" }, { "one-range-dep": "1.0.0" });
const stalePatchedDirect = () => stalePatched({ "no-deps": "1.0.0" }, { "no-deps": "^1.0.0" });

// The kept row sits in the summary block and names the version the patch is holding back; nothing is saved or installed.
async function expectKeptPatched(
  { dir, packageJson, patched }: Awaited<ReturnType<typeof stalePatched>>,
  countLine: string,
  ...args: string[]
) {
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectSummary(stdout, keptPatched("no-deps", "1.0.0", "1.1.0"), "", countLine);
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockText(dir)).toBe(before);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
  expect(await patched.exists()).toBeTrue();
  await frozen(dir);
  expect(exitCode).toBe(0);
}

test.concurrent.each<[string, string[], string]>([
  ["bare", [], noChanges(2, 3)],
  ["no-deps", ["no-deps"], noChanges(2, 3)],
  ["bare --dry-run", ["--dry-run"], nothingToUpdate(3)],
])("a patched transitive dependency is left alone (%s)", async (_, args, countLine) => {
  await expectKeptPatched(await stalePatchedTransitive(), countLine, ...args);
});

test.concurrent.each<[string, string[], string]>([
  ["bare", [], noChanges(1, 2)],
  ["no-deps", ["no-deps"], noChanges(1, 2)],
  ["bare --dry-run", ["--dry-run"], nothingToUpdate(2)],
  ["no-deps --dry-run", ["no-deps", "--dry-run"], nothingToUpdate(2)],
])("a patched dependency declared in package.json is held within its range (%s)", async (_, args, countLine) => {
  await expectKeptPatched(await stalePatchedDirect(), countLine, ...args);
});

// --latest moves past the patch on purpose; the orphaned patchedDependencies entry is pointed out on stderr.
test.concurrent(
  "`bun update <name> --latest` moves a patched dependency and warns that its patch no longer applies",
  async () => {
    const { dir } = await stalePatchedDirect();
    const { stdout, stderr, exitCode } = await run(dir, "update", "no-deps", "--latest");
    expectSummary(stdout, movedRow("no-deps", "1.0.0", "2.0.0"), "", installed(1));
    expect(stderr).toContain("warn: patches/no-deps@1.0.0.patch no longer applies (no-deps is now 2.0.0)\n");
    expect(stderr).not.toContain("error:");
    expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "^2.0.0" }, PATCHED));
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
    expect(await file(join(dir, "node_modules", "no-deps", "patched.txt")).exists()).toBeFalse();
    expect(exitCode).toBe(0);
  },
);

// bun.lock still records the `no-deps: 1.0.0` override; package.json is edited without an install in between, so the update sees the new overrides first.
async function overriddenThenEdited(overrides?: Json) {
  const dependencies = { "one-range-dep": "1.0.0" };
  const dir = await setup({ "package.json": pkgJson(dependencies, { overrides: { "no-deps": "1.0.0" } }) });
  expect((await lock(dir)).overrides).toStrictEqual({ "no-deps": "1.0.0" });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  const packageJson = pkgJson(dependencies, overrides ? { overrides } : {});
  await write(join(dir, "package.json"), stringify(packageJson));
  return { dir, packageJson };
}

test.concurrent.each<[string, Json | undefined, string]>([
  ["removed", undefined, "1.1.0"],
  ["widened", { "no-deps": "~1.0.0" }, "1.0.1"],
])(
  "`bun update` re-resolves a transitive dependency whose override was %s since bun.lock was written",
  async (_, overrides, to) => {
    const { dir, packageJson } = await overriddenThenEdited(overrides);
    const { stdout, stderr, exitCode } = await run(dir, "update");
    expectRowsAnd(stdout, [movedRow("no-deps", "1.0.0", to)], installed(1));
    expect(stdout).not.toContain("+ no-deps@");
    expectCleanStderr(stderr);
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect((await lock(dir)).overrides).toStrictEqual(overrides);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual([to]);
    expect(await installedVersion(dir, "no-deps")).toBe(to);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "the summary reports the target an override added since bun.lock was written actually allows",
  async () => {
    const { dir } = await stale();
    const packageJson = pkgJson({ "one-range-dep": "1.0.0" }, { overrides: { "no-deps": "1.0.1" } });
    await write(join(dir, "package.json"), stringify(packageJson));
    const { stdout, stderr, exitCode } = await run(dir, "update");
    expectRowsAnd(stdout, [movedRow("no-deps", "1.0.0", "1.0.1")], installed(1));
    expectCleanStderr(stderr);
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect((await lock(dir)).overrides).toStrictEqual({ "no-deps": "1.0.1" });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("a lockfile that already resolves the newest allowed versions is left alone", async () => {
  const dir = await setup({ "package.json": pkgJson({ "one-range-dep": "1.0.0" }) });
  const before = await lock(dir);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, noChanges(2, 3));
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lock(dir)).toStrictEqual(before);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --latest` run twice is a no-op that does not claim to have saved bun.lock", async () => {
  const { dir } = await stale();
  const first = await run(dir, "update", "--latest");
  expectSummary(first.stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expect(first.stderr).toContain("Saved lockfile");
  expect(first.exitCode).toBe(0);
  const before = await lockText(dir);
  const second = await run(dir, "update", "--latest");
  expectSummary(second.stdout, noChanges(2, 3));
  expectCleanStderr(second.stderr);
  expect(second.stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(second.exitCode).toBe(0);
});

test.concurrent("without a lockfile `bun update` resolves everything fresh", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
    files: { "package.json": stringify(pkgJson({ "one-range-dep": "1.0.0" })) },
  });
  const { stdout, stderr, exitCode } = await run(packageDir, "update");
  expectNoMoves(stdout);
  expect(stderr).not.toContain("error:");
  expect(stderr).toContain("Saved lockfile");
  expect(await lockedVersions(packageDir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

// The `stale()` recipe applied inside pkg1; pkg2, when present, pins no-deps@1.0.0 too and is widened to `pkg2Range`.
async function staleMemberTransitive(pkg2Range?: string) {
  const pkg1 = member("pkg1", { "one-range-dep": "1.0.0" });
  const dir = await copyOf(["staleMemberTransitive", pkg2Range], {}, async () => {
    const dir = await setup({
      "package.json": ROOT,
      "packages/pkg1/package.json": member("pkg1", { "one-range-dep": "1.0.0", "no-deps": "1.0.0" }),
      ...(pkg2Range ? { "packages/pkg2/package.json": member("pkg2", { "no-deps": "1.0.0" }) } : {}),
    });
    if (pkg2Range) {
      await write(join(dir, "packages/pkg2/package.json"), stringify(member("pkg2", { "no-deps": pkg2Range })));
    }
    await reinstall(dir, pkg1, {}, "packages/pkg1");
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    return dir;
  });
  return { dir, pkg1 };
}

test.concurrent("in a workspace, `bun update` from the root moves a member's transitive dependency", async () => {
  const { dir, pkg1 } = await staleMemberTransitive();
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(ROOT);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(pkg1);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["the root", ""],
  ["the member", "packages/pkg1"],
])("`bun update <name>` run from %s still moves a member's transitive dependency", async (_, cwd) => {
  const { dir, pkg1 } = await staleMemberTransitive();
  const { stdout, stderr, exitCode } = await runIn(dir, cwd, "update", "no-deps");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(ROOT);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(pkg1);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

const MEMBER_FILES = ["", "packages/pkg1", "packages/pkg2"];

// The root's exact no-deps pin parks every member's transitive `^1.0.0` edge on 1.0.0; dropping it (and widening pkg1 to `pkg1After`) leaves everything where it was locked.
async function staleMemberEdges(pkg1: Json, pkg2: Json, pkg1After: Json = pkg1) {
  const dir = await copyOf(["staleMemberEdges", pkg1, pkg2, pkg1After], {}, async () => {
    const dir = await setup({
      "package.json": { ...ROOT, dependencies: { "no-deps": "1.0.0" } },
      "packages/pkg1/package.json": member("pkg1", pkg1),
      "packages/pkg2/package.json": member("pkg2", pkg2),
    });
    await write(join(dir, "packages/pkg1/package.json"), stringify(member("pkg1", pkg1After)));
    await reinstall(dir, ROOT);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    return dir;
  });
  const texts = () => Promise.all(MEMBER_FILES.map(rel => packageJsonText(dir, rel)));
  return { dir, texts, textsBefore: await texts(), lockBefore: await lockText(dir) };
}

// one-range-dep and one-range-dep-too both depend on no-deps ^1.0.0; pkg1 reaches no-deps only through the former, pkg2 only through the latter.
const distinctEdges = () => staleMemberEdges({ "one-range-dep": "1.0.0" }, { "one-range-dep-too": "1.0.0" });

// Only pkg1 is planned from pkg1, but once its no-deps moves, pkg2's compatible edge is re-pointed too so bun.lock keeps one copy.
test.concurrent.each([
  ["from packages/pkg1", "packages/pkg1", []],
  ["with --filter pkg1", "", ["--filter", "pkg1"]],
  ["from the root", "", []],
  ["with -r", "", ["-r"]],
])(
  "in a workspace, a bare `bun update` %s re-points every compatible edge onto the one moved no-deps copy",
  async (_, cwd, args) => {
    const { dir, texts, textsBefore } = await distinctEdges();
    const { stdout, stderr, exitCode } = await runIn(dir, cwd, "update", ...args);
    expectRowsAnd(stdout, [NO_DEPS_ROW], installed(1));
    expectCleanStderr(stderr);
    expect(await resolvedEdges(dir, "no-deps", "one-range-dep", "one-range-dep-too")).toStrictEqual({
      "one-range-dep": "1.1.0",
      "one-range-dep-too": "1.1.0",
    });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await texts()).toStrictEqual(textsBefore);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

// pkg1's a-dep is parked on 1.0.1 by the widening; no-deps is reachable only through pkg2, so nothing pkg1 moves can drag it along.
const disjointEdges = () =>
  staleMemberEdges({ "a-dep": "1.0.1" }, { "one-range-dep-too": "1.0.0" }, { "a-dep": "^1.0.1" });

const PKG1_A_DEP_MOVED = stringify(member("pkg1", { "a-dep": "^1.0.10" }));

test.concurrent.each([
  ["from packages/pkg1", "packages/pkg1", []],
  ["with --filter pkg1", "", ["--filter", "pkg1"]],
])(
  "in a workspace, a bare `bun update` %s leaves alone the stale rows only another workspace reaches",
  async (_, cwd, args) => {
    const { dir, texts, textsBefore } = await disjointEdges();
    const [rootBefore, , pkg2Before] = textsBefore;
    const { stdout, stderr, exitCode } = await runIn(dir, cwd, "update", ...args);
    expectRowsAnd(stdout, [A_DEP_ROW], installed(1));
    expectCleanStderr(stderr);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await texts()).toStrictEqual([rootBefore, PKG1_A_DEP_MOVED, pkg2Before]);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

// Every workspace's transitive rows are planned from the root; a member's own entries only move with -r, and then they get rows like everything else.
test.concurrent.each<[string, string[], boolean]>([
  ["from the root", [], false],
  ["with -r", ["-r"], true],
])(
  "in a workspace, a bare `bun update` %s moves the transitive rows only a member reaches",
  async (_, args, movesMemberEntries) => {
    const { dir, texts, textsBefore } = await disjointEdges();
    const [rootBefore, pkg1Before, pkg2Before] = textsBefore;
    const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
    if (movesMemberEntries) {
      expectRowsAnd(stdout, [A_DEP_ROW, NO_DEPS_ROW], installed(2));
    } else {
      expectRowsAnd(stdout, [NO_DEPS_ROW], installed(1));
    }
    expectCleanStderr(stderr);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual([movesMemberEntries ? "1.0.10" : "1.0.1"]);
    expect(await texts()).toStrictEqual([rootBefore, movesMemberEntries ? PKG1_A_DEP_MOVED : pkg1Before, pkg2Before]);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.each<[string, string, string[], string]>([
  ["from packages/pkg1", "packages/pkg1", [], NOT_A_DEPENDENCY_HERE("no-deps", "pkg2")],
  ["with --filter pkg1", "", ["--filter", "pkg1"], NOT_A_DEPENDENCY_OF_SELECTION("no-deps", "pkg2")],
])(
  "in a workspace, `bun update <name>` %s naming a package only another workspace reaches is an error",
  async (_, cwd, args, message) => {
    const { dir, texts, textsBefore, lockBefore } = await disjointEdges();
    const { stdout, stderr, exitCode } = await runIn(dir, cwd, "update", ...args, "no-deps");
    expectHeaderOnly(stdout, "update");
    expect(stderr).toContain(message);
    expect(stderr).not.toContain("note:");
    expect(await lockText(dir)).toBe(lockBefore);
    expect(await texts()).toStrictEqual(textsBefore);
    expect(exitCode).toBe(1);
  },
);

// -r plans pkg1's own a-dep entry too and lists it once; --filter pkg1 plans nothing but that entry.
test.concurrent.each<[string, string[], string[]]>([
  ["-r", ["-r"], [A_DEP_ROW, NO_DEPS_ROW_HINTED]],
  ["--filter pkg1", ["--filter", "pkg1"], [A_DEP_ROW]],
  ["-r --latest", ["-r", "--latest"], [A_DEP_ROW, NO_DEPS_ROW_HINTED]],
])("in a workspace, `bun update %s --dry-run` prints one row per move and writes nothing", async (_, args, rows) => {
  const { dir, texts, textsBefore, lockBefore } = await disjointEdges();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run", ...args);
  expectDryRun(stdout, ...rows);
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(lockBefore);
  expect(await texts()).toStrictEqual(textsBefore);
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["bare", []],
  ["named", ["no-deps"]],
])("in a workspace, `bun update --filter` matching no workspace is an error (%s)", async (_, args) => {
  const { dir, texts, textsBefore, lockBefore } = await disjointEdges();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--filter", "zzz", ...args);
  expect(stderr).toContain('error: No workspace packages matched the filter "zzz"\n');
  expect(stderr).not.toContain("warn:");
  expect(stderr).not.toContain("Saved lockfile");
  expectHeaderOnly(stdout, "update");
  expect(await lockText(dir)).toBe(lockBefore);
  expect(await texts()).toStrictEqual(textsBefore);
  expect(exitCode).toBe(1);
});

test.concurrent.each([
  ["from packages/pkg2", "packages/pkg2", []],
  ["with --filter pkg2", "", ["--filter", "pkg2"]],
])(
  "in a workspace, `bun update <name>` %s moves a package that workspace reaches transitively",
  async (_, cwd, args) => {
    const { dir, texts, textsBefore } = await disjointEdges();
    const { stdout, stderr, exitCode } = await runIn(dir, cwd, "update", ...args, "no-deps");
    expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
    expectCleanStderr(stderr);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
    expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
    expect(await texts()).toStrictEqual(textsBefore);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

// dep-with-tags has 3.0.1 published above its `latest` (3.0.0); prereleases-1 has 1.0.0-future.7 above 1.0.0-future.4.
test.concurrent.each([
  ["dep-with-tags", "3.0.1"],
  ["prereleases-1", "1.0.0-future.7"],
])("`bun update --latest` does not downgrade %s from %s, which is ahead of `latest`", async (name, version) => {
  const packageJson = pkgJson({ [name]: version });
  const dir = await setup({ "package.json": packageJson });
  expect(await installedVersion(dir, name)).toBe(version);

  const { stdout, stderr, exitCode } = await run(dir, "update", "--latest");
  expectSummary(stdout, noChanges(1, 2));
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, name)).toStrictEqual([version]);
  expect(await lockText(dir)).not.toContain('"latest"');
  expect(await installedVersion(dir, name)).toBe(version);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "`bun update --latest` holds back only the entry it rewrote; a member's own dist-tag entry still follows its tag",
  async () => {
    const dir = await setup({
      "package.json": { ...ROOT, dependencies: { "dep-with-tags": "3.0.1" } },
      "packages/pkg1/package.json": member("pkg1", { "dep-with-tags": "pre-2" }),
    });
    expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["2.0.1", "3.0.1"]);
    const rootText = await packageJsonText(dir);
    const pkg1Text = await packageJsonText(dir, "packages/pkg1");

    const { stdout, stderr, exitCode } = await run(dir, "update", "--latest");
    expectSummary(stdout, noChanges(3, 4));
    expectCleanStderr(stderr);
    expect(stderr).not.toContain("Saved lockfile");
    expect(await packageJsonText(dir)).toBe(rootText);
    expect(await packageJsonText(dir, "packages/pkg1")).toBe(pkg1Text);
    expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["2.0.1", "3.0.1"]);
    expect((await lock(dir)).workspaces["packages/pkg1"].dependencies).toStrictEqual({ "dep-with-tags": "pre-2" });
    expect(await installedVersion(dir, "dep-with-tags")).toBe("3.0.1");
    expect(await lockText(dir)).toContain('"dep-with-tags@2.0.1"');
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("`bun up --help` prints the update help", async () => {
  const { packageDir } = await registry.createTestDir();
  const { stdout, exitCode } = await run(packageDir, "up", "--help");
  expect(stdout).toContain("bun update");
  expect(stdout).toContain("Alias: bun up");
  expect(stdout).toContain("-L, --latest");
  expect(stdout).toContain("--no-optional");
  expect(stdout).toContain("Only update dependencies and optionalDependencies");
  expect(stdout).toContain("bun update --prod");
  expect(stdout).not.toContain("--transitive");
  expect(stdout).not.toContain("Don't install devDependencies");
  expect(stdout).toContain("-p, --production");
  expect(exitCode).toBe(0);
});

test.concurrent("`bun up` is `bun update`", async () => {
  const { dir, packageJson } = await stale();
  const { stdout, stderr, exitCode } = await run(dir, "up");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("`-L` is `--latest`", async () => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "~1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
  const { stdout, stderr, exitCode } = await run(dir, "update", "-L");
  expectSummary(stdout, movedRow("no-deps", "1.0.1", "2.0.0"), "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "~2.0.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --silent` prints nothing at all but still moves the transitive dependency", async () => {
  const { dir, packageJson, noDeps } = await stale();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--silent");
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --silent --dry-run` prints nothing and writes nothing", async () => {
  const { dir, noDeps } = await stale();
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--silent", "--dry-run");
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(await lockText(dir)).toBe(before);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
  expect(exitCode).toBe(0);
});

test.concurrent.each<[string, Layout]>([
  ["hoisted", {}],
  ["isolated", { linker: "isolated" }],
])("`bun update --no-save` moves the transitive dependency in node_modules only (%s)", async (_, layout) => {
  const { dir, noDeps } = await stale(layout);
  const packageJsonBefore = await packageJsonText(dir);
  const lockBefore = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--no-save", ...linkerArgs(layout));
  expectMoved(stdout, "no-deps", "1.0.0", "1.1.0");
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("Saved lockfile");
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
  expect(await lockText(dir)).toBe(lockBefore);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  expect(exitCode).toBe(0);
});

async function expectNoop(dir: string, ...args: string[]) {
  const packageJson = await packageJsonOf(dir);
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectNoChangesLine(stdout);
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockText(dir)).toBe(before);
  await frozen(dir);
  expect(exitCode).toBe(0);
  return stdout;
}

// hoist-lockfile-{1,2,3} depend on hoist-lockfile-shared (1.0.1 / 1.0.2 / 2.0.1 / 2.0.2) as `*` / `^1.0.1` / `>=1.0.1`.
const HOIST_DEPENDENTS = { "hoist-lockfile-1": "1.0.0", "hoist-lockfile-2": "1.0.0", "hoist-lockfile-3": "1.0.0" };

async function staleShared() {
  const packageJson = pkgJson(HOIST_DEPENDENTS);
  const dir = await copyOf(["staleShared"], {}, async () => {
    const dir = await setup({ "package.json": pkgJson({ ...HOIST_DEPENDENTS, "hoist-lockfile-shared": "1.0.1" }) });
    await reinstall(dir, packageJson);
    expect(await lockedVersions(dir, "hoist-lockfile-shared")).toStrictEqual(["1.0.1"]);
    return dir;
  });
  return { dir, packageJson };
}

// One row per version the edges move onto: the `^1.0.1` edge goes to 1.0.2, the `*` and `>=1.0.1` edges to 2.0.2.
test.concurrent.each([
  ["bare", []],
  ["named", ["hoist-lockfile-shared"]],
  ["named with an ignored @version", ["hoist-lockfile-shared@1.0.1"]],
])("every dependent's range on a shared package is re-resolved on its own (%s)", async (_, args) => {
  const { dir, packageJson } = await staleShared();
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectRowSetAnd(
    stdout,
    [movedRow("hoist-lockfile-shared", "1.0.1", "1.0.2"), movedRow("hoist-lockfile-shared", "1.0.1", "2.0.2")],
    installed(2),
  );
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(HOIST_DEPENDENTS);
  expect(await lockedVersions(dir, "hoist-lockfile-shared")).toStrictEqual(["1.0.2", "2.0.2"]);
  expect(await resolvedEdges(dir, "hoist-lockfile-shared", ...Object.keys(HOIST_DEPENDENTS))).toStrictEqual({
    "hoist-lockfile-1": "2.0.2",
    "hoist-lockfile-2": "1.0.2",
    "hoist-lockfile-3": "2.0.2",
  });
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("the plan counts packages, not the edges that move onto them", async () => {
  const { dir } = await staleShared();
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run");
  expectDryRun(
    stdout,
    movedRow("hoist-lockfile-shared", "1.0.1", "1.0.2", "2.0.2"),
    movedRow("hoist-lockfile-shared", "1.0.1", "2.0.2"),
  );
  expectCleanStderr(stderr);
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
});

// peer-deps-fixed@1.0.0 declares peer `no-deps: ^1.0.0`; the root's exact no-deps@1.0.0 is its only provider.
test.concurrent.each([
  ["bare", []],
  ["--latest peer-deps-fixed", ["--latest", "peer-deps-fixed"]],
  ["no-deps", ["no-deps"]],
])("a peer edge keeps following the root's pinned provider instead of forking (%s)", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expectSummary(await expectNoop(dir, ...args), noChanges(2, 3));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
});

// peer-deps-fixed@1.0.0 declares peer `no-deps: ^1.0.0`; the root's exact no-deps@1.0.0 provided it, and dropping that entry leaves the auto-installed peer parked on 1.0.0.
async function staleAutoInstalledPeer() {
  const packageJson = pkgJson({ "peer-deps-fixed": "1.0.0" });
  const dir = await copyOf(["staleAutoInstalledPeer"], {}, async () => {
    const dir = await setup({ "package.json": pkgJson({ "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" }) });
    await reinstall(dir, packageJson);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
    return dir;
  });
  return { dir, packageJson };
}

test.concurrent.each([
  ["bare", []],
  ["--latest peer-deps-fixed", ["--latest", "peer-deps-fixed"]],
  ["no-deps", ["no-deps"]],
])("an auto-installed peer that nothing else depends on is re-resolved (%s)", async (_, args) => {
  const { dir, packageJson } = await staleAutoInstalledPeer();
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "peer-deps-fixed")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

// peer-deps@1.0.0 has nothing but a `no-deps: *` peer, which the install auto-installs at latest.
test.concurrent("a package with only peer dependencies is a clean no-op", async () => {
  const dir = await setup({ "package.json": pkgJson({ "peer-deps": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
  expectSummary(await expectNoop(dir), noChanges(2, 3));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
});

// dep-loop-entry@1.0.0 and dep-loop-exit@1.0.0 pin each other; bundled-1@1.0.0 ships its own no-deps@1.0.0, which is a
// row of bun.lock but not an install of its own, so the count line has one install fewer than packages besides the root.
test.concurrent.each([
  ["bare", []],
  ["no-deps", ["no-deps"]],
  ["dep-loop-exit", ["dep-loop-exit"]],
])("a dependency cycle and a bundled dependency are left alone (%s)", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "dep-loop-entry": "1.0.0", "bundled-1": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expectSummary(await expectNoop(dir, ...args), noChanges(3, 5));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "dep-loop-entry")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "dep-loop-exit")).toStrictEqual(["1.0.0"]);
});

test.concurrent.each([
  ["bare", []],
  ["no-deps", ["no-deps"]],
])("a bundled edge is not re-resolved even when its range would allow it (%s)", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "bundled-1": "1.0.0" }) });
  const pinned = await lockText(dir);
  expect(pinned).toContain('"bundled-1/no-deps": ["no-deps@1.0.0"');
  expect(pinned.split('{ "dependencies": { "no-deps": "1.0.0" } }')).toHaveLength(2);
  const widened = pinned.replace(
    '{ "dependencies": { "no-deps": "1.0.0" } }',
    '{ "dependencies": { "no-deps": "^1.0.0" } }',
  );
  await write(join(dir, "bun.lock"), widened);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectSummary(stdout, noChanges(1, 3));
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(widened);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

// pkg1 and pkg2 both install no-deps@1.0.0 exactly, then widen to the given ranges, which keep 1.0.0 locked for both.
async function staleMembers(pkg1Range: string, pkg2Range: string) {
  const dir = await setup({
    "package.json": ROOT,
    "packages/pkg1/package.json": member("pkg1", { "no-deps": "1.0.0" }),
    "packages/pkg2/package.json": member("pkg2", { "no-deps": "1.0.0" }),
  });
  await write(join(dir, "packages/pkg2/package.json"), stringify(member("pkg2", { "no-deps": pkg2Range })));
  await reinstall(dir, member("pkg1", { "no-deps": pkg1Range }), {}, "packages/pkg1");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  return { dir, pkg2Text: await packageJsonText(dir, "packages/pkg2") };
}

test.concurrent("in a workspace, `bun update` from one member also re-points a sibling's identical range", async () => {
  const { dir } = await staleMembers("~1.0.0", "~1.0.0");
  const { stdout, stderr, exitCode } = await runIn(dir, "packages/pkg1", "update");
  expectSummary(stdout, movedRow("no-deps", "1.0.0", "1.0.1", "2.0.0"), "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(ROOT);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", { "no-deps": "~1.0.1" }));
  expect(await packageJsonOf(dir, "packages/pkg2")).toStrictEqual(member("pkg2", { "no-deps": "~1.0.0" }));
  const { workspaces } = await lock(dir);
  expect(workspaces["packages/pkg1"].dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
  expect(workspaces["packages/pkg2"].dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

type Manifests = Record<string, Record<string, { dependencies?: Record<string, string> }>>;
type Tags = Record<string, Record<string, string>>;

// Serves one manifest per name from memory; verdaccio has no parent whose newer version keeps a range on the same child, and its dist-tags cannot move mid-test. `tags` is read per request, so a test can move a tag after installing.
type RegistryKnobs = { times?: Record<string, Record<string, string>>; status?: Record<string, number> };

async function serveRegistry(manifests: Manifests, tags: Tags = {}, knobs: RegistryKnobs = {}) {
  const tarballs = new Map<string, Uint8Array>();
  for (const [name, versions] of Object.entries(manifests)) {
    for (const [version, extra] of Object.entries(versions)) {
      const archive = new Bun.Archive(
        { "package/package.json": JSON.stringify({ name, version, ...extra }) },
        { compress: "gzip" },
      );
      tarballs.set(`/${name}-${version}.tgz`, await archive.bytes());
    }
  }
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const tarball = tarballs.get(pathname);
      if (tarball) return new Response(tarball);
      const name = pathname.slice(1);
      const entry = manifests[name];
      const status = knobs.status?.[name];
      if (status) return new Response("registry says no", { status });
      if (!entry) return new Response("not found", { status: 404 });
      const versions: Json = {};
      for (const [version, extra] of Object.entries(entry)) {
        versions[version] = { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` }, ...extra };
      }
      const latest = Object.keys(entry).sort(Bun.semver.order).at(-1);
      const time = knobs.times?.[name];
      return Response.json({ name, versions, "dist-tags": { latest, ...tags[name] }, ...(time ? { time } : {}) });
    },
  });
}

// Installs `pinned` against the in-memory registry, then re-installs `packageJson`, which drops the pins that parked the transitive edges.
async function setupServed(server: Bun.Server, prefix: string, pinned: Json, packageJson: Json = pinned) {
  const dir = await installServed(server, prefix, pinned);
  if (packageJson !== pinned) await reinstall(dir, packageJson);
  return dir;
}

const servedBunfig = (server: Bun.Server, dir: string, extra: Json = {}) =>
  write(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: join(dir, ".bun-cache"),
        registry: server.url.href,
        saveTextLockfile: true,
        linker: "hoisted",
        ...extra,
      },
    }),
  );

async function installServed(server: Bun.Server, prefix: string, packageJson: Json, ...args: string[]) {
  const dir = String(tempDir(prefix, { "package.json": stringify(packageJson) }));
  await servedBunfig(server, dir);
  await install(dir, ...args);
  return dir;
}

const freshInstallLock = async (server: Bun.Server, prefix: string, packageJson: Json, ...args: string[]) =>
  lock(await installServed(server, prefix, packageJson, ...args));

test.concurrent("`bun update <name>` leaves the named package's own dependencies where they are", async () => {
  using server = await serveRegistry({
    parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } }, "1.1.0": { dependencies: { leaf: "^1.0.0" } } },
    leaf: { "1.0.0": {}, "1.1.0": {} },
  });
  const dir = await setupServed(
    server,
    "update-named-children-",
    pkgJson({ parent: "1.0.0", leaf: "1.0.0" }),
    pkgJson({ parent: "^1.0.0" }),
  );
  expect(await lockedVersions(dir, "parent")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);

  const named = await run(dir, "update", "parent");
  expectSummary(named.stdout, movedRow("parent", "1.0.0", "1.1.0"), "", installed(1));
  expectCleanStderr(named.stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ parent: "^1.1.0" }));
  expect(await lockedVersions(dir, "parent")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "parent")).toBe("1.1.0");
  expect(await installedVersion(dir, "leaf")).toBe("1.0.0");
  await frozen(dir);
  expect(named.exitCode).toBe(0);

  const bare = await run(dir, "update");
  expectSummary(bare.stdout, movedRow("leaf", "1.0.0", "1.1.0"), "", installed(1));
  expectCleanStderr(bare.stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ parent: "^1.1.0" }));
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, "leaf")).toBe("1.1.0");
  await frozen(dir);
  expect(bare.exitCode).toBe(0);
});

// parent and other are already at their newest; the leaf under each is parked one release behind by the dropped root pins.
const STALE_CHILDREN: Manifests = {
  parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } },
  leaf: { "1.0.0": {}, "1.1.0": {} },
  other: { "1.0.0": { dependencies: { "other-leaf": "^1.0.0" } } },
  "other-leaf": { "1.0.0": {}, "1.1.0": {} },
};

async function staleChildren(server: Bun.Server) {
  const packageJson = pkgJson({ parent: "^1.0.0", other: "^1.0.0" });
  const dir = await setupServed(
    server,
    "update-named-children-",
    pkgJson({ ...packageJson.dependencies, leaf: "1.0.0", "other-leaf": "1.0.0" }),
    packageJson,
  );
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "other-leaf")).toStrictEqual(["1.0.0"]);
  return { dir, packageJson };
}

test.concurrent("`bun update <name>` whose package does not move keeps its dependencies locked", async () => {
  using server = await serveRegistry(STALE_CHILDREN);
  const { dir, packageJson } = await staleChildren(server);
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "parent");
  expectSummary(stdout, noChanges(4, 5));
  expectCleanStderr(stderr);
  expect(stderr).not.toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockText(dir)).toBe(before);
  expect(await installedVersion(dir, "leaf")).toBe("1.0.0");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "`bun update <name> --latest` re-resolves only the named package's own dependencies, in range",
  async () => {
    using server = await serveRegistry(STALE_CHILDREN);
    const { dir, packageJson } = await staleChildren(server);
    const { stdout, stderr, exitCode } = await run(dir, "update", "parent", "--latest");
    expectSummary(stdout, movedRow("leaf", "1.0.0", "1.1.0"), "", installed(1));
    expectCleanStderr(stderr);
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect(await lockedVersions(dir, "parent")).toStrictEqual(["1.0.0"]);
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "other-leaf")).toStrictEqual(["1.0.0"]);
    expect(await installedVersion(dir, "leaf")).toBe("1.1.0");
    expect(await installedVersion(dir, "other-leaf")).toBe("1.0.0");
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

const TAGGED_FREE: Manifests = {
  parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } },
  leaf: { "1.0.0": {}, "1.1.0": {} },
};

const LEAF_1_1_0_FATAL_SCANNER = `export const scanner = {
  version: "1",
  scan: async ({ packages }) => {
    console.log("scanned: " + packages.map(p => p.name + "@" + p.version).join(" "));
    return packages
      .filter(p => p.name === "leaf" && p.version === "1.1.0")
      .map(() => ({ package: "leaf", description: "leaf@1.1.0 is bad", level: "fatal", url: "https://example.com/leaf" }));
  },
};
`;

async function withLeafScanner(server: Bun.Server, dir: string) {
  await write(join(dir, "scanner.ts"), LEAF_1_1_0_FATAL_SCANNER);
  await servedBunfig(server, dir, { security: { scanner: "./scanner.ts" } });
  return lockText(dir);
}

test.concurrent(
  "`bun update <name>` for a transitive-only name runs the security scanner on what it re-resolved",
  async () => {
    using server = await serveRegistry(TAGGED_FREE);
    const packageJson = pkgJson({ parent: "^1.0.0" });
    const dir = await setupServed(
      server,
      "update-named-scan-",
      pkgJson({ ...packageJson.dependencies, leaf: "1.0.0" }),
      packageJson,
    );
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
    const before = await withLeafScanner(server, dir);
    const { stdout, exitCode } = await run(dir, "update", "leaf");
    expect(stdout).toContain("scanned: leaf@1.1.0");
    expect(stdout).not.toContain("parent@");
    expect(stdout).toContain("FATAL: leaf");
    expect(stdout).toContain("Installation aborted due to fatal security advisories");
    expect(await lockText(dir)).toBe(before);
    expect(await installedVersion(dir, "leaf")).toBe("1.0.0");
    expect(exitCode).toBe(1);
  },
);

// The request binds to the root's exact leaf@1.0.0, which stays put; the copy that moves is parent's nested one.
test.concurrent(
  "`bun update <name>` also scans the nested copy it re-resolved when the root's own row stays put",
  async () => {
    using server = await serveRegistry(TAGGED_FREE);
    const dir = await installServed(server, "update-named-scan-nested-", pkgJson({ parent: "^1.0.0", leaf: "1.0.0" }));
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
    const before = await withLeafScanner(server, dir);
    const { stdout, exitCode } = await run(dir, "update", "leaf");
    const scanned = stdout.match(/^scanned: .*$/m)?.[0] ?? "";
    expect(scanned).toContain("leaf@1.0.0");
    expect(scanned).toContain("leaf@1.1.0");
    expect(stdout).toContain("FATAL: leaf");
    expect(await lockText(dir)).toBe(before);
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
    expect(await installedVersion(dir, "leaf")).toBe("1.0.0");
    expect(exitCode).toBe(1);
  },
);

test.concurrent("`bun update <name>` for a transitive-only name that the scanner accepts installs it", async () => {
  using server = await serveRegistry({ ...TAGGED_FREE, leaf: { "1.0.0": {}, "1.0.1": {} } });
  const packageJson = pkgJson({ parent: "^1.0.0" });
  const dir = await setupServed(
    server,
    "update-named-scan-clean-",
    pkgJson({ ...packageJson.dependencies, leaf: "1.0.0" }),
    packageJson,
  );
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
  await withLeafScanner(server, dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "leaf");
  expect(stdout).toContain("scanned: leaf@1.0.1");
  expect(stdout).not.toContain("FATAL:");
  expectRowsAnd(stdout, [movedRow("leaf", "1.0.0", "1.0.1")], installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.1"]);
  expect(await installedVersion(dir, "leaf")).toBe("1.0.1");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

const TAGGED: Manifests = {
  parent: { "1.0.0": { dependencies: { leaf: "stable" } } },
  leaf: { "1.0.0": {}, "1.1.0": {} },
};

// `stable` is moved after the install; `bun install` keeps the locked version, so only `bun update` can follow it.
async function movedTag(server: Bun.Server, tags: Tags, from: string, to: string) {
  const packageJson = pkgJson({ parent: "^1.0.0" });
  const dir = await setupServed(server, "update-moved-tag-", packageJson);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual([from]);
  expect(await lockText(dir)).toContain('"leaf": "stable"');
  tags.leaf.stable = to;
  await install(dir);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual([from]);
  return { dir, packageJson };
}

test.concurrent.each([
  ["bare", "1.0.0", "1.1.0", []],
  ["--latest", "1.0.0", "1.1.0", ["--latest"]],
  ["bare, tag moved backwards", "1.1.0", "1.0.0", []],
])("`bun update` follows a transitive dist-tag edge to wherever its tag points now (%s)", async (_, from, to, args) => {
  const tags: Tags = { leaf: { stable: from } };
  using server = await serveRegistry(TAGGED, tags);
  const { dir, packageJson } = await movedTag(server, tags, from, to);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expectRowsAnd(stdout, [movedRow("leaf", from, to)], installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual([to]);
  expect(await lockText(dir)).toContain('"leaf": "stable"');
  expect(await installedVersion(dir, "leaf")).toBe(to);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
const THREE_DAYS_SECONDS = String((3 * DAY_MS) / 1000);

// leaf is reached through a range, tagged through its `stable` tag; both have a newest release published yesterday.
const AGED: Manifests = {
  parent: { "1.0.0": { dependencies: { leaf: "^1.0.0", tagged: "stable" } } },
  leaf: { "1.0.0": {}, "1.1.0": {}, "1.2.0": {} },
  tagged: { "1.0.0": {}, "1.1.0": {}, "1.2.0": {} },
};
const AGED_TIMES = {
  leaf: { "1.0.0": daysAgo(30), "1.1.0": daysAgo(20), "1.2.0": daysAgo(1) },
  tagged: { "1.0.0": daysAgo(30), "1.1.0": daysAgo(20), "1.2.0": daysAgo(1) },
};

test.concurrent(
  "`bun update --minimum-release-age` stops range and dist-tag edges at the newest old enough release",
  async () => {
    const tags: Tags = { tagged: { stable: "1.0.0" } };
    using server = await serveRegistry(AGED, tags, { times: AGED_TIMES });
    const packageJson = pkgJson({ parent: "^1.0.0" });
    const dir = await setupServed(
      server,
      "update-min-age-",
      pkgJson({ ...packageJson.dependencies, leaf: "1.0.0" }),
      packageJson,
    );
    tags.tagged.stable = "1.2.0";
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
    expect(await lockedVersions(dir, "tagged")).toStrictEqual(["1.0.0"]);

    const { stdout, stderr, exitCode } = await run(dir, "update", "--minimum-release-age", THREE_DAYS_SECONDS);
    expectRowSetAnd(stdout, [movedRow("leaf", "1.0.0", "1.1.0"), movedRow("tagged", "1.0.0", "1.1.0")], installed(2));
    expect(stdout).not.toContain("1.2.0");
    expectCleanStderr(stderr);
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "tagged")).toStrictEqual(["1.1.0"]);
    expect(await installedVersion(dir, "leaf")).toBe("1.1.0");
    expect(await installedVersion(dir, "tagged")).toBe("1.1.0");
    await frozen(dir);
    expect(await lock(dir)).toStrictEqual(
      await freshInstallLock(server, "update-min-age-fresh-", packageJson, "--minimum-release-age", THREE_DAYS_SECONDS),
    );
    expect(exitCode).toBe(0);
  },
);

// Mirrors verdaccio's dep-with-tags: 3.0.1 is published above `latest` (3.0.0), which `bun install` prefers whenever the range allows it.
const ABOVE_LATEST: Manifests = {
  parent: { "1.0.0": { dependencies: { leaf: ">=1.0.0" } } },
  leaf: { "1.0.0": {}, "1.0.1": {}, "2.0.0": {}, "2.0.1": {}, "3.0.0": {}, "3.0.1": {} },
};
const ABOVE_LATEST_TAGS: Tags = { leaf: { latest: "3.0.0" } };

test.concurrent(
  "a bare `bun update` moves a transitive range edge to `latest`, as a fresh `bun install` would",
  async () => {
    using server = await serveRegistry(ABOVE_LATEST, ABOVE_LATEST_TAGS);
    const packageJson = pkgJson({ parent: "^1.0.0" });
    const dir = await setupServed(
      server,
      "update-below-latest-",
      pkgJson({ ...packageJson.dependencies, leaf: "2.0.1" }),
      packageJson,
    );
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["2.0.1"]);

    const { stdout, stderr, exitCode } = await run(dir, "update");
    expectSummary(stdout, movedRow("leaf", "2.0.1", "3.0.0"), "", installed(1));
    expectCleanStderr(stderr);
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["3.0.0"]);
    expect(await installedVersion(dir, "leaf")).toBe("3.0.0");
    await frozen(dir);
    expect(await lock(dir)).toStrictEqual(await freshInstallLock(server, "update-below-latest-fresh-", packageJson));
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "a transitive range edge already on `latest` is a no-op even though a newer release exists",
  async () => {
    using server = await serveRegistry(ABOVE_LATEST, ABOVE_LATEST_TAGS);
    const packageJson = pkgJson({ parent: "^1.0.0" });
    const dir = await setupServed(server, "update-at-latest-", packageJson);
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["3.0.0"]);
    expectSummary(await expectNoop(dir), noChanges(2, 3));
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["3.0.0"]);
    expect(await lock(dir)).toStrictEqual(await freshInstallLock(server, "update-at-latest-fresh-", packageJson));
  },
);

test.concurrent("a transitive range edge locked ahead of `latest` is not downgraded", async () => {
  using server = await serveRegistry(ABOVE_LATEST, ABOVE_LATEST_TAGS);
  const packageJson = pkgJson({ parent: "^1.0.0" });
  const dir = await setupServed(
    server,
    "update-ahead-of-latest-",
    pkgJson({ ...packageJson.dependencies, leaf: "3.0.1" }),
    packageJson,
  );
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["3.0.1"]);
  expectSummary(await expectNoop(dir), noChanges(2, 3));
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["3.0.1"]);
  expect(await installedVersion(dir, "leaf")).toBe("3.0.1");
  expect(
    await lockedVersions(await installServed(server, "update-ahead-of-latest-fresh-", packageJson), "leaf"),
  ).toStrictEqual(["3.0.0"]);
});

// `pre` is parked on `from` by a dropped root pin; parent's range on it is `range`.
test.concurrent.each<[string, string, string[], string, string]>([
  [
    "the newest prerelease it allows",
    "^1.0.0-future.4",
    ["1.0.0-future.4", "1.0.0-future.7"],
    "1.0.0-future.4",
    "1.0.0-future.7",
  ],
  [
    "the release over a prerelease that also satisfies it",
    "^1.0.0-rc.1",
    ["1.0.0-rc.1", "1.0.0-rc.2", "1.0.0"],
    "1.0.0-rc.1",
    "1.0.0",
  ],
  [
    "a prerelease whose tag is longer than 8 bytes",
    "^1.0.0-future.4",
    ["1.0.0-future.4", "1.0.0-future.10"],
    "1.0.0-future.4",
    "1.0.0-future.10",
  ],
])("a transitive prerelease range moves to %s", async (_, range, versions, from, to) => {
  using server = await serveRegistry({
    parent: { "1.0.0": { dependencies: { pre: range } } },
    pre: Object.fromEntries(versions.map(version => [version, {}])),
  });
  const packageJson = pkgJson({ parent: "^1.0.0" });
  const dir = await setupServed(
    server,
    "update-prerelease-",
    pkgJson({ ...packageJson.dependencies, pre: from }),
    packageJson,
  );
  expect(await lockedVersions(dir, "pre")).toStrictEqual([from]);

  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, movedRow("pre", from, to), "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "pre")).toStrictEqual([to]);
  expect((await lock(dir)).packages.pre[0]).toBe(`pre@${to}`);
  expect(await installedVersion(dir, "pre")).toBe(to);
  await frozen(dir);
  expect(await installedVersion(dir, "pre")).toBe(to);
  expect(exitCode).toBe(0);
});

// A package whose manifest could not be fetched is reported once, as a stderr warning carrying the registry's answer; stdout keeps the summary block only.
function expectWarnings(stderr: string, ...warnings: string[]) {
  expect(
    stderr
      .split("\n")
      .filter(line => line.startsWith("warn:"))
      .map(line => `${line}\n`),
  ).toStrictEqual(warnings);
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("Resolving...");
}

// Only leaf is stale; its manifest stops being served between the install and the update.
test.concurrent.each([404, 500])(
  "a %d for a transitive dependency's manifest during a bare `bun update` changes nothing",
  async status => {
    const knobs: RegistryKnobs = { status: {} };
    using server = await serveRegistry(TAGGED_FREE, {}, knobs);
    const packageJson = pkgJson({ parent: "^1.0.0" });
    const dir = await setupServed(
      server,
      "update-manifest-failure-",
      pkgJson({ ...packageJson.dependencies, leaf: "1.0.0" }),
      packageJson,
    );
    expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
    const before = await lockText(dir);
    knobs.status!.leaf = status;
    const { stdout, stderr, exitCode } = await run(dir, "update");
    expectSummary(stdout, noChanges(2, 3));
    expectWarnings(stderr, notCheckedWarning(server, "leaf", "1.0.0", status));
    expect(stderr).not.toContain("Saved lockfile");
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect(await lockText(dir)).toBe(before);
    expect(await installedVersion(dir, "leaf")).toBe("1.0.0");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("a manifest that could not be fetched is warned about while the rest still moves", async () => {
  const knobs: RegistryKnobs = { status: {} };
  using server = await serveRegistry(STALE_CHILDREN, {}, knobs);
  const { dir, packageJson } = await staleChildren(server);
  knobs.status!.leaf = 404;
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, movedRow("other-leaf", "1.0.0", "1.1.0"), "", installed(1));
  expectWarnings(stderr, notCheckedWarning(server, "leaf", "1.0.0", 404));
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "other-leaf")).toStrictEqual(["1.1.0"]);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("several unfetchable manifests are warned about once each, sorted", async () => {
  const knobs: RegistryKnobs = { status: {} };
  using server = await serveRegistry(STALE_CHILDREN, {}, knobs);
  const { dir, packageJson } = await staleChildren(server);
  const before = await lockText(dir);
  knobs.status!.leaf = 500;
  knobs.status!["other-leaf"] = 500;
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expectSummary(stdout, noChanges(4, 5));
  expectWarnings(
    stderr,
    notCheckedWarning(server, "leaf", "1.0.0", 500),
    notCheckedWarning(server, "other-leaf", "1.0.0", 500),
  );
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --dry-run` warns about the manifests it could not fetch and prints the plan", async () => {
  const knobs: RegistryKnobs = { status: {} };
  using server = await serveRegistry(STALE_CHILDREN, {}, knobs);
  const { dir, packageJson } = await staleChildren(server);
  const before = await lockText(dir);
  knobs.status!.leaf = 404;
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run");
  expectDryRun(stdout, movedRow("other-leaf", "1.0.0", "1.1.0"));
  expectWarnings(stderr, notCheckedWarning(server, "leaf", "1.0.0", 404));
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "other-leaf")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --silent` swallows the unfetchable-manifest warning too", async () => {
  const knobs: RegistryKnobs = { status: {} };
  using server = await serveRegistry(STALE_CHILDREN, {}, knobs);
  const { dir } = await staleChildren(server);
  knobs.status!.leaf = 500;
  const { stdout, stderr, exitCode } = await run(dir, "update", "--silent");
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "other-leaf")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

// `bun outdated` and `bun update -i` exist to answer for the direct dependencies, so for them a manifest that does not arrive is reported and fails the command (a registry that is down must not read as "nothing to update"); only an optional dependency's is a warning.
const errorLines = (stderr: string) => stderr.split("\n").filter(line => line.startsWith("error:"));
const manifestFailure = (server: Bun.Server, status: number) => `GET ${server.url.origin}/leaf - ${status}`;

// leaf@1.0.0 installed while 1.1.0 exists, with the manifest cache off so every later command asks the registry again.
async function staleDirectLeaf(server: Bun.Server, groups: Groups = {}) {
  const dir = await installServed(server, "direct-manifest-failure-", grouped({ leaf: "1.0.0" }, groups));
  await servedBunfig(server, dir, { cache: false });
  return dir;
}

test.concurrent.each<[number, string[]]>([
  [502, []],
  [404, []],
  [502, ["-r"]],
])("a %d for a direct dependency's manifest fails `bun outdated` (extra args: %p)", async (status, args) => {
  const knobs: RegistryKnobs = { status: {} };
  using server = await serveRegistry(TAGGED_FREE, {}, knobs);
  const dir = await staleDirectLeaf(server);

  const healthy = await run(dir, "outdated", ...args);
  expect(healthy.stdout).toMatch(/\| leaf\s+\| 1\.0\.0\s+\| 1\.0\.0\s+\| 1\.1\.0\s+\|/);
  expectCleanStderr(healthy.stderr);
  expect(healthy.exitCode).toBe(0);

  knobs.status!.leaf = status;
  const { stdout, stderr, exitCode } = await run(dir, "outdated", ...args);
  expectHeaderOnly(stdout, "outdated");
  expect(errorLines(stderr)).toStrictEqual([`error: ${manifestFailure(server, status)}`]);
  expect(exitCode).toBe(1);
});

test.concurrent("a registry that does not answer at all fails `bun outdated`", async () => {
  using server = await serveRegistry(TAGGED_FREE);
  const dir = await staleDirectLeaf(server);
  server.stop(true);
  const { stdout, stderr, exitCode } = await run(dir, "outdated");
  expectHeaderOnly(stdout, "outdated");
  expect(errorLines(stderr)).toStrictEqual([expect.stringMatching(/^error: \w+ downloading package manifest leaf$/)]);
  expect(exitCode).toBe(1);
});

test.concurrent(
  "an optional dependency whose manifest cannot be fetched is only warned about by `bun outdated`",
  async () => {
    const knobs: RegistryKnobs = { status: {} };
    using server = await serveRegistry(TAGGED_FREE, {}, knobs);
    const dir = await staleDirectLeaf(server, { leaf: "optionalDependencies" });
    knobs.status!.leaf = 502;
    const { stdout, stderr, exitCode } = await run(dir, "outdated");
    expectHeaderOnly(stdout, "outdated");
    expectWarnings(stderr, `warn: ${manifestFailure(server, 502)}\n`);
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "a 502 for a direct dependency's manifest fails `bun update -i` instead of offering nothing",
  async () => {
    const knobs: RegistryKnobs = { status: {} };
    using server = await serveRegistry(TAGGED_FREE, {}, knobs);
    const dir = await staleDirectLeaf(server);
    const before = await lockText(dir);

    const healthy = await runInteractive(dir, "", "--dry-run");
    expect(healthy.stdout).toContain("leaf");
    expect(healthy.exitCode).toBe(0);

    knobs.status!.leaf = 502;
    const { stdout, stderr, exitCode } = await runInteractive(dir, "", "--dry-run");
    expectHeaderOnly(stdout, "update --interactive");
    expect(errorLines(stderr)).toStrictEqual([`error: ${manifestFailure(server, 502)}`]);
    expect(await lockText(dir)).toBe(before);
    expect(exitCode).toBe(1);
  },
);

test.concurrent("`bun update <name>` from a member leaves a sibling's own entry alone but lets it follow", async () => {
  const { dir, pkg2Text } = await staleMembers("~1.0.0", "^1.0.0");
  const { stdout, stderr, exitCode } = await runIn(dir, "packages/pkg1", "update", "no-deps");
  expectSummary(stdout, movedRow("no-deps", "1.0.0", "1.0.1", "2.0.0"), "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", { "no-deps": "~1.0.1" }));
  expect(await packageJsonText(dir, "packages/pkg2")).toBe(pkg2Text);
  expect((await lock(dir)).workspaces["packages/pkg2"].dependencies).toStrictEqual({ "no-deps": "^1.0.0" });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "`bun update <name>` from a member: a sibling whose range rejects the picked version stays put",
  async () => {
    const { dir, pkg1 } = await staleMemberTransitive("~1.0.0");
    const pkg2Text = await packageJsonText(dir, "packages/pkg2");
    const { stderr, exitCode } = await runIn(dir, "packages/pkg1", "update", "no-deps");
    expect(stderr).not.toContain("error:");
    expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(pkg1);
    expect(await packageJsonText(dir, "packages/pkg2")).toBe(pkg2Text);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "1.1.0"]);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("`bun update <name>` from the root does not re-resolve a member's own entry", async () => {
  const root = { ...ROOT, dependencies: { "no-deps": "^2.0.0" } };
  const dir = await setup({
    "package.json": root,
    "packages/pkg1/package.json": member("pkg1", { "no-deps": "1.0.0" }),
  });
  await reinstall(dir, member("pkg1", { "no-deps": "^1.0.0" }), {}, "packages/pkg1");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "2.0.0"]);
  const rootText = await packageJsonText(dir);
  const pkg1Text = await packageJsonText(dir, "packages/pkg1");

  const fromRoot = await run(dir, "update", "no-deps");
  expectSummary(fromRoot.stdout, noChanges(3, 4));
  expectCleanStderr(fromRoot.stderr);
  expect(fromRoot.stderr).not.toContain("Saved lockfile");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "2.0.0"]);
  expect(await packageJsonText(dir)).toBe(rootText);
  expect(await packageJsonText(dir, "packages/pkg1")).toBe(pkg1Text);
  expect(fromRoot.exitCode).toBe(0);

  const fromMember = await runIn(dir, "packages/pkg1", "update", "no-deps");
  expectSummary(fromMember.stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(fromMember.stderr);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0", "2.0.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  expect(await installedVersion(dir, "pkg1", "node_modules", "no-deps")).toBe("1.1.0");
  expect(await packageJsonText(dir)).toBe(rootText);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", { "no-deps": "^1.1.0" }));
  await frozen(dir);
  expect(fromMember.exitCode).toBe(0);
});

test.concurrent("`bun update <name>` for a name only other workspaces depend on is an error", async () => {
  const dir = await setup({
    "package.json": { ...ROOT, dependencies: { "no-deps": "1.0.0" } },
    "packages/pkg1/package.json": member("pkg1"),
  });
  await reinstall(dir, { ...ROOT, dependencies: { "no-deps": "^1.0.0" } });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  const rootText = await packageJsonText(dir);
  const lockBefore = await lockText(dir);
  const { stdout, stderr, exitCode } = await runIn(dir, "packages/pkg1", "update", "no-deps");
  expectHeaderOnly(stdout, "update");
  expect(stderr).toContain(NOT_A_DEPENDENCY_HERE("no-deps", "root"));
  expect(stderr).not.toContain("note:");
  expect(await lockText(dir)).toBe(lockBefore);
  expect(await packageJsonText(dir)).toBe(rootText);
  expect(exitCode).toBe(1);
});

function staleScoped() {
  return copyOf(["staleScoped"], {}, async () => {
    const dir = await setup({ "package.json": pkgJson({ "no-deps": "1.0.0", "@types/no-deps": "^1.0.0" }) });
    await reinstall(dir, pkgJson({ "no-deps": "^1.0.0", "@types/no-deps": "^1.0.0" }));
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await lockedVersions(dir, "@types/no-deps")).toStrictEqual(["1.0.0"]);
    return dir;
  });
}

test.concurrent("a scoped glob selects only the matching names", async () => {
  const dir = await staleScoped();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--latest", "@types/*");
  expectSummary(stdout, movedRow("@types/no-deps", "1.0.0", "2.0.0"), "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "^1.0.0", "@types/no-deps": "^2.0.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "@types/no-deps")).toStrictEqual(["2.0.0"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("a bare `*` names everything, scoped names included", async () => {
  const dir = await staleScoped();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--latest", "*");
  expectRowsAnd(
    stdout,
    [movedRow("@types/no-deps", "1.0.0", "2.0.0"), movedRow("no-deps", "1.0.0", "2.0.0")],
    installed(2),
  );
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "^2.0.0", "@types/no-deps": "^2.0.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["a negated pattern updates everything else", "!no-deps"],
  ["an unscoped glob", "a-*"],
])("%s", async (_, pattern) => {
  await expectOnlyADepMoved(await staleSiblings(), pattern);
});

test.concurrent("a version cannot be combined with a pattern", async () => {
  const dir = await staleScoped();
  await expectRejected(dir, "a version cannot be combined with a pattern: @types/*@2", "@types/*@2");
});

// The one dependency row was checked; the no-op says which patterns left nothing selected.
test.concurrent.each([
  ["a negated name", ["!no-deps"], 'match "!no-deps"'],
  ["every match negated", ["*", "!*"], 'match "*" "!*"'],
])("excluding every package is a no-op that shows its work (%s)", async (_, args, by) => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "^1.0.0" }) });
  await expectNothingToUpdate(dir, noneSelected(1, by), ...args);
});

test.concurrent.each([
  ["a pattern", ["no-*"], '"no-*"'],
  ["a group selector", ["--dev"], "--dev"],
])(
  "without a lockfile, `bun update` with %s names the missing file and the command that creates it",
  async (_, args, subject) => {
    const dir = await withoutLockfile({ "no-deps": "^1.0.0" });
    const { stderr, exitCode } = await run(dir, "update", ...args);
    expect(stderr).toContain(`error: no bun.lock to match ${subject} against\n    bun install\n`);
    expect(stderr).not.toContain("missing lockfile");
    expect(await file(join(dir, "bun.lock")).exists()).toBeFalse();
    expect(exitCode).toBe(1);
  },
);

test.concurrent("several names in one command are matched independently, aliases through their real name", async () => {
  const dir = await setup({
    "package.json": pkgJson({ "a-dep": "1.0.1", aliased: "npm:no-deps@1.0.0", "one-range-dep": "1.0.0" }),
  });
  await reinstall(dir, pkgJson({ "a-dep": "^1.0.1", aliased: "npm:no-deps@~1.0.0", "one-range-dep": "1.0.0" }));
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);

  const { stdout, stderr, exitCode } = await run(dir, "update", "a-dep", "no-deps");
  expect(movedRows(stdout)).toContain(A_DEP_ROW);
  expect(movedRows(stdout)).toContain(NO_DEPS_ROW);
  expect(stdout).not.toMatch(/^installed /m);
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(
    pkgJson({ "a-dep": "^1.0.10", aliased: "npm:no-deps@~1.0.1", "one-range-dep": "1.0.0" }),
  );
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1", "1.1.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

const DEV_A_DEP: Groups = { "a-dep": "devDependencies" };

test.concurrent.each(["--dev", "-D", "-d", "--development"])(
  "`bun update %s` only touches devDependencies",
  async flag => {
    await expectOnlyADepMoved(await staleSiblings(DEV_A_DEP), flag);
  },
);

test.concurrent.each(["--prod", "-P", "--production", "-p"])(
  "`bun update %s` only touches dependencies and still installs devDependencies",
  async flag => {
    const { dir } = await staleSiblings(DEV_A_DEP);
    const { stdout, stderr, exitCode } = await run(dir, "update", flag);
    expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
    expectCleanStderr(stderr);
    expect(await packageJsonOf(dir)).toStrictEqual(grouped({ "no-deps": "^1.1.0", "a-dep": "^1.0.1" }, DEV_A_DEP));
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.1");
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("`bun update --prod` includes optionalDependencies", async () => {
  const groups: Groups = { "a-dep": "optionalDependencies" };
  const { dir } = await staleSiblings(groups);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--prod");
  expectRowsAnd(stdout, [A_DEP_ROW, NO_DEPS_ROW], installed(2));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(grouped({ "no-deps": "^1.1.0", "a-dep": "^1.0.10" }, groups));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --no-optional` leaves optionalDependencies alone", async () => {
  const groups: Groups = { "a-dep": "optionalDependencies" };
  const { dir } = await staleSiblings(groups);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--no-optional");
  expectSummary(stdout, NO_DEPS_ROW_HINTED, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(grouped({ "no-deps": "^1.1.0", "a-dep": "^1.0.1" }, groups));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("a selector with a name outside the selected groups is an error", async () => {
  const { dir } = await staleSiblings(DEV_A_DEP);
  await expectRejected(dir, 'no dependencies in the selected groups match "no-deps"', "--dev", "no-deps");
});

test.concurrent("a selector combined with `--latest` only rewrites the selected groups", async () => {
  await expectOnlyADepMoved(await staleSiblings(DEV_A_DEP), "--dev", "--latest");
});

test.concurrent.each([
  ["--dev", ["--dev"], "selected by --dev"],
  ["--dev --no-optional", ["--dev", "--no-optional"], "selected by --dev --no-optional"],
])("a selector matching nothing (%s) is a no-op that shows its work", async (_, args, by) => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "^1.0.0" }) });
  await expectNothingToUpdate(dir, noneSelected(1, by), ...args);
});

test.concurrent("a version cannot be combined with a selector", async () => {
  const { dir } = await staleSiblings(DEV_A_DEP);
  await expectRejected(
    dir,
    "a version cannot be combined with --dev, --prod or --no-optional: a-dep@1",
    "--dev",
    "a-dep@1",
  );
});

test.concurrent.each([
  ["a name", "a-dep"],
  ["a pattern", "a-*"],
])("`bun update -D` with %s that hits moves only that entry", async (_, arg) => {
  await expectOnlyADepMoved(await staleSiblings(DEV_A_DEP), "-D", arg);
});

function staleAlias() {
  return copyOf(["staleAlias"], {}, async () => {
    const dir = await setup({ "package.json": pkgJson({ aliased: "npm:no-deps@1.0.0", "a-dep": "1.0.1" }) });
    await reinstall(dir, pkgJson({ aliased: "npm:no-deps@~1.0.0", "a-dep": "^1.0.1" }));
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
    return dir;
  });
}

test.concurrent("a pattern matches an aliased entry through its alias", async () => {
  const dir = await staleAlias();
  const { stdout, stderr, exitCode } = await run(dir, "update", "alias*");
  expectSummary(stdout, movedRow("aliased", "1.0.0", "1.0.1", "2.0.0"), "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ aliased: "npm:no-deps@~1.0.1", "a-dep": "^1.0.1" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  expect(await installedVersion(dir, "aliased")).toBe("1.0.1");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("a negated pattern excludes an aliased entry through its alias", async () => {
  const dir = await staleAlias();
  const { stdout, stderr, exitCode } = await run(dir, "update", "!aliased");
  expectSummary(stdout, A_DEP_ROW, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ aliased: "npm:no-deps@~1.0.0", "a-dep": "^1.0.10" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  expect(await installedVersion(dir, "aliased")).toBe("1.0.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("a pattern with an unparsable lockfile is an error", async () => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "^1.0.0" }) });
  await write(join(dir, "bun.lock"), "this is not a lockfile\n");
  const packageJsonBefore = await packageJsonText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "no-*");
  expectHeaderOnly(stdout, "update");
  expect(stderr).toContain("error: failed to parse lockfile:");
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
  expect(await lockText(dir)).toBe("this is not a lockfile\n");
  expect(exitCode).toBe(1);
});

const withPeer = (aDep: string, noDeps: string) => ({
  name: "foo",
  dependencies: { "a-dep": aDep },
  peerDependencies: { "no-deps": noDeps },
});

function stalePeerEntry() {
  return copyOf(["stalePeerEntry"], {}, async () => {
    const dir = await setup({ "package.json": withPeer("1.0.1", "1.0.0") });
    await reinstall(dir, withPeer("^1.0.1", "^1.0.0"));
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
    return dir;
  });
}

// A root peerDependencies entry is never re-resolved by `bun update`; a pattern still counts it as a match, a group selector does not.
test.concurrent("a pattern matches a peerDependencies entry", async () => {
  const dir = await stalePeerEntry();
  const packageJsonBefore = await packageJsonText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "no-*");
  expectSummary(stdout, noChanges(2, 3));
  expectCleanStderr(stderr);
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --prod` does not match a peerDependencies entry", async () => {
  const dir = await stalePeerEntry();
  await expectRejected(dir, 'error: no dependencies in the selected groups match "no-*"', "--prod", "no-*");
});

test.concurrent("`bun update --prod` leaves a stale peerDependencies entry alone", async () => {
  const dir = await stalePeerEntry();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--prod");
  expectSummary(stdout, A_DEP_ROW, "", installed(1));
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(withPeer("^1.0.10", "^1.0.0"));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --dev` with only a stale peerDependencies entry has nothing to update", async () => {
  const dir = await stalePeerEntry();
  const packageJsonBefore = await packageJsonText(dir);
  await expectNothingToUpdate(dir, noneSelected(2, "selected by --dev"), "--dev");
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
});

// pkg1 has a stale entry in every group; pkg2 only in dependencies; the root has none.
const PKG1_GROUPS = (noDeps: string, types: string, aDep: string) => ({
  name: "pkg1",
  version: "1.0.0",
  dependencies: { "no-deps": noDeps, "@types/no-deps": types },
  devDependencies: { "a-dep": aDep },
});
const PKG2_GROUPS = (depWithTags: string, types: string) => ({
  name: "pkg2",
  version: "1.0.0",
  dependencies: { "dep-with-tags": depWithTags, "@types/no-deps": types },
});

const lockedGroups = async (dir: string) => ({
  "no-deps": await lockedVersions(dir, "no-deps"),
  "@types/no-deps": await lockedVersions(dir, "@types/no-deps"),
  "a-dep": await lockedVersions(dir, "a-dep"),
  "dep-with-tags": await lockedVersions(dir, "dep-with-tags"),
});

async function staleMemberGroups() {
  const stale = {
    "no-deps": ["1.0.0"],
    "@types/no-deps": ["1.0.0"],
    "a-dep": ["1.0.1"],
    "dep-with-tags": ["1.0.0"],
  };
  const dir = await copyOf(["staleMemberGroups"], {}, async () => {
    const dir = await setup({
      "package.json": ROOT,
      "packages/pkg1/package.json": PKG1_GROUPS("1.0.0", "1.0.0", "1.0.1"),
      "packages/pkg2/package.json": PKG2_GROUPS("1.0.0", "1.0.0"),
    });
    await write(join(dir, "packages/pkg2/package.json"), stringify(PKG2_GROUPS("^1.0.0", "^1.0.0")));
    await reinstall(dir, PKG1_GROUPS("^1.0.0", "^1.0.0", "^1.0.1"), {}, "packages/pkg1");
    expect(await lockedGroups(dir)).toStrictEqual(stale);
    return dir;
  });
  const texts = () => Promise.all(MEMBER_FILES.map(rel => packageJsonText(dir, rel)));
  return { dir, locked: () => lockedGroups(dir), stale, texts, textsBefore: await texts() };
}

test.concurrent("`bun update --dev -r` rewrites every workspace's devDependencies and nothing else", async () => {
  const { dir, locked, stale, texts, textsBefore } = await staleMemberGroups();
  const [rootBefore, , pkg2Before] = textsBefore;
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dev", "-r");
  expectRowsAnd(stdout, [A_DEP_ROW], installed(1));
  expectCleanStderr(stderr);
  expect(await texts()).toStrictEqual([rootBefore, stringify(PKG1_GROUPS("^1.0.0", "^1.0.0", "^1.0.10")), pkg2Before]);
  expect(await locked()).toStrictEqual({ ...stale, "a-dep": ["1.0.10"] });
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --prod --filter pkg1` rewrites only pkg1's dependencies", async () => {
  const { dir, locked, stale, texts, textsBefore } = await staleMemberGroups();
  const [rootBefore, , pkg2Before] = textsBefore;
  const { stdout, stderr, exitCode } = await run(dir, "update", "--prod", "--filter", "pkg1");
  expectRowsAnd(stdout, [NO_DEPS_ROW], installed(1));
  expectCleanStderr(stderr);
  expect(await texts()).toStrictEqual([rootBefore, stringify(PKG1_GROUPS("^1.1.0", "^1.0.0", "^1.0.1")), pkg2Before]);
  expect(await locked()).toStrictEqual({ ...stale, "no-deps": ["1.1.0"] });
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update '@types/*' --filter pkg1 --latest` rewrites only pkg1's matching entry", async () => {
  const { dir, locked, stale, texts, textsBefore } = await staleMemberGroups();
  const [rootBefore, , pkg2Before] = textsBefore;
  const { stdout, stderr, exitCode } = await run(dir, "update", "@types/*", "--filter", "pkg1", "--latest");
  expectSummary(stdout, movedRow("@types/no-deps", "1.0.0", "2.0.0"), "", installed(1));
  expectCleanStderr(stderr);
  expect(await texts()).toStrictEqual([rootBefore, stringify(PKG1_GROUPS("^1.0.0", "^2.0.0", "^1.0.1")), pkg2Before]);
  expect(await locked()).toStrictEqual({ ...stale, "@types/no-deps": ["1.0.0", "2.0.0"] });
  const { workspaces } = await lock(dir);
  expect(workspaces["packages/pkg2"].dependencies["@types/no-deps"]).toBe("^1.0.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

// The root's only rows are its two workspace links, which are not dependencies to check; pkg2 has two.
test.concurrent.each<[string, string[], number]>([
  ["from the root without -r", ["--dev"], 0],
  ["with --filter pkg2", ["--dev", "--filter", "pkg2"], 2],
])("`bun update --dev` %s selects no entries and says what it checked", async (_, args, checked) => {
  const { dir, texts, textsBefore } = await staleMemberGroups();
  await expectNothingToUpdate(dir, noneSelected(checked, "selected by --dev"), ...args);
  expect(await texts()).toStrictEqual(textsBefore);
});

// pkg1's exact pin is widened in package.json only, so the update itself is the first thing to resolve the new range.
async function widenedPkg1() {
  const dir = await setup({
    "package.json": ROOT,
    "packages/pkg1/package.json": member("pkg1", { "no-deps": "1.0.0" }),
    "packages/pkg2/package.json": member("pkg2", { "no-deps": "1.0.0" }),
  });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  await write(join(dir, "packages/pkg1/package.json"), stringify(member("pkg1", { "no-deps": "^1.0.0" })));
  return { dir, rootText: await packageJsonText(dir), pkg2Text: await packageJsonText(dir, "packages/pkg2") };
}

test.concurrent.each([
  ["from the member", "packages/pkg1", []],
  ["with -r from the root", "", ["-r"]],
])("`bun update <name>` %s re-resolves a range widened since the last install", async (_, cwd, args) => {
  const { dir, rootText, pkg2Text } = await widenedPkg1();
  const { stdout, stderr, exitCode } = await runIn(dir, cwd, "update", ...args, "no-deps");
  // Two installs: 1.1.0 takes the hoisted slot and pkg2's 1.0.0 is re-installed nested; the one row is the move itself.
  expectRowsAnd(stdout, [NO_DEPS_ROW], installed(2));
  expectCleanStderr(stderr);
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  expect((await file(join(dir, "packages/pkg2/node_modules/no-deps/package.json")).json()).version).toBe("1.0.0");
  expect(await exists(join(dir, "packages/pkg1/node_modules/no-deps"))).toBeFalse();
  expect(await packageJsonText(dir)).toBe(rootText);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", { "no-deps": "^1.1.0" }));
  expect(await packageJsonText(dir, "packages/pkg2")).toBe(pkg2Text);
  const { workspaces } = await lock(dir);
  expect(workspaces["packages/pkg1"].dependencies).toStrictEqual({ "no-deps": "^1.1.0" });
  expect(workspaces["packages/pkg2"].dependencies).toStrictEqual({ "no-deps": "1.0.0" });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "1.1.0"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update <name> --filter <other>` records a widened range without re-resolving it", async () => {
  const { dir, rootText, pkg2Text } = await widenedPkg1();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--filter", "pkg2", "no-deps");
  // As with `bun install --filter`, only the selected workspace's installs are checked (pkg2 and its no-deps); the
  // package count is still all of bun.lock.
  expectSummary(stdout, noChanges(2, 4));
  expectCleanStderr(stderr);
  expect(stderr).toContain("Saved lockfile");
  expect(await packageJsonText(dir)).toBe(rootText);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", { "no-deps": "^1.0.0" }));
  expect(await packageJsonText(dir, "packages/pkg2")).toBe(pkg2Text);
  const { workspaces } = await lock(dir);
  expect(workspaces["packages/pkg1"].dependencies).toStrictEqual({ "no-deps": "^1.0.0" });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "`bun update <name>` from the root still rejects a name only members declare after one was widened",
  async () => {
    const { dir, rootText, pkg2Text } = await widenedPkg1();
    const lockBefore = await lockText(dir);
    const { stdout, stderr, exitCode } = await run(dir, "update", "no-deps");
    expectHeaderOnly(stdout, "update");
    expect(stderr).toContain(NOT_A_DEPENDENCY_HERE("no-deps", "pkg1", "pkg2"));
    expect(stderr).not.toContain("note:");
    expect(await packageJsonText(dir)).toBe(rootText);
    expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", { "no-deps": "^1.0.0" }));
    expect(await packageJsonText(dir, "packages/pkg2")).toBe(pkg2Text);
    expect(await lockText(dir)).toBe(lockBefore);
    expect(exitCode).toBe(1);
  },
);

// `a` selects every offered row and `\r` confirms; EOF confirms too, so "" answers an empty picker.
async function runInteractive(dir: string, keys: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "update", "-i", ...args],
    cwd: dir,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(keys);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("`bun update -i --dev` only offers and updates devDependencies", async () => {
  const { dir } = await staleSiblings(DEV_A_DEP);
  const { stdout, stderr, exitCode } = await runInteractive(dir, "a\r", "--dev");
  expectPicked(stdout, installed(1), A_DEP_ROW);
  expect(stdout).not.toContain("no-deps");
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(grouped({ "no-deps": "^1.0.0", "a-dep": "^1.0.10" }, DEV_A_DEP));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  expect(await installedVersion(dir, "a-dep")).toBe("1.0.10");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

// A confirmed picker answers with the same rows and count line as the plain command would; the picker itself is drawn above them.
function expectPicked(stdout: string, countLine: string, ...rows: string[]) {
  expect(movedRows(stdout)).toStrictEqual(rows);
  expect(normalize(stdout)).toContain(`\n${countLine}\n`);
}

function expectInteractiveDryRun(stdout: string, ...rows: string[]) {
  expectPicked(stdout, wouldUpdate(rows.length), ...rows);
  expect(stdout).not.toContain("Would update");
}

test.concurrent("`bun update -i --prod --dry-run` lists only dependencies", async () => {
  const { dir } = await staleSiblings(DEV_A_DEP);
  const before = await lockText(dir);
  const { stdout, exitCode } = await runInteractive(dir, "a\r", "--prod", "--dry-run");
  expectInteractiveDryRun(stdout, NO_DEPS_ROW);
  expect(stdout).not.toContain("a-dep");
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update -i --no-optional --dry-run` skips optionalDependencies", async () => {
  const { dir } = await staleSiblings({ "a-dep": "optionalDependencies" });
  const { stdout, exitCode } = await runInteractive(dir, "a\r", "--no-optional", "--dry-run");
  expectInteractiveDryRun(stdout, NO_DEPS_ROW);
  expect(stdout).not.toContain("a-dep");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "`bun update -i` with a selector that matches nothing prints the same no-op line as `bun update`",
  async () => {
    const dir = await setup({ "package.json": pkgJson({ "no-deps": "^1.0.0" }) });
    const before = await lockText(dir);
    const { stdout, exitCode } = await runInteractive(dir, "", "--dev");
    expect(normalize(stdout)).toContain(`\n${noneSelected(1, "selected by --dev")}\n`);
    expect(stdout).not.toContain("No packages to update");
    expect(stdout).not.toContain("no-deps");
    expect(await lockText(dir)).toBe(before);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("`bun update -i` without a selector still offers every group", async () => {
  const { dir } = await staleSiblings(DEV_A_DEP);
  const { stdout, exitCode } = await runInteractive(dir, "a\r", "--dry-run");
  expectInteractiveDryRun(stdout, A_DEP_ROW, NO_DEPS_ROW);
  expect(exitCode).toBe(0);
});

// Rows are offered sorted by name: a-dep, then no-deps; one-range-dep's edge keeps no-deps@1.0.0 in the picture as a transitive row too.
async function staleSiblingsWithTransitive() {
  const dir = await setup({
    "package.json": pkgJson({ "no-deps": "1.0.0", "a-dep": "1.0.1", "one-range-dep": "1.0.0" }),
  });
  await reinstall(dir, pkgJson({ "no-deps": "^1.0.0", "a-dep": "^1.0.1", "one-range-dep": "1.0.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  return dir;
}

test.concurrent("`bun update -i` installs only the selected entries, as `bun update <selected>`", async () => {
  const dir = await staleSiblingsWithTransitive();
  const { stdout, stderr, exitCode } = await runInteractive(dir, " \r");
  expectPicked(stdout, installed(1), A_DEP_ROW);
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(
    pkgJson({ "no-deps": "^1.0.0", "a-dep": "^1.0.10", "one-range-dep": "1.0.0" }),
  );
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  expect(await installedVersion(dir, "a-dep")).toBe("1.0.10");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

// Offered sorted by name: dep-with-tags (in range 1.0.1, latest 3.0.0), then no-deps (in range 1.1.0, latest 2.0.0).
test.concurrent("`bun update -i --latest` honours an entry toggled back to its in-range target", async () => {
  const dir = await setup({ "package.json": pkgJson({ "dep-with-tags": "1.0.0", "no-deps": "1.0.0" }) });
  await reinstall(dir, pkgJson({ "dep-with-tags": "^1.0.0", "no-deps": "^1.0.0" }));
  expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  const { stdout, stderr, exitCode } = await runInteractive(dir, "lj \r", "--latest");
  expectPicked(
    stdout,
    installed(2),
    movedRow("dep-with-tags", "1.0.0", "1.0.1"),
    movedRow("no-deps", "1.0.0", "2.0.0"),
  );
  expectCleanStderr(stderr);
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "dep-with-tags": "^1.0.1", "no-deps": "^2.0.0" }));
  expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["1.0.1"]);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
  expect(await installedVersion(dir, "dep-with-tags")).toBe("1.0.1");
  expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});
