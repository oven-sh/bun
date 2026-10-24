import { describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { checkGraph } from "../css-layer-order";
import { itBundled } from "../expectBundled";

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

  // TODO: re-enable these tests when we do minify local css identifiers
  // itBundled("css/TestImportLocalCSSFromJSMinifyIdentifiersAvoidGlobalNames", {
  //   files: {
  //     "/entry.js": /* js */ `
  //       import "./global.css";
  //       import "./local.module.css";
  //     `,
  //     "/global.css": /* css */ `
  //     :is(.a, .b, .c, .d, .e, .f, .g, .h, .i, .j, .k, .l, .m, .n, .o, .p, .q, .r, .s, .t, .u, .v, .w, .x, .y, .z),
  //     :is(.A, .B, .C, .D, .E, .F, .G, .H, .I, .J, .K, .L, .M, .N, .O, .P, .Q, .R, .S, .T, .U, .V, .W, .X, .Y, .Z),
  //     ._ { color: red }
  //   `,
  //     "/local.module.css": /* css */ `
  //     .rename-this { color: blue }
  //   `,
  //   },
  //   entryPoints: ["/entry.js"],
  //   outdir: "/out",
  //   minifyIdentifiers: true,
  // });

  // // See: https://github.com/evanw/esbuild/issues/3295
  // itBundled("css/ImportLocalCSSFromJSMinifyIdentifiersMultipleEntryPoints", {
  //   files: {
  //     "/a.js": /* js */ `
  //       import { foo, bar } from "./a.module.css";
  //       console.log(foo, bar);
  //     `,
  //     "/a.module.css": /* css */ `
  //       .foo { color: #001; }
  //       .bar { color: #002; }
  //     `,
  //     "/b.js": /* js */ `
  //       import { foo, bar } from "./b.module.css";
  //       console.log(foo, bar);
  //     `,
  //     "/b.module.css": /* css */ `
  //       .foo { color: #003; }
  //       .bar { color: #004; }
  //     `,
  //   },
  //   entryPoints: ["/a.js", "/b.js"],
  //   outdir: "/out",
  //   minifyIdentifiers: true,
  // });

  // TODO: some classes are commented out bc we don't support :global or :local yet
  itBundled("css/ImportCSSFromJSComposes", {
    files: {
      "/entry.js": /* js */ `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
      "/global.css": /* css */ `
          .GLOBAL1 {
            color: black;
          }
        `,
      "/styles.module.css": /* css */ `
          @import "global.css";
          /* .local0 {
            composes: local1;
            :global {
              composes: GLOBAL1 GLOBAL2;
            }
          } */
          .local0 {
            composes: GLOBAL2 GLOBAL3 from global;
            composes: local1 local2;
            background: green;
          }
          /* .local0 :global {
            composes: GLOBAL4;
          } */
          .local3 {
            border: 1px solid black;
            composes: local4;
          }
          .local4 {
            opacity: 0.5;
          }
          .local1 {
            color: red;
            composes: local3;
          }
          .fromOtherFile {
            composes: local0 from "other1.module.css";
            composes: local0 from "other2.module.css";
          }
        `,
      "/other1.module.css": /* css */ `
          .local0 {
            composes: base1 base2 from "base.module.css";
            color: blue;
          }
        `,
      "/other2.module.css": /* css */ `
          .local0 {
            composes: base1 base3 from "base.module.css";
            background: purple;
          }
        `,
      "/base.module.css": /* css */ `
          .base1 {
            cursor: pointer;
          }
          .base2 {
            display: inline;
          }
          .base3 {
            float: left;
          }
        `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": [
        'The name "local2" never appears in "styles.module.css" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.',
      ],
    },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
          "// styles.module.css
          var styles_module_default = {
            local0: "GLOBAL2 GLOBAL3 local4_-MSaAA local3_-MSaAA local1_-MSaAA local0_-MSaAA",
            local3: "local4_-MSaAA local3_-MSaAA",
            local4: "local4_-MSaAA",
            local1: "local4_-MSaAA local3_-MSaAA local1_-MSaAA",
            fromOtherFile: "base1_1Cz41w base2_1Cz41w local0_qwJuwA base3_1Cz41w local0_AgBO5Q fromOtherFile_-MSaAA"
          };

          // entry.js
          console.log(styles_module_default);
          "
        `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
          "/* global.css */
          .GLOBAL1 {
            color: #000;
          }

          /* other1.module.css */
          .local0_qwJuwA {
            color: #00f;
          }

          /* base.module.css */
          .base1_1Cz41w {
            cursor: pointer;
          }

          .base2_1Cz41w {
            display: inline;
          }

          .base3_1Cz41w {
            float: left;
          }

          /* other2.module.css */
          .local0_AgBO5Q {
            background: purple;
          }

          /* styles.module.css */
          .local0_-MSaAA {
            background: green;
          }

          .local3_-MSaAA {
            border: 1px solid #000;
          }

          .local4_-MSaAA {
            opacity: .5;
          }

          .local1_-MSaAA {
            color: red;
          }

          .fromOtherFile_-MSaAA {
          }
          "
        `);
    },
  });

  itBundled("css/ImportCSSFromJSComposesFromMissingImport", {
    files: {
      "/entry.js": `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
      "/styles.module.css": `
          .foo {
            composes: x from "file.module.css";
            composes: y from "file.module.css";
            composes: z from "file.module.css";
            composes: x from "file.css";
          }
        `,
      "/file.module.css": `
          .x {
            color: red;
          }
          :global(.y) {
            color: blue;
          }
        `,
      "/file.css": `
          .x {
            color: red;
          }
        `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": [
        // TODO: renable when we support :local and :global
        // 'Cannot use global name "y" with "composes"',
        // 'Cannot use global name "x" with "composes"',
      ],
      "/file.module.css": ['The name "z" never appears in "file.module.css"'],
      "/file.css": ['The name "x" never appears in "file.css"'],
    },
    bundleWarnings: {
      "/styles.module.css": [
        // TODO: renable when we support :local and :global
        // 'The global name "y" is defined in file.module.css. Use the ":local" selector to change "y" into a local name.',
        // 'The global name "x" is defined in file.css. Use the "local-css" loader for "file.css" to enable local names.',
      ],
    },
  });

  itBundled("css/ImportCSSFromJSComposesFromNotCSS", {
    files: {
      "/entry.js": `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
      "/styles.module.css": `
          .foo {
            composes: bar from "file.txt";
          }
        `,
      "/file.txt": `
          .bar {
            color: red;
          }
        `,
    },
    loader: {
      ".txt": "text",
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleErrors: {
      "/styles.module.css": ['Cannot use the "composes" property with the "file.txt" file (it is not a CSS file)'],
    },
  });

  itBundled("css/ImportCSSFromJSComposesCircular", {
    files: {
      "/entry.js": `
        import styles from "./styles.module.css"
        console.log(styles)
      `,
      "/styles.module.css": `
        .foo {
          composes: bar;
        }
        .bar {
          composes: foo;
        }
        .baz {
          composes: baz;
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",

    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          foo: "bar_-MSaAA foo_-MSaAA",
          bar: "foo_-MSaAA bar_-MSaAA",
          baz: "baz_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .foo_-MSaAA {
        }

        .bar_-MSaAA {
        }

        .baz_-MSaAA {
        }
        "
      `);
    },
  });

  itBundled("css/ImportCSSFromJSComposesFromCircular", {
    files: {
      "/entry.js": `
        import styles from "./styles.module.css"
        console.log(styles)
      `,
      "/styles.module.css": `
        .foo {
          composes: bar from "other.module.css";
        }
        .bar {
          composes: bar from "styles.module.css";
        }
      `,
      "/other.module.css": `
        .bar {
          composes: foo from "styles.module.css";
        }
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",

    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          foo: "bar_NlEjJA foo_-MSaAA",
          bar: "bar_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* other.module.css */
        .bar_NlEjJA {
        }

        /* styles.module.css */
        .foo_-MSaAA {
        }

        .bar_-MSaAA {
        }
        "
      `);
    },
  });

  // Define all the invalid cases
  type InvalidComposesTest = { name: string; cssContent: string; expectedError?: string; expectedWarning?: string };
  const invalidComposesTests: InvalidComposesTest[] = [
    {
      name: "IDSelector",
      cssContent: `
        /* Invalid: ID selector */
        .withId {
          composes: #invalid;
          color: red;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "ElementSelector",
      cssContent: `
        /* Invalid: Element selector */
        .withElement {
          composes: div;
          color: blue;
        }
      `,
      expectedError:
        'The name "div" never appears in "styles.module.css" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.',
    },
    {
      name: "CompoundSelector",
      cssContent: `
        /* Invalid: Compound selector */
        .withCompound {
          composes: .valid.invalid;
          color: green;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "ComplexSelector",
      cssContent: `
        /* Invalid: Complex selector */
        .withComplex {
          composes: .parent > .child;
          color: purple;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "PseudoClass",
      cssContent: `
        /* Invalid: Pseudo-class */
        .withPseudo {
          composes: .valid:hover;
          color: orange;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "AttributeSelector",
      cssContent: `
        /* Invalid: Attribute selector */
        .withAttribute {
          composes: [disabled];
          color: yellow;
        }
      `,
      expectedError: "Invalid declaration",
    },
    {
      name: "ImportedNonClass",
      cssContent: `
        /* Invalid: Imported non-class */
        .withImportedNonClass {
          composes: element from "other.module.css";
          color: magenta;
        }
      `,
      expectedError:
        'The name "element" never appears in "other.module.css" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.',
    },
  ];

  // Create a separate test for each invalid case
  for (const testCase of invalidComposesTests) {
    itBundled(`css/ImportCSSFromJSComposes${testCase.name}`, {
      files: {
        "/entry.js": /* js */ `
          import styles from "./styles.module.css"
          console.log(styles)
        `,
        "/styles.module.css": /* css */ testCase.cssContent,
        "/other.module.css": /* css */ `
          /* Non-class selectors in another file */
          div {
            color: brown;
          }
          
          #id {
            color: teal;
          }
          
          .valid {
            color: pink;
          }
          
          element {
            color: gray;
          }
        `,
      },
      entryPoints: ["/entry.js"],
      outdir: "/out",
      bundleErrors: testCase.expectedError
        ? testCase.name === "ImportedNonClass"
          ? { "/other.module.css": [testCase.expectedError] }
          : { "/styles.module.css": [testCase.expectedError] }
        : undefined,
      bundleWarnings: testCase.expectedWarning ? { "/styles.module.css": [testCase.expectedWarning] } : undefined,
      onAfterBundle(api) {
        // Check that the output files were generated correctly
        api.expectFile("/out/entry.js").toMatchSnapshot();
        api.expectFile("/out/entry.css").toMatchSnapshot();
      },
    });
  }

  itBundled("css/ComposesWithSharedPropertiesError", {
    files: {
      "/entry.js": `
      import styles from "./styles.module.css"
      console.log(styles)
    `,
      "/styles.module.css": `
      .button {
        color: blue;
        composes: otherButton from "./other.module.css";
      }
    `,
      "/other.module.css": `
      .otherButton {
        color: red;
        font-size: 16px;
      }
    `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: true,
    onAfterBundle(api) {
      // Check that the output files were generated correctly
      api.expectFile("/out/entry.js").toMatchSnapshot();
      api.expectFile("/out/entry.css").toMatchSnapshot();
    },
  });

  itBundled("css/ComposesSameFile", {
    files: {
      "/entry.js": `
      import styles from "./styles.module.css"
      console.log(styles)
    `,
      "/styles.module.css": `
      .button {
        color: blue;
        composes: otherButton from "./styles.module.css";
      }

      .otherButton {
        color: red;
        font-size: 16px;
      }
    `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: true,
    onAfterBundle(api) {
      // Check that the output files were generated correctly
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          button: "otherButton_-MSaAA button_-MSaAA",
          otherButton: "otherButton_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .button_-MSaAA {
          color: #00f;
        }

        .otherButton_-MSaAA {
          color: red;
          font-size: 16px;
        }
        "
      `);
    },
  });

  itBundled("css/ComposesSameFileSameClass", {
    files: {
      "/entry.js": `
      import styles from "./styles.module.css"
      console.log(styles)
    `,
      "/styles.module.css": `
      .button {
        color: blue;
        composes: button from "./styles.module.css";
      }
    `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    bundleWarnings: true,
    onAfterBundle(api) {
      // Check that the output files were generated correctly
      api.expectFile("/out/entry.js").toMatchInlineSnapshot(`
        "// styles.module.css
        var styles_module_default = {
          button: "button_-MSaAA"
        };

        // entry.js
        console.log(styles_module_default);
        "
      `);
      api.expectFile("/out/entry.css").toMatchInlineSnapshot(`
        "/* styles.module.css */
        .button_-MSaAA {
          color: #00f;
        }
        "
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

  // A url()'s `?query` / `#fragment` suffix must survive path rewriting so that
  // SVG fragment references like `url(sprites.svg#icon)` keep addressing the
  // element inside the asset. esbuild also preserves these.
  itBundled("css/URLQueryFragmentPreservedFileLoader", {
    files: {
      "/entry.css": /* css */ `
        .a { mask: url(./sprites.svg#icon) }
        .b { clip-path: url("./sprites.svg?v=3#c") }
        .c { background: url(./sprites.svg) }
        .d { --bg: url("./sprites.svg#custom") }
      `,
      "/sprites.svg": Buffer.alloc(128 * 1024 + 1, "Z").toString(),
    },
    loader: {
      ".svg": "file",
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
.a {
  mask: url("./sprites-mrrzcz3w.svg#icon");
}
.b {
  clip-path: url("./sprites-mrrzcz3w.svg?v=3#c");
}
.c {
  background: url("./sprites-mrrzcz3w.svg");
}
.d {
  --bg: url("./sprites-mrrzcz3w.svg#custom");
}
`);
    },
  });
  itBundled("css/URLQueryFragmentPreservedDataURL", {
    files: {
      "/entry.css": /* css */ `
        .a { mask: url(./small.svg#m1) }
        .b { background: url("./small.svg?v=2") }
        .c { mask: url(./small.svg?v=2#m1) }
        .d { background: url(./small.svg) }
      `,
      "/small.svg": `<svg xmlns="http://www.w3.org/2000/svg"><mask id="m1"/></svg>`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      // A `?query` appended to a base64 data: URL lands in the body and fails
      // decoding, so only the `#fragment` is kept on the inline path.
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `
/* entry.css */
.a {
  mask: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==#m1");
}
.b {
  background: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==");
}
.c {
  mask: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==#m1");
}
.d {
  background: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxtYXNrIGlkPSJtMSIvPjwvc3ZnPg==");
}
`);
    },
  });
  itBundled("css/URLQueryFragmentPreservedMinified", {
    files: {
      "/entry.css": /* css */ `
        .a { mask: url(./sprites.svg#icon) }
      `,
      "/sprites.svg": Buffer.alloc(128 * 1024 + 1, "Z").toString(),
    },
    loader: {
      ".svg": "file",
    },
    minifyWhitespace: true,
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `.a{mask:url(./sprites-mrrzcz3w.svg#icon)}`);
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

  itBundled("css/URLInEnvFallbackOfAtImportMediaQuery", {
    files: {
      "/entry.css": /* css */ `
        @import "./b.css" (min-width: env(foo, url(sub/g.css)));
        .c0 { color: blue }
      `,
      "/b.css": `.b1 { color: green }`,
      "/sub/g.css": `.c0 { color: red }`,
    },
    backend: "cli",
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe(`/* b.css */
@media (min-width: env(foo, url(sub/g.css))) {
  .b1 {
    color: green;
  }
}

/* entry.css */
.c0 {
  color: #00f;
}
`);
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

  // "@layer" statements may precede "@import" so that a file can pin the
  // order of the layers its imports create. They have to come out before the
  // imported files, not after them with the rest of the importer's body.
  itBundled("css/CSSAtLayerStatementBeforeAtImport", {
    files: {
      "/entry.css": /* css */ `
        @layer first;
        @import "./imported.css" layer(second);
        @layer third { .t { c: d } }
      `,
      "/imported.css": `.i { c: d }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out.css").toBe("@layer first;@layer second{.i{c:d}}@layer third{.t{c:d}}\n");
    },
  });

  // esbuild's TestCSSAtLayerBeforeImportBundle, with its snapshot.
  itBundled("css/CSSAtLayerBeforeImportBundle", {
    files: {
      "/entry.css": /* css */ `
        @layer layer1, layer2.layer3;
        @import "a.css";
        @import "b.css";
        @layer layer6.layer7, layer8;
      `,
      "/a.css": /* css */ `
        @layer layer4 {
          a { color: red }
        }
      `,
      "/b.css": /* css */ `
        @layer layer5 {
          b { color: red }
        }
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toEqualIgnoringWhitespace(/* css */ `
        @layer layer1, layer2.layer3;

        /* a.css */
        @layer layer4 {
          a {
            color: red;
          }
        }

        /* b.css */
        @layer layer5 {
          b {
            color: red;
          }
        }

        /* entry.css */
        @layer layer6.layer7, layer8;
      `);
    },
  });

  itBundled("css/CSSAtLayerStatementBeforeAtImportInImportedFile", {
    files: {
      "/entry.css": /* css */ `
        @import "./ui/index.css";
        @layer components { .card { c: e } }
      `,
      "/ui/index.css": /* css */ `
        @layer theme, base, components, utilities;
        @import "./theme.css" layer(theme);
        @import "./utilities.css" layer(utilities);
      `,
      "/ui/theme.css": `:root { --x: 1 }`,
      "/ui/utilities.css": `.u { c: d }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api
        .expectFile("/out.css")
        .toBe(
          "@layer theme,base,components,utilities;@layer theme{:root{--x:1}}@layer utilities{.u{c:d}}@layer components{.card{c:e}}\n",
        );
    },
  });

  itBundled("css/CSSAtLayerStatementBeforeAtImportNested", {
    files: {
      "/entry.css": /* css */ `
        @layer outer;
        @import "./mid.css" layer(wrap) supports(display: flex);
      `,
      "/mid.css": /* css */ `
        @layer inner;
        @import "./leaf.css" layer(leafy);
        @layer after;
        .mid { c: d }
      `,
      "/leaf.css": `.leaf { c: d }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api
        .expectFile("/out.css")
        .toBe(
          "@layer outer;@supports (display:flex){@layer wrap{@layer inner;}}@supports (display:flex){@layer wrap{@layer leafy{.leaf{c:d}}}}@supports (display:flex){@layer wrap{@layer after;.mid{c:d}}}\n",
        );
    },
  });

  itBundled("css/CSSAtLayerStatementBeforeAtImportUnderMedia", {
    files: {
      "/entry.css": /* css */ `
        @layer outer;
        @import "./mid.css" print;
      `,
      "/mid.css": /* css */ `
        @layer inner;
        @import "./leaf.css";
        .mid { c: d }
      `,
      "/leaf.css": `@layer leafy { .leaf { c: d } }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api
        .expectFile("/out.css")
        .toBe(
          "@layer outer;@media print{@layer inner;}@media print{@layer leafy{.leaf{c:d}}}@media print{.mid{c:d}}\n",
        );
    },
  });

  itBundled("css/CSSAtLayerStatementBeforeAtImportFromJS", {
    files: {
      "/entry.js": `import "./entry.css";`,
      "/entry.css": /* css */ `
        @layer first;
        @import "./imported.css" layer(second);
        .e { c: d }
      `,
      "/imported.css": `.i { c: d }`,
    },
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe("@layer first;@layer second{.i{c:d}}.e{c:d}\n");
    },
  });

  // An entry with no conditions must not stand for the same list under "layer(wrap)":
  // "a" and "wrap.a" are different layers. esbuild drops the inner statement here.
  itBundled("css/CSSAtLayerStatementBeforeAtImportSameListInLayeredImport", {
    files: {
      "/entry.css": /* css */ `
        @layer a, b;
        @import "./lib.css" layer(wrap);
        .e { c: d }
      `,
      "/lib.css": /* css */ `
        @layer a, b;
        @import "./leaf.css";
        @layer b { .lb { c: d } }
        @layer a { .la { c: d } }
      `,
      "/leaf.css": `.leaf { c: d }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api
        .expectFile("/out.css")
        .toBe(
          "@layer a,b;@layer wrap{@layer a,b;}@layer wrap{.leaf{c:d}}@layer wrap{@layer b{.lb{c:d}}@layer a{.la{c:d}}}.e{c:d}\n",
        );
    },
  });

  // The second "@layer a;" is the layer list that stands for the first copy of f.css.
  itBundled("css/CSSAtLayerStatementBeforeAtImportImportedTwice", {
    files: {
      "/entry.css": /* css */ `
        @import "./f.css";
        @import "./g.css";
        @import "./f.css";
      `,
      "/f.css": /* css */ `
        @layer a;
        @import "./leaf.css";
        .f { c: d }
      `,
      "/g.css": `@layer b { .g { c: d } }`,
      "/leaf.css": `.leaf { c: d }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out.css").toBe("@layer a;@layer a;@layer b{.g{c:d}}.leaf{c:d}.f{c:d}\n");
    },
  });

  // A statement stays in the body of its file when no earlier entry prints it:
  // a file with no "@import", and a file that is imported into an anonymous layer.
  const layerStatementsThatStayInTheBody: Record<string, { files: Record<string, string>; out: string }> = {
    NoImport: {
      files: {
        "/entry.css": /* css */ `
          @layer theme, base, components, utilities;
          @layer theme { :root { --x: 1 } }
          @layer base { html { c: d } }
          @layer components {}
          @layer utilities { .u { c: d } }
        `,
      },
      out: "@layer theme,base,components,utilities;@layer theme{:root{--x:1}}@layer base{html{c:d}}@layer utilities{.u{c:d}}",
    },
    AfterARuleThatMinifyRemoves: {
      files: {
        "/entry.css": /* css */ `
          .empty {}
          @layer a, b;
          @layer b { .x { c: d } }
          @layer a { .x { c: e } }
        `,
      },
      out: "@layer a,b;@layer b{.x{c:d}}@layer a{.x{c:e}}",
    },
    AnonymousLayerImport: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css" layer;
          .z { c: d }
        `,
        "/lib.css": /* css */ `
          @layer p, q;
          @import "./leaf.css";
          @layer q { .x { c: e } }
          @layer p { .x { c: f } }
        `,
        "/leaf.css": `.leaf { c: d }`,
      },
      out: "@layer{.leaf{c:d}}@layer{@layer p,q;@layer q{.x{c:e}}@layer p{.x{c:f}}}.z{c:d}",
    },
    ImportedBareAndLayered: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css";
          @import "./lib.css" layer(wrap);
        `,
        "/lib.css": /* css */ `
          @layer p, q;
          @layer q { .x { c: e } }
          @layer p { .x { c: f } }
        `,
      },
      out: "@layer p,q;@layer q{.x{c:e}}@layer p{.x{c:f}}@layer wrap{@layer p,q;@layer q{.x{c:e}}@layer p{.x{c:f}}}",
    },
  };
  for (const [name, { files, out }] of Object.entries(layerStatementsThatStayInTheBody)) {
    itBundled(`css/CSSAtLayerStatementStaysInBody${name}`, {
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      onAfterBundle(api) {
        api.expectFile("/out.css").toBe(out + "\n");
      },
    });
  }

  // The bundle has to declare each layer where the source declares it. In Chrome, `.t` gets the
  // same color from each `out` as from its source files. A `todo` has the right output and says why bun prints another.
  const layerOrderCases: Record<string, { files: Record<string, string>; out: string; todo?: string }> = {
    // The first copy of btn.css is replaced by a list of its layers. That list declares "w" ahead of "u".
    ListForADuplicateImportUnderLayer: {
      todo: 'no file has a statement ahead of an "@import", so the list is removed as on main and in esbuild',
      files: {
        "/entry.css": /* css */ `
          @import "./base.css";
          @import "./btn.css" layer(w);
          @import "./other.css";
          @import "./btn.css" layer(w);
        `,
        "/base.css": `.base { color: black }`,
        "/btn.css": `.t { color: red }`,
        "/other.css": `@layer u { .t { color: blue } }`,
      },
      out: ".base{color:#000}@layer w;@layer u{.t{color:#00f}}@layer w{.t{color:red}}",
    },
    ListForADuplicateImportAheadOfAStatement: {
      files: {
        "/entry.css": /* css */ `
          @import "./base.css";
          @import "./btn.css" layer(w);
          @import "./card.css";
        `,
        "/base.css": `.x { color: green }`,
        "/btn.css": `.t { color: red }`,
        "/card.css": /* css */ `
          @layer u;
          @import "./btn.css" layer(w);
          @layer u { .t { color: blue } }
        `,
      },
      out: ".x{color:green}@layer w;@layer u;@layer w{.t{color:red}}@layer u{.t{color:#00f}}",
    },
    ListForADuplicateImportAheadOfAStatementUnderLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./theme.css";
          @import "./button.css";
          @import "./button.css" layer(ui);
          @import "./lib.css" layer(ui);
        `,
        "/theme.css": /* css */ `
          @layer base { .x { color: green } }
          @layer components { .y { color: green } }
        `,
        "/button.css": /* css */ `
          @layer components { .t { color: red } }
          @layer base { .t { color: blue } }
        `,
        "/lib.css": /* css */ `
          @layer base, components;
          @import "./button.css";
        `,
      },
      out: "@layer base{.x{color:green}}@layer components{.y{color:green}}@layer components{.t{color:red}}@layer base{.t{color:#00f}}@layer ui{@layer components,base;}@layer ui{@layer base,components;}@layer ui{@layer components{.t{color:red}}@layer base{.t{color:#00f}}}@layer ui;",
    },
    StatementOfAFileImportedBareAndUnderLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./p.css";
          @import "./f.css" layer(w);
          @import "./p.css" layer(w);
        `,
        "/p.css": /* css */ `
          @layer a;
          @import "./f.css";
        `,
        "/f.css": /* css */ `
          @layer b, a;
          @layer a { .t { color: red } }
          @layer b { .t { color: blue } }
        `,
      },
      out: "@layer a;@layer b,a;@layer a{.t{color:red}}@layer b{.t{color:#00f}}@layer w{@layer b,a,a,b;}@layer w{@layer a;}@layer w{@layer b,a;@layer a{.t{color:red}}@layer b{.t{color:#00f}}}@layer w;",
    },
    // g.css has the name "a" too, but it does not declare that layer where the statement does.
    NameDeclaredUnderMediaInAnEarlierFile: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./f.css";
        `,
        "/g.css": `@media print { @layer a { .g { color: green } } }`,
        "/f.css": /* css */ `
          @layer a;
          @import "./y.css" layer(b);
          @layer a { .t { color: red } }
        `,
        "/y.css": `.t { color: blue }`,
      },
      out: "@media print{@layer a{.g{color:green}}}@layer a;@layer b{.t{color:#00f}}@layer a{.t{color:red}}",
    },
    NameDeclaredBehindAnAnonymousBlock: {
      files: {
        "/entry.css": /* css */ `
          @layer a;
          @import "./g.css";
        `,
        "/g.css": /* css */ `
          @layer { .t { color: blue } }
          @layer a { .t { color: red } }
        `,
      },
      out: "@layer a;@layer{.t{color:#00f}}@layer a{.t{color:red}}",
    },
    NameDeclaredInABlockThatMinifyRemoves: {
      files: {
        "/entry.css": /* css */ `
          @layer a;
          @import "./g.css";
          @import "./y.css" layer(b);
          @layer a { .t { color: red } }
        `,
        "/g.css": `@layer a { .unused {} }`,
        "/y.css": `.t { color: blue }`,
      },
      out: "@layer a;@layer b{.t{color:#00f}}@layer a{.t{color:red}}",
    },
    // The parser accepts an "@import" behind an unknown at-rule statement and the body prints it again, as on main.
    // The statements stay in that body, so the printed "@import" stays behind a statement, where it is not valid.
    ImportBehindUnknownAtRule: {
      files: {
        "/entry.css": /* css */ `
          @layer a;
          @unknown x;
          @layer b;
          @import "./x.css";
          @layer c;
          .e { c: d }
        `,
        "/x.css": `.x { c: d }`,
      },
      out: '@layer a,b;.x{c:d}@layer a;@unknown x;@layer b;@import "./x.css";@layer c;.e{c:d}',
    },
    ExternalImportBehindUnknownAtRule: {
      files: {
        "/entry.css": /* css */ `
          @import "./a.css";
          @import "https://example.com/f.css";
        `,
        "/a.css": /* css */ `
          @layer first;
          @unknown x;
          @import "https://example.com/e.css";
          .a { c: d }
        `,
      },
      out: '@layer first;@import "https://example.com/e.css";@import "https://example.com/f.css";@layer first;@unknown x;@import "https://example.com/e.css";.a{c:d}',
    },
    // An "@import" that closes a cycle is not loaded, but it still declares its layer.
    CyclicLayeredImportAheadOfAStatement: {
      files: {
        "/entry.css": `@import "./f2.css";`,
        "/f2.css": /* css */ `
          @import "./entry.css" layer(w);
          @import "./f3.css";
        `,
        "/f3.css": /* css */ `
          @layer b;
          @import "./f4.css" layer(w);
          @layer b { .t { color: blue } }
        `,
        "/f4.css": `.t { color: red }`,
      },
      out: "@layer w;@layer b;@layer w{.t{color:red}}@layer b{.t{color:#00f}}",
    },
    CyclicLayeredImport: {
      todo: 'no file has a statement ahead of an "@import", so the layer "w" is not declared, as on main and in esbuild',
      files: {
        "/entry.css": /* css */ `
          @import "./entry.css" layer(w);
          @import "./b.css" layer(b);
          @import "./c.css" layer(w);
        `,
        "/b.css": `.t { color: blue }`,
        "/c.css": `.t { color: red }`,
      },
      out: "@layer w;@layer b{.t{color:#00f}}@layer w{.t{color:red}}",
    },
    EmptyLayerBlock: {
      todo: "the minifier removes the empty block of g.css and its layer with it (#38480 keeps it)",
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./card.css";
        `,
        "/g.css": `@layer a {}`,
        "/card.css": /* css */ `
          @layer u;
          @import "./x.css";
          @layer u { .t { color: blue } }
        `,
        "/x.css": `@layer a { .t { color: red } }`,
      },
      out: "@layer a;@layer u;@layer a{.t{color:red}}@layer u{.t{color:#00f}}",
    },
    // g.css declares "a" only when the page is printed. It does not stand for the list of the first copy of x.css.
    NameDeclaredOnlyUnderMedia: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./x.css";
          @import "./card.css";
        `,
        "/g.css": `@media print { @layer a { .g { color: green } } }`,
        "/x.css": `@layer a { .t { color: red } }`,
        "/card.css": /* css */ `
          @layer u;
          @import "./x.css";
          @layer u { .t { color: blue } }
        `,
      },
      out: "@media print{@layer a{.g{color:green}}}@layer a;@layer u;@layer a{.t{color:red}}@layer u{.t{color:#00f}}",
    },
    // The list for the first copy of tokens.css declares "theme" only in dark mode, as the file does.
    NameDeclaredOnlyUnderMediaInAFileImportedTwice: {
      files: {
        "/entry.css": /* css */ `
          @import "./tokens.css";
          @import "./components.css";
        `,
        "/tokens.css": /* css */ `
          @media (prefers-color-scheme: dark) { @layer theme { :root { --bg: black } } }
          :root { --bg: white }
        `,
        "/components.css": /* css */ `
          @layer base, theme;
          @import "./tokens.css";
          @layer theme { .t { color: red } }
          @layer base { .t { color: blue } }
        `,
      },
      out: "@media (prefers-color-scheme:dark){@layer theme;}@layer base,theme;@media (prefers-color-scheme:dark){@layer theme{:root{--bg:black}}}:root{--bg:white}@layer theme{.t{color:red}}@layer base{.t{color:#00f}}",
    },
    // tokens.css declares "theme" outside "@media" first, so a list of its layers stands for its first copy.
    NameDeclaredOutsideMediaFirstInAFileImportedTwice: {
      files: {
        "/entry.css": /* css */ `
          @import "./tokens.css";
          @import "./components.css";
        `,
        "/tokens.css": /* css */ `
          @layer theme;
          @media (prefers-color-scheme: dark) { @layer theme { :root { --bg: black } } }
          :root { --bg: white }
        `,
        "/components.css": /* css */ `
          @layer base, theme;
          @import "./tokens.css";
          @layer theme { .t { color: red } }
          @layer base { .t { color: blue } }
        `,
      },
      out: "@layer theme,theme;@layer base,theme;@layer theme;@media (prefers-color-scheme:dark){@layer theme{:root{--bg:black}}}:root{--bg:white}@layer theme{.t{color:red}}@layer base{.t{color:#00f}}",
    },
    // A copy under "layer(w)" is kept when a later copy has no layer: its rules are in another layer.
    LayeredCopyBehindABareCopy: {
      files: {
        "/entry.css": /* css */ `
          @layer a;
          @import "./f1.css";
          @layer c { .t { color: red } }
        `,
        "/f1.css": /* css */ `
          @layer c;
          @import "./f2.css" layer(w);
          @import "./f2.css";
        `,
        "/f2.css": /* css */ `
          @layer c;
          @layer a { .t { color: blue } }
        `,
      },
      out: "@layer a;@layer c;@layer w{@layer c;@layer a{.t{color:#00f}}}@layer c;@layer a{.t{color:#00f}}@layer c{.t{color:red}}",
    },
    AnonymousCopyBehindABareCopy: {
      todo: 'the copy of f2.css under a bare "layer" is removed, as in esbuild: bun cannot tell two such layers apart',
      files: {
        "/entry.css": /* css */ `
          @layer a;
          @import "./f1.css";
          @layer c { .t { color: red } }
        `,
        "/f1.css": /* css */ `
          @layer c;
          @import "./f2.css" layer;
          @import "./f2.css";
        `,
        "/f2.css": /* css */ `
          @layer c;
          @layer a { .t { color: blue } }
        `,
      },
      out: "@layer a;@layer c;@layer{@layer c;@layer a{.t{color:#00f}}}@layer c;@layer a{.t{color:#00f}}@layer c{.t{color:red}}",
    },
    // Under a bare "layer" the copies are handled as on main: each entry would print as a layer of its own.
    FileWithImportsUnderBareLayerAndBare: {
      files: {
        "/entry.css": /* css */ `
          @layer a;
          @import "./lib.css" layer;
          @import "./lib.css";
        `,
        "/lib.css": /* css */ `
          @import "./leaf.css";
          @layer a { @layer c { .t { color: red } } }
        `,
        "/leaf.css": `@layer a { .t { color: blue } }`,
      },
      out: "@layer a;@layer a{.t{color:#00f}}@layer a{@layer c{.t{color:red}}}",
    },
    ImportantUnderBareLayer: {
      todo: 'the first copy of f2.css under a bare "layer" is removed, as in esbuild, so "a" is declared ahead of every unnamed layer',
      files: {
        "/entry.css": /* css */ `
          @import "./f2.css" layer;
          @import "./f1.css";
        `,
        "/f1.css": /* css */ `
          @layer a;
          @import "./f2.css" layer;
          @layer a { .t { color: red !important } }
        `,
        "/f2.css": `.t { color: blue !important }`,
      },
      out: "@layer{.t{color:#00f!important}}@layer a;@layer{.t{color:#00f!important}}@layer a{.t{color:red!important}}",
    },
    // Of the lists for the copies of tokens.css that a later copy replaces, only the first one stays.
    NameDeclaredOnlyUnderMediaInAFileImportedFourTimes: {
      files: {
        "/entry.css": /* css */ `
          @import "./tokens.css";
          @import "./c1.css";
          @import "./c2.css";
          @import "./c3.css";
        `,
        "/tokens.css": /* css */ `
          @media (prefers-color-scheme: dark) { @layer theme { :root { --bg: black } } }
          :root { --bg: white }
        `,
        "/c1.css": /* css */ `
          @layer base, theme;
          @import "./tokens.css";
          @layer theme { .t { color: red } }
          @layer base { .t { color: blue } }
        `,
        "/c2.css": `@import "./tokens.css"; .c2 { color: green }`,
        "/c3.css": `@import "./tokens.css"; .c3 { color: green }`,
      },
      out: "@media (prefers-color-scheme:dark){@layer theme;}@layer base,theme;@layer theme{.t{color:red}}@layer base{.t{color:#00f}}.c2{color:green}@media (prefers-color-scheme:dark){@layer theme{:root{--bg:black}}}:root{--bg:white}.c3{color:green}",
    },
    // A duplicate external import stays one "@import" rule, as on main, also when only the first copy has a layer.
    DuplicateExternalImportUnderLayer: {
      files: {
        "/entry.css": /* css */ `
          @layer x;
          @import "https://example.com/a.css" layer(v);
          @import "./m.css" layer(w);
          @import "https://example.com/a.css";
        `,
        "/m.css": `.m { color: red }`,
      },
      out: '@layer x;@layer v;@import "https://example.com/a.css";@layer w{.m{color:red}}',
    },
    StatementBehindAnEarlierFileWithExternalImport: {
      todo: "only the leading statements of the bundle move ahead of the external imports, as in esbuild",
      files: {
        "/entry.css": /* css */ `
          @import "./leaf.css";
          @import "./mid.css";
        `,
        "/leaf.css": `.leaf { c: d }`,
        "/mid.css": /* css */ `
          @layer b;
          @import "https://example.com/e.css" layer(c);
          @layer b { .m { c: d } }
        `,
      },
      out: '@layer b;@import "https://example.com/e.css" layer(c);.leaf{c:d}@layer b{.m{c:d}}',
    },
  };
  for (const [name, { files, out, todo }] of Object.entries(layerOrderCases)) {
    itBundled(`css/CSSAtLayerOrder${name}`, {
      todo: !!todo,
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      onAfterBundle(api) {
        api.expectFile("/out.css").toBe(out + "\n");
      },
    });
  }

  // A CSS module with "composes" cannot print inside a layer wrapper, so its copy under "layer(components)"
  // stays a list of layers, as on main.
  itBundled("css/CSSAtLayerOrderComposesModuleUnderLayerAndBare", {
    files: {
      "/entry.css": /* css */ `
        @layer x;
        @import "./dep.css";
        @import "./Button.module.css" layer(components);
        @import "./Button.module.css";
      `,
      "/dep.css": `.d { color: green }`,
      "/Button.module.css": /* css */ `
        .base { color: red }
        .btn { composes: base; color: blue }
      `,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.css")).toStartWith("@layer x;.d{color:green}@layer components;.base_");
    },
  });

  // The two import orders have the same entries and differ only in the import conditions of the first two. The key
  // of a CSS chunk leaves the conditions out, so e1.js gets the stylesheet of e0.js and no e1.css is written.
  // main writes both files for this input and has the same defect for other inputs. #46357 compares the orders.
  itBundled("css/CSSAtLayerOrderTwoEntryPointsThatDifferInImportConditions", {
    todo: true,
    files: {
      "/e0.js": `import "./f0.css";`,
      "/e1.js": `import "./f2.css"; import "./f0.css";`,
      "/f0.css": /* css */ `
        @import "./f2.css" layer(w) screen;
        @import "./f1.css";
        @import "./f2.css";
      `,
      "/f1.css": /* css */ `
        @layer a;
        @import "./f2.css";
        @import "./f2.css" layer(w) screen;
        @import "./f2.css";
        @layer w { .t { color: blue } }
      `,
      "/f2.css": `@layer a { .t { color: red } }`,
    },
    entryPoints: ["/e0.js", "/e1.js"],
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const rest =
        "@layer a;@media screen{@layer w{@layer a{.t{color:red}}}}@layer w{.t{color:#00f}}@layer a{.t{color:red}}\n";
      api.expectFile("/out/e0.css").toBe("@media screen{@layer w{@layer a;}}@layer a;" + rest);
      api.expectFile("/out/e1.css").toBe("@layer a;@media screen{@layer w{@layer a;}}" + rest);
    },
  });

  // Random "@import" graphs (css-layer-order.ts). The bundle must give `.t` the rule that the sources give it, and
  // the same order of named layers. bun 1.4.3 is wrong on each of these.
  for (const [seed, options] of [
    [1, {}],
    [3, {}],
    [543, {}],
    [2, { anonymous: true }],
  ] as const) {
    test(`css/CSSAtLayerOrder: graph ${seed} ${JSON.stringify(options)}`, async () => {
      expect(await checkGraph(bunExe(), seed, options)).toEqual({ seed, status: "ok", problems: [] });
    });
  }

  // External imports are hoisted to the top, and only "@layer" statements may
  // precede an "@import". Bun rejects an "@import" that follows any other rule,
  // so the second build throws if the first one printed an invalid prologue.
  itBundled("css/CSSAtLayerStatementBeforeExternalAtImport", {
    files: {
      "/entry.css": /* css */ `
        @layer first;
        @import "https://example.com/e.css";
        @import "./local.css" layer(second);
      `,
      "/local.css": `.l { c: d }`,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    async onAfterBundle(api) {
      api.expectFile("/out.css").toBe('@layer first;@import "https://example.com/e.css";@layer second{.l{c:d}}\n');
      await Bun.build({ entrypoints: [api.outfile], outdir: api.join("again") });
    },
  });

  // Under import conditions the layer list prints as a block, so it stays behind the import.
  itBundled("css/CSSAtLayerStatementBeforeExternalAtImportConditional", {
    files: {
      "/entry.css": `@import "./mid.css" layer(wrap) supports(display: flex);`,
      "/mid.css": /* css */ `
        @layer inner;
        @import "https://example.com/e.css";
      `,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    async onAfterBundle(api) {
      api
        .expectFile("/out.css")
        .toBe(
          '@import "https://example.com/e.css" layer(wrap) supports(display:flex);@supports (display:flex){@layer wrap{@layer inner;}}\n',
        );
      await Bun.build({ entrypoints: [api.outfile], outdir: api.join("again") });
    },
  });

  // esbuild's TestCSSAtLayerMergingWithImportConditions. esbuild's snapshot
  // starts with "@supports (color: first) { @layer a; }", ahead of the imports.
  itBundled("css/CSSAtLayerMergingWithImportConditions", {
    files: {
      "/entry.css": /* css */ `
        @import "a.css" supports(color: first);

        @import "a.css" supports(color: second);
        @import "b.css" supports(color: second);

        @import "a.css" supports(color: first);
        @import "b.css" supports(color: first);

        @import "a.css" supports(color: second);
        @import "b.css" supports(color: second);

        @import "b.css" supports(color: first);
      `,
      "/a.css": /* css */ `
        @layer a;
        @import "http://example.com/a.css";
      `,
      "/b.css": /* css */ `
        @layer b;
        @import "http://example.com/b.css";
      `,
    },
    outfile: "/out.css",
    minifyWhitespace: true,
    async onAfterBundle(api) {
      api
        .expectFile("/out.css")
        .toBe(
          '@import "http://example.com/a.css" supports(color:first);@import "http://example.com/a.css" supports(color:second);@import "http://example.com/b.css" supports(color:second);@import "http://example.com/b.css" supports(color:first);' +
            "@supports (color:first){@layer a;}@supports (color:first){@layer a;}@supports (color:second){@layer a;}@supports (color:second){@layer a;}" +
            "@supports (color:second){@layer b;}@supports (color:second){@layer b;}@supports (color:first){@layer b;}@supports (color:first){@layer b;}\n",
        );
      await Bun.build({ entrypoints: [api.outfile], outdir: api.join("again") });
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

  // A layer that a file declares inside "@media", "@supports" or "@-moz-document" is in the layer order only while that
  // condition holds (css-cascade-5, "Layer Ordering"; WPT css/css-cascade/layer-media-query.html). Such a file does
  // not stand for a list of its layer names, and the list that stands for an earlier copy of the file keeps the rule
  // around each name. In Chrome, `.t` gets the same color from each `out` as from its source files. A `todo` has the
  // right output and says why bun prints another.
  type ConditionalLayerCase = { files: Record<string, string>; out: string; todo?: string };
  // x.css is imported twice. The list for its first copy declares "a" ahead of "u", unless g.css declares "a".
  const listBehind = (g: string, out: string): ConditionalLayerCase => ({
    files: {
      "/entry.css": /* css */ `
        @import "./g.css";
        @import "./x.css";
        @import "./y.css";
        @import "./x.css";
      `,
      "/g.css": g,
      "/x.css": `@layer a { .t { color: red } }`,
      "/y.css": `@layer u { .t { color: blue } }`,
    },
    out: out + "@layer u{.t{color:#00f}}@layer a{.t{color:red}}",
  });
  // g.css is imported twice, so its first copy prints as its layers alone.
  const importedTwice = (g: string, out: string, entry?: string): ConditionalLayerCase => ({
    files: {
      "/entry.css":
        entry ??
        /* css */ `
          @import "./g.css";
          @import "./other.css";
          @import "./g.css";
        `,
      "/g.css": g,
      "/other.css": /* css */ `
        @layer base { .t { color: blue } }
        @layer theme { .t { color: red } }
      `,
    },
    out,
  });
  const other = "@layer base{.t{color:#00f}}@layer theme{.t{color:red}}";
  const conditionalLayerCases: Record<string, ConditionalLayerCase> = {
    ListBehindAFileWithTheLayerUnderMedia: listBehind(
      `@media print { @layer a { .g { color: green } } }`,
      "@media print{@layer a{.g{color:green}}}@layer a;",
    ),
    ListBehindAFileWithTheLayerUnderSupports: listBehind(
      `@supports (display: no-such-value) { @layer a { .g { color: green } } }`,
      "@supports (display: no-such-value){@layer a{.g{color:green}}}@layer a;",
    ),
    // "@media all" is no condition: g.css declares "a", and the list is not needed.
    ListBehindAFileWithTheLayerUnderMediaAll: listBehind(
      `@media all { @layer a { .g { color: green } } }`,
      "@layer a{.g{color:green}}",
    ),
    Media: importedTwice(
      `@media print { @layer theme { .g { color: green } } }`,
      `@media print{@layer theme;}${other}@media print{@layer theme{.g{color:green}}}`,
    ),
    Supports: importedTwice(
      `@supports (display: no-such-value) { @layer theme { .g { color: green } } }`,
      `@supports (display: no-such-value){@layer theme;}${other}@supports (display: no-such-value){@layer theme{.g{color:green}}}`,
    ),
    MozDocument: importedTwice(
      `@-moz-document url-prefix() { @layer theme { .g { color: green } } }`,
      `@-moz-document url-prefix(){@layer theme;}${other}@-moz-document url-prefix(){@layer theme{.g{color:green}}}`,
    ),
    // The list has to print the query that the rule of the file prints.
    MediaFeatures: importedTwice(
      `@media (min-resolution: 2dppx) and (width >= 600px) { @layer theme { .g { color: green } } }`,
      `@media (min-resolution:2dppx) and (min-width:600px){@layer theme;}${other}@media (min-resolution:2dppx) and (min-width:600px){@layer theme{.g{color:green}}}`,
    ),
    Statement: importedTwice(
      /* css */ `
        @media print { @layer theme, print; }
        .g { color: green }
      `,
      `@media print{@layer theme,print;}${other}@media print{@layer theme,print;}.g{color:green}`,
    ),
    NestedConditions: importedTwice(
      /* css */ `
        @media print {
          @supports (display: grid) { @layer theme { .g { color: green } } }
          @layer print { .g { color: black } }
        }
      `,
      `@media print{@supports (display: grid){@layer theme;}@layer print;}${other}@media print{@supports (display: grid){@layer theme{.g{color:green}}}@layer print{.g{color:#000}}}`,
    ),
    TwoRules: importedTwice(
      /* css */ `
        @media print { @layer theme { .g { color: green } } }
        @supports (display: grid) { @layer late { .g { color: black } } }
      `,
      `@media print{@layer theme;}@supports (display: grid){@layer late;}${other}@media print{@layer theme{.g{color:green}}}@supports (display: grid){@layer late{.g{color:#000}}}`,
    ),
    // The first rule declares "theme" only in print, so the second rule declares it too.
    SameLayerUnderTwoConditions: importedTwice(
      /* css */ `
        @media print { @layer theme { .g { color: green } } }
        @media screen { @layer theme { .g { color: black } } }
      `,
      `@media print{@layer theme;}@media screen{@layer theme;}${other}@media print{@layer theme{.g{color:green}}}@media screen{@layer theme{.g{color:#000}}}`,
    ),
    // "base" is declared in every case, "base.theme" only in print.
    Sublayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./sublayers.css";
          @import "./g.css";
        `,
        "/g.css": /* css */ `
          @layer base {
            .g { color: green }
            @media print { @layer theme { .g { color: black } } }
          }
        `,
        "/sublayers.css": /* css */ `
          @layer base.reset { .t { color: blue } }
          @layer base.theme { .t { color: red } }
        `,
      },
      out: "@layer base;@media print{@layer base.theme;}@layer base.reset{.t{color:#00f}}@layer base.theme{.t{color:red}}@layer base{.g{color:green}@media print{@layer theme{.g{color:#000}}}}",
    },
    InsideAStyleRule: importedTwice(
      `.g { @media print { @layer theme { color: green } } }`,
      `@media print{@layer theme;}${other}@media print{@layer theme{.g{color:green}}}`,
    ),
    // "@container" does not make a layer conditional, but the "@media" inside it does.
    InsideContainer: importedTwice(
      `@container (min-width: 1px) { @media print { @layer theme { .g { color: green } } } }`,
      `@media print{@layer theme;}${other}@container (width>=1px){@media print{@layer theme{.g{color:green}}}}`,
    ),
    // On a screen g.css declares "print" ahead of "theme".
    DeclaredAgainOutsideLater: importedTwice(
      /* css */ `
        @media print { @layer theme { .g { color: green } } }
        @layer print { .g { color: black } }
        @layer theme { .g { color: gray } }
      `,
      `@media print{@layer theme;}@layer print,theme;${other}@media print{@layer theme{.g{color:green}}}@layer print{.g{color:#000}}@layer theme{.g{color:gray}}`,
    ),
    // g.css declares "theme" outside "@media" first, so the layer is there in every case.
    DeclaredOutsideFirst: importedTwice(
      /* css */ `
        @layer theme { .g { color: green } }
        @media print { @layer theme { .g { color: black } } }
      `,
      `@layer theme,theme;${other}@layer theme{.g{color:green}}@media print{@layer theme{.g{color:#000}}}`,
    ),
    // "theme.dark" declares "theme" too.
    SublayerDeclaredOutsideFirst: importedTwice(
      /* css */ `
        @layer theme.dark { .g { color: green } }
        @media print { @layer theme { .g { color: black } } }
      `,
      `@layer theme.dark,theme;${other}@layer theme.dark{.g{color:green}}@media print{@layer theme{.g{color:#000}}}`,
    ),
    MediaThatNeverMatches: importedTwice(
      /* css */ `
        @media not all { @layer theme { .g { color: green } } }
        .g { color: black }
      `,
      `${other}.g{color:#000}`,
    ),
    MediaInsideAMediaThatNeverMatches: importedTwice(
      /* css */ `
        @media not all { @media print { @layer theme { .g { color: green } } } }
        @layer late { .g { color: black } }
      `,
      `@layer late;${other}@layer late{.g{color:#000}}`,
    ),
    // The file declares the same layers at the same place, so no list is needed.
    DirectlyAheadOfItsFile: importedTwice(
      `@media print { @layer theme { .g { color: green } } }`,
      `${other}@media print{@layer theme{.g{color:green}}}`,
      /* css */ `
        @import "./other.css";
        @import "./g.css";
        @import "./g.css";
      `,
    ),
    // The second copy declares nothing that the list for the first copy does not declare.
    ThreeCopies: importedTwice(
      `@media print { @layer theme { .g { color: green } } }`,
      `@media print{@layer theme;}${other}@media print{@layer theme{.g{color:green}}}`,
      /* css */ `
        @import "./g.css";
        @import "./other.css";
        @import "./g.css";
        @import "./g.css";
      `,
    ),
    // The statement of entry.css prints ahead of the imported files. It declares "theme" ahead of "base" in every
    // case, and the list of g.css is behind it.
    StatementAheadOfTheImports: importedTwice(
      `@media print { @layer theme { .g { color: green } } }`,
      `@layer theme,base;@media print{@layer theme;}${other}@media print{@layer theme{.g{color:green}}}`,
      /* css */ `
        @layer theme, base;
        @import "./g.css";
        @import "./other.css";
        @import "./g.css";
      `,
    ),
    ImportUnderLayer: importedTwice(
      `@media print { @layer theme { .g { color: green } } }`,
      `@layer ui{@media print{@layer theme;}}@layer ui{${other}}@layer ui{@media print{@layer theme{.g{color:green}}}}`,
      /* css */ `
        @import "./g.css" layer(ui);
        @import "./other.css" layer(ui);
        @import "./g.css" layer(ui);
      `,
    ),
    // Inside an anonymous layer no other file can name "theme", so there is no list.
    ImportUnderAnonymousLayer: importedTwice(
      `@media print { @layer theme { .g { color: green } } }`,
      `${other}@layer{@media print{@layer theme{.g{color:green}}}}`,
      /* css */ `
        @import "./g.css" layer;
        @import "./other.css";
        @import "./g.css" layer;
      `,
    ),
    ImportUnderMedia: importedTwice(
      `@supports (display: no-such-value) { @layer theme { .g { color: green } } }`,
      `@media screen{@supports (display: no-such-value){@layer theme;}}${other}@media screen{@supports (display: no-such-value){@layer theme{.g{color:green}}}}`,
      /* css */ `
        @import "./g.css" screen;
        @import "./other.css";
        @import "./g.css" screen;
      `,
    ),
    // h.css has the rules of g.css. One list stands for the first copies of both files.
    EqualRulesInTwoFiles: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./h.css";
          @import "./other.css";
          @import "./g.css";
          @import "./h.css";
        `,
        "/g.css": `@media print { @layer theme { .g { color: green } } }`,
        "/h.css": `@media print { @layer theme { .h { color: black } } }`,
        "/other.css": /* css */ `
          @layer base { .t { color: blue } }
          @layer theme { .t { color: red } }
        `,
      },
      out: `@media print{@layer theme;}${other}@media print{@layer theme{.g{color:green}}}@media print{@layer theme{.h{color:#000}}}`,
    },
    // The copy under "layer(ui)" has its rules in other layers than the bare copies, so it stays whole. The list for
    // the first bare copy does not stand for it.
    LayeredCopyBetweenBareCopies: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./g.css" layer(ui);
          @import "./late.css";
          @import "./g.css";
        `,
        "/g.css": /* css */ `
          @media print { @layer theme { .g { color: green } } }
          @layer base { .g { color: black } }
        `,
        "/late.css": /* css */ `
          @layer late { .t { color: blue } }
          @layer ui { .t { color: red } }
        `,
      },
      out: "@media print{@layer theme;}@layer base;@layer ui{@media print{@layer theme{.g{color:green}}}@layer base{.g{color:#000}}}@layer late{.t{color:#00f}}@layer ui{.t{color:red}}@media print{@layer theme{.g{color:green}}}@layer base{.g{color:#000}}",
    },
    // Both lists for the first copy of f.css stay. The list of g.css alone would put "a" ahead of "b" inside "v".
    LayeredCopiesOfTwoFiles: {
      files: {
        "/entry.css": /* css */ `
          @import "./h.css";
          @import "./g.css";
          @import "./f.css";
          @import "./f.css";
        `,
        "/f.css": /* css */ `
          @import "./h.css" layer(v);
          @import "./g.css" layer(v);
        `,
        "/g.css": `@media screen { @layer a { .t { color: blue } } }`,
        "/h.css": `@layer b { .t { color: red } }`,
      },
      out: "@layer b{.t{color:red}}@media screen{@layer a{.t{color:#00f}}}@layer v{@layer b;}@layer v{@media screen{@layer a;}}@layer v{@layer b{.t{color:red}}}@layer v{@media screen{@layer a{.t{color:#00f}}}}",
    },
    // The list for the first import of b.css would print as a block between the two "@import" rules, and an "@import"
    // behind a block is not valid. So it is dropped, as on main.
    ExternalImports: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/a.css";
          @import "https://example.com/b.css" layer(x) print;
          @import "https://example.com/b.css";
          @import "./g.css";
        `,
        "/g.css": `@media print { @layer theme { .g { color: green } } }`,
      },
      out: '@import "https://example.com/a.css";@import "https://example.com/b.css";@media print{@layer theme{.g{color:green}}}',
    },
    // A browser declares a layer inside these rules in every case, so the list is a plain list, as on main.
    Container: importedTwice(
      `@container (min-width: 1px) { @layer theme { .g { color: green } } }`,
      `@layer theme;${other}@container (width>=1px){@layer theme{.g{color:green}}}`,
    ),
    Scope: importedTwice(
      `@scope (.g) { @layer theme { .g { color: green } } }`,
      `@layer theme;${other}@scope(.g){@layer theme{.g{color:green}}}`,
    ),
    StartingStyle: importedTwice(
      `@starting-style { @layer theme { .g { color: green } } }`,
      `@layer theme;${other}@starting-style{@layer theme{.g{color:green}}}`,
    ),
    StyleRule: importedTwice(
      `.g { @layer theme { color: green } }`,
      `@layer theme;${other}@layer theme{.g{color:green}}`,
    ),
    // In the sources the first layer is the unnamed one of the first copy of f2.css, so `.t` is green. A list cannot
    // declare an unnamed layer, and the list under "layer(v)" keeps the bare list away from its file.
    UnnamedBlockWithImportant: {
      todo: 'the lists for the first copies of f2.css declare "a" ahead of its unnamed layer: main and esbuild print no list here, and have the same defect when another file is between the copies',
      files: {
        "/entry.css": /* css */ `
          @import "./f1.css";
          @import "./f1.css";
        `,
        "/f1.css": /* css */ `
          @import "./f2.css";
          @import "./f2.css" layer(v);
        `,
        "/f2.css": /* css */ `
          @layer { .t { color: green !important } }
          @media (min-width: 1px) { @layer a { .t { color: blue !important } } }
        `,
      },
      out: "@layer{.t{color:green!important}}@media (min-width:1px){@layer a{.t{color:#00f!important}}}@layer v{@layer{.t{color:green!important}}@media (min-width:1px){@layer a{.t{color:#00f!important}}}}",
    },
    // "@namespace" is valid only ahead of every rule but "@import" and "@layer" statements. A list under a condition
    // prints as a block, as a list under import conditions does on main.
    ListAheadOfNamespace: {
      todo: 'the list is a block ahead of "@namespace", so a browser drops that rule (#46232 moves "@namespace" to the top)',
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./ns.css";
          @import "./g.css";
        `,
        "/g.css": `@media print { @layer theme { .g { color: green } } }`,
        "/ns.css": /* css */ `
          @namespace svg url(http://www.w3.org/2000/svg);
          @layer base { svg|a { color: blue } }
          @layer theme { .t { color: red } }
        `,
      },
      out: '@namespace svg "http://www.w3.org/2000/svg";@media print{@layer theme;}@layer base{svg|a{color:#00f}}@layer theme{.t{color:red}}@media print{@layer theme{.g{color:green}}}',
    },
  };
  for (const [name, { files, out, todo }] of Object.entries(conditionalLayerCases)) {
    itBundled(`css/CSSAtLayerConditional${name}`, {
      todo: !!todo,
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      onAfterBundle(api) {
        api.expectFile("/out.css").toBe(out + "\n");
      },
    });
  }
  for (const name of ["ListBehindAFileWithTheLayerUnderMedia", "Media"]) {
    const { files, out } = conditionalLayerCases[name];
    itBundled(`css/CSSAtLayerConditional${name}CLI`, {
      backend: "cli",
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      onAfterBundle(api) {
        api.expectFile("/out.css").toBe(out + "\n");
      },
    });
  }

  // Both entry points have y.css, print.css, x.css and both.css behind one list. a.js needs the list of print.css,
  // which declares "x" only in print. b.js needs the list of x.css, which declares it in every case. So the two
  // cannot share one CSS file.
  itBundled("css/CSSAtLayerConditionalTwoEntryPoints", {
    files: {
      "/a.js": /* js */ `
        import "./print.css";
        import "./y.css";
        import "./both.css";
        console.log("a");
      `,
      "/b.js": /* js */ `
        import "./x.css";
        import "./y.css";
        import "./both.css";
        console.log("b");
      `,
      "/print.css": `@media print { @layer x { .p { color: green } } }`,
      "/x.css": `@layer x { .t { color: red } }`,
      "/y.css": `@layer y { .t { color: blue } }`,
      "/both.css": /* css */ `
        @import "./print.css";
        @import "./x.css";
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const files = "@layer y{.t{color:#00f}}@media print{@layer x{.p{color:green}}}@layer x{.t{color:red}}\n";
      api.expectFile("/out/a.css").toBe("@media print{@layer x;}" + files);
      api.expectFile("/out/b.css").toBe("@layer x;" + files);
    },
  });

  // The two import orders differ only in the file that the first list stands for: p1.css for a.js, p2.css for b.js.
  // Both lists declare the same layer under the same condition, so the entry points share one CSS file, as on main.
  // With a name from the hash of the content, two files with these bytes would have one output path.
  itBundled("css/CSSAtLayerConditionalTwoEntryPointsWithEqualLists", {
    files: {
      "/a.js": /* js */ `
        import "./p1.css";
        import "./y.css";
        import "./both.css";
        console.log("a");
      `,
      "/b.js": /* js */ `
        import "./p2.css";
        import "./y.css";
        import "./both.css";
        console.log("b");
      `,
      "/p1.css": `@media print { @layer x { .p1 { color: green } } }`,
      "/p2.css": `@media print { @layer x { .p2 { color: green } } }`,
      "/y.css": `@layer y { .t { color: blue } }`,
      "/both.css": /* css */ `
        @import "./p1.css";
        @import "./p2.css";
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    entryNaming: "[hash].[ext]",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const css = readdirSync(api.outdir).filter(file => file.endsWith(".css"));
      expect(css).toHaveLength(1);
      api
        .expectFile("/out/" + css[0])
        .toBe(
          "@media print{@layer x;}@layer y{.t{color:#00f}}@media print{@layer x{.p1{color:green}}}@media print{@layer x{.p2{color:green}}}\n",
        );
    },
  });

  // Both import orders have the lists of p1.css and p2.css, in the order in which the entry point imports the two
  // files. The lists declare different layers, so the entry points cannot share one CSS file.
  itBundled("css/CSSAtLayerConditionalTwoEntryPointsWithListsInAnotherOrder", {
    files: {
      "/a.js": /* js */ `
        import "./p1.css";
        import "./p2.css";
        import "./y.css";
        import "./both.css";
        console.log("a");
      `,
      "/b.js": /* js */ `
        import "./p2.css";
        import "./p1.css";
        import "./y.css";
        import "./both.css";
        console.log("b");
      `,
      "/p1.css": `@media print { @layer a { .p { color: green } } }`,
      "/p2.css": `@media print { @layer b { .p { color: black } } }`,
      "/y.css": `@layer y { .t { color: blue } }`,
      "/both.css": /* css */ `
        @import "./p1.css";
        @import "./p2.css";
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const files =
        "@layer y{.t{color:#00f}}@media print{@layer a{.p{color:green}}}@media print{@layer b{.p{color:#000}}}\n";
      api.expectFile("/out/a.css").toBe("@media print{@layer a;}@media print{@layer b;}" + files);
      api.expectFile("/out/b.css").toBe("@media print{@layer b;}@media print{@layer a;}" + files);
    },
  });

  // lib.css gives "theme" and "late" their places with import conditions, and the bundle of lib.css does it with
  // "@media" and "@supports" rules. An app that imports the library twice gets the same bundle from both forms.
  {
    const app = {
      "entry.css": /* css */ `
        @import "./lib.css";
        @import "./other.css";
        @import "./lib.css";
      `,
      "other.css": /* css */ `
        @layer base { .t { color: blue } }
        @layer theme { .t { color: red } }
        @layer late { .t { color: gray } }
      `,
    };
    itBundled("css/CSSAtLayerConditionalBundleOfABundle", {
      files: {
        "/src/entry.css": app["entry.css"],
        "/src/other.css": app["other.css"],
        "/src/lib.css": /* css */ `
          @import "./a.css" layer(theme) print;
          @import "./b.css" layer(late) supports(display: grid);
        `,
        "/src/a.css": `.g { color: green }`,
        "/src/b.css": `.g { color: black }`,
        "/dist/entry.css": app["entry.css"],
        "/dist/other.css": app["other.css"],
      },
      entryPoints: ["/src/entry.css", "/src/lib.css"],
      outdir: "/out",
      minifyWhitespace: true,
      async onAfterBundle(api) {
        const lib = api.readFile("/out/lib.css");
        expect(lib).toBe(
          "@media print{@layer theme{.g{color:green}}}@supports (display:grid){@layer late{.g{color:#000}}}\n",
        );
        api.writeFile("/dist/lib.css", lib);
        const again = await Bun.build({ entrypoints: [api.join("dist/entry.css")], minify: { whitespace: true } });
        expect(await again.outputs[0].text()).toBe(api.readFile("/out/entry.css"));
      },
    });
  }

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
