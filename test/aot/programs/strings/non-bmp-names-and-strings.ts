// Property names and strings with characters beyond the Basic Multilingual Plane.
const say: (s: string) => void = (globalThis as any).print ?? console.log
class Holder { "😀" = 1; 𝐀b = 2; "𝐀 method"() { return 3 } static "𝐁" = 4 }
interface Shape { "😀": number; 𝐀b: number; plain: string }
function typed(s: Shape) { return s["😀"] + s.𝐀b + s.plain.length }
function untyped(o: any) { return o["😀"] + o.𝐀b + ("😀" in o ? 10 : 0) + ("😁" in o ? 100 : 0) }
function removed(o: any) { delete o["😀"]; return Object.keys(o).join("|") }
function compared(x: string) { return (x === "𝐀" ? 1 : 0) + (x === "😀😁" ? 2 : 0) + (x.startsWith("𝐀") ? 4 : 0) + (x.endsWith("😁") ? 8 : 0) + (x.includes("😀") ? 16 : 0) }
function switched(x: string) { switch (x) { case "𝐀": return "a"; case "😀😁": return "two"; case "\ud835": return "half"; default: return "other" } }
function built(x: string) { return `<${x}𝐀>` + "😀".length + "𝐀".codePointAt(0) + "😀".charCodeAt(1) }
function keyed(m: Map<string, number>, x: string) { return (m.get("𝐀") ?? -1) + (m.get(x) ?? -2) }
const holder = new Holder()
say([holder["😀"], holder.𝐀b, holder["𝐀 method"](), Holder["𝐁"], Object.keys(holder).join("|")].join(" "))
say(String(typed({ "😀": 5, 𝐀b: 6, plain: "x😀" })))
say(String(untyped({ "😀": 5, 𝐀b: 6 })))
say(removed(Object.fromEntries([["😀", 5], ["𝐀b", 6], ["z", 7]])))
for (const x of ["𝐀", "😀😁", "𝐀😁", "\ud835", "\udc00", "plain"]) say(compared(x) + " " + switched(x) + " " + built(x).length + " " + keyed(new Map([["𝐀", 1], ["😀😁", 2]]), x))
say(JSON.stringify({ "😀": "𝐀", half: "\ud835" }))
say(String(/^[😀-😃]+$/u.test("😁😂")) + " " + "a𝐀b".replace("𝐀", "-") + " " + "a𝐀b".split("𝐀").length + " " + "a𝐀b".indexOf("b"))
