// An instance has room for all its declared fields from the start, including those of the subclass. What the program sees is as in plain JavaScript: its keys are those of the fields that are defined or stored to so far, in that order, and it has no other property.
class B { s = "s"; constructor() { console.log(Object.keys(this).join(), "x" in this, JSON.stringify(this)); this.hook() } hook() {} }
class D extends B { x = 1; y?: number; z: string | undefined; hook() { this.y = 5; this.z = "hook"; console.log(Object.keys(this).join()) } }
const d = new D()
console.log(Object.keys(d).join(), JSON.stringify(d), d.y, d.z)
class E { a = this.init(); b?: number; c = 2; init() { this.b = 7; this.c = 9; return 1 } }
const e = new E()
console.log(Object.keys(e).join(), JSON.stringify(e), e.b)
