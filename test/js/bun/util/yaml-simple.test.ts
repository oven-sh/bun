import { test, expect } from "bun:test";

test("YAML object exists", () => {
  expect(Bun.YAML).toBeDefined();
});

test("YAML.stringify exists", () => {
  expect(Bun.YAML.stringify).toBeDefined();
  expect(typeof Bun.YAML.stringify).toBe("function");
});