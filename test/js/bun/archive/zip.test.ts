import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── minimal DEFLATE-entry ZIP writer (independent test fixture) ───────────
// Produces real ZIP bytes with an independent compressor (Bun.deflateSync raw
// streams), so the reader side of Bun.Archive is exercised against a writer
// it did not produce.
//
// NOTE: STORE-method entries (method 0) currently trip a slice-safety panic
// inside the vendored libarchive streaming zip reader; tracked as an
// upstream hardening item (see journal). Fixtures here use method 8.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function buildZip(
  files: Record<string, string | Uint8Array>,
  opts: { utf8Flag?: boolean } = {},
): Promise<Uint8Array> {
  const utf8Flag = opts.utf8Flag ?? true;
  const encoder = new TextEncoder();
  const u16 = (v: number) => Uint8Array.from([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) =>
    Uint8Array.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    total += chunk.length;
  };

  // Regular file, mode 0644 in the high bits (Unix host id 0x03).
  const VERSION_MADE_BY = 0x0314;
  const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

  interface Central {
    nameBytes: Uint8Array;
    crc: number;
    compressedLen: number;
    uncompressedLen: number;
    offset: number;
  }
  const centrals: Central[] = [];

  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const raw = typeof value === "string" ? encoder.encode(value) : value;
    const crc = crc32(raw);
    const compressed = new Uint8Array(Bun.deflateSync(raw, { raw: true }));
    const offset = total;

    push(u32(0x04034b50));
    push(u16(20));
    push(u16(utf8Flag ? 0x0800 : 0));
    push(u16(8)); // method: deflate
    push(u16(0));
    push(u16(0x21));
    push(u32(crc));
    push(u32(compressed.length));
    push(u32(raw.length));
    push(u16(nameBytes.length));
    push(u16(0));
    push(nameBytes);
    push(compressed);

    centrals.push({
      nameBytes,
      crc,
      compressedLen: compressed.length,
      uncompressedLen: raw.length,
      offset,
    });
  }

  const centralStart = total;
  for (const e of centrals) {
    push(u32(0x02014b50));
    push(u16(VERSION_MADE_BY));
    push(u16(20));
    push(u16(utf8Flag ? 0x0800 : 0));
    push(u16(8));
    push(u16(0));
    push(u16(0x21));
    push(u32(e.crc));
    push(u32(e.compressedLen));
    push(u32(e.uncompressedLen));
    push(u16(e.nameBytes.length));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(EXTERNAL_ATTRS));
    push(u32(e.offset));
    push(e.nameBytes);
  }
  const centralSize = total - centralStart;

  push(u32(0x06054b50));
  push(u16(0));
  push(u16(0));
  push(u16(centrals.length));
  push(u16(centrals.length));
  push(u32(centralSize));
  push(u32(centralStart));
  push(u16(0));

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ─── suite ──────────────────────────────────────────────────────────────────

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "bun-archive-zip-"));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("Bun.Archive zip write", () => {
  test("produces bytes starting with the local-file-header signature", async () => {
    await Bun.Archive.write(
      join(workdir, "basic.zip"),
      { "hello.txt": "hello world" },
      { format: "zip" },
    );
    const bytes = readFileSync(join(workdir, "basic.zip"));
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  test("roundtrips text and binary entries through extract()", async () => {
    const payload = new Uint8Array(256);
    for (let i = 0; i < payload.length; i++) payload[i] = i;
    const dest = join(workdir, "roundtrip");
    await Bun.Archive.write(
      join(workdir, "roundtrip.zip"),
      {
        "greeting.txt": "héllo wörld 🦀",
        "nested/deep/binary.bin": payload,
        "empty.txt": "",
      },
      { format: "zip", compress: "deflate", level: 6 },
    );
    await new Bun.Archive(readFileSync(join(workdir, "roundtrip.zip"))).extract(dest);

    expect(readFileSync(join(dest, "greeting.txt"), "utf8")).toBe("héllo wörld 🦀");
    const roundtripped = readFileSync(join(dest, "nested/deep/binary.bin"));
    expect(Buffer.from(roundtripped).equals(Buffer.from(payload))).toBe(true);
    expect(statSync(join(dest, "empty.txt")).size).toBe(0);
  });

  test("level 0 stores entries uncompressed", async () => {
    const repeated = "abcdefgh".repeat(64); // 512 bytes, highly compressible
    await Bun.Archive.write(
      join(workdir, "stored.zip"),
      { "stored.txt": repeated },
      { format: "zip", compress: "deflate", level: 0 },
    );
    const bytes = readFileSync(join(workdir, "stored.zip"));
    // Stored entry: the raw bytes appear verbatim in the file.
    expect(Buffer.from(bytes).includes(Buffer.from(repeated))).toBe(true);

    // Deflated entry at the same content must produce a smaller archive.
    await Bun.Archive.write(
      join(workdir, "deflated.zip"),
      { "stored.txt": repeated },
      { format: "zip", compress: "deflate", level: 9 },
    );
    const deflated = readFileSync(join(workdir, "deflated.zip"));
    expect(deflated.length).toBeLessThan(bytes.length);
  });

  test("rejects deflate compression outside the zip format", () => {
    // Validation happens synchronously before the write task starts.
    expect(() =>
      Bun.Archive.write(
        join(workdir, "bad.zip"),
        { "a.txt": "a" },
        // @ts-expect-error deflate requires format zip
        { compress: "deflate" },
      ),
    ).toThrow(/deflate.*zip/i);
  });

  test("rejects unknown formats and invalid levels", () => {
    expect(() =>
      Bun.Archive.write(
        join(workdir, "nope.rar"),
        { "a.txt": "a" },
        // @ts-expect-error unknown format
        { format: "rar" },
      ),
    ).toThrow(/format/i);

    expect(() =>
      Bun.Archive.write(
        join(workdir, "lvl.zip"),
        { "a.txt": "a" },
        { format: "zip", compress: "deflate", level: 42 },
      ),
    ).toThrow(/level/i);
  });

  test("an empty object produces a valid empty zip", async () => {
    await Bun.Archive.write(join(workdir, "empty.zip"), {}, { format: "zip" });
    const bytes = readFileSync(join(workdir, "empty.zip"));
    // An empty zip is bookkeeping only; scan near the tail for the EOCD
    // signature rather than assuming an exact size.
    let found = false;
    const min = Math.max(0, bytes.length - 512);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe("Bun.Archive zip read", () => {
  test("extracts a deflate zip built by an independent writer", async () => {
    const fixture = await buildZip({
      "readme.md": "# interop",
      "data/numbers.bin": Uint8Array.from([1, 2, 3, 4, 5]),
    });
    const dest = join(workdir, "interop");
    await new Bun.Archive(fixture).extract(dest);

    expect(readFileSync(join(dest, "readme.md"), "utf8")).toBe("# interop");
    expect(Array.from(readFileSync(join(dest, "data/numbers.bin")))).toEqual([1, 2, 3, 4, 5]);
  });

  test("reads non-UTF8-flagged names via cp437-safe ASCII", async () => {
    const fixture = await buildZip({ "plain-name.txt": "ascii path" }, { utf8Flag: false });
    const dest = join(workdir, "cp437");
    await new Bun.Archive(fixture).extract(dest);
    expect(readFileSync(join(dest, "plain-name.txt"), "utf8")).toBe("ascii path");
  });

  test("extract honors glob filtering on zips", async () => {
    const fixture = await buildZip({
      "keep.log": "keep me",
      "skip/secret.txt": "not me",
    });
    const dest = join(workdir, "globbed");
    await new Bun.Archive(fixture).extract(dest, { glob: "**/*.log" });

    expect(existsSync(join(dest, "keep.log"))).toBe(true);
    expect(existsSync(join(dest, "skip/secret.txt"))).toBe(false);
  });

  test("rejects garbage bytes with an error instead of crashing", async () => {
    const garbage = new Uint8Array(1024);
    for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 7) & 0xff;
    await expect(new Bun.Archive(garbage).extract(join(workdir, "garbage-out"))).rejects.toThrow();
  });

  test("rejects a truncated zip instead of crashing", async () => {
    const full = await buildZip({ "a.txt": "aaa" });
    const truncated = full.slice(0, Math.floor(full.length / 2));
    // A half-cut zip may lose the central directory while every local entry
    // already streamed cleanly, so the contract is "settles deterministically
    // — a count or an error — never a crash".
    const outcome = await new Bun.Archive(truncated)
      .extract(join(workdir, "truncated-out"))
      .then(
        count => {
          expect(typeof count).toBe("number");
          return "settled" as const;
        },
        error => {
          expect(error).toBeInstanceOf(Error);
          return "rejected" as const;
        },
      );
    expect(["settled", "rejected"]).toContain(outcome);
  });
});

describe("Bun.Archive tar regression", () => {
  test("tar remains the default format", async () => {
    const dest = join(workdir, "tar-default");
    await Bun.Archive.write(join(workdir, "default.tar"), { "t.txt": "still tar" });
    await new Bun.Archive(readFileSync(join(workdir, "default.tar"))).extract(dest);
    expect(readdirSync(dest)).toEqual(["t.txt"]);
  });
});
