// An absent optional field reads through the prototype chain, which can gain the name after the field was first read.
// `bun run` tests no types, so only the compiled program throws in the last case: its answer is in the .expected.txt.
interface Entry {
  a: number
  size?: number
  label?: string
}
const chain: any = {}
function make(): Entry {
  const entry: Entry = { a: 1 }
  Object.setPrototypeOf(entry, chain)
  return entry
}
function readSize(entry: Entry) {
  return entry.size
}
function readLabel(entry: Entry) {
  return entry.label
}
function report(label: string) {
  for (let round = 0; round < 3; round++) {
    const entry = make()
    const size = readSize(entry)
    const text = readLabel(entry)
    if (round === 2) console.log(label, size, text)
  }
}

report("names absent from the chain")

chain.size = 4
chain.label = "inherited"
report("values on the chain")

let reads = 0
Object.defineProperty(chain, "size", {
  get() {
    reads++
    return 8
  },
  configurable: true,
})
report("a getter on the chain")
console.log("getter reads", reads)

delete chain.size
delete chain.label
report("the names are gone")

chain.size = null
report("null on the chain")
delete chain.size

const entries = [make(), make(), make()]
chain.size = "wrong"
for (const entry of entries) {
  try {
    console.log("wrong type", readSize(entry))
  } catch (error) {
    console.log("wrong type", (error as Error).constructor.name)
  }
}
