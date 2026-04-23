import { describe, expect } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/27938
  // HTML bundler should not resolve URLs inside <template> tags
  itBundled("html/TemplateTagNotProcessed", {
    outdir: "out/",
    files: {
      "/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Document</title>
  </head>
  <body>
    <template>
      <img src="./assets/book-image" alt="Book" />
    </template>
    <p>Some text.</p>
  </body>
</html>`,
    },
    entryPoints: ["/index.html"],

    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      // The <template> content should be preserved as-is
      expect(html).toContain('<img src="./assets/book-image" alt="Book"');
      // The <template> tags should still be present
      expect(html).toContain("<template>");
      expect(html).toContain("</template>");
    },
  });

  // Nested templates should also be skipped
  itBundled("html/NestedTemplateTagNotProcessed", {
    outdir: "out/",
    files: {
      "/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Document</title>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <template>
      <template>
        <img src="./nested-image.png" alt="Nested" />
      </template>
      <video src="./video.mp4"></video>
    </template>
    <img src="./real-image.png" alt="Real" />
  </body>
</html>`,
      "/styles.css": "body { color: red; }",
      "/real-image.png": "fake-png-data",
    },
    entryPoints: ["/index.html"],

    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      // URLs inside <template> should be preserved as-is
      expect(html).toContain('src="./nested-image.png"');
      expect(html).toContain('src="./video.mp4"');
      // URL outside <template> should be rewritten (hashed)
      expect(html).not.toContain('src="./real-image.png"');
      // The stylesheet should be processed
      expect(html).not.toContain('href="./styles.css"');
    },
  });
});
