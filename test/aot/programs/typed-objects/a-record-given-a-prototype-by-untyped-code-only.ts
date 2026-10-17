// The other side of a-record-given-a-prototype-by-typed-code.ts: where only untyped code sets the prototype of a record that may give up its layout, the type is not marked, and the one object gives up its layout.
// IR- ^shape \d+ Record "Point" .* prototype set by typed code
// IR- ^shape \d+ Record "Point" .* other prototypes
// VALIDATED compiles
interface Point { x: number; y: number }
const make = (x: number, y: number): Point => ({ x, y })
function norm(point: Point) { return point.x * point.x + point.y * point.y }
const seen: any[] = [make(3, 4), make(1, 2)]
Object.setPrototypeOf(seen[0], { describe(this: any) { return "(" + this.x + ", " + this.y + ")" } })
console.log(norm(seen[0]), norm(seen[1]), seen[0].describe(), "describe" in seen[1], Object.keys(seen[0]).join(), JSON.stringify(seen))
