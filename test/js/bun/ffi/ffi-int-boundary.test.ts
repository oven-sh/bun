import { cc } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isASAN, tempDirWithFiles } from "harness";
import path from "path";

// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isASAN)("FFI integer boundary values", () => {
  const source = /* c */ `
    #include <stdint.h>

    // 2147483648 is INT32_MAX + 1 (0x80000000)
    uint32_t returns_uint32_boundary(void) {
      return 2147483648u;
    }

    // INT32_MAX = 2147483647
    uint32_t returns_uint32_max_int32(void) {
      return 2147483647u;
    }

    // UINT32_MAX
    uint32_t returns_uint32_max(void) {
      return 4294967295u;
    }

    // Return value that's exactly at the boundary for int64 fast path
    int64_t returns_int64_boundary_pos(void) {
      return 2147483648ll;
    }

    int64_t returns_int64_boundary_neg(void) {
      return -2147483649ll;
    }

    // Identity functions for round-tripping
    uint32_t identity_u32(uint32_t val) {
      return val;
    }
  `;

  let dir: string;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-int-boundary", {
      "boundary.c": source,
    });
  });

  describe("uint32 boundary at INT32_MAX+1", () => {
    let lib: any;

    beforeAll(() => {
      lib = cc({
        source: path.join(dir, "boundary.c"),
        symbols: {
          returns_uint32_boundary: { args: [], returns: "uint32_t" },
          returns_uint32_max_int32: { args: [], returns: "uint32_t" },
          returns_uint32_max: { args: [], returns: "uint32_t" },
          returns_int64_boundary_pos: { args: [], returns: "i64_fast" },
          returns_int64_boundary_neg: { args: [], returns: "i64_fast" },
          identity_u32: { args: ["uint32_t"], returns: "uint32_t" },
        },
      });
    });

    afterAll(() => {
      lib?.close();
    });

    it("uint32 value 2147483648 should not become negative", () => {
      // This is the core bug: 2147483648 (0x80000000) was being routed through
      // the int32 encoding path, causing sign corruption to -2147483648
      const result = lib.symbols.returns_uint32_boundary();
      expect(result).toBe(2147483648);
      expect(result).toBeGreaterThan(0);
    });

    it("uint32 value 2147483647 (INT32_MAX) should work correctly", () => {
      const result = lib.symbols.returns_uint32_max_int32();
      expect(result).toBe(2147483647);
    });

    it("uint32 value 4294967295 (UINT32_MAX) should work correctly", () => {
      const result = lib.symbols.returns_uint32_max();
      expect(result).toBe(4294967295);
    });

    it("int64_fast value 2147483648 should not become negative", () => {
      // INT64_TO_JSVALUE was casting 2147483648 to int32_t causing UB/sign corruption
      const result = lib.symbols.returns_int64_boundary_pos();
      expect(result).toBe(2147483648);
      expect(result).toBeGreaterThan(0);
    });

    it("int64_fast value -2147483649 should be correctly negative", () => {
      const result = lib.symbols.returns_int64_boundary_neg();
      expect(result).toBe(-2147483649);
      expect(result).toBeLessThan(-2147483648);
    });

    it("round-trip uint32 value 2147483648 through identity function", () => {
      const result = lib.symbols.identity_u32(2147483648);
      expect(result).toBe(2147483648);
      expect(result).toBeGreaterThan(0);
    });
  });
});
