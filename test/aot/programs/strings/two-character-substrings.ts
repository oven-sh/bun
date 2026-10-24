// Two-character substrings, which JavaScriptCore serves from a cache without allocating.
declare const console: { log(...args: unknown[]): void }
const bases: string[] = ["0123456789abcdef", "éèabcdüö", "Ж日abЖ日cd", "ab" + "cdef".slice(0) + String(12), "<<a part of this>>".slice(2, 16), "xy"]
let sum = 0, kept: string[] = []
for (let turn = 0; turn < 3; turn++) for (const base of bases) {
  for (let i = 0; i < 6000; i++) {
    const at = i % (base.length - 1)
    const a = base.slice(at, at + 2), b = base.substring(at, at + 2), c = base.substr(at, 2)
    sum = (sum * 31 + a.charCodeAt(0) * 7 + a.charCodeAt(1) + b.length + (a === b ? 1 : 0) + (b === c ? 2 : 0) + (a === base[at] + base[at + 1] ? 4 : 0)) % 1000003
    if (i % 997 === 0) kept.push(a + "|" + b + "|" + c)
  }
  console.log(JSON.stringify(base.slice(0, 6)), sum, kept.length, JSON.stringify(kept[kept.length - 1]))
}
const hex = "00ff10a7deadbeef7f80"
let bytes = 0
for (let round = 0; round < 4000; round++) for (let i = 0; i < hex.length; i += 2) bytes = (bytes + parseInt(hex.slice(i, i + 2), 16)) % 65521
console.log("hex", bytes, kept.join().length)
