// A regular expression made from text that the program keeps under a symbol held in a constant: the source is known at build time, as it is where the text is kept under a name.
// KNOWN hints1 ^(?:alpha+|beta+)$
// KNOWN hints1 ^<(?:[aA][bB]|[cC][dD])>
// KNOWN hints1 na+med-(?:x|y)
// KNOWN hints1 ^me+mo(?:one|two)$
// KNOWN hints1 ^pa+ssed(?:alpha+|beta+)$
const kWords = Symbol("words")
const kSpell = Symbol("spell")
interface Table { [kWords]: string[]; label: string }
const table: Table = { [kWords]: ["alpha+", "beta+"], label: "t" }
const whole = new RegExp("^(?:" + table[kWords].join("|") + ")$")
class Speller {
  [kSpell]: (word: string) => string = word => [...word].map(letter => "[" + letter + letter.toUpperCase() + "]").join("")
  tags: string[] = ["ab", "cd"]
  pattern() { return new RegExp("^<(?:" + this.tags.map(this[kSpell]).join("|") + ")>") }
}
const loose: any = {}
loose[kWords] = ["x", "y"]
const named = new RegExp("na+med-(?:" + loose[kWords].join("|") + ")")
const tagged = new Speller().pattern()
const kUnset = Symbol("unset")
let remembered: string | typeof kUnset = kUnset
function alternatives(): string {
  if (remembered === kUnset) remembered = ["one", "two"].join("|")
  return remembered
}
const memo = new RegExp("^me+mo(?:" + alternatives() + ")$")
function readUnder(from: any, key: symbol): string[] { return from[key] }
const passed = new RegExp("^pa+ssed(?:" + readUnder(table, kWords).join("|") + ")$")
console.log(whole.test("alphaaa"), whole.test("gamma"), tagged.test("<AB>"), tagged.test("<ac>"), named.test("naamed-y"), named.source, kWords in table, Object.getOwnPropertySymbols(table).length, memo.test("memotwo"), memo.test("memothree"), passed.test("passedbetaa"), alternatives())
