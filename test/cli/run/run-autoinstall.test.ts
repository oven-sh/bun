import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join } from "path";
import { pathToFileURL } from "url";

//   --install=<val>                 Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always).
//   -i                              Auto-install dependencies during execution. Equivalent to --install=fallback.

describe("basic autoinstall", () => {
  for (const install of ["", "-i", "--install=auto", "--install=fallback", "--install=force"]) {
    for (const has_node_modules of [true, false]) {
      let should_install = false;
      if (has_node_modules) {
        if (install === "" || install === "--install=auto") {
          should_install = false;
        } else {
          should_install = true;
        }
      } else {
        should_install = true;
      }

      test(`${install || "<no flag>"} ${has_node_modules ? "with" : "without"} node_modules ${should_install ? "should" : "should not"} autoinstall`, async () => {
        const dir = tmpdirSync();
        mkdirSync(dir, { recursive: true });
        await Bun.write(join(dir, "index.js"), "import isEven from 'is-even'; console.log(isEven(2));");
        const env = bunEnv;
        env.BUN_INSTALL = install;
        if (has_node_modules) {
          mkdirSync(join(dir, "node_modules/abc"), { recursive: true });
        }
        const { stdout, stderr } = Bun.spawnSync({
          cmd: [bunExe(), ...(install === "" ? [] : [install]), join(dir, "index.js")],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });

        if (should_install) {
          expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-even'");
          expect(stdout?.toString("utf8")).toBe("true\n");
        } else {
          expect(stderr?.toString("utf8")).toContain("error: Cannot find package 'is-even'");
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
// the path of every request, in order.
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
    bunfig: `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

const gitEnv = {
  ...bunEnv,
  // Set on the asan lanes, where it makes bun kill its own git clones (#33982).
  BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function git(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${stderr}`);
  return stdout.trim();
}

async function runWithCache(cwd: string, cache: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...gitEnv, BUN_INSTALL_CACHE_DIR: cache },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A part of a dependency version that is longer than 8 bytes (the name an
// alias points at, a git URL, a pre-release tag) is stored as an offset into
// the package.json source. The resolver computed those offsets from the start
// of the version string, and some readers took them as offsets into the
// lockfile's strings.
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

    const { stdout, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe(target + "\n");
    // `/my-alias` is the lookup of the name as written, which comes first. For
    // is-number the second lookup was `/me%22:%22app%22`, bytes 4 to 12 of the
    // package.json.
    const [name, version] = target.split("@");
    expect(registry.requests.filter(path => path !== "/my-alias")).toEqual([
      `/${name}`,
      `/${name}/-/${name}-${version}.tgz`,
    ]);
    expect(exitCode).toBe(0);
  });

  // Only a package from the registry can be loaded out of the cache so far, so
  // the import below still fails once the clone is there. What this checks is
  // that bun hands git the URL from the package.json.
  test("git URL", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-git-url", {
      "git-dep/package.json": JSON.stringify({ name: "git-dep", version: "1.0.0" }),
      "git-dep/index.js": `module.exports = "from git";\n`,
      "app/index.js": `import marker from "git-dep";\nconsole.log(marker);\n`,
      "app/bunfig.toml": registry.bunfig,
    });
    const repo = join(String(dir), "git-dep");
    await git(repo, "init", "-q");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-q", "-m", "init", "--no-gpg-sign");
    const commit = await git(repo, "rev-parse", "HEAD");
    const app = join(String(dir), "app");
    await Bun.write(
      join(app, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "git-dep": `git+${pathToFileURL(repo)}` } }),
    );

    const cache = join(String(dir), "cache");
    const { stdout, stderr, exitCode } = await runWithCache(app, cache, "index.js");
    expect(stderr).not.toContain("git clone");
    // A git package is checked out into `@G@<commit>` in the cache.
    expect(await Bun.file(join(cache, `@G@${commit}`, "package.json")).json()).toEqual({
      name: "git-dep",
      version: "1.0.0",
    });
    expect(stderr).toContain("Cannot find package 'git-dep'");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  // A value with an escape is not a slice of the source, so it has no offset
  // into it. bun records the dependency by name only, and an import of it asks
  // for the name as written, like an import that no package.json lists.
  test("value with a JSON escape", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-escaped-value", {
      "package.json": String.raw`{"name":"app","dependencies":{"my-alias":"npm:is-number@\u0031.0.0"}}`,
      "index.js": `try {\n  require("my-alias");\n} catch (e) {\n  console.log(e.code);\n}\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("MODULE_NOT_FOUND\n");
    expect([...new Set(registry.requests)]).toEqual(["/my-alias"]);
    expect(exitCode).toBe(0);
  });

  // The versions of a package.json are only parsed once the package manager
  // exists, and the first bare import creates it. So the tests below import
  // another package first and declare their dependencies in a directory that
  // is read after that.

  // one-range-dep depends on no-deps@^1.0.0. The alias of sub/ has that name
  // and a version in that range, so one-range-dep gets the target of the alias,
  // as it does from `bun install`. The package manager reads a recorded alias
  // with the lockfile's strings, and the parse of sub/package.json recorded it
  // with offsets into sub/package.json: bun asked for `/:%2f%2f127.0.`. A
  // target name of up to 8 bytes is inline and has no offset.
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

      const { stdout, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
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

    const { stdout, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("a 5.0.0-alpha.150\nb MODULE_NOT_FOUND\n");
    expect(exitCode).toBe(0);
  });
});

const printNoDepsVersion = `console.log(require("no-deps/package.json").version);\n`;

// docs/runtime/auto-install.mdx: a bare import installs the version range the
// nearest package.json declares for it, and only `latest` when no package.json
// lists the package. The no-deps fixture has 1.0.0, 1.0.1, 1.1.0 and 2.0.0.
describe.concurrent("auto-install uses the version range from the nearest package.json", () => {
  // The project's package.json is read while the entry point resolves, before
  // the first bare import creates the package manager.
  test.each(["index.js", "run index.js"])("bun %s from the project directory", async args => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^1.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(
      String(dir),
      join(String(dir), ".bun-cache"),
      ...args.split(" "),
    );
    expect(stdout).toBe("1.1.0\n");
    expect(stderr).toBe("");
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-1.1.0.tgz"]);
    expect(exitCode).toBe(0);
  });

  test("package.json in a directory below the cwd, without a name", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-nested", {
      "bunfig.toml": registry.bunfig,
      "app/package.json": JSON.stringify({ dependencies: { "no-deps": "~1.0.0" } }),
      "app/index.js": printNoDepsVersion,
    });

    const { stdout, stderr, exitCode } = await runWithCache(
      String(dir),
      join(String(dir), ".bun-cache"),
      "app/index.js",
    );
    expect(stdout).toBe("1.0.1\n");
    expect(stderr).toBe("");
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-1.0.1.tgz"]);
    expect(exitCode).toBe(0);
  });

  // sub/package.json is read before the first bare import, when it is the
  // import of ./sub/index.js that triggers it.
  test("package.json of a directory read before the first auto-install", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-order", {
      "package.json": JSON.stringify({ name: "root" }),
      "index.js": `require("./sub/index.js");\n`,
      "sub/package.json": JSON.stringify({ name: "sub", dependencies: { "no-deps": "1.0.0" } }),
      "sub/index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("1.0.0\n");
    expect(stderr).toBe("");
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-1.0.0.tgz"]);
    expect(exitCode).toBe(0);
  });

  // The nearest package.json that lists the package wins, as for a package
  // inside node_modules that declares its own.
  test("an enclosing package.json with no dependencies is skipped", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-skip", {
      "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.1" } }),
      "sub/package.json": JSON.stringify({ name: "sub" }),
      "sub/index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(
      String(dir),
      join(String(dir), ".bun-cache"),
      "sub/index.js",
    );
    expect(stdout).toBe("1.0.1\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("a nearer package.json that does not list the package is skipped", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-hoisted", {
      "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.1" } }),
      "app/package.json": JSON.stringify({ name: "app", dependencies: { "left-pad": "1.0.0" } }),
      "app/index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(
      String(dir),
      join(String(dir), ".bun-cache"),
      "app/index.js",
    );
    expect(stdout).toBe("1.0.1\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // With node_modules present, --install=fallback installs what is missing.
  // The version comes from the project's package.json here too.
  test("--install=fallback with a node_modules that lacks the package", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-fallback", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^1.0.0" } }),
      "node_modules/.keep": "",
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(
      String(dir),
      join(String(dir), ".bun-cache"),
      "--install=fallback",
      "index.js",
    );
    expect(stdout).toBe("1.1.0\n");
    expect(stderr).toBe("");
    expect(registry.requests).toEqual(["/no-deps", "/no-deps/-/no-deps-1.1.0.tgz"]);
    expect(exitCode).toBe(0);
  });

  test("devDependencies of the project count", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-dev", {
      "package.json": JSON.stringify({ name: "app", devDependencies: { "no-deps": "~1.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("1.0.1\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // The range only applies to an import with no version of its own.
  test("an import with its own version is not replaced by the range", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-specifier", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^1.0.0" } }),
      "index.js": `console.log(require("no-deps@2.0.0/package.json").version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("2.0.0\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("a range nothing in the registry satisfies is an error, not latest", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-unsatisfiable", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "^3.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module 'no-deps/package.json'");
    expect(registry.requests).toEqual(["/no-deps"]);
    expect(exitCode).toBe(1);
  });

  test("a package the package.json does not list installs latest", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-range-unlisted", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "left-pad": "^1.0.0" } }),
      "index.js": printNoDepsVersion,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, stderr, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("2.0.0\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// A minimal gzipped npm tarball: one regular file per entry, under `package/`.
function tarball(files: Record<string, string>) {
  const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";
  const chunks: Buffer[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const body = Buffer.from(contents);
    const header = Buffer.alloc(512, 0);
    header.write("package/" + name, 0, 100, "utf8");
    header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(body.length, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(" ", 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(octal(sum, 8), 148);
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const tgz = gzipSync(Buffer.concat(chunks));
  return { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") };
}

// Inside an installed package only the package root's dependencies count.
// `@hiveio/hive-js` ships `lib/auth/ecc/package.json` with `"bs58": "^3.0.0"`
// while its root declares `^4.0.0`; a `require("bs58")` below the nested file
// asked for a version that was never installed (#6988).
test("a package.json nested inside an installed package does not override the package root", async () => {
  const inner = tarball({
    "package.json": JSON.stringify({ name: "inner", version: "2.0.0", main: "index.js" }),
    "index.js": `module.exports = "inner@2.0.0";\n`,
  });
  const outer = tarball({
    "package.json": JSON.stringify({
      name: "outer",
      version: "1.0.0",
      main: "lib/sub/src/entry.js",
      dependencies: { inner: "^2.0.0" },
    }),
    "lib/sub/package.json": JSON.stringify({ name: "sub", version: "1.0.0", dependencies: { inner: "^1.0.0" } }),
    "lib/sub/src/entry.js": `module.exports = require("inner");\n`,
  });
  const manifest = (name: string, version: string, tgz: { integrity: string }, dependencies = {}) => ({
    name,
    "dist-tags": { latest: version },
    versions: {
      [version]: {
        name,
        version,
        dependencies,
        dist: { integrity: tgz.integrity, tarball: `http://127.0.0.1:${server.port}/${name}/-/${name}-${version}.tgz` },
      },
    },
  });
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/outer") return Response.json(manifest("outer", "1.0.0", outer, { inner: "^2.0.0" }));
      if (pathname === "/inner") return Response.json(manifest("inner", "2.0.0", inner));
      if (pathname === "/outer/-/outer-1.0.0.tgz") return new Response(outer.tgz);
      if (pathname === "/inner/-/inner-2.0.0.tgz") return new Response(inner.tgz);
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("autoinstall-nested-package-json", {
    "index.js": `console.log(require("outer"));\n`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
  });

  const { stdout, stderr, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
  expect(stdout).toBe("inner@2.0.0\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("--install=fallback to install missing packages", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(dir, "index.js"),
      "import isEven from 'is-even'; import isOdd from 'is-odd'; console.log(isEven(2), isOdd(2));",
    ),
    Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {
          "is-odd": "1.0.0",
        },
      }),
    ),
  ]);

  Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "--install=fallback", join(dir, "index.js")],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-odd'");
  expect(stdout?.toString("utf8")).toBe("true false\n");
});
