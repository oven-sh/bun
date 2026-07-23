import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";

// Known-answer behavior-preservation tests for the zlib FFI safe-binding
// refactor. Every assertion here must hold on every bun build; any divergence
// is a regression in the z_stream wrapper layer.

describe("zlib safe-binding behavior preservation", () => {
  const text = "The quick brown fox jumps over the lazy dog.\n".repeat(50);
  const data = Buffer.from(text);

  test("Bun.gzipSync/gunzipSync round-trip and known output", () => {
    const gz = Bun.gzipSync(data);
    // gzip magic + CM=8 + FLG=0 (deterministic for this input at default opts)
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    expect(gz[2]).toBe(8);
    expect(Buffer.from(Bun.gunzipSync(gz))).toEqual(data);
    // ISIZE trailer = uncompressed length mod 2^32 (RFC 1952 §2.3.1)
    expect(gz.slice(-4)).toEqual(
      new Uint8Array([
        data.length & 0xff,
        (data.length >> 8) & 0xff,
        (data.length >> 16) & 0xff,
        (data.length >> 24) & 0xff,
      ]),
    );
  });

  test("Bun.deflateSync/inflateSync round-trip (raw deflate)", () => {
    const d = Bun.deflateSync(data);
    expect(Buffer.from(Bun.inflateSync(d))).toEqual(data);
  });

  test("Bun.hash.crc32 matches zlib.crc32", () => {
    expect(Bun.hash.crc32(data)).toBe(zlib.crc32(data));
    expect(Bun.hash.crc32("hello world")).toBe(0x0d4a1185);
    // seeded, chained
    const a = zlib.crc32(data.subarray(0, 100));
    const b = zlib.crc32(data.subarray(100), a);
    expect(b).toBe(zlib.crc32(data));
  });

  test("node:zlib deflate/inflate with dictionary", () => {
    const dict = Buffer.from("quick brown fox jumps over lazy dog");
    const comp = zlib.deflateSync(data, { dictionary: dict });
    const decomp = zlib.inflateSync(comp, { dictionary: dict });
    expect(decomp).toEqual(data);
    // wrong dictionary must fail with Z_NEED_DICT (inflateSetDictionary
    // returns Z_DATA_ERROR on Adler-32 mismatch, remapped to NeedDict)
    expect(() => zlib.inflateSync(comp, { dictionary: Buffer.from("wrong") })).toThrow(
      expect.objectContaining({ code: "Z_NEED_DICT" }),
    );
  });

  test("node:zlib deflateRaw/inflateRaw with dictionary", () => {
    const dict = Buffer.from("quick brown fox jumps over lazy dog");
    const comp = zlib.deflateRawSync(data, { dictionary: dict });
    const decomp = zlib.inflateRawSync(comp, { dictionary: dict });
    expect(decomp).toEqual(data);
  });

  test("node:zlib unzip auto-detects gzip vs zlib wrapper", () => {
    const gz = zlib.gzipSync(data);
    const zl = zlib.deflateSync(data);
    expect(zlib.unzipSync(gz)).toEqual(data);
    expect(zlib.unzipSync(zl)).toEqual(data);
  });

  test("node:zlib unzip handles header split across two write() calls", async () => {
    const gz = zlib.gzipSync(data);
    const out: Buffer[] = [];
    const u = zlib.createUnzip();
    await new Promise<void>((resolve, reject) => {
      u.on("data", c => out.push(c));
      u.on("end", resolve);
      u.on("error", reject);
      // first byte alone (gzip ID1), then the rest (exercises
      // `gzip_id_bytes_read` carried across do_work calls)
      u.write(gz.subarray(0, 1));
      u.write(gz.subarray(1));
      u.end();
    });
    expect(Buffer.concat(out)).toEqual(data);
  });

  test("node:zlib gunzip handles concatenated members with zero padding", () => {
    const a = zlib.gzipSync(Buffer.from("hello "));
    const b = zlib.gzipSync(Buffer.from("world"));
    const cat = Buffer.concat([a, b, Buffer.from([0, 0, 0])]);
    expect(zlib.gunzipSync(cat).toString()).toBe("hello world");
  });

  test("node:zlib Deflate params() mid-stream", async () => {
    const out: Buffer[] = [];
    const d = zlib.createDeflate();
    await new Promise<void>((resolve, reject) => {
      d.on("data", c => out.push(c));
      d.on("end", resolve);
      d.on("error", reject);
      d.write(data.subarray(0, 500));
      d.flush(() => {
        d.params(zlib.constants.Z_BEST_SPEED, zlib.constants.Z_DEFAULT_STRATEGY, () => {
          d.end(data.subarray(500));
        });
      });
    });
    expect(zlib.inflateSync(Buffer.concat(out))).toEqual(data);
  });

  test("node:zlib reset() reuses the stream", () => {
    const d = zlib.createDeflateRaw();
    // @ts-expect-error _handle is internal
    const h = d._handle;
    const out = Buffer.alloc(4096);
    h.writeSync(zlib.constants.Z_FINISH, data, 0, data.length, out, 0, out.length);
    h.reset();
    // after reset, a second full deflate must succeed
    h.writeSync(zlib.constants.Z_FINISH, data, 0, data.length, out, 0, out.length);
    d.close();
  });

  test("node:zlib error message surfaces zlib's msg field", () => {
    try {
      zlib.inflateSync(Buffer.from([0xff, 0xff, 0xff, 0xff]));
      throw new Error("unreachable");
    } catch (e: any) {
      expect(e.code).toBe("Z_DATA_ERROR");
      expect(typeof e.message).toBe("string");
      expect(e.message).toContain("incorrect");
    }
  });
});
