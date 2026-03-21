import { describe, expect, test } from "bun:test";

describe("FFI toBuffer/toArrayBuffer with low pointer addresses", () => {
  test("toBuffer rejects addresses in the zero page", () => {
    const { toBuffer } = Bun.FFI;
    expect(() => toBuffer(0)).toThrow();
    expect(() => toBuffer(1)).toThrow();
    expect(() => toBuffer(64)).toThrow();
    expect(() => toBuffer(4095)).toThrow();
  });

  test("toArrayBuffer rejects addresses in the zero page", () => {
    const { toArrayBuffer } = Bun.FFI;
    expect(() => toArrayBuffer(0)).toThrow();
    expect(() => toArrayBuffer(1)).toThrow();
    expect(() => toArrayBuffer(64)).toThrow();
    expect(() => toArrayBuffer(4095)).toThrow();
  });
});
