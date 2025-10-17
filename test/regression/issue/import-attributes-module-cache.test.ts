import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bundler creates separate cache entries for same file with different loaders", async () => {
  using dir = tempDir("import-attr-cache-test", {
    "data.json": `{"value": "test"}`,
    "test.js": `
      import jsonData from "./data.json";
      import textData from "./data.json" with { type: "json" };

      console.log("JSON1:", JSON.stringify(jsonData));
      console.log("JSON2:", JSON.stringify(textData));
    `,
  });

  // Bundle the code
  const bundleResult = Bun.spawnSync({
    cmd: [bunExe(), "build", "test.js", "--outfile=out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const bundled = await Bun.file(`${dir}/out.js`).text();

  expect(bundleResult.exitCode).toBe(0);

  // The key test: both imports should resolve to the same bundled module
  // because they both use the .json loader (file extension default and explicit attribute match)
  expect(bundled).toContain('var data_default = {\n  value: "test"\n};');

  // Both should reference the same default export
  expect(bundled).toContain("JSON1:");
  expect(bundled).toContain("JSON2:");
});

test("bundler differentiates same file with truly different loaders", async () => {
  using dir = tempDir("import-attr-diff-loader", {
    "data.json": `{"key": "value"}`,
    "test.js": `
      import jsonModule from "./data.json";
      import textData from "./data.json" with { type: "text" };

      console.log("JSON:", JSON.stringify(jsonModule));
      console.log("Text type:", typeof textData);
    `,
  });

  // Bundle the code
  const bundleResult = Bun.spawnSync({
    cmd: [bunExe(), "build", "test.js", "--outfile=out.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(bundleResult.exitCode).toBe(0);

  const bundled = await Bun.file(`${dir}/out.js`).text();

  // The JSON import should be bundled as an object
  expect(bundled).toContain('var data_default = {\n  key: "value"\n};');

  // The text import should be left as a runtime import (not bundled)
  // because type: "text" imports are external
  expect(bundled).toContain("import textData from");
  expect(bundled).toContain("data.json");
});

test("import order doesn't affect cache (JSON normal vs explicit)", async () => {
  using dir = tempDir("import-attr-order", {
    "data.json": `{"test": true}`,
    "test-explicit-first.js": `
      import explicit from "./data.json" with { type: "json" };
      import normal from "./data.json";

      console.log("Explicit:", JSON.stringify(explicit));
      console.log("Normal:", JSON.stringify(normal));
    `,
    "test-normal-first.js": `
      import normal from "./data.json";
      import explicit from "./data.json" with { type: "json" };

      console.log("Normal:", JSON.stringify(normal));
      console.log("Explicit:", JSON.stringify(explicit));
    `,
  });

  // Test with explicit import first
  const bundle1 = Bun.spawnSync({
    cmd: [bunExe(), "build", "test-explicit-first.js", "--outfile=out1.js"],
    env: bunEnv,
    cwd: String(dir),
  });
  expect(bundle1.exitCode).toBe(0);

  const bundled1 = await Bun.file(`${dir}/out1.js`).text();

  // Test with normal import first
  const bundle2 = Bun.spawnSync({
    cmd: [bunExe(), "build", "test-normal-first.js", "--outfile=out2.js"],
    env: bunEnv,
    cwd: String(dir),
  });
  expect(bundle2.exitCode).toBe(0);

  const bundled2 = await Bun.file(`${dir}/out2.js`).text();

  // Both should produce the same bundled output for the JSON file
  expect(bundled1).toContain("var data_default = {\n  test: true\n};");
  expect(bundled2).toContain("var data_default = {\n  test: true\n};");
});

test("runtime dynamic imports with different type attributes are cached separately", async () => {
  using dir = tempDir("import-attr-runtime", {
    "data.json": `{"key": "value"}`,
    "test.js": `
      const jsonData = await import("./data.json");
      const textData = await import("./data.json", { with: { type: "text" } });

      console.log("JSON type:", typeof jsonData.default);
      console.log("Text type:", typeof textData.default);
      console.log("Same?", jsonData.default === textData.default);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // JSON import should return an object
  expect(stdout).toContain("JSON type: object");

  // Text import should return a string (raw content)
  expect(stdout).toContain("Text type: string");

  // They should be different
  expect(stdout).toContain("Same? false");
});
