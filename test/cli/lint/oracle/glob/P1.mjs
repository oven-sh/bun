// P1: `MICROMATCH_DOT` against `micromatch.isMatch(path, pattern, { dot: true })` 4.0.8 on picomatch 2.3.2. 25,000 patterns x 3 paths, the generator of `gen.mjs`.
// picomatch 4.0.7 is counted beside it.
import { generator } from "./gen.mjs";
import { J, P, require } from "./refs.mjs";
const micromatch = require(P + "micromatch"), pico4 = require(J + "picomatch");
let differ4 = 0, asked = 0; const shown = [];
export function* cases(seed, count) {
  const g = generator(seed);
  for (let k = 0; k < (count || 25000); k++) {
    const { pattern, paths } = g.pattern_and_paths();
    for (const parts of paths) {
      const path = parts.join("/");
      let want; try { want = micromatch.isMatch(path, pattern, { dot: true }); } catch {}
      if (want !== undefined) { asked++; let four; try { four = pico4.isMatch(path, pattern, { dot: true }); } catch {} if (four !== want) { differ4++; if (shown.length < 6) shown.push([pattern, path, want, four]); } }
      yield { it: { mode: "micromatch", pattern, path }, want };
    }
  }
}
export function report() { console.log(`  picomatch 4.0.7 differs from 2.3.2 in ${differ4} of ${asked}`); for (const s of shown) console.log("     ", JSON.stringify(s)); }
