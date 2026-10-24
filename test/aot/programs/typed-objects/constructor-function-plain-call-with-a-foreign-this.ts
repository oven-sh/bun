// A constructor function is called without `new`, with a `this` that it has not made: its stores go to that object by the rules of any store, nothing is allocated, and `new` of the same function goes on making objects of its own.
const show = (o: object): string => Object.keys(o).join() + " " + JSON.stringify(o)
const attempt = (label: string, run: () => unknown) => { try { console.log(label, String(run())) } catch (error) { console.log(label, "throws", (error as Error).constructor.name) } }

interface Point { x: number; y: number }
function Point(this: Point, x: number, y: number) { this.x = x; this.y = y }
Point.prototype.sum = function (this: Point) { return this.x + this.y }
const PointClass = Point as unknown as new (x: number, y: number) => Point
const untyped: any = Point
const sumOf = (point: Point) => point.x + point.y

const first = new PointClass(1, 2)
console.log(show(first), sumOf(first), (first as any).sum(), first instanceof PointClass)

const otherShape: any = { y: "old", extra: 1 }
console.log(untyped.call(otherShape, 3, 4), show(otherShape), "sum" in otherShape, otherShape instanceof PointClass)
const literal: Point = { x: 0, y: 0 }
console.log(Point.call(literal, 5, 6), show(literal), sumOf(literal), Object.getPrototypeOf(literal) === Object.prototype)
console.log(untyped.call(first, 7, 8), show(first), sumOf(first), (first as any).sum())
const bare: any = Object.create(null)
console.log(untyped.call(bare, 9, 10), Object.keys(bare).join(), bare.x + bare.y, Object.getPrototypeOf(bare))

const calls: string[] = []
const inheritsAccessors: any = Object.create({ set x(value: number) { calls.push("set x " + value) }, get x() { return -1 }, get y() { return -2 } })
attempt("a setter and a getter alone above it:", () => untyped.call(inheritsAccessors, 11, 12))
console.log(calls.join(), show(inheritsAccessors), inheritsAccessors.x, inheritsAccessors.y)
const ownAccessor: any = { set y(value: number) { calls.push("own set y " + value) }, x: "x" }
console.log(untyped.call(ownAccessor, 13, 14), calls.join(), Object.keys(ownAccessor).join(), ownAccessor.x, ownAccessor.y)

const frozen = Object.freeze({ x: 0, y: 0 }), sealed: any = Object.seal({ y: 0 }), unextended: any = Object.preventExtensions({ x: 0 })
attempt("frozen:", () => untyped.call(frozen, 1, 2))
attempt("sealed:", () => untyped.call(sealed, 1, 2))
attempt("not extensible:", () => untyped.call(unextended, 1, 2))
console.log(show(frozen), show(sealed), show(unextended))
const readOnly: any = Object.defineProperty({ x: 0 }, "y", { value: "fixed", writable: false, enumerable: true, configurable: true })
attempt("read-only:", () => untyped.call(readOnly, 15, 16))
console.log(show(readOnly))

const trapped: string[] = []
const proxy: any = new Proxy({ kept: true }, {
  set(target: any, key, value, receiver) { trapped.push("set " + String(key) + " " + value); return Reflect.set(target, key, value, receiver) },
  defineProperty(target, key, descriptor) { trapped.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor) },
  getPrototypeOf(target) { trapped.push("prototype"); return Reflect.getPrototypeOf(target) },
})
console.log(untyped.call(proxy, 17, 18), trapped.join(), show(proxy))

for (const primitive of [5, "text", true, 10n, Symbol.iterator, undefined, null]) attempt("this is " + typeof primitive + ":", () => untyped.call(primitive, 1, 2))
attempt("no this:", () => untyped(1, 2))
attempt("no this, read out of a variable:", () => { const f = untyped; return f(1, 2) })

class Labels { x = "a"; y = "b"; z = "c"; join() { return this.x + this.y + this.z } }
const labels = new Labels()
console.log(untyped.call(labels, 19, 20), show(labels), typeof labels.x, labels.join(), labels instanceof Labels)
const list: any = [1, 2, 3]
console.log(untyped.call(list, 21, 22), list.length, Object.keys(list).join(), list.x, Array.isArray(list))
const callable: any = function named() {}
console.log(untyped.call(callable, 23, 24), Object.keys(callable).join(), callable.x + callable.y, callable.name)
console.log(untyped.call(Point, 25, 26), Object.keys(Point).join(), untyped.x, new PointClass(27, 28).x, delete untyped.x, delete untyped.y)
console.log(untyped.call(Point.prototype, 29, 30), Object.keys(Point.prototype).join(), show(new PointClass(31, 32)), (Object.create(Point.prototype) as Point).x, delete Point.prototype.x, delete Point.prototype.y)

const applied: any = {}, reflected: any = {}, bound: any = {}, holder: any = { tag: "holder", init: Point }
console.log(untyped.apply(applied, [33, 34]), Reflect.apply(Point, reflected, [35, 36]), untyped.bind(bound)(37, 38), untyped.bind(bound, 39).call(first, 40), holder.init(41, 42))
console.log(show(applied), show(reflected), show(bound), Object.keys(holder).join(), holder.x, show(first))
console.log(untyped.call({}, 1), show(Object.assign({}, (untyped.call(applied), applied))), untyped.call(applied, "s", null), show(applied))

interface Box { value: number }
function Box(this: Box, value: number) { this.value = value; if (value < 0) return { value: -value, swapped: true }; if (value === 0) return 0; return undefined }
const BoxClass = Box as unknown as new (value: number) => Box, untypedBox: any = Box
for (const value of [-3, 0, 3]) {
  const given: any = { given: true }, made = new BoxClass(value)
  console.log(JSON.stringify(untypedBox.call(given, value)), show(given), show(made), made instanceof BoxClass)
}

let total = 0
const reused: any = { y: 0, tag: "reused", x: 0 }
for (let round = 0; round < 20000; round++) {
  const made = new PointClass(round, 1)
  untyped.call(round & 1 ? reused : made, made.y, round & 7)
  total += sumOf(made) + reused.x + reused.y
}
console.log(total, show(reused), show(new PointClass(43, 44)))
