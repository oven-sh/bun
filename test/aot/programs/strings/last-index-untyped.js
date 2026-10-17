// `re.lastIndex` is read and written, whatever kind of value `re` is (the same program without type annotations).
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
export function read(re) {
  return re.lastIndex;
}
export function store(re, value) {
  re.lastIndex = value;
  return re.lastIndex;
}
export function readTyped(re) {
  return re.lastIndex;
}
export function storeTyped(re, value) {
  re.lastIndex = value;
  return re.lastIndex;
}
export function tokens(re, s) {
  let out = "", i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m === null) {
      out += ".";
      i++;
    } else {
      out += "[" + m[0] + "@" + re.lastIndex + "]";
      i = re.lastIndex > i ? re.lastIndex : i + 1;
    }
  }
  return out;
}
export function tokensUntyped(re, s) {
  let out = "", i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m === null) {
      out += ".";
      i++;
    } else {
      out += "[" + m[0] + "@" + re.lastIndex + "]";
      i = re.lastIndex > i ? re.lastIndex : i + 1;
    }
  }
  return out;
}
export function bumped(re) {
  re.lastIndex++;
  re.lastIndex += 2;
  return re.lastIndex;
}
function shown(x) {
  return typeof x === "object" && x !== null ? "{" + Object.keys(x).join() + "}" : typeof x === "symbol" ? "symbol" : typeof x === "bigint" ? x + "n" : show(x);
}
function tried(f) {
  try {
    return shown(f());
  } catch (e) {
    return "throws " + e.name;
  }
}

class Mine extends RegExp {
  extra = 1;
}
const frozen = Object.freeze(/f/g);
const sealed = Object.seal(/s/g);
const fixed = /x/g;
Object.defineProperty(fixed, "lastIndex", { writable: false, value: 3 });
const watched = { valueOf() {
  log.push("valueOf");
  return 2;
} };
const receivers = [
  ["plain", /a+/],
  ["global", /a+/g],
  ["sticky", /a+/y],
  ["made", new RegExp("a+", "gy")],
  ["subclass", new Mine("a+", "g")],
  ["frozen", frozen],
  ["sealed", sealed],
  ["fixed", fixed],
  ["object", JSON.parse('{"lastIndex":5}')],
  ["empty", {}],
  ["accessor", { get lastIndex() {
    log.push("get");
    return 7;
  }, set lastIndex(v) {
    log.push("set " + shown(v));
  } }],
  ["inherits", Object.create(/a/g)],
  ["array", [1, 2]],
  ["string", "abc"],
  ["number", 5],
  ["undefined", undefined],
  ["null", null],
  ["proxy", new Proxy(/a/g, {})],
  ["function", function() {}]
];
const values = [0, 1, 5, -1, -0, 1.5, NaN, 1 / 0, 2147483648, 9007199254740992, "2", "x", "", undefined, null, true, watched, {}, [3], Symbol.iterator, 4n, cat("1", "0")];
for (const [name, re] of receivers) {
  let line = name + ": " + tried(() => read(re));
  for (const v of values)
    line += " " + tried(() => store(re, v));
  print(line + " then " + tried(() => read(re)) + " " + tried(() => bumped(re)) + " " + log.splice(0).join());
}
for (const re of [/a+/, /a+/g, /a+/y, /a+|b/gy, /(?<n>\d+)|[a-z]+/y, new RegExp(String.fromCharCode(92) + "u65e5+", "gu"), new Mine("[ab]", "y")]) {
  print(re.source + "/" + re.flags + " " + tokens(re, "aab a1 22ba") + " " + tokensUntyped(re, "aab a1 22ba") + " " + tokens(re, cat("\u65E5\u65E5a", "a")) + " " + readTyped(re) + " " + storeTyped(re, 4) + " " + re.test("aaaaaaa") + " " + readTyped(re));
}
{
  const re = /a/g;
  store(re, watched);
  print(log.join() + "|" + tried(() => re.exec("aaaa")?.index) + "|" + log.splice(0).join() + "|" + read(re));
  store(re, "1");
  print(tried(() => re.exec("aaaa")?.index) + " " + show(read(re)));
  store(re, { toString() {
    return "9";
  } });
  print(tried(() => re.exec("aaaa")) + " " + show(read(re)));
}
{
  const re = /a/g;
  for (let i = 0;i < 3; i++) {
    store(re, { tag: "t" + i, more: new Array(1000).fill(i) });
    const garbage = [];
    for (let k = 0;k < 20000; k++)
      garbage.push({ k });
    if (typeof globalThis.gc === "function")
      globalThis.gc();
    print(read(re).tag + " " + read(re).more.length + " " + garbage.length);
  }
}
globalThis.kept = [read, store, readTyped, storeTyped, tokens, tokensUntyped, bumped];
console.log("number");
