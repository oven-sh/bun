// Reads beyond the end of an array and from holes have the element type statically and return undefined.
function kind(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function orSeven(n: number = 7): number { return n }
function greet(s: string): string { return "hi " + s }
interface Pt { x: number; y: number }

const ints: number[] = [1, 2, 3]
const doubles: number[] = [1.5, 2.5]
const strings: string[] = ["a", "b"]
const flags: boolean[] = [true]
const points: Pt[] = [{ x: 1, y: 2 }]
const empty: number[] = []

// Past the end, before the start, far away, fractional and NaN indices.
console.log(ints[3], ints[-1], ints[1e9], ints[1.5], ints[NaN], ints[Infinity], doubles[2], strings[2], flags[1], kind(points[1]), empty[0])
console.log(ints[ints.length], ints[ints.length - 1], ints[2 ** 32], ints[2 ** 32 - 1], ints[-0])

// Into typed places.
const s: string = strings[5]
const p: Pt = points[5]
console.log(s, kind(p), ints[5] + 1, doubles[5] * 2, s + "!", !flags[5], orSeven(ints[5]), orSeven(doubles[5]), greet(s), ints[5] === undefined, doubles[5] === undefined, typeof doubles[5])
console.log(attempt(() => p.x), attempt(() => points[9].y), attempt(() => String(points[9]?.y)), attempt(() => s.length), attempt(() => strings[9].toUpperCase()), attempt(() => String(strings[9]?.length)))

// Stored in fields and arrays, and read back.
const pt: Pt = { x: ints[0], y: doubles[1] }
console.log(pt.x, pt.y, JSON.stringify(pt), Object.keys(pt).join(), pt.x + pt.y, pt.x === undefined, "x" in pt)
pt.x = 1; pt.y = doubles[0]
console.log(pt.x + pt.y)
const copied: number[] = [ints[9], 1, doubles[9]]
copied.push(ints[10])
console.log(JSON.stringify(copied), copied.length, 0 in copied, copied[0], copied.join(), copied.indexOf(1))

// Holes.
function punch<T>(a: T[], i: number): T[] { delete a[i]; return a }
const holey: number[] = punch([1, 2, 3], 1)
const holeyDoubles: number[] = punch([0.5, 1.5, 2.5], 1)
const holeyStrings: string[] = punch(["a", "b", "c"], 1)
console.log(holey[1], holeyDoubles[1], holeyStrings[1], 1 in holey, holey.length, holey[1] + 1, holeyDoubles[1] * 2, holeyStrings[1] + "", JSON.stringify(holey), holey.join("-"))
const made: number[] = new Array<number>(3)
made[1] = 5
console.log(made[0], made[1], made[2], 0 in made, Object.keys(made).join(), made.map(v => v + 1).join(), made.reduce((a, v) => a + v, 0))
delete holey[0]
console.log(holey[0], holey.length, Object.keys(holey).join())

// A loop that runs one too far, over each kind of storage.
function sumTooFar(a: number[]): string { let t = 0, undef = 0; for (let i = 0; i <= a.length; i++) { if (a[i] === undefined) undef++; t += a[i] } return t + "/" + undef }
function sumGuarded(a: number[]): number { let t = 0; for (let i = -1; i <= a.length; i++) t += a[i] ?? 100; return t }
function concatTooFar(a: string[]): string { let t = ""; for (let i = 0; i <= a.length; i++) t += a[i]; return t }
console.log(sumTooFar(ints), sumTooFar(doubles), sumTooFar(empty), sumTooFar(holey), sumGuarded(ints), sumGuarded(doubles), sumGuarded(holeyDoubles), concatTooFar(strings), concatTooFar(holeyStrings))

// The array shrinks or grows between the test and the read.
function shrinking(a: number[]): string { const out: string[] = []; for (let i = 0, len = a.length; i < len; i++) { out.push(String(a[i])); a.pop() } return out.join() }
console.log(shrinking([1, 2, 3, 4]), shrinking([1.5, 2.5, 3.5]))
const grown: number[] = [1]
grown[3] = 4
console.log(grown[1], grown[2], grown[3], grown.length, grown[2] + grown[3])
grown.length = 1
console.log(grown[3], grown.length)

// A real NaN and undefined side by side among doubles.
const nans: number[] = punch([NaN, 1.5, 0.5, NaN], 2)
console.log(nans.map((v, i) => i + ":" + String(v)).join(), nans[0] === undefined, nans[2] === undefined, nans[4] === undefined, Number.isNaN(nans[0]), Number.isNaN(nans[2]), nans.includes(NaN), nans.indexOf(NaN))

// A prototype the program owns, between the array and Array.prototype, that has no elements.
const between: any = Object.create(Array.prototype)
const holeyBehind: unknown[] = [0, , 2]
const shortBehind: unknown[] = [0]
const intsBehind: number[] = punch([1, 2, 3], 1)
const doublesBehind: number[] = punch([0.5, 1.5, 2.5], 1)
for (const a of [holeyBehind, shortBehind, intsBehind, doublesBehind]) Object.setPrototypeOf(a, between)
function behind(): string {
  return [String(holeyBehind[1]), String(shortBehind[1]), String(shortBehind[3]), intsBehind[1], intsBehind[3], intsBehind[-1], doublesBehind[1], doublesBehind[3], 1 in shortBehind, 1 in intsBehind, Object.hasOwn(intsBehind, 1),
    intsBehind[1] + 1, doublesBehind[1] * 2, sumTooFar(intsBehind), sumGuarded(intsBehind), sumGuarded(doublesBehind), intsBehind.join("-"), intsBehind.length, Object.keys(intsBehind).join(""), JSON.stringify(doublesBehind)].map(String).join(" ")
}
console.log(behind(), Array.isArray(intsBehind), intsBehind instanceof Array)

// A class that extends Array. (An instance at `number[]`, `sumGuarded(stack)` and `Stack.from([5])[1]`: type-rules/array-subclass-is-an-array-type.)
class Stack extends Array<number> { top(): number { return this[this.length - 1] } above(): number | undefined { return this[this.length] } }
const stack = new Stack()
stack.push(1)
console.log(stack[1], stack.above(), stack.top(), stack.length, 1 in stack, Object.keys(stack).join(), new Stack()[1])
stack.push(2)
console.log(stack[1], stack.above(), stack.top(), stack.length, Object.hasOwn(stack, 1))
stack.pop()
console.log(stack[1], stack.above(), stack.top(), stack.length, Object.hasOwn(stack, 1))

// Arrays right below Array.prototype.
const holeyPlain: unknown[] = [0, , 2]
const shortPlain: unknown[] = [0]
console.log(String(holeyPlain[1]), String(shortPlain[1]), holeyDoubles[1], 1 in shortPlain, sumGuarded(holeyDoubles))
