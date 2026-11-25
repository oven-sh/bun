// Test for UTF-8 path encoding bug in Bun.file().stat() and Bun.file().unlink()
// Issue: https://github.com/oven-sh/bun/issues/26647
import { expect, test } from "bun:test";
import { existsSync, statSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

// Test case: German umlaut characters
test("Bun.file().stat() should handle UTF-8 paths with German umlauts", async () => {
  const content = "test content for umlaut file";
  await using dir = tempDir("utf8-german-umlaut", {
    "über café résumé.txt": content,
  });
  const filepath = join(String(dir), "über café résumé.txt");

  // Verify Node.js fs works correctly
  expect(existsSync(filepath)).toBe(true);
  const nodeStat = statSync(filepath);
  expect(nodeStat.isFile()).toBe(true);
  expect(nodeStat.size).toBe(Buffer.byteLength(content));

  // Verify Bun.file().stat() works correctly
  const bunFile = Bun.file(filepath);
  const bunStat = await bunFile.stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(nodeStat.size);
});

// Test case: Japanese characters
test("Bun.file().stat() should handle UTF-8 paths with Japanese characters", async () => {
  const content = "Japanese content";
  await using dir = tempDir("utf8-japanese", {
    "日本語ファイル.txt": content,
  });
  const filepath = join(String(dir), "日本語ファイル.txt");

  expect(existsSync(filepath)).toBe(true);
  const bunStat = await Bun.file(filepath).stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(Buffer.byteLength(content));
});

// Test case: Emoji characters
test("Bun.file().stat() should handle UTF-8 paths with emoji", async () => {
  const content = "emoji file";
  await using dir = tempDir("utf8-emoji", {
    "🌟.txt": content,
  });
  const filepath = join(String(dir), "🌟.txt");

  expect(existsSync(filepath)).toBe(true);
  const bunStat = await Bun.file(filepath).stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(Buffer.byteLength(content));
});

// Test case: Mixed special characters
test("Bun.file().stat() should handle UTF-8 paths with mixed special characters", async () => {
  const content = "mixed content";
  await using dir = tempDir("utf8-mixed", {
    "café_résumé_ñ_test.md": content,
  });
  const filepath = join(String(dir), "café_résumé_ñ_test.md");

  expect(existsSync(filepath)).toBe(true);
  const bunStat = await Bun.file(filepath).stat();
  expect(bunStat.isFile()).toBe(true);
  expect(bunStat.size).toBe(Buffer.byteLength(content));
});

// Test that .delete() also works with UTF-8 paths
test("Bun.file().delete() should handle UTF-8 paths", async () => {
  await using dir = tempDir("utf8-unlink", {
    "delete_üñíçödé.txt": "delete me",
  });
  const filepath = join(String(dir), "delete_üñíçödé.txt");

  expect(existsSync(filepath)).toBe(true);

  // Delete should succeed
  await Bun.file(filepath).delete();

  // File should be deleted
  expect(existsSync(filepath)).toBe(false);
});

// Test .text() to ensure it still works (this uses a different code path)
test("Bun.file().text() should handle UTF-8 paths with special characters", async () => {
  const content = "content with umlauts: äöü";
  await using dir = tempDir("utf8-text", {
    "read_äöü.txt": content,
  });
  const filepath = join(String(dir), "read_äöü.txt");

  const text = await Bun.file(filepath).text();
  expect(text).toBe(content);
});
