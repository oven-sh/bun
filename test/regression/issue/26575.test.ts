import { describe, expect } from "bun:test";
import { readdirSync } from "fs";
import { itBundled } from "../../bundler/expectBundled";

// https://github.com/oven-sh/bun/issues/26575
// When an image is referenced from both HTML (via <img src>) and CSS (via url()),
// and the image is small enough to be inlined in CSS, the image file should still
// be emitted to the output directory for the HTML reference.
describe("issue #26575", () => {
  itBundled("html/image-referenced-by-html-and-css-inlined", {
    outdir: "out/",
    files: {
      "/index.html": `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <img src="./img.webp">
</body>
</html>`,
      "/styles.css": `body {
  background-image: url("./img.webp");
}`,
      // Small image that will be inlined in CSS (under the inlining threshold)
      // This is a minimal valid WebP file (34 bytes)
      "/img.webp": Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x0d, 0x00,
        0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // The image should be inlined in the CSS (as a data URL)
      const htmlContent = api.readFile("out/index.html");
      const cssMatch = htmlContent.match(/href="(.*\.css)"/);
      expect(cssMatch).not.toBeNull();
      const cssContent = api.readFile("out/" + cssMatch![1]);
      expect(cssContent).toContain("data:image/webp;base64,");

      // The HTML should reference the hashed image file (not inline it)
      expect(htmlContent).not.toContain("data:image/webp");
      const imgSrcMatch = htmlContent.match(/src="(\.\/[^"]+\.webp)"/);
      expect(imgSrcMatch).not.toBeNull();

      // Verify the referenced image file actually exists in the output directory
      const imgFilename = imgSrcMatch![1].replace("./", "");
      const outputFiles = readdirSync(api.outdir);
      expect(outputFiles).toContain(imgFilename);
    },
  });

  // Also test with a larger image that won't be inlined
  itBundled("html/image-referenced-by-html-and-css-not-inlined", {
    outdir: "out/",
    files: {
      "/index.html": `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <img src="./img.png">
</body>
</html>`,
      "/styles.css": `body {
  background-image: url("./img.png");
}`,
      // Large image content that won't be inlined (over 128KB threshold)
      "/img.png": Buffer.alloc(150000, "x"),
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // The image should NOT be inlined in the CSS
      const htmlContent = api.readFile("out/index.html");
      const cssMatch = htmlContent.match(/href="(.*\.css)"/);
      expect(cssMatch).not.toBeNull();
      const cssContent = api.readFile("out/" + cssMatch![1]);
      expect(cssContent).not.toContain("data:image/png;base64,");
      expect(cssContent).toMatch(/url\(".*\.png"\)/);

      // The HTML should reference the hashed image file
      const imgSrcMatch = htmlContent.match(/src="(\.\/[^"]+\.png)"/);
      expect(imgSrcMatch).not.toBeNull();

      // Verify the referenced image file actually exists in the output directory
      const imgFilename = imgSrcMatch![1].replace("./", "");
      const outputFiles = readdirSync(api.outdir);
      expect(outputFiles).toContain(imgFilename);
    },
  });
});
