// One object is used through many types at once: a store through any of them is visible through all the others.
interface V1 { x: number }
interface V2 { x: number; y: string }
interface V3 { y: string; z?: boolean }
type V4 = { readonly x: number; readonly y: string }
type V5 = Partial<V2>
type V6 = V1 & V3
type V7 = { x: number | string; y: string | null }
interface V8 { w: number[]; bump?: () => number }
class Impl { x = 1; y = "one"; z?: boolean; w = [0]; bump() { return ++this.x } }
interface Held { v1: V1; v2: V2; v3: V3; v4: V4; v5: V5; v6: V6; v7: V7; v8: V8 }
type Born = { y: string; w: number[]; x: number }
function hold(o: V2 & V8): Held { return { v1: o, v2: o, v3: o, v4: o, v5: o, v6: o, v7: o, v8: o } }
function readAll(h: Held): string {
  return [h.v1.x, h.v2.x, h.v4.x, h.v5.x, h.v6.x, h.v7.x].join() + " " + [h.v2.y, h.v3.y, h.v4.y, h.v5.y, h.v6.y, h.v7.y].join() + " " +
    [h.v3.z, h.v6.z].map(String).join() + " " + h.v8.w.join("") + " " + Object.keys(h.v1).join("")
}
function same(...objects: object[]): boolean { return objects.every(o => o === objects[0]) }
const born: Born = { y: "lit", w: [9], x: 5 }
const impl = new Impl()
for (const h of [hold(born), hold(impl)]) {
  console.log(readAll(h))
  h.v1.x = 2; console.log(readAll(h))
  h.v2.y = "two"; console.log(readAll(h))
  h.v3.z = true; console.log(readAll(h))
  h.v5.x = 2.5; console.log(readAll(h))
  h.v6.y += "!"; h.v6.x *= -1; console.log(readAll(h))
  h.v7.x = 1e10; h.v7.y = "seven"; console.log(readAll(h))
  h.v8.w = [1, 2]; h.v8.w.push(3); console.log(readAll(h))
  delete h.v3.z; console.log(readAll(h), "z" in h.v6)
  h.v6.z = false; console.log(readAll(h), "z" in h.v3)
  console.log(same(h.v1, h.v2, h.v3, h.v4, h.v5, h.v6, h.v7, h.v8), new Set<object>(Object.values(h)).size, h.v8.bump?.(), h.v1.x)
}
console.log(JSON.stringify(born), JSON.stringify(impl), impl.bump(), impl instanceof Impl, born.x + impl.x)

// As a key: whatever type it is looked up by, it is the same key.
const weak = new WeakMap<object, string>()
const strong = new Map<V1, number>()
const held = hold(born)
weak.set(held.v3, "by v3")
strong.set(held.v1, 1)
strong.set(held.v6, 2)
strong.set(born, 3)
console.log(weak.get(held.v8), weak.get(born), weak.has(impl), strong.size, strong.get(held.v2), [held.v1, held.v2].indexOf(born))

// Closures and arrays, each with its own type of the object.
const getX: (() => number | string | undefined)[] = [() => held.v1.x, () => held.v4.x, () => held.v5.x, () => held.v7.x, () => born.x]
const setX: ((n: number) => void)[] = [n => { held.v1.x = n }, n => { held.v5.x = n }, n => { held.v6.x = n }, n => { held.v7.x = n }, n => { born.x = n }]
const matrix: string[] = []
setX.forEach((set, i) => { set(i + 0.5); matrix.push(getX.map(get => get()).join("")) })
console.log(matrix.join())
const list1: V1[] = [born, impl, born]
const list3: V3[] = [impl, born, impl]
for (let i = 0; i < 3; i++) { list1[i].x += 100; list3[i].y += i }
console.log(born.x, born.y, impl.x, impl.y)

// Passed as several arguments of one call.
function three(a: V1, b: V5, c: V7): string { a.x = 1; const first = b.x; b.x = 2; const second = c.x; c.x = 3; return [first, second, a.x, b.x, c.x].join() }
console.log(three(born, born, born), three(impl, impl, impl), three(born, impl, { x: "s", y: null }), three({ x: 0 }, {}, born), born.x, impl.x)

// A field holds the object under one type while a variable has it under another.
const owner: { item: V3; again: V1 | null } = { item: born, again: null }
owner.again = born
owner.item.y = "through the owner"
owner.again.x = 42
console.log(born.y, born.x, same(owner.item, owner.again), JSON.stringify(owner))

let total = 0
for (let i = 0; i < 3000; i++) { const h = i & 1 ? held : hold(impl); h.v1.x += 1; total += h.v2.x + h.v6.x + h.v4.y.length }
console.log(total, born.x, impl.x)
