import { file, spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { chmod, mkdir, readdir, rm, symlink, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "path";

// The extraction cache is keyed by "<name>@<version>@@@<cache-version>" only.
// These tests cover the trust properties of that cache: that a matching
// directory name alone is not treated as proof of content, and that the cache
// root itself is subject to an ownership/permission check before use.

const TARBALL = join(import.meta.dir, "baz-0.0.3.tgz");
const CLEAN_INDEX = `#! /usr/bin/env node\n\nconsole.log("run baz");\n`;
const POISON = `module.exports = "POISONED";\n`;

async function sha512(path: string) {
  const bytes = await file(path).arrayBuffer();
  return "sha512-" + createHash("sha512").update(Buffer.from(bytes)).digest("base64");
}

type Serve = {
  url: string;
  tarballHits: number;
  stop: () => void;
};

async function startRegistry(): Promise<Serve> {
  const integrity = await sha512(TARBALL);
  let tarballHits = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith(".tgz")) {
        tarballHits++;
        return new Response(file(TARBALL));
      }
      if (url.pathname === "/baz" || url.pathname === "/baz/") {
        return Response.json({
          name: "baz",
          "dist-tags": { latest: "0.0.3" },
          versions: {
            "0.0.3": {
              name: "baz",
              version: "0.0.3",
              dist: {
                tarball: `http://localhost:${server.port}/baz-0.0.3.tgz`,
                integrity,
              },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://localhost:${server.port}/`,
    get tarballHits() {
      return tarballHits;
    },
    stop: () => server.stop(true),
  };
}

async function makeProject(registryUrl: string, cacheDir: string, linker: "hoisted" | "isolated" = "hoisted") {
  const dir = tempDir("cache-trust", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { baz: "0.0.3" },
    }),
    "bunfig.toml": `[install]\nregistry = "${registryUrl}"\nlinker = "${linker}"\n`,
  });
  return { dir: String(dir), env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir }, dispose: dir };
}

async function runInstall(cwd: string, env: Record<string, string>, extra: string[] = []) {
  await using proc = spawn({
    cmd: [bunExe(), "install", ...extra],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function findCacheEntry(cacheDir: string): Promise<string> {
  const entries = await readdir(cacheDir);
  const hit = entries.find(e => e.startsWith("baz@0.0.3"));
  if (!hit) throw new Error(`no baz cache entry in ${cacheDir}: ${entries.join(", ")}`);
  return join(cacheDir, hit);
}

describe.concurrent("install extraction cache trust", () => {
  for (const linker of ["hoisted", "isolated"] as const) {
    test(`--force re-downloads and re-verifies on a cache hit (${linker})`, async () => {
      const registry = await startRegistry();
      try {
        using scratch = tempDir("cache-trust-scratch", {});
        const cacheDir = join(String(scratch), "cache");
        const { dir, env, dispose } = await makeProject(registry.url, cacheDir, linker);
        using _ = dispose;

        // First install: populate cache + lockfile.
        const r1 = await runInstall(dir, env);
        expect(r1.stderr).toContain("Saved lockfile");
        expect(r1.exitCode).toBe(0);
        expect(registry.tarballHits).toBe(1);

        // Tamper with the cached extraction in place.
        const entry = await findCacheEntry(cacheDir);
        await writeFile(join(entry, "index.js"), POISON);

        // Drop node_modules so the link step has to re-read from the cache.
        await rm(join(dir, "node_modules"), { recursive: true, force: true });

        // --force must bypass the extraction cache and re-download the tarball.
        const r2 = await runInstall(dir, env, ["--force"]);
        expect(r2.stderr).not.toContain("error:");
        expect(r2.exitCode).toBe(0);
        expect(registry.tarballHits).toBe(2);

        // node_modules must reflect the registry bytes, not the poisoned cache.
        const installed = await file(join(dir, "node_modules", "baz", "index.js")).text();
        expect(installed).toBe(CLEAN_INDEX);
      } finally {
        registry.stop();
      }
    });
  }

  test("linked cache entry is not trusted", async () => {
    const registry = await startRegistry();
    try {
      using scratch = tempDir("cache-trust-scratch", {});
      const cacheDir = join(String(scratch), "cache");
      const { dir, env, dispose } = await makeProject(registry.url, cacheDir);
      using _ = dispose;

      const r1 = await runInstall(dir, env);
      expect(r1.stderr).toContain("Saved lockfile");
      expect(r1.exitCode).toBe(0);
      expect(registry.tarballHits).toBe(1);

      // Replace the cache entry with a link to an attacker-controlled dir. On
      // Windows, junctions do not require SeCreateSymbolicLinkPrivilege and
      // carry FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT, which is
      // exactly what cache_entry_is_dir must reject.
      const entry = await findCacheEntry(cacheDir);
      const attacker = join(String(scratch), "attacker");
      await mkdir(attacker, { recursive: true });
      await writeFile(join(attacker, "index.js"), POISON);
      await writeFile(
        join(attacker, "package.json"),
        JSON.stringify({ name: "baz", version: "0.0.3", bin: { "baz-run": "index.js" } }),
      );
      await rm(entry, { recursive: true, force: true });
      await symlink(attacker, entry, isWindows ? "junction" : "dir");

      await rm(join(dir, "node_modules"), { recursive: true, force: true });

      const r2 = await runInstall(dir, env, ["--frozen-lockfile"]);
      expect(r2.stderr).not.toContain("error:");
      expect(r2.exitCode).toBe(0);

      // The link must not have been followed as a cache hit: the tarball was
      // re-fetched and node_modules carries the registry bytes.
      expect(registry.tarballHits).toBe(2);
      const installed = await file(join(dir, "node_modules", "baz", "index.js")).text();
      expect(installed).toBe(CLEAN_INDEX);
    } finally {
      registry.stop();
    }
  });

  test.skipIf(isWindows)("group/other-writable shared cache root is rejected", async () => {
    const registry = await startRegistry();
    try {
      using scratch = tempDir("cache-trust-scratch", {});
      const cacheDir = join(String(scratch), "cache");
      await mkdir(cacheDir, { recursive: true });
      // Simulate a shared/world-writable cache location.
      await chmod(cacheDir, 0o777);

      const { dir, env, dispose } = await makeProject(registry.url, cacheDir);
      using _ = dispose;

      const r1 = await runInstall(dir, env);
      expect(r1.stderr).toContain("writable by other users");
      expect(r1.exitCode).toBe(0);

      // The shared cache must not have been populated; the fallback
      // per-project cache under node_modules/.cache is used instead.
      const shared = await readdir(cacheDir).catch(() => []);
      expect(shared.filter(e => e.startsWith("baz@"))).toEqual([]);
      const local = await readdir(join(dir, "node_modules", ".cache"));
      expect(local.some(e => e.startsWith("baz@"))).toBe(true);
    } finally {
      registry.stop();
    }
  });
});
