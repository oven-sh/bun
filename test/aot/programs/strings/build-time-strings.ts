// Where the compiler knows a string at build time, and where it does not.
const say: (s: string) => void = (globalThis as any).print ?? console.log
function returned() { return "returned-1" }
function stored() { return { a: "stored-1" } }
function concatenated(x: string) { return x + "concatenated-1" }
function toBuiltin(x: string) { return x.indexOf("to-a-built-in-1") }
function toFunction(f: (s: string) => number) { return f("to-a-function-1") }
function compared(x: string) { return x === "compared-1" }
function twice(x: string) { return x === "twice-1" ? "twice-1" : x }
function never() { return "never-made-1" }
const texts = ["q", "compared-1", "twice-1"]
let n = 0
for (let i = 0; i < 3; i++) {
  const x = texts[i % texts.length]
  n += returned().length + stored().a.length + concatenated(x).length + toBuiltin(x) + toFunction(s => s.length) + (compared(x) ? 1 : 0) + twice(x).length
}
say(String(n))
if (n < 0) say(never())
;(globalThis as any).gc?.()
