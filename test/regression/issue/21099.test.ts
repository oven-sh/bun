import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { Dirent, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const invalidThisError = expect.objectContaining({
  name: "TypeError",
  code: "ERR_INVALID_THIS",
});

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
  expect(() => isFile()).toThrow(invalidThisError);

  const { isDirectory } = dirEntry;
  expect(() => isDirectory()).toThrow(invalidThisError);

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
    expect(() => fn()).toThrow(invalidThisError);
  }
});

test("Dirent methods called with explicit undefined this throw TypeError", () => {
  using dir = tempDir("dirent-undefined-this", {
    "a.txt": "",
  });

  const [entry] = readdirSync(String(dir), { withFileTypes: true });
  expect(() => entry.isFile.call(undefined)).toThrow(invalidThisError);
  expect(() => entry.isDirectory.call(undefined)).toThrow(invalidThisError);
});

test("Dirent constructed with missing or non-integer type returns false (does not throw)", () => {
  // `new Dirent(name)` with no type arg — the stored type slot is undefined.
  // Node.js compares undefined === UV_DIRENT_DIR which is false. Must not throw.
  // @ts-expect-error — public constructor, testing partial args
  const noType = new Dirent("foo");
  expect(noType).toBeInstanceOf(Dirent);
  expect(noType.isFile()).toBe(false);
  expect(noType.isDirectory()).toBe(false);
  expect(noType.isBlockDevice()).toBe(false);
  expect(noType.isCharacterDevice()).toBe(false);
  expect(noType.isFIFO()).toBe(false);
  expect(noType.isSocket()).toBe(false);
  expect(noType.isSymbolicLink()).toBe(false);

  // Non-integer type argument — also must not throw.
  // @ts-expect-error — exercising wrong-type input
  const stringType = new Dirent("bar", "not-a-number", "/path");
  expect(stringType.isFile()).toBe(false);
  expect(stringType.isDirectory()).toBe(false);

  // Proper integer type still works.
  const dirType = new Dirent("baz", 2 /* UV_DIRENT_DIR */, "/path");
  expect(dirType.isDirectory()).toBe(true);
  expect(dirType.isFile()).toBe(false);

  const fileType = new Dirent("qux", 1 /* UV_DIRENT_FILE */, "/path");
  expect(fileType.isFile()).toBe(true);
  expect(fileType.isDirectory()).toBe(false);
});

test("Dirent methods work via prototype-chain delegation", () => {
  // Node.js reads this[kType] via a Symbol, which walks the prototype chain.
  // Object.create(dirent) and Object.setPrototypeOf({}, dirent) must still
  // resolve the inherited type slot and return the correct boolean, not throw.
  const dirent = new Dirent("foo", 1 /* UV_DIRENT_FILE */, "/path");

  const createWrapper = Object.create(dirent);
  expect(createWrapper.isFile()).toBe(true);
  expect(createWrapper.isDirectory()).toBe(false);

  const setProtoWrapper = Object.setPrototypeOf({}, dirent);
  expect(setProtoWrapper.isFile()).toBe(true);
  expect(setProtoWrapper.isBlockDevice()).toBe(false);

  // Subclass instances still work (they get @data as own property via constructDirent).
  class MyDirent extends Dirent {}
  const sub = new MyDirent("sub", 2 /* UV_DIRENT_DIR */, "/path");
  expect(sub.isDirectory()).toBe(true);
  expect(sub.isFile()).toBe(false);
});
