import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

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

    expect(stderr).toContain("while resolving package 'pkg-with-bad-tarball-url' from");
    expect(noteLines(stderr)).toEqual([
      'note: Expected tarball URL to start with https:// or http://, got "not a url" while fetching package "pkg-with-bad-tarball-url"',
      'note: InvalidURL while resolving package "pkg-with-bad-tarball-url"',
    ]);
    expect(exitCode).toBe(1);
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
