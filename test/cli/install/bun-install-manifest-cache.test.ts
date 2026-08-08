import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Manifest cache writes are handed to the install thread pool, and `bun
// install` must not exit before they land (`pending_manifest_saves` in
// PackageManager). A manifest with many unique strings makes the cache write
// take longer than the rest of the install, so a bun that does not wait exits
// first and the `.npm` file never appears in the cache directory.
//
// Sized so the write reliably loses that race on unfixed builds (debug and
// release) while staying far from the race on fixed ones, which wait. The
// string data must be unique per entry: repeated strings are deduplicated by
// the serializer and shrink the write.
const FAKE_VERSIONS = 6_000;
const DEPS_PER_VERSION = 8;
const INSTALL_ITERATIONS = 3;

function buildManifest(origin: string, shasum: string): string {
  const pad = Buffer.alloc(800, "ab-cd.").toString();
  const versions: string[] = [];
  for (let v = 0; v < FAKE_VERSIONS; v++) {
    const version = `1.${Math.floor(v / 1000)}.${v % 1000}`;
    const deps: string[] = [];
    for (let d = 0; d < DEPS_PER_VERSION; d++) {
      const n = (v * DEPS_PER_VERSION + d).toString().padStart(7, "0");
      deps.push(`"fake-dependency-package-name-padding-${n}":"1.0.0-${n}.${pad}"`);
    }
    versions.push(
      `"${version}":{"name":"baz","version":"${version}","dependencies":{${deps.join(",")}},` +
        `"dist":{"shasum":"${shasum}","tarball":"${origin}/baz/-/baz-${version}.tgz"}}`,
    );
  }
  versions.push(
    `"0.0.3":{"name":"baz","version":"0.0.3","dist":{"shasum":"${shasum}","tarball":"${origin}/baz/-/baz-0.0.3.tgz"}}`,
  );
  return `{"name":"baz","dist-tags":{"latest":"0.0.3"},"versions":{${versions.join(",")}}}`;
}

test(
  "bun install waits for manifest cache writes before exiting",
  async () => {
    const tarball = readFileSync(join(import.meta.dir, "baz-0.0.3.tgz"));
    const shasum = createHash("sha1").update(tarball).digest("hex");

    let manifest = "";
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname.endsWith(".tgz")) {
          return new Response(tarball, { headers: { "Content-Type": "application/octet-stream" } });
        }
        return new Response(manifest, { headers: { "Content-Type": "application/json" } });
      },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    manifest = buildManifest(origin, shasum);

    const files: Record<string, string> = {};
    for (let i = 0; i < INSTALL_ITERATIONS; i++) {
      files[`p${i}/package.json`] = JSON.stringify({
        name: "manifest-cache-wait",
        version: "1.0.0",
        dependencies: { baz: "0.0.3" },
      });
      files[`p${i}/bunfig.toml`] = `[install]\nregistry = "${origin}/"\n`;
    }
    using dir = tempDir("manifest-cache-wait", files);

    for (let i = 0; i < INSTALL_ITERATIONS; i++) {
      const cwd = join(String(dir), `p${i}`);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--ignore-scripts", "--silent"],
        cwd,
        // CI exports BUN_INSTALL_CACHE_DIR (shared per-run tmpdir), and the
        // env var outranks bunfig. Point it at this iteration's cache dir so
        // every install is a cold fetch and the assertion reads the right dir.
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, "cache") },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      // The install exited; the manifest for `baz` must already be in the
      // cache directory. Without the wait the process exits mid-write and the
      // file is missing.
      const cacheDir = join(cwd, "cache");
      const manifestFiles = existsSync(cacheDir) ? readdirSync(cacheDir).filter(f => f.endsWith(".npm")) : [];
      expect({
        iteration: i,
        manifestFiles: manifestFiles.length,
        exitCode,
        stderr: exitCode === 0 ? "" : stderr,
      }).toEqual({
        iteration: i,
        manifestFiles: 1,
        exitCode: 0,
        stderr: "",
      });
    }
  },
  { timeout: 240_000 },
);
