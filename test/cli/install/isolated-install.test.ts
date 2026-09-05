import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "fs";
import { mkdir, readlink, rm, symlink } from "fs/promises";
import {
  VerdaccioRegistry,
  bunEnv,
  bunExe,
  installEnv,
  normalizeBunSnapshot,
  readdirSorted,
  runBunInstall,
  tempDir,
} from "harness";
import { createRequire } from "module";
import { basename, dirname, join } from "path";
import { pathToFileURL } from "url";

const registry = new VerdaccioRegistry();

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

// `<name>@<resolution>`, with the resolution cut and hashed past MAX_RESOLUTION_LEN (see "long store entry names").
const MAX_RESOLUTION_LEN = 80;
const CUT_RESOLUTION_LEN = MAX_RESOLUTION_LEN - "+".length - 16;
function storeEntryName(name: string, resolution: string): string {
  if (resolution.length <= MAX_RESOLUTION_LEN) return `${name}@${resolution}`;
  return `${name}@${resolution.slice(0, CUT_RESOLUTION_LEN)}+${urlHash(resolution)}`;
}

// The cases run concurrently, so every install runs with the `env` that pins
// the cache to the case's own project: from `registry.createTestDir`, or
// `installEnv` for the cases that build their project with `tempDir`.

// Everything bun wrote to stderr, except the two progress lines it prints to a
// non-TTY stderr while it resolves: the count in "Resolved, downloaded and
// extracted [N]" is the number of network tasks, which depends on the cache.
function stderrLines(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .filter(
      line =>
        line !== "" && line !== "Resolving dependencies" && !/^Resolved, downloaded and extracted \[\d+\]$/.test(line),
    );
}

// `bun install` in `cwd` must exit 0 with exactly `stderr` on stderr (see
// `stderrLines`). The default is the one line bun prints after it wrote
// bun.lock; an install that leaves the lockfile alone prints nothing.
async function install(
  env: NodeJS.Dict<string>,
  cwd: string,
  { args = [], stderr: expectedStderr = ["Saved lockfile"] }: { args?: string[]; stderr?: string[] } = {},
) {
  await using proc = spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderrLines(stderr)).toEqual(expectedStderr);
  expect(exitCode).toBe(0);
}

// The cases that build a git repository need the git executable.
const gitExecutable = Bun.which("git");
// The git patch case is the heaviest of the file: five installs that each
// clone and check out, after the git commands that build its repository. It
// runs on its own; inside the concurrent group it takes 2.5 times as long and
// passes the default timeout on a Windows debug build.
const heavyGitTest = test.serial.skipIf(!gitExecutable);

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe.concurrent("basic", () => {
  test("single dependency", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-1",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(env, packageDir);

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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-2",
        dependencies: {
          "@types/is-number": "1.0.0",
        },
      }),
    );

    await runBunInstall(env, packageDir);

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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-3",
        dependencies: {
          "two-range-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(env, packageDir);

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
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-cyclic",
      dependencies: {
        "a-dep-b": "1.0.0",
      },
    }),
  );

  await runBunInstall(env, packageDir);

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
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  await runBunInstall(env, packageDir);

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

test.concurrent("early dedupe keeps declarer-specific resolutions of an unprovided peer", async () => {
  // `dedupe-divergent-peers` pulls in two declarers of the peer name
  // `no-deps` with divergent ranges: `dedupe-cycle-peer` wants 1.0.0 and
  // `dedupe-divergent-strict` wants ^2.0.0. Neither workspace chain provides
  // `no-deps`, so the shared subtree dedupes on the unresolved name and each
  // declarer must still auto-install its own best version. `ws-three` seeds
  // both no-deps versions into the lockfile under aliases (a different
  // dependency name, so they provide nothing to the peer).
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  await runBunInstall(env, packageDir);

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
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-transitive-self-dep",
      dependencies: {
        "self-dep": "1.0.2",
      },
    }),
  );

  await runBunInstall(env, packageDir);

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
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  await runBunInstall(env, packageDir);

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

  await runBunInstall(env, packageDir, { savesLockfile: false });
  expect(readlinkSync(join(packageDir, "node_modules", "folder-dep"))).toBe(
    join(".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep"),
  );
  expect(
    await file(
      join(packageDir, "node_modules", ".bun", "folder-dep@file+pkg-1", "node_modules", "folder-dep", "index.js"),
    ).text(),
  ).toBe("module.exports = 'hello from pkg-1';");
});

test.concurrent("can install folder dependencies on root package", async () => {
  const { packageDir, packageJson, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  await runBunInstall(env, packageDir);

  expect(
    await Promise.all([
      readlink(join(packageDir, "node_modules", "self")),
      readlink(join(packageDir, "packages", "pkg1", "node_modules", "root")),
      file(join(packageDir, "node_modules", "self", "package.json")).json(),
    ]),
  ).toEqual([
    join(".bun", "root-file-dep@root", "node_modules", "root-file-dep"),
    join("..", "..", "..", "node_modules", ".bun", "root-file-dep@root", "node_modules", "root-file-dep"),
    await file(packageJson).json(),
  ]);
});

describe.concurrent("isolated workspaces", () => {
  test("basic", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

    await runBunInstall(env, packageDir);

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
    const { packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

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
      const { packageDir, env } = await registry.createTestDir({
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

      async function checkInstall(savesLockfile: boolean) {
        await install(env, packageDir, { stderr: savesLockfile ? ["Saved lockfile"] : [] });
        expect(await readdirSorted(join(packageDir, "node_modules/.bun"))).toEqual(expected);
      }

      // without lockfile
      // without node_modules
      await checkInstall(true);

      // with lockfile
      // without node_modules
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await checkInstall(false);

      // without lockfile
      // with node_modules
      await rm(join(packageDir, "bun.lock"), { force: true });
      await checkInstall(true);

      // with lockfile
      // with node_modules
      await checkInstall(false);
    });
  }

  test("successfully resolves optional peer with nested package", async () => {
    const { packageDir, env } = await registry.createTestDir({
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

    async function checkInstall(savesLockfile: boolean) {
      await install(env, packageDir, { stderr: savesLockfile ? ["Saved lockfile"] : [] });

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "one-dep", "one-one-dep"]);
      expect(await readdirSorted(join(packageDir, "node_modules/.bun"))).toEqual([
        "no-deps@1.0.1",
        "node_modules",
        "one-dep@1.0.0",
        "one-one-dep@1.0.0",
      ]);
    }

    await checkInstall(true);
    await checkInstall(false);
  });
});

// https://github.com/oven-sh/bun/issues/28147
test.concurrent("patched package shared by multiple peer variants is materialized into the cache once", async () => {
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  // The cache `env` pins; the patched cache directory is created here.
  const cacheDir = join(packageDir, ".bun-cache");

  // Force the hardlink backend so the inode assertions below hold on every
  // platform (macOS defaults to clonefile, which copies).
  const installArgs = ["--backend", "hardlink"];

  // One variant per workspace; the suffix hashes the peer set (no-deps@1.0.0,
  // 1.1.0, 2.0.0 and 1.0.1, in this order).
  const storeDirs = [
    "peer-deps@1.0.0+7347ae2d86f1441a",
    "peer-deps@1.0.0+7ff199101204a65d",
    "peer-deps@1.0.0+e27e69f8c16af2a6",
    "peer-deps@1.0.0+f8a822eca018d0a1",
  ];

  async function checkInstall() {
    expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual([
      ...noDepsVersions.map(version => `no-deps@${version}`),
      "node_modules",
      ...storeDirs,
    ]);

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

  await install(env, packageDir, { args: installArgs });
  await checkInstall();

  // Reinstall with a warm cache and no node_modules: the patched cache
  // directory already exists and must not be rebuilt per variant.
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await install(env, packageDir, { args: installArgs, stderr: [] });
  await checkInstall();
});

test.concurrent("adding, removing and re-adding a patch for an npm dependency", async () => {
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
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
    // Every step changes patchedDependencies, so every step saves the lockfile.
    await install(env, packageDir, { args: ["--backend", "hardlink"] });
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
  const {
    packageJson,
    packageDir,
    env: baseEnv,
  } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // Minimal gzipped tarball shaped like a github codeload tarball: a single
  // root directory wrapping the package contents.
  function tarHeader(name: string, size: number, isDir: boolean): Uint8Array {
    const header = new Uint8Array(512);
    const encoder = new TextEncoder();
    header.set(encoder.encode(name), 0);
    header.set(encoder.encode(isDir ? "0000755 " : "0000644 "), 100);
    header.set(encoder.encode("0000000 "), 108);
    header.set(encoder.encode("0000000 "), 116);
    header.set(encoder.encode(size.toString(8).padStart(11, "0") + " "), 124);
    header.set(encoder.encode("00000000000 "), 136);
    header.set(encoder.encode("        "), 148);
    header[156] = (isDir ? "5" : "0").charCodeAt(0);
    header.set(encoder.encode("ustar"), 257);
    header.set(encoder.encode("00"), 263);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.set(encoder.encode(checksum.toString(8).padStart(6, "0") + "\0 "), 148);
    return header;
  }
  const blocks: Uint8Array[] = [];
  blocks.push(tarHeader("testowner-testrepo-aaaaaaa/", 0, true));
  for (const [name, contents] of [
    ["package.json", JSON.stringify({ name: "gh-dep", version: "1.0.0" })],
    ["index.js", 'console.log("original");\n'],
  ]) {
    const bytes = new TextEncoder().encode(contents);
    blocks.push(tarHeader(`testowner-testrepo-aaaaaaa/${name}`, bytes.length, false));
    blocks.push(bytes);
    if (bytes.length % 512 !== 0) blocks.push(new Uint8Array(512 - (bytes.length % 512)));
  }
  blocks.push(new Uint8Array(1024));
  const tarball = Bun.gzipSync(Buffer.concat(blocks));

  using server = Bun.serve({
    port: 0,
    fetch: () => new Response(tarball, { headers: { "Content-Type": "application/gzip" } }),
  });

  const env = { ...baseEnv, GITHUB_API_URL: `http://localhost:${server.port}` };

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

  await install(env, packageDir);
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
  await install(env, packageDir);
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

  // Cold cache with the patch still in the lockfile: the install phase itself
  // downloads the tarball and applies the patch after extraction.
  await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "packages", "member", "node_modules"), { recursive: true, force: true });
  await install(env, packageDir, { stderr: [] });
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

  // Removing the patch re-resolves again and rebuilds the store entry from
  // the unpatched cache folder (the PatchInfo::Remove path, which hung the
  // same way).
  await write(packageJson, JSON.stringify(rootPackageJson));
  await install(env, packageDir);
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
  await install(env, packageDir);
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');
});

// Same deadlock through the git: task-id space (clone + checkout tasks
// instead of a tarball download). The repo is served over git's dumb HTTP
// protocol: after `git update-server-info`, a bare repo is plain static
// files. Requires the git executable to build the fixture repository.
heavyGitTest("adding and removing a patch for a git dependency in a workspace completes", async () => {
  const {
    packageJson,
    packageDir,
    env: baseEnv,
  } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  const env = { ...baseEnv, ...gitConfigEnv };

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

  await install(env, packageDir);
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
  await install(env, packageDir);
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

  // Cold cache with the patch still in the lockfile: the install phase
  // clones and checks out itself, applying the patch after the checkout.
  await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "packages", "member", "node_modules"), { recursive: true, force: true });
  await install(env, packageDir, { stderr: [] });
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');

  await write(packageJson, JSON.stringify(rootPackageJson));
  await install(env, packageDir);
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
  await install(env, packageDir);
  expect(await installedIndexJs.text()).toBe('console.log("patched");\n');
});

for (const backend of ["clonefile", "hardlink", "copyfile"]) {
  test.concurrent(`isolated install with backend: ${backend}`, async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

    await install(env, packageDir, { args: ["--backend", backend] });

    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bun",
      "1-peer-dep-a",
      "@scoped",
      "alias-loop-1",
      "alias-loop-2",
      "basic-1",
      "file-dep",
      "is-number",
      "no-deps",
    ]);
    // `+7347ae2d86f1441a` hashes the peer set `no-deps@1.0.0`.
    expect(await readdirSorted(join(packageDir, "node_modules", ".bun"))).toEqual([
      "1-peer-dep-a@1.0.0+7347ae2d86f1441a",
      "@scoped+file-dep@file+scoped-file-dep",
      "alias-loop-1@1.0.0",
      "alias-loop-2@1.0.0",
      "basic-1@1.0.0",
      "file-dep@file+file-dep",
      "is-number@1.0.0",
      "no-deps@1.0.0",
      "node_modules",
    ]);

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
  // 1.1.0 used to come from two-range-deps' `no-deps@^1.0.0`, which only adds
  // its own copy when it is resolved before the 1.0.1 pin is appended; when
  // the manifests arrive the other way round it dedupes onto 1.0.1 and the
  // graph has one no-deps. Two exact pins do not depend on that order.
  const { packageJson, packageDir, env } = await registry.createTestDir({
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

  await runBunInstall(env, packageDir);

  // the premise: the saved tree hoists 1.0.1, which a path walk would bind to
  expect(await file(join(packageDir, "bun.lock")).text()).toContain('"no-deps": ["no-deps@1.0.1"');

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
  await runBunInstall(env, packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual([entryName]);
  expect(await file(join(bunDir, entryName, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.1.0",
  });
});

test.concurrent("aliased peer dependency binds to its real package across installs from bun.lock", async () => {
  // The peer alias `no-deps` points at `npm:a-dep@^1.0.2` while the real
  // no-deps package (in two versions) is also in the graph. Loading bun.lock
  // must look the edge up under the aliased *real* name (a-dep) the way the
  // fresh resolver does; a lookup under the alias would find the real
  // no-deps packages, whose versions also satisfy ^1.0.2, and rebind the
  // edge to the wrong package.
  const { packageDir, env } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
    files: {
      "package.json": JSON.stringify({
        name: "aliased-peer-root",
        workspaces: ["packages/*"],
        dependencies: {
          "normal-dep-and-dev-dep": "1.0.0",
          "two-range-deps": "1.0.0",
        },
      }),
      "packages/m/package.json": JSON.stringify({
        name: "m",
        version: "1.0.0",
        peerDependencies: { "no-deps": "npm:a-dep@^1.0.2" },
      }),
    },
  });

  await runBunInstall(env, packageDir);
  const aliasLink = join(packageDir, "packages", "m", "node_modules", "no-deps", "package.json");
  const fresh = await file(aliasLink).json();
  expect(fresh).toMatchObject({ name: "a-dep" });

  // reinstall from bun.lock: still the aliased package, same version
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await rm(join(packageDir, "packages", "m", "node_modules"), { recursive: true, force: true });
  await runBunInstall(env, packageDir, { savesLockfile: false });
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
  const { packageJson, packageDir, env } = await registry.createTestDir({
    bunfigOpts: { linker: "isolated" },
  });

  await write(
    packageJson,
    JSON.stringify({
      name: "stable-optional-peers",
      dependencies: {
        "one-optional-peer-dep": "1.0.2",
        "normal-dep-and-dev-dep": "1.0.0",
        "two-range-deps": "1.0.0",
      },
    }),
  );

  await runBunInstall(env, packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const freshEntries = (await readdirSorted(bunDir)).filter(e => e.startsWith("one-optional-peer-dep@"));
  expect(freshEntries).toHaveLength(1);
  // the hoisted candidate, not the highest satisfying (1.1.0)
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(env, packageDir, { savesLockfile: false });

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
  const { packageJson, packageDir, env } = await registry.createTestDir({
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

  await runBunInstall(env, packageDir);

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
  await runBunInstall(env, packageDir, { savesLockfile: false });

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
  const { packageDir, env } = await registry.createTestDir({
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

  await runBunInstall(env, packageDir);

  const bunDir = join(packageDir, "node_modules", ".bun");
  const freshEntries = (await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"));
  expect(freshEntries).toHaveLength(1);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
    workspaceMarker: true,
  });

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await runBunInstall(env, packageDir, { savesLockfile: false });

  expect((await readdirSorted(bunDir)).filter(e => e.startsWith("peer-deps-fixed@"))).toEqual(freshEntries);
  expect(await file(join(bunDir, freshEntries[0], "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.0",
    workspaceMarker: true,
  });
});

describe.concurrent("existing node_modules, missing node_modules/.bun", () => {
  test("root and workspace node_modules are reset", async () => {
    const { packageDir, env } = await registry.createTestDir({
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

    await install(env, packageDir);
    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "node_modules", ".bun")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([
      [".bun", expect.stringContaining(".old_modules-"), "a-dep", "no-deps"],
      ["a-dep@1.0.1", "no-deps@1.0.0", "no-deps@1.0.1", "no-deps@2.0.0", "node_modules"],
      ["no-deps"],
      ["no-deps"],
    ]);
  });
  test("some workspaces don't have node_modules", async () => {
    const { packageDir, env } = await registry.createTestDir({
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

    await install(env, packageDir);
    expect(
      await Promise.all([
        readdirSorted(join(packageDir, "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg1", "node_modules")),
        readdirSorted(join(packageDir, "packages", "pkg2", "node_modules")),
      ]),
    ).toEqual([[".bun", expect.stringContaining(".old_modules-"), "no-deps"], ["no-deps"], ["a-dep"]]);

    // another install will not reset the node_modules

    const entries = await readdirSorted(join(packageDir, "node_modules"));

    for (const entry of entries) {
      if (entry.startsWith(".old_modules-")) {
        await rm(join(packageDir, "node_modules", entry), { recursive: true, force: true });
      }
    }
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "no-deps"]);

    // add things to workspace node_modules. these will go undetected
    await Promise.all([
      write(join(packageDir, "packages", "pkg1", "node_modules", "oops1"), "HI1"),
      write(join(packageDir, "packages", "pkg2", "node_modules", "oops2"), "HI2"),
    ]);

    await install(env, packageDir, { stderr: [] });

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
});

describe.concurrent("--linker flag", () => {
  // The layout `no-deps@1.0.0` gets from each linker. The linker is not part
  // of bun.lock, so only the first install of a case saves it.
  async function expectLinker(packageDir: string, linker: "isolated" | "hoisted") {
    const noDeps = join(packageDir, "node_modules", "no-deps");
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual(
      linker === "isolated" ? [".bun", "no-deps"] : ["no-deps"],
    );
    expect(lstatSync(noDeps).isSymbolicLink()).toBe(linker === "isolated");
    expect(await file(join(noDeps, "package.json")).json()).toEqual({ name: "no-deps", version: "1.0.0" });
  }

  test("can override linker from bunfig", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await install(env, packageDir);
    await expectLinker(packageDir, "isolated");

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    await install(env, packageDir, { args: ["--linker", "hoisted"], stderr: [] });
    await expectLinker(packageDir, "hoisted");

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    await install(env, packageDir, { args: ["--linker", "isolated"], stderr: [] });
    await expectLinker(packageDir, "isolated");
  });

  test("works as the only config option", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir();

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-linker",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await install(env, packageDir, { args: ["--linker", "isolated"] });
    await expectLinker(packageDir, "isolated");

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    await install(env, packageDir, { args: ["--linker", "hoisted"], stderr: [] });
    await expectLinker(packageDir, "hoisted");

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    // without the flag, the bunfig the harness wrote (`linker = "hoisted"`) applies
    await install(env, packageDir, { stderr: [] });
    await expectLinker(packageDir, "hoisted");

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    await install(env, packageDir, { args: ["--linker", "isolated"], stderr: [] });
    await expectLinker(packageDir, "isolated");
  });
});
test.concurrent("many transitive dependencies", async () => {
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  await runBunInstall(env, packageDir);

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
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "test-pkg-dependency-names",
      dependencies: {
        "alias-loop-1": "1.0.0",
      },
    }),
  );

  await runBunInstall(env, packageDir);

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
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  await runBunInstall(env, packageDir);

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

test.concurrent("successfully removes and corrects symlinks", async () => {
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
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

  await runBunInstall(env, packageDir);

  expect(existsSync(join(packageDir, "node_modules", "no-deps"))).toBeTrue();

  expect(readlinkSync(join(packageDir, "node_modules", "no-deps"))).toBe(
    join(".bun", "no-deps@1.0.0", "node_modules", "no-deps"),
  );
});

test.concurrent("runs lifecycle scripts correctly", async () => {
  // due to binary linking between preinstall and the remaining lifecycle scripts
  // there is special handling for preinstall scripts we should test.
  // 1. only preinstall
  // 2. only postinstall (or any other script that isn't preinstall)
  // 3. preinstall and any other script

  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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

  await runBunInstall(env, packageDir);

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

// Self-contained HTTP server that serves package manifests & tarballs
// directly from the Verdaccio fixtures, with Cache-Control: max-age=300
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

  // root's no-deps@1.0.0 is what the transitive peer ends up bound to
  const env = installEnv(String(packageDir));
  const expectedStderr = ['warn: incorrect peer dependency "no-deps@1.0.0"', "Saved lockfile"];

  // First install: populates manifest cache (with max-age=300 from server)
  await install(env, String(packageDir), { stderr: expectedStderr });

  // Second install with NO lockfile and WARM cache. Manifests are fresh
  // (within max-age) so all loads are synchronous — this is the bug trigger.
  await rm(join(String(packageDir), "node_modules"), { recursive: true, force: true });
  await rm(join(String(packageDir), "bun.lock"), { force: true });
  await install(env, String(packageDir), { stderr: expectedStderr });

  const bunDir = join(String(packageDir), "node_modules", ".bun");
  // `+7347ae2d86f1441a` hashes the peer set `no-deps@1.0.0`, `+2ddcb6ca48941e07`
  // the peer set `strict-peer-dep@1.0.0`.
  const strictPeerEntry = "strict-peer-dep@1.0.0+7347ae2d86f1441a";
  const usesStrictEntry = "uses-strict-peer@1.0.0+2ddcb6ca48941e07";
  // strict-peer-dep is auto-installed via uses-strict-peer's peer
  expect(await readdirSorted(bunDir)).toEqual(["no-deps@1.0.0", "node_modules", strictPeerEntry, usesStrictEntry]);

  // strict-peer-dep's own peer `no-deps` must be resolved and symlinked.
  // Without the fix: this symlink is missing because the transitive peer
  // queue was never drained after drainDependencyList re-queued it.
  expect(await readdirSorted(join(bunDir, strictPeerEntry, "node_modules"))).toEqual(["no-deps", "strict-peer-dep"]);
  expect(await file(join(bunDir, strictPeerEntry, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  });

  // Verify the chain is intact
  expect(withoutEntryHash(readlinkSync(join(bunDir, usesStrictEntry, "node_modules", "strict-peer-dep")))).toBe(
    join("..", "..", strictPeerEntry, "node_modules", "strict-peer-dep"),
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
  // The two projects share one cache, and only with each other: `env` pins
  // it to `<root>/.bun-cache`, the directory the bunfigs name.
  const env = installEnv(String(root));
  const cacheDir = join(String(root), ".bun-cache").replaceAll("\\", "\\\\");
  const bunfig = (port: number) =>
    `[install]\ncache = "${cacheDir}"\nregistry = "http://localhost:${port}/"\nlinker = "isolated"\n`;
  await write(join(String(root), "warmup", "bunfig.toml"), bunfig(serverA.port));
  await write(join(String(root), "cold", "bunfig.toml"), bunfig(serverB.port));

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
  using cacheDir = tempDir("tarball-query-cache-", {});
  using packageDir = tempDir("tarball-query-test-", {
    "bunfig.toml": `[install]\ncache = "${String(cacheDir).replaceAll("\\", "\\\\")}"\nlinker = "isolated"\n`,
    "package.json": JSON.stringify({
      name: "test-tarball-query",
      dependencies: {
        "no-deps": url,
      },
    }),
    "index.mjs": `import pkg from "no-deps";\nconsole.log(pkg.version);`,
  });

  await runBunInstall({ ...bunEnv, BUN_INSTALL_CACHE_DIR: String(cacheDir) }, String(packageDir));

  const bunDir = join(String(packageDir), "node_modules", ".bun");
  const storeEntries = (await readdirSorted(bunDir)).filter(entry => entry !== "node_modules");
  expect(storeEntries).toEqual([`no-deps@http+++localhost+${server.port}+pkg.tgz+${urlHash(url)}`]);

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

    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

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
    await runBunInstall(env, packageDir, { savesLockfile: false });
    expect(await storeEntries(packageDir)).toEqual(expectedEntries);
  });

  test("the peer hash is appended after the cut resolution", async () => {
    const folder = Buffer.alloc(MAX_RESOLUTION_LEN, "p").toString();
    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

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
    // byte 62. Only the shape is asserted: how non-ASCII bytes are spelled in
    // the name is a separate matter (#32304), the boundary handling is not.
    const folder = `x${Buffer.alloc(40 * 2, "\u00e9").toString()}`;
    const { packageJson, packageDir, env } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
      files: { [`${folder}/package.json`]: JSON.stringify({ name: "non-ascii", version: "1.0.0" }) },
    });
    await write(
      packageJson,
      JSON.stringify({ name: "test-non-ascii-store-entry-name", dependencies: { "non-ascii": `file:./${folder}` } }),
    );

    await runBunInstall(env, packageDir);

    const entries = await storeEntries(packageDir);
    expect(entries).toEqual([expect.stringMatching(/^non-ascii@file\+x.*\+[0-9a-f]{16}$/)]);
    const [entry] = entries;
    const cutResolution = entry.slice("non-ascii@".length, -"+0123456789abcdef".length);
    expect(Buffer.byteLength(cutResolution)).toBe(CUT_RESOLUTION_LEN - 1);
    expect(readlinkSync(join(packageDir, "node_modules", "non-ascii"))).toBe(
      join(".bun", entry, "node_modules", "non-ascii"),
    );
    expect(await file(join(packageDir, "node_modules", "non-ascii", "package.json")).json()).toEqual({
      name: "non-ascii",
      version: "1.0.0",
    });
  });

  test("a local tarball and a folder in a deep directory install when their paths are longer than NAME_MAX", async () => {
    // Every directory on the way is short; only the resolution, which is the
    // whole relative path (257 bytes here), would make the entry name longer
    // than NAME_MAX. Unbounded, the install fails with ENAMETOOLONG.
    const segment = Buffer.alloc(85, "d").toString();
    const deep = `${segment}/${segment}/${segment}`;
    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

    const tarballEntry = storeEntryName("bar", `.+${deep.replaceAll("/", "+")}+bar-0.0.2.tgz`);
    const folderEntry = storeEntryName("folder-pkg", `file+${deep.replaceAll("/", "+")}+pkg`);
    expect(tarballEntry).toMatch(/^bar@\.\+d{61}\+[0-9a-f]{16}$/);
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

    await runBunInstall(env, packageDir, { savesLockfile: false });
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

    const { packageJson, packageDir, env } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated", globalStore: true },
      files: { "index.mjs": `import pkg from "no-deps";\nconsole.log(pkg.version);` },
    });
    await write(packageJson, JSON.stringify({ name: "test-long-tarball-url", dependencies: { "no-deps": url } }));

    await runBunInstall(env, packageDir);

    const entry = storeEntryName("no-deps", url.replaceAll(/[/:]/g, "+"));
    expect(entry).toMatch(/^no-deps@http\+\+\+localhost\+\d+\+t+\+[0-9a-f]{16}$/);
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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
    const repoDir = join(packageDir, Buffer.alloc(60, "r").toString());
    const gitEnv = {
      ...env,
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

    await runBunInstall(gitEnv, packageDir);

    const entry = storeEntryName("git-dep", `git+${repoUrl.replaceAll(/[/:]/g, "+")}+${sha}`);
    expect(entry).toMatch(/^git-dep@git\+file\+\+\+\+.*\+[0-9a-f]{16}$/);
    expect(await storeEntries(packageDir)).toEqual([entry]);
    expect(await file(join(packageDir, "node_modules", "git-dep", "postinstall-ran.txt")).text()).toBe("ran");
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
    const url = urlFor(server.port);
    using dir = tempDir("store-name-tarball-", {
      "bunfig.toml": `[install]\nlinker = "isolated"\n`,
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": url } }),
      "index.mjs": `import pkg from "no-deps";\nconsole.log(pkg.version);`,
    });
    const env = installEnv(String(dir));

    await runBunInstall(env, String(dir));

    const entry = `no-deps@http+++127.0.0.1+${server.port}+cdn+pkg.tgz${hashed ? `+${urlHash(url)}` : ""}`;
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
        .map(url => `no-deps@http+++127.0.0.1+${server.port}+cdn+pkg.tgz+${urlHash(url)}`)
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

    const entry = `no-deps@http+++127.0.0.1+${server.port}+cdn+pkg.tgz+${urlHash(url)}`;
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
      const repo = repoFor(server.port);
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

  test("is disabled by default", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-default-off",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);

    // With the global store disabled (the default) the entry is a real
    // directory under `node_modules/.bun/` (the pre-global-store layout).
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(await file(join(entry, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("can be enabled via BUN_INSTALL_GLOBAL_STORE=1", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-on-env",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...env, BUN_INSTALL_GLOBAL_STORE: "1" }, packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);
  });

  test("can be enabled via bunfig install.globalStore", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-on-bunfig",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);

    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(entry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);
  });

  test("survives node_modules wipe", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    // First install: populates `<cache>/links/` and creates project symlinks.
    await runBunInstall(env, packageDir);

    // `node_modules/.bun/<storepath>` is a symlink (to the global virtual store),
    // not a real directory containing a clonefiled copy of the package.
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const target = readlinkSync(entry);
    expect(target).toMatch(/links[\/\\]two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(await file(join(target, "node_modules", "two-range-deps", "package.json")).json()).toMatchObject({
      name: "two-range-deps",
      version: "1.0.0",
    });
    // dep symlink inside the global entry points at a sibling global entry
    expect(readlinkSync(join(target, "node_modules", "no-deps"))).toMatch(
      /^\.\.[\/\\]\.\.[\/\\]no-deps@1\.1\.0-[0-9a-f]{16}[\/\\]node_modules[\/\\]no-deps$/,
    );

    // Second install after wiping node_modules: the global entry persists, so
    // the project entry is re-created as a symlink to the *same* global path
    // without re-materialising package files.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(env, packageDir, { savesLockfile: false });

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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-force-heal",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);

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
    await runBunInstall(env, packageDir, { savesLockfile: false });
    expect(existsSync(pkgJsonPath)).toBe(false);

    // --force must rebuild staging and swap it into place over the corrupt
    // final directory instead of discarding the fresh tree on EEXIST.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await install(env, packageDir, { args: ["--force"], stderr: [] });

    expect(readlinkSync(entry)).toBe(gvsTarget);
    expect(await file(pkgJsonPath).text()).toBe(original);
    expect(existsSync(indexPath)).toBe(true);

    // The swap-aside `.old-<rand>` tree is removed once publish succeeds, so
    // the links/ directory is left with only final entries (no `.old-` and no
    // `.tmp-` siblings).
    expect(await readdirSorted(dirname(gvsTarget))).toEqual([basename(gvsTarget)]);
  });

  test("BUN_INSTALL_GLOBAL_STORE=0 overrides bunfig globalStore = true", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-off-env",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...env, BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir);

    // With the global store disabled the entry is a real directory under
    // `node_modules/.bun/` (the pre-global-store layout).
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(await file(join(entry, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("entry hash is deterministic across fresh installs", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-determinism",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);
    const target1 = readlinkSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"));

    // Full reset (lockfile + node_modules + global links). The hash is derived
    // from the resolved dependency closure, so a fresh resolve must reproduce
    // it exactly — otherwise warm-hit reuse across machines/CI is broken.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lock"), { force: true });
    const linksDir = target1.slice(0, target1.lastIndexOf("links") + "links".length);
    await rm(linksDir, { recursive: true, force: true });

    await runBunInstall(env, packageDir);
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

    await runBunInstall(a.env, a.packageDir);
    await runBunInstall(b.env, b.packageDir);

    const targetA = entryStoreName(readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    const targetB = entryStoreName(readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    expect(targetA).not.toBe(targetB);

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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-reresolve",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);

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

    await runBunInstall(env, packageDir);

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

    await runBunInstall(a.env, a.packageDir);
    await runBunInstall(b.env, b.packageDir);

    const targetA = entryStoreName(readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    const targetB = entryStoreName(readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")));
    expect(targetA).toMatch(/^two-range-deps@1\.0\.0-[0-9a-f]{16}$/);
    expect(targetA).toBe(targetB);
  });

  test("workspace dependency makes the parent entry project-local", async () => {
    // Dep symlinks inside a global entry are sibling-relative within
    // `<cache>/links/`. If one of those siblings were a workspace package
    // (which lives under the project, not the cache) the link would be
    // dangling for any other project that shared the entry. The eligibility
    // check propagates: an entry that links to anything project-local is
    // itself project-local.
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

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

    await runBunInstall(env, packageDir);

    // `no-deps` has no project-local deps so it stays global.
    const noDepsEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(noDepsEntry)).toMatch(/links[\/\\]no-deps@1\.0\.0-[0-9a-f]{16}$/);

    // The workspace itself is always project-local (its source lives in the
    // project tree).
    expect(readlinkSync(join(packageDir, "node_modules", "ws-pkg"))).toBe(join("..", "packages", "ws-pkg"));
  });

  test("packages with trusted lifecycle scripts stay project-local", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-scripts",
        dependencies: { "lifecycle-postinstall": "1.0.0", "no-deps": "1.0.0" },
        trustedDependencies: ["lifecycle-postinstall"],
      }),
    );

    await runBunInstall(env, packageDir);

    // The script may mutate the install dir, so the entry must not be shared.
    const scriptEntry = join(packageDir, "node_modules", ".bun", "lifecycle-postinstall@1.0.0");
    expect(lstatSync(scriptEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(scriptEntry).isDirectory()).toBe(true);

    // A neighbouring scriptless package is unaffected and stays global.
    const noDepsEntry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);

    // `meta.hasInstallScript` isn't serialised in `bun.lock`, so a warm
    // install must reach the same conclusion from the trustedDependencies
    // list alone — the cold install above isn't sufficient on its own.
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(env, packageDir, { savesLockfile: false });
    expect(lstatSync(scriptEntry).isSymbolicLink()).toBe(false);
    expect(lstatSync(scriptEntry).isDirectory()).toBe(true);
    expect(lstatSync(noDepsEntry).isSymbolicLink()).toBe(true);
  });

  test("concurrent installs into a cold global store both succeed", async () => {
    // Two `bun install` processes may race to create the same content-addressed
    // global entry; the loser sees EEXIST from clonefile/symlink/bin-link and
    // must treat it as success rather than failing the install.
    const a = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });
    const b = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    // Both projects must share one cache for the race to be real; the harness
    // gives each test dir its own `.bun-cache/` by default. Both also install
    // with `a.env`, which pins that cache.
    const sharedCache = join(a.packageDir, ".bun-cache");
    await write(
      join(b.packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: sharedCache,
          registry: registry.registryUrl(),
          linker: "isolated",
          globalStore: true,
        },
      }),
    );

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
    await runBunInstall(a.env, a.packageDir);
    const linksDir = join(sharedCache, "links");

    for (let i = 0; i < 3; i++) {
      await rm(linksDir, { recursive: true, force: true });
      await rm(join(a.packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(b.packageDir, "node_modules"), { recursive: true, force: true });

      // The loser of the race must not report it. `b` has no bun.lock before
      // its first install.
      await Promise.all([
        install(a.env, a.packageDir, { stderr: [] }),
        install(a.env, b.packageDir, { stderr: i === 0 ? ["Saved lockfile"] : [] }),
      ]);
    }

    // Both projects' `.bun/<X>` symlinks point at the same physical directory
    // in the shared cache.
    expect(readlinkSync(join(a.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0"))).toBe(
      readlinkSync(join(b.packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")),
    );
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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-staging",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);
    const target = readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"));
    expect(await file(join(target, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
    // No stamp file: the directory existing *is* the completeness signal.
    expect(existsSync(join(target, ".bun-ok"))).toBe(false);

    // Fake a leftover staging sibling and re-install — the published entry
    // should warm-hit unchanged.
    await mkdir(`${target}.tmp-deadbeef`, { recursive: true });
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(env, packageDir, { savesLockfile: false });

    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "no-deps@1.0.0"))).toBe(target);
    expect(await file(join(target, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

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

    await runBunInstall(env, packageDir);
    // The entry must actually be a global-store symlink for this test to mean
    // anything (guards against a future default flip silently neutering it).
    expect(lstatSync(join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0")).isSymbolicLink()).toBe(true);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "index.js"],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).toBe("");
    expect(JSON.parse(out.trim())).toEqual({ direct: "two-range-deps", transitive: "no-deps" });
    expect(code).toBe(0);
  });

  test("an entry that loses global-store eligibility detaches without mutating the shared entry", async () => {
    // Regression: a previously-GVS entry that becomes project-local on the
    // next install (newly patched, newly trusted, …) used to write its new
    // tree *through* the stale `node_modules/.bun/<storepath>` symlink into
    // the shared cache. On Windows the `.expect_missing` dep-symlink rewrite
    // then baked a project-absolute junction target into the shared entry,
    // which dangled after `rm -rf node_modules`.
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-gvs-to-local",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);
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
    await runBunInstall(env, packageDir, { savesLockfile: false });

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
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-upgrade",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall({ ...env, BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "no-deps@1.0.0");
    expect(lstatSync(entry).isDirectory()).toBe(true);
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);

    await runBunInstall(env, packageDir, { savesLockfile: false });
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(await file(join(entry, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("disabling the global store detaches entries on the next install", async () => {
    // The reverse of the upgrade test above: a project installed with the
    // global store enabled has `node_modules/.bun/<X>` symlinks into
    // `<cache>/links/`. Re-running install with the store disabled must
    // replace those links with real project-local directories — the
    // warm-path existence check passes *through* a live link, so without
    // stale-link detection the project would silently keep running against
    // (and a later rebuild would write into) the shared store.
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-global-store-disable",
        dependencies: { "two-range-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);
    const entry = join(packageDir, "node_modules", ".bun", "two-range-deps@1.0.0");
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    const globalTarget = readlinkSync(entry);

    await runBunInstall({ ...env, BUN_INSTALL_GLOBAL_STORE: "0" }, packageDir, { savesLockfile: false });

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
    expect(await file(join(globalTarget, "node_modules", "two-range-deps", "package.json")).json()).toMatchObject({
      name: "two-range-deps",
      version: "1.0.0",
    });
  });

  test("preserves bun patch workspace when install runs before --commit", async () => {
    // Regression: `bun patch <pkg>` detaches the project store entry from the
    // global virtual store (symlink → real directory) so the user can edit it.
    // A subsequent `bun install` (e.g. to add another dep) before `--commit`
    // must not see that real directory as a stale pre-GVS layout and
    // `deleteTree` the user's in-progress edits.
    const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: gvsBunfigOpts });

    await write(
      packageJson,
      JSON.stringify({
        name: "test-pkg-patch-preserve",
        dependencies: { "no-deps": "1.0.0" },
      }),
    );

    await runBunInstall(env, packageDir);
    const workspace = join(packageDir, "node_modules", "no-deps");
    expect(lstatSync(workspace).isSymbolicLink()).toBe(true);

    await using proc = spawn({
      cmd: [bunExe(), "patch", "no-deps"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // (the folder is printed with forward slashes on every platform)
    expect(stdout).toEndWith(
      [
        "To patch no-deps, edit the following folder:",
        "",
        "  node_modules/no-deps",
        "",
        "Once you're done with your changes, run:",
        "",
        "  bun patch --commit 'node_modules/no-deps'",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);

    // `bun patch` detached the top-level dep symlink into a real directory
    // for the user to edit. The `.bun/<storepath>` GVS symlink is untouched.
    expect(lstatSync(workspace).isSymbolicLink()).toBe(false);
    expect(lstatSync(workspace).isDirectory()).toBe(true);

    const edited = join(workspace, "index.js");
    await write(edited, "module.exports = 'USER_EDITS';\n");

    await runBunInstall(env, packageDir, { savesLockfile: false });

    // The real-directory workspace is preserved across the install; before
    // this fix `.expect_existing` would `deleteTree` it on readlink EINVAL
    // and re-symlink, wiping the edits.
    expect(lstatSync(workspace).isSymbolicLink()).toBe(false);
    expect(await file(edited).text()).toBe("module.exports = 'USER_EDITS';\n");
  });
});

test.concurrent("rejects dependency aliases that traverse outside node_modules", async () => {
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  // A (transitively) malicious package.json can use an arbitrary string as a
  // dependency alias. The alias becomes a `node_modules/<alias>` path
  // component in the isolated store layout, so a `..` segment lets it plant
  // symlinks outside of node_modules.
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
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderrLines(stderr)).toEqual(['error: "../pwned-by-alias" is not a valid install folder name']);
  expect(normalizeBunSnapshot(stdout)).toBe("bun install <version> (<revision>)");
  // Nothing may be created outside of node_modules. `lstatSync` instead of
  // `existsSync` because the escaped artifact would be a dangling symlink.
  expect(() => lstatSync(join(packageDir, "pwned-by-alias"))).toThrow();
  expect(exitCode).toBe(1);
});

test.concurrent("rejects a dependency alias with more than one path component", async () => {
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

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
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderrLines(stderr)).toEqual(['error: "somepkg/lib" is not a valid install folder name']);
  expect(normalizeBunSnapshot(stdout)).toBe("bun install <version> (<revision>)");
  expect(() => lstatSync(join(packageDir, "node_modules", "somepkg", "lib"))).toThrow();
  expect(exitCode).toBe(1);
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe(`error: Invalid value for --linker: "isoalted". Must be 'isolated' or 'hoisted'.\n`);
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});

test.concurrent("store build timings are printed by --verbose only", async () => {
  const { packageJson, packageDir, env } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(
    packageJson,
    JSON.stringify({
      name: "store-timings",
      dependencies: {
        "no-deps": "1.0.0",
      },
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install", "--verbose"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, verbose, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(verbose).not.toContain("error:");
  expect(verbose).toMatch(/^Resolved peers \[\S+\]$/m);
  expect(verbose).toMatch(/^Created store \[\S+\]$/m);
  expect(exitCode).toBe(0);

  // without --verbose, the rebuild of the store prints nothing at all
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  await install(env, packageDir, { stderr: [] });
});

describe.concurrent("hoist", () => {
  // `node_modules/.bun/node_modules` holds a symlink to every installed
  // package and sits on the upward resolution path of every store entry, so
  // by default a store package can resolve dependencies it never declared.
  // `install.hoist = false` (pnpm's `hoist=false`) skips that fallback
  // directory without touching the rest of the layout.
  test("hoist = false skips the hidden fallback directory", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

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
    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

    // the transitive @types/is-number is still publicly hoisted to the root
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bun", "@types", "two-range-deps"]);
    expect(readlinkSync(join(packageDir, "node_modules", "@types", "is-number"))).toBe(
      join("..", ".bun", "@types+is-number@2.0.0", "node_modules", "@types", "is-number"),
    );
    // while the hidden fallback is not created
    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();
  });

  test("hoist = false removes a stale fallback directory from a previous install", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

    // hoisting is on by default: transitive deps resolve through the fallback
    expect(readlinkSync(join(packageDir, "node_modules", ".bun", "node_modules", "no-deps"))).toBe(
      join("..", "no-deps@1.1.0", "node_modules", "no-deps"),
    );

    await registry.writeBunfig(packageDir, { linker: "isolated", hoist: false });
    await runBunInstall(env, packageDir, { savesLockfile: false });

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

  test("hoist = false takes precedence over hoistPattern", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();
  });

  test("npmrc hoist=false", async () => {
    const { packageJson, packageDir, env } = await registry.createTestDir({
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

    await runBunInstall(env, packageDir);

    expect(existsSync(join(packageDir, "node_modules", ".bun", "node_modules"))).toBeFalse();
    expect(readlinkSync(join(packageDir, "node_modules", "two-range-deps"))).toBe(
      join(".bun", "two-range-deps@1.0.0", "node_modules", "two-range-deps"),
    );
  });
});
