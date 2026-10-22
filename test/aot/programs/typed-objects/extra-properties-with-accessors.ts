// Accessors defined at run time on objects with a layout: read and stored through `any` and through a type that declares the name.
const log: string[] = []
function flush() {
  const text = log.join(",")
  log.length = 0
  return text
}
function attempt(label: string, action: () => unknown) {
  try {
    console.log(label, String(action()), flush())
  } catch (error) {
    console.log(label, (error as Error).constructor.name, flush())
  }
}
function defineAccessor(target: any, name: string) {
  let stored = 1
  Object.defineProperty(target, name, {
    get() {
      log.push("get " + name)
      return stored
    },
    set(value: number) {
      log.push("set " + name + " " + value)
      stored = value
    },
    configurable: true,
    enumerable: true,
  })
}

class Point {
  a = 1
  x?: number
}
interface Entry {
  a: number
  x?: number
}
function readAny(target: any) {
  return target.x
}
function storeAny(target: any, value: number) {
  target.x = value
}
function readTyped(target: Entry) {
  return target.x
}
function storeTyped(target: Entry, value: number) {
  target.x = value
}
function readExtra(target: any) {
  return target.y
}
function storeExtra(target: any, value: unknown) {
  target.y = value
}
function exercise(label: string, make: () => Entry) {
  for (let round = 0; round < 3; round++) {
    const target = make()
    defineAccessor(target, "x")
    attempt(label + " read any", () => readAny(target))
    attempt(label + " store any", () => storeAny(target, round + 2))
    attempt(label + " read typed", () => readTyped(target))
    attempt(label + " store typed", () => storeTyped(target, round + 5))
    attempt(label + " keys", () => Object.keys(target).join())
  }
}
exercise("instance", () => new Point())
exercise("record", (): Entry => ({ a: 1 }))

function defineExtraAccessor(target: any) {
  Object.defineProperty(target, "y", {
    get() {
      log.push("get y")
      return "from getter"
    },
    set(value: unknown) {
      log.push("set y " + value)
    },
    configurable: true,
  })
}
for (let round = 0; round < 3; round++) {
  const target = new Point()
  defineExtraAccessor(target)
  attempt("extra accessor read", () => readExtra(target))
  attempt("extra accessor store", () => storeExtra(target, round))
  attempt("extra accessor keys", () => Object.keys(target).join())
}

const frozen = new Point()
defineAccessor(frozen, "x")
Object.freeze(frozen)
attempt("frozen read", () => readTyped(frozen))
attempt("frozen store runs the setter", () => storeTyped(frozen, 9))
attempt("frozen reads the setter's value", () => readAny(frozen))
attempt("frozen redefine", () => Object.defineProperty(frozen, "x", { value: 1 }))
attempt("frozen new name", () => storeExtra(frozen, 1))

class Inherited {
  a = 1
  x?: number
}
defineAccessor(Inherited.prototype, "x")
for (let round = 0; round < 3; round++) {
  const target: Entry = Object.create(Inherited.prototype)
  attempt("prototype accessor read", () => readTyped(target))
  attempt("prototype accessor store", () => storeTyped(target, round + 20))
  attempt("prototype accessor own", () => Object.hasOwn(target, "x"))
}
for (let round = 0; round < 3; round++) {
  const target = new Point()
  defineAccessor(target, "x")
  Object.setPrototypeOf(target, { x: 100 })
  attempt("own accessor over prototype value", () => readTyped(target))
  delete (target as any).x
  attempt("prototype value after delete", () => readTyped(target))
}

for (let round = 0; round < 3; round++) {
  const target = new Point()
  storeExtra(target, round)
  attempt("plain extra read", () => readExtra(target))
  attempt("plain extra store", () => storeExtra(target, round + 1))
  attempt("plain extra read again", () => readExtra(target))
  attempt("plain extra keys", () => Object.keys(target).join())
}
