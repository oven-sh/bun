/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "path";
import {
  cssTest,
  cssTestTodo,
  indoc,
  minify_error_test_with_options,
  minify_test,
  minifyTestWithOptions as minify_test_with_options,
  ParserFlags,
  ParserOptions,
  prefix_test,
  prefixTest as prefix_test_output,
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

  describe("custom property cases", () => {
    cssTest(
      `div {
        --foo: 1 1 1 rgba(1, 1, 1, 0.1), 2 2 2 rgba(2, 2, 2, 0.2);
        --bar: 1 1 1 #01010116, 2 2 2 #02020233;
      }`,
      `div {
        --foo: 1 1 1 #0101011a, 2 2 2 #02020233;
        --bar: 1 1 1 #01010116, 2 2 2 #02020233;
       }`,
    );
    cssTest(
      `:root {
        --my-color: red;
        --my-bg: white;
        --my-font-size: 16px;
      }
      .element {
        color: var(--my-color);
        background-color: var(--my-bg);
        font-size: var(--my-font-size);
      }`,
      `:root {
        --my-color: red;
        --my-bg: white;
        --my-font-size: 16px;
      }
      .element {
        color: var(--my-color);
        background-color: var(--my-bg);
        font-size: var(--my-font-size);
       }`,
    );
    cssTest(
      `div {
        --custom-padding: calc(20px * 10px);
        padding: var(--custom-padding);
      }`,
      `div {
        --custom-padding: calc(20px * 10px);
        padding: var(--custom-padding);
       }`,
    );

    // Adjacent `/` and `*` delim tokens must not be printed as `/*` or `*/`
    // when minifying, which would open/close a comment and swallow the rest of
    // the stylesheet.
    minify_test(":root { --a: x / * y }\n.k { color: red }", ":root{--a:x/ *y}.k{color:red}");
    minify_test(":root { --a: x * / y }\n.k { color: red }", ":root{--a:x* /y}.k{color:red}");
    minify_test(":root { --a: x / * / * y }", ":root{--a:x/ * / *y}");
    minify_test(".foo { unknown-prop: a / * b }", ".foo{unknown-prop:a/ *b}");
    minify_test(":root { --a: f(x / * y) }", ":root{--a:f(x/ *y)}");
    minify_test(":root { --a: x / *= y }", ":root{--a:x/ *= y}");
    // A lone `/` or `*` delim must still minify without extra whitespace.
    minify_test(":root { --a: 16 / 9 }", ":root{--a:16/9}");
    minify_test(":root { --a: x * y }", ":root{--a:x*y}");
    minify_test(":root { --a: x / / y }", ":root{--a:x//y}");
    // Non-minified output is unchanged.
    cssTest(":root { --a: x / * y }", ":root {\n  --a: x / * y;\n}\n");

    // Leading/trailing whitespace around a custom-property value is dropped.
    minify_test(":root{--a: x}", ":root{--a:x}");
    minify_test(":root{--a:x }", ":root{--a:x}");
    minify_test(":root{--a: x }", ":root{--a:x}");
    minify_test(":root{--a:x y}", ":root{--a:x y}");
    minify_test(":root{--a: x y }", ":root{--a:x y}");
    // A value that is only whitespace is preserved as a single space.
    minify_test(":root{--a: }", ":root{--a: }");
    minify_test(":root{--a:  }", ":root{--a: }");
    // Same trimming applies inside function arguments.
    minify_test(":root{--a:f(x y z)}", ":root{--a:f(x y z)}");
    minify_test(":root{--a:f( x y z )}", ":root{--a:f(x y z)}");

    // An rgb() whose alpha is only known at runtime is parsed into its channels
    // and printed back from them, in order; the legacy comma form is not a color
    // here and is left as written.
    minify_test(":root{--a: rgb(4.7% 13.3% 22% / var(--alpha))}", ":root{--a:rgb(12 34 56/var(--alpha))}");
    minify_test(":root{--a: rgb(12, 34, 56, var(--alpha))}", ":root{--a:rgb(12,34,56,var(--alpha))}");
  });

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

  describe("calc edge case", () => {
    // https://github.com/oven-sh/bun/issues/18064
    minify_test(
      `.rounded-full {
  border-radius: calc(infinity * 1px);
  width: calc(infinity * -1px);
  height: infinity;
}`,
      indoc`.rounded-full{height:infinity;border-radius:3.40282e38px;width:-3.40282e38px}`,
    );

    // NaN is valid inside calc() (CSS Values 4 "Infinities, NaN, and Signed Zero").
    // A NaN escaping a top-level calculation is censored to zero; it must never be
    // serialized as the literal `NaNpx`, which browsers reject.
    minify_test(`a { width: calc(NaN * 1px) }`, `a{width:0px}`);
    minify_test(`a { width: calc(infinity * 0px) }`, `a{width:0px}`);
    minify_test(`a { width: calc(infinity * 1px - infinity * 1px) }`, `a{width:0px}`);
    minify_test(`a { width: min(NaN * 1px, 2px) }`, `a{width:min(0px,2px)}`);
    minify_test(`a { width: max(NaN * 1px, 2px) }`, `a{width:max(0px,2px)}`);
    minify_test(`a { width: calc(NaN * 1%) }`, `a{width:0%}`);
    minify_test(`a { opacity: calc(NaN) }`, `a{opacity:0}`);
    minify_test(`a { rotate: calc(NaN * 1deg) }`, `a{rotate:0deg}`);
    minify_test(`a { transition-duration: calc(NaN * 1s) }`, `a{transition-duration:0s}`);
  });
  describe("clamp() simplification", () => {
    // The cases lightningcss asserts in its calc tests.
    minify_test(`.foo { border-width: clamp(1px, 2px, 3px) }`, `.foo{border-width:2px}`);
    minify_test(`.foo { border-width: clamp(1px, 10px, 3px) }`, `.foo{border-width:3px}`);
    minify_test(`.foo { border-width: clamp(5px, 2px, 10px) }`, `.foo{border-width:5px}`);
    minify_test(`.foo { border-width: clamp(100px, 2px, 10px) }`, `.foo{border-width:100px}`);
    minify_test(`.foo { border-width: clamp(5px + 5px, 5px + 7px, 10px + 20px) }`, `.foo{border-width:12px}`);
    minify_test(`.foo { border-width: clamp(1px, 2pt, 1in) }`, `.foo{border-width:2pt}`);
    minify_test(`.foo { border-width: clamp(1em, 2px, 4vh) }`, `.foo{border-width:clamp(1em,2px,4vh)}`);
    minify_test(`.foo { border-width: clamp(1em, 2em, 4vh) }`, `.foo{border-width:clamp(1em,2em,4vh)}`);
    minify_test(`.foo { border-width: clamp(1em, 2vh, 4vh) }`, `.foo{border-width:max(1em,2vh)}`);
    minify_test(`.foo { border-width: clamp(1px, 1px + 2em, 4px) }`, `.foo{border-width:clamp(1px,1px + 2em,4px)}`);
    minify_test(`.foo { width: clamp(-100px, 0px, 50% - 50vw) }`, `.foo{width:clamp(-100px,0px,50% - 50vw)}`);
    // The center is equal to one of the bounds.
    minify_test(`a { width: clamp(2px, 2px, 3px) }`, `a{width:2px}`);
    minify_test(`a { width: clamp(1px, 2px, 2px) }`, `a{width:2px}`);
    // The minimum wins over a smaller maximum. The two WPT rows only pass when the minimum is
    // compared with the center after the maximum has replaced it.
    minify_test(`a { width: clamp(20px, 15px, 10px) }`, `a{width:20px}`);
    minify_test(`a { width: clamp(30px, 100px, 20px) }`, `a{width:30px}`);
    minify_test(`a { width: clamp(-10px, 100px, -30px) }`, `a{width:-10px}`);
    // A lower bound that cannot be compared at parse time is kept, whether or not the center
    // was above the maximum.
    minify_test(`a { width: clamp(10vw, 5px, 20px) }`, `a{width:max(10vw,5px)}`);
    minify_test(`a { width: clamp(10vw, 30px, 20px) }`, `a{width:max(10vw,20px)}`);
    // A center that cannot be compared with the maximum leaves the clamp() alone, even when
    // it could be compared with the minimum.
    minify_test(`a { width: clamp(10px, 5px, 20vw) }`, `a{width:clamp(10px,5px,20vw)}`);
    // Other value types.
    minify_test(`a { width: clamp(10%, 5%, 20%) }`, `a{width:10%}`);
    minify_test(`a { width: clamp(10%, 25%, 20%) }`, `a{width:20%}`);
    minify_test(`a { rotate: clamp(0deg, 45deg, 30deg) }`, `a{rotate:30deg}`);
    minify_test(`a { transition-duration: clamp(1s, 500ms, 2s) }`, `a{transition-duration:1s}`);
    minify_test(`a { width: calc(clamp(1px, 2px, 3px) + 1px) }`, `a{width:3px}`);
  });
  describe("calc stack overflow", () => {
    // https://github.com/oven-sh/bun/issues/20128
    minify_test(`a { width: calc(100% - 2 - 1) }`, `a{width:calc(100% - 2 - 1)}`); // ideally 100% - 3
    minify_test(`a { width: calc(100% - 2 - 1 + 5vh - 10vh) }`, `a{width:calc(100% - 2 - 1 - 5vh)}`); // ideally 100% - 3 + 5vh
    minify_test(
      `a { width: calc(10 - 4 - 100% - 2 - 4 - 300% - 8vh + 3ic) }`,
      `a{width:calc(6 - 400% - 2 - 4 - 8vh + 3ic)}`,
    ); // ideally -400% - 8vh + 3ic
    minify_test(`a { top: calc(100% - 1 * 2 - 8 * 2); }`, `a{top:calc(100% - 2 - 16)}`); // ideally 100% - 18
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

  describe("box-shadow", () => {
    minify_test(
      ".foo { box-shadow: 64px 64px 12px 40px rgba(0,0,0,0.4) }",
      ".foo{box-shadow:64px 64px 12px 40px #0006}",
    );
    minify_test(
      ".foo { box-shadow: 12px 12px 0px 8px rgba(0,0,0,0.4) inset }",
      ".foo{box-shadow:inset 12px 12px 0 8px #0006}",
    );
    minify_test(
      ".foo { box-shadow: inset 12px 12px 0px 8px rgba(0,0,0,0.4) }",
      ".foo{box-shadow:inset 12px 12px 0 8px #0006}",
    );
    minify_test(".foo { box-shadow: 12px 12px 8px 0px rgba(0,0,0,0.4) }", ".foo{box-shadow:12px 12px 8px #0006}");
    minify_test(".foo { box-shadow: 12px 12px 0px 0px rgba(0,0,0,0.4) }", ".foo{box-shadow:12px 12px #0006}");
    minify_test(
      ".foo { box-shadow: 64px 64px 12px 40px rgba(0,0,0,0.4), 12px 12px 0px 8px rgba(0,0,0,0.4) inset }",
      ".foo{box-shadow:64px 64px 12px 40px #0006,inset 12px 12px 0 8px #0006}",
    );

    prefix_test(
      ".foo { box-shadow: 12px 12px lab(40% 56.6 39) }",
      `.foo {
          box-shadow: 12px 12px #b32323;
          box-shadow: 12px 12px lab(40% 56.6 39);
        }
              `,
      { chrome: Some(90 << 16) },
    );

    prefix_test(
      ".foo { box-shadow: 12px 12px lab(40% 56.6 39) }",
      `.foo {
          -webkit-box-shadow: 12px 12px #b32323;
          box-shadow: 12px 12px #b32323;
          box-shadow: 12px 12px lab(40% 56.6 39);
        }
              `,
      { chrome: Some(4 << 16) },
    );

    prefix_test(
      ".foo { box-shadow: 12px 12px lab(40% 56.6 39), 12px 12px yellow }",
      `.foo {
          -webkit-box-shadow: 12px 12px #b32323, 12px 12px #ff0;
          box-shadow: 12px 12px #b32323, 12px 12px #ff0;
          box-shadow: 12px 12px lab(40% 56.6 39), 12px 12px #ff0;
        }
              `,
      { chrome: Some(4 << 16) },
    );

    prefix_test(
      ".foo { -webkit-box-shadow: 12px 12px #0006 }",
      `.foo {
          -webkit-box-shadow: 12px 12px rgba(0, 0, 0, .4);
        }
              `,
      { chrome: Some(4 << 16) },
    );

    prefix_test(
      `.foo {
        -webkit-box-shadow: 12px 12px #0006;
        -moz-box-shadow: 12px 12px #0009;
      }`,
      `.foo {
          -webkit-box-shadow: 12px 12px rgba(0, 0, 0, .4);
          -moz-box-shadow: 12px 12px rgba(0, 0, 0, .6);
        }
              `,
      { chrome: Some(4 << 16) },
    );

    prefix_test(
      `.foo {
        -webkit-box-shadow: 12px 12px #0006;
        -moz-box-shadow: 12px 12px #0006;
        box-shadow: 12px 12px #0006;
      }`,
      `.foo {
          box-shadow: 12px 12px #0006;
        }
              `,
      { chrome: Some(95 << 16) },
    );

    prefix_test(
      ".foo { box-shadow: var(--foo) 12px lab(40% 56.6 39) }",
      `.foo {
          box-shadow: var(--foo) 12px #b32323;
        }
        
        @supports (color: lab(0% 0 0)) {
          .foo {
            box-shadow: var(--foo) 12px lab(40% 56.6 39);
          }
        }
              `,
      { chrome: Some(90 << 16) },
    );

    prefix_test(
      `.foo {
        box-shadow: 0px 0px 22px red;
        box-shadow: 0px 0px max(2cqw, 22px) red;
      }
    `,
      `.foo {
          box-shadow: 0 0 22px red;
          box-shadow: 0 0 max(2cqw, 22px) red;
        }
            `,
      { safari: Some(14 << 16) },
    );
    prefix_test(
      `.foo {
        box-shadow: 0px 0px 22px red;
        box-shadow: 0px 0px max(2cqw, 22px) red;
      }
    `,
      `.foo {
          box-shadow: 0 0 max(2cqw, 22px) red;
        }
            `,
      { safari: Some(16 << 16) },
    );

    prefix_test(
      `.foo {
        box-shadow: 0px 0px 22px red;
        box-shadow: 0px 0px 22px lab(40% 56.6 39);
      }
    `,
      `.foo {
          box-shadow: 0 0 22px red;
          box-shadow: 0 0 22px lab(40% 56.6 39);
        }
            `,
      { safari: Some(14 << 16) },
    );
    prefix_test(
      `.foo {
        box-shadow: 0px 0px 22px red;
        box-shadow: 0px 0px 22px lab(40% 56.6 39);
      }
    `,
      `.foo {
          box-shadow: 0 0 22px lab(40% 56.6 39);
        }
            `,
      { safari: Some(16 << 16) },
    );

    prefix_test(
      `.foo {
        box-shadow: var(--fallback);
        box-shadow: 0px 0px 22px lab(40% 56.6 39);
      }
    `,
      `.foo {
          box-shadow: var(--fallback);
          box-shadow: 0 0 22px lab(40% 56.6 39);
        }
            `,
      { safari: Some(16 << 16) },
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

    // Multi-layer variants of the above: with >1 background layer the
    // SmallList(BackgroundClip, 1) spills to the heap. The
    // `-webkit-background-clip` that follows the shorthand has both a
    // different vendor prefix and a different value, which forces a
    // flush() while a pointer into the previous `clips` payload is still
    // live. flush() takes ownership of that payload, so the caller must
    // not touch it afterwards.
    cssTest(
      `
      .foo {
        background: none, green none;
        -webkit-background-clip: text, text;
      }
    `,
      indoc`
      .foo {
        background: none, green;
        -webkit-background-clip: text, text;
      }
    `,
    );

    cssTest(
      `
      .foo {
        background: none, green none;
        -webkit-background-clip: text, text;
        background-clip: content-box, content-box;
      }
    `,
      indoc`
      .foo {
        background: none, green;
        -webkit-background-clip: text, text;
        background-clip: content-box, content-box;
      }
    `,
    );

    // A prefixed background-clip followed by a background shorthand
    // whose implied clip values differ must flush the prefixed clip
    // first rather than merging its vendor prefix into the shorthand's
    // (different) clip values.
    cssTest(
      `
      .foo {
        -webkit-background-clip: text;
        background: green content-box;
      }
    `,
      indoc`
      .foo {
        -webkit-background-clip: text;
        background: green content-box content-box;
      }
    `,
    );

    cssTest(
      `
      .foo {
        -webkit-background-clip: text, text;
        background: none, green none;
      }
    `,
      indoc`
      .foo {
        -webkit-background-clip: text, text;
        background: none, green;
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

    // The shorthand prints <box> twice when origin != clip. A single <box>
    // token sets both origin and clip, so dropping a border-box clip after a
    // non-default origin would change the declared clip value.
    minify_test(".foo { background: red content-box border-box }", ".foo{background:red content-box border-box}");
    minify_test(".foo { background: red border-box content-box }", ".foo{background:red border-box content-box}");
    minify_test(".foo { background: red border-box padding-box }", ".foo{background:red border-box padding-box}");
    minify_test(".foo { background: red padding-box border-box }", ".foo{background:red}");
    minify_test(".foo { background: red border-box border-box }", ".foo{background:red border-box}");
    cssTest(
      `
      .foo {
        background-color: red;
        background-position: 0% 0%;
        background-size: auto;
        background-repeat: repeat;
        background-clip: border-box;
        background-origin: content-box;
        background-attachment: scroll;
        background-image: none
      }
    `,
      indoc`
      .foo {
        background: red content-box border-box;
      }
    `,
    );

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
          background: #af5cae linear-gradient(#c65d07, #00817d);
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
    // Test case for the crash fix with 0.25turn
    minify_test(
      ".foo { background: linear-gradient(0.25turn, rgb(2, 0, 36) 0%, rgb(1, 53, 164) 100%); }",
      ".foo{background:linear-gradient(.25turn,#020024 0%,#0135a4 100%)}",
    );
    // Additional angle unit tests to ensure the fix works for various cases
    minify_test(
      ".foo { background: linear-gradient(0.25turn, yellow, blue); }",
      ".foo{background:linear-gradient(.25turn,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(0.75turn, yellow, blue); }",
      ".foo{background:linear-gradient(.75turn,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: linear-gradient(1turn, yellow, blue); }",
      ".foo{background:linear-gradient(1turn,#ff0,#00f)}",
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
    minify_test('[foo="123"] {color:red}', '[foo="123"]{color:red}');
    minify_test('[foo="\\\\"] {color:red}', "[foo=\\\\]{color:red}");
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
      "view-transition-group-children",
    ]) {
      minify_test(`:root::${name}(*) {position: fixed}`, `:root::${name}(*){position:fixed}`);
      minify_test(`:root::${name}(foo) {position: fixed}`, `:root::${name}(foo){position:fixed}`);
      minify_test(`:root::${name}(foo):only-child {position: fixed}`, `:root::${name}(foo):only-child{position:fixed}`);
      // Test class selector syntax (.class-name)
      minify_test(`:root::${name}(.slide-out) {position: fixed}`, `:root::${name}(.slide-out){position:fixed}`);
      minify_test(`:root::${name}(.fade-in) {animation-name: fade}`, `:root::${name}(.fade-in){animation-name:fade}`);
      // <pt-name-and-class-selector>: a name or `*` followed by classes, or classes alone.
      minify_test(`:root::${name}(*.class) {position: fixed}`, `:root::${name}(*.class){position:fixed}`);
      minify_test(`:root::${name}(*.class.class) {position: fixed}`, `:root::${name}(*.class.class){position:fixed}`);
      minify_test(`:root::${name}(foo.class) {position: fixed}`, `:root::${name}(foo.class){position:fixed}`);
      minify_test(`:root::${name}(foo.bar.baz) {position: fixed}`, `:root::${name}(foo.bar.baz){position:fixed}`);
      minify_test(
        `:root::${name}(foo.bar.baz):only-child {position: fixed}`,
        `:root::${name}(foo.bar.baz):only-child{position:fixed}`,
      );
      minify_test(`:root::${name}(.foo.bar) {position: fixed}`, `:root::${name}(.foo.bar){position:fixed}`);
      minify_test(`:root::${name}(  .foo.bar  ) {position: fixed}`, `:root::${name}(.foo.bar){position:fixed}`);
      minify_test(`:root::${name}(  foo.bar  ) {position: fixed}`, `:root::${name}(foo.bar){position:fixed}`);
      error_test(
        `:root::${name}(foo):first-child {position: fixed}`,
        "ParserError::SelectorError(SelectorError::InvalidPseudoClassAfterPseudoElement)",
      );
      error_test(
        `:root::${name}(foo)::before {position: fixed}`,
        "ParserError::SelectorError(SelectorError::InvalidState)",
      );
      // White space is not allowed between the name and a class, or inside the classes.
      test.each([
        ["*.*", "Expected identifier after '.' in class selector, found: *"],
        ["*. cls", "Expected identifier after '.' in class selector"],
        [". cls", "Expected identifier after '.' in class selector"],
        ["foo .bar", "Unexpected token: ."],
        [".foo .bar", "Unexpected token: ."],
        ["*.cls. c", "Expected identifier after '.' in class selector"],
        ["*.cls>cls", "Unexpected token: >"],
        ["*.cls.foo.*", "Expected identifier after '.' in class selector, found: *"],
        ["foo.bar baz", "Unexpected token: baz"],
        ["foo.inherit", "Unexpected token: inherit"],
        ["inherit.foo", "Unexpected token: inherit"],
        ["", "Unexpected end of input"],
      ])(`ERROR: :root::${name}(%s) {position: fixed}`, (argument, message) => {
        expect(() => minify_test_with_options(`:root::${name}(${argument}) {position: fixed}`, "")).toThrow(message);
      });
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

  describe("animation", () => {
    // The animation name is serialized last, in canonical order.
    minify_test(".foo { animation: anim 2s }", ".foo{animation:2s anim}");
    minify_test(".foo { animation: 0.25s ease-out forwards anim }", ".foo{animation:.25s ease-out forwards anim}");
    minify_test(".foo { animation: none }", ".foo{animation:none}");

    // Name-less shorthands must keep their components (must NOT collapse to
    // `none`) — a lone trailing `none` is dropped as redundant.
    minify_test(".foo { animation: 2s }", ".foo{animation:2s}");
    minify_test(".foo { animation: 2s ease-in-out }", ".foo{animation:2s ease-in-out}");
    minify_test(
      ".foo { animation: 3s linear 1s infinite alternate }",
      ".foo{animation:3s linear 1s infinite alternate}",
    );
    minify_test(".foo { animation: 2s none }", ".foo{animation:2s}");
    // 0s duration must still be emitted when a nonzero delay follows.
    minify_test(".foo { animation: 0s 2s foo }", ".foo{animation:0s 2s foo}");

    // Multiple comma-separated animations.
    minify_test(".foo { animation: spin 1s, 2s slide }", ".foo{animation:1s spin,2s slide}");

    // Vendor-prefixed shorthand.
    minify_test(".foo { -webkit-animation: spin 1s }", ".foo{-webkit-animation:1s spin}");

    // Timeline component in the shorthand: round-trips a dashed-ident timeline
    // and drops the default `auto` timeline.
    minify_test(".foo { animation: 1s spin --my-timeline }", ".foo{animation:1s spin --my-timeline}");
    minify_test(".foo { animation: 1s spin auto }", ".foo{animation:1s spin}");

    // animation-name longhand.
    minify_test(".foo { animation-name: foo }", ".foo{animation-name:foo}");
    minify_test(".foo { animation-name: foo, bar }", ".foo{animation-name:foo,bar}");
    minify_test('.foo { animation-name: "foo" }', ".foo{animation-name:foo}");

    // CSS-wide keywords must NOT be consumed as an animation name.
    minify_test(".foo { animation: inherit }", ".foo{animation:inherit}");
    minify_test(".foo { animation: unset }", ".foo{animation:unset}");
    minify_test(".foo { animation-name: initial }", ".foo{animation-name:initial}");
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
    minify_test(".foo { transform: rotate(20rad)", ".foo{transform:rotate(20rad)}");
    minify_test(".foo { transform: rotateX(20rad)", ".foo{transform:rotateX(20rad)}");
    minify_test(".foo { transform: rotateY(20rad)", ".foo{transform:rotateY(20rad)}");
    minify_test(".foo { transform: rotateZ(20rad)", ".foo{transform:rotate(20rad)}");
    minify_test(".foo { transform: rotateX(0.017453293rad)", ".foo{transform:rotateX(1deg)}");
    minify_test(".foo { transform: rotateY(0.017453293rad)", ".foo{transform:rotateY(1deg)}");
    minify_test(".foo { transform: rotateZ(0.017453293rad)", ".foo{transform:rotate(1deg)}");
    minify_test(".foo { transform: rotate(0.017453293rad)", ".foo{transform:rotate(1deg)}");
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
    //       See: https://github.com/parcel-bundler/buncss/issues/288
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
    //       See: https://github.com/parcel-bundler/buncss/issues/288
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

    // calc() payloads must survive the transform property handler's deep clone.
    minify_test(".foo { translate: calc(50% - 100px + 20px) 0px }", ".foo{translate:calc(50% - 80px)}");
    minify_test(".foo { translate: 1px 2px; rotate: 30deg; scale: 2 }", ".foo{translate:1px 2px;rotate:30deg;scale:2}");
    // `transform` is not a shorthand: it does not reset the individual transform properties.
    minify_test(
      ".foo { translate: calc(50% - 100px + 20px) 0px; transform: translate(2px, 3px) }",
      ".foo{transform:translate(2px,3px);translate:calc(50% - 80px)}",
    );
    minify_test(".foo { transform: scale(3); scale: 0.5 }", ".foo{transform:scale(3);scale:.5}");
    minify_test(".foo { scale: 0.5; transform: scale(3); }", ".foo{transform:scale(3);scale:.5}");

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

  // https://github.com/parcel-bundler/lightningcss/pull/1340
  describe("individual transforms", () => {
    for (const [property, value, identity] of [
      ["translate", "10px", "0"],
      ["rotate", "30deg", "0deg"],
      ["scale", "2", "1"],
    ]) {
      // `transform` is not a shorthand that resets the individual properties.
      for (const [transform, individual] of [
        ["scale(3)", value],
        ["none", "none"],
        ["none", identity],
      ]) {
        // `rotate: 0deg` prints as `rotate: none` until lightningcss #1147 is ported.
        const check = individual === "0deg" ? cssTestTodo : cssTest;
        const expected = `
          .box {
            transform: ${transform};
            ${property}: ${individual};
          }
        `;
        check(
          `
          .box {
            transform: ${transform};
            ${property}: ${individual};
          }
          `,
          expected,
        );
        check(
          `
          .box {
            ${property}: ${individual};
            transform: ${transform};
          }
          `,
          expected,
        );
      }
    }

    cssTest(
      `
      .box {
        transform: translateX(5px);
        scale: 2;
        rotate: 30deg;
        translate: 10px;
        transform: scale(3);
        translate: 20px 30px;
        rotate: x 40deg;
        scale: 4 5;
      }
      `,
      `
      .box {
        transform: scale(3);
        translate: 20px 30px;
        rotate: x 40deg;
        scale: 4 5;
      }
      `,
    );

    // `rotate: 0deg` prints as `rotate: none` until lightningcss #1147 is ported.
    cssTestTodo(
      `
      .base {
        translate: 10px;
        rotate: 30deg;
        scale: 2;
      }

      .base.reset {
        transform: none;
        translate: none;
        rotate: none;
        scale: none;
      }

      .base.identity {
        translate: 0;
        rotate: 0deg;
        scale: 1;
        transform: none;
      }
      `,
      `
      .base {
        translate: 10px;
        rotate: 30deg;
        scale: 2;
      }

      .base.reset {
        transform: none;
        translate: none;
        rotate: none;
        scale: none;
      }

      .base.identity {
        transform: none;
        translate: 0;
        rotate: 0deg;
        scale: 1;
      }
      `,
    );

    cssTest(
      `
      .box {
        transform: scale(2) !important;
        translate: 10px;
        rotate: 30deg !important;
        scale: 3;
        translate: 20px !important;
        transform: none;
        translate: 30px !important;
      }
      `,
      `
      .box {
        transform: none;
        translate: 10px;
        scale: 3;
        transform: scale(2) !important;
        translate: 30px !important;
        rotate: 30deg !important;
      }
      `,
    );

    cssTest(
      `
      .box {
        transform: rotate(10deg);
        translate: 10px;
        translate: var(--shift);
        rotate: 20deg;
        transform: var(--motion);
        scale: 2;
        scale: var(--zoom);
        transform: translateX(2px);
      }
      `,
      `
      .box {
        transform: rotate(10deg);
        translate: 10px;
        translate: var(--shift);
        rotate: 20deg;
        transform: var(--motion);
        scale: 2;
        scale: var(--zoom);
        transform: translateX(2px);
      }
      `,
    );

    cssTest(
      `
      .box {
        -webkit-transform: scale(2);
        translate: 10px;
        transform: scale(3);
        rotate: 30deg;
      }
      `,
      `
      .box {
        -webkit-transform: scale(2);
        translate: 10px;
        transform: scale(3);
        rotate: 30deg;
      }
      `,
    );

    prefix_test(
      `
      .box {
        translate: 10px;
        transform: scale(2);
        rotate: none;
        scale: 1;
      }
      `,
      `
      .box {
        -webkit-transform: scale(2);
        -moz-transform: scale(2);
        transform: scale(2);
        translate: 10px;
        rotate: none;
        scale: 1;
      }
      `,
      {
        firefox: Some(6 << 16),
        safari: Some(6 << 16),
      },
    );
  });

  describe("color-scheme", () => {
    minify_test(".foo { color-scheme: normal; }", ".foo{color-scheme:normal}");
    minify_test(".foo { color-scheme: light; }", ".foo{color-scheme:light}");
    minify_test(".foo { color-scheme: dark; }", ".foo{color-scheme:dark}");
    minify_test(".foo { color-scheme: light dark; }", ".foo{color-scheme:light dark}");
    minify_test(".foo { color-scheme: dark light; }", ".foo{color-scheme:light dark}");
    minify_test(".foo { color-scheme: only light; }", ".foo{color-scheme:light only}");
    minify_test(".foo { color-scheme: only dark; }", ".foo{color-scheme:dark only}");
    minify_test(".foo { color-scheme: dark light only; }", ".foo{color-scheme:light dark only}");
    minify_test(".foo { color-scheme: foo bar light; }", ".foo{color-scheme:light}");
    minify_test(".foo { color-scheme: only foo dark bar; }", ".foo{color-scheme:dark only}");
    prefix_test(
      ".foo { color-scheme: dark; }",
      `.foo {
          --buncss-light: ;
          --buncss-dark: initial;
          color-scheme: dark;
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color-scheme: light; }",
      `.foo {
          --buncss-light: initial;
          --buncss-dark: ;
          color-scheme: light;
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color-scheme: light dark; }",
      `.foo {
          --buncss-light: initial;
          --buncss-dark: ;
          color-scheme: light dark;
        }
        
        @media (prefers-color-scheme: dark) {
          .foo {
            --buncss-light: ;
            --buncss-dark: initial;
          }
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color-scheme: light dark; }",
      `.foo {
          color-scheme: light dark;
        }
        `,
      { firefox: Some(120 << 16) },
    );

    minify_test(".foo { color: light-dark(yellow, red); }", ".foo{color:light-dark(#ff0,red)}");
    minify_test(
      ".foo { color: light-dark(light-dark(yellow, red), light-dark(yellow, red)); }",
      ".foo{color:light-dark(#ff0,red)}",
    );
    minify_test(
      ".foo { color: light-dark(rgb(0, 0, 255), hsl(120deg, 50%, 50%)); }",
      ".foo{color:light-dark(#00f,#40bf40)}",
    );
    prefix_test(
      ".foo { color: light-dark(oklch(40% 0.1268735435 34.568626), oklab(59.686% 0.1009 0.1192)); }",
      `.foo {
        color: var(--buncss-light, #7e250f) var(--buncss-dark, #c65d07);
        color: var(--buncss-light, lab(29.2661% 38.2437 35.3889)) var(--buncss-dark, lab(52.2319% 40.1449 59.9171));
      }
      `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color: light-dark(oklch(40% 0.1268735435 34.568626), oklab(59.686% 0.1009 0.1192)); }",
      `.foo {
        color: light-dark(oklch(40% .126874 34.5686), oklab(59.686% .1009 .1192));
      }
      `,
      { firefox: Some(120 << 16) },
    );
    prefix_test(
      `
      .foo {
        box-shadow:
            oklch(100% 0 0deg / 50%) 0 0.63rem 0.94rem -0.19rem,
            currentColor 0 0.44rem 0.8rem -0.58rem;
      }
    `,
      `.foo {
          box-shadow: 0 .63rem .94rem -.19rem #ffffff80, 0 .44rem .8rem -.58rem;
          box-shadow: 0 .63rem .94rem -.19rem lab(100% 0 0 / .5), 0 .44rem .8rem -.58rem;
        }
        `,
      { chrome: Some(95 << 16) },
    );
    prefix_test(
      `
      .foo {
        box-shadow:
            oklch(100% 0 0deg / 50%) 0 0.63rem 0.94rem -0.19rem,
            currentColor 0 0.44rem 0.8rem -0.58rem;
      }
    `,
      `.foo {
          box-shadow: 0 .63rem .94rem -.19rem color(display-p3 1 1 1 / .5), 0 .44rem .8rem -.58rem;
          box-shadow: 0 .63rem .94rem -.19rem lab(100% 0 0 / .5), 0 .44rem .8rem -.58rem;
        }
        `,
      { safari: Some(14 << 16) },
    );

    prefix_test(
      ".foo { color: light-dark(var(--light), var(--dark)); }",
      `.foo {
          color: var(--buncss-light, var(--light)) var(--buncss-dark, var(--dark));
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color: rgb(from light-dark(yellow, red) r g b / 10%); }",
      `.foo {
          color: var(--buncss-light, #ffff001a) var(--buncss-dark, #ff00001a);
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color: rgb(from light-dark(yellow, red) r g b / var(--alpha)); }",
      `.foo {
          color: var(--buncss-light, rgb(255 255 0 / var(--alpha))) var(--buncss-dark, rgb(255 0 0 / var(--alpha)));
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color: color(from light-dark(yellow, red) srgb r g b / 10%); }",
      `.foo {
          color: var(--buncss-light, #ffff001a) var(--buncss-dark, #ff00001a);
          color: var(--buncss-light, color(srgb 1 1 0 / .1)) var(--buncss-dark, color(srgb 1 0 0 / .1));
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      ".foo { color: color-mix(in srgb, light-dark(yellow, red), light-dark(red, pink)); }",
      `.foo {
          color: var(--buncss-light, #ff8000) var(--buncss-dark, #ff6066);
        }
        `,
      { chrome: Some(90 << 16) },
    );

    // Test color-scheme inside @layer blocks (issue #20689)
    prefix_test(
      `@layer colors {
        .foo { color-scheme: dark; }
      }`,
      `@layer colors {
          .foo {
            --buncss-light: ;
            --buncss-dark: initial;
            color-scheme: dark;
          }
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      `@layer shm.colors {
        body.theme-dark {
          color-scheme: dark;
        }
        body.theme-light {
          color-scheme: light;
        }
      }`,
      `@layer shm.colors {
          body.theme-dark {
            --buncss-light: ;
            --buncss-dark: initial;
            color-scheme: dark;
          }

          body.theme-light {
            --buncss-light: initial;
            --buncss-dark: ;
            color-scheme: light;
          }
        }
        `,
      { chrome: Some(90 << 16) },
    );
    prefix_test(
      `@layer {
        .foo { color-scheme: light dark; }
      }`,
      `@layer {
          .foo {
            --buncss-light: initial;
            --buncss-dark: ;
            color-scheme: light dark;
          }

          @media (prefers-color-scheme: dark) {
            .foo {
              --buncss-light: ;
              --buncss-dark: initial;
            }
          }
        }
        `,
      { chrome: Some(90 << 16) },
    );
  });

  describe("page", () => {
    minify_test("@page { margin: 1em }", "@page{margin:1em}");
    minify_test("@page :left { margin: 1em }", "@page:left{margin:1em}");
    minify_test("@page :blank:first { margin: 1em }", "@page:blank:first{margin:1em}");
    minify_test("@page LandscapeTable { margin: 1em }", "@page LandscapeTable{margin:1em}");
    minify_test("@page CompanyLetterHead:first { margin: 1em }", "@page CompanyLetterHead:first{margin:1em}");
    minify_test("@page :first, :blank { margin: 1em }", "@page:first,:blank{margin:1em}");
    minify_test("@page toc, index { margin: 1em }", "@page toc,index{margin:1em}");
    minify_test("@page \\31 st { margin: 1em }", "@page \\31 st{margin:1em}");
    minify_test("@page a\\ b { margin: 1em }", "@page a\\ b{margin:1em}");

    minify_test("@page:left{margin:1em}", "@page:left{margin:1em}");
    minify_test("@page:first{margin:1em}", "@page:first{margin:1em}");
    minify_test("@page:blank:first{margin:1em}", "@page:blank:first{margin:1em}");
    minify_test("@page LandscapeTable{margin:1em}", "@page LandscapeTable{margin:1em}");
    minify_test("@page:first,:blank{margin:1em}", "@page:first,:blank{margin:1em}");
    minify_test("@page toc,index{margin:1em}", "@page toc,index{margin:1em}");
    minify_test("@page CompanyLetterHead:first{margin:1em}", "@page CompanyLetterHead:first{margin:1em}");
    minify_test("@page \\31 st{margin:1em}", "@page \\31 st{margin:1em}");
  });

  describe("container", () => {
    minify_test("@container (width > 100px) { a { color: red } }", "@container (width>100px){a{color:red}}");
    minify_test("@container not (width > 100px) { a { color: red } }", "@container not (width>100px){a{color:red}}");

    // `not` takes a single parenthesized query, so the grouping parens around
    // a nested and/or group must survive minification for the output to parse.
    minify_test(
      "@container not ((width > 100px) and (height > 100px)) { a { color: red } }",
      "@container not ((width>100px) and (height>100px)){a{color:red}}",
    );
    minify_test(
      "@container not ((width > 100px) or (height > 100px)) { a { color: red } }",
      "@container not ((width>100px) or (height>100px)){a{color:red}}",
    );
    minify_test(
      "@container my-layout not ((width > 100px) and (height > 100px)) { a { color: red } }",
      "@container my-layout not ((width>100px) and (height>100px)){a{color:red}}",
    );

    // A nested group keeps its parens when its operator differs from the
    // parent's; a nested group with the same operator is flattened.
    minify_test(
      "@container ((width > 100px) or (height > 100px)) and (orientation: landscape) { a { color: red } }",
      "@container ((width>100px) or (height>100px)) and (orientation:landscape){a{color:red}}",
    );
    minify_test(
      "@container ((width > 100px) and (height > 100px)) and (orientation: landscape) { a { color: red } }",
      "@container (width>100px) and (height>100px) and (orientation:landscape){a{color:red}}",
    );

    // The same grammar applies inside style() queries.
    minify_test("@container style(not (--a: 1)) { a { color: red } }", "@container style(not (--a:1)){a{color:red}}");
    minify_test(
      "@container style(not ((--a: 1) and (--b: 2))) { a { color: red } }",
      "@container style(not ((--a:1) and (--b:2))){a{color:red}}",
    );
    minify_test(
      "@container style(not ((width: 1px) and (height: 2px))) { a { color: red } }",
      "@container style(not ((width:1px) and (height:2px))){a{color:red}}",
    );
    minify_test(
      "@container style(((--a: 1) or (--b: 2)) and (--c: 3)) { a { color: red } }",
      "@container style(((--a:1) or (--b:2)) and (--c:3)){a{color:red}}",
    );
    minify_test(
      "@container style((--a: 1) or (--b: 2)) and style(--c: 3) { a { color: red } }",
      "@container style((--a:1) or (--b:2)) and style(--c:3){a{color:red}}",
    );

    // The minified forms parse back to themselves.
    minify_test(
      "@container not ((width>100px) and (height>100px)){a{color:red}}",
      "@container not ((width>100px) and (height>100px)){a{color:red}}",
    );
    minify_test(
      "@container ((width>100px) or (height>100px)) and (orientation:landscape){a{color:red}}",
      "@container ((width>100px) or (height>100px)) and (orientation:landscape){a{color:red}}",
    );
    minify_test(
      "@container style(not ((--a:1) and (--b:2))){a{color:red}}",
      "@container style(not ((--a:1) and (--b:2))){a{color:red}}",
    );
    minify_test(
      "@container style(((--a:1) or (--b:2)) and (--c:3)){a{color:red}}",
      "@container style(((--a:1) or (--b:2)) and (--c:3)){a{color:red}}",
    );
  });

  describe("mask", () => {
    // The list that `bun build` uses for `--target=browser`.
    const defaults = {
      chrome: Some(80 << 16),
      edge: Some(80 << 16),
      firefox: Some(78 << 16),
      safari: Some(14 << 16),
      opera: Some(67 << 16),
    };
    const chrome90 = { chrome: Some(90 << 16) };

    // The mask cases of `test_svg` in lightningcss 1.32.0. A case that differs from lightningcss says why.
    minify_test(".foo { mask: url('foo.svg'); }", ".foo{mask:url(foo.svg)}");
    minify_test(".foo { mask: url(masks.svg#star) luminance }", ".foo{mask:url(masks.svg#star) luminance}");
    minify_test(".foo { mask: url(masks.svg#star) 40px 20px }", ".foo{mask:url(masks.svg#star) 40px 20px}");
    minify_test(".foo { mask: url(masks.svg#star) 0 0 / 50px 50px }", ".foo{mask:url(masks.svg#star) 0 0/50px 50px}");
    minify_test(".foo { mask: url(masks.svg#star) repeat-x }", ".foo{mask:url(masks.svg#star) repeat-x}");
    minify_test(".foo { mask: url(masks.svg#star) stroke-box }", ".foo{mask:url(masks.svg#star) stroke-box}");
    minify_test(
      ".foo { mask: url(masks.svg#star) stroke-box stroke-box }",
      ".foo{mask:url(masks.svg#star) stroke-box}",
    );
    minify_test(".foo { mask: url(masks.svg#star) border-box }", ".foo{mask:url(masks.svg#star)}");
    // lightningcss prints `100%` for `right`. Bun prints `right center`, as it does for `background`.
    minify_test(
      ".foo { mask: url(masks.svg#star) left / 16px repeat-y, url(masks.svg#circle) right / 16px repeat-y }",
      ".foo{mask:url(masks.svg#star) 0/16px repeat-y,url(masks.svg#circle) right center/16px repeat-y}",
    );
    minify_test(".foo { mask-border: url('border-mask.png') 25; }", ".foo{mask-border:url(border-mask.png) 25}");
    minify_test(
      ".foo { mask-border: url('border-mask.png') 25 / 35px / 12px space alpha; }",
      ".foo{mask-border:url(border-mask.png) 25/35px/12px space}",
    );
    minify_test(
      ".foo { mask-border: url('border-mask.png') 25 / 35px / 12px space luminance; }",
      ".foo{mask-border:url(border-mask.png) 25/35px/12px space luminance}",
    );
    minify_test(
      ".foo { mask-border: url('border-mask.png') luminance 25 / 35px / 12px space; }",
      ".foo{mask-border:url(border-mask.png) 25/35px/12px space luminance}",
    );

    // lightningcss prints `-webkit-linear-gradient(top, ...)`. Bun prints no direction, as it does for `background`.
    prefix_test(
      ".foo { mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) }",
      indoc`
        .foo {
          -webkit-mask-image: -webkit-gradient(linear, 0 0, 0 100%, from(#ff0f0e), to(#7773ff));
          -webkit-mask-image: -webkit-linear-gradient(#ff0f0e, #7773ff);
          -webkit-mask-image: linear-gradient(#ff0f0e, #7773ff);
          mask-image: linear-gradient(#ff0f0e, #7773ff);
          -webkit-mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
          mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
        }
      `,
      { chrome: Some(8 << 16) },
    );
    prefix_test(
      ".foo { mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) }",
      indoc`
        .foo {
          -webkit-mask-image: linear-gradient(#ff0f0e, #7773ff);
          mask-image: linear-gradient(#ff0f0e, #7773ff);
          -webkit-mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
          mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
        }
      `,
      { chrome: Some(95 << 16) },
    );
    prefix_test(
      ".foo { mask-image: linear-gradient(red, green) }",
      indoc`
        .foo {
          -webkit-mask-image: linear-gradient(red, green);
          mask-image: linear-gradient(red, green);
        }
      `,
      { chrome: Some(95 << 16) },
    );
    prefix_test(
      ".foo { -webkit-mask-image: url(x.svg); mask-image: url(x.svg); }",
      indoc`
        .foo {
          -webkit-mask-image: url("x.svg");
          mask-image: url("x.svg");
        }
      `,
      { chrome: Some(95 << 16) },
    );
    // No direction in `-webkit-linear-gradient()`: see above.
    prefix_test(
      ".foo { mask: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 40px 20px }",
      indoc`
        .foo {
          -webkit-mask: -webkit-gradient(linear, 0 0, 0 100%, from(#ff0f0e), to(#7773ff)) 40px 20px;
          -webkit-mask: -webkit-linear-gradient(#ff0f0e, #7773ff) 40px 20px;
          -webkit-mask: linear-gradient(#ff0f0e, #7773ff) 40px 20px;
          mask: linear-gradient(#ff0f0e, #7773ff) 40px 20px;
          -webkit-mask: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 40px 20px;
          mask: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 40px 20px;
        }
      `,
      { chrome: Some(8 << 16) },
    );
    // Unlike lightningcss: the `mask` line stays. A browser that reads only `mask` has no other declaration.
    prefix_test(
      ".foo { mask: -webkit-linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 40px 20px }",
      indoc`
        .foo {
          -webkit-mask: -webkit-gradient(linear, 0 0, 0 100%, from(#ff0f0e), to(#7773ff)) 40px 20px;
          -webkit-mask: -webkit-linear-gradient(#ff0f0e, #7773ff) 40px 20px;
          mask: -webkit-linear-gradient(#ff0f0e, #7773ff) 40px 20px;
        }
      `,
      { chrome: Some(8 << 16) },
    );
    // Unlike lightningcss: no `@supports` rule with the `lab()` colors. Bun would nest one more on each pass.
    prefix_test(
      ".foo { mask: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 40px var(--foo) }",
      indoc`
        .foo {
          -webkit-mask: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 40px var(--foo);
          mask: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 40px var(--foo);
        }
      `,
      chrome90,
    );
    prefix_test(
      `
        @supports (color: lab(0% 0 0)) {
          .foo {
            mask: linear-gradient(lab(56.208% 94.4644 98.8928), lab(51% 70.4544 -115.586)) 40px var(--foo);
          }
        }
      `,
      indoc`
        @supports (color: lab(0% 0 0)) {
          .foo {
            -webkit-mask: linear-gradient(lab(56.208% 94.4644 98.8928), lab(51% 70.4544 -115.586)) 40px var(--foo);
            mask: linear-gradient(lab(56.208% 94.4644 98.8928), lab(51% 70.4544 -115.586)) 40px var(--foo);
          }
        }
      `,
      chrome90,
    );
    prefix_test(
      ".foo { mask: url(masks.svg#star) luminance }",
      indoc`
        .foo {
          -webkit-mask: url("masks.svg#star");
          -webkit-mask-source-type: luminance;
          mask: url("masks.svg#star") luminance;
        }
      `,
      chrome90,
    );
    prefix_test(
      ".foo { mask-image: url(masks.svg#star) }",
      indoc`
        .foo {
          -webkit-mask-image: url("masks.svg#star");
          mask-image: url("masks.svg#star");
        }
      `,
      chrome90,
    );
    // Unlike lightningcss: eight longhands are not folded into a `mask`. A `mask` also resets `mask-border`.
    prefix_test(
      `
        .foo {
          mask-image: url(masks.svg#star);
          mask-position: 25% 75%;
          mask-size: cover;
          mask-repeat: no-repeat;
          mask-clip: padding-box;
          mask-origin: content-box;
          mask-composite: subtract;
          mask-mode: luminance;
        }
      `,
      indoc`
        .foo {
          -webkit-mask-image: url("masks.svg#star");
          mask-image: url("masks.svg#star");
          -webkit-mask-position: 25% 75%;
          mask-position: 25% 75%;
          -webkit-mask-size: cover;
          mask-size: cover;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-clip: padding-box;
          mask-clip: padding-box;
          -webkit-mask-origin: content-box;
          mask-origin: content-box;
          -webkit-mask-composite: source-out;
          mask-composite: subtract;
          -webkit-mask-source-type: luminance;
          mask-mode: luminance;
        }
      `,
      chrome90,
    );
    // Not folded: see above.
    prefix_test(
      `
        .foo {
          mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
          mask-position: 25% 75%;
          mask-size: cover;
          mask-repeat: no-repeat;
          mask-clip: padding-box;
          mask-origin: content-box;
          mask-composite: subtract;
          mask-mode: luminance;
        }
      `,
      indoc`
        .foo {
          -webkit-mask-image: linear-gradient(#ff0f0e, #7773ff);
          mask-image: linear-gradient(#ff0f0e, #7773ff);
          -webkit-mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
          mask-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
          -webkit-mask-position: 25% 75%;
          mask-position: 25% 75%;
          -webkit-mask-size: cover;
          mask-size: cover;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-clip: padding-box;
          mask-clip: padding-box;
          -webkit-mask-origin: content-box;
          mask-origin: content-box;
          -webkit-mask-composite: source-out;
          mask-composite: subtract;
          -webkit-mask-source-type: luminance;
          mask-mode: luminance;
        }
      `,
      chrome90,
    );
    cssTest(
      `
        .foo {
          mask: none center / 100% no-repeat;
          mask-image: var(--svg);
        }
      `,
      indoc`
        .foo {
          mask: none center / 100% no-repeat;
          mask-image: var(--svg);
        }
      `,
    );
    prefix_test(
      ".foo { mask-composite: subtract; }",
      indoc`
        .foo {
          -webkit-mask-composite: source-out;
          mask-composite: subtract;
        }
      `,
      chrome90,
    );
    prefix_test(
      ".foo { mask-mode: luminance; }",
      indoc`
        .foo {
          -webkit-mask-source-type: luminance;
          mask-mode: luminance;
        }
      `,
      chrome90,
    );
    // Unlike lightningcss: the slice is stated again. `-webkit-mask-box-image` fills the middle, its slice longhand does not.
    prefix_test(
      ".foo { mask-border: url('border-mask.png') 25 / 35px / 12px space luminance; }",
      indoc`
        .foo {
          -webkit-mask-box-image: url("border-mask.png") 25 / 35px / 12px space;
          -webkit-mask-box-image-slice: 25;
          mask-border: url("border-mask.png") 25 / 35px / 12px space luminance;
        }
      `,
      chrome90,
    );
    // The slice is stated again: see above.
    prefix_test(
      ".foo { mask-border: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 25 / 35px / 12px space luminance; }",
      indoc`
        .foo {
          -webkit-mask-box-image: linear-gradient(#ff0f0e, #7773ff) 25 / 35px / 12px space;
          -webkit-mask-box-image-slice: 25;
          mask-border: linear-gradient(#ff0f0e, #7773ff) 25 / 35px / 12px space luminance;
          -webkit-mask-box-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 25 / 35px / 12px space;
          -webkit-mask-box-image-slice: 25;
          mask-border: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) 25 / 35px / 12px space luminance;
        }
      `,
      chrome90,
    );
    prefix_test(
      ".foo { mask-border-source: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)); }",
      indoc`
        .foo {
          -webkit-mask-box-image-source: linear-gradient(#ff0f0e, #7773ff);
          mask-border-source: linear-gradient(#ff0f0e, #7773ff);
          -webkit-mask-box-image-source: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
          mask-border-source: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364));
        }
      `,
      chrome90,
    );
    // Unlike lightningcss: the longhands are not folded. The `-webkit-mask-box-image` shorthand would add `fill`.
    prefix_test(
      `
        .foo {
          mask-border-source: url(foo.png);
          mask-border-slice: 10 40 10 40;
          mask-border-width: 10px;
          mask-border-outset: 0;
          mask-border-repeat: round round;
          mask-border-mode: luminance;
        }
      `,
      indoc`
        .foo {
          -webkit-mask-box-image-source: url("foo.png");
          mask-border-source: url("foo.png");
          -webkit-mask-box-image-slice: 10 40;
          mask-border-slice: 10 40;
          -webkit-mask-box-image-width: 10px;
          mask-border-width: 10px;
          -webkit-mask-box-image-outset: 0;
          mask-border-outset: 0;
          -webkit-mask-box-image-repeat: round;
          mask-border-repeat: round;
          mask-border-mode: luminance;
        }
      `,
      chrome90,
    );
    // Not folded: see above.
    prefix_test(
      `
        .foo {
          -webkit-mask-box-image-source: url(foo.png);
          -webkit-mask-box-image-slice: 10 40 10 40;
          -webkit-mask-box-image-width: 10px;
          -webkit-mask-box-image-outset: 0;
          -webkit-mask-box-image-repeat: round round;
        }
      `,
      indoc`
        .foo {
          -webkit-mask-box-image-source: url("foo.png");
          -webkit-mask-box-image-slice: 10 40;
          -webkit-mask-box-image-width: 10px;
          -webkit-mask-box-image-outset: 0;
          -webkit-mask-box-image-repeat: round;
        }
      `,
      chrome90,
    );
    prefix_test(
      ".foo { mask-border-slice: 10 40 10 40; }",
      indoc`
        .foo {
          -webkit-mask-box-image-slice: 10 40;
          mask-border-slice: 10 40;
        }
      `,
      chrome90,
    );
    prefix_test(
      ".foo { mask-border-slice: var(--foo); }",
      indoc`
        .foo {
          -webkit-mask-box-image-slice: var(--foo);
          mask-border-slice: var(--foo);
        }
      `,
      chrome90,
    );
    // No `@supports` rule with the `lab()` colors: see above.
    prefix_test(
      ".foo { mask-border: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) var(--foo); }",
      indoc`
        .foo {
          -webkit-mask-box-image: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) var(--foo);
          mask-border: linear-gradient(lch(56.208% 136.76 46.312), lch(51% 135.366 301.364)) var(--foo);
        }
      `,
      chrome90,
    );
    prefix_test(".foo { transition: mask 200ms; }", ".foo { transition: -webkit-mask .2s, mask .2s; }", chrome90);
    prefix_test(
      ".foo { transition: mask-border 200ms; }",
      ".foo { transition: -webkit-mask-box-image .2s, mask-border .2s; }",
      chrome90,
    );
    prefix_test(".foo { transition-property: mask; }", ".foo { transition-property: -webkit-mask, mask; }", chrome90);
    prefix_test(
      ".foo { transition-property: mask-border; }",
      ".foo { transition-property: -webkit-mask-box-image, mask-border; }",
      chrome90,
    );
    prefix_test(
      ".foo { transition-property: mask-composite, mask-mode; }",
      ".foo { transition-property: -webkit-mask-composite, mask-composite, -webkit-mask-source-type, mask-mode; }",
      chrome90,
    );

    describe("under the default browsers", () => {
      const line = (declaration: string, expected: string) =>
        prefix_test(`.foo { ${declaration} }`, `.foo { ${expected} }`, defaults);

      line(
        "mask-image: linear-gradient(black, transparent)",
        "-webkit-mask-image: linear-gradient(#000, #0000); mask-image: linear-gradient(#000, #0000);",
      );
      line("mask-image: url(a.png)", '-webkit-mask-image: url("a.png"); mask-image: url("a.png");');
      line("mask-repeat: no-repeat", "-webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;");
      // A written `mask-position` value stays text. Bun would print `right 40%` as `right top 40%`, which Chrome rejects for this name.
      line("mask-position: left top", "-webkit-mask-position: left top; mask-position: left top;");
      line("mask-position: right 40%", "-webkit-mask-position: right 40%; mask-position: right 40%;");
      line("mask-position: 10px bottom", "-webkit-mask-position: 10px bottom; mask-position: 10px bottom;");
      line(
        "mask-position: 10px 20px, center",
        "-webkit-mask-position: 10px 20px, center; mask-position: 10px 20px, center;",
      );
      line("mask-clip: padding-box", "-webkit-mask-clip: padding-box; mask-clip: padding-box;");
      line("mask-origin: content-box", "-webkit-mask-origin: content-box; mask-origin: content-box;");
      line("mask-size: cover", "-webkit-mask-size: cover; mask-size: cover;");
      line("mask: url(a.png)", '-webkit-mask: url("a.png"); mask: url("a.png");');
      line(
        "mask: url(a.png) center / contain no-repeat",
        '-webkit-mask: url("a.png") center / contain no-repeat; mask: url("a.png") center / contain no-repeat;',
      );
      line("mask-composite: add", "-webkit-mask-composite: source-over; mask-composite: add;");
      line(
        "mask-composite: add, subtract, intersect, exclude",
        "-webkit-mask-composite: source-over, source-out, source-in, xor; mask-composite: add, subtract, intersect, exclude;",
      );
      line("mask-mode: match-source", "-webkit-mask-source-type: auto; mask-mode: match-source;");
      line(
        "mask: url(a.png) subtract luminance",
        '-webkit-mask: url("a.png"); -webkit-mask-composite: source-out; -webkit-mask-source-type: luminance; mask: url("a.png") subtract luminance;',
      );
      line(
        "mask-border-source: url(a.png)",
        '-webkit-mask-box-image-source: url("a.png"); mask-border-source: url("a.png");',
      );
      line("mask-border-slice: 10", "-webkit-mask-box-image-slice: 10; mask-border-slice: 10;");
      line("mask-border-width: 10px", "-webkit-mask-box-image-width: 10px; mask-border-width: 10px;");
      line("mask-border-outset: 1", "-webkit-mask-box-image-outset: 1; mask-border-outset: 1;");
      line("mask-border-repeat: round", "-webkit-mask-box-image-repeat: round; mask-border-repeat: round;");
      line(
        "mask-border: url(a.png) 25 fill",
        '-webkit-mask-box-image: url("a.png") 25 fill; mask-border: url("a.png") 25 fill;',
      );
      // A `mask-border` with no slice has the slice 0. Bun holds the `border-image` default for it and prints none.
      line(
        "mask-border: url(a.png)",
        '-webkit-mask-box-image: url("a.png"); -webkit-mask-box-image-slice: 0; mask-border: url("a.png");',
      );
      line(
        "mask-image: image-set(url(a.png) 1x, url(b.png) 2x)",
        `-webkit-mask-image: -webkit-image-set(url("a.png") 1x, url("b.png") 2x);
         -webkit-mask-image: image-set("a.png" 1x, "b.png" 2x);
         mask-image: image-set("a.png" 1x, "b.png" 2x);`,
      );
      // These have no prefixed form.
      line("mask-type: alpha", "mask-type: alpha;");
      line("mask-border-mode: luminance", "mask-border-mode: luminance;");
      line("mask-position-x: left", "mask-position-x: left;");

      // A value that did not parse gets the same copies, so that a reset reaches the prefixed name too.
      line("mask-image: var(--x)", "-webkit-mask-image: var(--x); mask-image: var(--x);");
      line("mask-size: initial", "-webkit-mask-size: initial; mask-size: initial;");
      line("mask: var(--x)", "-webkit-mask: var(--x); mask: var(--x);");
      line("mask: unset", "-webkit-mask: unset; mask: unset;");
      line("mask-border: var(--x)", "-webkit-mask-box-image: var(--x); mask-border: var(--x);");
      line("mask-border-slice: inherit", "-webkit-mask-box-image-slice: inherit; mask-border-slice: inherit;");
      // Unlike lightningcss: also for the composite and the mode, as esbuild and autoprefixer do.
      line("mask-composite: var(--x)", "-webkit-mask-composite: var(--x); mask-composite: var(--x);");
      line("mask-composite: initial", "-webkit-mask-composite: initial; mask-composite: initial;");
      line("mask-mode: var(--x)", "-webkit-mask-source-type: var(--x); mask-mode: var(--x);");

      // Unlike lightningcss: a prefix that the author wrote stays, also when no target needs it.
      prefix_test(
        ".foo { -webkit-mask-image: url(x.svg); mask-image: url(x.svg) }",
        '.foo { -webkit-mask-image: url("x.svg"); mask-image: url("x.svg"); }',
        { chrome: Some(125 << 16) },
      );
      prefix_test(".foo { mask: url(x.svg) exclude }", '.foo { mask: url("x.svg") exclude; }', {
        chrome: Some(125 << 16),
      });
      line("-webkit-mask: url(a.png)", '-webkit-mask: url("a.png");');
      line("-webkit-mask-clip: text", "-webkit-mask-clip: text;");
      line("-webkit-mask-composite: xor", "-webkit-mask-composite: xor;");
      line("-webkit-mask-source-type: luminance", "-webkit-mask-source-type: luminance;");
      line("-webkit-mask-box-image: url(a.png) 25", '-webkit-mask-box-image: url("a.png") 25;');
      // Only a browser that reads `-webkit-mask` as `mask` takes a composite keyword in it: it stays as written.
      line("-webkit-mask: none exclude", "-webkit-mask: none exclude;");

      // Unlike lightningcss: a prefix that the block already wrote for a longhand is not added again.
      line(
        "-webkit-mask-image: url(a.png); mask-image: url(b.png)",
        '-webkit-mask-image: url("a.png"); mask-image: url("b.png");',
      );
      line("-webkit-mask-size: cover; mask-size: contain", "-webkit-mask-size: cover; mask-size: contain;");
      line("-webkit-mask: url(a.png); mask: url(b.png)", '-webkit-mask: url("a.png"); mask: url("b.png");');
      line(
        "-webkit-mask-composite: destination-in; mask-composite: intersect",
        "-webkit-mask-composite: destination-in; mask-composite: intersect;",
      );
      line(
        "-webkit-mask-source-type: alpha; mask-mode: luminance",
        "-webkit-mask-source-type: alpha; mask-mode: luminance;",
      );
      line(
        "-webkit-mask-box-image: url(a.png) 25; mask-border: url(b.png) 25",
        '-webkit-mask-box-image: url("a.png") 25; mask-border: url("b.png") 25;',
      );
      line(
        "-webkit-mask-box-image-slice: 10; mask-border-slice: 20",
        "-webkit-mask-box-image-slice: 10; mask-border-slice: 20;",
      );
      line("-webkit-mask-image: var(--a); mask-image: var(--b)", "-webkit-mask-image: var(--a); mask-image: var(--b);");
      // `-webkit-mask` sets the six longhands and the source type. It never set the composite.
      line("-webkit-mask: url(a.png); mask-image: url(b.png)", '-webkit-mask: url("a.png"); mask-image: url("b.png");');
      line("-webkit-mask: url(a.png); mask-mode: luminance", '-webkit-mask: url("a.png"); mask-mode: luminance;');
      line(
        "-webkit-mask: url(a.png); mask-composite: exclude",
        '-webkit-mask: url("a.png"); -webkit-mask-composite: xor; mask-composite: exclude;',
      );
      line(
        "-webkit-mask: url(a.png); mask: url(a.png) exclude",
        '-webkit-mask: url("a.png"); -webkit-mask-composite: xor; mask: url("a.png") exclude;',
      );
      // A prefixed longhand before `mask`: the copy is one longhand for each that the block did not write.
      line(
        "-webkit-mask-size: cover; mask: url(a.png)",
        `-webkit-mask-size: cover;
         -webkit-mask-image: url("a.png");
         -webkit-mask-position: 0 0;
         -webkit-mask-repeat: repeat;
         -webkit-mask-clip: border-box;
         -webkit-mask-origin: border-box;
         -webkit-mask-source-type: auto;
         mask: url("a.png");`,
      );
      // A `var()` cannot be split into longhands.
      line("-webkit-mask-size: cover; mask: var(--x)", "-webkit-mask-size: cover; mask: var(--x);");
      line(
        "-webkit-mask-box-image-slice: 10; mask-border: url(a.png) 25",
        `-webkit-mask-box-image-slice: 10;
         -webkit-mask-box-image-source: url("a.png");
         -webkit-mask-box-image-width: auto;
         -webkit-mask-box-image-outset: 0;
         -webkit-mask-box-image-repeat: stretch;
         mask-border: url("a.png") 25;`,
      );

      // An equal value merges into the declaration before it. The names of both stay.
      line("-webkit-mask-size: cover; mask-size: cover", "-webkit-mask-size: cover; mask-size: cover;");
      line("mask-size: cover; -webkit-mask-size: cover", "-webkit-mask-size: cover; mask-size: cover;");
      line("mask-size: cover; mask-size: cover", "-webkit-mask-size: cover; mask-size: cover;");
      line("-webkit-mask: none; mask: none", "-webkit-mask: none; mask: none;");
      line(
        "mask: none exclude; mask: none exclude",
        "-webkit-mask: none; -webkit-mask-composite: xor; mask: none exclude;",
      );
      line(
        "mask-composite: exclude; -webkit-mask-composite: xor",
        "-webkit-mask-composite: xor; mask-composite: exclude;",
      );
      line(
        "-webkit-mask-composite: xor; mask-composite: exclude",
        "-webkit-mask-composite: xor; mask-composite: exclude;",
      );
      line(
        "mask-border-slice: 10; -webkit-mask-box-image-slice: 10",
        "-webkit-mask-box-image-slice: 10; mask-border-slice: 10;",
      );
      line("mask-image: var(--x); mask-image: var(--x)", "-webkit-mask-image: var(--x); mask-image: var(--x);");
      // Each `url()` is its own import, so two of them are never one value. The third line changes no winner.
      line(
        "mask-image: url(a.png); -webkit-mask-image: url(a.png)",
        '-webkit-mask-image: url("a.png"); mask-image: url("a.png"); -webkit-mask-image: url("a.png");',
      );

      // Unlike lightningcss: a second value is a new declaration. The first one stays for a browser that cannot read the second.
      line(
        "mask-size: cover; mask-size: contain",
        "-webkit-mask-size: cover; mask-size: cover; -webkit-mask-size: contain; mask-size: contain;",
      );
      line(
        "mask: none; mask-image: none, none",
        "-webkit-mask: none; mask: none; -webkit-mask-image: none, none; mask-image: none, none;",
      );

      // Unlike lightningcss: nothing moves. These change the winner in lightningcss 1.32.0.
      line(
        "-webkit-mask-size: cover; mask-size: cover; -webkit-mask-size: contain",
        "-webkit-mask-size: cover; mask-size: cover; -webkit-mask-size: contain;",
      );
      line(
        "mask: none exclude; -webkit-mask: none",
        "-webkit-mask: none; -webkit-mask-composite: xor; mask: none exclude; -webkit-mask: none;",
      );
      line("-webkit-mask: none; -webkit-mask-composite: xor", "-webkit-mask: none; -webkit-mask-composite: xor;");
      line("-webkit-mask-composite: xor; -webkit-mask: none", "-webkit-mask-composite: xor; -webkit-mask: none;");
      line(
        "mask-position: 0 0; mask-position-x: 10px",
        "-webkit-mask-position: 0 0; mask-position: 0 0; mask-position-x: 10px;",
      );
      line("mask-size: cover; all: unset", "-webkit-mask-size: cover; mask-size: cover; all: unset;");
      line(
        "mask-size: cover; all: unset; mask-size: cover",
        "-webkit-mask-size: cover; mask-size: cover; all: unset; -webkit-mask-size: cover; mask-size: cover;",
      );
      // `all` also resets the prefixed longhand, so the copy is written again.
      line(
        "-webkit-mask-size: cover; all: unset; mask-size: contain",
        "-webkit-mask-size: cover; all: unset; -webkit-mask-size: contain; mask-size: contain;",
      );
      // An unknown name can be one more spelling of a mask longhand, so nothing merges across it.
      line(
        "mask-size: cover; -webkit-mask-repeat-x: repeat; mask-size: cover",
        "-webkit-mask-size: cover; mask-size: cover; -webkit-mask-repeat-x: repeat; -webkit-mask-size: cover; mask-size: cover;",
      );
      line("mask-size: cover; --x: 1; mask-size: cover", "-webkit-mask-size: cover; mask-size: cover; --x: 1;");
      line("mask-size: cover; color: red; mask-size: cover", "-webkit-mask-size: cover; mask-size: cover; color: red;");
      // A longhand between two equal shorthands is overridden by the second one.
      line(
        "mask: none; mask-size: cover; mask: none",
        "-webkit-mask: none; mask: none; -webkit-mask-size: cover; mask-size: cover; -webkit-mask: none; mask: none;",
      );
      // A later declaration of a longhand gets its copy too. lightningcss 1.32.0 leaves `none` in force for the prefix.
      line(
        "mask-image: none; mask-size: var(--x); mask-image: linear-gradient(red, blue)",
        `-webkit-mask-image: none;
         mask-image: none;
         -webkit-mask-size: var(--x);
         mask-size: var(--x);
         -webkit-mask-image: linear-gradient(red, #00f);
         mask-image: linear-gradient(red, #00f);`,
      );
      // The old `-webkit-mask` does not reset the composite: the copy states it when the block has a line for it.
      line(
        "mask-composite: exclude; cursor: pointer; mask: none",
        `-webkit-mask-composite: xor;
         mask-composite: exclude;
         cursor: pointer;
         -webkit-mask: none;
         -webkit-mask-composite: source-over;
         mask: none;`,
      );
      // `mask` resets `mask-border`, and the old `-webkit-mask` does not reset `-webkit-mask-box-image`.
      line(
        "mask-border: url(b.png) 25 fill; mask: url(a.png)",
        `-webkit-mask-box-image: url("b.png") 25 fill;
         mask-border: url("b.png") 25 fill;
         -webkit-mask-box-image: initial;
         -webkit-mask: url("a.png");
         mask: url("a.png");`,
      );
      line(
        "mask-border-slice: 10; mask: none",
        `-webkit-mask-box-image-slice: 10;
         mask-border-slice: 10;
         -webkit-mask-box-image-slice: initial;
         -webkit-mask: none;
         mask: none;`,
      );
      line(
        "mask: url(a.png); mask-border: url(b.png) 25 fill",
        `-webkit-mask: url("a.png");
         mask: url("a.png");
         -webkit-mask-box-image: url("b.png") 25 fill;
         mask-border: url("b.png") 25 fill;`,
      );

      // A fallback is for a browser that can read no earlier declaration. The first value here is one it can read.
      line(
        "mask-image: linear-gradient(red, green); mask-image: linear-gradient(lch(50% 132 50), lch(50% 130 150))",
        `-webkit-mask-image: linear-gradient(red, green);
         mask-image: linear-gradient(red, green);
         -webkit-mask-image: linear-gradient(lch(50% 132 50), lch(50% 130 150));
         mask-image: linear-gradient(lch(50% 132 50), lch(50% 130 150));`,
      );

      // The `!important` declarations are a list of their own. A prefix in one list counts for the other.
      line(
        "-webkit-mask-image: url(a.png); mask-image: url(b.png) !important",
        '-webkit-mask-image: url("a.png"); mask-image: url("b.png") !important;',
      );
      line(
        "mask-image: url(b.png) !important; -webkit-mask-image: url(a.png)",
        '-webkit-mask-image: url("a.png"); mask-image: url("b.png") !important;',
      );
      line(
        "mask-size: cover !important; mask-size: contain",
        "-webkit-mask-size: contain; mask-size: contain; -webkit-mask-size: cover !important; mask-size: cover !important;",
      );
      line(
        "mask-composite: exclude; mask: none !important",
        `-webkit-mask-composite: xor;
         mask-composite: exclude;
         -webkit-mask: none !important;
         -webkit-mask-composite: source-over !important;
         mask: none !important;`,
      );

      // A rule that starts hidden and an animation that reveals it: both need the copy, or the rule stays hidden.
      prefix_test(
        `
          .reveal { mask-size: 0% 100%; animation: reveal 1s forwards; }
          @keyframes reveal { to { mask-size: 100% 100%; } }
        `,
        indoc`
          .reveal {
            -webkit-mask-size: 0% 100%;
            mask-size: 0% 100%;
            animation: 1s forwards reveal;
          }

          @keyframes reveal {
            to {
              -webkit-mask-size: 100% 100%;
              mask-size: 100% 100%;
            }
          }
        `,
        defaults,
      );
      prefix_test(
        "@keyframes k { from { opacity: 0; mask-composite: exclude; } to { mask: var(--m); -webkit-mask-position: 0 0; mask-position: 10px 0; } }",
        indoc`
          @keyframes k {
            from {
              opacity: 0;
              -webkit-mask-composite: xor;
              mask-composite: exclude;
            }

            to {
              -webkit-mask: var(--m);
              mask: var(--m);
              -webkit-mask-position: 0 0;
              mask-position: 10px 0;
            }
          }
        `,
        defaults,
      );

      // Two rules with one selector are merged and minified again.
      prefix_test(
        ".a { mask: none exclude } .a { color: red }",
        ".a { -webkit-mask: none; -webkit-mask-composite: xor; mask: none exclude; color: red; }",
        defaults,
      );
      // Each rule gets its own copies, as in lightningcss, autoprefixer and esbuild.
      prefix_test(
        ".a { -webkit-mask-size: cover } .a { mask-size: contain }",
        ".a { -webkit-mask-size: cover; -webkit-mask-size: contain; mask-size: contain; }",
        defaults,
      );

      // A rule is a duplicate of a later one only when the property names are equal too.
      minify_test(
        ".btn{-webkit-mask-image:none;mask-image:none;cursor:pointer}.q{top:0}.btn{mask-image:none;vertical-align:middle}",
        ".btn{-webkit-mask-image:none;mask-image:none;cursor:pointer}.q{top:0}.btn{mask-image:none;vertical-align:middle}",
      );
      minify_test(
        ".a{-webkit-mask-composite:xor}.q{top:0}.a{-khtml-foo:bar}",
        ".a{-webkit-mask-composite:xor}.q{top:0}.a{-khtml-foo:bar}",
      );
      prefix_test(
        ".btn { mask-size: cover; cursor: pointer } .q { top: 0 } .btn { mask-size: cover; vertical-align: middle }",
        indoc`
          .btn {
            -webkit-mask-size: cover;
            mask-size: cover;
            cursor: pointer;
          }

          .q {
            top: 0;
          }

          .btn {
            -webkit-mask-size: cover;
            mask-size: cover;
            vertical-align: middle;
          }
        `,
        defaults,
      );
    });

    // lightningcss 1.32.0 adds one more line on each pass for these. Bun minifies a merged rule again.
    test("a second pass changes nothing", () => {
      for (const declarations of [
        "mask: url(a.png) subtract",
        "mask: url(a.png) luminance",
        "mask-composite: subtract",
        "mask-mode: luminance",
        "mask-image: var(--x)",
        "mask: var(--x)",
        "mask-composite: var(--x)",
        "mask-border: var(--x)",
        "mask-border: url(a.png) 25",
        "mask-image: linear-gradient(lch(50% 132 50), lch(50% 130 150))",
        "mask-image: image-set(url(a.png) 1x, url(b.png) 2x)",
        "mask-border: url(b.png) 25; mask: url(a.png)",
        "mask-composite: exclude; cursor: pointer; mask: none",
        "-webkit-mask-size: cover; mask: url(a.png)",
      ]) {
        const once = prefix_test_output(`.foo { ${declarations} }`, "", defaults);
        expect(prefix_test_output(once, "", defaults)).toBe(once);
      }
    });

    // With no browser list (`--target=bun`) nothing is added and nothing merges.
    minify_test(".foo { mask-image: none }", ".foo{mask-image:none}");
    minify_test(".foo { mask: none exclude }", ".foo{mask:none exclude}");
    minify_test(".foo { mask-composite: exclude }", ".foo{mask-composite:exclude}");
    minify_test(".foo { mask-border: url(a.png) 25 }", ".foo{mask-border:url(a.png) 25}");
    minify_test(
      ".foo { -webkit-mask-size: cover; mask-size: cover; mask-size: cover }",
      ".foo{-webkit-mask-size:cover;mask-size:cover;mask-size:cover}",
    );
    // `mask-position` stays as written (see above). `-webkit-mask-composite` parses as a typed value now.
    minify_test(".foo { mask-position: right 40% }", ".foo{mask-position:right 40%}");
    minify_test(".foo { -webkit-mask-position: 10% 20%, left }", ".foo{-webkit-mask-position:10% 20%,left}");
    minify_test(".foo { mask-position: var(--p) }", ".foo{mask-position:var(--p)}");
    minify_test(".foo { -WEBKIT-MASK-COMPOSITE: XOR }", ".foo{-webkit-mask-composite:xor}");
    minify_test(".foo { -webkit-mask-composite: exclude }", ".foo{-webkit-mask-composite:exclude}");
    minify_test(
      ".foo { transition-property: -webkit-mask-composite }",
      ".foo{transition-property:-webkit-mask-composite}",
    );
    minify_test(
      "@supports (-webkit-mask-composite: xor) { .foo { color: red } }",
      "@supports (-webkit-mask-composite: xor){.foo{color:red}}",
    );

    type Declaration = { name: string; value: string; important: boolean };
    // What a browser applies: one value for each longhand that a test follows.
    type Applied = (string | undefined)[];
    type Read = Declaration & { sets: Applied[] };
    type Readers<Browser> = {
      declaration: (text: string) => Read;
      applied: (declarations: Read[], browser: Browser) => Applied;
    };
    // A debug build runs JavaScript slowly: the helpers below compute a result once for each distinct argument.
    const memo = <Key, Value>(compute: (key: Key) => Value) => {
      const results = new Map<Key, Value>();
      return (key: Key) => {
        let result = results.get(key);
        if (result === undefined) results.set(key, (result = compute(key)));
        return result;
      };
    };
    // A debug build runs this JavaScript about 50 times slower, so it takes the blocks of up to three declarations.
    const longest = isDebug || isASAN ? 3 : 4;
    const blocksOf = (atoms: string[], longest: number) => {
      const blocks: string[][] = [];
      for (let length = 1, last: string[][] = [[]]; length <= longest; length++) {
        last = last.flatMap(block => atoms.map(atom => [...block, atom]));
        blocks.push(...last);
      }
      return blocks;
    };
    // The declaration lines of each rule of a printed sheet, by the number in the name of the rule.
    const linesOf = (output: string) => {
      const rules: string[][] = [];
      let rule: string[] = [];
      for (const line of output.split("\n")) {
        const last = line.charCodeAt(line.length - 1);
        // `.r1, .r5 {` or `@keyframes r1 {` starts a rule. A declaration ends with `;`.
        if (last === 123 && line.charCodeAt(0) !== 32) {
          rule = [];
          for (const number of line.match(/\d+/g) ?? []) rules[+number] = rule;
        } else if (last === 59) rule.push(line);
      }
      return rules;
    };
    // Every block of up to `longest` declarations from `atoms`, under the default browsers. `sets` says what a declaration sets in a browser.
    const everyBlock = <Browser>(
      atoms: string[],
      browsers: Record<string, Browser>,
      initial: Record<string, string>,
      sets: (declaration: Declaration, browser: Browser) => Record<string, string>,
      model: (readers: Readers<Browser>) => (source: Read[], browser: Browser) => Applied,
    ) => {
      const names = Object.keys(browsers);
      const list = Object.values(browsers);
      const longhands = Object.keys(initial);
      const declaration = memo((text: string): Read => {
        const [, name, value, important] = text.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*(!important)?;?$/)!;
        const parsed = { name, value: value.replaceAll('"', ""), important: !!important };
        const effects = list.map(browser => sets(parsed, browser));
        return { ...parsed, sets: effects.map(effect => longhands.map(longhand => effect[longhand])) };
      });
      // The last declaration that sets a longhand wins, an `!important` one first.
      const applied = (declarations: Read[], browser: Browser) => {
        const b = list.indexOf(browser);
        const normal: Applied = [];
        const important: Applied = [];
        for (let k = 0; k < longhands.length; k++) normal[k] = initial[longhands[k]];
        for (let i = 0; i < declarations.length; i++) {
          const effect = declarations[i].sets[b];
          const layer = declarations[i].important ? important : normal;
          for (let k = 0; k < effect.length; k++) if (effect[k] !== undefined) layer[k] = effect[k];
        }
        for (let k = 0; k < important.length; k++) if (important[k] !== undefined) normal[k] = important[k];
        return normal;
      };
      const expected = model({ declaration, applied });

      const blocks = blocksOf(atoms, longest);
      const output = prefix_test_output(
        blocks.map((block, i) => `.r${i}{${block.join(";")}}`).join("\n"),
        "",
        defaults,
      );
      const printed = linesOf(output);
      // `wrong` lists the blocks where a browser applies another value for the output than `model` gives for the source.
      const wrong: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const source = blocks[i].map(declaration);
        const lines = (printed[i] ?? []).map(declaration);
        for (let b = 0; b < list.length; b++) {
          const [got, want] = [applied(lines, list[b]), expected(source, list[b])];
          for (let k = 0; k < longhands.length; k++) {
            if (got[k] !== want[k])
              wrong.push(`${blocks[i].join(";")} in ${names[b]}: ${longhands[k]} ${got[k]}, not ${want[k]}`);
          }
        }
      }
      return { blocks, output, wrong };
    };
    const OLD: Record<string, string> = {
      add: "source-over",
      subtract: "source-out",
      intersect: "source-in",
      exclude: "xor",
    };

    type MaskBrowser = { names: "standard" | "both" | "prefixed"; alias: boolean; composite: boolean };
    const maskBrowsers: Record<string, MaskBrowser> = {
      "a browser with only the standard names": { names: "standard", alias: false, composite: false },
      // `-webkit-mask` is `mask` under another name.
      "Chrome 120": { names: "both", alias: true, composite: true },
      // Also an alias, but Firefox does not read `-webkit-mask-composite`.
      "Firefox": { names: "both", alias: true, composite: false },
      // `-webkit-mask` is the old shorthand: it sets the image and not the composite, and takes no composite keyword.
      "Safari 15.4": { names: "both", alias: false, composite: true },
      "Chrome 119 and Safari 15.3": { names: "prefixed", alias: false, composite: true },
    };
    // The image and the composite that one declaration sets in a browser.
    const maskSets = ({ name, value }: Declaration, { names, alias, composite: oldComposite }: MaskBrowser) => {
      const standard = names !== "prefixed";
      const prefixed = names !== "standard";
      const [image, keyword] = value.split(" ");
      const shorthand = { image, composite: OLD[keyword ?? "add"] ?? image };
      if (name === "all") return { image: "none", composite: "source-over" };
      if (name === "mask-image" && standard) return { image: value };
      if (name === "-webkit-mask-image" && prefixed) return { image: value };
      if (name === "mask-composite" && standard) return { composite: OLD[value] ?? value };
      if (name === "-webkit-mask-composite" && prefixed && oldComposite) return { composite: value };
      if (name === "mask" && standard) return shorthand;
      if (name === "-webkit-mask" && prefixed && alias) return shorthand;
      if (name === "-webkit-mask" && prefixed && !keyword) return { image };
      return {};
    };
    // A prefix-only browser gets a copy of each standard declaration, for each longhand that the block has not written with `-webkit-`.
    const maskModel = ({ declaration, applied }: Readers<MaskBrowser>) => {
      const facts = memo(({ name, value, important }: Read) => {
        const [image, keyword] = value.split(" ");
        const copy = (name: string, value: string) => declaration(`${name}:${value}${important ? "!important" : ""}`);
        return {
          all: name === "all",
          writesImage: name === "-webkit-mask-image" || name === "-webkit-mask",
          writesComposite: name === "-webkit-mask-composite",
          image:
            name === "mask-image"
              ? copy("-webkit-mask-image", value)
              : name === "mask"
                ? copy("-webkit-mask-image", image)
                : undefined,
          // The copy of a `var()` shorthand cannot carry a composite.
          composite:
            name === "mask-composite"
              ? copy("-webkit-mask-composite", OLD[value] ?? value)
              : name === "mask" && !image.startsWith("var(")
                ? copy("-webkit-mask-composite", OLD[keyword ?? "add"])
                : undefined,
        };
      });
      const forPrefixOnly = (source: Read[]) => {
        const all = source.map(facts);
        // What each list writes with `-webkit-`: [image, composite] for the declarations that are not `!important`, then for those that are.
        const anywhere = [false, false, false, false];
        for (let i = 0; i < all.length; i++) {
          const list = source[i].important ? 2 : 0;
          anywhere[list] ||= all[i].writesImage;
          anywhere[list + 1] ||= all[i].writesComposite;
        }
        // What counts as written: the declarations before this one in its own list since `all`, and all of the other list.
        const before = [false, false, false, false];
        const out: Read[] = [];
        for (let i = 0; i < all.length; i++) {
          const { all: reset, writesImage, writesComposite, image, composite } = all[i];
          const [list, other] = source[i].important ? [2, 0] : [0, 2];
          if (image && !before[list] && !anywhere[other]) out.push(image);
          if (composite && !before[list + 1] && !anywhere[other + 1]) out.push(composite);
          out.push(source[i]);
          before[list] = !reset && (before[list] || writesImage);
          before[list + 1] = !reset && (before[list + 1] || writesComposite);
        }
        return out;
      };
      return (source: Read[], browser: MaskBrowser) =>
        applied(browser.names === "prefixed" ? forPrefixOnly(source) : source, browser);
    };
    const maskAtoms = {
      "the image": [
        "mask-image:url(a.png)",
        "mask-image:var(--v)",
        "-webkit-mask-image:url(b.png)",
        "mask:url(c.png)",
        "-webkit-mask:url(d.png)",
        "all:unset",
      ],
      "the composite": [
        "mask-composite:exclude",
        "-webkit-mask-composite:destination-in",
        "mask:url(c.png)",
        "mask:url(c.png) exclude",
        "-webkit-mask:url(d.png)",
        "cursor:pointer",
      ],
      "`!important`": [
        "mask-image:url(a.png)",
        "mask-image:url(b.png)!important",
        "-webkit-mask-image:url(c.png)",
        "-webkit-mask-image:url(d.png)!important",
        "mask:url(e.png)!important",
        "mask-composite:exclude",
      ],
    };

    for (const [part, atoms] of Object.entries(maskAtoms)) {
      test(`a mask prefix changes no winning declaration: ${part}`, () => {
        const { blocks, output, wrong } = everyBlock(
          atoms,
          maskBrowsers,
          { image: "none", composite: "source-over" },
          maskSets,
          maskModel,
        );
        expect(blocks.length).toBe(longest === 4 ? 1554 : 258);
        expect(wrong).toEqual([]);
        expect(prefix_test_output(output, "", defaults)).toBe(output);
      });
    }

    // Bun minifies a merged rule again, and a keyframe reaches only the mask handler.
    test("a merged rule, a joined `@media` rule and a keyframe get the declarations of a rule", () => {
      for (const [part, atoms] of Object.entries(maskAtoms)) {
        const blocks = blocksOf(atoms, longest - 1);
        const sheet = (rule: (declarations: string, i: number) => string) =>
          prefix_test_output(blocks.map((block, i) => rule(block.join(";"), i)).join("\n"), "", defaults);
        expect(sheet((declarations, i) => `.r${i}{${declarations}}.r${i}{color:red}`)).toBe(
          sheet((declarations, i) => `.r${i}{${declarations};color:red}`),
        );
        // Bun joins two `@media` rules at a time, so this takes the blocks of up to two declarations.
        const short = blocksOf(atoms, 2).map((block, i) => `.r${i}{${block.join(";")}}`);
        expect(prefix_test_output(short.map(rule => `@media print{${rule}}`).join("\n"), "", defaults)).toBe(
          prefix_test_output(`@media print{${short.join("\n")}}`, "", defaults),
        );
        // A browser ignores `!important` in a keyframe, so those stay as written.
        if (part === "`!important`") continue;
        const frames = linesOf(sheet((declarations, i) => `@keyframes r${i}{to{${declarations}}}`));
        const printed = linesOf(sheet((declarations, i) => `.r${i}{${declarations}}`));
        const text = (lines: string[]) => lines.map(line => line.trim()).join(" ");
        expect(blocks.filter((_, i) => text(frames[i]) !== text(printed[i])).map(block => block.join(";"))).toEqual([]);
      }
    });

    test("a mask-border prefix changes no winning declaration", () => {
      type Browser = "standard" | "chrome" | "safari" | "prefixed";
      const browsers: Record<string, Browser> = {
        // Reads `mask-border*` and `mask`. `mask` resets `mask-border`, as the specification says.
        "a browser with only the standard names": "standard",
        // Reads `-webkit-mask-box-image*` and both mask names. No mask shorthand resets the border.
        "Chrome 120": "chrome",
        // Reads every name. `mask` resets the border, `-webkit-mask` does not.
        "Safari 17.2": "safari",
        "Chrome 119": "prefixed",
      };
      // The source and the slice of a `mask-border` value.
      const parts = (value: string) => {
        if (value.startsWith("var(")) return [value, value];
        if (value === "initial") return ["none", "0"];
        const [source, ...slice] = value.split(" ");
        return [source, slice.join(" ")];
      };
      // The border source, the border slice and the mask image that one declaration sets in a browser.
      const sets = ({ name, value }: Declaration, browser: Browser) => {
        const standard = browser === "standard" || browser === "safari";
        const prefixed = browser !== "standard";
        const [source, slice] = parts(value);
        if (name === "mask-border" && standard) return { source, slice };
        if (name === "mask-border-slice" && standard) return { slice: value };
        // `-webkit-mask-box-image` fills the middle. The other names need `fill` for that.
        if (name === "-webkit-mask-box-image" && prefixed) {
          return { source, slice: value === "initial" || slice.endsWith(" fill") ? slice : `${slice} fill` };
        }
        if (name === "-webkit-mask-box-image-source" && prefixed) return { source };
        if (name === "-webkit-mask-box-image-slice" && prefixed) return { slice: value === "initial" ? "0" : value };
        if (name === "mask" && standard) return { image: value, source: "none", slice: "0" };
        if (name === "mask" && browser === "chrome") return { image: value };
        if (name === "-webkit-mask" && prefixed) return { image: value };
        return {};
      };
      const { blocks, output, wrong } = everyBlock(
        [
          "mask-border:url(b.png) 25",
          "mask-border:url(b.png) 25 fill",
          "mask-border:var(--b)",
          "-webkit-mask-box-image:url(c.png) 30",
          "mask-border-slice:25",
          "-webkit-mask-box-image-slice:25",
          "mask:url(a.png)",
        ],
        browsers,
        { source: "none", slice: "0", image: "none" },
        sets,
        ({ declaration, applied }) => {
          const facts = memo(({ name, value }: Read) => {
            const [source, slice] = parts(value);
            const split = name === "mask-border" && !value.startsWith("var(");
            return {
              writesSource: name === "-webkit-mask-box-image",
              writesSlice: name === "-webkit-mask-box-image" || name === "-webkit-mask-box-image-slice",
              // A `var()` shorthand cannot be split into longhands.
              whole: name === "mask-border" && !split ? declaration(`-webkit-mask-box-image:${value}`) : undefined,
              // `mask` resets the border, so the copies of the border are reset too.
              source:
                split || name === "mask"
                  ? declaration(`-webkit-mask-box-image-source:${split ? source : "initial"}`)
                  : undefined,
              slice:
                split || name === "mask" || name === "mask-border-slice"
                  ? declaration(`-webkit-mask-box-image-slice:${split ? slice : name === "mask" ? "initial" : value}`)
                  : undefined,
              mask: name === "mask" ? declaration(`-webkit-mask:${value}`) : undefined,
            };
          });
          // A browser with only the prefixed border names gets a copy of each standard declaration, for each longhand not yet written.
          return (declarations, browser) => {
            if (browser !== "chrome" && browser !== "prefixed") return applied(declarations, browser);
            let [wroteSource, wroteSlice] = [false, false];
            const out: Read[] = [];
            for (let i = 0; i < declarations.length; i++) {
              const { writesSource, writesSlice, whole, source, slice, mask } = facts(declarations[i]);
              wroteSource ||= writesSource;
              wroteSlice ||= writesSlice;
              if (mask && browser === "prefixed") out.push(mask);
              if (whole && !wroteSource && !wroteSlice) out.push(whole);
              if (source && !wroteSource) out.push(source);
              if (slice && !wroteSlice) out.push(slice);
              out.push(declarations[i]);
            }
            return applied(out, browser);
          };
        },
      );
      expect(blocks.length).toBe(longest === 4 ? 2800 : 399);
      expect(wrong).toEqual([]);
      expect(prefix_test_output(output, "", defaults)).toBe(output);
    });

    test("a mask fallback changes no winning declaration", () => {
      // A browser reads some of the names and parses colors up to a level: 0 `rgb()`, 1 `color(display-p3)`, 2 `lch()`.
      type Browser = { names: "standard" | "both" | "prefixed"; level: number; up?: Browser };
      const browsers: Record<string, Browser> = {};
      for (const names of ["standard", "both", "prefixed"] as const) {
        let up: Browser | undefined;
        for (const level of [2, 1, 0]) up = browsers[`${names} names, color level ${level}`] = { names, level, up };
      }
      // The image that one declaration sets, named by its angle or its file, and the level of its colors.
      const sets = ({ name, value }: Declaration, { names, level }: Browser) => {
        const prefixed = name.startsWith("-webkit-");
        const colors = value.includes("lch(") ? 2 : value.includes("display-p3") ? 1 : 0;
        if (!/mask(-image)?$/.test(name) || (prefixed ? names === "standard" : names === "prefixed")) return {};
        if (colors > level) return {};
        return {
          image: value
            .match(/(\d+)deg|url\((\w+)/)!
            .slice(1)
            .join(""),
          level: String(colors),
        };
      };
      const lch = (angle: number) => `linear-gradient(${angle}deg, lch(50% 132 50), lch(50% 130 150))`;
      const { blocks, output, wrong } = everyBlock(
        [
          "mask-image:url(u1.png)",
          "mask-image:linear-gradient(30deg, color(display-p3 1 0 0), color(display-p3 0 1 0))",
          `mask-image:${lch(40)}`,
          `mask-image:${lch(50)}`,
          `-webkit-mask-image:${lch(60)}`,
          `mask:${lch(70)}`,
        ],
        browsers,
        { image: "none", level: "" },
        sets,
        ({ declaration, applied }) => {
          const copy = memo((source: Read) => declaration(`-webkit-${source.name}:${source.value}`));
          // A prefix-only browser gets a copy of each standard declaration until the block writes a prefixed name.
          const forPrefixOnly = memo((source: Read[]) => {
            let written = false;
            return source.map(declaration =>
              (written ||= declaration.name.startsWith("-webkit-")) ? declaration : copy(declaration),
            );
          });
          // A browser keeps the winner that it has in the source. One with none gets the fallback of the winner one level up.
          const expected = (source: Read[], browser: Browser): Applied => {
            const own = applied(browser.names === "prefixed" ? forPrefixOnly(source) : source, browser);
            if (own[0] !== "none" || !browser.up) return own;
            const [image, level] = expected(source, browser.up);
            return [image, image === "none" ? level : String(Math.min(+level!, browser.level))];
          };
          return expected;
        },
      );
      expect(blocks.length).toBe(longest === 4 ? 1554 : 258);
      expect(wrong).toEqual([]);
      expect(prefix_test_output(output, "", defaults)).toBe(output);
    });

    // A review of the handler found these. Each one needs a repair or a decision before the handler can ship.
    describe("open defects", () => {
      test.todo(
        "`.a{-webkit-mask-image:X!important;mask-image:X!important} .q{top:0} .a{mask-image:Z}` keeps the first rule: `is_duplicate` has to compare each importance list in full (#33684)",
      );
      test.todo(
        "`.a{mask-source-type:alpha} .b{mask-size:cover;mask-size:cover}` prints one pair in `.b`: `floor` is set in a handler that is not open, and `finalize` does not reset it",
      );
      test.todo(
        "`mask-image:url(a.png);-webkit-mask-image:url(a.png)` stays two lines: the handler looks only back for a written prefix, and two `url()` values are never equal (iconoir.css grows 49%)",
      );
      test.todo(
        "`-webkit-mask-image:none;mask-position:0 0;mask:none` prints the same text on a second pass: the typed `-webkit-mask-position` copy does not merge with a written one, which is text",
      );
      test.todo(
        "`mask-border:url(b.png) 25 fill;mask:url(a.png)!important` resets the `-webkit-mask-box-image` copy or does not write it: `copied` is not shared between the two importance lists",
      );
      test.todo(
        "`mask:url(#m)` gets no `-webkit-mask` copy: Chromium 119 loads the copy as an image and does not paint the element",
      );
      test.todo(
        "`mask-border:none` gets no `-webkit-mask-box-image-slice: 0` line beside the empty `-webkit-mask-box-image:` that main prints (#45143)",
      );
      test.todo(
        "`mask-composite:var(--c)` gets no raw copy: a standard keyword in the variable is not valid for `-webkit-mask-composite`",
      );
      test.todo(
        "`.a{mask-composite:exclude} .a.b{mask:url(x.png)}` states the composite in the second rule: the old `-webkit-mask` does not reset the `xor` of the first rule",
      );
      test.todo(
        "`.a{mask-border:url(b.png) 25} .a.b{mask:none}` resets the `-webkit-mask-box-image` copy of the first rule",
      );
      test.todo(
        "`-webkit-mask-position-x:5px;mask-position:10px 0` counts `-webkit-mask-position-x` as a written prefix",
      );
      test.todo(
        "the browser model: Safari 15.4 to 15.6 apply `-webkit-mask-composite` after `mask-composite`, and no Chromium reads `mask-border`",
      );
    });
  });

  describe("font-palette-values", () => {
    minify_test(
      "@font-palette-values --x{font-family:Foo;base-palette:2}",
      "@font-palette-values --x{font-family:Foo;base-palette:2}",
    );
    minify_test("@font-palette-values --x{base-palette:light}", "@font-palette-values --x{base-palette:light}");
    minify_test("@font-palette-values --x{base-palette:65535}", "@font-palette-values --x{base-palette:65535}");
    minify_test(
      "@font-palette-values --x{override-colors:0 red,1 #00f}",
      "@font-palette-values --x{override-colors:0 red,1 #00f}",
    );

    // Out-of-range palette indices don't fit the internal u16 storage; they
    // must be preserved as unknown declarations instead of panicking.
    minify_test("@font-palette-values --x{base-palette:99999}", "@font-palette-values --x{base-palette:99999}");
    minify_test("@font-palette-values --x{base-palette:-1}", "@font-palette-values --x{base-palette:-1}");
    minify_test(
      "@font-palette-values --x{override-colors:99999 red}",
      "@font-palette-values --x{override-colors:99999 red}",
    );
    minify_test("@font-palette-values --x{override-colors:-1 red}", "@font-palette-values --x{override-colors:-1 red}");
    // Fuzzer-minimized input: unterminated block with an overflowing index.
    minify_test("@font-palette-values --{base-palette:99999", "@font-palette-values --{base-palette:99999}");
  });

  describe("grid-template-areas", () => {
    // Not in the typed property table yet; `.` null-cell tokens (including
    // multi-dot runs) must survive the unparsed-token round-trip unchanged.
    minify_test('.foo{grid-template-areas:"a . b" ". c ."}', '.foo{grid-template-areas:"a . b" ". c ."}');
    minify_test('.foo{grid-template-areas:"a ... b"}', '.foo{grid-template-areas:"a ... b"}');
    minify_test(".foo{grid-template-areas:none}", ".foo{grid-template-areas:none}");
  });

  describe("edge cases", () => {
    describe("invalid gradient", () => {
      cssTest(
        `
      .test3 {
        background: linear-gradient(calc(0deg + calc(0 / 0)), red, blue);
      }
      `,
        `
      .test3 {
        background: linear-gradient(calc(0deg + calc(0 / 0)), red, blue);
      }
      `,
      );

      cssTest(
        `
.test22 {
  background: conic-gradient(from calc(1turn / 0) at calc(0 / 0), red, blue);
}`,
        `
      .test22 {
        background: conic-gradient(from calc(1turn / 0) at calc(0 / 0), red, blue);
      }
      `,
      );
    });

    describe("unparsed oklab color fallbacks", () => {
      minify_test(".foo { color: var(--x, oklab(40% 0.1 0.1)) }", ".foo{color:var(--x,oklab(40% .1 .1))}");
      minify_test(".foo { color: var(--x, oklch(40% 0.1 30)) }", ".foo{color:var(--x,oklch(40% .1 30))}");
      minify_test(".foo { color: var(--x, lab(40% 0.1 0.1)) }", ".foo{color:var(--x,lab(40% .1 .1))}");
      minify_test(".foo { color: var(--x, lch(40% 0.1 30)) }", ".foo{color:var(--x,lch(40% .1 30))}");
      minify_test('.foo { color: "a" oklab(40% 0.1 0.1) }', '.foo{color:"a" oklab(40% .1 .1)}');
      minify_test('.foo { color: "a" lab(40% 0.1 0.1) }', '.foo{color:"a" lab(40% .1 .1)}');
    });

    describe("color fallbacks with system colors and currentColor", () => {
      prefix_test(
        `
          .foo {
            background: background linear-gradient(lch(8% 76 2), lch(51% 66 6));
          }
        `,
        indoc`
          .foo {
            background: background linear-gradient(#41001b, #da3671);
            background: background linear-gradient(lch(8% 76 2), lch(51% 66 6));
          }
        `,
        {
          chrome: 95 << 16,
        },
      );
      prefix_test(
        `
          .foo {
            background: background linear-gradient(lch(8% 76 2), lch(51% 66 6));
          }
        `,
        indoc`
          .foo {
            background: background linear-gradient(color(display-p3 .342311 -.157987 .0918331), color(display-p3 .787212 .27046 .444387));
            background: background linear-gradient(lch(8% 76 2), lch(51% 66 6));
          }
        `,
        {
          safari: 14 << 16,
        },
      );
      prefix_test(
        `
          .foo {
            background: linear-gradient(currentColor, lch(50% 50 180));
          }
        `,
        indoc`
          .foo {
            background: linear-gradient(currentColor, #008675);
            background: linear-gradient(currentColor, lch(50% 50 180));
          }
        `,
        {
          chrome: 95 << 16,
        },
      );
      prefix_test(
        `
          .foo {
            background: buttonface linear-gradient(lch(50% 50 180), canvas);
          }
        `,
        indoc`
          .foo {
            background: buttonface linear-gradient(#008675, canvas);
            background: buttonface linear-gradient(lch(50% 50 180), canvas);
          }
        `,
        {
          chrome: 95 << 16,
        },
      );
      prefix_test(
        `
          .foo {
            color: light-dark(buttonface, lch(50% 50 180));
          }
        `,
        indoc`
          .foo {
            color: var(--buncss-light, buttonface) var(--buncss-dark, lch(50% 50 180));
          }
        `,
        {
          chrome: 95 << 16,
        },
      );
      prefix_test(
        `
          .foo {
            text-shadow: 0 0 currentColor, 0 0 lch(50% 50 180);
          }
        `,
        indoc`
          .foo {
            text-shadow: 0 0, 0 0 #008675;
            text-shadow: 0 0, 0 0 lch(50% 50 180);
          }
        `,
        {
          chrome: 95 << 16,
        },
      );
      prefix_test(
        `
          .foo {
            text-shadow: 0 0 currentColor, 0 0 lch(50% 50 180);
          }
        `,
        indoc`
          .foo {
            text-shadow: 0 0, 0 0 color(display-p3 -.0472161 .537112 .461858);
            text-shadow: 0 0, 0 0 lch(50% 50 180);
          }
        `,
        {
          safari: 14 << 16,
        },
      );
    });

    // rgb()/hsl() whose alpha is only known at runtime (var(), calc(var()), ...)
    // are downleveled to the legacy comma syntax for targets without
    // space-separated color notation. Every component, including the alpha,
    // has to be comma separated there or the declaration is invalid.
    describe("unresolved alpha downleveled to rgba()/hsla()", () => {
      const legacyOnly = { chrome: 60 << 16 };
      const modern = { chrome: 90 << 16 };

      prefix_test(
        ".foo { color: rgb(12 34 56 / var(--alpha)); }",
        indoc`
          .foo {
            color: rgba(12, 34, 56, var(--alpha));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { color: rgb(12 34 56 / var(--alpha, 50%)); }",
        indoc`
          .foo {
            color: rgba(12, 34, 56, var(--alpha, 50%));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { color: rgb(12 34 56 / calc(var(--alpha) * 2)); }",
        indoc`
          .foo {
            color: rgba(12, 34, 56, calc(var(--alpha) * 2));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { color: rgb(5% 50% 100% / var(--alpha)); }",
        indoc`
          .foo {
            color: rgba(13, 128, 255, var(--alpha));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { --x: rgb(12 34 56 / var(--alpha)); }",
        indoc`
          .foo {
            --x: rgba(12, 34, 56, var(--alpha));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { box-shadow: 0 0 4px rgb(12 34 56 / var(--alpha)); }",
        indoc`
          .foo {
            box-shadow: 0 0 4px rgba(12, 34, 56, var(--alpha));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { color: rgb(from light-dark(yellow, red) r g b / var(--alpha)); }",
        indoc`
          .foo {
            color: var(--buncss-light, rgba(255, 255, 0, var(--alpha))) var(--buncss-dark, rgba(255, 0, 0, var(--alpha)));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { color: light-dark(rgb(12 34 56 / var(--alpha)), hsl(200 30% 40% / var(--alpha))); }",
        indoc`
          .foo {
            color: var(--buncss-light, rgba(12, 34, 56, var(--alpha))) var(--buncss-dark, hsla(200, 30%, 40%, var(--alpha)));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { color: hsl(200 30% 40% / var(--alpha)); }",
        indoc`
          .foo {
            color: hsla(200, 30%, 40%, var(--alpha));
          }
        `,
        legacyOnly,
      );
      prefix_test(
        ".foo { --x: hsl(200 30% 40% / var(--alpha)); }",
        indoc`
          .foo {
            --x: hsla(200, 30%, 40%, var(--alpha));
          }
        `,
        legacyOnly,
      );

      // Targets that support the modern syntax keep it as written.
      prefix_test(
        ".foo { color: rgb(12 34 56 / var(--alpha)); }",
        indoc`
          .foo {
            color: rgb(12 34 56 / var(--alpha));
          }
        `,
        modern,
      );
      prefix_test(
        ".foo { --x: rgb(12 34 56 / var(--alpha)); }",
        indoc`
          .foo {
            --x: rgb(12 34 56 / var(--alpha));
          }
        `,
        modern,
      );
      prefix_test(
        ".foo { color: hsl(200 30% 40% / var(--alpha)); }",
        indoc`
          .foo {
            color: hsl(200 30% 40% / var(--alpha));
          }
        `,
        modern,
      );
    });

    // Deeply nested @keyframes with invalid percentages
    describe("nested keyframes", () => {
      cssTest(
        `@keyframes outer {
        @keyframes inner1 {
          @keyframes inner2 {
            9999999999999999999999999999999.99999999999999% {
              color: rgb(calc(1/0), 0, 0);
            }
          }
        }
      }`,
        `
@keyframes outer{

}
`,
      );
    });

    cssTest(
      `@keyframes 👨‍👩‍👧‍👦 {
  0% {
    color: red;
  }
  50% {
    color: green;
  }
  100% {
    color: blue;
  }
}`,
      `
      @keyframes 👨‍👩‍👧‍👦 {
  0% {
    color: red;
  }

  50% {
    color: green;
  }

  100% {
    color: #00f;
  }
}
      `,
    );

    // Unicode and escape sequence edge cases
    describe("unicode edge cases", async () => {
      const input = await Bun.file(join(__dirname, "unicode.css")).text();
      const output = await Bun.file(join(__dirname, "unicode_expected.css")).text();
      cssTest(input, output);
    });
  });

  test("deeply nested rules keep two spaces of indentation per level", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { _test } = require("bun:internal-for-testing").cssInternals;
let css = "color: red";
for (let i = 0; i < 150; i++) css = ".a { " + css + " }";
const output = _test(css, "");
const line = output.split("\\n").find(l => l.includes("color: red"));
console.log(line.length - line.trimStart().length);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("300");
    expect(exitCode).toBe(0);
  });
});
