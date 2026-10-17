// The first stores of a constructor function count as initialization even when objects created by untyped code can have the same type as `this`.
const show = (what: string, o: object) => console.log(what, JSON.stringify(Object.keys(o)), JSON.stringify(o), "pos" in o, "value" in o)
enum Kind { Unknown, Leaf, File }
interface Base { kind: Kind; pos: number; end: number; flags: number }
interface Leaf extends Base { kind: Kind.Leaf; value: string }
function BaseCtor(this: Base, kind: Kind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 0 }
const allocator = { getBase: () => BaseCtor as any }
let BaseConstructor: new (kind: Kind, pos: number, end: number) => Base
function start() { BaseConstructor = allocator.getBase() }
start()
function forge<T extends object>(seed: number): T { const d: Record<string, unknown> = { flags: seed, extra: "x", end: 1, kind: 0, pos: 0.5 }; return d as T }
function makeLeaf(value: string, pos: number): Leaf { const leaf = new BaseConstructor(Kind.Leaf, pos, pos + value.length) as Leaf; leaf.value = value; return leaf }
const width = (node: Base) => node.end - node.pos + node.flags + node.kind * 100
const makeBase = (kind: Kind, pos: number, end: number) => new BaseConstructor(kind, pos, end)
const plain = makeBase(Kind.File, 1.5, 4), leaf = makeLeaf("let", 2)
show("fresh:", plain); show("leaf:", leaf)
console.log(width(plain), width(leaf))
const stranger: Base = forge<Base>(7)
show("a stranger before:", stranger)
const call: any = BaseCtor
call.call(stranger, Kind.Leaf, 10, 20.5)
show("a stranger after:", stranger)
console.log(width(stranger), stranger.pos, stranger.flags)
call.call(leaf, Kind.Leaf, 30, 40)
show("one of ours again:", leaf)
console.log(width(leaf), leaf.value)
const nodes: Base[] = [plain, leaf, stranger]
console.log(nodes.map(width).join(), nodes.map(n => n.pos).join())
