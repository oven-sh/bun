// Objects of a record type that typed code gives a prototype, also where untyped code sees them: the methods are found, the fields stay own properties, another prototype from untyped code is taken too.
// IR+ ^layout L\d+ .*name="Point" (?!.*impossibleMutations=\[[^\]]*ChangePrototype)(?!.*isStable=true)
// VALIDATED compiles
interface Point { x: number; y: number }
const methods = { describe(this: any) { return "(" + this.x + ", " + this.y + ")" }, x: "inherited" }
function make(x: number, y: number): Point {
  const made: Point = { x, y }
  Object.setPrototypeOf(made, methods)
  return made
}
function norm(point: Point) { return point.x * point.x + point.y * point.y }
const seen: any[] = []
const point = make(3, 4)
seen.push(point)
console.log(norm(seen[0]), seen[0].describe(), Object.getPrototypeOf(point) === methods, Object.keys(point).join(), JSON.stringify(point), seen[0].x)
Object.setPrototypeOf(seen[0], { describe() { return "another" }, y: "inherited" })
console.log(norm(point), seen[0].describe(), Object.getPrototypeOf(point) === methods, seen[0].y, "describe" in point)
seen[0].extra = 1
console.log(norm(point), Object.keys(point).join(), seen[0].extra)
delete seen[0].x
console.log(seen[0].x, Object.keys(point).join())
