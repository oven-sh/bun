// `readonly` is no part of assignability: what is held through a read-only index signature may be handed on to one that is stored through. The store is taken, and the typed read of the field through the narrower type throws a TypeError.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
type Chained = { v: number }
const chained: Chained = { v: 1 }
const readOnly: { readonly [k: string]: number | string } = chained
const writable: { [k: string]: number | string } = readOnly
attempt("j1", () => { writable.v = "through"; return chained.v })
type Handed = { v: number }
function open(seen: { readonly [k: string]: number | string }): { [k: string]: number | string } { return seen }
const openers = [open]
const handed: Handed = { v: 1 }
attempt("j2", () => { openers[0](handed).v = "opened"; return handed.v })
