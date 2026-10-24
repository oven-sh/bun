// Parsed JSON enters a declared type by `as`, an annotated variable, a parameter or a result. Any object passes and stays the object it is. A field of another kind throws a TypeError at its first typed read, a missing field reads undefined.
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
// The same object: what happens to the one is seen in the other.
attempt("a6", () => (good === source) + " " + (good.child === source.child))
attempt("a7", () => { source.x = 50; source.child.v = 50; return good.x + " " + good.child.v })
attempt("a8", () => JSON.stringify(good) === text)
// The keys keep the order of the text, those that the type does not name included.
attempt("a9", () => JSON.stringify(JSON.parse('{"zeta":1,"label":"l","x":1,"extra":[1],"ok":false,"child":{"v":2,"w":3}}') as P))
// A value of another kind than the field, at any depth; a required property that is missing. Nothing is converted. The reads are made on the result of a call of `cast`, whose written result type is P, so each is a typed read; b6t holds the field in an annotated variable.
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
// null and undefined pass every written type.
attempt("b12", () => cast('{"x":null,"label":"l","ok":true,"child":{"v":2}}').x)
attempt("b13", () => cast('{"x":1,"label":null,"ok":true,"child":{"v":2}}').label)
attempt("b14", () => cast('{"x":1,"label":"l","ok":true,"child":null}').child)
attempt("b15", () => cast('{"x":1,"label":"l","ok":true,"opt":null,"child":{"v":2}}').opt)
attempt("b16", () => { const bad = JSON.parse('{"x":"1","label":"l","ok":true,"child":{"v":2}}'); try { bad as P } catch {} return JSON.stringify(bad) })
// Any object passes `as`, and no code of the program runs to find that out. A read through it is the generic read (getter, trap, chain), and what it gives is tested against the type of the field: c1 finds a string.
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
// One access site sees objects that a literal made and parsed objects.
function sum(items: P[]): number { let s = 0; for (const item of items) s += item.x; return s }
const own: P = { x: 5, label: "own", ok: false, child: { v: 1 } }
attempt("e1", () => sum([own, good, own]))
attempt("e2", () => sum([good, own, own]))
// A field of function type takes what can be called, and null. The typed read finds anything else.
interface H { run: () => number }
attempt("g1", () => typeof (JSON.parse('{"run":5}') as H).run)
attempt("g2", () => typeof ({ run: Math.random } as H).run)
attempt("g3", () => typeof (JSON.parse('{"run":{}}') as H).run)
attempt("g4", () => typeof (JSON.parse('{"run":null}') as H).run)
// The places whose type is written down test as `as` does: variable, parameter (also for a caller that knows nothing of it), result, field.
function viaParameter(p: P): number { return p.x }
function viaResult(): P { return JSON.parse(text) }
interface Holder { p: P }
attempt("h1", () => { const p: P = JSON.parse(text); return p.x })
attempt("h2", () => viaParameter(JSON.parse(text)) + " " + (viaParameter as any)(JSON.parse(text)))
attempt("h3", () => viaResult().x)
attempt("h4", () => { const holder: Holder = { p: own }; holder.p = JSON.parse(text); return holder.p.x })
// A store by code that does not know the object is not tested. The typed read after it is.
function store(target: any, value: unknown): void { target.p = value }
attempt("h5", () => { const holder: Holder = { p: own }; store(holder, JSON.parse(text)); return holder.p.x })
// A parameter that has its type from its default only is not tested.
function viaDefault(o = { a: 1 }): number { return o.a }
attempt("h6", () => (viaDefault as any)(JSON.parse('{"a":2}')))
// What a function does to its parameter it does to the caller's object.
function fill(p: P): void { p.x = 1 }
attempt("h7", () => { const plain = JSON.parse('{"x":0,"label":"l","ok":true,"child":{"v":2}}'); (fill as any)(plain); return plain.x })
// An element read gives the object that was pushed. `!` tests nothing.
attempt("h8", () => { const list: P[] = []; (list as unknown[]).push(JSON.parse(text)); return list[0].x })
attempt("h9", () => { const list: P[] = []; (list as unknown[]).push(JSON.parse(text)); return list[0]!.x })
// An array stays the array it is, and so do its elements.
attempt("i1", () => { const array = JSON.parse("[" + text + "," + text + "]"), first = array[0]; const items = array as P[]; return (items === array) + " " + (array[0] === first) + " " + (sum(items) + 1) })
attempt("i2", () => { const array = JSON.parse("[" + text + ',{"x":"1"}]'), first = array[0]; try { return sum(array as P[]) } catch (e) { return (e as Error).constructor.name + " " + (array[0] === first) } })
