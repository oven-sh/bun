import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/10411
//
// When the `.npm` manifest is cached on disk, `enqueue_dependency_to_root`
// resolves the version synchronously and only *queues* the tarball download
// into `network_task_fifo`. The fast-path returned a Resolution without ever
// scheduling that task, so `path_for_resolution` readlinked an index symlink
// that was never created. Three ways to reach that state:
//   - importing a second `pkg@version` after a different version was installed
//     (manifest cached from the first run, second version never downloaded);
//   - the extracted package was removed but the manifest kept;
//   - a concurrent writer has renamed the data folder into place but not yet
//     created the index symlink.
describe("auto-install with a disk-cached manifest resolves from the global cache", () => {
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

  test("second pkg@version specifier installs after the first version is cached", async () => {
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
    expect({ ...r1, tarballRequests: [...tarballRequests] }).toMatchObject({
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
    expect({ ...r2, tarballRequests: [...tarballRequests] }).toMatchObject({
      stdout: "OK 2.0.0",
      exitCode: 0,
      tarballRequests: ["1.0.0", "2.0.0"],
    });
  });

  test("after the extracted package is removed from the cache", async () => {
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
  });

  // Concurrent-writer window: the data folder `<cache>/pkg@ver...` is renamed
  // into place before the version-index symlink `<cache>/pkg/ver...` is
  // created. `determine_preinstall_state` probes the data folder (present, so
  // `Done`), then `path_for_cached_npm_path` readlinks the index symlink
  // (absent). The fallback probes the data folder directly.
  test("when the version-index symlink is absent but the data folder exists", async () => {
    const good = makeTgz({
      "package/package.json": JSON.stringify({ name: "race-pkg", version: "1.0.0", main: "index.js" }),
      "package/index.js": 'module.exports = "race-ok";',
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
          name: "race-pkg",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "race-pkg",
              version: "1.0.0",
              dist: { tarball: `http://127.0.0.1:${registry.port}/t.tgz`, integrity: integrityOf(good) },
            },
          },
        });
      },
    });

    using dir = tempDir("autoinstall-index-race", {
      "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
      "imp.mjs": `try { const m = await import("race-pkg"); console.log("IMPORT_OK " + m.default) } catch (e) { console.log("IMPORT_FAIL " + (e.code || e.message)) }`,
    });
    const cache = join(String(dir), ".cache");
    mkdirSync(cache, { recursive: true });

    const r1 = await runScript(String(dir), cache, "imp.mjs");
    expect({ ...r1 }).toMatchObject({
      stdout: "IMPORT_OK race-ok",
      exitCode: 0,
    });

    // Remove only the `<cache>/race-pkg/` index directory; leave the
    // `<cache>/race-pkg@1.0.0...` data folder in place.
    const entries = readdirSync(cache);
    expect(entries).toContain("race-pkg");
    expect(entries.some(e => e.startsWith("race-pkg@1.0.0"))).toBe(true);
    rmSync(join(cache, "race-pkg"), { recursive: true, force: true });

    const r2 = await runScript(String(dir), cache, "imp.mjs");
    expect({ ...r2, tarballRequests }).toMatchObject({
      stdout: "IMPORT_OK race-ok",
      exitCode: 0,
      // The data folder is already present; no second download is needed.
      tarballRequests: 1,
    });
  });
});
