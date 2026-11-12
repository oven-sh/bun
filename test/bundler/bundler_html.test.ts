import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
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

  const stylesheetOf = (api: { readFile(path: string): string }, page: string) =>
    api.readFile("out/" + api.readFile("out/" + page).match(/href="(.*?\.css)"/)![1]);

  // The import orders of the two pages differ only in the media query of a layer list.
  itBundled("html/SeparateCSSWhenImportConditionsDiffer", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/first.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./r0.css" />
    <link rel="stylesheet" href="./r1.css" />
  </head>
  <body><div class="x"></div></body>
</html>`,
      "/second.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./f1.css" />
    <link rel="stylesheet" href="./r0.css" />
    <link rel="stylesheet" href="./r1.css" />
  </head>
  <body><div class="x"></div></body>
</html>`,
      "/r0.css": `@import "./f1.css" screen;\n@layer a { .x { color: green } }`,
      "/r1.css": `@import "./f1.css";\n.r1 { color: blue }`,
      "/f1.css": `@layer b { .x { color: red } }`,
    },
    entryPoints: ["/first.html", "/second.html"],
    onAfterBundle(api) {
      const rest = `@layer a{.x{color:green}}@layer b{.x{color:red}}.r1{color:#00f}\n`;
      // Without screen media the layer order is a, b on the first page. It is b, a on the second page.
      expect({ first: stylesheetOf(api, "first.html"), second: stylesheetOf(api, "second.html") }).toEqual({
        first: `@media screen{@layer b;}` + rest,
        second: `@layer b;` + rest,
      });
    },
  });

  // The import orders of the two pages differ only in the names of a layer list: "x.y, z" and "x, yz".
  itBundled("html/SeparateCSSWhenLayerNamesDiffer", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/first.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./a.css" />
    <link rel="stylesheet" href="./d.css" />
    <link rel="stylesheet" href="./c.css" />
  </head>
  <body><div class="box"></div></body>
</html>`,
      "/second.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./b.css" />
    <link rel="stylesheet" href="./d.css" />
    <link rel="stylesheet" href="./c.css" />
  </head>
  <body><div class="box"></div></body>
</html>`,
      "/a.css": `@layer x.y, z;\n.a { color: blue }`,
      "/b.css": `@layer x, yz;\n.b { color: blue }`,
      "/c.css": `@import "./a.css";\n@import "./b.css";\n.c { color: blue }`,
      "/d.css": `@layer z { .box { color: red } }\n@layer yz { .box { color: green } }`,
    },
    entryPoints: ["/first.html", "/second.html"],
    onAfterBundle(api) {
      const rest =
        `@layer z{.box{color:red}}@layer yz{.box{color:green}}` +
        `@layer x.y,z;.a{color:#00f}@layer x,yz;.b{color:#00f}.c{color:#00f}\n`;
      // The layer "yz" wins on the first page. The layer "z" wins on the second page.
      expect({ first: stylesheetOf(api, "first.html"), second: stylesheetOf(api, "second.html") }).toEqual({
        first: `@layer x.y,z;` + rest,
        second: `@layer x,yz;` + rest,
      });
    },
  });

  // With CSS chunking on, a CSS entry point and the stylesheet of a page get the same hash for different import orders.
  itBundled("html/SeparateCSSForCSSEntryPointProduction", {
    outdir: "out/",
    production: true,
    files: {
      "/page.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./r.css" />
    <link rel="stylesheet" href="./s.css" />
  </head>
  <body><div class="s"></div></body>
</html>`,
      "/r.css": `@layer a { .r { color: red } }`,
      "/m.css": `@layer b { .m { color: blue } }`,
      "/s.css": `@import "./r.css" print;\n@import "./m.css";\n@import "./r.css";\n.s { color: green }`,
    },
    entryPoints: ["/page.html", "/s.css"],
    onAfterBundle(api) {
      const rest = `@layer b{.m{color:#00f}}@layer a{.r{color:red}}.s{color:green}\n`;
      expect({ page: stylesheetOf(api, "page.html"), entry: api.readFile("out/s.css") }).toEqual({
        page: `@layer a;` + rest,
        entry: `@media print{@layer a;}` + rest,
      });
    },
  });

  // The `<link>` tags of the page that Bun wrote, and the CSS file of the page.
  const linksAndStylesheetOf = (api: { readFile(path: string): string }, page: string) => {
    const html = api.readFile("out/" + page);
    return {
      links: html.match(/<link\b[^>]*>/g)!.map(tag => tag.replace(/-[a-z0-9]{8}\./, "-[hash].")),
      css: api.readFile("out/" + html.match(/ crossorigin href="(.*?\.css)"/)![1]),
    };
  };

  // https://github.com/oven-sh/bun/issues/18526
  itBundled("html/LinkWithMedia", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <title>Imprimé ☕</title>
    <link rel="stylesheet" href="./screen.css">
    <link rel="stylesheet" type="text/css" href="./print.css" media="print" />
  </head>
  <body><script type="module" src="./app.js"></script></body>
</html>`,
      "/screen.css": `body { color: red }`,
      "/print.css": `body { color: black }`,
      "/app.js": `console.log(1)`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      // The page still has one CSS file. The rules of print.css are in it, under the media of their link.
      expect(linksAndStylesheetOf(api, "index.html")).toEqual({
        links: [`<link rel="stylesheet" crossorigin href="./index-[hash].css">`],
        css: `body{color:red}@media print{body{color:#000}}\n`,
      });
    },
  });

  // A stylesheet with `media` stays between the stylesheets that the page loads before it and after it.
  itBundled("html/LinksWithMediaKeepTheCascadeOrder", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./a.css">
    <link rel="stylesheet" href="https://cdn.example.com/framework.css" media="print">
    <link rel="stylesheet" href="./print.css" media="print">
    <script type="module" src="./app.js"></script>
    <link rel="stylesheet" href="./b.css">
  </head>
  <body>
    <link rel="stylesheet" as="style" href="./narrow.css" media="screen and (max-width: 600px), (orientation: portrait)">
    <link rel="stylesheet" href="./c.css">
  </body>
</html>`,
      "/a.css": `.a { color: red }`,
      // The media of the link also applies to what its stylesheet imports.
      "/print.css": `@import "./print-base.css";\n.print { color: black }`,
      "/print-base.css": `.print-base { color: black }`,
      "/from-script.css": `.from-script { color: red }`,
      "/b.css": `.b { color: red }`,
      "/narrow.css": `.narrow { color: red }`,
      "/c.css": `.c { color: red }`,
      "/app.js": `import "./from-script.css";\nimport "./a.css";`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      expect(linksAndStylesheetOf(api, "index.html")).toEqual({
        // Bun does not bundle the first link, so it stays as it is.
        links: [
          `<link rel="stylesheet" href="https://cdn.example.com/framework.css" media="print">`,
          `<link rel="stylesheet" crossorigin href="./index-[hash].css">`,
        ],
        css:
          `.a{color:red}` +
          `@media print{.print-base{color:#000}}@media print{.print{color:#000}}` +
          `.from-script{color:red}.b{color:red}` +
          `@media screen and (max-width:600px),(orientation:portrait){.narrow{color:red}}` +
          `.c{color:red}\n`,
      });
    },
  });

  // A stylesheet that the page also loads with no `media`, after its link, applies for every medium.
  itBundled("html/StylesheetLinkedWithMediaAndLoadedWithout", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/two-media.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./theme.css" media="print">
    <link rel="stylesheet" href="./theme.css" media="(orientation: portrait)">
  </head>
  <body></body>
</html>`,
      "/script-last.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./theme.css" media="print">
    <link rel="stylesheet" href="./other.css">
    <script type="module" src="./app.js"></script>
  </head>
  <body></body>
</html>`,
      "/script-first.html": `<!doctype html>
<html>
  <head>
    <script type="module" src="./app.js"></script>
    <link rel="stylesheet" href="./other.css">
    <link rel="stylesheet" href="./theme.css" media="print">
  </head>
  <body></body>
</html>`,
      "/link-last.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./theme.css" media="print">
    <link rel="stylesheet" href="./other.css">
    <link rel="stylesheet" href="./theme.css">
  </head>
  <body></body>
</html>`,
      "/theme.css": `.theme { color: red }`,
      "/other.css": `.other { color: red }`,
      "/app.js": `import "./theme.css";`,
    },
    entryPoints: ["/two-media.html", "/script-last.html", "/script-first.html", "/link-last.html"],
    onAfterBundle(api) {
      expect({
        twoMedia: stylesheetOf(api, "two-media.html"),
        scriptLast: stylesheetOf(api, "script-last.html"),
        scriptFirst: stylesheetOf(api, "script-first.html"),
        linkLast: stylesheetOf(api, "link-last.html"),
      }).toEqual({
        twoMedia: `@media print{.theme{color:red}}@media (orientation:portrait){.theme{color:red}}\n`,
        scriptLast: `.other{color:red}.theme{color:red}\n`,
        // In print the link loads theme.css again, after other.css.
        scriptFirst: `.theme{color:red}.other{color:red}@media print{.theme{color:red}}\n`,
        linkLast: `.other{color:red}.theme{color:red}\n`,
      });
    },
  });

  // On a page with a link under `media`, each link applies its stylesheet at its own place, as in a browser.
  // So the CSS of the page is that of one stylesheet with an "@import" for each link.
  {
    const pages = {
      "x@print s x s": `.x{color:red}.s{color:red}\n`,
      "x@print s x": `.s{color:red}.x{color:red}\n`,
      "x@print s s x": `.s{color:red}.x{color:red}\n`,
      "x@print x s": `.x{color:red}.s{color:red}\n`,
      "x s x@print s": `.x{color:red}@media print{.x{color:red}}.s{color:red}\n`,
      "x@print s x@print s": `@media print{.x{color:red}}.s{color:red}\n`,
    };
    const linksOf = (page: string) => page.split(" ").map(link => link.split("@"));
    itBundled("html/EachLinkOnPageWithMediaAppliesAtItsPlace", {
      outdir: "out/",
      minifyWhitespace: true,
      files: {
        ...Object.fromEntries(
          Object.keys(pages).flatMap((page, i) => [
            [
              `/page${i}.html`,
              `<!doctype html><html><head>` +
                linksOf(page)
                  .map(
                    ([file, media]) =>
                      `<link rel="stylesheet" href="./${file}.css"${media ? ` media="${media}"` : ""}>`,
                  )
                  .join("") +
                `</head><body></body></html>`,
            ],
            [
              `/imports${i}.css`,
              linksOf(page)
                .map(([file, media]) => `@import "./${file}.css" ${media ?? ""};`)
                .join("\n"),
            ],
          ]),
        ),
        "/x.css": `.x { color: red }`,
        "/s.css": `.s { color: red }`,
      },
      entryPoints: Object.keys(pages).flatMap((_, i) => [`/page${i}.html`, `/imports${i}.css`]),
      onAfterBundle(api) {
        const built = Object.keys(pages).map((page, i) => [
          page,
          stylesheetOf(api, `page${i}.html`),
          api.readFile(`out/imports${i}.css`),
        ]);
        expect(built).toEqual(Object.entries(pages).map(([page, css]) => [page, css, css]));
      },
    });
  }

  // Each of these links applies its stylesheet for every medium, as it does without `media`. Bun warns about none.
  itBundled("html/LinksWithMediaThatStayUnconditional", {
    outdir: "out/",
    minifyWhitespace: true,
    bundleWarnings: {},
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./empty.css" media="">
    <link rel="stylesheet" href="./all.css" media=" ALL ">
    <link rel="stylesheet" href="./all-comma.css" media="all,">
    <link rel="stylesheet" href="./comment.css" media="/**/">
    <link rel="stylesheet" href="./first-of-two.css" media="all" media="print">
    <link rel="stylesheet" href="./onload.css" media="print" onload="this.media='all'">
    <link rel="stylesheet" href="./disabled.css" media="print" disabled>
    <link rel="stylesheet" href="./id.css" media="print" id="async">
    <link rel="stylesheet" href="./class.css" media="print" class="async">
    <link rel="stylesheet" href="./data.css" media="print" data-beasties-media="all">
    <link rel="stylesheet" href="./title.css" media="print" title="Print">
    <link rel="stylesheet" href="./unknown.css" media="print" async-css>
    <link rel="preload" as="style" href="./preload.css" media="print">
    <link rel="preload" rel="stylesheet" as="style" href="./first-rel.css" media="print">
    <link rel="stylesheet" href="./notes.txt" media="print">
    <link rel="stylesheet" href="./module.js" media="print">
  </head>
  <body></body>
</html>`,
      "/empty.css": `.empty { color: red }`,
      "/all.css": `.all { color: red }`,
      "/all-comma.css": `.all-comma { color: red }`,
      "/comment.css": `.comment { color: red }`,
      "/first-of-two.css": `.first-of-two { color: red }`,
      "/onload.css": `.onload { color: red }`,
      "/disabled.css": `.disabled { color: red }`,
      "/id.css": `.id { color: red }`,
      "/class.css": `.class { color: red }`,
      "/data.css": `.data { color: red }`,
      "/title.css": `.title { color: red }`,
      "/unknown.css": `.unknown { color: red }`,
      "/preload.css": `.preload { color: red }`,
      "/first-rel.css": `.first-rel { color: red }`,
      "/notes.txt": `not a stylesheet`,
      "/module.js": `import "./from-module.css";`,
      "/from-module.css": `.from-module { color: red }`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      expect(linksAndStylesheetOf(api, "index.html")).toEqual({
        links: [
          `<link rel="stylesheet" href="./notes.txt" media="print">`,
          `<link rel="stylesheet" crossorigin href="./index-[hash].css">`,
        ],
        css:
          `.empty{color:red}.all{color:red}.all-comma{color:red}.comment{color:red}.first-of-two{color:red}` +
          `.onload{color:red}.disabled{color:red}` +
          `.id{color:red}.class{color:red}.data{color:red}.title{color:red}.unknown{color:red}` +
          `.preload{color:red}.first-rel{color:red}.from-module{color:red}\n`,
      });
    },
  });

  // The browser reads these links as stylesheet links with a `media`, and so does Bun.
  itBundled("html/LinkFormsWithMedia", {
    outdir: "out/",
    minifyWhitespace: true,
    bundleWarnings: {},
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <link REL="StyleSheet" HREF="./upper.css" MEDIA="Print">
    <link rel="stylesheet" rel="alternate" href="./first-rel.css" media="print">
    <link rel="preload stylesheet" as="style" href="./tokens.css" media="screen">
    <link rel="stylesheet" as="style" href="./two-rows.css" media="print">
    <link rel="stylesheet" href="./first-media.css" media="print" media="all">
    <link rel="stylesheet" href="./list.css" media="print,">
    <link rel="stylesheet" type="text/css" crossorigin="anonymous" integrity="sha384-AAAA" referrerpolicy="no-referrer" fetchpriority="low" blocking="render" hreflang="en" charset="utf-8" nonce="AAAA" href="./loading.css" media="print">
  </head>
  <body></body>
</html>`,
      "/upper.css": `.upper { color: red }`,
      "/first-rel.css": `.first-rel { color: red }`,
      "/tokens.css": `.tokens { color: red }`,
      "/two-rows.css": `.two-rows { color: red }`,
      "/first-media.css": `.first-media { color: red }`,
      "/list.css": `.list { color: red }`,
      "/loading.css": `.loading { color: red }`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      expect(stylesheetOf(api, "index.html")).toBe(
        `@media print{.upper{color:red}}@media print{.first-rel{color:red}}@media screen{.tokens{color:red}}` +
          `@media print{.two-rows{color:red}}@media print{.first-media{color:red}}@media print{.list{color:red}}` +
          `@media print{.loading{color:red}}\n`,
      );
    },
  });

  const cannotParse = (media: string) => `Bun cannot parse the media query list "${media}" of this <link>`;

  // Bun warns about a `media` that it cannot parse. The page then builds as it does without that `media`.
  itBundled("html/LinksWithMediaThatBunCannotParse", {
    outdir: "out/",
    minifyWhitespace: true,
    bundleWarnings: {
      "/rejected.html": [
        cannotParse("print and"),
        cannotParse("(width &gt;= 600px)"),
        cannotParse("screen,,print"),
        cannotParse(",print"),
      ],
      "/preload-first.html": [cannotParse("print and")],
      "/loaded-twice.html": [cannotParse(",")],
      // One warning for a link that matches two rows of the scanner.
      "/two-rows.html": [cannotParse("print and")],
    },
    files: {
      "/rejected.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./a.css" media="print and">
    <link rel="stylesheet" href="./b.css" media="(width &gt;= 600px)">
    <link rel="stylesheet" href="./c.css" media="screen,,print">
    <link rel="stylesheet" href="./d.css" media=",print">
    <script type="module" src="./app.js"></script>
  </head>
  <body></body>
</html>`,
      "/preload-first.html": `<!doctype html>
<html>
  <head>
    <link rel="preload" as="style" href="./a.css">
    <link rel="stylesheet" href="./b.css">
    <link rel="stylesheet" href="./a.css" media="print and">
  </head>
  <body></body>
</html>`,
      "/loaded-twice.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./a.css">
    <link rel="stylesheet" href="./b.css">
    <link rel="stylesheet" href="./a.css" media=",">
  </head>
  <body></body>
</html>`,
      "/two-rows.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" as="style" href="./a.css" media="print and">
  </head>
  <body></body>
</html>`,
      "/a.css": `.a { color: red }`,
      "/b.css": `.b { color: red }`,
      "/c.css": `.c { color: red }`,
      "/d.css": `.d { color: red }`,
      "/app.js": `import "./a.css";`,
    },
    entryPoints: ["/rejected.html", "/preload-first.html", "/loaded-twice.html", "/two-rows.html"],
    onAfterBundle(api) {
      expect({
        rejected: stylesheetOf(api, "rejected.html"),
        preloadFirst: stylesheetOf(api, "preload-first.html"),
        loadedTwice: stylesheetOf(api, "loaded-twice.html"),
        twoRows: stylesheetOf(api, "two-rows.html"),
      }).toEqual({
        rejected: `.a{color:red}.b{color:red}.c{color:red}.d{color:red}\n`,
        preloadFirst: `.a{color:red}.b{color:red}\n`,
        loadedTwice: `.a{color:red}.b{color:red}\n`,
        twoRows: `.a{color:red}\n`,
      });
    },
  });

  // A page whose link has a `media` that gives no condition shares the CSS file of the same page without it.
  itBundled("html/LinkWithMediaThatGivesNoConditionSharesCssFile", {
    outdir: "out/",
    minifyWhitespace: true,
    chunkNaming: "[hash].[ext]",
    bundleWarnings: {
      "/rejected.html": [cannotParse(",")],
    },
    files: {
      "/plain.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./a.css">
  </head>
  <body></body>
</html>`,
      "/rejected.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./a.css" media=",">
  </head>
  <body></body>
</html>`,
      "/always.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./a.css" media="all,">
  </head>
  <body></body>
</html>`,
      "/a.css": `.a { color: red }`,
    },
    entryPoints: ["/plain.html", "/rejected.html", "/always.html"],
    onAfterBundle(api) {
      const [plain, rejected, always] = ["plain", "rejected", "always"].map(
        page => api.readFile(`out/${page}.html`).match(/href="(.*?\.css)"/)![1],
      );
      expect({ rejected, always, css: api.readFile("out/" + plain) }).toEqual({
        rejected: plain,
        always: plain,
        css: `.a{color:red}\n`,
      });
    },
  });

  // A preload of a stylesheet does not apply it. The link with `media` does.
  itBundled("html/PreloadOfStylesheetLinkedWithMedia", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <link rel="preload" as="style" href="./print.css">
    <link rel="stylesheet" href="./screen.css">
    <link rel="stylesheet" href="./print.css" media="print">
    <link rel="preload" as="style" href="./print.css">
  </head>
  <body></body>
</html>`,
      // This preload becomes a stylesheet link when it has loaded, so it applies print.css for every medium.
      "/onload.html": `<!doctype html>
<html>
  <head>
    <link rel="preload" as="style" href="./print.css" onload="this.rel='stylesheet'">
    <link rel="stylesheet" href="./screen.css">
    <link rel="stylesheet" href="./print.css" media="print">
  </head>
  <body></body>
</html>`,
      "/screen.css": `.screen { color: red }`,
      "/print.css": `.print { color: black }`,
    },
    entryPoints: ["/index.html", "/onload.html"],
    onAfterBundle(api) {
      expect({ index: stylesheetOf(api, "index.html"), onload: stylesheetOf(api, "onload.html") }).toEqual({
        index: `.screen{color:red}@media print{.print{color:#000}}\n`,
        onload: `.print{color:#000}.screen{color:red}@media print{.print{color:#000}}\n`,
      });
    },
  });

  // The script of the page imports the page. That must not load the stylesheet of the link a second time.
  itBundled("html/LinkWithMediaOnPageThatItsScriptImports", {
    outdir: "out/",
    minifyWhitespace: true,
    target: "browser",
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./print.css" media="print">
    <script type="module" src="./app.js"></script>
  </head>
  <body></body>
</html>`,
      "/print.css": `.print { color: black }`,
      "/app.js": `import "./index.html";\nimport "./from-script.css";`,
      "/from-script.css": `.from-script { color: red }`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      expect(stylesheetOf(api, "index.html")).toBe(`@media print{.print{color:#000}}.from-script{color:red}\n`);
    },
  });

  // Pages that load the same stylesheets under the same media share one CSS file.
  itBundled("html/PagesThatLinkOneStylesheetWithMedia", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/first.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./shared.css" media="print">
  </head>
  <body></body>
</html>`,
      "/second.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./shared.css" media="print">
  </head>
  <body></body>
</html>`,
      "/third.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./shared.css" media="screen">
  </head>
  <body></body>
</html>`,
      "/fourth.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./shared.css">
  </head>
  <body></body>
</html>`,
      "/shared.css": `.shared { color: red }`,
    },
    entryPoints: ["/first.html", "/second.html", "/third.html", "/fourth.html"],
    onAfterBundle(api) {
      const [first, second, third, fourth] = ["first", "second", "third", "fourth"].map(
        page => api.readFile(`out/${page}.html`).match(/href="(.*?\.css)"/)![1],
      );
      expect({
        first: api.readFile("out/" + first),
        third: api.readFile("out/" + third),
        fourth: api.readFile("out/" + fourth),
      }).toEqual({
        first: `@media print{.shared{color:red}}\n`,
        third: `@media screen{.shared{color:red}}\n`,
        fourth: `.shared{color:red}\n`,
      });
      expect(second).toBe(first);
      expect(new Set([first, third, fourth]).size).toBe(3);
    },
  });

  // A document with no <head>, and a name for the CSS file that has no hash and no page name in it.
  itBundled("html/LinkWithMediaInDocumentWithoutHead", {
    outdir: "out/",
    minifyWhitespace: true,
    chunkNaming: "static.[ext]",
    files: {
      "/index.html": `<link rel="stylesheet" href="./print.css" media="print"><p>text</p>`,
      "/print.css": `.print { color: black }`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      expect({ html: api.readFile("out/index.html"), css: api.readFile("out/static.css") }).toEqual({
        html: `<p>text</p><link rel="stylesheet" crossorigin href="./static.css"><script type="module" crossorigin src="./static.js"></script>\n`,
        css: `@media print{.print{color:#000}}\n`,
      });
    },
  });

  // A plugin loads each stylesheet. The link still gives its `media` to what the plugin returns.
  itBundled("html/LinkWithMediaToStylesheetFromPlugin", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./screen.css">
    <link rel="stylesheet" href="virtual:print" media="print">
  </head>
  <body></body>
</html>`,
      "/screen.css": `.screen { color: red }`,
    },
    entryPoints: ["/index.html"],
    plugins(builder) {
      builder.onResolve({ filter: /^virtual:print$/ }, () => ({ path: "print", namespace: "virtual" }));
      builder.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
        contents: `.print { color: black }`,
        loader: "css",
      }));
      builder.onLoad({ filter: /screen\.css$/ }, async ({ path }) => ({
        contents: (await Bun.file(path).text()) + `.from-plugin { color: blue }`,
        loader: "css",
      }));
    },
    onAfterBundle(api) {
      expect(stylesheetOf(api, "index.html")).toBe(
        `.screen{color:red}.from-plugin{color:#00f}@media print{.print{color:#000}}\n`,
      );
    },
  });

  // The `media` of the link is the first condition of each "@import" in its stylesheet. An external
  // "@import" with a condition of its own then nests in a "data:" stylesheet, as it does under a conditional "@import".
  itBundled("html/ExternalImportInStylesheetLinkedWithMedia", {
    outdir: "out/",
    minifyWhitespace: true,
    files: {
      "/index.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./print.css" media="print">
  </head>
  <body></body>
</html>`,
      "/print.css": `@import url("https://fonts.example.com/css?family=X");
@import url("https://fonts.example.com/css?family=Y") screen;
.print { color: black }`,
    },
    entryPoints: ["/index.html"],
    onAfterBundle(api) {
      expect(stylesheetOf(api, "index.html")).toBe(
        `@import "https://fonts.example.com/css?family=X" print;` +
          `@import "data:text/css,@import \\"https://fonts.example.com/css?family=Y\\" screen;" print;` +
          `@media print{.print{color:#000}}\n`,
      );
    },
  });

  // A CSS entry point and the page that links the same file with `media` do not print the same CSS.
  itBundled("html/LinkWithMediaAndCssEntryPointProduction", {
    outdir: "out/",
    production: true,
    files: {
      "/page.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./s.css" media="print">
  </head>
  <body></body>
</html>`,
      "/s.css": `.s { color: green }`,
    },
    entryPoints: ["/page.html", "/s.css"],
    onAfterBundle(api) {
      expect({ page: stylesheetOf(api, "page.html"), entry: api.readFile("out/s.css") }).toEqual({
        page: `@media print{.s{color:green}}\n`,
        entry: `.s{color:green}\n`,
      });
    },
  });

  // The `media` of a link reads as the media of an "@import" does. What "@import" rejects, the link reports.
  {
    const sameAsImport = [
      "PRINT",
      "Only Screen",
      "not print",
      "(width >= 600px)",
      "(400px < width < 700px)",
      "not (400px <= width <= 700px)",
      "(height > 50vh)",
      "screen and (min-width: 600px),\n      print and (orientation: landscape)",
      "print,",
    ];
    const rejected = ["only", "not", "print and", "screen and(min-width:1px)", ", print", "print; screen"];
    const page = (media: string) => `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./x.css" media="${media}">
  </head>
  <body></body>
</html>`;
    itBundled("html/LinkMediaReadsAsImportMedia", {
      outdir: "out/",
      minifyWhitespace: true,
      bundleWarnings: Object.fromEntries(rejected.map((media, i) => [`/rejected${i}.html`, [cannotParse(media)]])),
      files: {
        "/x.css": `.x { color: red }`,
        ...Object.fromEntries(
          sameAsImport.flatMap((media, i) => [
            [`/link${i}.html`, page(media)],
            [`/import${i}.css`, `@import "./x.css" ${media};`],
          ]),
        ),
        ...Object.fromEntries(rejected.map((media, i) => [`/rejected${i}.html`, page(media)])),
      },
      entryPoints: [
        ...sameAsImport.flatMap((_, i) => [`/link${i}.html`, `/import${i}.css`]),
        ...rejected.map((_, i) => `/rejected${i}.html`),
      ],
      onAfterBundle(api) {
        for (const [i, media] of sameAsImport.entries()) {
          const css = stylesheetOf(api, `link${i}.html`);
          expect({ media, css }).toEqual({ media, css: api.readFile(`out/import${i}.css`) });
          expect(css).toStartWith("@media ");
        }
        expect(rejected.map((_, i) => stylesheetOf(api, `rejected${i}.html`))).toEqual(
          rejected.map(() => `.x{color:red}\n`),
        );
      },
    });
  }

  // The import record of a link with `media` keeps the place of its tag for the linker, and an error shows that place.
  test("html/UnresolvedLinkWithMedia", async () => {
    using dir = tempDir("html-unresolved-link-media", {
      "index.html": `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./missing.css">
    <link rel="stylesheet" href="./missing-print.css" media="print">
  </head>
  <body></body>
</html>`,
    });
    const result = await Bun.build({ entrypoints: [`${dir}/index.html`], throw: false });
    expect({
      success: result.success,
      logs: result.logs.map(({ message, position }) => ({
        message,
        line: position?.line,
        column: position?.column,
        lineText: position?.lineText,
      })),
    }).toEqual({
      success: false,
      logs: [
        { message: `Could not resolve: "./missing.css"`, line: -1, column: -1, lineText: "" },
        {
          message: `Could not resolve: "./missing-print.css"`,
          line: 5,
          column: 5,
          lineText: `    <link rel="stylesheet" href="./missing-print.css" media="print">`,
        },
      ],
    });
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
});
