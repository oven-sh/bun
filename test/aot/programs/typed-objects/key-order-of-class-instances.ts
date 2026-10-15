// The key order of class instances: initializers, parameter properties, stores in constructors, base class before subclass, and fields added late.
function keys(o: object): string { return Object.keys(o).join() }
function show(o: object): string { return keys(o) + " " + JSON.stringify(o) }

class Plain { c = 3; a = 1; b = 2 }
console.log(show(new Plain()))

// The constructor stores in an order that is not the declared one.
class Stored {
  first: number; second: string; third: boolean
  constructor(n: number) { this.third = n > 0; this.first = n; this.second = "s" + n }
}
console.log(show(new Stored(1)))

// Initializers run before the body of the constructor; parameter properties before initializers.
class Params {
  own = "own"
  constructor(public x: number, readonly y: string, private z = 5) { this.late = x + z }
  late: number
  sum() { return this.x + this.z + this.late }
}
console.log(show(new Params(1, "y")), new Params(2, "y", 1).sum())

// Base fields come first, then the derived ones, also when the base constructor stores late.
class Base0 { b1 = 1; b2: number; constructor() { this.b2 = 2 } }
class Mid0 extends Base0 { m1 = "m"; constructor() { super(); this.b1 = 10 } }
class Leaf0 extends Mid0 { l1 = true; b2 = 20; l2: number; constructor() { super(); this.l2 = 5; this.m1 = "changed" } }
console.log(show(new Base0()), show(new Mid0()), show(new Leaf0()))

// Branches in the constructor: the same class, several orders.
class Branchy {
  p?: number; q?: string; r = 0
  constructor(mode: number) {
    if (mode === 1) { this.q = "q"; this.p = 1 } else if (mode === 2) { this.p = 2 } else if (mode === 3) { this.p = 3; this.q = "q3" }
  }
}
const modes: string[] = []
for (let m = 0; m < 4; m++) modes.push(JSON.stringify(new Branchy(m)))
console.log(modes.join(" "))
const lateBranch = new Branchy(2)
lateBranch.q = "late"
console.log(JSON.stringify(lateBranch), lateBranch.p, lateBranch.q, lateBranch.r)

// A helper called by the constructor stores fields; so does a method of the derived class called by the base constructor.
class Helped {
  a = 1; viaHelper?: number; z?: number
  constructor() { fill(this); this.z = 26 }
}
function fill(h: Helped) { h.viaHelper = 7 }
console.log(JSON.stringify(new Helped()))
class Hooked { start = "s"; constructor() { this.hook() } hook() {} }
class Hooking extends Hooked { extra?: string; own = "o"; hook() { this.extra = "from hook" } }
console.log(JSON.stringify(new Hooking()), new Hooking().extra, new Hooking().own)

// Extra properties, deletes and late fields on instances. A field that is created again while there are extra properties: see type-rules/key-order-of-class-instances.
class Opt { a = 1; b?: number; c = 3 }
const o1 = new Opt()
const anyO1: any = o1
anyO1.extra = "x"; o1.b = 2; anyO1.more = "y"
console.log(JSON.stringify(o1))
delete anyO1.extra; delete anyO1.more; delete o1.b; o1.b = 22; anyO1.more = "y"
console.log(JSON.stringify(o1), o1.a + o1.b + o1.c)

// Accessors, methods, statics and private names are not keys.
class Rich {
  static count = 0
  #hidden = 1
  shown = 2
  get twice() { return this.shown * 2 }
  set twice(v: number) { this.shown = v / 2 }
  method() { return this.#hidden }
}
const rich = new Rich()
rich.twice = 10
console.log(show(rich), rich.twice, rich.method(), Object.getOwnPropertyNames(rich).join(), Object.getOwnPropertyNames(Rich.prototype).join())

// Instances beside literals of the same interface: each keeps its own order, one site reads both.
interface HasAB { a: number; b?: number }
const list: HasAB[] = [new Opt(), { b: 1, a: 2 }, o1, { a: 3 }, new Plain()]
console.log(list.map(x => Object.keys(x).join("") + ":" + (x.a + (x.b ?? 0))).join())

// Copies of instances are plain objects in the same order.
console.log(show({ ...new Leaf0() }), show(Object.assign({}, new Params(1, "y"))), Object.entries(new Stored(0)).map(e => e.join("=")).join("&"))
