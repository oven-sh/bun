import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import { tempDir } from "harness";
import * as path from "path";

// These tests verify that the resolver properly invalidates cache across multiple
// Bun.build() calls in the same process when files/directories are deleted and recreated.
// This tests the fix in src/fs.zig and src/resolver/resolver.zig for generation > 0 behavior.

// Note: Not using describe.concurrent because these tests specifically test
// cache invalidation behavior across multiple Bun.build() calls in the same process,
// and the resolver generation counter is process-global state.
describe("resolver cache invalidation", () => {
  test("directory with index.js deleted then recreated", async () => {
    using dir = tempDir("cache-test-index-js", {
      "entry.js": `export { value } from "./subdir";`,
      "subdir/index.js": `export const value = 42;`,
    });

    const subdirPath = path.join(String(dir), "subdir");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("42");

    // Delete directory
    await fs.rm(subdirPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory
    await fs.mkdir(subdirPath);
    await fs.writeFile(path.join(subdirPath, "index.js"), `export const value = 99;`);

    // Build 3: Should succeed with new value
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("99");
  });

  test("directory with index.ts deleted then recreated", async () => {
    using dir = tempDir("cache-test-index-ts", {
      "entry.ts": `export { add } from "./utils";`,
      "utils/index.ts": `export const add = (a: number, b: number) => a + b;`,
    });

    const utilsPath = path.join(String(dir), "utils");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete directory
    await fs.rm(utilsPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.ts")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory
    await fs.mkdir(utilsPath);
    await fs.writeFile(path.join(utilsPath, "index.ts"), `export const add = (a: number, b: number) => a * b;`);

    // Build 3: Should succeed with new implementation
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    // Verify it's using multiplication (new), not addition (old)
    expect(text3).toContain("a * b");
    expect(text3).not.toContain("a + b");
  });

  test("direct file deleted then recreated", async () => {
    using dir = tempDir("cache-test-direct-file", {
      "entry.js": `export { config } from "./config.js";`,
      "config.js": `export const config = { version: 1 };`,
    });

    const configPath = path.join(String(dir), "config.js");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("1");

    // Delete file
    await fs.rm(configPath);

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate file with new content
    await fs.writeFile(configPath, `export const config = { version: 2 };`);

    // Build 3: Should succeed with new content
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("2");
  });

  test("nested directory deleted then recreated", async () => {
    using dir = tempDir("cache-test-nested", {
      "entry.js": `export { value } from "./deep/nested/module.js";`,
      "deep/nested/module.js": `export const value = "original";`,
    });

    const deepPath = path.join(String(dir), "deep");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete parent directory
    await fs.rm(deepPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory structure
    const nestedPath = path.join(deepPath, "nested");
    await fs.mkdir(deepPath);
    await fs.mkdir(nestedPath);
    await fs.writeFile(path.join(nestedPath, "module.js"), `export const value = "recreated";`);

    // Build 3: Should succeed
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("recreated");
  });

  test("extension resolution after file deletion", async () => {
    using dir = tempDir("cache-test-extension", {
      "entry.js": `export { helper } from "./helper";`,
      "helper.js": `export const helper = "js version";`,
    });

    const helperJsPath = path.join(String(dir), "helper.js");
    const helperTsPath = path.join(String(dir), "helper.ts");

    // Build 1: Resolves to .js
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("js version");

    // Delete .js file
    await fs.rm(helperJsPath);

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Create .ts file instead
    await fs.writeFile(helperTsPath, `export const helper = "ts version";`);

    // Build 3: Should resolve to .ts
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("ts version");
  });

  test("package.json exports field after deletion and recreation", async () => {
    using dir = tempDir("cache-test-pkg-exports", {
      "entry.js": `export { value } from "mypkg";`,
      "node_modules/mypkg/package.json": JSON.stringify({
        name: "mypkg",
        exports: {
          ".": "./dist/index.js",
        },
      }),
      "node_modules/mypkg/dist/index.js": `export const value = "v1";`,
    });

    const pkgPath = path.join(String(dir), "node_modules", "mypkg");
    const distPath = path.join(pkgPath, "dist");

    // Build 1: Should resolve via exports
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("v1");

    // Delete dist directory
    await fs.rm(distPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate dist with new version
    await fs.mkdir(distPath);
    await fs.writeFile(path.join(distPath, "index.js"), `export const value = "v2";`);

    // Build 3: Should succeed with new version
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("v2");
  });

  test("bare import with local node_modules after deletion", async () => {
    using dir = tempDir("cache-test-bare-import", {
      "entry.js": `export { value } from "mylib";`,
      "node_modules/mylib/index.js": `export const value = "v1";`,
      "node_modules/mylib/package.json": JSON.stringify({ name: "mylib" }),
    });

    const nodeModulesMylib = path.join(String(dir), "node_modules", "mylib");

    // Build 1: Should resolve to node_modules
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("v1");

    // Delete node_modules/mylib
    await fs.rm(nodeModulesMylib, { recursive: true });

    // Build 2: Should fail (no fallback for bare imports)
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate node_modules/mylib with new version
    await fs.mkdir(nodeModulesMylib, { recursive: true });
    await fs.writeFile(path.join(nodeModulesMylib, "package.json"), JSON.stringify({ name: "mylib" }));
    await fs.writeFile(path.join(nodeModulesMylib, "index.js"), `export const value = "v2";`);

    // Build 3: Should succeed with new version
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("v2");
  });

  test("sibling directory resolution after parent deletion", async () => {
    using dir = tempDir("cache-test-sibling", {
      "src/index.js": `export { helper } from "../lib/helper.js";`,
      "lib/helper.js": `export const helper = "original";`,
    });

    const libPath = path.join(String(dir), "lib");

    // Build 1: Should resolve sibling directory
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "src", "index.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete lib directory
    await fs.rm(libPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "src", "index.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate lib directory
    await fs.mkdir(libPath);
    await fs.writeFile(path.join(libPath, "helper.js"), `export const helper = "recreated";`);

    // Build 3: Should succeed
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "src", "index.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("recreated");
  });
});
