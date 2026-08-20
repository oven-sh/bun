// https://github.com/oven-sh/bun/issues/11250
//
// `bun install` publishes directories into the cache by renaming them into
// place: the temp dir a tarball was extracted into, the temp dir a patch was
// applied in, and a global virtual store entry's staging dir. On Windows that
// rename fails with STATUS_ACCESS_DENIED (EPERM) for as long as any other
// process holds a handle without FILE_SHARE_DELETE on a file inside the
// directory, which is what antivirus / Search Indexer / MDM agents do to
// freshly written files. The fixture spawned below is such a process.
//
// Each publish path is exercised twice: with the default retry budget the
// install must outlast a 2s hold, and with BUN_INSTALL_WINDOWS_RENAME_RETRY_MS=0
// it must fail immediately and name the variable (which also proves the held
// handle is what blocks the rename).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PKG = "av-test-pkg";
const ENV = "BUN_INSTALL_WINDOWS_RENAME_RETRY_MS";
const HOLD_MS = 2000;

const patch = `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-module.exports = "unpatched";
+module.exports = "patched";
`;

let pkgDir: ReturnType<typeof tempDir> | undefined;
let tgzBytes: Buffer;
let tgzSha1: string;

beforeAll(async () => {
  if (!isWindows) return;
  const files: Record<string, string | Buffer> = {
    "package/package.json": JSON.stringify({ name: PKG, version: "1.0.0" }),
    "package/index.js": `module.exports = "unpatched";\n`,
    // A blob that takes a moment to extract, plus enough files that copying
    // or hardlinking the package into a staging dir is a window the fixture
    // reliably lands in.
    "package/bin.exe": randomBytes(2 * 1024 * 1024),
  };
  for (let i = 0; i < 300; i++) files[`package/files/${i}.txt`] = `${i}\n`;
  pkgDir = tempDir("rename-retry-pkg", files);
  const tgz = join(String(pkgDir), `${PKG}-1.0.0.tgz`);
  await Bun.$`tar -czf ${tgz} -C ${String(pkgDir)} package`.quiet();
  tgzBytes = readFileSync(tgz);
  tgzSha1 = createHash("sha1").update(tgzBytes).digest("hex");
});

afterAll(() => {
  pkgDir?.[Symbol.dispose]();
});

function serveRegistry(stallTarballUntil?: Promise<void>) {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === `/${PKG}`) {
        return Response.json({
          name: PKG,
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: PKG,
              version: "1.0.0",
              dist: { tarball: `http://localhost:${server.port}/${PKG}/-/${PKG}-1.0.0.tgz`, shasum: tgzSha1 },
            },
          },
        });
      }
      if (pathname === `/${PKG}/-/${PKG}-1.0.0.tgz`) {
        const headers = { "content-type": "application/octet-stream", "content-length": String(tgzBytes.length) };
        if (!stallTarballUntil) return new Response(tgzBytes, { headers });
        // Send the first half, then hold the rest back until the fixture has
        // grabbed a handle, so the extraction dir is guaranteed to be held
        // when bun tries to rename it into the cache.
        const half = tgzBytes.length >> 1;
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(ctrl) {
              ctrl.write(tgzBytes.subarray(0, half));
              await ctrl.flush();
              await stallTarballUntil;
              ctrl.write(tgzBytes.subarray(half));
              await ctrl.flush();
              ctrl.close();
            },
          }),
          { headers },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

function spawnBlocker(watchDir: string, subdirFilter: string, holdMs: number) {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "bun-install-windows-rename-retry-fixture.ts"),
      watchDir,
      subdirFilter,
      String(holdMs),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const ready = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  let output = "";
  const drained = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      output += decoder.decode(chunk, { stream: true });
      if (output.includes("READY")) ready.resolve();
      if (output.includes("HELD") || output.includes("MISSED")) held.resolve();
    }
    ready.resolve();
    held.resolve();
  })();
  return {
    ready: ready.promise,
    held: held.promise,
    async finish() {
      proc.kill();
      await proc.exited;
      await drained;
      return output;
    },
  };
}

async function runInstall(cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function scaffold(name: string, bunfig: string, packageJson: Record<string, unknown>) {
  const dir = tempDir(name, {
    "cache/.keep": "",
    "tmp/.keep": "",
    "project/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { [PKG]: "1.0.0" },
      ...packageJson,
    }),
    "project/bunfig.toml": bunfig,
  });
  const root = String(dir);
  const cache = join(root, "cache");
  const tmp = join(root, "tmp");
  return {
    [Symbol.dispose]: () => dir[Symbol.dispose](),
    project: join(root, "project"),
    cache,
    tmp,
    env: { BUN_INSTALL_CACHE_DIR: cache, BUN_TMPDIR: tmp, TEMP: tmp, TMP: tmp },
  };
}

const registryBunfig = (port: number) => `[install]\nregistry = "http://localhost:${port}/"\n`;

const modes = [
  { mode: "default budget outlasts a 2s hold", budget: undefined, holdMs: HOLD_MS },
  { mode: `${ENV}=0 fails at once and names the variable`, budget: "0", holdMs: 15_000 },
];

describe.skipIf(!isWindows).concurrent("bun install renames into the cache while a scanner holds a file open", () => {
  test.each(modes)("extracted tarball: $mode", async ({ budget, holdMs }) => {
    const blockerCaught = Promise.withResolvers<void>();
    await using server = serveRegistry(blockerCaught.promise);
    using s = scaffold("rename-retry-tarball", registryBunfig(server.port), {});

    const blocker = spawnBlocker(s.tmp, "", holdMs);
    await blocker.ready;
    blocker.held.then(blockerCaught.resolve);

    const result = await runInstall(s.project, {
      ...s.env,
      // Stream the (small) tarball so files hit the temp dir before the registry stalls.
      BUN_INSTALL_STREAMING_MIN_SIZE: "1",
      [ENV]: budget,
    });
    const blockerOut = await blocker.finish();
    expect(blockerOut).toContain("HELD");

    if (budget === undefined) {
      expect(result).toMatchObject({ exitCode: 0 });
      expect(existsSync(join(s.project, "node_modules", PKG, "bin.exe"))).toBe(true);
    } else {
      expect(result.stderr).toContain(`moving "${PKG}" to cache dir failed`);
      expect(result.stderr).toContain(ENV);
      expect(result.stderr).toContain("NtSetInformationFile");
      expect(result.exitCode).toBe(1);
    }
  });

  test.each(modes)("patched package: $mode", async ({ budget, holdMs }) => {
    await using server = serveRegistry();
    using s = scaffold("rename-retry-patch", registryBunfig(server.port), {
      patchedDependencies: { [`${PKG}@1.0.0`]: `patches/${PKG}.patch` },
    });
    mkdirSync(join(s.project, "patches"));
    writeFileSync(join(s.project, "patches", `${PKG}.patch`), patch);

    // The patch is applied in a `.<hex>-<n>.tmp` dir under the temp dir. The
    // tarball is extracted into a `.<hex>-<n>.av-test-pkg` sibling first,
    // which the filter keeps the fixture away from.
    const blocker = spawnBlocker(s.tmp, ".tmp", holdMs);
    await blocker.ready;

    const result = await runInstall(s.project, { ...s.env, [ENV]: budget });
    const blockerOut = await blocker.finish();
    expect(blockerOut).toContain("HELD");

    if (budget === undefined) {
      expect(result).toMatchObject({ exitCode: 0 });
      expect(readFileSync(join(s.project, "node_modules", PKG, "index.js"), "utf8")).toContain('"patched"');
    } else {
      expect(result.stderr).toContain("renaming changes to cache dir");
      expect(result.stderr).toContain(ENV);
      expect(result.exitCode).not.toBe(0);
    }
  });

  test.each(modes)("global virtual store entry: $mode", async ({ budget, holdMs }) => {
    await using server = serveRegistry();
    using s = scaffold("rename-retry-global-store", registryBunfig(server.port) + `linker = "isolated"\n`, {});

    // Entries are assembled in `<cache>/links/<entry>.tmp-<suffix>` and
    // renamed to `<cache>/links/<entry>`.
    const blocker = spawnBlocker(join(s.cache, "links"), ".tmp-", holdMs);
    await blocker.ready;

    const result = await runInstall(s.project, { ...s.env, BUN_INSTALL_GLOBAL_STORE: "1", [ENV]: budget });
    const blockerOut = await blocker.finish();
    expect(blockerOut).toContain("HELD");

    if (budget === undefined) {
      expect(result).toMatchObject({ exitCode: 0 });
      const entry = readlinkSync(join(s.project, "node_modules", ".bun", `${PKG}@1.0.0`));
      expect(existsSync(join(entry, "node_modules", PKG, "bin.exe"))).toBe(true);
    } else {
      // Without the retry this path mistook the held staging dir for an
      // entry a concurrent install had published, deleted it and reported
      // success, leaving node_modules/.bun pointing at nothing.
      expect(result.stderr).toContain(ENV);
      expect(result.exitCode).not.toBe(0);
    }
  });
});
