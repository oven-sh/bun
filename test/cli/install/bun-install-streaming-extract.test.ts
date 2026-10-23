// Verifies that `bun install` can extract a tarball while it is still
// downloading. A local registry drip-feeds the .tgz body in small
// chunks so the HTTP thread delivers multiple progress callbacks; the
// streaming extractor (TarballStream.zig + the ARCHIVE_RETRY patches in
// vendor/libarchive) must reassemble them into the same on-disk layout
// the buffered extractor would produce.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, readdirSorted, runCommandMaxRSS, tempDir } from "harness";
import { createHash, randomBytes } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { join, relative, sep } from "node:path";
import { createGzip, deflateRawSync, gzipSync } from "node:zlib";

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

function tarHeader(
  name: string,
  size: number,
  type: string,
  mode?: Uint8Array,
  change?: (header: Buffer) => void,
): Buffer {
  const buf = Buffer.alloc(512, 0);
  buf.write(name, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100); // mode
  if (mode) buf.set(mode.subarray(0, 8), 100); // raw 8-byte field, e.g. GNU base-256
  buf.write(octal(0, 8), 108); // uid
  buf.write(octal(0, 8), 116); // gid
  buf.write(octal(size, 12), 124); // size
  buf.write(octal(0, 12), 136); // mtime
  buf.fill(" ", 148, 156); // checksum placeholder
  buf.write(type, 156);
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  change?.(buf); // any other field
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

// Bytes gzip can't collapse away, the same on every run (xorshift32).
function incompressible(bytes: number, seed: number): Buffer {
  const words = new Uint32Array(bytes / 4);
  for (let i = 0, x = seed; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x;
  }
  return Buffer.from(words.buffer);
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
  // Bulk entries. Sized so the compressed tarball exceeds the default
  // BUN_INSTALL_STREAMING_MIN_SIZE (2 MB) — streaming only commits
  // when Content-Length is above that threshold.
  for (let i = 0; i < 48; i++) {
    entries.push({ path: `data/chunk-${i}.bin`, body: incompressible(48 * 1024, i + 1) });
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
  /** The rest of the tarball waits for this after the first write. `isClosed`: bun hung up, nobody reads the rest. */
  afterFirstWrite?: (isClosed: () => boolean) => Promise<void>;
  /** Destroy the tarball connection after this many body bytes... */
  dropTarballAt?: number;
  /** ...for the first N tarball requests (default: every request). */
  dropTarballTimes?: number;
  /** Destroy the first N manifest connections half-way through the body. */
  dropManifestTimes?: number;
  /** The `Content-Encoding` of the tarball response. */
  contentEncoding?: string;
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
      if (faults.contentEncoding) res.setHeader("content-encoding", faults.contentEncoding);
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
        const first = i === 0;
        i += n;
        if (first && faults.afterFirstWrite) {
          let closed = false;
          res.once("close", () => (closed = true));
          void faults.afterFirstWrite(() => closed).then(() => closed || step());
          return;
        }
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

const installCmd = [bunExe(), "install", "--verbose", "--linker=hoisted"];
const installEnv = (cwd: string, extraEnv: Record<string, string> = {}) => ({
  ...bunEnv,
  BUN_INSTALL_CACHE_DIR: join(cwd, ".cache"),
  ...extraEnv,
});

async function runInstall(cwd: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: installCmd,
    cwd,
    env: installEnv(cwd, extraEnv),
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

  // npm writes none of these: it skips a name that has a `..` part behind
  // `package/`, whether or not the name leads out of the package.
  test.concurrent.each([
    ["streaming", {}],
    ["buffered", { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" }],
  ] as const)("entries with a .. part in their name are skipped, as npm skips them (%s)", async (label, env) => {
    const skipped = [
      "../climb-1.txt",
      "../../../climb-3.txt",
      "nested/../../climb-nested.txt",
      "a/b/../../../climb-ab.txt",
      "a/../climb-inside.txt",
    ];
    const built = buildTarball([...entries, ...skipped.map(path => ({ path, body: Buffer.from(`${path}\n`) }))]);
    expect(built.tgz.length).toBeGreaterThan(2 * 1024 * 1024);

    await using reg = await makeRegistry(built.tgz, built.shasum, built.integrity, chunkBytes);
    const registry = reg.url;

    using dir = tempDir("streaming-extract-dotdot", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "stream-pkg": "1.0.0" },
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry } }),
    });
    // Entries are extracted under BUN_TMPDIR and the tree is then renamed into
    // the cache. The temp dir is deeper than the longest `..` chain climbs, so
    // an entry that escapes still lands where the walk below sees it.
    const tmp = join(String(dir), "t1", "t2", "t3", "bun-tmp");
    mkdirSync(tmp, { recursive: true });

    const { stderr, exitCode } = await runInstall(String(dir), { ...env, BUN_TMPDIR: tmp, TMPDIR: tmp });
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain(label === "streaming" ? "] Streamed " : "] Extracted to ");
    expect(reg.tarballHits).toBe(1);

    // Nowhere under `dir`: not in node_modules, the cache or the temp dir, and not above one of them.
    const written = readdirSync(String(dir), { recursive: true, withFileTypes: true })
      .filter(entry => entry.name.startsWith("climb-"))
      .map(entry => relative(String(dir), join(entry.parentPath, entry.name)));
    expect(written).toEqual([]);
    // The entries in front of them are all there.
    const pkgRoot = join(String(dir), "node_modules", "stream-pkg");
    for (const { path, body } of entries) {
      expect([path, readFileSync(join(pkgRoot, path)).equals(body)]).toEqual([path, true]);
    }
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
    expect(readdirSync(join(String(dir), ".cache")).filter(name => name.startsWith("stream-pkg"))).toEqual([]);
    expect(existsSync(join(String(dir), "node_modules", "stream-pkg"))).toBe(false);
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
      /error: Fail extracting tarball for "stream-pkg": [^\n]*(gzip decompression failed|gzip trailer mismatch|[Tt]runcated|[Dd]amaged)[^\n]* \(at byte \d+ of \d+\)/,
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

  // Doesn't use runInstall, because the maxRSS of a process that this test runner spawns directly also includes the
  // runner's own peak (see runCommandMaxRSS).
  const { stderr, exitCode, maxRSS } = await runCommandMaxRSS({
    cmd: installCmd,
    cwd: String(dir),
    env: installEnv(String(dir)),
  });

  expect(stderr).not.toContain("error:");
  const big = statSync(join(String(dir), "node_modules", "oversized-pkg", "data.bin"));
  expect(big.size).toBe(PAYLOAD_SIZE);
  expect(exitCode).toBe(0);

  // The property under test: extraction never held the 256 MiB
  // decompressed tar in memory. With the old pre-decompress path the
  // install's maxRSS was well over 3x PAYLOAD_SIZE (Vec growth
  // reallocations): ~780 MB release, ~1 GB debug+ASAN. Streaming
  // through libarchive it stays at baseline (~40 MB release, ~240 MB
  // debug+ASAN, reported as the spawner's ~320 MB floor), so the
  // midpoint gives wide margin both ways without needing to branch on
  // build type.
  expect(maxRSS).toBeLessThan(2 * PAYLOAD_SIZE);
});

test("streaming extract skips a damaged header block and extracts the entries after it byte-for-byte while more data is still arriving", async () => {
  const pkgJson = Buffer.from(JSON.stringify({ name: "stream-pkg", version: "1.0.0" }) + "\n");
  const before = Buffer.alloc(4 * 1024 * 1024, 0);
  const after = Buffer.alloc(16 * 1024 * 1024, 0);
  const tail = incompressible(8 * 1024 * 1024, 1);

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

// Unlike registry tarballs, a `github:` tarball has its directory entries
// created, with the mode libarchive reports for them. A GNU base-256 mode
// field can set bits far above the twelve mode bits; both extractors must
// drop those instead of aborting on them.
test.concurrent.each([
  ["streaming", {}],
  ["buffered", { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" }],
] as const)("installs a github tarball whose directory mode field exceeds the mode bits (%s)", async (label, env) => {
  // base-256: marker bit in the first byte, then 2^31 | 0o755 big-endian.
  const wideMode = Buffer.from([0x80, 0, 0, 0, 0x80, 0, 0x01, 0xed]);
  const root = "owner-repo-abc1234";
  const index = Buffer.from("module.exports = 'ok';\n");
  // More than one read of the client holds (LIBUS_RECV_BUFFER_LENGTH): a body that is all there at the first read is
  // not streamed.
  const bulk = incompressible(1024 * 1024, 1);
  const tgz = gzipSync(
    Buffer.concat([
      tarHeader(`${root}/`, 0, "5"),
      ...tarFile(`${root}/package.json`, Buffer.from(JSON.stringify({ name: "wide-mode-pkg", version: "1.0.0" }))),
      tarHeader(`${root}/lib/`, 0, "5", wideMode),
      ...tarFile(`${root}/lib/index.js`, index),
      ...tarFile(`${root}/bulk.bin`, bulk),
      Buffer.alloc(1024, 0),
    ]),
  );

  // node:http so the body carries a Content-Length and is still drip-fed.
  const server = createServer((req, res) => {
    if (new URL(req.url!, "http://x").pathname !== "/repos/owner/repo/tarball/abc1234") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "application/gzip");
    res.setHeader("content-length", String(tgz.length));
    req.socket.setNoDelay(true);
    let i = 0;
    const step = () => {
      if (i >= tgz.length) {
        res.end();
        return;
      }
      res.write(tgz.subarray(i, Math.min(i + 4096, tgz.length)));
      i += 4096;
      setImmediate(step);
    };
    step();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    using dir = tempDir("streaming-extract-wide-dir-mode", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "wide-mode-pkg": "github:owner/repo#abc1234" },
      }),
    });

    const { stderr, exitCode } = await runInstall(String(dir), {
      ...env,
      GITHUB_API_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      BUN_INSTALL_STREAMING_MIN_SIZE: "1024",
    });
    expect(stderr).not.toContain("error:");
    if (label === "streaming") {
      expect(stderr).toContain("Streamed ");
    } else {
      expect(stderr).not.toContain("Streamed ");
    }
    const pkgRoot = join(String(dir), "node_modules", "wide-mode-pkg");
    expect(statSync(join(pkgRoot, "lib")).isDirectory()).toBe(true);
    expect(readFileSync(join(pkgRoot, "lib", "index.js")).equals(index)).toBe(true);
    expect(readFileSync(join(pkgRoot, "bulk.bin")).equals(bulk)).toBe(true);
    expect(exitCode).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// -------------------------------------------------------------------
// Buffered extract: the archive is extracted into a temporary directory
// that is renamed into the cache at the end. A failed extraction must
// remove that directory, or each attempt leaves one more behind.
// -------------------------------------------------------------------
describe.concurrent("buffered extract: failed extraction", () => {
  function leftInTmp(tmp: string): string[] {
    return readdirSync(tmp, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  async function runInstallIsolated(root: string) {
    const tmp = join(root, "bun-tmp");
    const cache = join(root, "bun-cache");
    mkdirSync(tmp, { recursive: true });
    mkdirSync(cache, { recursive: true });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: root,
      env: {
        ...bunEnv,
        BUN_TMPDIR: tmp,
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        BUN_INSTALL_CACHE_DIR: cache,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode, tmp };
  }

  test("a header that declares more than the archive holds leaves no temp directory", async () => {
    // The header declares 16 MiB. The archive ends 100 bytes into the body.
    const pj = Buffer.from(JSON.stringify({ name: "pkg", version: "1.0.0" }));
    const body = Buffer.alloc(100, 0x78);
    const tgz = gzipSync(
      Buffer.concat([
        tarHeader("package/package.json", pj.length, "0"),
        pj,
        pad512(pj.length),
        tarHeader("package/big.bin", 16 * 1024 * 1024, "0"),
        body,
        pad512(body.length),
        Buffer.alloc(1024, 0),
      ]),
    );

    using dir = tempDir("tar-size-lie", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { pkg: "file:./pkg.tgz" } }),
    });
    writeFileSync(join(String(dir), "pkg.tgz"), tgz);

    // Twice: a leak would grow by one directory per attempt.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { stderr, exitCode, tmp } = await runInstallIsolated(String(dir));
      expect(stderr).toContain("Fail extracting tarball from pkg");
      expect(leftInTmp(tmp)).toEqual([]);
      expect(exitCode).toBe(1);
    }
    expect(existsSync(join(String(dir), "node_modules", "pkg"))).toBe(false);
  });

  test("a tarball that is not gzip leaves no temp directory", async () => {
    using dir = tempDir("tar-bad-gzip", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { pkg: "file:./pkg.tgz" } }),
    });
    writeFileSync(join(String(dir), "pkg.tgz"), Buffer.from("this is not a gzip stream"));

    const { stderr, exitCode, tmp } = await runInstallIsolated(String(dir));
    expect(stderr).toContain("Fail extracting tarball from pkg");
    expect(leftInTmp(tmp)).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

// -------------------------------------------------------------------
// Sparse members, as `tar --sparse` writes them. Such a member stores
// only its data chunks and a map of where they go; `realSize` is the
// length the map claims for the file. The members are built here by
// hand because CI has no GNU tar on every platform.
//
// npm does not read sparse files, and both extractors do what it does.
// It skips a member of the old format. Of one in the pax format it reads
// the ustar header alone: a file of that name, with all that is stored.
// -------------------------------------------------------------------
type SparseChunk = { offset: number; data: Buffer };
// What npm leaves at `name`, which is either nothing or a file.
type SparseMember = { name: string; file?: Buffer };

function sparseMap(realSize: number, chunks: SparseChunk[]): [number, number][] {
  const map = chunks.map(c => [c.offset, c.data.length] as [number, number]);
  const end = chunks.length ? chunks.at(-1)!.offset + chunks.at(-1)!.data.length : 0;
  // GNU tar closes the map with an empty entry at the real size.
  if (end < realSize) map.push([realSize, 0]);
  return map;
}

// Old GNU format, the `tar --sparse` default: typeflag 'S', magic "ustar  \0",
// four map entries at offset 386, the real size at 483. The size field counts
// the stored bytes only.
function oldGnuSparseMember(name: string, realSize: number, chunks: SparseChunk[]): Buffer[] {
  const map = sparseMap(realSize, chunks);
  if (map.length > 4) throw new Error("the old GNU header holds four sparse entries");
  const body = Buffer.concat(chunks.map(c => c.data));
  const buf = Buffer.alloc(512, 0);
  buf.write(name, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100);
  buf.write(octal(0, 8), 108);
  buf.write(octal(0, 8), 116);
  buf.write(octal(body.length, 12), 124);
  buf.write(octal(0, 12), 136);
  buf.fill(" ", 148, 156);
  buf.write("S", 156);
  buf.write("ustar  \0", 257, "latin1");
  map.forEach(([offset, length], i) => {
    buf.write(octal(offset, 12), 386 + i * 24);
    buf.write(octal(length, 12), 398 + i * 24);
  });
  buf.write(octal(realSize, 12), 483);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(octal(sum, 8), 148);
  return [buf, body, pad512(body.length)];
}

// PAX format 1.0, what `tar --sparse --format=posix` writes: an 'x' header
// carries the name and the real size, and the data area starts with the map as
// decimal lines, NUL-padded to a block, followed by the chunks.
function paxSparseMember(name: string, realSize: number, chunks: SparseChunk[]): Buffer[] {
  const record = (key: string, value: string | number) => {
    let len = 0;
    let rec: string;
    do {
      rec = `${len} ${key}=${value}\n`;
      len = Buffer.byteLength(rec);
    } while (rec !== `${len} ${key}=${value}\n`);
    return rec;
  };
  const pax = Buffer.from(
    record("GNU.sparse.major", 1) +
      record("GNU.sparse.minor", 0) +
      record("GNU.sparse.name", name) +
      record("GNU.sparse.realsize", realSize),
  );
  const map = sparseMap(realSize, chunks);
  const mapText = Buffer.from(`${map.length}\n` + map.map(([offset, length]) => `${offset}\n${length}\n`).join(""));
  const body = Buffer.concat([mapText, pad512(mapText.length), ...chunks.map(c => c.data)]);
  const slash = name.lastIndexOf("/");
  return [
    tarHeader("PaxHeaders.0/sparse", pax.length, "x"),
    pax,
    pad512(pax.length),
    tarHeader(`${name.slice(0, slash)}/GNUSparseFile.0/${name.slice(slash + 1)}`, body.length, "0"),
    body,
    pad512(body.length),
  ];
}

// Builds a package of sparse members, with both formats, each given size and each layout.
function sparsePackage(sizes: number[]) {
  const layouts = (size: number): Record<string, SparseChunk[]> => {
    const lastBlock = Math.floor((size - 1) / 512) * 512;
    return {
      "data-hole": [{ offset: 0, data: Buffer.alloc(512, 0x41) }],
      "hole-data": [{ offset: lastBlock, data: Buffer.alloc(size - lastBlock, 0x42) }],
      "data-hole-data-hole": [
        { offset: 0, data: Buffer.alloc(512, 0x43) },
        { offset: Math.floor(size / 2 / 512) * 512, data: Buffer.alloc(1024, 0x44) },
      ],
      "data-hole-data": [
        { offset: 0, data: Buffer.alloc(512, 0x45) },
        { offset: lastBlock, data: Buffer.alloc(size - lastBlock, 0x46) },
      ],
      "hole": [],
    };
  };
  const pkgJson = Buffer.from(JSON.stringify({ name: "sparse-pkg", version: "1.0.0" }));
  const blocks: Buffer[] = [tarHeader("package/package.json", pkgJson.length, "0"), pkgJson, pad512(pkgJson.length)];
  const members: SparseMember[] = [];
  for (const [format, build] of [
    ["gnu", oldGnuSparseMember],
    ["pax", paxSparseMember],
  ] as const) {
    for (const size of sizes) {
      for (const [layout, chunks] of Object.entries(layouts(size))) {
        const name = `${format}-${layout}-${size}.bin`;
        const built = build(`package/${name}`, size, chunks);
        blocks.push(...built);
        members.push({ name });
        if (format === "pax") members.push({ name: `GNUSparseFile.0/${name}`, file: built[4] });
      }
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(blocks);

  // The gzip stream starts with a stored block that ends inside the data of
  // package.json. A body that is split after `firstPiece` bytes then gives
  // the streaming extractor a piece that ends there, and every sparse member
  // in the other piece: that extractor cannot resume a read that stops inside
  // a sparse map.
  const cut = 512 + 16;
  const stored = Buffer.alloc(5);
  stored.writeUInt16LE(cut, 1);
  stored.writeUInt16LE(~cut & 0xffff, 3);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(Bun.hash.crc32(tar), 0);
  trailer.writeUInt32LE(tar.length, 4);
  const head = Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]), stored, tar.subarray(0, cut)]);
  const tgz = Buffer.concat([head, deflateRawSync(tar.subarray(cut)), trailer]);
  return {
    tgz,
    firstPiece: head.length,
    members,
    integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
  };
}

// Returns the members of which something else is left. The length is compared
// first, so that a file as long as its map claims is never read.
function wrongSparseMembers(root: string, members: SparseMember[]) {
  const wrong: { name: string; length?: number }[] = [];
  for (const { name, file } of members) {
    const length = statSync(join(root, name), { throwIfNoEntry: false })?.size;
    if (length !== file?.length || (file && !readFileSync(join(root, name)).equals(file))) wrong.push({ name, length });
  }
  return wrong;
}

describe.concurrent("sparse tar members", () => {
  // The members of the second size claim 4 GiB each and store 1.5 KB at most.
  const pkg = sparsePackage([300_000, 2 ** 32]);

  test("buffered extract writes the same files as npm for each member", async () => {
    using dir = tempDir("sparse-buffered", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "sparse-pkg": "file:./pkg.tgz" },
      }),
    });
    writeFileSync(join(String(dir), "pkg.tgz"), pkg.tgz);

    const { stderr, exitCode } = await runInstall(String(dir));
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("Streamed ");

    expect(wrongSparseMembers(join(String(dir), "node_modules", "sparse-pkg"), pkg.members)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("streaming extract writes the same files as npm for each member", async () => {
    const { tgz, firstPiece, members, integrity } = pkg;

    using dir = tempDir("sparse-streamed", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "sparse-pkg": "1.0.0" } }),
    });
    const tmp = join(String(dir), "bun-tmp");
    const cache = join(String(dir), "bun-cache");
    mkdirSync(tmp);
    mkdirSync(cache);
    let exited = false;

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/sparse-pkg") {
          return Response.json({
            name: "sparse-pkg",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "sparse-pkg",
                version: "1.0.0",
                dist: { integrity, tarball: `${server.url}sparse-pkg/-/sparse-pkg-1.0.0.tgz` },
              },
            },
          });
        }
        if (url.pathname.endsWith("/sparse-pkg-1.0.0.tgz")) {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(c) {
                c.write(tgz.subarray(0, firstPiece));
                await c.flush();
                // The streaming extractor takes the tarball only when the body
                // arrives in more than one piece. Its first drain creates the
                // extraction directory, so the rest waits until that exists.
                while (!exited && !readdirSync(tmp).some(name => name.endsWith(".sparse-pkg"))) await Bun.sleep(5);
                c.write(tgz.subarray(firstPiece));
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
    writeFileSync(join(String(dir), "bunfig.toml"), Bun.TOML.stringify({ install: { registry: String(server.url) } }));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--verbose", "--linker=hoisted"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_TMPDIR: tmp,
        TMPDIR: tmp,
        BUN_INSTALL_CACHE_DIR: cache,
        // Drain on the first piece, so that the extraction directory appears.
        BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1",
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    void proc.exited.then(() => (exited = true));
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Streamed ");

    expect(wrongSparseMembers(join(String(dir), "node_modules", "sparse-pkg"), members)).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

// -------------------------------------------------------------------
// A full disk, a quota or a file size limit refuses a write in the
// middle of a file. The write loop then went on with `write()` at the
// start of the file: the install exited 0 with a file that was cut and
// whose first bytes were those of the refused block, and that package
// stayed in the cache for every later install.
// -------------------------------------------------------------------
test.skipIf(isWindows)("streaming extract fails the install when the file system refuses a write", async () => {
  // 6,000,000 bytes where no file can grow past 4 MiB. Random bytes keep the
  // tarball above the size from which a registry tarball is streamed.
  const big = randomBytes(6_000_000);
  const pkgJson = Buffer.from(JSON.stringify({ name: "pk", version: "1.0.0" }));
  const tgz = gzipSync(
    Buffer.concat([
      tarHeader("package/package.json", pkgJson.length, "0"),
      pkgJson,
      pad512(pkgJson.length),
      tarHeader("package/big.bin", big.length, "0"),
      big,
      pad512(big.length),
      Buffer.alloc(1024, 0),
    ]),
  );
  const integrity = "sha512-" + createHash("sha512").update(tgz).digest("base64");

  using dir = tempDir("refused-write-streamed", {
    "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { pk: "1.0.0" } }),
  });
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/pk") {
        return Response.json({
          name: "pk",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": { name: "pk", version: "1.0.0", dist: { integrity, tarball: `${server.url}pk/-/pk-1.0.0.tgz` } },
          },
        });
      }
      if (url.pathname.endsWith("/pk-1.0.0.tgz")) return new Response(tgz);
      return new Response("not found", { status: 404 });
    },
  });
  writeFileSync(join(String(dir), "bunfig.toml"), Bun.TOML.stringify({ install: { registry: String(server.url) } }));
  const tmp = join(String(dir), "bun-tmp");
  mkdirSync(tmp);
  const env = { ...bunEnv, BUN_TMPDIR: tmp, TMPDIR: tmp, BUN_INSTALL_CACHE_DIR: join(String(dir), "bun-cache") };
  const installed = join(String(dir), "node_modules", "pk", "big.bin");

  {
    await using proc = Bun.spawn({
      // 8192 blocks of 512 bytes; the sh of macOS (bash 3.2) counts blocks of 1024.
      // A write past the limit raises SIGXFSZ, which must not end the child.
      // Without the limit the child must not run.
      cmd: [
        "sh",
        "-c",
        `trap '' XFSZ; ulimit -f ${isMacOS ? 4096 : 8192} && exec "$@"`,
        "sh",
        bunExe(),
        "install",
        "--linker=hoisted",
      ],
      cwd: String(dir),
      env,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('EFBIG extracting tarball for "pk"');
    expect(existsSync(installed)).toBe(false);
    expect(exitCode).toBe(1);
  }

  // Without the limit, the same cache gives the whole file: the failed install
  // left no package there.
  rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });
  rmSync(join(String(dir), "bun.lock"), { force: true });
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--verbose", "--linker=hoisted"],
      cwd: String(dir),
      env,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Streamed ");
    expect(readFileSync(installed).equals(big)).toBe(true);
    expect(exitCode).toBe(0);
  }
});

// The path, with `/`, and the content of every file below `root`.
function readFiles(root: string): Record<string, string> {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
  const paths = entries.map(entry => join(entry.parentPath, entry.name));
  return Object.fromEntries(paths.map(path => [relative(root, path).replaceAll(sep, "/"), readFileSync(path, "utf8")]));
}

// Installs `tgz` as `stream-pkg`, `installs` times with one cache, and returns what each install left.
// "libdeflate" and "libarchive": a `file:` tarball, which the buffered extractor decompresses that way.
// "buffered" and "streaming": downloaded, from the registry or as a URL dependency, and extracted that way.
// `files`: also what `readFiles` finds in the installed package.
// `gzipEncoded`: the server compresses `tgz` and says so with `Content-Encoding: gzip`.
type ExtractPath = "libdeflate" | "libarchive" | "buffered" | "streaming";
async function installStreamPkg(
  path: ExtractPath,
  tgz: Buffer,
  { installs = 1, url = false, trusted = false, files = false, gzipEncoded = false } = {},
) {
  const sha = (algorithm: string, encoding: "hex" | "base64") => createHash(algorithm).update(tgz).digest(encoding);
  // A tarball is streamed only if its body arrives in more than one piece. The first
  // drain creates the extraction directory, so the rest waits until that exists.
  // An install that fails may remove it again, or hang up, before this looks.
  let tmp = "";
  const waits: Promise<void>[] = [];
  const afterFirstWrite = (isClosed: () => boolean) => {
    const wait = (async () => {
      while (!isClosed() && !readdirSync(tmp).some(name => name.endsWith(".stream-pkg"))) await Bun.sleep(1);
    })();
    waits.push(wait);
    return wait;
  };
  // The integrity is that of the bytes as they are: it holds.
  await using reg = await makeRegistry(
    // Stored blocks: a small body still takes more than one write.
    gzipEncoded ? gzipSync(tgz, { level: 0 }) : tgz,
    sha("sha1", "hex"),
    `sha512-${sha("sha512", "base64")}`,
    512,
    { ...(path === "streaming" ? { afterFirstWrite } : {}), contentEncoding: gzipEncoded ? "gzip" : undefined },
  );
  const downloaded = path === "buffered" || path === "streaming";
  using dir = tempDir("install-stream-pkg", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "stream-pkg": !downloaded ? "file:./pkg.tgz" : url ? `${reg.url}stream-pkg/-/stream-pkg-1.0.0.tgz` : "1.0.0",
      },
      trustedDependencies: trusted ? ["stream-pkg"] : undefined,
    }),
    "bunfig.toml": Bun.TOML.stringify({ install: { registry: reg.url } }),
    "pkg.tgz": tgz,
    "tmp/.keep": "",
  });
  tmp = join(String(dir), "tmp");
  const results = [];
  for (let i = 0; i < installs; i++) {
    const { stderr, exitCode } = await runInstall(String(dir), {
      BUN_TMPDIR: tmp,
      BUN_INSTALL_STREAMING_MIN_SIZE: "1",
      BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1",
      ...(path === "libarchive" ? { BUN_FEATURE_FLAG_NO_LIBDEFLATE: "1" } : {}),
      ...(path === "buffered" ? { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" } : {}),
    });
    results.push({
      // What another thread writes to the verbose log can come anywhere in this line.
      error: stderr.replace(/\[stream-pkg\] Extract .*\n(libarchive error: .*\n)?/g, "").match(/^error: .*$/m)?.[0],
      streamed: stderr.includes("Streamed "),
      installed: existsSync(join(String(dir), "node_modules", "stream-pkg")),
      cached: readdirSync(join(String(dir), ".cache")).filter(name => /^(stream-pkg@|@T@)/.test(name)).length,
      tmp: readdirSync(tmp),
      exitCode,
      ...(files ? { files: readFiles(join(String(dir), "node_modules", "stream-pkg")) } : {}),
    });
  }
  // They read `tmp`, which is deleted together with `dir`.
  await Promise.all(waits);
  return results;
}

// -------------------------------------------------------------------
// A gzip member ends with the CRC32 and the length (ISIZE) of its data.
// Where no integrity is recorded (a `file:` or URL tarball on its first
// install, a registry without `dist.integrity`, `--no-verify`) that
// trailer is the only thing that catches a damaged tarball. All three
// ways to decompress one must check it: libdeflate in memory and
// libarchive's gzip filter in the buffered extractor, and that filter
// again in the streaming extractor.
// -------------------------------------------------------------------
describe.concurrent("gzip trailer", () => {
  const files = (body: Buffer) =>
    Buffer.concat([
      ...tarFile("package/package.json", Buffer.from(JSON.stringify({ name: "stream-pkg", version: "1.0.0" }))),
      ...tarFile("package/index.js", body),
      Buffer.alloc(1024, 0),
    ]);
  // Stored blocks: a changed byte leaves the deflate stream valid.
  const good = gzipSync(files(Buffer.from(`module.exports = "GOOD";\n`)), { level: 0 });
  const changed = (tgz: Buffer, at: number, change: (copy: Buffer, at: number) => void = (b, i) => (b[i] ^= 0x04)) => {
    expect(at).toBeGreaterThan(0);
    const copy = Buffer.from(tgz);
    change(copy, at);
    return copy;
  };
  // Ends on the boundary of the filter's 64 KiB output block. The tar reader has
  // all it needs then, and must still read on to the end of the gzip member.
  const alignedTar = files(Buffer.alloc(2 * 65536 - 3 * 512 - 1024, "x"));
  expect(alignedTar.length).toBe(2 * 65536);
  const aligned = gzipSync(alignedTar, { level: 0 });
  // One tar in two gzip members.
  const goodTar = files(Buffer.from(`module.exports = "GOOD";\n`));
  const member1 = gzipSync(goodTar.subarray(0, 1024), { level: 0 });
  const member2 = gzipSync(goodTar.subarray(1024), { level: 0 });

  const damaged: [string, Buffer][] = [
    ["a changed byte in a file", changed(good, good.indexOf("GOOD"))],
    ["a changed byte in a tar header", changed(good, good.indexOf("package/index.js"))],
    [
      "a changed byte in a tar that ends on a block of the filter",
      changed(aligned, aligned.indexOf("xxxxxxxx") + 1000),
    ],
    ["a wrong CRC32", changed(good, good.length - 8)],
    ["a wrong CRC32 in the second member", Buffer.concat([member1, changed(member2, member2.length - 8)])],
    // Too long for the attempt in memory.
    ["a wrong ISIZE", changed(good, good.length - 4, (b, i) => b.writeUInt32LE(100 * 1024 * 1024, i))],
  ];
  const paths = ["libdeflate", "libarchive", "streaming"] as const;
  const install = async (path: (typeof paths)[number], tgz: Buffer) => (await installStreamPkg(path, tgz))[0];

  test.each(paths)("a valid tarball installs (%s)", async path => {
    expect(await install(path, good)).toEqual({
      error: undefined,
      streamed: path === "streaming",
      installed: true,
      cached: 1,
      tmp: [".keep"],
      exitCode: 0,
    });
  });

  test.each(damaged.flatMap(([what, tgz]) => paths.map(path => [what, path, tgz] as const)))(
    "%s fails the install (%s)",
    async (_, path, tgz) => {
      expect(await install(path, tgz)).toEqual({
        error:
          path === "streaming"
            ? // libarchive's tar reader overwrites the message of the filter that failed.
              expect.stringMatching(
                /^error: Fail extracting tarball for "stream-pkg": (gzip trailer mismatch|Truncated tar archive)/,
              )
            : "error: Fail extracting tarball from stream-pkg",
        streamed: false,
        installed: false,
        cached: 0,
        tmp: [".keep"],
        exitCode: 1,
      });
    },
  );

  // A gzip file is one or more members. Every path reads them all, and ignores other bytes after the last.
  const continued: [string, Buffer][] = [
    ["a second member", Buffer.concat([member1, member2])],
    ["an empty member", Buffer.concat([good, gzipSync(Buffer.alloc(0))])],
    ["zero bytes", Buffer.concat([good, Buffer.alloc(512, 0)])],
    ["bytes that are not gzip", Buffer.concat([good, Buffer.from("not gzip\n")])],
  ];
  test.each(continued.flatMap(([what, tgz]) => paths.map(path => [what, path, tgz] as const)))(
    "a tarball with %s after the first installs whole (%s)",
    async (_, path, tgz) => {
      expect((await installStreamPkg(path, tgz, { files: true }))[0]).toEqual({
        error: undefined,
        streamed: path === "streaming",
        installed: true,
        cached: 1,
        tmp: [".keep"],
        exitCode: 0,
        files: expect.objectContaining({
          "package.json": JSON.stringify({ name: "stream-pkg", version: "1.0.0" }),
          "index.js": `module.exports = "GOOD";\n`,
        }),
      });
    },
  );

  // A server may send a plain tar: the package is one, or it is a .tgz labelled
  // `Content-Encoding: gzip`, which the HTTP client undoes. The hash is then that of the tar.
  const allPaths = [...paths, "buffered"] as const;
  const plain = goodTar;
  test.each([...allPaths.map(path => [path, false] as const), ["buffered", true], ["streaming", true]] as const)(
    "a tarball that is not compressed installs (%s, Content-Encoding: gzip = %p)",
    async (path, gzipEncoded) => {
      expect((await installStreamPkg(path, plain, { gzipEncoded, files: true }))[0]).toEqual({
        error: undefined,
        streamed: path === "streaming",
        installed: true,
        cached: 1,
        tmp: [".keep"],
        exitCode: 0,
        files: expect.objectContaining({
          "package.json": JSON.stringify({ name: "stream-pkg", version: "1.0.0" }),
          "index.js": `module.exports = "GOOD";\n`,
        }),
      });
    },
  );

  // One byte does not tell gzip from tar.
  test.each([
    ["gzip", good],
    ["plain tar", plain],
  ] as const)("a body whose first byte arrives alone installs (streaming, %s)", async (_, body) => {
    await using reg = await makeRegistry(
      body,
      createHash("sha1").update(body).digest("hex"),
      `sha512-${createHash("sha512").update(body).digest("base64")}`,
      512,
      {
        chunker: offset => (offset === 0 ? 1 : 512),
        // Shapes the input: the first drain has run by the time the second byte is sent.
        delayMs: offset => (offset === 1 ? 100 : 0),
      },
    );
    using dir = tempDir("first-byte-alone", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "stream-pkg": "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: reg.url } }),
    });
    const { stderr, exitCode } = await runInstall(String(dir), {
      BUN_INSTALL_STREAMING_MIN_SIZE: "1",
      BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1",
    });
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Streamed ");
    expect(readFiles(join(String(dir), "node_modules", "stream-pkg"))["index.js"]).toBe(`module.exports = "GOOD";\n`);
    expect(exitCode).toBe(0);
  });

  // The tar reader skips each block as damaged: an archive without entries, which was
  // published as an empty package.
  test("a body that is not an archive fails the install (streaming)", async () => {
    expect(await install("streaming", Buffer.alloc(4096, "this is not a gzip stream\n"))).toEqual({
      error: expect.stringContaining('error: Fail extracting tarball for "stream-pkg": archive is empty'),
      streamed: false,
      installed: false,
      cached: 0,
      tmp: [".keep"],
      exitCode: 1,
    });
  });
});

// -------------------------------------------------------------------
// bun reads the package.json of a tarball dependency, and of a registry
// package that may run scripts, as soon as it is extracted. One that
// fails the install there was already in the cache by then, where the
// next install found it and linked it.
// -------------------------------------------------------------------
describe.concurrent("a package whose package.json fails the install is not published to the cache", () => {
  const tarball = (packageJson?: string) =>
    gzipSync(
      Buffer.concat([
        ...(packageJson === undefined ? [] : tarFile("package/package.json", Buffer.from(packageJson))),
        ...tarFile("package/index.js", Buffer.from("module.exports = 1;\n")),
        Buffer.alloc(1024, 0),
      ]),
    );
  const broken = [
    [
      "not JSON",
      tarball("{ not json"),
      'error: expected "package.json" of "stream-pkg" to be a JSON file: ParserError: Expected string but found "not"',
    ],
    ["missing", tarball(), 'error: "package.json" for "stream-pkg" failed to open: ENOENT'],
  ] as const;
  const ways = [
    ["file: tarball", "libdeflate", {}],
    ["URL tarball, buffered", "buffered", { url: true }],
    ["URL tarball, streaming", "streaming", { url: true }],
    ["trusted registry package, buffered", "buffered", { trusted: true }],
    ["trusted registry package, streaming", "streaming", { trusted: true }],
  ] as const;

  const cases = broken.flatMap(([what, tgz, error]) =>
    ways.map(([way, path, opts]) => [what, way, tgz, error, path, opts] as const),
  );

  test.each(cases)("%s (%s)", async (_what, _way, tgz, error, path, opts) => {
    const failed = { error, streamed: false, installed: false, cached: 0, tmp: [".keep"], exitCode: 1 };
    expect(await installStreamPkg(path, tgz, { ...opts, installs: 2 })).toEqual([failed, failed]);
  });
});

// -------------------------------------------------------------------
// A tarball gives the files that npm gives for it. Tar readers differ in
// what they take for a file, for its name and for the end of the
// archive. What each case expects is what npm's reader does.
// -------------------------------------------------------------------
describe.concurrent("entries that npm skips or names differently", () => {
  const packageJson = JSON.stringify({ name: "stream-pkg", version: "1.0.0" });
  const second = Buffer.from("second");
  // Stored, so that the body is long enough to arrive in more than one piece.
  const tarball = (...last: Buffer[]) =>
    gzipSync(
      Buffer.concat([
        ...tarFile("package/package.json", Buffer.from(packageJson)),
        ...tarFile("package/lib/index.js", Buffer.from("first")),
        ...last,
        Buffer.alloc(1024, 0),
      ]),
      { level: 0 },
    );
  const index = "package/lib/index.js";
  const entry = (name: string, body: Buffer, type: string, change?: (header: Buffer) => void) => [
    tarHeader(name, body.length, type, undefined, change),
    body,
    pad512(body.length),
  ];
  const target = (header: Buffer) => void header.write("package/package.json", 157);
  const pax = (key: string, value: string) => {
    let length = 0;
    let record: string;
    do {
      record = `${length} ${key}=${value}\n`;
      length = Buffer.byteLength(record);
    } while (record !== `${length} ${key}=${value}\n`);
    return entry("PaxHeader", Buffer.from(record), "x");
  };
  const other = tarFile("package/other.js", second);
  const again = Buffer.concat(tarFile(index, second));
  const cases: [string, Buffer, Record<string, string>][] = [
    ["a `..` part in the name", tarball(...tarFile("package/lib/x/../index.js", second)), {}],
    ["a `..` part between backslashes", tarball(...tarFile("package/lib\\..\\lib\\index.js", second)), {}],
    ["a hard link with a body", tarball(...entry(index, second, "1", target)), {}],
    [
      "a hard link with a body, behind a pax header",
      tarball(...pax("mtime", "1"), ...entry(index, second, "1", target)),
      {},
    ],
    ["a type that npm does not know", tarball(...entry(index, second, "Z")), {}],
    ["a sparse file of the old format", tarball(...entry(index, second, "S")), {}],
    ["a contiguous file", tarball(...entry(index, second, "7")), { "lib/index.js": "second" }],
    [
      "a contiguous file with a trailing slash",
      tarball(...entry(`${index}/`, second, "7")),
      { "lib/index.js": "second" },
    ],
    ["a type that npm does not know, with a trailing slash", tarball(...entry("package/x/", again, "9")), {}],
    [
      "a file with a trailing slash behind a pax header that gets a warning",
      tarball(...pax("hdrcharset", "unknown"), ...entry("package/x/", again, "0")),
      { "lib/index.js": "second" },
    ],
    // Go's archive/tar leaves the field for the target empty when the target has no ASCII character.
    ...["1", "2"].map((type): [string, Buffer, Record<string, string>] => [
      `a link of type ${type} whose target is only in the pax header`,
      tarball(...pax("linkpath", "日本"), ...entry("package/link", Buffer.alloc(0), type), ...other),
      { "other.js": "second" },
    ]),
    ["a NUL in the path of a pax header", tarball(...pax("path", `${index}\0.js`), ...other), {}],
    [
      "the name of a sparse file in a pax header",
      tarball(...pax("GNU.sparse.name", index), ...other),
      { "other.js": "second" },
    ],
    ["a header for a long name at the end", tarball(...entry("name", Buffer.from(`${index}\0`), "L")), {}],
    [
      "a prefix in a header of another ustar version",
      tarball(
        ...entry("index.js", second, "0", header => void (header.write("01", 263), header.write("package/lib", 345))),
      ),
      {},
    ],
    ["one zero block in front of an entry", tarball(Buffer.alloc(512, 0), again), { "lib/index.js": "second" }],
    ["two zero blocks in front of an entry", tarball(Buffer.alloc(1024, 0), again), {}],
    ["two zero blocks in front of less than a block", tarball(Buffer.alloc(1024, 0), second), {}],
    ["a leading slash", tarball(...tarFile("/package/lib/index.js", second)), { "package/lib/index.js": "second" }],
    [
      "dots that are not a `..` part",
      tarball(...tarFile("package/..a/[...b]..js", second)),
      { "..a/[...b]..js": "second" },
    ],
  ];
  if (!isWindows) {
    cases.push([
      "a backslash in the name",
      tarball(...tarFile("package/lib\\index.js", second)),
      { "lib\\index.js": "second" },
    ]);
  }
  const paths = ["buffered", "streaming"] as const;

  test.each(cases.flatMap(([what, tgz, more]) => paths.map(path => [what, path, tgz, more] as const)))(
    "%s (%s)",
    async (_, path, tgz, more) => {
      expect(await installStreamPkg(path, tgz, { files: true })).toEqual([
        {
          error: undefined,
          streamed: path === "streaming",
          installed: true,
          cached: 1,
          tmp: [".keep"],
          exitCode: 0,
          files: { "package.json": packageJson, "lib/index.js": "first", ...more },
        },
      ]);
    },
  );

  // Two cases that do not follow npm, which loses files of archives that real tar writers make.
  // Old writers repeat the size of the file in the header of a hard link. npm takes what follows for its body.
  test.each(paths)("the entries after a hard link whose header has a size are extracted (%s)", async path => {
    const tgz = tarball(tarHeader("package/link", 5000, "1", undefined, target), ...other);
    expect((await installStreamPkg(path, tgz, { files: true }))[0]).toMatchObject({
      files: { "package.json": packageJson, "lib/index.js": "first", "other.js": "second" },
      exitCode: 0,
    });
  });

  // npm writes the file that such a link points to under the link's name.
  test.each(paths)(
    "the file that a link points to keeps its name if the link's name and target are only in the pax header (%s)",
    async path => {
      const records = Buffer.concat([pax("path", "package/日")[1], pax("linkpath", "本")[1]]);
      const tgz = tarball(...entry("PaxHeader", records, "x"), ...entry("package/", Buffer.alloc(0), "2"), ...other);
      expect((await installStreamPkg(path, tgz, { files: true }))[0]).toMatchObject({
        files: { "package.json": packageJson, "lib/index.js": "first", "other.js": "second" },
        exitCode: 0,
      });
    },
  );
});
