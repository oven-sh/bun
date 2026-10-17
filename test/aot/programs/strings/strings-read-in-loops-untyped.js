// A loop reads a string that it does not modify (the same program without type annotations).
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
const collect = typeof globalThis.gc === "function" ? globalThis.gc : () => {};
export function sum(s) {
  let h = 0;
  for (let i = 0;i < s.length; i++)
    h = h * 31 + s.charCodeAt(i) | 0;
  return h;
}
export function points(s) {
  let h = 0;
  for (let i = 0;i < s.length; i++)
    h = h * 31 + s.codePointAt(i) | 0;
  return h;
}
export function joined(s) {
  let out = "";
  for (let i = s.length - 1;i >= 0; i--)
    out += s[i] + s.charAt(i) + s.at(-1 - i);
  return out;
}
export function beyond(s, n) {
  let out = "";
  for (let i = -2;i < n; i++)
    out += String(s.charCodeAt(i)) + "," + String(s[i]) + "," + show(s.charAt(i)) + ";";
  return out;
}
export function none(s, n) {
  let h = 7;
  for (let i = 0;i < n; i++)
    h += s.charCodeAt(i);
  return h;
}
export function nested(a, b) {
  let n = 0;
  for (let i = 0;i < a.length; i++)
    for (let j = 0;j < b.length; j++)
      if (a.charCodeAt(i) === b.charCodeAt(j))
        n += i + j + 1;
  return n;
}
export function rows(lines) {
  let n = 0;
  for (let k = 0;k < lines.length; k++) {
    const line = lines[k];
    for (let i = 0;i < line.length; i++)
      if (line.charCodeAt(i) === 32)
        n += k + 1;
  }
  return n;
}
export function changes(s) {
  let n = 0;
  for (let i = 0;i < s.length && n < 100; i++) {
    n += s.charCodeAt(i) & 7;
    if (s.charCodeAt(i) === 97)
      s = s + "b";
    if (s.length > 12)
      s = s.slice(3);
  }
  return n * 100 + s.length;
}
export function leaves(s) {
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 33)
      break;
    if (c === 32) {
      i += 2;
      continue;
    }
    i++;
  }
  return i;
}
export function asKey(s, o) {
  let h = 0;
  for (let i = 0;i < s.length; i++) {
    h = h * 31 + s.charCodeAt(i) | 0;
    if (i === 1) {
      o[s] = i;
      collect();
      const garbage = [];
      for (let k = 0;k < 2000; k++)
        garbage.push("g" + k + s);
      h += garbage.length;
      collect();
    }
  }
  return h;
}
export function handled(s) {
  let h = 0;
  for (let i = 0;i <= s.length; i++) {
    try {
      if (i === s.length)
        throw new Error("end");
      h += s.charCodeAt(i);
    } catch {
      h = -h;
    }
  }
  return h;
}
export function entered(kind, s) {
  let h = 0;
  switch (kind) {
    case "up":
      for (let i = 0;i < s.length; i++)
        h += s.charCodeAt(i);
      break;
    case "down":
      for (let i = s.length;i--; )
        h = h * 3 + s.charCodeAt(i) | 0;
      break;
    case "none":
      break;
    default:
      for (let i = 0;i < s.length; i += 2)
        h -= s.charCodeAt(i);
  }
  return h;
}
export function two(s, t, which) {
  let h = 0;
  const u = which ? s : t;
  for (let i = 0;i < u.length; i++)
    h = h + u.charCodeAt(i) * (s.length + 1) + t.length | 0;
  return h;
}
const strings = ["", "a", "ab", "hello world!", "caf\xE9", "\u65E5\u672C\u8A9E", "a\uD83D\uDE00b", "\uD83D", cat("hello ", "world"), cat3("a", "\u65E5", "c"), cat(cat("ab", "cd"), cat("ef", "gh")), part("xxhello worldxx", 2, 13), part("\u65E5hello\u65E5", 1, 6), part(cat("xxhel", "lo!xx"), 2, 8), flattened(cat("fl", "at")), "ab ".repeat(40), cat("ab ".repeat(40), "!")];
for (const s of strings)
  print(show(s.slice(0, 14)) + " " + sum(s) + " " + points(s) + " " + show(joined(s).slice(0, 24)) + " " + beyond(s, 3) + " " + none(s, 0) + " " + none(s, 2) + " " + changes(s) + " " + leaves(s) + " " + handled(s) + " " + entered("up", s) + entered("down", s) + entered("none", s) + entered("x", s));
let total = 0;
for (const a of strings)
  for (const b of strings)
    total = total * 7 + nested(a, b) + two(a, b, a.length > b.length) | 0;
print("nested " + total + " rows " + rows(strings) + " " + rows([]));
const keyed = {};
for (const s of [cat("key", "One"), part("xxkeyTwoxx", 2, 8), flattened(cat("key", "Three")), cat3("\u65E5", "key", "4"), Array.from("keyFive").join("")])
  print("asKey " + asKey(s, keyed) + " " + sum(s));
print(Object.keys(keyed).map(show).join());
function nil(which) {
  return strings.length > 1000 ? "x" : which ? null : undefined;
}
print(attempt(() => sum(nil(0))) + " " + attempt(() => none(nil(1), 0)) + " " + attempt(() => none(nil(0), 1)) + " " + attempt(() => nested("ab", nil(1))) + " " + attempt(() => nested("", nil(1))) + " " + attempt(() => entered("none", nil(0))) + " " + attempt(() => entered("up", nil(0))) + " " + attempt(() => two("a", nil(0), true)) + " " + attempt(() => leaves(nil(1))));
globalThis.kept = [sum, points, joined, beyond, none, nested, rows, changes, leaves, asKey, handled, entered, two];
console.log("number");
