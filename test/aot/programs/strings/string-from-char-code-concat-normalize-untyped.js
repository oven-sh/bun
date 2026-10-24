// `String(x)`, `String.fromCharCode`, `String.fromCodePoint`, `concat`, `normalize`, `isWellFormed` and `toWellFormed` (the same program without type annotations).
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
export function stringOfString(x) {
  return String(x);
}
export function stringOfNumber(x) {
  return String(x);
}
export function stringOfInteger(x) {
  return String(x | 0) + String(x & 255) + String((x | 0) * 4096);
}
export function stringOfBoolean(x) {
  return String(x);
}
export function stringOfBigInt(x) {
  return String(x);
}
export function stringOfOptional(x) {
  return String(x);
}
export function stringOfUnion(x) {
  return String(x);
}
export function stringOfAnything(x) {
  return String(x);
}
export function fromCharCode1(x) {
  return String.fromCharCode(x);
}
export function fromCharCodeMasked(x) {
  return String.fromCharCode(65 + (x & 15));
}
export function fromCharCodeByte(x) {
  return String.fromCharCode(x & 255);
}
export function fromCharCodeInteger(x) {
  return String.fromCharCode(x | 0) + String.fromCharCode((x | 0) * 65536 + 65) + String.fromCharCode(x & 65535);
}
export function fromCharCode3(x) {
  return String.fromCharCode(x, x + 1, x + 2);
}
export function fromCharCodeOfAnything(x) {
  return String.fromCharCode(x);
}
export function fromCodePoint1(x) {
  return String.fromCodePoint(x);
}
export function fromCodePointMasked(x) {
  return String.fromCodePoint(65 + (x & 15));
}
export function fromCodePointByte(x) {
  return String.fromCodePoint(x & 255);
}
export function fromCodePointInteger(x) {
  return String.fromCodePoint(x | 0);
}
export function fromCodePointOfAnything(x) {
  return String.fromCodePoint(x);
}
export function concat1(s, a) {
  return s.concat(a);
}
export function concat2(s, a, b) {
  return s.concat(a, b);
}
export function concat3(s, a, b, c) {
  return s.concat(a, b, c);
}
export function concatKnown(s, a, b) {
  const x = s, y = a, z = b;
  return x.concat(y).concat(z, y);
}
export function concatNumber(s, a) {
  return s.concat(a);
}
export function concatOfAnything(s, a, b) {
  return s.concat(a, b);
}
export function normalize0(s) {
  return s.normalize();
}
export function normalize1(s, form) {
  return s.normalize(form);
}
export function isWellFormed_(s) {
  return s.isWellFormed();
}
export function toWellFormed_(s) {
  return s.toWellFormed();
}
export function formsOfAnything(s) {
  return show(s.normalize()) + show(s.isWellFormed()) + show(s.toWellFormed());
}
const numbers = [0, -0, 1, -1, 9, 10, 42, 255, 256, 1023, 1024, 65535, 65536, 65601, 1114111, 1114112, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967361, 9007199254740991, 9007199254740992, 1000000000000000000000, -1000000000000000000000, 0.0000001, 0.1, 0.5, 1.5, -1.5, 65.9, -65.9, 123456.789, 179769313486231570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000, 0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005, NaN, 1 / 0, -1 / 0];
let line = "";
for (const x of numbers)
  line += " " + stringOfNumber(x) + "|" + stringOfInteger(x) + "|" + stringOfOptional(x) + "|" + stringOfUnion(x) + "|" + stringOfAnything(x);
print(line);
line = "";
for (const x of numbers)
  line += " " + show(fromCharCode1(x)) + show(fromCharCodeMasked(x)) + show(fromCharCodeByte(x)) + show(fromCharCodeInteger(x)) + show(fromCharCode3(x)) + show(fromCharCodeOfAnything(x));
print(line);
line = "";
for (const x of numbers)
  line += " " + attempt(() => fromCodePoint1(x)) + show(fromCodePointMasked(x)) + show(fromCodePointByte(x)) + attempt(() => fromCodePointInteger(x)) + attempt(() => fromCodePointOfAnything(x));
print(line);
for (let i = 0;i < 300; i += 37)
  print(show(fromCharCodeMasked(i)) + show(fromCodePointMasked(i)) + show(fromCharCodeByte(i)) + show(fromCodePointByte(i)) + show(stringOfInteger(i)));
print(show(stringOfString("text")) + show(stringOfString("")) + show(stringOfString(cat("ro", "pe"))) + show(stringOfString(undefined)) + show(stringOfString(null)) + show(stringOfString("\u65E5\uD800")));
print(stringOfBoolean(true) + stringOfBoolean(false) + stringOfBigInt(0n) + stringOfBigInt(-12345678901234567890123n) + stringOfOptional(undefined) + stringOfUnion(null) + stringOfUnion(undefined) + stringOfUnion(true) + stringOfUnion("s") + String() + show(String("")));
let order = "";
for (const x of [
  undefined,
  null,
  true,
  "s",
  12n,
  Symbol("described"),
  Symbol(),
  Symbol.iterator,
  {},
  [],
  [1, [2, 3]],
  { toString() {
    order += "t";
    return "by toString";
  } },
  { valueOf() {
    order += "v";
    return "by valueOf";
  }, toString: undefined },
  { [Symbol.toPrimitive](hint) {
    order += hint;
    return 7;
  } },
  { toString() {
    return {};
  }, valueOf() {
    return {};
  } },
  { toString() {
    throw new RangeError("thrown");
  } },
  new String("boxed"),
  new Number(5),
  /re/g,
  new Date(0).getTime(),
  Object.create(null)
])
  print(attempt(() => stringOfAnything(x)) + " " + attempt(() => fromCharCodeOfAnything(x)) + " " + attempt(() => fromCodePointOfAnything(x)) + " " + attempt(() => concatOfAnything("<", x, ">")));
print(order);
print(show(String.fromCharCode()) + show(String.fromCodePoint()) + show(String.fromCharCode(65, 65602, -1)) + show(String.fromCodePoint(65, 128512, 1114111)) + attempt(() => String.fromCodePoint(65, -1)) + attempt(() => String.fromCodePoint(1.5)) + attempt(() => String.fromCodePoint("65")) + attempt(() => String.fromCharCode("65", "x", null)));
const strings = [() => "", () => "a", () => "text", () => "caf\xE9", () => "\u65E5\u672C", () => cat("ro", "pe"), () => cat("r\xE9", "\u65E5"), () => part("xxpartxx", 2, 6), () => "e\u0301", () => "\xC5\u212BA\u030A", () => "\uFB01\u1E9B\u0323", () => "\uD83D\uDE00", () => "a\uD83D", () => "\uDE00a", () => cat("\uD83D", "\uDE00"), () => cat("a\uD83D", "b")];
for (const s of strings) {
  line = show(normalize0(s())) + show(isWellFormed_(s())) + show(toWellFormed_(s())) + formsOfAnything(s());
  for (const form of ["NFC", "NFD", "NFKC", "NFKD"])
    line += show(normalize1(s(), form));
  for (const other of strings)
    line += " " + show(concat1(s(), other())).length + show(concat2(s(), other(), s())).length + show(concat3(s(), other(), "-", other())).length;
  print(line + show(concatKnown(s(), "-", s())) + show(concat1(s(), "!")) + show(concat2("<", s(), ">")) + show(concatNumber(s(), 1.5)) + show(s().concat()) + show(concat1(s(), undefined)));
}
print(attempt(() => normalize1("a", "nfc")) + attempt(() => normalize1("a", "")) + attempt(() => normalize1("a", undefined)) + attempt(() => normalize1("a", null)) + attempt(() => "\u65E5".normalize({ toString() {
  return "NFD";
} })));
for (const nil of [undefined, null]) {
  const s = nil;
  print(attempt(() => concat1(s, "a")) + attempt(() => normalize0(s)) + attempt(() => isWellFormed_(s)) + attempt(() => toWellFormed_(s)) + attempt(() => formsOfAnything(nil)) + attempt(() => concatOfAnything(nil, 1, 2)));
}
for (const other of [new String("boxed"), { normalize() {
  return 1;
}, isWellFormed() {
  return 2;
}, toWellFormed() {
  return 3;
} }, 12])
  print(attempt(() => formsOfAnything(other)) + attempt(() => concatOfAnything(other, 1, 2)));
const big = "x".repeat(1073741824);
print(attempt(() => concat1(big, big).length) + attempt(() => concat2(big, big, big).length) + attempt(() => concat1(big, "").length));
globalThis.kept = [stringOfString, stringOfNumber, stringOfInteger, stringOfBoolean, fromCharCodeMasked, fromCharCode1, fromCodePointMasked, fromCharCodeByte, fromCodePointByte, concatKnown, stringOfAnything, fromCharCode3];
console.log("number");
