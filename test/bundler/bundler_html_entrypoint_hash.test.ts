import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("HTML entrypoint isolated_hash", () => {
  test("HTML chunk hash should change when JS dependencies change", async () => {
    using dir = tempDir("html-hash-js-test", {
      "index.html": `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
  <script type="module" src="./index.js"></script>
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`,
      "index.js": `console.log("version 1");`,
    });

    // First build
    const result1 = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      outdir: join(String(dir), "dist1"),
      naming: "[name]-[hash].[ext]",
    });

    expect(result1.success).toBe(true);

    // Find HTML output
    const htmlOutput1 = result1.outputs.find(o => o.path.endsWith(".html"));
    expect(htmlOutput1).toBeDefined();
    const htmlPath1 = htmlOutput1!.path;
    const htmlHash1 = htmlPath1.match(/index-([a-z0-9]+)\.html/)?.[1];
    expect(htmlHash1).toBeDefined();

    // Modify JS
    await Bun.write(join(String(dir), "index.js"), `console.log("version 2");`);

    // Second build
    const result2 = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      outdir: join(String(dir), "dist2"),
      naming: "[name]-[hash].[ext]",
    });

    expect(result2.success).toBe(true);

    // Find HTML output
    const htmlOutput2 = result2.outputs.find(o => o.path.endsWith(".html"));
    expect(htmlOutput2).toBeDefined();
    const htmlPath2 = htmlOutput2!.path;
    const htmlHash2 = htmlPath2.match(/index-([a-z0-9]+)\.html/)?.[1];
    expect(htmlHash2).toBeDefined();

    // Check if HTML hash changed when JS changed
    expect(htmlHash1).not.toBe(htmlHash2);
  });

  test("HTML chunk hash should change when CSS dependencies change", async () => {
    using dir = tempDir("html-hash-css-test", {
      "index.html": `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
  <link rel="stylesheet" href="./index.css">
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`,
      "index.css": `body { color: red; }`,
    });

    // First build
    const result1 = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      outdir: join(String(dir), "dist1"),
      naming: "[name]-[hash].[ext]",
    });

    expect(result1.success).toBe(true);

    // Find HTML output
    const htmlOutput1 = result1.outputs.find(o => o.path.endsWith(".html"));
    expect(htmlOutput1).toBeDefined();
    const htmlPath1 = htmlOutput1!.path;
    const htmlHash1 = htmlPath1.match(/index-([a-z0-9]+)\.html/)?.[1];
    expect(htmlHash1).toBeDefined();

    // Modify CSS
    await Bun.write(join(String(dir), "index.css"), `body { color: blue; }`);

    // Second build
    const result2 = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      outdir: join(String(dir), "dist2"),
      naming: "[name]-[hash].[ext]",
    });

    expect(result2.success).toBe(true);

    // Find HTML output
    const htmlOutput2 = result2.outputs.find(o => o.path.endsWith(".html"));
    expect(htmlOutput2).toBeDefined();
    const htmlPath2 = htmlOutput2!.path;
    const htmlHash2 = htmlPath2.match(/index-([a-z0-9]+)\.html/)?.[1];
    expect(htmlHash2).toBeDefined();

    // Check if HTML hash changed when CSS changed
    expect(htmlHash1).not.toBe(htmlHash2);
  });

  test("HTML chunk hash should not change when dependencies don't change", async () => {
    using dir = tempDir("html-hash-stable-test", {
      "index.html": `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
  <link rel="stylesheet" href="./index.css">
  <script type="module" src="./index.js"></script>
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`,
      "index.js": `console.log("stable");`,
      "index.css": `body { color: green; }`,
    });

    // First build
    const result1 = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      outdir: join(String(dir), "dist1"),
      naming: "[name]-[hash].[ext]",
    });

    expect(result1.success).toBe(true);

    // Second build without any changes
    const result2 = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      outdir: join(String(dir), "dist2"),
      naming: "[name]-[hash].[ext]",
    });

    expect(result2.success).toBe(true);

    // Find HTML outputs
    const htmlOutput1 = result1.outputs.find(o => o.path.endsWith(".html"));
    const htmlOutput2 = result2.outputs.find(o => o.path.endsWith(".html"));

    expect(htmlOutput1).toBeDefined();
    expect(htmlOutput2).toBeDefined();

    const htmlHash1 = htmlOutput1!.path.match(/index-([a-z0-9]+)\.html/)?.[1];
    const htmlHash2 = htmlOutput2!.path.match(/index-([a-z0-9]+)\.html/)?.[1];

    // Hashes should be the same when nothing changes
    expect(htmlHash1).toBe(htmlHash2);
  });
});
