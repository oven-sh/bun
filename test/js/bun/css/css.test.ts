/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { cssInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
      indoc`.rounded-full{width:0;height:infinity;border-radius:3.40282e38px}`,
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
    minify_test(`a { left: clamp(-10px, 100px, -30px) }`, `a{left:-10px}`);
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
        border-style: solid;
        border-width: 2px;
        border-color: red;
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
        border-style: solid;
        border-width: 1px 2px;
        border-color: #000;
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
        border-style: solid;
        border-width: 1px 1px 1px 2px;
        border-color: #000;
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
        border-style: solid;
        border-width: 1px;
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
        border-block: 1px solid #000;
        border-inline: 1px solid red;
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
        border-block: 1px solid #000;
        border-inline: 2px solid #000;
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
        border-block: 1px solid #000;
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
        border-block: 1px solid #000;
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
        border-block-start: 2px solid #000;
        border-block-end: 1px solid #000;
        border-inline: 2px solid red;
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
        border-block-start: 2px solid red;
        border-block-end: 1px solid red;
        border-inline: 2px solid red;
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
        border-block: 2px solid red;
        border-inline-start: 2px solid red;
        border-inline-end: 1px solid red;
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
        border-right-color: color(display-p3 .972962 -.362078 .804206);
        border-right-color: lch(50.998% 135.363 338);
      }

      .foo:is(:lang(ae), :lang(ar), :lang(arc), :lang(bcc), :lang(bqi), :lang(ckb), :lang(dv), :lang(fa), :lang(glk), :lang(he), :lang(ku), :lang(mzn), :lang(nqo), :lang(pnb), :lang(ps), :lang(sd), :lang(ug), :lang(ur), :lang(yi)) {
        border-left-color: #ee00be;
        border-left-color: color(display-p3 .972962 -.362078 .804206);
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
    minify_test(".foo { background-position: left 10px center }", ".foo{background-position:10px}");
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
           -webkit-box-orient: horizontal;
           -moz-box-orient: horizontal;
           -webkit-box-direction: normal;
           -moz-box-direction: normal;
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
           -webkit-box-orient: horizontal;
           -moz-box-orient: horizontal;
           -webkit-box-direction: normal;
           -moz-box-direction: normal;
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
      ".foo{background:linear-gradient(0deg,#00f,#ff0)}",
    );
    minify_test(
      ".foo { background: linear-gradient(to top, blue 10%, yellow 20%); }",
      ".foo{background:linear-gradient(0deg,#00f 10%,#ff0 20%)}",
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
      ".foo{background:linear-gradient(#ff0,50%,#00f)}",
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
      ".foo{background:linear-gradient(0deg,#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-linear-gradient(yellow, blue) }",
      ".foo{background:-webkit-linear-gradient(#ff0,#00f)}",
    );
    minify_test(
      ".foo { background: -webkit-linear-gradient(bottom, yellow, blue); }",
      ".foo{background:-webkit-linear-gradient(bottom,#ff0,#00f)}",
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
      ".foo{background:-moz-linear-gradient(bottom,#ff0,#00f)}",
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
      ".foo{background:-o-linear-gradient(bottom,#ff0,#00f)}",
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
        font-family: Helvetica, Times New Roman, sans-serif;
        font-size: 12px;
        font-style: italic;
        font-variant-caps: small-caps;
        font-weight: bold;
        font-stretch: expanded;
        line-height: 1.2em;
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
      indoc`.foo{font-family:Helvetica,Times New Roman,sans-serif;font-size:12px;font-style:italic;font-variant-caps:small-caps;font-weight:700;font-stretch:125%;line-height:1.2em}`,
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
        font-family: Helvetica, Times New Roman, sans-serif;
        font-size: 12px;
        font-style: italic;
        font-variant-caps: all-small-caps;
        font-weight: bold;
        font-stretch: expanded;
        line-height: 1.2em;
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
    minify_test(
      "@media (example, all,), speech { .foo { color: chartreuse }}",
      "@media (example, all,),speech{.foo{color:#7fff00}}",
    );
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
        @media (min-width: 240.02px) {
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
        @media (max-width: 239.98px) {
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
        @media (min-width: 100.02px) and (max-width: 199.98px) {
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
        @media (min-width: calc(1.02px + 1rem)) {
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
        @media (min-width: calc(max(10px, 1rem) + .02px)) {
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
        @media (min-width: .02px) {
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

    minify_test("@media (min-width: hi) { .foo { color: chartreuse }}", "@media (min-width: hi){.foo{color:#7fff00}}");
    minify_test("@media (width >= 2/1) { .foo { color: chartreuse }}", "@media (width >= 2/1){.foo{color:#7fff00}}");
    minify_test(
      "@media (1px <= min-width <= 2px) { .foo { color: chartreuse }}",
      "@media (1px <= min-width <= 2px){.foo{color:#7fff00}}",
    );
    minify_test("@media (grid: 10) { .foo { color: chartreuse }}", "@media (grid: 10){.foo{color:#7fff00}}");
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
        transition-property: opacity;
        transition-duration: 90ms;
        transition-delay: .5s;
        transition-timing-function: ease-in-out;
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
        transition-property: opacity, color;
        transition-duration: 2s, 4s;
        transition-delay: .5s, 0s;
        transition-timing-function: ease-in-out, ease-in;
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
        transition-property: opacity, color;
        transition-duration: 2s;
        transition-delay: .5s;
        transition-timing-function: ease-in-out;
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
        transition-property: opacity, color, width, height;
        transition-duration: 2s, 4s;
        transition-delay: 0s;
        transition-timing-function: ease;
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
        -webkit-transition-property: opacity, color;
        -webkit-transition-duration: 2s, 4s;
        -webkit-transition-delay: .5s, 0s;
        -webkit-transition-timing-function: ease-in-out, ease-in;
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
        -webkit-transition-property: opacity, color;
        -moz-transition-property: opacity, color;
        transition-property: opacity, color;
        -webkit-transition-duration: 2s, 4s;
        -moz-transition-duration: 2s, 4s;
        transition-duration: 2s, 4s;
        -webkit-transition-delay: .5s, 0s;
        -moz-transition-delay: .5s, 0s;
        transition-delay: .5s, 0s;
        -webkit-transition-timing-function: ease-in-out, ease-in;
        -moz-transition-timing-function: ease-in-out, ease-in;
        transition-timing-function: ease-in-out, ease-in;
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
        -webkit-transition-property: opacity, color;
        -moz-transition-property: opacity, color;
        transition-property: opacity, color;
        -webkit-transition-duration: 2s, 4s;
        -moz-transition-duration: 2s, 4s;
        transition-duration: 2s, 4s;
        -webkit-transition-delay: .5s, 0s;
        -moz-transition-delay: .5s, 0s;
        transition-delay: .5s, 0s;
        -webkit-transition-timing-function: ease-in-out, ease-in;
        -moz-transition-timing-function: ease-in-out, ease-in;
        transition-timing-function: ease-in-out, ease-in;
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
    minify_test(".foo { rotate: 0 0 1 0deg }", ".foo{rotate:0deg}");
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
    minify_test(".foo { color-scheme: dark light; }", ".foo{color-scheme:dark light}");
    minify_test(".foo { color-scheme: only light; }", ".foo{color-scheme:light only}");
    minify_test(".foo { color-scheme: only dark; }", ".foo{color-scheme:dark only}");
    minify_test(".foo { color-scheme: dark light only; }", ".foo{color-scheme:dark light only}");
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

  test("a rule nested in :host(&) or ::slotted(&)", async () => {
    const cases = [
      [":host(&) { .b { color: red } }", ":host(:scope) .b{color:red}"],
      ["::slotted(&) { & { color: red } }", "::slotted(:scope){color:red}"],
      [".a { :host(&) { .c { color: red } } }", ":host(.a) .c{color:red}"],
      [".a { ::slotted(&) { &:hover { color: red } } }", "::slotted(.a):hover{color:red}"],
    ];
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { minifyTest } = require("bun:internal-for-testing").cssInternals;
for (const source of ${JSON.stringify(cases.map(([source]) => source))}) console.log(minifyTest(source, "", { chrome: 95 << 16 }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim().split("\n")).toEqual(cases.map(([, expected]) => expected));
    expect(exitCode).toBe(0);
  });
});

describe("IE star hack", () => {
  // A browser skips `*zoom: 1` and keeps the rest of the rule.
  minify_test(".a{color:red;*zoom:1;top:0}", ".a{color:red;top:0}");
  minify_test(".cf { *zoom: 1 }", "");
  minify_test(".a { *zoom: expression(this.runtimeStyle.zoom='1;'); color: red }", ".a{color:red}");
  minify_test(".a { *display: inline !ie; color: red }", ".a{color:red}");
  minify_test("@page { *zoom: 1; margin: 1px }", "@page{margin:1px}");
  // It ends at a block too, as an invalid nested rule does.
  minify_test(".a { *zoom:hover { color: red } top: 0 }", ".a{top:0}");

  // A nested rule that starts with `*` is a rule.
  minify_test(".a { *:hover { color: red } }", ".a{& :hover{color:red}}");
  minify_test(".a { * { color: red } }", ".a{& *{color:red}}");

  test.each([
    [".a { * zoom: 1 }", "Unexpected end of input"],
    ["@media screen { *zoom: 1; .a { color: red } }", "Unexpected token: zoom"],
  ])("ERROR: %s", (source, error) => {
    expect(() => minify_test_with_options(source, "")).toThrow(`parsing failed: ${error}`);
  });
});

describe("whitespace in values kept as tokens", () => {
  // [declaration, default output, minified output]
  const declarations: [string, string, string][] = [
    // Chromium drops both when a blank is added inside `type()`.
    [
      "width: attr(data-w type(<length>), 100px)",
      "width: attr(data-w type(<length>), 100px)",
      "width:attr(data-w type(<length>),100px)",
    ],
    ["--x: attr(data-n type(<number>+))", "--x: attr(data-n type(<number>+))", "--x:attr(data-n type(<number>+))"],
    // A blank can be a combinator.
    ["--sel: .a .b > c", "--sel: .a .b > c", "--sel:.a .b > c"],
    ["--sel: .a.b>c", "--sel: .a.b>c", "--sel:.a.b>c"],
    ["--x: var(--a) var(--b) (c) d", "--x: var(--a) var(--b) (c) d", "--x:var(--a)var(--b)(c)d"],
    ["--x: var(--a)var(--b)(c)d", "--x: var(--a)var(--b)(c)d", "--x:var(--a)var(--b)(c)d"],
    ["width: calc(var(--a) + 2px)", "width: calc(var(--a) + 2px)", "width:calc(var(--a) + 2px)"],
    ["width: calc(var(--a)*2)", "width: calc(var(--a)*2)", "width:calc(var(--a)*2)"],
    ["font: var(--a)/1.5 x", "font: var(--a)/1.5 x", "font:var(--a)/1.5 x"],
    ["grid-area: var(--a) / var(--b)", "grid-area: var(--a) / var(--b)", "grid-area:var(--a)/var(--b)"],
    [
      "filter: progid:DXImageTransform.Microsoft.Alpha(Opacity=50)",
      "filter: progid:DXImageTransform.Microsoft.Alpha(Opacity=50)",
      "filter:progid:DXImageTransform.Microsoft.Alpha(Opacity=50)",
    ],
    // Next to a comma a blank means nothing.
    ["--x: a , b,c", "--x: a, b, c", "--x:a,b,c"],
    // A run of whitespace and comments is one blank.
    ["--x: a  \n  b /* c */ d", "--x: a b d", "--x:a b d"],
    ["--x: a/* c */b", "--x: a b", "--x:a b"],
  ];
  describe.each(declarations)("%s", (declaration, normal, minified) => {
    test(declaration, () => {
      expect(cssInternals._test(`.c { ${declaration}; }`, "")).toBe(`.c {\n  ${normal};\n}\n`);
      expect(cssInternals.minifyTest(`.c { ${declaration}; }`, "")).toBe(`.c{${minified}}`);
    });
  });

  // [stylesheet, default output, minified output]
  test.each([
    [
      "@function --f(--x <length>) returns <length> { result: var(--x); }",
      "@function --f(--x <length>) returns <length> {\n  result: var(--x);\n}\n",
      "@function --f(--x <length>)returns <length>{result: var(--x);}",
    ],
    [
      "@custom-variant dark (&:is(.dark *));",
      "@custom-variant dark (&:is(.dark *));\n",
      "@custom-variant dark (&:is(.dark*));",
    ],
    ["@apply outline-ring/50 a b;", "@apply outline-ring/50 a b;\n", "@apply outline-ring/50 a b;"],
  ])("%s", (source, normal, minified) => {
    expect(cssInternals._test(source, "")).toBe(normal);
    expect(cssInternals.minifyTest(source, "")).toBe(minified);
  });
});

describe("url() values compare by their text", () => {
  minify_test('.a{background:url(a.png)}.b{background:url("a.png")}', ".a,.b{background:url(a.png)}");
  minify_test(".a{--i:url(a.png)}.b{--i:url(a.png)}", ".a,.b{--i:url(a.png)}");
  minify_test(
    '.a{background-image:image-set("a.png" 1x,"b.png" 2x)}.b{background-image:image-set("a.png" 1x,"b.png" 2x)}',
    '.a,.b{background-image:image-set("a.png" 1x,"b.png" 2x)}',
  );
  minify_test(
    ".a{background:url(a.png)}.b{background:url(b.png)}",
    ".a{background:url(a.png)}.b{background:url(b.png)}",
  );
});

describe("skipping to a delimiter passes over whole blocks", () => {
  minify_test('@charset "utf-8" (a; b); .a { color: red }', ".a{color:red}");
  minify_test(".a:is(.b % (x, .z), .c) { color: red }", ".a.c{color:red}");
  minify_test(".a:is(.c, .b % (x, .z)) { color: red }", ".a.c{color:red}");
});

describe("position.lineText of a CSS error", () => {
  test.concurrent.each([
    ["LF", 'a { color: red; }\n  @import "x";\nb {}\n', 2, '  @import "x";'],
    ["CRLF", 'a { color: red; }\r\n@import "x";\r\nb {}\r\n', 2, '@import "x";'],
    ["first line", 'a {} @import "x";\nb {}\n', 1, 'a {} @import "x";'],
    ["last line without a line break", 'a { color: red; }\n\n@import "x";', 3, '@import "x";'],
  ])("%s", async (_, source, line, lineText) => {
    using dir = tempDir("css-line-text", { "in.css": source });
    const result = await Bun.build({ entrypoints: [join(String(dir), "in.css")], throw: false });
    expect(result.logs.map(({ position }) => ({ line: position?.line, lineText: position?.lineText }))).toEqual([
      { line, lineText },
    ]);
  });
});

describe("blocks of declarations reject at-rules and qualified rules", () => {
  cssTest(
    "@font-face { src: url(x.woff); @bogus oops; font-family: A; }",
    '@font-face { src: url("x.woff"); font-family: A; }',
  );
  cssTest("@font-face { src: url(x.woff); .foo { color: red } }", '@font-face { src: url("x.woff"); }');
  cssTest("@keyframes k { @bogus; 0% { opacity: 0 } }", "@keyframes k { 0% { opacity: 0; } }");
  cssTest("@font-palette-values --p { font-family: A; @bogus; }", "@font-palette-values --p { font-family: A; }");
  test("@property", () => {
    expect(() => minify_test_with_options('@property --x { syntax: "*"; inherits: false; @bogus; }', "")).toThrow(
      "Unknown at-rule @bogus",
    );
  });
});

describe("numeric tokens that print as written", () => {
  // z-index, custom properties and var() fallbacks are token lists, whose numbers are f32.
  describe.each([
    ".a{z-index:2147483647}.b{z-index:2147483646}",
    ".a{z-index:1000001}.b{z-index:1000000}",
    ".foo{z-index:-2147483648}",
    ":root{--build-id:20261023;--n:3000000001}",
    ".foo{z-index:var(--z,2147483647)}",
    "a{--x:1234567\\70 x}",
    // `5.0` and `.1`: two tokens with nothing between them.
    "a{--v:5.0.1}",
    "a{--v:1.0.0}",
    "a{--v:2.0.0-beta.1}",
    "a{--v:10.20.30}",
  ])("%s", css => {
    minify_test(css, css);
  });
  minify_test("a{--v:5.0 .10}", "a{--v:5 .1}");
});

describe("number serialization", () => {
  minify_test(".foo{opacity:0.000001}", ".foo{opacity:.000001}");
  minify_test(".foo{width:1e21px;height:1e22px}", ".foo{width:1e21px;height:1e22px}");
  minify_test(".foo{line-height:56.89655}", ".foo{line-height:56.8966}");
  // One minus sign when there is no `0.` to drop.
  minify_test(".foo{opacity:-0.0000001}", ".foo{opacity:-1e-7}");
  minify_test(".foo{margin:-0.9999999px}", ".foo{margin:-1px}");
  minify_test(".foo{margin-left:-0.9999999%}", ".foo{margin-left:-1%}");
  minify_test(".foo{margin:-0.5px}", ".foo{margin:-.5px}");
  minify_test(
    ".a{transform:matrix(-1,1.22465e-16,-1.22465e-16,-1,0,0)}",
    ".a{transform:matrix(-1,1.22465e-16,-1.22465e-16,-1,0,0)}",
  );
  minify_test(".foo{color:color(srgb 0 -0.000000192523 1)}", ".foo{color:color(srgb 0 -1.92523e-7 1)}");
});

describe("math functions", () => {
  describe("two different length units stay as written", () => {
    minify_test("a{width:round(100px,1rem)}", "a{width:round(100px,1rem)}");
    minify_test("a{width:mod(100px,1rem)}", "a{width:mod(100px,1rem)}");
    minify_test("a{width:hypot(1px,2vw)}", "a{width:hypot(1px,2vw)}");
    minify_test("a{width:round(1in,10px)}", "a{width:round(1in,10px)}");
    minify_test("a{rotate:atan2(1px,1em)}", "a{rotate:atan2(1px,1em)}");
    minify_test("a{rotate:atan2(1in,10px)}", "a{rotate:1.467rad}");
  });

  describe("rem() keeps the sign of the dividend", () => {
    minify_test("a{margin-left:rem(-18px,5px)}", "a{margin-left:-3px}");
    minify_test("a{rotate:rem(140deg,-90deg)}", "a{rotate:50deg}");
    minify_test("a{margin-left:rem(18px,5px)}", "a{margin-left:3px}");
  });

  describe("round() ignores the sign of the step and breaks a tie upward", () => {
    minify_test("a{margin-left:round(-2.5px,1px)}", "a{margin-left:-2px}");
    minify_test("a{margin-left:round(-7.5px,5px)}", "a{margin-left:-5px}");
    minify_test("a{margin-left:round(up,23px,-10px)}", "a{margin-left:30px}");
    minify_test("a{margin-left:round(down,23px,-10px)}", "a{margin-left:20px}");
    minify_test("a{margin-left:round(2.5px,1px)}", "a{margin-left:3px}");
  });

  describe("min() and max() of one sum or product keep a function", () => {
    minify_test("a{width:max(100% - 20px)}", "a{width:calc(100% - 20px)}");
    minify_test("a{width:min(1em + 2px)}", "a{width:calc(1em + 2px)}");
    minify_test("a{width:max(2 * min(1em,2px))}", "a{width:calc(2*min(1em,2px))}");
    minify_test("a{margin:min(1px + 10%) auto}", "a{margin:calc(1px + 10%) auto}");
    minify_test("a{width:calc(10px + min(1em + 2px))}", "a{width:calc(1em + 12px)}");
  });

  describe("a result below zero is zero where the range is [0,∞]", () => {
    minify_test(".a{border-top-left-radius:calc(0px - .0625rem)}", ".a{border-top-left-radius:0}");
    minify_test("a{border-radius:4px}a{border-top-left-radius:calc(0px - 1px)}", "a{border-radius:0 4px 4px}");
    minify_test("a{border-radius:calc(0px - 1px) 4px/2px}", "a{border-radius:0 4px/2px}");
    minify_test("a{width:rem(-18px,5px)}", "a{width:0}");
    minify_test("a{max-height:calc(10% - 20%)}", "a{max-height:0%}");
    // Not known before layout, not a math function, not such a range.
    minify_test("a{width:max(-2px,-1em)}", "a{width:max(-2px,-1em)}");
    minify_test("a{width:-5px}", "a{width:-5px}");
    minify_test("a{margin-left:calc(0px - 1px)}", "a{margin-left:-1px}");
  });
});

describe("a number is not a length", () => {
  // Outside of quirks mode browsers drop these declarations. With `px` added they would apply.
  describe.each([
    ".a{height:1.5715;padding:8px}",
    "a{top:100}",
    "a{gap:5}",
    "a{margin:10 20}",
    "a{font-size:15}",
    "a{border:1 solid red}",
    "a{transform:translate(10)}",
    "a{width:calc(0)}",
    "a{width:calc(1 - 1)}",
    "a{width:min(0,1)}",
    "a{transform:translateX(calc(0 - 0%))}",
    "@media (min-width:600){a{color:red}}",
    "@container t (max-width:912){a{color:red}}",
  ])("%s", css => {
    minify_test(css, css);
  });
  cssTest("a { margin-left: calc(-1 * 0) }", "a { margin-left: calc(-1 * 0); }");
  minify_test("a{width:100px;width:10}", "a{width:100px;width:10}");
  minify_test("a{width:0;margin:0 auto;flex:1 1 0}", "a{flex:1 1 0;width:0;margin:0 auto}");
  minify_test("a{line-height:calc(2);border-image-width:calc(2)}", "a{border-image-width:2;line-height:2}");
  minify_test("@media (min-width:0){a{color:red}}", "@media (width>=0){a{color:red}}");
});

describe("relative color channel keywords", () => {
  // A keyword is a number on the scale of its function: r, g and b run to 255, s and l to 100.
  minify_test(".a { color: rgb(from #336699 calc(r + 10) g b) }", ".a{color:#3d6699}");
  minify_test(".a { color: rgb(from #336699 calc(255 - r) g b) }", ".a{color:#c69}");
  minify_test(".a { color: rgb(from #336699 max(r, 200) g b) }", ".a{color:#c86699}");
  minify_test(".a { color: rgb(from #336699 clamp(0, r, 20) g b) }", ".a{color:#146699}");
  minify_test(".a { color: rgb(from rgb(200 100 50) r g b / calc(g / 255)) }", ".a{color:#c8643264}");
  minify_test(".a { color: hsl(from hsl(120 50% 40%) h s calc(l - 10)) }", ".a{color:#267326}");
  minify_test(".a { color: hwb(from hwb(120 20% 30%) h calc(w + 10) b) }", ".a{color:#4db34d}");
  minify_test(".a { color: lab(from lab(50% 20 30) calc(l + 10) a b) }", ".a{color:lab(60% 20 30)}");
  minify_test(".a { color: oklch(from oklch(50% 0.1 120) calc(l + 0.1) c h) }", ".a{color:oklch(60% .1 120)}");
  minify_test(".a { color: lab(from lab(50% 20 30) a b l) }", ".a{color:lab(20% 30 50)}");
  // Browsers reject a keyword plus a percentage. It folds as it always has.
  minify_test(".a { color: lch(from purple calc(l + 15%) c h) }", ".a{color:lch(44.6915% 66.8257 327.105)}");
});

describe("relative color outside sRGB", () => {
  // No browser clamps or gamut maps a relative rgb(), hsl() or hwb(), so it stays as written.
  minify_test(
    ".a { color: hsl(from oklch(100% .399 336.3) h s l) }",
    ".a{color:hsl(from oklch(100% .399 336.3) h s l)}",
  );
  minify_test(
    ".a { color: rgb(from color(display-p3 0 1 0) r g b) }",
    ".a{color:rgb(from color(display-p3 0 1 0) r g b)}",
  );
  minify_test(".a { color: hwb(from lab(100 104.3 -50.9) h w b) }", ".a{color:hwb(from lab(100% 104.3 -50.9) h w b)}");
  minify_test(".a { color: rgb(from #336699 300 g b) }", ".a{color:rgb(from #369 300 g b)}");
  minify_test(".a { color: hsl(from #336699 h 185% l) }", ".a{color:hsl(from #369 h 185% l)}");
  minify_test(".a { color: rgb(from lab(50% 40 -50) r g b) }", ".a{color:#965dcd}");
  minify_test(".a { color: hsl(from oklch(0.5 0.1 120) h s l) }", ".a{color:#5c6b21}");
  minify_test(".a { color: rgb(from color(display-p3 0 1 0) 0 128 0) }", ".a{color:green}");
  // A copy of the origin in @supports would win over the later background-color.
  prefix_test(
    ".a { background: hsl(from oklch(70% .3 150) h s l); background-color: blue }",
    indoc`
      .a {
        background: hsl(from oklch(70% .3 150) h s l);
        background-color: #00f;
      }
    `,
    { chrome: Some(90 << 16) },
  );
});

describe("relative color origin alpha", () => {
  minify_test(".a { color: rgb(from #0008 r g b) }", ".a{color:#0008}");
  minify_test(".a { color: rgb(from #0008 r g b / 1) }", ".a{color:#000}");
  minify_test(".a { color: rgb(from transparent 255 255 255) }", ".a{color:#fff0}");
  minify_test(".a { color: rgb(from rgb(0 0 0 / none) r g b) }", ".a{color:#0000}");
  minify_test(".a { color: hsl(from #0008 h s l) }", ".a{color:#0008}");
  minify_test(".a { color: oklch(from oklch(50% 0 0 / 50%) l c h) }", ".a{color:oklch(50% 0 0/.5)}");
  minify_test(".a { color: color(from color(srgb 0 0 0 / 50%) srgb r g b) }", ".a{color:color(srgb 0 0 0/.5)}");
});

describe("color channels written as a number or a percentage", () => {
  minify_test(".a { color: oklch(0.5 0.1 120) }", ".a{color:oklch(50% .1 120)}");
  minify_test(".a { color: lab(50 40 -50) }", ".a{color:lab(50% 40 -50)}");
  minify_test(".a { color: lab(50% 50% 50%) }", ".a{color:lab(50% 62.5 62.5)}");
  minify_test(".a { color: lch(50% 40% 120) }", ".a{color:lch(50% 60 120)}");
  minify_test(".a { color: oklab(50% 25% -25%) }", ".a{color:oklab(50% .1 -.1)}");
  minify_test(".a { color: hsl(120 50 40) }", ".a{color:#393}");
  minify_test(".a { color: hwb(120 20 30) }", ".a{color:#33b333}");
  minify_test(".a { color: hsl(120, 50, 40) }", ".a{color:hsl(120,50,40)}");
  // Only the hex: the last digit of the lab() fallback depends on the platform's libm.
  test("a number channel gets a fallback for old targets", () => {
    expect(cssInternals.prefixTest(".a { color: oklch(0.5 0.1 40) }", "", { chrome: 90 << 16 })).toStartWith(
      ".a {\n  color: #924d35;\n",
    );
  });
  // A number plus a percentage has no type.
  minify_test(".a { opacity: calc(50% + 0.1) }", ".a{opacity:calc(50% + .1)}");
});

describe("color-mix()", () => {
  // A grey has no hue: the mix takes the hue of the other color.
  minify_test(".a { color: color-mix(in oklch, #3b82f6, white 20%) }", ".a{color:oklch(69.8467% .150412 259.815)}");
  minify_test(".a { color: color-mix(in oklch, black, oklch(50% 0.2 120)) }", ".a{color:oklch(25% .1 120)}");
  minify_test(".a { --x: color-mix(in lch, black, lch(50% 60 120)) }", ".a{--x:lch(25% 30 120)}");
  // Two colors with `none` in the same channel are equal.
  minify_test(
    ".b { color: color-mix(in oklch, white, black) } .c { color: color-mix(in oklch, white, black) }",
    ".b,.c{color:oklch(50% 0 none)}",
  );

  // The alpha does not scale the hue.
  minify_test(
    ".a { color: color-mix(in oklch, #3b82f680, #ef4444) }",
    ".a{color:oklch(63.2238% .20122 322.573/.75098)}",
  );
  minify_test(
    ".a { color: color-mix(in lch, lch(70% 50 300 / 0.5), lch(70% 50 200)) }",
    ".a{color:lch(70% 50 250/.75)}",
  );
  minify_test(
    ".a { color: color-mix(in oklch, oklch(70% 0.15 30), oklch(70% 0.15 350)) }",
    ".a{color:oklch(70% .15 10)}",
  );
  minify_test(".a { color: color-mix(in oklch, transparent, transparent) }", ".a{color:oklch(0% 0 none/0)}");

  // A result outside sRGB is not a legacy color.
  minify_test(
    ".a { color: color-mix(in srgb, oklch(100% 0.399 336.3), oklch(100% 0.399 336.3)) }",
    ".a{color:color(srgb 1.59331 .358564 1.38647)}",
  );
  minify_test(".a { color: color-mix(in srgb, color(srgb 1.13 0 0), white) }", ".a{color:color(srgb 1.065 .5 .5)}");
  minify_test(
    ".a { color: color-mix(in srgb, color(srgb 1.5 0 0 / .5), red) }",
    ".a{color:color(srgb 1.16667 0 0/.75)}",
  );
  minify_test(
    ".a { color: color-mix(in srgb, color(display-p3 0 1 0), color(srgb 0.6 0.2 0.4)) }",
    ".a{color:#0b9b0b}",
  );
  // hsl and hwb cannot hold an operand outside sRGB.
  minify_test(
    ".a { color: color-mix(in hsl, color(display-p3 0 1 0), red) }",
    ".a{color:color-mix(in hsl,color(display-p3 0 1 0),red)}",
  );
  minify_test(".a { color: color-mix(in hsl, oklch(50% 0.1 120), red) }", ".a{color:#ae7217}");

  minify_test(
    ".a { color: color-mix(in xyz-d50, color(xyz-d50 none .2 .3), color(xyz-d50 .3 .2 .1)) }",
    ".a{color:color(xyz-d50 .3 .2 .2)}",
  );
});

describe("color() color spaces", () => {
  minify_test(".a { color: color(from #c86432 a98-rgb r g b) }", ".a{color:color(a98-rgb .695066 .391898 .220089)}");
  minify_test(".a { color: color(a99-rgb 1 0 0) }", ".a{color:color(a99-rgb 1 0 0)}");
  minify_test(".a { color: color(from red srgb-linear r g b) }", ".a{color:color(srgb-linear 1 0 0)}");
});

describe("greys converted to lab() and lch()", () => {
  minify_test(".a { color: lab(from gray l a b) }", ".a{color:lab(53.585% 0 0)}");
  minify_test(".a { color: lch(from white l c h) }", ".a{color:lch(100% 0 0)}");
});

describe("named colors in any letter case", () => {
  minify_test(".a{color:DodgerBlue}", ".a{color:#1e90ff}");
  minify_test(".a{background:linear-gradient(Red,BLUE)}", ".a{background:linear-gradient(red,#00f)}");
  minify_test(
    '@property --accent{syntax:"<color>";inherits:false;initial-value:White}',
    '@property --accent{syntax:"<color>";inherits:false;initial-value:#fff}',
  );
  minify_test(".a{color:blac\u212A}", ".a{color:blac\u212A}");
});

describe("rotate: 0deg is not none", () => {
  // Unlike `none`, it creates a stacking context and a containing block.
  minify_test(".a { rotate: 0deg }", ".a{rotate:0deg}");
  minify_test(".a { rotate: z 0deg }", ".a{rotate:0deg}");
  minify_test(".a { rotate: none }", ".a{rotate:none}");
  minify_test(".a { rotate: none; rotate: 0deg }", ".a{rotate:0deg}");
});

describe("min(), max() and clamp() of numbers", () => {
  minify_test("a { flex: min(1, 2) 1 0 }", "a{flex:1 1 0}");
  minify_test("a { flex: min(1, 2) 2 }", "a{flex:1 2}");
  minify_test("a { opacity: calc(1 - min(.5, .2)) }", "a{opacity:.8}");
  minify_test("a { opacity: clamp(0, .5, .2) }", "a{opacity:.2}");
  minify_test("@media (aspect-ratio: min(1, 2) / 1) { a { b: c } }", "@media (aspect-ratio:1){a{b:c}}");
  minify_test("a { line-height: max(1.2, 1.5, 1em, 2em) }", "a{line-height:max(1.5,2em)}");
  minify_test("a { opacity: min(.5, 20%) }", "a{opacity:min(.5,20%)}");
});

describe("light-dark() under the default targets of the bundler", () => {
  async function bundle(css: string, minify = false) {
    using dir = tempDir("css-light-dark-default-targets", { "index.css": css });
    const result = await Bun.build({ entrypoints: [join(String(dir), "index.css")], minify });
    const output = await result.outputs[0].text();
    // The leading `/* path */` banner holds the temporary directory.
    return output.replace(/^\/\*.*\*\/\n/, "").trim();
  }

  test("is kept as written", async () => {
    const output = await bundle(`
      .b { color: light-dark(#102030, #d0e0f0); background-color: light-dark(white, black) }
      .c { accent-color: light-dark(red, blue); --c: light-dark(red, blue) }
    `);
    expect(output).toBe(indoc`
      .b {
        color: light-dark(#102030, #d0e0f0);
        background-color: light-dark(#fff, #000);
      }

      .c {
        accent-color: light-dark(red, #00f);
        --c: light-dark(red, #00f);
      }
    `);
  });

  test("is kept as written when minified", async () => {
    const output = await bundle(".b { color: light-dark(#102030, #d0e0f0) } .c { --c: light-dark(red, blue) }", true);
    expect(output).toBe(".b{color:light-dark(#102030,#d0e0f0)}.c{--c:light-dark(red,#00f)}");
  });

  test("color-scheme does not define the fallback variables", async () => {
    const output = await bundle(`
      :root { color-scheme: light dark }
      .dark { color-scheme: dark }
      .b { color: light-dark(red, blue) }
    `);
    expect(output).toBe(indoc`
      :root {
        color-scheme: light dark;
      }

      .dark {
        color-scheme: dark;
      }

      .b {
        color: light-dark(red, #00f);
      }
    `);
  });
});

describe("An+B", () => {
  minify_test(":nth-child(+n- 5) {width: 20px}", ":nth-child(n-5){width:20px}");
  minify_test(":nth-child(EVEN) {width: 20px}", ":nth-child(2n){width:20px}");
  minify_test(":nth-child(-N- 5) {width: 20px}", ":nth-child(-n-5){width:20px}");
  test.each([
    ["e", "e"],
    ["od", "od"],
    ["*n-3", "*"],
    ["-/**/n", "-"],
  ])("ERROR: :nth-child(%s)", (arg, token) => {
    expect(() => minify_test_with_options(`:nth-child(${arg}) {width: 20px}`, "")).toThrow(
      `Unexpected token: ${token}`,
    );
  });

  // There is no `:first-col`.
  minify_test(":nth-col(1) {color: red} .after {color: blue}", ":nth-col(1){color:red}.after{color:#00f}");
  minify_test(":nth-last-col(1) {color: red}", ":nth-last-col(1){color:red}");
});

describe("what may follow a pseudo-element", () => {
  describe(":window-inactive", () => {
    minify_test("::selection:window-inactive {color:red}", "::selection:window-inactive{color:red}");
    minify_test("body:window-inactive {color:red}", "body:window-inactive{color:red}");
    minify_test("a:is(:window-inactive) {color:red}", "a:window-inactive{color:red}");
    minify_test(
      "::-webkit-scrollbar-thumb:window-inactive {color:red}",
      "::-webkit-scrollbar-thumb:window-inactive{color:red}",
    );
  });

  describe("::details-content and ::picker() take what ::part() takes", () => {
    minify_test("select::picker(select):popover-open {color:red}", "select::picker(select):popover-open{color:red}");
    minify_test("::picker(select):is(:popover-open) {color:red}", "::picker(select):popover-open{color:red}");
    minify_test("details::details-content::before {color:red}", "details::details-content:before{color:red}");
    minify_test(".s::picker(select)::-webkit-scrollbar {width:0}", ".s::picker(select)::-webkit-scrollbar{width:0}");
    minify_test("::part(x):state(y) {color:red}", "::part(x):state(y){color:red}");
    minify_test("::part(x):dir(rtl) {color:red}", "::part(x):dir(rtl){color:red}");
  });

  describe("::marker of ::before and ::after", () => {
    minify_test("li::before::marker {color:red}", "li:before::marker{color:red}");
    minify_test("::after::marker {color:red}", ":after::marker{color:red}");
    minify_test("::part(x)::before::marker {color:red}", "::part(x):before::marker{color:red}");
    // What this prints is the first input.
    prefix_test("li::before { &::marker {color:red} }", "li:before::marker { color: red; }", { chrome: 100 << 16 });
  });

  // Chromium drops each of these rules.
  test.each([
    ["a::before:window-inactive", "Invalid pseudo-class after pseudo-element"],
    ["::selection:horizontal", "Invalid pseudo-class after pseudo-element"],
    ["::checkmark:checked", "Invalid pseudo-class after pseudo-element"],
    ["::picker-icon::before", "Token is not allowed in this state"],
    ["::details-content::before::after", "Token is not allowed in this state"],
    ["::details-content.x", "Unexpected selector after pseudo-element: ."],
    ["::slotted(x):dir(rtl)", "Token is not allowed in this state"],
    ["::before::marker::marker", "Token is not allowed in this state"],
    ["::before:hover::marker", "Token is not allowed in this state"],
    ["::marker::marker", "Token is not allowed in this state"],
  ])("ERROR: %s {color:red}", (selector, message) => {
    expect(() => minify_test_with_options(`${selector} {color:red}`, "")).toThrow(message);
  });
});

describe("attribute selector with a namespace prefix and an operator", () => {
  const xl = '@namespace xl "http://www.w3.org/1999/xlink";';
  minify_test(`${xl} [xl|href$=".pdf"] {color:red}`, `${xl}[xl|href$=".pdf"]{color:red}`);
  minify_test(
    `${xl} [xl|href="a"]{color:red} [href="a"]{color:blue}`,
    `${xl}[xl|href="a"]{color:red}[href=a]{color:#00f}`,
  );
  minify_test("[*|lang=en] {color:red}", '[*|lang="en"]{color:red}');
  minify_test("[viewBox=abc] {color:red}", "[viewBox=abc]{color:red}");
});

describe("bare :global in a plain stylesheet", () => {
  minify_test(":global .foo {width: 20px}", ":global .foo{width:20px}");
  minify_test(":local {width: 20px}", ":local{width:20px}");
});

describe("a `&` that does not lead its selector", () => {
  const lowered = (source: string, expected: string) =>
    test(source, () => {
      expect(cssInternals.minifyTest(source, "", { chrome: 95 << 16 })).toBe(expected);
    });

  // After a combinator, a parent with a combinator needs `:is()`.
  lowered(".a .b { &.on { .dark & { color: red } } }", ".dark :is(.a .b).on{color:red}");
  lowered("ul { li { &:hover { .dark & { color: red } } } }", ".dark :is(ul li):hover{color:red}");
  lowered(".a .b { &:hover { & + & { color: red } } }", ".a .b:hover+:is(.a .b):hover{color:red}");
  lowered(".a .b { :has(+ &) { color: red } }", ":has(+:is(.a .b)){color:red}");
  lowered("a { .dark & { color: red } }", ".dark a{color:red}");
  // After a simple selector, so does a parent with a type selector.
  lowered("div { &:hover { .x& { color: red } } }", ".x:is(div):hover{color:red}");
  lowered("div { .x:is(&) { color: red } }", ".x:is(div){color:red}");
  lowered(".a { &.b { .x& { color: red } } }", ".x.a.b{color:red}");
  // `:is()` cannot hold a pseudo-element.
  lowered(".a::before { &:hover { .dark & { color: red } } }", ".dark .a:before:hover{color:red}");
  lowered(".host::part(thumb) { &:hover { .dark & { color: red } } }", ".dark .host::part(thumb):hover{color:red}");

  test("the targets have nesting", () => {
    expect(cssInternals.minifyTest(".a .b { &:hover { .dark & { color: red } } }", "", { chrome: 130 << 16 })).toBe(
      ".a .b{&:hover{.dark &{color:red}}}",
    );
  });

  describe("in :nth-child(... of S)", () => {
    lowered(".bar { &:nth-child(2 of & > .x) { color: red } }", ".bar:nth-child(2 of .bar>.x){color:red}");
    lowered(".foo { :nth-child(1 of &) { color: red } }", ":nth-child(1 of .foo){color:red}");
    lowered(".a, .b { :nth-child(1 of &) { color: red } }", ":nth-child(1 of :is(.a,.b)){color:red}");
    minify_test(".foo { :nth-child(1 of &) { color: red } }", ".foo{:nth-child(1 of &){color:red}}");
  });
});

describe("vendor prefixes the targets need", () => {
  prefix_test(".q:autofill {color:red}", ".q:-webkit-autofill { color: red; } .q:autofill { color: red; }", {
    chrome: 80 << 16,
  });
  prefix_test(".a:read-only {color:red}", ".a:-moz-read-only { color: red; } .a:read-only { color: red; }", {
    firefox: 50 << 16,
  });

  // Blink and WebKit weigh `:-webkit-any()` as (0,1,0), so a copy of a list of type selectors would outrank the rule.
  prefix_test("a:is(span, p) {color:red}", "a:is(span, p) { color: red; }", { safari: 11 << 16, firefox: 50 << 16 });
  prefix_test(".a:not(span, p) {color:red}", ".a:not(:is(span, p)) { color: red; }", { safari: 8 << 16 });
  prefix_test(":is(header, main) :is(h1, .title) {color:red}", ":is(header, main) :is(h1, .title) { color: red; }", {
    chrome: 80 << 16,
  });
  prefix_test(
    ":is(.a > .b, .c) input::placeholder {color:red}",
    `:is(.a > .b, .c) input::-webkit-input-placeholder { color: red; }
     :is(.a > .b, .c) input::placeholder { color: red; }`,
    { chrome: 50 << 16 },
  );
  prefix_test(".y:is(.a, .b) {color:red}", ".y:-webkit-any(.a, .b) { color: red; } .y:is(.a, .b) { color: red; }", {
    chrome: 80 << 16,
  });
});

describe("a selector list that a target cannot parse", () => {
  const noHasInFirefox = { chrome: 111 << 16, firefox: 114 << 16, safari: (16 << 16) | (4 << 8) };
  const defaults = { chrome: 80 << 16, firefox: 78 << 16, safari: 14 << 16 };

  // One `:is(list)` would give every member the highest weight, and cannot hold `::part()`.
  test.each([
    [
      ".x .y .btn{color:blue} .btn, .card:has(.a .b .c){color:red}",
      ".x .y .btn{color:#00f}.btn{color:red}.card:has(.a .b .c){color:red}",
    ],
    ["a::part(x), b:has(c) {color:red}", "a::part(x){color:red}b:has(c){color:red}"],
    [".b:has(.x), .a, .c:has(.y), .d {color:red}", ".a,.d{color:red}.b:has(.x){color:red}.c:has(.y){color:red}"],
  ])("%s", (source, expected) => {
    expect(cssInternals.minifyTest(source, "", noHasInFirefox)).toBe(expected);
  });
  prefix_test(
    "a:focus-visible, a:hover {color:red}",
    "a:hover { color: red; } a:focus-visible { color: red; }",
    defaults,
  );

  // An engine that does not know a vendor prefix drops the whole list. Browser hacks rely on that.
  describe("stays whole when the author wrote a vendor prefix", () => {
    describe.each([
      [".s{color:red}.s *::-ms-backdrop,.s{color:blue}", ".s { color: red; } .s ::-ms-backdrop, .s { color: #00f; }"],
      [".opera-only :-o-prefocus, .pure-g {color:red}", ".opera-only :-o-prefocus, .pure-g { color: red; }"],
      [".govuk-fieldset, x:-moz-any-link {color:red}", ".govuk-fieldset, x:-moz-any-link { color: red; }"],
      ["_:-ms-fullscreen .c, :root .c {color:red}", "_:-ms-fullscreen .c, :root .c { color: red; }"],
      ["::selection, ::-moz-selection {color:red}", "::selection, ::-moz-selection { color: red; }"],
      [
        "summary::marker, summary::-webkit-details-marker {color:red}",
        "summary::marker, summary::-webkit-details-marker { color: red; }",
      ],
    ])("%s", (source, expected) => {
      prefix_test(source, expected, defaults);
    });
    minify_test("::selection, ::-moz-selection {color:red}", "::selection,::-moz-selection{color:red}");
  });

  // `:is(list):hover` would match nothing.
  prefix_test(
    ".s::-webkit-scrollbar-thumb, .t::-webkit-scrollbar-thumb { &:hover { color: red } }",
    ".s::-webkit-scrollbar-thumb:hover { color: red; } .t::-webkit-scrollbar-thumb:hover { color: red; }",
    defaults,
  );
});

describe("@scope", () => {
  const noNesting = { chrome: 95 << 16 };
  // [source, with nesting kept, with nesting compiled]
  const cases: [string, string, string][] = [
    [
      "@scope to (.limit) { .a { color: red } } .after { color: blue }",
      "@scope to (.limit){.a{color:red}}.after{color:#00f}",
      "@scope to (.limit){.a{color:red}}.after{color:#00f}",
    ],
    // `&` is the scoping root, with no specificity.
    [
      "@scope (.card) to (& > header) { img { top: 1px } }",
      "@scope(.card) to (&>header){img{top:1px}}",
      "@scope(.card) to (:where(:scope)>header){img{top:1px}}",
    ],
    [
      "@scope (.a, .b) to (& > .x, .y) { .c { color: red } }",
      "@scope(.a,.b) to (&>.x,.y){.c{color:red}}",
      "@scope(.a,.b) to (:where(:scope)>.x,.y){.c{color:red}}",
    ],
    // daisyUI 5
    [
      ".join{display:flex;@scope(&){&>:where(.btn){z-index:2}}}",
      ".join{display:flex;@scope(&){&>:where(.btn){z-index:2}}}",
      ".join{display:flex}@scope(.join){:where(:scope)>:where(.btn){z-index:2}}",
    ],
    // In a style rule, <scope-start> is relative to the rule. The rules in the block are not.
    [
      ".p { @scope (.a) { span { color: red } } }",
      ".p{@scope(& .a){span{color:red}}}",
      "@scope(.p .a){span{color:red}}",
    ],
    [
      ".p { @scope (.a) { .c { .d { color: red } } } }",
      ".p{@scope(& .a){.c{& .d{color:red}}}}",
      "@scope(.p .a){.c .d{color:red}}",
    ],
    ["@scope (.a) { > .c { color: red } }", "@scope(.a){&>.c{color:red}}", "@scope(.a){:where(:scope)>.c{color:red}}"],
    ["@scope (.a) { color: red }", "@scope(.a){color:red}", "@scope(.a){:where(:scope){color:red}}"],
    [
      "@scope (.a) { @media screen { color: red } }",
      "@scope(.a){@media screen{color:red}}",
      "@scope(.a){@media screen{:where(:scope){color:red}}}",
    ],
  ];
  test.each(cases)("%s", (source, kept, compiled) => {
    expect(cssInternals.minifyTest(source, "")).toBe(kept);
    expect(cssInternals.minifyTest(source, "", noNesting)).toBe(compiled);
  });
});

describe("rules", () => {
  const chrome80 = { chrome: 80 << 16 };
  // Has `:dir()`, but no nesting and no logical inset properties.
  const firefox60 = { firefox: 60 << 16 };
  const safari14 = { safari: 14 << 16 };
  /** Rows are [source, minified output]. No output: the source is printed as written. */
  const rows = (targets: Record<string, number> | undefined, table: string[][]) =>
    test.each(table.map(([source, expected = source]) => [source, expected]))("%s", (source, expected) => {
      expect(cssInternals.minifyTest(source, "", targets)).toBe(expected);
    });

  describe("an earlier rule with the same selectors is removed only if its declarations are equal", () => {
    rows(undefined, [
      [":root{--a:1}.q{z-index:9}:root{--b:2}"],
      [".a{--x:1}.b{--x:2}.a{--y:3}"],
      [".btn{color:red;cursor:pointer}.q{top:0}.btn{color:red;vertical-align:middle}"],
      [".a{color:red!important}.q{top:0}.a{color:blue}", ".a{color:red!important}.q{top:0}.a{color:#00f}"],
      // A browser that cannot parse the later value uses the earlier one.
      [".a{width:100%}.b{color:red}.a{width:-moz-available}"],
      [".a{width:100vh}.b{color:red}.a{width:100dvh}"],
      [".a{color:red}.b{color:green}.a{color:#f00}", ".b{color:green}.a{color:red}"],
      [".a{--x:1}.b{top:0}.a{--x:1}", ".b{top:0}.a{--x:1}"],
      [".a{background:url(data:,a)}.b{top:0}.a{background:url(data:,a)}", ".b{top:0}.a{background:url(data:,a)}"],
    ]);
    // Chrome 80 has no `:where()`, so these neighbors are not merged.
    rows(chrome80, [[":where(.x){--a:1}:where(.x){--b:2}"]]);
  });

  describe("property names that have no type are compared", () => {
    rows(undefined, [
      [".a{transition:--x 1s}.b{transition:--y 1s}"],
      [".a{transition:--x 1s}.b{transition:--x 1s}", ".a,.b{transition:--x 1s}"],
      [".a{transition-property:cursor}.b{transition-property:z-index}"],
      [".a{transition-property:none}.b{transition-property:all}"],
    ]);
  });

  describe("revert-rule", () => {
    rows(undefined, [
      [".a{color:red}.a{color:revert-rule}"],
      [".a{color:red}.b{top:0}.a{color:revert-rule}"],
      [".a{color:red}.a{color:var(--x,revert-rule)}"],
      [".a{color:red!important}.a{color:revert-rule!important}"],
    ]);
  });

  describe("@supports rules with one condition, and empty @layer blocks", () => {
    rows(undefined, [
      [
        "@supports (display:grid){.a{color:red}}@supports (display:grid){.b{color:blue}}",
        "@supports (display:grid){.a{color:red}}@supports (display:grid){.b{color:#00f}}",
      ],
      [
        ".p{@supports (display:grid){.a{color:red}}@supports (display:grid){.b{color:blue}}}",
        ".p{@supports (display:grid){& .a{color:red}}@supports (display:grid){& .b{color:#00f}}}",
      ],
      [
        "@layer a{}@layer b{}@layer b{.x{color:red}}@layer a{.x{color:blue}}",
        "@layer a{}@layer b{}@layer b{.x{color:red}}@layer a{.x{color:#00f}}",
      ],
      ["@layer a{.x{}}", "@layer a{}"],
      ["@media print{@layer a{}}"],
      ["@layer{}.a{top:0}", ".a{top:0}"],
    ]);
  });

  minify_test("@import url(x.css) supports(-webkit-mask: none);", '@import "x.css" supports((-webkit-mask:none));');

  describe("nested declarations", () => {
    // Rows are [source, nesting kept, nesting compiled away].
    test.each([
      [
        "a{@media (min-width:1px){color:blue}color:green}",
        "a{@media (width>=1px){color:#00f}color:green}",
        "@media (min-width:1px){a{color:#00f}}a{color:green}",
      ],
      [
        ".a{color:red;.b{color:blue}color:green;top:0}",
        ".a{color:red;& .b{color:#00f}color:green;top:0}",
        ".a{color:red}.a .b{color:#00f}.a{color:green;top:0}",
      ],
      [
        ".a{.b{top:0}color:red;.c{top:1px}}",
        ".a{& .b{top:0}color:red;& .c{top:1px}}",
        ".a .b{top:0}.a{color:red}.a .c{top:1px}",
      ],
      // `&{}` would match no pseudo-element and weigh as much as `.h1` for an `h1`.
      [
        '.a::after{content:"x";@media (min-width:1px){color:blue}}',
        '.a:after{content:"x";@media (width>=1px){color:#00f}}',
        '.a:after{content:"x"}@media (min-width:1px){.a:after{color:#00f}}',
      ],
      [
        "h1,.h1{@media (min-width:1px){color:blue}}",
        "h1,.h1{@media (width>=1px){color:#00f}}",
        "@media (min-width:1px){h1,.h1{color:#00f}}",
      ],
      [
        ".a{@supports (display:grid){color:red}@supports (display:grid){.b{color:blue}}}",
        ".a{@supports (display:grid){color:red}@supports (display:grid){& .b{color:#00f}}}",
        "@supports (display:grid){.a{color:red}}@supports (display:grid){.a .b{color:#00f}}",
      ],
      [".a{@starting-style{opacity:0}}", ".a{@starting-style{opacity:0}}", "@starting-style{.a{opacity:0}}"],
      [
        ".a{@container (width>1px){color:red}}",
        ".a{@container (width>1px){color:red}}",
        "@container (width>1px){.a{color:red}}",
      ],
      [".a{@layer x{color:red}}", ".a{@layer x{color:red}}", "@layer x{.a{color:red}}"],
      // A minified `@media all` prints no block, so the `;` is owed to what follows in the outer block.
      [
        ".a{@media all{.b{color:red}color:red}color:blue}",
        ".a{& .b{color:red}color:red;color:#00f}",
        ".a .b{color:red}.a{color:red}.a{color:#00f}",
      ],
      // `div:hover {` is first tried as a declaration.
      [
        ".a{.b{top:0}div:hover{top:1px}color:red}",
        ".a{& .b{top:0}& div:hover{top:1px}color:red}",
        ".a .b{top:0}.a div:hover{top:1px}.a{color:red}",
      ],
    ])("%s", (source, kept, compiled) => {
      expect(cssInternals.minifyTest(source, "")).toBe(kept);
      expect(cssInternals.minifyTest(source, "", chrome80)).toBe(compiled);
    });

    describe("the rules generated for them", () => {
      rows(chrome80, [
        [
          ".a{.b{top:0}color:var(--c,lab(50% 20 30))}",
          ".a .b{top:0}.a{color:var(--c,#a16945)}@supports (color:lab(0% 0 0)){.a{color:var(--c,lab(50% 20 30))}}",
        ],
      ]);
      rows(firefox60, [
        [".a{.b{top:0}inset-inline-start:1px}", ".a:dir(ltr){left:1px}.a:dir(rtl){right:1px}.a .b{top:0}"],
        [
          ".a{@media (min-width:1px){color:red;.b{top:0}inset-inline-start:1px}}",
          "@media (min-width:1px){.a{color:red}.a:dir(ltr){left:1px}.a:dir(rtl){right:1px}.a .b{top:0}}",
        ],
        [
          ".a{@media (min-width:1px){inset-inline-start:1px}@media (min-width:1px){inset-inline-end:2px}}",
          "@media (min-width:1px){.a:dir(ltr){left:1px;right:2px}.a:dir(rtl){left:2px;right:1px}}",
        ],
      ]);
    });
  });

  describe("vendor prefixes of selectors", () => {
    const rtl = ":lang(ae,ar,arc,bcc,bqi,ckb,dv,fa,glk,he,ku,mzn,nqo,pnb,ps,sd,ug,ur,yi)";
    rows(safari14, [
      [
        ".f:fullscreen{inset-inline-start:1px;color:red}",
        ".f:-webkit-full-screen{color:red}.f:fullscreen{color:red}" +
          `.f:-webkit-full-screen:not(${rtl}){left:1px}.f:fullscreen:not(${rtl}){left:1px}` +
          `.f:-webkit-full-screen${rtl}{right:1px}.f:fullscreen${rtl}{right:1px}`,
      ],
      [
        "@media (min-width:1px){.a:fullscreen .b:fullscreen{color:red}}.y{}@media (min-width:1px){.c{color:blue}}",
        "@media (min-width:1px){.a:-webkit-full-screen .b:-webkit-full-screen{color:red}.a:fullscreen .b:fullscreen{color:red}.c{color:#00f}}",
      ],
    ]);
    // Firefox has `:is()` from 78.
    test.each([
      [77, ".a:-webkit-any(.b,.c){color:red}.a:-moz-any(.b,.c){color:red}.a:is(.b,.c){color:red}"],
      [78, ".a:-webkit-any(.b,.c){color:red}.a:is(.b,.c){color:red}"],
    ])(":is() for Chrome 80 and Firefox %d", (firefox, expected) => {
      expect(cssInternals.minifyTest(".a:is(.b,.c){color:red}", "", { ...chrome80, firefox: firefox << 16 })).toBe(
        expected,
      );
    });
  });

  describe("a run of @media rules with one query", () => {
    rows(undefined, [
      [
        "@media (min-width:1px){.a{color:red}}@media (min-width:1px){.a{color:blue}}",
        "@media (width>=1px){.a{color:#00f}}",
      ],
      [
        "@media (min-width:1px){.a{color:red}}@media print{.c{top:0}}@media (min-width:1px){.a{color:blue}}",
        "@media (width>=1px){.a{color:red}}@media print{.c{top:0}}@media (width>=1px){.a{color:#00f}}",
      ],
      // Rules that print nothing do not end the run.
      [
        "@media (min-width:1px){.a{color:red}}@media not all{.z{color:red}}@media (min-width:1px){.a{color:blue}}.y{}@media (min-width:1px){.b{color:blue}}",
        "@media (width>=1px){.a,.b{color:#00f}}",
      ],
    ]);

    const rules = Array.from({ length: 1000 }, (_, i) => `.c${i}{margin:${i}px}`);
    const run = rules.map(rule => `@media (min-width:1px){${rule}}`).join("");
    const block = `@media (min-width:1px){${rules.join("")}}`;
    test("is minified once", () => {
      expect(cssInternals.minifyTest(run, "")).toBe(cssInternals.minifyTest(block, ""));
    });
    test("counts once against the selector limit", () => {
      expect(cssInternals.minifyTest(`.a,.b{${run}}`, "", chrome80)).toBe(
        cssInternals.minifyTest(`.a,.b{${block}}`, "", chrome80),
      );
    });
  });

  describe("selectors that the targets cannot parse", () => {
    rows({ chrome: 60 << 16 }, [
      [
        ".a,.b:focus-visible,.c,.d:focus-visible,.e{color:red}",
        ".a,.c,.e{color:red}.b:focus-visible{color:red}.d:focus-visible{color:red}",
      ],
    ]);
    // No selector stays in the rule, which printed `@supports (…){{…}}`.
    const copy = (selector: string) =>
      `${selector}{color:var(--c,#a16945)}@supports (color:lab(0% 0 0)){${selector}{color:var(--c,lab(50% 20 30))}}`;
    rows(chrome80, [
      [".x:where(a),.y:where(b){color:var(--c,lab(50% 20 30))}", copy(".x:where(a)") + copy(".y:where(b)")],
    ]);
  });

  describe("generated rules", () => {
    describe("keep their selector next to a rule with equal declarations", () => {
      rows(firefox60, [
        [
          ".a{color:red}.b{color:red;inset-inline-start:2px}",
          ".a{color:red}.b{color:red}.b:dir(ltr){left:2px}.b:dir(rtl){right:2px}",
        ],
      ]);
    });

    describe("keep !important", () => {
      rows(firefox60, [
        [".a{inset-inline-start:2px!important}", ".a:dir(ltr){left:2px!important}.a:dir(rtl){right:2px!important}"],
        [
          ".a{inset-inline-start:2px!important;inset-inline-end:4px}",
          ".a:dir(ltr){right:4px;left:2px!important}.a:dir(rtl){left:4px;right:2px!important}",
        ],
        [
          ".a{border-start-start-radius:1px!important;color:red}",
          ".a{color:red}.a:dir(ltr){border-top-left-radius:1px!important}.a:dir(rtl){border-top-right-radius:1px!important}",
        ],
        [
          ".a{inset-inline-start:1px!important}.b{inset-inline-start:2px}",
          ".a:dir(ltr){left:1px!important}.a:dir(rtl){right:1px!important}.b:dir(ltr){left:2px}.b:dir(rtl){right:2px}",
        ],
      ]);
      rows(chrome80, [
        [
          ".a{color-scheme:light dark!important}",
          ".a{--buncss-light:initial!important;--buncss-dark: !important;color-scheme:light dark!important}" +
            "@media (prefers-color-scheme:dark){.a{--buncss-light: !important;--buncss-dark:initial!important}}",
        ],
      ]);
    });

    describe("@supports copies do not outlive a later declaration of the property", () => {
      const lab = (declarations: string) => `@supports (color:lab(0% 0 0)){.x{${declarations}}}`;
      rows(chrome80, [
        [".x{color:var(--c,lab(50% 20 30));color:red}", ".x{color:red}"],
        [".x{color:var(--c,lab(50% 20 30));color:var(--d)}", ".x{color:var(--d)}"],
        [".x{color:var(--c,lab(50% 20 30));color:inherit}", ".x{color:inherit}"],
        [
          ".x{background-color:var(--a,lab(50% 20 30));color:var(--c,lab(50% 20 30));color:red}",
          ".x{background-color:var(--a,#a16945);color:red}" + lab("background-color:var(--a,lab(50% 20 30))"),
        ],
        [
          ".x{color:var(--c,lab(50% 20 30))!important;color:red}",
          ".x{color:red;color:var(--c,#a16945)!important}" + lab("color:var(--c,lab(50% 20 30))!important"),
        ],
        // `.a` is minified again while the copies of `.x` wait.
        [
          ".a{color:red}.a{color:blue}.x{color:var(--c,lab(50% 20 30))}",
          ".a{color:#00f}.x{color:var(--c,#a16945)}" + lab("color:var(--c,lab(50% 20 30))"),
        ],
      ]);
      // daisyUI 5, `::picker(select)`.
      prefix_test(
        ".x{box-shadow:0 2px calc(var(--depth)*3px) -2px oklch(0% 0 0/.2);box-shadow:0 20px 25px -5px rgb(0 0 0/calc(var(--depth)*.1))}",
        ".x{box-shadow:0 2px calc(var(--depth)*3px) -2px #0003;box-shadow:0 20px 25px -5px rgb(0 0 0/calc(var(--depth)*.1));}",
        chrome80,
      );
    });

    describe("no color fallback for what the enclosing @supports tests", () => {
      rows(chrome80, [
        ["@supports (color:lab(0% 0 0)){.b{color:lab(40% 56.6 39)}}"],
        ["@supports (color:lab(0% 0 0)) and (top:0){.b{color:lab(40% 56.6 39)}}"],
        ["@supports (color:oklch(0 0 0)){.b{color:oklch(40% .1 39)}}"],
        ["@supports (color:color(display-p3 0 0 0)){.b{color:color(display-p3 1 0 0)}}"],
        [
          "@supports (color:lab(0% 0 0)) or (top:0){.b{color:lab(40% 56.6 39)}}",
          "@supports (color:lab(0% 0 0)) or (top:0){.b{color:#b32323;color:lab(40% 56.6 39)}}",
        ],
        // Safari 14 has color(display-p3 ..) and no other space.
        [
          "@supports (color:color(display-p3 0 0 0)){.b{color:color(srgb 1 0 0)}}",
          "@supports (color:color(display-p3 0 0 0)){.b{color:color(display-p3 .917488 .200287 .138561);color:color(srgb 1 0 0)}}",
        ],
        // Any value is valid for a custom property, so this holds in browsers without lab().
        [
          "@supports (--x:lab(0% 0 0)){.b{color:lab(40% 56.6 39)}}",
          "@supports (--x:lab(0% 0 0)){.b{color:#b32323;color:lab(40% 56.6 39)}}",
        ],
      ]);
      test("output that is minified again does not grow", () => {
        const first = cssInternals.minifyTest(".a{color:var(--a,lab(50% 20 30))}", "", chrome80);
        expect(first).toBe(
          ".a{color:var(--a,#a16945)}@supports (color:lab(0% 0 0)){.a{color:var(--a,lab(50% 20 30))}}",
        );
        expect(cssInternals.minifyTest(first, "", chrome80)).toBe(first);
      });
    });
  });
});

describe("@font-face", () => {
  // Chrome < 108 and Firefox < 105 drop a `src` that holds a format() keyword.
  describe.each(["woff", "woff2", "truetype", "opentype", "embedded-opentype", "collection", "svg"])("%s", format => {
    minify_test(`@font-face{src:url(a.font)format("${format}")}`, `@font-face{src:url(a.font)format("${format}")}`);
  });
  minify_test("@font-face{src:url(a.woff2)format(woff2)}", '@font-face{src:url(a.woff2)format("woff2")}');
  minify_test(
    '@font-face{src:url(a.otf)format("opentype")tech(features-aat)}',
    '@font-face{src:url(a.otf)format("opentype")tech(features-aat)}',
  );

  // A range of decimal digits only is one number token. White space after it ends the range.
  minify_test("@font-face{unicode-range:U+0000-00FF, U+0131, U+2122\n}", "@font-face{unicode-range:U+??,U+131,U+2122}");
  minify_test("@font-face{unicode-range:U+0131 , U+2122}", "@font-face{unicode-range:U+131,U+2122}");
  minify_test("@font-face{unicode-range:U+0-7F}", "@font-face{unicode-range:U+0-7f}");
  minify_test("@font-face{unicode-range:U+4??}", "@font-face{unicode-range:U+4??}");
});

describe("@keyframes", () => {
  // A browser drops an invalid item of a keyframe block and keeps the keyframe.
  minify_test(
    "@keyframes k { from { opacity: 0; 123: x } to { opacity: 1 } }",
    "@keyframes k{0%{opacity:0}to{opacity:1}}",
  );
  minify_test(
    "@keyframes k { from { opacity: 0; color red; top: 0 } to { opacity: 1 } }",
    "@keyframes k{0%{opacity:0;top:0}to{opacity:1}}",
  );
  minify_test(
    "@keyframes g{0%{--from:#0000;@supports (color:color-mix(in lab,red,red)){--from:color-mix(in oklab,red 0%,transparent)}}to{--from:red}}",
    "@keyframes g{0%{--from:#0000}to{--from:red}}",
  );
  minify_test("@keyframes k { form { opacity: 0 } to { opacity: 1 } }", "@keyframes k{to{opacity:1}}");

  // <timeline-range-name> <percentage>
  minify_test(
    "@keyframes r{entry 0%{opacity:0}entry 100%{opacity:1}}",
    "@keyframes r{entry 0%{opacity:0}entry 100%{opacity:1}}",
  );
  minify_test(
    "@keyframes r{from,COVER 50%{opacity:0}exit-crossing 150%{opacity:1}}",
    "@keyframes r{0%,cover 50%{opacity:0}exit-crossing 150%{opacity:1}}",
  );
  minify_test(
    "@keyframes r{scroll 10%{opacity:0}bogus 10%{opacity:1}entry{opacity:1}}",
    "@keyframes r{scroll 10%{opacity:0}}",
  );
  cssTest("@keyframes r { entry 0% { opacity: 0 } }", "@keyframes r {\n  entry 0% {\n    opacity: 0;\n  }\n}\n");
});

describe("@property", () => {
  minify_test(
    '@property --s{syntax:"<string>";inherits:true;initial-value:"a"}',
    '@property --s{syntax:"<string>";inherits:true;initial-value:"a"}',
  );
  minify_test(
    '@property --s{syntax:"<string>#";inherits:true;initial-value:"a", "b"}',
    '@property --s{syntax:"<string>#";inherits:true;initial-value:"a","b"}',
  );
  // The first component that matches the whole value wins.
  minify_test(
    '@property --l{syntax:"<length>|<length>+";inherits:true;initial-value:1px 2px}',
    '@property --l{syntax:"<length>|<length>+";inherits:true;initial-value:1px 2px}',
  );
  // A value that no component reads is printed as written.
  minify_test(
    '@property --i{syntax:"<integer>";inherits:true;initial-value:calc(1 + 2)}',
    '@property --i{syntax:"<integer>";inherits:true;initial-value:calc(1 + 2)}',
  );
  minify_test(
    '@property --c{syntax:"<color>";inherits:true;initial-value:25px}',
    '@property --c{syntax:"<color>";inherits:true;initial-value:25px}',
  );
  // The value is read with the `syntax` of the whole body, and the last value wins.
  minify_test(
    '@property --c{initial-value:red;initial-value:blue;inherits:true;syntax:"<color>"}',
    '@property --c{syntax:"<color>";inherits:true;initial-value:#00f}',
  );
  minify_test(
    '@property --l{syntax:"*";inherits:true;initial-value: ;}',
    '@property --l{syntax:"*";inherits:true;initial-value:}',
  );
  // var() is not valid in an initial-value, so light-dark() is not lowered.
  prefix_test(
    '@property --c{syntax:"<color>";inherits:true;initial-value:light-dark(red,blue)}',
    '@property --c {\n  syntax: "<color>";\n  inherits: true;\n  initial-value: light-dark(red, #00f);\n}\n',
    { chrome: 80 << 16 },
  );
  test.each([
    ['@property --l{syntax:"<length>";inherits:true}', "Invalid at-rule body"],
    ['@property --l{syntax:"<length>";inherits:true;initial-value:}', "Unexpected end of input"],
  ])("ERROR: %s", (source, message) => {
    expect(() => minify_test_with_options(source, "")).toThrow(message);
  });
});

describe("@counter-style and @font-palette-values", () => {
  minify_test(
    '@counter-style thumbs{system:cyclic;symbols:X;suffix:" "}',
    '@counter-style thumbs{system:cyclic;symbols:X;suffix:" "}',
  );
  minify_test(
    "@counter-style circled{system:fixed;symbols:A B C}.l{list-style:circled}",
    "@counter-style circled{system:fixed;symbols:A B C}.l{list-style:circled}",
  );

  minify_test(
    '@font-palette-values --x { font-family: Bixa, "Bungee Spice"; base-palette: 1 }',
    "@font-palette-values --x{font-family:Bixa,Bungee Spice;base-palette:1}",
  );
  minify_test(
    "@font-palette-values --x { font-family: foo, bar, baz; }",
    "@font-palette-values --x{font-family:foo,bar,baz}",
  );
  minify_test("@font-palette-values --x { font-family: A, serif }", "@font-palette-values --x{}");
});

describe("@supports", () => {
  minify_test("@supports not (display:grid){a{color:red}}", "@supports not (display:grid){a{color:red}}");
  minify_test(
    "@supports (display:grid) and (not (display:inline-grid)){a{color:red}}",
    "@supports (display:grid) and (not (display:inline-grid)){a{color:red}}",
  );
  minify_test("@import url(foo.css) supports(not (display:grid));", '@import "foo.css" supports(not (display:grid));');

  // Tokens after a nested block.
  minify_test(
    "@supports (color: oklch(from var(--any-color) l c h)){a{color:red}}",
    "@supports (color: oklch(from var(--any-color) l c h)){a{color:red}}",
  );
  minify_test(
    "@supports (transform:translate(1px) rotate(1deg)){a{color:red}}",
    "@supports (transform:translate(1px) rotate(1deg)){a{color:red}}",
  );
  minify_test("@supports selector(a:has(b) c){a{color:red}}", "@supports selector(a:has(b) c){a{color:red}}");
  minify_test(
    "@import url(x.css) supports(transform:translate(1px) rotate(1deg));",
    '@import "x.css" supports(transform:translate(1px) rotate(1deg));',
  );
  test("ERROR: @supports (transform:translate(1px) ]){a{color:red}}", () => {
    expect(() => minify_test_with_options("@supports (transform:translate(1px) ]){a{color:red}}", "")).toThrow(
      "Unexpected token: ]",
    );
  });
});

describe("media queries", () => {
  minify_test("@media (width = 240px) { .foo { color: chartreuse }}", "@media (width=240px){.foo{color:#7fff00}}");

  // `or` is allowed inside parentheses after a media type.
  minify_test(
    "@media screen and ((min-width: 600px) or (orientation: landscape)) { .foo { color: chartreuse }}",
    "@media screen and ((width>=600px) or (orientation:landscape)){.foo{color:#7fff00}}",
  );
  minify_test(
    "@media screen and (grid) and ((color) or (hover)) { .foo { color: chartreuse }}",
    "@media screen and (grid) and ((color) or (hover)){.foo{color:#7fff00}}",
  );
  minify_test(
    '@import "foo.css" screen and ((color) or (hover));',
    '@import "foo.css" screen and ((color) or (hover));',
  );

  // An empty list matches everything.
  cssTest("@media { .foo { color: chartreuse }}", "@media all { .foo { color: #7fff00; } }");
  cssTest("@media /* c */ { .foo { color: chartreuse }}", "@media all { .foo { color: #7fff00; } }");
  minify_test("@custom-media --m ;", "@custom-media --m all;");

  // Chromium gives `min-` and `max-` lengths 1/64px of slack.
  prefix_test("@media (width < 1280px){.a{top:1px}}", "@media (max-width: 1279.98px) { .a { top: 1px; } }", {
    chrome: 80 << 16,
  });
  prefix_test("@media (width > 48rem){.a{top:1px}}", "@media (min-width: calc(48rem + .02px)) { .a { top: 1px; } }", {
    chrome: 80 << 16,
  });

  describe("a block that is no known condition is kept as written", () => {
    // The IE 9 and 10 hack of foundation-sites and flatpickr.
    minify_test("@media screen and (min-width:0\\0){.a{top:1px}}", "@media screen and (min-width:0\\0){.a{top:1px}}");
    minify_test(
      "@media screen and (min-width:0\\0) and (min-resolution: +72dpi){.a{top:1px}}",
      "@media screen and (min-width:0\\0) and (resolution>=72dpi){.a{top:1px}}",
    );
    cssTest(
      "@media screen and (min-width: 0\\0 ) { .a { top: 1px } }",
      "@media screen and (min-width: 0\\0 ) {\n  .a {\n    top: 1px;\n  }\n}\n",
    );
    // 98.css and xp.css
    minify_test("@media (not(hover)){.a{top:1px}}", "@media (not(hover)){.a{top:1px}}");
    minify_test(
      "@media (max-width: $tablet) and (color), print{.a{top:1px}}",
      "@media (max-width: $tablet) and (color),print{.a{top:1px}}",
    );
    minify_test("@media not (max-width: em(600px)){.a{top:1px}}", "@media not (max-width: em(600px)){.a{top:1px}}");
    minify_test("@media foo(bar){.a{top:1px}}", "@media foo(bar){.a{top:1px}}");
    minify_test('@import "b.css" screen and (min-width:0\\0);', '@import "b.css" screen and (min-width:0\\0);');

    // Two rules merge when the text is the same.
    minify_test(
      "@media (min-width:0\\0){.a{top:1px}}@media (min-width:0\\0){.b{top:2px}}",
      "@media (min-width:0\\0){.a{top:1px}.b{top:2px}}",
    );
    minify_test(
      "@media (min-width:0\\0){.a{top:1px}}@media (min-width:1\\0){.b{top:2px}}",
      "@media (min-width:0\\0){.a{top:1px}}@media (min-width:1\\0){.b{top:2px}}",
    );

    // A range that starts with a function is still a range.
    minify_test("@media (calc(1px + 2px) <= width){.a{top:1px}}", "@media (width>=3px){.a{top:1px}}");
    // Without its parentheses this would name a layer.
    minify_test('@import "b.css" (layer(x));', '@import "b.css" (layer(x));');
    minify_test("@media ((color) and (hover) x){.a{top:1px}}", "@media ((color) and (hover) x){.a{top:1px}}");
  });

  test.each([
    ["@media &test{.a{top:1px}}", "Unexpected token: &"],
    ["@media &test,speech{.a{top:1px}}", "Unexpected token: &"],
    // govuk-frontend: the escape takes the space, so the media type is `screen\0and`.
    ["@media screen\\0 and (min-width:40.0625em){.a{top:1px}}", "Unexpected token: ("],
    ["@media screen and (color) or (hover){.a{top:1px}}", "Unexpected token: or"],
    ["@media , screen{.a{top:1px}}", "Unexpected token: ,"],
    // Something follows a kept block.
    ["@media (min-width:0\\0) foo{.a{top:1px}}", "Unexpected token: foo"],
    // An error token is not `<any-value>`, and the block has to be closed.
    ["@media (a ] b){.a{top:1px}}", "Unexpected token: ]"],
    ["@media (min-width:0\\0 {.a{top:1px}}", "Invalid media query"],
    ["@media foo(bar {.a{top:1px}}", "Unexpected token: foo("],
    // The query ends after `and`, `or` or `not`.
    ["@media screen and {.a{top:1px}}", "Unexpected end of input"],
    ["@media not {.a{top:1px}}", "Unexpected end of input"],
    ["@media (color) or {.a{top:1px}}", "Unexpected end of input"],
    ["@media (min-width:0\\0) and {.a{top:1px}}", "Unexpected end of input"],
    ["@media screen, print and {.a{top:1px}}", "Unexpected end of input"],
    ['@import "b.css" screen and;', "Unexpected end of input"],
    ["@custom-media --m screen and;", "Unexpected end of input"],
  ])("ERROR: %s", (source, message) => {
    expect(() => minify_test_with_options(source, "")).toThrow(`parsing failed: ${message}`);
  });
  // A blank query after a comma ends the list.
  minify_test("@media screen, {.a{top:1px}}", "@media screen{.a{top:1px}}");

  test("bun build keeps an unknown condition without a warning", async () => {
    using dir = tempDir("css-media-conditions", {
      "entry.css": `
        @import "./dep.css" screen and (min-width:0\\0);
        @media (max-width: $tablet) and (color), print { .a { color: red } }
        @container scroll-state(stuck: top) { .b { color: red } }
      `,
      "dep.css": ".dep { color: red }",
    });
    const result = await Bun.build({ entrypoints: [join(String(dir), "entry.css")], minify: true });
    expect(result.logs).toEqual([]);
    expect(await result.outputs[0].text()).toBe(
      "@media screen and (min-width:0\\0){.dep{color:red}}" +
        "@media (max-width: $tablet) and (color),print{.a{color:red}}" +
        "@container scroll-state(stuck: top){.b{color:red}}\n",
    );
  });

  test.each([
    ['source("../src")', "source("],
    ["layer(theme) theme(inline)", "theme("],
    ["prefix(tw)", "prefix("],
  ])("bun build refuses the function of another tool in @import: %s", async (condition, token) => {
    using dir = tempDir("css-import-function", {
      "entry.css": `@import "./dep.css" ${condition};`,
      "dep.css": ".dep { color: red }",
    });
    const result = await Bun.build({ entrypoints: [join(String(dir), "entry.css")], throw: false });
    expect(result.logs.map(log => [log.level, log.message])).toEqual([["error", `Unexpected token: ${token}`]]);
    expect(result.success).toBe(false);
  });
});

describe("@container", () => {
  minify_test("@container (width = 100px) { a { color: red } }", "@container (width=100px){a{color:red}}");
  cssTest("@container (width = 100px) { a { color: red } }", "@container (width = 100px) { a { color: red; } }");

  // The query is optional after a name.
  minify_test("@container foo { .inner { background: green } }", "@container foo{.inner{background:green}}");
  cssTest("@container foo { a { color: red } }", "@container foo {\n  a {\n    color: red;\n  }\n}\n");

  // What the parser does not know is kept as written.
  minify_test("@container style(--a) { a { color: red } }", "@container style(--a){a{color:red}}");
  minify_test("@container card style(--a) { a { color: red } }", "@container card style(--a){a{color:red}}");
  minify_test("@container not style(--a) { a { color: red } }", "@container not style(--a){a{color:red}}");
  minify_test(
    "@container style((--a) and (--b)) { a { color: red } }",
    "@container style((--a) and (--b)){a{color:red}}",
  );
  minify_test("@container style(--a > 1){a{color:red}}", "@container style(--a > 1){a{color:red}}");
  minify_test("@container scroll-state(stuck: top){a{color:red}}", "@container scroll-state(stuck: top){a{color:red}}");
  minify_test(
    "@container anchored(fallback: flip-block){a{color:red}}",
    "@container anchored(fallback: flip-block){a{color:red}}",
  );
  minify_test(
    "@container card (width > 100px) and scroll-state(stuck: top){a{color:red}}",
    "@container card (width>100px) and scroll-state(stuck: top){a{color:red}}",
  );
  minify_test(
    "@container (style(--a: 1) and (width > 1px)){a{color:red}}",
    "@container style(--a:1) and (width>1px){a{color:red}}",
  );

  test.each([
    ["@container {}", "Unexpected end of input"],
    ["@container foo bar {}", "Unexpected token: bar"],
    ["@container foo(bar {a{color:red}}", "Unexpected token: foo("],
    ["@container (a ] b){a{color:red}}", "Unexpected token: ]"],
  ])("ERROR: %s", (source, message) => {
    expect(() => minify_test_with_options(source, "")).toThrow(message);
  });
});

describe("inset needs its own browser support", () => {
  prefix_test(".a{top:0;right:0;bottom:0;left:0}", ".a{top:0;bottom:0;left:0;right:0;}", { safari: 14 << 16 });
  prefix_test(".a{inset:0}", ".a{top:0;bottom:0;left:0;right:0;}", { safari: 14 << 16 });
  prefix_test(".a{top:0;right:0;bottom:0;left:0}", ".a{inset:0;}", { safari: 15 << 16 });
});

describe("unparsed border-block-* compiled to physical sides", () => {
  prefix_test(".a{border-block-start-width:var(--x)}", ".a{border-top-width:var(--x);}", { chrome: 60 << 16 });
  prefix_test(".a{border-block-end:var(--b)}", ".a{border-bottom:var(--b);}", { chrome: 60 << 16 });
  prefix_test(
    ".a{border-block-start-color:var(--x, lab(40% 56.6 39))}",
    `.a{border-top-color:var(--x, #b32323);}
     @supports (color: lab(0% 0 0)) { .a{border-top-color:var(--x, lab(40% 56.6 39));} }`,
    { chrome: 60 << 16 },
  );
});

describe("border-radius prefixes and two-value sizes", () => {
  prefix_test(".a{border-radius:4px;-webkit-border-radius:4px;-moz-border-radius:4px}", ".a{border-radius:4px;}", {
    chrome: 80 << 16,
  });
  minify_test(
    ".a{border-radius:4px;-webkit-border-radius:4px;-moz-border-radius:4px}",
    ".a{-webkit-border-radius:4px;-moz-border-radius:4px;border-radius:4px}",
  );
  minify_test(
    ".table{border-spacing:0}.rows{border-spacing:0 8px}",
    ".table{border-spacing:0}.rows{border-spacing:0 8px}",
  );
  minify_test(
    ".a{border-top-left-radius:1px 2px}.b{border-top-left-radius:2px 1px}",
    ".a{border-top-left-radius:1px 2px}.b{border-top-left-radius:2px 1px}",
  );
});

describe("border-image", () => {
  const targets = { chrome: 80 << 16, safari: 14 << 16 };

  minify_test(".a{border-image:none}", ".a{border-image:none}");
  minify_test(".a{border-image:none!important}", ".a{border-image:none!important}");
  minify_test(".a{-webkit-mask-box-image:none}", ".a{-webkit-mask-box-image:none}");
  minify_test(
    ".a{border-image-source:none;border-image-slice:100%;border-image-width:1;border-image-outset:0;border-image-repeat:stretch}",
    ".a{border-image:none}",
  );

  // `border` resets border-image, so it has to stay in front.
  prefix_test(
    ".a{border:4px solid;border-image:linear-gradient(red,blue);border-image-slice:1}",
    ".a{border:4px solid;border-image:linear-gradient(red,#00f) 1;}",
    targets,
  );
  prefix_test(
    ".a{border:4px solid;border-image:linear-gradient(red,blue) 1;border-image:linear-gradient(lch(50% 50 180),blue) 1}",
    ".a{border:4px solid;border-image:linear-gradient(red,#00f) 1;border-image:linear-gradient(lch(50% 50 180),#00f) 1;}",
    targets,
  );
  // Only Firefox ever read the second value.
  const mozLast = ".a{border-image:linear-gradient(red,blue) 1;border-image:-moz-linear-gradient(red,blue) 1}";
  prefix_test(
    mozLast,
    ".a{border-image:linear-gradient(red,#00f) 1;border-image:-moz-linear-gradient(red,#00f) 1;}",
    targets,
  );
  minify_test(mozLast, ".a{border-image:linear-gradient(red,#00f) 1;border-image:-moz-linear-gradient(red,#00f) 1}");
  prefix_test(
    ".a{border-image:url(a.png) 1;-moz-border-image:url(b.png) 1}",
    `.a{border-image:url("a.png") 1;-moz-border-image:url("b.png") 1;}`,
    targets,
  );
  prefix_test(
    ".a{border-image:-webkit-linear-gradient(red,blue) 1;border-image:linear-gradient(red,blue) 1}",
    ".a{border-image:linear-gradient(red,#00f) 1;}",
    targets,
  );
  prefix_test(
    ".a{-webkit-border-image:url(x.png) 1;-moz-border-image:url(x.png) 1;-o-border-image:url(x.png) 1;border-image:url(x.png) 1}",
    `.a{border-image:url("x.png") 1;}`,
    targets,
  );
});

describe("`border` is printed only where the rule resets border-image", () => {
  minify_test(
    ".a{border-width:1px;border-style:solid;border-color:red}",
    ".a{border-style:solid;border-width:1px;border-color:red}",
  );
  minify_test(
    ".a{border-top:.3em solid;border-right:.3em solid transparent;border-bottom:0;border-left:.3em solid transparent}",
    ".a{border-top:.3em solid;border-bottom:0;border-left:.3em solid #0000;border-right:.3em solid #0000}",
  );
  minify_test(
    ".a{border-block:1px solid red;border-inline:2px solid blue}",
    ".a{border-block:1px solid red;border-inline:2px solid #00f}",
  );
  minify_test(".a{border:1px solid;border-color:red}", ".a{border:1px solid red}");
  minify_test(
    ".a{border-width:1px;border-style:solid;border-color:red;border-image:url(x.png) 1}",
    ".a{border:1px solid red;border-image:url(x.png) 1}",
  );
  // The reset the author wrote stays.
  minify_test(
    ".a{border:1px solid red;border-bottom:none;border-left:none}",
    ".a{border:1px solid red;border-bottom:none;border-left:none}",
  );
  minify_test(
    ".a{border:1px solid red;border-top:2px dashed blue;border-bottom:none;border-left:3px dotted green}",
    ".a{border:2px dashed #00f;border-bottom:none;border-left:3px dotted green;border-right:1px solid red}",
  );
  minify_test(".a{border-image:url(x.png) 1;border:var(--b)}", ".a{border:var(--b)}");
  minify_test(".a{border-image:none;border:inherit}", ".a{border:inherit}");
});

describe("a size with var() stays behind its fallback", () => {
  minify_test(".a{width:100px;width:var(--w)}", ".a{width:100px;width:var(--w)}");
  minify_test(
    ".a{max-width:calc(100vw - 32px);max-width:var(--mdc-menu-max-width,calc(100vw - 32px))}",
    ".a{max-width:calc(100vw - 32px);max-width:var(--mdc-menu-max-width,calc(100vw - 32px))}",
  );
  minify_test(
    ".a{height:4rem;height:calc(4rem + env(safe-area-inset-bottom))}",
    ".a{height:4rem;height:calc(4rem + env(safe-area-inset-bottom))}",
  );
  prefix_test(".a{inline-size:100px;inline-size:var(--w)}", ".a{width:100px;width:var(--w);}", { chrome: 50 << 16 });
});

describe("alignment keywords without safe / unsafe", () => {
  minify_test(".a{align-items:center}", ".a{align-items:center}");
  minify_test(".a{place-content:center start}", ".a{place-content:center start}");
  minify_test(".a{place-self:center unsafe start}", ".a{place-self:center unsafe start}");
});

describe("font-family", () => {
  // normalize.css: a lone `monospace` computes to 13px, the name twice to 16px.
  minify_test(
    "pre{font-family:monospace,monospace;font-size:1em}",
    "pre{font-family:monospace,monospace;font-size:1em}",
  );
  minify_test("code{font:1em monospace,monospace}", "code{font:1em monospace,monospace}");
  minify_test(
    "a{font-family:monospace,monospace}b{font-family:monospace}",
    "a{font-family:monospace,monospace}b{font-family:monospace}",
  );
  prefix_test(
    ".a{font-family:Roboto,system-ui,Roboto,Arial}",
    ".a{font-family:Roboto,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Ubuntu,Cantarell,Helvetica Neue,Roboto,Arial;}",
    { firefox: 78 << 16 },
  );

  minify_test('.a{font-family:"Serif Gothic"}', '.a{font-family:"Serif Gothic"}');
  minify_test('.a{font-family:Arial,"Sans-Serif Pro",sans-serif}', '.a{font-family:Arial,"Sans-Serif Pro",sans-serif}');
  minify_test('.a{font-family:"Inherit x","Gothic Serif"}', ".a{font-family:Inherit x,Gothic Serif}");
  minify_test('.a{font-family:"HW Impey  Bold"}', '.a{font-family:"HW Impey  Bold"}');
  minify_test('.a{font-family:"Open Sans ",serif}', '.a{font-family:"Open Sans ",serif}');
  minify_test('.a{font-family:" "}', '.a{font-family:" "}');
  minify_test(
    '@font-face{font-family:"Cursive standard";src:local("Cursive standard")}',
    '@font-face{font-family:"Cursive standard";src:local("Cursive standard")}',
  );
});

describe("font shorthand", () => {
  minify_test(
    ".a{font:10px serif;font-family:Arial;font-size:14px;font-style:italic;font-weight:500;font-stretch:condensed;font-variant-caps:small-caps;line-height:21px}",
    ".a{font:italic small-caps 500 condensed 14px/21px Arial}",
  );
  minify_test(
    ".a{font-family:Arial,sans-serif;font-size:14px;font-style:normal;font-weight:500;font-stretch:100%;font-variant-caps:normal;line-height:21px}",
    ".a{font-family:Arial,sans-serif;font-size:14px;font-style:normal;font-variant-caps:normal;font-weight:500;font-stretch:100%;line-height:21px}",
  );

  // `font` resets these, so they stay on the side of it they were written on.
  minify_test(".a{font:12px serif;font-kerning:none}", ".a{font:12px serif;font-kerning:none}");
  minify_test(
    ".a{font-kerning:none;font:12px serif;font-kerning:normal}",
    ".a{font-kerning:none;font:12px serif;font-kerning:normal}",
  );
  minify_test(
    '.a{font:12px serif;font-feature-settings:"tnum";line-height:2}',
    '.a{font:12px serif;font-feature-settings:"tnum";line-height:2}',
  );
  // Without a `font` nothing is reset, and the longhands around it still merge.
  minify_test(
    ".a{font-size:12px;font-variant:tabular-nums;font-size:14px}",
    ".a{font-variant:tabular-nums;font-size:14px}",
  );
  // The vendor prefix does not count: Blink and WebKit read this name as font-feature-settings.
  minify_test(
    '.a{font:12px A;-webkit-font-feature-settings:"liga"}',
    '.a{font:12px A;-webkit-font-feature-settings:"liga"}',
  );
  minify_test(
    ".a{font:12px serif;-webkit-font-smoothing:antialiased;line-height:2}",
    ".a{font:12px serif;-webkit-font-smoothing:antialiased;line-height:2}",
  );

  // `font` takes a font-stretch keyword, never a percentage.
  minify_test(".a{font:condensed 12px foo}", ".a{font:condensed 12px foo}");
  minify_test(".a{font:12px serif;font-stretch:expanded}", ".a{font:expanded 12px serif}");
  minify_test(".a{font:12px serif;font-stretch:50%}", ".a{font:12px serif;font-stretch:50%}");
  minify_test(".a{font:small-caps 12px foo;line-height:2}", ".a{font:small-caps 12px/2 foo}");
});

describe("css-wide keywords are not names", () => {
  describe.each(["inherit", "initial", "unset", "revert", "revert-layer"])("%s", keyword => {
    minify_test(`.a{font:12px Arial;font-family:${keyword}}`, `.a{font:12px Arial;font-family:${keyword}}`);
    minify_test(
      `.a{transition:all .2s;transition-property:${keyword}}`,
      `.a{transition:all .2s;transition-property:${keyword}}`,
    );
    minify_test(`.a{color-scheme:${keyword}}`, `.a{color-scheme:${keyword}}`);
  });
  minify_test(
    ".a{transition:inherit;transition-property:opacity}",
    ".a{transition:inherit;transition-property:opacity}",
  );
  // An ident that names no scheme we know is not `normal` either.
  minify_test("iframe{color-scheme:auto}", "iframe{color-scheme:auto}");
});

describe("transition-behavior", () => {
  minify_test(
    ".a{transition:all 1s;transition-behavior:allow-discrete}",
    ".a{transition:all 1s;transition-behavior:allow-discrete}",
  );
  minify_test(
    ".a{transition-behavior:allow-discrete;transition:all 1s}",
    ".a{transition-behavior:allow-discrete;transition:all 1s}",
  );
});

describe("gradient stops and directions stay as written", () => {
  minify_test(
    ".a{background:linear-gradient(to top,green 50%,red 0%)}",
    ".a{background:linear-gradient(0deg,green 50%,red 0%)}",
  );
  minify_test(
    ".a{background:linear-gradient(to top,currentColor,currentColor 50%,transparent 50%,transparent)}",
    ".a{background:linear-gradient(0deg,currentColor,currentColor 50%,#0000 50%,#0000)}",
  );
  minify_test(
    ".a{background:linear-gradient(to top,red,25%,blue)}",
    ".a{background:linear-gradient(0deg,red,25%,#00f)}",
  );
  minify_test(
    ".a{background:repeating-linear-gradient(0deg,red 10%,blue 20%)}",
    ".a{background:repeating-linear-gradient(0deg,red 10%,#00f 20%)}",
  );
  minify_test(
    ".a{background:linear-gradient(yellow 0%,50%,blue 60%)}",
    ".a{background:linear-gradient(#ff0 0%,50%,#00f 60%)}",
  );
  minify_test(
    ".a{background:radial-gradient(yellow 0%,50%,blue 60%)}",
    ".a{background:radial-gradient(#ff0 0%,50%,#00f 60%)}",
  );

  // In the prefixed syntax a keyword names the side the gradient starts from, `0deg` points right
  // and the default is `top`.
  describe.each([
    ["", ""],
    ["top,", ""],
    ["bottom,", "bottom,"],
    ["left,", "left,"],
    ["0deg,", "0deg,"],
    ["180deg,", "180deg,"],
  ])("%s", (written, printed) => {
    minify_test(
      `.a{background:-webkit-linear-gradient(${written}red,blue)}`,
      `.a{background:-webkit-linear-gradient(${printed}red,#00f)}`,
    );
  });
  cssTest(
    ".a{background:-moz-repeating-linear-gradient(bottom,red,blue 20px)}",
    ".a{background:-moz-repeating-linear-gradient(bottom,red,#00f 20px);}",
  );
  minify_test(
    ".a{background:-webkit-linear-gradient(red,blue)}.b{background:-webkit-linear-gradient(bottom,red,blue)}",
    ".a{background:-webkit-linear-gradient(red,#00f)}.b{background:-webkit-linear-gradient(bottom,red,#00f)}",
  );
  // A generated copy of the default direction has the default direction.
  prefix_test(
    ".a{background-image:image-set(url(a.png) 1x),linear-gradient(red,blue)}",
    `.a{
      background-image:-webkit-image-set(url("a.png") 1x),-webkit-linear-gradient(red,#00f);
      background-image:image-set("a.png" 1x),linear-gradient(red,#00f);
    }`,
    { chrome: 80 << 16, safari: 14 << 16 },
  );
});

describe("-webkit-box-orient and -webkit-box-direction next to flex-direction", () => {
  const defaults = { chrome: 80 << 16, edge: 80 << 16, firefox: 78 << 16, safari: 14 << 16, opera: 67 << 16 };
  prefix_test(
    ".a{display:-webkit-box;-webkit-box-orient:vertical;flex-direction:column;-webkit-line-clamp:2;overflow:hidden}",
    ".a{display:-webkit-box;-webkit-line-clamp:2;overflow:hidden;-webkit-box-orient:vertical;flex-direction:column;}",
    defaults,
  );
  prefix_test(
    ".a{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;flex-flow:column wrap}",
    ".a{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;flex-flow:column wrap;}",
    defaults,
  );
  prefix_test(
    ".a{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3}.a{flex-direction:column}",
    ".a{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;flex-direction:column;}",
    defaults,
  );
  prefix_test(
    ".a{-webkit-box-direction:reverse;flex-direction:row-reverse}",
    ".a{-webkit-box-direction:reverse;flex-direction:row-reverse;}",
    defaults,
  );
});

describe("prefixed backgrounds keep their place", () => {
  minify_test(
    ".a{background:-webkit-linear-gradient(left,red,blue);background:-moz-linear-gradient(left,red,blue);background:var(--bg)}",
    ".a{background:-webkit-linear-gradient(left,red,#00f);background:-moz-linear-gradient(left,red,#00f);background:var(--bg)}",
  );
  minify_test(
    ".a{background:-webkit-linear-gradient(left,red,blue);background:-moz-linear-gradient(left,red,blue);background:-webkit-radial-gradient(center,ellipse cover,red,blue)}",
    ".a{background:-webkit-linear-gradient(left,red,#00f);background:-moz-linear-gradient(left,red,#00f);background:-webkit-radial-gradient(center,ellipse cover,red,blue)}",
  );
  const msInTheMiddle =
    ".a{background:-moz-linear-gradient(left,red,blue);background:-ms-linear-gradient(left,red,blue);background:-webkit-linear-gradient(left,red,blue);background:linear-gradient(to right,red,blue)}";
  minify_test(
    msInTheMiddle,
    ".a{background:-moz-linear-gradient(left,red,#00f);background:-ms-linear-gradient(left,red,blue);background:-webkit-linear-gradient(left,red,#00f);background:linear-gradient(90deg,red,#00f)}",
  );
  prefix_test(
    msInTheMiddle,
    ".a{background:-moz-linear-gradient(left,red,#00f);background:-ms-linear-gradient(left,red,blue);background:linear-gradient(to right,red,#00f);}",
    { chrome: 80 << 16 },
  );
  prefix_test(
    ".a{background:-webkit-linear-gradient(left,red,blue);background:-moz-linear-gradient(left,red,blue) lab(40% 56.6 39)}",
    ".a{background:-webkit-linear-gradient(left,red,#00f);background:lab(40% 56.6 39) -moz-linear-gradient(left,red,#00f);}",
    { chrome: 80 << 16 },
  );
});

describe("positions browsers accept", () => {
  minify_test(
    ".a{background-image:radial-gradient(circle at right 20%,red,blue)}",
    ".a{background-image:radial-gradient(circle at right 20%,red,#00f)}",
  );
  minify_test(
    ".a{background-image:conic-gradient(at right 40%,red,blue)}",
    ".a{background-image:conic-gradient(at right 40%,red,#00f)}",
  );
  minify_test(
    ".a{background-image:radial-gradient(circle at 10px bottom,red,blue)}",
    ".a{background-image:radial-gradient(circle at 10px bottom,red,#00f)}",
  );
  minify_test(".a{background-position:center bottom 10px}", ".a{background-position:center bottom 10px}");
  minify_test(".a{background-position-x:10px;background-position-y:top 5px}", ".a{background-position:10px 5px}");
  minify_test(".a{background-position:right center}", ".a{background-position:100%}");
  minify_test(".a{background-position:right 10px center}", ".a{background-position:right 10px center}");
});

describe("blanks that --minify drops from values kept as tokens", () => {
  // [declaration, default output, minified output]
  test.each([
    // Nothing merges with a closing bracket, or with what follows an opening one.
    ["padding: var(--a) var(--b)", "padding: var(--a) var(--b)", "padding:var(--a)var(--b)"],
    ["border: var(--w) solid transparent", "border: var(--w) solid transparent", "border:var(--w)solid transparent"],
    [
      "color: color-mix(in oklab, var(--a), var(--b) 75%)",
      "color: color-mix(in oklab, var(--a), var(--b) 75%)",
      "color:color-mix(in oklab,var(--a),var(--b)75%)",
    ],
    ["--x: ( a ) [ b ] { c } d", "--x: ( a ) [ b ] { c } d", "--x:(a)[b]{c}d"],
    // `a(` would be a function.
    ["--x: a (b)", "--x: a (b)", "--x:a (b)"],
    // Around `*` and `/`.
    ["width: calc(var(--s) * .5)", "width: calc(var(--s) * .5)", "width:calc(var(--s)*.5)"],
    ["width: calc(var(--x, 24px) / 2)", "width: calc(var(--x, 24px) / 2)", "width:calc(var(--x,24px)/2)"],
    ["--x: 2 * -1 / a", "--x: 2 * -1 / a", "--x:2*-1/a"],
    // `/*` would start a comment and `*=` is one token.
    ["--x: x //**/* y", "--x: x / * y", "--x:x/ *y"],
    ["--x: a * = b", "--x: a * = b", "--x:a* = b"],
    // calc() needs the blanks around `+` and `-`.
    [
      "width: calc(var(--a) - var(--b) + (1px) * - 1)",
      "width: calc(var(--a) - var(--b) + (1px) * - 1)",
      "width:calc(var(--a) - var(--b) + (1px)* - 1)",
    ],
    // A written `+` keeps two numbers apart.
    ["--x: 1+2", "--x: 1+2", "--x:1+2"],
    ["--nth: 2n+1", "--nth: 2n+1", "--nth:2n+1"],
  ])("%s", (declaration, normal, minified) => {
    expect(cssInternals._test(`.c { ${declaration}; }`, "")).toBe(`.c {\n  ${normal};\n}\n`);
    expect(cssInternals.minifyTest(`.c { ${declaration}; }\n.k { top: 0 }`, "")).toBe(`.c{${minified}}.k{top:0}`);
  });
});

describe("a generated prefixed gradient points the same way", () => {
  // In the prefixed syntax a keyword names the side the gradient starts from, and angles turn
  // counterclockwise from `to right`.
  describe.each([
    ["to top,", "bottom,"],
    ["to right,", "left,"],
    ["to left,", "right,"],
    ["to top left,", "bottom right,"],
    ["0deg,", "90deg,"],
    ["45deg,", "45deg,"],
    ["135deg,", "315deg,"],
    [".25turn,", "0deg,"],
    ["to bottom,", "", ""],
    ["180deg,", "", ""],
  ])("%s", (standard, prefixed, printed = standard) => {
    prefix_test(
      `.a{background-image:linear-gradient(${standard}red,blue)}`,
      `.a{
        background-image:-webkit-linear-gradient(${prefixed}red,#00f);
        background-image:linear-gradient(${printed}red,#00f);
      }`,
      { chrome: 20 << 16 },
    );
  });
  prefix_test(
    ".a{background-image:repeating-linear-gradient(to right,red,blue 20px)}",
    `.a{
      background-image:-webkit-repeating-linear-gradient(left,red,#00f 20px);
      background-image:repeating-linear-gradient(to right,red,#00f 20px);
    }`,
    { chrome: 20 << 16 },
  );
  // The default targets get a copy next to image-set().
  prefix_test(
    ".a{background-image:image-set(url(a.png) 1x),linear-gradient(to right,red,blue)}",
    `.a{
      background-image:-webkit-image-set(url("a.png") 1x),-webkit-linear-gradient(left,red,#00f);
      background-image:image-set("a.png" 1x),linear-gradient(to right,red,#00f);
    }`,
    { chrome: 80 << 16, safari: 14 << 16 },
  );
  // A written prefixed gradient is in that syntax already.
  prefix_test(
    ".a{background-image:-webkit-linear-gradient(left,red,blue)}",
    ".a{background-image:-webkit-linear-gradient(left,red,#00f);}",
    { chrome: 20 << 16 },
  );
});

describe("@nest", () => {
  // The minifier leaves the block of an `@nest` rule as written, also what follows a nested rule in it.
  test("a logical property after a nested rule stays in the block", () => {
    expect(
      cssInternals.minifyTest(".z2{@nest .p &{.c{color:red}margin-inline-start:1px;color:blue}.after{color:red}}", "", {
        safari: 8 << 16,
      }),
    ).toBe(".p .z2{margin-inline-start:1px;color:#00f}.p .z2 .c{color:red}.z2 .after{color:red}");
  });
});

describe("a `&` with no parent rule", () => {
  // Chrome 80 has `:scope` and no `:where()`. A browser with `@scope` has both.
  prefix_test("& .root { color: red }", ":scope .root { color: red; }", { chrome: 80 << 16 });
  prefix_test(
    "@scope (.a) { & .c { color: red } } & .root { color: red }",
    "@scope (.a) { :where(:scope) .c { color: red; } } :scope .root { color: red; }",
    { chrome: 80 << 16 },
  );
});

describe("rounding to 6 digits only cuts a fraction short", () => {
  describe.each([
    // Kept as tokens: the source text prints.
    "a{--x:1234567.5}",
    "a{--ts:1700000000.25}",
    "a{--x:123456.78}",
    // Typed values are f32: every integer digit prints, and one digit of the fraction.
    "a{width:1234567.5px}",
    "a{max-width:9999999px}",
    "a{margin:-1000001px}",
    "a{flex-grow:1234567}",
    "a{transition-delay:9999999s}",
    // 1024.08 * 100 is 102407.99 as an f32.
    "a{width:102408%}",
  ])("%s", css => {
    minify_test(css, css);
  });
  minify_test("@media (min-width:1234567px){a{color:red}}", "@media (width>=1234567px){a{color:red}}");
  // From 2^24 on an f32 does not hold every integer.
  minify_test("a{width:2147483647px}", "a{width:2147483600px}");
  minify_test("a{width:calc(infinity * 1px)}", "a{width:3.40282e38px}");

  minify_test("a{width:33.3333333333%}", "a{width:33.3333%}");
  minify_test("a{width:42.8571428571%}", "a{width:42.8571%}");
  minify_test("a{--x:241.8301435407}", "a{--x:241.83}");
  minify_test("a{opacity:.123456789}", "a{opacity:.123457}");
  minify_test("a{width:12345.678px}", "a{width:12345.7px}");
  minify_test("a{width:123456.78px}", "a{width:123456.8px}");
  // 100000 * 1.3 is 129999.99 as an f32.
  minify_test("a{width:calc(100000px * 1.3)}", "a{width:130000px}");
  minify_test("a{--x:0000001;--y:000000.5}", "a{--x:1;--y:.5}");
});

describe("consecutive nested declarations are one rule", () => {
  // Rows are [source, nesting kept, nesting compiled away].
  test.each([
    // The three @media rules merge, which puts their declarations side by side.
    [
      ".a,.b{@media print{color:red}@media print{color:red}@media print{top:0}}",
      ".a,.b{@media print{color:red;top:0}}",
      "@media print{.a,.b{color:red;top:0}}",
    ],
    [
      ".a{@media print{top:0!important}@media print{color:red}@media print{left:0!important}}",
      ".a{@media print{color:red;top:0!important;left:0!important}}",
      "@media print{.a{color:red;top:0!important;left:0!important}}",
    ],
    // `.c{}` prints nothing.
    [".a{.b{top:0}color:red;.c{}color:blue}", ".a{& .b{top:0}color:#00f}", ".a .b{top:0}.a{color:#00f}"],
    // A nested rule between them keeps them apart.
    [
      ".a{@media print{color:red}@media print{.b{top:0}}@media print{color:blue}}",
      ".a{@media print{color:red;& .b{top:0}color:#00f}}",
      "@media print{.a{color:red}.a .b{top:0}.a{color:#00f}}",
    ],
  ])("%s", (source, kept, compiled) => {
    expect(cssInternals.minifyTest(source, "")).toBe(kept);
    expect(cssInternals.minifyTest(source, "", { chrome: 80 << 16 })).toBe(compiled);
  });
});

describe("an unknown at-rule in a style rule", () => {
  const compiled = (source: string) => cssInternals.minifyTest(source, "", { chrome: 80 << 16 });

  describe("stays in a block of that rule when nesting is compiled away", () => {
    test.each([
      [".btn{@apply font-bold}", ".btn{@apply font-bold;}"],
      [".btn{color:red;@apply font-bold}", ".btn{color:red}.btn{@apply font-bold;}"],
      [".a,.b{@apply x}", ".a,.b{@apply x;}"],
      [".p{.q{@apply x}}", ".p .q{@apply x;}"],
      [".a{@media print{@apply x}}", "@media print{.a{@apply x;}}"],
      // It keeps its place among the nested rules and the declarations.
      [".a{.b{top:0}@apply x;color:red}", ".a .b{top:0}.a{@apply x;}.a{color:red}"],
    ])("%s", (source, expected) => {
      expect(compiled(source)).toBe(expected);
    });

    // Chrome ignores a nested `@position-try`. At the top level it would be live.
    test.each(["@mixin larger-than $x{display:none}", "@position-try --p{top:0}"])("%s", atRule => {
      expect(compiled(`.a{${atRule}}`)).toBe(`.a{${compiled(atRule)}}`);
    });

    test("in each vendor prefix pass", () => {
      expect(cssInternals.minifyTest(".a:fullscreen{@apply x}", "", { safari: 14 << 16 })).toBe(
        ".a:-webkit-full-screen{@apply x;}.a:fullscreen{@apply x;}",
      );
    });
  });

  minify_test(".a{@media print{@apply x}}", ".a{@media print{@apply x;}}");
  test("@apply x; at the top level", () => {
    expect(compiled("@media print{@apply x}")).toBe("@media print{@apply x;}");
  });
});

describe("without targets nothing an author prefixed is dropped", () => {
  minify_test(
    "a{inline-size:-webkit-fill-available;inline-size:-moz-available}",
    "a{inline-size:-webkit-fill-available;inline-size:-moz-available}",
  );
  minify_test(
    "a{min-height:100vh;min-height:-webkit-fill-available}",
    "a{min-height:100vh;min-height:-webkit-fill-available}",
  );
  minify_test(
    "a{max-width:-webkit-max-content;max-width:-moz-max-content;max-width:max-content}",
    "a{max-width:-webkit-max-content;max-width:-moz-max-content;max-width:max-content}",
  );
  minify_test("a{width:1px;width:2px}", "a{width:2px}");

  minify_test(
    "a{-webkit-box-align:center;-webkit-align-items:center}",
    "a{-webkit-box-align:center;-webkit-align-items:center}",
  );
  minify_test(
    "a{-webkit-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between}",
    "a{-webkit-box-align:center;-webkit-box-pack:justify;-ms-flex-pack:justify;-ms-flex-align:center;justify-content:space-between;align-items:center}",
  );
  minify_test(
    "a{-ms-flex-item-align:center;align-self:center;-ms-flex-line-pack:center;align-content:center}",
    "a{-ms-flex-item-align:center;-ms-flex-line-pack:center;align-content:center;align-self:center}",
  );
  // The targets say that nobody needs them.
  prefix_test("a{-webkit-box-align:center;-ms-flex-align:center;align-items:center}", "a{align-items:center;}", {
    chrome: 80 << 16,
  });
});

describe("`transition` is printed only where the rule wrote one", () => {
  minify_test(
    "a{transition-delay:0s;transition-duration:1s;transition-property:all;transition-timing-function:ease}",
    "a{transition-property:all;transition-duration:1s;transition-delay:0s;transition-timing-function:ease}",
  );
  minify_test("a{transition:all 1s;transition-duration:2s}", "a{transition:all 2s}");
  minify_test(
    "a{transition-property:all;transition-duration:1s;transition-delay:0s;transition-timing-function:ease;transition:opacity 2s}",
    "a{transition:opacity 2s}",
  );
  // The copy the targets add needs its own duration.
  prefix_test(
    "a{transition-property:mask-image,opacity;transition-duration:1s,2s;transition-delay:0s;transition-timing-function:ease}",
    "a{transition:-webkit-mask-image 1s,mask-image 1s,opacity 2s;}",
    { chrome: 80 << 16 },
  );
});

describe("color-scheme keeps the order of its schemes", () => {
  minify_test("a{color-scheme:dark light}", "a{color-scheme:dark light}");
  minify_test("a{color-scheme:only dark light}", "a{color-scheme:dark light only}");
  minify_test(
    "a{color-scheme:light dark}b{color-scheme:dark light}",
    "a{color-scheme:light dark}b{color-scheme:dark light}",
  );
  prefix_test(
    "a{color-scheme:dark light}",
    `a{--buncss-light:initial;--buncss-dark: ;color-scheme:dark light;}
     @media (prefers-color-scheme: dark){a{--buncss-light: ;--buncss-dark:initial;}}`,
    { chrome: 90 << 16 },
  );
});

describe("scrollbar pseudo-classes", () => {
  // WebKit and Blink take them in a plain compound too.
  describe.each([
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
  ])(":%s", state => {
    minify_test(`a:${state} {color:red}`, `a:${state}{color:red}`);
  });
  minify_test("a:not(:horizontal) b {color:red}", "a:not(:horizontal) b{color:red}");
  minify_test("a:is(:horizontal) {color:red}", "a:horizontal{color:red}");
  minify_test("::-webkit-scrollbar { &:horizontal {color:red} }", "::-webkit-scrollbar{&:horizontal{color:red}}");
  prefix_test("::-webkit-scrollbar { &:horizontal {color:red} }", "::-webkit-scrollbar:horizontal { color: red; }", {
    chrome: 100 << 16,
  });
  minify_test("::part(x):window-inactive {color:red}", "::part(x):window-inactive{color:red}");
  minify_test("::details-content:window-inactive {color:red}", "::details-content:window-inactive{color:red}");
});

describe("selectors that Chromium drops stay errors", () => {
  const afterPseudoElement = "Invalid pseudo-class after pseudo-element";
  const notAllowed = "Token is not allowed in this state";
  test.each([
    ["::part(x):horizontal", afterPseudoElement],
    ["::details-content:horizontal", afterPseudoElement],
    ["::-webkit-slider-thumb:horizontal", afterPseudoElement],
    ["::before:horizontal", afterPseudoElement],
    ["::-webkit-slider-thumb:window-inactive", afterPseudoElement],
    ["::-moz-selection:window-inactive", afterPseudoElement],
    ["::details-content:first-child", afterPseudoElement],
    ["::picker(select):host", afterPseudoElement],
    ["::picker(select):foo", afterPseudoElement],
    ["::details-content::foo", notAllowed],
    ["::details-content:foo(a)", notAllowed],
    ["::part(x):foo(a)", notAllowed],
    ["::before::marker:hover", notAllowed],
  ])("ERROR: %s {color:red}", (selector, message) => {
    expect(() => minify_test_with_options(`${selector} {color:red}`, "")).toThrow(message);
  });
  minify_test("::details-content::-webkit-foo {color:red}", "::details-content::-webkit-foo{color:red}");
});

describe("a ratio in a media feature that is not known", () => {
  // Presto reads `2/1` and not `2`.
  minify_test(
    "@media (-o-min-device-pixel-ratio: 2/1) {a {color:red}}",
    "@media (-o-min-device-pixel-ratio:2/1){a{color:red}}",
  );
  minify_test(
    "@media (-o-min-device-pixel-ratio: 3/2) {a {color:red}}",
    "@media (-o-min-device-pixel-ratio:3/2){a{color:red}}",
  );
  minify_test("@media (min-aspect-ratio: 2/1) {a {color:red}}", "@media (aspect-ratio>=2){a{color:red}}");
});

describe("sin(), cos() and tan() of a multiple of 90deg", () => {
  minify_test("a{width:calc(tan(90deg)*1px)}", "a{width:3.40282e38px}");
  minify_test("a{margin-left:calc(tan(-90deg)*1px)}", "a{margin-left:-3.40282e38px}");
  minify_test("a{width:calc(100px*cos(90deg))}", "a{width:0}");
  minify_test("a{margin-left:calc(100px*sin(.5turn))}", "a{margin-left:0}");
  minify_test("a{opacity:tan(180deg)}", "a{opacity:0}");
  minify_test("a{width:calc(100px*cos(60deg))}", "a{width:50px}");
});

describe("properties of the range [0,∞]", () => {
  describe.each([
    "padding",
    "padding-left",
    "padding-inline",
    "gap",
    "row-gap",
    "font-size",
    "border-width",
    "border-left-width",
    "outline-width",
    "flex-basis",
  ])("%s", property => {
    minify_test(`a{${property}:calc(1px - 5px)}`, `a{${property}:0}`);
    // A browser drops the negative literal and keeps the declaration before it.
    minify_test(`a{${property}:1px;${property}:-5px}`, `a{${property}:1px;${property}:-5px}`);
  });
  minify_test("a{padding:calc(1% - 5%)}", "a{padding:0%}");
  minify_test("a{padding:2px calc(1px - 5px)}", "a{padding:2px 0}");
  minify_test("a{flex:1 1 calc(1px - 5px)}", "a{flex:1 1 0}");
  minify_test("a{width:10px;width:-5px}", "a{width:10px;width:-5px}");
  minify_test("a{border-radius:1px;border-radius:-5px}", "a{border-radius:1px;border-radius:-5px}");
  // The arguments have no range.
  minify_test("a{padding:calc(10px + calc(1px - 5px))}", "a{padding:6px}");
  minify_test("a{padding:max(-5px,2px)}", "a{padding:2px}");
  minify_test("a{margin:calc(1px - 5px)}", "a{margin:-4px}");
});
