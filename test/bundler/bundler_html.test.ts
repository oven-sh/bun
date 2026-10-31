import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { unsupported } from "../aot/harness/commands";
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

  itBundled("html/image-inlined-by-stylesheet", {
    outdir: "out/",
    files: {
      "/index.html": `<link rel="stylesheet" href="./style.css"><img src="./logo.png">`,
      "/style.css": `body { background: url("./logo.png"); }`,
      "/logo.png": "png bytes",
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      const src = api.readFile("out/index.html").match(/<img src="(.*?)">/)![1];
      expect(src).toMatch(/^\.\/logo-\w+\.png$/);
      expect(api.readFile("out/" + src)).toBe("png bytes");
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

  // lol-html doesn't infer end tags, so every <p> is open until </body>.
  itBundled("html/many-unclosed-elements", {
    outdir: "out/",
    backend: "cli",
    files: {
      "/index.html": Buffer.concat([
        Buffer.from(`<!DOCTYPE html><html><head><script src="./script.js"></script></head><body>\n`),
        Buffer.alloc(70_000 * "<p>x".length, "<p>x"),
        Buffer.from(`\n</body></html>`),
      ]),
      "/script.js": "console.log('Hello World')",
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      const pieces = api.readFile("out/index.html").split("<p>x");
      // Check the count first. If elements are missing, the diff below is huge.
      expect(pieces.length - 1).toBe(70_000);
      expect({ head: pieces[0], between: pieces.slice(1, -1).join(""), tail: pieces.at(-1)!.trim() }).toEqual({
        head: expect.stringMatching(/<script type="module" crossorigin src="\.\/index-[a-z0-9]+\.js">/),
        between: "",
        tail: "</body></html>",
      });
    },
  });

  // A stylesheet link must not put a script in the page. Bun reports the link and does not replace it with a <script>.
  itBundled("html/stylesheet-link-to-package-script", {
    outdir: "out/",
    files: {
      "/index.html": `<!doctype html><html><head><link rel="stylesheet" href="p"></head><body></body></html>`,
      "/node_modules/p/package.json": `{"name":"p","main":"./main"}`,
      "/node_modules/p/main.js": `console.log("is-main-js");`,
    },
    entryPoints: ["/index.html"],
    bundleErrors: {
      "/index.html": ['Cannot use "node_modules/p/main.js" as a stylesheet'],
    },
  });

  itBundled("html/stylesheet-link-to-scripts-and-pages", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <script src="./before.js"></script>
    <link rel="stylesheet" href="./before.js">
    <link rel="stylesheet" href="./script.js">
    <link rel="stylesheet" href="./typed.ts">
    <link rel="stylesheet" href="./other.html">
    <link rel="preload" as="style" href="./preloaded.js">
    <script src="./script.js"></script>
  </head>
  <body></body>
</html>`,
      "/before.js": `console.log("before");`,
      "/script.js": `import "./typed.ts";\nconsole.log("script");`,
      "/typed.ts": `console.log("typed" as string);`,
      "/other.html": `<!DOCTYPE html><html><head><script src="./other.js"></script></head><body></body></html>`,
      "/other.js": `console.log("other");`,
      "/preloaded.js": `console.log("preloaded");`,
    },
    entryPoints: ["/index.html"],
    bundleErrors: {
      "/index.html": [
        // A `<script src>` of the same file, before or after the link, does not make the link valid.
        'Cannot use "before.js" as a stylesheet',
        'Cannot use "script.js" as a stylesheet',
        // Nor does an import of the file by the page's script.
        'Cannot use "typed.ts" as a stylesheet',
        'Cannot use "other.html" as a stylesheet',
        'Cannot use "preloaded.js" as a stylesheet',
      ],
    },
  });

  itBundled("html/stylesheet-link-to-package-css", {
    outdir: "out/",
    files: {
      "/index.html": `<!doctype html><html><head><link rel="stylesheet" href="p"></head><body></body></html>`,
      "/node_modules/p/package.json": `{"name":"p","main":"./main.css"}`,
      "/node_modules/p/main.css": `.from-package { color: blue; }`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      const href = html.match(/<link rel="stylesheet" crossorigin href="(\.\/index-[a-z0-9]+\.css)">/)?.[1];
      expect(href).toBeString();
      expect(api.readFile("out/" + href)).toContain(".from-package");
    },
  });

  // The loader that an `onLoad` plugin returns is the user's choice. A plugin can make a stylesheet of any file.
  itBundled("html/stylesheet-link-loaded-as-css-by-plugin", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./theme.scss">
    <link rel="stylesheet" href="./generated.js">
  </head>
  <body></body>
</html>`,
      "/theme.scss": `$color: red;`,
      "/generated.js": `not a script`,
    },
    entryPoints: ["/index.html"],
    plugins(builder) {
      builder.onLoad({ filter: /theme\.scss$/ }, () => ({ contents: `.from-scss { color: red; }`, loader: "css" }));
      builder.onLoad({ filter: /generated\.js$/ }, () => ({ contents: `.from-js { color: green; }`, loader: "css" }));
    },
    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      const href = html.match(/<link rel="stylesheet" crossorigin href="(\.\/index-[a-z0-9]+\.css)">/)?.[1];
      expect(href).toBeString();
      const css = api.readFile("out/" + href);
      expect(css).toContain(".from-scss");
      expect(css).toContain(".from-js");
    },
  });

  // A plugin can also make a script of a stylesheet, to add the styles at run time. That page builds.
  // The same holds for a module that a plugin makes: it is not a script file.
  itBundled("html/stylesheet-link-loaded-as-script-by-plugin", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css">
    <link rel="stylesheet" href="virtual:styles.js">
  </head>
  <body></body>
</html>`,
      "/styles.css": `body { color: red; }`,
    },
    entryPoints: ["/index.html"],
    plugins(builder) {
      builder.onLoad({ filter: /styles\.css$/ }, () => ({
        contents: `console.log("styles-from-plugin");`,
        loader: "js",
      }));
      builder.onResolve({ filter: /^virtual:styles\.js$/ }, () => ({ path: "styles.js", namespace: "virtual" }));
      builder.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
        contents: `console.log("virtual-from-plugin");`,
        loader: "js",
      }));
    },
    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      const src = html.match(/<script type="module" crossorigin src="(\.\/index-[a-z0-9]+\.js)"><\/script>/)?.[1];
      expect(src).toBeString();
      expect(html).not.toContain("<link");
      const script = api.readFile("out/" + src);
      expect(script).toContain("styles-from-plugin");
      expect(script).toContain("virtual-from-plugin");
    },
  });

  // A script file stays a script when an `onLoad` plugin declines it, transforms it, or returns its contents.
  itBundled("html/stylesheet-link-to-script-that-plugin-loads", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./declined.js">
    <link rel="stylesheet" href="./transformed.js">
    <link rel="stylesheet" href="./returned.ts">
  </head>
  <body></body>
</html>`,
      "/declined.js": `console.log("declined");`,
      "/transformed.js": `console.log("transformed");`,
      "/returned.ts": `console.log("returned" as string);`,
    },
    entryPoints: ["/index.html"],
    plugins(builder) {
      builder.onLoad({ filter: /declined\.js$/ }, () => undefined);
      builder.onLoad({ filter: /transformed\.js$/ }, () => ({ contents: `console.log("by-plugin");`, loader: "jsx" }));
      builder.onLoad({ filter: /returned\.ts$/ }, () => ({ contents: `console.log("by-plugin");` }));
    },
    bundleErrors: {
      "/index.html": [
        'Cannot use "declined.js" as a stylesheet',
        'Cannot use "transformed.js" as a stylesheet',
        'Cannot use "returned.ts" as a stylesheet',
      ],
    },
  });

  // A script that only imports CSS is still a script. Load it with <script type="module" src> to keep the styles.
  itBundled("html/stylesheet-link-to-script-that-imports-css", {
    outdir: "out/",
    files: {
      "/index.html": `<!doctype html><html><head><link rel="stylesheet" href="./styles.js"></head><body></body></html>`,
      "/styles.js": `import "./a.css";`,
      "/a.css": `body { color: red; }`,
    },
    entryPoints: ["/index.html"],
    bundleErrors: {
      "/index.html": ['Cannot use "styles.js" as a stylesheet'],
    },
  });

  // The check is about scripts and pages only. It does not decide what a link to a data file becomes.
  itBundled("html/stylesheet-link-to-data-files", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./data.json">
    <link rel="stylesheet" href="./notes.txt">
    <link rel="stylesheet" href="./doc.md">
    <link rel="stylesheet" href="./conf.toml">
    <link rel="stylesheet" href="./data.yaml">
    <link rel="preload" as="style" href="./preloaded.json">
  </head>
  <body></body>
</html>`,
      "/data.json": `{ "marker": "json-data-marker" }`,
      "/notes.txt": `text-data-marker`,
      "/doc.md": `# md-data-marker`,
      "/conf.toml": `marker = "toml-data-marker"`,
      "/data.yaml": `marker: yaml-data-marker`,
      "/preloaded.json": `{ "marker": "preloaded-data-marker" }`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      const src = html.match(/<script type="module" crossorigin src="(\.\/index-[a-z0-9]+\.js)"><\/script>/)?.[1];
      expect(src).toBeString();
      expect(api.readFile("out/" + src)).not.toContain("-data-marker");
    },
  });

  // An `onResolve` plugin picks the file, not the loader. Bun loads these two files as scripts by itself.
  itBundled("html/stylesheet-link-resolved-to-script-by-plugin", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="virtual:theme">
    <link rel="stylesheet" href="./declined.js">
  </head>
  <body></body>
</html>`,
      "/theme.js": `console.log("theme");`,
      "/declined.js": `console.log("declined");`,
    },
    entryPoints: ["/index.html"],
    plugins(builder) {
      builder.onResolve({ filter: /^virtual:theme$/ }, args => ({ path: join(dirname(args.importer), "theme.js") }));
      builder.onResolve({ filter: /declined\.js$/ }, () => undefined);
    },
    bundleErrors: {
      "/index.html": ['Cannot use "theme.js" as a stylesheet', 'Cannot use "declined.js" as a stylesheet'],
    },
  });

  // A page that is not an entry point goes through the same check.
  itBundled("html/stylesheet-link-to-script-in-page-imported-by-script", {
    outdir: "out/",
    target: "browser",
    files: {
      "/entry.js": `import "./page.html";`,
      "/page.html": `<!doctype html><html><head><link rel="stylesheet" href="./theme.js"></head><body></body></html>`,
      "/theme.js": `console.log("theme");`,
    },
    entryPoints: ["/entry.js"],
    bundleErrors: {
      "/page.html": ['Cannot use "theme.js" as a stylesheet'],
    },
  });

  itBundled("html/stylesheet-link-to-script-in-page-imported-by-server", {
    outdir: "out/",
    target: "bun",
    files: {
      "/server.ts": `import page from "./page.html";\nconsole.log(page);`,
      "/page.html": `<!doctype html><html><head><link rel="stylesheet" href="./theme.js"></head><body></body></html>`,
      "/theme.js": `console.log("theme");`,
    },
    entryPoints: ["/server.ts"],
    bundleErrors: {
      "/page.html": ['Cannot use "theme.js" as a stylesheet'],
    },
  });

  // The ways to keep such a link: mark the file external, or load it with a loader that is not a script.
  itBundled("html/stylesheet-link-to-external-script", {
    outdir: "out/",
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./theme.js">
    <link rel="stylesheet" href="p">
    <link rel="stylesheet" href="virtual:theme">
  </head>
  <body></body>
</html>`,
      "/theme.js": `console.log("theme-marker");`,
      "/node_modules/p/package.json": `{"name":"p","main":"./main"}`,
      "/node_modules/p/main.js": `console.log("package-marker");`,
    },
    entryPoints: ["/index.html"],
    external: ["./theme.js", "p"],
    plugins(builder) {
      builder.onResolve({ filter: /^virtual:theme$/ }, args => ({ path: args.path, external: true }));
    },
    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      expect(html).toContain(`<link rel="stylesheet" href="./theme.js">`);
      expect(html).toContain(`<link rel="stylesheet" href="p">`);
      expect(html).toContain(`<link rel="stylesheet" href="virtual:theme">`);
      const src = html.match(/<script type="module" crossorigin src="(\.\/index-[a-z0-9]+\.js)"><\/script>/)?.[1];
      expect(src).toBeString();
      expect(api.readFile("out/" + src)).not.toContain("-marker");
    },
  });

  itBundled("html/stylesheet-link-to-script-with-packages-external", {
    outdir: "out/",
    files: {
      "/index.html": `<!doctype html><html><head><link rel="stylesheet" href="p"></head><body></body></html>`,
      "/node_modules/p/package.json": `{"name":"p","main":"./main"}`,
      "/node_modules/p/main.js": `console.log("package-marker");`,
    },
    entryPoints: ["/index.html"],
    packages: "external",
    onAfterBundle(api) {
      expect(api.readFile("out/index.html")).toContain(`<link rel="stylesheet" href="p">`);
    },
  });

  itBundled("html/stylesheet-link-to-script-with-file-loader", {
    outdir: "out/",
    files: {
      "/index.html": `<!doctype html><html><head><link rel="stylesheet" href="./theme.js"></head><body></body></html>`,
      "/theme.js": `console.log("theme-marker");`,
    },
    entryPoints: ["/index.html"],
    loader: { ".js": "file" },
    onAfterBundle(api) {
      const html = api.readFile("out/index.html");
      const href = html.match(/<link rel="stylesheet" href="(\.\/theme-[a-z0-9]+\.js)">/)?.[1];
      expect(href).toBeString();
      expect(api.readFile("out/" + href)).toBe(`console.log("theme-marker");`);
    },
  });
});

describe("a stylesheet link to a script", () => {
  const page = (href: string) =>
    `<!doctype html><html><head><link rel="stylesheet" href="${href}"></head><body></body></html>`;
  const note = (href: string) =>
    `The stylesheet link "${href}" resolves to this file, and the "jsx" loader loads it. Link a CSS file, or use <script src> for a script.`;
  const files = {
    "index.html": page("./theme.js"),
    "theme.js": `console.log("theme");`,
    "server.ts": `import page from "./index.html";\nconsole.log(page);`,
  };

  // Each command prints the file, the link and the loader, writes nothing and exits with code 1.
  test.concurrent.each([
    { args: ["build", "./index.html", "--outdir", "out"], output: "out" },
    { args: ["build", "--target=bun", "./server.ts", "--outdir", "out"], output: "out" },
    { args: ["build", "--compile", "./server.ts", "--outfile", "app"], output: "app" },
    // `--aot` checks the program as `bun build --compile` does before it runs it. The program does not run.
    ...(unsupported ? [] : [{ args: ["--aot", "./server.ts"], output: "out" }]),
  ])("bun $args fails", async ({ args, output }) => {
    using dir = tempDir("html-stylesheet-link-cli", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({
      stdout,
      stderr: normalizeBunSnapshot(stderr, String(dir)),
      wroteOutput: existsSync(join(String(dir), output)) || existsSync(join(String(dir), output + ".exe")),
      exitCode,
    }).toEqual({
      stdout: "",
      stderr: [
        'error: Cannot use "theme.js" as a stylesheet',
        "    at <dir>/index.html",
        "",
        "note: " + note("./theme.js"),
      ].join("\n"),
      wroteOutput: false,
      exitCode: 1,
    });
  });

  const failed = (build: Bun.BuildOutput) => ({
    success: build.success,
    outputs: build.outputs,
    errors: build.logs.map(log => ({ message: log.message, notes: log.notes.map(note => note.message) })),
  });

  // The note quotes the href when it is the text of the attribute. The HTML scanner replaces a rooted href with an absolute path,
  // and the note quotes no path. It does the same for a bare href today, so the note then quotes the attribute or nothing.
  const noteWithoutHref = `A stylesheet link resolves to this file, and the "jsx" loader loads it. Link a CSS file, or use <script src> for a script.`;
  test.concurrent.each([
    {
      href: "./theme.js",
      page: "app/index.html",
      script: "app/theme.js",
      entry: "./index.html",
      file: "theme.js",
      notes: [note("./theme.js")],
    },
    {
      href: "/theme.js",
      page: "app/index.html",
      script: "app/theme.js",
      entry: "./index.html",
      file: "theme.js",
      notes: [noteWithoutHref],
    },
    {
      href: "theme.js",
      page: "app/src/index.html",
      script: "app/src/theme.js",
      entry: "./src/index.html",
      file: "src/theme.js",
      notes: [noteWithoutHref, note("theme.js")],
    },
    // The name of the page's directory starts with the name of the working directory.
    {
      href: "theme.js",
      page: "app-v2/index.html",
      script: "app-v2/theme.js",
      entry: "../app-v2/index.html",
      file: "../app-v2/theme.js",
      notes: [noteWithoutHref, note("theme.js")],
    },
  ])("Bun.build names the link $href of $page", async ({ href, page: pagePath, script, entry, file, notes }) => {
    using dir = tempDir("html-stylesheet-link-href", {
      "app/package.json": `{}`,
      [pagePath]: page(href),
      [script]: files["theme.js"],
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const build = await Bun.build({ entrypoints: [${JSON.stringify(entry)}], throw: false });
         console.log(JSON.stringify(build.logs.map(log => ({ message: log.message, notes: log.notes.map(note => note.message) }))));`,
      ],
      env: bunEnv,
      cwd: join(String(dir), "app"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const logs = stdout === "" ? null : JSON.parse(stdout);
    expect({ logs, stderr, exitCode }).toEqual({
      logs: [{ message: `Cannot use "${file}" as a stylesheet`, notes: [expect.any(String)] }],
      stderr: "",
      exitCode: 0,
    });
    expect(notes).toContain(logs[0].notes[0]);
  });

  test.concurrent("Bun.build with compile and target browser fails", async () => {
    using dir = tempDir("html-stylesheet-link-standalone", files);
    const build = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      compile: true,
      target: "browser",
      throw: false,
    });
    expect(failed(build)).toEqual({
      success: false,
      outputs: [],
      errors: [
        { message: expect.stringMatching(/^Cannot use ".*theme\.js" as a stylesheet$/), notes: [note("./theme.js")] },
      ],
    });
  });

  test.concurrent("Bun.build with in-memory files fails", async () => {
    const build = await Bun.build({
      entrypoints: ["/html-stylesheet-link-in-memory/index.html"],
      files: {
        "/html-stylesheet-link-in-memory/index.html": files["index.html"],
        "/html-stylesheet-link-in-memory/theme.js": files["theme.js"],
      },
      throw: false,
    });
    expect(failed(build)).toEqual({
      success: false,
      outputs: [],
      errors: [
        { message: expect.stringMatching(/^Cannot use ".*theme\.js" as a stylesheet$/), notes: [note("./theme.js")] },
      ],
    });
  });

  // Not fixed yet. The asset tags and `<link as="worker">` also lose the tag and put a script target in the page's script.
  test.todo("an asset tag or a worker link to a script does not put the script in the page", async () => {
    using dir = tempDir("html-tag-to-script", {
      "index.html": `<!doctype html><html><head><link rel="icon" href="./icon.ts"><link rel="preload" as="worker" href="./worker.js"></head><body><img src="./pixel.js"></body></html>`,
      "icon.ts": `console.log("icon-marker" as string);`,
      "worker.js": `console.log("worker-marker");`,
      "pixel.js": `console.log("pixel-marker");`,
    });
    const build = await Bun.build({ entrypoints: [join(String(dir), "index.html")], throw: false });
    // A fix can copy the files or fail the build. In both cases no script that the page loads holds a marker.
    const html = (await build.outputs.find(output => output.path.endsWith(".html"))?.text()) ?? "";
    const loaded = [...html.matchAll(/<script[^>]*\ssrc="\.\/([^"]+)"/g)].map(match => match[1]);
    const scripts = await Promise.all(
      build.outputs.filter(output => loaded.some(name => output.path.endsWith(name))).map(output => output.text()),
    );
    expect(scripts.join("\n")).not.toContain("-marker");
  });
});
