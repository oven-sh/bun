import { test, expect } from "bun:test";

test("FFI read functions throw on invalid pointer instead of crashing", () => {
  const read = Bun.FFI.read;
  const types = ["u8", "u16", "u32", "i8", "i16", "i32", "i64", "u64", "f32", "f64", "ptr", "intptr"] as const;

  for (const type of types) {
    // Zero pointer
    expect(() => (read as any)[type](0)).toThrow("Invalid pointer");
    // Small invalid address
    expect(() => (read as any)[type](7)).toThrow("Invalid pointer");
    // Known bad sentinel
    expect(() => (read as any)[type](0xdeadbeef)).toThrow("Invalid pointer");
  }
});
