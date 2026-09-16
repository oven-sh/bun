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

  async function run(registry: { url: string }, script: string) {
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
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), exitCode };
  }

  const failures: Record<string, { respond: (deadPort: number) => Response; requestsPerLookup: number; busy?: true }> =
    {
      "404": { respond: () => new Response("{}", { status: 404 }), requestsPerLookup: 1 },
      "500": { respond: () => new Response("{}", { status: 500 }), requestsPerLookup: 2 },
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

  for (const [name, { respond, requestsPerLookup, busy }] of Object.entries(failures)) {
    test(name, async () => {
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
      );

      expect(stdout).toBe(JSON.stringify(["MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "1.0.0", "1.0.0"]));
      // Each failing resolve is one lookup, and so is the resolve after the registry recovers.
      const lookup = Array(requestsPerLookup).fill("/flaky-pkg");
      expect(registry.lookups).toEqual([lookup, lookup, ["/flaky-pkg", "/flaky-pkg/-/flaky-pkg-1.0.0.tgz"]]);
      expect(exitCode).toBe(0);
    });
  }

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
    expect(registry.lookups).toEqual([
      ...Array.from({ length: 6 }, (_, i) => [
        [`/flaky-pkg-${i}`],
        [`/flaky-pkg-${i}`, `/flaky-pkg-${i}/-/flaky-pkg-${i}-1.0.0.tgz`],
      ]).flat(),
      [],
    ]);
    expect(exitCode).toBe(0);
  });
});
