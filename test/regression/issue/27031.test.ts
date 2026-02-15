import { describe, expect } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

// Small valid PNG bytes for test assets
const pngBytes = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG header
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
  0x10,
  0x00,
  0x00,
  0x00,
  0x10, // 16x16
  0x08,
  0x02,
  0x00,
  0x00,
  0x00,
  0x90,
  0x91,
  0x68, // 8-bit RGB
  0x36,
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4e, // IEND chunk
  0x44,
  0xae,
  0x42,
  0x60,
  0x82,
]);

// Different content so each file gets a unique hash
const pngBytes2 = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x00,
  0x20,
  0x00,
  0x00,
  0x00,
  0x20, // 32x32
  0x08,
  0x02,
  0x00,
  0x00,
  0x00,
  0xfc,
  0x18,
  0xed,
  0xa3,
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
]);

const pngBytes3 = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x00,
  0x08,
  0x00,
  0x00,
  0x00,
  0x08, // 8x8
  0x08,
  0x02,
  0x00,
  0x00,
  0x00,
  0x4b,
  0x6d,
  0x29,
  0xde,
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
]);

describe.concurrent("bundler", () => {
  // Regression test: Images referenced only via HTML tags should appear in
  // HTMLBundle.files array, not just images imported via JavaScript.
  // https://github.com/oven-sh/bun/issues/27031
  itBundled("html-import/html-only-asset-references", {
    outdir: "out/",
    files: {
      "/server.js": `
import html from "./index.html";

const manifest = html;

// All three images should be in the files array
const fileLoaders = manifest.files.map(f => f.loader);
const fileInputs = manifest.files.map(f => f.input);

// logo.png and banner.png are only referenced via HTML tags, not JS imports
// icon.png is imported via both HTML and JS
const hasLogo = fileInputs.some(i => i === "logo.png");
const hasBanner = fileInputs.some(i => i === "banner.png");
const hasIcon = fileInputs.some(i => i === "icon.png");

if (!hasLogo) throw new Error("logo.png missing from manifest files (referenced via <img src>)");
if (!hasBanner) throw new Error("banner.png missing from manifest files (referenced via <img src>)");
if (!hasIcon) throw new Error("icon.png missing from manifest files (referenced via <link rel=icon> and JS import)");

// All image files should have loader "file"
const imageFiles = manifest.files.filter(f => f.path.includes(".png"));
for (const img of imageFiles) {
  if (img.loader !== "file") throw new Error("Expected loader 'file' for " + img.path + ", got " + img.loader);
  if (!img.headers || !img.headers["content-type"]) throw new Error("Missing content-type header for " + img.path);
}

console.log("OK: " + imageFiles.length + " image files in manifest");
`,
      "/index.html": `
<!DOCTYPE html>
<html>
<head>
  <link rel="icon" href="./icon.png" />
</head>
<body>
  <img src="./logo.png" alt="Logo" />
  <img src="./banner.png" alt="Banner" />
  <script type="module" src="./app.js"></script>
</body>
</html>`,
      "/app.js": `
import icon from './icon.png';
console.log("Icon imported via JS:", icon);
`,
      "/logo.png": pngBytes,
      "/banner.png": pngBytes2,
      "/icon.png": pngBytes3,
    },
    entryPoints: ["/server.js"],
    target: "bun",

    run: {
      validate({ stdout }) {
        expect(stdout).toContain("OK: 3 image files in manifest");
      },
    },
  });
});
