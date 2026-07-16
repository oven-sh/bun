// Pinned regression cases: every real divergence the differential engine has
// found, with the SPEC-correct expected result recorded. Each entry runs in
// both engines; `expected` is what a correct engine produces. Entries under
// `knownBunFailures` document current bun/JSC bugs (asserted separately so a
// fix shows up as an unexpected pass to be moved into `cases`).
//
// Add every future regex bug here with the smallest reproducer.

// A case is { name, source, flags, input, op, expected } where op is one of
// "exec" | "match" | "split" | "iterate" | "construct" and expected is the
// JSON-serializable normalized result (see normalize() in regressions.test.ts /
// run-regressions-under-node.mjs).

export const cases = [
  // -- Leftmost alternative wins even when a later alternative is longer.
  {
    name: "leftmost-alt-wins",
    source: "a|ab",
    flags: "",
    input: "xabc",
    op: "exec",
    expected: { match: ["a"], index: 1 },
  },
  {
    name: "leftmost-alt-wins-anchor",
    source: "a|ab|^x",
    flags: "",
    input: "xabc",
    op: "exec",
    expected: { match: ["x"], index: 0 },
  },

  // -- Optional groups after \B (control cases without ^ pass on all engines).
  {
    name: "nonword-boundary-optional-group",
    source: "\\B(?:x)??",
    flags: "",
    input: "xx",
    op: "exec",
    expected: { match: [""], index: 1 },
  },
  {
    name: "nonword-boundary-lazy-x",
    source: "\\Bx??",
    flags: "",
    input: "xx",
    op: "exec",
    expected: { match: [""], index: 1 },
  },

  // -- Empty-iteration capture clearing (spec RepeatMatcher); the .*{0,2}\\1
  //    variant is fixed in newer JSC but not stock bun -- see knownBunFailures.
  {
    name: "quantified-group-capture-last-iteration",
    source: "(?:(a)|b){2}",
    flags: "",
    input: "ab",
    op: "exec",
    expected: { match: ["ab", null], index: 0 },
  },
  {
    name: "quantified-group-capture-both",
    source: "(?:(a)|(b)){2}",
    flags: "",
    input: "ab",
    op: "exec",
    expected: { match: ["ab", null, "b"], index: 0 },
  },

  // -- Lookbehind basics (bun issue #5197 area).
  {
    name: "lookbehind-price",
    source: "(?<=\\$)\\d+(?:\\.\\d\\d)?",
    flags: "",
    input: "cost: $19.99 ok",
    op: "exec",
    expected: { match: ["19.99"], index: 7 },
  },
  {
    name: "neg-lookbehind",
    source: "(?<!not )\\bgood\\b",
    flags: "",
    input: "it is good",
    op: "exec",
    expected: { match: ["good"], index: 6 },
  },
  {
    name: "neg-lookbehind-blocks",
    source: "(?<!not )\\bgood\\b",
    flags: "",
    input: "not good",
    op: "exec",
    expected: null,
  },
  {
    name: "lookbehind-capture-backward",
    source: "(?<=(\\d)(\\d))x",
    flags: "",
    input: "12x",
    op: "exec",
    expected: { match: ["x", "1", "2"], index: 2 },
  },
  {
    name: "lookbehind-alt-and-boundary",
    source: "(?<=^|\\s)word\\b",
    flags: "g",
    input: "word words a word",
    op: "iterate",
    expected: [
      { match: ["word"], index: 0, lastIndex: 4 },
      { match: ["word"], index: 13, lastIndex: 17 },
    ],
  },

  // -- Large alternations (dispatch/factoring territory) must keep leftmost-wins order.
  {
    name: "big-alternation-order",
    source: "abcd|abc|ab|a",
    flags: "",
    input: "abcx",
    op: "exec",
    expected: { match: ["abc"], index: 0 },
  },
  {
    name: "big-alternation-shared-prefix-capture",
    source: "a(1)|a(2)|a(3)|q",
    flags: "",
    input: "a2",
    op: "exec",
    expected: { match: ["a2", null, "2", null], index: 0 },
  },
  {
    name: "alternation-backtrack-into-earlier",
    source: "(?:ab|abc|abcd)d",
    flags: "",
    input: "abcdd",
    op: "exec",
    expected: { match: ["abcd"], index: 0 },
  },
  {
    name: "anchored-stringlist",
    source: "^(?:GET|POST|PUT|SEND)",
    flags: "",
    input: "Pzz",
    op: "exec",
    expected: null,
  },
  {
    name: "anchored-stringlist-hit",
    source: "^(?:GET|POST|PUT|SEND)",
    flags: "",
    input: "POST x",
    op: "exec",
    expected: { match: ["POST"], index: 0 },
  },

  // -- Unicode / surrogate handling.
  {
    name: "u-flag-astral-dot",
    source: ".",
    flags: "u",
    input: "😀a",
    op: "exec",
    expected: { match: ["😀"], index: 0 },
  },
  {
    name: "v-flag-astral-dot",
    source: ".",
    flags: "v",
    input: "😀a",
    op: "exec",
    expected: { match: ["😀"], index: 0 },
  },
  { name: "split-empty-v", source: "(?:)", flags: "v", input: "a😀", op: "split", expected: ["a", "😀"] },
  {
    name: "ignorecase-astral",
    source: "\\u{1F600}",
    flags: "iu",
    input: "x😀",
    op: "exec",
    expected: { match: ["😀"], index: 1 },
  },

  // -- Sticky / global lastIndex semantics.
  { name: "sticky-fail-resets", source: "a", flags: "y", input: "ba", op: "exec", expected: null },
  {
    name: "global-empty-advances",
    source: "x*",
    flags: "g",
    input: "abc",
    op: "iterate",
    expected: [{ match: [""], index: 0, lastIndex: 0 }],
  },

  // -- Named groups & backreferences.
  {
    name: "named-backref",
    source: "(?<t>\\w)\\k<t>",
    flags: "",
    input: "abccd",
    op: "exec",
    expected: { match: ["cc", "c"], index: 2, groups: { t: "c" } },
  },
  {
    name: "backref-unmatched-optional",
    source: "(x)?\\1y",
    flags: "",
    input: "y",
    op: "exec",
    expected: { match: ["y", null], index: 0 },
  },
];

// Documented current bun/JSC failures with their spec-correct expectation.
// The test asserts these still FAIL (with the current wrong result), so that
// an engine fix produces an unexpected pass and the case gets promoted above.
export const knownBunFailures = [
  // JIT-only; live on WebKit main: an optional group whose only content is ^ misfires the zero-length-match handling. Interpreter is correct.
  {"name": "jit-optional-group-containing-only-BOL", "source": "(?:^)?a", "flags": "", "input": "ba", "op": "exec", "expected": {"match": ["a"], "index": 1}, "currentBun": null},
  // Same family as above with * quantifier.
  {"name": "jit-star-group-containing-only-BOL", "source": "(?:^)*a", "flags": "", "input": "ba", "op": "exec", "expected": {"match": ["a"], "index": 1}, "currentBun": null},
  // JIT-only; live on WebKit main: an alternative starting with an astral literal is lost when a sibling alternative starts with a broad/inverted class. Interpreter is correct.
  {"name": "jit-u-mode-astral-alternative-with-inverted-class-sibling", "source": "😀|\\P{L}y", "flags": "u", "input": "z 😀0 q", "op": "exec", "expected": {"match": ["😀"], "index": 2}, "currentBun": null},
  // Same family (dot sibling).
  {"name": "jit-u-mode-astral-alternative-with-dot-sibling", "source": "😀.|.y", "flags": "u", "input": "z 😀0 q", "op": "exec", "expected": {"match": ["😀0"], "index": 2}, "currentBun": null},
  // Same family; JIT returns the LATER alternative's match instead of the leftmost.
  {"name": "jit-u-mode-astral-alternative-wrong-alternative", "source": "😀.|\\P{L}q", "flags": "u", "input": "z 😀0 q", "op": "exec", "expected": {"match": ["😀0"], "index": 2}, "currentBun": {"match": [" q"], "index": 5}},
  // Fixed on WebKit main; stock bun matches the whole input and reports a wrapped-around lastIndex (2^64). Not reduced further.
  {"name": "match-end-wraparound-lastindex", "source": "(?:[\\w\\sa-fa-f]\\S{0}\\s{1,3}|((?:\\1)[^\\s])?d+)(?:\\1)?|(.\\0{2,}||(?:\\d(?=)|.(?=.{1,3}?||\\t?8*é|-:)){2})\\t|", "flags": "gd", "input": "prefix _  suffix", "op": "iterate", "expected": [{"match": ["", null, null], "index": 0, "lastIndex": 0}], "currentBun": [{"match": ["prefix _  suffix", null, null], "index": 0, "lastIndex": 18446744073709552000}]},
  // split-facing manifestation of the optional-BOL-group family.
  {"name": "split-optional-named-BOL-group", "source": "(?<b>^)?[x\\-\\w]", "flags": "i", "input": "prefix 9 suffix", "op": "split", "expected": ["", null, "", null, "", null, "", null, "", null, "", null, " ", null, " ", null, "", null, "", null, "", null, "", null, "", null, ""], "currentBun": ["", null, "", null, "", null, "", null, "", null, "", null, " 9 suffix"]},
  {
    // Fixed in WebKit main; wrong in bun's currently-pinned JSC (JIT tier):
    // a `+`-repeated alternation whose first alternative is a bounded
    // quantified class followed by \b, and whose second alternative holds a
    // capturing group under a counted quantifier, spuriously fails.
    name: "plus-loop-quantified-class-boundary-with-counted-capture",
    source: "(?:\\D{0,2}\\b|(.){2,})+f",
    flags: "i",
    input: "f-",
    op: "exec",
    expected: { match: ["f", null], index: 0 },
    currentBun: null,
  },
  {
    // Fixed in WebKit main; still present in bun's currently-pinned JSC.
    name: "empty-iteration-clears-capture",
    source: "(.*){0,2}\\1",
    flags: "",
    input: "ab",
    op: "exec",
    expected: { match: ["", null], index: 0 },
    currentBun: { match: ["", ""], index: 0 },
  },
  {
    name: "jit-nonword-boundary-optional-BOL-group",
    source: "\\B(?:^)?",
    flags: "",
    input: "xx",
    op: "exec",
    expected: { match: [""], index: 1 },
    currentBun: null,
  },
  {
    name: "jit-nonword-boundary-lazy-BOL-group",
    source: "\\B(?:^x)??",
    flags: "",
    input: "xx",
    op: "exec",
    expected: { match: [""], index: 1 },
    currentBun: null,
  },
  {
    name: "interp-leftmost-alt-with-caret-alternative",
    source: "a|ab|^a",
    flags: "",
    input: "xabc",
    op: "exec",
    expected: { match: ["a"], index: 1 },
    currentBun: { match: ["ab"], index: 1 },
    // Only wrong on the bytecode interpreter path (JIT is correct), so it may
    // pass depending on tiering; recorded but not asserted-failing.
    tierDependent: true,
  },
  {
    name: "v-mode-lookbehind-code-point-step",
    source: "(?<=.)",
    flags: "v",
    input: "😀😀",
    op: "exec",
    expected: { match: [""], index: 2 },
    currentBun: { match: [""], index: 1 },
  },
  {
    name: "v-mode-fold-before-subtract",
    source: "Foo(B[\\q{ĀĂĄ|AaA}--\\q{āăą}])r",
    flags: "vi",
    input: "FooBĀĂĄr",
    op: "exec",
    expected: null,
    currentBun: { match: ["FooBĀĂĄr", "BĀĂĄ"], index: 0 },
  },
];
