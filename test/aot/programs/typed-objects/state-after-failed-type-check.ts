// A failed runtime type check: what the error is and what state the program is in afterwards (nothing half done, `finally` blocks run, loops continue).
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
let trace: string[] = []
function note<T>(tag: string, v: T): T { trace.push(tag); return v }
interface R { n: number; s: string }
const r: R = { n: 1, s: "s" }
attempt("a1", () => { r.n = note("rhs", hide("x")); return "stored" })
attempt("a2", () => trace.join() + " " + r.n)
function body(a: number, b: number, c: number): number { trace.push("body"); return a + b + c }
attempt("b1", () => body(1, hide("x"), 3))
attempt("b2", () => trace.includes("body"))
attempt("c1", () => {
  try { const n: number = hide("x"); return n } catch (e) {
    const error = e as Error
    return [e instanceof TypeError, e instanceof Error, e instanceof RangeError, typeof error.message, error.message.length > 0].join(" ")
  }
})
attempt("d1", () => {
  let sum = 0, failed = 0
  for (const v of [1, "2", 3, true, 5] as any[]) { try { const n: number = v; sum += n } catch { failed++ } }
  return sum + " " + failed
})
const made: R[] = []
attempt("e1", () => { try { made.push({ n: hide("x"), s: "t" }) } catch {} return made.length })
attempt("e2", () => { made.push({ n: hide(2), s: "t" }); return made.length })
attempt("f1", () => { r.n += hide("x"); return r.n })
attempt("f2", () => r.n)
class Counted { static made = 0; constructor(public n: number) { Counted.made++ } }
attempt("g1", () => new (Counted as any)("x").n)
attempt("g2", () => Counted.made)
attempt("h1", () => { trace = []; try { trace.push("try"); const s: string = hide(1); trace.push(s) } finally { trace.push("finally") } return "end" })
attempt("h2", () => trace.join())
// The failing read is in the middle of an expression that has effects on both sides.
const foreign: number[] = JSON.parse('["x"]')
let state = "before"
attempt("i1", () => { const got = (state = "left") + foreign[0] + (state = "right"); return got })
attempt("i2", () => state)
// A cast of an array looks at no element and copies nothing. The typed read of the field that does not fit throws, and nothing is changed.
const source = JSON.parse('[{"n":1,"s":"s"},{"n":"x","s":"s"}]')
const first = source[0]
attempt("i3", () => (source as R[]).length)
attempt("i3t", () => { const r: R = (source as R[])[1]; return r.n })
attempt("i4", () => source[0] === first)
attempt("j1", () => {
  let text = ""
  try { try { text += "inner "; const b: boolean = hide("x"); text += b } catch (e) { text += (e as Error).constructor.name; const n: number = hide(5); text += " outer " + n } } catch { text += " lost" }
  return text
})
// A generator and its consumer.
function* numbersOf(source: any[]): Generator<number> { for (const v of source) { const n: number = v; yield n } }
const seen: number[] = []
attempt("k1", () => { for (const n of numbersOf([1, 2, "3", 4])) seen.push(n); return "done" })
attempt("k2", () => seen.join())
async function later(v: any): Promise<string> { const n: number = v; return String(n + 1) }
Promise.allSettled([later(1), later("1")]).then(all => console.log("l1", all.map(x => x.status === "fulfilled" ? x.value : (x.reason as Error).constructor.name).join(" ")))
