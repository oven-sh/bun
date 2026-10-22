// Variables that are read before their first assignment: `let x: T` through closures, hoisted `var`, `let x!: T`, and the temporal dead zone.
function kind(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function double(n: number): number { return n * 2 }
function orTen(n: number = 10): number { return n }

// A closure reads the variable before the assignment, and after.
function closures(): string {
  let n: number, s: string, b: boolean, o: { v: number }
  const references = () => [kind(s), kind(o), s + "!", s === undefined, o == null].join()
  const read = () => [kind(n), kind(s), kind(b), kind(o), double(n), s + "!", b ? 1 : 0, orTen(n), n + 1, n === undefined].join()
  const before = references()
  n = 2; s = "s"; b = true; o = { v: 1 }
  return before + " | " + references() + " | " + read() + " | " + o.v
}
console.log(closures())

// `let x!: T`.
let moduleCount!: number
let moduleLabel!: string
console.log(moduleLabel, moduleLabel + "x", kind(moduleLabel), moduleLabel ?? "none")
moduleCount = 3; moduleLabel = "set"
console.log(moduleCount + 1, moduleLabel.length, kind(moduleCount), orTen(moduleCount), moduleCount ?? "none")

// A module variable read by a function that is called before the declaration has run its initializer-less `let`.
function readLater(): string { return kind(later) + ":" + (later + "!") }
let later: string
console.log(readLater())
later = "now"
console.log(readLater())

// The dead zone is a ReferenceError, not undefined.
function readConst(): number { return tooEarly }
console.log(attempt(readConst), attempt(() => tooEarlyLet))
// An initializer that the compiler cannot fold. type-rules/constant-tdz has the ones it folds: their dead zone is the same.
const tooEarly: number = Math.abs(-5)
let tooEarlyLet: string = "x"
console.log(readConst(), tooEarlyLet)
function innerZone(flag: boolean): string {
  const peek = () => inside
  const first = flag ? attempt(peek) : "skipped"
  let inside: number = 9
  return first + "," + peek() + "," + inside
}
console.log(innerZone(true), innerZone(false))

// `var` is undefined from the start of its function.
function hoisted(flag: boolean): string {
  const get = () => v
  const first = kind(get()) + ":" + (get() + "!")
  if (flag) { var v: string = "six" }
  return first + "," + kind(get()) + "," + get()
}
console.log(hoisted(true), hoisted(false))
function hoistedNumber(): string {
  const get = () => v
  var v: number = 6
  return kind(get()) + "," + double(get())
}
console.log(hoistedNumber())

// Each turn of a loop starts a fresh, unassigned variable; the one captured in the turn before keeps its value.
function loop(): string {
  const readers: (() => string)[] = []
  for (let i = 0; i < 4; i++) {
    let seen: string
    readers.push(() => kind(seen) + (seen + "/" + i))
    if (i % 2) seen = "s" + i * 10
  }
  return readers.map(r => r()).join()
}
console.log(loop())

// Only some paths assign; the value goes on into typed fields, arrays and concatenation.
interface Acc { total: number; text: string }
function paths(mode: number): string {
  let n: number, s: string
  const get = (): Acc => ({ total: n, text: s })
  n = mode
  if (mode > 1) s = "m" + mode
  const acc = get()
  const list: string[] = [acc.text, "1"]
  return JSON.stringify(acc) + Object.keys(acc).join("") + (acc.total + 1) + (acc.text + "") + JSON.stringify(list) + kind(list[0]) + (list[0] + list[1])
}
console.log(paths(0), paths(1), paths(2))

// switch cases share one scope; try and finally; a destructuring that finds nothing.
function cases(x: number): string {
  switch (x) {
    case 0: let c: string; const r = () => kind(c); return r()
    case 1: return attempt(() => c)
    default: c = "c" + x; return String(c)
  }
}
console.log(cases(0), cases(1), attempt(() => cases(2)))
function tried(fail: boolean): string {
  let got: string
  const read = () => kind(got) + got
  try { if (fail) throw new RangeError("x"); got = "one" } catch { return "caught " + read() } finally { trail.push(read()) }
  return read()
}
const trail: string[] = []
console.log(tried(false), tried(true), trail.join())
const [d0, d1]: string[] = ["1"]
const [e0]: number[] = [1]
const { missing }: { missing?: number } = {}
console.log(d0, d1, d0 + d1, kind(d1), e0, missing, orTen(e0), orTen(missing))
