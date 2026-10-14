// Built-in objects (Map, Set, arrays, typed arrays, errors, RegExp matches, functions, Math) are used through interface types.
interface HasSize { size: number }
interface HasLength { length: number }
interface Failure { message: string; name: string; cause?: unknown; code?: number }
interface Matched { index: number; input: string; 0: string; groups?: Record<string, string> }
interface Counted { hits: number; (step: number): number }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Crowd implements HasSize { people = ["a"]; get size() { return this.people.length } }
function sizeOf(s: HasSize): number { return s.size }
const sized: HasSize[] = [new Map([[1, 2]]), new Set([1, 2, 3]), { size: 9 }, new Crowd(), new Map<string, number>()]
console.log(sized.map(s => sizeOf(s)).join(), sized.map(s => Object.hasOwn(s, "size")).join())
;(sized[0] as Map<number, number>).set(5, 6).set(7, 8)
;(sized[1] as Set<number>).clear()
console.log(sized.map(s => sizeOf(s)).join(), sized.map(s => attempt(() => { s.size = 1; return s.size })).join())
function lengthOf(l: HasLength): number { return l.length }
function takesTwo(a: number, b: number) { return a + b }
function argumentsOf(..._: number[]): HasLength { return arguments }
const long: HasLength[] = [[1, 2, 3], new Uint8Array(5), takesTwo, { length: 2 }, new String("boxed"), argumentsOf(1, 2, 3), new Float64Array(0), [, , ,]]
console.log(long.map(l => lengthOf(l)).join(), long.map(l => Object.hasOwn(l, "length")).join())
console.log(long.map(l => attempt(() => { l.length = 1; return l.length })).join(), (long[0] as number[]).join(), JSON.stringify(long[3]))
console.log(attempt(() => { (long[0] as HasLength).length = -1 }), attempt(() => { long[0].length = 2.5 }), long[0].length)
// Errors: `message` is an own property that is not enumerable, `name` is inherited.
class CodedError extends Error { code: number; constructor(m: string, code: number) { super(m); this.code = code; this.name = "CodedError" } }
function explain(f: Failure): string { return [f.name, f.message, String(f.cause), String(f.code), Object.hasOwn(f, "name"), Object.keys(f).join("")].join("|") }
const failures: Failure[] = [new Error("boom"), new RangeError("far", { cause: 1 }), new CodedError("coded", 7), { name: "Lit", message: "literal" }, new TypeError()]
console.log(failures.map(f => explain(f)).join(" "))
for (const f of failures) { f.name += "!"; f.code = (f.code ?? 0) + 1; f.message = f.message.toUpperCase() }
console.log(failures.map(f => explain(f)).join(" "), String(failures[0]), failures[1] instanceof RangeError, Error.prototype.name)
try { throw failures[2] } catch (e) { const f = e as Failure; console.log(f.code, f.name, e instanceof CodedError) }
// The result of a match is an array with named properties.
const matches: Matched[] = [/b(c)/.exec("abcd")!, /(?<last>z)/.exec("xyz")!, { index: 0, input: "lit", 0: "l" }]
console.log(matches.map(m => [m.index, m.input, m[0], m.groups ? m.groups.last : "-", Array.isArray(m)].join(":")).join(" "))
for (const m of matches) { m.index += 10; m[0] += "?" }
console.log(matches.map(m => m.index + m[0]).join(), Object.keys(matches[0]).join(), Object.keys(matches[2]).join())
// A function that has properties, and a literal cannot be called.
const counter: Counted = Object.assign(function step(by: number) { return (counter.hits += by) }, { hits: 0 })
console.log(counter(2), counter(3), counter.hits, counter.length, counter.name, Object.keys(counter).join(), typeof counter)
const hitters: { hits: number }[] = [counter, { hits: 1 }, Object.assign(() => 0, { hits: 2 })]
for (const h of hitters) h.hits *= 2
console.log(hitters.map(h => h.hits).join(), counter(0))
// Namespaces and prototypes of JavaScriptCore as values of object types.
const maths: { PI: number; max(...n: number[]): number; E: number } = Math
const protos: { constructor: Function }[] = [Array.prototype, Object.prototype, Map.prototype, takesTwo.prototype, Crowd.prototype]
console.log(Math.floor(maths.PI * 100), maths.max(1, 5, 3), attempt(() => { maths.E = 3 }), Math.floor(maths.E), protos.map(q => q.constructor.name).join())
const pushable: { push(...n: number[]): number; length: number } = [1]
console.log(pushable.push(2, 3), pushable.length, lengthOf(pushable))
let sum = 0
for (let i = 0; i < 100; i++) sum += lengthOf(long[i % long.length]) + sizeOf(sized[i % sized.length])
console.log(sum)
