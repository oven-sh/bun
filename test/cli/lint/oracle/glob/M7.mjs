// M7: `minimatch.makeRe(pattern, { dot }).test(path)` of minimatch 3.1.5: one expression for the whole path, which is not what `minimatch()` asks.
import { generator, random } from "./gen.mjs";
import { M3, require } from "./refs.mjs";
const minimatch = require(M3 + "minimatch");
// prettier-ignore
const atoms = ["a", "b", "ab", "app", ".", "..", ".a", "*", "**", "?", "*.js", "a*", "*a", "**a", "a**", "[ab]", "[!a]", "[^a]", "[a-c]", "[z-a]", "[]a]", "[a", "a]", "[\\]]",
  "+(a|b)", "@(a|b)", "?(a)", "*(a|b)", "!(a)", "!(a|b)", "!(a)b", "a!(b)", "+(a", "!(a", "@(a|b", "(a)", "a|b", "{a,b}", "{a,b}c", "{1..3}", "{a}", "\\*", "\\a", "\\\\", "\\", "!", "#", "é", "😀", "+", "@", "$", "^", "a.b", "", "(", ")", "!(!(a))", "+(!(a)|b)", "*(?)"];
const names = ["a", "b", "ab", "abc", "app", ".", "..", ".a", ".ab", "a.js", "a.b", "c", "1", "2", "é", "😀", "*", "[a", "a]", "(a)", "a|b", "+", "!", "#", "\\", "", "aa", "ba", "\n"];
const ask = (pattern, dot, path) => {
  let re;
  try { re = minimatch.makeRe(pattern, { dot }); } catch { return undefined; }
  // `false`: it is no expression, and whoever calls `test` of it throws. Here it matches nothing.
  return re === false ? false : re.test(path);
};
// The judge goes back and forth: 97 s for `*(+(*|?|))+(a-b?(?)*|abc*|ab*)/*` and `a.test.tsx/a}`.
export const takes_minutes = (pattern, names) => pattern.split(/[*+]\(/).length > 2 && names.some(it => it.length > 5);
const pieces = ["a", "b", ".", "/", "*", "**", "?", "{", "}", ",", "[", "]", "!", "(", ")", "|", "+", "@", "\\", "#", "-", "..", "^", "$", "é", " "];
export function* cases(seed, count) {
  const { rnd, pick } = random(seed);
  // A pattern that is made of its path, and a soup of pieces whose paths are the soup with some pieces changed.
  const made = generator(seed + 1);
  for (let k = 0; k < (count || 60000) / 2; k++) {
    const dot = rnd(3) === 0, mode = dot ? "minimatch3-makere-dot" : "minimatch3-makere";
    let { pattern, paths } = made.pattern_and_paths();
    if (rnd(30) === 0) pattern = pick([" ", "\n", "\u00a0", "\ufeff"]) + pattern + pick(["", " ", "\t"]);
    for (const names of paths) if (!takes_minutes(pattern, names)) yield { it: { mode, pattern, path: names.join("/") }, want: ask(pattern, dot, names.join("/")) };
    const soup = Array.from({ length: 1 + rnd(8) }, () => pick(pieces));
    for (let n = 0; n < 3; n++) {
      const path = soup.map(it => (rnd(3) ? it : pick(["a", "b", "ab", "", ".", "undefined", "/"]))).join("") + pick(["", "", "undefined"]);
      yield { it: { mode, pattern: soup.join(""), path }, want: ask(soup.join(""), dot, path) };
    }
  }
  for (let k = 0; k < (count || 60000); k++) {
    const dot = rnd(3) === 0;
    let pattern = Array.from({ length: 1 + rnd(4) }, () => (rnd(4) ? pick(atoms) : pick(atoms) + pick(atoms))).join("/");
    if (rnd(12) === 0) pattern = "!" + pattern;
    if (rnd(20) === 0) pattern = "/" + pattern;
    let re;
    try { re = minimatch.makeRe(pattern, { dot }); } catch { re = undefined; }
    for (let n = 0; n < 4; n++) {
      let path = Array.from({ length: 1 + rnd(4) }, () => pick(names)).join("/");
      if (rnd(10) === 0) path += "/";
      // `false`: it is no expression, and whoever calls `test` of it throws. Here it matches nothing.
      yield { it: { mode: dot ? "minimatch3-makere-dot" : "minimatch3-makere", pattern, path }, want: re === undefined ? undefined : re === false ? false : re.test(path) };
    }
  }
}
