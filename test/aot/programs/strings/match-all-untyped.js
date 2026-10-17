// `for..of` over the result of `matchAll()` skips the iterator protocol as long as the program cannot observe that (the same program without type annotations).
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
export function all(s, re) {
  let out = "";
  for (const m of s.matchAll(re))
    out += m[0] + "@" + m.index + ";";
  return out;
}
export function groups(s, re) {
  let out = "";
  for (const m of s.matchAll(re))
    out += JSON.stringify(m.groups) + m.length + (m.input === s) + ";";
  return out;
}
export function pattern(s, re) {
  let out = "";
  for (const [whole, first] of s.matchAll(re))
    out += whole + ":" + first + ";";
  return out;
}
export function untyped(s, re) {
  let out = "";
  for (const m of s.matchAll(re))
    out += m[0] + "@" + m.index + ";";
  return out;
}
export function held(it) {
  let out = "";
  for (const m of it)
    out += m[0] + ";";
  return out;
}
export function leaving(s, re, at) {
  let out = "";
  for (const m of s.matchAll(re)) {
    if (m.index === at)
      break;
    if (m.index === at - 1)
      continue;
    if (m.index === at + 10)
      return "R" + out;
    out += m[0];
  }
  return out;
}
export function throwing(s, re) {
  let out = "";
  try {
    for (const m of s.matchAll(re)) {
      try {
        if (m[0] === "b")
          throw new Error("inner");
        out += m[0];
      } catch (e) {
        out += "!";
      }
      if (m[0] === "d")
        throw new Error("outer");
    }
  } catch (e) {
    out += e.message;
  }
  return out;
}
export function nested(s) {
  let out = "";
  for (const a of s.matchAll(/\w+/g))
    for (const b of a[0].matchAll(/[aeiou]/g))
      out += a.index + b.index + b[0];
  return out;
}
export async function awaiting(s, re) {
  let out = "";
  for (const m of s.matchAll(re)) {
    await null;
    out += m[0];
  }
  return out;
}
export function* yielding(s, re) {
  for (const m of s.matchAll(re))
    yield m[0];
}
export function spread(s, re) {
  return [...s.matchAll(re)].map((m) => m[0] + m.index).join() + "|" + Array.from(s.matchAll(re), (m) => m[0]).join();
}
print(all("a1b22c333", /\d+/g) + " " + all("", /x/g) + "|" + all("abc", /x/g) + "|" + all("abc", /(?:)/g) + " " + all("\uD83D\uDE00x", /(?:)/g) + " " + all("\uD83D\uDE00x", /(?:)/gu) + " " + all("aXbx", /x/gi) + " " + all(`ab
ab`, /^a/gm) + " " + all("aaa", /a/gy) + " " + all("baa", /a/gy) + "|");
print(groups("k1=v1,k2=v2", /(?<key>\w+)=(?<value>\w+)/g) + " " + pattern("k1=v1,k2=v2", /(\w+)=\w+/g) + " " + untyped("a1b22", /\d+/g) + " " + untyped("a.b.c", ".") + " " + untyped("a1b1", 1) + " " + untyped("xundefinedx", undefined));
print(attempt(() => all("abc", /b/)) + " " + attempt(() => untyped("abc", /b/y)) + " " + attempt(() => all(undefined, /b/g)) + " " + attempt(() => untyped(null, /b/g)) + " " + attempt(() => untyped("anullb", null)));
{
  const re = /a/g;
  re.lastIndex = 2;
  print(all("aaaa", re) + re.lastIndex + " " + all("aaaa", re));
}
{
  const re = /a/g;
  let out = "";
  for (const m of "aaaa".matchAll(re)) {
    re.lastIndex = 3;
    out += m.index;
  }
  print(out + " " + re.lastIndex);
}
{
  const it = "a1b2c3".matchAll(/\d/g);
  print(held(it) + "|" + held(it) + "|" + JSON.stringify(it.next()));
}
{
  const it = "a1b2c3".matchAll(/\d/g);
  it.next();
  print(held(it));
}
{
  const it = "a1b2c3".matchAll(/\d/g);
  let out = "";
  for (const m of it) {
    out += m[0];
    out += it.next().value?.[0] ?? "-";
  }
  print(out);
}
{
  const it = "a1b2".matchAll(/\d/g);
  it.next = () => {
    log.push("own next");
    return { done: true, value: undefined };
  };
  print(held(it) + "|" + log.splice(0).join());
}
{
  const it = "a1b2".matchAll(/\d/g);
  it.return = () => {
    log.push("own return");
    return {};
  };
  let out = "";
  for (const m of it) {
    out += m[0];
    break;
  }
  print(out + log.splice(0).join());
}
{
  const it = "a1b2".matchAll(/\d/g);
  let out = "";
  for (const m of it) {
    out += m[0];
    it.return = () => {
      log.push("late return");
      return {};
    };
    break;
  }
  print(out + log.splice(0).join());
}
{
  const it = "a1b2".matchAll(/\d/g);
  let out = "";
  for (const m of it) {
    out += m[0];
    it.next = () => {
      log.push("late next");
      return { done: true };
    };
  }
  print(out + log.splice(0).join());
}
{
  const it = "a1b2".matchAll(/\d/g);
  Object.setPrototypeOf(it, { [Symbol.iterator]() {
    log.push("other iterator");
    return [["x"]][Symbol.iterator]();
  } });
  print(held(it) + log.splice(0).join());
}
{
  const it = "a1b2".matchAll(/\d/g);
  it[Symbol.iterator] = function() {
    log.push("own iterator");
    return [["y"]][Symbol.iterator]();
  };
  print(held(it) + log.splice(0).join());
}
{
  const re = /\d/g;
  re.exec = function(s) {
    log.push("own exec");
    return null;
  };
  print(all("a1b2", re) + "|" + log.splice(0).join());
}
{

  class Mine extends RegExp {
    exec(s) {
      log.push("exec");
      return super.exec(s);
    }
  }
  print(all("a1b2", new Mine("\\d", "g")) + log.splice(0).join());
}
{
  const re = /\d/g;
  re[Symbol.matchAll] = (s) => {
    log.push("own matchAll");
    return [["z"]];
  };
  print(held("a1".matchAll(re)) + log.splice(0).join());
}
for (let at = 0;at < 5; at++)
  print(leaving("abcde", /\w/g, at) + " " + leaving("abcdefghijklmno", /\w/g, at));
print(throwing("abcde", /\w/g) + " " + nested("hello brave new world") + " " + [...yielding("a1b2", /\d/g)].join() + " " + spread("a1b22", /\d+/g));
{
  let n = 0;
  const text = "the quick brown fox ".repeat(200);
  for (const m of text.matchAll(/\b\w/g))
    n += m.index;
  print(String(n));
}
(async () => {
  print(await awaiting("a1b2c3", /\d/g));
  print((await Promise.all([awaiting("x1y2", /\d/g), awaiting("p7", /\d/g)])).join());
})();
globalThis.kept = [all, groups, pattern, untyped, held, leaving, throwing, nested, awaiting, yielding, spread];
console.log("number");
