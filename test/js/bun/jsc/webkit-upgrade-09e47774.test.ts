import { describe, expect, test } from "bun:test";
import { withoutAggressiveGC } from "harness";

// Coverage for the WebKit 09e477744721 sync (oven-sh/WebKit#299, pinned by
// oven-sh/bun#37352), which fixes oven-sh/bun#37290. Yarr expands a v-mode
// class of strings into one alternative per string (a few thousand for
// \p{RGI_Emoji}) and used to try them one at a time, so every non-emoji input
// paid for the whole list. It now dispatches the group on the input's first
// code point, so a miss costs one dispatch. string-width runs /^\p{RGI_Emoji}$/v
// on every grapheme, which is how this regex came to dominate Ink TUIs.

// The issue's input: box drawing starts no emoji sequence, so every position
// below is a miss. The subject has to be 16-bit (anything outside Latin-1) for
// this to have been slow before the fix; on an 8-bit subject the old code
// already skipped the list when scanning unanchored.
const boxDrawing = "\u2500".repeat(4000);

const rgiEmoji = /\p{RGI_Emoji}/v;
const rgiEmojiInClass = /[\p{RGI_Emoji}]/v;
// A property of code points does the same work per position (one class check),
// so dividing by it cancels out machine speed and build type.
const codePointProperty = /\p{Extended_Pictographic}/u;

/** Best of five interleaved rounds of one `.test()` over `boxDrawing`, in milliseconds, per regex. */
function missMilliseconds(regexes: RegExp[]): number[] {
  for (const re of regexes) expect(re.test(boxDrawing)).toBe(false); // compiles the regex and flattens the subject
  const best = regexes.map(() => Infinity);
  for (let round = 0; round < 5; round++) {
    regexes.forEach((re, i) => {
      const start = performance.now();
      re.test(boxDrawing);
      best[i] = Math.min(best[i], performance.now() - start);
    });
  }
  return best;
}

describe("WebKit 09e477744721 upgrade", () => {
  test("a \\p{RGI_Emoji} miss does not walk every emoji sequence (#37290)", () => {
    withoutAggressiveGC(() => {
      const [control, bare, inClass] = missMilliseconds([codePointProperty, rgiEmoji, rgiEmojiInClass]);
      // Ratios measured on linux x64. Before oven-sh/WebKit#299: ~10,000x in
      // release, ~1,700x in debug. After: 1.3x to 1.5x in debug, 2.2x to 2.6x
      // in release (node 26: 3.1x). The fixed build run with
      // BUN_JSC_useRegExpAlternationDispatch=0, which turns the first code
      // point dispatch back off, measures ~570x in release and 115x to 210x in
      // debug, so 50 also catches a WebKit bump that loses only the dispatch.
      expect(bare / control).toBeLessThan(50);
      expect(inClass / control).toBeLessThan(50);
    });
  });

  test("the dispatched class still matches whole sequences, longest first", () => {
    // Guards the test above against a class that got fast by matching less.
    // The first code point of the first three sequences is an RGI emoji by
    // itself (thumbs up, man, black flag), so each match also has to be the
    // longest alternative rather than the first one that fits.
    const sequences = [
      "\u{1F44D}\u{1F3FD}", // thumbs up + medium skin tone
      "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", // family: man, woman, girl
      "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", // flag: England
      "\u{1F1EB}\u{1F1F7}", // flag: France
      "#\uFE0F\u20E3", // keycap: #
    ];
    const notEmoji = ["#", "\u{1F1EB}"]; // a keycap base and a regional indicator on their own
    for (const re of [rgiEmoji, rgiEmojiInClass]) {
      expect([...sequences, ...notEmoji].map(text => re.exec(`\u2500${text}\u2500`)?.[0] ?? null)).toEqual([
        ...sequences,
        null,
        null,
      ]);
    }
  });
});
