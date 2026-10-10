// M1: `MINIMATCH_DOT` with `flipNegate` and `partial`, against minimatch 10.2.6. The generator is that of
// test/cli/lint/oracle/linter/minimatch.mjs, as it is: with seed 5 and no count these are its 97,000 cases.
import { J, require } from "./refs.mjs";
const { Minimatch } = require(J + "minimatch");
function random(seed) {
  let state = seed >>> 0;
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: n => Math.floor(next() * n), pick: list => list[Math.floor(next() * list.length)] };
}
export const patterns = [
  "**/*.js", "**/*.{js,ts}", "*.js", "*", "**", "**/*", "a/**", "a/**/b", "a/**/b/**/c", "**/a/**", "a/*", "a/*/b", "src/**/*.test.{ts,tsx}", "**/node_modules/",
  ".git/", "dist/", "dist", "dist/**", "dist/**/*", "!dist", "!**/*.js", "!!a", "#a", "\\#a", "", "/", "a/", "/a", "a//b", "./a", "../a", "a/../b", "a/./b", "a/b/..",
  "**/..", "**/.", ".*", "*.*", ".*.*", "*.", "*..", "?", "??", "?.js", "??.js", "a?", "a*", "*a", "a*b", "a*b*c", "*.test.*", "[ab]", "[a-c]", "[!a]", "[^a]", "[a", "a]", "[]",
  "[]a]", "[!]a]", "[a-]", "[-a]", "[z-a]", "[a-a]", "[\\]]", "[\\\\]", "[[:alpha:]]", "[[:alpha:][:digit:]]", "[[:upper:]]*", "[[:space:]]", "[[:graph:]]", "[a-[:alpha:]]", "[[:foo:]]",
  "[.]a", "[.]", "[*]", "[?]", "\\*", "\\?", "\\[a]", "a\\", "a\\b", "\\a", "\\.a", "*\\.js", "{a,b}", "{a,b}/c", "a{b,c}d", "{a,{b,c}}", "{a}", "{}", "{},a", "a{},b}c", "{a,}", "{,a}", "{,}",
  "{1..3}", "{01..3}", "{3..1}", "{1..5..2}", "{a..c}", "{a..c..2}", "{A..z}", "{-1..1}", "{1..3}{a,b}", "${a,b}", "a${b}", "\\{a,b}", "{a\\,b}", "{a,b\\}", "{a},b}", "{a,b}}", "{{a,b}}",
  "{a,b", "a,b}", "+(a|b)", "*(a|b)", "?(a|b)", "@(a|b)", "!(a|b)", "+(a)", "!(a)", "!(a)b", "a!(b)", "a!(b)c", "!(a|b)c", "*.!(js)", "!(*.js)", "!(*)", "!()", "+()", "@()", "*()", "?()",
  "+(a|)", "!(a|)", "+(a|b", "+(a|b))", "+(+(a))", "+(@(a|b))", "*(+(a|b)|c)", "@(?(a)b)", "!(!(a))", "!(@(a|b))", "!(+(a))", "+(a|!(b))", "@(a|b)/c", "+(a/b)", "@(a|b|)", "*(a|b|)",
  "+(.a|b)", "@(.|..)", "@(.*)", "*(.)", "!(.)", "!(..)", "!(.a)", ".!(a)", ".+(a)", "..+(a)", "+(.)+(.)", "a+(b)+(c)", "+(a)*(b)?(c)@(d)", "é*", "*é", "?é", "[é]", "[à-ü]", "😀", "?😀", "[😀]",
  "a b", "a\tb", "a b", "a.b+c", "a^b$c", "a|b", "(a)", "a(b", "a)b", "**a", "a**", "a**/b", "**/**", "**/**/a", "a/**/**/b", "***", "**/*/**", "*/**/*", "**/a/*/b/**/c", "**/a/**/a/**/a",
];
export const alphabet = [..."*?[]{}()!+@|,./\\-^$ab.c1é", "**", "/", "/", "..", "{a,b}", "+(", "!(", "@(", "*(", "?(", "[:alpha:]", "**/", "/**"];
export const names = ["a", "b", "c", "ab", "abc", "aa", "ba", "d", ".a", ".b", ".", "..", "", "a.js", "b.ts", "a.test.ts", ".a.js", "a.", "a..", "...", "1", "2", "01", "é", "aé", "😀", "a😀", "A", "Z", "_",
  "a b", "a\tb", "a.b+c", "node_modules", ".git", "dist", "{a,b}", "a,b", "*", "?", "[a]", "\\", "a\\b", "#a", "!a", "!dist", "$a", "(a)", "a|b", "+(a)", "a}", "{a}", "{}"];

export function* generate(seed, count, mode, options) {
  const rng = random(seed);
  const path = () => {
    const parts = Array.from({ length: 1 + rng.int(5) }, () => rng.pick(names));
    return rng.pick(["", "", "", "/"]) + parts.join(rng.pick(["/", "/", "/", "//"])) + rng.pick(["", "", "", "/"]);
  };
  const mutate = text => {
    const units = [...text];
    for (let n = 1 + rng.int(3); n > 0; n--) {
      const at = rng.int(units.length + 1);
      switch (rng.int(3)) {
        case 0: units.splice(at, 1); break;
        case 1: units.splice(at, 0, rng.pick(alphabet)); break;
        default: units.splice(at, 1, rng.pick(alphabet));
      }
    }
    return units.join("");
  };
  const all = [...patterns];
  for (let i = 0; i < (count || 12000); i++) all.push(mutate(rng.pick(patterns)));
  for (const pattern of all) {
    let matchers = null;
    try { matchers = [new Minimatch(pattern, options), new Minimatch(pattern, { ...options, flipNegate: true })]; } catch {}
    const literal = pattern.replace(/^!+/, "").replace(/[*?]+/g, () => rng.pick(names)).replace(/[\\{}()[\]|+@!]/g, "");
    for (const it of [literal, path(), path(), path(), path(), path(), path(), path()]) {
      const flipNegate = rng.int(4) === 0, partial = rng.int(4) === 0;
      const path = partial && rng.int(2) === 0 ? it.split("/").slice(0, 1 + rng.int(3)).join("/") : it;
      yield { it: { mode, pattern, path, flipNegate, partial }, want: matchers?.[Number(flipNegate)].match(path, partial) };
    }
  }
}
export const cases = (seed, count) => generate(seed, count, "minimatch", { dot: true });
