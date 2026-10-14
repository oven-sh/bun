// What a variable in a JavaScript file holds is inferred where the source shows it, and the program behaves the same where it does not.
import * as k from "./untyped/kinds.js"
const show = (name: string, f: () => unknown) => {
  let text: string
  try { const v = f(); text = typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)) } catch (e) { text = "throws " + (e as Error).constructor.name }
  console.log(name + ": " + text)
}
const any = k as any
const given: [string, unknown[][]][] = [
  ["counter", [[5], [0], [2.5], ["3"], [NaN], [undefined]]],
  ["down", [[["a", "b", "c"]], ["xyz"], [{ length: 2, 0: "p", 1: "q" }], [{ length: "2", 0: "p", 1: "q" }]]],
  ["incremented", [[1], [1n], ["4"], [undefined], [{ valueOf() { return 9n } }]]],
  ["mixes", [[false], [true]]],
  ["blankNeverRead", [[true], [false]]],
  ["blankString", [[true], [false]]],
  ["blankBigint", [[true], [false]]],
  ["blankSymbol", [[true], [false]]],
  ["blankStringCaptured", [[true], [false]]],
  ["hoistedStringNeverRead", [[true], [false]]],
  ["concatenated", [[1], ["a"], [null], [{ toString() { return "obj" } }], [Symbol.iterator]]],
  ["addedTo", [[1], ["a"], [1n], [null], [undefined], [[1, 2]]]],
  ["lowBit", [[3], ["3"], [3n], [null], [{ valueOf() { return 5 } }], [{ valueOf() { return 5n } }]]],
  ["unsigned", [[-1], ["7"], [1n]]],
  ["negated", [[1], [0], [1n], ["2"], [{ valueOf() { return 3n } }]]],
  ["flipped", [[1], [1n], ["2"]]],
  ["plus", [["3"], [1n], [null], [undefined]]],
  ["either", [[true], [false]]],
  ["orUndefined", [[true], [false]]],
  ["fallsBack", [[null], ["s"], [0], [undefined]]],
  ["lengthOfUnknown", [["abc"], [[1]], [{ length: "long" }], [{}]]],
  ["fromProperty", [[{ count: 1 }], [{ count: 1n }], [{}]]],
  ["keyOfLoop", [[{ a: 1 }], [{}]]],
  ["valueOfLoop", [[["s"]], [[]]]],
  ["largest", [[3], ["4"], [{ valueOf() { return 8 } }], [1n], [undefined]]],
  ["asString", [[12], [null], [Symbol.iterator], [{ toString() { return "four" } }]]],
  ["asNumber", [["12"], [12n], [undefined], [Symbol.iterator]]],
  ["asBoolean", [[0], ["s"]]],
  ["shadowedString", [[1]]],
  ["shadowedMath", [[1]]],
  ["shadowedNaN", [["not NaN"]]],
  ["shadowedUndefined", [["defined"]]],
  ["nameOfKind", [[1], [undefined]]],
  ["removed", [[false], [true]]],
  ["template", [[1], [null], [Symbol.iterator]]],
  ["compared", [[1, 2], ["b", "a"], [1n, 2], [NaN, 1]]],
  ["eachOther", [[10], [80], [0]]],
  ["eachOtherMixed", [[0], [1], [4]]],
  ["switched", [[1], [2], [3]]],
  ["storesExported", [[1], ["s"]]],
]
const withArguments = new Set(given.map(it => it[0]))
for (const [name, calls] of given) for (const args of calls) show(name, () => any[name](...args))
for (const name of Object.keys(k).sort()) {
  if (withArguments.has(name) || typeof any[name] !== "function" || name === "yielded" || name === "awaited") continue
  show(name, () => any[name]())
}
show("bumpsTop again", () => k.bumpsTop())
show("exported", () => k.exported)
const it = any.yielded(); show("yielded", () => [it.next().value, it.next("sent").value].join())
k.awaited(Promise.resolve("later")).then((v: unknown) => show("awaited", () => v))
