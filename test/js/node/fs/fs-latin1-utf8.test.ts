import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { promises, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Regression test: Latin1 strings with non-ASCII characters (128-255) need
// 2 bytes per character in UTF-8. The initial buffer allocation must account
// for this expansion to avoid OOM from repeated buffer growth.

test("writeFile with non-ASCII Latin1 string", async () => {
  using dir = tempDir("latin1-utf8", {});

  // Create a string where all characters are in the high Latin1 range (128-255).
  // JSC stores this as an 8-bit Latin1 string internally.
  // Each byte needs 2 bytes in UTF-8, so the output is 2x the input size.
  const chars = [];
  for (let i = 128; i < 256; i++) {
    chars.push(String.fromCharCode(i));
  }
  const highLatin1 = chars.join("");

  // Build a large string by repeating the pattern
  const largeStr = highLatin1.repeat(1000); // 128,000 high Latin1 characters

  const filePath = join(String(dir), "test.txt");

  // Async writeFile - matches the crash scenario (runAsync path)
  await promises.writeFile(filePath, largeStr);

  const buf = readFileSync(filePath);

  // Verify: each Latin1 char 128-255 becomes a 2-byte UTF-8 sequence
  expect(buf.length).toBe(largeStr.length * 2);

  // Verify content is correct by decoding back
  const decoded = buf.toString("utf8");
  expect(decoded).toBe(largeStr);
});

test("writeFileSync with non-ASCII Latin1 string", () => {
  using dir = tempDir("latin1-utf8-sync", {});

  const chars = [];
  for (let i = 128; i < 256; i++) {
    chars.push(String.fromCharCode(i));
  }
  const highLatin1 = chars.join("").repeat(500);

  const filePath = join(String(dir), "test.txt");

  writeFileSync(filePath, highLatin1);

  const buf = readFileSync(filePath);
  expect(buf.length).toBe(highLatin1.length * 2);
  expect(buf.toString("utf8")).toBe(highLatin1);
});

test("writeFile with mixed ASCII and Latin1 string", async () => {
  using dir = tempDir("latin1-utf8-mixed", {});

  // Mix of ASCII and high Latin1 characters
  let mixed = "";
  for (let i = 0; i < 10000; i++) {
    mixed += "hello\xE9\xE8\xFC\xF1world\xC0\xDF";
  }

  const filePath = join(String(dir), "test.txt");
  await promises.writeFile(filePath, mixed);

  const content = readFileSync(filePath, "utf8");
  expect(content).toBe(mixed);
});
