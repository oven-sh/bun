// Classes that extend a constructor function: `super(..)` hands the function an object of the class, new.target is the class, the stores of the function go by what the class defines, and the fields of the class follow them.
const show = (o: object): string => Object.keys(o).join() + " " + JSON.stringify(o)
const attempt = (label: string, run: () => unknown) => { try { console.log(label, String(run())) } catch (error) { console.log(label, "throws", (error as Error).constructor.name) } }

interface Base { id: number; name: string }
interface Labeled extends Base { label(): string }
interface BaseConstructor { new (id: number, name: string): Labeled; prototype: any }
function Base(this: Base, id: number, name: string) { this.id = id; this.name = name }
Base.prototype.label = function (this: Base) { return this.name + "#" + this.id }
const BaseClass = Base as unknown as BaseConstructor
const idOf = (base: Base) => base.id * 2 + base.name.length

class Derived extends BaseClass { extra = "e"; constructor(id: number) { super(id, "derived") } label() { return "<" + super.label() + this.extra + ">" } }
class Implicit extends BaseClass { tail = 1 }
class Deeper extends Derived { depth: number; constructor() { super(3); this.depth = 2 } }
class Empty extends BaseClass {}

const plain = new BaseClass(1, "plain"), derived = new Derived(2), implicit = new Implicit(4, "implicit"), deeper = new Deeper(), empty = new Empty(5, "empty")
for (const each of [plain, derived, implicit, deeper, empty])
  console.log(show(each), each.label(), idOf(each), each instanceof BaseClass, each instanceof Derived, each.constructor.name, Object.getPrototypeOf(Object.getPrototypeOf(each)) === Base.prototype)
console.log(Object.getPrototypeOf(Derived) === Base, Object.getPrototypeOf(Derived.prototype) === Base.prototype, Derived.length, Implicit.length, Derived.name)

interface Seen { target: string; isOwn: boolean }
function Seen(this: Seen) { this.target = new.target === undefined ? "none" : (new.target as any).name; this.isOwn = (new.target as any) === Seen }
class SeesItself extends (Seen as any) {}
class SeesDeeper extends SeesItself { constructor() { super() } }
console.log(show(new (Seen as any)()), show(new SeesItself()), show(new SeesDeeper()), show(Reflect.construct(SeesItself, [], Seen)), show(Reflect.construct(Seen, [], SeesDeeper)))

const stores: string[] = []
class Guarded extends (Base as any) {
  set name(value: string) { stores.push("name is set to " + value) }
  get name() { return "guarded" }
  get id() { return stores.length }
  set id(value: number) { stores.push("id is set to " + value) }
}
const guarded = new (Guarded as any)(6, "hidden")
console.log(show(guarded), guarded.label(), stores.join(), idOf(guarded))
class ReadOnly extends (Base as any) { get name() { return "no setter" } }
attempt("a getter alone:", () => new (ReadOnly as any)(7, "x"))
class Redeclares extends (Base as any) { id = "mine"; name = "also mine" }
console.log(show(new (Redeclares as any)(8, "theirs")), idOf(new BaseClass(8, "theirs")))
class FieldsReadBase extends (Base as any) { copy = this.id + ":" + this.name; count = Object.keys(this).length }
console.log(show(new (FieldsReadBase as any)(9, "read")))

function Swaps(this: any, value: number) { this.lost = value; return { swapped: value } }
function ReturnsNumber(this: any, value: number) { this.kept = value; return value }
function ReturnsFunction(this: any) { this.lost = true; return function made() {} }
class OverSwaps extends (Swaps as any) { own = 1; method() { return "unreachable" } }
class OverNumber extends (ReturnsNumber as any) { own = 2 }
class OverFunction extends (ReturnsFunction as any) { own = 3 }
const swapped = new (OverSwaps as any)(10), numbered = new (OverNumber as any)(11), made: any = new OverFunction()
console.log(show(swapped), swapped instanceof OverSwaps, "method" in swapped, show(numbered), numbered instanceof OverNumber, typeof made, Object.keys(made).join(), made.name, made instanceof OverFunction)

class BeforeSuper extends BaseClass {
  constructor(early: boolean) {
    if (early) attempt("this before super:", () => this)
    super(12, "late")
    try { super(13, "again"); console.log("super twice") } catch (error) { console.log("super twice throws", (error as Error).constructor.name) }
  }
}
console.log(show(new BeforeSuper(true)))
class NoSuper extends BaseClass { constructor() { if (stores.length < 0) super(0, "") } }
attempt("no super call:", () => new NoSuper())
class ThrowsInArgument extends BaseClass { after = "never"; constructor() { super(14, (() => { throw new RangeError("argument") })()) } }
attempt("an argument of super throws:", () => new ThrowsInArgument())
attempt("a class is called:", () => (Derived as any)(1))
attempt("the function is called with an instance of the class:", () => { const target = new Derived(15); return String(Base.call(target, 16, "again")) + " " + show(target) + " " + target.label() })

function Replacement(this: any, id: number) { this.replaced = id }
Replacement.prototype.label = function () { return "replacement" }
class Moves extends BaseClass { constructor() { super(17, "moves") } }
const unmoved = new Moves()
Object.setPrototypeOf(Moves, Replacement)
const moved = new Moves()
console.log(show(unmoved), show(moved), moved.label(), moved instanceof BaseClass, moved instanceof (Replacement as any))
Object.setPrototypeOf(Moves, null)
attempt("nothing above the class:", () => new Moves())
Object.setPrototypeOf(Moves, Base)
console.log(show(new Moves()))

;(Base as any).create = function (this: any, id: number) { return new this(id, "created") }
console.log(show((Base as any).create(18)), show((Implicit as any).create(19)), show((Derived as any).create(20)), Object.hasOwn(Derived, "create"))

const firstPrototype = (Base as Function).prototype
Base.prototype = { label() { return "a later prototype" } }
const afterwards = new Derived(21), direct = new BaseClass(22, "direct")
console.log(afterwards.label(), afterwards instanceof BaseClass, afterwards instanceof Derived, direct.label(), direct instanceof BaseClass, derived instanceof BaseClass)
class DefinedLater extends BaseClass {}
console.log(new DefinedLater(23, "later").label(), Object.getPrototypeOf(DefinedLater.prototype) === Base.prototype)
Base.prototype = null
attempt("extends a function whose prototype is null:", () => { class OverNull extends BaseClass {} return Object.getPrototypeOf(OverNull.prototype) + " " + show(new OverNull(24, "null")) })
Base.prototype = 5
attempt("extends a function whose prototype is a number:", () => { class OverNumberPrototype extends BaseClass {} return new OverNumberPrototype(25, "five") })
Base.prototype = firstPrototype

let total = 0
for (let round = 0; round < 15000; round++) {
  const each: Labeled = round % 3 === 0 ? new BaseClass(round, "b") : round % 3 === 1 ? new Derived(round) : new Implicit(round, "imp")
  total += idOf(each) + Object.keys(each).length + each.label().length
}
console.log(total)
