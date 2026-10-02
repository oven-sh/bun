// Cross-product regression matrix.
//
// Where the pinned reproducers in regressions.mjs are individual bugs, this
// enumerates whole FAMILIES around the dimensions that produced this
// project's divergences, so a fix on one axis is checked across every other.
// Expectations are never hand-written: run under node to produce the oracle
// (`node differential/matrix.mjs --emit`), and the test asserts the engine
// under test reproduces node's canonical output for every generated case.
//
// Dimensions (each one was load-bearing in at least one real bug):
//   - first alternative: astral literal, astral class, BMP literal, wide BMP
//   - a following alternative's leading term: literal / class / inverted class /
//     dot / min-0 quantified literal or class / backreference
//   - minimum-size relation between alternatives: less / equal / greater
//   - subject prefix before the astral: none, "-", "_", "--", "x", "😀"
//   - flags: "", "u", "iu", "v", plus g/y iteration for a subset
//   - lookbehind wrappers of the same shapes (the Stage-D territory)

const ASTRAL = ["\u{1F600}", "\u{1F436}", "\u{10400}"]; // grinning, dog, Deseret capital
const G = ASTRAL[0];

// A following alternative, parameterised so its minimum size can be tuned.
// `min` is the alternative's minimum length; `lead` its first term.
const LEADS = [
  { name: "lit", term: "-" },
  { name: "lit-other", term: "q" },
  { name: "class", term: "[-x]" },
  { name: "class-nomatch", term: "[qz]" },
  { name: "neg-class", term: "[^y]" },
  { name: "dot", term: "." },
  { name: "wordclass", term: "\\w" },
  { name: "opt-lit", term: "-?" },
  { name: "star-lit", term: "-*" },
  { name: "plus-lit", term: "-+" },
  { name: "opt-class", term: "[-x]?" },
  { name: "lazy-opt", term: "-??" },
];

const FIRSTS = [
  { name: "astral", src: G },
  { name: "astral2", src: G + G },
  { name: "astral-class", src: "[" + G + ASTRAL[1] + "]" },
  { name: "bmp", src: "z" },
  { name: "bmp2", src: "zw" },
];

const PREFIXES = ["", "-", "_", "--", "x", G, "-".repeat(4)];
const FLAG_SETS = ["", "u", "iu", "v", "s"];

// Pad the following alternative to reach a target minimum size relative to
// the first alternative's, using a literal tail the subject never contains.
function following(lead, extra) {
  return lead + "K".repeat(Math.max(0, extra));
}

export function generateMatrix() {
  const cases = [];
  for (const first of FIRSTS) {
    for (const lead of LEADS) {
      for (const extra of [0, 1, 2]) {
        const source = first.src + "|" + following(lead.term, extra);
        for (const flags of FLAG_SETS) {
          // /v rejects some class syntax; construct lazily and skip syntax errors.
          for (const prefix of PREFIXES) {
            const subject = prefix + G + "K"; // an astral to find, then filler
            cases.push({ source, flags, inputs: [subject, prefix + "-K", ""] });
          }
        }
      }
    }
  }
  // Same shapes wrapped as lookbehinds (positive and negative), matched against
  // a body that has the shape immediately before the anchor character.
  for (const first of FIRSTS.slice(0, 3)) {
    for (const lead of LEADS.slice(0, 8)) {
      const body = first.src + "|" + lead.term + "K";
      for (const wrap of ["(?<=", "(?<!"]) {
        const source = wrap + body + ")Z";
        for (const flags of ["u", "iu", "v"]) {
          for (const prefix of PREFIXES.slice(0, 5)) {
            cases.push({ source, flags, inputs: [prefix + G + "Z", prefix + "-KZ", "Z"] });
          }
        }
      }
    }
  }
  return cases;
}
