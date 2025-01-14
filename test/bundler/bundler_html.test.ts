import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Basic test for bundling HTML with JS and CSS
  itBundled("html/basic", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
    <script src="./script.js"></script>
  </head>
  <body>
    <h1>Hello World</h1>
  </body>
</html>`,
      "/styles.css": "body { background-color: red; }",
      "/script.js": "console.log('Hello World')",
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],

    onAfterBundle(api) {
      // Check that output HTML references hashed filenames
      api.expectFile("out/index.html").not.toContain("styles.css");
      api.expectFile("out/index.html").not.toContain("script.js");
      api.expectFile("out/index.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/index.html").toMatch(/src=".*\.js"/);
    },
  });

  // Test relative paths without "./" in script src
  itBundled("html/implicit-relative-paths", {
    outdir: "out/",
    files: {
      "/src/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="styles.css">
    <script src="script.js"></script>
  </head>
  <body>
    <h1>Hello World</h1>
  </body>
</html>`,
      "/src/styles.css": "body { background-color: red; }",
      "/src/script.js": "console.log('Hello World')",
    },
    experimentalHtml: true,
    experimentalCss: true,
    root: "/src",
    entryPoints: ["/src/index.html"],

    onAfterBundle(api) {
      // Check that output HTML references hashed filenames
      api.expectFile("out/index.html").not.toContain("styles.css");
      api.expectFile("out/index.html").not.toContain("script.js");
      api.expectFile("out/index.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/index.html").toMatch(/src=".*\.js"/);
    },
  });

  // Test multiple script and style bundling
  itBundled("html/multiple-assets", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./style1.css">
    <link rel="stylesheet" href="./style2.css">
    <script src="./script1.js"></script>
    <script src="./script2.js"></script>
  </head>
  <body>
    <h1>Multiple Assets</h1>
  </body>
</html>`,
      "/style1.css": "body { color: blue; }",
      "/style2.css": "h1 { color: red; }",
      "/script1.js": "console.log('First script')",
      "/script2.js": "console.log('Second script')",
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // Should combine CSS files into one
      api.expectFile("out/index.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/index.html").not.toMatch(/href=".*style1\.css"/);
      api.expectFile("out/index.html").not.toMatch(/href=".*style2\.css"/);

      // Should combine JS files into one
      api.expectFile("out/index.html").toMatch(/src=".*\.js"/);
      api.expectFile("out/index.html").not.toMatch(/src=".*script1\.js"/);
      api.expectFile("out/index.html").not.toMatch(/src=".*script2\.js"/);
    },
  });

  // Test image hashing
  itBundled("html/image-hashing", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <body>
    <img src="./image.jpg" alt="Local image">
    <img src="https://example.com/image.jpg" alt="External image">
  </body>
</html>`,
      "/image.jpg": "fake image content",
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // Local image should be hashed
      api.expectFile("out/index.html").not.toContain("./image.jpg");
      api.expectFile("out/index.html").toMatch(/src=".*-[a-zA-Z0-9]+\.jpg"/);

      // External image URL should remain unchanged
      api.expectFile("out/index.html").toContain("https://example.com/image.jpg");
    },
  });

  // Test external assets preservation
  itBundled("html/external-assets", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="https://cdn.example.com/style.css">
    <script src="https://cdn.example.com/script.js"></script>
  </head>
  <body>
    <h1>External Assets</h1>
  </body>
</html>`,
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // External URLs should remain unchanged
      api.expectFile("out/index.html").toContain("https://cdn.example.com/style.css");
      api.expectFile("out/index.html").toContain("https://cdn.example.com/script.js");
    },
  });

  // Test mixed local and external assets
  itBundled("html/mixed-assets", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./local.css">
    <link rel="stylesheet" href="https://cdn.example.com/style.css">
    <script src="./local.js"></script>
    <script src="https://cdn.example.com/script.js"></script>
  </head>
  <body>
    <h1>Mixed Assets</h1>
    <img src="./local.jpg">
    <img src="https://cdn.example.com/image.jpg">
  </body>
</html>`,
      "/local.css": "body { margin: 0; }",
      "/local.js": "console.log('Local script')",
      "/local.jpg": "fake image content",
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // Local assets should be hashed
      api.expectFile("out/index.html").not.toContain("local.css");
      api.expectFile("out/index.html").not.toContain("local.js");
      api.expectFile("out/index.html").not.toContain("local.jpg");

      // External assets should remain unchanged
      api.expectFile("out/index.html").toContain("https://cdn.example.com/style.css");
      api.expectFile("out/index.html").toContain("https://cdn.example.com/script.js");
      api.expectFile("out/index.html").toContain("https://cdn.example.com/image.jpg");
    },
  });

  // Test JS imports
  itBundled("html/js-imports", {
    outdir: "out/",
    files: {
      "/in/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <script src="./main.js"></script>
  </head>
  <body>
    <h1>JS Imports</h1>
  </body>
</html>`,
      "/in/main.js": `
import { greeting } from './utils/strings.js';
import { formatDate } from './utils/date.js';
console.log(greeting('World'));
console.log(formatDate(new Date()));`,
      "/in/utils/strings.js": `
export const greeting = (name) => \`Hello, \${name}!\`;`,
      "/in/utils/date.js": `
import { padZero } from './numbers.js';
export const formatDate = (date) => \`\${date.getFullYear()}-\${padZero(date.getMonth() + 1)}-\${padZero(date.getDate())}\`;`,
      "/in/utils/numbers.js": `
export const padZero = (num) => String(num).padStart(2, '0');`,
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/in/index.html"],
    onAfterBundle(api) {
      // All JS should be bundled into one file
      api.expectFile("out/index.html").toMatch(/src=".*\.js"/);
      api.expectFile("out/index.html").not.toContain("main.js");

      const htmlContent = api.readFile("out/index.html");
      // Check that the bundle contains all the imported code
      const jsMatch = htmlContent.match(/src="(.*\.js)"/);
      const jsBundle = api.readFile("out/" + jsMatch![1]);
      expect(jsBundle).toContain("Hello");
      expect(jsBundle).toContain("padZero");
      expect(jsBundle).toContain("formatDate");
    },
  });

  // Test CSS imports
  itBundled("html/css-imports", {
    outdir: "out/",
    files: {
      "/in/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles/main.css">
  </head>
  <body>
    <h1>CSS Imports</h1>
  </body>
</html>`,
      "/in/styles/main.css": `
@import './variables.css';
@import './typography.css';
body {
  background-color: var(--background-color);
}`,
      "/in/styles/variables.css": `
:root {
  --background-color: #f0f0f0;
  --text-color: #333;
  --heading-color: #000;
}`,
      "/in/styles/typography.css": `
@import './fonts.css';
h1 {
  color: var(--heading-color);
  font-family: var(--heading-font);
}`,
      "/in/styles/fonts.css": `
:root {
  --heading-font: 'Arial', sans-serif;
  --body-font: 'Helvetica', sans-serif;
}`,
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/in/index.html"],
    onAfterBundle(api) {
      // All CSS should be bundled into one file
      api.expectFile("out/index.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/index.html").not.toContain("main.css");

      // Check that the bundle contains all the imported CSS
      const htmlContent = api.readFile("out/index.html");
      const cssMatch = htmlContent.match(/href="(.*?\.css)"/);
      if (!cssMatch) throw new Error("Could not find CSS file reference in HTML");
      const cssBundle = api.readFile("out/" + cssMatch[1]);
      expect(cssBundle).toContain("--background-color");
      expect(cssBundle).toContain("--heading-font");
      expect(cssBundle).toContain("font-family");
    },
  });

  // Test multiple HTML entry points
  itBundled("html/multiple-entries", {
    outdir: "out/",
    files: {
      "/in/pages/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="../styles/home.css">
    <script src="../scripts/home.js"></script>
  </head>
  <body>
    <h1>Home Page</h1>
    <a href="./about.html">About</a>
  </body>
</html>`,
      "/in/pages/about.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="../styles/about.css">
    <script src="../scripts/about.js"></script>
  </head>
  <body>
    <h1>About Page</h1>
    <a href="index.html">Home</a>
  </body>
</html>`,
      "/in/styles/home.css": `
@import './common.css';
.home { color: blue; }`,
      "/in/styles/about.css": `
@import './common.css';
.about { color: green; }`,
      "/in/styles/common.css": `
body { margin: 0; padding: 20px; }`,
      "/in/scripts/home.js": `
import { initNav } from './common.js';
console.log('Home page');
initNav();`,
      "/in/scripts/about.js": `
import { initNav } from './common.js';
console.log('About page');
initNav();`,
      "/in/scripts/common.js": `
export const initNav = () => console.log('Navigation initialized');`,
    },
    entryPoints: ["/in/pages/index.html", "/in/pages/about.html"],
    experimentalHtml: true,
    experimentalCss: true,
    onAfterBundle(api) {
      // Check index.html
      api.expectFile("out/index.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/index.html").toMatch(/src=".*\.js"/);
      api.expectFile("out/index.html").not.toContain("home.css");
      api.expectFile("out/index.html").not.toContain("home.js");

      // Check about.html
      api.expectFile("out/about.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/about.html").toMatch(/src=".*\.js"/);
      api.expectFile("out/about.html").not.toContain("about.css");
      api.expectFile("out/about.html").not.toContain("about.js");

      // Verify we don't update the filenames for these
      const indexHtml = api.readFile("out/index.html");
      const aboutHtml = api.readFile("out/about.html");
      expect(indexHtml).toContain('href="./about.html"');
      expect(aboutHtml).toContain('href="index.html"');

      // Check that each page has its own bundle
      const indexHtmlContent = api.readFile("out/index.html");
      const aboutHtmlContent = api.readFile("out/about.html");

      const indexJsMatch = indexHtmlContent.match(/src="(.*\.js)"/);
      const aboutJsMatch = aboutHtmlContent.match(/src="(.*\.js)"/);

      const indexJs = api.readFile("out/" + indexJsMatch![1]);
      const aboutJs = api.readFile("out/" + aboutJsMatch![1]);

      expect(indexJs).toContain("Home page");
      expect(aboutJs).toContain("About page");
      expect(indexJs).toContain("Navigation initialized");
      expect(aboutJs).toContain("Navigation initialized");

      // Check that each page has its own CSS bundle
      const indexCssMatch = indexHtmlContent.match(/href="(.*\.css)"/);
      const aboutCssMatch = aboutHtmlContent.match(/href="(.*\.css)"/);

      const indexCss = api.readFile("out/" + indexCssMatch![1]);
      const aboutCss = api.readFile("out/" + aboutCssMatch![1]);

      expect(indexCss).toContain(".home");
      expect(aboutCss).toContain(".about");
      expect(indexCss).toContain("margin: 0");
      expect(aboutCss).toContain("margin: 0");
    },
  });

  // Test multiple HTML entries with shared chunks
  itBundled("html/shared-chunks", {
    outdir: "out/",
    // Makes this test easier to write
    minifyWhitespace: true,

    files: {
      "/in/pages/page1.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="../styles/page1.css">
    <script src="../scripts/page1.js"></script>
  </head>
  <body>
    <h1>Page 1</h1>
  </body>
</html>`,
      "/in/pages/page2.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="../styles/page2.css">
    <script src="../scripts/page2.js"></script>
  </head>
  <body>
    <h1>Page 2</h1>
  </body>
</html>`,
      "/in/styles/page1.css": `
@import './shared.css';
.page1 { font-size: 20px; }`,
      "/in/styles/page2.css": `
@import './shared.css';
.page2 { font-size: 18px; }`,
      "/in/styles/shared.css": `
@import './reset.css';
.shared { color: blue; }`,
      "/in/styles/reset.css": `
* { box-sizing: border-box; }`,
      "/in/scripts/page1.js": `
import { sharedUtil } from './shared.js';
import { largeModule } from './large-module.js';
console.log('Page 1');
sharedUtil();`,
      "/in/scripts/page2.js": `
import { sharedUtil } from './shared.js';
import { largeModule } from './large-module.js';
console.log('Page 2');
sharedUtil();`,
      "/in/scripts/shared.js": `
export const sharedUtil = () => console.log('Shared utility');`,
      "/in/scripts/large-module.js": `
export const largeModule = {
  // Simulate a large shared module
  bigData: new Array(1000).fill('data'),
  methods: { /* ... */ }
};`,
    },
    entryPoints: ["/in/pages/page1.html", "/in/pages/page2.html"],
    experimentalHtml: true,
    experimentalCss: true,
    splitting: true,
    onAfterBundle(api) {
      // Check both pages
      for (const page of ["page1", "page2"]) {
        api.expectFile(`out/${page}.html`).toMatch(/href=".*\.css"/);
        api.expectFile(`out/${page}.html`).toMatch(/src=".*\.js"/);
        api.expectFile(`out/${page}.html`).not.toContain(`${page}.css`);
        api.expectFile(`out/${page}.html`).not.toContain(`${page}.js`);
      }

      // Verify that shared code exists in both bundles
      const page1Html = api.readFile("out/page1.html");
      const page2Html = api.readFile("out/page2.html");

      const page1JsPath = page1Html.match(/src="(.*\.js)"/)?.[1];
      const page2JsPath = page2Html.match(/src="(.*\.js)"/)?.[1];

      expect(page1JsPath).toBeDefined();
      expect(page2JsPath).toBeDefined();

      const page1Js = api.readFile("out/" + page1JsPath!);
      const page2Js = api.readFile("out/" + page2JsPath!);

      // Check we imported the shared module
      expect(page2Js).toContain("import{sharedUtil}");
      expect(page1Js).toContain("import{sharedUtil}");

      // Check CSS bundles
      const page1CssPath = page1Html.match(/href="(.*\.css)"/)?.[1];
      const page2CssPath = page2Html.match(/href="(.*\.css)"/)?.[1];

      expect(page1CssPath).toBeDefined();
      expect(page2CssPath).toBeDefined();

      const page1Css = api.readFile("out/" + page1CssPath!);
      const page2Css = api.readFile("out/" + page2CssPath!);
      expect(page1Css).toContain("box-sizing:border-box");
      expect(page2Css).toContain("box-sizing:border-box");
      expect(page1Css).toContain(".shared");
      expect(page2Css).toContain(".shared");
    },
  });

  // Test JS importing HTML
  itBundled("html/js-importing-html", {
    outdir: "out/",
    files: {
      "/in/entry.js": `
import htmlContent from './template.html';
console.log('Loaded HTML:', htmlContent);`,

      "/in/template.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>HTML Template</title>
  </head>
  <body>
    <h1>HTML Template</h1>
  </body>
</html>`,
    },
    experimentalHtml: true,

    // This becomes:
    //
    // - out/entry.js
    // - out/template-hash.html
    //
    // Like a regular asset.
    entryPoints: ["/in/entry.js"],
    onAfterBundle(api) {
      const entryBundle = api.readFile("out/entry.js");
      // Check taht we dind't bundle the HTML file
      expect(entryBundle).toMatch(/\.\/template-.*\.html/);
    },
  });

  itBundled("html/js-importing-html-and-entry-point-side-effect-import", {
    outdir: "out/",
    target: "browser",
    files: {
      "/in/2nd.js": `
console.log('2nd');`,
      "/in/entry.js": `
import './template.html';
console.log('Loaded HTML!');`,

      "/in/template.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>HTML Template</title>
  </head>
  <body>
    <h1>HTML Template</h1>
    <script src="./entry.js"></script>
    <script src="./2nd.js"></script>
  </body>
</html>`,
    },
    experimentalHtml: true,
    // This becomes:
    // - ./template.html
    // - ./template-*.js
    // - ./entry.js
    entryPointsRaw: ["in/template.html", "in/entry.js"],
    onAfterBundle(api) {
      const templateBundle = api.readFile("out/template.html");
      expect(templateBundle).toContain("HTML Template");

      // Get the entry.js file from looking at <script src="./template-*.js">
      const entryJsPath = templateBundle.match(/(.\/.*template-.*\.js)">/)?.[1];
      const entryBundle = api.readFile("out/" + entryJsPath!);

      // Verify we DID bundle the HTML file
      expect(entryBundle).not.toMatch(/\.\/template-.*\.html/);
      console.log(entryBundle);
    },
  });

  itBundled("html/js-importing-html-and-entry-point-default-import-fails", {
    outdir: "out/",
    target: "browser",
    files: {
      "/in/2nd.js": `
console.log('2nd');`,
      "/in/entry.js": `
import badDefaultImport from './template.html';
console.log('Loaded HTML!', badDefaultImport);`,

      "/in/template.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>HTML Template</title>
  </head>
  <body>
    <h1>HTML Template</h1>
    <script src="./entry.js"></script>
    <script src="./2nd.js"></script>
  </body>
</html>`,
    },
    experimentalHtml: true,
    entryPointsRaw: ["in/template.html", "in/entry.js"],
    bundleErrors: {
      "/in/entry.js": ['No matching export in "in/template.html" for import "default"'],
    },
    onAfterBundle(api) {
      const templateBundle = api.readFile("out/template.html");
      expect(templateBundle).toContain("HTML Template");

      // Get the entry.js file from looking at <script src="./template-*.js">
      const entryJsPath = templateBundle.match(/(.\/.*template-.*\.js)">/)?.[1];
      const entryBundle = api.readFile("out/" + entryJsPath!);

      // Verify we DID bundle the HTML file
      expect(entryBundle).not.toMatch(/\.\/template-.*\.html/);
      console.log(entryBundle);
    },
  });

  itBundled("html/js-importing-html-and-entry-point-default-import-succeeds-html-loader-disabled", {
    outdir: "out/",
    target: "browser",
    files: {
      "/in/2nd.js": `
console.log('2nd');`,
      "/in/entry.js": `
import badDefaultImport from './template.html';
console.log('Loaded HTML!', badDefaultImport);`,

      "/in/template.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>HTML Template</title>
  </head>
  <body>
    <h1>HTML Template</h1>
    <script src="./entry.js"></script>
    <script src="./2nd.js"></script>
  </body>
</html>`,
    },
    experimentalHtml: false,
    entryPointsRaw: ["in/template.html", "in/entry.js"],
    onAfterBundle(api) {
      const entryBundle = api.readFile("out/entry.js");

      // Verify we DID bundle the HTML file
      expect(entryBundle).toMatch(/\.\/template-.*\.html/);
      const filename = entryBundle.match(/\.\/(template-.*\.html)/)?.[1];
      expect(filename).toBeDefined();
      const templateBundle = api.readFile("out/" + filename!);
      expect(templateBundle).toContain("HTML Template");
    },
  });

  // Test circular dependencies between JS and HTML
  itBundled("html/circular-js-html", {
    outdir: "out/",
    files: {
      "/in/main.js": `
import page from './page.html';
console.log('Main JS loaded page:', page);`,

      "/in/page.html": `
<!DOCTYPE html>
<html>
  <head>
    <script src="./main.js"></script>
  </head>
  <body>
    <div id="content">Circular Import Test</div>
  </body>
</html>`,
    },
    experimentalHtml: true,
    entryPoints: ["/in/main.js"],
    onAfterBundle(api) {
      const bundle = api.readFile("out/main.js");

      // Check that it is a hashed file
      expect(bundle).toMatch(/\.\/page-.*\.html/);
    },
  });

  // Test HTML with only CSS (no JavaScript)
  itBundled("html/css-only", {
    outdir: "out/",
    files: {
      "/in/page.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
    <link rel="stylesheet" href="./theme.css">
  </head>
  <body>
    <div class="container">
      <h1 class="title">Styled Page</h1>
      <p class="content">This page only has CSS styling.</p>
    </div>
  </body>
</html>`,
      "/in/styles-imported.css": `
* {
  box-sizing: border-box;
}
`,
      "/in/styles.css": `
@import "./styles-imported.css";
.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}
.title {
  color: navy;
}`,
      "/in/theme.css": `
@import "./styles-imported.css";
.content {
  line-height: 1.6;
  color: #333;
}
body {
  background-color: #f5f5f5;
}`,
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/in/page.html"],
    onAfterBundle(api) {
      const htmlBundle = api.readFile("out/page.html");

      // Check that CSS is properly referenced and hashed
      expect(htmlBundle).toMatch(/href=".*\.css"/);
      expect(htmlBundle).not.toContain("styles.css");
      expect(htmlBundle).not.toContain("theme.css");

      // Get the CSS bundle path
      const cssPath = htmlBundle.match(/href="(.*\.css)"/)?.[1];
      expect(cssPath).toBeDefined();

      // Check the CSS bundle contents
      const cssBundle = api.readFile("out/" + cssPath!);
      expect(cssBundle).toContain(".container");
      expect(cssBundle).toContain(".title");
      expect(cssBundle).toContain(".content");
      expect(cssBundle).toContain("background-color");
      expect(cssBundle).toContain("box-sizing: border-box");
    },
  });

  // Test absolute paths in HTML
  itBundled("html/absolute-paths", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="/styles/main.css">
    <script src="/scripts/app.js"></script>
  </head>
  <body>
    <h1>Absolute Paths</h1>
    <img src="/images/logo.png">
  </body>
</html>`,
      "/styles/main.css": "body { margin: 0; }",
      "/scripts/app.js": "console.log('App loaded')",
      "/images/logo.png": "fake image content",
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // Check that absolute paths are handled correctly
      const htmlBundle = api.readFile("out/index.html");

      // CSS should be bundled and hashed
      api.expectFile("out/index.html").not.toContain("/styles/main.css");
      api.expectFile("out/index.html").toMatch(/href=".*\.css"/);

      // JS should be bundled and hashed
      api.expectFile("out/index.html").not.toContain("/scripts/app.js");
      api.expectFile("out/index.html").toMatch(/src=".*\.js"/);

      // Image should be hashed
      api.expectFile("out/index.html").not.toContain("/images/logo.png");
      api.expectFile("out/index.html").toMatch(/src=".*\.png"/);

      // Get the bundled files and verify their contents
      const cssMatch = htmlBundle.match(/href="(.*\.css)"/);
      const jsMatch = htmlBundle.match(/src="(.*\.js)"/);
      const imgMatch = htmlBundle.match(/src="(.*\.png)"/);

      expect(cssMatch).not.toBeNull();
      expect(jsMatch).not.toBeNull();
      expect(imgMatch).not.toBeNull();

      const cssBundle = api.readFile("out/" + cssMatch![1]);
      const jsBundle = api.readFile("out/" + jsMatch![1]);

      expect(cssBundle).toContain("margin: 0");
      expect(jsBundle).toContain("App loaded");
    },
  });

  // Test that sourcemap comments are not included in HTML and CSS files
  itBundled("html/no-sourcemap-comments", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
    <script src="./script.js"></script>
  </head>
  <body>
    <h1>No Sourcemap Comments</h1>
  </body>
</html>`,
      "/styles.css": `
body {
  background-color: red;
}
/* This is a comment */`,
      "/script.js": "console.log('Hello World')",
    },
    experimentalHtml: true,
    experimentalCss: true,
    sourceMap: "linked",
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // Check HTML file doesn't contain sourcemap comments
      const htmlContent = api.readFile("out/index.html");
      api.expectFile("out/index.html").not.toContain("sourceMappingURL");
      api.expectFile("out/index.html").not.toContain("debugId");

      // Get the CSS filename from the HTML
      const cssMatch = htmlContent.match(/href="(.*\.css)"/);
      expect(cssMatch).not.toBeNull();
      const cssFile = cssMatch![1];

      // Check CSS file doesn't contain sourcemap comments
      api.expectFile("out/" + cssFile).not.toContain("sourceMappingURL");
      api.expectFile("out/" + cssFile).not.toContain("debugId");

      // Get the JS filename from the HTML
      const jsMatch = htmlContent.match(/src="(.*\.js)"/);
      expect(jsMatch).not.toBeNull();
      const jsFile = jsMatch![1];

      // JS file SHOULD contain sourcemap comment since it's supported
      api.expectFile("out/" + jsFile).toContain("sourceMappingURL");
    },
  });

  // Also test with inline sourcemaps
  itBundled("html/no-sourcemap-comments-inline", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
    <script src="./script.js"></script>
  </head>
  <body>
    <h1>No Sourcemap Comments</h1>
  </body>
</html>`,
      "/styles.css": `
body {
  background-color: red;
}
/* This is a comment */`,
      "/script.js": "console.log('Hello World')",
    },
    experimentalHtml: true,
    experimentalCss: true,
    sourceMap: "inline",
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // Check HTML file doesn't contain sourcemap comments
      const htmlContent = api.readFile("out/index.html");
      api.expectFile("out/index.html").not.toContain("sourceMappingURL");
      api.expectFile("out/index.html").not.toContain("debugId");

      // Get the CSS filename from the HTML
      const cssMatch = htmlContent.match(/href="(.*\.css)"/);
      expect(cssMatch).not.toBeNull();
      const cssFile = cssMatch![1];

      // Check CSS file doesn't contain sourcemap comments
      api.expectFile("out/" + cssFile).not.toContain("sourceMappingURL");
      api.expectFile("out/" + cssFile).not.toContain("debugId");

      // Get the JS filename from the HTML
      const jsMatch = htmlContent.match(/src="(.*\.js)"/);
      expect(jsMatch).not.toBeNull();
      const jsFile = jsMatch![1];

      // JS file SHOULD contain sourcemap comment since it's supported
      api.expectFile("out/" + jsFile).toContain("sourceMappingURL");
    },
  });
});
