interface Opts { width: number; height?: number; label?: string; unit?: string }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function show(o: Opts): string {
  return [o.width, String(o.height), String(o.label), String(o.unit), "height" in o, Object.hasOwn(o, "height"), Object.keys(o).join("")].join("/")
}
function areaOf(o: Opts): number { return o.width * (o.height ?? 1) }
const small: Opts = { width: 2 }
const other: Opts = { width: 3 }
console.log(show(small), areaOf(small))
// The one it has.
console.log(Object.setPrototypeOf(small, Object.prototype) === small, Reflect.setPrototypeOf(small, Object.prototype), Object.getPrototypeOf(small) === Object.getPrototypeOf(other), Object.getPrototypeOf(small) === Object.prototype)
;(small as any).__proto__ = Object.prototype
small.height = 6
console.log(show(small), areaOf(small), delete small.height, show(small), areaOf(small), "toString" in small, String(small), (small as any).__proto__ === Object.prototype)
// A compiled object as the prototype of ordinary objects, which untyped code reads.
const parentOpts: Opts = { width: 100, height: 50, unit: "cm" }
const under: any = Object.create(parentOpts)
under.width = 7
const further: any = Object.create(under)
console.log(under.width, under.height, under.unit, under.label, further.width, further.height, Object.keys(under).join(), "unit" in further, Object.hasOwn(under, "height"))
parentOpts.height = 51; delete parentOpts.unit; parentOpts.label = "parent"
console.log(under.height, under.unit, under.label, further.label, Object.prototype.isPrototypeOf.call(parentOpts, further), Object.getPrototypeOf(under) === parentOpts)
further.height = 1
console.log(further.height, under.height, parentOpts.height, show(parentOpts))
console.log(attempt(() => Object.setPrototypeOf(Object.preventExtensions({ width: 1 } as Opts), Object.prototype).width), Reflect.setPrototypeOf(Object.freeze({ width: 1 } as Opts), Object.prototype))
// Instances of a class.
class Shape2 {
  side = 2; tint?: string
  area(): number { return this.side * this.side }
  get twice(): number { return this.side * 2 }
  describe(): string { return "shape " + this.area() + " " + this.twice + " " + String(this.tint) }
}
class Cube extends Shape2 { override area(): number { return super.area() * 6 } }
const moved = new Shape2(), cube = new Cube()
console.log(moved.describe(), cube.describe(), moved instanceof Cube, cube instanceof Shape2)
console.log(Object.setPrototypeOf(moved, Shape2.prototype) === moved, Reflect.setPrototypeOf(cube, Cube.prototype), Object.getPrototypeOf(cube) === Cube.prototype, Object.getPrototypeOf(Cube.prototype) === Shape2.prototype, Object.getPrototypeOf(Cube) === Shape2)
console.log(Reflect.setPrototypeOf(Cube.prototype, Shape2.prototype), Shape2.prototype.area.call(cube), Cube.prototype.area.call(cube), Shape2.prototype.describe.call(cube), Shape2.prototype.isPrototypeOf(cube))
// A method of the subclass on an object of the base class, which is assignable to the type of the subclass (it adds no member).
console.log(Cube.prototype.area.call(moved))
// A loop in which the prototype of the receiver is set again and again.
const shifting: Opts = { width: 1 }
let sum = 0
for (let i = 0; i < 50; i++) { Object.setPrototypeOf(shifting, Object.prototype); if (i === 25) shifting.height = 3; sum += areaOf(shifting) + areaOf(other) + (shifting.label ? 1 : 0) }
console.log(sum)
