// The keys of an object that a constructor function makes are listed in the order in which its stores created them, whatever order the type declares, whichever branch ran and however the object was allocated.
// VALIDATED compiles
const keys = (o: object): string => Object.keys(o).join()
const everyListing = (o: object): string => {
  const forIn: string[] = []
  for (const key in o) forIn.push(key)
  return [keys(o), forIn.join(), Object.entries(o).map(([key]) => key).join(), Object.getOwnPropertyNames(o).join(), Reflect.ownKeys(o).map(String).join(), Object.keys(JSON.parse(JSON.stringify(o))).join(), Object.keys({ ...o }).join(), Object.keys(Object.assign({}, o)).join()].join(" | ")
}

// Ten stores in a row, in another order than the type declares, through a constructor that is held in a variable.
interface Node10 { kind: number; pos: number; end: number; id: number; flags: number; cache: number; transform: number; parent: Node10 | undefined; original: Node10 | undefined; emit: object | undefined; symbol?: object; locals?: object }
function Node10(this: Node10, kind: number, pos: number, end: number) {
  this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0
  this.cache = 0; this.transform = 0; this.parent = undefined; this.original = undefined; this.emit = undefined
}
type Node10Class = new (kind: number, pos: number, end: number) => Node10
const allocator = { getNodeConstructor: (): Node10Class => Node10 as any }
let nodeConstructor: Node10Class | undefined
const createNode = (kind: number): Node10 => new (nodeConstructor || (nodeConstructor = allocator.getNodeConstructor()))(kind, -1, -1)
const node = createNode(7)
console.log(everyListing(node))
node.locals = {}; node.symbol = {}
console.log(keys(node), keys(createNode(8)), JSON.stringify(createNode(9)))

// The order depends on the arguments.
interface Options { a: number; b?: string; c?: number; d: boolean }
function Options(this: Options, mode: number) {
  if (mode & 1) this.b = "b"
  this.a = mode
  if (mode & 2) this.c = mode / 2
  if (mode & 4) { this.d = true; if (!(mode & 1)) this.b = "late" } else this.d = false
}
const OptionsClass = Options as unknown as new (mode: number) => Options
const orders: string[] = []
for (let mode = 0; mode < 8; mode++) orders.push(keys(new OptionsClass(mode)).replaceAll(",", ""))
console.log(orders.join(" "))

// A second store to a name creates nothing. A deleted name goes to the end when it is stored again.
interface Again { a: number; b: number; c: number }
function Again(this: Again, removes: boolean) { this.a = 1; this.b = 2; this.a = 3; this.c = 4; if (removes) { delete (this as any).a; this.b = 5; this.a = 6 } }
const AgainClass = Again as unknown as new (removes: boolean) => Again
console.log(everyListing(new AgainClass(false)), JSON.stringify(new AgainClass(false)))
console.log(everyListing(new AgainClass(true)), JSON.stringify(new AgainClass(true)))

// Names that are array indexes come first, in ascending order. Symbols come last.
const tag = Symbol("tag")
interface Mixed { z: number; a: number; [index: number]: string; [tag]: boolean }
function Mixed(this: Mixed) { this.z = 1; this[2] = "two"; this[tag] = true; this.a = 2; this[0] = "zero"; (this as any)["1"] = "one"; (this as any)["01"] = "no index"; (this as any)[-1] = "no index either"; (this as any)[4294967295] = "too large" }
console.log(everyListing(new (Mixed as any)()))

// Stores that other functions make for the constructor, and stores by a computed name.
interface Helped { first: number; second: number; third: number; fourth: number }
function fillMiddle(target: Helped) { target.third = 3; target.second = 2 }
function fillLast(this: Helped) { this.fourth = 4 }
function Helped(this: Helped, name: "first" | "fourth") { this[name] = 0; fillMiddle(this); fillLast.call(this); this.first = 1 }
const HelpedClass = Helped as unknown as new (name: "first" | "fourth") => Helped
console.log(keys(new HelpedClass("first")), keys(new HelpedClass("fourth")))

// Definitions, which may hide a name from the listings, and Object.assign.
interface Defined { shown: number; hidden: number; copied: number; last: number }
function Defined(this: Defined) {
  Object.defineProperty(this, "hidden", { value: 1, enumerable: false, writable: true, configurable: true })
  this.shown = 2
  Object.assign(this, { copied: 3, shown: 4 })
  this.hidden = 5
  this.last = 6
}
const defined: Defined = new (Defined as any)()
console.log(everyListing(defined), defined.hidden, defined.shown)

// Loops, early returns and a handler.
interface Looped { [name: string]: number }
function Looped(this: Looped, names: string[], stopAt: number) {
  for (let index = 0; index < names.length; index++) { if (index === stopAt) return; this[names[index]] = index }
  try { if (stopAt < 0) throw new Error("caught"); this.tried = 1 } catch { this.caught = 1 } finally { this.finished = 1 }
}
const LoopedClass = Looped as unknown as new (names: string[], stopAt: number) => Looped
console.log(keys(new LoopedClass(["q", "p", "r"], 9)), keys(new LoopedClass(["q", "p", "r"], 2)), keys(new LoopedClass(["r", "q"], -1)), keys(new LoopedClass([], 0)))

// The same function under another new.target, below a class, and on an object that has keys already.
class Below extends (Node10 as any) { own = 1; constructor() { super(1, 2, 3) } }
function Other() {}
const given = { end: "mine", before: true }
Node10.call(given as any, 4, 5, 6)
console.log(keys(new Below()), "|", keys(Reflect.construct(Node10, [1, 2, 3], Other)), "|", keys(given))

// A prototype that has some of the names.
interface Shadowing { inherited: number; own: number; accessor: number }
function Shadowing(this: Shadowing) { this.own = 1; this.inherited = 2; this.accessor = 3 }
Shadowing.prototype.inherited = -1
Object.defineProperty(Shadowing.prototype, "accessor", { set() {}, get() { return -3 }, enumerable: true })
const shadowing: Shadowing = new (Shadowing as any)()
console.log(everyListing(shadowing), shadowing.inherited, shadowing.accessor)

let checksum = 0
for (let round = 0; round < 20000; round++) {
  const made = createNode(round & 255), options = new OptionsClass(round & 7)
  if (round % 5 === 0) made.symbol = options
  if (round % 3 === 0) made.locals = options
  const listed = Object.keys(made), chosen = Object.keys(options)
  checksum = (checksum * 31 + listed.length * 7 + listed[listed.length - 1].length + chosen[0].charCodeAt(0) + chosen.length) | 0
}
console.log(checksum)
