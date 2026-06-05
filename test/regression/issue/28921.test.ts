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

test("issue 28921: same asset from JS and CSS inlines in CSS and still emits the file for JS", async () => {
  // The fallback loader must not depend on which importer's parse finishes
  // first: JS and CSS referencing the same unconfigured extension must
  // produce the same output on every build.
  using dir = tempDir("28921-js-and-css", {
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn.woff2') format('woff2');
}
`,
    "src/index.js": `
import "./styles.css";
import font from "./fonts/Vazirmatn.woff2";
console.log(font);
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/index.js")],
    outdir: join(String(dir), "dist"),
  });

  expect(result.success).toBeTrue();

  // CSS reference is inlined (the asset is below the inline limit).
  const cssText = await result.outputs.find(o => o.path.endsWith(".css"))!.text();
  expect(cssText).toContain("data:font/woff2;base64");

  // The JS import still needs the physical file, so it must be emitted and
  // referenced by its hashed path.
  const jsText = await result.outputs.find(o => o.path.endsWith(".js"))!.text();
  expect(jsText).toMatch(/Vazirmatn-[^"']+\.woff2/);
  const woff2Files = readdirSync(join(String(dir), "dist")).filter(f => f.endsWith(".woff2"));
  expect(woff2Files.length).toBe(1);
});

test("issue 28921: same asset from HTML and CSS keeps the emitted file for the HTML reference", async () => {
  using dir = tempDir("28921-html-and-css", {
    "src/logo.png": Buffer.alloc(256, 0x42).toString(),
    "src/styles.css": `body { background: url('./logo.png'); }`,
    "src/index.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="./styles.css"></head><body><img src="./logo.png"></body></html>`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/index.html")],
    outdir: join(String(dir), "dist"),
  });

  expect(result.success).toBeTrue();

  // CSS reference is inlined.
  const cssText = await result.outputs.find(o => o.path.endsWith(".css"))!.text();
  expect(cssText).toContain("data:image/png;base64");

  // The <img> tag references the file by URL, so the physical file must be
  // emitted and the attribute rewritten to its hashed path.
  const htmlText = await result.outputs.find(o => o.path.endsWith(".html"))!.text();
  expect(htmlText).toMatch(/src="\.\/logo-[^"]+\.png"/);
  const pngFiles = readdirSync(join(String(dir), "dist")).filter(f => f.endsWith(".png"));
  expect(pngFiles.length).toBe(1);
});

test("issue 28921: onLoad plugin can return `loader: 'url'`", async () => {
  using dir = tempDir("28921-onload-url", {
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn.woff2') format('woff2');
}
`,
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
    plugins: [
      {
        name: "woff2-url",
        setup(build) {
          build.onLoad({ filter: /\.woff2$/ }, async args => {
            return { contents: await Bun.file(args.path).bytes(), loader: "url" };
          });
        },
      },
    ],
  });

  expect(result.success).toBeTrue();
  const cssText = await result.outputs.find(o => o.path.endsWith(".css"))!.text();
  expect(cssText).toContain("data:font/woff2;base64");
});

test("issue 28921: onLoad callback receives `loader: 'url'` for extensions mapped to url", async () => {
  using dir = tempDir("28921-onload-args", {
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn.woff2') format('woff2');
}
`,
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
  });

  let seenLoader: string | undefined;
  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
    loader: { ".woff2": "url" },
    plugins: [
      {
        name: "capture-loader",
        setup(build) {
          build.onLoad({ filter: /\.woff2$/ }, args => {
            seenLoader = args.loader;
            return undefined;
          });
        },
      },
    ],
  });

  expect(result.success).toBeTrue();
  expect(seenLoader).toBe("url");
});

test("issue 28921: onResolve plugin-resolved CSS asset still auto-inlines", async () => {
  using dir = tempDir("28921-onresolve", {
    "src/styles.css": `
@font-face {
  font-family: 'Vazirmatn';
  src: url('font:vazirmatn') format('woff2');
}
`,
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/styles.css")],
    outdir: join(String(dir), "dist"),
    plugins: [
      {
        name: "font-resolver",
        setup(build) {
          build.onResolve({ filter: /^font:/ }, () => {
            return { path: join(String(dir), "src/fonts/Vazirmatn.woff2") };
          });
        },
      },
    ],
  });

  expect(result.success).toBeTrue();
  const cssText = await result.outputs.find(o => o.path.endsWith(".css"))!.text();
  expect(cssText).toContain("data:font/woff2;base64");
});

test("issue 28921: named imports from a `with { type: 'url' }` import are a build error", async () => {
  using dir = tempDir("28921-named-import", {
    "src/fonts/Vazirmatn.woff2": Buffer.alloc(256, 0x42).toString(),
    "src/index.js": `
import { nope } from "./fonts/Vazirmatn.woff2" with { type: "url" };
console.log(nope);
`,
  });

  const result = await Bun.build({
    entrypoints: [join(String(dir), "src/index.js")],
    outdir: join(String(dir), "dist"),
    throw: false,
  });

  expect(result.success).toBeFalse();
  const messages = result.logs.map(l => l.message).join("\n");
  expect(messages).toContain('This loader type only supports the "default" import');
});
