// How the prototypes of generator functions and generator objects are reached.
const above = Object.getPrototypeOf
function keys(o: any): string { return o === null ? "null" : o === undefined ? "undefined" : o === Object.prototype ? "Object.prototype" : o === Function.prototype ? "Function.prototype" : "{" + Reflect.ownKeys(o).map(String).join() + "}" }
function chain(o: any): string { const out: string[] = []; for (let p = above(o); p !== null; p = above(p)) out.push(keys(p)); return out.join(" > ") }
function* generator() { yield 1 }
async function* asyncGenerator() { yield 1 }
async function asyncFunction() {}
console.log("generator()", chain(generator()))
console.log("generator", chain(generator), keys(generator))
console.log("generator.prototype", keys(generator.prototype), above(generator()) === generator.prototype)
console.log("asyncGenerator()", chain(asyncGenerator()))
console.log("asyncGenerator", chain(asyncGenerator), keys(asyncGenerator))
console.log("asyncGenerator.prototype", keys(asyncGenerator.prototype), above(asyncGenerator()) === asyncGenerator.prototype)
console.log("asyncFunction", chain(asyncFunction), keys(asyncFunction), keys((asyncFunction as any).prototype))
console.log("instanceof", generator() instanceof generator, asyncGenerator() instanceof asyncGenerator)
