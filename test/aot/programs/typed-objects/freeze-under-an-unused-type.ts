// Objects are passed to `Object.freeze` under a type through which no code ever reads them.
interface Point { x: number; y: number }
interface Sealed { x: number }
interface Holder { inner: Sealed; tag: string }
function seal(s: Sealed): void { Object.freeze(s) }
function sealAll<T extends Sealed>(all: T[]): T[] { for (const one of all) Object.freeze(one); return all }
function attempt(f: () => void): string { try { f(); return "stored" } catch (e) { return (e as Error).constructor.name } }
const p: Point = { x: 1, y: 2 }, other: Point = { x: 3, y: 4 }
seal(p)
console.log(Object.isFrozen(p), Object.isFrozen(other), attempt(() => { p.x = 5 }), p.x, attempt(() => { other.x = 6 }), other.x)
const made: Holder = { inner: { x: 0 }, tag: "m" }
const holder: Holder = JSON.parse('{"inner":{"x":7},"tag":"t"}')
seal(holder.inner)
console.log(made.inner.x, Object.isFrozen(holder.inner), Object.isFrozen(holder), attempt(() => { holder.inner.x = 8 }), holder.inner.x, attempt(() => { holder.tag = "u" }), holder.tag)
const many = sealAll([{ x: 1, z: "z" }, { x: 2, z: "y" }])
console.log(many.map(one => Object.isFrozen(one)).join(), attempt(() => { many[0].z = "w" }), many[0].z)
const back: Point = Object.freeze({ x: 9, y: 9 }) as Sealed as Point
console.log(Object.isFrozen(back), attempt(() => { back.y = 0 }), back.y)
