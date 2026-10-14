// `o.m(args)` where o is anything: who can tell when the method is read (the same program without type annotations).
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
const log = [];
const noted = (x, what) => {
  log.push(what);
  return x;
};
const told = (f) => {
  log.length = 0;
  const result = attempt(f);
  return result + " [" + log.join() + "]";
};
export function at(s, i) {
  return s.charCodeAt(i);
}
export function cutOff(s) {
  return s.slice(1, 3);
}
export function holds(s, x) {
  return s.includes(x);
}
export function pushed(a, x) {
  return a.push(x);
}
export function got(m, k) {
  return m.get(k);
}
export function had(m, k) {
  return m.has(k);
}
export function atNoted(s, i) {
  return s.charCodeAt(noted(i, "argument"));
}
export function atField(s, o) {
  return s.charCodeAt(o.index);
}
export function atSum(s, i, j) {
  return s.charCodeAt(i + j);
}
export function cutNoted(s, a, b) {
  return s.slice(noted(a, "first"), noted(b, "second"));
}
export function pushedNoted(a, f) {
  return a.push(f(a));
}
export function gotNoted(m, f) {
  return m.get(f(m));
}
export function chosen(s, c, i) {
  return s.charCodeAt(c ? i : noted(0, "other"));
}
export function caught(s, f) {
  try {
    return s.charCodeAt(f());
  } catch (e) {
    return "caught " + e.name;
  } finally {
    log.push("finally");
  }
}
export async function awaited(s, p) {
  return s.slice(await p, 4);
}
export function* yielded(s) {
  return s.slice(yield "ask", 4);
}
export function looped(list, i) {
  let sum = 0;
  for (const s of list)
    sum += s.charCodeAt(noted(i, "a"));
  return sum;
}
export function twice(s, i) {
  return s.charCodeAt(i) + s.charCodeAt(noted(i, "n")) + s.slice(i).length;
}
const reading = (name, f) => ({ get [name]() {
  log.push("read");
  return f;
} });
const receivers = () => [
  ["string", "abcdef"],
  ["rope", cat("abc", "def")],
  ["wide", "\u2500bcdef"],
  ["String object", new String("abcdef")],
  ["own method", { charCodeAt: (i) => "own " + i, slice: (...a) => "own " + a, includes: () => "own" }],
  ["getter", { get charCodeAt() {
    log.push("read");
    return (i) => "got " + i;
  }, get slice() {
    log.push("read");
    return (...a) => "got " + a;
  }, get includes() {
    log.push("read");
    return () => "got";
  } }],
  ["borrowed", { charCodeAt: String.prototype.charCodeAt, slice: String.prototype.slice, includes: String.prototype.includes, toString() {
    log.push("toString");
    return "xyzuvw";
  } }],
  ["no method", {}],
  ["not callable", { charCodeAt: 5, slice: 5, includes: 5 }],
  ["undefined", undefined],
  ["null", null],
  ["number", 12345],
  ["array", ["p", "q", "r", "s"]],
  ["proxy", new Proxy({}, { get(_, k) {
    log.push("trap " + String(k));
    return (...a) => "proxied " + a;
  } })]
];
for (const [name, r] of receivers())
  print(name + ": " + [() => at(r, 1), () => cutOff(r), () => holds(r, "c"), () => atNoted(r, 1), () => atField(r, { get index() {
    log.push("field");
    return 2;
  } }), () => atSum(r, { valueOf() {
    log.push("valueOf");
    return 1;
  } }, 1), () => cutNoted(r, 1, 3), () => chosen(r, false, 1), () => chosen(r, true, 1), () => caught(r, () => noted(1, "f")), () => caught(r, () => {
    log.push("f");
    throw new RangeError("mine");
  }), () => twice(r, 1)].map(told).join(" | "));
print([undefined, null, "1", 1.5, -1, NaN, { valueOf() {
  log.push("valueOf");
  return 2;
} }, true, 99, 2n, Symbol.iterator].map((i) => told(() => at("abcdef", i)) + told(() => atNoted("abcdef", i))).join(" | "));
{
  const a = [1];
  print(told(() => pushedNoted(a, (x) => {
    x.push = () => "replaced";
    return 2;
  })) + " " + a.join() + " " + told(() => pushed(a, 3)) + " " + a.join());
}
{
  const a = [1];
  print(told(() => pushedNoted(a, (x) => {
    x.extra = 1;
    return 2;
  })) + " " + a.join() + a.extra);
}
{
  const a = [1];
  print(told(() => pushedNoted(a, (x) => {
    Object.setPrototypeOf(x, { push: () => "other" });
    return 2;
  })) + " " + Array.prototype.join.call(a) + " " + told(() => pushed(a, 3)));
}
{
  const a = [1];
  print(told(() => pushedNoted(a, (x) => {
    x.length = 0;
    return 2;
  })) + " " + a.join() + " " + told(() => pushedNoted(a, (x) => {
    Object.freeze(x);
    return 3;
  })) + " " + a.join());
}
{
  const a = [1];
  const kept = a.push;
  a.push = () => "replaced";
  print(show(kept === a.push) + " " + show(kept === Array.prototype.push) + " " + told(() => kept.call(a, 2)) + " " + told(() => a.push(3)) + " " + a.join());
}
{
  const a = [1];
  const kept = a.push;
  a.push = () => "replaced";
  print(show(kept === a.push) + " " + show(kept === Array.prototype.push) + " " + told(() => kept.call(a, 2)) + " " + told(() => a.push(3)) + " " + a.join());
}
{
  const m = new Map([["k", 1]]);
  const kept = m.get;
  m.get = () => "replaced";
  print(show(kept === m.get) + " " + show(kept === Map.prototype.get) + " " + told(() => kept.call(m, "k")) + " " + told(() => m.get("k")));
}
{
  const m = new Map([["k", 1]]);
  const kept = m.get;
  m.get = () => "replaced";
  print(show(kept === m.get) + " " + show(kept === Map.prototype.get) + " " + told(() => kept.call(m, "k")) + " " + told(() => m.get("k")));
}
{
  const m = new Map([["k", 1]]);
  print(told(() => gotNoted(m, (x) => {
    x.get = () => "replaced";
    return "k";
  })) + " " + told(() => got(m, "k")) + " " + told(() => had(m, "k")));
}
{
  const m = new Map([["k", 1]]);
  print(told(() => gotNoted(m, (x) => {
    x.set("k", 2);
    return "k";
  })) + " " + told(() => gotNoted(m, (x) => {
    x.clear();
    return "k";
  })));
}
{

  class Mine extends Map {
    get(k) {
      return "mine " + super.get(k);
    }
  }
  const m = new Mine([["k", 1]]);
  print(told(() => got(m, "k")) + " " + told(() => gotNoted(m, () => "k")) + " " + told(() => had(m, "k")));
}
{

  class List extends Array {
    push(...x) {
      log.push("own push");
      return super.push(...x);
    }
  }
  const a = new List;
  print(told(() => pushed(a, 1)) + " " + told(() => pushedNoted(a, () => 2)) + " " + a.join());
}
print(told(() => got(new Set([1]), 1)) + " " + told(() => had(new Set([1]), 1)) + " " + told(() => had(new WeakMap, {})) + " " + told(() => pushed("string", 1)) + " " + told(() => pushed(reading("push", (x) => "p" + x), 1)) + " " + told(() => pushedNoted(reading("push", (x) => "p" + x), () => noted(1, "f"))));
print(told(() => looped(["ab", "cd", new String("ef"), { charCodeAt: () => 1000 }], 1)) + " " + told(() => looped(["ab", undefined], 1)) + " " + told(() => looped([], 1)));
{
  const g = yielded("abcdef");
  print(show(g.next().value) + show(g.next(2).value));
  const h = yielded(reading("slice", (...a) => "r" + a));
  log.length = 0;
  print(show(h.next().value) + log.join() + show(h.next(2).value) + log.join());
  const u = yielded(undefined);
  print(attempt(() => u.next()));
}
(async () => {
  print(show(await awaited("abcdef", Promise.resolve(2))));
  log.length = 0;
  const p = awaited(reading("slice", (...a) => "r" + a), new Promise((r) => setTimeout(() => {
    log.push("resolved");
    r(1);
  }, 0)));
  log.push("called");
  print(show(await p) + " " + log.join());
  print(await awaited(undefined, 1).then(show, (e) => "rejected " + e.name));
})();
globalThis.kept = [at, cutOff, holds, pushed, got, had, atNoted, atField, atSum, cutNoted, pushedNoted, gotNoted, chosen, caught, awaited, yielded, looped, twice];
console.log("number");
