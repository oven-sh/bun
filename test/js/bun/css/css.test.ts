import { describe, expect, test } from "bun:test";
import "harness";
import path from "path";
import { cssTest, indoc, minify_test, minifyTest, prefix_test } from "./util";

describe("css tests", () => {
  test("border_spacing", () => {
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

  test("border", () => {
    cssTest(
      `
      .foo {
        border-left: 2px solid red;
        border-right: 2px solid red;
        border-bottom: 2px solid red;
        border-top: 2px solid red;
      }
    `,
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
      .foo {
        border-block: thin dotted red;
      }
    `,
    );

    minifyTest(
      `
      .foo {
        border: none;
      }
    `,
      `.foo{border:none}`,
    );

    minifyTest(".foo { border-width: 0 0 1px; }", ".foo{border-width:0 0 1px}");

    cssTest(
      `
      .foo {
        border-block-width: 1px;
        border-inline-width: 1px;
      }
    `,
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
      .foo {
        border-block-width: 1px;
        border-inline-width: 2px 3px;
      }
    `,
    );

    minifyTest(
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
      .foo {
        border: 1px solid;
      }
    `,
    );

    minifyTest(
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
      indoc`
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
        indoc`
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
        indoc`
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
        indoc`
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
      indoc`
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
      indoc`
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
      indoc`
      .foo:not(:-webkit-any(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi))) {
        border-left-color: #b32323;
        border-left-color: lab(40% 56.6 39);
        border-right-color: #ee00be;
        border-right-color: lch(50.998% 135.363 338);
      }`,
      {
        chrome: 8 << 16,
        safari: 14 << 16,
      },
    );
  });
});
