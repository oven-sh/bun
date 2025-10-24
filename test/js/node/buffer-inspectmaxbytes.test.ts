import { expect, test } from "bun:test";
import buffer, { INSPECT_MAX_BYTES } from "node:buffer";

test("buffer.INSPECT_MAX_BYTES is a number and not a custom getter/setter", () => {
  const originalINSPECT_MAX_BYTES = INSPECT_MAX_BYTES;
  expect(INSPECT_MAX_BYTES).toBeNumber();
  expect(buffer.INSPECT_MAX_BYTES).toBeNumber();
  buffer.INSPECT_MAX_BYTES = 1000;
  expect(buffer.INSPECT_MAX_BYTES).toBe(1000);
  expect(INSPECT_MAX_BYTES).toBe(originalINSPECT_MAX_BYTES);
  buffer.INSPECT_MAX_BYTES = originalINSPECT_MAX_BYTES;
  expect(INSPECT_MAX_BYTES).toBe(originalINSPECT_MAX_BYTES);
});
