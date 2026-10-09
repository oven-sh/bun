// B1: `braces::expand` against `expand` of brace-expansion 5.0.12: the same list in the same order.
import { random } from "./gen.mjs";
import { J, require } from "./refs.mjs";
const { expand } = require(J + "brace-expansion");
const seeds = ["{a,b}", "a{b,c}d", "{a,{b,c}}", "{a}", "{}", "{},a", "a{},b}c", "{a,}", "{,a}", "{,}", "{1..3}", "{01..3}", "{3..1}", "{1..5..2}", "{a..c}", "{a..c..2}", "{A..z}", "{-1..1}", "{1..3}{a,b}", "${a,b}", "a${b}",
  "\\{a,b}", "{a\\,b}", "{a,b\\}", "{a},b}", "{a,b}}", "{{a,b}}", "{a,b", "a,b}", "{a,b}{c,d}{e,f}", "{{a,b},{c,d}}", "x{{a,b}}y", "{a,b}/{c,d}", "{-01..01}", "{1..10..3}", "{10..1..3}", "{a..e..-2}", "{1..1}", "{a..a}", "{1.5..2}",
  "{a..1}", "{1..a}", "{..}", "{1..}", "{..3}", "{1...3}", "{a,b}$", "${a}{b,c}", "{a,b}${c,d}", "{\\{,\\}}", "{a\\\\,b}", "{é,ü}", "{😀,a}", "{a\nb,c}", "{a},\n}", "{0..0}", "{00..00}", "{007..010}", "{-5..-1}", "{9..11}", "{Z..a}"];
const alphabet = [..."{}{}{},,,..\\$ab1-0é", "..", "{a,b}", "{1..3}", "${", "\\{", "\\}", "\\,", "},", ",{", "{{", "}}", "\n"];
export function* cases(seed, count) {
  const { rnd, pick } = random(seed);
  const mutate = text => { const u = [...text]; for (let n = 1 + rnd(4); n > 0; n--) { const at = rnd(u.length + 1); const r = rnd(3); if (r === 0) u.splice(at, 1); else if (r === 1) u.splice(at, 0, pick(alphabet)); else u.splice(at, 1, pick(alphabet)); } return u.join(""); };
  const all = [...seeds]; while (all.length < (count || 20000)) all.push(rnd(4) ? mutate(pick(seeds)) : mutate(pick(seeds)) + mutate(pick(seeds)));
  for (const text of all) { let want; try { want = expand(text); } catch {} yield { it: { mode: "braces", text }, want }; }
}
