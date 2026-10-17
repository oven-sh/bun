// `if` chains and `switch` statements in which one string literal has 31, 32 or 33 characters.
declare const console: { log(...a: unknown[]): void }
function a(s: string): number { if (s === "abcdefghijklmnopqrstuvwxyz012345") return 0; if (s === "beta") return 1; if (s === "gamma") return 2; return -1 }
function b(s: string): number { switch (s) { case "x": return 0; case "abcdefghijklmnopqrstuvwxyz01234": return 1; case "abcdefghijklmnopqrstuvwxyz012345": return 2; case "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345": return 3; default: return -1 } }
function c(s: string): number { if (s === "abcdefghijklmnopqrstuvwxyz012345") return 0; if (s === "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345") return 1; if (s === "543210zyxwvutsrqponmlkjihgfedcba") return 2; return -1 }
function d(s: string): number { if (s === "abcdefghijklmnopqrstuvwxyz01234") return 0; if (s === "iota") return 1; if (s === "zeta") return 2; return -1 }
const ladders: ((s: any) => number)[] = [a, b, c, d]
const words: string[] = ["abcdefghijklmnopqrstuvwxyz012345", "abcdefghijklmnopqrstuvwxyz01234", "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "543210zyxwvutsrqponmlkjihgfedcba", "beta", "gamma", "iota", "zeta", "x", "", "abcdefghijklmnopqrstuvwxyz0123456", "abcdefghijklmnopqrstuvwxyz012346"]
const wideBase = String.fromCharCode(0x4e00)
function joined(w: string): string { let p = "", q = ""; for (let i = 0; i < w.length; i++) { if (i < 2) p += w[i]; else q += w[i] } return p + q }
function part(w: string): string { return ("<<" + w + ">>>").slice(2, 2 + w.length) }
function partOfWide(w: string): string { return (wideBase + w + wideBase).slice(1, 1 + w.length) }
for (let f = 0; f < ladders.length; f++) {
  let line = "abcd"[f]
  for (const make of [(w: string) => w, joined, part, partOfWide]) { line += " |"; for (const w of words) line += " " + ladders[f](make(w)) }
  console.log(line)
}
