import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, readdirSorted } from "harness";
import { dirname, join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  root_url,
  setHandler,
} from "./dummy.registry";

// A workspace that is packaged by tools which walk `node_modules` (Electron packagers,
// serverless bundlers) needs a *complete* and *physical* node_modules of its own:
// nothing it (transitively) depends on may be hoisted above it, and the files must be
// real copies rather than links into the cache.

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
setDefaultTimeout(1000 * 60 * 5);

beforeEach(async () => {
  await dummyBeforeEach({ linker: "hoisted" });
  setHandler(
    dummyRegistry([], {
      "0.0.2": {},
      "0.0.3": {},
      "0.1.0": { dependencies: { bar: "0.0.2" } },
      latest: "0.0.3",
    }),
  );
});
afterEach(dummyAfterEach);

async function install(cwd: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  // --backend=hardlink so the "physical copy" assertions are meaningful on macOS too
  // (its default, clonefile, also yields nlink 1)
  await using proc = spawn({
    cmd: [bunExe(), "install", "--backend=hardlink", ...args],
    cwd,
    env: { ...env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

async function writeProject(desktopExtra: object, workspacesExtra: object, saveTextLockfile = true) {
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: false, registry: root_url + "/", saveTextLockfile, linker: "hoisted" },
    }),
  );
  await mkdir(join(package_dir, "apps", "desktop"), { recursive: true });
  await mkdir(join(package_dir, "apps", "web"), { recursive: true });
  await mkdir(join(package_dir, "packages", "shared"), { recursive: true });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: { packages: ["apps/*", "packages/*"], ...workspacesExtra },
      dependencies: { bar: "0.0.2" },
    }),
  );
  await writeFile(
    join(package_dir, "apps", "desktop", "package.json"),
    JSON.stringify({
      name: "desktop",
      version: "1.0.0",
      ...desktopExtra,
      dependencies: { "@barn/moo": "0.1.0", shared: "workspace:*" },
    }),
  );
  await writeFile(
    join(package_dir, "apps", "web", "package.json"),
    JSON.stringify({ name: "web", version: "1.0.0", dependencies: { bar: "0.0.2", qux: "0.0.2" } }),
  );
  await writeFile(
    join(package_dir, "packages", "shared", "package.json"),
    JSON.stringify({ name: "shared", version: "1.0.0", dependencies: { baz: "0.0.3" } }),
  );
}

describe.each([
  [
    "installConfig.hoistingLimits in the workspace's package.json",
    { installConfig: { hoistingLimits: "workspaces" } },
    {},
  ],
  ["workspaces.selfContained (by path) in the root package.json", {}, { selfContained: ["apps/desktop"] }],
  ["workspaces.selfContained (by name) in the root package.json", {}, { selfContained: ["desktop"] }],
  // an unsupported hoistingLimits value only warns; the root list still applies
  [
    "an unsupported hoistingLimits value plus the root list",
    { installConfig: { hoistingLimits: "dependencies" } },
    { selfContained: ["desktop"] },
  ],
  // yarn's default value is the same as no value; the root list still applies
  [
    'hoistingLimits "none" plus the root list',
    { installConfig: { hoistingLimits: "none" } },
    { selfContained: ["desktop"] },
  ],
] as const)("self-contained workspace via %s", (_label, desktopExtra, workspacesExtra) => {
  it("gets a complete, physical node_modules while other workspaces still hoist", async () => {
    await writeProject(desktopExtra, workspacesExtra);
    const r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    if ((desktopExtra as any).installConfig?.hoistingLimits === "dependencies") {
      // the unsupported value is reported (and otherwise ignored)
      expect(r.err).toContain('installConfig.hoistingLimits "dependencies" is not supported');
    } else {
      expect(r.err).not.toContain("hoistingLimits");
    }
    expect(r.code).toBe(0);

    const desktopNm = join(package_dir, "apps", "desktop", "node_modules");
    // desktop's direct dep, its transitive dep, the workspace it depends on and *that*
    // workspace's dep are all under apps/desktop/node_modules …
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    expect(existsSync(join(desktopNm, "@barn", "moo", "package.json"))).toBeTrue();
    expect(readlinkSync(join(desktopNm, "shared"))).toContain("shared");
    // … as real files, not hardlinks into the cache
    if (!isWindows) {
      expect(lstatSync(join(desktopNm, "bar")).isSymbolicLink()).toBeFalse();
      expect(lstatSync(join(desktopNm, "bar", "package.json")).isSymbolicLink()).toBeFalse();
      expect(statSync(join(desktopNm, "bar", "package.json")).nlink).toBe(1);
      // control: the root's copy of the same package *is* hardlinked from the cache
      expect(statSync(join(package_dir, "node_modules", "bar", "package.json")).nlink).toBeGreaterThan(1);
    }
    // even though `bar` also exists at the root for the root package / other workspaces
    expect(existsSync(join(package_dir, "node_modules", "bar", "package.json"))).toBeTrue();
    // the other workspace hoists as usual
    expect(existsSync(join(package_dir, "node_modules", "qux", "package.json"))).toBeTrue();
    expect(existsSync(join(package_dir, "apps", "web", "node_modules", "qux"))).toBeFalse();

    // stable across a repeat / frozen install …
    let again = await install(package_dir, ["--frozen-lockfile"]);
    expect(again.err).not.toContain("error:");
    expect(again.code).toBe(0);
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    // … and when installing from the existing lockfile into a clean tree (no dependency
    // changes, so nothing is re-resolved — the layout must still come out self-contained)
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(desktopNm, { recursive: true, force: true });
    again = await install(package_dir, []);
    expect(again.err).not.toContain("error:");
    expect(again.code).toBe(0);
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    if (!isWindows) {
      expect(statSync(join(desktopNm, "bar", "package.json")).nlink).toBe(1);
    }
  });
});

it("an entry that matches no workspace warns and the rest still applies", async () => {
  await writeProject({}, { selfContained: ["apps/desktop", "apps/nope"] });
  const r = await install(package_dir);
  expect(r.err).not.toContain("error:");
  expect(r.err).toContain('"apps/nope" does not match any workspace');
  expect(r.code).toBe(0);
  expect(await readdirSorted(join(package_dir, "apps", "desktop", "node_modules"))).toEqual([
    "@barn",
    "bar",
    "baz",
    "shared",
  ]);
});

// "none" is yarn's default: no hoisting limit, so nothing to warn about
it('hoistingLimits "none" hoists the workspace normally and does not warn', async () => {
  await writeProject({ installConfig: { hoistingLimits: "none" } }, {});
  const r = await install(package_dir);
  expect(r.err).not.toContain("error:");
  expect(r.err).not.toContain("hoistingLimits");
  expect(r.code).toBe(0);
  expect(existsSync(join(package_dir, "apps", "desktop", "node_modules"))).toBeFalse();
  expect(existsSync(join(package_dir, "node_modules", "@barn", "moo", "package.json"))).toBeTrue();
  expect(await Bun.file(join(package_dir, "bun.lock")).text()).not.toContain("hoistingLimits");
});

it("without either setting the workspace is hoisted normally", async () => {
  await writeProject({}, {});
  const r = await install(package_dir);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  expect(existsSync(join(package_dir, "apps", "desktop", "node_modules"))).toBeFalse();
  expect(existsSync(join(package_dir, "node_modules", "@barn", "moo", "package.json"))).toBeTrue();
  expect(existsSync(join(package_dir, "node_modules", "baz", "package.json"))).toBeTrue();
});

// The package.json of `name` that `from` resolves without leaving `root`. It walks up
// from `from` and does not resolve symlinks, the way a tool that copies `root` sees it.
function findWithin(root: string, from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return candidate;
    if (dir === root || dirname(dir) === dir) return undefined;
  }
}

// `c` is self-contained and depends on its siblings `a` and `b`, which need different
// versions of `baz`. The siblings stay symlinks, so the version that cannot hoist into
// c's node_modules goes into the sibling's own node_modules, through the symlink. The
// sibling's own tree can write the same directory. The second write used to truncate
// the hardlinks of the first, and with them the files in the cache.
describe.each([
  // baz@0.0.3 hoists to the root, so b's own tree also nests baz@0.0.5 in packages/b
  ["one nested in the sibling's own node_modules", {}],
  // b uses the root's baz@0.0.5, so only c's tree writes it into packages/b
  ["one provided by the root", { baz: "0.0.5" }],
] as const)("siblings that need two versions of a package, %s", (_label, rootDependencies) => {
  it("each resolves its own version inside the self-contained workspace, and the cache stays intact", async () => {
    setHandler(dummyRegistry([], { "0.0.3": {}, "0.0.5": {} }));
    // a cache outside node_modules, like the global one. The variable takes precedence
    // over the bunfig `cache` key, and the test runner sets it.
    const cacheDir = join(package_dir, ".bun-cache");
    const cacheEnv = { BUN_INSTALL_CACHE_DIR: cacheDir };
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: { registry: root_url + "/", saveTextLockfile: true, linker: "hoisted" },
      }),
    );
    for (const ws of ["a", "b", "c"]) {
      await mkdir(join(package_dir, "packages", ws), { recursive: true });
    }
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "root",
        private: true,
        workspaces: { packages: ["packages/*"], selfContained: ["packages/c"] },
        dependencies: rootDependencies,
      }),
    );
    await writeFile(
      join(package_dir, "packages", "a", "package.json"),
      JSON.stringify({ name: "@p/a", version: "1.0.0", dependencies: { baz: "0.0.3" } }),
    );
    await writeFile(
      join(package_dir, "packages", "b", "package.json"),
      JSON.stringify({ name: "@p/b", version: "1.0.0", dependencies: { baz: "0.0.5" } }),
    );
    await writeFile(
      join(package_dir, "packages", "c", "package.json"),
      JSON.stringify({
        name: "@p/c",
        version: "1.0.0",
        dependencies: { "@p/a": "workspace:*", "@p/b": "workspace:*" },
      }),
    );

    const r = await install(package_dir, [], cacheEnv);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);

    const versionOf = (pkgJson: string) => {
      expect(statSync(pkgJson).size).toBeGreaterThan(0);
      return JSON.parse(readFileSync(pkgJson, "utf8")).version;
    };
    const cDir = join(package_dir, "packages", "c");
    const bazFrom = (sibling: string) => {
      const found = findWithin(cDir, join(cDir, "node_modules", "@p", sibling), "baz");
      expect(found).toBeDefined();
      return versionOf(found!);
    };

    expect({ a: bazFrom("a"), b: bazFrom("b") }).toEqual({ a: "0.0.3", b: "0.0.5" });

    for (const version of ["0.0.3", "0.0.5"]) {
      const cached = (await readdirSorted(cacheDir)).filter(name => name.startsWith(`baz@${version}@`));
      expect(cached).toHaveLength(1);
      expect(versionOf(join(cacheDir, cached[0], "package.json"))).toBe(version);
      expect(statSync(join(cacheDir, cached[0], "index.js")).size).toBeGreaterThan(0);
    }

    // a repeat install has nothing to do
    const again = await install(package_dir, [], cacheEnv);
    expect(again.err).not.toContain("error:");
    expect(again.out).toContain("(no changes)");
    expect(again.code).toBe(0);
    expect({ a: bazFrom("a"), b: bazFrom("b") }).toEqual({ a: "0.0.3", b: "0.0.5" });
  });
});

// The lockfile does not record the setting. Bun 1.4.0 ignored
// `installConfig.hoistingLimits`, so a repo that upgrades keeps its lockfile, and every
// install, a frozen one too, reads the setting from the manifests.
const spellings = {
  "installConfig.hoistingLimits": [{ installConfig: { hoistingLimits: "workspaces" } }, {}],
  "workspaces.selfContained": [{}, { selfContained: ["apps/desktop"] }],
} as const;

describe.each([
  ["hoisted", "bun.lock", "installConfig.hoistingLimits"],
  ["hoisted", "bun.lock", "workspaces.selfContained"],
  ["isolated", "bun.lock", "installConfig.hoistingLimits"],
  ["hoisted", "bun.lockb", "installConfig.hoistingLimits"],
  ["hoisted", "bun.lockb", "workspaces.selfContained"],
] as const)("with the %s linker, %s, and %s", (linker, lockfileName, spelling) => {
  const [desktopExtra, workspacesExtra] = spellings[spelling];
  const text = lockfileName === "bun.lock";
  const readLockfile = () => Bun.file(join(package_dir, lockfileName)).bytes();
  const desktopNm = () => join(package_dir, "apps", "desktop", "node_modules");
  const cleanTree = async () => {
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(desktopNm(), { recursive: true, force: true });
  };
  // the isolated linker has no hoisting to limit, so only the hoisted layout differs
  const expectLayout = async (layout: "hoisted" | "self-contained") => {
    if (linker !== "hoisted") return;
    if (layout === "hoisted") {
      expect(existsSync(desktopNm())).toBeFalse();
      expect(existsSync(join(package_dir, "node_modules", "@barn", "moo", "package.json"))).toBeTrue();
    } else {
      expect(await readdirSorted(desktopNm())).toEqual(["@barn", "bar", "baz", "shared"]);
      if (!isWindows) expect(statSync(join(desktopNm(), "bar", "package.json")).nlink).toBe(1);
    }
  };

  it("the setting does not change the lockfile", async () => {
    await writeProject({}, {}, text);
    let r = await install(package_dir, [`--linker=${linker}`]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    const without = await readLockfile();

    await writeProject(desktopExtra, workspacesExtra, text);
    await cleanTree();
    r = await install(package_dir, [`--linker=${linker}`]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(await readLockfile()).toEqual(without);
    await expectLayout("self-contained");
  });

  it("a frozen install applies the manifest's setting to the same lockfile", async () => {
    // the lockfile that bun 1.4.0 writes for this project
    await writeProject({}, {}, text);
    let r = await install(package_dir, [`--linker=${linker}`]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    const lockfile = await readLockfile();

    // the manifests declare the setting (the yarn key was there all along; 1.4.0 ignored it)
    await writeProject(desktopExtra, workspacesExtra, text);
    await cleanTree();
    r = await install(package_dir, [`--linker=${linker}`, "--frozen-lockfile"]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(await readLockfile()).toEqual(lockfile);
    await expectLayout("self-contained");

    // the manifest drops the setting, and the workspace hoists again
    await writeProject({}, {}, text);
    await cleanTree();
    r = await install(package_dir, [`--linker=${linker}`, "--frozen-lockfile"]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(await readLockfile()).toEqual(lockfile);
    await expectLayout("hoisted");
  });
});

// `bun update` removes copies that an ancestor node_modules now provides. A self-contained
// workspace takes nothing from its ancestors, so its copies of the root's packages stay.
it.each(Object.keys(spellings) as (keyof typeof spellings)[])(
  "bun update keeps the packages of a workspace made self-contained by %s",
  async spelling => {
    const [desktopExtra, workspacesExtra] = spellings[spelling];
    await writeProject(desktopExtra, workspacesExtra);
    const r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    const desktopNm = join(package_dir, "apps", "desktop", "node_modules");
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);

    await using proc = spawn({
      cmd: [bunExe(), "update"],
      cwd: package_dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    expect(existsSync(join(desktopNm, "bar", "package.json"))).toBeTrue();
    expect(existsSync(join(desktopNm, "baz", "package.json"))).toBeTrue();
  },
);

it.each(Object.keys(spellings) as (keyof typeof spellings)[])(
  "bun prune keeps the packages of a workspace made self-contained by %s",
  async spelling => {
    const [desktopExtra, workspacesExtra] = spellings[spelling];
    await writeProject(desktopExtra, workspacesExtra);
    const r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    const desktopNm = join(package_dir, "apps", "desktop", "node_modules");
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);

    await using proc = spawn({
      cmd: [bunExe(), "prune"],
      cwd: package_dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(code).toBe(0);
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    expect(existsSync(join(desktopNm, "bar", "package.json"))).toBeTrue();
  },
);
