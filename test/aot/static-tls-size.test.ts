import { expect, test } from "bun:test";
import { isASAN, isLinux } from "harness";
import { readFileSync } from "node:fs";

// AddressSanitizer adds thread-local state of its own.
test.skipIf(!isLinux || isASAN)("the static TLS block that every thread pays for stays small", () => {
  const file = readFileSync(process.execPath);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  expect(file.subarray(0, 4)).toEqual(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const programHeaderOffset = Number(view.getBigUint64(32, true));
  const programHeaderSize = view.getUint16(54, true);
  const programHeaderCount = view.getUint16(56, true);
  let staticTLSSize = 0;
  for (let i = 0; i < programHeaderCount; i++) {
    const header = programHeaderOffset + i * programHeaderSize;
    if (view.getUint32(header, true) === 7) staticTLSSize = Number(view.getBigUint64(header + 40, true));
  }
  expect(staticTLSSize).toBeGreaterThan(0);
  expect(staticTLSSize).toBeLessThanOrEqual(24 * 1024);
});
