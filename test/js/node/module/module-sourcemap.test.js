const { test, expect } = require("bun:test");
const { bunEnv, bunExe, isASAN, isDebug } = require("harness");

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

test("new SourceMap(payload) does not leak sources/names", async () => {
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

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: {
      ...bunEnv,
      // ASAN's quarantine pins freed blocks and keeps RSS at peak.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { deltaMiB } = JSON.parse(stdout.trim());
  // Unfixed: ~158 MiB. Fixed: allocator slack only.
  expect(deltaMiB).toBeLessThan(isASAN || isDebug ? 80 : 60);
  expect(exitCode).toBe(0);
});
