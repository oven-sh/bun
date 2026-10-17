// Fields accessed by computed keys and numeric names, and names with a special meaning (`__proto__`, `constructor`, `length`, `hasOwnProperty`).
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
interface Rec { x: number; y: string; z?: boolean }
const rec: Rec = { x: 1, y: "y" }

// Constant keys, keys in variables, keys built at run time: all name the same fields.
const kx = "x", ky: keyof Rec = "y"
function get<T, K extends keyof T>(o: T, k: K): T[K] { return o[k] }
function set<T, K extends keyof T>(o: T, k: K, v: T[K]): void { o[k] = v }
console.log(rec["x"], rec[kx], rec[ky], get(rec, "x"), get(rec, "y"), get(rec, "z"), rec[("x" + "") as "x"], (rec as any)["x".concat("")])
rec["x"] = 2; set(rec, "y", "set"); set(rec, "z", true)
console.log(rec.x, rec.y, rec.z, Object.keys(rec).join())
rec[kx]++; rec[kx] += 0.5
console.log(rec.x, rec["x"])
const names: (keyof Rec)[] = ["z", "x", "y"]
console.log(names.map(k => k + "=" + String(rec[k])).join(), names.map(k => k in rec).join())
delete rec["z"]
console.log("z" in rec, rec.z, get(rec, "z"))

// Keys that are not strings are converted, once per access; the log shows when.
const log: string[] = []
const keyObject = { toString() { log.push("key"); return "x" } }
const anyRec: any = rec
function hide(x: unknown): any { return x }
anyRec[hide(keyObject)] = (log.push("value"), 7)
console.log(rec.x, log.join(), anyRec[hide(keyObject)], anyRec[hide(["x"])], anyRec[hide(null)], anyRec[hide(undefined)], log.length)

// Numeric names declared by the type.
interface Tri { 0: number; 1: number; 2?: number; size: number }
const tri: Tri = { size: 2, 1: 11, 0: 10 }
const one = 1
console.log(tri[0], tri[1], tri[2], tri["0"], tri[one], (tri as any)["1"], (tri as any)[1.0], (tri as any)["01"], Object.keys(tri).join(), JSON.stringify(tri))
tri[2] = 12; tri[0]++; tri.size++
console.log(tri[0] + tri[1] + (tri[2] ?? 0), tri.size, Object.keys(tri).join(), Array.prototype.join.call({ ...tri, length: 3 }, "+"), 2 in tri, "2" in tri)
function sumTri(t: Tri): number { let s = 0; for (let i = 0; i < t.size; i++) s += (t as unknown as Record<number, number>)[i]; return s }
console.log(sumTri(tri), sumTri({ 0: 1.5, 1: 2.5, size: 2 }))

// `__proto__` in a literal sets the prototype; computed or shorthand it is an ordinary own key.
interface Base1 { inherited: string }
const base1: Base1 = { inherited: "yes" }
const viaProto = { own: 1, __proto__: base1 }
const computedProto = { own: 1, ["__proto__"]: base1 }
console.log(Object.keys(viaProto).join(), Object.getPrototypeOf(viaProto) === base1, (viaProto as any).inherited, Object.keys(computedProto).join(), Object.getPrototypeOf(computedProto) === Object.prototype, (computedProto as any).inherited)
const parsed = JSON.parse('{"__proto__": {"inherited": "json"}, "own": 2}')
console.log(Object.keys(parsed).join(), Object.getPrototypeOf(parsed) === Object.prototype, parsed.inherited, parsed.own)
// A store to `__proto__` of a typed object: see type-rules/computed-and-special-keys.

// Fields named like the properties that every object inherits. A typed read of the optional one while it is absent: see type-rules/computed-and-special-keys.
interface Shadow { constructor: string; hasOwnProperty: number; valueOf?: () => unknown; length: number; prototype?: string }
const shadow: Shadow = { constructor: "mine", hasOwnProperty: 1, length: 3 }
console.log(shadow.constructor, shadow.hasOwnProperty + 1, shadow.length, typeof hide(shadow).valueOf, shadow.prototype, Object.keys(shadow).join(), JSON.stringify(shadow), Object.hasOwn(shadow, "valueOf"), "valueOf" in shadow)
console.log(attempt(() => (shadow as any).hasOwnProperty("length")), Object.prototype.hasOwnProperty.call(shadow, "length"), Array.from(shadow as unknown as ArrayLike<unknown>).length)
shadow.valueOf = () => 42
console.log(+shadow + 1, Object.hasOwn(shadow, "valueOf"), Object.keys(shadow).join())
delete shadow.valueOf
console.log(typeof hide(shadow).valueOf, hide(shadow).valueOf === Object.prototype.valueOf, Object.hasOwn(shadow, "valueOf"))

// An object type with `length` holds arrays, strings and functions too, at one site.
function len(v: { length: number }): number { return v.length }
console.log(len(shadow), len([1, 2]), len("four"), len(function (a: number, b: number) { return a + b }), len(new Uint8Array(5)), len({ length: -1 }), len(Object.create({ length: 8 })))

// A dictionary beside a record: the same names, computed stores.
const dict1: Record<string, number> = {}
for (const k of ["x", "10", "y", "2", "constructor", "__proto__x"]) dict1[k] = k.length
console.log(Object.keys(dict1).join(), dict1.x, dict1["10"], dict1[2], JSON.stringify(dict1))
