// Test for UTF-8 path encoding bug in Bun.file().stat() and Bun.file().unlink()
// Issue: UTF-8 file paths with non-ASCII characters get corrupted
import { test, expect } from "bun:test";
import { statSync, existsSync } from "fs";
import { tempDirWithFiles } from "harness";
import { join } from "path";

// Test case: German umlaut characters
test("Bun.file().stat() should handle UTF-8 paths with German umlauts", async () => {
  const dir = tempDirWithFiles("utf8-german-umlaut", {
    "über café résumé.txt": "test content for umlaut file",
  });
  const filepath = join(dir, "über café résumé.txt");

  // Verify Node.js fs works correctly
  expect(existsSync(filepath)).toBe(true);
  const nodeStat = statSync(filepath);
  expect(nodeStat.isFile()).toBe(true);
  expect(nodeStat.size).toBe(26); // length of "test content for umlaut file"

  // Verify Bun.file().stat() works correctly
  const bunFile = Bun.file(filepath);
  const bunStat = await bunFile.stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(nodeStat.size);
});

// Test case: Japanese characters
test("Bun.file().stat() should handle UTF-8 paths with Japanese characters", async () => {
  const dir = tempDirWithFiles("utf8-japanese", {
    "日本語ファイル.txt": "Japanese content",
  });
  const filepath = join(dir, "日本語ファイル.txt");

  expect(existsSync(filepath)).toBe(true);
  const bunStat = await Bun.file(filepath).stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(16); // length of "Japanese content"
});

// Test case: Emoji characters
test("Bun.file().stat() should handle UTF-8 paths with emoji", async () => {
  const dir = tempDirWithFiles("utf8-emoji", {
    "🌟.txt": "emoji file",
  });
  const filepath = join(dir, "🌟.txt");

  expect(existsSync(filepath)).toBe(true);
  const bunStat = await Bun.file(filepath).stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(10); // length of "emoji file"
});

// Test case: Mixed special characters
test("Bun.file().stat() should handle UTF-8 paths with mixed special characters", async () => {
  const dir = tempDirWithFiles("utf8-mixed", {
    "café_résumé_ñ_test.md": "mixed content",
  });
  const filepath = join(dir, "café_résumé_ñ_test.md");

  expect(existsSync(filepath)).toBe(true);
  const bunStat = await Bun.file(filepath).stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(13); // length of "mixed content"
});

// Test that .unlink() also works with UTF-8 paths
test("Bun.file().unlink() should handle UTF-8 paths", async () => {
  const dir = tempDirWithFiles("utf8-unlink", {
    "delete_üñíçödé.txt": "delete me",
  });
  const filepath = join(dir, "delete_üñíçödé.txt");

  expect(existsSync(filepath)).toBe(true);

  // Unlink should succeed
  await Bun.file(filepath).delete();

  // File should be deleted
  expect(existsSync(filepath)).toBe(false);
});

// Test .text() to ensure it still works (this uses a different code path)
test("Bun.file().text() should handle UTF-8 paths with special characters", async () => {
  const dir = tempDirWithFiles("utf8-text", {
    "read_äöü.txt": "content with umlauts: äöü",
  });
  const filepath = join(dir, "read_äöü.txt");

  const text = await Bun.file(filepath).text();
  expect(text).toBe("content with umlauts: äöü");
});
