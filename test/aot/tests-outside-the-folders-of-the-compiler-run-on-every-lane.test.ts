// scripts/runner.node.ts splits the tests of the ahead-of-time compiler across the lanes of CI: no lane runs them all. Every
// other test runs on every lane, as it did before.
import { expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./harness/declare";

const tests = join(import.meta.dir, "..");
const runner = readFileSync(join(tests, "..", "scripts", "runner.node.ts"), "utf8");

test("only what lies under test/aot and test/bundler/trim-by-use is split across the lanes", () => {
  const gate = /^const isSplitAcrossLanes = \/(.+)\/;$/m.exec(runner)?.[1];
  expect(gate).toBeString();
  expect(runner).toContain("if (!isSplitAcrossLanes.test(path)) return true;");
  const split = readdirSync(tests, { recursive: true, encoding: "utf8" })
    .map(path => path.replaceAll("\\", "/"))
    .filter(path => new RegExp(gate!).test(path));
  expect(split.length).toBeGreaterThan(1000);
  expect(split.filter(path => !/^(?:aot|bundler\/trim-by-use)\//.test(path))).toEqual([]);
});
