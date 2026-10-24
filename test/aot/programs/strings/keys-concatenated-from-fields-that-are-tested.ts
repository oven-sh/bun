// A key is made of fields of several objects, as TypeScript's checker does with `source.id + "," + target.id`. Each field is read and tested between two concatenations.
// Most objects hold what their type says. Some hold a string, undefined, null, a boolean, a bigint, an object whose conversion has an effect, a symbol, or have a getter with an effect:
// the conversions, the reads and the errors come in the order of the source text, and every key is the text that plain Bun makes.
// One case is left out: a symbol in front of a part whose read or conversion has an effect. ECMAScript refuses the symbol first, and so does the compiled program; the interpreter reads and converts the later parts first.
interface Item {
  id: number
  name: string
}
const log: string[] = []
function item(id: unknown, name: unknown = "n"): Item {
  return { id, name } as Item
}
function pairKey(source: Item, target: Item): string {
  return source.id + "," + target.id
}
function tripleKey(first: Item, second: Item, third: Item): string {
  return first.id + ":" + second.id + ":" + third.id
}
function namedKey(source: Item, target: Item): string {
  return source.name + "/" + target.name + "#" + source.id
}
function keyWithCall(source: Item, target: Item, between: () => void): string {
  const start = source.id + ","
  between()
  return start + target.id
}
function keyInTry(source: Item, target: Item): string {
  try {
    return source.id + "|" + target.id
  } catch (error) {
    return "caught " + (error as Error).constructor.name
  }
}
function templateKey(source: Item, target: Item): string {
  return `${source.id}-${target.id}-${source.name}`
}
function attempt(action: () => string): string {
  try {
    return action()
  } catch (error) {
    return (error as Error).constructor.name
  }
}
function flush(): string {
  return log.splice(0).join(" ")
}

const cache = new Map<string, number>()
let hits = 0
const items: Item[] = []
for (let i = 0; i < 300; i++) items.push(item(i, "n" + i))
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < items.length; i++) {
    const key = pairKey(items[i], items[(i * 7 + round) % items.length])
    if (cache.has(key)) hits++
    else cache.set(key, i)
  }
}
console.log(cache.size, hits, tripleKey(items[1], items[22], items[299]), namedKey(items[3], items[4]), templateKey(items[5], items[6]))

function talking(label: string, result: unknown): object {
  return {
    valueOf() {
      log.push("valueOf " + label)
      return result
    },
    toString() {
      log.push("toString " + label)
      return "text " + label
    },
  }
}
function withGetter(label: string, id: unknown): Item {
  return {
    get id() {
      log.push("get " + label)
      return id
    },
    name: label,
  } as Item
}
const unusual: [string, () => Item][] = [
  ["number", () => item(7)],
  ["fraction", () => item(0.5)],
  ["negative zero", () => item(-0)],
  ["not a number", () => item(NaN)],
  ["large", () => item(1e21)],
  ["string", () => item("s")],
  ["empty", () => item("")],
  ["undefined", () => item(undefined)],
  ["null", () => item(null)],
  ["boolean", () => item(true)],
  ["bigint", () => item(12345678901234567890n)],
  ["object", () => item(talking("o", 5))],
  ["object to string", () => item(talking("p", {}))],
  ["symbol", () => item(Symbol("x"))],
  ["getter", () => withGetter("g", 9)],
  ["getter of object", () => withGetter("h", talking("h", "hv"))],
  ["throwing getter", () => ({ get id(): number { log.push("throw"); throw new RangeError("no id") }, name: "t" })],
  ["missing", () => ({ name: "m" }) as Item],
  ["array", () => item([1, 2])],
]
const withEffect = new Set(["object", "object to string", "getter", "getter of object", "throwing getter"])
for (const [firstLabel, first] of unusual) {
  for (const [secondLabel, second] of unusual) {
    if (firstLabel === "symbol" && withEffect.has(secondLabel)) continue
    const results = [
      attempt(() => pairKey(first(), second())), flush(),
      attempt(() => keyInTry(first(), second())), flush(),
      attempt(() => templateKey(first(), second())), flush(),
      attempt(() => keyWithCall(first(), second(), () => log.push("between"))), flush(),
    ]
    console.log(firstLabel, "+", secondLabel, "=", results.join(" ; "))
  }
}
for (const [label, make] of unusual) {
  console.log(label, attempt(() => tripleKey(item(1), make(), item(3))), flush(), attempt(() => tripleKey(make(), item(2), make())), flush(), attempt(() => tripleKey(item(1), item(2), make())), flush())
  console.log(label, attempt(() => namedKey(item(1, make().id), item(2, "b"))), flush(), attempt(() => namedKey(item(make().id, "a"), item(2, make().id))), flush())
}
console.log(attempt(() => pairKey(undefined as unknown as Item, item(1))), attempt(() => pairKey(item(1), null as unknown as Item)), attempt(() => keyWithCall(item(1), null as unknown as Item, () => log.push("between"))), flush())
