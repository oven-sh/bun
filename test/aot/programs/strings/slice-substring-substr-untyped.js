// Slice, substring, substr: every kind of string, every kind of place (the same program without type annotations).
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
const makers = [
  () => "The quick brown fox",
  () => "",
  () => "x",
  () => "caf\xE9 \xDF\xFF\xB5 au lait",
  () => "\u65E5\u672C\u8A9E\u306E text",
  () => "a\uD83D\uDE00b\uD83D",
  () => cat("The quick ", "brown fox"),
  () => cat("abc", "\u65E5\u672C"),
  () => cat3("one", " two ", "three"),
  () => flattened(cat("The quick ", "brown fox")),
  () => part("xxThe quick brown foxxx", 2, 21),
  () => part("xx\u65E5\u672C\u8A9E\u306E textxx", 2, 11),
  () => part(part("xxThe quick brown foxxx", 2, 21), 4, 15),
  () => part(cat("xxThe quick ", "brown foxxx"), 2, 21),
  () => flattened(part("xxThe quick brown foxxx", 2, 21))
];
const places = [0, 1, 2, 4, 5, 18, 19, 20, 100, -1, -2, -4, -18, -19, -20, -100, 0.5, 1.9, -0.5, -1.5, NaN, 1 / 0, -1 / 0, 2147483648, -2147483649, 4294967297, 1000000000000000000000, -1000000000000000000000, -0];
export function slice1(s, a) {
  return s.slice(a);
}
export function slice2(s, a, b) {
  return s.slice(a, b);
}
export function substring1(s, a) {
  return s.substring(a);
}
export function substring2(s, a, b) {
  return s.substring(a, b);
}
export function substr1(s, a) {
  return s.substr(a);
}
export function substr2(s, a, b) {
  return s.substr(a, b);
}
export function masked(s, i) {
  return show(s.slice(i & 7, 12)) + show(s.slice(-(i & 7))) + show(s.substring(i & 7, i & 3)) + show(s.substr(i & 7, i & 3)) + show(s.slice(i & 3, -(i & 3)));
}
export function sliceOfAnything(s, a, b) {
  return s.slice(a, b);
}
export function partsOfAnything(s, a, b) {
  return show(s.slice(a, b)) + show(s.substring(a, b)) + show(s.substr(a, b)) + show(s.slice(a)) + show(s.slice());
}
function hash(s) {
  let t = s.length;
  for (let i = 0;i < s.length; i++)
    t = (t * 31 + s.charCodeAt(i)) % 1000003;
  return t;
}
for (let m = 0;m < makers.length; m++) {
  const make = makers[m];
  let line = m + " " + show(make());
  for (const a of places)
    line += " " + show(slice1(make(), a)) + show(substring1(make(), a)) + show(substr1(make(), a));
  print(line);
  let t = 0;
  for (const a of places) {
    for (const b of places) {
      const x = slice2(make(), a, b), y = substring2(make(), a, b), z = substr2(make(), a, b);
      t = (t * 7 + x.length + 3 * y.length + 5 * z.length + hash(x) + hash(y) + hash(z)) % 1000003;
    }
  }
  print(" pairs " + t);
  line = "";
  for (let i = 0;i < 9; i++)
    line += " " + masked(make(), i);
  print(line);
  line = "";
  for (const [a, b] of [[1, 3], [undefined, undefined], [1, undefined], [undefined, 3], [null, 2], ["1", "3"], ["x", 2], [true, 3], [{ valueOf() {
    return 1;
  } }, [3]], [-2, undefined], [2, 1]])
    line += " " + partsOfAnything(make(), a, b);
  print(line);
}
let rest = "one,two,three,four,five,six,seven";
let seen = "";
while (rest.length > 0) {
  const comma = rest.indexOf(",");
  seen += "[" + (comma < 0 ? rest : rest.slice(0, comma)) + "]";
  rest = comma < 0 ? "" : rest.slice(comma + 1);
}
print(seen);
for (const nil of [undefined, null]) {
  const s = nil;
  print(attempt(() => slice1(s, 0)) + attempt(() => slice2(s, 0, 1)) + attempt(() => substring2(s, 0, 1)) + attempt(() => substr2(s, 0, 1)) + attempt(() => sliceOfAnything(nil, 0, 1)));
}

class Odd extends String {
  slice() {
    return "overridden";
  }
}
for (const other of [new String("boxed string"), new Odd("odd"), [1, 2, 3, 4], { slice(a, b) {
  return a + b;
} }, new Uint8Array([1, 2, 3, 4])])
  print(attempt(() => String(sliceOfAnything(other, 1, 3))));
print(attempt(() => String.prototype.slice.call(12345, 1, 3)) + attempt(() => String.prototype.substring.call(true, 1)) + attempt(() => String.prototype.substr.call({ toString() {
  return "object";
} }, 2, 2)) + attempt(() => String.prototype.slice.call(null, 0)));
let order = "";
print(show(sliceOfAnything("abcdef", { valueOf() {
  order += "a";
  return 1;
} }, { valueOf() {
  order += "b";
  return 4;
} })) + order);
globalThis.kept = [slice2, slice1, substring2, substr2, sliceOfAnything];
console.log("number");
