import { describe, expect } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { itBundled } from "../expectBundled";

// `import sheet from "./x.css" with { type: "css" }` is a CSS module script:
// in browser builds the default export is a constructed `CSSStyleSheet` and the
// file stays out of the page-level stylesheet.
// https://html.spec.whatwg.org/multipage/webappapis.html#css-module-script

// Bun has no `CSSStyleSheet`, so the bundles run against this stand-in, which
// records the text passed to `replaceSync()`.
const cssStyleSheetShim = /* js */ `
  globalThis.CSSStyleSheet = class CSSStyleSheet {
    cssText = "";
    replaceSync(text) {
      this.cssText = text;
    }
  };
`;

const outputFiles = (outdir: string, ext: string) => readdirSync(outdir).filter(f => f.endsWith(ext));

const mixedUseError = 'A build cannot use "widget.css" both with and without { type: "css" }.';

describe("bundler", () => {
  itBundled("css-module-script/DefaultImportIsConstructedStyleSheet", {
    files: {
      "/entry.js": /* js */ `
        import "./page.css";
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet instanceof CSSStyleSheet);
        console.log(sheet.cssText);
      `,
      "/page.css": /* css */ `.page { color: blue }`,
      "/widget.css": /* css */ `p.w { color: red }`,
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      // The plain import still lands in the chunk's stylesheet, the module script does not.
      api.expectFile("/out/entry.css").toContain(".page");
      api.expectFile("/out/entry.css").not.toContain("p.w");
    },
    run: {
      file: "/test.js",
      stdout: "true\np.w {\n  color: red;\n}",
    },
  });

  itBundled("css-module-script/HTMLEntryKeepsSheetOutOfThePage", {
    files: {
      "/index.html": /* html */ `
        <!doctype html>
        <html>
          <head></head>
          <body>
            <p class="w">light DOM</p>
            <script type="module" src="./component.js"></script>
          </body>
        </html>
      `,
      "/component.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        document.body.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
      `,
      "/widget.css": /* css */ `p.w { color: rgb(200, 0, 0); border-top: 7px solid; }`,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
      api.expectFile("/out/index.html").not.toContain("stylesheet");
      const [js] = outputFiles(api.outdir, ".js");
      api.expectFile("/out/" + js).toContain("border-top: 7px solid");
      api.expectFile("/out/" + js).toContain("new CSSStyleSheet");
    },
  });

  // The other ways to write the import give the same kind of module.
  itBundled("css-module-script/ImportForms", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./a.css" with { type: "css" };
        import b from "./b.css" assert { type: "css" };
        import { sheet as c } from "./reexport.js";
        import * as star from "./star.js";
        console.log(JSON.stringify([ns.default, b, c, star.default].map(s => s instanceof CSSStyleSheet && s.cssText)));
      `,
      "/reexport.js": /* js */ `export { default as sheet } from "./c.css" with { type: "css" };`,
      // `export *` does not re-export "default".
      "/star.js": /* js */ `export * from "./d.css" with { type: "css" };`,
      "/a.css": /* css */ `.a { color: red }`,
      "/b.css": /* css */ `.b { color: red }`,
      "/c.css": /* css */ `.c { color: red }`,
      "/d.css": /* css */ `.d { color: red }`,
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
    },
    run: {
      file: "/test.js",
      stdout: JSON.stringify([".a {\n  color: red;\n}", ".b {\n  color: red;\n}", ".c {\n  color: red;\n}", false]),
    },
  });

  // The attribute decides the loader, the file extension does not. An empty file is an empty sheet.
  itBundled("css-module-script/NonCssPathAndEmptyFileAndDataUrl", {
    files: {
      "/entry.js": /* js */ `
        import a from "./styles.txt" with { type: "css" };
        import b from "./empty.css" with { type: "css" };
        import c from "data:text/css,p.d%7Bcolor%3Ared%7D" with { type: "css" };
        console.log(JSON.stringify([a, b, c].map(s => s instanceof CSSStyleSheet && s.cssText)));
      `,
      "/styles.txt": /* css */ `p.t { color: red }`,
      "/empty.css": "",
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
    },
    run: {
      file: "/test.js",
      stdout: JSON.stringify(["p.t {\n  color: red;\n}", "", "p.d {\n  color: red;\n}"]),
    },
  });

  // A `url()` to a file becomes an import of the copied asset. Its path is
  // relative to the chunk, so the module makes it absolute: a constructed sheet
  // resolves a relative URL against the document.
  for (const splitting of [false, true]) {
    itBundled(`css-module-script/UrlResolvesAgainstTheChunk${splitting ? "Splitting" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          import sheet from "./styles/widget.css" with { type: "css" };
          console.log(sheet.cssText);
        `,
        "/other.js": /* js */ `
          import sheet from "./styles/widget.css" with { type: "css" };
          console.log(sheet.cssText.length);
        `,
        "/styles/widget.css": /* css */ `
          p.a { background: url("./image.png") }
          p.b { background: url(image.png) }
          p.c { mask: url(icons.svg#star) }
          p.d { background: url(https://example.com/a.png) }
          p.e { background: url(data:image/png;base64,AAAA); mask: url(#m) }
        `,
        // Large enough to be emitted as a file instead of a data: URL in a page stylesheet.
        "/styles/image.png": Buffer.alloc(256 * 1024, 7),
        "/styles/icons.svg": `<svg xmlns="http://www.w3.org/2000/svg"><path id="star"/></svg>`,
        "/test.js": /* js */ `
          ${cssStyleSheetShim}
          await import("./out/chunks/entry.js");
        `,
      },
      entryPoints: ["/entry.js", "/other.js"],
      entryNaming: "chunks/[name].[ext]",
      assetNaming: "assets/[name]-[hash].[ext]",
      splitting,
      outdir: "/out",
      target: "browser",
      onAfterBundle(api) {
        // A page stylesheet for this entry would be emitted next to it, in chunks/.
        expect(outputFiles(api.outdir + "/chunks", ".css")).toEqual([]);
        expect(outputFiles(api.outdir + "/assets", ".png")).toHaveLength(1);
        expect(outputFiles(api.outdir + "/assets", ".svg")).toHaveLength(1);
      },
      run: {
        file: "/test.js",
        validate({ stdout }) {
          const urls = [...stdout.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]);
          expect(urls).toHaveLength(6);
          const [a, b, c, ...rest] = urls;
          // The sheet is in out/chunks/ or in a shared chunk, and the asset in out/assets/.
          expect(a).toMatch(/^file:.*\/out\/assets\/image-[a-z0-9]+\.png$/);
          expect(existsSync(fileURLToPath(a))).toBe(true);
          // `url(image.png)` is the same file: CSS resolves it against the stylesheet.
          expect(b).toBe(a);
          // The fragment stays on the URL.
          expect(c).toMatch(/^file:.*\/out\/assets\/icons-[a-z0-9]+\.svg#star$/);
          expect(existsSync(fileURLToPath(c.slice(0, -"#star".length)))).toBe(true);
          // A URL that is not a file stays as written.
          expect(rest.sort()).toEqual(["#m", "data:image/png;base64,AAAA", "https://example.com/a.png"]);
        },
      },
    });
  }

  // Minified CSS writes `url(x)` without quotes. The module always quotes the
  // URL it computes, and it must not throw when the chunk has no base URL.
  itBundled("css-module-script/UrlMinifiedAndWithoutBaseUrl", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet.cssText);
      `,
      "/widget.css": /* css */ `p.w { background: url("./image.png") }`,
      "/image.png": Buffer.alloc(256 * 1024, 7),
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
        await import("./out/entry.blob.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    minifyWhitespace: true,
    onAfterBundle(api) {
      // A module that a page loads from a `blob:` URL: `new URL(path, base)` throws for that base.
      const js = api.readFile("/out/entry.js");
      expect(js).toContain("import.meta.url");
      api.writeFile("/out/entry.blob.js", js.replaceAll("import.meta.url", `"blob:https://example.com/0b0e2c4e"`));
    },
    run: {
      file: "/test.js",
      validate({ stdout }) {
        const [first, second] = stdout.split("\n");
        expect(first).toMatch(/^p\.w\{background:url\("file:[^"]+\/out\/image-[a-z0-9]+\.png"\)\}$/);
        expect(second).toMatch(/^p\.w\{background:url\("\.\/image-[a-z0-9]+\.png"\)\}$/);
      },
    },
  });

  // IIFE and CommonJS output have no `import.meta.url`. The URL of an asset is
  // then only right with a public path.
  for (const format of ["iife", "cjs"] as const) {
    itBundled(`css-module-script/Url${format.toUpperCase()}NeedsAPublicPath`, {
      files: {
        "/entry.js": /* js */ `
          import sheet from "./widget.css" with { type: "css" };
          console.log(sheet.cssText);
        `,
        "/widget.css": /* css */ `p.w { background: url("./image.png") }`,
        "/image.png": Buffer.alloc(256 * 1024, 7),
      },
      entryPoints: ["/entry.js"],
      format,
      outdir: "/out",
      target: "browser",
      bundleErrors: {
        "/widget.css": ['resolves this "url()" against the location of the bundle'],
      },
    });

    itBundled(`css-module-script/Url${format.toUpperCase()}WithPublicPath`, {
      files: {
        "/entry.js": /* js */ `
          import sheet from "./widget.css" with { type: "css" };
          console.log(sheet.cssText);
        `,
        "/widget.css": /* css */ `p.w { background: url("./image.png") }`,
        "/image.png": Buffer.alloc(256 * 1024, 7),
        "/test.js": /* js */ `
          ${cssStyleSheetShim}
          require("./out/entry.js");
        `,
      },
      entryPoints: ["/entry.js"],
      format,
      publicPath: "https://cdn.example.com/static/",
      outdir: "/out",
      target: "browser",
      onAfterBundle(api) {
        api.expectFile("/out/entry.js").not.toContain("import.meta");
      },
      run: {
        file: "/test.js",
        validate({ stdout }) {
          expect(stdout).toMatch(/url\("https:\/\/cdn\.example\.com\/static\/image-[a-z0-9]+\.png"\)/);
        },
      },
    });
  }

  // A browser ignores `@import` in a CSS module script. The bundle does the same, and says so.
  itBundled("css-module-script/AtImportIsIgnoredWithAWarning", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        console.log(JSON.stringify(sheet.cssText));
      `,
      "/widget.css": /* css */ `
        @import "./base.css";
        p.w { color: red }
      `,
      "/base.css": /* css */ `p.base { color: green }`,
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    bundleWarnings: {
      "/widget.css": ['This "@import" is ignored.'],
    },
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
      api.expectFile("/out/entry.js").not.toContain("p.base");
    },
    run: {
      file: "/test.js",
      stdout: JSON.stringify("p.w {\n  color: red;\n}"),
    },
  });

  // The bundler has one module for each file. A file cannot be a CSS module
  // script for one import and a stylesheet of the page for another: the build
  // fails, and the error does not depend on which import the bundler sees first.
  itBundled("css-module-script/MixedUsePlainThenTyped", {
    files: {
      "/entry.js": /* js */ `
        import "./widget.css";
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet);
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    bundleErrors: {
      "/entry.js": [mixedUseError],
    },
  });

  itBundled("css-module-script/MixedUseTypedThenPlainInAnotherFile", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        import "./other.js";
        console.log(sheet);
      `,
      "/other.js": /* js */ `
        import styles from "./widget.css";
        console.log(styles);
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    bundleErrors: {
      "/entry.js": [mixedUseError],
    },
  });

  itBundled("css-module-script/MixedUseDynamicImport", {
    files: {
      "/entry.js": /* js */ `
        import "./widget.css";
        const { default: sheet } = await import("./widget.css", { with: { type: "css" } });
        console.log(sheet);
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    bundleErrors: {
      "/entry.js": [mixedUseError],
    },
  });

  itBundled("css-module-script/MixedUseAtImport", {
    files: {
      "/entry.js": /* js */ `
        import "./page.css";
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet);
      `,
      "/page.css": /* css */ `@import "./widget.css";`,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    bundleErrors: {
      "/entry.js": [mixedUseError],
    },
  });

  itBundled("css-module-script/MixedUseHtmlLink", {
    files: {
      "/index.html": /* html */ `
        <!doctype html>
        <html>
          <head><link rel="stylesheet" href="./widget.css" /></head>
          <body><script type="module" src="./component.js"></script></body>
        </html>
      `,
      "/component.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        document.adoptedStyleSheets = [sheet];
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    target: "browser",
    bundleErrors: {
      "/component.js": [mixedUseError],
    },
  });

  itBundled("css-module-script/SharedAcrossChunksKeepsIdentity", {
    files: {
      "/a.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        import { shared } from "./shared.js";
        console.log("a", sheet === shared, sheet instanceof CSSStyleSheet);
      `,
      "/b.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        import { shared } from "./shared.js";
        console.log("b", sheet === shared, sheet instanceof CSSStyleSheet);
      `,
      "/shared.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        export const shared = sheet;
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/a.js");
        await import("./out/b.js");
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
      // One module, one stylesheet: it is emitted once, in the shared chunk.
      const withSheet = outputFiles(api.outdir, ".js").filter(f => api.readFile("/out/" + f).includes("color: red"));
      expect(withSheet).toHaveLength(1);
      expect(withSheet[0]).not.toBe("a.js");
      expect(withSheet[0]).not.toBe("b.js");
    },
    run: {
      file: "/test.js",
      stdout: "a true true\nb true true",
    },
  });

  for (const splitting of [false, true]) {
    itBundled(`css-module-script/DynamicImport${splitting ? "Splitting" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          const { default: sheet } = await import("./widget.css", { with: { type: "css" } });
          console.log(sheet instanceof CSSStyleSheet, JSON.stringify(sheet.cssText));
        `,
        "/widget.css": /* css */ `p.w { color: red }`,
        "/test.js": /* js */ `
          ${cssStyleSheetShim}
          await import("./out/entry.js");
        `,
      },
      entryPoints: ["/entry.js"],
      splitting,
      outdir: "/out",
      target: "browser",
      onAfterBundle(api) {
        expect(outputFiles(api.outdir, ".css")).toEqual([]);
      },
      run: {
        file: "/test.js",
        stdout: `true "p.w {\\n  color: red;\\n}"`,
      },
    });
  }

  for (const format of ["iife", "cjs"] as const) {
    itBundled(`css-module-script/Format${format.toUpperCase()}`, {
      files: {
        "/entry.js": /* js */ `
          import sheet from "./widget.css" with { type: "css" };
          console.log(sheet instanceof CSSStyleSheet, JSON.stringify(sheet.cssText));
        `,
        "/widget.css": /* css */ `p.w { color: red }`,
        "/test.js": /* js */ `
          ${cssStyleSheetShim}
          require("./out/entry.js");
        `,
      },
      entryPoints: ["/entry.js"],
      format,
      outdir: "/out",
      target: "browser",
      run: {
        file: "/test.js",
        stdout: `true "p.w {\\n  color: red;\\n}"`,
      },
    });
  }

  itBundled("css-module-script/Minified", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet.cssText);
      `,
      "/widget.css": /* css */ `p.w { color: red; border-top: 7px solid }`,
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    run: {
      file: "/test.js",
      stdout: "p.w{color:red;border-top:7px solid}",
    },
  });

  // The module holds the text in a template literal: these characters need an escape there.
  itBundled("css-module-script/TextWithTemplateLiteralSyntax", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet.cssText);
      `,
      "/widget.css": 'p.w::before { content: "`${a}\\\\$" }',
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    minifyWhitespace: true,
    run: {
      file: "/test.js",
      stdout: 'p.w:before{content:"`${a}\\\\$"}',
    },
  });

  itBundled("css-module-script/UnusedImportEmitsNothing", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        console.log("hi");
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
      api.expectFile("/out/entry.js").not.toContain("CSSStyleSheet");
      api.expectFile("/out/entry.js").not.toContain("color");
    },
    run: {
      stdout: "hi",
    },
  });

  // An import that binds nothing makes a sheet that no code can adopt. On a
  // build before this feature, that import added the file to the page.
  itBundled("css-module-script/BareImportWarns", {
    files: {
      "/entry.js": /* js */ `
        import "./widget.css" with { type: "css" };
        console.log("hi");
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    bundleWarnings: {
      "/entry.js": ["This import does nothing: it makes a CSSStyleSheet that no code can adopt."],
    },
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
      api.expectFile("/out/entry.js").not.toContain("color");
    },
    run: {
      stdout: "hi",
    },
  });

  // Barrel optimization defers the re-export and resolves it when an importer asks for it.
  itBundled("css-module-script/BarrelDeferredReExport", {
    files: {
      "/entry.js": /* js */ `
        import { sheet } from "lib";
        console.log(sheet instanceof CSSStyleSheet, JSON.stringify(sheet.cssText));
      `,
      "/node_modules/lib/package.json": JSON.stringify({ name: "lib", main: "./index.js", sideEffects: false }),
      "/node_modules/lib/index.js": /* js */ `
        export { default as sheet } from "./widget.css" with { type: "css" };
        export { unused } from "./unused.js";
      `,
      "/node_modules/lib/unused.js": /* js */ `export const unused = "unused";`,
      "/node_modules/lib/widget.css": /* css */ `p.w { color: red }`,
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
    },
    run: {
      file: "/test.js",
      stdout: `true "p.w {\\n  color: red;\\n}"`,
    },
  });

  // A plugin sees the loader of the file as "css". The import still gets a
  // sheet, unless the plugin loads JavaScript for it.
  itBundled("css-module-script/Plugins", {
    files: {
      "/entry.js": /* js */ `
        import resolved from "virtual:widget" with { type: "css" };
        import fallback from "./fallback.css" with { type: "css" };
        import loaded from "./loaded.css" with { type: "css" };
        import script from "./script.css" with { type: "css" };
        console.log(JSON.stringify([resolved, fallback, loaded].map(s => s instanceof CSSStyleSheet && s.cssText)), script);
      `,
      "/widget.css": /* css */ `.resolved { color: red }`,
      "/fallback.css": /* css */ `.fallback { color: red }`,
      "/loaded.css": /* css */ `.not-this { color: red }`,
      "/script.css": /* css */ `.not-this { color: red }`,
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    plugins(builder) {
      builder.onResolve({ filter: /^virtual:widget$/ }, args => ({
        path: resolve(dirname(args.importer), "widget.css"),
      }));
      // A plugin that matches and gives no answer: the bundler resolves the import.
      builder.onResolve({ filter: /fallback\.css$/ }, () => undefined);
      builder.onLoad({ filter: /loaded\.css$/ }, () => ({ contents: ".loaded { color: red }", loader: "css" }));
      builder.onLoad({ filter: /script\.css$/ }, () => ({ contents: "export default 'script'", loader: "js" }));
    },
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
    },
    run: {
      file: "/test.js",
      stdout:
        JSON.stringify([
          ".resolved {\n  color: red;\n}",
          ".fallback {\n  color: red;\n}",
          ".loaded {\n  color: red;\n}",
        ]) + " script",
    },
  });

  // The module that a plugin loads as JavaScript is an ordinary module: an
  // import that binds nothing still runs it, and gets no warning.
  for (const resolvedByBundler of [false, true]) {
    itBundled(`css-module-script/PluginJavaScriptKeepsItsSideEffects${resolvedByBundler ? "" : "AfterOnResolve"}`, {
      files: {
        "/entry.js": /* js */ `
          import "./script.css" with { type: "css" };
          import unused from "./widget.css" with { type: "css" };
          console.log("entry");
        `,
        "/script.css": /* css */ `.not-this { color: red }`,
        "/widget.css": /* css */ `p.w { color: red }`,
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      target: "browser",
      plugins(builder) {
        // A plugin that matches and gives no answer: the bundler resolves the import.
        if (!resolvedByBundler) builder.onResolve({ filter: /\.css$/ }, () => undefined);
        builder.onLoad({ filter: /script\.css$/ }, () => ({ contents: "console.log('script');", loader: "js" }));
      },
      onAfterBundle(api) {
        expect(outputFiles(api.outdir, ".css")).toEqual([]);
        api.expectFile("/out/entry.js").not.toContain("CSSStyleSheet");
      },
      run: {
        stdout: "script\nentry",
      },
    });
  }

  // An import that stays in the output keeps the attribute, so a browser loads
  // the file as a CSS module script. Without it a browser rejects the import:
  // the file is not JavaScript.
  itBundled("css-module-script/ExternalImportKeepsTheAttribute", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        export { default as other } from "./other.css" with { type: "css" };
        import text from "./notes.txt" with { type: "text" };
        import "./page.css";
        console.log(sheet, text);
      `,
    },
    entryPoints: ["/entry.js"],
    external: ["./widget.css", "./other.css", "./notes.txt", "./page.css"],
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");
      expect(js).toContain(`import sheet from "./widget.css" with { type: "css" };`);
      expect(js).toContain(`from "./other.css" with { type: "css" };`);
      // Unchanged: the other types are for Bun only, and a plain import has no attribute.
      expect(js).toContain(`import text from "./notes.txt";`);
      expect(js).toContain(`import"./page.css";`);
    },
  });

  itBundled("css-module-script/CSSModulesFileIsAnError", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./styles.module.css" with { type: "css" };
        console.log(sheet);
      `,
      "/styles.module.css": /* css */ `.box { color: red }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    bundleErrors: {
      "/entry.js": ['A CSS module ("./styles.module.css") cannot be imported with { type: "css" }.'],
    },
  });

  itBundled("css-module-script/NamedImportIsAnError", {
    files: {
      "/entry.js": /* js */ `
        import sheet, { rules } from "./widget.css" with { type: "css" };
        console.log(sheet, rules);
      `,
      "/widget.css": /* css */ `p.w { color: red }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    bundleErrors: {
      "/entry.js": ['No matching export in "widget.css" for import "rules"'],
    },
  });

  // Bun and Node have no `CSSStyleSheet`: those targets keep the old behavior,
  // which is also what `bun run` does with this import.
  for (const target of ["bun", "node"] as const) {
    itBundled(`css-module-script/Target${target[0].toUpperCase()}${target.slice(1)}IsUnchanged`, {
      files: {
        "/entry.js": /* js */ `
          import sheet from "./widget.css" with { type: "css" };
          import { box } from "./styles.module.css" with { type: "css" };
          console.log(JSON.stringify(sheet), typeof box);
        `,
        "/widget.css": /* css */ `p.w { color: red }`,
        "/styles.module.css": /* css */ `.box { color: red }`,
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      target,
      onAfterBundle(api) {
        api.expectFile("/out/entry.css").toContain("p.w");
        api.expectFile("/out/entry.js").not.toContain("CSSStyleSheet");
      },
      run: {
        stdout: "{} string",
      },
    });
  }
});
