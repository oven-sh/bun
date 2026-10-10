// M2: `MINIMATCH` (no `dot`) against minimatch 10.2.6, on the generator of `gen.mjs`: 25,000 patterns x 3 paths, and the same with `dot`
// (mode minimatch), because that generator nests extglobs deeper than that of M1.
import { generator } from "./gen.mjs";
import { J, require } from "./refs.mjs";
const { Minimatch } = require(J + "minimatch");
export function* cases(seed, count) {
  const g = generator(seed);
  for (let k = 0; k < (count || 25000); k++) {
    const { pattern, paths } = g.pattern_and_paths();
    for (const [mode, options] of [["minimatch-nodot", {}], ["minimatch", { dot: true }]]) {
      let m = null;
      try { m = new Minimatch(pattern, options); } catch {}
      for (const parts of paths) {
        const path = parts.join("/"), partial = g.rnd(6) === 0;
        const want = m?.match(path, partial);
        yield { it: { mode, pattern, path, partial }, want };
      }
    }
  }
}
