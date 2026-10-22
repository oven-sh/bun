// Untyped code stores a value of the wrong kind into a typed field, in five ways: each store succeeds. The typed read that follows throws a TypeError for another kind; null, undefined and, for an object type, any object pass.
interface Gauge { n: number; s: string; b: boolean; o: { v: number }; f: () => string; opt?: number; list: number[] }
function make(): Gauge { return { n: 1, s: "s", b: true, o: { v: 1 }, f: () => "f", list: [1] } }
function all(g: Gauge): string { return [g.n + 1, g.s + "!", !g.b, g.o.v, g.f(), String(g.opt), g.list.length, Object.keys(g).join("")].join("") }
function put(g: object, k: string, w: unknown, way: number): void {
  const loose: any = g
  if (way % 5 === 0) loose[k] = w
  else if (way % 5 === 1) Reflect.set(g, k, w)
  else if (way % 5 === 2) Object.assign(g, { [k]: w })
  else if (way % 5 === 3) Object.defineProperty(g, k, { value: w, writable: true, enumerable: true, configurable: true })
  else for (const [name, value] of Object.entries({ [k]: w })) loose[name] = value
}
const wrong: Record<string, unknown[]> = {
  n: ["x", true, null, undefined, { z: 1 }, [1], () => 1, Symbol("y"), 10n],
  s: [1, false, { z: 1 }, 2.5, Symbol("y")],
  b: [0, "", null, "true", 1, undefined],
  o: [5, "obj", true, [1], () => 1],
  f: [1, "f", { call: 1 }, [1]],
  opt: ["x", null, false, { z: 1 }],
  list: [1, "list", true, { length: 1 }, () => 1],
}
const untouched = all(make())
let way = 0
for (const k of Object.keys(wrong)) {
  const line: string[] = []
  for (const w of wrong[k]) for (let turn = 0; turn < 5; turn++) {
    const g = make()
    try { put(g, k, w, way++); line.push("no error") } catch (e) { line.push(e instanceof TypeError ? "T" : "other " + e) }
    try { if (all(g) !== untouched) line.push("changed: " + all(g)) } catch (e) { line.push("threw") }
  }
  console.log(k + ":", line.join(""))
}
// A class.
class Ticker { n = 0; label = "t"; inc(): number { return ++this.n } tag(): string { return this.label + "#" } }
const ticker = new Ticker()
try { put(ticker, "n", "5", 0); console.log("a string for the number of an instance: no error") } catch (e) { console.log("a string for the number of an instance:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(ticker.inc(), JSON.stringify(ticker)) } catch (e) { console.log("line 37:", e instanceof TypeError ? "TypeError" : "other " + e) }
