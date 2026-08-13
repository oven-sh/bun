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
