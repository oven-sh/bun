// `--frozen-lockfile` / `bun ci` on a checkout whose package.json was edited after bun.lock was
// written, in ways that leave every package resolved exactly as locked. A plain `bun install`
// rewrites bun.lock for these edits, so a frozen install has to fail on them, and it has to keep
// passing on the edits a plain install does not record.
import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type PackageJson = Record<string, any>;

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
  dependencies: { "a-dep": "1.0.1", "no-deps": "^1.0.0" },
  trustedDependencies: ["a-dep"],
  patchedDependencies: { "a-dep@1.0.1": "patches/a-dep@1.0.1.patch" },
};
const member: PackageJson = {
  name: "member",
  version: "1.0.0",
  scripts: { postinstall: "echo postinstall" },
  dependencies: { "a-dep": "1.0.1" },
};

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

// A project installed once from `rootJson` / `memberJson`, returning its dir and the bun.lock that install wrote.
// A `rootJson` without "workspaces" gets no workspace folders.
async function installed(rootJson: PackageJson = root, memberJson: PackageJson = member) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: {
      "package.json": JSON.stringify(rootJson),
      ...(rootJson.workspaces && {
        "packages/member/package.json": JSON.stringify(memberJson),
        "packages/shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0" }),
      }),
      "patches/a-dep@1.0.1.patch": patch,
      "patches/no-deps@1.1.0.patch": patch,
    },
  });
  const { stderr, exitCode } = await bun(packageDir, "install");
  expect(stderr).toContain("Saved lockfile");
  expect(exitCode).toBe(0);
  return { packageDir, lock: await file(join(packageDir, "bun.lock")).text() };
}

const writeRoot = (dir: string, json: PackageJson) => write(join(dir, "package.json"), JSON.stringify(json));
const writeMember = (dir: string, json: PackageJson) =>
  write(join(dir, "packages", "member", "package.json"), JSON.stringify(json));
const lockText = (dir: string) => file(join(dir, "bun.lock")).text();

const frozenError = "error: lockfile had changes, but lockfile is frozen";
const sectionNote = (section: string, packageJson = "package.json") =>
  `note: ${section} in ${packageJson} changed since bun.lock was saved`;

type Edit = {
  section: "dependencies" | "trustedDependencies" | "patchedDependencies";
  /** The root package.json the project is installed from, `root` by default. */
  from?: PackageJson;
  root?: (json: PackageJson) => PackageJson;
  member?: (json: PackageJson) => PackageJson;
};

const without = (json: PackageJson, key: string) => {
  const { [key]: _, ...rest } = json;
  return rest;
};

const singlePackage = without(root, "workspaces");
// one-dep@1.0.0 depends on no-deps@1.0.1, so no-deps is in the tree without the root listing it.
const transitive: PackageJson = { name: "root", version: "1.0.0", dependencies: { "one-dep": "1.0.0" } };

// Each edit keeps every package at its locked version; the next plain `bun install` rewrites bun.lock for all of them.
const rewrittenByInstall: Record<string, Edit> = {
  "a dependency's range is loosened but still satisfied by the locked version": {
    section: "dependencies",
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": ">=1.0.0" } }),
  },
  "a dependency's range is raised to the locked version": {
    section: "dependencies",
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "^1.1.0" } }),
  },
  "a dependency's range is pinned to the locked version": {
    section: "dependencies",
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "1.1.0" } }),
  },
  "a dependency is added that the lockfile already resolves transitively": {
    section: "dependencies",
    from: transitive,
    root: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "1.0.1" } }),
  },
  "a dependency that stays in the tree transitively is removed": {
    section: "dependencies",
    from: { ...transitive, dependencies: { ...transitive.dependencies, "no-deps": "1.0.1" } },
    root: json => ({ ...json, dependencies: without(json.dependencies, "no-deps") }),
  },
  "a dependency moves from dependencies to devDependencies": {
    section: "dependencies",
    root: json => ({
      ...json,
      dependencies: without(json.dependencies, "no-deps"),
      devDependencies: { "no-deps": "^1.0.0" },
    }),
  },
  "a workspace adds a dependency that the lockfile already resolves for another workspace": {
    section: "dependencies",
    member: json => ({ ...json, dependencies: { ...json.dependencies, "no-deps": "^1.0.0" } }),
  },
  "a patchedDependencies entry is added for a locked package": {
    section: "patchedDependencies",
    root: json => ({
      ...json,
      patchedDependencies: { ...json.patchedDependencies, "no-deps@1.1.0": "patches/no-deps@1.1.0.patch" },
    }),
  },
  "a patchedDependencies entry is removed": {
    section: "patchedDependencies",
    root: json => without(json, "patchedDependencies"),
  },
  "a locked package is added to trustedDependencies": {
    section: "trustedDependencies",
    root: json => ({ ...json, trustedDependencies: ["a-dep", "no-deps"] }),
  },
  // Removals only count without workspaces: bun.lock records the union of every workspace's list, see below.
  "trustedDependencies is emptied": {
    section: "trustedDependencies",
    from: singlePackage,
    root: json => ({ ...json, trustedDependencies: [] }),
  },
  "trustedDependencies is removed": {
    section: "trustedDependencies",
    from: singlePackage,
    root: json => without(json, "trustedDependencies"),
  },
};

describe.concurrent("--frozen-lockfile fails on a package.json edit that bun install writes to bun.lock", () => {
  test.each(Object.entries(rewrittenByInstall))("%s", async (_name, edit) => {
    const from = edit.from ?? root;
    const { packageDir, lock } = await installed(from);
    if (edit.root) await writeRoot(packageDir, edit.root(from));
    if (edit.member) await writeMember(packageDir, edit.member(member));

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).toContain(frozenError);
    expect(frozen.stderr).toContain(
      sectionNote(edit.section, edit.member ? "packages/member/package.json" : "package.json"),
    );
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(1);

    // What the failure protects: the lockfile a plain install leaves behind differs.
    const plain = await bun(packageDir, "install");

    expect(plain.stderr).toContain("Saved lockfile");
    expect(await lockText(packageDir)).not.toBe(lock);
    expect(plain.exitCode).toBe(0);

    const after = await bun(packageDir, "install", "--frozen-lockfile");

    expect(after.stderr).not.toContain("error:");
    expect(after.exitCode).toBe(0);
  });

  test("prints which section changed, also as bun ci", async () => {
    const unpatched = without(root, "patchedDependencies");
    const { packageDir, lock } = await installed(unpatched);
    await writeRoot(packageDir, { ...unpatched, dependencies: { ...unpatched.dependencies, "no-deps": ">=1.0.0" } });

    const { stdout, stderr, exitCode } = await bun(packageDir, "install", "--frozen-lockfile");

    expect(normalizeBunSnapshot(stderr, packageDir)).toMatchInlineSnapshot(`
      "error: lockfile had changes, but lockfile is frozen
      note: dependencies in package.json changed since bun.lock was saved
      note: try re-running without --frozen-lockfile and commit the updated lockfile"
    `);
    expect(normalizeBunSnapshot(stdout, packageDir)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);

    const ci = await bun(packageDir, "ci");

    expect(ci.stderr).toContain(frozenError);
    expect(await lockText(packageDir)).toBe(lock);
    expect(ci.exitCode).toBe(1);
  });
});

// Names bun.lock does not list because they are not in the tree. The differ reports them as added on every install, so
// adding them to a fixture guarantees the comparison runs even when nothing recorded changed.
const staleTrustedDependencies = ["a-dep", "not-installed", "esbuild", "sharp", "@prisma/client", "core-js", "bcrypt"];

// Edits for which a plain `bun install` leaves bun.lock byte for byte as it is.
const notRecorded: Record<string, Pick<Edit, "root" | "member">> = {
  "a trustedDependencies name that is not in the tree": {
    root: json => ({ ...json, trustedDependencies: ["a-dep", "not-installed"] }),
  },
  "several trustedDependencies names that are not in the tree": {
    root: json => ({ ...json, trustedDependencies: staleTrustedDependencies }),
  },
  "a workspace's lifecycle script": {
    root: json => ({ ...json, trustedDependencies: staleTrustedDependencies }),
    member: json => ({ ...json, scripts: { postinstall: "echo changed" } }),
  },
  "package.json key order and formatting": {
    root: json => ({
      trustedDependencies: staleTrustedDependencies,
      ...without(json, "trustedDependencies"),
      dependencies: { "no-deps": "^1.0.0", "a-dep": "1.0.1" },
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

describe.concurrent("--frozen-lockfile still passes", () => {
  test.each(Object.entries(notRecorded))("%s", async (_name, edit) => {
    const { packageDir, lock } = await installed();
    if (edit.root) await writeRoot(packageDir, edit.root(root));
    if (edit.member) await writeMember(packageDir, edit.member(member));

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(0);

    const plain = await bun(packageDir, "install");

    expect(plain.stderr).not.toContain("Saved lockfile");
    expect(await lockText(packageDir)).toBe(lock);
    expect(plain.exitCode).toBe(0);
  });

  // The next four are edits a plain install does write to bun.lock, accepted on purpose.

  // bun.lock records workspace versions, but release tooling bumps them without an install (pnpm and yarn accept this
  // too), also when the differ reports something else on the same run.
  test("a workspace's version", async () => {
    const { packageDir, lock } = await installed();
    await writeMember(packageDir, { ...member, version: "1.0.1" });
    await writeRoot(packageDir, { ...root, trustedDependencies: staleTrustedDependencies });

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(0);
  });

  // bun.lock records one trustedDependencies list for all workspaces, so a checkout with a workspace left out (a Docker
  // context, `turbo prune`) declares fewer names than bun.lock lists. A removal therefore only counts without workspaces.
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

  test("a trustedDependencies name removed in a workspace project", async () => {
    const { packageDir, lock } = await installed();
    await writeRoot(packageDir, { ...root, trustedDependencies: [] });

    const frozen = await bun(packageDir, "install", "--frozen-lockfile");

    expect(frozen.stderr).not.toContain("error:");
    expect(await lockText(packageDir)).toBe(lock);
    expect(frozen.exitCode).toBe(0);
  });

  // `turbo prune` releases have dropped either section from bun.lock while copying the root package.json that declares
  // it (vercel/turborepo#11027, vercel/turborepo#13740), so a list bun.lock never recorded is not compared.
  describe.each(["trustedDependencies", "patchedDependencies"])("a %s list that bun.lock never recorded", section => {
    test.each([root, singlePackage])("%#", async base => {
      const { packageDir, lock } = await installed(without(base, section));
      expect(lock).not.toContain(section);
      // The stale names make the differ report a change in the patchedDependencies case too.
      await writeRoot(packageDir, { ...base, trustedDependencies: staleTrustedDependencies });

      const frozen = await bun(packageDir, "install", "--frozen-lockfile");

      expect(frozen.stderr).not.toContain("error:");
      expect(await lockText(packageDir)).toBe(lock);
      expect(frozen.exitCode).toBe(0);
    });
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

  // An older bun, another tool or a CRLF checkout formats bun.lock differently; only what it records is compared.
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
});

// Ways workspaces reach each other that bun.lock reloads through its own rules. The comparison sees the reloaded
// lockfile on one side and the reparsed package.json files on the other, so each has to come out the same. The stale
// trustedDependencies name makes the comparison run.
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
  "a $name override": {
    "package.json": {
      name: "root",
      dependencies: { "no-deps": "^1.0.0", "a-dep": "1.0.1" },
      overrides: { "a-dep": "$no-deps" },
      trustedDependencies: ["not-installed"],
    },
  },
};

describe.concurrent("--frozen-lockfile still passes on an unchanged project with", () => {
  test.each(Object.entries(unchangedProjects))("%s", async (_name, files) => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
    });
    const first = await bun(packageDir, "install");
    expect(first.stderr).toContain("Saved lockfile");
    expect(first.exitCode).toBe(0);
    const lock = await lockText(packageDir);

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
    expect(await lockText(packageDir)).toBe(lock);
    expect(plain.exitCode).toBe(0);
  });
});
