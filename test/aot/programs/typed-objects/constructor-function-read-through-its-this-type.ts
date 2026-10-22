// An object of a constructor function is read through the interface that the function declares as its `this`: the type names the layout that the function allocates.
interface Item { tag: number; flags: number; next: Item | null; label?: string }
interface ItemConstructor { new (tag: number): Item; (this: Item, tag: number): void }
function ItemNode(this: Item, tag: number) { this.tag = tag; this.flags = 0; this.next = null }
ItemNode.prototype.describe = function (this: Item) { return this.tag + ":" + this.flags }
const kept: any[] = JSON.parse("[]")
function make(tag: number): Item { const item = new (ItemNode as ItemConstructor)(tag); kept.push(item); return item }
function link(count: number): Item { const head = make(0); let at = head; for (let i = 1; i < count; i++) { at.next = make(i); at = at.next } return head }
function walk(head: Item): number { let sum = 0; for (let at: Item | null = head; at !== null; at = at.next) { sum += at.tag + (at.flags & 3); at.flags |= 1 } return sum }
link(5)
const first = kept[0] as Item, literal: Item = { tag: 100, flags: 2, next: first }
console.log(walk(first), walk(first), walk(literal), first.label, (first as any).describe(), Object.keys(first).join(), first instanceof (ItemNode as ItemConstructor))
first.label = "own"
delete (kept[1] as any).flags
Object.defineProperty(kept[2], "tag", { get() { return 1000 } })
console.log(walk(first), first.label, Object.keys(kept[1]).join(), JSON.stringify(kept[3]))
const stranger: Item = JSON.parse('{"tag":7,"flags":1,"next":null}')
console.log(walk(stranger), walk({ tag: 1, flags: 0, next: stranger }))
