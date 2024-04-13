import { getMachOImageZeroOffset } from "bun:internal-for-testing";
import { test, expect } from "bun:test";

test.if(process.platform === "darwin")("macOS has the assumed image offset", () => {
  // If this fails, then https://bun.report will be incorrect and the stack
  // trace remappings will stop working.
  expect(getMachOImageZeroOffset()).toBe(0x100000000);
});
