// Fields that a method called from the base constructor assigns before their own initializers run.
class B { s = "s"; constructor() { console.log(JSON.stringify(this)); this.hook() } hook() {} }
class D extends B { x = 1; y?: number; z: string | undefined; hook() { this.y = 5; this.z = "hook"; console.log(this.y, this.z, JSON.stringify(this)) } }
const d = new D()
console.log(Object.keys(d).sort().join(), JSON.stringify(d), d.y, d.z)
class E { a = this.init(); b?: number; c = 2; init() { this.b = 7; this.c = 9; return 1 } }
const e = new E()
console.log(Object.keys(e).sort().join(), e.a, e.b, e.c)
// A field read before its initializer has run (a hook called by the base constructor) is undefined, whatever it is declared to hold.
class Base { constructor() { this.hook() } hook() {} }
class Early extends Base { n = 1; done = false; name = "name"
  hook() { console.log(this.n, this.done ? "done" : "not done", this.done, this.name, typeof this.n, this.n === undefined) }
}
const early = new Early()
console.log(early.n, early.done, early.name)
