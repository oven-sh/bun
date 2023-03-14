import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_css_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/css

describe("bundler", () => {
  itBundled("css/CSSEntryPoint", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        body {
          background: white;
          color: black }
      `,
    },
    snapshot: true,
  });
  itBundled("css/CSSAtImportMissing", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "./missing.css";`,
    },
    snapshot: true,
  });
  itBundled("css/CSSAtImportExternal", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("css/CSSAtImport", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("css/CSSFromJSMissingImport", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import {missing} from "./a.css"
        console.log(missing)
      `,
      "/a.css": `.a { color: red }`,
    },
    snapshot: true,
  });
  itBundled("css/CSSFromJSMissingStarImport", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./a.css"
        console.log(ns.missing)
      `,
      "/a.css": `.a { color: red }`,
    },
    debugLogs: true,
    snapshot: true,
  });
  itBundled("css/ImportCSSFromJS", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("css/ImportCSSFromJSWriteToStdout", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `import "./entry.css"`,
      "/entry.css": `.entry { color: red }`,
    },
    snapshot: true,
  });
  itBundled("css/ImportJSFromCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `export default 123`,
      "/entry.css": `@import "./entry.js";`,
    },
    entryPoints: ["/entry.css"],
    snapshot: true,
  });
  itBundled("css/ImportJSONFromCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.json": `{}`,
      "/entry.css": `@import "./entry.json";`,
    },
    entryPoints: ["/entry.css"],
    snapshot: true,
  });
  itBundled("css/MissingImportURLInCSS", {
    // TODO: hand check and tweak
    files: {
      "/src/entry.css": /* css */ `
        a { background: url(./one.png); }
        b { background: url("./two.png"); }
      `,
    },
    snapshot: true,
  });
  itBundled("css/ExternalImportURLInCSS", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("css/InvalidImportURLInCSS", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("css/TextImportURLInCSSText", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.txt);
        }
      `,
      "/example.txt": `This is some text.`,
    },
    snapshot: true,
  });
  itBundled("css/DataURLImportURLInCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.png);
        }
      `,
    },
    snapshot: true,
  });
  itBundled("css/BinaryImportURLInCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.png);
        }
      `,
    },
    snapshot: true,
  });
  itBundled("css/Base64ImportURLInCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        a {
          background: url(./example.png);
        }
      `,
    },
    snapshot: true,
  });
  itBundled("css/FileImportURLInCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        @import "./one.css";
        @import "./two.css";
      `,
      "/one.css": `a { background: url(./example.data) }`,
      "/two.css": `b { background: url(./example.data) }`,
    },
    snapshot: true,
  });
  itBundled("css/IgnoreURLsInAtRulePrelude", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        /* This should not generate a path resolution error */
        @supports (background: url(ignored.png)) {
          a { color: red }
        }
      `,
    },
    snapshot: true,
  });
  itBundled("css/PackageURLsInCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        @import "test.css";
  
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
    snapshot: true,
  });
  itBundled("css/CSSAtImportExtensionOrderCollision", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "./test";`,
      "/test.js": `console.log('js')`,
      "/test.css": `.css { color: red }`,
    },
    outfile: "/out.css",
    /* TODO: 
        ExtensionOrder -- []string{".js", ".css"}, */
    snapshot: true,
  });
  itBundled("css/CSSAtImportExtensionOrderCollisionUnsupported", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "./test";`,
      "/test.js": `console.log('js')`,
      "/test.sass": `// some code`,
    },
    outfile: "/out.css",
    /* TODO: 
        ExtensionOrder -- []string{".js", ".sass"}, */
    snapshot: true,
  });
  itBundled("css/CSSAtImportConditionsNoBundle", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "./print.css" print;`,
    },
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("css/CSSAtImportConditionsBundleExternal", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "https://example.com/print.css" print;`,
    },
    snapshot: true,
  });
  itBundled("css/CSSAtImportConditionsBundleExternalConditionWithURL", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "https://example.com/foo.css" (foo: url("foo.png")) and (bar: url("bar.png"));`,
    },
    snapshot: true,
  });
  itBundled("css/CSSAtImportConditionsBundle", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "./print.css" print;`,
      "/print.css": `body { color: red }`,
    },
    snapshot: true,
  });
  itBundled("css/CSSAndJavaScriptCodeSplittingIssue1064", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("css/CSSExternalQueryAndHashNoMatchIssue1822", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        a { background: url(foo/bar.png?baz) }
        b { background: url(foo/bar.png#baz) }
      `,
    },
    outfile: "/out.css",
    snapshot: true,
  });
  itBundled("css/CSSExternalQueryAndHashMatchIssue1822", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        a { background: url(foo/bar.png?baz) }
        b { background: url(foo/bar.png#baz) }
      `,
    },
    outfile: "/out.css",
    snapshot: true,
  });
  itBundled("css/CSSNestingOldBrowser", {
    // TODO: hand check and tweak
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
    UnsupportedCSSFeatures: "Nesting",
    snapshot: true,
  });
  itBundled("css/MetafileCSSBundleTwoToOne", {
    // TODO: hand check and tweak
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
    entryPoints: ["/foo/entry.js", "/bar/entry.js"],
    /* TODO: 
        EntryPathTemplate -- []config.PathTemplate{
  				// "[ext]/[hash]"
  				{Data: "./", Placeholder: config.ExtPlaceholder},
  				{Data: "/", Placeholder: config.HashPlaceholder},
  			}, */
    snapshot: true,
  });
  itBundled("css/DeduplicateRules", {
    // TODO: hand check and tweak
    files: {},
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
    snapshot: true,
  });
});
