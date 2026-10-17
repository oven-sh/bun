// The name of a module variable is in the message of the ReferenceError that a read ahead of its initialization throws: whatever else is done with such names, those messages stay.
declare const console: { log(...args: unknown[]): void }
function attempt(what: string, read: () => unknown): void {
  try { console.log(what, "yields", String(read())) } catch (e) { console.log(what, (e as Error).constructor.name, (e as Error).message) }
}
function readsLaterLet(): number { return laterLet + 1 }
function readsLaterConst(): string { return laterConst + "!" }
function readsTypeOfLater(): string { return typeof laterForTypeOf }
function storesToLater(): number { laterStoredTo = 5; return laterStoredTo }
function callsLaterArrow(): number { return laterArrow(2) }
function readsInLoop(): number { let sum = 0; for (let i = 0; i < 3; i++) sum += laterInLoop; return sum }
const readers: [string, () => unknown][] = [
  ["a let", readsLaterLet], ["a const", readsLaterConst], ["typeof", readsTypeOfLater], ["a store", storesToLater], ["an arrow", callsLaterArrow], ["in a loop", readsInLoop],
]
for (const [what, read] of readers) attempt("ahead: " + what, read)
let laterLet = 1
const laterConst = "text"
class LaterClass { name = "made" }
let laterForTypeOf = 3
let laterStoredTo = 4
const laterArrow = (x: number): number => x * 2
let laterInLoop = 7
for (const [what, read] of readers) attempt("behind: " + what, read)
const neverReadAheadOfItsInitialization = readers.length
let onlyStoredTo = 0
function storesAndReads(): number { onlyStoredTo = neverReadAheadOfItsInitialization; return neverReadAheadOfItsInitialization * 2 }
console.log(storesAndReads())
const sameNameAsAProperty = { sameNameAsAProperty: 1, laterLet: 2 }
console.log(neverReadAheadOfItsInitialization, Object.keys(sameNameAsAProperty).join(), sameNameAsAProperty.sameNameAsAProperty, (sameNameAsAProperty as Record<string, number>)["later" + "Let"])
function sameNameAsAFunction(): string { return sameNameAsAFunction.name }
console.log(sameNameAsAFunction(), LaterClass.name, laterArrow.name, readsLaterLet.name)
