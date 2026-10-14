// Scanning a string: the length read once, the code unit compared as an integer (the same program without type annotations).
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
export function countSlashes(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    if (s.charCodeAt(i) === 47)
      n = n + 1 | 0;
  return n;
}
export function classify(s) {
  let n = 0;
  for (let pos = 0;pos < s.length; pos++) {
    const ch = s.charCodeAt(pos);
    switch (ch) {
      case 10:
      case 13:
        n = n + 1 | 0;
        break;
      case 32:
      case 9:
        break;
      case 47:
        n = n + 2 | 0;
        break;
      case 123:
      case 125:
        n = n + 5 | 0;
        break;
      default:
        if (ch >= 48 && ch <= 57)
          n = n + 3 | 0;
        else if (ch > 127)
          n = n + 4 | 0;
        else if (97 <= ch && 122 >= ch)
          n = n + 7 | 0;
    }
  }
  return n;
}
export function countDigits(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && 57 >= c)
      n = n + 1 | 0;
  }
  return n;
}
export function isDigitAt(s, i) {
  const c = s.charCodeAt(i | 0);
  return c >= 48 && c <= 57;
}
export function comparedWithFraction(s, i) {
  return s.charCodeAt(i | 0) < 47.5;
}
export function comparedWithNegative(s, i) {
  return s.charCodeAt(i | 0) > -1;
}
export function comparedWithVariable(s, i, c) {
  return s.charCodeAt(i | 0) === c;
}
function all(s, i) {
  const c = s.charCodeAt(i);
  let out = "";
  out += c === 0 ? "a" : "-";
  out += c === 47 ? "b" : "-";
  out += c === 65535 ? "c" : "-";
  out += c === 65536 ? "d" : "-";
  out += c === -1 ? "e" : "-";
  out += c !== 47 ? "f" : "-";
  out += c == 47 ? "g" : "-";
  out += c != 47 ? "h" : "-";
  out += c < 0 ? "i" : "-";
  out += c <= 0 ? "j" : "-";
  out += c > 0 ? "k" : "-";
  out += c >= 0 ? "l" : "-";
  out += c < 47 ? "m" : "-";
  out += c <= 47 ? "n" : "-";
  out += c > 47 ? "o" : "-";
  out += c >= 47 ? "p" : "-";
  out += 47 < c ? "q" : "-";
  out += 47 <= c ? "r" : "-";
  out += 47 > c ? "s" : "-";
  out += 47 >= c ? "t" : "-";
  out += c < 65535 ? "u" : "-";
  out += c <= 65535 ? "v" : "-";
  out += c > 65535 ? "w" : "-";
  out += c >= 65535 ? "x" : "-";
  out += c < 65536 ? "y" : "-";
  out += c >= 65536 ? "z" : "-";
  out += c < 9007199254740991 ? "A" : "-";
  out += c > 9007199254740991 ? "B" : "-";
  out += c < -1 ? "C" : "-";
  out += c > -1 ? "D" : "-";
  out += c >= -1 ? "E" : "-";
  out += -1 < c ? "F" : "-";
  out += c < 47.5 ? "G" : "-";
  out += c > 46.5 ? "H" : "-";
  out += c === c ? "I" : "-";
  out += c < 1 / 0 ? "J" : "-";
  out += c > -1 / 0 ? "K" : "-";
  out += Number.isNaN(c) ? "M" : "-";
  return out + " " + show(c) + " " + show(c + 1) + " " + show(c | 0) + " " + show(-c) + " " + String(c);
}
const strings = ["", "/", "a/b", "\x00", "\xFF/", "\uFFFF/\u65E5", "0123456789", cat("ro", "pe/"), cat3("a", "/", "\u65E5"), part("xx/yy/zz", 1, 6), part(cat("left/", "right/"), 2, 9), `{ foo(bar) }
	baz // c\r
`, "\uD83D\uDE00/"];
for (const s of strings) {
  print(show(s) + " " + countSlashes(s) + " " + classify(s) + " " + countDigits(s));
  for (const i of [-1, 0, 1, 2, s.length - 1, s.length, s.length + 1, 1e9, -1e9, 0.5, -0.5, NaN, 1 / 0, -1 / 0, 4294967296, 2147483648])
    print("  " + i + " " + all(s, i) + " " + isDigitAt(s, i) + comparedWithFraction(s, i) + comparedWithNegative(s, i) + comparedWithVariable(s, i, 47) + comparedWithVariable(s, i, NaN));
}
function shrinking(s) {
  let out = "";
  while (s.length > 0) {
    out += s.charCodeAt(s.length - 1) + "," + s.length + ";";
    s = s.slice(0, s.length - 1);
  }
  return out + s.length;
}
function growing(n) {
  let s = "";
  let out = "";
  for (let i = 0;i < n; i++) {
    s += i & 1 ? "/" : "x";
    out += s.length + ":" + s.charCodeAt(i) + ":" + s.charCodeAt(s.length) + ",";
  }
  return out;
}
function twoStrings(a, b) {
  let out = "";
  for (let i = 0;i < a.length; i++) {
    out += a.charCodeAt(i) + "/" + b.charCodeAt(i) + "/" + (i < b.length) + ",";
  }
  return out + a.length + b.length;
}
function swapped(a, b) {
  let out = "";
  for (let i = 0;i < 4; i++) {
    out += a.length + ":" + a.charCodeAt(2) + ",";
    const t = a;
    a = b;
    b = t;
  }
  return out;
}
function oneArm(s, flag, i) {
  let n = -1;
  if (flag)
    n = s.length;
  return n + ":" + s.charCodeAt(i) + ":" + s.at(i) + ":" + s.charAt(i) + ":" + s.codePointAt(i) + ":" + s.length;
}
function afterAccess(s, i) {
  const c = s.charCodeAt(i);
  return c + ":" + s.length + ":" + s.slice(1, s.length) + ":" + s.substring(s.length - 1) + ":" + s.at(-1);
}
function nested(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    for (let j = i;j < s.length; j++)
      if (s.charCodeAt(i) === s.charCodeAt(j) && s.charCodeAt(j) > 46)
        n++;
  return n;
}
function withHandler(s, i) {
  try {
    const c = s.charCodeAt(i);
    if (c === 47)
      throw new Error("slash " + s.length);
    return (c < 48) + ":" + (c >= 48) + ":" + s.length;
  } catch (e) {
    return e.message + ":" + s.length + ":" + s.charCodeAt(i) + ":" + (s.charCodeAt(i) === 47) + (s.charCodeAt(i + 1) > 0);
  }
}
function optional(s, i) {
  return s === undefined ? "none" : s.length + ":" + (s.charCodeAt(i) === 47) + ":" + (s.charCodeAt(i) < 48);
}
function anything(s, i) {
  return s.length + ":" + (s.charCodeAt(i) === 47) + ":" + (s.charCodeAt(i) < 48) + ":" + (s.charCodeAt(i) >= 47) + ":" + s.length;
}
for (const s of strings) {
  print(shrinking(s) + " | " + twoStrings(s, "a/b") + " | " + twoStrings("a/b", s) + " | " + swapped(s, "xy/") + " | " + nested(s));
  for (const i of [0, 1, 5, -1])
    print("  " + oneArm(s, true, i) + " | " + oneArm(s, false, i) + " | " + afterAccess(s, i) + " | " + withHandler(s, i) + " | " + optional(s, i) + " | " + anything(s, i));
}
print(growing(9) + " " + optional(undefined, 0));
print(attempt(() => anything({ length: 3, charCodeAt(i) {
  return i === 0 ? 47 : NaN;
} }, 0)) + " " + attempt(() => anything({ length: 3, charCodeAt() {
  return "47";
} }, 0)) + " " + attempt(() => anything(null, 0)) + " " + attempt(() => anything("a/", "1")));
let big = "";
for (let i = 0;i < 3000; i++)
  big += i % 7 === 0 ? "/" : String.fromCharCode(32 + i % 90);
print(countSlashes(big) + " " + classify(big) + " " + nested(big.slice(0, 200)));
globalThis.kept = [countSlashes, classify, countDigits, comparedWithFraction, comparedWithNegative, comparedWithVariable];
console.log("number");
