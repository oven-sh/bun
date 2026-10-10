// B2: `braces::expand` against brace-expansion 5.0.12 on what the four changes of braces.rs touch: runs of groups that do not multiply, groups side by side in one
// part of a list, commas without a `}` behind them, line terminators between, rewrites, nesting: each shape at every size up to 14, alone, in a list, and
// before and behind other things. Then texts that are put together at random from the same pieces. The same list in the same order.
import { random } from "./gen.mjs";
import { J, require } from "./refs.mjs";
const { expand } = require(J + "brace-expansion");
const rep = (s, n) => s.repeat(n);
const shapes = [
  n => "{a}" + rep(",a", n), n => "{a}" + rep(",a", n) + "\n}", n => "{a}" + rep(",\n", n) + "}", n => "{a}" + rep(",,", n) + "}", n => "{a}" + rep(",a", n) + "}",
  n => "{a}" + rep(",a\n", n) + ",}", n => "{a}" + rep(",a ", n) + "b}", n => "{a}\n" + rep(",a", n) + "}", n => rep("{a},", n) + "}", n => rep("{a},", n), n => rep("${a}", n), n => rep("${a,b}", n),
  n => rep("{a}", n), n => rep("{", n) + "a,b" + rep("}", n), n => rep("{x,", n) + rep("}", n), n => rep("{a,", n), n => "{" + rep("{a},", n) + "b}", n => "{x," + rep("{a}", n) + "}",
  n => "{x," + rep("{a}", n) + "y}", n => "{x," + rep("{a,b}", Math.min(n, 6)) + "}", n => "{" + rep("{a}", n) + ",x}", n => "{x," + rep("{a}b", n) + ",y}", n => "{" + rep("a,", n) + "b}", n => rep("{,}", Math.min(n, 8)),
  n => rep("{,a}", Math.min(n, 8)), n => "{a,b}" + rep("${c}", n), n => "{a,b}" + rep("{c}", n), n => rep("${c}", n) + "{a,b}", n => "{a,b}" + rep("x", n) + "{c,d}", n => "{,}" + rep("${}", n), n => "{,}" + rep("{}", n),
  n => rep("{{a}}", n), n => rep("{{a,b}}", Math.min(n, 6)), n => "{" + rep("{", n) + "a" + rep("}", n) + ",b}", n => rep("{1..2}", Math.min(n, 8)), n => "{1.." + n + "}" + rep("${a}", n), n => rep("{a\\}", n) + ",b}",
];
const wraps = [t => t, t => "{" + t + ",z}", t => "{z," + t + "}", t => "p" + t + "q", t => t + "{c,d}", t => "{c,d}" + t, t => "{" + t + "}", t => t + "}", t => "{" + t, t => "$" + t, t => t + "," + t];
const pieces = ["{", "}", ",", "a", "${", "..", "1", "\\", "{a}", "{a,b}", "{,}", "{1..3}", "\n", "{a},", ",a", "${a}", "}{", "},{", "{}", "$", " ", ",,", "{{", "}}", "b"];
export function* cases(seed, count) {
  const all = [];
  for (const shape of shapes) for (let n = 0; n <= 14; n++) for (const wrap of wraps) all.push(wrap(shape(n)));
  const { rnd, pick } = random(seed);
  while (all.length < (count || 60000)) all.push(Array.from({ length: 1 + rnd(14) }, () => pick(pieces)).join(""));
  for (const text of all) {
    let want;
    try {
      want = expand(text);
    } catch {}
    yield { it: { mode: "braces", text }, want };
  }
}
