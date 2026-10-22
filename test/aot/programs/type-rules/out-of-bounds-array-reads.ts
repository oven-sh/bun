// An array element that is out of bounds or missing is undefined, also where it enters a variable, parameter or result of type `number` or `boolean`. An inherited element or accessor is read as in plain Bun.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function half(n: number): number { return n / 2 }
function orSeven(n: number = 7): number { return n }
interface Pt { x: number; y: number }
const ints: number[] = [1, 2, 3]
const doubles: number[] = [1.5, 2.5]
const flags: boolean[] = [true]
attempt("variable with a type, integers", () => { const n: number = ints[5]; return n })
attempt("variable with a type, doubles", () => { const d: number = doubles[5]; return d })
attempt("variable with a type, booleans", () => { const b: boolean = flags[5]; return b })
attempt("variable without a type", () => { const v = ints[5]; return v === undefined })
attempt("parameter", () => half(ints[5]))
attempt("parameter with a default", () => orSeven(ints[5]))
attempt("result", () => ((a: number[]): number => a[5])(ints))
attempt("field of a literal", () => { const pt: Pt = { x: ints[7], y: doubles[7] }; return JSON.stringify(pt) })
attempt("field", () => { const pt: Pt = { x: 0, y: 0 }; pt.x = ints[7]; return JSON.stringify(pt) })
function punch<T>(a: T[], i: number): T[] { delete a[i]; return a }
attempt("hole", () => { const n: number = punch([1, 2, 3], 1)[1]; return n })
attempt("loop that runs one too far", () => { let t = 0, undef = 0; for (let i = 0; i <= ints.length; i++) { const v = ints[i]; if (v === undefined) undef++; t += v } return t + "/" + undef })
attempt("parameter of a callback that is called for holes", () => punch([NaN, 1.5, 0.5], 2).findIndex(v => v === undefined))
class Stack extends Array<number> { above(): number { return this[this.length] } }
attempt("result of a method of a class that extends Array", () => new Stack().above())
function sumGuarded(a: number[]): number { let t = 0; for (let i = -1; i <= a.length; i++) t += a[i] ?? 100; return t }
const between: any = Object.create(Array.prototype)
const holeyBehind: unknown[] = [0, , 2]
const shortBehind: unknown[] = [0]
const intsBehind: number[] = punch([1, 2, 3], 1)
const doublesBehind: number[] = punch([0.5, 1.5, 2.5], 1)
for (const a of [holeyBehind, shortBehind, intsBehind, doublesBehind]) Object.setPrototypeOf(a, between)
function behind(): string {
  return [String(holeyBehind[1]), String(shortBehind[1]), String(shortBehind[3]), intsBehind[1], intsBehind[3], intsBehind[-1], doublesBehind[1], doublesBehind[3], 1 in shortBehind, 1 in intsBehind, Object.hasOwn(intsBehind, 1),
    intsBehind[1] + 1, doublesBehind[1] * 2, sumGuarded(intsBehind), sumGuarded(doublesBehind), intsBehind.join("-"), intsBehind.length, Object.keys(intsBehind).join(""), JSON.stringify(doublesBehind)].map(String).join(" ")
}
console.log(behind())
between[1] = 7
console.log(behind())
between[3] = 0.25; between[-1] = -5
console.log(behind())
intsBehind[1] = 20; doublesBehind[3] = 3.5
console.log(behind())
let indexReads = 0
Object.defineProperty(between, 1, { get() { indexReads++; return 9 }, configurable: true })
delete intsBehind[1]
attempt("an accessor under a numeric key up the chain", () => behind() + " " + indexReads)
const stack = new Stack()
stack.push(1)
;(Stack.prototype as any)[1] = 70
console.log(stack[1], stack[1] + 1, 1 in stack, Object.keys(stack).join(), new Stack()[1])
