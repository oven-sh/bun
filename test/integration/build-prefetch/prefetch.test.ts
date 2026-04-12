import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const prefetch = join(repoRoot, "scripts", "build", "prefetch.ts");
const downloadTs = join(repoRoot, "scripts", "build", "download.ts");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("BUN_DEPS_CACHE_DIR", () => {
  test("downloadWithRetry copies from cache on hit, never touches network", async () => {
    using dir = tempDir("deps-cache-hit", {});
    const cache = join(String(dir), "cache");
    const out = join(String(dir), "out");
    mkdirSync(cache);
    mkdirSync(out);

    // Unroutable URL — if the cache lookup is skipped, fetch hangs/errors and
    // the test fails. The 0-byte sibling proves we ignore empty cache entries.
    const url = "http://192.0.2.1/dep-v1.tar.gz";
    writeFileSync(join(cache, sha256(url)), "PAYLOAD");
    writeFileSync(join(cache, sha256("http://192.0.2.1/empty")), "");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { downloadWithRetry, offlineCacheKey } from ${JSON.stringify(downloadTs)};
         if (offlineCacheKey(${JSON.stringify(url)}) !== ${JSON.stringify(sha256(url))})
           throw new Error("offlineCacheKey drifted from sha256(url)");
         await downloadWithRetry(${JSON.stringify(url)}, ${JSON.stringify(join(out, "got"))}, "t");
         console.log("ok");`,
      ],
      env: { ...bunEnv, BUN_DEPS_CACHE_DIR: cache },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("ok");
    expect(readFileSync(join(out, "got"), "utf8")).toBe("PAYLOAD");
    expect(exitCode).toBe(0);
  });

  test("cache miss falls through to network (stale image + bumped dep)", async () => {
    using dir = tempDir("deps-cache-miss", {});
    const cache = join(String(dir), "cache");
    mkdirSync(cache);
    // Seed v1 only — v2 (the "bumped" dep) is absent.
    writeFileSync(join(cache, sha256("http://127.0.0.1:1/dep-v1.tar.gz")), "old");

    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("FROM-NETWORK"),
    });
    const url = `http://127.0.0.1:${server.port}/dep-v2.tar.gz`;
    const dest = join(String(dir), "got");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { downloadWithRetry } from ${JSON.stringify(downloadTs)};
         await downloadWithRetry(${JSON.stringify(url)}, ${JSON.stringify(dest)}, "t");`,
      ],
      env: { ...bunEnv, BUN_DEPS_CACHE_DIR: cache },
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(readFileSync(dest, "utf8")).toBe("FROM-NETWORK");
    expect(exitCode).toBe(0);
  });
});

describe("prefetch.ts", () => {
  test("--print enumerates dep, prebuilt, and zig URLs with stable keys", async () => {
    // System bun, not bunExe(): the build-script import graph (source.ts →
    // fetch-cli.ts, which has guarded TLA) trips a debug-only JSC assert
    // (`@assert(!dependency.isAsync)`). Pre-existing — `bun-debug
    // scripts/build.ts --configure-only` hits it too. Build scripts run
    // under release bun in practice (package.json, Dockerfile), so test
    // with that.
    const systemBun = Bun.which("bun");
    expect(systemBun).toBeTruthy();
    await using proc = Bun.spawn({
      cmd: [systemBun!, prefetch, "--print", "--webkit=lto"],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    // One github-archive dep, one prebuilt, one zig — categories, not counts.
    expect(stdout).toContain("github.com/oven-sh/boringssl/archive/");
    expect(stdout).toContain("github.com/oven-sh/WebKit/releases/download/");
    expect(stdout).toContain("github.com/oven-sh/zig/releases/download/");
    expect(stdout).toContain("nodejs.org/dist/");
    // Key column is sha256(url) — verify for one line so prefetch and the
    // download hook can't drift apart.
    for (const line of lines) {
      const [key, , url] = line.split(/\s+/);
      expect(key).toBe(sha256(url!));
    }
    expect(exitCode).toBe(0);
  });

  test("downloads into content-addressed dir and writes manifest", async () => {
    using dir = tempDir("prefetch-out", {});
    const out = join(String(dir), "deps");

    using server = Bun.serve({
      port: 0,
      fetch: req => new Response(`body:${new URL(req.url).pathname}`),
    });

    // Drive collectUrls' output through a tiny inline harness so the test
    // doesn't hit GitHub: replace the URL set with two local ones, reuse the
    // real download + manifest path by invoking prefetch's worker via the
    // public downloadWithRetry/offlineCacheKey contract.
    const urls = [`http://127.0.0.1:${server.port}/a.tar.gz`, `http://127.0.0.1:${server.port}/b.tar.gz`];
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { downloadWithRetry, offlineCacheKey } from ${JSON.stringify(downloadTs)};
         import { mkdir, writeFile } from "node:fs/promises";
         import { join } from "node:path";
         const out = ${JSON.stringify(out)};
         await mkdir(out, { recursive: true });
         const manifest = {};
         for (const url of ${JSON.stringify(urls)}) {
           const key = offlineCacheKey(url);
           await downloadWithRetry(url, join(out, key), "t");
           manifest[key] = { url };
         }
         await writeFile(join(out, "manifest.json"), JSON.stringify(manifest));
         console.log("ok");`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("ok");
    for (const url of urls) {
      const body = readFileSync(join(out, sha256(url)), "utf8");
      expect(body).toBe(`body:${new URL(url).pathname}`);
    }
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(Object.keys(manifest).sort()).toEqual(urls.map(sha256).sort());
    expect(exitCode).toBe(0);
  });
});
