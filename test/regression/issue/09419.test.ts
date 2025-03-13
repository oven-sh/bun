import { describe, test, expect } from "bun:test";
import { existsSync, rmSync, rmdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdirSync } from "harness";

describe("rm() with empty directories", () => {
  test("rmSync(): recursive false should remove empty directory", () => {
    const dir = tmpdirSync("rmSync-false");
    rmSync(dir, { recursive: false });
    expect(existsSync(dir)).toBe(false);
  });

  test("rm(): recursive false should remove empty directory", async () => {
    const dir = tmpdirSync("rm-false");
    await rm(dir, { recursive: false });
    expect(existsSync(dir)).toBe(false);
  });

  test("rmSync(): recursive true should remove empty directory", () => {
    const dir = tmpdirSync("rmSync-true");
    rmSync(dir, { recursive: true });
    expect(existsSync(dir)).toBe(false);
  });

  test("rmdirSync(): should remove empty directory", () => {
    const dir = tmpdirSync("rmdir");
    rmdirSync(dir);
    expect(existsSync(dir)).toBe(false);
  });
});
