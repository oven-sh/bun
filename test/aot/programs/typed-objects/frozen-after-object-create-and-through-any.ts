const attempt = (f: () => unknown): string => {
  try {
    return String(f())
  } catch (error) {
    return (error as Error).constructor.name
  }
}
interface Point {
  readonly kind: string
  x: number
  y: number
  note?: string
}
const Proto = { kind: "point" }
function makeFrozen(x: number, y: number): Point {
  const self = Object.create(Proto)
  self.x = x
  self.y = y
  return Object.freeze(self)
}
function makeSealed(x: number, y: number): Point {
  const self = Object.assign(Object.create(Proto), { x, y })
  return Object.seal(self)
}
function makeClosed(x: number, y: number): Point {
  const self: Point = Object.create(Proto)
  self.x = x
  self.y = y
  Object.preventExtensions(self)
  return self
}
function makeOpen(x: number, y: number): Point {
  const self = Object.create(Proto)
  self.x = x
  self.y = y
  return self
}
function makeByNames(names: string[]): Record<string, number> {
  const self = Object.create(Proto)
  for (const name of names) self[name] = name.length
  return Object.freeze(self)
}
class Counter {
  count = 0
  step() {
    this.count = this.count + 1
    return this.count
  }
}
const tell = (point: Point) =>
  [
    attempt(() => ((point.x = point.x + 1), point.x)),
    attempt(() => ((point.note = "n"), point.note)),
    attempt(() => delete (point as Partial<Point>).y),
    Object.isFrozen(point),
    Object.isSealed(point),
    Object.isExtensible(point),
    Object.keys(point).join(),
  ].join(" ")
let warm = 0
for (let i = 0; i < 300; i++) warm += tell([makeFrozen, makeSealed, makeClosed, makeOpen][i & 3]!(i, 1)).length
console.log("warm", warm)
console.log("frozen", tell(makeFrozen(1, 2)))
console.log("sealed", tell(makeSealed(1, 2)))
console.log("may not grow", tell(makeClosed(1, 2)))
console.log("open", tell(makeOpen(1, 2)))
const byNames = makeByNames(["a", "bb"])
console.log("by names", attempt(() => ((byNames.a = 5), byNames.a)), attempt(() => ((byNames.c = 1), byNames.c)), Object.isFrozen(byNames), Object.keys(byNames).join())
const counter = new Counter()
for (let i = 0; i < 300; i++) counter.step()
console.log("a class beside them", counter.step())
const later = makeOpen(3, 4)
const alias: any = later
Object.freeze(alias)
console.log("frozen later through any", tell(later))
