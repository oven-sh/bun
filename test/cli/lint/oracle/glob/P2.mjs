// P2: `FAST_GLOB_DOT` against what fast-glob 3.3.3 makes of a pattern with `{ dot: true }`: `processPatterns` of managers/tasks.js
// (`expandPatternsWithBraceExpansion`, `removeDuplicateSlashes`), `convertPatternsToRe` with the options of providers/provider.js, `matchAny`.
import { generator } from "./gen.mjs";
import { J, P, require } from "./refs.mjs";
const utils = require(P + "fast-glob/out/utils/pattern");
export const OPTIONS = { dot: true, matchBase: false, nobrace: false, nocase: false, noext: false, noglobstar: false, posix: true, strictSlashes: false };
export const expanded = pattern => utils.expandPatternsWithBraceExpansion([pattern]).map(it => utils.removeDuplicateSlashes(it));
export function* cases(seed, count) {
  const g = generator(seed);
  for (let k = 0; k < (count || 25000); k++) {
    const { pattern, paths } = g.pattern_and_paths();
    let res = null; try { res = utils.convertPatternsToRe(expanded(pattern), OPTIONS); } catch {}
    for (const parts of paths) { const path = parts.join("/"); yield { it: { mode: "fast-glob", pattern, path }, want: res ? utils.matchAny(path, res) : undefined }; }
  }
}
// What `read_picomatch::expand_for_fast_glob` makes of it: `braces::expand` is brace-expansion (B1).
const { expand } = require(J + "brace-expansion");
const ours = pattern => {
  const open = pattern.indexOf("{"), all = open >= 0 && pattern.indexOf("}", open) >= 0 ? expand(pattern) : [pattern];
  return [...new Set(all.map(it => it.replace(/(?!^)\/{2,}/g, "/")).filter(it => it !== ""))].sort();
};
export function explain(it) {
  if (it.path === "") return "the empty path, which fast-glob never asks about: what is no expression is /$^/ there, and that matches it";
  if (JSON.stringify(ours(it.pattern)) !== JSON.stringify([...new Set(expanded(it.pattern))].sort())) return "`braces` 3.0.3 expands it otherwise than brace-expansion 5.0.12";
  return null;
}
