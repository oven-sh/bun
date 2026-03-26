import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { exists, stat } from "node:fs/promises";

// https://github.com/oven-sh/bun/issues/26631
// Path resolution fails for current directory '.' on Windows

test("existsSync('.') should return true", () => {
  expect(existsSync(".")).toBe(true);
});

test("exists('.') should return true", async () => {
  expect(await exists(".")).toBe(true);
});

test("statSync('.') should return directory stats", () => {
  const stats = statSync(".");
  expect(stats.isDirectory()).toBe(true);
});

test("stat('.') should return directory stats", async () => {
  const stats = await stat(".");
  expect(stats.isDirectory()).toBe(true);
});

test("existsSync('..') should return true", () => {
  expect(existsSync("..")).toBe(true);
});

test("exists('..') should return true", async () => {
  expect(await exists("..")).toBe(true);
});

test("statSync('..') should return directory stats", () => {
  const stats = statSync("..");
  expect(stats.isDirectory()).toBe(true);
});

test("stat('..') should return directory stats", async () => {
  const stats = await stat("..");
  expect(stats.isDirectory()).toBe(true);
});
