// RegExp literals that are only used in place (`test`, `exec`, `replace`, `split`) next to literals that are returned, stored or passed on: each evaluation still behaves like a new object (the same program without type annotations).
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
export function tested(s) {
  return /^[a-z]+ /.test(s);
}
export function testedUntyped(s) {
  return /^[a-z]+ /.test(s);
}
export function testedOfProperty(o) {
  return /^[a-z]+ /.test(o.text);
}
export function executed(s) {
  const m = /(\d+)-(\d+)/.exec(s);
  return m ? m[1] + "|" + m[2] + "@" + m.index : "none";
}
export function replacedAll(s) {
  return s.replace(/a/g, "[a]").replace(/b/, "[b]").replaceAll(/c/g, "[c]");
}
export function cutUp(s) {
  return s.split(/,\s*/).join("|") + " " + String(s.match(/\w+/g)) + " " + String(s.match(/(\w)(\w)/)) + " " + s.search(/,/);
}
export function heldInConstant(list) {
  const word = /^\w+$/;
  let n = 0;
  for (const s of list)
    if (word.test(s))
      n++;
  return n;
}
export function returned() {
  return /a/;
}
export function stored(into) {
  into.push(/a/);
}
export function passedOn(f) {
  return f(/a/);
}
export function globalTested(s) {
  return /a/g.test(s);
}
export function globalLoop(s, depth) {
  const r = /a/g;
  let out = "";
  let m;
  while (m = r.exec(s)) {
    out += m.index;
    if (depth)
      out += "(" + globalLoop(s, depth - 1) + ")";
  }
  return out;
}
export function sticky(s) {
  return String(/a/y.test(s)) + s.replace(/a/y, "_") + String(s.match(/a/gy));
}
export function givenProperty() {
  const r = /a/;
  const had = r.mine;
  r.mine = 1;
  return String(had);
}
export function lastIndexRead(s) {
  const r = /a/;
  r.test(s);
  return r.lastIndex;
}
export function replacedUntyped(s) {
  return s.replace(/a/g, "_");
}
export function otherMethod() {
  return /a/i.toString() + /b/.source + /c/g.flags + String(/d/.global);
}
export function replacing(s, depth) {
  return s.replace(/a/g, (m) => depth ? "<" + replacing("xax", depth - 1) + ">" : m.toUpperCase());
}
export function throwingReplacer(s) {
  try {
    return s.replace(/a/g, () => {
      throw new RangeError("mine");
    });
  } catch (e) {
    return e.message + s.replace(/a/g, "!");
  }
}
export function reentering(depth) {
  return /^1/.test({ toString() {
    log.push("toString " + depth);
    return depth ? String(Number(reentering(depth - 1))) : "1";
  } });
}
export async function awaited(s) {
  const first = /a/.test(s);
  await null;
  return String(first) + /a/.test(s) + s.replace(/a/g, "_");
}
export function* yielded(s) {
  const word = /\w/;
  for (const c of s)
    yield word.test(c);
}
print([tested("plain text"), tested("9 lives"), tested("plain text"), testedUntyped("abc d"), testedUntyped(12), testedUntyped(null), testedUntyped({ toString: () => "ok then" }), testedOfProperty({ text: "ab c" }), testedOfProperty({})].join());
print([executed("on 12-34"), executed("none"), executed("5-6 7-8"), replacedAll("abcabc"), replacedAll(""), cutUp("one, two,three"), cutUp(""), heldInConstant(["a", "b c", "d"]), heldInConstant([])].join(" ; "));
{
  const a = returned(), b = returned();
  const kept = [];
  stored(kept);
  stored(kept);
  let seen;
  const same = passedOn((r) => {
    const was = seen === r;
    seen = r;
    return String(was);
  }) + passedOn((r) => String(seen === r));
  print([a === b, kept[0] === kept[1], same, givenProperty(), givenProperty(), lastIndexRead("a"), otherMethod()].join());
}
print([globalTested("a"), globalTested("a"), globalTested("a"), globalLoop("aa", 0), globalLoop("aa", 1), globalLoop("aba", 2), sticky("aab"), sticky("aab"), sticky("baa")].join(" "));
print([replacedUntyped("banana"), replacedUntyped({ replace: (r, w) => {
  r.seen = (r.seen || 0) + 1;
  return r.source + w + r.seen;
} }), replacedUntyped({ replace: (r, w) => r.source + w + String(r.seen) })].join());
print([replacing("aba", 0), replacing("aba", 1), replacing("aa", 2), throwingReplacer("banana"), throwingReplacer("banana"), reentering(0), reentering(2), log.splice(0).join()].join(" "));
print([tested("abc def"), RegExp.lastMatch, executed("1-2"), RegExp.$1, RegExp.$2, cutUp("x,y"), show(RegExp.lastMatch)].join());
{
  let n = 0;
  for (let i = 0;i < 30000; i++) {
    if (tested(i % 3 ? "word " + i : String(i)))
      n++;
    n += replacedAll("abc" + i).length + executed(i + "-" + i).length;
  }
  print(String(n));
}
print([...yielded("a b")].join());
(async () => {
  print(await awaited("banana"));
  print((await Promise.all([awaited("a"), awaited("b")])).join());
})();
globalThis.kept = [tested, testedUntyped, testedOfProperty, executed, replacedAll, cutUp, heldInConstant, returned, stored, passedOn, globalTested, globalLoop, sticky, givenProperty, lastIndexRead, replacedUntyped, otherMethod, replacing, throwingReplacer, reentering, awaited, yielded];
console.log("number");
