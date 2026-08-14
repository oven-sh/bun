import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, lstat, readlink } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe } from "harness";
import { join } from "path";

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

const rootPackageJson: PackageJson = { name: "mono", workspaces: ["packages/*"] };
const appPackageJson: PackageJson = {
  name: "app",
  version: "1.0.0",
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
      .filter(([path]) => workspaces.some(ws => path.startsWith(ws + "/")))
      .map(([path, contents]) => write(join(dir, path), contents)),
  ]);
}

const monorepo: Tree = {
  root: rootPackageJson,
  packages: {
    "packages/app": appPackageJson,
    "packages/shared": sharedPackageJson,
    "packages/other": otherPackageJson,
  },
};

const survivors = ["packages/app", "packages/shared"];

async function writeMonorepo(dir: string, { withOther }: { withOther: boolean }) {
  await writeTree(dir, monorepo, withOther ? undefined : survivors);
}

const explicitMonorepo: Tree = {
  ...monorepo,
  root: { name: "mono", workspaces: ["packages/app", "packages/shared", "packages/other"] },
};

// `--linker` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
async function raw(dir: string, linker: Linker, args: string[], cwd = dir) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "--linker", linker],
    cwd,
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("panic:");
  return { stdout, stderr, exitCode };
}

const prunedNote = "note: skipped 1 workspace listed in bun.lock but not on disk";

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
      return full;
    });
    fullLockfiles.set(linker, lock);
  }
  return lock;
}

// Same shape `turbo prune` emits: the workspace and its exclusive packages go, the peer-reachable no-deps entry stays.
function turboPrune(lock: string): string {
  const pruned = lock
    .replace(/    "packages\/other": \{\n(?:      .*\n)*    \},\n/, "")
    .replace(/\n    "(?:other|left-pad)": \[[^\n]*\],\n\n?/g, "\n");
  expect(pruned).toContain('"no-deps": ["no-deps@1.0.0"');
  expect(pruned).not.toContain('"other"');
  expect(pruned).not.toContain('"left-pad"');
  return pruned;
}

async function prunedTree(linker: Linker) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
  await writeMonorepo(packageDir, { withOther: false });
  const pruned = turboPrune(await fullLockfile(linker));
  await write(join(packageDir, "bun.lock"), pruned);
  return { packageDir, pruned };
}

async function verbatimTree(linker: Linker) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
  await writeMonorepo(packageDir, { withOther: false });
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
  test.concurrent("turbo-pruned lockfile: package held only by an optional peer passes --frozen-lockfile", async () => {
    const { packageDir, pruned } = await prunedTree(linker);

    await frozen(packageDir, linker, 0);

    expect(await lockText(packageDir)).toBe(pruned);
    const noDeps =
      linker === "hoisted"
        ? join(packageDir, "node_modules", "no-deps", "package.json")
        : join(packageDir, "packages", "shared", "node_modules", "no-deps", "package.json");
    expect(await file(noDeps).json()).toEqual({ name: "no-deps", version: "1.0.0" });
  });

  test.concurrent("turbo-pruned lockfile: plain bun install does not rewrite it", async () => {
    const { packageDir, pruned } = await prunedTree(linker);

    const { stderr } = await install(packageDir, linker);

    expect(stderr).not.toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(pruned);
  });

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
    expect(await file(noDeps).json()).toEqual({ name: "no-deps", version: "1.0.0" });
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

  // pnpm#11364: the root lists workspaces by path instead of a glob (what `turbo prune` copies verbatim).
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

    expect(stderr).toContain(prunedNote);
    expect(stderr).not.toContain('skipping workspace "other"');
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
});

describe("hoisted", () => {
  test.concurrent("bun ci behaves the same on the pruned turbo lockfile", async () => {
    const { packageDir, pruned } = await prunedTree("hoisted");

    await frozen(packageDir, "hoisted", 0, ["ci"]);

    expect(await lockText(packageDir)).toBe(pruned);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  // pnpm#11364, turbo shape: bun.lock no longer lists the workspace but the copied root package.json still does.
  test.concurrent("explicitly listed workspace missing from disk and from a turbo-pruned bun.lock", async () => {
    const { full } = await fullInstall("hoisted", explicitMonorepo);
    const pruned = turboPrune(full);
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    await writeTree(packageDir, explicitMonorepo, survivors);
    await write(join(packageDir, "bun.lock"), pruned);

    const { stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stderr).not.toContain("Workspace not found");
    expect(stderr).not.toContain("not on disk");
    expect(await lockText(packageDir)).toBe(pruned);
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
  });

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

  test.concurrent("--verbose names each skipped workspace", async () => {
    const { packageDir } = await verbatimTree("hoisted");

    const { stderr } = await frozen(packageDir, "hoisted", 0, ["install", "--frozen-lockfile", "--verbose"]);

    expect(stderr).toContain('note: skipping workspace "other": listed in bun.lock but not on disk');
    expect(stderr).toContain(prunedNote);
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

    expect(stderr).toContain("note: skipped 2 workspaces listed in bun.lock but not on disk");
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
    const tree: Tree = {
      root: { name: "mono", workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1" } } },
      packages: {
        "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:" } },
        "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "1.0.0" } },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.2" } } }),
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
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await writeMonorepo(packageDir, { withOther: false });
    await write(join(packageDir, "bun.lock"), pruned);

    await frozen(packageDir, "isolated", 0);
    expect(await lockText(packageDir)).toBe(pruned);
    expect(await exists(installedPath(packageDir, "isolated", "a-dep", "1.0.1"))).toBeTrue();

    await frozen(packageDir, "hoisted", 0, ["install", "--frozen-lockfile", "--production", "--omit=optional"]);
    expect(await lockText(packageDir)).toBe(pruned);
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
    expect(await exists(join(fullDir, "node_modules", ".bin", "other-cli"))).toBeTrue();

    const { stdout, stderr } = await frozen(packageDir, "hoisted", 0);

    expect(stdout + stderr).not.toContain("other-postinstall");
    expect(stdout + stderr).not.toContain("ENOENT");
    expect(await exists(join(packageDir, "other-postinstall.txt"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", ".bin", "other-cli"))).toBeFalse();
    expect(await readlink(join(packageDir, "node_modules", ".bin", "app-cli"))).toContain("app");
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

    expect(await file(join(packageDir, "bun.lockb")).bytes()).toEqual(lockb);
    expect(await exists(join(packageDir, "bun.lock"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "other"))).toBeFalse();
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  test.concurrent("pruned tree using catalogs passes --frozen-lockfile when the catalog is left intact", async () => {
    const tree: Tree = {
      root: {
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1", "left-pad": "1.0.0" } },
      },
      packages: {
        "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:" } },
        "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "catalog:" } },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
    expect(full).toContain('"left-pad": "1.0.0"');

    await frozen(packageDir, "hoisted", 0);

    expect(await lockText(packageDir)).toBe(full);
    expect(await exists(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
  });

  // Pins the boundary: unlike pnpm, a catalog entry trimmed from bun.lock is a real package.json/lockfile disagreement.
  test.concurrent("pruned tree whose bun.lock catalog was trimmed still fails --frozen-lockfile", async () => {
    const tree: Tree = {
      root: {
        name: "mono",
        workspaces: { packages: ["packages/*"], catalog: { "a-dep": "1.0.1", "left-pad": "1.0.0" } },
      },
      packages: {
        "packages/app": { name: "app", version: "1.0.0", dependencies: { "a-dep": "catalog:" } },
        "packages/other": { name: "other", version: "1.0.0", dependencies: { "left-pad": "catalog:" } },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, ["packages/app"]);
    const trimmed = full.replace(/\n +"left-pad": "1\.0\.0",?\n/, "\n");
    expect(trimmed).not.toBe(full);
    await write(join(packageDir, "bun.lock"), trimmed);

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(trimmed);
  });

  // The guards below pass on main too; they pin the boundaries of the frozen-lockfile relaxation.
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
    await writeMonorepo(packageDir, { withOther: true });
    const full = await fullLockfile("hoisted");
    await write(join(packageDir, "bun.lock"), full);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", workspaces: ["packages/app", "packages/shared"] }),
    );

    await frozen(packageDir, "hoisted", 1);

    expect(await lockText(packageDir)).toBe(full);
  });

  // An invalid prune (turbo always keeps transitive workspace deps): the survivor's `workspace:` edge is reported.
  test.concurrent("a survivor depending on a pruned workspace fails naming the missing workspace", async () => {
    const tree: Tree = {
      root: rootPackageJson,
      packages: {
        ...monorepo.packages,
        "packages/app": {
          ...appPackageJson,
          dependencies: { ...(appPackageJson.dependencies as object), other: "workspace:*" },
        },
      },
    };
    const { packageDir, full } = await verbatimScenario("hoisted", tree, survivors);

    const { stderr, exitCode } = await raw(packageDir, "hoisted", ["install", "--frozen-lockfile"]);

    expect(stderr).toContain('Workspace dependency "other" not found');
    expect(stderr).toContain("other@workspace:* failed to resolve");
    expect(exitCode).toBe(1);
    expect(await lockText(packageDir)).toBe(full);
    expect(await lstat(join(packageDir, "node_modules", "other")).catch(e => e.code)).toBe("ENOENT");
  });
});
