import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
    // CSS should be inlined in <style> tags
    expect(html).toContain("<style>");
    expect(html).toContain("color: red");
    expect(html).toContain("</style>");
    // JS should be inlined in <script> tags (not as src="...")
    expect(html).toContain("<script>");
    expect(html).toContain('console.log("hello")');
    expect(html).toContain("</script>");
    // Should NOT have external references
    expect(html).not.toContain('src="');
    expect(html).not.toContain('href="');
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
    // Image should be a data: URI
    expect(html).toContain('src="data:image/png;base64,');
    // JS should be inlined
    expect(html).toContain('console.log("with image")');
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

  test("JS-only HTML works", async () => {
    using dir = tempDir("compile-browser-js-only", {
      "index.html": `<!DOCTYPE html>
<html><body><h1>Hello</h1><script src="./app.js"></script></body></html>`,
      "app.js": `document.querySelector("h1").textContent = "World";`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const html = await result.outputs[0].text();
    expect(html).toContain("<script>");
    expect(html).toContain("World");
    expect(html).not.toContain('src="');
  });

  test("CSS-only HTML works", async () => {
    using dir = tempDir("compile-browser-css-only", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./style.css"></head><body></body></html>`,
      "style.css": `body { margin: 0; padding: 10px; }`,
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
    expect(html).toContain("margin: 0");
    expect(html).toContain("padding: 10px");
    expect(html).not.toContain('href="');
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

    expect(exitCode).toBe(0);

    // Check only HTML file exists in output
    const glob = new Bun.Glob("**/*");
    const files = Array.from(glob.scanSync({ cwd: outdir }));
    expect(files).toEqual(["index.html"]);

    // Verify content
    const html = await Bun.file(`${outdir}/index.html`).text();
    expect(html).toContain("<style>");
    expect(html).toContain("font-weight: bold");
    expect(html).toContain("<script>");
    expect(html).toContain('console.log("cli test")');
  });

  test("handles CSS url() references", async () => {
    // Tiny 1x1 PNG
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
    // CSS should contain data: URI for the background image
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("<style>");
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
    // Minified CSS should be more compact
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
    // Minified JS
    expect(html).toContain("<script>");
    expect(html).toContain("</script>");
  });
});
