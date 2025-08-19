import { expect, test } from "bun:test";
import fs from "fs";
import { tempDirWithFiles } from "harness";

test("fs.readFile with utf16le encoding should not crash on odd-length files", () => {
  // Create a temporary directory with files containing odd numbers of bytes
  const dir = tempDirWithFiles("utf16-crash-test", {
    "three-bytes.bin": Buffer.from([0x41, 0x42, 0x43]), // 3 bytes - should trigger the crash
    "five-bytes.bin": Buffer.from([0x41, 0x42, 0x43, 0x44, 0x45]), // 5 bytes
    "seven-bytes.bin": Buffer.from([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47]), // 7 bytes
  });

  // This should not crash with "exact division produced remainder"
  expect(() => {
    fs.readFileSync(`${dir}/three-bytes.bin`, "utf16le");
  }).not.toThrow();

  expect(() => {
    fs.readFileSync(`${dir}/five-bytes.bin`, "utf16le");
  }).not.toThrow();

  expect(() => {
    fs.readFileSync(`${dir}/seven-bytes.bin`, "utf16le");
  }).not.toThrow();
});

test("fs.readFile with ucs2 encoding should not crash on odd-length files", () => {
  // Create a temporary directory with files containing odd numbers of bytes
  const dir = tempDirWithFiles("ucs2-crash-test", {
    "three-bytes.bin": Buffer.from([0x41, 0x42, 0x43]), // 3 bytes - should trigger the crash
  });

  // This should not crash with "exact division produced remainder"
  expect(() => {
    fs.readFileSync(`${dir}/three-bytes.bin`, "ucs2");
  }).not.toThrow();
});

test("fs.readFile with utf16le encoding should handle single byte gracefully", () => {
  const dir = tempDirWithFiles("utf16-single-test", {
    "one-byte.bin": Buffer.from([0x41]), // 1 byte - should return empty
  });

  // Single byte should return empty string, not crash
  const result = fs.readFileSync(`${dir}/one-byte.bin`, "utf16le");
  expect(result).toBe("");
});

test("fs.readFile with utf16le encoding should truncate odd-length files correctly", () => {
  const dir = tempDirWithFiles("utf16-truncate-test", {
    // 5 bytes: [0x41, 0x00, 0x42, 0x00, 0x43] should become "AB" (first 4 bytes as 2 UTF-16 chars)
    "five-bytes.bin": Buffer.from([0x41, 0x00, 0x42, 0x00, 0x43]),
  });

  // Should truncate the last odd byte and return the valid UTF-16 content
  const result = fs.readFileSync(`${dir}/five-bytes.bin`, "utf16le");
  expect(result).toBe("AB"); // First 4 bytes as UTF-16LE: A (0x41, 0x00) + B (0x42, 0x00)
});
