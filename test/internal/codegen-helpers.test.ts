/**
 * Unit tests for the internal-module source code generator
 * (src/codegen/helpers.ts::declareZstdCompressedSource).
 *
 * The release binary stores each internal JS module's source as one zstd frame
 * plus a { zstd, zstdSize, rawSize } descriptor, which
 * InternalModuleRegistry.cpp decompresses on the module's first require. These
 * tests lock in the two invariants that path depends on: the descriptor's byte
 * counts are exact, and the decompressed bytes are byte-for-byte equal to the
 * raw ASCIILiteral representation (declareASCIILiteral) that debug builds, and
 * every release build before this, embedded directly.
 */
import { describe, expect, test } from "bun:test";
import { declareASCIILiteral, declareZstdCompressedSource } from "../../src/codegen/helpers.ts";

/** Parse declareZstdCompressedSource's two generated C++ lines back into their components. */
function parseCompressed(cpp: string) {
  const m = cpp.match(
    /^static constexpr const unsigned char (\w+)ZstdBytes\[(\d+)\] = \{([\d,]*)\};\nstatic constexpr CompressedSourceCode \1 \{ \1ZstdBytes, (\d+), (\d+) \};$/,
  );
  if (!m) throw new Error(`declareZstdCompressedSource emitted an unexpected shape:\n${cpp}`);
  const bytes = new Uint8Array(m[3] === "" ? [] : m[3].split(",").map(Number));
  return { name: m[1], arrayLen: Number(m[2]), bytes, zstdSize: Number(m[4]), rawSize: Number(m[5]) };
}

/** Parse declareASCIILiteral's byte array (the raw, uncompressed representation). */
function parseASCIILiteral(cpp: string) {
  const m = cpp.match(/^static constexpr const char \w+Bytes\[(\d+)\] = \{([\d,]*)\};/);
  if (!m) throw new Error(`declareASCIILiteral emitted an unexpected shape:\n${cpp}`);
  return { count: Number(m[1]), bytes: m[2] === "" ? [] : m[2].split(",").map(Number) };
}

describe("declareZstdCompressedSource", () => {
  // A realistic module body plus a long repetitive tail so the compressor has
  // real work to do. Built without String#repeat (slow in debug JSC builds).
  const source =
    "export default function add(a, b) {\n  return a + b;\n}\n// " +
    Buffer.alloc(4096, "padding for the compressor ").toString() +
    "\n";

  test("the descriptor's byte counts are exact and internally consistent", () => {
    const p = parseCompressed(declareZstdCompressedSource("TestModuleCode", source));
    expect(p.name).toBe("TestModuleCode");
    // The C array's declared length, the descriptor's zstdSize, and the actual
    // byte count must all agree: the runtime hands zstdSize to ZSTD_decompress
    // as the frame length.
    expect({ arrayLen: p.arrayLen, zstdSize: p.zstdSize }).toEqual({
      arrayLen: p.bytes.length,
      zstdSize: p.bytes.length,
    });
    // rawSize is the decompressed length: the source plus the trailing newline
    // the module codegen has always appended.
    expect(p.rawSize).toBe(source.length + 1);
  });

  test("the frame decompresses byte-for-byte to the string the raw ASCIILiteral representation carried", () => {
    // The pre-existing representation for the same source: a NUL-terminated
    // char array whose ASCIILiteral length is strlen (everything but the NUL).
    const lit = parseASCIILiteral(declareASCIILiteral("RefCode", source));
    expect(lit.count).toBe(source.length + 1 + 1);
    expect(lit.bytes[lit.bytes.length - 1]).toBe(0);

    const p = parseCompressed(declareZstdCompressedSource("RefCode", source));
    const decompressed = Bun.zstdDecompressSync(p.bytes);
    expect(decompressed.length).toBe(p.rawSize);
    // Byte-for-byte equal to what the ASCIILiteral held (minus its NUL, which a
    // StringImpl does not need). This is the behavior-preserving invariant the
    // release runtime depends on.
    expect(Array.from(decompressed)).toEqual(lit.bytes.slice(0, -1));
  });

  test("a large repetitive source actually compresses and still round-trips", () => {
    const big = Buffer.alloc(80_000, "const value = 1;\nexport { value };\n").toString();
    const p = parseCompressed(declareZstdCompressedSource("BigCode", big));
    expect(p.rawSize).toBe(big.length + 1);
    // If the stored bytes were not a real zstd frame this cannot hold.
    expect(p.zstdSize).toBeLessThan(p.rawSize / 10);
    expect(Buffer.from(Bun.zstdDecompressSync(p.bytes)).toString("latin1")).toBe(big + "\n");
  });

  test("rejects non-ASCII source at codegen time", () => {
    // The runtime decompresses straight into an 8-bit StringImpl and the debug
    // representation is ASCIILiteral, so the codegen must refuse anything
    // outside ASCII rather than silently mis-encode it.
    expect(() => declareZstdCompressedSource("BadCode", 'const s = "caf\u00e9";')).toThrow(
      "bundled internal-module source must be ASCII",
    );
  });
});
