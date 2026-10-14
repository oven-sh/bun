// String literals with Latin-1, CJK, emoji and unpaired-surrogate characters, in every string method (the same program without type annotations).
class C {
  "\xE9"() {
    return "method \xE9";
  }
  get "\u2192"() {
    return "getter \u2192";
  }
  static "\uD83D\uDE00" = "static \uD83D\uDE00";
  "\u65E5\u672C\u8A9E" = "field \u65E5\u672C\u8A9E";
  #\u{e9} = "private \xE9";
  read() {
    return this.#\u{e9};
  }
}
const show = (s) => typeof s === "string" ? JSON.stringify(s) + ":" + s.length + ":" + Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16)).join(".") : String(s);
function values() {
  return ["caf\xE9", "\xE9", "\xFF\xFF", "\u2192 an arrow", "a \u2192 b \u2192 c", "\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8", "\uD83D\uDE00", "a\uD83D\uDE00b\uD83D\uDE00", "\uD800", "x\uD800y", "\uDC00\uD800", "\uD83D", "\xE9\u2192\uD83D\uDE00\uD800", "ends in \xE9", "\xE9 starts", "\u2013\u2014\u2026\u2018\u2019\u201C\u201D", "\x00\xE9", "\u01C5", "\xDF", "\u0130"];
}
for (const s of values())
  console.log(show(s), show(s.toUpperCase()), show(s.toLowerCase()), s.isWellFormed(), show(s.normalize("NFD")), encodeURIComponent(s.toWellFormed()));
function which(k) {
  return k.kind === "\xE9" ? 1 : k.kind === "\u2192" ? 2 : k.kind === "\uD83D\uDE00" ? 3 : 4;
}
function made(i) {
  return i === 0 ? { kind: "\xE9", v: i } : i === 1 ? { kind: "\u2192", v: i } : i === 2 ? { kind: "\uD83D\uDE00", v: i } : { kind: "plain", v: i };
}
const ks = [made(0), made(1), made(2), made(3)];
console.log(ks.map(which).join(), ks.map((k) => show(k.kind)).join());
function byCase(s) {
  switch (s) {
    case "\xE9":
      return "e acute";
    case "\u2192":
      return "arrow";
    case "\uD83D\uDE00":
      return "face";
    case "\uD800":
      return "half";
    case "\u65E5\u672C\u8A9E":
      return "three";
    default:
      return "none";
  }
}
console.log(["\xE9", "\u2192", "\uD83D\uDE00", "\uD800", "\u65E5\u672C\u8A9E", "e", "\uD83D", "\u65E5\u672C"].map(byCase).join());
const table = { "\xE9": 1, "\u2192": 2, "\uD83D\uDE00": 3, "\u65E5\u672C\u8A9E": 4, plain: 5 };
const keys = ["\xE9", "\u2192", "\uD83D\uDE00", "\u65E5\u672C\u8A9E", "plain", "\xE8", "\uD83D"];
console.log(keys.map((k) => table[k]).join(), keys.map((k) => (k in table)).join(), Object.keys(table).map(show).join(), Object.hasOwn(table, "\uD83D\uDE00"), table["\xE9"] + table["\u2192"]);
table["\xFC"] = 6;
table["\uD83D\uDE00\uD83D\uDE00"] = 7;
delete table["\u2192"];
console.log(JSON.stringify(table));
const c = new C;
console.log(c["\xE9"](), c["\u2192"], C["\uD83D\uDE00"], c["\u65E5\u672C\u8A9E"], c.read(), Object.getOwnPropertyNames(C.prototype).map(show).join(), c["\xE9"].name, show(Object.keys(c).join()));
function \u{95a2}\u{6570}() {
  return \u{95a2}\u{6570}.name;
}
console.log(\u{95a2}\u{6570}(), show(function \u{fc}n\u{ef}() {}.name), show((() => {}).name));
console.log(/\u00E9+/.test("caf\xE9\xE9"), "a\u2192b\u2192c".split("\u2192").join("|"), "a\uD83D\uDE00b".replace(/\uD83D\uDE00/u, "[face]"), "a\uD83D\uDE00b".replace("\uD83D\uDE00", "\u2192"), /^[\u2192-\u21FF]+$/.test("\u2192\u21D2"), /\p{Script=Han}+/u.exec("x\u65E5\u672C\u8A9Ey")?.[0], new RegExp("\xE9|\u2192", "g").source, "\xE9\u2192\xE9".replaceAll("\xE9", "e"), /(?<na\u00EFve>\u00E9)/.exec("\xE9")?.groups?.["na\xEFve"]);
console.log("caf\xE9".startsWith("caf"), "caf\xE9".endsWith("\xE9"), "caf\xE9".includes("f\xE9"), "a\u2192b".indexOf("\u2192"), "\uD83D\uDE00\uD83D\uDE00".lastIndexOf("\uD83D\uDE00"), "\xE9".localeCompare("e"), true, true, "\xE9".padStart(3, "\u2192"), "\u2192".repeat(3), "\xE9".at(0), "\uD83D\uDE00".at(1) === "\uDE00", "\uD83D\uDE00".codePointAt(0), [..."a\uD83D\uDE00\xE9"].length, "x".concat("\xE9", "\u2192"));
const name = "w\xF6rld";
console.log(`h\xE9llo ${name} \u2192 ${2} \uD83D\uDE00`, ((s, ...v) => s.map(show).join() + v.join())`\u00E9${1}\u2192${2}\u{1f600}`);
try {
  throw new TypeError("a message \u2192 with \xE9 and \uD83D\uDE00");
} catch (e) {
  console.log(show(e.message), String(e));
}
try {
  undefined.\u{e9};
} catch (e) {
  console.log(e.constructor.name);
}
console.log(show(Symbol("\xE9\u2192").description), Symbol.for("\uD83D\uDE00") === Symbol.for("\uD83D\uDE00"), show(Symbol.keyFor(Symbol.for("\u65E5\u672C\u8A9E"))), new Map([["\xE9", 1], ["\u2192", 2]]).get("\u2192"), new Set(["\uD83D\uDE00", "\xE9"]).has("\uD83D\uDE00"), ["\xE9", "\u2192", "\uD83D\uDE00"].includes("\u2192"), ["\xE9", "\u2192"].indexOf("\xE9"), ["b", "\xE9", "a", "\u2192", "\uD83D\uDE00"].sort().map(show).join());
console.log(JSON.stringify({ "\xE9": "\u2192", "\uD83D\uDE00": ["\uD800", "\u65E5\u672C\u8A9E"] }), JSON.parse('{"\xE9":"\u2192"}')["\xE9"], show(decodeURIComponent("%C3%A9")), show(unescape("%u2192")), show(String.fromCodePoint(128512) === "\uD83D\uDE00"), "e\u0301".normalize() === "\xE9", "\xE9".length + "\u2192".length + "\uD83D\uDE00".length);
