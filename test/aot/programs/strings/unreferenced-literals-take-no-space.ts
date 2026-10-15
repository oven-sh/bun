// A string literal that the compiled program no longer refers to takes no bytes in the executable; one that is still referred to in any way does.
function pick(flag: boolean): string { if (flag) return "dead\x5farm_of_an_inlined_function"; return "alive\x5farm_of_an_inlined_function" }
function onlyFromDeadArm(): string { return "dead\x5fonly_called_from_a_dead_arm" }
function picksACall(flag: boolean): string { if (flag) return onlyFromDeadArm(); return "x" }
function byNumber(n: number): string { switch (n) { case 1: return "dead\x5fcase_of_a_switch"; case 2: return "alive\x5fcase_of_a_switch"; default: return "dead\x5fnot_ascii_é→" } }
function inlinedEverywhere(): string { return "alive\x5fin_a_function_inlined_everywhere" }
function run(): string { let s = ""; for (let i = 0; i < 3; i++) s = pick(false) + " " + picksACall(false) + " " + byNumber(2) + " " + inlinedEverywhere() + " " + inlinedEverywhere().length; return s }
console.log(run())
const table: Record<string, number> = { ["alive\x5fas_a_key"]: 1, other: 2 }
console.log(Object.keys(table).join(), table["alive\x5fas_a_key"], "alive\x5fas_a_key" in table)
function fails(): never { throw new TypeError("alive\x5fin_a_message") }
try { fails() } catch (e) { console.log((e as Error).message, (e as Error).name) }
// Names that the compiler looks up by their text, and names that only the table of built-ins holds.
function nameInAMessage(x: any): string { try { return String(x.push(1)) } catch (e) { return (e as Error).constructor.name } }
console.log(nameInAMessage(undefined), nameInAMessage(null), nameInAMessage([]))
const thenable = { then(resolve: (v: number) => void) { resolve(7) } }
Promise.resolve(thenable).then(v => console.log("then", v))
console.log([1, 2, 3].length, "abc".length, [1, 2, 3].slice(1).join(), "abcdef".slice(2))
// The name of an inlined function still appears in `name` and in stack traces.
function inlinedAndNamed(): string { return new Error("e").stack!.split("\n").length > 0 ? "has a stack" : "none" }
console.log(inlinedAndNamed(), inlinedAndNamed.name)
class Kept { static label = "alive\x5fas_a_key"; #hidden = 1; get hidden() { return this.#hidden } method() { return "m" } }
console.log(Kept.label, new Kept().hidden, new Kept().method(), Kept.name, Object.getOwnPropertyNames(Kept.prototype).join())
console.log(/al(i)ve/.exec("alive")![1], 12345678901234567890n.toString(), typeof globalThis)
