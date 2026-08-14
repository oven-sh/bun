import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { exists, mkdir, rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe } from "harness";
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
  return { stdout, stderr, exitCode };
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
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
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

/** `edited` gained `dep: range` in dependencies; every other workspace's package.json is byte-identical to `before`. */
async function expectAddedOnlyTo(
  dir: string,
  before: string[],
  edited: Workspace[],
  dep = "no-deps",
  range = "^2.0.0",
) {
  expect(await declaring(dir, dep)).toEqual(WORKSPACES.filter(w => edited.includes(w)));
  for (const [i, workspace] of WORKSPACES.entries()) {
    if (edited.includes(workspace)) {
      expect((await pkg(dir, workspace)).dependencies[dep]).toBe(range);
    } else {
      expect(await pkgText(dir, workspace)).toBe(before[i]);
    }
  }
}

test.concurrent(
  'add --filter targets one workspace by name (and does not install an npm package called "api")',
  async () => {
    const dir = await makeMonorepo();

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await allPackageJsons(dir)).toEqual([
      ROOT,
      { name: "api", dependencies: { "no-deps": "^2.0.0" } },
      WEB,
      PKG_A,
      PKG_B,
    ]);

    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    });
    // node_modules/api is the linked workspace, not a registry package
    expect(await file(join(dir, "node_modules", "api", "package.json")).json()).toEqual({
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

    expect(await pkg(dir, "api")).toEqual({ name: "api", devDependencies: { "a-dep": "1.0.10" } });
    expect(await pkg(dir, "root")).toEqual(ROOT);
    expect(await pkg(dir, "web")).toEqual(WEB);
  }

  // Same as unfiltered `bun add -d`: an entry that already exists in another list is updated in place.
  {
    const { stderr, exitCode } = await run(["add", "a-dep", "-F", "web", "-d", "-E"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "a-dep": "1.0.10" } });
    expect(await pkg(dir, "api")).toEqual({ name: "api", devDependencies: { "a-dep": "1.0.10" } });
    expect(await pkg(dir, "root")).toEqual(ROOT);
  }
});

test.concurrent("bun install <pkg> --filter carries the filter through", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["install", "no-deps", "--filter", "api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "root")).toEqual(ROOT);
  expect(await pkg(dir, "web")).toEqual(WEB);
});

test.concurrent("glob filter edits every match", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "pkg-*"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await allPackageJsons(dir)).toEqual([
    ROOT,
    API,
    WEB,
    { name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } },
    { name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } },
  ]);
});

test.concurrent("'*' edits every workspace except the root; '!' excludes", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const rootBefore = await pkgText(dir, "root");

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*", "--filter", "!api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await allPackageJsons(dir)).toEqual([
    ROOT,
    API,
    { name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } },
    { name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } },
    { name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } },
  ]);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect((await lockfileJson(dir)).workspaces[""]).toEqual({ name: "root" });
});

test.concurrent("a negation-only filter set skips the root", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const [rootBefore, apiBefore] = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "!api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(await pkgText(dir, "api")).toBe(apiBefore);
  expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "pkg-a")).toEqual({ name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "pkg-b")).toEqual({ name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } });
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
    expect(stderr).toContain("error: No workspace packages matched the filter");
    expect(exitCode).toBe(1);
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "!./packages/*"], dir);
    expect(stderr).toContain("error: No workspace packages matched the filter");
    expect(exitCode).toBe(1);
  }

  expect(await allPackageJsonTexts(dir)).toEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("the root is included by naming it next to '*'", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const rootBefore = await pkgText(dir, "root");

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "*"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkgText(dir, "root")).toBe(rootBefore);
    expect(await declaring(dir, "a-dep")).toEqual(["api", "web", "pkg-a", "pkg-b"]);
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*", "--filter", "root"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await declaring(dir, "no-deps")).toEqual(WORKSPACES);
    expect(await pkg(dir, "root")).toEqual({ ...ROOT, dependencies: { "no-deps": "^2.0.0" } });
  }
});

test.concurrent("'{.}' from the root selects the root and every workspace", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{.}"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await declaring(dir, "no-deps")).toEqual(WORKSPACES);
  expect(await pkg(dir, "root")).toEqual({ ...ROOT, dependencies: { "no-deps": "^2.0.0" } });
});

test.concurrent("'{dir}' selects every workspace under the directory", async () => {
  const dir = await makeMonorepo({ root: '{ "name": "root", "workspaces": ["packages/*"] }' });
  const rootBefore = await pkgText(dir, "root");

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{packages}"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await declaring(dir, "no-deps")).toEqual(["api", "web", "pkg-a", "pkg-b"]);
    expect(await pkgText(dir, "root")).toBe(rootBefore);
  }

  // The braces resolve against the invoking directory.
  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "{..}"], dir, {
      cwd: join(dir, "packages", "web"),
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const [, api, web, pkgA, pkgB] = await allPackageJsons(dir);
    for (const json of [api, web, pkgA, pkgB]) {
      expect(json.dependencies["a-dep"]).toBe("^1.0.10");
    }
    expect(await pkgText(dir, "root")).toBe(rootBefore);
  }
});

test.concurrent("'{dir}' naming one workspace directory selects just it; '!{dir}' excludes the subtree", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{./packages/pkg-a}"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await expectAddedOnlyTo(dir, before, ["pkg-a"]);
  }

  {
    const after = await allPackageJsonTexts(dir);
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "*", "--filter", "!{./packages}"], dir);
    expect(stderr).toContain('error: No workspace packages matched the filter "*", "!{./packages}"');
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toEqual(after);
  }
});

test.concurrent("a '{dir}' matching nothing is the usual no-match error", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "{./tools}"], dir);
  expect(stderr).toContain('error: No workspace packages matched the filter "{./tools}"');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
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
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("warn:");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, edited);
});

test.concurrent("a negated relation subtracts the whole closure", async () => {
  {
    const dir = await makeMonorepo(GRAPH);
    await installOk(dir);
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*", "--filter", "!...api"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["pkg-a", "pkg-b"]);
  }

  // Negation-only: everything except the closure, and (for add) except the root.
  {
    const dir = await makeMonorepo(GRAPH);
    await installOk(dir);
    const before = await allPackageJsonTexts(dir);

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "!...api"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["pkg-a", "pkg-b"]);
  }
});

test.concurrent("two relation selectors union", async () => {
  const dir = await makeMonorepo(GRAPH);
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api...", "--filter", "...api"], dir);
  expect(stderr).not.toContain("error:");
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
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    await expectAddedOnlyTo(dir, before, ["api", "web"]);
    expect((await lockfileJson(dir)).workspaces[""].dependencies).toEqual({ api: "workspace:*" });
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
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect((await read(dir, "x").json()).dependencies).toEqual({ y: "workspace:*", "no-deps": "^2.0.0" });
    expect((await read(dir, "y").json()).dependencies).toEqual({ x: "workspace:*", "no-deps": "^2.0.0" });
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
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect((await read(dir, "y").json()).dependencies).toEqual({ x: "workspace:*", "no-deps": "^2.0.0" });
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

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api..."], dir, { linker: "hoisted" });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "pkg-a": "workspace:*" } });
  expect(await pkg(dir, "pkg-a")).toEqual({ name: "pkg-a" });
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
    expect(stderr).toContain('warn: No workspace packages matched the filter "...^web"');
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await expectAddedOnlyTo(dir, before, ["api"]);
  }

  {
    const before = await allPackageJsonTexts(dir);
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "nope..."], dir);
    expect(stderr).toContain('error: No workspace packages matched the filter "nope..."');
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toEqual(before);
  }
});

test.concurrent("a relation needs a lockfile; a name selector does not", async () => {
  const dir = await makeMonorepo(GRAPH);
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api..."], dir);
    expect(stderr).toContain(
      'error: --filter "api..." selects workspaces by their dependency graph, which needs a bun.lock; run bun install first',
    );
    expect(exitCode).toBe(1);

    expect(await allPackageJsonTexts(dir)).toEqual(before);
    expect(await exists(join(dir, "bun.lock"))).toBeFalse();
    expect(await exists(join(dir, "node_modules"))).toBeFalse();
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await expectAddedOnlyTo(dir, before, ["api"]);
  }
});

test.concurrent("a bare '...' is rejected", async () => {
  const dir = await makeMonorepo();
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "..."], dir);
  expect(stderr).toContain('error: --filter "..." is missing a workspace name or path');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
});

test.concurrent(
  "install --filter with a positive and a negated pattern installs only the positive matches",
  async () => {
    const dir = await makeMonorepo({
      root: { ...ROOT, dependencies: { "a-dep": "1.0.1" } },
      api: { name: "api", dependencies: { "no-deps": "2.0.0" } },
      "pkg-a": { name: "pkg-a", dependencies: { "is-number": "1.0.0" } },
    });

    const { stderr, exitCode } = await run(["install", "--filter", "api", "--filter", "!web"], dir, {
      linker: "hoisted",
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(
      await Promise.all([
        exists(join(dir, "node_modules", "no-deps", "package.json")),
        exists(join(dir, "node_modules", "a-dep")),
        exists(join(dir, "node_modules", "is-number")),
      ]),
    ).toEqual([true, false, false]);
  },
);

test.concurrent("install --filter with relations installs the closure only", async () => {
  const dir = await makeMonorepo({
    root: { ...ROOT, dependencies: { "basic-1": "1.0.0" } },
    api: { name: "api", dependencies: { "pkg-a": "workspace:*", "no-deps": "2.0.0" } },
    web: { name: "web", dependencies: { api: "workspace:*", "a-dep": "1.0.1" } },
    "pkg-a": { name: "pkg-a", dependencies: { "is-number": "1.0.0" } },
    "pkg-b": { name: "pkg-b", dependencies: { "left-pad": "1.0.0" } },
  });
  const installed = (name: string) => exists(join(dir, "node_modules", name));

  {
    const { stderr, exitCode } = await run(["install", "--filter", "api..."], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(
      await Promise.all(["no-deps", "is-number", "api", "pkg-a", "a-dep", "left-pad", "basic-1"].map(installed)),
    ).toEqual([true, true, true, true, false, false, false]);
  }

  {
    const { stderr, exitCode } = await run(["install", "--filter", "...^pkg-a"], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await Promise.all(["a-dep", "left-pad", "basic-1"].map(installed))).toEqual([true, false, false]);
  }
});

// add/remove error on zero matches; install warns and keeps its documented no-op.
test.concurrent("install --filter with a pattern that matches nothing warns and exits 0", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["install", "--filter", "nope"], dir, { linker: "hoisted" });
  expect(stderr).toContain('warn: No workspace packages matched the filter "nope"');
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

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
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("no-deps");
    expect(stdout).toContain("a-dep");
    expect(stdout).not.toContain("is-number");
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, stderr, exitCode } = await run(["outdated", "--filter", "...^api"], dir);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("is-number");
    expect(stdout).not.toContain("no-deps");
    expect(stdout).not.toContain("a-dep");
    expect(exitCode).toBe(0);
  }
});

test.concurrent("path filter, run from inside another workspace", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "./packages/api"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
    expect(await pkg(dir, "root")).toEqual(ROOT);
    expect(await pkg(dir, "web")).toEqual(WEB);
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "../api"], dir, {
      cwd: join(dir, "packages", "web"),
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({
      name: "api",
      dependencies: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" },
    });
    expect(await pkg(dir, "root")).toEqual(ROOT);
    expect(await pkg(dir, "web")).toEqual(WEB);
  }
});

test.concurrent("no match is an error and nothing is written", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "does-not-exist"], dir);
  expect(stderr).toContain("error: No workspace packages matched the filter");
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
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
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({ name: "api" });
    expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "no-deps": "^2.0.0" } });
    expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "web"], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "web")).toEqual({ name: "web" });
    expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
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

  const { stderr, exitCode } = await run(["remove", "no-deps", "a-dep", "--filter", "*"], dir, { linker: "hoisted" });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await allPackageJsons(dir)).toEqual([{ ...ROOT, dependencies: deps }, API, { name: "web" }, PKG_A, PKG_B]);
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(
    await Promise.all([
      exists(join(dir, "node_modules", "no-deps", "package.json")),
      exists(join(dir, "node_modules", "a-dep", "package.json")),
    ]),
  ).toEqual([true, true]);
  expect((await lockfileJson(dir)).workspaces[""].dependencies).toEqual(deps);
});

test.concurrent("add --filter with an existing lockfile re-resolves only the added dep", async () => {
  const dir = await makeMonorepo();
  await installOk(dir, "hoisted");

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "web"], dir, { linker: "hoisted" });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "web")).toEqual({
    name: "web",
    dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" },
  });
  expect(await file(join(dir, "node_modules", "a-dep", "package.json")).json()).toEqual({
    name: "a-dep",
    version: "1.0.1",
  });
  expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "2.0.0",
  });
});

test.concurrent("--dry-run writes nothing", async () => {
  const dir = await makeMonorepo();
  const before = await pkgText(dir, "api");

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--dry-run"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkgText(dir, "api")).toBe(before);
  expect(await pkg(dir, "root")).toEqual(ROOT);
});

// Ported from pnpm's filtered add/remove suites and pacquet's install_filters.rs.

test.concurrent(
  "add --only-missing --filter leaves an existing entry untouched in the target that has it",
  async () => {
    const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "1.0.0" } } });
    const apiBefore = await pkgText(dir, "api");

    const { stderr, exitCode } = await run(["add", "no-deps", "--only-missing", "--filter", "*"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkgText(dir, "api")).toBe(apiBefore);
    expect(await allPackageJsons(dir)).toEqual([
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
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } });
});

test.concurrent("add --only-missing --filter where every target already has it writes nothing", async () => {
  const dir = await makeMonorepo({
    api: '{"name":"api","dependencies":{"no-deps":"1.0.0"}}',
    web: '{"name":"web","dependencies":{"no-deps":"1.0.1"}}',
  });
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(
    ["add", "no-deps", "--only-missing", "--filter", "api", "--filter", "web"],
    dir,
  );
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
});

test.concurrent("remove --filter leaves targets that did not contain the dependency byte-identical", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "no-deps": "^2.0.0" } },
    web: '{"name":"web","dependencies":{"a-dep":"1.0.1"}}',
    "pkg-a": '{ "name": "pkg-a" }',
  });
  await installOk(dir, "hoisted");
  const [rootBefore, , webBefore, pkgABefore] = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api", "--filter", "web"], dir, {
    linker: "hoisted",
  });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api" });
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

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "*"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
});

test.concurrent("add/remove --filter with the isolated linker links only the target workspace", async () => {
  const dir = await makeMonorepo({}, "isolated");
  const stale = join(dir, "packages", "web", "node_modules", "stale", "package.json");
  await write(stale, '{"name":"stale"}');

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir, { linker: "isolated" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
    expect(await file(join(dir, "packages", "api", "node_modules", "no-deps", "package.json")).json()).toEqual({
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
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, { linker: "isolated" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({ name: "api" });
    expect(await pkg(dir, "web")).toEqual(WEB);
    // The isolated installer does not yet prune packages/api/node_modules/no-deps (same as unfiltered `bun remove`).
    expect(await file(join(dir, "bun.lock")).text()).not.toContain("no-deps");
  }

  await installOk(dir, "isolated");
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
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("installed no-deps@2.0.0");
  expect(stdout).toMatch(/\b2 packages installed\b/);
  expect(exitCode).toBe(0);

  expect(await installed()).toEqual([true, true, false, false, false, true]);
  expect(await file(join(dir, "bun.lock")).text()).toContain('"a-dep@1.0.1"');

  await installOk(dir, "hoisted");
  expect(await installed()).toEqual([true, true, true, true, true, true]);
});

test.concurrent("add --filter leaves the root's own dependencies alone unless the root is selected", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, dependencies: { "is-number": "1.0.0" } } });
  const installed = (name: string) => exists(join(dir, "node_modules", name));

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*"], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await Promise.all(["is-number", "api", "web", "pkg-a", "pkg-b", "a-dep", "no-deps"].map(installed))).toEqual(
      [false, true, true, true, true, true, true],
    );
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "root"], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await installed("is-number")).toBeTrue();
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

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, { linker: "hoisted" });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api" });
  expect(await pkgText(dir, "web")).toBe(webBefore);
  expect(await installed()).toEqual([true, false, false, false]);
  expect((await lockfileJson(dir)).packages["no-deps"]).toBeDefined();

  await installOk(dir, "hoisted");
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
  expect(await exists(join(dir, "node_modules", "a-dep"))).toBeTrue();
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
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api", "pkg-a"]);
  expect(
    await Promise.all(
      ["api", "pkg-a", "no-deps", "web", "a-dep", "is-number"].map(name => exists(join(dir, "node_modules", name))),
    ),
  ).toEqual([true, true, true, false, false, false]);
});

test.concurrent("outdated --filter warns about a positive pattern that matched nothing", async () => {
  const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "1.0.0" } } });
  await installOk(dir);

  {
    const { stdout, stderr, exitCode } = await run(["outdated", "--filter", "api", "--filter", "typo"], dir);
    expect(stderr).toContain('warn: No workspace packages matched the filter "typo"');
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("no-deps");
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, stderr, exitCode } = await run(["outdated", "--filter", "api", "--filter", "!typo"], dir);
    expect(stderr).not.toContain("warn:");
    expect(stdout).toContain("no-deps");
    expect(exitCode).toBe(0);
  }
});

test.concurrent("--filter=<pattern> is accepted before the subcommand", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["--filter=api", "add", "no-deps"], dir, { linker: "hoisted" });
  expect(stderr).not.toContain("error:");
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
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } });
  expect(await pkgText(dir, "root")).toBe(rootBefore);
  expect(await pkgText(dir, "pkg-a")).toBe(pkgABefore);
  expect(await pkgText(dir, "pkg-b")).toBe(pkgBBefore);
});

test.concurrent("remove --filter with no match names the pattern and touches nothing", async () => {
  const dir = await makeMonorepo({ api: { name: "api", dependencies: { "no-deps": "^2.0.0" } } });
  await installOk(dir, "hoisted");
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "nope"], dir, { linker: "hoisted" });
  expect(stderr).toContain('error: No workspace packages matched the filter "nope"');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
  expect(await file(join(dir, "bun.lock")).text()).toBe(lockBefore);
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("a filter that matches nothing warns when another filter matched", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--filter", "typo"], dir);
  expect(stderr).toContain('warn: No workspace packages matched the filter "typo"');
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
});

test.concurrent("negated filters that match nothing do not warn", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--filter", "!nothing"], dir);
  expect(stderr).not.toContain("warn:");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
});

test.concurrent("an explicit version is written verbatim to every target", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "a-dep@1.0.1", "--filter", "pkg-*"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "pkg-a")).toStrictEqual({ name: "pkg-a", dependencies: { "a-dep": "1.0.1" } });
    expect(await pkg(dir, "pkg-b")).toStrictEqual({ name: "pkg-b", dependencies: { "a-dep": "1.0.1" } });
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps@^1.0.0", "--filter", "web"], dir, { linker: "hoisted" });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "web")).toStrictEqual({
      name: "web",
      dependencies: { "a-dep": "1.0.1", "no-deps": "^1.0.0" },
    });
    expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.1.0",
    });
  }
});

test.concurrent("--peer and --optional target the right list in every selected workspace", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--peer", "--filter", "pkg-*"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "pkg-a")).toStrictEqual({ name: "pkg-a", peerDependencies: { "no-deps": "^2.0.0" } });
    expect(await pkg(dir, "pkg-b")).toStrictEqual({ name: "pkg-b", peerDependencies: { "no-deps": "^2.0.0" } });
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--optional", "--filter", "pkg-a"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "pkg-a")).toStrictEqual({
      name: "pkg-a",
      optionalDependencies: { "a-dep": "^1.0.10" },
      peerDependencies: { "no-deps": "^2.0.0" },
    });
    expect(await pkg(dir, "pkg-b")).toStrictEqual({ name: "pkg-b", peerDependencies: { "no-deps": "^2.0.0" } });
  }
});

test.concurrent("the root can be selected by name", async () => {
  const dir = await makeMonorepo();
  const [, ...membersBefore] = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "root"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "root")).toEqual({ ...ROOT, dependencies: { "no-deps": "^2.0.0" } });
  const [, ...membersAfter] = await allPackageJsonTexts(dir);
  expect(membersAfter).toEqual(membersBefore);
});

test.concurrent("'.' selects the workspace of the invoking directory", async () => {
  const dir = await makeMonorepo();

  {
    const [, ...membersBefore] = await allPackageJsonTexts(dir);
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "."], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "root")).toEqual({ ...ROOT, dependencies: { "a-dep": "^1.0.10" } });
    const [, ...membersAfter] = await allPackageJsonTexts(dir);
    expect(membersAfter).toEqual(membersBefore);
  }

  {
    const rootBefore = await pkgText(dir, "root");
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "."], dir, {
      cwd: join(dir, "packages", "web"),
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } });
    expect(await pkgText(dir, "root")).toBe(rootBefore);
    expect(await pkg(dir, "api")).toEqual(API);
  }
});

test.concurrent("a directory excluded by a '!' entry in workspaces is never a target", async () => {
  const dir = await makeMonorepo({ root: { name: "root", workspaces: ["packages/*", "!packages/web"] } });
  const webBefore = await pkgText(dir, "web");

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await allPackageJsons(dir)).toEqual([
      { name: "root", workspaces: ["packages/*", "!packages/web"] },
      { name: "api", dependencies: { "no-deps": "^2.0.0" } },
      WEB,
      { name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } },
      { name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } },
    ]);
    expect(await pkgText(dir, "web")).toBe(webBefore);
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "web"], dir);
    expect(stderr).toContain("error: No workspace packages matched the filter");
    expect(exitCode).toBe(1);
    expect(await pkgText(dir, "web")).toBe(webBefore);
  }
});

test.concurrent("workspaces: { packages: [...] } object form is honoured", async () => {
  const dir = await makeMonorepo({ root: { name: "root", workspaces: { packages: ["packages/*"] } } });

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "root")).toEqual({ name: "root", workspaces: { packages: ["packages/*"] } });
});

test.concurrent("scoped workspace names match a scope glob", async () => {
  const dir = await makeMonorepo({ "pkg-a": { name: "@acme/a" }, "pkg-b": { name: "@acme/b" } });

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "@acme/*"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await allPackageJsons(dir)).toEqual([
      ROOT,
      API,
      WEB,
      { name: "@acme/a", dependencies: { "no-deps": "^2.0.0" } },
      { name: "@acme/b", dependencies: { "no-deps": "^2.0.0" } },
    ]);
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "@acme/a"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "pkg-a")).toEqual({ name: "@acme/a" });
    expect(await pkg(dir, "pkg-b")).toEqual({ name: "@acme/b", dependencies: { "no-deps": "^2.0.0" } });
  }
});

test.concurrent("add --filter --lockfile-only edits package.json and bun.lock but installs nothing", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api", "--lockfile-only"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect(await file(join(dir, "bun.lock")).text()).toContain('"no-deps@2.0.0"');
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
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await exists(join(dir, "packages", "api", "src", "package.json"))).toBeFalse();
  }

  {
    const { stderr, exitCode } = await run(["install", "a-dep", "--filter", "web"], dir, {
      cwd: join(dir, "tools", "scratch"),
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await exists(join(dir, "tools", "scratch", "package.json"))).toBeFalse();
  }

  expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "a-dep": "^1.0.10", "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "api")).toEqual(API);
  expect(await pkg(dir, "root")).toEqual(ROOT);
});

test.concurrent.each(["add", "install"])(
  "%s <pkg> --filter outside any project fails without creating package.json",
  async cmd => {
    const { packageDir } = await registry.createTestDir();

    const { stderr, exitCode } = await run([cmd, "no-deps", "--filter", "web"], packageDir);
    expect(stderr).toContain("error: Bun could not find a package.json file to install from");
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
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const lockfile = await lockfileJson(dir);
  expect(lockfile.workspaces["packages/api"]).toEqual({ name: "api" });
  expect(lockfile.workspaces["packages/web"]).toEqual({
    name: "web",
    dependencies: { api: "workspace:*", "no-deps": "^2.0.0" },
  });
  expect(lockfile.packages["no-deps"]).toBeDefined();
  expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
});

test.concurrent("bun install <pkg> -F targets the workspace", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["install", "no-deps", "-F", "api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "root")).toEqual(ROOT);
});

// The root is only skipped by '*' when there are workspaces to select instead.
test.concurrent("--filter outside a workspace: the lone package is the only candidate", async () => {
  const { packageDir } = await registry.createTestDir({ files: { "package.json": JSON.stringify({ name: "solo" }) } });

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*"], packageDir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "solo",
      dependencies: { "no-deps": "^2.0.0" },
    });
  }

  {
    const before = await file(join(packageDir, "package.json")).text();
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "other"], packageDir);
    expect(stderr).toContain("error: No workspace packages matched the filter");
    expect(exitCode).toBe(1);
    expect(await file(join(packageDir, "package.json")).text()).toBe(before);
  }
});

test.concurrent("--filter with --global is rejected", async () => {
  const dir = await makeMonorepo();
  const globalDir = join(dir, ".global");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "add", "no-deps", "-g", "--filter", "api"],
    cwd: dir,
    env: { ...envFor(dir), BUN_INSTALL: globalDir, BUN_INSTALL_GLOBAL_DIR: join(globalDir, "install", "global") },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: --filter cannot be used with --global");
  expect(exitCode).toBe(1);

  expect(await pkg(dir, "api")).toEqual(API);
  expect(await exists(join(globalDir, "install", "global", "node_modules", "no-deps"))).toBeFalse();
});

// Round 3: bugs and non-bugs mined from pnpm's open issue tracker.

const VENDOR_FOO = { name: "foo", version: "1.0.0" };

async function addVendorFoo(dir: string) {
  await write(join(dir, "vendor", "foo", "package.json"), JSON.stringify(VENDOR_FOO));
}

test.concurrent("package.json is written even when a root postinstall fails (pnpm#8627)", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, scripts: { postinstall: "exit 1" } } });

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "root", "--filter", "api"], dir);
  expect(stderr).toContain('postinstall script from "root" exited with 1');
  expect(exitCode).toBe(1);

  expect((await pkg(dir, "root")).dependencies).toEqual({ "no-deps": "^2.0.0" });
  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  const { workspaces } = await lockfileJson(dir);
  expect(workspaces[""].dependencies).toEqual({ "no-deps": "^2.0.0" });
  expect(workspaces["packages/api"]).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
});

test.concurrent("the root's lifecycle scripts do not run when --filter leaves the root out", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, scripts: { postinstall: "exit 1" } } });
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
  expect(stderr).not.toContain("postinstall");
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  await expectAddedOnlyTo(dir, before, ["api"]);
});

test.concurrent("a failed resolution leaves every target untouched", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "does-not-exist-anywhere", "--filter", "pkg-*"], dir);
  expect(stderr).toContain(`error: GET ${registry.registryUrl()}does-not-exist-anywhere - 404`);
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
});

test.concurrent("bun.lock records the resolved range for every target, not just the first", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "pkg-*"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const { workspaces } = await lockfileJson(dir);
  expect(workspaces["packages/pkg-a"]).toEqual({ name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } });
  expect(workspaces["packages/pkg-b"]).toEqual({ name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } });

  const second = await run(["install"], dir);
  expect(second.stderr).not.toContain("Saved lockfile");
  expect(second.exitCode).toBe(0);
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
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "root")).toEqual({ ...ROOT, dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "a-dep": "^1.0.10", "no-deps": "1.0.0" } });
});

test.concurrent("a local path is relative to the cwd and re-spelled for each target (pnpm#9368)", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);

  const { stderr, exitCode } = await run(["add", "./vendor/foo", "--filter", "root", "--filter", "api"], dir, {
    linker: "hoisted",
  });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "root")).toEqual({ ...ROOT, dependencies: { foo: "./vendor/foo" } });
  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { foo: "../../vendor/foo" } });
  expect(await pkg(dir, "web")).toEqual(WEB);
  const { workspaces } = await lockfileJson(dir);
  expect(workspaces[""].dependencies).toEqual({ foo: "./vendor/foo" });
  expect(workspaces["packages/api"].dependencies).toEqual({ foo: "../../vendor/foo" });
  expect(await file(join(dir, "node_modules", "foo", "package.json")).json()).toEqual(VENDOR_FOO);

  const frozen = await run(["install", "--frozen-lockfile"], dir, { linker: "hoisted" });
  expect(frozen.stderr).not.toContain("error:");
  expect(frozen.exitCode).toBe(0);
});

test.concurrent("a file: path keeps its prefix and resolves from a nested cwd", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);

  const { stderr, exitCode } = await run(["add", "file:../../vendor/foo", "--filter", "api"], dir, {
    cwd: join(dir, "packages", "web"),
  });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { foo: "file:../../vendor/foo" } });
  expect(await pkg(dir, "web")).toEqual(WEB);
});

test.concurrent("a local path that does not exist relative to the cwd fails and writes nothing", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);
  const before = await allPackageJsonTexts(dir);

  // Relative to packages/api this would exist; paths are relative to the cwd (the root) instead.
  const { stderr, exitCode } = await run(["add", "../../vendor/foo", "--filter", "api"], dir);
  expect(stderr).toContain('error: Could not find package.json for "file:');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
});

test.concurrent("--filter writes the same entry as running bun add inside the workspace (pnpm#7194)", async () => {
  const dir = await makeMonorepo();

  for (const flags of [[], ["-E"]]) {
    const dep = flags.length ? "no-deps" : "a-dep";
    const filtered = await run(["add", dep, ...flags, "--filter", "pkg-a"], dir);
    expect(filtered.stderr).not.toContain("error:");
    expect(filtered.exitCode).toBe(0);

    const inside = await run(["add", dep, ...flags], dir, { cwd: join(dir, "packages", "api") });
    expect(inside.stderr).not.toContain("error:");
    expect(inside.exitCode).toBe(0);
  }

  const [pkgA, api] = await Promise.all([pkg(dir, "pkg-a"), pkg(dir, "api")]);
  expect(pkgA.dependencies).toEqual({ "a-dep": "^1.0.10", "no-deps": "2.0.0" });
  expect(api.dependencies).toEqual(pkgA.dependencies);
});

test.concurrent("a directory name is not a package name for a scoped workspace (pnpm#5601)", async () => {
  const dir = await makeMonorepo({ "pkg-a": { name: "@org/pkg-a" } });
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "pkg-a"], dir);
    expect(stderr).toContain('error: No workspace packages matched the filter "pkg-a"');
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toEqual(before);
  }

  for (const pattern of ["*/pkg-a", "./packages/pkg-a"]) {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", pattern], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }
  expect(await pkg(dir, "pkg-a")).toEqual({ name: "@org/pkg-a", dependencies: { "no-deps": "^2.0.0" } });
});

test.concurrent("a name glob does not cross the scope separator (pnpm#3452)", async () => {
  const dir = await makeMonorepo({ "pkg-a": { name: "@org/date-utils" }, "pkg-b": { name: "string-utils" } });

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*-utils"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await pkg(dir, "pkg-a")).toEqual({ name: "@org/date-utils" });
    expect(await pkg(dir, "pkg-b")).toEqual({ name: "string-utils", dependencies: { "no-deps": "^2.0.0" } });
  }

  {
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "*/*-utils"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await pkg(dir, "pkg-a")).toEqual({ name: "@org/date-utils", dependencies: { "a-dep": "^1.0.10" } });
    expect(await pkg(dir, "pkg-b")).toEqual({ name: "string-utils", dependencies: { "no-deps": "^2.0.0" } });
  }
});

test.concurrent("a negated pattern wins regardless of flag order (pnpm#9354)", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "!./packages/*", "--filter", "api"], dir);
  expect(stderr).toContain("error: No workspace packages matched the filter");
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
});

// Only the brace form `{./packages}` is a subtree selector; a bare path must name a workspace directory.
test.concurrent("a path pattern naming the parent directory selects nothing (pnpm#5508)", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "./packages"], dir);
    expect(stderr).toContain("error: No workspace packages matched the filter");
    expect(exitCode).toBe(1);
    expect(await allPackageJsonTexts(dir)).toEqual(before);
  }

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "./packages/*"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await allPackageJsons(dir)).toEqual([
      ROOT,
      { name: "api", dependencies: { "no-deps": "^2.0.0" } },
      { name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } },
      { name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } },
      { name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } },
    ]);
  }
});

test.concurrent("an empty --filter value is a no-match error, not a crash (pnpm#5051)", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", ""], dir);
  expect(stderr).toContain('error: No workspace packages matched the filter ""');
  expect(exitCode).toBe(1);

  expect(await allPackageJsonTexts(dir)).toEqual(before);
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

test.concurrent("path filters resolve against --cwd (pnpm#5270)", async () => {
  const dir = await makeMonorepo();
  const { packageDir: elsewhere } = await registry.createTestDir();

  const { stderr, exitCode } = await run(["add", "no-deps", "--cwd", dir, "--filter", "./packages/api"], dir, {
    cwd: elsewhere,
  });
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "root")).toEqual(ROOT);
  expect(await exists(join(elsewhere, "package.json"))).toBeFalse();
});
