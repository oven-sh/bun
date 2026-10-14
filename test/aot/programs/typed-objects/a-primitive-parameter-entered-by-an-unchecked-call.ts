// A parameter declared with primitive types only receives a value from a call that TypeScript did not check.
/* expected
seen TypeError
unseen TypeError
default TypeError
optional TypeError
union TypeError
setter TypeError 1
closure TypeError
method TypeError
caught TypeError finally
right 8 11 number string 5 6 3
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
function twice(n: number): number { return n * 2 }
const loose: any = { twice }
attempt("seen", () => (twice as any)("4"))
attempt("unseen", () => loose.twice("4"))
function withDefault(n: number = 10): number { return n + 1 }
function optional(n?: number): string { return typeof n }
function either(v: number | string): string { return typeof v }
attempt("default", () => (withDefault as any)("1"))
attempt("optional", () => (optional as any)("x"))
attempt("union", () => (either as any)(true))
class Dial { private at = 1; set value(n: number) { this.at = n } get value(): number { return this.at } add(n: number) { return this.at + n } }
const dial = new Dial()
try { (dial as any).value = "x"; console.log("setter stored", dial.value) } catch (e) { console.log("setter", (e as Error).constructor.name, dial.value) }
function adder(base: number): (n: number) => number { return (n: number) => base + n }
const handed: any = adder(1)
attempt("closure", () => handed("5"))
attempt("method", () => (new Dial() as any).add("2"))
// The call is watched by a handler of the function it is in.
function watched(): string { let s = ""; try { s += (twice as any)("4") } catch (e) { s += (e as Error).constructor.name } finally { s += " finally" } return s }
console.log("caught", watched())
dial.value = 5
console.log("right", (twice as any)(4), (withDefault as any)(), (optional as any)(1), (either as any)("s"), dial.value, handed(5), (new Dial() as any).add(2))
