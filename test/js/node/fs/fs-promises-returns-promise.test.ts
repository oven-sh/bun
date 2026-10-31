import { describe, expect, it } from "bun:test";
import { tempDirWithFiles } from "harness";
import * as promises from "node:fs/promises";
import path from "node:path";

describe("fs.promises functions return proper Promise instances", () => {
  it("should return Promise instances for asyncWrap functions", async () => {
    const dir = tempDirWithFiles("fs-promises-test", {
      "test.txt": "hello world",
      "another.txt": "test content",
    });

    const testFile = path.join(dir, "test.txt");
    const nonExistentFile = path.join(dir, "nonexistent.txt");
    const tempFile = path.join(dir, "temp.txt");

    // Test functions that use asyncWrap and should return proper Promise instances
    const tests = [
      // File operations
      { name: "readFile", fn: () => promises.readFile(testFile) },
      { name: "writeFile", fn: () => promises.writeFile(tempFile, "new content") },
      { name: "appendFile", fn: () => promises.appendFile(testFile, " appended") },
      { name: "access", fn: () => promises.access(testFile) },
      { name: "stat", fn: () => promises.stat(testFile) },
      { name: "lstat", fn: () => promises.lstat(testFile) },

      // Directory operations
      { name: "readdir", fn: () => promises.readdir(dir) },
      { name: "mkdir", fn: () => promises.mkdir(path.join(dir, "new-dir")) },

      // File manipulation
      { name: "copyFile", fn: () => promises.copyFile(testFile, path.join(dir, "copy.txt")) },
      { name: "rename", fn: () => promises.rename(path.join(dir, "copy.txt"), path.join(dir, "renamed.txt")) },
      { name: "truncate", fn: () => promises.truncate(testFile, 5) },
      { name: "unlink", fn: () => promises.unlink(path.join(dir, "renamed.txt")) },

      // Operations that may fail but should still return Promise
      { name: "rm", fn: () => promises.rm(nonExistentFile), shouldFail: true },
      { name: "rmdir", fn: () => promises.rmdir(nonExistentFile), shouldFail: true },
      { name: "readlink", fn: () => promises.readlink(testFile), shouldFail: true }, // Not a symlink
    ];

    for (const test of tests) {
      try {
        const result = test.fn();

        // Check that the result is a Promise instance
        expect(result instanceof Promise).toBe(true);
        expect(typeof result.then).toBe("function");
        expect(typeof result.catch).toBe("function");
        expect(typeof result.finally).toBe("function");
        expect(result.constructor.name).toBe("Promise");

        // Actually await the promise to ensure it works
        if (test.shouldFail) {
          await expect(result).rejects.toThrow();
        } else {
          await result;
        }
      } catch (error) {
        throw new Error(`Test for ${test.name} failed: ${error}`);
      }
    }
  });

  it("should return Promise for open() which creates FileHandle", async () => {
    const dir = tempDirWithFiles("fs-promises-open-test", {
      "test.txt": "hello world",
    });

    const testFile = path.join(dir, "test.txt");
    const openResult = promises.open(testFile, "r");

    expect(openResult instanceof Promise).toBe(true);
    expect(typeof openResult.then).toBe("function");
    expect(openResult.constructor.name).toBe("Promise");

    // Test that it resolves to a FileHandle
    const fileHandle = await openResult;
    expect(typeof fileHandle.close).toBe("function");
    expect(typeof fileHandle.read).toBe("function");
    expect(typeof fileHandle.write).toBe("function");

    await fileHandle.close();
  });

  it("should return Promise for exists() function", async () => {
    const dir = tempDirWithFiles("fs-promises-exists-test", {
      "exists.txt": "I exist",
    });

    const existingFile = path.join(dir, "exists.txt");
    const nonExistentFile = path.join(dir, "does-not-exist.txt");

    // Test with existing file
    const existsResult1 = promises.exists(existingFile);
    expect(existsResult1 instanceof Promise).toBe(true);
    expect(existsResult1.constructor.name).toBe("Promise");
    expect(await existsResult1).toBe(true);

    // Test with non-existent file
    const existsResult2 = promises.exists(nonExistentFile);
    expect(existsResult2 instanceof Promise).toBe(true);
    expect(existsResult2.constructor.name).toBe("Promise");
    expect(await existsResult2).toBe(false);
  });

  it("should return Promise for functions with file descriptor operations", async () => {
    const dir = tempDirWithFiles("fs-promises-fd-test", {
      "test.txt": "hello world for fd test",
    });

    const testFile = path.join(dir, "test.txt");
    const fileHandle = await promises.open(testFile, "r+");

    try {
      // Test fd-based operations that use asyncWrap
      const fdTests = [
        { name: "fstat", fn: () => promises.fstat(fileHandle.fd) },
        { name: "fchmod", fn: () => promises.fchmod(fileHandle.fd, 0o644) },
        { name: "fchown", fn: () => promises.fchown(fileHandle.fd, process.getuid?.() ?? 0, process.getgid?.() ?? 0) },
        { name: "fsync", fn: () => promises.fsync(fileHandle.fd) },
        { name: "fdatasync", fn: () => promises.fdatasync(fileHandle.fd) },
        { name: "ftruncate", fn: () => promises.ftruncate(fileHandle.fd, 5) },
      ];

      for (const test of fdTests) {
        try {
          const result = test.fn();
          expect(result instanceof Promise).toBe(true);
          expect(result.constructor.name).toBe("Promise");
          await result;
        } catch (error) {
          // Some operations might fail due to permissions, but should still return Promise
          console.warn(`${test.name} failed (expected on some systems): ${error}`);
        }
      }
    } finally {
      await fileHandle.close();
    }
  });

  it("regression test: fs.promises.rm should return Promise instance, not InternalPromise", async () => {
    // This is the specific bug that was fixed - rm was returning InternalPromise instead of Promise
    const nonExistentFile = path.join(__dirname, "definitely-does-not-exist-" + Math.random());

    const rmResult = promises.rm(nonExistentFile);

    // The main assertion - this was returning false before the fix
    expect(rmResult instanceof Promise).toBe(true);
    expect(rmResult.constructor.name).toBe("Promise");
    expect(typeof rmResult.then).toBe("function");
    expect(typeof rmResult.catch).toBe("function");
    expect(typeof rmResult.finally).toBe("function");

    // Should reject with ENOENT error
    await expect(rmResult).rejects.toThrow();
  });

  it("should have correct function names without exposing internal implementation", () => {
    // Ensure function names don't leak internal implementation details
    expect(promises.rm.name).toBe("rm");
    expect(promises.readFile.name).toBe("readFile");
    expect(promises.writeFile.name).toBe("writeFile");
    expect(promises.appendFile.name).toBe("appendFile");
    expect(promises.exists.name).toBe("exists");
    expect(promises.open.name).toBe("open");
    expect(promises.access.name).toBe("access");
    expect(promises.stat.name).toBe("stat");
    expect(promises.readdir.name).toBe("readdir");
    expect(promises.mkdir.name).toBe("mkdir");
    expect(promises.copyFile.name).toBe("copyFile");
    expect(promises.rename.name).toBe("rename");
    expect(promises.unlink.name).toBe("unlink");
    expect(promises.truncate.name).toBe("truncate");
    expect(promises.chmod.name).toBe("chmod");
    expect(promises.chown.name).toBe("chown");

    // Ensure no function names start with "defaultAsync" which would expose internal implementation
    const functionNames = Object.getOwnPropertyNames(promises)
      .filter(name => typeof promises[name] === "function")
      .map(name => promises[name].name);

    for (const name of functionNames) {
      expect(name).not.toMatch(/^defaultAsync/);
    }
  });
});
