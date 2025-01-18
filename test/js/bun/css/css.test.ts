/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, test } from "bun:test";
import "harness";
import { attrTest, cssTest, indoc, minify_test, minifyTest, prefix_test } from "./util";

describe("css tests", () => {
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
    minifyTest(
      // Problem: the value is being printed as Infinity in our restrict_prec thing but the internal thing actually wants it as 3.40282e38px
      `.rounded-full {
  border-radius: calc(infinity * 1px);
  width: calc(infinity * -1px);
}`,
      indoc`.rounded-full{border-radius:1e999px;width:-1e999px}`,
    );
  });
  describe("border_spacing", () => {
    minifyTest(
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
        border-left-color: color(display-p3 .6433075 .19245467 .1677117);
        border-left-color: lab(40% 56.6 39);
        border-right-color: #ee00be;
        border-right-color: color(display-p3 .9729615 -.36207756 .80420625);
        border-right-color: lch(50.998% 135.363 338);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left-color: #ee00be;
        border-left-color: color(display-p3 .9729615 -.36207756 .80420625);
        border-left-color: lch(50.998% 135.363 338);
        border-right-color: #b32323;
        border-right-color: color(display-p3 .6433075 .19245467 .1677117);
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

    minifyTest(".foo { aspect-ratio: auto }", ".foo{aspect-ratio:auto}");
    minifyTest(".foo { aspect-ratio: 2 / 3 }", ".foo{aspect-ratio:2/3}");
    minifyTest(".foo { aspect-ratio: auto 2 / 3 }", ".foo{aspect-ratio:auto 2/3}");
    minifyTest(".foo { aspect-ratio: 2 / 3 auto }", ".foo{aspect-ratio:auto 2/3}");
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

  describe("linear-gradient", () => {
    minifyTest(".foo { background: linear-gradient(yellow, blue) }", ".foo{background:linear-gradient(#ff0,#00f)}");
    minifyTest(
      ".foo { background: linear-gradient(to bottom, yellow, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(180deg, yellow, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(0.5turn, yellow, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow 10%, blue 20%) }",
      ".foo{background:linear-gradient(#ff0 10%,#00f 20%)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(to top, blue, yellow); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(to top, blue 10%, yellow 20%); }",
      ".foo{background:linear-gradient(#ff0 80%,#00f 90%)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(to top, blue 10px, yellow 20px); }",
      ".foo{background:linear-gradient(0deg,#00f 10px,#ff0 20px)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(135deg, yellow, blue); }",
      ".foo{background:linear-gradient(135deg,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, blue 20%, #0f0); }",
      ".foo{background:linear-gradient(#ff0,#00f 20%,#0f0)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(to top right, red, white, blue) }",
      ".foo{background:linear-gradient(to top right,red,#fff,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, blue calc(10% * 2), #0f0); }",
      ".foo{background:linear-gradient(#ff0,#00f 20%,#0f0)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, 20%, blue); }",
      ".foo{background:linear-gradient(#ff0,20%,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, 50%, blue); }",
      ".foo{background:linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, 20px, blue); }",
      ".foo{background:linear-gradient(#ff0,20px,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, 50px, blue); }",
      ".foo{background:linear-gradient(#ff0,50px,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, 50px, blue); }",
      ".foo{background:linear-gradient(#ff0,50px,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, red 30% 40%, blue); }",
      ".foo{background:linear-gradient(#ff0,red 30% 40%,#00f)}",
    );
    minifyTest(
      ".foo { background: linear-gradient(yellow, red 30%, red 40%, blue); }",
      ".foo{background:linear-gradient(#ff0,red 30% 40%,#00f)}",
    );
    minifyTest(".foo { background: linear-gradient(0, yellow, blue); }", ".foo{background:linear-gradient(#00f,#ff0)}");
    minifyTest(
      ".foo { background: -webkit-linear-gradient(yellow, blue) }",
      ".foo{background:-webkit-linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -webkit-linear-gradient(bottom, yellow, blue); }",
      ".foo{background:-webkit-linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -webkit-linear-gradient(top right, red, white, blue) }",
      ".foo{background:-webkit-linear-gradient(top right,red,#fff,#00f)}",
    );
    minifyTest(
      ".foo { background: -moz-linear-gradient(yellow, blue) }",
      ".foo{background:-moz-linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -moz-linear-gradient(bottom, yellow, blue); }",
      ".foo{background:-moz-linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -moz-linear-gradient(top right, red, white, blue) }",
      ".foo{background:-moz-linear-gradient(top right,red,#fff,#00f)}",
    );
    minifyTest(
      ".foo { background: -o-linear-gradient(yellow, blue) }",
      ".foo{background:-o-linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -o-linear-gradient(bottom, yellow, blue); }",
      ".foo{background:-o-linear-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -o-linear-gradient(top right, red, white, blue) }",
      ".foo{background:-o-linear-gradient(top right,red,#fff,#00f)}",
    );
    minifyTest(
      ".foo { background: -webkit-gradient(linear, left top, left bottom, from(blue), to(yellow)) }",
      ".foo{background:-webkit-gradient(linear,0 0,0 100%,from(#00f),to(#ff0))}",
    );
    minifyTest(
      ".foo { background: -webkit-gradient(linear, left top, left bottom, from(blue), color-stop(50%, red), to(yellow)) }",
      ".foo{background:-webkit-gradient(linear,0 0,0 100%,from(#00f),color-stop(.5,red),to(#ff0))}",
    );
    minifyTest(
      ".foo { background: -webkit-gradient(linear, left top, left bottom, color-stop(0%, blue), color-stop(50%, red), color-stop(100%, yellow)) }",
      ".foo{background:-webkit-gradient(linear,0 0,0 100%,from(#00f),color-stop(.5,red),to(#ff0))}",
    );
    minifyTest(
      ".foo { background: repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minifyTest(
      ".foo { background: -webkit-repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:-webkit-repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minifyTest(
      ".foo { background: -moz-repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:-moz-repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minifyTest(
      ".foo { background: -o-repeating-linear-gradient(yellow 10px, blue 50px) }",
      ".foo{background:-o-repeating-linear-gradient(#ff0 10px,#00f 50px)}",
    );
    minifyTest(".foo { background: radial-gradient(yellow, blue) }", ".foo{background:radial-gradient(#ff0,#00f)}");
    minifyTest(
      ".foo { background: radial-gradient(at top left, yellow, blue) }",
      ".foo{background:radial-gradient(at 0 0,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(5em circle at top left, yellow, blue) }",
      ".foo{background:radial-gradient(5em at 0 0,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(circle at 100%, #333, #333 50%, #eee 75%, #333 75%) }",
      ".foo{background:radial-gradient(circle at 100%,#333,#333 50%,#eee 75%,#333 75%)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(farthest-corner circle at 100% 50%, #333, #333 50%, #eee 75%, #333 75%) }",
      ".foo{background:radial-gradient(circle at 100%,#333,#333 50%,#eee 75%,#333 75%)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(farthest-corner circle at 50% 50%, #333, #333 50%, #eee 75%, #333 75%) }",
      ".foo{background:radial-gradient(circle,#333,#333 50%,#eee 75%,#333 75%)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(ellipse at top, #e66465, transparent) }",
      ".foo{background:radial-gradient(at top,#e66465,#0000)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(20px, yellow, blue) }",
      ".foo{background:radial-gradient(20px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:radial-gradient(20px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(20px 40px, yellow, blue) }",
      ".foo{background:radial-gradient(20px 40px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(ellipse 20px 40px, yellow, blue) }",
      ".foo{background:radial-gradient(20px 40px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(ellipse calc(20px + 10px) 40px, yellow, blue) }",
      ".foo{background:radial-gradient(30px 40px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(circle farthest-side, yellow, blue) }",
      ".foo{background:radial-gradient(circle farthest-side,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(farthest-side circle, yellow, blue) }",
      ".foo{background:radial-gradient(circle farthest-side,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(ellipse farthest-side, yellow, blue) }",
      ".foo{background:radial-gradient(farthest-side,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: radial-gradient(farthest-side ellipse, yellow, blue) }",
      ".foo{background:radial-gradient(farthest-side,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -webkit-radial-gradient(yellow, blue) }",
      ".foo{background:-webkit-radial-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -moz-radial-gradient(yellow, blue) }",
      ".foo{background:-moz-radial-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -o-radial-gradient(yellow, blue) }",
      ".foo{background:-o-radial-gradient(#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -webkit-repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:-webkit-repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -moz-repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:-moz-repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -o-repeating-radial-gradient(circle 20px, yellow, blue) }",
      ".foo{background:-o-repeating-radial-gradient(20px,#ff0,#00f)}",
    );
    minifyTest(
      ".foo { background: -webkit-gradient(radial, center center, 0, center center, 100, from(blue), to(yellow)) }",
      ".foo{background:-webkit-gradient(radial,50% 50%,0,50% 50%,100,from(#00f),to(#ff0))}",
    );
    minifyTest(".foo { background: conic-gradient(#f06, gold) }", ".foo{background:conic-gradient(#f06,gold)}");
    minifyTest(
      ".foo { background: conic-gradient(at 50% 50%, #f06, gold) }",
      ".foo{background:conic-gradient(#f06,gold)}",
    );
    minifyTest(
      ".foo { background: conic-gradient(from 0deg, #f06, gold) }",
      ".foo{background:conic-gradient(#f06,gold)}",
    );
    minifyTest(".foo { background: conic-gradient(from 0, #f06, gold) }", ".foo{background:conic-gradient(#f06,gold)}");
    minifyTest(
      ".foo { background: conic-gradient(from 0deg at center, #f06, gold) }",
      ".foo{background:conic-gradient(#f06,gold)}",
    );
    minifyTest(
      ".foo { background: conic-gradient(white -50%, black 150%) }",
      ".foo{background:conic-gradient(#fff -50%,#000 150%)}",
    );
    minifyTest(
      ".foo { background: conic-gradient(white -180deg, black 540deg) }",
      ".foo{background:conic-gradient(#fff -180deg,#000 540deg)}",
    );
    minifyTest(
      ".foo { background: conic-gradient(from 45deg, white, black, white) }",
      ".foo{background:conic-gradient(from 45deg,#fff,#000,#fff)}",
    );
    minifyTest(
      ".foo { background: repeating-conic-gradient(from 45deg, white, black, white) }",
      ".foo{background:repeating-conic-gradient(from 45deg,#fff,#000,#fff)}",
    );
    minifyTest(
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

    minifyTest(
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

    minifyTest(
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

    minifyTest(".foo { font: normal normal 600 9px/normal Charcoal; }", ".foo{font:600 9px Charcoal}");
    minifyTest(".foo { font: normal normal 500 medium/normal Charcoal; }", ".foo{font:500 medium Charcoal}");
    minifyTest(".foo { font: normal normal 400 medium Charcoal; }", ".foo{font:400 medium Charcoal}");
    minifyTest(".foo { font: normal normal 500 medium/10px Charcoal; }", ".foo{font:500 medium/10px Charcoal}");
    minifyTest(".foo { font-family: 'sans-serif'; }", '.foo{font-family:"sans-serif"}');
    minifyTest(".foo { font-family: sans-serif; }", ".foo{font-family:sans-serif}");
    minifyTest(".foo { font-family: 'default'; }", '.foo{font-family:"default"}');
    minifyTest(".foo { font-family: default; }", ".foo{font-family:default}");
    minifyTest(".foo { font-family: 'inherit'; }", '.foo{font-family:"inherit"}');
    minifyTest(".foo { font-family: inherit; }", ".foo{font-family:inherit}");
    minifyTest(".foo { font-family: inherit test; }", ".foo{font-family:inherit test}");
    minifyTest(".foo { font-family: 'inherit test'; }", ".foo{font-family:inherit test}");
    minifyTest(".foo { font-family: revert; }", ".foo{font-family:revert}");
    minifyTest(".foo { font-family: 'revert'; }", '.foo{font-family:"revert"}');
    minifyTest(".foo { font-family: revert-layer; }", ".foo{font-family:revert-layer}");
    minifyTest(".foo { font-family: revert-layer, serif; }", ".foo{font-family:revert-layer,serif}");
    minifyTest(".foo { font-family: 'revert', sans-serif; }", '.foo{font-family:"revert",sans-serif}');
    minifyTest(".foo { font-family: 'revert', foo, sans-serif; }", '.foo{font-family:"revert",foo,sans-serif}');
    minifyTest(".foo { font-family: ''; }", '.foo{font-family:""}');

    // font-family in @font-face
    minifyTest("@font-face { font-family: 'revert'; }", '@font-face{font-family:"revert"}');
    minifyTest("@font-face { font-family: 'revert-layer'; }", '@font-face{font-family:"revert-layer"}');

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
});
