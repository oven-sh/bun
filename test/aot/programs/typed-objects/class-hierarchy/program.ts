const trace: string[] = []
const registry: Root[] = []
function mark<T>(what: string, v: T): T { trace.push(what); return v }
class Root {
  id = mark("Root.id", 1)
  title: string = mark("Root.title", "root")
  early: string
  constructor(extra: number) {
    trace.push("Root.ctor")
    registry.push(this)
    this.early = this.describe()
    this.id += extra
  }
  describe(): string { return "Root#" + this.id }
  get doubled(): number { return this.id * 2 }
  who(): string { return (this.constructor as Function).name }
  static make(): Root { return new this(1) }
}
class Middle extends Root {
  weight = mark("Middle.weight", 2.5)
  override title = mark("Middle.title", "middle")
  constructor(extra: number) {
    trace.push("Middle.before")
    super(extra + 1)
    trace.push("Middle.after")
    this.weight += this.id
  }
  override describe(): string { return "Middle#" + this.id + "/" + this.weight + "/" + super.describe() }
}
class Leaf extends Middle {
  flag = mark("Leaf.flag", true)
  child: Leaf | null = null
  count: number
  constructor(extra: number) { super(extra); this.count = registry.length }
  override get doubled(): number { return super.doubled + 1 }
  override describe(): string { return "Leaf(" + this.flag + "," + String(this.child) + "," + this.count + ")" + super.describe() }
}
class Tail extends Middle { total = this.id + this.weight; override who(): string { return "tail of " + super.who() } }
const leaf = new Leaf(10)
console.log(trace.splice(0).join(" "))
console.log(leaf.early)
console.log(leaf.describe(), leaf.id, leaf.title, leaf.weight, leaf.doubled, leaf.who(), Object.keys(leaf).join())
function summary(r: Root): string {
  return [r.describe(), r.early, r.title, r.doubled, r.id, r instanceof Middle ? r.weight : "-", r instanceof Leaf ? r.flag : "-", r.who()].join("|")
}
const mixed: Root[] = [new Root(0), new Middle(0), new Leaf(0), Root.make(), Middle.make(), Leaf.make(), new Tail(3)]
console.log(trace.splice(0).length)
for (const r of mixed) console.log(summary(r))
console.log(registry.length, registry.map(r => Object.keys(r).length).join(), registry[0] === leaf, (mixed[6] as Tail).total)
leaf.child = mixed[2] as Leaf
leaf.child.child = leaf
console.log(leaf.child.child.child === leaf.child, leaf.child.count, leaf.describe().length)
// An abstract base whose method drives the methods of the classes below it.
abstract class Step {
  next: Step | undefined
  abstract run(x: number): number
  chain(x: number): number { const y = this.run(x); return this.next ? this.next.chain(y) : y }
  link(next: Step): Step { let last: Step = this; while (last.next) last = last.next; last.next = next; return this }
}
class Add extends Step { constructor(public n: number) { super() } run(x: number) { return x + this.n } }
class Mul extends Step { constructor(public n: number) { super() } run(x: number) { return x * this.n } }
class Neg extends Step { run(x: number) { return -x } }
const steps = new Add(1).link(new Mul(2.5)).link(new Neg()).link(new Add(-0.5)).link(new Mul(0))
console.log(steps.chain(1), steps.chain(-1), Object.is(steps.chain(-1.2), -0), new Neg().chain(0), Object.keys(steps).join(), Object.keys(new Neg()).join())
// An optional method: declared above, defined below, or stored on one object.
class Hooked { hook?(): string; run(): string { return this.hook ? this.hook() : "no hook" } }
class WithHook extends Hooked { override hook() { return "hooked by " + this.run.name } }
const own = new Hooked()
console.log(own.run(), new WithHook().run(), "hook" in own, "hook" in new WithHook())
own.hook = () => "own hook"
const shadowing = new WithHook()
shadowing.hook = function (this: Hooked) { return "shadow " + Object.keys(this).join() }
console.log(own.run(), shadowing.run(), new WithHook().run(), Object.keys(own).join())
delete own.hook
delete (shadowing as Hooked).hook
console.log(own.run(), shadowing.run())
