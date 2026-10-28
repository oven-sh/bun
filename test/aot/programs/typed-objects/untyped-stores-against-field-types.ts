// Stores through `any` into fields of every kind of type: a value of the type and a value outside the type are both stored, and keys, values and the neighboring fields read through `any` are what plain Bun shows.
// COUNTER: StoreOfOtherType = 4
class Animal { name: string = "animal"; speak(): string { return this.name + " speaks" } }
class Dog extends Animal { speak(): string { return this.name + " barks" } }
class Numbers extends Array<number> {}
interface Named { label: string }
const noop = () => {}
const firstNamed: Named = { label: "first" }
const secondNamed: Named = { label: "second" }

class AmountBox { before: number = 1; amount: number = 0; after: number = 2 }
class DigitBox { before: number = 1; digit: 0 | 1 | 2 = 0; after: number = 2 }
class LetterBox { before: number = 1; letter: "a" | "b" = "a"; after: number = 2 }
class WordBox { before: number = 1; word: "ready" | "done" = "done"; after: number = 2 }
class NoteBox { before: number = 1; note: string | undefined = undefined; after: number = 2 }
class FlagBox { before: number = 1; flag: boolean = false; after: number = 2 }
class BigBox { before: number = 1; big: bigint = 0n; after: number = 2 }
class TagBox { before: number = 1; tag: symbol = Symbol.iterator; after: number = 2 }
class PetBox { before: number = 1; pet: Animal = new Animal(); after: number = 2 }
class NamedBox { before: number = 1; named: Named = firstNamed; after: number = 2 }
class ListBox { before: number = 1; list: number[] = []; after: number = 2 }
class CallbackBox { before: number = 1; callback: () => void = noop; after: number = 2 }
class ThingBox { before: number = 1; thing: object = firstNamed; after: number = 2 }

const setAmount = (target: any, value: any) => { target.amount = value }
const setDigit = (target: any, value: any) => { target.digit = value }
const setLetter = (target: any, value: any) => { target.letter = value }
const setWord = (target: any, value: any) => { target.word = value }
const setNote = (target: any, value: any) => { target.note = value }
const setFlag = (target: any, value: any) => { target.flag = value }
const setBig = (target: any, value: any) => { target.big = value }
const setTag = (target: any, value: any) => { target.tag = value }
const setPet = (target: any, value: any) => { target.pet = value }
const setNamed = (target: any, value: any) => { target.named = value }
const setList = (target: any, value: any) => { target.list = value }
const setCallback = (target: any, value: any) => { target.callback = value }
const setThing = (target: any, value: any) => { target.thing = value }

function show(value: any): string {
  if (typeof value === "function") return "function " + value.name
  if (typeof value === "symbol") return String(value)
  if (typeof value === "bigint") return value + "n"
  if (Array.isArray(value)) return value.constructor.name + " [" + value.join() + "]"
  if (value instanceof Animal) return value.constructor.name + " " + value.name
  if (typeof value === "object" && value !== null) return JSON.stringify(value)
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value))
}

const parts = JSON.parse('{ "a": "a", "none": "", "re": "re", "ady": "ady" }') as Record<string, string>
const amount = new AmountBox()
for (const value of [7, 1.5, -0, NaN, 2 ** 53, 2 ** 63, -Infinity]) {
  setAmount(amount, value)
  console.log("amount", show(amount.amount), amount.amount + 1)
}
const digit = new DigitBox()
for (const value of [2, 1, 0]) {
  setDigit(digit, value)
  console.log("digit", digit.digit, digit.digit + 1)
}
const letter = new LetterBox()
for (const value of ["b", parts.a + parts.none]) {
  setLetter(letter, value)
  console.log("letter", letter.letter, letter.letter === "a", letter.letter.length)
}
const word = new WordBox()
setWord(word, parts.re + parts.ady)
console.log("word", word.word, word.word === "ready", word.word.length)
const note = new NoteBox()
for (const value of ["written", undefined, parts.re + parts.ady]) {
  setNote(note, value)
  console.log("note", note.note, note.note === undefined)
}
const flag = new FlagBox()
for (const value of [true, false]) {
  setFlag(flag, value)
  console.log("flag", flag.flag, flag.flag ? "on" : "off")
}
const big = new BigBox()
for (const value of [5n, 2n ** 70n]) {
  setBig(big, value)
  console.log("big", show(big.big), show(big.big + 1n))
}
const tag = new TagBox()
for (const value of [Symbol("unregistered"), Symbol.for("registered"), Symbol.asyncIterator]) {
  setTag(tag, value)
  console.log("tag", String(tag.tag), tag.tag.description)
}
const pet = new PetBox()
for (const value of [new Animal(), new Dog()]) {
  setPet(pet, value)
  console.log("pet", show(pet.pet), pet.pet.speak())
}
const named = new NamedBox()
for (const value of [secondNamed, firstNamed]) {
  setNamed(named, value)
  console.log("named", named.named.label, named.named === value)
}
const list = new ListBox()
setList(list, [1, 2, 3])
console.log("list", show(list.list), list.list.length, list.list[2] + 1)
let calls = 0
const callback = new CallbackBox()
for (const value of [() => { calls += 1 }, function counted() { calls += 10 }]) {
  setCallback(callback, value)
  callback.callback()
  console.log("callback", calls)
}
const thing = new ThingBox()
for (const value of [secondNamed, [1], noop]) {
  setThing(thing, value)
  console.log("thing", show(thing.thing), typeof thing.thing)
}

function storeOutside(title: string, box: any, set: (target: any, value: any) => void, value: unknown) {
  set(box, value)
  const keys = Object.keys(box)
  console.log(title, keys.join(), show(box[keys[1]]), box.before, box.after)
  box.before = 10
  console.log(title, "after", JSON.stringify(Object.keys(box)), box.before, show(box[keys[1]]))
}
storeOutside("other letter", new LetterBox(), setLetter, "c")
storeOutside("digit past range", new DigitBox(), setDigit, 3)
storeOutside("fraction as digit", new DigitBox(), setDigit, 1.5)
storeOutside("null as note", new NoteBox(), setNote, null)
storeOutside("plain object as pet", new PetBox(), setPet, { name: "plain" })
storeOutside("function as list", new ListBox(), setList, function listed() {})
storeOutside("array subclass as list", new ListBox(), setList, Numbers.of(4, 5))
