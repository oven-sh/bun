import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, readdirSorted, runBunInstall } from "harness";
import { join } from "path";

// `packageExtensions` lets the root project add dependencies / peerDependencies
// that a third-party package forgot to declare. These tests use registry
// fixtures that declare nothing themselves (`a-dep`, `no-deps`, `peer-no-deps`)
// and graft edges onto them from the root package.json / bunfig.toml.

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

/** bun.lock is JSONC with trailing commas; good enough for these fixtures. */
async function readLockfile(dir: string): Promise<any> {
  const text = await file(join(dir, "bun.lock")).text();
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}

/** The info object (`{ dependencies, peerDependencies, optionalPeers, ... }`) bun.lock records for `name`. */
async function lockfileEntry(dir: string, name: string): Promise<Record<string, any>> {
  const lock = await readLockfile(dir);
  const entry = lock.packages[name];
  expect(entry).toBeArray();
  return entry[2];
}

async function installedVersion(dir: string, linker: "hoisted" | "isolated", name: string, version: string) {
  const pkgJson =
    linker === "hoisted"
      ? join(dir, "node_modules", name, "package.json")
      : join(dir, "node_modules", ".bun", `${name}@${version}`, "node_modules", name, "package.json");
  return (await file(pkgJson).json()).version;
}

function isInstalled(dir: string, linker: "hoisted" | "isolated", name: string, version: string) {
  return linker === "hoisted"
    ? existsSync(join(dir, "node_modules", name))
    : existsSync(join(dir, "node_modules", ".bun", `${name}@${version}`));
}

function bunfigWithExtensions(linker: "hoisted" | "isolated", dir: string, extra: string) {
  return `[install]
cache = "${join(dir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${registry.registryUrl()}"
linker = "${linker}"
${extra}
`;
}

describe.each(["hoisted", "isolated"] as const)("packageExtensions (%s linker)", linker => {
  test("adds a missing dependency, records it in bun.lock, and is stable under --frozen-lockfile", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
    await write(
      packageJson,
      JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "a-dep": "1.0.5" },
        packageExtensions: {
          "a-dep": { dependencies: { "no-deps": "^1.0.0" } },
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    // `no-deps` is only reachable through the extension
    expect(await installedVersion(packageDir, linker, "no-deps", "1.1.0")).toBe("1.1.0");
    if (linker === "isolated") {
      // and it is linked as a dependency of a-dep, not just present in the store
      expect(existsSync(join(packageDir, "node_modules", ".bun", "a-dep@1.0.5", "node_modules", "no-deps"))).toBeTrue();
    }
    expect(await lockfileEntry(packageDir, "a-dep")).toEqual({ dependencies: { "no-deps": "^1.0.0" } });

    // a second install has nothing to do
    const second = await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
    expect(second.err).not.toContain("Saved lockfile");

    // reinstalling from the lockfile alone reproduces the injected edge
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
    expect(await installedVersion(packageDir, linker, "no-deps", "1.1.0")).toBe("1.1.0");
  });

  test("name@range keys only apply to matching versions", async () => {
    const extensions = {
      "no-deps@^2": { dependencies: { "a-dep": "1.0.1" } },
    };
    // no-deps@1.0.0 does not match ^2
    {
      const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
      await write(
        packageJson,
        JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.0" }, packageExtensions: extensions }),
      );
      await runBunInstall(bunEnv, packageDir);
      expect(isInstalled(packageDir, linker, "a-dep", "1.0.1")).toBeFalse();
      expect(await lockfileEntry(packageDir, "no-deps")).toEqual({});
    }
    // no-deps@2.0.0 does
    {
      const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
      await write(
        packageJson,
        JSON.stringify({ name: "app", dependencies: { "no-deps": "2.0.0" }, packageExtensions: extensions }),
      );
      await runBunInstall(bunEnv, packageDir);
      expect(await installedVersion(packageDir, linker, "a-dep", "1.0.1")).toBe("1.0.1");
      expect(await lockfileEntry(packageDir, "no-deps")).toEqual({ dependencies: { "a-dep": "1.0.1" } });
    }
  });

  test("peerDependencies and peerDependenciesMeta.optional", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
    await write(
      packageJson,
      JSON.stringify({
        name: "app",
        dependencies: { "a-dep": "1.0.3", "peer-no-deps": "1.0.1" },
        packageExtensions: {
          "a-dep@1": {
            peerDependencies: { "peer-no-deps": "^1.0.0", "left-pad": "*" },
            peerDependenciesMeta: { "left-pad": { optional: true } },
          },
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    expect(await lockfileEntry(packageDir, "a-dep")).toEqual({
      peerDependencies: { "peer-no-deps": "^1.0.0", "left-pad": "*" },
      optionalPeers: ["left-pad"],
    });
    // the required peer resolves to what the root provides; the optional peer
    // that nobody provides is not installed
    const lock = await readLockfile(packageDir);
    expect(lock.packages["peer-no-deps"][0]).toBe("peer-no-deps@1.0.1");
    expect(lock.packages["left-pad"]).toBeUndefined();
    if (linker === "isolated") {
      const storeEntries = (await readdirSorted(join(packageDir, "node_modules", ".bun"))).filter(entry =>
        entry.startsWith("a-dep@1.0.3"),
      );
      expect(storeEntries).toHaveLength(1);
      expect(
        existsSync(join(packageDir, "node_modules", ".bun", storeEntries[0], "node_modules", "peer-no-deps")),
      ).toBeTrue();
      expect(
        existsSync(join(packageDir, "node_modules", ".bun", storeEntries[0], "node_modules", "left-pad")),
      ).toBeFalse();
    } else {
      expect(existsSync(join(packageDir, "node_modules", "left-pad"))).toBeFalse();
    }
  });

  test("does not override a dependency the package already declares", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
    await write(
      packageJson,
      JSON.stringify({
        name: "app",
        // one-fixed-dep@1.0.0 declares `"no-deps": "1.0.0"` itself
        dependencies: { "one-fixed-dep": "1.0.0" },
        packageExtensions: {
          "one-fixed-dep": { dependencies: { "no-deps": "2.0.0", "a-dep": "1.0.2" } },
        },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    expect(await lockfileEntry(packageDir, "one-fixed-dep")).toEqual({
      dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" },
    });
    expect(await installedVersion(packageDir, linker, "no-deps", "1.0.0")).toBe("1.0.0");
    expect((await readLockfile(packageDir)).packages["no-deps"][0]).toBe("no-deps@1.0.0");
    expect(await installedVersion(packageDir, linker, "a-dep", "1.0.2")).toBe("1.0.2");
  });

  test("an extension added after the first install is applied to the existing lockfile", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
    await write(packageJson, JSON.stringify({ name: "app", dependencies: { "a-dep": "1.0.4", "no-deps": "2.0.0" } }));
    await runBunInstall(bunEnv, packageDir);
    expect(await lockfileEntry(packageDir, "a-dep")).toEqual({});
    expect(isInstalled(packageDir, linker, "peer-no-deps", "2.0.0")).toBeFalse();

    await write(
      packageJson,
      JSON.stringify({
        name: "app",
        dependencies: { "a-dep": "1.0.4", "no-deps": "2.0.0" },
        packageExtensions: {
          "a-dep": {
            dependencies: { "peer-no-deps": "2.0.0" },
            peerDependencies: { "no-deps": "*" },
          },
        },
      }),
    );
    // the lockfile gains the new edges (and the new package) without re-resolving the rest
    await runBunInstall(bunEnv, packageDir);
    expect(await lockfileEntry(packageDir, "a-dep")).toEqual({
      dependencies: { "peer-no-deps": "2.0.0" },
      peerDependencies: { "no-deps": "*" },
    });
    expect(await installedVersion(packageDir, linker, "peer-no-deps", "2.0.0")).toBe("2.0.0");
    const lock = await readLockfile(packageDir);
    expect(lock.packages["a-dep"][0]).toBe("a-dep@1.0.4");
    expect(lock.packages["no-deps"][0]).toBe("no-deps@2.0.0");

    // and from here on the lockfile is stable
    await runBunInstall(bunEnv, packageDir, { frozenLockfile: true });
    const again = await runBunInstall(bunEnv, packageDir, { savesLockfile: false });
    expect(again.err).not.toContain("Saved lockfile");
  });

  test("bunfig.toml [install.packageExtensions] and package.json pnpm.packageExtensions", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
    await write(
      join(packageDir, "bunfig.toml"),
      bunfigWithExtensions(
        linker,
        packageDir,
        `
[install.packageExtensions.a-dep]
dependencies = { no-deps = "1.0.1" }

[install.packageExtensions."peer-no-deps@2"]
optionalDependencies = { left-pad = "1.0.0" }
`,
      ),
    );
    await write(
      packageJson,
      JSON.stringify({
        name: "app",
        dependencies: { "a-dep": "1.0.6", "peer-no-deps": "2.0.0" },
        // top-level and pnpm-namespaced entries are both read
        packageExtensions: { "a-dep": { optionalDependencies: { bar: "0.0.7" } } },
        pnpm: { packageExtensions: { "a-dep@*": { peerDependencies: { "peer-no-deps": "*" } } } },
      }),
    );

    await runBunInstall(bunEnv, packageDir);
    expect(await lockfileEntry(packageDir, "a-dep")).toEqual({
      dependencies: { "no-deps": "1.0.1" },
      optionalDependencies: { bar: "0.0.7" },
      peerDependencies: { "peer-no-deps": "*" },
    });
    expect(await lockfileEntry(packageDir, "peer-no-deps")).toEqual({
      optionalDependencies: { "left-pad": "1.0.0" },
    });
    expect(await installedVersion(packageDir, linker, "no-deps", "1.0.1")).toBe("1.0.1");
    expect(await installedVersion(packageDir, linker, "left-pad", "1.0.0")).toBe("1.0.0");
  });
});

test("malformed package.json packageExtensions entries warn and are skipped", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await write(
    packageJson,
    JSON.stringify({
      name: "app",
      dependencies: { "a-dep": "1.0.7" },
      packageExtensions: {
        "a-dep": { dependencies: { "no-deps": 1 } },
        "no-deps": "not an object",
        "a-dep@not a range": { dependencies: { "no-deps": "1.0.0" } },
        "a-dep@": { dependencies: { "no-deps": "1.0.1" } },
      },
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain("warn: Expected a version range string");
  expect(err).toContain("warn: Expected an object with");
  expect(err.match(/warn: Expected a semver range after "@" in the package name/g)).toHaveLength(2);
  expect(err).not.toContain("error:");
  // only a-dep itself: every extension entry was rejected
  expect(out).toContain("+ a-dep@1.0.7");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
  expect(await lockfileEntry(packageDir, "a-dep")).toEqual({});
});

test("the same name in several groups follows package.json rules", async () => {
  // optionalDependencies overrides dependencies; a peerDependencies entry for a
  // name that is already a (optional) dependency is ignored, optional or not.
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await write(
    packageJson,
    JSON.stringify({
      name: "app",
      dependencies: { "a-dep": "1.0.9" },
      packageExtensions: {
        "a-dep": {
          dependencies: { "no-deps": "1.0.0", "peer-no-deps": "1.0.0" },
          optionalDependencies: { "no-deps": "1.0.1" },
          peerDependencies: { "no-deps": "*", "peer-no-deps": "*" },
          peerDependenciesMeta: { "peer-no-deps": { optional: true } },
        },
      },
    }),
  );

  await runBunInstall(bunEnv, packageDir);
  expect(await lockfileEntry(packageDir, "a-dep")).toEqual({
    dependencies: { "peer-no-deps": "1.0.0" },
    optionalDependencies: { "no-deps": "1.0.1" },
  });
  expect(await installedVersion(packageDir, "hoisted", "no-deps", "1.0.1")).toBe("1.0.1");
  expect(await installedVersion(packageDir, "hoisted", "peer-no-deps", "1.0.0")).toBe("1.0.0");
});

test("malformed bunfig.toml packageExtensions is a config error", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await write(
    join(packageDir, "bunfig.toml"),
    bunfigWithExtensions("hoisted", packageDir, `packageExtensions = "nope"`),
  );
  await write(packageJson, JSON.stringify({ name: "app", dependencies: { "a-dep": "1.0.8" } }));

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain(`Expected "packageExtensions" to be an object`);
  expect(out).not.toContain("installed");
  expect(exitCode).not.toBe(0);
});
