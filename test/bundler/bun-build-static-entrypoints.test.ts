import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.build with static file entrypoints", () => {
  test("JSON entrypoint should create JS module with inlined content", async () => {
    const dir = tempDirWithFiles("bun-build-json-entry", {
      "data.json": JSON.stringify({ hello: "world", foo: 123 }),
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "data.json")],
      outdir: join(dir, "out"),
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("entry-point");
    expect(build.outputs[0].path).toEndWith("data.js");

    const content = await build.outputs[0].text();
    // Should contain the actual JSON data inlined, not a path to a separate file
    expect(content).toContain("hello");
    expect(content).toContain("world");
    expect(content).toContain('var hello = "world"'); // Data should be inlined as JS vars
  });

  test("file loader entrypoint should copy file directly without JS wrapper", async () => {
    const dir = tempDirWithFiles("bun-build-file-entry", {
      "logo.png": Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01, // 1x1 pixel
        0x08,
        0x06,
        0x00,
        0x00,
        0x00,
        0x1f,
        0x15,
        0xc4,
        0x89,
        0x00,
        0x00,
        0x00,
        0x0a,
        0x49,
        0x44,
        0x41,
        0x54,
        0x78,
        0x9c,
        0x63,
        0x00,
        0x01,
        0x00,
        0x00,
        0x05,
        0x00,
        0x01,
        0x0d,
        0x0a,
        0x2d,
        0xb4,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4e,
        0x44,
        0xae,
        0x42,
        0x60,
        0x82,
      ]),
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "logo.png")],
      outdir: join(dir, "out"),
      loader: { ".png": "file" }, // Explicitly use file loader
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("asset");
    expect(build.outputs[0].path).toMatch(/logo.*\.png$/); // Should be a PNG file, not JS

    const content = await build.outputs[0].arrayBuffer();
    const buffer = Buffer.from(content);
    // Check PNG signature
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  test("text file with file loader should copy directly", async () => {
    const dir = tempDirWithFiles("bun-build-text-file", {
      "readme.txt": "Hello World",
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "readme.txt")],
      outdir: join(dir, "out"),
      loader: { ".txt": "file" },
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("asset");
    expect(build.outputs[0].path).toMatch(/readme.*\.txt$/);

    const content = await build.outputs[0].text();
    expect(content).toBe("Hello World");
  });

  test("wasm entrypoint should copy directly without JS wrapper", async () => {
    // Minimal valid WASM module
    const wasmBytes = new Uint8Array([
      0x00,
      0x61,
      0x73,
      0x6d, // magic number
      0x01,
      0x00,
      0x00,
      0x00, // version
    ]);

    const dir = tempDirWithFiles("bun-build-wasm-entry", {
      "module.wasm": Buffer.from(wasmBytes),
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "module.wasm")],
      outdir: join(dir, "out"),
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("asset");
    expect(build.outputs[0].path).toMatch(/module.*\.wasm$/);

    const content = await build.outputs[0].arrayBuffer();
    const buffer = Buffer.from(content);
    // Check WASM magic number
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  });

  test("multiple file loader entrypoints", async () => {
    const dir = tempDirWithFiles("bun-build-multi-file", {
      "a.txt": "File A",
      "b.txt": "File B",
      "c.txt": "File C",
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "a.txt"), join(dir, "b.txt"), join(dir, "c.txt")],
      outdir: join(dir, "out"),
      loader: { ".txt": "file" },
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(3);
    expect(build.outputs.every(o => o.kind === "asset")).toBe(true);
    expect(build.outputs.every(o => o.path.endsWith(".txt"))).toBe(true);
  });

  test("importing static files from JS should still create proxy + asset", async () => {
    // When a JS file imports a static asset, it should create:
    // 1. JS bundle with the asset path inlined
    // 2. The hashed asset file
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
      0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const dir = tempDirWithFiles("bun-build-import-static", {
      "index.js": 'export { default as logo } from "./logo.png";',
      "logo.png": pngData,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      outdir: join(dir, "out"),
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(2);

    // Should have 1 entry-point (index.js) and 1 asset (logo.png)
    const entryPoint = build.outputs.find(o => o.kind === "entry-point");
    const asset = build.outputs.find(o => o.kind === "asset");

    expect(entryPoint).toBeDefined();
    expect(asset).toBeDefined();

    expect(entryPoint!.path).toMatch(/index\.js$/);
    expect(asset!.path).toMatch(/logo.*\.png$/);

    // The JS should contain a reference to the hashed PNG
    const jsContent = await entryPoint!.text();
    expect(jsContent).toContain("logo");
    expect(jsContent).toContain(".png");

    // The asset should be the actual PNG
    const assetContent = await asset!.arrayBuffer();
    const buffer = Buffer.from(assetContent);
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  test("copying files use case - PNG without explicit loader", async () => {
    // PNG files default to .file loader, so they should be copied directly
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
      0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const dir = tempDirWithFiles("bun-build-copy-png", {
      "logo.png": pngData,
      "favicon.png": pngData,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "logo.png"), join(dir, "favicon.png")],
      outdir: join(dir, "out"),
      // No explicit loader - PNG defaults to .file
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(2);

    // Should produce ONLY asset files, no JS wrappers
    expect(build.outputs.every(o => o.kind === "asset")).toBe(true);
    expect(build.outputs.every(o => o.path.endsWith(".png"))).toBe(true);

    // Verify actual PNG content
    for (const output of build.outputs) {
      const content = await output.arrayBuffer();
      const buffer = Buffer.from(content);
      expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });
});
