// Who owns `node_modules/<name>` of the root, and the key `<name>` of "packages" in bun.lock, when a workspace has that
// name: the root's own dependency of that name if it is a registry range the workspace does not satisfy, else the
// workspace (also over a `file:` folder or a tag). An `npm:` alias installs under its alias, so it does not compete.
// Whatever the answer, the workspace stays installed, bun loads the lockfile it wrote, and `--frozen-lockfile` / `bun ci`
// accept it.
import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, mkdir, realpath, rename, rm } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Linker = "hoisted" | "isolated";
type PackageJson = Record<string, unknown>;
const linkers: Linker[] = ["hoisted", "isolated"];

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

async function ok(cwd: string, ...args: string[]) {
  const result = await bun(cwd, ...args);
  expect({ args, stderr: result.stderr, exitCode: result.exitCode }).toEqual({
    args,
    stderr: expect.not.stringMatching(/error:|Ignoring lockfile/),
    exitCode: 0,
  });
  return result;
}

const manifests = (tree: Record<string, PackageJson>) =>
  Object.fromEntries(
    Object.entries(tree).map(([dir, json]) => [join(dir, "package.json").replaceAll("\\", "/"), JSON.stringify(json)]),
  );

async function project(linker: Linker, tree: Record<string, PackageJson>, bunfig = "") {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files: manifests(tree) });
  if (bunfig)
    await write(join(packageDir, "bunfig.toml"), (await file(join(packageDir, "bunfig.toml")).text()) + bunfig);
  return packageDir;
}

const lockText = (dir: string) => file(join(dir, "bun.lock")).text();

// `key -> name@resolution` of "packages", and the keys of "workspaces".
async function resolved(dir: string) {
  const lock = Bun.JSONC.parse(await lockText(dir)) as {
    workspaces: Record<string, unknown>;
    packages: Record<string, [string, ...unknown[]]>;
  };
  return {
    workspaces: Object.keys(lock.workspaces),
    packages: Object.fromEntries(Object.entries(lock.packages).map(([key, [id]]) => [key, id])),
  };
}

// The root's and every workspace's.
const wipeNodeModules = async (dir: string) => {
  const members = await Array.fromAsync(new Bun.Glob("{packages,libs}/*/package.json").scan({ cwd: dir }));
  await Promise.all(
    ["", ...members.map(path => dirname(path))].map(path =>
      rm(join(dir, path, "node_modules"), { recursive: true, force: true }),
    ),
  );
};

// The real directory of the `name` that code in `from` loads. Not `Bun.resolveSync`: this process would remember what
// the directories held before the last install.
async function lookUp(from: string, name: string) {
  for (let dir = await realpath(from); ; dir = dirname(dir)) {
    const found = join(dir, "node_modules", name);
    if (await exists(join(found, "package.json"))) return await realpath(found);
    if (dir === dirname(dir)) throw new Error(`${name} does not resolve from ${from}`);
  }
}

// The version of `name` that code in `from` (a directory of the project) loads.
const seenFrom = async (dir: string, from: string, name: string) =>
  (await file(join(await lookUp(join(dir, from), name), "package.json")).json()).version;

// After the install that wrote bun.lock, a second one changes nothing, and frozen installs accept the file with the
// existing node_modules, with the root node_modules wiped, and with no node_modules at all.
async function expectRoundTrip(dir: string, check: () => Promise<void>) {
  const lock = await lockText(dir);
  await check();

  const second = await ok(dir, "install");
  expect(second.stderr).not.toContain("Saved lockfile");
  expect(second.stdout).toContain("(no changes)");
  expect(await lockText(dir)).toBe(lock);

  await ok(dir, "install", "--frozen-lockfile");
  await ok(dir, "ci");
  await rm(join(dir, "node_modules"), { recursive: true, force: true });
  await ok(dir, "install", "--frozen-lockfile");
  await check();
  await wipeNodeModules(dir);
  await ok(dir, "ci");
  await check();

  await ok(dir, "install", "--lockfile-only");
  expect(await lockText(dir)).toBe(lock);
}

const root = (extra: PackageJson): PackageJson => ({
  name: "sandbox",
  version: "1.0.0",
  workspaces: ["packages/*"],
  ...extra,
});

describe.each(linkers)("%s linker", linker => {
  // A monorepo that uses the published version of one of its own packages.
  describe("a root dependency on a registry version that the workspace of that name does not satisfy", () => {
    const beta = { name: "beta", version: "1.0.0", dependencies: { "no-deps": "workspace:*" } };

    test.concurrent("takes the name, and a dependent still gets the workspace", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "1.0.0" } }),
        "packages/no-deps": { name: "no-deps", version: "3.0.0" },
        "packages/beta": beta,
      });
      await ok(dir, "install");

      expect(await resolved(dir)).toEqual({
        workspaces: ["", "packages/beta", "packages/no-deps"],
        packages: {
          "beta": "beta@workspace:packages/beta",
          "no-deps": "no-deps@1.0.0",
          "beta/no-deps": "no-deps@workspace:packages/no-deps",
        },
      });
      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, ".", "no-deps")).toBe("1.0.0");
        expect(await seenFrom(dir, "packages/beta", "no-deps")).toBe("3.0.0");
      });
    });

    test.concurrent("also with linkWorkspacePackages = false and a version the range accepts", async () => {
      const dir = await project(
        linker,
        {
          "": root({ dependencies: { "no-deps": "1.0.0" } }),
          "packages/no-deps": { name: "no-deps", version: "1.0.0", private: true },
          "packages/beta": beta,
        },
        "linkWorkspacePackages = false\n",
      );
      await ok(dir, "install");

      expect((await resolved(dir)).packages).toEqual({
        "beta": "beta@workspace:packages/beta",
        "no-deps": "no-deps@1.0.0",
        "beta/no-deps": "no-deps@workspace:packages/no-deps",
      });
      await expectRoundTrip(dir, async () => {
        expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).not.toContainKey("private");
      });
    });

    // The workspace's own dependencies are printed below the key the workspace is printed at.
    test.concurrent("the workspace's own dependency that can't be hoisted keeps its version", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" } }),
        "packages/no-deps": { name: "no-deps", version: "3.0.0", dependencies: { "a-dep": "1.0.1" } },
        "packages/beta": beta,
      });
      await ok(dir, "install");

      expect((await resolved(dir)).packages).toMatchObject({
        "a-dep": "a-dep@1.0.2",
        "beta/no-deps/a-dep": "a-dep@1.0.1",
      });
      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, ".", "a-dep")).toBe("1.0.2");
        expect(await seenFrom(dir, "packages/no-deps", "a-dep")).toBe("1.0.1");
      });
    });

    test.concurrent("the workspace's own dependency that hoists to its dependent binds there", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" } }),
        "packages/no-deps": { name: "no-deps", version: "3.0.0", dependencies: { "a-dep": "1.0.1" } },
        "packages/beta": { ...beta, dependencies: { "no-deps": "workspace:*", "a-dep": "1.0.1" } },
      });
      await ok(dir, "install");

      const { packages } = await resolved(dir);
      expect(packages).toMatchObject({ "a-dep": "a-dep@1.0.2", "beta/a-dep": "a-dep@1.0.1" });
      expect(packages).not.toContainKey("beta/no-deps/a-dep");
      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, "packages/beta", "a-dep")).toBe("1.0.1");
      });
    });

    // two-range-deps@1.0.0 depends on no-deps@^1.0.0, printed at "two-range-deps/no-deps": that key belongs to the
    // registry package, not to the workspace of the same name, whose no-deps@2.0.0 is the root's.
    test.concurrent("the workspace's own dependency is not bound through the registry package's keys", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "two-range-deps": "1.0.0", "no-deps": "2.0.0" } }),
        "packages/two-range-deps": { name: "two-range-deps", version: "9.0.0", dependencies: { "no-deps": "2.0.0" } },
        "packages/beta": { name: "beta", version: "1.0.0", dependencies: { "two-range-deps": "workspace:*" } },
      });
      await ok(dir, "install");

      const { packages } = await resolved(dir);
      expect(packages).toMatchObject({
        "no-deps": "no-deps@2.0.0",
        "two-range-deps/no-deps": "no-deps@1.1.0",
        "beta/two-range-deps": "two-range-deps@workspace:packages/two-range-deps",
      });
      expect(packages).not.toContainKey("beta/two-range-deps/no-deps");
      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, "packages/two-range-deps", "no-deps")).toBe("2.0.0");
      });
    });

    test.concurrent("a scoped name", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "@types/is-number": "1.0.0", "no-deps": "2.0.0" } }),
        "packages/tin": { name: "@types/is-number", version: "9.0.0", dependencies: { "no-deps": "2.0.0" } },
        "packages/beta": { name: "beta", version: "1.0.0", dependencies: { "@types/is-number": "workspace:*" } },
      });
      await ok(dir, "install");

      const { packages } = await resolved(dir);
      expect(packages).toMatchObject({
        "@types/is-number": "@types/is-number@1.0.0",
        "beta/@types/is-number": "@types/is-number@workspace:packages/tin",
      });
      expect(packages).not.toContainKey("beta/@types/is-number/no-deps");
      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, "packages/beta", "@types/is-number")).toBe("9.0.0");
      });
    });
  });

  // Nobody depends on the workspace, so nothing links it. It stays in bun.lock, and its dependencies are installed.
  // Those that can't be hoisted to the root are in its own node_modules, printed below "./<name>".
  describe("a workspace is still installed when the root gives its name to a registry version written as", () => {
    const member = { name: "no-deps", version: "3.0.0", dependencies: { "a-dep": "1.0.1", "what-bin": "1.0.0" } };
    const unlinked = {
      workspaces: ["", "packages/no-deps"],
      packages: {
        "a-dep": "a-dep@1.0.2",
        "no-deps": "no-deps@1.0.0",
        "what-bin": "what-bin@1.0.0",
        "./no-deps/a-dep": "a-dep@1.0.1",
      },
    };
    const check = async (dir: string) => {
      expect(await seenFrom(dir, ".", "no-deps")).toBe("1.0.0");
      expect(await seenFrom(dir, ".", "a-dep")).toBe("1.0.2");
      expect(await seenFrom(dir, "packages/no-deps", "a-dep")).toBe("1.0.1");
      expect(await seenFrom(dir, "packages/no-deps", "what-bin")).toBe("1.0.0");
    };

    for (const [written, range, catalog] of [
      ["a range", "1.0.0", undefined],
      ["catalog:", "catalog:", { "no-deps": "1.0.0" }],
    ] as const) {
      const rootWith = (dependencies: PackageJson) =>
        root({
          workspaces: { packages: ["packages/*"], catalog },
          dependencies: { ...dependencies, "a-dep": "1.0.2" },
        });

      test.concurrent(written, async () => {
        const dir = await project(linker, { "": rootWith({ "no-deps": range }), "packages/no-deps": member });
        await ok(dir, "install");

        expect(await resolved(dir)).toEqual(unlinked);
        await expectRoundTrip(dir, () => check(dir));
      });

      test.concurrent(`${written}, after an install without it`, async () => {
        const dir = await project(linker, { "": rootWith({}), "packages/no-deps": member });
        await ok(dir, "install");
        expect((await resolved(dir)).packages).toMatchObject({
          "no-deps": "no-deps@workspace:packages/no-deps",
          "no-deps/a-dep": "a-dep@1.0.1",
        });

        await write(join(dir, "package.json"), JSON.stringify(rootWith({ "no-deps": range })));
        await ok(dir, "install");

        expect(await resolved(dir)).toEqual(unlinked);
        await check(dir);
        await ok(dir, "install", "--frozen-lockfile");
        await check(dir);
      });
    }

    // Bun 1.4 and older left such a workspace out of bun.lock: the file they wrote is the one of a root without it.
    test.concurrent("a range, in a bun.lock from Bun 1.4: it isn't changed until the dependencies change", async () => {
      const dependencies = { "no-deps": "1.0.0" };
      const dir = await project(linker, { "": { name: "sandbox", version: "1.0.0", dependencies } });
      await ok(dir, "install", "--lockfile-only");
      const older = await lockText(dir);
      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify(root({ dependencies }))),
        write(join(dir, "packages", "no-deps", "package.json"), JSON.stringify(member)),
      ]);

      await ok(dir, "install", "--frozen-lockfile");
      await ok(dir, "ci");
      await ok(dir, "install");
      await ok(dir, "install", "--lockfile-only");
      expect(await lockText(dir)).toBe(older);
      expect(await seenFrom(dir, ".", "no-deps")).toBe("1.0.0");

      await write(
        join(dir, "package.json"),
        JSON.stringify(root({ dependencies: { ...dependencies, "a-dep": "1.0.2" } })),
      );
      await ok(dir, "install");
      expect(await resolved(dir)).toEqual(unlinked);
      await expectRoundTrip(dir, () => check(dir));
    });

    test.concurrent("an alias under its own name, in a bun.lock from Bun 1.4: it isn't changed", async () => {
      const dependencies = { "no-deps": "npm:no-deps@1.0.0" };
      const dir = await project(linker, { "": { name: "sandbox", version: "1.0.0", dependencies } });
      await ok(dir, "install", "--lockfile-only");
      const older = await lockText(dir);
      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify(root({ dependencies }))),
        write(join(dir, "packages", "no-deps", "package.json"), JSON.stringify(member)),
      ]);

      await ok(dir, "install", "--frozen-lockfile");
      await ok(dir, "install");
      expect(await lockText(dir)).toBe(older);
    });

    // In Bun 1.4 only a registry range that the workspace's version does not satisfy took its entry. Next to anything
    // else, a workspace that bun.lock does not have is a new one.
    test.concurrent.each<[string, () => string, string?]>([
      ["catalog:", () => "catalog:", "3.0.0"],
      ["another package under its name", () => "npm:a-dep@1.0.1", "3.0.0"],
      ["a tarball URL", () => `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz`, "3.0.0"],
      ["a tarball file", () => "file:./no-deps.tgz", "3.0.0"],
      ["link:", () => "link:./vendor/no-deps", "3.0.0"],
      ["a range, without a version of its own", () => "1.0.0", undefined],
    ])("a workspace that is new next to %s is a change", async (_, spec, version) => {
      const dir = await project(linker, {
        "": root({
          workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
          dependencies: { "no-deps": spec() },
        }),
        "packages/use": { name: "use" },
        "vendor/no-deps": { name: "no-deps", version: "7.0.0" },
      });
      const packed = { "package/package.json": JSON.stringify({ name: "no-deps", version: "5.0.0" }) };
      await write(join(dir, "no-deps.tgz"), await new Bun.Archive(packed, { compress: "gzip" }).bytes());
      await ok(dir, "install");
      expect((await resolved(dir)).workspaces).toEqual(["", "packages/use"]);

      await write(
        join(dir, "packages", "no-deps", "package.json"),
        JSON.stringify({ name: "no-deps", version, dependencies: { "what-bin": "1.0.0" } }),
      );
      const frozen = await bun(dir, "install", "--frozen-lockfile");
      expect(frozen.stderr).toContain("error: lockfile had changes, but lockfile is frozen");
      expect(frozen.exitCode).toBe(1);

      await ok(dir, "install");
      expect((await resolved(dir)).workspaces).toEqual(["", "packages/no-deps", "packages/use"]);
      expect(await seenFrom(dir, "packages/no-deps", "what-bin")).toBe("1.0.0");
    });

    test.concurrent("a range, and the install fails if a dependency of the workspace can't be installed", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "1.0.0" } }),
        "packages/no-deps": { ...member, dependencies: { "this-package-does-not-exist-in-the-registry": "1.0.0" } },
      });

      const { stderr, exitCode } = await bun(dir, "install");

      expect(stderr).toContain("error: this-package-does-not-exist-in-the-registry@1.0.0 failed to resolve");
      expect(exitCode).toBe(1);
    });
  });

  test.concurrent("a * range still links a workspace without a version", async () => {
    const dir = await project(linker, {
      "": root({ dependencies: { "no-deps": "*" } }),
      "packages/no-deps": { name: "no-deps" },
    });
    await ok(dir, "install");

    expect((await resolved(dir)).packages).toEqual({ "no-deps": "no-deps@workspace:packages/no-deps" });
    await expectRoundTrip(dir, async () => {
      expect(await file(join(dir, "node_modules", "no-deps", "package.json")).json()).toEqual({ name: "no-deps" });
    });
  });

  // An alias is installed in `node_modules/<alias>`. It doesn't take a folder from the workspace, so the workspace and
  // its own dependencies are still installed, whether or not the workspace has a version.
  describe("a root alias of the registry package that has the name of a workspace", () => {
    test.concurrent.each([
      { title: "a version out of the alias's range", version: { version: "3.0.0" }, add: false },
      { title: "no version", version: {}, add: false },
      { title: "a version out of the range of an alias that bun add adds", version: { version: "3.0.0" }, add: true },
    ])("keeps the workspace, which has $title", async ({ version, add }) => {
      const dir = await project(linker, {
        "": root(add ? {} : { dependencies: { published: "npm:no-deps@1.0.0" } }),
        "packages/no-deps": { name: "no-deps", ...version, dependencies: { "a-dep": "1.0.1" } },
      });
      await ok(dir, "install");
      if (add) {
        const { stdout } = await ok(dir, "add", "published@npm:no-deps@1.0.0");
        expect(stdout).toContain("installed published@npm:no-deps@1.0.0");
      }

      expect(await resolved(dir)).toEqual({
        workspaces: ["", "packages/no-deps"],
        packages: {
          "a-dep": "a-dep@1.0.1",
          "no-deps": "no-deps@workspace:packages/no-deps",
          "published": "no-deps@1.0.0",
        },
      });
      await expectRoundTrip(dir, async () => {
        expect(await file(join(dir, "node_modules", "published", "package.json")).json()).toEqual({
          name: "no-deps",
          version: "1.0.0",
        });
        expect(await seenFrom(dir, "packages/no-deps", "a-dep")).toBe("1.0.1");
      });
    });

    // Bun 1.4 and older wrote such a file and accepted it, so a frozen install still does. It looks the same as the
    // file of a project whose workspace is new.
    test.concurrent.each(["a bun that dropped the workspace", "before the workspace was added"])(
      "a bun.lock from %s passes frozen and is repaired",
      async from => {
        const manifest = { name: "no-deps", version: "3.0.0", dependencies: { "a-dep": "1.0.1" } };
        const dropped = from.includes("dropped");
        const dir = await project(linker, {
          "": root({ dependencies: { published: "npm:no-deps@1.0.0" } }),
          ...(dropped ? { "packages/no-deps": manifest } : {}),
        });
        await ok(dir, "install");
        if (dropped) {
          const lock = Bun.JSONC.parse(await lockText(dir)) as Record<
            "workspaces" | "packages",
            Record<string, unknown>
          >;
          delete lock.workspaces["packages/no-deps"];
          delete lock.packages["no-deps"];
          delete lock.packages["a-dep"];
          expect(Object.keys(lock.packages)).toEqual(["published"]);
          await write(join(dir, "bun.lock"), JSON.stringify(lock, null, 2));
        } else {
          await write(join(dir, "packages", "no-deps", "package.json"), JSON.stringify(manifest));
        }

        await ok(dir, "install", "--frozen-lockfile");

        await ok(dir, "install");
        expect((await resolved(dir)).workspaces).toEqual(["", "packages/no-deps"]);
        expect(await seenFrom(dir, "packages/no-deps", "a-dep")).toBe("1.0.1");
        await ok(dir, "install", "--frozen-lockfile");
      },
    );
  });

  // Bun 1.4 and older gave the root's entry for a workspace to the root's own dependency on a registry version of that
  // package, took a tag of its name from the registry, and linked it for a `file:` path to its folder under any name.
  // These are the lockfiles that 1.4.3 wrote. Nothing changed since, so a frozen install takes them as they are.
  describe("a lockfile from Bun 1.4 of a root that names its own workspace a second time", () => {
    const member = { name: "no-deps", version: "3.0.0", dependencies: { "a-dep": "1.0.1" } };
    const integrity: Record<string, string> = {
      "no-deps-1.0.0":
        "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
      "no-deps-1.1.0":
        "sha512-ebG2pipYAKINcNI3YxdsiAgFvNGp2gdRwxAKN2LYBm9+YxuH/lHH2sl+GKQTuGiNfCfNZRMHUyyLPEJD6HWm7w==",
      "no-deps-2.0.0":
        "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==",
      "a-dep-1.0.1": "sha512-6nmTaPgO2U/uOODqOhbjbnaB4xHuZ+UB7AjKUA3g2dT4WRWeNxgp0dC8Db4swXSnO5/uLLUdFmUJKINNBO/3wg==",
    };
    const fromRegistry = (key: string, name: string, version: string) =>
      `"${key}": ["${name}@${version}", "${registry.registryUrl()}${name}/-/${name}-${version}.tgz", {}, "${integrity[`${name}-${version}`]}"],`;
    const memberEntry = `
    "packages/no-deps": {
      "name": "no-deps",
      "version": "3.0.0",
      "dependencies": {
        "a-dep": "1.0.1",
      },
    },`;
    const bunLock = (rootEntry: string, members: string, packages: string[]) => `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "sandbox",${rootEntry}
    },${members}
  },
  "packages": {
${packages.map(row => `    ${row}\n`).join("\n")}  }
}
`;

    // "repaired": the first `bun install` may save the file again, without what the older version got wrong.
    async function expectAccepted(
      dir: string,
      lockfile: "bun.lock" | "bun.lockb",
      after: "kept" | "repaired",
      check: () => Promise<void>,
    ) {
      const bytes = () => file(join(dir, lockfile)).bytes();
      const written = await bytes();
      await ok(dir, "install", "--frozen-lockfile");
      await check();
      await wipeNodeModules(dir);
      await ok(dir, "ci");
      await check();
      expect(await bytes()).toEqual(written);

      await ok(dir, "install");
      const saved = await bytes();
      if (after === "kept") expect(saved).toEqual(written);
      await ok(dir, "install");
      if (after === "kept") await check();
      expect(await bytes()).toEqual(saved);
      await ok(dir, "install", "--frozen-lockfile");
    }

    test.concurrent.each<[string, "kept" | "repaired", PackageJson, string, () => string]>([
      [
        "by an alias of a published version",
        "repaired",
        { dependencies: { published: "npm:no-deps@1.0.0" } },
        "published@1.0.0",
        () =>
          bunLock(
            `
      "dependencies": {
        "published": "npm:no-deps@1.0.0",
      },`,
            "",
            [fromRegistry("published", "no-deps", "1.0.0")],
          ),
      ],
      [
        "as an optional peer",
        "repaired",
        { peerDependencies: { "no-deps": "^1.0.0" }, peerDependenciesMeta: { "no-deps": { optional: true } } },
        "no-deps@1.1.0",
        () =>
          bunLock(
            `
      "peerDependencies": {
        "no-deps": "^1.0.0",
        "no-deps": "*",
      },
      "optionalPeers": [
        "no-deps",
      ],`,
            "",
            [fromRegistry("no-deps", "no-deps", "1.1.0")],
          ),
      ],
      [
        "in dependencies and in optionalDependencies",
        "kept",
        { dependencies: { "no-deps": "1.0.0" }, optionalDependencies: { "no-deps": "^1.0.0" } },
        "no-deps@1.1.0",
        () =>
          bunLock(
            `
      "dependencies": {
        "no-deps": "1.0.0",
      },
      "optionalDependencies": {
        "no-deps": "^1.0.0",
      },`,
            "",
            [fromRegistry("no-deps", "no-deps", "1.1.0")],
          ),
      ],
      [
        "by a version and by a tag",
        "repaired",
        { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "no-deps": "latest" } },
        "no-deps@2.0.0",
        () =>
          bunLock(
            `
      "dependencies": {
        "no-deps": "1.0.0",
      },
      "devDependencies": {
        "no-deps": "latest",
      },`,
            "",
            [fromRegistry("no-deps", "no-deps", "2.0.0")],
          ),
      ],
      [
        "by a file: path under another name",
        "kept",
        { dependencies: { other: "file:./packages/no-deps" } },
        "other@3.0.0",
        () =>
          bunLock(
            `
      "dependencies": {
        "other": "file:./packages/no-deps",
      },`,
            memberEntry,
            [
              fromRegistry("a-dep", "a-dep", "1.0.1"),
              `"no-deps": ["no-deps@workspace:packages/no-deps"],`,
              `"other": ["no-deps@workspace:packages/no-deps"],`,
            ],
          ),
      ],
    ])("%s", async (_, after, dependencies, installed, lock) => {
      const dir = await project(linker, { "": root(dependencies), "packages/no-deps": member });
      await write(join(dir, "bun.lock"), lock());
      const [name, version] = installed.split("@");

      await expectAccepted(dir, "bun.lock", after, async () => {
        expect(await seenFrom(dir, ".", name)).toBe(version);
        // The workspace itself, not a copy of it.
        if (version === member.version)
          expect(await lookUp(dir, name)).toBe(await realpath(join(dir, "packages", "no-deps")));
      });
    });

    async function writeLockb(dir: string, fixture: string) {
      const written = await file(join(import.meta.dir, "fixtures", fixture)).bytes();
      // Strings are stored by offset and length.
      const host = new URL(registry.registryUrl()).host;
      expect(host).toHaveLength("localhost:39073".length);
      await write(
        join(dir, "bun.lockb"),
        Buffer.from(Buffer.from(written).toString("latin1").replaceAll("localhost:39073", host), "latin1"),
      );
    }

    // package.json names the workspace twice no longer, or not as the lockfile has it: an edit like any other.
    describe.each([
      {
        optional: "workspace:*",
        dev: "^1.0.0",
        fixture: "workspace-name-optional-link.lockb",
        before: "1.1.0",
        after: "3.0.0",
      },
      {
        optional: "^1.0.0",
        dev: "workspace:*",
        fixture: "workspace-name-optional-range.lockb",
        before: "3.0.0",
        after: "1.1.0",
      },
    ])("in optionalDependencies ($optional) and in devDependencies ($dev), in bun.lockb", row => {
      const setUp = async (devDependencies?: PackageJson) => {
        const dir = await project(
          linker,
          {
            "": root({ optionalDependencies: { "no-deps": row.optional }, devDependencies }),
            "packages/no-deps": member,
          },
          "saveTextLockfile = false\n",
        );
        await writeLockb(dir, row.fixture);
        return dir;
      };

      test.concurrent("nothing changed", async () => {
        const dir = await setUp({ "no-deps": row.dev });
        await expectAccepted(dir, "bun.lockb", "kept", async () => {
          expect(await seenFrom(dir, ".", "no-deps")).toBe(row.before);
        });
      });

      test.concurrent.each([
        ["is removed", undefined],
        ["changes", { "no-deps": row.dev === "^1.0.0" ? "~1.0.0" : "workspace:^" }],
      ])("the one in devDependencies %s", async (_, devDependencies) => {
        const dir = await setUp(devDependencies);
        const written = await file(join(dir, "bun.lockb")).bytes();

        await ok(dir, "install");
        expect(await seenFrom(dir, ".", "no-deps")).toBe(row.after);
        expect(await file(join(dir, "bun.lockb")).bytes()).not.toEqual(written);
        await ok(dir, "install", "--frozen-lockfile");
        expect(await seenFrom(dir, ".", "no-deps")).toBe(row.after);
      });
    });

    test.concurrent("by a tag, in bun.lockb", async () => {
      const dir = await project(
        linker,
        { "": root({ dependencies: { "no-deps": "latest" } }), "packages/no-deps": member },
        "saveTextLockfile = false\n",
      );
      await writeLockb(dir, "workspace-name-dist-tag.lockb");

      // The two linkers of Bun 1.4 differed here.
      await expectAccepted(dir, "bun.lockb", "kept", async () => {
        expect(await seenFrom(dir, ".", "no-deps")).toBe(linker === "hoisted" ? "3.0.0" : "2.0.0");
        expect(await seenFrom(dir, "packages/no-deps", "a-dep")).toBe("1.0.1");
      });
    });

    // Here the entry that has the range is not optional.
    test.concurrent("as an optional peer, in bun.lockb", async () => {
      const dir = await project(
        linker,
        {
          "": root({
            peerDependencies: { "no-deps": "^1.0.0" },
            peerDependenciesMeta: { "no-deps": { optional: true } },
          }),
          "packages/no-deps": member,
        },
        "saveTextLockfile = false\n",
      );
      await writeLockb(dir, "workspace-name-optional-peer.lockb");

      await expectAccepted(dir, "bun.lockb", "kept", async () => {
        expect(await seenFrom(dir, ".", "no-deps")).toBe("1.1.0");
      });
    });

    // This one has the workspace without the packages that it depends on.
    test.concurrent("by a published version, next to a workspace with a peer dependency on it", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "1.0.0" } }),
        "packages/no-deps": member,
        "packages/app": { name: "app", version: "1.0.0", peerDependencies: { "no-deps": "^3.0.0" } },
      });
      await write(
        join(dir, "bun.lock"),
        bunLock(
          `
      "dependencies": {
        "no-deps": "1.0.0",
      },`,
          `
    "packages/app": {
      "name": "app",
      "version": "1.0.0",
      "peerDependencies": {
        "no-deps": "^3.0.0",
      },
    },${memberEntry}`,
          [`"app": ["app@workspace:packages/app"],`, fromRegistry("no-deps", "no-deps", "1.0.0")],
        ),
      );

      for (let i = 0; i < 2; i++) {
        expect((await bun(dir, "install")).exitCode).toBe(0);
        expect(await seenFrom(dir, ".", "no-deps")).toBe("1.0.0");
      }
    });

    test.concurrent("the same, and --production doesn't need the workspace's devDependencies", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "1.0.0" } }),
        "packages/no-deps": { name: "no-deps", version: "3.0.0", devDependencies: { "a-dep": "1.0.1" } },
      });
      await write(
        join(dir, "bun.lock"),
        bunLock(
          `
      "dependencies": {
        "no-deps": "1.0.0",
      },`,
          memberEntry.replace('"dependencies"', '"devDependencies"'),
          [fromRegistry("no-deps", "no-deps", "1.0.0")],
        ),
      );
      const written = await lockText(dir);

      await ok(dir, "install", "--production");
      expect(await seenFrom(dir, ".", "no-deps")).toBe("1.0.0");
      expect(await lockText(dir)).toBe(written);
    });
  });

  // Both used to be placed side by side: two "alpha" keys in bun.lock.
  describe("a root file: dependency that has the name of a workspace", () => {
    const vendorAlpha = { name: "alpha", version: "2.0.0" };

    test.concurrent.each([
      {
        title: "resolves to the workspace",
        tree: { "packages/alpha": { name: "alpha" }, "vendor/alpha": vendorAlpha },
        packages: { "alpha": "alpha@workspace:packages/alpha" },
      },
      {
        title: "resolves to the workspace, whose own dependencies are installed",
        tree: {
          "packages/alpha": { name: "alpha", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } },
          "packages/beta": { name: "beta", version: "1.0.0", dependencies: { alpha: "workspace:*" } },
          "vendor/alpha": vendorAlpha,
        },
        packages: {
          "a-dep": "a-dep@1.0.1",
          "alpha": "alpha@workspace:packages/alpha",
          "beta": "beta@workspace:packages/beta",
        },
      },
      {
        title: "resolves to the workspace when the folder depends back on it",
        tree: {
          "packages/alpha": { name: "alpha", version: "1.0.0" },
          "vendor/alpha": { ...vendorAlpha, dependencies: { alpha: "workspace:*" } },
        },
        packages: { "alpha": "alpha@workspace:packages/alpha" },
      },
      {
        title: "resolves to the workspace when the folder's package has another name",
        tree: {
          "packages/alpha": { name: "alpha", version: "1.0.0" },
          "vendor/alpha": { name: "other", version: "2.0.0" },
        },
        packages: { "alpha": "alpha@workspace:packages/alpha" },
      },
    ] as { title: string; tree: Record<string, PackageJson>; packages: Record<string, string> }[])(
      "$title",
      async ({ tree, packages }) => {
        const dir = await project(linker, { "": root({ dependencies: { alpha: "file:./vendor/alpha" } }), ...tree });
        await ok(dir, "install");

        expect((await lockText(dir)).match(/"alpha": \[/g)).toHaveLength(1);
        expect((await resolved(dir)).packages).toEqual(packages);
        await expectRoundTrip(dir, async () => {
          expect(await file(join(dir, "node_modules", "alpha", "package.json")).json()).toEqual(tree["packages/alpha"]);
        });
      },
    );

    test.concurrent.each(["relative", "absolute"])("a %s path to the workspace's own directory", async kind => {
      const dir = await project(linker, { "packages/alpha": { name: "alpha", version: "1.0.0" } });
      const literal =
        kind === "absolute" ? `file:${join(dir, "packages", "alpha").replaceAll("\\", "/")}` : "file:./packages/alpha";
      await write(join(dir, "package.json"), JSON.stringify(root({ dependencies: { alpha: literal } })));
      await ok(dir, "install");

      expect((await resolved(dir)).packages).toEqual({ "alpha": "alpha@workspace:packages/alpha" });
      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, ".", "alpha")).toBe("1.0.0");
      });
    });

    test.concurrent.each(["alpha", "other"])(
      "%s, a path to a workspace's directory, is a folder once that is no workspace",
      async name => {
        const dependencies = { [name]: "file:./packages/alpha" };
        const dir = await project(linker, {
          "": root({ dependencies }),
          "packages/alpha": { name: "alpha", version: "1.0.0" },
        });
        await ok(dir, "install");
        await write(join(dir, "package.json"), JSON.stringify({ name: "sandbox", version: "1.0.0", dependencies }));

        const frozen = await bun(dir, "install", "--frozen-lockfile");
        expect(frozen.stderr).toContain("error: lockfile had changes, but lockfile is frozen");
        expect(frozen.exitCode).toBe(1);

        await ok(dir, "install");
        expect(await resolved(dir)).toEqual({ workspaces: [""], packages: { [name]: "alpha@file:packages/alpha" } });
        await ok(dir, "install", "--frozen-lockfile");
      },
    );

    test.concurrent("a path to a workspace's directory follows the workspace to its new name", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { other: "file:./packages/alpha" } }),
        "packages/alpha": { name: "alpha", version: "1.0.0" },
      });
      await ok(dir, "install");
      await write(
        join(dir, "packages", "alpha", "package.json"),
        JSON.stringify({ name: "renamed", version: "1.0.0" }),
      );
      await ok(dir, "install");

      expect(await resolved(dir)).toEqual({
        workspaces: ["", "packages/alpha"],
        packages: { "other": "renamed@workspace:packages/alpha", "renamed": "renamed@workspace:packages/alpha" },
      });
      await ok(dir, "install", "--frozen-lockfile");
    });

    // This is what Bun 1.4 wrote for this project, and ignored on every install. One install replaces it.
    test.concurrent("a bun.lock with both keys is replaced", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { alpha: "file:./vendor/alpha" } }),
        "packages/alpha": { name: "alpha" },
        "vendor/alpha": vendorAlpha,
      });
      await ok(dir, "install");
      const lock = await lockText(dir);
      const row = '    "alpha": ["alpha@workspace:packages/alpha"],\n';
      expect(lock).toContain(row);
      await write(join(dir, "bun.lock"), lock.replace(row, row + '\n    "alpha": ["alpha@file:vendor/alpha", {}],\n'));

      const { stderr, exitCode } = await bun(dir, "install");

      expect(stderr).toContain("warn: Ignoring lockfile");
      expect(stderr).toContain("Saved lockfile");
      expect(await lockText(dir)).toBe(lock);
      expect(exitCode).toBe(0);
      await ok(dir, "install", "--frozen-lockfile");
    });
  });

  // Only the registry knows which version a tag names, so a tag never takes the name. no-deps@latest is 2.0.0.
  describe("a root dependency on a tag that has the name of a workspace", () => {
    const member = { name: "no-deps", version: "1.5.0" };
    const expectWorkspace = async (dir: string) => {
      expect((await resolved(dir)).packages).toEqual({ "no-deps": "no-deps@workspace:packages/no-deps" });
      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, ".", "no-deps")).toBe("1.5.0");
      });
    };

    test.concurrent("resolves to the workspace", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "latest" } }),
        "packages/no-deps": member,
      });
      await ok(dir, "install");
      await expectWorkspace(dir);
    });

    test.concurrent("resolves to the workspace that is added after an install without it", async () => {
      const dir = await project(linker, { "": root({ dependencies: { "no-deps": "latest" } }) });
      await ok(dir, "install");
      expect((await resolved(dir)).packages).toEqual({ "no-deps": "no-deps@2.0.0" });

      await write(join(dir, "packages", "no-deps", "package.json"), JSON.stringify(member));
      await ok(dir, "install");
      await expectWorkspace(dir);
    });

    test.concurrent.each(["no-deps", "-d -E no-deps@latest"])("bun add %s saves workspace:*", async args => {
      const dir = await project(linker, { "": root({}), "packages/no-deps": member });
      await ok(dir, "install");

      const { stdout } = await ok(dir, "add", ...args.split(" "));

      const { dependencies, devDependencies } = await file(join(dir, "package.json")).json();
      expect(dependencies ?? devDependencies).toEqual({ "no-deps": "workspace:*" });
      expect(stdout).toContain("installed no-deps@workspace:packages/no-deps");
      await expectWorkspace(dir);
    });
  });

  // The range of the row accepts the workspace, or names it, and the row is bound to something else.
  describe("a dependency that could link to a workspace but doesn't", () => {
    const published = { "no-deps": "^1.0.0" };
    test.concurrent.each([
      ["peerDependenciesMeta", { dependencies: published, peerDependenciesMeta: { "no-deps": { optional: true } } }],
      ["peerDependencies", { dependencies: published, peerDependencies: { "no-deps": "*" } }],
      ["a peer range", { devDependencies: published, peerDependencies: { "no-deps": ">=0.0.1" } }],
    ])("%s on a name that the package's own dependency on the registry version serves", async (_, app) => {
      const dir = await project(linker, {
        "": root({}),
        "packages/no-deps": { name: "no-deps", version: "0.0.1" },
        "packages/app": { name: "app", version: "1.0.0", ...app },
      });
      await ok(dir, "install");

      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, "packages/app", "no-deps")).toBe("1.1.0");
      });
      await ok(dir, "prune");
      await ok(dir, "dedupe");
    });

    test.concurrent("an optional peer on a workspace: name that overrides send to the registry", async () => {
      const dir = await project(linker, {
        "": root({ dependencies: { "no-deps": "workspace:~" }, overrides: { "no-deps": "latest" } }),
        "packages/app": { name: "app", version: "1.0.0", peerDependenciesMeta: { "no-deps": { optional: true } } },
      });
      await ok(dir, "install");

      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, ".", "no-deps")).toBe("2.0.0");
      });
    });

    test.concurrent("bun add of a name that overrides send to a workspace of another name", async () => {
      const dir = await project(linker, {
        "": root({ overrides: { "a-dep": "npm:no-deps@*" } }),
        "packages/no-deps": { name: "no-deps", version: "1.5.0" },
      });
      await ok(dir, "add", "--optional", "a-dep");

      await expectRoundTrip(dir, async () => {
        expect(await seenFrom(dir, ".", "a-dep")).toBe("1.5.0");
      });
    });
  });

  // peer-deps-fixed has a peer on no-deps@^1.0.0, which links a workspace named no-deps. A registry package's range links
  // a workspace through the root's edge to it. Once an install drops that edge, the peer resolves again, the way it does
  // with no lockfile. It used to stay linked, through an edge that bun.lock cannot record.
  describe("a registry package's range that links a workspace resolves again once", () => {
    const app = { name: "app", version: "1.0.0", dependencies: { "peer-deps-fixed": "1.0.0" } };

    test.concurrent.each([
      {
        // The workspace is still installed, without a link, and the peer finds the root's copy.
        history: "a root dependency takes the name of the workspace",
        root: { workspaces: ["packages/*"], devDependencies: { "no-deps": "1.0.0" } },
        workspaces: ["", "packages/app", "packages/no-deps"],
        packages: { "a-dep": "a-dep@1.0.1", "no-deps": "no-deps@1.0.0" },
        peer: "1.0.0",
      },
      {
        history: "a root dependency takes the name of the workspace and another workspace changes in the same edit",
        root: { workspaces: ["packages/*"], devDependencies: { "no-deps": "1.0.0" } },
        app: { ...app, dependencies: { ...app.dependencies, "what-bin": "1.0.0" } },
        workspaces: ["", "packages/app", "packages/no-deps"],
        packages: { "a-dep": "a-dep@1.0.1", "no-deps": "no-deps@1.0.0", "what-bin": "what-bin@1.0.0" },
        peer: "1.0.0",
      },
      {
        history: 'the workspace leaves "workspaces"',
        root: { workspaces: ["packages/app"] },
        workspaces: ["", "packages/app"],
        packages: { "no-deps": "no-deps@1.1.0" },
        peer: "1.1.0",
      },
      {
        history: "the workspace is deleted",
        root: { workspaces: ["packages/*"] },
        change: "delete",
        workspaces: ["", "packages/app"],
        packages: { "no-deps": "no-deps@1.1.0" },
        peer: "1.1.0",
      },
      {
        // The same name, a new package: the peer follows the root's edge to the new folder.
        history: "the workspace moves to another folder",
        root: { workspaces: ["packages/*", "libs/*"] },
        change: "move",
        workspaces: ["", "libs/no-deps", "packages/app"],
        packages: { "a-dep": "a-dep@1.0.1", "no-deps": "no-deps@workspace:libs/no-deps" },
        peer: "1.5.0",
      },
    ] as {
      history: string;
      root: PackageJson;
      app?: PackageJson;
      change?: "delete" | "move";
      workspaces: string[];
      packages: Record<string, string>;
      peer: string;
    }[])("$history", async ({ root: rootAfter, app: appAfter, change, workspaces, packages, peer: peerVersion }) => {
      const dir = await project(linker, {
        "": { name: "root", workspaces: ["packages/*"] },
        "packages/no-deps": { name: "no-deps", version: "1.5.0", dependencies: { "a-dep": "1.0.1" } },
        "packages/app": app,
      });
      // The no-deps that peer-deps-fixed loads.
      const peer = async () =>
        (
          await file(
            join(
              await lookUp(await lookUp(join(dir, "packages", "app"), "peer-deps-fixed"), "no-deps"),
              "package.json",
            ),
          ).json()
        ).version;
      await ok(dir, "install");
      expect(await resolved(dir)).toEqual({
        workspaces: ["", "packages/app", "packages/no-deps"],
        packages: {
          "a-dep": "a-dep@1.0.1",
          "app": "app@workspace:packages/app",
          "no-deps": "no-deps@workspace:packages/no-deps",
          "peer-deps-fixed": "peer-deps-fixed@1.0.0",
        },
      });
      expect(await peer()).toBe("1.5.0");

      const folder = join(dir, "packages", "no-deps");
      if (change === "delete") await rm(folder, { recursive: true });
      if (change === "move") {
        await mkdir(join(dir, "libs"));
        await rename(folder, join(dir, "libs", "no-deps"));
      }
      await write(join(dir, "package.json"), JSON.stringify({ name: "root", ...rootAfter }));
      if (appAfter) await write(join(dir, "packages", "app", "package.json"), JSON.stringify(appAfter));
      await ok(dir, "install");
      const written = await lockText(dir);
      expect(await resolved(dir)).toEqual({
        workspaces,
        packages: { "app": "app@workspace:packages/app", "peer-deps-fixed": "peer-deps-fixed@1.0.0", ...packages },
      });
      expect(await peer()).toBe(peerVersion);

      // Installing from bun.lock gives the same result as the install that wrote it.
      await wipeNodeModules(dir);
      await ok(dir, "install", "--frozen-lockfile");
      expect(await peer()).toBe(peerVersion);
      const again = await ok(dir, "install");
      expect(again.stderr).not.toContain("Saved lockfile");
      expect(await lockText(dir)).toBe(written);

      // and it is the bun.lock an install with no lockfile writes
      await Promise.all([wipeNodeModules(dir), rm(join(dir, "bun.lock"))]);
      await ok(dir, "install");
      expect(await lockText(dir)).toBe(written);
    });
  });
});

// The registry does not have the name of the workspace: a request for it is a 404 that fails the install.
describe("a range on a dropped workspace does not resolve again when the install no longer needs its package:", () => {
  type Manifest = { name: string; version: string } & PackageJson;

  async function serve(published: Manifest[]) {
    const requested: string[] = [];
    const tarballs = new Map<string, Uint8Array>();
    for (const manifest of published) {
      const archive = new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" });
      tarballs.set(`/${manifest.name}-${manifest.version}.tgz`, await archive.bytes());
    }
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname, origin } = new URL(req.url);
        const tarball = tarballs.get(pathname);
        if (tarball) return new Response(tarball);
        requested.push(pathname);
        const versions = published.filter(manifest => `/${manifest.name}` === pathname);
        if (versions.length === 0) return new Response("not found", { status: 404 });
        return Response.json({
          name: versions[0].name,
          "dist-tags": { latest: versions.at(-1)!.version },
          versions: Object.fromEntries(
            versions.map(manifest => [
              manifest.version,
              { ...manifest, dist: { tarball: `${origin}/${manifest.name}-${manifest.version}.tgz` } },
            ]),
          ),
        });
      },
    });
    return { server, requested };
  }

  async function projectOn(url: string, tree: Record<string, PackageJson>) {
    const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" }, files: manifests(tree) });
    await write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({ install: { cache: join(packageDir, ".bun-cache"), registry: url, linker: "hoisted" } }),
    );
    return packageDir;
  }

  test.concurrent.each(["dependencies", "peerDependencies"] as const)(
    "only the dropped workspace reached it (%s)",
    async group => {
      const { server, requested } = await serve([
        { name: "plugin", version: "1.0.0", [group]: { "private-host": "^1" } },
      ]);
      await using _ = server;
      const dir = await projectOn(server.url.href, {
        "": { name: "root", workspaces: ["packages/*"] },
        "packages/private-host": { name: "private-host", version: "1.5.0", dependencies: { plugin: "1.0.0" } },
        "packages/app": { name: "app", version: "1.0.0" },
      });
      await ok(dir, "install");
      expect(requested).toEqual(["/plugin"]);

      await write(join(dir, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/app"] }));
      await ok(dir, "install");

      expect(requested).toEqual(["/plugin"]);
      expect(await resolved(dir)).toEqual({
        workspaces: ["", "packages/app"],
        packages: { "app": "app@workspace:packages/app" },
      });
      await ok(dir, "install", "--frozen-lockfile");
    },
  );

  test.concurrent("only the version of a root dependency that the same edit replaces reached it", async () => {
    const { server, requested } = await serve([
      { name: "plugin", version: "1.0.0", dependencies: { "private-host": "^1" } },
      { name: "x", version: "1.0.0", dependencies: { plugin: "1.0.0" } },
      { name: "x", version: "2.0.0" },
    ]);
    await using _ = server;
    const dir = await projectOn(server.url.href, {
      "": { name: "root", workspaces: ["packages/*"], dependencies: { x: "1.0.0" } },
      "packages/private-host": { name: "private-host", version: "1.5.0" },
      "packages/app": { name: "app", version: "1.0.0" },
    });
    await ok(dir, "install");
    expect((await resolved(dir)).packages).toMatchObject({
      "private-host": "private-host@workspace:packages/private-host",
    });

    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/app"], dependencies: { x: "2.0.0" } }),
    );
    await ok(dir, "install");

    expect(requested).not.toContain("/private-host");
    expect(await resolved(dir)).toEqual({
      workspaces: ["", "packages/app"],
      packages: { "app": "app@workspace:packages/app", "x": "x@2.0.0" },
    });
    await ok(dir, "install", "--frozen-lockfile");
  });
});
