// The other side of a-record-given-a-prototype-by-typed-code.ts: the prototype of a record is set where its type is not written, through an array of `any`. The one object gives up its layout, the others keep theirs.
// IR+ ^layout L\d+ .*name="Point" .* representation=Typed
// VALIDATED compiles
interface Point { x: number; y: number }
const make = (x: number, y: number): Point => ({ x, y })
function norm(point: Point) { return point.x * point.x + point.y * point.y }
const seen: any[] = [make(3, 4), make(1, 2)]
Object.setPrototypeOf(seen[0], { describe(this: any) { return "(" + this.x + ", " + this.y + ")" } })
console.log(norm(seen[0]), norm(seen[1]), seen[0].describe(), "describe" in seen[1], Object.keys(seen[0]).join(), JSON.stringify(seen))
