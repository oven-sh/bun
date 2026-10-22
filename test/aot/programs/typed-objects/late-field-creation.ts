"use strict"
// Optional fields created after allocation: the key order follows the order of creation, and storage grows past the cell.
function attempt(label: string, action: () => unknown) {
  try {
    console.log(label, String(action()))
  } catch (error) {
    console.log(label, (error as Error).constructor.name)
  }
}
interface Options {
  a?: number
  b?: string
  c?: boolean
  d?: object
  e?: number
}
function keys(target: object) {
  return Object.keys(target).join()
}
function setA(target: Options) {
  target.a = 1
}
function setB(target: Options) {
  target.b = "b"
}
function setC(target: Options) {
  target.c = true
}
function setE(target: Options) {
  target.e = 2.5
}

for (let round = 0; round < 4; round++) {
  const first: Options = {}
  setA(first)
  const afterA = keys(first)
  setB(first)
  const second: Options = {}
  setB(second)
  const afterB = keys(second)
  setA(second)
  if (round === 3) console.log("two orders", afterA, keys(first), afterB, keys(second))
}

function setFour(target: Options) {
  target.d = {}
  target.b = "b"
  target.e = 1
  target.a = 2
}
for (let round = 0; round < 4; round++) {
  const target: Options = {}
  setFour(target)
  const empty: Options = {}
  setC(empty)
  setFour(empty)
  if (round === 3) console.log("four at once", keys(target), keys(empty), JSON.stringify(target), JSON.stringify(empty))
}

function addExtra(target: any, name: string) {
  target[name] = name
}
for (let round = 0; round < 4; round++) {
  const target: Options = {}
  setA(target)
  const first = keys(target)
  addExtra(target, "extra")
  const second = keys(target)
  setB(target)
  const third = keys(target)
  addExtra(target, "other")
  const fourth = keys(target)
  setC(target)
  if (round === 3) console.log("after an extra property", first, second, third, fourth, keys(target), JSON.stringify(target))
}

for (let round = 0; round < 2; round++) {
  const target: Options = {}
  setA(target)
  Object.seal(target)
  attempt("sealed existing", () => {
    setA(target)
    return keys(target)
  })
  attempt("sealed new", () => setB(target))
  attempt("sealed keys", () => keys(target))
  const closed: Options = {}
  Object.preventExtensions(closed)
  attempt("not extensible", () => setE(closed))
  const frozen: Options = { a: 1 }
  Object.freeze(frozen)
  attempt("frozen existing", () => setA(frozen))
  attempt("frozen new", () => setC(frozen))
}

interface Wide {
  f00?: number; f01?: number; f02?: number; f03?: number; f04?: number; f05?: number; f06?: number; f07?: number; f08?: number; f09?: number
  f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number
  f20?: number; f21?: number; f22?: number; f23?: number; f24?: number; f25?: number; f26?: number; f27?: number; f28?: number; f29?: number
  f30?: number; f31?: number; f32?: number; f33?: number; f34?: number; f35?: number; f36?: number; f37?: number; f38?: number; f39?: number
  f40?: number; f41?: number; f42?: number; f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number; f49?: number
  f50?: number; f51?: number; f52?: number; f53?: number; f54?: number; f55?: number; f56?: number; f57?: number; f58?: number; f59?: number
  f60?: number; f61?: number; f62?: number; f63?: number; f64?: number; f65?: number; f66?: number; f67?: number; f68?: number; f69?: number
}
function fillLast(target: Wide) {
  target.f69 = 69.5
  target.f68 = 68
  target.f35 = 2 ** 40
  target.f00 = 0
  target.f34 = -1
}
for (let round = 0; round < 4; round++) {
  const target: Wide = {}
  fillLast(target)
  const partial = keys(target)
  const all: any = target
  for (let index = 0; index < 70; index++) all["f" + String(index).padStart(2, "0")] = index
  if (round === 3) console.log("seventy fields", partial, Object.keys(target).length, keys(target).slice(0, 24), target.f69, target.f35, target.f00)
}

class Counter {
  value?: number
}
function setValue(target: Counter, value: number) {
  target.value = value
}
function readValue(target: Counter) {
  return target.value
}
const numbers = [1, 2147483647, 2147483648, -2147483648, -2147483649, 0.5, -0, NaN, Infinity, 7]
for (let round = 0; round < 3; round++) {
  const target = new Counter()
  const seen: unknown[] = [keys(target)]
  for (const number of numbers) {
    setValue(target, number)
    seen.push(Object.is(readValue(target), -0) ? "-0" : readValue(target), keys(target))
  }
  if (round === 2) console.log("number field", seen.join(" "))
}

class Complete {
  a: number
  b: string
  c?: boolean
  constructor() {
    this.c = true
    this.b = "b"
    this.a = 1
  }
}
for (let round = 0; round < 3; round++) {
  const target = new Complete()
  if (round === 2) console.log("set in the constructor", keys(target), JSON.stringify(target))
}
