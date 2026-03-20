import { expect, test } from "bun:test";

const types = ["u8", "u16", "u32", "i8", "i16", "i32", "i64", "u64", "f32", "f64", "ptr", "intptr"] as const;

test("FFI read functions throw on invalid pointer instead of crashing", () => {
  const read = Bun.FFI.read;

  for (const type of types) {
    // Zero pointer
    expect(() => (read as any)[type](0)).toThrow("Invalid pointer");
    // Small invalid address
    expect(() => (read as any)[type](7)).toThrow("Invalid pointer");
    // Known bad sentinel
    expect(() => (read as any)[type](0xdeadbeef)).toThrow("Invalid pointer");
  }
});

test("FFI read functions handle negative offsets correctly", () => {
  const read = Bun.FFI.read;

  for (const type of types) {
    // Negative offset that would result in invalid address
    expect(() => (read as any)[type](100, -200)).toThrow("Invalid pointer");
  }
});
