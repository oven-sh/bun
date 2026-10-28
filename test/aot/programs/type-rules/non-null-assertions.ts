// `x!` checks nothing, as in TypeScript: if `x` is undefined or null, it goes on as it is.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function maybe(flag: boolean): number | undefined { return flag ? 1 : undefined }
function orNull(flag: boolean): string | null { return flag ? "s" : null }
attempt("result of a call", () => maybe(false)! + 1)
attempt("result of a call, a string", () => orNull(false)! + "x")
const list = [10, 20]
const holes: (number | undefined)[] = [1, , 3]
attempt("element out of bounds", () => String(list[5]!))
attempt("element at -1", () => list[-1]!)
attempt("hole", () => holes[1]!)
attempt("typed array out of bounds", () => new Int32Array(2)[2]!)
attempt("character out of bounds", () => "abc"[3]!)
interface Opt { v?: number; flag?: boolean; child?: Opt | null }
const empty: Opt = {}
const full: Opt = { v: 0, child: { v: 2 } }
attempt("optional field that is absent", () => empty.v! + 1)
attempt("optional boolean field that is absent", () => empty.flag!)
attempt("optional object field that is absent, under typeof", () => typeof full.child!.child!)
attempt("object field that is null, compared with null", () => { const n: Opt = { child: null }; return n.child! === null })
const table = new Map<string, number>([["a", 0]])
attempt("Map.get of a key that is missing", () => table.get("b")!)
function falsy(i: number): number | string | boolean | null | undefined { return [0, "", false, NaN, null, undefined][i] }
for (let i = 4; i < 6; i++) attempt("a mix of kinds, " + falsy(i), () => "<" + falsy(i)! + ">")
const people = [{ id: 1 }, { id: 2 }]
attempt("find that finds nothing, kept in a variable", () => { const p = people.find(q => q.id === 3)!; return p === undefined })
class Late { value?: number; read() { return this.value! + 1 } }
attempt("optional field of a class", () => new Late().read())
function twice(n?: number) { return n! * 2 }
attempt("optional parameter, left out", () => twice())
attempt("optional parameter, undefined", () => twice(undefined))
// The store happens and the rest of the expression runs, as in JavaScript.
const target: { v: number; note: string } = { v: 1, note: "kept" }
attempt("stored to a field", () => { target.v = maybe(false)!; return target.v })
console.log(target.v)
attempt("before the rest of the expression", () => { target.note = orNull(false)! + (target.note = "changed"); return target.note })
console.log(target.note)
