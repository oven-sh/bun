// The order of own keys when optional fields are added late, through other types, deleted and added again.
interface Wide { id: number; p?: number; q?: string; r?: boolean; s?: Wide }
interface Narrow { id: number }
interface Other { id: number; q?: string; z?: number }
function keys(o: object): string { return Object.keys(o).join("") }
function show(o: object): string { return keys(o) + " " + JSON.stringify(o) }

// Late stores in an order that is not the declared one.
const late: Wide = { id: 1 }
late.r = true; late.p = 2; late.q = "q"
console.log(show(late))
const partly: Wide = { q: "first", id: 2 }
partly.p = 1; partly.s = { id: 3 }; partly.r = false
console.log(show(partly))

// A store to a field that is already there does not move it, not even a store of undefined.
late.r = false; late.id = 9; late.p = undefined
console.log(show(late), "p" in late, late.p)

// The object was made as a type that lacks the field; the field arrives through a wider view.
const small = { id: 4 }
const asNarrow: Narrow = small
const asWide: Wide = small
const asOther: Other = small
asWide.q = "via wide"; asOther.z = 5; asWide.p = 6
console.log(show(small), show(asNarrow), asOther.q, asWide.q, keys(asOther), small === asWide)

// Late fields, extra properties.
const loose: any = { id: 5 } as Wide
const typed: Wide = loose
typed.q = "q"; typed.p = 3; typed.r = true; loose.x1 = 1; loose.x2 = 2; loose.x3 = 3
console.log(show(typed))
delete loose.x2; loose.x2 = "back"
console.log(show(typed), typed.q, typed.p)

// Delete and create again moves a key to the end, each time.
const cycle: Wide = { id: 6, p: 1, q: "q", r: true }
const seen: string[] = []
for (let i = 0; i < 4; i++) {
  if (i % 2 === 0) { delete cycle.p; seen.push(keys(cycle)); cycle.p = i } else { delete cycle.q; delete cycle.r; seen.push(keys(cycle)); cycle.r = false; cycle.q = "q" + i }
  seen.push(keys(cycle))
}
console.log(seen.join(), JSON.stringify(cycle))

// Deleting an absent property changes nothing; `in` agrees.
const bare: Wide = { id: 7 }
console.log(delete bare.p, delete bare.q, keys(bare), "p" in bare, bare.p, bare.q ?? "none")

// The same function makes objects whose late fields come in different orders, and one site reads them all.
function grow(n: number): Wide {
  const o: Wide = { id: n }
  if (n & 1) o.p = n
  if (n & 2) o.q = "s" + n
  if (n & 4) o.r = n > 5
  if (n & 1) o.s = { id: -n }
  if (!(n & 2)) o.q = "late"
  return o
}
const grown: string[] = []
let sum = 0
for (let n = 0; n < 8; n++) { const o = grow(n); grown.push(keys(o)); sum += o.id + (o.p ?? 100) + (o.q ? o.q.length : 0) + (o.r ? 1000 : 0) + (o.s ? o.s.id : 0) }
console.log(grown.join(), sum)

// Late fields by every kind of store.
const ways: Wide = { id: 8 }
ways.p ??= 1
ways.q ||= "or"
Object.assign(ways, { r: true })
Reflect.set(ways, "s", { id: 0 })
console.log(show(ways))
const defined: Wide = { id: 9 }
Object.defineProperty(defined, "q", { value: "def", enumerable: true, writable: true, configurable: true })
defined.p = 1
console.log(show(defined), defined.q, JSON.stringify(Object.getOwnPropertyDescriptor(defined, "q")), JSON.stringify(Object.getOwnPropertyDescriptor(defined, "p")))

// Copies take the order of the moment.
const copyBefore = { ...cycle }
cycle.id = 60
console.log(keys(copyBefore), keys(cycle), keys({ ...cycle }), keys(Object.assign({ q: "" }, cycle)), cycle.id + 1)
