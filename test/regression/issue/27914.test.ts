import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";

test("readdirSync with withFileTypes and encoding 'buffer' returns Dirent with Buffer name", () => {
  using dir = tempDir("readdir-buffer-dirent", {
    "file.txt": "hello",
    "other.txt": "world",
  });

  const entries = readdirSync(String(dir), { withFileTypes: true, encoding: "buffer" });

  expect(entries.length).toBe(2);

  for (const entry of entries) {
    // name should be a Buffer, not undefined
    expect(entry.name).toBeInstanceOf(Buffer);
    expect(entry.name.length).toBeGreaterThan(0);

    // parentPath should still be a string
    expect(typeof entry.parentPath).toBe("string");

    // Dirent methods should work
    expect(entry.isFile()).toBe(true);
    expect(entry.isDirectory()).toBe(false);
  }

  // Check that the names match expected file names
  const names = entries.map((e: any) => e.name.toString()).sort();
  expect(names).toEqual(["file.txt", "other.txt"]);
});

test("readdir (async) with withFileTypes and encoding 'buffer' returns Dirent with Buffer name", async () => {
  using dir = tempDir("readdir-buffer-dirent-async", {
    "foo.js": "content",
  });

  const entries = await readdir(String(dir), { withFileTypes: true, encoding: "buffer" });

  expect(entries.length).toBe(1);
  const entry = entries[0];

  expect(entry.name).toBeInstanceOf(Buffer);
  expect(entry.name.toString()).toBe("foo.js");
  expect(typeof entry.parentPath).toBe("string");
  expect(entry.isFile()).toBe(true);
});

test("readdirSync with withFileTypes and encoding 'buffer' recursive returns Dirent with Buffer name", () => {
  using dir = tempDir("readdir-buffer-dirent-recursive", {
    "a.txt": "hello",
    "sub/b.txt": "world",
  });

  const entries = readdirSync(String(dir), { withFileTypes: true, encoding: "buffer", recursive: true });

  expect(entries.length).toBe(3); // a.txt, sub, sub/b.txt

  for (const entry of entries) {
    expect(entry.name).toBeInstanceOf(Buffer);
    expect(entry.name.length).toBeGreaterThan(0);
    expect(typeof entry.parentPath).toBe("string");
  }
});

test("readdir (async) with withFileTypes and encoding 'buffer' recursive returns Dirent with Buffer name", async () => {
  using dir = tempDir("readdir-buffer-dirent-async-recursive", {
    "a.txt": "hello",
    "sub/b.txt": "world",
  });

  const entries = await readdir(String(dir), { withFileTypes: true, encoding: "buffer", recursive: true });

  expect(entries.length).toBe(3); // a.txt, sub, sub/b.txt

  const names = entries.map((e: any) => e.name.toString()).sort();
  expect(names).toContain("a.txt");
  expect(names).toContain("sub");
  expect(names).toContain("b.txt");

  for (const entry of entries) {
    expect(entry.name).toBeInstanceOf(Buffer);
    expect(entry.name.length).toBeGreaterThan(0);
    expect(typeof entry.parentPath).toBe("string");
  }
});

test("readdirSync with withFileTypes without encoding 'buffer' still returns string names", () => {
  using dir = tempDir("readdir-dirent-string", {
    "test.txt": "content",
  });

  const entries = readdirSync(String(dir), { withFileTypes: true });

  expect(entries.length).toBe(1);
  expect(typeof entries[0].name).toBe("string");
  expect(entries[0].name).toBe("test.txt");
});

test("readdirSync with encoding 'buffer' without withFileTypes returns Uint8Array array", () => {
  using dir = tempDir("readdir-buffer-no-dirent", {
    "test.txt": "content",
  });

  const entries = readdirSync(String(dir), { encoding: "buffer" });

  expect(entries.length).toBe(1);
  expect(entries[0]).toBeInstanceOf(Uint8Array);
  expect(Buffer.from(entries[0]).toString()).toBe("test.txt");
});
