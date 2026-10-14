// `for..of`, spread and destructuring over strings whose static type is not `string`, and over iterators with ordinary and unusual result objects (the same program without type annotations).
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
function units(s) {
  let out = "";
  for (let i = 0;i < s.length; i++)
    out += (i ? "." : "") + s.charCodeAt(i).toString(16);
  return out;
}
export function walk(x) {
  let out = "";
  for (const c of x)
    out += "[" + units(c) + "]";
  return out;
}
export function walkTyped(x) {
  let out = "";
  for (const c of x)
    out += "[" + units(c) + "]";
  return out;
}
export function firstTwo(x) {
  let n = 0, out = "";
  for (const c of x) {
    out += units(c) + ",";
    if (++n === 2)
      break;
  }
  return out;
}
export function nested(x, y) {
  let n = 0;
  for (const a of x)
    for (const b of y)
      if (a === b)
        n++;
  return n;
}
export function spread(x) {
  return [...x].map(units).join("|");
}
export function destructured(x) {
  const [a, b = "default", ...rest] = x;
  return String(a === undefined ? a : units(a)) + "/" + units(b) + "/" + rest.length;
}
export function returned(x) {
  for (const c of x)
    if (c !== "a")
      return units(c);
  return "none";
}
export function thrown(x) {
  try {
    for (const c of x)
      if (c === "b")
        throw new Error("at " + c);
    return "through";
  } catch (e) {
    return e.message;
  }
}
const strings = ["", "a", "ab", "abc", "caf\xE9", "\xFF\u0100", "\u65E5\u672C\u8A9E", "\uD83D\uDE00", "a\uD83D\uDE00b", "\uD83D\uDC4D\uD83C\uDFFD", "\uD83D", "\uDE00", "\uD83D\uD83D\uDE00", "\uDE00\uD83D", "x\uD83D", "\uD83Dx", "e\u0301", cat("ab", "cd"), cat3("\uD83D\uDE00", "b", "\u65E5"), cat("\uD83D", "\uDE00"), part("xxabcdefxx", 2, 8), part("\u65E5\uD83D\uDE00\u672C", 1, 3), part("\u65E5\uD83D\uDE00\u672C", 2, 4), flattened(cat("ab", "\uD83D\uDE80")), "a".repeat(300)];
for (const s of strings)
  print(units(s).slice(0, 40) + ": " + (walk(s) === walkTyped(s) ? "same" : "TYPED DIFFERS") + " " + walk(s).slice(0, 90) + " " + firstTwo(s) + " " + spread(s).slice(0, 60) + " " + destructured(s) + " " + returned(s) + " " + thrown(s));
print("nested " + nested("abcabc", "cab") + " " + nested("\uD83D\uDE00\uD83D\uDE00", "x\uD83D\uDE00") + " " + nested("", "abc") + " " + nested(cat("ab", "ab"), part("zzabzz", 2, 4)));
print(walk(new String("a\uD83D\uDE00")) + " " + walk(Object("xy")) + " " + attempt(() => walk(5)) + " " + attempt(() => walk(undefined)) + " " + attempt(() => walk({})) + " " + attempt(() => walk(Symbol.iterator)));
{
  const it = "ab\uD83D\uDE00c"[Symbol.iterator]();
  const first = it.next();
  print(units(first.value) + " " + first.done + " " + walk(it) + " " + JSON.stringify(it.next()));
}
const log = [];
function through(inner) {
  return { [Symbol.iterator]() {
    return this;
  }, next() {
    log.push("next");
    return inner.next();
  }, return() {
    log.push("return");
    return {};
  } };
}
function collect(x, most = 100) {
  const out = [];
  for (const v of x) {
    out.push(typeof v === "string" ? units(v) : JSON.stringify(v) ?? String(v));
    if (out.length === most)
      break;
  }
  return out.join(",");
}
function* generated() {
  yield 1;
  yield "a";
  yield undefined;
  yield [2];
  return 9;
}
print(collect(through("a\uD83D\uDE00"[Symbol.iterator]())) + " " + collect(through([1, , 3][Symbol.iterator]())) + " " + collect(through(new Map([[1, 2]])[Symbol.iterator]())) + " " + collect(through(new Set(["x"]).values())) + " " + collect(through(generated())) + " " + collect(through([1, 2, 3].values()), 2) + " " + log.join());
function made(results) {
  let i = 0;
  return { [Symbol.iterator]() {
    return this;
  }, next() {
    return results[i++];
  } };
}
function watched(value, done) {
  return { get done() {
    log.push("done");
    return done;
  }, get value() {
    log.push("value");
    return value;
  } };
}
log.length = 0;
print(collect(made([watched(1, false), watched(2, 0), watched(3, ""), watched(4, null), watched(5, NaN), watched(6, "yes"), watched(7, false)])) + " " + log.join());
print(collect(made([{ value: 1 }, { value: 2, done: undefined }, { done: false }, {}, Object.freeze({ value: 5, done: false }), { done: false, value: 6 }, { value: 7, done: false, extra: 1 }, Object.create({ value: 8, done: false }), [], () => 1, { value: 9, done: {} }])));
for (const bad of [undefined, null, 1, "s", true, Symbol()])
  print(attempt(() => collect(made([{ value: 1, done: false }, bad]))));
function changed(change) {
  const inner = [10, 20, 30].values();
  return { [Symbol.iterator]() {
    return this;
  }, next() {
    const r = inner.next();
    if (!r.done)
      change(r);
    return r;
  } };
}
log.length = 0;
print(collect(changed((r) => {
  r.value++;
})) + " " + collect(changed((r) => {
  r.done = r.value === 20;
})) + " " + collect(changed((r) => {
  delete r.value;
})) + " " + collect(changed((r) => {
  delete r.done;
})) + " " + collect(changed((r) => {
  Object.defineProperty(r, "value", { get() {
    log.push("got");
    return "g";
  } });
})) + " " + collect(changed((r) => {
  r.more = 1;
})) + " " + collect(changed((r) => {
  Object.setPrototypeOf(r, null);
})) + " " + collect(changed((r) => {
  Object.freeze(r);
})) + " " + log.join());
if (typeof Intl === "object" && typeof Intl.Segmenter === "function") {
  const segmenter = new Intl.Segmenter;
  let out = "";
  for (const { segment, index } of segmenter.segment(`a\uD83D\uDC4D\uD83C\uDFFDe\u0301\r
\u65E5`))
    out += index + ":" + units(segment) + " ";
  print(out + collect(through(segmenter.segment("ab")[Symbol.iterator]())).length);
}
globalThis.kept = [walk, walkTyped, firstTwo, nested, spread, destructured, returned, thrown];
console.log("number");
