// The atomic-group idioms `(?=([C]*))\N` and `(?=([C]+))\N` over a character class (the same program without type annotations).
const expressions = [
  /(?=([ab]*))\1c/,
  /(?=([ab]+))\1c/,
  /(?=([ab]*))\1c/i,
  /(?=([ab]+))\1c/u,
  /(?=([ab]*))\1c/iu,
  /(?=([ab]+))\1c/giu,
  /(?=([ab]*))\1c/y,
  /(?=([ab]+))\1c/gy,
  /(?=([ab]*))\1c/v,
  /(?=([ab]+))\1c/d,
  /(?=([^ab]*))\1a/,
  /(?=([^ab]+))\1a/,
  /(?=([^ab]*))\1a/u,
  /(?=([^ab]+))\1a/iu,
  /(?=(\s*))\1x/,
  /(?=(\s+))\1x/u,
  /(?=(\w*))\1!/,
  /(?=(\w+))\1!/iu,
  /(?=(\W+))\1a/u,
  /(?=(\d*))\1\./,
  /(?=(\D+))\1\d/u,
  /(?=(.*))\1$/,
  /(?=(.+))\1$/su,
  /(?=(.*))\1\n/u,
  /(?=([^]*))\1$/,
  /(?=([^]+))\1/u,
  /(?=([\u{1f600}-\u{1f64f}]*))\1a/u,
  /(?=([\u{1f600}-\u{1f64f}]+))\1a/u,
  /(?=([a\u{1f600}-\u{1f64f}]*))\1b/u,
  /(?=([a\u{1f600}-\u{1f64f}]+))\1b/iu,
  /(?=([^\u{1f600}-\u{1f64f}]+))\1\u{1f600}/u,
  /(?=([\ud83d]*))\1a/,
  /(?=([\uD83D\uDE00]+))\1a/,
  /(?=([\ud800-\udfff]+))\1a/u,
  /(?=(\p{L}*))\1\p{N}/u,
  /(?=(\p{Lu}+))\1\p{Ll}/u,
  /(?=(\P{L}+))\1\p{L}/u,
  /(?=([\p{L}--[a-z]]+))\1a/v,
  /(?=([\u0430-\u044f]+))\1!/i,
  /(?=([\u{430}-\u{44f}]+))\1!/iu,
  /(?=([k\u{212a}]+))\1s/iu,
  /(?=([\u00dfs]+))\1t/i,
  /(?=([\u00e9\u00e8]*))\1x/i,
  /x(?=([ab]*))\1cde/,
  /xy(?=([ab]+))\1cde/u,
  /(?=([ab]*))\1cdefgh/,
  /x(?=([ab]*))\1c(?=([de]*))\2f/,
  /x(?=([ab]+))\1c(?=([ab]+))\2c(?=([ab]*))\3$/u,
  /(?=([ab]*))\1(?=([cd]*))\2(?=([ab]*))\3e/,
  /(?=([ab]*))\1[ab]/,
  /(?=([ab]+))\1[ab]/u,
  /(?=([ab]*))\1(?:c|$)/,
  /(?:(?=([ab]+))\1c)+d/,
  /(?:(?=([ab]*))\1c)*d/u,
  /(?:x(?=([ab]*))\1y){2,3}/,
  /(?:(?=([ab]+))\1c|ab)+/,
  /(?:(?=([ab]+))\1c|(a)b)+?$/,
  /((?=([ab]+))\2c)\1/,
  /(?=([ab]+))\1c|(?=([ab]+))\2d/,
  /^(?:(?=([ab]*))\1c|(?=([ab]*))\2d|.)*$/,
  /(z)?(?=([ab]+))\2c\1/,
  /(?=([ab]+))\1c\1/,
  /(?=([ab]+))\1(c)\2\1/i,
  /(?=(?=([ab]*))\1c)a/,
  /(?!(?=([ab]*))\1c)a/,
  /(?<=x)(?=([ab]*))\1c/,
  /(?<=(?=([ab]*))\1)c/,
  /(?<!(?=([ab]+))\1)c/,
  /(?<=x(?=([ab]*))\1)c/u,
  /(?=((?=([ab]*))\2c))\1d/,
  /(?=([ab]*?))\1c/,
  /(?=([ab]{2,}))\1c/,
  /(?=([ab]{0,3}))\1c/,
  /(?=([ab]?))\1c/,
  /(?=([ab]))\1c/,
  /(?=([ab]*c))\1d/,
  /(?=(c[ab]*))\1d/,
  /(?=([ab][cd]*))\1e/,
  /(?=([ab][ab]*))\1c/,
  /(?=([ab]+[ab]*))\1c/,
  /(?=([ab]*|c))\1d/,
  /(?=(?:[ab]*))c/,
  /(?=([ab]*))\1*c/,
  /(?=([ab]*))\1?c/,
  /(?=([ab]*))(?:)\1c/,
  /(?=([ab]*))c\1/,
  /(?=([ab]*)){2}\1c/,
  /(?=(?<n>[ab]*))\k<n>c/,
  /(?=(?<n>[ab]+))\1c/u
];
const F = String.fromCodePoint;
const G = F(128512);
const H = F(128591);
const L = F(55357);
const T = F(56832);
const subjects = [
  "",
  "a",
  "b",
  "c",
  "ab",
  "abc",
  "ABC",
  "aabbc",
  "abab",
  "ababc ababd",
  "xabcde",
  "xyabcde",
  "xcde",
  "xabcdef",
  "xabcabcab",
  "xcabc",
  "abcdabe",
  "cd",
  "abcabcd",
  "cccd",
  "xaby",
  "xabyxyxbay",
  "xyxy",
  "abcab",
  "abcabc",
  "zabcz",
  "abcc",
  "abCcAB",
  "  x",
  `	
 x`,
  "x",
  "word!",
  "!",
  "__9!",
  "12.5",
  ".",
  "abc1",
  `line
next`,
  `
`,
  `a
b
`,
  G + "a",
  G + H + "a",
  "a" + G + "b",
  G + "aA" + H + "B",
  "xyz" + G,
  L + "a",
  L + L + "a",
  T + "a",
  L + T + "a",
  T + L + "a",
  "a" + L,
  G + L + "a",
  L + G + "a",
  "x" + T,
  F(1072, 1073) + "!",
  F(1040, 1103) + "!",
  F(8490) + "ks",
  "KkS",
  F(223) + "sst",
  "SST",
  F(233, 201, 232) + "x",
  F(1046) + "1",
  "Abc",
  "ABc",
  "123a",
  F(119808) + "7",
  F(1046) + "a",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
  "abababababababababababababababababababababababababababababababababc"
];
function show(m) {
  return m === null ? "-" : m.index + ":" + JSON.stringify(Array.from(m));
}
let rows = 0;
for (let e = 0;e < expressions.length; e++) {
  const r = expressions[e];
  let line = "";
  for (const s of subjects) {
    r.lastIndex = 0;
    const first = show(r.exec(s)), at = r.lastIndex;
    const second = r.global || r.sticky ? show(r.exec(s)) : "";
    r.lastIndex = 1;
    const third = r.global || r.sticky ? show(r.exec(s)) : "";
    r.lastIndex = 0;
    line += " " + first + (at ? "@" + at : "") + second + third + "|" + JSON.stringify(s.replace(r, "<$&,$1,$2>")) + (r.test(s) ? "t" : "f") + s.search(r) + "," + s.split(r).length;
    r.lastIndex = 0;
  }
  rows++;
  console.log(e + " /" + r.flags + " ->" + line);
}
console.log(rows + " rows");
