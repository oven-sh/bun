// https://github.com/oven-sh/bun/issues/24748
import { expect, test } from "bun:test";
import * as fs from "node:fs";

test("fs.existsSync should work with '.' and './' on Windows", () => {
  expect(fs.existsSync(".")).toBe(true);
  expect(fs.existsSync("./")).toBe(true);
  expect(fs.existsSync(process.cwd())).toBe(true);
});

test("fs.statSync should work with '.' and './' on Windows", () => {
  expect(fs.statSync(".").isDirectory()).toBe(true);
  expect(fs.statSync("./").isDirectory()).toBe(true);
  expect(fs.statSync(process.cwd()).isDirectory()).toBe(true);
});
