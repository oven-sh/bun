const { test, expect } = require("bun:test");

test("SourceMap is available from node:module", () => {
  const module = require("node:module");
  expect(module.SourceMap).toBeDefined();
  expect(typeof module.SourceMap).toBe("function");
});

test("SourceMap from require('module') works", () => {
  const module = require("module");
  expect(module.SourceMap).toBeDefined();
  expect(typeof module.SourceMap).toBe("function");
});

test("Can create SourceMap instance from node:module", () => {
  const { SourceMap } = require("node:module");
  const payload = {
    version: 3,
    sources: ["test.js"],
    names: [],
    mappings: "AAAA",
  };

  const sourceMap = new SourceMap(payload);
  expect(sourceMap).toBeInstanceOf(SourceMap);
  expect(sourceMap.payload).toBe(payload);
});
