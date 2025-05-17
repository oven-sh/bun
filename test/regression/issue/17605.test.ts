import { write } from "bun";
import { expect, test } from "bun:test";
import { tmpdirSync } from "harness";
import { join } from "path";

test("empty and invalid JSON import do not crash", async () => {
  const testDir = tmpdirSync("empty-and-invalid-json-import-do-not-crash");

  await Promise.all([
    write(join(testDir, "empty.json"), ""),
    write(
      join(testDir, "invalid.json"),
      `
{
  "a": 1
  "b": 2
}`,
    ),
  ]);

  expect(async () => {
    await import(join(testDir, "empty.json") + "?0");
  }).toThrow("JSON Parse error: Unexpected EOF");

  expect(async () => {
    await import(join(testDir, "invalid.json") + "?1");
  }).toThrow("JSON Parse error: Expected '}'");

  expect(() => {
    const json = require(join(testDir, "empty.json"));
  }).toThrow("JSON Parse error: Unexpected EOF");

  expect(() => {
    const json = require(join(testDir, "invalid.json"));
  }).toThrow("JSON Parse error: Expected '}'");
});
