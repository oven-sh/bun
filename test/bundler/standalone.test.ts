import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { SourceMapConsumer } from "source-map";

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

    // compile + target: "browser" with non-HTML entrypoints should
    // fall back to normal bun executable compile (not standalone HTML)
    const result = await Bun.build({
      entrypoints: [`${dir}/app.js`],
      compile: { outfile: `${dir}/app` },
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(existsSync(`${dir}/app${isWindows ? ".exe" : ""}`)).toBe(true);
  });

  test("CLI --compile --target=browser with non-HTML falls back to normal compile", async () => {
    using dir = tempDir("compile-browser-cli-no-html", {
      "app.js": `console.log("test");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--target=browser", `${dir}/app.js`],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Non-HTML entrypoints with --compile --target=browser should fall back to normal bun compile
    expect(exitCode).toBe(0);
    expect(existsSync(`${dir}/app${isWindows ? ".exe" : ""}`)).toBe(true);
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

  // A <meta http-equiv="Content-Security-Policy"> written for the multi-file
  // site (`'self'`) blocks the inline <script>/<style> and data: URLs the
  // standalone document is made of. The policy is rewritten with a hash per
  // inline block and `data:` for the kinds of asset that were inlined.
  describe.concurrent("Content-Security-Policy meta", () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const sha256 = (text: string) => `'sha256-${new Bun.CryptoHasher("sha256").update(text).digest("base64")}'`;
    const policies = (html: string) =>
      [...html.matchAll(/http-equiv="content-security-policy"\s+content="([^"]*)"/gi)].map(m => m[1]);
    const inlineScript = (html: string) => /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const inlineStyle = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];

    async function buildStandalone(dir: string) {
      const result = await Bun.build({
        entrypoints: [`${dir}/index.html`],
        compile: true,
        target: "browser",
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      return { html: await result.outputs[0].text(), logs: result.logs };
    }

    test("default-src 'self' gets a directive per kind of inlined content", async () => {
      using dir = tempDir("compile-browser-csp-default-src", {
        "index.html": `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<link rel="stylesheet" href="./a.css"></head>
<body><img src="./i.png"><script type="module" src="./app.js"></script></body></html>`,
        "a.css": `body { background: rgb(1, 2, 3) }`,
        "i.png": png,
        "app.js": `document.documentElement.setAttribute("data-ran", "1");`,
      });

      const { html, logs } = await buildStandalone(String(dir));
      const script = inlineScript(html)!;
      const style = inlineStyle(html)!;
      expect(script).toContain("data-ran");
      expect(style).toContain("background");
      expect(html).toContain('<img src="data:image/png;base64,');

      // default-src itself stays as written so everything else still
      // inherits 'self'; each kind of inlined content gets its own directive.
      expect(policies(html)).toEqual([
        `default-src 'self'; script-src 'self' ${sha256(script)}; style-src 'self' ${sha256(style)}; img-src 'self' data:`,
      ]);
      // The build says what it added.
      expect(logs.map(log => log.level)).toEqual(["note"]);
      expect(logs[0].message).toEndWith(
        `index.html: added ${sha256(script)} to script-src, ${sha256(style)} to style-src, data: to img-src in its <meta http-equiv="Content-Security-Policy"> for the content this build inlined`,
      );
    });

    test("existing directives are extended in place and satisfied ones are left alone", async () => {
      using dir = tempDir("compile-browser-csp-existing", {
        "index.html": `<!doctype html><html><head>
<meta http-equiv="content-security-policy" content=" Script-Src 'self' https://cdn.example.com ;style-src 'unsafe-inline'; img-src * ; font-src 'self' data:; media-src 'none'; manifest-src ;;">
<link rel="stylesheet" href="./a.css"><link rel="manifest" href="./app.webmanifest"></head>
<body><video src="./v.mp4"></video><script src="./app.js"></script></body></html>`,
        "a.css": `@font-face { font-family: f; src: url(./f.woff2); } body { background: url("./i.png"); }`,
        "f.woff2": "not really a font",
        "i.png": png,
        "v.mp4": "not really a video",
        "app.webmanifest": `{ "name": "app" }`,
        "app.js": `console.log("app");`,
      });

      const { html } = await buildStandalone(String(dir));
      const script = inlineScript(html)!;
      expect(html).toContain('url("data:font/woff2;base64,');
      expect(html).toContain('url("data:image/png;base64,');
      expect(html).toContain('<video src="data:video/mp4;base64,');
      expect(html).toContain('<link rel="manifest" href="data:application/manifest+json;base64,');

      // script-src: hash appended (directive names are case-insensitive).
      // style-src: 'unsafe-inline' already allows the <style>.
      // img-src: `*` does not match data:, so it is added.
      // font-src: already lists data:.
      // media-src 'none', manifest-src with no sources: blocked on the
      // multi-file site too, so they stay that way.
      expect(policies(html)).toEqual([
        `Script-Src 'self' https://cdn.example.com ${sha256(script)}; style-src 'unsafe-inline'; img-src * data:; font-src 'self' data:; media-src 'none'; manifest-src`,
      ]);
    });

    test("a nonce or hash next to 'unsafe-inline' still needs the hash", async () => {
      using dir = tempDir("compile-browser-csp-nonce", {
        "index.html": `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' 'nonce-abc123'">
</head><body><script nonce="abc123" src="./app.js"></script></body></html>`,
        "app.js": `console.log("app");`,
      });

      const { html } = await buildStandalone(String(dir));
      const script = inlineScript(html)!;
      // Browsers ignore 'unsafe-inline' when a nonce or hash is present.
      expect(policies(html)).toEqual([`script-src 'unsafe-inline' 'nonce-abc123' ${sha256(script)}`]);
    });

    test("the hash covers the escaped <\\/script> text the browser sees", async () => {
      using dir = tempDir("compile-browser-csp-escape", {
        "index.html": `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'self'">
</head><body><script src="./app.js"></script></body></html>`,
        "app.js": `document.title = "</script><script>alert(1)</script>";`,
      });

      const { html } = await buildStandalone(String(dir));
      expect(html.split("</script>").length - 1).toBe(1);
      const script = inlineScript(html)!;
      expect(script).toContain("<\\/script>");
      expect(policies(html)).toEqual([`script-src 'self' ${sha256(script)}`]);
    });

    test("every policy in the document is rewritten, other http-equiv metas are not", async () => {
      using dir = tempDir("compile-browser-csp-multiple", {
        "index.html": `<!doctype html><html><head>
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; img-src 'self'; report-uri /csp?a=1&amp;b=2">
<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'strict-dynamic'">
</head><body><img><script src="./app.js"></script></body></html>`,
        "app.js": `import logo from "./logo.png";
document.querySelector("img").src = logo;`,
        "logo.png": png,
      });

      const { html } = await buildStandalone(String(dir));
      const script = inlineScript(html)!;
      // An image that only JS references still becomes a data: URL.
      expect(script).toContain('"data:image/png;base64,');
      expect(html).toContain('<meta http-equiv="X-UA-Compatible" content="IE=edge">');
      expect(policies(html)).toEqual([
        `default-src 'none'; script-src 'self' ${sha256(script)}; img-src 'self' data:; report-uri /csp?a=1&amp;b=2`,
        `script-src 'self' 'strict-dynamic' ${sha256(script)}`,
      ]);
    });

    test("a policy that does not restrict the inlined content is left as written", async () => {
      using dir = tempDir("compile-browser-csp-unrelated", {
        "index.html": `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content=" upgrade-insecure-requests;;object-src  'none' ">
</head><body><script src="./app.js"></script></body></html>`,
        "app.js": `console.log("app");`,
      });
      const { html, logs } = await buildStandalone(String(dir));
      expect(policies(html)).toEqual([` upgrade-insecure-requests;;object-src  'none' `]);
      expect(logs).toEqual([]);
    });

    test("character references in the attribute are decoded before the policy is read", async () => {
      using dir = tempDir("compile-browser-csp-entities", {
        // What a server-side renderer that escapes `'` leaves behind.
        "index.html": `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src &#x27;self&#x27;; style-src &#39;unsafe-inline&#39;; script-src 'self' &quot;; report-uri /csp?a&##;b&amp;c&bogus;">
<link rel="stylesheet" href="./a.css"></head><body><script src="./app.js"></script></body></html>`,
        "a.css": `body { color: red }`,
        "app.js": `console.log("app");`,
      });
      const { html } = await buildStandalone(String(dir));
      const script = inlineScript(html)!;
      // 'unsafe-inline' is recognized through the references, so style-src
      // gets no hash (a hash would turn 'unsafe-inline' off). The rewritten
      // value is re-escaped for the double-quoted attribute. `&` sequences
      // that are not a reference stay literal text, so their `;` separates
      // directives like any other.
      expect(policies(html)).toEqual([
        `default-src 'self'; style-src 'unsafe-inline'; script-src 'self' &quot; ${sha256(script)}; report-uri /csp?a&amp;##; b&amp;c&amp;bogus`,
      ]);
    });

    test("a non-standalone HTML build leaves the policy alone", async () => {
      using dir = tempDir("compile-browser-csp-regular-build", {
        "index.html": `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
</head><body><script src="./app.js"></script></body></html>`,
        "app.js": `console.log("app");`,
      });

      const result = await Bun.build({
        entrypoints: [`${dir}/index.html`],
        outdir: `${dir}/out`,
      });
      expect(result.success).toBe(true);
      const html = await Bun.file(result.outputs.find(o => o.path.endsWith(".html"))!.path).text();
      expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`);
    });
  });

  // https://github.com/oven-sh/bun/issues/32114
  describe.concurrent("sourcemaps", () => {
    const fixture = {
      "index.html": `<!DOCTYPE html>
<html>
<head><title>Test</title><link rel="stylesheet" href="./style.css"></head>
<body><script src="./index.ts"></script></body>
</html>`,
      "index.ts": `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
console.log(greet("world"));`,
      "style.css": `body { color: red; }`,
    };

    async function buildWithSourcemap(dir: string, outdir: string, sourcemap: string) {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--target=browser",
          `--sourcemap=${sourcemap}`,
          `${dir}/index.html`,
          "--outdir",
          outdir,
        ],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return stdout;
    }

    test("CLI --sourcemap=linked writes a .map file and links it from the inline script", async () => {
      using dir = tempDir("compile-browser-sourcemap-linked", fixture);
      const outdir = `${dir}/dist`;
      await buildWithSourcemap(String(dir), outdir, "linked");

      const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: outdir })).sort();
      expect(files).toHaveLength(2);
      expect(files).toContain("index.html");
      const mapFile = files.find(f => f.endsWith(".js.map"))!;
      expect(mapFile).toMatch(/^index-[0-9a-z]+\.js\.map$/);

      // The inline <script> must reference the .map file relative to the HTML document.
      const html = await Bun.file(`${outdir}/index.html`).text();
      expect(html).toContain(`//# sourceMappingURL=./${mapFile}\n</script>`);

      const map = await Bun.file(`${outdir}/${mapFile}`).json();
      expect(map.version).toBe(3);
      expect(map.sources.some((s: string) => s.endsWith("index.ts"))).toBe(true);
      expect(map.sourcesContent.join("\n")).toContain("function greet(name: string): string {");
      expect(typeof map.mappings).toBe("string");
      expect(map.mappings.length).toBeGreaterThan(0);
    });

    test("CLI --sourcemap=inline embeds a data: URL sourcemap in the inline script", async () => {
      using dir = tempDir("compile-browser-sourcemap-inline", fixture);
      const outdir = `${dir}/dist`;
      await buildWithSourcemap(String(dir), outdir, "inline");

      // Still a single self-contained file.
      const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: outdir }));
      expect(files).toEqual(["index.html"]);

      const html = await Bun.file(`${outdir}/index.html`).text();
      const match = html.match(/\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/);
      expect(match).not.toBeNull();
      const map = JSON.parse(Buffer.from(match![1], "base64").toString("utf8"));
      expect(map.version).toBe(3);
      expect(map.sources.some((s: string) => s.endsWith("index.ts"))).toBe(true);
      expect(map.sourcesContent.join("\n")).toContain("function greet(name: string): string {");
      expect(map.mappings.length).toBeGreaterThan(0);
    });

    test("CLI --sourcemap=external writes a .map file without a sourceMappingURL comment", async () => {
      using dir = tempDir("compile-browser-sourcemap-external", fixture);
      const outdir = `${dir}/dist`;
      await buildWithSourcemap(String(dir), outdir, "external");

      const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: outdir })).sort();
      expect(files).toHaveLength(2);
      expect(files).toContain("index.html");
      const mapFile = files.find(f => f.endsWith(".js.map"))!;
      expect(mapFile).toMatch(/^index-[0-9a-z]+\.js\.map$/);

      const html = await Bun.file(`${outdir}/index.html`).text();
      expect(html).not.toContain("sourceMappingURL");

      const map = await Bun.file(`${outdir}/${mapFile}`).json();
      expect(map.version).toBe(3);
      expect(map.sourcesContent.join("\n")).toContain("function greet(name: string): string {");
    });

    test("Bun.build() with sourcemap: 'linked' returns the sourcemap artifact", async () => {
      using dir = tempDir("compile-browser-sourcemap-api", fixture);

      const result = await Bun.build({
        entrypoints: [`${dir}/index.html`],
        compile: true,
        target: "browser",
        sourcemap: "linked",
      });

      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(2);
      const htmlOutput = result.outputs.find(o => o.loader === "html");
      const mapOutput = result.outputs.find(o => o.kind === "sourcemap");
      expect(htmlOutput).toBeDefined();
      expect(mapOutput).toBeDefined();

      const html = await htmlOutput!.text();
      expect(html).toContain("//# sourceMappingURL=");

      const map = JSON.parse(await mapOutput!.text());
      expect(map.version).toBe(3);
      expect(map.sourcesContent.join("\n")).toContain("function greet(name: string): string {");
    });

    test("Bun.build() with sourcemap: 'inline' keeps a single HTML output", async () => {
      using dir = tempDir("compile-browser-sourcemap-api-inline", fixture);

      const result = await Bun.build({
        entrypoints: [`${dir}/index.html`],
        compile: true,
        target: "browser",
        sourcemap: "inline",
      });

      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(1);
      expect(result.outputs[0].loader).toBe("html");

      const html = await result.outputs[0].text();
      expect(html).toContain("//# sourceMappingURL=data:application/json;base64,");
    });

    // Standalone HTML is assembled in two passes: each script and stylesheet
    // chunk is resolved on its own first (asset references become data: URIs,
    // and when a source map is being emitted the chunk's map is corrected for
    // them and the chunk gets a debugId), then the HTML chunk inlines the
    // results. The document itself never has a source map, so nothing may be
    // appended to it.
    const assetFixture = {
      "index.html": `<!DOCTYPE html>\n<html>\n<body>\n<script type="module" src="./app.js"></script>\n</body>\n</html>\n`,
      "app.js": `import pic from "./pic.svg";\nexport function greet(name) {\n  return name + pic;\n}\nconsole.log(greet("x"));\n`,
      "pic.svg": `<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>\n`,
    };

    async function buildWithAsset(dir: string, options: { sourcemap: "none" | "linked"; outdir?: string }) {
      const result = await Bun.build({
        entrypoints: [`${dir}/index.html`],
        compile: true,
        target: "browser",
        // Puts the whole script on one line, so the data: URI written over the
        // asset placeholder shifts the columns of everything after it.
        minify: { whitespace: true },
        ...options,
      });
      expect(result.logs).toBeEmpty();
      const html = await result.outputs.find(o => o.loader === "html")!.text();
      const map = result.outputs.find(o => o.kind === "sourcemap");
      return { html, map: map && JSON.parse(await map.text()) };
    }

    async function expectInlinedScriptToBeMapped(html: string, map: object) {
      const open = '<script type="module">';
      const script = html.slice(html.indexOf(open) + open.length, html.indexOf("</script>"));
      const [firstLine] = script.split("\n");
      const column = firstLine.indexOf("function greet");
      expect(column).toBeGreaterThan(firstLine.indexOf('"data:image/svg+xml'));
      const original = await SourceMapConsumer.with(map, null, consumer =>
        consumer.originalPositionFor({ line: 1, column }),
      );
      expect({ line: original.line, column: original.column }).toEqual({
        line: 2,
        column: assetFixture["app.js"].split("\n")[1].indexOf("function greet"),
      });
    }

    test("without a sourcemap option, nothing source map related is written into the document", async () => {
      using dir = tempDir("compile-browser-asset-no-sourcemap", assetFixture);
      const { html, map } = await buildWithAsset(String(dir), { sourcemap: "none" });
      expect(map).toBeUndefined();
      expect(html).toContain('"data:image/svg+xml');
      expect(html).not.toContain("debugId");
      expect(html).not.toContain("sourceMappingURL");
      expect(html).toEndWith("</html>\n");
    });

    test("the inlined script's map accounts for the data: URI written over its asset import", async () => {
      using dir = tempDir("compile-browser-asset-sourcemap", assetFixture);
      const { html, map } = await buildWithAsset(String(dir), { sourcemap: "linked" });
      // The script carries the debugId; the document around it gets nothing appended.
      expect(html.match(/\/\/# debugId=/g)).toHaveLength(1);
      expect(html.indexOf("//# debugId=")).toBeLessThan(html.indexOf("</script>"));
      expect(html).toEndWith("</html>\n");
      await expectInlinedScriptToBeMapped(html, map);
    });

    test("writing to an outdir inlines and maps the script the same way as an in-memory build", async () => {
      using dir = tempDir("compile-browser-asset-sourcemap-outdir", assetFixture);
      const { html, map } = await buildWithAsset(String(dir), { sourcemap: "linked", outdir: `${dir}/dist` });
      expect(await Bun.file(`${dir}/dist/index.html`).text()).toBe(html);
      expect(html.match(/\/\/# debugId=/g)).toHaveLength(1);
      expect(html).toEndWith("</html>\n");
      await expectInlinedScriptToBeMapped(html, map);
    });
  });
});
