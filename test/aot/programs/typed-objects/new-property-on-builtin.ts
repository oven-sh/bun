// A built-in object that is not a prototype accepts a new property.
interface Rec { n: number; o?: number }
function fresh(): Rec { return { n: 1 } }
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).message) }
}
show("e5", () => fresh().o)
show("math", () => { (Math as any).o7 = 12; return (Math as any).o7 })
