// S1: `is_glob` and `glob_parent` against is-glob 4.0.3 and glob-parent 6.0.2. 5.1.2, which fast-glob 3.3.3 has, is counted beside it.
import { random } from "./gen.mjs";
import { alphabet, patterns } from "./M1.mjs";
import { J, P, require } from "./refs.mjs";
const isGlob = require(J + "is-glob"), parent6 = require(J + "glob-parent"), parent5 = require(P + "glob-parent");
let old = 0, asked = 0; const shown = [];
const more = ["a/b/c.js", "src/*.js", "src/**/a.js", "a/{b,c}/d", "a/(b|c)/d", "a/[bc]/d", "a/\\*/b", "a/b\\[c]/d", "{a/b,c}", "[a/b]", "a/b/", "/a/*", "/", "", ".", "./a/*", "../a/*", "a?.js", "a/b?/c", "a/@(b)/c", "a/!(b)/c", "a/+(b", "a/(b", "a/(b/c", "a\\/b/*", "C:/a/*", "a/b (c)/d*", "a/{b/c}", "a/[b/c]", "a/b{", "a/b[", "(?:a)", "(?:a|b)/c", "a/(?!b)c", "a|b", "(a|b)", "(a|)", "a/*.{js,ts}"];
export function* cases(seed, count) {
  const { rnd, pick } = random(seed), seeds = [...patterns, ...more];
  const mutate = text => { const u = [...text]; for (let n = rnd(4); n > 0; n--) { const at = rnd(u.length + 1), r = rnd(3); if (r === 0) u.splice(at, 1); else if (r === 1) u.splice(at, 0, pick(alphabet)); else u.splice(at, 1, pick(alphabet)); } return u.join(""); };
  for (let k = 0; k < (count || 20000); k++) {
    const text = k < seeds.length ? seeds[k] : rnd(3) ? mutate(pick(seeds)) : mutate(pick(seeds)) + "/" + mutate(pick(seeds));
    yield { it: { mode: "is-glob", text }, want: isGlob(text) };
    let want; try { want = parent6(text); } catch {}
    yield { it: { mode: "glob-parent", text }, want };
    asked++; let o; try { o = parent5(text); } catch {} if (o !== want) { old++; if (shown.length < 8) shown.push([text, want, o]); }
  }
}
export function report() { console.log(`  glob-parent 5.1.2 differs from 6.0.2 in ${old} of ${asked}`); for (const s of shown) console.log("     ", JSON.stringify(s)); }
