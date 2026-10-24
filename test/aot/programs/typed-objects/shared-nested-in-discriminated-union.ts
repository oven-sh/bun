// An object that typed code holds is stored in an object that travels as `any` before a typed function first holds it. The type it is read as
// there is one part of a discriminated union. The declared type of the inner object is looser than that part, but the object has everything
// the part requires. It stays the same object: a change made through one reference is seen through the other.
interface Click { kind: "click"; label: string; run: () => string }
interface Key { kind: "key"; code: number; run: () => string }
interface LooseClick { kind: "click"; label?: string; run: () => string }
interface Binding { id: number; on: Click | Key }
const knownClick: Binding = { id: 1, on: { kind: "click", label: "known", run: () => "clicked" } }
const knownKey: Binding = { id: 2, on: { kind: "key", code: 13, run: () => "pressed" } }
const knownLoose: LooseClick = { kind: "click", run: () => "loose" }
function hide(value: unknown): any { return value }
function describe(binding: Binding): string { const on = binding.on; return binding.id + " " + (on.kind === "click" ? on.label : String(on.code)) + " " + on.run() }
console.log(describe(knownClick), describe(knownKey), knownLoose.run())
const inner: LooseClick = { kind: "click", label: "first", run: () => "ran" }
const outer: any = { id: 3, on: inner }
console.log(describe(outer))
inner.label = "second"
console.log(describe(outer), outer.on === inner)
console.log(describe(hide({ id: 4, on: { kind: "click", label: knownLoose.label ?? (knownClick.id ? "third" : undefined), run: () => "ran again" } })))
