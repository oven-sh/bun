// M8: `minimatch(path, pattern, { dot, matchBase, nocomment, nonegate })` of minimatch 3.1.5, which eslint-plugin-import asks, and the last three of 10.2.6.
// 3.1.5 is not 10.2.6: `.*` takes `.` and `..`, `a/../b` is not folded, `(?=.)` stands before a name with magic, the pattern is trimmed.
import { generator } from "./gen.mjs";
import { takes_minutes } from "./M7.mjs";
import { J, M3, require } from "./refs.mjs";
const m3 = require(M3 + "minimatch");
const { minimatch: m10 } = require(J + "minimatch");
// prettier-ignore
const more = [".*", ".*/**", ".*/*", ".**", "a/../b", "*/..", "{.,..}/a", "a/?(b)", "a/*(b)", "a/!(b)", "*(a|b)", "*.js\\#", "*\\#", " a", "a ", "\ta\n", " #a", " !a", "**/**", "a/**/**/b", "{a/b,*}", "a{*,*/**}", "*)", "[}[*"];
const paths = ["..", ".", "../a", "./a", "../a/b.css", "a/../b", "a/..", "b", "a/", "", "a", "a.js#", "a#", "#a", "!a", "a/b", "x/a", "x/y/b", "a/x/b", "ab", "a/b/c"];
export function* cases(seed, count) {
  const { rnd, pick, pattern_and_paths } = generator(seed);
  for (let k = 0; k < (count || 60000); k++) {
    let { pattern, paths: made } = pattern_and_paths();
    made = made.filter(it => !takes_minutes(pattern, it)).map(it => it.join("/"));
    if (rnd(5) === 0) { pattern = rnd(2) ? pick(more) : pick(more) + "/" + pattern; made.push(pick(paths), pick(paths)); }
    if (rnd(30) === 0) pattern = pick([" ", "\n", " ", "﻿"]) + pattern + pick(["", " ", "\t"]);
    if (rnd(8) === 0) pattern = pick(["!", "!!", "#", "!#", "!(", "!)", "!]", "!|", "\\!", "\\#"]) + pattern;
    const dot = rnd(2) === 0, matchBase = rnd(3) === 0, flags = { ...(rnd(3) === 0 && { nocomment: true }), ...(rnd(3) === 0 && { nonegate: true }) };
    for (const path of made) {
      const ask = (f, options) => { try { return f(path, pattern, options); } catch { return undefined; } };
      yield { it: { mode: dot ? "minimatch3" : "minimatch3-nodot", pattern, path, ...(matchBase && { matchBase }), ...flags }, want: ask(m3, { dot, matchBase, ...flags }) };
      if (matchBase || flags.nocomment || flags.nonegate) yield { it: { mode: dot ? "minimatch" : "minimatch-nodot", pattern, path, ...(matchBase && { matchBase }), ...flags }, want: ask(m10, { dot, matchBase, ...flags }) };
    }
  }
}
