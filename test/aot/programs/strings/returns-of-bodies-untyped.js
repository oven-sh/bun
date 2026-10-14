// Regular expressions that can match the empty string, in every method that takes a RegExp (the same program without type annotations).
const R = RegExp;
const patterns = [
  /(?:)/,
  /a*/,
  /^/,
  /$/,
  /x?/,
  /(a)?/,
  /(?:a|)/,
  /\b/,
  /a.c/s,
  /abc/,
  /(a)(b)/,
  /(a)|(b)/,
  /(a)(?:(b)|(c))/,
  /[a-f]x/,
  /..../,
  /a+(b)?/,
  /a+?b/,
  /(a+)(b+)?c/,
  /\d+/,
  /\w+@\w+/,
  /(x*)(y*)(z*)/,
  /^\s*$/,
  /^abc/,
  /^a|^b/,
  /^(?:x|yz)+$/,
  /^$/,
  /^ab?c$/,
  /^(a)?b/,
  /abc$/,
  /abc|d/,
  /d|abc/,
  /ab|cde|f/,
  /f|cde|ab/,
  /a|bc|d/,
  /(ab)|(cde)|(f)/,
  /a/y,
  /a*/y,
  /(a)|b/y,
  /ab|c/y,
  /a/g,
  /a*/g,
  /(a)(b)?/g,
  /^a/gm,
  /a$/gm,
  /b|^a/gm,
  /abc/i,
  /(A)b/i,
  /a.c/,
  /\bab\b/,
  /(?=a)a/,
  /(?!a)./,
  /(?<=a)b/,
  /(a)\1/,
  /(a)?\1b/,
  /ab?c/u,
  /./u,
  /(.)(.)/su
];
const subjects = [
  "",
  "a",
  "b",
  "abc",
  "xabcx",
  "aab",
  "aaabbbc",
  "d",
  "f",
  "cde",
  "12 34",
  "me@there",
  "  ",
  "xyzx",
  "ab",
  "ac",
  `a
c`,
  `a
b
a`,
  "ABC",
  "aa",
  "fx",
  "x ab y",
  "zzzz",
  "xxyyzz",
  "\u4E00",
  "a\u4E00",
  "\u4E00abc",
  "\u4E00aab\u4E00",
  "\u4E00d",
  "\u4E00 12",
  "a\u2028c",
  `\u4E00
a`,
  "\uD835\uDCB3a",
  "a\uD835\uDCB3b",
  "\u4E00aa\u4E00"
];
function shown(m) {
  return m === null ? "null" : m.index + ":" + JSON.stringify(Array.from(m));
}
function statics() {
  return JSON.stringify([R.lastMatch, R.$1, R.$2, R.leftContext, R.rightContext]);
}
let lines = 0;
let sum = 0;
function note(s) {
  lines++;
  for (let i = 0;i < s.length; i++)
    sum = sum * 31 + s.charCodeAt(i) | 0;
}
for (const r of patterns) {
  const out = [];
  for (const s of subjects) {
    r.lastIndex = 0;
    const first = shown(r.exec(s)), at = r.lastIndex;
    const second = r.global || r.sticky ? shown(r.exec(s)) + "@" + r.lastIndex : "";
    r.lastIndex = 0;
    const t = r.test(s);
    r.lastIndex = 0;
    const one = first + "@" + at + " " + second + " " + t + " " + s.search(r) + " " + JSON.stringify(s.replace(r, "[$&|$1]")) + " " + JSON.stringify(s.split(r, 4)) + " " + JSON.stringify(s.match(r)) + " " + statics();
    r.lastIndex = 0;
    note(one);
    out.push(one);
  }
  console.log(String(r), out.length, out[3], "\xB7", out[6], "\xB7", out[27]);
}
for (const r of [/(a)(b)?/g, /a*/g, /b|^a/gm, /(x*)(y*)(z*)/g])
  for (const s of subjects)
    note(JSON.stringify(Array.from(s.matchAll(r), (m) => [m.index, ...m])));
const kept = /(a+)(b+)?c/;
for (let i = 0;i < 40; i++) {
  const hit = kept.exec(i % 3 ? "zaabbc" : "zac"), miss = kept.exec("zzz"), none = /(q)(r)/.exec("zzz");
  note(shown(hit) + shown(miss) + shown(none) + statics());
}
for (const at of [0, 1, 3, 4, 5, 100, -1, 1.5])
  for (const r of [/a/g, /a/y, /(?:)/g, /$/g, /^/gm, /(a)|b/y]) {
    r.lastIndex = at;
    note(at + shown(r.exec("abca")) + "@" + r.lastIndex);
  }
console.log(patterns.length, subjects.length, lines, sum);
