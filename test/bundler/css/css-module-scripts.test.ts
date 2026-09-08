import { describe, expect } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
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
      api.expectFile("/out/" + js).toContain("CSSStyleSheet");
    },
  });

  // `@import`ed files are inlined. A copied asset in `url()` is emitted relative
  // to the JS chunk and, in ESM output, resolved against `import.meta.url` at
  // runtime, so it loads no matter where the page that runs the chunk lives.
  itBundled("css-module-script/InlinesAtImportAndResolvesUrl", {
    files: {
      "/entry.js": /* js */ `
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet.cssText);
      `,
      "/widget.css": /* css */ `
        @import "./base.css";
        p.w { background: url("./image.png") }
      `,
      "/base.css": /* css */ `p.base { color: green }`,
      // Large enough to be emitted as a file instead of a data: URL.
      "/image.png": Buffer.alloc(256 * 1024, 7),
      "/test.js": /* js */ `
        ${cssStyleSheetShim}
        await import("./out/chunks/entry.js");
      `,
    },
    entryPoints: ["/entry.js"],
    entryNaming: "chunks/[name].[ext]",
    assetNaming: "assets/[name]-[hash].[ext]",
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
      expect(outputFiles(api.outdir + "/assets", ".png")).toHaveLength(1);
    },
    run: {
      file: "/test.js",
      validate({ stdout }) {
        // base.css is inlined before the importing file's own rules.
        expect(stdout.indexOf("p.base")).toBeGreaterThanOrEqual(0);
        expect(stdout.indexOf("p.base")).toBeLessThan(stdout.indexOf("p.w"));
        expect(stdout).not.toContain("@import");
        // The chunk is out/chunks/entry.js and the asset out/assets/image-*.png:
        // the URL in the sheet is absolute and points at the emitted file.
        const url = stdout.match(/url\("([^"]+)"\)/)?.[1];
        expect(url).toStartWith("file://");
        expect(url).toMatch(/\/out\/assets\/image-[a-z0-9]+\.png$/);
        expect(existsSync(fileURLToPath(url!))).toBe(true);
      },
    },
  });

  // Without `import.meta` (IIFE), the asset path stays relative to the chunk.
  itBundled("css-module-script/UrlStaysRelativeInIIFE", {
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
      `,
    },
    entryPoints: ["/entry.js"],
    format: "iife",
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").not.toContain("import.meta");
    },
    run: {
      file: "/test.js",
      validate({ stdout }) {
        expect(stdout).toMatch(/url\("\.\/image-[a-z0-9]+\.png"\)/);
      },
    },
  });

  itBundled("css-module-script/ReExport", {
    files: {
      "/entry.js": /* js */ `
        import { sheet } from "./styles.js";
        console.log(sheet instanceof CSSStyleSheet, JSON.stringify(sheet.cssText));
      `,
      "/styles.js": /* js */ `
        export { default as sheet } from "./widget.css" with { type: "css" };
      `,
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
      expect(outputFiles(api.outdir, ".css")).toEqual([]);
    },
    run: {
      file: "/test.js",
      stdout: `true "p.w {\\n  color: red;\\n}"`,
    },
  });

  itBundled("css-module-script/SameFileBothWays", {
    files: {
      "/entry.js": /* js */ `
        import "./widget.css";
        import sheet from "./widget.css" with { type: "css" };
        console.log(sheet instanceof CSSStyleSheet, sheet.cssText.includes("p.w"));
      `,
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
      // The plain import keeps applying the file to the page.
      api.expectFile("/out/entry.css").toContain("p.w");
    },
    run: {
      file: "/test.js",
      stdout: "true true",
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
      // One module, one stylesheet: the stub is emitted once, in the shared chunk.
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

  // The bundler has one module per file, so a plain import and an attributed
  // `import()` of the same file share it: the plain import still applies the
  // file to the page, and the `import()` resolves to the stylesheet module.
  itBundled("css-module-script/PlainImportAndAttributedDynamicImport", {
    files: {
      "/entry.js": /* js */ `
        import "./widget.css";
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
    splitting: true,
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toContain("p.w");
    },
    run: {
      file: "/test.js",
      stdout: `true "p.w {\\n  color: red;\\n}"`,
    },
  });

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
      "/entry.js": ['A CSS module ("styles.module.css") cannot be imported with { type: "css" }.'],
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
      "/entry.js": ['This loader type only supports the "default" import'],
    },
  });

  // Bun and Node have no `CSSStyleSheet`: those targets keep the old behavior,
  // which is also what `bun run` does with this import.
  for (const target of ["bun", "node"] as const) {
    itBundled(`css-module-script/Target${target[0].toUpperCase()}${target.slice(1)}IsUnchanged`, {
      files: {
        "/entry.js": /* js */ `
          import sheet from "./widget.css" with { type: "css" };
          console.log(JSON.stringify(sheet));
        `,
        "/widget.css": /* css */ `p.w { color: red }`,
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      target,
      onAfterBundle(api) {
        api.expectFile("/out/entry.css").toContain("p.w");
        api.expectFile("/out/entry.js").not.toContain("CSSStyleSheet");
      },
      run: {
        stdout: "{}",
      },
    });
  }
});
