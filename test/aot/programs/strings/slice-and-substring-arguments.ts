// slice() and substring() with every kind of argument (in range, reversed, negative, fractional, NaN, infinite, huge, past the end) on every internal representation of a string, inside and outside loops.
declare const console: { log(...args: unknown[]): void }
const digits = "0123456789abcdef", wide = "0123456789абвгде"
const makers: [string, () => string][] = [
  ["flat 8-bit", () => digits],
  ["flat 16-bit", () => wide],
  ["rope", () => digits.slice(0, 7) + digits.slice(7)],
  ["16-bit rope", () => digits.slice(0, 10) + wide.slice(10)],
  ["substring", () => ("<<" + digits + ">>").slice(2, 18)],
  ["substring of a substring", () => ("<<<<" + digits + ">>>>").slice(2, 22).slice(2, 18)],
  ["16-bit substring", () => ("«" + wide + "»").slice(1, 17)],
  ["empty", () => ""],
  ["one character", () => "7"],
  ["two characters", () => "7f"],
  ["three characters", () => "7fe"],
]
const places: number[] = [0, 1, 2, 3, 5, 15, 16, 17, 100, -1, -2, -3, -15, -16, -17, -100, 0.5, 1.9, -0.5, -0.99, -1.5, 15.99, 16.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967299, 9007199254740992, -9007199254740992, 1e300, -1e300, -0]
function sliceOutsideLoops(s: string, from: number, to: number): string { return s.slice(from, to) }
function substringOutsideLoops(s: string, from: number, to: number): string { return s.substring(from, to) }
function sliceFrom(s: string, from: number): string { return s.slice(from) }
function substringFrom(s: string, from: number): string { return s.substring(from) }
function sliceOfIntegers(s: string, from: number, to: number): string { return s.slice(from | 0, to | 0) }
function substringOfIntegers(s: string, from: number, to: number): string { return s.substring(from | 0, to | 0) }
function slicesInLoop(make: () => string, from: number, all: number[]): string { let out = ""; for (let i = 0; i < all.length; i++) { const s = make(); out += s.slice(from, all[i]) + "|" } return out }
function substringsInLoop(make: () => string, from: number, all: number[]): string { let out = ""; for (let i = 0; i < all.length; i++) { const s = make(); out += s.substring(from, all[i]) + "|" } return out }
function integerSlicesInLoop(s: string): string { let out = ""; for (let i = -3; i < s.length + 3; i++) for (let j = -3; j < s.length + 3; j += 2) out += s.slice(i, j) + "," + s.substring(i, j) + "|"; return out }
function countedSlices(s: string): string { let out = ""; for (let i = 0; i < s.length; i++) out += s.slice(i, i + 3) + "," + s.substring(i, i + 3) + "," + s.slice(i) + "," + s.substring(0, i) + "|"; return out }
function constants(s: string): string {
  return [s.slice(0, -1), s.slice(-3), s.slice(1), s.slice(-3, -1), s.slice(-1, -3), s.slice(0, 100), s.slice(100), s.slice(2, 1), s.slice(-100), s.slice(-100, -99), s.slice(0, 0), s.slice(0, 1), s.slice(0, 16), s.slice(-16), s.slice(-17), s.slice(1, -1), s.slice(0.5, -0.5), s.slice(NaN, Infinity), s.slice(-Infinity, 3),
    s.substring(2), s.substring(0, 100), s.substring(5, 2), s.substring(-1), s.substring(-5, -1), s.substring(100), s.substring(100, 3), s.substring(0, 0), s.substring(1, 2), s.substring(0, 16), s.substring(NaN, 4), s.substring(3, NaN), s.substring(2, Infinity), s.substring(Infinity, 2), s.substring(1.9, 3.9)].join("|")
}
function suffix(s: string, other: string): string { return s.slice(-other.length) + "|" + s.slice(0, -other.length) + "|" + s.slice(other.length) + "|" + s.substring(other.length) + "|" + s.substring(s.length - other.length) }
for (const [name, make] of makers) {
  console.log("== " + name)
  console.log(constants(make()))
  console.log(integerSlicesInLoop(make()))
  console.log(countedSlices(make()))
  for (const other of ["", "x", "xyz", digits, digits + "!"]) console.log(suffix(make(), other))
  for (const from of places) {
    let row = ""
    for (const to of places) row += sliceOutsideLoops(make(), from, to) + "," + substringOutsideLoops(make(), from, to) + "," + sliceOfIntegers(make(), from, to) + "," + substringOfIntegers(make(), from, to) + "|"
    console.log(from + ": " + sliceFrom(make(), from) + " " + substringFrom(make(), from) + " " + row)
    console.log(slicesInLoop(make, from, places))
    console.log(substringsInLoop(make, from, places))
  }
}
let kept: string[] = []
const long = (digits + wide).repeat(50)
for (let i = 0; i < 20000; i++) { const part = long.slice(i % 1500, i % 1500 + 2 + i % 9); if (i % 997 === 0) kept.push(part + ":" + part.length + ":" + part.substring(1, 3) + ":" + part.slice(-2)) }
console.log(kept.join(" "))
