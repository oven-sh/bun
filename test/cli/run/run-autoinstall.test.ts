import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "fs";
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

// `--prefer-offline` makes runtime auto-install resolve from the local disk
// cache without asking the registry (the resolver's
// `install_preference == Offline` path). One online run populates the cache,
// then the registry starts returning 404: without the flag resolution
// re-fetches the manifest and fails, with the flag the cached version
// satisfies the range and the registry is never contacted.
test("--prefer-offline resolves auto-installed packages from the disk cache", async () => {
  const fixtures = join(import.meta.dir, "..", "install", "registry", "packages", "no-deps");
  const requests: string[] = [];
  let online = true;
  using registry = Bun.serve({
    port: 0,
    async fetch(req) {
      const pathname = new URL(req.url).pathname;
      requests.push(pathname);
      if (!online) return new Response("offline", { status: 404 });
      if (pathname === "/no-deps") {
        const manifest = await Bun.file(join(fixtures, "package.json")).text();
        return Response.json(
          JSON.parse(manifest.replaceAll("http://localhost:4873", `http://127.0.0.1:${registry.port}`)),
        );
      }
      const tgz = pathname.match(/^\/no-deps\/-\/(no-deps-[\d.]+\.tgz)$/);
      if (tgz) return new Response(Bun.file(join(fixtures, tgz[1])));
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("prefer-offline", {
    "package.json": JSON.stringify({
      name: "myapp",
      version: "1.0.0",
      dependencies: { "no-deps": "^2.0.0" },
    }),
    "index.js": `console.log(require("no-deps").version);`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });
  const cacheDir = join(String(dir), ".bun-cache");
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir };
  const run = (...flags: string[]) =>
    Bun.spawn({
      cmd: [bunExe(), ...flags, "--install=force", "index.js"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

  // Online run populates the disk cache (extracted package + version index).
  {
    await using proc = run();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("Cannot find package");
    expect(stdout).toBe("2.0.0\n");
    expect(exitCode).toBe(0);
  }

  // Drop the cached manifests (keep the extracted packages) and take the
  // registry offline so any manifest re-fetch fails.
  online = false;
  const manifests = readdirSync(cacheDir).filter(e => e.endsWith(".npm"));
  expect(manifests.length).toBeGreaterThan(0);
  for (const entry of manifests) rmSync(join(cacheDir, entry), { force: true });
  requests.length = 0;

  // Without --prefer-offline the resolver asks the registry and fails.
  {
    await using proc = run();
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(requests).toContain("/no-deps");
    expect(stderr).toContain("Cannot find package 'no-deps'");
    expect(exitCode).not.toBe(0);
  }

  requests.length = 0;

  // With --prefer-offline the cached 2.0.0 satisfies ^2.0.0 and the registry
  // is never contacted.
  {
    await using proc = run("--prefer-offline");
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(requests).toEqual([]);
    expect(stderr).not.toContain("Cannot find package");
    expect(stdout).toBe("2.0.0\n");
    expect(exitCode).toBe(0);
  }
});

// Offline, a bare specifier resolves as dist-tag "latest", which must pick the
// newest stable cached version and skip prereleases that sort above it
// (prereleases-2 caches 1.0.0-next.23 > 0.5.0, the only stable version).
test("--prefer-offline resolves latest to the newest stable cached version", async () => {
  const fixtures = join(import.meta.dir, "..", "install", "registry", "packages", "prereleases-2");
  const requests: string[] = [];
  let online = true;
  using registry = Bun.serve({
    port: 0,
    async fetch(req) {
      const pathname = new URL(req.url).pathname;
      requests.push(pathname);
      if (!online) return new Response("offline", { status: 404 });
      if (pathname === "/prereleases-2") {
        const manifest = await Bun.file(join(fixtures, "package.json")).text();
        return Response.json(
          JSON.parse(manifest.replaceAll("http://localhost:4873", `http://127.0.0.1:${registry.port}`)),
        );
      }
      const tgz = pathname.match(/^\/prereleases-2\/-\/(prereleases-2-[^/]+\.tgz)$/);
      if (tgz) return new Response(Bun.file(join(fixtures, tgz[1])));
      return new Response("not found", { status: 404 });
    },
  });

  const bunfig = `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`;
  using dir = tempDir("prefer-offline-latest", {
    "package.json": JSON.stringify({ name: "myapp", version: "1.0.0" }),
    "index.js": `console.log(require("prereleases-2/package.json").version);`,
    "bunfig.toml": bunfig,
    // Scratch projects that only exist to seed the shared cache.
    "seed-pre/package.json": JSON.stringify({
      name: "seed-pre",
      dependencies: { "prereleases-2": "1.0.0-next.23" },
    }),
    "seed-pre/bunfig.toml": bunfig,
    "seed-stable/package.json": JSON.stringify({
      name: "seed-stable",
      dependencies: { "prereleases-2": "0.5.0" },
    }),
    "seed-stable/bunfig.toml": bunfig,
  });
  const cacheDir = join(String(dir), ".bun-cache");
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir };

  for (const seed of ["seed-pre", "seed-stable"]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: join(String(dir), seed),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  // Keep only the extracted packages and their version index.
  online = false;
  const manifests = readdirSync(cacheDir).filter(e => e.endsWith(".npm"));
  expect(manifests.length).toBeGreaterThan(0);
  for (const entry of manifests) {
    rmSync(join(cacheDir, entry), { force: true });
  }
  requests.length = 0;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--prefer-offline", "--install=force", "index.js"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(requests).toEqual([]);
  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toBe("0.5.0\n");
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
