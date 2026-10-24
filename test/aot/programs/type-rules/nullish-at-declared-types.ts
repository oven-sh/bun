// Null and undefined pass the check of every declared type and stay what they are: a variable, cast, field, element, parameter or result declared `number`, `boolean` or `string` holds them as in plain Bun.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const hide = (v: unknown): any => v
attempt("variable, undefined as number", () => { const n: number = hide(undefined); return n + 1 })
attempt("variable, null as number", () => { const n: number = hide(null); return n + 1 })
attempt("variable, undefined as boolean", () => { const b: boolean = hide(undefined); return b ? "yes" : "no" })
attempt("variable, null as boolean", () => { const b: boolean = hide(null); return b === false })
attempt("as, undefined as number", () => (hide(undefined) as number) * 2)
attempt("as, null as number", () => (hide(null) as number) * 2)
attempt("as, undefined as boolean", () => (hide(undefined) as boolean) === undefined)
attempt("variable, null as number | undefined", () => { const u: number | undefined = hide(null); return u })
attempt("variable, undefined as boolean | null", () => { const x: boolean | null = hide(undefined); return x })
interface Rec { n: number; s: string; b: boolean }
const rec: Rec = { n: 1, s: "s", b: true }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
attempt("field, undefined as number", () => { rec.n = hide(undefined) })
attempt("field, null as number", () => { rec.n = hide(null) })
attempt("field, null as boolean", () => { rec.b = hide(null) })
console.log(show(rec))
attempt("field of a literal, undefined as number", () => { const made: Rec = { n: hide(undefined), s: hide(null), b: true }; return show(made) })
// The elements of an array: the read is checked, and null and undefined pass that check too. In arithmetic undefined is NaN and null is 0.
const nums: number[] = [1.5, 2.5]
attempt("element, store of undefined", () => { nums[1] = hide(undefined) })
attempt("element, store of null", () => { nums[2] = hide(null) })
console.log(nums.length, JSON.stringify(nums))
attempt("element, undefined read in arithmetic", () => nums[1] + 1)
attempt("element, undefined read to a variable", () => { const n: number = nums[1]; return n })
attempt("element, null read", () => nums[2] + 1)
attempt("element, for of", () => { let s = 0; for (const n of nums) s += n; return s })
function plusOne(n: number): number { return n + 1 }
function withDefault(n: number = 10): number { return n + 1 }
function back(v: any): number { return v }
attempt("parameter, undefined", () => plusOne(hide(undefined)))
attempt("parameter, null", () => plusOne(hide(null)))
attempt("parameter with a default, undefined", () => withDefault(hide(undefined)))
attempt("parameter with a default, null", () => withDefault(hide(null)))
attempt("result, undefined", () => back(undefined))
attempt("result, null", () => back(null))
attempt("called through any, argument left out", () => (plusOne as any)())
attempt("called through any, null", () => (plusOne as any)(null))
attempt("called through any, parameter with a default, left out", () => (withDefault as any)())
attempt("called through any, parameter with a default, null", () => (withDefault as any)(null))
class Temp { constructor(public degrees: number, public unit: string = "C") {} text() { return this.degrees + this.unit } }
attempt("constructed through any, argument left out", () => new (Temp as any)().text())
attempt("constructed through any, null", () => new (Temp as any)(null, null).text())
attempt("captured variable", () => { let acc: number = 0; const set = (v: any) => { acc = v }; set(undefined); return acc })
attempt("variable in a loop", () => { let out = ""; for (const v of [1, undefined, 2] as any[]) { const n: number = v; out += (n + 1) + "," } return out })
// A string can be null or undefined. `+` of it and a number is a number then, where the type of the sum is string.
attempt("null as string, + 1", () => { const s: string = hide(null); return s + 1 })
attempt("undefined as string, + 1", () => { const s: string = hide(undefined); return s + 1 })
attempt("null as string, + null as string", () => { const s: string = hide(null), t: string = hide(null); return s + t })
