import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "fs";
import {
  bunEnv,
  bunExe,
  type DirectoryTree,
  isASAN,
  isDebug,
  isLinux,
  isWindows,
  tempDir,
  tls,
  unprivilegedSpawnOptions,
} from "harness";
import { mkfifo } from "mkfifo";
import { connect, type Socket } from "net";
import { join } from "path";
import { pathToFileURL } from "url";

//   --install=<val>                 Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always).
//   -i                              Auto-install dependencies during execution. Equivalent to --install=fallback.

describe.concurrent("basic autoinstall", () => {
  for (const install of ["", "-i", "--install=auto", "--install=fallback", "--install=force"]) {
    for (const has_node_modules of [true, false]) {
      const should_install = !has_node_modules || (install !== "" && install !== "--install=auto");

      test(`${install || "<no flag>"} ${has_node_modules ? "with" : "without"} node_modules ${should_install ? "should" : "should not"} autoinstall`, async () => {
        using registry = fixtureRegistry();
        using dir = tempDir("autoinstall-basic", {
          "index.js": "import isEven from 'is-even'; console.log(isEven(2));",
          "bunfig.toml": registry.bunfig,
          ...(has_node_modules ? { "node_modules/abc/index.js": "" } : {}),
        });
        const { stdout, stderr } = await runAutoInstall(String(dir), ...(install === "" ? [] : [install]), "index.js");

        if (should_install) {
          expect(stderr).not.toContain("error: Cannot find package 'is-even'");
          expect(stdout).toBe("true\n");
        } else {
          expect(stderr).toContain("error: Cannot find package 'is-even'");
          expect(registry.requests).toEqual([]);
        }
      });
    }
  }
});

// In auto-install mode the project's own package.json is the lockfile's root
// package (resolution tag `root`, not `npm`). With a name and an exact version
// present, resolving any missing bare specifier used to read that resolution
// through the npm union accessor: "assertion failed: self.tag == Tag::Npm".
test("auto-install in a project whose package.json has a name and version", async () => {
  const requests: string[] = [];
  using registry = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("autoinstall-root-name-version", {
    "package.json": JSON.stringify({ name: "myapp", version: "1.0.0" }),
    "index.js": `import "pkg-that-does-not-exist-anywhere";\n`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The resolver must get as far as asking the (local) registry for the
  // missing package, then report it as missing instead of dying while
  // re-parsing the project's own package.json.
  expect(requests).toContain("/pkg-that-does-not-exist-anywhere");
  expect(stderr).toContain("Cannot find package 'pkg-that-does-not-exist-anywhere'");
  expect(exitCode).toBe(1);
});

// Serves test/cli/install/registry/packages: `/<name>` is the manifest and
// `/<name>/-/<file>.tgz` a tarball. Everything else is a 404. `requests` has
// the path of every request, in order, so a test can tell which version
// auto-install decided to download. `no-deps` has 1.0.0, 1.0.1, 1.1.0 and
// 2.0.0, with `latest` pointing at 2.0.0.
function fixtureRegistry() {
  const packages = join(import.meta.dir, "..", "install", "registry", "packages");
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      const tarball = pathname.match(/^\/([a-z\d-]+)\/-\/(\1-[a-z\d.-]+\.tgz)$/);
      if (tarball) return new Response(Bun.file(join(packages, tarball[1], tarball[2])));
      if (/^\/[a-z\d-]+$/.test(pathname)) {
        const manifest = Bun.file(join(packages, pathname.slice(1), "package.json"));
        if (await manifest.exists()) {
          const text = await manifest.text();
          return Response.json(JSON.parse(text.replaceAll("http://localhost:4873", `http://127.0.0.1:${server.port}`)));
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    requests,
    url: `http://127.0.0.1:${server.port}/`,
    bunfig: `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
    tarballs: () => requests.filter(p => p.endsWith(".tgz")),
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

const runAutoInstall = (cwd: string, ...args: string[]) => runAutoInstallWithEnv({}, cwd, ...args);

async function runAutoInstallWithEnv(env: Record<string, string>, cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const printNoDepsVersion = `console.log(require("no-deps").version);\n`;

// docs/runtime/auto-install.mdx: a bare import resolves to the version range the
// nearest package.json declares for it, and only falls back to `latest` when no
// package.json lists the package.
describe.concurrent("auto-install uses the version range from package.json", () => {
  test("bun <file> run from the project directory", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^1.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.1.0\n");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.1.0.tgz"]);
  });

  // `bun run <file>` reads the project directory while looking for a
  // package.json script before it boots the runtime; the cached result must
  // still carry the dependency ranges.
  test("bun run <file> run from the project directory", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-run", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^1.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "run", "index.js");
    expect(stdout).toBe("1.1.0\n");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.1.0.tgz"]);
  });

  test("project package.json in a directory below the cwd", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-nested", {
      "bunfig.toml": registry.bunfig,
      "app/package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^1.0.0" } }),
      "app/index.js": printNoDepsVersion,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "app/index.js");
    expect(stdout).toBe("1.1.0\n");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.1.0.tgz"]);
  });

  test("package.json without a name field", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-nameless", {
      "package.json": JSON.stringify({ dependencies: { "no-deps": "~1.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
  });

  // Ranges longer than 8 bytes are stored as offsets into the package.json
  // source rather than inline, so this also checks they are read back from the
  // right buffer.
  test("range longer than an inline semver string", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-long", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": ">=1.0.0 <1.1.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
  });

  test("a range nothing in the registry satisfies is an error, not latest", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-unsatisfiable", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^3.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find package 'no-deps'");
    expect(exitCode).toBe(1);
    expect(registry.requests).toContain("/no-deps");
    expect(registry.tarballs()).toEqual([]);
  });

  test("npm: alias installs the aliased package", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-alias", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "my-alias": "npm:no-deps@^1.0.0" } }),
      "index.js": `console.log(require("my-alias").version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.1.0\n");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-1.1.0.tgz"]);
  });

  test("a package the package.json does not list still resolves to latest", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-unlisted", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "something-else": "^1.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("2.0.0\n");
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-2.0.0.tgz"]);
  });

  // The first import adds package.json to the in-memory lockfile. Every later import of a
  // package it lists then got the version of its range, whatever version the import named.
  test.each([
    ["require()", `id => require(id).version`],
    ["import()", `async id => (await import(id)).default.version`],
    ["Bun.resolveSync()", `id => require(Bun.resolveSync(id, import.meta.dir)).version`],
  ])("a version written in the specifier of %s wins over the range", async (_, load) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-specifier", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^1.0.0" } }),
      "index.js": `
        const load = ${load};
        const versions = {};
        for (const id of ["no-deps@2.0.0", "no-deps", "no-deps@^2", "no-deps@latest", "no-deps@1.0.0", "no-deps@2.0.0/index.js"])
          versions[id] = await load(id);
        console.log(JSON.stringify(versions));
      `,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(JSON.parse(stdout)).toEqual({
      "no-deps@2.0.0": "2.0.0",
      "no-deps": "1.1.0",
      "no-deps@^2": "2.0.0",
      "no-deps@latest": "2.0.0",
      "no-deps@1.0.0": "1.0.0",
      "no-deps@2.0.0/index.js": "2.0.0",
    });
    expect(exitCode).toBe(0);
  });
});

// A check that read the wrong way round refused it: "VersionSpecifierNotAllowedHere".
test.concurrent.each([
  ["--install=force", ["--install=force"], ""],
  [`auto = "force" in bunfig.toml`, [], `auto = "force"\n`],
])("a version written in the specifier, below a package.json, with %s", async (_, flags, bunfig) => {
  using registry = fixtureRegistry();
  using dir = tempDir("autoinstall-force-specifier", {
    "package.json": JSON.stringify({ name: "app" }),
    "index.js": `console.log(require("no-deps@1.0.1").version);\n`,
    "bunfig.toml": registry.bunfig + bunfig,
  });

  const { stdout, exitCode } = await runAutoInstall(String(dir), ...flags, "index.js");
  expect(stdout).toBe("1.0.1\n");
  expect(exitCode).toBe(0);
});

// docs/runtime/auto-install.mdx: the lockfile in the project root comes before the ranges of
// package.json. bun.lock was not read at all, and a package of bun.lockb that was not in the
// cache yet failed with "FileNotFound while resolving package".
describe.concurrent("auto-install uses the versions of the lockfile", () => {
  const lockfile = (dependencies: Record<string, string>) =>
    JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "app", dependencies } },
      packages: {
        "no-deps": ["no-deps@1.0.1", "", {}, ""],
        "one-range-dep": ["one-range-dep@1.0.0", "", { dependencies: { "no-deps": "^1.0.0" } }, ""],
      },
    });

  test("bun.lock, for a dependency of the project", async () => {
    using registry = fixtureRegistry();
    const dependencies = { "no-deps": "^1.0.0" };
    using dir = tempDir("autoinstall-lockfile", {
      "package.json": JSON.stringify({ name: "app", dependencies }),
      "bun.lock": lockfile(dependencies),
      "index.js": `console.log(require("no-deps").version, require("no-deps@2.0.0").version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1 2.0.0\n");
    // The locked version needs no manifest.
    expect(registry.requests).toEqual(["/no-deps/-/no-deps-1.0.1.tgz", "/no-deps", "/no-deps/-/no-deps-2.0.0.tgz"]);
    expect(exitCode).toBe(0);
  });

  test("bun.lock, for a dependency of a package", async () => {
    using registry = fixtureRegistry();
    const dependencies = { "one-range-dep": "^1.0.0" };
    using dir = tempDir("autoinstall-lockfile-transitive", {
      "package.json": JSON.stringify({ name: "app", dependencies }),
      "bun.lock": lockfile(dependencies),
      // The index.js of one-range-dep exports its package.json, with each
      // dependency replaced by what `require` gives for it.
      "index.js": `console.log(require("one-range-dep").dependencies["no-deps"].version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(registry.requests).toEqual(["/one-range-dep/-/one-range-dep-1.0.0.tgz", "/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  // `bun install` resolves such a range to the patched version too.
  test("bun.lock, for a range that is not locked and admits a patched version", async () => {
    using registry = fixtureRegistry();
    const patchedDependencies = { "no-deps@1.0.1": "no-deps.patch" };
    using dir = tempDir("autoinstall-lockfile-patched", {
      "package.json": JSON.stringify({ name: "app", patchedDependencies }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "app" } },
        patchedDependencies,
        packages: {},
      }),
      "no-deps.patch":
        "diff --git a/extra.js b/extra.js\nnew file mode 100644\nindex 0000000..7898192\n--- /dev/null\n+++ b/extra.js\n@@ -0,0 +1 @@\n+a\n",
      "index.js": `console.log(require("no-deps@^1.0.0").version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  test("bun.lockb", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-lockb", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.1" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig + "saveTextLockfile = false\n",
    });
    expect((await runAutoInstall(String(dir), "install", "--lockfile-only")).exitCode).toBe(0);
    expect(existsSync(join(String(dir), "bun.lockb"))).toBe(true);

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["a folder of the project", "app/src", "index.js"],
    ["outside the project", "elsewhere", "../app/src/index.js"],
  ])("bun.lock of the project root, run from %s", async (_, cwd, file) => {
    using registry = fixtureRegistry();
    const dependencies = { "no-deps": "^1.0.0" };
    using dir = tempDir("autoinstall-lockfile-root", {
      "app/package.json": JSON.stringify({ name: "app", dependencies }),
      "app/bun.lock": lockfile(dependencies),
      "app/src/package.json": JSON.stringify({ type: "commonjs" }),
      "app/src/index.js": printNoDepsVersion,
      "elsewhere/.keep": "",
    });

    const env = { BUN_CONFIG_REGISTRY: registry.url };
    const { stdout, exitCode } = await runAutoInstallWithEnv(env, join(String(dir), cwd), file);
    expect(stdout).toBe("1.0.1\n");
    expect(registry.requests).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  // packages/app, below a folder with `parent` as its package.json and a bun.lock that pins no-deps 1.0.1.
  const app = { name: "app", dependencies: { "no-deps": "^1.0.0" } };
  const belowLockfile = (parent: object, bunfig: string) => ({
    "package.json": JSON.stringify({ name: "root", ...parent }),
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "root" }, "packages/app": app },
      packages: {
        "app": ["app@workspace:packages/app"],
        "no-deps": ["no-deps@1.0.1", "", {}, ""],
      },
    }),
    "packages/app/package.json": JSON.stringify(app),
    "packages/app/index.js": printNoDepsVersion,
    "packages/app/bunfig.toml": bunfig,
  });

  test("bun.lock of the workspace root, run from inside a member", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-lockfile-member", belowLockfile({ workspaces: ["packages/*"] }, registry.bunfig));

    const { stdout, exitCode } = await runAutoInstall(join(String(dir), "packages", "app"), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(registry.requests).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  // A lockfile says where the tarballs come from: only the project's own is read.
  test.each([
    ["has other folders as its workspaces", { workspaces: ["other/*"] }],
    ["has no workspaces", {}],
  ])("not the bun.lock of a parent folder that %s", async (_, parent) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-lockfile-parent", belowLockfile(parent, registry.bunfig));

    const { stdout, exitCode } = await runAutoInstall(join(String(dir), "packages", "app"), "index.js");
    expect(stdout).toBe("1.1.0\n");
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-1.1.0.tgz"]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("auto-install reads every dependency group of the project's package.json", () => {
  // other.js resolves after package.json became the root of the in-memory lockfile.
  test.each(["devDependencies", "peerDependencies"])("%s", async group => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-group", {
      "package.json": JSON.stringify({ name: "app", [group]: { "no-deps": "1.0.1" } }),
      "index.js": `console.log(require("no-deps").version, require("./lib/other.js"));\n`,
      "lib/other.js": `module.exports = require("no-deps").version;\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1 1.0.1\n");
    expect(registry.tarballs()).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  test("a name in two groups: optional, dev, dependencies, then peer, as in an install", async () => {
    using registry = fixtureRegistry();
    const project = (groups: Record<string, string>) =>
      JSON.stringify(Object.fromEntries(Object.entries(groups).map(([group, v]) => [group, { "no-deps": v }])));
    using dir = tempDir("autoinstall-group-order", {
      "index.js": `console.log(require("./a"), require("./b"), require("./c"));\n`,
      "a/package.json": project({ devDependencies: "1.0.1", dependencies: "1.0.0" }),
      "b/package.json": project({ optionalDependencies: "1.1.0", devDependencies: "1.0.1" }),
      "c/package.json": project({ dependencies: "1.0.0", peerDependencies: "1.0.1" }),
      "a/index.js": `module.exports = require("no-deps").version;\n`,
      "b/index.js": `module.exports = require("no-deps").version;\n`,
      "c/index.js": `module.exports = require("no-deps").version;\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1 1.1.0 1.0.0\n");
    expect(exitCode).toBe(0);
  });

  test("a package.json further up lists a dependency that the nearest one doesn't", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-group-up", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        devDependencies: { "no-deps": "1.0.1" },
      }),
      "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { "left-pad": "1.0.0" } }),
      "packages/app/index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "packages/app/index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(exitCode).toBe(0);
  });

  test("not the devDependencies of a package in node_modules", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-group-installed", {
      "index.js": `console.log(require("installed"));\n`,
      "node_modules/installed/package.json": JSON.stringify({
        name: "installed",
        version: "1.0.0",
        dependencies: { "left-pad": "1.0.0" },
        devDependencies: { "no-deps": "1.0.1" },
      }),
      "node_modules/installed/index.js": `module.exports = require("no-deps").version;\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "--install=fallback", "index.js");
    expect(stdout).toBe("2.0.0\n");
    expect(exitCode).toBe(0);
  });

  test.each([
    ["dependencies", `"dependencies": { "no-deps": "1.0.1" }`],
    [
      "optionalDependencies over dependencies",
      `"optionalDependencies": { "no-deps": "1.0.1" }, "dependencies": { "no-deps": "1.0.0" }`,
    ],
    ["the last of two rows", `"dependencies": { "no-deps": "1.0.0", "left-pad": "1.0.0", "no-deps": "1.0.1" }`],
    ["a row that is a string", `"optionalDependencies": { "no-deps": 1 }, "dependencies": { "no-deps": "1.0.1" }`],
    ["a name and a version with JSON escapes", `"dependencies": { "no\\u002ddeps": "1.0\\u002e1" }`],
  ])("of a package in node_modules: %s", async (_, groups) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-group-installed-rows", {
      "index.js": `console.log(require("installed"));\n`,
      "node_modules/installed/package.json": `{ "name": "installed", "version": "1.0.0", ${groups} }`,
      "node_modules/installed/index.js": `module.exports = require("no-deps").version;\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "--install=fallback", "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(exitCode).toBe(0);
  });

  // Nothing is auto-installed here, so the packages' own dependencies are never read.
  test("the dependencies of packages that load from node_modules take no memory", async () => {
    const range = "^1.2.3 || ^2.0.0 || >=3.1.0 <4.0.0-beta.1 || ~5.6.7";
    const dependencies = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`dep-number-${i}`, range]));
    const names = Array.from({ length: 200 }, (_, i) => `p${i}`);
    using dir = tempDir("autoinstall-installed-memory", {
      "package.json": JSON.stringify({ name: "app" }),
      "index.js": names.map(name => `require("${name}");\n`).join("") + `console.log("ok");\n`,
      node_modules: Object.fromEntries(
        names.map(name => [
          name,
          { "package.json": JSON.stringify({ name, version: "1.0.0", dependencies }), "index.js": "" },
        ]),
      ),
    });
    const peak = async (...flags: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...flags, "index.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
      return proc.resourceUsage()!.maxRSS;
    };

    const without = await peak("--no-install");
    // 80,000 parsed ranges are 70 MB in a release build.
    const limit = (isASAN || isDebug ? 32 : 10) * 1024 * 1024;
    expect((await peak()) - without).toBeLessThan(limit);
    expect((await peak("-i")) - without).toBeLessThan(limit);
  });

  // A peer waited for a second pass that auto-install does not have: "Cannot find module 'no-deps'".
  test("the peerDependencies of an auto-installed package", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-group-package-peer", {
      // The index.js of peer-deps-fixed exports its package.json, with each
      // dependency replaced by what `require` gives for it. Its peer is no-deps@^1.0.0.
      "index.js": `console.log(require("peer-deps-fixed").peerDependencies["no-deps"].version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.1.0\n");
    expect(exitCode).toBe(0);
  });

  test("a peer of an auto-installed package is the version the project names", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-group-package-peer-pin", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.1", "peer-deps-fixed": "1.0.0" } }),
      "index.js": `console.log(require("peer-deps-fixed").peerDependencies["no-deps"].version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(registry.tarballs()).not.toContain("/no-deps/-/no-deps-1.1.0.tgz");
    expect(exitCode).toBe(0);
  });
});

// Only the names and ranges of the dependencies were taken from the project's package.json.
describe.concurrent("auto-install reads the project's package.json as `bun install` does", () => {
  // one-range-dep depends on no-deps@^1.0.0, and its index.js exports its package.json
  // with each dependency replaced by what `require` gives for it.
  test.each(["overrides", "resolutions"])("%s", async field => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-overrides", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "one-range-dep": "1.0.0" },
        [field]: { "no-deps": "1.0.1" },
      }),
      "index.js": `console.log(require("one-range-dep").dependencies["no-deps"].version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(registry.tarballs().sort()).toEqual([
      "/no-deps/-/no-deps-1.0.1.tgz",
      "/one-range-dep/-/one-range-dep-1.0.0.tgz",
    ]);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["catalog:", { catalog: { "no-deps": "1.0.1" } }],
    ["catalog:old", { catalogs: { old: { "no-deps": "1.0.1" } } }],
  ])("%s", async (spec, catalogs) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-catalog", {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: { packages: [], ...catalogs },
        dependencies: { "no-deps": spec },
      }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(exitCode).toBe(0);
  });

  // The registry has a no-deps too, up to 2.0.0.
  const local = {
    "local/package.json": JSON.stringify({ name: "no-deps", version: "7.0.0", exports: { ".": "./main.js" } }),
    "local/main.js": `module.exports = { version: "7.0.0 in ./local" };\n`,
  };

  test.each([
    ["workspace:*", { workspaces: ["local"], dependencies: { "no-deps": "workspace:*" } }],
    ["a range that the version of a member satisfies", { workspaces: ["loc*"], dependencies: { "no-deps": "^7.0.0" } }],
    ["a member that is not listed", { workspaces: ["local"] }],
    ["file:", { dependencies: { "no-deps": "file:./local" } }],
    ["link:", { dependencies: { "no-deps": "link:./local" } }],
  ])("%s is the folder on disk", async (_, packageJson) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-local-folder", {
      ...local,
      "package.json": JSON.stringify({ name: "app", ...packageJson }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("7.0.0 in ./local\n");
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(0);
  });

  // The registry's copy is loaded, as without the rule.
  describe.each(["overrides", "resolutions"])("%s with file: is ignored", field => {
    const files = (bunfig: string) => ({
      ...local,
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "one-range-dep": "1.0.0" },
        [field]: { "no-deps": "file:./local" },
      }),
      "src/index.js": `console.log(require("one-range-dep").dependencies["no-deps"].version);\n`,
      "bunfig.toml": bunfig,
    });

    test.each([
      ["the project root", ".", "src/index.js"],
      ["a folder of the project", "src", "index.js"],
    ])("started in %s", async (_, cwd, file) => {
      using registry = fixtureRegistry();
      using dir = tempDir("autoinstall-override-folder", files(registry.bunfig));

      const { stdout, exitCode } = await runAutoInstall(join(String(dir), cwd), file);
      expect(stdout).toBe("1.1.0\n");
      expect(exitCode).toBe(0);
    });

    test("with the bun.lock that bun install writes", async () => {
      using registry = fixtureRegistry();
      using dir = tempDir("autoinstall-override-folder-lock", files(registry.bunfig));
      expect((await runAutoInstall(String(dir), "install", "--lockfile-only")).exitCode).toBe(0);

      const { stdout, exitCode } = await runAutoInstall(String(dir), "src/index.js");
      expect(stdout).toBe("1.1.0\n");
      expect(exitCode).toBe(0);
    });
  });

  test("overrides with link: is ignored", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-override-link", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps": "link:no-deps" },
      }),
      "index.js": `console.log(require("one-range-dep").dependencies["no-deps"].version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.1.0\n");
    expect(exitCode).toBe(0);
  });

  const app = { name: "app", dependencies: { "no-deps": "workspace:*" } };
  test.each([
    ["without a lockfile", {}],
    [
      "with the bun.lock of the root",
      {
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: { "": { name: "root" }, "local": { name: "no-deps", version: "7.0.0" }, "packages/app": app },
          packages: { "app": ["app@workspace:packages/app"], "no-deps": ["no-deps@workspace:local"] },
        }),
      },
    ],
  ])("workspace:*, run from inside another member, %s", async (_, lockfile) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-local-member", {
      ...local,
      ...lockfile,
      "package.json": JSON.stringify({ name: "root", workspaces: ["local", "packages/*"] }),
      "packages/app/package.json": JSON.stringify(app),
      "packages/app/index.js": printNoDepsVersion,
      "packages/app/bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(join(String(dir), "packages", "app"), "index.js");
    expect(stdout).toBe("7.0.0 in ./local\n");
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(0);
  });

  const tarball = readFileSync(
    join(import.meta.dir, "..", "install", "registry", "packages", "no-deps", "no-deps-1.0.1.tgz"),
  );

  // The paths start at the package.json that has them, wherever bun was started.
  test.each([
    ["a folder", "file:./local", "7.0.0 in ./local\n"],
    ["a tarball", "file:./no-deps.tgz", "1.0.1\n"],
  ])("file: with %s, in a package.json below the cwd", async (_, spec, expected) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-local-below", {
      "bunfig.toml": registry.bunfig,
      app: {
        ...local,
        "no-deps.tgz": tarball,
        "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": spec } }),
        "index.js": printNoDepsVersion,
      },
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "app/index.js");
    expect(stdout).toBe(expected);
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("the URL of a tarball", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-remote-tarball", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "no-deps": registry.bunfig.match(/http[^"]+/)![0] + "no-deps/-/no-deps-1.0.1.tgz" },
      }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(registry.requests).toEqual(["/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  test("a package in node_modules cannot name a folder of the project", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-local-installed", {
      ...local,
      "index.js": `console.log(require("installed"));\n`,
      "node_modules/installed/package.json": JSON.stringify({
        name: "installed",
        version: "1.0.0",
        dependencies: { "no-deps": "file:../../local" },
      }),
      "node_modules/installed/index.js": `try {\n  module.exports = require("no-deps").version;\n} catch (e) {\n  module.exports = e.code;\n}\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "--install=fallback", "index.js");
    expect(stdout).toBe("MODULE_NOT_FOUND\n");
    expect(exitCode).toBe(0);
  });

  test("a folder that does not exist is named in the error", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-local-missing", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "file:./nowhere" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stderr, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(noteLines(stderr)).toEqual([
      `note: "no-deps@file:./nowhere": folder "${join(String(dir), "nowhere")}" does not exist`,
    ]);
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

// A part of a dependency version that is longer than 8 bytes (the name an
// alias points at, a git URL, a pre-release tag) is stored as an offset into
// the package.json source. The resolver computed those offsets from the start
// of the version string, and some readers took them as offsets into the
// lockfile's strings: bytes of package.json went to the registry as a name.
describe.concurrent("auto-install reads a package.json dependency version from the buffer it was parsed in", () => {
  // A name of up to 8 bytes is stored inline, a longer name is an offset.
  // Both fixtures have an index.js that exports the package.json next to it.
  test.each(["no-deps@1.0.1", "is-number@1.0.0"])("npm: alias of %s", async target => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-alias", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "my-alias": `npm:${target}` } }),
      "index.js": `const { name, version } = require("my-alias");\nconsole.log(name + "@" + version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe(target + "\n");
    // For is-number the lookup was `/me%22:%22app%22`, bytes 4 to 12 of the package.json.
    const [name, version] = target.split("@");
    expect(registry.requests).toEqual([`/${name}`, `/${name}/-/${name}-${version}.tgz`]);
    expect(exitCode).toBe(0);
  });

  // A string with a JSON escape is decoded outside the source, so offsets into the source can't
  // point at it. These dependencies used to be dropped, and the import fell back to `latest`.
  test.each([
    ["version", String.raw`"my-alias":"npm:is-number@\u0031.0.0"`],
    ["name", String.raw`"my-\u0061lias":"npm:is-number@1.0.0"`],
    ["name and version", String.raw`"my\u002dalias":"npm:is-number\u00401.0.0"`],
  ])("JSON escape in a dependency %s", async (_, dependency) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-escaped", {
      // left-pad has no escape, but it shares the buffer with the one that does.
      "package.json": `{"name":"app","dependencies":{"left-pad":"npm:no-deps@1.0.1",${dependency}}}`,
      "index.js": `for (const id of ["my-alias", "left-pad"]) {\n  const { name, version } = require(id);\n  console.log(name + "@" + version);\n}\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("is-number@1.0.0\nno-deps@1.0.1\n");
    expect(registry.requests.toSorted()).toEqual([
      "/is-number",
      "/is-number/-/is-number-1.0.0.tgz",
      "/no-deps",
      "/no-deps/-/no-deps-1.0.1.tgz",
    ]);
    expect(exitCode).toBe(0);
  });

  // The first bare import creates the package manager. A package.json that is
  // read after that is parsed through it, and it records the aliases it sees.
  // So the tests below import another package first and declare their
  // dependencies in a directory that is read later.

  // one-range-dep depends on no-deps@^1.0.0. The alias of sub/ has that name
  // and a version in that range, so one-range-dep gets the target of the alias,
  // as it does from `bun install`. The alias was recorded with offsets into
  // sub/package.json and read with the lockfile's strings: bun asked for
  // `/:%2f%2f127.0.`. A target name of up to 8 bytes is inline and has no offset.
  test.each(["left-pad@1.0.0", "is-number@1.0.0"])(
    "npm: alias of %s under the name of a package that another package depends on",
    async target => {
      using registry = fixtureRegistry();
      const [name, version] = target.split("@");
      const first = name === "left-pad" ? "is-number" : "left-pad";
      using dir = tempDir("autoinstall-alias-key", {
        "package.json": JSON.stringify({ name: "root" }),
        "index.js": `require("${first}");\nrequire("./sub/index.js");\n`,
        "sub/package.json": JSON.stringify({ name: "sub", dependencies: { "no-deps": `npm:${target}` } }),
        // The index.js of one-range-dep exports its package.json, with each
        // dependency replaced by what `require` gives for it.
        "sub/index.js": `const dep = require("one-range-dep").dependencies["no-deps"];\nconsole.log(dep.name + "@" + dep.version);\n`,
        "bunfig.toml": registry.bunfig,
      });

      const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
      expect(stdout).toBe(target + "\n");
      expect(registry.requests.filter(path => !path.startsWith(`/${first}`)).toSorted()).toEqual([
        `/${name}`,
        `/${name}/-/${name}-${version}.tgz`,
        "/one-range-dep",
        "/one-range-dep/-/one-range-dep-1.0.0.tgz",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  // The same alias, but in a package from the registry: it is for that package's own dependency.
  test("npm: alias of a package from the registry under the name of a package that another one depends on", async () => {
    using registry = fixtureRegistry();
    const manifest = { name: "carrier", version: "1.0.0", dependencies: { "no-deps": "npm:left-pad@1.0.0" } };
    const tarball = await new Bun.Archive({
      "package/package.json": JSON.stringify(manifest),
      "package/index.js": "",
    }).bytes("gzip");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/carrier/-/carrier-1.0.0.tgz") return new Response(tarball);
        if (pathname !== "/carrier") return fetch(new URL(pathname, registry.url));
        const dist = { tarball: `${server.url}carrier/-/carrier-1.0.0.tgz` };
        return Response.json({
          name: "carrier",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { ...manifest, dist } },
        });
      },
    });
    using dir = tempDir("autoinstall-alias-of-a-package", {
      "index.js": `require("carrier");\nconst dep = require("one-range-dep").dependencies["no-deps"];\nconsole.log(dep.name + "@" + dep.version);\n`,
      "bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("no-deps@1.1.0\n");
    expect(exitCode).toBe(0);
  });

  // A package's own `version` is not a dependency: `npm:` in it names no alias.
  test("a package.json whose own version is an npm: specifier records no alias", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-alias-own-version", {
      "package.json": JSON.stringify({ name: "root" }),
      "index.js": `require("left-pad");\nrequire("./sub/index.js");\n`,
      "sub/package.json": JSON.stringify({ name: "no-deps", version: "npm:is-number@1.0.0" }),
      "sub/index.js": `const dep = require("one-range-dep").dependencies["no-deps"];\nconsole.log(dep.name + "@" + dep.version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("no-deps@1.1.0\n");
    expect(exitCode).toBe(0);
  });

  // No version of prereleases-3 is in the range of b/. The check for a match
  // among the installed packages compared the tag of the range with the
  // lockfile's strings, and took the 5.0.0-alpha.150 of a/ for one.
  test("pre-release tag of a range", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-prerelease-tag", {
      "package.json": JSON.stringify({ name: "root" }),
      "index.js": `require("left-pad");\nrequire("./a/index.js");\nrequire("./b/index.js");\n`,
      "a/package.json": JSON.stringify({ name: "a", dependencies: { "prereleases-3": "5.0.0-alpha.150" } }),
      "a/index.js": `console.log("a " + require("prereleases-3/package.json").version);\n`,
      "b/package.json": JSON.stringify({ name: "b", dependencies: { "prereleases-3": ">=5.0.0-alpha.154" } }),
      "b/index.js": `try {\n  console.log("b " + require("prereleases-3/package.json").version);\n} catch (e) {\n  console.log("b " + e.code);\n}\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runAutoInstall(String(dir), "index.js");
    expect(stdout).toBe("a 5.0.0-alpha.150\nb MODULE_NOT_FOUND\n");
    expect(exitCode).toBe(0);
  });
});

// A registry that has a manifest for `name` whose only version points at a
// tarball the registry then answers with a 404. Every other path is a 404 too.
function registryWithMissingTarball(name: string) {
  const requests: string[] = [];
  const tarballPath = `/${name}/-/${name}-1.0.0.tgz`;
  const registry = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      if (pathname !== `/${name}`) return new Response("not found", { status: 404 });
      return Response.json({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball: `${origin}${tarballPath}` } } },
      });
    },
  });
  const origin = `http://127.0.0.1:${registry.port}`;
  return {
    requests,
    origin,
    tarballPath,
    tarballUrl: `${origin}${tarballPath}`,
    [Symbol.dispose]() {
      registry.stop(true);
    },
  };
}

async function runWithRegistry(registryOrigin: string, entry: string, source: string, installOptions = "") {
  using dir = tempDir("autoinstall-error-report", {
    [entry]: source,
    "bunfig.toml": `[install]\nregistry = "${registryOrigin}/"\n${installOptions}`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// While auto-installing, the package manager writes the reason a package could
// not be installed (the tarball GET and its status, a network error name, ...)
// into the log of the resolve that triggered it. Those lines are attached to
// the ResolveMessage as notes; without them the only output is
// "<error name> while resolving package '...'".
describe.concurrent("auto-install reports why a package could not be installed", () => {
  test("tarball 404, static import", async () => {
    const name = "pkg-whose-tarball-is-missing";
    using r = registryWithMissingTarball(name);
    const { stderr, exitCode } = await runWithRegistry(r.origin, "index.js", `import "${name}";\n`);

    expect(r.requests).toEqual([`/${name}`, r.tarballPath]);
    expect(stderr).toContain(`note: GET ${r.tarballUrl} - 404`);
    expect(exitCode).toBe(1);
  });

  test("tarball 404, require()", async () => {
    const name = "pkg-whose-tarball-is-missing-cjs";
    using r = registryWithMissingTarball(name);
    const { stderr, exitCode } = await runWithRegistry(r.origin, "index.cjs", `require("${name}");\n`);

    expect(r.requests).toEqual([`/${name}`, r.tarballPath]);
    expect(stderr).toContain(`note: GET ${r.tarballUrl} - 404`);
    expect(exitCode).toBe(1);
  });

  test("tarball 404, dynamic import() caught and logged by the script", async () => {
    const name = "pkg-whose-tarball-is-missing-dynamic";
    using r = registryWithMissingTarball(name);
    const { stdout, stderr, exitCode } = await runWithRegistry(
      r.origin,
      "index.js",
      `try {\n  await import("${name}");\n} catch (err) {\n  console.log(err);\n}\n`,
    );

    expect(r.requests).toEqual([`/${name}`, r.tarballPath]);
    expect(stdout).toContain(`package '${name}'`);
    expect(stdout).toContain(`note: GET ${r.tarballUrl} - 404`);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("manifest 404", async () => {
    const name = "pkg-whose-manifest-is-missing";
    using r = registryWithMissingTarball("some-other-package");
    const { stderr, exitCode } = await runWithRegistry(r.origin, "index.js", `import "${name}";\n`);

    // A resolve that misses runs the resolver a second time, which does not ask again.
    expect(r.requests).toEqual([`/${name}`]);
    expect(stderr).toContain(`error: Cannot find package '${name}'`);
    expect(stderr).toContain(`note: GET ${r.origin}/${name} - 404`);
    expect(exitCode).toBe(1);
  });
});

// A registry whose every package has exactly one version, 1.0.0, published now.
// `pkg-with-bad-tarball-url` exists too, but its manifest does not say where
// the tarball is.
function registryWithOneFreshVersion() {
  const registry = Bun.serve({
    port: 0,
    fetch(req) {
      const name = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const tarball = name === "pkg-with-bad-tarball-url" ? "not a url" : `http://127.0.0.1:1/${name}-1.0.0.tgz`;
      return Response.json({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball } } },
        time: { "1.0.0": new Date().toISOString() },
      });
    },
  });
  return {
    origin: `http://127.0.0.1:${registry.port}`,
    [Symbol.dispose]() {
      registry.stop(true);
    },
  };
}

function noteLines(stderr: string) {
  return stderr.split("\n").filter(line => line.startsWith("note: "));
}

// The manifest exists but nothing in it satisfies the request. These failures
// belong to the dependency auto-install enqueues on the root, whose errors used
// to go to a callback that never reported them, so they printed a bare
// "Cannot find package". Each one now prints the same line `bun install` does,
// exactly once: the runtime retries a failed resolve after busting its
// directory cache, and the retry reports the same failure again.
describe.concurrent("auto-install reports why a package could not be resolved", () => {
  test("version the registry does not have", async () => {
    using r = registryWithOneFreshVersion();
    const { stderr, exitCode } = await runWithRegistry(r.origin, "index.js", `import "pkg-without-v2@2.0.0";\n`);

    expect(stderr).toContain("error: Cannot find package 'pkg-without-v2@2.0.0'");
    expect(noteLines(stderr)).toEqual([
      'note: No version matching "2.0.0" found for specifier "pkg-without-v2" (but package exists)',
    ]);
    expect(exitCode).toBe(1);
  });

  test("version the registry does not have, require()", async () => {
    using r = registryWithOneFreshVersion();
    const { stderr, exitCode } = await runWithRegistry(r.origin, "index.cjs", `require("pkg-without-v2@2.0.0");\n`);

    expect(stderr).toContain("error: Cannot find package 'pkg-without-v2@2.0.0'");
    expect(noteLines(stderr)).toEqual([
      'note: No version matching "2.0.0" found for specifier "pkg-without-v2" (but package exists)',
    ]);
    expect(exitCode).toBe(1);
  });

  test("dist-tag the registry does not have", async () => {
    using r = registryWithOneFreshVersion();
    const { stderr, exitCode } = await runWithRegistry(r.origin, "index.js", `import "pkg-without-canary@canary";\n`);

    expect(stderr).toContain("error: Cannot find package 'pkg-without-canary@canary'");
    expect(noteLines(stderr)).toEqual([
      'note: Package "pkg-without-canary" with tag "canary" not found, but package exists',
    ]);
    expect(exitCode).toBe(1);
  });

  test("version blocked by minimumReleaseAge", async () => {
    using r = registryWithOneFreshVersion();
    const { stderr, exitCode } = await runWithRegistry(
      r.origin,
      "index.js",
      `import "pkg-published-today@1.0.0";\n`,
      "minimumReleaseAge = 86400\n",
    );

    expect(stderr).toContain("error: Cannot find package 'pkg-published-today@1.0.0'");
    expect(noteLines(stderr)).toEqual([
      expect.stringMatching(
        /^note: No version matching "[^"]+" found for specifier "[^"]+" \(blocked by minimum-release-age: 86400 seconds\)$/,
      ),
    ]);
    expect(exitCode).toBe(1);
  });

  test("dist-tag whose versions are all blocked by minimumReleaseAge", async () => {
    using r = registryWithOneFreshVersion();
    const { stderr, exitCode } = await runWithRegistry(
      r.origin,
      "index.js",
      `import "pkg-published-today";\n`,
      "minimumReleaseAge = 86400\n",
    );

    expect(stderr).toContain("error: Cannot find package 'pkg-published-today'");
    expect(noteLines(stderr)).toEqual([
      'note: Package "pkg-published-today" with tag "latest" not found (all versions blocked by minimum-release-age: 86400 seconds)',
    ]);
    expect(exitCode).toBe(1);
  });

  // Any other error ends up named after its error code, like the
  // "'main' returned error.InvalidURL" line `bun install` prints after the
  // specific message.
  test("error without a dedicated message", async () => {
    using r = registryWithOneFreshVersion();
    const { stderr, exitCode } = await runWithRegistry(r.origin, "index.js", `import "pkg-with-bad-tarball-url";\n`);

    expect(stderr).toContain("error: Cannot find package 'pkg-with-bad-tarball-url' from");
    expect(noteLines(stderr)).toEqual([
      'note: Expected tarball URL to start with https:// or http://, got "not a url" while fetching package "pkg-with-bad-tarball-url"',
      'note: InvalidURL while resolving package "pkg-with-bad-tarball-url"',
    ]);
    expect(exitCode).toBe(1);
  });
});

// The usual guard around an optional package: try it, go on without it.
const optionalPackageGuards = Object.entries({
  "require()": `require("NAME")`,
  "import()": `await import("NAME")`,
  "Bun.resolveSync()": `Bun.resolveSync("NAME", import.meta.dir)`,
}).map(([door, load]) => [
  door,
  (name: string) =>
    `try {\n  ${load.replace("NAME", name)};\n  console.log("loaded");\n} catch (e) {\n  console.log(e);\n}\nconsole.log("the program goes on");\n`,
]) as [string, (name: string) => string][];

// `bun install` prints these and exits. In a running program they belong to the
// import that asked for the package.
describe.concurrent("auto-install throws when it can't do something instead of exiting the process", () => {
  test.each(optionalPackageGuards)("no directory to extract into, %s", async (_, guard) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-no-tmpdir", {
      "index.js": guard("no-deps"),
      "bunfig.toml": registry.bunfig,
      // Files where the two candidates for the temporary directory would be.
      "tmp": "",
      ".bun-cache/.tmp": "",
    });
    const env = { BUN_TMPDIR: join(String(dir), "tmp") };
    const { stdout, stderr, exitCode } = await runAutoInstallWithEnv(env, String(dir), "index.js");

    expect(stderr).toBe("");
    expect(stdout).toContain("error: Cannot find package 'no-deps' from");
    expect(stdout).toMatch(/^note: cannot access tempdir: E[A-Z]+$/m);
    expect(stdout).toEndWith("the program goes on\n");
    expect(registry.tarballs()).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("no directory to extract into, reported again by an import in a later turn of the event loop", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-no-tmpdir-again", {
      "index.js": `
        for (let i = 0; i < 3; i++) {
          try {
            require("no-deps");
          } catch (e) {
            console.log(Bun.inspect(e).split("\\n").filter(line => line.startsWith("note: cannot ")).length);
          }
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      `,
      "bunfig.toml": registry.bunfig,
      "tmp": "",
      ".bun-cache/.tmp": "",
    });
    const env = { BUN_TMPDIR: join(String(dir), "tmp") };
    const { stdout, stderr, exitCode } = await runAutoInstallWithEnv(env, String(dir), "index.js");

    expect(stderr).toBe("");
    expect(stdout).toBe("1\n1\n1\n");
    expect(exitCode).toBe(0);
  });

  test.each(optionalPackageGuards)("no directory for the cache, %s", async (_, guard) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-no-cache-dir", {
      "index.js": guard("no-deps"),
      "bunfig.toml": registry.bunfig,
      // Files where the cache directory and its fallback, node_modules/.cache, would be.
      ".bun-cache": "",
      "node_modules": "",
    });
    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");

    expect(stderr).toBe("");
    expect(stdout).toContain("error: Cannot find package 'no-deps' from");
    expect(stdout).toMatch(/^note: cannot write files: E[A-Z]+$/m);
    expect(stdout).toEndWith("the program goes on\n");
    expect(exitCode).toBe(0);
  });

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  describe.serial.skipIf(isWindows)("a cache directory that is read-only", () => {
    async function run(dir: string) {
      using unprivileged = unprivilegedSpawnOptions(dir);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        cwd: dir,
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"), BUN_TMPDIR: join(dir, "tmp") },
        stdout: "pipe",
        stderr: "pipe",
        ...unprivileged,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test("and doesn't have the package", async () => {
      using registry = fixtureRegistry();
      using dir = tempDir("autoinstall-read-only-cache", {
        "index.js": optionalPackageGuards[0][1]("no-deps"),
        "bunfig.toml": registry.bunfig,
        "tmp/.keep": "",
        ".bun-cache/.keep": "",
      });
      const cache = join(String(dir), ".bun-cache");
      chmodSync(cache, 0o555);
      try {
        const { stdout, stderr, exitCode } = await run(String(dir));

        expect(stderr).toBe("");
        expect(stdout).toContain("error: Cannot find package 'no-deps' from");
        expect(stdout).toContain(`note: cannot write files to cache directory "${cache}": EACCES\n`);
        expect(stdout).toEndWith("the program goes on\n");
        expect(exitCode).toBe(0);
      } finally {
        chmodSync(cache, 0o755);
      }
    });

    test("and has the package, but not its manifest", async () => {
      using registry = fixtureRegistry();
      using dir = tempDir("autoinstall-read-only-cache-warm", {
        "index.js": optionalPackageGuards[0][1]("no-deps"),
        "bunfig.toml": registry.bunfig,
        "tmp/.keep": "",
        ".bun-cache/.keep": "",
      });
      const cache = join(String(dir), ".bun-cache");
      expect(await run(String(dir))).toEqual({ stdout: "loaded\nthe program goes on\n", stderr: "", exitCode: 0 });
      for (const name of readdirSync(cache)) {
        if (name.endsWith(".npm")) rmSync(join(cache, name));
      }
      chmodSync(cache, 0o555);
      try {
        expect(await run(String(dir))).toEqual({ stdout: "loaded\nthe program goes on\n", stderr: "", exitCode: 0 });
        expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz", "/no-deps"]);
      } finally {
        chmodSync(cache, 0o755);
      }
    });
  });

  test("no directory for linked packages", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-no-global-dir", {
      "index.js": optionalPackageGuards[0][1]("lib"),
      "package.json": JSON.stringify({ dependencies: { lib: "link:lib" } }),
      "bunfig.toml": registry.bunfig,
      "global": "",
    });
    const env = { BUN_INSTALL_GLOBAL_DIR: join(String(dir), "global") };
    const { stdout, stderr, exitCode } = await runAutoInstallWithEnv(env, String(dir), "index.js");

    expect(stderr).toBe("");
    expect(stdout).toContain("error: Cannot find package 'lib' from");
    expect(stdout).toMatch(/^note: \w+: failed to open global directory$/m);
    expect(stdout).toEndWith("the program goes on\n");
    expect(exitCode).toBe(0);
  });
});

// `npm pack` puts bundledDependencies under node_modules in the tarball. bundled-conflict-host
// ships bundled-shipped-inner, which ships no-deps@1.0.0, and takes no-deps@2.0.0 from the registry.
describe.concurrent("auto-install of a package whose tarball ships a node_modules folder", () => {
  test("loads the packages that it ships from there, and its other dependencies from the cache", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-bundled", {
      "index.js": `console.log(JSON.stringify(require("bundled-conflict-host")));\n`,
      "bunfig.toml": registry.bunfig,
    });
    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");

    expect(stderr).toBe("");
    expect(stdout).toBe('["1.0.0","2.0.0"]\n');
    expect(registry.tarballs().sort()).toEqual([
      "/bundled-conflict-host/-/bundled-conflict-host-1.0.0.tgz",
      "/no-deps/-/no-deps-2.0.0.tgz",
    ]);
    expect(exitCode).toBe(0);
  });

  test("downloads a package it ships once the project imports that package itself", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-bundled-and-imported", {
      "index.js": `require("bundled-conflict-host");\nconsole.log(require("bundled-shipped-inner"), require.resolve("bundled-shipped-inner"));\n`,
      "bunfig.toml": registry.bunfig,
    });
    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "index.js");

    expect(stderr).toBe("");
    expect(stdout).toStartWith(`1.0.0 ${join(String(dir), ".bun-cache", "bundled-shipped-inner@1.0.0")}`);
    expect(registry.tarballs().sort()).toEqual([
      "/bundled-conflict-host/-/bundled-conflict-host-1.0.0.tgz",
      "/bundled-shipped-inner/-/bundled-shipped-inner-1.0.0.tgz",
      "/no-deps/-/no-deps-1.0.0.tgz",
      "/no-deps/-/no-deps-2.0.0.tgz",
    ]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("--install=fallback to install missing packages", async () => {
  using registry = fixtureRegistry();
  using dir = tempDir("autoinstall-fallback", {
    "index.js": "import isEven from 'is-even'; import isOdd from 'is-odd'; console.log(isEven(2), isOdd(2));",
    "package.json": JSON.stringify({ name: "test", dependencies: { "is-odd": "3.0.1" } }),
    "bunfig.toml": registry.bunfig,
  });

  expect((await runAutoInstall(String(dir), "install")).exitCode).toBe(0);
  expect(readdirSync(join(String(dir), "node_modules"))).toEqual(["is-odd"]);

  const { stdout, stderr } = await runAutoInstall(String(dir), "--install=fallback", "index.js");
  expect(stderr).not.toContain("error: Cannot find package");
  expect(stdout).toBe("true false\n");
});

// `bun install` lowers the process-wide cap on concurrent HTTP requests when a download keeps
// failing at the connection level, and nothing raises the cap again. The runtime's package manager
// shares that cap with fetch() and lives as long as the program: one failed auto-install left the
// program's own fetch() calls at 4 at a time.
describe.concurrent("a failed auto-install download does not lower the concurrency of fetch()", () => {
  const fixture = /* js */ `
    // A burst is as large as the limit, so all of it can only be in flight at the same time if the whole limit is
    // available.
    const requests = Number(process.env.BUN_CONFIG_MAX_HTTP_REQUESTS);
    let inFlight = 0;
    let release;
    // Holds every response until all the requests of a burst are in flight.
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch() {
        if (++inFlight === requests) release.resolve();
        await release.promise;
        inFlight--;
        return new Response("ok");
      },
    });
    async function burst() {
      release = Promise.withResolvers();
      // Under a lowered cap the rest of the burst waits in the client for a response that never
      // comes, and no event reports that. This bound only ends such a burst: the child says how
      // far the burst came and exits. A burst that fits under the cap takes a few milliseconds.
      const stuck = setTimeout(() => {
        console.log(inFlight + " requests in flight at once");
        process.exit(1);
      }, 4000);
      await Promise.all(Array.from({ length: requests }, () => fetch(server.url).then(res => res.text())));
      clearTimeout(stuck);
      console.log(requests + " requests in flight at once");
    }

    await burst();
    try {
      require("never-there");
    } catch (e) {
      console.log(e.code);
    }
    await burst();
  `;

  test.each(["manifest", "tarball"] as const)("when the %s request fails", async failing => {
    // Closes every connection before it answers.
    let droppedConnections = 0;
    using dropped = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          droppedConnections++;
          socket.end();
        },
        data() {},
      },
    });
    using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const name = new URL(req.url).pathname.slice(1);
        const tarball = `http://127.0.0.1:${dropped.port}/${name}/-/${name}-1.0.0.tgz`;
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball } } },
        });
      },
    });

    using dir = tempDir("autoinstall-fetch-concurrency", {
      "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${failing === "manifest" ? dropped.port : registry.port}/"\n`,
      "index.mjs": fixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
        BUN_CONFIG_MAX_HTTP_REQUESTS: "8",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim().split("\n")).toEqual([
      "8 requests in flight at once",
      "MODULE_NOT_FOUND",
      "8 requests in flight at once",
    ]);
    // the request was retried, so `bun install` would have lowered the cap
    expect(droppedConnections).toBeGreaterThan(2);
    expect(exitCode).toBe(0);
  });
});

// Without node_modules, the runtime keeps one package manager for the life of the process. A failed manifest request
// stayed recorded in it as "already requested", so every later resolve of that name failed without a request, even
// after the registry was healthy again.
describe.concurrent("a failed registry lookup is retried by the next resolve", () => {
  // Fails every manifest (or tarball) request with `respond` until the script asks for /__heal.
  // The script asks for /__next between its resolves: `lookups` is one list of requests per resolve.
  function flakyRegistry(
    respond: (deadPort: number, tarball: Uint8Array) => Response,
    failing: "manifest" | "tarball" = "manifest",
  ) {
    const dead = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.end();
        },
        data() {},
      },
    });
    const lookups: string[][] = [[]];
    const tarballs = new Map<string, Uint8Array>();
    let healthy = false;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const { pathname, origin } = new URL(req.url);
        if (pathname === "/__next") return (lookups.push([]), new Response("ok"));
        if (pathname === "/__heal") return ((healthy = true), new Response("ok"));
        if (pathname === "/__break") return ((healthy = false), new Response("ok"));
        lookups.at(-1)!.push(pathname);
        const name = pathname.split("/")[1];
        let tarball = tarballs.get(name);
        if (!tarball) {
          tarball = await new Bun.Archive(
            {
              "package/package.json": JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
              "package/index.js": "module.exports = { version: '1.0.0' };",
            },
            { compress: "gzip" },
          ).bytes();
          tarballs.set(name, tarball);
        }
        const asked = pathname.endsWith(".tgz") ? "tarball" : "manifest";
        if (!healthy && asked === failing) return respond(dead.port, tarball);
        if (asked === "tarball") return new Response(tarball);
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name,
              version: "1.0.0",
              main: "index.js",
              dist: {
                tarball: `${origin}/${name}/-/${name}-1.0.0.tgz`,
                integrity: "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64"),
              },
            },
          },
        });
      },
    });
    return {
      url: server.url.href,
      lookups,
      [Symbol.dispose]() {
        server.stop(true);
        dead.stop(true);
      },
    };
  }

  async function run(
    registry: { url: string },
    script: string,
    env: Record<string, string | undefined> = {},
    files: Record<string, string> = {},
  ) {
    using dir = tempDir("autoinstall-failed-lookup", {
      ...files,
      "bunfig.toml": `[install]\nregistry = "${registry.url}"\n`,
      // A failed lookup is remembered until the event loop has run something. An awaited fetch() is enough, even if its
      // continuation runs in the same iteration of the loop that started it.
      "index.js": `const registry = ${JSON.stringify(registry.url)};
        const next = path => fetch(registry + path);
        ${script}`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
        // A 5xx or a dropped connection is retried: one lookup is then two requests.
        BUN_CONFIG_HTTP_RETRY_COUNT: "1",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // A resolve that misses runs the resolver a second time, which does not ask again.
  function expectLookups(requests: string[], path: string, requestsPerLookup: number) {
    expect(requests).toEqual(Array(requestsPerLookup).fill(path));
  }

  // A 404 is a real response. It's remembered for as long as a manifest would be (300 seconds), unless the registry
  // says otherwise.
  const notFound = (headers: HeadersInit = { "Cache-Control": "no-cache" }) =>
    new Response("{}", { status: 404, headers });

  const failures: Record<string, { respond: (deadPort: number) => Response; requestsPerLookup: number }> = {
    "404 with Cache-Control: no-cache": { respond: () => notFound(), requestsPerLookup: 1 },
    "500": { respond: () => new Response("{}", { status: 500 }), requestsPerLookup: 2 },
    // The JS thread waits for the lookup, so there is no backoff, whatever the registry asks for.
    "503 with Retry-After": {
      respond: () => new Response("{}", { status: 503, headers: { "Retry-After": "3600" } }),
      requestsPerLookup: 2,
    },
    "a manifest that does not parse": { respond: () => new Response("not json"), requestsPerLookup: 1 },
    // the connection closes before a response arrives
    "a dropped connection": {
      respond: port => Response.redirect(`http://127.0.0.1:${port}/flaky-pkg`, 302),
      requestsPerLookup: 2,
    },
  };

  test.each(Object.entries(failures))("%s", async (_, { respond, requestsPerLookup }) => {
    using registry = flakyRegistry(respond);
    const { stdout, exitCode } = await run(
      registry,
      `
        const attempt = () => {
          try { return require("flaky-pkg").version; } catch (e) { return e.code; }
        };
        const results = [attempt()];
        await next("__next");
        results.push(attempt());
        await next("__heal");
        await next("__next");
        results.push(attempt());
        results.push(await import("flaky-pkg").then(m => m.default.version, e => e.code));
        console.log(JSON.stringify(results));
      `,
      // the default backoff, not the harness's 1 ms
      { BUN_CONFIG_HTTP_RETRY_BACKOFF: undefined },
    );

    expect(stdout).toBe(JSON.stringify(["MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "1.0.0", "1.0.0"]));
    expect(registry.lookups).toHaveLength(3);
    expectLookups(registry.lookups[0], "/flaky-pkg", requestsPerLookup);
    expectLookups(registry.lookups[1], "/flaky-pkg", requestsPerLookup);
    expect(registry.lookups[2]).toEqual(["/flaky-pkg", "/flaky-pkg/-/flaky-pkg-1.0.0.tgz"]);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["no Cache-Control", {}],
    ["max-age=600", { "Cache-Control": "public, max-age=600" }],
  ])("a 404 with %s is asked for once, however often the event loop goes around", async (_, headers) => {
    using registry = flakyRegistry(() => notFound(headers));
    const { stdout, exitCode } = await run(
      registry,
      `
        const results = [];
        for (let turn = 0; turn < 5; turn++) {
          try { results.push(require("flaky-pkg").version); } catch (e) { results.push(e.code); }
          await next("__next");
        }
        console.log(JSON.stringify(results));
      `,
    );

    expect(stdout).toBe(JSON.stringify(Array(5).fill("MODULE_NOT_FOUND")));
    expect(registry.lookups).toEqual([["/flaky-pkg"], [], [], [], [], []]);
    expect(exitCode).toBe(0);
  });

  test("a loop that never yields sends one request, and another one after the next event loop iteration", async () => {
    using registry = flakyRegistry(() => notFound());
    const { stdout, exitCode } = await run(
      registry,
      `
        const attempt = () => {
          try { return require("flaky-pkg").version; } catch (e) { return e.code; }
        };
        const results = new Set();
        for (let i = 0; i < 50; i++) results.add(attempt());
        await next("__next");
        for (let i = 0; i < 50; i++) results.add(attempt());
        console.log(JSON.stringify([...results]));
      `,
    );

    expect(stdout).toBe(JSON.stringify(["MODULE_NOT_FOUND"]));
    expect(registry.lookups.slice(0, 2)).toEqual([["/flaky-pkg"], ["/flaky-pkg"]]);
    expect(exitCode).toBe(0);
  });

  test("through every way to resolve", async () => {
    using registry = flakyRegistry(() => notFound());
    const { stdout, exitCode } = await run(
      registry,
      `
        const ways = {
          "require": name => require(name).version,
          "require.resolve": name => require.resolve(name).includes(name),
          "Bun.resolveSync": name => Bun.resolveSync(name, import.meta.dir).includes(name),
          "import.meta.resolve": name => import.meta.resolve(name).includes(name),
          "import()": async name => (await import(name)).default.version,
          "Bun.resolve": async name => (await Bun.resolve(name, import.meta.dir)).includes(name),
        };
        const results = {};
        let i = 0;
        for (const [way, resolve] of Object.entries(ways)) {
          const name = "flaky-pkg-" + i++;
          const attempt = () => Promise.resolve(name).then(resolve).catch(e => e.code);
          await next("__break");
          const broken = await attempt();
          await next("__next");
          await next("__heal");
          results[way] = [broken, await attempt()];
          await next("__next");
        }
        console.log(JSON.stringify(results));
      `,
    );

    expect(JSON.parse(stdout)).toEqual({
      "require": ["MODULE_NOT_FOUND", "1.0.0"],
      "require.resolve": ["MODULE_NOT_FOUND", true],
      "Bun.resolveSync": ["ERR_MODULE_NOT_FOUND", true],
      "import.meta.resolve": ["ERR_MODULE_NOT_FOUND", true],
      "import()": ["ERR_MODULE_NOT_FOUND", "1.0.0"],
      "Bun.resolve": ["ERR_MODULE_NOT_FOUND", true],
    });
    expect(registry.lookups).toHaveLength(13);
    for (let i = 0; i < 6; i++) {
      expectLookups(registry.lookups[2 * i], `/flaky-pkg-${i}`, 1);
      expect(registry.lookups[2 * i + 1]).toEqual([`/flaky-pkg-${i}`, `/flaky-pkg-${i}/-/flaky-pkg-${i}-1.0.0.tgz`]);
    }
    expect(exitCode).toBe(0);
  });

  // Occasionally, the fetch() got its response before the thread went to sleep. Its continuation then ran in the same
  // iteration of the loop, and the second attempt failed without a request.
  test.each(["manifest", "tarball"] as const)("after nothing but an awaited fetch(): the %s", async failing => {
    using registry = flakyRegistry(() => notFound(), failing);
    const { stdout, exitCode } = await run(
      registry,
      `
        const results = new Set();
        for (let i = 0; i < 40; i++) {
          const attempt = () => {
            try { return require("flaky-pkg-" + i).version; } catch (e) { return e.code; }
          };
          await next("__break");
          const broken = attempt();
          await next("__heal");
          results.add(broken + ", then " + attempt());
        }
        console.log(JSON.stringify([...results]));
      `,
    );

    expect(stdout).toBe(JSON.stringify(["MODULE_NOT_FOUND, then 1.0.0"]));
    expect(exitCode).toBe(0);
  });

  // The package is resolved by then. The failed download stayed recorded, and no later import requested it again.
  describe.each([
    ["found through its manifest", {}],
    [
      "pinned by bun.lock",
      {
        "package.json": JSON.stringify({ name: "app", dependencies: { "flaky-pkg": "^1.0.0" } }),
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: { "": { name: "app", dependencies: { "flaky-pkg": "^1.0.0" } } },
          packages: { "flaky-pkg": ["flaky-pkg@1.0.0", "", {}, ""] },
        }),
      },
    ],
  ])("the tarball of a package %s", (_, files) => {
    test.each([
      ["500", () => new Response("{}", { status: 500 })],
      ["404", () => new Response("{}", { status: 404 })],
      ["half of the file", (_: number, tarball: Uint8Array) => new Response(tarball.subarray(0, tarball.length / 2))],
    ])("%s", async (_, respond) => {
      using registry = flakyRegistry(respond, "tarball");
      const { stdout, exitCode } = await run(
        registry,
        `
          const attempt = () => {
            try { return require("flaky-pkg").version; } catch (e) { return e.code; }
          };
          const results = [attempt(), attempt()];
          await next("__next");
          results.push(attempt());
          await next("__heal");
          await next("__next");
          results.push(attempt());
          results.push(await import("flaky-pkg").then(m => m.default.version, e => e.code));
          console.log(JSON.stringify(results));
        `,
        {},
        files,
      );

      expect(stdout).toBe(JSON.stringify([...Array(3).fill("MODULE_NOT_FOUND"), "1.0.0", "1.0.0"]));
      const tarball = "/flaky-pkg/-/flaky-pkg-1.0.0.tgz";
      const downloads = registry.lookups.map(requests => requests.filter(path => path === tarball).length);
      // The second attempt is in the turn of the event loop of the first, and does not ask.
      expect(downloads).toEqual([downloads[1], expect.any(Number), 1]);
      expect(downloads[1]).toBeGreaterThan(0);
      // The version is known: no manifest is asked for again.
      expect(registry.lookups.slice(1).flat()).not.toContain("/flaky-pkg");
      expect(exitCode).toBe(0);
    });
  });
});

// Resolving a package that is not installed waits for the registry inside a
// synchronous call. That wait must block the thread. It used to run the JS
// event loop, so timers, immediates and other sockets' callbacks ran inside
// `require()`, and a `Bun.serve` handler that made the call read another
// request's url out of the shared receive buffer.
describe.concurrent("auto-install does not run the event loop inside", () => {
  // Answers 404, and holds the first request for `packageName` until `release()`.
  function gatedRegistry(packageName: string) {
    const requested = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        if (new URL(req.url).pathname === `/${packageName}`) {
          requested.resolve();
          await released.promise;
        }
        return new Response("not found", { status: 404 });
      },
    });
    return {
      url: `http://127.0.0.1:${server.port}/`,
      bunfig: `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
      requested: requested.promise,
      release: released.resolve,
      [Symbol.dispose]: () => void server.stop(true),
    };
  }

  // Runs server.ts, which prints one JSON value per line, the first with the port of its server.
  function spawnServer(cwd: string, ...args: string[]) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "server.ts", ...args],
      cwd,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    // If the child dies, the step that waits on it fails with the child's
    // stderr. Without this, a crash is a timeout or a JSON parse error.
    const died = proc.exited.then(async code => {
      throw new Error(`the child exited (code ${code}, signal ${proc.signalCode}):\n${await stderr}`);
    });
    died.catch(() => {});
    const lines = (async function* () {
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const chunk of proc.stdout) {
        buffered += decoder.decode(chunk, { stream: true });
        for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
          yield buffered.slice(0, end);
          buffered = buffered.slice(end + 1);
        }
      }
    })();
    return {
      stderr,
      died,
      async nextJson() {
        const line = await Promise.race([lines.next(), died]);
        return line.done ? await died : JSON.parse(line.value);
      },
      kill: () => proc.kill(),
      [Symbol.asyncDispose]: () => proc[Symbol.asyncDispose](),
    };
  }

  async function connectTo(port: number) {
    const socket = connect(port, "127.0.0.1");
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    socket.once("connect", resolve);
    socket.once("error", reject);
    await promise;
    socket.on("error", () => {});
    socket.setNoDelay(true);
    return socket;
  }

  function send(socket: Socket, head: string) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    socket.write(head + "\r\n\r\n", error => (error ? reject(error) : resolve()));
    return promise;
  }

  // The test is the registry and both HTTP clients. It holds the manifest
  // request until the second client's request has been written, so the second
  // request is readable for the whole time the first handler is inside the
  // call. The manifest request itself proves that the handler is inside it.
  const doors = {
    "require": "name => require(name)",
    "require.resolve": "name => require.resolve(name)",
    "Module._resolveFilename": `name => require("module")._resolveFilename(name, { filename: import.meta.path })`,
    "Bun.resolveSync": "name => Bun.resolveSync(name, import.meta.dir)",
    "import.meta.resolve": "name => import.meta.resolve(name)",
    "import.meta.resolveSync": "name => import.meta.resolveSync(name)",
    // These two resolve inside the call and only report the failure through the promise.
    "import()": "name => void import(name).catch(() => {})",
    "Bun.resolve": "name => void Bun.resolve(name, import.meta.dir).catch(() => {})",
  };

  test.each(Object.entries(doors))("%s", async (_, door) => {
    using registry = gatedRegistry("not-installed");
    using dir = tempDir("autoinstall-no-reentry", {
      "bunfig.toml": registry.bunfig,
      "server.ts": `
        import { readFile } from "fs";
        const door = ${door};
        let insideTheCall = false;
        const ranInsideTheCall: string[] = [];
        function record(what: string) {
          if (insideTheCall) ranInsideTheCall.push(what);
        }

        let requests = 0;
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(req) {
            if (++requests > 1) {
              record("another request");
              return new Response("second");
            }

            setTimeout(() => record("timer"), 0);
            setImmediate(() => record("immediate"));
            process.nextTick(() => record("nextTick"));
            Promise.resolve().then(() => record("microtask"));
            queueMicrotask(() => record("queueMicrotask"));
            fetch(${JSON.stringify(registry.url + "another-package")}).then(() => record("fetch"));
            const { port1, port2 } = new MessageChannel();
            port2.onmessage = () => record("message");
            port1.postMessage("");
            readFile(import.meta.path, () => record("readFile"));
            Bun.spawn({ cmd: [process.execPath, "--version"], stdout: "ignore", onExit: () => record("onExit") });
            if (process.platform !== "win32") {
              process.on("SIGUSR2", () => record("signal"));
              process.kill(process.pid, "SIGUSR2");
            }

            // Nothing may read the request before the call. A read copies the head out of the receive buffer, and the
            // url below has to come from there.
            insideTheCall = true;
            try {
              door("not-installed");
            } catch {}
            insideTheCall = false;

            console.log(JSON.stringify({ url: req.url, ranInsideTheCall: ranInsideTheCall.sort() }));
            return new Response("first");
          },
        });
        console.log(JSON.stringify({ port: server.port }));
      `,
    });

    await using child = spawnServer(String(dir));
    const { port } = await child.nextJson();
    const first = await connectTo(port);
    const second = await connectTo(port);
    try {
      await send(first, "GET /first HTTP/1.1\r\nHost: first.example");
      await Promise.race([registry.requested, child.died]);
      await send(second, "GET /second HTTP/1.1\r\nHost: second.example");
      registry.release();

      const result = await child.nextJson();
      child.kill();
      expect({ ...result, stderr: await child.stderr }).toEqual({
        url: "http://first.example/first",
        ranInsideTheCall: [],
        stderr: "",
      });
    } finally {
      first.destroy();
      second.destroy();
    }
  });

  // https://github.com/oven-sh/bun/issues/43842. A handler memoises the import()
  // of an optional peer that is not installed. While the first import() waited
  // for the registry, the event loop ran the other requests' handlers inside it,
  // before `p` was assigned. Each of them called import() again, inside the one
  // before, and with enough requests the stack overflowed.
  test("a memoised import(), which runs once for concurrent requests", async () => {
    using registry = gatedRegistry("not-installed");
    using dir = tempDir("autoinstall-no-reentry-memoised", {
      "bunfig.toml": registry.bunfig,
      "server.ts": `
        let p: Promise<unknown> | undefined;
        let imports = 0;
        function getOptional() {
          if (!p) {
            imports++;
            p = import("not-installed").catch(() => undefined);
          }
          return p;
        }
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          async fetch() {
            await getOptional();
            return new Response("imports " + imports);
          },
        });
        console.log(JSON.stringify({ port: server.port }));
      `,
    });

    await using child = spawnServer(String(dir));
    const { port } = await child.nextJson();
    const sockets = await Promise.all(Array.from({ length: 20 }, () => connectTo(port)));
    try {
      // The status line and the body, once the server has closed the connection.
      const answers = sockets.map(socket => {
        const { promise, resolve } = Promise.withResolvers<string>();
        let received = "";
        socket.on("data", chunk => (received += chunk));
        socket.on("close", () => {
          const [head, body] = received.split("\r\n\r\n");
          resolve(`${head.split("\r\n")[0]}: ${body}`);
        });
        return promise;
      });
      const request = "GET / HTTP/1.1\r\nHost: x\r\nConnection: close";

      await send(sockets[0], request);
      await Promise.race([registry.requested, child.died]);
      await Promise.all(sockets.slice(1).map(socket => send(socket, request)));
      registry.release();

      const received = await Promise.race([Promise.all(answers), child.died]);
      child.kill();
      expect({ received, stderr: await child.stderr }).toEqual({
        received: sockets.map(() => "HTTP/1.1 200 OK: imports 1"),
        stderr: "",
      });
    } finally {
      for (const socket of sockets) socket.destroy();
    }
  });

  // An ES module imports a node builtin and then a package that auto-install has
  // to fetch. The builtin's fetch settles at once, so its load steps are queued
  // microtasks while the resolver waits for the registry. If the wait runs them,
  // the builtin's edge of the importer completes underneath JSC's
  // HostLoadImportedModule call for the package. JSC reads that as "the package
  // loaded synchronously" and does not watch its load for errors: debug builds
  // assert in JSModuleLoader::innerModuleLoading, release builds lose a later
  // load error of the package and the entry never runs.
  test.each([
    ["loads", "export const value = 42;\n", { stdout: "value 42\n", stderr: "", exitCode: 0 }],
    ["reports its load error", "export const value = ;\n", { stdout: "", stderr: "error: Unexpected ;", exitCode: 1 }],
  ])("the load of a module graph: a package imported after a builtin %s", async (_, source, expected) => {
    const tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", type: "module", main: "index.js" }),
        "package/index.js": source,
      },
      { compress: "gzip" },
    ).bytes();
    const requests: string[] = [];
    using registry = Bun.serve({
      port: 0,
      fetch(req) {
        const { origin, pathname } = new URL(req.url);
        requests.push(pathname);
        if (pathname === "/pkg-1.0.0.tgz") return new Response(tarball);
        if (pathname !== "/pkg") return new Response("not found", { status: 404 });
        return Response.json({
          name: "pkg",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "pkg", version: "1.0.0", dist: { tarball: `${origin}/pkg-1.0.0.tgz` } } },
        });
      },
    });
    using dir = tempDir("autoinstall-module-graph", {
      "entry.mjs": `import "node:http2";\nimport { value } from "pkg";\nconsole.log("value", value);\n`,
      "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
    });

    const { stdout, stderr, exitCode } = await runAutoInstall(String(dir), "entry.mjs");
    expect({
      stdout,
      stderr: expected.stderr ? stderr.split("\n").find(line => line.startsWith("error:")) : stderr,
      exitCode,
    }).toEqual(expected);
    expect(requests).toEqual(["/pkg", "/pkg-1.0.0.tgz"]);
  });
});

// A dead proxy, a captive portal, a VPN that has just dropped. The thread is blocked, and the
// wait was six times five minutes long.
describe.concurrent("auto-install and a registry that accepts the connection and never answers", () => {
  function silentRegistry() {
    let connections = 0;
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          connections++;
        },
        data() {},
      },
    });
    return {
      bunfig: `[install]\nregistry = "http://127.0.0.1:${listener.port}/"\n`,
      connections: () => connections,
      [Symbol.dispose]: () => void listener.stop(true),
    };
  }

  // The shortest idle timeout is 1 second plus up to 4 of the timer wheel.
  test("the request is not sent again after a timeout", async () => {
    using registry = silentRegistry();
    using dir = tempDir("autoinstall-silent-timeout", {
      "bunfig.toml": registry.bunfig,
      "index.js": `try {\n  require("never-answered");\n} catch (e) {\n  console.log(e.code);\n}\n`,
    });

    const { stdout, exitCode } = await runAutoInstallWithEnv(
      { BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" },
      String(dir),
      "index.js",
    );
    expect(stdout).toBe("MODULE_NOT_FOUND\n");
    expect(registry.connections()).toBe(1);
    expect(exitCode).toBe(0);
  }, 30_000);
});

// `git` for a git dependency is a child process on the event loop of the thread
// that installs, which is the JS loop here. A blocked thread cannot reap it, and
// the resolver can only load a package from the registry out of the cache. So
// auto-install reports the package as not found and never starts git.
describe.concurrent("auto-install does not start git", () => {
  const gitEnv = {
    ...bunEnv,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  async function git(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${stderr}`);
  }

  // The URL of a repository with a package `git-dep` in `<root>/git-dep`.
  async function gitDependency(root: string) {
    const repo = join(root, "git-dep");
    await git(repo, "init", "-q");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "init", "--no-gpg-sign");
    return `git+${pathToFileURL(repo)}`;
  }

  const gitDepFiles = {
    "git-dep/package.json": JSON.stringify({ name: "git-dep", version: "1.0.0" }),
    "git-dep/index.js": `module.exports = "from git";\n`,
  };

  const cacheEntries = (app: string) =>
    existsSync(join(app, ".bun-cache"))
      ? readdirSync(join(app, ".bun-cache")).filter(name => /git|@G@/i.test(name))
      : [];

  test.each([
    ["require()", `try {\n  require("git-dep");\n} catch (e) {\n  console.log(e.code);\n}\n`, "MODULE_NOT_FOUND\n"],
    ["import", `import marker from "git-dep";\nconsole.log(marker);\n`, ""],
  ])("for a git dependency of the project, %s", async (_, source, expectedStdout) => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-git-url", {
      ...gitDepFiles,
      "app/index.js": source,
      "app/bunfig.toml": registry.bunfig,
    });
    const app = join(String(dir), "app");
    await Bun.write(
      join(app, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "git-dep": await gitDependency(String(dir)) } }),
    );

    const { stdout, stderr, exitCode } = await runAutoInstall(app, "index.js");
    expect({ stdout, error: stderr.split("\n").find(line => line.includes("error")) }).toEqual({
      stdout: expectedStdout,
      error: expectedStdout ? undefined : expect.stringContaining("Cannot find package 'git-dep'"),
    });
    expect(cacheEntries(app)).toEqual([]);
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(expectedStdout ? 0 : 1);
  });

  test("for a git dependency of an auto-installed package", async () => {
    const tarball = await Bun.file(join(import.meta.dir, "..", "install", "baz-0.0.3.tgz")).bytes();
    using dir = tempDir("autoinstall-git-transitive", {
      ...gitDepFiles,
      "app/index.js": `require("baz");\nconsole.log("loaded");\n`,
    });
    const url = await gitDependency(String(dir));
    using registry = Bun.serve({
      port: 0,
      fetch(req) {
        const { origin, pathname } = new URL(req.url);
        if (pathname === "/baz/-/baz-0.0.3.tgz") return new Response(tarball);
        if (pathname !== "/baz") return new Response("not found", { status: 404 });
        return Response.json({
          name: "baz",
          "dist-tags": { latest: "0.0.3" },
          versions: {
            "0.0.3": {
              name: "baz",
              version: "0.0.3",
              dependencies: { "git-dep": url },
              dist: { tarball: `${origin}/baz/-/baz-0.0.3.tgz` },
            },
          },
        });
      },
    });
    const app = join(String(dir), "app");
    await Bun.write(join(app, "bunfig.toml"), `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`);

    // `baz` prints "run baz" when it loads.
    expect(await runAutoInstall(app, "index.js")).toEqual({ stdout: "run baz\nloaded\n", stderr: "", exitCode: 0 });
    expect(cacheEntries(app)).toEqual([]);
  });
});

// The runtime's package manager then takes a cached manifest of any age for
// fresh, as `bun install --prefer-offline` does.
describe.concurrent("--prefer-offline resolves an auto-installed package from the cached manifest", () => {
  // "1": a cached manifest of any age counts as expired, and the registry is asked again.
  const run = (cwd: string, ...flags: string[]) =>
    runAutoInstallWithEnv({ BUN_MANIFEST_CACHE: "1" }, cwd, ...flags, "index.js");

  const cases = {
    "a range": { name: "no-deps", range: "^1.0.0", version: "1.1.0" },
    "a range with a pre-release tag": { name: "prereleases-3", range: ">=5.0.0-alpha.151", version: "5.0.0-alpha.153" },
    // 1.0.0-next.23 is newer than the version that the tag names
    "the latest tag": { name: "prereleases-2", range: undefined, version: "0.5.0" },
  };
  const ways = { "the flag": ["--prefer-offline"], 'prefer = "offline" in bunfig.toml': [] };

  for (const [way, flags] of Object.entries(ways)) {
    test.each(Object.entries(cases))(`%s, with ${way}`, async (_, { name, range, version }) => {
      using registry = fixtureRegistry();
      using dir = tempDir("autoinstall-prefer-offline", {
        "package.json": JSON.stringify({ name: "app", dependencies: range ? { [name]: range } : {} }),
        "index.js": `console.log(require("${name}/package.json").version);\n`,
        "bunfig.toml": registry.bunfig,
      });
      const expected = { stdout: version + "\n", stderr: "", exitCode: 0 };

      expect(await run(String(dir))).toEqual(expected);
      expect(registry.requests).toEqual([`/${name}`, `/${name}/-/${name}-${version}.tgz`]);

      registry.requests.length = 0;
      expect(await run(String(dir))).toEqual(expected);
      expect(registry.requests).toEqual([`/${name}`]);

      registry.requests.length = 0;
      if (!flags.length) await Bun.write(join(String(dir), "bunfig.toml"), registry.bunfig + `prefer = "offline"\n`);
      expect(await run(String(dir), ...flags)).toEqual(expected);
      expect(registry.requests).toEqual([]);
    });
  }

  test("a package that is not in the cache is downloaded", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-prefer-offline-cold", {
      "index.js": `console.log(require("no-deps/package.json").version);\n`,
      "bunfig.toml": registry.bunfig,
    });
    expect(await run(String(dir), "--prefer-offline")).toEqual({ stdout: "2.0.0\n", stderr: "", exitCode: 0 });
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz"]);
  });
});

// docs/runtime/bunfig.mdx, `install.security.scanner`
describe.concurrent("auto-install is off when a security scanner is configured", () => {
  const scanner = `[install.security]\nscanner = "./scanner.ts"\n`;
  const configured = `Cannot find package "no-deps": auto-install is off because a security scanner is configured. Run "bun install"`;
  const unreadable = `Cannot find package "no-deps": auto-install is off because a package.json or bunfig.toml cannot be read or parsed. Run "bun install"`;
  const print = (expression: string) =>
    `try { console.log("loaded", ${expression}); } catch (e) { console.log(e.message); }\n`;
  const requireIt = print(`require("no-deps").version`);

  type Options = { cwd?: string; args?: string[]; env?: Record<string, string | undefined>; warm?: boolean };

  /**
   * A file with this text gets mode 000, and bun runs as a user that file modes apply to. Not for Windows. For serial
   * tests: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
   */
  const UNREADABLE = "# mode 000\n";

  /** Runs `app/index.js`. The user's own bunfig is `home/.bunfig.toml`. */
  async function run(files: DirectoryTree, options: Options = {}) {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-scanner", { "home/.keep": "", "elsewhere/index.js": requireIt, ...files });
    const at = (path: string) => join(String(dir), path);
    const locked = Object.keys(files).filter(path => files[path] === UNREADABLE);
    for (const path of locked) chmodSync(at(path), 0o000);
    using unprivileged = locked.length ? unprivilegedSpawnOptions(String(dir)) : undefined;
    const spawn = async (cwd: string, home: string, args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: at(cwd),
        env: {
          ...bunEnv,
          BUN_CONFIG_REGISTRY: registry.url,
          BUN_INSTALL_CACHE_DIR: at("cache"),
          HOME: at(home),
          USERPROFILE: at(home),
          XDG_CONFIG_HOME: at(home),
          ...options.env,
        },
        stdout: "pipe",
        stderr: "pipe",
        ...unprivileged,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    if (options.warm) {
      expect(await spawn("elsewhere", "elsewhere", ["index.js"])).toEqual({
        stdout: "loaded 2.0.0\n",
        stderr: "",
        exitCode: 0,
      });
      registry.requests.length = 0;
    }
    const result = await spawn(options.cwd ?? "app", "home", options.args ?? ["index.js"]);
    return { ...result, requests: registry.requests };
  }

  const refused = (why: string) => ({ stdout: why + "\n", stderr: "", exitCode: 0, requests: [] });
  // `bun install` in `app/src` reads the bunfig.toml of `app`, and none above it.
  const project = { "app/package.json": JSON.stringify({ name: "app" }), "app/src/index.js": requireIt };
  const installed = {
    stdout: "loaded 2.0.0\n",
    stderr: "",
    exitCode: 0,
    requests: ["/no-deps", "/no-deps/-/no-deps-2.0.0.tgz"],
  };

  test.each([
    `require("no-deps").version`,
    `(await import("no-deps")).default.version`,
    `Bun.resolveSync("no-deps", import.meta.dir)`,
    `import.meta.resolve("no-deps")`,
    `require.resolve("no-deps")`,
  ])("%s", async expression => {
    expect(await run({ "app/bunfig.toml": scanner, "app/index.js": print(expression) })).toEqual(refused(configured));
  });

  test("an import statement", async () => {
    const result = await run({ "app/bunfig.toml": scanner, "app/index.js": `import "no-deps";\n` });
    expect(result.stderr).toContain(configured);
    expect({ ...result, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 1, requests: [] });
  });

  test("a package that is in the cache", async () => {
    expect(await run({ "app/bunfig.toml": scanner, "app/index.js": requireIt }, { warm: true })).toEqual(
      refused(configured),
    );
  });

  test.each(["-i", "--install=fallback", "--install=force"])("%s", async flag => {
    const files = { "app/bunfig.toml": scanner, "app/index.js": requireIt };
    expect(await run(files, { args: [flag, "index.js"] })).toEqual(refused(configured));
  });

  test('auto = "force" in bunfig.toml', async () => {
    const bunfig = `[install]\nauto = "force"\n` + scanner;
    expect(await run({ "app/bunfig.toml": bunfig, "app/index.js": requireIt })).toEqual(refused(configured));
  });

  test("a dependency of a package in node_modules", async () => {
    const files = {
      "app/bunfig.toml": scanner,
      "app/index.js": print(`require("has-dep").version`),
      "app/node_modules/has-dep/index.js": `module.exports = require("no-deps");\n`,
    };
    expect(await run(files, { args: ["-i", "index.js"] })).toEqual(refused(configured));
  });

  test.each([
    ["$XDG_CONFIG_HOME/.bunfig.toml", {}],
    ["$HOME/.bunfig.toml", { XDG_CONFIG_HOME: undefined }],
  ])("configured in %s", async (_, env) => {
    expect(await run({ "home/.bunfig.toml": scanner, "app/index.js": requireIt }, { env })).toEqual(
      refused(configured),
    );
  });

  test("configured in the project's bunfig.toml, run from a folder of the project", async () => {
    const files = {
      "app/bunfig.toml": scanner,
      "app/package.json": JSON.stringify({ name: "app" }),
      "app/src/index.js": requireIt,
    };
    expect(await run(files, { cwd: "app/src" })).toEqual(refused(configured));
  });

  test("configured in the workspace root's bunfig.toml, run from a member", async () => {
    const files = {
      "app/bunfig.toml": scanner,
      "app/package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
      "app/packages/member/package.json": JSON.stringify({ name: "member" }),
      "app/packages/member/index.js": requireIt,
    };
    expect(await run(files, { cwd: "app/packages/member" })).toEqual(refused(configured));
  });

  test("configured in the project's bunfig.toml, run from outside the project", async () => {
    const files = {
      "app/bunfig.toml": scanner,
      "app/package.json": JSON.stringify({ name: "app" }),
      "app/src/index.js": requireIt,
    };
    expect(await run(files, { cwd: "elsewhere", args: ["../app/src/index.js"] })).toEqual(refused(configured));
  });

  test("configured in the project's bunfig.toml, run from a folder with a package.json that only has a type", async () => {
    const files = {
      "app/bunfig.toml": scanner,
      "app/package.json": JSON.stringify({ name: "app" }),
      "app/src/package.json": JSON.stringify({ type: "commonjs" }),
      "app/src/index.js": requireIt,
    };
    expect(await run(files, { cwd: "app/src" })).toEqual(refused(configured));
  });

  describe.each([{ type: "commonjs" }, { private: true }, {}])(
    "configured beside a package.json that is %j, with no project above",
    packageJson => {
      test.each([
        ["a folder below it", { cwd: "app/src" }],
        ["outside", { cwd: "elsewhere", args: ["../app/src/index.js"] }],
      ])("run from %s", async (_, options) => {
        const files = {
          "app/bunfig.toml": scanner,
          "app/package.json": JSON.stringify(packageJson),
          "app/src/index.js": requireIt,
        };
        expect(await run(files, options)).toEqual(refused(configured));
      });
    },
  );

  test("configured in a folder between the importing file and the project root, run from outside", async () => {
    const files = {
      "app/package.json": JSON.stringify({ name: "app" }),
      "app/src/bunfig.toml": scanner,
      "app/src/deep/index.js": requireIt,
    };
    expect(await run(files, { cwd: "elsewhere", args: ["../app/src/deep/index.js"] })).toEqual(refused(configured));
  });

  test.serial.skipIf(isWindows).each([
    [".npmrc", "a folder of the project", { cwd: "app/src" }],
    [".npmrc", "outside the project", { cwd: "elsewhere", args: ["../app/src/index.js"] }],
    ["bunfig.toml", "outside the project", { cwd: "elsewhere", args: ["../app/src/index.js"] }],
  ])("on when the project's %s cannot be read, run from %s", async (name, _, options) => {
    const files = {
      [`app/${name}`]: UNREADABLE,
      "app/package.json": JSON.stringify({ name: "app" }),
      "app/src/index.js": requireIt,
    };
    expect(await run(files, options)).toEqual(installed);
  });

  test("configured with --config", async () => {
    const files = { "app/other.toml": scanner, "app/index.js": requireIt };
    expect(await run(files, { args: ["--config=other.toml", "index.js"] })).toEqual(refused(configured));
  });

  test("the user's bunfig cannot be parsed", async () => {
    const files = { "home/.bunfig.toml": "[install.security\n", "app/index.js": requireIt };
    expect(await run(files)).toEqual(refused(unreadable));
  });

  test.serial.skipIf(isWindows).each([
    ["the user's bunfig", "home/.bunfig.toml"],
    ["the user's .npmrc", "home/.npmrc"],
    ["the project's .npmrc", "app/.npmrc"],
    ["the project's bunfig.toml", "app/bunfig.toml"],
  ])("on when %s cannot be read", async (_, path) => {
    expect(await run({ [path]: UNREADABLE, "app/index.js": requireIt })).toEqual(installed);
  });

  describe.each([
    ["cannot be parsed", "[install.security\n", unreadable],
    ["configures a scanner", scanner, configured],
  ])("a bunfig.toml that %s", (_, bunfig, why) => {
    test("in the project root", async () => {
      expect(await run({ ...project, "app/bunfig.toml": bunfig }, { cwd: "app/src" })).toEqual(refused(why));
    });

    test("between the working directory and the project root", async () => {
      const files = { ...project, "app/src/bunfig.toml": bunfig, "app/src/deep/index.js": requireIt };
      expect(await run(files, { cwd: "app/src/deep" })).toEqual(refused(why));
    });

    test("above the project root is not read", async () => {
      expect(await run({ ...project, "bunfig.toml": bunfig }, { cwd: "app/src" })).toEqual(installed);
    });
  });

  describe.each(
    (
      [
        ["cannot be read", UNREADABLE],
        ["is a directory", {}],
        ["cannot be parsed", "{"],
      ] as [string, string | DirectoryTree][]
    ).filter(([, packageJson]) => !isWindows || packageJson !== UNREADABLE),
  )("a package.json that %s", (_, packageJson) => {
    test.serialIf(packageJson === UNREADABLE)("beside the importing file, below a project", async () => {
      const result = await run({ ...project, "app/src/package.json": packageJson }, { cwd: "app/src" });
      expect({ ...result, stderr: "" }).toEqual(refused(unreadable));
    });

    // One that does not open is passed over on the way up, as `bun install` passes over it.
    test.skipIf(packageJson === UNREADABLE)("above the project, which may be a member of its workspace", async () => {
      const result = await run({ ...project, "package.json": packageJson }, { cwd: "app/src" });
      expect({ ...result, stderr: "" }).toEqual(refused(unreadable));
    });
  });

  test("the error of an import statement names the package.json that cannot be parsed", async () => {
    const files = { ...project, "app/src/package.json": "{", "app/src/index.js": `import "no-deps";\n` };
    const result = await run(files, { cwd: "app/src" });
    expect(result.stderr).toMatch(/src[\\/]package\.json/);
    expect({ ...result, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 1, requests: [] });
  });

  test("the error of an import statement names the file that cannot be parsed", async () => {
    const files = { ...project, "app/bunfig.toml": "[install.security\n", "app/src/index.js": `import "no-deps";\n` };
    const result = await run(files, { cwd: "app/src" });
    expect(result.stderr).toContain(unreadable);
    expect(result.stderr).toMatch(/cannot read or parse "\S+[\\/]bunfig\.toml"/);
    expect({ ...result, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 1, requests: [] });
  });

  // This is what Docker creates for a `-v` mount of a file that doesn't exist on the host. It contains no settings.
  test.each(["home/.bunfig.toml", "home/.npmrc", "app/.npmrc", "app/bunfig.toml"])(
    "on when %s is a directory",
    async path => {
      const result = await run({ [path]: {}, "app/index.js": requireIt });
      expect({ ...result, stderr: "" }).toEqual(installed);
    },
  );

  test("on when no bunfig configures one", async () => {
    const files = {
      "home/.bunfig.toml": `[install]\nexact = true\n`,
      "bunfig.toml": `[install.security]\n`,
      "app/bunfig.toml": `[install]\nexact = true\n`,
      "app/index.js": requireIt,
    };
    expect(await run(files)).toEqual(installed);
  });
});

// https://github.com/oven-sh/bun/issues/14378: `bun install` routed `@corp/*`
// to the registry that `.npmrc` names, but the runtime's auto-install read
// only bunfig.toml and asked the default registry.
describe("auto-install reads the registries and credentials of .npmrc", () => {
  // An ASAN build starts too slowly to run all of these at the same time within the default timeout.
  const cell = test.concurrentIf(!isASAN);
  const token = "SECRET-TOKEN";

  type Seen = { registry: string; path: string; authorization: string | null };
  type Registries = { PRIVATE: string; DEFAULT: string };
  type Files = Record<string, string>;

  /** A directory path below `base` that is exactly `bytes` bytes long. It is not created. */
  function directoryPathOfLength(base: string, bytes: number): string {
    let path = base;
    while (path.length < bytes) {
      let name = Math.min(bytes - path.length - 1, 200);
      if (bytes - path.length - 1 - name === 1) name--;
      path = join(path, Buffer.alloc(name, "d").toString());
    }
    return path;
  }

  // Three packages at 1.0.0. Each one exports the name of the registry it came from.
  async function buildPackages(registry: string) {
    const packages: Record<string, { index: string; dependencies?: Record<string, string> }> = {
      "@corp/thing": { index: `module.exports = globalThis.servedBy = ${JSON.stringify(registry)};\n` },
      "plain-thing": { index: `module.exports = ${JSON.stringify(registry)};\n` },
      "@corp/with-dep": {
        index: `module.exports = ${JSON.stringify(registry)} + " " + require("plain-thing");\n`,
        dependencies: { "plain-thing": "1.0.0" },
      },
    };
    return Promise.all(
      Object.entries(packages).map(async ([name, { index, dependencies }]) => {
        const manifest = { name, version: "1.0.0", main: "index.js", dependencies };
        const tarball = await new Bun.Archive({
          "package/package.json": JSON.stringify(manifest),
          "package/index.js": index,
        }).bytes("gzip");
        const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64");
        return { name, manifest, tarball, integrity, tarballPath: `/${name}/-/${name.split("/").pop()}-1.0.0.tgz` };
      }),
    );
  }
  const built = { PRIVATE: buildPackages("PRIVATE"), DEFAULT: buildPackages("DEFAULT") };

  async function serveRegistry(registry: keyof typeof built, seen: Seen[]) {
    const packages = await built[registry];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        // The registry is mounted at `/` and at `/npm/`.
        const path = (URL.canParse(req.url) ? decodeURIComponent(new URL(req.url).pathname) : req.url).replace(
          /^\/npm\//,
          "/",
        );
        seen.push({ registry, path, authorization: req.headers.get("authorization") });
        for (const { name, manifest, tarball, integrity, tarballPath } of packages) {
          if (path === tarballPath) return new Response(tarball);
          if (path !== "/" + name) continue;
          const dist = { tarball: new URL(tarballPath, server.url).href, integrity };
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { ...manifest, dist } },
          });
        }
        return new Response("{}", { status: 404 });
      },
    });
    return server;
  }

  // Runs bun in `<dir>/app` with `<dir>/home` as the home directory. Both
  // registries serve the packages, and `BUN_CONFIG_REGISTRY` makes DEFAULT the
  // default registry, so only the `.npmrc` under test can lead to PRIVATE.
  async function autoInstall(options: {
    args: string[];
    files: (registries: Registries) => Files;
    env?: (registries: Registries, dir: string) => Record<string, string | undefined>;
    prepare?: (dir: string) => void;
    cwd?: (dir: string) => string;
    timeout?: number;
  }) {
    const seen: Seen[] = [];
    await using privateRegistry = await serveRegistry("PRIVATE", seen);
    await using defaultRegistry = await serveRegistry("DEFAULT", seen);
    const registries = { PRIVATE: privateRegistry.url.host, DEFAULT: defaultRegistry.url.host };

    using dir = tempDir("autoinstall-npmrc", { "home/.keep": "", ...options.files(registries) });
    const home = join(String(dir), "home");
    const env: Record<string, string | undefined> = {
      ...bunEnv,
      // bunEnv spreads process.env, and CI runners export some of these.
      XDG_CONFIG_HOME: undefined,
      NPM_CONFIG_USERCONFIG: undefined,
      npm_config_userconfig: undefined,
      NPM_CONFIG_REGISTRY: undefined,
      npm_config_registry: undefined,
      BUN_CONFIG_TOKEN: undefined,
      NPM_CONFIG_TOKEN: undefined,
      npm_config_token: undefined,
      HOME: home,
      USERPROFILE: home,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      BUN_CONFIG_REGISTRY: `http://${registries.DEFAULT}/`,
      ...options.env?.(registries, String(dir)),
    };
    options.prepare?.(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), ...options.args],
      cwd: options.cwd?.(String(dir)) ?? join(String(dir), "app"),
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeout,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const created = readdirSync(String(dir)).sort();
    return { stdout, stderr, seen, created, exitCode, signalCode: proc.signalCode };
  }

  const requests = (registry: string, pkg: string, authorization: string | null): Seen[] => [
    { registry, path: `/${pkg}`, authorization },
    { registry, path: `/${pkg}/-/${pkg.split("/").pop()}-1.0.0.tgz`, authorization },
  ];
  const fromPrivateRegistry = {
    stdout: "PRIVATE\n",
    stderr: "",
    seen: requests("PRIVATE", "@corp/thing", `Bearer ${token}`),
    created: ["app", "cache", "home"],
    exitCode: 0,
    signalCode: null,
  };

  const scopeAndToken = (r: Registries) => `@corp:registry=http://${r.PRIVATE}/\n//${r.PRIVATE}/:_authToken=${token}\n`;
  const importIt = `import servedBy from "@corp/thing";\nconsole.log(servedBy);\n`;
  const importLater = `const { default: servedBy } = await import("@corp/thing");\nconsole.log(servedBy);\n`;
  const inNodeModules = {
    "app/node_modules/@corp/thing/package.json": JSON.stringify({ name: "@corp/thing", version: "1.0.0" }),
    "app/node_modules/@corp/thing/index.js": `module.exports = "node_modules";\n`,
  };

  cell.each([
    ["bun <file>", ["x.mjs"], { "app/x.mjs": importIt }],
    ["bun -i <file>", ["-i", "x.mjs"], { "app/x.mjs": importIt }],
    ["bun -e", ["-e", importIt], {}],
    ["require()", ["x.cjs"], { "app/x.cjs": `console.log(require("@corp/thing"));\n` }],
    [
      "Bun.resolveSync()",
      ["x.cjs"],
      { "app/x.cjs": `console.log(require(Bun.resolveSync("@corp/thing", __dirname)));\n` },
    ],
    ["--preload", ["--preload", "@corp/thing", "x.mjs"], { "app/x.mjs": `console.log(globalThis.servedBy);\n` }],
  ] as [string, string[], Files][])("./.npmrc scope and token: %s", async (_, args, files) => {
    const result = await autoInstall({ args, files: r => ({ "app/.npmrc": scopeAndToken(r), ...files }) });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("./.npmrc scope and token beside a bunfig.toml that sets no registry", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/bunfig.toml": `[install]\nexact = true\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("~/.npmrc scope and token", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({ "home/.npmrc": scopeAndToken(r), "app/x.mjs": importIt }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("$XDG_CONFIG_HOME/.npmrc scope and token, in place of ~/.npmrc", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "xdg/.npmrc": scopeAndToken(r),
        "home/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        "app/x.mjs": importIt,
      }),
      env: (_, dir) => ({ XDG_CONFIG_HOME: join(dir, "xdg") }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "cache", "home", "xdg"] });
  });

  cell("./.npmrc registry= and token", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `registry=http://${r.PRIVATE}/\n//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/x.mjs": importIt,
      }),
      // Without `registry=` the default registry is https://registry.npmjs.org/.
      // The proxy sends such a request to DEFAULT, not to the internet.
      env: r => ({ BUN_CONFIG_REGISTRY: undefined, HTTPS_PROXY: `http://${r.DEFAULT}/` }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  // The line `jsr add` writes: a scope with no trailing slash and no credential.
  cell("./.npmrc scope without a credential", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.PRIVATE}\n`,
        "home/.npmrc": `//${r.DEFAULT}/:_authToken=${token}\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, seen: requests("PRIVATE", "@corp/thing", null) });
  });

  cell("~/.npmrc token for the ./.npmrc scope, and no token for an unscoped package", async () => {
    const result = await autoInstall({
      args: ["x.cjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.PRIVATE}/\n`,
        "home/.npmrc": `//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/x.cjs": `console.log(require("@corp/thing"), require("plain-thing"));\n`,
      }),
    });
    expect(result).toEqual({
      ...fromPrivateRegistry,
      stdout: "PRIVATE DEFAULT\n",
      seen: [...requests("PRIVATE", "@corp/thing", `Bearer ${token}`), ...requests("DEFAULT", "plain-thing", null)],
    });
  });

  cell("./.npmrc token for a scope whose URL is in bunfig.toml", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/bunfig.toml": `[install.scopes]\n"@corp" = "http://${r.PRIVATE}/"\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("a bunfig.toml scope overrides the ./.npmrc scope", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        "app/bunfig.toml": `[install.scopes]\n"@corp" = { url = "http://${r.PRIVATE}/", token = "${token}" }\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  // The runtime expands `${NAME}` from the environment the script runs with.
  // `bun install` loads `.env.production` in place of `.env.development`.
  cell.each([
    ["the process environment", {}, { MY_NPM_TOKEN: token }],
    ["./.env", { "app/.env": `MY_NPM_TOKEN=${token}\n` }, {}],
    ["./.env.development", { "app/.env.development": `MY_NPM_TOKEN=${token}\n` }, {}],
  ] as [string, Files, Record<string, string>][])("./.npmrc ${MY_NPM_TOKEN} from %s", async (_, files, env) => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.PRIVATE}/\n//${r.PRIVATE}/:_authToken=\${MY_NPM_TOKEN}\n`,
        "app/x.mjs": importIt,
        ...files,
      }),
      env: () => env,
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  // `.npmrc` is the one of the importing file's project, wherever the working directory is by then.
  cell.each([
    ["import()", "x.mjs", `process.chdir("../elsewhere");\n` + importLater],
    ["require()", "x.cjs", `process.chdir("../elsewhere");\nconsole.log(require("@corp/thing"));\n`],
  ])("./.npmrc of the start directory after process.chdir(): %s", async (_, file, source) => {
    const result = await autoInstall({
      args: [file],
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "elsewhere/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        [`app/${file}`]: source,
      }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "cache", "elsewhere", "home"] });
  });

  // docs/runtime/auto-install.mdx, "Project root"
  const bunfigScope = (r: Registries) =>
    `[install.scopes]\n"@corp" = { url = "http://${r.PRIVATE}/", token = "${token}" }\n`;
  const packageJson = JSON.stringify({ name: "app", dependencies: { "@corp/thing": "1.0.0" } });
  const fromDefaultRegistry = {
    ...fromPrivateRegistry,
    stdout: "DEFAULT\n",
    seen: requests("DEFAULT", "@corp/thing", null),
  };

  describe.each([
    [".npmrc", scopeAndToken],
    ["bunfig.toml", bunfigScope],
  ] as [string, (r: Registries) => string][])("%s of the project root", (name, settings) => {
    cell.each([
      [
        "in a folder of the project",
        "app/src",
        ["x.mjs"],
        { "app/package.json": packageJson, "app/src/x.mjs": importIt },
      ],
      ...[
        ["app", ["src/x.mjs"]],
        ["app/src", ["x.mjs"]],
        ["home", ["../app/src/x.mjs"]],
      ].map(([cwd, args]) => [
        `in ${cwd}, for a file beside a package.json that only has a type`,
        cwd,
        args,
        {
          "app/package.json": packageJson,
          "app/src/package.json": JSON.stringify({ type: "module" }),
          "app/src/x.mjs": importIt,
        },
      ]),
      ...[
        ["app/src", ["x.mjs"]],
        ["home", ["../app/src/x.mjs"]],
      ].flatMap(([cwd, args]) =>
        [{ type: "module" }, { private: true }, {}].map(root => [
          `in ${cwd}, where the package.json of the root is ${JSON.stringify(root)}`,
          cwd,
          args,
          {
            "app/package.json": JSON.stringify(root),
            "app/src/package.json": JSON.stringify({ type: "module" }),
            "app/src/x.mjs": importIt,
          },
        ]),
      ),
      [
        "in a member of the workspace",
        "app/packages/member",
        ["x.mjs"],
        {
          "app/package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
          "app/packages/member/package.json": JSON.stringify({ name: "member" }),
          "app/packages/member/x.mjs": importIt,
        },
      ],
      [
        "outside the project",
        "home",
        ["../app/src/x.mjs"],
        { "app/package.json": packageJson, "app/src/x.mjs": importIt },
      ],
      ["outside a folder without a package.json", "home", ["../app/x.mjs"], { "app/x.mjs": importIt }],
      [
        "outside the project, for a package in its node_modules",
        "home",
        ["-i", "../app/x.mjs"],
        {
          "app/package.json": packageJson,
          "app/x.mjs": `import servedBy from "has-dep";\nconsole.log(servedBy);\n`,
          "app/node_modules/has-dep/package.json": JSON.stringify({ name: "has-dep", version: "1.0.0" }),
          "app/node_modules/has-dep/index.js": `module.exports = require("@corp/thing");\n`,
        },
      ],
    ] as [string, string, string[], Files][])("started %s", async (_, cwd, args, files) => {
      const result = await autoInstall({
        args,
        cwd: dir => join(dir, cwd),
        files: r => ({ [`app/${name}`]: settings(r), ...files }),
      });
      expect(result).toEqual(fromPrivateRegistry);
    });

    cell.each([
      ["a project", { "app/inner/package.json": packageJson }],
      ["a folder without a package.json", {}],
      [
        "a workspace that does not list the project",
        {
          "app/package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
          "app/inner/package.json": packageJson,
        },
      ],
    ] as [string, Files][])("is not the one above %s", async (_, files) => {
      const result = await autoInstall({
        args: ["x.mjs"],
        cwd: dir => join(dir, "app", "inner"),
        files: r => ({ [`app/${name}`]: settings(r), "app/inner/x.mjs": importIt, ...files }),
      });
      expect(result).toEqual(fromDefaultRegistry);
    });
  });

  // `app` is the project of `app/<folder>` if `bun install` in that folder says so.
  cell.each([
    [true, "packages/member", ["packages/*"]],
    [true, "packages/member", ["./packages/*/"]],
    [true, "packages/member", ["packages/member"]],
    [true, "packages/member", ["./packages/../packages/member/"]],
    [true, "packages/member", ["packages/**"]],
    [true, "packages/member", ["other/*", "{apps,packages}/m*"]],
    [true, "packages/member", ["packages/[lm]ember"]],
    [true, "packages/deep/member", ["packages/**"]],
    [true, "packages/member", ["!packages/member", "packages/member"]],
    [true, "packages/member", ["packages/*", "!packages/other"]],
    [true, "packages/.member", ["packages/.*"]],
    // A group with a separator in it: the scan of `bun install` and this check read the pattern the same way.
    [true, "packages/member", ["{apps/web,packages/*}"]],
    [true, "packages/deep/member", ["@(apps/web|packages/deep/m*)"]],
    [false, "packages/member", ["{apps/web,packages/*/x}"]],
    [false, "packages/member", ["apps/*"]],
    [false, "packages/member", ["packages"]],
    [false, "packages/member", ["packages/*/*"]],
    [false, "packages/deep/member", ["packages/*"]],
    [false, "packages/member", ["packages/*", "!packages/member"]],
    [false, "packages/member", ["!packages/m*", "packages/*"]],
    [false, "packages/member", ["packages/*", "!packages/**"]],
    [false, "packages/.member", ["packages/*"]],
    [false, "packages/.git/member", ["packages/**"]],
    [false, "packages/member", ["packages/*", 1]],
    [false, "packages/member", []],
  ] as [boolean, string, unknown[]][])("is a member: %p, %s of %j", async (isMember, folder, workspaces) => {
    const result = await autoInstall({
      args: ["x.mjs"],
      cwd: dir => join(dir, "app", folder),
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/package.json": JSON.stringify({ name: "app", workspaces }),
        [`app/${folder}/package.json`]: JSON.stringify({ name: "member" }),
        [`app/${folder}/x.mjs`]: importIt,
      }),
    });
    expect(result).toEqual(isMember ? fromPrivateRegistry : fromDefaultRegistry);
  });

  cell("a folder that `workspaces` matches is no member without a name", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      cwd: dir => join(dir, "app", "packages", "member"),
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
        "app/packages/member/package.json": JSON.stringify({ dependencies: { "@corp/thing": "1.0.0" } }),
        "app/packages/member/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromDefaultRegistry);
  });

  // Reading an empty package.json ends the process.
  cell("the other members are not read when bun.lock has them", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      cwd: dir => join(dir, "app", "packages", "member"),
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
        "app/bun.lock": JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: {
            "": { name: "app" },
            "packages/member": { name: "member" },
            "packages/other": { name: "other" },
          },
          packages: { member: ["member@workspace:packages/member"], other: ["other@workspace:packages/other"] },
        }),
        "app/packages/member/package.json": JSON.stringify({ name: "member" }),
        "app/packages/member/x.mjs": importIt,
        "app/packages/other/package.json": "",
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("a member with an empty package.json is passed over when there is no bun.lock", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      cwd: dir => join(dir, "app", "packages", "member"),
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/package.json": JSON.stringify({ name: "app", workspaces: ["packages/*", "listed"] }),
        "app/packages/member/package.json": JSON.stringify({ name: "member" }),
        "app/packages/member/x.mjs": importIt,
        "app/packages/other/package.json": "",
        "app/listed/package.json": "",
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  // `app/packages/member` is a link to `outside/up/member`, and bun is started in it by that name.
  describe.skipIf(isWindows)("a member that is a link to a folder outside the workspace root", () => {
    const scanner = `[install.security]\nscanner = "./scanner.ts"\n`;
    const created = ["app", "cache", "home", "outside"];
    const inLinkedMember = (files: (r: Registries) => Files) =>
      autoInstall({
        args: ["x.mjs"],
        cwd: dir => join(dir, "app", "packages", "member"),
        env: (_, dir) => ({ PWD: join(dir, "app", "packages", "member") }),
        prepare: dir =>
          symlinkSync(join("..", "..", "outside", "up", "member"), join(dir, "app", "packages", "member")),
        files: r => ({
          "app/package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
          "app/packages/.keep": "",
          "outside/up/member/package.json": JSON.stringify({ name: "member" }),
          "outside/up/member/x.mjs": importIt,
          ...files(r),
        }),
      });

    cell.each([
      [".npmrc", scopeAndToken],
      ["bunfig.toml", bunfigScope],
    ] as [string, (r: Registries) => string][])("the %s of the root counts", async (name, settings) => {
      expect(await inLinkedMember(r => ({ [`app/${name}`]: settings(r) }))).toEqual({
        ...fromPrivateRegistry,
        created,
      });
    });

    cell.each([
      ["outside/up/.npmrc", scopeAndToken],
      ["outside/.npmrc", scopeAndToken],
      ["outside/up/bunfig.toml", bunfigScope],
      ["outside/bunfig.toml", () => scanner],
    ] as [string, (r: Registries) => string][])("%s, above what the link leads to, is not read", async (path, text) => {
      expect(await inLinkedMember(r => ({ [path]: text(r) }))).toEqual({ ...fromDefaultRegistry, created });
    });

    cell("the .npmrc of the member overrides the one of the root", async () => {
      const result = await inLinkedMember(r => ({
        "app/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        "outside/up/member/.npmrc": scopeAndToken(r),
      }));
      expect(result).toEqual({ ...fromPrivateRegistry, created });
    });

    cell("a scanner in the bunfig.toml of the root turns auto-install off", async () => {
      const result = await inLinkedMember(() => ({ "app/bunfig.toml": scanner }));
      expect(result.stderr).toContain("auto-install is off because a security scanner is configured");
      expect({ ...result, stderr: "" }).toEqual({
        ...fromPrivateRegistry,
        stdout: "",
        seen: [],
        created: ["app", "home", "outside"],
        exitCode: 1,
      });
    });
  });

  const projectInProject = {
    "app/package.json": JSON.stringify({ name: "app" }),
    "app/examples/package.json": packageJson,
    "app/examples/x.mjs": importIt,
  };

  cell("the .npmrc of the start directory counts for a file of another project", async () => {
    const result = await autoInstall({
      args: ["examples/x.mjs"],
      files: r => ({ "app/.npmrc": scopeAndToken(r), ...projectInProject }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("a .npmrc between the importing file and the project root counts beside the one of the root", async () => {
    const result = await autoInstall({
      args: ["../app/src/x.mjs"],
      cwd: dir => join(dir, "home"),
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.PRIVATE}/\n`,
        "app/package.json": packageJson,
        "app/src/.npmrc": `//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/src/package.json": JSON.stringify({ type: "module" }),
        "app/src/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("the .npmrc of the project overrides the one of the start directory", async () => {
    const result = await autoInstall({
      args: ["examples/x.mjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        "app/examples/.npmrc": scopeAndToken(r),
        ...projectInProject,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("the bunfig.toml of the start directory overrides the one of the project root", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      cwd: dir => join(dir, "app", "src"),
      files: r => ({
        "app/bunfig.toml": `[install.scopes]\n"@corp" = "http://${r.DEFAULT}/"\n`,
        "app/package.json": packageJson,
        "app/src/bunfig.toml": bunfigScope(r),
        "app/src/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell.each([
    ["bunfig.toml", (r: Registries) => `[install.scopes]\n"@corp" = "http://${r.DEFAULT}/"\n`, bunfigScope],
    [".npmrc", (r: Registries) => `@corp:registry=http://${r.DEFAULT}/\n`, scopeAndToken],
  ])("a %s nearer to the importing file overrides the one of the start directory", async (name, above, nearer) => {
    const result = await autoInstall({
      args: ["src/x.mjs"],
      files: r => ({
        [`app/${name}`]: above(r),
        "app/package.json": packageJson,
        [`app/src/${name}`]: nearer(r),
        "app/src/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("the bunfig.toml of the project overrides the one of a start directory outside it", async () => {
    const result = await autoInstall({
      args: ["../app/x.mjs"],
      cwd: dir => join(dir, "home"),
      files: r => ({
        "home/bunfig.toml": `[install.scopes]\n"@corp" = "http://${r.DEFAULT}/"\n`,
        "app/bunfig.toml": bunfigScope(r),
        "app/package.json": packageJson,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("a relative cache directory in the bunfig.toml of the project root starts there", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      cwd: dir => join(dir, "app", "src"),
      files: r => ({
        "app/bunfig.toml": bunfigScope(r) + `[install.cache]\ndir = "../root-cache"\n`,
        "app/package.json": packageJson,
        "app/src/x.mjs": importIt,
      }),
      env: () => ({ BUN_INSTALL_CACHE_DIR: undefined }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "home", "root-cache"] });
  });

  cell("a ./.npmrc written before the first auto-install", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/x.mjs":
          `import { writeFileSync } from "node:fs";\n` +
          `writeFileSync(".npmrc", ${JSON.stringify(scopeAndToken(r))});\n` +
          importLater,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("a scoped package's unscoped dependency comes from the default registry, without the token", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/x.mjs": `import servedBy from "@corp/with-dep";\nconsole.log(servedBy);\n`,
      }),
    });
    const byPath = (a: Seen, b: Seen) => a.path.localeCompare(b.path);
    expect({ ...result, seen: result.seen.sort(byPath) }).toEqual({
      ...fromPrivateRegistry,
      stdout: "PRIVATE DEFAULT\n",
      seen: [
        ...requests("PRIVATE", "@corp/with-dep", `Bearer ${token}`),
        ...requests("DEFAULT", "plain-thing", null),
      ].sort(byPath),
    });
  });

  // `bun install` takes `cache=` from .npmrc and warns about `certfile=`.
  // The runtime takes the registries only and prints nothing.
  cell("other ./.npmrc keys do not reach the runtime", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": scopeAndToken(r) + `cache=../npmrc-cache\n//${r.PRIVATE}/:certfile=/nope.pem\n`,
        "app/x.mjs": importIt,
      }),
      env: (_, dir) => ({ BUN_INSTALL_CACHE_DIR: undefined, BUN_INSTALL: join(dir, "bun-install") }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "bun-install", "home"] });
  });

  // Neither `.npmrc` path fits in a path buffer, so the default registry is used.
  cell.skipIf(!isLinux)("a start directory and a home directory at the path length limit", async () => {
    const atLimit = (dir: string, name: string) => directoryPathOfLength(join(dir, name), 4092);
    const result = await autoInstall({
      args: ["-e", `console.log(require("@corp/thing"));`],
      files: () => ({}),
      env: (_, dir) => ({ HOME: atLimit(dir, "home") }),
      prepare: dir => {
        mkdirSync(atLimit(dir, "app"), { recursive: true });
        mkdirSync(atLimit(dir, "home"), { recursive: true });
      },
      cwd: dir => atLimit(dir, "app"),
    });
    expect(result).toEqual({
      ...fromPrivateRegistry,
      stdout: "DEFAULT\n",
      seen: requests("DEFAULT", "@corp/thing", null),
    });
  });

  cell("nothing is printed and no registry is asked when node_modules has the package", async () => {
    const broken = (r: Registries) => `@corp:registry=http://${r.DEFAULT}/\n//${r.DEFAULT}/:certfile=/nope.pem\n`;
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({ ...inNodeModules, "app/.npmrc": broken(r), "home/.npmrc": broken(r), "app/x.mjs": importIt }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, stdout: "node_modules\n", seen: [], created: ["app", "home"] });
  });

  // Opening a FIFO for reading blocks until a writer shows up, which never
  // happens. The timeout only turns that hang into a failure.
  cell.skipIf(isWindows)("no .npmrc is opened when node_modules has the package", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: () => ({ ...inNodeModules, "app/x.mjs": importIt }),
      prepare: dir => {
        mkfifo(join(dir, "app", ".npmrc"));
        mkfifo(join(dir, "home", ".npmrc"));
      },
      timeout: 30_000,
    });
    expect(result).toEqual({ ...fromPrivateRegistry, stdout: "node_modules\n", seen: [], created: ["app", "home"] });
  });

  cell("$NPM_CONFIG_USERCONFIG scope and token, in place of ~/.npmrc", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "user/npmrc": scopeAndToken(r),
        "home/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        "app/x.mjs": importIt,
      }),
      env: (_, dir) => ({ NPM_CONFIG_USERCONFIG: join(dir, "user", "npmrc") }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "cache", "home", "user"] });
  });

  cell("~/.npmrc token on the host, for a bunfig.toml scope under a path of it", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "home/.npmrc": `//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/bunfig.toml": `[install.scopes]\n"@corp" = "http://${r.PRIVATE}/npm/"\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell('~/.npmrc token where the bunfig.toml scope has token = "$UNSET"', async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "home/.npmrc": `//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/bunfig.toml": `[install.scopes]\n"@corp" = { url = "http://${r.PRIVATE}/", token = "$UNSET_AUTOINSTALL_TOKEN" }\n`,
        "app/x.mjs": importIt,
      }),
      env: () => ({ UNSET_AUTOINSTALL_TOKEN: undefined }),
    });
    expect(result).toEqual({
      ...fromPrivateRegistry,
      stderr: expect.stringContaining("$UNSET_AUTOINSTALL_TOKEN"),
    });
  });

  // A manifest names the tarball URL, so at run time too it can summon a line of ~/.npmrc, but never into cleartext.
  cell.each([
    ["https", `Bearer ${token}`],
    ["http", null],
  ])("a tarball on another %s host that ~/.npmrc has a line for", async (scheme, authorization) => {
    const thing = (await built.PRIVATE).find(pkg => pkg.name === "@corp/thing")!;
    const seen: (string | null)[] = [];
    await using cdn = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(scheme === "https" ? { tls } : {}),
      fetch(req) {
        seen.push(req.headers.get("authorization"));
        return new Response(thing.tarball);
      },
    });
    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        const dist = { tarball: `${scheme}://127.0.0.1:${cdn.port}/files/thing-1.0.0.tgz`, integrity: thing.integrity };
        return Response.json({
          name: thing.name,
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { ...thing.manifest, dist } },
        });
      },
    });
    const result = await autoInstall({
      args: ["x.mjs"],
      files: () => ({
        "home/.npmrc": `//127.0.0.1:${cdn.port}/:_authToken=${token}\n`,
        "app/.npmrc": `@corp:registry=http://127.0.0.1:${registry.port}/\n`,
        "app/x.mjs": importIt,
        "cert.pem": tls.cert,
      }),
      env: (_, dir) => ({ NODE_EXTRA_CA_CERTS: join(dir, "cert.pem") }),
    });
    expect({ stdout: result.stdout, seen }).toEqual({ stdout: "PRIVATE\n", seen: [authorization] });
    expect(result.exitCode).toBe(0);
  });
});
