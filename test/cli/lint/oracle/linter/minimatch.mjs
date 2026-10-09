// `minimatch`, as @eslint/config-array uses it, against `bun_glob::Pattern` with `Options::MINIMATCH_DOT`.

import { createRequire } from "node:module";
import { random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const requireFromConfigArray = createRequire(requireFromEslint.resolve("@eslint/config-array"));
const { Minimatch } = requireFromConfigArray("minimatch");

const patterns = [
  "**/*.js", "**/*.{js,ts}", "*.js", "*", "**", "**/*", "a/**", "a/**/b", "a/**/b/**/c", "**/a/**", "a/*", "a/*/b", "src/**/*.test.{ts,tsx}", "**/node_modules/",
  ".git/", "dist/", "dist", "dist/**", "dist/**/*", "!dist", "!**/*.js", "!!a", "#a", "\\#a", "", "/", "a/", "/a", "a//b", "./a", "../a", "a/../b", "a/./b", "a/b/..",
  "**/..", "**/.", ".*", "*.*", ".*.*", "*.", "*..", "?", "??", "?.js", "??.js", "a?", "a*", "*a", "a*b", "a*b*c", "*.test.*", "[ab]", "[a-c]", "[!a]", "[^a]", "[a", "a]", "[]",
  "[]a]", "[!]a]", "[a-]", "[-a]", "[z-a]", "[a-a]", "[\\]]", "[\\\\]", "[[:alpha:]]", "[[:alpha:][:digit:]]", "[[:upper:]]*", "[[:space:]]", "[[:graph:]]", "[a-[:alpha:]]", "[[:foo:]]",
  "[.]a", "[.]", "[*]", "[?]", "\\*", "\\?", "\\[a]", "a\\", "a\\b", "\\a", "\\.a", "*\\.js", "{a,b}", "{a,b}/c", "a{b,c}d", "{a,{b,c}}", "{a}", "{}", "{},a", "a{},b}c", "{a,}", "{,a}", "{,}",
  "{1..3}", "{01..3}", "{3..1}", "{1..5..2}", "{a..c}", "{a..c..2}", "{A..z}", "{-1..1}", "{1..3}{a,b}", "${a,b}", "a${b}", "\\{a,b}", "{a\\,b}", "{a,b\\}", "{a},b}", "{a,b}}", "{{a,b}}",
  "{a,b", "a,b}", "+(a|b)", "*(a|b)", "?(a|b)", "@(a|b)", "!(a|b)", "+(a)", "!(a)", "!(a)b", "a!(b)", "a!(b)c", "!(a|b)c", "*.!(js)", "!(*.js)", "!(*)", "!()", "+()", "@()", "*()", "?()",
  "+(a|)", "!(a|)", "+(a|b", "+(a|b))", "+(+(a))", "+(@(a|b))", "*(+(a|b)|c)", "@(?(a)b)", "!(!(a))", "!(@(a|b))", "!(+(a))", "+(a|!(b))", "@(a|b)/c", "+(a/b)", "@(a|b|)", "*(a|b|)",
  "+(.a|b)", "@(.|..)", "@(.*)", "*(.)", "!(.)", "!(..)", "!(.a)", ".!(a)", ".+(a)", "..+(a)", "+(.)+(.)", "a+(b)+(c)", "+(a)*(b)?(c)@(d)", "é*", "*é", "?é", "[é]", "[à-ü]", "😀", "?😀", "[😀]",
  "a b", "a\tb", "a b", "a.b+c", "a^b$c", "a|b", "(a)", "a(b", "a)b", "**a", "a**", "a**/b", "**/**", "**/**/a", "a/**/**/b", "***", "**/*/**", "*/**/*", "**/a/*/b/**/c", "**/a/**/a/**/a",
];
const alphabet = [..."*?[]{}()!+@|,./\\-^$ab.c1é", "**", "/", "/", "..", "{a,b}", "+(", "!(", "@(", "*(", "?(", "[:alpha:]", "**/", "/**"];
const names = ["a", "b", "c", "ab", "abc", "aa", "ba", "d", ".a", ".b", ".", "..", "", "a.js", "b.ts", "a.test.ts", ".a.js", "a.", "a..", "...", "1", "2", "01", "é", "aé", "😀", "a😀", "A", "Z", "_",
  "a b", "a\tb", "a.b+c", "node_modules", ".git", "dist", "{a,b}", "a,b", "*", "?", "[a]", "\\", "a\\b", "#a", "!a", "!dist", "$a", "(a)", "a|b", "+(a)", "a}", "{a}", "{}"];

const rng = random(5);
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
for (let i = 0; i < 12000; i++) all.push(mutate(rng.pick(patterns)));
const cases = [], expected = [];
let thrown = 0;
for (const pattern of all) {
  let matchers;
  try {
    matchers = [new Minimatch(pattern, { dot: true }), new Minimatch(pattern, { dot: true, flipNegate: true })];
  } catch {
    thrown++; // An invalid regular expression. ESLint would crash.
    continue;
  }
  // Paths that have a chance: made of the pattern itself.
  const literal = pattern.replace(/^!+/, "").replace(/[*?]+/g, () => rng.pick(names)).replace(/[\\{}()[\]|+@!]/g, "");
  for (const it of [literal, path(), path(), path(), path(), path(), path(), path()]) {
    const flipNegate = rng.int(4) === 0, partial = rng.int(4) === 0;
    // A path that is the start of one that has a chance.
    const path = partial && rng.int(2) === 0 ? it.split("/").slice(0, 1 + rng.int(3)).join("/") : it;
    cases.push({ pattern, path, flipNegate, partial });
    expected.push(matchers[Number(flipNegate)].match(path, partial));
  }
}
if (thrown > 0) console.log(`minimatch: ${thrown} patterns left out, minimatch throws`);
console.log(`minimatch: ${expected.filter(Boolean).length} of the cases match`);
report("minimatch", cases, expected, runBunLint("minimatch", cases), 40);
