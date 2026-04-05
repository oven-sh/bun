import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

test("destructured Dirent methods throw TypeError instead of returning wrong result", () => {
  using dir = tempDir("dirent-destructure", {
    "file.txt": "hello",
  });
  mkdirSync(join(String(dir), "subdir"));

  const entries = readdirSync(String(dir), { withFileTypes: true });
  const fileEntry = entries.find(e => e.name === "file.txt")!;
  const dirEntry = entries.find(e => e.name === "subdir")!;

  // Bound calls should work correctly
  expect(fileEntry.isFile()).toBe(true);
  expect(fileEntry.isDirectory()).toBe(false);
  expect(dirEntry.isDirectory()).toBe(true);
  expect(dirEntry.isFile()).toBe(false);

  // Destructured calls should throw TypeError with ERR_INVALID_THIS (matches Node.js behavior)
  const { isFile } = fileEntry;
  expect(() => isFile()).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));

  const { isDirectory } = dirEntry;
  expect(() => isDirectory()).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));

  // All 7 methods should throw when destructured
  const methods = [
    "isBlockDevice",
    "isCharacterDevice",
    "isDirectory",
    "isFIFO",
    "isFile",
    "isSocket",
    "isSymbolicLink",
  ] as const;

  for (const method of methods) {
    const { [method]: fn } = fileEntry;
    expect(() => fn()).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  }
});

test("Dirent methods called with explicit undefined this throw TypeError", () => {
  using dir = tempDir("dirent-undefined-this", {
    "a.txt": "",
  });

  const [entry] = readdirSync(String(dir), { withFileTypes: true });
  expect(() => entry.isFile.call(undefined)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
  expect(() => entry.isDirectory.call(undefined)).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
});
