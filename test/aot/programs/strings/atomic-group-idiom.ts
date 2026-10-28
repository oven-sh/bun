// The regular-expression idiom for an atomic group, `(?=(X))\N`, and every similar form that is not that idiom.
declare const console: { log(...args: unknown[]): void }
const expressions: RegExp[] = [
  /(?=(a+))\1b/, /(?=(a+))\1b/i, /(?=(a+))\1b/u, /(?=(a+))\1b/iu, /(?=(a+))\1b/giu, /(?=(a+))\1b/y,
  /(?=(a*))\1b/iu, /(?=([\s._-]*))\1x/giu, /x(?=([\s\u{200b}-\u{200f}._-]*))\1y(?=([\s\u{200b}-\u{200f}._-]*))\2z/giu, /(?=([a-z\u{430}-\u{44f}\u{1d400}-\u{1d419}]+))\1!/giu,
  /(?:(?=(a+))\1b)*c/iu, /(?:(?=(a+))\1|b)+c/iu, /(?=((?:ab)+))\1a/iu, /(?=((a)|(b)))\1\2/iu, /(?=((a+)(b*)))\1c/iu, /^(?=(.*))\1$/iu, /(?=(\p{L}+))\1\p{N}/giu, /(?=(k+))\1s/iu, /(?=([\u{212a}k]+))\1s/iu,
  /(?=(a+))\1.\1/iu, /(?=(a+))\1\1/iu, /(a)(?=(b+))\1/iu, /(a)(?=(b+))\2\1/iu, /(?!(a+))\1b/iu, /(?=(a+)|b)\1b/iu, /(?=(a+)b)\1b/iu, /(?=b(a+))\1/iu, /(?=(a+)?)\1b/iu, /(?=(a+){2})\1b/iu, /(?=(?:a+))b|(?=(a))\1/iu,
  /(?=(a+))\1*b/iu, /(?=(a+))\1+b/iu, /(?=(a+))\1?b/iu, /(?=(a+))\1{2}b/iu, /(?=(a+))\1*?b/iu, /(?=(?<n>a+))\k<n>b/iu, /(?=(?<n>a+))\1b/iu, /(?<=(?=(a+))\1)b/iu, /(?<=x)(?=(a+))\1b/iu, /(?=(a+))(?:)\1b/iu, /(?=(a+))\b\1b/iu,
  /(?=(a+))?\1b/, /(?=(a+))*\1b/i, /(?=(a+)){0}\1b/i, /(?=(é+))\1b/i, /(?=(é+))\1b/iu, /(?=(Ж+))\1b/i, /(?=(Ж+))\1b/iu, /(?=(𝐀+))\1b/u, /(?=(𝐀+))\1b/i, /(?=([^]*?))\1b/iu, /(?=(a+?))\1b/iu,
]
const subjects: string[] = ["", "b", "ab", "aab", "AAb", "aAaB", "aaa", "aaab aab", "xaab", "ababa", "abab", "aabc", "aabaabc", "bbc", "ac", "aaabbc", "x y z", "x._-y  z", "x​y‎‏z", "x​​", "абв!", "АБ!", "𝐀𝐁!", "𝐀", "abc1", "жж7", "kks", "KKks", "Ks", "ſs", "aaxaa", "aaxAA", "aaaa", "ab", "abb", "abba", "ééb", "Ééb", "Жжb", "жЖB", "𝐀𝐀b", "\ud835b", "a\nb", "│ aab │", "│ AAB", "│x . y-z"]
function show(m: RegExpExecArray | null): string { return m === null ? "-" : m.index + ":" + JSON.stringify(Array.from(m)) }
let rows = 0
for (let e = 0; e < expressions.length; e++) {
  const r = expressions[e]
  let line = ""
  for (const s of subjects) {
    r.lastIndex = 0
    const first = show(r.exec(s)), at = r.lastIndex
    const second = r.global || r.sticky ? show(r.exec(s)) : ""
    r.lastIndex = 0
    line += " " + first + (at ? "@" + at : "") + second + "|" + JSON.stringify(s.replace(r, "<$&,$1>")) + (r.test(s) ? "t" : "f")
    r.lastIndex = 0
  }
  rows++
  console.log(e + " /" + r.flags + " ->" + line)
}
console.log(rows + " rows")
