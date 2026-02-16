import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";

describe("compile --target=browser", () => {
  test("inlines JS and CSS into HTML", async () => {
    using dir = tempDir("compile-browser-basic", {
      "index.html": `<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="./style.css"></head>
<body><script src="./app.js"></script></body>
</html>`,
      "style.css": `body { color: red; }`,
      "app.js": `console.log("hello");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].loader).toBe("html");

    const html = await result.outputs[0].text();
    expect(html).toContain("<style>");
    expect(html).toContain("color: red");
    expect(html).toContain("</style>");
    expect(html).toContain('<script type="module">');
    expect(html).toContain('console.log("hello")');
    expect(html).toContain("</script>");
    // Should NOT have external references
    expect(html).not.toContain('src="');
    expect(html).not.toContain('href="');
  });

  test("uses type=module on inline scripts", async () => {
    using dir = tempDir("compile-browser-module", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `console.log("module");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const html = await result.outputs[0].text();
    expect(html).toContain('<script type="module">');
    expect(html).not.toMatch(/<script>(?!<)/);
  });

  test("top-level await works with inline scripts", async () => {
    using dir = tempDir("compile-browser-tla", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `const data = await Promise.resolve(42);
console.log(data);`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const html = await result.outputs[0].text();
    expect(html).toContain('<script type="module">');
    expect(html).toContain("await");
  });

  test("escapes </script> in inlined JS", async () => {
    using dir = tempDir("compile-browser-escape-script", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `const x = "</script>";
console.log(x);`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const html = await result.outputs[0].text();
    // The literal </script> inside JS must be escaped so it doesn't close the tag
    // Count actual </script> occurrences - should be exactly 1 (the closing tag)
    const scriptCloseCount = html.split("</script>").length - 1;
    expect(scriptCloseCount).toBe(1);
    // The escaped version should be present
    expect(html).toContain("<\\/script>");
  });

  test("escapes </style> in inlined CSS", async () => {
    using dir = tempDir("compile-browser-escape-style", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./style.css"></head><body></body></html>`,
      "style.css": `body::after { content: "</style>"; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const html = await result.outputs[0].text();
    // The literal </style> inside CSS must be escaped
    const styleCloseCount = html.split("</style>").length - 1;
    expect(styleCloseCount).toBe(1);
  });

  test("bundles multiple nested imports into single inline script", async () => {
    using dir = tempDir("compile-browser-nested", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `import { greet } from "./utils.js";
import { format } from "./format.js";
console.log(format(greet("world")));`,
      "utils.js": `export function greet(name) { return "Hello, " + name; }`,
      "format.js": `export function format(msg) { return "[" + msg + "]"; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const html = await result.outputs[0].text();
    // All modules should be bundled and inlined
    expect(html).toContain("Hello, ");
    expect(html).toContain("greet");
    expect(html).toContain("format");
    // Only one script tag
    expect(html).not.toContain('src="');
  });

  test("CSS imported from JS is inlined", async () => {
    using dir = tempDir("compile-browser-css-from-js", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `import "./style.css";
console.log("styled");`,
      "style.css": `body { background: green; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const html = await result.outputs[0].text();
    expect(html).toContain("<style>");
    expect(html).toContain("background:");
    expect(html).toContain("green");
    expect(html).toContain("</style>");
    expect(html).toContain('console.log("styled")');
  });

  test("nested CSS @import is inlined", async () => {
    using dir = tempDir("compile-browser-css-import", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./main.css"></head><body></body></html>`,
      "main.css": `@import "./base.css";
body { color: blue; }`,
      "base.css": `* { margin: 0; box-sizing: border-box; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const html = await result.outputs[0].text();
    expect(html).toContain("<style>");
    // Both CSS files should be bundled together
    expect(html).toContain("margin: 0");
    expect(html).toContain("box-sizing: border-box");
    // CSS bundler may normalize color values (e.g., blue -> #00f)
    expect(html).toMatch(/color:?\s*(blue|#00f)/);
    expect(html).not.toContain("@import");
  });

  test("Bun.build() with outdir writes files to disk", async () => {
    using dir = tempDir("compile-browser-outdir", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./style.css"></head>
<body><script src="./app.js"></script></body></html>`,
      "style.css": `h1 { font-weight: bold; }`,
      "app.js": `console.log("outdir test");`,
    });

    const outdir = `${dir}/dist`;
    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
      outdir,
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    // Verify the file was actually written to disk
    expect(existsSync(`${outdir}/index.html`)).toBe(true);

    const html = await Bun.file(`${outdir}/index.html`).text();
    expect(html).toContain("<style>");
    expect(html).toContain("font-weight: bold");
    expect(html).toContain('<script type="module">');
    expect(html).toContain('console.log("outdir test")');
  });

  test("inlines images as data: URIs", async () => {
    // 1x1 red PNG
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4DwAAAQEABRjYTgAAAABJRU5ErkJggg==",
      "base64",
    );

    using dir = tempDir("compile-browser-image", {
      "index.html": `<!DOCTYPE html>
<html><body><img src="./pixel.png"><script src="./app.js"></script></body></html>`,
      "pixel.png": pixel,
      "app.js": `console.log("with image");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const html = await result.outputs[0].text();
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('console.log("with image")');
  });

  test("handles CSS url() references", async () => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4DwAAAQEABRjYTgAAAABJRU5ErkJggg==",
      "base64",
    );

    using dir = tempDir("compile-browser-css-url", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./style.css"></head><body></body></html>`,
      "style.css": `body { background: url("./bg.png") no-repeat; }`,
      "bg.png": pixel,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const html = await result.outputs[0].text();
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("<style>");
  });

  test("fails with non-HTML entrypoints", async () => {
    using dir = tempDir("compile-browser-no-html", {
      "app.js": `console.log("no html");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: [`${dir}/app.js`],
        compile: true,
        target: "browser",
      }),
    ).toThrow();
  });

  test("fails with mixed HTML and non-HTML entrypoints", async () => {
    using dir = tempDir("compile-browser-mixed", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `console.log("test");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: [`${dir}/index.html`, `${dir}/app.js`],
        compile: true,
        target: "browser",
      }),
    ).toThrow();
  });

  test("fails with splitting", async () => {
    using dir = tempDir("compile-browser-splitting", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `console.log("test");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: [`${dir}/index.html`],
        compile: true,
        target: "browser",
        splitting: true,
      }),
    ).toThrow();
  });

  test("CLI --compile --target=browser produces single file", async () => {
    using dir = tempDir("compile-browser-cli", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./style.css"></head>
<body><script src="./app.js"></script></body></html>`,
      "style.css": `h1 { font-weight: bold; }`,
      "app.js": `console.log("cli test");`,
    });

    const outdir = `${dir}/out`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--target=browser", `${dir}/index.html`, "--outdir", outdir],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Check only HTML file exists in output
    const glob = new Bun.Glob("**/*");
    const files = Array.from(glob.scanSync({ cwd: outdir }));
    expect(files).toEqual(["index.html"]);

    // Verify content
    const html = await Bun.file(`${outdir}/index.html`).text();
    expect(html).toContain("<style>");
    expect(html).toContain("font-weight: bold");
    expect(html).toContain('<script type="module">');
    expect(html).toContain('console.log("cli test")');

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("minification works", async () => {
    using dir = tempDir("compile-browser-minify", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./style.css"></head>
<body><script src="./app.js"></script></body></html>`,
      "style.css": `body {
  color: red;
  background: blue;
}`,
      "app.js": `const message = "hello world";
console.log(message);`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
      minify: true,
    });

    expect(result.success).toBe(true);

    const html = await result.outputs[0].text();
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
    expect(html).toContain('<script type="module">');
    expect(html).toContain("</script>");
  });
});
