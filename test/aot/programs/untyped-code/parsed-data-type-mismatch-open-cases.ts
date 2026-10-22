// Data from `JSON.parse` is cast to a type that it does not match. A string where `string[]` is written throws a TypeError where it enters a parameter or an annotated variable and where typed code reads the field, also after the data has passed through an `any` of the program's own.
type P = { tools: string[]; n?: number }
type G = { projects: Record<string, P> }
const text = JSON.stringify({ projects: { good: { tools: ["a"] }, wrong: { tools: "one,two" }, word: "corrupted" } })
const row = (what: string, f: () => unknown) => { let said: string; try { said = String(f()) } catch (e) { said = "THROWS " + (e as Error).constructor.name } console.log(what + ": " + said) }
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
row("through a parameter of type any", () => { const late: Late = through(JSON.parse('{"late":"text"}')); return typeof late.late })
row("through a field of type any", () => typeof (holder.raw as Late).late)
// an object made as one record type enters a field of another record type as an argument: any object passes
type Wide = { value: number; next: Wide | null }
type Narrow = { value: number; next: Narrow | null; back: Narrow | null }
const given: Wide = JSON.parse('{"value":1,"next":null}')
const link = (w: Wide, to: Wide) => { w.next = to; return w }
const narrow: Narrow = { value: 2, next: null, back: null }
row("a layout handed in as an argument", () => { link(narrow, given); return narrow.next === (given as object) })
