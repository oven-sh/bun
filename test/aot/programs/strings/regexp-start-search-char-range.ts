// Regular expressions that start with a character or a character range, searched in strings where the match begins at every position.
declare const console: { log(...a: unknown[]): void }
const runs: RegExp[] = [/ab?c/, /[a-f]x/, /a|bc|d/, /[0-9][0-9]x/, /[a-z]+@/, /[a-z][a-z][a-z]!/, /[A-Z]\d/, /[b-e]{2}z/, /[x-z]{3}/, /(?:a|b|c|d)q/, /[0-9a]:/, /[\x7e-\x82]y/, /[\x7f\x80\x81]y/, /[àáâ]x/, /[\xe0-\xe5]{2}/, /[一-丅]x/, /[乾-亂]x/, /[一丁丂]x/, /[a-c]|[d-f]g/, /[!-\/]{2}#/]
const others: RegExp[] = [/[acegi]x/, /[a-cx-z]q/, /[a-f]x/i, /[0-9a-f]{2}:/, /[aeiou][aeiou]!/, /(?:a|c|e)q/, /[\x41\xc3\x45]y/, /ab/, /a|b/, /[ab]x/]
const pieces: string[] = ["", "a", "b", "c", "d", "e", "f", "g", "q", "x", "y", "z", "!", "#", ":", "@", "0", "5", "9", "A", "Z", "`", "{", "~", "\x7f", "\x80", "\x81", "\x82", "\x83", "\xe0", "\xe1", "\xe2", "\xe5", "\xe6", "\xc3", "\xff",
  "一", "丁", "丂", "丅", "丆", "乾", "亀", "亂", "亃", "乡", "š", "Ā", "ſ", "⁡", "ａ"]
const subjects: string[] = []
for (const p of pieces) for (const tail of ["x", "y", "q", "bc", "99x", "g", ":", "!", "#", "@", "zz", "c"]) { subjects.push(p + tail); subjects.push("....." + p + tail + "..."); subjects.push("`{~\x7f" + p + p + tail) }
for (const p of ["abc", "ac", "fx", "bbz", "xyz", "12x", "me@", "abc!", "Q7", "dq", "a:", "7:", "cdg", "&&#"]) { subjects.push(p); subjects.push("一".repeat(3) + p); subjects.push("\xe9".repeat(40) + p); subjects.push("`".repeat(70) + p + "`"); subjects.push("{".repeat(17) + p.slice(0, -1)) }
let sum = 0, hits = 0
function note(s: string): void { for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) | 0 }
let number = 0
for (const list of [runs, others]) for (const r of list) {
  let found = 0, where = 0
  for (const s of subjects) { const m = r.exec(s); if (m) { found++; where += m.index; hits++; note(m.index + ":" + m[0]) } else note("-"); note(String(s.search(r)) + r.test(s) + s.replace(r, "<$&>")) }
  console.log((list === runs ? "run " : "other ") + number++, found, where)
}
console.log(runs.length, others.length, subjects.length, hits, sum)
