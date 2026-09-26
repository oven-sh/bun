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

// `bun install` lowers the process-wide cap on concurrent HTTP requests when a download fails at
// the connection level, and nothing raises the cap again. The runtime's package manager shares
// that cap with fetch() and lives as long as the program: one failed auto-install left the
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
    const manifests: string[] = [];
    using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const name = new URL(req.url).pathname.slice(1);
        manifests.push(name);
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
        BUN_CONFIG_HTTP_RETRY_COUNT: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim().split("\n"), manifests, droppedConnections, exitCode }).toEqual({
      stdout: ["8 requests in flight at once", "MODULE_NOT_FOUND", "8 requests in flight at once"],
      manifests: failing === "manifest" ? [] : ["never-there"],
      // the failed request and its one retry
      droppedConnections: 2,
      exitCode: 0,
    });
  });
});
