import { test } from "bun:test";

test("crash", () => {
  Bun.FFI.read.u8(123);
});
