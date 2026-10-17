// Object.defineProperty, Object.defineProperties and Reflect.defineProperty give a declared member of an object that typed code made other attributes: read-only, hidden, fixed. Everything afterwards is as in JavaScript.
function row(name: string, f: () => unknown) { try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": threw " + (e instanceof TypeError ? "TypeError" : String(e))) } }
interface Entry { id: number; label: string; secret: string; on: boolean }
function entry(): Entry { return { id: 1.5, label: "l", secret: "s", on: true } }
const look = (e: Entry) => Object.keys(e).join() + " " + JSON.stringify(e) + " " + e.id + e.label + e.secret + e.on
row("the same attributes, another value", () => { const e = entry(); Object.defineProperty(e, "label", { value: "other", writable: true, enumerable: true, configurable: true }); return look(e) })
row("only a value", () => { const e = entry(); Object.defineProperty(e, "label", { value: "valued" }); e.label += "!"; return look(e) })
row("hidden", () => { const e = entry(); Object.defineProperty(e, "secret", { enumerable: false }); return look(e) + " " + ("secret" in e) + " " + Object.getOwnPropertyNames(e).join() + " " + JSON.stringify({ ...e }) })
row("hidden, then stored to", () => { const e = entry(); Object.defineProperty(e, "secret", { enumerable: false }); e.secret = "again"; return look(e) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(e, "secret")) })
row("read-only", () => { const e = entry(); Object.defineProperty(e, "id", { writable: false }); let threw = "stored"; try { e.id = 9.5 } catch (error) { threw = (error as Error).name } return threw + " " + look(e) })
row("fixed", () => { const e = entry(); Object.defineProperty(e, "on", { configurable: false }); let threw = "deleted"; try { delete (e as Partial<Entry>).on } catch (error) { threw = (error as Error).name } return threw + " " + look(e) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(e, "on")) })
row("a hidden value in one step", () => { const e = entry(); Object.defineProperty(e, "secret", { value: "new", enumerable: false, writable: true, configurable: true }); return look(e) })
row("Object.defineProperties", () => { const e = entry(); Object.defineProperties(e, { secret: { enumerable: false }, id: { writable: false, value: 2.5 } }); return look(e) })
row("Reflect.defineProperty", () => { const e = entry(); return Reflect.defineProperty(e, "secret", { enumerable: false }) + " " + look(e) })
row("made visible again", () => { const e = entry(); Object.defineProperty(e, "secret", { enumerable: false }); Object.defineProperty(e, "secret", { enumerable: true }); return look(e) })
row("others of the type are untouched", () => { const first = entry(), second = entry(); Object.defineProperty(first, "secret", { enumerable: false }); Object.defineProperty(first, "id", { writable: false }); second.id = 7.5; return look(first) + " | " + look(second) })
row("a member that is not declared", () => { const e = entry(); Object.defineProperty(e, "extra", { value: 1, enumerable: false }); return look(e) + " " + (e as Entry & { extra: number }).extra })
function hideSecret<T extends { secret: string }>(value: T): T { return Object.defineProperty(value, "secret", { enumerable: false }) }
row("through a generic helper", () => look(hideSecret(entry())))
let total = 0
for (let i = 0; i < 2000; i++) { const e = entry(); e.id = i; e.label = "n" + i; total += e.id + e.label.length + e.secret.length }
console.log("objects that nobody redefines: " + total)
