// Numbers that are defined by a conversion from an integer, compared with integer constants: by the integer (the same program without type annotations).
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
const EOF = -1;
function codePointAt(s, i) {
  return s.codePointAt(i);
}
function isLetter(ch) {
  return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122;
}
function size(ch) {
  return ch >= 65536 ? 2 : ch === EOF ? 0 : 1;
}
export function isLetterAt(s, i) {
  const ch = s.codePointAt(i);
  return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122;
}
export function classify(s, i) {
  const ch = codePointAt(s, i);
  return "" + (ch < 0) + (ch <= 0) + (ch > 0) + (ch >= 0) + (ch < 65) + (ch <= 65) + (ch > 65) + (ch >= 65) + (65 < ch) + (65 <= ch) + (65 > ch) + (65 >= ch) + (ch < -1) + (ch <= -1) + (ch > -1) + (ch >= -1) + (ch === 65) + (ch !== 65) + (ch == 65) + (ch < 1114112) + (ch <= 1114111) + (ch > 1114111) + (ch >= 1114111) + (ch < 1099511627776) + (ch > -1099511627776) + (ch >= 9007199254740991) + (ch <= -9007199254740991) + isLetter(ch) + size(ch);
}
export function joined(s, i, which) {
  let ch;
  if (which === 0)
    ch = s.charCodeAt(i);
  else if (which === 1)
    ch = codePointAt(s, i);
  else if (which === 2)
    ch = EOF;
  else
    ch = s.length;
  return "" + (ch < 0) + (ch <= -1) + (ch < -1) + (ch > -1) + (ch >= -1) + (ch >= 0) + (ch < 65) + (ch <= 90) + (ch > 96) + (ch >= 123) + (ch === -1) + (ch === 65) + (ch !== 97) + isLetter(ch) + size(ch);
}
export function withEnd(s, i) {
  const ch = i >= 0 && i < s.length ? codePointAt(s, i) : EOF;
  const next = i + 1 >= 0 && i + 1 < s.length ? s.charCodeAt(i + 1) : EOF;
  const either = (i & 1) === 0 ? ch : next;
  return "" + (ch < 0) + (ch >= 0) + (ch <= 64) + (next < 0) + (next > 127) + (either < 0) + (either <= -1) + (either < 48) + (either > 57) + (either >= -1) + (either === EOF) + isLetter(either) + size(either) + " " + either;
}
export function ofFraction(s, i, which) {
  let ch;
  if (which === 0)
    ch = s.charCodeAt(i);
  else
    ch = i / 2;
  return "" + (ch < 1) + (ch <= 1) + (ch > 1) + (ch >= 1) + (ch === 1) + (ch < 0) + (ch >= 0);
}
export function aroundALoop(s) {
  let ch = s.charCodeAt(0), out = "";
  for (let i = 1;i <= s.length + 1; i++) {
    out += (ch < 65 ? "a" : ch <= 90 ? "b" : ch >= 97 ? "c" : "d") + (ch >= 0 ? "" : "!");
    ch = i & 1 ? ch + 0.5 : s.charCodeAt(i);
  }
  return out;
}
export function scanWord(s, from) {
  let pos = from, ch = codePointAt(s, pos);
  while (pos < s.length && (isLetter(ch = codePointAt(s, pos)) || ch >= 48 && ch <= 57 || ch === 95 || ch > 127))
    pos += size(ch);
  return pos;
}
export function countLetters(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++) {
    const ch = s.codePointAt(i);
    if (ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122)
      n++;
  }
  return n;
}
export function countJoined(s) {
  let n = 0;
  for (let i = 0;i <= s.length; i++) {
    const ch = (i & 1) === 0 ? s.charCodeAt(i) : (i & 2) === 0 ? s.codePointAt(i) : EOF;
    if (ch < 0 || ch >= 65 && ch <= 90 || ch === 95)
      n++;
  }
  return n;
}
export function countNested(s) {
  let n = 0;
  for (let i = 0;i <= s.length + 1; i++) {
    const inner = (i & 1) === 0 ? s.charCodeAt(i) : s.length;
    const ch = (i & 4) === 0 ? inner : EOF;
    if (ch <= -1)
      n += 100;
    else if (ch < 48)
      n += 10;
    else if (ch > 122)
      n += 1000;
    else if (ch >= 97)
      n++;
  }
  return n;
}
export function countAround(s) {
  let n = 0, ch = s.charCodeAt(0);
  for (let i = 1;i <= s.length + 1; i++) {
    if (ch >= 65 && ch < 91)
      n++;
    ch = s.charCodeAt(i);
  }
  return n;
}
export function countFractions(s) {
  let n = 0;
  for (let i = 0;i <= s.length; i++) {
    const ch = (i & 1) === 0 ? s.charCodeAt(i) : i / 2;
    if (ch >= 1 && ch <= 90)
      n++;
  }
  return n;
}
export function countParsed(s) {
  let n = 0;
  for (let i = 0;i <= s.length; i++) {
    const ch = (i & 1) === 0 ? s.charCodeAt(i) : parseInt(s, 16);
    if (ch >= 10 && ch <= 90)
      n++;
  }
  return n;
}
const texts = ["", "A", "Az", "@[`{", "0129_", "caf\xE9", "\u65E5\u672C", "a\uD83D\uDE00b", "\uD83D", "\uDE00\uD83D", "\uDBFF\uDFFF", cat("AB", "cd"), part("xxMNxx", 2, 4), cat("\u65E5", "Z"), "\x00\x01", "\uFFFF"];
for (const s of texts) {
  for (const i of [-1, 0, 1, 2, 3, 0.5, 1.9, -0, NaN, 1 / 0, -1 / 0, 2147483648, 4294967296, -2147483649]) {
    let line = show(s) + " " + show(i) + " " + isLetterAt(s, i) + " " + classify(s, i) + " " + withEnd(s, i);
    for (let which = 0;which < 4; which++)
      line += " " + joined(s, i, which);
    print(line + " " + ofFraction(s, i, 0) + ofFraction(s, i, 1));
  }
  print(show(s) + " " + aroundALoop(s) + " " + scanWord(s, 0) + " " + scanWord(s, 1) + " " + countLetters(s) + " " + countJoined(s) + " " + countNested(s) + " " + countAround(s) + " " + countFractions(s) + " " + countParsed(s));
}
function nil() {
  return texts.length > 1000 ? "" : undefined;
}
print(attempt(() => classify(nil(), 0)) + " " + attempt(() => isLetterAt(nil(), 0)) + " " + attempt(() => joined(nil(), 0, 2)) + " " + attempt(() => joined(nil(), 0, 0)));
globalThis.kept = [countLetters, countJoined, countNested, countAround, countFractions, countParsed];
console.log("number");
