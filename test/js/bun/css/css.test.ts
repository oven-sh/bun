/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, test } from "bun:test";
import "harness";
import {
  attrTest,
  cssTest,
  indoc,
  minify_test,
  prefix_test,
  minifyTestWithOptions as minify_test_with_options,
  minify_error_test_with_options,
  ParserFlags,
  ParserOptions,
} from "./util";

function Some(n: number): number {
  return n;
}

function error_test(css: string, error: unknown) {
  // going to ignore this test for now
  test.skip(`ERROR: ${css}`, () => {});
}

describe("css tests", () => {
  // #16596
  cssTest(
    `.flexrow {
	flex-direction: row;
}

.flexcol {
	flex-direction: column;
}

.hello {
	flex-wrap: wrap;
}

.world {
	flex-wrap: nowrap;
}`,
    ".flexrow {\n  flex-direction: row;\n}\n\n.flexcol {\n  flex-direction: column;\n}\n\n.hello {\n  flex-wrap: wrap;\n}\n\n.world {\n  flex-wrap: nowrap;\n}\n",
  );
  // test escape sequences
  cssTest(
    `.foo {
  content: "\\2b";
}`,
    '.foo{content:"+";}',
  );

  describe("pseudo-class edge case", () => {
    cssTest(
      indoc`[type="file"]::file-selector-button:-moz-any() {
      --pico-background-color: var(--pico-primary-hover-background);
      --pico-border-color: var(--pico-primary-hover-border);
      --pico-box-shadow: var(--pico-button-hover-box-shadow, 0 0 0 #0000);
      --pico-color: var(--pico-primary-inverse);
    }`,
      indoc`[type="file"]::-webkit-file-upload-button:-webkit-any() {
      --pico-background-color: var(--pico-primary-hover-background);
      --pico-border-color: var(--pico-primary-hover-border);
      --pico-box-shadow: var(--pico-button-hover-box-shadow, 0 0 0 #0000);
      --pico-color: var(--pico-primary-inverse);
    }
    [type="file"]::file-selector-button:is() {
      --pico-background-color: var(--pico-primary-hover-background);
      --pico-border-color: var(--pico-primary-hover-border);
      --pico-box-shadow: var(--pico-button-hover-box-shadow, 0 0 0 #0000);
      --pico-color: var(--pico-primary-inverse);
    }`,
      {
        chrome: 80 << 16,
        edge: 80 << 16,
        firefox: 78 << 16,
        safari: 14 << 16,
        opera: 67 << 16,
      },
    );
  });

  test("calc edge case", () => {
    minify_test(
      // Problem: the value is being printed as Infinity in our restrict_prec thing but the internal thing actually wants it as 3.40282e38px
      `.rounded-full {
  border-radius: calc(infinity * 1px);
  width: calc(infinity * -1px);
}`,
      indoc`.rounded-full{border-radius:1e999px;width:-1e999px}`,
    );
  });
  describe("border_spacing", () => {
    minify_test(
      `
      .foo {
        border-spacing: 0px;
      }`,
      indoc`.foo{border-spacing:0}`,
    );

    minify_test(
      `
      .foo {
        border-spacing: 0px 0px;
      }
    `,
      indoc`.foo{border-spacing:0}`,
    );

    minify_test(
      `
      .foo {
        border-spacing: 12px   0px;
      }
    `,
      indoc`.foo{border-spacing:12px 0}`,
    );

    minify_test(
      `
      .foo {
        border-spacing: calc(3px * 2) calc(5px * 0);
      }
    `,
      indoc`.foo{border-spacing:6px 0}`,
    );

    minify_test(
      `
      .foo {
        border-spacing: calc(3px * 2) max(0px, 8px);
      }
    `,
      indoc`.foo{border-spacing:6px 8px}`,
    );

    // TODO: The `<length>` in border-spacing cannot have a negative value,
    // we may need to implement NonNegativeLength like Servo does.
    // Servo Code: https://github.com/servo/servo/blob/08bc2d53579c9ab85415d4363888881b91df073b/components/style/values/specified/length.rs#L875
    // CSSWG issue: https://lists.w3.org/Archives/Public/www-style/2008Sep/0161.html
    // `border-spacing = <length> <length>?`
    minify_test(
      `
      .foo {
        border-spacing: -20px;
      }
    `,
      indoc`.foo{border-spacing:-20px}`,
    );
  });

  describe("border", () => {
    cssTest(
      `
      .foo {
        border-left: 2px solid red;
        border-right: 2px solid red;
        border-bottom: 2px solid red;
        border-top: 2px solid red;
      }
    `,
      `
      .foo {
        border: 2px solid red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-left-color: red;
        border-right-color: red;
        border-bottom-color: red;
        border-top-color: red;
      }
    `,
      `
      .foo {
        border-color: red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-left-width: thin;
        border-right-width: thin;
        border-bottom-width: thin;
        border-top-width: thin;
      }
    `,
      `
      .foo {
        border-width: thin;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-left-style: dotted;
        border-right-style: dotted;
        border-bottom-style: dotted;
        border-top-style: dotted;
      }
    `,
      `
      .foo {
        border-style: dotted;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-left-width: thin;
        border-left-style: dotted;
        border-left-color: red;
      }
    `,
      `
      .foo {
        border-left: thin dotted red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-left-width: thick;
        border-left: thin dotted red;
      }
    `,
      `
      .foo {
        border-left: thin dotted red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-left-width: thick;
        border: thin dotted red;
      }
    `,
      `
      .foo {
        border: thin dotted red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border: thin dotted red;
        border-right-width: thick;
      }
    `,
      `
      .foo {
        border: thin dotted red;
        border-right-width: thick;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border: thin dotted red;
        border-right: thick dotted red;
      }
    `,
      `
      .foo {
        border: thin dotted red;
        border-right-width: thick;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border: thin dotted red;
        border-right-width: thick;
        border-right-style: solid;
      }
    `,
      `
      .foo {
        border: thin dotted red;
        border-right: thick solid red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-top: thin dotted red;
        border-block-start: thick solid green;
      }
    `,
      `
      .foo {
        border-top: thin dotted red;
        border-block-start: thick solid green;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border: thin dotted red;
        border-block-start-width: thick;
        border-left-width: medium;
      }
    `,
      `
      .foo {
        border: thin dotted red;
        border-block-start-width: thick;
        border-left-width: medium;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: thin dotted red;
        border-inline-end: thin dotted red;
      }
    `,
      `
      .foo {
        border-block-start: thin dotted red;
        border-inline-end: thin dotted red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start-width: thin;
        border-block-start-style: dotted;
        border-block-start-color: red;
        border-inline-end: thin dotted red;
      }
    `,
      `
      .foo {
        border-block-start: thin dotted red;
        border-inline-end: thin dotted red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: thin dotted red;
        border-block-end: thin dotted red;
      }
    `,
      `
      .foo {
        border-block: thin dotted red;
      }
    `,
    );

    minify_test(
      `
      .foo {
        border: none;
      }
    `,
      ".foo{border:none}",
    );

    minify_test(".foo { border-width: 0 0 1px; }", ".foo{border-width:0 0 1px}");
    cssTest(
      `
      .foo {
        border-block-width: 1px;
        border-inline-width: 1px;
      }
    `,
      `
      .foo {
        border-width: 1px;
      }
    `,
    );
    cssTest(
      `
      .foo {
        border-block-start-width: 1px;
        border-block-end-width: 1px;
        border-inline-start-width: 1px;
        border-inline-end-width: 1px;
      }
    `,
      `
      .foo {
        border-width: 1px;
      }
    `,
    );
    cssTest(
      `
      .foo {
        border-block-start-width: 1px;
        border-block-end-width: 1px;
        border-inline-start-width: 2px;
        border-inline-end-width: 2px;
      }
    `,
      `
      .foo {
        border-block-width: 1px;
        border-inline-width: 2px;
      }
    `,
    );
    cssTest(
      `
      .foo {
        border-block-start-width: 1px;
        border-block-end-width: 1px;
        border-inline-start-width: 2px;
        border-inline-end-width: 3px;
      }
    `,
      `
      .foo {
        border-block-width: 1px;
        border-inline-width: 2px 3px;
      }
    `,
    );

    minify_test(
      ".foo { border-bottom: 1px solid var(--spectrum-global-color-gray-200)}",
      ".foo{border-bottom:1px solid var(--spectrum-global-color-gray-200)}",
    );
    cssTest(
      `
      .foo {
        border-width: 0;
        border-bottom: var(--test, 1px) solid;
      }
    `,
      `
      .foo {
        border-width: 0;
        border-bottom: var(--test, 1px) solid;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border: 1px solid black;
        border-width: 1px 1px 0 0;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-width: 1px 1px 0 0;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-top: 1px solid black;
        border-bottom: 1px solid black;
        border-left: 2px solid black;
        border-right: 2px solid black;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-width: 1px 2px;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-top: 1px solid black;
        border-bottom: 1px solid black;
        border-left: 2px solid black;
        border-right: 1px solid black;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-left-width: 2px;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-top: 1px solid black;
        border-bottom: 1px solid black;
        border-left: 1px solid red;
        border-right: 1px solid red;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-color: #000 red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: 1px solid black;
        border-block-end: 1px solid black;
        border-inline-start: 1px solid red;
        border-inline-end: 1px solid red;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-inline-color: red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: 1px solid black;
        border-block-end: 1px solid black;
        border-inline-start: 2px solid black;
        border-inline-end: 2px solid black;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-inline-width: 2px;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: 1px solid black;
        border-block-end: 1px solid black;
        border-inline-start: 2px solid red;
        border-inline-end: 2px solid red;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-inline: 2px solid red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: 1px solid black;
        border-block-end: 1px solid black;
        border-inline-start: 2px solid red;
        border-inline-end: 3px solid red;
      }
    `,
      `
      .foo {
        border: 1px solid #000;
        border-inline-start: 2px solid red;
        border-inline-end: 3px solid red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: 2px solid black;
        border-block-end: 1px solid black;
        border-inline-start: 2px solid red;
        border-inline-end: 2px solid red;
      }
    `,
      `
      .foo {
        border: 2px solid red;
        border-block-start-color: #000;
        border-block-end: 1px solid #000;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: 2px solid red;
        border-block-end: 1px solid red;
        border-inline-start: 2px solid red;
        border-inline-end: 2px solid red;
      }
    `,
      `
      .foo {
        border: 2px solid red;
        border-block-end-width: 1px;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border-block-start: 2px solid red;
        border-block-end: 2px solid red;
        border-inline-start: 2px solid red;
        border-inline-end: 1px solid red;
      }
    `,
      `
      .foo {
        border: 2px solid red;
        border-inline-end-width: 1px;
      }
    `,
    );

    cssTest(
      `
      .foo {
        border: 1px solid currentColor;
      }
    `,
      `
      .foo {
        border: 1px solid;
      }
    `,
    );

    minify_test(
      `
      .foo {
        border: 1px solid currentColor;
      }
    `,
      ".foo{border:1px solid}",
    );

    prefix_test(
      `
      .foo {
        border-block: 2px solid red;
      }
    `,
      `
      .foo {
        border-top: 2px solid red;
        border-bottom: 2px solid red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-block-start: 2px solid red;
      }
    `,
      `
      .foo {
        border-top: 2px solid red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-block-end: 2px solid red;
      }
    `,
      `
      .foo {
        border-bottom: 2px solid red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline: 2px solid red;
      }
    `,
      `
      .foo {
        border-left: 2px solid red;
        border-right: 2px solid red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-block-width: 2px;
      }
    `,
      `
      .foo {
        border-block-start-width: 2px;
        border-block-end-width: 2px;
      }
    `,
      {
        safari: 13 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-block-width: 2px;
      }
    `,
      `
      .foo {
        border-block-width: 2px;
      }
    `,
      {
        safari: 15 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start: 2px solid red;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid red;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid red;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right: 2px solid red;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right: 2px solid red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start-width: 2px;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-width: 2px;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-width: 2px;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right-width: 2px;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right-width: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-end: 2px solid red;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: 2px solid red;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: 2px solid red;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 2px solid red;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 2px solid red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start: 2px solid red;
        border-inline-end: 5px solid green;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid red;
        border-right: 5px solid green;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid red;
        border-right: 5px solid green;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 5px solid green;
        border-right: 2px solid red;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 5px solid green;
        border-right: 2px solid red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start: 2px solid red;
        border-inline-end: 5px solid green;
      }

      .bar {
        border-inline-start: 1px dotted gray;
        border-inline-end: 1px solid black;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid red;
        border-right: 5px solid green;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid red;
        border-right: 5px solid green;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 5px solid green;
        border-right: 2px solid red;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 5px solid green;
        border-right: 2px solid red;
      }

      .bar:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 1px dotted gray;
        border-right: 1px solid #000;
      }

      .bar:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 1px dotted gray;
        border-right: 1px solid #000;
      }

      .bar:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 1px solid #000;
        border-right: 1px dotted gray;
      }

      .bar:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 1px solid #000;
        border-right: 1px dotted gray;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-width: 2px;
      }
    `,
      `
      .foo {
        border-left-width: 2px;
        border-right-width: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-width: 2px;
      }
    `,
      `
      .foo {
        border-left-width: 2px;
        border-right-width: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-style: solid;
      }
    `,
      `
      .foo {
        border-left-style: solid;
        border-right-style: solid;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-color: red;
      }
    `,
      `
      .foo {
        border-left-color: red;
        border-right-color: red;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-end: var(--test);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: var(--test);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: var(--test);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: var(--test);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: var(--test);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start: var(--start);
        border-inline-end: var(--end);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: var(--start);
        border-right: var(--end);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: var(--start);
        border-right: var(--end);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right: var(--start);
        border-left: var(--end);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right: var(--start);
        border-left: var(--end);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    for (const prop of [
      "border-inline-start-color",
      "border-inline-end-color",
      "border-block-start-color",
      "border-block-end-color",
      "border-top-color",
      "border-bottom-color",
      "border-left-color",
      "border-right-color",
      "border-color",
      "border-block-color",
      "border-inline-color",
    ]) {
      prefix_test(
        `
        .foo {
          ${prop}: lab(40% 56.6 39);
        }
      `,
        `
        .foo {
          ${prop}: #b32323;
          ${prop}: lab(40% 56.6 39);
        }
      `,
        {
          chrome: 90 << 16,
        },
      );
    }

    for (const prop of [
      "border",
      "border-inline",
      "border-block",
      "border-left",
      "border-right",
      "border-top",
      "border-bottom",
      "border-block-start",
      "border-block-end",
      "border-inline-start",
      "border-inline-end",
    ]) {
      prefix_test(
        `
        .foo {
          ${prop}: 2px solid lab(40% 56.6 39);
        }
      `,
        `
        .foo {
          ${prop}: 2px solid #b32323;
          ${prop}: 2px solid lab(40% 56.6 39);
        }
      `,
        {
          chrome: 90 << 16,
        },
      );
    }

    for (const prop of [
      "border",
      "border-inline",
      "border-block",
      "border-left",
      "border-right",
      "border-top",
      "border-bottom",
      "border-block-start",
      "border-block-end",
      "border-inline-start",
      "border-inline-end",
    ]) {
      prefix_test(
        `
        .foo {
          ${prop}: var(--border-width) solid lab(40% 56.6 39);
        }
      `,
        `
        .foo {
          ${prop}: var(--border-width) solid #b32323;
        }

        @supports (color: lab(0% 0 0)) {
          .foo {
            ${prop}: var(--border-width) solid lab(40% 56.6 39);
          }
        }
      `,
        {
          chrome: 90 << 16,
        },
      );
    }

    prefix_test(
      `
      .foo {
        border-inline-start-color: lab(40% 56.6 39);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-color: #b32323;
        border-left-color: lab(40% 56.6 39);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-color: #b32323;
        border-left-color: lab(40% 56.6 39);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right-color: #b32323;
        border-right-color: lab(40% 56.6 39);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right-color: #b32323;
        border-right-color: lab(40% 56.6 39);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-end-color: lab(40% 56.6 39);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right-color: #b32323;
        border-right-color: lab(40% 56.6 39);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right-color: #b32323;
        border-right-color: lab(40% 56.6 39);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left-color: #b32323;
        border-left-color: lab(40% 56.6 39);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left-color: #b32323;
        border-left-color: lab(40% 56.6 39);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start-color: lab(40% 56.6 39);
        border-inline-end-color: lch(50.998% 135.363 338);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-color: #b32323;
        border-left-color: lab(40% 56.6 39);
        border-right-color: #ee00be;
        border-right-color: lch(50.998% 135.363 338);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-color: #b32323;
        border-left-color: lab(40% 56.6 39);
        border-right-color: #ee00be;
        border-right-color: lch(50.998% 135.363 338);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left-color: #ee00be;
        border-left-color: lch(50.998% 135.363 338);
        border-right-color: #b32323;
        border-right-color: lab(40% 56.6 39);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left-color: #ee00be;
        border-left-color: lch(50.998% 135.363 338);
        border-right-color: #b32323;
        border-right-color: lab(40% 56.6 39);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start-color: lab(40% 56.6 39);
        border-inline-end-color: lch(50.998% 135.363 338);
      }
    `,
      `
      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-color: #b32323;
        border-left-color: color(display-p3 .643308 .192455 .167712);
        border-left-color: lab(40% 56.6 39);
        border-right-color: #ee00be;
        border-right-color: color(display-p3 .972961 -.362078 .804206);
        border-right-color: lch(50.998% 135.363 338);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left-color: #ee00be;
        border-left-color: color(display-p3 .972961 -.362078 .804206);
        border-left-color: lch(50.998% 135.363 338);
        border-right-color: #b32323;
        border-right-color: color(display-p3 .643308 .192455 .167712);
        border-right-color: lab(40% 56.6 39);
      }
    `,
      {
        chrome: 8 << 16,
        safari: 14 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start: 2px solid lab(40% 56.6 39);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid #b32323;
        border-left: 2px solid lab(40% 56.6 39);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left: 2px solid #b32323;
        border-left: 2px solid lab(40% 56.6 39);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right: 2px solid #b32323;
        border-right: 2px solid lab(40% 56.6 39);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-right: 2px solid #b32323;
        border-right: 2px solid lab(40% 56.6 39);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-end: 2px solid lab(40% 56.6 39);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: 2px solid #b32323;
        border-right: 2px solid lab(40% 56.6 39);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: 2px solid #b32323;
        border-right: 2px solid lab(40% 56.6 39);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 2px solid #b32323;
        border-left: 2px solid lab(40% 56.6 39);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: 2px solid #b32323;
        border-left: 2px solid lab(40% 56.6 39);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-end: var(--border-width) solid lab(40% 56.6 39);
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: var(--border-width) solid #b32323;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-right: var(--border-width) solid #b32323;
      }

      @supports (color: lab(0% 0 0)) {
        .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
          border-right: var(--border-width) solid lab(40% 56.6 39);
        }
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: var(--border-width) solid #b32323;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left: var(--border-width) solid #b32323;
      }

      @supports (color: lab(0% 0 0)) {
        .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
          border-left: var(--border-width) solid lab(40% 56.6 39);
        }
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start: 2px solid red;
        border-inline-end: 2px solid red;
      }
    `,
      `
      .foo {
        border-inline-start: 2px solid red;
        border-inline-end: 2px solid red;
      }
    `,
      {
        safari: 13 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-inline-start: 2px solid red;
        border-inline-end: 2px solid red;
      }
    `,
      `
      .foo {
        border-inline: 2px solid red;
      }
    `,
      {
        safari: 15 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-width: 22px;
        border-width: max(2cqw, 22px);
      }
    `,
      `
      .foo {
        border-width: 22px;
        border-width: max(2cqw, 22px);
      }
    `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        border-width: 22px;
        border-width: max(2cqw, 22px);
      }
    `,
      `
      .foo {
        border-width: max(2cqw, 22px);
      }
    `,
      {
        safari: 16 << 16,
      },
    );
    prefix_test(
      `
      .foo {
        border-color: #4263eb;
        border-color: color(display-p3 0 .5 1);
      }
    `,
      `
      .foo {
        border-color: #4263eb;
        border-color: color(display-p3 0 .5 1);
      }
    `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
      .foo {
        border-color: #4263eb;
        border-color: color(display-p3 0 .5 1);
      }
    `,
      `
      .foo {
        border-color: color(display-p3 0 .5 1);
      }
    `,
      {
        safari: 16 << 16,
      },
    );
    prefix_test(
      `
      .foo {
        border: 1px solid #4263eb;
        border-color: color(display-p3 0 .5 1);
      }
    `,
      `
      .foo {
        border: 1px solid #4263eb;
        border-color: color(display-p3 0 .5 1);
      }
    `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
      .foo {
        border: 1px solid #4263eb;
        border-color: color(display-p3 0 .5 1);
      }
    `,
      `
      .foo {
        border: 1px solid color(display-p3 0 .5 1);
      }
    `,
      {
        safari: 16 << 16,
      },
    );
    prefix_test(
      `
      .foo {
        border-color: var(--fallback);
        border-color: color(display-p3 0 .5 1);
      }
    `,
      `
      .foo {
        border-color: var(--fallback);
        border-color: color(display-p3 0 .5 1);
      }
    `,
      {
        chrome: 99 << 16,
      },
    );
  });

  describe("margin", () => {
    cssTest(
      `
      .foo {
        margin-left: 10px;
        margin-right: 10px;
        margin-top: 20px;
        margin-bottom: 20px;
      }`,
      indoc`
      .foo {
        margin: 20px 10px;
      }
`,
    );

    cssTest(
      `
      .foo {
        margin-block-start: 15px;
        margin-block-end: 15px;
      }`,
      indoc`
      .foo {
        margin-block: 15px;
      }
`,
    );

    cssTest(
      `
      .foo {
        margin-left: 10px;
        margin-right: 10px;
        margin-inline-start: 15px;
        margin-inline-end: 15px;
        margin-top: 20px;
        margin-bottom: 20px;
      }`,
      indoc`
      .foo {
        margin-left: 10px;
        margin-right: 10px;
        margin-inline: 15px;
        margin-top: 20px;
        margin-bottom: 20px;
      }
`,
    );

    cssTest(
      `
      .foo {
        margin: 10px;
        margin-top: 20px;
      }`,
      indoc`
      .foo {
        margin: 20px 10px 10px;
      }
`,
    );

    cssTest(
      `
      .foo {
        margin: 10px;
        margin-top: var(--top);
      }`,
      indoc`
      .foo {
        margin: 10px;
        margin-top: var(--top);
      }
`,
    );

    prefix_test(
      `
      .foo {
        margin-inline-start: 2px;
      }
    `,
      indoc`
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        margin-left: 2px;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        margin-left: 2px;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        margin-right: 2px;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        margin-right: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-inline-start: 2px;
        margin-inline-end: 4px;
      }
    `,
      indoc`
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        margin-left: 2px;
        margin-right: 4px;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        margin-left: 2px;
        margin-right: 4px;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        margin-left: 4px;
        margin-right: 2px;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        margin-left: 4px;
        margin-right: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-inline: 2px;
      }
    `,
      indoc`
      .foo {
        margin-left: 2px;
        margin-right: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-block-start: 2px;
      }
    `,
      indoc`
      .foo {
        margin-top: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-block-end: 2px;
      }
    `,
      indoc`
      .foo {
        margin-bottom: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-inline-start: 2px;
        margin-inline-end: 2px;
      }
    `,
      indoc`
      .foo {
        margin-inline-start: 2px;
        margin-inline-end: 2px;
      }
    `,
      {
        safari: 13 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-inline: 2px;
      }
    `,
      indoc`
      .foo {
        margin-inline-start: 2px;
        margin-inline-end: 2px;
      }
    `,
      {
        safari: 13 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-inline-start: 2px;
        margin-inline-end: 2px;
      }
    `,
      indoc`
      .foo {
        margin-inline: 2px;
      }
    `,
      {
        safari: 15 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        margin-inline: 2px;
      }
    `,
      indoc`
      .foo {
        margin-inline: 2px;
      }
    `,
      {
        safari: 15 << 16,
      },
    );
  });

  describe("length", () => {
    const properties = [
      "margin-right",
      "margin",
      "padding-right",
      "padding",
      "width",
      "height",
      "min-height",
      "max-height",
      // "line-height",
      // "border-radius",
    ];

    for (const prop of properties) {
      prefix_test(
        `
        .foo {
          ${prop}: 22px;
          ${prop}: max(4%, 22px);
        }
      `,
        indoc`
        .foo {
          ${prop}: 22px;
          ${prop}: max(4%, 22px);
        }
      `,
        {
          safari: 10 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${prop}: 22px;
          ${prop}: max(4%, 22px);
        }
      `,
        indoc`
        .foo {
          ${prop}: max(4%, 22px);
        }
      `,
        {
          safari: 14 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${prop}: 22px;
          ${prop}: max(2cqw, 22px);
        }
      `,
        indoc`
        .foo {
          ${prop}: 22px;
          ${prop}: max(2cqw, 22px);
        }
      `,
        {
          safari: 14 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${prop}: 22px;
          ${prop}: max(2cqw, 22px);
        }
      `,
        indoc`
        .foo {
          ${prop}: max(2cqw, 22px);
        }
      `,
        {
          safari: 16 << 16,
        },
      );
    }
  });

  describe("padding", () => {
    cssTest(
      `
      .foo {
        padding-left: 10px;
        padding-right: 10px;
        padding-top: 20px;
        padding-bottom: 20px;
      }
    `,
      indoc`
      .foo {
        padding: 20px 10px;
      }
    `,
    );

    cssTest(
      `
      .foo {
        padding-block-start: 15px;
        padding-block-end: 15px;
      }
    `,
      indoc`
      .foo {
        padding-block: 15px;
      }
    `,
    );

    cssTest(
      `
      .foo {
        padding-left: 10px;
        padding-right: 10px;
        padding-inline-start: 15px;
        padding-inline-end: 15px;
        padding-top: 20px;
        padding-bottom: 20px;
      }
    `,
      indoc`
      .foo {
        padding-left: 10px;
        padding-right: 10px;
        padding-inline: 15px;
        padding-top: 20px;
        padding-bottom: 20px;
      }
    `,
    );

    prefix_test(
      `
      .foo {
        padding-inline-start: 2px;
      }
    `,
      indoc`
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        padding-left: 2px;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        padding-left: 2px;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        padding-right: 2px;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        padding-right: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-inline-start: 2px;
        padding-inline-end: 4px;
      }
    `,
      indoc`
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        padding-left: 2px;
        padding-right: 4px;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        padding-left: 2px;
        padding-right: 4px;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        padding-left: 4px;
        padding-right: 2px;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        padding-left: 4px;
        padding-right: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-inline-start: var(--padding);
      }
    `,
      indoc`
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        padding-left: var(--padding);
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        padding-left: var(--padding);
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        padding-right: var(--padding);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        padding-right: var(--padding);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-inline: 2px;
      }
    `,
      indoc`
      .foo {
        padding-left: 2px;
        padding-right: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-block-start: 2px;
      }
    `,
      indoc`
      .foo {
        padding-top: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-block-end: 2px;
      }
    `,
      indoc`
      .foo {
        padding-bottom: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-top: 1px;
        padding-left: 2px;
        padding-bottom: 3px;
        padding-right: 4px;
      }
    `,
      indoc`
      .foo {
        padding: 1px 4px 3px 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-inline-start: 2px;
        padding-inline-end: 2px;
      }
    `,
      indoc`
      .foo {
        padding-inline-start: 2px;
        padding-inline-end: 2px;
      }
    `,
      {
        safari: 13 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        padding-inline-start: 2px;
        padding-inline-end: 2px;
      }
    `,
      indoc`
      .foo {
        padding-inline: 2px;
      }
    `,
      {
        safari: 15 << 16,
      },
    );
  });

  describe("scroll-paddding", () => {
    prefix_test(
      `
      .foo {
        scroll-padding-inline: 2px;
      }
    `,
      indoc`
      .foo {
        scroll-padding-inline: 2px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );
  });

  describe("size", () => {
    prefix_test(
      `
      .foo {
        block-size: 25px;
        inline-size: 25px;
        min-block-size: 25px;
        min-inline-size: 25px;
      }
    `,
      indoc`
      .foo {
        height: 25px;
        min-height: 25px;
        width: 25px;
        min-width: 25px;
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        block-size: 25px;
        min-block-size: 25px;
        inline-size: 25px;
        min-inline-size: 25px;
      }
    `,
      indoc`
      .foo {
        block-size: 25px;
        min-block-size: 25px;
        inline-size: 25px;
        min-inline-size: 25px;
      }
    `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        block-size: var(--size);
        min-block-size: var(--size);
        inline-size: var(--size);
        min-inline-size: var(--size);
      }
    `,
      indoc`
      .foo {
        height: var(--size);
        min-height: var(--size);
        width: var(--size);
        min-width: var(--size);
      }
    `,
      {
        safari: 8 << 16,
      },
    );

    const sizeProps = [
      ["width", "width"],
      ["height", "height"],
      ["block-size", "height"],
      ["inline-size", "width"],
      ["min-width", "min-width"],
      ["min-height", "min-height"],
      ["min-block-size", "min-height"],
      ["min-inline-size", "min-width"],
      ["max-width", "max-width"],
      ["max-height", "max-height"],
      ["max-block-size", "max-height"],
      ["max-inline-size", "max-width"],
    ];

    for (const [inProp, outProp] of sizeProps) {
      prefix_test(
        `
        .foo {
          ${inProp}: stretch;
        }
      `,
        indoc`
        .foo {
          ${outProp}: -webkit-fill-available;
          ${outProp}: -moz-available;
          ${outProp}: stretch;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: -webkit-fill-available;
        }
      `,
        indoc`
        .foo {
          ${outProp}: -webkit-fill-available;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: 100vw;
          ${inProp}: -webkit-fill-available;
        }
      `,
        indoc`
        .foo {
          ${outProp}: 100vw;
          ${outProp}: -webkit-fill-available;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: fit-content;
        }
      `,
        indoc`
        .foo {
          ${outProp}: -webkit-fit-content;
          ${outProp}: -moz-fit-content;
          ${outProp}: fit-content;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: fit-content(50%);
        }
      `,
        indoc`
        .foo {
          ${outProp}: fit-content(50%);
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: min-content;
        }
      `,
        indoc`
        .foo {
          ${outProp}: -webkit-min-content;
          ${outProp}: -moz-min-content;
          ${outProp}: min-content;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: max-content;
        }
      `,
        indoc`
        .foo {
          ${outProp}: -webkit-max-content;
          ${outProp}: -moz-max-content;
          ${outProp}: max-content;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: 100%;
          ${inProp}: max-content;
        }
      `,
        indoc`
        .foo {
          ${outProp}: 100%;
          ${outProp}: max-content;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );

      prefix_test(
        `
        .foo {
          ${inProp}: var(--fallback);
          ${inProp}: max-content;
        }
      `,
        indoc`
        .foo {
          ${outProp}: var(--fallback);
          ${outProp}: max-content;
        }
      `,
        {
          safari: 8 << 16,
          firefox: 4 << 16,
        },
      );
    }

    minify_test(".foo { aspect-ratio: auto }", ".foo{aspect-ratio:auto}");
    minify_test(".foo { aspect-ratio: 2 / 3 }", ".foo{aspect-ratio:2/3}");
    minify_test(".foo { aspect-ratio: auto 2 / 3 }", ".foo{aspect-ratio:auto 2/3}");
    minify_test(".foo { aspect-ratio: 2 / 3 auto }", ".foo{aspect-ratio:auto 2/3}");
  });

  describe("background", () => {
    cssTest(
      `
      .foo {
        background: url(img.png);
        background-position-x: 20px;
        background-position-y: 10px;
        background-size: 50px 100px;
        background-repeat: repeat no-repeat;
      }
    `,
      indoc`
      .foo {
        background: url("img.png") 20px 10px / 50px 100px repeat-x;
      }
    `,
    );

    cssTest(
      `
      .foo {
        background-color: red;
        background-position: 0% 0%;
        background-size: auto;
        background-repeat: repeat;
        background-clip: border-box;
        background-origin: padding-box;
        background-attachment: scroll;
        background-image: none
      }
    `,
      indoc`
      .foo {
        background: red;
      }
    `,
    );

    cssTest(
      `
      .foo {
        background-color: gray;
        background-position: 40% 50%;
        background-size: 10em auto;
        background-repeat: round;
        background-clip: border-box;
        background-origin: border-box;
        background-attachment: fixed;
        background-image: url('chess.png');
      }
    `,
      indoc`
      .foo {
        background: gray url("chess.png") 40% / 10em round fixed border-box;
      }
    `,
    );

    cssTest(
      `
      .foo {
        background: url(img.png), url(test.jpg) gray;
        background-position-x: right 20px, 10px;
        background-position-y: top 20px, 15px;
        background-size: 50px 50px, auto;
        background-repeat: repeat no-repeat, no-repeat;
      }
    `,
      indoc`
      .foo {
        background: url("img.png") right 20px top 20px / 50px 50px repeat-x, gray url("test.jpg") 10px 15px no-repeat;
      }
    `,
    );

    minify_test(
      `
      .foo {
        background-position: center center;
      }
    `,
      indoc`.foo{background-position:50%}`,
    );

    cssTest(
      `
      .foo {
        background: url(img.png) gray;
        background-clip: content-box;
        -webkit-background-clip: text;
      }
    `,
      indoc`
      .foo {
        background: gray url("img.png") padding-box content-box;
        -webkit-background-clip: text;
      }
    `,
    );

    cssTest(
      `
      .foo {
        background: url(img.png) gray;
        -webkit-background-clip: text;
        background-clip: content-box;
      }
    `,
      indoc`
      .foo {
        background: gray url("img.png");
        -webkit-background-clip: text;
        background-clip: content-box;
      }
    `,
    );

    cssTest(
      `
      .foo {
        background: url(img.png) gray;
        background-position: var(--pos);
      }
    `,
      indoc`
      .foo {
        background: gray url("img.png");
        background-position: var(--pos);
      }
    `,
    );

    minify_test(".foo { background-position: bottom left }", ".foo{background-position:0 100%}");
    minify_test(".foo { background-position: left 10px center }", ".foo{background-position:10px 50%}");
    minify_test(".foo { background-position: right 10px center }", ".foo{background-position:right 10px center}");
    minify_test(".foo { background-position: right 10px top 20px }", ".foo{background-position:right 10px top 20px}");
    minify_test(".foo { background-position: left 10px top 20px }", ".foo{background-position:10px 20px}");
    minify_test(
      ".foo { background-position: left 10px bottom 20px }",
      ".foo{background-position:left 10px bottom 20px}",
    );
    minify_test(".foo { background-position: left 10px top }", ".foo{background-position:10px 0}");
    minify_test(".foo { background-position: bottom right }", ".foo{background-position:100% 100%}");

    minify_test(
      ".foo { background: url('img-sprite.png') no-repeat bottom right }",
      ".foo{background:url(img-sprite.png) 100% 100% no-repeat}",
    );
    minify_test(".foo { background: transparent }", ".foo{background:0 0}");

    minify_test(
      ".foo { background: url(\"data:image/svg+xml,%3Csvg width='168' height='24' xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E\") }",
      ".foo{background:url(\"data:image/svg+xml,%3Csvg width='168' height='24' xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E\")}",
    );

    cssTest(
      `
      .foo {
        background: url(img.png);
        background-clip: text;
      }
    `,
      indoc`
      .foo {
        background: url("img.png") text;
      }
    `,
    );

    prefix_test(
      `
        .foo {
          background: url(img.png);
          background-clip: text;
        }
      `,
      indoc`
        .foo {
          background: url("img.png");
          -webkit-background-clip: text;
          background-clip: text;
        }
      `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background: url(img.png);
          background-clip: text;
        }
      `,
      indoc`
        .foo {
          background: url("img.png") text;
        }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background: url(img.png) text;
        }
      `,
      indoc`
        .foo {
          background: url("img.png");
          -webkit-background-clip: text;
          background-clip: text;
        }
      `,
      {
        chrome: 45 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background: url(img.png);
          -webkit-background-clip: text;
        }
      `,
      indoc`
        .foo {
          background: url("img.png");
          -webkit-background-clip: text;
        }
      `,
      {
        chrome: 45 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background: url(img.png);
          background-clip: text;
        }
      `,
      indoc`
        .foo {
          background: url("img.png");
          -webkit-background-clip: text;
          background-clip: text;
        }
      `,
      {
        safari: 14 << 16,
        chrome: 95 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background-image: url(img.png);
          background-clip: text;
        }
      `,
      indoc`
        .foo {
          background-image: url("img.png");
          -webkit-background-clip: text;
          background-clip: text;
        }
      `,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          -webkit-background-clip: text;
          background-clip: text;
        }
      `,
      indoc`
        .foo {
          -webkit-background-clip: text;
          background-clip: text;
        }
      `,
      {
        chrome: 45 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background-image: url(img.png);
          background-clip: text;
        }
      `,
      indoc`
        .foo {
          background-image: url("img.png");
          background-clip: text;
        }
      `,
      {
        safari: 14 << 16,
      },
    );

    minify_test(".foo { background: none center }", ".foo{background:50%}");
    minify_test(".foo { background: none }", ".foo{background:0 0}");

    prefix_test(
      `
        .foo {
          background: lab(51.5117% 43.3777 -29.0443);
        }
      `,
      indoc`
        .foo {
          background: #af5cae;
          background: lab(51.5117% 43.3777 -29.0443);
        }
      `,
      {
        chrome: 95 << 16,
        safari: 15 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background: lab(51.5117% 43.3777 -29.0443) url(foo.png);
        }
      `,
      indoc`
        .foo {
          background: #af5cae url("foo.png");
          background: lab(51.5117% 43.3777 -29.0443) url("foo.png");
        }
      `,
      {
        chrome: 95 << 16,
        safari: 15 << 16,
      },
    );

    prefix_test(
      `
        .foo {
          background: lab(51.5117% 43.3777 -29.0443) linear-gradient(lab(52.2319% 40.1449 59.9171), lab(47.7776% -34.2947 -7.65904));
        }
      `,
      indoc`
        .foo {
          background: #af5cae linear-gradient(#c65d07, #00807c);
          background: lab(51.5117% 43.3777 -29.0443) linear-gradient(lab(52.2319% 40.1449 59.9171), lab(47.7776% -34.2947 -7.65904));
        }
      `,
      {
        chrome: 95 << 16,
        safari: 15 << 16,
      },
    );

    cssTest(
      ".foo { background: calc(var(--v) / 0.3)",
      indoc`
        .foo {
          background: calc(var(--v) / .3);
        }
      `,
    );

    prefix_test(
      `
        .foo {
          background-color: #4263eb;
          background-color: color(display-p3 0 .5 1);
        }
      `,
      indoc`
        .foo {
          background-color: #4263eb;
          background-color: color(display-p3 0 .5 1);
        }
      `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background-color: #4263eb;
          background-color: color(display-p3 0 .5 1);
        }
      `,
      indoc`
        .foo {
          background-color: color(display-p3 0 .5 1);
        }
      `,
      {
        safari: 16 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background-image: linear-gradient(red, green);
          background-image: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      indoc`
        .foo {
          background-image: linear-gradient(red, green);
          background-image: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background-image: linear-gradient(red, green);
          background-image: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      indoc`
        .foo {
          background-image: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      {
        safari: 16 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background: #4263eb;
          background: color(display-p3 0 .5 1);
        }
      `,
      indoc`
        .foo {
          background: #4263eb;
          background: color(display-p3 0 .5 1);
        }
      `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background: #4263eb;
          background: color(display-p3 0 .5 1);
        }
      `,
      indoc`
        .foo {
          background: color(display-p3 0 .5 1);
        }
      `,
      {
        safari: 16 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background: linear-gradient(red, green);
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      indoc`
        .foo {
          background: linear-gradient(red, green);
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background: red;
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      indoc`
        .foo {
          background: red;
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background: linear-gradient(red, green);
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      indoc`
        .foo {
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      {
        safari: 16 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background: var(--fallback);
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      indoc`
        .foo {
          background: var(--fallback);
          background: linear-gradient(lch(50% 132 50), lch(50% 130 150));
        }
      `,
      {
        chrome: 99 << 16,
      },
    );
    prefix_test(
      `
        .foo {
          background: red url(foo.png);
          background: lch(50% 132 50) url(foo.png);
        }
      `,
      indoc`
        .foo {
          background: red url("foo.png");
          background: lch(50% 132 50) url("foo.png");
        }
      `,
      {
        chrome: 99 << 16,
      },
    );
  });

  describe("flex", () => {
    cssTest(
      `
       .foo {
         flex-direction: column;
         flex-wrap: wrap;
       }
     `,
      `
       .foo {
         flex-flow: column wrap;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-direction: row;
         flex-wrap: wrap;
       }
     `,
      `
       .foo {
         flex-flow: wrap;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-direction: row;
         flex-wrap: nowrap;
       }
     `,
      `
       .foo {
         flex-flow: row;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-direction: column;
         flex-wrap: nowrap;
       }
     `,
      `
       .foo {
         flex-flow: column;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 1;
         flex-basis: 0%;
       }
     `,
      `
       .foo {
         flex: 1;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 1;
         flex-basis: 0;
       }
     `,
      `
       .foo {
         flex: 1 1 0;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 1;
         flex-basis: 0px;
       }
     `,
      `
       .foo {
         flex: 1 1 0;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 2;
         flex-basis: 0%;
       }
     `,
      `
       .foo {
         flex: 1 2;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 2;
         flex-shrink: 1;
         flex-basis: 0%;
       }
     `,
      `
       .foo {
         flex: 2;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 2;
         flex-shrink: 2;
         flex-basis: 0%;
       }
     `,
      `
       .foo {
         flex: 2 2;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 1;
         flex-basis: 10px;
       }
     `,
      `
       .foo {
         flex: 10px;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 2;
         flex-shrink: 1;
         flex-basis: 10px;
       }
     `,
      `
       .foo {
         flex: 2 10px;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 0;
         flex-basis: 0%;
       }
     `,
      `
       .foo {
         flex: 1 0;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 0;
         flex-basis: auto;
       }
     `,
      `
       .foo {
         flex: 1 0 auto;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex-grow: 1;
         flex-shrink: 1;
         flex-basis: auto;
       }
     `,
      `
       .foo {
         flex: auto;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex: 0 0;
         flex-grow: 1;
       }
     `,
      `
       .foo {
         flex: 1 0;
       }
     `,
    );

    cssTest(
      `
       .foo {
         flex: 0 0;
         flex-grow: var(--grow);
       }
     `,
      `
       .foo {
         flex: 0 0;
         flex-grow: var(--grow);
       }
     `,
    );

    cssTest(
      `
       .foo {
         align-content: center;
         justify-content: center;
       }
     `,
      `
       .foo {
         place-content: center;
       }
     `,
    );

    cssTest(
      `
         .foo {
           align-content: first baseline;
           justify-content: safe right;
         }
       `,
      `
         .foo {
           place-content: baseline safe right;
         }
       `,
    );

    cssTest(
      `
         .foo {
           place-content: first baseline unsafe left;
         }
       `,
      `
         .foo {
           place-content: baseline unsafe left;
         }
       `,
    );

    cssTest(
      `
         .foo {
           place-content: center center;
         }
       `,
      `
         .foo {
           place-content: center;
         }
       `,
    );

    cssTest(
      `
         .foo {
           align-self: center;
           justify-self: center;
         }
       `,
      `
         .foo {
           place-self: center;
         }
       `,
    );

    cssTest(
      `
         .foo {
           align-self: center;
           justify-self: unsafe left;
         }
       `,
      `
         .foo {
           place-self: center unsafe left;
         }
       `,
    );

    cssTest(
      `
         .foo {
           align-items: center;
           justify-items: center;
         }
       `,
      `
         .foo {
           place-items: center;
         }
       `,
    );

    cssTest(
      `
         .foo {
           align-items: center;
           justify-items: legacy left;
         }
       `,
      `
         .foo {
           place-items: center legacy left;
         }
       `,
    );

    cssTest(
      `
         .foo {
           place-items: center;
           justify-items: var(--justify);
         }
       `,
      `
         .foo {
           place-items: center;
           justify-items: var(--justify);
         }
       `,
    );

    cssTest(
      `
         .foo {
           row-gap: 10px;
           column-gap: 20px;
         }
       `,
      `
         .foo {
           gap: 10px 20px;
         }
       `,
    );

    cssTest(
      `
         .foo {
           row-gap: 10px;
           column-gap: 10px;
         }
       `,
      `
         .foo {
           gap: 10px;
         }
       `,
    );

    cssTest(
      `
         .foo {
           gap: 10px;
           column-gap: 20px;
         }
       `,
      `
         .foo {
           gap: 10px 20px;
         }
       `,
    );

    cssTest(
      `
         .foo {
           column-gap: 20px;
           gap: 10px;
         }
       `,
      `
         .foo {
           gap: 10px;
         }
       `,
    );

    cssTest(
      `
         .foo {
           row-gap: normal;
           column-gap: 20px;
         }
       `,
      `
         .foo {
           gap: normal 20px;
         }
       `,
    );

    cssTest(
      `
         .foo {
           -webkit-flex-grow: 1;
           -webkit-flex-shrink: 1;
           -webkit-flex-basis: auto;
         }
       `,
      `
         .foo {
           -webkit-flex: auto;
         }
       `,
    );
    cssTest(
      `
         .foo {
           -webkit-flex-grow: 1;
           -webkit-flex-shrink: 1;
           -webkit-flex-basis: auto;
           flex-grow: 1;
           flex-shrink: 1;
           flex-basis: auto;
         }
       `,
      `
         .foo {
           -webkit-flex: auto;
           flex: auto;
         }
       `,
    );
    prefix_test(
      `
         .foo {
           -webkit-box-orient: horizontal;
           -webkit-box-direction: normal;
           flex-direction: row;
         }
       `,
      `
         .foo {
           -webkit-box-orient: horizontal;
           -webkit-box-direction: normal;
           -webkit-flex-direction: row;
           flex-direction: row;
         }
       `,
      {
        safari: 4 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           flex-direction: row;
         }
       `,
      `
         .foo {
           -webkit-box-orient: horizontal;
           -moz-box-orient: horizontal;
           -webkit-box-direction: normal;
           -moz-box-direction: normal;
           -webkit-flex-direction: row;
           -ms-flex-direction: row;
           flex-direction: row;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-orient: horizontal;
           -webkit-box-direction: normal;
           -moz-box-orient: horizontal;
           -moz-box-direction: normal;
           -webkit-flex-direction: row;
           -ms-flex-direction: row;
           flex-direction: row;
         }
       `,
      `
         .foo {
           flex-direction: row;
         }
       `,
      {
        safari: 14 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           flex-wrap: wrap;
         }
       `,
      `
         .foo {
           -webkit-box-lines: multiple;
           -moz-box-lines: multiple;
           -webkit-flex-wrap: wrap;
           -ms-flex-wrap: wrap;
           flex-wrap: wrap;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-lines: multiple;
           -moz-box-lines: multiple;
           -webkit-flex-wrap: wrap;
           -ms-flex-wrap: wrap;
           flex-wrap: wrap;
         }
       `,
      `
         .foo {
           flex-wrap: wrap;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           flex-flow: row wrap;
         }
       `,
      `
         .foo {
           -webkit-box-orient: horizontal;
           -moz-box-orient: horizontal;
           -webkit-box-direction: normal;
           -moz-box-direction: normal;
           -webkit-flex-flow: wrap;
           -ms-flex-flow: wrap;
           flex-flow: wrap;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-orient: horizontal;
           -moz-box-orient: horizontal;
           -webkit-box-direction: normal;
           -moz-box-direction: normal;
           -webkit-flex-flow: wrap;
           -ms-flex-flow: wrap;
           flex-flow: wrap;
         }
       `,
      `
         .foo {
           flex-flow: wrap;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           flex-grow: 1;
         }
       `,
      `
         .foo {
           -webkit-box-flex: 1;
           -moz-box-flex: 1;
           -ms-flex-positive: 1;
           -webkit-flex-grow: 1;
           flex-grow: 1;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-flex: 1;
           -moz-box-flex: 1;
           -ms-flex-positive: 1;
           -webkit-flex-grow: 1;
           flex-grow: 1;
         }
       `,
      `
         .foo {
           flex-grow: 1;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           flex-shrink: 1;
         }
       `,
      `
         .foo {
           -ms-flex-negative: 1;
           -webkit-flex-shrink: 1;
           flex-shrink: 1;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -ms-flex-negative: 1;
           -webkit-flex-shrink: 1;
           flex-shrink: 1;
         }
       `,
      `
         .foo {
           flex-shrink: 1;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           flex-basis: 1px;
         }
       `,
      `
         .foo {
           -ms-flex-preferred-size: 1px;
           -webkit-flex-basis: 1px;
           flex-basis: 1px;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -ms-flex-preferred-size: 1px;
           -webkit-flex-basis: 1px;
           flex-basis: 1px;
         }
       `,
      `
         .foo {
           flex-basis: 1px;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           flex: 1;
         }
       `,
      `
         .foo {
           -webkit-box-flex: 1;
           -moz-box-flex: 1;
           -webkit-flex: 1;
           -ms-flex: 1;
           flex: 1;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-flex: 1;
           -moz-box-flex: 1;
           -webkit-flex: 1;
           -ms-flex: 1;
           flex: 1;
         }
       `,
      `
         .foo {
           flex: 1;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           align-content: space-between;
         }
       `,
      `
         .foo {
           -ms-flex-line-pack: justify;
           -webkit-align-content: space-between;
           align-content: space-between;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -ms-flex-line-pack: justify;
           -webkit-align-content: space-between;
           align-content: space-between;
         }
       `,
      `
         .foo {
           align-content: space-between;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           justify-content: space-between;
         }
       `,
      `
         .foo {
           -webkit-box-pack: justify;
           -moz-box-pack: justify;
           -ms-flex-pack: justify;
           -webkit-justify-content: space-between;
           justify-content: space-between;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-pack: justify;
           -moz-box-pack: justify;
           -ms-flex-pack: justify;
           -webkit-justify-content: space-between;
           justify-content: space-between;
         }
       `,
      `
         .foo {
           justify-content: space-between;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-content: space-between flex-end;
         }
       `,
      `
         .foo {
           -ms-flex-line-pack: justify;
           -webkit-box-pack: end;
           -moz-box-pack: end;
           -ms-flex-pack: end;
           -webkit-align-content: space-between;
           align-content: space-between;
           -webkit-justify-content: flex-end;
           justify-content: flex-end;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -ms-flex-line-pack: justify;
           -webkit-box-pack: end;
           -moz-box-pack: end;
           -ms-flex-pack: end;
           -webkit-align-content: space-between;
           -webkit-justify-content: flex-end;
           place-content: space-between flex-end;
         }
       `,
      `
         .foo {
           place-content: space-between flex-end;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-content: space-between flex-end;
         }
       `,
      `
         .foo {
           align-content: space-between;
           justify-content: flex-end;
         }
       `,
      {
        chrome: 30 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-content: space-between flex-end;
         }
       `,
      `
         .foo {
           place-content: space-between flex-end;
         }
       `,
      {
        chrome: 60 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           align-self: flex-end;
         }
       `,
      `
         .foo {
           -ms-flex-item-align: end;
           -webkit-align-self: flex-end;
           align-self: flex-end;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -ms-flex-item-align: end;
           -webkit-align-self: flex-end;
           align-self: flex-end;
         }
       `,
      `
         .foo {
           align-self: flex-end;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-self: center flex-end;
         }
       `,
      `
         .foo {
           -ms-flex-item-align: center;
           -webkit-align-self: center;
           align-self: center;
           justify-self: flex-end;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -ms-flex-item-align: center;
           -webkit-align-self: center;
           place-self: center flex-end;
         }
       `,
      `
         .foo {
           place-self: center flex-end;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-self: center flex-end;
         }
       `,
      `
         .foo {
           align-self: center;
           justify-self: flex-end;
         }
       `,
      {
        chrome: 57 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-self: center flex-end;
         }
       `,
      `
         .foo {
           place-self: center flex-end;
         }
       `,
      {
        chrome: 59 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           align-items: flex-end;
         }
       `,
      `
         .foo {
           -webkit-box-align: end;
           -moz-box-align: end;
           -ms-flex-align: end;
           -webkit-align-items: flex-end;
           align-items: flex-end;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-align: end;
           -moz-box-align: end;
           -ms-flex-align: end;
           -webkit-align-items: flex-end;
           align-items: flex-end;
         }
       `,
      `
         .foo {
           align-items: flex-end;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-items: flex-end center;
         }
       `,
      `
         .foo {
           -webkit-box-align: end;
           -moz-box-align: end;
           -ms-flex-align: end;
           -webkit-align-items: flex-end;
           align-items: flex-end;
           justify-items: center;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-align: end;
           -moz-box-align: end;
           -ms-flex-align: end;
           -webkit-align-items: flex-end;
           place-items: flex-end center;
         }
       `,
      `
         .foo {
           place-items: flex-end center;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           place-items: flex-end center;
         }
       `,
      `
         .foo {
           align-items: flex-end;
           justify-items: center;
         }
       `,
      {
        safari: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           order: 1;
         }
       `,
      `
         .foo {
           -webkit-box-ordinal-group: 1;
           -moz-box-ordinal-group: 1;
           -ms-flex-order: 1;
           -webkit-order: 1;
           order: 1;
         }
       `,
      {
        safari: 4 << 16,
        firefox: 4 << 16,
        ie: 10 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -webkit-box-ordinal-group: 1;
           -moz-box-ordinal-group: 1;
           -ms-flex-order: 1;
           -webkit-order: 1;
           order: 1;
         }
       `,
      `
         .foo {
           order: 1;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
    prefix_test(
      `
         .foo {
           -ms-flex: 0 0 8%;
           flex: 0 0 5%;
         }
       `,
      `
         .foo {
           -ms-flex: 0 0 8%;
           flex: 0 0 5%;
         }
       `,
      {
        safari: 11 << 16,
      },
    );
  });

  describe("linear-gradient", () => {
    minify_test(".foo { background: linear-gradient(yellow, blue) }", ".foo{background:linear-gradient(#ff0,#00f)}");
    minify_test(
      ".foo { background: linear-gradient(to bottom, yellow, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(180deg, yellow, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(0.5turn, yellow, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow 10%, blue 20%) }",
      ".foo{background:linear-gradient(#ff0 10%,#00f 20%)}",
    );
    minify_test(
      ".foo { background: linear-gradient(to top, blue, yellow); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(to top, blue 10%, yellow 20%); }",
      ".foo{background:linear-gradient(#ff0 80%,#00f 90%)}",
    );
    minify_test(
      ".foo { background: linear-gradient(to top, blue 10px, yellow 20px); }",
      ".foo{background:linear-gradient(0deg,#00f 10px,#ff0 20px)}",
    );
    minify_test(
      ".foo { background: linear-gradient(135deg, yellow, blue); }",
      ".foo{background:linear-gradient(135deg,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, blue 20%, #0f0); }",
      ".foo{background:linear-gradient(#ff0,#00f 20%,#0f0)}",
    );
    minify_test(
      ".foo { background: linear-gradient(to top right, red, white, blue) }",
      ".foo{background:linear-gradient(to top right,red,#fff,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, blue calc(10% * 2), #0f0); }",
      ".foo{background:linear-gradient(#ff0,#00f 20%,#0f0)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, 20%, blue); }",
      ".foo{background:linear-gradient(#ff0,20%,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, 50%, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, 20px, blue); }",
      ".foo{background:linear-gradient(#ff0,20px,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, 50px, blue); }",
      ".foo{background:linear-gradient(#ff0,50px,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, 50px, blue); }",
      ".foo{background:linear-gradient(#ff0,50px,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, red 30% 40%, blue); }",
      ".foo{background:linear-gradient(#ff0,red 30% 40%,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(yellow, red 30%, red 40%, blue); }",
      ".foo{background:linear-gradient(#ff0,red 30% 40%,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(0, yellow, blue); }",
      ".foo{background:linear-gradient(#00f,#ff0)}",
    );
    minify_test(
      ".foo { background: -webkit-linear-gradient(yellow, blue) }",
      ".foo{background:-webkit-linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-linear-gradient(bottom, yellow, blue); }",
      ".foo{background:-webkit-linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-linear-gradient(top right, red, white, blue) }",
      ".foo{background:-webkit-linear-gradient(top right,red,#fff,#00f)}",
    );
    minify_test(
      ".foo { background: -moz-linear-gradient(yellow, blue) }",
      ".foo{background:-moz-linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -moz-linear-gradient(bottom, yellow, blue); }",
      ".foo{background:-moz-linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -moz-linear-gradient(top right, red, white, blue) }",
      ".foo{background:-moz-linear-gradient(top right,red,#fff,#00f)}",
    );
    minify_test(
      ".foo { background: -o-linear-gradient(yellow, blue) }",
      ".foo{background:-o-linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -o-linear-gradient(bottom, yellow, blue); }",
      ".foo{background:-o-linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -o-linear-gradient(top right, red, white, blue) }",
      ".foo{background:-o-linear-gradient(top right,red,#fff,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-gradient(linear, left top, left bottom, from(blue), to(yellow)) }",
      ".foo{background:-webkit-gradient(linear,0 0,0 100%,from(#00f),to(#ff0))}",
    );
    minify_test(
      ".foo { background: -webkit-gradient(linear, left top, left bottom, from(blue), color-stop(50%, red), to(yellow)) }",
      ".foo{background:-webkit-gradient(linear,0 0,0 100%,from(#00f),color-stop(.5,red),to(#ff0))}",
    );
    minify_test(
      ".foo { background: -webkit-gradient(linear, left top, left bottom, color-stop(0%, blue), color-stop(50%, red), color-stop(100%, yellow)) }",
      ".foo{background:-webkit-gradient(linear,0 0,0 100%,from(#00f),color-stop(.5,red),to(#ff0))}",
    );
    minify_test(
      ".foo { background: repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minify_test(
      ".foo { background: -webkit-repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:-webkit-repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minify_test(
      ".foo { background: -moz-repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:-moz-repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minify_test(
      ".foo { background: -o-repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:-o-repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minify_test(".foo { background: radial-gradient(yellow, blue) }", ".foo{background:radial-gradient(#ff0,#00f)}");
    minify_test(
      ".foo { background: radial-gradient(at top left, yellow, blue) }",
      ".foo{background:radial-gradient(at 0 0,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(5em circle at top left, yellow, blue) }",
      ".foo{background:radial-gradient(5em at 0 0,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(circle at 100%, #333, #333 50%, #eee 75%, #333 75%) }",
      ".foo{background:radial-gradient(circle at 100%,#333,#333 50%,#eee 75%,#333 75%)}",
    );
    minify_test(
      ".foo { background: radial-gradient(farthest-corner circle at 100% 50%, #333, #333 50%, #eee 75%, #333 75%) }",
      ".foo{background:radial-gradient(circle at 100%,#333,#333 50%,#eee 75%,#333 75%)}",
    );
    minify_test(
      ".foo { background: radial-gradient(farthest-corner circle at 50% 50%, #333, #333 50%, #eee 75%, #333 75%) }",
      ".foo{background:radial-gradient(circle,#333,#333 50%,#eee 75%,#333 75%)}",
    );
    minify_test(
      ".foo { background: radial-gradient(ellipse at top, #e66465, transparent) }",
      ".foo{background:radial-gradient(at top,#e66465,#0000)}",
    );
    minify_test(
      ".foo { background: radial-gradient(20px, yellow, blue) }",
      ".foo{background:radial-gradient(20px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:radial-gradient(20px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(20px 40px, yellow, blue) }",
      ".foo{background:radial-gradient(20px 40px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(ellipse 20px 40px, yellow, blue) }",
      ".foo{background:radial-gradient(20px 40px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(ellipse calc(20px + 10px) 40px, yellow, blue) }",
      ".foo{background:radial-gradient(30px 40px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(circle farthest-side, yellow, blue) }",
      ".foo{background:radial-gradient(circle farthest-side,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(farthest-side circle, yellow, blue) }",
      ".foo{background:radial-gradient(circle farthest-side,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(ellipse farthest-side, yellow, blue) }",
      ".foo{background:radial-gradient(farthest-side,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: radial-gradient(farthest-side ellipse, yellow, blue) }",
      ".foo{background:radial-gradient(farthest-side,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-radial-gradient(yellow, blue) }",
      ".foo{background:-webkit-radial-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -moz-radial-gradient(yellow, blue) }",
      ".foo{background:-moz-radial-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -o-radial-gradient(yellow, blue) }",
      ".foo{background:-o-radial-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:-webkit-repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -moz-repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:-moz-repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -o-repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:-o-repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-gradient(radial, center center, 0, center center, 100, from(blue), to(yellow)) }",
      ".foo{background:-webkit-gradient(radial,50% 50%,0,50% 50%,100,from(#00f),to(#ff0))}",
    );
    minify_test(".foo { background: conic-gradient(#f06, gold) }", ".foo{background:conic-gradient(#f06,gold)}");
    minify_test(
      ".foo { background: conic-gradient(at 50% 50%, #f06, gold) }",
      ".foo{background:conic-gradient(#f06,gold)}",
    );
    minify_test(
      ".foo { background: conic-gradient(from 0deg, #f06, gold) }",
      ".foo{background:conic-gradient(#f06,gold)}",
    );
    minify_test(
      ".foo { background: conic-gradient(from 0, #f06, gold) }",
      ".foo{background:conic-gradient(#f06,gold)}",
    );

    minify_test(
      ".foo { background: conic-gradient(from 0deg at center, #f06, gold) }",
      ".foo{background:conic-gradient(#f06,gold)}",
    );

    minify_test(
      ".foo { background: conic-gradient(white -50%, black 150%) }",
      ".foo{background:conic-gradient(#fff -50%,#000 150%)}",
    );

    minify_test(
      ".foo { background: conic-gradient(white -180deg, black 540deg) }",
      ".foo{background:conic-gradient(#fff -180deg,#000 540deg)}",
    );

    minify_test(
      ".foo { background: conic-gradient(from 45deg, white, black, white) }",
      ".foo{background:conic-gradient(from 45deg,#fff,#000,#fff)}",
    );

    minify_test(
      ".foo { background: repeating-conic-gradient(from 45deg, white, black, white) }",
      ".foo{background:repeating-conic-gradient(from 45deg,#fff,#000,#fff)}",
    );

    minify_test(
      ".foo { background: repeating-conic-gradient(black 0deg 25%, white 0deg 50%) }",
      ".foo{background:repeating-conic-gradient(#000 0deg 25%,#fff 0deg 50%)}",
    );
  });

  describe("font", () => {
    cssTest(
      `
      .foo {
        font-family: "Helvetica", "Times New Roman", sans-serif;
        font-size: 12px;
        font-weight: bold;
        font-style: italic;
        font-stretch: expanded;
        font-variant-caps: small-caps;
        line-height: 1.2em;
      }
    `,
      indoc`
      .foo {
        font: italic small-caps bold expanded 12px / 1.2em Helvetica, Times New Roman, sans-serif;
      }
`,
    );

    minify_test(
      `
      .foo {
        font-family: "Helvetica", "Times New Roman", sans-serif;
        font-size: 12px;
        font-weight: bold;
        font-style: italic;
        font-stretch: expanded;
        font-variant-caps: small-caps;
        line-height: 1.2em;
      }
    `,
      indoc`.foo{font:italic small-caps 700 125% 12px/1.2em Helvetica,Times New Roman,sans-serif}`,
    );

    cssTest(
      `
      .foo {
        font: 12px "Helvetica", "Times New Roman", sans-serif;
        line-height: 1.2em;
      }
    `,
      indoc`
      .foo {
        font: 12px / 1.2em Helvetica, Times New Roman, sans-serif;
      }
`,
    );

    cssTest(
      `
      .foo {
        font: 12px "Helvetica", "Times New Roman", sans-serif;
        line-height: var(--lh);
      }
    `,
      indoc`
      .foo {
        font: 12px Helvetica, Times New Roman, sans-serif;
        line-height: var(--lh);
      }
`,
    );

    minify_test(
      `
      .foo {
        font-family: "Helvetica", "Times New Roman", sans-serif;
        font-size: 12px;
        font-stretch: expanded;
      }
    `,
      indoc`.foo{font-family:Helvetica,Times New Roman,sans-serif;font-size:12px;font-stretch:125%}`,
    );

    cssTest(
      `
      .foo {
        font-family: "Helvetica", "Times New Roman", sans-serif;
        font-size: 12px;
        font-weight: bold;
        font-style: italic;
        font-stretch: expanded;
        font-variant-caps: all-small-caps;
        line-height: 1.2em;
      }
    `,
      indoc`
      .foo {
        font: italic bold expanded 12px / 1.2em Helvetica, Times New Roman, sans-serif;
        font-variant-caps: all-small-caps;
      }
`,
    );

    minify_test(".foo { font: normal normal 600 9px/normal Charcoal; }", ".foo{font:600 9px Charcoal}");
    minify_test(".foo { font: normal normal 500 medium/normal Charcoal; }", ".foo{font:500 medium Charcoal}");
    minify_test(".foo { font: normal normal 400 medium Charcoal; }", ".foo{font:400 medium Charcoal}");
    minify_test(".foo { font: normal normal 500 medium/10px Charcoal; }", ".foo{font:500 medium/10px Charcoal}");
    minify_test(".foo { font-family: 'sans-serif'; }", '.foo{font-family:"sans-serif"}');
    minify_test(".foo { font-family: sans-serif; }", ".foo{font-family:sans-serif}");
    minify_test(".foo { font-family: 'default'; }", '.foo{font-family:"default"}');
    minify_test(".foo { font-family: default; }", ".foo{font-family:default}");
    minify_test(".foo { font-family: 'inherit'; }", '.foo{font-family:"inherit"}');
    minify_test(".foo { font-family: inherit; }", ".foo{font-family:inherit}");
    minify_test(".foo { font-family: inherit test; }", ".foo{font-family:inherit test}");
    minify_test(".foo { font-family: 'inherit test'; }", ".foo{font-family:inherit test}");
    minify_test(".foo { font-family: revert; }", ".foo{font-family:revert}");
    minify_test(".foo { font-family: 'revert'; }", '.foo{font-family:"revert"}');
    minify_test(".foo { font-family: revert-layer; }", ".foo{font-family:revert-layer}");
    minify_test(".foo { font-family: revert-layer, serif; }", ".foo{font-family:revert-layer,serif}");
    minify_test(".foo { font-family: 'revert', sans-serif; }", '.foo{font-family:"revert",sans-serif}');
    minify_test(".foo { font-family: 'revert', foo, sans-serif; }", '.foo{font-family:"revert",foo,sans-serif}');
    minify_test(".foo { font-family: ''; }", '.foo{font-family:""}');

    // fonTfamily in @font-face
    minify_test("@font-face { font-family: 'revert'; }", '@font-face{font-family:"revert"}');
    minify_test("@font-face { font-family: 'revert-layer'; }", '@font-face{font-family:"revert-layer"}');

    prefix_test(
      `
      .foo {
        font-family: Helvetica, system-ui, sans-serif;
      }
    `,
      indoc`
      .foo {
        font-family: Helvetica, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif;
      }
`,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font: 100%/1.5 Helvetica, system-ui, sans-serif;
      }
    `,
      indoc`
      .foo {
        font: 100% / 1.5 Helvetica, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, Helvetica Neue, sans-serif;
      }
`,
      {
        safari: 8 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      }
    `,
      indoc`
      .foo {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Ubuntu, Cantarell, Helvetica Neue, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji;
      }
`,
      {
        firefox: 91 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-size: 22px;
        font-size: max(2cqw, 22px);
      }
    `,
      indoc`
      .foo {
        font-size: 22px;
        font-size: max(2cqw, 22px);
      }
`,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-size: 22px;
        font-size: max(2cqw, 22px);
      }
    `,
      indoc`
      .foo {
        font-size: max(2cqw, 22px);
      }
`,
      {
        safari: 16 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-size: 22px;
        font-size: xxx-large;
      }
    `,
      indoc`
      .foo {
        font-size: 22px;
        font-size: xxx-large;
      }
`,
      {
        chrome: 70 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-size: 22px;
        font-size: xxx-large;
      }
    `,
      indoc`
      .foo {
        font-size: xxx-large;
      }
`,
      {
        chrome: 80 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-weight: 700;
        font-weight: 789;
      }
    `,
      indoc`
      .foo {
        font-weight: 700;
        font-weight: 789;
      }
`,
      {
        chrome: 60 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-weight: 700;
        font-weight: 789;
      }
    `,
      indoc`
      .foo {
        font-weight: 789;
      }
`,
      {
        chrome: 80 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-family: Helvetica;
        font-family: system-ui;
      }
    `,
      indoc`
      .foo {
        font-family: Helvetica;
        font-family: system-ui;
      }
`,
      {
        chrome: 50 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-family: Helvetica;
        font-family: system-ui;
      }
    `,
      indoc`
      .foo {
        font-family: system-ui;
      }
`,
      {
        chrome: 80 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-style: oblique;
        font-style: oblique 40deg;
      }
    `,
      indoc`
      .foo {
        font-style: oblique;
        font-style: oblique 40deg;
      }
`,
      {
        firefox: 50 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font-style: oblique;
        font-style: oblique 40deg;
      }
    `,
      indoc`
      .foo {
        font-style: oblique 40deg;
      }
`,
      {
        firefox: 80 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font: 22px Helvetica;
        font: xxx-large system-ui;
      }
    `,
      indoc`
      .foo {
        font: 22px Helvetica;
        font: xxx-large system-ui;
      }
`,
      {
        chrome: 70 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font: 22px Helvetica;
        font: xxx-large system-ui;
      }
    `,
      indoc`
      .foo {
        font: xxx-large system-ui;
      }
`,
      {
        chrome: 80 << 16,
      },
    );

    prefix_test(
      `
      .foo {
        font: var(--fallback);
        font: xxx-large system-ui;
      }
    `,
      indoc`
      .foo {
        font: var(--fallback);
        font: xxx-large system-ui;
      }
`,
      {
        chrome: 50 << 16,
      },
    );
  });

  describe("selectors", () => {
    minify_test(":nth-col(2n) {width: 20px}", ":nth-col(2n){width:20px}");
    minify_test(":nth-col(10n-1) {width: 20px}", ":nth-col(10n-1){width:20px}");
    minify_test(":nth-col(-n+2) {width: 20px}", ":nth-col(-n+2){width:20px}");
    minify_test(":nth-col(even) {width: 20px}", ":nth-col(2n){width:20px}");
    minify_test(":nth-col(odd) {width: 20px}", ":nth-col(odd){width:20px}");
    minify_test(":nth-last-col(2n) {width: 20px}", ":nth-last-col(2n){width:20px}");
    minify_test(":nth-last-col(10n-1) {width: 20px}", ":nth-last-col(10n-1){width:20px}");
    minify_test(":nth-last-col(-n+2) {width: 20px}", ":nth-last-col(-n+2){width:20px}");
    minify_test(":nth-last-col(even) {width: 20px}", ":nth-last-col(2n){width:20px}");
    minify_test(":nth-last-col(odd) {width: 20px}", ":nth-last-col(odd){width:20px}");
    minify_test(":nth-child(odd) {width: 20px}", ":nth-child(odd){width:20px}");
    minify_test(":nth-child(2n) {width: 20px}", ":nth-child(2n){width:20px}");
    minify_test(":nth-child(2n+1) {width: 20px}", ":nth-child(odd){width:20px}");
    minify_test(":first-child {width: 20px}", ":first-child{width:20px}");
    minify_test(":nth-child(1) {width: 20px}", ":first-child{width:20px}");
    minify_test(":nth-last-child(1) {width: 20px}", ":last-child{width:20px}");
    minify_test(":nth-of-type(1) {width: 20px}", ":first-of-type{width:20px}");
    minify_test(":nth-last-of-type(1) {width: 20px}", ":last-of-type{width:20px}");
    minify_test(":nth-child(even of li.important) {width: 20px}", ":nth-child(2n of li.important){width:20px}");
    minify_test(":nth-child(1 of li.important) {width: 20px}", ":nth-child(1 of li.important){width:20px}");
    minify_test(
      ":nth-last-child(even of li.important) {width: 20px}",
      ":nth-last-child(2n of li.important){width:20px}",
    );
    minify_test(":nth-last-child(1 of li.important) {width: 20px}", ":nth-last-child(1 of li.important){width:20px}");
    minify_test(":nth-last-child(1 of.important) {width: 20px}", ":nth-last-child(1 of .important){width:20px}");

    minify_test('[foo="baz"] {color:red}', "[foo=baz]{color:red}");
    minify_test('[foo="foo bar"] {color:red}', "[foo=foo\\ bar]{color:red}");
    minify_test('[foo="foo bar baz"] {color:red}', '[foo="foo bar baz"]{color:red}');
    minify_test('[foo=""] {color:red}', '[foo=""]{color:red}');
    minify_test('.test:not([foo="bar"]) {color:red}', ".test:not([foo=bar]){color:red}");
    minify_test(".test + .foo {color:red}", ".test+.foo{color:red}");
    minify_test(".test ~ .foo {color:red}", ".test~.foo{color:red}");
    minify_test(".test .foo {color:red}", ".test .foo{color:red}");
    minify_test(
      ".custom-range::-webkit-slider-thumb:active {color:red}",
      ".custom-range::-webkit-slider-thumb:active{color:red}",
    );
    minify_test(".test:not(.foo, .bar) {color:red}", ".test:not(.foo,.bar){color:red}");
    minify_test(".test:is(.foo, .bar) {color:red}", ".test:is(.foo,.bar){color:red}");
    minify_test(".test:where(.foo, .bar) {color:red}", ".test:where(.foo,.bar){color:red}");
    minify_test(".test:where(.foo, .bar) {color:red}", ".test:where(.foo,.bar){color:red}");
    minify_test(":host {color:red}", ":host{color:red}");
    minify_test(":host(.foo) {color:red}", ":host(.foo){color:red}");
    minify_test("::slotted(span) {color:red", "::slotted(span){color:red}");
    minify_test("custom-element::part(foo) {color:red}", "custom-element::part(foo){color:red}");
    minify_test(".sm\\:text-5xl { font-size: 3rem }", ".sm\\:text-5xl{font-size:3rem}");
    minify_test("a:has(> img) {color:red}", "a:has(>img){color:red}");
    minify_test("dt:has(+ dt) {color:red}", "dt:has(+dt){color:red}");
    minify_test(
      "section:not(:has(h1, h2, h3, h4, h5, h6)) {color:red}",
      "section:not(:has(h1,h2,h3,h4,h5,h6)){color:red}",
    );
    minify_test(":has(.sibling ~ .target) {color:red}", ":has(.sibling~.target){color:red}");
    minify_test(".x:has(> .a > .b) {color:red}", ".x:has(>.a>.b){color:red}");
    minify_test(".x:has(.bar, #foo) {color:red}", ".x:has(.bar,#foo){color:red}");
    minify_test(".x:has(span + span) {color:red}", ".x:has(span+span){color:red}");
    minify_test("a:has(:visited) {color:red}", "a:has(:visited){color:red}");

    for (const element of [
      "-webkit-scrollbar",
      "-webkit-scrollbar-button",
      "-webkit-scrollbar-track",
      "-webkit-scrollbar-track-piece",
      "-webkit-scrollbar-thumb",
      "-webkit-scrollbar-corner",
      "-webkit-resizer",
    ]) {
      for (const clasz of [
        "enabled",
        "disabled",
        "hover",
        "active",
        "horizontal",
        "vertical",
        "decrement",
        "increment",
        "start",
        "end",
        "double-button",
        "single-button",
        "no-button",
        "corner-present",
        "window-inactive",
      ]) {
        minify_test(`::${element}:${clasz} {color:red}`, `::${element}:${clasz}{color:red}`);
      }
    }

    for (const clasz of [
      "horizontal",
      "vertical",
      "decrement",
      "increment",
      "start",
      "end",
      "double-button",
      "single-button",
      "no-button",
      "corner-present",
      "window-inactive",
    ]) {
      error_test(
        `:${clasz} {color: red}`,
        "ParserError::SelectorError(SelectorError::InvalidPseudoClassBeforeWebKitScrollbar)",
      );
    }

    for (const element of [
      "-webkit-scrollbar",
      "-webkit-scrollbar-button",
      "-webkit-scrollbar-track",
      "-webkit-scrollbar-track-piece",
      "-webkit-scrollbar-thumb",
      "-webkit-scrollbar-corner",
      "-webkit-resizer",
    ]) {
      error_test(
        `::${element}:focus {color:red}`,
        "ParserError::SelectorError(SelectorError::InvalidPseudoClassAfterWebKitScrollbar)",
      );
    }

    error_test(
      "a::first-letter:last-child {color:red}",
      "ParserError::SelectorError(SelectorError::InvalidPseudoClassAfterPseudoElement)",
    );

    minify_test("a:last-child::first-letter {color:red}", "a:last-child:first-letter{color:red}");

    error_test(
      "a::first-letter:last-child {color:red}",
      "ParserError::SelectorError(SelectorError::InvalidPseudoClassAfterPseudoElement)",
    );
    minify_test("a:last-child::first-letter {color:red}", "a:last-child:first-letter{color:red}");

    prefix_test(
      ".test:not(.foo, .bar) {color:red}",
      `
      .test:not(:-webkit-any(.foo, .bar)) {
        color: red;
      }

      .test:not(:is(.foo, .bar)) {
        color: red;
      }
      `,
      {
        safari: 8 << 16,
      },
    );
    prefix_test(
      ".test:not(.foo, .bar) {color:red}",
      `
      .test:not(.foo, .bar) {
        color: red;
      }
      `,
      {
        safari: 11 << 16,
      },
    );

    minify_test("a:lang(en) {color:red}", "a:lang(en){color:red}");
    minify_test("a:lang(en, fr) {color:red}", "a:lang(en,fr){color:red}");
    minify_test("a:lang('en') {color:red}", "a:lang(en){color:red}");
    minify_test("a:-webkit-any(.foo, .bar) {color:red}", "a:-webkit-any(.foo,.bar){color:red}");
    minify_test("a:-moz-any(.foo, .bar) {color:red}", "a:-moz-any(.foo,.bar){color:red}");

    prefix_test(
      "a:is(.foo, .bar) {color:red}",
      `
      a:-webkit-any(.foo, .bar) {
        color: red;
      }

      a:-moz-any(.foo, .bar) {
        color: red;
      }

      a:is(.foo, .bar) {
        color: red;
      }
      `,
      {
        safari: 11 << 16,
        firefox: 50 << 16,
      },
    );

    prefix_test(
      "a:is(.foo > .bar) {color:red}",
      `
      a:is(.foo > .bar) {
        color: red;
      }
      `,
      {
        safari: 11 << 16,
        firefox: 50 << 16,
      },
    );

    prefix_test(
      "a:lang(en, fr) {color:red}",
      `
      a:-webkit-any(:lang(en), :lang(fr)) {
        color: red;
      }

      a:-moz-any(:lang(en), :lang(fr)) {
        color: red;
      }

      a:is(:lang(en), :lang(fr)) {
        color: red;
      }
      `,
      {
        safari: 11 << 16,
        firefox: 50 << 16,
      },
    );

    prefix_test(
      "a:lang(en, fr) {color:red}",
      `
      a:is(:lang(en), :lang(fr)) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
        firefox: 88 << 16,
      },
    );

    prefix_test(
      "a:lang(en, fr) {color:red}",
      `
      a:lang(en, fr) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:dir(rtl) {color:red}",
      `
      a:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        color: red;
      }

      a:-moz-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        color: red;
      }

      a:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        color: red;
      }
      `,
      {
        safari: 11 << 16,
        firefox: 50 << 16,
      },
    );

    prefix_test(
      "a:dir(ltr) {color:red}",
      `
      a:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        color: red;
      }

      a:not(:-moz-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        color: red;
      }

      a:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        color: red;
      }
      `,
      {
        safari: 11 << 16,
        firefox: 50 << 16,
      },
    );

    prefix_test(
      "a:dir(rtl) {color:red}",
      `
      a:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
        firefox: 88 << 16,
      },
    );

    prefix_test(
      "a:dir(ltr) {color:red}",
      `
      a:not(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
        firefox: 88 << 16,
      },
    );

    prefix_test(
      "a:dir(rtl) {color:red}",
      `
      a:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:dir(ltr) {color:red}",
      `
      a:not(:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi)) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:is(:dir(rtl)) {color:red}",
      `
      a:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:where(:dir(rtl)) {color:red}",
      `
      a:where(:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi)) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:has(:dir(rtl)) {color:red}",
      `
      a:has(:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi)) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:not(:dir(rtl)) {color:red}",
      `
      a:not(:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi)) {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:dir(rtl)::after {color:red}",
      `
      a:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi):after {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    prefix_test(
      "a:dir(rtl) div {color:red}",
      `
      a:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi) div {
        color: red;
      }
      `,
      {
        safari: 14 << 16,
      },
    );

    minify_test(".foo::cue {color: red}", ".foo::cue{color:red}");
    minify_test(".foo::cue-region {color: red}", ".foo::cue-region{color:red}");
    minify_test(".foo::cue(b) {color: red}", ".foo::cue(b){color:red}");
    minify_test(".foo::cue-region(b) {color: red}", ".foo::cue-region(b){color:red}");
    minify_test("::cue(v[voice='active']) {color: yellow;}", "::cue(v[voice=active]){color:#ff0}");
    minify_test(":foo(bar) { color: yellow }", ":foo(bar){color:#ff0}");
    minify_test("::foo(bar) { color: yellow }", "::foo(bar){color:#ff0}");
    minify_test("::foo(*) { color: yellow }", "::foo(*){color:#ff0}");

    minify_test(":is(.foo) { color: yellow }", ".foo{color:#ff0}");
    minify_test(":is(#foo) { color: yellow }", "#foo{color:#ff0}");
    minify_test("a:is(.foo) { color: yellow }", "a.foo{color:#ff0}");
    minify_test("a:is([data-test]) { color: yellow }", "a[data-test]{color:#ff0}");
    minify_test(".foo:is(a) { color: yellow }", ".foo:is(a){color:#ff0}");
    minify_test(".foo:is(*|a) { color: yellow }", ".foo:is(*|a){color:#ff0}");
    minify_test(".foo:is(*) { color: yellow }", ".foo:is(*){color:#ff0}");
    minify_test(
      "@namespace svg url(http://www.w3.org/2000/svg); .foo:is(svg|a) { color: yellow }",
      '@namespace svg "http://www.w3.org/2000/svg";.foo:is(svg|a){color:#ff0}',
    );
    minify_test("a:is(.foo .bar) { color: yellow }", "a:is(.foo .bar){color:#ff0}");
    minify_test(":is(.foo, .bar) { color: yellow }", ":is(.foo,.bar){color:#ff0}");
    minify_test("a:is(:not(.foo)) { color: yellow }", "a:not(.foo){color:#ff0}");
    minify_test("a:is(:first-child) { color: yellow }", "a:first-child{color:#ff0}");
    minify_test("a:is(:has(.foo)) { color: yellow }", "a:has(.foo){color:#ff0}");
    minify_test("a:is(:is(.foo)) { color: yellow }", "a.foo{color:#ff0}");
    minify_test(":host(:hover) {color: red}", ":host(:hover){color:red}");
    minify_test("::slotted(:hover) {color: red}", "::slotted(:hover){color:red}");

    minify_test(":root::view-transition {position: fixed}", ":root::view-transition{position:fixed}");

    for (const name of [
      "view-transition-group",
      "view-transition-image-pair",
      "view-transition-new",
      "view-transition-old",
    ]) {
      minify_test(`:root::${name}(*) {position: fixed}`, `:root::${name}(*){position:fixed}`);
      minify_test(`:root::${name}(foo) {position: fixed}`, `:root::${name}(foo){position:fixed}`);
      minify_test(`:root::${name}(foo):only-child {position: fixed}`, `:root::${name}(foo):only-child{position:fixed}`);
      error_test(
        `:root::${name}(foo):first-child {position: fixed}`,
        "ParserError::SelectorError(SelectorError::InvalidPseudoClassAfterPseudoElement)",
      );
      error_test(
        `:root::${name}(foo)::before {position: fixed}`,
        "ParserError::SelectorError(SelectorError::InvalidState)",
      );
    }

    minify_test(".foo ::deep .bar {width: 20px}", ".foo ::deep .bar{width:20px}");
    minify_test(".foo::deep .bar {width: 20px}", ".foo::deep .bar{width:20px}");
    minify_test(".foo ::deep.bar {width: 20px}", ".foo ::deep.bar{width:20px}");
    minify_test(".foo ::unknown .bar {width: 20px}", ".foo ::unknown .bar{width:20px}");
    minify_test(".foo ::unknown(foo) .bar {width: 20px}", ".foo ::unknown(foo) .bar{width:20px}");
    minify_test(".foo ::unknown:only-child {width: 20px}", ".foo ::unknown:only-child{width:20px}");
    minify_test(".foo ::unknown(.foo) .bar {width: 20px}", ".foo ::unknown(.foo) .bar{width:20px}");
    minify_test(
      ".foo ::unknown(.foo .bar / .baz) .bar {width: 20px}",
      ".foo ::unknown(.foo .bar / .baz) .bar{width:20px}",
    );
    minify_test(".foo ::unknown(something(foo)) .bar {width: 20px}", ".foo ::unknown(something(foo)) .bar{width:20px}");
    minify_test(".foo ::unknown([abc]) .bar {width: 20px}", ".foo ::unknown([abc]) .bar{width:20px}");

    let deep_options: ParserOptions = {
      flags: [ParserFlags.DEEP_SELECTOR_COMBINATOR],
    };

    error_test(".foo >>> .bar {width: 20px}", "ParserError::SelectorError(SelectorError::DanglingCombinator)");
    error_test(".foo /deep/ .bar {width: 20px}", "ParserError::SelectorError(SelectorError::DanglingCombinator)");
    minify_test_with_options(".foo >>> .bar {width: 20px}", ".foo>>>.bar{width:20px}", deep_options);
    minify_test_with_options(".foo /deep/ .bar {width: 20px}", ".foo /deep/ .bar{width:20px}", deep_options);

    let pure_css_module_options: ParserOptions = {
      css_modules: {
        pure: true,
      },
    };

    minify_error_test_with_options(
      "div {width: 20px}",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_error_test_with_options(
      ":global(.foo) {width: 20px}",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_error_test_with_options(
      "[foo=bar] {width: 20px}",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_error_test_with_options(
      "div, .foo {width: 20px}",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_test_with_options(":local(.foo) {width: 20px}", "._8Z4fiW_foo{width:20px}", pure_css_module_options);
    minify_test_with_options("div.my-class {color: red;}", "div._8Z4fiW_my-class{color:red}", pure_css_module_options);
    minify_test_with_options("#id {color: red;}", "#_8Z4fiW_id{color:red}", pure_css_module_options);
    minify_test_with_options("a .my-class{color: red;}", "a ._8Z4fiW_my-class{color:red}", pure_css_module_options);
    minify_test_with_options(".my-class a {color: red;}", "._8Z4fiW_my-class a{color:red}", pure_css_module_options);
    minify_test_with_options(
      ".my-class:is(a) {color: red;}",
      "._8Z4fiW_my-class:is(a){color:red}",
      pure_css_module_options,
    );
    minify_test_with_options(
      "div:has(.my-class) {color: red;}",
      "div:has(._8Z4fiW_my-class){color:red}",
      pure_css_module_options,
    );
    minify_test_with_options(
      ".foo { html &:hover { a_value: some-value; } }",
      "._8Z4fiW_foo{html &:hover{a_value:some-value}}",
      pure_css_module_options,
    );
    minify_test_with_options(
      ".foo { span { color: red; } }",
      "._8Z4fiW_foo{& span{color:red}}",
      pure_css_module_options,
    );
    minify_error_test_with_options(
      "html { .foo { span { color: red; } } }",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_test_with_options(
      ".foo { div { span { color: red; } } }",
      "._8Z4fiW_foo{& div{& span{color:red}}}",
      pure_css_module_options,
    );
    minify_error_test_with_options(
      "@scope (div) { .foo { color: red } }",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_error_test_with_options(
      "@scope (.a) to (div) { .foo { color: red } }",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_error_test_with_options(
      "@scope (.a) to (.b) { div { color: red } }",
      "MinifyErrorKind::ImpureCSSModuleSelector",
      pure_css_module_options,
    );
    minify_test_with_options(
      "@scope (.a) to (.b) { .foo { color: red } }",
      "@scope(._8Z4fiW_a) to (._8Z4fiW_b){._8Z4fiW_foo{color:red}}",
      pure_css_module_options,
    );

    error_test(
      "input.defaultCheckbox::before h1 {width: 20px}",
      `
      ParserError::SelectorError(SelectorError::UnexpectedSelectorAfterPseudoElement(Token::Ident(
        "h1".into(),
      ))),
`,
    );
    error_test(
      "input.defaultCheckbox::before .my-class {width: 20px}",
      "ParserError::SelectorError(SelectorError::UnexpectedSelectorAfterPseudoElement(Token::Delim('.')))",
    );
    error_test(
      "input.defaultCheckbox::before.my-class {width: 20px}",
      "ParserError::SelectorError(SelectorError::UnexpectedSelectorAfterPseudoElement(Token::Delim('.')))",
    );
    error_test(
      "input.defaultCheckbox::before #id {width: 20px}",
      `ParserError::SelectorError(SelectorError::UnexpectedSelectorAfterPseudoElement(Token::IDHash(
        "id".into(),
      )))`,
    );
    error_test(
      "input.defaultCheckbox::before#id {width: 20px}",
      `ParserError::SelectorError(SelectorError::UnexpectedSelectorAfterPseudoElement(Token::IDHash(
        "id".into(),
      )))`,
    );
    error_test(
      "input.defaultCheckbox::before [attr] {width: 20px}",
      `ParserError::SelectorError(SelectorError::UnexpectedSelectorAfterPseudoElement(
        Token::SquareBracketBlock,
      ))`,
    );
    error_test(
      "input.defaultCheckbox::before[attr] {width: 20px}",
      `ParserError::SelectorError(SelectorError::UnexpectedSelectorAfterPseudoElement(
        Token::SquareBracketBlock,
      ))`,
    );
  });

  describe("media", () => {
    minify_test(
      "@media (min-width: 240px) { .foo { color: chartreuse }}",
      "@media (width>=240px){.foo{color:#7fff00}}",
    );
    minify_test("@media (width < 240px) { .foo { color: chartreuse }}", "@media (width<240px){.foo{color:#7fff00}}");
    minify_test("@media (width <= 240px) { .foo { color: chartreuse }}", "@media (width<=240px){.foo{color:#7fff00}}");
    minify_test("@media (width > 240px) { .foo { color: chartreuse }}", "@media (width>240px){.foo{color:#7fff00}}");
    minify_test("@media (width >= 240px) { .foo { color: chartreuse }}", "@media (width>=240px){.foo{color:#7fff00}}");
    minify_test("@media (240px < width) { .foo { color: chartreuse }}", "@media (width>240px){.foo{color:#7fff00}}");
    minify_test("@media (240px <= width) { .foo { color: chartreuse }}", "@media (width>=240px){.foo{color:#7fff00}}");
    minify_test("@media (240px > width) { .foo { color: chartreuse }}", "@media (width<240px){.foo{color:#7fff00}}");
    minify_test("@media (240px >= width) { .foo { color: chartreuse }}", "@media (width<=240px){.foo{color:#7fff00}}");
    minify_test(
      "@media (100px < width < 200px) { .foo { color: chartreuse }}",
      "@media (100px<width<200px){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (100px <= width <= 200px) { .foo { color: chartreuse }}",
      "@media (100px<=width<=200px){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (min-width: 30em) and (max-width: 50em) { .foo { color: chartreuse }}",
      "@media (width>=30em) and (width<=50em){.foo{color:#7fff00}}",
    );
    minify_test("@media screen, print { .foo { color: chartreuse }}", "@media screen,print{.foo{color:#7fff00}}");
    minify_test("@media (hover: hover) { .foo { color: chartreuse }}", "@media (hover:hover){.foo{color:#7fff00}}");
    minify_test("@media (hover) { .foo { color: chartreuse }}", "@media (hover){.foo{color:#7fff00}}");
    minify_test(
      "@media (aspect-ratio: 11/5) { .foo { color: chartreuse }}",
      "@media (aspect-ratio:11/5){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (aspect-ratio: 2/1) { .foo { color: chartreuse }}",
      "@media (aspect-ratio:2){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (aspect-ratio: 2) { .foo { color: chartreuse }}",
      "@media (aspect-ratio:2){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media not screen and (color) { .foo { color: chartreuse }}",
      "@media not screen and (color){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media only screen and (color) { .foo { color: chartreuse }}",
      "@media only screen and (color){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (update: slow) or (hover: none) { .foo { color: chartreuse }}",
      "@media (update:slow) or (hover:none){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (width < 600px) and (height < 600px) { .foo { color: chartreuse }}",
      "@media (width<600px) and (height<600px){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (not (color)) or (hover) { .foo { color: chartreuse }}",
      "@media (not (color)) or (hover){.foo{color:#7fff00}}",
    );
    error_test(
      "@media (example, all,), speech { .foo { color: chartreuse }}",
      "ParserError::UnexpectedToken(Token::Comma)",
    );
    error_test("@media &test, speech { .foo { color: chartreuse }}", "ParserError::UnexpectedToken(Token::Delim('&'))");
    error_test("@media &test { .foo { color: chartreuse }}", "ParserError::UnexpectedToken(Token::Delim('&'))");
    minify_test(
      "@media (min-width: calc(200px + 40px)) { .foo { color: chartreuse }}",
      "@media (width>=240px){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (min-width: calc(1em + 5px)) { .foo { color: chartreuse }}",
      "@media (width>=calc(1em + 5px)){.foo{color:#7fff00}}",
    );
    minify_test("@media { .foo { color: chartreuse }}", ".foo{color:#7fff00}");
    minify_test("@media all { .foo { color: chartreuse }}", ".foo{color:#7fff00}");
    minify_test(
      "@media not (((color) or (hover))) { .foo { color: chartreuse }}",
      "@media not ((color) or (hover)){.foo{color:#7fff00}}",
    );
    minify_test(
      "@media (hover) and ((color) and (test)) { .foo { color: chartreuse }}",
      "@media (hover) and (color) and (test){.foo{color:#7fff00}}",
    );
    minify_test("@media (grid: 1) { .foo { color: chartreuse }}", "@media (grid:1){.foo{color:#7fff00}}");
    minify_test(
      "@media (width >= calc(2px + 4px)) { .foo { color: chartreuse }}",
      "@media (width>=6px){.foo{color:#7fff00}}",
    );

    prefix_test(
      `
        @media (width >= 240px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (min-width: 240px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 60 << 16,
      },
    );

    prefix_test(
      `
        @media (width >= 240px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (width >= 240px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 64 << 16,
      },
    );

    prefix_test(
      `
        @media (color > 2) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (min-color: 3) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 60 << 16,
      },
    );

    prefix_test(
      `
        @media (color < 2) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (max-color: 1) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 60 << 16,
      },
    );

    prefix_test(
      `
        @media (width > 240px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (min-width: 240.001px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 60 << 16,
      },
    );

    prefix_test(
      `
        @media (width <= 240px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (max-width: 240px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 60 << 16,
      },
    );

    prefix_test(
      `
        @media (width <= 240px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (width <= 240px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 64 << 16,
      },
    );

    prefix_test(
      `
        @media (width < 240px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (max-width: 239.999px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 60 << 16,
      },
    );

    prefix_test(
      `
        @media (100px <= width <= 200px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (min-width: 100px) and (max-width: 200px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 85 << 16,
      },
    );

    prefix_test(
      `
        @media not (100px <= width <= 200px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media not ((min-width: 100px) and (max-width: 200px)) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 85 << 16,
      },
    );

    prefix_test(
      `
        @media (hover) and (100px <= width <= 200px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (hover) and (min-width: 100px) and (max-width: 200px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 85 << 16,
      },
    );

    prefix_test(
      `
        @media (hover) or (100px <= width <= 200px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (hover) or ((min-width: 100px) and (max-width: 200px)) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 85 << 16,
      },
    );

    prefix_test(
      `
        @media (100px < width < 200px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (min-width: 100.001px) and (max-width: 199.999px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 85 << 16,
      },
    );

    prefix_test(
      `
        @media (200px >= width >= 100px) {
          .foo {
            color: chartreuse;
          }
        }
      `,
      `
        @media (max-width: 200px) and (min-width: 100px) {
          .foo {
            color: #7fff00;
          }
        }
      `,
      {
        firefox: 85 << 16,
      },
    );

    cssTest(
      `
      @media not all {
        .a {
          color: green;
        }
      }
      `,
      "\n",
      undefined,
      false,
    );

    prefix_test(
      `
      @media (width > calc(1px + 1rem)) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (min-width: calc(1.001px + 1rem)) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        chrome: 85 << 16,
      },
    );
    prefix_test(
      `
      @media (width > max(10px, 1rem)) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (min-width: calc(max(10px, 1rem) + .001px)) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        chrome: 85 << 16,
      },
    );
    prefix_test(
      `
      @media (width > 0) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (min-width: .001px) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        chrome: 85 << 16,
      },
    );
    prefix_test(
      `
      @media (min-resolution: 2dppx) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 2dppx) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        safari: 15 << 16,
      },
      true,
    );
    prefix_test(
      `
      @media (min-resolution: 2dppx) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (min--moz-device-pixel-ratio: 2), (min-resolution: 2dppx) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        firefox: 10 << 16,
      },
      true,
    );
    prefix_test(
      `
      @media (resolution > 2dppx) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (-webkit-min-device-pixel-ratio: 2.001), (min-resolution: 2.001dppx) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        safari: 15 << 16,
      },
      true,
    );
    prefix_test(
      `
      @media (resolution >= 300dpi) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (-webkit-min-device-pixel-ratio: 3.125), (min-resolution: 300dpi) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        safari: 15 << 16,
      },
      true,
    );
    prefix_test(
      `
      @media (min-resolution: 113.38dpcm) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (-webkit-min-device-pixel-ratio: 2.99985), (min--moz-device-pixel-ratio: 2.99985), (min-resolution: 113.38dpcm) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        safari: 15 << 16,
        firefox: 10 << 16,
      },
      true,
    );
    prefix_test(
      `
      @media (color) and (min-resolution: 2dppx) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (color) and (-webkit-min-device-pixel-ratio: 2), (color) and (min-resolution: 2dppx) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        safari: 15 << 16,
      },
      true,
    );
    prefix_test(
      `
      @media (min-resolution: 2dppx),
             (min-resolution: 192dpi) {
        .foo { color: yellow; }
      }
      `,
      `
        @media (-webkit-min-device-pixel-ratio: 2), (min--moz-device-pixel-ratio: 2), (min-resolution: 2dppx), (min-resolution: 192dpi) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        safari: 15 << 16,
        firefox: 10 << 16,
      },
      true,
    );
    prefix_test(
      `
      @media only screen and (min-resolution: 124.8dpi) {
        .foo { color: yellow; }
      }
      `,
      `
        @media only screen and (-webkit-min-device-pixel-ratio: 1.3), only screen and (min--moz-device-pixel-ratio: 1.3), only screen and (min-resolution: 124.8dpi) {
          .foo {
            color: #ff0;
          }
        }
      `,
      {
        safari: 15 << 16,
        firefox: 10 << 16,
      },
      true,
    );

    error_test("@media (min-width: hi) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (width >= hi) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test(
      "@media (width >= 2/1) { .foo { color: chartreuse }}",
      "ParserError::UnexpectedToken(Token::Delim('/'))",
    );
    error_test("@media (600px <= min-height) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (scan >= 1) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (min-scan: interlace) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (1px <= width <= bar) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (1px <= min-width <= 2px) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (1px <= scan <= 2px) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (grid: 10) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
    error_test("@media (prefers-color-scheme = dark) { .foo { color: chartreuse }}", "ParserError::InvalidMediaQuery");
  });

  describe("transition", () => {
    minify_test(".foo { transition-duration: 500ms }", ".foo{transition-duration:.5s}");
    minify_test(".foo { transition-duration: .5s }", ".foo{transition-duration:.5s}");
    minify_test(".foo { transition-duration: 99ms }", ".foo{transition-duration:99ms}");
    minify_test(".foo { transition-duration: .099s }", ".foo{transition-duration:99ms}");
    minify_test(".foo { transition-duration: 2000ms }", ".foo{transition-duration:2s}");
    minify_test(".foo { transition-duration: 2s }", ".foo{transition-duration:2s}");
    minify_test(".foo { transition-duration: calc(1s - 50ms) }", ".foo{transition-duration:.95s}");
    minify_test(".foo { transition-duration: calc(1s - 50ms + 2s) }", ".foo{transition-duration:2.95s}");
    minify_test(".foo { transition-duration: calc((1s - 50ms) * 2) }", ".foo{transition-duration:1.9s}");
    minify_test(".foo { transition-duration: calc(2 * (1s - 50ms)) }", ".foo{transition-duration:1.9s}");
    minify_test(".foo { transition-duration: calc((2s + 50ms) - (1s - 50ms)) }", ".foo{transition-duration:1.1s}");
    minify_test(".foo { transition-duration: 500ms, 50ms }", ".foo{transition-duration:.5s,50ms}");
    minify_test(".foo { transition-delay: 500ms }", ".foo{transition-delay:.5s}");
    minify_test(".foo { transition-property: background }", ".foo{transition-property:background}");
    minify_test(".foo { transition-property: background, opacity }", ".foo{transition-property:background,opacity}");
    minify_test(".foo { transition-timing-function: linear }", ".foo{transition-timing-function:linear}");
    minify_test(".foo { transition-timing-function: ease }", ".foo{transition-timing-function:ease}");
    minify_test(".foo { transition-timing-function: ease-in }", ".foo{transition-timing-function:ease-in}");
    minify_test(".foo { transition-timing-function: ease-out }", ".foo{transition-timing-function:ease-out}");
    minify_test(".foo { transition-timing-function: ease-in-out }", ".foo{transition-timing-function:ease-in-out}");
    minify_test(
      ".foo { transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1) }",
      ".foo{transition-timing-function:ease}",
    );
    minify_test(
      ".foo { transition-timing-function: cubic-bezier(0.42, 0, 1, 1) }",
      ".foo{transition-timing-function:ease-in}",
    );
    minify_test(
      ".foo { transition-timing-function: cubic-bezier(0, 0, 0.58, 1) }",
      ".foo{transition-timing-function:ease-out}",
    );
    minify_test(
      ".foo { transition-timing-function: cubic-bezier(0.42, 0, 0.58, 1) }",
      ".foo{transition-timing-function:ease-in-out}",
    );
    minify_test(
      ".foo { transition-timing-function: cubic-bezier(0.58, 0.2, 0.11, 1.2) }",
      ".foo{transition-timing-function:cubic-bezier(.58,.2,.11,1.2)}",
    );
    minify_test(".foo { transition-timing-function: step-start }", ".foo{transition-timing-function:step-start}");
    minify_test(".foo { transition-timing-function: step-end }", ".foo{transition-timing-function:step-end}");
    minify_test(".foo { transition-timing-function: steps(1, start) }", ".foo{transition-timing-function:step-start}");
    minify_test(
      ".foo { transition-timing-function: steps(1, jump-start) }",
      ".foo{transition-timing-function:step-start}",
    );
    minify_test(".foo { transition-timing-function: steps(1, end) }", ".foo{transition-timing-function:step-end}");
    minify_test(".foo { transition-timing-function: steps(1, jump-end) }", ".foo{transition-timing-function:step-end}");
    minify_test(
      ".foo { transition-timing-function: steps(5, jump-start) }",
      ".foo{transition-timing-function:steps(5,start)}",
    );
    minify_test(
      ".foo { transition-timing-function: steps(5, jump-end) }",
      ".foo{transition-timing-function:steps(5,end)}",
    );
    minify_test(
      ".foo { transition-timing-function: steps(5, jump-both) }",
      ".foo{transition-timing-function:steps(5,jump-both)}",
    );
    minify_test(
      ".foo { transition-timing-function: ease-in-out, cubic-bezier(0.42, 0, 1, 1) }",
      ".foo{transition-timing-function:ease-in-out,ease-in}",
    );
    minify_test(
      ".foo { transition-timing-function: cubic-bezier(0.42, 0, 1, 1), cubic-bezier(0.58, 0.2, 0.11, 1.2) }",
      ".foo{transition-timing-function:ease-in,cubic-bezier(.58,.2,.11,1.2)}",
    );
    minify_test(
      ".foo { transition-timing-function: step-start, steps(5, jump-start) }",
      ".foo{transition-timing-function:step-start,steps(5,start)}",
    );
    minify_test(".foo { transition: width 2s ease }", ".foo{transition:width 2s}");
    minify_test(
      ".foo { transition: width 2s ease, height 1000ms cubic-bezier(0.25, 0.1, 0.25, 1) }",
      ".foo{transition:width 2s,height 1s}",
    );
    minify_test(".foo { transition: width 2s 1s }", ".foo{transition:width 2s 1s}");
    minify_test(".foo { transition: width 2s ease 1s }", ".foo{transition:width 2s 1s}");
    minify_test(".foo { transition: ease-in 1s width 4s }", ".foo{transition:width 1s ease-in 4s}");
    minify_test(".foo { transition: opacity 0s .6s }", ".foo{transition:opacity 0s .6s}");
    cssTest(
      `
      .foo {
        transition-property: opacity;
        transition-duration: 0.09s;
        transition-timing-function: ease-in-out;
        transition-delay: 500ms;
      }
    `,
      `
      .foo {
        transition: opacity 90ms ease-in-out .5s;
      }
    `,
    );
    cssTest(
      `
      .foo {
        transition: opacity 2s;
        transition-timing-function: ease;
        transition-delay: 500ms;
      }
    `,
      `
      .foo {
        transition: opacity 2s .5s;
      }
    `,
    );
    cssTest(
      `
      .foo {
        transition: opacity 500ms;
        transition-timing-function: var(--ease);
      }
    `,
      `
      .foo {
        transition: opacity .5s;
        transition-timing-function: var(--ease);
      }
    `,
    );
    cssTest(
      `
      .foo {
        transition-property: opacity;
        transition-duration: 0.09s;
        transition-timing-function: ease-in-out;
        transition-delay: 500ms;
        transition: color 2s;
      }
    `,
      `
      .foo {
        transition: color 2s;
      }
    `,
    );
    cssTest(
      `
      .foo {
        transition-property: opacity, color;
        transition-duration: 2s, 4s;
        transition-timing-function: ease-in-out, ease-in;
        transition-delay: 500ms, 0s;
      }
    `,
      `
      .foo {
        transition: opacity 2s ease-in-out .5s, color 4s ease-in;
      }
    `,
    );
    cssTest(
      `
      .foo {
        transition-property: opacity, color;
        transition-duration: 2s;
        transition-timing-function: ease-in-out;
        transition-delay: 500ms;
      }
    `,
      `
      .foo {
        transition: opacity 2s ease-in-out .5s, color 2s ease-in-out .5s;
      }
    `,
    );
    cssTest(
      `
      .foo {
        transition-property: opacity, color, width, height;
        transition-duration: 2s, 4s;
        transition-timing-function: ease;
        transition-delay: 0s;
      }
    `,
      `
      .foo {
        transition: opacity 2s, color 4s, width 2s, height 4s;
      }
    `,
    );

    cssTest(
      `
      .foo {
        -webkit-transition-property: opacity, color;
        -webkit-transition-duration: 2s, 4s;
        -webkit-transition-timing-function: ease-in-out, ease-in;
        -webkit-transition-delay: 500ms, 0s;
      }
    `,
      `
      .foo {
        -webkit-transition: opacity 2s ease-in-out .5s, color 4s ease-in;
      }
    `,
    );

    cssTest(
      `
      .foo {
        -webkit-transition-property: opacity, color;
        -webkit-transition-duration: 2s, 4s;
        -webkit-transition-timing-function: ease-in-out, ease-in;
        -webkit-transition-delay: 500ms, 0s;
        -moz-transition-property: opacity, color;
        -moz-transition-duration: 2s, 4s;
        -moz-transition-timing-function: ease-in-out, ease-in;
        -moz-transition-delay: 500ms, 0s;
        transition-property: opacity, color;
        transition-duration: 2s, 4s;
        transition-timing-function: ease-in-out, ease-in;
        transition-delay: 500ms, 0s;
      }
    `,
      `
      .foo {
        -webkit-transition: opacity 2s ease-in-out .5s, color 4s ease-in;
        -moz-transition: opacity 2s ease-in-out .5s, color 4s ease-in;
        transition: opacity 2s ease-in-out .5s, color 4s ease-in;
      }
    `,
    );

    cssTest(
      `
      .foo {
        -webkit-transition-property: opacity, color;
        -moz-transition-property: opacity, color;
        transition-property: opacity, color;
        -webkit-transition-duration: 2s, 4s;
        -moz-transition-duration: 2s, 4s;
        transition-duration: 2s, 4s;
        -webkit-transition-timing-function: ease-in-out, ease-in;
        transition-timing-function: ease-in-out, ease-in;
        -moz-transition-timing-function: ease-in-out, ease-in;
        -webkit-transition-delay: 500ms, 0s;
        -moz-transition-delay: 500ms, 0s;
        transition-delay: 500ms, 0s;
      }
    `,
      `
      .foo {
        -webkit-transition: opacity 2s ease-in-out .5s, color 4s ease-in;
        -moz-transition: opacity 2s ease-in-out .5s, color 4s ease-in;
        transition: opacity 2s ease-in-out .5s, color 4s ease-in;
      }
    `,
    );

    cssTest(
      `
      .foo {
        -webkit-transition-property: opacity;
        -moz-transition-property: color;
        transition-property: opacity, color;
        -webkit-transition-duration: 2s;
        -moz-transition-duration: 4s;
        transition-duration: 2s, 4s;
        -webkit-transition-timing-function: ease-in-out;
        -moz-transition-timing-function: ease-in-out;
        transition-timing-function: ease-in-out, ease-in;
        -webkit-transition-delay: 500ms;
        -moz-transition-delay: 0s;
        transition-delay: 500ms, 0s;
      }
    `,
      `
      .foo {
        -webkit-transition-property: opacity;
        -moz-transition-property: color;
        transition-property: opacity, color;
        -webkit-transition-duration: 2s;
        -moz-transition-duration: 4s;
        transition-duration: 2s, 4s;
        -webkit-transition-timing-function: ease-in-out;
        -moz-transition-timing-function: ease-in-out;
        -webkit-transition-delay: .5s;
        transition-timing-function: ease-in-out, ease-in;
        -moz-transition-delay: 0s;
        transition-delay: .5s, 0s;
      }
    `,
    );

    cssTest(
      `
      .foo {
        -webkit-transition-property: opacity;
        transition-property: opacity, color;
        -moz-transition-property: color;
        -webkit-transition-duration: 2s;
        transition-duration: 2s, 4s;
        -moz-transition-duration: 4s;
        -webkit-transition-timing-function: ease-in-out;
        transition-timing-function: ease-in-out, ease-in;
        -moz-transition-timing-function: ease-in-out;
        -webkit-transition-delay: 500ms;
        transition-delay: 500ms, 0s;
        -moz-transition-delay: 0s;
      }
    `,
      `
      .foo {
        -webkit-transition-property: opacity;
        transition-property: opacity, color;
        -moz-transition-property: color;
        -webkit-transition-duration: 2s;
        transition-duration: 2s, 4s;
        -moz-transition-duration: 4s;
        -webkit-transition-timing-function: ease-in-out;
        transition-timing-function: ease-in-out, ease-in;
        -webkit-transition-delay: .5s;
        -moz-transition-timing-function: ease-in-out;
        transition-delay: .5s, 0s;
        -moz-transition-delay: 0s;
      }
    `,
    );

    cssTest(
      `
      .foo {
        transition: opacity 2s;
        -webkit-transition-duration: 2s;
      }
    `,
      `
      .foo {
        transition: opacity 2s;
        -webkit-transition-duration: 2s;
      }
    `,
    );

    prefix_test(
      `
      .foo {
        transition-property: margin-inline-start;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition-property: margin-left;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition-property: margin-left;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition-property: margin-right;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition-property: margin-right;
      }
    `,
      {
        safari: Some(8 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition-property: margin-inline-start, padding-inline-start;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition-property: margin-left, padding-left;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition-property: margin-left, padding-left;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition-property: margin-right, padding-right;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition-property: margin-right, padding-right;
      }
    `,
      {
        safari: Some(8 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition-property: margin-inline-start, opacity, padding-inline-start, color;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition-property: margin-left, opacity, padding-left, color;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition-property: margin-left, opacity, padding-left, color;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition-property: margin-right, opacity, padding-right, color;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition-property: margin-right, opacity, padding-right, color;
      }
    `,
      {
        safari: Some(8 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition-property: margin-block;
      }
    `,
      `
      .foo {
        transition-property: margin-top, margin-bottom;
      }
    `,
      {
        safari: Some(8 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition: margin-inline-start 2s;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition: margin-left 2s;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition: margin-left 2s;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition: margin-right 2s;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition: margin-right 2s;
      }
    `,
      {
        safari: Some(8 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition: margin-inline-start 2s, padding-inline-start 2s;
      }
    `,
      `
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition: margin-left 2s, padding-left 2s;
      }

      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        transition: margin-left 2s, padding-left 2s;
      }

      .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition: margin-right 2s, padding-right 2s;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        transition: margin-right 2s, padding-right 2s;
      }
    `,
      {
        safari: Some(8 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition: margin-block-start 2s;
      }
    `,
      `
      .foo {
        transition: margin-top 2s;
      }
    `,
      {
        safari: Some(8 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition: transform;
      }
    `,
      `
      .foo {
        -webkit-transition: -webkit-transform, transform;
        transition: -webkit-transform, transform;
      }
    `,
      {
        safari: Some(6 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition: border-start-start-radius;
      }
    `,
      `
      .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        -webkit-transition: -webkit-border-top-left-radius, border-top-left-radius;
        transition: -webkit-border-top-left-radius, border-top-left-radius;
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        -webkit-transition: -webkit-border-top-right-radius, border-top-right-radius;
        transition: -webkit-border-top-right-radius, border-top-right-radius;
      }
    `,
      {
        safari: Some(4 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transition: border-start-start-radius;
      }
    `,
      `
      .foo:not(:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi)) {
        transition: border-top-left-radius;
      }

      .foo:lang(ae, ar, arc, bcc, bqi, ckb, dv, fa, glk, he, ku, mzn, nqo, pnb, ps, sd, ug, ur, yi) {
        transition: border-top-right-radius;
      }
    `,
      {
        safari: Some(12 << 16),
      },
    );

    cssTest(
      `
      .foo {
        -webkit-transition: background 200ms;
        -moz-transition: background 200ms;
        transition: background 230ms;
      }
    `,
      `
      .foo {
        -webkit-transition: background .2s;
        -moz-transition: background .2s;
        transition: background .23s;
      }
    `,
    );

    prefix_test(
      `
      .foo {
        -webkit-transition: background 200ms;
        -moz-transition: background 200ms;
        transition: background 230ms;
      }
    `,
      `
      .foo {
        -webkit-transition: background .2s;
        -moz-transition: background .2s;
        transition: background .23s;
      }
    `,
      {
        chrome: Some(95 << 16),
      },
    );
  });

  describe("transform", () => {
    minify_test(".foo { transform: translate(2px, 3px)", ".foo{transform:translate(2px,3px)}");
    minify_test(".foo { transform: translate(2px, 0px)", ".foo{transform:translate(2px)}");
    minify_test(".foo { transform: translate(0px, 2px)", ".foo{transform:translateY(2px)}");
    minify_test(".foo { transform: translateX(2px)", ".foo{transform:translate(2px)}");
    minify_test(".foo { transform: translateY(2px)", ".foo{transform:translateY(2px)}");
    minify_test(".foo { transform: translateZ(2px)", ".foo{transform:translateZ(2px)}");
    minify_test(".foo { transform: translate3d(2px, 3px, 4px)", ".foo{transform:translate3d(2px,3px,4px)}");
    minify_test(".foo { transform: translate3d(10%, 20%, 4px)", ".foo{transform:translate3d(10%,20%,4px)}");
    minify_test(".foo { transform: translate3d(2px, 0px, 0px)", ".foo{transform:translate(2px)}");
    minify_test(".foo { transform: translate3d(0px, 2px, 0px)", ".foo{transform:translateY(2px)}");
    minify_test(".foo { transform: translate3d(0px, 0px, 2px)", ".foo{transform:translateZ(2px)}");
    minify_test(".foo { transform: translate3d(2px, 3px, 0px)", ".foo{transform:translate(2px,3px)}");
    minify_test(".foo { transform: scale(2, 3)", ".foo{transform:scale(2,3)}");
    minify_test(".foo { transform: scale(10%, 20%)", ".foo{transform:scale(.1,.2)}");
    minify_test(".foo { transform: scale(2, 2)", ".foo{transform:scale(2)}");
    minify_test(".foo { transform: scale(2, 1)", ".foo{transform:scaleX(2)}");
    minify_test(".foo { transform: scale(1, 2)", ".foo{transform:scaleY(2)}");
    minify_test(".foo { transform: scaleX(2)", ".foo{transform:scaleX(2)}");
    minify_test(".foo { transform: scaleY(2)", ".foo{transform:scaleY(2)}");
    minify_test(".foo { transform: scaleZ(2)", ".foo{transform:scaleZ(2)}");
    minify_test(".foo { transform: scale3d(2, 3, 4)", ".foo{transform:scale3d(2,3,4)}");
    minify_test(".foo { transform: scale3d(2, 1, 1)", ".foo{transform:scaleX(2)}");
    minify_test(".foo { transform: scale3d(1, 2, 1)", ".foo{transform:scaleY(2)}");
    minify_test(".foo { transform: scale3d(1, 1, 2)", ".foo{transform:scaleZ(2)}");
    minify_test(".foo { transform: scale3d(2, 2, 1)", ".foo{transform:scale(2)}");
    minify_test(".foo { transform: rotate(20deg)", ".foo{transform:rotate(20deg)}");
    minify_test(".foo { transform: rotateX(20deg)", ".foo{transform:rotateX(20deg)}");
    minify_test(".foo { transform: rotateY(20deg)", ".foo{transform:rotateY(20deg)}");
    minify_test(".foo { transform: rotateZ(20deg)", ".foo{transform:rotate(20deg)}");
    minify_test(".foo { transform: rotate(360deg)", ".foo{transform:rotate(360deg)}");
    minify_test(".foo { transform: rotate3d(2, 3, 4, 20deg)", ".foo{transform:rotate3d(2,3,4,20deg)}");
    minify_test(".foo { transform: rotate3d(1, 0, 0, 20deg)", ".foo{transform:rotateX(20deg)}");
    minify_test(".foo { transform: rotate3d(0, 1, 0, 20deg)", ".foo{transform:rotateY(20deg)}");
    minify_test(".foo { transform: rotate3d(0, 0, 1, 20deg)", ".foo{transform:rotate(20deg)}");
    minify_test(".foo { transform: rotate(405deg)}", ".foo{transform:rotate(405deg)}");
    minify_test(".foo { transform: rotateX(405deg)}", ".foo{transform:rotateX(405deg)}");
    minify_test(".foo { transform: rotateY(405deg)}", ".foo{transform:rotateY(405deg)}");
    minify_test(".foo { transform: rotate(-200deg)}", ".foo{transform:rotate(-200deg)}");
    minify_test(".foo { transform: rotate(0)", ".foo{transform:rotate(0)}");
    minify_test(".foo { transform: rotate(0deg)", ".foo{transform:rotate(0)}");
    minify_test(".foo { transform: rotateX(-200deg)}", ".foo{transform:rotateX(-200deg)}");
    minify_test(".foo { transform: rotateY(-200deg)}", ".foo{transform:rotateY(-200deg)}");
    minify_test(".foo { transform: rotate3d(1, 1, 0, -200deg)", ".foo{transform:rotate3d(1,1,0,-200deg)}");
    minify_test(".foo { transform: skew(20deg)", ".foo{transform:skew(20deg)}");
    minify_test(".foo { transform: skew(20deg, 0deg)", ".foo{transform:skew(20deg)}");
    minify_test(".foo { transform: skew(0deg, 20deg)", ".foo{transform:skewY(20deg)}");
    minify_test(".foo { transform: skewX(20deg)", ".foo{transform:skew(20deg)}");
    minify_test(".foo { transform: skewY(20deg)", ".foo{transform:skewY(20deg)}");
    minify_test(".foo { transform: perspective(10px)", ".foo{transform:perspective(10px)}");
    minify_test(".foo { transform: matrix(1, 2, -1, 1, 80, 80)", ".foo{transform:matrix(1,2,-1,1,80,80)}");
    minify_test(
      ".foo { transform: matrix3d(1, 0, 0, 0, 0, 1, 6, 0, 0, 0, 1, 0, 50, 100, 0, 1.1)",
      ".foo{transform:matrix3d(1,0,0,0,0,1,6,0,0,0,1,0,50,100,0,1.1)}",
    );
    // TODO: Re-enable with a better solution
    //       See: https://github.com/parcel-bundler/lightningcss/issues/288
    // minify_test(
    //   ".foo{transform:translate(100px,200px) rotate(45deg) skew(10deg) scale(2)}",
    //   ".foo{transform:matrix(1.41421,1.41421,-1.16485,1.66358,100,200)}",
    // );
    // minify_test(
    //   ".foo{transform:translate(200px,300px) translate(100px,200px) scale(2)}",
    //   ".foo{transform:matrix(2,0,0,2,300,500)}",
    // );
    minify_test(
      ".foo{transform:translate(100px,200px) rotate(45deg)}",
      ".foo{transform:translate(100px,200px)rotate(45deg)}",
    );
    minify_test(
      ".foo{transform:rotate3d(1, 1, 1, 45deg) translate3d(100px, 100px, 10px)}",
      ".foo{transform:rotate3d(1,1,1,45deg)translate3d(100px,100px,10px)}",
    );
    // TODO: Re-enable with a better solution
    //       See: https://github.com/parcel-bundler/lightningcss/issues/288
    // minify_test(
    //   ".foo{transform:translate3d(100px, 100px, 10px) skew(10deg) scale3d(2, 3, 4)}",
    //   ".foo{transform:matrix3d(2,0,0,0,.528981,3,0,0,0,0,4,0,100,100,10,1)}",
    // );
    // minify_test(
    //   ".foo{transform:matrix3d(0.804737854124365, 0.5058793634016805, -0.31061721752604554, 0, -0.31061721752604554, 0.804737854124365, 0.5058793634016805, 0, 0.5058793634016805, -0.31061721752604554, 0.804737854124365, 0, 100, 100, 10, 1)}",
    //   ".foo{transform:translate3d(100px,100px,10px)rotate3d(1,1,1,45deg)}"
    // );
    // minify_test(
    //   ".foo{transform:matrix3d(1, 0, 0, 0, 0, 0.7071067811865476, 0.7071067811865475, 0, 0, -0.7071067811865475, 0.7071067811865476, 0, 100, 100, 10, 1)}",
    //   ".foo{transform:translate3d(100px,100px,10px)rotateX(45deg)}"
    // );
    // minify_test(
    //   ".foo{transform:translate3d(100px, 200px, 10px) translate(100px, 100px)}",
    //   ".foo{transform:translate3d(200px,300px,10px)}",
    // );
    // minify_test(
    //   ".foo{transform:rotate(45deg) rotate(45deg)}",
    //   ".foo{transform:rotate(90deg)}",
    // );
    // minify_test(
    //   ".foo{transform:matrix(0.7071067811865476, 0.7071067811865475, -0.7071067811865475, 0.7071067811865476, 100, 100)}",
    //   ".foo{transform:translate(100px,100px)rotate(45deg)}"
    // );
    // minify_test(
    //   ".foo{transform:translateX(2in) translateX(50px)}",
    //   ".foo{transform:translate(242px)}",
    // );
    minify_test(".foo{transform:translateX(calc(2in + 50px))}", ".foo{transform:translate(242px)}");
    minify_test(".foo{transform:translateX(50%)}", ".foo{transform:translate(50%)}");
    minify_test(".foo{transform:translateX(calc(50% - 100px + 20px))}", ".foo{transform:translate(calc(50% - 80px))}");
    minify_test(".foo{transform:rotate(calc(10deg + 20deg))}", ".foo{transform:rotate(30deg)}");
    minify_test(".foo{transform:rotate(calc(10deg + 0.349066rad))}", ".foo{transform:rotate(30deg)}");
    minify_test(".foo{transform:rotate(calc(10deg + 1.5turn))}", ".foo{transform:rotate(550deg)}");
    minify_test(".foo{transform:rotate(calc(10deg * 2))}", ".foo{transform:rotate(20deg)}");
    minify_test(".foo{transform:rotate(calc(-10deg * 2))}", ".foo{transform:rotate(-20deg)}");
    minify_test(
      ".foo{transform:rotate(calc(10deg + var(--test)))}",
      ".foo{transform:rotate(calc(10deg + var(--test)))}",
    );
    minify_test(".foo { transform: scale(calc(10% + 20%))", ".foo{transform:scale(.3)}");
    minify_test(".foo { transform: scale(calc(.1 + .2))", ".foo{transform:scale(.3)}");

    minify_test(".foo { -webkit-transform: scale(calc(10% + 20%))", ".foo{-webkit-transform:scale(.3)}");

    minify_test(".foo { translate: 1px 2px 3px }", ".foo{translate:1px 2px 3px}");
    minify_test(".foo { translate: 1px 0px 0px }", ".foo{translate:1px}");
    minify_test(".foo { translate: 1px 2px 0px }", ".foo{translate:1px 2px}");
    minify_test(".foo { translate: 1px 0px 2px }", ".foo{translate:1px 0 2px}");
    minify_test(".foo { translate: none }", ".foo{translate:none}");
    minify_test(".foo { rotate: 10deg }", ".foo{rotate:10deg}");
    minify_test(".foo { rotate: z 10deg }", ".foo{rotate:10deg}");
    minify_test(".foo { rotate: 0 0 1 10deg }", ".foo{rotate:10deg}");
    minify_test(".foo { rotate: x 10deg }", ".foo{rotate:x 10deg}");
    minify_test(".foo { rotate: 1 0 0 10deg }", ".foo{rotate:x 10deg}");
    minify_test(".foo { rotate: y 10deg }", ".foo{rotate:y 10deg}");
    minify_test(".foo { rotate: 0 1 0 10deg }", ".foo{rotate:y 10deg}");
    minify_test(".foo { rotate: 1 1 1 10deg }", ".foo{rotate:1 1 1 10deg}");
    minify_test(".foo { rotate: 0 0 1 0deg }", ".foo{rotate:none}");
    minify_test(".foo { rotate: none }", ".foo{rotate:none}");
    minify_test(".foo { scale: 1 }", ".foo{scale:1}");
    minify_test(".foo { scale: 1 1 }", ".foo{scale:1}");
    minify_test(".foo { scale: 1 1 1 }", ".foo{scale:1}");
    minify_test(".foo { scale: none }", ".foo{scale:none}");
    minify_test(".foo { scale: 1 0 }", ".foo{scale:1 0}");
    minify_test(".foo { scale: 1 0 1 }", ".foo{scale:1 0}");
    minify_test(".foo { scale: 1 0 0 }", ".foo{scale:1 0 0}");

    // TODO: Re-enable with a better solution
    //       See: https://github.com/parcel-bundler/lightningcss/issues/288
    // minify_test(".foo { transform: scale(3); scale: 0.5 }", ".foo{transform:scale(1.5)}");
    minify_test(".foo { scale: 0.5; transform: scale(3); }", ".foo{transform:scale(3)}");

    prefix_test(
      `
      .foo {
        transform: scale(0.5);
      }
    `,
      `
      .foo {
        -webkit-transform: scale(.5);
        -moz-transform: scale(.5);
        transform: scale(.5);
      }
    `,
      {
        firefox: Some(6 << 16),
        safari: Some(6 << 16),
      },
    );

    prefix_test(
      `
      .foo {
        transform: var(--transform);
      }
    `,
      `
      .foo {
        -webkit-transform: var(--transform);
        -moz-transform: var(--transform);
        transform: var(--transform);
      }
    `,
      {
        firefox: Some(6 << 16),
        safari: Some(6 << 16),
      },
    );

    cssTest(
      `
      .foo {
        transform: translateX(-50%);
        transform: translateX(20px);
      }
      `,
      `
      .foo {
        transform: translateX(20px);
      }
      `,
    );
  });
});
