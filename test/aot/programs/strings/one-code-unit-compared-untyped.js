// A single character read from a string is compared with one-character literals, ASCII or not (the same program without type annotations).
const say = globalThis.print ?? console.log;
function wideCases(s) {
  let n = 0;
  for (let i = 0;i < s.length; i++) {
    switch (s[i]) {
      case "\u2028":
        n += 1;
        break;
      case "\u2029":
        n += 10;
        break;
      case "\xE9":
        n += 100;
        break;
      case "\uD835":
        n += 1000;
        break;
      case "\uDC00":
        n += 1e4;
        break;
      case "a":
        n += 1e5;
        break;
      case "\u07FF":
        n += 1e6;
        break;
      case "\u0800":
        n += 1e7;
        break;
      case "\uFFFF":
        n += 1e8;
    }
  }
  return n;
}
function byCharAt(s, i) {
  const c = s.charAt(i | 0);
  return c === "\u2028" ? 1 : c === "\xE9" ? 2 : c === "a" ? 3 : c === "" ? 4 : 0;
}
function byAt(s, i) {
  const c = s.at(i | 0);
  return c === "\u2029" ? 1 : c === "\xE9" ? 2 : c === "a" ? 3 : c === undefined ? 4 : 0;
}
function byIndex(s, i) {
  const c = s[i | 0];
  return c === "\u2028" ? 1 : c === "\xE9" ? 2 : c === "a" ? 3 : c === undefined ? 4 : 0;
}
function twoUnits(s, i) {
  return s[i] === "\uD835\uDC00";
}
function differs(s, i) {
  return s[i] !== "\u2028";
}
function unknownCases(x) {
  let n = 0;
  for (let i = 0;i < x.length; i++) {
    switch (x[i]) {
      case "a":
        n += 1;
        break;
      case "\u0100":
        n += 1e6;
        break;
      case "\u2028":
        n += 10;
        break;
      case "\xE9":
        n += 100;
        break;
      case "\uD835":
        n += 1000;
        break;
      case "a":
        n += 1e5;
    }
  }
  return n;
}
function unknownOutside(x, i) {
  switch (x[i]) {
    case "a":
      return "a";
    case "\u2028":
      return "ls";
    case "\xE9":
      return "e";
    default:
      return "other";
  }
}
function looselyWithNumber(s, i) {
  const c = s[i];
  return (c == 5) + ":" + (c == "5") + ":" + (c == "\u2028") + ":" + (c == undefined) + ":" + (c == null);
}
function ofAnything(x, i) {
  const c = x[i];
  return (c === "\u2028") + ":" + (c === "a") + ":" + (c === "\xE9") + ":" + (c === undefined);
}
function everyCase(s, i) {
  switch (s[i]) {
    case "a":
      return "a";
    case "\xE9":
      return "e";
    case "\u2028":
      return "ls";
    case "\u2029":
      return "ps";
    case "\uD835":
      return "lead";
    case "\uDC00":
      return "trail";
    case "\uFFFF":
      return "last";
    case undefined:
      return "undefined";
    default:
      return "other";
  }
}
const subjects = ["a\u2028\u2029\xE9", "\xE9a\xE9", "x\uD835\uDC00y", "\uD835", "\uDC00\uD835", "\u07FF\u0800\uFFFF", "", "aaaa", "\u2028".repeat(3) + "a", ("z\u2029" + "q").slice(1), ("\xE9\xE9" + "a").slice(1)];
for (const s of subjects) {
  const row = [wideCases(s)];
  for (const i of [0, 1, 2, -1, 99])
    row.push(byCharAt(s, i), byAt(s, i), byIndex(s, i), twoUnits(s, i), differs(s, i));
  say(row.join(" "));
}
for (const s of subjects)
  say([0, 1, 2, 3, -1, 99, 0.5, NaN].map((i) => everyCase(s, i)).join(" ") + " | " + [0, 1, 99].map((i) => looselyWithNumber(s, i)).join(" "));
say([looselyWithNumber("5\u2028", 0), looselyWithNumber("5\u2028", 1), looselyWithNumber("5\u2028", 2)].join(" "));
for (const x of ["a\u2028", new String("a\u2028"), ["a", "\u2028", "ab", "\u2028\u2028"], ["\xE9", 5, undefined, null], { 0: "\u2028", 1: "a" }, new Map, 5, true])
  say([0, 1, 2, 3, "0", "length"].map((i) => ofAnything(x, i)).join(" "));
const anything = ["a\u0100b\u0100", "a\u2028a\xE9", "aaa", "\xE9\xE9", ("a\u2028" + "xyz").slice(0, 2), "ro" + "a\u2028".repeat(2), "\uD835" + "a", new String("a\u2028"), ["a", "\u2028", "aa", 5, undefined, null, "\xE9", ["a"]], { length: 3, 0: "a", 2: "\u2028" }, new Uint8Array([97, 1]), "", []];
say(anything.map(unknownCases).join(" "));
for (const x of anything)
  say([0, 1, 2, -1, 99, 0.5, "0", "length"].map((i) => unknownOutside(x, i)).join(" "));
globalThis.kept = [wideCases, byCharAt, byAt, byIndex, twoUnits, unknownCases, unknownOutside];
