import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Regression test for https://github.com/oven-sh/bun/issues/28921
// Bun's CSS bundler was inlining any asset smaller than 128 KB referenced
// from a CSS `url(...)` as a `data:` URI, even when the user explicitly
// configured `loader: { ".woff2": "file" }`. The fix: introduce a new `.url`
// loader that handles the auto-inline-small-assets behavior, and reserve the
// `.file` loader for "always emit a physical asset".

test("issue 28921: explicit `loader: { .woff2: 'file' }` always emits, never inlines", async () => {
  using dir = tempDir("28921-explicit-file", {
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn.woff2') format('woff2');
}
body { font-family: 'Vazirmatn'; }
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
    loader: { ".woff2": "file" },
  });

  expect(result.success).toBeTrue();

  const cssOutput = result.outputs.find(o => o.path.endsWith(".css"));
  expect(cssOutput).toBeDefined();
  const cssText = await cssOutput!.text();
  expect(cssText).not.toContain("data:font/woff2;base64");
  expect(cssText).not.toContain("data:application/octet-stream;base64");
  expect(cssText).toMatch(/Vazirmatn-[^)"']+\.woff2/);

  // Physical asset must be emitted to the output directory.
  const woff2Files = readdirSync(join(String(dir), "dist")).filter(f => f.endsWith(".woff2"));
  expect(woff2Files.length).toBe(1);
  expect(woff2Files[0]).toMatch(/^Vazirmatn-/);
});

test("issue 28921: no explicit loader → small CSS asset is auto-inlined via default `.url` loader", async () => {
  // This preserves the historical "inline small assets to save network
  // requests" behavior when the user has NOT picked a loader for the
  // extension. It's the default for any extension that isn't already mapped
  // (like `.woff2`, `.png`, `.svg`, etc.).
  using dir = tempDir("28921-default-small", {
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn.woff2') format('woff2');
}
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
  });

  expect(result.success).toBeTrue();

  const cssOutput = result.outputs.find(o => o.path.endsWith(".css"));
  expect(cssOutput).toBeDefined();
  const cssText = await cssOutput!.text();
  expect(cssText).toContain("data:font/woff2;base64");
});

test("issue 28921: no explicit loader → large CSS asset falls back to file emission", async () => {
  // Files at or above the inline limit (default 128 KB) still get emitted.
  using dir = tempDir("28921-default-large", {
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(200 * 1024, 0x42).toString(),
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn.woff2') format('woff2');
}
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
  });

  expect(result.success).toBeTrue();

  const cssOutput = result.outputs.find(o => o.path.endsWith(".css"));
  expect(cssOutput).toBeDefined();
  const cssText = await cssOutput!.text();
  expect(cssText).not.toContain("data:font/woff2;base64");
  expect(cssText).toMatch(/Vazirmatn-[^)"']+\.woff2/);

  const woff2Files = readdirSync(join(String(dir), "dist")).filter(f => f.endsWith(".woff2"));
  expect(woff2Files.length).toBe(1);
});

test("issue 28921: `assetInlineLimit: 0` forces all URL-loader assets to be emitted", async () => {
  using dir = tempDir("28921-inline-limit-0", {
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn.woff2') format('woff2');
}
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
    assetInlineLimit: 0,
  });

  expect(result.success).toBeTrue();

  const cssOutput = result.outputs.find(o => o.path.endsWith(".css"));
  expect(cssOutput).toBeDefined();
  const cssText = await cssOutput!.text();
  expect(cssText).not.toContain("data:font/woff2;base64");
  expect(cssText).toMatch(/Vazirmatn-[^)"']+\.woff2/);

  const woff2Files = readdirSync(join(String(dir), "dist")).filter(f => f.endsWith(".woff2"));
  expect(woff2Files.length).toBe(1);
});

test("issue 28921: explicit `loader: { .woff2: 'url' }` inlines small, emits large", async () => {
  using dir = tempDir("28921-explicit-url", {
    "src/fonts/Small.woff2": Buffer.alloc(256, 0x42).toString(),
    "src/fonts/Big.woff2": Buffer.alloc(200 * 1024, 0x43).toString(),
    "src/styles.css": `
@font-face {
  font-family: 'Small';
  src: url('./fonts/Small.woff2') format('woff2');
}
@font-face {
  font-family: 'Big';
  src: url('./fonts/Big.woff2') format('woff2');
}
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
    loader: { ".woff2": "url" },
  });

  expect(result.success).toBeTrue();

  const cssOutput = result.outputs.find(o => o.path.endsWith(".css"));
  expect(cssOutput).toBeDefined();
  const cssText = await cssOutput!.text();
  // Small one is inlined.
  expect(cssText).toContain("data:font/woff2;base64");
  // Big one is emitted.
  expect(cssText).toMatch(/Big-[^)"']+\.woff2/);

  const woff2Files = readdirSync(join(String(dir), "dist")).filter(f => f.endsWith(".woff2"));
  expect(woff2Files.length).toBe(1);
  expect(woff2Files[0]).toMatch(/^Big-/);
});
