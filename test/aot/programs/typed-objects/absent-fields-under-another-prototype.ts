// Optional fields that are absent at birth, on records that typed code gives another prototype: a read finds what the chain holds at that moment, a first store creates an own field unless the chain intercepts it, and every change of the chain is seen by the next access. Each round runs the same places several times, so whatever they remember is in use when the chain changes.
// IR+ ^layout L\d+ .*name="Fields" (?!.*impossibleMutations=\[[^\]]*ChangePrototype)(?!.*isStable=true)
interface Fields { a: number; b: any; count?: any; ended?: any; size?: number; flag?: boolean; late?: any }
const base: any = { count: 0 }
const shared: any = Object.create(base)
shared.ended = false
shared.hello = function () { return 1 }
const calls: string[] = []
const intercepting: any = {
  get ended() { calls.push("get ended"); return "from the getter" },
  set ended(value: any) { calls.push("set ended " + value) },
  count: 1000,
}
function make(i: number): Fields {
  const record: Fields = { a: i, b: null }
  Object.setPrototypeOf(record, shared)
  return record
}
function makeIntercepted(i: number): Fields {
  const record: Fields = { a: i, b: null }
  Object.setPrototypeOf(record, intercepting)
  return record
}
function makePlain(i: number): Fields { return { a: i, b: null } }
function readCount(record: Fields): any { return record.count }
function readEnded(record: Fields): any { return record.ended }
function readSize(record: Fields): number | undefined { return record.size }
function readFlag(record: Fields): boolean | undefined { return record.flag }
function readLate(record: Fields): any { return record.late }
function end(record: Fields) { record.ended = true }
function bump(record: Fields) { record.count++ }
function setSize(record: Fields, size: number) { record.size = size }
function setFlag(record: Fields, flag: boolean) { record.flag = flag }
function setLate(record: Fields, late: any) { record.late = late }
function readCountUntyped(record: any) { return record.count }
function endUntyped(record: any) { record.ended = "untyped" }
function addExtra(record: any) { record.extra = 1 }
function remove(record: any, name: string) { delete record[name] }
function attempt(action: () => void) {
  try { action(); return "done" } catch (error) { return error instanceof TypeError ? "TypeError" : "another error" }
}
function describe(record: Fields) {
  return [readCount(record), readEnded(record), readSize(record), readFlag(record), readLate(record), readCountUntyped(record), Object.keys(record).join(),
    Object.hasOwn(record, "count"), Object.hasOwn(record, "ended"), "late" in record, "size" in record, JSON.stringify(record)].join(" | ")
}
function round(label: string, maker: (i: number) => Fields = make) {
  let said = ""
  for (let i = 0; i < 5; i++) {
    const record = maker(i)
    const before = describe(record)
    const outcomes = [attempt(() => bump(record)), attempt(() => end(record)), attempt(() => setSize(record, i)), attempt(() => setLate(record, "late " + i)), attempt(() => setFlag(record, i % 2 === 0))].join()
    said = before + "\n  " + outcomes + "\n  " + describe(record)
  }
  console.log(label + "\n  " + said + "\n  calls " + calls.length + " " + calls.slice(-2).join())
}
round("at first")
round("a plain record at the same places", makePlain)
round("a chain that intercepts, at the same places", makeIntercepted)
round("the first chain again")
base.count = 10
round("another value in the holder")
shared.count = 100
round("a nearer holder")
delete shared.count
round("the nearer holder is gone")
delete base.count
round("no holder")
shared.late = "inherited"
round("a name that was absent from the chain appears")
delete shared.late
base.size = 3
shared.flag = true
round("a number and a boolean are inherited")
delete base.size
delete shared.flag
Object.defineProperty(base, "count", { get() { calls.push("get count"); return 7 }, set(value) { calls.push("set count " + value) }, configurable: true })
round("an accessor")
Object.defineProperty(base, "count", { value: 5, writable: false, configurable: true })
round("a read-only property")
Object.defineProperty(base, "count", { value: 6, writable: true, configurable: true })
round("writable again")
const anotherBase = { count: "from another base", late: "also from there" }
Object.setPrototypeOf(shared, anotherBase)
round("the chain has another second member")
Object.setPrototypeOf(shared, new Proxy({}, {
  get(target, key) { calls.push("proxy get " + String(key)); return key === "count" ? 40 : undefined },
  set(target, key, value, receiver) { calls.push("proxy set " + String(key)); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }) },
  has(target, key) { calls.push("proxy has " + String(key)); return false },
}))
round("a proxy in the chain")
Object.setPrototypeOf(shared, base)
round("the first chain once more")
for (let i = 0; i < 4; i++) {
  const record = make(i)
  addExtra(record)
  const before = describe(record)
  bump(record); end(record); setLate(record, i); setSize(record, i)
  if (i === 3) console.log("with an extra property\n  " + before + "\n  " + describe(record))
}
for (let i = 0; i < 4; i++) {
  const record = make(i)
  bump(record); end(record)
  remove(record, "count"); remove(record, "ended")
  const removed = describe(record)
  endUntyped(record); bump(record)
  if (i === 3) console.log("removed and created again\n  " + removed + "\n  " + describe(record))
}
for (let i = 0; i < 4; i++) {
  const closed = make(i)
  Object.preventExtensions(closed)
  const frozen = make(i)
  setLate(frozen, "before")
  Object.freeze(frozen)
  const outcomes = [attempt(() => end(closed)), attempt(() => bump(closed)), attempt(() => end(frozen)), attempt(() => setLate(frozen, "after"))].join()
  if (i === 3) console.log("closed and frozen\n  " + outcomes + "\n  " + describe(closed) + "\n  " + describe(frozen))
}
for (let i = 0; i < 4; i++) {
  const record = make(i)
  const first = describe(record)
  Object.setPrototypeOf(record, intercepting)
  const second = describe(record)
  end(record)
  Object.setPrototypeOf(record, null)
  const third = describe(record)
  end(record); bump(record)
  if (i === 3) console.log("one record under three prototypes\n  " + first + "\n  " + second + "\n  " + third + "\n  " + describe(record) + "\n  calls " + calls.length)
}
