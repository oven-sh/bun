// `--frozen-lockfile` / `bun ci` on a checkout where package.json and the lockfile disagree (an edited package.json, a
// mis-merged bun.lock). It passes as long as every package still resolves to its locked version. It fails when an edit
// adds a package, removes one, or changes a version.
import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type PackageJson = Record<string, any>;
type LockfileName = "bun.lock" | "bun.lockb";

const patch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

// no-deps@^1.0.0 locks 1.1.0 (the registry also has 1.0.0, 1.0.1 and 2.0.0).
const root: PackageJson = {
  name: "root",
  version: "1.0.0",
  workspaces: ["packages/*"],
  dependencies: { "a-dep": "1.0.1", "no-deps": "^1.0.0", vendored: "file:./vendor/vendored" },
  trustedDependencies: ["a-dep"],
  patchedDependencies: { "a-dep@1.0.1": "patches/a-dep@1.0.1.patch" },
};
const member: PackageJson = {
  name: "member",
  version: "1.0.0",
  scripts: { postinstall: "echo postinstall" },
  dependencies: { "a-dep": "1.0.1" },
};
const vendored: PackageJson = { name: "vendored", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } };

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Compared as text: bun.lockb through latin1, which maps every byte.
const lockText = async (dir: string, name: LockfileName = "bun.lock") =>
  Buffer.from(await file(join(dir, name)).bytes()).toString("latin1");

// A project installed once from `rootJson` / `memberJson`, returning its dir and the lockfile that install wrote.
// A `rootJson` without "workspaces" gets no workspace folders.
async function installed(
  rootJson: PackageJson = root,
  memberJson: PackageJson = member,
  lockfile: LockfileName = "bun.lock",
) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted", saveTextLockfile: lockfile === "bun.lock" },
    files: {
      "package.json": JSON.stringify(rootJson),
      ...(rootJson.workspaces && {
        "packages/member/package.json": JSON.stringify(memberJson),
        "packages/shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
      }),
      "vendor/vendored/package.json": JSON.stringify(vendored),
      "patches/a-dep@1.0.1.patch": patch,
      "patches/no-deps@1.1.0.patch": patch,
    },
  });
  const { stderr, exitCode } = await bun(packageDir, "install");
  expect(stderr).toContain("Saved lockfile");
  expect(exitCode).toBe(0);
  return { packageDir, lock: await lockText(packageDir, lockfile) };
}

const writeRoot = (dir: string, json: PackageJson) => write(join(dir, "package.json"), JSON.stringify(json));
const writeMember = (dir: string, json: PackageJson) =>
  write(join(dir, "packages", "member", "package.json"), JSON.stringify(json));
const writeVendored = (dir: string, json: PackageJson) =>
  write(join(dir, "vendor", "vendored", "package.json"), JSON.stringify(json));

const frozenError = "error: lockfile had changes, but lockfile is frozen";
const dependenciesNote = (lockfile: LockfileName = "bun.lock") =>
  `note: dependencies in package.json changed since ${lockfile} was saved`;

type Edit = {
  /** The root package.json the project is installed from, `root` by default. */
  from?: PackageJson;
  root?: (json: PackageJson) => PackageJson;
  member?: (json: PackageJson) => PackageJson;
  vendored?: (json: PackageJson) => PackageJson;
};

async function apply(dir: string, edit: Edit) {
  if (edit.root) await writeRoot(dir, edit.root(edit.from ?? root));
  if (edit.member) await writeMember(dir, edit.member(member));
  if (edit.vendored) await writeVendored(dir, edit.vendored(vendored));
}

const without = (json: PackageJson, key: string) => {
  const { [key]: _, ...rest } = json;
  return rest;
};

const singlePackage = without(root, "workspaces");
// Two catalogs with the same range, so only the literal tells `catalog:` from `catalog:other`.
const twoCatalogs: PackageJson = {
  ...root,
  workspaces: {
    packages: ["packages/*"],
    catalog: { "no-deps": "^1.0.0" },
    catalogs: { other: { "no-deps": "^1.0.0" } },
  },
  dependencies: { ...root.dependencies, "no-deps": "catalog:" },
};
// one-dep@1.0.0 depends on no-deps@1.0.1, so no-deps is in the tree without the root listing it.
const transitive: PackageJson = { name: "root", version: "1.0.0", dependencies: { "one-dep": "1.0.0" } };

// Each edit keeps every package at its locked version; the next plain `bun install` rewrites the lockfile for all of them.
const dependencyRows: Record<string, Edit> = {
  "a dependency's range is loosened but still satisfied by the locked version": {
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": ">=1.0.0" } }),
  },
  "a dependency's range is raised to the locked version": {
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "^1.1.0" } }),
  },
  "a dependency's range is pinned to the locked version": {
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "1.1.0" } }),
  },
  "a dependency is added that the lockfile already resolves transitively": {
    from: transitive,
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "1.0.1" } }),
  },
  "a dependency that stays in the tree transitively is removed": {
    from: { ...transitive, dependencies: { ...transitive.dependencies, "no-deps": "1.0.1" } },
    root: json => ({ ...json, dependencies: without(json.dependencies, "no-deps") }),
  },
  "a catalog: dependency moves to another catalog with the same range": {
    from: twoCatalogs,
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "catalog:other" } }),
  },
  "a dependency moves from dependencies to devDependencies": {
    root: json => ({
      ...json,
      dependencies: without(json.dependencies, "no-deps"),
      devDependencies: { "no-deps": "^1.0.0" },
    }),
  },
  "a peer dependency becomes optional": {
    from: { ...transitive, peerDependencies: { "no-deps": "1.0.1" } },
    root: json => ({ ...json, peerDependenciesMeta: { "no-deps": { optional: true } } }),
  },
  "a workspace drops a dependency that the root still needs": {
    member: json => ({ ...json, dependencies: without(json.dependencies, "a-dep") }),
  },
  // https://github.com/oven-sh/bun/issues/22689
  "a workspace adds a dependency that the lockfile already resolves for another workspace": {
    member: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "^1.0.0" } }),
  },
  "a workspace's range is retyped": {
    member: json => ({ ...json, dependencies: { "a-dep": "^1.0.1" } }),
  },
};

// Each of these edits changes which packages get installed.
const packageRows: Record<string, Edit & { names: string }> = {
  "a dependency's range no longer matches the locked version": {
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "^2.0.0" } }),
    names: "no-deps changed from ^1.0.0 to ^2.0.0",
  },
  "a new dependency isn't in the lockfile": {
    root: json => ({ ...json, dependencies: { ...json.dependencies, "basic-1": "1.0.0" } }),
    names: "basic-1 was added",
  },
  "a dependency that nothing else needs is removed": {
    root: json => ({ ...json, dependencies: without(json.dependencies, "no-deps") }),
    names: "no-deps was removed",
  },
  "a workspace adds a dependency that isn't in the lockfile": {
    member: json => ({ ...json, dependencies: { ...json.dependencies, "basic-1": "1.0.0" } }),
    names: "basic-1 was added in packages/member",
  },
};

describe.each(["bun.lock", "bun.lockb"] as const)("%s", lockfile => {
  describe.concurrent("--frozen-lockfile fails when", () => {
    test.each(Object.entries(packageRows))("%s", async (_name, edit) => {
      const { packageDir, lock } = await installed(root, member, lockfile);
      await apply(packageDir, edit);

      for (const args of [["install", "--frozen-lockfile"], ["ci"]]) {
        const frozen = await bun(packageDir, ...args);

        expect(frozen.stderr).toContain(frozenError);
        expect(frozen.stderr).toContain(`${dependenciesNote(lockfile)}: ${edit.names}\n`);
        expect(await lockText(packageDir, lockfile)).toBe(lock);
        expect(frozen.exitCode).toBe(1);
      }
    });
  });

  describe.concurrent("--frozen-lockfile passes when", () => {
    test.each(Object.entries(dependencyRows))("%s", async (_name, edit) => {
      const { packageDir, lock } = await installed(edit.from ?? root, member, lockfile);
      await apply(packageDir, edit);

      for (const args of [["install", "--frozen-lockfile"], ["ci"]]) {
        const frozen = await bun(packageDir, ...args);

        expect(frozen.stderr).not.toContain("error:");
        expect(await lockText(packageDir, lockfile)).toBe(lock);
        expect(frozen.exitCode).toBe(0);
      }

      const plain = await bun(packageDir, "install");

      expect(plain.stderr).toContain("Saved lockfile");
      const rewritten = await lockText(packageDir, lockfile);
      expect(rewritten).not.toBe(lock);
      expect(plain.exitCode).toBe(0);

      const after = await bun(packageDir, "install", "--frozen-lockfile");

      expect(after.stderr).not.toContain("error:");
      expect(await lockText(packageDir, lockfile)).toBe(rewritten);
      expect(after.exitCode).toBe(0);
    });
  });
});

describe.concurrent("--frozen-lockfile passes when", () => {
  // `git merge` joins two branches' bun.lock without conflict markers when a workspace's block ends with the same line
  // as the root's, and the new root dependency lands in the workspace's block. The tree is the same either way.
  test("a merge put a root dependency into a workspace's block of bun.lock", async () => {
    const { packageDir, lock } = await installed();
    const row = '        "no-deps": "^1.0.0",\n';
    const memberDependencies =
      '"packages/member": {\n      "name": "member",\n      "version": "1.0.0",\n      "dependencies": {\n        "a-dep": "1.0.1",\n';
    expect(lock.indexOf(row)).toBeGreaterThan(-1);
    expect(lock.indexOf(row)).toBeLessThan(lock.indexOf(memberDependencies));
    const merged = lock.replace(row, "").replace(memberDependencies, memberDependencies + row);
    expect(merged).not.toBe(lock);
    await write(join(packageDir, "bun.lock"), merged);

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(merged);
    expect(frozen.exitCode).toBe(0);

    const plain = await bun(packageDir, "install");

    expect(plain.stderr).toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(lock);
    expect(plain.exitCode).toBe(0);

    const after = await bun(packageDir, "install", "--frozen-lockfile");

    expect(after.stderr).not.toContain("error:");
    expect(after.exitCode).toBe(0);
  });
});

describe.concurrent("--frozen-lockfile fails when", () => {
  // https://github.com/oven-sh/bun/issues/43795: taking one side of a package.json conflict reverts a bump but leaves
  // the lockfile's resolution ahead of it (or behind it). The range in bun.lock and in package.json agree.
  test.each([
    ["the root", "package.json", "root"],
    ["a workspace", "packages/member/package.json", "member"],
  ] as const)("bun.lock pins a version that the range in %s rules out", async (_, manifest, owner) => {
    const own = { "no-deps": "1.0.0" };
    const { packageDir, lock } = await installed(
      { name: "root", version: "1.0.0", workspaces: ["packages/*"], ...(owner === "root" && { dependencies: own }) },
      { name: "member", version: "1.0.0", ...(owner === "member" && { dependencies: own }) },
    );
    // package.json and the copy of its range in bun.lock say 2.0.0, `packages` still resolves 1.0.0
    const json = await file(join(packageDir, manifest)).json();
    await write(join(packageDir, manifest), JSON.stringify({ ...json, dependencies: { "no-deps": "2.0.0" } }));
    const stale = lock.replace('"no-deps": "1.0.0",', '"no-deps": "2.0.0",');
    expect(stale).not.toBe(lock);
    expect(stale).toContain('"no-deps@1.0.0"');
    await write(join(packageDir, "bun.lock"), stale);
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    for (const args of [["install", "--frozen-lockfile"], ["ci"]]) {
      const frozen = await bun(packageDir, ...args);
      expect(frozen.stderr).toContain(frozenError);
      expect(await lockText(packageDir)).toBe(stale);
      expect(frozen.exitCode).toBe(1);
    }

    // the advice in the error has to work
    const plain = await bun(packageDir, "install");
    expect(plain.stderr).toContain("Saved lockfile");
    expect(await lockText(packageDir)).toContain('"no-deps@2.0.0"');
    expect(await lockText(packageDir)).not.toContain('"no-deps@1.0.0"');
    expect(plain.exitCode).toBe(0);

    const after = await bun(packageDir, "install", "--frozen-lockfile");
    expect(after.stderr).not.toContain("error:");
    expect(after.exitCode).toBe(0);
  });

  test("and prints what changed, also as bun install --production", async () => {
    const unpatched = without(root, "patchedDependencies");
    const { packageDir, lock } = await installed(unpatched);
    await writeRoot(packageDir, { ...unpatched, dependencies: without(unpatched.dependencies, "no-deps") });

    const { stdout, stderr, exitCode } = await bun(packageDir, "install", "--frozen-lockfile");

    expect(normalizeBunSnapshot(stderr, packageDir)).toMatchInlineSnapshot(`
      "error: lockfile had changes, but lockfile is frozen
      note: dependencies in package.json changed since bun.lock was saved: no-deps was removed
      note: try re-running without --frozen-lockfile and commit the updated lockfile"
    `);
    expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);

    // Implies --frozen-lockfile.
    const production = await bun(packageDir, "install", "--production");

    expect(production.stderr).toContain(frozenError);
    expect(production.stderr).toContain(dependenciesNote());
    expect(await lockText(packageDir)).toBe(lock);
    expect(production.exitCode).toBe(1);
  });
});

// Names bun.lock does not list because they are not in the tree. The differ reports them as added on every install.
const staleTrustedDependencies = ["a-dep", "not-installed", "esbuild", "sharp", "@prisma/client", "core-js", "bcrypt"];

// Edits for which a plain `bun install` leaves bun.lock byte for byte as it is.
const notRecorded: Record<string, Edit> = {
  "a trustedDependencies name that is not in the tree": {
    root: json => ({ ...json, trustedDependencies: ["a-dep", "not-installed"] }),
  },
  "several trustedDependencies names that are not in the tree": {
    root: json => ({ ...json, trustedDependencies: staleTrustedDependencies }),
  },
  "a workspace's lifecycle script": {
    member: json => ({ ...json, scripts: { postinstall: "echo changed" } }),
  },
  "a file: directory's lifecycle script": {
    vendored: json => ({ ...json, scripts: { postinstall: "echo changed" } }),
  },
  "package.json key order and formatting": {
    root: json => ({
      trustedDependencies: staleTrustedDependencies,
      ...without(json, "trustedDependencies"),
      dependencies: { vendored: "file:./vendor/vendored", "no-deps": "^1.0.0", "a-dep": "1.0.1" },
    }),
  },
  // bun.lock only records the patchedDependencies entries that apply to a package in the tree.
  "a patchedDependencies entry for a version that is not in the tree": {
    root: json => ({
      ...json,
      patchedDependencies: { ...json.patchedDependencies, "no-deps@2.0.0": "patches/no-deps@1.1.0.patch" },
    }),
  },
};

// Edits a plain install does write to bun.lock. They are not dependency rows.
const otherSections: Record<string, Edit> = {
  // Release tooling bumps versions without an install.
  "a workspace's version": {
    root: json => ({ ...json, trustedDependencies: staleTrustedDependencies }),
    member: json => ({ ...json, version: "1.0.1" }),
  },
  // No version before 1.5 rewrote these, so a bun.lock that has one is not out of date by the user's omission.
  "a range that is written differently and means the same": {
    root: json => ({ ...json, dependencies: { ...json.dependencies, "a-dep": "=1.0.1" } }),
  },
  "a workspace's range that is written differently and means the same": {
    member: json => ({ ...json, dependencies: { "a-dep": "=1.0.1" } }),
  },
  "a workspace's bin": { member: json => ({ ...json, bin: "./cli.js" }) },
  "a file: directory's bin": { vendored: json => ({ ...json, bin: "./cli.js" }) },
  "a patchedDependencies entry is added for a locked package": {
    root: json => ({
      ...json,
      patchedDependencies: { ...json.patchedDependencies, "no-deps@1.1.0": "patches/no-deps@1.1.0.patch" },
    }),
  },
  "a patchedDependencies entry is removed": { root: json => without(json, "patchedDependencies") },
  "a locked package is added to trustedDependencies": {
    root: json => ({ ...json, trustedDependencies: ["a-dep", "no-deps"] }),
  },
  "the first trustedDependencies list is added": {
    from: without(singlePackage, "trustedDependencies"),
    root: json => ({ ...json, trustedDependencies: ["a-dep"] }),
  },
  "the first patchedDependencies entry is added": {
    from: without(singlePackage, "patchedDependencies"),
    root: json => ({ ...json, patchedDependencies: { "a-dep@1.0.1": "patches/a-dep@1.0.1.patch" } }),
  },
  "trustedDependencies is emptied": { from: singlePackage, root: json => ({ ...json, trustedDependencies: [] }) },
  "trustedDependencies is emptied in a workspace project": { root: json => ({ ...json, trustedDependencies: [] }) },
  "trustedDependencies is removed": { from: singlePackage, root: json => without(json, "trustedDependencies") },
};

describe.concurrent("--frozen-lockfile still passes after an edit of", () => {
  test.each(Object.entries(notRecorded))("%s", async (_name, edit) => {
    const { packageDir, lock } = await installed();
    await apply(packageDir, edit);

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(0);

    const plain = await bun(packageDir, "install");

    expect(plain.stderr).not.toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(lock);
    expect(plain.exitCode).toBe(0);
  });

  test.each(Object.entries(otherSections))("%s", async (_name, edit) => {
    const { packageDir, lock } = await installed(edit.from ?? root);
    await apply(packageDir, edit);

    for (const args of [["install", "--frozen-lockfile"], ["ci"]]) {
      const frozen = await bun(packageDir, ...args);

      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.stderr).not.toContain("warn:");
      expect(await lockText(packageDir)).toBe(lock);
      expect(frozen.exitCode).toBe(0);
    }
  });

  // No version before 1.5 read the package.json of a `file:` directory again, so a bun.lock that's behind one isn't out
  // of date because of something the user forgot. A frozen install reports it and installs what's locked.
  test.each([
    [
      "adds a dependency",
      (json: PackageJson) => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "2.0.0" } }),
    ],
    ["drops a dependency", (json: PackageJson) => without(json, "dependencies")],
    ["retypes a range", (json: PackageJson) => ({ ...json, dependencies: { "a-dep": "^1.0.1" } })],
  ] as const)("a file: directory that %s, with a warning", async (_name, edit) => {
    const { packageDir, lock } = await installed();
    await writeVendored(packageDir, edit(vendored));
    // Hashing the patch file is the one task of every install of this project.
    const hashedThePatch = ["Resolving dependencies", "Resolved, downloaded and extracted [1]"];

    for (const args of [["install", "--frozen-lockfile"], ["ci"]]) {
      const frozen = await bun(packageDir, ...args);

      expect(frozen.stderr.split("\n").filter(Boolean)).toEqual([
        ...hashedThePatch,
        "warn: dependencies in vendor/vendored/package.json changed since lockfile was saved (run 'bun install')",
      ]);
      expect(await lockText(packageDir)).toBe(lock);
      expect(frozen.exitCode).toBe(0);
    }

    const plain = await bun(packageDir, "install");

    expect(plain.stderr).not.toContain("warn:");
    expect(plain.stderr).toContain("Saved lockfile");
    expect(await lockText(packageDir)).not.toBe(lock);
    expect(plain.exitCode).toBe(0);

    const after = await bun(packageDir, "install", "--frozen-lockfile");

    expect(after.stderr.split("\n").filter(Boolean)).toEqual(hashedThePatch);
    expect(after.exitCode).toBe(0);
  });

  // One install records a new bin, and doesn't change the version that the package is locked to.
  test.each([
    ["a workspace", { member: json => ({ ...json, bin: "./cli.js" }) }, '"bin": "./cli.js"'],
    ["a file: directory", { vendored: json => ({ ...json, bin: "./cli.js" }) }, '"bin": "./cli.js"'],
  ] as [string, Edit, string][])("the bin of %s, which the next install records", async (_name, edit, recorded) => {
    const { packageDir, lock } = await installed();
    expect(lock).not.toContain(recorded);
    await apply(packageDir, edit);

    const plain = await bun(packageDir, "install");

    expect(plain.stderr).toContain("Saved lockfile");
    const rewritten = await lockText(packageDir);
    expect(rewritten).toContain(recorded);
    expect(plain.exitCode).toBe(0);

    const again = await bun(packageDir, "install");

    expect(again.stderr).not.toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(rewritten);
    expect(again.exitCode).toBe(0);
  });
});

describe.concurrent("--frozen-lockfile still passes on", () => {
  // A pin outside its range is legitimate in these cases.
  test.each([
    ["an override", { dependencies: { "no-deps": "^1.0.0" }, overrides: { "no-deps": "2.0.0" } }, "no-deps@2.0.0"],
    ["a prerelease that latest points at", { dependencies: { "prereleases-1": "*" } }, "prereleases-1@1.0.0-future."],
    ["a peer", { peerDependencies: { "no-deps": "^1.0.0" }, dependencies: { "no-deps": "2.0.0" } }, "no-deps@2.0.0"],
    // It never resolved, and the root's no-deps has the same name.
    [
      "an optional dependency that no version satisfies",
      { workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } },
      "no-deps@1.0.0",
      { optionalDependencies: { "no-deps": "^9.0.0" } },
    ],
  ] as const)("a version outside the declared range because of %s", async (_, json, pinned, memberJson = {}) => {
    const { packageDir, lock } = await installed(
      { name: "root", version: "1.0.0", ...json },
      { name: "member", version: "1.0.0", ...memberJson },
    );
    expect(lock).toContain(`"${pinned}`);
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");
    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(0);

    const plain = await bun(packageDir, "install");
    expect(plain.stderr).not.toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(lock);
    expect(plain.exitCode).toBe(0);
  });

  // bun.lock records one trustedDependencies list for all workspaces, so a checkout with a workspace left out (a Docker
  // context, `turbo prune`) declares fewer names than bun.lock lists.
  test("a pruned checkout without the workspace that declared a trustedDependencies name", async () => {
    const { packageDir, lock } = await installed(without(root, "trustedDependencies"), {
      ...member,
      dependencies: { ...member.dependencies, "no-deps": "^1.0.0" },
      trustedDependencies: ["a-dep", "no-deps"],
    });
    expect(lock).toContain('"trustedDependencies": [');
    await rm(join(packageDir, "packages", "member"), { recursive: true, force: true });
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.stderr).toContain('note: skipped 1 workspace listed in bun.lock but not on disk: "member"');
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(0);
  });

  // `turbo prune` writes bun.lock without the bins of the workspaces.
  test("a bun.lock without the bin of a workspace", async () => {
    const { packageDir, lock } = await installed(root, { ...member, bin: "./cli.js" });
    const bin = ',\n      "bin": "./cli.js"';
    expect(lock).toContain(bin);
    const stripped = lock.replace(bin, "");
    await write(join(packageDir, "bun.lock"), stripped);

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(stripped);
    expect(frozen.exitCode).toBe(0);
  });

  test("trustedDependencies declared by a workspace", async () => {
    const { packageDir, lock } = await installed(
      { ...root, trustedDependencies: staleTrustedDependencies },
      { ...member, trustedDependencies: ["a-dep"] },
    );

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(0);
  });

  // --production implies --frozen-lockfile and leaves devDependencies out of node_modules, not out of the comparison.
  test("--production with trusted and patched devDependencies", async () => {
    const { packageDir, lock } = await installed(
      {
        ...without(root, "dependencies"),
        devDependencies: root.dependencies,
        trustedDependencies: staleTrustedDependencies,
      },
      { name: "member", version: "1.0.0" },
    );
    expect(lock).toContain('"trustedDependencies"');
    expect(lock).toContain('"patchedDependencies"');

    const production = await bun(packageDir, "install", "--production");

    expect(production.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(lock);
    expect(production.exitCode).toBe(0);
  });

  // An older Bun, another tool or a CRLF checkout formats bun.lock differently. Only its contents are compared.
  test("a bun.lock that this version of bun would format differently", async () => {
    const { packageDir, lock } = await installed();
    const reformatted = lock.replace('  "configVersion": 1,\n', "").replaceAll("\n", "\r\n");
    expect(reformatted).not.toBe(lock);
    await write(join(packageDir, "bun.lock"), reformatted);
    await writeRoot(packageDir, { ...root, trustedDependencies: ["a-dep", "not-installed"] });

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(reformatted);
    expect(frozen.exitCode).toBe(0);
  });

  // The rest are lockfiles that an older Bun wrote for an unedited package.json. A plain install rewrites them, but a
  // failing `bun ci` on an untouched checkout would blame an edit that nobody made.

  // bun records a name that is only in peerDependenciesMeta as a `*` optional peer. Older versions did not.
  test.each([
    ["the root", (meta: PackageJson) => [{ ...root, ...meta }, member]],
    ["a workspace", (meta: PackageJson) => [root, { ...member, ...meta }]],
  ] as const)(
    "a bun.lock from before peerDependenciesMeta-only names of %s were recorded",
    async (_name, manifests) => {
      const [rootJson, memberJson] = manifests({ peerDependenciesMeta: { "no-deps": { optional: true } } });
      const { packageDir, lock } = await installed(rootJson, memberJson);
      const optionalPeerRows =
        ',\n      "peerDependencies": {\n        "no-deps": "*",\n      },\n      "optionalPeers": [\n        "no-deps",\n      ]';
      expect(lock).toContain(optionalPeerRows);
      const older = lock.replace(optionalPeerRows, "");
      await write(join(packageDir, "bun.lock"), older);

      const frozen = await bun(packageDir, "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(await lockText(packageDir)).toBe(older);
      expect(frozen.exitCode).toBe(0);
    },
  );

  // Migrating a pnpm-lock.yaml recorded the catalog's range where package.json says `catalog:`.
  test("a bun.lock that records a catalog: dependency as the catalog's range", async () => {
    const { packageDir, lock } = await installed({
      ...root,
      workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^1.0.0" } },
      dependencies: { ...root.dependencies, "no-deps": "catalog:" },
    });
    expect(lock).toContain('"no-deps": "catalog:"');
    const migrated = lock.replace('"no-deps": "catalog:"', '"no-deps": "^1.0.0"');
    await write(join(packageDir, "bun.lock"), migrated);

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(migrated);
    expect(frozen.exitCode).toBe(0);
  });

  // Up to Bun 1.1, `bun add what-bin` wrote `^1.5.0` to package.json and left what it was asked for, `""` or a tag, in
  // the lockfile until the next install. One in eight bun.lockb files of Bun's own repository was committed like that.
  describe.each(["bun.lock", "bun.lockb"] as const)("a %s in which bun add left its request", lockfile => {
    const added: Record<string, (range: string) => [PackageJson, PackageJson]> = {
      "the root": range => [{ ...root, dependencies: { ...root.dependencies, "what-bin": range } }, member],
      "a workspace": range => [root, { ...member, devDependencies: { "what-bin": range } }],
    };

    test.each(["", "latest"].flatMap(request => Object.keys(added).map(where => [request, where] as const)))(
      "%j for %s",
      async (request, where) => {
        const { packageDir, lock } = await installed(...added[where](request), lockfile);
        const declare = async (range: string) => {
          const [rootJson, memberJson] = added[where](range);
          await Promise.all([writeRoot(packageDir, rootJson), writeMember(packageDir, memberJson)]);
        };
        await declare("^1.5.0");

        const frozen = await bun(packageDir, "install", "--frozen-lockfile");

        expect(frozen.stderr).not.toContain("error:");
        expect(await lockText(packageDir, lockfile)).toBe(lock);
        expect(frozen.exitCode).toBe(0);

        // bun add wrote no range that the version it locked is outside of.
        await declare("1.0.0");

        const outside = await bun(packageDir, "install", "--frozen-lockfile");

        expect(outside.stderr).toContain(frozenError);
        expect(await lockText(packageDir, lockfile)).toBe(lock);
        expect(outside.exitCode).toBe(1);
      },
    );
  });
});

// Ways workspaces reach each other that the lockfile reloads through its own rules. The differ sees the reloaded lockfile
// on one side and the reparsed package.json files on the other, so each has to come out the same.
const monorepo = (members: Record<string, PackageJson>, rootJson: PackageJson = {}) => ({
  "package.json": { name: "root", workspaces: ["packages/*"], trustedDependencies: ["not-installed"], ...rootJson },
  ...Object.fromEntries(
    Object.entries(members).map(([name, json]) => [`packages/${name}/package.json`, { name, ...json }]),
  ),
});
const unchangedProjects: Record<string, Record<string, PackageJson>> = {
  "a workspace: dependency on a sibling": monorepo({
    app: { version: "1.0.0", dependencies: { lib: "workspace:*", "no-deps": "^1.0.0" } },
    lib: { version: "1.0.0", dependencies: { "a-dep": "1.0.1" } },
  }),
  "root dependencies on its own workspaces": monorepo(
    { app: { version: "1.0.0" }, lib: { version: "1.0.0" } },
    { dependencies: { app: "workspace:*", "no-deps": "^1.0.0" }, devDependencies: { lib: "^1.0.0" } },
  ),
  "a root range its workspace does not satisfy, sent there by an override": monorepo(
    { lib: { version: "1.0.0" } },
    { dependencies: { lib: "^9.0.0", "no-deps": "^1.0.0" }, overrides: { lib: "workspace:*" } },
  ),
  "a sibling in devDependencies and peerDependencies": monorepo({
    app: { version: "1.0.0", devDependencies: { lib: "workspace:*" }, peerDependencies: { lib: "*" } },
    lib: { version: "1.0.0" },
  }),
  "a sibling range in two dependency groups": monorepo({
    app: { version: "1.0.0", devDependencies: { lib: "^1.0.0" }, peerDependencies: { lib: "^1.0.0" } },
    lib: { version: "1.0.0" },
  }),
  "a star range on a sibling without a version": monorepo({
    app: { version: "1.0.0", dependencies: { lib: "*" } },
    lib: {},
  }),
  "an npm: alias of a sibling": monorepo({
    app: { version: "1.0.0", dependencies: { renamed: "npm:lib@*" } },
    lib: { version: "1.0.0" },
  }),
  "a catalog entry that points at a workspace": monorepo(
    { app: { version: "1.0.0", dependencies: { lib: "catalog:", "no-deps": "catalog:" } }, lib: { version: "1.0.0" } },
    { workspaces: { packages: ["packages/*"], catalog: { lib: "workspace:*", "no-deps": "^1.0.0" } } },
  ),
  "an override that sends an unsatisfied range to a workspace": monorepo(
    { app: { version: "1.0.0", dependencies: { lib: "^5.0.0" } }, lib: { version: "1.0.0" } },
    { overrides: { lib: "workspace:*" } },
  ),
  "an optional peer and a lifecycle script in a workspace": monorepo({
    app: {
      version: "1.0.0",
      scripts: { postinstall: "echo postinstall" },
      peerDependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.1" },
      peerDependenciesMeta: { "a-dep": { optional: true } },
    },
  }),
  "one name in dependencies and optionalDependencies": monorepo(
    { app: { version: "1.0.0", dependencies: { "no-deps": "1.0.0" }, optionalDependencies: { "no-deps": "1.0.1" } } },
    { dependencies: { "a-dep": "1.0.1" }, optionalDependencies: { "a-dep": "1.0.2" } },
  ),
  "ranges with spaces around them, a dist-tag and an empty range": monorepo(
    { app: { version: "1.0.0", dependencies: { "no-deps": " ^1.0.0 ", "a-dep": "" } } },
    { dependencies: { "no-deps": "latest" } },
  ),
  "a $name override": {
    "package.json": {
      name: "root",
      dependencies: { "no-deps": "^1.0.0", "a-dep": "1.0.1" },
      overrides: { "a-dep": "$no-deps" },
      trustedDependencies: ["not-installed"],
    },
  },
};

describe.each(["bun.lock", "bun.lockb"] as const)("%s", lockfile => {
  describe.concurrent("--frozen-lockfile still passes on an unchanged project with", () => {
    test.each(Object.entries(unchangedProjects))("%s", async (_name, files) => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted", saveTextLockfile: lockfile === "bun.lock" },
        files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
      });
      const first = await bun(packageDir, "install");
      expect(first.stderr).toContain("Saved lockfile");
      expect(first.exitCode).toBe(0);
      const lock = await lockText(packageDir, lockfile);

      const frozen = await bun(packageDir, "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(frozen.exitCode).toBe(0);

      // And from a clean checkout, as CI runs it.
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      const ci = await bun(packageDir, "ci");

      expect(ci.stderr).not.toContain("error:");
      expect(ci.exitCode).toBe(0);

      const plain = await bun(packageDir, "install");

      expect(plain.stderr).not.toContain("Saved lockfile");
      expect(await lockText(packageDir, lockfile)).toBe(lock);
      expect(plain.exitCode).toBe(0);
    });
  });
});

// `changeset version` and similar tools bump a workspace's version together with the ranges its dependents declare on
// it. The old and the new range both link the workspace, so a frozen install accepts the edit. bun.lock records the range
// as written, and the `bun install` that follows records the new one.
describe.concurrent(
  "a workspace version bump is accepted by --frozen-lockfile and recorded by one install, with the range",
  () => {
    test.each([
      ["1.0.0", "1.0.1"],
      ["^1.0.0", "^1.0.1"],
      ["workspace:*", "workspace:^"],
    ])("%s rewritten to %s", async (before, after) => {
      const files = (libVersion: string, range: string) =>
        monorepo({ app: { version: "1.0.0", dependencies: { lib: range } }, lib: { version: libVersion } });
      const writeAll = (dir: string, tree: Record<string, PackageJson>) =>
        Promise.all(Object.entries(tree).map(([path, json]) => write(join(dir, path), JSON.stringify(json))));
      const appEntry = (lock: string) => lock.slice(lock.indexOf('"packages/app"'), lock.indexOf('"packages/lib"'));

      const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" }, files: {} });
      await writeAll(packageDir, files("1.0.0", before));
      const first = await bun(packageDir, "install");
      expect(first.stderr).toContain("Saved lockfile");
      expect(first.exitCode).toBe(0);
      expect(appEntry(await lockText(packageDir))).toContain(`"lib": "${before}"`);

      await writeAll(packageDir, files("1.0.1", after));
      const early = await bun(packageDir, "install", "--frozen-lockfile");

      expect(early.stderr).not.toContain("error:");
      expect(early.exitCode).toBe(0);

      const plain = await bun(packageDir, "install");
      const lock = await lockText(packageDir);

      expect(plain.stderr).toContain("Saved lockfile");
      expect(appEntry(lock)).toContain(`"lib": "${after}"`);
      expect(lock).toContain('"version": "1.0.1"');
      expect(plain.exitCode).toBe(0);

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      const ci = await bun(packageDir, "ci");

      expect(ci.stderr).not.toContain("error:");
      expect(ci.exitCode).toBe(0);

      const again = await bun(packageDir, "install");

      expect(again.stderr).not.toContain("Saved lockfile");
      expect(await lockText(packageDir)).toBe(lock);
      expect(again.exitCode).toBe(0);
    });
  },
);
