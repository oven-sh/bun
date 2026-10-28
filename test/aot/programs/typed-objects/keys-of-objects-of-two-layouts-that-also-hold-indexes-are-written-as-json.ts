// The keys of objects of two layouts, some of which also hold properties under indexes, are listed and written as JSON in one loop.
const read = (o: any, name: string) => o[name]
interface Range { pos: number; end: number }
interface Item extends Range { kind: number; flags: number }
function ItemCtor(this: Item, kind: number, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 0 }
const Item = ItemCtor as unknown as new (kind: number, pos: number, end: number) => Item
const ranges: Range[] = [{ pos: 1, end: 2 }, new Item(7, 3, 4)]
;(ranges[0] as any)[3] = 1; (ranges[1] as any)[0] = 2
for (const range of ranges) {
  const item = range as Item
  console.log(item.pos, item.end, read(item, "kind"), "kind" in item, read(item, "flags"), JSON.stringify(Object.keys(item)))
}
