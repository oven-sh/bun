// Three types hold an optional field of one name in two forms, a number and a reference, and a store of another type may move it out of its slot.
// So a read through their union first tests that the slot is filled, and both the test and the read ask for the shape to find the slot.
interface Text { id: number; value?: string }
interface Count { id: number; value?: number }
interface Label { id: number; extra: number; value?: string }
type Item = Text | Count | Label

function text(id: number, value?: string): Text { const item: Text = { id }; if (value !== undefined) item.value = value; return item }
function count(id: number, value?: number): Count { const item: Count = { id }; if (value !== undefined) item.value = value; return item }
function label(id: number, value?: string): Label { const item: Label = { id, extra: id * 2 }; if (value !== undefined) item.value = value; return item }
function spoil(item: Item, value: unknown): Item { (item as { value?: unknown }).value = value; return item }

let reads = 0
function read(item: Item): unknown { return item.value }
function readTwice(item: Item): string {
  const first = item.value
  reads++
  const second = item.value
  return first + "|" + second
}
function readInLoop(item: Item, times: number): string {
  let result = ""
  for (let i = 0; i < times; i++) { result += item.value; reads++ }
  return result
}

const items: Item[] = [text(1, "a"), text(2), count(3, 1.5), count(4), label(5, "b"), label(6), count(7, 0), text(8, "")]
const spoiled: Item[] = [spoil(text(9, "c"), 9), spoil(count(10, 2), "ten"), spoil(label(11), true)]
const out: string[] = []
for (const item of items) out.push(String(read(item)), readTwice(item), readInLoop(item, 2))
console.log(out.join(" "), reads, spoiled.map(item => String((item as { value?: unknown }).value)).join())

function replace(item: Item, text: string, number: number): void {
  if (item.value === undefined) return
  if (typeof item.value === "number") item.value = number
  else item.value = text
}
for (const item of items) replace(item, "t" + item.id, item.id + 0.5)
console.log(items.map(item => item.id + ":" + item.value + ":" + Object.keys(item).join("")).join(" "))
