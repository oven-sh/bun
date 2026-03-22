import { describe, expect, test } from "bun:test";

describe("FFI small pointer rejection", () => {
  test("toArrayBuffer rejects small integer pointers", () => {
    const FFI = Bun.FFI;
    for (const val of [0, 1, 128, 4095]) {
      expect(() => FFI.toArrayBuffer(val)).toThrow();
    }
  });

  test("toBuffer rejects small integer pointers", () => {
    const FFI = Bun.FFI;
    for (const val of [0, 1, 128, 4095]) {
      expect(() => FFI.toBuffer(val)).toThrow();
    }
  });

  test("CString rejects small integer pointers", () => {
    const FFI = Bun.FFI;
    for (const val of [0, 1, 128, 4095]) {
      expect(() => new FFI.CString(val)).toThrow();
    }
  });

  test("byteOffset that moves pointer into low memory is rejected", () => {
    const FFI = Bun.FFI;
    for (const call of [
      () => FFI.toArrayBuffer(65536, -65536),
      () => FFI.toBuffer(65536, -65536),
      () => new FFI.CString(65536, -65536),
    ]) {
      expect(call).toThrow();
    }
  });
});
