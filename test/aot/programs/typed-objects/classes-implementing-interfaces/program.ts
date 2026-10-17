interface Shaped { sides: number; label: string; area(): number; note?: string }
interface Scalable { scale(by: number): void }
interface ShapedMaker { new (size: number): Shaped; family: string }
class Square implements Shaped, Scalable {
  static family = "quad"
  sides = 4
  label: string
  constructor(public edge: number, label = "square") { this.label = label }
  area() { return this.edge * this.edge }
  scale(by: number) { this.edge *= by }
}
class Disc implements Shaped {
  static family = "round"
  sides = 0; label = "disc"; note = "no corners"
  constructor(private radius: number) {}
  area() { return Math.round(this.radius * this.radius * 3) }
}
class Framed extends Square {
  frame = 1
  override area() { return super.area() + this.frame }
}
abstract class Partly implements Shaped {
  abstract sides: number
  label = "partly"
  abstract area(): number
  twice() { return this.area() * 2 }
}
class Whole extends Partly { sides = 6; area() { return this.sides * 10 } }
class Counting implements Shaped {
  reads = 0; label = "counting"
  get sides() { return ++this.reads }
  set sides(n: number) { this.reads = n * 10 }
  area() { return this.reads }
}
class Fielded implements Shaped { sides = 2; label = "fielded"; area = () => this.sides + 0.5 }
class Loose { sides = 8; label = "loose"; area() { return 8 } }
const triangle: Shaped = { sides: 3, label: "triangle", area() { return this.sides * 2 } }
const arrowed: Shaped = { label: "arrowed", area: () => 7, sides: 1, note: "a function in a field" }
function describe(s: Shaped): string {
  return [s.label, s.sides, s.area(), String(s.note), "note" in s, Object.keys(s).join("")].join(":")
}
const all: Shaped[] = [new Square(2), new Disc(2), new Framed(3, "framed"), new Whole(), new Counting(), new Fielded(), new Loose(), triangle, arrowed]
console.log(all.map(s => describe(s)).join(" "))
for (const s of all) { s.label += "!"; if (s.sides > 2) s.note = "late " + s.sides; s.sides++ }
console.log(all.map(s => describe(s)).join(" "))
function isScalable(s: object): s is Scalable { return "scale" in s }
let scaled = 0
for (const s of all) if (isScalable(s)) { s.scale(2); scaled++ }
console.log(scaled, all.map(s => s.area()).join(), new Whole().twice())
function build(maker: ShapedMaker, size: number): string {
  const made = new maker(size)
  return maker.family + "/" + describe(made) + "/" + (made instanceof Square)
}
console.log(build(Square, 5), build(Disc, 1), build(Framed, 2))
// Methods detached from their class or literal and called on another object of their type. (On an object of another type: type-rules/classes-implementing-interfaces.)
const area = Square.prototype.area
console.log(area.call(new Framed(4)), triangle.area.call(arrowed))
const detached = all.map(s => s.area)
console.log(detached[5]!(), detached[8]!(), detached[7]!.call(all[0]), detached[0]!.call(all[2]))
// An interface that extends a class, and a literal of it where the class is expected.
interface SquareLike extends Square { extra?: number }
const fake: SquareLike = { sides: 4, label: "fake", edge: 9, area() { return -1 }, scale() {}, extra: 1 }
function edgeOf(s: Square): number { return s.edge + s.area() }
console.log(edgeOf(fake), edgeOf(new Square(1)), edgeOf(new Framed(1)), fake instanceof Square, fake.extra)
const both: Shaped & Scalable = new Framed(1)
both.scale(3); both.note = "both"
console.log(describe(both), (both as Framed).frame, JSON.stringify(both))
let sum = 0
for (let i = 0; i < 90; i++) { const s = all[i % all.length]; sum += s.area() + s.sides; if (i % 10 === 0) s.sides = i }
console.log(sum, all.map(s => s.sides).join())
