import { describe, expect, test } from "bun:test";

// Coverage for the WebKit 887d61174f34 sync (oven-sh/WebKit#401), the Yarr
// first-character prefilter for class-set string disjunctions
// (oven-sh/bun#37290). A v-mode class set with strings (\p{RGI_Emoji} has
// ~3700) expands into one alternative per string, and before the prefilter a
// failing match attempt walked all of them, making string-width (and Ink TUIs)
// unusable on non-ASCII output.

/** Average cost of one re.test(s) in microseconds, sampled within a budget. */
function perCallMicros(re: RegExp, inputs: string[], budgetMs: number): number {
  for (const s of inputs) re.test(s); // warmup: compile + tier-up
  let calls = 0;
  let elapsed = 0;
  const start = performance.now();
  do {
    for (const s of inputs) re.test(s);
    calls += inputs.length;
    elapsed = performance.now() - start;
  } while (elapsed < budgetMs && calls < 200_000);
  return (elapsed * 1000) / calls;
}

describe.concurrent("WebKit 887d61174f34 upgrade", () => {
  test("failing \\p{RGI_Emoji} match is prefiltered, not a walk of ~3700 alternatives", () => {
    // 156 distinct single-character non-emoji strings (a TUI line of box
    // drawing, the string-width worst case from the issue). Before the
    // prefilter each .test() walked every expanded string alternative:
    // ~1170x the cost of the \p{Extended_Pictographic} control on the same
    // input (release; the interpreter-only gap is ~130x). With the prefilter
    // both are a single character-class check, ratio ~2x. The threshold sits
    // well above fixed-build noise and well below every unfixed measurement.
    const chars = [..."\u2500".repeat(156)];
    const rgi = perCallMicros(/^\p{RGI_Emoji}$/v, chars, 250);
    const control = perCallMicros(/^\p{Extended_Pictographic}$/u, chars, 250);
    expect(rgi / control).toBeLessThan(30);
  });

  test("\\p{RGI_Emoji} matching semantics survive the prefilter", () => {
    const rgi = /^\p{RGI_Emoji}$/v;
    const table: [string, boolean][] = [
      ["\u2500", false], // box drawing
      ["a", false],
      ["#", false], // keycap base alone is not RGI
      ["", false],
      ["😀", true], // single code point
      ["👍", true], // base emoji (also starts modifier sequences)
      ["👍🏽", true], // modifier sequence
      ["🇺🇸", true], // flag sequence
      ["#️⃣", true], // keycap sequence
      ["👨‍👩‍👧‍👦", true], // ZWJ sequence
      ["🏴󠁧󠁢󠁥󠁮󠁧󠁿", true], // tag sequence
      ["👍🏽👍", false], // two clusters, anchored
    ];
    expect(table.map(([s]) => rgi.test(s))).toEqual(table.map(([, want]) => want));

    // Longest-alternative-first order is observable through captures.
    expect(/(\p{RGI_Emoji})/v.exec("👍🏽")?.[1]).toBe("👍🏽");
    expect(/(\p{RGI_Emoji})/v.exec("👨‍👩‍👧‍👦")?.[1]).toBe("👨‍👩‍👧‍👦");
    // Unanchored, global, sticky, quantified.
    expect("x👍🏽y🇫🇷z".match(/\p{RGI_Emoji}/gv)).toEqual(["👍🏽", "🇫🇷"]);
    expect(/^\p{RGI_Emoji}+$/v.test("👍🏽🇫🇷😀")).toBe(true);
    const sticky = /\p{RGI_Emoji}/vy;
    sticky.lastIndex = 3;
    expect(sticky.exec("abc👍🏽d")?.[0]).toBe("👍🏽");
    // In-bracket property and set subtraction still expand correctly.
    expect(/^[\p{RGI_Emoji}]$/v.test("👍🏽")).toBe(true);
    expect(/^[\p{RGI_Emoji}]$/v.test("\u2500")).toBe(false);
    expect(/^[\p{RGI_Emoji}--\q{😀}]$/v.test("😀")).toBe(false);
    expect(/^[\p{RGI_Emoji}--\q{😀}]$/v.test("😁")).toBe(true);
    // Backward matching (lookbehind) skips the prefilter and still works.
    expect(/(?<=\p{RGI_Emoji})x/v.test("👍🏽x")).toBe(true);
    expect(/(?<=\p{RGI_Emoji})x/v.test("ax")).toBe(false);
  });

  test("\\q{} string disjunctions above and below the prefilter threshold", () => {
    // 40 strings: above the 16-string threshold, so the prefilter applies.
    const large = new RegExp(`^[\\q{${Array.from({ length: 40 }, (_, i) => `s${i}x`).join("|")}}]$`, "v");
    expect(["s7x", "s39x", "t7x", "q"].map(s => large.test(s))).toEqual([true, true, false, false]);
    // Case-insensitive: the prefilter's first-character class must case-fold.
    const insensitive = new RegExp(`^[\\q{${Array.from({ length: 20 }, (_, i) => `word${i}`).join("|")}}]$`, "vi");
    expect(["WORD7", "word19", "word20"].map(s => insensitive.test(s))).toEqual([true, true, false]);
    // An empty string in the set matches without consuming input; the
    // prefilter must not apply (nothing to filter on).
    expect(/^[\q{ab|}]$/v.test("")).toBe(true);
    expect(/^[\q{ab|}]$/v.test("ab")).toBe(true);
    // Below the threshold: unchanged expansion.
    expect(/^[\q{abc|de|f}]$/v.test("abc")).toBe(true);
    expect(/^[\q{abc|de|f}]$/v.test("ab")).toBe(false);
  });

  test("other properties of strings", () => {
    expect(/^\p{Basic_Emoji}$/v.test("☂️")).toBe(true);
    expect(/^\p{Emoji_Keycap_Sequence}$/v.test("#️⃣")).toBe(true);
    expect(/^\p{Emoji_Keycap_Sequence}$/v.test("#")).toBe(false);
    expect(/^\p{RGI_Emoji_Modifier_Sequence}$/v.test("👍🏽")).toBe(true);
    expect(/^\p{RGI_Emoji_Modifier_Sequence}$/v.test("👍")).toBe(false);
    expect(/^\p{RGI_Emoji_ZWJ_Sequence}$/v.test("👨‍👩‍👧‍👦")).toBe(true);
    expect(/^\p{RGI_Emoji_Flag_Sequence}$/v.test("🇺🇸")).toBe(true);
    expect(/^\p{RGI_Emoji_Tag_Sequence}$/v.test("🏴󠁧󠁢󠁥󠁮󠁧󠁿")).toBe(true);
  });
});
