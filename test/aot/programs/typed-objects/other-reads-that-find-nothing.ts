// Reads that find nothing, other than plain array indexing: strings, typed arrays, tuples, `Map.get`, `pop`, `shift`, `at`, `find`, destructuring, `arguments`, dictionaries.
function kind(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function orNine(n: number = 9): number { return n }
function tail(s: string): string { return s + "." }

// Strings.
const word = "héllo"
const c5: string = word[5], cNeg: string = word[-1], c0: string = word[0]
console.log(c5, cNeg, c0, kind(c5), tail(c5), c5 + c0, word.charAt(9) === "", word.charCodeAt(9), word.codePointAt(9), word.at(9), word.at(-1), attempt(() => c5.length), ""[0])
function spell(s: string): string { let out = ""; for (let i = 0; i <= s.length; i++) out += s[i] + "|"; return out }
console.log(spell("ab"), spell(""))

// Typed arrays: outside is undefined, never the prototype's, and a store outside is dropped.
const i32 = new Int32Array([1, 2]), f64 = new Float64Array([0.5, NaN]), u8 = new Uint8Array(0)
console.log(i32[2], f64[2], i32[-1], u8[0], i32[2] + 1, f64[2] * 2, orNine(i32[2]), f64[1], f64[1] === undefined, f64[2] === undefined, i32[1.5], i32.at(5), i32.at(-1))
i32[5] = 9; f64[-1] = 1
console.log(i32.length, i32[5], 5 in i32, f64[-1], Object.keys(i32).join())
function sumTyped(a: Int32Array | Float64Array): string { let t = 0, u = 0; for (let i = 0; i <= a.length; i++) { if (a[i] === undefined) u++; else t += a[i] } return t + "/" + u }
console.log(sumTyped(i32), sumTyped(new Float64Array([1.5, 2.5])), sumTyped(new Int32Array(0)))

// Tuples seen as arrays.
const tuple: [number, string] = [1, "one"]
const loose: (number | string)[] = tuple
loose.length = 1
console.log(tuple[0], tuple[1], kind(tuple[1]), tail(tuple[1]), loose.length)
const [ta, tb, tc = -1] = [1, 2] as number[]
console.log(ta, tb, tc, ta + tc, orNine(tc))

// Methods that say `T | undefined`, narrowed by a default or carried on.
const stack: number[] = [1.5]
const popped = stack.pop(), poppedAgain = stack.pop(), shifted = stack.shift()
console.log(popped, poppedAgain, shifted, (poppedAgain ?? 0) + 1, orNine(poppedAgain), [1, 2].at(5), [1, 2].find(v => v > 5), [1, 2].findLast(v => v > 5), ["a"].at(-2))
const table = new Map<string, number>([["a", 1], ["nan", NaN]])
const hit = table.get("a"), miss = table.get("b"), nan = table.get("nan")
console.log(hit, miss, nan, orNine(miss), orNine(nan), (miss ?? -1) + 1, miss === undefined, nan === undefined, table.has("b"))
const objects = new Map<number, { v: number }>([[1, { v: 10 }]])
console.log(objects.get(1)?.v, objects.get(2)?.v, attempt(() => (objects.get(2) as { v: number }).v), new WeakMap<object, number>().get({}))

// Destructuring with and without defaults.
interface Cfg { depth?: number; label?: string; nested?: { on?: boolean } }
function configure({ depth = 3, label, nested: { on = true } = {} }: Cfg = {}): string { return depth + "," + label + "," + on }
console.log(configure(), configure({}), configure({ depth: 0, label: "" }), configure({ depth: undefined, nested: {} }), configure({ nested: { on: false } }))
const [first = 10, second = 20, third = 30] = [1, undefined] as (number | undefined)[]
console.log(first, second, third)

// Fewer arguments than parameters where the parameter is optional; rest and `arguments`.
function optional(a: number, b?: number, ...rest: number[]): string { return [a, b, rest.length, rest[0], arguments.length, kind(arguments[1]), (b ?? 0) + a].join() }
console.log(optional(1), optional(1, 2), optional(1, 2, 3), optional(1, undefined, 3))

// Dictionaries: a key that is not there, and one that is inherited from Object.prototype.
const dict: Record<string, number> = { a: 1 }
const da: number = dict["a"]
console.log(da, dict["z"], dict["z"] + 1, orNine(dict["z"]), "z" in dict, attempt(() => kind(dict.missing)), kind((dict as Record<string, unknown>)["constructor"]), kind((dict as Record<string, unknown>).toString))
const bareDict: Record<string, string> = Object.create(null)
bareDict.k = "v"
const inheritedNames: string[] = ["toString", "constructor", "k"]
console.log(bareDict.k, inheritedNames.map(k => kind(bareDict[k])).join(), tail(bareDict.nope), Object.keys(bareDict).join())

// Iterators and generators that are done; a regular expression that does not match or has an unmatched group.
function* two(): Generator<number, void, void> { yield 1; yield 2 }
const it = two()
it.next(); it.next()
const done = it.next()
console.log(done.done, kind(done.value), [...two()].length)
const m = /(a)|(b)/.exec("b"), none = /x/.exec("y")
console.log(m ? kind(m[1]) + m[2] + kind(m[3]) : "no", none, "abc".match(/z/), "a-b".split("-")[2])
