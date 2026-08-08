// V8 regexp fix-history corpus: 323 concrete cases extracted from the V8
// project's git history (bug-fix commits and the regression tests they added),
// each traced to its originating commit and test file. Expectations were
// executed against node 22 (V8 12.4); cases whose fix postdates node 22 carry
// requiresNewerV8 + node22Result. Source: assertions from V8's mjsunit tests
// (BSD-3-Clause), re-encoded as data; see test/js/third_party/v8-regexp/LICENSE.v8.
// Strings are ASCII-escaped so lone surrogates survive as \uXXXX literals.
//
// Consumed by ../regex-v8-history.test.ts via v8-history-eval.mjs.
export const v8HistoryCases = [
 {
  "name": "ci-micro-sign-matches-capital-mu",
  "source": "\\u00b5",
  "flags": "i",
  "input": "\u039c",
  "op": "test",
  "expected": true,
  "v8Commit": "3fab9d05cf34",
  "v8CommitSubject": "[regexp] Fix and unify non-unicode case-folding algorithms",
  "v8Test": "test/intl/regress-10248.js"
 },
 {
  "name": "ci-micro-sign-matches-mu",
  "source": "\\u00b5",
  "flags": "i",
  "input": "\u03bc",
  "op": "test",
  "expected": true,
  "v8Commit": "3fab9d05cf34",
  "v8CommitSubject": "[regexp] Fix and unify non-unicode case-folding algorithms",
  "v8Test": "test/intl/regress-10248.js"
 },
 {
  "name": "ci-omega-does-not-match-ohm-sign-nonunicode",
  "source": "\\u03a9",
  "flags": "i",
  "input": "\u2126",
  "op": "test",
  "expected": false,
  "v8Commit": "3fab9d05cf34",
  "v8CommitSubject": "[regexp] Fix and unify non-unicode case-folding algorithms",
  "v8Test": "test/intl/regress-10248.js"
 },
 {
  "name": "ci-sharp-s-does-not-match-capital-sharp-s",
  "source": "\\u00df",
  "flags": "i",
  "input": "\u1e9e",
  "op": "test",
  "expected": false,
  "v8Commit": "3fab9d05cf34",
  "v8CommitSubject": "[regexp] Fix and unify non-unicode case-folding algorithms",
  "v8Test": "test/intl/regress-10248.js",
  "note": "toUpperCase(\"\u00df\") is \"SS\" (length>1), so \u00df canonicalizes to itself"
 },
 {
  "name": "ciu-omega-matches-ohm-sign-unicode",
  "source": "\\u03a9",
  "flags": "iu",
  "input": "\u2126",
  "op": "test",
  "expected": true,
  "v8Commit": "3fab9d05cf34",
  "v8CommitSubject": "[regexp] Fix and unify non-unicode case-folding algorithms",
  "v8Test": "test/intl/regress-10248.js",
  "note": "contrast: /u uses simple case folding, where U+2126 folds to omega"
 },
 {
  "name": "ci-backref-K-vs-kelvin-nonunicode",
  "source": "(.)\\1",
  "flags": "i",
  "input": "K\u212a",
  "op": "test",
  "expected": false,
  "v8Commit": "b65fcfe92566",
  "v8CommitSubject": "[regexp] Fix non-unicode ignore-case backreferences",
  "v8Test": "test/intl/regress-10573.js"
 },
 {
  "name": "ci-backref-micro-vs-capital-mu",
  "source": "(.)\\1",
  "flags": "i",
  "input": "\u00b5\u039c",
  "op": "test",
  "expected": true,
  "v8Commit": "b65fcfe92566",
  "v8CommitSubject": "[regexp] Fix non-unicode ignore-case backreferences",
  "v8Test": "test/intl/regress-10573.js"
 },
 {
  "name": "ciu-backref-K-vs-kelvin-unicode",
  "source": "(.)\\1",
  "flags": "iu",
  "input": "K\u212a",
  "op": "test",
  "expected": true,
  "v8Commit": "b65fcfe92566",
  "v8CommitSubject": "[regexp] Fix non-unicode ignore-case backreferences",
  "v8Test": "test/intl/regress-10573.js"
 },
 {
  "name": "ci-long-s-does-not-match-S",
  "source": "\\u017f",
  "flags": "i",
  "input": "S",
  "op": "test",
  "expected": false,
  "v8Commit": "a0133350bf99",
  "v8CommitSubject": "[Intl] Fix /\u017f/i.test('\u017f'.toUpperCase()) be false.",
  "v8Test": "test/intl/regress-9356.js"
 },
 {
  "name": "ci-long-s-matches-itself",
  "source": "\\u017f",
  "flags": "i",
  "input": "\u017f",
  "op": "test",
  "expected": true,
  "v8Commit": "a0133350bf99",
  "v8CommitSubject": "[Intl] Fix /\u017f/i.test('\u017f'.toUpperCase()) be false.",
  "v8Test": "test/intl/regress-9356.js"
 },
 {
  "name": "ci-latin1-range-does-not-match-s",
  "source": "[\\u00a0-\\u0180]",
  "flags": "i",
  "input": "s",
  "op": "match",
  "expected": null,
  "v8Commit": "1945392a4e93",
  "v8CommitSubject": "[Intl] Fix RegExp [\\W] with i flag",
  "v8Test": "test/intl/regress-971636.js"
 },
 {
  "name": "ci-nonword-class-does-not-match-S",
  "source": "[\\W_]",
  "flags": "gi",
  "input": "RST",
  "op": "replace",
  "expected": {
   "replacement": "",
   "result": "RST"
  },
  "v8Commit": "1945392a4e93",
  "v8CommitSubject": "[Intl] Fix RegExp [\\W] with i flag",
  "v8Test": "test/intl/regress-971636.js",
  "replacement": ""
 },
 {
  "name": "ci-kelvin-sign-does-not-match-k",
  "source": "k",
  "flags": "i",
  "input": "\u212a",
  "op": "test",
  "expected": false,
  "v8Commit": "7dedd92998f8",
  "v8CommitSubject": "[Intl] Fix /k/i.test('\\u212A')",
  "v8Test": "test/intl/regress-9731.js"
 },
 {
  "name": "ci-kelvin-sign-matches-itself",
  "source": "\\u212a",
  "flags": "i",
  "input": "\u212a",
  "op": "test",
  "expected": true,
  "v8Commit": "7dedd92998f8",
  "v8CommitSubject": "[Intl] Fix /k/i.test('\\u212A')",
  "v8Test": "test/intl/regress-9731.js"
 },
 {
  "name": "ci-kelvin-sign-pattern-does-not-match-K",
  "source": "\\u212a",
  "flags": "i",
  "input": "K",
  "op": "test",
  "expected": false,
  "v8Commit": "7dedd92998f8",
  "v8CommitSubject": "[Intl] Fix /k/i.test('\\u212A')",
  "v8Test": "test/intl/regress-9731.js"
 },
 {
  "name": "ci-cyrillic-uppercase-range-matches-lowercase",
  "source": "[\\u0410-\\u042f]",
  "flags": "i",
  "input": "\u0447",
  "op": "test",
  "expected": true,
  "v8Commit": "57c919e414ef",
  "v8CommitSubject": "Fix bug 486, Cyrillic character ranges in case independent regexps. http://code.google.com/p/v8/issues/detail?id=486 Review URL: http://codereview.chromium.org/361033",
  "v8Test": "test/mjsunit/cyrillic.js"
 },
 {
  "name": "ci-final-sigma-atom-vs-capital",
  "source": "\\u03c2",
  "flags": "i",
  "input": "\u03a3",
  "op": "test",
  "expected": true,
  "v8Commit": "57c919e414ef",
  "v8CommitSubject": "Fix bug 486, Cyrillic character ranges in case independent regexps. http://code.google.com/p/v8/issues/detail?id=486 Review URL: http://codereview.chromium.org/361033",
  "v8Test": "test/mjsunit/cyrillic.js"
 },
 {
  "name": "ci-final-sigma-in-class",
  "source": "[\\u03a3]",
  "flags": "i",
  "input": "\u03c2",
  "op": "test",
  "expected": true,
  "v8Commit": "57c919e414ef",
  "v8CommitSubject": "Fix bug 486, Cyrillic character ranges in case independent regexps. http://code.google.com/p/v8/issues/detail?id=486 Review URL: http://codereview.chromium.org/361033",
  "v8Test": "test/mjsunit/cyrillic.js",
  "note": "historically failed in JSC and Tracemonkey"
 },
 {
  "name": "ci-greek-cyrillic-mixed-range",
  "source": "[\\u03b1-\\u042f]",
  "flags": "i",
  "input": "\u0391",
  "op": "test",
  "expected": true,
  "v8Commit": "57c919e414ef",
  "v8CommitSubject": "Fix bug 486, Cyrillic character ranges in case independent regexps. http://code.google.com/p/v8/issues/detail?id=486 Review URL: http://codereview.chromium.org/361033",
  "v8Test": "test/mjsunit/cyrillic.js"
 },
 {
  "name": "cs-cyrillic-uppercase-range-excludes-lowercase",
  "source": "[\\u0410-\\u042f]",
  "flags": "",
  "input": "\u0447",
  "op": "test",
  "expected": false,
  "v8Commit": "57c919e414ef",
  "v8CommitSubject": "Fix bug 486, Cyrillic character ranges in case independent regexps. http://code.google.com/p/v8/issues/detail?id=486 Review URL: http://codereview.chromium.org/361033",
  "v8Test": "test/mjsunit/cyrillic.js"
 },
 {
  "name": "sticky-anchored-at-end-does-not-search",
  "source": "bar$",
  "flags": "y",
  "input": "foobar",
  "op": "test",
  "expected": false,
  "v8Commit": "29745ee927bf",
  "v8CommitSubject": "[regexp] Fix matching of regexps that are both sticky and anchored at end.",
  "v8Test": "test/mjsunit/es6/regexp-sticky.js"
 },
 {
  "name": "ciu-astral-case-fold-old-hungarian",
  "source": "\\u{10c80}",
  "flags": "iu",
  "input": "\ud803\udcc0",
  "op": "test",
  "expected": true,
  "v8Commit": "fcf8d2aa8500",
  "v8CommitSubject": "[regexp] Improvements to Unicode case independent.",
  "v8Test": "test/mjsunit/es6/unicode-regexp-ignore-case.js"
 },
 {
  "name": "cu-astral-no-fold-without-i",
  "source": "\\u{10c80}",
  "flags": "u",
  "input": "\ud803\udcc0",
  "op": "test",
  "expected": false,
  "v8Commit": "fcf8d2aa8500",
  "v8CommitSubject": "[regexp] Improvements to Unicode case independent.",
  "v8Test": "test/mjsunit/es6/unicode-regexp-ignore-case.js"
 },
 {
  "name": "ci-lazy-then-boundary-long-s-nonunicode",
  "source": "a.*?(.)\\b",
  "flags": "i",
  "input": "abcd\u017f cd",
  "op": "exec",
  "expected": {
   "match": [
    "abcd",
    "d"
   ],
   "index": 0
  },
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js"
 },
 {
  "name": "ci-nonword-matches-long-s-without-u",
  "source": "\\W",
  "flags": "i",
  "input": "\u017f",
  "op": "test",
  "expected": true,
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js",
  "note": "derived contrast: without /u the ignore-case word set does not include U+017F"
 },
 {
  "name": "ciu-boundary-with-long-s",
  "source": "\\b",
  "flags": "iu",
  "input": "\u017f",
  "op": "test",
  "expected": true,
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js"
 },
 {
  "name": "ciu-lazy-then-boundary-long-s",
  "source": "a.*?(.)\\b",
  "flags": "iu",
  "input": "abcd\u017f cd",
  "op": "exec",
  "expected": {
   "match": [
    "abcd\u017f",
    "\u017f"
   ],
   "index": 0
  },
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js"
 },
 {
  "name": "ciu-nonboundary-before-long-s",
  "source": "a.*?\\B(.)",
  "flags": "iu",
  "input": "a\u017f ",
  "op": "exec",
  "expected": {
   "match": [
    "a\u017f",
    "\u017f"
   ],
   "index": 0
  },
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js"
 },
 {
  "name": "ciu-nonword-does-not-match-S",
  "source": "\\W",
  "flags": "iu",
  "input": "S",
  "op": "test",
  "expected": false,
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js"
 },
 {
  "name": "ciu-nonword-does-not-match-kelvin",
  "source": "\\W",
  "flags": "iu",
  "input": "\u212a",
  "op": "test",
  "expected": false,
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js"
 },
 {
  "name": "ciu-word-matches-long-s",
  "source": "\\w",
  "flags": "iu",
  "input": "\u017f",
  "op": "test",
  "expected": true,
  "v8Commit": "a813525a0752",
  "v8CommitSubject": "[regexp] fix /\\W/ui wrt \\u017f and \\u212a.",
  "v8Test": "test/mjsunit/es7/regexp-ui-word.js"
 },
 {
  "name": "lookbehind-alternation-with-captures",
  "source": "(?<=([ab]{1,2})\\D|(abc))\\w",
  "flags": "",
  "input": "abcdef",
  "op": "exec",
  "expected": {
   "match": [
    "c",
    "a",
    null
   ],
   "index": 2
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-alternatives-first-fitting",
  "source": ".*(?<=(xx|...))(.*)",
  "flags": "",
  "input": "xxabcd",
  "op": "exec",
  "expected": {
   "match": [
    "xxabcd",
    "bcd",
    ""
   ],
   "index": 0
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-alternatives-left-to-right",
  "source": ".*(?<=(..|...|....))(.*)",
  "flags": "",
  "input": "xabcd",
  "op": "exec",
  "expected": {
   "match": [
    "xabcd",
    "cd",
    ""
   ],
   "index": 0
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-backref-after-capture",
  "source": "(?<=(\\w+)\\1)c",
  "flags": "",
  "input": "ababc",
  "op": "exec",
  "expected": {
   "match": [
    "c",
    "abab"
   ],
   "index": 4
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-fixed-length",
  "source": "(?<=a[a-z]{2})\\w\\w\\w",
  "flags": "",
  "input": "abcdef",
  "op": "exec",
  "expected": {
   "match": [
    "def"
   ],
   "index": 3
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-forward-backref-greedy-capture",
  "source": "(?<=\\1(\\w+))c",
  "flags": "",
  "input": "ababc",
  "op": "exec",
  "expected": {
   "match": [
    "c",
    "ab"
   ],
   "index": 4
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-forward-backref-ignore-case",
  "source": "(?<=\\1(\\w))d",
  "flags": "i",
  "input": "abcCd",
  "op": "exec",
  "expected": {
   "match": [
    "d",
    "C"
   ],
   "index": 4
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-forward-backref-no-match",
  "source": "(?<=\\1(\\w+))c",
  "flags": "",
  "input": "ababdc",
  "op": "exec",
  "expected": null,
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-greedy-loop-capture",
  "source": "(?<=(b+))c",
  "flags": "",
  "input": "abbbbbbc",
  "op": "exec",
  "expected": {
   "match": [
    "c",
    "bbbbbb"
   ],
   "index": 7
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-quantified-capture-leftmost",
  "source": "(?<=(\\w){3})def",
  "flags": "",
  "input": "abcdef",
  "op": "exec",
  "expected": {
   "match": [
    "def",
    "a"
   ],
   "index": 3
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js",
  "note": "lookbehind matches right-to-left, so the last capture is the leftmost character"
 },
 {
  "name": "lookbehind-variable-length",
  "source": "(?<=\\w*)[^a|b|c]{3}",
  "flags": "",
  "input": "abcdef",
  "op": "exec",
  "expected": {
   "match": [
    "def"
   ],
   "index": 3
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "negative-lookbehind-never-captures",
  "source": "(?<!(^|[ab]))\\w{2}",
  "flags": "",
  "input": "abcdef",
  "op": "exec",
  "expected": {
   "match": [
    "de",
    null
   ],
   "index": 3
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "nested-lookarounds-inside-lookbehind",
  "source": "(?<=a(?=([bc]{2}(?<!a{2}))d)\\w{3})\\w\\w",
  "flags": "",
  "input": "abcdef",
  "op": "exec",
  "expected": {
   "match": [
    "ef",
    "bc"
   ],
   "index": 4
  },
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "nested-lookarounds-inside-lookbehind-fail",
  "source": "(?<=a(?=([bc]{2}(?<!a*))d)\\w{3})\\w\\w",
  "flags": "",
  "input": "abcdef",
  "op": "exec",
  "expected": null,
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "no-backtracking-into-lookbehind",
  "source": "(?<=([abc]+)).\\1",
  "flags": "",
  "input": "abcdbc",
  "op": "exec",
  "expected": null,
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/es9/regexp-lookbehind.js"
 },
 {
  "name": "dup-named-groups-backref-in-loop",
  "source": "(?:(?:(?<a>x)|(?<a>y))\\k<a>){2}",
  "flags": "",
  "input": "xxyy",
  "op": "exec",
  "expected": {
   "match": [
    "xxyy",
    null,
    "y"
   ],
   "index": 0
  },
  "v8Commit": "f1ad38bed6a3",
  "v8CommitSubject": "[regexp] Implement duplicate named capture groups",
  "v8Test": "test/mjsunit/harmony/regexp-duplicate-named-groups.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "dup-named-groups-backref-mismatch",
  "source": "(?:(?:(?<a>x)|(?<a>y))\\k<a>){2}",
  "flags": "",
  "input": "xyxy",
  "op": "test",
  "expected": false,
  "v8Commit": "f1ad38bed6a3",
  "v8CommitSubject": "[regexp] Implement duplicate named capture groups",
  "v8Test": "test/mjsunit/harmony/regexp-duplicate-named-groups.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "dup-named-groups-replace-named-ref",
  "source": "(?:(?:(?<a>x)|(?<a>y))\\k<a>)",
  "flags": "",
  "input": "xxyy",
  "op": "replace",
  "expected": {
   "replacement": "2$<a>",
   "result": "2xyy"
  },
  "v8Commit": "f1ad38bed6a3",
  "v8CommitSubject": "[regexp] Implement duplicate named capture groups",
  "v8Test": "test/mjsunit/harmony/regexp-duplicate-named-groups.js",
  "replacement": "2$<a>",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "dup-named-groups-same-alternative-invalid",
  "source": "(?<a>.)(?<a>.)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "f1ad38bed6a3",
  "v8CommitSubject": "[regexp] Implement duplicate named capture groups",
  "v8Test": "test/mjsunit/harmony/regexp-duplicate-named-groups.js",
  "note": "still an early error with the duplicate-named-groups feature; node 22 rejects all duplicates"
 },
 {
  "name": "dup-named-groups-split",
  "source": "(?:(?:(?<a>x)|(?<a>y))\\k<a>)",
  "flags": "",
  "input": "xxyy",
  "op": "split",
  "expected": [
   "",
   "x",
   null,
   "",
   null,
   "y",
   ""
  ],
  "v8Commit": "f1ad38bed6a3",
  "v8CommitSubject": "[regexp] Implement duplicate named capture groups",
  "v8Test": "test/mjsunit/harmony/regexp-duplicate-named-groups.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "dup-named-groups-valid-in-different-alternatives",
  "source": "(?<a>.)|(?<a>.)",
  "flags": "",
  "input": "z",
  "op": "test",
  "expected": true,
  "v8Commit": "f1ad38bed6a3",
  "v8CommitSubject": "[regexp] Implement duplicate named capture groups",
  "v8Test": "test/mjsunit/harmony/regexp-duplicate-named-groups.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "lookbehind-mutually-recursive-backrefs",
  "source": "(?<=a(.\\2)b(\\1)).{4}",
  "flags": "",
  "input": "aabcacbc",
  "op": "exec",
  "expected": {
   "match": [
    "cacb",
    "a",
    ""
   ],
   "index": 3
  },
  "v8Commit": "44a8fec8a1d1",
  "v8CommitSubject": "[regexp] break recursion in mutually recursive capture/back references.",
  "v8Test": "test/mjsunit/harmony/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-referencing-lookahead-capture-oob",
  "source": "(?=(abcdefg))(?<=\\1)",
  "flags": "",
  "input": "bcdefgabcdefg",
  "op": "exec",
  "expected": null,
  "v8Commit": "e3ae7ad9c7aa",
  "v8CommitSubject": "[regexp] fix regexp lookbehind with back reference on ARM.",
  "v8Test": "test/mjsunit/harmony/regexp-lookbehind.js"
 },
 {
  "name": "lookbehind-self-referencing-backref-loop",
  "source": "(?<=(?:\\1b)(aa)).",
  "flags": "",
  "input": "aabaax",
  "op": "exec",
  "expected": {
   "match": [
    "x",
    "aa"
   ],
   "index": 5
  },
  "v8Commit": "44a8fec8a1d1",
  "v8CommitSubject": "[regexp] break recursion in mutually recursive capture/back references.",
  "v8Test": "test/mjsunit/harmony/regexp-lookbehind.js"
 },
 {
  "name": "modifiers-boyer-moore-info",
  "source": "(?i:.oo)",
  "flags": "",
  "input": "Foo",
  "op": "test",
  "expected": true,
  "v8Commit": "7d34b8649dbc",
  "v8CommitSubject": "[regexp] Account for modifiers when filling BMInfo",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-disable-ignore-case",
  "source": "(?-i:ba)r",
  "flags": "i",
  "input": "Bar",
  "op": "test",
  "expected": false,
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-dotall-group",
  "source": "(?s:^.$)",
  "flags": "",
  "input": "\n",
  "op": "test",
  "expected": true,
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-duplicate-flag-invalid",
  "source": "(?ii:.)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "note": "node 22 lacks modifiers entirely, so it also throws; still an early error in current V8"
 },
 {
  "name": "modifiers-ignore-case-group",
  "source": "(?i:ba)r",
  "flags": "",
  "input": "BAr",
  "op": "test",
  "expected": true,
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-ignore-case-group-outside-unaffected",
  "source": "(?i:ba)r",
  "flags": "",
  "input": "BAR",
  "op": "test",
  "expected": false,
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-multiline-group",
  "source": "(?m:^foo$)",
  "flags": "",
  "input": "\nfoo\n",
  "op": "test",
  "expected": true,
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-nested-enable-disable-match",
  "source": "F(?i:oo(?-i:b)a)r",
  "flags": "",
  "input": "FoObAr",
  "op": "test",
  "expected": true,
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-nested-enable-disable-nomatch",
  "source": "F(?i:oo(?-i:b)a)r",
  "flags": "",
  "input": "FooBar",
  "op": "test",
  "expected": false,
  "v8Commit": "42fa8936d5b2",
  "v8CommitSubject": "[regexp] Implement modifiers",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-with-lookahead-syntax-invalid",
  "source": "(?i=)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "63e4e0f3b53c",
  "v8CommitSubject": "[regexp] Fix modifier parsing",
  "v8Test": "test/mjsunit/harmony/regexp-modifiers.js",
  "note": "modifiers and assertion syntax cannot be mixed"
 },
 {
  "name": "k-angle-annexb-no-named-groups",
  "source": "\\k<a>",
  "flags": "",
  "input": "k<a>",
  "op": "test",
  "expected": true,
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "k-angle-then-non-name-group-corner",
  "source": "\\k<a>(<a>x)",
  "flags": "",
  "input": "k<a><a>x",
  "op": "test",
  "expected": true,
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "k-angle-with-empty-lookbehind-corner",
  "source": "\\k<a>(?<=>)a",
  "flags": "",
  "input": "k<a>a",
  "op": "test",
  "expected": true,
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "lone-k-annexb-identity-escape",
  "source": "\\k",
  "flags": "",
  "input": "k",
  "op": "test",
  "expected": true,
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "lone-k-invalid-with-named-group",
  "source": "(?<a>.)\\k",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-backref-before-and-after-group",
  "source": "\\k<a>(?<a>b)\\w\\k<a>",
  "flags": "",
  "input": "bab",
  "op": "exec",
  "expected": {
   "match": [
    "bab",
    "b"
   ],
   "index": 0
  },
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-backref-forward-reference",
  "source": "\\k<a>(?<a>x)",
  "flags": "",
  "input": "x",
  "op": "test",
  "expected": true,
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-group-astral-id-name",
  "source": "(?<$\ud801\udca4>a)",
  "flags": "",
  "input": "bab",
  "op": "exec",
  "expected": {
   "match": [
    "a",
    "a"
   ],
   "index": 1
  },
  "v8Commit": "f67dd50a165f",
  "v8CommitSubject": "[regexp] Update capture name parsing for recent spec changes",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-group-name-backslash-invalid",
  "source": "(?<\\>.)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "d890ec3261b0",
  "v8CommitSubject": "[regexp] Disallow '\\' in capture names",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-group-name-emoji-invalid",
  "source": "(?<\u2764>a)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-group-non-latin-name-non-unicode-mode",
  "source": "(?<\\u03c0>a)",
  "flags": "",
  "input": "bab",
  "op": "exec",
  "expected": {
   "match": [
    "a",
    "a"
   ],
   "index": 1
  },
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-group-unicode-escape-name",
  "source": "(?<\\u{03C0}>a)",
  "flags": "u",
  "input": "bab",
  "op": "exec",
  "expected": {
   "match": [
    "a",
    "a"
   ],
   "index": 1
  },
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-groups-backrefs-full",
  "source": "(?<a>.)(?<b>.)(?<c>.)\\k<c>\\k<b>\\k<a>",
  "flags": "",
  "input": "abccba",
  "op": "exec",
  "expected": {
   "match": [
    "abccba",
    "a",
    "b",
    "c"
   ],
   "index": 0
  },
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "named-replace-invalid-name-syntax",
  "source": "(?<fst>.)(?<snd>.)|(?<thd>x)",
  "flags": "u",
  "input": "abcd",
  "op": "replace",
  "expected": {
   "replacement": "$<42$1>",
   "result": "cd"
  },
  "v8Commit": "159236ec254c",
  "v8CommitSubject": "[regexp] Update semantics of GetSubstitution with named captures",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js",
  "replacement": "$<42$1>"
 },
 {
  "name": "named-replace-literal-without-named-groups",
  "source": "(.)(.)",
  "flags": "u",
  "input": "abcd",
  "op": "replace",
  "expected": {
   "replacement": "$<snd>$<fst>",
   "result": "$<snd>$<fst>cd"
  },
  "v8Commit": "9403edfa83d0",
  "v8CommitSubject": "[regexp] Named capture support for string replacements",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js",
  "replacement": "$<snd>$<fst>"
 },
 {
  "name": "named-replace-nonexistent-name",
  "source": "(?<fst>.)(?<snd>.)|(?<thd>x)",
  "flags": "u",
  "input": "abcd",
  "op": "replace",
  "expected": {
   "replacement": "$<fth>",
   "result": "cd"
  },
  "v8Commit": "159236ec254c",
  "v8CommitSubject": "[regexp] Update semantics of GetSubstitution with named captures",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js",
  "replacement": "$<fth>"
 },
 {
  "name": "named-replace-nonparticipating-group",
  "source": "(?<fst>.)(?<snd>.)|(?<thd>x)",
  "flags": "u",
  "input": "abcd",
  "op": "replace",
  "expected": {
   "replacement": "$<thd>",
   "result": "cd"
  },
  "v8Commit": "1329d15e9909",
  "v8CommitSubject": "[regexp] Throw on invalid capture group names in replacer string",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js",
  "replacement": "$<thd>"
 },
 {
  "name": "named-replace-swap",
  "source": "(?<fst>.)(?<snd>.)",
  "flags": "u",
  "input": "abcd",
  "op": "replace",
  "expected": {
   "replacement": "$<snd>$<fst>",
   "result": "bacd"
  },
  "v8Commit": "9403edfa83d0",
  "v8CommitSubject": "[regexp] Named capture support for string replacements",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js",
  "replacement": "$<snd>$<fst>"
 },
 {
  "name": "named-replace-unterminated-ref-global",
  "source": "(?<fst>.)(?<snd>.)|(?<thd>x)",
  "flags": "gu",
  "input": "abcd",
  "op": "replace",
  "expected": {
   "replacement": "$<snd",
   "result": "$<snd$<snd"
  },
  "v8Commit": "159236ec254c",
  "v8CommitSubject": "[regexp] Update semantics of GetSubstitution with named captures",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js",
  "replacement": "$<snd"
 },
 {
  "name": "numbered-backref-before-named-group",
  "source": "\\1(?<a>.)",
  "flags": "u",
  "input": "abcd",
  "op": "exec",
  "expected": {
   "match": [
    "a",
    "a"
   ],
   "index": 0
  },
  "v8Commit": "3f8b2aeb3587",
  "v8CommitSubject": "[regexp] Fix numbered reference before named capture",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "numbered-backref-no-groups-unicode-invalid",
  "source": "\\1(?:.)",
  "flags": "u",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "3f8b2aeb3587",
  "v8CommitSubject": "[regexp] Fix numbered reference before named capture",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "numbered-backref-only-lookbehind-unicode-invalid",
  "source": "\\1(?<=a).",
  "flags": "u",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "3f8b2aeb3587",
  "v8CommitSubject": "[regexp] Fix numbered reference before named capture",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "unterminated-k-then-group-invalid",
  "source": "\\k<a(?<a>a)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "a3be9e78c1bd",
  "v8CommitSubject": "[regexp] Allow named captures and back-references in non-unicode patterns",
  "v8Test": "test/mjsunit/harmony/regexp-named-captures.js"
 },
 {
  "name": "sticky-does-not-search-past-start",
  "source": "foo.bar",
  "flags": "y",
  "input": "..foo*bar",
  "op": "match",
  "expected": null,
  "v8Commit": "9081ee11af03",
  "v8CommitSubject": "RegExp: Fix update of lastIndex on non-global sticky",
  "v8Test": "test/mjsunit/harmony/regexp-sticky.js"
 },
 {
  "name": "vi-negated-property-early-case-fold-ascii",
  "source": "\\P{ASCII}",
  "flags": "iv",
  "input": "K",
  "op": "test",
  "expected": false,
  "v8Commit": "87aac074a57e",
  "v8CommitSubject": "[regexp] Case-fold early with /vi",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js",
  "note": "complementing before case-folding would add ASCII K via U+212A KELVIN SIGN; /v must fold first, then complement"
 },
 {
  "name": "vi-negated-property-early-case-fold-lowercase",
  "source": "^\\P{Lowercase}",
  "flags": "iv",
  "input": "A",
  "op": "test",
  "expected": false,
  "v8Commit": "87aac074a57e",
  "v8CommitSubject": "[regexp] Case-fold early with /vi",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js"
 },
 {
  "name": "vset-empty-nested-class-intersection",
  "source": "[[a-c\\q{foo|bar}]&&[]]",
  "flags": "v",
  "input": "a",
  "op": "test",
  "expected": false,
  "v8Commit": "ee93bc803514",
  "v8CommitSubject": "[regexp] Handle empty nested classes correctly",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js"
 },
 {
  "name": "vset-empty-nested-class-union",
  "source": "[a-c\\q{foo|bar}[]]",
  "flags": "v",
  "input": "foo",
  "op": "test",
  "expected": true,
  "v8Commit": "ee93bc803514",
  "v8CommitSubject": "[regexp] Handle empty nested classes correctly",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js"
 },
 {
  "name": "vset-string-disjunction-empty-string-last",
  "source": "[\\q{W|}a-c]",
  "flags": "v",
  "input": "abc",
  "op": "exec",
  "expected": {
   "match": [
    "a"
   ],
   "index": 0
  },
  "v8Commit": "b21300759612",
  "v8CommitSubject": "[regexp] Canonicalize ranges in class string disjunctions",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js"
 },
 {
  "name": "vset-string-disjunction-longest-first",
  "source": "[a-c\\q{W|xy|xyz}]",
  "flags": "v",
  "input": "xyzabc",
  "op": "exec",
  "expected": {
   "match": [
    "xyz"
   ],
   "index": 0
  },
  "v8Commit": "b21300759612",
  "v8CommitSubject": "[regexp] Canonicalize ranges in class string disjunctions",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js"
 },
 {
  "name": "vset-string-disjunction-minus-digits",
  "source": "[\\q{foo|bar|3|2|0}--\\d]",
  "flags": "v",
  "input": "0",
  "op": "test",
  "expected": false,
  "v8Commit": "b21300759612",
  "v8CommitSubject": "[regexp] Canonicalize ranges in class string disjunctions",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js"
 },
 {
  "name": "vset-string-disjunction-minus-digits-keeps-strings",
  "source": "[\\q{foo|bar|3|2|0}--\\d]",
  "flags": "v",
  "input": "foo",
  "op": "exec",
  "expected": {
   "match": [
    "foo"
   ],
   "index": 0
  },
  "v8Commit": "b21300759612",
  "v8CommitSubject": "[regexp] Canonicalize ranges in class string disjunctions",
  "v8Test": "test/mjsunit/harmony/regexp-unicode-sets.js"
 },
 {
  "name": "vi-class-range-plus-single-canonicalized",
  "source": "[a-cB]",
  "flags": "iv",
  "input": "B",
  "op": "test",
  "expected": true,
  "v8Commit": "39b0ade26b43",
  "v8CommitSubject": "[regexp] Canonicalize character range before adding case equivalents.",
  "v8Test": "test/mjsunit/harmony/regress/regress-crbug-1410963.js"
 },
 {
  "name": "astral-class-range-upper-bound",
  "source": "[\\u{0}-\\u{1F444}]",
  "flags": "u",
  "input": "\ud83d\udfff",
  "op": "exec",
  "expected": null,
  "v8Commit": "5082eaee5f75",
  "v8CommitSubject": "[regexp] fix off-by-one in UnicodeRangeSplitter.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "backward-lone-surrogate-class-capture",
  "source": "(?<=([\\ud800-\\ud900]A))B",
  "flags": "u",
  "input": "\ud801\udc00AB\udc00AB\ud802\ud803AB",
  "op": "exec",
  "expected": {
   "match": [
    "B",
    "\ud803A"
   ],
   "index": 10
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "class-mixed-bmp-astral-range-includes-endpoint",
  "source": "[\\u1234-\\u{12345}]",
  "flags": "u",
  "input": "\ud808\udf45",
  "op": "exec",
  "expected": {
   "match": [
    "\ud808\udf45"
   ],
   "index": 0
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "dot-matches-lone-lead-then-literal",
  "source": ".X",
  "flags": "u",
  "input": "\ud800XaX",
  "op": "exec",
  "expected": {
   "match": [
    "\ud800X"
   ],
   "index": 0
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "lead-surrogate-anchored-does-not-match-in-pair",
  "source": "^\\ud800$",
  "flags": "u",
  "input": "\ud800\udc00",
  "op": "test",
  "expected": false,
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "lone-lead-plus-unicode",
  "source": "\\ud801+",
  "flags": "u",
  "input": "\ud801\udc01\ud801\ud801",
  "op": "exec",
  "expected": {
   "match": [
    "\ud801\ud801"
   ],
   "index": 2
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "lone-trail-plus-unicode",
  "source": "\\udc01+",
  "flags": "u",
  "input": "\ud801\ud801\udc01\udc01\udc01",
  "op": "exec",
  "expected": {
   "match": [
    "\udc01\udc01"
   ],
   "index": 3
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "lookbehind-full-pair-after-any",
  "source": "^.(?<=\\u{10000})",
  "flags": "u",
  "input": "\ud800\udc00",
  "op": "test",
  "expected": true,
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "lookbehind-lead-inside-pair-fails",
  "source": "^.(?<=\\ud800)",
  "flags": "u",
  "input": "\ud800\udc00",
  "op": "test",
  "expected": false,
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "lookbehind-trail-after-unpaired-trail",
  "source": "^.(?<=\\udc00)",
  "flags": "u",
  "input": "\udc00\ud800",
  "op": "test",
  "expected": true,
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "negated-astral-class-matches-lone-lead",
  "source": "[^\\u{ff80}-\\u{12345}]",
  "flags": "u",
  "input": "\uff99\ud800A",
  "op": "exec",
  "expected": {
   "match": [
    "\ud800"
   ],
   "index": 1
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "negated-class-mixed-bmp-astral-range",
  "source": "[^\\u1234-\\u{12345}]",
  "flags": "u",
  "input": "\ud808\udf46",
  "op": "exec",
  "expected": {
   "match": [
    "\ud808\udf46"
   ],
   "index": 0
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "negative-lookbehind-lone-lead",
  "source": ".(?<!\\ud800)X",
  "flags": "u",
  "input": "\ud800XaX",
  "op": "exec",
  "expected": {
   "match": [
    "aX"
   ],
   "index": 2
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "negative-lookbehind-lone-lead-class",
  "source": ".(?<![\\ud800-\\ud900])X",
  "flags": "u",
  "input": "\ud800XaX",
  "op": "exec",
  "expected": {
   "match": [
    "aX"
   ],
   "index": 2
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "nonword-class-surrogate-pair-nonunicode",
  "source": "[^\\w]",
  "flags": "",
  "input": "\ud801\udc01",
  "op": "exec",
  "expected": {
   "match": [
    "\ud801"
   ],
   "index": 0
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "nonword-class-surrogate-pair-unicode",
  "source": "[^\\w]",
  "flags": "u",
  "input": "\ud801\udc01",
  "op": "exec",
  "expected": {
   "match": [
    "\ud801\udc01"
   ],
   "index": 0
  },
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "reversed-surrogates-are-not-a-pair",
  "source": "^\\udc00\\ud800$",
  "flags": "u",
  "input": "\udc00\ud800",
  "op": "test",
  "expected": true,
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "trail-surrogate-anchored-does-not-match-in-pair",
  "source": "^\\udc00$",
  "flags": "u",
  "input": "\ud800\udc00",
  "op": "test",
  "expected": false,
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "word-class-does-not-match-surrogate-pair",
  "source": "\\w",
  "flags": "u",
  "input": "\ud801\udc01",
  "op": "exec",
  "expected": null,
  "v8Commit": "e709aa24c0c1",
  "v8CommitSubject": "[regexp] implement character classes for unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-character-ranges.js"
 },
 {
  "name": "astral-alternative-vs-swapped-lone-surrogates",
  "source": "\\u{12345}|\\u{23456}",
  "flags": "u",
  "input": "b\udf45\ud808c",
  "op": "test",
  "expected": false,
  "v8Commit": "fbbb9cab45ab",
  "v8CommitSubject": "[regexp] correctly parse non-BMP unicode escapes in atoms.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "astral-capture-backref-different",
  "source": "(\\u{12345}|\\u{23456}).\\1",
  "flags": "u",
  "input": "\ud808\udf45b\ud84d\udc56",
  "op": "test",
  "expected": false,
  "v8Commit": "fbbb9cab45ab",
  "v8CommitSubject": "[regexp] correctly parse non-BMP unicode escapes in atoms.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "astral-capture-backref-same",
  "source": "(\\u{12345}|\\u{23456}).\\1",
  "flags": "u",
  "input": "\ud808\udf45b\ud808\udf45",
  "op": "test",
  "expected": true,
  "v8Commit": "fbbb9cab45ab",
  "v8CommitSubject": "[regexp] correctly parse non-BMP unicode escapes in atoms.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "astral-quantifier-nonunicode-applies-to-trail",
  "source": "\ud808\udf45{3}",
  "flags": "",
  "input": "\ud808\udf45\udf45\udf45",
  "op": "test",
  "expected": true,
  "v8Commit": "8645a5ccd0c5",
  "v8CommitSubject": "[regexp] quantifier refers to the surrogate pair in unicode regexp.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js",
  "note": "without /u the quantifier applies to the trail surrogate code unit only"
 },
 {
  "name": "astral-quantifier-unicode-pairs",
  "source": "\\u{12345}{3}",
  "flags": "u",
  "input": "\ud808\udf45\ud808\udf45\ud808\udf45",
  "op": "test",
  "expected": true,
  "v8Commit": "8645a5ccd0c5",
  "v8CommitSubject": "[regexp] quantifier refers to the surrogate pair in unicode regexp.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "astral-quantifier-unicode-rejects-trails",
  "source": "\\u{12345}{3}",
  "flags": "u",
  "input": "\ud808\udf45\udf45\udf45",
  "op": "test",
  "expected": false,
  "v8Commit": "8645a5ccd0c5",
  "v8CommitSubject": "[regexp] quantifier refers to the surrogate pair in unicode regexp.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "braced-surrogate-escapes-no-join",
  "source": "\\u{d800}\\u{dc00}+",
  "flags": "u",
  "input": "\ud800\udc00\udc00",
  "op": "exec",
  "expected": null,
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "escaped-lead-literal-trail-no-join",
  "source": "\\ud800\udc00+",
  "flags": "u",
  "input": "\ud800\udc00\ud800\udc00",
  "op": "exec",
  "expected": null,
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js",
  "note": "an escaped lead surrogate followed by a literal trail surrogate does not form a pair in /u"
 },
 {
  "name": "escaped-surrogate-pair-quantifier-unicode",
  "source": "\\u{12345}{3}",
  "flags": "u",
  "input": "\ud808\udf45\udf45\udf45",
  "op": "test",
  "expected": false,
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "literal-surrogate-pair-quantified-as-code-point",
  "source": "\ud800\udc00+",
  "flags": "u",
  "input": "\ud800\udc00\ud800\udc00",
  "op": "exec",
  "expected": {
   "match": [
    "\ud800\udc00\ud800\udc00"
   ],
   "index": 0
  },
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-escapes-in-regexps.js"
 },
 {
  "name": "backref-across-surrogate-pairs",
  "source": "([^x]+)x*\\1",
  "flags": "u",
  "input": "xxx\ud800\udc00\udc00xx\ud800\udc00\udc00xx",
  "op": "exec",
  "expected": {
   "match": [
    "\ud800\udc00\udc00xx\ud800\udc00\udc00",
    "\ud800\udc00\udc00"
   ],
   "index": 3
  },
  "v8Commit": "49fda47c5fa8",
  "v8CommitSubject": "[regexp] back refs must not start/end in the middle of a surrogate pair",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-backrefs.js"
 },
 {
  "name": "backref-lone-lead-vs-pair-boundary",
  "source": "([^x]+)x*\\1",
  "flags": "u",
  "input": "\ud800x\ud800\udc00",
  "op": "exec",
  "expected": null,
  "v8Commit": "49fda47c5fa8",
  "v8CommitSubject": "[regexp] back refs must not start/end in the middle of a surrogate pair",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-backrefs.js",
  "note": "a backreference must not end in the middle of a surrogate pair"
 },
 {
  "name": "backref-lone-trail-not-start-mid-pair",
  "source": "(\\udc00).*\\1(.)",
  "flags": "u",
  "input": "\udc00\ud800\udc00ab\udc00c",
  "op": "exec",
  "expected": {
   "match": [
    "\udc00\ud800\udc00ab\udc00c",
    "\udc00",
    "c"
   ],
   "index": 0
  },
  "v8Commit": "49fda47c5fa8",
  "v8CommitSubject": "[regexp] back refs must not start/end in the middle of a surrogate pair",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-backrefs.js"
 },
 {
  "name": "backref-must-not-end-inside-pair",
  "source": "(\\ud800)\\1",
  "flags": "u",
  "input": "\ud800\ud800\udc00",
  "op": "exec",
  "expected": null,
  "v8Commit": "49fda47c5fa8",
  "v8CommitSubject": "[regexp] back refs must not start/end in the middle of a surrogate pair",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-backrefs.js"
 },
 {
  "name": "ci-angstrom-sign-nonunicode-uppercase-mapping",
  "source": "[\\u00e5]",
  "flags": "i",
  "input": "\u212b",
  "op": "test",
  "expected": false,
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js",
  "note": "without /u, canonicalization uses toUpperCase, which does not equate U+212B with U+00E5"
 },
 {
  "name": "ciu-angstrom-sign-case-folds",
  "source": "\\u00e5",
  "flags": "iu",
  "input": "\u212b",
  "op": "test",
  "expected": true,
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js"
 },
 {
  "name": "ciu-astral-deseret-class-fold",
  "source": "[\\u{10428}]",
  "flags": "iu",
  "input": "\ud801\udc00",
  "op": "test",
  "expected": true,
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js"
 },
 {
  "name": "ciu-astral-deseret-fold",
  "source": "\\u{10400}",
  "flags": "iu",
  "input": "\ud801\udc28",
  "op": "test",
  "expected": true,
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js"
 },
 {
  "name": "ciu-backref-astral-fold",
  "source": "(.)\\1",
  "flags": "iu",
  "input": "\ud806\udcaa\ud806\udcca",
  "op": "exec",
  "expected": {
   "match": [
    "\ud806\udcaa\ud806\udcca",
    "\ud806\udcaa"
   ],
   "index": 0
  },
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js"
 },
 {
  "name": "ciu-backref-full-mapping-ignored",
  "source": "(.)\\1\\1",
  "flags": "iu",
  "input": "\u00e5\u212b\u00c5",
  "op": "exec",
  "expected": {
   "match": [
    "\u00e5\u212b\u00c5",
    "\u00e5"
   ],
   "index": 0
  },
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js"
 },
 {
  "name": "ciu-full-case-mapping-ignored",
  "source": "\\u00df",
  "flags": "iu",
  "input": "SS",
  "op": "test",
  "expected": false,
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js"
 },
 {
  "name": "ciu-simple-case-mapping-used",
  "source": "\\u1f8d",
  "flags": "iu",
  "input": "\u1f85",
  "op": "test",
  "expected": true,
  "v8Commit": "a2baaaac93ef",
  "v8CommitSubject": "[regexp] implement case-insensitive unicode regexps.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-ignore-case.js"
 },
 {
  "name": "match-global-nonunicode-dot-code-units",
  "source": ".",
  "flags": "g",
  "input": "\ud800\udc00\ud801\udc01",
  "op": "match",
  "expected": [
   "\ud800",
   "\udc00",
   "\ud801",
   "\udc01"
  ],
  "v8Commit": "3246d26b71d0",
  "v8CommitSubject": "[regexp] step back if starting unicode regexp within surrogate pair.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-last-index.js"
 },
 {
  "name": "match-global-unicode-dot-code-points",
  "source": ".",
  "flags": "gu",
  "input": "\ud800\udc00\ud801\udc01",
  "op": "match",
  "expected": [
   "\ud800\udc00",
   "\ud801\udc01"
  ],
  "v8Commit": "3246d26b71d0",
  "v8CommitSubject": "[regexp] step back if starting unicode regexp within surrogate pair.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-last-index.js"
 },
 {
  "name": "class-escape-range-unicode-invalid",
  "source": "[\\w-a]",
  "flags": "u",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js"
 },
 {
  "name": "escaped-dash-in-class-unicode",
  "source": "[a\\-z]",
  "flags": "u",
  "input": "12-34",
  "op": "exec",
  "expected": {
   "match": [
    "-"
   ],
   "index": 2
  },
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js"
 },
 {
  "name": "incomplete-quantifier-annexb-literal",
  "source": "a{1,",
  "flags": "",
  "input": "a{1,",
  "op": "test",
  "expected": true,
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js",
  "note": "contrast: literal characters without /u under Annex B"
 },
 {
  "name": "incomplete-quantifier-unicode-invalid",
  "source": "a{1,",
  "flags": "u",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js"
 },
 {
  "name": "lone-close-bracket-annexb-legal",
  "source": "]",
  "flags": "",
  "input": "a]",
  "op": "test",
  "expected": true,
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js",
  "note": "contrast: legal without /u under Annex B"
 },
 {
  "name": "lone-close-bracket-unicode-invalid",
  "source": "]",
  "flags": "u",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js"
 },
 {
  "name": "null-escape-in-class-unicode",
  "source": "[\\0]",
  "flags": "u",
  "input": "\u0000",
  "op": "exec",
  "expected": {
   "match": [
    "\u0000"
   ],
   "index": 0
  },
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js"
 },
 {
  "name": "octal-escape-in-class-unicode-invalid",
  "source": "[\\00]",
  "flags": "u",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js"
 },
 {
  "name": "quantified-lookahead-unicode-invalid",
  "source": "(?=.)*",
  "flags": "u",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "42309697c1da",
  "v8CommitSubject": "[regexp] parse RegExpUnicodeEscapeSequence according to spec.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-restricted-syntax.js"
 },
 {
  "name": "split-empty-pattern-unicode-astral",
  "source": "(?:)",
  "flags": "u",
  "input": "\ud808\udf45",
  "op": "split",
  "expected": [
   "\ud808\udf45"
  ],
  "v8Commit": "aff7bd54beb7",
  "v8CommitSubject": "[regexp] fix zero-length matches for RegExp.prototype.@@split.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-zero-length.js"
 },
 {
  "name": "zero-length-global-match-nonunicode",
  "source": "()",
  "flags": "g",
  "input": "\ud800\udc00\ud800\udc00",
  "op": "match",
  "expected": [
   "",
   "",
   "",
   "",
   ""
  ],
  "v8Commit": "57d202d879db",
  "v8CommitSubject": "[regexp] correctly advance zero length matches for global/unicode.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-zero-length.js"
 },
 {
  "name": "zero-length-global-match-unicode",
  "source": "()",
  "flags": "gu",
  "input": "\ud800\udc00\ud800\udc00",
  "op": "match",
  "expected": [
   "",
   "",
   ""
  ],
  "v8Commit": "57d202d879db",
  "v8CommitSubject": "[regexp] correctly advance zero length matches for global/unicode.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-zero-length.js"
 },
 {
  "name": "zero-length-global-replace-nonunicode",
  "source": "()",
  "flags": "g",
  "input": "\ud800\udc00\ud800\udc00",
  "op": "replace",
  "expected": {
   "replacement": "x",
   "result": "x\ud800x\udc00x\ud800x\udc00x"
  },
  "v8Commit": "57d202d879db",
  "v8CommitSubject": "[regexp] correctly advance zero length matches for global/unicode.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-zero-length.js",
  "replacement": "x"
 },
 {
  "name": "zero-length-global-replace-unicode",
  "source": "()",
  "flags": "gu",
  "input": "\ud800\udc00\ud800\udc00",
  "op": "replace",
  "expected": {
   "replacement": "x",
   "result": "x\ud800\udc00x\ud800\udc00x"
  },
  "v8Commit": "57d202d879db",
  "v8CommitSubject": "[regexp] correctly advance zero length matches for global/unicode.",
  "v8Test": "test/mjsunit/harmony/unicode-regexp-zero-length.js",
  "replacement": "x"
 },
 {
  "name": "nullable-body-bounded-quantifier",
  "source": "(?:a?b??){0,2}",
  "flags": "",
  "input": "ab",
  "op": "exec",
  "expected": {
   "match": [
    "ab"
   ],
   "index": 0
  },
  "v8Commit": "51eb31f216b3",
  "v8CommitSubject": "[regexp] Fixing Experimental behavior on nullable quantifiers",
  "v8Test": "test/mjsunit/regexp-14098.js"
 },
 {
  "name": "nullable-body-greedy-star",
  "source": "(?:a?b??)*",
  "flags": "",
  "input": "ab",
  "op": "exec",
  "expected": {
   "match": [
    "ab"
   ],
   "index": 0
  },
  "v8Commit": "398ce3a30f3b",
  "v8CommitSubject": "[regexp] Add a test where experimental disagrees with backtracking",
  "v8Test": "test/mjsunit/regexp-14098.js",
  "note": "iteration 1 matches \"a\" (lazy b?? skips), the loop is re-entered, iteration 2 matches \"b\""
 },
 {
  "name": "zero-count-quantifier-body-captures-undefined",
  "source": "(x(a(b(c)+d){0}e)y)",
  "flags": "",
  "input": "xaey",
  "op": "exec",
  "expected": {
   "match": [
    "xaey",
    "xaey",
    "ae",
    null,
    null
   ],
   "index": 0
  },
  "v8Commit": "51c277a84683",
  "v8CommitSubject": "[regexp] Fix handling of 0 quantifiers in Experimental engine",
  "v8Test": "test/mjsunit/regexp-444637793.js"
 },
 {
  "name": "alternation-uc16-pattern-ascii-subject",
  "source": "\\u5e74|\\u6708",
  "flags": "",
  "input": "t",
  "op": "test",
  "expected": false,
  "v8Commit": "3f962f0f9cf1",
  "v8CommitSubject": "Irregexp: * Fix UC16 character classes on ASCII subjects. * Fix sign problem in Irregexp interpreter. * Make passes over text nodes more readable. Review URL: http://codereview.chromium.org/21450",
  "v8Test": "test/mjsunit/regexp-UC16.js"
 },
 {
  "name": "charclass-uc16-pattern-ascii-subject",
  "source": "[\\xe9]",
  "flags": "",
  "input": "i",
  "op": "test",
  "expected": false,
  "v8Commit": "3f962f0f9cf1",
  "v8CommitSubject": "Irregexp: * Fix UC16 character classes on ASCII subjects. * Fix sign problem in Irregexp interpreter. * Make passes over text nodes more readable. Review URL: http://codereview.chromium.org/21450",
  "v8Test": "test/mjsunit/regexp-UC16.js"
 },
 {
  "name": "ci-backref-twice-greek-uc16",
  "source": "x(...)\\1\\1",
  "flags": "i",
  "input": "x\u03a3\u03c2\u039b\u03c2\u03c3\u03bb\u03c3\u03a3\u03bb",
  "op": "exec",
  "expected": {
   "match": [
    "x\u03a3\u03c2\u039b\u03c2\u03c3\u03bb\u03c3\u03a3\u03bb",
    "\u03a3\u03c2\u039b"
   ],
   "index": 0
  },
  "v8Commit": "3f962f0f9cf1",
  "v8CommitSubject": "Irregexp: * Fix UC16 character classes on ASCII subjects. * Fix sign problem in Irregexp interpreter. * Make passes over text nodes more readable. Review URL: http://codereview.chromium.org/21450",
  "v8Test": "test/mjsunit/regexp-UC16.js",
  "note": "pre-existing assertion in the same test file (sigma/lambda case variants)"
 },
 {
  "name": "quickcheck-uc16-pattern-ascii-subject",
  "source": "\\xc1",
  "flags": "i",
  "input": "fooA",
  "op": "test",
  "expected": false,
  "v8Commit": "3f962f0f9cf1",
  "v8CommitSubject": "Irregexp: * Fix UC16 character classes on ASCII subjects. * Fix sign problem in Irregexp interpreter. * Make passes over text nodes more readable. Review URL: http://codereview.chromium.org/21450",
  "v8Test": "test/mjsunit/regexp-UC16.js"
 },
 {
  "name": "replace-caret-alternation-global-empty",
  "source": "^|bar",
  "flags": "g",
  "input": "foo bar baz",
  "op": "replace",
  "expected": {
   "replacement": "",
   "result": "foo  baz"
  },
  "v8Commit": "c436c70f8b41",
  "v8CommitSubject": "Fix some bugs in accessing details of the lastest regexp match.  Sometimes were were not updating it when we should and sometimes we were leaving the lastMatchInfoOverride in place when we should be using the updated regular last match info.  Small optimization for zero length match in String.prototype.replace. Review URL: https://chromiumcodereview.appspot.com/10184004",
  "v8Test": "test/mjsunit/regexp-capture-3.js",
  "replacement": ""
 },
 {
  "name": "replace-caret-alternation-global-star",
  "source": "^|bar",
  "flags": "g",
  "input": "foo bar baz",
  "op": "replace",
  "expected": {
   "replacement": "*",
   "result": "*foo * baz"
  },
  "v8Commit": "c436c70f8b41",
  "v8CommitSubject": "Fix some bugs in accessing details of the lastest regexp match.  Sometimes were were not updating it when we should and sometimes we were leaving the lastMatchInfoOverride in place when we should be using the updated regular last match info.  Small optimization for zero length match in String.prototype.replace. Review URL: https://chromiumcodereview.appspot.com/10184004",
  "v8Test": "test/mjsunit/regexp-capture-3.js",
  "replacement": "*"
 },
 {
  "name": "backrefs-inside-quantified-group",
  "source": "((\\3|b)\\2(a)){2,}",
  "flags": "",
  "input": "bbaababbabaaaaabbaaaabba",
  "op": "exec",
  "expected": {
   "match": [
    "bbaa",
    "a",
    "",
    "a"
   ],
   "index": 0
  },
  "v8Commit": "ae4fcd970295",
  "v8CommitSubject": "Limit work done analyzing regexps with very large fanout. BUG=128821 Review URL: https://chromiumcodereview.appspot.com/10448117",
  "v8Test": "test/mjsunit/regexp-capture.js"
 },
 {
  "name": "lazy-bounded-alternation-quantifier",
  "source": "^(b+|a){1,2}?bc",
  "flags": "",
  "input": "bbc",
  "op": "exec",
  "expected": {
   "match": [
    "bbc",
    "b"
   ],
   "index": 0
  },
  "v8Commit": "ae4fcd970295",
  "v8CommitSubject": "Limit work done analyzing regexps with very large fanout. BUG=128821 Review URL: https://chromiumcodereview.appspot.com/10448117",
  "v8Test": "test/mjsunit/regexp-capture.js"
 },
 {
  "name": "npcg-backref-matches-empty",
  "source": "(x)?\\1y",
  "flags": "",
  "input": "y",
  "op": "exec",
  "expected": {
   "match": [
    "y",
    null
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-capture.js"
 },
 {
  "name": "npcg-replace-dollar-group-empty",
  "source": "(x)?y",
  "flags": "",
  "input": "y",
  "op": "replace",
  "expected": {
   "replacement": "$1",
   "result": ""
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-capture.js",
  "replacement": "$1"
 },
 {
  "name": "npcg-split-keeps-undefined",
  "source": "(x)?\\1y",
  "flags": "",
  "input": "y",
  "op": "split",
  "expected": [
   "",
   null,
   ""
  ],
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-capture.js"
 },
 {
  "name": "nfa-blowup-nested-alternation-plus",
  "source": "^(((N({)?)|(R)|(U)|(V)|(B)|(H)|(n((n)|(r)|(v)|(h))?)|(r(r)?)|(v)|(b((n)|(b))?)|(h))|((Y)|(A)|(E)|(o(u)?)|(p(u)?)|(q(u)?)|(s)|(t)|(u)|(w)|(x(u)?)|(y)|(z)|(a((T)|(A)|(L))?)|(c)|(e)|(f(u)?)|(g(u)?)|(i)|(j)|(l)|(m(u)?)))+",
  "flags": "",
  "input": "Avtnennan gunzvmu pubExnY nEvln vaTxh rmuhguhaTxnY",
  "op": "test",
  "expected": true,
  "v8Commit": "2b71d0a83e73",
  "v8CommitSubject": "Fix regexp bug reported on iit.edu. Review URL: http://codereview.chromium.org/141042",
  "v8Test": "test/mjsunit/regexp-captures.js"
 },
 {
  "name": "dup-named-groups-nested-in-same-alternative-invalid",
  "source": "(?<a>(?<a>.)|.)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "75330867c769",
  "v8CommitSubject": "[regexp] Fix nested duplicate named capture groups",
  "v8Test": "test/mjsunit/regexp-duplicate-named-groups.js",
  "note": "nested duplicate inside the same alternative stays an error even with the duplicate-name feature"
 },
 {
  "name": "dup-named-groups-nonparticipating-hole-invalid",
  "source": "(?<a>.)|(?<b>.)(?:(?<c>.)|(?<b>.)(?:(?<e>.)|(?<f>.)))",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "fb46bda8336e",
  "v8CommitSubject": "[regexp] Fix duplicate named capture groups",
  "v8Test": "test/mjsunit/regexp-duplicate-named-groups.js"
 },
 {
  "name": "dup-named-groups-valid-nested-in-other-alternative",
  "source": "(?<a>.)|(?<a>.(?<b>.)|.)",
  "flags": "",
  "input": "z",
  "op": "test",
  "expected": true,
  "v8Commit": "fb46bda8336e",
  "v8CommitSubject": "[regexp] Fix duplicate named capture groups",
  "v8Test": "test/mjsunit/regexp-duplicate-named-groups.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "class-excluding-all-code-units-never-matches",
  "source": "[^\\x00-\\uffff]",
  "flags": "",
  "input": "asdf",
  "op": "exec",
  "expected": null,
  "v8Commit": "f89848dc4800",
  "v8CommitSubject": "[regexp] Fix [^\\x00-\\uFFFF] in experimental engine.",
  "v8Test": "test/mjsunit/regexp-experimental.js"
 },
 {
  "name": "replace-dot-star-global-empty-tail-match",
  "source": "(.*)",
  "flags": "g",
  "input": "Beasts of England, beasts of Ireland",
  "op": "replace",
  "expected": {
   "replacement": "~",
   "result": "~~"
  },
  "v8Commit": "24a1503d2862",
  "v8CommitSubject": "Fix creating substring in string.replace(<global regexp>, <function>).",
  "v8Test": "test/mjsunit/regexp-global.js",
  "replacement": "~"
 },
 {
  "name": "doubly-nested-lookahead-backrefs",
  "source": "^(?=(.)(?=(.)\\1\\2)\\2\\1)\\1\\2",
  "flags": "",
  "input": "abab",
  "op": "exec",
  "expected": {
   "match": [
    "ab",
    "a",
    "b"
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "lookahead-capture-cleared-on-backtrack",
  "source": "^(?:(?=(.))a|b)\\1$",
  "flags": "",
  "input": "b",
  "op": "exec",
  "expected": {
   "match": [
    "b",
    null
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "lookahead-capture-kept-on-success",
  "source": "^(?:(?=(.))a|b)\\1$",
  "flags": "",
  "input": "aa",
  "op": "exec",
  "expected": {
   "match": [
    "aa",
    "a"
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "lookahead-quickcheck-two-any",
  "source": "(?=..)abcd",
  "flags": "",
  "input": "----abcd",
  "op": "test",
  "expected": true,
  "v8Commit": "f0b69ff10c78",
  "v8CommitSubject": "[regexp] Improve analysis around positive lookaround.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "lookahead-quotes-capture-backref",
  "source": "^[^'\"]*(?=(['\"])).*\\1(\\w+)\\1",
  "flags": "",
  "input": "  'foo' ",
  "op": "exec",
  "expected": {
   "match": [
    "  'foo'",
    "'",
    "foo"
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "negative-lookahead-capture-empty-match",
  "source": "(?!(\\d))|\\d",
  "flags": "",
  "input": "x",
  "op": "exec",
  "expected": {
   "match": [
    "",
    null
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "negative-lookahead-capture-with-alternation",
  "source": "(?!(\\d))|\\d",
  "flags": "",
  "input": "4",
  "op": "exec",
  "expected": {
   "match": [
    "4",
    null
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "nested-positive-negative-lookahead-captures",
  "source": "^(?=(x)(?!(y)))",
  "flags": "",
  "input": "xz",
  "op": "exec",
  "expected": {
   "match": [
    "",
    "x",
    null
   ],
   "index": 0
  },
  "v8Commit": "2de5de495fc3",
  "v8CommitSubject": "Irregexp: Backtrack past look-aheads works correctly. Allows backtracking to clear registers instead of pushing and popping them to restore state. Redo of 1135 with bug fixed.",
  "v8Test": "test/mjsunit/regexp-lookahead.js"
 },
 {
  "name": "loop-clears-captures-each-iteration",
  "source": "(?:(a)|(b)|(c))+",
  "flags": "",
  "input": "abc",
  "op": "exec",
  "expected": {
   "match": [
    "abc",
    null,
    null,
    "c"
   ],
   "index": 0
  },
  "v8Commit": "d6e6508bd703",
  "v8CommitSubject": "Added clearing of captures before entering the body of a loop.  This also revealed a bug or two that had to be fixed.",
  "v8Test": "test/mjsunit/regexp-loop-capture.js"
 },
 {
  "name": "star-clears-captures-each-iteration",
  "source": "(?:(a)|b)*",
  "flags": "",
  "input": "ab",
  "op": "exec",
  "expected": {
   "match": [
    "ab",
    null
   ],
   "index": 0
  },
  "v8Commit": "d6e6508bd703",
  "v8CommitSubject": "Added clearing of captures before entering the body of a loop.  This also revealed a bug or two that had to be fixed.",
  "v8Test": "test/mjsunit/regexp-loop-capture.js"
 },
 {
  "name": "modifiers-choice-node-emission",
  "source": "(?i:foo|bar)",
  "flags": "",
  "input": "BAr",
  "op": "test",
  "expected": true,
  "v8Commit": "72b0e27bd936",
  "v8CommitSubject": "[regexp] Fix modifiers for ChoiceNodes",
  "v8Test": "test/mjsunit/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-flags-reset-after-group-v-match",
  "source": "(?i:foo)[x-z]",
  "flags": "v",
  "input": "fOoz",
  "op": "test",
  "expected": true,
  "v8Commit": "19e7a57bce3e",
  "v8CommitSubject": "[regexp] Reset flags after resetting state in Parser",
  "v8Test": "test/mjsunit/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-flags-reset-after-group-v-nomatch",
  "source": "(?i:foo)[x-z]",
  "flags": "v",
  "input": "FooZ",
  "op": "test",
  "expected": false,
  "v8Commit": "19e7a57bce3e",
  "v8CommitSubject": "[regexp] Reset flags after resetting state in Parser",
  "v8Test": "test/mjsunit/regexp-modifiers.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "alternatives-with-few-distinct-chars-match",
  "source": "[ab]bbbc|[de]eeef",
  "flags": "",
  "input": "abbbcccc",
  "op": "test",
  "expected": true,
  "v8Commit": "a63b49495eac",
  "v8CommitSubject": "[regexp] Add new peephole optimization",
  "v8Test": "test/mjsunit/regexp-peephole.js"
 },
 {
  "name": "alternatives-with-few-distinct-chars-nomatch",
  "source": "[ab]bbbc|[de]eeef",
  "flags": "",
  "input": "dbbbc",
  "op": "test",
  "expected": false,
  "v8Commit": "a63b49495eac",
  "v8CommitSubject": "[regexp] Add new peephole optimization",
  "v8Test": "test/mjsunit/regexp-peephole.js"
 },
 {
  "name": "ci-alternation-dotless-i-not-equal-I",
  "source": "Ix|\\u0131|\\u0131cat",
  "flags": "i",
  "input": "\u0131x",
  "op": "exec",
  "expected": {
   "match": [
    "\u0131"
   ],
   "index": 0
  },
  "v8Commit": "daef0ec5f4ce",
  "v8CommitSubject": "Reland Extend big-disjunction optimization to case-independent regexps",
  "v8Test": "test/mjsunit/regexp-sort.js"
 },
 {
  "name": "ci-alternation-order-lowercase-first",
  "source": "a|Ax|acat",
  "flags": "i",
  "input": "ax",
  "op": "exec",
  "expected": {
   "match": [
    "a"
   ],
   "index": 0
  },
  "v8Commit": "daef0ec5f4ce",
  "v8CommitSubject": "Reland Extend big-disjunction optimization to case-independent regexps",
  "v8Test": "test/mjsunit/regexp-sort.js"
 },
 {
  "name": "ci-alternation-order-uppercase-first",
  "source": "Ax|a|acat",
  "flags": "i",
  "input": "ax",
  "op": "exec",
  "expected": {
   "match": [
    "ax"
   ],
   "index": 0
  },
  "v8Commit": "daef0ec5f4ce",
  "v8CommitSubject": "Reland Extend big-disjunction optimization to case-independent regexps",
  "v8Test": "test/mjsunit/regexp-sort.js",
  "note": "case-insensitive alternation pre-sorting must keep leftmost priority"
 },
 {
  "name": "ci-alternation-sharp-s-not-equal-S",
  "source": "Sx|\\u00df|\\u00dfcat",
  "flags": "i",
  "input": "\u00dfx",
  "op": "exec",
  "expected": {
   "match": [
    "\u00df"
   ],
   "index": 0
  },
  "v8Commit": "daef0ec5f4ce",
  "v8CommitSubject": "Reland Extend big-disjunction optimization to case-independent regexps",
  "v8Test": "test/mjsunit/regexp-sort.js"
 },
 {
  "name": "split-empty-pattern-v-flag-astral",
  "source": "(?:)",
  "flags": "v",
  "input": "\ud842\udfb7",
  "op": "split",
  "expected": [
   "\ud842\udfb7"
  ],
  "v8Commit": "427b57cefeab",
  "v8CommitSubject": "[regexp] Handle v-flag in RegExpSplit slow-path correctly",
  "v8Test": "test/mjsunit/regexp-split-v-flag.js"
 },
 {
  "name": "vi-intersection-single-char-first-operand",
  "source": "[K&&\\u{212a}]",
  "flags": "iv",
  "input": "k",
  "op": "test",
  "expected": true,
  "v8Commit": "9f8b21e1dda1",
  "v8CommitSubject": "[regexp] Fix case-insensitive unicode set operations",
  "v8Test": "test/mjsunit/regexp-unicode-sets.js",
  "note": "the first (single-character) operand must be closed over case before intersecting",
  "requiresNewerV8": true,
  "node22Result": false
 },
 {
  "name": "vi-intersection-word-minus-lowercase",
  "source": "[\\w&&[^a-z_]]",
  "flags": "iv",
  "input": "A",
  "op": "test",
  "expected": false,
  "v8Commit": "9f8b21e1dda1",
  "v8CommitSubject": "[regexp] Fix case-insensitive unicode set operations",
  "v8Test": "test/mjsunit/regexp-unicode-sets.js"
 },
 {
  "name": "vi-subtraction-kelvin-single-char",
  "source": "[K--\\u{212a}]",
  "flags": "iv",
  "input": "k",
  "op": "test",
  "expected": false,
  "v8Commit": "9f8b21e1dda1",
  "v8CommitSubject": "[regexp] Fix case-insensitive unicode set operations",
  "v8Test": "test/mjsunit/regexp-unicode-sets.js"
 },
 {
  "name": "boundary-before-nonword-at-start-fails",
  "source": "^\\b,",
  "flags": "",
  "input": ",",
  "op": "test",
  "expected": false,
  "v8Commit": "1a0bb5106988",
  "v8CommitSubject": "Fix bug in word-boundary-lookahead followed by end-of-input assertion.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "boundary-before-word-char-at-start",
  "source": "^\\bb",
  "flags": "",
  "input": "b",
  "op": "test",
  "expected": true,
  "v8Commit": "1a0bb5106988",
  "v8CommitSubject": "Fix bug in word-boundary-lookahead followed by end-of-input assertion.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "boundary-between-word-chars-in-classes",
  "source": "[,b]\\b[,b]",
  "flags": "",
  "input": "bb",
  "op": "test",
  "expected": false,
  "v8Commit": "1a0bb5106988",
  "v8CommitSubject": "Fix bug in word-boundary-lookahead followed by end-of-input assertion.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "class-space-dash-colon-dash-is-literal",
  "source": "[\\s-:]",
  "flags": "",
  "input": "-",
  "op": "test",
  "expected": true,
  "v8Commit": "6691d531ab29",
  "v8CommitSubject": "Revert 5911 (RegExp fail on invalid range syntax).",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "class-space-dash-digit-range-accepts-9",
  "source": "[\\s-0-9]",
  "flags": "",
  "input": "9",
  "op": "test",
  "expected": true,
  "v8Commit": "94bb378ee558",
  "v8CommitSubject": "Make RegExp character class match JSC. See http://trac.webkit.org/changeset/73594",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "class-space-dash-digit-range-rejects-1",
  "source": "[\\s-0-9]",
  "flags": "",
  "input": "1",
  "op": "test",
  "expected": false,
  "v8Commit": "94bb378ee558",
  "v8CommitSubject": "Make RegExp character class match JSC. See http://trac.webkit.org/changeset/73594",
  "v8Test": "test/mjsunit/regexp.js",
  "note": "parses as {\\s, \"-\", \"0\", \"-\", \"9\"}: the class atom before the dash makes it literal"
 },
 {
  "name": "control-escape-M-in-class",
  "source": "^[\\cM]$",
  "flags": "",
  "input": "\r",
  "op": "test",
  "expected": true,
  "v8Commit": "6bd6376588ba",
  "v8CommitSubject": "RegExp parser forgot to advance after reading \\c in character class. I.e., \\cM was interpreted as \\ccM.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "control-escape-M-in-class-not-M",
  "source": "^[\\cM]$",
  "flags": "",
  "input": "M",
  "op": "test",
  "expected": false,
  "v8Commit": "6bd6376588ba",
  "v8CommitSubject": "RegExp parser forgot to advance after reading \\c in character class. I.e., \\cM was interpreted as \\ccM.",
  "v8Test": "test/mjsunit/regexp.js",
  "note": "\\cM must not be read as \\ccM"
 },
 {
  "name": "control-escape-basic",
  "source": "\\ca",
  "flags": "",
  "input": "\u0001",
  "op": "test",
  "expected": true,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "control-escape-bracket-annexb",
  "source": "\\c[a/]",
  "flags": "",
  "input": "\\ca",
  "op": "test",
  "expected": true,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "control-escape-digit-in-class",
  "source": "^[\\c1]$",
  "flags": "",
  "input": "\u0011",
  "op": "test",
  "expected": true,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "control-escape-dollar-literal-in-class",
  "source": "^[\\c$]$",
  "flags": "",
  "input": "\u0004",
  "op": "test",
  "expected": false,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js",
  "note": "inside a class \\c$ is literal backslash, c, $"
 },
 {
  "name": "control-escape-lone-in-class-matches-backslash",
  "source": "^[\\c]]$",
  "flags": "",
  "input": "\\]",
  "op": "test",
  "expected": true,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "control-escape-lone-in-class-matches-c",
  "source": "^[\\c]]$",
  "flags": "",
  "input": "c]",
  "op": "test",
  "expected": true,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "control-escape-non-control-letter",
  "source": "\\ca",
  "flags": "",
  "input": "ca",
  "op": "test",
  "expected": false,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "control-escape-underscore-in-class",
  "source": "^[\\c_]$",
  "flags": "",
  "input": "\u001f",
  "op": "test",
  "expected": true,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "decimal-escape-overflow-becomes-octal",
  "source": "\\2147483648",
  "flags": "",
  "input": "\u008c7483648",
  "op": "exec",
  "expected": {
   "match": [
    "\u008c7483648"
   ],
   "index": 0
  },
  "v8Commit": "6e13e8ce374b",
  "v8CommitSubject": "Parsing a RegExp decimal escape could overflow, making an otherwise too large decimal escape be accepted as a capture index. We introduce a limit on the nubmer of allowed captures in a regexp, and break off parsing of the decimal escape at that point.",
  "v8Test": "test/mjsunit/regexp.js",
  "note": "Annex B: \\214 is an octal escape (0x8C) since there are no capture groups"
 },
 {
  "name": "end-anchor-inside-each-alternative",
  "source": "(?:a$|bc$)",
  "flags": "",
  "input": "zimzamzumbc",
  "op": "test",
  "expected": true,
  "v8Commit": "484b9df414b2",
  "v8CommitSubject": "Limit end-anchored regexps to testing end of string where possible.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "end-anchor-inside-each-alternative-nomatch",
  "source": "(?:a$|bc$)",
  "flags": "",
  "input": "c",
  "op": "test",
  "expected": false,
  "v8Commit": "484b9df414b2",
  "v8CommitSubject": "Limit end-anchored regexps to testing end of string where possible.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "end-anchored-alternation-empty-subject",
  "source": "(?:a|bc)g$",
  "flags": "",
  "input": "",
  "op": "test",
  "expected": false,
  "v8Commit": "484b9df414b2",
  "v8CommitSubject": "Limit end-anchored regexps to testing end of string where possible.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "end-anchored-alternation-search",
  "source": "(?:a|bc)g$",
  "flags": "",
  "input": "zimbcg",
  "op": "test",
  "expected": true,
  "v8Commit": "484b9df414b2",
  "v8CommitSubject": "Limit end-anchored regexps to testing end of string where possible.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "end-anchored-large-max-length",
  "source": "VeryLongRegExp!{1,1000}$",
  "flags": "",
  "input": "BahoolaVeryLongRegExp!!!!!!",
  "op": "test",
  "expected": true,
  "v8Commit": "f80da64d3688",
  "v8CommitSubject": "Use finite-length end-anchored regexps to reduce part of regexp that is searched.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "end-anchored-large-max-length-nomatch",
  "source": "VeryLongRegExp!{1,1000}$",
  "flags": "",
  "input": "VeryLongRegExp",
  "op": "test",
  "expected": false,
  "v8Commit": "f80da64d3688",
  "v8CommitSubject": "Use finite-length end-anchored regexps to reduce part of regexp that is searched.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "mutual-backrefs-anchored",
  "source": "a(.\\2)b(\\1)$",
  "flags": "",
  "input": "acbc",
  "op": "exec",
  "expected": {
   "match": [
    "acbc",
    "c",
    "c"
   ],
   "index": 0
  },
  "v8Commit": "44a8fec8a1d1",
  "v8CommitSubject": "[regexp] break recursion in mutually recursive capture/back references.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "mutual-backrefs-both-empty",
  "source": "(\\2)b(\\1)",
  "flags": "",
  "input": "aba",
  "op": "exec",
  "expected": {
   "match": [
    "b",
    "",
    ""
   ],
   "index": 1
  },
  "v8Commit": "44a8fec8a1d1",
  "v8CommitSubject": "[regexp] break recursion in mutually recursive capture/back references.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "mutual-backrefs-with-dots",
  "source": "(.\\2).(\\1)",
  "flags": "",
  "input": "aba",
  "op": "exec",
  "expected": {
   "match": [
    "aba",
    "a",
    "a"
   ],
   "index": 0
  },
  "v8Commit": "44a8fec8a1d1",
  "v8CommitSubject": "[regexp] break recursion in mutually recursive capture/back references.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "negated-class-space-dash-colon",
  "source": "[^\\s-:]",
  "flags": "",
  "input": "-",
  "op": "test",
  "expected": false,
  "v8Commit": "6691d531ab29",
  "v8CommitSubject": "Revert 5911 (RegExp fail on invalid range syntax).",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "non-boundary-at-end-of-word",
  "source": "b\\B$",
  "flags": "",
  "input": "b",
  "op": "test",
  "expected": false,
  "v8Commit": "1a0bb5106988",
  "v8CommitSubject": "Fix bug in word-boundary-lookahead followed by end-of-input assertion.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "non-boundary-between-word-and-comma",
  "source": "[,b]\\B[,b]",
  "flags": "",
  "input": "b,",
  "op": "test",
  "expected": false,
  "v8Commit": "1a0bb5106988",
  "v8CommitSubject": "Fix bug in word-boundary-lookahead followed by end-of-input assertion.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "nonwhitespace-class-rejects-linesep",
  "source": "\\S",
  "flags": "",
  "input": "\u2028",
  "op": "test",
  "expected": false,
  "v8Commit": "417a01accfd1",
  "v8CommitSubject": "Fix RegExp white-space character class to match BOMs.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "partially-end-anchored-alternation",
  "source": "(?:a|bc$)",
  "flags": "",
  "input": "zimzamzumba",
  "op": "exec",
  "expected": {
   "match": [
    "a"
   ],
   "index": 4
  },
  "v8Commit": "484b9df414b2",
  "v8CommitSubject": "Limit end-anchored regexps to testing end of string where possible.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quantified-lookahead-annexb-legal",
  "source": "(?=x)*x",
  "flags": "",
  "input": "x",
  "op": "test",
  "expected": true,
  "v8Commit": "9ec16dfe68b4",
  "v8CommitSubject": "Fix bug 1137. No longer allow the RegExp /(*)/.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quantifier-after-group-open-invalid",
  "source": "(*)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "9ec16dfe68b4",
  "v8CommitSubject": "Fix bug 1137. No longer allow the RegExp /(*)/.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quantifier-after-noncapture-open-invalid",
  "source": "(?:*)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "9ec16dfe68b4",
  "v8CommitSubject": "Fix bug 1137. No longer allow the RegExp /(*)/.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quantifier-huge-braces-no-throw",
  "source": "a{111111111111111111111111111111111111111111111}",
  "flags": "",
  "input": "b",
  "op": "test",
  "expected": false,
  "v8Commit": "0070e8c57293",
  "v8CommitSubject": "Fixed overflow bug in parsing of regexp repetitions.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quantifier-int32-overflow",
  "source": "a{2147483648}",
  "flags": "",
  "input": "b",
  "op": "test",
  "expected": false,
  "v8Commit": "0070e8c57293",
  "v8CommitSubject": "Fixed overflow bug in parsing of regexp repetitions.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quantifier-max-int32-exact",
  "source": "a{2147483647,2147483647}",
  "flags": "",
  "input": "a",
  "op": "test",
  "expected": false,
  "v8Commit": "0070e8c57293",
  "v8CommitSubject": "Fixed overflow bug in parsing of regexp repetitions.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quantifier-max-int32-range",
  "source": "a{1,2147483647}",
  "flags": "",
  "input": "a",
  "op": "test",
  "expected": true,
  "v8Commit": "0070e8c57293",
  "v8CommitSubject": "Fixed overflow bug in parsing of regexp repetitions.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quickcheck-mask-merge-choice",
  "source": "x([0-7]%%x|[0-6]%%y)",
  "flags": "",
  "input": "x7%%y",
  "op": "test",
  "expected": false,
  "v8Commit": "ab2d4bc9bfa5",
  "v8CommitSubject": "* Generate quick checks based on mask and compare for   the alternatives in a choice node.  The quick checks   are conservative in the sense that they only detect   failure with certainty.  Checks can do 2 or 4 characters   at a time. * Inline the quick checks to allow the alternatives to   be checked without branching in the common case where   they fail. Review URL: http://codereview.chromium.org/14194",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "quickcheck-mask-merge-with-backref",
  "source": "()x\\1(y([0-7]%%%x|[0-6]%%%y)|dkjasldkas)",
  "flags": "",
  "input": "xy7%%%y",
  "op": "test",
  "expected": false,
  "v8Commit": "ab2d4bc9bfa5",
  "v8CommitSubject": "* Generate quick checks based on mask and compare for   the alternatives in a choice node.  The quick checks   are conservative in the sense that they only detect   failure with certainty.  Checks can do 2 or 4 characters   at a time. * Inline the quick checks to allow the alternatives to   be checked without branching in the common case where   they fail. Review URL: http://codereview.chromium.org/14194",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "range-to-control-escape-in-class",
  "source": "^[Z-\\c-e]*$",
  "flags": "",
  "input": "Z[\\cde",
  "op": "test",
  "expected": true,
  "v8Commit": "90fd0ee89757",
  "v8CommitSubject": "Change interpretation of malformed \\c? escapes in RegExp to match JSC.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "split-does-not-split-surrogate-pair",
  "source": "[a-z]{0,1}",
  "flags": "u",
  "input": "\udaff\udfff",
  "op": "split",
  "expected": [
   "\udaff\udfff"
  ],
  "v8Commit": "6b3cd5804dc9",
  "v8CommitSubject": "[regexp] Fix incorrect range checks in AtSurrogatePair",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "split-non-pair-surrogate-then-private-use",
  "source": "[a-z]{0,1}",
  "flags": "u",
  "input": "\udaff\ue000",
  "op": "split",
  "expected": [
   "\udaff",
   "\ue000"
  ],
  "v8Commit": "6b3cd5804dc9",
  "v8CommitSubject": "[regexp] Fix incorrect range checks in AtSurrogatePair",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "whitespace-class-matches-bom",
  "source": "\\s",
  "flags": "",
  "input": "\ufeff",
  "op": "test",
  "expected": true,
  "v8Commit": "417a01accfd1",
  "v8CommitSubject": "Fix RegExp white-space character class to match BOMs.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "word-boundary-at-end",
  "source": "b\\b$",
  "flags": "",
  "input": "b",
  "op": "test",
  "expected": true,
  "v8Commit": "1a0bb5106988",
  "v8CommitSubject": "Fix bug in word-boundary-lookahead followed by end-of-input assertion.",
  "v8Test": "test/mjsunit/regexp.js"
 },
 {
  "name": "multi-unit-loop-body-full",
  "source": "(?:.z)+",
  "flags": "",
  "input": "azbz",
  "op": "exec",
  "expected": {
   "match": [
    "azbz"
   ],
   "index": 0
  },
  "v8Commit": "0ffaf7271ec2",
  "v8CommitSubject": "[regexp] Bail the consume scan on multi-unit loop bodies",
  "v8Test": "test/mjsunit/regexp/skip-until-consume-scan.js"
 },
 {
  "name": "multi-unit-loop-body-partial",
  "source": "(?:.z)+",
  "flags": "",
  "input": "xz yz zz",
  "op": "exec",
  "expected": {
   "match": [
    "xz"
   ],
   "index": 0
  },
  "v8Commit": "0ffaf7271ec2",
  "v8CommitSubject": "[regexp] Bail the consume scan on multi-unit loop bodies",
  "v8Test": "test/mjsunit/regexp/skip-until-consume-scan.js"
 },
 {
  "name": "open-bracket-inside-class-non-v",
  "source": "\\1[[]()",
  "flags": "",
  "input": "[",
  "op": "test",
  "expected": true,
  "v8Commit": "84c8c29136c0",
  "v8CommitSubject": "[regexp] Don't treat '[' special within a character class without /v",
  "v8Test": "test/mjsunit/regress-crbug-1374232.js"
 },
 {
  "name": "negated-class-astral-before-eol-nonunicode",
  "source": "[^!]$",
  "flags": "",
  "input": "\ud83d\udca9",
  "op": "test",
  "expected": true,
  "v8Commit": "fab5267e84a4",
  "v8CommitSubject": "[regexp] Fix bug in char class optimization",
  "v8Test": "test/mjsunit/regress/regexp-489358153.js"
 },
 {
  "name": "negated-class-astral-before-eol-unicode",
  "source": "[^!]$",
  "flags": "u",
  "input": "\ud83d\udca9",
  "op": "test",
  "expected": true,
  "v8Commit": "fab5267e84a4",
  "v8CommitSubject": "[regexp] Fix bug in char class optimization",
  "v8Test": "test/mjsunit/regress/regexp-489358153.js"
 },
 {
  "name": "positive-class-astral-before-eol",
  "source": "[!]$",
  "flags": "",
  "input": "\ud83d\udca9",
  "op": "test",
  "expected": false,
  "v8Commit": "fab5267e84a4",
  "v8CommitSubject": "[regexp] Fix bug in char class optimization",
  "v8Test": "test/mjsunit/regress/regexp-489358153.js"
 },
 {
  "name": "many-empty-groups-then-named",
  "source": "()()()()(?<aaaab>)1",
  "flags": "",
  "input": "111a1a",
  "op": "exec",
  "expected": {
   "match": [
    "1",
    "",
    "",
    "",
    "",
    ""
   ],
   "index": 0
  },
  "v8Commit": "5d5a659539bd",
  "v8CommitSubject": "[regexp] Fix invalid DCHECK in named capture logic",
  "v8Test": "test/mjsunit/regress/regress-1018592.js"
 },
 {
  "name": "split-end-anchor-no-empty-tail",
  "source": "$",
  "flags": "",
  "input": "a",
  "op": "split",
  "expected": [
   "a"
  ],
  "v8Commit": "51fcfd585c5f",
  "v8CommitSubject": "[regexp] Don't update last match info in @@split special case",
  "v8Test": "test/mjsunit/regress/regress-1075514.js"
 },
 {
  "name": "min-match-length-overflow-no-match",
  "source": "(A{9999999999}B|C*)*D",
  "flags": "",
  "input": "",
  "op": "exec",
  "expected": null,
  "v8Commit": "681f2951c606",
  "v8CommitSubject": "Regexp: Fix overflow in min-match-length calculation.  Crbug=126412. Review URL: https://chromiumcodereview.appspot.com/10384053",
  "v8Test": "test/mjsunit/regress/regress-126412.js"
 },
 {
  "name": "min-match-length-overflow-still-matches",
  "source": "(A{9999999999}B|C*)*",
  "flags": "",
  "input": "C",
  "op": "exec",
  "expected": {
   "match": [
    "C",
    "C"
   ],
   "index": 0
  },
  "v8Commit": "681f2951c606",
  "v8CommitSubject": "Regexp: Fix overflow in min-match-length calculation.  Crbug=126412. Review URL: https://chromiumcodereview.appspot.com/10384053",
  "v8Test": "test/mjsunit/regress/regress-126412.js"
 },
 {
  "name": "range-array-marker-value-class",
  "source": "[nyreekp\\W]",
  "flags": "isy",
  "input": "\u2603",
  "op": "exec",
  "expected": {
   "match": [
    "\u2603"
   ],
   "index": 0
  },
  "v8Commit": "bfa681ffb99a",
  "v8CommitSubject": "[regexp] Handle marker value 0x10ffff in MakeRangeArray",
  "v8Test": "test/mjsunit/regress/regress-1264508.js"
 },
 {
  "name": "huge-range-min-zero-empty-subject",
  "source": "\\u9999{0,4}",
  "flags": "",
  "input": "",
  "op": "test",
  "expected": true,
  "v8Commit": "afc9b8e9a9c5",
  "v8CommitSubject": "Fix optimization of Unicode regexp with ASCII subject to respect repeat counts. bug=131923 Review URL: http://codereview.chromium.org/10544093",
  "v8Test": "test/mjsunit/regress/regress-131923.js"
 },
 {
  "name": "huge-repeat-count-empty-subject",
  "source": "\\u9999{4}",
  "flags": "",
  "input": "",
  "op": "test",
  "expected": false,
  "v8Commit": "afc9b8e9a9c5",
  "v8CommitSubject": "Fix optimization of Unicode regexp with ASCII subject to respect repeat counts. bug=131923 Review URL: http://codereview.chromium.org/10544093",
  "v8Test": "test/mjsunit/regress/regress-131923.js"
 },
 {
  "name": "negated-empty-class-nested-quantifiers-v",
  "source": "^(([^]+?)*)$",
  "flags": "v",
  "input": "asdf",
  "op": "test",
  "expected": true,
  "v8Commit": "35f809a43a9a",
  "v8CommitSubject": "[regexp] Fix max_match for negated, empty class set expressions",
  "v8Test": "test/mjsunit/regress/regress-14333.js"
 },
 {
  "name": "negated-empty-class-star-v",
  "source": "^[^]*$",
  "flags": "v",
  "input": "\ud83e\udd2f",
  "op": "test",
  "expected": true,
  "v8Commit": "35f809a43a9a",
  "v8CommitSubject": "[regexp] Fix max_match for negated, empty class set expressions",
  "v8Test": "test/mjsunit/regress/regress-14333.js"
 },
 {
  "name": "named-replace-integer-like-name",
  "source": "(?<a>.)",
  "flags": "",
  "input": "a",
  "op": "replace",
  "expected": {
   "replacement": "$<0>",
   "result": ""
  },
  "v8Commit": "c522b362d5a7",
  "v8CommitSubject": "[regexp] Fix String.prototype.replace capture name lookup",
  "v8Test": "test/mjsunit/regress/regress-1505672.js",
  "replacement": "$<0>"
 },
 {
  "name": "optional-group-empty-iteration-rejected",
  "source": "(?:(?=(f)o)f??)?.",
  "flags": "",
  "input": "foo",
  "op": "exec",
  "expected": {
   "match": [
    "fo",
    "f"
   ],
   "index": 0
  },
  "v8Commit": "d6e6508bd703",
  "v8CommitSubject": "Added clearing of captures before entering the body of a loop.  This also revealed a bug or two that had to be fixed.",
  "v8Test": "test/mjsunit/regress/regress-176.js",
  "note": "an optional group that would match empty is rejected, forcing the lazy f?? to consume"
 },
 {
  "name": "optional-group-lookahead-capture-kept",
  "source": "(?:(?=(f)o)f)?o",
  "flags": "",
  "input": "foo",
  "op": "exec",
  "expected": {
   "match": [
    "fo",
    "f"
   ],
   "index": 0
  },
  "v8Commit": "d6e6508bd703",
  "v8CommitSubject": "Added clearing of captures before entering the body of a loop.  This also revealed a bug or two that had to be fixed.",
  "v8Test": "test/mjsunit/regress/regress-176.js"
 },
 {
  "name": "lookahead-capture-cleared-in-optional-group",
  "source": "(?:(?=(f)o)fx|).",
  "flags": "",
  "input": "foo",
  "op": "exec",
  "expected": {
   "match": [
    "f",
    null
   ],
   "index": 0
  },
  "v8Commit": "18c2d3ef4eaf",
  "v8CommitSubject": "Clears captures of look-aheads on backtrack. Reduces number of pushes when flushing a trace. Some are converted to clears in the undo-code instead, and some just ignored if they have no value worth restoring.",
  "v8Test": "test/mjsunit/regress/regress-187.js"
 },
 {
  "name": "ci-latin1-range-boundary-a-grave",
  "source": "[\\u00bf-\\u00c0]",
  "flags": "i",
  "input": "\u00e0",
  "op": "test",
  "expected": true,
  "v8Commit": "bfb1e9e70293",
  "v8CommitSubject": "Fix edge case for case independent regexp character classes. http://code.google.com/p/v8/issues/detail?id=2032 Review URL: https://chromiumcodereview.appspot.com/9860029",
  "v8Test": "test/mjsunit/regress/regress-2032.js"
 },
 {
  "name": "ci-latin1-range-boundary-excludes-neighbor",
  "source": "[\\u00bf-\\u00c0]",
  "flags": "i",
  "input": "\u00e1",
  "op": "test",
  "expected": false,
  "v8Commit": "bfb1e9e70293",
  "v8CommitSubject": "Fix edge case for case independent regexp character classes. http://code.google.com/p/v8/issues/detail?id=2032 Review URL: https://chromiumcodereview.appspot.com/9860029",
  "v8Test": "test/mjsunit/regress/regress-2032.js"
 },
 {
  "name": "ci-latin1-range-o-diaeresis-to-times",
  "source": "[\\u00d6-\\u00d7]",
  "flags": "i",
  "input": "\u00f6",
  "op": "test",
  "expected": true,
  "v8Commit": "bfb1e9e70293",
  "v8CommitSubject": "Fix edge case for case independent regexp character classes. http://code.google.com/p/v8/issues/detail?id=2032 Review URL: https://chromiumcodereview.appspot.com/9860029",
  "v8Test": "test/mjsunit/regress/regress-2032.js"
 },
 {
  "name": "ci-range-ending-at-A",
  "source": "[@-A]",
  "flags": "i",
  "input": "a",
  "op": "test",
  "expected": true,
  "v8Commit": "bfb1e9e70293",
  "v8CommitSubject": "Fix edge case for case independent regexp character classes. http://code.google.com/p/v8/issues/detail?id=2032 Review URL: https://chromiumcodereview.appspot.com/9860029",
  "v8Test": "test/mjsunit/regress/regress-2032.js"
 },
 {
  "name": "cs-range-ending-at-A",
  "source": "[@-A]",
  "flags": "",
  "input": "a",
  "op": "test",
  "expected": false,
  "v8Commit": "bfb1e9e70293",
  "v8CommitSubject": "Fix edge case for case independent regexp character classes. http://code.google.com/p/v8/issues/detail?id=2032 Review URL: https://chromiumcodereview.appspot.com/9860029",
  "v8Test": "test/mjsunit/regress/regress-2032.js"
 },
 {
  "name": "ci-backref-split-with-nul",
  "source": "(.)\\1",
  "flags": "i",
  "input": "aa\u1234\u0000",
  "op": "split",
  "expected": [
   "",
   "a",
   "\u1234\u0000"
  ],
  "v8Commit": "675d9b8a042d",
  "v8CommitSubject": "Add missing string length check in regexp engine.",
  "v8Test": "test/mjsunit/regress/regress-2172.js"
 },
 {
  "name": "replace-empty-pattern-global",
  "source": "(?:)",
  "flags": "g",
  "input": "foo",
  "op": "replace",
  "expected": {
   "replacement": "",
   "result": "foo"
  },
  "v8Commit": "b0e3ee6274aa",
  "v8CommitSubject": "Fix bug 225 in regexp replace with function.",
  "v8Test": "test/mjsunit/regress/regress-225.js",
  "replacement": ""
 },
 {
  "name": "noncapture-group-is-not-simple-atom",
  "source": "(?:text)",
  "flags": "",
  "input": "text",
  "op": "exec",
  "expected": {
   "match": [
    "text"
   ],
   "index": 0
  },
  "v8Commit": "4852bef23de4",
  "v8CommitSubject": "Issue 246 - wait until regexp is parsed to detect whether it's simple.",
  "v8Test": "test/mjsunit/regress/regress-246.js"
 },
 {
  "name": "backref-without-group-is-octal-escape",
  "source": "\\1[a]",
  "flags": "",
  "input": "\u0001a",
  "op": "test",
  "expected": true,
  "v8Commit": "3e4183472144",
  "v8CommitSubject": "Regexp parser: reset flag after scanning ahead for capture groups.",
  "v8Test": "test/mjsunit/regress/regress-2690.js"
 },
 {
  "name": "identity-escape-a",
  "source": "first\\asecond",
  "flags": "",
  "input": "firstasecond",
  "op": "test",
  "expected": true,
  "v8Commit": "978f41a1da57",
  "v8CommitSubject": "RegExpParser: Fix Reset()ting to the end.",
  "v8Test": "test/mjsunit/regress/regress-3756.js"
 },
 {
  "name": "identity-escape-lone-u",
  "source": "\\u",
  "flags": "",
  "input": "u",
  "op": "test",
  "expected": true,
  "v8Commit": "978f41a1da57",
  "v8CommitSubject": "RegExpParser: Fix Reset()ting to the end.",
  "v8Test": "test/mjsunit/regress/regress-3756.js"
 },
 {
  "name": "identity-escape-u-at-end-not-backslash",
  "source": "first\\u",
  "flags": "",
  "input": "first\\u",
  "op": "test",
  "expected": false,
  "v8Commit": "978f41a1da57",
  "v8CommitSubject": "RegExpParser: Fix Reset()ting to the end.",
  "v8Test": "test/mjsunit/regress/regress-3756.js"
 },
 {
  "name": "identity-escape-u-partial-hex",
  "source": "first\\u123second",
  "flags": "",
  "input": "firstu123second",
  "op": "test",
  "expected": true,
  "v8Commit": "978f41a1da57",
  "v8CommitSubject": "RegExpParser: Fix Reset()ting to the end.",
  "v8Test": "test/mjsunit/regress/regress-3756.js"
 },
 {
  "name": "modifiers-quickcheck-disable-in-alternative",
  "source": "(?-i:a)|b",
  "flags": "i",
  "input": "B",
  "op": "test",
  "expected": true,
  "v8Commit": "2bbd72570e60",
  "v8CommitSubject": "[regexp] Fix QuickCheck with modifiers",
  "v8Test": "test/mjsunit/regress/regress-377820802.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "modifiers-quickcheck-enable-in-alternative",
  "source": "(?i:a)|b",
  "flags": "",
  "input": "B",
  "op": "test",
  "expected": false,
  "v8Commit": "2bbd72570e60",
  "v8CommitSubject": "[regexp] Fix QuickCheck with modifiers",
  "v8Test": "test/mjsunit/regress/regress-377820802.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "parser-position-at-surrogate-pair",
  "source": "\\1\ud83d\ude0a()",
  "flags": "u",
  "input": "\ud83d\ude0a",
  "op": "test",
  "expected": true,
  "v8Commit": "743e7262f9cc",
  "v8CommitSubject": "[regexp] Parser: Fix position() at surrogate pair",
  "v8Test": "test/mjsunit/regress/regress-384605103.js",
  "note": "backref directly followed by a surrogate pair, before any capture group has been parsed",
  "requiresNewerV8": true,
  "node22Result": false
 },
 {
  "name": "modifiers-loop-choice-analysis",
  "source": "(?i:[A-Z]{10})",
  "flags": "",
  "input": "abcdefghijklmn",
  "op": "test",
  "expected": true,
  "v8Commit": "364bd41649bc",
  "v8CommitSubject": "[regexp] Fix flags during LoopChoice Analysis",
  "v8Test": "test/mjsunit/regress/regress-388068045.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "lookbehind-alternative-order-empty-last",
  "source": "(?<=(ba|a|))c",
  "flags": "",
  "input": "bac",
  "op": "exec",
  "expected": {
   "match": [
    "c",
    "ba"
   ],
   "index": 2
  },
  "v8Commit": "9afafebf59f4",
  "v8CommitSubject": "[regexp] Fix common prefix extraction when reading backwards",
  "v8Test": "test/mjsunit/regress/regress-388290816.js",
  "note": "the V8 fix was reverted (215260306ab) and its test deleted; V8 still evaluates lookbehind alternatives out of source order. Expected is spec-correct: alternatives are tried left to right, so \"ba\" wins.",
  "requiresNewerV8": true,
  "node22Result": {
   "match": [
    "c",
    "a"
   ],
   "index": 2
  }
 },
 {
  "name": "lookbehind-alternative-order-first-alternative-wins",
  "source": "(?<=(f|xy|xf|ay|abcdef|))g",
  "flags": "",
  "input": "abcdefg",
  "op": "exec",
  "expected": {
   "match": [
    "g",
    "f"
   ],
   "index": 6
  },
  "v8Commit": "9afafebf59f4",
  "v8CommitSubject": "[regexp] Fix common prefix extraction when reading backwards",
  "v8Test": "test/mjsunit/regress/regress-388290816.js",
  "note": "the V8 fix was reverted; V8 returns capture \"abcdef\". Expected is spec-correct.",
  "requiresNewerV8": true,
  "node22Result": {
   "match": [
    "g",
    "abcdef"
   ],
   "index": 6
  }
 },
 {
  "name": "lookbehind-alternative-order-same-first-char",
  "source": "(?<=(xy|xf|f|ay|abcdef|))g",
  "flags": "",
  "input": "abcdexfg",
  "op": "exec",
  "expected": {
   "match": [
    "g",
    "xf"
   ],
   "index": 7
  },
  "v8Commit": "9afafebf59f4",
  "v8CommitSubject": "[regexp] Fix common prefix extraction when reading backwards",
  "v8Test": "test/mjsunit/regress/regress-388290816.js",
  "note": "the V8 fix was reverted; V8 returns capture \"f\". Expected is spec-correct.",
  "requiresNewerV8": true,
  "node22Result": {
   "match": [
    "g",
    "f"
   ],
   "index": 7
  }
 },
 {
  "name": "ci-cyrillic-mixed-ascii-range",
  "source": "^[\\u0430-\\u044fa-z]+$",
  "flags": "i",
  "input": "\u0422\u0435\u0441\u0442",
  "op": "test",
  "expected": true,
  "v8Commit": "57c919e414ef",
  "v8CommitSubject": "Fix bug 486, Cyrillic character ranges in case independent regexps. http://code.google.com/p/v8/issues/detail?id=486 Review URL: http://codereview.chromium.org/361033",
  "v8Test": "test/mjsunit/regress/regress-486.js"
 },
 {
  "name": "ciu-digit-then-word-kelvin",
  "source": "\\d\\w",
  "flags": "iu",
  "input": "1\u212a",
  "op": "exec",
  "expected": {
   "match": [
    "1\u212a"
   ],
   "index": 0
  },
  "v8Commit": "5d93296a5c8c",
  "v8CommitSubject": "[regexp] fix /ui regexp desugaring for text nodes.",
  "v8Test": "test/mjsunit/regress/regress-5036.js"
 },
 {
  "name": "modifiers-choice-node-analysis",
  "source": "(?i:x|[a-f])",
  "flags": "",
  "input": "F",
  "op": "test",
  "expected": true,
  "v8Commit": "e540e1161b02",
  "v8CommitSubject": "[regexp] Fix modifiers for ChoiceNodes during Analysis",
  "v8Test": "test/mjsunit/regress/regress-510487690.js",
  "requiresNewerV8": true,
  "node22Result": "SyntaxError"
 },
 {
  "name": "matchall-lookbehind-lone-lead-surrogate-boundaries",
  "source": "(?<=[\\s\\S])",
  "flags": "gsu",
  "input": "A\ud800",
  "op": "matchAll",
  "expected": [
   {
    "match": [
     ""
    ],
    "index": 1
   },
   {
    "match": [
     ""
    ],
    "index": 2
   }
  ],
  "v8Commit": "ebed2499f45a",
  "v8CommitSubject": "[regexp] Fix Unicode search loops inside surrogate pairs",
  "v8Test": "test/mjsunit/regress/regress-516455365.js"
 },
 {
  "name": "matchall-negative-lookahead-v-code-point-boundaries",
  "source": "(?!.)",
  "flags": "gv",
  "input": "\ud83d\ude00\ud83d\ude00\ud83d\ude00",
  "op": "matchAll",
  "expected": [
   {
    "match": [
     ""
    ],
    "index": 6
   }
  ],
  "v8Commit": "ebed2499f45a",
  "v8CommitSubject": "[regexp] Fix Unicode search loops inside surrogate pairs",
  "v8Test": "test/mjsunit/regress/regress-516455365.js",
  "requiresNewerV8": true,
  "node22Result": [
   {
    "match": [
     ""
    ],
    "index": 1
   },
   {
    "match": [
     ""
    ],
    "index": 3
   },
   {
    "match": [
     ""
    ],
    "index": 5
   },
   {
    "match": [
     ""
    ],
    "index": 6
   }
  ]
 },
 {
  "name": "matchall-negative-lookbehind-v-code-point-boundaries",
  "source": "(?<!.)",
  "flags": "gv",
  "input": "\ud83d\ude00\ud83d\ude00\ud83d\ude00",
  "op": "matchAll",
  "expected": [
   {
    "match": [
     ""
    ],
    "index": 0
   }
  ],
  "v8Commit": "ebed2499f45a",
  "v8CommitSubject": "[regexp] Fix Unicode search loops inside surrogate pairs",
  "v8Test": "test/mjsunit/regress/regress-516455365.js",
  "note": "zero-length global search must only land on code point boundaries in /v (and /u) mode",
  "requiresNewerV8": true,
  "node22Result": [
   {
    "match": [
     ""
    ],
    "index": 0
   },
   {
    "match": [
     ""
    ],
    "index": 3
   },
   {
    "match": [
     ""
    ],
    "index": 5
   }
  ]
 },
 {
  "name": "ci-quantified-group-with-class-onebyte",
  "source": "(a[\\u1000A])+",
  "flags": "i",
  "input": "aa",
  "op": "test",
  "expected": true,
  "v8Commit": "a51f429772d1",
  "v8CommitSubject": "[regexp] Fix case-insensitive matching for one-byte subjects.",
  "v8Test": "test/mjsunit/regress/regress-5199.js"
 },
 {
  "name": "class-range-6-to-9-quickcheck",
  "source": "[6-9]",
  "flags": "",
  "input": "2",
  "op": "test",
  "expected": false,
  "v8Commit": "e2a01ed4fb96",
  "v8CommitSubject": "Fix regexp bug reported by Ian where [6-9] would match any digit. Review URL: http://codereview.chromium.org/140021",
  "v8Test": "test/mjsunit/regress/regress-6-9-regexp.js"
 },
 {
  "name": "match-emoji-alternation-not-split-pairs",
  "source": "\\u{1F364}|\\u{1F366}|\\u03c0|\\u{1F34B}",
  "flags": "gu",
  "input": "\ud83c\udf64\ud83c\udf66\ud83c\udf4b\u03c0\u03c0\ud83c\udf4b\ud83c\udf66\ud83c\udf64",
  "op": "match",
  "expected": [
   "\ud83c\udf64",
   "\ud83c\udf66",
   "\ud83c\udf4b",
   "\u03c0",
   "\u03c0",
   "\ud83c\udf4b",
   "\ud83c\udf66",
   "\ud83c\udf64"
  ],
  "v8Commit": "4635572471b2",
  "v8CommitSubject": "[regexp] Consider surrogate pairs when optimizing disjunctions",
  "v8Test": "test/mjsunit/regress/regress-641091.js"
 },
 {
  "name": "match-emoji-two-alternatives",
  "source": "\\u{1F364}|\\u{1F366}",
  "flags": "gu",
  "input": "\ud83c\udf64\ud83c\udf66\ud83c\udf4b\u03c0\u03c0\ud83c\udf4b\ud83c\udf66\ud83c\udf64",
  "op": "match",
  "expected": [
   "\ud83c\udf64",
   "\ud83c\udf66",
   "\ud83c\udf66",
   "\ud83c\udf64"
  ],
  "v8Commit": "4635572471b2",
  "v8CommitSubject": "[regexp] Consider surrogate pairs when optimizing disjunctions",
  "v8Test": "test/mjsunit/regress/regress-641091.js"
 },
 {
  "name": "lookbehind-caret-multiline-not-before-start",
  "source": ".(?<!^.)",
  "flags": "m",
  "input": "foobar",
  "op": "exec",
  "expected": {
   "match": [
    "o"
   ],
   "index": 1
  },
  "v8Commit": "1990b1e14e81",
  "v8CommitSubject": "[regexp] Dont attempt to match '^' before the start of the string",
  "v8Test": "test/mjsunit/regress/regress-996391.js"
 },
 {
  "name": "lookbehind-nonword-boundary-not-before-start",
  "source": ".(?<!\\B.)",
  "flags": "m",
  "input": "foobar",
  "op": "exec",
  "expected": {
   "match": [
    "f"
   ],
   "index": 0
  },
  "v8Commit": "1990b1e14e81",
  "v8CommitSubject": "[regexp] Dont attempt to match '^' before the start of the string",
  "v8Test": "test/mjsunit/regress/regress-996391.js"
 },
 {
  "name": "lookbehind-word-boundary-not-before-start",
  "source": ".(?<!\\b.)",
  "flags": "m",
  "input": "foobar",
  "op": "exec",
  "expected": {
   "match": [
    "o"
   ],
   "index": 1
  },
  "v8Commit": "1990b1e14e81",
  "v8CommitSubject": "[regexp] Dont attempt to match '^' before the start of the string",
  "v8Test": "test/mjsunit/regress/regress-996391.js"
 },
 {
  "name": "capture-scan-inside-character-class",
  "source": "[\\k(]\\1",
  "flags": "",
  "input": "ab(\u0001cd",
  "op": "exec",
  "expected": {
   "match": [
    "(\u0001"
   ],
   "index": 2
  },
  "v8Commit": "55374d16ba66",
  "v8CommitSubject": "[regexp] Fix ScanForCaptures when invoked inside a character class.",
  "v8Test": "test/mjsunit/regress/regress-crbug-1254704.js"
 },
 {
  "name": "split-lookahead-v-flag-astral",
  "source": "(?=.)",
  "flags": "v",
  "input": "f\ud83d\udca9ba\u2603",
  "op": "split",
  "expected": [
   "f",
   "\ud83d\udca9",
   "b",
   "a",
   "\u2603"
  ],
  "v8Commit": "c3c1780ef7c0",
  "v8CommitSubject": "[regexp] Fix RegExp.p.split with unicode sets",
  "v8Test": "test/mjsunit/regress/regress-crbug-1416395.js",
  "note": "adapted: the original also set lastIndex and a split limit; the core check is /v-aware index advancement in split"
 },
 {
  "name": "match-global-empty-alternation-count",
  "source": "(_)|(_|)",
  "flags": "g",
  "input": "What are you looking for?",
  "op": "match",
  "expected": [
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   "",
   ""
  ],
  "v8Commit": "960b1af12fcc",
  "v8CommitSubject": "Fix wrong indexing in global regexp.",
  "v8Test": "test/mjsunit/regress/regress-crbug-142087.js"
 },
 {
  "name": "vset-negated-any-in-class-empty",
  "source": "[\\P{Any}]",
  "flags": "v",
  "input": "undefined",
  "op": "test",
  "expected": false,
  "v8Commit": "cb8697b04426",
  "v8CommitSubject": "Reland \"[regexp] Handle empty ranges in unicode sets\"",
  "v8Test": "test/mjsunit/regress/regress-crbug-1437346.js"
 },
 {
  "name": "vset-negation-flag-of-cached-expression",
  "source": "^(?:\\.[^@])+$",
  "flags": "v",
  "input": ".a",
  "op": "exec",
  "expected": {
   "match": [
    ".a"
   ],
   "index": 0
  },
  "v8Commit": "9f1160e1ea6f",
  "v8CommitSubject": "[regexp] Updated negated flag for cached set expressions",
  "v8Test": "test/mjsunit/regress/regress-crbug-1454482.js"
 },
 {
  "name": "lookbehind-long-fixed-quickcheck-cleared",
  "source": "(?<=12345123451234512345)",
  "flags": "",
  "input": "12345123451234512345",
  "op": "test",
  "expected": true,
  "v8Commit": "65d3009e0321",
  "v8CommitSubject": "[regexp] clear QuickCheckDetails for backward reads.",
  "v8Test": "test/mjsunit/regress/regress-crbug-570241.js"
 },
 {
  "name": "negated-astral-ranges-boundary-one",
  "source": "[^\\u{1}-\\u{1000}\\u{1002}-\\u{2000}]",
  "flags": "u",
  "input": "\u0001",
  "op": "test",
  "expected": false,
  "v8Commit": "f9d7c711afe0",
  "v8CommitSubject": "[regexp] Fix off-by-one in CharacterRange::Negate.",
  "v8Test": "test/mjsunit/regress/regress-crbug-592343.js"
 },
 {
  "name": "negated-astral-ranges-boundary-zero",
  "source": "[^\\u{1}-\\u{1000}\\u{1002}-\\u{2000}]",
  "flags": "u",
  "input": "\u0000",
  "op": "test",
  "expected": true,
  "v8Commit": "f9d7c711afe0",
  "v8CommitSubject": "[regexp] Fix off-by-one in CharacterRange::Negate.",
  "v8Test": "test/mjsunit/regress/regress-crbug-592343.js"
 },
 {
  "name": "negated-astral-ranges-gap",
  "source": "[^\\u{1}-\\u{1000}\\u{1002}-\\u{2000}]",
  "flags": "u",
  "input": "\u1001",
  "op": "test",
  "expected": true,
  "v8Commit": "f9d7c711afe0",
  "v8CommitSubject": "[regexp] Fix off-by-one in CharacterRange::Negate.",
  "v8Test": "test/mjsunit/regress/regress-crbug-592343.js"
 },
 {
  "name": "empty-class-never-matches",
  "source": "[]*1",
  "flags": "u",
  "input": "\u1234",
  "op": "exec",
  "expected": null,
  "v8Commit": "6f67d171f100",
  "v8CommitSubject": "[regexp] Fix non-match and max match length in RegExpCharacterClass.",
  "v8Test": "test/mjsunit/regress/regress-crbug-605862.js"
 },
 {
  "name": "ci-ascii-range-locale-independent",
  "source": "[a-z]+",
  "flags": "gi",
  "input": "HIJK",
  "op": "match",
  "expected": [
   "HIJK"
  ],
  "v8Commit": "9bcacf60f817",
  "v8CommitSubject": "Fix character ranges in case insensitive regexp",
  "v8Test": "test/mjsunit/regress/regress-crbug-971383.js"
 },
 {
  "name": "lookbehind-negated-class-loop-cp-advance",
  "source": "(?<=a[^b]*).",
  "flags": "",
  "input": "a",
  "op": "exec",
  "expected": null,
  "v8Commit": "aedc824a9ec5",
  "v8CommitSubject": "[regexp] Fix CP advancement in all SKIP_* bytecodes",
  "v8Test": "test/mjsunit/regress/regress-v8-10072.js"
 },
 {
  "name": "k-in-class-with-named-group-invalid",
  "source": "[\\k](?<a>)",
  "flags": "",
  "input": "",
  "op": "construct-error",
  "expected": "SyntaxError",
  "v8Commit": "8965d90362ae",
  "v8CommitSubject": "Reland \"[regexp] Reorganize and deduplicate in the regexp parser\"",
  "v8Test": "test/mjsunit/regress/regress-v8-10602.js"
 },
 {
  "name": "lookahead-loop-eats-at-least",
  "source": "(z(?=.)){2}",
  "flags": "",
  "input": "zzz",
  "op": "exec",
  "expected": {
   "match": [
    "zz",
    "z"
   ],
   "index": 0
  },
  "v8Commit": "59e218c84043",
  "v8CommitSubject": "[regexp] Don't propagate lookaround eats_at_least to surroundings",
  "v8Test": "test/mjsunit/regress/regress-v8-11290.js"
 },
 {
  "name": "lookbehind-backwards-loop-eats-at-least",
  "source": "x(?<=^x{4})",
  "flags": "",
  "input": "xxxx",
  "op": "exec",
  "expected": {
   "match": [
    "x"
   ],
   "index": 3
  },
  "v8Commit": "c977b65bb9f8",
  "v8CommitSubject": "[regexp] Don't use eats_at_least for backwards loops",
  "v8Test": "test/mjsunit/regress/regress-v8-11616.js"
 },
 {
  "name": "negated-class-desugar-astral-unicode",
  "source": "^a[^a]$",
  "flags": "u",
  "input": "a\ud83c\udf10",
  "op": "test",
  "expected": true,
  "v8Commit": "440a0829f762",
  "v8CommitSubject": "[regexp] Properly consider negated character classes for desugaring",
  "v8Test": "test/mjsunit/regress/regress-v8-13097.js"
 },
 {
  "name": "lone-surrogate-range-does-not-match-pair",
  "source": "[\\ud800-\\udfff]+",
  "flags": "u",
  "input": "\ud801\udc0f",
  "op": "test",
  "expected": false,
  "v8Commit": "dd92fe999b27",
  "v8CommitSubject": "[regexp] Fix wrong match of lone surrogates",
  "v8Test": "test/mjsunit/regress/regress-v8-13410.js"
 },
 {
  "name": "surrogates-split-by-empty-backref-do-not-pair",
  "source": "(\\ud801\\1\\udc0f)",
  "flags": "u",
  "input": "\ud801\udc0f",
  "op": "test",
  "expected": false,
  "v8Commit": "dd92fe999b27",
  "v8CommitSubject": "[regexp] Fix wrong match of lone surrogates",
  "v8Test": "test/mjsunit/regress/regress-v8-13410.js"
 },
 {
  "name": "surrogates-split-by-optional-backref-do-not-pair",
  "source": "(\\ud801\\1?\\udc0f)",
  "flags": "u",
  "input": "\ud801\udc0f",
  "op": "test",
  "expected": false,
  "v8Commit": "dd92fe999b27",
  "v8CommitSubject": "[regexp] Fix wrong match of lone surrogates",
  "v8Test": "test/mjsunit/regress/regress-v8-13410.js"
 },
 {
  "name": "surrogates-split-by-zero-count-backref-do-not-pair",
  "source": "(\\ud801\\1{0}\\udc0f)",
  "flags": "u",
  "input": "\ud801\udc0f",
  "op": "test",
  "expected": false,
  "v8Commit": "dd92fe999b27",
  "v8CommitSubject": "[regexp] Fix wrong match of lone surrogates",
  "v8Test": "test/mjsunit/regress/regress-v8-13410.js"
 },
 {
  "name": "split-sticky-regexp",
  "source": "-",
  "flags": "y",
  "input": "a-b-c",
  "op": "split",
  "expected": [
   "a",
   "b",
   "c"
  ],
  "v8Commit": "27fd52abad7d",
  "v8CommitSubject": "[regexp] Send sticky @@splits to the slow path",
  "v8Test": "test/mjsunit/regress/regress-v8-6706.js"
 },
 {
  "name": "ci-class-y-diaeresis-early-abort",
  "source": "[\\u0178Y]",
  "flags": "i",
  "input": "\u00ff",
  "op": "test",
  "expected": true,
  "v8Commit": "8016f309e700",
  "v8CommitSubject": "[regexp] Fix a bug causing early aborts from AddCaseEquivalents",
  "v8Test": "test/mjsunit/regress/regress-v8-6940.js"
 },
 {
  "name": "ciu-class-y-diaeresis-many",
  "source": "[Y\\u00dd\\u0178\\u0176\\u1ef2]",
  "flags": "iu",
  "input": "\u00ff",
  "op": "test",
  "expected": true,
  "v8Commit": "8016f309e700",
  "v8CommitSubject": "[regexp] Fix a bug causing early aborts from AddCaseEquivalents",
  "v8Test": "test/mjsunit/regress/regress-v8-6940.js"
 },
 {
  "name": "boyer-moore-with-lookahead-submatch",
  "source": "^.*?Y((?=X?).)*Y$",
  "flags": "s",
  "input": "YABCY",
  "op": "exec",
  "expected": {
   "match": [
    "YABCY",
    "C"
   ],
   "index": 0
  },
  "v8Commit": "bc4cbe927a8e",
  "v8CommitSubject": "[regexp] Fix BoyerMooreLookahead behavior at submatches",
  "v8Test": "test/mjsunit/regress/regress-v8-8770.js"
 },
 {
  "name": "replace-uc16-class-global-remove",
  "source": "[\\u1234a-z]",
  "flags": "g",
  "input": "\u12340b1c2d3\u12340b1c2d3",
  "op": "replace",
  "expected": {
   "replacement": "",
   "result": "01230123"
  },
  "v8Commit": "7b521af10536",
  "v8CommitSubject": "Fix crash: handle all flat string types in regexp replace.",
  "v8Test": "test/mjsunit/string-replace-with-empty.js",
  "replacement": ""
 },
 {
  "name": "replace-dollar-substitution-mix",
  "source": "(.)(?=(.))",
  "flags": "g",
  "input": "abc",
  "op": "replace",
  "expected": {
   "replacement": "[$$$$$$1$$$$$11$01$2$21$02$020$002$3$03]",
   "result": "[$$$1$$a1abb1bb0$002$3$03][$$$1$$b1bcc1cc0$002$3$03]c"
  },
  "v8Commit": "0adfe842a515",
  "v8CommitSubject": "Fix incorrect handling of global RegExp properties for nested replace-regexp-with-function.",
  "v8Test": "test/mjsunit/string-replace.js",
  "replacement": "[$$$$$$1$$$$$11$01$2$21$02$020$002$3$03]"
 },
 {
  "name": "class-digit-dash-letter-anchored",
  "source": "^[\\d-a]",
  "flags": "",
  "input": "-things",
  "op": "exec",
  "expected": {
   "match": [
    "-"
   ],
   "index": 0
  },
  "v8Commit": "6691d531ab29",
  "v8CommitSubject": "Revert 5911 (RegExp fail on invalid range syntax).",
  "v8Test": "test/mjsunit/third_party/regexp-pcre.js"
 },
 {
  "name": "class-digit-dash-letter-is-union",
  "source": "[\\d-z]+",
  "flags": "",
  "input": "12-34z",
  "op": "exec",
  "expected": {
   "match": [
    "12-34z"
   ],
   "index": 0
  },
  "v8Commit": "6691d531ab29",
  "v8CommitSubject": "Revert 5911 (RegExp fail on invalid range syntax).",
  "v8Test": "test/mjsunit/third_party/regexp-pcre.js"
 }
];
