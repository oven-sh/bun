// `undefined` or `null` that passed through an `as` cast stays what it is where it enters a variable, a parameter, a result or a field of a primitive type. An object passes the cast too, and the place behind it takes it.
declare const console: { log(...args: unknown[]): void }
function hide(x: unknown): unknown { return x }
function anyOf(x: unknown): any { return x }
function row(name: string, f: () => unknown) { try { console.log(name + ":", String(f())) } catch (e) { console.log(name + ":", e instanceof TypeError ? "TypeError" : "other") } }
function takes(n: number): string { return typeof n + " " + n }
function flag(b: boolean): string { return typeof b + " " + b }
class Holder { size: number = 0 }
row("DECLARED PLACE: unknown undefined, an annotated const", () => { const n: number = hide(undefined) as number; return n })
row("DECLARED PLACE: any undefined, a parameter", () => takes(anyOf(undefined) as number))
row("DECLARED PLACE: any null, a parameter", () => takes(anyOf(null) as number))
row("DECLARED PLACE: a missing property of any, a parameter", () => takes(anyOf({}).count as number))
row("DECLARED PLACE: unknown undefined, a boolean parameter", () => flag(hide(undefined) as boolean))
row("DECLARED PLACE: unknown undefined, a declared result", () => ((x: unknown): number => x as number)(undefined))
row("DECLARED PLACE: unknown undefined, a field", () => { const h = new Holder(); h.size = hide(undefined) as number; return h.size })
row("USE: an object, a parameter", () => takes(hide({}) as number))
row("USE: an object, an annotated const", () => { const n: number = hide([1]) as number; return n })
row("honest, a parameter", () => takes(hide(3) as number))
row("honest, through a local", () => { const n = hide(4) as number; return takes(n) })
row("nil through a local", () => { const n = hide(undefined) as number; return takes(n) })
