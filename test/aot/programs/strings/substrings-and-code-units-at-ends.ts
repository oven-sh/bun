// Substrings, code units and `push`, at and beyond the ends of strings and arrays.
function parts(s: string, a: number, b: number): string { return s.slice(a, b) + "|" + s.substring(a, b) + "|" + s.slice(a) + "|" + s.substring(a) }
function units(s: string): number { let t = 0; for (let i = 0; i < s.length; i++) t = (t * 31 + s.charCodeAt(i)) % 1000003; return t }
function beyond(s: string, i: number): string { const c = s.charCodeAt(i); return c !== c ? "nan" : "" + c }
const s = "hello, wörld"
let out = ""
for (let a = -14; a <= 14; a += 3) for (let b = -13; b <= 15; b += 4) out += parts(s, a, b) + ";"
console.log(out.length, units(out), units(s), units(s + s + "世"), units(""))
console.log(beyond(s, 0), beyond(s, 11), beyond(s, 12), beyond(s, -1), beyond("", 0))
const list: number[] = []
for (let i = 0; i < 1000; i++) { const n = list.push(i * 2); if (n !== i + 1) console.log("bad length", n) }
let sum = 0
for (const x of list) sum += x
const names: string[] = []
for (let i = 0; i < 100; i++) names.push("n" + i)
console.log(list.length, sum, list[999]!, names.length, names[57]!, names[99]!.length)
list[1000] = 5
console.log(list.length, list[1000]!)
