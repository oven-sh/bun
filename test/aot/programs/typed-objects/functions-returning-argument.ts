// A function all of whose `return` statements return the same parameter: the result of the call is the argument itself; followed by functions that only look like that.
interface Range { pos: number; end: number }
interface Leaf extends Range { kind: 1; text: string }
interface Pair extends Range { kind: 2; left: Leaf; right: Leaf }
function setEnds<T extends Range>(range: T, pos: number, end: number): T { range.pos = pos; range.end = end; return range }
function setRange<T extends Range>(range: T, from: Range | undefined): T { return from ? setEnds(range, from.pos, from.end) : range }
function second<A, B extends Range>(a: A, b: B): B { if (a) return b; return (count++, b) }
let count = 0
function defined<T>(value: T | undefined, what: string): T { if (value === undefined) return fail(what); return value }
function fail(what: string): never { throw new RangeError(what) }
const arrow = <T extends Range>(range: T): T => setRange(range, undefined)
const leaf = (text: string): Leaf => ({ pos: -1, end: -1, kind: 1, text })
const plain: Range = { pos: 3, end: 9 }
const a = setRange(leaf("a"), plain), b = arrow(leaf("b")), p: Pair = setRange({ pos: 0, end: 0, kind: 2, left: a, right: b }, a)
console.log(a.text, a.pos, a.end, b.text, b.pos, p.left.text + p.right.text, p.pos, p.end, setRange(plain, a) === plain, second(1, a) === a, second(0, p).right.text, defined(a, "a").text)
try { defined<Leaf>(undefined, "nothing").text } catch (e) { console.log((e as Error).message) }
interface Kind { flags: number; name: string }
function kindOf(node: Leaf): Kind { return { flags: node.kind, name: "k" + node.text } }
function truthy(kind: Kind, node: Leaf) { if (kind.flags & 2) console.log(node.text); return kind }
function kindChecked(node: Leaf) { return truthy(kindOf(node), node) }
console.log(kindChecked(a).name, kindChecked(b).flags, setRange(setRange(leaf("n"), plain), a).text, setRange(setRange(leaf("m"), plain), undefined).end, second(kindOf(a), setRange(b, undefined)).text, second(a, truthy(kindOf(b), a) && p).left.text)
// Not these.
function other<T extends Range>(range: T, swap: boolean, instead: T): T { return swap ? instead : range }
function stored<T extends Range>(range: T, instead: T): T { if (range.pos < 0) range = instead; return range }
function withDefault(range: Range = { pos: 7, end: 7 }): Range { return range }
function sometimes<T extends Range>(range: T): T | undefined { if (range.pos > 0) return range }
function copied(range: Leaf): Leaf { return { ...range } }
function rest<T extends Range>(...all: T[]): T[] { return all }
async function later<T extends Range>(range: T): Promise<T> { return range }
function* each<T extends Range>(range: T): Generator<number, T> { yield range.pos; return range }
function outer<T extends Range>(range: T): () => T { return () => range }
let replaced = (range: Leaf): Leaf => range
const before = replaced(a)
replaced = (range: Leaf): Leaf => ({ ...range, pos: 100 })
const spread: [Leaf, Range] = [b, plain]
console.log(other(a, true, b).text, other(a, false, b).text, stored(b, a).text, stored(a, b).text, withDefault().pos, withDefault(plain) === plain, sometimes(b), sometimes(a) === a, copied(a) === a, copied(a).text)
console.log(rest(a, b).length, each(a).next().value, outer(p)().left.text, before === a, replaced(a) === a, replaced(a).pos, setRange(...spread) === b, b.pos)
later(a).then(it => console.log(it === a, it.text))
