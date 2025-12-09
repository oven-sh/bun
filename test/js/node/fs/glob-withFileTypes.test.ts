import { expect, test } from "bun:test";
import { Dirent, globSync } from "fs";
import { tempDirWithFiles } from "harness";

test("fs.globSync with withFileTypes should return Dirent objects", async () => {
  const dir = tempDirWithFiles("glob-withFileTypes", {
    "file1.txt": "content1",
    "file2.js": "console.log('hello')",
    "subdir/file3.txt": "content3",
    "subdir/file4.md": "# Title",
  });

  // Test globSync with withFileTypes: true
  const results = Array.from(
    globSync("*", {
      cwd: dir,
      withFileTypes: true,
    }),
  );

  expect(results.length).toBeGreaterThan(0);

  for (const dirent of results) {
    // Check that we got proper Dirent objects with instanceof
    expect(dirent instanceof Dirent).toBe(true);

    // Check that we got Dirent objects
    expect(dirent).toHaveProperty("name");
    expect(dirent).toHaveProperty("isFile");
    expect(dirent).toHaveProperty("isDirectory");
    expect(dirent).toHaveProperty("isSymbolicLink");
    expect(dirent).toHaveProperty("isBlockDevice");
    expect(dirent).toHaveProperty("isCharacterDevice");
    expect(dirent).toHaveProperty("isFIFO");
    expect(dirent).toHaveProperty("isSocket");

    // Verify methods work
    expect(typeof dirent.isFile()).toBe("boolean");
    expect(typeof dirent.isDirectory()).toBe("boolean");
    expect(typeof dirent.isSymbolicLink()).toBe("boolean");

    // Check name property
    expect(typeof dirent.name).toBe("string");
    expect(dirent.name.length).toBeGreaterThan(0);

    // Check parentPath property (should be the cwd)
    expect(dirent.parentPath).toBe(dir);
  }

  // Verify that we have both files and directories
  const files = results.filter(d => d.isFile());
  const dirs = results.filter(d => d.isDirectory());

  expect(files.length).toBeGreaterThan(0);
  expect(dirs.length).toBeGreaterThan(0);
});

test("fs.globSync with withFileTypes: false should return strings", async () => {
  const dir = tempDirWithFiles("glob-strings", {
    "file1.txt": "content1",
    "file2.js": "console.log('hello')",
  });

  const results = Array.from(
    globSync("*", {
      cwd: dir,
      withFileTypes: false,
    }),
  );

  expect(results.length).toBeGreaterThan(0);

  for (const result of results) {
    // Check that we got strings, not Dirent objects
    expect(typeof result).toBe("string");
    expect(result).not.toHaveProperty("isFile");
  }
});

test("fs.globSync default behavior should return strings", async () => {
  const dir = tempDirWithFiles("glob-default", {
    "file1.txt": "content1",
    "file2.js": "console.log('hello')",
  });

  const results = Array.from(
    globSync("*", {
      cwd: dir,
    }),
  );

  expect(results.length).toBeGreaterThan(0);

  for (const result of results) {
    // Check that we got strings by default
    expect(typeof result).toBe("string");
    expect(result).not.toHaveProperty("isFile");
  }
});

test("fs.globSync withFileTypes with nested patterns", async () => {
  const dir = tempDirWithFiles("glob-nested", {
    "file1.txt": "content1",
    "subdir/file2.txt": "content2",
    "subdir/nested/file3.txt": "content3",
  });

  const results = Array.from(
    globSync("**/*.txt", {
      cwd: dir,
      withFileTypes: true,
    }),
  );

  expect(results.length).toBe(3);

  for (const dirent of results) {
    expect(dirent.isFile()).toBe(true);
    expect(dirent.isDirectory()).toBe(false);
    expect(dirent.name.endsWith(".txt")).toBe(true);
  }
});
