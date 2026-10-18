import type { BuildConfig, BunPlugin } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
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

  // A script that is also an entry point still runs in its place on the page.
  itBundled("html/script-that-is-also-an-entry-point", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <script type="module" src="./first.js"></script>
    <script type="module" src="./second.js"></script>
  </head>
</html>`,
      "/first.js": `console.log("first");`,
      "/second.js": `console.log("second");`,
    },
    entryPoints: ["/index.html", "/second.js"],
    onAfterBundle(api) {
      const jsMatch = api.readFile("out/index.html").match(/src="(.*\.js)"/);
      expect(api.readFile("out/" + jsMatch![1])).toMatch(/"first"[\s\S]*"second"/);
      api.expectFile("out/second.js").toContain('console.log("second")');
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

  // https://github.com/oven-sh/bun/issues/34111
  // With code splitting, the HTML <script src> must reference the chunk that
  // actually contains the entry module, not a shared chunk that happens to
  // sort before it.
  {
    const pageCount = 10;
    const files: Record<string, string> = {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head></head>
  <body>
    <script type="module" src="./main.ts"></script>
  </body>
</html>`,
      "/main.ts":
        `console.log("MAIN_ENTRY_EXECUTED");\n` +
        Array.from({ length: pageCount }, (_, p) => `import("./pages/page${p}");`).join("\n"),
      "/shared.ts": `export function shared() { return 1000; }`,
    };
    for (let p = 0; p < pageCount; p++) {
      // The last two pages share a module so a non-entry shared chunk exists.
      files[`/pages/page${p}.ts`] =
        p >= pageCount - 2
          ? `import { shared } from "../shared";\nexport default shared() + ${p};`
          : `export default ${p};`;
    }
    itBundled("html/script-src-is-entry-chunk-with-splitting", {
      outdir: "out/",
      files,
      entryPoints: ["/index.html"],
      splitting: true,
      onAfterBundle(api) {
        const html = api.readFile("out/index.html");
        const src = html.match(/<script[^>]*\bsrc="\.?\/?([^"]+)"/)?.[1];
        expect(src).toBeDefined();
        expect(api.readFile("out/" + src!)).toContain("MAIN_ENTRY_EXECUTED");
      },
    });
  }

  // With splitting, each page preloads the chunks its entry chunk statically
  // imports (here lib.js's chunk, shared by both pages, and through it
  // deep.js's, shared by all three) but not chunks it only import()s.
  itBundled("html/modulepreload-links", {
    outdir: "out/",
    files: {
      "/a.html": `<!DOCTYPE html><html><head><script type="module" src="./a.js"></script></head><body></body></html>`,
      "/b.html": `<!DOCTYPE html><html><head><script type="module" src="./b.js"></script></head><body></body></html>`,
      "/c.html": `<!DOCTYPE html><html><head><script type="module" src="./c.js"></script></head><body></body></html>`,
      "/a.js": `import { lib } from "./lib.js"; console.log("a", lib()); import("./lazy.js");`,
      "/b.js": `import { lib } from "./lib.js"; console.log("b", lib());`,
      "/c.js": `import { deep } from "./deep.js"; console.log("c", deep());`,
      "/lib.js": `import { deep } from "./deep.js"; export const lib = () => "lib" + deep();`,
      "/deep.js": `export const deep = () => "deep";`,
      "/lazy.js": `console.log("lazy");`,
    },
    entryPoints: ["/a.html", "/b.html", "/c.html"],
    splitting: true,
    onAfterBundle(api) {
      const preloads = (page: string) =>
        [
          ...api.readFile(`out/${page}.html`).matchAll(/<link rel="modulepreload" crossorigin href="\.\/([^"]+)">/g),
        ].map(m => api.readFile("out/" + m[1]));
      const [a, b, c] = ["a", "b", "c"].map(preloads);
      expect(a).toHaveLength(2);
      expect(a[0]).toContain('"lib"');
      expect(a[1]).toContain('"deep"');
      expect(a.some(chunk => chunk.includes('"lazy"'))).toBe(false);
      expect(b).toStrictEqual(a);
      expect(c).toStrictEqual([a[1]]);
      for (const page of ["a", "b", "c"]) {
        expect(api.readFile(`out/${page}.html`)).toMatch(
          /<script type="module" crossorigin src="[^"]+"><\/script><link rel="modulepreload"/,
        );
      }
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

      const page1JsPath = page1Html.match(/src="([^"]*\.js)"/)?.[1];
      const page2JsPath = page2Html.match(/src="([^"]*\.js)"/)?.[1];

      expect(page1JsPath).toBeDefined();
      expect(page2JsPath).toBeDefined();

      const page1Js = api.readFile("out/" + page1JsPath!);
      const page2Js = api.readFile("out/" + page2JsPath!);

      // Check we imported the shared module
      expect(page2Js).toContain("import{sharedUtil}");
      expect(page1Js).toContain("import{sharedUtil}");

      // ... and that each page preloads the shared chunk its entry imports
      const sharedChunkPath = page1Js.match(/from"\.\/([^"]*\.js)"/)?.[1];
      expect(sharedChunkPath).toBeDefined();
      expect(page1Html).toContain(`<link rel="modulepreload" crossorigin href="./${sharedChunkPath}">`);
      expect(page2Html).toContain(`<link rel="modulepreload" crossorigin href="./${sharedChunkPath}">`);

      // Check CSS bundles
      const page1CssPath = page1Html.match(/href="([^"]*\.css)"/)?.[1];
      const page2CssPath = page2Html.match(/href="([^"]*\.css)"/)?.[1];

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
import htmlContent from './template.html' with { type: 'file' };
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
    entryPoints: ["/in/main.js"],
    loader: { ".html": "file" },
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

  // Test that multiple HTML entrypoints sharing the same CSS file both get
  // the CSS link tag in production mode (css_chunking deduplication).
  // Regression test for https://github.com/oven-sh/bun/issues/23668
  itBundled("html/SharedCSSProductionMultipleEntries", {
    outdir: "out/",
    production: true,
    files: {
      "/entry1.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./global.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./main1.tsx"></script>
  </body>
</html>`,
      "/entry2.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./global.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./main2.tsx"></script>
  </body>
</html>`,
      "/global.css": `h1 { font-size: 24px; }`,
      "/main1.tsx": `console.log("entry1");`,
      "/main2.tsx": `console.log("entry2");`,
    },
    entryPoints: ["/entry1.html", "/entry2.html"],
    onAfterBundle(api) {
      const entry1Html = api.readFile("out/entry1.html");
      const entry2Html = api.readFile("out/entry2.html");

      // Both HTML files must contain a CSS link tag
      const cssMatch1 = entry1Html.match(/href="(.*\.css)"/);
      const cssMatch2 = entry2Html.match(/href="(.*\.css)"/);

      expect(cssMatch1).not.toBeNull();
      expect(cssMatch2).not.toBeNull();

      // Both should reference the same deduplicated CSS chunk
      expect(cssMatch1![1]).toBe(cssMatch2![1]);

      // The CSS file should contain the shared styles
      const cssContent = api.readFile("out/" + cssMatch1![1]);
      expect(cssContent).toContain("font-size");

      // Both HTML files should also have their respective JS bundles
      expect(entry1Html).toMatch(/src=".*\.js"/);
      expect(entry2Html).toMatch(/src=".*\.js"/);
    },
  });

  // Test manifest.json is copied as an asset and link href is rewritten
  itBundled("html/manifest-json", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="manifest" href="./manifest.json" />
  </head>
  <body>
    <h1>App</h1>
    <script src="./app.js"></script>
  </body>
</html>`,
      "/manifest.json": JSON.stringify({
        name: "My App",
        short_name: "App",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#000000",
      }),
      "/app.js": "console.log('hello')",
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      const htmlContent = api.readFile("out/index.html");

      // The original manifest.json reference should be rewritten to a hashed filename
      expect(htmlContent).not.toContain('manifest.json"');
      expect(htmlContent).toMatch(/href="(?:\.\/|\/)?manifest-[a-zA-Z0-9]+\.json"/);

      // Extract the hashed manifest filename and verify its content
      const manifestMatch = htmlContent.match(/href="(?:\.\/|\/)?(manifest-[a-zA-Z0-9]+\.json)"/);
      expect(manifestMatch).not.toBeNull();
      const manifestContent = api.readFile("out/" + manifestMatch![1]);
      expect(manifestContent).toContain('"name"');
      expect(manifestContent).toContain('"My App"');
    },
  });

  // Test that other non-JS/CSS file types referenced via URL imports are copied as assets
  itBundled("html/xml-asset", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="manifest" href="./site.webmanifest" />
  </head>
  <body>
    <h1>App</h1>
  </body>
</html>`,
      "/site.webmanifest": JSON.stringify({
        name: "My App",
        icons: [{ src: "/icon.png", sizes: "192x192" }],
      }),
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      const htmlContent = api.readFile("out/index.html");

      // The webmanifest reference should be rewritten to a hashed filename
      expect(htmlContent).not.toContain("site.webmanifest");
      expect(htmlContent).toMatch(/href=".*\.webmanifest"/);
    },
  });
});

// A browser resolves each image `src` of a web app manifest against the manifest's own URL.
// The build gives the manifest a hashed name, so it also copies the images it names and
// writes their new paths into the copy. Every other byte of the manifest stays as written.
describe("web app manifest", () => {
  /** The text of each build output, keyed by its `/`-separated path in the output folder. */
  type Outputs = Record<string, string>;

  const page = (...head: string[]) => `<!DOCTYPE html><html><head>${head.join("")}</head><body></body></html>`;
  const link = `<link rel="manifest" href="./site.webmanifest">`;
  const script = `<script type="module" src="./app.js"></script>`;

  async function buildPage(
    files: Parameters<typeof tempDir>[1],
    config: (root: string) => Partial<BuildConfig> = () => ({}),
  ) {
    const dir = tempDir("html-web-manifest", files);
    const root = String(dir);
    const outdir = join(root, "out");
    const result = await Bun.build({
      entrypoints: [join(root, "index.html")],
      outdir,
      throw: false,
      ...config(root),
    });
    const outputs: Outputs = {};
    for (const output of result.outputs) {
      outputs[relative(outdir, output.path).replaceAll("\\", "/")] = await output.text();
    }
    return {
      root,
      outdir,
      result,
      outputs,
      logs: result.logs.map(String),
      [Symbol.dispose]: () => dir[Symbol.dispose](),
    };
  }

  /** The one output whose path matches `pattern`. */
  function only(outputs: Outputs, pattern: RegExp): string {
    const paths = Object.keys(outputs).filter(path => pattern.test(path));
    expect(paths).toEqual([expect.stringMatching(pattern)]);
    return paths[0];
  }

  const webManifest = (outputs: Outputs) => only(outputs, /(^|\/)site-[0-9a-z]+\.webmanifest$/);

  /** The output that `src` names, as a browser resolves it from the manifest at `manifestPath`. */
  const named = (manifestPath: string, src: string) => new URL(src, "http://out/" + manifestPath).pathname.slice(1);

  /** Every output that is not JavaScript, sorted. */
  const copied = (outputs: Outputs) =>
    Object.keys(outputs)
      .filter(path => !path.endsWith(".js"))
      .sort();

  describe("with every list", () => {
    const files = {
      "index.html": page(link, `<link rel="icon" href="./both.png">`),
      "site.webmanifest": `{
  "name": "x",
  "start_url": "./index.html",
  "scope": "./",
  "icons": [
    { "src": "./icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png",   "sizes": "512x512" },
    { "src": "./both.png" },
    { "src": "img/nested.png" }
  ],
  "screenshots": [{ "src": "./shot.png", "sizes": "640x480" }],
  "shortcuts": [{ "name": "s", "url": "./index.html", "icons": [{ "src": "./short.png" }] }],
  "file_handlers": [{ "action": "./index.html", "accept": {}, "icons": [{ "src": "./handler.png" }] }]
}
`,
      "icon-192.png": "PNG icon-192",
      "icon-512.png": "PNG icon-512",
      "both.png": "PNG both",
      "img": { "nested.png": "PNG nested" },
      "shot.png": "PNG shot",
      "short.png": "PNG short",
      "handler.png": "PNG handler",
    };
    const literals = [
      [`"./icon-192.png"`, "icon-192"],
      [`"icon-512.png"`, "icon-512"],
      [`"./both.png"`, "both"],
      [`"img/nested.png"`, "nested"],
      [`"./shot.png"`, "shot"],
      [`"./short.png"`, "short"],
      [`"./handler.png"`, "handler"],
    ];

    // Each image is copied once, only its `src` literal changes, and the page's
    // `<link rel="icon">` names the same copy of the file they share.
    function expectFollowed(outputs: Outputs) {
      let expected = files["site.webmanifest"];
      const images: string[] = [];
      for (const [literal, name] of literals) {
        const path = only(outputs, new RegExp(`^${name}-[0-9a-z]+\\.png$`));
        expect(outputs[path]).toBe("PNG " + name);
        expected = expected.replace(literal, `"./${path}"`);
        images.push(path);
      }
      const manifest = webManifest(outputs);
      expect(outputs[manifest]).toBe(expected);
      expect(copied(outputs)).toEqual(["index.html", manifest, ...images].sort());
      expect(outputs["index.html"]).toContain(`<link rel="icon" href="./${images[2]}">`);
    }

    test("Bun.build copies the images and writes their paths", async () => {
      using built = await buildPage(files);
      expect(built.logs).toEqual([]);
      expectFollowed(built.outputs);
    });

    test("bun build copies the images and writes their paths", async () => {
      using dir = tempDir("html-web-manifest-cli", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./index.html", "--outdir=out"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: expect.stringContaining(".webmanifest"), stderr: "" });
      const outdir = join(String(dir), "out");
      const outputs: Outputs = {};
      for (const entry of readdirSync(outdir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const path = join(entry.parentPath, entry.name);
        outputs[relative(outdir, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
      }
      expectFollowed(outputs);
      expect(exitCode).toBe(0);
    });
  });

  test("leaves every other src as written", async () => {
    // `rooted.png` exists: only the way a `src` is written keeps it from being followed.
    const manifest = `{
  "icons": [
    { "src": "/rooted.png" },
    { "src": "https://example.com/a.png" },
    { "src": "http://example.com/a.png" },
    { "src": "//example.com/a.png" },
    { "src": "data:image/png;base64,AAAA" },
    { "src": "blob:rooted.png" },
    { "src": "./missing.png" },
    { "src": "missing.png" },
    { "src": ".\\/rooted.png" },
    { "src": "./folder" },
    { "src": "" },
    { "src": 1 },
    { "sizes": "1x1" },
    "./rooted.png"
  ],
  "screenshots": { "src": "./rooted.png" },
  "shortcuts": [{ "icons": "./rooted.png" }, "./rooted.png"],
  "file_handlers": "./rooted.png",
  "start_url": "./rooted.png",
  "related_applications": [{ "src": "./rooted.png" }]
}`;
    using built = await buildPage({
      "index.html": page(link),
      "site.webmanifest": manifest,
      "rooted.png": "PNG rooted",
      "folder": { "inner.png": "PNG inner" },
    });
    expect(built.logs).toEqual([]);
    const path = webManifest(built.outputs);
    expect(built.outputs[path]).toBe(manifest);
    expect(copied(built.outputs)).toEqual(["index.html", path].sort());
  });

  test.each([
    ["is not JSON", `{ "icons": [{ "src": "./a.png" }], }`],
    ["is an array", `[{ "src": "./a.png" }]`],
    ["is a string", `"./a.png"`],
  ])("leaves a manifest that %s as written", async (_, manifest) => {
    using built = await buildPage({ "index.html": page(link), "site.webmanifest": manifest, "a.png": "PNG a" });
    expect(built.logs).toEqual([]);
    const path = webManifest(built.outputs);
    expect(built.outputs[path]).toBe(manifest);
    expect(copied(built.outputs)).toEqual(["index.html", path].sort());
  });

  test("writes paths under publicPath as valid JSON", async () => {
    const publicPath = `https://cdn.example.com/a"b/`;
    using built = await buildPage(
      { "index.html": page(link), "site.webmanifest": `{"icons":[{"src":"./a.png"}]}`, "a.png": "PNG a" },
      () => ({ publicPath }),
    );
    const icon = only(built.outputs, /^a-[0-9a-z]+\.png$/);
    expect(JSON.parse(built.outputs[webManifest(built.outputs)])).toEqual({ icons: [{ src: publicPath + icon }] });
  });

  test.each([
    ["a fixed folder", "assets/[name]-[hash].[ext]", ["assets/icon", "assets/top"]],
    ["[dir]", "[dir]/[name]-[hash].[ext]", ["pwa/icon", "top"]],
  ])("writes paths relative to the manifest's folder: %s", async (_, asset, [icon, top]) => {
    using built = await buildPage(
      {
        "index.html": page(`<link rel="manifest" href="./pwa/site.webmanifest">`),
        "pwa": { "site.webmanifest": `{"icons":[{"src":"./icon.png"},{"src":"../top.png"}]}`, "icon.png": "PNG icon" },
        "top.png": "PNG top",
      },
      () => ({ naming: { asset } }),
    );
    const manifest = webManifest(built.outputs);
    const { icons } = JSON.parse(built.outputs[manifest]);
    expect(icons.map((image: { src: string }) => named(manifest, image.src))).toEqual([
      only(built.outputs, new RegExp(`^${icon}-[0-9a-z]+\\.png$`)),
      only(built.outputs, new RegExp(`^${top}-[0-9a-z]+\\.png$`)),
    ]);
    expect(icons.map((image: { src: string }) => built.outputs[named(manifest, image.src)])).toEqual([
      "PNG icon",
      "PNG top",
    ]);
  });

  // Which importer or plugin creates the manifest's module, and when, must not matter.
  describe("follows a manifest however it was loaded", () => {
    const manifest = `{"icons":[{"src":"./a.png"}]}`;
    const onDisk = { "index.html": page(link), "site.webmanifest": manifest, "a.png": "PNG a" };
    const plugin = (setup: BunPlugin["setup"]): BunPlugin[] => [{ name: "web-manifest-test", setup }];
    const routes: [string, Parameters<typeof tempDir>[1], (root: string) => Partial<BuildConfig>][] = [
      [
        "from the files map",
        {},
        root => ({
          files: {
            [join(root, "index.html")]: page(link),
            [join(root, "site.webmanifest")]: manifest,
            [join(root, "a.png")]: "PNG a",
          },
        }),
      ],
      [
        "after an onResolve that declines",
        onDisk,
        () => ({ plugins: plugin(build => build.onResolve({ filter: /.*/ }, () => undefined)) }),
      ],
      [
        "after an onResolve that returns its path",
        onDisk,
        root => ({
          plugins: plugin(build =>
            build.onResolve({ filter: /webmanifest$/ }, () => ({ path: join(root, "site.webmanifest") })),
          ),
        }),
      ],
      [
        "with an onResolve that returns the path of the image",
        onDisk,
        root => ({
          plugins: plugin(build => build.onResolve({ filter: /a\.png$/ }, () => ({ path: join(root, "a.png") }))),
        }),
      ],
      [
        "from an onLoad",
        onDisk,
        () => ({
          plugins: plugin(build =>
            build.onLoad({ filter: /webmanifest$/ }, () => ({ contents: manifest, loader: "file" })),
          ),
        }),
      ],
      [
        "from an onLoad that awaits defer()",
        onDisk,
        () => ({
          plugins: plugin(build =>
            build.onLoad({ filter: /webmanifest$/ }, async ({ defer }) => {
              await defer();
              return { contents: manifest, loader: "file" };
            }),
          ),
        }),
      ],
      ...[
        ["app.js", "index.html"],
        ["index.html", "app.js"],
      ].map((entrypoints): (typeof routes)[number] => [
        `when ${entrypoints[0]} is the first of two entry points that reach it`,
        { ...onDisk, "app.js": `import url from "./site.webmanifest"; console.log(url);` },
        root => ({ entrypoints: entrypoints.map(file => join(root, file)) }),
      ]),
    ];

    test.each(routes)("%s", async (_, files, config) => {
      using built = await buildPage(files, config);
      expect(built.logs).toEqual([]);
      const icon = only(built.outputs, /^a-[0-9a-z]+\.png$/);
      expect(built.outputs[icon]).toBe("PNG a");
      expect(built.outputs[webManifest(built.outputs)]).toBe(`{"icons":[{"src":"./${icon}"}]}`);
    });
  });

  // A copied file is also a module whose default export is its URL.
  describe("a script that imports the manifest gets its URL", () => {
    const files = {
      "index.html": page(link, script),
      "site.webmanifest": `{"icons":[{"src":"./a.png"}]}`,
      "a.png": "PNG a",
    };
    const shapes: [string, string, Partial<BuildConfig>][] = [
      ["import", `import url from "./site.webmanifest"; console.log(url);`, {}],
      ["import *", `import * as ns from "./site.webmanifest"; console.log(ns.default);`, {}],
      ["require()", `export {}; console.log(require("./site.webmanifest"));`, {}],
      ["import()", `console.log((await import("./site.webmanifest")).default);`, {}],
      ["import() with splitting", `console.log((await import("./site.webmanifest")).default);`, { splitting: true }],
    ];

    test.each(shapes)("%s", async (_, app, config) => {
      using built = await buildPage({ ...files, "app.js": app }, () => config);
      expect(built.logs).toEqual([]);
      const manifest = webManifest(built.outputs);
      const icon = only(built.outputs, /^a-[0-9a-z]+\.png$/);
      expect(built.outputs[manifest]).toBe(`{"icons":[{"src":"./${icon}"}]}`);

      // The script that the emitted page loads.
      const [, entry] = built.outputs["index.html"].match(/<script type="module" crossorigin src="\.\/([^"]+)">/)!;
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(built.outdir, entry)],
        env: bunEnv,
        cwd: built.outdir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: `./${manifest}\n`, stderr: "", exitCode: 0 });
    });
  });

  test("a file that a script imports as text stays text", async () => {
    const manifest = `{"icons":[{"src":"./logo.svg"}]}`;
    using built = await buildPage({
      "index.html": page(link, script),
      "site.webmanifest": manifest,
      "logo.svg": "<svg>LOGO</svg>",
      "app.js": `import text from "./logo.svg" with { type: "text" }; console.log(text);`,
    });
    expect(built.logs).toEqual([]);
    const path = webManifest(built.outputs);
    expect(built.outputs[path]).toBe(manifest);
    expect(copied(built.outputs)).toEqual(["index.html", path].sort());
    expect(Object.entries(built.outputs).filter(([, text]) => text.includes("<svg>LOGO</svg>"))).toEqual([
      [expect.stringMatching(/\.js$/), expect.any(String)],
    ]);
  });

  test("a file that a plugin loads as JavaScript stays out of the page", async () => {
    const manifest = `{"icons":[{"src":"./logo.svg"}]}`;
    using built = await buildPage(
      {
        "index.html": page(link, script),
        "site.webmanifest": manifest,
        "logo.svg": "<svg>LOGO</svg>",
        "app.js": `console.log("app");`,
      },
      () => ({
        plugins: [
          {
            name: "svg-as-module",
            setup(build) {
              build.onLoad({ filter: /\.svg$/ }, () => ({ contents: `console.log("SVG MODULE");`, loader: "js" }));
            },
          },
        ],
      }),
    );
    expect(built.logs).toEqual([]);
    const path = webManifest(built.outputs);
    expect(built.outputs[path]).toBe(manifest);
    expect(Object.values(built.outputs).filter(text => text.includes("SVG MODULE"))).toEqual([]);
  });

  test("copies an image that CSS inlines", async () => {
    using built = await buildPage({
      "index.html": page(link, `<link rel="stylesheet" href="./styles.css">`),
      "site.webmanifest": `{"icons":[{"src":"./dot.png"}]}`,
      "styles.css": `body { background: url("./dot.png"); }`,
      "dot.png": "PNG dot",
    });
    expect(built.logs).toEqual([]);
    const icon = only(built.outputs, /^dot-[0-9a-z]+\.png$/);
    expect(built.outputs[icon]).toBe("PNG dot");
    expect(built.outputs[webManifest(built.outputs)]).toBe(`{"icons":[{"src":"./${icon}"}]}`);
    expect(built.outputs[only(built.outputs, /\.css$/)]).toContain("data:image/png;base64,");
  });

  test("its name changes with the paths that it holds", async () => {
    // Every build is in one folder: the name of a page depends on the folder it is in.
    using dir = tempDir("html-web-manifest-names", {
      "index.html": page(link),
      "site.webmanifest": `{"icons":[{"src":"./a.png"}]}`,
      "a.png": "PNG a",
    });
    const root = String(dir);
    let builds = 0;
    // The page's file name has its hash, so a change of the page's bytes shows in `names`.
    const names = async (config: Partial<BuildConfig> = {}) => {
      const outdir = join(root, "out" + builds++);
      const result = await Bun.build({
        entrypoints: [join(root, "index.html")],
        outdir,
        throw: false,
        naming: { entry: "[name]-[hash].[ext]" },
        ...config,
      });
      const paths = result.outputs.map(output => relative(outdir, output.path).replaceAll("\\", "/"));
      return {
        manifest: paths.find(path => path.endsWith(".webmanifest")),
        page: paths.find(path => path.endsWith(".html")),
      };
    };

    const first = await names();
    expect(first).toEqual({
      manifest: expect.stringMatching(/^site-[0-9a-z]+\.webmanifest$/),
      page: expect.stringMatching(/^index-[0-9a-z]+\.html$/),
    });
    expect(await names()).toEqual(first);

    const cdnA = await names({ publicPath: "https://a.example/" });
    const cdnB = await names({ publicPath: "https://b.example/" });
    expect(new Set([first.manifest, cdnA.manifest, cdnB.manifest]).size).toBe(3);

    // Only the bytes of the image change. The manifest holds its path, and the page holds the manifest's.
    writeFileSync(join(root, "a.png"), "PNG b");
    const otherIcon = await names();
    expect(otherIcon.manifest).not.toBe(first.manifest);
    expect(otherIcon.page).not.toBe(first.page);
  });

  test("standalone HTML inlines it as written", async () => {
    const manifest = `{"icons":[{"src":"./a.png"}]}`;
    using built = await buildPage({ "index.html": page(link), "site.webmanifest": manifest, "a.png": "PNG a" }, () => ({
      compile: true,
      target: "browser",
      outdir: undefined,
    }));
    expect(built.logs).toEqual([]);
    const [html] = Object.values(built.outputs);
    const [, inlined] = html.match(/rel="manifest" href="data:application\/manifest\+json;base64,([^"]+)"/)!;
    expect(Buffer.from(inlined, "base64").toString()).toBe(manifest);
  });
});
