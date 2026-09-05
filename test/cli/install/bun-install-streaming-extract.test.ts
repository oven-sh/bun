// Verifies that `bun install` can extract a tarball while it is still
// downloading. A local registry drip-feeds the .tgz body in small
// chunks so the HTTP thread delivers multiple progress callbacks; the
// streaming extractor (TarballStream.zig + the ARCHIVE_RETRY patches in
// vendor/libarchive) must reassemble them into the same on-disk layout
// the buffered extractor would produce.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, readdirSorted, tempDir } from "harness";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { createGzip, gzipSync } from "node:zlib";

setDefaultTimeout(1000 * 60 * 5);

// -------------------------------------------------------------------
// Tarball construction helpers. We build the .tgz in-process so the
// test can control entry count, path length (exercises pax extended
// headers) and total size (large enough that it can't arrive in a
// single socket read) without committing a binary fixture.
// -------------------------------------------------------------------

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function tarHeader(name: string, size: number, type: "0" | "5" | "x" | "g"): Buffer {
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

type Faults = {
  /** Pick the size of each body write (default: fixed `chunkBytes`). */
  chunker?: (offset: number) => number;
  /** Milliseconds to wait between writes (default: none, `setImmediate`). */
  delayMs?: (offset: number) => number;
  /** Destroy the tarball connection after this many body bytes... */
  dropTarballAt?: number;
  /** ...for the first N tarball requests (default: every request). */
  dropTarballTimes?: number;
  /** Destroy the first N manifest connections half-way through the body. */
  dropManifestTimes?: number;
};

async function makeRegistry(tgz: Buffer, shasum: string, integrity: string, chunkBytes: number, faults: Faults = {}) {
  let tarballHits = 0;
  let manifestHits = 0;
  let tarballDropsLeft = faults.dropTarballTimes ?? Infinity;
  let manifestDropsLeft = faults.dropManifestTimes ?? 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    // `stream-pkg`, plus `stream-pkg-<n>` aliases of the same tarball so a
    // single install can run several streams at once.
    const manifest = url.pathname.match(/^\/(stream-pkg(?:-\d+)?)$/);
    if (manifest) {
      manifestHits++;
      const name = manifest[1];
      const body = JSON.stringify({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name,
            version: "1.0.0",
            dist: {
              shasum,
              integrity,
              tarball: `http://127.0.0.1:${port}/${name}/-/${name}-1.0.0.tgz`,
            },
          },
        },
      });
      res.setHeader("content-type", "application/json");
      if (manifestDropsLeft > 0) {
        manifestDropsLeft--;
        // Promise a body twice as long as what is sent, then hang up.
        const padded = body + " ".repeat(body.length);
        res.setHeader("content-length", String(Buffer.byteLength(padded)));
        res.write(padded.slice(0, body.length + 1), () => req.socket.destroy());
        return;
      }
      res.setHeader("content-length", String(Buffer.byteLength(body)));
      res.end(body);
      return;
    }
    if (/\/stream-pkg(-\d+)?-1\.0\.0\.tgz$/.test(url.pathname)) {
      tarballHits++;
      const dropAt = faults.dropTarballAt !== undefined && tarballDropsLeft > 0 ? faults.dropTarballAt : -1;
      if (dropAt >= 0) tarballDropsLeft--;
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
        if (dropAt >= 0 && i >= dropAt) {
          req.socket.destroy();
          return;
        }
        const n = faults.chunker ? Math.max(1, faults.chunker(i)) : chunkBytes;
        res.write(tgz.subarray(i, Math.min(i + n, tgz.length)));
        i += n;
        const delay = faults.delayMs ? faults.delayMs(i) : 0;
        if (delay > 0) setTimeout(step, delay);
        else setImmediate(step);
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
    get manifestHits() {
      return manifestHits;
    },
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

async function runInstall(cwd: string, extraEnv: Record<string, string> = {}) {
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
  return { stdout, stderr, exitCode, resourceUsage: proc.resourceUsage() };
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
      "bunfig.toml": Bun.TOML.stringify({ install: { registry } }),
    });

    const { stderr, exitCode } = await runInstall(String(dir), env);
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

  test.each([
    ["streaming", {}],
    ["buffered", { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" }],
  ] as const)("a URL tarball dependency is tagged with its integrity and not reinstalled (%s)", async (label, env) => {
    await using reg = await makeRegistry(tgz, shasum, integrity, chunkBytes);

    using dir = tempDir("streaming-url-dep", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "stream-pkg": `${reg.url}stream-pkg/-/stream-pkg-1.0.0.tgz` },
      }),
    });

    const first = await runInstall(String(dir), env);
    expect(first.stderr).not.toContain("error:");
    if (label === "streaming") {
      expect(first.stderr).toContain("Streamed ");
    } else {
      expect(first.stderr).not.toContain("Streamed ");
    }
    expect(first.stdout).toContain("1 package installed");
    expect(readFileSync(join(String(dir), "node_modules", "stream-pkg", ".bun-tag"), "utf8")).toBe(integrity);
    expect(readFileSync(join(String(dir), "bun.lock"), "utf8")).toContain(`"${integrity}"`);
    expect(first.exitCode).toBe(0);

    const second = await runInstall(String(dir), env);
    expect(second.stderr).not.toContain("Saved lockfile");
    expect(second.stdout).toContain("(no changes)");
    expect(reg.tarballHits).toBe(1);
    expect(second.exitCode).toBe(0);
  });

  // Regression: archive_read_set_options() clobbered the a->format set by
  // archive_read_set_format(), so archive_read_open1() fell back to format
  // bidding. The tar bidder needs 512 decompressed bytes up front; when the
  // first HTTP chunk is smaller than the 10-byte gzip header, the gzip
  // filter returns ARCHIVE_RETRY, which the bidder (called with avail=NULL)
  // treats as "no data" and bids 0, yielding "Unrecognized archive format"
  // and a user-facing "Fail extracting tarball". Observed in CI on macOS
  // (where kqueue tends to surface a tiny first chunk) for large packages
  // such as aws-cdk-lib and next.
  test("streaming extract succeeds when the first chunk is smaller than the gzip header", async () => {
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
              dist: { shasum, integrity, tarball: `http://127.0.0.1:${port}/stream-pkg/-/stream-pkg-1.0.0.tgz` },
            },
          },
        });
        res.setHeader("content-type", "application/json");
        res.end(body);
        return;
      }
      if (url.pathname.endsWith("/stream-pkg-1.0.0.tgz")) {
        tarballHits++;
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("content-length", String(tgz.length));
        req.socket.setNoDelay(true);
        // First chunk: only the gzip magic bytes. gzip's header is 10 bytes,
        // so the filter cannot even finish consume_header() and must return
        // ARCHIVE_RETRY the first time the streaming extractor calls it.
        res.write(tgz.subarray(0, 2));
        // Give the client long enough to receive the 2 bytes, schedule its
        // drain task, and run open_archive() before any further body arrives.
        // This is shaping the input, not waiting on a condition in the test.
        setTimeout(() => res.end(tgz.subarray(2)), 100);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    try {
      using dir = tempDir("streaming-extract-tiny-first-chunk", {
        "package.json": JSON.stringify({
          name: "app",
          version: "1.0.0",
          dependencies: { "stream-pkg": "1.0.0" },
        }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: `http://127.0.0.1:${port}/` } }),
      });

      const { stderr, exitCode } = await runInstall(String(dir));
      expect(stderr).not.toContain("Fail extracting tarball");
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("Streamed ");
      expect(tarballHits).toBe(1);

      const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
      for (const { path, body } of entries) {
        const got = readFileSync(join(pkgRoot, path));
        expect([path, got.equals(body)]).toEqual([path, true]);
      }
      expect(exitCode).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test("streaming extract skips an entry whose pathname is longer than the path buffer", async () => {
    const longName = Buffer.alloc(40000, "a").toString("utf8");
    const longEntries: Entry[] = [...entries, { path: longName, body: Buffer.from("long name body\n") }];
    const built = buildTarball(longEntries);
    expect(built.tgz.length).toBeGreaterThan(2 * 1024 * 1024);

    await using reg = await makeRegistry(built.tgz, built.shasum, built.integrity, chunkBytes);
    const registry = reg.url;

    using dir = tempDir("streaming-extract-long-path", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "stream-pkg": "1.0.0" },
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry } }),
    });

    const { stderr, exitCode } = await runInstall(String(dir));
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Streamed ");
    expect(reg.tarballHits).toBe(1);

    const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
    for (const { path, body } of entries) {
      const got = readFileSync(join(pkgRoot, path));
      expect([path, got.equals(body)]).toEqual([path, true]);
    }
    expect(existsSync(join(pkgRoot, longName))).toBe(false);
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
      "bunfig.toml": Bun.TOML.stringify({ install: { registry } }),
    });

    const { stderr, exitCode } = await runInstall(String(dir), {
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
      "bunfig.toml": Bun.TOML.stringify({ install: { registry } }),
    });

    const { stderr, exitCode } = await runInstall(String(dir));
    expect(stderr).toContain("Integrity check failed");
    expect(exitCode).not.toBe(0);
  });

  // A connection that dies part-way through the body is a failed download,
  // whichever extractor is consuming it: report the transport error, retry
  // like any other failed download, and never hand the truncated body to
  // libarchive (streaming) or the integrity check (buffered).
  describe.each([
    ["streaming", {}],
    ["buffered", { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" }],
  ] as const)("tarball connection dropped mid-body (%s)", (label, env) => {
    test.concurrent("is retried and then succeeds", async () => {
      await using reg = await makeRegistry(tgz, shasum, integrity, 64 * 1024, {
        dropTarballAt: tgz.length >> 1,
        dropTarballTimes: 2,
      });
      using dir = tempDir("streaming-extract-drop-retry", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "stream-pkg": "1.0.0" } }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: reg.url } }),
        "tmp/.keep": "",
      });
      const tmp = join(String(dir), "tmp");

      const { stderr, exitCode } = await runInstall(String(dir), { ...env, BUN_TMPDIR: tmp, TMPDIR: tmp });
      expect(stderr).not.toContain("error:");
      expect(stderr).not.toContain("extracting tarball");
      expect(stderr.match(/ConnectionClosed downloading tarball stream-pkg@1\.0\.0\. Retrying/g)).toHaveLength(2);
      if (label === "streaming") {
        expect(stderr).toContain("Streamed ");
      } else {
        expect(stderr).not.toContain("Streamed ");
      }
      expect(reg.tarballHits).toBe(3);
      const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
      for (const { path, body } of entries) {
        const got = readFileSync(join(pkgRoot, path));
        expect([path, got.equals(body)]).toEqual([path, true]);
      }
      // Extraction temp dirs from the failed attempts are removed.
      expect(readdirSync(tmp).filter(f => f.endsWith(".stream-pkg"))).toEqual([]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("is reported as a download error once retries are exhausted", async () => {
      await using reg = await makeRegistry(tgz, shasum, integrity, 64 * 1024, { dropTarballAt: tgz.length >> 1 });
      using dir = tempDir("streaming-extract-drop-fail", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "stream-pkg": "1.0.0" } }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: reg.url } }),
      });

      const { stderr, exitCode } = await runInstall(String(dir), { ...env, BUN_CONFIG_HTTP_RETRY_COUNT: "2" });
      expect(stderr).not.toContain("extracting tarball");
      expect(stderr).not.toContain("Integrity check failed");
      expect(stderr).toContain("error: ConnectionClosed downloading tarball stream-pkg@1.0.0");
      expect(reg.tarballHits).toBe(3);
      expect(exitCode).toBe(1);
    });
  });

  test.concurrent("manifest connection dropped mid-body is retried", async () => {
    await using reg = await makeRegistry(tgz, shasum, integrity, 64 * 1024, { dropManifestTimes: 1 });
    using dir = tempDir("streaming-extract-manifest-drop", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "stream-pkg": "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: reg.url } }),
    });

    const { stderr, exitCode } = await runInstall(String(dir));
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("ConnectionClosed downloading package manifest stream-pkg. Retry 1/");
    expect(reg.manifestHits).toBe(2);
    expect(reg.tarballHits).toBe(1);
    expect(exitCode).toBe(0);
  });

  // A body that arrives in full but is not a valid archive is an extraction
  // failure: not retried, and the message carries libarchive's reason and
  // the offset it gave up at.
  test.concurrent("streaming reports libarchive's error for a corrupt tarball", async () => {
    const corrupt = Buffer.from(tgz);
    corrupt.fill(0x55, corrupt.length >> 1, (corrupt.length >> 1) + 4096);
    const corruptIntegrity = "sha512-" + createHash("sha512").update(corrupt).digest("base64");
    const corruptShasum = createHash("sha1").update(corrupt).digest("hex");
    await using reg = await makeRegistry(corrupt, corruptShasum, corruptIntegrity, 64 * 1024);
    using dir = tempDir("streaming-extract-corrupt", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "stream-pkg": "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: reg.url } }),
    });

    const { stderr, exitCode } = await runInstall(String(dir));
    expect(stderr).toMatch(
      /error: Fail extracting tarball for "stream-pkg": [^\n]*(gzip decompression failed|[Tt]runcated|[Dd]amaged)[^\n]* \(at byte \d+ of \d+\)/,
    );
    expect(reg.tarballHits).toBe(1);
    expect(exitCode).toBe(1);
  });

  // Chunk boundaries land at arbitrary points in the gzip/tar stream and the
  // extractor yields its worker at each one. Sweep delivery patterns (tiny
  // writes, MSS-sized, TLS-record-sized, bursts larger than the socket
  // buffer, random) with several tarballs in flight at once so drains
  // interleave across pool threads, and require byte-identical output.
  {
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 0x100000000;
    };
    const patterns: [string, Faults][] = [
      // Tiny writes for the first 64 KB (gzip header, first tar headers),
      // then sub-MSS writes so the debug build finishes in seconds.
      ["tiny", { chunker: o => (o < 65536 ? 1 + Math.floor(rand() * 48) : 500 + Math.floor(rand() * 900)) }],
      ["mss", { chunker: () => 1200 + Math.floor(rand() * 260), delayMs: () => (rand() < 0.02 ? 1 : 0) }],
      ["16k", { chunker: () => 16384, delayMs: () => (rand() < 0.05 ? 2 : 0) }],
      ["burst", { chunker: () => 512 * 1024 + Math.floor(rand() * 512 * 1024) }],
      ["random", { chunker: () => 1 + Math.floor(rand() * 70000), delayMs: () => (rand() < 0.1 ? 1 : 0) }],
      ["whole", { chunker: () => tgz.length }],
    ];
    const streams = 4;
    test.concurrent.each(patterns)("streams concurrent tarballs correctly (%s chunks)", async (label, faults) => {
      await using reg = await makeRegistry(tgz, shasum, integrity, chunkBytes, faults);
      const dependencies: Record<string, string> = {};
      for (let i = 0; i < streams; i++) dependencies[`stream-pkg-${i}`] = "1.0.0";
      using dir = tempDir("streaming-extract-stress", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies }),
        "bunfig.toml": Bun.TOML.stringify({ install: { registry: reg.url } }),
      });
      const { stderr, exitCode } = await runInstall(String(dir), { BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1" });
      expect([label, stderr.match(/^error:.*$/m)?.[0] ?? null]).toEqual([label, null]);
      expect([label, stderr.match(/Streamed /g)?.length]).toEqual([label, streams]);
      for (let i = 0; i < streams; i++) {
        const pkgRoot = join(String(dir), "node_modules", `stream-pkg-${i}`);
        for (const { path, body } of entries) {
          const got = readFileSync(join(pkgRoot, path));
          expect([label, i, path, got.equals(body)]).toEqual([label, i, path, true]);
        }
      }
      expect(exitCode).toBe(0);
    });
  }

  // Below the threshold no drain is scheduled, so nothing lands in the
  // extraction temp dir; crossing it schedules one drain that writes
  // package.json while later entries stay absent until the body resumes.
  test.each([
    ["default", 256 * 1024, {}],
    ["override", 1024 * 1024, { BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: String(1024 * 1024) }],
  ] as const)("drain threshold holds off extraction until enough bytes arrive (%s)", async (_, threshold, extraEnv) => {
    const belowThreshold = threshold >> 1;
    const aboveThreshold = threshold + 128 * 1024;
    expect(aboveThreshold).toBeLessThan(tgz.length);

    const phase1 = Promise.withResolvers<void>();
    const gate1 = Promise.withResolvers<void>();
    const phase2 = Promise.withResolvers<void>();
    const gate2 = Promise.withResolvers<void>();

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/stream-pkg")) {
          return Response.json({
            name: "stream-pkg",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "stream-pkg",
                version: "1.0.0",
                dist: { shasum, integrity, tarball: `${server.url}stream-pkg/-/stream-pkg-1.0.0.tgz` },
              },
            },
          });
        }
        if (url.pathname.endsWith("stream-pkg-1.0.0.tgz")) {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(c) {
                for (let i = 0; i < belowThreshold; i += 8 * 1024) {
                  c.write(tgz.subarray(i, i + 8 * 1024));
                  await c.flush();
                }
                phase1.resolve();
                await gate1.promise;
                for (let i = belowThreshold; i < aboveThreshold; i += 8 * 1024) {
                  c.write(tgz.subarray(i, i + 8 * 1024));
                  await c.flush();
                }
                phase2.resolve();
                await gate2.promise;
                c.write(tgz.subarray(aboveThreshold));
                await c.flush();
                c.close();
              },
            }),
            { headers: { "content-type": "application/octet-stream" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    using dir = tempDir("streaming-extract-threshold", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "stream-pkg": "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: String(server.url) } }),
    });
    const tmp = join(String(dir), "bun-tmp");
    const cache = join(String(dir), "bun-cache");
    mkdirSync(tmp, { recursive: true });
    mkdirSync(cache, { recursive: true });

    const findExtracted = (name: string) => {
      for (const d of readdirSync(tmp, { withFileTypes: true })) {
        if (d.isDirectory() && existsSync(join(tmp, d.name, name))) return join(tmp, d.name, name);
      }
      return null;
    };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--verbose", "--linker=hoisted"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_TMPDIR: tmp,
        TMPDIR: tmp,
        BUN_INSTALL_CACHE_DIR: cache,
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutP = proc.stdout.text();
    const stderrP = proc.stderr.text();
    let gated = true;
    const earlyExit = proc.exited.then(async code => {
      if (gated) throw new Error(`bun install exited (${code}) before reaching a phase gate\n${await stderrP}`);
    });
    earlyExit.catch(() => {});

    // Phase 1: server has sent < threshold. No drain is scheduled, so the
    // temp dir stays empty; there is no "drain did not run" event to await
    // from outside the child, so poll a bounded window.
    await Promise.race([phase1.promise, earlyExit]);
    for (let i = 0; i < 25; i++) {
      expect(findExtracted("package.json")).toBeNull();
      await Bun.sleep(10);
    }

    // Phase 2: send past the threshold. The first drain runs and writes
    // package.json; the last data entry is still missing bytes.
    gate1.resolve();
    await Promise.race([phase2.promise, earlyExit]);
    let extractedPkgJson: string | null = null;
    for (let i = 0; i < 1000 && !(extractedPkgJson = findExtracted("package.json")); i++) await Bun.sleep(10);
    expect(extractedPkgJson).not.toBeNull();
    expect(findExtracted(join("data", "chunk-47.bin"))).toBeNull();

    // Finish.
    gated = false;
    gate2.resolve();
    const [stdout, stderr, exitCode] = await Promise.all([stdoutP, stderrP, proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Streamed ");
    expect({ stdout, exitCode }).toMatchObject({ exitCode: 0 });

    const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
    for (const { path, body } of entries) {
      const got = readFileSync(join(pkgRoot, path));
      expect([path, got.equals(body)]).toEqual([path, true]);
    }
  });
});

// -------------------------------------------------------------------
// Regression: the nonblocking-read patch routed upstream libarchive's
// pre-existing damaged-block ARCHIVE_RETRY through the same `bun_retry`
// path as a non-blocking yield, so `seen_headers` / entry state leaked
// across the retry. A second pax 'g' global header after the damaged
// block would then trip "Redundant 'g' header" → ARCHIVE_FATAL even
// though upstream libarchive (and a `tar` CLI) accepts this layout.
//
// This test goes through the buffered extractor only: local `file:`
// tarballs are read fully into memory by PackageManagerTask.readAndExtract
// and handed to Archiver.extractToDir, which loops on readNextHeader with
// `.retry => continue`. The streaming reader is never involved, so any
// behaviour change here is the libarchive patch leaking into the shared
// buffered codepath.
// -------------------------------------------------------------------
test("buffered extract: damaged-block retry resets header state (upstream semantics)", async () => {
  // One pax 'g' extended-header payload. libarchive's header_pax_global
  // just skips it, but parsing it sets `seen_headers |= seen_g_header`;
  // seeing a second one without an intervening state reset is what
  // triggers the "Redundant 'g' header" FATAL.
  const pax = Buffer.from("16 comment=test\n", "utf8");
  expect(pax.length).toBe(16);
  const paxEntry = () => [tarHeader("pax_global_header", pax.length, "g"), pax, pad512(pax.length)];

  // A 512-byte block that is neither all-zero (would be treated as the
  // end-of-archive marker) nor has a valid checksum: upstream tar emits
  // "Damaged tar archive (bad header checksum)" and returns
  // ARCHIVE_RETRY, which the Zig extract loop handles as `continue`.
  const damaged = Buffer.alloc(512, 0);
  damaged.write("junk", 0, "utf8");
  damaged.fill(" ", 148, 156); // checksum field left as spaces → guaranteed mismatch

  const fileBody = Buffer.from("damaged-block-retry ok\n", "utf8");
  const file = [tarHeader("package/index.js", fileBody.length, "0"), fileBody, pad512(fileBody.length)];

  const pkgJson = Buffer.from(JSON.stringify({ name: "damaged-pkg", version: "1.0.0", main: "index.js" }) + "\n");
  const pkgJsonEntry = [tarHeader("package/package.json", pkgJson.length, "0"), pkgJson, pad512(pkgJson.length)];

  // [g][damaged][g][package.json][index.js][EOF EOF]
  const tar = Buffer.concat([...paxEntry(), damaged, ...paxEntry(), ...pkgJsonEntry, ...file, Buffer.alloc(1024, 0)]);
  const tgz = gzipSync(tar);

  using dir = tempDir("damaged-block-retry", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "damaged-pkg": "file:./damaged-pkg.tgz" },
    }),
  });
  writeFileSync(join(String(dir), "damaged-pkg.tgz"), tgz);

  const { stderr, exitCode } = await runInstall(String(dir));

  // With the broken patch the second 'g' header trips
  // "Redundant 'g' header" → ARCHIVE_FATAL inside libarchive; the Zig
  // extract loop surfaces that as `error.Fail` → "Fail extracting
  // tarball". With upstream semantics restored the damaged block is
  // skipped, state is fully reset, and the file following the second
  // 'g' header is extracted normally.
  expect(stderr).not.toContain("Fail extracting tarball");
  expect(stderr).not.toContain("failed to resolve");
  expect(exitCode).toBe(0);

  const extracted = readFileSync(join(String(dir), "node_modules", "damaged-pkg", "index.js"));
  expect(extracted.equals(fileBody)).toBe(true);
});

// -------------------------------------------------------------------
// Buffered extract: the decompressed tar is never materialised in
// memory. libarchive gunzips on the fly, so a highly compressible .tgz
// installs without an RSS spike of roughly its decompressed size.
// Covers `file:` dependencies, which always take the buffered path.
// -------------------------------------------------------------------
test("buffered extract does not hold the decompressed local tarball in memory", async () => {
  // 256 MiB of zeros: above the 64 MB gzip ISIZE cutoff that gates the
  // libdeflate fast path, so libarchive (not libdeflate) decompresses,
  // and a multiple of 512 so the tar entry needs no trailing pad block.
  // The old path inflated this into a ~256 MB Vec before extraction,
  // which shows up directly in the child's maxRSS.
  const PAYLOAD_SIZE = 256 * 1024 * 1024;
  const ZERO_CHUNK = Buffer.alloc(8 * 1024 * 1024);

  const pkgJson = Buffer.from(JSON.stringify({ name: "oversized-pkg", version: "1.0.0" }) + "\n");

  using dir = tempDir("oversized-decompress", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "oversized-pkg": "file:./oversized-pkg.tgz" },
    }),
  });

  // Stream the tar through gzip straight to disk so the test process
  // never holds the uncompressed archive in memory either.
  const tgzPath = join(String(dir), "oversized-pkg.tgz");
  {
    const gzip = createGzip({ level: 1 });
    const out = createWriteStream(tgzPath);
    gzip.pipe(out);
    const writeTar = (chunk: Buffer) =>
      new Promise<void>((resolve, reject) => gzip.write(chunk, err => (err ? reject(err) : resolve())));

    await writeTar(tarHeader("package/package.json", pkgJson.length, "0"));
    await writeTar(pkgJson);
    await writeTar(pad512(pkgJson.length));
    await writeTar(tarHeader("package/data.bin", PAYLOAD_SIZE, "0"));
    for (let written = 0; written < PAYLOAD_SIZE; written += ZERO_CHUNK.length) {
      await writeTar(ZERO_CHUNK);
    }
    await writeTar(Buffer.alloc(1024, 0)); // two zero blocks = end-of-archive
    await new Promise<void>((resolve, reject) => {
      out.once("close", resolve);
      out.once("error", reject);
      gzip.once("error", reject);
      gzip.end();
    });
  }

  // Sanity: the .tgz itself stays tiny, so holding the compressed bytes
  // in memory is negligible relative to PAYLOAD_SIZE.
  expect(statSync(tgzPath).size).toBeLessThan(8 * 1024 * 1024);

  const { stderr, exitCode, resourceUsage } = await runInstall(String(dir));

  expect(stderr).not.toContain("error:");
  const big = statSync(join(String(dir), "node_modules", "oversized-pkg", "data.bin"));
  expect(big.size).toBe(PAYLOAD_SIZE);
  expect(exitCode).toBe(0);

  // The property under test: extraction never held the 256 MiB
  // decompressed tar in memory. With the old pre-decompress path the
  // child's maxRSS was well over 3x PAYLOAD_SIZE (Vec growth
  // reallocations): ~780 MB release, ~1 GB debug+ASAN. Streaming
  // through libarchive it stays at baseline (~40 MB release, ~240 MB
  // debug+ASAN), so the midpoint gives wide margin both ways without
  // needing to branch on build type.
  // `Subprocess.resourceUsage().maxRSS` is normalised to bytes on every
  // platform. The > 1 MiB lower bound guards that unit: any bun process
  // peaks well above 1 MiB in bytes but under 1_048_576 in kB, so a
  // regression to kB trips the lower bound instead of vacuously passing
  // the upper one.
  const maxRssBytes = resourceUsage?.maxRSS ?? 0;
  expect(maxRssBytes).toBeGreaterThan(1024 * 1024);
  expect(maxRssBytes).toBeLessThan(2 * PAYLOAD_SIZE);
});

test("streaming extract skips a damaged header block and extracts the entries after it byte-for-byte while more data is still arriving", async () => {
  const pkgJson = Buffer.from(JSON.stringify({ name: "stream-pkg", version: "1.0.0" }) + "\n");
  const before = Buffer.alloc(4 * 1024 * 1024, 0);
  const after = Buffer.alloc(16 * 1024 * 1024, 0);
  const tail = Buffer.alloc(8 * 1024 * 1024);
  let seed = createHash("sha512").update("tail.bin").digest();
  for (let off = 0; off < tail.length; off += seed.length) {
    seed.copy(tail, off);
    seed = createHash("sha512").update(seed).digest();
  }

  const damaged = Buffer.alloc(512, 0);
  damaged.write("junk", 0, "utf8");
  damaged.fill(" ", 148, 156);

  const damagedEntries: Entry[] = [
    { path: "package.json", body: pkgJson },
    { path: "before.bin", body: before },
    { path: "after.bin", body: after },
    { path: "tail.bin", body: tail },
  ];
  const tar = Buffer.concat([
    ...tarFile("package/package.json", pkgJson),
    ...tarFile("package/before.bin", before),
    damaged,
    ...tarFile("package/after.bin", after),
    ...tarFile("package/tail.bin", tail),
    Buffer.alloc(1024, 0),
  ]);
  const damagedTgz = gzipSync(tar);
  const damagedShasum = createHash("sha1").update(damagedTgz).digest("hex");
  const damagedIntegrity = "sha512-" + createHash("sha512").update(damagedTgz).digest("base64");
  expect(damagedTgz.length).toBeGreaterThan(2 * 1024 * 1024);

  await using reg = await makeRegistry(damagedTgz, damagedShasum, damagedIntegrity, 4096);
  const registry = reg.url;

  using dir = tempDir("streaming-extract-damaged-block", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "stream-pkg": "1.0.0" },
    }),
    "bunfig.toml": Bun.TOML.stringify({ install: { registry } }),
  });

  const { stderr, exitCode } = await runInstall(String(dir));
  expect(stderr).not.toContain("extracting tarball for");
  expect(stderr).not.toContain("error:");
  expect(stderr).toContain("Streamed ");
  expect(reg.tarballHits).toBe(1);

  const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
  for (const { path, body } of damagedEntries) {
    const got = readFileSync(join(pkgRoot, path));
    expect([path, got.length, got.equals(body)]).toEqual([path, body.length, true]);
  }
  expect(exitCode).toBe(0);
});
