import { test, expect } from "bun:test";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { tempDirWithFiles } from "harness";
import { join } from "path";

test("fs/promises methods return actual Promise instances", async () => {
  const dir = tempDirWithFiles("fs-promises-instanceof", {
    "test.txt": "test content",
  });

  const testFile = join(dir, "test.txt");

  // Test readFile
  const readResult = readFile(testFile);
  expect(readResult instanceof Promise).toBe(true);
  expect(readResult.constructor).toBe(Promise);
  expect(Object.prototype.toString.call(readResult)).toBe("[object Promise]");
  
  // Test writeFile
  const writeResult = writeFile(join(dir, "write-test.txt"), "content");
  expect(writeResult instanceof Promise).toBe(true);
  expect(writeResult.constructor).toBe(Promise);
  
  // Test stat
  const statResult = stat(testFile);
  expect(statResult instanceof Promise).toBe(true);
  expect(statResult.constructor).toBe(Promise);
  
  // Test mkdir
  const mkdirResult = mkdir(join(dir, "new-dir"));
  expect(mkdirResult instanceof Promise).toBe(true);
  expect(mkdirResult.constructor).toBe(Promise);

  // Ensure promises actually resolve correctly
  await readResult;
  await writeResult;
  await statResult;
  await mkdirResult;
});