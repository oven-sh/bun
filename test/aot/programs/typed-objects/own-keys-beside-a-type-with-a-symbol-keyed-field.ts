// One type with a symbol-keyed field in the program costs the other types nothing: Reflect.ownKeys and Object.getOwnPropertySymbols on their objects do not enter the runtime. Objects of the type that has the field list it, after the strings.
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0)
const kTag = Symbol("tag")
interface Tagged { n: number; [kTag]: string }
interface Plain { a: number; b: string }
function sizeOf(plain: Plain) { return Reflect.ownKeys(plain).length * 10 + Object.getOwnPropertySymbols(plain).length }
function sizeOfAny(value: any) { return Reflect.ownKeys(value).length * 10 + Object.getOwnPropertySymbols(value).length }
function listOf(tagged: Tagged) { return Reflect.ownKeys(tagged).map(String).join() + " | " + Object.getOwnPropertySymbols(tagged).map(String).join() + " | " + Object.keys(tagged).join() }
let total = 0
for (let i = 0; i < 100; i++) total += sizeOf({ a: i, b: "x" }) + sizeOfAny({ a: i, b: "y" } as Plain)
const before = count("operationAOTOwnPropertyKeys")
for (let i = 0; i < 20000; i++) total += sizeOf({ a: i, b: "x" }) + sizeOfAny({ a: i, b: "y" } as Plain)
console.log(total, count("operationAOTOwnPropertyKeys") - before < 100)
const tagged: Tagged = { n: 1, [kTag]: "t" }
console.log(listOf(tagged), sizeOfAny(tagged), tagged[kTag])
const other = Symbol("other")
const extended: any = { a: 1, b: "z" } as Plain
extended[other] = 2
extended[Symbol.iterator] = undefined
console.log(sizeOfAny(extended), Reflect.ownKeys(extended).map(String).join(), extended[other], other in extended, kTag in extended, Symbol.toPrimitive in extended)
const marked: any = tagged
marked[other] = 3
console.log(listOf(tagged), marked[other], delete marked[other], listOf(tagged))
console.log(JSON.stringify({ ...tagged }), Object.getOwnPropertySymbols({ ...tagged }).length, Object.getOwnPropertySymbols(Object.assign({}, tagged)).length, Object.getOwnPropertySymbols({ ...(extended as Plain) }).length)
