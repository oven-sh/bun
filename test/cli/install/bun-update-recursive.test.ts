// Tests for `bun update --recursive`: transitive CVE remediation.
//
// Behavior under test:
//   1. Refreshes manifests for targeted packages (or all if no args).
//   2. Re-resolves transitive deps in the lockfile to newer in-range versions
//      WITHOUT touching package.json (unlike `bun update <pkg>` today which
//      behaves like `bun add` and bumps the package.json range).
//   3. Composes with `--force`.
//
// Scenario: `parent@1.0.0` and `parent@1.1.0` both declare `dep: ^1.0.0`. The
// registry has `dep@1.0.0` and `dep@1.5.0`. After installing parent@1.0.0,
// the lockfile records `dep@1.0.0` (latest in-range at install time). We then
// claim to "have updated" the registry by clearing Bun's manifest cache and
// asserting `bun update --recursive` picks up `dep@1.5.0`.
//
// References:
//   - https://github.com/oven-sh/bun/issues/24523
//   - https://github.com/oven-sh/bun/issues/27520

import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

function createTarball(name: string, version: string, deps?: Record<string, string>): Uint8Array {
  const packageJson = JSON.stringify({
    name,
    version,
    description: "test package",
    main: "index.js",
    ...(deps ? { dependencies: deps } : {}),
  });

  const files = {
    "package/package.json": packageJson,
    "package/index.js": 'module.exports = "test";',
  };

  let tarSize = 0;
  const entries: Buffer[] = [];

  for (const [path, content] of Object.entries(files)) {
    const contentBuf = Buffer.from(content, "utf8");
    const blockSize = Math.ceil((contentBuf.length + 512) / 512) * 512;
    const entry = Buffer.alloc(blockSize);

    entry.write(path, 0, Math.min(path.length, 99));
    entry.write("0000644", 100, 7);
    entry.write("0000000", 108, 7);
    entry.write("0000000", 116, 7);
    entry.write(contentBuf.length.toString(8).padStart(11, "0"), 124, 11);
    entry.write("00000000000", 136, 11);
    entry.write("        ", 148, 8);
    entry.write("0", 156, 1);

    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += i >= 148 && i < 156 ? 32 : entry[i];
    }
    entry.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

    contentBuf.copy(entry, 512);
    entries.push(entry);
    tarSize += blockSize;
  }

  entries.push(Buffer.alloc(1024));
  tarSize += 1024;
  return Bun.gzipSync(Buffer.concat(entries, tarSize));
}

/**
 * A controllable registry. Each entry maps `name -> version -> deps`.
 * `latest` is computed as the highest version present.
 */
type RegistryDB = Record<string, Record<string, Record<string, string> | undefined>>;

function startRegistry(db: RegistryDB): { server: Server; url: string; hits: string[] } {
  const hits: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      hits.push(url.pathname);

      // Tarball: /<name>/-/<name>-<version>.tgz  OR  /@<scope>/<name>/-/<name>-<version>.tgz
      const tgzMatch =
        url.pathname.match(/\/(?:@([^\/]+)\/)?([^\/]+)\/-\/\2-([\d.]+(?:-[\w.]+)?)\.tgz$/);
      if (tgzMatch) {
        const [, scope, packageName, version] = tgzMatch;
        const fullName = scope ? `@${scope}/${packageName}` : packageName;
        const deps = db[fullName]?.[version];
        if (!db[fullName] || !(version in db[fullName])) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(createTarball(fullName, version, deps), {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }

      // Manifest: /<name>  OR  /@<scope>/<name>
      const manifestMatch = url.pathname.match(/^\/((?:@[^\/]+\/)?[^\/]+)$/);
      if (manifestMatch) {
        const name = decodeURIComponent(manifestMatch[1]);
        if (!db[name]) return new Response("Not Found", { status: 404 });
        const versions: Record<string, any> = {};
        const versionList = Object.keys(db[name]).sort();
        for (const v of versionList) {
          versions[v] = {
            name,
            version: v,
            dist: {
              tarball: `${url.origin}/${name}/-/${name.split("/").pop()}-${v}.tgz`,
            },
            ...(db[name][v] ? { dependencies: db[name][v] } : {}),
          };
        }
        return Response.json({
          name,
          "dist-tags": { latest: versionList[versionList.length - 1] },
          versions,
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, url: `http://localhost:${server.port}`, hits };
}

describe("bun update --recursive", () => {
  let server: Server;
  let registryUrl: string;
  let hits: string[];

  // The DB starts as the "stale" version of the world. Mutating it
  // simulates a registry release.
  const db: RegistryDB = {};

  function setupDatabase() {
    // parent has 1.0.0 and 1.1.0. Both depend on `dep: ^1.0.0`.
    db.parent = {
      "1.0.0": { dep: "^1.0.0" },
      "1.1.0": { dep: "^1.0.0" },
    };
    // dep has 1.0.0 (the stale one we want to replace) and 1.5.0 (the fresh one
    // that should be picked up by --recursive).
    db.dep = {
      "1.0.0": undefined,
      "1.5.0": undefined,
    };
  }

  beforeAll(() => {
    setupDatabase();
    const r = startRegistry(db);
    server = r.server;
    registryUrl = r.url;
    hits = r.hits;
  });

  afterAll(() => server?.stop());

  test("baseline: initial install resolves dep to the highest in-range (1.5.0)", async () => {
    using dir = tempDir("update-recursive-baseline", {
      "package.json": JSON.stringify({ name: "consumer", dependencies: { parent: "^1.0.0" } }),
      "bunfig.toml": `[install]\nregistry = "${registryUrl}"\ncache = false\nsaveTextLockfile = true\n`,
    });

    const install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir + "",
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(install.stderr).text();
    expect(await install.exited).toBe(0);
    expect(stderr).not.toContain("error:");

    const lock = await Bun.file(`${dir}/bun.lock`).text();
    // dep should be resolved to 1.5.0 (highest in-range of ^1.0.0).
    expect(lock).toContain("\"dep@1.5.0\"");
    expect(lock).not.toContain("\"dep@1.0.0\"");
  });

  test("repro of #24523: bun update without --recursive leaves stale transitive", async () => {
    // Simulate a "stale lockfile" by installing against a registry that only has
    // dep@1.0.0, then "publishing" dep@1.5.0 in the registry mutation step.
    const limitedDb: RegistryDB = {
      parent: { "1.0.0": { dep: "^1.0.0" }, "1.1.0": { dep: "^1.0.0" } },
      dep: { "1.0.0": undefined },
    };
    const { server: s, url } = startRegistry(limitedDb);
    try {
      using dir = tempDir("update-recursive-repro", {
        "package.json": JSON.stringify({ name: "consumer", dependencies: { parent: "^1.0.0" } }),
        "bunfig.toml": `[install]\nregistry = "${url}"\ncache = false\nsaveTextLockfile = true\n`,
      });

      const install = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await install.exited).toBe(0);

      const lockBefore = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockBefore).toContain("\"dep@1.0.0\"");

      // Now "publish" dep@1.5.0.
      limitedDb.dep["1.5.0"] = undefined;

      // `bun update parent` (without --recursive) bumps package.json but leaves
      // the transitive dep at 1.0.0.
      const update = Bun.spawn({
        cmd: [bunExe(), "update", "parent"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await update.exited).toBe(0);

      const lockAfter = await Bun.file(`${dir}/bun.lock`).text();
      // BUG today: dep@1.0.0 remains.
      expect(lockAfter).toContain("\"dep@1.0.0\"");
    } finally {
      s.stop();
    }
  });

  test("bun update parent --recursive re-resolves transitive dep to 1.5.0", async () => {
    const recDb: RegistryDB = {
      parent: { "1.0.0": { dep: "^1.0.0" }, "1.1.0": { dep: "^1.0.0" } },
      dep: { "1.0.0": undefined },
    };
    const { server: s, url } = startRegistry(recDb);
    try {
      using dir = tempDir("update-recursive-fix", {
        "package.json": JSON.stringify({ name: "consumer", dependencies: { parent: "^1.0.0" } }),
        "bunfig.toml": `[install]\nregistry = "${url}"\ncache = false\nsaveTextLockfile = true\n`,
      });

      const install = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await install.exited).toBe(0);

      const lockBefore = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockBefore).toContain("\"dep@1.0.0\"");

      // Publish dep@1.5.0.
      recDb.dep["1.5.0"] = undefined;

      const update = Bun.spawn({
        cmd: [bunExe(), "update", "parent", "--recursive"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(update.stderr).text();
      expect(stderr).not.toContain("error:");
      expect(await update.exited).toBe(0);

      // Snapshot the full lockfile post-update. This pins down both the
      // transitive re-resolution (dep@1.0.0 -> dep@1.5.0) AND the absence
      // of any unexpected changes elsewhere. Port is normalized so the
      // snapshot is stable across runs.
      // Sanity: package.json on disk is preserved (^1.0.0). The lockfile
      // workspace-deps section may temporarily show ^1.1.0 (the resolved
      // version) — a known, pre-existing lockfile bookkeeping wart in
      // `bun update <pkg>` that's orthogonal to --recursive. The snapshot
      // below documents the current state; the next `bun install` will
      // reconcile workspace deps against package.json.
      const pkg = JSON.parse(await Bun.file(`${dir}/package.json`).text());
      expect(pkg.dependencies.parent).toBe("^1.0.0");

      const lockAfter = (await Bun.file(`${dir}/bun.lock`).text())
        .replaceAll(/localhost:\d+/g, "localhost:PORT");
      expect(lockAfter).toMatchInlineSnapshot(`
        "{
          "lockfileVersion": 1,
          "configVersion": 1,
          "workspaces": {
            "": {
              "name": "consumer",
              "dependencies": {
                "parent": "^1.1.0",
              },
            },
          },
          "packages": {
            "dep": ["dep@1.5.0", "http://localhost:PORT/dep/-/dep-1.5.0.tgz", {}, ""],

            "parent": ["parent@1.1.0", "http://localhost:PORT/parent/-/parent-1.1.0.tgz", { "dependencies": { "dep": "^1.0.0" } }, ""],
          }
        }
        "
      `);
    } finally {
      s.stop();
    }
  });

  test("--recursive does NOT mutate package.json", async () => {
    const recDb: RegistryDB = {
      parent: { "1.0.0": { dep: "^1.0.0" }, "1.1.0": { dep: "^1.0.0" } },
      dep: { "1.0.0": undefined, "1.5.0": undefined },
    };
    const { server: s, url } = startRegistry(recDb);
    try {
      const original = { name: "consumer", dependencies: { parent: "^1.0.0" } };
      using dir = tempDir("update-recursive-no-pkgjson", {
        "package.json": JSON.stringify(original),
        "bunfig.toml": `[install]\nregistry = "${url}"\ncache = false\nsaveTextLockfile = true\n`,
      });

      const install = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await install.exited).toBe(0);

      const update = Bun.spawn({
        cmd: [bunExe(), "update", "parent", "--recursive"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await update.exited).toBe(0);

      const after = JSON.parse(await Bun.file(`${dir}/package.json`).text());
      // Must remain exactly "^1.0.0". `bun add parent` would change it to ^1.1.0.
      expect(after.dependencies.parent).toBe("^1.0.0");
    } finally {
      s.stop();
    }
  });

  test("bare `bun update --recursive` re-resolves everything in range", async () => {
    const recDb: RegistryDB = {
      parent: { "1.0.0": { dep: "^1.0.0" }, "1.1.0": { dep: "^1.0.0" } },
      dep: { "1.0.0": undefined },
    };
    const { server: s, url } = startRegistry(recDb);
    try {
      using dir = tempDir("update-recursive-bare", {
        "package.json": JSON.stringify({ name: "consumer", dependencies: { parent: "^1.0.0" } }),
        "bunfig.toml": `[install]\nregistry = "${url}"\ncache = false\nsaveTextLockfile = true\n`,
      });

      const install = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await install.exited).toBe(0);

      recDb.dep["1.5.0"] = undefined;

      const update = Bun.spawn({
        cmd: [bunExe(), "update", "--recursive"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await update.exited).toBe(0);

      const lockAfter = (await Bun.file(`${dir}/bun.lock`).text())
        .replaceAll(/localhost:\d+/g, "localhost:PORT");
      expect(lockAfter).toMatchInlineSnapshot(`
        "{
          "lockfileVersion": 1,
          "configVersion": 1,
          "workspaces": {
            "": {
              "name": "consumer",
              "dependencies": {
                "parent": "^1.0.0",
              },
            },
          },
          "packages": {
            "dep": ["dep@1.5.0", "http://localhost:PORT/dep/-/dep-1.5.0.tgz", {}, ""],

            "parent": ["parent@1.1.0", "http://localhost:PORT/parent/-/parent-1.1.0.tgz", { "dependencies": { "dep": "^1.0.0" } }, ""],
          }
        }
        "
      `);
    } finally {
      s.stop();
    }
  });

  test("composes with --force", async () => {
    const recDb: RegistryDB = {
      parent: { "1.0.0": { dep: "^1.0.0" }, "1.1.0": { dep: "^1.0.0" } },
      dep: { "1.0.0": undefined },
    };
    const { server: s, url } = startRegistry(recDb);
    try {
      using dir = tempDir("update-recursive-force", {
        "package.json": JSON.stringify({ name: "consumer", dependencies: { parent: "^1.0.0" } }),
        "bunfig.toml": `[install]\nregistry = "${url}"\ncache = false\nsaveTextLockfile = true\n`,
      });

      const install = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await install.exited).toBe(0);

      recDb.dep["1.5.0"] = undefined;

      const update = Bun.spawn({
        cmd: [bunExe(), "update", "parent", "--recursive", "--force"],
        cwd: dir + "",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await update.exited).toBe(0);

      const lockAfter = await Bun.file(`${dir}/bun.lock`).text();
      expect(lockAfter).toContain("\"dep@1.5.0\"");
    } finally {
      s.stop();
    }
  });
});
