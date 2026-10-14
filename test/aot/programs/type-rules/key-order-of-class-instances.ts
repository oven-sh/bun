// The order of own keys of class instances with optional fields is the order of creation.
class Opt { a = 1; b?: number; c = 3 }
const o1 = new Opt()
const anyO1: any = o1
anyO1.extra = "x"; o1.b = 2; anyO1.more = "y"
console.log(JSON.stringify(o1))
delete o1.b; o1.b = 22; delete anyO1.extra
console.log(JSON.stringify(o1), o1.a + o1.b + o1.c, Object.keys(o1).join())
