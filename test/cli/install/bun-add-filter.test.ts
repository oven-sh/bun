import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, exists, mkdir, rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

const ROOT = { name: "root", workspaces: ["packages/*"] };
const API = { name: "api" };
const WEB = { name: "web", dependencies: { "a-dep": "1.0.1" } };
const PKG_A = { name: "pkg-a" };
const PKG_B = { name: "pkg-b" };

// Workspace edges web -> api -> pkg-a; pkg-b is isolated.
const GRAPH = {
  api: { name: "api", dependencies: { "pkg-a": "workspace:*" } },
  web: { name: "web", dependencies: { api: "workspace:*" } },
};

type Workspace = "root" | "api" | "web" | "pkg-a" | "pkg-b";

type Linker = "hoisted" | "isolated";

// A string value is written verbatim, so a test can detect a rewrite that would otherwise be byte-identical.
async function makeMonorepo(extra: Partial<Record<Workspace, object | string>> = {}, linker: Linker = "hoisted") {
  const text = (value: object | string) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const { packageDir } = await registry.createTestDir({
    files: {
      "package.json": text(extra.root ?? ROOT),
      "packages/api/package.json": text(extra.api ?? API),
      "packages/web/package.json": text(extra.web ?? WEB),
      "packages/pkg-a/package.json": text(extra["pkg-a"] ?? PKG_A),
      "packages/pkg-b/package.json": text(extra["pkg-b"] ?? PKG_B),
    },
    bunfigOpts: { linker },
  });
  return packageDir;
}

// CI exports BUN_INSTALL_CACHE_DIR (one per test file), which overrides the per-test-dir bunfig `cache`; concurrent cases racing on one cache fail on Windows.
function envFor(dir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") };
}

// These two lines, and the count in the second one, only say what a run had to download, so stderr comes back without
// them and callers compare the rest exactly: `Saved lockfile` when bun.lock was written, nothing when it was not.
const PROGRESS_LINES = /^(?:Resolving dependencies|Resolved, downloaded and extracted \[\d+\])\n/gm;

// `--linker` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
async function run(args: string[], dir: string, opts: { linker?: Linker; cwd?: string } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, ...(opts.linker ? ["--linker", opts.linker] : [])],
    cwd: opts.cwd ?? dir,
    env: envFor(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: stderr.replace(PROGRESS_LINES, ""), exitCode };
}

const HEADER = (command: string) => `bun ${command} <version> (<revision>)`;

// Durations are stripped before normalizing so a leading `[12.00ms] done` keeps its own line (as ` done`).
function stdoutLines(stdout: string) {
  return normalizeBunSnapshot(stdout.replaceAll(/ ?\[[\d.]+ ?m?s\]/g, "")).split("\n");
}

function pkgPath(dir: string, workspace: Workspace) {
  return workspace === "root" ? join(dir, "package.json") : join(dir, "packages", workspace, "package.json");
}

function pkg(dir: string, workspace: Workspace) {
  return file(pkgPath(dir, workspace)).json();
}

function pkgText(dir: string, workspace: Workspace) {
  return file(pkgPath(dir, workspace)).text();
}

const WORKSPACES: Workspace[] = ["root", "api", "web", "pkg-a", "pkg-b"];

function allPackageJsons(dir: string) {
  return Promise.all(WORKSPACES.map(w => pkg(dir, w)));
}

function allPackageJsonTexts(dir: string) {
  return Promise.all(WORKSPACES.map(w => pkgText(dir, w)));
}

function lockfileJson(dir: string) {
  return file(join(dir, "bun.lock"))
    .text()
    .then(t => JSON.parse(t.replace(/,(\s*[}\]])/g, "$1")));
}

async function installOk(dir: string, linker?: Linker) {
  const { stderr, exitCode } = await run(["install"], dir, { linker });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);
}

/** A plain `bun install` afterwards (which also links whatever the filtered command left out) has nothing to save. */
async function installUnchanged(dir: string, linker?: Linker) {
  const { stderr, exitCode } = await run(["install"], dir, { linker });
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}

const LOCK_ENTRY_KEYS = [
  "name",
  "version",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** The `workspaces` row bun.lock keeps for a workspace: its name, version and dependency groups, nothing else. */
function lockEntryOf(json: Record<string, unknown>) {
  return Object.fromEntries(LOCK_ENTRY_KEYS.filter(key => key in json).map(key => [key, json[key]]));
}

const lockKey = (workspace: Workspace) => (workspace === "root" ? "" : `packages/${workspace}`);

/** `json` with `dep: range` added to (or replaced in) its dependencies. */
function plus(json: { name: string; dependencies?: Record<string, string> }, dep = "no-deps", range = "^2.0.0") {
  return { ...json, dependencies: { ...json.dependencies, [dep]: range } };
}

/** Every package.json (in WORKSPACES order) is `expected`, and the `workspaces` section of bun.lock is exactly their rows. */
async function expectWorkspaces(dir: string, expected: Record<string, unknown>[]) {
  expect(await allPackageJsons(dir)).toStrictEqual(expected);
  expect((await lockfileJson(dir)).workspaces).toStrictEqual(
    Object.fromEntries(WORKSPACES.map((workspace, i) => [lockKey(workspace), lockEntryOf(expected[i])])),
  );
}

/** The workspaces (in WORKSPACES order) whose package.json declares `dep` in any dependency group. */
async function declaring(dir: string, dep: string) {
  const jsons = await allPackageJsons(dir);
  return WORKSPACES.filter((_, i) =>
    ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].some(
      group => jsons[i][group]?.[dep] !== undefined,
    ),
  );
}

/**
 * `edited` gained `dep: range` in dependencies, every other workspace's package.json is byte-identical to `before`,
 * and bun.lock mirrors all of them.
 */
async function expectAddedOnlyTo(
  dir: string,
  before: string[],
  edited: Workspace[],
  dep = "no-deps",
  range = "^2.0.0",
) {
  expect(await declaring(dir, dep)).toStrictEqual(WORKSPACES.filter(w => edited.includes(w)));
  for (const [i, workspace] of WORKSPACES.entries()) {
    if (edited.includes(workspace)) {
      expect((await pkg(dir, workspace)).dependencies[dep]).toBe(range);
    } else {
      expect(await pkgText(dir, workspace)).toBe(before[i]);
    }
  }
  const { workspaces } = await lockfileJson(dir);
  expect(WORKSPACES.map(w => workspaces[lockKey(w)])).toStrictEqual((await allPackageJsons(dir)).map(lockEntryOf));
}

test.concurrent(
  'add --filter targets one workspace by name (and does not install an npm package called "api")',
  async () => {
    const dir = await makeMonorepo();

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir, { linker: "hoisted" });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);

    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
      name: "no-deps",
      version: "2.0.0",
    });
    // node_modules/api is the linked workspace, not a registry package
    expect(await file(join(dir, "node_modules", "api", "package.json")).json()).toStrictEqual({
      name: "api",
      dependencies: { "no-deps": "^2.0.0" },
    });
    const lockfile = await file(join(dir, "bun.lock")).text();
    expect(lockfile).toContain('"no-deps@2.0.0"');
    expect(lockfile).toContain('"api@workspace:packages/api"');
    expect(lockfile).not.toMatch(/"api@\d/);
  },
);

test.concurrent("-F alias with --dev and --exact", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "-F", "api", "-d", "-E"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toStrictEqual({ name: "api", devDependencies: { "a-dep": "1.0.10" } });
    expect(await pkg(dir, "root")).toStrictEqual(ROOT);
    expect(await pkg(dir, "web")).toStrictEqual(WEB);
  }

  // Same as unfiltered `bun add -d`: an entry that already exists in another list is updated in place.
  {
    const { stderr, exitCode } = await run(["add", "a-dep", "-F", "web", "-d", "-E"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "web")).toStrictEqual({ name: "web", dependencies: { "a-dep": "1.0.10" } });
    expect(await pkg(dir, "api")).toStrictEqual({ name: "api", devDependencies: { "a-dep": "1.0.10" } });
    expect(await pkg(dir, "root")).toStrictEqual(ROOT);
  }
});

test.concurrent("bun install <pkg> --filter carries the filter through", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["install", "no-deps", "--filter", "api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
});

test.concurrent("glob filter edits every match", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "pkg-*"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, WEB, plus(PKG_A), plus(PKG_B)]);
});

test.concurrent("'*' edits every workspace except the root; '!' excludes", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const rootBefore = await pkgText(dir, "root");

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*", "--filter", "!api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, plus(WEB), plus(PKG_A), plus(PKG_B)]);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
});

test.concurrent("a negation-only filter set skips the root", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const [rootBefore, apiBefore] = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "!api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, plus(WEB), plus(PKG_A), plus(PKG_B)]);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(await pkgText(dir, "api")).toBe(apiBefore);
});

test.concurrent("every member negated: zero targets is an error, the root is not silently edited", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, dependencies: { "no-deps": "^2.0.0" } } });
  await installOk(dir, "hoisted");
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  {
    const { stderr, exitCode } = await run(
      ["add", "a-dep", "--filter", "!api", "--filter", "!web", "--filter", "!pkg-*"],
      dir,
    );
    expect(stderr).toBe('error: No workspace packages matched the filters "!api", "!web", "!pkg-*"\n');
    expect(exitCode).toBe(1);
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "!./packages/*"], dir);
    expect(stderr).toBe('error: No workspace packages matched the filter "!./packages/*"\n');
    expect(exitCode).toBe(1);
  }

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("the root is included by naming it next to '*'", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const rootBefore = await pkgText(dir, "root");

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "*"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, ...[API, WEB, PKG_A, PKG_B].map(json => plus(json, "a-dep", "^1.0.10"))]);
    expect(await pkgText(dir, "root")).toBe(rootBefore);
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*", "--filter", "root"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [
      plus(ROOT),
      ...[API, WEB, PKG_A, PKG_B].map(json => plus(plus(json, "a-dep", "^1.0.10"))),
    ]);
  }
});

test.concurrent("'{.}' from the root selects the root and every workspace", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{.}"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [plus(ROOT), plus(API), plus(WEB), plus(PKG_A), plus(PKG_B)]);
});

test.concurrent("'{dir}' selects every workspace under the directory", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const rootBefore = await pkgText(dir, "root");

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{packages}"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, plus(API), plus(WEB), plus(PKG_A), plus(PKG_B)]);
    expect(await pkgText(dir, "root")).toBe(rootBefore);
  }

  // The braces resolve against the invoking directory.
  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "{..}"], dir, {
      cwd: join(dir, "packages", "web"),
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, ...[API, WEB, PKG_A, PKG_B].map(json => plus(plus(json), "a-dep", "^1.0.10"))]);
    expect(await pkgText(dir, "root")).toBe(rootBefore);
  }
});

test.concurrent("'{dir}' naming one workspace directory selects just it; '!{dir}' excludes the subtree", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{./packages/pkg-a}"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);
    await expectAddedOnlyTo(dir, before, ["pkg-a"]);
  }

  {
    const after = await allPackageJsonTexts(dir);
    const lockAfter = await file(join(dir, "bun.lock")).text();
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "*", "--filter", "!{./packages}"], dir);
    expect(stderr).toBe('error: No workspace packages matched the filters "*", "!{./packages}"\n');
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toStrictEqual(after);
    expect(await file(join(dir, "bun.lock")).text()).toBe(lockAfter);
  }
});

test.concurrent("a '{dir}' matching nothing is the usual no-match error", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{./tools}"], dir);
  expect(stderr).toBe('error: No workspace packages matched the filter "{./tools}"\n');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
});

test.concurrent.each<[string, Workspace[]]>([
  ["api...", ["api", "pkg-a"]],
  ["api^...", ["pkg-a"]],
  ["...api", ["api", "web"]],
  ["...^api", ["web"]],
  ["...api...", ["api", "web", "pkg-a"]],
  ["...{./packages/pkg-a}", ["api", "web", "pkg-a"]],
])("relation selector '%s' edits %p", async (pattern, edited) => {
  const dir = await makeMonorepo(GRAPH);
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", pattern], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, edited);
});

test.concurrent("a negated relation subtracts the whole closure", async () => {
  {
    const dir = await makeMonorepo(GRAPH);
    await installOk(dir);
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*", "--filter", "!...api"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["pkg-a", "pkg-b"]);
  }

  // Negation-only: everything except the closure, and (for add) except the root.
  {
    const dir = await makeMonorepo(GRAPH);
    await installOk(dir);
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "!...api"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["pkg-a", "pkg-b"]);
  }
});

test.concurrent("two relation selectors union", async () => {
  const dir = await makeMonorepo(GRAPH);
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api...", "--filter", "...api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api", "web", "pkg-a"]);
});

test.concurrent(
  "dependents are found through devDependencies and plain-range edges; the root stays out of add",
  async () => {
    const dir = await makeMonorepo({
      root: { ...ROOT, dependencies: { api: "workspace:*" } },
      api: { name: "api", version: "1.0.0" },
      web: { name: "web", devDependencies: { api: "1.0.0" } },
    });
    await installOk(dir);
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...api"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["api", "web"]);
    expect((await lockfileJson(dir)).workspaces[""].dependencies).toStrictEqual({ api: "workspace:*" });
  },
);

test.concurrent("relation selectors terminate on a workspace dependency cycle", async () => {
  const files = {
    "package.json": JSON.stringify(ROOT),
    "packages/x/package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { y: "workspace:*" } }),
    "packages/y/package.json": JSON.stringify({ name: "y", version: "1.0.0", dependencies: { x: "workspace:*" } }),
    "packages/z/package.json": JSON.stringify({ name: "z", version: "1.0.0" }),
  };
  const read = (dir: string, name: string) =>
    file(name === "root" ? join(dir, "package.json") : join(dir, "packages", name, "package.json"));

  {
    const { packageDir: dir } = await registry.createTestDir({ files });
    await installOk(dir);
    const [rootBefore, zBefore] = await Promise.all([read(dir, "root").text(), read(dir, "z").text()]);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "x..."], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect((await read(dir, "x").json()).dependencies).toStrictEqual({ y: "workspace:*", "no-deps": "^2.0.0" });
    expect((await read(dir, "y").json()).dependencies).toStrictEqual({ x: "workspace:*", "no-deps": "^2.0.0" });
    expect(await read(dir, "z").text()).toBe(zBefore);
    expect(await read(dir, "root").text()).toBe(rootBefore);
  }

  // x is reached again through y, but '^' still removes the selector's own base.
  {
    const { packageDir: dir } = await registry.createTestDir({ files });
    await installOk(dir);
    const [rootBefore, xBefore, zBefore] = await Promise.all([
      read(dir, "root").text(),
      read(dir, "x").text(),
      read(dir, "z").text(),
    ]);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...^x"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect((await read(dir, "y").json()).dependencies).toStrictEqual({ x: "workspace:*", "no-deps": "^2.0.0" });
    expect(await read(dir, "x").text()).toBe(xBefore);
    expect(await read(dir, "z").text()).toBe(zBefore);
    expect(await read(dir, "root").text()).toBe(rootBefore);
  }
});

test.concurrent("remove with a relation", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "pkg-a": "workspace:*", "no-deps": "^2.0.0" } },
    web: { name: "web", dependencies: { api: "workspace:*", "no-deps": "^2.0.0" } },
    "pkg-a": { name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } },
  });
  await installOk(dir, "hoisted");
  const [rootBefore, , webBefore, , pkgBBefore] = await allPackageJsonTexts(dir);

  const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api..."], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  // web still depends on no-deps, so nothing leaves bun.lock: the rows describe the package.json edits.
  expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- no-deps", " done"]);
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    ROOT,
    { name: "api", dependencies: { "pkg-a": "workspace:*" } },
    { name: "web", dependencies: { api: "workspace:*", "no-deps": "^2.0.0" } },
    PKG_A,
    PKG_B,
  ]);
  expect(await pkgText(dir, "web")).toBe(webBefore);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(await pkgText(dir, "pkg-b")).toBe(pkgBBefore);
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("a relation that reaches nothing warns like any other pattern", async () => {
  const dir = await makeMonorepo(GRAPH);
  await installOk(dir);

  {
    const before = await allPackageJsonTexts(dir);
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--filter", "...^web"], dir);
    expect(stderr).toBe('warn: No workspace packages matched the filter "...^web"\nSaved lockfile\n');
    expect(exitCode).toBe(0);
    await expectAddedOnlyTo(dir, before, ["api"]);
  }

  {
    const before = await allPackageJsonTexts(dir);
    const lockBefore = await file(join(dir, "bun.lock")).text();
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "nope..."], dir);
    expect(stderr).toBe('error: No workspace packages matched the filter "nope..."\n');
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
    expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  }
});

test.concurrent("a relation works before the first install", async () => {
  const dir = await makeMonorepo(GRAPH);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api..."], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api", "pkg-a"]);
  expect(await exists(join(dir, "bun.lock"))).toBeTrue();
  expect((await lockfileJson(dir)).workspaces["packages/pkg-a"].dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
});

test.concurrent.each<[string, Workspace, object, string, Workspace[]]>([
  [
    "edge added, foo... shape",
    "pkg-a",
    { name: "pkg-a", dependencies: { "pkg-b": "workspace:*" } },
    "api...",
    ["api", "pkg-a", "pkg-b"],
  ],
  [
    "edge added, ...^foo shape",
    "pkg-b",
    { name: "pkg-b", dependencies: { api: "workspace:*" } },
    "...^api",
    ["web", "pkg-b"],
  ],
  ["edge removed", "web", { name: "web" }, "...api", ["api"]],
])(
  "relations follow the package.json files as they are now (%s)",
  async (_label, workspaceToRewrite, newManifest, pattern, edited) => {
    const dir = await makeMonorepo(GRAPH);
    await installOk(dir);
    await write(pkgPath(dir, workspaceToRewrite), JSON.stringify(newManifest, null, 2));
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", pattern], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, edited);
  },
);

test.concurrent("a workspace created since the last install takes part in relations", async () => {
  const PKG_C = { name: "pkg-c", dependencies: { api: "workspace:*" } };
  const pkgCPath = (dir: string) => join(dir, "packages", "pkg-c", "package.json");
  const setup = async () => {
    const dir = await makeMonorepo(GRAPH);
    await installOk(dir);
    await write(pkgCPath(dir), JSON.stringify(PKG_C));
    return dir;
  };

  {
    const dir = await setup();
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "pkg-c..."], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["api", "pkg-a"]);
    expect((await file(pkgCPath(dir)).json()).dependencies).toStrictEqual({ api: "workspace:*", "no-deps": "^2.0.0" });
  }

  {
    const dir = await setup();
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...^api"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["web"]);
    expect((await file(pkgCPath(dir)).json()).dependencies).toStrictEqual({ api: "workspace:*", "no-deps": "^2.0.0" });
    expect((await lockfileJson(dir)).workspaces["packages/pkg-c"]).toBeDefined();
  }
});

test.concurrent(
  "a plain range the workspace version does not satisfy is not an edge; an unsatisfied workspace: range is the install error",
  async () => {
    {
      const dir = await makeMonorepo({
        api: { name: "api", version: "1.0.0" },
        web: { name: "web", dependencies: { api: "2.0.0" } },
      });
      const before = await allPackageJsonTexts(dir);

      const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...^api"], dir);
      expect(stderr).toBe('error: No workspace packages matched the filter "...^api"\n');
      expect(exitCode).toBe(1);

      expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
      expect(await exists(join(dir, "bun.lock"))).toBeFalse();
    }

    {
      const dir = await makeMonorepo({
        api: { name: "api", version: "1.0.0" },
        web: { name: "web", dependencies: { api: "^1.0.0" } },
      });
      const before = await allPackageJsonTexts(dir);

      const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...^api"], dir);
      expect(stderr).toBe("Saved lockfile\n");
      expect(exitCode).toBe(0);

      await expectAddedOnlyTo(dir, before, ["web"]);
    }

    {
      const dir = await makeMonorepo({
        api: { name: "api", version: "1.0.0" },
        web: { name: "web", dependencies: { api: "workspace:^2.0.0" } },
      });
      const before = await allPackageJsonTexts(dir);

      const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...api"], dir);
      expect(stderr).toStartWith(
        'error: No matching version for workspace dependency "api". Version: "workspace:^2.0.0"\n',
      );
      expect(exitCode).toBe(1);

      expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
      expect(await exists(join(dir, "bun.lock"))).toBeFalse();
    }

    // '*' against a versionless workspace is an edge.
    {
      const dir = await makeMonorepo({ web: { name: "web", dependencies: { api: "*" } } });
      const before = await allPackageJsonTexts(dir);

      const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...^api"], dir);
      expect(stderr).toBe("Saved lockfile\n");
      expect(exitCode).toBe(0);

      await expectAddedOnlyTo(dir, before, ["web"]);
    }

    // A catalog entry that resolves to a workspace is an edge.
    {
      const dir = await makeMonorepo({
        root: { name: "root", workspaces: { packages: ["packages/*"], catalog: { api: "workspace:*" } } },
        web: { name: "web", dependencies: { api: "catalog:" } },
      });
      const before = await allPackageJsonTexts(dir);

      const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "...^api"], dir);
      expect(stderr).toBe("Saved lockfile\n");
      expect(exitCode).toBe(0);

      await expectAddedOnlyTo(dir, before, ["web"]);
    }
  },
);

test.concurrent("a bare '...' is rejected", async () => {
  const dir = await makeMonorepo();
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "..."], dir);
  expect(stderr).toBe('error: --filter "..." is missing a workspace name or path\n');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
});

test.concurrent(
  "install --filter with a positive and a negated pattern installs only the positive matches",
  async () => {
    const fixture = {
      root: { ...ROOT, dependencies: { "a-dep": "1.0.1" } },
      api: { name: "api", dependencies: { "no-deps": "2.0.0" } },
      "pkg-a": { name: "pkg-a", dependencies: { "is-number": "1.0.0" } },
    };
    const dir = await makeMonorepo(fixture);

    const { stderr, exitCode } = await run(["install", "--filter", "api", "--filter", "!web"], dir, {
      linker: "hoisted",
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect(
      await Promise.all([
        exists(join(dir, "node_modules", "no-deps", "package.json")),
        exists(join(dir, "node_modules", "a-dep")),
        exists(join(dir, "node_modules", "is-number")),
      ]),
    ).toStrictEqual([true, false, false]);
    // The whole monorepo is still resolved into bun.lock; the filter only decides what gets linked.
    await expectWorkspaces(dir, [fixture.root, fixture.api, WEB, fixture["pkg-a"], PKG_B]);
  },
);

test.concurrent("install --filter with relations installs the closure only", async () => {
  const fixture = {
    root: { ...ROOT, dependencies: { "basic-1": "1.0.0" } },
    api: { name: "api", dependencies: { "pkg-a": "workspace:*", "no-deps": "2.0.0" } },
    web: { name: "web", dependencies: { api: "workspace:*", "a-dep": "1.0.1" } },
    "pkg-a": { name: "pkg-a", dependencies: { "is-number": "1.0.0" } },
    "pkg-b": { name: "pkg-b", dependencies: { "left-pad": "1.0.0" } },
  };
  const dir = await makeMonorepo(fixture);
  const installed = (name: string) => exists(join(dir, "node_modules", name));

  {
    const { stderr, exitCode } = await run(["install", "--filter", "api..."], dir, { linker: "hoisted" });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect(
      await Promise.all(["no-deps", "is-number", "api", "pkg-a", "a-dep", "left-pad", "basic-1"].map(installed)),
    ).toStrictEqual([true, true, true, true, false, false, false]);
    await expectWorkspaces(dir, [fixture.root, fixture.api, fixture.web, fixture["pkg-a"], fixture["pkg-b"]]);
  }

  // The first filtered install already resolved the whole monorepo, so the second one only links.
  {
    const { stderr, exitCode } = await run(["install", "--filter", "...^pkg-a"], dir, { linker: "hoisted" });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(await Promise.all(["a-dep", "left-pad", "basic-1"].map(installed))).toStrictEqual([true, false, false]);
  }
});

// add/remove error on zero matches; install warns and keeps its documented no-op, summarized like any other no-op.
test.concurrent("install --filter with a pattern that matches nothing warns and exits 0", async () => {
  const dir = await makeMonorepo();

  const { stdout, stderr, exitCode } = await run(["install", "--filter", "nope"], dir, { linker: "hoisted" });
  expect(stderr).toBe('warn: No workspace packages matched the filter "nope"\nSaved lockfile\n');
  expect(stdoutLines(stdout)).toStrictEqual([
    HEADER("install"),
    "",
    "Checked 0 installs across 6 packages (no changes)",
  ]);
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, WEB, PKG_A, PKG_B]);
  expect(await exists(join(dir, "node_modules", "a-dep"))).toBeFalse();
});

test.concurrent("outdated --filter with relations", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "pkg-a": "workspace:*", "no-deps": "1.0.0" } },
    web: { name: "web", dependencies: { api: "workspace:*", "is-number": "1.0.0" } },
    "pkg-a": { name: "pkg-a", dependencies: { "a-dep": "1.0.1" } },
    "pkg-b": { name: "pkg-b", dependencies: { "no-deps": "1.0.0" } },
  });
  await installOk(dir);

  {
    const { stdout, stderr, exitCode } = await run(["outdated", "--filter", "api..."], dir);
    expect(stderr).toBe("");
    expect(stdoutLines(stdout)).toStrictEqual([
      HEADER("outdated"),
      "|--------------------------------------------------|",
      "| Package  | Current | Update | Latest | Workspace |",
      "|----------|---------|--------|--------|-----------|",
      "| no-deps  | 1.0.0   | 1.0.0  | 2.0.0  | api       |",
      "|----------|---------|--------|--------|-----------|",
      "| a-dep    | 1.0.1   | 1.0.1  | 1.0.10 | pkg-a     |",
      "|--------------------------------------------------|",
    ]);
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, stderr, exitCode } = await run(["outdated", "--filter", "...^api"], dir);
    expect(stderr).toBe("");
    expect(stdoutLines(stdout)).toStrictEqual([
      HEADER("outdated"),
      "|---------------------------------------------------|",
      "| Package   | Current | Update | Latest | Workspace |",
      "|-----------|---------|--------|--------|-----------|",
      "| is-number | 1.0.0   | 1.0.0  | 2.0.0  | web       |",
      "|---------------------------------------------------|",
    ]);
    expect(exitCode).toBe(0);
  }
});

test.concurrent("path filter, run from inside another workspace", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "./packages/api"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "../api"], dir, {
      cwd: join(dir, "packages", "web"),
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, plus(plus(API), "a-dep", "^1.0.10"), WEB, PKG_A, PKG_B]);
  }
});

test.concurrent("no match is an error and nothing is written", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "does-not-exist"], dir);
  expect(stderr).toBe('error: No workspace packages matched the filter "does-not-exist"\n');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

test.concurrent("remove --filter removes from the matched workspace only", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "no-deps": "^2.0.0" } },
    web: { name: "web", dependencies: { "no-deps": "^2.0.0" } },
  });

  await installOk(dir, "hoisted");
  expect(await exists(join(dir, "bun.lock"))).toBeTrue();

  {
    const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, {
      linker: "hoisted",
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- no-deps", " done"]);
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, API, { name: "web", dependencies: { "no-deps": "^2.0.0" } }, PKG_A, PKG_B]);
    expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
  }

  {
    const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "web"], dir, {
      linker: "hoisted",
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- no-deps", "1 package removed"]);
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, API, { name: "web" }, PKG_A, PKG_B]);
    expect((await lockfileJson(dir)).packages["no-deps"]).toBeUndefined();
    expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
  }
});

test.concurrent("remove --filter prints the same removed summary as --filter root", async () => {
  const deps = { "no-deps": "^2.0.0", "a-dep": "^1.0.10" };
  const dir = await makeMonorepo({
    root: { ...ROOT, dependencies: { "is-number": "1.0.0" } },
    web: { name: "web" },
    "pkg-a": { name: "pkg-a", dependencies: deps },
    "pkg-b": { name: "pkg-b", dependencies: deps },
  });
  await installOk(dir, "hoisted");

  {
    const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "a-dep", "--filter", "pkg-*"], dir, {
      linker: "hoisted",
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- no-deps", "- a-dep", "2 packages removed"]);
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [
      { ...ROOT, dependencies: { "is-number": "1.0.0" } },
      API,
      { name: "web" },
      PKG_A,
      PKG_B,
    ]);
    const { packages } = await lockfileJson(dir);
    expect([packages["no-deps"], packages["a-dep"], packages["is-number"]]).toStrictEqual([
      undefined,
      undefined,
      expect.any(Array),
    ]);
    expect(
      await Promise.all([
        exists(join(dir, "node_modules", "no-deps")),
        exists(join(dir, "node_modules", "a-dep")),
        exists(join(dir, "node_modules", "is-number", "package.json")),
      ]),
    ).toStrictEqual([false, false, true]);
  }

  {
    const { stdout, stderr, exitCode } = await run(["remove", "is-number", "--filter", "root"], dir, {
      linker: "hoisted",
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- is-number", "1 package removed"]);
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, API, { name: "web" }, PKG_A, PKG_B]);
    expect((await lockfileJson(dir)).packages["is-number"]).toBeUndefined();
    expect(await exists(join(dir, "node_modules", "is-number"))).toBeFalse();
  }
});

test.concurrent("remove --filter '*' leaves the root's entries alone", async () => {
  const deps = { "no-deps": "^2.0.0", "a-dep": "^1.0.10" };
  const dir = await makeMonorepo({
    root: JSON.stringify({ ...ROOT, dependencies: deps }),
    api: { name: "api", dependencies: deps },
    web: { name: "web", dependencies: deps },
  });
  await installOk(dir, "hoisted");
  const rootBefore = await pkgText(dir, "root");

  const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "a-dep", "--filter", "*"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- no-deps", "- a-dep", " done"]);
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [{ ...ROOT, dependencies: deps }, API, { name: "web" }, PKG_A, PKG_B]);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(
    await Promise.all([
      exists(join(dir, "node_modules", "no-deps", "package.json")),
      exists(join(dir, "node_modules", "a-dep", "package.json")),
    ]),
  ).toStrictEqual([true, true]);
});

test.concurrent("add --filter with an existing lockfile re-resolves only the added dep", async () => {
  const dir = await makeMonorepo();
  await installOk(dir, "hoisted");

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "web"], dir, { linker: "hoisted" });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, plus(WEB), PKG_A, PKG_B]);
  expect(await file(join(dir, "node_modules", "a-dep", "package.json")).json()).toStrictEqual({
    name: "a-dep",
    version: "1.0.1",
  });
  expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
    name: "no-deps",
    version: "2.0.0",
  });
});

test.concurrent("--dry-run writes nothing", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stdout, stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--dry-run"], dir);
  expect(stderr).toBe("");
  // A dry run lists everything it resolved (the whole monorepo, not just api) and what it would have added.
  expect(stdoutLines(stdout)).toStrictEqual([
    HEADER("add"),
    "",
    " api@workspace:packages/api",
    " pkg-a@workspace:packages/pkg-a",
    " pkg-b@workspace:packages/pkg-b",
    " web@workspace:packages/web",
    " a-dep@1.0.1",
    "installed no-deps@2.0.0",
    "",
    " done",
  ]);
  expect(exitCode).toBe(0);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

// Ported from pnpm's filtered add/remove suites and pacquet's install_filters.rs.

test.concurrent(
  "add --only-missing --filter leaves an existing entry untouched in the target that has it",
  async () => {
    const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "1.0.0" } } });
    const apiBefore = await pkgText(dir, "api");

    const { stderr, exitCode } = await run(["add", "no-deps", "--only-missing", "--filter", "*"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect(await pkgText(dir, "api")).toBe(apiBefore);
    await expectWorkspaces(dir, [
      ROOT,
      { name: "api", dependencies: { "no-deps": "1.0.0" } },
      { name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } },
      { name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } },
      { name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } },
    ]);
  },
);

test.concurrent("add --only-missing --filter resolves from a target that received the request", async () => {
  // The root (first target) already has the dep; web must still get the freshly resolved version.
  const dir = await makeMonorepo({ root: { ...ROOT, dependencies: { "no-deps": "1.0.0" } } });
  const rootBefore = await pkgText(dir, "root");

  const { stderr, exitCode } = await run(
    ["add", "no-deps", "--only-missing", "--filter", "root", "--filter", "web"],
    dir,
  );
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  expect(await pkgText(dir, "root")).toBe(rootBefore);
  await expectWorkspaces(dir, [{ ...ROOT, dependencies: { "no-deps": "1.0.0" } }, API, plus(WEB), PKG_A, PKG_B]);
});

test.concurrent("add --only-missing --filter where every target already has it writes nothing", async () => {
  const dir = await makeMonorepo({
    api: '{"name":"api","dependencies":{"no-deps":"1.0.0"}}',
    web: '{"name":"web","dependencies":{"no-deps":"1.0.0"}}',
  });
  await installOk(dir, "hoisted");
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stdout, stderr, exitCode } = await run(
    ["add", "no-deps", "--only-missing", "--filter", "api", "--filter", "web"],
    dir,
    { linker: "hoisted" },
  );
  expect(stderr).toBe("");
  // The same no-op line a satisfied `bun install --filter api --filter web` prints: api, web and no-deps checked.
  expect(stdoutLines(stdout)).toStrictEqual([HEADER("add"), "", "Checked 3 installs across 6 packages (no changes)"]);
  expect(exitCode).toBe(0);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);

  // Unfiltered from inside a workspace: the whole monorepo is checked (that path re-prints package.json, so compare parsed).
  const jsonsBefore = await allPackageJsons(dir);
  const inside = await run(["add", "no-deps", "--only-missing"], dir, {
    cwd: join(dir, "packages", "api"),
    linker: "hoisted",
  });
  expect(inside.stderr).toBe("");
  expect(stdoutLines(inside.stdout)).toStrictEqual([
    HEADER("add"),
    "",
    "Checked 5 installs across 6 packages (no changes)",
  ]);
  expect(inside.exitCode).toBe(0);

  expect(await allPackageJsons(dir)).toStrictEqual(jsonsBefore);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
});

test.concurrent("remove --filter leaves targets that did not contain the dependency byte-identical", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "no-deps": "^2.0.0" } },
    web: '{"name":"web","dependencies":{"a-dep":"1.0.1"}}',
    "pkg-a": '{ "name": "pkg-a" }',
  });
  await installOk(dir, "hoisted");
  const [rootBefore, , webBefore, pkgABefore] = await allPackageJsonTexts(dir);

  const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api", "--filter", "web"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- no-deps", "1 package removed"]);
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, WEB, PKG_A, PKG_B]);
  expect(await pkgText(dir, "web")).toBe(webBefore);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(await pkgText(dir, "pkg-a")).toBe(pkgABefore);
  expect(await file(join(dir, "bun.lock")).text()).not.toContain("no-deps");
  expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
});

test.concurrent("remove --filter where no target contains the dependency writes nothing", async () => {
  const dir = await makeMonorepo({ web: '{"name":"web"}' });
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  {
    const { stdout, stderr, exitCode } = await run(["remove", "foo", "--filter", "api"], dir);
    expect(stderr).toBe("");
    expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "foo is not a dependency of api"]);
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "*"], dir);
    expect(stderr).toBe("");
    const [header, blank, summary, ...rest] = stdoutLines(stdout);
    expect([header, blank, rest]).toStrictEqual([HEADER("remove"), "", []]);
    const prefix = "no-deps is not a dependency of ";
    expect(summary).toStartWith(prefix);
    expect(summary.slice(prefix.length).split(", ").sort()).toStrictEqual(["api", "pkg-a", "pkg-b", "web"]);
    expect(exitCode).toBe(0);
  }

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
});

test.concurrent("add/remove --filter with the isolated linker links only the target workspace", async () => {
  const dir = await makeMonorepo({}, "isolated");
  const stale = join(dir, "packages", "web", "node_modules", "stale", "package.json");
  await write(stale, '{"name":"stale"}');

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir, { linker: "isolated" });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
    expect(await file(join(dir, "packages", "api", "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
      name: "no-deps",
      version: "2.0.0",
    });
    expect(await exists(join(dir, "packages", "web", "node_modules", "no-deps"))).toBeFalse();
    expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
    expect(await exists(join(dir, "packages", "web", "node_modules", "a-dep"))).toBeFalse();
    expect(await file(stale).text()).toBe('{"name":"stale"}');
    expect(await exists(join(dir, "node_modules", "web"))).toBeFalse();
  }

  {
    const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, {
      linker: "isolated",
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "- no-deps", "1 package removed"]);
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, API, WEB, PKG_A, PKG_B]);
    // The isolated installer does not yet prune packages/api/node_modules/no-deps (same as unfiltered `bun remove`).
    expect(await file(join(dir, "bun.lock")).text()).not.toContain("no-deps");
  }

  await installUnchanged(dir, "isolated");
  expect(await exists(join(dir, "packages", "web", "node_modules", "a-dep", "package.json"))).toBeTrue();
});

test.concurrent("add --filter links only the selected workspace (hoisted)", async () => {
  const dir = await makeMonorepo();
  const stale = join(dir, "packages", "web", "node_modules", "stale", "package.json");
  await write(stale, '{"name":"stale"}');
  const installed = () =>
    Promise.all([
      exists(join(dir, "node_modules", "api")),
      exists(join(dir, "node_modules", "no-deps", "package.json")),
      exists(join(dir, "node_modules", "web")),
      exists(join(dir, "node_modules", "pkg-a")),
      exists(join(dir, "node_modules", "a-dep")),
      exists(stale),
    ]);

  const { stdout, stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir, { linker: "hoisted" });
  expect(stderr).toBe("Saved lockfile\n");
  // api itself and no-deps: web, its a-dep and the other workspaces are resolved into bun.lock but not linked.
  expect(stdoutLines(stdout)).toStrictEqual([HEADER("add"), "", "installed no-deps@2.0.0", "", "2 packages installed"]);
  expect(exitCode).toBe(0);

  expect(await installed()).toStrictEqual([true, true, false, false, false, true]);
  await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
  expect((await lockfileJson(dir)).packages["a-dep"][0]).toBe("a-dep@1.0.1");

  await installUnchanged(dir, "hoisted");
  expect(await installed()).toStrictEqual([true, true, true, true, true, true]);
});

test.concurrent("add --filter leaves the root's own dependencies alone unless the root is selected", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, dependencies: { "is-number": "1.0.0" } } });
  const installed = (name: string) => exists(join(dir, "node_modules", name));

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*"], dir, { linker: "hoisted" });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect(
      await Promise.all(["is-number", "api", "web", "pkg-a", "pkg-b", "a-dep", "no-deps"].map(installed)),
    ).toStrictEqual([false, true, true, true, true, true, true]);
    await expectWorkspaces(dir, [
      { ...ROOT, dependencies: { "is-number": "1.0.0" } },
      plus(API),
      plus(WEB),
      plus(PKG_A),
      plus(PKG_B),
    ]);
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "root"], dir, { linker: "hoisted" });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect(await installed("is-number")).toBeTrue();
    await expectWorkspaces(dir, [
      { ...ROOT, dependencies: { "is-number": "1.0.0", "a-dep": "^1.0.10" } },
      plus(API),
      plus(WEB),
      plus(PKG_A),
      plus(PKG_B),
    ]);
  }
});

test.concurrent("remove --filter re-links only the selected workspace", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "no-deps": "^2.0.0" } },
    web: { name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } },
  });
  await installOk(dir, "hoisted");
  const webBefore = await pkgText(dir, "web");
  await rm(join(dir, "node_modules"), { recursive: true });
  const installed = () =>
    Promise.all(["api", "web", "no-deps", "a-dep"].map(name => exists(join(dir, "node_modules", name))));

  const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, { linker: "hoisted" });
  expect(stderr).toBe("Saved lockfile\n");
  // As with an unfiltered remove, the summary is the install count once something had to be linked: here api alone.
  expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove"), "", "1 package installed"]);
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, plus(WEB), PKG_A, PKG_B]);
  expect(await pkgText(dir, "web")).toBe(webBefore);
  expect(await installed()).toStrictEqual([true, false, false, false]);
  expect((await lockfileJson(dir)).packages["no-deps"][0]).toBe("no-deps@2.0.0");

  await installUnchanged(dir, "hoisted");
  expect(await installed()).toStrictEqual([true, true, true, true]);
});

test.concurrent("add --filter with a relation links the whole closure and nothing else", async () => {
  const dir = await makeMonorepo({
    ...GRAPH,
    web: { name: "web", dependencies: { api: "workspace:*", "a-dep": "1.0.1" } },
    "pkg-b": { name: "pkg-b", dependencies: { "is-number": "1.0.0" } },
  });
  await installOk(dir, "hoisted");
  const before = await allPackageJsonTexts(dir);
  await rm(join(dir, "node_modules"), { recursive: true });

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api..."], dir, { linker: "hoisted" });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api", "pkg-a"]);
  expect(
    await Promise.all(
      ["api", "pkg-a", "no-deps", "web", "a-dep", "is-number"].map(name => exists(join(dir, "node_modules", name))),
    ),
  ).toStrictEqual([true, true, true, false, false, false]);
});

test.concurrent("outdated --filter warns about a positive pattern that matched nothing", async () => {
  const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "1.0.0" } } });
  await installOk(dir);

  const table = [
    HEADER("outdated"),
    "|--------------------------------------------------|",
    "| Package  | Current | Update | Latest | Workspace |",
    "|----------|---------|--------|--------|-----------|",
    "| no-deps  | 1.0.0   | 1.0.0  | 2.0.0  | api       |",
    "|--------------------------------------------------|",
  ];

  {
    const { stdout, stderr, exitCode } = await run(["outdated", "--filter", "api", "--filter", "typo"], dir);
    expect(stderr).toBe('warn: No workspace packages matched the filter "typo"\n');
    expect(stdoutLines(stdout)).toStrictEqual(table);
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, stderr, exitCode } = await run(["outdated", "--filter", "api", "--filter", "!typo"], dir);
    expect(stderr).toBe("");
    expect(stdoutLines(stdout)).toStrictEqual(table);
    expect(exitCode).toBe(0);
  }
});

test.concurrent("--filter=<pattern> is accepted before the subcommand", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["--filter=api", "add", "no-deps"], dir, { linker: "hoisted" });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api"]);
});

test.concurrent("two name filters are unioned and unselected workspaces are byte-identical", async () => {
  const dir = await makeMonorepo({
    root: '{ "name": "root", "workspaces": ["packages/*"] }',
    "pkg-a": '{"name":"pkg-a"}',
  });
  const [rootBefore, , , pkgABefore, pkgBBefore] = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--filter", "web"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, plus(API), plus(WEB), PKG_A, PKG_B]);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(await pkgText(dir, "pkg-a")).toBe(pkgABefore);
  expect(await pkgText(dir, "pkg-b")).toBe(pkgBBefore);
});

test.concurrent("remove --filter with no match names the pattern and touches nothing", async () => {
  const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "^2.0.0" } } });
  await installOk(dir, "hoisted");
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "nope"], dir, { linker: "hoisted" });
  expect(stderr).toBe('error: No workspace packages matched the filter "nope"\n');
  expect(stdoutLines(stdout)).toStrictEqual([HEADER("remove")]);
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("a filter that matches nothing warns when another filter matched", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--filter", "typo"], dir);
    expect(stderr).toBe('warn: No workspace packages matched the filter "typo"\nSaved lockfile\n');
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
  }

  {
    const { stderr, exitCode } = await run(
      ["add", "a-dep", "--filter", "web", "--filter", "typo", "--filter", "typo2"],
      dir,
    );
    expect(stderr).toBe('warn: No workspace packages matched the filters "typo", "typo2"\nSaved lockfile\n');
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, plus(API), { name: "web", dependencies: { "a-dep": "^1.0.10" } }, PKG_A, PKG_B]);
  }
});

test.concurrent("negated filters that match nothing do not warn", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--filter", "!nothing"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
});

test.concurrent("an explicit version is written verbatim to every target", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "a-dep@1.0.1", "--filter", "pkg-*"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, API, WEB, plus(PKG_A, "a-dep", "1.0.1"), plus(PKG_B, "a-dep", "1.0.1")]);
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps@^1.0.0", "--filter", "web"], dir, { linker: "hoisted" });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [
      ROOT,
      API,
      plus(WEB, "no-deps", "^1.0.0"),
      plus(PKG_A, "a-dep", "1.0.1"),
      plus(PKG_B, "a-dep", "1.0.1"),
    ]);
    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
      name: "no-deps",
      version: "1.1.0",
    });
  }
});

test.concurrent("--peer and --optional target the right list in every selected workspace", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--peer", "--filter", "pkg-*"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [
      ROOT,
      API,
      WEB,
      { name: "pkg-a", peerDependencies: { "no-deps": "^2.0.0" } },
      { name: "pkg-b", peerDependencies: { "no-deps": "^2.0.0" } },
    ]);
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--optional", "--filter", "pkg-a"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [
      ROOT,
      API,
      WEB,
      { name: "pkg-a", optionalDependencies: { "a-dep": "^1.0.10" }, peerDependencies: { "no-deps": "^2.0.0" } },
      { name: "pkg-b", peerDependencies: { "no-deps": "^2.0.0" } },
    ]);
  }
});

test.concurrent("the root can be selected by name", async () => {
  const dir = await makeMonorepo();
  const [, ...membersBefore] = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "root"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [plus(ROOT), API, WEB, PKG_A, PKG_B]);
  const [, ...membersAfter] = await allPackageJsonTexts(dir);
  expect(membersAfter).toStrictEqual(membersBefore);
});

test.concurrent("'.' selects the workspace of the invoking directory", async () => {
  const dir = await makeMonorepo();

  {
    const [, ...membersBefore] = await allPackageJsonTexts(dir);
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "."], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [plus(ROOT, "a-dep", "^1.0.10"), API, WEB, PKG_A, PKG_B]);
    const [, ...membersAfter] = await allPackageJsonTexts(dir);
    expect(membersAfter).toStrictEqual(membersBefore);
  }

  {
    const rootBefore = await pkgText(dir, "root");
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "."], dir, {
      cwd: join(dir, "packages", "web"),
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [plus(ROOT, "a-dep", "^1.0.10"), API, plus(WEB), PKG_A, PKG_B]);
    expect(await pkgText(dir, "root")).toBe(rootBefore);
  }
});

test.concurrent("a directory excluded by a '!' entry in workspaces is never a target", async () => {
  const dir = await makeMonorepo({ root: { name: "root", workspaces: ["packages/*", "!packages/web"] } });
  const webBefore = await pkgText(dir, "web");

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    expect(await allPackageJsons(dir)).toStrictEqual([
      { name: "root", workspaces: ["packages/*", "!packages/web"] },
      plus(API),
      WEB,
      plus(PKG_A),
      plus(PKG_B),
    ]);
    expect(await pkgText(dir, "web")).toBe(webBefore);
    expect(Object.keys((await lockfileJson(dir)).workspaces).sort()).toStrictEqual([
      "",
      "packages/api",
      "packages/pkg-a",
      "packages/pkg-b",
    ]);
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "web"], dir);
    expect(stderr).toBe('error: No workspace packages matched the filter "web"\n');
    expect(exitCode).toBe(1);
    expect(await pkgText(dir, "web")).toBe(webBefore);
  }
});

test.concurrent("workspaces: { packages: [...] } object form is honoured", async () => {
  const dir = await makeMonorepo({ root: { name: "root", workspaces: { packages: ["packages/*"] } } });

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    { name: "root", workspaces: { packages: ["packages/*"] } },
    plus(API),
    WEB,
    PKG_A,
    PKG_B,
  ]);
});

test.concurrent("scoped workspace names match a scope glob", async () => {
  const dir = await makeMonorepo({ "pkg-a": { name: "@acme/a" }, "pkg-b": { name: "@acme/b" } });

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "@acme/*"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, API, WEB, plus({ name: "@acme/a" }), plus({ name: "@acme/b" })]);
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "@acme/a"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    await expectWorkspaces(dir, [ROOT, API, WEB, { name: "@acme/a" }, plus({ name: "@acme/b" })]);
  }
});

test.concurrent("add --filter --lockfile-only edits package.json and bun.lock but installs nothing", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--lockfile-only"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
  expect((await lockfileJson(dir)).packages["no-deps"][0]).toBe("no-deps@2.0.0");
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

test.concurrent("running from a non-package subdirectory selects by filter and scaffolds nothing", async () => {
  const dir = await makeMonorepo();
  await Promise.all([
    mkdir(join(dir, "packages", "api", "src")),
    mkdir(join(dir, "tools", "scratch"), { recursive: true }),
  ]);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "web"], dir, {
      cwd: join(dir, "packages", "api", "src"),
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);
    expect(await exists(join(dir, "packages", "api", "src", "package.json"))).toBeFalse();
  }

  {
    const { stderr, exitCode } = await run(["install", "a-dep", "--filter", "web"], dir, {
      cwd: join(dir, "tools", "scratch"),
    });
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);
    expect(await exists(join(dir, "tools", "scratch", "package.json"))).toBeFalse();
  }

  await expectWorkspaces(dir, [ROOT, API, plus(plus(WEB), "a-dep", "^1.0.10"), PKG_A, PKG_B]);
});

test.concurrent.each(["add", "install"])(
  "%s <pkg> --filter outside any project fails without creating package.json",
  async cmd => {
    const { packageDir } = await registry.createTestDir();

    const { stderr, exitCode } = await run([cmd, "no-deps", "--filter", "web"], packageDir);
    expect(stderr).toBe(
      'error: Bun could not find a package.json file to install from\nnote: Run "bun init" to initialize a project\n',
    );
    expect(exitCode).toBe(1);

    expect(await exists(join(packageDir, "package.json"))).toBeFalse();
  },
);

test.concurrent("filtered remove keeps the unselected workspace's lockfile entries", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "no-deps": "^2.0.0" } },
    web: { name: "web", dependencies: { api: "workspace:*", "no-deps": "^2.0.0" } },
  });
  await installOk(dir, "hoisted");

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, { linker: "hoisted" });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    ROOT,
    API,
    { name: "web", dependencies: { api: "workspace:*", "no-deps": "^2.0.0" } },
    PKG_A,
    PKG_B,
  ]);
  expect((await lockfileJson(dir)).packages["no-deps"][0]).toBe("no-deps@2.0.0");
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("bun install <pkg> -F targets the workspace", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["install", "no-deps", "-F", "api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
});

// The root is only skipped by '*' when there are workspaces to select instead.
test.concurrent("--filter outside a workspace: the lone package is the only candidate", async () => {
  const { packageDir } = await registry.createTestDir({ files: { "package.json": JSON.stringify({ name: "solo" }) } });

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*"], packageDir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);
    expect(await file(join(packageDir, "package.json")).json()).toStrictEqual({
      name: "solo",
      dependencies: { "no-deps": "^2.0.0" },
    });
  }

  {
    const before = await file(join(packageDir, "package.json")).text();
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "other"], packageDir);
    expect(stderr).toBe('error: No workspace packages matched the filter "other"\n');
    expect(exitCode).toBe(1);
    expect(await file(join(packageDir, "package.json")).text()).toBe(before);
  }
});

// Rejected while parsing arguments, like --catalog with --global: no banner is printed first.
test.concurrent.each(["add", "remove", "update"])("%s --filter with --global is rejected", async command => {
  const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "1.0.0" } } });
  const globalDir = join(dir, ".global");
  const before = await allPackageJsonTexts(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), command, "no-deps", "-g", "--filter", "api"],
    cwd: dir,
    env: { ...envFor(dir), BUN_INSTALL: globalDir, BUN_INSTALL_GLOBAL_DIR: join(globalDir, "install", "global") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toBe("error: --filter cannot be used with --global\n");
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(globalDir, "install", "global", "node_modules", "no-deps"))).toBeFalse();
});

test.concurrent.each([
  ["add", "Add a dependency to a specific workspace in a monorepo", "bun add zod --filter api"],
  ["remove", "Remove a dependency from a specific workspace in a monorepo", "bun remove zod --filter api"],
])("%s --help has a --filter example", async (command, description, example) => {
  const { packageDir } = await registry.createTestDir();

  const { stdout, exitCode } = await run([command, "--help"], packageDir);
  const lines = stdout.split(/\r?\n/).map(line => line.trim());
  expect(lines).toContain(description);
  expect(lines.indexOf(example)).toBe(lines.indexOf(description) + 1);
  expect(exitCode).toBe(0);
});

// Round 3: bugs and non-bugs mined from pnpm's open issue tracker.

const VENDOR_FOO = { name: "foo", version: "1.0.0" };

async function addVendorFoo(dir: string) {
  await write(join(dir, "vendor", "foo", "package.json"), JSON.stringify(VENDOR_FOO));
}

test.concurrent("package.json is written even when a root postinstall fails (pnpm#8627)", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, scripts: { postinstall: "exit 1" } } });

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "root", "--filter", "api"], dir);
  expect(stderr).toBe('Saved lockfile\n\n$ exit 1\nerror: postinstall script from "root" exited with 1\n');
  expect(exitCode).toBe(1);

  await expectWorkspaces(dir, [
    { ...ROOT, scripts: { postinstall: "exit 1" }, dependencies: { "no-deps": "^2.0.0" } },
    plus(API),
    WEB,
    PKG_A,
    PKG_B,
  ]);
});

test.concurrent("the root's lifecycle scripts do not run when --filter leaves the root out", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, scripts: { postinstall: "exit 1" } } });
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api"]);
});

test.concurrent("a failed resolution leaves every target untouched", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "does-not-exist-anywhere", "--filter", "pkg-*"], dir);
  expect(stderr).toBe(`error: GET ${registry.registryUrl()}does-not-exist-anywhere - 404\n`);
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
});

test.concurrent("bun.lock records the resolved range for every target, not just the first", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "pkg-*"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, API, WEB, plus(PKG_A), plus(PKG_B)]);
  await installUnchanged(dir);
});

test.concurrent("--only-missing resolves each request from a target that received it", async () => {
  const dir = await makeMonorepo({
    root: { ...ROOT, dependencies: { "a-dep": "1.0.1" } },
    web: { name: "web", dependencies: { "no-deps": "1.0.0" } },
  });

  const { stderr, exitCode } = await run(
    ["add", "no-deps", "a-dep", "--only-missing", "--filter", "root", "--filter", "web"],
    dir,
  );
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    { ...ROOT, dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } },
    API,
    { name: "web", dependencies: { "a-dep": "^1.0.10", "no-deps": "1.0.0" } },
    PKG_A,
    PKG_B,
  ]);
});

test.concurrent("a local path is relative to the cwd and re-spelled for each target (pnpm#9368)", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);

  const { stderr, exitCode } = await run(["add", "./vendor/foo", "--filter", "root", "--filter", "api"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    { ...ROOT, dependencies: { foo: "./vendor/foo" } },
    { name: "api", dependencies: { foo: "../../vendor/foo" } },
    WEB,
    PKG_A,
    PKG_B,
  ]);
  expect(await file(join(dir, "node_modules", "foo", "package.json")).json()).toStrictEqual(VENDOR_FOO);

  const frozen = await run(["install", "--frozen-lockfile"], dir, { linker: "hoisted" });
  expect(frozen.stderr).toBe("");
  expect(frozen.exitCode).toBe(0);
});

test.concurrent("a file: path keeps its prefix and resolves from a nested cwd", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);

  const { stderr, exitCode } = await run(["add", "file:../../vendor/foo", "--filter", "api"], dir, {
    cwd: join(dir, "packages", "web"),
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    ROOT,
    { name: "api", dependencies: { foo: "file:../../vendor/foo" } },
    WEB,
    PKG_A,
    PKG_B,
  ]);
});

test.concurrent("a local path that does not exist relative to the cwd fails and writes nothing", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);
  const before = await allPackageJsonTexts(dir);

  // Relative to packages/api this would exist; paths are relative to the cwd (the root) instead.
  const { stderr, exitCode } = await run(["add", "../../vendor/foo", "--filter", "api"], dir);
  expect(stderr).toStartWith(
    'error: Could not find package.json for "file:../../vendor/foo" dependency "../../../../vendor/foo"\n',
  );
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
});

test.concurrent("--filter writes the same entry as running bun add inside the workspace (pnpm#7194)", async () => {
  const dir = await makeMonorepo();

  for (const flags of [[], ["-E"]]) {
    const dep = flags.length ? "no-deps" : "a-dep";
    const filtered = await run(["add", dep, ...flags, "--filter", "pkg-a"], dir);
    expect(filtered.stderr).toBe("Saved lockfile\n");
    expect(filtered.exitCode).toBe(0);

    const inside = await run(["add", dep, ...flags], dir, { cwd: join(dir, "packages", "api") });
    expect(inside.stderr).toBe("Saved lockfile\n");
    expect(inside.exitCode).toBe(0);
  }

  const dependencies = { "a-dep": "^1.0.10", "no-deps": "2.0.0" };
  await expectWorkspaces(dir, [ROOT, { name: "api", dependencies }, WEB, { name: "pkg-a", dependencies }, PKG_B]);
});

test.concurrent("a directory name is not a package name for a scoped workspace (pnpm#5601)", async () => {
  const dir = await makeMonorepo({ "pkg-a": { name: "@org/pkg-a" } });
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "pkg-a"], dir);
    expect(stderr).toBe('error: No workspace packages matched the filter "pkg-a"\n');
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  }

  // The second pattern finds the entry the first one wrote, so it has nothing to save: it selected the same workspace.
  for (const [pattern, saved] of [
    ["*/pkg-a", "Saved lockfile\n"],
    ["./packages/pkg-a", ""],
  ]) {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", pattern], dir);
    expect(stderr).toBe(saved);
    expect(exitCode).toBe(0);
  }
  await expectWorkspaces(dir, [ROOT, API, WEB, plus({ name: "@org/pkg-a" }), PKG_B]);
});

test.concurrent("a name glob does not cross the scope separator (pnpm#3452)", async () => {
  const dir = await makeMonorepo({ "pkg-a": { name: "@org/date-utils" }, "pkg-b": { name: "string-utils" } });

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*-utils"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);
    await expectWorkspaces(dir, [ROOT, API, WEB, { name: "@org/date-utils" }, plus({ name: "string-utils" })]);
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "*/*-utils"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);
    await expectWorkspaces(dir, [
      ROOT,
      API,
      WEB,
      plus({ name: "@org/date-utils" }, "a-dep", "^1.0.10"),
      plus({ name: "string-utils" }),
    ]);
  }
});

test.concurrent("a negated pattern wins regardless of flag order (pnpm#9354)", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "!./packages/*", "--filter", "api"], dir);
  expect(stderr).toBe('error: No workspace packages matched the filters "!./packages/*", "api"\n');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
});

// Only the brace form `{./packages}` is a subtree selector; a bare path must name a workspace directory.
test.concurrent("a path pattern naming the parent directory selects nothing (pnpm#5508)", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "./packages"], dir);
    expect(stderr).toBe('error: No workspace packages matched the filter "./packages"\n');
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
    expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "./packages/*"], dir);
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);
    await expectWorkspaces(dir, [ROOT, plus(API), plus(WEB), plus(PKG_A), plus(PKG_B)]);
  }
});

test.concurrent("an empty --filter value is a no-match error, not a crash (pnpm#5051)", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", ""], dir);
  expect(stderr).toBe('error: No workspace packages matched the filter ""\n');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

test.concurrent("path filters resolve against --cwd (pnpm#5270)", async () => {
  const dir = await makeMonorepo();
  const { packageDir: elsewhere } = await registry.createTestDir();

  const { stderr, exitCode } = await run(["add", "no-deps", "--cwd", dir, "--filter", "./packages/api"], dir, {
    cwd: elsewhere,
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [ROOT, plus(API), WEB, PKG_A, PKG_B]);
  expect(await exists(join(elsewhere, "package.json"))).toBeFalse();
  expect(await exists(join(elsewhere, "bun.lock"))).toBeFalse();
});

// Coverage pass: request assignment, local-path spellings, write-back and selector edge cases.

const NO_DEPS_AND_FOO = (foo: string) => ({ foo, "no-deps": "^2.0.0" });

test.concurrent.each([
  ["no-deps", "./vendor/foo"],
  ["./vendor/foo", "no-deps"],
])("a registry request and a local path (%s %s) are both assigned to every target", async (first, second) => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);

  const { stderr, exitCode } = await run(["add", first, second, "--filter", "root", "--filter", "api"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    { ...ROOT, dependencies: NO_DEPS_AND_FOO("./vendor/foo") },
    { name: "api", dependencies: NO_DEPS_AND_FOO("../../vendor/foo") },
    WEB,
    PKG_A,
    PKG_B,
  ]);
  await installUnchanged(dir, "hoisted");
});

// `link:` resolves against the global link dir (same failure without --filter); the error shows the per-target spelling.
test.concurrent("a link: path is re-spelled relative to the target before it is resolved", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "link:./vendor/foo", "--filter", "api"], dir);
  expect(stderr).toContain('error: Package "link:../../vendor/foo" is not linked');
  expect(stderr).not.toContain('"link:./vendor/foo"');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
});

test.concurrent.each([
  ["./vendor/foo-1.0.0.tgz", "../../vendor/foo-1.0.0.tgz"],
  ["file:./vendor/foo-1.0.0.tgz", "file:../../vendor/foo-1.0.0.tgz"],
])("a local tarball %s is re-spelled as %s", async (positional, written) => {
  const dir = await makeMonorepo();
  await mkdir(join(dir, "vendor"));
  await Bun.Archive.write(
    join(dir, "vendor", "foo-1.0.0.tgz"),
    { "package/package.json": JSON.stringify(VENDOR_FOO) },
    { compress: "gzip" },
  );
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", positional, "--filter", "api"], dir, { linker: "hoisted" });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api"], "foo", written);
  expect((await lockfileJson(dir)).workspaces["packages/api"].dependencies).toStrictEqual({ foo: written });
  expect(await file(join(dir, "node_modules", "foo", "package.json")).json()).toStrictEqual(VENDOR_FOO);
});

test.concurrent("an aliased local path keeps the alias as the key and re-spells the path", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "myfoo@file:./vendor/foo", "--filter", "api"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api"], "myfoo", "file:../../vendor/foo");
  expect((await lockfileJson(dir)).workspaces["packages/api"].dependencies).toStrictEqual({
    myfoo: "file:../../vendor/foo",
  });
  // An alias that differs from the package name is nested under the workspace, as without --filter.
  expect(await file(join(dir, "packages", "api", "node_modules", "myfoo", "package.json")).json()).toStrictEqual(
    VENDOR_FOO,
  );
});

test.concurrent("an aliased local path is shared by targets at the same depth", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(
    ["add", "myfoo@file:./vendor/foo", "--filter", "api", "--filter", "web"],
    dir,
    { linker: "hoisted" },
  );
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api", "web"], "myfoo", "file:../../vendor/foo");
});

test.concurrent(
  "an aliased local path spelled differently per target is rejected before anything is written",
  async () => {
    const dir = await makeMonorepo();
    await addVendorFoo(dir);
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(
      ["add", "myfoo@file:./vendor/foo", "--filter", "root", "--filter", "api"],
      dir,
    );
    expect(stderr).toBe(
      'error: "myfoo@file:../../vendor/foo" is spelled differently relative to each selected workspace; add it to one workspace at a time\n',
    );
    expect(exitCode).toBe(1);

    expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
    expect(await exists(join(dir, "bun.lock"))).toBeFalse();
    expect(await exists(join(dir, "node_modules"))).toBeFalse();
  },
);

test.concurrent("an absolute local path is written verbatim into every target", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);
  const abs = join(dir, "vendor", "foo");

  const { stderr, exitCode } = await run(["add", abs, "--filter", "root", "--filter", "api"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  const literal = abs.replaceAll("\\", "/");
  await expectWorkspaces(dir, [plus(ROOT, "foo", literal), plus(API, "foo", literal), WEB, PKG_A, PKG_B]);
});

test.concurrent("a workspaces entry naming a missing directory is an error and nothing is written", async () => {
  const dir = await makeMonorepo({ root: { name: "root", workspaces: ["packages/*", "missing/dir"] } });
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
  expect(stderr).toContain('\nerror: Workspace not found "missing/dir"\n');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

test.concurrent("an unparsable root package.json is an error and nothing is written", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"' });
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
  expect(stderr).toMatch(/^error: failed to parse package\.json ".*package\.json": ParserError$/m);
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

test.concurrent("remove --filter --dry-run touches nothing", async () => {
  const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "^2.0.0" } } });
  await installOk(dir, "hoisted");
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stdout, stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api", "--dry-run"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("");
  expect(stdoutLines(stdout)).toStrictEqual([
    HEADER("remove"),
    "",
    " api@workspace:packages/api",
    " pkg-a@workspace:packages/pkg-a",
    " pkg-b@workspace:packages/pkg-b",
    " web@workspace:packages/web",
    " a-dep@1.0.1",
    "- no-deps",
    "1 package removed",
  ]);
  expect(exitCode).toBe(0);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent.skipIf(isWindows || process.getuid?.() === 0)(
  "an unwritable target is reported by name, the rest is still written, exit code 1",
  async () => {
    const dir = await makeMonorepo();
    const apiBefore = await pkgText(dir, "api");
    await chmod(pkgPath(dir, "api"), 0o444);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--filter", "web"], dir, {
      linker: "hoisted",
    });
    expect(stderr).toContain("error: failed to write package.json for workspace 'api'");
    expect(stderr).not.toContain("workspace 'web'");
    expect(exitCode).toBe(1);

    expect(await pkgText(dir, "api")).toBe(apiBefore);
    expect(await pkg(dir, "web")).toStrictEqual({
      name: "web",
      dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" },
    });
    const { workspaces } = await lockfileJson(dir);
    expect(workspaces["packages/api"]).toStrictEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
    expect(workspaces["packages/web"]).toStrictEqual({
      name: "web",
      dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" },
    });
  },
);

test.concurrent("--trust --filter writes trustedDependencies into every target, not the root", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const rootBefore = await pkgText(dir, "root");

  const { stderr, exitCode } = await run(["add", "uses-what-bin@1.0.0", "--trust", "--filter", "pkg-*"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    ROOT,
    API,
    WEB,
    { name: "pkg-a", dependencies: { "uses-what-bin": "1.0.0" }, trustedDependencies: ["uses-what-bin"] },
    { name: "pkg-b", dependencies: { "uses-what-bin": "1.0.0" }, trustedDependencies: ["uses-what-bin"] },
  ]);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect((await lockfileJson(dir)).trustedDependencies).toStrictEqual(["uses-what-bin"]);
  expect(await exists(join(dir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
});

test.concurrent("each target keeps its own indentation and trailing-newline style", async () => {
  const dir = await makeMonorepo({
    root: '{ "name": "root", "workspaces": ["packages/*"] }',
    api: '{\n\t"name": "api"\n}\n',
    web: '{\n    "name": "web"\n}',
    "pkg-a": '{\n  "name": "pkg-a"\n}\n',
    "pkg-b": '{\n  "name": "pkg-b"\n}',
  });
  const rootBefore = await pkgText(dir, "root");

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  expect(await allPackageJsonTexts(dir)).toStrictEqual([
    rootBefore,
    '{\n\t"name": "api",\n\t"dependencies": {\n\t\t"no-deps": "^2.0.0"\n\t}\n}\n',
    '{\n    "name": "web",\n    "dependencies": {\n        "no-deps": "^2.0.0"\n    }\n}',
    '{\n  "name": "pkg-a",\n  "dependencies": {\n    "no-deps": "^2.0.0"\n  }\n}\n',
    '{\n  "name": "pkg-b",\n  "dependencies": {\n    "no-deps": "^2.0.0"\n  }\n}',
  ]);
});

const ROOT_GRAPH = {
  root: { ...ROOT, dependencies: { api: "workspace:*" } },
  api: { name: "api", dependencies: { "pkg-a": "workspace:*" } },
};

test.concurrent.each<[string, Workspace[]]>([
  ["root...", ["root", "api", "pkg-a"]],
  ["root^...", ["api", "pkg-a"]],
])("a relation based on the root ('%s') edits %p", async (pattern, edited) => {
  const dir = await makeMonorepo(ROOT_GRAPH);
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", pattern], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, edited);
});

test.concurrent("workspace: and npm: positionals write the same entry as an unfiltered add", async () => {
  const dir = await makeMonorepo({ "pkg-a": { name: "pkg-a", version: "1.2.3" } });
  const [rootBefore, , webBefore, pkgABefore, pkgBBefore] = await allPackageJsonTexts(dir);

  for (const positional of ["pkg-a@workspace:*", "alias@npm:no-deps"]) {
    const filtered = await run(["add", positional, "--filter", "api"], dir, { linker: "hoisted" });
    expect(filtered.stderr).toBe("Saved lockfile\n");
    expect(filtered.exitCode).toBe(0);
  }
  expect(await allPackageJsonTexts(dir)).toStrictEqual([
    rootBefore,
    await pkgText(dir, "api"),
    webBefore,
    pkgABefore,
    pkgBBefore,
  ]);
  const { workspaces } = await lockfileJson(dir);
  expect(workspaces["packages/api"].dependencies).toStrictEqual((await pkg(dir, "api")).dependencies);

  for (const positional of ["pkg-a@workspace:*", "alias@npm:no-deps"]) {
    const inside = await run(["add", positional], dir, { cwd: join(dir, "packages", "web"), linker: "hoisted" });
    expect(inside.stderr).toBe("Saved lockfile\n");
    expect(inside.exitCode).toBe(0);
  }
  const [api, web] = await Promise.all([pkg(dir, "api"), pkg(dir, "web")]);
  expect(api.dependencies).toStrictEqual({ "pkg-a": "workspace:*", alias: "npm:no-deps@^2.0.0" });
  expect(web.dependencies).toStrictEqual({ ...WEB.dependencies, ...api.dependencies });
});

test.concurrent("a relation with an unreadable bun.lock warns and regenerates it, like any other add", async () => {
  const dir = await makeMonorepo(GRAPH);
  await write(join(dir, "bun.lock"), "this is not a lockfile\n");
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api..."], dir);
  expect(stderr).toEndWith("\nwarn: Ignoring lockfile\nSaved lockfile\n");
  expect(stderr).not.toContain("needed by --filter");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api", "pkg-a"]);
  expect((await lockfileJson(dir)).workspaces["packages/api"].dependencies).toStrictEqual({
    "pkg-a": "workspace:*",
    "no-deps": "^2.0.0",
  });
});

test.concurrent("the install summary comes from a target that received every request", async () => {
  // The root (first target) already has no-deps, so under --only-missing only web receives both.
  const dir = await makeMonorepo({ root: { ...ROOT, dependencies: { "no-deps": "1.0.0" } }, web: { name: "web" } });

  const { stdout, stderr, exitCode } = await run(
    ["add", "no-deps", "a-dep", "--only-missing", "--filter", "root", "--filter", "web"],
    dir,
    { linker: "hoisted" },
  );
  expect(stderr).toBe("Saved lockfile\n");
  expect(stdoutLines(stdout)).toStrictEqual([
    HEADER("add"),
    "",
    "installed a-dep@1.0.10",
    "installed no-deps@2.0.0",
    "",
    "4 packages installed",
  ]);
  expect(exitCode).toBe(0);

  await expectWorkspaces(dir, [
    { ...ROOT, dependencies: { "no-deps": "1.0.0", "a-dep": "^1.0.10" } },
    API,
    { name: "web", dependencies: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } },
    PKG_A,
    PKG_B,
  ]);
});

test.concurrent("'!!name' is a positive selector", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "!!api"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api"]);
});

test.concurrent("'**' selects every workspace except the root, like '*'", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "**"], dir);
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api", "web", "pkg-a", "pkg-b"]);
});

test.concurrent("a name declared in two groups stays in sync with bun.lock after a filtered --peer add", async () => {
  // The peer range admits both versions: a peer pinned to the old version re-resolves differently on every install, with or without --filter.
  const dir = await makeMonorepo({
    api: {
      name: "api",
      dependencies: { "no-deps": "1.0.0" },
      peerDependencies: { "no-deps": "*" },
    },
  });
  await installOk(dir, "hoisted");

  const { stderr, exitCode } = await run(["add", "no-deps", "--peer", "--filter", "api"], dir, { linker: "hoisted" });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // Same as an unfiltered add: the entry that already exists (in dependencies) is updated in place.
  const api = await pkg(dir, "api");
  expect(api).toStrictEqual({
    name: "api",
    dependencies: { "no-deps": "^2.0.0" },
    peerDependencies: { "no-deps": "*" },
  });
  const { workspaces } = await lockfileJson(dir);
  expect(workspaces["packages/api"]).toStrictEqual(api);

  const frozen = await run(["install", "--frozen-lockfile"], dir, { linker: "hoisted" });
  expect(frozen.stderr).not.toContain("error:");
  expect(frozen.exitCode).toBe(0);

  const second = await run(["install"], dir, { linker: "hoisted" });
  expect(second.stderr).not.toContain("Saved lockfile");
  expect(second.stderr).not.toContain("error:");
  expect(second.exitCode).toBe(0);
});

// --catalog combined with --filter: the root edit must come out the same as from a member's cwd.

const CATALOG_ROOT = (catalog: Record<string, string>) => ({ ...ROOT, catalog });

const indentOf = (line: string) => line.match(/^\s*/)![0].length;

test.concurrent.each([
  ["reused", '{ "name": "root", "workspaces": ["packages/*"], "catalog": { "no-deps": "1.0.0" } }', "1.0.0"],
  ["seeded", '{ "name": "root", "workspaces": ["packages/*"], "catalog": {} }', "^2.0.0"],
])(
  "add --catalog --filter writes a single-line root exactly like an unfiltered add (%s entry)",
  async (_label, root, entry) => {
    const [filtered, unfiltered] = await Promise.all([makeMonorepo({ root }), makeMonorepo({ root })]);

    const a = await run(["add", "no-deps", "--catalog", "--filter", "pkg-b"], filtered, { linker: "hoisted" });
    expect(a.stderr).toBe("Saved lockfile\n");
    expect(a.exitCode).toBe(0);
    const b = await run(["add", "no-deps", "--catalog"], unfiltered, {
      cwd: join(unfiltered, "packages", "pkg-b"),
      linker: "hoisted",
    });
    expect(b.stderr).toBe("Saved lockfile\n");
    expect(b.exitCode).toBe(0);

    const rootText = await pkgText(filtered, "root");
    expect(rootText).toBe(await pkgText(unfiltered, "root"));
    expect(await pkgText(filtered, "pkg-b")).toBe(await pkgText(unfiltered, "pkg-b"));
    expect(await pkg(filtered, "root")).toStrictEqual(CATALOG_ROOT({ "no-deps": entry }));
    expect(await pkg(filtered, "pkg-b")).toStrictEqual({ name: "pkg-b", dependencies: { "no-deps": "catalog:" } });

    // Whatever the indentation unit, the entry sits one level inside "catalog" and the object closes at column 0.
    const lines = rootText.trimEnd().split("\n");
    if (lines.length > 1) {
      const catalogLine = lines.findIndex(line => line.trimStart().startsWith('"catalog"'));
      expect(catalogLine).toBeGreaterThan(0);
      expect(indentOf(lines[catalogLine])).toBeGreaterThan(0);
      expect(indentOf(lines[catalogLine + 1])).toBe(indentOf(lines[catalogLine]) * 2);
      expect(lines.at(-1)).toBe("}");
    }
  },
);

test.concurrent("add --catalog --filter leaves a root whose entry is reused byte-identical", async () => {
  const dir = await makeMonorepo({
    root: '{\n  "name": "root",\n  "workspaces": ["packages/*"],\n  "catalog": {\n    "no-deps": "1.0.0"\n  }\n}\n',
  });
  const rootBefore = await pkgText(dir, "root");

  const { stderr, exitCode } = await run(["add", "no-deps", "--catalog", "--filter", "pkg-b"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe("Saved lockfile\n");
  expect(exitCode).toBe(0);

  expect(await pkgText(dir, "root")).toBe(rootBefore);
  await expectWorkspaces(dir, [
    CATALOG_ROOT({ "no-deps": "1.0.0" }),
    API,
    WEB,
    PKG_A,
    plus(PKG_B, "no-deps", "catalog:"),
  ]);
  expect((await lockfileJson(dir)).catalog).toStrictEqual({ "no-deps": "1.0.0" });
});

test.concurrent.each([
  [
    "an existing catalog entry",
    { "no-deps": "1.0.0" },
    { name: "api", dependencies: { "no-deps": "catalog:" } },
    "1.0.0",
  ],
  ["an empty catalog", {}, API, "^1.0.0"],
])(
  "add <tarball> --catalog --filter refuses a name the target declares (%s) with a copy-pasteable fix",
  async (_label, catalog, api, declared) => {
    const url = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;
    const dir = await makeMonorepo({
      root: CATALOG_ROOT(catalog),
      api,
      "pkg-b": { name: "pkg-b", dependencies: { "no-deps": declared } },
    });
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", url, "--catalog", "--filter", "pkg-b"], dir, {
      linker: "hoisted",
    });
    expect(stderr).toBe(
      `error: --catalog cannot add "${url}": pkg-b already declares no-deps\n  bun add no-deps@${url} --catalog\n`,
    );
    expect(exitCode).toBe(1);

    expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
    expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  },
);

test.concurrent("add <tarball> --catalog --filter with an existing entry is refused with a lockfile too", async () => {
  const url = `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`;
  const dir = await makeMonorepo({
    root: CATALOG_ROOT({ "no-deps": "1.0.0" }),
    api: { name: "api", dependencies: { "no-deps": "catalog:" } },
    "pkg-b": { name: "pkg-b", dependencies: { "no-deps": "1.0.0" } },
  });
  await installOk(dir, "hoisted");
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stderr, exitCode } = await run(["add", url, "--catalog", "--filter", "pkg-b"], dir, { linker: "hoisted" });
  expect(stderr).toBe(
    `error: --catalog cannot add "${url}": pkg-b already declares no-deps\n  bun add no-deps@${url} --catalog\n`,
  );
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
});

const FOLLOWERS = {
  root: CATALOG_ROOT({ "no-deps": "^2.0.0" }),
  api: { name: "api", dependencies: { "no-deps": "catalog:" } },
  "pkg-a": { name: "pkg-a", dependencies: { "no-deps": "catalog:" } },
  "pkg-b": { name: "pkg-b", dependencies: { "no-deps": "catalog:" } },
};

test.concurrent("add --catalog --filter notes a replaced entry and who else follows it", async () => {
  const dir = await makeMonorepo(FOLLOWERS);

  const { stderr, exitCode } = await run(["add", "no-deps@1.0.0", "--catalog", "--filter", "api"], dir, {
    linker: "hoisted",
  });
  expect(stderr).toBe(
    'note: catalog entry no-deps changed from "^2.0.0" to "1.0.0" (also used by pkg-a, pkg-b)\nSaved lockfile\n',
  );
  expect(exitCode).toBe(0);

  await expectFollowersCatalog(dir, "1.0.0");
  expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
    name: "no-deps",
    version: "1.0.0",
  });
});

/** Only the root's catalog entry (and its copy in bun.lock) moved to `range`; the three `catalog:` users are as written. */
async function expectFollowersCatalog(dir: string, range: string) {
  await expectWorkspaces(dir, [
    CATALOG_ROOT({ "no-deps": range }),
    FOLLOWERS.api,
    WEB,
    FOLLOWERS["pkg-a"],
    FOLLOWERS["pkg-b"],
  ]);
  expect((await lockfileJson(dir)).catalog).toStrictEqual({ "no-deps": range });
}

test.concurrent("add --catalog --filter --silent prints nothing, note included", async () => {
  const dir = await makeMonorepo(FOLLOWERS);

  const { stdout, stderr, exitCode } = await run(
    ["add", "no-deps@1.0.0", "--catalog", "--filter", "api", "--silent"],
    dir,
    { linker: "hoisted" },
  );
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  await expectFollowersCatalog(dir, "1.0.0");
});

test.concurrent("a catalog: range that resolves to nothing names the missing catalog or entry", async () => {
  const dir = await makeMonorepo({ root: CATALOG_ROOT({ "no-deps": "1.0.0" }) });
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps@catalog:missing", "--filter", "api"], dir);
    expect(stderr).toBe(
      'error: no-deps@catalog:missing: there is no catalog named "missing" in the root package.json\n',
    );
    expect(exitCode).toBe(1);
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep@catalog:", "--filter", "api"], dir);
    expect(stderr).toBe("error: a-dep@catalog: is not in the catalog\n  bun add --catalog a-dep\n");
    expect(exitCode).toBe(1);
  }

  expect(await allPackageJsonTexts(dir)).toStrictEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();

  // The same package.json state reached by hand fails the same way under bun install.
  await write(pkgPath(dir, "api"), JSON.stringify({ name: "api", dependencies: { "a-dep": "catalog:" } }));
  const { stderr, exitCode } = await run(["install"], dir);
  expect(stderr).toBe("error: a-dep@catalog: is not in the catalog\n  bun add --catalog a-dep\n");
  expect(exitCode).toBe(1);
});
