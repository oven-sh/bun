import { file, spawn, write } from "bun";
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, statSync } from "fs";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";

// `link:<path>` (as yarn and pnpm write it) is a symlink to that directory, relative to the
// package.json that declares it. `link:<name>` stays a `bun link` registration (bun-link.test.ts).

const rule = "only the root package.json, a workspace, or a top-level override may link to a path";

/** The project is `<root>/project`, so that `..` stays inside the temp dir. */
async function bun(root: string, args: string[], cwd = join(root, "project")) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(root, "cache"),
      BUN_INSTALL_GLOBAL_DIR: join(root, "global"),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

function errorLines(stderr: string) {
  return stderr.split(/\r?\n/).filter(line => line.startsWith("error:"));
}

function lockText(root: string) {
  return file(join(root, "project", "bun.lock")).text();
}

/** `packages` of bun.lock: key -> `name@resolution`. */
async function lockedPackages(root: string): Promise<Record<string, string>> {
  const { packages } = Bun.JSON5.parse(await lockText(root)) as { packages: Record<string, [string]> };
  return Object.fromEntries(Object.entries(packages).map(([key, [resolution]]) => [key, resolution]));
}

function expectLinkTo(link: string, target: string) {
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(realpathSync(link)).toBe(realpathSync(target));
}

/** Every place either linker could have put a link called `name`, dangling ones included. */
function entriesNamed(root: string, name: string): string[] {
  const nodeModules = join(root, "project", "node_modules");
  if (!existsSync(nodeModules)) return [];
  return Array.from(
    new Bun.Glob(`**/${name}`).scanSync({ cwd: nodeModules, onlyFiles: false, dot: true, followSymlinks: false }),
  );
}

async function writeTarball(path: string, manifest: object) {
  await write(
    path,
    await new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" }).bytes(),
  );
}

const pkg = (name: string, extra: object = {}) => JSON.stringify({ name, version: "1.0.0", ...extra });

describe.each(["hoisted", "isolated"])("link:<path> (%s)", linker => {
  // Nothing here comes from a registry.
  const bunfigText = `[install]\nlinker = "${linker}"\nregistry = "http://localhost:1/"\n`;
  const bunfig = { "project/bunfig.toml": bunfigText };

  /** Where a dependency of the workspace member `packages/app` is linked. */
  const memberDependency = (root: string, name: string) =>
    linker === "hoisted"
      ? join(root, "project", "node_modules", name)
      : join(root, "project", "packages", "app", "node_modules", name);

  test.concurrent("is relative to the declaring package.json, in the root and in a workspace", async () => {
    using dir = tempDir("link-path", {
      ...bunfig,
      "project/package.json": JSON.stringify({
        name: "root",
        private: true,
        workspaces: ["packages/*"],
        dependencies: {
          "with-manifest": "link:./vendor/with-manifest",
          "no-manifest": "link:./vendor/no-manifest",
          odd: "link:./vendor/~",
        },
      }),
      "project/vendor/with-manifest/package.json": JSON.stringify({ name: "with-manifest", version: "1.2.3" }),
      "project/vendor/with-manifest/index.js": "module.exports = 'with';",
      // Like in Yarn, the directory doesn't need a package.json,
      "project/vendor/no-manifest/index.js": "module.exports = 'without';",
      // nor a name that could be a package's.
      "project/vendor/~/index.js": "module.exports = 'tilde';",
      "project/packages/app/package.json": pkg("app", { dependencies: { local: "link:../../vendor/with-manifest" } }),
    });
    const root = String(dir);
    const vendor = join(root, "project", "vendor");

    const first = await bun(root, ["install"]);
    expect(first.err).not.toContain("error:");
    expect(first.err).toContain("Saved lockfile");
    expect(first.exitCode).toBe(0);
    const lock = await lockText(root);
    expect(await lockedPackages(root)).toMatchObject({
      "with-manifest": "with-manifest@link:./vendor/with-manifest",
      "no-manifest": "no-manifest@link:./vendor/no-manifest",
      local: "with-manifest@link:./vendor/with-manifest",
    });
    // The declaration is kept as written.
    expect(lock).toContain(`"local": "link:../../vendor/with-manifest"`);

    for (const again of [false, true]) {
      if (again) {
        await rm(join(root, "project", "node_modules"), { recursive: true, force: true });
        await rm(join(root, "project", "packages", "app", "node_modules"), { recursive: true, force: true });
        const frozen = await bun(root, ["install", "--frozen-lockfile"]);
        expect(frozen.err).not.toContain("error:");
        expect(frozen.exitCode).toBe(0);
        expect(await lockText(root)).toBe(lock);
      }
      const nodeModules = join(root, "project", "node_modules");
      expectLinkTo(join(nodeModules, "with-manifest"), join(vendor, "with-manifest"));
      expectLinkTo(join(nodeModules, "no-manifest"), join(vendor, "no-manifest"));
      expectLinkTo(join(nodeModules, "odd"), join(vendor, "~"));
      expectLinkTo(memberDependency(root, "local"), join(vendor, "with-manifest"));
      expect(readFileSync(join(nodeModules, "no-manifest", "index.js"), "utf8")).toContain("without");
    }
  });

  test.concurrent.each([
    { title: "./dir", spec: () => "link:./lib/dep", target: "project/lib/dep", stored: "./lib/dep" },
    // It isn't a package name, so it's a path. It's stored with `./` so that it's read back as a path.
    { title: "dir/dir", spec: () => "link:lib/dep", target: "project/lib/dep", stored: "./lib/dep" },
    { title: "../dir", spec: () => "link:../sibling", target: "sibling", stored: "../sibling" },
    { title: "not normalized", spec: () => "link:./lib/x/../dep/", target: "project/lib/dep", stored: "./lib/dep" },
    {
      title: "absolute",
      spec: (root: string) => `link:${join(root, "sibling").replaceAll("\\", "/")}`,
      target: "sibling",
      stored: "../sibling",
    },
  ])("accepts a target spelled $title", async ({ spec, target, stored }) => {
    using dir = tempDir("link-path-spelling", {
      ...bunfig,
      [`${target}/package.json`]: pkg("@scope/dep"),
    });
    const root = String(dir);
    await write(
      join(root, "project", "package.json"),
      JSON.stringify({ name: "root", dependencies: { "@scope/dep": spec(root) } }),
    );

    for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
      await rm(join(root, "project", "node_modules"), { recursive: true, force: true });
      const { err, exitCode } = await bun(root, args);
      expect(err).not.toContain("error:");
      expect(await lockedPackages(root)).toEqual({ "@scope/dep": `@scope/dep@link:${stored}` });
      expectLinkTo(join(root, "project", "node_modules", "@scope", "dep"), join(root, target));
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("fails while resolving, and writes nothing, when the directory does not exist", async () => {
    using dir = tempDir("link-path-missing", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { later: "link:./vendor/later" } }),
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install"]);
    expect(errorLines(err)).toEqual([
      'error: directory "./vendor/later" not found for linked dependency "later"',
      "error: later@link:./vendor/later failed to resolve",
    ]);
    expect(existsSync(join(root, "project", "bun.lock"))).toBe(false);
    expect(existsSync(join(root, "project", "node_modules"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  test.concurrent("fails when the target is a file", async () => {
    using dir = tempDir("link-path-file", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { dep: "link:./dep.js" } }),
      "project/dep.js": "",
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install"]);
    expect(err).toContain('error: directory "./dep.js" not found for linked dependency "dep"');
    expect(existsSync(join(root, "project", "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  test.concurrent("skips an optional dependency whose directory does not exist", async () => {
    using dir = tempDir("link-path-optional", {
      ...bunfig,
      "project/package.json": JSON.stringify({
        name: "root",
        dependencies: { dep: "link:./dep" },
        optionalDependencies: { later: "link:./later" },
      }),
      "project/dep/package.json": pkg("dep"),
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install"]);
    expect(err).not.toContain("error:");
    expect(await lockedPackages(root)).toEqual({ dep: "dep@link:./dep" });
    expect(entriesNamed(root, "later")).toEqual([]);
    expect(exitCode).toBe(0);
  });

  // An install from bun.lock never resolves, so the linker is what notices.
  test.concurrent("fails to install from bun.lock when the directory is gone", async () => {
    using dir = tempDir("link-path-deleted", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { dep: "link:./vendor/dep" } }),
      "project/bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "root", dependencies: { dep: "link:./vendor/dep" } } },
        packages: { dep: ["dep@link:./vendor/dep", {}] },
      }),
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install", "--frozen-lockfile"]);
    // Messages print a path with the platform's separator.
    expect(err.replaceAll("\\", "/")).toContain(
      linker === "hoisted"
        ? "failed linking dependency/workspace to node_modules for package dep"
        : "failed to link package: dep@link:./vendor/dep",
    );
    expect(existsSync(join(root, "project", "node_modules", "dep"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // bun records no dependencies for a linked directory. A lockfile written by hand can.
  test.concurrent("installs from a bun.lock whose link: row has dependencies", async () => {
    using dir = tempDir("link-path-row-with-dependencies", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { dep: "link:./vendor/dep" } }),
      "project/vendor/dep/package.json": pkg("dep"),
      "project/vendor/other/package.json": pkg("other"),
      "project/bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "root", dependencies: { dep: "link:./vendor/dep" } } },
        packages: {
          dep: ["dep@link:./vendor/dep", { dependencies: { other: "file:vendor/other" } }],
          "dep/other": ["other@file:vendor/other", {}],
        },
      }),
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install", "--frozen-lockfile"]);
    expect(errorLines(err)).toEqual([]);
    expectLinkTo(join(root, "project", "node_modules", "dep"), join(root, "project", "vendor", "dep"));
    expect(exitCode).toBe(0);
  });

  test.concurrent("round-trips through bun.lockb", async () => {
    using dir = tempDir("link-path-lockb", {
      "project/bunfig.toml": bunfigText + "saveTextLockfile = false\n",
      "project/package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { outside: "link:../outside" },
      }),
      "project/packages/app/package.json": pkg("app", { dependencies: { inside: "link:../../vendor/inside" } }),
      "project/vendor/inside/package.json": pkg("inside"),
      "outside/package.json": pkg("outside"),
    });
    const root = String(dir);

    for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
      await rm(join(root, "project", "node_modules"), { recursive: true, force: true });
      await rm(join(root, "project", "packages", "app", "node_modules"), { recursive: true, force: true });
      const { err, exitCode } = await bun(root, args);
      expect(err).not.toContain("error:");
      expect(existsSync(join(root, "project", "bun.lockb"))).toBe(true);
      expectLinkTo(join(root, "project", "node_modules", "outside"), join(root, "outside"));
      expectLinkTo(memberDependency(root, "inside"), join(root, "project", "vendor", "inside"));
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("one directory as link: and as file: is two packages", async () => {
    using dir = tempDir("link-path-and-file", {
      ...bunfig,
      "project/package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { dual: "link:./vendor/dual" },
      }),
      "project/packages/app/package.json": pkg("app", { dependencies: { dual: "file:../../vendor/dual" } }),
      "project/vendor/dual/package.json": pkg("dual", { dependencies: { leaf: "file:../leaf" } }),
      "project/vendor/leaf/package.json": pkg("leaf"),
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install"]);
    expect(err).not.toContain("error:");
    // The link has no dependencies of its own, and the copy keeps them.
    const lock = await lockText(root);
    expect(lock).toContain(`"dual": ["dual@link:./vendor/dual", {}]`);
    expect(lock).toContain(`["dual@file:vendor/dual", { "dependencies": { "leaf": "file:../leaf" } }]`);
    expectLinkTo(join(root, "project", "node_modules", "dual"), join(root, "project", "vendor", "dual"));
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun add, bun update and bun remove", async () => {
    using dir = tempDir("link-path-add", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      "project/packages/app/package.json": pkg("app"),
      "project/vendor/dep/package.json": pkg("dep"),
    });
    const root = String(dir);
    const app = join(root, "project", "packages", "app");
    const manifest = () => file(join(app, "package.json")).json();

    const added = await bun(root, ["add", "link:../../vendor/dep"], app);
    expect(added.err).not.toContain("error:");
    expect((await manifest()).dependencies).toEqual({ dep: "link:../../vendor/dep" });
    expect(await lockedPackages(root)).toMatchObject({ dep: "dep@link:./vendor/dep" });
    expectLinkTo(memberDependency(root, "dep"), join(root, "project", "vendor", "dep"));
    expect(added.exitCode).toBe(0);
    const lock = await lockText(root);

    // The row comes from bun.lock, whose literal is relative to the member.
    const updated = await bun(root, ["update", "dep"], app);
    expect(updated.err).not.toContain("error:");
    expect((await manifest()).dependencies).toEqual({ dep: "link:../../vendor/dep" });
    expect(await lockText(root)).toBe(lock);
    expectLinkTo(memberDependency(root, "dep"), join(root, "project", "vendor", "dep"));
    expect(updated.exitCode).toBe(0);

    const removed = await bun(root, ["remove", "dep"], app);
    expect(removed.err).not.toContain("error:");
    expect((await manifest()).dependencies).toBeUndefined();
    expect(await lockText(root)).not.toContain("link:");
    expect(entriesNamed(root, "dep")).toEqual([]);
    // The link was removed, but not its target.
    expect(existsSync(join(root, "project", "vendor", "dep", "package.json"))).toBe(true);
    expect(removed.exitCode).toBe(0);
  });

  test.concurrent("declared by a file: directory of the project", async () => {
    using dir = tempDir("link-path-of-folder", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { lib: "file:./vendor/lib" } }),
      "project/vendor/lib/package.json": pkg("lib", { dependencies: { nested: "link:../nested" } }),
      "project/vendor/lib/index.js": `module.exports = require("nested");`,
      "project/vendor/nested/package.json": pkg("nested"),
      "project/vendor/nested/index.js": `module.exports = "it worked";`,
    });
    const root = String(dir);

    for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
      await rm(join(root, "project", "node_modules"), { recursive: true, force: true });
      const { err, exitCode } = await bun(root, args);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await bun(root, ["-e", `console.log(require("lib"))`])).toEqual({
        out: "it worked\n",
        err: "",
        exitCode: 0,
      });
    }
    expect(Object.values(await lockedPackages(root))).toContain("nested@link:./vendor/nested");
  });

  // `pkg-a` is a package.json of the project, so whatever rule applies to its dependency is trusted.
  test.concurrent.each([
    ["overrides", "shared"],
    ["resolutions", "shared"],
    ["overrides", "pkg-a>shared"],
    ["resolutions", "pkg-a/shared"],
  ])(`supplied by root "%s" for "%s"`, async (field, key) => {
    using dir = tempDir("link-path-override", {
      ...bunfig,
      "shared/package.json": pkg("shared"),
      "shared/index.js": `module.exports = "shared";`,
      "project/package.json": JSON.stringify({
        name: "root",
        dependencies: { "pkg-a": "file:./pkg-a" },
        [field]: { [key]: "link:../shared" },
      }),
      "project/pkg-a/package.json": pkg("pkg-a", { dependencies: { shared: "1.0.0" } }),
      "project/pkg-a/index.js": `module.exports = require("shared");`,
    });
    const root = String(dir);

    for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
      await rm(join(root, "project", "node_modules"), { recursive: true, force: true });
      const { err, exitCode } = await bun(root, args);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await bun(root, ["-e", `console.log(require("pkg-a"))`])).toEqual({
        out: "shared\n",
        err: "",
        exitCode: 0,
      });
    }
  });

  // The path of a package from the cache would be read against the project: `link:./src` in a
  // published package would put the project's `src` under a name of that package's choosing.
  test.concurrent("is refused when a tarball declares one, also inside the project", async () => {
    using dir = tempDir("link-path-of-tarball", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { tb: "file:./tb-1.0.0.tgz" } }),
      "project/src/package.json": pkg("src"),
    });
    const root = String(dir);
    await writeTarball(join(root, "project", "tb-1.0.0.tgz"), {
      name: "tb",
      version: "1.0.0",
      dependencies: { inside: "link:./src" },
    });

    const { err, exitCode } = await bun(root, ["install"]);
    expect(errorLines(err)).toEqual([
      `error: refusing to resolve "inside@link:./src" declared by tb@./tb-1.0.0.tgz: ${rule}`,
      "error: inside@link:./src failed to resolve",
    ]);
    expect(existsSync(join(root, "project", "bun.lock"))).toBe(false);
    expect(entriesNamed(root, "inside")).toEqual([]);
    expect(exitCode).toBe(1);
  });

  // The path buffers: 4096 bytes on Linux, 1024 on macOS, the UTF-8 worst case of 32767 characters on Windows.
  const MAX_PATH_BYTES = isWindows ? 32767 * 3 + 1 : isLinux ? 4096 : 1024;

  test.concurrent("fails with ENAMETOOLONG for a bun.lock row that does not fit a path", async () => {
    const target = "./" + Buffer.alloc(MAX_PATH_BYTES + 64, "l").toString();
    using dir = tempDir("link-path-too-long", {
      ...bunfig,
      "project/package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { dep: "link:./dep" },
      }),
      "project/packages/app/package.json": pkg("app", { dependencies: { dep: "link:../../dep" } }),
      "project/dep/package.json": pkg("dep"),
      "project/bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": { name: "root", dependencies: { dep: "link:./dep" } },
          "packages/app": { name: "app", version: "1.0.0", dependencies: { dep: "link:../../dep" } },
        },
        packages: {
          app: ["app@workspace:packages/app"],
          dep: [`dep@link:${target}`, {}],
        },
      }),
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install"]);
    expect(err).toContain("ENAMETOOLONG: link path for package dep is too long");
    expect(entriesNamed(root, "dep")).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test.concurrent("fails for a package.json target that does not fit a path", async () => {
    using dir = tempDir("link-path-spec-too-long", {
      ...bunfig,
      "project/package.json": JSON.stringify({
        name: "root",
        dependencies: { dep: "link:./" + Buffer.alloc(MAX_PATH_BYTES + 64, "l").toString() },
      }),
    });
    const root = String(dir);

    const { err, exitCode } = await bun(root, ["install"]);
    expect(err).toContain('error: Dependency "dep" has an unsafe folder path');
    expect(existsSync(join(root, "project", "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun patch refuses the target", async () => {
    using dir = tempDir("link-path-patch", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { dep: "link:./vendor/dep" } }),
      "project/vendor/dep/package.json": pkg("dep"),
    });
    const root = String(dir);
    expect((await bun(root, ["install"])).exitCode).toBe(0);

    const { err, exitCode } = await bun(root, ["patch", "dep"]);
    expect(err).toContain('error: refusing to patch link: dependency "dep"');
    expectLinkTo(join(root, "project", "node_modules", "dep"), join(root, "project", "vendor", "dep"));
    expect(exitCode).not.toBe(0);
  });

  test.skipIf(isWindows).concurrent("links the target's bin and doesn't change the file's mode", async () => {
    using dir = tempDir("link-path-bin", {
      ...bunfig,
      "project/package.json": JSON.stringify({ name: "root", dependencies: { dep: "link:./vendor/dep" } }),
      "project/vendor/dep/package.json": pkg("dep", { bin: { "dep-bin": "./cli.js" } }),
      "project/vendor/dep/cli.js": `#!/usr/bin/env node\nconsole.log("dep-bin ran");`,
    });
    const root = String(dir);
    const cli = join(root, "project", "vendor", "dep", "cli.js");
    chmodSync(cli, 0o755);

    const { err, exitCode } = await bun(root, ["install"]);
    expect(err).not.toContain("error:");
    expect(realpathSync(join(root, "project", "node_modules", ".bin", "dep-bin"))).toBe(realpathSync(cli));
    expect(statSync(cli).mode & 0o777).toBe(0o755);
    expect(exitCode).toBe(0);
  });
});

// Like `file:`, the specifier is packed as written. Whoever installs the package is told why it's refused.
test.concurrent("bun pm pack keeps a link: path as written", async () => {
  using dir = tempDir("link-path-pack", {
    "project/package.json": pkg("packed", { dependencies: { dep: "link:./vendor/dep" } }),
    "project/vendor/dep/package.json": pkg("dep"),
  });
  const root = String(dir);

  const { err, exitCode } = await bun(root, ["pm", "pack"]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  const files = await new Bun.Archive(await file(join(root, "project", "packed-1.0.0.tgz")).bytes()).files();
  expect(JSON.parse(await files.get("package/package.json")!.text()).dependencies).toEqual({
    dep: "link:./vendor/dep",
  });
});
