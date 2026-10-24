// Types that refer to themselves and to each other: lists, trees, cycles, a narrower recursive type over wider nodes, and nodes from `JSON.parse` in between.
interface ListItem { value: number; next: ListItem | null }
interface Linked { next: Linked | null }
interface TwoWay { value: number; next: TwoWay | null; prev: TwoWay | null }
interface Tree { value: number; left?: Tree; right?: Tree }
interface Owner { label: string; pets: Pet[]; partner?: Owner }
interface Pet { label: string; owner: Owner; friend?: Pet }
function nameOf(e: unknown): string { return (e as Error).constructor.name }
function fromArray(values: number[]): ListItem | null { let head: ListItem | null = null; for (let i = values.length - 1; i >= 0; i--) head = { value: values[i], next: head }; return head }
function toText(head: ListItem | null): string { const out: number[] = []; for (let n = head; n !== null; n = n.next) out.push(n.value); return out.join() }
function count(head: Linked | null): number { let n = 0; for (let l = head; l !== null; l = l.next) n++; return n }
function reverse(head: ListItem | null): ListItem | null { let done: ListItem | null = null; while (head !== null) { const next: ListItem | null = head.next; head.next = done; done = head; head = next } return done }
function linkOf(item: ListItem): ListItem | null { return item.next }
function hasCycle(head: Linked | null): boolean {
  let slow = head, fast = head
  while (fast !== null && fast.next !== null) { slow = slow!.next; fast = fast.next.next; if (slow === fast) return true }
  return false
}
let list = fromArray([1, 2.5, -0, 4, 5])
console.log(toText(list), count(list), hasCycle(list), JSON.stringify(list))
list = reverse(list)
console.log(toText(list), count(list), Object.keys(list!).join())

// Nodes of a wider type, and nodes from untyped code, in one chain. (The link of a wider node, read with the wider type once it holds a narrower node: type-rules/field-covariance-linked-list.)
const first: TwoWay = { prev: null, value: 10, next: null }
const second: TwoWay = { value: 20, next: null, prev: first }
first.next = second
const parsed: ListItem = JSON.parse('{"next":null,"value":30,"stray":true}')
const mixedHead: ListItem = { value: 0, next: first }
;(second as ListItem).next = parsed
parsed.next = { value: 40, next: null }
console.log(toText(mixedHead), count(mixedHead), count(first), second.prev === first, second.next === (parsed as object), JSON.stringify(parsed))
console.log(toText(reverse(mixedHead)), first.prev, linkOf(first) === mixedHead, second.prev === first, Object.keys(second).join(), Object.keys(parsed).join())

// Cycles.
const ring = fromArray([1, 2, 3])!
ring.next!.next!.next = ring
console.log(hasCycle(ring), ring.next!.next!.next!.value, ring.next!.next!.next === ring)
try { console.log(JSON.stringify(ring)) } catch (e) { console.log(nameOf(e)) }
const selfish: Tree = { value: 1 }
selfish.left = selfish
console.log(selfish.left.left?.left?.value, selfish.right?.left?.value, "right" in selfish, selfish.left === selfish)

// A search tree: optional children are created as they are needed.
function insert(t: Tree | undefined, value: number): Tree {
  if (t === undefined) return { value }
  if (value < t.value) t.left = insert(t.left, value); else t.right = insert(t.right, value)
  return t
}
function walk(t: Tree | undefined, out: number[]): number[] { if (t) { walk(t.left, out); out.push(t.value); walk(t.right, out) } return out }
function depth(t: Tree | undefined): number { return t === undefined ? 0 : 1 + Math.max(depth(t.left), depth(t.right)) }
function shape(t: Tree | undefined): string { return t === undefined ? "." : "(" + Object.keys(t).map(k => k[0]).join("") + shape(t.left) + shape(t.right) + ")" }
function mirror(t: Tree | undefined): void { if (t) { const l = t.left; t.left = t.right; t.right = l; mirror(t.left); mirror(t.right) } }
let root: Tree | undefined
for (const v of [50, 30, 70, 20, 40, 60, 80, 35, 65.5, -0]) root = insert(root, v)
console.log(walk(root, []).join(), depth(root), shape(root), JSON.stringify(root))
mirror(root)
console.log(walk(root, []).join(), depth(root), shape(root), JSON.stringify(root))
function prune(t: Tree): void { if (t.left === undefined) delete t.left; else prune(t.left); if (t.right === undefined) delete t.right; else prune(t.right) }
prune(root!)
console.log(shape(root), "left" in root!.left!.left!, root!.left!.left!.left)

// Two types that refer to each other.
const ann: Owner = { label: "ann", pets: [] }
const bob: Owner = { pets: [], label: "bob", partner: ann }
ann.partner = bob
const rex: Pet = { label: "rex", owner: ann }
const tom: Pet = { owner: bob, label: "tom", friend: rex }
rex.friend = tom
ann.pets.push(rex); bob.pets.push(tom, rex)
console.log(rex.owner.partner?.pets.map(p => p.label).join(), tom.friend?.friend?.owner.label, ann.partner.partner === ann, bob.pets[1].owner.pets[0] === rex, Object.keys(ann).join(), Object.keys(rex).join())
rex.owner = bob
delete ann.partner
console.log(ann.pets[0].owner.label, bob.partner?.partner?.label, tom.friend?.owner.partner?.label, "partner" in ann)

// Long and deep.
let chain: ListItem | null = null
for (let i = 0; i < 20000; i++) {
  if (i % 1000 === 999) { const p: ListItem = JSON.parse('{"value":' + i + ',"next":null}'); p.next = chain; chain = p }
  else chain = { value: i, next: chain }
}
let sum = 0
for (let n = chain; n !== null; n = n.next) sum += n.value
console.log(count(chain), sum, toText(reverse(chain)).length)
let deep: Tree = { value: 0 }
for (let i = 1; i < 500; i++) deep = i & 1 ? { value: i, left: deep } : { right: deep, value: i }
console.log(depth(deep), walk(deep, []).length, shape(deep).length)
