// `if` chains and `switch` statements over one to many string literals, applied to every internal representation of a string.
declare const console: { log(...a: unknown[]): void }
function l1(s: string): number { if (s === "alpha") return 0; return -1 }
function w1(s: string): number { switch (s) { case "alpha": return 0; default: return -1 } }
function l2(s: string): number { if (s === "alpha") return 0; if (s === "beta") return 1; return -1 }
function w2(s: string): number { switch (s) { case "alpha": return 0; case "beta": return 1; default: return -1 } }
function l3(s: string): number { if (s === "alpha") return 0; if (s === "beta") return 1; if (s === "gamma") return 2; return -1 }
function w3(s: string): number { switch (s) { case "alpha": return 0; case "beta": return 1; case "gamma": return 2; default: return -1 } }
function l4(s: string): number { if (s === "alpha") return 0; if (s === "beta") return 1; if (s === "gamma") return 2; if (s === "delta") return 3; return -1 }
function w4(s: string): number { switch (s) { case "alpha": return 0; case "beta": return 1; case "gamma": return 2; case "delta": return 3; default: return -1 } }
function l6(s: string): number { if (s === "alpha") return 0; if (s === "beta") return 1; if (s === "gamma") return 2; if (s === "delta") return 3; if (s === "omega") return 4; if (s === "sigma") return 5; return -1 }
function w6(s: string): number { switch (s) { case "alpha": return 0; case "beta": return 1; case "gamma": return 2; case "delta": return 3; case "omega": return 4; case "sigma": return 5; default: return -1 } }
function l7(s: string): number { if (s === "alpha") return 0; if (s === "beta") return 1; if (s === "gamma") return 2; if (s === "delta") return 3; if (s === "omega") return 4; if (s === "sigma") return 5; if (s === "kappa") return 6; return -1 }
function w7(s: string): number { switch (s) { case "alpha": return 0; case "beta": return 1; case "gamma": return 2; case "delta": return 3; case "omega": return 4; case "sigma": return 5; case "kappa": return 6; default: return -1 } }
function l12(s: string): number { if (s === "alpha") return 0; if (s === "beta") return 1; if (s === "gamma") return 2; if (s === "delta") return 3; if (s === "omega") return 4; if (s === "sigma") return 5; if (s === "kappa") return 6; if (s === "theta") return 7; if (s === "iota") return 8; if (s === "zeta") return 9; if (s === "lambda") return 10; if (s === "upsilon") return 11; return -1 }
function w12(s: string): number { switch (s) { case "alpha": return 0; case "beta": return 1; case "gamma": return 2; case "delta": return 3; case "omega": return 4; case "sigma": return 5; case "kappa": return 6; case "theta": return 7; case "iota": return 8; case "zeta": return 9; case "lambda": return 10; case "upsilon": return 11; default: return -1 } }
function l13(s: string): number { if (s === "alpha") return 0; if (s === "beta") return 1; if (s === "gamma") return 2; if (s === "delta") return 3; if (s === "omega") return 4; if (s === "sigma") return 5; if (s === "kappa") return 6; if (s === "theta") return 7; if (s === "iota") return 8; if (s === "zeta") return 9; if (s === "lambda") return 10; if (s === "upsilon") return 11; if (s === "omicron") return 12; return -1 }
function w13(s: string): number { switch (s) { case "alpha": return 0; case "beta": return 1; case "gamma": return 2; case "delta": return 3; case "omega": return 4; case "sigma": return 5; case "kappa": return 6; case "theta": return 7; case "iota": return 8; case "zeta": return 9; case "lambda": return 10; case "upsilon": return 11; case "omicron": return 12; default: return -1 } }
function same5(s: string): number { if (s === "alpha") return 0; if (s === "gamma") return 1; if (s === "delta") return 2; if (s === "omega") return 3; return -1 }
function twice(s: string): number { if (s === "beta") return 0; if (s === "iota") return 1; if (s === "beta") return 2; return -1 }
function anyOf(s: any): number { if (s === "beta") return 0; if (s === "gamma") return 1; if (s === "lambda") return 2; return -1 }
function orNil(s: string | undefined | null): number { if (s === "zeta") return 0; if (s === "theta") return 1; return -1 }
const ladders: ((s: any) => number)[] = [l1, w1, l2, w2, l3, w3, l4, w4, l6, w6, l7, w7, l12, w12, l13, w13, same5, twice, anyOf, orNil]
const names: string[] = ["l1", "w1", "l2", "w2", "l3", "w3", "l4", "w4", "l6", "w6", "l7", "w7", "l12", "w12", "l13", "w13", "same5", "twice", "anyOf", "orNil"]
const words: string[] = ["alpha", "beta", "gamma", "delta", "omega", "sigma", "kappa", "theta", "iota", "zeta", "lambda", "upsilon", "omicron", "epsilon", "", "a", "alphA", "alph", "alphaa", "betb", "lambdb", "epsiloo", "nothing of the kind"]
const wideBase = "\u4e00"
function rope(w: string): string { const k = w.length >> 1; return w.slice(0, k).concat("").concat(w.slice(k)) + "" }
function joined(w: string): string { let a = "", b = ""; for (let i = 0; i < w.length; i++) { if (i < 2) a += w[i]; else b += w[i] } return a + b }
function part(w: string): string { return ("<<" + w + ">>>").slice(2, 2 + w.length) }
function partOfWide(w: string): string { return (wideBase + w + wideBase).slice(1, 1 + w.length) }
function flatWide(w: string): string { const p = partOfWide(w); return p.length ? JSON.parse(JSON.stringify(wideBase + p)).substring(1) : p }
const bag: any = {}
function madeFlatWide(w: string): string { const p = partOfWide(w); if (bag[p] === 1) return "never"; return p }
function madeFlat(w: string): string { const p = joined(w); if (bag[p] === 1) return "never"; return p }
function partOfPart(w: string): string { return part("[" + w + "]").slice(1, 1 + w.length) }
const kinds: [string, (w: string) => string][] = [["flat", w => w], ["rope", rope], ["joined", joined], ["part", part], ["part of 16 bits", partOfWide], ["16 bits", flatWide], ["16 bits made flat", madeFlatWide], ["joined, made flat", madeFlat], ["part of a part", partOfPart]]
for (let f = 0; f < ladders.length; f++) {
  let line = names[f]
  for (const [kind, make] of kinds) {
    let answers = ""
    for (const w of words) answers += "," + ladders[f](make(w))
    line += " | " + kind + answers
  }
  console.log(line)
}
console.log(ladders[names.indexOf("anyOf")](1), ladders[names.indexOf("anyOf")](null), ladders[names.indexOf("anyOf")]({}), ladders[names.indexOf("orNil")](undefined), ladders[names.indexOf("orNil")](null), ladders[names.indexOf("orNil")](part("theta")))
console.log(ladders.length + " ladders")
