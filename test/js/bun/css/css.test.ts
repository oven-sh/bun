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
    // cssTest(
    //   `
    //   .foo {
    //     border-left: 2px solid red;
    //     border-right: 2px solid red;
    //     border-bottom: 2px solid red;
    //     border-top: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 2px solid red;
    //   }
    // `,
    // );
    // TODO: this
    // cssTest(
    //   `
    //   .foo {
    //     border-left-color: red;
    //     border-right-color: red;
    //     border-bottom-color: red;
    //     border-top-color: red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-color: red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-left-width: thin;
    //     border-right-width: thin;
    //     border-bottom-width: thin;
    //     border-top-width: thin;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-width: thin;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-left-style: dotted;
    //     border-right-style: dotted;
    //     border-bottom-style: dotted;
    //     border-top-style: dotted;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-style: dotted;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-left-width: thin;
    //     border-left-style: dotted;
    //     border-left-color: red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-left: thin dotted red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-left-width: thick;
    //     border-left: thin dotted red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-left: thin dotted red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-left-width: thick;
    //     border: thin dotted red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: thin dotted red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border: thin dotted red;
    //     border-right-width: thick;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: thin dotted red;
    //     border-right-width: thick;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border: thin dotted red;
    //     border-right: thick dotted red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: thin dotted red;
    //     border-right-width: thick;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border: thin dotted red;
    //     border-right-width: thick;
    //     border-right-style: solid;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: thin dotted red;
    //     border-right: thick solid red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-top: thin dotted red;
    //     border-block-start: thick solid green;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-top: thin dotted red;
    //     border-block-start: thick solid green;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border: thin dotted red;
    //     border-block-start-width: thick;
    //     border-left-width: medium;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: thin dotted red;
    //     border-block-start-width: thick;
    //     border-left-width: medium;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: thin dotted red;
    //     border-inline-end: thin dotted red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-block-start: thin dotted red;
    //     border-inline-end: thin dotted red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start-width: thin;
    //     border-block-start-style: dotted;
    //     border-block-start-color: red;
    //     border-inline-end: thin dotted red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-block-start: thin dotted red;
    //     border-inline-end: thin dotted red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: thin dotted red;
    //     border-block-end: thin dotted red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-block: thin dotted red;
    //   }
    // `,
    // );
    // minifyTest(
    //   `
    //   .foo {
    //     border: none;
    //   }
    // `,
    //   `.foo{border:none}`,
    // );
    // minifyTest(".foo { border-width: 0 0 1px; }", ".foo{border-width:0 0 1px}");
    // cssTest(
    //   `
    //   .foo {
    //     border-block-width: 1px;
    //     border-inline-width: 1px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-width: 1px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start-width: 1px;
    //     border-block-end-width: 1px;
    //     border-inline-start-width: 1px;
    //     border-inline-end-width: 1px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-width: 1px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start-width: 1px;
    //     border-block-end-width: 1px;
    //     border-inline-start-width: 2px;
    //     border-inline-end-width: 2px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-block-width: 1px;
    //     border-inline-width: 2px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start-width: 1px;
    //     border-block-end-width: 1px;
    //     border-inline-start-width: 2px;
    //     border-inline-end-width: 3px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-block-width: 1px;
    //     border-inline-width: 2px 3px;
    //   }
    // `,
    // );
    // minifyTest(
    //   ".foo { border-bottom: 1px solid var(--spectrum-global-color-gray-200)}",
    //   ".foo{border-bottom:1px solid var(--spectrum-global-color-gray-200)}",
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-width: 0;
    //     border-bottom: var(--test, 1px) solid;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-width: 0;
    //     border-bottom: var(--test, 1px) solid;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border: 1px solid black;
    //     border-width: 1px 1px 0 0;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-width: 1px 1px 0 0;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-top: 1px solid black;
    //     border-bottom: 1px solid black;
    //     border-left: 2px solid black;
    //     border-right: 2px solid black;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-width: 1px 2px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-top: 1px solid black;
    //     border-bottom: 1px solid black;
    //     border-left: 2px solid black;
    //     border-right: 1px solid black;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-left-width: 2px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-top: 1px solid black;
    //     border-bottom: 1px solid black;
    //     border-left: 1px solid red;
    //     border-right: 1px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-color: #000 red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: 1px solid black;
    //     border-block-end: 1px solid black;
    //     border-inline-start: 1px solid red;
    //     border-inline-end: 1px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-inline-color: red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: 1px solid black;
    //     border-block-end: 1px solid black;
    //     border-inline-start: 2px solid black;
    //     border-inline-end: 2px solid black;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-inline-width: 2px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: 1px solid black;
    //     border-block-end: 1px solid black;
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-inline: 2px solid red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: 1px solid black;
    //     border-block-end: 1px solid black;
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 3px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid #000;
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 3px solid red;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: 2px solid black;
    //     border-block-end: 1px solid black;
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 2px solid red;
    //     border-block-start-color: #000;
    //     border-block-end: 1px solid #000;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: 2px solid red;
    //     border-block-end: 1px solid red;
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 2px solid red;
    //     border-block-end-width: 1px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border-block-start: 2px solid red;
    //     border-block-end: 2px solid red;
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 1px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 2px solid red;
    //     border-inline-end-width: 1px;
    //   }
    // `,
    // );
    // cssTest(
    //   `
    //   .foo {
    //     border: 1px solid currentColor;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border: 1px solid;
    //   }
    // `,
    // );
    // minifyTest(
    //   `
    //   .foo {
    //     border: 1px solid currentColor;
    //   }
    // `,
    //   ".foo{border:1px solid}",
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-block: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-top: 2px solid red;
    //     border-bottom: 2px solid red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-block-start: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-top: 2px solid red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-block-end: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-bottom: 2px solid red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-left: 2px solid red;
    //     border-right: 2px solid red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-block-width: 2px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-block-start-width: 2px;
    //     border-block-end-width: 2px;
    //   }
    // `,
    //   {
    //     safari: 13 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-block-width: 2px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-block-width: 2px;
    //   }
    // `,
    //   {
    //     safari: 15 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-start: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 2px solid red;
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 2px solid red;
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right: 2px solid red;
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right: 2px solid red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-start-width: 2px;
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left-width: 2px;
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left-width: 2px;
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right-width: 2px;
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right-width: 2px;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-end: 2px solid red;
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-right: 2px solid red;
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-right: 2px solid red;
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 2px solid red;
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 2px solid red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 5px solid green;
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 2px solid red;
    //     border-right: 5px solid green;
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 2px solid red;
    //     border-right: 5px solid green;
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 5px solid green;
    //     border-right: 2px solid red;
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 5px solid green;
    //     border-right: 2px solid red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-start: 2px solid red;
    //     border-inline-end: 5px solid green;
    //   }
    //   .bar {
    //     border-inline-start: 1px dotted gray;
    //     border-inline-end: 1px solid black;
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 2px solid red;
    //     border-right: 5px solid green;
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 2px solid red;
    //     border-right: 5px solid green;
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 5px solid green;
    //     border-right: 2px solid red;
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 5px solid green;
    //     border-right: 2px solid red;
    //   }
    //   .bar:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 1px dotted gray;
    //     border-right: 1px solid #000;
    //   }
    //   .bar:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: 1px dotted gray;
    //     border-right: 1px solid #000;
    //   }
    //   .bar:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 1px solid #000;
    //     border-right: 1px dotted gray;
    //   }
    //   .bar:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: 1px solid #000;
    //     border-right: 1px dotted gray;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-width: 2px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-left-width: 2px;
    //     border-right-width: 2px;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-width: 2px;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-left-width: 2px;
    //     border-right-width: 2px;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-style: solid;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-left-style: solid;
    //     border-right-style: solid;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-color: red;
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     border-left-color: red;
    //     border-right-color: red;
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-end: var(--test);
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-right: var(--test);
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-right: var(--test);
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: var(--test);
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left: var(--test);
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-start: var(--start);
    //     border-inline-end: var(--end);
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: var(--start);
    //     border-right: var(--end);
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left: var(--start);
    //     border-right: var(--end);
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right: var(--start);
    //     border-left: var(--end);
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right: var(--start);
    //     border-left: var(--end);
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // for (const prop of [
    //   "border-inline-start-color",
    //   "border-inline-end-color",
    //   "border-block-start-color",
    //   "border-block-end-color",
    //   "border-top-color",
    //   "border-bottom-color",
    //   "border-left-color",
    //   "border-right-color",
    //   "border-color",
    //   "border-block-color",
    //   "border-inline-color",
    // ]) {
    //   prefix_test(
    //     `
    //     .foo {
    //       ${prop}: lab(40% 56.6 39);
    //     }
    //   `,
    //     indoc`
    //     .foo {
    //       ${prop}: #b32323;
    //       ${prop}: lab(40% 56.6 39);
    //     }
    //   `,
    //     {
    //       chrome: 90 << 16,
    //     },
    //   );
    // }
    // for (const prop of [
    //   "border",
    //   "border-inline",
    //   "border-block",
    //   "border-left",
    //   "border-right",
    //   "border-top",
    //   "border-bottom",
    //   "border-block-start",
    //   "border-block-end",
    //   "border-inline-start",
    //   "border-inline-end",
    // ]) {
    //   prefix_test(
    //     `
    //     .foo {
    //       ${prop}: 2px solid lab(40% 56.6 39);
    //     }
    //   `,
    //     indoc`
    //     .foo {
    //       ${prop}: 2px solid #b32323;
    //       ${prop}: 2px solid lab(40% 56.6 39);
    //     }
    //   `,
    //     {
    //       chrome: 90 << 16,
    //     },
    //   );
    // }
    // for (const prop of [
    //   "border",
    //   "border-inline",
    //   "border-block",
    //   "border-left",
    //   "border-right",
    //   "border-top",
    //   "border-bottom",
    //   "border-block-start",
    //   "border-block-end",
    //   "border-inline-start",
    //   "border-inline-end",
    // ]) {
    //   prefix_test(
    //     `
    //     .foo {
    //       ${prop}: var(--border-width) solid lab(40% 56.6 39);
    //     }
    //   `,
    //     indoc`
    //     .foo {
    //       ${prop}: var(--border-width) solid #b32323;
    //     }
    //     @supports (color: lab(0% 0 0)) {
    //       .foo {
    //         ${prop}: var(--border-width) solid lab(40% 56.6 39);
    //       }
    //     }
    //   `,
    //     {
    //       chrome: 90 << 16,
    //     },
    //   );
    // }
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-start-color: lab(40% 56.6 39);
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left-color: #b32323;
    //     border-left-color: lab(40% 56.6 39);
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left-color: #b32323;
    //     border-left-color: lab(40% 56.6 39);
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right-color: #b32323;
    //     border-right-color: lab(40% 56.6 39);
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-right-color: #b32323;
    //     border-right-color: lab(40% 56.6 39);
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-end-color: lab(40% 56.6 39);
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-right-color: #b32323;
    //     border-right-color: lab(40% 56.6 39);
    //   }
    //   .foo:not(:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-right-color: #b32323;
    //     border-right-color: lab(40% 56.6 39);
    //   }
    //   .foo:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left-color: #b32323;
    //     border-left-color: lab(40% 56.6 39);
    //   }
    //   .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
    //     border-left-color: #b32323;
    //     border-left-color: lab(40% 56.6 39);
    //   }
    // `,
    //   {
    //     safari: 8 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     border-inline-start-color: lab(40% 56.6 39);
    //     border-inline-end-color: lch(50.998% 135.363 338);
    //   }
    // `,
    //   indoc`
    //   .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
    //     border-left-color: #b32323;
    //     border-left-color: lab(40% 56.6 39);
    //     border-right-color: #ee00be;
    //     border-right-color: lch(50.998% 135.363 338);
    //   }`,
    //   {
    //     chrome: 8 << 16,
    //     safari: 14 << 16,
    //   },
    // );
  });

  describe("color", () => {
    minifyTest(".foo { color: yellow }", ".foo{color:#ff0}");
    minifyTest(".foo { color: rgb(255, 255, 0) }", ".foo{color:#ff0}");
    minifyTest(".foo { color: rgba(255, 255, 0, 1) }", ".foo{color:#ff0}");
    minifyTest(".foo { color: rgba(255, 255, 0, 0.8) }", ".foo{color:#ff0c}");
    minifyTest(".foo { color: rgb(128, 128, 128) }", ".foo{color:gray}");
    minifyTest(".foo { color: rgb(123, 255, 255) }", ".foo{color:#7bffff}");
    minifyTest(".foo { color: rgba(123, 255, 255, 0.5) }", ".foo{color:#7bffff80}");
    minifyTest(".foo { color: rgb(123 255 255) }", ".foo{color:#7bffff}");
    minifyTest(".foo { color: rgb(123 255 255 / .5) }", ".foo{color:#7bffff80}");
    minifyTest(".foo { color: rgb(123 255 255 / 50%) }", ".foo{color:#7bffff80}");
    minifyTest(".foo { color: rgb(48% 100% 100% / 50%) }", ".foo{color:#7affff80}");
    minifyTest(".foo { color: hsl(100deg, 100%, 50%) }", ".foo{color:#5f0}");
    minifyTest(".foo { color: hsl(100, 100%, 50%) }", ".foo{color:#5f0}");
    minifyTest(".foo { color: hsl(100 100% 50%) }", ".foo{color:#5f0}");
    minifyTest(".foo { color: hsl(100, 100%, 50%, .8) }", ".foo{color:#5f0c}");
    minifyTest(".foo { color: hsl(100 100% 50% / .8) }", ".foo{color:#5f0c}");
    minifyTest(".foo { color: hsla(100, 100%, 50%, .8) }", ".foo{color:#5f0c}");
    minifyTest(".foo { color: hsla(100 100% 50% / .8) }", ".foo{color:#5f0c}");
    minifyTest(".foo { color: transparent }", ".foo{color:#0000}");
    minifyTest(".foo { color: currentColor }", ".foo{color:currentColor}");
    minifyTest(".foo { color: ButtonBorder }", ".foo{color:buttonborder}");
    minifyTest(".foo { color: hwb(194 0% 0%) }", ".foo{color:#00c4ff}");
    minifyTest(".foo { color: hwb(194 0% 0% / 50%) }", ".foo{color:#00c4ff80}");
    minifyTest(".foo { color: hwb(194 0% 50%) }", ".foo{color:#006280}");
    minifyTest(".foo { color: hwb(194 50% 0%) }", ".foo{color:#80e1ff}");
    minifyTest(".foo { color: hwb(194 50% 50%) }", ".foo{color:gray}");
    minifyTest(".foo { color: lab(29.2345% 39.3825 20.0664); }", ".foo{color:lab(29.2345% 39.3825 20.0664)}");
    minifyTest(".foo { color: lab(29.2345% 39.3825 20.0664 / 100%); }", ".foo{color:lab(29.2345% 39.3825 20.0664)}");
    minifyTest(".foo { color: lab(29.2345% 39.3825 20.0664 / 50%); }", ".foo{color:lab(29.2345% 39.3825 20.0664/.5)}");
    minifyTest(".foo { color: lch(29.2345% 44.2 27); }", ".foo{color:lch(29.2345% 44.2 27)}");
    minifyTest(".foo { color: lch(29.2345% 44.2 45deg); }", ".foo{color:lch(29.2345% 44.2 45)}");
    minifyTest(".foo { color: lch(29.2345% 44.2 .5turn); }", ".foo{color:lch(29.2345% 44.2 180)}");
    minifyTest(".foo { color: lch(29.2345% 44.2 27 / 100%); }", ".foo{color:lch(29.2345% 44.2 27)}");
    minifyTest(".foo { color: lch(29.2345% 44.2 27 / 50%); }", ".foo{color:lch(29.2345% 44.2 27/.5)}");
    minifyTest(".foo { color: oklab(40.101% 0.1147 0.0453); }", ".foo{color:oklab(40.101% .1147 .0453)}");
    minifyTest(".foo { color: oklch(40.101% 0.12332 21.555); }", ".foo{color:oklch(40.101% .12332 21.555)}");
    minifyTest(".foo { color: oklch(40.101% 0.12332 .5turn); }", ".foo{color:oklch(40.101% .12332 180)}");
    minifyTest(".foo { color: color(display-p3 1 0.5 0); }", ".foo{color:color(display-p3 1 .5 0)}");
    minifyTest(".foo { color: color(display-p3 100% 50% 0%); }", ".foo{color:color(display-p3 1 .5 0)}");
    minifyTest(
      ".foo { color: color(xyz-d50 0.2005 0.14089 0.4472); }",
      ".foo{color:color(xyz-d50 .2005 .14089 .4472)}",
    );
    minifyTest(
      ".foo { color: color(xyz-d50 20.05% 14.089% 44.72%); }",
      ".foo{color:color(xyz-d50 .2005 .14089 .4472)}",
    );
    minifyTest(".foo { color: color(xyz-d65 0.2005 0.14089 0.4472); }", ".foo{color:color(xyz .2005 .14089 .4472)}");
    minifyTest(".foo { color: color(xyz-d65 20.05% 14.089% 44.72%); }", ".foo{color:color(xyz .2005 .14089 .4472)}");
    minifyTest(".foo { color: color(xyz 0.2005 0.14089 0.4472); }", ".foo{color:color(xyz .2005 .14089 .4472)}");
    minifyTest(".foo { color: color(xyz 20.05% 14.089% 44.72%); }", ".foo{color:color(xyz .2005 .14089 .4472)}");
    minifyTest(".foo { color: color(xyz 0.2005 0 0); }", ".foo{color:color(xyz .2005 0 0)}");
    minifyTest(".foo { color: color(xyz 0 0 0); }", ".foo{color:color(xyz 0 0 0)}");
    minifyTest(".foo { color: color(xyz 0 1 0); }", ".foo{color:color(xyz 0 1 0)}");
    minifyTest(".foo { color: color(xyz 0 1 0 / 20%); }", ".foo{color:color(xyz 0 1 0/.2)}");
    minifyTest(".foo { color: color(xyz 0 0 0 / 20%); }", ".foo{color:color(xyz 0 0 0/.2)}");
    minifyTest(".foo { color: color(display-p3 100% 50% 0 / 20%); }", ".foo{color:color(display-p3 1 .5 0/.2)}");
    minifyTest(".foo { color: color(display-p3 100% 0 0 / 20%); }", ".foo{color:color(display-p3 1 0 0/.2)}");
    minifyTest(".foo { color: hsl(none none none) }", ".foo{color:#000}");
    minifyTest(".foo { color: hwb(none none none) }", ".foo{color:red}");
    minifyTest(".foo { color: rgb(none none none) }", ".foo{color:#000}");

    // If the browser doesn't support `#rrggbbaa` color syntax, it is converted to `transparent`.
    attrTest("color: rgba(0, 0, 0, 0)", indoc`color:transparent`, true, {
      chrome: 61 << 16,
    });

    // prefix_test(
    //   ".foo { color: #0000 }",
    //   indoc`
    //   .foo {
    //     color: transparent;
    //   }`,
    //   {
    //     chrome: 61 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: transparent }",
    //   indoc`
    //   .foo {
    //     color: transparent;
    //   }`,
    //   {
    //     chrome: 61 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: rgba(0, 0, 0, 0) }",
    //   indoc`
    //   .foo {
    //     color: rgba(0, 0, 0, 0);
    //   }`,
    //   {
    //     chrome: 61 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: rgba(255, 0, 0, 0) }",
    //   indoc`
    //   .foo {
    //     color: rgba(255,0,0,0);
    //   }`,
    //   {
    //     chrome: 61 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: rgba(255, 0, 0, 0) }",
    //   indoc`
    //   .foo {
    //     color: #f000;
    //   }`,
    //   {
    //     chrome: 62 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: rgba(123, 456, 789, 0.5) }",
    //   indoc`
    //   .foo {
    //     color: #7bffff80;
    //   }`,
    //   {
    //     chrome: 95 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: rgba(123, 255, 255, 0.5) }",
    //   indoc`
    //   .foo {
    //     color: rgba(123, 255, 255, .5);
    //   }`,
    //   {
    //     ie: 11 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: #7bffff80 }",
    //   indoc`
    //   .foo {
    //     color: rgba(123, 255, 255, .5);
    //   }`,
    //   {
    //     ie: 11 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: rgba(123, 456, 789, 0.5) }",
    //   indoc`
    //   .foo {
    //     color: rgba(123, 255, 255, .5);
    //   }`,
    //   {
    //     firefox: 48 << 16,
    //     safari: 10 << 16,
    //     ios_saf: 9 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: rgba(123, 456, 789, 0.5) }",
    //   indoc`
    //   .foo {
    //     color: #7bffff80;
    //   }`,
    //   {
    //     firefox: 49 << 16,
    //     safari: 10 << 16,
    //     ios_saf: 10 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: lab(40% 56.6 39) }",
    //   indoc`
    //   .foo {
    //     background-color: #b32323;
    //     background-color: lab(40% 56.6 39);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: lch(40% 68.735435 34.568626) }",
    //   indoc`
    //   .foo {
    //     background-color: #b32323;
    //     background-color: lch(40% 68.7354 34.5686);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: oklab(59.686% 0.1009 0.1192); }",
    //   indoc`
    //   .foo {
    //     background-color: #c65d07;
    //     background-color: lab(52.2319% 40.1449 59.9171);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: oklch(40% 0.1268735435 34.568626) }",
    //   indoc`
    //   .foo {
    //     background-color: #7e250f;
    //     background-color: lab(29.2661% 38.2437 35.3889);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: lab(40% 56.6 39) }",
    //   indoc`
    //   .foo {
    //     background-color: lab(40% 56.6 39);
    //   }`,
    //   {
    //     safari: 15 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: oklab(59.686% 0.1009 0.1192); }",
    //   indoc`
    //   .foo {
    //     background-color: #c65d07;
    //     background-color: lab(52.2319% 40.1449 59.9171);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 15 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: oklab(59.686% 0.1009 0.1192); }",
    //   indoc`
    //   .foo {
    //     background-color: #c65d07;
    //     background-color: color(display-p3 .724144 .386777 .148795);
    //     background-color: lab(52.2319% 40.1449 59.9171);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: lab(40% 56.6 39) }",
    //   indoc`
    //   .foo {
    //     background-color: #b32323;
    //     background-color: color(display-p3 .643308 .192455 .167712);
    //     background-color: lab(40% 56.6 39);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: oklch(59.686% 0.15619 49.7694); }",
    //   indoc`
    //   .foo {
    //     background-color: #c65d06;
    //     background-color: lab(52.2321% 40.1417 59.9527);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 15 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(sRGB 0.41587 0.503670 0.36664); }",
    //   indoc`
    //   .foo {
    //     background-color: #6a805d;
    //     background-color: color(srgb .41587 .50367 .36664);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(display-p3 0.43313 0.50108 0.37950); }",
    //   indoc`
    //   .foo {
    //     background-color: #6a805d;
    //     background-color: color(display-p3 .43313 .50108 .3795);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(display-p3 0.43313 0.50108 0.37950); }",
    //   indoc`
    //   .foo {
    //     background-color: #6a805d;
    //     background-color: color(display-p3 .43313 .50108 .3795);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(display-p3 0.43313 0.50108 0.37950); }",
    //   indoc`
    //   .foo {
    //     background-color: color(display-p3 .43313 .50108 .3795);
    //   }`,
    //   {
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(display-p3 0.43313 0.50108 0.37950); }",
    //   indoc`
    //   .foo {
    //     background-color: #6a805d;
    //     background-color: color(display-p3 .43313 .50108 .3795);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 15 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(display-p3 0.43313 0.50108 0.37950); }",
    //   indoc`
    //   .foo {
    //     background-color: #6a805d;
    //     background-color: color(display-p3 .43313 .50108 .3795);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(a98-rgb 0.44091 0.49971 0.37408); }",
    //   indoc`
    //   .foo {
    //     background-color: #6a805d;
    //     background-color: color(a98-rgb .44091 .49971 .37408);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(a98-rgb 0.44091 0.49971 0.37408); }",
    //   indoc`
    //   .foo {
    //     background-color: color(a98-rgb .44091 .49971 .37408);
    //   }`,
    //   {
    //     safari: 15 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(prophoto-rgb 0.36589 0.41717 0.31333); }",
    //   indoc`
    //   .foo {
    //     background-color: #6a805d;
    //     background-color: color(prophoto-rgb .36589 .41717 .31333);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(rec2020 0.42210 0.47580 0.35605); }",
    //   indoc`
    //   .foo {
    //     background-color: #728765;
    //     background-color: color(rec2020 .4221 .4758 .35605);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(xyz-d50 0.2005 0.14089 0.4472); }",
    //   indoc`
    //   .foo {
    //     background-color: #7654cd;
    //     background-color: color(xyz-d50 .2005 .14089 .4472);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: color(xyz-d65 0.21661 0.14602 0.59452); }",
    //   indoc`
    //   .foo {
    //     background-color: #7654cd;
    //     background-color: color(xyz .21661 .14602 .59452);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background-color: lch(50.998% 135.363 338) }",
    //   indoc`
    //   .foo {
    //     background-color: #ee00be;
    //     background-color: color(display-p3 .972962 -.362078 .804206);
    //     background-color: lch(50.998% 135.363 338);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { color: lch(50.998% 135.363 338) }",
    //   indoc`
    //   .foo {
    //     color: #ee00be;
    //     color: color(display-p3 .972962 -.362078 .804206);
    //     color: lch(50.998% 135.363 338);
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   ".foo { background: var(--image) lch(40% 68.735435 34.568626) }",
    //   indoc`
    //   .foo {
    //     background: var(--image) #b32323;
    //   }

    //   @supports (color: lab(0% 0 0)) {
    //     .foo {
    //       background: var(--image) lab(40% 56.6 39);
    //     }
    //   }`,
    //   {
    //     chrome: 90 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     color: red;
    //     color: lab(40% 56.6 39);
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     color: red;
    //     color: lab(40% 56.6 39);
    //   }`,
    //   {
    //     safari: 14 << 16,
    //   },
    // );
    // prefix_test(
    //   `
    //   .foo {
    //     color: red;
    //     color: lab(40% 56.6 39);
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     color: lab(40% 56.6 39);
    //   }`,
    //   {
    //     safari: 16 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     color: var(--fallback);
    //     color: lab(40% 56.6 39);
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     color: var(--fallback);
    //     color: lab(40% 56.6 39);
    //   }`,
    //   {
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     color: var(--fallback);
    //     color: lab(40% 56.6 39);
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     color: lab(40% 56.6 39);
    //   }`,
    //   {
    //     safari: 16 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     color: red;
    //     color: var(--foo, lab(40% 56.6 39));
    //   }
    // `,
    //   indoc`
    //   .foo {
    //     color: var(--foo, color(display-p3 .643308 .192455 .167712));
    //   }

    //   @supports (color: lab(0% 0 0)) {
    //     .foo {
    //       color: var(--foo, lab(40% 56.6 39));
    //     }
    //   }`,
    //   {
    //     safari: 14 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     --a: rgb(0 0 0 / var(--alpha));
    //     --b: rgb(50% 50% 50% / var(--alpha));
    //     --c: rgb(var(--x) 0 0);
    //     --d: rgb(0 var(--x) 0);
    //     --e: rgb(0 0 var(--x));
    //     --f: rgb(var(--x) 0 0 / var(--alpha));
    //     --g: rgb(0 var(--x) 0 / var(--alpha));
    //     --h: rgb(0 0 var(--x) / var(--alpha));
    //     --i: rgb(none 0 0 / var(--alpha));
    //     --j: rgb(from yellow r g b / var(--alpha));
    //   }
    //   `,
    //   indoc`
    //   .foo {
    //     --a: rgba(0, 0, 0, var(--alpha));
    //     --b: rgba(128, 128, 128, var(--alpha));
    //     --c: rgb(var(--x) 0 0);
    //     --d: rgb(0 var(--x) 0);
    //     --e: rgb(0 0 var(--x));
    //     --f: rgb(var(--x) 0 0 / var(--alpha));
    //     --g: rgb(0 var(--x) 0 / var(--alpha));
    //     --h: rgb(0 0 var(--x) / var(--alpha));
    //     --i: rgb(none 0 0 / var(--alpha));
    //     --j: rgba(255, 255, 0, var(--alpha));
    //   }`,
    //   {
    //     safari: 11 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     --a: rgb(0 0 0 / var(--alpha));
    //     --b: rgb(50% 50% 50% / var(--alpha));
    //     --c: rgb(var(--x) 0 0);
    //     --d: rgb(0 var(--x) 0);
    //     --e: rgb(0 0 var(--x));
    //     --f: rgb(var(--x) 0 0 / var(--alpha));
    //     --g: rgb(0 var(--x) 0 / var(--alpha));
    //     --h: rgb(0 0 var(--x) / var(--alpha));
    //     --i: rgb(none 0 0 / var(--alpha));
    //     --j: rgb(from yellow r g b / var(--alpha));
    //   }
    //   `,
    //   indoc`
    //   .foo {
    //     --a: rgb(0 0 0 / var(--alpha));
    //     --b: rgb(128 128 128 / var(--alpha));
    //     --c: rgb(var(--x) 0 0);
    //     --d: rgb(0 var(--x) 0);
    //     --e: rgb(0 0 var(--x));
    //     --f: rgb(var(--x) 0 0 / var(--alpha));
    //     --g: rgb(0 var(--x) 0 / var(--alpha));
    //     --h: rgb(0 0 var(--x) / var(--alpha));
    //     --i: rgb(none 0 0 / var(--alpha));
    //     --j: rgb(255 255 0 / var(--alpha));
    //   }`,
    //   {
    //     safari: 13 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     --a: hsl(270 100% 50% / var(--alpha));
    //     --b: hsl(var(--x) 0 0);
    //     --c: hsl(0 var(--x) 0);
    //     --d: hsl(0 0 var(--x));
    //     --e: hsl(var(--x) 0 0 / var(--alpha));
    //     --f: hsl(0 var(--x) 0 / var(--alpha));
    //     --g: hsl(0 0 var(--x) / var(--alpha));
    //     --h: hsl(270 100% 50% / calc(var(--alpha) / 2));
    //     --i: hsl(none 100% 50% / var(--alpha));
    //     --j: hsl(from yellow h s l / var(--alpha));
    //   }
    //   `,
    //   indoc`
    //   .foo {
    //     --a: hsla(270, 100%, 50%, var(--alpha));
    //     --b: hsl(var(--x) 0 0);
    //     --c: hsl(0 var(--x) 0);
    //     --d: hsl(0 0 var(--x));
    //     --e: hsl(var(--x) 0 0 / var(--alpha));
    //     --f: hsl(0 var(--x) 0 / var(--alpha));
    //     --g: hsl(0 0 var(--x) / var(--alpha));
    //     --h: hsla(270, 100%, 50%, calc(var(--alpha) / 2));
    //     --i: hsl(none 100% 50% / var(--alpha));
    //     --j: hsla(60, 100%, 50%, var(--alpha));
    //   }`,
    //   {
    //     safari: 11 << 16,
    //   },
    // );

    // prefix_test(
    //   `
    //   .foo {
    //     --a: hsl(270 100% 50% / var(--alpha));
    //     --b: hsl(var(--x) 0 0);
    //     --c: hsl(0 var(--x) 0);
    //     --d: hsl(0 0 var(--x));
    //     --e: hsl(var(--x) 0 0 / var(--alpha));
    //     --f: hsl(0 var(--x) 0 / var(--alpha));
    //     --g: hsl(0 0 var(--x) / var(--alpha));
    //     --h: hsl(270 100% 50% / calc(var(--alpha) / 2));
    //     --i: hsl(none 100% 50% / var(--alpha));
    //   }
    //   `,
    //   indoc`
    //     .foo {
    //       --a: hsl(270 100% 50% / var(--alpha));
    //       --b: hsl(var(--x) 0 0);
    //       --c: hsl(0 var(--x) 0);
    //       --d: hsl(0 0 var(--x));
    //       --e: hsl(var(--x) 0 0 / var(--alpha));
    //       --f: hsl(0 var(--x) 0 / var(--alpha));
    //       --g: hsl(0 0 var(--x) / var(--alpha));
    //       --h: hsl(270 100% 50% / calc(var(--alpha) / 2));
    //       --i: hsl(none 100% 50% / var(--alpha));
    //     }
    //   `,
    //   {
    //     safari: 13 << 16,
    //   },
    // );

    // minifyTest(
    //   `
    //   .foo {
    //     --a: rgb(50% 50% 50% / calc(100% / 2));
    //     --b: hsl(calc(360deg / 2) 50% 50%);
    //     --c: oklab(40.101% calc(0.1 + 0.2) 0.0453);
    //     --d: color(display-p3 0.43313 0.50108 calc(0.1 + 0.2));
    //     --e: rgb(calc(255 / 2), calc(255 / 2), calc(255 / 2));
    //   }
    //   `,
    //   indoc`
    //     .foo {
    //       --a: #80808080;
    //       --b: #40bfbf;
    //       --c: oklab(40.101% .3 .0453);
    //       --d: color(display-p3 .43313 .50108 .3);
    //       --e: gray;
    //     }
    //   `,
    // );
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
});
