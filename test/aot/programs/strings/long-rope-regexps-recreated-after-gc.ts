// Long regular expressions built from concatenated strings are created, collected and created again.
declare const console: { log(...a: unknown[]): void }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true))
function narrow100(head: string, flags: string): RegExp { return new RegExp(head + "|[" + "a".repeat(100) + "]{9}~", flags) }
function sixteen100(head: string, flags: string): RegExp { return new RegExp(head + "\u4e00|[" + "a".repeat(100) + "]{9}~", flags) }
function narrow4080(head: string, flags: string): RegExp { return new RegExp(head + "|[" + "a".repeat(4080) + "]{9}~", flags) }
function sixteen4080(head: string, flags: string): RegExp { return new RegExp(head + "\u4e00|[" + "a".repeat(4080) + "]{9}~", flags) }
function narrow4090(head: string, flags: string): RegExp { return new RegExp(head + "|[" + "a".repeat(4090) + "]{9}~", flags) }
function sixteen4090(head: string, flags: string): RegExp { return new RegExp(head + "\u4e00|[" + "a".repeat(4090) + "]{9}~", flags) }
function narrow5000(head: string, flags: string): RegExp { return new RegExp(head + "|[" + "a".repeat(5000) + "]{9}~", flags) }
function sixteen5000(head: string, flags: string): RegExp { return new RegExp(head + "\u4e00|[" + "a".repeat(5000) + "]{9}~", flags) }
function narrow20000(head: string, flags: string): RegExp { return new RegExp(head + "|[" + "a".repeat(20000) + "]{9}~", flags) }
function sixteen20000(head: string, flags: string): RegExp { return new RegExp(head + "\u4e00|[" + "a".repeat(20000) + "]{9}~", flags) }
function narrow70000(head: string, flags: string): RegExp { return new RegExp(head + "|[" + "a".repeat(70000) + "]{9}~", flags) }
function sixteen70000(head: string, flags: string): RegExp { return new RegExp(head + "\u4e00|[" + "a".repeat(70000) + "]{9}~", flags) }
function tail(c: string): RegExp { return new RegExp("[" + "a".repeat(6000) + "]{3}" + c) }
function make(): RegExp[] {
  return [
    narrow100("xy", ""), narrow100("xy", "g"), narrow100("xz", ""), sixteen100("x", ""), sixteen100("x", "u"), sixteen100("y", ""), narrow100("xy", ""),
    narrow4080("xy", ""), narrow4080("xy", "g"), narrow4080("xz", ""), sixteen4080("x", ""), sixteen4080("x", "u"), sixteen4080("y", ""), narrow4080("xy", ""),
    narrow4090("xy", ""), narrow4090("xy", "g"), narrow4090("xz", ""), sixteen4090("x", ""), sixteen4090("x", "u"), sixteen4090("y", ""), narrow4090("xy", ""),
    narrow5000("xy", ""), narrow5000("xy", "g"), narrow5000("xz", ""), sixteen5000("x", ""), sixteen5000("x", "u"), sixteen5000("y", ""), narrow5000("xy", ""),
    narrow20000("xy", ""), narrow20000("xy", "g"), narrow20000("xz", ""), sixteen20000("x", ""), sixteen20000("x", "u"), sixteen20000("y", ""), narrow20000("xy", ""),
    narrow70000("xy", ""), narrow70000("xy", "g"), narrow70000("xz", ""), sixteen70000("x", ""), sixteen70000("x", "u"), sixteen70000("y", ""), narrow70000("xy", ""),
    tail("b"), tail("c"), tail("d"),
  ]
}
let made = make()
function sum(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
const wide = String.fromCharCode(0x4e00)
function show(r: RegExp): string { return r.source.length + " " + sum(r.source) + " " + r.flags + " " + r.test("xy") + r.test("xz") + r.test("x" + wide) + r.test("y" + wide) + r.test("aaaaaaaaa~") + r.test("aaab") + r.test("aaac") + r.test("aaad") + r.test("q") + " " + r.source.slice(-1) }
const first = made.map(show)
for (const l of first) console.log(l)
console.log("the first and the seventh of each seven are two objects: " + (made[0] !== made[6]) + ", of one source: " + (made[0].source === made[6].source))
for (let round = 0; round < 3; round++) {
  made = []
  collect(); collect()
  made = make()
  console.log("made again " + round + ": " + (made.map(show).join() === first.join()))
}
