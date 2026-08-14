import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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

async function setup(files: Record<string, Json>, layout: Layout = {}) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: layout.text ?? true, linker: layout.linker ?? "hoisted" },
    files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, stringify(json)])),
  });
  await install(packageDir, ...linkerArgs(layout));
  return packageDir;
}

async function reinstall(dir: string, packageJson: Json, layout: Layout = {}, rel = "") {
  await write(join(dir, rel, "package.json"), stringify(packageJson));
  expect(await install(dir, ...linkerArgs(layout))).toContain("Saved lockfile");
}

const packageJsonOf = (dir: string, rel = ""): Promise<Json> => file(join(dir, rel, "package.json")).json();
const packageJsonText = (dir: string, rel = "") => file(join(dir, rel, "package.json")).text();
const lockText = (dir: string) => file(join(dir, "bun.lock")).text();
const lock = async (dir: string): Promise<Json> => Bun.JSONC.parse(await lockText(dir)) as Json;

// Every version of `name` resolved anywhere in bun.lock, rows installed under an alias included.
async function lockedVersions(dir: string, name: string) {
  const { packages } = await lock(dir);
  const versions = Object.values(packages as Record<string, [string]>)
    .map(([resolution]) => resolution)
    .filter(resolution => resolution.startsWith(`${name}@`))
    .map(resolution => resolution.slice(name.length + 1));
  return [...new Set(versions)].sort();
}

async function installedVersion(dir: string, ...segments: string[]) {
  return (await file(join(dir, "node_modules", ...segments, "package.json")).json()).version;
}

const noDepsPath = (linker: Linker = "hoisted") =>
  linker === "isolated" ? [".bun", "one-range-dep@1.0.0", "node_modules", "no-deps"] : ["no-deps"];

// Dropping the root's exact no-deps@1.0.0 leaves one-range-dep's `^1.0.0` edge on 1.0.0, which `bun install` never moves.
async function stale(layout: Layout = {}) {
  const dir = await setup({ "package.json": pkgJson({ "one-range-dep": "1.0.0", "no-deps": "1.0.0" }) }, layout);
  const packageJson = pkgJson({ "one-range-dep": "1.0.0" });
  await reinstall(dir, packageJson, layout);
  const noDeps = noDepsPath(layout.linker);
  if (layout.text ?? true) {
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  }
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
  return { dir, packageJson, noDeps };
}

async function expectTransitiveBump(
  { dir, packageJson, noDeps }: Awaited<ReturnType<typeof stale>>,
  layout: Layout,
  ...args: string[]
) {
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args, ...linkerArgs(layout));
  expect(stderr).not.toContain("error:");
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
  const dir = await setup({ "package.json": grouped({ "no-deps": "1.0.0", "a-dep": "1.0.1" }, groups) });
  const packageJson = grouped({ "no-deps": "^1.0.0", "a-dep": "^1.0.1" }, groups);
  await reinstall(dir, packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  return { dir, packageJson, groups };
}

async function expectOnlyADepMoved({ dir, groups }: Awaited<ReturnType<typeof staleSiblings>>, ...args: string[]) {
  const { stderr, exitCode } = await run(dir, "update", ...args);
  expect(stderr).not.toContain("error:");
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
  expect(stderr).toContain(message);
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
  expect(await lockText(dir)).toBe(lockBefore);
  expect(exitCode).toBe(1);
  return { stdout, stderr };
}

async function expectNothingToUpdate(dir: string, ...args: string[]) {
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expect(stdout).toContain("No packages to update");
  expect(stderr).not.toContain("error:");
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
}

const ROOT = { name: "root", workspaces: ["packages/*"] };
const member = (name: string, dependencies: Json = {}) => ({ name, version: "1.0.0", dependencies });

test.concurrent.each<[string, Layout]>([
  ["text lockfile", { text: true }],
  ["binary lockfile", { text: false }],
  ["text lockfile + isolated linker", { text: true, linker: "isolated" }],
])("`bun update` moves a transitive dependency within its dependent's range (%s)", async (_, layout) => {
  const fixture = await stale(layout);
  const stdout = await expectTransitiveBump(fixture, layout);
  expect(normalizeBunSnapshot(stdout.split("\n").slice(0, 3).join("\n"))).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)
    updating:
      no-deps@1.0.0 → 1.1.0"
  `);
});

test.concurrent("`bun update --latest` still moves transitive dependencies only within their ranges", async () => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, "--latest");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
});

test.concurrent("`bun update <name>` reaches a package that is only a transitive dependency", async () => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, "no-deps");
  expect(stdout).not.toContain("updating:");
});

test.concurrent.each([
  ["a pattern", ["no-*"]],
  ["a pattern alongside a direct name", ["no-d*", "one-range-dep"]],
])("`bun update` with %s reaches a package that is only a transitive dependency", async (_, args) => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, ...args);
  expect(stdout).not.toContain("updating:");
});

test.concurrent("`bun update <name>` naming a package with nothing newer changes nothing", async () => {
  const { dir, packageJson } = await stale();
  const before = await lock(dir);
  const { stderr, exitCode } = await run(dir, "update", "one-range-dep");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lock(dir)).toStrictEqual(before);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update <name>` rejects a name that is not in the lockfile", async () => {
  const { dir, packageJson } = await stale();
  const before = await lockText(dir);
  const { stderr, exitCode } = await run(dir, "update", "does-not-exist");
  expect(stderr).toContain('error: "does-not-exist" is not in the lockfile, so there is nothing to update');
  expect(stderr).toContain("bun add");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(1);
});

test.concurrent("`bun update --dry-run` prints the transitive plan and writes nothing", async () => {
  const { dir, packageJson, noDeps } = await stale();
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stdout).toContain("Would update 1 package");
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
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
    expect(stdout).toContain("  a-dep@1.0.1 → 1.0.10\n");
    expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
    expect(stdout.match(/^  \S+@\S+ → /gm)).toHaveLength(2);
    expect(stdout).toContain("Would update 2 packages");
    expect(stderr).not.toContain("error:");
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
  const { stderr, exitCode } = await run(dir, "update");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(packageJson.dependencies);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("a transitive dependency pinned exactly by its dependent stays put", async () => {
  const dir = await setup({ "package.json": pkgJson({ "one-fixed-dep": "1.0.0" }) });
  const before = await lock(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
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
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stderr).not.toContain("error:");
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

test.concurrent("an override holds a transitive dependency back", async () => {
  const { dir } = await stale();
  const packageJson = pkgJson({ "one-range-dep": "1.0.0" }, { overrides: { "no-deps": "1.0.0" } });
  await reinstall(dir, packageJson);
  const before = await lock(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await lock(dir)).toStrictEqual(before);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

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
    expect(stdout).toContain(`  no-deps@1.0.0 → ${to}\n`);
    expect(stdout.match(/^  no-deps@/gm)).toHaveLength(1);
    expect(stderr).not.toContain("error:");
    expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
    expect((await lock(dir)).overrides).toStrictEqual(overrides);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual([to]);
    expect(await installedVersion(dir, "no-deps")).toBe(to);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "the plan reports the target an override added since bun.lock was written actually allows",
  async () => {
    const { dir } = await stale();
    const packageJson = pkgJson({ "one-range-dep": "1.0.0" }, { overrides: { "no-deps": "1.0.1" } });
    await write(join(dir, "package.json"), stringify(packageJson));
    const { stdout, stderr, exitCode } = await run(dir, "update");
    expect(stdout).toContain("  no-deps@1.0.0 → 1.0.1\n");
    expect(stdout).not.toContain("→ 1.1.0");
    expect(stderr).not.toContain("error:");
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
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await lock(dir)).toStrictEqual(before);
  expect(exitCode).toBe(0);
});

test.concurrent("without a lockfile `bun update` resolves everything fresh", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
    files: { "package.json": stringify(pkgJson({ "one-range-dep": "1.0.0" })) },
  });
  const { stdout, stderr, exitCode } = await run(packageDir, "update");
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(stderr).toContain("Saved lockfile");
  expect(await lockedVersions(packageDir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

// The `stale()` recipe applied inside pkg1; pkg2, when present, pins no-deps@1.0.0 too and is widened to `pkg2Range`.
async function staleMemberTransitive(pkg2Range?: string) {
  const dir = await setup({
    "package.json": ROOT,
    "packages/pkg1/package.json": member("pkg1", { "one-range-dep": "1.0.0", "no-deps": "1.0.0" }),
    ...(pkg2Range ? { "packages/pkg2/package.json": member("pkg2", { "no-deps": "1.0.0" }) } : {}),
  });
  if (pkg2Range) {
    await write(join(dir, "packages/pkg2/package.json"), stringify(member("pkg2", { "no-deps": pkg2Range })));
  }
  const pkg1 = member("pkg1", { "one-range-dep": "1.0.0" });
  await reinstall(dir, pkg1, {}, "packages/pkg1");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  return { dir, pkg1 };
}

test.concurrent("in a workspace, `bun update` from the root moves a member's transitive dependency", async () => {
  const { dir, pkg1 } = await staleMemberTransitive();
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stderr).not.toContain("error:");
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
  const { stderr, exitCode } = await runIn(dir, cwd, "update", "no-deps");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(ROOT);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(pkg1);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

const MEMBER_FILES = ["", "packages/pkg1", "packages/pkg2"];

// The root's exact no-deps pin parks every member's transitive `^1.0.0` edge on 1.0.0; dropping it (and widening pkg1 to `pkg1After`) leaves everything where it was locked.
async function staleMemberEdges(pkg1: Json, pkg2: Json, pkg1After: Json = pkg1) {
  const dir = await setup({
    "package.json": { ...ROOT, dependencies: { "no-deps": "1.0.0" } },
    "packages/pkg1/package.json": member("pkg1", pkg1),
    "packages/pkg2/package.json": member("pkg2", pkg2),
  });
  await write(join(dir, "packages/pkg1/package.json"), stringify(member("pkg1", pkg1After)));
  await reinstall(dir, ROOT);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  const texts = () => Promise.all(MEMBER_FILES.map(rel => packageJsonText(dir, rel)));
  return { dir, texts, textsBefore: await texts(), lockBefore: await lockText(dir) };
}

// The no-deps version each dependent's edge resolves to: its nested row when it lost the hoisting race, else the hoisted one.
async function noDepsEdges(dir: string, ...dependents: string[]) {
  const { packages } = await lock(dir);
  const versionOf = (key: string) => (packages[key] as [string] | undefined)?.[0].slice("no-deps@".length);
  return Object.fromEntries(
    dependents.map(dependent => [dependent, versionOf(`${dependent}/no-deps`) ?? versionOf("no-deps")]),
  );
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
    expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
    expect(stdout.match(/^  \S+@\S+ → /gm)).toHaveLength(1);
    expect(stderr).not.toContain("error:");
    expect(await noDepsEdges(dir, "one-range-dep", "one-range-dep-too")).toStrictEqual({
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
    expect(stdout).not.toContain("updating:");
    expect(stderr).not.toContain("error:");
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    expect(await texts()).toStrictEqual([rootBefore, PKG1_A_DEP_MOVED, pkg2Before]);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

// Every workspace's transitive rows are planned from the root; a member's own entries only move with -r.
test.concurrent.each<[string, string[], boolean]>([
  ["from the root", [], false],
  ["with -r", ["-r"], true],
])(
  "in a workspace, a bare `bun update` %s moves the transitive rows only a member reaches",
  async (_, args, movesMemberEntries) => {
    const { dir, texts, textsBefore } = await disjointEdges();
    const [rootBefore, pkg1Before, pkg2Before] = textsBefore;
    const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
    expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
    expect(stderr).not.toContain("error:");
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual([movesMemberEntries ? "1.0.10" : "1.0.1"]);
    expect(await texts()).toStrictEqual([rootBefore, movesMemberEntries ? PKG1_A_DEP_MOVED : pkg1Before, pkg2Before]);
    await frozen(dir);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.each([
  ["from packages/pkg1", "packages/pkg1", []],
  ["with --filter pkg1", "", ["--filter", "pkg1"]],
])(
  "in a workspace, `bun update <name>` %s naming a package only another workspace reaches is an error",
  async (_, cwd, args) => {
    const { dir, texts, textsBefore, lockBefore } = await disjointEdges();
    const { stderr, exitCode } = await runIn(dir, cwd, "update", ...args, "no-deps");
    expect(stderr).toContain(
      'error: "no-deps" is only a dependency of other workspaces, so there is nothing to update here',
    );
    expect(await lockText(dir)).toBe(lockBefore);
    expect(await texts()).toStrictEqual(textsBefore);
    expect(exitCode).toBe(1);
  },
);

test.concurrent.each([
  ["from packages/pkg2", "packages/pkg2", []],
  ["with --filter pkg2", "", ["--filter", "pkg2"]],
])(
  "in a workspace, `bun update <name>` %s moves a package that workspace reaches transitively",
  async (_, cwd, args) => {
    const { dir, texts, textsBefore } = await disjointEdges();
    const { stderr, exitCode } = await runIn(dir, cwd, "update", ...args, "no-deps");
    expect(stderr).not.toContain("error:");
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
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

  const { stderr, exitCode } = await run(dir, "update", "--latest");
  expect(stderr).not.toContain("error:");
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

    const { stderr, exitCode } = await run(dir, "update", "--latest");
    expect(stderr).not.toContain("error:");
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
  expect(exitCode).toBe(0);
});

test.concurrent("`bun up` is `bun update`", async () => {
  const { dir, packageJson } = await stale();
  const { stdout, stderr, exitCode } = await run(dir, "up");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("`-L` is `--latest`", async () => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "~1.0.0" }) });
  const { stderr, exitCode } = await run(dir, "update", "-L");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "~2.0.0" }));
  expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --silent` prints no plan but still moves the transitive dependency", async () => {
  const { dir, packageJson, noDeps } = await stale();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--silent");
  expect(stdout).toBe("");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  await frozen(dir);
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
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
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
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockText(dir)).toBe(before);
  await frozen(dir);
  expect(exitCode).toBe(0);
}

// hoist-lockfile-{1,2,3} depend on hoist-lockfile-shared (1.0.1 / 1.0.2 / 2.0.1 / 2.0.2) as `*` / `^1.0.1` / `>=1.0.1`.
const HOIST_DEPENDENTS = { "hoist-lockfile-1": "1.0.0", "hoist-lockfile-2": "1.0.0", "hoist-lockfile-3": "1.0.0" };

async function staleShared() {
  const dir = await setup({ "package.json": pkgJson({ ...HOIST_DEPENDENTS, "hoist-lockfile-shared": "1.0.1" }) });
  const packageJson = pkgJson(HOIST_DEPENDENTS);
  await reinstall(dir, packageJson);
  expect(await lockedVersions(dir, "hoist-lockfile-shared")).toStrictEqual(["1.0.1"]);
  return { dir, packageJson };
}

test.concurrent.each([
  ["bare", []],
  ["named", ["hoist-lockfile-shared"]],
  ["named with an ignored @version", ["hoist-lockfile-shared@1.0.1"]],
])("every dependent's range on a shared package is re-resolved on its own (%s)", async (_, args) => {
  const { dir, packageJson } = await staleShared();
  const { stderr, exitCode } = await run(dir, "update", ...args);
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(HOIST_DEPENDENTS);
  expect(await lockedVersions(dir, "hoist-lockfile-shared")).toStrictEqual(["1.0.2", "2.0.2"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("the plan counts packages, not the edges that move onto them", async () => {
  const { dir } = await staleShared();
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run");
  expect(stdout).toContain("  hoist-lockfile-shared@1.0.1 → 1.0.2\n");
  expect(stdout).toContain("  hoist-lockfile-shared@1.0.1 → 2.0.2\n");
  expect(stdout.match(/^  hoist-lockfile-shared@/gm)).toHaveLength(2);
  expect(stdout).toContain("Would update 2 packages");
  expect(stderr).not.toContain("error:");
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
  await expectNoop(dir, ...args);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
});

// peer-deps@1.0.0 has nothing but a `no-deps: *` peer, which the install auto-installs at latest.
test.concurrent("a package with only peer dependencies is a clean no-op", async () => {
  const dir = await setup({ "package.json": pkgJson({ "peer-deps": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
  await expectNoop(dir);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
});

// dep-loop-entry@1.0.0 and dep-loop-exit@1.0.0 pin each other; bundled-1@1.0.0 ships its own no-deps@1.0.0.
test.concurrent.each([
  ["bare", []],
  ["no-deps", ["no-deps"]],
  ["dep-loop-exit", ["dep-loop-exit"]],
])("a dependency cycle and a bundled dependency are left alone (%s)", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "dep-loop-entry": "1.0.0", "bundled-1": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  await expectNoop(dir, ...args);
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
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
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
  const { stderr, exitCode } = await runIn(dir, "packages/pkg1", "update");
  expect(stderr).not.toContain("error:");
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
async function serveRegistry(manifests: Manifests, tags: Tags = {}) {
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
      if (!entry) return new Response("not found", { status: 404 });
      const versions: Json = {};
      for (const [version, extra] of Object.entries(entry)) {
        versions[version] = { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` }, ...extra };
      }
      const latest = Object.keys(entry).sort(Bun.semver.order).at(-1);
      return Response.json({ name, versions, "dist-tags": { latest, ...tags[name] } });
    },
  });
}

// Installs `pinned` against the in-memory registry, then re-installs `packageJson`, which drops the pins that parked the transitive edges.
async function setupServed(server: Bun.Server, prefix: string, pinned: Json, packageJson: Json = pinned) {
  const dir = String(tempDir(prefix, { "package.json": stringify(pinned) }));
  await write(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: join(dir, ".bun-cache"), registry: server.url.href, saveTextLockfile: true, linker: "hoisted" },
    }),
  );
  await install(dir);
  if (packageJson !== pinned) await reinstall(dir, packageJson);
  return dir;
}

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
  expect(named.stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ parent: "^1.1.0" }));
  expect(await lockedVersions(dir, "parent")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "parent")).toBe("1.1.0");
  expect(await installedVersion(dir, "leaf")).toBe("1.0.0");
  await frozen(dir);
  expect(named.exitCode).toBe(0);

  const bare = await run(dir, "update");
  expect(bare.stdout).toContain("  leaf@1.0.0 → 1.1.0\n");
  expect(bare.stderr).not.toContain("error:");
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
  expect(stdout).not.toContain("→");
  expect(stderr).not.toContain("error:");
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
    expect(stdout).not.toContain("other-leaf@");
    expect(stderr).not.toContain("error:");
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
  expect(stdout).toContain(`  leaf@${from} → ${to}\n`);
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual([to]);
  expect(await lockText(dir)).toContain('"leaf": "stable"');
  expect(await installedVersion(dir, "leaf")).toBe(to);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update <name>` from a member leaves a sibling's own entry alone but lets it follow", async () => {
  const { dir, pkg2Text } = await staleMembers("~1.0.0", "^1.0.0");
  const { stderr, exitCode } = await runIn(dir, "packages/pkg1", "update", "no-deps");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", { "no-deps": "~1.0.1" }));
  expect(await packageJsonText(dir, "packages/pkg2")).toBe(pkg2Text);
  expect((await lock(dir)).workspaces["packages/pkg2"].dependencies).toStrictEqual({ "no-deps": "^1.0.0" });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
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
  expect(fromRoot.stderr).not.toContain("error:");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "2.0.0"]);
  expect(await packageJsonText(dir)).toBe(rootText);
  expect(await packageJsonText(dir, "packages/pkg1")).toBe(pkg1Text);
  expect(fromRoot.exitCode).toBe(0);

  const fromMember = await runIn(dir, "packages/pkg1", "update", "no-deps");
  expect(fromMember.stderr).not.toContain("error:");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0", "2.0.0"]);
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
  const { stderr, exitCode } = await runIn(dir, "packages/pkg1", "update", "no-deps");
  expect(stderr).toContain(
    'error: "no-deps" is only a dependency of other workspaces, so there is nothing to update here',
  );
  expect(stderr).toContain("bun update -r no-deps");
  expect(await lockText(dir)).toBe(lockBefore);
  expect(await packageJsonText(dir)).toBe(rootText);
  expect(exitCode).toBe(1);
});

async function staleScoped() {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "1.0.0", "@types/no-deps": "^1.0.0" }) });
  await reinstall(dir, pkgJson({ "no-deps": "^1.0.0", "@types/no-deps": "^1.0.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "@types/no-deps")).toStrictEqual(["1.0.0"]);
  return dir;
}

test.concurrent("a scoped glob selects only the matching names", async () => {
  const dir = await staleScoped();
  const { stderr, exitCode } = await run(dir, "update", "--latest", "@types/*");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "no-deps": "^1.0.0", "@types/no-deps": "^2.0.0" }));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "@types/no-deps")).toStrictEqual(["2.0.0"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("a bare `*` names everything, scoped names included", async () => {
  const dir = await staleScoped();
  const { stderr, exitCode } = await run(dir, "update", "--latest", "*");
  expect(stderr).not.toContain("error:");
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

test.concurrent("a pattern that matches nothing is an error", async () => {
  const { dir } = await staleSiblings();
  await expectRejected(dir, 'error: no packages in bun.lock match "zzz-*"', "zzz-*");
});

test.concurrent("a version cannot be combined with a pattern", async () => {
  const dir = await staleScoped();
  await expectRejected(dir, "a version cannot be combined with a pattern: @types/*@2", "@types/*@2");
});

test.concurrent("excluding every package is a no-op", async () => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "^1.0.0" }) });
  await expectNothingToUpdate(dir, "!no-deps");
});

test.concurrent("patterns need a lockfile", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
    files: { "package.json": stringify(pkgJson({ "no-deps": "^1.0.0" })) },
  });
  const { stderr, exitCode } = await run(packageDir, "update", "no-*");
  expect(stderr).toContain("missing lockfile, nothing to update");
  expect(exitCode).toBe(1);
});

test.concurrent("several names in one command are matched independently, aliases through their real name", async () => {
  const dir = await setup({
    "package.json": pkgJson({ "a-dep": "1.0.1", aliased: "npm:no-deps@1.0.0", "one-range-dep": "1.0.0" }),
  });
  await reinstall(dir, pkgJson({ "a-dep": "^1.0.1", aliased: "npm:no-deps@~1.0.0", "one-range-dep": "1.0.0" }));
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);

  const { stderr, exitCode } = await run(dir, "update", "a-dep", "no-deps");
  expect(stderr).not.toContain("error:");
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
    const { stderr, exitCode } = await run(dir, "update", flag);
    expect(stderr).not.toContain("error:");
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
  const { stderr, exitCode } = await run(dir, "update", "--prod");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(grouped({ "no-deps": "^1.1.0", "a-dep": "^1.0.10" }, groups));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --no-optional` leaves optionalDependencies alone", async () => {
  const groups: Groups = { "a-dep": "optionalDependencies" };
  const { dir } = await staleSiblings(groups);
  const { stderr, exitCode } = await run(dir, "update", "--no-optional");
  expect(stderr).not.toContain("error:");
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

test.concurrent("a selector matching nothing is a no-op", async () => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "^1.0.0" }) });
  await expectNothingToUpdate(dir, "--dev");
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
  const { stderr, exitCode } = await runInteractive(dir, "a\r", "--dev");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(grouped({ "no-deps": "^1.0.0", "a-dep": "^1.0.10" }, DEV_A_DEP));
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
  await frozen(dir);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update -i --prod --dry-run` lists only dependencies", async () => {
  const { dir } = await staleSiblings(DEV_A_DEP);
  const before = await lockText(dir);
  const { stdout, exitCode } = await runInteractive(dir, "a\r", "--prod", "--dry-run");
  expect(stdout).toContain("Would update no-deps to 1.1.0");
  expect(stdout).not.toContain("a-dep");
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update -i --no-optional --dry-run` skips optionalDependencies", async () => {
  const { dir } = await staleSiblings({ "a-dep": "optionalDependencies" });
  const { stdout, exitCode } = await runInteractive(dir, "a\r", "--no-optional", "--dry-run");
  expect(stdout).toContain("Would update no-deps to 1.1.0");
  expect(stdout).not.toContain("a-dep");
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update -i` with a selector that matches nothing prints No packages to update", async () => {
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "^1.0.0" }) });
  const before = await lockText(dir);
  const { stdout, exitCode } = await runInteractive(dir, "", "--dev");
  expect(stdout).toContain("No packages to update");
  expect(stdout).not.toContain("no-deps");
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update -i` without a selector still offers every group", async () => {
  const { dir } = await staleSiblings(DEV_A_DEP);
  const { stdout, exitCode } = await runInteractive(dir, "a\r", "--dry-run");
  expect(stdout).toContain("Would update no-deps to 1.1.0");
  expect(stdout).toContain("Would update a-dep to 1.0.10");
  expect(exitCode).toBe(0);
});
