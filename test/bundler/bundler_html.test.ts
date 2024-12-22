import { describe } from "bun:test";
import { isWindows } from "harness";
import { itBundled } from "./expectBundled";
import { expect } from "bun:test";

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
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <script src="./main.js"></script>
  </head>
  <body>
    <h1>JS Imports</h1>
  </body>
</html>`,
      "/main.js": `
import { greeting } from './utils/strings.js';
import { formatDate } from './utils/date.js';
console.log(greeting('World'));
console.log(formatDate(new Date()));`,
      "/utils/strings.js": `
export const greeting = (name) => \`Hello, \${name}!\`;`,
      "/utils/date.js": `
import { padZero } from './numbers.js';
export const formatDate = (date) => \`\${date.getFullYear()}-\${padZero(date.getMonth() + 1)}-\${padZero(date.getDate())}\`;`,
      "/utils/numbers.js": `
export const padZero = (num) => String(num).padStart(2, '0');`,
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // All JS should be bundled into one file
      api.expectFile("out/index.html").toMatch(/src=".*\.js"/);
      api.expectFile("out/index.html").not.toContain("main.js");

      // Check that the bundle contains all the imported code
      const jsBundle = api.readFile(api.expectFile("index.html").toMatch(/src="(.*\.js)"/).groups[1]);
      expect(jsBundle).toContain("Hello");
      expect(jsBundle).toContain("padZero");
      expect(jsBundle).toContain("formatDate");
    },
  });

  // Test CSS imports
  itBundled.only("html/css-imports", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles/main.css">
  </head>
  <body>
    <h1>CSS Imports</h1>
  </body>
</html>`,
      "/styles/main.css": `
@import './variables.css';
@import './typography.css';
body {
  background-color: var(--background-color);
}`,
      "/styles/variables.css": `
:root {
  --background-color: #f0f0f0;
  --text-color: #333;
  --heading-color: #000;
}`,
      "/styles/typography.css": `
@import './fonts.css';
h1 {
  color: var(--heading-color);
  font-family: var(--heading-font);
}`,
      "/styles/fonts.css": `
:root {
  --heading-font: 'Arial', sans-serif;
  --body-font: 'Helvetica', sans-serif;
}`,
    },
    experimentalHtml: true,
    experimentalCss: true,
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // All CSS should be bundled into one file
      api.expectFile("out/index.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/index.html").not.toContain("main.css");

      // Check that the bundle contains all the imported CSS
      const htmlContent = api.readFile("index.html");
      console.log(htmlContent);
      const cssMatch = htmlContent.match(/href="(.*?\.css)"/);
      if (!cssMatch) throw new Error("Could not find CSS file reference in HTML");
      const cssBundle = api.readFile(cssMatch[1]);
      expect(cssBundle).toContain("--background-color");
      expect(cssBundle).toContain("--heading-font");
      expect(cssBundle).toContain("font-family");
    },
  });

  // Test multiple HTML entry points
  itBundled("html/multiple-entries", {
    outdir: "out/",
    files: {
      "/pages/index.html": `
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
      "/pages/about.html": `
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
      "/styles/home.css": `
@import './common.css';
.home { color: blue; }`,
      "/styles/about.css": `
@import './common.css';
.about { color: green; }`,
      "/styles/common.css": `
body { margin: 0; padding: 20px; }`,
      "/scripts/home.js": `
import { initNav } from './common.js';
console.log('Home page');
initNav();`,
      "/scripts/about.js": `
import { initNav } from './common.js';
console.log('About page');
initNav();`,
      "/scripts/common.js": `
export const initNav = () => console.log('Navigation initialized');`,
    },
    entryPoints: ["/pages/index.html", "/pages/about.html"],
    experimentalHtml: true,
    experimentalCss: true,
    onAfterBundle(api) {
      // Check index.html
      api.expectFile("out/pages/index.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/pages/index.html").toMatch(/src=".*\.js"/);
      api.expectFile("out/pages/index.html").not.toContain("home.css");
      api.expectFile("out/pages/index.html").not.toContain("home.js");

      // Check about.html
      api.expectFile("out/pages/about.html").toMatch(/href=".*\.css"/);
      api.expectFile("out/pages/about.html").toMatch(/src=".*\.js"/);
      api.expectFile("out/pages/about.html").not.toContain("about.css");
      api.expectFile("out/pages/about.html").not.toContain("about.js");

      // Verify that links between pages are updated with hashed filenames
      const indexHtml = api.readFile("out/pages/index.html");
      const aboutHtml = api.readFile("out/pages/about.html");
      expect(indexHtml).not.toContain('href="about.html"');
      expect(aboutHtml).not.toContain('href="index.html"');
      expect(indexHtml).toMatch(/href="about-[a-zA-Z0-9]+\.html"/);
      expect(aboutHtml).toMatch(/href="index-[a-zA-Z0-9]+\.html"/);

      // Check that each page has its own bundle
      const indexHtmlContent = api.readFile("out/pages/index.html");
      const aboutHtmlContent = api.readFile("out/pages/about.html");

      const indexJsMatch = indexHtmlContent.match(/src="(.*\.js)"/);
      const aboutJsMatch = aboutHtmlContent.match(/src="(.*\.js)"/);

      const indexJs = api.readFile(indexJsMatch![1]);
      const aboutJs = api.readFile(aboutJsMatch![1]);

      expect(indexJs).toContain("Home page");
      expect(aboutJs).toContain("About page");
      expect(indexJs).toContain("Navigation initialized");
      expect(aboutJs).toContain("Navigation initialized");

      // Check that each page has its own CSS bundle
      const indexCssMatch = indexHtmlContent.match(/href="(.*\.css)"/);
      const aboutCssMatch = aboutHtmlContent.match(/href="(.*\.css)"/);

      const indexCss = api.readFile(indexCssMatch![1]);
      const aboutCss = api.readFile(aboutCssMatch![1]);

      expect(indexCss).toContain(".home");
      expect(aboutCss).toContain(".about");
      expect(indexCss).toContain("margin: 0");
      expect(aboutCss).toContain("margin: 0");
    },
  });

  // Test multiple HTML entries with shared chunks
  itBundled("html/shared-chunks", {
    outdir: "out/",
    files: {
      "/pages/page1.html": `
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
      "/pages/page2.html": `
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
      "/styles/page1.css": `
@import './shared.css';
.page1 { font-size: 20px; }`,
      "/styles/page2.css": `
@import './shared.css';
.page2 { font-size: 18px; }`,
      "/styles/shared.css": `
@import './reset.css';
.shared { color: blue; }`,
      "/styles/reset.css": `
* { box-sizing: border-box; }`,
      "/scripts/page1.js": `
import { sharedUtil } from './shared.js';
import { largeModule } from './large-module.js';
console.log('Page 1');
sharedUtil();`,
      "/scripts/page2.js": `
import { sharedUtil } from './shared.js';
import { largeModule } from './large-module.js';
console.log('Page 2');
sharedUtil();`,
      "/scripts/shared.js": `
export const sharedUtil = () => console.log('Shared utility');`,
      "/scripts/large-module.js": `
export const largeModule = {
  // Simulate a large shared module
  bigData: new Array(1000).fill('data'),
  methods: { /* ... */ }
};`,
    },
    entryPoints: ["/pages/page1.html", "/pages/page2.html"],
    experimentalHtml: true,
    experimentalCss: true,
    splitting: true,
    onAfterBundle(api) {
      // Check both pages
      for (const page of ["out/page1", "out/page2"]) {
        api.expectFile(`pages/${page}.html`).toMatch(/href=".*\.css"/);
        api.expectFile(`pages/${page}.html`).toMatch(/src=".*\.js"/);
        api.expectFile(`pages/${page}.html`).not.toContain(`${page}.css`);
        api.expectFile(`pages/${page}.html`).not.toContain(`${page}.js`);
      }

      // Verify that shared code exists in both bundles
      const page1Js = api.readFile(api.expectFile("out/pages/page1.html").toMatch(/src="(.*\.js)"/).groups[1]);
      const page2Js = api.readFile(api.expectFile("out/pages/page2.html").toMatch(/src="(.*\.js)"/).groups[1]);
      expect(page1Js).toContain("Shared utility");
      expect(page2Js).toContain("Shared utility");

      // Check CSS bundles
      const page1Css = api.readFile(api.expectFile("out/pages/page1.html").toMatch(/href="(.*\.css)"/).groups[1]);
      const page2Css = api.readFile(api.expectFile("out/pages/page2.html").toMatch(/href="(.*\.css)"/).groups[1]);
      expect(page1Css).toContain("box-sizing: border-box");
      expect(page2Css).toContain("box-sizing: border-box");
      expect(page1Css).toContain(".shared");
      expect(page2Css).toContain(".shared");
    },
  });
});
