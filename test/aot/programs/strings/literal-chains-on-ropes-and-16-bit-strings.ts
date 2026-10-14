// `if` chains and `switch` statements over string literals outside loops, applied to flat strings, ropes, substrings and 16-bit strings.
function one(s: string): number { if (s === "alpha") return 1; return 0 }
function two(s: string): number { if (s === "alpha") return 1; else if (s === "gamma") return 2; return 0 }
function three(s: string): number { switch (s) { case "a1": return 1; case "beta": return 2; case "gamma": return 3; default: return 0 } }
function four(s: string): number { switch (s) { case "a1": return 1; case "beta": return 2; case "gamma": return 3; case "delta": return 4; default: return 0 } }
function eleven(s: string): number { switch (s) { case "k0": return 10; case "k1": return 11; case "k22": return 12; case "k33": return 13; case "k444": return 14; case "k555": return 15; case "k6666": return 16; case "k7777": return 17; case "k88888": return 18; case "k99999": return 19; case "kaaaaaa": return 20; default: return 0 } }
function anything(s: unknown): number { if (s === "alpha") return 1; else if (s === "gamma") return 2; else if (s === "a1") return 3; return 0 }
function withOneBeyondLatin1(s: string): number { if (s === "alpha") return 1; else if (s === "Ж") return 2; else if (s === "gamma") return 3; return 0 }
function all(s: string): string { return [one(s), two(s), three(s), four(s), eleven(s), anything(s), withOneBeyondLatin1(s)].join() }
function rope(a: string, b: string): string { return a + b }
function part(s: string, from: number, to: number): string { return s.slice(from, to) }
function wide(s: string): string { return ("→" + s).slice(1) }
const flat = ["alpha", "gamma", "a1", "beta", "delta", "k0", "k1", "k22", "k33", "k444", "k555", "k6666", "k7777", "k88888", "k99999", "kaaaaaa", "", "x", "alphb", "gammA", "kbbbbbb", "Ж", "a longer text than any of them"]
console.log(flat.map(all).join(" "))
console.log(flat.map(s => all(rope(s.slice(0, 1), s.slice(1)))).join(" "))
console.log(flat.map(s => all(rope(rope(s.slice(0, 1), s.slice(1, 2)), s.slice(2)))).join(" "))
console.log(flat.map(s => all(part("<<" + s + ">>", 2, 2 + s.length))).join(" "))
console.log(flat.map(s => all(wide(s))).join(" "))
console.log(flat.map(s => all(rope(wide(s.slice(0, 1)), s.slice(1)))).join(" "))
console.log(flat.map(s => all(rope(s, "→").slice(0, s.length))).join(" "))
console.log([1, undefined, null, true, {}, [], "alpha", rope("al", "pha"), wide("gamma"), part("xa1x", 1, 3)].map(anything).join())
