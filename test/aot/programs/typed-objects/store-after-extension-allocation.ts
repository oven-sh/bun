// Creating an object can collect after its cell exists: a double in a number field predicted int32 needs storage in the Extension. The store to the new object that follows at once still needs its write barrier. link is the control: a field that a literal fills stays inline, however many optional fields the type has.
// The functions are called through a table, so that nothing is inlined and no allocation is removed.
interface Leaf { n: number }
interface Wide {
  first: Leaf | null
  a0?: Leaf; a1?: Leaf; a2?: Leaf; a3?: Leaf; a4?: Leaf; a5?: Leaf; a6?: Leaf; a7?: Leaf
  b0?: Leaf; b1?: Leaf; b2?: Leaf; b3?: Leaf; b4?: Leaf; b5?: Leaf; b6?: Leaf; b7?: Leaf
  c0?: Leaf; c1?: Leaf; c2?: Leaf; c3?: Leaf; c4?: Leaf; c5?: Leaf; c6?: Leaf; c7?: Leaf
  d0?: Leaf; d1?: Leaf; d2?: Leaf; d3?: Leaf; d4?: Leaf; d5?: Leaf; d6?: Leaf; d7?: Leaf
  e0?: Leaf; e1?: Leaf; e2?: Leaf; e3?: Leaf; e4?: Leaf; e5?: Leaf; e6?: Leaf; e7?: Leaf
}
interface Item { weight: number; next: Item | null }

function leaf(n: number): Leaf { return { n } }
function link(first: Leaf, last: Leaf): Wide {
  const wide: Wide = { first: null, e7: last }
  wide.first = first
  return wide
}
function unit(): Item { return { weight: 1, next: null } }
function push(head: Item | null, weight: number): Item {
  const item: Item = { weight, next: null }
  item.next = head
  return item
}
const F = { leaf, link, unit, push }

const weights: number[] = JSON.parse("[0.5,1,2.25,3,1073741824.5]")
const wides: Wide[] = []
let head: Item | null = F.unit()
for (let i = 0; i < 300; i++) {
  head = F.push(head, weights[i % weights.length] + i)
  wides.push(F.link(F.leaf(i), F.leaf(-i)))
  if (i % 50 === 49) Bun.gc(true)
}
Bun.gc(true)

let count = 0, weight = 0
for (let item: Item | null = head; item; item = item.next) {
  count++
  weight += item.weight
}
console.log(count, weight)

let first = 0, last = 0
for (const wide of wides) {
  first += wide.first!.n
  last += wide.e7!.n
}
console.log(first, last, Object.keys(wides[299]).join())
