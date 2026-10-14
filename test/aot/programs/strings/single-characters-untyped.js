// A one-character string that was just read from a string is compared with a one-character literal or with another such string (the same program without type annotations).
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
export function slashAt(s, i) {
  return s[i] === "/";
}
export function slashCharAt(s, i) {
  return s.charAt(i) === "/";
}
export function slashByAt(s, i) {
  return s.at(i) === "/";
}
export function kept(s, i) {
  const x = s[i];
  return x === "/" ? "slash" : x + "!";
}
export function samePlace(s, t, i) {
  return s[i] === t[i];
}
function mayThrow(i) {
  if (i === 7)
    throw new Error("seven");
}
export function samePlaceHandled(s, t, i) {
  let a = "", b = "";
  try {
    a = s[i];
    b = t[i];
    mayThrow(i);
    return a === b;
  } catch {
    return a === b;
  }
}
export function slashHandled(s, i) {
  let c = "";
  try {
    c = s[i];
    mayThrow(i);
    return c === "/";
  } catch {
    return c === "/";
  }
}
export function twoCharacters(s, i) {
  return s[i] === "//";
}
export function notASCII(s, i) {
  return s[i] === "\xE9";
}
export function oneArmOnly(s, flag, i) {
  let x = "a";
  if (flag)
    x = s[i];
  return x === "/";
}
export function countByIndex(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    if (s[i] === "/")
      n = n + 1 | 0;
  return n;
}
export function countByCharAt(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    if (s.charAt(i) === "/")
      n = n + 1 | 0;
  return n;
}
export function countByAt(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++)
    if (s.at(i) === "/")
      n = n + 1 | 0;
  return n;
}
export function classify(s) {
  let out = "";
  for (let i = 0;i <= s.length; i++) {
    switch (s[i]) {
      case "/":
        out += "S";
        break;
      case " ":
      case "\t":
        out += "W";
        break;
      case "a":
      case "b":
        out += "L";
        break;
      case "\xE9":
        out += "E";
        break;
      case "\u65E5":
        out += "J";
        break;
      case "":
        out += "?";
        break;
      case "ab":
        out += "?";
        break;
      case undefined:
        out += "U";
        break;
      default:
        out += ".";
    }
  }
  return out;
}
function all(s, i) {
  const x = s[i], c = s.charAt(i), a = s.at(i);
  let out = "";
  out += x === "/" ? "a" : "-";
  out += x !== "/" ? "b" : "-";
  out += x == "/" ? "c" : "-";
  out += x === "/" ? "d" : "-";
  out += x === "" ? "e" : "-";
  out += x === undefined ? "f" : "-";
  out += x == null ? "g" : "-";
  out += x === "//" ? "h" : "-";
  out += x === "\xE9" ? "i" : "-";
  out += x === "\x00" ? "j" : "-";
  out += x === "\x7F" ? "k" : "-";
  out += c === "/" ? "l" : "-";
  out += c !== "/" ? "m" : "-";
  out += c === "" ? "n" : "-";
  out += c === "/" ? "o" : "-";
  out += c === "\u65E5" ? "p" : "-";
  out += a === "/" ? "q" : "-";
  out += a !== "/" ? "r" : "-";
  out += a === undefined ? "s" : "-";
  out += a === "" ? "t" : "-";
  out += x === c ? "u" : "-";
  out += x === a ? "v" : "-";
  out += c === a ? "w" : "-";
  out += x !== c ? "x" : "-";
  out += c === x ? "y" : "-";
  out += x === x ? "z" : "-";
  out += (x ?? "") < "0" ? "A" : "-";
  out += c > "/" ? "B" : "-";
  out += x ? "C" : "-";
  out += c ? "D" : "-";
  out += typeof x;
  out += c.length;
  out += (x ?? "none") + "|" + c + "|" + (a ?? "none") + "|" + (x + c);
  return out;
}
function pairs(s, t, i, j) {
  return [s[i] === t[j], s[i] !== t[j], s.charAt(i) === t.charAt(j), s[i] === t.charAt(j), s.at(i) === t[j], s.at(i) === t.charAt(j), s[i] === s[j], t.charAt(i) === t.charAt(j), s[i] == t[j]].map((b) => b ? 1 : 0).join("");
}
function withHandler(s, i) {
  try {
    const x = s[i];
    if (x === "/")
      throw new Error("slash");
    return (x === "a") + ":" + (s.charAt(i) === "a");
  } catch (e) {
    return e.message + (s[i] === "/") + (s.charAt(i) === "/");
  }
}
function reassigned(s) {
  let x = s[0];
  let out = "";
  for (let i = 1;i <= s.length; i++) {
    out += x === "/" ? "S" : x === undefined ? "U" : ".";
    x = s[i];
  }
  return out + (x === undefined);
}
function oneArm(s, flag, i) {
  let x = "/";
  if (flag)
    x = s[i];
  return (x === "/") + ":" + (x === "a") + ":" + (x === undefined);
}
function anything(s, i) {
  return (s[i] === "/") + ":" + (s.charAt(i) === "/") + ":" + (s.at(i) === "/") + ":" + (s[i] === s.charAt(i)) + ":" + (s[i] === undefined);
}
const strings = ["", "/", "a/b", "//", "\x00/", "\xE9/\xE9", "\u65E5/\u672C", "\uFF0F/", "\u012F/", cat("ro/", "pe/"), part("xx/yy/zz", 1, 6), "a b\tab/", "\uD83D\uDE00/", "\x7F\x80"];
for (const s of strings) {
  print(show(s) + " " + countByIndex(s) + countByCharAt(s) + countByAt(s) + " " + classify(s) + " " + reassigned(s));
  for (const i of [0, 1, 2, -1, s.length - 1, s.length, 100, 0.5, NaN, -0])
    print("  " + i + " " + show(all(s, i)) + " " + withHandler(s, i) + " " + oneArm(s, true, i) + " " + oneArm(s, false, i) + " " + anything(s, i));
  print("  " + [0, 1, 2, -1, 7, 0.5].map((i) => [slashAt(s, i), slashCharAt(s, i), slashByAt(s, i), slashHandled(s, i), twoCharacters(s, i), notASCII(s, i), oneArmOnly(s, true, i), oneArmOnly(s, false, i), samePlace(s, "a/\xE9", i), samePlaceHandled(s, "a/\xE9", i)].map((b) => b ? 1 : 0).join("") + show(kept(s, i))).join(" "));
  for (const t of ["", "/", "b/a", "\u65E5/"])
    print("  " + show(t) + " " + [[0, 0], [1, 1], [0, 1], [1, 0], [5, 5], [5, 0], [0, 5], [-1, -1], [2, 2]].map(([i, j]) => pairs(s, t, i, j)).join(" "));
}
print(attempt(() => anything(["/", "a"], 0)) + " " + attempt(() => anything({ 0: "/", charAt: () => "/", at: () => "x" }, 0)) + " " + attempt(() => anything(null, 0)) + " " + attempt(() => anything("a/", "1")) + " " + attempt(() => anything(new String("/"), 0)));
let big = "";
for (let i = 0;i < 3000; i++)
  big += i % 7 === 0 ? "/" : String.fromCharCode(32 + i % 90);
print(countByIndex(big) + " " + countByCharAt(big) + " " + countByAt(big) + " " + classify(big).length);
globalThis.kept = [slashAt, slashCharAt, slashByAt, kept, samePlace, samePlaceHandled, slashHandled, twoCharacters, notASCII, oneArmOnly];
console.log("number");
