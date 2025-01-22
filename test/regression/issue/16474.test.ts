import { mkdirSync, writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import { test, expect } from "bun:test";
import { tmpdirSync } from "harness";
import { join } from "path";

test("fs.mkdir recursive should not error on existing", async () => {
  const testDir = tmpdirSync();

  const dir1 = join(testDir, "test123");
  expect(mkdirSync(dir1, { recursive: true })).toBe(dir1);
  expect(mkdirSync(dir1, { recursive: true })).toBeUndefined();
  expect(() => {
    mkdirSync(dir1);
  }).toThrow("EEXIST: file already exists");

  // relative
  expect(() => {
    mkdirSync("123test", { recursive: true });
    mkdirSync("123test", { recursive: true });

    mkdirSync("123test/456test", { recursive: true });
    mkdirSync("123test/456test", { recursive: true });
  }).not.toThrow();

  const dir2 = join(testDir, "test456");
  expect(await mkdir(dir2)).toBeUndefined();
  expect(await mkdir(dir2, { recursive: true })).toBeUndefined();

  // nested
  const dir3 = join(testDir, "test789", "nested");
  expect(mkdirSync(dir3, { recursive: true })).toBe(join(testDir, "test789"));
  expect(mkdirSync(dir3, { recursive: true })).toBeUndefined();

  // file
  const file = join(testDir, "test789", "file.txt");
  writeFileSync(file, "hi");
  expect(() => {
    mkdirSync(file, { recursive: true });
  }).toThrow("EEXIST: file already exists");
  expect(async () => {
    await mkdir(file, { recursive: true });
  }).toThrow("EEXIST: file already exists");
});
