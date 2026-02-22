import { expect, test } from "bun:test";
import { tempDir } from "harness";
import fs from "node:fs";

test("fs.readdir returns sorted entries", () => {
  using dir = tempDir("readdir-sorted", {
    "a": "",
    "b": "",
    "c": "",
    "0": "",
    "1": "",
    "2": "",
  });

  const entries = fs.readdirSync(String(dir));
  expect(entries).toEqual(["0", "1", "2", "a", "b", "c"]);
});

test("fs.readdir async returns sorted entries", async () => {
  using dir = tempDir("readdir-sorted-async", {
    "a": "",
    "b": "",
    "c": "",
    "0": "",
    "1": "",
    "2": "",
  });

  const entries = await fs.promises.readdir(String(dir));
  expect(entries).toEqual(["0", "1", "2", "a", "b", "c"]);
});

test("fs.readdir with buffer encoding returns sorted entries", () => {
  using dir = tempDir("readdir-sorted-buffer", {
    "a": "",
    "b": "",
    "c": "",
    "0": "",
    "1": "",
    "2": "",
  });

  const entries = fs.readdirSync(String(dir), { encoding: "buffer" });
  const names = entries.map(buf => buf.toString());
  expect(names).toEqual(["0", "1", "2", "a", "b", "c"]);
});

test("fs.readdir with withFileTypes returns sorted entries", () => {
  using dir = tempDir("readdir-sorted-dirent", {
    "a": "",
    "b": "",
    "c": "",
    "0": "",
    "1": "",
    "2": "",
  });

  const entries = fs.readdirSync(String(dir), { withFileTypes: true });
  const names = entries.map(dirent => dirent.name);
  expect(names).toEqual(["0", "1", "2", "a", "b", "c"]);
});

test("fs.readdir recursive returns sorted entries", () => {
  using dir = tempDir("readdir-sorted-recursive", {
    "a": "",
    "b": "",
    "c": "",
    "subdir/d": "",
    "subdir/e": "",
    "subdir/0": "",
  });

  const entries = fs.readdirSync(String(dir), { recursive: true });
  // Sort expectations for recursive: all entries should be sorted
  const sortedEntries = entries.slice().sort();
  expect(entries).toEqual(sortedEntries);
});

test("fs.readdir with mixed case returns sorted entries", () => {
  using dir = tempDir("readdir-sorted-mixed", {
    "Apple": "",
    "banana": "",
    "Cherry": "",
    "1file": "",
    "2file": "",
  });

  const entries = fs.readdirSync(String(dir));
  // Sort should be case-sensitive lexicographic
  expect(entries).toEqual(["1file", "2file", "Apple", "Cherry", "banana"]);
});
