import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import fs from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";

describe.concurrent("fs.glob withFileTypes", () => {
  test("fs.promises.glob returns Dirent objects with withFileTypes: true", async () => {
    using dir = tempDir("glob-withFileTypes", {
      "hello.txt": "hello",
      "world.txt": "world",
      "sub/nested.txt": "nested",
    });

    const results: fs.Dirent[] = [];
    for await (const entry of glob("**/*.txt", { cwd: String(dir), withFileTypes: true })) {
      results.push(entry as fs.Dirent);
    }

    results.sort((a, b) => {
      const aFull = path.join(a.parentPath, a.name);
      const bFull = path.join(b.parentPath, b.name);
      return aFull.localeCompare(bFull);
    });

    expect(results).toHaveLength(3);

    // Each result should be a Dirent instance
    for (const entry of results) {
      expect(entry).toBeInstanceOf(fs.Dirent);
      expect(entry.isFile()).toBe(true);
      expect(entry.isDirectory()).toBe(false);
    }

    // Check specific entries
    expect(results[0].name).toBe("hello.txt");
    expect(results[0].parentPath).toBe(String(dir));

    expect(results[1].name).toBe("nested.txt");
    expect(results[1].parentPath).toBe(path.join(String(dir), "sub"));

    expect(results[2].name).toBe("world.txt");
    expect(results[2].parentPath).toBe(String(dir));
  });

  test("fs.globSync returns Dirent objects with withFileTypes: true", () => {
    using dir = tempDir("glob-withFileTypes-sync", {
      "file.txt": "content",
      "subdir/other.txt": "other",
    });

    const results = Array.from(
      fs.globSync("**/*.txt", { cwd: String(dir), withFileTypes: true }) as Iterable<fs.Dirent>,
    );
    results.sort((a, b) => {
      const aFull = path.join(a.parentPath, a.name);
      const bFull = path.join(b.parentPath, b.name);
      return aFull.localeCompare(bFull);
    });

    expect(results).toHaveLength(2);

    expect(results[0]).toBeInstanceOf(fs.Dirent);
    expect(results[0].name).toBe("file.txt");
    expect(results[0].parentPath).toBe(String(dir));
    expect(results[0].isFile()).toBe(true);

    expect(results[1]).toBeInstanceOf(fs.Dirent);
    expect(results[1].name).toBe("other.txt");
    expect(results[1].parentPath).toBe(path.join(String(dir), "subdir"));
    expect(results[1].isFile()).toBe(true);
  });

  test("fs.glob callback returns Dirent objects with withFileTypes: true", async () => {
    using dir = tempDir("glob-withFileTypes-cb", {
      "a.txt": "a",
    });

    const { promise, resolve, reject } = Promise.withResolvers<fs.Dirent[]>();
    fs.glob("*.txt", { cwd: String(dir), withFileTypes: true }, (err, matches) => {
      if (err) return reject(err);
      resolve(matches as fs.Dirent[]);
    });
    const results = await promise;

    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(fs.Dirent);
    expect(results[0].name).toBe("a.txt");
    expect(results[0].parentPath).toBe(String(dir));
    expect(results[0].isFile()).toBe(true);
  });

  test("withFileTypes works with directories", () => {
    using dir = tempDir("glob-withFileTypes-dirs", {
      "mydir/file.txt": "content",
    });

    const results = Array.from(fs.globSync("*/", { cwd: String(dir), withFileTypes: true }) as Iterable<fs.Dirent>);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(fs.Dirent);
    expect(results[0].name).toBe("mydir");
    expect(results[0].parentPath).toBe(String(dir));
    expect(results[0].isDirectory()).toBe(true);
    expect(results[0].isFile()).toBe(false);
  });

  test("withFileTypes: false returns strings (default behavior)", async () => {
    using dir = tempDir("glob-withFileTypes-false", {
      "test.txt": "test",
    });

    const results: string[] = [];
    for await (const entry of glob("*.txt", { cwd: String(dir), withFileTypes: false })) {
      results.push(entry);
    }

    expect(results).toHaveLength(1);
    expect(typeof results[0]).toBe("string");
    expect(results[0]).toBe("test.txt");
  });

  test("Dirent path and parentPath are the same", async () => {
    using dir = tempDir("glob-withFileTypes-path", {
      "file.txt": "content",
    });

    const results: fs.Dirent[] = [];
    for await (const entry of glob("*.txt", { cwd: String(dir), withFileTypes: true })) {
      results.push(entry as fs.Dirent);
    }

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe(results[0].parentPath);
  });

  test.skipIf(process.platform === "win32")("withFileTypes works with symlinks", () => {
    using dir = tempDir("glob-withFileTypes-symlink", {
      "target.txt": "target content",
    });

    const dirStr = String(dir);
    fs.symlinkSync(path.join(dirStr, "target.txt"), path.join(dirStr, "link.txt"));

    const results = Array.from(fs.globSync("link.*", { cwd: dirStr, withFileTypes: true }) as Iterable<fs.Dirent>);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(fs.Dirent);
    expect(results[0].name).toBe("link.txt");
    expect(results[0].isSymbolicLink()).toBe(true);
  });

  test("withFileTypes does not throw when no files match", () => {
    using dir = tempDir("glob-withFileTypes-empty", {
      "readme.md": "not a txt file",
    });

    const results = Array.from(fs.globSync("*.txt", { cwd: String(dir), withFileTypes: true }) as Iterable<fs.Dirent>);

    expect(results).toHaveLength(0);
  });
});
