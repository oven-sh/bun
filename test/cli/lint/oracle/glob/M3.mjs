// M3: the bound of segments.rs: 2 to 6 `**`, sections of 1 to 3 parts, paths of 1 to 30 names out of `a b . ..` (and `.a` without `dot`).
// The judge is minimatch 10.2.6, whose own search takes up to names^sections steps here. Asked besides: no case over 2 x parts x names.
import { random } from "./gen.mjs";
import { J, require } from "./refs.mjs";
const { Minimatch } = require(J + "minimatch");
export function* cases(seed, count) {
  const { rnd, pick } = random(seed);
  for (let k = 0; k < (count || 60000); k++) {
    const parts = [], stars = 2 + rnd(5);
    if (rnd(2)) parts.push(pick(["a", "b", "*"]));
    for (let i = 0; i < stars; i++) { parts.push("**"); if (i + 1 < stars || rnd(2)) for (let j = 1 + rnd(3); j > 0; j--) parts.push(pick(["a", "a", "b", "*"])); }
    const file = Array.from({ length: 1 + rnd(30) }, () => pick(["a", "a", "a", "b", "b", ".", "..", ".a"].slice(0, rnd(3) ? 5 : 8)));
    if (rnd(6) === 0) file.push("");
    const partial = rnd(4) === 0, pattern = parts.join("/"), path = file.join("/"), dot = rnd(3) > 0;
    yield { it: { mode: dot ? "minimatch" : "minimatch-nodot", pattern, path, partial }, want: new Minimatch(pattern, { dot }).match(path, partial) };
  }
}
