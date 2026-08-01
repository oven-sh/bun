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

// When the `.npm` manifest is cached on disk, `enqueue_dependency_to_root`
// resolves the version synchronously and only *queues* the tarball download
// into `network_task_fifo`. The fast-path returned a Resolution without ever
// scheduling that task, so `path_for_resolution` readlinked a cache entry that
// was never extracted. Two ways to reach that state:
//   - importing a second `pkg@version` after a different version was installed
//     (manifest cached from the first run, second version never downloaded);
//   - the extracted package was removed but the manifest kept (or a transient
//     tarball failure left only the manifest behind).
describe("auto-install with a cached .npm manifest schedules the tarball download", () => {
  function makeTgz(files: Record<string, string>) {
    const enc = new TextEncoder();
    const entry = (name: string, body: Uint8Array) => {
      const h = new Uint8Array(512);
      const put = (s: string, off: number) => h.set(enc.encode(s), off);
      put(name, 0);
      put("0000755\0", 100);
      put("0000000\0", 108);
      put("0000000\0", 116);
      put(body.length.toString(8).padStart(11, "0") + "\0", 124);
      put("00000000000\0", 136);
      h.fill(32, 148, 156);
      h[156] = 48;
      put("ustar\0", 257);
      put("00", 263);
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += h[i];
      put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
      const pad = (512 - (body.length % 512)) % 512;
      const out = new Uint8Array(512 + body.length + pad);
      out.set(h);
      out.set(body, 512);
      return out;
    };
    const parts: Uint8Array[] = [];
    for (const [name, text] of Object.entries(files)) parts.push(entry(name, enc.encode(text)));
    parts.push(new Uint8Array(1024));
    return Bun.gzipSync(Buffer.concat(parts));
  }

  function integrityOf(bytes: Uint8Array) {
    return "sha512-" + new Bun.CryptoHasher("sha512").update(bytes).digest("base64");
  }

  async function runScript(dir: string, cache: string, file: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--install=auto", file],
      cwd: dir,
      env: { ...bunEnv, BUN_INSTALL: undefined, HOME: dir, BUN_INSTALL_CACHE_DIR: cache },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // Each test spawns two debug-build subprocesses back-to-back; give them
  // headroom over the 5s default.
  const timeout = 20_000;

  // https://github.com/oven-sh/bun/issues/10411
  test(
    "second pkg@version specifier installs after the first version is cached",
    async () => {
      const makePkg = (version: string) =>
        makeTgz({
          "package/package.json": JSON.stringify({ name: "pkg-10411", version, main: "index.js" }),
          "package/index.js": `module.exports = { VERSION: ${JSON.stringify(version)} };`,
        });
      const tarballs: Record<string, Uint8Array> = {
        "1.0.0": makePkg("1.0.0"),
        "2.0.0": makePkg("2.0.0"),
      };

      const tarballRequests: string[] = [];
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          const url = new URL(req.url);
          const m = url.pathname.match(/^\/t-(.+)\.tgz$/);
          if (m) {
            tarballRequests.push(m[1]);
            return new Response(tarballs[m[1]]);
          }
          return Response.json({
            name: "pkg-10411",
            "dist-tags": { latest: "2.0.0" },
            versions: Object.fromEntries(
              Object.keys(tarballs).map(v => [
                v,
                {
                  name: "pkg-10411",
                  version: v,
                  dist: {
                    tarball: `http://127.0.0.1:${registry.port}/t-${v}.tgz`,
                    integrity: integrityOf(tarballs[v]),
                  },
                },
              ]),
            ),
          });
        },
      });

      using dir = tempDir("autoinstall-10411", {
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
        "a.mjs": `try { const m = await import("pkg-10411@1.0.0"); console.log("OK " + m.default.VERSION) } catch (e) { console.log("FAIL " + (e.code || e.message)) }`,
        "b.mjs": `try { const m = await import("pkg-10411@2.0.0"); console.log("OK " + m.default.VERSION) } catch (e) { console.log("FAIL " + (e.code || e.message)) }`,
      });
      const cache = join(String(dir), ".cache");
      mkdirSync(cache, { recursive: true });

      // First version: cold cache.
      const r1 = await runScript(String(dir), cache, "a.mjs");
      expect({ stdout: r1.stdout, exitCode: r1.exitCode, tarballRequests: [...tarballRequests] }).toEqual({
        stdout: "OK 1.0.0",
        exitCode: 0,
        tarballRequests: ["1.0.0"],
      });
      // Sanity: the `.npm` manifest is now cached on disk and the first version
      // was extracted; otherwise this test exercises nothing.
      const entries = readdirSync(cache);
      expect(entries.some(f => f.endsWith(".npm"))).toBe(true);
      expect(entries.some(f => f.startsWith("pkg-10411@1.0.0"))).toBe(true);

      // Second version in a fresh process: the manifest is loaded from disk, so
      // the version resolves synchronously. The tarball for 2.0.0 must still be
      // downloaded and extracted before `path_for_resolution` is called.
      const r2 = await runScript(String(dir), cache, "b.mjs");
      expect({ stdout: r2.stdout, exitCode: r2.exitCode, tarballRequests: [...tarballRequests] }).toEqual({
        stdout: "OK 2.0.0",
        exitCode: 0,
        tarballRequests: ["1.0.0", "2.0.0"],
      });
    },
    timeout,
  );

  test(
    "after the extracted package is removed from the cache",
    async () => {
      const good = makeTgz({
        "package/package.json": JSON.stringify({ name: "pkg-cache-a", version: "1.0.0", main: "index.js" }),
        "package/index.js": 'module.exports = "OK";',
      });

      let tarballRequests = 0;
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/t.tgz") {
            tarballRequests++;
            return new Response(good);
          }
          return Response.json({
            name: "pkg-cache-a",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "pkg-cache-a",
                version: "1.0.0",
                dist: { tarball: `http://127.0.0.1:${registry.port}/t.tgz`, integrity: integrityOf(good) },
              },
            },
          });
        },
      });

      using dir = tempDir("autoinstall-npm-cache-evict", {
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
        "imp.mjs": `try { const m = await import("pkg-cache-a"); console.log("IMPORT_OK " + m.default) } catch (e) { console.log("IMPORT_FAIL " + e.code) }`,
      });
      const cache = join(String(dir), ".cache");
      mkdirSync(cache, { recursive: true });

      const r1 = await runScript(String(dir), cache, "imp.mjs");
      expect({ ...r1, tarballRequests }).toMatchObject({
        stdout: "IMPORT_OK OK",
        exitCode: 0,
        tarballRequests: 1,
      });

      // Evict everything except the `.npm` manifest cache file.
      const kept: string[] = [];
      for (const entry of readdirSync(cache)) {
        if (entry.endsWith(".npm")) {
          kept.push(entry);
          continue;
        }
        rmSync(join(cache, entry), { recursive: true, force: true });
      }
      expect(kept.length).toBeGreaterThan(0);

      // Fresh process: the disk-loaded manifest must trigger a tarball download.
      const r2 = await runScript(String(dir), cache, "imp.mjs");
      expect({ ...r2, tarballRequests }).toMatchObject({
        stdout: "IMPORT_OK OK",
        exitCode: 0,
        tarballRequests: 2,
      });
    },
    timeout,
  );
});
