// Symbol keys on typed objects, both declared in the type (unique and well-known symbols) and added through `any`.
const kId: unique symbol = Symbol("id")
const kOpt: unique symbol = Symbol("opt")
const stray = Symbol("stray")
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function own(o: object): string { return Reflect.ownKeys(o).map(k => typeof k === "symbol" ? "@" + k.description : k).join() }

// Fields whose names are symbols.
interface Tagged { [kId]: number; [kOpt]?: string; plain: number }
const t: Tagged = { plain: 1, [kId]: 2 }
console.log(t[kId], t[kOpt], t.plain, kId in t, kOpt in t, own(t), JSON.stringify(t), Object.keys(t).join())
t[kId] += 5; t[kOpt] = "set"; t.plain++
console.log(t[kId], t[kOpt], t.plain, own(t), Object.getOwnPropertySymbols(t).length)
delete t[kOpt]
console.log(t[kOpt], kOpt in t, own(t))
function readId(x: { [kId]: number }): number { return x[kId] * 2 }
class WithId { [kId] = 21; other = "o" }
console.log(readId(t), readId(new WithId()), readId({ [kId]: 0.5 }), own(new WithId()))

// A symbol by the same description is another key; a registered symbol is the same key everywhere.
const twin = Symbol("id")
const anyT: any = t
anyT[twin] = "twin"; anyT[Symbol.for("shared")] = "shared"; anyT[stray] = "stray"
console.log(t[kId], anyT[twin], anyT[Symbol.for("shared")], own(t), t.plain)
console.log(delete anyT[twin], own(t), anyT[twin], t[kId])

// Symbols do not show in strings-only listings, are copied by spread and assign, and are skipped by JSON.
const copied = { ...t }, assigned = Object.assign({}, t)
const forIn: string[] = []
for (const k in t) forIn.push(k)
console.log(own(copied), own(assigned), copied[kId], forIn.join(), Object.entries(t).length, JSON.stringify(t), Object.getOwnPropertyNames(t).join())

// Symbol.toPrimitive, Symbol.toStringTag, Symbol.iterator, Symbol.hasInstance declared by the type.
interface Money { amount: number; [Symbol.toPrimitive](hint: string): number | string }
const money: Money = { amount: 5, [Symbol.toPrimitive](hint) { return hint === "number" ? this.amount : hint + ":" + this.amount } }
console.log(+money, `${money}`, (money as any) + "", (money as any) * 2, (money as any) > 4, money.amount)
class Temp { constructor(public deg: number) {} [Symbol.toPrimitive](hint: string) { return hint === "string" ? this.deg + "C" : this.deg } get [Symbol.toStringTag]() { return "Temp" } }
const temp = new Temp(20)
console.log(`${temp}`, +temp + 1, Object.prototype.toString.call(temp), String(temp), temp.deg, own(temp))
interface Bag extends Iterable<number> { items: number[] }
const bag: Bag = { items: [1, 2, 3], *[Symbol.iterator]() { for (const i of this.items) yield i * 10 } }
const [b0, ...bRest] = bag
console.log([...bag].join(), b0, bRest.join(), Math.max(...bag), Array.from(bag).length, new Set(bag).size)
class Even { static [Symbol.hasInstance](x: unknown) { return typeof x === "number" && x % 2 === 0 } }
console.log((2 as unknown) instanceof Even, (3 as unknown) instanceof Even, ({} as unknown) instanceof Even)

// The well-known symbol is added later, through `any`.
interface Plain { v: number }
const plain: Plain = { v: 3 }
console.log(attempt(() => [...(plain as any)]), String(plain), attempt(() => +(plain as any)))
;(plain as any)[Symbol.iterator] = function* (this: Plain) { yield this.v; yield this.v + 1 }
;(plain as any)[Symbol.toPrimitive] = () => 42
;(plain as any)[Symbol.toStringTag] = "Plain!"
console.log([...(plain as any)].join(), `${plain as any}`, +(plain as any), Object.prototype.toString.call(plain), plain.v, Object.keys(plain).join(), JSON.stringify(plain))

// Symbols on frozen and sealed typed objects, and as accessors.
const sealed: Tagged = Object.seal({ plain: 1, [kId]: 1 })
console.log(attempt(() => { sealed[kOpt] = "no" }), attempt(() => { sealed[kId] = 9 }), sealed[kId], attempt(() => { (sealed as any)[stray] = 1 }), own(sealed))
let hits = 0
const watched: Tagged = { plain: 0, [kId]: 0 }
Object.defineProperty(watched, kId, { get() { hits++; return 100 + hits }, set(v: number) { hits += v }, enumerable: false, configurable: true })
watched[kId] = 10
console.log(watched[kId], watched[kId], hits, own({ ...watched }), readId(watched))

// Symbols as keys of dictionaries and in Maps beside typed objects.
const dict: Record<symbol, number> = { [kId]: 1 }
dict[stray] = 2
console.log(dict[kId], dict[stray], dict[twin], own(dict), new Map<symbol, Tagged>([[kId, t]]).get(kId) === t, kId.description, stray.toString())
