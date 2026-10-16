import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
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

  // A url() in an at-rule prelude that is kept as raw tokens is not an import.
  // None of these targets exist except x.json, so the build passes only when
  // no prelude url() goes through path resolution.
  itBundled("css/URLInUnknownAtRulePreludeIsNotAnImport", {
    files: {
      "/entry.css": /* css */ `
        @media print { .c2 { z-index: 1 } @import url(sub/g.css); }
        @supports (display: grid) { @import url(sub/g.css); }
        @layer foo { @import url(sub/g.css); }
        @media print { @namespace url(sub/g.css); }
        @foo url(sub/g.css);
        @foo url("sub/g.css");
        @foo bar(url(sub/g.css), url("sub/h.css"));
        @media print { @foo url(sub/g.css); }
        @media (min-width: env(foo, url(sub/g.css))) { .b { color: red } }
        @foo url(x.json);
        .c0 { color: blue }
      `,
      "/x.json": `{}`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe(`/* entry.css */
@media print {
  .c2 {
    z-index: 1;
  }

  @import url(sub/g.css);
}

@supports (display: grid) {
  @import url(sub/g.css);
}

@layer foo {
  @import url(sub/g.css);
}

@media print {
  @namespace url(sub/g.css);
}

@foo url(sub/g.css);

@foo url("sub/g.css");

@foo bar(url(sub/g.css), url("sub/h.css"));

@media print {
  @foo url(sub/g.css);
}

@media (min-width: env(foo, url(sub/g.css))) {
  .b {
    color: red;
  }
}

@foo url(x.json);

.c0 {
  color: #00f;
}
`);
    },
  });

  // The target exists here. It must not become a bundle input.
  itBundled("css/URLInNestedAtImportKeptAsWrittenMinified", {
    files: {
      "/entry.css": /* css */ `
        @media print { .c2 { z-index: 1 } @import url(sub/g.css); }
        .c0 { color: blue }
      `,
      "/sub/g.css": `.c0 { color: red }`,
    },
    backend: "cli",
    minifyWhitespace: true,
    metafile: true,
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe("@media print{.c2{z-index:1}@import url(sub/g.css);}.c0{color:#00f}\n");
      expect(Object.keys(JSON.parse(api.readFile("/metafile.json")).inputs)).toEqual(["entry.css"]);
    },
  });

  {
    const resolved: string[] = [];
    itBundled("css/URLInUnknownAtRulePreludeSkipsOnResolve", {
      files: {
        "/entry.css": /* css */ `
          @media print { @import url(sub/g.css); }
          @foo url("sub/h.css");
          @media (min-width: env(foo, url(sub/i.css))) { .b { color: red } }
          .a { background: url(./a.txt) }
        `,
        "/sub/g.css": `.g { color: red }`,
        "/sub/h.css": `.h { color: red }`,
        "/sub/i.css": `.i { color: red }`,
        "/a.txt": `hello`,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          resolved.push(args.path);
          return undefined;
        });
      },
      onAfterBundle(api) {
        expect(resolved.filter(path => !path.endsWith("entry.css"))).toEqual(["./a.txt"]);
        api.expectFile("/out/entry.css").toBe(`/* entry.css */
@media print {
  @import url(sub/g.css);
}

@foo url("sub/h.css");

@media (min-width: env(foo, url(sub/i.css))) {
  .b {
    color: red;
  }
}

.a {
  background: url("data:text/plain;base64,aGVsbG8=");
}
`);
      },
    });
  }

  // Before: `panic: index out of bounds: the len is 0 but the index is 0`.
  // The url() record index pointed into the importing file's records, and
  // the condition was printed with the records of the import chain.
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

  // Before: the url() record of `@foo` took the place of the `@import`
  // record, so g.css was inlined and b.css was not.
  itBundled("css/URLInUnknownAtRuleBeforeAtImport", {
    files: {
      "/entry.css": /* css */ `
        @foo url(sub/g.css);
        @import "./b.css";
        .c0 { color: blue }
      `,
      "/b.css": `.b1 { color: green }`,
      "/sub/g.css": `.g { color: red }`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      expect(css).toStartWith(`/* b.css */
.b1 {
  color: green;
}

/* entry.css */
@foo url(sub/g.css);
`);
      expect(css).not.toContain(".g {");
    },
  });

  // A url() after a prelude is an import again: in a declaration, in a custom
  // property, next to var(), and in the block of an unknown at-rule.
  // `@media (foo: bar)` covers the env() attempt that fails and backtracks.
  itBundled("css/URLAfterAtRulePreludeIsStillAnImport", {
    files: {
      "/entry.css": /* css */ `
        @import url(sub/g.css);
        @foo url(missing.css);
        @media (min-width: env(foo, url(missing.css))) { .b { color: red } }
        @media (foo: bar) { .b2 { color: red } }
        @foo url(missing.css) { background: url(./a.txt) }
        .a { --x: url(./a.txt); background: url(./a.txt) }
        .v { --y: 1; background: var(--y) url(./a.txt) }
        @container style(--x: url(./a.txt)) { .c { color: red } }
      `,
      "/sub/g.css": `.g { color: red }`,
      "/a.txt": `hello`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe(`/* sub/g.css */
.g {
  color: red;
}

/* entry.css */
@foo url(missing.css);

@media (min-width: env(foo, url(missing.css))) {
  .b {
    color: red;
  }
}

@media (foo: bar) {
  .b2 {
    color: red;
  }
}

@foo url(missing.css) {
  background: url("data:text/plain;base64,aGVsbG8=")
}

.a {
  --x: url("data:text/plain;base64,aGVsbG8=");
  background: url("data:text/plain;base64,aGVsbG8=");
}

.v {
  --y: 1;
  background: var(--y) url("data:text/plain;base64,aGVsbG8=");
}

@container style(--x: url("data:text/plain;base64,aGVsbG8=")) {
  .c {
    color: red;
  }
}
`);
    },
  });

  itBundled("css/MissingURLAfterAtRulePreludeIsStillAnError", {
    files: {
      "/entry.css": /* css */ `
        @foo url(missing.css);
        @media (min-width: env(foo, url(missing.css))) { .b { color: red } }
        @media (foo: bar) { .b2 { color: red } }
        .a { --x: url(./one.png) }
        .v { --y: 1; background: var(--y) url(./two.png) }
        .t { background: url(./three.png) }
        @foo { background: url(./four.png) }
      `,
    },
    bundleErrors: {
      "/entry.css": [
        'Could not resolve: "./one.png"',
        'Could not resolve: "./two.png"',
        'Could not resolve: "./three.png"',
        'Could not resolve: "./four.png"',
      ],
    },
  });

  // A url() that resolves to a file with no URL form (a stylesheet, a .toml
  // file) must not print the absolute path of the build directory.
  itBundled("css/URLWithNoAssetURLDoesNotPrintBuildDirectory", {
    files: {
      "/entry.css": /* css */ `
        .a { background: url(sub/g.css) }
        .t { background: url(./x.toml) }
        .s { background: url(./x.sh) }
        .v { --y: 1; background: var(--y) url(sub/g.css) }
        .j { --x: url(sub/g.css) }
        .i { background: image-set(url(sub/g.css) 1x) }
        .q { background: url(./sub/g.css?x=1#y) }
        @font-face { font-family: a; src: url(sub/g.css) }
        @foo { background: url(sub/g.css) }
      `,
      "/sub/g.css": `.g { color: red }`,
      "/x.toml": `a = 1`,
      "/x.sh": `echo hi`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      expect(css.match(/url\(/g)).toHaveLength(9);
      expect(css).not.toContain("bun-build-tests");
    },
  });

  // `composes` in a file that is not a CSS module still bundles its target.
  // Only the printed specifier is checked here.
  itBundled("css/ComposesFromInPlainCSSDoesNotPrintBuildDirectory", {
    files: {
      "/entry.css": `.k { composes: g from "./sub/g.css" }`,
      "/sub/g.css": `.g { color: red }`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      expect(css).toContain("composes: g from");
      expect(css).not.toContain("bun-build-tests");
    },
  });

  itBundled("css/URLWithNoAssetURLDoesNotPrintBuildDirectoryFromCLI", {
    files: {
      "/entry.css": /* css */ `
        .a { background: url(sub/g.css) }
      `,
      "/sub/g.css": `.g { color: red }`,
    },
    backend: "cli",
    minifyWhitespace: true,
    outdir: "/out",
    onAfterBundle(api) {
      const css = api.readFile("/out/entry.css");
      expect(css).toStartWith(".a{background:url(");
      expect(css).not.toContain("bun-build-tests");
    },
  });

  itBundled("css/URLWithNoAssetURLDoesNotPrintBuildDirectoryFromHTMLAndJS", {
    files: {
      "/index.html": /* html */ `
        <!doctype html>
        <html>
          <head>
            <link rel="stylesheet" href="./page.css" />
            <script type="module" src="./app.js"></script>
          </head>
          <body></body>
        </html>
      `,
      "/page.css": `.page { background: url(./other.css) }`,
      "/app.js": /* js */ `
        import "./plain.css";
        import styles from "./mod.module.css";
        console.log(styles.mod);
      `,
      "/plain.css": `.plain { background: url(./other.css) }`,
      "/mod.module.css": `.mod { background: url(./other.css) }`,
      "/other.css": `.other { color: red }`,
    },
    entryPoints: ["/index.html"],
    outdir: "/out",
    onAfterBundle(api) {
      const chunks = readdirSync(api.outdir).filter(name => name.endsWith(".css"));
      expect(chunks).toHaveLength(1);
      const css = api.readFile("/out/" + chunks[0]);
      expect(css.match(/url\(/g)).toHaveLength(3);
      expect(css).not.toContain("bun-build-tests");
    },
  });

  // Two files name the same stylesheet in a url(). Before, the first one to
  // be resolved got the absolute path and the other kept the written text,
  // and which one was first changed from build to build.
  test("css url() to the same stylesheet from two files prints the same in every build", async () => {
    using dir = tempDir("css-url-two-importers", {
      "entry.css": `@import "./one.css";\n@import "./two.css";\n`,
      "one.css": `.one { background: url(./shared.css) }\n`,
      "two.css": `.two { background: url(./shared.css) }\n`,
      "shared.css": `.shared { color: red }\n`,
    });
    const outputs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const result = await Bun.build({ entrypoints: [join(String(dir), "entry.css")] });
      expect(result.success).toBe(true);
      outputs.add(await result.outputs[0].text());
    }
    expect(outputs.size).toBe(1);
    const urls = [...outputs][0].match(/url\([^)]*\)/g)!;
    expect(urls).toHaveLength(2);
    expect(urls.join("")).not.toContain(basename(String(dir)));
  });

  test("css url() with the in-memory files map does not print the virtual directory", async () => {
    const result = await Bun.build({
      entrypoints: ["/virtual/entry.css"],
      files: {
        "/virtual/entry.css": `@media print { @import url(sub/g.css); }\n.a { background: url(sub/g.css) }\n`,
        "/virtual/sub/g.css": `.g { color: red }\n`,
      },
    });
    expect(result.success).toBe(true);
    const urls = (await result.outputs[0].text()).match(/url\([^)]*\)/g)!;
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("url(sub/g.css)");
    expect(urls[1]).not.toContain("virtual");
  });

  // The dataurl loader gives no data: URL yet. Until it does, the url() must
  // at least not name the build directory.
  test("css url() to a file with the dataurl loader does not print the build directory", async () => {
    using dir = tempDir("css-url-dataurl-loader", {
      "entry.css": `.d { background: url(./logo.data) }\n`,
      "logo.data": `logo`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.css")],
      loader: { ".data": "dataurl" },
    });
    expect(result.success).toBe(true);
    const urls = (await result.outputs[0].text()).match(/url\([^)]*\)/g)!;
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain(basename(String(dir)));
  });

  // `bun build --no-bundle` parses with no import record list, so it rejects
  // every url() that needs a record. A url() in a prelude needs none.
  test("css url() in an at-rule prelude builds with --no-bundle", async () => {
    using dir = tempDir("css-url-prelude-no-bundle", {
      "unknown.css": `@foo url(sub/g.css);\n`,
      "nested.css": `@media print { @import url("sub/g.css"); }\n`,
      "env.css": `@media (min-width: env(foo, url(sub/g.css))) { .b { color: red } }\n`,
    });
    const build = async (...args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--no-bundle", ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, log: stderr.split("\n").filter(line => /^(warn|error):/.test(line)), exitCode };
    };
    expect(
      await Promise.all([
        build("unknown.css"),
        build("--minify", "unknown.css"),
        build("nested.css"),
        build("--minify", "nested.css"),
        build("env.css"),
        build("--minify", "env.css"),
      ]),
    ).toEqual([
      { stdout: "@foo url(sub/g.css);\n", log: ["warn: invalid @ rule encountered: '@foo'"], exitCode: 0 },
      { stdout: "@foo url(sub/g.css);", log: ["warn: invalid @ rule encountered: '@foo'"], exitCode: 0 },
      {
        stdout: '@media print {\n  @import url("sub/g.css");\n}\n',
        log: ["warn: invalid @ rule encountered: '@import'"],
        exitCode: 0,
      },
      {
        stdout: '@media print{@import url("sub/g.css");}',
        log: ["warn: invalid @ rule encountered: '@import'"],
        exitCode: 0,
      },
      {
        stdout: "@media (min-width: env(foo, url(sub/g.css))) {\n  .b {\n    color: red;\n  }\n}\n",
        log: [],
        exitCode: 0,
      },
      { stdout: "@media (min-width:env(foo,url(sub/g.css))){.b{color:red}}", log: [], exitCode: 0 },
    ]);
  });

  // A token list in a CSS module is not a prelude: its url() is still an import.
  itBundled("css/URLInCSSModuleTokenListIsStillAnImport", {
    files: {
      "/entry.js": /* js */ `
        import styles from "./a.module.css";
        console.log(styles.a);
      `,
      "/a.module.css": `.a { --x: url(./a.txt); background: var(--x) url(./a.txt) }`,
      "/a.txt": `hello`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      const chunks = readdirSync(api.outdir).filter(name => name.endsWith(".css"));
      expect(chunks).toHaveLength(1);
      expect(api.readFile("/out/" + chunks[0]).match(/url\([^)]*\)/g)).toEqual([
        'url("data:text/plain;base64,aGVsbG8=")',
        'url("data:text/plain;base64,aGVsbG8=")',
      ]);
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
