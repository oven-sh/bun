// `String.raw` with an argument whose getters have side effects.
const log: string[] = []
const strings: any = { raw: { length: 2, get 0() { log.push("first"); return "a" }, get 1() { log.push("second"); return "b" } } }
function raw(s: any, x: number): string { return String.raw(s, x) }
;(globalThis as any).kept = [raw]
console.log(raw(strings, 7), log.join(" "))
console.log(raw({ raw: ["x", "y"] }, 8), log.length)
