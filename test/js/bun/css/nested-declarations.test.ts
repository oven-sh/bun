import { cssInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Declarations written after a nested rule (or directly inside a conditional
// at-rule nested in a style rule) form a nested declarations rule that keeps
// its position in the cascade: https://drafts.csswg.org/css-nesting/#nested-declarations-rule
//
// They used to be merged into the enclosing rule's own declaration block, which
// hoisted them above the nested rules they were written after, so e.g.
// `a { &{color:blue} color:green }` rendered blue instead of green.

const { minifyTest, prefixTest, _test } = cssInternals;

// CSS nesting is not supported, so it gets compiled away; everything else
// used below is supported, so the output stays small.
const chrome87 = { chrome: 87 << 16 };
// Additionally lacks logical inset properties and light-dark(), but supports
// `:dir()`, so those properties compile to compact fallback rules.
const firefox60 = { firefox: 60 << 16 };

const minifyPreserved = (source: string) => minifyTest(source, "");
const minifyLowered = (source: string, targets: object = chrome87) => minifyTest(source, "", targets);

describe("declarations after a nested rule keep their position", () => {
  test.each([
    [
      "a { color: red; & { color: blue } color: green }",
      "a{color:red;&{color:#00f}color:green}",
      "a{color:red}a{color:#00f}a{color:green}",
    ],
    [".a { .b { color: blue } color: green }", ".a{& .b{color:#00f}color:green}", ".a .b{color:#00f}.a{color:green}"],
    [
      ".a { &:hover { color: blue } color: green; &:focus { color: red } }",
      ".a{&:hover{color:#00f}color:green;&:focus{color:red}}",
      ".a:hover{color:#00f}.a{color:green}.a:focus{color:red}",
    ],
    // Each run of declarations becomes its own rule; consecutive declarations share one.
    [
      ".a { color: red; .b { color: blue } color: green; .c { color: yellow } color: purple; background: white }",
      ".a{color:red;& .b{color:#00f}color:green;& .c{color:#ff0}color:purple;background:#fff}",
      ".a{color:red}.a .b{color:#00f}.a{color:green}.a .c{color:#ff0}.a{color:purple;background:#fff}",
    ],
    // The run is minified like a declaration block: shorthands, overrides and `!important` ordering.
    [
      ".a { .b { color: blue } margin-left: 1px; margin-right: 2px; margin-top: 3px; margin-bottom: 4px }",
      ".a{& .b{color:#00f}margin:3px 2px 4px 1px}",
      ".a .b{color:#00f}.a{margin:3px 2px 4px 1px}",
    ],
    [
      ".a { .b { color: blue } color: green !important; background: red }",
      ".a{& .b{color:#00f}background:red;color:green!important}",
      ".a .b{color:#00f}.a{background:red;color:green!important}",
    ],
    // A selector list is repeated as written, not wrapped in `:is()`, so each
    // selector keeps its own specificity.
    [
      ".a, .d { .b { color: blue } color: green }",
      ".a,.d{& .b{color:#00f}color:green}",
      ":is(.a,.d) .b{color:#00f}.a,.d{color:green}",
    ],
    // At every nesting level, resolved against the levels above.
    [
      ".a { .b { .c { color: blue } color: green } color: red }",
      ".a{& .b{& .c{color:#00f}color:green}color:red}",
      ".a .b .c{color:#00f}.a .b{color:green}.a{color:red}",
    ],
    [
      ".a { @nest .p & { .b { color: blue } color: red } color: green }",
      ".a{@nest .p &{& .b{color:#00f}color:red}color:green}",
      ".p .a .b{color:#00f}.p .a{color:red}.a{color:green}",
    ],
    // `div:hover {` is first tried as a declaration named `div`; that attempt
    // must not leave an empty rule behind.
    [
      ".a { .b { color: blue } div:hover { color: red } color: green }",
      ".a{& .b{color:#00f}& div:hover{color:red}color:green}",
      ".a .b{color:#00f}.a div:hover{color:red}.a{color:green}",
    ],
    // A following rule with the same selector is not merged across the nested rules.
    [
      ".a { .b { color: blue } color: green } .a { color: red }",
      ".a{& .b{color:#00f}color:green}.a{color:red}",
      ".a .b{color:#00f}.a{color:green}.a{color:red}",
    ],
    // The nested rule is removed as empty; the declarations still apply.
    [".a { .b {} color: green }", ".a{color:green}", ".a{color:green}"],
  ])("%s", (source, preserved, lowered) => {
    expect(minifyPreserved(source)).toBe(preserved);
    expect(minifyLowered(source)).toBe(lowered);
  });
});

describe("declarations directly inside a nested conditional rule", () => {
  test.each([
    [
      ".c { @media (min-width: 600px) { color: pink } color: black }",
      ".c{@media (width>=600px){color:pink}color:#000}",
      "@media (min-width:600px){.c{color:pink}}.c{color:#000}",
    ],
    [
      ".a { @supports (display: grid) { color: pink } color: black }",
      ".a{@supports (display: grid){color:pink}color:#000}",
      "@supports (display: grid){.a{color:pink}}.a{color:#000}",
    ],
    [
      ".a { @container (min-width: 100px) { color: pink } color: black }",
      ".a{@container (width>=100px){color:pink}color:#000}",
      "@container (width>=100px){.a{color:pink}}.a{color:#000}",
    ],
    // Declarations before and after a rule nested in the conditional.
    [
      ".a { @media (min-width: 100px) { color: red; .b { color: blue } color: green } }",
      ".a{@media (width>=100px){color:red;& .b{color:#00f}color:green}}",
      "@media (min-width:100px){.a{color:red}.a .b{color:#00f}.a{color:green}}",
    ],
    [
      ".a, .d { @media (min-width: 100px) { color: pink } }",
      ".a,.d{@media (width>=100px){color:pink}}",
      "@media (min-width:100px){.a,.d{color:pink}}",
    ],
  ])("%s", (source, preserved, lowered) => {
    expect(minifyPreserved(source)).toBe(preserved);
    expect(minifyLowered(source)).toBe(lowered);
  });
});

describe("trailing semicolon when nesting is preserved", () => {
  // `@media all` is dropped when minifying and its contents printed in place,
  // so the declarations at its end are not the last thing in the block.
  test.each([
    [".a { @media all { .b { color: green } color: red } color: blue }", ".a{& .b{color:green}color:red;color:#00f}"],
    [
      ".a { @media all { .b { color: green } color: red } .c { color: blue } }",
      ".a{& .b{color:green}color:red;& .c{color:#00f}}",
    ],
    [".a { @media all { .b { color: green } color: red } }", ".a{& .b{color:green}color:red}"],
  ])("%s", (source, expected) => {
    expect(minifyPreserved(source)).toBe(expected);
  });
});

describe("fallback rules generated for the declarations follow them", () => {
  test.each([
    [
      ".a { .b { color: blue } inset-inline-end: 20px; .c { color: red } }",
      ".a .b{color:#00f}.a:dir(ltr){right:20px}.a:dir(rtl){left:20px}.a .c{color:red}",
    ],
    [
      ".a, .d { .b { color: blue } inset-inline-end: 20px }",
      ":is(.a,.d) .b{color:#00f}:is(.a,.d):dir(ltr){right:20px}:is(.a,.d):dir(rtl){left:20px}",
    ],
    [
      ".a { .b { color: blue } color-scheme: light dark; .c { color: red } }",
      ".a .b{color:#00f}" +
        ".a{--buncss-light:initial;--buncss-dark: ;color-scheme:light dark}" +
        "@media (prefers-color-scheme:dark){.a{--buncss-light: ;--buncss-dark:initial}}" +
        ".a .c{color:red}",
    ],
    [
      ".a { @media (min-width: 100px) { inset-inline-end: 20px } }",
      "@media (min-width:100px){.a:dir(ltr){right:20px}.a:dir(rtl){left:20px}}",
    ],
    // The enclosing rule's own fallbacks go between its declarations and its
    // nested rules, which keep their order.
    [
      ".a { color: red; inset-inline-end: 1px; .b { color: blue } color: green }",
      ".a{color:red}.a:dir(ltr){right:1px}.a:dir(rtl){left:1px}.a .b{color:#00f}.a{color:green}",
    ],
  ])("%s", (source, expected) => {
    expect(minifyLowered(source, firefox60)).toBe(expected);
  });
});

test("printed once per vendor prefix pass of the enclosing rule", () => {
  // Safari 8 needs `:-webkit-full-screen`, so the rule is printed once per prefix.
  expect(minifyLowered(":fullscreen { div { color: red } color: green }", { safari: 8 << 16 })).toBe(
    ":-webkit-full-screen div{color:red}:-webkit-full-screen{color:green}:fullscreen div{color:red}:fullscreen{color:green}",
  );
});

const prettySource =
  "a { color: red; & { color: blue } color: green }\n" +
  ".c { @media (min-width: 600px) { color: pink; .d { color: white } color: gray; background: black } color: black }";

test("pretty printing with nesting preserved", () => {
  expect(_test(prettySource, "")).toBe(
    [
      "a {",
      "  color: red;",
      "",
      "  & {",
      "    color: #00f;",
      "  }",
      "",
      "  color: green;",
      "}",
      "",
      ".c {",
      "  @media (width >= 600px) {",
      "    color: pink;",
      "",
      "    & .d {",
      "      color: #fff;",
      "    }",
      "",
      "    color: gray;",
      "    background: #000;",
      "  }",
      "",
      "  color: #000;",
      "}",
      "",
    ].join("\n"),
  );
});

test("pretty printing with nesting compiled away", () => {
  expect(prefixTest(prettySource, "", chrome87)).toBe(
    [
      "a {",
      "  color: red;",
      "}",
      "",
      "a {",
      "  color: #00f;",
      "}",
      "",
      "a {",
      "  color: green;",
      "}",
      "",
      "@media (min-width: 600px) {",
      "  .c {",
      "    color: pink;",
      "  }",
      "",
      "  .c .d {",
      "    color: #fff;",
      "  }",
      "",
      "  .c {",
      "    color: gray;",
      "    background: #000;",
      "  }",
      "}",
      "",
      ".c {",
      "  color: #000;",
      "}",
      "",
    ].join("\n"),
  );
});

describe("bun build", () => {
  const source =
    "a { color: red; & { color: blue } color: green }\n.c { @media (min-width: 600px) { color: pink } color: black }\n";

  test.concurrent.each([
    ["browser", "a{color:red}a{color:#00f}a{color:green}@media (min-width:600px){.c{color:pink}}.c{color:#000}"],
    ["bun", "a{color:red;&{color:#00f}color:green}.c{@media (width>=600px){color:pink}color:#000}"],
  ])("--target=%s --minify", async (target, expected) => {
    using dir = tempDir("css-nested-declarations", { "in.css": source });
    // Without --outdir the bundled stylesheet is written to stdout.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "in.css", `--target=${target}`, "--minify"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected + "\n", stderr: "", exitCode: 0 });
  });
});
