// Stores through declared interface types into untyped objects with accessors, read-only properties, or that are frozen.
interface Settings { volume: number; theme: string; muted?: boolean; limits: { max: number } }
const heard: string[] = []
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
function withSetters(): Settings {
  const hidden = { volume: 0 }
  const o: any = { theme: "", limits: { max: 0 } }
  Object.defineProperty(o, "volume", { get() { return hidden.volume }, set(x: number) { heard.push("volume=" + x); hidden.volume = x * 10 }, enumerable: true })
  return o
}
rule("own setter", () => { withSetters().volume = 3; return "stored" })
const chainedPrototype: any = { theme: "inherited", limits: { max: 7 }, volume: 1 }
rule("heir", () => { const chained: Settings = Object.create(chainedPrototype); chained.volume = 4; return "stored" })
const text = '{"volume":1,"theme":"j","limits":{"max":1}}'
rule("frozen parsed text", () => { const frozen: Settings = Object.freeze(JSON.parse(text)); return frozen.volume })
rule("sealed parsed text", () => { const sealed: Settings = Object.seal(JSON.parse(text)); return sealed.volume })
rule("parsed text that may not grow", () => { const closedUp: Settings = Object.preventExtensions(JSON.parse(text)); return closedUp.volume })
rule("proxy", () => { const doubling: Settings = new Proxy<Settings>({ volume: 0, theme: "", limits: { max: 0 } }, { set: (t, k, x) => Reflect.set(t, k, typeof x === "number" ? x * 2 : x) }); doubling.volume = 10; return doubling.volume })
rule("array", () => { const list = [1, 2] as unknown as Settings; list.limits = { max: 0 }; return "stored" })
rule("function", () => { const callable = (() => 1) as unknown as Settings; callable.limits = { max: 0 }; return "stored" })
console.log(heard.length)
