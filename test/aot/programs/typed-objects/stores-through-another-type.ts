// A loaded field value must not be reused after a store through another type of the same object, after a call that may store, or after the object itself has changed.
interface Left { v: number; w: number }
interface Right { v: number; extra?: string }
function nameOf(e: unknown): string { return (e as Error).constructor.name }
function twoTypes(a: Left, b: Right): string { const before = a.v; b.v = before + 1; const after = a.v; a.v = after * 2; return before + "," + after + "," + b.v }
const shared = { v: 1, w: 2 }
console.log(twoTypes(shared, shared), twoTypes({ v: 1, w: 0 }, { v: 10 }), shared.v)

function throughAny(a: Left, b: any): number { const x = a.v; b.v = 50; return x + a.v }
function byKey(a: Left, o: Record<string, number>, k: string): number { const x = a.v; o[k] = 7; return x + a.v }
function viaCall(a: Left, f: () => void): number { const x = a.v; f(); return x + a.v }
function viaReflect(a: Left, o: object): number { const x = a.v; Reflect.set(o, "v", 9); return x + a.v }
function viaAssign(a: Left, o: object): number { const x = a.v; Object.assign(o, { v: 11 }); return x + a.v }
function viaDefine(a: Left, o: object): number { const x = a.v; Object.defineProperty(o, "v", { value: 13 }); return x + a.v }
const other = { v: 100, w: 0 }
console.log(throughAny(shared, shared), throughAny(shared, other), byKey(shared, shared, "v"), byKey(shared, shared, "w"), byKey(shared, other, "v"))
console.log(viaCall(shared, () => { shared.v = 8 }), viaCall(shared, () => { other.v = 8 }), viaReflect(shared, shared), viaAssign(shared, shared), viaDefine(shared, shared), JSON.stringify(shared), JSON.stringify(other))

// A getter of a class that stores, read between two reads of the field it changes.
class Tricky { v = 1; get w() { return ++this.v } }
const tricky = new Tricky()
function order(a: { readonly v: number; readonly w: number }): string { return a.v + "," + a.w + "," + a.v + "," + (a.v + a.w * 10 + a.v * 100) }
console.log(order(tricky), order({ v: 1, w: 2 }), tricky.v)
// The same with a getter that a literal defines, under an interface that has the name as a field.
const trickyLiteral: Left = { v: 1, get w() { return ++this.v } }
function orderLeft(a: Left): string { return a.v + "," + a.w + "," + a.v + "," + (a.v + a.w * 10 + a.v * 100) }
function peek(o: any): unknown { return o.w }
console.log(orderLeft(trickyLiteral), (trickyLiteral as any).w, trickyLiteral.v, peek(trickyLiteral), trickyLiteral.v, Object.keys(trickyLiteral).join())

// In a loop: the store happens in one iteration only.
function loop(a: Left, b: Right, at: number): number { let sum = 0; for (let i = 0; i < 10; i++) { sum += a.v; if (i === at) b.v = 100 } return sum }
console.log(loop({ v: 1, w: 0 }, { v: 1 }, 5), (() => { const o = { v: 1, w: 0 }; return loop(o, o, 5) })(), (() => { const o = { v: 1, w: 0 }; return loop(o, o, 20) })())
function loopCall(a: Left, f: (i: number) => void): number { let sum = 0; for (let i = 0; i < 10; i++) { sum += a.v; f(i) } return sum }
const target: Left = { v: 1, w: 0 }
console.log(loopCall(target, i => { if (i === 2) target.v = 10 }), loopCall(target, () => {}), loopCall(target, i => { if (i === 7) (target as any).v = 0.5 }))

// The object changes under the loop: redefined with another value; frozen; an optional field comes and goes.
function becomeData(o: object, v: number): void { Object.defineProperty(o, "v", { value: v, writable: true, configurable: true, enumerable: true }) }
const changing: Left = { v: 1, w: 0 }
console.log(loopCall(changing, i => { if (i === 3) becomeData(changing, 1000); if (i === 6) becomeData(changing, 2) }), changing.v, JSON.stringify(changing))
function storeLoop(a: Left, f: (i: number) => void): string { let i = 0; try { for (; i < 10; i++) { a.v = i; f(i) } return "done " + a.v } catch (e) { return nameOf(e) + " at " + i + " with " + a.v } }
const freezing: Left = { v: -1, w: 0 }
console.log(storeLoop(freezing, i => { if (i === 4) Object.freeze(freezing) }), storeLoop({ v: 0, w: 0 }, () => {}), Object.isFrozen(freezing))
function optionalLoop(b: Right, f: (i: number) => void): string { const out: string[] = []; for (let i = 0; i < 6; i++) { out.push(String(b.extra)); f(i) } return out.join() }
const inheriting: Right = { v: 0 }
console.log(optionalLoop(inheriting, i => { if (i === 1) (inheriting as any).extra = "any"; if (i === 2) inheriting.extra = "own"; if (i === 3) delete inheriting.extra; if (i === 4) Object.setPrototypeOf(inheriting, Object.prototype) }))

// The right-hand side changes the receiver before the store takes place.
const late: Left = { v: 1, w: 1 }
try { late.v = (Object.freeze(late), 5); console.log("stored") } catch (e) { console.log(nameOf(e), late.v) }
const swapping = { current: { v: 1, w: 1 } as Left }
const old = swapping.current
swapping.current.v = (swapping.current = { v: 10, w: 10 }).v + 1
console.log(old.v, swapping.current.v)
const counter: Left = { v: 1, w: 1 }
counter.v += (counter.v = 10, 5)
counter.w = counter.w++ + counter.w
console.log(counter.v, counter.w)

// The holder is what changes.
interface Holder { current: Left }
function throughHolder(h: Holder, f: () => void): number { const x = h.current.v; f(); return x + h.current.v }
const holder: Holder = { current: { v: 1, w: 0 } }
console.log(throughHolder(holder, () => { holder.current = { v: 20, w: 0 } }), throughHolder(holder, () => { holder.current.v++ }), holder.current.v)

// Two elements of one array, two fields of one object, the same object.
function elements(list: Left[], i: number, j: number): number { const x = list[i].v; list[j].v = x + 1; return list[i].v }
const one: Left = { v: 1, w: 0 }
console.log(elements([one, one], 0, 1), elements([one, { v: 0, w: 0 }], 0, 1), one.v)
function fields(p: { first: Left; second: Right }): number { p.first.v = 1; p.second.v = 2; return p.first.v }
console.log(fields({ first: one, second: one }), fields({ first: one, second: { v: 0 } }))

// A read returns exactly what was stored, bit for bit.
function roundTrip(a: Left, b: Right, v: number): boolean { a.v = v; const viaB = b.v; b.v = viaB; return Object.is(a.v, v) }
console.log([0, -0, NaN, 1.5, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, 1e308, -1e-308].map(v => roundTrip(shared, shared, v)).join())
