import { describe, expect, test } from "bun:test";

// transformSync caches its print buffer on the Transpiler instance and reuses
// it across calls. The printer holds a by-value copy of that BufferWriter, so
// when printing grows the buffer past its capacity the old allocation is
// freed and only the printer's copy sees the new pointer. The cached
// BufferWriter must be refreshed from printer.ctx on every return path;
// previously the error path skipped that step, leaving a freed pointer in the
// cache for the next call. These tests drive the reuse path hard with output
// that forces reallocations so ASAN trips if the cached pointer ever goes
// stale.
describe("Transpiler transformSync buffer reuse", () => {
  test("pooled print buffer survives repeated growth and shrink", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });

    // First call sizes the cached buffer to the input length (1 byte), so the
    // next large call is guaranteed to reallocate inside the printer.
    expect(transpiler.transformSync(";")).toBe("");

    const filler = Buffer.alloc(64 * 1024, "a").toString();
    const big = transpiler.transformSync(`export const s: string = "${filler}";`);
    expect(big).toBe(`export const s = "${filler}";\n`);

    // Shrink back down and grow again several times to churn the pooled
    // buffer. Each iteration reads through whatever pointer was cached by the
    // previous call.
    for (let i = 0; i < 8; i++) {
      expect(transpiler.transformSync("const n: number = 1;")).toBe("const n = 1;\n");
      const grown = transpiler.transformSync(`export const s: string = "${filler}${filler}${i}";`);
      expect(grown).toBe(`export const s = "${filler}${filler}${i}";\n`);
    }
  });

  test("output is correct after many reallocating transformSync calls", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });

    // Prime the cache with a tiny buffer.
    transpiler.transformSync(";");

    // Monotonically growing output so every call reallocates past the
    // previous capacity. Verify the tail of each result so a stale buffer
    // (truncated or garbage bytes) would fail the assertion, not just crash.
    let body = "";
    for (let i = 0; i < 128; i++) {
      body += `export const v${i}: number = ${i};\n`;
      const out = transpiler.transformSync(body);
      expect(out.endsWith(`export const v${i} = ${i};\n`)).toBe(true);
    }
  });
});
