// Verifies that `bun install` can extract a tarball while it is still
// downloading. A local registry drip-feeds the .tgz body in small
// chunks so the HTTP thread delivers multiple progress callbacks; the
// streaming extractor (TarballStream.zig + the ARCHIVE_RETRY patches in
// vendor/libarchive) must reassemble them into the same on-disk layout
// the buffered extractor would produce.

import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, readdirSorted, tempDir } from "harness";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

// -------------------------------------------------------------------
// Tarball construction helpers. We build the .tgz in-process so the
// test can control entry count, path length (exercises pax extended
// headers) and total size (large enough that it can't arrive in a
// single socket read) without committing a binary fixture.
// -------------------------------------------------------------------

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function tarHeader(name: string, size: number, type: "0" | "5" | "x"): Buffer {
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
  const pad = (512 - (len % 512)) % 512;
  return Buffer.alloc(pad, 0);
}

function tarFile(name: string, body: Buffer): Buffer[] {
  // ustar stores at most 100 bytes of name; longer paths need a pax
  // 'x' record. npm's `tar` uses pax, so this exercises the resumable
  // `tar_read_header` path in the libarchive patch.
  if (name.length > 100) {
    // Build the pax record so that the declared length includes the
    // length field itself. Iterate because adding digits to the length
    // prefix can change its own width.
    let len = 0;
    let record: string;
    do {
      record = `${len} path=${name}\n`;
      len = Buffer.byteLength(record, "utf8");
    } while (record !== `${len} path=${name}\n`);
    const pax = Buffer.from(record, "utf8");
    return [
      tarHeader("PaxHeader", pax.length, "x"),
      pax,
      pad512(pax.length),
      tarHeader(name.slice(0, 99), body.length, "0"),
      body,
      pad512(body.length),
    ];
  }
  return [tarHeader(name, body.length, "0"), body, pad512(body.length)];
}

type Entry = { path: string; body: Buffer };

function buildTarball(entries: Entry[]): { tgz: Buffer; shasum: string; integrity: string } {
  const blocks: Buffer[] = [];
  for (const { path, body } of entries) blocks.push(...tarFile(`package/${path}`, body));
  blocks.push(Buffer.alloc(1024, 0)); // two zero blocks = end-of-archive
  const tar = Buffer.concat(blocks);
  const tgz = gzipSync(tar);
  return {
    tgz,
    shasum: createHash("sha1").update(tgz).digest("hex"),
    integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
  };
}

// Entries chosen to cover: a tiny file, a long-path file that forces a
// pax 'x' header, and enough bulk that — once gzipped — the tarball is
// comfortably larger than a single TCP window so streaming actually
// kicks in even without server-side trickling.
function makeEntries(): Entry[] {
  const entries: Entry[] = [
    {
      path: "package.json",
      body: Buffer.from(JSON.stringify({ name: "stream-pkg", version: "1.0.0", main: "index.js" }) + "\n"),
    },
    { path: "index.js", body: Buffer.from("module.exports = 'ok';\n") },
    {
      // > 100 chars → pax extended header → exercises the resumable
      // header path in the libarchive patch.
      path: "very/deeply/nested/directory/structure/that/exceeds/the/one/hundred/byte/ustar/limit/long-name-file.txt",
      body: Buffer.from("long path ok\n"),
    },
  ];
  // Bulk entries: SHA-chained bytes so gzip can't collapse them away.
  // Sized so the compressed tarball exceeds the default
  // BUN_INSTALL_STREAMING_MIN_SIZE (2 MB) — streaming only commits
  // when Content-Length is above that threshold.
  for (let i = 0; i < 48; i++) {
    const bytes = Buffer.alloc(48 * 1024);
    let seed = createHash("sha256").update(`chunk-${i}`).digest();
    for (let off = 0; off < bytes.length; off += 32) {
      seed.copy(bytes, off);
      seed = createHash("sha256").update(seed).digest();
    }
    entries.push({ path: `data/chunk-${i}.bin`, body: bytes });
  }
  return entries;
}

// -------------------------------------------------------------------
// Drip-feed registry. The tarball body is written in small slices with
// a microtask yield between each so `NetworkTask.notify` is called
// repeatedly with `has_more=true`, which is what commits the request
// to the streaming extractor.
//
// Uses node:http rather than Bun.serve so the response can carry both
// an explicit Content-Length *and* be drip-fed — Bun.serve forces
// `Transfer-Encoding: chunked` for stream bodies, which would bypass
// the BUN_INSTALL_STREAMING_MIN_SIZE gate.
// -------------------------------------------------------------------

async function makeRegistry(tgz: Buffer, shasum: string, integrity: string, chunkBytes: number) {
  let tarballHits = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    if (url.pathname.endsWith("/stream-pkg")) {
      const body = JSON.stringify({
        name: "stream-pkg",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: "stream-pkg",
            version: "1.0.0",
            dist: {
              shasum,
              integrity,
              tarball: `http://127.0.0.1:${port}/stream-pkg/-/stream-pkg-1.0.0.tgz`,
            },
          },
        },
      });
      res.setHeader("content-type", "application/json");
      res.setHeader("content-length", String(Buffer.byteLength(body)));
      res.end(body);
      return;
    }
    if (url.pathname.endsWith("/stream-pkg-1.0.0.tgz")) {
      tarballHits++;
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("content-length", String(tgz.length));
      // Prevent Nagle coalescing so each write() is its own packet.
      req.socket.setNoDelay(true);
      let i = 0;
      const step = () => {
        if (i >= tgz.length) {
          res.end();
          return;
        }
        res.write(tgz.subarray(i, Math.min(i + chunkBytes, tgz.length)));
        i += chunkBytes;
        setImmediate(step);
      };
      step();
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    get tarballHits() {
      return tarballHits;
    },
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

async function runInstall(cwd: string, registry: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--verbose", "--linker=hoisted"],
    cwd,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(cwd, ".cache"),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("streaming tarball extraction", () => {
  const entries = makeEntries();
  const { tgz, shasum, integrity } = buildTarball(entries);

  // Keep chunks small enough that tar headers, pax payloads and file
  // bodies all span multiple read-callback invocations, but not so
  // small that the drip-feed itself dominates the test runtime on a
  // debug build. 4 KB × ~580 chunks ≈ 2.3 MB.
  const chunkBytes = 4096;

  // Sanity: the generated tarball must be larger than the default
  // streaming threshold, otherwise the "streaming" case silently
  // takes the buffered fallback and the assertion below becomes a
  // false pass.
  expect(tgz.length).toBeGreaterThan(2 * 1024 * 1024);

  test.each([
    ["streaming", {}],
    ["buffered", { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" }],
  ] as const)("extracts a drip-fed tarball correctly (%s)", async (label, env) => {
    await using reg = await makeRegistry(tgz, shasum, integrity, chunkBytes);
    const registry = reg.url;

    using dir = tempDir("streaming-extract", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "stream-pkg": "1.0.0" },
      }),
      "bunfig.toml": `[install]\nregistry = "${registry}"\n`,
    });

    const { stderr, exitCode } = await runInstall(String(dir), registry, env);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("Integrity check failed");

    // The "Streamed … tarball" verbose line is printed by
    // TarballStream.finish(); its presence confirms the streaming
    // path was taken (and its absence confirms the buffered path).
    if (label === "streaming") {
      expect(stderr).toContain("Streamed ");
    } else {
      expect(stderr).not.toContain("Streamed ");
    }
    expect(reg.tarballHits).toBe(1);

    // Every entry must be present with byte-identical contents
    // regardless of which extractor ran.
    const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
    for (const { path, body } of entries) {
      const got = readFileSync(join(pkgRoot, path));
      expect([path, got.equals(body)]).toEqual([path, true]);
    }

    expect(await readdirSorted(join(pkgRoot, "data"))).toHaveLength(48);
    expect(exitCode).toBe(0);
  });

  test("tarballs below BUN_INSTALL_STREAMING_MIN_SIZE take the buffered path", async () => {
    // Reuse the same large tarball but raise the threshold above it.
    // The server sends Content-Length, so `notify()` sees a body_size
    // below the minimum and never commits to streaming even though
    // the body arrives over many packets.
    await using reg = await makeRegistry(tgz, shasum, integrity, chunkBytes);
    const registry = reg.url;

    using dir = tempDir("streaming-extract-small", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "stream-pkg": "1.0.0" },
      }),
      "bunfig.toml": `[install]\nregistry = "${registry}"\n`,
    });

    const { stderr, exitCode } = await runInstall(String(dir), registry, {
      BUN_INSTALL_STREAMING_MIN_SIZE: String(tgz.length + 1),
    });
    expect(stderr).not.toContain("Streamed ");
    expect(stderr).not.toContain("error:");
    const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
    for (const { path, body } of entries) {
      const got = readFileSync(join(pkgRoot, path));
      expect([path, got.equals(body)]).toEqual([path, true]);
    }
    expect(exitCode).toBe(0);
  });

  test("streaming rejects a tarball whose integrity does not match", async () => {
    // Serve the valid tarball but advertise the integrity of a
    // *different* blob. Extraction will stream to completion (so we
    // exercise the full ARCHIVE_RETRY path through libarchive), the
    // incremental hasher produces the real SHA-512, and `finish()`
    // must notice the mismatch before the temp tree is promoted into
    // the cache.
    const other = buildTarball([
      { path: "package.json", body: Buffer.from('{"name":"stream-pkg","version":"1.0.0"}\n') },
    ]);
    await using reg = await makeRegistry(tgz, other.shasum, other.integrity, chunkBytes);
    const registry = reg.url;

    using dir = tempDir("streaming-extract-bad", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "stream-pkg": "1.0.0" },
      }),
      "bunfig.toml": `[install]\nregistry = "${registry}"\n`,
    });

    const { stderr, exitCode } = await runInstall(String(dir), registry);
    expect(stderr).toContain("Integrity check failed");
    expect(exitCode).not.toBe(0);
  });
});
