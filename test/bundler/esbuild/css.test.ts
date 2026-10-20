import { describe, expect } from "bun:test";
import { join } from "node:path";
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

  // A later copy of an external "@import" masks an earlier one, but the earlier
  // one can still be the rule that puts its layer first in the layer order.
  // Only "@charset" and "@layer" statements are valid ahead of an "@import", so
  // a layer rule cannot stand for the earlier import inside the import block.
  const externalImportDuplicates: Record<string, { files: Record<string, string>; out: string }> = {
    // The import right after the masked one declares layer "a" wherever the masked one does.
    CoveredByNextImport: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/a.css" layer(a) print;
          @import "https://example.com/a.css" layer(a);
        `,
      },
      out: `@import "https://example.com/a.css" layer(a);`,
    },
    NestedInDuplicateFile: {
      files: {
        "/entry.css": /* css */ `
          @import "./sub/a.css" layer(theme) print;
          @import "./sub/a.css" layer(theme) print;
          .c0 { color: blue }
        `,
        "/sub/a.css": /* css */ `
          @import "https://example.com/fonts.css" screen;
          .c0 { color: red }
        `,
      },
      out: String.raw`@import "data:text/css,@import \"https://example.com/fonts.css\" screen;" layer(theme) print;@media print{@layer theme{.c0{color:red}}}.c0{color:#00f}`,
    },
    // In print, layer "a" comes before layer "b". Only the masked import says so.
    Media: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/a.css" layer(a) print;
          @import "https://example.com/b.css" layer(b);
          @import "https://example.com/a.css" layer(a) print;
        `,
      },
      out: `@import "https://example.com/a.css" layer(a) print;@import "https://example.com/b.css" layer(b);@import "https://example.com/a.css" layer(a) print;`,
    },
    Supports: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/a.css" layer(a) supports(display: grid);
          @import "https://example.com/b.css" layer(b);
          @import "https://example.com/a.css" layer(a) supports(display: grid);
        `,
      },
      out: `@import "https://example.com/a.css" layer(a) supports(display:grid);@import "https://example.com/b.css" layer(b);@import "https://example.com/a.css" layer(a) supports(display:grid);`,
    },
    NestedLayers: {
      files: {
        "/entry.css": /* css */ `
          @import "./a.css" layer(outer);
          @import "https://example.com/b.css";
          @import "./a.css" layer(outer);
        `,
        "/a.css": /* css */ `@import "https://example.com/f.css" layer(inner);`,
      },
      out: String.raw`@import "data:text/css,@import \"https://example.com/f.css\" layer(inner);" layer(outer);@import "https://example.com/b.css";@import "data:text/css,@import \"https://example.com/f.css\" layer(inner);" layer(outer);@layer outer;`,
    },
    // An "@layer" statement is not valid between two "@import" rules. The first import has a layer of its own.
    AfterOtherImport: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/first.css" layer(first);
          @import "https://example.com/a.css" layer(a);
          @import "https://example.com/b.css" layer(b);
          @import "https://example.com/a.css" layer(a);
        `,
      },
      out: `@import "https://example.com/first.css" layer(first);@import "https://example.com/a.css" layer(a);@import "https://example.com/b.css" layer(b);@import "https://example.com/a.css" layer(a);`,
    },
    NestedLayerThenFlat: {
      files: {
        "/entry.css": /* css */ `
          @import "./a.css" layer(outer);
          @import "https://example.com/f.css" layer(outer);
        `,
        "/a.css": /* css */ `@import "https://example.com/f.css" layer(inner);`,
      },
      out: String.raw`@import "data:text/css,@import \"https://example.com/f.css\" layer(inner);" layer(outer);@import "https://example.com/f.css" layer(outer);@layer outer;`,
    },
    // The masked import keeps "screen", a condition that declares no layer.
    KeepsTrailingCondition: {
      files: {
        "/entry.css": /* css */ `
          @import "./a.css" layer(theme) print;
          @import "https://example.com/b.css" layer(b);
          @import "./a.css" layer(theme) print;
        `,
        "/a.css": /* css */ `@import "https://example.com/fonts.css" screen;`,
      },
      out: String.raw`@import "data:text/css,@import \"https://example.com/fonts.css\" screen;" layer(theme) print;@import "https://example.com/b.css" layer(b);@import "data:text/css,@import \"https://example.com/fonts.css\" screen;" layer(theme) print;@media print{@layer theme;}`,
    },
    // An "@layer" statement is valid ahead of the first "@import".
    LeadingLayerStatement: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/a.css" layer(a);
          @import "https://example.com/b.css" layer(b);
          @import "https://example.com/a.css" layer(a);
        `,
      },
      out: `@layer a;@import "https://example.com/b.css" layer(b);@import "https://example.com/a.css" layer(a);`,
    },
    // The leading statement also stands for the second masked import.
    LeadingLayerStatementTwice: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/a.css" layer(a);
          @import "./sub.css" layer(a);
          @import "https://example.com/a.css" layer(a);
          @import "https://example.com/b.css" layer(b);
          @import "https://example.com/a.css" layer(a);
        `,
        "/sub.css": /* css */ `@import "https://example.com/c.css" screen;`,
      },
      out: String.raw`@layer a;@import "data:text/css,@import \"https://example.com/c.css\" screen;" layer(a);@import "https://example.com/b.css" layer(b);@import "https://example.com/a.css" layer(a);@layer a;`,
    },
    Adjacent: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/a.css" layer(a) print;
          @import "https://example.com/a.css" layer(a) print;
        `,
      },
      out: `@import "https://example.com/a.css" layer(a) print;`,
    },
    AdjacentOtherImport: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/x.css" layer(a) print;
          @import "https://example.com/y.css" layer(a) print;
          @import "https://example.com/x.css" layer(a) print;
        `,
      },
      out: `@import "https://example.com/y.css" layer(a) print;@import "https://example.com/x.css" layer(a) print;`,
    },
    // The first masked import is an "@import" again, so "@layer c;" is not valid after it.
    StatementAfterRestoredImport: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/x.css" layer(a) print;
          @import "https://example.com/c.css" layer(c);
          @import "https://example.com/y.css" layer(b);
          @import "https://example.com/x.css" layer(a) print;
          @import "https://example.com/c.css" layer(c);
        `,
      },
      out: `@import "https://example.com/x.css" layer(a) print;@import "https://example.com/c.css" layer(c);@import "https://example.com/y.css" layer(b);@import "https://example.com/x.css" layer(a) print;@import "https://example.com/c.css" layer(c);`,
    },
    // Each masked copy is covered by the one after it. The last one is a valid leading statement.
    EachCoveredByNext: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/x.css" layer(a) supports(display: grid) print;
          @import "https://example.com/x.css" layer(a) print;
          @import "https://example.com/x.css" layer(a);
          @import "https://example.com/x.css";
        `,
      },
      out: `@layer a;@import "https://example.com/x.css";`,
    },
    // "print" is not covered by "screen", so the first copy stays. The second copy is covered by the third.
    TwoMaskedCopies: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/x.css" layer(a) print;
          @import "https://example.com/x.css" layer(a) screen;
          @import "https://example.com/x.css" layer(a);
        `,
      },
      out: `@import "https://example.com/x.css" layer(a) print;@import "https://example.com/x.css" layer(a);`,
    },
    TwoMaskedLayers: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/x.css" layer(a) print;
          @import "https://example.com/x.css" layer(b);
          @import "https://example.com/x.css";
        `,
      },
      out: `@import "https://example.com/x.css" layer(a) print;@import "https://example.com/x.css" layer(b);@import "https://example.com/x.css";`,
    },
    // Only layer "a" matters for the layer order, but the import keeps its anonymous layer.
    NamedThenAnonymousLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/first.css" layer(first);
          @import "./a.css" layer(a);
          @import "https://example.com/b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/a.css": /* css */ `@import "https://example.com/x.css" layer;`,
      },
      out: String.raw`@import "https://example.com/first.css" layer(first);@import "data:text/css,@import \"https://example.com/x.css\" layer;" layer(a);@import "https://example.com/b.css" layer(b);@import "data:text/css,@import \"https://example.com/x.css\" layer;" layer(a);@layer a;`,
    },
    // The masked import of "t2.css" declares "x.y" where the first import of "t1.css" declares "x", so each URL prints once.
    LayeredInsideDuplicateLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/t1.css" layer(x);
          @import "./one.css" layer(x);
          @import "https://example.com/t1.css" layer(x);
          @import "./two.css" layer(x);
        `,
        "/one.css": /* css */ `
          @import "https://example.com/t2.css" layer(y);
          .one { color: red }
        `,
        "/two.css": /* css */ `
          @import "https://example.com/t2.css" layer(y);
          .two { color: red }
        `,
      },
      out: String.raw`@import "https://example.com/t1.css" layer(x);@import "data:text/css,@import \"https://example.com/t2.css\" layer(y);" layer(x);@layer x{.one{color:red}}@layer x{.two{color:red}}`,
    },
    // Limit: the source declares layer "a" first. The import with no conditions covers the masked one.
    LayeredAfterPlainImport: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/first.css";
          @import "https://example.com/a.css" layer(a);
          @import "https://example.com/b.css" layer(b);
          @import "https://example.com/a.css" layer(a);
        `,
      },
      out: `@import "https://example.com/first.css";@import "https://example.com/b.css" layer(b);@import "https://example.com/a.css" layer(a);`,
    },
  };

  // The CSS parser rejects an "@import" that comes after any other rule.
  async function expectValidImports(file: string) {
    const again = await Bun.build({ entrypoints: [file], throw: false });
    expect(again.logs.map(log => log.message)).toEqual([]);
    expect(again.success).toBe(true);
  }

  for (const [name, { files, out }] of Object.entries(externalImportDuplicates)) {
    itBundled(`css/CSSAtImportExternalDuplicate${name}`, {
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      async onAfterBundle(api) {
        api.expectFile("/out.css").toBe(out + "\n");
        await expectValidImports(api.outfile);
      },
    });
  }

  itBundled("css/CSSAtImportExternalDuplicateCLI", {
    files: externalImportDuplicates.NestedInDuplicateFile.files,
    outfile: "/out.css",
    minifyWhitespace: true,
    backend: "cli",
    async onAfterBundle(api) {
      api.expectFile("/out.css").toBe(externalImportDuplicates.NestedInDuplicateFile.out + "\n");
      await expectValidImports(api.outfile);
    },
  });

  // The two stylesheets of one JS entry share an import block.
  itBundled("css/CSSAtImportExternalDuplicateFromJS", {
    files: {
      "/entry.js": /* js */ `
        import "./one.css";
        import "./two.css";
      `,
      "/one.css": /* css */ `
        @import "https://example.com/a.css" layer(a) print;
        .one { color: red }
      `,
      "/two.css": /* css */ `
        @import "https://example.com/b.css" layer(b);
        @import "https://example.com/a.css" layer(a) print;
        .two { color: red }
      `,
    },
    outdir: "/out",
    minifyWhitespace: true,
    async onAfterBundle(api) {
      api
        .expectFile("/out/entry.css")
        .toBe(
          `@import "https://example.com/a.css" layer(a) print;@import "https://example.com/b.css" layer(b);@import "https://example.com/a.css" layer(a) print;.one{color:red}.two{color:red}\n`,
        );
      await expectValidImports(api.join("out/entry.css"));
    },
  });

  // A cascade layer gets its priority where its name first appears. Two places in
  // the source can be first and need care in a bundle: an "@layer" statement ahead
  // of the "@import" rules of a file, and the earlier copy of a duplicate "@import".
  // Where a case has a green rule, that rule wins in the source.
  // `layers` is the order in which the bundle first declares its named layers. It is the
  // order of the source, except in `layerOrderLimits`.
  type LayerOrderCase = { files: Record<string, string>; out: string; layers?: string };

  // The named cascade layers of a bundle in the order of their first declaration. Each condition counts as true.
  function layerOrderOf(css: string, parent = "", order: string[] = []): string[] {
    const declare = (name: string) => {
      const parts = (parent ? parent + "." : "") + name.trim();
      for (let end = parts.indexOf("."); ; end = parts.indexOf(".", end + 1)) {
        const path = end < 0 ? parts : parts.slice(0, end);
        if (!order.includes(path)) order.push(path);
        if (end < 0) return parts;
      }
    };
    const string = /"(?:[^"\\]|\\.)*"/y;
    for (let i = 0; i < css.length;) {
      const start = i;
      while (i < css.length && css[i] !== ";" && css[i] !== "{") {
        string.lastIndex = i;
        i += string.exec(css)?.[0].length ?? 1;
      }
      const prelude = css.slice(start, i).trim();
      let block: string | undefined;
      if (css[i++] === "{") {
        const open = i;
        for (let depth = 1; depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
        block = css.slice(open, i - 1);
      }
      const layer = /^@layer\b(.*)$/s.exec(prelude)?.[1].trim();
      if (prelude.startsWith("@import")) {
        const [, url, conditions] = /^@import\s*("(?:[^"\\]|\\.)*")(.*)$/s.exec(prelude)!;
        if (/\blayer\b(?!\()/.test(conditions)) continue;
        const named = /\blayer\(([^)]*)\)/.exec(conditions)?.[1];
        const inner = named === undefined ? parent : declare(named);
        const text: string = JSON.parse(url);
        if (text.startsWith("data:text/css,")) layerOrderOf(text.slice(14), inner, order);
      } else if (layer !== undefined && block === undefined) {
        layer.split(",").forEach(declare);
      } else if (layer) {
        layerOrderOf(block!, declare(layer), order);
      } else if (layer === undefined && block !== undefined && /^@(media|supports)\b/.test(prelude)) {
        layerOrderOf(block, parent, order);
      }
    }
    return order;
  }

  const designSystem = {
    "/sys/index.css": /* css */ `
      @layer theme, base, components, utilities;
      @import "./theme.css" layer(theme);
      @import "./utilities.css" layer(utilities);
    `,
    "/sys/theme.css": /* css */ `:root { --x: 1 }`,
    "/sys/utilities.css": /* css */ `.box { color: green }`,
    "/one.css": /* css */ `
      @import "./sys/index.css";
      @layer components { .box { color: red } }
    `,
    "/two.css": /* css */ `
      @import "./sys/index.css";
      @layer components { .two { color: red } }
    `,
  };

  // Wrong before: the bundle gave two layers of the source another order, or a rule of another copy won.
  const layerOrderCases: Record<string, LayerOrderCase> = {
    // Source layer order: a, b. "reset.css" declares no layer.
    AfterPlainFile: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/a.css": /* css */ `.box { color: red }`,
        "/b.css": /* css */ `.box { color: green }`,
      },
      out: `*{margin:0}@layer a;@layer b{.box{color:green}}@layer a{.box{color:red}}`,
      layers: "a, b",
    },
    // Source layer order: tokens, components.
    InTwoImportedFiles: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./one.css";
          @import "./two.css";
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/one.css": /* css */ `
          @import "./tokens.css" layer(tokens);
          @layer components { .box { color: green } }
        `,
        "/two.css": /* css */ `
          @import "./tokens.css" layer(tokens);
          @layer components { .two { color: green } }
        `,
        "/tokens.css": /* css */ `.box { color: red }`,
      },
      out: `*{margin:0}@layer tokens;@layer components{.box{color:green}}@layer tokens{.box{color:red}}@layer components{.two{color:green}}`,
      layers: "tokens, components",
    },
    AfterPlainExternalImport: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/first.css";
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/a.css": /* css */ `.box { color: red }`,
        "/b.css": /* css */ `.box { color: green }`,
      },
      out: `@import "https://example.com/first.css";@layer a;@layer b{.box{color:green}}@layer a{.box{color:red}}`,
      layers: "a, b",
    },
    // Source layer order in "outer": inner, other. "x.css" declares "outer" only.
    Sublayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./x.css" layer(outer);
          @import "./one.css" layer(outer);
          @import "./two.css" layer(outer);
        `,
        "/x.css": /* css */ `.x { color: red }`,
        "/one.css": /* css */ `
          @import "./tokens.css" layer(inner);
          @layer other { .box { color: green } }
        `,
        "/two.css": /* css */ `
          @import "./tokens.css" layer(inner);
          @layer other { .two { color: green } }
        `,
        "/tokens.css": /* css */ `.box { color: red }`,
      },
      out: `@layer outer{.x{color:red}}@layer outer{@layer inner;}@layer outer{@layer other{.box{color:green}}}@layer outer{@layer inner{.box{color:red}}}@layer outer{@layer other{.two{color:green}}}`,
      layers: "outer, outer.inner, outer.other",
    },
    AfterFileWithSameMedia: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css" screen;
          @import "./one.css" screen;
          @import "./two.css" screen;
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/one.css": /* css */ `
          @import "./tokens.css" layer(tokens);
          @layer components { .box { color: green } }
        `,
        "/two.css": /* css */ `
          @import "./tokens.css" layer(tokens);
          @layer components { .two { color: green } }
        `,
        "/tokens.css": /* css */ `.box { color: red }`,
      },
      out: `@media screen{*{margin:0}}@media screen{@layer tokens;}@media screen{@layer components{.box{color:green}}}@media screen{@layer tokens{.box{color:red}}}@media screen{@layer components{.two{color:green}}}`,
      layers: "tokens, components",
    },
    // Source layer order: x, a, a.x, b. "reset.css" declares "x", not "a.x".
    AfterFileWithSameLayerRules: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/reset.css": /* css */ `@layer x { * { margin: 0 } }`,
        "/a.css": /* css */ `@layer x { .box { color: red } }`,
        "/b.css": /* css */ `.box { color: green }`,
      },
      out: `@layer x{*{margin:0}}@layer a{@layer x;}@layer b{.box{color:green}}@layer a{@layer x{.box{color:red}}}`,
      layers: "x, a, a.x, b",
    },
    // "b.css" declares layer "b" ahead of the earlier copy of "d.css", so that copy prints nothing.
    CoveredByFileWithSameLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./d.css" layer(b);
          @import "./a.css" layer(a);
          @import "./d.css" layer(b);
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/a.css": /* css */ `.box { color: red }`,
        "/b.css": /* css */ `.box { color: green }`,
        "/d.css": /* css */ `.d { color: blue }`,
      },
      out: `*{margin:0}@layer a;@layer b{.box{color:green}}@layer a{.box{color:red}}@layer b{.d{color:#00f}}`,
      layers: "a, b",
    },
    // "e.css" declares layer "x" with no condition, so the earlier copy of "g.css" prints nothing.
    CoveredByShorterEntryWithoutLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
          @import "./e.css";
          @import "./g.css" screen;
          @import "./z.css";
          @import "./g.css" screen;
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/a.css": /* css */ `.box { color: red }`,
        "/b.css": /* css */ `.box { color: green }`,
        "/e.css": /* css */ `@layer x { .e { color: red } }`,
        "/g.css": /* css */ `@layer x { .g { color: red } }`,
        "/z.css": /* css */ `.z { color: red }`,
      },
      out: `*{margin:0}@layer a;@layer b{.box{color:green}}@layer a{.box{color:red}}@layer x{.e{color:red}}.z{color:red}@media screen{@layer x{.g{color:red}}}`,
      layers: "a, b, x",
    },
    // The "layer(a)" of the earlier copy of "tokens.css" is between two media conditions.
    LayerBetweenMediaImports: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./outer1.css" screen;
          @import "./outer2.css" screen;
        `,
        "/reset.css": /* css */ `@layer x { * { margin: 0 } }`,
        "/outer1.css": /* css */ `@import "./one.css" layer(a);`,
        "/outer2.css": /* css */ `@import "./two.css" layer(a);`,
        "/one.css": /* css */ `
          @import "./tokens.css" (min-width: 1px);
          @layer y { .box { color: green } }
        `,
        "/two.css": /* css */ `
          @import "./tokens.css" (min-width: 1px);
          @layer y { .two { color: green } }
        `,
        "/tokens.css": /* css */ `@layer x { .box { color: red } }`,
      },
      out: `@layer x{*{margin:0}}@media screen{@layer a{@media (min-width:1px){@layer x;}}}@media screen{@layer a{@layer y{.box{color:green}}}}@media screen{@layer a{@media (min-width:1px){@layer x{.box{color:red}}}}}@media screen{@layer a{@layer y{.two{color:green}}}}`,
      layers: "x, a, a.x, a.y",
    },
    // Source layer order: first, second.
    StatementBeforeImport: {
      files: {
        "/entry.css": /* css */ `
          @layer first;
          @import "./imported.css" layer(second);
          @layer first { .box { color: red } }
        `,
        "/imported.css": /* css */ `.box { color: green }`,
      },
      out: `@layer first;@layer second{.box{color:green}}@layer first{.box{color:red}}`,
      layers: "first, second",
    },
    // Source layer order: default, theme, components.
    StatementImportStatement: {
      files: {
        "/entry.css": /* css */ `
          @layer default;
          @import "./theme.css" layer(theme);
          @layer components;
          @layer default { .box { color: red } }
        `,
        "/theme.css": /* css */ `.box { color: green }`,
      },
      out: `@layer default;@layer theme{.box{color:green}}@layer components;@layer default{.box{color:red}}`,
      layers: "default, theme, components",
    },
    // Source layer order: theme, base, components.
    SeparateStatements: {
      files: {
        "/entry.css": /* css */ `
          @layer theme;
          @layer base;
          @layer components;
          @import "./x.css" layer(base);
          @layer theme { .box { color: red } }
        `,
        "/x.css": /* css */ `.box { color: green }`,
      },
      out: `@layer theme,base,components;@layer base{.box{color:green}}@layer theme{.box{color:red}}`,
      layers: "theme, base, components",
    },
    // A statement is valid ahead of an "@import". Source layer order: a, b.
    StatementBeforeExternalImport: {
      files: {
        "/entry.css": /* css */ `
          @layer a, b;
          @import "https://example.com/e.css" layer(b);
          @layer a { .x { color: red } }
        `,
      },
      out: `@layer a,b;@import "https://example.com/e.css" layer(b);@layer a{.x{color:red}}`,
      layers: "a, b",
    },
    StatementBeforeExternalImportInImportedFile: {
      files: {
        "/entry.css": /* css */ `
          @import "./mid.css";
          .e { color: red }
        `,
        "/mid.css": /* css */ `
          @layer inner, other;
          @import "https://example.com/e.css" layer(other);
          .mid { color: red }
        `,
      },
      out: `@layer inner,other;@import "https://example.com/e.css" layer(other);.mid{color:red}.e{color:red}`,
      layers: "inner, other",
    },
    // Source layer order: outer, wrap, wrap.inner, wrap.leafy, wrap.after.
    StatementUnderSupports: {
      files: {
        "/entry.css": /* css */ `
          @layer outer;
          @import "./mid.css" layer(wrap) supports(display: flex);
        `,
        "/mid.css": /* css */ `
          @layer inner;
          @import "./leaf.css" layer(leafy);
          @layer after;
          .mid { color: red }
        `,
        "/leaf.css": /* css */ `.leaf { color: red }`,
      },
      out: `@layer outer;@supports (display:flex){@layer wrap{@layer inner;}}@supports (display:flex){@layer wrap{@layer leafy{.leaf{color:red}}}}@supports (display:flex){@layer wrap{@layer after;.mid{color:red}}}`,
      layers: "outer, wrap, wrap.inner, wrap.leafy, wrap.after",
    },
    // Source layer order: theme, base, components, utilities.
    DesignSystemOnce: {
      files: {
        "/entry.css": /* css */ `
          @import "./sys/index.css";
          @layer components { .box { color: red } }
        `,
        "/sys/index.css": designSystem["/sys/index.css"],
        "/sys/theme.css": designSystem["/sys/theme.css"],
        "/sys/utilities.css": designSystem["/sys/utilities.css"],
      },
      out: `@layer theme,base,components,utilities;@layer theme{:root{--x:1}}@layer utilities{.box{color:green}}@layer components{.box{color:red}}`,
      layers: "theme, base, components, utilities",
    },
    DesignSystemTwice: {
      files: {
        "/entry.css": /* css */ `
          @import "./one.css";
          @import "./two.css";
        `,
        ...designSystem,
      },
      out: `@layer theme,base,components,utilities;@layer theme;@layer utilities;@layer components{.box{color:red}}@layer theme{:root{--x:1}}@layer utilities{.box{color:green}}@layer components{.two{color:red}}`,
      layers: "theme, base, components, utilities",
    },
    // Without print media "g.css" declares "b" only. Source layer order: a, b.
    FirstImportHasSameLayerNames: {
      files: {
        "/entry.css": /* css */ `
          @layer a, b;
          @import "./g.css";
          @layer b { .x { color: green } }
          @layer a { .x { color: red } }
        `,
        "/g.css": /* css */ `
          @media print { @layer a { .p { color: blue } } }
          @layer b { .q { color: blue } }
        `,
      },
      out: `@layer a,b;@media print{@layer a{.p{color:#00f}}}@layer b{.q{color:#00f}}@layer b{.x{color:green}}@layer a{.x{color:red}}`,
      layers: "a, b",
    },
    // Source layer order: e, m, l, x.
    StatementsOfThreeFilesBeforeExternalImport: {
      files: {
        "/entry.css": /* css */ `
          @layer e;
          @import "./mid.css";
        `,
        "/mid.css": /* css */ `
          @layer m;
          @import "./leaf.css";
        `,
        "/leaf.css": /* css */ `
          @layer l;
          @import "https://example.com/x.css" layer(x);
          .leaf { color: red }
        `,
      },
      out: `@layer e;@layer m;@layer l;@import "https://example.com/x.css" layer(x);.leaf{color:red}`,
      layers: "e, m, l, x",
    },
    // "a.css" and "b.css" import each other. Source layer order: x, y.
    StatementBeforeImportInCycle: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./a.css";
          @import "./b.css";
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/a.css": /* css */ `
          @layer x, y;
          @import "./b.css";
          @layer y { .box { color: green } }
        `,
        "/b.css": /* css */ `
          @layer y, x;
          @import "./a.css";
          @layer x { .box { color: red } }
        `,
      },
      out: `*{margin:0}@layer x,y;@layer y,x;@layer x;@layer y{.box{color:green}}@layer x{.box{color:red}}`,
      layers: "x, y",
    },
    // "a.css" and "b.css" import each other. Source layer order: y, x.
    LayeredImportsInCycle: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./b.css";
          @import "./c.css";
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/a.css": /* css */ `
          @import "./x.css" layer(x);
          @import "./b.css";
        `,
        "/b.css": /* css */ `
          @import "./y.css" layer(y);
          @import "./a.css";
        `,
        "/c.css": /* css */ `@import "./a.css";`,
        "/x.css": /* css */ `.box { color: green }`,
        "/y.css": /* css */ `.box { color: red }`,
      },
      out: `*{margin:0}@layer y;@layer x{.box{color:green}}@layer y{.box{color:red}}`,
      layers: "y, x",
    },
    // Without print media "g.css" declares no layer, and it prints in place of the marker of "f.css". Source layer order: a, b.
    MarkerDoesNotStandForStatement: {
      files: {
        "/entry.css": /* css */ `
          @import "./f.css";
          @import "./h.css";
          @import "./f.css";
        `,
        "/f.css": /* css */ `
          @layer a { .x { color: red } }
          @layer b { .y { color: red } }
        `,
        "/h.css": /* css */ `
          @layer a, b;
          @import "./g.css";
          @import "./x.css" layer(b);
          @layer a { .box { color: red } }
        `,
        "/g.css": /* css */ `
          @media print { @layer a { .p { color: blue } } @layer b { .q { color: blue } } }
          .g { color: blue }
        `,
        "/x.css": /* css */ `.box { color: green }`,
      },
      out: `@layer a,b;@layer a,b;@media print{@layer a{.p{color:#00f}}@layer b{.q{color:#00f}}}.g{color:#00f}@layer b{.box{color:green}}@layer a{.box{color:red}}@layer a{.x{color:red}}@layer b{.y{color:red}}`,
      layers: "a, b",
    },
    // Source layer order: components, mid, vendor. The rule of the copy in "vendor" wins.
    LayeredCopyWinsAfterFileWithSameLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./base.css";
          @import "./lib.css" layer(vendor);
          @import "./lib.css";
        `,
        "/base.css": /* css */ `
          @layer components { .c { color: blue } }
          @layer mid { .box { color: red } }
        `,
        "/lib.css": /* css */ `@layer components { .box { color: green } }`,
      },
      out: `@layer components{.c{color:#00f}}@layer mid{.box{color:red}}@layer vendor{@layer components{.box{color:green}}}@layer components{.box{color:green}}`,
      layers: "components, mid, vendor, vendor.components",
    },
    // Source layer order: components, mid, vendor. The rule of the copy in "vendor" wins.
    LayeredCopyWinsAfterImportIntoSameLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./x.css" layer(components);
          @import "./m.css" layer(mid);
          @import "./lib.css" layer(vendor);
          @import "./lib.css";
        `,
        "/x.css": /* css */ `.x { color: blue }`,
        "/m.css": /* css */ `.box { color: red }`,
        "/lib.css": /* css */ `@layer components { .box { color: green } }`,
      },
      out: `@layer components{.x{color:#00f}}@layer mid{.box{color:red}}@layer vendor{@layer components{.box{color:green}}}@layer components{.box{color:green}}`,
      layers: "components, mid, vendor, vendor.components",
    },
  };

  // The winning declarations of these bundles are the same as before. Each has a shape that
  // one part of the change alone turns wrong, or a statement that has to stay where it was.
  const layerOrderKeptCases: Record<string, LayerOrderCase> = {
    // Source layer order: b, a.
    OrderStatementThenDuplicate: {
      files: {
        "/entry.css": /* css */ `
          @layer b, a;
          @import "./reset.css";
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/a.css": /* css */ `.box { color: green }`,
        "/b.css": /* css */ `.box { color: red }`,
      },
      out: `@layer b,a;*{margin:0}@layer a;@layer b{.box{color:red}}@layer a{.box{color:green}}`,
      layers: "b, a",
    },
    // Source layer order: theme, base, components, utilities.
    DesignSystemTwiceAfterPlainFile: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./one.css";
          @import "./two.css";
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        ...designSystem,
      },
      out: `*{margin:0}@layer theme,base,components,utilities;@layer theme;@layer utilities;@layer components{.box{color:red}}@layer theme{:root{--x:1}}@layer utilities{.box{color:green}}@layer components{.two{color:red}}`,
      layers: "theme, base, components, utilities",
    },
    // "lib.css" has no "@import", so its statement stays in its body.
    StatementInFileWithoutImport: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css";
          @import "./lib.css" layer(wrap);
          @import "./late.css" layer(wrap);
        `,
        "/lib.css": /* css */ `
          @layer a, b;
          .lib { color: blue }
        `,
        "/late.css": /* css */ `
          @layer b { .box { color: green } }
          @layer a { .box { color: red } }
        `,
      },
      out: `@layer a,b;.lib{color:#00f}@layer wrap{@layer a,b;.lib{color:#00f}}@layer wrap{@layer b{.box{color:green}}@layer a{.box{color:red}}}`,
      layers: "a, b, wrap, wrap.a, wrap.b",
    },
    // Source layer order in "wrap": a, b.
    StatementUnderNamedLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css";
          @import "./lib.css" layer(wrap);
          @import "./late.css" layer(wrap);
        `,
        "/lib.css": /* css */ `
          @layer a, b;
          @import "./dep.css";
          .lib { color: blue }
        `,
        "/dep.css": /* css */ `.dep { color: blue }`,
        "/late.css": /* css */ `
          @layer b { .box { color: green } }
          @layer a { .box { color: red } }
        `,
      },
      out: `@layer a,b;.dep{color:#00f}.lib{color:#00f}@layer wrap{@layer a,b;}@layer wrap{.dep{color:#00f}}@layer wrap{.lib{color:#00f}}@layer wrap{@layer b{.box{color:green}}@layer a{.box{color:red}}}`,
      layers: "a, b, wrap, wrap.a, wrap.b",
    },
    // No layer list prints below an anonymous layer, so the statement stays in the body.
    StatementUnderAnonymousLayer: {
      files: {
        "/entry.css": /* css */ `@import "./lib.css" layer;`,
        "/lib.css": /* css */ `
          @layer p, q;
          @import "./dep.css";
          @layer q { .box { color: green } }
          @layer p { .box { color: red } }
        `,
        "/dep.css": /* css */ `.dep { color: blue }`,
      },
      out: `@layer{.dep{color:#00f}}@layer{@layer p,q;@layer q{.box{color:green}}@layer p{.box{color:red}}}`,
    },
    // "@layer wrap{@layer inner;}" is a block, so it is not valid ahead of the "@import".
    StatementBeforeExternalImportUnderNamedLayer: {
      files: {
        "/entry.css": /* css */ `@import "./mid.css" layer(wrap);`,
        "/mid.css": /* css */ `
          @layer inner;
          @import "https://example.com/e.css";
          .mid { color: red }
        `,
      },
      out: `@import "https://example.com/e.css" layer(wrap);@layer wrap{@layer inner;}@layer wrap{.mid{color:red}}`,
      layers: "wrap, wrap.inner",
    },
    // "a.css" has no "@import", so the statement stays in both copies.
    DuplicateOfFileWithStatementOnly: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/a.css": /* css */ `
          @layer x, y;
          .box { color: red }
        `,
        "/b.css": /* css */ `.box { color: green }`,
      },
      out: `*{margin:0}@layer a{@layer x,y;}@layer b{.box{color:green}}@layer a{@layer x,y;.box{color:red}}`,
      layers: "a, a.x, a.y, b",
    },
    // Source layer order: a, b.
    DuplicateOfFileWithStatementAndImport: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css";
          @import "./mid.css";
          @import "./lib.css";
        `,
        "/lib.css": /* css */ `
          @layer a, b;
          @import "./dep.css";
          .lib { color: blue }
        `,
        "/dep.css": /* css */ `.dep { color: blue }`,
        "/mid.css": /* css */ `
          @layer b { .x { color: green } }
          @layer a { .x { color: red } }
        `,
      },
      out: `@layer a,b;@layer b{.x{color:green}}@layer a{.x{color:red}}.dep{color:#00f}.lib{color:#00f}`,
      layers: "a, b",
    },
    // Source layer order: utilities, components, vendor. The rules of the copy in "vendor" win.
    LayeredThenBareCopyOfFileWithLayers: {
      files: {
        "/entry.css": /* css */ `
          @layer utilities, components;
          @import "./lib.css" layer(vendor);
          @import "./lib.css";
        `,
        "/lib.css": /* css */ `
          @layer components { .box { color: red } }
          @layer utilities { .box { color: green } }
        `,
      },
      out: `@layer utilities,components;@layer vendor{@layer components{.box{color:red}}@layer utilities{.box{color:green}}}@layer components{.box{color:red}}@layer utilities{.box{color:green}}`,
      layers: "utilities, components, vendor, vendor.components, vendor.utilities",
    },
    // Source layer order in "vendor": base, components, utilities.
    DuplicateInsideLayerAfterOrderStatement: {
      files: {
        "/entry.css": /* css */ `
          @layer base, components, utilities;
          @import "./a.css" layer(vendor);
          @import "./b.css" layer(vendor);
        `,
        "/a.css": /* css */ `
          @import "./core.css";
          @layer utilities { .box { color: green } }
        `,
        "/b.css": /* css */ `
          @import "./core.css";
          @layer components { .card { padding: 0 } }
        `,
        "/core.css": /* css */ `
          @layer base { * { margin: 0 } }
          @layer components { .box { color: red } }
          @layer utilities { .u { padding: 0 } }
        `,
      },
      out: `@layer base,components,utilities;@layer vendor{@layer base,components,utilities;}@layer vendor{@layer utilities{.box{color:green}}}@layer vendor{@layer base{*{margin:0}}@layer components{.box{color:red}}@layer utilities{.u{padding:0}}}@layer vendor{@layer components{.card{padding:0}}}`,
      layers: "base, components, utilities, vendor, vendor.base, vendor.components, vendor.utilities",
    },
    // Without print media "g.css" declares no layer. Source layer order: b, a.
    FileWithSameNamesUnderMedia: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./reset.css";
          @import "./f.css";
        `,
        "/g.css": /* css */ `@media print { @layer b { .p { color: blue } } @layer a { .q { color: blue } } }`,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/f.css": /* css */ `
          @layer b, a;
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/a.css": /* css */ `.box { color: green }`,
        "/b.css": /* css */ `.box { color: red }`,
      },
      out: `@media print{@layer b{.p{color:#00f}}@layer a{.q{color:#00f}}}*{margin:0}@layer b,a;@layer a;@layer b{.box{color:red}}@layer a{.box{color:green}}`,
      layers: "b, a",
    },
    // Source layer order: a, b, c.
    DuplicateAfterFileWithSameNamesUnderMedia: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./f.css";
          @import "./x.css";
          @import "./f.css";
        `,
        "/g.css": /* css */ `@media print { @layer a { .p { color: blue } } @layer b { .q { color: blue } } }`,
        "/f.css": /* css */ `
          @layer a, b;
          @import "./dep.css";
          @layer c { .c { color: blue } }
        `,
        "/dep.css": /* css */ `.dep { color: blue }`,
        "/x.css": /* css */ `
          @layer b { .x { color: green } }
          @layer a { .x { color: red } }
        `,
      },
      out: `@media print{@layer a{.p{color:#00f}}@layer b{.q{color:#00f}}}@layer a,b;@layer c;@layer b{.x{color:green}}@layer a{.x{color:red}}.dep{color:#00f}@layer c{.c{color:#00f}}`,
      layers: "a, b, c",
    },
    // Minify removes the empty blocks of "g.css". Source layer order: a, b.
    FirstImportHasSameNamesInEmptyBlocks: {
      files: {
        "/entry.css": /* css */ `
          @layer a, b;
          @import "./g.css";
          @layer b { .x { color: green } }
          @layer a { .x { color: red } }
        `,
        "/g.css": /* css */ `
          @layer a {}
          @layer b {}
          .g { color: blue }
        `,
      },
      out: `@layer a,b;.g{color:#00f}@layer b{.x{color:green}}@layer a{.x{color:red}}`,
      layers: "a, b",
    },
    // Source layer order: a, b.
    AfterFileWithSameNamesUnderMedia: {
      files: {
        "/entry.css": /* css */ `
          @import "./g.css";
          @import "./f.css";
        `,
        "/g.css": /* css */ `@media print { @layer a { .p { color: blue } } @layer b { .q { color: blue } } }`,
        "/f.css": /* css */ `
          @layer a, b;
          @import "./h.css";
          @layer b { .x { color: green } }
          @layer a { .x { color: red } }
        `,
        "/h.css": /* css */ `.h { color: blue }`,
      },
      out: `@media print{@layer a{.p{color:#00f}}@layer b{.q{color:#00f}}}@layer a,b;.h{color:#00f}@layer b{.x{color:green}}@layer a{.x{color:red}}`,
      layers: "a, b",
    },
    // The marker of "f.css" and the statement of "h.css" both print. Source layer order: a, b.
    MarkerBeforeFileWithSameNamesInEmptyBlocks: {
      files: {
        "/entry.css": /* css */ `
          @import "./f.css";
          @import "./h.css";
          @import "./f.css";
        `,
        "/f.css": /* css */ `
          @layer a { .x { color: red } }
          @layer b { .y { color: red } }
        `,
        "/h.css": /* css */ `
          @layer a, b;
          @import "./g.css";
          @layer b { .box { color: green } }
          @layer a { .box { color: red } }
        `,
        "/g.css": /* css */ `
          @layer a {}
          @layer b {}
          .g { color: blue }
        `,
      },
      out: `@layer a,b;@layer a,b;.g{color:#00f}@layer b{.box{color:green}}@layer a{.box{color:red}}@layer a{.x{color:red}}@layer b{.y{color:red}}`,
      layers: "a, b",
    },
    // "t.css" has no layer of its own, so one copy is enough.
    LayeredThenBareCopyOfFileWithoutLayers: {
      files: {
        "/entry.css": /* css */ `
          @layer x, y;
          @import "./t.css" layer(x);
          @import "./t.css";
          @layer y { .box { color: red } }
        `,
        "/t.css": /* css */ `.box { color: green }`,
      },
      out: `@layer x,y;@layer x;.box{color:green}@layer y{.box{color:red}}`,
      layers: "x, y",
    },
    // The import of "x.css" declares layer "a" ahead of the earlier copy of "a.css".
    CoveredByExternalImportWithSameLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "https://example.com/first.css";
          @import "https://example.com/x.css" layer(a);
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/a.css": /* css */ `.box { color: red }`,
        "/b.css": /* css */ `.box { color: green }`,
      },
      out: `@import "https://example.com/first.css";@import "https://example.com/x.css" layer(a);@layer b{.box{color:green}}@layer a{.box{color:red}}`,
      layers: "a, b",
    },
    // "c.css" declares layer "a" ahead of the earlier copy of "a.css".
    CoveredByFileWithSameLayerAfterPlainFile: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./c.css" layer(a);
          @import "./a.css" layer(a);
          @import "./b.css" layer(b);
          @import "./a.css" layer(a);
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/c.css": /* css */ `.c { color: red }`,
        "/a.css": /* css */ `.box { color: red }`,
        "/b.css": /* css */ `.box { color: green }`,
      },
      out: `*{margin:0}@layer a{.c{color:red}}@layer b{.box{color:green}}@layer a{.box{color:red}}`,
      layers: "a, b",
    },
    // No entry ahead of the copy in "vendor" declares a layer of "lib.css", so the later copy wins and one copy is enough.
    LayeredThenBareCopyWithNoLayerAhead: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css" layer(vendor);
          @import "./lib.css";
        `,
        "/lib.css": /* css */ `
          @layer components { .box { color: red } }
          @layer utilities { .box { color: green } }
        `,
      },
      out: `@layer vendor{@layer components,utilities;}@layer components{.box{color:red}}@layer utilities{.box{color:green}}`,
      layers: "vendor, vendor.components, vendor.utilities, components, utilities",
    },
    // Source layer order in "vendor": components, other, kit. The rule of the copy in "vendor.kit" wins.
    LessLayeredCopyAfterDottedOrderStatement: {
      files: {
        "/entry.css": /* css */ `
          @layer vendor.components, vendor.other;
          @import "./other.css" layer(vendor.other);
          @import "./wrap.css" layer(vendor);
          @import "./lib.css" layer(vendor);
        `,
        "/other.css": /* css */ `.box { color: red }`,
        "/wrap.css": /* css */ `@import "./lib.css" layer(kit);`,
        "/lib.css": /* css */ `@layer components { .box { color: green } }`,
      },
      out: `@layer vendor.components,vendor.other;@layer vendor.other{.box{color:red}}@layer vendor{@layer kit{@layer components{.box{color:green}}}}@layer vendor;@layer vendor{@layer components{.box{color:green}}}`,
      layers: "vendor, vendor.components, vendor.other, vendor.kit, vendor.kit.components",
    },
    // The statement names no layer of "lib.css", so the later copy wins and one copy is enough.
    LayeredThenBareCopyAfterStatementOfOtherLayers: {
      files: {
        "/entry.css": /* css */ `
          @layer reset, base;
          @import "./lib.css" layer(vendor);
          @import "./lib.css";
        `,
        "/lib.css": /* css */ `@layer components { .box { color: green } }`,
      },
      out: `@layer reset,base;@layer vendor{@layer components;}@layer components{.box{color:green}}`,
      layers: "reset, base, vendor, vendor.components, components",
    },
    // "x.css" declares "other.components", which is not the layer "components" of the later copy.
    LayeredThenBareCopyAfterSameLayerNameInOtherLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./x.css" layer(other);
          @import "./lib.css" layer(vendor);
          @import "./lib.css";
        `,
        "/x.css": /* css */ `@layer components { .box { color: red } }`,
        "/lib.css": /* css */ `@layer components { .box { color: green } }`,
      },
      out: `@layer other{@layer components{.box{color:red}}}@layer vendor{@layer components;}@layer components{.box{color:green}}`,
      layers: "other, other.components, vendor, vendor.components, components",
    },
    // The statement can name a layer of the external file, so both imports stay.
    LayeredThenBareExternalImportAfterOrderStatement: {
      files: {
        "/entry.css": /* css */ `
          @layer utilities, components;
          @import "https://example.com/lib.css" layer(vendor);
          @import "https://example.com/lib.css";
        `,
      },
      out: `@layer utilities,components;@import "https://example.com/lib.css" layer(vendor);@import "https://example.com/lib.css";`,
      layers: "utilities, components, vendor",
    },
    // Source layer order: o, t.
    StatementOfLaterFileStaysBehindEarlierFile: {
      files: {
        "/entry.css": /* css */ `
          @import "./one.css";
          @import "./two.css";
        `,
        "/one.css": /* css */ `@layer o { .box { color: red } }`,
        "/two.css": /* css */ `
          @layer t;
          @import "https://example.com/x.css";
          @layer t { .box { color: green } }
        `,
      },
      out: `@import "https://example.com/x.css";@layer o{.box{color:red}}@layer t;@layer t{.box{color:green}}`,
      layers: "o, t",
    },
    // Below "@import ... layer;" each file prints its own "@layer{}" block. "f1.css" is not alone there, so that copy stays masked.
    BareThenAnonymousThenBareCopy: {
      files: {
        "/entry.css": /* css */ `
          @import "./f1.css";
          @import "./f1.css" layer;
          @import "./f1.css";
        `,
        "/f1.css": /* css */ `
          @layer b;
          @import "./f2.css" layer(c);
          @layer b { .box { color: red } }
        `,
        "/f2.css": /* css */ `.box { color: green }`,
      },
      out: `@layer b;@layer c;@layer{@layer c{.box{color:green}}}@layer c{.box{color:green}}@layer b{.box{color:red}}`,
      layers: "b, c",
    },
    // Source layer order: a. The rule of "x.css" is in an anonymous layer behind it.
    FileSharedBelowAnonymousLayer: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css";
          @import "./mid.css" layer;
          @import "./lib.css";
        `,
        "/lib.css": /* css */ `@layer a { .box { color: red } }`,
        "/mid.css": /* css */ `
          @layer a, b;
          @import "./x.css";
          @import "./lib.css";
        `,
        "/x.css": /* css */ `@layer b { .box { color: green } }`,
      },
      out: `@layer a;@layer{@layer b{.box{color:green}}}@layer{@layer a,b;}@layer a{.box{color:red}}`,
      layers: "a",
    },
    // The copy below the anonymous layer keeps its statement in its body.
    BareThenAnonymousCopyOfFileWithStatement: {
      files: {
        "/entry.css": /* css */ `
          @import "./lib.css";
          @import "./lib.css" layer;
        `,
        "/lib.css": /* css */ `
          @layer p, q;
          @import "./dep.css";
          @layer q { .box { color: green } }
          @layer p { .box { color: red } }
        `,
        "/dep.css": /* css */ `.dep { color: blue }`,
      },
      out: `@layer p,q;.dep{color:#00f}@layer q{.box{color:green}}@layer p{.box{color:red}}@layer{.dep{color:#00f}}@layer{@layer p,q;@layer q{.box{color:green}}@layer p{.box{color:red}}}`,
      layers: "p, q",
    },
    // The copy below "@import ... layer;" is alone in that layer, so it prints in one "@layer{}" block. Its rule wins.
    AnonymousThenBareCopyAfterOrderStatement: {
      files: {
        "/entry.css": /* css */ `
          @layer utilities, components;
          @import "./lib.css" layer;
          @import "./lib.css";
        `,
        "/lib.css": /* css */ `
          @layer components { .box { color: red } }
          @layer utilities { .box { color: green } }
        `,
      },
      out: `@layer utilities,components;@layer{@layer components{.box{color:red}}@layer utilities{.box{color:green}}}@layer components{.box{color:red}}@layer utilities{.box{color:green}}`,
      layers: "utilities, components",
    },
    // "p.css" imports the entry under "layer(L)". A browser does not load that import, but it declares "L" there. Source layer order: L, M.
    LayeredImportCutByCycle: {
      files: {
        "/entry.css": /* css */ `
          @import "./reset.css";
          @import "./p.css";
          @import "./l.css" layer(L);
          @import "./m.css" layer(M);
        `,
        "/reset.css": /* css */ `* { margin: 0 }`,
        "/p.css": /* css */ `
          @import "./entry.css" layer(L);
          @import "./m.css" layer(M);
          .p { color: blue }
        `,
        "/l.css": /* css */ `.box { color: red }`,
        "/m.css": /* css */ `.box { color: green }`,
      },
      out: `*{margin:0}@layer L;@layer M;.p{color:#00f}@layer L{.box{color:red}}@layer M{.box{color:green}}`,
      layers: "L, M",
    },
  };

  // Limits. These bundles do not have the cascade of their source. Each comment names the cause,
  // and `layers` is the order that the bundle has.
  const layerOrderLimits: Record<string, LayerOrderCase> = {
    // External hoist. Source layer order: inner, other. The statement is a block below the media query, and the "@import" goes ahead of it.
    StatementBeforeExternalImportUnderMedia: {
      files: {
        "/entry.css": /* css */ `@import "./mid.css" screen;`,
        "/mid.css": /* css */ `
          @layer inner, other;
          @import "https://example.com/e.css" layer(other);
          .mid { color: red }
        `,
      },
      out: String.raw`@import "data:text/css,@import \"https://example.com/e.css\" layer(other);" screen;@media screen{@layer inner,other;}@media screen{.mid{color:red}}`,
      layers: "other, inner",
    },
    // A rule with "composes" does not print inside "@layer", so the copy in "vendor" is masked. Its rule wins in the source.
    ModuleWithComposesImportedWithAndWithoutLayer: {
      files: {
        "/entry.css": /* css */ `
          @layer utilities, components;
          @import "./lib.module.css" layer(vendor);
          @import "./lib.module.css";
        `,
        "/lib.module.css": /* css */ `
          .base { font-weight: bold }
          .btn { composes: base; }
          @layer components { .box { color: red } }
          @layer utilities { .box { color: green } }
        `,
      },
      out: `@layer utilities,components;@layer vendor{@layer components,utilities;}.base_9LS-8Q{font-weight:700}.btn_9LS-8Q{}@layer components{.box_9LS-8Q{color:red}}@layer utilities{.box_9LS-8Q{color:green}}`,
    },
  };

  for (const [name, { files, out, layers }] of Object.entries({
    ...layerOrderCases,
    ...layerOrderKeptCases,
    ...layerOrderLimits,
  })) {
    itBundled(`css/CSSAtLayerOrder${name}`, {
      files,
      outfile: "/out.css",
      minifyWhitespace: true,
      async onAfterBundle(api) {
        api.expectFile("/out.css").toBe(out + "\n");
        if (layers !== undefined) expect(layerOrderOf(api.readFile("/out.css")).join(", ")).toBe(layers);
        await expectValidImports(api.outfile);
      },
    });
  }

  for (const name of ["AfterPlainFile", "DesignSystemOnce"]) {
    itBundled(`css/CSSAtLayerOrder${name}CLI`, {
      files: layerOrderCases[name].files,
      outfile: "/out.css",
      minifyWhitespace: true,
      backend: "cli",
      onAfterBundle(api) {
        api.expectFile("/out.css").toBe(layerOrderCases[name].out + "\n");
      },
    });
  }

  // The stylesheets of one JS entry or of one HTML page share a layer order.
  itBundled("css/CSSAtLayerOrderFromJS", {
    files: {
      "/entry.js": /* js */ `
        import "./reset.css";
        import "./one.css";
        import "./two.css";
      `,
      "/reset.css": /* css */ `* { margin: 0 }`,
      ...designSystem,
    },
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out/entry.css").toBe(layerOrderKeptCases.DesignSystemTwiceAfterPlainFile.out + "\n");
    },
  });

  itBundled("css/CSSAtLayerOrderFromHTML", {
    files: {
      "/page.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="./reset.css">
            <link rel="stylesheet" href="./one.css">
            <link rel="stylesheet" href="./two.css">
          </head>
          <body><div class="box"></div></body>
        </html>
      `,
      "/reset.css": /* css */ `* { margin: 0 }`,
      ...designSystem,
    },
    entryPoints: ["/page.html"],
    outdir: "out/",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const href = api.readFile("out/page.html").match(/href="(.*?\.css)"/)![1];
      expect(api.readFile("out/" + href)).toBe(layerOrderKeptCases.DesignSystemTwiceAfterPlainFile.out + "\n");
    },
  });

  // The import orders of the two pages differ only in the conditions of a layer list, so each page gets its own stylesheet.
  itBundled("css/CSSAtLayerOrderTwoPages", {
    files: {
      "/first.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="./r0.css">
            <link rel="stylesheet" href="./r1.css">
          </head>
          <body><div class="x"></div></body>
        </html>
      `,
      "/second.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="./f1.css">
            <link rel="stylesheet" href="./r0.css">
            <link rel="stylesheet" href="./r1.css">
          </head>
          <body><div class="x"></div></body>
        </html>
      `,
      "/r0.css": /* css */ `
        @import "./f1.css" screen;
        @layer a { .x { color: green } }
      `,
      "/r1.css": /* css */ `
        @import "./f1.css";
        .r1 { color: blue }
      `,
      "/f1.css": /* css */ `@layer b { .x { color: red } }`,
    },
    entryPoints: ["/first.html", "/second.html"],
    outdir: "out/",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const stylesheetOf = (page: string) =>
        api.readFile("out/" + api.readFile("out/" + page).match(/href="(.*?\.css)"/)![1]);
      const rest = `@layer a{.x{color:green}}@layer b{.x{color:red}}.r1{color:#00f}\n`;
      // Without screen media the layer order is a, b on the first page. It is b, a on the second page.
      expect({ first: stylesheetOf("first.html"), second: stylesheetOf("second.html") }).toEqual({
        first: `@media screen{@layer b;}` + rest,
        second: `@layer b;` + rest,
      });
    },
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
