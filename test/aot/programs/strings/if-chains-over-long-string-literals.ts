// `if` chains that compare a string with long string literals of equal and of different lengths.
declare const console: { log(...a: unknown[]): void }
function shape(s: string): number { if (s === "abcdefghijklmnopqrstuvwxyzABC") return 0; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL") return 1; if (s === "abcdefghijklmnopqrstu1") return 2; if (s === "abcdefghijklmnopqrstu2") return 3; if (s === "abcdefghijklmnopqrstuv1") return 4; if (s === "abcdefghijklmnopqrstuv2") return 5; return -1 }
function longsOfOneLength(s: string): number { if (s === "ab") return 0; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM#") return 1; if (s === "abcdefghijklmnopqrst#vwxyzABCDEFGHIJKLMN") return 2; if (s === "#bcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN") return 3; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN") return 4; return -1 }
function manyLengths(s: string): number { if (s === "ab") return 0; if (s === "abcde") return 1; if (s === "abcdefghi") return 2; if (s === "abcdefghijklmnop") return 3; if (s === "abcdefghijklmnopqrstuvwxyzABCDEF") return 4; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFG") return 5; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN") return 6; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") return 7; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ") return 8; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR") return 9; return -1 }
function longFirst(s: string): number { if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL") return 0; if (s === "abcdefghijklmnopqrstuvwxyzABC") return 1; if (s === "abcdefghijklmnopqrstuv") return 2; return -1 }
function onlyLongs(s: string): number { if (s === "abcdefghijklmnopqrstuvwxyzABCDEFG") return 0; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGH") return 1; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX") return 2; return -1 }
function shortThenLongs(s: string): number { if (s === "x") return 0; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFG") return 1; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-a") return 2; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-a") return 3; return -1 }
function longInTheMiddle(s: string): number { if (s === "ab") return 0; if (s === "abc") return 1; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRS") return 2; if (s === "abcd") return 3; if (s === "abcde") return 4; return -1 }
function sameLengthShortAndNot(s: string): number { if (s === "abcdefghijklmnopqrstuvwxyzABCDEF") return 0; if (s === "abcdefghijklmnopqrstuvwxyzABCDE#") return 1; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFG") return 2; if (s === "abcdefghijklmnopqrstuvwxyzABCDEF#") return 3; return -1 }
function bySwitch(s: string): number { switch (s) { case "ab": return 0; case "abcde": return 1; case "abcdefghi": return 2; case "abcdefghijklmnop": return 3; case "abcdefghijklmnopqrstuvwxyzABCDEF": return 4; case "abcdefghijklmnopqrstuvwxyzABCDEFG": return 5; case "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN": return 6; case "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-": return 7; case "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ": return 8; case "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR": return 9; } return -1 }
function orNil(s: string | undefined): number { if (s === "abcdefghijklmnopqrstuvwxyzABC") return 0; if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL") return 1; if (s === "abcdefghijklmnopqrstu1") return 2; if (s === "abcdefghijklmnopqrstu2") return 3; if (s === "abcdefghijklmnopqrstuv1") return 4; if (s === "abcdefghijklmnopqrstuv2") return 5; return -1 }
function anyOf(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxyzABC" || s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" || s === "abcdefghijklmnopqrstu1" || s === "abcdefghijklmnopqrstu2" || s === "abcdefghijklmnopqrstuv1" || s === "abcdefghijklmnopqrstuv2" }
function inLoop(list: string[]): number { let n = 0; for (const s of list) { if (s === "abcdefghijklmnopqrstuvwxyzABC") { n += 1 } else if (s === "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL") { n += 3 } else if (s === "abcdefghijklmnopqrstu1") { n += 9 } else if (s === "abcdefghijklmnopqrstu2") { n += 27 } else if (s === "abcdefghijklmnopqrstuv1") { n += 81 } else if (s === "abcdefghijklmnopqrstuv2") { n += 243 } } return n }
const ladders: ((s: string) => number)[] = [shape, longsOfOneLength, manyLengths, longFirst, onlyLongs, shortThenLongs, longInTheMiddle, sameLengthShortAndNot, bySwitch, orNil]
const booleans: ((s: string) => boolean)[] = [anyOf]
const loops: ((list: string[]) => number)[] = [inLoop]
const texts: string[] = ["abcdefghijklmnopqrstuvwxyzABC", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", "abcdefghijklmnopqrstu1", "abcdefghijklmnopqrstu2", "abcdefghijklmnopqrstuv1", "abcdefghijklmnopqrstuv2", "ab", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM#", "abcdefghijklmnopqrst#vwxyzABCDEFGHIJKLMN", "#bcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN", "abcde", "abcdefghi", "abcdefghijklmnop", "abcdefghijklmnopqrstuvwxyzABCDEF", "abcdefghijklmnopqrstuvwxyzABCDEFG", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR", "abcdefghijklmnopqrstuv", "abcdefghijklmnopqrstuvwxyzABCDEFGH", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX", "x", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-a", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-a", "abc", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRS", "abcd", "abcdefghijklmnopqrstuvwxyzABCDE#", "abcdefghijklmnopqrstuvwxyzABCDEF#"]
function flat(s: string): string { return JSON.parse(JSON.stringify(s)) }
const kinds: [string, (t: string) => string][] = [
  ["flat", (t: string) => flat(t)],
  ["a part", (t: string) => flat("<<<" + t + ">>").substring(3, 3 + t.length)],
  ["a part at the end", (t: string) => flat("<<<<<" + t).slice(-t.length)],
  ["a rope of two", (t: string) => flat(t.slice(0, t.length >> 1)) + flat(t.slice(t.length >> 1))],
  ["a part of 16 bits", (t: string) => flat("一" + t + "一").substring(1, 1 + t.length)],
  ["flat, the last character of 16 bits", (t: string) => flat(t.slice(0, -1) + "一")],
  ["the last character another", (t: string) => flat(t.slice(0, -1) + "~")],
  ["the first character another", (t: string) => flat("~" + t.slice(1))],
  ["the middle character another", (t: string) => flat(t.slice(0, t.length >> 1) + "~" + t.slice((t.length >> 1) + 1))],
  ["one longer", (t: string) => flat(t + "~")],
  ["one shorter", (t: string) => flat(t.slice(0, -1))],
  ["a part, the last character another", (t: string) => flat("<" + t.slice(0, -1) + "~>").substring(1, 1 + t.length)],
  ["a rope, the last character another", (t: string) => flat(t.slice(0, 1)) + flat(t.slice(1, -1) + "~")],
]
let sum = 0, asked = 0
function note(n: number): void { sum = (sum * 31 + n + 7) | 0; asked++ }
for (const [name, make] of kinds) {
  let found = 0
  for (const t of texts) {
    for (const f of ladders) { const s = make(t), first = f(s); note(first); note(f(s)); if (first >= 0) found++ }
    for (const f of booleans) note(f(make(t)) ? 1 : 0)
    for (const f of loops) note(f([make(t), flat(t), make(t)]))
  }
  console.log(name + ": " + found)
}
console.log(orNil(undefined), ladders.length, texts.length, kinds.length, asked, sum)
