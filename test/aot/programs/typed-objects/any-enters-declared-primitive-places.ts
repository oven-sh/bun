// Further places where an expression of type `any` enters a declared primitive place: a lie through `any` throws where it enters.
/* expected
field TypeError
dynamic field TypeError
default TypeError
pattern default TypeError
object pattern default TypeError
array literal TypeError
tuple made TypeError
push pushed TypeError
map set set TypeError
async return called
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
function tried(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const hide = (v: unknown): any => v
class K { n: number = hide("x"); tag = "k" }
attempt("field", () => new K().tag)
attempt("dynamic field", () => { class L { n: number = hide("x"); tag = "l" } return new L().tag })
function dflt(n: number = hide("x")): string { return "entered" }
attempt("default", () => dflt())
attempt("pattern default", () => { const [a = hide("x")]: number[] = []; return "bound" })
attempt("object pattern default", () => { const { a = hide("x") }: { a?: number } = {}; return "bound" })
attempt("array literal", () => { const list: number[] = [hide("x")]; return "made " + tried(() => list[0]) })
attempt("tuple", () => { const pair: [number, string] = [hide("x"), "s"]; return "made " + tried(() => pair[0]) })
attempt("push", () => { const list: number[] = []; list.push(hide("x")); return "pushed " + tried(() => list[0]) })
attempt("map set", () => { const m = new Map<string, number>(); m.set("k", hide("x")); return "set " + tried(() => m.get("k")) })
attempt("array literal, typed read", () => { const list: number[] = [hide("x")]; return "made " + tried(() => { const n: number = list[0]; return n }) })
attempt("tuple, typed read", () => { const pair: [number, string] = [hide("x"), "s"]; return "made " + tried(() => { const n: number = pair[0]; return n }) })
attempt("push, typed read", () => { const list: number[] = []; list.push(hide("x")); return "pushed " + tried(() => { const n: number = list[0]; return n }) })
attempt("map set, typed read", () => { const m = new Map<string, number>(); m.set("k", hide("x")); return "set " + tried(() => { const n: number | undefined = m.get("k"); return n }) })
attempt("async return", () => { async function f(): Promise<number> { return hide("x") } f(); return "called" })
