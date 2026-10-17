// Property names and strings with characters beyond the Basic Multilingual Plane (the same program without type annotations).
class Holder {
  "\uD83D\uDE00" = 1;
  \u{1d400}b = 2;
  "\uD835\uDC00 method"() {
    return 3;
  }
  static "\uD835\uDC01" = 4;
}
const say = globalThis.print ?? console.log;
function typed(s) {
  return s["\uD83D\uDE00"] + s.\u{1d400}b + s.plain.length;
}
function untyped(o) {
  return o["\uD83D\uDE00"] + o.\u{1d400}b + ("\uD83D\uDE00" in o ? 10 : 0) + ("\uD83D\uDE01" in o ? 100 : 0);
}
function removed(o) {
  delete o["\uD83D\uDE00"];
  return Object.keys(o).join("|");
}
function compared(x) {
  return (x === "\uD835\uDC00" ? 1 : 0) + (x === "\uD83D\uDE00\uD83D\uDE01" ? 2 : 0) + (x.startsWith("\uD835\uDC00") ? 4 : 0) + (x.endsWith("\uD83D\uDE01") ? 8 : 0) + (x.includes("\uD83D\uDE00") ? 16 : 0);
}
function switched(x) {
  switch (x) {
    case "\uD835\uDC00":
      return "a";
    case "\uD83D\uDE00\uD83D\uDE01":
      return "two";
    case "\uD835":
      return "half";
    default:
      return "other";
  }
}
function built(x) {
  return `<${x}\uD835\uDC00>` + "\uD83D\uDE00".length + "\uD835\uDC00".codePointAt(0) + "\uD83D\uDE00".charCodeAt(1);
}
function keyed(m, x) {
  return (m.get("\uD835\uDC00") ?? -1) + (m.get(x) ?? -2);
}
const holder = new Holder;
say([holder["\uD83D\uDE00"], holder.\u{1d400}b, holder["\uD835\uDC00 method"](), Holder["\uD835\uDC01"], Object.keys(holder).join("|")].join(" "));
say(String(typed({ "\uD83D\uDE00": 5, \u{1d400}b: 6, plain: "x\uD83D\uDE00" })));
say(String(untyped({ "\uD83D\uDE00": 5, \u{1d400}b: 6 })));
say(removed(Object.fromEntries([["\uD83D\uDE00", 5], ["\uD835\uDC00b", 6], ["z", 7]])));
for (const x of ["\uD835\uDC00", "\uD83D\uDE00\uD83D\uDE01", "\uD835\uDC00\uD83D\uDE01", "\uD835", "\uDC00", "plain"])
  say(compared(x) + " " + switched(x) + " " + built(x).length + " " + keyed(new Map([["\uD835\uDC00", 1], ["\uD83D\uDE00\uD83D\uDE01", 2]]), x));
say(JSON.stringify({ "\uD83D\uDE00": "\uD835\uDC00", half: "\uD835" }));
say(String(/^[\uD83D\uDE00-\uD83D\uDE03]+$/u.test("\uD83D\uDE01\uD83D\uDE02")) + " " + "a\uD835\uDC00b".replace("\uD835\uDC00", "-") + " " + "a\uD835\uDC00b".split("\uD835\uDC00").length + " " + "a\uD835\uDC00b".indexOf("b"));
