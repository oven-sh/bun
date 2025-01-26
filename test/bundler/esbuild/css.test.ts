import { describe } from "bun:test";
import { itBundled } from "../expectBundled";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_css_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/css

describe("bundler", () => {
  itBundled("css/CSSEntryPoint", {
    files: {
      "/entry.css": /* css */ `
        body {
          background: white;
          color: black }
      `,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      api.expectFile("/out.js").toEqualIgnoringWhitespace(`
/* entry.css */
body {
        color: #000;
        background: #fff;
}`);
    },
  });

  itBundled("css/CSSEntryPointEmpty", {
    files: {
      "/entry.css": /* css */ `\n`,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      api.expectFile("/out.js").toEqualIgnoringWhitespace(`
/* entry.css */`);
    },
  });

  itBundled("css/CSSNesting", {
    target: "bun",
    files: {
      "/entry.css": /* css */ `
body {
	h1 {
		color: white;
	}
}`,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      api.expectFile("/out.js").toEqualIgnoringWhitespace(`
/* entry.css */
body {
	&h1 {
		color: #fff;
	}
}
`);
    },
  });

  itBundled("css/CSSAtImportMissing", {
    files: {
      "/entry.css": `@import "./missing.css";`,
    },
    bundleErrors: {
      "/entry.css": ['Could not resolve: "./missing.css"'],
    },
  });

  itBundled("css/CSSAtImportSimple", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        @import "./internal.css";
      `,
      "/internal.css": /* css */ `
        .before { color: red }
      `,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* internal.css */
.before {
  color: red;
}
/* entry.css */
`);
    },
  });

  itBundled("css/CSSAtImportDiamond", {
    // GENERATED
    files: {
      "/a.css": /* css */ `
        @import "./b.css";
        @import "./c.css";
        .last { color: red }
      `,
      "/b.css": /* css */ `
        @import "./d.css";
        .first { color: red }
      `,
      "/c.css": /* css */ `
        @import "./d.css";
        .third { color: red }
      `,
      "/d.css": /* css */ `
        .second { color: red }
      `,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* b.css */
.first {
  color: red;
}
/* d.css */
.second {
  color: red;
}
/* c.css */
.third {
  color: red;
}
/* a.css */
.last {
  color: red;
}
`);
    },
  });

  itBundled("css/CSSAtImportCycle", {
    files: {
      "/a.css": /* css */ `
        @import "./a.css";
        .hehe { color: red }
      `,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* a.css */
.hehe {
  color: red;
}
`);
    },
  });

  itBundled("css/CSSUrlImport", {
    files: {
      "/a.css": /* css */ `
        .hello {
          background-image: url(./hi.svg)
        }
      `,
      "/hi.svg": /* svg */ `
<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="40" fill="blue" />
</svg>
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/a.css").toEqualIgnoringWhitespace(`
/* a.css */
.hello {
  background-image: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iYmx1ZSIgLz4KPC9zdmc+");
}
`);
    },
  });
});

describe("esbuild-bundler", () => {
  itBundled("css/CSSEntryPoint", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        body {
          background: white;
          color: black }
      `,
    },
  });
  itBundled("css/CSSAtImportMissing", {
    files: {
      "/entry.css": `@import "./missing.css";`,
    },
    bundleErrors: {
      "/entry.css": ['Could not resolve: "./missing.css"'],
    },
  });
  itBundled("css/CSSAtImportExternal", {
    external: ["./external1.css", "./external2.css", "./external3.css", "./external4.css", "./external5.css"],
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        @import "./internal.css";
        @import "./external1.css";
        @import "./external2.css";
        @import "./charset1.css";
        @import "./charset2.css";
        @import "./external5.css" screen;
      `,
      "/internal.css": /* css */ `
        @import "./external5.css" print;
        .before { color: red }
      `,
      "/charset1.css": /* css */ `
        @charset "UTF-8";
        @import "./external3.css";
        @import "./external4.css";
        @import "./external5.css";
        @import "https://www.example.com/style1.css";
        @import "https://www.example.com/style2.css";
        @import "https://www.example.com/style3.css" print;
        .middle { color: green }
      `,
      "/charset2.css": /* css */ `
        @charset "UTF-8";
        @import "./external3.css";
        @import "./external5.css" screen;
        @import "https://www.example.com/style1.css";
        @import "https://www.example.com/style3.css";
        .after { color: blue }
      `,
    },
    outfile: "/out/out.css",
    onAfterBundle(api) {
      api.expectFile("/out/out.css").toEqualIgnoringWhitespace(/* css */ `@import "./external1.css";
@import "./external2.css";
@import "./external4.css";
@import "./external5.css";
@import "https://www.example.com/style2.css";
@import "./external3.css";
@import "https://www.example.com/style1.css";
@import "https://www.example.com/style3.css";
@import "./external5.css" screen;

/* internal.css */
.before {
  color: red;
}

/* charset1.css */
.middle {
  color: green;
}

/* charset2.css */
.after {
  color: #00f;
}

/* entry.css */`);
    },
  });
  itBundled("css/CSSAtImport", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        .entry { color: red }
      `,
      "/a.css": /* css */ `
        @import "./shared.css";
        .a { color: green }
      `,
      "/b.css": /* css */ `
        @import "./shared.css";
        .b { color: blue }
      `,
      "/shared.css": `.shared { color: black }`,
    },
  });
  itBundled("css/CSSFromJSMissingImport", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {missing} from "./a.css"
        console.log(missing)
      `,
      "/a.css": `.a { color: red }`,
    },
    bundleErrors: {
      "/entry.js": ['No matching export in "a.css" for import "missing"'],
    },
  });
  itBundled("css/CSSFromJSMissingStarImport", {
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./a.css"
        console.log(ns.missing)
      `,
      "/a.css": `.a { color: red }`,
    },
    bundleWarnings: {
      "/entry.js": ['Import "missing" will always be undefined because there is no matching export in "a.css"'],
    },
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `/* a.css */
        .a{
          color: red;
        }`);
    },
  });
  itBundled("css/ImportCSSFromJS", {
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import "./a.js"
        import "./b.js"
      `,
      "/a.js": /* js */ `
        import "./a.css";
        console.log('a')
      `,
      "/a.css": `.a { color: red }`,
      "/b.js": /* js */ `
        import "./b.css";
        console.log('b')
      `,
      "/b.css": `.b { color: blue }`,
    },
  });
  // itBundled("css/ImportCSSFromJSWriteToStdout", {
  //   files: {
  //     "/entry.js": `import "./entry.css"`,
  //     "/entry.css": `.entry { color: red }`,
  //   },
  //   bundleErrors: {
  //     "/entry.js": ['Cannot import "entry.css" into a JavaScript file without an output path configured'],
  //   },
  // });
  itBundled("css/ImportJSFromCSS", {
    outdir: "/out",
    files: {
      "/entry.ts": `export default 123`,
      "/entry.css": `@import "./entry.ts";`,
    },
    entryPoints: ["/entry.css"],
    bundleErrors: {
      "/entry.css": ['Cannot import a ".ts" file into a CSS file'],
    },
  });
  itBundled("css/ImportJSONFromCSS", {
    // GENERATED
    files: {
      "/entry.json": `{}`,
      "/entry.css": `@import "./entry.json";`,
    },
    entryPoints: ["/entry.css"],
    bundleErrors: {
      "/entry.css": ['Cannot import a ".json" file into a CSS file'],
    },
  });
  itBundled("css/MissingImportURLInCSS", {
    // GENERATED
    files: {
      "/src/entry.css": /* css */ `
        a { background: url(./one.png); }
        b { background: url("./two.png"); }
      `,
    },
    bundleErrors: {
      "/src/entry.css": ['Could not resolve: "./one.png"', 'Could not resolve: "./two.png"'],
    },
  });

  // Skipping for now
  itBundled("css/ExternalImportURLInCSS", {
    files: {
      "/src/entry.css": /* css */ `
        div:after {
          content: 'If this is recognized, the path should become "../src/external.png"';
          background: url(./external.png);
        }

        /* These URLs should be external automatically */
        a { background: url(http://example.com/images/image.png) }
        b { background: url(https://example.com/images/image.png) }
        c { background: url(//example.com/images/image.png) }
        d { background: url(data:image/png;base64,iVBORw0KGgo=) }
        path { fill: url(#filter) }
      `,
    },
    external: ["./src/external.png"],
  });

  itBundled("css/InvalidImportURLInCSS", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./js.js);
          background: url("./jsx.jsx");
          background: url(./ts.ts);
          background: url('./tsx.tsx');
          background: url(./json.json);
          background: url(./css.css);
        }
      `,
      "/js.js": `export default 123`,
      "/jsx.jsx": `export default 123`,
      "/ts.ts": `export default 123`,
      "/tsx.tsx": `export default 123`,
      "/json.json": `{ "test": true }`,
      "/css.css": `a { color: red }`,
    },
    bundleErrors: {
      "/entry.css": [
        'Cannot import a ".jsx" file into a CSS file',
        'Cannot import a ".jsx" file into a CSS file',
        'Cannot import a ".ts" file into a CSS file',
        'Cannot import a ".tsx" file into a CSS file',
        'Cannot import a ".json" file into a CSS file',
      ],
    },
    /* TODO FIX expectedScanLog: `entry.css: ERROR: Cannot use "js.js" as a URL
  NOTE: You can't use a "url()" token to reference the file "js.js" because it was loaded with the "js" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "jsx.jsx" as a URL
  NOTE: You can't use a "url()" token to reference the file "jsx.jsx" because it was loaded with the "jsx" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "ts.ts" as a URL
  NOTE: You can't use a "url()" token to reference the file "ts.ts" because it was loaded with the "ts" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "tsx.tsx" as a URL
  NOTE: You can't use a "url()" token to reference the file "tsx.tsx" because it was loaded with the "tsx" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "json.json" as a URL
  NOTE: You can't use a "url()" token to reference the file "json.json" because it was loaded with the "json" loader, which doesn't provide a URL to embed in the resulting CSS.
  entry.css: ERROR: Cannot use "css.css" as a URL
  NOTE: You can't use a "url()" token to reference a CSS file, and "css.css" is a CSS file (it was loaded with the "css" loader).
  `, */
  });
  itBundled("css/TextImportURLInCSSText", {
    outfile: "/out.css",
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.txt);
        }
      `,
      "/example.txt": `This is some text.`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
a {
  background: url("data:text/plain;base64,VGhpcyBpcyBzb21lIHRleHQu");
}
`);
    },
  });
  itBundled("css/Png", {
    outfile: "/out.css",
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.png);
        }
      `,
      "/example.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
a {
  background: url("data:image/png;base64,iVBORw0KGgo=");
}
`);
    },
  });

  // We don't support dataurl rn
  //   itBundled("css/DataURLImportURLInCSS", {
  //     outfile: "/out.css",
  //     // GENERATED
  //     files: {
  //       "/entry.css": /* css */ `
  //         a {
  //           background: url(./example.png);
  //         }
  //       `,
  //       "/example.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  //     },
  //     loader: {
  //       ".png": "dataurl",
  //     },
  //     onAfterBundle(api) {
  //       api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
  // /* entry.css */
  // a {
  //   background: url("data:image/png;base64,iVBORw0KGgo=");
  // }
  // `);
  //     },
  //   });

  // We don't support binary loader rn
  //   itBundled("css/BinaryImportURLInCSS", {

  //     // GENERATED
  //     files: {
  //       "/entry.css": /* css */ `
  //         a {
  //           background: url(./example.png);
  //         }
  //       `,
  //       "/example.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  //     },
  //     onAfterBundle(api) {
  //       api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
  // /* entry.css */
  // a {
  //   background: url("data:image/png;base64,iVBORw0KGgo=");
  // }
  // `);
  //     },
  //   });

  // We don't support base64 loader rn
  // itBundled("css/Base64ImportURLInCSS", {

  //   // GENERATED
  //   files: {
  //     "/entry.css": /* css */ `
  //       a {
  //         background: url(./example.png);
  //       }
  //     `,
  //     "/example.png": `\x89\x50\x4E\x47\x0D\x0A\x1A\x0A`,
  //   },
  // });

  itBundled("css/FileImportURLInCSS", {
    files: {
      "/entry.css": /* css */ `
        @import "./one.css";
        @import "./two.css";
      `,
      "/one.css": `a { background: url(./example.data) }`,
      "/two.css": `b { background: url(./example.data) }`,
      "/example.data": new Array(128 * 1024 + 1).fill("Z".charCodeAt(0)).join(""),
    },
    loader: {
      ".data": "file",
    },
    outdir: "/out",
    async onAfterBundle(api) {
      api.expectFile("/out/example-ra0pdz4b.data").toEqual(new Array(128 * 1024 + 1).fill("Z".charCodeAt(0)).join(""));

      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `
/* one.css */
a {
  background: url("./example-ra0pdz4b.data");
}

/* two.css */
b {
  background: url("./example-ra0pdz4b.data");
}

/* entry.css */
`);
    },
  });

  itBundled("css/IgnoreURLsInAtRulePrelude", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        /* This should not generate a path resolution error */
        @supports (background: url(ignored.png)) {
          a { color: red }
        }
      `,
    },
  });

  itBundled("css/PackageURLsInCSS", {
    files: {
      "/entry.css": /* css */ `
        @import "./test.css";

        a { background: url(a/1.png); }
        b { background: url(b/2.png); }
        c { background: url(c/3.png); }
      `,
      "/test.css": `.css { color: red }`,
      "/a/1.png": `a-1`,
      "/node_modules/b/2.png": `b-2-node_modules`,
      "/c/3.png": `c-3`,
      "/node_modules/c/3.png": `c-3-node_modules`,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* test.css */
.css {
  color: red;
}

/* entry.css */
a {
  background: url("data:image/png;base64,YS0x");
}
b {
  background: url("data:image/png;base64,Yi0yLW5vZGVfbW9kdWxlcw==");
}
c {
  background: url("data:image/png;base64,Yy0z");
}
`);
    },
  });

  itBundled("css/CSSAtImportExtensionOrderCollision", {
    files: {
      // This should avoid picking ".js" because it's explicitly configured as non-CSS
      "/entry.css": `@import "./test";`,
      "/test.js": `console.log('js')`,
      "/test.css": `.css { color: red }`,
    },
    outfile: "/out.css",
    // extensionOrder: [".js", ".css"],
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* test.css */
.css {
  color: red;
}

/* entry.css */
`);
    },
  });

  /* We don't support `extensionOrder`/`--resolve-extensions` rn
  itBundled("css/CSSAtImportExtensionOrderCollisionUnsupported", {

    // GENERATED
    files: {
      "/entry.css": `@import "./test";`,
      "/test.js": `console.log('js')`,
      "/test.sass": `// some code`,
    },
    outfile: "/out.css",
    extensionOrder: [".js", ".sass"],
    bundleErrors: {
      "/entry.css": ['ERROR: No loader is configured for ".sass" files: test.sass'],
    },
  });
  */

  // itBundled("css/CSSAtImportConditionsNoBundle", {
  //   files: {
  //     "/entry.css": `@import "./print.css" print;`,
  //   },
  // });

  itBundled("css/CSSAtImportConditionsBundleExternal", {
    files: {
      "/entry.css": /* css */ `@import "https://example.com/print.css" print;`,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
@import "https://example.com/print.css" print;

/* entry.css */
`);
    },
  });

  itBundled("css/CSSAtImportConditionsBundleExternalConditionWithURL", {
    files: {
      "/entry.css": /* css */ `@import "https://example.com/foo.css" supports(background: url("foo.png"));`,
    },
  });

  itBundled("css/CSSAtImportConditionsBundleLOL", {
    outfile: "/out.css",
    files: {
      "/entry.css": /* css */ `
@import url(http://example.com/foo.css);
@import url(http://example.com/foo.css) layer;
@import url(http://example.com/foo.css) layer(layer-name);
@import url(http://example.com/foo.css) layer(layer-name) supports(display: flex);
@import url(http://example.com/foo.css) layer(layer-name) supports(display: flex) (min-width: 768px) and
  (max-width: 1024px);
@import url(http://example.com/foo.css) layer(layer-name) (min-width: 768px) and (max-width: 1024px);
@import url(http://example.com/foo.css) supports(display: flex);
@import url(http://example.com/foo.css) supports(display: flex) (min-width: 768px) and (max-width: 1024px);
@import url(http://example.com/foo.css) (min-width: 768px) and (max-width: 1024px);

@import url(./foo.css);
@import url(./foo.css) layer;
@import url(./foo.css) layer(layer-name);
@import url(./foo.css) layer(layer-name) supports(display: flex);
@import url(./foo.css) layer(layer-name) supports(display: flex) (min-width: 768px) and (max-width: 1024px);
@import url(./foo.css) layer(layer-name) (min-width: 768px) and (max-width: 1024px);
@import url(./foo.css) supports(display: flex);
@import url(./foo.css) supports(display: flex) (min-width: 768px) and (max-width: 1024px);
@import url(./foo.css) (min-width: 768px) and (max-width: 1024px);

@import url(./empty-1.css) layer(empty-1);
@import url(./empty-2.css) supports(empty: 2);
@import url(./empty-3.css) (empty: 3);

@import "./nested-layer.css" layer(outer);
@import "./nested-layer.css" supports(outer: true);
@import "./nested-layer.css" (outer: true);
@import "./nested-supports.css" layer(outer);
@import "./nested-supports.css" supports(outer: true);
@import "./nested-supports.css" (outer: true);
@import "./nested-media.css" layer(outer);
@import "./nested-media.css" supports(outer: true);
@import "./nested-media.css" (outer: true);
			`,

      "/foo.css": /* css */ `body { color: red }`,

      "/empty-1.css": ``,
      "/empty-2.css": ``,
      "/empty-3.css": ``,

      "/nested-layer.css": /* css */ `@import "./foo.css" layer(inner);`,
      "/nested-supports.css": /* css */ `@import "./foo.css" supports(inner: true);`,
      "/nested-media.css": /* css */ `@import "./foo.css" (inner: true);`,
    },
    onAfterBundle(api) {
      // api.expectFile("/out.css").toMatchSnapshot();
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `@import "http://example.com/foo.css";
        @import "http://example.com/foo.css" layer;
        @import "http://example.com/foo.css" layer(layer-name);
        @import "http://example.com/foo.css" layer(layer-name) supports(display: flex);
        @import "http://example.com/foo.css" layer(layer-name) (min-width: 768px) and (max-width: 1024px);
        @import "http://example.com/foo.css" supports(display: flex);
        @import "http://example.com/foo.css" (min-width: 768px) and (max-width: 1024px);

        /* foo.css */
        body {
          color: red;
        }

        /* foo.css */
        @layer {
          body {
            color: red;
          }
        }

        /* foo.css */
        @layer layer-name {
          body {
            color: red;
          }
        }

        /* foo.css */
        @supports (display: flex) {
          @layer layer-name {
            body {
              color: red;
            }
          }
        }

        /* foo.css */
        @media (min-width: 768px) and (max-width: 1024px) {
          @layer layer-name {
            body {
              color: red;
            }
          }
        }

        /* foo.css */
        @supports (display: flex) {
          body {
            color: red;
          }
        }

        /* foo.css */
        @media (min-width: 768px) and (max-width: 1024px) {
          body {
            color: red;
          }
        }

        /* empty-1.css */
        @layer empty-1;

        /* empty-2.css */


        /* empty-3.css */


        /* foo.css */
        @layer outer {
          @layer inner {
            body {
              color: red;
            }
          }
        }

        /* nested-layer.css */
        @layer outer;

        /* foo.css */
        @supports (outer: true) {
          @layer inner {
            body {
              color: red;
            }
          }
        }

        /* nested-layer.css */


        /* foo.css */
        @media (outer: true) {
          @layer inner {
            body {
              color: red;
            }
          }
        }

        /* nested-layer.css */


        /* foo.css */
        @layer outer {
          @supports (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-supports.css */
        @layer outer;

        /* foo.css */
        @supports (outer: true) {
          @supports (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-supports.css */


        /* foo.css */
        @media (outer: true) {
          @supports (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-supports.css */


        /* foo.css */
        @layer outer {
          @media (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-media.css */
        @layer outer;

        /* foo.css */
        @supports (outer: true) {
          @media (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-media.css */


        /* foo.css */
        @media (outer: true) {
          @media (inner: true) {
            body {
              color: red;
            }
          }
        }

        /* nested-media.css */


        /* entry.css */
        `);
    },
  });

  // This tests that bun correctly clones the import records for all import
  // condition tokens. If they aren't cloned correctly, then something will
  // likely crash with an out-of-bounds error.
  itBundled("css/CSSAtImportConditionsWithImportRecordsBundle", {
    files: {
      "/entry.css": /* css */ `
        @import url(./foo.css) supports(background: url(./a.png));
        @import url(./foo.css) supports(background: url(./b.png)) list-of-media-queries;
        @import url(./foo.css) layer(layer-name) supports(background: url(./a.png));
        @import url(./foo.css) layer(layer-name) supports(background: url(./b.png)) list-of-media-queries;
      `,
      "/foo.css": /* css */ `body { color: red }`,
      "/a.png": `A`,
      "/b.png": `B`,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(/* css */ `
/* foo.css */
@supports (background: url(./a.png)) {
  body {
    color: red;
  }
}

/* foo.css */
@media list-of-media-queries {
  @supports (background: url(./b.png)) {
    body {
      color: red;
    }
  }
}

/* foo.css */
@supports (background: url(./a.png)) {
  @layer layer-name {
    body {
      color: red;
    }
  }
}

/* foo.css */
@media list-of-media-queries {
  @supports (background: url(./b.png)) {
    @layer layer-name {
      body {
        color: red;
      }
    }
  }
}

/* entry.css */
`);
    },
  });

  const files = [
    "/001/default/style.css",
    "/001/relative-url/style.css",
    "/at-charset/001/style.css",
    "/at-keyframes/001/style.css",
    "/at-layer/001/style.css",
    "/at-layer/002/style.css",
    "/at-layer/003/style.css",
    "/at-layer/004/style.css",
    "/at-layer/005/style.css",
    "/at-layer/006/style.css",
    "/at-layer/007/style.css",
    "/at-layer/008/style.css",
    "/at-media/001/default/style.css",
    "/at-media/002/style.css",
    "/at-media/003/style.css",
    "/at-media/004/style.css",
    "/at-media/005/style.css",
    "/at-media/006/style.css",
    "/at-media/007/style.css",
    "/at-media/008/style.css",
    "/at-supports/001/style.css",
    "/at-supports/002/style.css",
    "/at-supports/003/style.css",
    "/at-supports/004/style.css",
    "/at-supports/005/style.css",
    "/cycles/001/style.css",
    "/cycles/002/style.css",
    "/cycles/003/style.css",
    "/cycles/004/style.css",
    "/cycles/005/style.css",
    "/cycles/006/style.css",
    "/cycles/007/style.css",
    "/cycles/008/style.css",
    "/data-urls/002/style.css",
    "/data-urls/003/style.css",
    "/duplicates/001/style.css",
    "/duplicates/002/style.css",
    "/empty/001/style.css",
    "/relative-paths/001/style.css",
    "/relative-paths/002/style.css",
    "/subresource/001/style.css",
    "/subresource/002/style.css",
    "/subresource/004/style.css",
    "/subresource/005/style.css",
    "/subresource/007/style.css",
    "/url-format/001/default/style.css",
    "/url-format/001/relative-url/style.css",
    "/url-format/002/default/style.css",
    "/url-format/002/relative-url/style.css",
    "/url-format/003/default/style.css",
    "/url-format/003/relative-url/style.css",
    "/url-fragments/001/style.css",
    "/url-fragments/002/style.css",
  ];

  // From: https://github.com/romainmenke/css-import-tests. These test cases just
  // serve to document any changes in bun's behavior. Any changes in behavior
  // should be tested to ensure they don't cause any regressions. The easiest way
  // to test the changes is to bundle https://github.com/evanw/css-import-tests
  // and visually inspect a browser's rendering of the resulting CSS file.
  itBundled("css/CSSAtImportConditionsFromExternalRepo", {
    files: {
      "/001/default/a.css": `.box { background-color: green; }`,
      "/001/default/style.css": `@import url("a.css");`,

      "/001/relative-url/a.css": `.box { background-color: green; }`,
      "/001/relative-url/style.css": `@import url("./a.css");`,

      "/at-charset/001/a.css": `@charset "utf-8"; .box { background-color: red; }`,
      "/at-charset/001/b.css": `@charset "utf-8"; .box { background-color: green; }`,
      "/at-charset/001/style.css": `@charset "utf-8"; @import url("a.css"); @import url("b.css");`,

      "/at-keyframes/001/a.css": `
        .box { animation: BOX; animation-duration: 0s; animation-fill-mode: both; }
        @keyframes BOX { 0%, 100% { background-color: green; } }
      `,
      "/at-keyframes/001/b.css": `
        .box { animation: BOX; animation-duration: 0s; animation-fill-mode: both; }
        @keyframes BOX { 0%, 100% { background-color: red; } }
      `,
      "/at-keyframes/001/style.css": `@import url("a.css") screen; @import url("b.css") print;`,

      "/at-layer/001/a.css": `.box { background-color: red; }`,
      "/at-layer/001/b.css": `.box { background-color: green; }`,
      "/at-layer/001/style.css": `
        @import url("a.css") layer(a);
        @import url("b.css") layer(b);
        @import url("a.css") layer(a);
      `,

      "/at-layer/002/a.css": `.box { background-color: green; }`,
      "/at-layer/002/b.css": `.box { background-color: red; }`,
      "/at-layer/002/style.css": `
        @import url("a.css") layer(a) print;
        @import url("b.css") layer(b);
        @import url("a.css") layer(a);
      `,

      "/at-layer/003/a.css": `@layer a { .box { background-color: red; } }`,
      "/at-layer/003/b.css": `@layer b { .box { background-color: green; } }`,
      "/at-layer/003/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/at-layer/004/a.css": `@layer { .box { background-color: green; } }`,
      "/at-layer/004/b.css": `@layer { .box { background-color: red; } }`,
      "/at-layer/004/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/at-layer/005/a.css": `@import url("b.css") layer(b) (width: 1px);`,
      "/at-layer/005/b.css": `.box { background-color: red; }`,
      "/at-layer/005/style.css": `
        @import url("a.css") layer(a) (min-width: 1px);
        @layer a.c { .box { background-color: red; } }
        @layer a.b { .box { background-color: green; } }
      `,

      "/at-layer/006/a.css": `@import url("b.css") layer(b) (min-width: 1px);`,
      "/at-layer/006/b.css": `.box { background-color: red; }`,
      "/at-layer/006/style.css": `
        @import url("a.css") layer(a) (min-width: 1px);
        @layer a.c { .box { background-color: green; } }
        @layer a.b { .box { background-color: red; } }
      `,

      "/at-layer/007/style.css": `
        @layer foo {}
        @layer bar {}
        @layer bar { .box { background-color: green; } }
        @layer foo { .box { background-color: red; } }
      `,

      "/at-layer/008/a.css": `@import "b.css" layer; .box { background-color: green; }`,
      "/at-layer/008/b.css": `.box { background-color: red; }`,
      "/at-layer/008/style.css": `@import url("a.css") layer;`,

      "/at-media/001/default/a.css": `.box { background-color: green; }`,
      "/at-media/001/default/style.css": `@import url("a.css") screen;`,

      "/at-media/002/a.css": `.box { background-color: green; }`,
      "/at-media/002/b.css": `.box { background-color: red; }`,
      "/at-media/002/style.css": `@import url("a.css") screen; @import url("b.css") print;`,

      "/at-media/003/a.css": `@import url("b.css") (min-width: 1px);`,
      "/at-media/003/b.css": `.box { background-color: green; }`,
      "/at-media/003/style.css": `@import url("a.css") screen;`,

      "/at-media/004/a.css": `@import url("b.css") print;`,
      "/at-media/004/b.css": `.box { background-color: red; }`,
      "/at-media/004/c.css": `.box { background-color: green; }`,
      "/at-media/004/style.css": `@import url("c.css"); @import url("a.css") print;`,

      "/at-media/005/a.css": `@import url("b.css") (max-width: 1px);`,
      "/at-media/005/b.css": `.box { background-color: red; }`,
      "/at-media/005/c.css": `.box { background-color: green; }`,
      "/at-media/005/style.css": `@import url("c.css"); @import url("a.css") (max-width: 1px);`,

      "/at-media/006/a.css": `@import url("b.css") (min-width: 1px);`,
      "/at-media/006/b.css": `.box { background-color: green; }`,
      "/at-media/006/style.css": `@import url("a.css") (min-height: 1px);`,

      "/at-media/007/a.css": `@import url("b.css") screen;`,
      "/at-media/007/b.css": `.box { background-color: green; }`,
      "/at-media/007/style.css": `@import url("a.css") all;`,

      "/at-media/008/a.css": `@import url("green.css") layer(alpha) print;`,
      "/at-media/008/b.css": `@import url("red.css") layer(beta) print;`,
      "/at-media/008/green.css": `.box { background-color: green; }`,
      "/at-media/008/red.css": `.box { background-color: red; }`,
      "/at-media/008/style.css": `
        @import url("a.css") layer(alpha) all;
        @import url("b.css") layer(beta) all;
        @layer beta { .box { background-color: green; } }
        @layer alpha { .box { background-color: red; } }
      `,

      "/at-supports/001/a.css": `.box { background-color: green; }`,
      "/at-supports/001/style.css": `@import url("a.css") supports(display: block);`,

      "/at-supports/002/a.css": `@import url("b.css") supports(width: 10px);`,
      "/at-supports/002/b.css": `.box { background-color: green; }`,
      "/at-supports/002/style.css": `@import url("a.css") supports(display: block);`,

      "/at-supports/003/a.css": `@import url("b.css") supports(width: 10px);`,
      "/at-supports/003/b.css": `.box { background-color: green; }`,
      "/at-supports/003/style.css": `@import url("a.css") supports((display: block) or (display: inline));`,

      "/at-supports/004/a.css": `@import url("b.css") layer(b) supports(width: 10px);`,
      "/at-supports/004/b.css": `.box { background-color: green; }`,
      "/at-supports/004/style.css": `@import url("a.css") layer(a) supports(display: block);`,

      "/at-supports/005/a.css": `@import url("green.css") layer(alpha) supports(foo: bar);`,
      "/at-supports/005/b.css": `@import url("red.css") layer(beta) supports(foo: bar);`,
      "/at-supports/005/green.css": `.box { background-color: green; }`,
      "/at-supports/005/red.css": `.box { background-color: red; }`,
      "/at-supports/005/style.css": `
        @import url("a.css") layer(alpha) supports(display: block);
        @import url("b.css") layer(beta) supports(display: block);
        @layer beta { .box { background-color: green; } }
        @layer alpha { .box { background-color: red; } }
      `,

      "/cycles/001/style.css": `@import url("style.css"); .box { background-color: green; }`,

      "/cycles/002/a.css": `@import url("red.css"); @import url("b.css");`,
      "/cycles/002/b.css": `@import url("green.css"); @import url("a.css");`,
      "/cycles/002/green.css": `.box { background-color: green; }`,
      "/cycles/002/red.css": `.box { background-color: red; }`,
      "/cycles/002/style.css": `@import url("a.css");`,

      "/cycles/003/a.css": `@import url("b.css"); .box { background-color: green; }`,
      "/cycles/003/b.css": `@import url("a.css"); .box { background-color: red; }`,
      "/cycles/003/style.css": `@import url("a.css");`,

      "/cycles/004/a.css": `@import url("b.css"); .box { background-color: red; }`,
      "/cycles/004/b.css": `@import url("a.css"); .box { background-color: green; }`,
      "/cycles/004/style.css": `@import url("a.css"); @import url("b.css");`,

      "/cycles/005/a.css": `@import url("b.css"); .box { background-color: green; }`,
      "/cycles/005/b.css": `@import url("a.css"); .box { background-color: red; }`,
      "/cycles/005/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/cycles/006/a.css": `@import url("red.css"); @import url("b.css");`,
      "/cycles/006/b.css": `@import url("green.css"); @import url("a.css");`,
      "/cycles/006/c.css": `@import url("a.css");`,
      "/cycles/006/green.css": `.box { background-color: green; }`,
      "/cycles/006/red.css": `.box { background-color: red; }`,
      "/cycles/006/style.css": `@import url("b.css"); @import url("c.css");`,

      "/cycles/007/a.css": `@import url("red.css"); @import url("b.css") screen;`,
      "/cycles/007/b.css": `@import url("green.css"); @import url("a.css") all;`,
      "/cycles/007/c.css": `@import url("a.css") not print;`,
      "/cycles/007/green.css": `.box { background-color: green; }`,
      "/cycles/007/red.css": `.box { background-color: red; }`,
      "/cycles/007/style.css": `@import url("b.css"); @import url("c.css");`,

      "/cycles/008/a.css": `@import url("red.css") layer; @import url("b.css");`,
      "/cycles/008/b.css": `@import url("green.css") layer; @import url("a.css");`,
      "/cycles/008/c.css": `@import url("a.css") layer;`,
      "/cycles/008/green.css": `.box { background-color: green; }`,
      "/cycles/008/red.css": `.box { background-color: red; }`,
      "/cycles/008/style.css": `@import url("b.css"); @import url("c.css");`,

      "/data-urls/002/style.css": `@import url('data:text/css;plain,.box%20%7B%0A%09background-color%3A%20green%3B%0A%7D%0A');`,

      "/data-urls/003/style.css": `@import url('data:text/css,.box%20%7B%0A%09background-color%3A%20green%3B%0A%7D%0A');`,

      "/duplicates/001/a.css": `.box { background-color: green; }`,
      "/duplicates/001/b.css": `.box { background-color: red; }`,
      "/duplicates/001/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/duplicates/002/a.css": `.box { background-color: green; }`,
      "/duplicates/002/b.css": `.box { background-color: red; }`,
      "/duplicates/002/style.css": `@import url("a.css"); @import url("b.css"); @import url("a.css"); @import url("b.css"); @import url("a.css");`,

      "/empty/001/empty.css": ``,
      "/empty/001/style.css": `@import url("./empty.css"); .box { background-color: green; }`,

      "/relative-paths/001/a/a.css": `@import url("../b/b.css")`,
      "/relative-paths/001/b/b.css": `.box { background-color: green; }`,
      "/relative-paths/001/style.css": `@import url("./a/a.css");`,

      "/relative-paths/002/a/a.css": `@import url("./../b/b.css")`,
      "/relative-paths/002/b/b.css": `.box { background-color: green; }`,
      "/relative-paths/002/style.css": `@import url("./a/a.css");`,

      "/subresource/001/something/images/green.png": `...`,
      "/subresource/001/something/styles/green.css": `.box { background-image: url("../images/green.png"); }`,
      "/subresource/001/style.css": `@import url("./something/styles/green.css");`,

      "/subresource/002/green.png": `...`,
      "/subresource/002/style.css": `@import url("./styles/green.css");`,
      "/subresource/002/styles/green.css": `.box { background-image: url("../green.png"); }`,

      "/subresource/004/style.css": `@import url("./styles/green.css");`,
      "/subresource/004/styles/green.css": `.box { background-image: url("green.png"); }`,
      "/subresource/004/styles/green.png": `...`,

      "/subresource/005/style.css": `@import url("./styles/green.css");`,
      "/subresource/005/styles/green.css": `.box { background-image: url("./green.png"); }`,
      "/subresource/005/styles/green.png": `...`,

      "/subresource/007/green.png": `...`,
      "/subresource/007/style.css": `.box { background-image: url("./green.png"); }`,

      "/url-format/001/default/a.css": `.box { background-color: green; }`,
      "/url-format/001/default/style.css": `@import url(a.css);`,

      "/url-format/001/relative-url/a.css": `.box { background-color: green; }`,
      "/url-format/001/relative-url/style.css": `@import url(./a.css);`,

      "/url-format/002/default/a.css": `.box { background-color: green; }`,
      "/url-format/002/default/style.css": `@import "a.css";`,

      "/url-format/002/relative-url/a.css": `.box { background-color: green; }`,
      "/url-format/002/relative-url/style.css": `@import "./a.css";`,

      "/url-format/003/default/a.css": `.box { background-color: green; }`,
      "/url-format/003/default/style.css": `@import url("a.css"`,

      "/url-format/003/relative-url/a.css": `.box { background-color: green; }`,
      "/url-format/003/relative-url/style.css": `@import url("./a.css"`,

      "/url-fragments/001/a.css": `.box { background-color: green; }`,
      "/url-fragments/001/style.css": `@import url("./a.css#foo");`,

      "/url-fragments/002/a.css": `.box { background-color: green; }`,
      "/url-fragments/002/b.css": `.box { background-color: red; }`,
      "/url-fragments/002/style.css": `@import url("./a.css#1"); @import url("./b.css#2"); @import url("./a.css#3");`,
    },
    entryPoints: files,
    outputPaths: files,
    outdir: "/out",
    onAfterBundle(api) {
      for (const file of files) {
        console.log("Checking snapshot:", file);
        api.expectFile(join(file)).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSAtImportConditionsAtLayerBundle", {
    files: {
      "/case1.css": /* css */ `
        @import url(case1-foo.css) layer(first.one);
        @import url(case1-foo.css) layer(last.one);
        @import url(case1-foo.css) layer(first.one);
      `,
      "/case1-foo.css": `body { color: red }`,

      "/case2.css": /* css */ `
        @import url(case2-foo.css);
        @import url(case2-bar.css);
        @import url(case2-foo.css);
      `,
      "/case2-foo.css": `@layer first.one { body { color: red } }`,
      "/case2-bar.css": `@layer last.one { body { color: green } }`,

      "/case3.css": /* css */ `
        @import url(case3-foo.css);
        @import url(case3-bar.css);
        @import url(case3-foo.css);
      `,
      "/case3-foo.css": `@layer { body { color: red } }`,
      "/case3-bar.css": `@layer only.one { body { color: green } }`,

      "/case4.css": /* css */ `
        @import url(case4-foo.css) layer(first);
        @import url(case4-foo.css) layer(last);
        @import url(case4-foo.css) layer(first);
      `,
      "/case4-foo.css": `@layer one { @layer two, three.four; body { color: red } }`,

      "/case5.css": /* css */ `
        @import url(case5-foo.css) layer;
        @import url(case5-foo.css) layer(middle);
        @import url(case5-foo.css) layer;
      `,
      "/case5-foo.css": `@layer one { @layer two, three.four; body { color: red } }`,

      // Note: There was a bug that only showed up in this case. We need at least this many cases.
      "/case6.css": /* css */ `
        @import url(case6-foo.css) layer(first);
        @import url(case6-foo.css) layer(last);
        @import url(case6-foo.css) layer(first);
      `,
      "/case6-foo.css": `@layer { @layer two, three.four; body { color: red } }`,
    },
    entryPoints: ["/case1.css", "/case2.css", "/case3.css", "/case4.css", "/case5.css", "/case6.css"],
    outdir: "/out",
    onAfterBundle(api) {
      const snapshotFiles = ["case1.css", "case2.css", "case3.css", "case4.css", "case5.css", "case6.css"];
      for (const file of snapshotFiles) {
        console.log("Checking snapshot:", file);
        api.expectFile(join("/out", file)).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSAtImportConditionsAtLayerBundleAlternatingLayerInFile", {
    files: {
      "/a.css": `@layer first { body { color: red } }`,
      "/b.css": `@layer last { body { color: green } }`,

      "/case1.css": /* css */ `
        @import url(a.css);
        @import url(a.css);
      `,

      "/case2.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
      `,

      "/case3.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
      `,

      "/case4.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
      `,

      "/case5.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
      `,

      "/case6.css": /* css */ `
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
        @import url(b.css);
        @import url(a.css);
      `,
    },
    entryPoints: ["/case1.css", "/case2.css", "/case3.css", "/case4.css", "/case5.css", "/case6.css"],
    outdir: "/out",
    onAfterBundle(api) {
      const snapshotFiles = ["case1.css", "case2.css", "case3.css", "case4.css", "case5.css", "case6.css"];
      for (const file of snapshotFiles) {
        console.log("Checking snapshot:", file);
        api.expectFile(join("/out", file)).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSAtImportConditionsChainExternal", {
    files: {
      "/entry.css": /* css */ `
        @import "a.css" layer(a) not print;
      `,
      "/a.css": /* css */ `
        @import "http://example.com/external1.css";
        @import "b.css" layer(b) not tv;
        @import "http://example.com/external2.css" layer(a2);
      `,
      "/b.css": /* css */ `
        @import "http://example.com/external3.css";
        @import "http://example.com/external4.css" layer(b2);
      `,
    },
    outfile: "/out.css",
  });

  // This test mainly just makes sure that this scenario doesn't crash
  itBundled("css/CSSAndJavaScriptCodeSplittingESBuildIssue1064", {
    files: {
      "/a.js": /* js */ `
        import shared from './shared.js'
        console.log(shared() + 1)
      `,
      "/b.js": /* js */ `
        import shared from './shared.js'
        console.log(shared() + 2)
      `,
      "/c.css": /* css */ `
        @import "./shared.css";
        body { color: red }
      `,
      "/d.css": /* css */ `
        @import "./shared.css";
        body { color: blue }
      `,
      "/shared.js": `export default function() { return 3 }`,
      "/shared.css": `body { background: black }`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.css", "/d.css"],
    format: "esm",
    splitting: true,
    onAfterBundle(api) {
      const files = ["/a.js", "/b.js", "/c.css", "/d.css"];
      for (const file of files) {
        api.expectFile(file).toMatchSnapshot(file);
      }
    },
  });

  itBundled("css/CSSExternalQueryAndHashNoMatchESBuildIssue1822", {
    files: {
      "/entry.css": /* css */ `
        a { background: url(foo/bar.png?baz) }
        b { background: url(foo/bar.png#baz) }
      `,
    },
    outfile: "/out.css",
    bundleErrors: {
      "/entry.css": [
        `Could not resolve: "foo/bar.png?baz". Maybe you need to "bun install"?`,
        `Could not resolve: "foo/bar.png#baz". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("css/CSSNestingOldBrowser", {
    // GENERATED
    files: {
      "/nested-@layer.css": `a { @layer base { color: red; } }`,
      "/nested-@media.css": `a { @media screen { color: red; } }`,
      "/nested-ampersand-twice.css": `a { &, & { color: red; } }`,
      "/nested-ampersand-first.css": `a { &, b { color: red; } }`,
      "/nested-attribute.css": `a { [href] { color: red; } }`,
      "/nested-colon.css": `a { :hover { color: red; } }`,
      "/nested-dot.css": `a { .cls { color: red; } }`,
      "/nested-greaterthan.css": `a { > b { color: red; } }`,
      "/nested-hash.css": `a { #id { color: red; } }`,
      "/nested-plus.css": `a { + b { color: red; } }`,
      "/nested-tilde.css": `a { ~ b { color: red; } }`,
      "/toplevel-ampersand-twice.css": `&, & { color: red; }`,
      "/toplevel-ampersand-first.css": `&, a { color: red; }`,
      "/toplevel-ampersand-second.css": `a, & { color: red; }`,
      "/toplevel-attribute.css": `[href] { color: red; }`,
      "/toplevel-colon.css": `:hover { color: red; }`,
      "/toplevel-dot.css": `.cls { color: red; }`,
      "/toplevel-greaterthan.css": `> b { color: red; }`,
      "/toplevel-hash.css": `#id { color: red; }`,
      "/toplevel-plus.css": `+ b { color: red; }`,
      "/toplevel-tilde.css": `~ b { color: red; }`,
    },
    entryPoints: [
      "/nested-@layer.css",
      "/nested-@media.css",
      "/nested-ampersand-twice.css",
      "/nested-ampersand-first.css",
      "/nested-attribute.css",
      "/nested-colon.css",
      "/nested-dot.css",
      "/nested-greaterthan.css",
      "/nested-hash.css",
      "/nested-plus.css",
      "/nested-tilde.css",
      "/toplevel-ampersand-twice.css",
      "/toplevel-ampersand-first.css",
      "/toplevel-ampersand-second.css",
      "/toplevel-attribute.css",
      "/toplevel-colon.css",
      "/toplevel-dot.css",
      "/toplevel-greaterthan.css",
      "/toplevel-hash.css",
      "/toplevel-plus.css",
      "/toplevel-tilde.css",
    ],
    unsupportedCSSFeatures: ["Nesting"],
    /* TODO FIX expectedScanLog: `nested-@layer.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-@media.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-ampersand-first.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-ampersand-twice.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-attribute.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-colon.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-dot.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-greaterthan.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-hash.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-plus.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  nested-tilde.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-first.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-second.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-twice.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-ampersand-twice.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-greaterthan.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-plus.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  toplevel-tilde.css: WARNING: CSS nesting syntax is not supported in the configured target environment (chrome10)
  `, */
  });
  itBundled("css/MetafileCSSBundleTwoToOne", {
    files: {
      "/foo/entry.js": /* js */ `
        import '../common.css'
        console.log('foo')
      `,
      "/bar/entry.js": /* js */ `
        import '../common.css'
        console.log('bar')
      `,
      "/common.css": `body { color: red }`,
    },
    metafile: true,
    entryPoints: ["/foo/entry.js", "/bar/entry.js"],
    entryNaming: "[ext]/[hash]",
    outdir: "/",
  });
  itBundled("css/DeduplicateRules", {
    // GENERATED
    files: {
      "/yes0.css": `a { color: red; color: green; color: red }`,
      "/yes1.css": `a { color: red } a { color: green } a { color: red }`,
      "/yes2.css": `@media screen { a { color: red } } @media screen { a { color: red } }`,
      "/no0.css": `@media screen { a { color: red } } @media screen { & a { color: red } }`,
      "/no1.css": `@media screen { a { color: red } } @media screen { a[x] { color: red } }`,
      "/no2.css": `@media screen { a { color: red } } @media screen { a.x { color: red } }`,
      "/no3.css": `@media screen { a { color: red } } @media screen { a#x { color: red } }`,
      "/no4.css": `@media screen { a { color: red } } @media screen { a:x { color: red } }`,
      "/no5.css": `@media screen { a:x { color: red } } @media screen { a:x(y) { color: red } }`,
      "/no6.css": `@media screen { a b { color: red } } @media screen { a + b { color: red } }`,
      "/across-files.css": `@import 'across-files-0.css'; @import 'across-files-1.css'; @import 'across-files-2.css';`,
      "/across-files-0.css": `a { color: red; color: red }`,
      "/across-files-1.css": `a { color: green }`,
      "/across-files-2.css": `a { color: red }`,
      "/across-files-url.css": `@import 'across-files-url-0.css'; @import 'across-files-url-1.css'; @import 'across-files-url-2.css';`,
      "/across-files-url-0.css": `@import 'http://example.com/some.css'; @font-face { src: url(http://example.com/some.font); }`,
      "/across-files-url-1.css": `@font-face { src: url(http://example.com/some.other.font); }`,
      "/across-files-url-2.css": `@font-face { src: url(http://example.com/some.font); }`,
    },
    entryPoints: [
      "/yes0.css",
      "/yes1.css",
      "/yes2.css",
      "/no0.css",
      "/no1.css",
      "/no2.css",
      "/no3.css",
      "/no4.css",
      "/no5.css",
      "/no6.css",
      "/across-files.css",
      "/across-files-url.css",
    ],
  });
});
