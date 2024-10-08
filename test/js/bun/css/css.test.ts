/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from "bun:test";
import "harness";
import path from "path";
import { attrTest, cssTest, indoc, minify_test, minifyTest, prefix_test } from "./util";

describe("css tests", () => {
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
    // TODO:
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
});
