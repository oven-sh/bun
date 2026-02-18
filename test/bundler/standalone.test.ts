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

  test("deep import chain with re-exports and multiple files", async () => {
    using dir = tempDir("compile-browser-deep-chain", {
      "index.html": `<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>`,
      "app.js": `import { renderApp } from "./components/App.js";
import { initRouter } from "./router/index.js";
import { createStore } from "./store/index.js";

const store = createStore({ count: 0 });
initRouter(store);
renderApp(store);`,
      "components/App.js": `import { Header } from "./Header.js";
import { Footer } from "./Footer.js";
import { Counter } from "./Counter.js";

export function renderApp(store) {
  document.body.innerHTML = Header() + Counter(store) + Footer();
}`,
      "components/Header.js": `import { APP_NAME } from "../config.js";
export function Header() { return "<header>" + APP_NAME + "</header>"; }`,
      "components/Footer.js": `import { APP_VERSION } from "../config.js";
export function Footer() { return "<footer>v" + APP_VERSION + "</footer>"; }`,
      "components/Counter.js": `import { formatNumber } from "../utils/format.js";
export function Counter(store) {
  return "<div>Count: " + formatNumber(store.count) + "</div>";
}`,
      "router/index.js": `import { parseRoute } from "./parser.js";
import { matchRoute } from "./matcher.js";
export function initRouter(store) {
  const route = parseRoute(window.location.pathname);
  matchRoute(route, store);
}`,
      "router/parser.js": `export function parseRoute(path) {
  return path.split("/").filter(Boolean);
}`,
      "router/matcher.js": `import { log } from "../utils/logger.js";
export function matchRoute(route, store) {
  log("Matching route: " + route.join("/"));
}`,
      "store/index.js": `import { log } from "../utils/logger.js";
export function createStore(initial) {
  log("Store created");
  return { ...initial };
}`,
      "utils/format.js": `export function formatNumber(n) { return n.toLocaleString(); }`,
      "utils/logger.js": `export function log(msg) { console.log("[LOG] " + msg); }`,
      "config.js": `export const APP_NAME = "MyApp";
export const APP_VERSION = "1.0.0";`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const html = await result.outputs[0].text();
    // All modules from the deep chain should be bundled
    expect(html).toContain("MyApp");
    expect(html).toContain("1.0.0");
    expect(html).toContain("renderApp");
    expect(html).toContain("initRouter");
    expect(html).toContain("createStore");
    expect(html).toContain("formatNumber");
    expect(html).toContain("[LOG]");
    // Single output, no external refs
    expect(html).not.toContain('src="');
    expect(html).toContain('<script type="module">');
  });

  test("CSS imported from JS and via link tag (deduplicated)", async () => {
    using dir = tempDir("compile-browser-css-dedup", {
      "index.html": `<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="./shared.css"></head>
<body><script src="./app.js"></script></body>
</html>`,
      "app.js": `import "./shared.css";
import "./components.css";
console.log("app with css");`,
      "shared.css": `body { margin: 0; font-family: sans-serif; }`,
      "components.css": `@import "./buttons.css";
.card { border: 1px solid #ccc; padding: 16px; }`,
      "buttons.css": `.btn { padding: 8px 16px; cursor: pointer; }
.btn-primary { background: #007bff; color: white; }`,
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
    expect(html).toContain("</style>");
    // shared.css content
    expect(html).toContain("font-family:");
    expect(html).toContain("sans-serif");
    // components.css content
    expect(html).toContain(".card");
    expect(html).toContain("padding:");
    // nested buttons.css content
    expect(html).toContain(".btn");
    expect(html).toContain(".btn-primary");
    expect(html).toContain("cursor: pointer");
    // JS should be inlined
    expect(html).toContain('console.log("app with css")');
    // No external refs
    expect(html).not.toContain('href="');
    expect(html).not.toContain("@import");
  });

  test("nested CSS @import chain", async () => {
    using dir = tempDir("compile-browser-css-chain", {
      "index.html": `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="./main.css"></head><body></body></html>`,
      "main.css": `@import "./base.css";
body { color: blue; }`,
      "base.css": `@import "./reset.css";
* { box-sizing: border-box; }`,
      "reset.css": `html, body { margin: 0; padding: 0; }`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const html = await result.outputs[0].text();
    expect(html).toContain("<style>");
    // All three CSS files bundled together
    expect(html).toContain("margin: 0");
    expect(html).toContain("padding: 0");
    expect(html).toContain("box-sizing: border-box");
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

  test("Bun.build() with outdir and image assets", async () => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4DwAAAQEABRjYTgAAAABJRU5ErkJggg==",
      "base64",
    );

    using dir = tempDir("compile-browser-outdir-assets", {
      "index.html": `<!DOCTYPE html>
<html><body><img src="./logo.png"><script src="./app.js"></script></body></html>`,
      "logo.png": pixel,
      "app.js": `console.log("outdir with assets");`,
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

    expect(existsSync(`${outdir}/index.html`)).toBe(true);

    const html = await Bun.file(`${outdir}/index.html`).text();
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('console.log("outdir with assets")');
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

  test("non-HTML entrypoints with compile+browser falls back to normal compile", async () => {
    using dir = tempDir("compile-browser-no-html", {
      "app.js": `console.log("no html");`,
    });

    // compile: true + target: "browser" with non-HTML entrypoints should
    // fall back to normal bun executable compile (not standalone HTML)
    const result = await Bun.build({
      entrypoints: [`${dir}/app.js`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
  });

  test("CLI --compile --target=browser with non-HTML falls back to normal compile", async () => {
    using dir = tempDir("compile-browser-cli-no-html", {
      "app.js": `console.log("test");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--target=browser", `${dir}/app.js`],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Non-HTML entrypoints with --compile --target=browser should fall back to normal bun compile
    expect(exitCode).toBe(0);
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

  test("malformed HTML without closing tags still inlines JS and CSS", async () => {
    // This tests the cold fallback path when no </head>, </body>, or </html> tags exist.
    // The document is just a fragment - the loader must still inject both CSS and JS.
    using dir = tempDir("compile-browser-malformed", {
      "index.html": `<div id="app"></div><link rel="stylesheet" href="./style.css"><script src="./app.js"></script>`,
      "style.css": `#app { color: green; }`,
      "app.js": `console.log("malformed html");`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.html`],
      compile: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const html = await result.outputs[0].text();
    // CSS should be inlined
    expect(html).toContain("<style>");
    expect(html).toContain("color: green");
    // JS should also be inlined (this was the bug - JS was dropped in fallback path)
    expect(html).toContain('<script type="module">');
    expect(html).toContain('console.log("malformed html")');
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
