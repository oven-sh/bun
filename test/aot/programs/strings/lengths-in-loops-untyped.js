// Loops that read nothing of a string but its length (the same program without type annotations).
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
export function counted(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    n += i;
  return n;
}
export function greater(s, t) {
  let c = 0;
  for (let i = 0;i < Math.max(s.length, t.length); i++)
    c += i;
  return c;
}
export function nested(s, t) {
  let c = 0;
  for (let i = 0;i < s.length; i++)
    for (let j = 0;j < t.length; j++)
      c += i * j;
  return c;
}
export function downwards(s) {
  let n = 0;
  for (let i = s.length;i > 0; i--)
    n += s.length - i;
  return n;
}
export function whileLoop(s) {
  let i = 0;
  while (i * i < s.length)
    i++;
  return i;
}
export function optional(s) {
  let n = 0;
  for (let i = 0;i < (s?.length ?? 3); i++)
    n += i;
  return n;
}
export function nilThrows(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    n++;
  return n;
}
export function neverEntered(s, limit) {
  let n = 0;
  for (let i = 0;i < limit && i < s.length; i++)
    n++;
  return n;
}
export function lengthAndCharacters(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    n += s.charCodeAt(i);
  return n;
}
export function lengthOfOneCharactersOfOther(s, t) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    n += t.charCodeAt(i % t.length);
  return n;
}
export function lengthFirstCharactersInInner(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    for (let j = 0;j < 2; j++)
      n += s.charCodeAt(i) + j;
  return n;
}
export function lengthInInnerOnly(s, t) {
  let n = 0;
  for (let i = 0;i < 3; i++) {
    n += t.charCodeAt(i);
    for (let j = 0;j < s.length; j++)
      n += j;
  }
  return n;
}
export function changesInLoop(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++) {
    n += s.length;
    if (i === 1)
      s = s + "xy";
    if (i > 8)
      break;
  }
  return n;
}
export function untypedLength(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    n += i;
  return n;
}
const wide = (s) => ("\u65E5" + s).slice(1);
const rope = (s) => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const cutOut = (s) => ("<<" + s + ">>").substring(2, 2 + s.length);
const kinds = [["same", (s) => s], ["wide", wide], ["rope", rope], ["part", cutOut], ["longRope", (s) => s + "0123456789".repeat(30) + s]];
for (const [name, make] of kinds)
  print(name + ": " + ["", "a", "abc", "abcdefghij"].map((t) => [counted(make(t)), greater(make(t), make("abc")), greater("abcd", make(t)), nested(make(t), make("xy")), downwards(make(t)), whileLoop(make(t)), optional(make(t)), neverEntered(make(t), 0), neverEntered(make(t), 2), lengthAndCharacters(make(t)), lengthOfOneCharactersOfOther(make(t), make("pq")), lengthFirstCharactersInInner(make(t)), lengthInInnerOnly(make(t), make("pqr")), changesInLoop(make(t)), untypedLength(make(t))].join()).join(" | "));
print([() => nilThrows(undefined), () => nilThrows(null), () => counted(undefined), () => greater("a", null), () => optional(), () => optional(undefined), () => neverEntered(null, 0), () => neverEntered(null, 1), () => untypedLength([1, 2, 3]), () => untypedLength({ length: 4 }), () => untypedLength(7), () => untypedLength(null)].map(attempt).join());
globalThis.kept = [counted, greater, nested, downwards, whileLoop, optional, nilThrows, neverEntered, lengthAndCharacters, lengthOfOneCharactersOfOther, lengthFirstCharactersInInner, lengthInInnerOnly, changesInLoop, untypedLength];
console.log("number");
