const { test, expect } = require("bun:test");
const { expectRssDeltaBelow } = require("harness");

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

test.concurrent("new SourceMap(payload) does not leak sources/names", async () => {
  const code = /* js */ `
    const { SourceMap } = require("module");
    const base = Buffer.alloc(256 * 1024, "a").toString();
    function once(i) { new SourceMap({ version: 3, sources: [base + i], names: [base + (i + 1)], mappings: "AAAA" }); }
    for (let i = 0; i < 20; i++) once(i);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 300; i++) once(i);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: ~158 MiB. Fixed: allocator slack only.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 60, debug: 80 });
});
