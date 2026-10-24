// `(ns as any).Name` is the binding `Name` or `undefined`: a module namespace object is immutable.
import * as ns from "./req/ns_any_a"
import { atLoad, early } from "./req/ns_any_c"
export const lateBinding = "late"
const show = (label: string, f: () => unknown) => { try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", (e as Error).constructor.name) } }
show("an enum", () => (ns as any).Kind.B + " " + (ns as any).Kind[1])
show("a function", () => (ns as any).bump(2) + " " + ns.counter + " " + (ns as any).counter)
show("a live binding", () => { ns.bump(5); return (ns as any).counter })
show("a constant", () => (ns as any).table.b + " " + ((ns as any).table === ns.table))
show("through export *", () => (ns as any).fromStar() + " " + (ns as any).deep)
show("renamed", () => (ns as any).renamed)
show("the default", () => (ns as any).default())
show("a class", () => { new (ns as any).Late(); return ns.Late.made })
show("as unknown as", () => (ns as unknown as { deep: string }).deep)
// Doors.
show("not exported", () => (ns as any).nothingOfTheKind)
show("only a type", () => (ns as any).OnlyAType)
show("of Object.prototype", () => typeof (ns as any).toString + " " + typeof (ns as any).hasOwnProperty + " " + typeof (ns as any).__proto__)
show("a computed key", () => { const k = ["de", "ep"].join(""); return (ns as any)[k] + " " + (ns as any)["Kind"].A })
show("in", () => ("bump" in ns) + " " + ("nope" in (ns as any)))
try { (ns as any).replaceable = () => "replaced" } catch {}
show("and nothing has changed", () => ns.replaceable() + " " + (ns as any).replaceable())
show("the same, afterwards", () => early())
