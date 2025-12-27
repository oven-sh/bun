import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Bun.dir()", () => {
  test("creates a lazy Directory object", () => {
    const dir = Bun.dir("/tmp");
    expect(dir).toBeDefined();
    expect(dir).toBeInstanceOf(Bun.Directory);
  });

  test("has path property", () => {
    const dir = Bun.dir("/tmp");
    expect(dir.path).toBe("/tmp");
  });

  test("has name property (basename)", () => {
    const dir = Bun.dir("/some/nested/folder");
    expect(dir.name).toBe("folder");
  });

  test("is lazy - doesn't open directory until files() is called", () => {
    // This should NOT throw even though the path doesn't exist
    const dir = Bun.dir("/this/path/does/not/exist");
    expect(dir.path).toBe("/this/path/does/not/exist");
    expect(dir.name).toBe("exist");
  });

  test("throws when path is not a string", () => {
    // @ts-expect-error - intentionally passing wrong type
    expect(() => Bun.dir(123)).toThrow();
    // @ts-expect-error - intentionally passing wrong type
    expect(() => Bun.dir(null)).toThrow();
  });

  test("throws when path is empty", () => {
    expect(() => Bun.dir("")).toThrow();
  });
});

describe("Bun.Directory constructor", () => {
  test("can be constructed with new", () => {
    const dir = new Bun.Directory("/tmp");
    expect(dir).toBeInstanceOf(Bun.Directory);
    expect(dir.path).toBe("/tmp");
  });
});

describe("Directory.filesSync()", () => {
  test("returns array of Dirent objects", () => {
    using dir_path = tempDir("bun-dir-test", {
      "file1.txt": "hello",
      "file2.txt": "world",
    });

    // Create subdirectory manually
    fs.mkdirSync(path.join(String(dir_path), "subdir"), { recursive: true });

    const dir = Bun.dir(String(dir_path));
    const entries = dir.filesSync();

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(3);

    // Check that entries are Dirent-like objects
    for (const entry of entries) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.isFile).toBe("function");
      expect(typeof entry.isDirectory).toBe("function");
    }

    // Check specific entries
    const names = entries.map(e => e.name).sort();
    expect(names).toEqual(["file1.txt", "file2.txt", "subdir"]);

    // Check file types
    const file1 = entries.find(e => e.name === "file1.txt");
    expect(file1?.isFile()).toBe(true);
    expect(file1?.isDirectory()).toBe(false);

    const subdir = entries.find(e => e.name === "subdir");
    expect(subdir?.isDirectory()).toBe(true);
    expect(subdir?.isFile()).toBe(false);
  });

  test("throws for non-existent directory", () => {
    const dir = Bun.dir("/this/path/definitely/does/not/exist");
    expect(() => dir.filesSync()).toThrow();
  });

  test("returns empty array for empty directory", () => {
    using dir_path = tempDir("bun-dir-empty-test", {});

    const dir = Bun.dir(String(dir_path));
    const entries = dir.filesSync();

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(0);
  });
});

describe("Directory.files()", () => {
  test("returns Promise that resolves to array of Dirent objects", async () => {
    using dir_path = tempDir("bun-dir-async-test", {
      "async1.txt": "async content 1",
      "async2.txt": "async content 2",
    });

    const dir = Bun.dir(String(dir_path));
    const promise = dir.files();

    expect(promise).toBeInstanceOf(Promise);

    const entries = await promise;

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(2);

    const names = entries.map(e => e.name).sort();
    expect(names).toEqual(["async1.txt", "async2.txt"]);
  });

  test("rejects for non-existent directory", async () => {
    const dir = Bun.dir("/this/path/definitely/does/not/exist/async");
    await expect(dir.files()).rejects.toThrow();
  });

  test("can be called multiple times on same Directory", async () => {
    using dir_path = tempDir("bun-dir-multi-test", {
      "multi.txt": "content",
    });

    const dir = Bun.dir(String(dir_path));

    // Call files() multiple times
    const [entries1, entries2] = await Promise.all([dir.files(), dir.files()]);

    expect(entries1.length).toBe(1);
    expect(entries2.length).toBe(1);
    expect(entries1[0].name).toBe("multi.txt");
    expect(entries2[0].name).toBe("multi.txt");
  });
});

describe("Directory Dirent properties", () => {
  test("Dirent has parentPath/path property", () => {
    using dir_path = tempDir("bun-dir-parent-test", {
      "test.txt": "test",
    });

    const dir = Bun.dir(String(dir_path));
    const entries = dir.filesSync();

    expect(entries.length).toBe(1);
    const entry = entries[0];

    // Check path/parentPath
    expect(entry.path).toBe(String(dir_path));
    expect(entry.parentPath).toBe(String(dir_path));
  });
});
