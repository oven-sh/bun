// P3: `partial` of `FAST_GLOB_DOT`. What a walk needs: a directory in which something matches is never left out. So the cases are the
// directories above every path that fast-glob 3.3.3 says matches (P2), and the answer has to be yes.
import { generator } from "./gen.mjs";
import { OPTIONS, expanded } from "./P2.mjs";
import { P, require } from "./refs.mjs";
const utils = require(P + "fast-glob/out/utils/pattern");
export function* cases(seed, count) {
  const g = generator(seed);
  for (let k = 0; k < (count || 25000); k++) {
    const { pattern, paths } = g.pattern_and_paths();
    if (pattern.startsWith("!")) continue; // fast-glob takes those out before
    let res = null;
    try {
      res = utils.convertPatternsToRe(expanded(pattern), OPTIONS);
    } catch {
      continue;
    }
    for (const parts of paths) {
      if (parts.includes("") || !utils.matchAny(parts.join("/"), res)) continue;
      for (let n = 1; n < parts.length; n++) yield { it: { mode: "fast-glob", pattern, path: parts.slice(0, n).join("/"), partial: true }, want: true };
    }
  }
}
export { explain } from "./P2.mjs";
