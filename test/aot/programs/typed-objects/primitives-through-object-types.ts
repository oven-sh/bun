// Values that are not plain objects are used through object types without any cast: strings, numbers, booleans, BigInts, symbols, arrays, functions, typed arrays.
function nameOf(e: unknown): string { return (e as Error).constructor.name }
interface HasLength { length: number }
class Lengthy { length = 9 }
function len(x: HasLength): number { return x.length }
const lengths: HasLength[] = ["abc", [1, 2], { length: 5 }, function (p: number, q: number) { return p + q }, new Uint8Array(4), new String("boxed"), "", { length: -0 }, new Lengthy(), "\u00e9\u20ac\ud83d\ude00", new Array<number>(7)]
console.log(lengths.map(len).map(n => Object.is(n, -0) ? "-0" : String(n)).join(), lengths.map(x => typeof x).join())

interface Fixable { toFixed(digits?: number): string }
const fixables: Fixable[] = [5, 2.345, -0, NaN, new Number(7), { toFixed: d => "custom" + d }, 1e21, 0.5]
console.log(fixables.map(f => f.toFixed(1)).join(), fixables.map(f => f.toFixed()).join())

interface Stringy { toString(): string }
const stringies: Stringy[] = [1, "s", true, 10n ** 30n, -(10n ** 30n), 5n, 0n, Symbol("sym"), [1, [2, 3]], {}, { toString: () => "mine" }, -0, 1e21, /re/g]
console.log(stringies.map(s => s.toString()).join("|"), stringies.map(s => typeof s).join())

interface Valued { valueOf(): unknown }
const valueds: Valued[] = [1.5, "v", false, 7n, new Boolean(false), { valueOf: () => 42 }, [3]]
console.log(valueds.map(v => String(v.valueOf())).join("|"), valueds.map(v => typeof v.valueOf()).join())

interface Described { description: string | undefined }
const describeds: Described[] = [Symbol("d"), Symbol(), { description: "lit" }, Symbol.iterator, { description: undefined }]
console.log(describeds.map(d => String(d.description)).join("|"))

interface Upper { toUpperCase(): string; charCodeAt(index: number): number }
const uppers: Upper[] = ["abc", new String("def"), { toUpperCase: () => "FAKE", charCodeAt: i => i * 2 }, "a" + "b".repeat(3)]
console.log(uppers.map(u => u.toUpperCase() + u.charCodeAt(1)).join())

interface Built { constructor: Function }
const builts: Built[] = [1, "s", true, 1n, Symbol(), [], {}, () => 0, new Lengthy(), /x/, new Map()]
console.log(builts.map(b => b.constructor.name).join())

// An optional field next to one that the primitive has: it reads as undefined; `in` and a store are errors of the language on a primitive.
interface MaybeExtra { length: number; extra?: string }
const extras: MaybeExtra[] = ["abc", [1], { length: 1 }, { length: 2, extra: "e" }, new String("w"), new Lengthy()]
console.log(extras.map(m => m.length + ":" + m.extra).join())
for (const m of extras) {
  let line: string = typeof m
  try { line += " in:" + ("extra" in m) } catch (e) { line += " in:" + nameOf(e) }
  try { m.extra = "set"; line += " stored:" + m.extra } catch (e) { line += " store:" + nameOf(e) }
  try { line += " deleted:" + delete m.extra + ":" + m.extra } catch (e) { line += " delete:" + nameOf(e) }
  console.log(line, Object.keys(m).join())
}

// A store to the field itself.
for (const x of lengths) {
  try { x.length = 1; console.log(typeof x, "stored", x.length) } catch (e) { console.log(typeof x, nameOf(e), x.length) }
}

// The empty object type, `Object` and `object` take almost anything and promise nothing.
const anything: {}[] = [1, "s", true, {}, [], () => 1, 2n, Symbol.for("x")]
const objectsOnly: object[] = [{}, [], () => 1, new Lengthy(), new Number(1), /r/]
const capital: Object[] = [1, "s", {}, false]
console.log(anything.map(x => typeof x).join(), objectsOnly.map(x => typeof x).join(), capital.map(x => x.hasOwnProperty("length")).join())

// A field, a parameter, a result and an array element of such a type, holding a primitive.
const holder: { item: HasLength; other?: Stringy } = { item: "four" }
function longest(x: HasLength, y: HasLength): HasLength { return x.length >= y.length ? x : y }
console.log(holder.item.length, len(holder.item), JSON.stringify(holder), longest("ab", [1, 2, 3]).length, longest("abcd", { length: 1 }) === "abcd", typeof longest(holder.item, []))
holder.item = [1]
holder.other = 12
console.log(holder.item.length, holder.other.toString(), JSON.stringify(holder))
holder.item = { length: 0.5 }
holder.other = 3n
console.log(holder.item.length, holder.other.toString(), typeof holder.other)

let total = 0
for (let i = 0; i < 4000; i++) total += len(lengths[i % lengths.length]) + fixables[i % fixables.length].toFixed(0).length + stringies[i % stringies.length].toString().length
console.log(total)
