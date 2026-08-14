import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "fs";
import { readdir, rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, pack } from "harness";
import { join } from "path";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Linker = "hoisted" | "isolated";

// `--linker` in addition to bunfig: a user-level ~/.npmrc `install-strategy` would otherwise override bunfig's linker.
async function spawnInstall(dir: string, linker: Linker, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker", linker, ...args],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

async function install(dir: string, linker: Linker, ...args: string[]) {
  const result = await spawnInstall(dir, linker, ...args);
  expect(result.err).not.toContain("error:");
  expect(result.code).toBe(0);
  return result;
}

async function packageKeys(dir: string): Promise<string[]> {
  const lockfile = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
    packages: Record<string, unknown>;
  };
  return Object.keys(lockfile.packages).sort();
}

async function layout(dir: string, peerName = "no-deps"): Promise<string> {
  const path = join(dir, "packages", "lib", "node_modules", peerName);
  if (!existsSync(path)) return "<hoisted>";
  if (lstatSync(path).isSymbolicLink()) return readlinkSync(path);
  const { version } = await Bun.file(join(path, "package.json")).json();
  return `nested:${version}`;
}

function rootPackageJson(opts: {
  catalog?: Record<string, string>;
  catalogs?: Record<string, Record<string, string>>;
  rootDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}) {
  return {
    name: "root",
    workspaces: {
      packages: ["packages/*"],
      ...(opts.catalog ? { catalog: opts.catalog } : {}),
      ...(opts.catalogs ? { catalogs: opts.catalogs } : {}),
    },
    dependencies: opts.rootDependencies ?? { "one-fixed-dep": "2.0.0" },
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
  };
}

type RepoOpts = {
  peerSpec: string;
  peerName?: string;
  catalog?: Record<string, string>;
  catalogs?: Record<string, Record<string, string>>;
  rootDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  optionalPeer?: boolean;
  appDependencies?: Record<string, string>;
  extraWorkspaces?: Record<string, object>;
  libVersion?: string;
  linker: Linker;
  saveTextLockfile?: boolean;
};

async function makeRepo(opts: RepoOpts): Promise<string> {
  const peerName = opts.peerName ?? "no-deps";
  const extraFiles: Record<string, string> = {};
  for (const [name, pkg] of Object.entries(opts.extraWorkspaces ?? {})) {
    extraFiles[`packages/${name}/package.json`] = JSON.stringify({ name, ...pkg });
  }
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: opts.linker, saveTextLockfile: opts.saveTextLockfile },
    files: {
      "package.json": JSON.stringify(rootPackageJson(opts)),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        dependencies: opts.appDependencies ?? {
          "no-deps": "1.0.0",
          lib: "workspace:*",
        },
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "lib",
        ...(opts.libVersion ? { version: opts.libVersion } : {}),
        peerDependencies: {
          [peerName]: opts.peerSpec,
        },
        ...(opts.optionalPeer ? { peerDependenciesMeta: { [peerName]: { optional: true } } } : {}),
      }),
      ...extraFiles,
    },
  });
  return packageDir;
}

async function rewriteRootPackageJson(dir: string, opts: Parameters<typeof rootPackageJson>[0]) {
  await Bun.write(join(dir, "package.json"), JSON.stringify(rootPackageJson(opts)));
}

async function rmNodeModules(dir: string) {
  const workspaces = await readdir(join(dir, "packages"));
  await Promise.all(
    [join(dir, "node_modules"), ...workspaces.map(ws => join(dir, "packages", ws, "node_modules"))].map(path =>
      rm(path, { recursive: true, force: true }),
    ),
  );
}

const dedupedKeys = ["app", "lib", "no-deps", "one-fixed-dep", "one-fixed-dep/no-deps"];
const nestedKeys = ["app", "lib", "lib/no-deps", "no-deps", "one-fixed-dep", "one-fixed-dep/no-deps"];
const isolatedNoDeps = (version: string) =>
  join("..", "..", "..", "node_modules", ".bun", `no-deps@${version}`, "node_modules", "no-deps");
const isolatedNoDeps2 = isolatedNoDeps("2.0.0");
const linkers = ["hoisted", "isolated"] as const;

test.concurrent("default catalog peer dedupes onto the satisfying ancestor", async () => {
  const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker: "hoisted" });
  await install(dir, "hoisted");
  expect(await packageKeys(dir)).toEqual(dedupedKeys);
  expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
});

test.concurrent("named catalog peer (catalog:peers) dedupes the same way", async () => {
  const dir = await makeRepo({
    catalogs: { peers: { "no-deps": ">=1.0.0" } },
    peerSpec: "catalog:peers",
    linker: "hoisted",
  });
  await install(dir, "hoisted");
  expect(await packageKeys(dir)).toEqual(dedupedKeys);
  expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
});

test.concurrent("optional catalog peer dedupes too", async () => {
  const dir = await makeRepo({
    catalog: { "no-deps": ">=1.0.0" },
    peerSpec: "catalog:",
    optionalPeer: true,
    linker: "hoisted",
  });
  await install(dir, "hoisted");
  expect(await packageKeys(dir)).toEqual(dedupedKeys);
  expect(existsSync(join(dir, "packages", "lib", "node_modules", "no-deps"))).toBeFalse();
});

test.concurrent("scoped package name as a catalog peer", async () => {
  const dir = await makeRepo({
    rootDependencies: {},
    catalog: { "@scoped/has-bin-entry": ">=1.0.0" },
    peerName: "@scoped/has-bin-entry",
    peerSpec: "catalog:",
    appDependencies: { "@scoped/has-bin-entry": "1.0.0", lib: "workspace:*" },
    linker: "hoisted",
  });
  await install(dir, "hoisted");
  expect(await packageKeys(dir)).toEqual(["@scoped/has-bin-entry", "app", "lib"]);
  expect(existsSync(join(dir, "packages", "lib", "node_modules", "@scoped"))).toBeFalse();
});

async function record(dir: string, linker: Linker, peerName?: string) {
  await install(dir, linker);
  const keys = await packageKeys(dir);
  const fresh = await layout(dir, peerName);
  await rmNodeModules(dir);
  const { err } = await install(dir, linker);
  const keysAfterReload = await packageKeys(dir);
  const reload = await layout(dir, peerName);
  return { keys, fresh, keysAfterReload, reload, reloadSavedLockfile: err.includes("Saved lockfile") };
}

describe.each([
  [">=1.0.0", "dedupes"],
  ["^2.0.0", "stays nested"],
] as const)("peer range %s (%s)", (range, outcome) => {
  describe.each(linkers)("linker=%s", linker => {
    test.concurrent("catalog: peer produces the same lockfile and layout as the inline range", async () => {
      const [catalogDir, inlineDir] = await Promise.all([
        makeRepo({ catalog: { "no-deps": range }, peerSpec: "catalog:", linker }),
        makeRepo({ peerSpec: range, linker }),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);

      const expectedKeys = outcome === "dedupes" ? dedupedKeys : nestedKeys;
      expect(fromInline.keys).toEqual(expectedKeys);
      expect(fromInline.keysAfterReload).toEqual(expectedKeys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      if (linker === "isolated") {
        expect(fromInline.fresh).toEndWith(isolatedNoDeps2);
        expect(fromInline.reload).toEndWith(isolatedNoDeps2);
      } else {
        const expectedLayout = outcome === "dedupes" ? "<hoisted>" : "nested:2.0.0";
        expect(fromInline.fresh).toBe(expectedLayout);
        expect(fromInline.reload).toBe(expectedLayout);
      }

      expect(fromCatalog).toEqual(fromInline);
    });
  });
});

describe.each(linkers)("linker=%s", linker => {
  test.concurrent("catalog `*` peer behaves exactly like an inline `*` peer", async () => {
    const [catalogDir, inlineDir] = await Promise.all([
      makeRepo({ catalog: { "no-deps": "*" }, peerSpec: "catalog:", linker }),
      makeRepo({ peerSpec: "*", linker }),
    ]);
    const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
    expect(fromInline.keys).toEqual(dedupedKeys);
    expect(fromInline.keysAfterReload).toEqual(dedupedKeys);
    expect(fromInline.reloadSavedLockfile).toBeFalse();
    expect(fromCatalog).toEqual(fromInline);
  });

  test.concurrent("aliased catalog entry peer matches the inline alias", async () => {
    const [catalogDir, inlineDir] = await Promise.all([
      makeRepo({ catalog: { "no-deps": "npm:no-deps@>=1.0.0" }, peerSpec: "catalog:", linker }),
      makeRepo({ peerSpec: "npm:no-deps@>=1.0.0", linker }),
    ]);
    const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
    expect(fromInline.keysAfterReload).toEqual(fromInline.keys);
    expect(fromInline.reloadSavedLockfile).toBeFalse();
    expect(fromCatalog).toEqual(fromInline);
  });

  test.concurrent("optional catalog peer matches the inline optional peer on reload", async () => {
    const [catalogDir, inlineDir] = await Promise.all([
      makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", optionalPeer: true, linker }),
      makeRepo({ peerSpec: ">=1.0.0", optionalPeer: true, linker }),
    ]);
    const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
    expect(fromInline.keys).toEqual(dedupedKeys);
    expect(fromInline.keysAfterReload).toEqual(dedupedKeys);
    expect(fromInline.reloadSavedLockfile).toBeFalse();
    expect(fromCatalog).toEqual(fromInline);
  });

  // pnpm: deps-installer/test/catalogs.ts "importer with different peers uses correct peer"
  test.concurrent(
    "two consumers providing different peer versions: catalog peer still equals inline peer",
    async () => {
      const twoConsumers = (peerSpec: string, catalog?: Record<string, string>) =>
        makeRepo({
          peerSpec,
          catalog,
          rootDependencies: {},
          appDependencies: { "no-deps": "1.0.0", lib: "workspace:*" },
          extraWorkspaces: { app2: { dependencies: { "no-deps": "2.0.0", lib: "workspace:*" } } },
          linker,
        });
      const [catalogDir, inlineDir] = await Promise.all([
        twoConsumers("catalog:", { "no-deps": ">=1.0.0" }),
        twoConsumers(">=1.0.0"),
      ]);
      const [fromCatalog, fromInline] = await Promise.all([record(catalogDir, linker), record(inlineDir, linker)]);
      expect(fromInline.keys).toEqual(["app", "app2", "app2/no-deps", "lib", "no-deps"]);
      expect(fromInline.keysAfterReload).toEqual(fromInline.keys);
      expect(fromInline.reloadSavedLockfile).toBeFalse();
      expect(fromCatalog).toEqual(fromInline);
    },
  );

  // pnpm: deps-installer/test/catalogs.ts "catalog resolutions should be consistent with peer dependencies"
  test.concurrent("warm install leaves bun.lock byte-identical and --frozen-lockfile passes", async () => {
    const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker });
    await install(dir, linker);
    const lockfile = await Bun.file(join(dir, "bun.lock")).text();
    await rmNodeModules(dir);
    const warm = await install(dir, linker);
    expect(warm.err).not.toContain("Saved lockfile");
    expect(await Bun.file(join(dir, "bun.lock")).text()).toBe(lockfile);
    await rmNodeModules(dir);
    const frozen = await install(dir, linker, "--frozen-lockfile");
    expect(frozen.err).not.toContain("lockfile had changes");
    if (linker === "hoisted") expect(await layout(dir)).toBe("<hoisted>");
    else expect(await layout(dir)).toEndWith(isolatedNoDeps2);
  });
});

// pnpm: deps-installer/test/catalogs.ts "lockfile is updated if catalog config changes"
test.concurrent("changing the catalog range of a peer re-hoists on the next install (both directions)", async () => {
  const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker: "hoisted" });
  await install(dir, "hoisted");
  expect(await packageKeys(dir)).toEqual(dedupedKeys);

  await rewriteRootPackageJson(dir, { catalog: { "no-deps": "^2.0.0" } });
  let { err } = await install(dir, "hoisted");
  expect(err).toContain("Saved lockfile");
  expect(await packageKeys(dir)).toEqual(nestedKeys);
  expect(await layout(dir)).toBe("nested:2.0.0");

  await rewriteRootPackageJson(dir, { catalog: { "no-deps": ">=1.0.0" } });
  ({ err } = await install(dir, "hoisted"));
  expect(err).toContain("Saved lockfile");
  expect(await packageKeys(dir)).toEqual(dedupedKeys);
});

// pnpm: deps-installer/test/catalogs.ts "frozen lockfile error is thrown if catalog config changes"
test.concurrent("--frozen-lockfile fails when only a peer's catalog range changed", async () => {
  const dir = await makeRepo({ catalog: { "no-deps": ">=1.0.0" }, peerSpec: "catalog:", linker: "hoisted" });
  await install(dir, "hoisted");
  const lockfile = await Bun.file(join(dir, "bun.lock")).text();

  await rewriteRootPackageJson(dir, { catalog: { "no-deps": "^2.0.0" } });
  const { err, code } = await spawnInstall(dir, "hoisted", "--frozen-lockfile");
  expect(err).toContain("error: lockfile had changes, but lockfile is frozen");
  expect(code).not.toBe(0);
  expect(await Bun.file(join(dir, "bun.lock")).text()).toBe(lockfile);
});

test.concurrent("catalog peer with bun.lockb dedupes and reloads identically", async () => {
  const dir = await makeRepo({
    catalog: { "no-deps": ">=1.0.0" },
    peerSpec: "catalog:",
    linker: "hoisted",
    saveTextLockfile: false,
  });
  await install(dir, "hoisted");
  expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
  const lockb = await Bun.file(join(dir, "bun.lockb")).bytes();
  expect(await layout(dir)).toBe("<hoisted>");
  await rmNodeModules(dir);
  await install(dir, "hoisted");
  expect(await layout(dir)).toBe("<hoisted>");
  expect(await Bun.file(join(dir, "bun.lockb")).bytes()).toEqual(lockb);
});

// pnpm applies overrides before catalogs, keyed by the peer's own name, even when the catalog entry aliases another package.
describe.each([
  ["plain", ">=2.0.0"],
  ["aliased", "npm:a-dep@1.0.1"],
] as const)("override beats the %s catalog entry of a peer", (_, entry) => {
  test.concurrent("fresh == reload", async () => {
    const dir = await makeRepo({
      overrides: { "no-deps": "1.0.0" },
      rootDependencies: { "one-fixed-dep": "2.0.0", "a-dep": "1.0.1" },
      catalog: { "no-deps": entry },
      peerSpec: "catalog:",
      linker: "isolated",
    });
    const result = await record(dir, "isolated");
    expect(result.fresh).toEndWith(isolatedNoDeps("1.0.0"));
    const keys = ["a-dep", "app", "lib", "no-deps", "one-fixed-dep"];
    expect(result).toEqual({
      keys,
      fresh: result.fresh,
      keysAfterReload: keys,
      reload: result.fresh,
      reloadSavedLockfile: false,
    });
  });
});

// Only the entry the spec names is `^2.0.0`; a `>=1.0.0` decoy or an unresolved peer would give dedupedKeys instead (pnpm: resolveFromCatalog.test.ts).
describe.each([
  ["catalog:peers", { catalog: { "no-deps": ">=1.0.0" }, catalogs: { peers: { "no-deps": "^2.0.0" } } }],
  ["catalog:", { catalog: { "no-deps": "^2.0.0" }, catalogs: { peers: { "no-deps": ">=1.0.0" } } }],
  ["catalog:default", { catalog: { "no-deps": "^2.0.0" } }],
  ["catalog:", { catalogs: { default: { "no-deps": "^2.0.0" } } }],
  ["catalog:default", { catalogs: { default: { "no-deps": "^2.0.0" } } }],
  ["catalog:default", { catalog: { "no-deps": ">=1.0.0" }, catalogs: { default: { "no-deps": "^2.0.0" } } }],
  ["catalog:", { catalog: { "no-deps": "^2.0.0" }, catalogs: { default: { "no-deps": ">=1.0.0" } } }],
] as const)("peer %s resolves through the entry named by its spec (%o)", (peerSpec, catalogFields) => {
  test.concurrent("fresh and reload", async () => {
    const dir = await makeRepo({ ...catalogFields, peerSpec, linker: "hoisted" });
    expect(await record(dir, "hoisted")).toEqual({
      keys: nestedKeys,
      fresh: "nested:2.0.0",
      keysAfterReload: nestedKeys,
      reload: "nested:2.0.0",
      reloadSavedLockfile: false,
    });
  });
});

// pnpm errors here; Bun never fails an install over an unresolved peer, so the peer must simply not get a nested copy.
describe.each([
  ["catalog:", { catalog: {} }],
  ["catalog:peers", { catalogs: { other: { "no-deps": ">=1.0.0" } } }],
  ["catalog:default", { catalogs: { other: { "no-deps": ">=1.0.0" } } }],
  ["catalog:", { catalog: { "no-deps": "catalog:other" }, catalogs: { other: { "no-deps": ">=1.0.0" } } }],
] as const)("peer %s with no usable catalog entry (%o)", (peerSpec, catalogFields) => {
  test.concurrent("installs without a nested copy and is stable on reload", async () => {
    const dir = await makeRepo({ ...catalogFields, peerSpec, linker: "hoisted" });
    expect(await record(dir, "hoisted")).toEqual({
      keys: dedupedKeys,
      fresh: "<hoisted>",
      keysAfterReload: dedupedKeys,
      reload: "<hoisted>",
      reloadSavedLockfile: false,
    });
  });
});

// pnpm #12159 shape: an override whose value is a catalog reference wins over the peer's own range, fresh and on reload.
describe.each(linkers)("linker=%s", linker => {
  describe.each([
    [">=1.0.0", "catalog:", { catalog: { "no-deps": "1.0.0" } }],
    ["^2.0.0", "catalog:", { catalog: { "no-deps": "1.0.0" } }],
    ["catalog:", "catalog:", { catalog: { "no-deps": "1.0.0" } }],
    ["catalog:", "catalog:pins", { catalog: { "no-deps": ">=1.0.0" }, catalogs: { pins: { "no-deps": "1.0.0" } } }],
  ] as const)("peer %s overridden to %s", (peerSpec, override, catalogFields) => {
    test.concurrent("binds to the overriding catalog entry, fresh == reload", async () => {
      const dir = await makeRepo({ ...catalogFields, overrides: { "no-deps": override }, peerSpec, linker });
      const result = await record(dir, linker);
      const keys = ["app", "lib", "no-deps", "one-fixed-dep"];
      expect(result).toEqual({
        keys,
        fresh: linker === "isolated" ? expect.stringContaining(isolatedNoDeps("1.0.0")) : "<hoisted>",
        keysAfterReload: keys,
        reload: result.fresh,
        reloadSavedLockfile: false,
      });
      const { packages } = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
        packages: Record<string, [string, ...unknown[]]>;
      };
      expect(packages["no-deps"][0]).toBe("no-deps@1.0.0");
    });
  });
});

// pnpm #8996 (`catalog:` peers survive `pack` unsubstituted) and #7072 (`catalog:` / `catalog:default` are one catalog).
describe.each([
  ["catalog:", { catalog: { "no-deps": ">=1.0.0" } }],
  ["catalog:peers", { catalogs: { peers: { "no-deps": ">=1.0.0" } } }],
  ["catalog:", { catalogs: { default: { "no-deps": ">=1.0.0" } } }],
  ["catalog:default", { catalog: { "no-deps": ">=1.0.0" } }],
] as const)("bun pm pack substitutes the %s peer (%o)", (peerSpec, catalogFields) => {
  test.concurrent("with the catalog's range", async () => {
    const dir = await makeRepo({ ...catalogFields, peerSpec, libVersion: "1.2.3", linker: "hoisted" });
    await install(dir, "hoisted");
    const libDir = join(dir, "packages", "lib");
    await pack(libDir, bunEnv);
    const tarball = readTarball(join(libDir, "lib-1.2.3.tgz"));
    const packageJson = tarball.entries.find(
      (entry: { pathname: string }) => entry.pathname === "package/package.json",
    );
    expect(JSON.parse(packageJson.contents)).toEqual({
      name: "lib",
      version: "1.2.3",
      peerDependencies: { "no-deps": ">=1.0.0" },
    });
  });
});
