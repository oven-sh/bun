// `repeat()`, `padStart()` and `padEnd()`: short results, long results and errors (the same program without type annotations).
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
export function repeated(s, n) {
  return s.repeat(n);
}
export function repeatedByInteger(s, n) {
  return s.repeat(n & 7);
}
export function paddedAtEnd(s, n) {
  return s.padEnd(n);
}
export function paddedAtStart(s, n) {
  return s.padStart(n);
}
export function filledAtEnd(s, n, f) {
  return s.padEnd(n, `${f}`);
}
export function filledAtStart(s, n, f) {
  return s.padStart(n, `${f}`);
}
export function withAnyFiller(s, n, f) {
  return s.padEnd(n, f);
}
export function withAnyCount(s, n) {
  return s.repeat(n);
}
export function indented(lines, width) {
  let out = "";
  for (let j = 0;j < lines.length; j++)
    out += "  ".repeat(j & 3) + lines[j].padEnd(width) + "|" + String(j).padStart(3, "0") + `
`;
  return out;
}
export function indentedByAnything(lines, width, filler) {
  let out = "";
  for (let j = 0;j < lines.length; j++)
    out += "  ".repeat(width) + lines[j].padEnd(width, filler) + `
`;
  return out;
}
function brief(f) {
  let s;
  try {
    s = f();
  } catch (e) {
    return "throws " + e.name + ": " + e.message;
  }
  if (s.length <= 24)
    return show(s);
  let sum = 0;
  for (let i = 0;i < s.length; i++)
    sum = sum * 31 + s.charCodeAt(i) | 0;
  return s.length + ":" + show(s.slice(0, 5)) + ".." + show(s.slice(-5)) + ":" + sum;
}
const box = "\u2500";
const pair = "\uD83D\uDE00";
const numbers = [0, 1, 2, 3, 7, 8, 9, 100, 1023, 1024, 1025, 5000, -1, -0, -0.5, 0.5, 1.9, 2.5, -1.5, NaN, 1 / 0, -1 / 0, 2147483648, 4294967296, 4294967298, 9007199254740992, 1000000000000000000000, -2147483648, -9223372036854776000, 9223372036854776000, 18446744073709552000];
const strings = ["", "a", "ab", "abcdefgh", "abcdefghi", box, "a" + box, pair, cat("ro", "pe"), cat(box, "x"), part("xxsubxx", 2, 5), part("x" + box + box + "x", 1, 3), "y".repeat(512), "z".repeat(1024), "w".repeat(1025)];
for (const s of strings)
  print(brief(() => s) + " repeat: " + numbers.map((n) => brief(() => repeated(s, n))).join(" "));
for (const s of strings)
  print(brief(() => s) + " padEnd: " + numbers.map((n) => brief(() => paddedAtEnd(s, n))).join(" "));
for (const s of strings)
  print(brief(() => s) + " padStart: " + numbers.map((n) => brief(() => paddedAtStart(s, n))).join(" "));
const fillers = ["", " ", "x", "xy", "0123456789", box, box + "=", pair, cat("r", "p"), part("--fill--", 2, 6), "f".repeat(2000)];
for (const f of fillers)
  print(brief(() => f) + " fills: " + ["", "a", box, "abc"].map((s) => [0, 1, 2, 3, 4, 5, 8, 11, 1024, 1025, NaN, 1 / 0].map((n) => brief(() => filledAtEnd(s, n, f)) + "/" + brief(() => filledAtStart(s, n, f))).join(" ")).join(" ; "));
for (let n = 0;n < 10; n++)
  print(show(repeatedByInteger("ab", n)) + show(repeatedByInteger(box, n)));
{
  const s = cat("same", "one");
  print(String(paddedAtEnd(s, 3) === s) + (repeated(s, 1) === s) + (filledAtStart(s, 100, "") === s) + " " + paddedAtEnd("k", 3).length + new Map([[paddedAtEnd("k", 3), 1]]).get("k  ") + { aaa: 7 }[repeated("a", 3)] + " " + (repeated("ab", 2) + paddedAtStart("c", 2)).toUpperCase() + repeated("ab", 3).indexOf("ba") + paddedAtEnd(box, 4).charCodeAt(3));
}
print(show(indented(["one", box + "two", "", "a long line that is longer than the width", "five"], 8)));
print([undefined, null, 5, "", "ab", { toString() {
  return "<>";
} }, true].map((f) => brief(() => withAnyFiller("s", 6, f))).join(" ") + " " + ["3", null, undefined, true, { valueOf() {
  return 2;
} }, "x", [2], 2n, Symbol.iterator].map((n) => brief(() => withAnyCount("ab", n))).join(" "));
print(show(indentedByAnything(["a", "bc"], 3, "-")) + " " + show(indentedByAnything(["a"], "2", 7)));
print(attempt(() => repeated(undefined, 2)) + " " + attempt(() => paddedAtEnd(null, 2)) + " " + attempt(() => filledAtStart(undefined, 2, "x")));
globalThis.kept = [repeated, repeatedByInteger, paddedAtEnd, paddedAtStart, filledAtEnd, filledAtStart, withAnyFiller, withAnyCount, indented, indentedByAnything];
console.log("number");
