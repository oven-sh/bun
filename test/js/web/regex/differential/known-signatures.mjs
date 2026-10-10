// Signatures of KNOWN live engine divergences (bun/JSC vs V8), used by the
// live differential test to tell "a random case hit a known bug" apart from
// "a random case found something NEW". Each signature is a predicate over the
// case's source/flags plus the two engines' JSON records. Keep this list in
// sync with test/js/third_party/v8-regexp/KNOWN-DIVERGENCES.md; when an engine
// bug is fixed its signature should be removed so a reappearance fails loudly.

const hasAstral = source => /[\u{10000}-\u{10FFFF}]/u.test(source);
const unicodeMode = flags => /[uv]/.test(flags);

export const knownSignatures = [
  {
    id: "optional-group-only-caret (#9)",
    // an optional/quantified group whose FIRST term is ^ (including a group
    // holding only ^), e.g. /(?:^)?a/, /(^)*x/, /$(^b.)?/
    test: ({ source }) =>
      /\((\?<[^>]+>|\?:)?\^[^)]*\)[?*]/.test(source) || /\((\?<[^>]+>|\?:)?\^\)\+/.test(source) || /\\B\(\?:\^/.test(source),
  },
  {
    id: "astral-alternative-lost (#10)",
    test: ({ source, flags }) => hasAstral(source) && unicodeMode(flags) && /\|/.test(source),
  },
  {
    id: "v-mode-lookbehind-code-point-step (#5)",
    test: ({ source, flags }) => unicodeMode(flags) && /\(\?<[=!]/.test(source),
  },
  {
    id: "u-mode-empty-match-position (#12)",
    test: ({ source, flags, oracle, under }) =>
      unicodeMode(flags) && /"match":\[""[,\]]/.test(oracle) && /"match":\[""[,\]]/.test(under),
  },
  {
    id: "empty-iteration-capture (#7)",
    test: ({ source, oracle, under }) =>
      /\{0,|\{1,|\*|\?/.test(source) && /,""[,\]]/.test(under) && /,null[,\]]/.test(oracle),
  },
  {
    id: "caret-alternative-interp-leftmost (#3)",
    test: ({ source, flags }) => /(^|\|)\^/.test(source) && !/[my]/.test(flags),
  },
  {
    id: "plus-loop-counted-capture (#8)",
    test: ({ source }) => /\)\+/.test(source) && /\{\d+,\}/.test(source),
  },
  {
    id: "match-end-wraparound (#11)",
    test: ({ under }) => /lastIndex":1844674407/.test(under),
  },
  {
    id: "v-mode-fold-before-subtract (#1)",
    test: ({ source, flags }) => /v/.test(flags) && /i/.test(flags) && /--/.test(source),
  },
];

export function classifyDivergence(caseInfo) {
  for (const sig of knownSignatures) {
    try {
      if (sig.test(caseInfo)) return sig.id;
    } catch {
      // signature predicates are best-effort
    }
  }
  return null;
}
