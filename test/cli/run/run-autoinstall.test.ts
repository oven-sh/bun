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

// Serves the `no-deps` fixture (versions 1.0.0, 1.0.1, 1.1.0 and 2.0.0, with
// `latest` pointing at 2.0.0) and records every request path, so a test can
// tell which version auto-install decided to download.
function noDepsRegistry() {
  const fixtures = join(import.meta.dir, "..", "install", "registry", "packages", "no-deps");
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const pathname = new URL(req.url).pathname;
      requests.push(pathname);
      if (pathname === "/no-deps") {
        const manifest = await Bun.file(join(fixtures, "package.json")).text();
        return Response.json(
          JSON.parse(manifest.replaceAll("http://localhost:4873", `http://127.0.0.1:${server.port}`)),
        );
      }
      const tgz = pathname.match(/^\/no-deps\/-\/(no-deps-[\d.]+\.tgz)$/);
      if (tgz) return new Response(Bun.file(join(fixtures, tgz[1])));
      return new Response("not found", { status: 404 });
    },
  });
  return {
    requests,
    bunfig: `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
    tarballs: () => requests.filter(p => p.endsWith(".tgz")),
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

async function runAutoInstall(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
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
    using registry = noDepsRegistry();
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
    using registry = noDepsRegistry();
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
    using registry = noDepsRegistry();
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
    using registry = noDepsRegistry();
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
    using registry = noDepsRegistry();
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
    using registry = noDepsRegistry();
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
    using registry = noDepsRegistry();
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
    using registry = noDepsRegistry();
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

// `bun install` lowers the process-wide cap on concurrent HTTP requests when a download keeps
// failing at the connection level, and nothing raises the cap again. The runtime's package manager
// shares that cap with fetch() and lives as long as the program: one failed auto-install left the
// program's own fetch() calls at 4 at a time.
describe.concurrent("a failed auto-install download does not lower the concurrency of fetch()", () => {
  const fixture = /* js */ `
    // A burst is as large as the cap: all of it is in flight at once only while the cap is whole.
    const requests = Number(process.env.BUN_CONFIG_MAX_HTTP_REQUESTS);
    let inFlight = 0;
    let release;
    // Holds every response until all the requests of a burst are in flight at once.
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

// Without node_modules the runtime keeps one package manager for the life of
// the process. A manifest request that failed stayed recorded in it as "already
// requested", so every later resolve of that name failed without a request,
// also after the registry was healthy again.
describe.concurrent("a failed registry lookup is asked again by the next resolve", () => {
  // Fails every manifest request with `respond` until the script asks for /__heal.
  // The script asks for /__next between its resolves: `lookups` is one list of requests per resolve.
  function flakyRegistry(respond: (deadPort: number) => Response) {
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
        if (pathname.endsWith(".tgz")) return new Response(tarballs.get(pathname));
        if (!healthy) return respond(dead.port);
        const name = pathname.slice(1);
        const tarball = await new Bun.Archive(
          {
            "package/package.json": JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
            "package/index.js": "module.exports = { version: '1.0.0' };",
          },
          { compress: "gzip" },
        ).bytes();
        tarballs.set(`/${name}/-/${name}-1.0.0.tgz`, tarball);
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

  async function run(registry: { url: string }, script: string, env: Record<string, string | undefined> = {}) {
    using dir = tempDir("autoinstall-failed-lookup", {
      "bunfig.toml": `[install]\nregistry = "${registry.url}"\n`,
      "index.js": `const registry = ${JSON.stringify(registry.url)};\n${script}`,
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

  // A resolve that misses runs the resolver a second time, which is a second lookup.
  function expectLookups(requests: string[], path: string, requestsPerLookup: number) {
    expect(requests).toBeOneOf([Array(requestsPerLookup).fill(path), Array(2 * requestsPerLookup).fill(path)]);
  }

  const failures: Record<string, { respond: (deadPort: number) => Response; requestsPerLookup: number; busy?: true }> =
    {
      "404": { respond: () => new Response("{}", { status: 404 }), requestsPerLookup: 1 },
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
      // The wait for the registry runs the event loop. While a microtask keeps that turn busy, the
      // response lands, and the module queue's poll handles the failure in place of the waiter.
      // The spin only steers which of the two handles it: every assertion holds for both.
      "404 while the event loop is busy": {
        respond: () => new Response("{}", { status: 404 }),
        requestsPerLookup: 1,
        busy: true,
      },
    };

  test.each(Object.entries(failures))("%s", async (_, { respond, requestsPerLookup, busy }) => {
    using registry = flakyRegistry(respond);
    const { stdout, exitCode } = await run(
      registry,
      `
        const attempt = () => {
          ${busy ? "queueMicrotask(() => { const end = performance.now() + 100; while (performance.now() < end); });" : ""}
          try { return require("flaky-pkg").version; } catch (e) { return e.code; }
        };
        const results = [attempt()];
        await fetch(registry + "__next");
        results.push(attempt());
        await fetch(registry + "__heal");
        await fetch(registry + "__next");
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

  test("through every way to resolve", async () => {
    using registry = flakyRegistry(() => new Response("{}", { status: 404 }));
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
          await fetch(registry + "__break");
          const broken = await attempt();
          await fetch(registry + "__next");
          await fetch(registry + "__heal");
          results[way] = [broken, await attempt()];
          await fetch(registry + "__next");
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
});
