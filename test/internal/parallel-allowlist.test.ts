import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const testDir = join(import.meta.dir, "..");
const table = JSON.parse(readFileSync(join(testDir, "parallel-allowlist.json"), "utf8"));

test("test/parallel-allowlist.json has the shape the runner reads", () => {
  expect(table._meta).toBeObject();
  expect(table.dirs).toBeArray();
  expect(table.excludeFiles).toBeArray();
  expect(table.dirs.length).toBeGreaterThan(100);
  for (const p of [...table.dirs, ...table.excludeFiles]) {
    expect(p).not.toContain("\\");
    expect(p).not.toStartWith("test/");
    expect(p).not.toStartWith("/");
  }
});

test("excludeFiles are real files inside listed dirs", () => {
  const dirs = new Set(table.dirs);
  const bad = table.excludeFiles.filter((f: string) => !dirs.has(dirname(f)) || !existsSync(join(testDir, f)));
  expect(bad).toEqual([]);
});
