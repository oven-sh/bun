import { describe, expect, test } from "bun:test";

describe("FFI read rejects invalid pointers", () => {
  const types = ["u8", "u16", "u32", "i8", "i16", "i32", "i64", "u64", "f32", "f64", "ptr", "intptr"] as const;

  for (const type of types) {
    test(`read.${type} throws on null page address`, () => {
      const read = (Bun.FFI as any).read[type];
      expect(() => read(7)).toThrow();
    });

    test(`read.${type} throws on address 0`, () => {
      const read = (Bun.FFI as any).read[type];
      expect(() => read(0)).toThrow();
    });
  }
});
