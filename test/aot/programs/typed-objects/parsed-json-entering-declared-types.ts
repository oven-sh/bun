// Parsed JSON enters a declared type by `as` or by an annotated variable: where it does not fit, the annotated variable throws a TypeError and `as` lets it pass.
/* expected
a1 2
a2 l!
a3 true
a4 undefined
a5 3
a6 false false
a7 1 2
a8 true
a9 {"label":"l","x":1,"ok":false,"child":{"v":2,"w":3},"zeta":1,"extra":[1]}
b1 TypeError
b2 TypeError
b3 TypeError
b4 TypeError
b5 TypeError
b6 TypeError
b7 object
b8 object
b9 TypeError
b10 TypeError
b11 undefined
b12 TypeError
b13 null
b14 null
b15 TypeError
b16 {"x":"1","label":"l","ok":true,"child":{"v":2}}
c1 NaN
c2 1
c3 1
c4 1
c5 undefined
c6 undefined
d1 TypeError
d2 TypeError
d3 1label,ok,child
e1 11
e2 11
g1 TypeError
g2 function
g3 TypeError
g4 object
h1 1
h2 1 1
h3 1
h4 1
h5 1
h6 TypeError
h7 0
h8 TypeError
h9 TypeError
i1 true false 3
i2 TypeError true
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
interface P { x: number; label: string; ok: boolean; opt?: number; child: { v: number } }
const text = '{"x":1,"label":"l","ok":true,"child":{"v":2}}'
const source = JSON.parse(text)
const good = source as P
attempt("a1", () => good.x + 1)
attempt("a2", () => good.label + "!")
attempt("a3", () => good.ok === true)
attempt("a4", () => good.opt)
attempt("a5", () => good.child.v + 1)
// A copy: not identical, and what happens to the one is not seen in the other.
attempt("a6", () => (good === source) + " " + (good.child === source.child))
attempt("a7", () => { source.x = 50; source.child.v = 50; return good.x + " " + good.child.v })
attempt("a8", () => JSON.stringify(good) === text)
// The fields keep the order they had in the source. What the type does not name is kept too, and lists after the fields.
attempt("a9", () => JSON.stringify(JSON.parse('{"zeta":1,"label":"l","x":1,"extra":[1],"ok":false,"child":{"v":2,"w":3}}') as P))
// A value of another kind than the field, at any depth; a required property that is missing. Nothing is converted: the result of `cast` is written down.
const cast = (json: string): P => JSON.parse(json) as P
attempt("b1", () => cast('{"x":"1","label":"l","ok":true,"child":{"v":2}}').x)
attempt("b2", () => cast('{"x":1,"label":2,"ok":true,"child":{"v":2}}').label)
attempt("b3", () => cast('{"x":1,"label":"l","ok":"yes","child":{"v":2}}').ok)
attempt("b4", () => cast('{"x":1,"label":"l","ok":true,"opt":"o","child":{"v":2}}').opt)
attempt("b5", () => cast('{"x":1,"label":"l","ok":true,"child":{"v":"two"}}').child.v)
attempt("b6", () => typeof cast('{"x":1,"label":"l","ok":true,"child":5}').child)
attempt("b6t", () => { const c: { v: number } = cast('{"x":1,"label":"l","ok":true,"child":5}').child; return typeof c })
attempt("b7", () => typeof cast('{"x":{},"label":"l","ok":true,"child":{"v":2}}').x)
attempt("b8", () => typeof cast('{"x":1,"label":[],"ok":true,"child":{"v":2}}').label)
attempt("b9", () => Array.isArray(cast('{"x":1,"label":"l","ok":true,"child":[]}').child))
attempt("b10", () => cast('{"label":"l","ok":true,"child":{"v":2}}').x)
attempt("b11", () => cast('{"x":1,"label":"l","ok":true}').child)
// A number cannot be null. A reference can; where the property is missing it reads `undefined` (b11; since j95). An optional number can be undefined, not null.
attempt("b12", () => cast('{"x":null,"label":"l","ok":true,"child":{"v":2}}').x)
attempt("b13", () => cast('{"x":1,"label":null,"ok":true,"child":{"v":2}}').label)
attempt("b14", () => cast('{"x":1,"label":"l","ok":true,"child":null}').child)
attempt("b15", () => cast('{"x":1,"label":"l","ok":true,"opt":null,"child":{"v":2}}').opt)
attempt("b16", () => { const bad = JSON.parse('{"x":"1","label":"l","ok":true,"child":{"v":2}}'); try { bad as P } catch {} return JSON.stringify(bad) })
// What is not plain data is not copied, and no code of the program runs to find that out: `as` lets it through as it is. A read through it is the general read (getter, trap, chain), and is itself a coercion: c1 is ToNumber("proto").
let ran = 0
attempt("c1", () => (Object.create({ x: "proto" }) as P).x)
attempt("c2", () => { try { return (Object.defineProperty(JSON.parse(text), "x", { get() { ran++; return 1 }, enumerable: true, configurable: true }) as P).x } catch (e) { return (e as Error).constructor.name + " " + ran } })
attempt("c3", () => { try { return (new Proxy(JSON.parse(text), { get(t, k) { ran++; return t[k] }, ownKeys(t) { ran++; return Reflect.ownKeys(t) }, getOwnPropertyDescriptor(t, k) { ran++; return Reflect.getOwnPropertyDescriptor(t, k) } }) as P).x } catch (e) { return (e as Error).constructor.name + " " + ran } })
attempt("c4", () => (Object.freeze(JSON.parse(text)) as P).x)
attempt("c5", () => (new Date(0) as unknown as P).x)
attempt("c6", () => ((() => 1) as unknown as P).x)
attempt("d1", () => { const { x }: P = JSON.parse('{"x":"1","label":"l","ok":true,"child":{"v":2}}'); return x })
attempt("d2", () => { const { child: { v } }: P = JSON.parse('{"x":1,"label":"l","ok":true,"child":{"v":"two"}}'); return v })
attempt("d3", () => { const { x, ...others }: P = JSON.parse(text); return x + Object.keys(others).join() })
// One access site sees objects that a literal made and copies of plain data.
function sum(items: P[]): number { let s = 0; for (const item of items) s += item.x; return s }
const own: P = { x: 5, label: "own", ok: false, child: { v: 1 } }
attempt("e1", () => sum([own, good, own]))
attempt("e2", () => sum([good, own, own]))
// A field of function type takes what can be called, and null. Nothing can be converted into a function: the read through what was let through asserts.
interface H { run: () => number }
attempt("g1", () => typeof (JSON.parse('{"run":5}') as H).run)
attempt("g2", () => typeof ({ run: Math.random } as H).run)
attempt("g3", () => typeof (JSON.parse('{"run":{}}') as H).run)
attempt("g4", () => typeof (JSON.parse('{"run":null}') as H).run)
// The places whose type is written down coerce as `as` does: variable, parameter (also for a caller that knows nothing of it), result, field.
function viaParameter(p: P): number { return p.x }
function viaResult(): P { return JSON.parse(text) }
interface Holder { p: P }
attempt("h1", () => { const p: P = JSON.parse(text); return p.x })
attempt("h2", () => viaParameter(JSON.parse(text)) + " " + (viaParameter as any)(JSON.parse(text)))
attempt("h3", () => viaResult().x)
attempt("h4", () => { const holder: Holder = { p: own }; holder.p = JSON.parse(text); return holder.p.x })
// So does a store by code that does not know the object: the doors coerce where the field's type is written down.
function store(target: any, value: unknown): void { target.p = value }
attempt("h5", () => { const holder: Holder = { p: own }; store(holder, JSON.parse(text)); return holder.p.x })
// This does not: a parameter that has its type from its default only.
function viaDefault(o = { a: 1 }): number { return o.a }
attempt("h6", () => (viaDefault as any)(JSON.parse('{"a":2}')))
// What a function does to its parameter it does to the copy.
function fill(p: P): void { p.x = 1 }
attempt("h7", () => { const plain = JSON.parse('{"x":0,"label":"l","ok":true,"child":{"v":2}}'); (fill as any)(plain); return plain.x })
// An element read throws without trying. `!` asserts that there is something, and copies nothing.
attempt("h8", () => { const list: P[] = []; (list as unknown[]).push(JSON.parse(text)); return list[0].x })
attempt("h9", () => { const list: P[] = []; (list as unknown[]).push(JSON.parse(text)); return list[0]!.x })
// An array stays the array it is, and its elements are replaced by their copies. If one cannot be copied none is replaced.
attempt("i1", () => { const array = JSON.parse("[" + text + "," + text + "]"), first = array[0]; const items = array as P[]; return (items === array) + " " + (array[0] === first) + " " + (sum(items) + 1) })
attempt("i2", () => { const array = JSON.parse("[" + text + ',{"x":"1"}]'), first = array[0]; try { return sum(array as P[]) } catch (e) { return (e as Error).constructor.name + " " + (array[0] === first) } })
