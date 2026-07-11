// https://github.com/oven-sh/bun/issues/33977
// `bun install` must not leave package-extraction temp directories behind in
// the install temp dir ($BUN_TMPDIR / $TMPDIR): neither when two concurrent
// installs race the same cache entry (the RENAME_EXCHANGE fallback used to
// strand the loser's copy), nor when extraction or patching fails partway.

import { expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { bunEnv, bunExe, readdirSorted, tempDir } from "harness";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

setDefaultTimeout(1000 * 60 * 5);

// ---------------------------------------------------------------------------
// Minimal in-process tarball + registry helpers (no binary fixtures).
// ---------------------------------------------------------------------------

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function tarHeader(name: string, size: number, type: "0" | "5"): Buffer {
  const buf = Buffer.alloc(512, 0);
  buf.write(name, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100); // mode
  buf.write(octal(0, 8), 108); // uid
  buf.write(octal(0, 8), 116); // gid
  buf.write(octal(size, 12), 124); // size
  buf.write(octal(0, 12), 136); // mtime
  buf.fill(" ", 148, 156); // checksum placeholder
  buf.write(type, 156);
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(octal(sum, 8), 148);
  return buf;
}

function pad512(len: number): Buffer {
  return Buffer.alloc((512 - (len % 512)) % 512, 0);
}

function buildTarball(entries: { path: string; body: Buffer }[]): { tgz: Buffer; integrity: string } {
  const blocks: Buffer[] = [];
  for (const { path, body } of entries) {
    blocks.push(tarHeader(`package/${path}`, body.length, "0"), body, pad512(body.length));
  }
  blocks.push(Buffer.alloc(1024, 0)); // end-of-archive
  const tgz = gzipSync(Buffer.concat(blocks));
  return { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") };
}

// A package with enough files that extraction takes long enough for two
// concurrent installs to reliably race the same cache entry.
function makePackageTarball(name: string, fileCount: number) {
  const entries = [{ path: "package.json", body: Buffer.from(JSON.stringify({ name, version: "1.0.0" }) + "\n") }];
  for (let i = 0; i < fileCount; i++) {
    // Incompressible content so gzip can't collapse the files away.
    const body = Buffer.alloc(1024);
    let seed = createHash("sha256").update(`${name}-${i}`).digest();
    for (let off = 0; off < body.length; off += 32) {
      seed.copy(body, off);
      seed = createHash("sha256").update(seed).digest();
    }
    entries.push({ path: `files/f${i}.bin`, body });
  }
  return buildTarball(entries);
}

// Serves packuments at /<name> and tarballs at /<name>/-/<name>-1.0.0.tgz.
function makeRegistry(packages: Record<string, { tgz: Buffer; integrity: string }>) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      for (const [name, { tgz, integrity }] of Object.entries(packages)) {
        if (pathname === `/${name}`) {
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name,
                version: "1.0.0",
                dist: {
                  integrity,
                  tarball: `${server.url}${name}/-/${name}-1.0.0.tgz`,
                },
              },
            },
          });
        }
        if (pathname === `/${name}/-/${name}-1.0.0.tgz`) {
          return new Response(tgz);
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

async function runInstall(cwd: string, cacheDir: string, tmpDir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-save", "--linker=hoisted"],
    cwd,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      BUN_TMPDIR: tmpDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("concurrent installs sharing a cache do not leak temp directories", async () => {
  const packageCount = 8;
  const packages: Record<string, { tgz: Buffer; integrity: string }> = {};
  for (let i = 0; i < packageCount; i++) {
    packages[`leaky-pkg-${i}`] = makePackageTarball(`leaky-pkg-${i}`, 150);
  }
  using server = makeRegistry(packages);

  const dependencies = Object.fromEntries(Object.keys(packages).map(name => [name, "1.0.0"]));
  const files: Record<string, string> = { "tmp/.keep": "", "cache/.keep": "" };
  for (const proj of ["proj1", "proj2"]) {
    files[`${proj}/package.json`] = JSON.stringify({ name: proj, version: "1.0.0", dependencies });
    files[`${proj}/bunfig.toml`] = `[install]\nregistry = "${server.url}"\n`;
  }
  using dir = tempDir("tempdir-leak", files);
  const tmpDir = join(String(dir), "tmp");
  const cacheDir = join(String(dir), "cache");

  for (let iteration = 0; iteration < 5; iteration++) {
    // Evict the cache so both installs extract (and race) every package again.
    await Promise.all([
      rm(cacheDir, { recursive: true, force: true }),
      rm(join(String(dir), "proj1", "node_modules"), { recursive: true, force: true }),
      rm(join(String(dir), "proj2", "node_modules"), { recursive: true, force: true }),
    ]);

    const [r1, r2] = await Promise.all([
      runInstall(join(String(dir), "proj1"), cacheDir, tmpDir),
      runInstall(join(String(dir), "proj2"), cacheDir, tmpDir),
    ]);
    expect({ stderr: r1.stderr, exitCode: r1.exitCode }).toMatchObject({ exitCode: 0 });
    expect({ stderr: r2.stderr, exitCode: r2.exitCode }).toMatchObject({ exitCode: 0 });
  }

  expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
});

test("a tarball that fails to extract does not leak its temp directory", async () => {
  // Valid integrity (computed over the bytes) but not a gzip stream, so the
  // failure happens during extraction, after the temp dir was created.
  const tgz = Buffer.from("this is definitely not a gzipped tarball");
  using server = makeRegistry({
    "corrupt-pkg": { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") },
  });

  using dir = tempDir("tempdir-leak-corrupt", {
    "proj/package.json": JSON.stringify({
      name: "proj",
      version: "1.0.0",
      dependencies: { "corrupt-pkg": "1.0.0" },
    }),
    "proj/bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
    "tmp/.keep": "",
    "cache/.keep": "",
  });
  const tmpDir = join(String(dir), "tmp");

  const { stderr, exitCode } = await runInstall(join(String(dir), "proj"), join(String(dir), "cache"), tmpDir);
  expect(stderr).toContain("corrupt-pkg");
  expect(exitCode).not.toBe(0);

  expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
});

test("a patch that fails to apply does not leak its temp directory", async () => {
  using server = makeRegistry({ "patched-pkg": makePackageTarball("patched-pkg", 3) });

  // Parses fine, but targets a file the package doesn't contain.
  const patch = [
    "diff --git a/missing.txt b/missing.txt",
    "index 0000000..1111111 100644",
    "--- a/missing.txt",
    "+++ b/missing.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  using dir = tempDir("tempdir-leak-patch", {
    "proj/package.json": JSON.stringify({
      name: "proj",
      version: "1.0.0",
      dependencies: { "patched-pkg": "1.0.0" },
      patchedDependencies: { "patched-pkg@1.0.0": "patches/patched-pkg.patch" },
    }),
    "proj/patches/patched-pkg.patch": patch,
    "proj/bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
    "tmp/.keep": "",
    "cache/.keep": "",
  });
  const tmpDir = join(String(dir), "tmp");

  const { stderr } = await runInstall(join(String(dir), "proj"), join(String(dir), "cache"), tmpDir);
  expect(stderr).toContain("failed applying patch file");

  expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
});
