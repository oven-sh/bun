// `new` calls another constructor function at run time than the source suggests, one that does not initialize a required field. Any object passes the type `Item`, so the program goes on as in plain Bun.
enum Kind { Unknown, One, Two }
interface Item { o: number[]; kind: Kind; pos: number; end: number }
interface Span { o: number[]; pos: number; end: number }
const list = [1]
function ItemCtor(this: Item, o: number[], kind: Kind, pos: number, end: number) { this.o = o; this.pos = pos; this.end = end; this.kind = kind }
function SpanCtor(this: Span, o: number[], kind: Kind, pos: number, end: number) { this.o = o; this.pos = pos; this.end = end }
// One that stores all of it, in another order.
function OtherCtor(this: Item, o: number[], kind: Kind, pos: number, end: number) { this.kind = kind; this.o = o; this.end = end; this.pos = pos }
const allocator = { get: () => ItemCtor as any }
let ItemConstructor: new (o: number[], kind: Kind, pos: number, end: number) => Item
const start = () => { ItemConstructor = allocator.get() }
const make = (kind: Kind, pos: number, end: number) => new ItemConstructor(list, kind, pos, end)
const length = (span: Span) => span.end - span.pos + span.o.length
const attempt = () => {
    try { const item = make(Kind.Two, 1, 4); console.log("made", JSON.stringify(Object.keys(item).filter(key => key !== "o"))); console.log(length(item)) }
    catch (e) { console.log("refused", (e as Error).constructor.name) }
}
start(); attempt()
const replace = (holder: any, name: string, f: unknown) => { holder[name] = () => f }
replace(allocator, "get", SpanCtor); start(); attempt()
replace(allocator, "get", OtherCtor); start(); attempt()
replace(allocator, "get", ItemCtor); start(); attempt()
console.log(length(new (SpanCtor as any)(list, Kind.One, 2, 9)))
