// Im: the three npm flavours on lines that are mutated character by character, which the generator of I1 to I3 (a path with magic put in) does not make:
// escapes before everything, brackets that are broken, `**` in all places, blanks.
import { random } from "./gen.mjs";
import { J, P, require } from "./refs.mjs";
const packages = {
  npm5: require(J + "ignore"),
  npm705: require(P + "ignore"),
  npm7012: require(J + "@typescript-eslint/eslint-plugin/node_modules/ignore"),
};
export const seeds = [
  "a",
  "a/",
  "/a",
  "a/b",
  "a/b/",
  "*.js",
  "*",
  "**",
  "**/",
  "/**",
  "/**/",
  "**/a",
  "a/**",
  "a/**/",
  "a/**/b",
  "a/**/**/b",
  "**/**/a",
  "a**",
  "**a",
  "a**b",
  "a**/b",
  "a/**b",
  "a/*",
  "a/*/",
  "a/*/b",
  "*/a",
  "/*",
  "/*/",
  "a*",
  "*a",
  "a*b",
  "a?b",
  "?",
  "[ab]",
  "[a-c]",
  "[!a]",
  "[^a]",
  "[a",
  "a]",
  "[]",
  "[]a]",
  "[!]a]",
  "[a-]",
  "[-a]",
  "[z-a]",
  "[\\]]",
  "[\\\\]",
  "[[:alpha:]]",
  "[[:alpha:][:digit:]]",
  "[[:foo:]]",
  "[a/b]",
  "a[/]b",
  "[,-z]",
  "\\a",
  "\\*",
  "\\?",
  "\\[a]",
  "\\[a",
  "a\\",
  "a\\\\",
  "a\\\\*",
  "a\\\\*b",
  "a\\*b",
  "a\\/b",
  "a\\/",
  "a\\/**",
  "a\\/*",
  "\\!a",
  "\\#a",
  "!a",
  "!!a",
  "#a",
  "a ",
  "a  ",
  "a\\ ",
  "a\\  ",
  "a \\ ",
  " a",
  "a b",
  "a\tb",
  "a\t",
  "{a,b}",
  "a.b",
  "a+b",
  "a(b)",
  "a|b",
  "a$",
  "^a",
  "a^b",
  "é",
  "[é]",
  "*é",
  "😀",
  "[😀]",
  "\\d",
  "\\w",
  "\\s",
  "\\b",
  "\\n",
  "\\1",
  "\\x41",
  "\\u0041",
  "\\cA",
  "\\c",
  "\\0",
  "\\12",
  "\\8",
  "[\\d]",
  "[\\w-a]",
  "[a*]",
  "[a?]",
  "[a*",
  "[a?",
  "a[*",
  "node_modules/",
  "dist",
  "*.min.js",
  "**/*.test.ts",
  "src/**/*.ts",
  "!src/a.ts",
  ".*",
  ".a",
  "a/.b",
  "A",
  "A/B.JS",
];
export const alphabet = [
  ..."*?[]!\\/#. -^$|+(){}ab.c1é,:",
  "**",
  "/",
  "/",
  "\\\\",
  "**/",
  "/**",
  "[:alpha:]",
  "\t",
  "\\ ",
  "A",
];
export const names = [
  "a",
  "b",
  "c",
  "ab",
  "abc",
  "d",
  ".a",
  ".b",
  "a.js",
  "b.ts",
  "a.test.ts",
  "a.min.js",
  "1",
  "é",
  "aé",
  "😀",
  "A",
  "B.JS",
  "a b",
  "a\tb",
  "node_modules",
  "dist",
  "src",
  "{a,b}",
  "a,b",
  "*",
  "?",
  "[a]",
  "\\",
  "a\\b",
  "#a",
  "!a",
  "a ",
  "a+b",
  "a(b)",
  "a|b",
  "a$",
  "^a",
  "\n",
  "A1",
];
export function* cases(seed, count) {
  const { rnd, pick } = random(seed);
  const mutate = text => {
    const u = [...text];
    for (let n = rnd(4); n > 0; n--) {
      const at = rnd(u.length + 1),
        r = rnd(3);
      if (r === 0) u.splice(at, 1);
      else if (r === 1) u.splice(at, 0, pick(alphabet));
      else u.splice(at, 1, pick(alphabet));
    }
    return u.join("");
  };
  const path = () => Array.from({ length: 1 + rnd(4) }, () => pick(names)).join("/");
  for (let k = 0; k < (count || 12000); k++) {
    const lines = Array.from(
      { length: rnd(5) === 0 ? 2 : 1 },
      (_, i) => (i && rnd(2) ? "!" : "") + (k < seeds.length ? seeds[k] : mutate(pick(seeds))),
    );
    const literal = lines[0]
      .replace(/^!/, "")
      .replace(/\*+/g, () => pick(names))
      .replace(/\?/g, "a")
      .replace(/[\\[\]]/g, "")
      .replace(/^\/|\/$/g, "")
      .trimEnd();
    const ignoreCase = rnd(2) === 0;
    for (const [mode, ignore] of Object.entries(packages)) {
      let it = null;
      try {
        it = (ignore.default ?? ignore)({ allowRelativePaths: true, ignoreCase }).add(lines);
      } catch {}
      for (const p of [literal || "a", (literal || "a") + "/x", "x/" + (literal || "a"), path(), path(), path()])
        for (const q of [p, p + "/"]) {
          let want;
          try {
            want = it?.ignores(q);
          } catch {}
          yield { it: { mode, lines, ignoreCase, path: q, ask: "ignores" }, want };
        }
    }
  }
}
export const explain = it => (it.mode === "npm7012" && /[\n\r]|\/\//.test(it.path) ? "E11: 7.0.12 tries a rule without a `/` inside on the last name alone if at least half of the rules are such: it shows if a directory has a line terminator in its name, or the path a `//`" : null);
