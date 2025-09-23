import { expect, test } from "bun:test";
import fs from "fs";
import { tempDirWithFiles } from "harness";

// Test cases that verify Bun's UTF-16le behavior matches Node.js exactly
const testCases = [
  {
    name: "1 byte",
    bytes: [0x41],
    expectedLength: 0,
    expectedString: "",
  },

  // It needs to be big enough to trigger the code path that dynamically allocates the arraybuffer
  // so at least 256 KB.
  {
    name: "large buffer - 256KB + 1",
    bytes: (() => {
      const buffer = Buffer.allocUnsafe(256 * 1024 + 1);
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = i % 2 === 0 ? 0x41 : 0x00;
      }
      return buffer;
    })(),
    expectedLength: 128 * 1024,
    expectedString: "A".repeat(128 * 1024),
  },
];

test("fs.readFile with utf16le encoding matches Node.js behavior for all byte lengths", () => {
  const files: Record<string, Buffer> = {};

  // Create test files for each case
  testCases.forEach((testCase, i) => {
    files[`test-${i}.bin`] = Buffer.from(testCase.bytes);
  });

  const dir = tempDirWithFiles("utf16-node-compatibility", files);

  testCases.forEach((testCase, i) => {
    const filePath = `${dir}/test-${i}.bin`;

    // Test that reading doesn't crash
    expect(() => {
      fs.readFileSync(filePath, "utf16le");
    }).not.toThrow();

    // Test that result matches expected Node.js behavior
    const result = fs.readFileSync(filePath, "utf16le");
    expect(result.length).toBe(testCase.expectedLength);
    expect(result).toBe(testCase.expectedString);
  });
});

test("fs.readFile with ucs2 encoding matches utf16le behavior", () => {
  const dir = tempDirWithFiles("ucs2-compatibility", {
    "test.bin": Buffer.from([0x41, 0x42, 0x43]), // 3 bytes
  });

  const utf16leResult = fs.readFileSync(`${dir}/test.bin`, "utf16le");
  const ucs2Result = fs.readFileSync(`${dir}/test.bin`, "ucs2");

  // ucs2 and utf16le should behave identically
  expect(ucs2Result.length).toBe(utf16leResult.length);
  expect(ucs2Result).toBe(utf16leResult);
});
