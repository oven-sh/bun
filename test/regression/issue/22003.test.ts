import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/22003
test.skipIf(isWindows)("tab character in filename should be escaped in sourcemap JSON", async () => {
  using dir = tempDir("22003", {
    // Filename with tab character
    "file\ttab.js": "module.exports = 42;",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "file\ttab.js", "--outfile=out.js", "--sourcemap"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("InvalidSourceMap");

  const sourcemapContent = await Bun.file(`${dir}/out.js.map`).text();

  // Must be valid JSON (system bun would produce invalid JSON with literal tab)
  let sourcemap;
  expect(() => {
    sourcemap = JSON.parse(sourcemapContent);
  }).not.toThrow();

  // The filename in sources should have the tab properly escaped
  expect(sourcemap.sources).toContain("file\ttab.js");

  // Verify no literal tab bytes (0x09) in the raw JSON
  const hasLiteralTab = sourcemapContent.includes("\t");
  expect(hasLiteralTab).toBe(false);
});
