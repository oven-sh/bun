import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// Regression test for unbounded memory growth when compiling CSS selectors
// for older browser targets (found by CSS fuzzing, crash signature
// `oom:css:…Write…write_all…|…css_parser…`).
//
// The selector-expansion limits added for earlier fuzz reports bound how many
// selectors compiling nesting away produces (MAX_SELECTOR_EXPANSION) and how
// many `&` substitutions the printer performs (MAX_NESTING_EXPANSIONS), but
// both counted units, not bytes. The size of each expanded selector is
// input-controlled (long identifiers, multi-argument `:lang()`, `::part()`),
// so a ~30 KB stylesheet could stay under both count limits while expanding
// to hundreds of MB of cloned rules and output (over 1 GB RSS in debug
// builds). The expansion is now also budgeted by estimated serialized bytes
// (MAX_SELECTOR_EXPANSION_BYTES on the minify side,
// MAX_NESTING_EXPANSION_BYTES on the printer side) and reports an error
// instead of materializing the blowup.

const CHROME_80 = { chrome: 80 << 16 };

/** Runs minifyTest and folds the outcome into a short string so a failing
 * assertion reports the output's size instead of printing 100+ MB of CSS. */
function minifyOutcome(css: string): string {
  try {
    return `output:${cssInternals.minifyTest(css, "", CHROME_80).length} bytes`;
  } catch (e) {
    return `error:${(e as Error).message}`;
  }
}

// The minimized fuzz input: multi-argument :lang() with an invalid
// declaration, compiled for a target without :lang(a, b) or :is() support.
// Its downlevel output is small and stays small; this locks that in.
test("multi-argument :lang() downlevel output stays small", () => {
  const input = "a:lang(en, fr) {\n        color: 0red;\n      }";

  expect(cssInternals.minifyTest(input, "", CHROME_80)).toBe(
    "a:-webkit-any(:lang(en),:lang(fr)){color:0red}a:is(:lang(en),:lang(fr)){color:0red}",
  );
  expect(cssInternals._test(input, "", CHROME_80)).toBe(
    "a:-webkit-any(:lang(en), :lang(fr)) {\n  color: 0red;\n}\n\na:is(:lang(en), :lang(fr)) {\n  color: 0red;\n}\n",
  );
  expect(cssInternals.prefixTest(input, "", CHROME_80)).toBe(
    "a:-webkit-any(:lang(en), :lang(fr)) {\n  color: 0red;\n}\n\na:is(:lang(en), :lang(fr)) {\n  color: 0red;\n}\n",
  );
  // No targets: nothing to downlevel.
  expect(cssInternals.minifyTest(input, "")).toBe("a:lang(en,fr){color:0red}");
});

/** Unclosed nested rules with two fat selectors per level: the selector count
 * stays under MAX_SELECTOR_EXPANSION (2^15 leaves), but each expanded
 * selector repeats its ancestor chain of `identLength`-byte identifiers. */
function fatNestedList(depth: number, identLength: number, selector: (ident: string, i: number) => string): string {
  const ident = Buffer.alloc(identLength, "x").toString();
  let css = "";
  for (let i = 0; i < depth; i++) {
    css += `${selector(ident + "a", i)}, ${selector(ident + "b", i)} {\n`;
  }
  css += "color: red;\n}";
  return css;
}

test("fat ::part() selectors under the expansion count cap error instead of expanding to hundreds of MB", () => {
  // 30 KB input; expanded to ~265 MB of output before the byte budget existed.
  const css = fatNestedList(15, 1000, (ident, i) => `.${ident}${i}::part(p)`);
  expect(minifyOutcome(css)).toMatch(/^error:.*bytes of selectors/);
  // Without targets the nesting is preserved, so the same input stays small.
  expect(cssInternals.minifyTest(css, "").length).toBeLessThan(2 * css.length);
});

test("fat multi-argument :lang() selectors under the expansion count cap error instead of expanding", () => {
  // ~5 KB input; expanded to ~120 MB of output before the byte budget existed.
  const langs = Array.from({ length: 8 }, (_, i) => "l" + i).join(", ");
  const css = fatNestedList(15, 250, (ident, i) => `.${ident}${i} :lang(${langs})`);
  expect(minifyOutcome(css)).toMatch(/^error:.*bytes of selectors/);
});

test("fat `&` parent-selector substitution errors instead of printing hundreds of MB", () => {
  // 13 KB input; 2^16 substitutions of an 800-byte parent printed ~107 MB
  // before the byte budget existed.
  const ident = Buffer.alloc(800, "y").toString();
  let css = "";
  for (let i = 0; i < 16; i++) {
    css += `&:is(.${ident}${i}, &.z${i}) {\n`;
  }
  css += "color: red;\n";
  css += "}\n".repeat(16);
  expect(minifyOutcome(css)).toMatch(/^error:Maximum nesting expansion exceeded/);
});

test("mid-size expansions below the byte budget still compile", () => {
  // 2^13 expanded selectors with short names stay well under the byte budget.
  let css = "";
  for (let i = 0; i < 13; i++) {
    css += "co :lang(en, fr), .bar :lang(fr, de) {\n";
  }
  css += "color: red;\n}";
  expect(minifyOutcome(css)).toMatch(/^output:\d{6,} bytes$/);
});

test("thin-selector deep nesting still reports the selector count limit", () => {
  let css = "";
  for (let i = 0; i < 23; i++) {
    css += "co :is(.bar), .bar :is(.baz) {\n";
  }
  css += "color: red;\n}";
  expect(minifyOutcome(css)).toMatch(/^error:.*65536 selectors/);
});

test("ordinary nesting compiled for old targets is unaffected", () => {
  expect(cssInternals.minifyTest("a { .x { color: red; } .y { color: blue; } }", "", CHROME_80)).toBe(
    "a .x{color:red}a .y{color:#00f}",
  );
});
