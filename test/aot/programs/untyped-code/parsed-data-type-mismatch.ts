// Data that `JSON.parse` read from a file is cast to a type although some entries do not match the type. The cast takes any object, and reads through a dictionary or a variable without an annotation give what is there. A value of the wrong kind throws a TypeError where it enters an annotated variable, a primitive of the wrong kind also under a cast, and where a function reads it from a field of its annotated parameter.
type P = { tools: string[]; n?: number }
type Q = { count: number; name: string }
type G = { projects?: Record<string, P>; counters?: Record<string, Q>; version: number }
const DEFAULT: P = { tools: [], n: 0 }
const text = JSON.stringify({ version: 2, projects: { good: { tools: ["a", "b"], n: 1 }, lacks: { n: 5 }, nothing: null, word: "corrupted", wrong: { tools: "one,two" }, more: { tools: ["c"], extra: true }, list: [1, 2], digit: 7 }, counters: { good: { count: 1, name: "x" }, lacks: { name: "y" }, wrong: { count: "3", name: 4 } } })
const row = (what: string, f: () => unknown) => { let said: string; try { said = String(f()) } catch (e) { said = "THROWS " + (e as Error).constructor.name } console.log(what + ": " + said) }
const parse = () => JSON.parse(text) as G
const use = (p: P) => (Array.isArray(p.tools) ? p.tools.join("+") : typeof p.tools) + "/" + (p.n ?? "-")
const keys = ["good", "lacks", "nothing", "word", "wrong", "more", "list", "digit", "absent"]
row("the cast", () => parse().version)
for (const key of keys) row("by key, defensive, " + key, () => { const p = parse().projects![key] ?? DEFAULT; if (!p || typeof p !== "object") return "skipped " + typeof p; if (typeof p.tools === "string") return "a string of " + (p.tools as string).length; if (!p.tools) return "none"; return p.tools.length })
for (const key of keys) row("to a function, " + key, () => { const p = parse().projects![key]; return !p || typeof p !== "object" ? "skipped " + typeof p : use(p) })
for (const key of keys) row("to an annotated const, " + key, () => { const kept: P = parse().projects![key]; return typeof kept })
row("entries", () => { const seen: string[] = []; for (const [k, p] of Object.entries(parse().projects!)) { if (!p || typeof p !== "object") { seen.push(k + " skipped"); continue } seen.push(k + " " + use(p)) } return seen.join() })
row("values, filtered", () => { const all: P[] = Object.values(parse().projects!).filter(p => p && typeof p === "object" && !Array.isArray(p)); return all.length + " " + all.map(use).join() })
row("written through", () => { const g = parse(); const kept: P = g.projects!["lacks"]; kept.tools = ["late"]; kept.n = (kept.n ?? 0) + 1; return JSON.stringify(g.projects!["lacks"]) + " " + (kept === g.projects!["lacks"]) + " " + Object.keys(kept).join() })
for (const key of ["good", "lacks", "wrong"]) row("a required number, " + key, () => { const q = parse().counters![key]; return typeof q.count + " " + (typeof q.count === "number" ? q.count + 1 : "no number") + " " + typeof q.name })
const isText = (v: unknown): v is string => typeof v === "string"
const describeValue = (v: unknown) => typeof v + ":" + String(v)
for (const key of keys) row("as a dictionary, " + key, () => { const x = parse().projects![key]; if (!x || typeof x !== "object") return "skipped"; const r = x as Record<string, unknown>; return typeof r.tools === "string" && describeValue(r.tools) })
for (const key of keys) row("a dictionary's field, " + key, () => { const x = parse().projects![key]; if (!x) return "nil"; const tools = (x as Record<string, unknown>).tools; const n = (x as Record<string, unknown>)["n"]; return describeValue(tools) + " " + describeValue(n) })
row("a dictionary or nothing", () => { const x = parse().projects!["wrong"]; const r = typeof x === "object" ? (x as Record<string, unknown>) : undefined; const v = r ? (r as Record<string, unknown>)["tools"] : undefined; return describeValue(v) })
row("a field by itself", () => { const x = parse().projects!["more"]; const tools = x.tools; const first = tools[0]; return describeValue(first) })
row("a field tested", () => { const x = parse().projects!["wrong"]; return typeof x.tools === "string" && isText(x.tools) && (x as Record<string, unknown>).tools !== undefined })
row("a field handed on", () => { const x = parse().projects!["good"]; const made = { a: x.tools, b: describeValue(x.n), ...x }; return JSON.stringify(made) })
row("assigned later", () => { let v: unknown; const x = parse().projects!["lacks"]; v = (x as Record<string, unknown>)["n"]; return describeValue(v) })
row("a loop over what it holds", () => { const seen: string[] = []; const x = parse().projects!["more"]; for (const e of Object.entries(x)) { seen.push(e[0] + "=" + describeValue(e[1])) } for (const t of x.tools) seen.push(t); return seen.join() })
row("deleted", () => { const g = parse(); const x = g.projects!["good"]; delete x.n; delete (x as Record<string, unknown>).tools; return JSON.stringify(x) })
row("handed to a function as a dictionary", () => { const x = parse().projects!["wrong"]; const count = (r: Record<string, unknown>) => Object.keys(r).length; return count(x as Record<string, unknown>) })
row("the door itself as a dictionary", () => { const r = JSON.parse(text) as Record<string, unknown>; const version = r.version; return typeof version === "number" ? version + 1 : "no number" })
row("awaited and chained", () => { const g = parse(); return g.projects?.["good"]?.tools?.length })
type Mine = { a: number; b?: string }
const narrowed = (x: unknown) => { if (typeof x !== "object" || x === null) return "no object"; const r = x as Record<string, unknown>; return describeValue(r.a) }
const narrowedByIn = (x: unknown) => { if (!x || typeof x !== "object" || !("a" in x)) return "no a"; const r = x as Record<string, unknown>; return describeValue(r.a) }
const makeMine = (): Mine => ({ a: 1 })
const mines: Mine[] = [{ a: 2, b: "two" }]
row("narrowed, then cast", () => [narrowed(parse().projects!["good"]), narrowed({ a: 5 }), narrowed(makeMine()), narrowed("text"), narrowed(null)].join())
row("narrowed by `in`, then cast", () => [narrowedByIn(parse().counters), narrowedByIn({ a: 6 }), narrowedByIn(mines[0]), narrowedByIn(7)].join())
row("what a call yields, cast", () => { const r = makeMine() as Record<string, unknown>; return describeValue(r.a) + describeValue(r.b) })
row("an element, cast", () => { const r = mines[0] as Record<string, unknown>; return describeValue(r.a) + describeValue(r.b) })
const awaited = (await Promise.resolve(makeMine())) as Record<string, unknown>
row("what is awaited, cast", () => describeValue(awaited.a))
// JavaScriptCore's generic functions on external data: awaited and iterated afterwards.
const settled = await Promise.all([parse().projects!["wrong"], parse().projects!["more"]])
row("Promise.all of what is given", () => settled.map(p => typeof p.tools).join())
row("Array.from of what is given", () => Array.from(Object.values(parse().projects!)).map(p => (p && typeof p === "object" ? typeof p.tools : typeof p)).join())
// A FIELD THAT LIES ABOUT ITS KIND, USED AS THE PRIMITIVE IT IS DECLARED TO BE.
type Named = { name: string; size: number; on: boolean; label?: string }
const liars = JSON.parse('{"object":{"name":{"first":"a"},"size":{"n":1},"on":{}},"array":{"name":["x","y"],"size":[7],"on":[]},"swapped":{"name":5,"size":"12","on":"yes"},"nil":{"name":null,"size":null,"on":null},"honest":{"name":"abc","size":3,"on":true}}') as Record<string, Named>
for (const key of ["object", "array", "swapped", "nil", "honest"]) {
  row("a lying string, " + key, () => { const x = liars[key]; return [String(x.name?.length), x.name + "!", `<${x.name}>`, String(x.name < "b"), String(x.name === "abc"), typeof x.name].join("|") })
  row("a lying number, " + key, () => { const x = liars[key]; return [String(x.size + 1), String(x.size * 2), String(x.size < 5), String(-x.size), String(x.size | 0), `${x.size}`, typeof x.size].join("|") })
  row("a lying boolean, " + key, () => { const x = liars[key]; return [x.on ? "truthy" : "falsy", String(!x.on), String(x.on === true), String(x.on && 1), typeof x.on].join("|") })
  row("a lying field cast to its kind, " + key, () => { const r = liars[key] as Record<string, unknown>; const name = r.name as string, size = r.size as number; return [String(name + "?"), String(size + 1), typeof name, typeof size].join("|") })
}
// AN ANNOTATED VARIABLE tests what enters it, also when its type is as common as `string[]` or `number`.
for (const key of ["good", "lacks", "wrong"]) row("a common type written, " + key, () => { const x = parse().projects![key]; const t: string[] = x.tools; const n: number | undefined = x.n; return typeof t + " " + (Array.isArray(t) ? t.length : String(t)) + " " + typeof n })
for (const key of ["good", "lacks", "wrong"]) row("a number written, " + key, () => { const q = parse().counters![key]; const c: number = q.count; const name: string = q.name; return typeof c + " " + typeof name + " " + (typeof c === "number" ? c * 2 : "no number") })
row("round trip", () => { const g = parse(); return JSON.stringify(g) === text })
export {}
