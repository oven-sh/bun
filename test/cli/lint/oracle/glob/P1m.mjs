// P1m: `MICROMATCH_DOT`, the same without `dot`, and `FAST_GLOB_DOT`, on the generator of M1: patterns that are mutated character by character, which breaks
// brackets more often than the generator of `gen.mjs` does.
import { generate } from "./M1.mjs";
import { OPTIONS, expanded, explain as explain_fast_glob } from "./P2.mjs";
import { P, require } from "./refs.mjs";
const micromatch = require(P + "micromatch"),
  utils = require(P + "fast-glob/out/utils/pattern");
const attempt = f => {
  try {
    return f();
  } catch {
    return undefined;
  }
};
export function* cases(seed, count) {
  let last = null,
    res = null;
  for (const { it } of generate(seed, count, "", {})) {
    const { pattern, path } = it;
    yield {
      it: { mode: "micromatch", pattern, path },
      want: attempt(() => micromatch.isMatch(path, pattern, { dot: true })),
    };
    yield {
      it: { mode: "micromatch-nodot", pattern, path },
      want: attempt(() => micromatch.isMatch(path, pattern, {})),
    };
    if (pattern !== last) {
      last = pattern;
      res = attempt(() => utils.convertPatternsToRe(expanded(pattern), OPTIONS)) ?? null;
    }
    yield { it: { mode: "fast-glob", pattern, path }, want: res === null ? undefined : utils.matchAny(path, res) };
  }
}
export const explain = it => (it.mode === "fast-glob" ? explain_fast_glob(it) : null);
