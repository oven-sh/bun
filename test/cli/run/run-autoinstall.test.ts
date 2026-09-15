import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
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
    const { stderr } = await runWithCache(app, cache, "index.js");
    expect(stderr).not.toContain("git clone");
    // A git package is checked out into `@G@<commit>` in the cache.
    expect(await Bun.file(join(cache, `@G@${commit}`, "package.json")).json()).toEqual({
      name: "git-dep",
      version: "1.0.0",
    });
  });

  // The versions of a package.json are only parsed once the package manager
  // exists, and the first bare import creates it. So the two tests below import
  // left-pad first and declare their dependencies in a directory that is read
  // after that.

  // The parse of sub/package.json recorded its alias in the package manager,
  // which reads those with the lockfile's strings. one-range-dep depends on
  // the real no-deps@^1.0.0, and bun looked that up as `/0.0.tgzon`.
  test("npm: alias under the name of a package that another package depends on", async () => {
    using registry = fixtureRegistry();
    using dir = tempDir("autoinstall-alias-key", {
      "package.json": JSON.stringify({ name: "root" }),
      "index.js": `require("left-pad");\nrequire("./sub/index.js");\n`,
      "sub/package.json": JSON.stringify({ name: "sub", dependencies: { "no-deps": "npm:is-number@1.0.0" } }),
      // The index.js of one-range-dep exports its package.json, with each
      // dependency replaced by what `require` gives for it.
      "sub/index.js": `const dep = require("one-range-dep").dependencies["no-deps"];\nconsole.log(dep.name + "@" + dep.version);\n`,
      "bunfig.toml": registry.bunfig,
    });

    const { stdout, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("no-deps@1.1.0\n");
    expect(registry.requests.toSorted()).toEqual([
      "/left-pad",
      "/left-pad/-/left-pad-1.0.0.tgz",
      "/no-deps",
      "/no-deps/-/no-deps-1.1.0.tgz",
      "/one-range-dep",
      "/one-range-dep/-/one-range-dep-1.0.0.tgz",
    ]);
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

    const { stdout, exitCode } = await runWithCache(String(dir), join(String(dir), ".bun-cache"), "index.js");
    expect(stdout).toBe("a 5.0.0-alpha.150\nb MODULE_NOT_FOUND\n");
    expect(exitCode).toBe(0);
  });
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
