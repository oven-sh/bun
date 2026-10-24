// The atomic-group idiom `(?=(X))\1` inside very long regular expressions.
declare const console: { log(...args: unknown[]): void }
function long(text: string, flags: string): RegExp { return new RegExp(text + "|[" + "a".repeat(17000) + "]{9}~~", flags) }
const expressions: RegExp[] = [
  long("(?=([abd-fx-z0-9_]*))\\1!", ""), long("(?=([abd-fx-z0-9_]+))\\1!", ""), long("(?=([abd-fx-z0-9_]+))\\1!", "i"), long("(?=([abd-fx-z0-9_]+))\\1!", "u"), long("(?=([abd-fx-z0-9_]*))\\1!", "iu"), long("(?=([abd-fx-z0-9_]+))\\1!", "giu"), long("(?=([abd-fx-z0-9_]+))\\1!", "y"), long("(?=([abd-fx-z0-9_]*))\\1!", "v"),
  long("(?=([^abd-fx-z0-9_]*))\\1a", ""), long("(?=([^abd-fx-z0-9_]+))\\1a", ""), long("(?=([^abd-fx-z0-9_]+))\\1a", "u"), long("(?=([^abd-fx-z0-9_]*))\\1a", "iu"), long("(?=([^abd-fx-z0-9_]+))\\1a", "giu"), long("(?=([^abd-fx-z0-9_]+))\\1a", "v"),
  long("(?=([\\w$.-]+))\\1;", ""), long("(?=([\\w$.-]*))\\1;", "u"), long("(?=([\\w$.-]+))\\1;", "iu"), long("(?=([^\\s\"'(\\[{<]+))\\1\\s", ""), long("(?=([^\\s\"'(\\[{<]+))\\1\\s", "u"), long("(?=([^\\s\"'(\\[{<]*))\\1\\s", "giu"),
  long("(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]*))\\1X", "u"), long("(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1X", "u"), long("(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1X", "iu"), long("(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1X", "giu"), long("(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]*))\\1X", "v"),
  long("(?=([^a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]*))\\1_", "u"), long("(?=([^a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1_", "u"), long("(?=([^a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1_", "iu"), long("(?=([^a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1\\u{1f600}", "u"),
  long("(?=([\\p{L}\\d_]+))\\1!", "u"), long("(?=([\\p{L}\\d_]*))\\1!", "iu"), long("(?=([^\\p{L}\\d_]+))\\1a", "u"), long("(?=([\\ud83d\\ude00ab0-9]+))\\1a", ""), long("(?=([\\ud83d\\ude00ab0-9]*))\\1X", ""), long("(?=([^\\ud83d\\ude00ab0-9]+))\\1a", ""),
  long("y(?=([abd-fx-z0-9_]+))\\1!", ""), long("y(?=([abd-fx-z0-9_]+))\\1!", "u"), long("xy(?=([abd-fx-z0-9_]*))\\1!!", "iu"), long("\\u{1f600}(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1X", "u"), long(".(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1X", "u"), long("..(?=([^a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1_", "u"),
  long("(?=([abd-fx-z0-9_]+))\\1-(?=([abd-fx-z0-9_]*))\\2;", ""), long("(?=([abd-fx-z0-9_]+))\\1-(?=([abd-fx-z0-9_]*))\\2;", "u"), long("(?=([abd-fx-z0-9_]+))\\1-(?=([^abd-fx-z0-9_]+))\\2a", "iu"), long("(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1-(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\2;", "u"), long("(?=([\\w$.-]+))\\1 (?=([abd-fx-z0-9_]+))\\2!", "giu"),
  long("(?:(?=([abd-fx-z0-9_]+))\\1|q)z", ""), long("(?:(?=([abd-fx-z0-9_]+))\\1!|q)z", "u"), long("(?:(?=([abd-fx-z0-9_]*))\\1!|(?=([\\w$.-]+))\\2;)+", "u"), long("(?:(?=([a-c\\u{1f600}-\\u{1f64f}\\u0430-\\u044f_]+))\\1X|.)+$", "u"), long("(z)?(?=([abd-fx-z0-9_]+))\\2(!)?;", "iu"), long("^(?:(?=([^\\s\"'(\\[{<]+))\\1\\s)*$", "u"),
]
const F = String.fromCodePoint, G = F(0x1f600), H = F(0x1f64f), L = F(0xd83d), T = F(0xde00), Z = F(0x436)
const subjects: string[] = ["", "a", "!", "ab!", "AB!", "ab", "c!", "abc!", "ab09_z!", "ab09_z", "  a", "--a", "cca", "CCa", "a.b-c;", "$;", ";", "a.b c", "word next", "word", "(x y", "y12_ab!", "yab", "xyab!!", "xy!!", "xyab!", "ab-xy;", "ab-;", "ab-", "-;", "ab---a", "ab-cca", "a.b ab!", "a.b ab", "qz", "abz", "ab!z", "z", "ab!a.b;ab!", "zab!;", "ab;", "zab;", "one two three ", "one two three", "one (two ",
  G + "X", G + H + "X", "a" + G + "_" + Z + "X", "A" + G + "x", G, G + "a", L + "X", "a" + L + "X", "a" + L, "_" + L, "_" + T + "X", T + "X", L + T + "X", T + L + "X", G + L + "X", L + G + "X", G + L, "x" + L + "_", L + "_", T + "_", "x" + G + "_", "xx" + L, "x" + L + G, "dd" + G, L + G, G + G + "X", G + "a" + G + "X", "q" + G + "X", L + "a" + "X", "qq" + L + "x_", G + G + "-" + H + ";", G + "-" + L + ";", Z + "7_!", Z + L + "!", L + "a", T + "a", L + L + "a", "ab" + L + "9a", L + "9X", "x" + Z + "a", G + "X" + L + "aX", "aX" + L, Z + Z + " " + G + " ",
  "ab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_z!", "ab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_zab09_z", "aaaaaaaaa~", "aaaaaaaaa~~", "xaaaaaaaaaa~~y"]
function show(m: RegExpExecArray | null): string { return m === null ? "-" : m.index + ":" + JSON.stringify(Array.from(m)) }
function sum(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
let rows = 0
for (let e = 0; e < expressions.length; e++) {
  const r = expressions[e]
  let line = ""
  for (const s of subjects) {
    r.lastIndex = 0
    const first = show(r.exec(s)), at = r.lastIndex
    const second = r.global || r.sticky ? show(r.exec(s)) : ""
    r.lastIndex = 1
    const third = r.global || r.sticky ? show(r.exec(s)) : ""
    r.lastIndex = 0
    line += " " + first + (at ? "@" + at : "") + second + third + "|" + JSON.stringify(s.replace(r, "<$&,$1,$2>")) + (r.test(s) ? "t" : "f") + s.search(r) + "," + s.split(r).length
    r.lastIndex = 0
  }
  rows++
  console.log(e + " /" + r.flags + " " + r.source.length + " " + sum(r.source) + " " + sum(String(r)) + " ->" + line)
}
console.log(rows + " rows")
