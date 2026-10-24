// String literals that are suffixes of other string literals, which may share storage in the executable.
declare const console: { log(...args: unknown[]): void }
const kept: unknown[] = []
function texts(): string[] { return ["a whole text with a tail", "text with a tail", "with a tail", "a tail", "tail", "il", "l", ""] }
function others(): string[] { return ["a whole text with a tai", "whole text", "a whole", "ext with a tail", "A tail", "a tail ", "tail\u00e9", "\u00e9tail"] }
function asKeys(): Record<string, number> { return { "a whole text with a tail": 1, "with a tail": 2, "tail": 3, "il": 4 } }
const a = texts(), b = others(), k = asKeys()
kept.push(a, b, k)
for (const s of a) console.log(JSON.stringify(s), s.length, a[0].endsWith(s), a[0].slice(a[0].length - s.length) === s, s in k, k[s])
for (const s of b) console.log(JSON.stringify(s), s.length, a[0].endsWith(s), a.includes(s), s in k)
console.log(a.join("|"), b.join("|"), a[4] + a[5], a[3] === "a " + a[4], Object.keys(k).join())
switch (a[4]) { case "a tail": console.log("wrong"); break; case "tail": console.log("right"); break; default: console.log("none") }
