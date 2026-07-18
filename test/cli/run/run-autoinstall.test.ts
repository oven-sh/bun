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

// One transient tarball failure used to leave the on-disk `.npm` manifest cache
// in a state where a later `--install=auto` run resolved the package
// synchronously from that file and returned before the queued tarball download
// was ever scheduled: the import failed with zero network I/O until the `.npm`
// file was deleted by hand.
describe("auto-install re-downloads when only the .npm manifest cache is present", () => {
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

  async function runImport(dir: string, cache: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--install=auto", "imp.mjs"],
      cwd: dir,
      env: { ...bunEnv, HOME: dir, BUN_INSTALL_CACHE_DIR: cache },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test.concurrent("after the extracted package is removed from the cache", async () => {
    const good = makeTgz({
      "package/package.json": JSON.stringify({ name: "pkg-cache-a", version: "1.0.0", main: "index.js" }),
      "package/index.js": 'module.exports = "OK";',
    });
    const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(good).digest("base64");

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
              dist: { tarball: `http://127.0.0.1:${registry.port}/t.tgz`, integrity },
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

    const r1 = await runImport(String(dir), cache);
    expect({ ...r1, tarballRequests }).toEqual({
      stdout: "IMPORT_OK OK",
      stderr: "",
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
    const r2 = await runImport(String(dir), cache);
    expect({ ...r2, tarballRequests }).toEqual({
      stdout: "IMPORT_OK OK",
      stderr: "",
      exitCode: 0,
      tarballRequests: 2,
    });
  });

  test.concurrent("after an integrity failure on the first download", async () => {
    const good = makeTgz({
      "package/package.json": JSON.stringify({ name: "pkg-cache-b", version: "1.0.0", main: "index.js" }),
      "package/index.js": 'module.exports = "OK";',
    });
    const bad = Bun.gzipSync(new Uint8Array(4096).map((_, i) => (i * 37 + 11) & 255));
    // The manifest always advertises the GOOD integrity; only the tarball bytes
    // are corrupted on the first request (a flaky CDN, not a bad registry).
    const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(good).digest("base64");

    let serveBad = true;
    let tarballRequests = 0;
    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/t.tgz") {
          tarballRequests++;
          return new Response(serveBad ? bad : good);
        }
        return Response.json({
          name: "pkg-cache-b",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "pkg-cache-b",
              version: "1.0.0",
              dist: { tarball: `http://127.0.0.1:${registry.port}/t.tgz`, integrity },
            },
          },
        });
      },
    });

    using dir = tempDir("autoinstall-npm-cache-flake", {
      "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
      "imp.mjs": `try { const m = await import("pkg-cache-b"); console.log("IMPORT_OK " + m.default) } catch (e) { console.log("IMPORT_FAIL " + e.code) }`,
    });
    const cache = join(String(dir), ".cache");
    mkdirSync(cache, { recursive: true });

    const r1 = await runImport(String(dir), cache);
    expect(r1.stdout).toBe("IMPORT_FAIL ERR_MODULE_NOT_FOUND");
    expect(tarballRequests).toBe(1);
    // The `.npm` manifest cache was written (with the good integrity).
    expect(readdirSync(cache).some(f => f.endsWith(".npm"))).toBe(true);

    // CDN healed. The second run must re-download the tarball rather than
    // failing with zero network I/O against the cached manifest.
    serveBad = false;

    const r2 = await runImport(String(dir), cache);
    expect({ ...r2, tarballRequests }).toEqual({
      stdout: "IMPORT_OK OK",
      stderr: "",
      exitCode: 0,
      tarballRequests: 2,
    });
  });
});
