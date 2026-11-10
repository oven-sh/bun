import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { chmod, mkdir, readlink, rm, symlink } from "fs/promises";
import {
  bunEnv,
  bunExe,
  githubTarball,
  isLinux,
  isWindows,
  pack,
  readdirSorted,
  runBunInstall,
  tempDir,
  toBeValidBin,
  toHaveBins,
} from "harness";
import { createRequire } from "module";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { installEnv, TestRegistry } from "registry";
import { pathToFileURL } from "url";
import { SimpleRegistry } from "./simple-dummy-registry";

expect.extend({ toBeValidBin, toHaveBins });

const registry = new TestRegistry();

// With the global virtual store enabled, dependency symlinks inside a store
// entry point at sibling global-store directories whose names carry a 16-hex
// content-hash suffix (`<name>@<ver>-<hash>/...`). The hash is deterministic
// for a given dependency closure but would make these layout assertions
// brittle, so strip it before comparing.
function withoutEntryHash(link: string): string {
  return link.replace(/(-[0-9a-f]{16})(?=[\\/])/, "");
}

// Extract just the `<storepath>-<hash>` segment from a global-store link
// target. Tests that compare entries across two test dirs need this because
// each `createTestDir` gets its own `.bun-cache/` (so the absolute targets
// always differ) but the hash suffix is what proves sharing/isolation.
function entryStoreName(link: string): string {
  return link.slice(link.lastIndexOf("links") + "links".length + 1);
}

// What a store entry name carries in place of its URL's userinfo and query
// string (see "store entry names of URL dependencies").
function urlHash(url: string): string {
  return Bun.hash(url).toString(16).padStart(16, "0");
}

// Every copy of `name` in the tree bun.lock saves, keyed by the node_modules
// path it is written at, e.g. `{ "no-deps": "no-deps@1.0.1", "nd11": "no-deps@1.1.0" }`.
// The peer tests below depend on the shape of this tree, not just on which
// versions were resolved, so they assert it before looking at the store.
async function savedTreeCopiesOf(packageDir: string, name: string): Promise<Record<string, string>> {
  const { packages } = Bun.JSONC.parse(await file(join(packageDir, "bun.lock")).text()) as {
    packages: Record<string, [string, ...unknown[]]>;
  };
  return Object.fromEntries(
    Object.entries(packages)
      .filter(([, [resolution]]) => resolution.startsWith(`${name}@`))
      .map(([path, [resolution]]) => [path, resolution]),
  );
}

// `<name>@<resolution>`, with the resolution cut and hashed past MAX_RESOLUTION_LEN (see "long store entry names").
const MAX_RESOLUTION_LEN = 80;
const CUT_RESOLUTION_LEN = MAX_RESOLUTION_LEN - "+".length - 16;
function storeEntryName(name: string, resolution: string): string {
  if (resolution.length <= MAX_RESOLUTION_LEN) return `${name}@${resolution}`;
  return `${name}@${resolution.slice(0, CUT_RESOLUTION_LEN)}+${urlHash(resolution)}`;
}

// Returns what comes after the path or URL in the store entry name of a `file:` or URL tarball: the start of the sha512
// that bun.lock pins. `path` is relative to this directory.
function tarballPin(...path: string[]): string {
  const sha512 = new Bun.CryptoHasher("sha512").update(readFileSync(join(import.meta.dir, ...path))).digest("hex");
  return `+${sha512.slice(0, 16)}`;
}
const noDepsPin = (version: string) => tarballPin("registry", "packages", "no-deps", `no-deps-${version}.tgz`);

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe.concurrent("basic", () => {
  test("single dependency", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-1",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("scope package", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-2",
        dependencies: {
          "@types/is-number": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(readlinkSync(join(packageDir, "node_modules", "@types", "is-number"))).toBe(
      join("..", ".bun", "@types+is-number@1.0.0", "node_modules", "@types", "is-number"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "@types", "is-number"))).toBe(
      join("..", "..", "@types+is-number@1.0.0", "node_modules", "@types", "is-number"),
    );
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@types+is-number@1.0.0",
          "node_modules",
          "@types",
          "is-number",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@types/is-number",
      version: "1.0.0",
    });
  });

  test("transitive dependencies", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-3",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "two-range-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "two-range-deps"))).toBe(
      join("..", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.1.0", "node_modules", "no-deps"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "@types", "is-number"))).toBe(
      join("..", "..", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"),
    );
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "two-range-deps@1.0.0",
          "node_modules",
          "two-range-deps",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "two-range-deps",
      version: "1.0.0",
      dependencies: {
        "no-deps": "^1.0.0",
        "@types/is-number": ">=1.0.0",
      },
    });
    expect(
      await readdirSorted(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules")),
    ).toEqual(["@types", "no-deps", "two-range-deps"]);
    expect(
      withoutEntryHash(
        readlinkSync(
          join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "@types", "is-number"),
        ),
      ),
    ).toBe(join("..", "..", "..", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"));
    expect(
      withoutEntryHash(
        readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps")),
      ),
    ).toBe(join("..", "..", "no-deps@1.1.0", "node_modules", "no-deps"));
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.1.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.1.0",
    });
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@types+is-number@2.0.0",
          "node_modules",
          "@types",
          "is-number",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@types/is-number",
      version: "2.0.0",
    });
  });
});

test.concurrent("handles cyclic dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-cyclic",
      dependencies: {
        "a-dep-b": "1.0.0",
      },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(readlinkSync(join(packageDir, "node_modules", "a-dep-b"))).toBe(
    join(".bun", "a-dep-b@1.0.0", "node_modules", "a-dep-b"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "a-dep-b"))).toBe(
    join("..", "a-dep-b@1.0.0", "node_modules", "a-dep-b"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "b-dep-a"))).toBe(
    join("..", "b-dep-a@1.0.0", "node_modules", "b-dep-a"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "a-dep-b", "package.json"),
    ).json(),
  ).toEqual({
    name: "a-dep-b",
    version: "1.0.0",
    dependencies: {
      "b-dep-a": "1.0.0",
    },
  });

  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "b-dep-a")),
    ),
  ).toBe(join("..", "..", "b-dep-a@1.0.0", "node_modules", "b-dep-a"));
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "a-dep-b@1.0.0", "node_modules", "b-dep-a", "package.json"),
    ).json(),
  ).toEqual({
    name: "b-dep-a",
    version: "1.0.0",
    dependencies: {
      "a-dep-b": "1.0.0",
    },
  });
});

test.concurrent("a package reached through a dependency cycle dedupes into one store entry", async () => {
  // Two workspaces with different dependency sets both pull in the
  // `dedupe-cycle-a` <-> `dedupe-cycle-b` cycle. `dedupe-cycle-peer` leaks a
  // peer (`no-deps`) that no ancestor provides, so the store builder cannot
  // resolve it from either workspace's chain. The unresolved name is part of
  // the early-dedupe key, so both positions must collapse into a single
  // store entry per package. The tree builder used to skip early dedupe at
  // every position with an unresolved leaking peer, which duplicated the
  // `dedupe-cycle-a` entry (identical contents under two store names) and
  // made `bun install` re-expand the shared subtree once per workspace
  // (#40445).
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "dedupe-cycle-ws",
        workspaces: {
          packages: ["ws-one", "ws-two"],
        },
      }),
    ),
    write(
      join(packageDir, "ws-one", "package.json"),
      JSON.stringify({
        name: "ws-one",
        version: "1.0.0",
        dependencies: {
          "dedupe-cycle-a": "1.0.0",
        },
      }),
    ),
    write(
      join(packageDir, "ws-two", "package.json"),
      JSON.stringify({
        name: "ws-two",
        version: "1.0.0",
        dependencies: {
          "dedupe-cycle-b": "1.0.0",
        },
      }),
    ),
  ]);

  await runBunInstall(installEnv(packageDir), packageDir);

  const storeEntries = await readdirSorted(join(packageDir, "node_modules", ".bun"));
  const aEntries = storeEntries.filter(e => e.startsWith("dedupe-cycle-a@1.0.0"));
  const bEntries = storeEntries.filter(e => e.startsWith("dedupe-cycle-b@1.0.0"));
  const peerEntries = storeEntries.filter(e => e.startsWith("dedupe-cycle-peer@1.0.0"));
  expect(aEntries).toHaveLength(1);
  expect(bEntries).toHaveLength(1);
  expect(peerEntries).toHaveLength(1);

  const bunDir = join(packageDir, "node_modules", ".bun");

  // both sides of the cycle link to the single entry of the other side
  expect(withoutEntryHash(readlinkSync(join(bunDir, aEntries[0], "node_modules", "dedupe-cycle-b")))).toBe(
    join("..", "..", bEntries[0], "node_modules", "dedupe-cycle-b"),
  );
  expect(withoutEntryHash(readlinkSync(join(bunDir, bEntries[0], "node_modules", "dedupe-cycle-a")))).toBe(
    join("..", "..", aEntries[0], "node_modules", "dedupe-cycle-a"),
  );

  // the unprovided peer auto-installs the same no-deps version for both
  // workspaces
  expect(await file(join(bunDir, peerEntries[0], "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });

  // both workspaces resolve their entry point of the cycle
  expect(await file(join(packageDir, "ws-one", "node_modules", "dedupe-cycle-a", "package.json")).json()).toMatchObject(
    {
      name: "dedupe-cycle-a",
      version: "1.0.0",
    },
  );
  expect(await file(join(packageDir, "ws-two", "node_modules", "dedupe-cycle-b", "package.json")).json()).toMatchObject(
    {
      name: "dedupe-cycle-b",
      version: "1.0.0",
    },
  );
});

// `pa` and `pb` are peers of each other. The walk that resolves pb's peer passes the pa that brought pb
// in, which is not a peer of itself.
test.concurrent.each([
  ["two dependencies", { "package.json": { name: "app", dependencies: { y: "1.0.0", z: "1.0.0" } } }],
  [
    "two workspaces",
    {
      "package.json": { name: "app", workspaces: ["packages/*"] },
      "packages/a/package.json": { name: "wa", dependencies: { pa: "1.0.0" } },
      "packages/b/package.json": { name: "wb", dependencies: { pb: "1.0.0" } },
    },
  ],
])("packages that peer each other are installed once when %s bring them in", async (_, files) => {
  const packages: Record<string, object> = {
    pa: { peerDependencies: { pb: "*" } },
    pb: { peerDependencies: { pa: "*" } },
    y: { dependencies: { pa: "1.0.0" } },
    z: { dependencies: { pb: "1.0.0" } },
  };
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { origin, pathname } = new URL(req.url);
      const name = pathname.slice(1).replace(/-1\.0\.0\.tgz$/, "");
      const manifest = { name, version: "1.0.0", ...packages[name] };
      if (pathname.endsWith(".tgz")) {
        const archive = new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" });
        return new Response(await archive.bytes());
      }
      const versions = { "1.0.0": { ...manifest, dist: { tarball: `${origin}/${name}-1.0.0.tgz` } } };
      return Response.json({ name, "dist-tags": { latest: "1.0.0" }, versions });
    },
  });
  using dir = tempDir("isolated-peer-cycle", {
    ...Object.fromEntries(Object.entries(files).map(([path, json]) => [path, JSON.stringify(json)])),
    "bunfig.toml": `[install]\nlinker = "isolated"\ncache = "./.bun-cache"\nregistry = "${server.url.href}"\n`,
  });

  await runBunInstall({ ...bunEnv, BUN_INSTALL_CACHE_DIR: undefined }, String(dir));

  const entries = await readdirSorted(join(String(dir), "node_modules", ".bun"));
  expect(entries.filter(entry => /^p[ab]@/.test(entry))).toEqual([
    expect.stringMatching(/^pa@1\.0\.0\+[0-9a-f]{16}$/),
    expect.stringMatching(/^pb@1\.0\.0\+[0-9a-f]{16}$/),
  ]);
});

test.concurrent("early dedupe keeps declarer-specific resolutions of an unprovided peer", async () => {
  // `dedupe-divergent-peers` pulls in two declarers of the peer name
  // `no-deps` with divergent ranges: `dedupe-cycle-peer` wants 1.0.0 and
  // `dedupe-divergent-strict` wants ^2.0.0. Neither workspace chain provides
  // `no-deps`, so the shared subtree dedupes on the unresolved name and each
  // declarer must still auto-install its own best version. `ws-three` seeds
  // both no-deps versions into the lockfile under aliases (a different
  // dependency name, so they provide nothing to the peer).
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "dedupe-divergent-ws",
        workspaces: {
          packages: ["ws-one", "ws-two", "ws-three"],
        },
      }),
    ),
    write(
      join(packageDir, "ws-one", "package.json"),
      JSON.stringify({
        name: "ws-one",
        version: "1.0.0",
        dependencies: {
          "dedupe-divergent-peers": "1.0.0",
        },
      }),
    ),
    write(
      join(packageDir, "ws-two", "package.json"),
      JSON.stringify({
        name: "ws-two",
        version: "1.0.0",
        dependencies: {
          "dedupe-divergent-peers": "1.0.0",
          "a-dep": "1.0.1",
        },
      }),
    ),
    write(
      join(packageDir, "ws-three", "package.json"),
      JSON.stringify({
        name: "ws-three",
        version: "1.0.0",
        dependencies: {
          "aliased-no-deps-1": "npm:no-deps@1.0.0",
          "aliased-no-deps-2": "npm:no-deps@2.0.0",
        },
      }),
    ),
  ]);

  await runBunInstall(installEnv(packageDir), packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const storeEntries = await readdirSorted(bunDir);
  expect(storeEntries.filter(e => e.startsWith("dedupe-divergent-peers@1.0.0"))).toHaveLength(1);
  const peerEntries = storeEntries.filter(e => e.startsWith("dedupe-cycle-peer@1.0.0"));
  const strictEntries = storeEntries.filter(e => e.startsWith("dedupe-divergent-strict@1.0.0"));
  expect(peerEntries).toHaveLength(1);
  expect(strictEntries).toHaveLength(1);

  // each declarer auto-installs its own best version of the unprovided peer
  expect(await file(join(bunDir, peerEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    name: "no-deps",
    version: "1.0.0",
  });
  expect(await file(join(bunDir, strictEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    name: "no-deps",
    version: "2.0.0",
  });

  // both workspaces resolve the shared package
  for (const ws of ["ws-one", "ws-two"]) {
    expect(
      await file(join(packageDir, ws, "node_modules", "dedupe-divergent-peers", "package.json")).json(),
    ).toMatchObject({
      name: "dedupe-divergent-peers",
      version: "1.0.0",
    });
  }
});

test.concurrent("package with dependency on previous self works", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-transitive-self-dep",
      dependencies: {
        "self-dep": "1.0.2",
      },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(
    await Promise.all([
      file(join(packageDir, "node_modules", "self-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "self-dep", "node_modules", "self-dep", "package.json")).json(),
    ]),
  ).toEqual([
    {
      name: "self-dep",
      version: "1.0.2",
      dependencies: {
        "self-dep": "1.0.1",
      },
    },
    {
      name: "self-dep",
      version: "1.0.1",
    },
  ]);
});

test.concurrent("can install folder dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-folder-deps",
      dependencies: {
        "folder-dep": "file:./pkg-1",
      },
    }),
  );

  await write(join(packageDir, "pkg-1", "package.json"), JSON.stringify({ name: "folder-dep", version: "1.0.0" }));

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep", "package.json"),
    ).json(),
  ).toEqual({
    name: "folder-dep",
    version: "1.0.0",
  });

  await write(join(packageDir, "pkg-1", "index.js"), "module.exports = 'hello from pkg-1';");

  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep", "index.js"),
    ).text(),
  ).toBe("module.exports = 'hello from pkg-1';");
});

test.concurrent.skipIf(isWindows)("a backslash in the name of a file or a directory of a package is kept", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await Promise.all([
    write(packageJson, JSON.stringify({ name: "test-pkg-backslash", dependencies: { "folder-dep": "file:./pkg-1" } })),
    write(join(packageDir, "pkg-1", "package.json"), JSON.stringify({ name: "folder-dep", version: "1.0.0" })),
    write(join(packageDir, "pkg-1", "lib", "index.js"), "slash"),
    write(join(packageDir, "pkg-1", "lib\\index.js"), "backslash"),
    write(join(packageDir, "pkg-1", "a\\b", "c.js"), "c"),
  ]);

  await runBunInstall(installEnv(packageDir), packageDir);

  const installed = join(packageDir, "node_modules", "folder-dep");
  expect(readdirSync(installed, { recursive: true }).sort()).toEqual([
    "a\\b",
    "a\\b/c.js",
    "lib",
    "lib/index.js",
    "lib\\index.js",
    "package.json",
  ]);
  expect(readFileSync(join(installed, "lib", "index.js"), "utf8")).toBe("slash");
  expect(readFileSync(join(installed, "lib\\index.js"), "utf8")).toBe("backslash");
});

test.concurrent("a folder dependency without a package.json name is stored under its folder name", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-nameless-folder-dep",
        dependencies: {
          "folder-dep": "file:./pkg-1",
        },
      }),
    ),
    write(join(packageDir, "pkg-1", "package.json"), JSON.stringify({ version: "1.0.0" })),
    write(join(packageDir, "pkg-1", "index.js"), "module.exports = 'hello from pkg-1';"),
  ]);

  await runBunInstall(installEnv(packageDir), packageDir);

  // Without a name the store entry used to be ".bun/@file+pkg-1/node_modules" with the package's
  // files spilled directly into that node_modules directory.
  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "pkg-1@file+pkg-1", "node_modules", "pkg-1"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "pkg-1@file+pkg-1", "node_modules", "pkg-1", "package.json"),
    ).json(),
  ).toEqual({ version: "1.0.0" });

  await using proc = spawn({
    cmd: [bunExe(), "-e", "console.log(require('folder-dep'))"],
    cwd: packageDir,
    env: installEnv(packageDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("hello from pkg-1\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // The entry bun wrote loads again (runBunInstall fails on "warn: Ignoring lockfile").
  expect(await file(join(packageDir, "bun.lock")).text()).toContain('"folder-dep": ["pkg-1@file:pkg-1", {}]');
  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
});

test.concurrent("can install folder dependencies on root package", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "root-file-dep",
        workspaces: ["packages/*"],
        dependencies: {
          self: "file:.",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          root: "file:../..",
        },
      }),
    ),
  ]);

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(
    await Promise.all([
      readlink(join(packageDir, "node_modules", "self")),
      readlink(join(packageDir, "packages", "pkg1", "node_modules", "root")),
      file(join(packageDir, "node_modules", "self", "package.json")).json(),
    ]),
  ).toEqual(["..", join("..", "..", ".."), await file(packageJson).json()]);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual([]);
});

// Only what was removed from package.json is unlinked. What `--omit` skips is kept, and so is a link that Bun didn't
// create.
test.concurrent.each(["install", "install --omit=dev"])(
  "dependencies that left package.json are unlinked from node_modules: bun %s",
  async command => {
    const kept = { name: "dropped", dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } };
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          ...kept,
          dependencies: {
            ...kept.dependencies,
            "one-dep": "1.0.0",
            "what-bin": "1.0.0",
            "@scoped/has-bin-entry": "1.0.0",
          },
        }),
        "mine/package.json": JSON.stringify({ name: "mine", version: "1.0.0" }),
      },
    });
    const nodeModules = join(packageDir, "node_modules");
    await runBunInstall(installEnv(packageDir), packageDir);
    symlinkSync(join(packageDir, "mine"), join(nodeModules, "mine"), "junction");
    expect(await readdirSorted(join(nodeModules, ".bin"))).toHaveBins(["has-bin-entry", "what-bin"]);

    await write(packageJson, JSON.stringify(kept));
    await using proc = spawn({
      cmd: [bunExe(), ...command.split(" ")],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("3 packages removed");
    expect(await readdirSorted(nodeModules)).toEqual([".bin", ".bun", "a-dep", "mine", "no-deps"]);
    expect(await readdirSorted(join(nodeModules, ".bun", "node_modules"))).toEqual(["a-dep", "no-deps"]);
    expect(await readdirSorted(join(nodeModules, ".bin"))).toEqual([]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "a dependency that a workspace drops is unlinked there and kept where another workspace uses it",
  async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "dropped-by-a-workspace", workspaces: ["packages/*"] }),
        "packages/a/package.json": JSON.stringify({
          name: "a",
          version: "1.0.0",
          dependencies: { b: "workspace:*", "no-deps": "1.0.1", "what-bin": "1.0.0" },
        }),
        "packages/b/package.json": JSON.stringify({
          name: "b",
          version: "1.0.0",
          dependencies: { "no-deps": "1.0.1" },
        }),
      },
    });
    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await readdirSorted(join(packageDir, "packages", "a", "node_modules"))).toEqual([
      ".bin",
      "b",
      "no-deps",
      "what-bin",
    ]);

    await write(join(packageDir, "packages", "a", "package.json"), JSON.stringify({ name: "a", version: "1.0.0" }));
    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await readdirSorted(join(packageDir, "packages", "a", "node_modules"))).toEqual([".bin"]);
    expect(await readdirSorted(join(packageDir, "packages", "a", "node_modules", ".bin"))).toEqual([]);
    expect(await file(join(packageDir, "packages", "b", "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.1",
    });
  },
);

test.concurrent("a workspace that the root no longer depends on is unlinked from the root's node_modules", async () => {
  const root = { name: "dropped-by-the-root", workspaces: ["packages/*"] };
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({ ...root, dependencies: { lib: "workspace:*", "no-deps": "1.0.0" } }),
      "packages/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0", bin: { "lib-cli": "cli.js" } }),
      "packages/lib/cli.js": "#!/usr/bin/env node\n",
    },
  });
  const nodeModules = join(packageDir, "node_modules");
  await runBunInstall(installEnv(packageDir), packageDir);
  expect(await readdirSorted(nodeModules)).toEqual([".bin", ".bun", "lib", "no-deps"]);
  expect(await readdirSorted(join(nodeModules, ".bin"))).toHaveBins(["lib-cli"]);

  await write(packageJson, JSON.stringify({ ...root, dependencies: { "no-deps": "1.0.0" } }));
  await runBunInstall(installEnv(packageDir), packageDir);

  expect(await readdirSorted(nodeModules)).toEqual([".bin", ".bun", "no-deps"]);
  expect(await readdirSorted(join(nodeModules, ".bin"))).toEqual([]);
});

test.concurrent.each(["isolated", "hoisted"] as const)(
  "%s: the bin of a workspace that isn't built yet is kept when another dependency is removed from package.json",
  async linker => {
    const root = { name: "not-built", workspaces: ["packages/*"] };
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({ ...root, dependencies: { lib: "workspace:*", "what-bin": "1.0.0" } }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          bin: { "lib-cli": "dist/cli.js" },
        }),
        "packages/lib/dist/cli.js": "#!/usr/bin/env node\n",
      },
    });
    const bins = join(packageDir, "node_modules", ".bin");
    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await readdirSorted(bins)).toHaveBins(["lib-cli", "what-bin"]);

    await rm(join(packageDir, "packages", "lib", "dist"), { recursive: true });
    await write(packageJson, JSON.stringify({ ...root, dependencies: { lib: "workspace:*" } }));
    await runBunInstall(installEnv(packageDir), packageDir);
    expect((await readdirSorted(bins)).filter(name => name.startsWith("lib-cli"))).toHaveBins(["lib-cli"]);
  },
);

test.concurrent.each(["install", "remove test-native-binlink"])(
  "a bin link into a store entry is removed when bun prune removes the entry: after bun %s",
  async command => {
    const native = ["test-native-binlink"];
    const root = { name: "command-into-the-store", nativeDependencies: native, trustedDependencies: native };
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          ...root,
          dependencies: { "test-native-binlink": "1.0.0", "no-deps": "1.0.0" },
        }),
      },
    });
    const run = async (...args: string[]) => {
      const env = installEnv(packageDir);
      await using proc = spawn({ cmd: [bunExe(), ...args], cwd: packageDir, env, stdout: "pipe", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    };
    const nodeModules = join(packageDir, "node_modules");
    await run("install");
    expect(await readdirSorted(join(nodeModules, ".bin"))).toHaveBins(["test-binlink-cmd"]);

    if (command === "install") {
      await write(packageJson, JSON.stringify({ ...root, dependencies: { "no-deps": "1.0.0" } }));
    }
    await run(...command.split(" "));
    await run("prune");

    expect(await readdirSorted(join(nodeModules, ".bun"))).toEqual(["no-deps@1.0.0", "node_modules"]);
    expect(await readdirSorted(join(nodeModules, ".bin"))).toEqual([]);
  },
);

test.concurrent("the last dependency that left package.json is unlinked from node_modules", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: { "package.json": JSON.stringify({ name: "dropped-last", dependencies: { "one-dep": "1.0.0" } }) },
  });
  await runBunInstall(installEnv(packageDir), packageDir);

  await write(packageJson, JSON.stringify({ name: "dropped-last" }));
  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun"]);
});

// A link is only removed from the node_modules of the package that lost the dependency, and only if Bun created it.
test.concurrent.each(["install", "remove no-deps"])(
  "a dependency that left one package.json keeps every other link of its name: bun %s",
  async command => {
    const member = (name: string, dependencies: Record<string, string>) =>
      JSON.stringify({ name, version: "1.0.0", dependencies });
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "own-links", workspaces: ["packages/*"] }),
        "packages/drops/package.json": member("drops", { "no-deps": "1.0.0", "a-dep": "1.0.1" }),
        "packages/drops-relinked/package.json": member("drops-relinked", { "no-deps": "1.0.0", "a-dep": "1.0.1" }),
        "packages/lists/package.json": member("lists", { "no-deps": "1.0.0" }),
        "packages/by-hand/package.json": member("by-hand", { "a-dep": "1.0.1" }),
        "packages/bun-link/package.json": member("bun-link", { "a-dep": "1.0.1" }),
        "mine/package.json": JSON.stringify({ name: "no-deps", version: "9.9.9" }),
      },
    });
    const env = {
      ...installEnv(packageDir),
      BUN_INSTALL: join(packageDir, "global"),
      BUN_INSTALL_GLOBAL_DIR: join(packageDir, "global", "install", "global"),
    };
    const run = async (cwd: string, ...args: string[]) => {
      await using proc = spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    };
    const linkIn = (...folder: string[]) => join(packageDir, ...folder, "node_modules", "no-deps");
    // The version that `import "no-deps"` finds in each node_modules.
    const versions = async () => {
      const found: Record<string, string | undefined> = {};
      for (const folder of ["", "drops", "drops-relinked", "lists", "by-hand", "bun-link"]) {
        const manifest = file(join(folder ? linkIn("packages", folder) : linkIn(), "package.json"));
        found[folder] = (await manifest.exists()) ? (await manifest.json()).version : undefined;
      }
      return found;
    };

    await run(packageDir, "install");
    await run(join(packageDir, "mine"), "link");
    await run(join(packageDir, "packages", "bun-link"), "link", "no-deps");
    rmSync(linkIn("packages", "drops-relinked"));
    for (const link of [linkIn(), linkIn("packages", "by-hand"), linkIn("packages", "drops-relinked")]) {
      symlinkSync(join(packageDir, "mine"), link, "junction");
    }
    const mine = { "": "9.9.9", "drops-relinked": "9.9.9", "by-hand": "9.9.9", "bun-link": "9.9.9" };
    expect(await versions()).toEqual({ ...mine, drops: "1.0.0", lists: "1.0.0" });

    // An install recreates the link of a dependency that's still listed, so the changed link is removed first.
    for (const name of ["drops-relinked", "drops"]) {
      const folder = join(packageDir, "packages", name);
      if (command === "install") {
        await write(join(folder, "package.json"), member(name, { "a-dep": "1.0.1" }));
      }
      await run(folder, ...command.split(" "));
    }

    expect(await versions()).toEqual({ ...mine, drops: undefined, lists: "1.0.0" });
  },
);

// The copy of a folder dependency is made again by an install that finds other names or files in the folder.
test.concurrent(
  "a file that's deleted from a folder dependency is removed from its copy on the next install",
  async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "folder-dep-prune", dependencies: { "folder-dep": "file:./pkg-1" } }),
        "pkg-1/package.json": JSON.stringify({
          name: "folder-dep",
          version: "1.0.0",
          dependencies: { "no-deps": "1.0.0" },
        }),
        "pkg-1/index.js": "module.exports = 1;",
        "pkg-1/extra.js": "module.exports = 2;",
        "pkg-1/.hidden": "",
        "pkg-1/nested/inner.js": "module.exports = 3;",
        "pkg-1/kept/stays.js": "module.exports = 4;",
        "pkg-1/kept/goes.js": "module.exports = 5;",
        "pkg-1/kept/deep/goes.js": "module.exports = 6;",
      },
    });
    const entry = join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules");
    const copy = async () =>
      (await Array.fromAsync(new Bun.Glob("**").scan({ cwd: join(entry, "folder-dep"), dot: true }))).sort();

    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await copy()).toEqual(
      [
        ".hidden",
        "extra.js",
        "index.js",
        "kept/deep/goes.js",
        "kept/goes.js",
        "kept/stays.js",
        "nested/inner.js",
        "package.json",
      ].map(path => join(path)),
    );

    await Promise.all([
      rm(join(packageDir, "pkg-1", "extra.js")),
      rm(join(packageDir, "pkg-1", ".hidden")),
      rm(join(packageDir, "pkg-1", "nested"), { recursive: true }),
      rm(join(packageDir, "pkg-1", "kept", "goes.js")),
      rm(join(packageDir, "pkg-1", "kept", "deep"), { recursive: true }),
      write(join(packageDir, "pkg-1", "index.js"), "module.exports = 'updated';"),
    ]);
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(await copy()).toEqual(["index.js", join("kept", "stays.js"), "package.json"]);
    expect(await readdirSorted(join(entry, "folder-dep"))).toEqual(["index.js", "kept", "package.json"]);
    expect(await file(join(entry, "folder-dep", "index.js")).text()).toBe("module.exports = 'updated';");
    // The links beside the copy are no part of it.
    expect(await file(join(entry, "no-deps", "package.json")).json()).toMatchObject({
      name: "no-deps",
      version: "1.0.0",
    });
    expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
      join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
    );
  },
);

// symlinkSync needs Developer Mode or elevation on Windows.
describe.skipIf(isWindows).each(["isolated", "hoisted"] as const)("links in a file: folder (%s)", linker => {
  const files = {
    "package.json": JSON.stringify({ name: "folder-links", dependencies: { lib: "file:./vendor/lib" } }),
    "shared/tsconfig.base.json": JSON.stringify({ shared: true }),
    "vendor/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0", main: "dist/index.js" }),
  };

  test.concurrent(
    "a link that stays inside the folder is a link in the copy, and a link to a file in the project becomes the file",
    async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker },
        files: {
          ...files,
          "vendor/lib/build/index.js": "module.exports = 'built';",
          "vendor/lib/plain.js": "module.exports = 'plain';",
          "vendor/lib/sub/other.js": "",
        },
      });
      const [folder, copy] = [join(packageDir, "vendor", "lib"), join(packageDir, "node_modules", "lib")];
      symlinkSync("build", join(folder, "dist"));
      symlinkSync("plain.js", join(folder, "alias.js"));
      symlinkSync(join("..", "plain.js"), join(folder, "sub", "up.js"));
      symlinkSync(join("..", "..", "shared", "tsconfig.base.json"), join(folder, "tsconfig.base.json"));

      await runBunInstall(installEnv(packageDir), packageDir);
      expect(["dist", "alias.js", join("sub", "up.js")].map(link => readlinkSync(join(copy, link)))).toEqual([
        "build",
        "plain.js",
        join("..", "plain.js"),
      ]);
      expect(realpathSync(join(copy, "dist", "index.js"))).toBe(join(realpathSync(copy), "build", "index.js"));
      expect(lstatSync(join(copy, "tsconfig.base.json")).isFile()).toBe(true);
      expect(await file(join(copy, "tsconfig.base.json")).json()).toEqual({ shared: true });

      const { out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
      expect(out).toContain("(no changes)");

      // A directory takes the place of the link: nothing is written through the link of the copy.
      rmSync(join(folder, "dist"));
      await write(join(folder, "dist", "index.js"), "module.exports = 'dist';");
      await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
      expect(lstatSync(join(copy, "dist")).isDirectory()).toBe(true);
      expect(await file(join(copy, "dist", "index.js")).text()).toBe("module.exports = 'dist';");
      expect(await file(join(copy, "build", "index.js")).text()).toBe("module.exports = 'built';");
    },
  );

  test.concurrent("one that's skipped is reported in a warning when the folder is installed", async () => {
    using outside = tempDir("folder-links-outside", { "secret.txt": "secret" });
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files });
    const [folder, copy] = [join(packageDir, "vendor", "lib"), join(packageDir, "node_modules", "lib")];
    symlinkSync(join("..", "..", "shared", "later.json"), join(folder, "gone"));
    symlinkSync(join("..", "..", "shared"), join(folder, "shared"));
    symlinkSync(join(String(outside), "secret.txt"), join(folder, "secret.txt"));
    const warnings = (err: string) => err.split("\n").filter(line => line.startsWith("warn:"));
    const leftOut = [
      "warn: skipping link vendor/lib/secret.txt: target is outside the project",
      "warn: skipping link vendor/lib/shared: directory links must be relative and stay inside the folder",
    ];

    const first = await runBunInstall(installEnv(packageDir), packageDir, { allowWarnings: true });
    expect(warnings(first.err)).toEqual(["warn: skipping link vendor/lib/gone: target does not exist", ...leftOut]);
    expect(await readdirSorted(copy)).toEqual(["package.json"]);

    // Nothing can be done about them, so the warning isn't repeated.
    const { out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(out).toContain("(no changes)");

    // The folder is as it was, and one of its links leads somewhere now.
    await write(join(packageDir, "shared", "later.json"), "{}");
    const later = await runBunInstall(installEnv(packageDir), packageDir, {
      allowWarnings: true,
      savesLockfile: false,
    });
    expect(warnings(later.err)).toEqual(leftOut);
    expect(await readdirSorted(copy)).toEqual(["gone", "package.json"]);

    await rm(join(packageDir, "node_modules"), { recursive: true });
    await using silent = spawn({
      cmd: [bunExe(), "install", "--silent"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await Promise.all([silent.stdout.text(), silent.stderr.text(), silent.exited])).toEqual(["", "", 0]);
  });

  // From a member that is a link, the root is found by $PWD: by the path as typed, with its links.
  test.concurrent("a file of the project is one by whichever path the project is reached", async () => {
    using dir = tempDir("folder-links-typed", {
      "real/proj": {
        ...files,
        "package.json": JSON.stringify({
          name: "folder-links",
          workspaces: ["packages/*"],
          dependencies: { lib: "file:./vendor/lib" },
        }),
        "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
        "packages": {},
        "elsewhere/app/package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
      },
    });
    const project = join(String(dir), "real", "proj");
    symlinkSync(join(project, "elsewhere", "app"), join(project, "packages", "app"));
    symlinkSync(join("..", "..", "shared", "tsconfig.base.json"), join(project, "vendor", "lib", "tsconfig.json"));
    symlinkSync("real", join(String(dir), "typed"));

    const cwd = join(String(dir), "typed", "proj", "packages", "app");
    await runBunInstall({ ...installEnv(project), PWD: cwd }, cwd);
    expect(await file(join(project, "node_modules", "lib", "tsconfig.json")).json()).toEqual({ shared: true });
  });
});

// The cwd of a process on Windows is as its parent spelled it.
test.concurrent.skipIf(!isWindows).each(["isolated", "hoisted"] as const)(
  "a link in a file: folder to a file of the project is installed from a cwd with a lowercase drive letter (%s)",
  async linker => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({ name: "folder-links", dependencies: { lib: "file:./vendor/lib" } }),
        "shared/elsewhere.js": "module.exports = 1;",
        "vendor/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
      },
    });
    symlinkSync(join("..", "..", "shared", "elsewhere.js"), join(packageDir, "vendor", "lib", "project.js"), "file");

    await runBunInstall(installEnv(packageDir), packageDir[0].toLowerCase() + packageDir.slice(1));
    expect(await file(join(packageDir, "node_modules", "lib", "project.js")).text()).toBe("module.exports = 1;");
  },
);

// It reserves its name there, so that no registry package with that name is found first, but it has no link of its own.
test.concurrent(
  "a folder dependency gets no link in node_modules/.bun/node_modules, whichever way it is linked",
  async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "folder-dep-hidden",
          dependencies: { "folder-dep": "file:./pkg-1", "one-dep": "1.0.0" },
          overrides: { "no-deps": "file:./vendor" },
        }),
        "pkg-1/package.json": JSON.stringify({
          name: "folder-dep",
          version: "1.0.0",
          dependencies: { "a-dep": "1.0.1" },
        }),
        "vendor/package.json": JSON.stringify({ name: "no-deps", version: "9.9.9" }),
      },
    });
    const hidden = () => readdirSorted(join(packageDir, "node_modules", ".bun", "node_modules"));

    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await hidden()).toEqual(["a-dep", "one-dep"]);

    const { out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(out).toContain("(no changes)");
    expect(await hidden()).toEqual(["a-dep", "one-dep"]);

    await Promise.all(["pkg-1", "vendor"].map(folder => write(join(packageDir, folder, "index.js"), "")));
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await hidden()).toEqual(["a-dep", "one-dep"]);
  },
);

test.concurrent("a folder dependency whose folder is gone fails the install and keeps its copy", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({ name: "folder-dep-gone", dependencies: { "folder-dep": "file:./pkg-1" } }),
      "pkg-1/package.json": JSON.stringify({ name: "folder-dep", version: "1.0.0" }),
      "pkg-1/index.js": "module.exports = 1;",
    },
  });
  await runBunInstall(installEnv(packageDir), packageDir);
  const index = join(packageDir, "node_modules", "folder-dep", "index.js");
  expect(await file(index).text()).toBe("module.exports = 1;");

  await rm(join(packageDir, "pkg-1"), { recursive: true });
  await runBunInstall(installEnv(packageDir), packageDir, {
    allowErrors: true,
    expectedExitCode: 1,
    savesLockfile: false,
  });

  expect(await file(index).text()).toBe("module.exports = 1;");
});

test.concurrent("a link replaces the copy of the project that older versions put in the store", async () => {
  const copy = "node_modules/.bun/root-file-dep@root/node_modules/root-file-dep";
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({ name: "root-file-dep", dependencies: { self: "file:." } }),
      "index.js": "module.exports = 2;",
      [`${copy}/index.js`]: "module.exports = 1;",
    },
  });
  const self = join(packageDir, "node_modules", "self");
  symlinkSync(join(packageDir, copy), self, "junction");

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(readlinkSync(self)).toBe("..");
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual([]);
  expect(await file(join(packageDir, "index.js")).text()).toBe("module.exports = 2;");
});

// A bin target gets `0o777 & ~umask`, under both linkers. For a workspace dependency the target is
// the source file in the repo. Windows links bins as shims and chmods nothing.
describe.each(["isolated", "hoisted"] as const)("bin target modes with the %s linker", linker => {
  describe.each([
    ["022", 0o755],
    ["077", 0o700],
    ["002", 0o775],
  ])("umask %s", (umask, expectedMode) => {
    test.concurrent.skipIf(isWindows)(
      "are 0o777 & ~umask, and an install that changes nothing writes nothing",
      async () => {
        const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker } });
        const workspaceBin = join(packageDir, "packages", "tool", "cli.js");
        const binDir = join(packageDir, "node_modules", ".bin");
        const links = ["tool", "dep", "tb", "what-bin"].map(name => join(binDir, name));
        // A cache that the tests share hardlinks one inode of the tarball's bin into each of them.
        const env = installEnv(packageDir);

        await Promise.all([
          write(
            packageJson,
            JSON.stringify({
              name: "umask-root",
              workspaces: ["packages/*"],
              dependencies: {
                tool: "workspace:*",
                dep: "file:./dep",
                tb: "file:./tb-1.0.0.tgz",
                "what-bin": "1.0.0",
              },
            }),
          ),
          write(
            join(packageDir, "packages", "tool", "package.json"),
            JSON.stringify({ name: "tool", version: "1.0.0", bin: { tool: "./cli.js" } }),
          ),
          write(workspaceBin, "#!/usr/bin/env node\nconsole.log(1)\n"),
          write(
            join(packageDir, "dep", "package.json"),
            JSON.stringify({ name: "dep", version: "1.0.0", bin: "d.js" }),
          ),
          write(join(packageDir, "dep", "d.js"), "#!/bin/sh\necho d\n"),
          Bun.Archive.write(
            join(packageDir, "tb-1.0.0.tgz"),
            {
              "package/package.json": JSON.stringify({ name: "tb", version: "1.0.0", bin: "t.js" }),
              "package/t.js": "#!/bin/sh\necho t\n",
            },
            { compress: "gzip" },
          ),
        ]);
        await Promise.all([chmod(workspaceBin, 0o644), chmod(join(packageDir, "dep", "d.js"), 0o644)]);

        const want = expectedMode.toString(8);
        async function installAndExpectModes() {
          await using proc = spawn({
            cmd: ["sh", "-c", `umask ${umask} && exec "$0" install`, bunExe()],
            cwd: packageDir,
            env,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).not.toContain("error:");
          expect([workspaceBin, ...links].map(path => (statSync(path).mode & 0o777).toString(8))).toEqual([
            want,
            want,
            want,
            want,
            want,
          ]);
          expect(exitCode).toBe(0);
        }

        await installAndExpectModes();

        // A link that is removed and made again loses its mtime. A chmod, even to the mode the file
        // has, moves its ctime, which has the resolution of the kernel's clock tick: wait one out.
        // The folder and the local tarball will not do: a run can install those again.
        const unchanged = [workspaceBin, realpathSync(join(binDir, "what-bin"))];
        const ctimes = () => unchanged.map(path => statSync(path, { bigint: true }).ctimeNs);
        for (const link of links) lutimesSync(link, 1, 1);
        const before = ctimes();
        const probe = join(packageDir, "ctime-probe");
        await write(probe, "");
        do chmodSync(probe, 0o600);
        while (before.some(ctime => statSync(probe, { bigint: true }).ctimeNs <= ctime));
        await installAndExpectModes();
        expect(links.map(link => lstatSync(link).mtimeMs)).toEqual([1000, 1000, 1000, 1000]);
        expect(ctimes()).toEqual(before);

        // It isn't executable. The isolated linker of older versions left files like this behind.
        for (const mode of [0o644, 0o777]) {
          await Promise.all(links.map(link => chmod(realpathSync(link), mode)));
          await installAndExpectModes();
        }
      },
    );
  });
});

test.concurrent("a folder dependency shared by several folder dependencies is one package", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  const siblings = Array.from({ length: 6 }, (_, i) => `sib${i}`);

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-shared-folder-dep",
        dependencies: {
          shared: "file:./vend/shared",
          ...Object.fromEntries(siblings.map(name => [name, `file:./vend/${name}`])),
        },
      }),
    ),
    write(join(packageDir, "vend", "shared", "package.json"), JSON.stringify({ name: "shared", version: "1.0.0" })),
    write(join(packageDir, "vend", "shared", "index.js"), "module.exports = 'shared';"),
    ...siblings.flatMap(name => [
      write(
        join(packageDir, "vend", name, "package.json"),
        JSON.stringify({ name, version: "1.0.0", dependencies: { shared: "file:../shared" } }),
      ),
      write(join(packageDir, "vend", name, "index.js"), "module.exports = require('shared');"),
    ]),
  ]);

  // A fresh resolve made one `shared` package per declarer. Each one linked
  // into the same store entry at the same time: EEXIST from link().
  const { out } = await runBunInstall(installEnv(packageDir), packageDir);
  expect(out).toContain(`${siblings.length + 1} packages installed`);

  const store = join(packageDir, "node_modules", ".bun");
  expect(readlinkSync(join(packageDir, "node_modules", "shared"))).toBe(
    join(".bun", "shared@file+vend+shared", "node_modules", "shared"),
  );
  expect(
    await Promise.all(
      siblings.map(name => readlink(join(store, `${name}@file+vend+${name}`, "node_modules", "shared"))),
    ),
  ).toEqual(siblings.map(() => join("..", "..", "shared@file+vend+shared", "node_modules", "shared")));
  expect(await readdirSorted(join(store, "shared@file+vend+shared", "node_modules", "shared"))).toEqual([
    "index.js",
    "package.json",
  ]);

  const requireFromRoot = createRequire(packageJson);
  expect(siblings.map(name => requireFromRoot(name))).toEqual(siblings.map(() => "shared"));
});

test.concurrent("a file: override that several registry packages depend on is one package", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // Each of these declares `no-deps`.
  const dependents = {
    "one-dep": "1.0.0",
    "one-fixed-dep": "1.0.0",
    "one-range-dep": "1.0.0",
    "one-range-dep-too": "1.0.0",
    "normal-dep-and-dev-dep": "1.0.2",
  };

  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-file-override",
        dependencies: dependents,
        overrides: { "no-deps": "file:./vendor/no-deps" },
      }),
    ),
    write(join(packageDir, "vendor", "no-deps", "package.json"), JSON.stringify({ name: "no-deps", version: "9.9.9" })),
  ]);

  // CI exports one BUN_INSTALL_CACHE_DIR for the whole file. Manifests cached here
  // would change the order in which later tests resolve the same packages.
  const env = installEnv(packageDir);
  const { out } = await runBunInstall(env, packageDir);
  expect(out).toContain(`${Object.keys(dependents).length + 1} packages installed`);

  // one entry for the override target, whatever path spelling its name carries
  const store = join(packageDir, "node_modules", ".bun");
  const entries = await readdirSorted(store);
  expect(entries.filter(dir => dir.startsWith("no-deps@"))).toEqual([expect.stringMatching(/^no-deps@file\+/)]);
  const overrideEntry = entries.find(dir => dir.startsWith("no-deps@"))!;

  expect(
    await Promise.all(
      Object.entries(dependents).map(([name, version]) =>
        readlink(join(store, `${name}@${version}`, "node_modules", "no-deps")),
      ),
    ),
  ).toEqual(Object.keys(dependents).map(() => join("..", "..", overrideEntry, "node_modules", "no-deps")));
  expect(await file(join(store, overrideEntry, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "9.9.9",
  });
});

describe.concurrent("link: dependencies", () => {
  async function runBun(args: string[], cwd: string, env: NodeJS.Dict<string>) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // The lockfile records a `link:` dependency by name only, so the `bun link`
  // registration behind that name can be gone by the time the lockfile is
  // installed: `bun unlink` removes the global link dir entry, deleting the
  // package leaves the entry dangling.
  test.concurrent.each([
    {
      name: "linked-pkg",
      gone: "the package was unlinked",
      code: "ENOENT",
      async remove(pkgDir: string, env: NodeJS.Dict<string>) {
        const result = await runBun(["unlink"], pkgDir, env);
        expect(result.stdout).toContain(`success: unlinked package "linked-pkg"`);
        expect(result.exitCode).toBe(0);
      },
    },
    {
      name: "@scope/linked-pkg",
      gone: "the linked directory was deleted",
      code: "ENOENT",
      async remove(pkgDir: string) {
        await rm(pkgDir, { recursive: true, force: true });
      },
    },
    {
      name: "linked-pkg",
      gone: "the linked directory was replaced by a file",
      code: "ENOTDIR",
      async remove(pkgDir: string) {
        await rm(pkgDir, { recursive: true, force: true });
        await write(pkgDir, "");
      },
    },
  ])("installing from the lockfile fails when $gone", async ({ name, code, remove }) => {
    using dir = tempDir("isolated-link-target", {
      "pkg/package.json": JSON.stringify({ name, version: "1.0.0" }),
      "app/package.json": JSON.stringify({ name: "app", dependencies: { [name]: `link:${name}` } }),
      "app/bunfig.toml": `[install]\nlinker = "isolated"\n`,
    });
    const pkgDir = join(String(dir), "pkg");
    const appDir = join(String(dir), "app");
    // `bun link` registers into $BUN_INSTALL/install/global; keep it private to this test.
    const env = { ...bunEnv, BUN_INSTALL: join(String(dir), "bun-install") };

    let result = await runBun(["link"], pkgDir, env);
    expect(result.stdout).toContain(`Success! Registered "${name}"`);
    expect(result.exitCode).toBe(0);

    result = await runBun(["install"], appDir, env);
    expect(result.stderr).toContain("Saved lockfile");
    expect(result.exitCode).toBe(0);
    expect(await file(join(appDir, "node_modules", name, "package.json")).json()).toEqual({ name, version: "1.0.0" });

    await remove(pkgDir, env);

    // Both reinstalling over the existing node_modules and installing into a
    // fresh one (a clone with the lockfile checked in) must report the missing
    // package and exit 1 instead of silently succeeding. As with every other
    // failed entry, node_modules/<name> still points at the registration and
    // resolves again once the package is re-linked.
    const link = join(appDir, "node_modules", name);
    result = await runBun(["install"], appDir, env);
    expect(result.stderr).toContain(code);
    expect(result.stderr).toContain(`failed to link package: ${name}@link:`);
    expect(result.stdout).toContain("Failed to install 1 package");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(result.exitCode).toBe(1);

    await rm(join(appDir, "node_modules"), { recursive: true, force: true });
    result = await runBun(["install"], appDir, env);
    expect(result.stderr).toContain(code);
    expect(result.stderr).toContain(`failed to link package: ${name}@link:`);
    expect(result.stdout).toContain("Failed to install 1 package");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(result.exitCode).toBe(1);

    await rm(pkgDir, { recursive: true, force: true });
    await write(join(pkgDir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    expect((await runBun(["link"], pkgDir, env)).exitCode).toBe(0);
    expect(await file(join(link, "package.json")).json()).toEqual({ name, version: "1.0.0" });
  });
});

// A `file:` dependency declared by a registry package points at a folder inside
// that package (the same fixtures as "transitive file dependencies" in
// bun-install-registry.test.ts, which covers the hoisted linker).
describe.concurrent("transitive file dependencies of registry packages", () => {
  const dependencies = {
    // depends on file-dep@1.0.0
    "dep-file-dep": "1.0.0",
    // "files": "file:./the-files"
    "file-dep": "1.0.0",
    // "files": "file:./missing-folder", which is not in the tarball
    "missing-file-dep": "1.0.0",
    // file-dep@1.0.1 has "files": "file:."
    "aliased-file-dep": "npm:file-dep@1.0.1",
    // both have "@scoped/files": "file:./the-files", so bun.lock holds one
    // folder package with two dependents
    "@scoped/file-dep": "1.0.0",
    "@another-scope/file-dep": "1.0.0",
    // "self-file-dep": "file:."
    "self-file-dep": "1.0.0",
  };

  const storeEntries = [
    "@another-scope+file-dep@1.0.0",
    "@scoped+file-dep@1.0.0",
    "dep-file-dep@1.0.0",
    "file-dep@1.0.0",
    "file-dep@1.0.1",
    "missing-file-dep@1.0.0",
    "node_modules",
    "self-file-dep@1.0.0",
  ];

  async function checkStore(packageDir: string) {
    const bunDir = join(packageDir, "node_modules", ".bun");
    const storePackage = (entry: string, ...name: string[]) => join(bunDir, entry, "node_modules", ...name);

    // The folders never get their own store entries.
    expect(await readdirSorted(bunDir)).toEqual(storeEntries);

    expect([
      readlinkSync(storePackage("file-dep@1.0.0", "files")),
      readlinkSync(storePackage("file-dep@1.0.1", "files")),
      readlinkSync(storePackage("@scoped+file-dep@1.0.0", "@scoped", "files")),
      readlinkSync(storePackage("@another-scope+file-dep@1.0.0", "@scoped", "files")),
      readlinkSync(storePackage("self-file-dep@1.0.0", "self-file-dep", "node_modules", "self-file-dep")),
      await readdirSorted(storePackage("missing-file-dep@1.0.0")),
      await readdirSorted(storePackage("dep-file-dep@1.0.0")),
    ]).toEqual([
      join("file-dep", "the-files"),
      "file-dep",
      join("file-dep", "the-files"),
      join("..", "@another-scope", "file-dep", "the-files"),
      "..",
      ["missing-file-dep"],
      ["dep-file-dep", "file-dep"],
    ]);

    expect(
      await Promise.all([
        file(storePackage("file-dep@1.0.0", "files", "package.json")).json(),
        file(storePackage("file-dep@1.0.1", "files", "package.json")).json(),
        file(storePackage("@another-scope+file-dep@1.0.0", "@scoped", "files", "index.js")).text(),
        file(
          storePackage("self-file-dep@1.0.0", "self-file-dep", "node_modules", "self-file-dep", "package.json"),
        ).json(),
      ]),
    ).toEqual([
      { name: "files", version: "1.1.1", dependencies: { "no-deps": "2.0.0" } },
      { name: "file-dep", version: "1.0.1", dependencies: { files: "file:." } },
      'console.log("hello files");',
      { name: "self-file-dep", version: "1.0.0", dependencies: { "self-file-dep": "file:." } },
    ]);

    // the packages resolve their folders from their real location in the store
    const fromFileDep = createRequire(storePackage("file-dep@1.0.0", "file-dep", "package.json"));
    expect(fromFileDep.resolve("files")).toEndWith(
      join(".bun", "file-dep@1.0.0", "node_modules", "file-dep", "the-files", "index.js"),
    );
    const fromMissingFileDep = createRequire(
      storePackage("missing-file-dep@1.0.0", "missing-file-dep", "package.json"),
    );
    expect(() => fromMissingFileDep.resolve("files")).toThrow(expect.objectContaining({ code: "MODULE_NOT_FOUND" }));
  }

  test("are linked from inside the package that declares them", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await write(packageJson, JSON.stringify({ name: "transitive-file-deps", dependencies }));

    let { out } = await runBunInstall(installEnv(packageDir), packageDir);
    expect(out).toContain("7 packages installed");
    await checkStore(packageDir);

    // from bun.lock, where the two `@scoped/files` rows load as one package
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    ({ out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false }));
    expect(out).toContain("7 packages installed");
    await checkStore(packageDir);

    // relinking an existing node_modules
    ({ out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false }));
    expect(out).toContain("no changes");
    await checkStore(packageDir);
  });

  test("a folder declared by the root keeps its store entry when a registry package peer-depends on it", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "root-folder-satisfies-peer",
          dependencies: {
            // peerDependencies: { "no-deps": "*" }
            "peer-deps": "1.0.0",
            "no-deps": "file:./no-deps",
          },
        }),
      ),
      write(join(packageDir, "no-deps", "package.json"), JSON.stringify({ name: "no-deps", version: "9.9.9" })),
    ]);

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunDir = join(packageDir, "node_modules", ".bun");
    const entries = await readdirSorted(bunDir);
    expect(entries).toContain("no-deps@file+no-deps");
    const peerDeps = entries.find(entry => entry.startsWith("peer-deps@1.0.0"))!;
    expect(readlinkSync(join(bunDir, peerDeps, "node_modules", "no-deps"))).toBe(
      join("..", "..", "no-deps@file+no-deps", "node_modules", "no-deps"),
    );
    expect(await file(join(bunDir, peerDeps, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "9.9.9",
    });
  });

  // file-dep-with-peer-on-files@1.0.0 declares `"files": "file:the-files"` and depends on
  // peer-on-files@1.0.0, which has an optional peer on `files` and ships an unrelated
  // the-files folder of its own (registry/packages/create-file-dep-with-peer-packages.ts).
  test("a folder is not bound to a peer dependency below the package containing it", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await write(
      packageJson,
      JSON.stringify({ name: "contained-folder-peer", dependencies: { "file-dep-with-peer-on-files": "1.0.0" } }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunDir = join(packageDir, "node_modules", ".bun");
    const declaring = join(bunDir, "file-dep-with-peer-on-files@1.0.0", "node_modules");
    const peer = join(bunDir, "peer-on-files@1.0.0", "node_modules");
    expect(
      await Promise.all([
        readdirSorted(bunDir),
        readdirSorted(declaring),
        readlink(join(declaring, "files")),
        file(join(declaring, "files", "index.js")).text(),
        // nothing provides the peer, so it is not linked even though peer-on-files
        // ships a folder with the declared path itself
        readdirSorted(peer),
      ]),
    ).toEqual([
      ["file-dep-with-peer-on-files@1.0.0", "node_modules", "peer-on-files@1.0.0"],
      ["file-dep-with-peer-on-files", "files", "peer-on-files"],
      join("file-dep-with-peer-on-files", "the-files"),
      'module.exports = "the-files shipped by file-dep-with-peer-on-files";\n',
      ["peer-on-files"],
    ]);
    const fromPeer = createRequire(join(peer, "peer-on-files", "package.json"));
    expect(() => fromPeer.resolve("files")).toThrow(expect.objectContaining({ code: "MODULE_NOT_FOUND" }));
  });

  // The root's `peer-on-files` is another package, so the hoisted tree keeps peer-on-files@1.0.0
  // below file-dep-with-peer-on-files, next to the folder, and binds the optional peer to it.
  test("nor when the lockfile has bound the peer dependency to it", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await write(
      packageJson,
      JSON.stringify({
        name: "contained-folder-bound-peer",
        dependencies: { "file-dep-with-peer-on-files": "1.0.0", "peer-on-files": "npm:no-deps@2.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunDir = join(packageDir, "node_modules", ".bun");
    const declaring = join(bunDir, "file-dep-with-peer-on-files@1.0.0", "node_modules");
    expect(
      await Promise.all([
        readdirSorted(bunDir),
        readdirSorted(declaring),
        readlink(join(declaring, "files")),
        readdirSorted(join(bunDir, "peer-on-files@1.0.0", "node_modules")),
      ]),
    ).toEqual([
      ["file-dep-with-peer-on-files@1.0.0", "no-deps@2.0.0", "node_modules", "peer-on-files@1.0.0"],
      ["file-dep-with-peer-on-files", "files", "peer-on-files"],
      join("file-dep-with-peer-on-files", "the-files"),
      ["peer-on-files"],
    ]);

    const { out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(out).toContain("no changes");
  });

  test("a folder the root also declares: the root links its store entry, the package links its own copy, fresh and from bun.lock", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "shared-folder-row",
          dependencies: {
            "file-dep-with-peer-on-files": "1.0.0",
            // normalizes to the-files, the path the registry package declares, so the
            // two rows load from bun.lock as one folder package
            "files": "file:./the-files",
          },
        }),
      ),
      write(join(packageDir, "the-files", "package.json"), JSON.stringify({ name: "files", version: "2.0.0" })),
      write(join(packageDir, "the-files", "index.js"), 'module.exports = "the-files in the project";\n'),
    ]);

    const bunDir = join(packageDir, "node_modules", ".bun");
    async function checkLayout() {
      const entries = await readdirSorted(bunDir);
      const declaring = join(
        bunDir,
        entries.find(entry => entry.startsWith("file-dep-with-peer-on-files@"))!,
        "node_modules",
      );
      const peer = join(
        bunDir,
        entries.find(entry => entry.startsWith("peer-on-files@"))!,
        "node_modules",
      );
      expect(
        await Promise.all([
          entries.map(entry => entry.replace(/\+[0-9a-f]{16}$/, "")),
          readlink(join(packageDir, "node_modules", "files")),
          file(join(packageDir, "node_modules", "files", "index.js")).text(),
          readlink(join(declaring, "files")),
          file(join(declaring, "files", "index.js")).text(),
          // the peer is satisfied by the root's folder, not by the copy inside its parent
          readlink(join(peer, "files")),
          file(join(peer, "files", "index.js")).text(),
        ]),
      ).toEqual([
        ["file-dep-with-peer-on-files@1.0.0", "files@file+the-files", "node_modules", "peer-on-files@1.0.0"],
        join(".bun", "files@file+the-files", "node_modules", "files"),
        'module.exports = "the-files in the project";\n',
        join("file-dep-with-peer-on-files", "the-files"),
        'module.exports = "the-files shipped by file-dep-with-peer-on-files";\n',
        join("..", "..", "files@file+the-files", "node_modules", "files"),
        'module.exports = "the-files in the project";\n',
      ]);
      return entries;
    }

    await runBunInstall(installEnv(packageDir), packageDir);
    const fresh = await checkLayout();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await checkLayout()).toEqual(fresh);
  });

  test("does not take the hoist slots of a real package with the same name", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", publicHoistPattern: ["files"] },
    });
    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "folder-hoist-slots",
          // file-dep's `files` folder entry is created before mid's `files` below
          dependencies: { "file-dep": "1.0.0", "mid": "file:./mid" },
        }),
      ),
      write(
        join(packageDir, "mid", "package.json"),
        JSON.stringify({ name: "mid", version: "1.0.0", dependencies: { files: "npm:no-deps@1.0.0" } }),
      ),
    ]);

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunDir = join(packageDir, "node_modules", ".bun");
    expect(
      await Promise.all([
        readdirSorted(bunDir),
        // publicHoistPattern and the hidden fallback directory both hold no-deps
        readlink(join(packageDir, "node_modules", "files")),
        readdirSorted(join(bunDir, "node_modules")),
        readlink(join(bunDir, "node_modules", "files")),
        readlink(join(bunDir, "file-dep@1.0.0", "node_modules", "files")),
        readlink(join(bunDir, "mid@file+mid", "node_modules", "files")),
      ]),
    ).toEqual([
      ["file-dep@1.0.0", "mid@file+mid", "no-deps@1.0.0", "node_modules"],
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
      ["file-dep", "files"],
      join("..", "no-deps@1.0.0", "node_modules", "no-deps"),
      join("file-dep", "the-files"),
      join("..", "..", "no-deps@1.0.0", "node_modules", "no-deps"),
    ]);
  });

  test("a folder path escaping its package is refused when it comes from bun.lock", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await write(packageJson, JSON.stringify({ name: "escaping-folder", dependencies: { "file-dep": "1.0.0" } }));

    // the resolver refuses to record such a path, so install first and edit bun.lock
    await runBunInstall(installEnv(packageDir), packageDir);
    const lockfile = join(packageDir, "bun.lock");
    const contents = await file(lockfile).text();
    expect(contents).toContain('"files@file:./the-files"');
    const bunDir = join(packageDir, "node_modules", ".bun");
    await Promise.all([
      write(lockfile, contents.replace('"files@file:./the-files"', '"files@file:../../../the-files"')),
      // exists, so only the refusal keeps it from being linked: ../../../the-files
      // from .bun/file-dep@1.0.0/node_modules/file-dep is .bun/the-files
      write(join(bunDir, "the-files", "package.json"), JSON.stringify({ name: "files" })),
      rm(join(bunDir, "file-dep@1.0.0"), { recursive: true, force: true }),
    ]);

    const { out, err } = await runBunInstall(installEnv(packageDir), packageDir, {
      allowErrors: true,
      expectedExitCode: 1,
      savesLockfile: false,
    });
    expect(err).toContain('error: refusing to install dependency files with unsafe folder path "../../../the-files"');
    expect(out).toContain("Failed to install 1 package");
    expect(await readdirSorted(join(bunDir, "file-dep@1.0.0", "node_modules"))).toEqual(["file-dep"]);
  });
});

test.concurrent(
  "a bin that fails to link does not stop the remaining bins of the package or of its siblings from being linked",
  async () => {
    // `directories.bin` names a file, so opening it as a directory fails with
    // ENOTDIR (a missing directory would be skipped silently).
    const badBinDir = (name: string) =>
      JSON.stringify({ name, version: "1.0.0", directories: { bin: "package.json" } });
    // Longer than a file name may be, so creating the link itself fails. It is
    // the first of the package's bins, both as declared and sorted.
    const longBinName = Buffer.alloc(300, "a").toString();
    const longBinNameError = isWindows ? "ENOENT" : "ENAMETOOLONG";
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "test-pkg-bin-link-errors",
          workspaces: ["packages/*"],
          dependencies: {
            "a-bin": "file:./deps/a-bin",
            "bad-bin-dir-1": "file:./deps/bad-bin-dir-1",
            "bad-bin-dir-2": "file:./deps/bad-bin-dir-2",
            "multi-bin": "file:./deps/multi-bin",
            "z-bin": "file:./deps/z-bin",
          },
        }),
        "packages/ws/package.json": JSON.stringify({
          name: "ws",
          dependencies: {
            "bad-bin-dir-1": "file:../../deps/bad-bin-dir-1",
            "z-bin": "file:../../deps/z-bin",
          },
        }),
        "deps/a-bin/package.json": JSON.stringify({ name: "a-bin", version: "1.0.0", bin: { "a-cli": "cli.js" } }),
        "deps/a-bin/cli.js": "#!/usr/bin/env node\nconsole.log('a');\n",
        "deps/z-bin/package.json": JSON.stringify({ name: "z-bin", version: "1.0.0", bin: { "z-cli": "cli.js" } }),
        "deps/z-bin/cli.js": "#!/usr/bin/env node\nconsole.log('z');\n",
        "deps/bad-bin-dir-1/package.json": badBinDir("bad-bin-dir-1"),
        "deps/bad-bin-dir-2/package.json": badBinDir("bad-bin-dir-2"),
        "deps/multi-bin/package.json": JSON.stringify({
          name: "multi-bin",
          version: "1.0.0",
          bin: { [longBinName]: "cli.js", "multi-b": "cli.js", "multi-c": "cli.js" },
        }),
        "deps/multi-bin/cli.js": "#!/usr/bin/env node\nconsole.log('multi');\n",
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const binDir = async (dir: string) => {
      const path = join(dir, "node_modules", ".bin");
      return existsSync(path) ? await readdirSorted(path) : [];
    };
    const bins = (...names: string[]) => (isWindows ? names.flatMap(n => [`${n}.bunx`, `${n}.exe`]) : names).sort();
    expect({
      root: await binDir(packageDir),
      ws: await binDir(join(packageDir, "packages", "ws")),
      "multi-bin's own": await binDir(join(packageDir, "node_modules", ".bun", "multi-bin@file+deps+multi-bin")),
    }).toEqual({
      root: bins("a-cli", "multi-b", "multi-c", "z-cli"),
      ws: bins("z-cli"),
      "multi-bin's own": bins("multi-b", "multi-c"),
    });

    // Every failing package is reported once for its own `.bin` and once per
    // package whose `.bin` it could not be linked into. Tasks run in parallel,
    // so sort.
    const binErrors = stderr
      .split("\n")
      .filter(line => line.includes("failed to link binaries"))
      .map(line => line.replaceAll("\\", "/"))
      .sort();
    expect(binErrors).toEqual(
      [
        "ENOTDIR: failed to link binaries for package: bad-bin-dir-1@deps/bad-bin-dir-1",
        "ENOTDIR: failed to link binaries for package: bad-bin-dir-2@deps/bad-bin-dir-2",
        `${longBinNameError}: failed to link binaries for package: multi-bin@deps/multi-bin`,
        "ENOTDIR: failed to link binaries of dependency bad-bin-dir-1@deps/bad-bin-dir-1 for package: test-pkg-bin-link-errors@",
        "ENOTDIR: failed to link binaries of dependency bad-bin-dir-1@deps/bad-bin-dir-1 for package: ws@workspace:packages/ws",
        "ENOTDIR: failed to link binaries of dependency bad-bin-dir-2@deps/bad-bin-dir-2 for package: test-pkg-bin-link-errors@",
        `${longBinNameError}: failed to link binaries of dependency multi-bin@deps/multi-bin for package: test-pkg-bin-link-errors@`,
      ].sort(),
    );
    expect(exitCode).toBe(1);
  },
);

describe.concurrent("isolated workspaces", () => {
  test("basic", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-workspaces",
          workspaces: {
            packages: ["pkg-1", "pkg-2"],
          },
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "pkg-1", "package.json"),
        JSON.stringify({
          name: "pkg-1",
          version: "1.0.0",
          dependencies: {
            "a-dep": "1.0.1",
            "pkg-2": "workspace:",
            "@types/is-number": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "pkg-2", "package.json"),
        JSON.stringify({
          name: "pkg-2",
          version: "1.0.0",
          dependencies: {
            "b-dep-a": "1.0.0",
          },
        }),
      ),
    ]);

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(existsSync(join(packageDir, "node_modules", "pkg-1"))).toBeFalse();
    expect(readlinkSync(join(packageDir, "pkg-1", "node_modules", "pkg-2"))).toBe(join("..", "..", "pkg-2"));
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
    );

    expect(await readdirSorted(join(packageDir, "pkg-1", "node_modules"))).toEqual(["@types", "a-dep", "pkg-2"]);
    expect(await readdirSorted(join(packageDir, "pkg-2", "node_modules"))).toEqual(["b-dep-a"]);
    expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual([
      "@types+is-number@1.0.0",
      "a-dep-b@1.0.0",
      "a-dep@1.0.1",
      "b-dep-a@1.0.0",
      "no-deps@1.0.0",
      "node_modules",
    ]);

    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("workspace self dependencies create symlinks", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "monorepo-workspace-self-dep",
          workspaces: ["packages/*"],
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            pkg1: "workspace:*",
          },
        }),
        "packages/pkg2/package.json": JSON.stringify({
          name: "pkg2",
          dependencies: {
            "pkg1": "workspace:*",
            "pkg2": "workspace:*",
          },
        }),
        "packages/pkg3/package.json": JSON.stringify({
          name: "pkg3",
          dependencies: {
            "different-name": "workspace:.",
          },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        file(join(packageDir, "packages", "pkg1", "node_modules", "pkg1", "package.json")).json(),
        file(join(packageDir, "packages", "pkg2", "node_modules", "pkg1", "package.json")).json(),
        file(join(packageDir, "packages", "pkg2", "node_modules", "pkg2", "package.json")).json(),
        file(join(packageDir, "packages", "pkg3", "node_modules", "different-name", "package.json")).json(),
      ]),
    ).toEqual([
      [".bun"],
      { name: "pkg1", dependencies: { pkg1: "workspace:*" } },
      { name: "pkg1", dependencies: { pkg1: "workspace:*" } },
      { name: "pkg2", dependencies: { pkg1: "workspace:*", pkg2: "workspace:*" } },
      { name: "pkg3", dependencies: { "different-name": "workspace:." } },
    ]);
  });
});

describe.concurrent("lifecycle scripts of workspace members", () => {
  // The registry package one-fixed-dep depends on no-deps@1.0.0, which resolves to the member.
  // The root links its bins after one-fixed-dep, so the old order did not depend on timing.
  test.each(["preinstall", "install", "postinstall", "prepare"])(
    "%s can run the bin of a root dependency that the member does not declare",
    async hook => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "root",
            workspaces: ["packages/*"],
            dependencies: { "one-fixed-dep": "1.0.0" },
            devDependencies: { "what-bin": "1.0.0" },
          }),
          "packages/no-deps/package.json": JSON.stringify({
            name: "no-deps",
            version: "1.0.0",
            scripts: { [hook]: "what-bin" },
          }),
        },
      });

      await runBunInstall(installEnv(packageDir), packageDir);

      expect(
        readlinkSync(join(packageDir, "node_modules", ".bun", "one-fixed-dep@1.0.0", "node_modules", "no-deps")),
      ).toBe(join("..", "..", "..", "..", "packages", "no-deps"));
      expect(await file(join(packageDir, "packages", "no-deps", "what-bin.txt")).text()).toBe("what-bin@1.0.0");
    },
  );

  test("run after the lifecycle scripts of the root's dependencies", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { "lifecycle-postinstall": "1.0.0" },
          trustedDependencies: ["lifecycle-postinstall"],
        }),
        // The postinstall script of lifecycle-postinstall writes postinstall.txt.
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: { postinstall: "cp ../../node_modules/lifecycle-postinstall/postinstall.txt dependency-script.txt" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await file(join(packageDir, "packages", "pkg1", "dependency-script.txt")).text()).toBe("postinstall!");
  });

  test("can read a root dependency on an install from bun.lock with a cold cache", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { "no-deps": "1.0.0" },
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: { postinstall: "cp ../../node_modules/no-deps/package.json no-deps.json" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir, { packages: ["--ignore-scripts"] });
    await Promise.all([
      rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
      rm(join(packageDir, ".bun-cache"), { recursive: true, force: true }),
    ]);
    await runBunInstall(installEnv(packageDir), packageDir, { frozenLockfile: true });

    expect(await file(join(packageDir, "packages", "pkg1", "no-deps.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("run before the lifecycle scripts of the root", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          scripts: { postinstall: "cp packages/pkg1/built.txt built.txt" },
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: { postinstall: `${bunExe()} build.js` },
        }),
        "packages/pkg1/build.js": `require("fs").writeFileSync("built.txt", "built");`,
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await file(join(packageDir, "built.txt")).text()).toBe("built");
  });

  // The member's script writes dist/no-deps-cli. A dependent can link the bin only after that.
  test.each([
    { form: "bin", hook: "preinstall", bin: { bin: { "no-deps-cli": "dist/no-deps-cli" } }, prebuilt: false },
    { form: "bin", hook: "postinstall", bin: { bin: { "no-deps-cli": "dist/no-deps-cli" } }, prebuilt: false },
    { form: "directories.bin", hook: "postinstall", bin: { directories: { bin: "dist" } }, prebuilt: false },
    { form: "replaced bin", hook: "postinstall", bin: { bin: { "no-deps-cli": "dist/no-deps-cli" } }, prebuilt: true },
  ])(
    "a member's $form written by its $hook is linked for every dependent in the same install",
    async ({ hook, bin, prebuilt }) => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "root",
            workspaces: ["packages/*"],
            dependencies: { "no-deps": "workspace:*", "one-fixed-dep": "1.0.0" },
          }),
          "packages/no-deps/package.json": JSON.stringify({
            name: "no-deps",
            version: "1.0.0",
            ...bin,
            scripts: { [hook]: "rm -rf dist && mkdir dist && cp cli.js dist/no-deps-cli" },
          }),
          "packages/no-deps/cli.js": "#!/usr/bin/env node\n",
          ...(prebuilt ? { "packages/no-deps/dist/no-deps-cli": "#!/usr/bin/env node\n" } : {}),
          "packages/pkg1/package.json": JSON.stringify({
            name: "pkg1",
            version: "1.0.0",
            dependencies: { "no-deps": "workspace:*" },
          }),
        },
      });
      const bins = async () => ({
        root: await readdirSorted(join(packageDir, "node_modules", ".bin")),
        member: await readdirSorted(join(packageDir, "packages", "pkg1", "node_modules", ".bin")),
        registryPackage: await readdirSorted(
          join(packageDir, "node_modules", ".bun", "one-fixed-dep@1.0.0", "node_modules", ".bin"),
        ),
      });
      const names = isWindows ? ["no-deps-cli.bunx", "no-deps-cli.exe"] : ["no-deps-cli"];

      await runBunInstall(installEnv(packageDir), packageDir);

      expect(await bins()).toEqual({ root: names, member: names, registryPackage: names });
      if (!isWindows) {
        // The script writes the file without the execute bit. The linker sets the bit when it links the bin.
        expect(statSync(join(packageDir, "packages", "no-deps", "dist", "no-deps-cli")).mode & 0o100).toBe(0o100);
      }

      await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

      expect(await bins()).toEqual({ root: names, member: names, registryPackage: names });
    },
  );

  // npm runs the preinstall of every member, links the bins, then runs the other scripts. Here (and
  // with the hoisted linker) each member runs its scripts in one go, and the bins that the scripts
  // wrote are linked after the last one.
  test.todo("postinstall can run a bin that the preinstall of another member writes", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          bin: { "lib-cli": "dist/cli.js" },
          scripts: { preinstall: "mkdir dist && cp cli.js dist/cli.js" },
        }),
        "packages/lib/cli.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("lib-cli.txt", "lib-cli");`,
        "packages/app/package.json": JSON.stringify({
          name: "app",
          version: "1.0.0",
          dependencies: { lib: "workspace:*" },
          scripts: { postinstall: "lib-cli" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await file(join(packageDir, "packages", "app", "lib-cli.txt")).text()).toBe("lib-cli");
  });

  // The script of lib is slow to start, so app finds built.txt only if it waits for lib.
  const build = `require("fs").writeFileSync("built.txt", "built");`;
  test.each([
    {
      shape: "a member",
      members: { app: { lib: "workspace:*" }, lib: {} },
    },
    {
      shape: "a member through a member without scripts",
      members: { app: { mid: "workspace:*" }, mid: { lib: "workspace:*" }, lib: {} },
    },
    {
      shape: "a member in a dependency cycle",
      members: { app: { lib: "workspace:*" }, lib: { other: "workspace:*" }, other: { lib: "workspace:*" } },
    },
  ])("--filter: run after the scripts of $shape that the member depends on", async ({ members }) => {
    const scripts: Record<string, string | undefined> = {
      app: "cp ../lib/built.txt built.txt",
      lib: `${bunExe()} build.js`,
      other: "echo started > started.txt",
    };
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/lib/build.js": build,
        ...Object.fromEntries(
          Object.entries(members).map(([name, dependencies]) => [
            `packages/${name}/package.json`,
            JSON.stringify({
              name,
              version: "1.0.0",
              dependencies,
              scripts: scripts[name] ? { postinstall: scripts[name] } : undefined,
            }),
          ]),
        ),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir, { packages: ["--filter", "app"] });

    expect(await file(join(packageDir, "packages", "app", "built.txt")).text()).toBe("built");
  });

  test("a failing script fails the install and keeps the member", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: { postinstall: "exit 3" },
        }),
      },
    });

    const { err } = await runBunInstall(installEnv(packageDir), packageDir, {
      allowErrors: true,
      savesLockfile: false,
      expectedExitCode: 3,
    });

    expect(err).toContain('error: postinstall script from "pkg1" exited with 3');
    expect(existsSync(join(packageDir, "packages", "pkg1", "package.json"))).toBe(true);
  });

  test("a failing script of an optional member ends the member's other scripts, not the install", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          version: "1.0.0",
          scripts: { preinstall: "exit 3", postinstall: "echo started > ../app/lib-postinstall.txt" },
        }),
        // With the filter, this optional edge is the only edge to lib.
        "packages/app/package.json": JSON.stringify({
          name: "app",
          version: "1.0.0",
          optionalDependencies: { lib: "workspace:*" },
          scripts: { postinstall: "echo started > started.txt" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir, { packages: ["--filter", "app"] });

    expect({
      app: existsSync(join(packageDir, "packages", "app", "started.txt")),
      libPostinstall: existsSync(join(packageDir, "packages", "app", "lib-postinstall.txt")),
      lib: existsSync(join(packageDir, "packages", "lib", "package.json")),
    }).toEqual({ app: true, libPostinstall: false, lib: true });
  });

  test("do not run with --ignore-scripts", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: { postinstall: "echo started > started.txt" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir, { packages: ["--ignore-scripts"] });

    expect(existsSync(join(packageDir, "packages", "pkg1", "started.txt"))).toBe(false);
  });

  test("--concurrent-scripts limits them", async () => {
    // Each script fails if another one is running.
    const alone = `${bunExe()} ../../alone.js`;
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "alone.js": `
          const fs = require("fs");
          fs.mkdirSync("../../running");
          for (let i = 0; i < 50; i++) fs.readdirSync("../..");
          fs.rmdirSync("../../running");
          fs.writeFileSync("ran.txt", "ran");`,
        "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", scripts: { postinstall: alone } }),
        "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0", scripts: { postinstall: alone } }),
        "packages/c/package.json": JSON.stringify({ name: "c", version: "1.0.0", scripts: { postinstall: alone } }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir, { packages: ["--concurrent-scripts=1"] });

    expect(["a", "b", "c"].map(name => existsSync(join(packageDir, "packages", name, "ran.txt")))).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe.concurrent("optional peers", () => {
  const tests = [
    // non-optional versions
    {
      name: "non-optional transitive only",
      deps: [{ "one-optional-peer-dep": "1.0.1" }, { "one-optional-peer-dep": "1.0.1" }],
      expected: ["no-deps@1.1.0", "node_modules", "one-optional-peer-dep@1.0.1+7ff199101204a65d"],
    },
    {
      name: "non-optional direct pkg1",
      deps: [{ "one-optional-peer-dep": "1.0.1", "no-deps": "1.0.1" }, { "one-optional-peer-dep": "1.0.1" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.1+f8a822eca018d0a1"],
    },
    {
      name: "non-optional direct pkg2",
      deps: [{ "one-optional-peer-dep": "1.0.1" }, { "one-optional-peer-dep": "1.0.1", "no-deps": "1.0.1" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.1+f8a822eca018d0a1"],
    },
    // optional versions
    {
      name: "optional transitive only",
      deps: [{ "one-optional-peer-dep": "1.0.2" }, { "one-optional-peer-dep": "1.0.2" }],
      expected: ["node_modules", "one-optional-peer-dep@1.0.2"],
    },
    {
      name: "optional direct pkg1",
      deps: [{ "one-optional-peer-dep": "1.0.2", "no-deps": "1.0.1" }, { "one-optional-peer-dep": "1.0.2" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.2+f8a822eca018d0a1"],
    },
    {
      name: "optional direct pkg2",
      deps: [{ "one-optional-peer-dep": "1.0.2" }, { "one-optional-peer-dep": "1.0.2", "no-deps": "1.0.1" }],
      expected: ["no-deps@1.0.1", "node_modules", "one-optional-peer-dep@1.0.2+f8a822eca018d0a1"],
    },
  ];

  for (const { deps, expected, name } of tests) {
    test(`will resolve if available through another importer (${name})`, async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated" },
        files: {
          "package.json": JSON.stringify({
            name: "optional-peers",
            workspaces: ["packages/*"],
          }),
          "packages/pkg1/package.json": JSON.stringify({
            name: "pkg1",
            dependencies: deps[0],
          }),
          "packages/pkg2/package.json": JSON.stringify({
            name: "pkg2",
            dependencies: deps[1],
          }),
        },
      });

      async function checkInstall() {
        const { exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          env: installEnv(packageDir),
          stdout: "ignore",
          stderr: "ignore",
        });

        expect(await exited).toBe(0);
        expect(await readdirSorted(join(packageDir, "node_modules/.bun"))).toEqual(expected);
      }

      // without lockfile
      // without node_modules
      await checkInstall();

      // with lockfile
      // without node_modules
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await checkInstall();

      // without lockfile
      // with node_modules
      await rm(join(packageDir, "bun.lock"), { force: true });
      await checkInstall();

      // with lockfile
      // with node_modules
      await checkInstall();
    });
  }

  test("successfully resolves optional peer with nested package", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "optional-peer-nested-resolve",
          dependencies: {
            "one-one-dep": "1.0.0",
          },
          peerDependencies: {
            "one-dep": "1.0.0",
          },
          peerDependenciesMeta: {
            "one-dep": {
              optional: true,
            },
          },
        }),
      },
    });

    async function checkInstall() {
      let { exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        env: installEnv(packageDir),
      });
      expect(await exited).toBe(0);

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "one-dep", "one-one-dep"]);
      expect(await readdirSorted(join(packageDir, "node_modules/.bun"))).toEqual([
        "no-deps@1.0.1",
        "node_modules",
        "one-dep@1.0.0",
        "one-one-dep@1.0.0",
      ]);
    }

    await checkInstall();
    await checkInstall();
  });
});

// `peer-deps@1.0.0` has `peerDependencies: { "no-deps": "*" }`, so each workspace gets a store entry
// of its own. The packages are peer-deps@1.0.0, no-deps@1.0.0 and no-deps@1.1.0.
test.concurrent("the store entries of one package count as one installed package", async () => {
  const member = (name: string, noDeps: string) =>
    JSON.stringify({ name, version: "1.0.0", dependencies: { "peer-deps": "1.0.0", "no-deps": noDeps } });
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({ name: "summary-peer-variants", workspaces: ["packages/*"] }),
      "packages/pkg-a/package.json": member("pkg-a", "1.0.0"),
      "packages/pkg-b/package.json": member("pkg-b", "1.1.0"),
    },
  });

  const { out } = await runBunInstall(installEnv(packageDir), packageDir);

  expect(
    readdirSync(join(packageDir, "node_modules", ".bun")).filter(entry => entry.startsWith("peer-deps@")),
  ).toHaveLength(2);
  expect(out).toMatch(/\b3 packages installed\b/);
});

// https://github.com/oven-sh/bun/issues/28147
test.concurrent("patched package shared by multiple peer variants is materialized into the cache once", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // `peer-deps@1.0.0` has `peerDependencies: { "no-deps": "*" }`. Giving each
  // workspace a different `no-deps` version forces one isolated store variant
  // of `peer-deps` per workspace, all sharing one patched cache directory.
  const noDepsVersions = ["1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  await write(
    packageJson,
    JSON.stringify({
      name: "patched-peer-variants",
      workspaces: ["packages/*"],
      patchedDependencies: {
        "peer-deps@1.0.0": "patches/peer-deps@1.0.0.patch",
      },
    }),
  );
  await write(
    join(packageDir, "patches", "peer-deps@1.0.0.patch"),
    `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`,
  );
  for (const version of noDepsVersions) {
    await write(
      join(packageDir, "packages", `pkg-${version}`, "package.json"),
      JSON.stringify({
        name: `pkg-${version}`,
        version: "1.0.0",
        dependencies: {
          "peer-deps": "1.0.0",
          "no-deps": version,
        },
      }),
    );
  }

  // CI exports BUN_INSTALL_CACHE_DIR, which overrides bunfig's `cache`. Pin it
  // so the patched cache directory is created where the assertions look.
  const cacheDir = join(packageDir, ".bun-cache");

  // Force the hardlink backend so the inode assertions below hold on every
  // platform (macOS defaults to clonefile, which copies).
  async function install() {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--backend", "hardlink"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("error:");
    expect(out).toContain("packages installed");
    expect(exitCode).toBe(0);
  }

  async function checkInstall() {
    const storeDirs = (await readdirSorted(join(packageDir, "node_modules", ".bun"))).filter(dir =>
      dir.startsWith("peer-deps@1.0.0"),
    );
    expect(storeDirs.length).toBe(noDepsVersions.length);

    // Exactly one patched cache directory exists for the package.
    const cacheDirs = (await readdirSorted(cacheDir)).filter(
      dir => dir.startsWith("peer-deps@1.0.0") && dir.includes("_patch_hash="),
    );
    expect(cacheDirs.length).toBe(1);
    const cacheFile = join(cacheDir, cacheDirs[0], "index.js");

    // The patch is applied in every variant, and every variant is hardlinked
    // from the single patched cache materialization. Before the fix each
    // variant re-applied the patch, replacing the shared cache directory the
    // previous variant was concurrently hardlinking from (EPERM on Windows,
    // divergent inodes on POSIX).
    const inodes = new Set<number>();
    for (const storeDir of storeDirs) {
      const pkgDir = join(packageDir, "node_modules", ".bun", storeDir, "node_modules", "peer-deps");
      expect(await file(join(pkgDir, "patched.txt")).text()).toBe("hello world\n");
      inodes.add(statSync(join(pkgDir, "index.js")).ino);
    }
    inodes.add(statSync(cacheFile).ino);
    expect(inodes.size).toBe(1);
  }

  await install();
  await checkInstall();

  // Reinstall with a warm cache and no node_modules: the patched cache
  // directory already exists and must not be rebuilt per variant.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await install();
  await checkInstall();
});

test.concurrent("adding, removing and re-adding a patch for an npm dependency", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  const rootPackageJson = { name: "npm-patch-cycle", dependencies: { "no-deps": "1.0.0" } };
  const patched = {
    ...rootPackageJson,
    patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" },
  };
  await write(
    join(packageDir, "patches", "no-deps@1.0.0.patch"),
    `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`,
  );
  const patchedFile = join(packageDir, "node_modules", "no-deps", "patched.txt");

  const steps = [
    [rootPackageJson, false],
    [patched, true],
    [rootPackageJson, false],
    [patched, true],
  ] as const;
  for (const [step, [manifest, expectPatched]] of steps.entries()) {
    await write(packageJson, JSON.stringify(manifest));
    // hardlink (the Linux default) installs into the store entry in place; clonefile replaces it.
    await using proc = spawn({
      cmd: [bunExe(), "install", "--backend", "hardlink"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect({ step, patched: existsSync(patchedFile) }).toEqual({ step, patched: expectPatched });
  }
});

// Adding a patchedDependencies entry for a github: dependency of a workspace
// member deadlocked `bun install` forever with the isolated linker:
// re-resolution re-downloaded the github tarball, and the install phase then
// re-enqueued the same tarball task and parked the store entry on the
// completed task's already-drained callback list, so the pending-task count
// never reached zero.
test.concurrent("adding and removing a patch for a github dependency in a workspace completes", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  const tarball = await githubTarball("testowner-testrepo-aaaaaaa", {
    "package.json": JSON.stringify({ name: "gh-dep", version: "1.0.0" }),
    "index.js": 'console.log("original");\n',
  });

  using server = Bun.serve({
    port: 0,
    fetch: () => new Response(tarball, { headers: { "Content-Type": "application/gzip" } }),
  });

  const env = {
    ...bunEnv,
    GITHUB_API_URL: `http://localhost:${server.port}`,
    // CI exports BUN_INSTALL_CACHE_DIR; pin it so this test's cache state is
    // its own.
    BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
  };

  async function install() {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  const rootPackageJson = {
    name: "patched-github-workspace",
    workspaces: ["packages/*"],
  };
  await write(packageJson, JSON.stringify(rootPackageJson));
  await write(
    join(packageDir, "packages", "member", "package.json"),
    JSON.stringify({
      name: "member",
      version: "1.0.0",
      dependencies: {
        "gh-dep": "github:testowner/testrepo#aaaaaaa",
      },
    }),
  );
  await write(
    join(packageDir, "patches", "gh-dep.patch"),
    `diff --git a/index.js b/index.js
index 1f0e8b9f1f9a56799cdbc1a5a2f8cf9f9a3b2f1c..2f0e8b9f1f9a56799cdbc1a5a2f8cf9f9a3b2f1d 100644
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-console.log("original");
+console.log("patched");
`,
  );

  const installedIndexJs = file(join(packageDir, "packages", "member", "node_modules", "gh-dep", "index.js"));

  await install();
  expect(await installedIndexJs.text()).toBe('console.log("original");\n');

  // Adding the patch triggers a re-resolution; this install hung forever
  // before the fix.
  await write(
    packageJson,
    JSON.stringify({
      ...rootPackageJson,
      patchedDependencies: {
        "gh-dep@github:testowner/testrepo#aaaaaaa": "patches/gh-dep.patch",
      },
    }),
  );
  await install();
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

  // Cold cache with the patch still in the lockfile: the install phase itself
  // downloads the tarball and applies the patch after extraction.
  await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "packages", "member", "node_modules"), { recursive: true, force: true });
  await install();
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

  // Removing the patch re-resolves again and rebuilds the store entry from
  // the unpatched cache folder (the PatchInfo::Remove path, which hung the
  // same way).
  await write(packageJson, JSON.stringify(rootPackageJson));
  await install();
  expect(await installedIndexJs.text()).toBe('console.log("original");\n');

  // Re-adding the same patch must patch again.
  await write(
    packageJson,
    JSON.stringify({
      ...rootPackageJson,
      patchedDependencies: {
        "gh-dep@github:testowner/testrepo#aaaaaaa": "patches/gh-dep.patch",
      },
    }),
  );
  await install();
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');
});

// Same deadlock through the git: task-id space (clone + checkout tasks
// instead of a tarball download). The repo is served over git's dumb HTTP
// protocol: after `git update-server-info`, a bare repo is plain static
// files. Requires the git executable to build the fixture repository.
const gitExecutable = Bun.which("git");
test.concurrent.skipIf(!gitExecutable)(
  "adding and removing a patch for a git dependency in a workspace completes",
  async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    const srcDir = join(packageDir, "git-src");
    const bareDir = join(packageDir, "repo.git");
    // Isolate git from system/global config (e.g. core.autocrlf on Windows
    // would rewrite the checked-out file contents this test asserts on).
    const gitConfigEnv = {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(packageDir, "gitconfig"),
    };
    const gitEnv = {
      ...bunEnv,
      ...gitConfigEnv,
      GIT_AUTHOR_NAME: "bun-test",
      GIT_AUTHOR_EMAIL: "test@bun.sh",
      GIT_COMMITTER_NAME: "bun-test",
      GIT_COMMITTER_EMAIL: "test@bun.sh",
    };
    async function git(args: string[], cwd: string): Promise<string> {
      await using proc = spawn({ cmd: [gitExecutable!, ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("fatal:");
      expect(exitCode).toBe(0);
      return out;
    }

    await write(join(packageDir, "gitconfig"), "[core]\n\tautocrlf = false\n");
    await write(join(srcDir, "package.json"), JSON.stringify({ name: "git-dep", version: "1.0.0" }));
    await write(join(srcDir, "index.js"), 'console.log("original");\n');
    await git(["init", "-q"], srcDir);
    await git(["add", "-A"], srcDir);
    await git(["commit", "-qm", "init"], srcDir);
    const sha = (await git(["rev-parse", "HEAD"], srcDir)).trim();
    await git(["clone", "-q", "--bare", srcDir, bareDir], packageDir);
    await git(["update-server-info"], bareDir);

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (!pathname.startsWith("/repo.git/")) return new Response("not found", { status: 404 });
        const f = file(join(bareDir, pathname.slice("/repo.git/".length)));
        return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
      },
    });
    const repoUrl = `git+http://127.0.0.1:${server.port}/repo.git`;

    const env = {
      ...bunEnv,
      ...gitConfigEnv,
      BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
    };

    async function install() {
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    const rootPackageJson = {
      name: "patched-git-workspace",
      workspaces: ["packages/*"],
    };
    await write(packageJson, JSON.stringify(rootPackageJson));
    await write(
      join(packageDir, "packages", "member", "package.json"),
      JSON.stringify({
        name: "member",
        version: "1.0.0",
        dependencies: {
          "git-dep": repoUrl,
        },
      }),
    );
    await write(
      join(packageDir, "patches", "git-dep.patch"),
      `diff --git a/index.js b/index.js
index 1f0e8b9f1f9a56799cdbc1a5a2f8cf9f9a3b2f1c..2f0e8b9f1f9a56799cdbc1a5a2f8cf9f9a3b2f1d 100644
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-console.log("original");
+console.log("patched");
`,
    );

    const installedIndexJs = file(join(packageDir, "packages", "member", "node_modules", "git-dep", "index.js"));

    await install();
    expect(await installedIndexJs.text()).toBe('console.log("original");\n');

    // The patchedDependencies key must carry the resolved commit; a key without
    // it is silently ignored, which the patched-content assertion would catch.
    await write(
      packageJson,
      JSON.stringify({
        ...rootPackageJson,
        patchedDependencies: {
          [`git-dep@${repoUrl}#${sha}`]: "patches/git-dep.patch",
        },
      }),
    );
    await install();
    expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

    // Cold cache with the patch still in the lockfile: the install phase
    // clones and checks out itself, applying the patch after the checkout.
    await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "packages", "member", "node_modules"), { recursive: true, force: true });
    await install();
    expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

    await write(packageJson, JSON.stringify(rootPackageJson));
    await install();
    expect(await installedIndexJs.text()).toBe('console.log("original");\n');

    // Re-adding the same patch must patch again.
    await write(
      packageJson,
      JSON.stringify({
        ...rootPackageJson,
        patchedDependencies: {
          [`git-dep@${repoUrl}#${sha}`]: "patches/git-dep.patch",
        },
      }),
    );
    await install();
    expect(await installedIndexJs.text()).toBe('console.log("patched");\n');
  },
);

// A tarball that cannot even be requested (here: a URL that is not http) hung
// `bun install` forever with the isolated linker. Creating the download task
// fails after the task id is recorded as created, so every later request for
// the same tarball parked its store entry behind a task that does not exist.
describe.concurrent("tarball whose download task cannot be created", () => {
  test("second store entry of the package: fails instead of hanging", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    // `peer-deps@1.0.0` has a peer on `no-deps`. Two workspaces with different
    // `no-deps` versions give it two store entries sharing one tarball.
    await write(packageJson, JSON.stringify({ name: "invalid-tarball-url", workspaces: ["packages/*"] }));
    for (const version of ["1.0.0", "1.0.1"]) {
      await write(
        join(packageDir, "packages", `pkg-${version}`, "package.json"),
        JSON.stringify({
          name: `pkg-${version}`,
          version: "1.0.0",
          dependencies: { "peer-deps": "1.0.0", "no-deps": version },
        }),
      );
    }

    async function install(cacheDir: string) {
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        // CI exports BUN_INSTALL_CACHE_DIR; pin it so the second install really
        // has to download `peer-deps` again.
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const first = await install(join(packageDir, ".bun-cache-1"));
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);
    expect(
      (await readdirSorted(join(packageDir, "node_modules", ".bun"))).filter(entry => entry.startsWith("peer-deps@")),
    ).toHaveLength(2);

    const lockfile = join(packageDir, "bun.lock");
    const lockfileBefore = await file(lockfile).text();
    const lockfileAfter = lockfileBefore.replace(
      /("peer-deps@1\.0\.0", )"[^"]*"/,
      '$1"ftp://localhost/peer-deps/-/peer-deps-1.0.0.tgz"',
    );
    expect(lockfileAfter).not.toBe(lockfileBefore);
    await write(lockfile, lockfileAfter);
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    // Empty cache: the install phase requests the tarball for both entries.
    const second = await install(join(packageDir, ".bun-cache-2"));
    expect(second.stderr).toContain("failed to enqueue package for download: peer-deps@1.0.0");
    expect(second.stdout).not.toContain("packages installed");
    expect(second.exitCode).toBe(1);
  });

  test("package resolved from the manifest cache: fails instead of hanging", async () => {
    // The first install fetches the manifest, caches it, and fails when it
    // requests the tarball while resolving. The second install resolves from
    // the cached manifest. That request fails again, and this time the
    // install phase asks for the same tarball once more.
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname !== "/bad-tarball-url") return new Response("Not found", { status: 404 });
        return Response.json(
          {
            name: "bad-tarball-url",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "bad-tarball-url",
                version: "1.0.0",
                dist: { tarball: "ftp://localhost/bad-tarball-url/-/bad-tarball-url-1.0.0.tgz" },
              },
            },
          },
          { headers: { "Cache-Control": "public, max-age=300" } },
        );
      },
    });

    using packageDir = tempDir("manifest-cache-bad-tarball-", {
      "package.json": JSON.stringify({
        name: "manifest-cache-bad-tarball",
        dependencies: { "bad-tarball-url": "1.0.0" },
      }),
      "bunfig.toml": `[install]\nregistry = "http://localhost:${server.port}/"\nlinker = "isolated"\n`,
    });

    async function install() {
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: String(packageDir),
        // One cache for both installs, separate from the other tests' caches.
        env: installEnv(String(packageDir)),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const expectedError = 'Expected tarball URL to start with https:// or http://, got "ftp://localhost/';
    const first = await install();
    expect(first.stderr).toContain(expectedError);
    expect(first.exitCode).toBe(1);

    const second = await install();
    expect(second.stderr).toContain(expectedError);
    expect(second.stdout).not.toContain("packages installed");
    expect(second.exitCode).toBe(1);
  });
});

for (const backend of ["clonefile", "hardlink", "copyfile"]) {
  test.concurrent(`isolated install with backend: ${backend}`, async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await Promise.all([
      write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-backend",
          dependencies: {
            "no-deps": "1.0.0",
            "alias-loop-2": "1.0.0",
            "alias-loop-1": "1.0.0",
            "1-peer-dep-a": "1.0.0",
            "basic-1": "1.0.0",
            "is-number": "1.0.0",
            "file-dep": "file:./file-dep",
            "@scoped/file-dep": "file:./scoped-file-dep",
          },
        }),
      ),
      write(join(packageDir, "file-dep", "package.json"), JSON.stringify({ name: "file-dep", version: "1.0.0" })),
      write(
        join(packageDir, "file-dep", "dir1", "dir2", "dir3", "dir4", "dir5", "index.js"),
        "module.exports = 'hello from file-dep';",
      ),
      write(
        join(packageDir, "scoped-file-dep", "package.json"),
        JSON.stringify({ name: "@scoped/file-dep", version: "1.0.0" }),
      ),
    ]);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--backend", backend],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exited).toBe(0);
    const out = await stdout.text();
    const err = await stderr.text();

    expect(err).not.toContain("error");
    expect(err).not.toContain("warning");

    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });

    expect(readlinkSync(join(packageDir, "node_modules", "file-dep"))).toBe(
      join(".bun", "file-dep@file+file-dep", "node_modules", "file-dep"),
    );

    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "file-dep@file+file-dep", "node_modules", "file-dep", "package.json"),
      ).json(),
    ).toEqual({
      name: "file-dep",
      version: "1.0.0",
    });

    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "file-dep@file+file-dep",
          "node_modules",
          "file-dep",
          "dir1",
          "dir2",
          "dir3",
          "dir4",
          "dir5",
          "index.js",
        ),
      ).text(),
    ).toBe("module.exports = 'hello from file-dep';");

    expect(readlinkSync(join(packageDir, "node_modules", "@scoped", "file-dep"))).toBe(
      join("..", ".bun", "@scoped+file-dep@file+scoped-file-dep", "node_modules", "@scoped", "file-dep"),
    );

    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "@scoped+file-dep@file+scoped-file-dep",
          "node_modules",
          "@scoped",
          "file-dep",
          "package.json",
        ),
      ).json(),
    ).toEqual({
      name: "@scoped/file-dep",
      version: "1.0.0",
    });
  });
}

test.concurrent("ranged peer dependency resolution is stable across installs from bun.lock", async () => {
  // `peer-deps-fixed` has a peer on `no-deps@^1.0.0`. The graph contains both
  // no-deps@1.0.1 (exact pin via normal-dep-and-dev-dep, hoisted to the root
  // of the saved tree) and no-deps@1.1.0 (exact pin via the `nd11` alias). The
  // fresh resolve binds the peer edge to the highest satisfying version (1.1.0)
  // in its deferred-peer phase; reloading bun.lock used to re-derive the edge
  // from the saved tree paths instead, rebinding it to the hoisted 1.0.1.
  // That silently changed the runtime dependency tree on the second install
  // and re-keyed the isolated store entry (`+<peer hash>` suffix) on every
  // warm install.
  //
  // Both copies are exact pins so that the graph does not depend on whether
  // the resolver dedupes a range like two-range-deps' `no-deps@^1.0.0` onto
  // the 1.0.1 pin. Today that depends on which manifest the registry answers
  // first: the range only adds 1.1.0 when it is resolved before 1.0.1 is
  // appended.
  const { packageJson, packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "stable-ranged-peers",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "normal-dep-and-dev-dep": "1.0.0",
        "nd11": "npm:no-deps@1.1.0",
      },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  // 1.0.1 holds the `no-deps` path the peer edge resolves through; the
  // edge itself gets no path of its own, which is what made the load-time
  // path walk rebind it.
  expect(await savedTreeCopiesOf(packageDir, "no-deps")).toEqual({
    "nd11": "no-deps@1.1.0",
    "no-deps": "no-deps@1.0.1",
  });

  const bunDir = join(packageDir, "node_modules", ".bun");
  // highest satisfying ^1.0.0 in the graph; `toContain` prints the full
  // listing when the entry is missing or keyed with a different peer hash
  const entryName = "peer-deps-fixed@1.0.0+7ff199101204a65d";
  expect(await readdirSorted(bunDir)).toContain(entryName);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });

  // reinstall from bun.lock: same peer variant, same resolved version
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual([entryName]);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });
});

test.concurrent(
  "ranged peer rebinds in the install that adds a higher satisfying version, not the one after",
  async () => {
    // The first install binds peer-deps-fixed's `no-deps@^1.0.0` to 1.0.0, the
    // only candidate. Adding `one-dep` brings in no-deps@1.0.1; loading the
    // lockfile that install writes binds the edge to 1.0.1 (highest satisfying),
    // so that install has to bind it the same way itself. Otherwise it links the
    // 1.0.0 peer variant and the next `bun install`, with nothing changed,
    // re-keys the store entry.
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });
    const bunDir = join(packageDir, "node_modules", ".bun");
    const peerEntries = async () => (await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"));
    const peerNoDepsVersion = async (entry: string) =>
      ((await file(join(bunDir, entry, "node_modules", "no-deps", "package.json")).json()) as { version: string })
        .version;

    await write(
      packageJson,
      JSON.stringify({
        name: "rebind-ranged-peer",
        dependencies: { "peer-deps-fixed": "1.0.0", "one-fixed-dep": "1.0.0" },
      }),
    );
    await runBunInstall(installEnv(packageDir), packageDir);
    const [initialEntry] = await peerEntries();
    expect(await peerNoDepsVersion(initialEntry)).toBe("1.0.0");

    await write(
      packageJson,
      JSON.stringify({
        name: "rebind-ranged-peer",
        dependencies: { "peer-deps-fixed": "1.0.0", "one-fixed-dep": "1.0.0", "one-dep": "1.0.0" },
      }),
    );
    await runBunInstall(installEnv(packageDir), packageDir);
    const entries = await peerEntries();
    const lockfile = await file(join(packageDir, "bun.lock")).text();

    const { out, err } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(out).toContain("(no changes)");
    expect(err).not.toContain("Saved lockfile");
    expect(await peerEntries()).toEqual(entries);
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(lockfile);

    // The old variant stays in the store until `bun prune`, like after any peer bump.
    const [rebound, ...rest] = entries.filter(entry => entry !== initialEntry);
    expect(rest).toEqual([]);
    expect(await peerNoDepsVersion(rebound)).toBe("1.0.1");
    expect(readlinkSync(join(packageDir, "node_modules", "peer-deps-fixed"))).toBe(
      join(".bun", rebound, "node_modules", "peer-deps-fixed"),
    );
  },
);

test.concurrent(
  "a ranged peer whose auto-installed version drops out of the saved tree is rebound before linking",
  async () => {
    // The first install auto-installs no-deps@1.1.0 for peer-deps-fixed's
    // `no-deps@^1.0.0`; nothing else depends on it. Adding one-dep pins
    // no-deps@1.0.1, which is hoisted to the root of the saved tree, so the
    // peer edge dedupes onto it and 1.1.0 is no longer written to bun.lock.
    // Reloading that bun.lock binds the edge to 1.0.1, so the install that
    // writes it has to link 1.0.1 as well, or the next install re-keys the
    // entry.
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "dropped-peer-target",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunDir = join(packageDir, "node_modules", ".bun");
    const autoInstalledEntry = "peer-deps-fixed@1.0.0+7ff199101204a65d";
    const reboundEntry = "peer-deps-fixed@1.0.0+f8a822eca018d0a1";
    expect(await readdirSorted(bunDir)).toContain(autoInstalledEntry);
    expect(
      await file(join(bunDir, autoInstalledEntry, "node_modules", "no-deps", "package.json")).json(),
    ).toMatchObject({
      version: "1.1.0",
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "dropped-peer-target",
        dependencies: {
          "one-dep": "1.0.0",
          "peer-deps-fixed": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunLock = await file(join(packageDir, "bun.lock")).text();
    expect(bunLock).toContain(`"no-deps": ["no-deps@1.0.1"`);
    expect(bunLock).not.toContain("no-deps@1.1.0");
    expect(await readlink(join(packageDir, "node_modules", "peer-deps-fixed"))).toBe(
      join(".bun", reboundEntry, "node_modules", "peer-deps-fixed"),
    );
    expect(await file(join(bunDir, reboundEntry, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
    const entries = await readdirSorted(bunDir);

    const { out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(out).toContain("(no changes)");
    expect(await readdirSorted(bunDir)).toEqual(entries);
    expect(await file(join(packageDir, "bun.lock")).text()).toBe(bunLock);
  },
);

test.concurrent("aliased peer dependency binds to its real package across installs from bun.lock", async () => {
  // The peer alias `no-deps` points at `npm:a-dep@^1.0.2` while the real
  // no-deps package (in two versions) is also in the graph. Loading bun.lock
  // must look the edge up under the aliased *real* name (a-dep) the way the
  // fresh resolver does; a lookup under the alias would find the real
  // no-deps packages, whose versions also satisfy ^1.0.2, and rebind the
  // edge to the wrong package.
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "aliased-peer-root",
        workspaces: ["packages/*"],
        dependencies: {
          "normal-dep-and-dev-dep": "1.0.0",
          "nd11": "npm:no-deps@1.1.0",
        },
      }),
      "packages/m/package.json": JSON.stringify({
        name: "m",
        version: "1.0.0",
        peerDependencies: { "no-deps": "npm:a-dep@^1.0.2" },
      }),
    },
  });

  await runBunInstall(installEnv(packageDir), packageDir);
  // no-deps@1.1.0 is the decoy: the only real no-deps version that satisfies
  // ^1.0.2, so a lookup under the alias name would rebind the edge to it
  expect(Object.values(await savedTreeCopiesOf(packageDir, "no-deps")).sort()).toEqual([
    "no-deps@1.0.1",
    "no-deps@1.1.0",
  ]);
  const aliasLink = join(packageDir, "packages", "m", "node_modules", "no-deps", "package.json");
  const fresh = await file(aliasLink).json();
  expect(fresh).toMatchObject({ name: "a-dep" });

  // reinstall from bun.lock: still the aliased package, same version
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "packages", "m", "node_modules"), { recursive: true, force: true });
  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
  expect(await file(aliasLink).json()).toEqual(fresh);
});

test.concurrent("optional ranged peer keeps its hoisted-tree binding across installs from bun.lock", async () => {
  // Optional peers never reach the fresh resolver's deferred-peer phase: it
  // returns before the version scan and the edge is bound to the
  // hoisted-tree sibling during tree resolution, which the printed tree's
  // path walk reproduces exactly. With both no-deps@1.0.1 and no-deps@1.1.0
  // in the graph, binding the optional peer by version on load would pick
  // the highest satisfying (1.1.0) while the fresh install bound the hoisted
  // 1.0.1, re-keying the entry on the first reinstall.
  const { packageJson, packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "stable-optional-peers",
      dependencies: {
        "one-optional-peer-dep": "1.0.2",
        "normal-dep-and-dev-dep": "1.0.0",
        "nd11": "npm:no-deps@1.1.0",
      },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  // 1.0.1 is the hoisted sibling the optional peer was bound to; 1.1.0 is
  // the higher version a version scan on load would pick instead
  expect(await savedTreeCopiesOf(packageDir, "no-deps")).toEqual({
    "nd11": "no-deps@1.1.0",
    "no-deps": "no-deps@1.0.1",
  });

  const bunDir = join(packageDir, "node_modules", ".bun");
  const freshEntries = (await readdirSorted(bunDir)).filter(e => e.startsWith("one-optional-peer-dep@"));
  expect(freshEntries).toHaveLength(1);
  // the hoisted candidate, not the highest satisfying (1.1.0)
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("one-optional-peer-dep@"))).toEqual(freshEntries);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });
});

test.concurrent("overridden peer dependency keeps the override across installs from bun.lock", async () => {
  // `overrides` rewrites the peer range before the fresh resolver's version
  // scan, binding the peer to no-deps@1.0.1 even though the graph also
  // contains no-deps@1.1.0 (via an override-exempt npm: alias). Loading
  // bun.lock must not re-filter candidates with the raw ^1.0.0 manifest
  // range, which the override replaced; that would rebind the edge to 1.1.0
  // and re-key the entry on the first reinstall.
  const { packageJson, packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "stable-overridden-peers",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "nd11": "npm:no-deps@1.1.0",
        // provides no-deps@1.0.1 so the overridden peer range resolves to an
        // installed package
        "normal-dep-and-dev-dep": "1.0.0",
      },
      overrides: { "no-deps": "1.0.1" },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const entryName = "peer-deps-fixed@1.0.0+f8a822eca018d0a1";
  // the override-exempt alias keeps the competing 1.1.0 candidate in the graph
  const aliasManifest = join(packageDir, "node_modules", "nd11", "package.json");
  expect(await file(aliasManifest).json()).toMatchObject({ name: "no-deps", version: "1.1.0" });
  expect(await readdirSorted(bunDir)).toContain(entryName);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

  expect(await file(aliasManifest).json()).toMatchObject({ name: "no-deps", version: "1.1.0" });
  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual([entryName]);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });
});

test.concurrent("peer satisfied by a workspace package keeps the workspace across installs from bun.lock", async () => {
  // The fresh resolver binds an npm-range peer to a same-named workspace
  // package before any deferral when linkWorkspacePackages is on and the
  // workspace version satisfies the range. The graph also contains npm
  // no-deps@1.0.1 (normal-dep-and-dev-dep's exact pin, which the workspace's
  // 1.0.0 cannot satisfy), and that version satisfies the peer's ^1.0.0 too;
  // loading bun.lock must not rebind the peer from the workspace to the npm
  // package through the version scan.
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "workspace-peer-root",
        workspaces: ["packages/*"],
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "normal-dep-and-dev-dep": "1.0.0",
        },
      }),
      "packages/no-deps/package.json": JSON.stringify({
        name: "no-deps",
        version: "1.0.0",
        workspaceMarker: true,
      }),
    },
  });

  await runBunInstall(installEnv(packageDir), packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const freshEntries = (await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"));
  expect(freshEntries).toHaveLength(1);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
    workspaceMarker: true,
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual(freshEntries);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
    workspaceMarker: true,
  });
});

// A workspace is one folder with one copy of each of its peers: what links it needs no copy per peer.
describe.concurrent("a registry package and a workspace that has a peer dependency", () => {
  const workspace = { name: "no-deps", version: "1.0.0", peerDependencies: { "a-dep": "*" } };

  test.each([
    { edge: "it depends on the workspace", app: { "one-range-dep": "1.0.0" }, own: {} },
    { edge: "the workspace is its peer", app: { "peer-deps-fixed": "1.0.0", "no-deps": "workspace:*" }, own: {} },
    { edge: "each depends on the other", app: {}, own: { "one-range-dep": "1.0.0" } },
  ])("the next install keeps the store entries of the first: $edge", async ({ app, own }) => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/no-deps/package.json": JSON.stringify({ ...workspace, dependencies: own }),
        "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { ...app, "a-dep": "1.0.1" } }),
      },
    });
    const store = join(packageDir, "node_modules", ".bun");

    await runBunInstall(installEnv(packageDir), packageDir);
    const fresh = await readdirSorted(store);
    const { out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(await readdirSorted(store)).toEqual(fresh);
    expect(out).toContain("(no changes)");
  });

  test("workspaces with different versions of that peer share one copy of the package", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/no-deps/package.json": JSON.stringify(workspace),
        "packages/a/package.json": JSON.stringify({
          name: "a",
          dependencies: { "one-range-dep": "1.0.0", "a-dep": "1.0.1" },
        }),
        "packages/b/package.json": JSON.stringify({
          name: "b",
          dependencies: { "one-range-dep": "1.0.0", "a-dep": "1.0.2" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    const store = await readdirSorted(join(packageDir, "node_modules", ".bun"));
    expect(store.filter(entry => entry.startsWith("one-range-dep@"))).toEqual(["one-range-dep@1.0.0"]);
  });
});

describe.concurrent("existing node_modules, missing node_modules/.bun", () => {
  test("root and workspace node_modules are reset", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "delete-node-modules",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
            "a-dep": "1.0.1",
          },
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "1.0.1",
          },
        }),
        "packages/pkg2/package.json": JSON.stringify({
          name: "pkg2",
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
        "node_modules/oops": "delete me!",
        "packages/pkg1/node_modules/oops1": "delete me!",
        "packages/pkg2/node_modules/oops2": "delete me!",
      },
    });

    let { exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([[".bun", "a-dep", "no-deps"], ["no-deps"], ["no-deps"]]);
  });
  test("some workspaces don't have node_modules", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "missing-workspace-node_modules",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
        "node_modules/hi": "BUN",
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg-one",
          dependencies: {
            "no-deps": "2.0.0",
          },
        }),
        "packages/pkg1/node_modules/foo": "HI",
        "packages/pkg2/package.json": JSON.stringify({
          name: "pkg-two",
          dependencies: {
            "a-dep": "1.0.1",
          },
        }),
      },
    });

    let { exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);
    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([[".bun", "no-deps"], ["no-deps"], ["a-dep"]]);

    // another install will not reset the node_modules

    // add things to workspace node_modules. these will go undetected
    await Promise.all([
      write(join(packageDir, "packages", "pkg1", "node_modules", "oops1"), "HI1"),
      write(join(packageDir, "packages", "pkg2", "node_modules", "oops2"), "HI2"),
    ]);

    ({ exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([
      [".bun", "no-deps"],
      ["no-deps", "oops1"],
      ["a-dep", "oops2"],
    ]);
  });

  // The hoisted linker nests the member's no-deps@2.0.0 in `packages/m/node_modules`.
  const memberWithNestedCopy = {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "1.0.0" } }),
    "packages/m/package.json": JSON.stringify({ name: "m", version: "1.0.0", dependencies: { "no-deps": "2.0.0" } }),
  };
  const linkInMember = join("..", "..", "..", "node_modules", ".bun", "no-deps@2.0.0", "node_modules", "no-deps");

  test.concurrent("a member's node_modules is reset when only the root's was deleted", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: memberWithNestedCopy,
    });
    await runBunInstall(installEnv(packageDir), packageDir);
    const nested = join(packageDir, "packages", "m", "node_modules", "no-deps");
    expect(lstatSync(nested).isDirectory()).toBe(true);

    await rm(join(packageDir, "node_modules"), { recursive: true });
    await runBunInstall(installEnv(packageDir), packageDir, {
      packages: ["--linker", "isolated"],
      savesLockfile: false,
    });

    expect(readlinkSync(nested)).toBe(linkInMember);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps"]);
  });

  // A directory can't be renamed to another file system or out of a lower overlayfs layer.
  const otherDevice = ["/dev/shm", "/tmp"].find(dir => {
    try {
      accessSync(dir, constants.W_OK | constants.X_OK);
      return !isWindows && statSync(dir).dev !== statSync(tmpdir()).dev;
    } catch {
      return false;
    }
  });
  test.skipIf(!otherDevice).concurrent("entries that can't be moved aside are deleted", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: memberWithNestedCopy,
    });
    // The root's node_modules is a volume, so the member's cannot be renamed into it.
    const volume = mkdtempSync(join(otherDevice!, "bun-isolated-exdev-"));
    try {
      symlinkSync(volume, join(packageDir, "node_modules"));
      await runBunInstall(installEnv(packageDir), packageDir);
      const nested = join(packageDir, "packages", "m", "node_modules", "no-deps");
      expect(lstatSync(nested).isDirectory()).toBe(true);

      // It says that it doesn't delete anything behind the link.
      await runBunInstall(installEnv(packageDir), packageDir, {
        packages: ["--linker", "isolated"],
        savesLockfile: false,
        allowWarnings: true,
      });

      expect(readlinkSync(nested)).toBe(linkInMember);
      expect(await file(join(nested, "package.json")).json()).toEqual({ name: "no-deps", version: "2.0.0" });
    } finally {
      rmSync(volume, { recursive: true, force: true });
    }
  });

  // Windows moves and deletes no folder while a program has a file in it open without sharing that.
  test.skipIf(!isWindows).concurrent.each([
    ["hoisted", "isolated"],
    ["isolated", "hoisted"],
  ] as const)("a file that a program has open does not stop the change from %s to %s", async (from, to) => {
    const names = ["a-dep", "no-deps", "what-bin"];
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: from },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          dependencies: { "a-dep": "1.0.1", "no-deps": "1.0.0", "what-bin": "1.0.0" },
        }),
      },
    });
    await runBunInstall(installEnv(packageDir), packageDir);
    const manifest = (name: string) => join(packageDir, "node_modules", name, "package.json");

    await using holder = spawn({
      cmd: [
        "powershell",
        "-NoProfile",
        "-Command",
        "$f = [IO.File]::Open($env:HELD, 'Open', 'Read', 'Read'); [Console]::Out.WriteLine('open'); [Console]::In.ReadLine() | Out-Null; $f.Close()",
      ],
      env: { ...bunEnv, HELD: manifest("no-deps") },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = holder.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("open");
    reader.releaseLock();

    const { err } = await runBunInstall(installEnv(packageDir), packageDir, {
      packages: ["--linker", to],
      savesLockfile: false,
      allowWarnings: true,
    });
    holder.stdin.end();
    await holder.exited;

    expect(err).toContain("installed by another linker");
    expect(await Promise.all(names.map(async name => (await file(manifest(name)).json()).name))).toEqual(names);
  });

  // Without LongPathsEnabled a path of 260 characters is only found in its long form.
  test.skipIf(!isWindows).concurrent("a second install finds the links whose path has 260 characters", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    let project = packageDir;
    while (project.length < 215) {
      project = join(project, Buffer.alloc(Math.max(1, Math.min(40, 214 - project.length)), "p").toString());
    }
    mkdirSync(project, { recursive: true });
    await registry.writeBunfig(project, { linker: "isolated" });
    await write(join(project, "package.json"), JSON.stringify({ name: "root", dependencies: { "one-dep": "1.0.0" } }));
    const link = join(project, "node_modules", ".bun", "one-dep@1.0.0", "node_modules", "no-deps");
    expect(link.length).toBeGreaterThanOrEqual(260);

    await runBunInstall(installEnv(packageDir), project);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const { out } = await runBunInstall(installEnv(packageDir), project, { savesLockfile: false });

    expect(out).toContain("(no changes)");
  });

  // Mounting needs a private user and mount namespace. Skipped where those are turned off, as in most containers.
  const canMount =
    isLinux &&
    Bun.which("unshare") !== null &&
    Bun.spawnSync({ cmd: ["unshare", "-Urm", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

  // docker-compose: a volume for each node_modules, and the source of a package mounted into one.
  // Bind mounts of `vol/*`, so what the installs leave in them can be read after the namespace is gone.
  test.skipIf(!canMount).concurrent.each([
    { linkers: ["isolated"], root: [".bun", "@acme", "dep", "mine"], web: ["lib"] },
    { linkers: ["isolated", "hoisted"], root: ["@acme", "dep", "lib", "mine", "web"], web: [] },
  ])(
    "a mount point is kept, and what another linker put in a node_modules that's a mount point is removed: $linkers",
    async expected => {
      using dir = tempDir("isolated-mount-points", {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { dep: "file:./dep" },
        }),
        "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "packages/web/package.json": JSON.stringify({
          name: "web",
          version: "1.0.0",
          dependencies: { lib: "workspace:*" },
        }),
        "packages/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
        "node_modules/.keep": "",
        "packages/web/node_modules/.keep": "",
        "vol/root/stale/package.json": JSON.stringify({ name: "stale", version: "1.0.0" }),
        "vol/root/dep/.keep": "",
        "vol/root/mine/.keep": "",
        "vol/root/@acme/stale/package.json": JSON.stringify({ name: "@acme/stale", version: "1.0.0" }),
        "vol/root/@acme/ui/.keep": "",
        "vol/web/lib/package.json": JSON.stringify({ name: "lib", version: "0.0.1" }),
        "vol/web/stale/package.json": JSON.stringify({ name: "stale", version: "1.0.0" }),
        "vol/dep/source.js": "",
        "vol/mine/source.js": "",
        "vol/ui/source.js": "",
      });
      const vol = (...path: string[]) => join(String(dir), "vol", ...path);

      await using proc = spawn({
        cmd: [
          "unshare",
          "-Urm",
          "/bin/sh",
          "-c",
          `set -e
mount -o bind vol/root node_modules
mount -o bind vol/web packages/web/node_modules
mount -o bind vol/dep node_modules/dep
mount -o bind vol/mine node_modules/mine
mount -o bind vol/ui node_modules/@acme/ui
for linker in "$@"; do "$BUN" install --linker="$linker"; done`,
          "sh",
          ...expected.linkers,
        ],
        cwd: String(dir),
        env: { ...bunEnv, BUN: bunExe(), BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).not.toContain("error");
      expect(stderr).not.toContain("EBUSY");
      expect({
        root: await readdirSorted(vol("root")),
        web: await readdirSorted(vol("web")),
        "@acme": await readdirSorted(vol("root", "@acme")),
        mine: await readdirSorted(vol("mine")),
        ui: await readdirSorted(vol("ui")),
      }).toEqual({ root: expected.root, web: expected.web, "@acme": ["ui"], mine: ["source.js"], ui: ["source.js"] });
      expect(await readdirSorted(vol("dep"))).toContain("source.js");
      if (expected.web.length > 0) expect(readlinkSync(vol("web", "lib"))).toBe(join("..", "..", "lib"));
      expect(exitCode).toBe(0);
    },
  );
});

describe.concurrent("--linker flag", () => {
  test("can override linker from bunfig", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    let { exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();
  });

  test("works as the only config option", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    let { exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "hoisted"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ exited } = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "ignore",
      stderr: "ignore",
    }));

    expect(await exited).toBe(0);

    expect(lstatSync(join(packageDir, "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();
  });

  async function installWithLinker(packageDir: string, linker: "isolated" | "hoisted") {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker", linker],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return stdout;
  }

  // `peer-deps` has a peer dependency on `no-deps`, so it shows which copy of
  // `no-deps` a dependency resolves to. Both must resolve to the same copy the
  // root resolves to, whichever linker laid out the tree.
  async function resolvedNoDeps(packageDir: string) {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const root = require("no-deps");
         const viaPeer = require("peer-deps").peerDependencies["no-deps"];
         console.log(JSON.stringify({ root: root.version, viaPeer: viaPeer.version, sameCopy: root === viaPeer }));`,
      ],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  function rootEntryKinds(packageDir: string, names: string[]) {
    return Object.fromEntries(
      names.map(name => {
        const stat = lstatSync(join(packageDir, "node_modules", name), { throwIfNoEntry: false });
        return [name, stat === undefined ? "missing" : stat.isSymbolicLink() ? "symlink" : "directory"];
      }),
    );
  }

  test("switching linkers on an existing node_modules replaces the whole tree", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    const writeRootPackageJson = (noDepsVersion: string) =>
      write(
        packageJson,
        JSON.stringify({
          name: "linker-switch",
          dependencies: {
            "no-deps": noDepsVersion,
            "peer-deps": "1.0.0",
          },
        }),
      );

    await writeRootPackageJson("1.0.0");
    await installWithLinker(packageDir, "isolated");
    expect(rootEntryKinds(packageDir, [".bun", "no-deps", "peer-deps"])).toEqual({
      ".bun": "directory",
      "no-deps": "symlink",
      "peer-deps": "symlink",
    });
    expect(await resolvedNoDeps(packageDir)).toEqual({ root: "1.0.0", viaPeer: "1.0.0", sameCopy: true });

    // The store symlink for `peer-deps` still points at a package.json with the
    // right version, so a hoisted install that only compared versions would keep
    // it linked into the store next to the old `no-deps`.
    await writeRootPackageJson("2.0.0");
    expect(await installWithLinker(packageDir, "hoisted")).toContain("2 packages installed");
    expect(rootEntryKinds(packageDir, [".bun", "no-deps", "peer-deps"])).toEqual({
      ".bun": "missing",
      "no-deps": "directory",
      "peer-deps": "directory",
    });
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["no-deps", "peer-deps"]);
    expect(await resolvedNoDeps(packageDir)).toEqual({ root: "2.0.0", viaPeer: "2.0.0", sameCopy: true });

    // Only a tree built by the other linker gets replaced.
    expect(await installWithLinker(packageDir, "hoisted")).toContain("(no changes)");
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["no-deps", "peer-deps"]);

    // Back to isolated: the real directory left behind by the hoisted install
    // must not shadow the store entry for the version the lockfile now has.
    await writeRootPackageJson("1.0.0");
    expect(await installWithLinker(packageDir, "isolated")).toContain("2 packages installed");
    expect(rootEntryKinds(packageDir, [".bun", "no-deps", "peer-deps"])).toEqual({
      ".bun": "directory",
      "no-deps": "symlink",
      "peer-deps": "symlink",
    });
    expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
      join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
    );
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps", "peer-deps"]);
    expect(await resolvedNoDeps(packageDir)).toEqual({ root: "1.0.0", viaPeer: "1.0.0", sameCopy: true });

    expect(await installWithLinker(packageDir, "isolated")).toContain("(no changes)");
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps", "peer-deps"]);
  });

  test("switching from isolated to hoisted also replaces workspace node_modules", async () => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "linker-switch-workspaces",
          workspaces: ["packages/*"],
        }),
        "packages/pkg1/package.json": JSON.stringify({
          name: "pkg1",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
        "packages/pkg1/index.js": `console.log(require.resolve("no-deps/package.json"));`,
      },
    });

    await installWithLinker(packageDir, "isolated");
    expect(lstatSync(join(packageDir, "packages", "pkg1", "node_modules", "no-deps")).isSymbolicLink()).toBeTrue();

    await installWithLinker(packageDir, "hoisted");
    // The workspace's store link would otherwise keep shadowing the hoisted copy.
    expect(existsSync(join(packageDir, "packages", "pkg1", "node_modules"))).toBeFalse();
    expect(rootEntryKinds(packageDir, [".bun", "no-deps", "pkg1"])).toEqual({
      ".bun": "missing",
      "no-deps": "directory",
      "pkg1": "symlink",
    });

    await using proc = spawn({
      cmd: [bunExe(), "packages/pkg1/index.js"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(join(packageDir, "node_modules", "no-deps", "package.json"));
    expect(exitCode).toBe(0);
  });

  test("switching linkers replaces the node_modules of two workspaces whose folders have the same name", async () => {
    const member = (name: string) => JSON.stringify({ name, dependencies: { "no-deps": "2.0.0" } });
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "linker-switch-same-folder-name",
          workspaces: ["apps/*", "packages/*"],
          dependencies: { "no-deps": "1.0.0" },
        }),
        "apps/web/package.json": member("web-app"),
        "packages/web/package.json": member("web-package"),
      },
    });
    const kinds = () =>
      Object.fromEntries(
        ["apps", "packages"].map(folder => [
          folder,
          lstatSync(join(packageDir, folder, "web", "node_modules", "no-deps")).isSymbolicLink()
            ? "symlink"
            : "directory",
        ]),
      );

    await installWithLinker(packageDir, "hoisted");
    expect(kinds()).toEqual({ apps: "directory", packages: "directory" });
    await installWithLinker(packageDir, "isolated");
    expect(kinds()).toEqual({ apps: "symlink", packages: "symlink" });
    await installWithLinker(packageDir, "hoisted");
    expect(kinds()).toEqual({ apps: "directory", packages: "directory" });
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(["no-deps", "web-app", "web-package"]);
  });

  // Build tools keep their caches in the node_modules of the package they run in.
  test.each([
    { linkers: ["isolated", "isolated"], root: [".bun"], web: [".cache", ".vite", "lib"] },
    { linkers: ["isolated", "hoisted"], root: [".cache", ".vite", "lib", "web"], web: [".cache", ".vite"] },
    { linkers: ["hoisted", "isolated"], root: [".bun", ".cache", ".vite"], web: [".cache", ".vite", "lib"] },
  ] as const)("replacing a tree keeps the dot entries that are not bun's: $linkers", async ({ linkers, root, web }) => {
    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
        "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { lib: "workspace:*" } }),
        "apps/lib/package.json": JSON.stringify({ name: "lib" }),
      },
    });
    const rootModules = join(packageDir, "node_modules");
    const webModules = join(packageDir, "apps", "web", "node_modules");

    await installWithLinker(packageDir, linkers[0]);
    await Promise.all(
      [rootModules, webModules].flatMap(nodeModules =>
        [".cache/tool/key", ".vite/deps/key", ".bin/stale", ".bun-tmp-0123456789abcdef/stale", "stale/index.js"].map(
          path => write(join(nodeModules, path), "warm"),
        ),
      ),
    );
    // Without a store, the isolated linker takes the members' node_modules for the other linker's.
    if (linkers[0] === linkers[1]) await rm(rootModules, { recursive: true });
    await installWithLinker(packageDir, linkers[1]);

    expect({ root: await readdirSorted(rootModules), web: await readdirSorted(webModules) }).toEqual({ root, web });
    expect(await file(join(webModules, ".vite", "deps", "key")).text()).toBe("warm");
  });

  test("replacing the tree of another package manager also removes its dot entries", async () => {
    const { packageDir } = await registry.createTestDir({
      files: { "package.json": JSON.stringify({ name: "was-pnpm", dependencies: { "no-deps": "1.0.0" } }) },
    });
    const nodeModules = join(packageDir, "node_modules");
    await Promise.all(
      [
        ".pnpm/no-deps@1.0.0/node_modules/no-deps/index.js",
        ".pnpm-workspace-state.json",
        ".modules.yaml",
        ".package-lock.json",
        ".yarn-integrity",
        ".yarn-state.yml",
        ".vite/deps/key",
      ].map(path => write(join(nodeModules, path), "warm")),
    );
    await installWithLinker(packageDir, "isolated");

    expect(await readdirSorted(nodeModules)).toEqual([".bun", ".vite", "no-deps"]);
  });

  // `--linker` on the command line isn't saved anywhere. Without workspaces the default is hoisted, so each of these
  // commands used to move the whole tree aside and install it again.
  test("a command without --linker keeps the tree that --linker=isolated created", async () => {
    const { packageDir } = await registry.createTestDir({
      files: { "package.json": JSON.stringify({ name: "linker-sticks", dependencies: { "no-deps": "1.0.0" } }) },
    });
    await installWithLinker(packageDir, "isolated");

    for (const [args, entries] of [
      [["install"], [".bun", "no-deps"]],
      [
        ["add", "a-dep@1.0.1"],
        [".bun", "a-dep", "no-deps"],
      ],
      [
        ["update", "no-deps"],
        [".bun", "a-dep", "no-deps"],
      ],
      [
        ["remove", "a-dep"],
        [".bun", "no-deps"],
      ],
    ]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: packageDir,
        env: installEnv(packageDir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect({ args, entries: await readdirSorted(join(packageDir, "node_modules")) }).toEqual({ args, entries });
      expect(rootEntryKinds(packageDir, ["no-deps"])).toEqual({ "no-deps": "symlink" });
      expect(exitCode).toBe(0);
    }

    // The commands that only read the tree go by the same rule.
    const [unnamed, named] = await Promise.all(
      [[], ["--linker=isolated"]].map(async flags => {
        await using proc = spawn({
          cmd: [bunExe(), "pm", "licenses", "--json", ...flags],
          cwd: packageDir,
          env: installEnv(packageDir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      }),
    );
    expect(JSON.parse(named.stdout).Unknown[0].paths[0].replaceAll("\\", "/")).toEndWith(
      "/node_modules/.bun/no-deps@1.0.0/node_modules/no-deps",
    );
    expect(unnamed).toEqual(named);

    // Naming the other linker still switches.
    await installWithLinker(packageDir, "hoisted");
    expect(rootEntryKinds(packageDir, [".bun", "no-deps"])).toEqual({ ".bun": "missing", "no-deps": "directory" });
  });

  // A security scanner that is not installed yet is installed on its own, before
  // the real install runs and with the same linker. That step is not a linker switch.
  test("installing a missing security scanner into an isolated node_modules keeps the tree", async () => {
    using scannerRegistry = new SimpleRegistry(false);
    await scannerRegistry.start();

    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "scanner-into-isolated",
          workspaces: ["packages/*"],
          devDependencies: {
            "test-security-scanner": "1.0.0",
          },
        }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: {
            "left-pad": "1.3.0",
          },
        }),
      },
    });
    await write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: join(packageDir, ".bun-cache"),
          registry: `${scannerRegistry.getUrl()}/`,
          security: { scanner: "test-security-scanner" },
        },
      }),
    );

    async function installWithScanner() {
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        env: installEnv(packageDir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const output = stdout + stderr;
      expect(output).toContain("Attempting to install security scanner from npm");
      expect(output).toContain("SCANNER_RAN:");
      expect(exitCode).toBe(0);
    }

    await installWithScanner();
    const nodeModules = join(packageDir, "node_modules");
    const entriesAfterFirstInstall = await readdirSorted(nodeModules);
    expect(entriesAfterFirstInstall).toEqual([".bun", "test-security-scanner"]);

    // Make the scanner need its own install step again, this time into a tree
    // that already has a store.
    await rm(join(nodeModules, "test-security-scanner"), { recursive: true, force: true });
    await installWithScanner();
    expect(await readdirSorted(nodeModules)).toEqual(entriesAfterFirstInstall);
    expect(await readdirSorted(join(packageDir, "packages", "app", "node_modules"))).toEqual(["left-pad"]);
  });

  // Without workspaces the default is hoisted. The step used to put a real directory where the
  // install that follows, which keeps the isolated tree, wants a link.
  test("a missing security scanner is linked into the tree that --linker=isolated created", async () => {
    using scannerRegistry = new SimpleRegistry(false);
    await scannerRegistry.start();

    const { packageDir } = await registry.createTestDir({
      files: {
        "package.json": JSON.stringify({
          name: "scanner-into-flag-isolated",
          devDependencies: { "test-security-scanner": "1.0.0" },
        }),
      },
    });
    await write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: join(packageDir, ".bun-cache"),
          registry: `${scannerRegistry.getUrl()}/`,
          security: { scanner: "test-security-scanner" },
        },
      }),
    );

    for (const flags of [["--linker=isolated"], []]) {
      await rm(join(packageDir, "node_modules", "test-security-scanner"), { recursive: true, force: true });
      await using proc = spawn({
        cmd: [bunExe(), "install", ...flags],
        cwd: packageDir,
        env: installEnv(packageDir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout + stderr).toContain("Attempting to install security scanner from npm");
      expect(stdout + stderr).toContain("SCANNER_RAN:");
      expect({ flags, ...rootEntryKinds(packageDir, [".bun", "test-security-scanner"]) }).toEqual({
        flags,
        ".bun": "directory",
        "test-security-scanner": "symlink",
      });
      expect(exitCode).toBe(0);
    }
  });
});
test.concurrent("many transitive dependencies", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-many-transitive-deps",
      dependencies: {
        "alias-loop-1": "1.0.0",
        "alias-loop-2": "1.0.0",
        "1-peer-dep-a": "1.0.0",
        "basic-1": "1.0.0",
        "is-number": "1.0.0",
      },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
    ".bun",
    "1-peer-dep-a",
    "alias-loop-1",
    "alias-loop-2",
    "basic-1",
    "is-number",
  ]);
  expect(readlinkSync(join(packageDir, "node_modules", "alias-loop-1"))).toBe(
    join(".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "alias-loop-1"))).toBe(
    join("..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "alias-loop-2"))).toBe(
    join("..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-1",
    version: "1.0.0",
    dependencies: {
      "alias1": "npm:alias-loop-2@*",
    },
  });
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-2",
    version: "1.0.0",
    dependencies: {
      "alias2": "npm:alias-loop-1@*",
    },
  });
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules"))).toEqual([
    "alias-loop-1",
    "alias1",
  ]);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules"))).toEqual([
    "alias-loop-2",
    "alias2",
  ]);
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias1")),
    ),
  ).toBe(join("..", "..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"));
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias2")),
    ),
  ).toBe(join("..", "..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"));
});

test.concurrent("dependency names are preserved", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-dependency-names",
      dependencies: {
        "alias-loop-1": "1.0.0",
      },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "alias-loop-1"]);
  expect(readlinkSync(join(packageDir, "node_modules", "alias-loop-1"))).toBe(
    join(".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"),
  );
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules"))).toEqual([
    "alias-loop-1",
    "alias1",
  ]);
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules"))).toEqual([
    "alias-loop-2",
    "alias2",
  ]);
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias1")),
    ),
  ).toBe(join("..", "..", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2"));
  expect(
    withoutEntryHash(
      readlinkSync(join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias2")),
    ),
  ).toBe(join("..", "..", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1"));
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-1@1.0.0", "node_modules", "alias-loop-1", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-1",
    version: "1.0.0",
    dependencies: {
      "alias1": "npm:alias-loop-2@*",
    },
  });
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "alias-loop-2@1.0.0", "node_modules", "alias-loop-2", "package.json"),
    ).json(),
  ).toEqual({
    name: "alias-loop-2",
    version: "1.0.0",
    dependencies: {
      "alias2": "npm:alias-loop-1@*",
    },
  });
});

test.concurrent("same resolution, different dependency name", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-same-resolution",
      dependencies: {
        "no-deps-1": "npm:no-deps@1.0.0",
        "no-deps-2": "npm:no-deps@1.0.0",
      },
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps-1", "no-deps-2"]);
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps-1"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps-2"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "no-deps@1.0.0", "node_modules", "no-deps", "package.json"),
    ).json(),
  ).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });
  expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual(["no-deps@1.0.0", "node_modules"]);
});

test.concurrent("a store entry is reused without reading its package.json, and --force rebuilds it", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({ name: "test-pkg-replaced-store-file", dependencies: { "no-deps": "1.0.0" } }),
  );
  await runBunInstall(installEnv(packageDir), packageDir);

  const storePackageJson = join(
    packageDir,
    "node_modules",
    ".bun",
    "no-deps@1.0.0",
    "node_modules",
    "no-deps",
    "package.json",
  );
  expect(await file(storePackageJson).json()).toEqual({ name: "no-deps", version: "1.0.0" });

  // A new file, not a write through the old one: that is a hardlink of the cache's copy.
  await rm(storePackageJson);
  await write(storePackageJson, JSON.stringify({ name: "no-deps", version: "0.9.0" }));

  for (const frozenLockfile of [false, true]) {
    const { out } = await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false, frozenLockfile });
    expect(out).toContain("(no changes)");
    expect(await file(storePackageJson).json()).toEqual({ name: "no-deps", version: "0.9.0" });
  }

  await using proc = spawn({
    cmd: [bunExe(), "install", "--force"],
    cwd: packageDir,
    env: installEnv(packageDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("1 package installed");
  expect(await file(storePackageJson).json()).toEqual({ name: "no-deps", version: "1.0.0" });
  expect(exitCode).toBe(0);
});

// The author writes the package.json in a tarball, the registry writes the row that bun.lock records, and the two can differ.
const ownPackageJsonCases: [description: string, packageJson: object][] = [
  ["another version", { name: "dep", version: "1.0.0-beta.1" }],
  ["no version", { name: "dep" }],
  ["another name", { name: "dep-renamed", version: "1.0.0" }],
  ["another case of the name", { name: "DEP", version: "1.0.0" }],
];
test.concurrent.each(ownPackageJsonCases)(
  "a package whose own package.json disagrees with its registry row is installed once (%s)",
  async (_, packageJson) => {
    const tarball = await new Bun.Archive(
      { "package/package.json": JSON.stringify(packageJson), "package/index.js": "module.exports = 1;\n" },
      { compress: "gzip" },
    ).bytes();
    await using server = Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        if (pathname === "/dep-1.0.0.tgz") return new Response(tarball);
        if (pathname !== "/dep") return new Response("not found", { status: 404 });
        const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64");
        return Response.json({
          name: "dep",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": { name: "dep", version: "1.0.0", dist: { tarball: `${origin}/dep-1.0.0.tgz`, integrity } },
          },
        });
      },
    });
    using dir = tempDir("own-package-json-disagrees", {
      "package.json": JSON.stringify({ name: "foo", dependencies: { dep: "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href, linker: "isolated" } }),
    });
    const cwd = String(dir);
    const tmp = join(cwd, ".bun-tmp");

    const runs = [
      { args: [], summary: "1 package installed" },
      { args: [], summary: "(no changes)" },
      { args: ["--frozen-lockfile"], summary: "(no changes)" },
    ];
    for (const { args, summary } of runs) {
      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"), BUN_TMPDIR: tmp, TMPDIR: tmp, TEMP: tmp },
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain(summary);
      expect(exitCode).toBe(0);
    }
    expect(await file(join(cwd, "node_modules", "dep", "package.json")).json()).toEqual(packageJson);
  },
);

// One store entry serves every dependent of a package version, whatever name
// each dependent uses for it. The entry is created for the first dependent.
describe.concurrent("bins of a package that dependents reach under different names", () => {
  const storeBin = (packageDir: string, entry: string, bin: string) =>
    join(packageDir, "node_modules", ".bun", entry, "node_modules", ".bin", bin);
  const memberBin = (packageDir: string, member: string, bin: string) =>
    join(packageDir, "packages", member, "node_modules", ".bin", bin);

  function workspace(members: Record<string, object>, files: Record<string, string> = {}) {
    files["package.json"] = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    for (const [name, manifest] of Object.entries(members)) {
      files[`packages/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0", ...manifest });
    }
    return registry.createTestDir({ bunfigOpts: { linker: "isolated" }, files });
  }

  test.each([
    ["the alias", { aliased: "npm:what-bin@1.0.0" }, { "what-bin": "1.0.0" }],
    ["the package name", { "what-bin": "1.0.0" }, { aliased: "npm:what-bin@1.0.0" }],
  ])("each workspace member links the bin through its own dependency name (%s first)", async (_, first, second) => {
    const { packageDir } = await workspace({
      "a-first": { dependencies: first },
      "b-second": { dependencies: second },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(memberBin(packageDir, "a-first", "what-bin")).toBeValidBin(join("..", Object.keys(first)[0], "what-bin.js"));
    expect(memberBin(packageDir, "b-second", "what-bin")).toBeValidBin(
      join("..", Object.keys(second)[0], "what-bin.js"),
    );
    // The package's own bin, beside its own folder in the store.
    expect(storeBin(packageDir, "what-bin@1.0.0", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  });

  test("a string bin is named after the dependency for a dependent and after the package in the store", async () => {
    const { packageDir } = await workspace({
      "a-first": { dependencies: { al: "npm:dep-with-file-bin@1.0.0" } },
      "b-second": { dependencies: { "dep-with-file-bin": "1.0.0" } },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(memberBin(packageDir, "a-first", "al")).toBeValidBin(join("..", "al", "file-bin"));
    expect(memberBin(packageDir, "b-second", "dep-with-file-bin")).toBeValidBin(
      join("..", "dep-with-file-bin", "file-bin"),
    );
    expect(storeBin(packageDir, "dep-with-file-bin@1.0.0", "dep-with-file-bin")).toBeValidBin(
      join("..", "dep-with-file-bin", "file-bin"),
    );
  });

  test("a registry package finds its dependency's command when the project aliases that dependency", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          dependencies: { aliased: "npm:what-bin@1.0.0", "uses-what-bin": "1.0.0" },
          trustedDependencies: ["uses-what-bin"],
        }),
      },
    });

    // The install script of uses-what-bin runs `what-bin`.
    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await file(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt")).text()).toBe("what-bin@1.0.0");
    expect(storeBin(packageDir, "uses-what-bin@1.0.0", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  });

  test("a global store entry links its dependency's bin when the project aliases that dependency", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", globalStore: true },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          dependencies: { aliased: "npm:what-bin@1.0.0", "uses-what-bin": "1.0.0" },
        }),
      },
    });

    // BUN_INSTALL_CACHE_DIR overrides bunfig's `cache`, and CI sets it. This test builds the entry in its own store.
    await runBunInstall(installEnv(packageDir), packageDir);

    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "uses-what-bin@1.0.0"))).toContain(
      join(".bun-cache", "links", "uses-what-bin@1.0.0-"),
    );
    expect(storeBin(packageDir, "uses-what-bin@1.0.0", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  });

  test("a workspace member named like its dependency does not link its own bin to the dependency's file", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "packages/what-bin/package.json": JSON.stringify({
          name: "what-bin",
          version: "9.0.0",
          bin: { wsonly: "what-bin.js" },
          dependencies: { "what-bin": "1.0.0" },
        }),
        "packages/what-bin/what-bin.js": "#!/usr/bin/env node\n",
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    const bins = join(packageDir, "packages", "what-bin", "node_modules", ".bin");
    expect(await readdirSorted(bins)).toHaveBins(["what-bin"]);
    expect(join(bins, "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  });

  test("a dependent with the alias and another version links each through its own folder", async () => {
    const { packageDir } = await workspace({
      "a-first": { dependencies: { "what-bin": "1.0.0" } },
      "b-second": { dependencies: { aliased: "npm:what-bin@1.0.0", "what-bin": "1.5.0" } },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    // Both dependencies of b-second have the command. `aliased` sorts first and keeps it.
    expect(memberBin(packageDir, "b-second", "what-bin")).toBeValidBin(join("..", "aliased", "what-bin.js"));
    expect(memberBin(packageDir, "a-first", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  });

  test("when two direct dependencies have the same bin, the first by name wins even if another package has it as a peer", async () => {
    const tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({
          name: "aa-plugin",
          version: "1.0.0",
          peerDependencies: { "what-bin": ">=1.0.0" },
        }),
      },
      { compress: "gzip" },
    ).bytes();
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({
          name: "root",
          dependencies: {
            "aa-plugin": "file:./aa-plugin.tgz",
            "what-bin": "1.0.0",
            "what-bin-next": "npm:what-bin@1.5.0",
          },
        }),
        "aa-plugin.tgz": Buffer.from(tarball),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(join(packageDir, "node_modules", ".bin", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  });

  test("an alias, a workspace package with the same command and a bin that fails to link in one dependent", async () => {
    // Too long for a file name, so making the link fails.
    const longBinName = Buffer.alloc(300, "a").toString();
    const { packageDir } = await workspace(
      {
        "a-first": { dependencies: { "what-bin": "1.0.0" } },
        "b-second": {
          dependencies: { "aa-local": "workspace:*", "ab-broken": "workspace:*", zz: "npm:what-bin@1.0.0" },
        },
        "aa-local": { bin: { "what-bin": "cli.js" } },
        "ab-broken": { bin: { [longBinName]: "cli.js", "broken-ok": "cli.js" } },
      },
      {
        "packages/aa-local/cli.js": "#!/usr/bin/env node\n",
        "packages/ab-broken/cli.js": "#!/usr/bin/env node\n",
      },
    );

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("failed to link binaries of dependency ab-broken@");
    // The registry package links first, under the name this dependent uses, whatever the names sort like.
    expect(memberBin(packageDir, "b-second", "what-bin")).toBeValidBin(join("..", "zz", "what-bin.js"));
    expect(memberBin(packageDir, "b-second", "broken-ok")).toBeValidBin(join("..", "ab-broken", "cli.js"));
    expect(exitCode).toBe(1);
  });

  test("a tarball without a package name and with a string bin installs", async () => {
    const tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ version: "1.0.0", bin: "cli.js" }),
        "package/cli.js": "#!/usr/bin/env node\n",
      },
      { compress: "gzip" },
    ).bytes();
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "root", dependencies: { nameless: "file:./nameless.tgz" } }),
        "nameless.tgz": Buffer.from(tarball),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await file(join(packageDir, "node_modules", "nameless", "cli.js")).text()).toBe("#!/usr/bin/env node\n");
  });
});

test.concurrent("successfully removes and corrects symlinks", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  await Promise.all([
    write(join(packageDir, "old-package", "package.json"), JSON.stringify({ name: "old-package", version: "1.0.0" })),
    mkdir(join(packageDir, "node_modules")),
  ]);
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-dangling-symlinks",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    ),
    symlink(join("..", "old-package"), join(packageDir, "node_modules", "no-deps"), "dir"),
  ]);

  await runBunInstall(installEnv(packageDir), packageDir);

  expect(existsSync(join(packageDir, "node_modules", "no-deps"))).toBeTrue();

  expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
});

describe.concurrent("empty directory where a dependency symlink belongs", () => {
  // ninja creates the directory of every declared output before running the
  // command, and bun's own build declares `node_modules/<pkg>/package.json` as
  // outputs of its `bun install` step, so the install finds an empty
  // `node_modules/<pkg>/`. Only a directory with a package.json is left in
  // place: that is what `bun patch <pkg>` produces while the user edits it.

  test("new dependency is linked over a pre-created empty directory", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(packageJson, JSON.stringify({ name: "test-pkg-empty-dir", dependencies: { "no-deps": "1.0.0" } }));
    await runBunInstall(installEnv(packageDir), packageDir);

    await write(
      packageJson,
      JSON.stringify({ name: "test-pkg-empty-dir", dependencies: { "no-deps": "1.0.0", "what-bin": "1.0.0" } }),
    );
    await mkdir(join(packageDir, "node_modules", "what-bin"));

    const { out } = await runBunInstall(installEnv(packageDir), packageDir);
    expect(out).toContain("what-bin@1.0.0");

    expect(readlinkSync(join(packageDir, "node_modules", "what-bin"))).toBe(
      join(".bun", "what-bin@1.0.0", "node_modules", "what-bin"),
    );
    const bin = process.platform === "win32" ? "what-bin.bunx" : "what-bin";
    expect(existsSync(join(packageDir, "node_modules", ".bin", bin))).toBe(true);
  });

  test("re-running install repairs links that became empty directories", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-empty-dir-repair",
        dependencies: { "no-deps": "1.0.0", "@types/is-number": "1.0.0" },
      }),
    );
    await runBunInstall(installEnv(packageDir), packageDir);

    const links = [
      join(packageDir, "node_modules", "no-deps"),
      join(packageDir, "node_modules", "@types", "is-number"),
      join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"),
      join(packageDir, "node_modules", ".bun", "node_modules", "@types", "is-number"),
    ];
    const expected = links.map(link => readlinkSync(link));
    for (const link of links) {
      await rm(link);
      await mkdir(link);
    }

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(links.map(link => readlinkSync(link))).toEqual(expected);
  });

  test("workspace dependency is linked over an empty directory", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "package.json": JSON.stringify({ name: "test-pkg-empty-dir-workspace", workspaces: ["packages/*"] }),
        "packages/pkg-1/package.json": JSON.stringify({
          name: "pkg-1",
          version: "1.0.0",
          dependencies: { "a-dep": "1.0.1" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    const link = join(packageDir, "packages", "pkg-1", "node_modules", "a-dep");
    const expected = readlinkSync(link);
    expect(expected).toBe(join("..", "..", "..", "node_modules", ".bun", "a-dep@1.0.1", "node_modules", "a-dep"));
    await rm(link);
    await mkdir(link);

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(readlinkSync(link)).toBe(expected);
  });

  test("a link inside a store entry that became an empty directory is repaired", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({ name: "test-pkg-empty-dir-entry", dependencies: { "one-fixed-dep": "1.0.0" } }),
    );
    await runBunInstall(installEnv(packageDir), packageDir);

    const slot = join(packageDir, "node_modules", ".bun", "one-fixed-dep@1.0.0", "node_modules", "no-deps");
    const link = readlinkSync(slot);
    await rm(slot);
    await mkdir(slot);

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(readlinkSync(slot)).toBe(link);
  });

  test.each([
    ["with a package.json is left in place", true],
    ["without a package.json is replaced by the link", false],
  ])("a directory %s", async (_, hasPackageJson) => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({ name: "test-pkg-dir-with-contents", dependencies: { "no-deps": "1.0.0" } }),
    );
    await runBunInstall(installEnv(packageDir), packageDir);

    const slot = join(packageDir, "node_modules", "no-deps");
    const link = readlinkSync(slot);
    await rm(slot);
    await write(join(slot, "index.js"), "module.exports = 'USER_EDITS';\n");
    if (hasPackageJson) await write(join(slot, "package.json"), JSON.stringify({ name: "no-deps", version: "1.0.0" }));

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    if (hasPackageJson) {
      expect(lstatSync(slot).isSymbolicLink()).toBe(false);
      expect(await file(join(slot, "index.js")).text()).toBe("module.exports = 'USER_EDITS';\n");
    } else {
      expect(readlinkSync(slot)).toBe(link);
    }
  });
});

test.concurrent("runs lifecycle scripts correctly", async () => {
  // due to binary linking between preinstall and the remaining lifecycle scripts
  // there is special handling for preinstall scripts we should test.
  // 1. only preinstall
  // 2. only postinstall (or any other script that isn't preinstall)
  // 3. preinstall and any other script

  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-lifecycle-scripts",
      dependencies: {
        "lifecycle-preinstall": "1.0.0",
        "lifecycle-postinstall": "1.0.0",
        "all-lifecycle-scripts": "1.0.0",
      },
      trustedDependencies: ["lifecycle-preinstall", "lifecycle-postinstall", "all-lifecycle-scripts"],
    }),
  );

  await runBunInstall(installEnv(packageDir), packageDir);

  const [
    preinstallLink,
    postinstallLink,
    allScriptsLink,
    preinstallFile,
    postinstallFile,
    allScriptsPreinstallFile,
    allScriptsInstallFile,
    allScriptsPostinstallFile,
    bunDir,
    lifecyclePreinstallDir,
    lifecyclePostinstallDir,
    allLifecycleScriptsDir,
  ] = await Promise.all([
    readlink(join(packageDir, "node_modules", "lifecycle-preinstall")),
    readlink(join(packageDir, "node_modules", "lifecycle-postinstall")),
    readlink(join(packageDir, "node_modules", "all-lifecycle-scripts")),
    file(join(packageDir, "node_modules", "lifecycle-preinstall", "preinstall.txt")).text(),
    file(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "preinstall.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "install.txt")).text(),
    file(join(packageDir, "node_modules", "all-lifecycle-scripts", "postinstall.txt")).text(),
    readdirSorted(join(packageDir, "node_modules", ".bun")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "lifecycle-preinstall@1.0.0", "node_modules")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "lifecycle-postinstall@1.0.0", "node_modules")),
    readdirSorted(join(packageDir, "node_modules", ".bun", "all-lifecycle-scripts@1.0.0", "node_modules")),
  ]);

  expect(preinstallLink).toBe(join(".bun", "lifecycle-preinstall@1.0.0", "node_modules", "lifecycle-preinstall"));
  expect(postinstallLink).toBe(join(".bun", "lifecycle-postinstall@1.0.0", "node_modules", "lifecycle-postinstall"));
  expect(allScriptsLink).toBe(join(".bun", "all-lifecycle-scripts@1.0.0", "node_modules", "all-lifecycle-scripts"));

  expect(preinstallFile).toBe("preinstall!");
  expect(postinstallFile).toBe("postinstall!");
  expect(allScriptsPreinstallFile).toBe("preinstall!");
  expect(allScriptsInstallFile).toBe("install!");
  expect(allScriptsPostinstallFile).toBe("postinstall!");

  expect(bunDir).toEqual([
    "all-lifecycle-scripts@1.0.0",
    "lifecycle-postinstall@1.0.0",
    "lifecycle-preinstall@1.0.0",
    "node_modules",
  ]);

  expect(lifecyclePreinstallDir).toEqual(["lifecycle-preinstall"]);
  expect(lifecyclePostinstallDir).toEqual(["lifecycle-postinstall"]);
  expect(allLifecycleScriptsDir).toEqual(["all-lifecycle-scripts"]);
});

test.concurrent(
  "optional dependency with a failing lifecycle script is removed along with the links to it",
  async () => {
    // optional-lifecycle-fail@1.1.1 has `lifecycle-fail@1.1.1` in its
    // optionalDependencies, and lifecycle-fail's preinstall script exits 1.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-failed-optional-dependency",
        dependencies: {
          "optional-lifecycle-fail": "1.1.1",
        },
        trustedDependencies: ["lifecycle-fail"],
      }),
    );

    const bunDir = join(packageDir, "node_modules", ".bun");
    const dependentNodeModules = join(bunDir, "optional-lifecycle-fail@1.1.1", "node_modules");

    async function expectFailedOptionalDependencyRemoved() {
      expect(
        await Promise.all([
          readdirSorted(join(packageDir, "node_modules")),
          readdirSorted(join(bunDir, "lifecycle-fail@1.1.1", "node_modules")),
          // Neither the dependent's `node_modules/lifecycle-fail` link nor the
          // hidden `.bun/node_modules/lifecycle-fail` link may be left behind
          // pointing at the deleted package.
          readdirSorted(dependentNodeModules),
          readdirSorted(join(bunDir, "node_modules")),
        ]),
      ).toEqual([[".bun", "optional-lifecycle-fail"], [], ["optional-lifecycle-fail"], ["optional-lifecycle-fail"]]);

      const requireFromDependent = createRequire(join(dependentNodeModules, "optional-lifecycle-fail", "package.json"));
      let code: string | undefined;
      try {
        requireFromDependent.resolve("lifecycle-fail");
      } catch (e: any) {
        code = e.code;
      }
      expect(code).toBe("MODULE_NOT_FOUND");
    }

    await runBunInstall(installEnv(packageDir), packageDir);
    await expectFailedOptionalDependencyRemoved();

    // The failed package is installed (and removed) again on the next install;
    // relinking the packages that depend on it must not leave links behind either.
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    await expectFailedOptionalDependencyRemoved();
  },
);

test.concurrent(
  "direct optional dependency with a failing postinstall script is removed along with the links to it",
  async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-failed-direct-optional-dependency",
        dependencies: {
          "no-deps": "1.0.0",
        },
        optionalDependencies: {
          "lifecycle-failing-postinstall": "1.0.0",
        },
        trustedDependencies: ["lifecycle-failing-postinstall"],
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunDir = join(packageDir, "node_modules", ".bun");
    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(bunDir, "lifecycle-failing-postinstall@1.0.0", "node_modules")),
        readdirSorted(join(bunDir, "node_modules")),
      ]),
    ).toEqual([[".bun", "no-deps"], [], ["no-deps"]]);
  },
);

// A lifecycle script that appends `id` to $SCRIPT_RUNS, then exits with $SCRIPT_EXIT.
const countedScript = (id: string, script: "preinstall" | "postinstall" = "postinstall") => ({
  [script]: `echo ${id} >> "$SCRIPT_RUNS" && exit $SCRIPT_EXIT`,
});

function scriptRuns(packageDir: string): string[] {
  const runs = join(packageDir, "runs.txt");
  return existsSync(runs) ? readFileSync(runs, "utf8").split(/\s+/).filter(Boolean).sort() : [];
}

// `bun install` in packageDir. The counted scripts fail unless `pass` is set.
async function installCounted(
  packageDir: string,
  opts: { args?: string[]; pass?: boolean; env?: NodeJS.Dict<string>; argv0?: string[] } = {},
) {
  await using proc = spawn({
    cmd: [...(opts.argv0 ?? []), bunExe(), "install", ...(opts.args ?? [])],
    cwd: packageDir,
    env: {
      ...(opts.env ?? installEnv(packageDir)),
      SCRIPT_RUNS: join(packageDir, "runs.txt"),
      SCRIPT_EXIT: opts.pass ? "0" : "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// When a lifecycle script of an optional dependency fails, the install continues without the package. Bun removes what
// it placed for it (its copy, or the links to it), and the next install tries again. It never removes the folder that a
// workspace or `link:` dependency points to.
describe.each(["isolated", "hoisted"] as const)("failed script of an optional dependency (%s)", linker => {
  // `--filter y` does not select x, so only the optional edge of y reaches x. Exit 0 for the
  // failed member is what main does in that case; these tests keep it, they do not decide it.
  const workspaceFiles = (script: "preinstall" | "postinstall" = "postinstall") => ({
    "package.json": JSON.stringify({
      name: "monorepo-optional-workspace",
      workspaces: ["packages/*"],
    }),
    "packages/x/package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: countedScript("x", script) }),
    "packages/x/src.txt": "keep me",
    "packages/y/package.json": JSON.stringify({
      name: "y",
      version: "1.0.0",
      optionalDependencies: { x: "workspace:*" },
    }),
  });
  const workspaceState = async (packageDir: string) => ({
    runs: scriptRuns(packageDir),
    packages: await readdirSorted(join(packageDir, "packages")),
    src: await file(join(packageDir, "packages", "x", "src.txt")).text(),
    // Only the hoisted linker places a link for x in the root node_modules.
    rootLink: lstatSync(join(packageDir, "node_modules", "x"), { throwIfNoEntry: false }) !== undefined,
    // Only the isolated linker places one in the node_modules of y.
    dependentLink:
      lstatSync(join(packageDir, "packages", "y", "node_modules", "x"), { throwIfNoEntry: false }) !== undefined,
  });
  const kept = { packages: ["x", "y"], src: "keep me", rootLink: false, dependentLink: false };

  test.concurrent("workspace: the folder is kept and later installs run the script again", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files: workspaceFiles() });
    const verb = linker === "hoisted" ? "deleting" : "skipping";

    for (const [runs, args] of [
      [["x"], []],
      [["x", "x"], ["--verbose"]],
    ] as const) {
      const { stderr, exitCode } = await installCounted(packageDir, { args: ["--filter", "y", ...args] });
      expect(stderr).not.toContain("error:");
      if (args.length === 0) expect(stderr).not.toContain("warn:");
      else expect(stderr).toContain(`${verb} optional dependency 'x' due to failed 'postinstall' script`);
      expect(await workspaceState(packageDir)).toEqual({ runs: [...runs], ...kept });
      expect(exitCode).toBe(0);
    }

    // Without the filter the root's workspace edge to x is required.
    const { stderr, exitCode } = await installCounted(packageDir);
    expect(stderr).toContain('postinstall script from "x" exited with 1');
    expect(scriptRuns(packageDir)).toEqual(["x", "x", "x"]);
    expect(exitCode).toBe(1);
  });

  test.concurrent.each(["preinstall", "postinstall"] as const)(
    "workspace: a corrected %s script runs on the next install",
    async script => {
      const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files: workspaceFiles(script) });

      const failed = await installCounted(packageDir, { args: ["--filter", "y"] });
      expect(failed.stderr).not.toContain("error:");
      expect(await workspaceState(packageDir)).toEqual({ runs: ["x"], ...kept });
      expect(failed.exitCode).toBe(0);

      const corrected = await installCounted(packageDir, { pass: true });
      expect(corrected.stderr).not.toContain("error:");
      const link =
        linker === "isolated"
          ? join(packageDir, "packages", "y", "node_modules", "x")
          : join(packageDir, "node_modules", "x");
      expect({
        runs: scriptRuns(packageDir),
        link: lstatSync(link).isSymbolicLink(),
        src: await file(join(link, "src.txt")).text(),
      }).toEqual({ runs: ["x", "x"], link: true, src: "keep me" });
      expect(corrected.exitCode).toBe(0);
    },
  );

  // With SIGCHLD ignored, Linux reaps the script itself and bun cannot wait for it. Bun then
  // treats a script that exited 0 as failed, through a second exit path.
  test.concurrent.skipIf(!isLinux)("workspace: the folder is kept when bun can't wait for the script", async () => {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files: workspaceFiles() });
    const verb = linker === "hoisted" ? "deleting" : "skipping";

    const { stderr, exitCode } = await installCounted(packageDir, {
      argv0: ["bash", "-c", 'trap "" CHLD; exec "$0" "$@"'],
      args: ["--filter", "y", "--verbose"],
      pass: true,
    });
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain(`${verb} optional dependency 'x' due to failed 'postinstall' script`);
    expect(await workspaceState(packageDir)).toEqual({ runs: ["x"], ...kept });
    expect(exitCode).toBe(0);
  });

  test.concurrent("file: folder: the copy is removed, also in a workspace's node_modules", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({
          name: "optional-folder-deps",
          workspaces: ["packages/*"],
          dependencies: { q: "file:./q-root" },
          optionalDependencies: { f: "file:./f" },
          trustedDependencies: ["f", "q"],
        }),
        // The root has another q, so the q of w is placed in packages/w/node_modules.
        "packages/w/package.json": JSON.stringify({
          name: "w",
          version: "1.0.0",
          optionalDependencies: { q: "file:../../q-nested" },
        }),
        "f/package.json": JSON.stringify({ name: "f", version: "1.0.0", scripts: countedScript("f") }),
        "q-root/package.json": JSON.stringify({ name: "q", version: "1.0.0" }),
        "q-nested/package.json": JSON.stringify({
          name: "q",
          version: "2.0.0",
          scripts: countedScript("q", "preinstall"),
        }),
      },
    });
    const version = async (...dir: string[]) => {
      const manifest = file(join(packageDir, ...dir, "package.json"));
      return (await manifest.exists()) ? (await manifest.json()).version : null;
    };
    const state = async () => ({
      runs: scriptRuns(packageDir),
      f: await version("node_modules", "f"),
      rootQ: await version("node_modules", "q"),
      nestedQ: await version("packages", "w", "node_modules", "q"),
      sources: [await version("f"), await version("q-nested")],
    });

    for (const runs of [
      ["f", "q"],
      ["f", "f", "q", "q"],
    ]) {
      const { stderr, exitCode } = await installCounted(packageDir);
      expect(stderr).not.toContain("error:");
      expect(stderr).not.toContain("warn:");
      expect(await state()).toEqual({ runs, f: null, rootQ: "1.0.0", nestedQ: null, sources: ["1.0.0", "2.0.0"] });
      expect(exitCode).toBe(0);
    }

    const { stderr, exitCode } = await installCounted(packageDir, { pass: true });
    expect(stderr).not.toContain("error:");
    expect(await state()).toEqual({
      runs: ["f", "f", "f", "q", "q", "q"],
      f: "1.0.0",
      rootQ: "1.0.0",
      nestedQ: "2.0.0",
      sources: ["1.0.0", "2.0.0"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("local tarball: the copy is removed and installed again", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({
          name: "optional-tarball-dep",
          optionalDependencies: { lt: "file:./lt-1.0.0.tgz" },
          trustedDependencies: ["lt"],
        }),
        "lt/package.json": JSON.stringify({ name: "lt", version: "1.0.0", scripts: countedScript("lt") }),
      },
    });
    await pack(join(packageDir, "lt"), bunEnv, "--destination", packageDir);
    const installed = () => existsSync(join(packageDir, "node_modules", "lt", "package.json"));

    for (const runs of [["lt"], ["lt", "lt"]]) {
      const { stderr, exitCode } = await installCounted(packageDir);
      expect(stderr).not.toContain("error:");
      expect({ runs: scriptRuns(packageDir), installed: installed() }).toEqual({ runs, installed: false });
      expect(exitCode).toBe(0);
    }

    const { stderr, exitCode } = await installCounted(packageDir, { pass: true });
    expect(stderr).not.toContain("error:");
    expect({ runs: scriptRuns(packageDir), installed: installed() }).toEqual({
      runs: ["lt", "lt", "lt"],
      installed: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("registry package: the copy is removed and the next install tries again", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({
          name: "optional-registry-dep",
          optionalDependencies: { "lifecycle-fail": "1.1.1" },
          trustedDependencies: ["lifecycle-fail"],
        }),
      },
    });

    for (let install = 0; install < 2; install++) {
      const { stderr, exitCode } = await installCounted(packageDir, { args: ["--verbose"] });
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("deleting optional dependency 'lifecycle-fail' due to failed 'preinstall' script");
      expect(existsSync(join(packageDir, "node_modules", "lifecycle-fail", "package.json"))).toBe(false);
      expect(exitCode).toBe(0);
    }
  });
});

// With one script at a time, the hoisted linker starts the second script from another call site.
test.concurrent("failed scripts of two optional workspaces, one script at a time (hoisted)", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { linker: "hoisted" },
    files: {
      "package.json": JSON.stringify({ name: "two-optional-workspaces", workspaces: ["packages/*"] }),
      "packages/x1/package.json": JSON.stringify({ name: "x1", version: "1.0.0", scripts: countedScript("x1") }),
      "packages/x1/src.txt": "keep me",
      "packages/x2/package.json": JSON.stringify({ name: "x2", version: "1.0.0", scripts: countedScript("x2") }),
      "packages/x2/src.txt": "keep me",
      "packages/y/package.json": JSON.stringify({
        name: "y",
        version: "1.0.0",
        optionalDependencies: { x1: "workspace:*", x2: "workspace:*" },
      }),
    },
  });

  const { stderr, exitCode } = await installCounted(packageDir, {
    args: ["--filter", "y", "--concurrent-scripts", "1"],
  });
  expect(stderr).not.toContain("error:");
  expect({
    runs: scriptRuns(packageDir),
    links: ["x1", "x2"].map(
      x => lstatSync(join(packageDir, "node_modules", x), { throwIfNoEntry: false }) !== undefined,
    ),
    sources: await Promise.all(["x1", "x2"].map(x => file(join(packageDir, "packages", x, "src.txt")).text())),
  }).toEqual({ runs: ["x1", "x2"], links: [false, false], sources: ["keep me", "keep me"] });
  expect(exitCode).toBe(0);
});

test.concurrent.each(["isolated", "hoisted"] as const)(
  "failed script of an optional bun link dependency removes the project link and keeps the target (%s)",
  async linker => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({
          name: "optional-link-dep",
          optionalDependencies: { x: "link:x" },
          trustedDependencies: ["x"],
        }),
        "linked/x/package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: countedScript("x") }),
        "linked/x/src.txt": "keep me",
      },
    });
    // `bun link` registers in the global link dir. Keep it per test.
    const globalDir = join(packageDir, ".bun-install");
    const env = { ...bunEnv, BUN_INSTALL: globalDir, BUN_INSTALL_GLOBAL_DIR: join(globalDir, "install", "global") };

    await using link = spawn({
      cmd: [bunExe(), "link"],
      cwd: join(packageDir, "linked", "x"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [linkStdout, linkStderr, linkExitCode] = await Promise.all([
      link.stdout.text(),
      link.stderr.text(),
      link.exited,
    ]);
    expect(linkStderr).not.toContain("error:");
    expect(linkStdout).toContain('Success! Registered "x"');
    expect(linkExitCode).toBe(0);

    const globalLink = join(globalDir, "install", "global", "node_modules", "x");
    const projectLink = join(packageDir, "node_modules", "x");
    const state = async () => ({
      runs: scriptRuns(packageDir),
      projectLink: lstatSync(projectLink, { throwIfNoEntry: false })?.isSymbolicLink() ?? null,
      target: await file(join(packageDir, "linked", "x", "src.txt")).text(),
      globalLink: lstatSync(globalLink).isSymbolicLink(),
      throughGlobalLink: await file(join(globalLink, "src.txt")).text(),
    });
    const kept = { target: "keep me", globalLink: true, throughGlobalLink: "keep me" };

    for (const runs of [["x"], ["x", "x"]]) {
      const { stderr, exitCode } = await installCounted(packageDir, { env });
      expect(stderr).not.toContain("error:");
      expect(await state()).toEqual({ runs, projectLink: null, ...kept });
      expect(exitCode).toBe(0);
    }

    const { stderr, exitCode } = await installCounted(packageDir, { env, pass: true });
    expect(stderr).not.toContain("error:");
    expect(await state()).toEqual({ runs: ["x", "x", "x"], projectLink: true, ...kept });
    expect(exitCode).toBe(0);
  },
);

// Both linkers run them in the linked folder, when they make the link to it and when it becomes trusted.
describe.each(["isolated", "hoisted"] as const)("lifecycle scripts of a link: dependency (%s)", linker => {
  const linked = (scripts: object = countedScript("x")) => JSON.stringify({ name: "x", version: "1.0.0", scripts });
  const root = (extra: object = {}) =>
    JSON.stringify({ name: "link-scripts", dependencies: { x: "link:./vendor/x" }, ...extra });
  const trusted = { trustedDependencies: ["x"] };
  const blocked = "Blocked 1 postinstall. Run `bun pm untrusted` for details.";
  const isLinked = (...path: string[]) =>
    lstatSync(join(...path, "node_modules", "x"), { throwIfNoEntry: false }) !== undefined;

  test.concurrent("a trusted one: when it is linked, not on every install", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": root(trusted),
        "vendor/x/package.json": linked({
          ...countedScript("pre", "preinstall"),
          install: "echo built > built.txt",
          ...countedScript("post"),
        }),
      },
    });
    const once = ["post", "pre"];
    const removeLink = () => rm(join(packageDir, "node_modules", "x"), { recursive: true, force: true });
    const removeNodeModules = () => rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    for (const [args, before, times] of [
      [[], undefined, 1],
      [[], undefined, 1],
      [["--force"], undefined, 2],
      [[], removeLink, 3],
      [["--frozen-lockfile"], removeNodeModules, 4],
      [["--ignore-scripts"], removeNodeModules, 4],
      [[], undefined, 4],
    ] as const) {
      await before?.();
      const { stdout, stderr, exitCode } = await installCounted(packageDir, { args: [...args], pass: true });
      expect(stderr).not.toContain("error:");
      expect(stdout).not.toContain("Blocked");
      expect(scriptRuns(packageDir)).toEqual(
        Array.from({ length: times }, () => once)
          .flat()
          .sort(),
      );
      expect(exitCode).toBe(0);
    }
    expect((await file(join(packageDir, "vendor", "x", "built.txt")).text()).trim()).toBe("built");
  });

  test.concurrent("one that is not trusted is counted as blocked, and runs once it is trusted", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: { "package.json": root(), "vendor/x/package.json": linked() },
    });

    const first = await installCounted(packageDir, { pass: true });
    expect(first.stderr).not.toContain("error:");
    expect(first.stdout).toContain(blocked);
    expect(first.stdout).toContain("+ x@link:./vendor/x");
    expect(scriptRuns(packageDir)).toEqual([]);
    expect(first.exitCode).toBe(0);

    await write(packageJson, root(trusted));
    for (const _ of [1, 2]) {
      const { stdout, stderr, exitCode } = await installCounted(packageDir, { pass: true });
      expect(stderr).not.toContain("error:");
      expect(stdout).not.toContain("Blocked");
      expect(scriptRuns(packageDir)).toEqual(["x"]);
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("declared by a workspace member: another declaration does not run them again", async () => {
    const member = (name: string, links: boolean) =>
      JSON.stringify({ name, version: "1.0.0", dependencies: links ? { x: "link:../../vendor/x" } : {} });
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({ name: "link-scripts", workspaces: ["packages/*"], ...trusted }),
        "packages/a/package.json": member("a", false),
        "packages/b/package.json": member("b", true),
        "vendor/x/package.json": linked(),
      },
    });

    for (const declareMore of [
      async () => {},
      async () => {},
      () => write(join(packageDir, "packages", "a", "package.json"), member("a", true)),
      () => write(packageJson, root({ workspaces: ["packages/*"], ...trusted })),
    ]) {
      await declareMore();
      const { stderr, exitCode } = await installCounted(packageDir, { pass: true });
      expect(stderr).not.toContain("error:");
      expect(scriptRuns(packageDir)).toEqual(["x"]);
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("a failed script fails the install, and the next install runs it again", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: { "package.json": root(trusted), "vendor/x/package.json": linked(), "vendor/x/src.txt": "keep me" },
    });
    const state = async () => ({
      runs: scriptRuns(packageDir),
      link: isLinked(packageDir),
      src: await file(join(packageDir, "vendor", "x", "src.txt")).text(),
    });

    for (const runs of [["x"], ["x", "x"]]) {
      const { stderr, exitCode } = await installCounted(packageDir);
      expect(stderr).toContain('postinstall script from "x" exited with 1');
      expect(await state()).toEqual({ runs, link: false, src: "keep me" });
      expect(exitCode).toBe(1);
    }

    for (const _ of [1, 2]) {
      const { stderr, exitCode } = await installCounted(packageDir, { pass: true });
      expect(stderr).not.toContain("error:");
      expect(await state()).toEqual({ runs: ["x", "x", "x"], link: true, src: "keep me" });
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("a missing folder fails the install, and the scripts run once it exists", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: { "package.json": root(trusted), "vendor/x/package.json": linked() },
    });
    const lockfileOnly = await installCounted(packageDir, { args: ["--lockfile-only"] });
    expect(lockfileOnly.stderr).not.toContain("error:");
    expect(lockfileOnly.exitCode).toBe(0);

    renameSync(join(packageDir, "vendor", "x"), join(packageDir, "vendor", "away"));
    const missing = await installCounted(packageDir, { pass: true });
    expect(missing.stdout).toContain("Failed to install 1 package");
    expect({ runs: scriptRuns(packageDir), link: isLinked(packageDir) }).toEqual({ runs: [], link: false });
    expect(missing.exitCode).toBe(1);

    renameSync(join(packageDir, "vendor", "away"), join(packageDir, "vendor", "x"));
    const { stderr, exitCode } = await installCounted(packageDir, { pass: true });
    expect(stderr).not.toContain("error:");
    expect({ runs: scriptRuns(packageDir), link: isLinked(packageDir) }).toEqual({ runs: ["x"], link: true });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a trusted folder without a package.json has none", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: { "package.json": root(trusted), "vendor/x/index.js": "" },
    });

    // The second install reads bun.lock, which records no scripts.
    for (const _ of [1, 2]) {
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      const { stderr, exitCode } = await installCounted(packageDir, { pass: true });
      expect(stderr).not.toContain("error:");
      expect(isLinked(packageDir)).toBe(true);
      expect(exitCode).toBe(0);
    }
  });
});

// The hoisted linker links a package's bins before its lifecycle scripts run. When a script of an optional dependency
// fails, the bin links into the package are removed with it (like every link in that `.bin` whose target is gone, as
// with `bun remove` and `bun prune`). The links of other packages are kept.
describe.concurrent("bin links of a failed optional dependency (hoisted)", () => {
  const cli = "#!/usr/bin/env bun\n";

  // The bin names linked in `binDir`. On Windows a bin link is the pair `<name>.exe` + `<name>.bunx`.
  async function linkedBins(binDir: string): Promise<string[]> {
    if (!existsSync(binDir)) return [];
    const entries = await readdirSorted(binDir);
    return [...new Set(isWindows ? entries.map(entry => entry.replace(/\.(exe|bunx)$/, "")) : entries)].sort();
  }

  // The package that `node_modules/.bin/<name>` links into. A `.bunx` file starts with the target path.
  function binOwner(nodeModules: string, name: string): string {
    if (isWindows) {
      const shim = readFileSync(join(nodeModules, ".bin", `${name}.bunx`)).toString("utf16le");
      return shim.slice(0, shim.indexOf("\\"));
    }
    return readlinkSync(join(nodeModules, ".bin", name)).split("/")[1];
  }

  // A bin link into a package that is not installed.
  async function linkMissingPackage(binDir: string, name: string) {
    await mkdir(binDir, { recursive: true });
    if (isWindows) {
      await write(join(binDir, `${name}.bunx`), Buffer.from('gone\\cli.js"', "utf16le"));
      await write(join(binDir, `${name}.exe`), "");
    } else {
      await symlink(join("..", "gone", "cli.js"), join(binDir, name));
    }
  }

  const failing = (name: string, manifest: object, script: "preinstall" | "postinstall" = "postinstall") =>
    JSON.stringify({ name, version: "1.0.0", ...manifest, scripts: { [script]: "exit 1" } });

  const tarball = (manifest: string) =>
    new Bun.Archive({ "package/package.json": manifest, "package/cli.js": cli }, { compress: "gzip" }).bytes();

  // With one script at a time, the linker starts the later scripts from another call site.
  test.concurrent.each([
    ["", []],
    [", one script at a time", ["--concurrent-scripts", "1"]],
  ])("every form of `bin` is unlinked, other links stay%s", async (_, args) => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "optional-bins",
          dependencies: { ok: "file:./ok", "str-keep": "file:./str-keep" },
          optionalDependencies: {
            str: "file:./str",
            map: "file:./map",
            dir: "file:./dir",
            "@scope/pkg": "file:./scoped",
            nobin: "file:./nobin",
          },
          trustedDependencies: ["str", "map", "dir", "@scope/pkg", "nobin"],
        }),
        "ok/package.json": JSON.stringify({ name: "ok", version: "1.0.0", bin: "cli.js" }),
        "ok/cli.js": cli,
        // The name of this folder starts with the name of a folder that is removed.
        "str-keep/package.json": JSON.stringify({ name: "str-keep", version: "1.0.0", bin: "cli.js" }),
        "str-keep/cli.js": cli,
        "str/package.json": failing("str", { bin: "cli.js" }),
        "str/cli.js": cli,
        "map/package.json": failing("map", { bin: { "map-one": "cli.js", "map-two": "cli.js" } }, "preinstall"),
        "map/cli.js": cli,
        // The names of these bins are the file names in the folder, and the script removes the folder.
        "dir/package.json": JSON.stringify({
          name: "dir",
          version: "1.0.0",
          directories: { bin: "tools" },
          scripts: { postinstall: "rm -rf tools && exit 1" },
        }),
        "dir/tools/dir-one": cli,
        "dir/tools/dir-two": cli,
        "scoped/package.json": failing("@scope/pkg", { bin: "cli.js" }),
        "scoped/cli.js": cli,
        "nobin/package.json": failing("nobin", {}),
      },
    });
    const nodeModules = join(packageDir, "node_modules");
    await linkMissingPackage(join(nodeModules, ".bin"), "stale");

    const { stderr, exitCode } = await installCounted(packageDir, { args });

    expect(stderr).not.toContain("error:");
    expect({
      installed: ["ok", "str-keep", "str", "map", "dir", "@scope/pkg", "nobin"].filter(name =>
        existsSync(join(nodeModules, name)),
      ),
      bins: await linkedBins(join(nodeModules, ".bin")),
    }).toEqual({ installed: ["ok", "str-keep"], bins: ["ok", "str-keep"] });
    expect(exitCode).toBe(0);
  });

  // The root has another q, so the q of w is placed in packages/w/node_modules.
  const nestedManifests = (rootQ: string, nestedQ: string, workspaces = ["w"]) => ({
    "package.json": JSON.stringify({
      name: "optional-bin-nested",
      workspaces: ["packages/*"],
      dependencies: { q: rootQ },
      trustedDependencies: ["q"],
    }),
    ...Object.fromEntries(
      workspaces.map(name => [
        `packages/${name}/package.json`,
        JSON.stringify({ name, version: "1.0.0", optionalDependencies: { q: nestedQ } }),
      ]),
    ),
  });
  const rootQ = JSON.stringify({ name: "q", version: "1.0.0", bin: "cli.js" });
  const nestedQ = failing("q", { version: "2.0.0", bin: "cli.js" }, "preinstall");
  const nestedState = async (packageDir: string, workspace = "w") => ({
    rootBins: await linkedBins(join(packageDir, "node_modules", ".bin")),
    nestedBins: await linkedBins(join(packageDir, "packages", workspace, "node_modules", ".bin")),
    nestedInstalled: existsSync(join(packageDir, "packages", workspace, "node_modules", "q")),
  });
  const nestedRemoved = { rootBins: ["q"], nestedBins: [], nestedInstalled: false };

  test.concurrent("a nested node_modules loses the link, the root keeps its link of the same name", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        ...nestedManifests("file:./q-root", "file:../../q-nested"),
        "q-root/package.json": rootQ,
        "q-root/cli.js": cli,
        "q-nested/package.json": nestedQ,
        "q-nested/cli.js": cli,
      },
    });

    const { stderr, exitCode } = await installCounted(packageDir);

    expect(stderr).not.toContain("error:");
    expect(await nestedState(packageDir)).toEqual(nestedRemoved);
    expect(exitCode).toBe(0);
  });

  // With a lockfile and a cold cache, the install phase extracts the package and places it from another call site.
  test.concurrent("a package that the install phase extracts", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: nestedManifests("file:./q-1.0.0.tgz", "file:../../q-2.0.0.tgz"),
    });
    await write(join(packageDir, "q-1.0.0.tgz"), await tarball(rootQ));
    await write(join(packageDir, "q-2.0.0.tgz"), await tarball(nestedQ));

    const resolved = await installCounted(packageDir, { args: ["--lockfile-only"] });
    expect(resolved.stderr).not.toContain("error:");
    expect(resolved.exitCode).toBe(0);
    await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });

    const { stderr, exitCode } = await installCounted(packageDir);

    expect(stderr).not.toContain("error:");
    expect(await nestedState(packageDir)).toEqual(nestedRemoved);
    expect(exitCode).toBe(0);
  });

  // Here, the `.bin` of w2 is a link to the root's `.bin`, which has the link of the root's q.
  test.concurrent.skipIf(isWindows)("nothing is removed through a `.bin` that is a link", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        ...nestedManifests("file:./q-root", "file:../../q-nested", ["w1", "w2"]),
        "q-root/package.json": rootQ,
        "q-root/cli.js": cli,
        "q-nested/package.json": nestedQ,
        "q-nested/cli.js": cli,
      },
    });
    const rootBin = join(packageDir, "node_modules", ".bin");
    await mkdir(rootBin, { recursive: true });
    await mkdir(join(packageDir, "packages", "w2", "node_modules"), { recursive: true });
    await symlink(rootBin, join(packageDir, "packages", "w2", "node_modules", ".bin"));

    const { stderr, exitCode } = await installCounted(packageDir);

    expect(stderr).not.toContain("error:");
    expect(await nestedState(packageDir, "w1")).toEqual(nestedRemoved);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a workspace that the filter reaches only through an optional dependency", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({ name: "optional-bin-workspace", workspaces: ["packages/*"] }),
        "packages/x/package.json": failing("x", { bin: { xbin: "cli.js" } }),
        "packages/x/cli.js": cli,
        "packages/y/package.json": JSON.stringify({
          name: "y",
          version: "1.0.0",
          optionalDependencies: { x: "workspace:*" },
        }),
      },
    });
    const nodeModules = join(packageDir, "node_modules");

    const { stderr, exitCode } = await installCounted(packageDir, { args: ["--filter", "y"] });

    expect(stderr).not.toContain("error:");
    expect({
      bins: await linkedBins(join(nodeModules, ".bin")),
      link: lstatSync(join(nodeModules, "x"), { throwIfNoEntry: false }) !== undefined,
      source: existsSync(join(packageDir, "packages", "x", "cli.js")),
    }).toEqual({ bins: [], link: false, source: true });
    expect(exitCode).toBe(0);
  });

  // The first package in name order links a bin name that two packages declare.
  test.concurrent("a bin name that two packages declare stays with the package that linked it", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "optional-bin-collision",
          dependencies: { a1: "file:./a1", z2: "file:./z2" },
          optionalDependencies: { z1: "file:./z1", a2: "file:./a2" },
          trustedDependencies: ["z1", "a2"],
        }),
        "a1/package.json": JSON.stringify({ name: "a1", version: "1.0.0", bin: { one: "cli.js" } }),
        "a1/cli.js": cli,
        "z1/package.json": failing("z1", { bin: { one: "cli.js", "z1-own": "cli.js" } }),
        "z1/cli.js": cli,
        "a2/package.json": failing("a2", { bin: { two: "cli.js", "a2-own": "cli.js" } }),
        "a2/cli.js": cli,
        "z2/package.json": JSON.stringify({ name: "z2", version: "1.0.0", bin: { two: "cli.js", "z2-own": "cli.js" } }),
        "z2/cli.js": cli,
      },
    });
    const nodeModules = join(packageDir, "node_modules");

    const { stderr, exitCode } = await installCounted(packageDir);

    expect(stderr).not.toContain("error:");
    // `one` is the link of a1, so the failure of z1 leaves it. `two` was the link of a2. It is not
    // linked again for z2, which is a gap: z2 declares it. npm leaves the same state.
    expect(await linkedBins(join(nodeModules, ".bin"))).toEqual(["one", "z2-own"]);
    expect(binOwner(nodeModules, "one")).toBe("a1");
    expect(exitCode).toBe(0);
  });

  // The folder that is removed has the name of the dependency, not the name of the package.
  test.concurrent("a dependency name that is another package's name", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "optional-bin-alias",
          dependencies: { x: "file:./healthy-x" },
          optionalDependencies: { al: "file:./x-1.0.0.tgz" },
          trustedDependencies: ["al"],
        }),
        "healthy-x/package.json": JSON.stringify({ name: "x", version: "2.0.0", bin: { hx: "cli.js" } }),
        "healthy-x/cli.js": cli,
      },
    });
    await write(join(packageDir, "x-1.0.0.tgz"), await tarball(failing("x", { bin: "cli.js" })));
    const nodeModules = join(packageDir, "node_modules");

    const { stderr, exitCode } = await installCounted(packageDir);

    expect(stderr).not.toContain("error:");
    expect({
      installed: ["al", "x"].filter(name => existsSync(join(nodeModules, name))),
      bins: await linkedBins(join(nodeModules, ".bin")),
    }).toEqual({ installed: ["x"], bins: ["hx"] });
    expect(binOwner(nodeModules, "hx")).toBe("x");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a dependency that is trusted after it was installed", async () => {
    const manifest = { name: "optional-bin-late-trust", optionalDependencies: { x: "file:./x-1.0.0.tgz" } };
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: { "package.json": JSON.stringify(manifest) },
    });
    await write(join(packageDir, "x-1.0.0.tgz"), await tarball(failing("x", { bin: { xbin: "cli.js" } })));
    const nodeModules = join(packageDir, "node_modules");
    const state = async () => ({
      bins: await linkedBins(join(nodeModules, ".bin")),
      installed: existsSync(join(nodeModules, "x")),
    });

    // The script is blocked, so the install keeps x and its bin.
    const blocked = await installCounted(packageDir);
    expect(blocked.stderr).not.toContain("error:");
    expect(await state()).toEqual({ bins: ["xbin"], installed: true });
    expect(blocked.exitCode).toBe(0);

    await write(packageJson, JSON.stringify({ ...manifest, trustedDependencies: ["x"] }));
    const trusted = await installCounted(packageDir);
    expect(trusted.stderr).not.toContain("error:");
    expect(await state()).toEqual({ bins: [], installed: false });
    expect(trusted.exitCode).toBe(0);
  });

  // With SIGCHLD ignored, Linux reaps the script itself and bun cannot wait for it. Bun then
  // treats a script that exited 0 as failed, through a second exit path.
  test.concurrent.skipIf(!isLinux)("a script that bun cannot wait for", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "optional-bin-cannot-wait",
          optionalDependencies: { x: "file:./x" },
          trustedDependencies: ["x"],
        }),
        "x/package.json": JSON.stringify({
          name: "x",
          version: "1.0.0",
          bin: { xbin: "cli.js" },
          scripts: { postinstall: "exit 0" },
        }),
        "x/cli.js": cli,
      },
    });
    const nodeModules = join(packageDir, "node_modules");

    const { stderr, exitCode } = await installCounted(packageDir, {
      argv0: ["bash", "-c", 'trap "" CHLD; exec "$0" "$@"'],
      args: ["--verbose"],
    });

    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("deleting optional dependency 'x' due to failed 'postinstall' script");
    expect({
      bins: await linkedBins(join(nodeModules, ".bin")),
      installed: existsSync(join(nodeModules, "x")),
    }).toEqual({ bins: [], installed: false });
    expect(exitCode).toBe(0);
  });

  // The links are removed when the script fails, not when the install ends, because a later failure ends the install
  // immediately. Here, the required script waits for the optional package and its link to be removed. When it fails,
  // its own package is removed too, so that the next install runs it again.
  test.concurrent("an install that a required script ends afterwards", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify({
          name: "optional-bin-abort",
          dependencies: { req: "file:./req" },
          optionalDependencies: { opt: "file:./opt" },
          trustedDependencies: ["req", "opt"],
        }),
        "opt/package.json": failing("opt", { bin: { optbin: "cli.js" } }),
        "opt/cli.js": cli,
        "req/package.json": JSON.stringify({
          name: "req",
          version: "1.0.0",
          bin: { reqbin: "cli.js" },
          scripts: { postinstall: `${bunExe()} wait.js` },
        }),
        "req/cli.js": cli,
        "req/wait.js": `
          const { existsSync, readdirSync, writeFileSync } = require("fs");
          const deadline = Date.now() + 30_000;
          const left = () => [...readdirSync("../.bin"), ...readdirSync("..")].filter(name => name.startsWith("opt"));
          while (left().length > 0 && Date.now() < deadline) Bun.sleepSync(5);
          writeFileSync("../../left.json", JSON.stringify(left()));
          process.exit(7);
        `,
      },
    });
    const nodeModules = join(packageDir, "node_modules");

    const { stderr, exitCode } = await installCounted(packageDir);

    expect(stderr).toContain('postinstall script from "req" exited with 7');
    expect({
      leftWhileTheScriptRan: await file(join(packageDir, "left.json")).json(),
      bins: await linkedBins(join(nodeModules, ".bin")),
      installed: ["opt", "req"].filter(name => existsSync(join(nodeModules, name))),
    }).toEqual({ leftWhileTheScriptRan: [], bins: [], installed: [] });
    expect(exitCode).toBe(7);
  });

  // A native dependency links its bin into its platform package. That link is removed together with the platform
  // package, which doesn't declare a bin itself.
  test.concurrent("the bin of a native dependency that links into the removed platform package", async () => {
    const packages: Record<string, object> = {
      m: { bin: { mcmd: "cli.js" }, optionalDependencies: { p: "1.0.0" } },
      p: { os: ["darwin", "linux", "win32"], cpu: ["arm64", "x64"], scripts: { postinstall: "exit 1" } },
    };
    const tarballs: Record<string, Uint8Array> = {};
    for (const [name, fields] of Object.entries(packages)) {
      tarballs[name] = await tarball(JSON.stringify({ name, version: "1.0.0", ...fields }));
    }
    await using server = Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        const tarballOf = pathname.match(/^\/(.+)-1\.0\.0\.tgz$/)?.[1];
        const name = tarballOf ?? pathname.slice(1);
        if (!(name in packages)) return new Response("not found", { status: 404 });
        if (tarballOf) return new Response(tarballs[name]);
        const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tarballs[name]).digest("base64");
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name,
              version: "1.0.0",
              ...packages[name],
              dist: { tarball: `${origin}/${name}-1.0.0.tgz`, integrity },
            },
          },
        });
      },
    });
    using dir = tempDir("optional-bin-native", {
      "package.json": JSON.stringify({
        name: "optional-bin-native",
        dependencies: { m: "1.0.0" },
        nativeDependencies: ["m"],
        trustedDependencies: ["p"],
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href, linker: "hoisted" } }),
    });
    const packageDir = String(dir);
    const nodeModules = join(packageDir, "node_modules");

    const { stderr, exitCode } = await installCounted(packageDir, {
      env: installEnv(packageDir),
    });

    expect(stderr).not.toContain("error:");
    expect({
      installed: ["m", "p"].filter(name => existsSync(join(nodeModules, name))),
      bins: await linkedBins(join(nodeModules, ".bin")),
    }).toEqual({ installed: ["m"], bins: [] });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("blocked lifecycle scripts", () => {
  const blockedLine = "Blocked 4 postinstalls. Run `bun pm untrusted` for details.";

  async function createUntrustedScriptsDir(bunfigOpts: { linker: "isolated"; globalStore?: boolean }) {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts });
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-blocked-scripts",
        dependencies: {
          // one postinstall
          "lifecycle-postinstall": "1.0.0",
          // preinstall, install and postinstall
          "all-lifecycle-scripts": "1.0.0",
          // no scripts
          "no-deps": "1.0.0",
        },
      }),
    );
    return packageDir;
  }

  test.concurrent("are reported in the install summary like the hoisted linker does", async () => {
    const packageDir = await createUntrustedScriptsDir({ linker: "isolated" });

    const { out } = await runBunInstall(installEnv(packageDir), packageDir);

    expect(out).toContain(blockedLine);
    expect(existsSync(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeFalse();
    expect(existsSync(join(packageDir, "node_modules", "all-lifecycle-scripts", "postinstall.txt"))).toBeFalse();
  });

  test.concurrent("are not reported for trusted packages", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-blocked-scripts-trusted",
        dependencies: { "lifecycle-postinstall": "1.0.0" },
        trustedDependencies: ["lifecycle-postinstall"],
      }),
    );

    const { out } = await runBunInstall(installEnv(packageDir), packageDir);

    expect(out).not.toContain("Blocked");
    expect(existsSync(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
  });

  test.concurrent("are still reported with --ignore-scripts", async () => {
    const packageDir = await createUntrustedScriptsDir({ linker: "isolated" });

    await using proc = spawn({
      cmd: [bunExe(), "install", "--ignore-scripts"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(out).toContain(blockedLine);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test.concurrent("are reported for packages installed into the global store", async () => {
    const packageDir = await createUntrustedScriptsDir({ linker: "isolated", globalStore: true });

    const { out } = await runBunInstall(installEnv(packageDir), packageDir);

    expect(out).toContain(blockedLine);
    // Untrusted packages are eligible for the global store, so this is the
    // path that bypasses script enqueueing entirely.
    expect(lstatSync(join(packageDir, "node_modules", ".bun", "lifecycle-postinstall@1.0.0")).isSymbolicLink()).toBe(
      true,
    );
  });

  test.concurrent("are reported to each project that links packages the global store already has", async () => {
    const first = await createUntrustedScriptsDir({ linker: "isolated", globalStore: true });
    const second = await createUntrustedScriptsDir({ linker: "isolated", globalStore: true });
    const env = installEnv(first);
    const summary = (out: string) =>
      out
        .replace(/ \[[\d.]+m?s\]/, "")
        .split("\n")
        .slice(1)
        .filter(Boolean);
    const expected = summary((await runBunInstall(env, first)).out);
    expect(expected).toContain(blockedLine);

    expect(summary((await runBunInstall(env, second)).out)).toEqual(expected);
    expect((await runBunInstall(env, second, { savesLockfile: false })).out).toContain("(no changes)");
  });
});

// Self-contained HTTP server that serves package manifests & tarballs
// directly from the registry fixtures, with Cache-Control: max-age=300
// to replicate npmjs.org behavior (fully synchronous on warm cache).
function serveFixtures() {
  const packagesDir = join(import.meta.dir, "registry", "packages");
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const pathname = new URL(req.url).pathname;

      // Tarball: /<name>/-/<name>-<version>.tgz
      if (pathname.endsWith(".tgz")) {
        const match = pathname.match(/\/([^/]+)\/-\/(.+\.tgz)$/);
        if (match) {
          const tarball = file(join(packagesDir, match[1], match[2]));
          if (await tarball.exists()) {
            return new Response(tarball, {
              headers: { "Content-Type": "application/octet-stream" },
            });
          }
        }
        return new Response("Not found", { status: 404 });
      }

      // Manifest: /<name>
      const packageName = decodeURIComponent(pathname.slice(1));
      const metaFile = file(join(packagesDir, packageName, "package.json"));
      if (!(await metaFile.exists())) {
        return new Response("Not found", { status: 404 });
      }

      // Rewrite tarball URLs to point at this server
      const meta = await metaFile.json();
      for (const [ver, info] of Object.entries(meta.versions ?? {}) as [string, any][]) {
        if (info?.dist?.tarball) {
          info.dist.tarball = `http://localhost:${server.port}/${packageName}/-/${packageName}-${ver}.tgz`;
        }
      }

      return new Response(JSON.stringify(meta), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
    },
  });
  return server;
}

// When an auto-installed peer dependency has its OWN peer deps, those
// transitive peers get re-queued during peer processing. If all manifest
// loads are synchronous (cached with valid max-age) AND the transitive peer's
// version constraint doesn't match what's already in the lockfile,
// pendingTaskCount() stays at 0 and waitForPeers was skipped — leaving
// the transitive peer's resolution unset (= invalid_package_id → filtered
// from the install).
test.concurrent("transitive peer deps are resolved when resolution is fully synchronous", async () => {
  using server = serveFixtures();

  using packageDir = tempDir("transitive-peer-test-", {});
  const packageJson = join(String(packageDir), "package.json");
  const cacheDir = join(String(packageDir), ".bun-cache");
  const bunfig = Bun.TOML.stringify({
    install: {
      cache: cacheDir,
      registry: `http://localhost:${server.port}/`,
      linker: "isolated",
    },
  });
  await write(join(String(packageDir), "bunfig.toml"), bunfig);

  await write(
    packageJson,
    JSON.stringify({
      name: "test-transitive-peer",
      dependencies: {
        // Chain: uses-strict-peer → (peer) strict-peer-dep → (peer) no-deps@^2.0.0
        // Root has no-deps@1.0.0, which does NOT satisfy ^2.0.0. This forces
        // strict-peer-dep's peer `no-deps` through the full resolution pass
        // (can't reuse root's no-deps via getPackageID).
        "no-deps": "1.0.0",
        "uses-strict-peer": "1.0.0",
      },
    }),
  );

  // First install: populates manifest cache (with max-age=300 from server)
  await runBunInstall(installEnv(String(packageDir)), String(packageDir), { allowWarnings: true });

  // Second install with NO lockfile and WARM cache. Manifests are fresh
  // (within max-age) so all loads are synchronous — this is the bug trigger.
  await rm(join(String(packageDir), "node_modules"), { recursive: true, force: true });
  await rm(join(String(packageDir), "bun.lock"), { force: true });
  await runBunInstall(installEnv(String(packageDir)), String(packageDir), { allowWarnings: true });

  // Entry names have peer hashes; find them dynamically
  const bunDir = join(String(packageDir), "node_modules", ".bun");
  const entries = await readdirSorted(bunDir);
  const strictPeerEntry = entries.find(e => e.startsWith("strict-peer-dep@1.0.0"));
  const usesStrictEntry = entries.find(e => e.startsWith("uses-strict-peer@1.0.0"));

  // strict-peer-dep must exist (auto-installed via uses-strict-peer's peer)
  expect(strictPeerEntry).toBeDefined();
  expect(usesStrictEntry).toBeDefined();

  // strict-peer-dep's own peer `no-deps` must be resolved and symlinked.
  // Without the fix: this symlink is missing because the transitive peer
  // queue was never drained after drainDependencyList re-queued it.
  expect(existsSync(join(bunDir, strictPeerEntry!, "node_modules", "no-deps"))).toBe(true);

  // Verify the chain is intact
  expect(withoutEntryHash(readlinkSync(join(bunDir, usesStrictEntry!, "node_modules", "strict-peer-dep")))).toBe(
    join("..", "..", strictPeerEntry!, "node_modules", "strict-peer-dep"),
  );
});

// https://github.com/oven-sh/bun/issues/40466
// Two registry URLs sharing one install cache. The extracted-tarball cache key
// has no port, so the warmup's strict-peer-dep tarball is reused by the second
// registry, while the manifest cache is keyed by registry URL hash and is not.
// The cold install then fetches strict-peer-dep's manifest as its last pending
// task, resolves the package with no new task (tarball already extracted), and
// defers its peer `no-deps@^2.0.0`. Without the fix nothing wakes the wait
// loop again and `bun install` hangs in "Resolving dependencies" forever.
test.concurrent("transitive peer resolves when its tarball is cached from another registry", async () => {
  using serverA = serveFixtures();
  using serverB = serveFixtures();

  using root = tempDir("transitive-peer-two-registries-", {
    "warmup/package.json": JSON.stringify({
      name: "warmup",
      dependencies: { "strict-peer-dep": "1.0.0" },
    }),
    "cold/package.json": JSON.stringify({
      name: "cold",
      dependencies: { "no-deps": "1.0.0", "uses-strict-peer": "1.0.0" },
    }),
  });
  const env = installEnv(String(root));
  const bunfig = (port: number) => `[install]\nregistry = "http://localhost:${port}/"\nlinker = "isolated"\n`;
  await write(join(String(root), "warmup", "bunfig.toml"), bunfig(serverA.port!));
  await write(join(String(root), "cold", "bunfig.toml"), bunfig(serverB.port!));

  // Caches strict-peer-dep's manifest (registry A's URL hash) and extracts its
  // tarball (shared across registries).
  await runBunInstall(env, join(String(root), "warmup"), { allowWarnings: true });

  // Hangs forever without the fix.
  await runBunInstall(env, join(String(root), "cold"), { allowWarnings: true });

  const bunDir = join(String(root), "cold", "node_modules", ".bun");
  const entries = await readdirSorted(bunDir);
  const strictPeerEntry = entries.find(e => e.startsWith("strict-peer-dep@1.0.0"));
  const usesStrictEntry = entries.find(e => e.startsWith("uses-strict-peer@1.0.0"));
  expect(strictPeerEntry).toBeDefined();
  expect(usesStrictEntry).toBeDefined();

  // The deferred transitive peer must end up resolved and linked.
  expect(existsSync(join(bunDir, strictPeerEntry!, "node_modules", "no-deps"))).toBe(true);
  expect(withoutEntryHash(readlinkSync(join(bunDir, usesStrictEntry!, "node_modules", "strict-peer-dep")))).toBe(
    join("..", "..", strictPeerEntry!, "node_modules", "strict-peer-dep"),
  );
});

// https://github.com/oven-sh/bun/issues/36987
// A tarball URL with a query string must not put a literal `?` in the .bun
// store directory name: module resolution parses `?` as a query-string
// delimiter (truncating the path), and `?` is invalid in Windows filenames.
// (The query string is now left out of the name altogether, see "store entry
// names of URL dependencies" below.)
test.concurrent("tarball URL with query string resolves at runtime", async () => {
  const tarball = file(join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz"));

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname !== "/pkg.tgz") {
        return new Response("Not found", { status: 404 });
      }
      return new Response(tarball, {
        headers: { "Content-Type": "application/octet-stream" },
      });
    },
  });

  const url = `http://localhost:${server.port}/pkg.tgz?x=y`;
  using packageDir = tempDir("tarball-query-test-", {
    "bunfig.toml": `[install]\nlinker = "isolated"\n`,
    "package.json": JSON.stringify({
      name: "test-tarball-query",
      dependencies: {
        "no-deps": url,
      },
    }),
    "index.mjs": `import pkg from "no-deps";\nconsole.log(pkg.version);`,
  });

  await runBunInstall(installEnv(String(packageDir)), String(packageDir));

  const bunDir = join(String(packageDir), "node_modules", ".bun");
  const storeEntries = (await readdirSorted(bunDir)).filter(entry => entry !== "node_modules");
  expect(storeEntries).toEqual([
    `no-deps@http+++localhost+${server.port}+pkg.tgz+${urlHash(url)}${noDepsPin("1.0.0")}`,
  ]);

  await using proc = spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(packageDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("1.0.0\n");
  expect(exitCode).toBe(0);
});

// The resolution part of a store entry name (`<name>@<resolution>`) embeds
// folder paths, tarball URLs and git URLs verbatim. `write_resolution` in
// src/install/isolated_install/Store.rs bounds it: a resolution longer than
// MAX_RESOLUTION_LEN bytes is cut and suffixed with `+` and the wyhash of the
// full text. Unbounded, the entry's absolute path passes MAX_PATH on Windows,
// where the package's lifecycle scripts then fail to spawn with ENOENT, and a
// resolution longer than NAME_MAX cannot be created at all.
describe.concurrent("long store entry names", () => {
  async function storeEntries(packageDir: string): Promise<string[]> {
    return (await readdirSorted(join(packageDir, "node_modules", ".bun"))).filter(entry => entry !== "node_modules");
  }

  test("a resolution at the limit is kept verbatim, a longer one is cut and hashed", async () => {
    // `file+` plus this folder name is exactly MAX_RESOLUTION_LEN bytes; the
    // other three folders are one byte longer.
    const atLimit = Buffer.alloc(MAX_RESOLUTION_LEN - "file+".length, "a").toString();
    const pastLimit = `${atLimit}b`;
    // Two resolutions of the same package that only differ after the cut
    // point: the hash is what keeps their entries apart.
    const sharedPrefix1 = `${atLimit}1`;
    const sharedPrefix2 = `${atLimit}2`;

    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        [`${atLimit}/package.json`]: JSON.stringify({ name: "at-limit", version: "1.0.0" }),
        [`${pastLimit}/package.json`]: JSON.stringify({ name: "past-limit", version: "1.0.0" }),
        [`${sharedPrefix1}/package.json`]: JSON.stringify({ name: "shared-prefix", version: "1.0.0" }),
        [`${sharedPrefix2}/package.json`]: JSON.stringify({ name: "shared-prefix", version: "2.0.0" }),
      },
    });
    await write(
      packageJson,
      JSON.stringify({
        name: "test-long-store-entry-names",
        dependencies: {
          "at-limit": `file:./${atLimit}`,
          "past-limit": `file:./${pastLimit}`,
          "shared-prefix-1": `file:./${sharedPrefix1}`,
          "shared-prefix-2": `file:./${sharedPrefix2}`,
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const pastLimitEntry = storeEntryName("past-limit", `file+${pastLimit}`);
    expect(pastLimitEntry).toMatch(/^past-limit@file\+a{58}\+[0-9a-f]{16}$/);
    const expectedEntries = [
      `at-limit@file+${atLimit}`,
      pastLimitEntry,
      storeEntryName("shared-prefix", `file+${sharedPrefix1}`),
      storeEntryName("shared-prefix", `file+${sharedPrefix2}`),
    ].sort();
    expect(await storeEntries(packageDir)).toEqual(expectedEntries);

    expect(readlinkSync(join(packageDir, "node_modules", "past-limit"))).toBe(
      join(".bun", pastLimitEntry, "node_modules", "past-limit"),
    );
    expect(
      await Promise.all(
        ["at-limit", "past-limit", "shared-prefix-1", "shared-prefix-2"].map(alias =>
          file(join(packageDir, "node_modules", alias, "package.json")).json(),
        ),
      ),
    ).toEqual([
      { name: "at-limit", version: "1.0.0" },
      { name: "past-limit", version: "1.0.0" },
      { name: "shared-prefix", version: "1.0.0" },
      { name: "shared-prefix", version: "2.0.0" },
    ]);

    // The cut name is a pure function of the resolution, so the next install
    // finds the same entries again.
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await storeEntries(packageDir)).toEqual(expectedEntries);
  });

  test("the peer hash is appended after the cut resolution", async () => {
    const folder = Buffer.alloc(MAX_RESOLUTION_LEN, "p").toString();
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        [`${folder}/package.json`]: JSON.stringify({
          name: "has-peer",
          version: "1.0.0",
          peerDependencies: { "no-deps": "1.0.0" },
        }),
      },
    });
    await write(
      packageJson,
      JSON.stringify({
        name: "test-long-store-entry-name-with-peer",
        dependencies: { "has-peer": `file:./${folder}`, "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    // `+7347ae2d86f1441a` is the hash of the peer set `no-deps@1.0.0`.
    const entry = `${storeEntryName("has-peer", `file+${folder}`)}+7347ae2d86f1441a`;
    expect(await storeEntries(packageDir)).toEqual([entry, "no-deps@1.0.0"]);
    expect(
      await file(join(packageDir, "node_modules", ".bun", entry, "node_modules", "no-deps", "package.json")).json(),
    ).toEqual({ name: "no-deps", version: "1.0.0" });
  });

  test("a cut that would split a multi-byte character backs up to the character boundary", async () => {
    // `file+x` is 6 bytes and every character after it is 2 bytes wide, so
    // byte 63 of the resolution falls inside a character and the cut ends at
    // byte 62: 28 characters after `file+x`. The hash covers the full
    // resolution.
    const folder = `x${Buffer.alloc(40 * 2, "\u00e9").toString()}`;
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: { [`${folder}/package.json`]: JSON.stringify({ name: "non-ascii", version: "1.0.0" }) },
    });
    await write(
      packageJson,
      JSON.stringify({ name: "test-non-ascii-store-entry-name", dependencies: { "non-ascii": `file:./${folder}` } }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const entry = `non-ascii@file+x${Buffer.alloc(28 * 2, "é").toString()}+${urlHash(`file+${folder}`)}`;
    expect(Buffer.byteLength(entry.slice("non-ascii@".length, -"+0123456789abcdef".length))).toBe(
      CUT_RESOLUTION_LEN - 1,
    );
    expect(await storeEntries(packageDir)).toEqual([entry]);
    expect(readlinkSync(join(packageDir, "node_modules", "non-ascii"))).toBe(
      join(".bun", entry, "node_modules", "non-ascii"),
    );
    expect(await file(join(packageDir, "node_modules", "non-ascii", "package.json")).json()).toEqual({
      name: "non-ascii",
      version: "1.0.0",
    });
  });

  // Spelling each byte as a character turned the UTF-8 `ñ` (c3 b1) into `Ã±` (c3 83 c2 b1).
  test("a folder dependency under a non-ASCII directory keeps its UTF-8 bytes", async () => {
    const folder = "paquetes/añadir";
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: { [`${folder}/package.json`]: JSON.stringify({ name: "anadir", version: "1.0.0" }) },
    });
    await write(
      packageJson,
      JSON.stringify({ name: "test-non-ascii-folder", dependencies: { anadir: `file:./${folder}` } }),
    );

    // The second install derives the name from the lockfile.
    for (const savesLockfile of [true, false]) {
      await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile });

      const entry = "anadir@file+paquetes+añadir";
      expect(await storeEntries(packageDir)).toEqual([entry]);
      expect(readlinkSync(join(packageDir, "node_modules", "anadir"))).toBe(
        join(".bun", entry, "node_modules", "anadir"),
      );
    }
    expect(await file(join(packageDir, "node_modules", "anadir", "package.json")).json()).toEqual({
      name: "anadir",
      version: "1.0.0",
    });
  });

  test("a local tarball and a folder in a deep directory install when their paths are longer than NAME_MAX", async () => {
    // Every directory on the way is short; only the resolution, which is the
    // whole relative path (257 bytes here), would make the entry name longer
    // than NAME_MAX. Unbounded, the install fails with ENAMETOOLONG.
    const segment = Buffer.alloc(85, "d").toString();
    const deep = `${segment}/${segment}/${segment}`;
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        [`${deep}/bar-0.0.2.tgz`]: readFileSync(join(import.meta.dir, "bar-0.0.2.tgz")),
        [`${deep}/pkg/package.json`]: JSON.stringify({ name: "folder-pkg", version: "1.0.0" }),
      },
    });
    await write(
      packageJson,
      JSON.stringify({
        name: "test-deep-local-tarball-and-folder",
        dependencies: {
          "bar": `file:./${deep}/bar-0.0.2.tgz`,
          "folder-pkg": `file:./${deep}/pkg`,
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const tarballEntry =
      storeEntryName("bar", `.+${deep.replaceAll("/", "+")}+bar-0.0.2.tgz`) + tarballPin("bar-0.0.2.tgz");
    const folderEntry = storeEntryName("folder-pkg", `file+${deep.replaceAll("/", "+")}+pkg`);
    expect(tarballEntry).toMatch(/^bar@\.\+d{61}(\+[0-9a-f]{16}){2}$/);
    expect(folderEntry).toMatch(/^folder-pkg@file\+d{58}\+[0-9a-f]{16}$/);
    const expectedEntries = [tarballEntry, folderEntry].sort();
    expect(await storeEntries(packageDir)).toEqual(expectedEntries);

    const bunDir = join(packageDir, "node_modules", ".bun");
    expect(
      await Promise.all([
        readlink(join(packageDir, "node_modules", "bar")),
        readlink(join(packageDir, "node_modules", "folder-pkg")),
        // The `.bun/node_modules` fallback directory links to the cut name too.
        readlink(join(bunDir, "node_modules", "bar")),
        file(join(packageDir, "node_modules", "bar", "package.json")).json(),
        file(join(packageDir, "node_modules", "folder-pkg", "package.json")).json(),
      ]),
    ).toEqual([
      join(".bun", tarballEntry, "node_modules", "bar"),
      join(".bun", folderEntry, "node_modules", "folder-pkg"),
      join("..", tarballEntry, "node_modules", "bar"),
      { name: "bar", version: "0.0.2" },
      { name: "folder-pkg", version: "1.0.0" },
    ]);

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await storeEntries(packageDir)).toEqual(expectedEntries);
  });

  test("a tarball URL longer than NAME_MAX installs, also into the global store", async () => {
    const tarball = file(join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz"));
    const segment = Buffer.alloc(255, "t").toString();

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname !== `/${segment}/no-deps.tgz`) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(tarball, { headers: { "Content-Type": "application/octet-stream" } });
      },
    });
    const url = `http://localhost:${server.port}/${segment}/no-deps.tgz`;

    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", globalStore: true },
      files: { "index.mjs": `import pkg from "no-deps";\nconsole.log(pkg.version);` },
    });
    await write(packageJson, JSON.stringify({ name: "test-long-tarball-url", dependencies: { "no-deps": url } }));

    await runBunInstall(installEnv(packageDir), packageDir);

    const entry = storeEntryName("no-deps", url.replaceAll(/[/:]/g, "+")) + noDepsPin("1.0.0");
    expect(entry).toMatch(/^no-deps@http\+\+\+localhost\+\d+\+t+(\+[0-9a-f]{16}){2}$/);
    expect(await storeEntries(packageDir)).toEqual([entry]);

    const localEntry = join(packageDir, "node_modules", ".bun", entry);
    expect(lstatSync(localEntry).isSymbolicLink()).toBe(true);
    expect(entryStoreName(readlinkSync(localEntry))).toMatch(
      new RegExp(`^${entry.replaceAll("+", "\\+")}-[0-9a-f]{16}$`),
    );

    await using proc = spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1.0.0\n");
    expect(exitCode).toBe(0);
  });

  // The reported case: a git dependency's resolution is its repository URL
  // (here: a path inside the temp directory) plus the commit, and the entry is
  // the cwd its lifecycle scripts are spawned with.
  test.skipIf(!gitExecutable)("a trusted git dependency with a long URL runs its lifecycle scripts", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    const repoDir = join(packageDir, Buffer.alloc(60, "r").toString());
    const gitEnv = {
      ...bunEnv,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(packageDir, "gitconfig"),
      GIT_AUTHOR_NAME: "bun-test",
      GIT_AUTHOR_EMAIL: "test@bun.sh",
      GIT_COMMITTER_NAME: "bun-test",
      GIT_COMMITTER_EMAIL: "test@bun.sh",
    };
    async function git(...args: string[]): Promise<string> {
      await using proc = spawn({
        cmd: [gitExecutable!, ...args],
        cwd: repoDir,
        env: gitEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).not.toContain("fatal:");
      expect(exitCode).toBe(0);
      return out;
    }

    await Promise.all([
      write(join(packageDir, "gitconfig"), ""),
      write(
        join(repoDir, "package.json"),
        JSON.stringify({
          name: "git-dep",
          version: "1.0.0",
          scripts: { postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall-ran.txt', 'ran')"` },
        }),
      ),
    ]);
    await git("init", "-q");
    await git("add", "package.json");
    await git("commit", "-qm", "init", "--no-gpg-sign");
    const sha = (await git("rev-parse", "HEAD")).trim();

    const repoUrl = pathToFileURL(repoDir).href;
    await write(
      packageJson,
      JSON.stringify({
        name: "test-long-git-url",
        dependencies: { "git-dep": `git+${repoUrl}` },
        trustedDependencies: ["git-dep"],
      }),
    );

    await runBunInstall(installEnv(packageDir, gitEnv), packageDir);

    const entry = storeEntryName("git-dep", `git+${repoUrl.replaceAll(/[/:]/g, "+")}+${sha}`);
    expect(entry).toMatch(/^git-dep@git\+file\+\+\+\+.*\+[0-9a-f]{16}$/);
    expect(await storeEntries(packageDir)).toEqual([entry]);
    expect(await file(join(packageDir, "node_modules", "git-dep", "postinstall-ran.txt")).text()).toBe("ran");
  });
});

// The linker walks a package by opening every directory relative to its parent, so it reaches
// entries whose destination path does not fit the buffer it is built in.
describe.concurrent("package trees deeper than the path buffer", () => {
  // bun_core::MAX_PATH_BYTES on POSIX, 32767 UTF-16 units on Windows.
  const PATH_BUFFER_LEN = isWindows ? 32767 : isLinux ? 4096 : 1024;
  // Destination of the `file:./pkg` dependency used below, relative to the project.
  const STORE_PKG_DIR = join("node_modules", ".bun", "pkg@file+pkg", "node_modules", "pkg");

  const SEGMENT_LEN = 100;
  const SEGMENT = Buffer.alloc(SEGMENT_LEN, "d").toString();
  // createDeepChain never names more directories than this in one path (macOS: 1024 bytes).
  const CHUNK_DEPTH = 4;

  type Leaf = { name: string; contents: string };
  const LEAF: Leaf = { name: "leaf.js", contents: "module.exports = 'deep';" };
  const SHORT_LEAF: Leaf = { name: "f", contents: LEAF.contents };

  /** Directory names whose joined relative path is exactly `joinedLen` long. */
  function chainDirs(joinedLen: number): string[] {
    const dirs: string[] = [];
    let remaining = joinedLen;
    while (remaining > 2 * SEGMENT_LEN + 1) {
      dirs.push(SEGMENT);
      remaining -= SEGMENT_LEN + 1;
    }
    dirs.push(Buffer.alloc(remaining, "e").toString());
    expect(dirs.join("/")).toHaveLength(joinedLen);
    return dirs;
  }

  /** `dirs` such that `<destinationDir>/<dirs>/<SHORT_LEAF.name>` is `destinationLen` long. */
  const dirsForDestinationLength = (destinationDir: string, destinationLen: number) =>
    chainDirs(destinationLen - (destinationDir.length + 1) - (1 + SHORT_LEAF.name.length));

  /**
   * Nests `dirs` inside `pkgDir`. The chain may be longer than any path the filesystem accepts: it is
   * made as chunks side by side in `staging`, which are renamed into each other from the deepest one up.
   */
  function createDeepChain(pkgDir: string, staging: string, dirs: string[], leaf?: Leaf) {
    const chunks: string[][] = [];
    for (let i = 0; i < dirs.length; i += CHUNK_DEPTH) {
      chunks.push(dirs.slice(i, i + CHUNK_DEPTH));
    }
    for (let i = 0; i < chunks.length; i++) {
      mkdirSync(join(staging, String(i), ...chunks[i]), { recursive: true });
    }
    if (leaf !== undefined) {
      const deepest = chunks.length - 1;
      writeFileSync(join(staging, String(deepest), ...chunks[deepest], leaf.name), leaf.contents);
    }
    for (let i = chunks.length - 1; i > 0; i--) {
      renameSync(join(staging, String(i), chunks[i][0]), join(staging, String(i - 1), ...chunks[i - 1], chunks[i][0]));
    }
    renameSync(join(staging, "0", chunks[0][0]), join(pkgDir, chunks[0][0]));
  }

  function projectWithDeepFolderDependency(name: string, dirs: string[], leaf?: Leaf) {
    const dir = tempDir(name, {
      "package.json": JSON.stringify({ name: "proj", dependencies: { pkg: "file:./pkg" } }),
      "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
    });
    createDeepChain(join(String(dir), "pkg"), join(String(dir), "staging"), dirs, leaf);
    return dir;
  }

  async function bunInstall(projectDir: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker", "isolated", ...args],
      cwd: projectDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(projectDir, ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  type InstallResult = Awaited<ReturnType<typeof bunInstall>>;

  function expectInstalled({ stdout, stderr, exitCode }: InstallResult) {
    expect(stderr).not.toContain("ENAMETOOLONG");
    expect(stdout).toMatch(/\d+ packages? installed/);
    expect(exitCode).toBe(0);
  }

  function expectPackageFailure({ stdout, stderr, exitCode }: InstallResult, packageName: string) {
    expect(stderr).toContain("ENAMETOOLONG");
    expect(stderr).toContain(`failed to link package: ${packageName}@`);
    expect(stdout).toContain("Failed to install 1 package");
    expect(exitCode).toBe(1);
  }

  /** Reads by project-relative path, for files whose absolute path is longer than this process may use. */
  async function readInstalledFile(projectDir: string, relativePath: string) {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(require("fs").readFileSync(${JSON.stringify(relativePath)}, "utf8"))`,
      ],
      cwd: projectDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  }

  /** Installs `bar` once, so that it is in the cache, and removes node_modules again. */
  async function projectWithCachedPackage(name: string) {
    const dir = tempDir(name, {
      "package.json": JSON.stringify({ name: "proj", dependencies: { bar: "file:./bar-0.0.2.tgz" } }),
    });
    cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));
    expectInstalled(await bunInstall(String(dir)));

    const cacheEntries = join(String(dir), ".cache", "bar");
    const [cachedPackage] = readdirSync(cacheEntries).map(entry => realpathSync(join(cacheEntries, entry)));
    const [entry] = readdirSync(join(String(dir), "node_modules", ".bun")).filter(entry => entry.startsWith("bar@"));
    rmSync(join(String(dir), "node_modules"), { recursive: true });
    return { dir, cachedPackage, entryNodeModules: join("node_modules", ".bun", entry, "node_modules") };
  }

  test("a folder dependency with a deep tree that fits installs", async () => {
    // Past the 260 characters of Windows' legacy MAX_PATH, well inside the buffer everywhere.
    const dirs = chainDirs(isWindows ? 4096 : PATH_BUFFER_LEN / 2);
    using dir = projectWithDeepFolderDependency("isolated-deep-fits", dirs, LEAF);

    expectInstalled(await bunInstall(String(dir)));
    expect(readFileSync(join(String(dir), "node_modules", "pkg", ...dirs, LEAF.name), "utf8")).toBe(LEAF.contents);
  });

  // On Windows the buffer holds as much as the filesystem does, so no tree that exists overflows it
  // with a store-relative path; the last test overflows with the absolute path instead.
  describe.skipIf(isWindows)("a folder dependency", () => {
    test("fails with ENAMETOOLONG when a directory does not fit", async () => {
      using dir = projectWithDeepFolderDependency("isolated-deep-dir", chainDirs(PATH_BUFFER_LEN + 256));
      expectPackageFailure(await bunInstall(String(dir)), "pkg");
    });

    // The two trees differ by one byte of destination path. Their directories fit either way.
    test("installs a file whose destination path is one byte short of the buffer", async () => {
      const dirs = dirsForDestinationLength(STORE_PKG_DIR, PATH_BUFFER_LEN - 1);
      const destination = join(STORE_PKG_DIR, ...dirs, SHORT_LEAF.name);
      expect(destination).toHaveLength(PATH_BUFFER_LEN - 1);
      using dir = projectWithDeepFolderDependency("isolated-exact-fits", dirs, SHORT_LEAF);

      expectInstalled(await bunInstall(String(dir)));
      expect(await readInstalledFile(String(dir), destination)).toBe(SHORT_LEAF.contents);
    });

    test("fails with ENAMETOOLONG for a file whose destination path fills the buffer", async () => {
      const dirs = dirsForDestinationLength(STORE_PKG_DIR, PATH_BUFFER_LEN);
      expect(join(STORE_PKG_DIR, ...dirs, SHORT_LEAF.name)).toHaveLength(PATH_BUFFER_LEN);
      using dir = projectWithDeepFolderDependency("isolated-exact-over", dirs, SHORT_LEAF);

      expectPackageFailure(await bunInstall(String(dir)), "pkg");
    });
  });

  // Folder dependencies are always hardlinked; --backend selects how packages from the cache are linked.
  describe.skipIf(isWindows)("a cached package", () => {
    test.each(["hardlink", "copyfile"])("fails with ENAMETOOLONG and leaves nothing (%s)", async backend => {
      const { dir, cachedPackage, entryNodeModules } = await projectWithCachedPackage(`isolated-cached-${backend}`);
      using _ = dir;
      createDeepChain(cachedPackage, join(String(dir), "staging"), chainDirs(PATH_BUFFER_LEN + 256), LEAF);

      expectPackageFailure(await bunInstall(String(dir), "--backend", backend), "bar");
      expect(readdirSync(join(String(dir), entryNodeModules))).toEqual([]);
    });

    // It is linked under a temporary name that is longer than `bar`.
    test("installs a file whose destination path is one byte short of the buffer", async () => {
      const { dir, cachedPackage, entryNodeModules } = await projectWithCachedPackage("isolated-cached-exact-fits");
      using _ = dir;
      const dirs = dirsForDestinationLength(join(entryNodeModules, "bar"), PATH_BUFFER_LEN - 1);
      const destination = join(entryNodeModules, "bar", ...dirs, SHORT_LEAF.name);
      expect(destination).toHaveLength(PATH_BUFFER_LEN - 1);
      createDeepChain(cachedPackage, join(String(dir), "staging"), dirs, SHORT_LEAF);

      expectInstalled(await bunInstall(String(dir), "--backend", "hardlink"));
      expect(await readInstalledFile(String(dir), destination)).toBe(SHORT_LEAF.contents);
      expect(readdirSync(join(String(dir), entryNodeModules))).toEqual(["bar"]);
    });
  });

  // On Windows a file is linked by its absolute destination (`\??\`, the working directory, the store
  // path), assembled after the store-relative part passed its own length check.
  test.skipIf(!isWindows)("a folder dependency whose absolute destination does not fit fails", async () => {
    using dir = tempDir("isolated-absolute-over", {
      "package.json": JSON.stringify({ name: "proj", dependencies: { pkg: "file:./pkg" } }),
      "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
    });
    const projectDir = realpathSync.native(String(dir));
    const destinationPrefix = `\\??\\${projectDir}\\${STORE_PKG_DIR}\\`;
    const sourcePrefix = `\\\\?\\${projectDir}\\pkg\\`;
    const entryLen = PATH_BUFFER_LEN - Math.ceil((destinationPrefix.length + sourcePrefix.length) / 2);
    expect(destinationPrefix.length + entryLen).toBeGreaterThanOrEqual(PATH_BUFFER_LEN);
    expect(sourcePrefix.length + entryLen).toBeLessThan(PATH_BUFFER_LEN);
    // A long file name keeps every directory of the chain addressable, so the file is what does not fit.
    const leaf: Leaf = { name: Buffer.alloc(SEGMENT_LEN, "f").toString(), contents: LEAF.contents };
    const dirs = chainDirs(entryLen - 1 - leaf.name.length);
    createDeepChain(join(String(dir), "pkg"), join(String(dir), "staging"), dirs, leaf);

    expectPackageFailure(await bunInstall(String(dir)), "pkg");
  });
});

// The store entry of a tarball or git dependency is named after its URL, and
// that name ends up in every path under the entry (realpaths, stack traces,
// `bun pm` output). Credentials travel in the userinfo (`user:token@`) or the
// query string (`?token=`), so those parts are left out of the name; the hash
// of the complete URL takes their place (see `urlHash`), which also keeps URLs
// that differ only in those parts in separate entries. A URL without either
// part keeps the name it always had.
describe.concurrent("store entry names of URL dependencies", () => {
  async function storeEntries(dir: string): Promise<string[]> {
    return (await readdirSorted(join(dir, "node_modules", ".bun"))).filter(entry => entry !== "node_modules");
  }

  async function runIndexMjs(dir: string) {
    await using proc = spawn({
      cmd: [bunExe(), "index.mjs"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Serves the registry fixture `no-deps-<v>.tgz` at `/cdn/pkg.tgz?v=<v>`
  // (1.0.0 without a query string), whatever else the query string contains.
  function serveTarballs() {
    return Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname, searchParams } = new URL(req.url);
        if (pathname !== "/cdn/pkg.tgz") return new Response("not found", { status: 404 });
        const version = searchParams.get("v") ?? "1.0.0";
        return new Response(file(join(import.meta.dir, "registry", "packages", "no-deps", `no-deps-${version}.tgz`)));
      },
    });
  }

  // (A username without a password, `http://token@host:port/...`, is covered
  // by the git cases below: the tarball downloader currently sends such a URL
  // with the userinfo still in the Host header, which the server rejects.)
  const tarballCases: [description: string, url: (port: number) => string, hashed: boolean][] = [
    ["a plain URL", port => `http://127.0.0.1:${port}/cdn/pkg.tgz`, false],
    ["a password in the URL", port => `http://carol:s3cret@127.0.0.1:${port}/cdn/pkg.tgz`, true],
    ["a token in the query string", port => `http://127.0.0.1:${port}/cdn/pkg.tgz?token=npm_s3cret`, true],
    [
      "credentials in both places",
      port => `http://carol:s3cret@127.0.0.1:${port}/cdn/pkg.tgz?token=npm_s3cret#fragment`,
      true,
    ],
  ];

  test.concurrent.each(tarballCases)("tarball dependency with %s", async (_, urlFor, hashed) => {
    using server = serveTarballs();
    const url = urlFor(server.port!);
    using dir = tempDir("store-name-tarball-", {
      "bunfig.toml": `[install]\nlinker = "isolated"\n`,
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": url } }),
      "index.mjs": `import pkg from "no-deps";\nconsole.log(pkg.version);`,
    });
    const env = installEnv(String(dir));

    await runBunInstall(env, String(dir));

    const entry = `no-deps@http+++127.0.0.1+${server.port}+cdn+pkg.tgz${hashed ? `+${urlHash(url)}` : ""}${noDepsPin("1.0.0")}`;
    expect(await storeEntries(String(dir))).toEqual([entry]);
    expect(readlinkSync(join(String(dir), "node_modules", "no-deps"))).toBe(
      join(".bun", entry, "node_modules", "no-deps"),
    );
    // Only the directory is named differently; the dependency still resolves
    // to the URL as written.
    expect(await file(join(String(dir), "bun.lock")).text()).toContain(`no-deps@${url}`);
    expect(await runIndexMjs(String(dir))).toEqual({ stdout: "1.0.0\n", stderr: "", exitCode: 0 });

    // The next install derives the same name from the lockfile.
    await runBunInstall(env, String(dir), { savesLockfile: false });
    expect(await storeEntries(String(dir))).toEqual([entry]);
  });

  test.concurrent("tarball URLs that differ only in their query string get separate store entries", async () => {
    using server = serveTarballs();
    const base = `http://127.0.0.1:${server.port}/cdn/pkg.tgz`;
    const urls = { "no-deps-v1": `${base}?v=1.0.0`, "no-deps-v2": `${base}?v=2.0.0` };
    using dir = tempDir("store-name-tarball-query-", {
      "bunfig.toml": `[install]\nlinker = "isolated"\n`,
      "package.json": JSON.stringify({ name: "app", dependencies: urls }),
      "index.mjs": `import v1 from "no-deps-v1";\nimport v2 from "no-deps-v2";\nconsole.log(v1.version, v2.version);`,
    });

    await runBunInstall(installEnv(String(dir)), String(dir));

    expect(await storeEntries(String(dir))).toEqual(
      Object.values(urls)
        .map(
          url =>
            `no-deps@http+++127.0.0.1+${server.port}+cdn+pkg.tgz+${urlHash(url)}${noDepsPin(url.slice(url.indexOf("=") + 1))}`,
        )
        .sort(),
    );
    expect(await runIndexMjs(String(dir))).toEqual({ stdout: "1.0.0 2.0.0\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("the global store entry of a tarball dependency is named the same way", async () => {
    using server = serveTarballs();
    const url = `http://carol:s3cret@127.0.0.1:${server.port}/cdn/pkg.tgz?token=npm_s3cret`;
    using dir = tempDir("store-name-tarball-global-", {
      "bunfig.toml": `[install]\nlinker = "isolated"\nglobalStore = true\n`,
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": url } }),
    });

    await runBunInstall(installEnv(String(dir)), String(dir));

    const entry = `no-deps@http+++127.0.0.1+${server.port}+cdn+pkg.tgz+${urlHash(url)}${noDepsPin("1.0.0")}`;
    expect(await storeEntries(String(dir))).toEqual([entry]);
    // `node_modules/.bun/<entry>` links to `<cache>/links/<entry>-<entry hash>`.
    const target = readlinkSync(join(String(dir), "node_modules", ".bun", entry));
    expect(basename(dirname(target))).toBe("links");
    expect(basename(target).slice(0, entry.length)).toBe(entry);
    expect(basename(target).slice(entry.length)).toMatch(/^-[0-9a-f]{16}$/);
    expect(await file(join(target, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  describe.skipIf(!gitExecutable)("git dependencies", () => {
    const gitEnv = {
      ...bunEnv,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "bun-test",
      GIT_AUTHOR_EMAIL: "test@bun.sh",
      GIT_COMMITTER_NAME: "bun-test",
      GIT_COMMITTER_EMAIL: "test@bun.sh",
    };

    async function git(cwd: string, ...args: string[]): Promise<string> {
      await using proc = spawn({ cmd: [gitExecutable!, ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("fatal:");
      expect(exitCode).toBe(0);
      return stdout;
    }

    // `<root>/repo.git`: a bare repository with one commit of the package
    // `git-dep`, prepared for git's dumb HTTP protocol (after
    // `git update-server-info` a bare repository is plain static files).
    async function createBareRepo(root: string): Promise<{ bare: string; sha: string }> {
      const src = join(root, "git-src");
      const bare = join(root, "repo.git");
      await write(join(src, "package.json"), JSON.stringify({ name: "git-dep", version: "1.0.0" }));
      await git(src, "init", "-q");
      await git(src, "add", "package.json");
      await git(src, "commit", "-q", "-m", "init", "--no-gpg-sign");
      const sha = (await git(src, "rev-parse", "HEAD")).trim();
      await git(root, "clone", "-q", "--bare", src, bare);
      await git(bare, "update-server-info");
      return { bare, sha };
    }

    function serveBareRepo(bare: string) {
      return Bun.serve({
        port: 0,
        async fetch(req) {
          const { pathname } = new URL(req.url);
          if (!pathname.startsWith("/repo.git/")) return new Response("not found", { status: 404 });
          const f = file(join(bare, pathname.slice("/repo.git/".length)));
          return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
        },
      });
    }

    const gitCases: [description: string, repo: (port: number) => string, hashed: boolean][] = [
      ["a plain URL", port => `http://127.0.0.1:${port}/repo.git`, false],
      ["a password in the URL", port => `http://carol:s3cret@127.0.0.1:${port}/repo.git`, true],
      ["a token as the username", port => `http://ghp_s3cret@127.0.0.1:${port}/repo.git`, true],
    ];

    test.concurrent.each(gitCases)("git dependency with %s", async (_, repoFor, hashed) => {
      using dir = tempDir("store-name-git-", {});
      const { bare, sha } = await createBareRepo(String(dir));
      using server = serveBareRepo(bare);
      const repo = repoFor(server.port!);
      const project = join(String(dir), "project");
      await write(
        join(project, "package.json"),
        JSON.stringify({ name: "app", dependencies: { "git-dep": `git+${repo}` } }),
      );
      await write(join(project, "bunfig.toml"), `[install]\nlinker = "isolated"\n`);
      const env = installEnv(String(dir), gitEnv);

      await runBunInstall(env, project);

      const entry = storeEntryName(
        "git-dep",
        `git+http+++127.0.0.1+${server.port}+repo.git${hashed ? `+${urlHash(repo)}` : ""}+${sha}`,
      );
      expect(await storeEntries(project)).toEqual([entry]);
      expect(readlinkSync(join(project, "node_modules", "git-dep"))).toBe(
        join(".bun", entry, "node_modules", "git-dep"),
      );
      expect(await file(join(project, "node_modules", "git-dep", "package.json")).json()).toEqual({
        name: "git-dep",
        version: "1.0.0",
      });
      expect(await file(join(project, "bun.lock")).text()).toContain(`git-dep@git+${repo}#${sha}`);

      await runBunInstall(env, project, { savesLockfile: false });
      expect(await storeEntries(project)).toEqual([entry]);
    });
  });
});

describe.concurrent("global virtual store", () => {
  // The global virtual store is off by default; tests that exercise it opt
  // in via bunfig `install.globalStore = true`.
  const gvsBunfigOpts = { linker: "isolated", globalStore: true } as const;

  // These tests corrupt entries of the store (`<cache>/links/`), delete it and leave staging directories behind:
  // every install here needs `installEnv`.

  test("is disabled by default", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-default-off",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    // With the global store disabled (the default) the entry is a real
    // directory under `node_modules/.bun/` (the pre-global-store layout).
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(existsSync(join(entry, "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("can be enabled via BUN_INSTALL_GLOBAL_STORE=1", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-on-env",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...installEnv(packageDir), BUN_INSTALL_GLOBAL_STORE: "1" }, packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);
  });

  test("can be enabled via bunfig install.globalStore", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-on-bunfig",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);
  });

  test("survives node_modules wipe", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    // First install: populates `<cache>/links/` and creates project symlinks.
    await runBunInstall(installEnv(packageDir), packageDir);

    // `node_modules/.bun/<storepath>` is a symlink (to the global virtual store),
    // not a real directory containing a clonefiled copy of the package.
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const target = readlinkSync(entry);
    expect(target).toMatch(/links[\/\\]two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(existsSync(join(target, "node_modules", "two-range-deps", "package.json"))).toBe(true);
    // dep symlink inside the global entry points at a sibling global entry
    expect(readlinkSync(join(target, "node_modules", "no-deps"))).toMatch(
      /^\.\.[\/\\]\.\.[\/\\]no-deps@1\.1\.0-[0-9a-f]{16}[\/\\]node_modules[\/\\]no-deps$/,
    );

    // Second install after wiping node_modules: the global entry persists, so
    // the project entry is re-created as a symlink to the *same* global path
    // without re-materialising package files.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toBe(target);
    expect(
      await file(
        join(
          packageDir,
          "node_modules",
          ".bun",
          "two-range-deps@1.0.0",
          "node_modules",
          "two-range-deps",
          "package.json",
        ),
      ).json(),
    ).toMatchObject({ name: "two-range-deps", version: "1.0.0" });
  });

  test("--force replaces a corrupted global-store entry", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-force-heal",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const gvsTarget = readlinkSync(entry);
    const pkgDir = join(gvsTarget, "node_modules", "no-deps");
    const pkgJsonPath = join(pkgDir, "package.json");
    const indexPath = join(pkgDir, "index.js");
    const original = await file(pkgJsonPath).text();

    // Corrupt the published global-store entry: delete files (the directory
    // still exists, so the warm-hit `directoryExistsAt` check is satisfied
    // and a plain reinstall takes the symlink-only fast path). The
    // extraction cache the entry was hardlinked from keeps its own
    // hardlinks, so the source bytes for --force to rebuild from are intact.
    await rm(pkgJsonPath, { force: true });
    await rm(indexPath, { force: true });

    // Sanity: a non-force reinstall does NOT heal — it sees the directory
    // present and reuses it. (This pins the warm-hit semantics so the
    // assertion below is meaningful.)
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(existsSync(pkgJsonPath)).toBe(false);

    // --force must rebuild staging and swap it into place over the corrupt
    // final directory instead of discarding the fresh tree on EEXIST.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--force"],
        cwd: packageDir,
        env: installEnv(packageDir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    expect(readlinkSync(entry)).toBe(gvsTarget);
    expect(await file(pkgJsonPath).text()).toBe(original);
    expect(existsSync(indexPath)).toBe(true);

    // The swap-aside `.old-<rand>` tree is removed once publish succeeds, so
    // the links/ directory is left with only the final entry (no `.old-` and
    // no `.tmp-` siblings).
    expect(await readdirSorted(dirname(gvsTarget))).toEqual([basename(gvsTarget)]);
  });

  test.skipIf(isWindows)("--force replaces an entry atomically, so it's never missing", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    await write(
      packageJson,
      JSON.stringify({ name: "test-pkg-global-store-force-swap", dependencies: { "no-deps": "1.0.0" } }),
    );
    const env = installEnv(packageDir);
    await runBunInstall(env, packageDir);

    // Another project's view of the entry, looked at all the time.
    const entry = readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"));
    const stop = join(packageDir, "stop");
    await using witness = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { existsSync } = require("fs");
        const [, path, stop] = process.argv;
        let missing = 0;
        while (!existsSync(stop)) for (let i = 0; i < 500; i++) if (!existsSync(path)) missing++;
        console.log(missing);`,
        join(entry, "node_modules", "no-deps", "package.json"),
        stop,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    for (let i = 0; i < 10; i++) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--force"],
        cwd: packageDir,
        env,
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await proc.exited).toBe(0);
    }
    await write(stop, "");

    expect(await witness.stdout.text()).toBe("0\n");
  });

  test.each(["0", "false", "no", "off", ""])(
    "BUN_INSTALL_GLOBAL_STORE=%s overrides bunfig globalStore = true",
    async value => {
      const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

      await write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-global-store-off-env",
          dependencies: { "no-deps": "1.0.0" },
        }),
      );

      await runBunInstall({ ...installEnv(packageDir), BUN_INSTALL_GLOBAL_STORE: value }, packageDir);

      // With the global store disabled the entry is a real directory under
      // `node_modules/.bun/` (the pre-global-store layout).
      const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
      expect(lstatSync(entry).isSymbolicLink()).toBe(false);
      expect(lstatSync(entry).isDirectory()).toBe(true);
      expect(existsSync(join(entry, "node_modules", "no-deps", "package.json"))).toBe(true);
    },
  );

  test("entry hash is deterministic across fresh installs", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-determinism",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);
    const target1 = readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));

    // Full reset (lockfile + node_modules + global links). The hash is derived
    // from the resolved dependency closure, so a fresh resolve must reproduce
    // it exactly — otherwise warm-hit reuse across machines/CI is broken.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lock"), { force: true });
    const linksDir = target1.slice(0, target1.lastIndexOf("links") + "links".length);
    await rm(linksDir, { recursive: true, force: true });

    await runBunInstall(installEnv(packageDir), packageDir);
    const target2 = readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));

    expect(target2).toBe(target1);
  });

  test("different resolved transitive dep produces a different entry hash", async () => {
    // Two projects that depend on the same direct package but force different
    // versions of one of its transitive deps must NOT share a global entry —
    // the dep symlink inside the entry would point at the wrong version for
    // one of them.
    const a = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    const b = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      a.packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-hash-a",
        dependencies: { "two-range-deps": "1.0.0" },
        overrides: { "no-deps": "1.0.0" },
      }),
    );
    await write(
      b.packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-hash-b",
        dependencies: { "two-range-deps": "1.0.0" },
        overrides: { "no-deps": "1.1.0" },
      }),
    );

    // Both projects install into one store, so the two entries sit side by side.
    const env = installEnv(a.packageDir);
    await runBunInstall(env, a.packageDir);
    await runBunInstall(env, b.packageDir);

    const targetA = readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));
    const targetB = readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));
    expect(dirname(targetB)).toBe(dirname(targetA));
    expect(entryStoreName(targetA)).not.toBe(entryStoreName(targetB));

    // Each entry's dep symlink resolves to the version that *its* project
    // overrode — proving the entries really are independent on disk.
    expect(
      await file(
        join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toMatchObject({ version: "1.0.0" });
    expect(
      await file(
        join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toMatchObject({ version: "1.1.0" });
  });

  test("re-resolving the same project re-points the entry link at the new-hash global entry", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-reresolve",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    const nestedNoDeps = join(entry, "node_modules", "no-deps", "package.json");
    const before = readlinkSync(entry);
    expect(entryStoreName(before)).toMatch(/^two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(await file(nestedNoDeps).json()).toStrictEqual({ name: "no-deps", version: "1.1.0" });

    // Same node_modules; the override changes two-range-deps' closure so its existing link must move.
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-reresolve",
        dependencies: { "two-range-deps": "1.0.0" },
        overrides: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const after = readlinkSync(entry);
    expect(entryStoreName(after)).toMatch(/^two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(after).not.toBe(before);
    expect(await file(nestedNoDeps).json()).toStrictEqual({ name: "no-deps", version: "1.0.0" });
    expect(readlinkSync(join(after, "node_modules", "no-deps"))).toMatch(
      /^\.\.[\/\\]\.\.[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}[\/\\]node_modules[\/\\]no-deps$/,
    );

    // The old-closure entry is untouched in the shared store.
    expect(await file(join(before, "node_modules", "no-deps", "package.json")).json()).toStrictEqual({
      name: "no-deps",
      version: "1.1.0",
    });
  });

  test("two projects with the same closure share one global entry", async () => {
    const a = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    const b = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    for (const { packageJson } of [a, b]) {
      await write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-global-store-share",
          dependencies: { "two-range-deps": "1.0.0" },
        }),
      );
    }

    // Both projects install into one store, so `b` links to the entry `a` published.
    const env = installEnv(a.packageDir);
    await runBunInstall(env, a.packageDir);
    await runBunInstall(env, b.packageDir);

    const targetA = readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));
    const targetB = readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));
    expect(entryStoreName(targetA)).toMatch(/^two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(targetB).toBe(targetA);
  });

  test("an install with nothing to do keeps the links into the store", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    await write(
      packageJson,
      JSON.stringify({ name: "test-pkg-global-store-noop", dependencies: { "no-deps": "1.0.0" } }),
    );
    const env = installEnv(packageDir);
    await runBunInstall(env, packageDir);
    // A link that was made again has another inode or another time.
    const link = () => {
      const stat = lstatSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"), { bigint: true });
      return { ino: stat.ino, mtimeNs: stat.mtimeNs };
    };
    const before = link();

    const { out } = await runBunInstall(env, packageDir, { savesLockfile: false });

    expect(out).toContain("(no changes)");
    expect(link()).toEqual(before);
  });

  test("the hash in an entry's name covers the layout version", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    await write(
      packageJson,
      JSON.stringify({ name: "test-pkg-global-store-layout", dependencies: { "no-deps": "1.0.0" } }),
    );
    await runBunInstall(installEnv(packageDir), packageDir);

    const [, sha512] = (await file(join(packageDir, "bun.lock")).text()).match(/"no-deps@1\.0\.0",.*"sha512-(.+)"/)!;
    // `GLOBAL_STORE_LAYOUT`, verified, the store path, the integrity.
    const hashed = Buffer.concat([
      Buffer.from([1, 0]),
      Buffer.from("no-deps@1.0.0\0\x04"),
      Buffer.from(sha512, "base64"),
    ]);
    const hash = Bun.hash.wyhash(hashed, 0x9e3779b97f4a7c15n).toString(16).padStart(16, "0");
    expect(entryStoreName(readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0")))).toBe(
      `no-deps@1.0.0-${hash}`,
    );
  });

  test("packages that depend on each other are shared by the projects that link them alike", async () => {
    // x -> y -> z -> x, and each of them takes another range of `e`.
    const manifests = [
      { name: "x", version: "1.0.0", dependencies: { y: "1.0.0", e: "^1.0.0" } },
      { name: "y", version: "1.0.0", dependencies: { z: "1.0.0", e: "^2.0.0" } },
      { name: "z", version: "1.0.0", dependencies: { x: "1.0.0", e: "*" } },
      { name: "e", version: "1.0.0" },
      { name: "e", version: "2.0.0" },
    ];
    const tarballs = new Map<string, Uint8Array>();
    for (const manifest of manifests) {
      const archive = new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" });
      tarballs.set(`/${manifest.name}-${manifest.version}.tgz`, await archive.bytes());
    }
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const { origin, pathname } = new URL(req.url);
        const tarball = tarballs.get(pathname);
        if (tarball) return new Response(tarball);
        const versions = manifests
          .filter(manifest => `/${manifest.name}` === pathname)
          .map(manifest => {
            const path = `/${manifest.name}-${manifest.version}.tgz`;
            const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(tarballs.get(path)!).digest("base64")}`;
            return [manifest.version, { ...manifest, dist: { tarball: origin + path, integrity } }] as const;
          });
        return Response.json({
          name: pathname.slice(1),
          "dist-tags": { latest: versions.at(-1)![0] },
          versions: Object.fromEntries(versions),
        });
      },
    });
    using dir = tempDir("global-store-cycle", {});
    const env = installEnv(String(dir));
    async function install(name: string, dependencies: Record<string, string>) {
      const project = join(String(dir), name);
      await write(join(project, "package.json"), JSON.stringify({ name, dependencies }));
      await write(
        join(project, "bunfig.toml"),
        `[install]\nlinker = "isolated"\nglobalStore = true\nregistry = "${server.url.href}"\n`,
      );
      await runBunInstall(env, project);
      const result: Record<string, { entry: string; e: string }> = {};
      for (const member of ["x", "y", "z"]) {
        const entry = join(project, "node_modules", ".bun", `${member}@1.0.0`);
        const { version } = await file(join(entry, "node_modules", "e", "package.json")).json();
        result[member] = { entry: entryStoreName(readlinkSync(entry)), e: version };
      }
      return result;
    }

    const one = await install("one", { x: "1.0.0", e: "1.0.0" });
    const two = await install("two", { x: "1.0.0", e: "2.0.0" });
    // The links of `one`, met in another order.
    const three = await install("three", { e: "1.0.0", z: "1.0.0", y: "1.0.0" });

    expect(one).toMatchObject({ x: { e: "1.0.0" }, y: { e: "2.0.0" }, z: { e: "1.0.0" } });
    expect(two).toMatchObject({ x: { e: "1.0.0" }, y: { e: "2.0.0" }, z: { e: "2.0.0" } });
    expect(three).toEqual(one);
  });

  test("workspace dependency makes the parent entry project-local", async () => {
    // Dep symlinks inside a global entry are sibling-relative within
    // `<cache>/links/`. If one of those siblings were a workspace package
    // (which lives under the project, not the cache) the link would be
    // dangling for any other project that shared the entry. The eligibility
    // check propagates: an entry that links to anything project-local is
    // itself project-local.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await mkdir(join(packageDir, "packages", "ws-pkg"), { recursive: true });
    await write(
      join(packageDir, "packages", "ws-pkg", "package.json"),
      JSON.stringify({ name: "ws-pkg", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
    );
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-ws",
        workspaces: ["packages/*"],
        dependencies: { "ws-pkg": "workspace:*", "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    // `no-deps` has no project-local deps so it stays global.
    const noDepsEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(noDepsEntry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);

    // The workspace itself is always project-local (its source lives in the
    // project tree).
    expect(readlinkSync(join(packageDir, "node_modules", "ws-pkg"))).toBe(join("..", "packages", "ws-pkg"));
  });

  test("packages with trusted lifecycle scripts stay project-local", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-scripts",
        dependencies: { "lifecycle-postinstall": "1.0.0", "no-deps": "1.0.0" },
        trustedDependencies: ["lifecycle-postinstall"],
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    // The script may mutate the install dir, so the entry must not be shared.
    const scriptEntry = join(packageDir, "node_modules", ".bun", "lifecycle-postinstall@1.0.0");
    expect(lstatSync(scriptEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(scriptEntry).isDirectory()).toBe(true);

    // A neighbouring scriptless package is unaffected and stays global.
    const noDepsEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);

    // An install from bun.lock must reach the same conclusion from the
    // trustedDependencies list — the cold install above isn't sufficient on its own.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(lstatSync(scriptEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(scriptEntry).isDirectory()).toBe(true);
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);
  });

  // peer-deps-lvl0 depends on no-deps and peer-deps-lvl1, which depends on peer-deps-lvl2. lvl1 and lvl2
  // declare no-deps as a peer. There is no fallback directory above `<cache>/links`.
  test.concurrent("--omit=peer still links a peer that an ancestor provides", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: gvsBunfigOpts,
      files: {
        "package.json": JSON.stringify({ name: "omit-peer", dependencies: { "peer-deps-lvl0": "1.0.0" } }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir, { packages: ["--omit=peer"] });

    const bunDir = join(packageDir, "node_modules", ".bun");
    const [lvl2] = (await readdirSorted(bunDir)).filter(entry => entry.startsWith("peer-deps-lvl2@1.0.0"));
    expect(await file(join(bunDir, lvl2, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      name: "no-deps",
      version: "1.0.0",
    });

    // The index.js of each fixture requires its dependencies and peers.
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(require("peer-deps-lvl0").dependencies["peer-deps-lvl1"].dependencies["peer-deps-lvl2"].peerDependencies["no-deps"].name)`,
      ],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "no-deps\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("--omit=peer does not install a peer that no ancestor provides", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: gvsBunfigOpts,
      files: {
        "package.json": JSON.stringify({ name: "omit-peer-unprovided", dependencies: { "peer-deps": "1.0.0" } }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir, { packages: ["--omit=peer"] });

    const bunDir = join(packageDir, "node_modules", ".bun");
    expect((await readdirSorted(bunDir)).filter(entry => entry !== "node_modules")).toEqual(["peer-deps@1.0.0"]);
    expect(existsSync(join(bunDir, "peer-deps@1.0.0", "node_modules", "no-deps"))).toBe(false);
  });

  // The script of a trusted package can write through the package's dependency links: the npm `bun`
  // wrapper renames the binary out of `@oven/bun-<platform>`.
  test.concurrent("the dependency closure of a trusted package stays project-local", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-trusted-closure",
        // depend-on-debug-1 -> debug-1 -> ms-1
        dependencies: { "depend-on-debug-1": "1.0.0", "a-dep": "1.0.1" },
        trustedDependencies: ["depend-on-debug-1"],
      }),
    );
    const isLink = (entry: string) => lstatSync(join(packageDir, "node_modules", ".bun", entry)).isSymbolicLink();
    const layout = () => ({
      "depend-on-debug-1@1.0.0": isLink("depend-on-debug-1@1.0.0"),
      "debug-1@4.4.0": isLink("debug-1@4.4.0"),
      "ms-1@2.1.3": isLink("ms-1@2.1.3"),
      "a-dep@1.0.1": isLink("a-dep@1.0.1"),
    });
    const expected = {
      "depend-on-debug-1@1.0.0": false,
      "debug-1@4.4.0": false,
      "ms-1@2.1.3": false,
      "a-dep@1.0.1": true,
    };

    await runBunInstall(installEnv(packageDir), packageDir);
    expect(layout()).toEqual(expected);
    expect(await readdirSorted(join(packageDir, ".bun-cache", "links"))).toEqual([
      expect.stringMatching(/^a-dep@1\.0\.1-[0-9a-f]{16}$/),
    ]);
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "debug-1@4.4.0", "node_modules", "ms-1", "package.json"),
      ).json(),
    ).toMatchObject({ name: "ms-1", version: "2.1.3" });

    // The same from bun.lock.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(layout()).toEqual(expected);
  });

  test.concurrent("the dependency closure of a trusted file: folder stays project-local", async () => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: gvsBunfigOpts,
      files: {
        "package.json": JSON.stringify({
          name: "test-pkg-global-store-trusted-folder",
          dependencies: { "local-pkg": "file:./local-pkg", "a-dep": "1.0.1" },
          trustedDependencies: ["local-pkg"],
        }),
        "local-pkg/package.json": JSON.stringify({
          name: "local-pkg",
          version: "1.0.0",
          dependencies: { "no-deps": "1.0.0" },
        }),
      },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    const isLink = (entry: string) => lstatSync(join(packageDir, "node_modules", ".bun", entry)).isSymbolicLink();
    expect({ "no-deps": isLink("no-deps@1.0.0"), "a-dep": isLink("a-dep@1.0.1") }).toEqual({
      "no-deps": false,
      "a-dep": true,
    });
  });

  // TypeScript checks a declaration file at its realpath and resolves its imports by walking up from
  // there, falling back to `@types/*`. From `<cache>/links` that walk never reaches the project.
  test.concurrent.each([
    {
      title: "stays project-local when the project has the @types package of its peer",
      dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0", "@types/no-deps": "1.0.0" },
      shared: false,
    },
    {
      title: "stays project-local when the project has the @types package of its scoped peer",
      dependencies: { "scoped-peer-deps": "1.0.0", "@scoped/no-deps": "1.0.0", "@types/scoped__no-deps": "1.0.0" },
      shared: false,
    },
    {
      title: "is shared when the project has no @types package of its peer",
      dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0", "@types/is-number": "1.0.0" },
      shared: true,
    },
    {
      title: "is shared when it depends on the @types package of its peer itself",
      dependencies: { "peer-deps-with-own-types": "1.0.0", "no-deps": "1.0.0", "@types/no-deps": "1.0.0" },
      shared: true,
    },
  ])("a package with a peer $title", async ({ dependencies, shared }) => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: gvsBunfigOpts,
      files: { "package.json": JSON.stringify({ name: "test-pkg-global-store-peer-types", dependencies }) },
    });

    await runBunInstall(installEnv(packageDir), packageDir);

    const bunDir = join(packageDir, "node_modules", ".bun");
    const [name, peer, types] = Object.keys(dependencies);
    const [entry] = (await readdirSorted(bunDir)).filter(entry => entry.startsWith(`${name}@1.0.0`));
    expect({
      entry: lstatSync(join(bunDir, entry)).isSymbolicLink(),
      // Without peers, so shared either way.
      peer: lstatSync(join(bunDir, `${peer.replace("/", "+")}@1.0.0`)).isSymbolicLink(),
    }).toEqual({ entry: shared, peer: true });
    expect(existsSync(join(bunDir, entry, "node_modules", peer, "package.json"))).toBe(true);
    expect(existsSync(join(bunDir, "node_modules", types, "package.json"))).toBe(true);
  });

  test("concurrent installs into a cold global store both succeed", async () => {
    // Two `bun install` processes may race to create the same content-addressed
    // global entry; the loser sees EEXIST from clonefile/symlink/bin-link and
    // must treat it as success rather than failing the install.
    const a = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    const b = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    // Both projects must share one cache for the race to be real.
    const env = installEnv(a.packageDir);

    for (const { packageJson } of [a, b]) {
      await write(
        packageJson,
        JSON.stringify({
          name: "test-pkg-global-store-concurrent",
          // `what-bin` exercises the `.bin/` symlink race; the others give the
          // clonefile + dep-symlink paths something to fight over.
          dependencies: { "two-range-deps": "1.0.0", "a-dep-b": "1.0.0", "what-bin": "1.0.0" },
        }),
      );
    }

    // Prime the package cache so the parallel installs only race on
    // global-store creation, not network downloads.
    await runBunInstall(env, a.packageDir);
    const linksDir = join(env.BUN_INSTALL_CACHE_DIR, "links");

    for (let i = 0; i < 3; i++) {
      await rm(linksDir, { recursive: true, force: true });
      await rm(join(a.packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(b.packageDir, "node_modules"), { recursive: true, force: true });

      const [ra, rb] = await Promise.all([
        spawn({ cmd: [bunExe(), "install"], cwd: a.packageDir, env, stderr: "pipe", stdout: "pipe" }).exited,
        spawn({ cmd: [bunExe(), "install"], cwd: b.packageDir, env, stderr: "pipe", stdout: "pipe" }).exited,
      ]);
      expect({ iter: i, a: ra, b: rb }).toEqual({ iter: i, a: 0, b: 0 });
    }

    // Both projects' `.bun/<X>` symlinks point at the same physical directory
    // in the shared cache.
    const target = readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));
    expect(readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"))).toBe(target);
    // That directory is in the `links/` the loop deletes, so every iteration raced on a cold store.
    expect(await readdirSorted(linksDir)).toContain(entryStoreName(target));
    for (const { packageDir } of [a, b]) {
      expect(
        await file(
          join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0", "node_modules", "no-deps", "package.json"),
        ).json(),
      ).toMatchObject({ name: "no-deps" });
      const bin = process.platform === "win32" ? "what-bin.bunx" : "what-bin";
      expect(existsSync(join(packageDir, "node_modules", ".bin", bin))).toBe(true);
    }
  });

  test("a leftover staging directory does not shadow the published entry", async () => {
    // Entries are built under `<entry>.tmp-<suffix>/` and renamed into
    // `<entry>/` as the final step, so a published entry is always complete.
    // A crashed earlier install can leave a staging directory behind; the
    // warm-hit check must look at the final path only.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-staging",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);
    const target = readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"));
    expect(existsSync(join(target, "node_modules", "no-deps", "package.json"))).toBe(true);
    // No stamp file: the directory existing *is* the completeness signal.
    expect(existsSync(join(target, ".bun-ok"))).toBe(false);

    // Fake a leftover staging sibling and re-install — the published entry
    // should warm-hit unchanged.
    await mkdir(`${target}.tmp-deadbeef`, { recursive: true });
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"))).toBe(target);
    expect(existsSync(join(target, "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("bun's resolver follows the double-hop chain into the global store", async () => {
    // Regression test for the Windows EISDIR: `node_modules/.bun/<pkg>` is a
    // symlink into `<cache>/links/`, and the dep symlinks inside the global
    // entry are *relative* to the entry's physical location. The Windows
    // `RealFS.kind()` symlink walk used to join those relative targets
    // against the *logical* `dirname()` (which still contains the
    // `node_modules/.bun/<pkg>` segment), miss, fall back to `.file`, and the
    // resolver would then `ReadFile` a directory. Exercising an actual
    // `require()` through a transitive dep proves the chain resolves
    // end-to-end on every platform.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-resolver",
        // two-range-deps → no-deps gives a transitive hop inside the GVS.
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );
    await write(
      join(packageDir, "index.js"),
      `console.log(JSON.stringify({
        direct: require("two-range-deps/package.json").name,
        transitive: require(require.resolve("no-deps/package.json", {
          paths: [require("path").dirname(require.resolve("two-range-deps/package.json"))],
        })).name,
      }));`,
    );

    await runBunInstall(installEnv(packageDir), packageDir);
    // The entry must actually be a global-store symlink for this test to mean
    // anything (guards against a future default flip silently neutering it).
    expect(lstatSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")).isSymbolicLink()).toBe(true);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "index.js"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("EISDIR");
    expect(code).toBe(0);
    expect(JSON.parse(out.trim())).toEqual({ direct: "two-range-deps", transitive: "no-deps" });
  });

  test("an entry that loses global-store eligibility detaches without mutating the shared entry", async () => {
    // Regression: a previously-GVS entry that becomes project-local on the
    // next install (newly patched, newly trusted, …) used to write its new
    // tree *through* the stale `node_modules/.bun/<storepath>` symlink into
    // the shared cache. On Windows the `.expect_missing` dep-symlink rewrite
    // then baked a project-absolute junction target into the shared entry,
    // which dangled after `rm -rf node_modules`.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-gvs-to-local",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const gvsTarget = readlinkSync(entry);
    const gvsDepLink = readlinkSync(join(gvsTarget, "node_modules", "no-deps"));

    // Flip eligibility: trustedDependencies makes it project-local on the
    // next install regardless of whether it actually has scripts.
    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-gvs-to-local",
        dependencies: { "two-range-deps": "1.0.0" },
        trustedDependencies: ["two-range-deps"],
      }),
    );
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    // The project entry is now a real directory…
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    // …and the shared GVS entry's dep symlink is untouched (still the
    // global-relative target, not a project-absolute path).
    expect(readlinkSync(join(gvsTarget, "node_modules", "no-deps"))).toBe(gvsDepLink);
    expect(gvsDepLink).toMatch(/^\.\.[\/\\]\.\.[\/\\]no-deps@/);
  });

  test("upgrades a pre-global-store node_modules in place", async () => {
    // A project installed before this change has `node_modules/.bun/<X>` as a
    // real directory. Re-running install with the global store enabled must
    // replace that directory with a symlink (not fail with EEXIST or leave the
    // stale tree behind).
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-upgrade",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...installEnv(packageDir), BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(existsSync(join(entry, "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("disabling the global store detaches entries on the next install", async () => {
    // The reverse of the upgrade test above: a project installed with the
    // global store enabled has `node_modules/.bun/<X>` symlinks into
    // `<cache>/links/`. Re-running install with the store disabled must
    // replace those links with real project-local directories — the
    // warm-path existence check passes *through* a live link, so without
    // stale-link detection the project would silently keep running against
    // (and a later rebuild would write into) the shared store.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-disable",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const globalTarget = readlinkSync(entry);

    await runBunInstall({ ...installEnv(packageDir), BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir, {
      savesLockfile: false,
    });

    // Every entry is detached into a real project-local directory.
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    const depEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.1.0");
    expect(lstatSync(depEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(depEntry).isDirectory()).toBe(true);

    // The rebuilt project-local tree resolves, including dep links between
    // detached entries.
    expect(await file(join(entry, "node_modules", "two-range-deps", "package.json")).json()).toMatchObject({
      name: "two-range-deps",
      version: "1.0.0",
    });
    expect(await file(join(entry, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      name: "no-deps",
    });
    expect(await file(join(packageDir, "node_modules", "two-range-deps", "package.json")).json()).toMatchObject({
      name: "two-range-deps",
    });

    // The shared global entry is left untouched for other projects.
    expect(existsSync(join(globalTarget, "node_modules", "two-range-deps", "package.json"))).toBe(true);
  });

  test("preserves bun patch workspace when install runs before --commit", async () => {
    // Regression: `bun patch <pkg>` detaches the project store entry from the
    // global virtual store (symlink → real directory) so the user can edit it.
    // A subsequent `bun install` (e.g. to add another dep) before `--commit`
    // must not see that real directory as a stale pre-GVS layout and
    // `deleteTree` the user's in-progress edits.
    const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-patch-preserve",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);
    const workspace = join(packageDir, "node_modules", "no-deps");
    expect(lstatSync(workspace).isSymbolicLink()).toBe(true);

    await using proc = spawn({
      cmd: [bunExe(), "patch", "no-deps"],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error");
    expect(stdout).toContain("To patch");
    expect(exitCode).toBe(0);

    // `bun patch` detached the top-level dep symlink into a real directory
    // for the user to edit. The `.bun/<storepath>` GVS symlink is untouched.
    expect(lstatSync(workspace).isSymbolicLink()).toBe(false);
    expect(lstatSync(workspace).isDirectory()).toBe(true);

    const edited = join(workspace, "index.js");
    await write(edited, "module.exports = 'USER_EDITS';\n");

    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    // The real-directory workspace is preserved across the install; before
    // this fix `.expect_existing` would `deleteTree` it on readlink EINVAL
    // and re-symlink, wiping the edits.
    expect(lstatSync(workspace).isSymbolicLink()).toBe(false);
    expect(await file(edited).text()).toBe("module.exports = 'USER_EDITS';\n");
  });
});

test.concurrent("rejects dependency aliases that traverse outside node_modules", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // A (transitively) malicious package.json can use an arbitrary string as a
  // dependency alias. The alias becomes a `node_modules/<alias>` path
  // component in the isolated store layout, so a `..` segment lets it plant
  // symlinks outside of node_modules. Such an alias is refused while resolving
  // (the installer has its own check as well, see the next test).
  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-unsafe-alias",
      dependencies: {
        "../pwned-by-alias": "npm:no-deps@1.0.0",
      },
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: installEnv(packageDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain('invalid dependency name "../pwned-by-alias"');
  // Nothing may be created outside of node_modules. `lstatSync` instead of
  // `existsSync` because the escaped artifact would be a dangling symlink.
  expect(() => lstatSync(join(packageDir, "pwned-by-alias"))).toThrow();
  expect(exitCode).not.toBe(0);
});

test.concurrent("rejects a dependency alias with more than one path component", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-nested-alias",
      dependencies: {
        "somepkg/lib": "npm:no-deps@1.0.0",
      },
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: installEnv(packageDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain('invalid dependency name "somepkg/lib"');
  expect(() => lstatSync(join(packageDir, "node_modules", "somepkg", "lib"))).toThrow();
  expect(exitCode).not.toBe(0);
});

test.concurrent("rejects a tarball whose name is reserved by the installer", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // A tarball declares its own name in its package.json. Every hoisted store
  // entry is also linked under that name in `.bun/node_modules`, and the
  // `.bin` of that directory is on the PATH of every lifecycle script in the
  // store. A tarball named `.bin` would put its files there.
  await Bun.Archive.write(
    join(packageDir, "helper.tgz"),
    {
      "package/package.json": JSON.stringify({ name: ".bin", version: "1.0.0" }),
      "package/node": "#!/bin/sh\n",
    },
    { compress: "gzip" },
  );
  await write(
    packageJson,
    JSON.stringify({ name: "test-pkg-tarball-own-name", dependencies: { helper: "file:./helper.tgz" } }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: installEnv(packageDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`".bin" is not a valid install folder name`);
  expect(() => lstatSync(join(packageDir, "node_modules", ".bun", "node_modules", ".bin"))).toThrow();
  expect(exitCode).not.toBe(0);
});

// The project is never an entry of node_modules under its own name, so a name
// that no dependency could have does not stop the install. npm accepts these too.
test.concurrent.each(["@acme", ".internal", "node_modules"])("installs a project whose own name is %p", async name => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(packageJson, JSON.stringify({ name, dependencies: { "no-deps": "1.0.0" } }));

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: installEnv(packageDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");
  expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toContain("no-deps@1.0.0");
  expect(exitCode).toBe(0);
});

test.concurrent("invalid --linker value is echoed back in the error", async () => {
  using dir = tempDir("install-linker-err", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker=isoalted"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain('--linker: "isoalted"');
  expect(stderr).toContain("'isolated' or 'hoisted'");
  expect(exitCode).toBe(1);
});

test.concurrent("store build timings are printed by --verbose only", async () => {
  const { packageJson, packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "store-timings",
      dependencies: {
        "no-deps": "1.0.0",
      },
    }),
  );

  async function install(...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: packageDir,
      env: installEnv(packageDir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return stderr;
  }

  const verbose = await install("--verbose");
  expect(verbose).toMatch(/^Resolved peers \[\S+\]$/m);
  expect(verbose).toMatch(/^Created store \[\S+\]$/m);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  const quiet = await install();
  expect(quiet).not.toContain("Resolved peers");
  expect(quiet).not.toContain("Created store");
});

describe.concurrent("link: dependencies", () => {
  // Size of the buffer install paths are built in (`MAX_PATH_BYTES`): PATH_MAX
  // on Linux and macOS, the UTF-8 worst case of a 32767 character path on Windows.
  const MAX_PATH_BYTES = isWindows ? 32767 * 3 + 1 : isLinux ? 4096 : 1024;

  // A `link:` path to `<dir>/linked` that is about `length` bytes as written.
  function linkTarget(length: number): string {
    const segments = Math.floor((length - "../linked".length) / "x/../".length);
    return Buffer.alloc(segments * "x/../".length, "x/../").toString() + "../linked";
  }

  // `..` segments are resolved before the length check, so only a target still this long
  // afterwards fails it (here while package.json is read). No directory of this name can exist,
  // which is the point: the install has to report the length instead of overrunning a buffer.
  const targetTooLongOnceJoined = Buffer.alloc(MAX_PATH_BYTES - 16, "l").toString();

  const linkedPackageJson = JSON.stringify({ name: "linked", version: "1.0.0" });

  // Registers `<dir>/linked` in a global link dir private to the test, so the
  // dir every `link:` target is joined onto is `<dir>/global/node_modules`.
  async function registerLinked(dir: string) {
    const env = {
      ...bunEnv,
      BUN_INSTALL_GLOBAL_DIR: join(dir, "global"),
      BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
    };
    await using proc = spawn({
      cmd: [bunExe(), "link"],
      cwd: join(dir, "linked"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain('Registered "linked"');
    expect(exitCode).toBe(0);

    return { env, projectDir: join(dir, "project"), linkDir: join(dir, "global", "node_modules") };
  }

  async function installIsolated(env: NodeJS.Dict<string>, cwd: string) {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker=isolated"],
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("links the package when the target fits", async () => {
    using dir = tempDir("isolated-link-fits", {
      "linked/package.json": linkedPackageJson,
      "project/package.json": JSON.stringify({
        name: "link-fits",
        dependencies: { linked: "link:" + linkTarget(256) },
      }),
    });
    const { env, projectDir } = await registerLinked(String(dir));

    const { stderr, exitCode } = await installIsolated(env, projectDir);

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(lstatSync(join(projectDir, "node_modules", "linked")).isSymbolicLink()).toBeTrue();
    expect(await file(join(projectDir, "node_modules", "linked", "package.json")).json()).toEqual({
      name: "linked",
      version: "1.0.0",
    });
  });

  test.concurrent("fails with ENAMETOOLONG when the target in bun.lock does not fit", async () => {
    // A lockfile resolution is used as-is, so this never passes through the
    // resolver: the linker is the first thing that builds a path from it.
    const target = Buffer.alloc(MAX_PATH_BYTES + 64, "l").toString();
    using dir = tempDir("isolated-link-lockfile-too-long", {
      "linked/package.json": linkedPackageJson,
      "project/package.json": JSON.stringify({
        name: "link-from-lockfile",
        dependencies: { linked: "link:linked" },
      }),
      "project/bun.lock": `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "link-from-lockfile",
      "dependencies": {
        "linked": "link:linked",
      },
    },
  },
  "packages": {
    "linked": ["linked@link:${target}", {}],
  }
}
`,
    });
    const { env, projectDir } = await registerLinked(String(dir));

    const { stderr, exitCode } = await installIsolated(env, projectDir);

    expect(stderr).toContain("ENAMETOOLONG: link path for package linked is too long");
    expect(exitCode).toBe(1);
    expect(() => lstatSync(join(projectDir, "node_modules", "linked"))).toThrow();
  });

  test.concurrent("fails when the target in package.json does not fit", async () => {
    // Fits on its own; does not fit once joined onto the project.
    const target = targetTooLongOnceJoined;
    using dir = tempDir("isolated-link-package-json-too-long", {
      "linked/package.json": linkedPackageJson,
      "project/package.json": JSON.stringify({
        name: "link-from-package-json",
        dependencies: { linked: "link:" + target },
      }),
    });
    const { env, projectDir } = await registerLinked(String(dir));
    expect(projectDir.length + "/".length + target.length).toBeGreaterThanOrEqual(MAX_PATH_BYTES);

    const { stderr, exitCode } = await installIsolated(env, projectDir);

    expect(stderr).toContain('error: Dependency "linked" has an unsafe folder path');
    expect(exitCode).toBe(1);
    expect(() => lstatSync(join(projectDir, "node_modules", "linked"))).toThrow();
  });

  test.concurrent("fails the workspace package that depends on a target that does not fit", async () => {
    const target = targetTooLongOnceJoined;
    using dir = tempDir("isolated-link-workspace-too-long", {
      "linked/package.json": linkedPackageJson,
      "project/package.json": JSON.stringify({
        name: "link-from-workspace",
        workspaces: ["packages/*"],
      }),
      "project/packages/app/package.json": JSON.stringify({
        name: "app",
        dependencies: { linked: "link:" + target },
      }),
    });
    const { env, projectDir } = await registerLinked(String(dir));
    expect(projectDir.length + "/".length + target.length).toBeGreaterThanOrEqual(MAX_PATH_BYTES);

    const { stderr, exitCode } = await installIsolated(env, projectDir);

    expect(stderr).toContain('error: Dependency "linked" has an unsafe folder path');
    expect(exitCode).toBe(1);
    expect(() => lstatSync(join(projectDir, "packages", "app", "node_modules", "linked"))).toThrow();
  });
});

describe.concurrent("hoist", () => {
  // `node_modules/.bun/node_modules` holds a symlink for every dependency
  // name and sits on the upward resolution path of every store entry, so
  // by default a store package can resolve dependencies it never declared.
  // `install.hoist = false` (pnpm's `hoist=false`) skips that fallback
  // directory without touching the rest of the layout.
  test("hoist = false skips the hidden fallback directory", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", hoist: false },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-false",
        dependencies: {
          "two-range-deps": "1.0.0",
          "a-dep": "1.0.1",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();

    // declared dependency symlinks are unchanged
    expect(readlinkSync(join(packageDir, "node_modules", "a-dep"))).toBe(
      join(".bun", "a-dep@1.0.1", "node_modules", "a-dep"),
    );
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );

    // a store package still resolves the dependencies it declares
    const fromTwoRangeDeps = createRequire(
      join(
        packageDir,
        "node_modules",
        ".bun",
        "two-range-deps@1.0.0",
        "node_modules",
        "two-range-deps",
        "package.json",
      ),
    );
    expect(fromTwoRangeDeps.resolve("no-deps/package.json")).toEndWith(
      join(".bun", "no-deps@1.1.0", "node_modules", "no-deps", "package.json"),
    );

    // and cannot resolve a package it does not declare
    const fromADep = createRequire(
      join(packageDir, "node_modules", ".bun", "a-dep@1.0.1", "node_modules", "a-dep", "package.json"),
    );
    expect(() => fromADep.resolve("no-deps/package.json")).toThrow(
      expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
    );

    // packages linked at the project root (here: a direct dependency) remain
    // reachable because `.bun` lives inside node_modules, matching pnpm
    expect(fromADep.resolve("two-range-deps/package.json")).toEndWith(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps", "package.json"),
    );
  });

  test("hoist = false keeps publicHoistPattern working", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", hoist: false, publicHoistPattern: "*types*" },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-public",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    // the transitive @types/is-number is still publicly hoisted to the root
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "@types", "two-range-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "@types", "is-number"))).toBe(
      join("..", ".bun", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"),
    );
    // while the hidden fallback is not created
    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();
  });

  test("hoist = false removes a stale fallback directory from a previous install", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-stale",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    // hoisting is on by default: transitive deps resolve through the fallback
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.1.0", "node_modules", "no-deps"),
    );

    await registry.writeBunfig(packageDir, { linker: "isolated", hoist: false });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });

    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();

    // the rest of the install is untouched: removing the fallback symlinks
    // must not touch the store entries they pointed at
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
    expect(await file(join(packageDir, "node_modules", "two-range-deps", "package.json")).json()).toMatchObject({
      name: "two-range-deps",
    });
    expect(
      await file(
        join(packageDir, "node_modules", ".bun", "no-deps@1.1.0", "node_modules", "no-deps", "package.json"),
      ).json(),
    ).toMatchObject({ name: "no-deps", version: "1.1.0" });
  });

  test("hoistPattern set after an install removes the fallback links it does not match", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });
    await write(packageJson, JSON.stringify({ name: "hoist-narrowed", dependencies: { "two-range-deps": "1.0.0" } }));
    const fallback = join(packageDir, "node_modules", ".bun", "node_modules");

    await runBunInstall(installEnv(packageDir), packageDir);
    expect(await readdirSorted(fallback)).toEqual(["@types", "no-deps", "two-range-deps"]);

    await registry.writeBunfig(packageDir, { linker: "isolated", hoistPattern: ["no-*"] });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await readdirSorted(fallback)).toEqual(["no-deps"]);
    expect(readlinkSync(join(fallback, "no-deps"))).toBe(join("..", "no-deps@1.1.0", "node_modules", "no-deps"));

    // and back
    await registry.writeBunfig(packageDir, { linker: "isolated" });
    await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile: false });
    expect(await readdirSorted(fallback)).toEqual(["@types", "no-deps", "two-range-deps"]);
  });

  test("hoist = false takes precedence over hoistPattern", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", hoist: false, hoistPattern: "*" },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-precedence",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();
  });

  test("npmrc hoist=false", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        ".npmrc": "hoist=false",
      },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-npmrc",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
  });

  // A fallback link carries the name of a dependency, as `node_modules/<name>`
  // does in the package that declares it. The real name of a package and an
  // `npm:` alias of it are two names, so they are two links, and one store
  // entry writes each (#40355).
  async function fallbackLinks(packageDir: string): Promise<Record<string, string>> {
    const dir = join(packageDir, "node_modules", ".bun", "node_modules");
    const links: Record<string, string> = {};
    for (const name of await readdirSorted(dir)) {
      if (name.startsWith("@")) {
        for (const scoped of await readdirSorted(join(dir, name))) {
          links[`${name}/${scoped}`] = readlinkSync(join(dir, name, scoped));
        }
      } else {
        links[name] = readlinkSync(join(dir, name));
      }
    }
    return links;
  }
  const inStore = (entry: string, name: string) => join("..", entry, "node_modules", name);
  const requireFrom = (packageDir: string, entry: string, name: string) =>
    createRequire(join(packageDir, "node_modules", ".bun", entry, "node_modules", name, "package.json"));

  test.concurrent.each(["an-alias", "z-alias"])(
    "the real name of a package and the npm: alias %s are separate fallback links",
    async alias => {
      const { packageJson, packageDir } = await registry.createTestDir({
        bunfigOpts: { linker: "isolated" },
      });

      await write(
        packageJson,
        JSON.stringify({
          name: "hoist-alias-and-real-name",
          dependencies: {
            [alias]: "npm:no-deps@2.0.0",
            "no-deps": "1.0.0",
          },
        }),
      );

      // the second install finds `node_modules/.bun` and checks the links
      // that are already there
      for (const savesLockfile of [true, false]) {
        await runBunInstall(installEnv(packageDir), packageDir, { savesLockfile });

        expect(await fallbackLinks(packageDir)).toEqual({
          // mirrors node_modules/no-deps
          "no-deps": inStore("no-deps@1.0.0", "no-deps"),
          [alias]: inStore("no-deps@2.0.0", "no-deps"),
        });
      }
    },
  );

  test.concurrent("the real name keeps its fallback link when it shares a store entry with an alias", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-alias-dedupe",
        dependencies: {
          // same version as the real name, so the real name joins the store
          // entry the alias created
          "an-alias": "npm:no-deps@1.0.0",
          "no-deps": "1.0.0",
          // depends on no-deps@2.0.0, which must not take the `no-deps` link
          "one-fixed-dep": "2.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await fallbackLinks(packageDir)).toEqual({
      "an-alias": inStore("no-deps@1.0.0", "no-deps"),
      "no-deps": inStore("no-deps@1.0.0", "no-deps"),
      "one-fixed-dep": inStore("one-fixed-dep@2.0.0", "one-fixed-dep"),
    });
  });

  test.concurrent("a package installed under aliases only has no fallback link under its own name", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-alias-only",
        dependencies: {
          // two names for one store entry
          "an-alias": "npm:no-deps@1.0.0",
          "@scoped/alias": "npm:no-deps@1.0.0",
          "types-alias": "npm:@types/is-number@1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await fallbackLinks(packageDir)).toEqual({
      "an-alias": inStore("no-deps@1.0.0", "no-deps"),
      "@scoped/alias": join("..", inStore("no-deps@1.0.0", "no-deps")),
      "types-alias": inStore("@types+is-number@1.0.0", join("@types", "is-number")),
    });

    // a store package that declares nothing does not find the name the package gave itself
    const fromTypes = requireFrom(packageDir, "@types+is-number@1.0.0", join("@types", "is-number"));
    expect(() => fromTypes.resolve("no-deps/package.json")).toThrow(
      expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
    );
  });

  // A store entry is the only thing linked into the fallback directory, so a
  // workspace, `file:` or `link:` entry must not take a fallback name when a
  // dependency joins it: a store package reached under that name deeper in
  // the tree needs it.
  test.concurrent("a name that a workspace is reached under can still be used by a store package", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: {
        "packages/lib/package.json": JSON.stringify({ name: "no-deps", version: "5.0.0" }),
        "packages/one/package.json": JSON.stringify({
          name: "one",
          version: "1.0.0",
          // uses-a-dep-3 depends on the registry's a-dep@1.0.3
          dependencies: { "no-deps": "workspace:*", "uses-a-dep-3": "1.0.0", "basic-1": "1.0.0" },
        }),
        "packages/two/package.json": JSON.stringify({
          name: "two",
          version: "1.0.0",
          // reaches the workspace package under a second name
          dependencies: { "a-dep": "npm:no-deps@*" },
        }),
      },
    });

    await write(packageJson, JSON.stringify({ name: "hoist-workspace-name", workspaces: ["packages/*"] }));

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await fallbackLinks(packageDir)).toEqual({
      // the workspace package gets no link, and leaves `a-dep` to the store package
      "a-dep": inStore("a-dep@1.0.3", "a-dep"),
      "basic-1": inStore("basic-1@1.0.0", "basic-1"),
      "uses-a-dep-3": inStore("uses-a-dep-3@1.0.0", "uses-a-dep-3"),
    });

    // basic-1 declares nothing and the project root doesn't link a-dep, so this goes through the fallback link.
    expect(requireFrom(packageDir, "basic-1@1.0.0", "basic-1").resolve("a-dep/package.json")).toEndWith(
      join(".bun", "a-dep@1.0.3", "node_modules", "a-dep", "package.json"),
    );
  });

  test.concurrent("a package installed under another package's name holds the fallback link for it", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-replaced-by-name",
        dependencies: {
          // the project replaces no-deps
          "no-deps": "npm:a-dep@1.0.1",
          // depends on the real no-deps@2.0.0
          "one-fixed-dep": "2.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await fallbackLinks(packageDir)).toEqual({
      // mirrors node_modules/no-deps
      "no-deps": inStore("a-dep@1.0.1", "a-dep"),
      "one-fixed-dep": inStore("one-fixed-dep@2.0.0", "one-fixed-dep"),
    });

    // the fallback directory comes before the root node_modules, so a link to the real no-deps there would win
    expect(requireFrom(packageDir, "a-dep@1.0.1", "a-dep").resolve("no-deps/package.json")).toEndWith(
      join(".bun", "a-dep@1.0.1", "node_modules", "a-dep", "package.json"),
    );
    // the package that declares no-deps gets the real one
    expect(requireFrom(packageDir, "one-fixed-dep@2.0.0", "one-fixed-dep").resolve("no-deps/package.json")).toEndWith(
      join(".bun", "no-deps@2.0.0", "node_modules", "no-deps", "package.json"),
    );
  });

  test.concurrent("hoistPattern matches the dependency name", async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", hoistPattern: ["an-alias", "a-dep"] },
    });

    await write(
      packageJson,
      JSON.stringify({
        name: "hoist-pattern-alias",
        dependencies: {
          "an-alias": "npm:no-deps@2.0.0",
          // the package name matches, the dependency name does not
          "other-name": "npm:a-dep@1.0.1",
          "basic-1": "1.0.0",
        },
      }),
    );

    await runBunInstall(installEnv(packageDir), packageDir);

    expect(await fallbackLinks(packageDir)).toEqual({
      "an-alias": inStore("no-deps@2.0.0", "no-deps"),
    });
  });
});

describe.concurrent("global install", () => {
  function sandbox(name: string, files: Record<string, string> = {}) {
    const dir = tempDir(name, files);
    const root = String(dir);
    const globalDir = join(root, "bun-install", "install", "global");
    const list = (...path: string[]) => (existsSync(join(...path)) ? readdirSync(join(...path)).sort() : []);
    return {
      root,
      globalBin: () => list(root, "bun-install", "bin"),
      localBin: () => list(globalDir, "node_modules", ".bin"),
      nodeModules: (...path: string[]) => join(globalDir, "node_modules", ...path),
      async run(cwd: string, ...args: string[]) {
        await using proc = spawn({
          cmd: [bunExe(), ...args],
          cwd: join(root, cwd),
          env: {
            ...bunEnv,
            BUN_INSTALL: join(root, "bun-install"),
            BUN_INSTALL_CACHE_DIR: join(root, "cache"),
            BUN_CONFIG_REGISTRY: registry.registryUrl(),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
      },
      [Symbol.dispose]: () => dir[Symbol.dispose](),
    };
  }
  const binFiles = (...names: string[]) =>
    names.flatMap(name => (isWindows ? [`${name}.bunx`, `${name}.exe`] : [name]));

  // https://github.com/oven-sh/bun/issues/30450
  test("links the bins of the requested package into the global bin dir", async () => {
    using box = sandbox("isolated-global-bin");
    await box.run(".", "add", "-g", "--linker=isolated", "what-bin@1.0.0");
    expect({ global: box.globalBin(), local: box.localBin() }).toEqual({ global: binFiles("what-bin"), local: [] });

    // A package that was installed earlier gets its missing link back, but only in the global bin directory.
    for (const name of box.globalBin()) rmSync(join(box.root, "bun-install", "bin", name));
    await box.run(".", "add", "-g", "--linker=isolated", "uses-what-bin@1.0.0", "--ignore-scripts");
    expect({ global: box.globalBin(), local: box.localBin() }).toEqual({ global: binFiles("what-bin"), local: [] });

    await box.run(".", "add", "-g", "--linker=isolated", "what-bin@1.0.0");
    expect({ global: box.globalBin(), local: box.localBin() }).toEqual({ global: binFiles("what-bin"), local: [] });
  });

  test("a project's install links no bin into the global bin dir", async () => {
    using box = sandbox("isolated-global-bin-local", {
      "proj/package.json": JSON.stringify({ name: "proj", dependencies: { "what-bin": "1.0.0" } }),
    });
    await box.run("proj", "install", "--linker=isolated");
    expect(readdirSync(join(box.root, "proj", "node_modules", ".bin")).sort()).toEqual(binFiles("what-bin"));
    expect(box.globalBin()).toEqual([]);
  });

  // The global node_modules is also the `bun link` registry, and bun.lock does not list the registrations.
  test.each([
    ["hoisted", "isolated"],
    ["isolated", "hoisted"],
  ])("`bun link` registrations survive the switch from %s to %s", async (before, after) => {
    using box = sandbox("global-link-registrations", {
      "linked/package.json": JSON.stringify({ name: "linked", version: "1.0.0" }),
      "scoped/package.json": JSON.stringify({ name: "@scope/linked", version: "1.0.0" }),
    });
    await box.run(".", "add", "-g", `--linker=${before}`, "@types/is-number@1.0.0");
    await box.run("linked", "link");
    await box.run("scoped", "link");

    await box.run(".", "add", "-g", `--linker=${after}`, "no-deps@1.0.0");

    expect({
      linked: realpathSync(box.nodeModules("linked")),
      scoped: realpathSync(box.nodeModules("@scope", "linked")),
      store: existsSync(box.nodeModules(".bun")),
    }).toEqual({
      linked: realpathSync(join(box.root, "linked")),
      scoped: realpathSync(join(box.root, "scoped")),
      store: after === "isolated",
    });
    for (const name of ["no-deps", join("@types", "is-number")]) {
      expect(lstatSync(box.nodeModules(name)).isSymbolicLink()).toBe(after === "isolated");
      expect(existsSync(box.nodeModules(name, "package.json"))).toBe(true);
    }
  });
});
