// Parsed JSON is cast to a type although required fields are missing or hold null: a missing field reads undefined, and undefined and null pass every written type, so nothing throws.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
interface P { x: number; label: string; ok: boolean; opt?: number; child: { v: number } }
attempt("nothing", () => (JSON.parse("{}") as P).x)
attempt("a required number is missing", () => (JSON.parse('{"label":"l","ok":true,"child":{"v":1}}') as P).label)
attempt("a required string is missing", () => (JSON.parse('{"x":1,"ok":true,"child":{"v":1}}') as P).x)
attempt("a required object is missing", () => (JSON.parse('{"x":1,"label":"l","ok":true}') as P).x)
attempt("null for a number", () => (JSON.parse('{"x":null,"label":"l","ok":true,"child":{"v":1}}') as P).label)
attempt("null for a boolean", () => (JSON.parse('{"x":1,"label":"l","ok":null,"child":{"v":1}}') as P).label)
attempt("null for an optional number", () => (JSON.parse('{"x":1,"label":"l","ok":true,"opt":null,"child":{"v":1}}') as P).label)
attempt("null for a number, one level down", () => (JSON.parse('{"x":1,"label":"l","ok":true,"child":{"v":null}}') as P).label)
attempt("null for a string and an object", () => { const p = JSON.parse('{"x":1,"label":null,"ok":true,"child":null}') as P; return p.label + "/" + p.child })
// The type of `child` does not include null, so `child?.v` is a number according to its type. An optional chain may still produce undefined, which passes every written type.
attempt("optional chain on a reference that is null against its type", () => (JSON.parse('{"x":1,"label":null,"ok":true,"child":null}') as P).child?.v)
attempt("the same into a number", () => { const v: number = (JSON.parse('{"x":1,"label":null,"ok":true,"child":null}') as P).child?.v; return v })
attempt("over null, empty", () => (Object.create(null) as P).x)
attempt("inherits the fields", () => (Object.create({ x: 1, label: "l", ok: true, child: { v: 1 } }) as P).x)
attempt("getters", () => (Object.defineProperty(JSON.parse('{"label":"l","ok":true,"child":{"v":1}}'), "x", { get() { return 1 }, enumerable: true, configurable: true }) as P).x)
attempt("an empty literal", () => ({} as P).x)
attempt("a proxy", () => new Proxy(JSON.parse('{"x":1,"label":"l","ok":true,"child":{"v":1}}') as P, {}).x)
// Arrays, tuples and maps: their contents are not guaranteed, the read is tested, and null and undefined pass the test.
const withNull = JSON.parse("[1,null,3]") as number[]
attempt("element, a number", () => withNull[0])
attempt("element, null for a number", () => withNull[1])
attempt("element, null for a number, into a number", () => { const n: number = withNull[1]; return n })
attempt("element, out of bounds, by itself", () => String(withNull[3]))
attempt("element, out of bounds, returned", () => withNull[3])
attempt("element, out of bounds, into a number", () => { const n: number = withNull[3]; return n })
attempt("for of", () => { let s = 0; for (const n of withNull) s += n; return s })
attempt("tuple, null for a number", () => { const t = JSON.parse("[null,2]") as [number, number]; return t[0] + t[1] })
const byKey = new Map<string, number>()
;(byKey as Map<string, any>).set("n", null).set("u", undefined)
attempt("Map.get, null for number | undefined", () => byKey.get("n"))
attempt("Map.get, null for number | undefined, into such a place", () => { const n: number | undefined = byKey.get("n"); return n })
attempt("Map.get, undefined", () => byKey.get("u"))
// Results of functions from outside.
const parse = JSON.parse as (text: string) => number
attempt("result, null for a number", () => parse("null"))
attempt("result, null for a number, into a number", () => { const n: number = parse("null"); return n })
attempt("result, a number", () => parse("1") + 1)
