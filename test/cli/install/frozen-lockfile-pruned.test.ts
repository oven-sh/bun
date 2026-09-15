import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, lstat, readdir } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";
import { dirname, join } from "path";

type Linker = "hoisted" | "isolated";
type PackageJson = Record<string, unknown>;
type Tree = { root: PackageJson; packages: Record<string, PackageJson>; files?: Record<string, string> };

const linkers: Linker[] = ["hoisted", "isolated"];
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
const hookTree = withApp({ scripts: { postinstall: "echo ok" } });

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

const singleCatalogEntryTree: Tree = {
  root: { name: "mono", workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1" } } },
  packages: { "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:" } } },
};

// No `workspace:` edges here: bun.lockb round-trips those as a diff on its own, independent of pruning.
const lockbTree: Tree = {
  root: rootPackageJson,
  packages: {
    "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } },
    "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "1.0.0" } },
  },
};
const lockbBunfig = { linker: "hoisted", saveTextLockfile: false } as const;

const quoted = (names: string[]) => names.map(name => `"${name}"`).join(", ");
const skippedNote = (...names: string[]) =>
  `note: skipped ${names.length} workspace${names.length === 1 ? "" : "s"} listed in bun.lock but not on disk: ${quoted(names)}`;
const prunedNote = skippedNote("other");
const catalogNote = (...names: string[]) =>
  `note: skipped ${names.length} catalog ${names.length === 1 ? "entry" : "entries"} not in bun.lock (unused by the workspaces on disk): ${quoted(names)}`;
const changedSectionNote = (section: "overrides" | "the catalog") =>
  `note: ${section} in package.json changed since bun.lock was saved`;
const savedLockfile = "Saved lockfile";
const frozenError = "error: lockfile had changes, but lockfile is frozen";
const frozenHint = "note: try re-running without --frozen-lockfile and commit the updated lockfile";
const frozenFailure = (...notes: string[]) => [frozenError, ...notes, frozenHint];

const survivorError = (dependent: string, ws = "other") =>
  `error: workspace "${dependent}" depends on workspace "${ws}" (packages/${ws}), which is listed in bun.lock but not on disk`;
const rootSurvivorError =
  'error: the root package depends on workspace "other" (packages/other), which is listed in bun.lock but not on disk';
const survivorNote = "note: a pruned checkout must keep every workspace that its remaining workspaces depend on";

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

const defaultCatalogBlock = '\n  "catalog": {\n    "a-dep": "1.0.1",\n  },\n';

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

// Everything bun install puts on stderr besides its network progress: notes, errors and "Saved lockfile".
const progressLine = /^(Resolving dependencies|Resolved, downloaded and extracted \[\d+\])$/;
const messages = (stderr: string) => stderr.split("\n").filter(line => line !== "" && !progressLine.test(line));

async function run(dir: string, linker: Linker, args: string[], cwd = dir) {
  const result = await spawnBun(dir, [...args, "--linker", linker], cwd);
  return { ...result, messages: messages(result.stderr) };
}

// `cmd` must exit 0 and print exactly `notes` to stderr.
async function passes(dir: string, linker: Linker, cmd: string[], notes: string[], cwd = dir) {
  const result = await run(dir, linker, cmd, cwd);
  expect(result.messages).toEqual(notes);
  expect(result.exitCode).toBe(0);
  return result;
}

// `cmd` must exit 1 and print exactly `errors` to stderr.
async function fails(dir: string, linker: Linker, cmd: string[], errors: string[], cwd = dir) {
  const result = await run(dir, linker, cmd, cwd);
  expect(result.messages).toEqual(errors);
  expect(result.exitCode).toBe(1);
  return result;
}

const frozenInstall = ["install", "--frozen-lockfile"];
const frozen = (dir: string, linker: Linker, notes: string[]) => passes(dir, linker, frozenInstall, notes);
const frozenFails = (dir: string, linker: Linker, errors: string[]) => fails(dir, linker, frozenInstall, errors);
const install = (dir: string, linker: Linker, notes: string[] = []) =>
  passes(dir, linker, ["install"], [...notes, savedLockfile]);

const lockText = (dir: string) => file(join(dir, "bun.lock")).text();

type Fixture = { fullDir: string; full: string };
const fixtures = new Map<string, Promise<Fixture>>();

// A full install of `tree`, done once per linker and shared by every test that starts from its bun.lock.
function fullInstall(linker: Linker, tree: Tree): Promise<Fixture> {
  const key = JSON.stringify([linker, tree]);
  let fixture = fixtures.get(key);
  if (!fixture) {
    fixture = (async () => {
      const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
      await writeTree(packageDir, tree);
      await install(packageDir, linker);
      return { fullDir: packageDir, full: await lockText(packageDir) };
    })();
    fixtures.set(key, fixture);
  }
  return fixture;
}

let lockbInstall: Promise<Uint8Array<ArrayBuffer>> | undefined;

function fullLockb(): Promise<Uint8Array<ArrayBuffer>> {
  lockbInstall ??= (async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: lockbBunfig });
    await writeTree(packageDir, lockbTree);
    await install(packageDir, "hoisted");
    return file(join(packageDir, "bun.lockb")).bytes();
  })();
  return lockbInstall;
}

// A second checkout with only `keep` of `checkout`'s workspaces on disk and the full install's bun.lock copied verbatim.
async function verbatimScenario(linker: Linker, tree: Tree, keep: string[], checkout = tree) {
  const [{ fullDir, full }, { packageDir }] = await Promise.all([
    fullInstall(linker, tree),
    registry.createTestDir({ bunfigOpts: { linker } }),
  ]);
  await writeTree(packageDir, checkout, keep);
  await write(join(packageDir, "bun.lock"), full);
  return { packageDir, fullDir, full };
}

const verbatimTree = (linker: Linker) => verbatimScenario(linker, monorepo, survivors);

async function monorepoLockfile(linker: Linker): Promise<string> {
  const { full } = await fullInstall(linker, monorepo);
  expect(full).toContain('"no-deps"');
  expect(full).toContain('"left-pad"');
  expect(full).toContain('"packages/other"');
  expect(full).toContain('"trustedDependencies"');
  expect(full).toContain('"app-cli"');
  return full;
}

const trustedDependenciesSection = /\n  "trustedDependencies": \[\n(?:    [^\n]*\n)*  \],/;
const workspaceBinField = /,\n      "bin": \{\n(?:        [^\n]*\n)*      \}/;

// The lockfile without the `other` workspace and the packages only it depended on.
function withoutOther(lock: string): string {
  const pruned = lock
    .replace(/    "packages\/other": \{\n(?:      .*\n)*    \},\n/, "")
    .replace(/\n    "(?:other|left-pad)": \[[^\n]*\],\n\n?/g, "\n");
  expect(pruned).toContain('"packages/app"');
  expect(pruned).not.toContain('"other"');
  expect(pruned).not.toContain('"left-pad"');
  return pruned;
}

// The lockfile without the no-deps package row; shared's optional peer slot is the only thing left that could hold it.
function withoutNoDeps(lock: string): string {
  const pruned = lock.replace(/\n    "no-deps": \[[^\n]*\],\n\n?/, "\n");
  expect(pruned).not.toBe(lock);
  expect(pruned).not.toContain('"no-deps": ["');
  return pruned;
}

// The three edits turbo prune makes to Bun's own bun.lock: workspace + exclusive packages removed, trustedDependencies emitted empty (i.e. omitted), workspace bin dropped.
function stripTurboFields(lock: string): string {
  expect(lock).toContain('"trustedDependencies"');
  expect(lock).toContain('"app-cli"');
  const pruned = withoutOther(lock).replace(trustedDependenciesSection, "").replace(workspaceBinField, "");
  expect(pruned).not.toContain('"trustedDependencies"');
  expect(pruned).not.toContain('"bin"');
  return pruned;
}

function turboPrune(lock: string): string {
  const pruned = stripTurboFields(lock);
  expect(pruned).toContain('"no-deps": ["no-deps@1.0.0"');
  return pruned;
}

async function prunedTree(linker: Linker) {
  const [full, { packageDir }] = await Promise.all([
    monorepoLockfile(linker),
    registry.createTestDir({ bunfigOpts: { linker } }),
  ]);
  await writeTree(packageDir, turboOutput, survivors);
  const pruned = turboPrune(full);
  await write(join(packageDir, "bun.lock"), pruned);
  return { packageDir, pruned, full };
}

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

// The packages an install put on disk: node_modules/<name> for the hoisted linker, the .bun store entries for isolated.
async function installedPackages(dir: string, linker: Linker): Promise<string[]> {
  const root = linker === "hoisted" ? join(dir, "node_modules") : join(dir, "node_modules", ".bun");
  return (await readdir(root)).filter(name => !name.startsWith(".") && name !== "node_modules").sort();
}

const byLinker = <T>(linker: Linker, hoisted: T, isolated: T) => (linker === "hoisted" ? hoisted : isolated);

// What the two surviving workspaces install: app's a-dep, the workspace links, and no-deps held only by shared's optional peer slot.
const survivorsInstalled = (linker: Linker) =>
  byLinker(linker, ["a-dep", "app", "no-deps", "shared"], ["a-dep@1.0.1", "no-deps@1.0.0"]);

// no-deps is hoisted to the root, or placed next to the workspace whose peer slot holds it.
const peerHeldNoDeps = (dir: string, linker: Linker) =>
  byLinker(
    linker,
    join(dir, "node_modules", "no-deps", "package.json"),
    join(dir, "packages", "shared", "node_modules", "no-deps", "package.json"),
  );

const noChanges = /^bun install <version> \(<revision>\)\n\nChecked \d+ installs across \d+ packages \(no changes\)$/;

describe.each(linkers)("linker: %s", linker => {
  // Also pins that the optional-peer-bound no-deps is installed even though only the pruned workspace needed it (pnpm#6264).
  test.concurrent(
    "turbo output: peer-held package survives --frozen-lockfile although turbo dropped trustedDependencies and the workspace bin from bun.lock",
    async () => {
      const { packageDir, pruned } = await prunedTree(linker);

      await frozen(packageDir, linker, []);

      expect(await lockText(packageDir)).toBe(pruned);
      expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
      expect(await file(peerHeldNoDeps(packageDir, linker)).json()).toStrictEqual({
        name: "no-deps",
        version: "1.0.0",
      });
    },
  );

  test.concurrent(
    "turbo output: plain bun install writes only trustedDependencies back and keeps the peer-held package",
    async () => {
      const { packageDir, full } = await prunedTree(linker);

      await install(packageDir, linker);

      const lock = await lockText(packageDir);
      expect(lock).toBe(withoutOther(full).replace(workspaceBinField, ""));
      expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));

      const second = await frozen(packageDir, linker, []);

      expect(normalizeBunSnapshot(second.stdout)).toMatch(noChanges);
      expect(await lockText(packageDir)).toBe(lock);
    },
  );

  test.concurrent("verbatim full lockfile with a workspace folder missing passes --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimTree(linker);

    await frozen(packageDir, linker, [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
    const aDep = byLinker(
      linker,
      join(packageDir, "node_modules", "a-dep", "package.json"),
      join(packageDir, "packages", "app", "node_modules", "a-dep", "package.json"),
    );
    expect(await file(aDep).json()).toMatchObject({ name: "a-dep", version: "1.0.1" });
    if (linker === "hoisted") {
      expect((await lstat(join(packageDir, "node_modules", "app"))).isSymbolicLink()).toBeTrue();
    }
  });

  test.concurrent("second --frozen-lockfile install on a pruned tree is a no-op", async () => {
    const { packageDir, pruned } = await prunedTree(linker);
    await frozen(packageDir, linker, []);

    const { stdout } = await frozen(packageDir, linker, []);

    expect(normalizeBunSnapshot(stdout)).toMatch(noChanges);
    expect(await lockText(packageDir)).toBe(pruned);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
    expect(await file(peerHeldNoDeps(packageDir, linker)).json()).toStrictEqual({ name: "no-deps", version: "1.0.0" });
  });

  test.concurrent("a real package.json change in a pruned tree still fails --frozen-lockfile", async () => {
    const { packageDir, pruned } = await prunedTree(linker);
    await editApp(packageDir, app => (app.dependencies["no-deps"] = "2.0.0"));

    await frozenFails(packageDir, linker, frozenFailure());

    expect(await lockText(packageDir)).toBe(pruned);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a missing workspace is still removed from the lockfile by a non-frozen install", async () => {
    const { packageDir, full } = await verbatimTree(linker);

    await install(packageDir, linker);

    expect(await lockText(packageDir)).toBe(withoutNoDeps(withoutOther(full)));
    expect(await installedPackages(packageDir, linker)).toEqual(
      byLinker(linker, ["a-dep", "app", "shared"], ["a-dep@1.0.1"]),
    );
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

    await frozen(packageDir, linker, [skippedNote("@mono/other")]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(
      byLinker(linker, ["a-dep", "app", "shared"], ["a-dep@1.0.1"]),
    );
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

    await frozen(packageDir, linker, [skippedNote("other", "other2")]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));

    await editApp(packageDir, app => (app.dependencies["is-number"] = "2.0.0"));

    await frozenFails(packageDir, linker, [skippedNote("other", "other2"), ...frozenFailure()]);

    expect(await lockText(packageDir)).toBe(full);
  });

  test.concurrent("bun ci behaves the same on the verbatim full lockfile", async () => {
    const { packageDir, full } = await verbatimTree(linker);

    await passes(packageDir, linker, ["ci"], [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
  });

  // pnpm#11364: explicit workspaces list plus a hand-copied full bun.lock; turbo instead rewrites the list (see turboOutput).
  test.concurrent("explicitly listed workspace whose folder is missing passes --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimScenario(linker, explicitMonorepo, survivors);

    await frozen(packageDir, linker, [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
  });

  test.concurrent("bun ci with an explicitly listed workspace whose folder is missing", async () => {
    const { packageDir, full } = await verbatimScenario(linker, explicitMonorepo, survivors);

    await passes(packageDir, linker, ["ci"], [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
  });

  // pnpm#7823: the relaxation is not silent, so a stale bun.lock is greppable in CI logs.
  test.concurrent("--frozen-lockfile names how many workspaces it skipped", async () => {
    const { packageDir } = await verbatimTree(linker);

    const { stderr } = await frozen(packageDir, linker, [prunedNote]);

    expect(stderr).toBe(`${prunedNote}\n`);
  });

  // pnpm#6094: `--lockfile-only` must not write under `--frozen-lockfile`; the extra newline is a byte-level canary.
  test.concurrent("--frozen-lockfile --lockfile-only leaves the pruned bun.lock byte-identical", async () => {
    const { packageDir, pruned } = await prunedTree(linker);
    const canary = pruned + "\n";
    await write(join(packageDir, "bun.lock"), canary);

    const { stdout } = await passes(packageDir, linker, [...frozenInstall, "--lockfile-only"], []);

    expect(normalizeBunSnapshot(stdout)).toBe("bun install <version> (<revision>)");
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
    const pruned = withoutNoDeps(stripTurboFields(full));
    expect(pruned).not.toContain('"no-deps"');
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
    await writeTree(packageDir, { ...tree, root: { ...rootPackageJson, workspaces: survivors } }, survivors);
    await write(join(packageDir, "bun.lock"), pruned);

    await frozen(packageDir, linker, []);

    expect(await lockText(packageDir)).toBe(pruned);
    expect(await installedPackages(packageDir, linker)).toEqual(
      byLinker(linker, ["a-dep", "app", "shared"], ["a-dep@1.0.1"]),
    );
  });

  // Like trustedDependencies above, patchedDependencies is not part of the frozen comparison (docs/pm/cli/install.mdx).
  test.concurrent("patchedDependencies added after bun.lock was written still passes --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimScenario(linker, monorepo, survivors, patchedMonorepo);
    expect(full).not.toContain('"patchedDependencies"');

    await frozen(packageDir, linker, [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
    const aDep = installedPath(packageDir, linker, "a-dep", "1.0.1");
    expect(await file(aDep).json()).toMatchObject({ name: "a-dep", version: "1.0.1" });
    expect(await file(join(dirname(aDep), "patched.txt")).text()).toBe("hello world\n");

    await install(packageDir, linker);

    const lock = await lockText(packageDir);
    expect(lock).toContain(`"patchedDependencies": {\n    ${patchedLockLine},\n  },`);
    expect(lock).not.toContain('"packages/other"');
  });

  test.concurrent("patchedDependencies removed after bun.lock was written still passes --frozen-lockfile", async () => {
    const { packageDir, fullDir, full } = await verbatimScenario(linker, patchedMonorepo, survivors, monorepo);
    expect(full).toContain(patchedLockLine);
    expect(await exists(join(dirname(installedPath(fullDir, linker, "a-dep", "1.0.1")), "patched.txt"))).toBeTrue();

    await frozen(packageDir, linker, [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
    const aDep = installedPath(packageDir, linker, "a-dep", "1.0.1");
    expect(await file(aDep).json()).toMatchObject({ name: "a-dep", version: "1.0.1" });
    expect(await exists(join(dirname(aDep), "patched.txt"))).toBeFalse();
  });

  test.concurrent("overrides added after bun.lock was written still fail --frozen-lockfile", async () => {
    const { packageDir, full } = await verbatimTree(linker);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ ...rootPackageJson, overrides: { "a-dep": "1.0.1" } }),
    );

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("overrides")));

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

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("overrides")));

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

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a survivor depending on a pruned workspace fails with the workspace error", async () => {
    const { packageDir, full } = await verbatimScenario(linker, survivorTree, survivors);

    await frozenFails(packageDir, linker, [survivorError("app"), survivorNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent(
    "a plain install reports a survivor depending on a missing workspace with the same error",
    async () => {
      const { packageDir, full } = await verbatimScenario(linker, survivorTree, survivors);

      await fails(packageDir, linker, ["install"], [survivorError("app"), survivorNote]);

      expect(await lockText(packageDir)).toBe(full);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    },
  );

  test.concurrent("a catalog entry only the pruned workspace used may be missing from bun.lock", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stderr } = await frozen(packageDir, linker, [prunedNote, catalogNote("left-pad")]);

    expect(stderr).toBe(`${prunedNote}\n${catalogNote("left-pad")}\n`);
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await installedPackages(packageDir, linker)).toEqual(byLinker(linker, ["a-dep", "app"], ["a-dep@1.0.1"]));
  });

  // docs/pm/cli/install.mdx: the skipped workspaces stay in bun.lock, so lockfile-driven commands still see them.
  test.concurrent("bun pm ls --all still lists the skipped workspace and its exclusive dependency", async () => {
    const { packageDir, full } = await verbatimTree(linker);
    await frozen(packageDir, linker, [prunedNote]);

    const { stdout, stderr, exitCode } = await spawnBun(packageDir, ["pm", "ls", "--all"]);

    expect(stderr).toBe("");
    expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`
      "<dir> node_modules
      ├── a-dep@1.0.1
      ├── app@workspace:packages/app
      ├── left-pad@1.0.0
      ├── no-deps@1.0.0
      ├── other@workspace:packages/other
      └── shared@workspace:packages/shared"
    `);
    expect(await lockText(packageDir)).toBe(full);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun audit still submits the skipped workspace's exclusive dependency", async () => {
    const { packageDir, full } = await verbatimTree(linker);
    await frozen(packageDir, linker, [prunedNote]);
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
    const { packageDir, full } = await verbatimScenario(linker, hookTree, survivors);

    await frozen(packageDir, linker, [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsInstalled(linker));
  });
});

describe("hoisted", () => {
  const linker: Linker = "hoisted";
  const survivorsOnDisk = survivorsInstalled(linker);

  test.concurrent("the root package depending on a pruned workspace is reported", async () => {
    const { packageDir, full } = await verbatimScenario(linker, rootSurvivorTree, survivors);

    await frozenFails(packageDir, linker, [rootSurvivorError, survivorNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a plain install reports the root package depending on a missing workspace", async () => {
    const { packageDir, full } = await verbatimScenario(linker, rootSurvivorTree, survivors);

    await fails(packageDir, linker, ["install"], [rootSurvivorError, survivorNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // Fences a from-side implementation: the edge to the missing workspace lives only in bun.lock now, so this must install.
  test.concurrent("a plain install succeeds once the survivor no longer lists the missing workspace", async () => {
    const { packageDir } = await verbatimScenario(linker, survivorTree, survivors);
    await editApp(packageDir, app => {
      delete app.dependencies.other;
    });

    await install(packageDir, linker);

    expect(await lockText(packageDir)).toBe(withoutNoDeps(withoutOther(await monorepoLockfile(linker))));
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app", "shared"]);
  });

  test.concurrent("--production still reports a devDependencies edge to a pruned workspace", async () => {
    const tree = withApp({ devDependencies: { other: "workspace:*" } });
    const { packageDir, full } = await verbatimScenario(linker, tree, survivors);

    await fails(packageDir, linker, [...frozenInstall, "--production"], [survivorError("app"), survivorNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent.each(["optionalDependencies", "peerDependencies"])(
    "a %s edge to a pruned workspace is reported too",
    async group => {
      const tree = withApp({ [group]: { other: "workspace:*" } });
      const { packageDir, full } = await verbatimScenario(linker, tree, survivors);

      await frozenFails(packageDir, linker, [survivorError("app"), survivorNote]);

      expect(await lockText(packageDir)).toBe(full);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
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
    const { packageDir, full } = await verbatimScenario(linker, tree, survivors);

    await frozenFails(packageDir, linker, [survivorError("app"), survivorError("shared"), survivorNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("--silent suppresses the survivor error but still fails", async () => {
    const { packageDir, full } = await verbatimScenario(linker, survivorTree, survivors);

    const { stdout, stderr } = await fails(packageDir, linker, [...frozenInstall, "--silent"], []);

    expect(stdout + stderr).toBe("");
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("named catalog group: unreferenced entry may be missing", async () => {
    const { packageDir, full } = await verbatimScenario(linker, namedCatalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozen(packageDir, linker, [prunedNote, catalogNote("left-pad")]);

    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
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
    const { packageDir, full } = await verbatimScenario(linker, tree, ["packages/app"]);
    const trimmed = trimCatalogLine(trimCatalogLine(full, "left-pad", "1.0.0"), "no-deps", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozen(packageDir, linker, [prunedNote, catalogNote("left-pad", "no-deps")]);

    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
  });

  test.concurrent("--silent suppresses the catalog note", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    const { stdout, stderr } = await passes(packageDir, linker, [...frozenInstall, "--silent"], []);

    expect(stdout + stderr).toBe("");
    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
  });

  test.concurrent("bun ci behaves the same on turbo output", async () => {
    const { packageDir, pruned } = await prunedTree(linker);

    await passes(packageDir, linker, ["ci"], []);

    expect(await lockText(packageDir)).toBe(pruned);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsOnDisk);
    expect(await file(peerHeldNoDeps(packageDir, linker)).json()).toStrictEqual({ name: "no-deps", version: "1.0.0" });
  });

  // pnpm#11364: not on disk and not in bun.lock is a broken workspaces list, not a pruned checkout.
  test.concurrent(
    "explicitly listed workspace missing from disk and from a turbo-pruned bun.lock fails --frozen-lockfile",
    async () => {
      const { full } = await fullInstall(linker, explicitMonorepo);
      const pruned = turboPrune(full);
      const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
      await writeTree(packageDir, explicitMonorepo, survivors);
      await write(join(packageDir, "bun.lock"), pruned);

      const { stderr, exitCode } = await run(packageDir, linker, frozenInstall);

      expect(normalizeBunSnapshot(stderr, packageDir)).toMatchInlineSnapshot(`
        "1 | {"name":"mono","workspaces":["packages/app","packages/shared","packages/other"],"trustedDependencies":["a-dep"]}
                                                                          ^
        error: Workspace not found "packages/other"
            at <dir>/package.json:1:63"
      `);
      expect(await lockText(packageDir)).toBe(pruned);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent(
    "--frozen-lockfile tolerates a workspace pruned from disk but still rejects an unknown one listed next to it",
    async () => {
      const tree: Tree = {
        root: { name: "mono", workspaces: ["packages/app", "packages/shared"] },
        packages: {
          "packages/app": { name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } },
          "packages/shared": { name: "shared", version: "1.0.0" },
        },
      };
      const checkout: Tree = {
        ...tree,
        root: { ...tree.root, workspaces: ["packages/app", "packages/shared", "packages/api"] },
      };
      const { packageDir, full } = await verbatimScenario(linker, tree, ["packages/app"], checkout);
      expect(full).toContain('"packages/shared"');
      expect(full).not.toContain('"packages/api"');

      const { stderr, exitCode } = await run(packageDir, linker, frozenInstall);

      expect(normalizeBunSnapshot(stderr, packageDir)).toMatchInlineSnapshot(`
        "1 | {"name":"mono","workspaces":["packages/app","packages/shared","packages/api"]}
                                                                          ^
        error: Workspace not found "packages/api"
            at <dir>/package.json:1:63"
      `);
      expect(await lockText(packageDir)).toBe(full);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent(
    "explicitly listed workspace missing: --frozen-lockfile from inside a surviving workspace",
    async () => {
      const { packageDir, full } = await verbatimScenario(linker, explicitMonorepo, survivors);

      await passes(packageDir, linker, frozenInstall, [prunedNote], join(packageDir, "packages", "app"));

      expect(await lockText(packageDir)).toBe(full);
      expect(await exists(join(packageDir, "packages", "app", "bun.lock"))).toBeFalse();
      expect((await lstat(join(packageDir, "node_modules", "app"))).isSymbolicLink()).toBeTrue();
      expect(await installedPackages(packageDir, linker)).toEqual(survivorsOnDisk);
    },
  );

  test.concurrent("explicitly listed workspace missing from disk still errors on a non-frozen install", async () => {
    const { packageDir, full } = await verbatimScenario(linker, explicitMonorepo, survivors);

    const { stderr, exitCode } = await run(packageDir, linker, ["install"]);

    expect(normalizeBunSnapshot(stderr, packageDir)).toMatchInlineSnapshot(`
      "1 | {"name":"mono","workspaces":["packages/app","packages/shared","packages/other"],"trustedDependencies":["a-dep"]}
                                                                        ^
      error: Workspace not found "packages/other"
          at <dir>/package.json:1:63"
    `);
    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    expect(exitCode).toBe(1);
  });

  test.concurrent.each(["./packages/other", "packages/other/"])(
    "explicitly listed workspace spelled %s still matches bun.lock's packages/other and is skipped",
    async spelling => {
      const tree: Tree = { ...monorepo, root: { ...rootPackageJson, workspaces: [...survivors, spelling] } };
      const { packageDir, full } = await verbatimScenario(linker, tree, survivors);
      expect(full).toContain('"packages/other"');
      expect(full).not.toContain(`"${spelling}"`);

      await frozen(packageDir, linker, [prunedNote]);

      expect(await lockText(packageDir)).toBe(full);
      expect(await installedPackages(packageDir, linker)).toEqual(survivorsOnDisk);
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
        version: "1.0.1",
      });
    },
  );

  test.concurrent("--verbose prints the same skipped-workspace note and no per-workspace lines", async () => {
    const { packageDir } = await verbatimTree(linker);

    const { messages, stderr, exitCode } = await run(packageDir, linker, [...frozenInstall, "--verbose"]);

    expect(messages.filter(line => line.startsWith("note:"))).toEqual([prunedNote]);
    expect(stderr).not.toContain("skipping workspace");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--silent suppresses the skipped-workspace note", async () => {
    const { packageDir } = await verbatimTree(linker);

    const { stdout, stderr } = await passes(packageDir, linker, [...frozenInstall, "--silent"], []);

    expect(stdout + stderr).toBe("");
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsOnDisk);
  });

  test.concurrent("no skipped-workspace note when nothing was skipped", async () => {
    const { packageDir } = await prunedTree(linker);

    const { stderr } = await frozen(packageDir, linker, []);

    expect(stderr).toBe("");
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
    const { packageDir } = await verbatimScenario(linker, tree, survivors);

    const { stderr } = await frozen(packageDir, linker, [skippedNote("other", "other2")]);

    expect(stderr).toBe(`${skippedNote("other", "other2")}\n`);
  });

  // The one sanctioned frozen write: the bun.lockb -> bun.lock migration recipe from the docs.
  test.concurrent(
    "--save-text-lockfile --frozen-lockfile --lockfile-only still migrates a pruned bun.lockb",
    async () => {
      const [lockb, { packageDir }] = await Promise.all([
        fullLockb(),
        registry.createTestDir({ bunfigOpts: lockbBunfig }),
      ]);
      await writeTree(packageDir, lockbTree, ["packages/app"]);
      await write(join(packageDir, "bun.lockb"), lockb);

      await passes(
        packageDir,
        linker,
        ["install", "--save-text-lockfile", "--frozen-lockfile", "--lockfile-only"],
        [prunedNote, savedLockfile],
      );

      expect(await exists(join(packageDir, "bun.lockb"))).toBeFalse();
      const lock = await lockText(packageDir);
      expect(lock).toContain('"packages/other"');
      expect(lock).toContain('"left-pad"');
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    },
  );

  // pnpm#8795: a catalog change is caught by the frozen check before `--lockfile-only` gets a chance to write.
  test.concurrent("--frozen-lockfile --lockfile-only still fails on a catalog change in a pruned tree", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.2", "left-pad": "1.0.0" } },
      }),
    );

    await fails(
      packageDir,
      linker,
      [...frozenInstall, "--lockfile-only"],
      frozenFailure(changedSectionNote("the catalog")),
    );

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // pnpm#4861: `--frozen-lockfile --dry-run` is the install-free lockfile check, and it understands pruned trees.
  test.concurrent("--frozen-lockfile --dry-run checks a pruned tree without installing", async () => {
    const { packageDir, full } = await verbatimTree(linker);

    await passes(packageDir, linker, [...frozenInstall, "--dry-run"], [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();

    await editApp(packageDir, app => (app.dependencies["is-number"] = "1.0.0"));

    await fails(packageDir, linker, [...frozenInstall, "--dry-run"], [prunedNote, ...frozenFailure()]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // pnpm#6312 / pnpm#9741: bun.lock's shape does not depend on the linker or on --production/--omit.
  test.concurrent("pruned bun.lock written with the hoisted linker passes frozen under other settings", async () => {
    const pruned = turboPrune(await monorepoLockfile(linker));
    const { packageDir: isolatedDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await writeTree(isolatedDir, turboOutput, survivors);
    await write(join(isolatedDir, "bun.lock"), pruned);

    await frozen(isolatedDir, "isolated", []);
    expect(await lockText(isolatedDir)).toBe(pruned);
    expect(await installedPackages(isolatedDir, "isolated")).toEqual(survivorsInstalled("isolated"));

    const { packageDir: productionDir } = await registry.createTestDir({ bunfigOpts: { linker } });
    await writeTree(productionDir, turboOutput, survivors);
    await write(join(productionDir, "bun.lock"), pruned);

    await passes(productionDir, linker, [...frozenInstall, "--production", "--omit=optional"], []);
    expect(await lockText(productionDir)).toBe(pruned);
    expect(await installedPackages(productionDir, linker)).toEqual(survivorsOnDisk);
  });

  // pnpm#5794: a pruned bun.lock a plain install would rewrite also fails frozen (the two checks are the same comparison).
  test.concurrent(
    "a hand-edited specifier in the pruned bun.lock fails frozen and is rewritten by a plain install",
    async () => {
      const { packageDir, pruned, full } = await prunedTree(linker);
      const edited = pruned.replace('"a-dep": "1.0.1"', '"a-dep": "1.0.0"');
      expect(edited).not.toBe(pruned);
      await write(join(packageDir, "bun.lock"), edited);

      await frozenFails(packageDir, linker, frozenFailure());
      expect(await lockText(packageDir)).toBe(edited);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();

      await install(packageDir, linker);

      expect(await lockText(packageDir)).toBe(withoutNoDeps(withoutOther(full)));
      expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app", "shared"]);
    },
  );

  test.concurrent("--frozen-lockfile run from inside a surviving workspace", async () => {
    const { packageDir, full } = await verbatimTree(linker);

    await passes(packageDir, linker, frozenInstall, [prunedNote], join(packageDir, "packages", "app"));

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "packages", "app", "bun.lock"))).toBeFalse();
    expect((await lstat(join(packageDir, "node_modules", "app"))).isSymbolicLink()).toBeTrue();
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsOnDisk);
  });

  test.concurrent("workspace folder without a package.json is treated as pruned", async () => {
    const { packageDir, full } = await verbatimTree(linker);
    await write(join(packageDir, "packages", "other", "dist", "index.js"), "");

    await frozen(packageDir, linker, [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(survivorsOnDisk);
    expect(await readdir(join(packageDir, "packages", "other"))).toEqual(["dist"]);
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
    const { packageDir, fullDir } = await verbatimScenario(linker, tree, survivors);
    expect(await exists(join(fullDir, "other-postinstall.txt"))).toBeTrue();
    for (const bin of binFiles(fullDir, "other-cli")) expect(await exists(bin)).toBeTrue();

    const { stdout } = await frozen(packageDir, linker, [prunedNote]);

    expect(stdout).not.toContain("other-postinstall");
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
    const { packageDir, full } = await verbatimScenario(linker, tree, survivors);

    await passes(packageDir, linker, [...frozenInstall, "--production"], [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect((await lstat(join(packageDir, "node_modules", "shared"))).isSymbolicLink()).toBeTrue();
    expect(await installedPackages(packageDir, linker)).toEqual(["app", "shared"]);
  });

  test.concurrent("non-frozen prune writes the same bun.lock a fresh install of the survivors would", async () => {
    const [{ packageDir }, { full: expected }] = await Promise.all([
      verbatimTree(linker),
      fullInstall(linker, {
        root: rootPackageJson,
        packages: { "packages/app": appPackageJson, "packages/shared": sharedPackageJson },
        files: monorepo.files,
      }),
    ]);

    await install(packageDir, linker);

    expect(await lockText(packageDir)).toBe(expected);
  });

  test.concurrent("verbatim bun.lockb with a workspace folder missing passes --frozen-lockfile", async () => {
    const [lockb, { packageDir }] = await Promise.all([
      fullLockb(),
      registry.createTestDir({ bunfigOpts: lockbBunfig }),
    ]);
    await writeTree(packageDir, lockbTree, ["packages/app"]);
    await write(join(packageDir, "bun.lockb"), lockb);

    await frozen(packageDir, linker, [prunedNote]);

    expect(await file(join(packageDir, "bun.lockb")).bytes()).toStrictEqual(lockb);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  test.concurrent("pruned tree using catalogs passes --frozen-lockfile when the catalog is left intact", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    expect(full).toContain('"left-pad": "1.0.0"');

    await frozen(packageDir, linker, [prunedNote]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  // The guards below pass on main too; they pin the boundaries of the pruned-workspace relaxation.
  test.concurrent("a pruned workspace does not mask a workspace added on disk", async () => {
    const { packageDir, full } = await verbatimTree(linker);
    await write(join(packageDir, "packages", "extra", "package.json"), JSON.stringify({ name: "extra" }));

    await frozenFails(packageDir, linker, [prunedNote, ...frozenFailure()]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a pruned workspace does not mask a dependency added to the root package.json", async () => {
    const { packageDir, full } = await verbatimTree(linker);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ ...rootPackageJson, dependencies: { "is-number": "1.0.0" } }),
    );

    await frozenFails(packageDir, linker, [prunedNote, ...frozenFailure()]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent(
    "a dependency-free workspace on disk but missing from bun.lock still fails --frozen-lockfile",
    async () => {
      const { packageDir, pruned } = await prunedTree(linker);
      await write(
        join(packageDir, "packages", "newpkg", "package.json"),
        JSON.stringify({ name: "newpkg", version: "1.0.0" }),
      );
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({ ...rootPackageJson, workspaces: [...survivors, "packages/newpkg"] }),
      );

      await frozenFails(packageDir, linker, frozenFailure());

      expect(await lockText(packageDir)).toBe(pruned);
      expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
    },
  );

  test.concurrent("a package.json change still drops the optional-peer-only entry on a normal install", async () => {
    const { packageDir } = await prunedTree(linker);
    await editApp(packageDir, app => delete app.dependencies["a-dep"]);

    await install(packageDir, linker);

    const lock = await lockText(packageDir);
    expect(lock).not.toContain('"no-deps": ["no-deps@');
    expect(lock).not.toContain('"a-dep"');
    expect(await installedPackages(packageDir, linker)).toEqual(["app", "shared"]);
  });

  test.concurrent("a workspace that is on disk but no longer globbed is not treated as pruned", async () => {
    const [full, { packageDir }] = await Promise.all([
      monorepoLockfile(linker),
      registry.createTestDir({ bunfigOpts: { linker } }),
    ]);
    await writeTree(packageDir, monorepo);
    await write(join(packageDir, "bun.lock"), full);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", workspaces: ["packages/app", "packages/shared"] }),
    );

    await frozenFails(packageDir, linker, frozenFailure());

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
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
      const { full } = await fullInstall(linker, single);
      expect(full).toContain('"trustedDependencies"');
      // The 8-space row is the root's declared dependency; the package entry stays, held only by optional-peer-deps' peer slot.
      const pruned = full.replace(/\n        "no-deps": "1\.0\.0",/, "").replace(trustedDependenciesSection, "");
      expect(pruned).not.toBe(full);
      expect(pruned).toContain('"no-deps": ["no-deps@1.0.0"');
      const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "single",
          dependencies: { "optional-peer-deps": "1.0.0" },
          trustedDependencies: ["optional-peer-deps"],
        }),
      );
      await write(join(packageDir, "bun.lock"), pruned);

      await frozen(packageDir, linker, []);

      expect(await lockText(packageDir)).toBe(pruned);
      expect(await installedPackages(packageDir, linker)).toEqual(["no-deps", "optional-peer-deps"]);
      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
        name: "no-deps",
        version: "1.0.0",
      });
    },
  );

  // Fences of the catalog-subset relaxation: only entries no surviving importer or override references may be missing.
  test.concurrent("a catalog entry a surviving workspace references must stay in bun.lock", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "a-dep", "1.0.1");
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
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
    const { packageDir, full } = await verbatimScenario(linker, tree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "no-deps", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a catalog entry the root package.json references must stay in bun.lock", async () => {
    const tree: Tree = { ...catalogTree, root: { ...catalogTree.root, dependencies: { "left-pad": "catalog:" } } };
    const { packageDir, full } = await verbatimScenario(linker, tree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

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
    const { packageDir, full } = await verbatimScenario(linker, tree, ["packages/app"]);
    expect(full).toContain('"one-dep": {\n      "no-deps": "catalog:",\n    },');
    expect(full).toContain('"no-deps": ["no-deps@1.0.0"');
    const trimmed = trimCatalogLine(full, "no-deps", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

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
      const { packageDir, full } = await verbatimScenario(linker, tree, ["packages/app"]);
      const trimmed = full.replace(/\n  "catalogs": \{\n(?:    [^\n]*\n)*  \},/, "");
      expect(full).toContain('"catalogs"');
      expect(trimmed).not.toContain('"catalogs"');
      expect(trimmed).toContain('"catalog": {\n    "a-dep": "1.0.1",\n  },');
      await write(join(packageDir, "bun.lock"), trimmed);

      await frozen(packageDir, linker, [prunedNote, catalogNote("left-pad", "no-deps")]);

      expect(await lockText(packageDir)).toBe(trimmed);
      expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
        version: "1.0.1",
      });
    },
  );

  test.concurrent("a whole named catalog group a surviving workspace uses must stay in bun.lock", async () => {
    const { packageDir, full } = await verbatimScenario(linker, namedCatalogTree, ["packages/app"]);
    const trimmed = full.replace(/\n  "catalogs": \{\n(?:    [^\n]*\n)*  \},/, "");
    expect(full).toContain('"catalogs"');
    expect(trimmed).not.toContain('"catalogs"');
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("bun.lock may not carry catalog entries package.json lacks", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1" } } }),
    );

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  test.concurrent("a differing specifier is still a change even when the lockfile is a subset", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    const trimmed = trimCatalogLine(full, "left-pad", "1.0.0");
    await write(join(packageDir, "bun.lock"), trimmed);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.2", "left-pad": "1.0.0" } },
      }),
    );

    await frozenFails(packageDir, linker, frozenFailure(changedSectionNote("the catalog")));

    expect(await lockText(packageDir)).toBe(trimmed);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });

  // A hand-maintained bun.lock may list the default catalog under both spellings; the loaded side then has more entries than package.json.
  test.concurrent("a default catalog entry listed under both catalog and catalogs.default in bun.lock", async () => {
    const { packageDir, doubled } = await doubleListedScenario();

    const { stdout } = await frozen(packageDir, linker, []);

    expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      2 packages installed"
    `);
    expect(await lockText(packageDir)).toBe(doubled);
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
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

    const { stdout } = await frozen(packageDir, linker, [catalogNote("left-pad")]);

    expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      2 packages installed"
    `);
    expect(await lockText(packageDir)).toBe(doubled);
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
  });

  test.concurrent("a plain install writes the full catalog back", async () => {
    const { packageDir, full } = await verbatimScenario(linker, catalogTree, ["packages/app"]);
    await write(join(packageDir, "bun.lock"), trimCatalogLine(full, "left-pad", "1.0.0"));

    await install(packageDir, linker);

    const lock = await lockText(packageDir);
    expect(lock).toContain('"catalog": {\n    "a-dep": "1.0.1",\n    "left-pad": "1.0.0",\n  },');
    expect(lock).not.toContain('"packages/other"');
    expect(await installedPackages(packageDir, linker)).toEqual(["a-dep", "app"]);
  });

  // A new edge to a package bun.lock already hoists is invisible to the frozen tree comparison even without pruning, so the change here has to bring in a new package.
  test.concurrent("verbatim lockfile with a hook still fails on a real change", async () => {
    const { packageDir, full } = await verbatimScenario(linker, hookTree, survivors);
    await editApp(packageDir, app => (app.dependencies["no-deps"] = "2.0.0"));

    await frozenFails(packageDir, linker, [prunedNote, ...frozenFailure()]);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules"))).toBeFalse();
  });
});
