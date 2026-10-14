// Object literals with `__proto__`, written plainly and as a computed key.
interface Base1 { inherited: string }
const base1: Base1 = { inherited: "yes" }
const computedProto = { own: 1, ["__proto__"]: base1 }
console.log(Object.keys(computedProto).join(), Object.getPrototypeOf(computedProto) === Object.prototype, (computedProto as any).inherited)
const __proto__ = base1
const shorthand = { own: 1, __proto__ }
console.log(Object.keys(shorthand).join(), Object.getPrototypeOf(shorthand) === Object.prototype, (shorthand as any).inherited)
const k: string = "__proto__"
const dynamic = { own: 1, [k]: base1 }
console.log(Object.keys(dynamic).join(), Object.getPrototypeOf(dynamic) === Object.prototype, (dynamic as any).inherited)
const method = { own: 1, __proto__() { return 1 } }
console.log(Object.keys(method).join(), Object.getPrototypeOf(method) === Object.prototype)
const quoted = { own: 1, "__proto__": base1 }
console.log(Object.keys(quoted).join(), Object.getPrototypeOf(quoted) === base1, (quoted as any).inherited)
const nul = { own: 1, __proto__: null }
console.log(Object.keys(nul).join(), Object.getPrototypeOf(nul) === null)
const num = { own: 1, __proto__: 5 }
console.log(Object.keys(num).join(), Object.getPrototypeOf(num) === Object.prototype)
class P { __proto__ = 1; x = 2 }
const p = new P()
console.log(Object.keys(p).join(), Object.getPrototypeOf(p) === P.prototype)
