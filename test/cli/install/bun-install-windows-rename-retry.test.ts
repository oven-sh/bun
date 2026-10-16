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
//
// The isolated linker retries one more rename: it moves an installed
// project-local package aside before it links it again. If that rename fails it
// links in place, so the install succeeds either way.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
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

const expectedFiles = Array.from({ length: 300 }, (_, i) => `${i}.txt`);

/** Counts `dir`'s files in three independent ways, and names the ones each way does not find. */
function diag(label: string, dir: string) {
  const without = (found: string[]) => {
    const set = new Set(found);
    return expectedFiles.filter(name => !set.has(name)).join(",");
  };
  let listed: string[] = [];
  try {
    listed = readdirSync(dir);
  } catch (e) {
    console.log(`DIAG ${label}: readdirSync threw ${(e as Error).message}`);
  }
  const present = expectedFiles.filter(name => existsSync(join(dir, name)));
  const cmd = Bun.spawnSync({ cmd: ["cmd", "/c", "dir", "/b", dir], stderr: "pipe" });
  const cmdListed = cmd.stdout.toString().split(/\r?\n/).filter(Boolean);
  console.log(
    `DIAG ${label}: readdirSync=${listed.length} [${without(listed)}] existsSync=${present.length} [${without(present)}] cmd=${cmdListed.length} [${without(cmdListed)}]`,
  );
}

/** The same for every directory named `files` at most `depth` levels below `root`. */
function diagBelow(label: string, root: string, depth = 4) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (entry.name === "files") diag(`${label} ${path}`, path);
    else if (depth > 0) diagBelow(label, path, depth - 1);
  }
}

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

  diag("source directory", join(String(pkgDir), "package", "files"));
  const inTarball = (await Bun.$`tar -tzf ${tgz}`.text())
    .split(/\r?\n/)
    .filter(line => /^package\/files\/\d+\.txt$/.test(line))
    .map(line => line.slice("package/files/".length));
  const inTarballSet = new Set(inTarball);
  console.log(
    `DIAG tarball: ${inTarball.length} [${expectedFiles.filter(name => !inTarballSet.has(name)).join(",")}] first=${inTarball[0]} last=${inTarball.at(-1)} bytes=${tgzBytes.length}`,
  );
  console.log(`DIAG tar: ${Bun.which("tar")} ${(await Bun.$`tar --version`.text()).trim()}`);
  const machine = Bun.spawnSync({
    cmd: [
      "pwsh",
      "-NoProfile",
      "-Command",
      [
        `"boot: " + (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")`,
        `"now: " + (Get-Date).ToUniversalTime().ToString("o")`,
        `"cpu: " + (Get-CimInstance Win32_Processor | Select-Object -First 1).Name`,
        `Get-Content C:\\bun-image.txt -TotalCount 3`,
        `Get-MpComputerStatus | Select-Object AMRunningMode,AMServiceEnabled,RealTimeProtectionEnabled,OnAccessProtectionEnabled,AMProductVersion,AMEngineVersion,AntivirusSignatureVersion,AntivirusSignatureLastUpdated | Format-List | Out-String`,
        `fsutil 8dot3name query C:`,
        `Get-Volume -DriveLetter C | Select-Object FileSystemType,SizeRemaining | Format-List | Out-String`,
        `Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name,Id,CPU,StartTime | Format-Table -AutoSize | Out-String -Width 160`,
      ].join("; "),
    ],
    stderr: "pipe",
  });
  for (const line of (machine.stdout.toString() + machine.stderr.toString()).split(/\r?\n/)) {
    if (line.trim()) console.log(`DIAG machine: ${line}`);
  }
}, 120_000);

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

async function runInstall(cwd: string, env: Record<string, string | undefined>, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
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

  // Nothing stalls these two installs before the rename: one the fixture comes too late for must succeed, and another is made.
  test.each(modes)("patched package: $mode", async ({ budget, holdMs }) => {
    await using server = serveRegistry();
    let held = false;
    for (let attempt = 0; attempt < 10 && !held; attempt++) {
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
      held = (await blocker.finish()).includes("HELD");

      if (budget === undefined || !held) {
        expect(result).toMatchObject({ exitCode: 0 });
        expect(readFileSync(join(s.project, "node_modules", PKG, "index.js"), "utf8")).toContain('"patched"');
      } else {
        expect(result.stderr).toContain("renaming changes to cache dir");
        expect(result.stderr).toContain(ENV);
        expect(result.exitCode).not.toBe(0);
      }
    }
    expect(held, "the fixture never held the staging directory").toBe(true);
  });

  test.each(modes)("global virtual store entry: $mode", async ({ budget, holdMs }) => {
    await using server = serveRegistry();
    let held = false;
    for (let attempt = 0; attempt < 10 && !held; attempt++) {
      using s = scaffold("rename-retry-global-store", registryBunfig(server.port) + `linker = "isolated"\n`, {});

      // Entries are assembled in `<cache>/links/<entry>.tmp-<suffix>` and
      // renamed to `<cache>/links/<entry>`.
      const blocker = spawnBlocker(join(s.cache, "links"), ".tmp-", holdMs);
      await blocker.ready;

      const result = await runInstall(s.project, { ...s.env, BUN_INSTALL_GLOBAL_STORE: "1", [ENV]: budget });
      held = (await blocker.finish()).includes("HELD");

      if (budget === undefined || !held) {
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
    }
    expect(held, "the fixture never held the staging directory").toBe(true);
  });

  // The held file is not one of the package's: it is gone if the old directory was moved aside
  // and deleted, and still there if the package was linked in place.
  test.each([
    { mode: "default budget outlasts a 2s hold", budget: undefined, holdMs: HOLD_MS },
    { mode: `${ENV}=0 links in place`, budget: "0", holdMs: 15_000 },
  ])("reinstalled project-local store entry: $mode", async ({ budget, holdMs }) => {
    await using server = serveRegistry();
    using s = scaffold("rename-retry-local-store", registryBunfig(server.port) + `linker = "isolated"\n`, {});
    const installed = join(s.project, "node_modules", ".bun", `${PKG}@1.0.0`, "node_modules", PKG);

    const first = await runInstall(s.project, s.env);
    console.log(`DIAG [${budget}] first install: ${JSON.stringify(first)}`);
    diagBelow(`[${budget}] cache after the first install`, s.cache);
    diag(`[${budget}] installed after the first install`, join(installed, "files"));
    console.log(`DIAG [${budget}] nlink of files/0.txt: ${statSync(join(installed, "files", "0.txt")).nlink}`);
    expect(first).toMatchObject({ exitCode: 0 });
    mkdirSync(join(installed, "held"));
    writeFileSync(join(installed, "held", "file.txt"), "");

    // The file is there already, so the fixture holds it before the install starts.
    const blocker = spawnBlocker(installed, "held", holdMs);
    await blocker.held;

    const result = await runInstall(s.project, { ...s.env, [ENV]: budget }, ["--force"]);
    const blockerOutput = await blocker.finish();
    console.log(`DIAG [${budget}] --force install: ${JSON.stringify(result)} blocker: ${JSON.stringify(blockerOutput)}`);
    diagBelow(`[${budget}] cache after --force`, s.cache);
    diag(`[${budget}] installed after --force`, join(installed, "files"));
    console.log(`DIAG [${budget}] next to the package: ${readdirSync(join(installed, "..")).join(",")}`);
    console.log(`DIAG [${budget}] in the package: ${readdirSync(installed).join(",")}`);
    expect(blockerOutput).toContain("HELD");

    expect(result).toMatchObject({ exitCode: 0 });
    expect({
      packageJson: existsSync(join(installed, "package.json")),
      binExe: existsSync(join(installed, "bin.exe")),
      files: readdirSync(join(installed, "files")).length,
      heldFile: existsSync(join(installed, "held", "file.txt")),
    }).toEqual({ packageJson: true, binExe: true, files: 300, heldFile: budget !== undefined });
  });
});
