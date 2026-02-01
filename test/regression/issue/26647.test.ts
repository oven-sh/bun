import { expect, test } from "bun:test";
import { tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26647
// Bun.file().stat() and Bun.file().delete() corrupt UTF-8 paths with non-ASCII
// characters when the path is passed as a Buffer.

test("Bun.file() with Buffer path handles UTF-8 correctly for stat()", async () => {
  using dir = tempDir("test-26647", {
    "über.txt": "content",
  });

  const filepath = `${dir}/über.txt`;

  // Verify the file exists first using string path
  const bunFile1 = Bun.file(filepath);
  const stat1 = await bunFile1.stat();
  expect(stat1.size).toBe(7); // "content" is 7 bytes

  // Now test with Buffer path - this was failing before the fix
  const bufPath = Buffer.from(filepath, "utf8");
  const bunFile2 = Bun.file(bufPath);
  const stat2 = await bunFile2.stat();
  expect(stat2.size).toBe(7);
});

test("Bun.file() with Buffer path handles UTF-8 correctly for delete()", async () => {
  using dir = tempDir("test-26647", {
    "über.txt": "content",
  });

  const filepath = `${dir}/über.txt`;

  // Test delete() with Buffer path - this was failing before the fix
  const bufPath = Buffer.from(filepath, "utf8");
  const bunFile = Bun.file(bufPath);

  // Verify file exists before delete
  const stat = await bunFile.stat();
  expect(stat.size).toBe(7);

  // Delete should succeed
  await bunFile.delete();

  // Verify file no longer exists
  const exists = await Bun.file(filepath).exists();
  expect(exists).toBe(false);
});

test("Bun.file() with Buffer path handles various UTF-8 characters", async () => {
  using dir = tempDir("test-26647", {
    "日本語.txt": "japanese",
    "émoji🎉.txt": "emoji",
    "中文测试.txt": "chinese",
  });

  // Test Japanese filename
  const jpPath = Buffer.from(`${dir}/日本語.txt`, "utf8");
  const jpStat = await Bun.file(jpPath).stat();
  expect(jpStat.size).toBe(8); // "japanese" is 8 bytes

  // Test emoji filename
  const emojiPath = Buffer.from(`${dir}/émoji🎉.txt`, "utf8");
  const emojiStat = await Bun.file(emojiPath).stat();
  expect(emojiStat.size).toBe(5); // "emoji" is 5 bytes

  // Test Chinese filename
  const cnPath = Buffer.from(`${dir}/中文测试.txt`, "utf8");
  const cnStat = await Bun.file(cnPath).stat();
  expect(cnStat.size).toBe(7); // "chinese" is 7 bytes
});
