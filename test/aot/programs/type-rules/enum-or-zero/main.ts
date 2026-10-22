// A numeric enum type, and `Flags | 0`, is checked as `number`: -0, fractions and larger numbers are stored and read as in plain Bun.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
enum Flags { None = 0, A = 1, B = 2, Top = 1 << 30 }
interface Complete { flags: Flags; name: string[] }
interface Incomplete { flags: Flags | 0; name: string[] }
const names = ["n"]
const whole: Complete = { flags: Flags.A | Flags.B, name: names }
const part: Incomplete = { flags: 0, name: names }
function flagsOf(it: Complete | Incomplete) { return it.flags }
console.log(flagsOf(whole), flagsOf(part), flagsOf(whole) | flagsOf(part), (flagsOf(part) & Flags.A) === 0, 1 / flagsOf(part))
part.flags = Flags.Top; console.log(part.flags, part.flags | 0, part.flags << 1)
part.flags = 0; console.log(part.flags, JSON.stringify(part))
let either: Flags | 0 = 0
function pass(f: Flags | 0): Flags | 0 { return f }
either = pass(Flags.B); console.log(either, pass(0), pass(either) + 1)
const minusZero: any = -0, fraction: any = 1.5, big: any = 2 ** 40
attempt("-0 into Flags", () => { whole.flags = minusZero; return 1 / whole.flags })
attempt("-0 into Flags | 0", () => { part.flags = minusZero; return 1 / part.flags })
attempt("1.5 into Flags", () => { whole.flags = fraction; return whole.flags })
attempt("1.5 into Flags | 0", () => { part.flags = fraction; return part.flags })
attempt("2 ** 40 into Flags | 0", () => { part.flags = big; return part.flags })
attempt("-0 into a variable", () => { either = minusZero; return 1 / either })
attempt("-0 as an argument", () => 1 / pass(minusZero))
// By itself `0` is a number: same as plain Bun.
function sign(x: number) { return x === 0 ? 1 / x : x }
console.log(sign(0), sign(-0), sign(3))
function zeroOrOne(x: number) { return x === 0 || x === 1 ? 1 / x : 0 }
console.log(zeroOrOne(0), zeroOrOne(-0), zeroOrOne(1))
const zero: 0 = -0; console.log(1 / zero, Object.is(zero, -0))
