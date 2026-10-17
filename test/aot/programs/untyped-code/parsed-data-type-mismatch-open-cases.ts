// Data from `JSON.parse` is cast to a type that it does not match: the cases that are not handled yet.
type P = { tools: string[]; n?: number }
type G = { projects: Record<string, P> }
const text = JSON.stringify({ projects: { good: { tools: ["a"] }, wrong: { tools: "one,two" }, word: "corrupted" } })
const row = (what: string, f: () => unknown) => { let said: string; try { said = String(f()) } catch (e) { said = "THROWS " + (e as Error).message.split("\n")[0] } console.log(what + ": " + said) }
const parse = () => JSON.parse(text) as G
// a parameter, a result, a field of a type that is everybody's
const count = (tools: string[]) => (typeof tools === "string" ? -1 : tools.length)
const first = <T,>(xs: T[]): T => xs[0]
const toolsOf = (p: P): string[] => p.tools
class Keeper { tools: string[] = []; keep(p: P) { this.tools = p.tools; return typeof this.tools } }
row("a parameter of a common type", () => count(parse().projects["wrong"].tools))
row("a generic function of the program", () => { const t = first(parse().projects["wrong"].tools); return typeof t + ":" + String(t) })
row("a result of a common type", () => typeof toolsOf(parse().projects["wrong"]))
row("a field of a common type", () => new Keeper().keep(parse().projects["wrong"]))
row("assigned later to an annotated variable", () => { let t: string[] = []; t = parse().projects["wrong"].tools; return typeof t })
// data that passes an `any` of the program's own before it meets a type
type Late = { late: string[] }
const through = (raw: any): Late => raw as Late
const holder: { raw: any } = { raw: JSON.parse('{"late":"text"}') }
row("through a parameter of type any", () => typeof through(JSON.parse('{"late":"text"}')).late)
row("through a field of type any", () => typeof (holder.raw as Late).late)
// a layout that gets into a place of a tainted type as an argument, a property of a literal, a return
type Wide = { value: number; next: Wide | null }
type Narrow = { value: number; next: Narrow | null; back: Narrow | null }
const given: Wide = JSON.parse('{"value":1,"next":null}')
const link = (w: Wide, to: Wide) => { w.next = to; return w }
const narrow: Narrow = { value: 2, next: null, back: null }
row("a layout handed in as an argument", () => { link(narrow, given); return narrow.next === (given as object) })
