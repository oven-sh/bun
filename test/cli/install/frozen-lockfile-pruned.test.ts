import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, lstat } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";
import { dirname, join } from "path";

type Linker = "hoisted" | "isolated";
type PackageJson = Record<string, unknown>;
type Tree = { root: PackageJson; packages: Record<string, PackageJson>; files?: Record<string, string> };

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

const rootPackageJson: PackageJson = { name: "mono", workspaces: ["packages/*"], trustedDependencies: ["a-dep"] };
const appPackageJson: PackageJson = {
  name: "app",
  version: "1.0.0",
  bin: { "app-cli": "cli.js" },
  dependencies: { shared: "workspace:*", "a-dep": "1.0.1" },
};
const sharedPackageJson: PackageJson = {
  name: "shared",
  version: "1.0.0",
  peerDependencies: { "no-deps": "*" },
  peerDependenciesMeta: { "no-deps": { optional: true } },
};
const otherPackageJson: PackageJson = {
  name: "other",
  version: "1.0.0",
  dependencies: { shared: "workspace:*", "no-deps": "1.0.0", "left-pad": "1.0.0" },
};

async function writeTree(dir: string, tree: Tree, workspaces: string[] = Object.keys(tree.packages)) {
  await Promise.all([
    write(join(dir, "package.json"), JSON.stringify(tree.root)),
    ...workspaces.map(path => write(join(dir, path, "package.json"), JSON.stringify(tree.packages[path]))),
    ...Object.entries(tree.files ?? {})
      .filter(([path]) => {
        const owner = Object.keys(tree.packages).find(ws => path.startsWith(ws + "/"));
        return owner === undefined || workspaces.includes(owner);
      })
      .map(([path, contents]) => write(join(dir, path), contents)),
  ]);
}

const survivors = ["packages/app", "packages/shared"];

const monorepo: Tree = {
  root: rootPackageJson,
  packages: {
    "packages/app": appPackageJson,
    "packages/shared": sharedPackageJson,
    "packages/other": otherPackageJson,
  },
  files: { "packages/app/cli.js": "" },
};

// turbo prune rewrites the root workspaces list to the survivors and copies everything else, trustedDependencies included.
const turboOutput: Tree = { ...monorepo, root: { ...rootPackageJson, workspaces: survivors } };

const explicitMonorepo: Tree = {
  ...monorepo,
  root: { ...rootPackageJson, workspaces: ["packages/app", "packages/shared", "packages/other"] },
};

const withApp = (extra: PackageJson): Tree => ({
  ...monorepo,
  packages: { ...monorepo.packages, "packages/app": { ...appPackageJson, ...extra } },
});

const survivorTree = withApp({ dependencies: { ...(appPackageJson.dependencies as object), other: "workspace:*" } });
const rootSurvivorTree: Tree = { ...monorepo, root: { ...rootPackageJson, dependencies: { other: "workspace:*" } } };

const aDepPatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;
const aDepPatchedDependencies = { "a-dep@1.0.1": "patches/a-dep@1.0.1.patch" };
const patchedMonorepo: Tree = {
  ...monorepo,
  root: { ...rootPackageJson, patchedDependencies: aDepPatchedDependencies },
  files: { ...monorepo.files, "patches/a-dep@1.0.1.patch": aDepPatch },
};
const patchedLockLine = '"a-dep@1.0.1": "patches/a-dep@1.0.1.patch"';
const changedSectionNote = (section: "overrides" | "the catalog") =>
  `note: ${section} in package.json changed since bun.lock was saved`;

const survivorError = (dependent: string, ws = "other") =>
  `workspace "${dependent}" depends on workspace "${ws}" (packages/${ws}), which is listed in bun.lock but not on disk`;
const rootSurvivorError =
  'the root package depends on workspace "other" (packages/other), which is listed in bun.lock but not on disk';
const survivorNote = "note: a pruned checkout must keep every workspace that its remaining workspaces depend on";

const catalogTree: Tree = {
  root: { name: "mono", workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1", "left-pad": "1.0.0" } } },
  packages: {
    "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:" } },
    "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "catalog:" } },
  },
};

const namedCatalogTree: Tree = {
  root: {
    name: "mono",
    workspaces: { packages: ["packages/*"], catalogs: { build: { "a-dep": "1.0.1", "left-pad": "1.0.0" } } },
  },
  packages: {
    "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:build" } },
    "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "catalog:build" } },
  },
};

// Scoped to the top-level catalog/catalogs block so importer rows, package rows and overrides are out of reach.
function trimCatalogLine(lock: string, name: string, spec: string): string {
  const line = new RegExp(`^ +"${name}": "${spec}",\\n`, "m");
  let trimmed = lock;
  let removed = 0;
  for (const header of ['\n  "catalog": {\n', '\n  "catalogs": {\n']) {
    const start = lock.indexOf(header);
    if (start === -1) continue;
    const end = lock.indexOf("\n  },", start);
    expect(end).toBeGreaterThan(start);
    // Keep the closing line's leading newline so the block's last entry still ends in "\n".
    const block = lock.slice(start, end + 1);
    const matches = block.match(new RegExp(line.source, "gm")) ?? [];
    removed += matches.length;
    trimmed = trimmed.replace(block, block.replace(line, ""));
  }
  expect(removed).toBe(1);
  expect(trimmed).not.toBe(lock);
  return trimmed;
}

const singleCatalogEntryTree: Tree = {
  root: { name: "mono", workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1" } } },
  packages: { "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:" } } },
};

const defaultCatalogBlock = '\n  "catalog": {\n    "a-dep": "1.0.1",\n  },\n';

// A fresh checkout of the whole tree whose bun.lock also lists the one catalog entry under `"catalogs": {"default": ...}`.
async function doubleListedScenario() {
  const { full } = await fullInstall("hoisted", singleCatalogEntryTree);
  expect(full).toContain(defaultCatalogBlock);
  expect(full).not.toContain('"catalogs"');
  const doubled = full.replace(
    defaultCatalogBlock,
    `${defaultCatalogBlock}  "catalogs": {\n    "default": {\n      "a-dep": "1.0.1",\n    },\n  },\n`,
  );
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await writeTree(packageDir, singleCatalogEntryTree);
  await write(join(packageDir, "bun.lock"), doubled);
  return { packageDir, doubled };
}

const binFiles = (dir: string, name: string) =>
  isWindows
    ? [join(dir, "node_modules", ".bin", `${name}.exe`), join(dir, "node_modules", ".bin", `${name}.bunx`)]
    : [join(dir, "node_modules", ".bin", name)];

async function spawnBun(dir: string, args: string[], cwd = dir, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    // CI exports BUN_INSTALL_CACHE_DIR, which overrides the bunfig's per-test `cache`; concurrent cases sharing one cache race on Windows.
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"), ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const raw = (dir: string, linker: Linker, args: string[], cwd = dir) =>
  spawnBun(dir, [...args, "--linker", linker], cwd);

const quoted = (names: string[]) => names.map(name => `"${name}"`).join(", ");
const prunedNote = 'note: skipped 1 workspace listed in bun.lock but not on disk: "other"';
const catalogNote = (...names: string[]) =>
  `note: skipped ${names.length} catalog ${names.length === 1 ? "entry" : "entries"} not in bun.lock (unused by the workspaces on disk): ${quoted(names)}`;

async function run(dir: string, linker: Linker, args: string[], expectedExitCode: number, cwd = dir) {
  const { stdout, stderr, exitCode } = await raw(dir, linker, args, cwd);
  if (expectedExitCode === 0) {
    expect(stderr).not.toContain("error:");
  } else {
    expect(stderr).toContain("lockfile had changes, but lockfile is frozen");
  }
  expect(exitCode).toBe(expectedExitCode);
  return { stdout, stderr, exitCode };
}

const install = (dir: string, linker: Linker) => run(dir, linker, ["install"], 0);
const frozen = (dir: string, linker: Linker, expectedExitCode: number, cmd = ["install", "--frozen-lockfile"]) =>
  run(dir, linker, cmd, expectedExitCode);

async function fullInstall(linker: Linker, tree: Tree) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
  await writeTree(packageDir, tree);
  const { stderr } = await install(packageDir, linker);
  expect(stderr).toContain("Saved lockfile");
  return { fullDir: packageDir, full: await file(join(packageDir, "bun.lock")).text() };
}

// A full install of `tree`, then a second checkout with only `keep` on disk and the full bun.lock copied verbatim.
async function verbatimScenario(linker: Linker, tree: Tree, keep: string[]) {
  const { fullDir, full } = await fullInstall(linker, tree);
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
  await writeTree(packageDir, tree, keep);
  await write(join(packageDir, "bun.lock"), full);
  return { packageDir, fullDir, full };
}

const fullLockfiles = new Map<Linker, Promise<string>>();

function fullLockfile(linker: Linker): Promise<string> {
  let lock = fullLockfiles.get(linker);
  if (!lock) {
    lock = fullInstall(linker, monorepo).then(({ full }) => {
      expect(full).toContain('"no-deps"');
      expect(full).toContain('"left-pad"');
      expect(full).toContain('"packages/other"');
      expect(full).toContain('"trustedDependencies"');
      expect(full).toContain('"app-cli"');
      return full;
    });
    fullLockfiles.set(linker, lock);
  }
  return lock;
}

const trustedDependenciesSection = /\n  "trustedDependencies": \[\n(?:    [^\n]*\n)*  \],/;
const workspaceBinField = /,\n      "bin": \{\n(?:        [^\n]*\n)*      \}/;

// The three edits turbo prune makes to Bun's own bun.lock: workspace + exclusive packages removed, trustedDependencies emitted empty (i.e. omitted), workspace bin dropped.
function stripTurboFields(lock: string): string {
  expect(lock).toContain('"trustedDependencies"');
  expect(lock).toContain('"app-cli"');
  const pruned = lock
    .replace(/    "packages\/other": \{\n(?:      .*\n)*    \},\n/, "")
    .replace(/\n    "(?:other|left-pad)": \[[^\n]*\],\n\n?/g, "\n")
    .replace(trustedDependenciesSection, "")
    .replace(workspaceBinField, "");
  expect(pruned).not.toContain('"trustedDependencies"');
  expect(pruned).not.toContain('"bin"');
  expect(pruned).toContain('"packages/app"');
  expect(pruned).not.toContain('"other"');
  expect(pruned).not.toContain('"left-pad"');
  return pruned;
}

function turboPrune(lock: string): string {
  const pruned = stripTurboFields(lock);
  expect(pruned).toContain('"no-deps": ["no-deps@1.0.0"');
  return pruned;
}

async function prunedTree(linker: Linker) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
  await writeTree(packageDir, turboOutput, survivors);
  const pruned = turboPrune(await fullLockfile(linker));
  await write(join(packageDir, "bun.lock"), pruned);
  return { packageDir, pruned };
}

async function verbatimTree(linker: Linker) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
  await writeTree(packageDir, monorepo, survivors);
  const full = await fullLockfile(linker);
  await write(join(packageDir, "bun.lock"), full);
  return { packageDir, full };
}

const lockText = (dir: string) => file(join(dir, "bun.lock")).text();

async function editApp(dir: string, edit: (app: any) => void) {
  const appJson = join(dir, "packages", "app", "package.json");
  const app = await file(appJson).json();
  edit(app);
  await write(appJson, JSON.stringify(app));
}

function installedPath(dir: string, linker: Linker, name: string, version: string) {
  return linker === "hoisted"
    ? join(dir, "node_modules", name, "package.json")
    : join(dir, "node_modules", ".bun", `${name}@${version}`, "node_modules", name, "package.json");
}

describe.each(["hoisted", "isolated"] as Linker[])("linker: %s", linker => {
  // Also pins that the optional-peer-bound no-deps is installed even though only the pruned workspace needed it (pnpm#6264).
  test.concurrent(
    "turbo output: peer-held package survives --frozen-lockfile although turbo dropped trustedDependencies and the workspace bin from bun.lock",
    async () => {
      const { packageDir, pruned } = await prunedTree(linker);

      await frozen(packageDir, linker, 0);

      expect(await lockText(packageDir)).toBe(pruned);
      const noDeps =
        linker === "hoisted"
          ? join(packageDir, "node_modules", "no-deps", "package.json")
          : join(packageDir, "packages", "shared", "node_modules", "no-deps", "package.json");
      expect(await file(noDeps).json()).toStrictEqual({ name: "no-deps", version: "1.0.0" });
    },
  );

  test.concurrent(
    "turbo output: plain bun install writes only trustedDependencies back and keeps the peer-held package",
    async () => {
      const { packageDir } = await prunedTree(linker);

      const { stderr } = await install(packageDir, linker);

      expect(stderr).toContain("Saved lockfile");
      const lock = await lockText(packageDir);
      expect(lock).toContain('"trustedDependencies": [\n    "a-dep",\n  ],');
      expect(lock).toContain('"no-deps": ["no-deps@1.0.0"');
      expect(lock).not.toContain('"other"');
      expect(lock).not.toContain('"left-pad"');

      const second = await frozen(packageDir, linker, 0);

      expect(second.stderr).not.toContain("Saved lockfile");
      expect(await lockText(packageDir)).toBe(lock);
    },
  );

  test.concurrent("verbatim full lockfile with a workspace folder missing passes --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimTree(linker);

    await frozen(packageDir, linker, 0);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    if (linker === "hoisted") {
      expect((await lstat(join(packageDir, "node_modules", "app"))).isSymbolicLink()).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
        name: "a-dep",
        version: "1.0.1",
      });
    } else {
      expect(await exists(join(packageDir, "node_modules", ".bun", "left-pad@1.0.0"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", ".bun", "a-dep@1.0.1"))).toBeTrue();
      expect(
        await file(join(packageDir, "packages", "app", "node_modules", "a-dep", "package.json")).json(),
      ).toMatchObject({
        name: "a-dep",
        version: "1.0.1",
      });
    }
  });

  test.concurrent("second --frozen-lockfile install on a pruned tree is a no-op", async () => {
    const { packageDir, pruned } = await prunedTree(linker);
    await frozen(packageDir, linker, 0);

    const { stderr } = await frozen(packageDir, linker, 0);

    expect(stderr).not.toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(pruned);
    const noDeps =
      linker === "hoisted"
        ? join(packageDir, "node_modules", "no-deps", "package.json")
        : join(packageDir, "packages", "shared", "node_modules", "no-deps", "package.json");
    expect(await file(noDeps).json()).toStrictEqual({ name: "no-deps", version: "1.0.0" });
  });

  test.concurrent("a real package.json change in a pruned tree still fails --frozen-lockfile", async () => {
    const { packageDir, pruned } = await prunedTree(linker);
    await editApp(packageDir, app => (app.dependencies["no-deps"] = "2.0.0"));

    await frozen(packageDir, linker, 1);

    expect(await lockText(packageDir)).toBe(pruned);
  });

  test.concurrent("a missing workspace is still removed from the lockfile by a non-frozen install", async () => {
    const { packageDir } = await verbatimTree(linker);

    const { stderr } = await install(packageDir, linker);

    expect(stderr).toContain("Saved lockfile");
    const lock = await lockText(packageDir);
    expect(lock).not.toContain('"packages/other"');
    expect(lock).not.toContain('"left-pad"');
    expect(await exists(join(packageDir, "packages", "other"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "left-pad", "1.0.0"))).toBeFalse();
  });

  test.concurrent("scoped workspace whose folder name differs from its package name is pruned", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        "packages/app": appPackageJson,
        "packages/shared": sharedPackageJson,
        "packages/other-dir": { name: "@mono/other", version: "1.0.0", dependencies: { "left-pad": "1.0.0" } },
      },
    };
    const { packageDir, full } = await verbatimScenario(linker, tree, survivors);
    expect(full).toContain('"packages/other-dir"');

    await frozen(packageDir, linker, 0);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "@mono"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "left-pad", "1.0.0"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "a-dep", "1.0.1"))).toBeTrue();
  });

  test.concurrent("several workspaces pruned at once", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        ...monorepo.packages,
        "packages/other2": { name: "other2", version: "1.0.0", dependencies: { "is-number": "1.0.0" } },
      },
    };
    const { packageDir, full } = await verbatimScenario(linker, tree, survivors);
    expect(full).toContain('"packages/other2"');

    await frozen(packageDir, linker, 0);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "other2"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "left-pad", "1.0.0"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "is-number", "1.0.0"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "a-dep", "1.0.1"))).toBeTrue();

    await editApp(packageDir, app => (app.dependencies["is-number"] = "2.0.0"));

    await frozen(packageDir, linker, 1);

    expect(await lockText(packageDir)).toBe(full);
  });

  test.concurrent("bun ci behaves the same on the verbatim full lockfile", async () => {
    const { packageDir, full } = await verbatimTree(linker);

    await frozen(packageDir, linker, 0, ["ci"]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "left-pad", "1.0.0"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "a-dep", "1.0.1"))).toBeTrue();
  });

  // pnpm#11364: explicit workspaces list plus a hand-copied full bun.lock; turbo instead rewrites the list (see turboOutput).
  test.concurrent("explicitly listed workspace whose folder is missing passes --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimScenario(linker, explicitMonorepo, survivors);

    const { stderr } = await frozen(packageDir, linker, 0);

    expect(stderr).not.toContain("Workspace not found");
    expect(stderr).toContain(prunedNote);
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "left-pad", "1.0.0"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "a-dep", "1.0.1"))).toBeTrue();
  });

  test.concurrent("bun ci with an explicitly listed workspace whose folder is missing", async () => {
    const { packageDir, full } = await verbatimScenario(linker, explicitMonorepo, survivors);

    const { stderr } = await frozen(packageDir, linker, 0, ["ci"]);

    expect(stderr).not.toContain("Workspace not found");
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "a-dep", "1.0.1"))).toBeTrue();
  });

  // pnpm#7823: the relaxation is not silent, so a stale bun.lock is greppable in CI logs.
  test.concurrent("--frozen-lockfile names how many workspaces it skipped", async () => {
    const { packageDir } = await verbatimTree(linker);

    const { stderr } = await frozen(packageDir, linker, 0);

    expect(stderr).toBe(`${prunedNote}\n`);
  });

  // pnpm#6094: `--lockfile-only` must not write under `--frozen-lockfile`; the extra newline is a byte-level canary.
  test.concurrent("--frozen-lockfile --lockfile-only leaves the pruned bun.lock byte-identical", async () => {
    const { packageDir, pruned } = await prunedTree(linker);
    const canary = pruned + "\n";
    await write(join(packageDir, "bun.lock"), canary);

    const { stdout, stderr } = await frozen(packageDir, linker, 0, ["install", "--frozen-lockfile", "--lockfile-only"]);

    expect(stdout + stderr).not.toContain("Saved");
    expect(await lockText(packageDir)).toBe(canary);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // Guard that passes on main too: the dropped trustedDependencies/bin alone are not a frozen failure.
  test.concurrent("turbo output without a peer-held package passes --frozen-lockfile too", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        "packages/app": appPackageJson,
        "packages/shared": { name: "shared", version: "1.0.0" },
        "packages/other": otherPackageJson,
      },
      files: monorepo.files,
    };
    const { full } = await fullInstall(linker, tree);
    const pruned = stripTurboFields(full).replace(/\n    "no-deps": \[[^\n]*\],\n\n?/, "\n");
    expect(pruned).not.toContain('"no-deps"');
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
    await writeTree(packageDir, { ...tree, root: { ...rootPackageJson, workspaces: survivors } }, survivors);
    await write(join(packageDir, "bun.lock"), pruned);

    await frozen(packageDir, linker, 0);

    expect(await lockText(packageDir)).toBe(pruned);
  });

  // Like trustedDependencies above, patchedDependencies is not part of the frozen comparison (docs/pm/cli/install.mdx).
  test.concurrent("patchedDependencies added after bun.lock was written still passes --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimScenario(linker, monorepo, survivors);
    expect(full).not.toContain('"patchedDependencies"');
    await writeTree(packageDir, patchedMonorepo, survivors);

    const { stderr } = await frozen(packageDir, linker, 0);

    expect(stderr).not.toContain("patchedDependencies");
    expect(await lockText(packageDir)).toBe(full);
    const aDep = installedPath(packageDir, linker, "a-dep", "1.0.1");
    expect(await file(aDep).json()).toMatchObject({ name: "a-dep", version: "1.0.1" });
    expect(await file(join(dirname(aDep), "patched.txt")).text()).toBe("hello world\n");
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();

    const { stderr: plain } = await install(packageDir, linker);

    expect(plain).toContain("Saved lockfile");
    expect(await lockText(packageDir)).toContain(patchedLockLine);
  });

  test.concurrent("patchedDependencies removed after bun.lock was written still passes --frozen-lockfile", async () => {
    const { fullDir, full } = await fullInstall(linker, patchedMonorepo);
    expect(full).toContain(patchedLockLine);
    expect(await exists(join(dirname(installedPath(fullDir, linker, "a-dep", "1.0.1")), "patched.txt"))).toBeTrue();
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
    await writeTree(packageDir, monorepo, survivors);
    await write(join(packageDir, "bun.lock"), full);

    const { stderr } = await frozen(packageDir, linker, 0);

    expect(stderr).not.toContain("patchedDependencies");
    expect(await lockText(packageDir)).toBe(full);
    const aDep = installedPath(packageDir, linker, "a-dep", "1.0.1");
    expect(await file(aDep).json()).toMatchObject({ name: "a-dep", version: "1.0.1" });
    expect(await exists(join(dirname(aDep), "patched.txt"))).toBeFalse();
  });

  test.concurrent("overrides added after bun.lock was written still fail --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimScenario(linker, monorepo, survivors);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ ...rootPackageJson, overrides: { "a-dep": "1.0.1" } }),
    );

    const { stderr } = await frozen(packageDir, linker, 1);

    expect(stderr).toContain(changedSectionNote("overrides"));
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("overrides trimmed from a pruned bun.lock still fail --frozen-lockfile", async () => {
    const tree: Tree = { ...monorepo, root: { ...rootPackageJson, overrides: { "a-dep": "1.0.1" } } };
    const { packageDir, full } = await verbatimScenario(linker, tree, survivors);
    const trimmed = full.replace(/\n  "overrides": \{\n(?:    [^\n]*\n)*  \},/, "");
    expect(full).toContain('"overrides"');
    expect(trimmed).not.toContain('"overrides"');
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, linker, 1);

    expect(stderr).toContain(changedSectionNote("overrides"));
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a catalog entry changed after bun.lock was written still fails --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        ...catalogTree.root,
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.2", "left-pad": "1.0.0" } },
      }),
    );

    const { stderr } = await frozen(packageDir, linker, 1);

    expect(stderr).toContain(changedSectionNote("the catalog"));
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a survivor depending on a pruned workspace fails with the workspace error", async () => {
    const { packageDir, full } = await verbatimScenario(linker, survivorTree, survivors);

    const { stderr, exitCode } = await raw(packageDir, linker, ["install", "--frozen-lockfile"]);

    expect(stderr).toContain(survivorError("app"));
    expect(stderr).toContain(survivorNote);
    expect(stderr).not.toContain('Workspace dependency "other" not found');
    expect(stderr).not.toContain("failed to resolve");
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    expect(exitCode).toBe(1);
  });

  test.concurrent(
    "a plain install reports a survivor depending on a missing workspace with the same error",
    async () => {
      const { packageDir, full } = await verbatimScenario(linker, survivorTree, survivors);

      const { stderr, exitCode } = await raw(packageDir, linker, ["install"]);

      expect(stderr).toContain(survivorError("app"));
      expect(stderr).toContain(survivorNote);
      expect(stderr).not.toContain('Workspace dependency "other" not found');
      expect(stderr).not.toContain("failed to resolve");
      expect(stderr).not.toContain("Saved lockfile");
      expect(await lockText(packageDir)).toBe(full);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent("a catalog entry only the pruned workspace used may be missing from bun.lock", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, linker, 0);

    expect(stderr).toBe(`${prunedNote}\n${catalogNote("left-pad")}\n`);
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(installedPath(packageDir, linker, "a-dep", "1.0.1"))).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "left-pad", "1.0.0"))).toBeFalse();
  });

  // The skipped workspace stays in bun.lock and is still listed, but its
  // exclusive dependency was never installed so `bun pm ls` omits it.
  test.concurrent(
    "bun pm ls --all lists the skipped workspace but not its uninstalled exclusive dependency",
    async () => {
      const { packageDir, full } = await verbatimTree(linker);
      await frozen(packageDir, linker, 0);

      const { stdout, stderr, exitCode } = await spawnBun(packageDir, ["pm", "ls", "--all"]);

      expect(stderr).toBe("");
      expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`
        "<dir> node_modules
        ├── a-dep@1.0.1
        ├── app@workspace:packages/app
        ├── no-deps@1.0.0
        ├── other@workspace:packages/other
        └── shared@workspace:packages/shared"
      `);
      expect(await lockText(packageDir)).toBe(full);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("bun audit still submits the skipped workspace's exclusive dependency", async () => {
    const { packageDir, full } = await verbatimTree(linker);
    await frozen(packageDir, linker, 0);
    const bodies: unknown[] = [];
    await using auditServer = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push(JSON.parse(Buffer.from(Bun.gunzipSync(await req.arrayBuffer())).toString()));
        return Response.json({});
      },
    });

    const { stdout, stderr, exitCode } = await spawnBun(packageDir, ["audit"], packageDir, {
      NPM_CONFIG_REGISTRY: auditServer.url.href,
    });

    expect(bodies).toStrictEqual([{ "a-dep": ["1.0.1"], "left-pad": ["1.0.0"], "no-deps": ["1.0.0"] }]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      No vulnerabilities found (checked 3 packages)"
    `);
    expect(stderr).toBe("");
    expect(await lockText(packageDir)).toBe(full);
    expect(exitCode).toBe(0);
  });

  test.concurrent("verbatim lockfile still passes when a surviving workspace has a lifecycle hook", async () => {
    const tree = withApp({ scripts: { postinstall: "echo ok" } });
    const { packageDir, full } = await verbatimScenario(linker, tree, survivors);

    await frozen(packageDir, linker, 0);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "left-pad", "1.0.0"))).toBeFalse();
    expect(await exists(installedPath(packageDir, linker, "a-dep", "1.0.1"))).toBeTrue();
  });
});

describe("hoisted", () => {
  test.concurrent("the root package depending on a pruned workspace is reported", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", rootSurvivorTree, survivors);

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

    expect(stderr).toContain(rootSurvivorError);
    expect(stderr).toContain(survivorNote);
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(exitCode).toBe(1);
  });

  test.concurrent("a plain install reports the root package depending on a missing workspace", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", rootSurvivorTree, survivors);

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install"]);

    expect(stderr).toContain(rootSurvivorError);
    expect(stderr).toContain(survivorNote);
    expect(stderr).not.toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(full);
    expect(exitCode).toBe(1);
  });

  // Fences a from-side implementation: the edge to the missing workspace lives only in bun.lock now, so this must install.
  test.concurrent("a plain install succeeds once the survivor no longer lists the missing workspace", async () => {
    const { packageDir } = await verbatimScenario("hoisted", survivorTree, survivors);
    await editApp(packageDir, app => {
      delete app.dependencies.other;
    });

    const { stderr } = await install(packageDir, "hoisted");

    expect(stderr).toContain("Saved lockfile");
    expect(stderr).not.toContain("depends on workspace");
    expect(await lockText(packageDir)).not.toContain('"packages/other"');
  });

  test.concurrent("--production still reports a devDependencies edge to a pruned workspace", async () => {
    const tree = withApp({ devDependencies: { other: "workspace:*" } });
    const { packageDir, full } = await verbatimScenario("hoisted", tree, survivors);

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile", "--production"]);

    expect(stderr).toContain(survivorError("app"));
    expect(await lockText(packageDir)).toBe(full);
    expect(exitCode).toBe(1);
  });

  test.concurrent.each(["optionalDependencies", "peerDependencies"])(
    "a %s edge to a pruned workspace is reported too",
    async group => {
      const tree = withApp({ [group]: { other: "workspace:*" } });
      const { packageDir, full } = await verbatimScenario("hoisted", tree, survivors);

      const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

      expect(stderr).toContain(survivorError("app"));
      expect(await lockText(packageDir)).toBe(full);
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent("every offending survivor is listed", async () => {
    const tree: Tree = {
      ...survivorTree,
      packages: {
        ...survivorTree.packages,
        "packages/shared": { ...sharedPackageJson, dependencies: { other: "workspace:*" } },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, survivors);

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

    expect(stderr).toContain(survivorError("app"));
    expect(stderr).toContain(survivorError("shared"));
    expect(stderr.split(survivorNote)).toHaveLength(2);
    expect(await lockText(packageDir)).toBe(full);
    expect(exitCode).toBe(1);
  });

  test.concurrent("--silent suppresses the survivor error but still fails", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", survivorTree, survivors);

    const { stdout, stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile", "--silent"]);

    expect(stderr).not.toContain("depends on workspace");
    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("");
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    expect(exitCode).toBe(1);
  });

  test.concurrent("named catalog group: unreferenced entry may be missing", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", namedCatalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stderr).toContain(catalogNote("left-pad"));
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  test.concurrent("catalog note is pluralized", async () => {
    const tree: Tree = {
      root: {
        name: "mono",
        workspaces: {
          packages: ["packages/*"],
          catalog: { "a-dep": "1.0.1", "left-pad": "1.0.0", "no-deps": "1.0.0" },
        },
      },
      packages: {
        ...catalogTree.packages,
        "packages/other": {
          name: "other",
          version: "1.0.0",
          dependencies: { "left-pad": "catalog:", "no-deps": "catalog:" },
        },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
    const trimmed = trimCatalogLine(trimCatalogLine(full, "left-pad", "1.0.0"), "no-deps", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stderr).toContain(catalogNote("left-pad", "no-deps"));
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules", "a-dep", "package.json"))).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeFalse();
  });

  test.concurrent("--silent suppresses the catalog note", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stdout, stderr } = await frozen(packageDir, "hoisted", 0, ["install", "--frozen-lockfile", "--silent"]);

    expect(stdout + stderr).toBe("");
    expect(await lockText(packageDir)).toBe(trimmed);
  });

  test.concurrent("bun ci behaves the same on turbo output", async () => {
    const { packageDir, pruned } = await prunedTree("hoisted");

    await frozen(packageDir, "hoisted", 0, ["ci"]);

    expect(await lockText(packageDir)).toBe(pruned);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  // pnpm#11364: not on disk and not in bun.lock is a broken workspaces list, not a pruned checkout.
  test.concurrent(
    "explicitly listed workspace missing from disk and from a turbo-pruned bun.lock fails --frozen-lockfile",
    async () => {
      const { full } = await fullInstall("hoisted", explicitMonorepo);
      const pruned = turboPrune(full);
      const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
      await writeTree(packageDir, explicitMonorepo, survivors);
      await write(join(packageDir, "bun.lock"), pruned);

      const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

      expect(stderr).toContain('Workspace not found "packages/other"');
      expect(stderr).not.toContain("not on disk");
      expect(await lockText(packageDir)).toBe(pruned);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent(
    "explicitly listed workspace missing: --frozen-lockfile from inside a surviving workspace",
    async () => {
      const { packageDir, full } = await verbatimScenario("hoisted", explicitMonorepo, survivors);

      await run(packageDir, "hoisted", ["install", "--frozen-lockfile"], 0, join(packageDir, "packages", "app"));

      expect(await lockText(packageDir)).toBe(full);
      expect(await exists(join(packageDir, "packages", "app", "bun.lock"))).toBeFalse();
      expect((await lstat(join(packageDir, "node_modules", "app"))).isSymbolicLink()).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    },
  );

  test.concurrent("explicitly listed workspace missing from disk still errors on a non-frozen install", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", explicitMonorepo, survivors);

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install"]);

    expect(stderr).toContain('Workspace not found "packages/other"');
    expect(exitCode).toBe(1);
    expect(await lockText(packageDir)).toBe(full);
  });

  test.concurrent.each(["./packages/other", "packages/other/"])(
    "explicitly listed workspace spelled %s still matches bun.lock's packages/other and is skipped",
    async spelling => {
      const tree: Tree = { ...monorepo, root: { ...rootPackageJson, workspaces: [...survivors, spelling] } };
      const { packageDir, full } = await verbatimScenario("hoisted", tree, survivors);
      expect(full).toContain('"packages/other"');
      expect(full).not.toContain(`"${spelling}"`);

      const { stderr } = await frozen(packageDir, "hoisted", 0);

      expect(stderr).not.toContain("Workspace not found");
      expect(stderr).toContain(prunedNote);
      expect(await lockText(packageDir)).toBe(full);
      expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
        version: "1.0.1",
      });
    },
  );

  test.concurrent("--verbose prints the same skipped-workspace note and no per-workspace lines", async () => {
    const { packageDir } = await verbatimTree("hoisted");

    const { stderr } = await frozen(packageDir, "hoisted", 0, ["install", "--frozen-lockfile", "--verbose"]);

    expect(stderr.split(prunedNote)).toHaveLength(2);
    expect(stderr).not.toContain("skipping workspace");
  });

  test.concurrent("--silent suppresses the skipped-workspace note", async () => {
    const { packageDir } = await verbatimTree("hoisted");

    const { stdout, stderr } = await frozen(packageDir, "hoisted", 0, ["install", "--frozen-lockfile", "--silent"]);

    expect(stdout + stderr).toBe("");
    expect(await exists(join(packageDir, "node_modules", "app"))).toBeTrue();
  });

  test.concurrent("no skipped-workspace note when nothing was skipped", async () => {
    const { packageDir } = await prunedTree("hoisted");

    const { stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stderr).not.toContain("not on disk");
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  test.concurrent("skipped-workspace note is pluralized", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        ...monorepo.packages,
        "packages/other2": { name: "other2", version: "1.0.0" },
      },
    };
    const { packageDir } = await verbatimScenario("hoisted", tree, survivors);

    const { stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stderr).toBe('note: skipped 2 workspaces listed in bun.lock but not on disk: "other", "other2"\n');
  });

  // The one sanctioned frozen write: the bun.lockb -> bun.lock migration recipe from the docs.
  test.concurrent(
    "--save-text-lockfile --frozen-lockfile --lockfile-only still migrates a pruned bun.lockb",
    async () => {
      const tree: Tree = {
        root: rootPackageJson,
        packages: {
          "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } },
          "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "1.0.0" } },
        },
      };
      const bunfigOpts = { linker: "hoisted", saveTextLockfile: false } as const;
      const { packageDir: fullDir } = await registry.createTestDir({ bunfigOpts });
      await writeTree(fullDir, tree);
      await install(fullDir, "hoisted");
      const lockb = await file(join(fullDir, "bun.lockb")).bytes();
      const { packageDir } = await registry.createTestDir({ bunfigOpts });
      await writeTree(packageDir, tree, ["packages/app"]);
      await write(join(packageDir, "bun.lockb"), lockb);

      await frozen(packageDir, "hoisted", 0, [
        "install",
        "--save-text-lockfile",
        "--frozen-lockfile",
        "--lockfile-only",
      ]);

      expect(await exists(join(packageDir, "bun.lockb"))).toBeFalse();
      const lock = await lockText(packageDir);
      expect(lock).toContain('"packages/other"');
      expect(lock).toContain('"left-pad"');
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    },
  );

  // pnpm#8795: a catalog change is caught by the frozen check before `--lockfile-only` gets a chance to write.
  test.concurrent("--frozen-lockfile --lockfile-only still fails on a catalog change in a pruned tree", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", catalogTree, ["packages/app"]);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.2", "left-pad": "1.0.0" } },
      }),
    );

    await frozen(packageDir, "hoisted", 1, ["install", "--frozen-lockfile", "--lockfile-only"]);

    expect(await lockText(packageDir)).toBe(full);
  });

  // pnpm#4861: `--frozen-lockfile --dry-run` is the install-free lockfile check, and it understands pruned trees.
  test.concurrent("--frozen-lockfile --dry-run checks a pruned tree without installing", async () => {
    const { packageDir, full } = await verbatimTree("hoisted");

    await frozen(packageDir, "hoisted", 0, ["install", "--frozen-lockfile", "--dry-run"]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();

    await editApp(packageDir, app => (app.dependencies["is-number"] = "1.0.0"));

    await frozen(packageDir, "hoisted", 1, ["install", "--frozen-lockfile", "--dry-run"]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // pnpm#6312 / pnpm#9741: bun.lock's shape does not depend on the linker or on --production/--omit.
  test.concurrent("pruned bun.lock written with the hoisted linker passes frozen under other settings", async () => {
    const pruned = turboPrune(await fullLockfile("hoisted"));
    const { packageDir: isolatedDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await writeTree(isolatedDir, turboOutput, survivors);
    await write(join(isolatedDir, "bun.lock"), pruned);

    await frozen(isolatedDir, "isolated", 0);
    expect(await lockText(isolatedDir)).toBe(pruned);
    expect(await exists(installedPath(isolatedDir, "isolated", "a-dep", "1.0.1"))).toBeTrue();

    const { packageDir: productionDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    await writeTree(productionDir, turboOutput, survivors);
    await write(join(productionDir, "bun.lock"), pruned);

    await frozen(productionDir, "hoisted", 0, ["install", "--frozen-lockfile", "--production", "--omit=optional"]);
    expect(await lockText(productionDir)).toBe(pruned);
    expect(await exists(installedPath(productionDir, "hoisted", "a-dep", "1.0.1"))).toBeTrue();
  });

  // pnpm#5794: a pruned bun.lock a plain install would rewrite also fails frozen (the two checks are the same comparison).
  test.concurrent(
    "a hand-edited specifier in the pruned bun.lock fails frozen and is rewritten by a plain install",
    async () => {
      const { packageDir, pruned } = await prunedTree("hoisted");
      const edited = pruned.replace('"a-dep": "1.0.1"', '"a-dep": "1.0.0"');
      expect(edited).not.toBe(pruned);
      await write(join(packageDir, "bun.lock"), edited);

      await frozen(packageDir, "hoisted", 1);
      expect(await lockText(packageDir)).toBe(edited);

      const { stderr } = await install(packageDir, "hoisted");

      expect(stderr).toContain("Saved lockfile");
      expect(await lockText(packageDir)).toContain('"a-dep": "1.0.1"');
    },
  );

  test.concurrent("--frozen-lockfile run from inside a surviving workspace", async () => {
    const { packageDir, full } = await verbatimTree("hoisted");

    await run(packageDir, "hoisted", ["install", "--frozen-lockfile"], 0, join(packageDir, "packages", "app"));

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "packages", "app", "bun.lock"))).toBeFalse();
    expect((await lstat(join(packageDir, "node_modules", "app"))).isSymbolicLink()).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
  });

  test.concurrent("workspace folder without a package.json is treated as pruned", async () => {
    const { packageDir, full } = await verbatimTree("hoisted");
    await write(join(packageDir, "packages", "other", "dist", "index.js"), "");

    await frozen(packageDir, "hoisted", 0);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await exists(join(packageDir, "packages", "other", "node_modules"))).toBeFalse();
  });

  test.concurrent("pruned workspace's lifecycle scripts and bins are neither run nor linked", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        "packages/app": { ...appPackageJson, bin: { "app-cli": "cli.js" } },
        "packages/shared": sharedPackageJson,
        "packages/other": {
          ...otherPackageJson,
          bin: { "other-cli": "cli.js" },
          scripts: { postinstall: "echo other-postinstall > ../../other-postinstall.txt" },
        },
      },
      files: { "packages/app/cli.js": "", "packages/other/cli.js": "" },
    };
    const { packageDir, fullDir } = await verbatimScenario("hoisted", tree, survivors);
    expect(await exists(join(fullDir, "other-postinstall.txt"))).toBeTrue();
    for (const bin of binFiles(fullDir, "other-cli")) expect(await exists(bin)).toBeTrue();

    const { stdout, stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stdout + stderr).not.toContain("other-postinstall");
    expect(stdout + stderr).not.toContain("ENOENT");
    expect(await exists(join(packageDir, "other-postinstall.txt"))).toBeFalse();
    for (const bin of binFiles(packageDir, "other-cli")) expect(await exists(bin)).toBeFalse();
    for (const bin of binFiles(packageDir, "app-cli")) expect(await exists(bin)).toBeTrue();
  });

  test.concurrent("--production composes with the pruned-workspace filter", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        "packages/app": {
          name: "app",
          version: "1.0.0",
          dependencies: { shared: "workspace:*" },
          devDependencies: { "a-dep": "1.0.1" },
        },
        "packages/shared": sharedPackageJson,
        "packages/other": { name: "other", version: "1.0.0", devDependencies: { "left-pad": "1.0.0" } },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, survivors);

    await frozen(packageDir, "hoisted", 0, ["install", "--frozen-lockfile", "--production"]);

    expect(await lockText(packageDir)).toBe(full);
    expect((await lstat(join(packageDir, "node_modules", "shared"))).isSymbolicLink()).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "a-dep"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
  });

  test.concurrent("non-frozen prune writes the same bun.lock a fresh install of the survivors would", async () => {
    const { packageDir } = await verbatimTree("hoisted");
    const { full: expected } = await fullInstall("hoisted", {
      root: rootPackageJson,
      packages: { "packages/app": appPackageJson, "packages/shared": sharedPackageJson },
    });

    const { stderr } = await install(packageDir, "hoisted");

    expect(stderr).toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(expected);
  });

  // No `workspace:` edges here: bun.lockb round-trips those as a diff on its own, independent of pruning.
  test.concurrent("verbatim bun.lockb with a workspace folder missing passes --frozen-lockfile", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } },
        "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "1.0.0" } },
      },
    };
    const bunfigOpts = { linker: "hoisted", saveTextLockfile: false } as const;
    const { packageDir: fullDir } = await registry.createTestDir({ bunfigOpts });
    await writeTree(fullDir, tree);
    await install(fullDir, "hoisted");
    const lockb = await file(join(fullDir, "bun.lockb")).bytes();
    const { packageDir } = await registry.createTestDir({ bunfigOpts });
    await writeTree(packageDir, tree, ["packages/app"]);
    await write(join(packageDir, "bun.lockb"), lockb);

    await frozen(packageDir, "hoisted", 0);

    expect(await file(join(packageDir, "bun.lockb")).bytes()).toStrictEqual(lockb);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  test.concurrent("pruned tree using catalogs passes --frozen-lockfile when the catalog is left intact", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", catalogTree, ["packages/app"]);
    expect(full).toContain('"left-pad": "1.0.0"');

    const { stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stderr).not.toContain("catalog entr");
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  // The guards below pass on main too; they pin the boundaries of the pruned-workspace relaxation.
  test.concurrent("a pruned workspace does not mask a workspace added on disk", async () => {
    const { packageDir, full } = await verbatimTree("hoisted");
    await write(join(packageDir, "packages", "extra", "package.json"), JSON.stringify({ name: "extra" }));

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(full);
  });

  test.concurrent("a pruned workspace does not mask a dependency added to the root package.json", async () => {
    const { packageDir, full } = await verbatimTree("hoisted");
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ ...rootPackageJson, dependencies: { "is-number": "1.0.0" } }),
    );

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(full);
  });

  test.concurrent(
    "a dependency-free workspace on disk but missing from bun.lock still fails --frozen-lockfile",
    async () => {
      const { packageDir, pruned } = await prunedTree("hoisted");
      await write(
        join(packageDir, "packages", "newpkg", "package.json"),
        JSON.stringify({ name: "newpkg", version: "1.0.0" }),
      );
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({ ...rootPackageJson, workspaces: [...survivors, "packages/newpkg"] }),
      );

      await frozen(packageDir, "hoisted", 1);

      expect(await lockText(packageDir)).toBe(pruned);
    },
  );

  test.concurrent("a package.json change still drops the optional-peer-only entry on a normal install", async () => {
    const { packageDir } = await prunedTree("hoisted");
    await editApp(packageDir, app => delete app.dependencies["a-dep"]);

    const { stderr } = await install(packageDir, "hoisted");

    expect(stderr).toContain("Saved lockfile");
    const lock = await lockText(packageDir);
    expect(lock).not.toContain('"no-deps": ["no-deps@');
    expect(lock).not.toContain('"a-dep"');
  });

  test.concurrent("a workspace that is on disk but no longer globbed is not treated as pruned", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    await writeTree(packageDir, monorepo);
    const full = await fullLockfile("hoisted");
    await write(join(packageDir, "bun.lock"), full);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", workspaces: ["packages/app", "packages/shared"] }),
    );

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(full);
  });

  test.concurrent(
    "single-package project: trustedDependencies stripped from bun.lock does not drop a peer-held package under --frozen-lockfile",
    async () => {
      const single: Tree = {
        root: {
          name: "single",
          dependencies: { "optional-peer-deps": "1.0.0", "no-deps": "1.0.0" },
          trustedDependencies: ["optional-peer-deps"],
        },
        packages: {},
      };
      const { full } = await fullInstall("hoisted", single);
      expect(full).toContain('"trustedDependencies"');
      // The 8-space row is the root's declared dependency; the package entry stays, held only by optional-peer-deps' peer slot.
      const pruned = full.replace(/\n        "no-deps": "1\.0\.0",/, "").replace(trustedDependenciesSection, "");
      expect(pruned).not.toBe(full);
      expect(pruned).toContain('"no-deps": ["no-deps@1.0.0"');
      const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "single",
          dependencies: { "optional-peer-deps": "1.0.0" },
          trustedDependencies: ["optional-peer-deps"],
        }),
      );
      await write(join(packageDir, "bun.lock"), pruned);

      await frozen(packageDir, "hoisted", 0);

      expect(await lockText(packageDir)).toBe(pruned);
      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
        name: "no-deps",
        version: "1.0.0",
      });
    },
  );

  // Fences of the catalog-subset relaxation: only entries no surviving importer or override references may be missing.
  test.concurrent("a catalog entry a surviving workspace references must stay in bun.lock", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "a-dep", "1.0.1");
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(trimmed);
  });

  test.concurrent("a catalog entry an override references must stay in bun.lock", async () => {
    const tree: Tree = {
      root: {
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
        overrides: { "no-deps": "catalog:" },
      },
      packages: {
        "packages/app": { name: "app", version: "1.0.0", dependencies: { "one-dep": "1.0.0" } },
        "packages/other": { name: "other", version: "1.0.0" },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "no-deps", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

    expect(stderr).toContain("error:");
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(exitCode).toBe(1);
  });

  test.concurrent("a catalog entry the root package.json references must stay in bun.lock", async () => {
    const tree: Tree = { ...catalogTree, root: { ...catalogTree.root, dependencies: { "left-pad": "catalog:" } } };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, "hoisted", 1);

    expect(stderr).toContain(changedSectionNote("the catalog"));
    expect(stderr).not.toContain("catalog entr");
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a catalog entry a scoped override references must stay in bun.lock", async () => {
    const tree: Tree = {
      root: {
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
        overrides: { "one-dep>no-deps": "catalog:" },
      },
      packages: {
        "packages/app": { name: "app", version: "1.0.0", dependencies: { "one-dep": "1.0.0" } },
        "packages/other": { name: "other", version: "1.0.0" },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
    expect(full).toContain('"one-dep": {\n      "no-deps": "catalog:",\n    },');
    expect(full).toContain('"no-deps": ["no-deps@1.0.0"');
    const trimmed = trimCatalogLine(full, "no-deps", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, "hoisted", 1);

    expect(stderr).toContain(changedSectionNote("the catalog"));
    expect(stderr).not.toContain("catalog entr");
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent(
    "a whole named catalog group only the pruned workspace used may be missing from bun.lock",
    async () => {
      const tree: Tree = {
        root: {
          name: "mono",
          workspaces: {
            packages: ["packages/*"],
            catalog: { "a-dep": "1.0.1" },
            catalogs: { build: { "left-pad": "1.0.0", "no-deps": "1.0.0" } },
          },
        },
        packages: {
          "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:" } },
          "packages/other": {
            name: "other",
            version: "1.0.0",
            dependencies: { "left-pad": "catalog:build", "no-deps": "catalog:build" },
          },
        },
      };
      const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
      const trimmed = full.replace(/\n  "catalogs": \{\n(?:    [^\n]*\n)*  \},/, "");
      expect(full).toContain('"catalogs"');
      expect(trimmed).not.toContain('"catalogs"');
      expect(trimmed).toContain('"catalog": {\n    "a-dep": "1.0.1",\n  },');
      await write(join(packageDir, "bun.lock"), trimmed);

      const { stderr } = await frozen(packageDir, "hoisted", 0);

      expect(stderr).toContain(prunedNote);
      expect(stderr).toContain(catalogNote("left-pad", "no-deps"));
      expect(await lockText(packageDir)).toBe(trimmed);
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
        version: "1.0.1",
      });
      expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeFalse();
    },
  );

  test.concurrent("a whole named catalog group a surviving workspace uses must stay in bun.lock", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", namedCatalogTree, ["packages/app"]);
    const trimmed = full.replace(/\n  "catalogs": \{\n(?:    [^\n]*\n)*  \},/, "");
    expect(full).toContain('"catalogs"');
    expect(trimmed).not.toContain('"catalogs"');
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, "hoisted", 1);

    expect(stderr).toContain(changedSectionNote("the catalog"));
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("bun.lock may not carry catalog entries package.json lacks", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", catalogTree, ["packages/app"]);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1" } } }),
    );

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(full);
  });

  test.concurrent("a differing specifier is still a change even when the lockfile is a subset", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.2", "left-pad": "1.0.0" } },
      }),
    );

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

    expect(stderr).toContain("error:");
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(exitCode).toBe(1);
  });

  // A hand-maintained bun.lock may list the default catalog under both spellings; the loaded side then has more entries than package.json.
  test.concurrent("a default catalog entry listed under both catalog and catalogs.default in bun.lock", async () => {
    const { packageDir, doubled } = await doubleListedScenario();

    const { stdout, stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

    expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      2 packages installed"
    `);
    expect(normalizeBunSnapshot(stderr, packageDir)).toMatchInlineSnapshot(`""`);
    expect(exitCode).toBe(0);
    expect(await lockText(packageDir)).toBe(doubled);
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toStrictEqual({
      name: "a-dep",
      version: "1.0.1",
    });
  });

  test.concurrent("the double-listed entry does not count toward the skipped catalog entries", async () => {
    const { packageDir, doubled } = await doubleListedScenario();
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1", "left-pad": "1.0.0" } },
      }),
    );

    const { stdout, stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

    expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      2 packages installed"
    `);
    expect(normalizeBunSnapshot(stderr, packageDir)).toMatchInlineSnapshot(
      `"note: skipped 1 catalog entry not in bun.lock (unused by the workspaces on disk): "left-pad""`,
    );
    expect(exitCode).toBe(0);
    expect(await lockText(packageDir)).toBe(doubled);
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
  });

  test.concurrent("a plain install writes the full catalog back", async () => {
    const { packageDir, full } = await verbatimScenario("hoisted", catalogTree, ["packages/app"]);
    await write(join(packageDir, "bun.lock"), trimCatalogLine(full, "left-pad", "1.0.0"));

    const { stderr } = await install(packageDir, "hoisted");

    expect(stderr).toContain("Saved lockfile");
    expect(stderr).not.toContain("catalog entr");
    const lock = await lockText(packageDir);
    expect(lock).toContain('"left-pad": "1.0.0"');
    expect(lock).not.toContain('"packages/other"');
  });

  // A new edge to a package bun.lock already hoists is invisible to the frozen tree comparison even without pruning, so the change here has to bring in a new package.
  test.concurrent("verbatim lockfile with a hook still fails on a real change", async () => {
    const tree = withApp({ scripts: { postinstall: "echo ok" } });
    const { packageDir, full } = await verbatimScenario("hoisted", tree, survivors);
    await editApp(packageDir, app => (app.dependencies["no-deps"] = "2.0.0"));

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(full);
  });
});
