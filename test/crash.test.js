import { test } from "bun:test";

test.skipIf(process.platform != "linux")("crash", () => {
  Bun.FFI.read.u8(123);
});
