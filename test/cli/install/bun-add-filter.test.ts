import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { exists, mkdir } from "fs/promises";
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

// `--linker` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
async function run(args: string[], cwd: string, linker?: Linker) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, ...(linker ? ["--linker", linker] : [])],
    cwd,
    env: bunEnv,
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

async function installOk(dir: string, linker?: Linker) {
  const { stderr, exitCode } = await run(["install"], dir, linker);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
}

test.concurrent(
  'add --filter targets one workspace by name (and does not install an npm package called "api")',
  async () => {
    const dir = await makeMonorepo();

    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
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

test.concurrent("'*' edits every workspace including the root; '!' excludes", async () => {
  const dir = await makeMonorepo();

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "*", "--filter", "!api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await allPackageJsons(dir)).toEqual([
    { ...ROOT, dependencies: { "no-deps": "^2.0.0" } },
    API,
    { name: "web", dependencies: { "a-dep": "1.0.1", "no-deps": "^2.0.0" } },
    { name: "pkg-a", dependencies: { "no-deps": "^2.0.0" } },
    { name: "pkg-b", dependencies: { "no-deps": "^2.0.0" } },
  ]);
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
    const { stderr, exitCode } = await run(["add", "a-dep", "--filter", "../api"], join(dir, "packages", "web"));
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
  const before = await Promise.all(WORKSPACES.map(w => pkgText(dir, w)));

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "does-not-exist"], dir);
  expect(stderr).toContain("error: No workspace packages matched the filter");
  expect(exitCode).toBe(1);

  expect(await Promise.all(WORKSPACES.map(w => pkgText(dir, w)))).toEqual(before);
  expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
});

test.concurrent("remove --filter removes from the matched workspace only", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "no-deps": "^2.0.0" } },
    web: { name: "web", dependencies: { "no-deps": "^2.0.0" } },
  });

  {
    const { stderr, exitCode } = await run(["install"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await exists(join(dir, "bun.lock"))).toBeTrue();
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({ name: "api" });
    expect(await pkg(dir, "web")).toEqual({ name: "web", dependencies: { "no-deps": "^2.0.0" } });
    expect(await exists(join(dir, "node_modules", "no-deps", "package.json"))).toBeTrue();
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "web"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "web")).toEqual({ name: "web" });
    expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
  }
});

test.concurrent("remove --filter '*' with multiple packages", async () => {
  const deps = { "no-deps": "^2.0.0", "a-dep": "^1.0.10" };
  const dir = await makeMonorepo({
    root: { ...ROOT, dependencies: deps },
    api: { name: "api", dependencies: deps },
    web: { name: "web", dependencies: deps },
  });

  {
    const { stderr, exitCode } = await run(["install"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  const { stderr, exitCode } = await run(["remove", "no-deps", "a-dep", "--filter", "*"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await allPackageJsons(dir)).toEqual([ROOT, API, { name: "web" }, PKG_A, PKG_B]);
});

test.concurrent("add --filter with an existing lockfile re-resolves only the added dep", async () => {
  const dir = await makeMonorepo();

  {
    const { stderr, exitCode } = await run(["install"], dir);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "web"], dir);
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

// Ported from pnpm's filtered add/remove suites (installing/commands/test/miscRecursive.ts, addRecursive.ts,
// remove/workspace.ts, pnpm/test/recursive/filter.ts) and pacquet's install_filters.rs.

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
      { ...ROOT, dependencies: { "no-deps": "^2.0.0" } },
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
  await installOk(dir);
  const [rootBefore, , webBefore, pkgABefore] = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api", "--filter", "web"], dir);
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

  {
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir, "isolated");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
    expect(await file(join(dir, "packages", "api", "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    });
    expect(await exists(join(dir, "packages", "web", "node_modules", "no-deps"))).toBeFalse();
    expect(await exists(join(dir, "node_modules", "no-deps"))).toBeFalse();
  }

  {
    const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir, "isolated");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await pkg(dir, "api")).toEqual({ name: "api" });
    expect(await pkg(dir, "web")).toEqual(WEB);
    // The isolated installer does not yet prune packages/api/node_modules/no-deps (same as unfiltered `bun remove`).
    expect(await file(join(dir, "bun.lock")).text()).not.toContain("no-deps");
  }
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
  await installOk(dir);
  const before = await allPackageJsonTexts(dir);
  const lockBefore = await file(join(dir, "bun.lock")).text();

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "nope"], dir);
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
  expect(exitCode).toBe(0);
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
    const { stderr, exitCode } = await run(["add", "no-deps@^1.0.0", "--filter", "web"], dir);
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
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "."], join(dir, "packages", "web"));
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
      { name: "root", workspaces: ["packages/*", "!packages/web"], dependencies: { "no-deps": "^2.0.0" } },
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
    const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "web"], join(dir, "packages", "api", "src"));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await exists(join(dir, "packages", "api", "src", "package.json"))).toBeFalse();
  }

  {
    const { stderr, exitCode } = await run(["install", "a-dep", "--filter", "web"], join(dir, "tools", "scratch"));
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
    expect(stderr).toContain("error:");
    expect(exitCode).toBe(1);

    expect(await exists(join(packageDir, "package.json"))).toBeFalse();
  },
);

test.concurrent("filtered remove keeps the unselected workspace's lockfile entries", async () => {
  const dir = await makeMonorepo({
    api: { name: "api", dependencies: { "no-deps": "^2.0.0" } },
    web: { name: "web", dependencies: { api: "workspace:*", "no-deps": "^2.0.0" } },
  });
  await installOk(dir);

  const { stderr, exitCode } = await run(["remove", "no-deps", "--filter", "api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const lockfile = JSON.parse(
    await file(join(dir, "bun.lock"))
      .text()
      .then(t => t.replace(/,(\s*[}\]])/g, "$1")),
  );
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
    env: { ...bunEnv, BUN_INSTALL: globalDir, BUN_INSTALL_GLOBAL_DIR: join(globalDir, "install", "global") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: --filter cannot be used with --global");
  expect(exitCode).toBe(1);

  expect(await pkg(dir, "api")).toEqual(API);
  expect(await exists(join(globalDir, "install", "global", "node_modules", "no-deps"))).toBeFalse();
});

// Round 3: bugs and non-bugs mined from pnpm's open issue tracker.

function lockfileJson(dir: string) {
  return file(join(dir, "bun.lock"))
    .text()
    .then(t => JSON.parse(t.replace(/,(\s*[}\]])/g, "$1")));
}

const VENDOR_FOO = { name: "foo", version: "1.0.0" };

async function addVendorFoo(dir: string) {
  await write(join(dir, "vendor", "foo", "package.json"), JSON.stringify(VENDOR_FOO));
}

test.concurrent("package.json is written even when a root postinstall fails (pnpm#8627)", async () => {
  const dir = await makeMonorepo({ root: { ...ROOT, scripts: { postinstall: "exit 1" } } });

  const { stderr, exitCode } = await run(["add", "no-deps", "--filter", "api"], dir);
  expect(stderr).toContain('postinstall script from "root" exited with 1');
  expect(exitCode).toBe(1);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect((await lockfileJson(dir)).workspaces["packages/api"]).toEqual({
    name: "api",
    dependencies: { "no-deps": "^2.0.0" },
  });
});

test.concurrent("a failed resolution leaves every target untouched", async () => {
  const dir = await makeMonorepo();
  const before = await allPackageJsonTexts(dir);

  const { stderr, exitCode } = await run(["add", "does-not-exist-anywhere", "--filter", "pkg-*"], dir);
  expect(stderr).toContain("error:");
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

  const { stderr, exitCode } = await run(["add", "./vendor/foo", "--filter", "root", "--filter", "api"], dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "root")).toEqual({ ...ROOT, dependencies: { foo: "./vendor/foo" } });
  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { foo: "../../vendor/foo" } });
  expect(await pkg(dir, "web")).toEqual(WEB);
  const { workspaces } = await lockfileJson(dir);
  expect(workspaces[""].dependencies).toEqual({ foo: "./vendor/foo" });
  expect(workspaces["packages/api"].dependencies).toEqual({ foo: "../../vendor/foo" });
  expect(await file(join(dir, "node_modules", "foo", "package.json")).json()).toEqual(VENDOR_FOO);

  const frozen = await run(["install", "--frozen-lockfile"], dir);
  expect(frozen.stderr).not.toContain("error:");
  expect(frozen.exitCode).toBe(0);
});

test.concurrent("a file: path keeps its prefix and resolves from a nested cwd", async () => {
  const dir = await makeMonorepo();
  await addVendorFoo(dir);

  const { stderr, exitCode } = await run(
    ["add", "file:../../vendor/foo", "--filter", "api"],
    join(dir, "packages", "web"),
  );
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
  expect(stderr).toContain("error:");
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

    const inside = await run(["add", dep, ...flags], join(dir, "packages", "api"));
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

  const { stderr, exitCode } = await run(["add", "no-deps", "--cwd", dir, "--filter", "./packages/api"], elsewhere);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await pkg(dir, "api")).toEqual({ name: "api", dependencies: { "no-deps": "^2.0.0" } });
  expect(await pkg(dir, "root")).toEqual(ROOT);
  expect(await exists(join(elsewhere, "package.json"))).toBeFalse();
});
