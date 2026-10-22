// A record is assignable to a type with an index signature that allows more: a store through that type of a value the field does not allow is taken, and every typed read of the field afterwards throws a TypeError, whatever is done with the value.
function attempt(label: string, f: () => unknown): void { try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) } }
function plusOne(n: number): number { return n + 1 }
type Lit = { v: number }
const n4: Lit = { v: 1 }
const w4: { [k: string]: number | string } = n4
attempt("store", () => { w4["v"] = "text"; return "taken" })
attempt("looked at", () => n4.v)
attempt("typeof", () => typeof n4.v)
attempt("arithmetic", () => n4.v * 2)
attempt("held", () => plusOne(n4.v))
